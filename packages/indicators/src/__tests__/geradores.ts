/**
 * geradores — arbitrarios de barra compartilhados pelos testes de propriedade.
 *
 * Uma serie de barras realista o bastante para exercitar os indicadores: tempo
 * estritamente crescente (o contrato recusa barra fora de ordem), OHLC coerente
 * (high >= max(open,close), low <= min(open,close)), volume opcional.
 */
import * as fc from 'fast-check';
import type { IndicatorBar } from '../contracts.js';

/** Uma barra coerente a partir de quatro precos e um passo de tempo. */
function montarBarra(
  time: number,
  a: number,
  b: number,
  c: number,
  d: number,
  volume: number,
): IndicatorBar {
  const open = a;
  const close = b;
  // high/low envolvem open e close mais uma folga (|c|,|d|) para dar range real.
  const high = Math.max(open, close) + Math.abs(c);
  const low = Math.min(open, close) - Math.abs(d);
  return { time, open, high, low, close, volume };
}

/**
 * Serie de barras com tempo crescente. Precos numa faixa modesta (10..200) para
 * nao estourar as somas, mas com variacao suficiente para mover os indicadores.
 * O comprimento vai a 120 para passar folgadamente o warmup do ADX (2*period).
 */
export function arbSerie(minLength = 1, maxLength = 120): fc.Arbitrary<readonly IndicatorBar[]> {
  const arbPreco = fc.double({ min: 10, max: 200, noNaN: true, noDefaultInfinity: true });
  const arbFolga = fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true });
  const arbVol = fc.double({ min: 0, max: 10000, noNaN: true, noDefaultInfinity: true });
  return fc
    .array(fc.tuple(arbPreco, arbPreco, arbFolga, arbFolga, arbVol), { minLength, maxLength })
    .map((linhas) =>
      linhas.map(([a, b, c, d, vol], i) =>
        // Passo de tempo fixo de 60s, base arbitraria: garante ordem estrita.
        montarBarra(1_600_000_000 + i * 60, a, b, c, d, vol),
      ),
    );
}

/** Tolerancia para comparar incremental x batch (do enunciado). */
export const TOL = 1e-6;

/** Compara dois valores de indicador campo a campo, tratando null == null. */
export function valoresQuaseIguais(
  a: Readonly<Record<string, number | null>>,
  b: Readonly<Record<string, number | null>>,
  tol = TOL,
): boolean {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of chaves) {
    const va = a[k] ?? null;
    const vb = b[k] ?? null;
    if (va === null || vb === null) {
      if (va !== vb) return false; // um null e o outro nao
      continue;
    }
    // Tolerancia relativa+absoluta: valores grandes (OBV, VWAP) merecem folga.
    const escala = Math.max(1, Math.abs(va), Math.abs(vb));
    if (Math.abs(va - vb) > tol * escala) return false;
  }
  return true;
}
