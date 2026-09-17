/**
 * Esconder serie (`visible: false`) e colapsar sub-painel (`setPaneVisible`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LACUNA QUE ISTO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor nao sabia esconder serie: ela existia ou nao existia. A consequencia
 * atravessava tres camadas:
 *
 * - na interface, desligar um indicador o **destruia**, e religar o recriava — com
 *   pane nova em altura default (perdendo o tamanho que o operador arrastou na
 *   divisoria) e o historico inteiro recalculado;
 * - no estado salvo, indicador desligado **desaparecia** do layout, porque o
 *   catalogo so gravava os que estavam em `plots`;
 * - e nao havia como olhar o preco limpo por um instante sem pagar tudo isso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ AS DUAS METADES, E A SEGUNDA E A QUE SE ESQUECE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Sair do desenho.** Obvio, e o menos importante.
 *
 * **2. Sair da AUTOESCALA.** Uma serie "escondida" que seguisse esticando a faixa
 * comprimiria o preco por causa de algo que nao esta na tela — e o operador nao
 * teria nenhuma pista da causa. E o mesmo mecanismo do defeito do grafico vazio
 * (ver `escalas-de-overlay.spec.ts`), agora por outro caminho.
 *
 * **3. E a pane.** Esconder as series de um oscilador sem colapsar a faixa dele
 * deixaria um retangulo de grade vazia ocupando 19% da altura. Por isso
 * `setPaneVisible` existe, e por isso ele NAO e `removePane`: colapsar preserva as
 * series, as cores e as linhas de referencia.
 *
 * ⚠️ Cada caso que afirma "nao desenhou" carrega GUARDA DE VACUIDADE — afirma
 * tambem que com a serie visivel houve desenho. Sem isso, um `render` que parasse
 * de desenhar qualquer coisa passaria verde comparando duas telas vazias, que e o
 * erro registrado na suite herdada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi, ISeriesApi, SeriesType } from '../contracts.js';
import type { PriceScaleState } from '../price-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;
const PRECO_BASE = 130_000;

// ═════════════════════════════════════════════════════════════════════════════
// Bancada
// ═════════════════════════════════════════════════════════════════════════════

interface PaneInterna {
  index: number;
  priceScale: PriceScaleState;
  heightFraction: number;
  collapsed: boolean;
  series: unknown[];
}

function panes(chart: IChartApi): PaneInterna[] {
  return (chart as unknown as { panes: PaneInterna[] }).panes;
}

function paneDe(chart: IChartApi, index: number): PaneInterna {
  const p = panes(chart).find((x) => x.index === index);
  if (p === undefined) throw new Error(`pane ${index} nao existe`);
  return p;
}

/** Forca uma passada de autoescala sem esperar o quadro do rAF. */
function autoescalar(chart: IChartApi): void {
  const c = chart as unknown as { render: () => void };
  c.render();
}

/**
 * Conta operacoes de desenho, para medir "esta serie saiu da tela".
 *
 * ⚠️ Substitui o `ctx` INTERNO do motor, nao o prototipo do canvas: em jsdom o
 * motor ja caiu no contexto inerte na construcao, e trocar o prototipo depois nao
 * teria efeito nenhum sobre o `ctx` que ele guardou.
 */
interface Registro {
  fillRect: number;
  strokes: number;
  textos: string[];
}

function instrumentar(chart: IChartApi): Registro {
  const reg: Registro = { fillRect: 0, strokes: 0, textos: [] };
  const noop = (): void => undefined;
  const estado: Record<string, unknown> = { canvas: { width: 0, height: 0 } };
  const metodos: Record<string, unknown> = {
    fillRect: (): void => {
      reg.fillRect += 1;
    },
    stroke: (): void => {
      reg.strokes += 1;
    },
    fillText: (t: string): void => {
      reg.textos.push(t);
    },
    measureText: (t: string) => ({ width: String(t).length * 6 }),
  };
  const ctx = new Proxy(estado, {
    get: (t, prop) => {
      if (typeof prop === 'string' && prop in metodos) return metodos[prop];
      if (prop in t) return t[prop as string];
      return typeof prop === 'string' && /^[a-z]/.test(prop) ? noop : undefined;
    },
    set: (t, p, v) => {
      t[p as string] = v;
      return true;
    },
  });
  Object.defineProperty(chart, 'ctx', { value: ctx, configurable: true, writable: true });
  return reg;
}

function velas(n: number): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * 60,
    open: PRECO_BASE + i,
    high: PRECO_BASE + i + 50,
    low: PRECO_BASE + i - 50,
    close: PRECO_BASE + i + 10,
  }));
}

/** Uma linha numa magnitude MUITO acima do preco — para a contaminacao ser obvia. */
function linhaAlta(n: number, valor: number): Array<{ time: number; value: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({ time: t0 + i * 60, value: valor }));
}

describe('serie oculta — sai do desenho', () => {
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

  it('⭐ `visible: false` para o desenho da serie (com guarda de vacuidade)', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(40) as never);

    const reg = instrumentar(chart);
    autoescalar(chart);
    const comSerie = reg.fillRect;
    // Guarda de vacuidade: os corpos de vela SAO desenhados por `fillRect`. Se este
    // numero fosse zero, o caso abaixo passaria comparando duas telas vazias.
    expect(comSerie).toBeGreaterThan(10);

    candles.applyOptions({ visible: false });
    reg.fillRect = 0;
    autoescalar(chart);
    expect(reg.fillRect).toBe(0);

    candles.applyOptions({ visible: true });
    reg.fillRect = 0;
    autoescalar(chart);
    expect(reg.fillRect).toBe(comSerie);
  });

  it('serie criada SEM a opcao nasce VISIVEL — o default nao pode ser "some"', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(40) as never);
    const reg = instrumentar(chart);
    autoescalar(chart);
    expect(reg.fillRect).toBeGreaterThan(10);
  });

  /**
   * ⚠️ O marcador e a linha de preco pertencem a serie. Se continuassem na tela com a
   * serie oculta, ficariam flutuando sem a referencia que os ancora — pior que
   * ausentes, porque parecem dado valido.
   */
  it('marcador e linha de preco da serie oculta tambem somem', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(40) as never);
    candles.setMarkers([
      { time: 1_700_000_600, position: 'aboveBar', color: '#0f0', shape: 'arrowUp', text: 'COMPRA' },
    ]);
    candles.createPriceLine({ price: PRECO_BASE, color: '#f00' });

    const reg = instrumentar(chart);
    autoescalar(chart);
    expect(reg.textos).toContain('COMPRA');
    const strokesComSerie = reg.strokes;
    expect(strokesComSerie).toBeGreaterThan(0);

    candles.applyOptions({ visible: false });
    reg.textos.length = 0;
    reg.strokes = 0;
    autoescalar(chart);
    expect(reg.textos).not.toContain('COMPRA');
    // A grade ainda desenha, entao nao se afirma zero — se afirma MENOS que antes.
    expect(reg.strokes).toBeLessThan(strokesComSerie);
  });
});

describe('⭐ serie oculta — sai da AUTOESCALA (a metade que importa)', () => {
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
   * ⭐ O CASO CENTRAL DO ARQUIVO.
   *
   * Uma linha em 400.000 na mesma escala do preco (130.000) estica a faixa para
   * ~130.000..400.000 e esmaga as velas. Esconder a linha tem de devolver a faixa;
   * se a autoescala continuasse contando com ela, o operador teria o preco
   * comprimido por uma serie invisivel, sem nenhuma pista da causa.
   */
  it('a faixa VOLTA ao preco quando a serie fora de escala e escondida', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);
    const fora = chart.addSeries('Line');
    fora.setData(linhaAlta(50, 400_000) as never);

    autoescalar(chart);
    const contaminado = paneDe(chart, 0).priceScale;
    expect(contaminado.topPrice - contaminado.bottomPrice).toBeGreaterThan(100_000);

    fora.applyOptions({ visible: false });
    autoescalar(chart);
    const limpo = paneDe(chart, 0).priceScale;
    expect(limpo.topPrice - limpo.bottomPrice).toBeLessThan(1_000);
    expect(limpo.bottomPrice).toBeGreaterThan(PRECO_BASE - 1_000);
  });

  /**
   * ⚠️ Todas as series de uma escala ocultas: a faixa CONGELA no ultimo valor bom.
   *
   * A alternativa seria degenerar (min=+Inf, max=-Inf) e produzir uma escala em que
   * toda conversao devolve `null` — e ao reexibir a serie o primeiro quadro sairia
   * com a escala errada. Congelar mantem o eixo legivel enquanto nada ha para
   * escalar.
   */
  it('escala com TODAS as series ocultas congela em vez de degenerar', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);
    autoescalar(chart);
    const antes = { ...paneDe(chart, 0).priceScale };

    candles.applyOptions({ visible: false });
    autoescalar(chart);
    const depois = paneDe(chart, 0).priceScale;

    expect(depois.topPrice).toBeCloseTo(antes.topPrice, 6);
    expect(depois.bottomPrice).toBeCloseTo(antes.bottomPrice, 6);
    expect(Number.isFinite(depois.topPrice)).toBe(true);
  });

  /**
   * ⚠️ O eixo de TEMPO nao depende de visibilidade, e isto e deliberado.
   *
   * Ele e derivado da serie de preco mais longa da pane 0. Derivá-lo so das visiveis
   * faria esconder a serie de preco COLAPSAR o eixo — e levar todas as outras series
   * com ele. Esconder uma serie esconde a serie, nao o tempo.
   */
  it('o eixo de tempo sobrevive a serie de preco oculta', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);
    autoescalar(chart);
    const tsAntes = (chart as unknown as { ts: { times: number[] } }).ts.times.length;
    expect(tsAntes).toBe(50);

    candles.applyOptions({ visible: false });
    autoescalar(chart);
    expect((chart as unknown as { ts: { times: number[] } }).ts.times.length).toBe(50);
  });

  it('serie oculta nao alimenta a legenda O/H/L/C', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);
    autoescalar(chart);

    const interno = chart as unknown as { barSobCursor: (x: number) => unknown };
    const x = chart.timeScale().timeToCoordinate(1_700_000_600);
    expect(x).not.toBeNull();
    expect(interno.barSobCursor(x as number)).toMatchObject({ high: expect.any(Number) });

    candles.applyOptions({ visible: false });
    expect(interno.barSobCursor(x as number)).toBeUndefined();
  });
});

describe('setPaneVisible — colapsar sub-painel sem destruir nada', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let osc: ISeriesApi<SeriesType>;
  let paneOsc: number;

  beforeEach(() => {
    el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
    document.body.appendChild(el);
    chart = createChart(el, { autoSize: false });
    chart.addSeries('Candlestick').setData(velas(50) as never);
    paneOsc = chart.addPane();
    osc = chart.addSeries('Line', {}, paneOsc);
    osc.setData(linhaAlta(50, 55) as never);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('⭐ colapsar devolve a altura ao preco; reexibir a devolve ao oscilador', () => {
    const principalAntes = paneDe(chart, 0).heightFraction;
    expect(principalAntes).toBeCloseTo(0.62, 6);
    expect(paneDe(chart, paneOsc).heightFraction).toBeGreaterThan(0);

    chart.setPaneVisible(paneOsc, false);

    // A pane colapsada nao ocupa NADA, e o preco fica com a altura toda. Sem isso o
    // operador ganharia um retangulo de grade vazia no lugar do oscilador.
    expect(paneDe(chart, paneOsc).heightFraction).toBe(0);
    expect(paneDe(chart, paneOsc).priceScale.height).toBe(0);
    expect(paneDe(chart, 0).heightFraction).toBeCloseTo(1, 6);

    chart.setPaneVisible(paneOsc, true);
    expect(paneDe(chart, 0).heightFraction).toBeCloseTo(0.62, 6);
    expect(paneDe(chart, paneOsc).heightFraction).toBeGreaterThan(0);
  });

  /**
   * ⭐ A diferenca entre colapsar e `removePane`, e a razao de existir do metodo: as
   * series SOBREVIVEM. Se fossem destruidas, religar o indicador exigiria recriar
   * serie, cor e linha de referencia — que e exatamente o custo que se quis evitar.
   */
  it('as series da pane colapsada continuam VIVAS (nao e removePane)', () => {
    const quantasAntes = paneDe(chart, paneOsc).series.length;
    expect(quantasAntes).toBe(1);

    chart.setPaneVisible(paneOsc, false);
    expect(paneDe(chart, paneOsc).series.length).toBe(1);
    expect(chart.isPaneVisible(paneOsc)).toBe(false);

    chart.setPaneVisible(paneOsc, true);
    expect(chart.isPaneVisible(paneOsc)).toBe(true);
    expect(paneDe(chart, paneOsc).series.length).toBe(1);
  });

  it('a pane colapsada nao desenha (com guarda de vacuidade)', () => {
    const reg = instrumentar(chart);
    autoescalar(chart);
    const strokesComOsc = reg.strokes;
    expect(strokesComOsc).toBeGreaterThan(0);

    chart.setPaneVisible(paneOsc, false);
    reg.strokes = 0;
    autoescalar(chart);
    // Menos tracos: a grade e a linha do oscilador sairam da tela.
    expect(reg.strokes).toBeLessThan(strokesComOsc);
  });

  /**
   * ⚠️ A pane principal NAO e escondivel. Aceitar o pedido deixaria a tela em branco
   * — o "grafico" e ela. Ignorar e melhor que lancar: e um pedido sem sentido, nao um
   * erro de programacao que precise interromper o desenho.
   */
  it('a pane principal (0) ignora o pedido', () => {
    chart.setPaneVisible(0, false);
    expect(paneDe(chart, 0).collapsed).toBe(false);
    expect(chart.isPaneVisible(0)).toBe(true);
  });

  it('indice inexistente e no-op, e idempotente nao rebalanceia de novo', () => {
    expect(() => chart.setPaneVisible(99, false)).not.toThrow();
    expect(chart.isPaneVisible(99)).toBe(false);

    chart.setPaneVisible(paneOsc, false);
    const fracao = paneDe(chart, 0).heightFraction;
    chart.setPaneVisible(paneOsc, false); // de novo
    expect(paneDe(chart, 0).heightFraction).toBe(fracao);
  });

  /**
   * ⚠️ Duas panes colapsadas tem a MESMA fronteira (altura zero), e o arrasto
   * redistribuiria altura de uma pane que nao esta na tela — a divisoria "nao pega",
   * ou pega e nada se move.
   */
  it('a divisoria da pane colapsada nao e agarravel', () => {
    const interno = chart as unknown as {
      fronteiraHorizontalEm: (x: number, y: number) => unknown;
    };

    // Com as duas visiveis existe fronteira em algum Y.
    const alturaPrincipal = paneDe(chart, 0).priceScale.height;
    expect(interno.fronteiraHorizontalEm(100, alturaPrincipal)).not.toBeNull();

    chart.setPaneVisible(paneOsc, false);
    // Sobrou UMA pane visivel: nao existe fronteira entre duas panes.
    expect(interno.fronteiraHorizontalEm(100, alturaPrincipal)).toBeNull();
    expect(interno.fronteiraHorizontalEm(100, paneDe(chart, 0).priceScale.height)).toBeNull();
  });

  /**
   * ⚠️ Pane colapsada tem altura ZERO, e `y >= acc && y <= acc + 0` casa exatamente
   * na fronteira. Sem pular as colapsadas, o crosshair na borda entre duas panes
   * visiveis seria atribuido a uma pane invisivel do meio, e o rotulo de preco sairia
   * lido na escala errada.
   */
  it('a pane sob o cursor nunca e uma colapsada', () => {
    const segunda = chart.addPane();
    chart.addSeries('Line', {}, segunda).setData(linhaAlta(50, 20) as never);
    chart.setPaneVisible(paneOsc, false);

    // ⚠️ `paneAtY` virou `paneAt(x, y)`: numa grade, Y sozinho nao identifica a pane.
    const interno = chart as unknown as { paneAt: (x: number, y: number) => PaneInterna | null };
    const alturaPrincipal = paneDe(chart, 0).priceScale.height;
    // Exatamente na fronteira, onde a colapsada casaria.
    const achada = interno.paneAt(100, alturaPrincipal);
    expect(achada?.collapsed).not.toBe(true);
  });
});
