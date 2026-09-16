/**
 * volatility — quanto o preco se mexe, nao para onde.
 *
 *   ATR      — media de Wilder do True Range. Faixa propria.
 *   StdDev   — desvio padrao rolante do preco-fonte. Faixa propria.
 *   Bollinger— SMA +/- k desvios padrao. Sobre o preco (bandas).
 *   Keltner  — EMA +/- k * ATR. Sobre o preco (bandas).
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
} from '../contracts.js';
import { WilderState, EmaState, StdDevState, TrueRangeState } from '../rolling.core.js';
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

const multSpec = (def: number): ParamSpec => ({
  name: 'mult',
  label: 'Multiplicador',
  type: 'number',
  default: def,
  min: 0.1,
  max: 10,
  step: 0.1,
});

const sourceSpec: ParamSpec = { name: 'source', label: 'Fonte', type: 'source', default: 'close' };

// ─────────────────────────────────────────────────────────────────────────────
// ATR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ATR = media de Wilder do True Range.
 *
 * ⚠️ WilderState, NAO EmaState: o ATR classico de Wilder usa k=1/period. Usar EMA
 * daria valores proximos mas errados por definicao. O TrueRange guarda o
 * fechamento anterior internamente.
 *
 * ⚠️ preview do TR usa `peek(high, low)` — o preview NAO pode consumir o
 * fechamento da barra em formacao, senao a proxima barra teria o "anterior"
 * errado.
 */
class AtrLogic {
  private readonly tr = new TrueRangeState();
  private readonly wilder: WilderState;
  constructor(period: number) {
    this.wilder = new WilderState(period);
  }
  update(bar: IndicatorBar): number | null {
    const tr = this.tr.push(bar.high, bar.low, bar.close);
    return this.wilder.push(tr);
  }
  preview(bar: IndicatorBar): number | null {
    const tr = this.tr.peek(bar.high, bar.low);
    return this.wilder.peek(tr);
  }
  reset(): void {
    this.tr.reset();
    this.wilder.reset();
  }
}

export const atrFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 14);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'atr',
    label: 'Alcance Verdadeiro Medio',
    category: 'volatility',
    params: specs,
    outputs: [{ key: 'value', label: 'ATR', plot: 'line', pane: 'separate' }],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const a = new AtrLogic(period);
        return {
          onUpdate: (bar) => ({ value: a.update(bar) }),
          onPreview: (bar) => ({ value: a.preview(bar) }),
          onReset: () => a.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// StdDev
// ─────────────────────────────────────────────────────────────────────────────

/** Desvio padrao populacional rolante do preco-fonte. */
export const stddevFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 20);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'stddev',
    label: 'Desvio Padrao',
    category: 'volatility',
    params: specs,
    outputs: [{ key: 'value', label: 'StdDev', plot: 'line', pane: 'separate' }],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const source = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const sd = new StdDevState(period);
        // StdDevState nao tem peek; para o preview recriamos o efeito de um push
        // sem mutar. A forma mais simples e manter um espelho de janela? Nao —
        // aqui aproveitamos que StdDevState so precisa do valor: o preview
        // constroi um StdDevState paralelo? Custa O(period). Em vez disso,
        // implementamos peek reconstruindo. Ver PreviewStdDev abaixo.
        const preview = new PreviewStdDev(period, sd);
        return {
          onUpdate: (bar) => {
            const r = sd.push(priceOf(bar, source));
            preview.sync(priceOf(bar, source));
            return { value: r ? r.stddev : null };
          },
          onPreview: (bar) => {
            const r = preview.peek(priceOf(bar, source));
            return { value: r ? r.stddev : null };
          },
          onReset: () => {
            sd.reset();
            preview.reset();
          },
        };
      });
    },
  };
})();

/**
 * Espelho de janela para dar `peek` ao StdDevState (que so tem `push`).
 *
 * Mantem os ultimos `period` valores brutos e recalcula media/desvio ao espiar.
 * O(period) por preview, o que e aceitavel para a barra em formacao (uma por
 * tick, janela curta). NAO muta o StdDevState real.
 */
class PreviewStdDev {
  private readonly buf: number[] = [];
  constructor(private readonly period: number, _real: StdDevState) {}
  sync(x: number): void {
    this.buf.push(x);
    if (this.buf.length > this.period) this.buf.shift();
  }
  peek(x: number): { mean: number; stddev: number } | null {
    const vals = this.buf.slice();
    vals.push(x);
    const usados = vals.length > this.period ? vals.slice(vals.length - this.period) : vals;
    if (usados.length < this.period) return null;
    let soma = 0;
    for (const v of usados) soma += v;
    const mean = soma / this.period;
    let somaSq = 0;
    for (const v of usados) somaSq += (v - mean) * (v - mean);
    const variancia = Math.max(0, somaSq / this.period);
    return { mean, stddev: Math.sqrt(variancia) };
  }
  reset(): void {
    this.buf.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bollinger Bands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Media = SMA(source, period); banda = media +/- mult * desvio padrao populacional.
 *
 * StdDevState ja devolve `{mean, stddev}` num passo — a media da banda e a mesma
 * SMA, reaproveitada, evitando duas somas rolantes. Convencao classica: period
 * 20, mult 2, desvio populacional (o rolling.core ja e populacional).
 */
export const bollingerFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 20);
  const mSpec = multSpec(2);
  const specs: readonly ParamSpec[] = [pSpec, mSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'bollinger',
    label: 'Bandas de Bollinger',
    category: 'volatility',
    params: specs,
    outputs: [
      // As tres formam uma banda: upper/lower delimitam o preenchimento, middle e
      // a linha central. `band` nao muda o calculo, so instrui o plotter a pintar
      // a faixa entre upper e lower alem de desenhar as linhas.
      { key: 'upper', label: 'Superior', plot: 'line', pane: 'price', band: 'upper' },
      { key: 'middle', label: 'Media', plot: 'line', pane: 'price', band: 'middle' },
      { key: 'lower', label: 'Inferior', plot: 'line', pane: 'price', band: 'lower' },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const mult = numParam(merged, mSpec);
      const source = sourceParam(merged, sourceSpec);
      const band = (r: { mean: number; stddev: number } | null): IndicatorValue => {
        if (r === null) return { upper: null, middle: null, lower: null };
        return {
          upper: r.mean + mult * r.stddev,
          middle: r.mean,
          lower: r.mean - mult * r.stddev,
        };
      };
      return buildInstance(meta, merged, () => {
        const sd = new StdDevState(period);
        const preview = new PreviewStdDev(period, sd);
        return {
          onUpdate: (bar) => {
            const p = priceOf(bar, source);
            const r = sd.push(p);
            preview.sync(p);
            return band(r);
          },
          onPreview: (bar) => band(preview.peek(priceOf(bar, source))),
          onReset: () => {
            sd.reset();
            preview.reset();
          },
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Keltner Channels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Linha media = EMA(close, period); canal = media +/- mult * ATR(atrPeriod).
 *
 * ⚠️ A variante moderna (Linda Raschke) usa EMA + ATR — implementada aqui. A
 * original de Keltner usava SMA de typical price + range simples; escolhemos a
 * variante EMA+ATR por ser a mais difundida hoje. Documentado para nao parecer
 * bug de definicao.
 *
 * A banda so aparece quando AMBOS (EMA e ATR) aqueceram. O warmup e o maior dos
 * dois — na pratica, o maior entre `period` (EMA) e `atrPeriod` (ATR).
 */
export const keltnerFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo EMA', 20);
  const atrSpec = periodSpec('atrPeriod', 'Periodo ATR', 10);
  const mSpec = multSpec(2);
  const specs: readonly ParamSpec[] = [pSpec, atrSpec, mSpec];
  const meta: IndicatorMeta = {
    name: 'keltner',
    label: 'Canais de Keltner',
    category: 'volatility',
    params: specs,
    outputs: [
      // Banda de Keltner: mesma modelagem da Bollinger — upper/lower delimitam o
      // preenchimento, middle e a EMA central.
      { key: 'upper', label: 'Superior', plot: 'line', pane: 'price', band: 'upper' },
      { key: 'middle', label: 'Media', plot: 'line', pane: 'price', band: 'middle' },
      { key: 'lower', label: 'Inferior', plot: 'line', pane: 'price', band: 'lower' },
    ],
    warmup: (p) => Math.max(Math.round(numParam(p, pSpec)), Math.round(numParam(p, atrSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const atrPeriod = Math.max(1, Math.round(numParam(merged, atrSpec)));
      const mult = numParam(merged, mSpec);
      const band = (ema: number | null, atr: number | null): IndicatorValue => {
        if (ema === null || atr === null) return { upper: null, middle: null, lower: null };
        return { upper: ema + mult * atr, middle: ema, lower: ema - mult * atr };
      };
      return buildInstance(meta, merged, () => {
        const ema = new EmaState(period);
        const tr = new TrueRangeState();
        const wilder = new WilderState(atrPeriod);
        return {
          onUpdate: (bar) => {
            const e = ema.push(bar.close);
            const a = wilder.push(tr.push(bar.high, bar.low, bar.close));
            return band(e, a);
          },
          onPreview: (bar) => {
            const e = ema.peek(bar.close);
            const a = wilder.peek(tr.peek(bar.high, bar.low));
            return band(e, a);
          },
          onReset: () => {
            ema.reset();
            tr.reset();
            wilder.reset();
          },
        };
      });
    },
  };
})();
