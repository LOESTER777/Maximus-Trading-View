/**
 * useChartState — a ponte que junta TUDO num layout salvavel e restauravel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE A COSTURA MORA AQUI, E NAO NO ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O nucleo `serializeChartState`/`deserializeChartState` (no `engine`) e PURO e,
 * pela regra 4 do projeto, NAO importa o pacote de desenho — ele trata o
 * documento de desenho como bloco OPACO. Mas o desenho tem seu proprio
 * serializador (`serialize`/`deserialize` em `@robustus/charts-drawings`), com as
 * tres disciplinas (versao, validacao, recusa parcial). Alguem precisa ter os
 * DOIS pacotes para costurar um no outro — e esse alguem e a camada React, que ja
 * depende de ambos. E o mesmo padrao de `useIndicators`/`useAlerts`: a ligacao
 * cross-package vive no React, mantendo os nucleos independentes.
 *
 * Este hook NAO tem estado proprio nem efeito: e um par de funcoes memoizadas
 * (`capture` e `restore`) que traduzem entre o estado vivo (desenhos como
 * `Drawing[]`, indicadores, alertas, tipo de serie, viewport) e o documento
 * serializavel. Quem decide ONDE gravar (localStorage, servidor) e o consumidor.
 *
 * ⚠️ **O que este hook NAO faz: aplicar o estado no motor.** Ele DEVOLVE o estado
 * lido (`restore`) para o consumidor decidir como aplicar — trocar o tipo de
 * serie, recriar indicadores pelo registry, rearmar alertas, carregar desenhos.
 * Aplicar exigiria o registry de indicadores e o pacote de alertas, e amarraria
 * o hook a eles; devolver o descritor mantem a costura fina e o consumidor no
 * controle da ordem de aplicacao.
 */
import { useCallback } from 'react';
import {
  serializeChartState,
  deserializeChartState,
  type ChartState,
  type IndicatorState,
  type ChartAlertState,
  type ViewportState,
  type PriceSeriesType,
} from '@robustus/charts-engine';
import { serialize as serializeDrawings, type Drawing } from '@robustus/charts-drawings';

/** O estado vivo que o consumidor junta para CAPTURAR (gravar). */
export interface CaptureInput {
  readonly symbol?: string;
  readonly priceSeriesType: PriceSeriesType;
  readonly indicators: readonly IndicatorState[];
  readonly alerts: readonly ChartAlertState[];
  /** Os desenhos vivos, como `useDrawings().drawings` os expoe. */
  readonly drawings: readonly Drawing[];
  readonly viewport?: ViewportState;
}

/** O que o hook devolve. */
export interface UseChartStateResult {
  /**
   * Monta o documento salvavel a partir do estado vivo. Serializa os desenhos
   * com o pacote de desenho ANTES de delegar ao nucleo do engine. Devolve
   * estrutura (nao texto) — o consumidor escolhe `JSON.stringify` e o destino.
   */
  readonly capture: (input: CaptureInput) => ChartState;
  /**
   * Le um documento de origem nao confiavel. NUNCA lanca; item invalido e
   * descartado (recusa parcial). Devolve o estado lido + quantos itens cairam e
   * por que — o consumidor entao aplica o estado como preferir.
   */
  readonly restore: (raw: unknown) => ReturnType<typeof deserializeChartState>;
}

/**
 * Costura o estado completo do grafico para salvar/restaurar.
 *
 * @example
 * const { capture, restore } = useChartState();
 *
 * // salvar:
 * const doc = capture({
 *   symbol: 'WINV26',
 *   priceSeriesType: engine.currentPriceSeriesType,
 *   indicators: [{ id: 'ema20', name: 'ema', params: { period: 20 } }],
 *   alerts: [{ key: 'a1', condition: { kind: 'CROSS_ABOVE', level: 130000 } }],
 *   drawings: desenho.drawings,
 *   viewport,
 * });
 * localStorage.setItem('layout', JSON.stringify(doc));
 *
 * // restaurar:
 * const { state, rejected } = restore(JSON.parse(localStorage.getItem('layout')!));
 * engine.setPriceSeriesType(state.priceSeriesType);
 * // recriar indicadores por state.indicators (via registry), etc.
 */
export function useChartState(): UseChartStateResult {
  const capture = useCallback((input: CaptureInput): ChartState => {
    // Serializa os desenhos com o pacote de desenho (as tres disciplinas dele) e
    // entrega ao nucleo como bloco opaco. O `symbol` vai tambem no documento de
    // desenho, para o proprio pacote poder conferir o instrumento na leitura.
    const drawingsDoc = serializeDrawings(input.drawings, input.symbol) as unknown as Readonly<
      Record<string, unknown>
    >;
    return serializeChartState({
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
      priceSeriesType: input.priceSeriesType,
      indicators: input.indicators,
      alerts: input.alerts,
      drawings: drawingsDoc,
      ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
    });
  }, []);

  const restore = useCallback((raw: unknown) => deserializeChartState(raw), []);

  return { capture, restore };
}
