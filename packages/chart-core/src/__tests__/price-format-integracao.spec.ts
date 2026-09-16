/**
 * price-format-integracao — o motor USA o formatador quando ha `priceFormat`.
 *
 * Sem pixel: afirma sobre a STRING que o rotulo de crosshair produz (a mesma que
 * o eixo pinta) e sobre o fallback quando `priceFormat` esta ausente.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobustusChartCore } from '../chart.js';

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

function velas(n: number) {
  const base = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: base + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));
}

/** Chama o `priceLabelForCrosshair` privado num Y conhecido da pane 0. */
function rotuloEmY(chart: RobustusChartCore, y: number): string | null {
  const priv = chart as unknown as {
    priceLabelForCrosshair: (pane: unknown, local: { x: number; y: number }) => string | null;
    rebuildTimes: () => void;
    autoScalePane: (p: unknown) => void;
    panes: Array<unknown>;
  };
  priv.rebuildTimes();
  chart.timeScale().fitContent();
  priv.autoScalePane(priv.panes[0]);
  return priv.priceLabelForCrosshair(priv.panes[0], { x: 400, y });
}

describe('priceFormat no motor', () => {
  it('sem priceFormat: cai na heuristica de amplitude (comportamento anterior)', () => {
    const chart = new RobustusChartCore(container);
    try {
      const s = chart.addSeries('Candlestick');
      s.setData(velas(30));
      const label = rotuloEmY(chart, 200);
      expect(label).not.toBeNull();
      // Heuristica: amplitude ~30 => 1 casa decimal.
      expect(label).toMatch(/^\d+\.\d$/);
    } finally {
      chart.remove();
    }
  });

  it('com tickSize 0.5: o rotulo do crosshair tem 1 casa e e multiplo de 0.5', () => {
    const chart = new RobustusChartCore(container, {
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.2 }, priceFormat: { tickSize: 0.5 } },
    });
    try {
      const s = chart.addSeries('Candlestick');
      s.setData(velas(30));
      const label = rotuloEmY(chart, 200);
      expect(label).not.toBeNull();
      // 1 casa decimal (tick 0.5), terminando em .0 ou .5.
      expect(label).toMatch(/^\d+\.[05]$/);
    } finally {
      chart.remove();
    }
  });

  it('com precision 3: o rotulo tem exatamente 3 casas', () => {
    const chart = new RobustusChartCore(container, {
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.2 }, priceFormat: { precision: 3 } },
    });
    try {
      const s = chart.addSeries('Candlestick');
      s.setData(velas(30));
      const label = rotuloEmY(chart, 200);
      expect(label).not.toBeNull();
      expect(label).toMatch(/^\d+\.\d{3}$/);
    } finally {
      chart.remove();
    }
  });

  it('priceFormat sobrevive ao applyOptions e ao merge', () => {
    const chart = new RobustusChartCore(container, {
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.2 }, priceFormat: { tickSize: 5 } },
    });
    try {
      // applyOptions que NAO mexe em rightPriceScale nao pode apagar o priceFormat.
      chart.applyOptions({ layout: { background: { color: '#000' }, textColor: '#fff' } });
      const pf = chart.options().rightPriceScale.priceFormat;
      expect(pf?.tickSize).toBe(5);
    } finally {
      chart.remove();
    }
  });
});
