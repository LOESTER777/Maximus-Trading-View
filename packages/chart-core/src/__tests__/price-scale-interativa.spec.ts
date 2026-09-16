/**
 * Escala de preco interativa: arrasto no eixo desliga a autoescala, duplo-clique
 * religa. E o rotulo de preco/tempo do crosshair nao derruba o grafico em jsdom.
 *
 * ⚠️ jsdom nao tem layout nem contexto 2D. Fixamos as dimensoes do container e o
 * `getBoundingClientRect` do canvas a mao; a rasterizacao roda contra o contexto
 * inerte do motor. O que este teste mede e o ESTADO (faixa de preco, flag manual),
 * nao o pixel — coerente com a disciplina do projeto (bancada mede tudo menos
 * rasterizacao).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi, ISeriesApi } from '../contracts.js';

const LARGURA = 800;
const ALTURA = 400;

/**
 * Espera o proximo quadro de render coalescido.
 *
 * O motor agenda o render por `requestAnimationFrame`; no jsdom o rAF cai num
 * timer. Dois `setTimeout(0)` cobrem "agenda no rAF" + "rAF dispara". Ler a escala
 * de preco antes disso leria o estado ANTES da autoescala do quadro.
 */
function flushRender(): Promise<void> {
  // O rAF do jsdom dispara num timer proprio (~16ms), nao num setTimeout(0). Uma
  // espera folgada garante que o quadro coalescido rode antes de medir a escala.
  return new Promise((resolve) => setTimeout(resolve, 40));
}

/**
 * O jsdom nao implementa `PointerEvent`. O motor escuta eventos de PONTEIRO, mas
 * so le `button`, `clientX`, `clientY` e `pointerId` — todos presentes num
 * `MouseEvent` (o `pointerId` ausente cai no `catch` de `setPointerCapture`, que o
 * motor ja trata). Um `MouseEvent` com o `type` de ponteiro dispara os mesmos
 * ouvintes. Ver `vitest.setup.ts` sobre por que o ambiente e proposital.
 */
function ponteiro(type: string, init: MouseEventInit & { pointerId?: number }): MouseEvent {
  return new MouseEvent(type, init);
}

/** Container com dimensoes fixas (jsdom nao faz layout). */
function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** Fixa o retangulo do canvas para os eventos de ponteiro calcularem x/y. */
function fixarRect(chart: IChartApi, el: HTMLElement): void {
  const canvas = el.querySelector('canvas');
  if (canvas === null) throw new Error('canvas nao criado');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: LARGURA, bottom: ALTURA, width: LARGURA, height: ALTURA, x: 0, y: 0, toJSON() {} }) as DOMRect;
  void chart;
}

/** Serie de velas sinteticas, uma por minuto. */
function popular(serie: ISeriesApi<'Candlestick'>): void {
  const base = Math.floor(Date.UTC(2026, 0, 5, 12, 0, 0) / 1000);
  const dados = [];
  for (let i = 0; i < 120; i++) {
    const p = 100 + Math.sin(i / 5) * 10;
    dados.push({ time: base + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 });
  }
  serie.setData(dados);
}

function canvasDe(el: HTMLElement): HTMLCanvasElement {
  const c = el.querySelector('canvas');
  if (c === null) throw new Error('sem canvas');
  return c;
}

describe('escala de preco interativa', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let serie: ISeriesApi<'Candlestick'>;

  beforeEach(async () => {
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    fixarRect(chart, el);
    serie = chart.addSeries('Candlestick');
    popular(serie);
    // Primeiro quadro: a carga inicial de barras ancora a visao no tempo real (a
    // direita das barras). Deixa esse quadro rodar antes de enquadrar.
    await flushRender();
    // Enquadra o conteudo DEPOIS: agora as barras ficam visiveis e a autoescala do
    // proximo quadro mede o min/max real. Sem isso a visao fica fora do dado.
    chart.timeScale().fitContent();
    await flushRender();
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('arrastar sobre o eixo de preco altera a faixa e o modo manual congela a autoescala', async () => {
    // Faixa apos a autoescala inicial (com dado, nao o default 0..1).
    const spanAntes = (serie.coordinateToPrice(0) as number) - (serie.coordinateToPrice(ALTURA) as number);
    expect(Number.isFinite(spanAntes)).toBe(true);

    const canvas = canvasDe(el);
    // Ponto sobre o eixo de preco (a direita, dentro de PRICE_AXIS_WIDTH=56).
    const xEixo = LARGURA - 20;
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: xEixo, clientY: 200, pointerId: 1 }));
    // Arrasta para cima => expande a faixa (fator > 1). Muta a escala sincronamente.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: xEixo, clientY: 100, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: xEixo, clientY: 100, pointerId: 1 }));

    const spanDepois = (serie.coordinateToPrice(0) as number) - (serie.coordinateToPrice(ALTURA) as number);
    // A faixa mudou pelo arrasto.
    expect(Math.abs(spanDepois - spanAntes)).toBeGreaterThan(1e-6);

    // ⭐ Um update dispara render + autoScalePane. Com o modo manual ligado, a
    // autoescala NAO restaura a faixa — o quadro seguinte mantem o que o usuario
    // definiu.
    serie.update({ time: Math.floor(Date.UTC(2026, 0, 5, 14, 30, 0) / 1000), open: 105, high: 130, low: 80, close: 106 });
    await flushRender();
    const spanAposUpdate = (serie.coordinateToPrice(0) as number) - (serie.coordinateToPrice(ALTURA) as number);
    expect(spanAposUpdate).toBeCloseTo(spanDepois, 3);
  });

  it('duplo-clique no eixo de preco religa a autoescala', async () => {
    const canvas = canvasDe(el);
    const xEixo = LARGURA - 20;
    // Desliga por arrasto (estica bastante a faixa).
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: xEixo, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: xEixo, clientY: 40, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: xEixo, clientY: 40, pointerId: 1 }));
    const spanManual = (serie.coordinateToPrice(0) as number) - (serie.coordinateToPrice(ALTURA) as number);

    // Duplo-clique no eixo religa a autoescala e agenda um render.
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: xEixo, clientY: 200 }));
    await flushRender();
    const spanAuto = (serie.coordinateToPrice(0) as number) - (serie.coordinateToPrice(ALTURA) as number);
    // A faixa voltou ao enquadramento automatico, diferente da esticada a mao.
    expect(Math.abs(spanAuto - spanManual)).toBeGreaterThan(1e-6);
  });

  it('arrastar sobre a area de velas (nao o eixo) faz PAN, nao escala de preco', () => {
    const canvas = canvasDe(el);
    const leftAntes = chart.timeScale().getVisibleLogicalRange()?.from ?? 0;

    // Ponto no meio da area de plotagem, longe do eixo de preco.
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 200, clientY: 200, pointerId: 2 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 260, clientY: 200, pointerId: 2 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 260, clientY: 200, pointerId: 2 }));

    const leftDepois = chart.timeScale().getVisibleLogicalRange()?.from ?? 0;
    // O pan mudou a borda esquerda logica (mutacao sincrona no handler).
    expect(Math.abs(leftDepois - leftAntes)).toBeGreaterThan(1e-6);
  });

  it('o crosshair sobre o grafico nao lanca em jsdom (contexto inerte)', async () => {
    const canvas = canvasDe(el);
    expect(() => {
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: 150, pointerId: 3 }));
    }).not.toThrow();
    // E o render (que desenha rotulos de crosshair de preco e tempo) tambem nao.
    await expect(flushRender()).resolves.toBeUndefined();
  });

  it('reserva a faixa do eixo de tempo: a pane de preco mede ALTURA - 22px', () => {
    // paneSize devolve a altura de plotagem da pane, ja descontada a tira do eixo.
    const { height } = chart.paneSize(0);
    expect(height).toBeCloseTo(ALTURA - 22, 5);
  });
});
