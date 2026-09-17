/**
 * Divisoria de pane arrastavel: redimensionar sub-painel com o mouse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FALTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `rebalancePanes` fixava 62% para o preco e 38% divididos entre os sub-paineis, e
 * nao havia NENHUM caminho para mudar isso. Quem liga MACD e RSI juntos fica com
 * 19% de altura para cada oscilador — e nenhuma forma de dar mais espaco ao que
 * esta lendo naquele momento.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES MEDEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O ESTADO do layout (`heightFraction` e a altura em pixel de cada escala), nao o
 * pixel desenhado — jsdom nao rasteriza. E o piso de altura, que e a parte
 * perigosa: sem ele o arrasto ate a ponta deixa uma pane com altura zero, invisivel
 * E sem area para o cursor pegar a divisoria de volta. Nao ha desfazer nesse gesto.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';
import type { PriceScaleState } from '../price-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;
/** A tira do eixo de tempo (TIME_AXIS_HEIGHT) sai da altura util das panes. */
const UTIL = ALTURA - 22;
/** O piso por pane, em pixel logico (MIN_PANE_HEIGHT_PX em chart.ts). */
const PISO_PX = 40;

interface PaneInterna {
  index: number;
  priceScale: PriceScaleState;
  heightFraction: number;
}

function panes(chart: IChartApi): PaneInterna[] {
  return (chart as unknown as { panes: PaneInterna[] }).panes;
}

/**
 * ⚠️ `buttons: 1` por DEFAULT nos eventos de arrasto, e isto e fidelidade, nao atalho.
 *
 * O navegador entrega `pointerdown`/`pointermove` de um arrasto com o bit do botao
 * principal ligado em `buttons`. A simulacao antiga omitia o campo (`buttons === 0`), e
 * um `pointermove` sem botao e, por definicao, HOVER — nao arrasto. Isso importou quando
 * o motor ganhou a guarda que encerra arrasto orfao ao ver `buttons === 0` (a rede
 * contra o `pointerup` perdido, que fazia o grafico arrastar sozinho). Sem o campo, a
 * bancada pedia ao motor que panasse durante um hover, coisa que nenhum navegador faz.
 *
 * Quem quiser simular hover de verdade passa `buttons: 0` explicitamente.
 */
function ponteiro(type: string, init: MouseEventInit & { pointerId?: number }): MouseEvent {
  const e = new MouseEvent(type, { buttons: 1, ...init });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

function canvasDe(el: HTMLElement): HTMLCanvasElement {
  const c = el.querySelector('canvas');
  if (c === null) throw new Error('sem canvas');
  c.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: LARGURA,
      bottom: ALTURA,
      width: LARGURA,
      height: ALTURA,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  return c;
}

/** Y da fronteira entre a pane 0 e a de baixo, em pixel logico. */
function yDaFronteira(chart: IChartApi): number {
  return panes(chart)[0]!.priceScale.height;
}

/** Arrasta a divisoria `dy` pixels (positivo = para baixo). */
function arrastar(canvas: HTMLCanvasElement, yInicial: number, dy: number): void {
  canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: yInicial }));
  canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: yInicial + dy }));
  canvas.dispatchEvent(ponteiro('pointerup', { clientX: 300, clientY: yInicial + dy }));
}

describe('divisoria de pane arrastavel', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    canvas = canvasDe(el);
    chart.addSeries('Candlestick').setData(
      Array.from({ length: 40 }, (_, i) => ({
        time: 1_700_000_000 + i * 60,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
      })) as never,
    );
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('sem sub-painel NAO existe divisoria — o cursor nao muda', () => {
    // A unica fronteira de uma pane sozinha e a borda da tira do eixo de tempo, e
    // arrastar ali nao redistribui nada: nao ha pane abaixo para ceder altura.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: UTIL }));
    expect(canvas.style.cursor).toBe('');
    const interno = chart as unknown as { paneBoundaryAt: (y: number) => number | null };
    expect(interno.paneBoundaryAt(UTIL)).toBeNull();
  });

  it('o cursor vira `ns-resize` sobre a fronteira entre duas panes', () => {
    chart.addPane();
    const y = yDaFronteira(chart);

    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: y }));
    expect(canvas.style.cursor).toBe('ns-resize');

    // Longe da fronteira, volta ao normal.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: y - 60 }));
    expect(canvas.style.cursor).toBe('');
  });

  it('a faixa sensivel e de ~4 px para cada lado, nao um pixel exato', () => {
    chart.addPane();
    const y = yDaFronteira(chart);
    const interno = chart as unknown as { paneBoundaryAt: (y: number) => number | null };
    expect(interno.paneBoundaryAt(y - 4)).toBe(0);
    expect(interno.paneBoundaryAt(y + 4)).toBe(0);
    expect(interno.paneBoundaryAt(y - 12)).toBeNull();
    expect(interno.paneBoundaryAt(y + 12)).toBeNull();
  });

  it('arrastar para BAIXO da altura a pane de cima e tira da de baixo', () => {
    chart.addPane();
    const antes = panes(chart).map((p) => p.priceScale.height);
    const y = yDaFronteira(chart);

    arrastar(canvas, y, 50);

    const depois = panes(chart).map((p) => p.priceScale.height);
    expect(depois[0]!).toBeCloseTo(antes[0]! + 50, 4);
    expect(depois[1]!).toBeCloseTo(antes[1]! - 50, 4);
  });

  it('arrastar para CIMA faz o inverso', () => {
    chart.addPane();
    const antes = panes(chart).map((p) => p.priceScale.height);
    const y = yDaFronteira(chart);

    arrastar(canvas, y, -40);

    const depois = panes(chart).map((p) => p.priceScale.height);
    expect(depois[0]!).toBeCloseTo(antes[0]! - 40, 4);
    expect(depois[1]!).toBeCloseTo(antes[1]! + 40, 4);
  });

  /**
   * ⚠️ A SOMA das alturas nao pode mudar: o operador arrastou UMA divisoria e
   * espera que so as duas vizinhas se ajustem. Se a soma escorregasse, a tira do
   * eixo de tempo seria invadida ou sobraria faixa vazia.
   */
  it('a altura TOTAL util e preservada, e as outras panes nao se mexem', () => {
    chart.addPane();
    const terceira = chart.addPane();
    const antes = panes(chart).map((p) => p.priceScale.height);
    const alturaTerceiraAntes = panes(chart).find((p) => p.index === terceira)!.priceScale.height;

    arrastar(canvas, yDaFronteira(chart), 30);

    const depois = panes(chart).map((p) => p.priceScale.height);
    const somaAntes = antes.reduce((a, b) => a + b, 0);
    const somaDepois = depois.reduce((a, b) => a + b, 0);
    expect(somaDepois).toBeCloseTo(somaAntes, 4);
    expect(somaDepois).toBeCloseTo(UTIL, 4);
    // A pane que nao e vizinha da fronteira arrastada nao mudou.
    expect(panes(chart).find((p) => p.index === terceira)!.priceScale.height).toBeCloseTo(
      alturaTerceiraAntes,
      4,
    );
  });

  /**
   * ⭐ O PISO. Sem ele a pane de baixo chega a altura 0: desaparece da tela E fica
   * sem area para o cursor pegar a divisoria de volta. Nao ha desfazer neste gesto —
   * o sub-painel ficaria perdido.
   */
  it('arrastar ate o fim respeita o PISO da pane de baixo', () => {
    chart.addPane();
    // Arrasto absurdo, muito maior que a altura util.
    arrastar(canvas, yDaFronteira(chart), 10_000);

    const alturas = panes(chart).map((p) => p.priceScale.height);
    expect(alturas[1]!).toBeCloseTo(PISO_PX, 4);
    expect(alturas[0]!).toBeCloseTo(UTIL - PISO_PX, 4);
  });

  it('arrastar para cima ate o fim respeita o PISO da pane de cima', () => {
    chart.addPane();
    arrastar(canvas, yDaFronteira(chart), -10_000);

    const alturas = panes(chart).map((p) => p.priceScale.height);
    expect(alturas[0]!).toBeCloseTo(PISO_PX, 4);
    expect(alturas[1]!).toBeCloseTo(UTIL - PISO_PX, 4);
  });

  /**
   * As escalas de OVERLAY dividem o retangulo da pane, entao tambem recebem a
   * altura nova. Uma overlay com altura desatualizada converteria contra a faixa
   * antiga e o volume apareceria deslocado do painel.
   */
  it('a escala de overlay acompanha a altura nova da pane', () => {
    chart.addSeries('Histogram', { priceScaleId: 'volume' });
    chart.addPane();
    arrastar(canvas, yDaFronteira(chart), 35);

    const pane0 = panes(chart)[0]! as unknown as {
      priceScale: PriceScaleState;
      overlayScales: Map<string, PriceScaleState>;
    };
    expect(pane0.overlayScales.get('volume')!.height).toBeCloseTo(pane0.priceScale.height, 6);
  });

  /**
   * ⚠️ O arrasto da divisoria NAO e clique do grafico. Emitir clique ao soltar faria
   * a camada de desenho criar uma figura ao fim de cada ajuste de layout.
   */
  it('o arrasto da divisoria nao emite clique', () => {
    chart.addPane();
    let cliques = 0;
    chart.subscribeClick(() => {
      cliques++;
    });
    arrastar(canvas, yDaFronteira(chart), 25);
    expect(cliques).toBe(0);
  });

  it('sobre o EIXO DE PRECO a divisoria nao pega — quem manda ali e a escala', () => {
    chart.addPane();
    const y = yDaFronteira(chart);
    const antes = panes(chart).map((p) => p.priceScale.height);

    // x dentro da faixa do eixo de preco (PRICE_AXIS_WIDTH = 56).
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: LARGURA - 20, clientY: y }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: LARGURA - 20, clientY: y + 50 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: LARGURA - 20, clientY: y + 50 }));

    const depois = panes(chart).map((p) => p.priceScale.height);
    expect(depois[0]!).toBeCloseTo(antes[0]!, 6);
    expect(canvas.style.cursor).toBe('');
  });

  it('`pointerleave` no meio do arrasto encerra o gesto', () => {
    chart.addPane();
    const y = yDaFronteira(chart);
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: y }));
    canvas.dispatchEvent(ponteiro('pointerleave', { clientX: 300, clientY: y }));
    const interno = chart as unknown as { resizingBoundary: number | null };
    expect(interno.resizingBoundary).toBeNull();
    expect(canvas.style.cursor).toBe('');
  });
});
