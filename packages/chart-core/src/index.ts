/**
 * @robustus/chart-core — o motor de grafico PROPRIO. Zero terceiros em runtime.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE PACOTE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Substitui o `lightweight-charts`. Nenhuma linha de terceiro roda em producao: o
 * eixo de tempo, a escala de preco, o laco de canvas, a interacao e o contrato de
 * primitive sao todos daqui.
 *
 * A superficie publica — `createChart`, `IChartApi`, `ISeriesApi`,
 * `ISeriesPrimitive`, `CanvasRenderingTarget2D` — foi mantida COMPATIVEL com a que
 * o `lightweight-charts` expunha. Foi decisao de projeto: as ~3.000 linhas de
 * bookmap, footprint e desenho consumiam aquele contrato por TIPO, e mante-lo
 * igual fez a troca de motor ser troca de import, nao reescrita das camadas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE MOTOR FAZ HOJE, E O QUE AINDA NAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FAZ: eixo de tempo com sessao irregular (espaco logico continuo — velas
 * equidistantes, fim de semana nao ocupa espaco), escala de preco com autoescala
 * pela janela visivel, velas/linha/area/histograma, grade, eixo de preco,
 * crosshair, pan por arrasto, zoom por roda ancorado no cursor, sub-paineis
 * empilhados, linhas de preco, marcadores, e o contrato de primitive completo
 * (bookmap, footprint e desenho anexam sem mudanca).
 *
 * FAZ TAMBEM (acrescentado): eixo de tempo com ROTULOS de data/hora desenhados na
 * base (passo escolhido pelo zoom, virada de dia marcada, fuso injetavel via
 * `Intl` — default `America/Sao_Paulo`), escala de preco INTERATIVA (arrasto
 * vertical sobre o eixo escala em torno do centro e congela a autoescala;
 * duplo-clique no eixo religa), e as CAIXAS de crosshair (preco na borda do eixo
 * de preco, data/hora na borda do eixo de tempo).
 *
 * AINDA NAO: escala logaritmica plenamente exercitada, animacao de transicao,
 * pinca em touch. Sao refinamentos — o grafico opera sem eles, e foram deixados
 * para depois de proposito, para o motor nascer usavel em vez de nascer perfeito
 * e tarde.
 *
 * ⚠️ Este motor v1 e mais simples que o lightweight-charts, que teve anos de
 * ajuste. Priorizamos o que o projeto USA. Se algo faltar, e acrescimo aqui, nao
 * volta para terceiro.
 */

export { RobustusChartCore, createChart } from './chart.js';
export { createCanvasTarget } from './canvas-target.js';

export type {
  BitmapCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
  MediaCoordinatesRenderingScope,
} from './canvas-target.js';

export type {
  CandlestickData,
  ChartOptions,
  Coordinate,
  HandleScaleOptions,
  HandleScrollOptions,
  IChartApi,
  IChartApiBase,
  IPriceLine,
  IPriceScaleApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  LineData,
  Logical,
  LogicalRange,
  MouseEventParams,
  PaneSize,
  PriceLineOptions,
  PriceScaleOptions,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesData,
  SeriesMarker,
  SeriesOptionsCommon,
  SeriesType,
  Time,
  TimeRange,
} from './contracts.js';

export { DEFAULT_THEME, TIME_AXIS_HEIGHT } from './renderer.js';
export type { RenderTheme, TimeAxisConfig } from './renderer.js';

// Transformacoes de serie de velas: Heikin-Ashi e Renko produzem CandlestickData
// derivado (plotado como 'Candlestick'); barras OHLC sao o SeriesType 'Bar' no
// motor. `brickSizeAutomatico` deriva um tamanho de tijolo do proprio dado.
export { heikinAshi, renko, brickSizeAutomatico } from './candle-transforms.core.js';

export {
  DEFAULT_TIME_ZONE,
  chooseTickUnit,
  timePartsInZone,
  formatDataHoraCompleta,
} from './time-format.core.js';
export type { TimeParts, TimeTickUnit } from './time-format.core.js';
