/**
 * `seriesAt` — qual série está sob o ponto que o operador clicou.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LACUNA QUE ISTO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor sabia DESENHAR a EMA e não sabia dizer que um pixel era dela. Consequência na
 * interface: a única forma de configurar um indicador era achá-lo na LISTA lateral.
 * Com oito indicadores ligados, procurar na lista o que se acabou de clicar é trabalho
 * que o clique já tinha resolvido — o pedido foi literalmente *"quando clicar no
 * indicador dentro do gráfico, eu preciso abrir as propriedades do indicador
 * selecionado"*.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS MEDEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As duas decisões difíceis:
 *
 *  1. **distância ao SEGMENTO, não ao ponto.** Numa linha inclinada, o cursor exatamente
 *     sobre o traço pode estar a dezenas de pixels do vértice mais próximo. Medir ao
 *     vértice faria "clicar na linha" não acertar a linha.
 *  2. **prioridade antes de distância.** Um clique dentro de uma vela está dentro da
 *     REGIÃO da série de velas (distância 0) e pode estar sobre a linha de uma média que
 *     cruza aquela vela (distância 0 também). Empate de distância resolveria pela ordem
 *     de inserção das séries — instável e inexplicável. Traço vence região.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi, ISeriesApi, SeriesType } from '../contracts.js';
import type { TimeScaleState } from '../time-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;
const T0 = 1_700_000_000;
const PASSO = 60;

interface Interno {
  render: (agora?: number) => void;
  ts: TimeScaleState;
  panes: Array<{ index: number; priceScale: { height: number } }>;
}

function interno(chart: IChartApi): Interno {
  return chart as unknown as Interno;
}

/** Velas planas em 100, com corpo de ±1 — a região central da tela. */
function velas(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    time: T0 + i * PASSO,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
}

/** Linha reta num valor fixo. */
function linha(n: number, valor: number) {
  return Array.from({ length: n }, (_, i) => ({ time: T0 + i * PASSO, value: valor }));
}

/** Linha em rampa: sobe `passo` por barra a partir de `de`. */
function rampa(n: number, de: number, passo: number) {
  return Array.from({ length: n }, (_, i) => ({ time: T0 + i * PASSO, value: de + i * passo }));
}

describe('seriesAt', () => {
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
   * Enquadra TODO o dado e desenha um quadro.
   *
   * ⚠️ O `fitContent` não é decoração: por default o motor mostra as ~93 barras mais
   * recentes, então a barra 100 de uma série de 200 cai FORA da tela, com `x` negativo e
   * `y` fora da pane. Sem enquadrar, um caso podia passar por acidente (a série plana
   * acerta em qualquer coluna) e outro falhava por motivo errado — foi o que aconteceu na
   * primeira versão deste arquivo.
   */
  function enquadrar(): void {
    chart.timeScale().fitContent();
    interno(chart).render(0);
  }

  /** O ponto (x,y) de um valor de preço na coluna de um tempo. */
  function pontoDe(serie: ISeriesApi<SeriesType>, tempo: number, preco: number): { x: number; y: number } {
    const x = chart.timeScale().timeToCoordinate(tempo);
    const y = serie.priceToCoordinate(preco);
    expect(x).not.toBeNull();
    expect(y).not.toBeNull();
    return { x: x as number, y: y as number };
  }

  it('devolve a série de LINHA quando o ponto está sobre o traço', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();

    const p = pontoDe(l, T0 + 100 * PASSO, 100);
    expect(chart.seriesAt(p)).toBe(l);
  });

  it('devolve null quando o ponto está longe de tudo', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();

    const p = pontoDe(l, T0 + 100 * PASSO, 100);
    // 60 px acima da linha: fora da tolerância de 6.
    expect(chart.seriesAt({ x: p.x, y: p.y - 60 })).toBeNull();
  });

  it('a tolerância é configurável', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();
    const p = pontoDe(l, T0 + 100 * PASSO, 100);

    expect(chart.seriesAt({ x: p.x, y: p.y - 20 })).toBeNull();
    expect(chart.seriesAt({ x: p.x, y: p.y - 20 }, 30)).toBe(l);
  });

  /**
   * ⭐ O CASO QUE JUSTIFICA A DISTÂNCIA AO SEGMENTO.
   *
   * Numa rampa íngreme, o ponto entre duas barras está SOBRE o traço e a dezenas de
   * pixels de qualquer vértice. Medindo ao vértice mais próximo, o clique no meio do
   * traço não acertaria nada.
   */
  it('acerta o MEIO de um segmento íngreme, longe dos vértices', () => {
    const l = chart.addSeries('Line');
    // ⚠️ Uma rampa CONSTANTE não serve para este caso: a autoescala a espalha na altura
    // toda e cada barra fica com poucos pixels de subida — o traço nem é íngreme na
    // tela. O que produz segmento quase vertical é um SALTO isolado: série plana com um
    // degrau numa única barra.
    const comDegrau = Array.from({ length: 200 }, (_, i) => ({
      time: T0 + i * PASSO,
      value: i <= 100 ? 100 : 400,
    }));
    l.setData(comDegrau as never);
    enquadrar();

    const t1 = T0 + 100 * PASSO;
    const t2 = T0 + 101 * PASSO;
    const a = pontoDe(l, t1, 100);
    const b = pontoDe(l, t2, 400);

    // Exatamente no meio do segmento: sobre o traço, longe dos dois vértices.
    const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distanciaAoVertice = Math.hypot(meio.x - a.x, meio.y - a.y);
    // Guarda de vacuidade: o vértice está MUITO mais longe que a tolerância, então o
    // acerto só pode vir da medida ao segmento.
    expect(distanciaAoVertice).toBeGreaterThan(20);
    expect(chart.seriesAt(meio)).toBe(l);
  });

  /**
   * ⭐ O CASO QUE JUSTIFICA A PRIORIDADE.
   *
   * A linha cruza o corpo da vela. Os dois têm distância 0 no ponto do traço, e sem a
   * escada de prioridade a resposta dependeria da ordem em que as séries foram
   * inseridas — aqui a vela entrou PRIMEIRO, então uma comparação só por distância
   * devolveria a vela.
   */
  it('traço vence REGIÃO: a linha ganha da vela que ela cruza', () => {
    const velasApi = chart.addSeries('Candlestick');
    velasApi.setData(velas(200) as never);
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never); // dentro do corpo (99..101)
    enquadrar();

    const p = pontoDe(velasApi, T0 + 100 * PASSO, 100);
    expect(chart.seriesAt(p)).toBe(l);
  });

  it('dentro da vela mas FORA da linha devolve a vela', () => {
    const velasApi = chart.addSeries('Candlestick');
    velasApi.setData(velas(200) as never);
    const l = chart.addSeries('Line');
    // Linha bem acima do corpo da vela.
    l.setData(linha(200, 140) as never);
    enquadrar();

    const p = pontoDe(velasApi, T0 + 100 * PASSO, 100);
    expect(chart.seriesAt(p)).toBe(velasApi);
  });

  /**
   * ⚠️ A barra de histograma vai do VALOR até a base (zero). Medir só a distância ao
   * topo faria o clique no MEIO da barra — que é onde o operador clica — não acertar.
   */
  it('histograma acerta no MEIO da barra, não só no topo', () => {
    const h = chart.addSeries('Histogram', { priceScaleId: 'vol' });
    h.setData(linha(200, 1000) as never);
    enquadrar();

    const p = pontoDe(h, T0 + 100 * PASSO, 500); // metade da altura da barra
    expect(chart.seriesAt(p)).toBe(h);
  });

  /**
   * ⚠️ As BORDAS de uma banda contam como traço; o meio, como região. Clicar na borda
   * superior de uma Bollinger é clicar na linha, e é a linha que o operador quer.
   */
  it('banda: borda é traço (vence), preenchimento é região', () => {
    const banda = chart.addSeries('Band');
    banda.setData(
      Array.from({ length: 200 }, (_, i) => ({ time: T0 + i * PASSO, upper: 120, lower: 80 })) as never,
    );
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never); // dentro da banda
    enquadrar();

    // No meio da banda, sobre a linha: a linha ganha.
    expect(chart.seriesAt(pontoDe(banda, T0 + 100 * PASSO, 100))).toBe(l);
    // Na borda superior: a banda, porque ali a borda é traço e a linha está longe.
    expect(chart.seriesAt(pontoDe(banda, T0 + 100 * PASSO, 120))).toBe(banda);
  });

  /**
   * ⚠️ Série OCULTA não pode ser selecionada — o operador não clica no que não vê.
   */
  it('série com `visible: false` não é encontrada', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();
    const p = pontoDe(l, T0 + 100 * PASSO, 100);
    expect(chart.seriesAt(p)).toBe(l);

    l.applyOptions({ visible: false });
    enquadrar();
    expect(chart.seriesAt(p)).toBeNull();
  });

  /**
   * ⭐ Série em SUB-PAINEL: o Y do clique é do canvas, e a escala de preço da pane
   * converte no espaço DELA. Sem descontar o topo da pane, o acerto sairia deslocado
   * pela altura do painel de preço inteiro.
   */
  it('acerta série de sub-painel, com o Y convertido no espaço da pane', () => {
    chart.addSeries('Candlestick').setData(velas(200) as never);
    const paneIdx = chart.addPane();
    const osc = chart.addSeries('Line', {}, paneIdx);
    osc.setData(linha(200, 50) as never);
    enquadrar();

    const x = chart.timeScale().timeToCoordinate(T0 + 100 * PASSO) as number;
    const yLocal = osc.priceToCoordinate(50) as number;
    // Topo da pane do oscilador = altura da pane principal.
    const topoPane = interno(chart).panes[0]!.priceScale.height;

    expect(chart.seriesAt({ x, y: topoPane + yLocal })).toBe(osc);
    // E o MESMO Y local, lido como se fosse do painel principal, não acha o oscilador.
    expect(chart.seriesAt({ x, y: yLocal })).not.toBe(osc);
  });

  it('série vazia nunca é encontrada, e não lança', () => {
    const l = chart.addSeries('Line');
    enquadrar();
    expect(() => chart.seriesAt({ x: 100, y: 100 })).not.toThrow();
    expect(chart.seriesAt({ x: 100, y: 100 })).toBeNull();
    void l;
  });

  it('ponto fora do canvas devolve null sem lançar', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();
    expect(chart.seriesAt({ x: -50, y: -50 })).toBeNull();
    expect(chart.seriesAt({ x: 1e6, y: 1e6 })).toBeNull();
  });

  it('depois de `remove()` devolve null em vez de lançar', () => {
    const l = chart.addSeries('Line');
    l.setData(linha(200, 100) as never);
    enquadrar();
    chart.remove();
    expect(chart.seriesAt({ x: 100, y: 100 })).toBeNull();
  });

  /**
   * ⚠️ Série DESALINHADA do eixo (indicador que descartou o aquecimento) tem de acertar
   * no lugar certo. O índice do array não é o índice lógico ali, e resolver por índice
   * daria acerto deslocado — o mesmo mecanismo do defeito que deslocava indicador no
   * desenho.
   */
  it('série desalinhada acerta na coluna certa', () => {
    chart.addSeries('Candlestick').setData(velas(200) as never);
    const ema = chart.addSeries('Line');
    // Começa 20 barras depois: 180 pontos contra 200 do eixo.
    ema.setData(
      Array.from({ length: 180 }, (_, i) => ({ time: T0 + (i + 20) * PASSO, value: 105 })) as never,
    );
    enquadrar();

    // Na coluna da barra 100, a EMA existe e vale 105.
    const p = pontoDe(ema, T0 + 100 * PASSO, 105);
    expect(chart.seriesAt(p)).toBe(ema);
  });
});
