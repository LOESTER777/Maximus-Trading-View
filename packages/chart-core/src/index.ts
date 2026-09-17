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
 * FAZ TAMBEM (acrescentado depois): MARCADORES com forma real (circulo, quadrado,
 * seta pra cima/baixo) e texto — antes desenhava sempre um circulo; serie 'Band'
 * (faixa preenchida entre `upper` e `lower`, o preenchimento de Bollinger/Keltner);
 * o evento de crosshair carrega o `seriesData` (OHLC/valor da barra sob o cursor,
 * insumo da legenda O/H/L/C); e formatacao de preco por TICK/casas do instrumento
 * (`rightPriceScale.priceFormat`), via o nucleo puro `price-format.core.ts`, com
 * fallback na heuristica de amplitude quando nao configurada.
 *
 * FAZ TAMBEM (ultima rodada): EXPORTAR IMAGEM (`takeScreenshot` devolve um canvas
 * novo, `toDataURL` a string — `null` em ambiente sem rasterizacao, nunca uma
 * imagem em branco); PINCA em touch (dois ponteiros, zoom pela variacao da
 * distancia ancorado no ponto medio, honrando `handleScale.pinch` e as flags de
 * arrasto por toque); DIVISORIA DE PANE ARRASTAVEL (cursor `ns-resize` na fronteira,
 * com piso de 40 px por pane); GRADE VERTICAL opcional (`grid.vertLines`, nos mesmos
 * instantes dos rotulos de tempo — antes a opcao existia e nao fazia nada); MARCA
 * D'AGUA central atras das series (`watermark`); e TICKS LOGARITMICOS de verdade no
 * eixo de preco (potencias de 10 com subdivisoes 1/2/5 — o passo linear em escala
 * log amontoava os rotulos num terco da tela e deixava uma decada inteira sem
 * nenhum).
 *
 * AINDA NAO: animacao de transicao. E refinamento — o grafico opera sem ela, e foi
 * deixada para depois de proposito, para o motor nascer usavel em vez de nascer
 * perfeito e tarde.
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
  BandData,
  CandlestickData,
  ChartOptions,
  Coordinate,
  CrosshairSeriesData,
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
  PaneRect,
  PaneGridColumns,
  PaneGridInfo,
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
  WatermarkOptions,
} from './contracts.js';

export { DEFAULT_THEME, TIME_AXIS_HEIGHT } from './renderer.js';
export type { RenderTheme, TimeAxisConfig } from './renderer.js';

// Formatacao PURA de preco por tick/casas decimais — usada pelo eixo de preco e
// pelo rotulo de crosshair quando o instrumento declara `priceFormat`.
export {
  formatPrice,
  roundToTick,
  decimalsFromTick,
  PRICE_PLACEHOLDER,
} from './price-format.core.js';
export type { PriceFormatOptions } from './price-format.core.js';

// Transformacoes de serie de velas: Heikin-Ashi e Renko produzem CandlestickData
// derivado (plotado como 'Candlestick'); barras OHLC sao o SeriesType 'Bar' no
// motor. `brickSizeAutomatico` deriva um tamanho de tijolo do proprio dado.
export { heikinAshi, renko, brickSizeAutomatico } from './candle-transforms.core.js';

// Os INDICES de barra marcados no eixo — fonte UNICA do rotulo de tempo e da grade
// vertical. Puro; exportado para quem quiser alinhar uma camada propria a mesma malha.
export { visibleTickIndices } from './time-scale.core.js';

export {
  DEFAULT_TIME_ZONE,
  chooseTickUnit,
  timePartsInZone,
  formatDataHoraCompleta,
} from './time-format.core.js';
export type { TimeParts, TimeTickUnit } from './time-format.core.js';

// A matematica PURA da transicao de eixo. O motor a usa quando
// `ChartOptions.animation.enabled` esta ligado; exportada para quem quiser a mesma
// rampa numa camada propria (uma legenda que acompanhe a viagem, por exemplo).
export {
  ANIMATION_DEFAULT_MS,
  easeOutCubic,
  animationProgress,
  animationState,
  animationWorthwhile,
} from './animation.core.js';
export type { TimeScaleAnimation } from './animation.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ A GEOMETRIA das panes — nucleo PURO da grade de sub-paineis
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ A invariante que sustenta a grade esta no cabecalho de `pane-grid.core.ts`: toda pane
// mostra a MESMA janela logica, e a coluna so muda a escala GEOMETRICA (`barSpacing` escalado
// por `larguraDaPane / larguraTotal`). Com uma coluna, tudo degenera no empilhamento historico.
export {
  calcularArranjo,
  resolverColunas,
  fatorDeCompressao,
  paneNoPonto,
  retanguloDe,
  /** Calcula os retangulos de todas as panes e as fronteiras arrastaveis. */
  calcularArranjo as computePaneLayout,
  /** O fator `larguraDaPane / larguraTotal` — o que escala `barSpacing` numa coluna. */
  fatorDeCompressao as paneCompressionFactor,
} from './pane-grid.core.js';
export type {
  PaneParaArranjo,
  OpcoesDeArranjo,
  RetanguloDePane,
  ArranjoDeGrade,
  ColunasPorLinha,
  FronteiraHorizontal,
  FronteiraVertical,
} from './pane-grid.core.js';
