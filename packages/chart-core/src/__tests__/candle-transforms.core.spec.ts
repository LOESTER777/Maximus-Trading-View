/**
 * candle-transforms.core — Heikin-Ashi, Renko e o brick automatico.
 *
 * Duas frentes: casos conhecidos calculados A MAO (a formula tem de bater no
 * numero, nao so "parecer certa") e propriedades com fast-check (as invariantes
 * valem para QUALQUER serie, nao so os exemplos escolhidos). O que importa provar:
 *
 *  - Heikin-Ashi: a formula exata numa serie pequena; e que o range HA contem
 *    sempre o corpo HA (haHigh >= max(haOpen,haClose), haLow <= min).
 *  - Renko: N*brickSize monotonico gera N tijolos; reverter exige 2*brickSize;
 *    determinismo; nunca lanca nem entra em laco com brick invalido.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { heikinAshi, renko, brickSizeAutomatico } from '../candle-transforms.core.js';
import type { CandlestickData } from '../contracts.js';

/** Vela de conveniencia; `time` cresce com o indice para manter ordem. */
function vela(i: number, o: number, h: number, l: number, c: number): CandlestickData {
  return { time: 1000 + i * 60, open: o, high: h, low: l, close: c };
}

// ═════════════════════════════════════════════════════════════════════════════
// Heikin-Ashi — caso conhecido
// ═════════════════════════════════════════════════════════════════════════════

describe('heikinAshi — formula exata', () => {
  it('bate no numero para uma serie pequena calculada a mao', () => {
    const entrada: CandlestickData[] = [
      vela(0, 10, 15, 9, 14),
      vela(1, 14, 18, 13, 17),
      vela(2, 17, 19, 12, 13),
    ];
    const ha = heikinAshi(entrada);
    expect(ha).toHaveLength(3);

    // Barra 0: haClose=(10+15+9+14)/4=12; haOpen=(10+14)/2=12 (semente);
    // haHigh=max(15,12,12)=15; haLow=min(9,12,12)=9.
    expect(ha[0]).toMatchObject({ open: 12, high: 15, low: 9, close: 12, time: 1000 });

    // Barra 1: haClose=(14+18+13+17)/4=15.5; haOpen=(12+12)/2=12;
    // haHigh=max(18,12,15.5)=18; haLow=min(13,12,15.5)=12.
    expect(ha[1]).toMatchObject({ open: 12, high: 18, low: 12, close: 15.5 });

    // Barra 2: haClose=(17+19+12+13)/4=15.25; haOpen=(12+15.5)/2=13.75;
    // haHigh=max(19,13.75,15.25)=19; haLow=min(12,13.75,15.25)=12.
    expect(ha[2]).toMatchObject({ open: 13.75, high: 19, low: 12, close: 15.25 });
  });

  it('descarta vela com NaN sem lancar e sem contaminar a recursao', () => {
    const entrada: CandlestickData[] = [
      vela(0, 10, 15, 9, 14),
      { time: 1060, open: NaN, high: 18, low: 13, close: 17 },
      vela(2, 17, 19, 12, 13),
    ];
    const ha = heikinAshi(entrada);
    // A do meio some; sobram duas, e o haOpen da terceira usa a PRIMEIRA como
    // anterior (nao o NaN).
    expect(ha).toHaveLength(2);
    expect(ha.every((c) => Number.isFinite(c.open) && Number.isFinite(c.close))).toBe(true);
  });

  it('serie vazia devolve serie vazia', () => {
    expect(heikinAshi([])).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Heikin-Ashi — propriedade: o range contem o corpo
// ═════════════════════════════════════════════════════════════════════════════

/** Gera uma serie de velas finitas e coerentes (high>=low, corpo dentro). */
const arbSerie = fc.array(
  fc
    .record({
      base: fc.double({ min: 1, max: 1e5, noNaN: true }),
      span: fc.double({ min: 0, max: 1e4, noNaN: true }),
      fo: fc.double({ min: 0, max: 1, noNaN: true }),
      fc_: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ base, span, fo, fc_ }) => {
      const low = base;
      const high = base + span;
      const open = low + fo * span;
      const close = low + fc_ * span;
      return { open, high, low, close };
    }),
  { minLength: 1, maxLength: 60 },
).map((rows) => rows.map((r, i) => vela(i, r.open, r.high, r.low, r.close)));

describe('heikinAshi — propriedade do range', () => {
  it('haHigh >= max(haOpen,haClose) e haLow <= min(haOpen,haClose)', () => {
    fc.assert(
      fc.property(arbSerie, (serie) => {
        const ha = heikinAshi(serie);
        for (const c of ha) {
          const topo = Math.max(c.open, c.close);
          const base = Math.min(c.open, c.close);
          // Folga de ponto flutuante minima.
          expect(c.high).toBeGreaterThanOrEqual(topo - 1e-9);
          expect(c.low).toBeLessThanOrEqual(base + 1e-9);
        }
      }),
    );
  });

  it('e determinista: mesma entrada, mesma saida', () => {
    fc.assert(
      fc.property(arbSerie, (serie) => {
        expect(heikinAshi(serie)).toEqual(heikinAshi(serie));
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Renko
// ═════════════════════════════════════════════════════════════════════════════

/** Serie cujo close segue exatamente a lista dada. */
function serieDeCloses(closes: number[]): CandlestickData[] {
  return closes.map((c, i) => vela(i, c, c, c, c));
}

describe('renko — regra de tijolo', () => {
  it('um movimento monotonico de N*brickSize gera N tijolos', () => {
    // Semente em 100; sobe ate 105 com brick 1 => 5 tijolos.
    const serie = serieDeCloses([100, 101, 102, 103, 104, 105]);
    const tijolos = renko(serie, 1);
    expect(tijolos).toHaveLength(5);
    // Todos de alta: close > open, bordas consecutivas.
    expect(tijolos.map((t) => t.close)).toEqual([101, 102, 103, 104, 105]);
    expect(tijolos.every((t) => t.close > t.open)).toBe(true);
  });

  it('um salto unico de N*brickSize numa barra gera N tijolos de uma vez', () => {
    const serie = serieDeCloses([100, 103]); // salto de 3 com brick 1
    const tijolos = renko(serie, 1);
    expect(tijolos).toHaveLength(3);
    expect(tijolos.map((t) => t.close)).toEqual([101, 102, 103]);
  });

  it('reverter exige 2*brickSize: 1*brickSize contra a tendencia nao inverte', () => {
    // Sobe para 102 (2 tijolos de alta), depois cai so 1 brick (para 101):
    // NAO deve gerar tijolo de baixa.
    const soUm = renko(serieDeCloses([100, 101, 102, 101]), 1);
    expect(soUm).toHaveLength(2); // so os dois de alta

    // Agora cai 2 bricks a partir de 102 (para 100): reverte, gera 1 tijolo baixa.
    const doisBricks = renko(serieDeCloses([100, 101, 102, 100]), 1);
    expect(doisBricks).toHaveLength(3);
    const ultimo = doisBricks[2]!;
    expect(ultimo.close).toBeLessThan(ultimo.open); // tijolo de baixa
    // Reversao para baixo: abre na borda oposta do tijolo de alta corrente
    // (102-1=101) e fecha um brick abaixo (100).
    expect(ultimo.open).toBe(101);
    expect(ultimo.close).toBe(100);
  });

  it('brickSize invalido devolve [] sem lancar nem laco infinito', () => {
    const serie = serieDeCloses([100, 110, 120]);
    expect(renko(serie, 0)).toEqual([]);
    expect(renko(serie, -1)).toEqual([]);
    expect(renko(serie, NaN)).toEqual([]);
    expect(renko(serie, Infinity)).toEqual([]);
  });

  it('e determinista para a mesma serie e o mesmo brick', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 80 }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (closes, brick) => {
          const serie = serieDeCloses(closes);
          expect(renko(serie, brick)).toEqual(renko(serie, brick));
        },
      ),
    );
  });

  it('cada tijolo tem corpo de exatamente um brick (sem pavio)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 80 }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (closes, brick) => {
          const tijolos = renko(serieDeCloses(closes), brick);
          for (const t of tijolos) {
            expect(Math.abs(Math.abs(t.close - t.open) - brick)).toBeLessThan(1e-6);
            // high/low coincidem com as bordas do corpo.
            expect(t.high).toBeCloseTo(Math.max(t.open, t.close), 6);
            expect(t.low).toBeCloseTo(Math.min(t.open, t.close), 6);
          }
        },
      ),
    );
  });
});

describe('brickSizeAutomatico', () => {
  it('deriva a fracao do ultimo close valido', () => {
    const serie = serieDeCloses([100, 200, 500]);
    expect(brickSizeAutomatico(serie, 0.01)).toBeCloseTo(5, 9); // 500 * 0.01
  });

  it('devolve null quando nao ha close valido (nunca zero)', () => {
    expect(brickSizeAutomatico([])).toBeNull();
    expect(brickSizeAutomatico(serieDeCloses([0, 0]))).toBeNull();
    const soNaN: CandlestickData[] = [{ time: 1, open: NaN, high: NaN, low: NaN, close: NaN }];
    expect(brickSizeAutomatico(soNaN)).toBeNull();
  });

  it('fracao invalida devolve null', () => {
    const serie = serieDeCloses([100]);
    expect(brickSizeAutomatico(serie, 0)).toBeNull();
    expect(brickSizeAutomatico(serie, -0.1)).toBeNull();
    expect(brickSizeAutomatico(serie, NaN)).toBeNull();
  });
});
