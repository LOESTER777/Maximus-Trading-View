/**
 * band-series — o SeriesType 'Band': faixa entre upper e lower.
 *
 * Sem pixel: afirma sobre o MODELO (a serie guarda os pontos de banda) e sobre a
 * AUTOESCALA (a pane enquadra upper e lower), que e onde o defeito moraria — uma
 * banda cortada pela borda vem de a autoescala ignorar upper/lower.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobustusChartCore } from '../chart.js';
import type { BandData } from '../contracts.js';

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

function bandas(n: number): BandData[] {
  const base = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: base + i * 60,
    upper: 110 + i,
    lower: 90 + i,
  }));
}

describe("SeriesType 'Band'", () => {
  it('a serie de banda guarda os pontos {time, upper, lower}', () => {
    const chart = new RobustusChartCore(container);
    try {
      const b = chart.addSeries('Band');
      b.setData(bandas(10));
      const model = (b as unknown as { model: { type: string; data: BandData[] } }).model;
      expect(model.type).toBe('Band');
      expect(model.data).toHaveLength(10);
      expect(model.data[0]!.upper).toBe(110);
      expect(model.data[0]!.lower).toBe(90);
    } finally {
      chart.remove();
    }
  });

  it('a autoescala enquadra upper E lower da banda', () => {
    const chart = new RobustusChartCore(container);
    try {
      const b = chart.addSeries('Band');
      b.setData(bandas(30));
      chart.timeScale().fitContent();

      const priv = chart as unknown as {
        rebuildTimes: () => void;
        autoScalePane: (p: unknown) => void;
        panes: Array<{ priceScale: { topPrice: number; bottomPrice: number } }>;
      };
      priv.rebuildTimes();
      priv.autoScalePane(priv.panes[0]);

      const ps = priv.panes[0]!.priceScale;
      // A faixa vai de lower minimo (90) a upper maximo (110+29=139). A escala
      // precisa conter os dois extremos, com alguma folga.
      expect(ps.topPrice).toBeGreaterThanOrEqual(139);
      expect(ps.bottomPrice).toBeLessThanOrEqual(90);
    } finally {
      chart.remove();
    }
  });

  it('desenhar uma banda com pontos nao-finitos no meio nao lanca', () => {
    const chart = new RobustusChartCore(container);
    try {
      const b = chart.addSeries('Band');
      const dados: BandData[] = [
        ...bandas(5),
        { time: 1_700_000_000 + 5 * 60, upper: NaN, lower: NaN },
        ...bandas(5).map((d) => ({ ...d, time: d.time + 10 * 60 })),
      ];
      expect(() => b.setData(dados)).not.toThrow();
    } finally {
      chart.remove();
    }
  });
});
