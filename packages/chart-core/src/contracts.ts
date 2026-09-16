/**
 * contracts — o contrato do motor de grafico PROPRIO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTES NOMES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Estes tipos substituem os que vinham do `lightweight-charts`. Os nomes e as
 * assinaturas foram mantidos COMPATIVEIS com o que as camadas (bookmap, footprint,
 * desenho) ja consumiam por tipo — `IChartApi`, `ISeriesApi`, `ISeriesPrimitive`,
 * `IPrimitivePaneView`, `IPrimitivePaneRenderer`, `SeriesAttachedParameter`,
 * `SeriesType`, `Time`, `PrimitiveHoveredItem`.
 *
 * A razao e cirurgica: trocar o motor de terceiro pelo proprio deve ser troca de
 * IMPORT nessas camadas, e nada mais. A logica de desenho e de hit-test — as
 * ~3.000 linhas que dao valor ao projeto — nao pode ser tocada por uma troca de
 * substrato. Se algum dia esse contrato divergir do que a camada precisa, e a
 * camada que dita; o motor se adapta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FOI SIMPLIFICADO EM RELACAO AO ORIGINAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `lightweight-charts` tem uma superficie enorme (dezenas de tipos de serie,
 * opcoes, plugins). Aqui so existe o que o projeto usa. Acrescentar quando
 * precisar e barato; carregar tudo desde o inicio seria reescrever uma biblioteca
 * inteira sem consumidor.
 */

import type { CanvasRenderingTarget2D } from './canvas-target.js';

// ═════════════════════════════════════════════════════════════════════════════
// Tempo e coordenadas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Instante de uma barra: epoch em SEGUNDOS.
 *
 * No `lightweight-charts` `Time` era uma uniao (numero, string, objeto). Aqui e um
 * numero, sempre — o projeto so usa epoch em segundos, e a uniao trazia
 * ambiguidade que custou bug de fuso na origem. Manter o alias como tipo nomeado
 * preserva a intencao nas assinaturas.
 */
export type Time = number;

/** Coordenada de tela em pixel. Alias nomeado por clareza de assinatura. */
export type Coordinate = number;

/** Indice logico de barra. Fracionario e legitimo: e o que permite interpolar. */
export type Logical = number;

/** Faixa de indices logicos visiveis. */
export interface LogicalRange {
  readonly from: Logical;
  readonly to: Logical;
}

/** Faixa de tempo visivel, em segundos. */
export interface TimeRange {
  readonly from: Time;
  readonly to: Time;
}

// ═════════════════════════════════════════════════════════════════════════════
// Series
// ═════════════════════════════════════════════════════════════════════════════

/** Tipos de serie que o motor desenha. */
export type SeriesType = 'Candlestick' | 'Line' | 'Histogram' | 'Area';

/** Uma vela. Campos identicos ao `CandlestickData` que o engine usava. */
export interface CandlestickData {
  readonly time: Time;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Um ponto de linha, area ou histograma. */
export interface LineData {
  readonly time: Time;
  readonly value: number;
  /** Cor por ponto — usado pelo histograma de volume (verde/vermelho). */
  readonly color?: string;
}

export type SeriesData = CandlestickData | LineData;

/** Opcoes comuns a toda serie. */
export interface SeriesOptionsCommon {
  readonly priceScaleId?: string;
  readonly color?: string;
  readonly upColor?: string;
  readonly downColor?: string;
  readonly wickUpColor?: string;
  readonly wickDownColor?: string;
  readonly borderVisible?: boolean;
  readonly lineWidth?: number;
  readonly lastValueVisible?: boolean;
  readonly priceLineVisible?: boolean;
  readonly priceFormat?: { readonly type?: 'price' | 'volume'; readonly precision?: number };
  /** Painel: 0 e o principal (preco). >0 sao sub-paineis empilhados abaixo. */
  readonly paneIndex?: number;
}

/**
 * Uma linha de preco horizontal presa a uma serie.
 *
 * Contrato identico ao `IPriceLine` que o engine consumia: `createPriceLine`
 * devolve isto, `removePriceLine` o consome.
 */
export interface IPriceLine {
  readonly _id: string;
}

/** Opcoes de uma linha de preco. */
export interface PriceLineOptions {
  readonly price: number;
  readonly color: string;
  readonly lineWidth?: number;
  readonly lineStyle?: 0 | 1 | 2 | 3 | 4;
  readonly axisLabelVisible?: boolean;
  readonly title?: string;
}

/** Um marcador ancorado num instante. */
export interface SeriesMarker<T = Time> {
  readonly time: T;
  readonly position: 'aboveBar' | 'belowBar' | 'inBar';
  readonly color: string;
  readonly shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  readonly text?: string;
  readonly size?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Primitives
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Item sob o cursor, devolvido por `hitTest`.
 *
 * Campos identicos ao `PrimitiveHoveredItem` do `lightweight-charts` 5.1, porque a
 * camada de desenho os produz e a resolucao de sobreposicao depende deles:
 * `distance` (menor ganha), `hitTestPriority` (ponto > linha > regiao),
 * `cursorStyle`, `externalId`, `zOrder`.
 */
export interface PrimitiveHoveredItem {
  readonly externalId: string;
  readonly zOrder: PrimitivePaneViewZOrder;
  readonly cursorStyle?: string;
  readonly distance?: number;
  readonly hitTestPriority?: number;
}

/** Camada de z-order de uma pane view. */
export type PrimitivePaneViewZOrder = 'bottom' | 'normal' | 'top';

/** Renderer de uma pane de primitive: a passada de desenho. */
export interface IPrimitivePaneRenderer {
  draw(target: CanvasRenderingTarget2D): void;
}

/** Uma view de primitive: z-order e o renderer corrente. */
export interface IPrimitivePaneView {
  zOrder(): PrimitivePaneViewZOrder;
  renderer(): IPrimitivePaneRenderer | null;
}

/**
 * Parametros entregues a uma primitive quando ela e anexada a uma serie.
 *
 * `chart`, `series` e `requestUpdate` — exatamente o que as camadas guardam em
 * `attached()`. `requestUpdate` e como a camada pede um novo quadro sem esperar o
 * proximo evento do motor.
 */
export interface SeriesAttachedParameter<_T = Time, _S extends SeriesType = SeriesType> {
  readonly chart: IChartApi;
  readonly series: ISeriesApi<SeriesType>;
  readonly requestUpdate: () => void;
}

/**
 * Uma primitive anexavel a uma serie.
 *
 * ⚠️ `hitTest` e OPCIONAL de proposito, e a presenca dele e significativa:
 * bookmap e footprint NAO o implementam (nao capturam ponteiro), a camada de
 * desenho implementa. Ha property test que reprova bookmap/footprint com hitTest.
 */
export interface ISeriesPrimitive<_T = Time> {
  attached(param: SeriesAttachedParameter): void;
  detached(): void;
  updateAllViews?(): void;
  paneViews?(): readonly IPrimitivePaneView[];
  hitTest?(x: number, y: number): PrimitiveHoveredItem | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Escala de tempo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A escala de tempo — a fronteira mais delicada do motor.
 *
 * Os metodos aqui sao os que a camada de desenho usa para converter tempo em
 * pixel SEM que o desenho desapareca ao trocar de periodo. Ver
 * `time-scale.ts` para o cerne, e `drawings/chart-converters.ts` para por que
 * `timeToIndex(findNearest)` + `logicalToCoordinate` e a unica forma correta.
 */
export interface ITimeScaleApi {
  timeToCoordinate(time: Time): Coordinate | null;
  coordinateToTime(x: Coordinate): Time | null;
  timeToIndex(time: Time, findNearest?: boolean): Logical | null;
  logicalToCoordinate(logical: Logical): Coordinate | null;
  coordinateToLogical(x: Coordinate): Logical | null;
  getVisibleRange(): TimeRange | null;
  getVisibleLogicalRange(): LogicalRange | null;
  setVisibleLogicalRange(range: LogicalRange): void;
  fitContent(): void;
  scrollToRealTime(): void;
  subscribeVisibleLogicalRangeChange(handler: (range: LogicalRange | null) => void): void;
  unsubscribeVisibleLogicalRangeChange(handler: (range: LogicalRange | null) => void): void;
}

/** A escala de preco. */
export interface IPriceScaleApi {
  applyOptions(options: Partial<PriceScaleOptions>): void;
  width(): number;
}

export interface PriceScaleOptions {
  readonly scaleMargins: { readonly top: number; readonly bottom: number };
  /** Escala logaritmica. `false` = linear. */
  readonly mode: 'normal' | 'logarithmic';
  readonly visible: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// Serie
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A API de uma serie. Superficie que o engine e as camadas consomem.
 *
 * O segundo parametro `_T` e ignorado, presente so por compatibilidade: as
 * camadas usam `ISeriesApi<SeriesType, Time>` (assinatura de dois parametros do
 * terceiro). Aceita-lo evita reescrever essas assinaturas.
 */
export interface ISeriesApi<_S extends SeriesType = SeriesType, _T = Time> {
  setData(data: readonly SeriesData[]): void;
  update(bar: SeriesData): void;
  priceToCoordinate(price: number): Coordinate | null;
  coordinateToPrice(y: Coordinate): number | null;
  attachPrimitive(primitive: ISeriesPrimitive): void;
  detachPrimitive(primitive: ISeriesPrimitive): void;
  createPriceLine(options: PriceLineOptions): IPriceLine;
  removePriceLine(line: IPriceLine): void;
  applyOptions(options: Partial<SeriesOptionsCommon>): void;
  setMarkers(markers: readonly SeriesMarker[]): void;
}

// ═════════════════════════════════════════════════════════════════════════════
// Grafico
// ═════════════════════════════════════════════════════════════════════════════

/** Tamanho de uma pane, em pixel logico. */
export interface PaneSize {
  readonly width: number;
  readonly height: number;
}

/** Opcoes de rolagem (pan). Togglaveis — o desenho desliga durante o arrasto. */
export interface HandleScrollOptions {
  readonly mouseWheel: boolean;
  readonly pressedMouseMove: boolean;
  readonly horzTouchDrag: boolean;
  readonly vertTouchDrag: boolean;
}

/** Opcoes de escala (zoom). */
export interface HandleScaleOptions {
  readonly mouseWheel: boolean;
  readonly pinch: boolean;
}

/** Opcoes do grafico. */
export interface ChartOptions {
  readonly layout: {
    readonly background: { readonly color: string };
    readonly textColor: string;
  };
  readonly grid: {
    readonly vertLines: { readonly visible: boolean; readonly color?: string };
    readonly horzLines: { readonly visible: boolean; readonly color?: string };
  };
  readonly crosshair: { readonly mode: 0 | 1 };
  readonly timeScale: {
    readonly rightOffset: number;
    readonly barSpacing: number;
    readonly minBarSpacing: number;
    readonly timeVisible: boolean;
    readonly secondsVisible: boolean;
  };
  readonly rightPriceScale: { readonly scaleMargins: { readonly top: number; readonly bottom: number } };
  readonly handleScroll: HandleScrollOptions | boolean;
  readonly handleScale: HandleScaleOptions | boolean;
  readonly autoSize: boolean;
}

/**
 * O tipo base do grafico — o que a camada guarda como `param.chart`.
 *
 * O parametro de tipo `_T` e ignorado e existe SO por compatibilidade: as camadas
 * foram escritas como `IChartApiBase<Time>` contra o terceiro, e mante-lo aceito
 * evita mexer nelas. Nao usamos a uniao de `Time` do terceiro — aqui `Time` e
 * sempre numero.
 */
export interface IChartApiBase<_T = Time> {
  timeScale(): ITimeScaleApi;
  priceScale(id: string): IPriceScaleApi;
  paneSize(paneIndex?: number): PaneSize;
  options(): ChartOptions;
  applyOptions(options: Partial<ChartOptions>): void;
}

/** A API completa do grafico. */
export interface IChartApi extends IChartApiBase {
  addSeries<S extends SeriesType>(
    type: S,
    options?: Partial<SeriesOptionsCommon>,
    paneIndex?: number,
  ): ISeriesApi<S>;
  removeSeries(series: ISeriesApi<SeriesType>): void;
  /** Cria um sub-painel abaixo do principal e devolve o indice dele. */
  addPane(): number;
  subscribeClick(handler: (param: MouseEventParams) => void): void;
  subscribeCrosshairMove(handler: (param: MouseEventParams) => void): void;
  remove(): void;
}

/** O que chega num evento de mouse do grafico. */
export interface MouseEventParams {
  readonly time?: Time;
  readonly logical?: Logical;
  readonly point?: { readonly x: Coordinate; readonly y: Coordinate };
  readonly hoveredObjectId?: string;
}
