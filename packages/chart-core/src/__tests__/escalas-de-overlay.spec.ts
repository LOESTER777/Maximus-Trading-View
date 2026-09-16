/**
 * Escalas de preco de OVERLAY — o defeito que deixava o grafico visualmente vazio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, COMO FOI VISTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Em 16/09/2026 o usuario fotografou o playground: **nenhuma vela na tela**. O
 * eixo de preco marcava 20.000 / 40.000 / ... / 120.000, e os alertas disparavam
 * em 130.100 — ou seja, o preco estava FORA da faixa do eixo, comprimido numa
 * linha de poucos pixels no topo.
 *
 * A causa eram DOIS defeitos na mesma raiz — o motor tinha uma escala de preco por
 * pane, e o `priceScaleId` das series era ignorado:
 *
 * 1. `autoScalePane` tomava min/max de TODAS as series da pane. O histograma de
 *    volume (0..~40.000) entrava no mesmo calculo do preco (~130.000), a faixa
 *    virava `0..130.000`, e as velas ocupavam ~2% da altura.
 * 2. `priceScale(id)` ignorava o `id` e devolvia sempre a escala do PRECO. Quando o
 *    consumidor empurrava o volume para o pe do painel com
 *    `scaleMargins: { top: 0.85 }`, estava comprimindo o PRECO.
 *
 * ⭐ Estes testes medem o MECANISMO, nao o sintoma: afirmam que a faixa da escala
 * do preco nao e contaminada pela magnitude do volume, e que a margem aplicada a
 * uma escala de overlay nao vaza para a principal. Sem isso, a correcao poderia
 * regredir e a suite continuaria verde (nenhum teste antigo olhava a FAIXA).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';
import type { PriceScaleState } from '../price-scale.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Acesso ao estado interno — a verdade observavel em jsdom
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ jsdom nao rasteriza (`getContext('2d')` e inerte), entao nao existe pixel a
 * inspecionar. A verdade observavel e o ESTADO das escalas, alcancado pelo campo
 * interno — do mesmo jeito que os testes do engine alcancam `serie.model`.
 */
interface PaneInterna {
  priceScale: PriceScaleState;
  overlayScales: Map<string, PriceScaleState>;
  series: unknown[];
}

function panes(chart: IChartApi): PaneInterna[] {
  return (chart as unknown as { panes: PaneInterna[] }).panes;
}

/** Força uma passada de autoescala sem esperar o quadro do rAF. */
function autoescalar(chart: IChartApi): void {
  const c = chart as unknown as { autoScalePane: (p: PaneInterna) => void; panes: PaneInterna[] };
  for (const p of c.panes) c.autoScalePane(p);
}

const PRECO_BASE = 130_000;
const VOLUME_BASE = 40_000;

/** Velas em torno de 130.000 — a ordem de magnitude do mini-indice. */
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

/** Volume em torno de 40.000 — duas ordens de magnitude abaixo do preco. */
function volume(n: number): Array<{ time: number; value: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * 60,
    value: VOLUME_BASE + (i % 7) * 1000,
  }));
}

describe('escalas de overlay — o volume nao contamina a escala do preco', () => {
  let container: HTMLDivElement;
  let chart: IChartApi;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);
    chart = createChart(container);
  });

  afterEach(() => {
    chart.remove();
    container.remove();
  });

  /**
   * ⭐ O TESTE QUE REPRODUZ O DEFEITO.
   *
   * Antes da correcao, a faixa do preco ia de ~0 a ~130.000 (contaminada pelo
   * volume) e as velas ficavam esmagadas. Depois, a faixa do preco cerca as velas.
   */
  it('a faixa da escala do preco cerca as VELAS, nao o volume', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);

    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(50) as never);

    autoescalar(chart);

    const precoScale = panes(chart)[0]!.priceScale;

    // As velas vao de ~129.950 a ~130.099. A escala tem de estar nessa vizinhanca,
    // com folga — NAO de 0 a 130.000.
    expect(precoScale.bottomPrice).toBeGreaterThan(PRECO_BASE - 1_000);
    expect(precoScale.topPrice).toBeLessThan(PRECO_BASE + 1_000);

    // ⚠️ A afirmacao que pega o defeito: a amplitude da escala do preco e da ordem
    // da variacao das velas (centenas), nao da magnitude do volume (dezenas de
    // milhares). Antes da correcao este span era ~136.000.
    const span = precoScale.topPrice - precoScale.bottomPrice;
    expect(span).toBeLessThan(1_000);
  });

  /**
   * ⭐ A PROVA DE QUE O TESTE ACIMA MEDE A CAUSA CERTA.
   *
   * Aqui o volume e adicionado SEM `priceScaleId`, entao ele compartilha a escala
   * do preco de proposito — e o span explode exatamente como explodia antes da
   * correcao. Isto documenta o mecanismo: o que separa as faixas e a escala por
   * `priceScaleId`, nao um ajuste de folga.
   *
   * ⚠️ Nao e um comportamento "errado" do motor: uma serie que declara a escala
   * principal DEVE ser escalada junto com o preco. O defeito era o `priceScaleId`
   * ser ignorado, deixando o consumidor sem como separar.
   */
  it('sem priceScaleId o volume DIVIDE a escala do preco — o mecanismo do defeito', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);

    // Sem `priceScaleId`: cai na escala principal.
    const vol = chart.addSeries('Histogram');
    vol.setData(volume(50) as never);

    autoescalar(chart);

    const span = panes(chart)[0]!.priceScale.topPrice - panes(chart)[0]!.priceScale.bottomPrice;
    // Faixa contaminada: cobre de ~40.000 a ~130.000. E o grafico "vazio" da foto.
    expect(span).toBeGreaterThan(50_000);
  });

  it('o volume tem escala PROPRIA, com faixa na magnitude dele', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(50) as never);
    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(50) as never);

    autoescalar(chart);

    const volScale = panes(chart)[0]!.overlayScales.get('volume');
    expect(volScale).toBeDefined();
    // A faixa do volume cobre ~40.000..46.000, nao o preco.
    expect(volScale!.topPrice).toBeGreaterThan(VOLUME_BASE);
    expect(volScale!.topPrice).toBeLessThan(VOLUME_BASE * 2);
  });

  /**
   * ⭐ Histograma ANCORA EM ZERO. Sem isso a menor barra teria altura zero e a
   * leitura de volume relativo se perderia; e a base do desenho
   * (`priceToCoordinate(0)`) cairia fora da escala.
   */
  it('escala so de histograma ancora a base no ZERO', () => {
    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(30) as never);

    autoescalar(chart);

    const volScale = panes(chart)[0]!.overlayScales.get('volume')!;
    expect(volScale.bottomPrice).toBe(0);
    // E nao ha faixa negativa: volume nao e negativo.
    expect(volScale.topPrice).toBeGreaterThan(0);
  });

  /**
   * ⭐ O SEGUNDO DEFEITO: `priceScale(id)` ignorava o id.
   *
   * Aplicar margem na escala do volume nao pode mexer na do preco. Antes da
   * correcao, este teste falharia — a margem do preco viraria 0.85 e as velas
   * seriam comprimidas nos 15% inferiores.
   */
  it('margem aplicada a uma escala de overlay NAO vaza para a do preco', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(20) as never);
    chart.addSeries('Histogram', { priceScaleId: 'volume' });

    const precoScale = panes(chart)[0]!.priceScale;
    const margemPrecoAntes = precoScale.marginTop;

    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // A escala do VOLUME recebeu a margem...
    const volScale = panes(chart)[0]!.overlayScales.get('volume')!;
    expect(volScale.marginTop).toBeCloseTo(0.85);
    expect(volScale.marginBottom).toBeCloseTo(0);

    // ...e a do PRECO ficou intacta. Esta e a asserção que pega o defeito.
    expect(precoScale.marginTop).toBeCloseTo(margemPrecoAntes);
    expect(precoScale.marginTop).toBeLessThan(0.5);
  });

  it('`right` e `left` resolvem para a escala principal, nao criam overlay', () => {
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.2, bottom: 0.2 } });
    const pane = panes(chart)[0]!;
    expect(pane.priceScale.marginTop).toBeCloseTo(0.2);
    expect(pane.overlayScales.has('right')).toBe(false);
    expect(pane.overlayScales.has('left')).toBe(false);
  });

  /**
   * A escala de overlay pode ser configurada ANTES de existir a serie que a usa —
   * o consumidor costuma ajustar margens na montagem, e a configuracao tem de
   * sobreviver a criacao posterior da serie.
   */
  it('configurar a escala antes de criar a serie preserva a margem', () => {
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.9, bottom: 0 } });
    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(10) as never);

    const volScale = panes(chart)[0]!.overlayScales.get('volume')!;
    expect(volScale.marginTop).toBeCloseTo(0.9);
  });

  /** Toda escala da pane recebe a ALTURA — overlay com altura 0 converteria tudo em null. */
  it('a escala de overlay recebe a altura da pane', () => {
    chart.addSeries('Histogram', { priceScaleId: 'volume' });
    const pane = panes(chart)[0]!;
    const volScale = pane.overlayScales.get('volume')!;
    expect(volScale.height).toBeGreaterThan(0);
    expect(volScale.height).toBeCloseTo(pane.priceScale.height);
  });

  /**
   * A serie converte contra a SUA escala. Uma serie de volume tem de mapear 40.000
   * para dentro da area util, e nao para fora (o que aconteceria na escala do preco).
   */
  it('a serie de volume converte na escala dela, dentro da area', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(30) as never);
    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(30) as never);
    autoescalar(chart);

    const y = vol.priceToCoordinate(VOLUME_BASE);
    expect(y).not.toBeNull();
    // Dentro da altura da pane.
    expect(y!).toBeGreaterThanOrEqual(0);
    expect(y!).toBeLessThanOrEqual(panes(chart)[0]!.priceScale.height);

    // ⚠️ E a MESMA magnitude lida na escala do PRECO cairia fora da area util —
    // e a prova de que as duas escalas sao de fato distintas.
    const yNaEscalaDoPreco = candles.priceToCoordinate(VOLUME_BASE);
    const alturaPane = panes(chart)[0]!.priceScale.height;
    expect(yNaEscalaDoPreco === null || yNaEscalaDoPreco > alturaPane).toBe(true);
  });

  /**
   * O arrasto do eixo congela a escala do PRECO (modo manual), mas a autoescala do
   * volume continua viva — sao escalas independentes.
   */
  it('escala manual do preco nao congela a autoescala do volume', () => {
    const candles = chart.addSeries('Candlestick');
    candles.setData(velas(30) as never);
    const vol = chart.addSeries('Histogram', { priceScaleId: 'volume' });
    vol.setData(volume(30) as never);
    autoescalar(chart);

    const pane = panes(chart)[0]! as unknown as PaneInterna & { priceScaleManual: boolean };
    pane.priceScaleManual = true;
    const precoTopoCongelado = pane.priceScale.topPrice;

    // Volume novo, muito maior: a escala do volume deve acompanhar.
    vol.setData(volume(30).map((v) => ({ ...v, value: v.value * 10 })) as never);
    autoescalar(chart);

    expect(pane.priceScale.topPrice).toBe(precoTopoCongelado); // preco congelado
    expect(pane.overlayScales.get('volume')!.topPrice).toBeGreaterThan(VOLUME_BASE * 5);
  });
});
