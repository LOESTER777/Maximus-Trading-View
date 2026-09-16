/**
 * oscillators — indicadores que medem forca, exaustao e posicao relativa do
 * preco, normalmente numa faixa propria (`pane: 'separate'`).
 *
 *   RSI        — forca relativa de altas vs baixas, 0..100, com media de Wilder.
 *   Stochastic — onde o fechamento cai dentro do range recente (%K) e sua SMA (%D).
 *   CCI        — desvio do preco tipico face a sua media, escalado por 0.015.
 *   Williams %R— irmao do %K, invertido, em -100..0.
 *   ROC        — variacao percentual face a `period` barras atras.
 *   Momentum   — diferenca absoluta face a `period` barras atras.
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
import { WilderState, SmaState, RingWindow, KahanSum } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliares
// ─────────────────────────────────────────────────────────────────────────────

const periodSpec = (name: string, label: string, def: number): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

const sourceSpec: ParamSpec = { name: 'source', label: 'Fonte', type: 'source', default: 'close' };

/**
 * Extremos (min e max) da janela dos ultimos `period` valores.
 *
 * O(period) por consulta via `RingWindow.forEach`. Um deque monotonico daria
 * O(1) amortizado, mas a janela e curta (5..21 tipico) e a simplicidade aqui
 * vale mais que a assintotica — e recalcular do buffer torna incremental ==
 * batch exato sem soma rolante que derive.
 */
class MinMaxWindow {
  private readonly win: RingWindow;
  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
  }
  private extremes(extra?: number): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    this.win.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (extra !== undefined) {
      if (extra < min) min = extra;
      if (extra > max) max = extra;
    }
    return { min, max };
  }
  push(x: number): { min: number; max: number } | null {
    this.win.push(x);
    return this.win.isFull() ? this.extremes() : null;
  }
  peek(x: number): { min: number; max: number } | null {
    if (this.win.isFull()) return this.extremes(x);
    return this.win.size() + 1 === this.period ? this.extremes(x) : null;
  }
  reset(): void {
    this.win.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RSI = 100 - 100/(1+RS), RS = mediaGanho/mediaPerda, ambas por Wilder (k=1/n).
 *
 * ⚠️ A primeira variacao NAO produz RSI: o RSI precisa de `period` variacoes, e
 * variacoes vem de PARES de barras — entao sao necessarias `period+1` barras.
 * Guardamos o fechamento anterior fora dos acumuladores de Wilder para calcular
 * a variacao; o `preview` calcula a variacao contra esse anterior sem consumi-lo.
 *
 * ⚠️ Quando a media de perda e 0 (so subiu na janela), RS -> Infinity e RSI = 100
 * por definicao — tratado explicitamente para nao gerar NaN.
 */
class RsiLogic {
  private readonly gain: WilderState;
  private readonly loss: WilderState;
  private prev: number | null = null;

  constructor(private readonly period: number, private readonly source: PriceSourceLite) {
    this.gain = new WilderState(period);
    this.loss = new WilderState(period);
  }

  private rsiFrom(avgGain: number | null, avgLoss: number | null): number | null {
    if (avgGain === null || avgLoss === null) return null;
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100; // sem perdas: forca maxima; sem movimento: neutro
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  update(bar: IndicatorBar): number | null {
    const price = priceOf(bar, this.source);
    if (this.prev === null) {
      this.prev = price;
      return null; // primeira barra: ainda nao ha variacao
    }
    const change = price - this.prev;
    this.prev = price;
    const g = this.gain.push(change > 0 ? change : 0);
    const l = this.loss.push(change < 0 ? -change : 0);
    return this.rsiFrom(g, l);
  }

  preview(bar: IndicatorBar): number | null {
    const price = priceOf(bar, this.source);
    if (this.prev === null) return null;
    const change = price - this.prev;
    const g = this.gain.peek(change > 0 ? change : 0);
    const l = this.loss.peek(change < 0 ? -change : 0);
    return this.rsiFrom(g, l);
  }

  reset(): void {
    this.gain.reset();
    this.loss.reset();
    this.prev = null;
  }
}

type PriceSourceLite = Parameters<typeof priceOf>[1];

export const rsiFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 14);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'rsi',
    label: 'Indice de Forca Relativa',
    category: 'momentum',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: 'RSI',
        plot: 'line',
        pane: 'separate',
        referenceLines: [30, 70],
      },
    ],
    // period+1 barras: as variacoes precisam de pares consecutivos.
    warmup: (p) => Math.round(numParam(p, pSpec)) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const source = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const rsi = new RsiLogic(period, source);
        return {
          onUpdate: (bar) => ({ value: rsi.update(bar) }),
          onPreview: (bar) => ({ value: rsi.preview(bar) }),
          onReset: () => rsi.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Stochastic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * %K = 100 * (close - min(low, K)) / (max(high, K) - min(low, K)); %D = SMA(%K, D).
 *
 * ⚠️ Range zero (max == min, mercado parado na janela) daria divisao por zero;
 * convenciona-se %K = 50 (centro) nesse caso, e nao NaN.
 *
 * Este e o Stochastic "rapido". %K usa min/max sobre `periodK` barras; %D suaviza
 * %K por SMA de `periodD`.
 */
class StochasticLogic {
  private readonly lows: MinMaxWindow;
  private readonly highs: MinMaxWindow;
  private readonly dSma: SmaState;

  constructor(periodK: number, private readonly periodD: number) {
    this.lows = new MinMaxWindow(periodK);
    this.highs = new MinMaxWindow(periodK);
    this.dSma = new SmaState(periodD);
  }

  private kFrom(lo: number, hi: number, close: number): number {
    const range = hi - lo;
    if (range <= 0) return 50;
    return (100 * (close - lo)) / range;
  }

  update(bar: IndicatorBar): { k: number | null; d: number | null } {
    const lo = this.lows.push(bar.low);
    const hi = this.highs.push(bar.high);
    if (lo === null || hi === null) return { k: null, d: null };
    const k = this.kFrom(lo.min, hi.max, bar.close);
    const d = this.dSma.push(k);
    return { k, d };
  }

  preview(bar: IndicatorBar): { k: number | null; d: number | null } {
    const lo = this.lows.peek(bar.low);
    const hi = this.highs.peek(bar.high);
    if (lo === null || hi === null) return { k: null, d: null };
    const k = this.kFrom(lo.min, hi.max, bar.close);
    const d = this.dSma.peek(k);
    return { k, d };
  }

  reset(): void {
    this.lows.reset();
    this.highs.reset();
    this.dSma.reset();
  }
}

export const stochasticFactory: IndicatorFactory = (() => {
  const kSpec = periodSpec('periodK', 'Periodo %K', 14);
  const dSpec = periodSpec('periodD', 'Periodo %D', 3);
  const specs: readonly ParamSpec[] = [kSpec, dSpec];
  const meta: IndicatorMeta = {
    name: 'stochastic',
    label: 'Oscilador Estocastico',
    category: 'oscillator',
    params: specs,
    outputs: [
      { key: 'k', label: '%K', plot: 'line', pane: 'separate', referenceLines: [20, 80] },
      { key: 'd', label: '%D', plot: 'line', pane: 'separate' },
    ],
    // %K precisa de periodK barras; %D adiciona periodD-1 sobre %K.
    warmup: (p) => Math.round(numParam(p, kSpec)) + Math.round(numParam(p, dSpec)) - 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const periodK = Math.max(1, Math.round(numParam(merged, kSpec)));
      const periodD = Math.max(1, Math.round(numParam(merged, dSpec)));
      return buildInstance(meta, merged, () => {
        const s = new StochasticLogic(periodK, periodD);
        return {
          onUpdate: (bar) => s.update(bar),
          onPreview: (bar) => s.preview(bar),
          onReset: () => s.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// CCI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CCI = (hlc3 - SMA(hlc3)) / (0.015 * desvio medio absoluto).
 *
 * ⚠️ USA hlc3 (preco tipico), NAO o fechamento — e a definicao de Lambert. E usa
 * DESVIO MEDIO ABSOLUTO (media de |x - media|), NAO o desvio padrao; sao coisas
 * diferentes e trocar um pelo outro muda a escala do indicador. Por isso o CCI
 * nao reusa StdDevState: precisa da media dos modulos, que exige varrer a janela.
 *
 * O fator 0.015 e a constante de Lambert, escolhida para que ~70-80% dos valores
 * caiam em -100..+100. Range zero (janela constante) -> desvio 0 -> CCI = 0.
 */
class CciLogic {
  private readonly win: RingWindow;
  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
  }

  private compute(tp: number, includeNew: boolean): number | null {
    // Reune a janela (opcionalmente com `tp` novo) e calcula media e desvio medio.
    const vals: number[] = [];
    this.win.forEach((v) => vals.push(v));
    if (includeNew) vals.push(tp);
    if (vals.length < this.period) return null;
    // Se a janela esta cheia e incluimos um novo, o mais antigo sairia.
    const usados = vals.length > this.period ? vals.slice(vals.length - this.period) : vals;
    const somaMedia = new KahanSum();
    for (const v of usados) somaMedia.add(v);
    const mean = somaMedia.value() / this.period;
    const somaDesvio = new KahanSum();
    for (const v of usados) somaDesvio.add(Math.abs(v - mean));
    const meanDev = somaDesvio.value() / this.period;
    if (meanDev === 0) return 0;
    return (tp - mean) / (0.015 * meanDev);
  }

  update(bar: IndicatorBar): number | null {
    const tp = priceOf(bar, 'hlc3');
    this.win.push(tp);
    // Apos push, a janela ja contem tp; computa sem incluir de novo.
    const vals: number[] = [];
    this.win.forEach((v) => vals.push(v));
    if (vals.length < this.period) return null;
    const somaMedia = new KahanSum();
    for (const v of vals) somaMedia.add(v);
    const mean = somaMedia.value() / this.period;
    const somaDesvio = new KahanSum();
    for (const v of vals) somaDesvio.add(Math.abs(v - mean));
    const meanDev = somaDesvio.value() / this.period;
    if (meanDev === 0) return 0;
    return (tp - mean) / (0.015 * meanDev);
  }

  preview(bar: IndicatorBar): number | null {
    const tp = priceOf(bar, 'hlc3');
    return this.compute(tp, true);
  }

  reset(): void {
    this.win.reset();
  }
}

export const cciFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 20);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'cci',
    label: 'Indice de Canal de Commodities',
    category: 'oscillator',
    params: specs,
    outputs: [
      { key: 'value', label: 'CCI', plot: 'line', pane: 'separate', referenceLines: [-100, 100] },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const c = new CciLogic(period);
        return {
          onUpdate: (bar) => ({ value: c.update(bar) }),
          onPreview: (bar) => ({ value: c.preview(bar) }),
          onReset: () => c.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Williams %R
// ─────────────────────────────────────────────────────────────────────────────

/**
 * %R = -100 * (max - close) / (max - min). Irmao do %K estocastico, invertido e
 * na faixa -100..0. Range zero -> -50 (centro), por simetria com o %K.
 */
class WilliamsLogic {
  private readonly lows: MinMaxWindow;
  private readonly highs: MinMaxWindow;
  constructor(period: number) {
    this.lows = new MinMaxWindow(period);
    this.highs = new MinMaxWindow(period);
  }
  private rFrom(lo: number, hi: number, close: number): number {
    const range = hi - lo;
    if (range <= 0) return -50;
    return (-100 * (hi - close)) / range;
  }
  update(bar: IndicatorBar): number | null {
    const lo = this.lows.push(bar.low);
    const hi = this.highs.push(bar.high);
    if (lo === null || hi === null) return null;
    return this.rFrom(lo.min, hi.max, bar.close);
  }
  preview(bar: IndicatorBar): number | null {
    const lo = this.lows.peek(bar.low);
    const hi = this.highs.peek(bar.high);
    if (lo === null || hi === null) return null;
    return this.rFrom(lo.min, hi.max, bar.close);
  }
  reset(): void {
    this.lows.reset();
    this.highs.reset();
  }
}

export const williamsRFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 14);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'williams_r',
    label: 'Williams %R',
    category: 'oscillator',
    params: specs,
    outputs: [
      { key: 'value', label: '%R', plot: 'line', pane: 'separate', referenceLines: [-20, -80] },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const w = new WilliamsLogic(period);
        return {
          onUpdate: (bar) => ({ value: w.update(bar) }),
          onPreview: (bar) => ({ value: w.preview(bar) }),
          onReset: () => w.reset(),
        };
      });
    },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// ROC / Momentum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ROC = 100 * (preco - preco[n atras]) / preco[n atras]. Momentum = preco -
 * preco[n atras] (absoluto). Ambos precisam do preco de `period` barras atras,
 * guardado numa janela de `period+1` posicoes (a mais antiga e o alvo).
 *
 * ⚠️ ROC divide pelo preco antigo; se ele for 0, ROC e null (indefinido) em vez
 * de Infinity — preco 0 nao ocorre em mercado real, mas entrada hostil nao pode
 * gerar Infinity.
 */
class LaggedLogic {
  private readonly win: RingWindow;
  constructor(
    period: number,
    private readonly source: PriceSourceLite,
    private readonly mode: 'roc' | 'momentum',
  ) {
    // period+1: precisamos manter o valor de `period` barras atras E o atual.
    this.win = new RingWindow(period + 1);
  }
  private valFrom(oldest: number, current: number): number | null {
    if (this.mode === 'momentum') return current - oldest;
    if (oldest === 0) return null;
    return (100 * (current - oldest)) / oldest;
  }
  private oldest(): number | null {
    let first: number | null = null;
    let done = false;
    this.win.forEach((v) => {
      if (!done) {
        first = v;
        done = true;
      }
    });
    return first;
  }
  update(bar: IndicatorBar): number | null {
    const price = priceOf(bar, this.source);
    const full = this.win.isFull();
    const old = full ? this.oldest() : null;
    this.win.push(price);
    if (old === null) return null;
    return this.valFrom(old, price);
  }
  preview(bar: IndicatorBar): number | null {
    const price = priceOf(bar, this.source);
    if (!this.win.isFull()) return null;
    const old = this.oldest();
    if (old === null) return null;
    return this.valFrom(old, price);
  }
  reset(): void {
    this.win.reset();
  }
}

function makeLaggedFactory(
  name: string,
  label: string,
  outLabel: string,
  mode: 'roc' | 'momentum',
  refs?: readonly number[],
): IndicatorFactory {
  const pSpec = periodSpec('period', 'Periodo', mode === 'roc' ? 9 : 10);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name,
    label,
    category: 'momentum',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: outLabel,
        plot: 'line',
        pane: 'separate',
        ...(refs ? { referenceLines: refs } : {}),
      },
    ],
    // precisa de period+1 barras (a antiga e a atual).
    warmup: (p) => Math.round(numParam(p, pSpec)) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const source = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const l = new LaggedLogic(period, source, mode);
        return {
          onUpdate: (bar) => ({ value: l.update(bar) }),
          onPreview: (bar) => ({ value: l.preview(bar) }),
          onReset: () => l.reset(),
        };
      });
    },
  };
}

export const rocFactory: IndicatorFactory = makeLaggedFactory(
  'roc',
  'Taxa de Variacao',
  'ROC',
  'roc',
  [0],
);

export const momentumFactory: IndicatorFactory = makeLaggedFactory(
  'momentum',
  'Momentum',
  'MOM',
  'momentum',
  [0],
);
