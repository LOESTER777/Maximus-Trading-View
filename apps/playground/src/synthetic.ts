/**
 * synthetic — dado de mercado SINTETICO para o playground.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nao ha feed local. Para ver a biblioteca funcionando sem backend, o playground
 * gera velas, volume e uma grade de profundidade (o insumo do bookmap) com uma
 * caminhada aleatoria DETERMINISTICA — mesma semente, mesmo dado a cada carga, para
 * o que aparece na tela ser reproduzivel entre execucoes.
 *
 * ⚠️ Isto NAO e o formato de um provedor real. E o suficiente para exercitar a
 * projecao, a escala de cor e o hit-test. Dado real entra pela camada `datafeed`,
 * que nao e problema do playground.
 */
import type { BookmapDepthColunar } from '@robustus/charts-core';

/** Gerador pseudoaleatorio deterministico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SyntheticBundle {
  candles: SyntheticCandle[];
  volume: Array<{ time: number; value: number; color: string }>;
  depth: BookmapDepthColunar;
  tickSize: number;
}

const UP = '#16c784';
const DOWN = '#ea3943';

/**
 * Gera um pregao sintetico.
 *
 * @param bars     quantas velas
 * @param stepSec  duracao de cada vela em segundos (300 = M5)
 * @param seed     semente; mesma semente, mesmo pregao
 */
export function makeSyntheticBundle(bars = 240, stepSec = 300, seed = 42): SyntheticBundle {
  const rand = rng(seed);
  const tickSize = 5;
  const inicio = Math.floor(Date.now() / 1000 / stepSec) * stepSec - bars * stepSec;

  const candles: SyntheticCandle[] = [];
  const volume: SyntheticBundle['volume'] = [];

  let preco = 130_000;

  for (let i = 0; i < bars; i++) {
    const t = inicio + i * stepSec;
    const drift = (rand() - 0.5) * 120;
    const open = preco;
    const close = quantiza(open + drift, tickSize);
    const high = quantiza(Math.max(open, close) + rand() * 80, tickSize);
    const low = quantiza(Math.min(open, close) - rand() * 80, tickSize);
    candles.push({ time: t, open, high, low, close });
    volume.push({
      time: t,
      value: Math.round(200 + rand() * 3000),
      color: close >= open ? UP : DOWN,
    });
    preco = close;
  }

  const depth = makeDepthGrid(candles, stepSec, tickSize, rand);

  return { candles, volume, depth, tickSize };
}

/**
 * ⭐ Gera velas ANTERIORES a `antesDe` — o insumo do backfill de historico.
 *
 * Existe para o playground poder exercitar `useHistoryBackfill` sem backend: quando o
 * operador arrasta para tras e chega na borda, este e o "provedor" que responde.
 *
 * ⚠️ Caminha para TRAS no tempo mas monta o array em ordem CRESCENTE, que e o que o
 * motor exige. Gerar de tras para frente e depois inverter e o unico jeito de o preco
 * "chegar" continuo na primeira vela ja existente — encadear para a frente a partir de
 * um preco arbitrario deixaria um salto visivel na junta.
 *
 * A semente deriva de `antesDe`, entao pedir o mesmo trecho duas vezes devolve as
 * mesmas velas: o playground continua determinístico.
 */
export function makeOlderCandles(
  antesDe: number,
  quantas: number,
  stepSec: number,
  precoDeChegada: number,
): { candles: SyntheticCandle[]; volume: SyntheticBundle['volume'] } {
  const rand = rng(Math.abs(Math.floor(antesDe)) % 2_147_483_647);
  const tickSize = 5;

  const candles: SyntheticCandle[] = [];
  const volume: SyntheticBundle['volume'] = [];

  let preco = precoDeChegada;
  for (let k = 1; k <= quantas; k++) {
    const t = antesDe - k * stepSec;
    // O `close` desta vela e o `open` da seguinte (que ja existe): continuidade.
    const close = preco;
    const open = quantiza(close - (rand() - 0.5) * 120, tickSize);
    const high = quantiza(Math.max(open, close) + rand() * 80, tickSize);
    const low = quantiza(Math.min(open, close) - rand() * 80, tickSize);
    candles.push({ time: t, open, high, low, close });
    volume.push({
      time: t,
      value: Math.round(200 + rand() * 3000),
      color: close >= open ? UP : DOWN,
    });
    preco = open;
  }

  // Do mais antigo para o mais recente.
  candles.reverse();
  volume.reverse();
  return { candles, volume };
}

function quantiza(preco: number, tick: number): number {
  return Math.round(preco / tick) * tick;
}

/**
 * Monta a grade colunar de profundidade a partir das velas.
 *
 * O formato e o mesmo que `decodeColumnar` do core espera: eixos de tempo e preco
 * mais seis colunas (indice de tempo, indice de preco, fila bid, fila ask,
 * execucao compra, execucao venda). Fila com um pico ocasional para o heatmap ter
 * "paredes" visiveis.
 */
function makeDepthGrid(
  candles: readonly SyntheticCandle[],
  stepSec: number,
  tickSize: number,
  rand: () => number,
): BookmapDepthColunar {
  const precoMin = quantiza(Math.min(...candles.map((c) => c.low)) - 10 * tickSize, tickSize);
  const precoMax = quantiza(Math.max(...candles.map((c) => c.high)) + 10 * tickSize, tickSize);

  const precos: number[] = [];
  for (let p = precoMin; p <= precoMax; p += tickSize) precos.push(p);

  const tempos = candles.map((c) => c.time);

  const ti: number[] = [];
  const pi: number[] = [];
  const b: number[] = [];
  const a: number[] = [];
  const cc: number[] = [];
  const vv: number[] = [];

  for (let it = 0; it < candles.length; it++) {
    const vela = candles[it];
    if (vela === undefined) continue;
    for (let ip = 0; ip < precos.length; ip++) {
      const p = precos[ip] as number;
      // Fila concentrada perto do preco da vela, esparsa longe dele.
      const dist = Math.abs(p - vela.close) / tickSize;
      const base = Math.max(0, 900 - dist * 40);
      if (base <= 0 && rand() > 0.15) continue;

      const bid = p < vela.close ? Math.round(base + rand() * 200) : Math.round(rand() * 120);
      const ask = p > vela.close ? Math.round(base + rand() * 200) : Math.round(rand() * 120);
      // Parede ocasional: pico muito acima do p99, como acontece em nivel cruzado.
      const parede = rand() > 0.994 ? Math.round(8000 + rand() * 20000) : 0;

      ti.push(it);
      pi.push(ip);
      b.push(bid + (p < vela.close ? parede : 0));
      a.push(ask + (p > vela.close ? parede : 0));
      // Execucao so onde a vela negociou (entre low e high).
      const negociou = p >= vela.low && p <= vela.high;
      cc.push(negociou ? Math.round(rand() * 400) : 0);
      vv.push(negociou ? Math.round(rand() * 400) : 0);
    }
  }

  return {
    formato: 'colunar',
    symbol: 'SYNTH',
    fonte: 'MT5_L2',
    de: new Date((tempos[0] ?? 0) * 1000).toISOString().slice(0, 10),
    baldeSeg: stepSec,
    nivel: 'PROFUNDIDADE',
    celulas: ti.length,
    eixos: { t: tempos, p: precos },
    colunas: { ti, pi, b, a, c: cc, v: vv },
    cobertura: null,
  };
}
