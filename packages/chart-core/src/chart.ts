/**
 * chart — RobustusChartCore: o motor de grafico proprio. Substitui `createChart`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA CLASSE FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cria o canvas, mantem o eixo de tempo e a escala de preco, roda o laco de
 * render, gerencia panes e series, e traduz pointer/wheel em pan e zoom. Expoe a
 * API `IChartApi` — a mesma superficie que o `lightweight-charts` expunha e que o
 * `ChartEngine` e as camadas consomem.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS PANES, UM CANVAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sub-painel (RSI, MACD) e uma PANE separada, empilhada abaixo do preco,
 * COMPARTILHANDO o eixo de tempo mas com escala de preco propria. Aqui isso e um
 * unico canvas dividido em faixas horizontais: cada pane tem seu retangulo, sua
 * `PriceScaleState`, suas series. O eixo de tempo e um so — pan e zoom movem todas
 * as panes juntas, que e o comportamento correto (o tempo e o mesmo em todas).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RENDER COALESCIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Toda mudanca (dado, pan, zoom, opcao) marca o grafico como sujo e agenda UM
 * quadro. Dez mudancas no mesmo tick desenham uma vez. Sem isso, um `setData`
 * seguido de `applyOptions` seguido de um pan desenharia tres vezes o mesmo
 * quadro.
 */

import {
  ANIMATION_DEFAULT_MS,
  animationProgress,
  animationState,
  animationWorthwhile,
  type TimeScaleAnimation,
} from './animation.core.js';
import { createCanvasTarget } from './canvas-target.js';
import type {
  ChartOptions,
  CrosshairSeriesData,
  HandleScrollOptions,
  IChartApi,
  IPriceScaleApi,
  ISeriesApi,
  ITimeScaleApi,
  LogicalRange,
  MouseEventParams,
  PaneSize,
  PriceScaleOptions,
  SeriesOptionsCommon,
  SeriesType,
  Time,
  TimeRange,
  WatermarkOptions,
} from './contracts.js';
import {
  autoScale,
  coordinateToPrice,
  createPriceScaleState,
  priceToCoordinate,
  type PriceScaleState,
} from './price-scale.core.js';
import {
  DEFAULT_THEME,
  renderPane,
  renderTimeAxis,
  TIME_AXIS_HEIGHT,
  type CrosshairState,
  type RenderTheme,
  type TimeAxisConfig,
} from './renderer.js';
import {
  DEFAULT_TIME_ZONE,
  formatDataHoraCompleta,
  timePartsInZone,
} from './time-format.core.js';
import { formatPrice, type PriceFormatOptions } from './price-format.core.js';
import { SeriesImpl, type SeriesModel } from './series.js';
import {
  coordinateToLogical,
  coordinateToTime,
  createTimeScaleState,
  fitContent,
  indexToTime,
  isFollowingRealTime,
  logicalToCoordinate,
  onBarsAppended,
  onBarsPrepended,
  scrollByPixels,
  scrollToRealTime,
  setVisibleLogicalRange,
  timeToCoordinate,
  timeToIndex,
  visibleLogicalRange,
  visibleTimeRange,
  zoomAtCoordinate,
  type TimeScaleState,
} from './time-scale.core.js';

/** Id da escala de preco PRINCIPAL. Serie sem `priceScaleId` cai nela. */
const MAIN_SCALE_ID = 'right';

/**
 * Uma pane: retangulo vertical, escalas de preco, suas series.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE UMA PANE TEM MAIS DE UMA ESCALA DE PRECO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma pane desenha grandezas de MAGNITUDE INCOMPATIVEL na mesma faixa de pixel:
 * o preco (ex.: 130.000) e o volume (ex.: 0 a 40.000). Uma escala unica para as
 * duas e um defeito grave, e ja foi medido em tela: a autoescala tomava o minimo
 * e o maximo de TODAS as series juntas, a faixa virava `0..130.000`, e as velas
 * ficavam esmagadas em poucos pixels no topo — o grafico aparecia VAZIO, com o
 * eixo marcando 20.000/40.000/.../120.000 e nenhuma vela visivel.
 *
 * Por isso cada pane tem:
 *  - `priceScale` — a escala PRINCIPAL (`'right'`), do preco;
 *  - `overlayScales` — uma escala por `priceScaleId` de overlay (ex.: `'volume'`).
 *
 * Cada escala **autoescala sozinha**, sobre as series que pertencem a ela, e tem
 * suas proprias margens. E o que permite o volume ocupar so os 15% inferiores
 * (`scaleMargins.top = 0.85`) sem tocar na faixa do preco — o histograma se move
 * numa escala DISTINTA da do grafico, que e o comportamento esperado.
 */
interface Pane {
  readonly index: number;
  /** A escala PRINCIPAL (`'right'`): o preco. */
  priceScale: PriceScaleState;
  /**
   * Escalas de OVERLAY por id (ex.: `'volume'`). Criadas sob demanda quando uma
   * serie declara `priceScaleId` diferente do principal.
   *
   * ⚠️ Todas compartilham a ALTURA da pane (o mesmo retangulo de pixel), e se
   * distinguem pela faixa de preco e pelas margens. Nao sao sub-paineis: sub-painel
   * e outra `Pane`.
   */
  readonly overlayScales: Map<string, PriceScaleState>;
  /** Fracao da altura total que esta pane ocupa. */
  heightFraction: number;
  readonly series: SeriesImpl<SeriesType>[];
  /**
   * Escala de preco em modo MANUAL.
   *
   * `false` (default): autoescala a cada quadro pela janela visivel. `true`: o
   * usuario arrastou o eixo de preco, entao a escala fica congelada — a autoescala
   * arrancaria a faixa que ele acabou de definir. Volta a `false` no duplo-clique
   * sobre o eixo.
   */
  priceScaleManual: boolean;
  /**
   * Sub-painel COLAPSADO: ocupa zero altura e nao desenha.
   *
   * ⭐ Existe porque esconder um oscilador nao pode deixar a faixa dele na tela.
   * Marcar as series como `visible: false` apaga o desenho, mas a pane continuaria
   * reservando 19% da altura para mostrar grade vazia — o operador esconderia o RSI
   * e ganharia um retangulo morto. Colapsar devolve a altura ao preco.
   *
   * ⚠️ Por que colapsar em vez de `removePane`: remover destruiria as series e
   * exigiria recriá-las ao reexibir, perdendo cor, linha de referencia e a ordem de
   * desenho. Colapsar preserva tudo — reexibir e devolver a fracao.
   */
  collapsed: boolean;
}

/**
 * Largura reservada ao eixo de preco a direita, em pixel logico.
 *
 * ⚠️ Precisa bater com `priceScale().width()` (56): e a mesma faixa que o
 * mapeador de coordenada do desenho ancora e a mesma onde o arrasto vertical
 * escala o preco. Divergir aqui faria o arrasto "pegar" numa area diferente da que
 * o eixo ocupa visualmente.
 */
const PRICE_AXIS_WIDTH = 56;

/**
 * Meia-espessura, em pixel logico, da faixa sensivel na fronteira entre duas panes.
 *
 * ⚠️ 4 px para cada lado (8 px de alvo total) nao e chute: o alvo tem de ser
 * alcancavel sem o operador "cacar" o pixel, e ao mesmo tempo estreito o bastante
 * para nao roubar o inicio do arrasto de pan perto da borda de um sub-painel. Com
 * 2 px o gesto falhava mais da metade das tentativas; com 10 px o pan colado na
 * divisoria virava redimensionamento por acidente.
 */
const PANE_DIVIDER_GRAB_PX = 4;

/**
 * Altura MINIMA de uma pane, em pixel logico.
 *
 * ⚠️ Sem piso, arrastar a divisoria ate a ponta deixa uma pane com altura 0: ela
 * some da tela E fica sem area para o cursor voltar a pegar a divisoria — o
 * sub-painel ficaria perdido para sempre, sem desfazer nem como recuperar. 40 px
 * e o suficiente para a pane continuar visivel e agarravel.
 */
const MIN_PANE_HEIGHT_PX = 40;

/**
 * Fundo usado ao EXPORTAR imagem quando o tema e `transparent`.
 *
 * ⚠️ Nao e cosmetico: o default do motor e fundo transparente (ele herda o da
 * pagina). Um PNG transparente com o texto claro do eixo, colado num documento
 * branco, fica ilegivel — o rotulo desaparece. Exportar com o cinza-escuro do
 * painel preserva o contraste que o operador viu na tela.
 */
const FUNDO_EXPORTACAO = '#0f172a';

/**
 * Distancia minima, em pixel logico, para a pinca ser considerada intencao.
 *
 * ⚠️ Dedos praticamente juntos dao distancia perto de zero, e a razao
 * `atual / inicial` explodiria para o teto do espacamento num unico quadro. 8 px e o
 * limite abaixo do qual dois contatos sao ruido de toque, nao um gesto.
 */
const PINCH_MIN_DIST_PX = 8;

const DEFAULT_OPTIONS: ChartOptions = {
  layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
  grid: { vertLines: { visible: false }, horzLines: { visible: true } },
  crosshair: { mode: 1 },
  timeScale: {
    rightOffset: 12,
    barSpacing: 8,
    minBarSpacing: 2,
    timeVisible: true,
    secondsVisible: false,
    timeZone: DEFAULT_TIME_ZONE,
  },
  rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.2 } },
  handleScroll: true,
  handleScale: true,
  autoSize: true,
};

export class RobustusChartCore implements IChartApi {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ts: TimeScaleState;
  private panes: Pane[] = [];
  /** Proximo indice ESTAVEL de pane. Nunca reutilizado, para a serie nao apontar
   * para uma pane que virou outra apos remocao. A pane 0 e a principal. */
  private nextPaneId = 1;
  private opts: ChartOptions;
  private theme: RenderTheme;

  private dpr = 1;
  private frame: number | null = null;
  private disposed = false;

  private crosshair: CrosshairState | null = null;

  /** Fuso IANA dos rotulos do eixo de tempo. Injetavel; default B3. */
  private timeZone: string = DEFAULT_TIME_ZONE;
  /** Altura da faixa do eixo de tempo, em pixel logico. */
  private readonly timeAxisHeight = TIME_AXIS_HEIGHT;
  /** Ultima altura total medida (para distribuir panes + reservar o eixo). */
  private totalHeight = 0;
  /** Estado do arrasto vertical do eixo de preco. */
  private scalingPriceAxis = false;
  private scalingPane: Pane | null = null;
  private readonly rangeListeners = new Set<(r: LogicalRange | null) => void>();
  private readonly clickListeners = new Set<(p: MouseEventParams) => void>();
  private readonly crosshairListeners = new Set<(p: MouseEventParams) => void>();

  // Estado do arrasto de pan.
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  /**
   * Ponteiros ATIVOS, por `pointerId`, em pixel logico.
   *
   * ⭐ E o que viabiliza a pinca: com dois dedos na tela, a variacao da DISTANCIA
   * entre eles e o zoom. Um unico ponteiro (o estado anterior) nao tem distancia
   * para variar.
   *
   * ⚠️ Limpo em `pointerup`, `pointercancel` E `pointerleave`. Ponteiro fantasma
   * aqui e defeito permanente: o mapa ficaria com 2 entradas para sempre, todo
   * arrasto de um dedo seria interpretado como pinca, e o pan nunca mais
   * funcionaria — sem nenhum erro no console.
   */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  /**
   * Estado do INICIO do gesto de pinca; `null` = sem pinca em curso.
   *
   * ⭐ Guardar o inicio, e nao o quadro anterior, e a decisao que faz o gesto ser
   * correto — ver `aplicarPinca`.
   */
  private pinchInicio: { dist: number; logicalAncora: number; barSpacing: number } | null = null;

  /**
   * Indice da FRONTEIRA sendo arrastada (`k` = entre `panes[k]` e `panes[k+1]`),
   * ou `null`. Posicao no array, nao o `index` estavel da pane: fronteira e
   * relacao entre vizinhos na ordem de empilhamento.
   */
  private resizingBoundary: number | null = null;

  /**
   * O contexto 2D e REAL (nao o dublê inerte do jsdom)?
   *
   * ⭐ Guardado no construtor porque e a resposta de `takeScreenshot`: sem contexto
   * real nao existe imagem, e o metodo devolve `null` em vez de um canvas em branco
   * que o consumidor salvaria como PNG preto sem desconfiar.
   */
  private readonly hasRealContext: boolean;

  private ro: ResizeObserver | null = null;
  /**
   * A transicao de eixo em curso, ou `null`.
   *
   * Um campo so: transicoes nao se somam. Um `fitContent` durante a animacao de um
   * `scrollToRealTime` SUBSTITUI a anterior, partindo de onde o eixo esta agora — a
   * intencao mais recente e a que vale, e encadear duas rampas produziria um caminho
   * em zigue-zague que ninguem pediu.
   */
  private anim: TimeScaleAnimation | null = null;

  constructor(
    private readonly container: HTMLElement,
    options?: Partial<ChartOptions>,
  ) {
    this.opts = mergeOptions(DEFAULT_OPTIONS, options);
    this.theme = {
      ...DEFAULT_THEME,
      background: this.opts.layout.background.color,
      text: this.opts.layout.textColor,
      grid: this.opts.grid.horzLines.color ?? DEFAULT_THEME.grid,
      gridVisible: this.opts.grid.horzLines.visible,
      gridVertVisible: this.opts.grid.vertLines.visible,
      gridVert: this.opts.grid.vertLines.color,
    };

    this.timeZone = this.opts.timeScale.timeZone ?? DEFAULT_TIME_ZONE;

    this.ts = createTimeScaleState(
      this.opts.timeScale.barSpacing,
      this.opts.timeScale.minBarSpacing,
      this.opts.timeScale.rightOffset,
    );

    // Pane principal (preco) sempre existe.
    this.panes = [
      {
        index: 0,
        priceScale: createPriceScaleState(
          this.opts.rightPriceScale.scaleMargins.top,
          this.opts.rightPriceScale.scaleMargins.bottom,
        ),
        overlayScales: new Map(),
        heightFraction: 1,
        series: [],
        priceScaleManual: false,
        collapsed: false,
      },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) {
      // jsdom devolve null. O motor tolera: nao rasteriza, mas o resto do contrato
      // (conversoes, dado, eventos) continua funcionando para teste.
      this.ctx = criarContextoInerte();
      this.hasRealContext = false;
    } else {
      this.ctx = ctx;
      this.hasRealContext = true;
    }

    this.setupResize();
    this.setupPointer();
    this.measure();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Layout e medida
  // ═══════════════════════════════════════════════════════════════════════════

  private setupResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.container);
  }

  /** Le o tamanho do container e redimensiona o bitmap pelo dpr. */
  private measure(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth || 0;
    const h = this.container.clientHeight || 0;
    this.dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;

    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));

    this.ts.width = w;
    this.totalHeight = h;
    this.distributePaneHeights(h);
    this.scheduleRender();
  }

  /**
   * Reparte a altura entre as panes conforme as fracoes, RESERVANDO a faixa do
   * eixo de tempo na base.
   *
   * ⚠️ A altura das panes soma `totalH - timeAxisHeight`, nao `totalH`. E o que
   * impede as series de desenharem por cima dos rotulos de data/hora: a tira
   * `[totalH - timeAxisHeight, totalH]` fica fora de toda pane, livre para o eixo.
   */
  private distributePaneHeights(totalH: number): void {
    const util = Math.max(1, totalH - this.timeAxisHeight);
    const soma = this.panes.reduce((a, p) => a + p.heightFraction, 0) || 1;
    for (const p of this.panes) {
      const h = (p.heightFraction / soma) * util;
      // ⚠️ TODAS as escalas da pane recebem a altura — inclusive as de overlay.
      // Elas dividem o mesmo retangulo de pixel e se distinguem por faixa e
      // margem; uma overlay com altura 0 converteria tudo para `null` e o volume
      // simplesmente nao apareceria, sem erro nenhum.
      for (const s of this.allScalesOf(p)) s.height = h;
    }
  }

  /** Y do topo de uma pane, em pixel logico. */
  private paneTop(index: number): number {
    let y = 0;
    for (const p of this.panes) {
      if (p.index === index) return y;
      y += p.priceScale.height;
    }
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IChartApi — series e panes
  // ═══════════════════════════════════════════════════════════════════════════

  addSeries<S extends SeriesType>(
    type: S,
    options: Partial<SeriesOptionsCommon> = {},
    paneIndex = 0,
  ): ISeriesApi<S> {
    const pane = this.panes.find((p) => p.index === paneIndex) ?? this.panes[0]!;

    // ⭐ Resolve a escala AGORA (criando a de overlay se preciso), e entrega a
    // serie um getter para ELA — nao para a escala principal da pane. Era esse
    // acoplamento que fazia o volume dividir a escala do preco e esmagar as velas.
    const scaleId = options.priceScaleId ?? MAIN_SCALE_ID;
    const escala = this.ensureScale(pane, scaleId);

    const serie = new SeriesImpl<S>(type, options, pane.index, () => escala, () =>
      this.scheduleRender(),
    );
    serie.chartRef = this;
    pane.series.push(serie as unknown as SeriesImpl<SeriesType>);
    this.scheduleRender();
    return serie;
  }

  /**
   * Devolve a escala de `scaleId` na pane, criando-a se for de overlay e ainda nao
   * existir.
   *
   * A escala de overlay nasce com margens que a deixam VISIVEL mas discreta
   * (`top: 0.8`, `bottom: 0`) — o uso dominante e volume no pe do painel. O
   * consumidor ajusta depois via `priceScale(id).applyOptions({ scaleMargins })`.
   * `'left'` e tratado como o principal: este motor desenha um eixo so, a direita.
   */
  private ensureScale(pane: Pane, scaleId: string): PriceScaleState {
    if (scaleId === MAIN_SCALE_ID || scaleId === 'left') return pane.priceScale;
    const existente = pane.overlayScales.get(scaleId);
    if (existente !== undefined) return existente;
    const nova = createPriceScaleState(0.8, 0);
    // A escala nova precisa da altura corrente da pane; sem isso a primeira
    // passada converteria contra altura 0 e devolveria `null` em tudo.
    nova.height = pane.priceScale.height;
    pane.overlayScales.set(scaleId, nova);
    return nova;
  }

  /**
   * A serie participa do desenho e da autoescala?
   *
   * `visible` ausente conta como VISIVEL — o default tem de ser "aparece", senao
   * toda serie criada sem passar a opcao nasceria invisivel. Ver a nota do campo
   * em `SeriesOptionsCommon`.
   */
  private static visivel(serie: SeriesImpl<SeriesType>): boolean {
    return serie.model.options.visible !== false;
  }

  /** A escala a que uma serie pertence, dentro da pane dela. */
  private scaleOf(pane: Pane, serie: SeriesImpl<SeriesType>): PriceScaleState {
    const id = serie.model.options.priceScaleId ?? MAIN_SCALE_ID;
    if (id === MAIN_SCALE_ID || id === 'left') return pane.priceScale;
    return pane.overlayScales.get(id) ?? pane.priceScale;
  }

  /** Todas as escalas de uma pane: a principal primeiro, depois as de overlay. */
  private allScalesOf(pane: Pane): PriceScaleState[] {
    return [pane.priceScale, ...pane.overlayScales.values()];
  }

  removeSeries(series: ISeriesApi<SeriesType>): void {
    for (const p of this.panes) {
      const i = p.series.indexOf(series as unknown as SeriesImpl<SeriesType>);
      if (i >= 0) {
        p.series.splice(i, 1);
        this.scheduleRender();
        return;
      }
    }
  }

  /**
   * Cria um sub-painel abaixo e devolve o indice ESTAVEL dele.
   *
   * ⚠️ O indice e um identificador que NAO muda quando outra pane e removida — e
   * a chave que a serie guarda. A POSICAO visual (ordem de empilhamento) vem da
   * ordem no array `panes`, nao do indice. Separar as duas coisas e o que permite
   * `removePane` tirar uma pane do meio sem renumerar as sobreviventes e sem
   * orfanar as series delas.
   */
  addPane(): number {
    const index = this.nextPaneId++;
    this.panes.push({
      index,
      priceScale: createPriceScaleState(0.15, 0.15),
      overlayScales: new Map(),
      heightFraction: 0, // definido por rebalancePanes
      series: [],
      priceScaleManual: false,
      collapsed: false,
    });
    this.rebalancePanes();
    this.measure();
    return index;
  }

  /**
   * Remove um sub-painel e TODAS as series dele. Recompacta o layout.
   *
   * Fecha a divida do `IndicatorPlotter`: ao desligar um oscilador, a pane some de
   * verdade em vez de ficar uma faixa vazia. A pane principal (indice 0) nao pode
   * ser removida — ela e o grafico de preco; um pedido de remove-la e ignorado.
   *
   * Idempotente: remover um indice inexistente e no-op.
   */
  removePane(index: number): void {
    if (this.disposed || index === 0) return;
    const pos = this.panes.findIndex((p) => p.index === index);
    if (pos < 0) return;

    const pane = this.panes[pos]!;
    // Desanexa as primitives das series antes de descartar, senao ficam vivas
    // segurando referencia ao grafico.
    for (const s of pane.series) {
      for (const prim of s.model.primitives) {
        try {
          prim.detached();
        } catch {
          /* primitive em descarte */
        }
      }
    }
    this.panes.splice(pos, 1);
    this.rebalancePanes();
    this.measure();
  }

  /**
   * Reparte a altura entre a pane principal e os sub-paineis.
   *
   * Ponto UNICO de decisao de fracao, chamado por `addPane` e `removePane` — antes
   * a regra estava duplicada no `addPane` e divergia ao remover. O principal fica
   * com a maior fatia; os sub-paineis dividem o resto por igual, porque oscilador
   * precisa de menos altura que o preco e um nao vale mais que o outro.
   */
  private rebalancePanes(): void {
    // ⭐ Sub-painel COLAPSADO nao conta na divisao e recebe fracao ZERO. Sem isso o
    // oscilador escondido seguiria reservando a altura dele, e a tela mostraria uma
    // faixa vazia no lugar de devolver o espaco ao preco.
    const subs = this.panes.filter((p) => p.index !== 0 && !p.collapsed).length;
    for (const p of this.panes) {
      if (p.collapsed) p.heightFraction = 0;
    }
    if (subs <= 0) {
      this.panes[0]!.heightFraction = 1;
      return;
    }
    // Principal com 62%, sub-paineis dividindo 38% — os mesmos valores de antes,
    // agora num lugar so.
    this.panes[0]!.heightFraction = 0.62;
    for (let k = 1; k < this.panes.length; k++) {
      const p = this.panes[k]!;
      if (p.collapsed) continue;
      p.heightFraction = 0.38 / subs;
    }
  }

  /**
   * Mostra ou esconde um sub-painel inteiro, PRESERVANDO as series dele.
   *
   * ⭐ E o par de `SeriesOptionsCommon.visible` no nivel da pane: esconder as series
   * de um oscilador sem colapsar a faixa deixaria um retangulo de grade vazia
   * ocupando altura. Aqui a fracao vai a zero e a altura volta ao preco.
   *
   * A pane principal (indice 0) nao pode ser escondida — ela e o grafico; o pedido
   * e ignorado em vez de deixar a tela em branco. Idempotente, e indice inexistente
   * e no-op.
   *
   * ⚠️ Diferente de `removePane`: aqui nada e destruido. Reexibir devolve a pane com
   * as mesmas series, cores e linhas de referencia — e por isso que esconder um
   * indicador nao precisa recria-lo.
   */
  setPaneVisible(paneIndex: number, visible: boolean): void {
    if (this.disposed || paneIndex === 0) return;
    const pane = this.panes.find((p) => p.index === paneIndex);
    if (pane === undefined || pane.collapsed === !visible) return;
    pane.collapsed = !visible;
    // Uma pane colapsada nao pode continuar com a escala em modo manual: ela nao tem
    // eixo na tela para o usuario religar a autoescala com o duplo-clique, e voltaria
    // congelada numa faixa que pode nao ter mais nada a ver com o dado.
    if (pane.collapsed) pane.priceScaleManual = false;
    this.rebalancePanes();
    this.measure();
  }

  /** O sub-painel esta visivel? Pane inexistente conta como nao visivel. */
  isPaneVisible(paneIndex: number): boolean {
    const pane = this.panes.find((p) => p.index === paneIndex);
    return pane !== undefined && !pane.collapsed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IChartApi — escalas
  // ═══════════════════════════════════════════════════════════════════════════

  timeScale(): ITimeScaleApi {
    const self = this;
    return {
      timeToCoordinate: (t) => timeToCoordinate(self.ts, t),
      coordinateToTime: (x) => coordinateToTime(self.ts, x),
      timeToIndex: (t, fn) => timeToIndex(self.ts, t, fn),
      logicalToCoordinate: (l) => logicalToCoordinate(self.ts, l),
      coordinateToLogical: (x) => coordinateToLogical(self.ts, x),
      getVisibleRange: (): TimeRange | null => visibleTimeRange(self.ts),
      getVisibleLogicalRange: () => visibleLogicalRange(self.ts),
      // ⭐ Os tres metodos que MOVEM a janela por comando passam pelo mesmo portao de
      // animacao (`transicaoDeEixo`). Ele aplica a mutacao de verdade e, se a animacao
      // estiver ligada, faz o eixo VIAJAR ate lá em vez de saltar. Desligada (o
      // default), a mutacao fica exatamente como era: sincrona, no mesmo quadro.
      setVisibleLogicalRange: (r) => {
        self.transicaoDeEixo(() => setVisibleLogicalRange(self.ts, r));
      },
      fitContent: () => {
        self.transicaoDeEixo(() => fitContent(self.ts));
      },
      scrollToRealTime: () => {
        self.transicaoDeEixo(() => scrollToRealTime(self.ts));
      },
      subscribeVisibleLogicalRangeChange: (h) => self.rangeListeners.add(h),
      unsubscribeVisibleLogicalRangeChange: (h) => self.rangeListeners.delete(h),
    };
  }

  /**
   * Acesso a uma escala de preco por id.
   *
   * ⚠️ **Isto ja foi um defeito grave e silencioso.** A versao anterior ignorava o
   * `id` e devolvia sempre a escala do PRECO da pane 0. Consequencia medida: quando
   * o consumidor empurrava o volume para o pe do painel com
   * `priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })`,
   * ele estava alterando a margem do PRECO — comprimindo as velas numa faixa de 15%
   * em vez de mover o volume. Agora o id resolve a escala de verdade.
   *
   * A escala de overlay e criada sob demanda: o consumidor pode configurar as
   * margens ANTES de criar a serie que a usa, e a configuracao tem de sobreviver.
   */
  priceScale(id: string): IPriceScaleApi {
    const self = this;
    const pane = this.panes[0]!;
    const alvo = this.ensureScale(pane, id);
    return {
      applyOptions: (o: Partial<PriceScaleOptions>) => {
        if (o.scaleMargins !== undefined) {
          alvo.marginTop = o.scaleMargins.top;
          alvo.marginBottom = o.scaleMargins.bottom;
        }
        if (o.mode !== undefined) alvo.logarithmic = o.mode === 'logarithmic';
        self.scheduleRender();
      },
      width: () => {
        // Largura reservada ao eixo de preco a direita. Fixa e suficiente para o
        // mapeador de coordenada do desenho ancorar a borda util.
        return 56;
      },
    };
  }

  paneSize(paneIndex = 0): PaneSize {
    const pane = this.panes.find((p) => p.index === paneIndex) ?? this.panes[0]!;
    return { width: this.ts.width, height: pane.priceScale.height };
  }

  options(): ChartOptions {
    return this.opts;
  }

  applyOptions(options: Partial<ChartOptions>): void {
    this.opts = mergeOptions(this.opts, options);
    this.timeZone = this.opts.timeScale.timeZone ?? DEFAULT_TIME_ZONE;
    this.theme = {
      ...this.theme,
      background: this.opts.layout.background.color,
      text: this.opts.layout.textColor,
      grid: this.opts.grid.horzLines.color ?? DEFAULT_THEME.grid,
      gridVisible: this.opts.grid.horzLines.visible,
      // ⚠️ A grade VERTICAL tem de ser relida aqui, senao `applyOptions({ grid })`
      // atualizava `opts` e nao chegava ao tema — a opcao existiria e nao faria
      // nada, que era exatamente o estado anterior de `vertLines.visible`.
      gridVertVisible: this.opts.grid.vertLines.visible,
      gridVert: this.opts.grid.vertLines.color,
    };
    this.scheduleRender();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IChartApi — eventos
  // ═══════════════════════════════════════════════════════════════════════════

  subscribeClick(handler: (p: MouseEventParams) => void): void {
    this.clickListeners.add(handler);
  }

  subscribeCrosshairMove(handler: (p: MouseEventParams) => void): void {
    this.crosshairListeners.add(handler);
  }

  // ⭐ A simetria que faltava. `Set.delete` de handler desconhecido e no-op, entao os
  // dois metodos sao idempotentes por construcao — chamar no desmonte sem saber se
  // chegou a assinar e seguro.
  unsubscribeClick(handler: (p: MouseEventParams) => void): void {
    this.clickListeners.delete(handler);
  }

  unsubscribeCrosshairMove(handler: (p: MouseEventParams) => void): void {
    this.crosshairListeners.delete(handler);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IChartApi — exportar imagem
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Copia do quadro corrente num canvas NOVO. `null` sem rasterizacao.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * TRES DECISOES QUE IMPORTAM
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * 1. **Copia, nao a referencia interna.** O canvas do motor e limpo e redesenhado
   *    a cada quadro; devolve-lo faria a "foto" mudar sozinha no proximo pan.
   *
   * 2. **Descarrega o quadro pendente antes de copiar.** O render e coalescido: um
   *    `setData` seguido de screenshot no mesmo tick fotografaria o estado ANTERIOR
   *    ao dado — a imagem sairia atrasada em um quadro, e de forma intermitente
   *    (dependendo de onde o rAF caiu), que e o tipo de defeito que ninguem
   *    reproduz.
   *
   * 3. **Pinta o fundo.** O default do motor e `transparent`, e canvas transparente
   *    exportado para PNG e colado num documento branco fica ilegivel (texto claro
   *    sobre branco). Sem cor de fundo configurada, usa o cinza-escuro do tema —
   *    a aparencia que o operador ve na tela.
   *
   * ⚠️ Nunca lanca: qualquer falha de alocacao ou de contexto vira `null`.
   */
  takeScreenshot(): HTMLCanvasElement | null {
    if (this.disposed || !this.hasRealContext) return null;
    try {
      this.flushRender();

      const copia = document.createElement('canvas');
      copia.width = this.canvas.width;
      copia.height = this.canvas.height;
      if (copia.width <= 0 || copia.height <= 0) return null;

      const cctx = copia.getContext('2d');
      if (cctx === null) return null;

      const fundo = this.theme.background;
      cctx.fillStyle = fundo === 'transparent' ? FUNDO_EXPORTACAO : fundo;
      cctx.fillRect(0, 0, copia.width, copia.height);
      cctx.drawImage(this.canvas, 0, 0);
      return copia;
    } catch {
      // Ambiente sem `drawImage`/`createElement` utilizavel. `null` = "nao sei
      // rasterizar", como manda a disciplina da camada.
      return null;
    }
  }

  /**
   * O quadro corrente como data URL. `null` sem rasterizacao.
   *
   * ⚠️ O jsdom TEM o metodo `toDataURL` no prototipo, e ele nao lanca — devolve
   * `undefined` (ou uma string vazia) por nao ter backend de imagem. Um `try/catch`
   * sozinho passaria isso adiante como se fosse resultado. Por isso o retorno e
   * VALIDADO (`data:` no comeco) antes de sair.
   */
  toDataURL(type = 'image/png', quality?: number): string | null {
    const snap = this.takeScreenshot();
    if (snap === null) return null;
    try {
      const url = quality === undefined ? snap.toDataURL(type) : snap.toDataURL(type, quality);
      if (typeof url !== 'string' || !url.startsWith('data:')) return null;
      return url;
    } catch {
      return null;
    }
  }

  /**
   * Roda AGORA o quadro que estava agendado, se havia um.
   *
   * O render e coalescido por `requestAnimationFrame`; quem precisa do canvas
   * atualizado no mesmo tick (a exportacao de imagem) nao pode esperar o proximo
   * quadro. Cancelar o agendamento antes evita desenhar duas vezes.
   */
  private flushRender(): void {
    if (this.frame === null) return;
    try {
      cancelAnimationFrame(this.frame);
    } catch {
      /* ambiente sem rAF: o agendamento caiu num setTimeout, e desenhar de novo
         e apenas redundante, nao incorreto */
    }
    this.frame = null;
    this.render();
  }

  remove(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.ro?.disconnect();
    this.teardownPointer();
    for (const p of this.panes) for (const s of p.series) for (const prim of s.model.primitives) {
      try {
        prim.detached();
      } catch {
        /* primitive em descarte */
      }
    }
    try {
      this.container.removeChild(this.canvas);
    } catch {
      /* ja removido */
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Interacao
  // ═══════════════════════════════════════════════════════════════════════════

  private setupPointer(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  private teardownPointer(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
  }

  private scrollEnabled(): boolean {
    const h = this.opts.handleScroll;
    if (typeof h === 'boolean') return h;
    return (h as HandleScrollOptions).pressedMouseMove;
  }

  /**
   * Pan permitido para ESTE tipo de ponteiro.
   *
   * ⭐ Toque tem chave propria no contrato (`horzTouchDrag`/`vertTouchDrag`) e ela
   * existe por um motivo pratico: numa pagina que rola, arrastar o dedo sobre o
   * grafico costuma ser tentativa de rolar a PAGINA, nao o grafico. Quem embute o
   * grafico num feed desliga o arrasto por toque e mantem o do mouse.
   *
   * `eixo`: `'horz'` e o pan no tempo; `'vert'` e o arrasto que escala o preco.
   */
  private touchDragEnabled(eixo: 'horz' | 'vert'): boolean {
    const h = this.opts.handleScroll;
    if (typeof h === 'boolean') return h;
    return eixo === 'horz' ? h.horzTouchDrag : h.vertTouchDrag;
  }

  /** O ponteiro e um dedo (ou caneta em tela)? `undefined` conta como mouse. */
  private isTouch(e: PointerEvent): boolean {
    return e.pointerType === 'touch';
  }

  private scaleEnabled(): boolean {
    const h = this.opts.handleScale;
    return typeof h === 'boolean' ? h : h.mouseWheel;
  }

  /** Pinca (zoom por dois dedos) habilitada? */
  private pinchEnabled(): boolean {
    const h = this.opts.handleScale;
    return typeof h === 'boolean' ? h : h.pinch;
  }

  /** O ponto (pixel logico) cai sobre a faixa do eixo de preco, a direita? */
  private isOnPriceAxis(x: number): boolean {
    return x >= this.ts.width - PRICE_AXIS_WIDTH && x <= this.ts.width;
  }

  /** Qual pane contem o Y (pixel logico)? A ultima cujo topo <= y. */
  private paneAtY(y: number): Pane | null {
    let acc = 0;
    for (const p of this.panes) {
      // ⚠️ Pane colapsada tem altura ZERO, e `y >= acc && y <= acc + 0` casa
      // exatamente na fronteira dela. Sem pular, o crosshair na borda entre duas
      // panes visiveis seria atribuido a uma pane invisivel no meio, e o rotulo de
      // preco sairia lido na escala errada.
      if (p.collapsed) continue;
      if (y >= acc && y <= acc + p.priceScale.height) return p;
      acc += p.priceScale.height;
    }
    return null;
  }

  /**
   * A fronteira entre panes sob o Y, ou `null`.
   *
   * ⚠️ So conta fronteira ENTRE DUAS PANES: a base da ultima pane e a borda da
   * tira do eixo de tempo, e arrastar ali nao redistribui nada — nao ha pane
   * abaixo para ceder ou receber altura. Por isso o laco para em
   * `panes.length - 1`, e com uma pane so nao existe fronteira alguma (o grafico
   * sem sub-painel nunca muda o cursor).
   *
   * Devolve a POSICAO `k` no array: a fronteira separa `panes[k]` de `panes[k+1]`.
   */
  private paneBoundaryAt(y: number): number | null {
    // ⚠️ Somente panes VISIVEIS tem fronteira arrastavel. Uma colapsada tem altura
    // zero, entao a fronteira dela coincide com a da vizinha — duas divisorias no
    // mesmo pixel, e o arrasto redistribuiria altura de uma pane que nao esta na
    // tela (efeito: a divisoria "nao pega", ou pega e nada se move).
    const visiveis = this.panes.filter((p) => !p.collapsed);
    if (visiveis.length < 2) return null;
    let acc = 0;
    for (let k = 0; k < visiveis.length - 1; k++) {
      acc += visiveis[k]!.priceScale.height;
      if (Math.abs(y - acc) <= PANE_DIVIDER_GRAB_PX) return this.panes.indexOf(visiveis[k]!);
    }
    return null;
  }

  /**
   * Redistribui altura entre as duas panes vizinhas de uma fronteira.
   *
   * ⭐ Trabalha em PIXEL e converte de volta para fracao no fim, em vez de mexer
   * direto nas fracoes: o arrasto do usuario vem em pixel, e converter no comeco
   * (dividindo `dy` por uma altura util que muda com o redimensionamento da janela)
   * daria um deslocamento que nao acompanha o dedo.
   *
   * ⚠️ A SOMA das duas fracoes e preservada. As demais panes nao se mexem — o
   * operador arrastou UMA divisoria e espera que so as duas vizinhas mudem. E o
   * piso de `MIN_PANE_HEIGHT_PX` corta o excesso antes da conversao, para nenhuma
   * das duas chegar a zero (ver a constante).
   */
  private resizePaneBoundary(k: number, dyPx: number): void {
    const a = this.panes[k];
    // A vizinha de baixo e a proxima VISIVEL, nao a proxima do array: uma pane
    // colapsada entre as duas nao pode receber a altura arrastada (ela nao aparece,
    // e o movimento se perderia num retangulo invisivel).
    const b = this.panes.slice(k + 1).find((p) => !p.collapsed);
    if (a === undefined || b === undefined || a.collapsed || !Number.isFinite(dyPx)) return;

    const util = Math.max(1, this.totalHeight - this.timeAxisHeight);
    const soma = this.panes.reduce((acc, p) => acc + p.heightFraction, 0);
    if (!(soma > 0)) return;

    const pxA = (a.heightFraction / soma) * util;
    const pxB = (b.heightFraction / soma) * util;
    const parAlt = pxA + pxB;
    // Par curto demais para respeitar o piso nas duas: nao ha o que redistribuir.
    if (parAlt < MIN_PANE_HEIGHT_PX * 2) return;

    const alvoA = Math.min(parAlt - MIN_PANE_HEIGHT_PX, Math.max(MIN_PANE_HEIGHT_PX, pxA + dyPx));
    const novoA = alvoA;
    const novoB = parAlt - alvoA;

    a.heightFraction = (novoA / util) * soma;
    b.heightFraction = (novoB / util) * soma;
    this.distributePaneHeights(this.totalHeight);
    this.scheduleRender();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // ⭐ O usuario agarrou o grafico: a transicao em curso morre AQUI, onde o eixo
    // está. Continuar a rampa faria o conteudo escorregar debaixo da mao dele, e
    // saltar para o destino arrancaria a tela no instante do toque.
    this.cancelarAnimacao();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    this.pointers.set(e.pointerId, { x, y });

    // ⭐ Dois ponteiros ativos => PINCA. Cancela pan e escala de eixo em curso: o
    // segundo dedo muda a natureza do gesto, e continuar panando com um deles
    // faria o grafico "escorregar" durante o zoom.
    if (this.pointers.size >= 2) {
      this.dragging = false;
      this.scalingPriceAxis = false;
      this.scalingPane = null;
      this.resizingBoundary = null;
      this.reiniciarPinca();
      return;
    }

    // Arrasto sobre a DIVISORIA entre panes redimensiona. Tem precedencia sobre o
    // pan e sobre a escala de eixo: a faixa de 4 px e alvo explicito do operador.
    const fronteira = this.paneBoundaryAt(y);
    if (fronteira !== null && !this.isOnPriceAxis(x)) {
      this.resizingBoundary = fronteira;
      this.lastPointerY = e.clientY;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ambiente sem captura */
      }
      return;
    }

    // Arrasto sobre o eixo de preco ESCALA o preco (nao faz pan). Tem precedencia
    // sobre o pan porque o cursor esta sobre a faixa do eixo, nao sobre as velas.
    if (this.scaleEnabled() && this.isOnPriceAxis(x)) {
      // Por toque, respeita `vertTouchDrag`: e arrasto vertical.
      if (this.isTouch(e) && !this.touchDragEnabled('vert')) return;
      const pane = this.paneAtY(y);
      if (pane !== null) {
        this.scalingPriceAxis = true;
        this.scalingPane = pane;
        this.lastPointerY = e.clientY;
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ambiente sem captura */
        }
        return;
      }
    }

    if (!this.scrollEnabled()) return;
    if (this.isTouch(e) && !this.touchDragEnabled('horz')) return;
    this.dragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ambiente sem captura */
    }
  };

  /**
   * Distancia euclidiana entre os DOIS primeiros ponteiros ativos, ou `null`.
   *
   * ⚠️ Usa a distancia completa, nao so a horizontal, embora o zoom seja so no
   * eixo de tempo. E deliberado: a pinca diagonal e a mais natural de fazer com o
   * polegar e o indice, e medir apenas `dx` daria zoom fraco (ou nenhum) num gesto
   * que o usuario percebeu como amplo.
   */
  private distanciaEntrePonteiros(): number | null {
    if (this.pointers.size < 2) return null;
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    if (a === undefined || b === undefined) return null;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return Number.isFinite(d) ? d : null;
  }

  /** Ponto MEDIO entre os dois ponteiros — a ancora do zoom da pinca. */
  private pontoMedioX(): number | null {
    if (this.pointers.size < 2) return null;
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    if (a === undefined || b === undefined) return null;
    return (a.x + b.x) / 2;
  }

  /**
   * (Re)abre o gesto de pinca a partir do estado ATUAL dos dois ponteiros.
   *
   * Chamado quando o segundo dedo desce e tambem quando um terceiro sobe/desce: o
   * conjunto de dedos mudou, e continuar medindo contra a distancia de um par que
   * nao existe mais daria um salto de zoom.
   *
   * ⚠️ Piso de 8 px na distancia inicial: dois dedos praticamente juntos dao
   * distancia perto de zero, e a razao `atual/inicial` explodiria para o teto do
   * espacamento num quadro so. Abaixo do piso, o gesto e ruido de contato e a pinca
   * simplesmente nao abre.
   */
  private reiniciarPinca(): void {
    if (!this.pinchEnabled()) {
      this.pinchInicio = null;
      return;
    }
    const dist = this.distanciaEntrePonteiros();
    const meio = this.pontoMedioX();
    if (dist === null || meio === null || dist < PINCH_MIN_DIST_PX || this.ts.barSpacing <= 0) {
      this.pinchInicio = null;
      return;
    }
    const ancora = coordinateToLogical(this.ts, meio);
    if (ancora === null) {
      this.pinchInicio = null;
      return;
    }
    this.pinchInicio = { dist, logicalAncora: ancora, barSpacing: this.ts.barSpacing };
  }

  /**
   * Aplica a pinca: espacamento proporcional a razao de distancia, com o instante
   * do ponto medio ancorado.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ⭐ POR QUE ABSOLUTO (CONTRA O INICIO), E NAO INCREMENTAL (CONTRA O QUADRO ANTERIOR)
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * A primeira versao era incremental: `fator = distAtual / distAnterior`, zoom
   * ancorado no ponto medio corrente. Passava no teste de "afastar aproxima" e
   * **falhava de um jeito que o operador sentiria**, porque o navegador entrega
   * `pointermove` de UM ponteiro por vez:
   *
   * Transladar os dois dedos 80 px para a direita (gesto de pan com dois dedos,
   * comum) chega como dois eventos. No primeiro, so um dedo se moveu: a distancia
   * medida CAI de 200 para 120 e o motor da zoom-out de 0,6 ancorado em 440. No
   * segundo ela volta a 200 e o motor da zoom-in de 1,667 ancorado em 480. O
   * espacamento volta ao valor certo, mas as duas ancoras eram diferentes e sobra
   * uma translacao residual — medida em teste: 3,33 barras **na direcao contraria
   * ao gesto**. O grafico "escorregava" para o lado errado durante a pinca.
   *
   * A formulacao absoluta nao tem esse estado: `logicalAncora` (o indice sob o ponto
   * medio quando o gesto abriu) e o espacamento inicial ficam fixos, e cada quadro
   * recalcula a posicao FINAL a partir deles. Estado intermediario nao acumula erro
   * — a translacao pura devolve exatamente o pan de 80 px, na direcao certa, e a
   * pinca pura mantem o instante do ponto medio imovel com igualdade exata.
   *
   * ⚠️ O zoom em si passa por `zoomAtCoordinate`, o MESMO nucleo do zoom por roda:
   * e ele que aplica os limites de espacamento (`minBarSpacing` e o teto). Duplicar
   * a conta aqui divergiria dos limites na primeira mudanca. A linha seguinte fixa a
   * ancora de forma absoluta — o que `zoomAtCoordinate` ancorou de forma relativa e
   * so um passo intermediario.
   */
  private aplicarPinca(): void {
    const ini = this.pinchInicio;
    const atual = this.distanciaEntrePonteiros();
    const meio = this.pontoMedioX();
    if (ini === null || atual === null || meio === null) return;
    // Dedos colapsando um sobre o outro: ignora o quadro em vez de tentar zoom.
    if (atual < PINCH_MIN_DIST_PX || this.ts.barSpacing <= 0) return;

    const alvo = ini.barSpacing * (atual / ini.dist);
    if (!Number.isFinite(alvo) || alvo <= 0) return;

    zoomAtCoordinate(this.ts, meio, alvo / this.ts.barSpacing);
    if (this.ts.barSpacing <= 0) return;
    this.ts.leftLogical = ini.logicalAncora - meio / this.ts.barSpacing;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.crosshair = { x, y };

    // Atualiza a posicao SO de ponteiro que esta pressionado (esta no mapa). Um
    // `pointermove` de mouse sem botao nao entra — senao o hover cadastraria um
    // ponteiro que nunca sera removido por `pointerup`.
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });

    // ⭐ PINCA tem precedencia sobre tudo: dois dedos na tela e gesto de zoom.
    //
    // ⚠️ Sai daqui mesmo com a pinca DESLIGADA (`pinchInicio === null`). Cair no pan
    // com dois dedos na tela seria pior que nao fazer nada: o grafico correria atras
    // de um dos dois dedos, aos pulos, conforme a ordem dos eventos.
    if (this.pointers.size >= 2) {
      this.aplicarPinca();
      this.emitCrosshair();
      this.scheduleRender();
      return;
    }

    // Cursor de redimensionamento quando o ponteiro passa sobre uma divisoria. Fica
    // ANTES do arrasto para o cursor nao "piscar" de volta durante o gesto.
    this.atualizarCursor(x, y);

    if (this.resizingBoundary !== null) {
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerY = e.clientY;
      this.resizePaneBoundary(this.resizingBoundary, dy);
      this.emitCrosshair();
      return;
    }

    if (this.scalingPriceAxis && this.scalingPane !== null) {
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerY = e.clientY;
      this.scalePriceAxis(this.scalingPane, dy);
    } else if (this.dragging && this.scrollEnabled()) {
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      // Arrastar para a direita revela o passado: leftLogical DIMINUI. Por isso
      // rolamos por `-dx`.
      scrollByPixels(this.ts, -dx);
    }

    this.emitCrosshair();
    this.scheduleRender();
  };

  /**
   * Escala o eixo de preco de uma pane pelo arrasto vertical, em torno do CENTRO.
   *
   * ⭐ Arrastar para BAIXO comprime a faixa (aproxima — `dy > 0` reduz o intervalo
   * topo-base); para cima expande. A escala e em torno do centro do intervalo para
   * o meio da tela ficar parado enquanto o operador "estica" o preco. Liga o modo
   * manual: enquanto durar, a autoescala nao mexe mais na faixa.
   */
  private scalePriceAxis(pane: Pane, dyPx: number): void {
    const ps = pane.priceScale;
    const span = ps.topPrice - ps.bottomPrice;
    if (!(span > 0) || ps.height <= 0) return;

    // Fator suave e proporcional a fracao da altura arrastada — o mesmo principio
    // do zoom por roda no eixo de tempo. dy>0 (para baixo) => fator<1 => comprime.
    const fator = Math.exp(dyPx / ps.height);
    const centro = (ps.topPrice + ps.bottomPrice) / 2;
    const meia = (span * fator) / 2;
    ps.topPrice = centro + meia;
    ps.bottomPrice = centro - meia;
    pane.priceScaleManual = true;
  }

  /**
   * Cursor `ns-resize` sobre a divisoria entre panes; vazio fora dela.
   *
   * ⭐ E a unica affordance do recurso: sem a troca de cursor, o operador nao tem
   * como descobrir que a divisoria e arrastavel. Nao mexe no cursor durante um
   * arrasto ja em curso — perder o `ns-resize` no meio do gesto sugeriria que ele
   * terminou.
   */
  private atualizarCursor(x: number, y: number): void {
    if (this.resizingBoundary !== null || this.dragging || this.scalingPriceAxis) return;
    const sobreDivisoria = !this.isOnPriceAxis(x) && this.paneBoundaryAt(y) !== null;
    const desejado = sobreDivisoria ? 'ns-resize' : '';
    // Le antes de escrever: atribuir `style.cursor` a cada `pointermove` invalidaria
    // estilo do elemento dezenas de vezes por segundo sem mudar nada.
    if (this.canvas.style.cursor !== desejado) this.canvas.style.cursor = desejado;
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const estavaEscalando = this.scalingPriceAxis;
    const estavaRedimensionando = this.resizingBoundary !== null;
    const estavaEmPinca = this.pointers.size >= 2;

    this.esquecerPonteiro(e.pointerId);
    this.dragging = false;
    this.scalingPriceAxis = false;
    this.scalingPane = null;
    this.resizingBoundary = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ja solto */
    }
    // Arrasto de escala, redimensionamento de pane e pinca nao sao clique do
    // grafico — emiti-los faria a camada de desenho criar uma figura ao fim de cada
    // gesto de ajuste.
    if (!estavaEscalando && !estavaRedimensionando && !estavaEmPinca) this.emitClick();
  };

  /**
   * `pointercancel`: o sistema tirou o ponteiro da aplicacao (gesto do SO, chamada
   * entrando, dedo saindo pela borda da tela).
   *
   * ⚠️ Sem tratar isto, o ponteiro cancelado NUNCA sairia do mapa — `pointerup` nao
   * vem depois de um cancel. O mapa ficaria preso em 2 entradas e todo arrasto
   * posterior de um dedo seria lido como pinca. Foi por isso que o evento entrou
   * junto com a pinca, e nao "por completude".
   */
  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.esquecerPonteiro(e.pointerId);
    this.dragging = false;
    this.scalingPriceAxis = false;
    this.scalingPane = null;
    this.resizingBoundary = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ja solto */
    }
  };

  /**
   * Tira um ponteiro do mapa e ajusta a pinca.
   *
   * Sobrou menos de dois: a pinca encerra. Sobraram dois ou mais (era um gesto de
   * tres dedos): REABRE contra o par que ficou — medir contra a distancia de um par
   * que nao existe mais daria um salto de zoom no quadro seguinte.
   */
  private esquecerPonteiro(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.pointers.size < 2) this.pinchInicio = null;
    else this.reiniciarPinca();
  }

  /**
   * Duplo-clique sobre o eixo de preco RELIGA a autoescala daquela pane.
   *
   * E o par do arrasto que a desligou: o operador estica o eixo a mao e, quando
   * quer voltar ao enquadramento automatico, da dois cliques no eixo. Fora do
   * eixo, o duplo-clique nao faz nada aqui.
   */
  private readonly onDoubleClick = (e: MouseEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!this.isOnPriceAxis(x)) return;
    const pane = this.paneAtY(y);
    if (pane === null) return;
    pane.priceScaleManual = false;
    this.scheduleRender();
  };

  /**
   * `pointerleave`: o ponteiro saiu do canvas.
   *
   * ⚠️ Limpa o ponteiro do mapa pelo mesmo motivo do cancel — um dedo que sai pela
   * borda nao gera `pointerup` no canvas, e ficaria fantasma para sempre. Limpa
   * TODOS quando o evento nao traz `pointerId` utilizavel (o caso do mouse saindo
   * da area, onde a lista ativa nao pode sobreviver de qualquer forma).
   */
  private readonly onPointerLeave = (e?: PointerEvent): void => {
    if (e !== undefined && typeof e.pointerId === 'number') this.esquecerPonteiro(e.pointerId);
    else {
      this.pointers.clear();
      this.pinchInicio = null;
    }
    this.resizingBoundary = null;
    if (this.canvas.style.cursor !== '') this.canvas.style.cursor = '';
    this.crosshair = null;
    this.emitCrosshair();
    this.scheduleRender();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.scaleEnabled()) return;
    e.preventDefault();
    // Zoom do usuario tambem cancela a transicao: dois donos do mesmo eixo no mesmo
    // quadro produziriam um zoom que "escorrega".
    this.cancelarAnimacao();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    // Roda para cima (deltaY < 0) aproxima. Fator suave para o zoom nao "pular".
    const fator = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtCoordinate(this.ts, x, fator);
    this.scheduleRender();
  };

  /**
   * A barra da serie de preco principal (pane 0) sob a coluna `x` do cursor.
   *
   * ⭐ E o insumo da legenda O/H/L/C: acha a barra pelo INDICE
   * (`timeToIndex(findNearest)`), nao pelo tempo exato — o cursor cai entre barras
   * o tempo todo, e a leitura de fita e "qual barra esta debaixo do cursor". Para
   * Candlestick/Bar devolve {open,high,low,close}; para Line/Area {value}.
   *
   * Tolerante: sem serie de preco, sem dado ou indice fora da faixa devolve
   * `undefined` — o campo entao nem aparece no evento, como manda o contrato.
   * Usa a serie de preco MAIS LONGA da pane 0, a mesma fonte que `rebuildTimes`
   * elege como verdade temporal.
   */
  private barSobCursor(x: number): CrosshairSeriesData | undefined {
    const idx = timeToIndex(this.ts, coordinateToTime(this.ts, x) ?? NaN, true);
    if (idx === null) return undefined;
    const i = Math.round(idx);
    if (i < 0) return undefined;

    let fonte: SeriesModel | null = null;
    for (const s of this.panes[0]!.series) {
      // Serie oculta nao alimenta a legenda: ler O/H/L/C de algo que nao esta
      // desenhado faria a fita mostrar numero sem contraparte visual.
      if (!RobustusChartCore.visivel(s)) continue;
      const t = s.model.type;
      if (t === 'Candlestick' || t === 'Bar' || t === 'Line' || t === 'Area') {
        if (fonte === null || s.model.data.length > fonte.data.length) fonte = s.model;
      }
    }
    if (fonte === null) return undefined;

    const bar = fonte.data[i];
    if (bar === undefined) return undefined;

    const c = bar as { open?: number; high?: number; low?: number; close?: number; value?: number };
    if (c.high !== undefined && c.low !== undefined) {
      // OHLC (Candlestick/Bar).
      return { open: c.open, high: c.high, low: c.low, close: c.close };
    }
    if (c.value !== undefined) {
      // Ponto de valor (Line/Area).
      return { value: c.value };
    }
    return undefined;
  }

  private emitCrosshair(): void {
    if (this.crosshairListeners.size === 0) return;
    const p = this.crosshair;
    const param: MouseEventParams =
      p === null
        ? {}
        : {
            point: { x: p.x, y: p.y },
            time: coordinateToTime(this.ts, p.x) ?? undefined,
            logical: coordinateToLogical(this.ts, p.x) ?? undefined,
            seriesData: this.barSobCursor(p.x),
          };
    for (const l of this.crosshairListeners) {
      try {
        l(param);
      } catch {
        /* ouvinte que lanca nao derruba o quadro */
      }
    }
  }

  private emitClick(): void {
    if (this.clickListeners.size === 0 || this.crosshair === null) return;
    const p = this.crosshair;
    const param: MouseEventParams = {
      point: { x: p.x, y: p.y },
      time: coordinateToTime(this.ts, p.x) ?? undefined,
      logical: coordinateToLogical(this.ts, p.x) ?? undefined,
    };
    for (const l of this.clickListeners) {
      try {
        l(param);
      } catch {
        /* idem */
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  private scheduleRender(): void {
    if (this.disposed || this.frame !== null) return;
    const agendar =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: (t: number) => void): number => setTimeout(() => cb(agoraMs()), 16) as unknown as number;
    this.frame = agendar((t: number) => {
      this.frame = null;
      // ⚠️ O timestamp do `requestAnimationFrame` e a base de tempo da animacao, e
      // nao um `performance.now()` lido aqui dentro: o do rAF e o instante em que o
      // navegador VAI pintar, e usá-lo mantém a rampa coerente com o que aparece na
      // tela mesmo quando o quadro atrasa. Ambiente sem rAF cai no relogio.
      this.render(typeof t === 'number' ? t : agoraMs());
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ⭐ Transicao animada do eixo de tempo
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Aplica uma mudanca PROGRAMATICA de janela, animando quando configurado.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * COMO ISTO EVITA DUPLICAR A CONTA DO DESTINO
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * O destino nao e calculado aqui. A mutacao real (`fitContent`, `setVisibleLogicalRange`,
   * `scrollToRealTime`) e EXECUTADA, o resultado dela e lido como destino, e o eixo e
   * devolvido ao estado de origem para a rampa comecar. Assim a animacao nunca
   * divergir da conta do eixo — reimplementar "onde o fitContent teria parado" seria
   * uma segunda fonte de verdade, e a primeira mudanca em `fitContent` deixaria a
   * animacao pousando no lugar errado.
   *
   * ⚠️ Se a animacao esta desligada (o default), este metodo e a mutacao crua mais o
   * `scheduleRender` — exatamente o comportamento anterior, sem nenhum custo.
   */
  private transicaoDeEixo(mutar: () => void): void {
    if (this.disposed) return;

    // ⭐ Reconstroi o eixo ANTES de mover a janela, e isto corrige um defeito silencioso.
    //
    // ⚠️ `ts.times` so era preenchido dentro do `render`, que e agendado por
    // `requestAnimationFrame`. Consequencia medida: um consumidor que faz
    // `setData(...)` e em seguida `fitContent()` — o par mais natural do mundo, e o que a
    // documentacao mostra — chamava `fitContent` com o eixo AINDA VAZIO. `fitContent`
    // saia sem fazer nada (`n === 0`), e o quadro seguinte aplicava a heuristica de
    // primeira carga (`scrollToRealTime`), mostrando as ultimas ~93 barras. O
    // enquadramento pedido simplesmente nao acontecia, sem erro nenhum.
    //
    // Reconstruir aqui tem um segundo efeito, tambem desejado: o `render` seguinte vê
    // `antesCount > 0` e NAO aplica a heuristica de primeira carga — a intencao
    // EXPLICITA do consumidor vence o palpite do motor.
    this.rebuildTimes();

    const deLeft = this.ts.leftLogical;
    const deBar = this.ts.barSpacing;

    mutar();

    if (!this.animacaoLigada()) {
      this.anim = null;
      this.scheduleRender();
      return;
    }

    const paraLeft = this.ts.leftLogical;
    const paraBar = this.ts.barSpacing;

    if (!animationWorthwhile(deLeft, paraLeft, deBar, paraBar)) {
      // Destino indistinguivel da origem: fica no destino e nao agenda rampa nenhuma.
      this.anim = null;
      this.scheduleRender();
      return;
    }

    // Volta ao ponto de partida — a rampa e que leva ao destino.
    this.ts.leftLogical = deLeft;
    this.ts.barSpacing = deBar;

    this.anim = {
      deLeftLogical: deLeft,
      paraLeftLogical: paraLeft,
      deBarSpacing: deBar,
      paraBarSpacing: paraBar,
      inicio: agoraMs(),
      duracaoMs: this.duracaoAnimacao(),
    };
    this.scheduleRender();
  }

  /**
   * A animacao esta ligada AGORA?
   *
   * ⚠️ `prefers-reduced-motion: reduce` vence a configuracao. Consultado em cada
   * transicao, nao guardado na construcao: o usuario pode mudar a preferencia do
   * sistema com a pagina aberta, e um valor lido uma vez ignoraria isso pelo resto da
   * sessao.
   *
   * ⚠️ `matchMedia` pode nao existir (Node, SSR, jsdom sem o polyfill). Ausente conta
   * como "sem preferencia declarada" — nao como "reduza": tratar ausencia de API como
   * pedido de reducao desligaria a animacao em todo navegador antigo.
   */
  private animacaoLigada(): boolean {
    if (this.opts.animation?.enabled !== true) return false;
    if (this.duracaoAnimacao() <= 0) return false;
    try {
      if (typeof matchMedia === 'function') {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      }
    } catch {
      // Ambiente com `matchMedia` quebrado nao pode derrubar uma mudanca de janela.
    }
    return true;
  }

  private duracaoAnimacao(): number {
    const d = this.opts.animation?.durationMs;
    return typeof d === 'number' && Number.isFinite(d) ? d : ANIMATION_DEFAULT_MS;
  }

  /**
   * Interrompe a transicao em curso, DEIXANDO o eixo onde está.
   *
   * ⚠️ Nao pula para o destino. Chamado quando o usuario toca no grafico (pan, zoom,
   * pinca): saltar para o destino no instante em que ele agarrou o eixo arrancaria a
   * tela debaixo da mao dele. A intencao mais recente e a do usuario, e ela vence.
   */
  private cancelarAnimacao(): void {
    this.anim = null;
  }

  private render(agora: number = agoraMs()): void {
    if (this.disposed) return;

    // ⭐ Avanca a transicao ANTES de qualquer conta que dependa da janela (tempos,
    // autoescala, desenho). Escrever o eixo aqui e o que faz a autoescala do PRECO
    // acompanhar a rampa de graca — ela le a janela visivel a cada quadro.
    if (this.anim !== null) {
      const estado = animationState(this.anim, agora);
      this.ts.leftLogical = estado.leftLogical;
      this.ts.barSpacing = estado.barSpacing;
      if (animationProgress(this.anim, agora) >= 1) {
        // Pousa no destino EXATO. Sem isto o eixo pararia no ultimo valor
        // interpolado, que e proximo do destino mas nao igual — e um `fitContent`
        // deixaria uma fracao de barra fora da tela.
        this.ts.leftLogical = this.anim.paraLeftLogical;
        this.ts.barSpacing = this.anim.paraBarSpacing;
        this.anim = null;
      }
    }

    // Antes de mudar times, guarda se estava seguindo o tempo real.
    const seguia = isFollowingRealTime(this.ts);

    // Recolhe os tempos de TODAS as series de preco (pane 0) para o eixo. As series
    // de sub-painel compartilham o mesmo eixo de tempo, entao os tempos vem da pane
    // principal, que e a fonte da verdade temporal.
    const antesCount = this.ts.times.length;
    const antesPrimeiro = this.ts.times[0];
    this.rebuildTimes();

    if (this.ts.times.length !== antesCount) {
      // ⭐ Separa o que entrou NA FRENTE do que entrou NO FIM. As duas coisas exigem
      // reações opostas, e o motor só vê o array ter crescido.
      //
      // ⚠️ Sem esta distinção, um backfill de histórico (500 barras inseridas antes)
      // era lido como "500 barras novas ao vivo": com a visão colada no tempo real, o
      // eixo rolava 500 barras para a frente e o operador perdia o trecho que estava
      // investigando; sem estar colado, a tela saltava 500 barras para o PASSADO,
      // porque `leftLogical` é índice e todos os índices tinham mudado.
      //
      // A detecção é por CONTEÚDO — quantos tempos novos são anteriores ao que era o
      // primeiro. É a mesma disciplina do `onBarsAppended` na primeira carga: contar
      // não basta, é preciso saber ONDE cresceu.
      const inseridasAntes =
        antesPrimeiro === undefined ? 0 : this.contarAntesDe(this.ts.times, antesPrimeiro);

      if (inseridasAntes > 0) onBarsPrepended(this.ts, inseridasAntes);

      // O `antesCount` corrigido faz o delta do append valer só o que entrou no FIM.
      // Um pacote que traga histórico E barra nova ao mesmo tempo é tratado certo nas
      // duas pontas.
      onBarsAppended(this.ts, antesCount + inseridasAntes, seguia);
    }

    // Autoescala cada pane pela janela horizontal visivel. Pane colapsada tem
    // altura zero: autoescalar contra ela produziria uma faixa degenerada, e ao
    // reexibir a escala voltaria errada por um quadro.
    for (const pane of this.panes) {
      if (!pane.collapsed) this.autoScalePane(pane);
    }

    // Notifica assinantes de faixa (o ChartEngine emite o mapeador de coordenada).
    const lr = visibleLogicalRange(this.ts);
    for (const l of this.rangeListeners) {
      try {
        l(lr);
      } catch {
        /* idem */
      }
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const pane of this.panes) {
      if (pane.collapsed) continue;
      const topo = this.paneTop(pane.index);
      const local = this.crosshairInPane(pane, topo);
      ctx.save();
      try {
        // Recorta e translada para a faixa da pane, em pixel de bitmap.
        ctx.beginPath();
        ctx.rect(0, topo * this.dpr, this.ts.width * this.dpr, pane.priceScale.height * this.dpr);
        ctx.clip();
        ctx.translate(0, topo * this.dpr);

        renderPane(
          ctx,
          this.dpr,
          this.dpr,
          this.ts,
          pane.priceScale,
          // ⭐ Cada serie vai com a SUA escala. A grade e o eixo usam a principal
          // (passada acima); o volume desenha contra a escala de overlay dele.
          //
          // Serie com `visible: false` e filtrada AQUI, na entrada do renderer, em
          // vez de checada dentro de cada `draw*`: o renderer nao precisa conhecer
          // o conceito de visibilidade, e um caminho novo de desenho nao pode
          // esquecer de honrar a opcao.
          pane.series
            .filter((s) => RobustusChartCore.visivel(s))
            .map((s) => ({ model: s.model, scale: this.scaleOf(pane, s) })),
          this.theme,
          // Crosshair so na pane sob o cursor.
          local,
          true,
          // Rotulo de preco do crosshair: so na pane efetivamente sob o cursor.
          this.priceLabelForCrosshair(pane, local),
          this.priceFormatOpts(),
          // ⭐ Marca d'agua SO na pane principal. Repeti-la em cada sub-painel
          // encheria a tela de texto fantasma e brigaria com o oscilador, que ocupa
          // pouca altura.
          pane.index === 0 ? this.watermarkOpts() : undefined,
        );

        this.drawPriceLines(ctx, pane);
        this.drawPrimitives(ctx, pane);
        this.drawMarkers(ctx, pane);
      } finally {
        ctx.restore();
      }
    }

    this.renderTimeAxisStrip(ctx);

    // ⚠️ A transicao precisa PEDIR o proximo quadro. O motor so desenha quando algo o
    // marca como sujo, e uma animacao nao tem quem a marque — sem este agendamento
    // ela pintaria um quadro e congelaria no meio do caminho.
    if (this.anim !== null) this.scheduleRender();
  }

  /**
   * Desenha o eixo de tempo na tira reservada abaixo de todas as panes.
   *
   * O eixo de tempo e um so, compartilhado — por isso desenha UMA vez, fora do
   * laco de panes. A tira ocupa `[totalHeight - timeAxisHeight, totalHeight]`.
   */
  private renderTimeAxisStrip(ctx: CanvasRenderingContext2D): void {
    if (!this.opts.timeScale.timeVisible) return;
    const topo = this.totalHeight - this.timeAxisHeight;
    if (topo <= 0 || this.ts.width <= 0) return;

    const cfg: TimeAxisConfig = {
      height: this.timeAxisHeight,
      timeZone: this.timeZone,
      secondsVisible: this.opts.timeScale.secondsVisible,
    };
    // Rotulo de data/hora do crosshair: coluna do cursor + tempo formatado.
    const crossX = this.crosshair !== null ? this.crosshair.x : null;
    const timeLabel = crossX !== null ? this.formatTimeLabel(crossX) : null;

    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(0, topo * this.dpr, this.ts.width * this.dpr, this.timeAxisHeight * this.dpr);
      ctx.clip();
      ctx.translate(0, topo * this.dpr);
      renderTimeAxis(
        ctx,
        this.dpr,
        this.dpr,
        this.ts,
        this.ts.width,
        this.timeAxisHeight,
        cfg,
        this.theme,
        crossX,
        timeLabel,
      );
    } finally {
      ctx.restore();
    }
  }

  /** Preco formatado sob o cursor, para a caixa de crosshair; `null` se fora. */
  private priceLabelForCrosshair(pane: Pane, local: CrosshairState | null): string | null {
    if (local === null || local.y < 0 || local.y > pane.priceScale.height) return null;
    const preco = coordinateToPrice(pane.priceScale, local.y);
    if (preco === null || !Number.isFinite(preco)) return null;
    // Com `priceFormat` configurado, a caixa usa o mesmo formato do eixo (tick/
    // casas do instrumento) — para o rotulo do cursor bater com o rotulo fixo.
    // Sem ele, a heuristica de amplitude, como antes.
    const fmt = this.priceFormatOpts();
    if (fmt !== undefined) return formatPrice(preco, fmt);
    const span = pane.priceScale.topPrice - pane.priceScale.bottomPrice;
    return preco.toFixed(decimalsForSpan(span));
  }

  /**
   * Opcoes de formatacao de preco vindas de `rightPriceScale.priceFormat`, ou
   * `undefined` quando nao configuradas (o motor entao usa a heuristica de
   * amplitude). Ponto UNICO de leitura, para o eixo e o crosshair nao divergirem.
   */
  private priceFormatOpts(): PriceFormatOptions | undefined {
    const pf = this.opts.rightPriceScale.priceFormat;
    if (pf === undefined) return undefined;
    if (pf.precision === undefined && pf.tickSize === undefined) return undefined;
    return { precision: pf.precision, tickSize: pf.tickSize };
  }

  /**
   * A marca d'agua a desenhar, ou `undefined` quando nao ha nada a desenhar.
   *
   * Filtra aqui — e nao no renderer — o caso "configurada mas vazia/desligada",
   * para o renderer receber so o que de fato vai a tela.
   */
  private watermarkOpts(): WatermarkOptions | undefined {
    const wm = this.opts.watermark;
    if (wm === undefined) return undefined;
    if (wm.visible === false) return undefined;
    if (typeof wm.text !== 'string' || wm.text.length === 0) return undefined;
    return wm;
  }

  /** Data/hora formatada sob o cursor, para a caixa do eixo de tempo. */
  private formatTimeLabel(x: number): string | null {
    const t = coordinateToTime(this.ts, x);
    if (t === null) return null;
    const p = timePartsInZone(t, this.timeZone);
    if (p === null) return null;
    return formatDataHoraCompleta(p, this.opts.timeScale.secondsVisible);
  }

  /** Reconstroi o eixo de tempo a partir da serie de preco mais longa da pane 0. */
  private rebuildTimes(): void {
    let fonte: SeriesModel | null = null;
    for (const s of this.panes[0]!.series) {
      if (
        s.model.type === 'Candlestick' ||
        s.model.type === 'Bar' ||
        s.model.type === 'Line' ||
        s.model.type === 'Area'
      ) {
        // Banda de proposito FORA daqui: ela acompanha o preco, nunca e a fonte
        // temporal — as velas (ou a linha/area) sao. Deixar a banda ditar o eixo
        // faria a banda de um indicador definir os tempos do grafico inteiro.
        if (fonte === null || s.model.data.length > fonte.data.length) fonte = s.model;
      }
    }
    if (fonte === null) {
      // Sem serie de preco: tenta qualquer serie (ex.: so histograma de volume).
      for (const s of this.panes[0]!.series) {
        if (fonte === null || s.model.data.length > fonte.data.length) fonte = s.model;
      }
    }
    // ⚠️ Este metodo IGNORA `visible` de proposito — nao "esqueceu" de filtrar.
    // O eixo de tempo e a verdade temporal do grafico inteiro; derivá-lo so das
    // series visiveis faria esconder a serie de preco colapsar o eixo e levar
    // TODAS as outras series com ele. Esconder uma serie esconde a serie, nao o
    // tempo.
    this.ts.times = fonte === null ? [] : fonte.data.map((d) => d.time);
  }

  /**
   * ⭐ A serie desenhada sob um ponto — a resposta a "em que o operador clicou?".
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * A LACUNA QUE ISTO FECHA
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * O motor sabia desenhar a EMA e nao sabia dizer que um pixel era dela. Logo clicar
   * num indicador no grafico nao tinha resposta: a interface so conseguia abrir
   * propriedades pela LISTA lateral, nunca pelo traco na tela — que e o gesto natural.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * COMO O EMPATE E RESOLVIDO — E POR QUE PRIORIDADE ANTES DE DISTANCIA
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * Um clique dentro de uma vela esta, ao mesmo tempo, "dentro" da serie de velas
   * (distancia 0, porque o corpo e uma REGIAO) e possivelmente sobre a linha de uma
   * media que cruza aquela vela (distancia 0 tambem). Comparar so distancia daria
   * empate e a resposta dependeria da ordem de insercao das series — instavel e
   * inexplicavel para quem usa.
   *
   * ⭐ Entao a comparacao e por PRIORIDADE primeiro: traco (linha/area/borda de banda)
   * vence REGIAO (vela, barra, histograma, preenchimento de banda). E a mesma escada do
   * `hitTestPriority` das primitives (`ponto > linha > regiao`) e a mesma intuicao do
   * operador: quem clica sobre uma linha quer a linha, nao o fundo em que ela esta.
   * Empate de prioridade cai para a menor distancia; empate dos dois, primeira
   * encontrada.
   */
  seriesAt(
    point: { readonly x: number; readonly y: number },
    tolerancePx = 6,
  ): ISeriesApi<SeriesType> | null {
    if (this.disposed) return null;
    const pane = this.paneAtY(point.y);
    if (pane === null) return null;

    // Y local da pane: as escalas de preco convertem no espaco DELA, nao do canvas.
    const yLocal = point.y - this.paneTop(pane.index);

    let melhor: SeriesImpl<SeriesType> | null = null;
    let melhorPrioridade = -1;
    let melhorDistancia = Number.POSITIVE_INFINITY;

    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      const acerto = this.acertoNaSerie(pane, s, point.x, yLocal, tolerancePx);
      if (acerto === null) continue;
      if (
        acerto.prioridade > melhorPrioridade ||
        (acerto.prioridade === melhorPrioridade && acerto.distancia < melhorDistancia)
      ) {
        melhor = s;
        melhorPrioridade = acerto.prioridade;
        melhorDistancia = acerto.distancia;
      }
    }

    return melhor as unknown as ISeriesApi<SeriesType> | null;
  }

  /**
   * O ponto acerta esta serie? Devolve distancia em px e prioridade, ou `null`.
   *
   * Prioridade `1` = TRACO (linha, area, bordas de banda); `0` = REGIAO (corpo de vela,
   * barra de histograma, preenchimento). Ver `seriesAt` para o porque.
   */
  private acertoNaSerie(
    pane: Pane,
    s: SeriesImpl<SeriesType>,
    x: number,
    yLocal: number,
    tol: number,
  ): { distancia: number; prioridade: number } | null {
    const escala = this.scaleOf(pane, s);
    const dados = s.model.data;
    if (dados.length === 0) return null;

    // Indice do array DA SERIE mais proximo da coluna clicada, resolvido por TEMPO —
    // a serie pode estar desalinhada do eixo (indicador que descartou o aquecimento).
    const t = coordinateToTime(this.ts, x);
    if (t === null) return null;
    const i = this.indiceMaisProximoPorTempo(dados, t);
    if (i === null) return null;

    const tipo = s.model.type;

    if (tipo === 'Candlestick' || tipo === 'Bar') {
      const c = dados[i] as unknown as { high?: number; low?: number };
      if (c.high === undefined || c.low === undefined) return null;
      const yTopo = priceToCoordinate(escala, c.high);
      const yBase = priceToCoordinate(escala, c.low);
      if (yTopo === null || yBase === null) return null;
      // Dentro da extensao da barra (com folga da tolerancia) = REGIAO acertada.
      if (yLocal >= yTopo - tol && yLocal <= yBase + tol) {
        return { distancia: 0, prioridade: 0 };
      }
      return null;
    }

    if (tipo === 'Band') {
      const b = dados[i] as unknown as { upper?: number; lower?: number };
      if (b.upper === undefined || b.lower === undefined) return null;
      const yU = priceToCoordinate(escala, b.upper);
      const yL = priceToCoordinate(escala, b.lower);
      if (yU === null || yL === null) return null;
      const topo = Math.min(yU, yL);
      const base = Math.max(yU, yL);
      // ⚠️ As BORDAS da banda contam como traco; o meio, como regiao. Clicar na borda
      // superior de uma Bollinger e clicar na linha, e o operador espera a linha.
      const distBorda = Math.min(Math.abs(yLocal - yU), Math.abs(yLocal - yL));
      if (distBorda <= tol) return { distancia: distBorda, prioridade: 1 };
      if (yLocal >= topo && yLocal <= base) return { distancia: 0, prioridade: 0 };
      return null;
    }

    if (tipo === 'Histogram') {
      const h = dados[i] as unknown as { value?: number };
      if (h.value === undefined || !Number.isFinite(h.value)) return null;
      const yValor = priceToCoordinate(escala, h.value);
      const yZero = priceToCoordinate(escala, 0);
      if (yValor === null) return null;
      // ⚠️ A barra de histograma vai do VALOR ate a base (zero). Medir so a distancia ao
      // topo da barra faria o clique no meio dela nao acertar nada — e e no meio que o
      // operador clica.
      const base = yZero === null ? pane.priceScale.height : yZero;
      const topo = Math.min(yValor, base);
      const fundo = Math.max(yValor, base);
      if (yLocal >= topo - tol && yLocal <= fundo + tol) {
        return { distancia: 0, prioridade: 0 };
      }
      return null;
    }

    // Line / Area: distancia ao SEGMENTO, nao ao ponto.
    //
    // ⚠️ Medir a distancia ao ponto mais proximo erra em linha inclinada: entre duas
    // barras a linha passa pelo meio, e o cursor exatamente SOBRE o traco pode estar a
    // dezenas de pixels do vertice mais proximo. Com segmento, "sobre a linha" e sobre
    // a linha.
    let dist = Number.POSITIVE_INFINITY;
    for (const j of [i - 1, i]) {
      const a = dados[j];
      const b = dados[j + 1];
      if (a === undefined || b === undefined) continue;
      const xa = timeToCoordinate(this.ts, a.time);
      const xb = timeToCoordinate(this.ts, b.time);
      const va = (a as unknown as { value?: number }).value;
      const vb = (b as unknown as { value?: number }).value;
      if (xa === null || xb === null || va === undefined || vb === undefined) continue;
      const ya = priceToCoordinate(escala, va);
      const yb = priceToCoordinate(escala, vb);
      if (ya === null || yb === null) continue;
      const d = distanciaAoSegmento(x, yLocal, xa, ya, xb, yb);
      if (d < dist) dist = d;
    }

    // Serie de um ponto so (ou pontas): cai na distancia ao proprio ponto.
    if (!Number.isFinite(dist)) {
      const p = dados[i];
      const v = (p as unknown as { value?: number } | undefined)?.value;
      if (p === undefined || v === undefined) return null;
      const xp = timeToCoordinate(this.ts, p.time);
      const yp = priceToCoordinate(escala, v);
      if (xp === null || yp === null) return null;
      dist = Math.hypot(x - xp, yLocal - yp);
    }

    return dist <= tol ? { distancia: dist, prioridade: 1 } : null;
  }

  /**
   * Indice do array cujo `time` e o mais proximo de `t`. Busca binaria.
   *
   * ⚠️ Resolve por TEMPO e nao por indice logico pelo mesmo motivo de
   * `faixaVisivelDaSerie`: numa serie desalinhada (indicador que descartou o
   * aquecimento) o indice logico aponta outra barra, e o acerto sairia deslocado.
   */
  private indiceMaisProximoPorTempo(
    dados: readonly { readonly time: number }[],
    t: number,
  ): number | null {
    const n = dados.length;
    if (n === 0) return null;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const d = dados[mid];
      if (d !== undefined && d.time < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    if (lo >= n) return n - 1;
    const antes = dados[lo - 1];
    const depois = dados[lo];
    if (antes === undefined) return lo;
    if (depois === undefined) return lo - 1;
    return t - antes.time <= depois.time - t ? lo - 1 : lo;
  }

  /**
   * Quantos tempos, no começo do array, são ANTERIORES a `limite`.
   *
   * Busca binária: a série de barras de um pregão inteiro tem dezenas de milhares de
   * elementos, e isto roda em TODO quadro em que o eixo cresce. Varredura linear seria
   * O(n) por quadro para responder uma pergunta que é O(log n).
   *
   * ⚠️ Compara `< limite`, estrito: o próprio `limite` (a barra que era a primeira)
   * não conta como inserida — ela já estava lá.
   */
  private contarAntesDe(times: readonly number[], limite: number): number {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = times[mid];
      if (t !== undefined && t < limite) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Autoescala uma pane pelo min/max das barras visiveis das suas series. */
  private autoScalePane(pane: Pane): void {
    // Escala manual: o usuario arrastou o eixo. A autoescala arrancaria a faixa
    // que ele acabou de definir, entao pula ate o duplo-clique religar.
    const lr = visibleLogicalRange(this.ts);
    if (lr === null) return;

    // ⭐ Autoescala POR ESCALA, nunca por pane inteira.
    //
    // Agrupa as series pela escala a que pertencem e calcula min/max SO dentro do
    // grupo. Sem esse agrupamento, o volume (dezenas de milhares) e o preco
    // (~130.000) caem no mesmo min/max, a faixa vira `0..130.000` e as velas ficam
    // esmagadas em poucos pixels no topo — o defeito que deixava o grafico visualmente
    // vazio.
    const grupos = new Map<PriceScaleState, SeriesImpl<SeriesType>[]>();
    for (const s of pane.series) {
      // ⭐ Serie oculta NAO entra na autoescala. E a metade que importa da opcao
      // `visible`: uma EMA escondida que seguisse esticando a faixa comprimiria o
      // preco por causa de algo que nao esta na tela, e o operador nao teria pista
      // da causa. Se TODAS as series de uma escala estiverem ocultas, o grupo fica
      // vazio e `autoScaleGroup` sai sem tocar na faixa — a escala congela no
      // ultimo valor bom em vez de degenerar.
      if (!RobustusChartCore.visivel(s)) continue;
      const escala = this.scaleOf(pane, s);
      const g = grupos.get(escala);
      if (g === undefined) grupos.set(escala, [s]);
      else g.push(s);
    }

    for (const [escala, series] of grupos) {
      // Escala manual vale por ESCALA: o arrasto congela a principal, e a autoescala
      // do volume segue viva.
      if (escala === pane.priceScale && pane.priceScaleManual) continue;
      this.autoScaleGroup(escala, series, lr);
    }
  }

  /**
   * Autoescala UMA escala pelas series que pertencem a ela, na janela visivel.
   *
   * ⭐ Grupo puramente de histograma ANCORA EM ZERO. Um histograma de volume
   * autoescalado por `min..max` desenharia a menor barra com altura zero e a
   * maior ocupando a faixa toda — a leitura de volume relativo se perde, e a base
   * do desenho (`priceToCoordinate(0)`) cairia fora da escala. Ancorar em zero e o
   * que todo grafico de volume faz.
   */
  private autoScaleGroup(
    escala: PriceScaleState,
    series: readonly SeriesImpl<SeriesType>[],
    lr: { from: number; to: number },
  ): void {
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      const d = s.model.data;
      // ⚠️ A faixa de indices e resolvida POR SERIE, pelo TEMPO das bordas da
      // janela — nao pelo indice logico direto.
      //
      // Usar `lr.from..lr.to` como indice do array assume que `d[i]` e a barra
      // logica `i`, o que so vale para a serie que origina o eixo. Numa serie
      // desalinhada (indicador que descarta o aquecimento) a autoescala lia os
      // valores das barras ERRADAS — a faixa saia calculada sobre outro trecho do
      // indicador. Mesmo mecanismo do defeito de desenho, mesma correcao.
      const { de, ate } = this.faixaVisivelDaSerie(d, lr);
      for (let i = de; i <= ate; i++) {
        const b = d[i];
        if (b === undefined) continue;
        const banda = b as { upper?: number; lower?: number };
        if (banda.upper !== undefined && banda.lower !== undefined) {
          // Banda: a autoescala precisa englobar AMBAS as bordas, senao a faixa
          // sairia cortada pela borda da pane no zoom-out.
          if (Number.isFinite(banda.lower) && banda.lower < min) min = banda.lower;
          if (Number.isFinite(banda.upper) && banda.upper > max) max = banda.upper;
        } else if ((b as { high?: number }).high !== undefined) {
          const c = b as { high: number; low: number };
          if (c.low < min) min = c.low;
          if (c.high > max) max = c.high;
        } else {
          const v = (b as { value?: number }).value;
          if (v !== undefined && Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    // Grupo só de histograma: ancora em zero (ver o cabeçalho).
    const soHistograma = series.every((s) => s.model.type === 'Histogram');
    if (soHistograma) {
      autoScale(escala, 0, max);
      // `autoScale` poe folga simetrica de 5%, o que deixaria a base em -0,05·max e
      // uma faixa de volume negativo visivel. Volume nao e negativo: cola a base no
      // zero e mantem so a folga do topo.
      escala.bottomPrice = 0;
      return;
    }

    autoScale(escala, min, max);
  }

  /**
   * A faixa de indices do array de UMA serie que cai na janela logica visivel.
   *
   * ⭐ Resolve por TEMPO, nao por indice: converte as bordas da janela em instante
   * (`indexToTime`) e acha o trecho correspondente no array da serie. Para a serie
   * alinhada ao eixo o resultado e o mesmo que indexar direto; para uma serie
   * desalinhada (indicador que descartou o aquecimento) e a diferenca entre ler os
   * valores certos e ler os de outro trecho.
   *
   * Serie vazia devolve uma faixa vazia (`de > ate`), que o laco do chamador
   * simplesmente nao percorre.
   */
  private faixaVisivelDaSerie(
    data: readonly { readonly time: number }[],
    lr: { from: number; to: number },
  ): { de: number; ate: number } {
    const n = data.length;
    if (n === 0) return { de: 0, ate: -1 };

    const tDe = indexToTime(this.ts, lr.from);
    const tAte = indexToTime(this.ts, lr.to);
    if (tDe === null || tAte === null) return { de: 0, ate: n - 1 };

    // Busca binaria pelo primeiro indice com `time >= t`.
    const primeiroDesde = (t: number): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const d = data[mid];
        if (d !== undefined && d.time < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    return {
      de: Math.max(0, primeiroDesde(tDe)),
      ate: Math.min(n - 1, primeiroDesde(tAte)),
    };
  }

  private crosshairInPane(pane: Pane, topo: number): CrosshairState | null {
    const c = this.crosshair;
    if (c === null) return null;
    const dentro = c.y >= topo && c.y <= topo + pane.priceScale.height;
    return dentro ? { x: c.x, y: c.y - topo } : { x: c.x, y: -1 };
  }

  private drawPriceLines(ctx: CanvasRenderingContext2D, pane: Pane): void {
    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      // A linha de preco pertence a serie, logo vive na escala DELA: uma linha
      // criada numa serie de volume tem de ser lida na escala do volume.
      const escala = this.scaleOf(pane, s);
      for (const pl of s.model.priceLines.values()) {
        const y = priceToCoordinate(escala, pl.price);
        if (y === null) continue;
        ctx.strokeStyle = pl.color;
        ctx.lineWidth = Math.max(1, (pl.lineWidth ?? 1) * this.dpr);
        ctx.setLineDash(pl.lineStyle === 2 ? [6 * this.dpr, 4 * this.dpr] : []);
        ctx.beginPath();
        ctx.moveTo(0, y * this.dpr);
        ctx.lineTo(this.ts.width * this.dpr, y * this.dpr);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawPrimitives(ctx: CanvasRenderingContext2D, pane: Pane): void {
    const target = createCanvasTarget(ctx, this.ts.width, pane.priceScale.height, this.dpr, this.dpr);
    // Ordem por z: bottom (bookmap), normal, top (footprint, desenho).
    const ordem: Array<'bottom' | 'normal' | 'top'> = ['bottom', 'normal', 'top'];
    for (const s of pane.series) {
      // Esconder a serie esconde o que esta ancorado nela. O bookmap e anexado a
      // uma serie; se ele continuasse desenhando com a serie oculta, o operador
      // desligaria a serie e o heatmap ficaria flutuando sem a referencia dele.
      if (!RobustusChartCore.visivel(s)) continue;
      for (const prim of s.model.primitives) {
        try {
          prim.updateAllViews?.();
          const views = prim.paneViews?.() ?? [];
          for (const z of ordem) {
            for (const view of views) {
              if (view.zOrder() !== z) continue;
              const r = view.renderer();
              r?.draw(target);
            }
          }
        } catch {
          /* primitive que lanca nao derruba o grafico */
        }
      }
    }
  }

  /**
   * Desenha os marcadores de cada serie HONRANDO `shape` e `text`.
   *
   * ⚠️ O defeito que este metodo corrige: antes desenhava SEMPRE um `ctx.arc`
   * (circulo), ignorando `m.shape` e `m.text` — o contrato (`SeriesMarker`) promete
   * `'circle' | 'square' | 'arrowUp' | 'arrowDown'` e um `text` opcional, e nada
   * disso chegava a tela. Compra/venda (seta pra cima/baixo) sao a leitura mais
   * comum de marcador de mercado, e todas apareciam como bolinha indistinta.
   *
   * As formas sao geometria simples de canvas (nao dependem de fonte de icone).
   * O ancoramento por posicao (aboveBar/belowBar/inBar) e preservado. Tolerante:
   * marcador com tempo fora da serie e PULADO, como antes.
   */
  private drawMarkers(ctx: CanvasRenderingContext2D, pane: Pane): void {
    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      const escala = this.scaleOf(pane, s);
      for (const m of s.model.markers) {
        const x = timeToCoordinate(this.ts, m.time);
        if (x === null) continue;
        // Ancora o marcador ao preco da barra: acima/abaixo/dentro.
        //
        // ⚠️ A barra e achada por TEMPO no array DA SERIE, nao pelo indice logico
        // do eixo. `timeToIndex` devolve indice LOGICO; usa-lo para indexar
        // `s.model.data` acerta so quando a serie esta alinhada ao eixo — numa
        // serie desalinhada o marcador ancorava no preco de outra barra.
        const bar = this.barraPorTempo(s.model.data, m.time);
        let yBase = pane.priceScale.height / 2;
        if (bar !== undefined) {
          const c = bar as { high?: number; low?: number; value?: number };
          const preco =
            m.position === 'aboveBar' ? c.high ?? c.value : m.position === 'belowBar' ? c.low ?? c.value : c.value;
          const y = preco !== undefined ? priceToCoordinate(escala, preco) : null;
          if (y !== null) yBase = y + (m.position === 'aboveBar' ? -12 : m.position === 'belowBar' ? 12 : 0);
        }

        const cx = x * this.dpr;
        const cy = yBase * this.dpr;
        const r = (m.size ?? 4) * this.dpr;

        ctx.save();
        try {
          ctx.fillStyle = m.color;
          ctx.strokeStyle = m.color;
          this.desenharFormaMarcador(ctx, m.shape, cx, cy, r);

          if (m.text !== undefined && m.text.length > 0) {
            // Texto do marcador: abaixo quando ancorado acima da barra, acima
            // quando abaixo — sempre "afastando" o texto da vela para nao cobri-la.
            const acima = m.position === 'belowBar';
            const fontePx = Math.round(10 * this.dpr);
            ctx.font = `${fontePx}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = acima ? 'bottom' : 'top';
            const dy = acima ? -(r + 3 * this.dpr) : r + 3 * this.dpr;
            ctx.fillText(m.text, cx, cy + dy);
          }
        } finally {
          ctx.restore();
        }
      }
    }
  }

  /**
   * O ponto de uma serie cujo `time` e exatamente `t`, ou `undefined`.
   *
   * Busca binaria no array DA SERIE. Existe para nao confundir indice logico do
   * eixo com indice de array — ver a nota em `drawMarkers`.
   */
  private barraPorTempo(
    data: readonly { readonly time: number }[],
    t: number,
  ): { readonly time: number } | undefined {
    let lo = 0;
    let hi = data.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = data[mid];
      if (d === undefined) return undefined;
      if (d.time === t) return d;
      if (d.time < t) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /**
   * Rasteriza UMA forma de marcador no ponto (cx, cy) de bitmap, raio/meia-aresta
   * `r`. Formas simples em canvas — circulo, quadrado e as duas setas triangulares.
   *
   * ⭐ A seta e um triangulo cheio apontando na direcao do nome: `arrowUp` com o
   * vertice em cima (sinal de compra abaixo da barra), `arrowDown` com o vertice
   * embaixo (venda acima da barra). E a leitura classica de fita.
   */
  private desenharFormaMarcador(
    ctx: CanvasRenderingContext2D,
    shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown',
    cx: number,
    cy: number,
    r: number,
  ): void {
    ctx.beginPath();
    switch (shape) {
      case 'square':
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        return;
      case 'arrowUp':
        // Vertice no topo, base embaixo.
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx - r, cy + r);
        ctx.closePath();
        ctx.fill();
        return;
      case 'arrowDown':
        // Vertice embaixo, base em cima.
        ctx.moveTo(cx, cy + r);
        ctx.lineTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy - r);
        ctx.closePath();
        ctx.fill();
        return;
      case 'circle':
      default:
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
  }

  /** Referencia interna para as series apontarem de volta. */
  get times(): readonly number[] {
    return this.ts.times;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// createChart — a fabrica, compativel com o `createChart` de terceiro
// ═════════════════════════════════════════════════════════════════════════════

/** Cria o grafico. Substitui o `createChart` do lightweight-charts. */
export function createChart(container: HTMLElement, options?: Partial<ChartOptions>): IChartApi {
  return new RobustusChartCore(container, options);
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Casas decimais adequadas a amplitude do eixo — mesma escada do rotulo fixo do
 * eixo de preco (renderer.ts), para o rotulo do crosshair nao divergir dele.
 */
function decimalsForSpan(span: number): number {
  if (span >= 100) return 0;
  if (span >= 10) return 1;
  if (span >= 1) return 2;
  if (span >= 0.1) return 3;
  return 4;
}

function mergeOptions(base: ChartOptions, over?: Partial<ChartOptions>): ChartOptions {
  if (over === undefined) return base;
  return {
    layout: { ...base.layout, ...over.layout },
    grid: {
      vertLines: { ...base.grid.vertLines, ...over.grid?.vertLines },
      horzLines: { ...base.grid.horzLines, ...over.grid?.horzLines },
    },
    crosshair: { ...base.crosshair, ...over.crosshair },
    timeScale: { ...base.timeScale, ...over.timeScale },
    // timeScale spread acima ja carrega `timeZone` se veio no override.
    rightPriceScale: {
      scaleMargins: { ...base.rightPriceScale.scaleMargins, ...over.rightPriceScale?.scaleMargins },
      // priceFormat: o override vence; senao mantem o da base (pode ser undefined).
      priceFormat: over.rightPriceScale?.priceFormat ?? base.rightPriceScale.priceFormat,
    },
    handleScroll: over.handleScroll ?? base.handleScroll,
    handleScale: over.handleScale ?? base.handleScale,
    autoSize: over.autoSize ?? base.autoSize,
    // Marca d'agua: o override VENCE por inteiro, sem mesclar campo a campo.
    // Mesclar seria pior — `applyOptions({ watermark: { text: 'X' } })` herdaria a
    // `fontSize` e a `color` da configuracao antiga em vez de voltar ao default, e o
    // consumidor nao tem como "desconfigurar" um campo.
    watermark: over.watermark ?? base.watermark,
    // Animacao: mesma regra da marca d'agua — o override vence por inteiro. Mesclar
    // faria `applyOptions({ animation: { enabled: true } })` herdar uma `durationMs`
    // antiga que o consumidor nao pediu.
    animation: over.animation ?? base.animation,
  };
}

/**
 * Distancia de um ponto ao SEGMENTO `(x1,y1)-(x2,y2)`, em pixel.
 *
 * ⚠️ Ao segmento, nao a reta infinita: a reta daria distancia pequena para um ponto
 * muito antes do inicio ou depois do fim do traco, e o acerto vazaria para fora da
 * linha desenhada. O `t` recortado em `[0,1]` e o que prende a projecao ao trecho que
 * existe na tela.
 *
 * Segmento degenerado (dois pontos no mesmo pixel) cai na distancia ao ponto.
 */
function distanciaAoSegmento(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * O relogio da animacao, em milissegundos.
 *
 * ⚠️ `performance.now()` quando existe, e nao `Date.now()`: `Date.now` pode ANDAR PARA
 * TRAS (ajuste de NTP, mudanca de fuso do sistema), e um salto negativo no meio de uma
 * transicao a faria terminar de supetao ou congelar. `performance.now` e monotonico.
 * Ambiente sem ele cai no `Date.now`, que e melhor que nao animar.
 */
function agoraMs(): number {
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Contexto 2D inerte para ambiente sem canvas (jsdom).
 *
 * Toda operacao e no-op. O motor entao NAO rasteriza, mas as conversoes de
 * coordenada, o dado das series e os eventos continuam funcionando — que e o que
 * os testes exercitam. Ambiente sem canvas e requisito de teste, nao limitacao.
 */
function criarContextoInerte(): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  const alvo = new Proxy(
    { canvas: { width: 0, height: 0 } },
    {
      get: (t, prop) => {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        // Metodos retornam no-op; propriedades de estilo aceitam qualquer set.
        return typeof prop === 'string' && /^[a-z]/.test(prop) ? noop : undefined;
      },
      set: () => true,
    },
  );
  return alvo as unknown as CanvasRenderingContext2D;
}
