/**
 * desempenho — MEDE o custo do hit-test, em vez de afirmar que e rapido.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO MEDE, E O QUE ELE NAO MEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEDE: o custo de `hitTest` sobre um plano ja projetado, que e o caminho que o
 * substrato percorre a cada movimento do cursor. E a projecao (`buildRenderPlan`),
 * que acontece uma vez por mudanca de viewport.
 *
 * NAO MEDE: rasterizacao, composicao, sincronismo de quadro. Nao ha pixel aqui —
 * mesma disciplina declarada pelas bancadas de `@robustus/charts-devtools`. Numero
 * daqui nao e taxa de quadros.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ COMO LER OS LIMITES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os limites afirmados sao FOLGADOS de proposito — dezenas de vezes acima do
 * medido nesta maquina. A intencao nao e cravar desempenho: e reprovar uma
 * REGRESSAO DE ORDEM DE GRANDEZA, do tipo "alguem voltou a converter coordenada
 * dentro do hit-test".
 *
 * Limite apertado numa suite que roda em maquina de desenvolvimento e em CI
 * compartilhada falha por vizinho barulhento, e teste que falha por acaso e
 * ignorado — o que custa mais que nao ter o teste.
 *
 * O numero medido e impresso, para quem quiser comparar entre maquinas.
 */
import { describe, expect, it } from 'vitest';
import { hitTest } from '../hit-test.core.js';
import {
  buildRenderPlan,
  type LogicalToScreen,
  type ViewportEpoch,
} from '../render-plan.core.js';
import type { Drawing, DrawingKind } from '../model.js';

const LARGURA = 1200;
const ALTURA = 600;

const CONV: LogicalToScreen = {
  timeToX: (t) => (t / 10_000) * LARGURA,
  priceToY: (p) => ALTURA - (p / 1000) * ALTURA,
  width: () => LARGURA,
  height: () => ALTURA,
};

const EPOCA: ViewportEpoch = {
  fromSec: 0,
  toSec: 10_000,
  width: LARGURA,
  height: ALTURA,
  topPrice: 1000,
  bottomPrice: 0,
};

/**
 * Colecao sintetica espalhada pela tela.
 *
 * Variedade de tipos de proposito: retangulo preenchido e Fibonacci sao os mais
 * caros no hit-test (regiao e N niveis), e uma colecao so de linhas mediria o caso
 * facil.
 */
function colecao(n: number): Drawing[] {
  const tipos: readonly DrawingKind[] = [
    'TRENDLINE',
    'RECTANGLE',
    'FIB_RETRACEMENT',
    'HORIZONTAL_LINE',
    'RAY',
  ];
  const saida: Drawing[] = [];
  for (let i = 0; i < n; i++) {
    const kind = tipos[i % tipos.length] as DrawingKind;
    const t = (i * 37) % 9_500;
    const p = (i * 53) % 950;
    saida.push({
      id: `d${i}`,
      kind,
      anchors: [
        { timeSec: t, price: p },
        { timeSec: t + 400, price: p + 40 },
      ],
      ...(kind === 'RECTANGLE' ? { style: { fill: 'rgba(255,255,255,0.15)' } } : {}),
    });
  }
  return saida;
}

/** Mediana de uma amostra. Robusta a pausa de coletor de lixo, que a media nao e. */
function mediana(xs: readonly number[]): number {
  const ord = [...xs].sort((a, b) => a - b);
  const meio = ord.length >> 1;
  if (ord.length % 2 === 1) return ord[meio] as number;
  return (((ord[meio - 1] as number) + (ord[meio] as number)) / 2);
}

/** Percentil por posto — valor que ACONTECEU, nao media entre dois que nao. */
function percentil(xs: readonly number[], q: number): number {
  const ord = [...xs].sort((a, b) => a - b);
  const i = Math.min(ord.length - 1, Math.max(0, Math.ceil(q * ord.length) - 1));
  return ord[i] as number;
}

describe('custo do hit-test', () => {
  it('mede e imprime o custo por movimento de cursor', () => {
    const N = 500;
    const plano = buildRenderPlan(colecao(N), CONV, EPOCA, N);
    expect(plano.items.length).toBeGreaterThan(0);

    // Pontos pseudoaleatorios deterministicos: mesma sequencia a cada execucao,
    // para o numero ser comparavel entre rodadas.
    const pontos: Array<[number, number]> = [];
    let semente = 12345;
    for (let i = 0; i < 2000; i++) {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      const x = (semente / 0x7fffffff) * LARGURA;
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      const y = (semente / 0x7fffffff) * ALTURA;
      pontos.push([x, y]);
    }

    // Aquecimento: descarta o custo de compilacao JIT da primeira passada.
    for (let i = 0; i < 300; i++) {
      const pt = pontos[i % pontos.length] as [number, number];
      hitTest(plano, pt[0], pt[1]);
    }

    const amostras: number[] = [];
    for (let r = 0; r < 100; r++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) {
        const pt = pontos[(r * 200 + i) % pontos.length] as [number, number];
        hitTest(plano, pt[0], pt[1]);
      }
      amostras.push((performance.now() - t0) / 200);
    }

    const med = mediana(amostras);
    const p95 = percentil(amostras, 0.95);

    // eslint-disable-next-line no-console
    console.log(
      `  [hit-test] ${plano.items.length} desenhos · mediana ${med.toFixed(4)} ms/movimento · p95 ${p95.toFixed(4)} ms`,
    );

    // Limite folgado: um movimento de cursor tem 16 ms de quadro. Gastar 1 ms com
    // 500 desenhos ainda deixa 15 ms para desenhar. Se isto falhar, alguem voltou
    // a converter coordenada dentro do hit-test.
    expect(med).toBeLessThan(1);
  });

  /**
   * ⭐ A propriedade que sustenta a escolha de NAO usar quadtree.
   *
   * Se o custo crescer de forma pior que ~linear com N, o prefiltro AABB nao esta
   * fazendo o trabalho e a arvore passaria a valer. Enquanto for ~linear e a
   * constante for microssegundos, arvore seria complexidade sem ganho.
   */
  it('o custo cresce de forma proporcional a N, nao explosiva', () => {
    const medir = (n: number): number => {
      const plano = buildRenderPlan(colecao(n), CONV, EPOCA, n);
      for (let i = 0; i < 200; i++) hitTest(plano, (i * 7) % LARGURA, (i * 11) % ALTURA);
      const amostras: number[] = [];
      for (let r = 0; r < 30; r++) {
        const t0 = performance.now();
        for (let i = 0; i < 200; i++) hitTest(plano, (i * 13) % LARGURA, (i * 17) % ALTURA);
        amostras.push((performance.now() - t0) / 200);
      }
      return mediana(amostras);
    };

    const c50 = medir(50);
    const c500 = medir(500);

    // eslint-disable-next-line no-console
    console.log(
      `  [escala] 50 -> ${c50.toFixed(5)} ms · 500 -> ${c500.toFixed(5)} ms · razao ${(c500 / Math.max(c50, 1e-9)).toFixed(1)}x para 10x mais desenhos`,
    );

    // 10x mais desenhos nao deve custar mais de ~40x. O teto e generoso porque a
    // medida em N pequeno e dominada por ruido de relogio, o que infla a razao.
    expect(c500).toBeLessThan(Math.max(c50, 1e-4) * 40);
  });

  it('projetar 500 desenhos cabe folgadamente num quadro', () => {
    const desenhos = colecao(500);
    for (let i = 0; i < 5; i++) buildRenderPlan(desenhos, CONV, EPOCA, 500);

    const amostras: number[] = [];
    for (let r = 0; r < 30; r++) {
      const t0 = performance.now();
      buildRenderPlan(desenhos, CONV, EPOCA, 500);
      amostras.push(performance.now() - t0);
    }
    const med = mediana(amostras);

    // eslint-disable-next-line no-console
    console.log(`  [projecao] 500 desenhos · mediana ${med.toFixed(3)} ms por mudanca de viewport`);

    // A projecao acontece uma vez por mudanca de viewport, nao por movimento.
    // Mesmo assim precisa caber num quadro de 16 ms.
    expect(med).toBeLessThan(16);
  });

  it('o teto de desenhos e respeitado, e o excedente e CONTADO', () => {
    const plano = buildRenderPlan(colecao(1000), CONV, EPOCA, 100);
    expect(plano.items.length).toBeLessThanOrEqual(100);
    // Contar em vez de descartar em silencio: a interface pode avisar que ha mais
    // desenhos do que ela esta mostrando.
    expect(plano.dropped).toBeGreaterThan(0);
    expect(plano.items.length + plano.dropped + plano.culled).toBe(1000);
  });
});
