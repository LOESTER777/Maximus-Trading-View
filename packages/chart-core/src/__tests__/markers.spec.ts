/**
 * markers — o marcador honra `shape` e `text`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO SE TESTA ISTO SEM PIXEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `jsdom` nao rasteriza (`getContext('2d')` e null; o motor usa um contexto
 * inerte). Nao ha pixel para inspecionar. Entao afirmamos sobre:
 *
 *  1. o MODELO — `serie.model.markers` guarda shape/text/position intactos;
 *  2. a CHAMADA de canvas — injetamos um contexto-espia no lugar do inerte e
 *     conferimos QUAIS operacoes cada forma dispara: quadrado => `fillRect`,
 *     setas => `moveTo`/`lineTo`/`fill` (triangulo), circulo => `arc`, e o texto
 *     => `fillText` com o conteudo certo.
 *
 * ⭐ O defeito que estes testes travam: `drawMarkers` desenhava SEMPRE `arc`,
 * ignorando shape e text. Uma seta de compra virava bolinha; um rotulo nunca
 * aparecia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RobustusChartCore } from '../chart.js';
import type { SeriesMarker } from '../contracts.js';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

/** Velas contiguas em segundos. */
function velas(n: number): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const base = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: base + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));
}

/**
 * Contexto-espia com as operacoes de desenho relevantes. Retorna objeto vazio de
 * `measureText` para o caminho de texto nao quebrar. Substitui o `ctx` interno.
 */
function contextoEspia() {
  return {
    calls: [] as string[],
    textos: [] as string[],
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(function (this: { calls: string[] }) {}),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 10 }),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

/** Chama o `drawMarkers` privado com um contexto-espia e devolve o espia. */
function desenharMarcadores(chart: RobustusChartCore, marks: readonly SeriesMarker[]) {
  const serie = chart.addSeries('Candlestick');
  serie.setData(velas(10));
  serie.setMarkers(marks);

  const espia = contextoEspia();
  const priv = chart as unknown as {
    drawMarkers: (ctx: unknown, pane: unknown) => void;
    rebuildTimes: () => void;
    panes: Array<unknown>;
  };
  // O eixo de tempo (`ts.times`) so e preenchido dentro de `render()`, via
  // `rebuildTimes`. Como chamamos `drawMarkers` fora do laco de render (para
  // injetar o espia), reconstruimos os tempos a mao antes — senao
  // `timeToCoordinate` devolveria null para todo marcador e nada seria desenhado.
  priv.rebuildTimes();
  priv.drawMarkers(espia, priv.panes[0]);
  return espia;
}

describe('SeriesMarker — o modelo preserva shape e text', () => {
  it('guarda cada shape e o text opcional', () => {
    const chart = new RobustusChartCore(container);
    try {
      const serie = chart.addSeries('Candlestick');
      serie.setData(velas(5));
      const marks: SeriesMarker[] = [
        { time: velas(5)[1]!.time, position: 'belowBar', color: '#16c784', shape: 'arrowUp', text: 'B' },
        { time: velas(5)[3]!.time, position: 'aboveBar', color: '#ea3943', shape: 'arrowDown', text: 'S' },
      ];
      serie.setMarkers(marks);
      const model = (serie as unknown as { model: { markers: SeriesMarker[] } }).model;
      expect(model.markers).toHaveLength(2);
      expect(model.markers[0]!.shape).toBe('arrowUp');
      expect(model.markers[0]!.text).toBe('B');
      expect(model.markers[1]!.shape).toBe('arrowDown');
    } finally {
      chart.remove();
    }
  });
});

describe('drawMarkers — cada forma dispara a operacao de canvas certa', () => {
  it('square usa fillRect (nao arc)', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: velas(10)[2]!.time, position: 'inBar', color: '#fff', shape: 'square' },
      ]);
      expect(e.fillRect).toHaveBeenCalled();
      expect(e.arc).not.toHaveBeenCalled();
    } finally {
      chart.remove();
    }
  });

  it('arrowUp e arrowDown desenham triangulo (moveTo+lineTo+fill), nao arc', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: velas(10)[2]!.time, position: 'belowBar', color: '#16c784', shape: 'arrowUp' },
        { time: velas(10)[5]!.time, position: 'aboveBar', color: '#ea3943', shape: 'arrowDown' },
      ]);
      expect(e.moveTo).toHaveBeenCalled();
      expect(e.lineTo).toHaveBeenCalled();
      expect(e.closePath).toHaveBeenCalled();
      expect(e.fill).toHaveBeenCalled();
      expect(e.arc).not.toHaveBeenCalled();
    } finally {
      chart.remove();
    }
  });

  it('circle ainda usa arc — o comportamento antigo preservado para essa forma', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: velas(10)[2]!.time, position: 'inBar', color: '#fff', shape: 'circle' },
      ]);
      expect(e.arc).toHaveBeenCalled();
    } finally {
      chart.remove();
    }
  });

  it('desenha o text ao lado do marcador quando presente', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: velas(10)[2]!.time, position: 'belowBar', color: '#16c784', shape: 'arrowUp', text: 'COMPRA' },
      ]);
      expect(e.fillText).toHaveBeenCalled();
      const arg0 = (e.fillText as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
      expect(arg0).toBe('COMPRA');
    } finally {
      chart.remove();
    }
  });

  it('sem text, nenhum fillText e emitido', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: velas(10)[2]!.time, position: 'inBar', color: '#fff', shape: 'circle' },
      ]);
      expect(e.fillText).not.toHaveBeenCalled();
    } finally {
      chart.remove();
    }
  });

  it('marcador com tempo FORA da serie e pulado, sem lancar', () => {
    const chart = new RobustusChartCore(container);
    try {
      const e = desenharMarcadores(chart, [
        { time: 42, position: 'aboveBar', color: '#fff', shape: 'square' },
      ]);
      // Tempo 42 nao existe na serie (que comeca em ~1.7e9): nada e desenhado.
      expect(e.fillRect).not.toHaveBeenCalled();
      expect(e.arc).not.toHaveBeenCalled();
    } finally {
      chart.remove();
    }
  });
});
