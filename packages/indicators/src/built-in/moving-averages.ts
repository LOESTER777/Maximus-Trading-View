/**
 * moving-averages — as medias moveis. Cada uma e uma familia de suavizacao com
 * viés diferente sobre "o que e agora".
 *
 *   SMA  — media aritmetica da janela. Todo peso igual; atrasa metade do periodo.
 *   EMA  — peso decai exponencialmente; reage mais rapido, semeada por SMA.
 *   WMA  — peso LINEAR (n, n-1, ..., 1); entre SMA e EMA em reatividade.
 *   RMA  — suavizacao de Wilder (k=1/n). NAO e EMA; e a media do RSI/ATR/ADX.
 *   DEMA — 2*EMA - EMA(EMA). Cancela parte do atraso da EMA.
 *   TEMA — 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)). Cancela ainda mais.
 *
 * Todas saem no painel do preco (`pane: 'price'`) — media movel sobre as velas.
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
import { EmaState, SmaState, WilderState, RingWindow, KahanSum } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

// ─────────────────────────────────────────────────────────────────────────────
// Specs de parametro reutilizados
// ─────────────────────────────────────────────────────────────────────────────

const periodSpec = (def: number): ParamSpec => ({
  name: 'period',
  label: 'Periodo',
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

const sourceSpec: ParamSpec = {
  name: 'source',
  label: 'Fonte',
  type: 'source',
  default: 'close',
};

/** Envolve `number|null`: null = aquecendo. Uma so saida chamada `value`. */
function scalar(value: number | null): IndicatorValue {
  return { value };
}

// ─────────────────────────────────────────────────────────────────────────────
// WMA — media movel ponderada linear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Media com pesos lineares: a barra mais nova pesa `period`, a mais antiga pesa
 * 1. Denominador = period*(period+1)/2.
 *
 * ⚠️ Nao ha atalho O(1) tao estavel quanto a SMA para a WMA sem acumular erro; a
 * janela tem no maximo `period` elementos, entao o custo O(period) por barra e
 * aceitavel e mantem incremental == batch trivialmente exato (recalcula a soma
 * ponderada da janela a cada passo, sem soma rolante que derive).
 */
class WmaState {
  private readonly win: RingWindow;
  private readonly denom: number;

  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
    this.denom = (period * (period + 1)) / 2;
  }

  private weighted(): number {
    // Pondera na ordem de insercao: peso 1 no mais antigo, `period` no mais novo.
    let i = 0;
    const soma = new KahanSum();
    this.win.forEach((v) => {
      i += 1;
      soma.add(v * i);
    });
    return soma.value() / this.denom;
  }

  push(x: number): number | null {
    this.win.push(x);
    return this.win.isFull() ? this.weighted() : null;
  }

  peek(x: number): number | null {
    if (!this.win.isFull()) {
      if (this.win.size() + 1 !== this.period) return null;
      // Completaria a janela: soma ponderada com `x` como o mais novo.
      let i = 0;
      const soma = new KahanSum();
      this.win.forEach((v) => {
        i += 1;
        soma.add(v * i);
      });
      soma.add(x * (i + 1));
      return soma.value() / this.denom;
    }
    // Cheia: o mais antigo sai, todos deslizam um peso pra baixo, `x` entra no topo.
    const vals: number[] = [];
    this.win.forEach((v) => vals.push(v));
    const soma = new KahanSum();
    // Descarta vals[0] (o mais antigo); vals[1..] recebem pesos 1..period-1; x recebe period.
    for (let j = 1; j < vals.length; j++) soma.add((vals[j] as number) * j);
    soma.add(x * this.period);
    return soma.value() / this.denom;
  }

  reset(): void {
    this.win.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabricas simples de media (uma fonte -> um escalar)
// ─────────────────────────────────────────────────────────────────────────────

type ScalarSmoother = { push(x: number): number | null; peek(x: number): number | null; reset(): void };

function makeScalarMaFactory(
  name: string,
  label: string,
  defPeriod: number,
  makeSmoother: (period: number) => ScalarSmoother,
): IndicatorFactory {
  const specs: readonly ParamSpec[] = [periodSpec(defPeriod), sourceSpec];
  const meta: IndicatorMeta = {
    name,
    label,
    category: 'trend',
    params: specs,
    outputs: [{ key: 'value', label, plot: 'line', pane: 'price' }],
    warmup: (p) => Math.round(numParam(p, periodSpec(defPeriod))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, periodSpec(defPeriod))));
      const source = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const sm = makeSmoother(period);
        return {
          onUpdate: (bar: IndicatorBar) => scalar(sm.push(priceOf(bar, source))),
          onPreview: (bar: IndicatorBar) => scalar(sm.peek(priceOf(bar, source))),
          onReset: () => sm.reset(),
        };
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMA / TEMA — cascatas de EMA que cancelam atraso
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DEMA = 2*e1 - e2, onde e1 = EMA(preco) e e2 = EMA(e1).
 *
 * ⚠️ e2 so tem valor quando e1 ja emite E a EMA de e1 encheu o proprio seed.
 * Enquanto uma das duas aquece, o DEMA e null (aquecendo, nunca zero). O warmup
 * efetivo e ~2*period-1: e1 leva `period`, e2 leva outros `period-1` sobre e1.
 */
class DemaState {
  private readonly e1: EmaState;
  private readonly e2: EmaState;
  constructor(period: number) {
    this.e1 = new EmaState(period);
    this.e2 = new EmaState(period);
  }
  push(x: number): number | null {
    const a = this.e1.push(x);
    if (a === null) return null;
    const b = this.e2.push(a);
    if (b === null) return null;
    return 2 * a - b;
  }
  peek(x: number): number | null {
    const a = this.e1.peek(x);
    if (a === null) return null;
    const b = this.e2.peek(a);
    if (b === null) return null;
    return 2 * a - b;
  }
  reset(): void {
    this.e1.reset();
    this.e2.reset();
  }
}

/**
 * TEMA = 3*e1 - 3*e2 + e3, com e1=EMA(x), e2=EMA(e1), e3=EMA(e2).
 * Warmup efetivo ~3*period-2.
 */
class TemaState {
  private readonly e1: EmaState;
  private readonly e2: EmaState;
  private readonly e3: EmaState;
  constructor(period: number) {
    this.e1 = new EmaState(period);
    this.e2 = new EmaState(period);
    this.e3 = new EmaState(period);
  }
  push(x: number): number | null {
    const a = this.e1.push(x);
    if (a === null) return null;
    const b = this.e2.push(a);
    if (b === null) return null;
    const c = this.e3.push(b);
    if (c === null) return null;
    return 3 * a - 3 * b + c;
  }
  peek(x: number): number | null {
    const a = this.e1.peek(x);
    if (a === null) return null;
    const b = this.e2.peek(a);
    if (b === null) return null;
    const c = this.e3.peek(b);
    if (c === null) return null;
    return 3 * a - 3 * b + c;
  }
  reset(): void {
    this.e1.reset();
    this.e2.reset();
    this.e3.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// As fabricas exportadas
// ─────────────────────────────────────────────────────────────────────────────

export const smaFactory: IndicatorFactory = makeScalarMaFactory(
  'sma',
  'Media Movel Simples',
  20,
  (p) => new SmaState(p),
);

export const emaFactory: IndicatorFactory = makeScalarMaFactory(
  'ema',
  'Media Movel Exponencial',
  20,
  (p) => new EmaState(p),
);

export const wmaFactory: IndicatorFactory = makeScalarMaFactory(
  'wma',
  'Media Movel Ponderada',
  20,
  (p) => new WmaState(p),
);

/**
 * RMA usa a suavizacao de Wilder (k=1/period), exposta como media por
 * completude. E a mesma media interna do RSI/ATR/ADX — nomeada aqui para quem
 * quiser plota-la sozinha.
 */
export const rmaFactory: IndicatorFactory = makeScalarMaFactory(
  'rma',
  'Media de Wilder (RMA)',
  14,
  (p) => new WilderState(p),
);

export const demaFactory: IndicatorFactory = makeScalarMaFactory(
  'dema',
  'Media Movel Dupla Exponencial',
  20,
  (p) => new DemaState(p),
);

export const temaFactory: IndicatorFactory = makeScalarMaFactory(
  'tema',
  'Media Movel Tripla Exponencial',
  20,
  (p) => new TemaState(p),
);
