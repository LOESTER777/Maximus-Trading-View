/**
 * crosshair-ohlc — o evento de crosshair traz o dado da barra sob o cursor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E TESTAVEL SEM PIXEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `jsdom` nao rasteriza, mas a resolucao da barra sob o cursor e pura logica de
 * coordenada -> indice -> dado. Afirmamos sobre o `seriesData` que o motor monta:
 *
 *  - Candlestick/Bar => {open,high,low,close};
 *  - Line/Area => {value};
 *  - sem barra sob o cursor => campo AUSENTE (tolerante).
 *
 * ⭐ E o insumo da legenda O/H/L/C. O motor nao desenha legenda — so entrega o
 * dado, para o consumidor montar a sua.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobustusChartCore } from '../chart.js';
import type { CrosshairSeriesData } from '../contracts.js';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

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
 * Alcanca o `barSobCursor` privado apos reconstruir os tempos e enquadrar.
 *
 * `barSobCursor` depende de `coordinateToTime`, que exige a janela logica
 * definida — por isso chamamos `rebuildTimes` + `fitContent` antes, o que o
 * `render()` faria no laco normal.
 */
function barNaCoordenada(chart: RobustusChartCore, x: number): CrosshairSeriesData | undefined {
  const priv = chart as unknown as {
    barSobCursor: (x: number) => CrosshairSeriesData | undefined;
    rebuildTimes: () => void;
  };
  priv.rebuildTimes();
  chart.timeScale().fitContent();
  return priv.barSobCursor(x);
}

describe('barSobCursor / seriesData', () => {
  it('serie de velas devolve OHLC da barra sob o cursor', () => {
    const chart = new RobustusChartCore(container);
    try {
      const serie = chart.addSeries('Candlestick');
      serie.setData(velas(20));
      // O eixo de tempo (`ts.times`) so e preenchido no render; reconstroi a mao.
      (chart as unknown as { rebuildTimes: () => void }).rebuildTimes();
      chart.timeScale().fitContent();
      // Coordenada de uma barra conhecida, via a propria escala de tempo.
      const x = chart.timeScale().timeToCoordinate(velas(20)[10]!.time);
      expect(x).not.toBeNull();
      const d = barNaCoordenada(chart, x as number);
      expect(d).toBeDefined();
      expect(d!.open).toBeCloseTo(110);
      expect(d!.high).toBeCloseTo(111);
      expect(d!.low).toBeCloseTo(109);
      expect(d!.close).toBeCloseTo(110.5);
      expect(d!.value).toBeUndefined();
    } finally {
      chart.remove();
    }
  });

  it('serie de linha devolve {value}, nao OHLC', () => {
    const chart = new RobustusChartCore(container);
    try {
      const serie = chart.addSeries('Line');
      serie.setData(velas(10).map((v) => ({ time: v.time, value: v.close })) as never);
      (chart as unknown as { rebuildTimes: () => void }).rebuildTimes();
      chart.timeScale().fitContent();
      const x = chart.timeScale().timeToCoordinate(velas(10)[4]!.time);
      const d = barNaCoordenada(chart, x as number);
      expect(d).toBeDefined();
      expect(d!.value).toBeCloseTo(104.5);
      expect(d!.open).toBeUndefined();
    } finally {
      chart.remove();
    }
  });

  it('grafico vazio: sem barra, campo ausente (nao lanca)', () => {
    const chart = new RobustusChartCore(container);
    try {
      const d = barNaCoordenada(chart, 400);
      expect(d).toBeUndefined();
    } finally {
      chart.remove();
    }
  });

  it('o evento de crosshair carrega seriesData quando ha barra', () => {
    const chart = new RobustusChartCore(container);
    try {
      const serie = chart.addSeries('Candlestick');
      serie.setData(velas(20));
      chart.timeScale().fitContent();
      (chart as unknown as { rebuildTimes: () => void }).rebuildTimes();

      let recebido: CrosshairSeriesData | undefined;
      chart.subscribeCrosshairMove((p) => {
        recebido = p.seriesData;
      });

      // Simula o cursor sobre a coluna de uma barra. O motor le a coordenada do
      // proprio evento (clientX menos o rect); em jsdom o rect e zero, entao
      // usamos diretamente a coluna da barra 8.
      const x = chart.timeScale().timeToCoordinate(velas(20)[8]!.time) as number;
      const priv = chart as unknown as {
        crosshair: { x: number; y: number } | null;
        emitCrosshair: () => void;
      };
      priv.crosshair = { x, y: 100 };
      priv.emitCrosshair();

      expect(recebido).toBeDefined();
      expect(recebido!.close).toBeCloseTo(108.5);
    } finally {
      chart.remove();
    }
  });
});
