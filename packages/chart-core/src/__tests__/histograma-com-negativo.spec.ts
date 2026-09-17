/**
 * Histograma que oscila em torno do ZERO — o defeito que fazia o indicador desaparecer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O RELATO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"os indicadores de histograma novos não estão ficando persistentes no gráfico"*.
 *
 * ⭐ A causa não era persistência, ciclo de vida nem pane órfã: era a AUTOESCALA. A
 * regra "grupo só de histograma ancora a base no ZERO" foi escrita para o VOLUME, onde a
 * premissa *"não é negativo"* é verdadeira, e era aplicada a QUALQUER escala cujo grupo
 * fosse inteiramente de histograma — descartando o mínimo.
 *
 * Awesome Oscillator e a direção do SuperTrend declaram o histograma como ÚNICA saída da
 * pane separada, então o grupo é só-histograma e o dado oscila em torno de zero. Dois
 * regimes, ambos vistos como "some e volta":
 *
 *  1. Janela com máximo positivo: faixa `0..max`, e toda barra negativa cai fora do
 *     recorte da pane. Metade do indicador não existe na tela.
 *  2. Janela inteiramente negativa: `autoScale(escala, 0, negativo)` produz folga
 *     negativa e faixa INVERTIDA — barras espelhadas e eixo sem nenhum rótulo.
 *
 * ⚠️ MACD não sofria: a pane dele tem duas linhas junto, então o grupo não é
 * só-histograma. Foi o que fez o defeito parecer aleatório — "uns funcionam, outros não".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A invariante é **"o zero está dentro da faixa"**, e não "a base é zero". É a premissa
 * do próprio desenho: `drawHistogram` mede a altura da barra contra a coordenada do
 * zero. Zero fora da faixa é barra medida contra o pé do retângulo — desenho sem
 * significado.
 *
 * ⚠️ E o arquivo trava as DUAS pontas: o caso do indicador (com negativo) e o caso do
 * volume (sem negativo, base colada no zero). Sem o segundo, "corrigir" poderia ser
 * simplesmente remover a âncora — e o volume voltaria a desenhar a menor barra com
 * altura zero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';
import { priceTicks, priceToCoordinate, type PriceScaleState } from '../price-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;

interface PaneInterna {
  priceScale: PriceScaleState;
  overlayScales: Map<string, PriceScaleState>;
  series: unknown[];
  index: number;
}

function panes(chart: IChartApi): PaneInterna[] {
  return (chart as unknown as { panes: PaneInterna[] }).panes;
}

/** Força uma passada de autoescala sem esperar o quadro do rAF. */
function autoescalar(chart: IChartApi): void {
  const c = chart as unknown as {
    autoScalePane: (p: PaneInterna) => void;
    panes: PaneInterna[];
    rebuildTimes: () => void;
  };
  c.rebuildTimes();
  for (const p of c.panes) c.autoScalePane(p);
}

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

const T0 = 1_700_000_000;

function velas(n: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 5) * 8;
    return { time: T0 + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 };
  });
}

/** Pontos de histograma a partir de uma função do índice. */
function histograma(n: number, f: (i: number) => number): Array<{ time: number; value: number }> {
  return Array.from({ length: n }, (_, i) => ({ time: T0 + i * 60, value: f(i) }));
}

describe('histograma de indicador — o ZERO tem de estar na faixa', () => {
  let el: HTMLElement;
  let chart: IChartApi;

  beforeEach(() => {
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    chart.addSeries('Candlestick').setData(velas(120) as never);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  /** Cria uma pane separada com UM histograma, como o `IndicatorPlotter` faz. */
  function paneDeHistograma(pontos: Array<{ time: number; value: number }>): PaneInterna {
    const idx = chart.addPane();
    chart.addSeries('Histogram', { color: '#22d3ee' } as never, idx).setData(pontos as never);
    chart.timeScale().fitContent();
    autoescalar(chart);
    const pane = panes(chart).find((p) => p.index === idx);
    if (pane === undefined) throw new Error('pane nao criada');
    return pane;
  }

  it('⭐ oscilando em torno de zero, a faixa cobre o MÍNIMO negativo', () => {
    // O perfil do Awesome Oscillator: vai a −50 e sobe a +5.
    const pane = paneDeHistograma(histograma(120, (i) => Math.sin(i / 9) * 27.5 - 22.5));
    const ps = pane.priceScale;

    // ⚠️ Antes: `bottomPrice === 0` e todo o trecho negativo caía fora do recorte.
    expect(ps.bottomPrice).toBeLessThan(-45);
    expect(ps.topPrice).toBeGreaterThan(4);
    // E o zero continua na faixa — é contra ele que a barra é medida.
    expect(ps.bottomPrice).toBeLessThanOrEqual(0);
    expect(ps.topPrice).toBeGreaterThanOrEqual(0);
  });

  it('⭐ a barra mais negativa é DESENHÁVEL (dentro da altura útil da pane)', () => {
    const pane = paneDeHistograma(histograma(120, (i) => Math.sin(i / 9) * 27.5 - 22.5));
    const ps = pane.priceScale;

    const yMin = priceToCoordinate(ps, -50);
    const yZero = priceToCoordinate(ps, 0);
    // Guarda de vacuidade: sem conversão não há o que afirmar.
    expect(yMin).not.toBeNull();
    expect(yZero).not.toBeNull();
    // ⭐ A prova do sintoma: o pixel da barra mais negativa cai DENTRO da pane. Era
    // isto que falhava — `y` saía muitas alturas abaixo e o `clip` apagava a barra.
    expect(yMin!).toBeGreaterThan(0);
    expect(yMin!).toBeLessThanOrEqual(ps.height);
    // E abaixo do zero, que é onde barra negativa pertence.
    expect(yMin!).toBeGreaterThan(yZero!);
  });

  it('⭐ janela INTEIRAMENTE negativa não inverte a faixa nem apaga o eixo', () => {
    // O perfil da direção do SuperTrend em tendência de baixa: −1 constante.
    const pane = paneDeHistograma(histograma(120, () => -1));
    const ps = pane.priceScale;

    // ⚠️ Antes: `topPrice = −1,05` com `bottomPrice = 0` ⇒ span NEGATIVO.
    expect(ps.topPrice).toBeGreaterThan(ps.bottomPrice);
    expect(ps.bottomPrice).toBeLessThanOrEqual(-1);
    // ⭐ O sintoma diagnóstico que confirmava a inversão: eixo sem rótulo nenhum.
    // `priceTicks` devolve vazio para span <= 0.
    expect(priceTicks(ps).length).toBeGreaterThan(0);
  });

  it('valores todos POSITIVOS continuam com a base colada no zero', () => {
    // É o caso do volume, e a razão de a âncora existir: sem ela a menor barra teria
    // altura zero e o operador leria "não houve volume" onde houve.
    const pane = paneDeHistograma(histograma(120, (i) => 1_000 + i * 10));
    expect(pane.priceScale.bottomPrice).toBe(0);
    expect(pane.priceScale.topPrice).toBeGreaterThan(2_190);
  });

  it('o VOLUME em escala de overlay não mudou de comportamento', () => {
    // A prova de que a correção não vazou para o caminho que ela não deveria tocar.
    const volume = chart.addSeries('Histogram', { priceScaleId: 'volume' } as never);
    volume.setData(histograma(120, (i) => 5_000 + (i % 7) * 800) as never);
    chart.timeScale().fitContent();
    autoescalar(chart);

    const escala = panes(chart)[0]!.overlayScales.get('volume');
    expect(escala).toBeDefined();
    expect(escala!.bottomPrice).toBe(0);
    expect(escala!.topPrice).toBeGreaterThan(9_800);
  });

  it('histograma que só toca zero por cima (mínimo exatamente 0) mantém a base em zero', () => {
    // Fronteira: `min === 0` é "não negativo", então a base cola. Sem esta guarda o
    // `Math.min(0, min)` daria o mesmo número e a folga de 5% abriria faixa negativa.
    const pane = paneDeHistograma(histograma(120, (i) => (i % 3 === 0 ? 0 : 40)));
    expect(pane.priceScale.bottomPrice).toBe(0);
  });
});
