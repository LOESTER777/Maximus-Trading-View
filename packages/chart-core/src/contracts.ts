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

/**
 * Tipos de serie que o motor desenha.
 *
 * `'Bar'` (barras OHLC) e um MODO DE DESENHO da mesma `CandlestickData`, nao um
 * dado novo: tick de abertura a esquerda, de fechamento a direita, linha vertical
 * do range. Heikin-Ashi e Renko NAO aparecem aqui de proposito — sao `CandlestickData`
 * TRANSFORMADO (ver `candle-transforms.core.ts`) e o consumidor os plota como
 * `'Candlestick'`.
 */
/**
 * ⭐ `'Band'` e uma FAIXA preenchida entre dois precos por instante
 * (`upper`/`lower`), pintada com alpha baixo — o preenchimento de Bollinger e
 * Keltner. Nao substitui as linhas: o consumidor plota a banda para o miolo e
 * linhas por cima para as bordas. Foi escolhido um SeriesType proprio, e nao uma
 * variacao da serie de Area, porque a Area preenche ate a BASE do eixo (uma
 * referencia fixa), enquanto a banda preenche entre duas series que se movem —
 * geometria diferente, dado diferente (`BandData`), rasterizacao diferente.
 */
export type SeriesType = 'Candlestick' | 'Bar' | 'Line' | 'Histogram' | 'Area' | 'Band';

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

/**
 * Um ponto de banda: a faixa `[lower, upper]` num instante.
 *
 * ⚠️ `upper` e `lower` sao ambos precos no MESMO eixo — nao ha "valor" unico. O
 * preenchimento vai de um ao outro. A ordem nao precisa ser garantida pelo
 * chamador: o renderer trata `upper < lower` desenhando a faixa mesmo assim (a
 * area entre os dois nao tem orientacao).
 */
export interface BandData {
  readonly time: Time;
  readonly upper: number;
  readonly lower: number;
}

export type SeriesData = CandlestickData | LineData | BandData;

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
  /**
   * Visibilidade da serie. Ausente = visivel (o default nao pode ser "some", senao
   * toda serie criada sem opcao nasceria invisivel).
   *
   * ⭐ `visible: false` esconde de VERDADE: a serie sai do desenho, das suas linhas
   * de preco, dos seus marcadores, das primitives anexadas a ela, **e da
   * autoescala**. Tirar da autoescala e a parte que importa — uma EMA "escondida"
   * que continuasse esticando a faixa deixaria o preco comprimido por algo que o
   * operador nao ve, e ele nao teria como descobrir a causa.
   *
   * ⚠️ O eixo de TEMPO nao depende de visibilidade. Ele e derivado da serie de
   * preco mais longa da pane 0, e esconder essa serie nao pode colapsar o eixo
   * (levaria o grafico inteiro a desaparecer em vez de esconder uma serie). A
   * verdade temporal segue existindo mesmo invisivel.
   */
  readonly visible?: boolean;
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

/**
 * Marca d'agua central: simbolo, nome da mesa, aviso de ambiente.
 *
 * ⭐ Desenhada ATRAS das series, com alpha baixo. A ordem importa e nao e
 * cosmetica: uma marca por cima das velas rouba a leitura do preco exatamente na
 * regiao central, que e onde o operador olha. Atras, ela identifica o painel sem
 * disputar pixel com o dado.
 *
 * `visible` ausente conta como `true` quando ha `text` — quem configurou o texto
 * quis ve-lo; o campo existe para desligar sem apagar a configuracao.
 */
export interface WatermarkOptions {
  readonly text: string;
  readonly color?: string;
  readonly fontSize?: number;
  readonly visible?: boolean;
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
    /**
     * Fuso IANA dos rotulos do eixo de tempo. Ex.: `'America/Sao_Paulo'`, `'UTC'`.
     *
     * Injetavel de proposito: o mesmo grafico pode ser lido por uma mesa em Sao
     * Paulo, um backtest em UTC e um painel em Chicago. Default `'America/Sao_Paulo'`
     * (B3). NAO ha aritmetica de fuso a mao — vai inteiro para `Intl.DateTimeFormat`.
     */
    readonly timeZone?: string;
  };
  readonly rightPriceScale: {
    readonly scaleMargins: { readonly top: number; readonly bottom: number };
    /**
     * Formatacao de preco do eixo e do rotulo de crosshair.
     *
     * ⭐ Opcional: quando o instrumento e conhecido (tick 0.5 de mini-indice,
     * 0.00001 de forex), o motor formata pelo INSTRUMENTO em vez de pela
     * amplitude visivel. Ausente, cai na heuristica de amplitude (`decimalsForSpan`)
     * — o comportamento anterior, preservado para quem nao configura tick.
     */
    readonly priceFormat?: { readonly precision?: number; readonly tickSize?: number };
  };
  readonly handleScroll: HandleScrollOptions | boolean;
  readonly handleScale: HandleScaleOptions | boolean;
  readonly autoSize: boolean;
  /**
   * Marca d'agua central (simbolo/branding). Ausente = nao desenha nada.
   *
   * Opcional de proposito: quem nao configura nao paga nem a medicao de texto.
   */
  readonly watermark?: WatermarkOptions;
  /**
   * ⭐ Transicao ANIMADA das mudancas PROGRAMATICAS de janela (`fitContent`,
   * `setVisibleLogicalRange`, `scrollToRealTime`).
   *
   * ⚠️ **`enabled` e `false` por default, e isso NAO e timidez.** Estes tres metodos
   * sao SINCRONOS por contrato: quem chama `fitContent()` e em seguida
   * `timeToCoordinate(t)` espera a coordenada da janela NOVA. Ligar a animacao por
   * default faria esse par mentir durante toda a transicao — a camada de desenho
   * calcularia ancoras contra uma janela que ja mudou, e o defeito apareceria como
   * elemento desalinhado por alguns quadros, difícil de rastrear. Quem liga a
   * animacao aceita essa troca conscientemente.
   *
   * ⚠️ Pan e zoom do USUARIO nunca sao animados, com a opcao ligada ou nao: o eixo
   * tem de acompanhar o dedo no mesmo quadro. Interacao em curso CANCELA uma
   * transicao — brigar com o operador e pior que nao animar.
   *
   * ⚠️ `prefers-reduced-motion: reduce` desliga a animacao mesmo com `enabled: true`.
   * Nao e cortesia: para parte dos usuarios movimento na tela causa mal-estar
   * fisico, e a preferencia do sistema e a declaracao disso.
   */
  readonly animation?: {
    readonly enabled?: boolean;
    /** Duracao em ms. `0` equivale a desligado. Default `ANIMATION_DEFAULT_MS`. */
    readonly durationMs?: number;
  };
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
  /** Cria um sub-painel abaixo do principal e devolve o indice ESTAVEL dele. */
  addPane(): number;
  /** Remove um sub-painel e suas series. A pane principal (0) nao e removivel. */
  removePane(index: number): void;
  /**
   * ⭐ A serie DESENHADA sob um ponto da tela, ou `null`.
   *
   * Existe para a pergunta "em que o operador clicou?". Sem isto, clicar numa linha de
   * indicador nao tinha resposta nenhuma — o motor sabia desenhar a EMA e nao sabia
   * dizer que aquele pixel era dela, entao a interface nao tinha como abrir as
   * propriedades do que foi clicado.
   *
   * O ponto e em pixel LOGICO, relativo ao canvas (o mesmo `point` de
   * `MouseEventParams`). `tolerancePx` e o raio de acerto para series de traco.
   *
   * ⚠️ Serie OCULTA (`visible: false`) e pane colapsada nao participam: o operador nao
   * pode selecionar o que nao esta na tela.
   */
  seriesAt(
    point: { readonly x: number; readonly y: number },
    tolerancePx?: number,
  ): ISeriesApi<SeriesType> | null;
  /**
   * Colapsa (ou reexibe) um sub-painel PRESERVANDO as series dele.
   *
   * Diferente de `removePane`: nada e destruido, a fracao de altura vai a zero e
   * volta. E o que permite esconder um oscilador sem perder cor, parametro e linha
   * de referencia — reexibir nao recria nada. A pane principal (0) e ignorada.
   */
  setPaneVisible(index: number, visible: boolean): void;
  /** O sub-painel esta visivel? Indice inexistente conta como nao visivel. */
  isPaneVisible(index: number): boolean;
  subscribeClick(handler: (param: MouseEventParams) => void): void;
  subscribeCrosshairMove(handler: (param: MouseEventParams) => void): void;
  /**
   * ⭐ Remove um ouvinte de clique. Idempotente; handler desconhecido e no-op.
   *
   * ⚠️ Faltava, e a falta tinha custo. Sem simetria, todo hook que assinava ficava
   * preso ao motor pelo resto da vida dele: `useCrosshair` documentava a ausencia e
   * confiava em que "o motor descartado nao chama mais" — verdade so quando o motor
   * inteiro morre. Um consumidor que ligue e desligue um recurso (a legenda, o clique em
   * indicador) no MESMO motor acumulava ouvintes a cada vez, e cada um deles segurando a
   * closure anterior.
   */
  unsubscribeClick(handler: (param: MouseEventParams) => void): void;
  /** Remove um ouvinte de crosshair. Mesmo contrato de `unsubscribeClick`. */
  unsubscribeCrosshairMove(handler: (param: MouseEventParams) => void): void;
  /**
   * Copia do quadro corrente num canvas NOVO, ou `null` quando nao ha rasterizacao.
   *
   * ⭐ Devolve um canvas, e nao o canvas interno, porque o interno e reciclado a
   * cada quadro: quem guardasse a referencia veria a "foto" mudar sozinha no
   * proximo pan. A copia e imutavel por construcao.
   *
   * ⚠️ `null` e um resultado LEGITIMO, nao um erro: em jsdom (e em qualquer
   * ambiente sem contexto 2D) nao existe imagem para devolver. A disciplina do
   * projeto e falha como valor de retorno — `null` aqui significa "nao sei
   * rasterizar", nunca um canvas vazio, que o consumidor salvaria como PNG preto
   * sem perceber.
   */
  takeScreenshot(): HTMLCanvasElement | null;
  /**
   * O mesmo quadro como data URL, pronto para `<a download>` ou `<img src>`.
   *
   * `type` default `'image/png'`; `quality` (0..1) so vale para formato com perda
   * (`image/jpeg`, `image/webp`). `null` pelo mesmo motivo de `takeScreenshot`.
   */
  toDataURL(type?: string, quality?: number): string | null;
  remove(): void;
}

/**
 * O dado da barra sob o cursor, para a serie de preco principal.
 *
 * Uniao aberta: OHLC para `Candlestick`/`Bar`, `value` para `Line`/`Area`. E o
 * insumo minimo para o consumidor montar a legenda O/H/L/C — o motor NAO desenha
 * legenda, so entrega o dado. Ausente quando nao ha barra sob o cursor.
 */
export interface CrosshairSeriesData {
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly value?: number;
}

/** O que chega num evento de mouse do grafico. */
export interface MouseEventParams {
  readonly time?: Time;
  readonly logical?: Logical;
  readonly point?: { readonly x: Coordinate; readonly y: Coordinate };
  readonly hoveredObjectId?: string;
  /**
   * Dado da barra sob o cursor na serie de preco principal (pane 0).
   *
   * Opcional e tolerante: sem barra sob o cursor (grafico vazio, cursor fora da
   * faixa de dados), o campo simplesmente NAO vem. E o que permite a legenda
   * O/H/L/C sem o motor precisar conhecer legenda.
   */
  readonly seriesData?: CrosshairSeriesData;
}
