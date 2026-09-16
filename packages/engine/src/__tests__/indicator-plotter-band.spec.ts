/**
 * indicator-plotter-band — Bollinger/Keltner ganham uma FAIXA preenchida.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO SE TESTA SEM PIXEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O plotter fala com um `IChartApi`. Aqui injetamos um `IChartApi` FALSO que so
 * registra `addSeries(tipo, ...)` e o `setData` de cada serie. Afirmamos sobre o
 * MODELO do que foi criado, nao sobre pixel:
 *
 *  - um plot de Bollinger cria UMA serie 'Band' alem das tres linhas;
 *  - a serie de banda recebe pontos `{time, upper, lower}`, montados das saidas
 *    upper/lower do MESMO indicador;
 *  - a banda so tem ponto onde AMBAS as bordas ja aqueceram (nao durante o warmup);
 *  - a banda entra ANTES das linhas (renderiza por baixo).
 *
 * ⭐ Antes, `plot:'band'` caia em Line silenciosamente e a faixa nunca existia.
 */
import { describe, expect, it } from 'vitest';
import { IndicatorPlotter } from '../indicator-plotter.js';
import type { SeriesData, SeriesType } from '@robustus/chart-core';
import { bollingerFactory } from '@robustus/charts-indicators';

// ── IChartApi falso: registra series e dados, ignora o resto ────────────────

interface SerieRegistrada {
  readonly tipo: SeriesType;
  dados: readonly SeriesData[];
  readonly paneIndex: number;
}

function chartFalso() {
  const series: SerieRegistrada[] = [];
  let nextPane = 1;
  const api = {
    addSeries(tipo: SeriesType, _opts?: unknown, paneIndex = 0) {
      const reg: SerieRegistrada = { tipo, dados: [], paneIndex };
      series.push(reg);
      return {
        setData(d: readonly SeriesData[]) {
          reg.dados = d;
        },
        createPriceLine() {
          return { _id: 'x' };
        },
      } as never;
    },
    removeSeries() {},
    addPane() {
      return nextPane++;
    },
    removePane() {},
  };
  return { api: api as never, series };
}

/** Velas com oscilacao suficiente para a banda ter largura. */
function velas(n: number) {
  const base = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + Math.sin(i / 3) * 5;
    return { time: base + i * 60, open: close - 0.5, high: close + 1, low: close - 1, close };
  });
}

describe('IndicatorPlotter — banda de Bollinger', () => {
  it('cria UMA serie Band alem das tres linhas', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const inst = bollingerFactory.create({ period: 20, mult: 2 });

    plotter.setPlots(
      [{ id: 'bb', instance: inst as never }],
      velas(60),
    );

    const bandas = series.filter((s) => s.tipo === 'Band');
    const linhas = series.filter((s) => s.tipo === 'Line');
    expect(bandas).toHaveLength(1);
    expect(linhas).toHaveLength(3); // upper, middle, lower
  });

  it('a serie Band recebe pontos {time, upper, lower}', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const inst = bollingerFactory.create({ period: 20, mult: 2 });
    plotter.setPlots([{ id: 'bb', instance: inst as never }], velas(60));

    const banda = series.find((s) => s.tipo === 'Band')!;
    expect(banda.dados.length).toBeGreaterThan(0);
    const p0 = banda.dados[0] as unknown as { time: number; upper: number; lower: number };
    expect(p0.time).toBeGreaterThan(0);
    expect(Number.isFinite(p0.upper)).toBe(true);
    expect(Number.isFinite(p0.lower)).toBe(true);
    // upper acima de lower na banda de Bollinger.
    expect(p0.upper).toBeGreaterThan(p0.lower);
  });

  it('a banda so tem ponto onde AMBAS as bordas aqueceram', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const period = 20;
    const inst = bollingerFactory.create({ period, mult: 2 });
    const dados = velas(60);
    plotter.setPlots([{ id: 'bb', instance: inst as never }], dados);

    const banda = series.find((s) => s.tipo === 'Band')!;
    // Bollinger aquece em `period` barras: os pontos de banda comecam so depois.
    expect(banda.dados.length).toBe(dados.length - (period - 1));
  });

  it('a banda entra ANTES das linhas (renderiza por baixo)', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const inst = bollingerFactory.create({ period: 20 });
    plotter.setPlots([{ id: 'bb', instance: inst as never }], velas(60));

    const idxBanda = series.findIndex((s) => s.tipo === 'Band');
    const idxPrimeiraLinha = series.findIndex((s) => s.tipo === 'Line');
    expect(idxBanda).toBeLessThan(idxPrimeiraLinha);
  });
});
