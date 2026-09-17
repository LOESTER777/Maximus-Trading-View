/**
 * A GRADE de sub-painéis, medida contra o motor REAL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES MEDEM, E POR QUE NÃO É "APENAS GEOMETRIA"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pane-grid.core.spec.ts` já prova a matemática dos retângulos em núcleo puro. Aqui o
 * assunto é o que o núcleo NÃO pode provar: que o motor de verdade honra os retângulos, que a
 * interação (divisórias, eixo de preço por coluna, pan, crosshair) resolve a pane certa, e
 * ⭐⭐ que **toda pane continua mostrando a MESMA JANELA LÓGICA**. Essa última é a invariante
 * que autoriza a grade a existir; se ela cair, o operador lê o oscilador de uma janela e o
 * preço de outra, sem nada na tela avisando.
 *
 * ⚠️ jsdom não rasteriza (é requisito do projeto), então o que se mede é ESTADO: retângulos,
 * frações, o eixo derivado, o cursor e os eventos emitidos. Nenhuma asserção depende de pixel
 * pintado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi, MouseEventParams } from '../contracts.js';
import type { TimeScaleState } from '../time-scale.core.js';
import { visibleLogicalRange } from '../time-scale.core.js';
import type { RetanguloDePane } from '../pane-grid.core.js';

const LARGURA = 1200;
const ALTURA = 500;
/** A tira do eixo de tempo (TIME_AXIS_HEIGHT) sai da altura útil das panes. */
const UTIL = ALTURA - 22;
/** Piso horizontal por coluna (MIN_PANE_WIDTH_PX em chart.ts). */
const PISO_LARGURA = 120;

interface Interno {
  readonly panes: { index: number; heightFraction: number; heightFractionFixa: number | null; widthFraction: number }[];
  tsDaPane(rect: RetanguloDePane): TimeScaleState;
  paneRect(index: number): RetanguloDePane;
  paneAt(x: number, y: number): { index: number } | null;
  fronteiraVerticalEm(x: number, y: number): { x: number; esquerda: number; direita: number } | null;
  fronteiraHorizontalEm(x: number, y: number): { y: number } | null;
  readonly ts: TimeScaleState;
}
function interno(chart: IChartApi): Interno {
  return chart as unknown as Interno;
}

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
    ({ left: 0, top: 0, right: LARGURA, bottom: ALTURA, width: LARGURA, height: ALTURA, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return c;
}

/**
 * Forca UM quadro.
 *
 * ⚠️ `ts.times` so e preenchido dentro do `render`, que e agendado por `requestAnimationFrame`.
 * Sem isto, `coordinateToTime` devolve `null` e o teste mediria "sem tempo" em vez do tempo
 * errado — passaria por vacuidade.
 */
function desenhar(chart: IChartApi): void {
  (chart as unknown as { render: (t?: number) => void }).render(0);
}

const VELAS = Array.from({ length: 120 }, (_, i) => ({
  time: 1_700_000_000 + i * 300,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
}));

/** Cria o gráfico com `n` sub-painéis, cada um com uma linha. */
function montar(n: number): { el: HTMLElement; chart: IChartApi; canvas: HTMLCanvasElement; subs: number[] } {
  const el = montarContainer();
  const chart = createChart(el, { autoSize: false });
  const canvas = canvasDe(el);
  chart.addSeries('Candlestick').setData(VELAS as never);
  const subs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = chart.addPane();
    subs.push(p);
    // ⚠️ Valor que VARIA, e nao constante: serie constante degenera a autoescala (min == max)
    // e `priceToCoordinate` devolve coordenada fora da pane. Nao e defeito da grade, mas
    // mediria a coisa errada.
    chart
      .addSeries('Line', {}, p)
      .setData(
        VELAS.map((v, k) => ({ time: v.time, value: 20 + i * 30 + Math.sin(k / 7) * 8 })) as never,
      );
  }
  return { el, chart, canvas, subs };
}

describe('grade de sub-painéis', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let canvas: HTMLCanvasElement;
  let subs: number[];

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('⭐⭐ a invariante: a MESMA janela lógica em toda pane', () => {
    beforeEach(() => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
    });

    it('a coluna tem metade da largura e o MESMO intervalo de barras', () => {
      const rPreco = chart.paneRectOf(0);
      const rCol = chart.paneRectOf(subs[0] as number);
      expect(rPreco.width).toBe(LARGURA);
      expect(rCol.width).toBeCloseTo(LARGURA / 2, 6);

      const i = interno(chart);
      const tsPreco = i.tsDaPane(i.paneRect(0));
      const tsCol = i.tsDaPane(i.paneRect(subs[0] as number));

      // ⭐ A conta que sustenta tudo: `width / barSpacing` é a janela, e escalar os dois pelo
      // mesmo fator a deixa idêntica.
      expect(tsCol.width).toBeCloseTo(tsPreco.width / 2, 6);
      expect(tsCol.barSpacing).toBeCloseTo(tsPreco.barSpacing / 2, 6);

      const janelaPreco = visibleLogicalRange(tsPreco);
      const janelaCol = visibleLogicalRange(tsCol);
      expect(janelaPreco, 'bancada vazia: sem janela').not.toBeNull();
      expect(janelaCol?.from).toBeCloseTo(janelaPreco?.from ?? -1, 6);
      expect(janelaCol?.to).toBeCloseTo(janelaPreco?.to ?? -1, 6);
    });

    it('⭐ `leftLogical` e `times` são COMPARTILHADOS — não há eixo por coluna', () => {
      const i = interno(chart);
      const tsCol = i.tsDaPane(i.paneRect(subs[0] as number));
      expect(tsCol.leftLogical).toBe(i.ts.leftLogical);
      // Compartilhado por REFERÊNCIA: o campo pesado não é clonado a cada quadro.
      expect(tsCol.times).toBe(i.ts.times);
    });

    it('a pane de largura CHEIA recebe o eixo original, sem cópia', () => {
      chart.setPaneGridColumns(1);
      const i = interno(chart);
      expect(i.tsDaPane(i.paneRect(subs[0] as number))).toBe(i.ts);
    });

    it('pan em qualquer pane move o gráfico INTEIRO (uma janela só)', () => {
      const antes = chart.timeScale().getVisibleLogicalRange();
      const rCol = chart.paneRectOf(subs[0] as number);
      const y = rCol.top + rCol.height / 2;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 200, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: 260, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: 260, clientY: y }));
      const depois = chart.timeScale().getVisibleLogicalRange();
      expect(antes?.from, 'bancada vazia').not.toBeUndefined();
      expect(depois?.from).not.toBeCloseTo(antes?.from ?? 0, 6);
    });

    it('⭐⭐ o pan mantém a BARRA SOB O DEDO — e é por isso que ele anda mais na coluna', () => {
      // ⭐ A invariante correta não é "anda o mesmo número de barras": é "a barra que estava
      // sob o dedo continua sob o dedo". Numa coluna de meia largura, 60 px de dedo cobrem o
      // DOBRO de barras (a mesma janela em metade dos pixels), então o eixo tem de andar o
      // dobro. Se andasse o mesmo, a barra escaparia para trás da mão — e é justamente o que
      // acontece sem dividir `dx` pelo fator de compressão.
      const medir = (y: number): number => {
        const antes = chart.timeScale().getVisibleLogicalRange()?.from ?? 0;
        canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 200, clientY: y }));
        canvas.dispatchEvent(ponteiro('pointermove', { clientX: 260, clientY: y }));
        canvas.dispatchEvent(ponteiro('pointerup', { clientX: 260, clientY: y }));
        const depois = chart.timeScale().getVisibleLogicalRange()?.from ?? 0;
        return depois - antes;
      };
      const rPreco = chart.paneRectOf(0);
      const noPreco = medir(rPreco.top + rPreco.height / 2);
      const rCol = chart.paneRectOf(subs[0] as number);
      const fator = rCol.width / LARGURA;
      const naColuna = medir(rCol.top + rCol.height / 2);
      expect(Math.abs(noPreco), 'bancada vazia: o pan não moveu nada').toBeGreaterThan(0);
      expect(fator).toBeCloseTo(0.5, 6);
      expect(naColuna).toBeCloseTo(noPreco / fator, 6);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('⭐ o arranjo, e a altura que ele devolve ao preço', () => {
    it('⭐⭐ quatro osciladores em duas colunas devolvem altura ao PREÇO', () => {
      ({ el, chart, canvas, subs } = montar(4));
      chart.setPaneGridColumns(1);
      const alturaEmpilhado = chart.paneRectOf(0).height;
      chart.setPaneGridColumns(2);
      const alturaEmGrade = chart.paneRectOf(0).height;

      expect(alturaEmpilhado, 'bancada vazia').toBeGreaterThan(0);
      expect(alturaEmGrade).toBeGreaterThan(alturaEmpilhado);
      // E é uma diferença que o operador vê, não um pixel: quatro faixas viraram duas.
      expect(alturaEmGrade - alturaEmpilhado).toBeGreaterThan(UTIL * 0.1);
      expect(chart.paneGrid()).toMatchObject({ colunas: 2, linhas: 2 });
    });

    it('a altura de cada oscilador NÃO foi sacrificada pela grade', () => {
      ({ el, chart, canvas, subs } = montar(4));
      chart.setPaneGridColumns(1);
      const antes = chart.paneRectOf(subs[0] as number).height;
      chart.setPaneGridColumns(2);
      const depois = chart.paneRectOf(subs[0] as number).height;
      expect(depois).toBeGreaterThanOrEqual(antes * 0.99);
    });

    it('os membros de uma linha têm o mesmo topo e a mesma altura', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      const a = chart.paneRectOf(subs[0] as number);
      const b = chart.paneRectOf(subs[1] as number);
      expect(a.top).toBe(b.top);
      expect(a.height).toBe(b.height);
      expect(a.left).toBe(0);
      expect(b.left).toBeCloseTo(LARGURA / 2, 6);
      expect(b.left + b.width).toBe(LARGURA);
    });

    it('⚠️ a pane de PREÇO nunca entra na grade', () => {
      ({ el, chart, canvas, subs } = montar(3));
      chart.setPaneGridColumns(3);
      const r = chart.paneRectOf(0);
      expect(r.left).toBe(0);
      expect(r.width).toBe(LARGURA);
      expect(r.row).toBe(-1);
    });

    it('⭐ com UMA coluna o layout é IDÊNTICO ao empilhamento histórico', () => {
      ({ el, chart, canvas, subs } = montar(2));
      // Nem preciso pedir: `1` é o default, e isso é a decisão — ninguém tem o layout
      // reorganizado por atualizar a biblioteca.
      expect(chart.paneGrid()).toMatchObject({ pedido: 1, colunas: 1, linhas: 2 });
      let esperado = 0;
      for (const idx of [0, ...subs]) {
        const r = chart.paneRectOf(idx);
        expect(r.left).toBe(0);
        expect(r.width).toBe(LARGURA);
        expect(r.top).toBeCloseTo(esperado, 6);
        esperado += r.height;
      }
      expect(esperado).toBeCloseTo(UTIL, 6);
    });

    it('o pedido é RECORTADO pelo que cabe, e o efetivo é consultável', () => {
      ({ el, chart, canvas, subs } = montar(4));
      chart.setPaneGridColumns(4);
      expect(chart.paneGrid()).toMatchObject({ pedido: 4, colunas: 4 });
      // Container estreito: o mesmo pedido cabe menos.
      Object.defineProperty(el, 'clientWidth', { value: 500, configurable: true });
      chart.setPaneGridColumns(4);
      const g = chart.paneGrid();
      expect(g.pedido).toBe(4);
      expect(g.colunas).toBeLessThan(4);
    });

    it("'auto' adapta à largura", () => {
      ({ el, chart, canvas, subs } = montar(4));
      chart.setPaneGridColumns('auto');
      expect(chart.paneGrid().colunas).toBe(2); // 1200 px / 420 px de coluna confortável
      Object.defineProperty(el, 'clientWidth', { value: 1800, configurable: true });
      chart.setPaneGridColumns('auto');
      expect(chart.paneGrid().colunas).toBe(4);
    });

    it('pedido inválido é ignorado, sem derrubar o arranjo', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      chart.setPaneGridColumns(0);
      chart.setPaneGridColumns(Number.NaN);
      expect(chart.paneGrid().pedido).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('⭐ interação: a pane certa, por X E por Y', () => {
    beforeEach(() => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
    });

    it('o mesmo Y em X diferentes resolve panes DIFERENTES', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      const i = interno(chart);
      expect(i.paneAt(100, y)?.index).toBe(subs[0]);
      expect(i.paneAt(LARGURA - 100, y)?.index).toBe(subs[1]);
    });

    it('o clique na coluna da direita acha a série DELA', () => {
      // `seriesAt` resolve o índice por TEMPO, e `ts.times` só existe depois de um quadro.
      desenhar(chart);
      const r = chart.paneRectOf(subs[1] as number);
      const y = r.top + r.height / 2;
      // A série da direita vale 51; a da esquerda 50. Achar a série é achar a pane certa.
      const achada = chart.seriesAt({ x: r.left + r.width / 2, y }, 40);
      expect(achada, 'nenhuma série encontrada — bancada vazia').not.toBeNull();
      const naEsquerda = chart.seriesAt({ x: 100, y }, 40);
      expect(naEsquerda).not.toBeNull();
      expect(achada).not.toBe(naEsquerda);
    });

    it('⭐ o eixo de preço é o da BORDA DA COLUNA, não o da borda do gráfico', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      // Arrastar sobre o eixo da coluna da ESQUERDA (x ≈ 600) escala o preço DELA. Com a
      // faixa antiga (borda direita do gráfico) isto seria pan.
      const xEixo = r.left + r.width - 10;
      const antesJanela = chart.timeScale().getVisibleLogicalRange()?.from ?? 0;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: xEixo, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: xEixo, clientY: y + 40 }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: xEixo, clientY: y + 40 }));
      // Não panou (o gesto foi de escala de preço, não de rolagem).
      expect(chart.timeScale().getVisibleLogicalRange()?.from ?? 0).toBeCloseTo(antesJanela, 6);
    });

    it('⭐ o evento traz `paneIndex` — sem ele, a grade é indecifrável', () => {
      desenhar(chart);
      const vistos: MouseEventParams[] = [];
      chart.subscribeCrosshairMove((p) => vistos.push(p));
      const r = chart.paneRectOf(subs[1] as number);
      canvas.dispatchEvent(
        ponteiro('pointermove', { buttons: 0, clientX: r.left + 40, clientY: r.top + r.height / 2 }),
      );
      const ultimo = vistos[vistos.length - 1];
      expect(ultimo?.paneIndex).toBe(subs[1]);
      // ⚠️ E `time` continua sendo do eixo GLOBAL: o motor converte a posição da coluna para
      // o instante equivalente antes de emitir.
      expect(typeof ultimo?.time).toBe('number');
    });

    it('⚠️ o mesmo instante em colunas diferentes emite o MESMO `time`', () => {
      desenhar(chart);
      const vistos: MouseEventParams[] = [];
      chart.subscribeCrosshairMove((p) => vistos.push(p));
      const a = chart.paneRectOf(subs[0] as number);
      const b = chart.paneRectOf(subs[1] as number);
      const y = a.top + a.height / 2;
      // Mesma fração da largura em cada coluna = mesmo instante.
      canvas.dispatchEvent(ponteiro('pointermove', { buttons: 0, clientX: a.left + a.width * 0.4, clientY: y }));
      const tA = vistos[vistos.length - 1]?.time;
      canvas.dispatchEvent(ponteiro('pointermove', { buttons: 0, clientX: b.left + b.width * 0.4, clientY: y }));
      const tB = vistos[vistos.length - 1]?.time;
      expect(tA, 'bancada vazia: sem tempo').not.toBeUndefined();
      expect(tB).toBe(tA);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('⭐ ajuste MANUAL na horizontal — a divisória de coluna', () => {
    beforeEach(() => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
    });

    it('a fronteira vertical existe entre as colunas, e só na faixa da linha', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const i = interno(chart);
      const meioY = r.top + r.height / 2;
      expect(i.fronteiraVerticalEm(r.width, meioY)).not.toBeNull();
      // ⚠️ No painel de PREÇO, no mesmo X, não existe divisória de coluna.
      expect(i.fronteiraVerticalEm(r.width, 10)).toBeNull();
    });

    it('o cursor vira `ew-resize` sobre ela, e `ns-resize` sobre a horizontal', () => {
      const r = chart.paneRectOf(subs[0] as number);
      canvas.dispatchEvent(ponteiro('pointermove', { buttons: 0, clientX: r.width, clientY: r.top + r.height / 2 }));
      expect(canvas.style.cursor).toBe('ew-resize');
      canvas.dispatchEvent(ponteiro('pointermove', { buttons: 0, clientX: 200, clientY: r.top }));
      expect(canvas.style.cursor).toBe('ns-resize');
      canvas.dispatchEvent(ponteiro('pointermove', { buttons: 0, clientX: 200, clientY: r.top + r.height / 2 }));
      expect(canvas.style.cursor).toBe('');
    });

    it('arrastar move a divisória e PRESERVA a largura total', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      const x0 = r.width;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: x0, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: x0 + 150, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: x0 + 150, clientY: y }));

      const a = chart.paneRectOf(subs[0] as number);
      const b = chart.paneRectOf(subs[1] as number);
      expect(a.width).toBeCloseTo(x0 + 150, 0);
      expect(a.width + b.width).toBeCloseTo(LARGURA, 6);
      expect(b.left).toBeCloseTo(a.width, 6);
    });

    it('⚠️ o piso de largura impede a coluna de desaparecer', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      const x0 = r.width;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: x0, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: -5000, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: -5000, clientY: y }));
      const a = chart.paneRectOf(subs[0] as number);
      expect(a.width).toBeGreaterThanOrEqual(PISO_LARGURA - 0.5);
    });

    it('⭐⭐ a largura ajustada SOBREVIVE a ligar outro indicador', () => {
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: r.width, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: r.width + 150, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: r.width + 150, clientY: y }));
      const larguraPedida = chart.paneRectOf(subs[0] as number).width;
      expect(chart.paneWidthFraction(subs[0] as number)).not.toBeNull();

      // Liga um terceiro indicador: `rebalancePanes` roda.
      const p3 = chart.addPane();
      chart.addSeries('Line', {}, p3).setData(VELAS.map((v) => ({ time: v.time, value: 7 })) as never);

      // A primeira linha continua com a proporção pedida — e é isto que o defeito antigo da
      // divisória horizontal NÃO fazia.
      expect(chart.paneRectOf(subs[0] as number).width).toBeCloseTo(larguraPedida, 0);
    });

    it('`setPaneWidthFraction(null)` devolve à participação igual', () => {
      chart.setPaneWidthFraction(subs[0] as number, 3);
      expect(chart.paneRectOf(subs[0] as number).width).toBeCloseTo(LARGURA * 0.75, 0);
      chart.setPaneWidthFraction(subs[0] as number, null);
      expect(chart.paneWidthFraction(subs[0] as number)).toBeNull();
      expect(chart.paneRectOf(subs[0] as number).width).toBeCloseTo(LARGURA / 2, 6);
    });

    it('a pane principal não aceita peso de largura', () => {
      chart.setPaneWidthFraction(0, 3);
      expect(chart.paneWidthFraction(0)).toBeNull();
      expect(chart.paneRectOf(0).width).toBe(LARGURA);
    });

    it('arrastar coluna NÃO emite clique do gráfico', () => {
      let cliques = 0;
      chart.subscribeClick(() => (cliques += 1));
      const r = chart.paneRectOf(subs[0] as number);
      const y = r.top + r.height / 2;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: r.width, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: r.width + 60, clientY: y }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: r.width + 60, clientY: y }));
      expect(cliques).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('⭐⭐ ajuste MANUAL na vertical — e o defeito antigo que ele fecha', () => {
    it('a divisória horizontal move a LINHA INTEIRA', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      const r = chart.paneRectOf(subs[0] as number);
      const yFronteira = r.top;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: yFronteira }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: yFronteira - 60 }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: 300, clientY: yFronteira - 60 }));

      const a = chart.paneRectOf(subs[0] as number);
      const b = chart.paneRectOf(subs[1] as number);
      // ⚠️ Os DOIS membros cresceram junto: uma linha com membros de alturas diferentes
      // deixaria um buraco de canvas no meio do gráfico.
      expect(a.height).toBeCloseTo(b.height, 6);
      expect(a.height).toBeGreaterThan(r.height);
      expect(a.top).toBeCloseTo(b.top, 6);
    });

    it('⭐⭐ a altura arrastada SOBREVIVE a ligar outro indicador (defeito antigo)', () => {
      ({ el, chart, canvas, subs } = montar(1));
      const r = chart.paneRectOf(subs[0] as number);
      const yFronteira = r.top;
      canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: yFronteira }));
      canvas.dispatchEvent(ponteiro('pointermove', { clientX: 300, clientY: yFronteira - 50 }));
      canvas.dispatchEvent(ponteiro('pointerup', { clientX: 300, clientY: yFronteira - 50 }));
      const alturaPedida = chart.paneRectOf(subs[0] as number).height;
      expect(alturaPedida).toBeGreaterThan(r.height);
      // ⭐ A intenção foi GRAVADA: antes o arrasto mexia só no resultado.
      expect(chart.paneHeightFraction(subs[0] as number)).not.toBeNull();

      const p2 = chart.addPane();
      chart.addSeries('Line', {}, p2).setData(VELAS.map((v) => ({ time: v.time, value: 7 })) as never);

      // A pane arrastada mantém a fração pedida. Antes desta rodada, `rebalancePanes`
      // apagava o valor e a altura voltava sozinha — o operador ajustava, ligava o RSI, e
      // perdia o ajuste.
      const depois = chart.paneHeightFraction(subs[0] as number);
      expect(depois).not.toBeNull();
    });

    it('a altura total continua sendo a útil, sem buraco nem sobreposição', () => {
      ({ el, chart, canvas, subs } = montar(3));
      chart.setPaneGridColumns(2);
      const rs = [0, ...subs].map((i) => chart.paneRectOf(i));
      // Uma faixa por linha (a principal, mais 2 linhas de sub-painel).
      const faixas = new Map<number, number>();
      for (const r of rs) faixas.set(r.top, r.height);
      const soma = [...faixas.values()].reduce((a, b) => a + b, 0);
      expect(soma).toBeCloseTo(UTIL, 6);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('convivência com o que já existia', () => {
    it('colapsar uma coluna faz a vizinha esticar', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      chart.setPaneVisible(subs[0] as number, false);
      expect(chart.paneRectOf(subs[1] as number).width).toBe(LARGURA);
      expect(chart.paneRectOf(subs[0] as number).height).toBe(0);
    });

    it('remover uma pane recompacta a grade', () => {
      ({ el, chart, canvas, subs } = montar(3));
      chart.setPaneGridColumns(2);
      expect(chart.paneGrid().linhas).toBe(2);
      chart.removePane(subs[2] as number);
      expect(chart.paneGrid().linhas).toBe(1);
    });

    it('`paneSize()` sem argumento continua sendo o painel de preço, largura CHEIA', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      // ⚠️ É o que as ferramentas de desenho, o bookmap, o footprint e o perfil de volume
      // consultam. Mudar isto deslocaria toda linha de tendência já salva.
      expect(chart.paneSize().width).toBe(LARGURA);
      expect(chart.paneSize().height).toBe(chart.paneRectOf(0).height);
    });

    it('a série do sub-painel converte preço na escala DELA', () => {
      ({ el, chart, canvas, subs } = montar(2));
      chart.setPaneGridColumns(2);
      desenhar(chart);
      const s = chart.addSeries('Line', {}, subs[0] as number);
      s.setData(VELAS.map((v, k) => ({ time: v.time, value: 20 + Math.sin(k / 7) * 8 })) as never);
      desenhar(chart);
      const y = s.priceToCoordinate(20);
      expect(y).not.toBeNull();
      // Y local à pane: dentro da altura dela, não do gráfico.
      expect(y as number).toBeGreaterThanOrEqual(0);
      expect(y as number).toBeLessThanOrEqual(chart.paneRectOf(subs[0] as number).height);
    });

    it('desenhar um quadro com a grade ligada não lança', () => {
      ({ el, chart, canvas, subs } = montar(4));
      chart.setPaneGridColumns(2);
      const render = (chart as unknown as { render: (t?: number) => void }).render.bind(chart);
      expect(() => render(0)).not.toThrow();
    });
  });
});
