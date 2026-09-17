/**
 * @robustus/charts-engine — o motor de grafico, sem framework.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O UNICO PACOTE QUE IMPORTA O SUBSTRATO EM RUNTIME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `core` e puro. `primitives` importa o motor proprio so por tipo. `datafeed`
 * nao o conhece. Este pacote e a fronteira: e aqui que `createChart` e chamado.
 *
 * A consequencia pratica e que uma eventual troca de substrato mexe neste
 * arquivo e no `chart-engine.ts` — nao nas 2.700 linhas de desenho do bookmap,
 * nem nos 14 nucleos puros, nem em nenhuma tela do consumidor. Foi para isso que
 * o vocabulario proprio de `types.ts` existe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```ts
 * const motor = ChartEngine.create(container, { withVolume: true });
 *
 * motor.setCandles(velas);
 * motor.setPriceLines([{ price: 130_000, color: '#e9c46a', title: 'Alvo' }]);
 * motor.setBookmapLayer({ grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: 5 });
 *
 * // Sobreposicoes em HTML/SVG alinhadas ao eixo real:
 * const parar = motor.onCoordinateMapperChange((m) => {
 *   const y = m.priceToY(130_000);          // null = fora de vista
 *   const folga = m.priceScaleWidthPx();    // ancora da borda direita util
 * });
 *
 * // Troca de periodo: reenquadre, NAO recrie.
 * motor.setCandles(outroPeriodo);
 * motor.resetViewport();
 *
 * parar();
 * motor.dispose();
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE JA FOI FEITO (era "ainda nao")
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O bloco abaixo era uma lista de faltas; viraram entregas, e ficam aqui como
 * registro do caminho:
 *
 * **Ferramenta de desenho do usuario — FEITO** em `@robustus/charts-drawings`
 * (8 ferramentas, hit-test com prioridade, historico, persistencia). A ligacao
 * opcional ao motor vive em `react/useDrawings.ts`.
 *
 * **Sub-painel (`pane`) de verdade — FEITO** no motor proprio (`addPane`/
 * `removePane`, panes empilhadas com eixo de tempo unico). RSI/MACD plotam numa
 * faixa propria via `OutputSpec.pane === 'separate'`.
 *
 * **Persistencia de layout — FEITO** em `@robustus/charts-engine`
 * (`serializeChartState`/`deserializeChartState`): tipo de serie, indicadores +
 * params, alertas, desenhos e viewport num descritor versionado.
 */

export { ChartEngine } from './chart-engine.js';
export type { ChartEngineOptions, PriceSeriesType } from './chart-engine.js';

export {
  serializeChartState,
  deserializeChartState,
  CHART_STATE_SCHEMA_VERSION,
} from './chart-state.core.js';
export type {
  ChartState,
  IndicatorState,
  AlertState as ChartAlertState,
  ViewportState,
  SerializeChartInput,
  DeserializeResult,
} from './chart-state.core.js';

export type {
  CrosshairSeriesData,
  MouseEventParams,
} from '@robustus/chart-core';

export { IndicatorPlotter } from './indicator-plotter.js';
export type {
  IndicatorPlot,
  PlottableIndicator,
  PlottableOutput,
  PlottableBar,
  PlottablePoint,
} from './indicator-plotter.js';

export {
  isValidCandle,
  BOOKMAP_MAX_CELLS_DEFAULT,
  BOOKMAP_MIN_CELL_PX_DEFAULT,
} from './types.js';

export type {
  ChartCandle,
  ChartHistogramBar,
  ChartPriceLine,
  ChartLineSeries,
  ChartMarker,
  ChartCoordinateMapper,
  BookmapLayerInput,
  FootprintLayerInput,
  VolumeProfileLayerInput,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Templates de layout NOMEADOS — os setups do operador
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Nucleo PURO: nenhuma persistencia aqui. O armazenamento e injetado pelo consumidor
// (localStorage, IndexedDB, servidor) e o relogio entra por parametro.

export {
  salvarTemplate,
  removerTemplate,
  renomearTemplate,
  acharTemplate,
  ordenarParaExibicao,
  normalizarNome,
  nomeDeExibicao,
  serializarTemplates,
  desserializarTemplates,
  TEMPLATES_SCHEMA_VERSION,
  MAX_TEMPLATES,
  MAX_NOME,
  /** Salva (ou sobrescreve, RELATANDO) um template. */
  salvarTemplate as saveLayoutTemplate,
  /** Le a colecao de um valor desconhecido. NUNCA lanca; descarta item invalido com aviso. */
  desserializarTemplates as parseLayoutTemplates,
} from './layout-templates.core.js';
export type {
  TemplateDeLayout,
  ColecaoDeTemplates,
  DocumentoDeLayout,
  DocumentoDeTemplates,
  LeituraDeTemplates,
  ResultadoDeTemplate,
  MotivoDeRecusa,
} from './layout-templates.core.js';
