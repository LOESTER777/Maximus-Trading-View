/**
 * Backfill de histórico — barras inseridas ANTES não podem saltar a tela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O MECANISMO, E POR QUE ELE É NECESSÁRIO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `leftLogical` é um ÍNDICE no array de barras. Inserir 500 barras na frente empurra o
 * índice de TODAS as existentes em 500 — a barra que era a 0 passa a ser a 500. A
 * janela continua apontando para o índice antigo, e a tela salta 500 barras para o
 * PASSADO no instante em que o histórico chega.
 *
 * ⚠️ O salto acontece no pior momento possível: o operador está arrastando para trás
 * olhando um trecho, o backfill responde, e o trecho que ele investigava desaparece.
 *
 * ⚠️ E havia um segundo efeito, oposto e igualmente ruim: o motor só comparava a
 * CONTAGEM de barras, então um prepend era lido como "500 barras novas ao vivo". Com a
 * visão colada no tempo real, `onBarsAppended` rolava o eixo 500 barras para a FRENTE.
 *
 * A correção: detectar por CONTEÚDO quantos tempos novos são anteriores ao que era o
 * primeiro, compensar `leftLogical` com `onBarsPrepended`, e descontar essas barras do
 * delta do append. Estes casos medem exatamente isso.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi, ISeriesApi, SeriesType } from '../contracts.js';
import { onBarsPrepended, type TimeScaleState } from '../time-scale.core.js';

const LARGURA = 800;
const ALTURA = 400;
const T0 = 1_700_000_000;
const PASSO = 60;

/** Velas de `i` a `i+n-1` na grade de 60 s. Índice negativo = passado. */
function velas(n: number, desdeIndice = 0) {
  return Array.from({ length: n }, (_, k) => {
    const i = desdeIndice + k;
    const p = 100 + i;
    return { time: T0 + i * PASSO, open: p, high: p + 1, low: p - 1, close: p + 0.5 };
  });
}

interface Interno {
  render: (agora?: number) => void;
  ts: TimeScaleState;
}

function interno(chart: IChartApi): Interno {
  return chart as unknown as Interno;
}

describe('onBarsPrepended — o núcleo', () => {
  function estado(left: number): TimeScaleState {
    return { leftLogical: left } as unknown as TimeScaleState;
  }

  it('empurra leftLogical pelo número de barras inseridas', () => {
    const s = estado(10);
    onBarsPrepended(s, 500);
    expect(s.leftLogical).toBe(510);
  });

  it('zero ou negativo é no-op — nada foi inserido na frente', () => {
    const s = estado(10);
    onBarsPrepended(s, 0);
    onBarsPrepended(s, -5);
    expect(s.leftLogical).toBe(10);
  });

  it('valor não-finito não envenena o eixo', () => {
    const s = estado(10);
    onBarsPrepended(s, NaN);
    expect(s.leftLogical).toBe(10);
  });
});

describe('⭐ backfill no motor — a tela NÃO se move', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let serie: ISeriesApi<SeriesType>;

  beforeEach(() => {
    el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
    document.body.appendChild(el);
    chart = createChart(el, { autoSize: false });
    serie = chart.addSeries('Candlestick');
    serie.setData(velas(200) as never);
    interno(chart).render(0);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  /**
   * ⭐ O CASO CENTRAL: as MESMAS barras continuam nos MESMOS pixels.
   *
   * Medimos pelo TEMPO sob uma coluna fixa da tela, que é o que o operador vê. Se a
   * compensação falhar, o tempo sob aquela coluna muda — a tela saltou.
   */
  it('o TEMPO sob uma coluna fixa da tela não muda com o prepend', () => {
    // O operador arrastou para trás: janela olhando o começo do lote.
    chart.timeScale().setVisibleLogicalRange({ from: 5, to: 60 });
    interno(chart).render(0);

    const coluna = 300;
    const antes = chart.timeScale().coordinateToTime(coluna);
    expect(antes).not.toBeNull();

    // Chega o histórico: 500 barras ANTES das 200 que já existiam.
    serie.setData([...velas(500, -500), ...velas(200)] as never);
    interno(chart).render(0);

    const depois = chart.timeScale().coordinateToTime(coluna);
    expect(depois).toBe(antes);
  });

  it('o índice da janela é deslocado exatamente pelas barras inseridas', () => {
    chart.timeScale().setVisibleLogicalRange({ from: 5, to: 60 });
    interno(chart).render(0);
    const leftAntes = interno(chart).ts.leftLogical;

    serie.setData([...velas(500, -500), ...velas(200)] as never);
    interno(chart).render(0);

    expect(interno(chart).ts.leftLogical).toBeCloseTo(leftAntes + 500, 6);
  });

  /**
   * ⚠️ O caso que mostra o OUTRO defeito: com a visão colada no tempo real, o prepend
   * era lido como barra nova e rolava o eixo para a frente. Aqui a visão está no tempo
   * real, e o histórico que chega atrás não pode movê-la.
   */
  it('colado no tempo real, o prepend não rola o eixo para a frente', () => {
    chart.timeScale().scrollToRealTime();
    interno(chart).render(0);
    const ultimoTempo = T0 + 199 * PASSO;
    const xAntes = chart.timeScale().timeToCoordinate(ultimoTempo);

    serie.setData([...velas(500, -500), ...velas(200)] as never);
    interno(chart).render(0);

    // A última barra continua no mesmo lugar da tela.
    expect(chart.timeScale().timeToCoordinate(ultimoTempo)).toBeCloseTo(xAntes as number, 6);
  });

  /**
   * ⭐ Prepend E append no MESMO pacote: um provedor que devolve histórico junto com a
   * barra que fechou. As duas pontas têm de ser tratadas certo — o histórico compensa
   * o índice, a barra nova rola a visão que estava colada no tempo real.
   */
  it('histórico + barra nova no mesmo pacote: cada ponta na sua reação', () => {
    chart.timeScale().scrollToRealTime();
    interno(chart).render(0);
    const leftAntes = interno(chart).ts.leftLogical;

    // 500 antes + 1 depois.
    serie.setData([...velas(500, -500), ...velas(201)] as never);
    interno(chart).render(0);

    // +500 pelo prepend, +1 pelo append (estava colado no tempo real).
    expect(interno(chart).ts.leftLogical).toBeCloseTo(leftAntes + 501, 6);
  });

  /**
   * ⚠️ Quem NÃO está colado no tempo real não pode ser arrastado pela barra nova — e o
   * prepend não pode reintroduzir esse arrasto pela porta de trás.
   */
  it('rolado para o passado: prepend compensa, append não arrasta', () => {
    chart.timeScale().setVisibleLogicalRange({ from: 20, to: 80 });
    interno(chart).render(0);
    const leftAntes = interno(chart).ts.leftLogical;

    serie.setData([...velas(500, -500), ...velas(201)] as never);
    interno(chart).render(0);

    // Só os 500 do prepend. A barra nova ao vivo não move quem está investigando o
    // passado.
    expect(interno(chart).ts.leftLogical).toBeCloseTo(leftAntes + 500, 6);
  });

  it('backfill sucessivo acumula corretamente', () => {
    chart.timeScale().setVisibleLogicalRange({ from: 5, to: 60 });
    interno(chart).render(0);
    const coluna = 250;
    const antes = chart.timeScale().coordinateToTime(coluna);

    // Primeiro lote de histórico: 100 barras antes.
    serie.setData([...velas(100, -100), ...velas(200)] as never);
    interno(chart).render(0);
    // Segundo lote: 300 barras ANTES do que já havia (o trecho -100..-1 continua lá —
    // um backfill acrescenta, não substitui).
    serie.setData([...velas(300, -400), ...velas(100, -100), ...velas(200)] as never);
    interno(chart).render(0);

    expect(chart.timeScale().coordinateToTime(coluna)).toBe(antes);
  });

  /**
   * ⚠️ Guarda de vacuidade do arquivo: um append PURO tem de continuar rolando a visão
   * colada no tempo real. Se a detecção de prepend passasse a engolir o append, todos
   * os casos acima continuariam verdes e o gráfico ao vivo pararia de acompanhar.
   */
  it('append puro continua rolando a visão colada no tempo real', () => {
    chart.timeScale().scrollToRealTime();
    interno(chart).render(0);
    const leftAntes = interno(chart).ts.leftLogical;

    serie.setData(velas(210) as never);
    interno(chart).render(0);

    expect(interno(chart).ts.leftLogical).toBeCloseTo(leftAntes + 10, 6);
  });

  it('substituir por uma série de OUTRO instrumento não trava nem lança', () => {
    chart.timeScale().setVisibleLogicalRange({ from: 5, to: 60 });
    interno(chart).render(0);
    expect(() => {
      // Tempos completamente diferentes, contagem menor.
      serie.setData(
        Array.from({ length: 50 }, (_, i) => {
          const p = 500 + i;
          return { time: T0 + 10_000_000 + i * PASSO, open: p, high: p + 1, low: p - 1, close: p };
        }) as never,
      );
      interno(chart).render(0);
    }).not.toThrow();
    expect(Number.isFinite(interno(chart).ts.leftLogical)).toBe(true);
  });
});
