/**
 * Convivencia entre a ferramenta de desenho e o PAN do motor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, COM AS PALAVRAS DE QUEM O VIU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"os componentes de linhas e indicadores para inserir na mão pararam de funcionar,
 * quando clica, o gráfico arrasta por inteiro"*.
 *
 * ⭐ A causa era de ARQUITETURA de evento, e nao de desenho. O motor escuta ponteiro no
 * `<canvas>`; este controlador escuta no CONTAINER, que e o pai do canvas. Em fase de
 * bolha — o default — o motor via o `pointerdown` PRIMEIRO, ligava `dragging = true` e
 * chamava `canvas.setPointerCapture`. Depois o controlador chamava
 * `container.setPointerCapture` e ROUBAVA a captura: dali em diante `pointermove` e
 * `pointerup` eram despachados no container, e o `onPointerUp` do canvas — o unico lugar
 * que baixava `dragging` — nunca chegava.
 *
 * Resultado: terminado o desenho, o motor ficava com o arrasto ligado e com
 * `lastPointerX` do gesto anterior. Mover o mouse depois, **sem botao nenhum**, panava o
 * eixo com um salto. O grafico "arrastava por inteiro" e a ferramenta parecia morta
 * porque o eixo corria debaixo dela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Nao havia UM teste exercitando o controlador contra o motor de verdade — os testes
 * de desenho usam nucleos puros e duplos, e os do motor nao conhecem desenho. Foi
 * exatamente na costura entre os dois que o defeito morou. Aqui o motor e REAL
 * (`createChart`) e o controlador e REAL; o que se mede e o EFEITO no eixo de tempo.
 *
 * ⭐ E o teste tem os DOIS lados: a ferramenta nao pode deixar o motor panando, **e** o
 * pan tem de continuar funcionando quando nao ha ferramenta. Sem o segundo caso, a
 * "correcao" poderia ser simplesmente desligar o pan e a suite ficaria verde.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@robustus/chart-core';
import type { IChartApi, ISeriesApi, SeriesType } from '@robustus/chart-core';
import { DrawingController } from '../DrawingController.js';
import { DrawingsPrimitive } from '../DrawingsPrimitive.js';

const LARGURA = 800;
const ALTURA = 400;

/**
 * ⚠️ `cancelable: true` e `buttons: 1` sao REQUISITO, nao enfeite.
 *
 * Sem `cancelable`, `preventDefault()` e um no-op silencioso e `defaultPrevented`
 * continua `false` — o teste passaria a medir um mundo onde o protocolo de cooperacao
 * nao existe. O `pointerdown` real do navegador e cancelavel.
 *
 * Sem `buttons: 1`, o `pointermove` e HOVER, e o motor (com razao) encerra arrasto orfao
 * ao ver botao nenhum pressionado.
 */
function ponteiro(type: string, init: MouseEventInit & { pointerId?: number }): MouseEvent {
  const e = new MouseEvent(type, { cancelable: true, bubbles: true, buttons: 1, ...init });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

/**
 * ⭐⭐ CAPTURA DE PONTEIRO SIMULADA — sem isto o teste seria VACUO, e foi.
 *
 * ⚠️ O jsdom nao implementa `setPointerCapture`, e a primeira versao deste arquivo
 * passou por MOTIVO ERRADO: sem captura, o `pointerup` chegava normalmente ao canvas e o
 * motor limpava o arrasto sozinho. O defeito relatado nasce exatamente da CAPTURA — e a
 * bancada estava medindo um mundo onde ela nao existe. Medido: com as correcoes
 * revertidas, a suite continuava verde.
 *
 * O que se reproduz aqui e a regra do navegador, nas tres partes que importam:
 *
 *  1. `setPointerCapture` faz os eventos seguintes do ponteiro serem despachados no
 *     elemento que capturou — e nao no elemento sob o cursor.
 *  2. A captura e EXCLUSIVA: quem captura depois toma de quem tinha antes.
 *  3. Quem PERDE a captura recebe `lostpointercapture`. E o unico aviso que o motor tem
 *     de que o `pointerup` dele nao vai chegar.
 */
interface CapturaSimulada {
  /** O elemento que detem a captura, ou `null`. */
  alvo: () => HTMLElement | null;
  restaurar: () => void;
}

function instalarCapturaDePonteiro(): CapturaSimulada {
  const proto = Element.prototype as unknown as {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  const setAntes = proto.setPointerCapture;
  const releaseAntes = proto.releasePointerCapture;
  let detentor: HTMLElement | null = null;

  function perder(el: HTMLElement, pointerId: number): void {
    el.dispatchEvent(ponteiro('lostpointercapture', { pointerId, buttons: 0 }));
  }

  proto.setPointerCapture = function (this: Element, pointerId: number): void {
    const novoDetentor = this as HTMLElement;
    if (detentor !== null && detentor !== novoDetentor) perder(detentor, pointerId);
    detentor = novoDetentor;
  };
  proto.releasePointerCapture = function (this: Element, pointerId: number): void {
    if (detentor === (this as HTMLElement)) {
      const anterior = detentor;
      detentor = null;
      perder(anterior, pointerId);
    }
  };

  return {
    alvo: () => detentor,
    restaurar: () => {
      detentor = null;
      if (setAntes === undefined) delete proto.setPointerCapture;
      else proto.setPointerCapture = setAntes;
      if (releaseAntes === undefined) delete proto.releasePointerCapture;
      else proto.releasePointerCapture = releaseAntes;
    },
  };
}

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: LARGURA, height: ALTURA, right: LARGURA, bottom: ALTURA }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function canvasDe(el: HTMLElement): HTMLCanvasElement {
  const c = el.querySelector('canvas');
  if (c === null) throw new Error('sem canvas');
  c.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: LARGURA, height: ALTURA, right: LARGURA, bottom: ALTURA }) as DOMRect;
  return c;
}

function velas(n: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 5) * 8;
    return { time: t0 + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 };
  });
}

describe('desenho x pan — o gesto pertence a UM dos dois, nunca aos dois', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let serie: ISeriesApi<SeriesType>;
  let camada: DrawingsPrimitive;
  let ctrl: DrawingController;
  let canvas: HTMLCanvasElement;
  let captura: CapturaSimulada;

  beforeEach(() => {
    captura = instalarCapturaDePonteiro();
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    serie = chart.addSeries('Candlestick');
    serie.setData(velas(200) as never);
    camada = new DrawingsPrimitive({ drawings: [] });
    serie.attachPrimitive(camada);
    ctrl = new DrawingController({
      chart,
      series: serie,
      container: el,
      layer: camada,
    });
    canvas = canvasDe(el);
    // Enquadra para o eixo ter tempos e a faixa visivel ser conhecida.
    chart.timeScale().fitContent();
  });

  afterEach(() => {
    ctrl.dispose();
    chart.remove();
    el.remove();
    captura.restaurar();
  });

  /** A faixa logica visivel, arredondada — a medida de "o grafico andou?". */
  function faixa(): { de: number; ate: number } {
    const r = chart.timeScale().getVisibleLogicalRange();
    if (r === null) throw new Error('sem faixa visivel');
    return { de: Math.round(r.from * 100) / 100, ate: Math.round(r.to * 100) / 100 };
  }

  /**
   * Um gesto completo de arrasto, do pressionar ao soltar.
   *
   * ⭐ O `pointerdown` vai no CANVAS (e o elemento sob o cursor, como no navegador). Os
   * eventos seguintes vao em quem detiver a CAPTURA — que e a regra do navegador e o
   * cerne do defeito: quando a camada de desenho captura no container, o canvas para de
   * receber `pointermove` e `pointerup`.
   */
  function arrastar(de: number, ate: number): void {
    canvas.dispatchEvent(ponteiro('pointerdown', { clientX: de, clientY: 200 }));
    const alvo = (): HTMLElement => captura.alvo() ?? canvas;
    alvo().dispatchEvent(ponteiro('pointermove', { clientX: (de + ate) / 2, clientY: 200 }));
    alvo().dispatchEvent(ponteiro('pointermove', { clientX: ate, clientY: 200 }));
    alvo().dispatchEvent(ponteiro('pointerup', { clientX: ate, clientY: 200 }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // O lado que estava quebrado
  // ───────────────────────────────────────────────────────────────────────────

  it('⭐ com ferramenta de DUAS ancoras, o arrasto desenha e NAO pana', () => {
    ctrl.setTool('TRENDLINE');
    const antes = faixa();

    arrastar(200, 500);

    expect(faixa()).toEqual(antes);
    // Guarda de vacuidade: o gesto tem de ter produzido um desenho. Sem isto, um
    // controlador que ignorasse o ponteiro por completo passaria neste teste.
    expect(ctrl.drawings()).toHaveLength(1);
    expect(ctrl.drawings()[0]!.kind).toBe('TRENDLINE');
  });

  it('⭐⭐ DEPOIS de desenhar, mover o mouse nao arrasta o grafico — a regressao relatada', () => {
    ctrl.setTool('TRENDLINE');
    arrastar(200, 500);
    const depoisDoDesenho = faixa();

    // O movimento seguinte, ja sem gesto nenhum. Era aqui que o grafico disparava: o
    // motor tinha ficado com `dragging = true` e com `lastPointerX = 200`, entao este
    // unico `pointermove` valia um arrasto de centenas de pixels.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 120, clientY: 210, buttons: 0 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 130, clientY: 215, buttons: 0 }));

    expect(faixa()).toEqual(depoisDoDesenho);
  });

  it('⭐ ferramenta de UMA ancora (linha horizontal) tambem nao pana', () => {
    // Este era o pior caso: o ramo de uma ancora nao chama `captureDrag`, logo nao havia
    // nem captura nem `preventDefault` — pressionar e deslizar panava na hora.
    ctrl.setTool('HORIZONTAL_LINE');
    const antes = faixa();

    arrastar(300, 600);

    expect(faixa()).toEqual(antes);
    expect(ctrl.drawings()).toHaveLength(1);
    expect(ctrl.drawings()[0]!.kind).toBe('HORIZONTAL_LINE');
  });

  it('o clique de ferramenta nao emite CLIQUE do grafico (nao abriria painel de indicador)', () => {
    const cliques: unknown[] = [];
    chart.subscribeClick((p) => cliques.push(p));

    ctrl.setTool('HORIZONTAL_LINE');
    arrastar(300, 300);

    // O gesto foi consumido pela camada de desenho; emitir clique faria a caixa de
    // propriedades de indicador abrir junto com a insercao da linha.
    expect(cliques).toHaveLength(0);
    expect(ctrl.drawings()).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O outro lado — sem ele a "correcao" poderia ser desligar o pan
  // ───────────────────────────────────────────────────────────────────────────

  it('⭐ SEM ferramenta, o arrasto continua PANANDO o grafico', () => {
    ctrl.setTool(null);
    const antes = faixa();

    arrastar(500, 200);

    const depois = faixa();
    expect(depois).not.toEqual(antes);
    // Arrastar para a ESQUERDA revela o futuro: a faixa avanca.
    expect(depois.de).toBeGreaterThan(antes.de);
    // E nenhum desenho nasceu do gesto de pan.
    expect(ctrl.drawings()).toHaveLength(0);
  });

  it('sem ferramenta, o clique no vazio segue emitindo clique do grafico', () => {
    const cliques: unknown[] = [];
    chart.subscribeClick((p) => cliques.push(p));
    ctrl.setTool(null);

    // ⚠️ Sem `pointermove` antes, de proposito: e o TOQUE (o dedo desce e sobe sem
    // mover). O motor lia a posicao do clique apenas do `pointermove`, entao em tela
    // sensivel ao toque o clique nunca era emitido — e "clicar no indicador abre as
    // propriedades" simplesmente nao existia ali, sem erro que desse pista.
    canvas.dispatchEvent(ponteiro('pointerdown', { clientX: 300, clientY: 200 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 300, clientY: 200 }));

    // ⭐ E o que faz "clicar num indicador abre as propriedades dele" continuar
    // funcionando: o clique de selecao do grafico nao pode ser engolido.
    expect(cliques).toHaveLength(1);
  });

  it('trocar de ferramenta para `null` devolve o pan no MESMO gesto seguinte', () => {
    ctrl.setTool('TRENDLINE');
    arrastar(200, 500);
    const aposDesenho = faixa();

    ctrl.setTool(null);
    arrastar(500, 300);

    // Sem isto, a correcao poderia ter deixado o pan desligado por um gesto de atraso —
    // o `handleScroll` restaurado tarde e um defeito que aparece como "o primeiro
    // arrasto depois de desenhar nao funciona".
    expect(faixa()).not.toEqual(aposDesenho);
  });
});
