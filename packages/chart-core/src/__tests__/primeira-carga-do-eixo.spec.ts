/**
 * Primeira carga de dado — o defeito que deixava a TELA EM BRANCO no `setData`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, E POR QUE NINGUEM O VIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `onBarsAppended` mantem a visao ancorada na direita quando o operador ja estava
 * olhando o tempo real: `leftLogical += delta`. Com o grafico VAZIO,
 * `isFollowingRealTime` devolve `true` por definicao (`n === 0`), e o deslocamento
 * cego levava a borda esquerda da janela para `delta` — ou seja, para DEPOIS da
 * ultima barra.
 *
 * Medido: 40 velas, container de 800 px, `barSpacing` 8. A janela visivel ficava em
 * `40..140` enquanto o dado ocupava `0..39`. Nenhuma vela na tela, nenhum erro, e a
 * autoescala nem rodava (a faixa de indices da serie saia vazia), entao o eixo de
 * preco tambem ficava no `0..1` inicial.
 *
 * ⚠️ Nao aparecia no playground porque ele passa `resetViewportOn`, e o
 * `resetViewport` do engine chama `fitContent`. Quem usasse o caminho mais direto da
 * biblioteca — `createChart` + `addSeries` + `setData`, exatamente o que a
 * documentacao mostra — via o grafico vazio. Para uma biblioteca que vai ser
 * consumida por outros projetos, e o pior lugar possivel para um defeito.
 *
 * ⚠️ A correcao e `scrollToRealTime`, NAO `fitContent`. Enquadrar comprimiria 5.000
 * barras nos 800 px do container e nenhuma vela seria legivel; o certo na primeira
 * carga e mostrar as MAIS RECENTES no zoom default, coladas na direita.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';
import { visibleLogicalRange, type TimeScaleState } from '../time-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;
const PRECO_BASE = 130_000;

function velas(n: number, desde = 0): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, k) => {
    const i = desde + k;
    return {
      time: t0 + i * 60,
      open: PRECO_BASE + i,
      high: PRECO_BASE + i + 50,
      low: PRECO_BASE + i - 50,
      close: PRECO_BASE + i + 10,
    };
  });
}

function interno(chart: IChartApi): { render: () => void; ts: TimeScaleState } {
  return chart as unknown as { render: () => void; ts: TimeScaleState };
}

describe('primeira carga — o dado tem de APARECER sem reenquadrar a mao', () => {
  let el: HTMLElement;
  let chart: IChartApi;

  beforeEach(() => {
    el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
    document.body.appendChild(el);
    chart = createChart(el, { autoSize: false });
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  /**
   * ⭐ O TESTE QUE REPRODUZ O DEFEITO.
   *
   * A janela visivel tem de INTERSECTAR o dado. Antes da correcao ela comecava em 40
   * com o dado em 0..39 — sem interseccao nenhuma.
   */
  it('a janela visivel intersecta o dado depois do primeiro setData', () => {
    chart.addSeries('Candlestick').setData(velas(40) as never);
    interno(chart).render();

    const lr = visibleLogicalRange(interno(chart).ts);
    expect(lr).not.toBeNull();
    // A ultima barra (indice 39) esta dentro da janela.
    expect(lr!.from).toBeLessThan(39);
    expect(lr!.to).toBeGreaterThan(39);
  });

  /**
   * A consequencia em cadeia: sem interseccao a autoescala nao roda, e o eixo de preco
   * fica no `0..1` da construcao. Este caso mede o eixo, que e o que o operador ve.
   */
  it('a escala de preco cerca as velas — nao fica no 0..1 inicial', () => {
    chart.addSeries('Candlestick').setData(velas(40) as never);
    interno(chart).render();

    const escala = (chart as unknown as { panes: Array<{ priceScale: { topPrice: number; bottomPrice: number } }> })
      .panes[0]!.priceScale;
    expect(escala.bottomPrice).toBeGreaterThan(PRECO_BASE - 1_000);
    expect(escala.topPrice).toBeLessThan(PRECO_BASE + 1_000);
  });

  /**
   * ⚠️ A ancoragem e na DIREITA (barras recentes), nao um enquadramento.
   *
   * Com 40 barras num espaco para ~93, sobra vazio a ESQUERDA — e o comportamento
   * certo. Se a correcao fosse `fitContent`, `barSpacing` mudaria para caber tudo, e
   * com 5.000 barras o resultado seria uma parede ilegivel.
   */
  it('ancora na direita SEM alterar o zoom (barSpacing intacto)', () => {
    const antes = interno(chart).ts.barSpacing;
    chart.addSeries('Candlestick').setData(velas(40) as never);
    interno(chart).render();
    expect(interno(chart).ts.barSpacing).toBe(antes);
  });

  /**
   * ⭐ O ramo novo vale SO para a primeira carga. Barra nova ao vivo continua rolando
   * junto, e — o que importa mais — quem rolou para o PASSADO nao pode ser arrancado
   * de onde estava investigando.
   */
  it('quem rolou para o passado NAO e arrastado pela barra nova', () => {
    const serie = chart.addSeries('Candlestick');
    serie.setData(velas(200) as never);
    interno(chart).render();

    // Rola bem para tras: a janela passa a olhar as barras 10..50.
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 50 });
    interno(chart).render();
    const esquerdaAntes = interno(chart).ts.leftLogical;

    serie.update({ time: 1_700_000_000 + 200 * 60, open: 1, high: 2, low: 0, close: 1 } as never);
    interno(chart).render();

    expect(interno(chart).ts.leftLogical).toBeCloseTo(esquerdaAntes, 6);
  });

  it('seguindo o tempo real, a barra nova rola junto', () => {
    const serie = chart.addSeries('Candlestick');
    serie.setData(velas(200) as never);
    interno(chart).render();
    const esquerdaAntes = interno(chart).ts.leftLogical;

    serie.update({
      time: 1_700_000_000 + 200 * 60,
      open: PRECO_BASE,
      high: PRECO_BASE + 10,
      low: PRECO_BASE - 10,
      close: PRECO_BASE,
    } as never);
    interno(chart).render();

    // Deslocou uma barra: a borda direita continua no tempo real.
    expect(interno(chart).ts.leftLogical).toBeCloseTo(esquerdaAntes + 1, 6);
  });

  it('serie vazia nao move o eixo nem lanca', () => {
    const serie = chart.addSeries('Candlestick');
    expect(() => {
      serie.setData([] as never);
      interno(chart).render();
    }).not.toThrow();
    expect(interno(chart).ts.leftLogical).toBe(0);
  });
});

/**
 * ⭐ `setData` seguido de `fitContent()` — o par mais natural do mundo, e ele não
 * funcionava.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ts.times` só era preenchido dentro do `render`, que é agendado por
 * `requestAnimationFrame`. Então este código — o que a documentação mostra:
 *
 * ```ts
 * serie.setData(velas);
 * chart.timeScale().fitContent();
 * ```
 *
 * chamava `fitContent` com o eixo AINDA VAZIO. `fitContent` saía sem fazer nada
 * (`n === 0`), e o quadro seguinte aplicava a heurística de primeira carga
 * (`scrollToRealTime`), mostrando as últimas ~93 barras. O enquadramento pedido
 * simplesmente não acontecia — sem erro, sem aviso.
 *
 * ⚠️ Não aparecia no navegador quando o consumidor enquadrava DEPOIS de um quadro ter
 * pintado (um clique de botão, por exemplo). Aparecia exatamente no caso mais comum:
 * montar o gráfico com dado e enquadrar na mesma função.
 *
 * A correção: `fitContent`/`setVisibleLogicalRange`/`scrollToRealTime` reconstroem o
 * eixo antes de mover a janela. E isso tem um segundo efeito desejado — o `render`
 * seguinte já vê o eixo populado e NÃO aplica a heurística de primeira carga, ou seja
 * a intenção explícita do consumidor vence o palpite do motor.
 */
describe('⭐ enquadrar ANTES do primeiro quadro', () => {
  let el: HTMLElement;
  let chart: IChartApi;

  beforeEach(() => {
    el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
    document.body.appendChild(el);
    chart = createChart(el, { autoSize: false });
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('`fitContent` logo após `setData` enquadra de verdade', () => {
    chart.addSeries('Candlestick').setData(velas(200) as never);
    // ⚠️ NENHUM `render` entre as duas linhas — é o ponto do caso.
    chart.timeScale().fitContent();

    // Enquadrado: a janela começa no índice 0 e cabe tudo.
    expect(interno(chart).ts.leftLogical).toBe(0);
    const lr = visibleLogicalRange(interno(chart).ts);
    expect(lr!.to).toBeGreaterThanOrEqual(199);
  });

  /**
   * ⚠️ A metade que o teste acima não cobre: o quadro seguinte não pode DESFAZER o
   * enquadramento aplicando a heurística de primeira carga.
   */
  it('o primeiro quadro NÃO desfaz o enquadramento', () => {
    chart.addSeries('Candlestick').setData(velas(200) as never);
    chart.timeScale().fitContent();
    interno(chart).render(0);

    expect(interno(chart).ts.leftLogical).toBe(0);
  });

  it('`setVisibleLogicalRange` logo após `setData` também vale', () => {
    chart.addSeries('Candlestick').setData(velas(200) as never);
    chart.timeScale().setVisibleLogicalRange({ from: 50, to: 100 });
    interno(chart).render(0);
    expect(interno(chart).ts.leftLogical).toBeCloseTo(50, 6);
  });

  it('sem dado, enquadrar continua sendo no-op inofensivo', () => {
    chart.addSeries('Candlestick');
    expect(() => chart.timeScale().fitContent()).not.toThrow();
    expect(interno(chart).ts.leftLogical).toBe(0);
  });
});
