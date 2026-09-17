/**
 * A ALTURA de um sub-painel, pedida pelo consumidor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"redução de altura da seção do histograma"*, com vários indicadores de histograma ao
 * mesmo tempo.
 *
 * A repartição era FIXA — 62% para o preço, 38% divididos igualmente. Com três osciladores,
 * cada um ficava com ~12,7% e o preço perdia mais de um terço da tela, para indicadores que
 * precisam de altura só para mostrar FORMA, não nível.
 *
 * ⚠️ A divisória arrastável não resolvia: ela move UM par de vizinhos, e o valor arrastado
 * é apagado por `rebalancePanes` na próxima vez que um indicador é ligado. É por isso que a
 * intenção (`heightFractionFixa`) é guardada separada do resultado (`heightFraction`).
 *
 * ⭐ Estes testes medem a REPARTIÇÃO, que é a decisão — e travam os dois pisos que impedem
 * o pior desfecho conhecido deste projeto: "não aparece nenhuma vela na tela".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';

const LARGURA = 800;
const ALTURA = 600;

interface PaneInterna {
  index: number;
  heightFraction: number;
  heightFractionFixa: number | null;
  collapsed: boolean;
  priceScale: { height: number };
}

function panes(chart: IChartApi): PaneInterna[] {
  return (chart as unknown as { panes: PaneInterna[] }).panes;
}

function fracaoDe(chart: IChartApi, index: number): number {
  return panes(chart).find((p) => p.index === index)?.heightFraction ?? 0;
}

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe('setPaneHeightFraction — o operador dita a altura do sub-painel', () => {
  let el: HTMLElement;
  let chart: IChartApi;

  beforeEach(() => {
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    chart.addSeries('Candlestick').setData([
      { time: 1, open: 1, high: 2, low: 0, close: 1 },
      { time: 2, open: 1, high: 2, low: 0, close: 1 },
    ] as never);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('o comportamento SEM fração fixa continua o de antes: 62 / 38', () => {
    const a = chart.addPane();
    expect(fracaoDe(chart, 0)).toBeCloseTo(0.62, 5);
    expect(fracaoDe(chart, a)).toBeCloseTo(0.38, 5);
  });

  it('⭐ fixar 10% no sub-painel devolve o resto ao PREÇO', () => {
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.1);

    expect(fracaoDe(chart, a)).toBeCloseTo(0.1, 5);
    // O preço fica com 90% — antes ficava com 62% para um oscilador que não precisava.
    expect(fracaoDe(chart, 0)).toBeCloseTo(0.9, 5);
    // E a altura em pixel acompanha: a fração é RELATIVA porque o gráfico é
    // redimensionável (fixar 90 px daria metade da tela num celular).
    const util = ALTURA - 28; // a tira do eixo de tempo
    const pane = panes(chart).find((p) => p.index === a)!;
    expect(pane.priceScale.height).toBeGreaterThan(0);
    expect(pane.priceScale.height).toBeLessThan(util * 0.2);
  });

  it('⭐⭐ a fração fixada SOBREVIVE a ligar outro indicador', () => {
    // ⚠️ Era o defeito da divisória arrastável: `rebalancePanes` recalculava tudo e a
    // altura escolhida desaparecia no próximo indicador ligado.
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.12);
    const b = chart.addPane();

    expect(fracaoDe(chart, a)).toBeCloseTo(0.12, 5);
    // A pane nova, sem fração fixa, divide o que sobra dos 38% históricos.
    expect(fracaoDe(chart, b)).toBeGreaterThan(0);
    expect(chart.paneHeightFraction(a)).toBeCloseTo(0.12, 5);
    expect(chart.paneHeightFraction(b)).toBeNull();
  });

  it('três osciladores pequenos deixam o preço com a maior parte da tela', () => {
    const ids = [chart.addPane(), chart.addPane(), chart.addPane()];
    for (const id of ids) chart.setPaneHeightFraction(id, 0.08);

    for (const id of ids) expect(fracaoDe(chart, id)).toBeCloseTo(0.08, 5);
    // 1 − 3×0,08 = 0,76 para o preço. Na repartição antiga seriam 0,62 com cada oscilador
    // em ~12,7%.
    expect(fracaoDe(chart, 0)).toBeCloseTo(0.76, 5);
  });

  it('⚠️ o PREÇO nunca fica com menos de 20% — o recorte é proporcional', () => {
    // Sem este teto, fixar 60% em duas panes deixaria o gráfico de preço numa tira de
    // poucos pixels: o defeito de "não aparece nenhuma vela", por outro caminho.
    const a = chart.addPane();
    const b = chart.addPane();
    chart.setPaneHeightFraction(a, 0.6);
    chart.setPaneHeightFraction(b, 0.6);

    expect(fracaoDe(chart, 0)).toBeGreaterThanOrEqual(0.2);
    // A ORDEM relativa pedida é preservada (as duas eram iguais, continuam iguais).
    expect(fracaoDe(chart, a)).toBeCloseTo(fracaoDe(chart, b), 5);
    expect(fracaoDe(chart, a) + fracaoDe(chart, b)).toBeLessThanOrEqual(0.8 + 1e-9);
  });

  it('valor fora da faixa é RECORTADO, não recusado', () => {
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.001);
    // Piso de 4%: abaixo disso o sub-painel não cabe nem no eixo de preço dele.
    expect(chart.paneHeightFraction(a)).toBeCloseTo(0.04, 5);
    chart.setPaneHeightFraction(a, 5);
    expect(chart.paneHeightFraction(a)).toBeCloseTo(0.6, 5);
  });

  it('`null` devolve o sub-painel à repartição automática', () => {
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.1);
    chart.setPaneHeightFraction(a, null);
    expect(chart.paneHeightFraction(a)).toBeNull();
    expect(fracaoDe(chart, a)).toBeCloseTo(0.38, 5);
  });

  it('a pane de PREÇO não aceita fração — ela recebe o que sobra, por definição', () => {
    chart.addPane();
    const antes = fracaoDe(chart, 0);
    chart.setPaneHeightFraction(0, 0.1);
    expect(fracaoDe(chart, 0)).toBe(antes);
  });

  it('sub-painel COLAPSADO não consome altura, mesmo com fração fixa', () => {
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.3);
    chart.setPaneVisible(a, false);
    // A altura volta ao preço: esconder o indicador tem de devolver o espaço, senão sobra
    // um retângulo de grade vazia.
    expect(fracaoDe(chart, 0)).toBeCloseTo(1, 5);
    // E a intenção é PRESERVADA: reexibir devolve a altura pedida, sem o operador repetir.
    expect(chart.paneHeightFraction(a)).toBeCloseTo(0.3, 5);
    chart.setPaneVisible(a, true);
    expect(fracaoDe(chart, a)).toBeCloseTo(0.3, 5);
  });

  it('índice inexistente e valor não finito são no-op, sem lançar', () => {
    expect(() => chart.setPaneHeightFraction(99, 0.2)).not.toThrow();
    const a = chart.addPane();
    chart.setPaneHeightFraction(a, 0.2);
    chart.setPaneHeightFraction(a, Number.NaN);
    expect(chart.paneHeightFraction(a)).toBeCloseTo(0.2, 5);
  });
});
