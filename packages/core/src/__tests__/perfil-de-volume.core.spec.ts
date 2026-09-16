/**
 * `agregarPerfilDeVolume` — o histograma de volume por preço.
 *
 * Nasce do pedido do operador em 03/09/2026: *"não deveria ser tipo o
 * marketProfile para mostrar as regiões que mais concentraram?"*. O footprint
 * responde por vela e exige zoom; o perfil responde pelo período e é legível em
 * qualquer zoom.
 *
 * O que estes casos protegem:
 *   1. a soma por preço está certa e separa agressor comprador de vendedor;
 *   2. o POC é o nível de maior volume, com empate resolvido de forma
 *      DETERMINÍSTICA (preço menor);
 *   3. a área de valor cobre a fração pedida e contém o POC;
 *   4. nível sem execução NÃO entra (barra de largura zero seria indistinguível
 *      de nível ausente);
 *   5. saída vazia sempre explica o motivo em pt-BR;
 *   6. dado furado não vira NaN nem contamina os vizinhos.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  agregarPerfilDeVolume,
  binarizarPerfil,
  velasLegiveisParaFootprint,
} from '@robustus/charts-core';
import type { BookmapGrid } from '@robustus/charts-core';

const T0 = 1_800_000_000_000;

/**
 * Grid mínimo. `ti`/`pi` são índices paralelos: a posição `k` é a célula
 * `(times[ti[k]], prices[pi[k]])`.
 */
function grid(over: Partial<BookmapGrid> = {}): BookmapGrid {
  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-09-03',
    baldeSeg: 60,
    times: Float64Array.from([T0, T0 + 60_000]),
    prices: Float64Array.from([100, 105, 110]),
    ti: Uint32Array.from([0, 0, 0, 1, 1, 1]),
    pi: Uint32Array.from([0, 1, 2, 0, 1, 2]),
    bid: Float32Array.from([0, 0, 0, 0, 0, 0]),
    ask: Float32Array.from([0, 0, 0, 0, 0, 0]),
    //                     p100 p105 p110 | p100 p105 p110
    buy: Float32Array.from([10, 100, 5, 20, 200, 5]),
    sell: Float32Array.from([5, 50, 10, 5, 100, 10]),
    cobertura: null,
    ...over,
  } as BookmapGrid;
}

describe('agregarPerfilDeVolume', () => {
  it('soma por preço e separa agressor comprador de vendedor', () => {
    const p = agregarPerfilDeVolume(grid());

    // Ordem: preço DECRESCENTE (topo da tela primeiro).
    expect(p.niveis.map((n) => n.preco)).toEqual([110, 105, 100]);

    const n105 = p.niveis.find((n) => n.preco === 105)!;
    expect(n105.compra).toBe(300); // 100 + 200
    expect(n105.venda).toBe(150);  //  50 + 100
    expect(n105.total).toBe(450);

    expect(p.totalGeral).toBe(40 + 450 + 30); // p100=40 · p105=450 · p110=30
    expect(p.maiorTotal).toBe(450);
  });

  it('o POC é o nível de maior volume', () => {
    const p = agregarPerfilDeVolume(grid());
    expect(p.poc).toBe(105);
  });

  it('empate no POC resolve pelo preço MENOR, de forma determinística', () => {
    // Dois níveis com exatamente o mesmo total.
    const p = agregarPerfilDeVolume(
      grid({
        buy: Float32Array.from([50, 50, 0, 0, 0, 0]),
        sell: Float32Array.from([0, 0, 0, 0, 0, 0]),
      }),
    );
    expect(p.niveis.filter((n) => n.total === 50)).toHaveLength(2);
    expect(p.poc).toBe(100);
    // E repetir a chamada dá o mesmo resultado.
    expect(agregarPerfilDeVolume(
      grid({
        buy: Float32Array.from([50, 50, 0, 0, 0, 0]),
        sell: Float32Array.from([0, 0, 0, 0, 0, 0]),
      }),
    ).poc).toBe(100);
  });

  it('a área de valor contém o POC e cobre a fração pedida', () => {
    const p = agregarPerfilDeVolume(grid(), { fracaoAreaDeValor: 0.7 });
    expect(p.val).not.toBeNull();
    expect(p.vah).not.toBeNull();
    expect(p.val!).toBeLessThanOrEqual(p.poc!);
    expect(p.vah!).toBeGreaterThanOrEqual(p.poc!);

    // Com p105 valendo 450 de 520 (86%), a área de valor de 70% é o POC sozinho.
    expect(p.vah).toBe(105);
    expect(p.val).toBe(105);
  });

  it('a área de valor cresce quando a fração exigida cresce', () => {
    const p95 = agregarPerfilDeVolume(grid(), { fracaoAreaDeValor: 0.95 });
    const amplitude95 = (p95.vah ?? 0) - (p95.val ?? 0);
    const p70 = agregarPerfilDeVolume(grid(), { fracaoAreaDeValor: 0.7 });
    const amplitude70 = (p70.vah ?? 0) - (p70.val ?? 0);
    expect(amplitude95).toBeGreaterThan(amplitude70);
  });

  it('nível sem execução NÃO entra no perfil', () => {
    const p = agregarPerfilDeVolume(
      grid({
        buy: Float32Array.from([0, 100, 0, 0, 0, 0]),
        sell: Float32Array.from([0, 0, 0, 0, 0, 0]),
      }),
    );
    expect(p.niveis).toHaveLength(1);
    expect(p.niveis[0]!.preco).toBe(105);
  });

  it('recorte de janela descarta o que está fora', () => {
    // Só o primeiro balde.
    const p = agregarPerfilDeVolume(grid(), {
      janela: { tsDe: T0 - 1, tsAte: T0 + 1 },
    });
    const n105 = p.niveis.find((n) => n.preco === 105)!;
    expect(n105.compra).toBe(100); // sem os 200 do segundo balde
    expect(n105.venda).toBe(50);
  });

  it('grid ausente e grid sem execução explicam o motivo em pt-BR', () => {
    const semGrid = agregarPerfilDeVolume(null);
    expect(semGrid.niveis).toHaveLength(0);
    expect(semGrid.motivoVazio).toMatch(/livro/i);

    const semExec = agregarPerfilDeVolume(
      grid({
        buy: Float32Array.from([0, 0, 0, 0, 0, 0]),
        sell: Float32Array.from([0, 0, 0, 0, 0, 0]),
      }),
    );
    expect(semExec.niveis).toHaveLength(0);
    expect(semExec.motivoVazio).toMatch(/execu/i);
    // ⚠️ Vazio SEM motivo é o defeito a evitar: tela vazia inexplicada.
    expect(semExec.motivoVazio).not.toBeNull();
  });

  it('valor furado conta como zero, sem contaminar o nível vizinho', () => {
    const p = agregarPerfilDeVolume(
      grid({
        buy: Float32Array.from([Number.NaN, 100, 0, 0, 0, 0]),
        sell: Float32Array.from([-30, 0, 0, 0, 0, 0]),
      }),
    );
    // p100 tinha só valores inválidos ⇒ fora do perfil; p105 intacto.
    expect(p.niveis.map((n) => n.preco)).toEqual([105]);
    expect(p.niveis[0]!.total).toBe(100);
    expect(Number.isFinite(p.totalGeral)).toBe(true);
  });

  it('é determinístico e conserva o total (propriedade)', () => {
    const arb = fc.array(
      fc.record({
        idxT: fc.integer({ min: 0, max: 1 }),
        idxP: fc.integer({ min: 0, max: 2 }),
        c: fc.integer({ min: 0, max: 5_000 }),
        v: fc.integer({ min: 0, max: 5_000 }),
      }),
      { minLength: 1, maxLength: 40 },
    );

    fc.assert(
      fc.property(arb, (celulas) => {
        const g = grid({
          ti: Uint32Array.from(celulas.map((x) => x.idxT)),
          pi: Uint32Array.from(celulas.map((x) => x.idxP)),
          buy: Float32Array.from(celulas.map((x) => x.c)),
          sell: Float32Array.from(celulas.map((x) => x.v)),
          bid: Float32Array.from(celulas.map(() => 0)),
          ask: Float32Array.from(celulas.map(() => 0)),
        });

        const a = agregarPerfilDeVolume(g);
        const b = agregarPerfilDeVolume(g);
        if (JSON.stringify(a) !== JSON.stringify(b)) return false;

        // Conservação: nada de volume se perde nem se inventa.
        const esperado = celulas.reduce((acc, x) => acc + x.c + x.v, 0);
        if (Math.abs(a.totalGeral - esperado) > 1e-6) return false;

        // Ordem decrescente estrita, sem preço repetido.
        for (let i = 1; i < a.niveis.length; i += 1) {
          if (!(a.niveis[i - 1]!.preco > a.niveis[i]!.preco)) return false;
        }

        // POC e área coerentes quando há nível.
        if (a.niveis.length > 0) {
          if (a.poc === null || a.vah === null || a.val === null) return false;
          if (!(a.val <= a.poc && a.poc <= a.vah)) return false;
          if (a.maiorTotal !== Math.max(...a.niveis.map((n) => n.total))) return false;
        }
        return true;
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});

describe('velasLegiveisParaFootprint', () => {
  it('diz quantas velas cabem com número legível', () => {
    // É a conta que explica o relato "sai apenas traços": com 900 px e 46 px por
    // vela, o footprint só escreve número com no máximo 19 velas na tela.
    expect(velasLegiveisParaFootprint(900)).toBe(19);
    expect(velasLegiveisParaFootprint(460)).toBe(10);
  });

  it('largura inválida devolve `null` em vez de número inventado', () => {
    expect(velasLegiveisParaFootprint(0)).toBeNull();
    expect(velasLegiveisParaFootprint(Number.NaN)).toBeNull();
    expect(velasLegiveisParaFootprint(-10)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `binarizarPerfil` — o que faltava para o perfil parecer um perfil
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Medido no grid real de 03/09/2026: **914 níveis de preço distintos** num
// pregão de WIN. Num painel de ~400 px são 0,44 px por nível — o desenho vira
// mancha, e foi o que o operador viu ("está longe de ser isso").
//
// O padrão de mercado bina a amplitude num número fixo de linhas (a referência
// pública do ChartPrime na TradingView documenta 50 por padrão). Estes casos
// travam as propriedades que a binarização NÃO pode quebrar.

describe('binarizarPerfil', () => {
  /** Perfil cru com muitos níveis, como o de um pregão real. */
  function perfilDenso(qtdNiveis: number) {
    const prices = Array.from({ length: qtdNiveis }, (_, i) => 100_000 + i * 5);
    const ti: number[] = [];
    const pi: number[] = [];
    const buy: number[] = [];
    const sell: number[] = [];
    for (let i = 0; i < qtdNiveis; i += 1) {
      ti.push(0);
      pi.push(i);
      // Volume com um pico no meio, para haver POC e área de valor definidos.
      const dist = Math.abs(i - qtdNiveis / 2);
      buy.push(Math.max(1, Math.round(500 - dist * 3)));
      sell.push(Math.max(1, Math.round(400 - dist * 2)));
    }
    return agregarPerfilDeVolume(
      grid({
        times: Float64Array.from([T0]),
        prices: Float64Array.from(prices),
        ti: Uint32Array.from(ti),
        pi: Uint32Array.from(pi),
        bid: Float32Array.from(ti.map(() => 0)),
        ask: Float32Array.from(ti.map(() => 0)),
        buy: Float32Array.from(buy),
        sell: Float32Array.from(sell),
      }),
    );
  }

  it('reduz centenas de níveis ao número de linhas pedido', () => {
    const cru = perfilDenso(914); // exatamente a densidade medida em produção
    expect(cru.niveis.length).toBe(914);

    const binado = binarizarPerfil(cru, 50);
    expect(binado.niveis.length).toBeLessThanOrEqual(50);
    expect(binado.niveis.length).toBeGreaterThan(10);
  });

  it('CONSERVA o volume — binar não cria nem destrói contrato', () => {
    const cru = perfilDenso(500);
    const binado = binarizarPerfil(cru, 50);
    expect(binado.totalGeral).toBeCloseTo(cru.totalGeral, 6);

    const somaCompra = binado.niveis.reduce((a, n) => a + n.compra, 0);
    const somaCompraCru = cru.niveis.reduce((a, n) => a + n.compra, 0);
    expect(somaCompra).toBeCloseTo(somaCompraCru, 6);
  });

  it('mantém a ordem decrescente e o contrato do POC e da área', () => {
    const binado = binarizarPerfil(perfilDenso(400), 40);
    for (let i = 1; i < binado.niveis.length; i += 1) {
      expect(binado.niveis[i - 1]!.preco).toBeGreaterThan(binado.niveis[i]!.preco);
    }
    expect(binado.poc).not.toBeNull();
    expect(binado.val!).toBeLessThanOrEqual(binado.poc!);
    expect(binado.vah!).toBeGreaterThanOrEqual(binado.poc!);
    expect(binado.maiorTotal).toBe(Math.max(...binado.niveis.map((n) => n.total)));
  });

  it('o POC binado fica na vizinhança do POC cru', () => {
    const cru = perfilDenso(400);
    const binado = binarizarPerfil(cru, 50);
    const larguraFaixa =
      (cru.niveis[0]!.preco - cru.niveis[cru.niveis.length - 1]!.preco) / 50;
    // O POC binado é o CENTRO da faixa que contém o pico: a distância até o POC
    // cru não pode passar de uma faixa.
    expect(Math.abs(binado.poc! - cru.poc!)).toBeLessThanOrEqual(larguraFaixa);
  });

  it('perfil com poucos níveis passa intacto — binar não inventa linhas vazias', () => {
    const cru = agregarPerfilDeVolume(grid());
    expect(cru.niveis).toHaveLength(3);
    const binado = binarizarPerfil(cru, 50);
    expect(binado).toBe(cru); // mesma referência: nada a fazer
  });

  it('linhas fora de faixa é recortado, e o resultado é determinístico', () => {
    const cru = perfilDenso(400);
    const absurdo = binarizarPerfil(cru, 100_000);
    const teto = binarizarPerfil(cru, 150);
    expect(absurdo.niveis.length).toBe(teto.niveis.length);

    const zero = binarizarPerfil(cru, 0);
    const piso = binarizarPerfil(cru, 10);
    expect(zero.niveis.length).toBe(piso.niveis.length);

    expect(JSON.stringify(binarizarPerfil(cru, 50)))
      .toBe(JSON.stringify(binarizarPerfil(cru, 50)));
  });

  it('perfil vazio continua vazio, com o motivo preservado', () => {
    const vazio = agregarPerfilDeVolume(null);
    const binado = binarizarPerfil(vazio, 50);
    expect(binado.niveis).toHaveLength(0);
    expect(binado.motivoVazio).not.toBeNull();
  });
});
