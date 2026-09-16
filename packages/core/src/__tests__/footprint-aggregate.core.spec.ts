import { describe, expect, it } from 'vitest';
import {
  agregarFootprint,
  agruparPreco,
  agrupamentoPorZoom,
  desequilibriosDiagonais,
  indiceDaVela,
  resumirFootprint,
  CONFIG_FOOTPRINT_DEFAULT,
  type NivelFootprint,
} from '@robustus/charts-core';
import type { BookmapGrid } from '@robustus/charts-core';

/** Asserção de não-nulo para índice de array sob `noUncheckedIndexedAccess`. */
function naoNulo<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('valor ausente no teste');
  return v;
}

/**
 * O footprint substitui a leitura pobre do `deltaBars` (uma cor + altura =
 * volume total). Estes testes fixam as duas coisas que ele precisa acertar:
 * agregar no balde de tempo certo e não inventar volume.
 */

/** Monta um grid mínimo a partir de células (ts, preço, compra, venda). */
function grid(
  celulas: Array<[number, number, number, number]>,
): BookmapGrid {
  const times = [...new Set(celulas.map((c) => c[0]))].sort((a, b) => a - b);
  const prices = [...new Set(celulas.map((c) => c[1]))].sort((a, b) => a - b);
  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-09-03',
    baldeSeg: 60,
    times: Float64Array.from(times),
    prices: Float64Array.from(prices),
    ti: Uint32Array.from(celulas.map((c) => times.indexOf(c[0]))),
    pi: Uint32Array.from(celulas.map((c) => prices.indexOf(c[1]))),
    bid: Float32Array.from(celulas.map(() => 0)),
    ask: Float32Array.from(celulas.map(() => 0)),
    buy: Float32Array.from(celulas.map((c) => c[2])),
    sell: Float32Array.from(celulas.map((c) => c[3])),
    cobertura: null,
  };
}

const T = 1_788_000_000_000;
const M5 = 300_000;

describe('agregarFootprint — o essencial', () => {
  it('⭐ soma compra e venda por nível dentro da vela', () => {
    const g = grid([
      [T + 1000, 178_500, 340, 12],
      [T + 2000, 178_500, 100, 8],
      [T + 3000, 178_475, 180, 195],
    ]);
    const vela = naoNulo(agregarFootprint(g, [T], CONFIG_FOOTPRINT_DEFAULT)[0]);

    expect(vela.tempo).toBe(T);
    // ordenado por preço CRESCENTE
    expect(vela.niveis.map((x) => x.preco)).toEqual([178_475, 178_500]);
    const alto = naoNulo(vela.niveis[1]);
    expect(alto.compra).toBe(440); // 340 + 100
    expect(alto.venda).toBe(20);   // 12 + 8
    expect(alto.delta).toBe(420);
    expect(alto.total).toBe(460);
    expect(alto.desequilibrio).toBeCloseTo(420 / 460, 10);
  });

  it('⭐ separa em velas diferentes pela fronteira do timeframe', () => {
    const g = grid([
      [T + 10_000, 178_500, 100, 10],
      [T + M5 + 10_000, 178_500, 5, 200],
    ]);
    const velas = agregarFootprint(g, [T, T + M5]);
    expect(velas).toHaveLength(2);
    expect(naoNulo(velas[0]).delta).toBe(90);
    expect(naoNulo(velas[1]).delta).toBe(-195);
  });

  it('⚠️ célula ANTES da 1ª fronteira é descartada, não empurrada', () => {
    // Empurrar inventaria volume numa vela que não o teve.
    const g = grid([
      [T - 60_000, 178_500, 999, 999],
      [T + 1000, 178_500, 10, 5],
    ]);
    const velas = agregarFootprint(g, [T]);
    expect(velas).toHaveLength(1);
    expect(naoNulo(velas[0]).totalCompra).toBe(10);
    expect(naoNulo(velas[0]).totalVenda).toBe(5);
  });

  it('célula só de FILA (sem execução) não entra no footprint', () => {
    const g = grid([[T + 1000, 178_500, 0, 0]]);
    expect(agregarFootprint(g, [T])).toEqual([]);
  });

  it('vela sem execução não aparece na saída (não vira vela vazia)', () => {
    const g = grid([[T + 1000, 178_500, 10, 0]]);
    const velas = agregarFootprint(g, [T, T + M5, T + 2 * M5]);
    expect(velas).toHaveLength(1);
    expect(naoNulo(velas[0]).tempo).toBe(T);
  });

  it('POC é o nível de maior volume TOTAL', () => {
    const g = grid([
      [T + 1000, 178_450, 920, 40],   // total 960 ⇐ POC
      [T + 1000, 178_500, 340, 12],   // total 352
      [T + 1000, 178_425, 310, 22],   // total 332
    ]);
    const vela = naoNulo(agregarFootprint(g, [T])[0]);
    expect(vela.poc).toBe(178_450);
    expect(vela.maiorTotal).toBe(960);
  });

  it('grid nulo ou sem fronteira devolve vazio, não erro', () => {
    expect(agregarFootprint(null, [T])).toEqual([]);
    expect(agregarFootprint(grid([[T, 1, 1, 1]]), [])).toEqual([]);
  });

  it('é determinístico e independente da ordem das células', () => {
    const cs: Array<[number, number, number, number]> = [
      [T + 1000, 178_500, 340, 12],
      [T + 2000, 178_475, 180, 195],
      [T + 3000, 178_450, 920, 40],
    ];
    const a = agregarFootprint(grid(cs), [T]);
    const b = agregarFootprint(grid([...cs].reverse()), [T]);
    expect(b).toEqual(a);
  });
});

describe('agregarFootprint — agrupamento e poda', () => {
  it('agrupa níveis no passo pedido', () => {
    const g = grid([
      [T + 1000, 178_505, 100, 0],
      [T + 1000, 178_512, 50, 0],
      [T + 1000, 178_530, 20, 0],
    ]);
    const vela = naoNulo(agregarFootprint(g, [T], {
      ...CONFIG_FOOTPRINT_DEFAULT, agrupamentoPreco: 25, fracaoMinima: 0,
    })[0]);
    // 178.505 e 178.512 caem em 178.500; 178.530 cai em 178.525
    expect(vela.niveis.map((x) => x.preco)).toEqual([178_500, 178_525]);
    expect(naoNulo(vela.niveis[0]).compra).toBe(150);
  });

  it('⭐ a poda NÃO altera os totais da vela (delta é dado, não desenho)', () => {
    const g = grid([
      [T + 1000, 178_500, 1000, 0],
      [T + 1000, 178_475, 3, 0],   // poeira: 0,3% do maior
    ]);
    const vela = naoNulo(agregarFootprint(g, [T], {
      ...CONFIG_FOOTPRINT_DEFAULT, fracaoMinima: 0.02,
    })[0]);
    expect(vela.niveis).toHaveLength(1);          // poeira sai do desenho
    expect(vela.totalCompra).toBe(1003);          // mas não do total
  });

  it('maxNiveis mantém os de MAIOR volume', () => {
    const cs: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 10; i++) cs.push([T + 1000, 178_000 + i * 25, (i + 1) * 10, 0]);
    const vela = naoNulo(agregarFootprint(grid(cs), [T], {
      ...CONFIG_FOOTPRINT_DEFAULT, fracaoMinima: 0, maxNiveis: 3,
    })[0]);
    expect(vela.niveis).toHaveLength(3);
    // os 3 maiores são i=7,8,9 ⇒ 178.175 / 178.200 / 178.225, em ordem de preço
    expect(vela.niveis.map((x) => x.compra)).toEqual([80, 90, 100]);
  });
});

describe('agruparPreco', () => {
  it('agrupa pelo piso do múltiplo', () => {
    expect(agruparPreco(178_512, 25)).toBe(178_500);
    expect(agruparPreco(178_500, 25)).toBe(178_500);
    expect(agruparPreco(178_524, 25)).toBe(178_500);
    expect(agruparPreco(178_525, 25)).toBe(178_525);
  });

  it('passo 0 ou inválido devolve o preço intacto', () => {
    expect(agruparPreco(178_512, 0)).toBe(178_512);
    expect(agruparPreco(178_512, -5)).toBe(178_512);
    expect(agruparPreco(178_512, Number.NaN)).toBe(178_512);
  });

  it('⚠️ não sofre com erro de ponto flutuante', () => {
    // Math.floor(x/passo)*passo erra quando a divisão dá ...999999
    expect(agruparPreco(178_475, 25)).toBe(178_475);
    expect(agruparPreco(0.3, 0.1)).toBeCloseTo(0.3, 10);
    expect(agruparPreco(5186.5, 0.5)).toBeCloseTo(5186.5, 10);
  });
});

describe('agrupamentoPorZoom', () => {
  it('⭐ sem agrupamento quando tudo cabe (zoom máximo)', () => {
    expect(agrupamentoPorZoom({ ticksVisiveis: 20, alturaPx: 400, tickSize: 5 })).toBe(0);
  });

  it('agrupa quando há mais níveis do que linhas', () => {
    // 400px / 11px = 36 linhas; 360 ticks ⇒ 10 ticks por linha ⇒ passo 10
    const p = agrupamentoPorZoom({ ticksVisiveis: 360, alturaPx: 400, tickSize: 5 });
    expect(p).toBe(50); // 10 ticks × tickSize 5
  });

  it('usa passos REDONDOS (nível quebrado é ilegível)', () => {
    const p = agrupamentoPorZoom({ ticksVisiveis: 100, alturaPx: 400, tickSize: 1 });
    expect([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]).toContain(p);
  });

  it('entrada degenerada devolve 0 em vez de explodir', () => {
    expect(agrupamentoPorZoom({ ticksVisiveis: 0, alturaPx: 400, tickSize: 5 })).toBe(0);
    expect(agrupamentoPorZoom({ ticksVisiveis: 100, alturaPx: 0, tickSize: 5 })).toBe(0);
    expect(agrupamentoPorZoom({ ticksVisiveis: 100, alturaPx: 400, tickSize: 0 })).toBe(0);
    expect(agrupamentoPorZoom({ ticksVisiveis: Number.NaN, alturaPx: 4, tickSize: 1 })).toBe(0);
  });

  it('é monotônico: mais níveis no mesmo espaço nunca agrupa menos', () => {
    let anterior = 0;
    for (const ticks of [20, 50, 100, 500, 2000, 10_000]) {
      const p = agrupamentoPorZoom({ ticksVisiveis: ticks, alturaPx: 300, tickSize: 5 });
      expect(p).toBeGreaterThanOrEqual(anterior);
      anterior = p;
    }
  });
});

describe('indiceDaVela', () => {
  const f = [T, T + M5, T + 2 * M5];
  it('acha a última fronteira ≤ ts', () => {
    expect(indiceDaVela(f, T)).toBe(0);
    expect(indiceDaVela(f, T + M5 - 1)).toBe(0);
    expect(indiceDaVela(f, T + M5)).toBe(1);
    expect(indiceDaVela(f, T + 99 * M5)).toBe(2);
  });
  it('antes da primeira devolve -1', () => {
    expect(indiceDaVela(f, T - 1)).toBe(-1);
  });
  it('lista vazia ou ts inválido devolve -1', () => {
    expect(indiceDaVela([], T)).toBe(-1);
    expect(indiceDaVela(f, Number.NaN)).toBe(-1);
  });
});

describe('desequilibriosDiagonais', () => {
  const n = (preco: number, compra: number, venda: number): NivelFootprint => ({
    preco, compra, venda,
    delta: compra - venda, total: compra + venda,
    desequilibrio: compra + venda > 0 ? (compra - venda) / (compra + venda) : 0,
  });

  it('⭐ compara compra de cima com venda de baixo (a leitura clássica)', () => {
    const niveis = [n(100, 10, 10), n(101, 90, 5)];
    const d = desequilibriosDiagonais(niveis, 3);
    // compra 90 no índice 1 contra venda 10 no índice 0 ⇒ 9× ≥ 3×
    expect(d.compra).toEqual([1]);
    expect(d.venda).toEqual([]);
  });

  it('marca desequilíbrio vendedor de forma simétrica', () => {
    const niveis = [n(100, 5, 90), n(101, 10, 10)];
    const d = desequilibriosDiagonais(niveis, 3);
    expect(d.venda).toEqual([0]);
  });

  it('sem desequilíbrio quando a razão não atinge o fator', () => {
    const niveis = [n(100, 10, 40), n(101, 50, 10)];
    const d = desequilibriosDiagonais(niveis, 3);
    expect(d.compra).toEqual([]);
  });

  it('fator ≤ 1 devolve vazio (todo par passaria — inútil)', () => {
    const niveis = [n(100, 1, 1), n(101, 1, 1)];
    expect(desequilibriosDiagonais(niveis, 1)).toEqual({ compra: [], venda: [] });
    expect(desequilibriosDiagonais(niveis, 0)).toEqual({ compra: [], venda: [] });
  });

  it('lista com 0 ou 1 nível não tem diagonal', () => {
    expect(desequilibriosDiagonais([], 3)).toEqual({ compra: [], venda: [] });
    expect(desequilibriosDiagonais([n(100, 99, 0)], 3)).toEqual({ compra: [], venda: [] });
  });
});

describe('resumirFootprint', () => {
  it('descreve ausência sem fingir leitura', () => {
    expect(resumirFootprint([])).toContain('sem footprint');
  });

  it('reporta compra, venda, delta e o lado', () => {
    const g = grid([
      [T + 1000, 178_500, 1000, 200],
      [T + M5 + 1000, 178_475, 100, 300],
    ]);
    const s = resumirFootprint(agregarFootprint(g, [T, T + M5]));
    expect(s).toContain('2 vela(s)');
    expect(s).toContain('comprador'); // delta +600
  });
});
