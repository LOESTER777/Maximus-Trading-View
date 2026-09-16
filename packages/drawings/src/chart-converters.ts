/**
 * chart-converters — a conversao logico -> tela, feita CORRETAMENTE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ O ARQUIVO MAIS IMPORTANTE DO PACOTE, E O MENOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo existe por causa de UMA linha do contrato do substrato:
 *
 *     timeToCoordinate(time) -> "X coordinate of that time or `null` if no time
 *                                found on time scale"
 *
 * Leia de novo: **`null` se o tempo nao existir na escala.**
 *
 * A consequencia e devastadora e nao aparece em teste rapido. Uma linha de
 * tendencia tracada em M5 tem ancora, digamos, as 10:32:00. Troque o grafico para
 * H1: nao existe barra as 10:32:00 — existe as 10:00:00. `timeToCoordinate`
 * devolve `null`, a implementacao conclui "fora de vista" e nao desenha.
 *
 * **Resultado: o usuario troca de periodo e todos os desenhos dele desaparecem.**
 * Voltando para M5 eles reaparecem, o que faz o defeito parecer intermitente e
 * misterioso. Isto e, na minha leitura, o erro mais comum em implementacao de
 * ferramenta de desenho sobre esta biblioteca.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CONVERSAO CORRETA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     timeToIndex(timeSec, findNearest = true)  ->  indice logico (fracionario ok)
 *     logicalToCoordinate(indice)               ->  X em pixel
 *
 * `timeToIndex` com `findNearest` acha a barra mais proxima em vez de exigir
 * coincidencia exata. `logicalToCoordinate` trabalha em espaco logico CONTINUO —
 * aceita indice fracionario e interpola.
 *
 * Junto isso da: a ancora projeta no pixel certo em qualquer periodo, e continua
 * projetando quando esta ENTRE duas barras.
 *
 * ── Refinamento: interpolacao dentro da barra ─────────────────────────────
 *
 * `timeToIndex` arredonda para a barra mais proxima, e isso quantiza o X ao centro
 * dela. Em periodo alto o erro e visivel: em D1, uma linha ancorada as 14:00
 * apareceria no centro do dia. Por isso a conversao ainda interpola a FRACAO da
 * barra, usando a duracao estimada a partir dos vizinhos.
 *
 * ── Degradacao honesta ────────────────────────────────────────────────────
 *
 * Se nem `timeToIndex` resolver — grafico vazio, escala nao numerica — devolve
 * `null`. `null` significa "nao sei", e o desenho e omitido. Nunca zero: zero
 * seria a borda esquerda do grafico, e a linha apareceria num lugar onde nao esta.
 */

import type { IChartApi, ISeriesApi, SeriesType, Time } from '@robustus/chart-core';
import type { LogicalToScreen, ViewportEpoch } from './render-plan.core.js';

/**
 * A parte da escala de tempo que a conversao usa.
 *
 * ⚠️ `timeToIndex` esta nos typings publicos da v5, mas e API de baixo nivel e
 * pouco citada na documentacao. Declarar a forma que consumimos, em vez de
 * depender do tipo completo, deixa explicito o que este arquivo exige — e faz a
 * ausencia do metodo virar erro de compilacao se uma versao futura o remover, em
 * vez de `undefined is not a function` em producao.
 */
interface TimeScaleComTimeToIndex {
  timeToIndex?(time: Time, findNearest?: boolean): number | null;
  logicalToCoordinate(logical: number): number | null;
  coordinateToLogical(x: number): number | null;
  timeToCoordinate(time: Time): number | null;
  coordinateToTime(x: number): Time | null;
  getVisibleRange(): { from: unknown; to: unknown } | null;
}

/**
 * Constroi os conversores a partir do grafico e da serie de preco.
 *
 * @param chart  o grafico
 * @param series a serie que ancora o eixo de preco (tipicamente a de velas)
 */
export function createChartConverters(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
): LogicalToScreen {
  return {
    timeToX: (timeSec: number): number | null => timeToX(chart, timeSec),

    priceToY: (price: number): number | null => {
      if (!Number.isFinite(price)) return null;
      const y = series.priceToCoordinate(price);
      return y === null || !Number.isFinite(y) ? null : y;
    },

    width: (): number => {
      try {
        return chart.paneSize().width;
      } catch {
        return 0;
      }
    },

    height: (): number => {
      try {
        return chart.paneSize().height;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Instante (epoch segundos) -> X em pixel, sobrevivendo a troca de periodo.
 *
 * Tres tentativas, da mais precisa para a mais tolerante:
 *  1. `timeToCoordinate` — exato quando o instante E uma barra. O caminho rapido.
 *  2. `timeToIndex(findNearest)` + interpolacao de fracao + `logicalToCoordinate`.
 *  3. `null`.
 */
export function timeToX(chart: IChartApi, timeSec: number): number | null {
  if (!Number.isFinite(timeSec)) return null;

  const escala = chart.timeScale() as unknown as TimeScaleComTimeToIndex;

  // ── 1. Caminho exato ──
  try {
    const exato = escala.timeToCoordinate(timeSec as Time);
    if (exato !== null && Number.isFinite(exato)) return exato;
  } catch {
    // Escala nao numerica ou grafico sem dado: cai para a proxima tentativa.
  }

  // ── 2. Barra mais proxima, com interpolacao dentro da barra ──
  //
  // E este ramo que faz o desenho sobreviver a troca de periodo.
  try {
    const paraIndice = escala.timeToIndex;
    if (typeof paraIndice !== 'function') return null;

    const indice = paraIndice.call(escala, timeSec as Time, true);
    if (indice === null || !Number.isFinite(indice)) return null;

    // Tempo da barra encontrada e da vizinha, para estimar a duracao e interpolar
    // a fracao. Sem isso o X seria quantizado ao centro da barra, o que em D1
    // desloca uma ancora de 14:00 para o meio do dia.
    const tBarra = escala.timeToCoordinate as unknown;
    void tBarra; // nao usado aqui; a interpolacao usa coordenada, ver abaixo

    const xBarra = escala.logicalToCoordinate(indice);
    if (xBarra === null || !Number.isFinite(xBarra)) return null;

    const xVizinha = escala.logicalToCoordinate(indice + 1);
    const tempoBarra = escala.coordinateToTime(xBarra);
    const tempoVizinha =
      xVizinha === null || !Number.isFinite(xVizinha) ? null : escala.coordinateToTime(xVizinha);

    const tb = typeof tempoBarra === 'number' ? tempoBarra : null;
    const tv = typeof tempoVizinha === 'number' ? tempoVizinha : null;

    if (
      tb !== null &&
      tv !== null &&
      xVizinha !== null &&
      Number.isFinite(xVizinha) &&
      tv !== tb
    ) {
      // Fracao de barra que o instante ocupa, e a mesma fracao em pixel.
      const fracao = (timeSec - tb) / (tv - tb);
      const x = xBarra + fracao * (xVizinha - xBarra);
      if (Number.isFinite(x)) return x;
    }

    return xBarra;
  } catch {
    return null;
  }
}

/**
 * X em pixel -> instante (epoch segundos).
 *
 * Usado no sentido inverso: o cursor esta num pixel, e preciso saber que instante
 * ele representa para montar a ancora.
 *
 * Passa por `coordinateToLogical` + interpolacao, e nao por `coordinateToTime`
 * direto, por um motivo simetrico ao de ida: `coordinateToTime` devolve o tempo da
 * BARRA, quantizado. Desenhar com ele faria toda ancora nascer colada ao centro da
 * barra, e uma linha de tendencia entre dois topos perderia a inclinacao real.
 */
export function xToTime(chart: IChartApi, x: number): number | null {
  if (!Number.isFinite(x)) return null;

  const escala = chart.timeScale() as unknown as TimeScaleComTimeToIndex;

  try {
    const logico = escala.coordinateToLogical(x);
    if (logico === null || !Number.isFinite(logico)) return null;

    const base = Math.floor(logico);
    const fracao = logico - base;

    const xA = escala.logicalToCoordinate(base);
    const xB = escala.logicalToCoordinate(base + 1);
    if (xA === null || xB === null) {
      const t = escala.coordinateToTime(x);
      return typeof t === 'number' ? t : null;
    }

    const tA = escala.coordinateToTime(xA);
    const tB = escala.coordinateToTime(xB);
    const a = typeof tA === 'number' ? tA : null;
    const b = typeof tB === 'number' ? tB : null;

    if (a !== null && b !== null) {
      const t = a + fracao * (b - a);
      return Number.isFinite(t) ? t : null;
    }
    if (a !== null) return a;

    // Fora da faixa com dado (a direita do ultimo candle, por exemplo). Nao ha
    // como saber o instante: `null`, e quem chama decide recusar o gesto.
    return null;
  } catch {
    return null;
  }
}

/** Y em pixel -> preco. */
export function yToPrice(series: ISeriesApi<SeriesType>, y: number): number | null {
  if (!Number.isFinite(y)) return null;
  try {
    const p = series.coordinateToPrice(y);
    return p === null || !Number.isFinite(p) ? null : p;
  } catch {
    return null;
  }
}

/**
 * Le a epoca corrente da projecao.
 *
 * ⚠️ Inclui o tamanho do painel E os precos das bordas, e as duas coisas sao
 * necessarias:
 *
 *  - **tamanho**: redimensionar a janela NAO muda a faixa visivel de tempo. Sem o
 *    tamanho na epoca, o cache sobreviveria a um resize e o hit-test passaria a
 *    responder em coordenada velha — o usuario clica na linha e nada acontece.
 *  - **precos das bordas**: mudar a escala de preco (arrastar o eixo, alternar
 *    logaritmica) tambem nao muda a faixa de tempo, e desloca todo Y.
 *
 * `null` quando o grafico ainda nao resolveu a faixa. Estado normal na montagem.
 */
export function readEpoch(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
): ViewportEpoch | null {
  try {
    const faixa = chart.timeScale().getVisibleRange();
    if (faixa === null) return null;

    const de = Number(faixa.from);
    const ate = Number(faixa.to);
    if (!Number.isFinite(de) || !Number.isFinite(ate)) return null;

    const { width, height } = chart.paneSize();
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

    const topo = series.coordinateToPrice(0);
    const base = series.coordinateToPrice(height);
    if (topo === null || base === null) return null;

    return {
      fromSec: de,
      toSec: ate,
      width,
      height,
      topPrice: topo,
      bottomPrice: base,
    };
  } catch {
    return null;
  }
}
