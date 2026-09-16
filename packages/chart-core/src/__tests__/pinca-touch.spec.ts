/**
 * Pinca em touch: zoom por dois dedos, ancorado no ponto medio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FALTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As opcoes `handleScale.pinch` e `handleScroll.horzTouchDrag`/`vertTouchDrag`
 * existiam no contrato desde o inicio e **nunca eram lidas**. O `setupPointer`
 * rastreava UM ponteiro: com dois dedos na tela, o segundo simplesmente sobrescrevia
 * o estado do primeiro e o grafico panava aos pulos em vez de dar zoom. Em tablet —
 * o uso natural de um painel de mesa em pe — nao havia como aproximar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO ISTO E MEDIDO EM jsdom
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ O jsdom NAO implementa `PointerEvent` (verificado: `typeof PointerEvent ===
 * 'undefined'`). O motor le apenas `button`, `clientX`, `clientY`, `pointerId` e
 * `pointerType` — todos presentes ou definiveis num `MouseEvent`, que dispara os
 * MESMOS ouvintes quando o `type` e de ponteiro. Entao o evento e real e o caminho
 * exercitado e o de producao; o que se completa a mao sao os dois campos que o
 * `MouseEvent` ignora no `init`.
 *
 * ⚠️ As asserções sao sobre a FAIXA LOGICA visivel (`getVisibleLogicalRange`), nao
 * sobre pixel: zoom-in encurta a faixa, zoom-out a alonga, e a ancoragem se prova
 * pelo indice logico sob o ponto medio ficar parado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';

const LARGURA = 800;
const ALTURA = 400;

/**
 * Evento de ponteiro sintetico. `pointerId` e `pointerType` sao definidos a mao —
 * o `MouseEvent` descarta os dois do `init` (ver o cabecalho).
 */
function ponteiro(
  type: string,
  init: MouseEventInit & { pointerId: number; pointerType?: string },
): MouseEvent {
  const e = new MouseEvent(type, init);
  Object.defineProperty(e, 'pointerId', { value: init.pointerId });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'touch' });
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

function velas(n: number): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 7) * 6;
    return { time: t0 + i * 60, open: p, high: p + 1, low: p - 1, close: p + 0.5 };
  });
}

/** Amplitude da janela, em barras. Encurta no zoom-in, alonga no zoom-out. */
function amplitude(chart: IChartApi): number {
  const lr = chart.timeScale().getVisibleLogicalRange();
  if (lr === null) throw new Error('sem faixa visivel');
  return lr.to - lr.from;
}

/** Quantos ponteiros o motor considera ATIVOS. A verdade do rastreio. */
function ponteirosAtivos(chart: IChartApi): number {
  return (chart as unknown as { pointers: Map<number, unknown> }).pointers.size;
}

describe('pinca em touch', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let canvas: HTMLCanvasElement;

  function montar(opts?: Parameters<typeof createChart>[1]): void {
    el = montarContainer();
    chart = createChart(el, { autoSize: false, ...opts });
    canvas = canvasDe(el);
    chart.addSeries('Candlestick').setData(velas(200) as never);
  }

  beforeEach(() => {
    montar();
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  /** Dois dedos descendo na tela, nas coordenadas dadas. */
  function doisDedos(x1: number, x2: number, y = 200): void {
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: x1, clientY: y, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: x2, clientY: y, pointerId: 2 }));
  }

  it('afastar os dedos APROXIMA (a janela encurta)', () => {
    doisDedos(300, 500);
    const antes = amplitude(chart);

    // Distancia 200 -> 400: fator 2.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 200, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 600, clientY: 200, pointerId: 2 }));

    expect(amplitude(chart)).toBeLessThan(antes);
  });

  it('juntar os dedos AFASTA (a janela alonga)', () => {
    doisDedos(200, 600);
    const antes = amplitude(chart);

    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 350, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 450, clientY: 200, pointerId: 2 }));

    expect(amplitude(chart)).toBeGreaterThan(antes);
  });

  /**
   * ⭐ A asserção que define a QUALIDADE do gesto: o instante entre os dedos fica
   * parado. Sem ancoragem, o zoom escaparia lateralmente e o operador perderia o
   * trecho que estava olhando — o mesmo motivo pelo qual o zoom por roda ancora no
   * cursor.
   */
  it('o zoom ancora no PONTO MEDIO entre os dedos', () => {
    const meio = 400; // ponto medio de 300 e 500, e de 200 e 600
    doisDedos(300, 500);
    const logicalAntes = chart.timeScale().coordinateToLogical(meio);
    expect(logicalAntes).not.toBeNull();

    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 200, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 600, clientY: 200, pointerId: 2 }));

    const logicalDepois = chart.timeScale().coordinateToLogical(meio);
    expect(logicalDepois).not.toBeNull();
    // Mesmo indice logico sob o mesmo pixel, antes e depois do zoom.
    expect(logicalDepois!).toBeCloseTo(logicalAntes!, 6);
  });

  /**
   * ⭐ O CASO QUE REPROVOU A PRIMEIRA IMPLEMENTACAO.
   *
   * Transladar os dois dedos (gesto de pan com dois dedos) mantem a distancia, logo
   * NAO deve mudar o zoom — e deve mover o grafico na direcao do gesto.
   *
   * ⚠️ O navegador entrega `pointermove` de UM ponteiro por vez. Na versao
   * incremental (fator contra o quadro anterior), o evento intermediario media
   * distancia menor, dava zoom-out, e o zoom-in seguinte usava outra ancora: sobrava
   * uma translacao residual de 3,33 barras **na direcao contraria** ao gesto. Foi
   * este teste que expos isso, e por isso os dedos se movem UM DE CADA VEZ aqui — em
   * dois eventos, como no aparelho real.
   */
  it('transladar os dois dedos PANA na direcao do gesto, sem mudar o zoom', () => {
    doisDedos(300, 500);
    const esquerdaAntes = chart.timeScale().getVisibleLogicalRange()!.from;
    const amplitudeAntes = amplitude(chart);
    const barrasPorPixel = amplitudeAntes / LARGURA;

    // Os dois vao 80 px para a DIREITA, um evento cada.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 380, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 580, clientY: 200, pointerId: 2 }));

    // Distancia final igual a inicial => zoom intacto.
    expect(amplitude(chart)).toBeCloseTo(amplitudeAntes, 6);

    // E o conteudo andou 80 px para a direita: a borda esquerda logica RECUOU
    // exatamente 80 px em barras (arrastar para a direita revela o passado).
    const esquerdaDepois = chart.timeScale().getVisibleLogicalRange()!.from;
    expect(esquerdaDepois).toBeCloseTo(esquerdaAntes - 80 * barrasPorPixel, 6);
  });

  it('um dedo so continua PANANDO', () => {
    const esquerdaAntes = chart.timeScale().getVisibleLogicalRange()!.from;
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 7 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 360, clientY: 200, pointerId: 7 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 360, clientY: 200, pointerId: 7 }));
    expect(Math.abs(chart.timeScale().getVisibleLogicalRange()!.from - esquerdaAntes)).toBeGreaterThan(1e-6);
  });

  /**
   * ⚠️ O DEFEITO QUE O RASTREIO PODE CRIAR SE FOR MAL FEITO: ponteiro fantasma.
   *
   * Se um dedo saisse da tela sem ser removido do mapa, TODO arrasto posterior de
   * um dedo seria lido como pinca e o pan nunca mais funcionaria — sem erro nenhum
   * no console. Estes tres casos afirmam que cada saida limpa o mapa.
   */
  it('`pointerup` limpa o ponteiro e devolve o pan', () => {
    doisDedos(300, 500);
    expect(ponteirosAtivos(chart)).toBe(2);
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 300, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 500, clientY: 200, pointerId: 2 }));
    expect(ponteirosAtivos(chart)).toBe(0);

    // E o pan de um dedo volta a funcionar.
    const esquerdaAntes = chart.timeScale().getVisibleLogicalRange()!.from;
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 3 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 340, clientY: 200, pointerId: 3 }));
    expect(Math.abs(chart.timeScale().getVisibleLogicalRange()!.from - esquerdaAntes)).toBeGreaterThan(1e-6);
  });

  it('`pointercancel` limpa o ponteiro — e nao vem `pointerup` depois dele', () => {
    doisDedos(300, 500);
    canvas.dispatchEvent(ponteiro('pointercancel', { clientX: 300, clientY: 200, pointerId: 1 }));
    expect(ponteirosAtivos(chart)).toBe(1);
    canvas.dispatchEvent(ponteiro('pointercancel', { clientX: 500, clientY: 200, pointerId: 2 }));
    expect(ponteirosAtivos(chart)).toBe(0);
  });

  it('`pointerleave` limpa o ponteiro que saiu pela borda', () => {
    doisDedos(300, 500);
    canvas.dispatchEvent(ponteiro('pointerleave', { clientX: 0, clientY: 200, pointerId: 1 }));
    expect(ponteirosAtivos(chart)).toBe(1);
  });

  it('a pinca encerra quando sobra um dedo: o proximo move nao da zoom', () => {
    doisDedos(300, 500);
    canvas.dispatchEvent(ponteiro('pointerup', { clientX: 500, clientY: 200, pointerId: 2 }));
    const amplitudeAntes = amplitude(chart);
    // O dedo que sobrou se move muito: se a pinca nao tivesse encerrado, a
    // distancia "para o fantasma" mudaria e daria zoom.
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 100, clientY: 200, pointerId: 1 }));
    expect(amplitude(chart)).toBeCloseTo(amplitudeAntes, 6);
  });

  it('dedos praticamente juntos NAO explodem o zoom (piso de distancia)', () => {
    // Distancia inicial de 2 px: abaixo do piso de 8 px.
    doisDedos(400, 402);
    const antes = amplitude(chart);
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 399, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 403, clientY: 200, pointerId: 2 }));
    // Sem o piso, a razao 4/2 = 2 (e depois razoes maiores) jogaria o espacamento
    // no teto num quadro. Com o piso, o gesto de contato e ignorado.
    expect(amplitude(chart)).toBeCloseTo(antes, 6);
  });
});

describe('pinca — as flags do contrato passaram a ser LIDAS', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let canvas: HTMLCanvasElement;

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  function montar(opts: Parameters<typeof createChart>[1]): void {
    el = montarContainer();
    chart = createChart(el, { autoSize: false, ...opts });
    canvas = canvasDe(el);
    chart.addSeries('Candlestick').setData(velas(200) as never);
  }

  it('`handleScale.pinch = false` desliga a pinca (a roda continua)', () => {
    montar({ handleScale: { mouseWheel: true, pinch: false } });
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 500, clientY: 200, pointerId: 2 }));
    const antes = amplitude(chart);
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 150, clientY: 200, pointerId: 1 }));
    canvas.dispatchEvent(ponteiro('pointermove', { clientX: 650, clientY: 200, pointerId: 2 }));
    expect(amplitude(chart)).toBeCloseTo(antes, 6);

    // Mas o zoom por roda segue vivo — a flag e so da pinca.
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400 }));
    expect(amplitude(chart)).toBeLessThan(antes);
  });

  it('`horzTouchDrag = false` desliga o pan por TOQUE e mantem o do mouse', () => {
    montar({
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: false, vertTouchDrag: true },
    });
    const esquerdaInicial = chart.timeScale().getVisibleLogicalRange()!.from;

    // Toque: nao pana.
    canvas.dispatchEvent(
      ponteiro('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 1, pointerType: 'touch' }),
    );
    canvas.dispatchEvent(
      ponteiro('pointermove', { clientX: 400, clientY: 200, pointerId: 1, pointerType: 'touch' }),
    );
    expect(chart.timeScale().getVisibleLogicalRange()!.from).toBeCloseTo(esquerdaInicial, 6);
    canvas.dispatchEvent(
      ponteiro('pointerup', { clientX: 400, clientY: 200, pointerId: 1, pointerType: 'touch' }),
    );

    // Mouse: pana.
    canvas.dispatchEvent(
      ponteiro('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 2, pointerType: 'mouse' }),
    );
    canvas.dispatchEvent(
      ponteiro('pointermove', { clientX: 400, clientY: 200, pointerId: 2, pointerType: 'mouse' }),
    );
    expect(Math.abs(chart.timeScale().getVisibleLogicalRange()!.from - esquerdaInicial)).toBeGreaterThan(1e-6);
  });

  it('`vertTouchDrag = false` desliga a escala de preco por TOQUE no eixo', () => {
    montar({
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    const interno = chart as unknown as { scalingPriceAxis: boolean };
    const xEixo = LARGURA - 20;
    canvas.dispatchEvent(
      ponteiro('pointerdown', { button: 0, clientX: xEixo, clientY: 200, pointerId: 1, pointerType: 'touch' }),
    );
    // Nao entrou em modo de escala de eixo.
    expect(interno.scalingPriceAxis).toBe(false);
  });
});
