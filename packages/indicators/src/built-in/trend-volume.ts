/**
 * trend-volume — direcao (MACD, ADX/DMI) e fluxo (OBV, VWAP).
 *
 *   MACD — EMA rapida - EMA lenta; sinal = EMA(macd); histograma = macd - sinal.
 *   ADX  — forca da tendencia (0..100) + direcao (+DI/-DI), tudo por Wilder.
 *   OBV  — volume acumulado com sinal do movimento do fechamento.
 *   VWAP — preco medio ponderado por volume, acumulado NA SESSAO.
 */

import {
  numParam,
  sourceParam,
  priceOf,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type IndicatorValue,
  type ParamSpec,
  SOURCE_PARAM_SPEC,
} from '../contracts.js';
import { EmaState, WilderState, TrueRangeState, KahanSum } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

const periodSpec = (name: string, label: string, def: number): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

/**
 * Preco-fonte: reusa o spec CANONICO do contrato.
 *
 * ⚠️ Este spec estava copiado aqui e em outros tres arquivos de indicador, identico.
 * A primeira mudanca real (`options`, a lista de fontes para a interface montar o
 * select) teria de ser feita em quatro lugares — e bastaria esquecer um para o
 * indicador ficar com um select vazio.
 */
const sourceSpec: ParamSpec = SOURCE_PARAM_SPEC;

// ─────────────────────────────────────────────────────────────────────────────
// MACD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MACD = EMA(fast) - EMA(slow); sinal = EMA(macd, signalPeriod); hist = macd - sinal.
 *
 * ⚠️ A linha de sinal e a EMA do PROPRIO macd, e o macd so existe quando AMBAS as
 * EMAs (rapida e lenta) aqueceram. A EMA do sinal, por sua vez, semeia com a SMA
 * das primeiras `signalPeriod` amostras de macd — a mesma definicao classica de
 * semente que EmaState garante. Enquanto isso, sinal e histograma sao null.
 *
 * ⚠️ A EMA lenta aquece depois da rapida; o macd so vale quando a lenta emite.
 * Por isso o macd usa `slow.push` como gatilho — a rapida ja terra emitido antes.
 */
export const macdFactory: IndicatorFactory = (() => {
  const fastSpec = periodSpec('fast', 'EMA Rapida', 12);
  const slowSpec = periodSpec('slow', 'EMA Lenta', 26);
  const signalSpec = periodSpec('signal', 'Sinal', 9);
  const specs: readonly ParamSpec[] = [fastSpec, slowSpec, signalSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'macd',
    label: 'MACD',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'macd', label: 'MACD', plot: 'line', pane: 'separate', referenceLines: [0] },
      { key: 'signal', label: 'Sinal', plot: 'line', pane: 'separate' },
      { key: 'histogram', label: 'Histograma', plot: 'histogram', pane: 'separate' },
    ],
    dependencies: ['ema'],
    // slow + signal-1: a EMA lenta define quando o macd nasce; o sinal adiciona.
    warmup: (p) => Math.round(numParam(p, slowSpec)) + Math.round(numParam(p, signalSpec)) - 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const fast = Math.max(1, Math.round(numParam(merged, fastSpec)));
      const slow = Math.max(1, Math.round(numParam(merged, slowSpec)));
      const signal = Math.max(1, Math.round(numParam(merged, signalSpec)));
      const source = sourceParam(merged, sourceSpec);
      const empty: IndicatorValue = { macd: null, signal: null, histogram: null };
      return buildInstance(meta, merged, () => {
        const emaFast = new EmaState(fast);
        const emaSlow = new EmaState(slow);
        const emaSignal = new EmaState(signal);
        return {
          onUpdate: (bar) => {
            const price = priceOf(bar, source);
            const f = emaFast.push(price);
            const s = emaSlow.push(price);
            if (f === null || s === null) return empty;
            const macd = f - s;
            const sig = emaSignal.push(macd);
            if (sig === null) return { macd, signal: null, histogram: null };
            return { macd, signal: sig, histogram: macd - sig };
          },
          onPreview: (bar) => {
            const price = priceOf(bar, source);
            const f = emaFast.peek(price);
            const s = emaSlow.peek(price);
            if (f === null || s === null) return empty;
            const macd = f - s;
            const sig = emaSignal.peek(macd);
            if (sig === null) return { macd, signal: null, histogram: null };
            return { macd, signal: sig, histogram: macd - sig };
          },
          onReset: () => {
            emaFast.reset();
            emaSlow.reset();
            emaSignal.reset();
          },
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// ADX / DMI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Movimento direcional de Wilder.
 *
 *   +DM = up move se up move > down move e up move > 0, senao 0
 *   -DM = down move se down move > up move e down move > 0, senao 0
 *   (up move = high - highPrev; down move = lowPrev - low)
 *   +DI = 100 * Wilder(+DM) / Wilder(TR); -DI analogo
 *   DX  = 100 * |+DI - -DI| / (+DI + -DI)
 *   ADX = Wilder(DX)
 *
 * ⚠️ Sao TRES suavizacoes de Wilder do MESMO periodo (TR, +DM, -DM) e uma QUARTA
 * (DX -> ADX). O ADX portanto aquece bem depois dos DIs: precisa que os DIs
 * existam por `period` barras para semear o Wilder do DX. Por isso +DI/-DI podem
 * ter valor enquanto o ADX ainda e null — os campos sao independentes.
 *
 * ⚠️ Precisa da barra anterior (high/low) para os "moves"; guardamos fora do
 * Wilder. O preview usa peek em todos e nao consome a barra anterior.
 */
class AdxLogic {
  private readonly trW: WilderState;
  private readonly plusW: WilderState;
  private readonly minusW: WilderState;
  private readonly adxW: WilderState;
  private readonly tr = new TrueRangeState();
  private prevHigh: number | null = null;
  private prevLow: number | null = null;

  constructor(period: number) {
    this.trW = new WilderState(period);
    this.plusW = new WilderState(period);
    this.minusW = new WilderState(period);
    this.adxW = new WilderState(period);
  }

  private moves(high: number, low: number): { plusDM: number; minusDM: number } {
    if (this.prevHigh === null || this.prevLow === null) {
      return { plusDM: 0, minusDM: 0 };
    }
    const up = high - this.prevHigh;
    const down = this.prevLow - low;
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;
    return { plusDM, minusDM };
  }

  private dis(
    trAvg: number | null,
    plusAvg: number | null,
    minusAvg: number | null,
  ): { plusDI: number | null; minusDI: number | null; dx: number | null } {
    if (trAvg === null || plusAvg === null || minusAvg === null || trAvg === 0) {
      return { plusDI: null, minusDI: null, dx: null };
    }
    const plusDI = (100 * plusAvg) / trAvg;
    const minusDI = (100 * minusAvg) / trAvg;
    const soma = plusDI + minusDI;
    const dx = soma === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / soma;
    return { plusDI, minusDI, dx };
  }

  update(bar: IndicatorBar): IndicatorValue {
    const { plusDM, minusDM } = this.moves(bar.high, bar.low);
    const trVal = this.tr.push(bar.high, bar.low, bar.close);
    this.prevHigh = bar.high;
    this.prevLow = bar.low;
    const trAvg = this.trW.push(trVal);
    const plusAvg = this.plusW.push(plusDM);
    const minusAvg = this.minusW.push(minusDM);
    const { plusDI, minusDI, dx } = this.dis(trAvg, plusAvg, minusAvg);
    const adx = dx === null ? null : this.adxW.push(dx);
    return { adx, plus_di: plusDI, minus_di: minusDI };
  }

  preview(bar: IndicatorBar): IndicatorValue {
    const { plusDM, minusDM } = this.moves(bar.high, bar.low);
    const trVal = this.tr.peek(bar.high, bar.low);
    const trAvg = this.trW.peek(trVal);
    const plusAvg = this.plusW.peek(plusDM);
    const minusAvg = this.minusW.peek(minusDM);
    const { plusDI, minusDI, dx } = this.dis(trAvg, plusAvg, minusAvg);
    const adx = dx === null ? null : this.adxW.peek(dx);
    return { adx, plus_di: plusDI, minus_di: minusDI };
  }

  reset(): void {
    this.trW.reset();
    this.plusW.reset();
    this.minusW.reset();
    this.adxW.reset();
    this.tr.reset();
    this.prevHigh = null;
    this.prevLow = null;
  }
}

export const adxFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 14);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'adx',
    label: 'Indice Direcional Medio (ADX/DMI)',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'adx', label: 'ADX', plot: 'line', pane: 'separate', referenceLines: [20, 40] },
      { key: 'plus_di', label: '+DI', plot: 'line', pane: 'separate' },
      { key: 'minus_di', label: '-DI', plot: 'line', pane: 'separate' },
    ],
    // TR/DM aquecem em ~period+1 barras (precisa da anterior), o ADX ~2*period.
    warmup: (p) => 2 * Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const a = new AdxLogic(period);
        return {
          onUpdate: (bar) => a.update(bar),
          onPreview: (bar) => a.preview(bar),
          onReset: () => a.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// OBV — On-Balance Volume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OBV acumula volume com sinal: +volume se o fechamento subiu, -volume se caiu, 0
 * se igual. Comeca em 0 na primeira barra (sem anterior para comparar) — e o
 * valor inicial classico do OBV, e por isso NAO e null: a serie OBV existe desde
 * a primeira barra.
 *
 * ⚠️ Volume ausente conta como 0 (nao poluir com NaN). O OBV nao tem periodo;
 * warmup 0.
 */
export const obvFactory: IndicatorFactory = (() => {
  const specs: readonly ParamSpec[] = [];
  const meta: IndicatorMeta = {
    name: 'obv',
    label: 'Volume no Balanco (OBV)',
    category: 'volume',
    params: specs,
    outputs: [{ key: 'value', label: 'OBV', plot: 'line', pane: 'separate' }],
    warmup: () => 0,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      return buildInstance(meta, merged, () => {
        let obv = 0;
        let prevClose: number | null = null;
        const vol = (b: IndicatorBar): number =>
          typeof b.volume === 'number' && Number.isFinite(b.volume) ? b.volume : 0;
        return {
          onUpdate: (bar) => {
            if (prevClose === null) {
              prevClose = bar.close;
              obv = 0;
              return { value: 0 };
            }
            if (bar.close > prevClose) obv += vol(bar);
            else if (bar.close < prevClose) obv -= vol(bar);
            prevClose = bar.close;
            return { value: obv };
          },
          onPreview: (bar) => {
            if (prevClose === null) return { value: 0 };
            let v = obv;
            if (bar.close > prevClose) v += vol(bar);
            else if (bar.close < prevClose) v -= vol(bar);
            return { value: v };
          },
          onReset: () => {
            obv = 0;
            prevClose = null;
          },
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// VWAP — preco medio ponderado por volume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VWAP = soma(hlc3 * volume) / soma(volume), acumulado DENTRO DA SESSAO.
 *
 * ⚠️ VWAP e por SESSAO, nao um acumulado eterno — reinicia todo dia de pregao,
 * senao a media do ano inteiro nao diz nada sobre hoje. Detectamos virada de
 * sessao pela data UTC do timestamp (epoch segundos); ao mudar o dia, zera os
 * acumuladores. Documentado porque a fronteira de sessao e a decisao que mais
 * varia entre implementacoes — aqui e dia-calendario UTC, simples e determinista.
 *
 * ⚠️ Volume ausente/0 na sessao inteira -> denominador 0 -> VWAP null (indefinido),
 * nao NaN. Kahan nas duas somas para nao derivar numa sessao longa.
 */
export const vwapFactory: IndicatorFactory = (() => {
  const specs: readonly ParamSpec[] = [];
  const meta: IndicatorMeta = {
    name: 'vwap',
    label: 'Preco Medio Ponderado por Volume (VWAP)',
    category: 'volume',
    params: specs,
    outputs: [{ key: 'value', label: 'VWAP', plot: 'line', pane: 'price' }],
    warmup: () => 0,
  };
  const dayOf = (timeSec: number): number => Math.floor(timeSec / 86400);
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      return buildInstance(meta, merged, () => {
        const pv = new KahanSum();
        const vv = new KahanSum();
        let session: number | null = null;
        const vol = (b: IndicatorBar): number =>
          typeof b.volume === 'number' && Number.isFinite(b.volume) ? b.volume : 0;
        return {
          onUpdate: (bar) => {
            const day = dayOf(bar.time);
            if (session !== day) {
              // Virada de sessao: zera acumuladores para nao arrastar o dia anterior.
              pv.reset();
              vv.reset();
              session = day;
            }
            const v = vol(bar);
            pv.add(priceOf(bar, 'hlc3') * v);
            vv.add(v);
            const denom = vv.value();
            return { value: denom > 0 ? pv.value() / denom : null };
          },
          onPreview: (bar) => {
            // Preview sem mutar: simula somar a barra corrente aos acumuladores.
            const day = dayOf(bar.time);
            const v = vol(bar);
            if (session !== day) {
              // Barra abre nova sessao: VWAP e so ela.
              return { value: v > 0 ? priceOf(bar, 'hlc3') : null };
            }
            const denom = vv.value() + v;
            const num = pv.value() + priceOf(bar, 'hlc3') * v;
            return { value: denom > 0 ? num / denom : null };
          },
          onReset: () => {
            pv.reset();
            vv.reset();
            session = null;
          },
        };
      });
    },
  };
})();
