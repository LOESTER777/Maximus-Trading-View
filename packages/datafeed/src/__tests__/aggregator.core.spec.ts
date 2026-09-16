/**
 * aggregator.core — agregacao pura de trades em barras, e rollup de barras.
 *
 * O que estes testes protegem:
 *  - `aggregateTrades` produz OHLCV correto e determinismo, com a fronteira de
 *    balde semiaberta `[inicio, fim)` — o trade da virada vai para o balde
 *    seguinte, nunca para os dois;
 *  - `rollupBars` conserva OHLC pela definicao classica (open da primeira, high
 *    o maior, low o menor, close da ultima, volume a soma), provado com
 *    fast-check;
 *  - as duas funcoes sao PURAS: sem rede, sem relogio, entrada igual = saida
 *    igual.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { aggregateTrades, rollupBars, type Trade } from '../aggregator.core.js';
import type { Bar } from '../contracts.js';

const NUM_RUNS = 400;
const SEED = 20260830;

// ═════════════════════════════════════════════════════════════════════════════
// aggregateTrades — exemplos
// ═════════════════════════════════════════════════════════════════════════════

describe('aggregateTrades — OHLCV por balde', () => {
  it('monta uma barra a partir de trades do mesmo balde', () => {
    const trades: Trade[] = [
      { time: 60, price: 100, size: 1 },
      { time: 75, price: 105, size: 2 },
      { time: 90, price: 98, size: 3 },
      { time: 110, price: 102, size: 1 },
    ];
    const barras = aggregateTrades(trades, 60); // balde [60,120)

    expect(barras.length).toBe(1);
    expect(barras[0]).toEqual({
      time: 60, // inicio do balde, alinhado ao epoch
      open: 100, // primeiro em tempo
      high: 105,
      low: 98,
      close: 102, // ultimo em tempo
      volume: 7,
    });
  });

  it('alinha o balde ao epoch, nao ao primeiro trade', () => {
    // Primeiro trade em 305, passo 60: o balde e [300,360), com time 300.
    const barras = aggregateTrades([{ time: 305, price: 10 }], 60);
    expect(barras[0]?.time).toBe(300);
  });

  it('a fronteira e semiaberta: o trade da virada vai para o proximo balde', () => {
    const trades: Trade[] = [
      { time: 59, price: 1, size: 1 },
      { time: 60, price: 2, size: 1 }, // exatamente a virada -> balde [60,120)
    ];
    const barras = aggregateTrades(trades, 60);
    expect(barras.length).toBe(2);
    expect(barras[0]?.time).toBe(0);
    expect(barras[1]?.time).toBe(60);
    // Cada volume aparece uma vez so — nada duplicado na fronteira.
    expect((barras[0]?.volume ?? 0) + (barras[1]?.volume ?? 0)).toBe(2);
  });

  it('open/close respeitam o tempo, mesmo com trades fora de ordem', () => {
    const trades: Trade[] = [
      { time: 90, price: 3 },
      { time: 60, price: 1 }, // este e o primeiro em tempo
      { time: 110, price: 5 }, // este e o ultimo em tempo
      { time: 75, price: 2 },
    ];
    const barras = aggregateTrades(trades, 60);
    expect(barras[0]?.open).toBe(1);
    expect(barras[0]?.close).toBe(5);
  });

  it('as barras saem ordenadas por time, ainda que os trades cheguem embaralhados', () => {
    const trades: Trade[] = [
      { time: 200, price: 1 },
      { time: 20, price: 1 },
      { time: 130, price: 1 },
    ];
    const barras = aggregateTrades(trades, 60);
    expect(barras.map((b) => b.time)).toEqual([0, 120, 180]);
  });

  it('omite volume quando NENHUM trade do balde trouxe size — ausencia e "nao sei"', () => {
    const barras = aggregateTrades([{ time: 1, price: 10 }, { time: 2, price: 11 }], 60);
    expect(barras[0]).not.toHaveProperty('volume');
    expect(barras[0]).not.toHaveProperty('buyVolume');
  });

  it('separa buyVolume e sellVolume por lado do agressor', () => {
    const trades: Trade[] = [
      { time: 1, price: 10, size: 2, side: 'buy' },
      { time: 2, price: 10, size: 3, side: 'sell' },
      { time: 3, price: 10, size: 1, side: 'buy' },
    ];
    const barras = aggregateTrades(trades, 60);
    expect(barras[0]?.buyVolume).toBe(3);
    expect(barras[0]?.sellVolume).toBe(3);
    expect(barras[0]?.volume).toBe(6);
  });

  it('descarta trade com time ou price nao-finito, sem contaminar o balde', () => {
    const trades: Trade[] = [
      { time: 1, price: 10, size: 1 },
      { time: Number.NaN, price: 10, size: 1 },
      { time: 2, price: Number.POSITIVE_INFINITY, size: 1 },
    ];
    const barras = aggregateTrades(trades, 60);
    expect(barras.length).toBe(1);
    expect(barras[0]?.open).toBe(10);
    expect(barras[0]?.volume).toBe(1);
  });

  it('passo invalido devolve serie vazia', () => {
    expect(aggregateTrades([{ time: 1, price: 1 }], 0)).toEqual([]);
    expect(aggregateTrades([{ time: 1, price: 1 }], -60)).toEqual([]);
    expect(aggregateTrades([{ time: 1, price: 1 }], 60.5)).toEqual([]);
    expect(aggregateTrades([{ time: 1, price: 1 }], Number.NaN)).toEqual([]);
  });

  it('entrada vazia devolve serie vazia', () => {
    expect(aggregateTrades([], 60)).toEqual([]);
  });

  it('e deterministico: a mesma entrada produz a mesma saida', () => {
    const trades: Trade[] = [
      { time: 90, price: 3, size: 1, side: 'buy' },
      { time: 60, price: 1, size: 2, side: 'sell' },
      { time: 130, price: 5, size: 1 },
    ];
    expect(aggregateTrades(trades, 60)).toEqual(aggregateTrades(trades, 60));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// rollupBars — exemplos
// ═════════════════════════════════════════════════════════════════════════════

describe('rollupBars — M1 -> M5', () => {
  it('agrupa cinco M1 num M5 conservando OHLC', () => {
    const m1: Bar[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 },
      { time: 60, open: 11, high: 15, low: 10, close: 14, volume: 2 },
      { time: 120, open: 14, high: 14, low: 8, close: 9, volume: 3 },
      { time: 180, open: 9, high: 13, low: 9, close: 12, volume: 4 },
      { time: 240, open: 12, high: 16, low: 11, close: 13, volume: 5 },
    ];
    const m5 = rollupBars(m1, 60, 300);

    expect(m5.length).toBe(1);
    expect(m5[0]).toEqual({
      time: 0,
      open: 10, // open da primeira
      high: 16, // maior high
      low: 8, // menor low
      close: 13, // close da ultima
      volume: 15, // soma
    });
  });

  it('respeita a fronteira do balde maior', () => {
    const m1: Bar[] = [
      { time: 240, open: 1, high: 1, low: 1, close: 1 }, // balde M5 [0,300)
      { time: 300, open: 2, high: 2, low: 2, close: 2 }, // balde M5 [300,600)
    ];
    const m5 = rollupBars(m1, 60, 300);
    expect(m5.map((b) => b.time)).toEqual([0, 300]);
  });

  it('nao inventa barra para balde sem origem — buraco vira buraco', () => {
    const m1: Bar[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1 },
      // pula o balde [300,600)
      { time: 600, open: 2, high: 2, low: 2, close: 2 },
    ];
    const m5 = rollupBars(m1, 60, 300);
    expect(m5.map((b) => b.time)).toEqual([0, 600]);
  });

  it('reordena barras de origem fora de ordem', () => {
    const m1: Bar[] = [
      { time: 120, open: 3, high: 4, low: 2, close: 3 },
      { time: 0, open: 1, high: 2, low: 1, close: 2 },
      { time: 60, open: 2, high: 3, low: 1, close: 3 },
    ];
    const m5 = rollupBars(m1, 60, 300);
    expect(m5[0]?.open).toBe(1); // da barra de time 0
    expect(m5[0]?.close).toBe(3); // da barra de time 120
  });

  it('toStep nao-multiplo de fromStep devolve vazio', () => {
    const m1: Bar[] = [{ time: 0, open: 1, high: 1, low: 1, close: 1 }];
    expect(rollupBars(m1, 60, 420 + 1)).toEqual([]); // 421 nao e multiplo de 60
  });

  it('toStep menor que fromStep devolve vazio', () => {
    const m5: Bar[] = [{ time: 0, open: 1, high: 1, low: 1, close: 1 }];
    expect(rollupBars(m5, 300, 60)).toEqual([]);
  });

  it('fromStep === toStep e identidade util (reamostra por balde)', () => {
    const m1: Bar[] = [
      { time: 0, open: 1, high: 2, low: 1, close: 2, volume: 3 },
      { time: 60, open: 2, high: 3, low: 2, close: 3, volume: 4 },
    ];
    const r = rollupBars(m1, 60, 60);
    expect(r).toEqual(m1);
  });

  it('omite volume quando nenhuma barra de origem trouxe volume', () => {
    const m1: Bar[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1 },
      { time: 60, open: 1, high: 1, low: 1, close: 1 },
    ];
    expect(rollupBars(m1, 60, 300)[0]).not.toHaveProperty('volume');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// rollupBars — propriedades (fast-check)
// ═════════════════════════════════════════════════════════════════════════════

/** Preco finito num intervalo util para nao mascarar erro de min/max. */
const arbPreco = fc.double({ min: -1e6, max: 1e6, noNaN: true });

/** Uma barra de M1, com OHLC coerente (low <= open,close <= high). */
function arbM1(time: number): fc.Arbitrary<Bar> {
  return fc.tuple(arbPreco, arbPreco, arbPreco, arbPreco).map(([a, b, c, d]) => {
    const valores = [a, b, c, d];
    const high = Math.max(...valores);
    const low = Math.min(...valores);
    return {
      time,
      open: a,
      high,
      low,
      close: d,
      volume: 0, // sobrescrito no gerador de serie quando quiser volume
    };
  });
}

/**
 * Uma serie CONTIGUA de N barras M1 comecando num balde M5 alinhado.
 *
 * Contigua e alinhada de proposito: para que TODAS caiam no mesmo balde M5 e a
 * conservacao possa ser afirmada contra a serie inteira, sem o teste ter de
 * reproduzir o agrupamento (o que aproximaria oraculo de implementacao).
 */
const arbSerieDeUmBalde: fc.Arbitrary<{ m1: Bar[]; fromStep: number; ratio: number }> = fc
  .record({
    fromStep: fc.constantFrom(60, 300),
    ratio: fc.integer({ min: 1, max: 12 }),
    baldeIndex: fc.integer({ min: 0, max: 1000 }),
    n: fc.integer({ min: 1, max: 12 }),
    volumes: fc.array(fc.double({ min: 0, max: 1e5, noNaN: true }), { minLength: 1, maxLength: 12 }),
  })
  .chain(({ fromStep, ratio, baldeIndex, n, volumes }) => {
    const toStep = fromStep * ratio;
    const inicioM5 = baldeIndex * toStep;
    const quantas = Math.min(n, ratio); // no maximo `ratio` barras cabem no balde
    const times = Array.from({ length: quantas }, (_, i) => inicioM5 + i * fromStep);
    return fc.tuple(...times.map((t) => arbM1(t))).map((barras) => ({
      m1: barras.map((b, i) => ({ ...b, volume: volumes[i % volumes.length] ?? 0 })),
      fromStep,
      ratio,
    }));
  });

describe('rollupBars — conservacao de OHLC (fast-check)', () => {
  it('open=primeiro, high=max, low=min, close=ultimo, volume=soma', () => {
    fc.assert(
      fc.property(arbSerieDeUmBalde, ({ m1, fromStep, ratio }) => {
        const toStep = fromStep * ratio;
        const r = rollupBars(m1, fromStep, toStep);

        // Todas as barras estao no mesmo balde por construcao.
        expect(r.length).toBe(1);
        const barra = r[0]!;

        const emTempo = [...m1].sort((a, b) => a.time - b.time);
        const primeira = emTempo[0]!;
        const ultima = emTempo[emTempo.length - 1]!;

        expect(barra.open).toBe(primeira.open);
        expect(barra.close).toBe(ultima.close);
        expect(barra.high).toBe(Math.max(...m1.map((b) => b.high)));
        expect(barra.low).toBe(Math.min(...m1.map((b) => b.low)));

        const somaVol = m1.reduce((s, b) => s + (b.volume ?? 0), 0);
        expect(barra.volume).toBeCloseTo(somaVol, 6);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('rollup direto M1->M15 iguala rollup encadeado M1->M5->M15 (associatividade)', () => {
    // O balde M15 alinhado tem no maximo 15 M1; geramos ate 15 contiguas.
    const arb = fc
      .record({
        baldeIndex: fc.integer({ min: 0, max: 500 }),
        n: fc.integer({ min: 1, max: 15 }),
        specs: fc.array(fc.tuple(arbPreco, arbPreco, arbPreco, arbPreco), {
          minLength: 15,
          maxLength: 15,
        }),
        vols: fc.array(fc.double({ min: 0, max: 1e4, noNaN: true }), {
          minLength: 15,
          maxLength: 15,
        }),
      })
      .map(({ baldeIndex, n, specs, vols }) => {
        const inicio = baldeIndex * 900; // M15 = 900s
        const m1: Bar[] = [];
        for (let i = 0; i < n; i += 1) {
          const [a, b, c, d] = specs[i]!;
          m1.push({
            time: inicio + i * 60,
            open: a,
            high: Math.max(a, b, c, d),
            low: Math.min(a, b, c, d),
            close: d,
            volume: vols[i]!,
          });
        }
        return m1;
      });

    fc.assert(
      fc.property(arb, (m1) => {
        const direto = rollupBars(m1, 60, 900);
        const encadeado = rollupBars(rollupBars(m1, 60, 300), 300, 900);

        expect(encadeado.length).toBe(direto.length);
        if (direto.length === 0) return;
        const a = direto[0]!;
        const b = encadeado[0]!;
        expect(b.time).toBe(a.time);
        expect(b.open).toBe(a.open);
        expect(b.close).toBe(a.close);
        expect(b.high).toBe(a.high);
        expect(b.low).toBe(a.low);
        expect(b.volume ?? 0).toBeCloseTo(a.volume ?? 0, 6);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// aggregateTrades — propriedade de conservacao de volume
// ═════════════════════════════════════════════════════════════════════════════

describe('aggregateTrades — conservacao (fast-check)', () => {
  it('a soma de volume das barras iguala a soma de size dos trades', () => {
    const arbTrade = fc.record({
      time: fc.integer({ min: 0, max: 100_000 }),
      price: fc.double({ min: 0.01, max: 1e5, noNaN: true }),
      size: fc.double({ min: 0, max: 1e4, noNaN: true }),
      side: fc.constantFrom<'buy' | 'sell' | undefined>('buy', 'sell', undefined),
    });

    fc.assert(
      fc.property(
        fc.array(arbTrade, { minLength: 0, maxLength: 200 }),
        fc.constantFrom(60, 300, 900),
        (trades, step) => {
          const barras = aggregateTrades(trades, step);

          const somaBarras = barras.reduce((s, b) => s + (b.volume ?? 0), 0);
          const somaTrades = trades.reduce((s, t) => s + (t.size ?? 0), 0);
          expect(somaBarras).toBeCloseTo(somaTrades, 5);

          // buy + sell tambem conserva quando ha lado.
          const somaBuy = barras.reduce((s, b) => s + (b.buyVolume ?? 0), 0);
          const somaSell = barras.reduce((s, b) => s + (b.sellVolume ?? 0), 0);
          const tradesBuy = trades
            .filter((t) => t.side === 'buy')
            .reduce((s, t) => s + (t.size ?? 0), 0);
          const tradesSell = trades
            .filter((t) => t.side === 'sell')
            .reduce((s, t) => s + (t.size ?? 0), 0);
          expect(somaBuy).toBeCloseTo(tradesBuy, 5);
          expect(somaSell).toBeCloseTo(tradesSell, 5);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('cada trade cai em exatamente um balde (fronteira semiaberta)', () => {
    const arbTrade = fc.record({
      time: fc.integer({ min: 0, max: 100_000 }),
      price: fc.double({ min: 0.01, max: 1e5, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(arbTrade, { minLength: 1, maxLength: 100 }),
        fc.constantFrom(60, 300),
        (trades, step) => {
          const barras = aggregateTrades(trades, step);
          // Cada barra cobre [time, time+step); os intervalos nao se sobrepoem e
          // todo trade tem um balde. Verifica que todo trade cai numa barra.
          for (const t of trades) {
            const inicio = Math.floor(t.time / step) * step;
            const encontrada = barras.find((b) => b.time === inicio);
            expect(encontrada, `trade em ${t.time} deveria estar no balde ${inicio}`).toBeDefined();
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
