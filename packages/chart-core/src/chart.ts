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
// ⭐ O TETO por percentil da autoescala de histograma. Nucleo PURO: a decisao de escala e
// testavel sem canvas, e e onde a medicao do volume do WIN esta registrada.
import { pisoPorPercentil, tetoPorPercentil } from './histogram-scale.core.js';
import type {
  ChartOptions,
  CrosshairSeriesData,
  HandleScrollOptions,
  IChartApi,
  IPriceScaleApi,
  ISeriesApi,
  ISeriesPrimitive,
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
  PaneRect,
  PaneGridInfo,
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
// ⭐⭐ A GEOMETRIA das panes vive num nucleo PURO. Ver `pane-grid.core.ts` — inclusive a
// invariante que sustenta a grade: toda pane mostra a MESMA janela logica, e a coluna so
// muda a escala geometrica (`barSpacing` escalado por `larguraDaPane / larguraTotal`).
import {
  calcularArranjo,
  fatorDeCompressao,
  paneNoPonto,
  retanguloDe,
  type ArranjoDeGrade,
  type ColunasPorLinha,
  type FronteiraHorizontal,
  type FronteiraVertical,
  type RetanguloDePane,
} from './pane-grid.core.js';

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
  /**
   * Fração PEDIDA pelo consumidor (`setPaneHeightFraction`), ou `null`.
   *
   * ⚠️ Separada de `heightFraction` de propósito: esta é a INTENÇÃO e sobrevive ao
   * rebalanceamento; a outra é o RESULTADO, recalculado a cada pane que entra ou sai.
   * Guardar só o resultado faria a intenção ser apagada pelo próximo indicador ligado.
   */
  heightFractionFixa: number | null;
  /**
   * Peso da LARGURA dentro da linha da grade. `1` para todas = colunas iguais.
   *
   * ⚠️ Ignorado no modo empilhado (uma coluna por linha): lá a pane sempre ocupa a largura
   * inteira, e o peso nao teria com quem ser comparado.
   */
  widthFraction: number;
  /**
   * Peso de largura PEDIDO (divisoria vertical arrastada, ou `setPaneWidthFraction`).
   *
   * ⚠️ Separado de `widthFraction` pelo mesmo motivo de `heightFractionFixa`: este e a
   * INTENCAO e sobrevive ao rebalanceamento; o outro e o RESULTADO. Guardar so o resultado
   * faria a largura arrastada ser apagada pelo proximo indicador ligado — que era exatamente
   * o defeito conhecido da divisoria horizontal, e nao vale repeti-lo na vertical.
   */
  widthFractionFixa: number | null;
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
 * Largura MINIMA de uma pane na grade, em pixel logico.
 *
 * ⚠️ Par horizontal de `MIN_PANE_HEIGHT_PX`, e pelo mesmo motivo: sem piso, arrastar a
 * divisoria vertical ate a ponta deixa uma coluna com largura 0 — ela some da tela E fica
 * sem area para o cursor voltar a pegar a divisoria. 120 px e o suficiente para a coluna
 * continuar visivel e agarravel; note que 56 deles sao do eixo de preco dela.
 */
const MIN_PANE_WIDTH_PX = 120;

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
  /**
   * ⭐⭐ Colunas por linha na grade de SUB-PAINEIS. Default `1` = empilhado.
   *
   * ⚠️ O default e o comportamento historico de proposito. A grade muda COMO o operador le o
   * grafico, e ninguem deve ter o layout reorganizado por atualizar a biblioteca. Quem quer a
   * grade pede (`setPaneGridColumns`), e `'auto'` adapta a largura da janela.
   */
  private colunasPedidas: ColunasPorLinha = 1;
  /**
   * A GEOMETRIA corrente, calculada pelo nucleo puro em cada `measure()`.
   *
   * ⚠️ Cache de resultado, nunca fonte de verdade: a verdade sao as fracoes das panes mais o
   * tamanho do container. Recalcular a cada consulta seria correto e caro (o `render` consulta
   * por pane, por quadro); guardar sem invalidar seria um segundo dono da geometria. O ponto
   * UNICO de invalidacao e `measure()`.
   */
  private arranjo: ArranjoDeGrade = {
    retangulos: [],
    colunas: 1,
    linhas: 0,
    alturaUtil: 1,
    fronteirasHorizontais: [],
    fronteirasVerticais: [],
  };
  /** Estado do arrasto vertical do eixo de preco. */
  private scalingPriceAxis = false;
  private scalingPane: Pane | null = null;
  /**
   * ⭐⭐ Ouvintes de LAYOUT: chamados quando a geometria das panes muda.
   *
   * ⚠️ Existem porque uma camada HTML sobre o canvas nao tem como saber que os retangulos
   * mudaram. Sem isto, o unico caminho seria pesquisar `paneRectOf` a cada quadro de animacao —
   * um laco de rAF permanente para um evento que acontece ao redimensionar a janela, ligar um
   * indicador ou arrastar uma divisoria. Raro, e sem aviso viraria custo continuo.
   *
   * ⚠️ Emitido de `measure()`, que e o ponto UNICO onde a geometria e recalculada.
   */
  private readonly layoutListeners = new Set<() => void>();
  private readonly rangeListeners = new Set<(r: LogicalRange | null) => void>();
  private readonly clickListeners = new Set<(p: MouseEventParams) => void>();
  private readonly crosshairListeners = new Set<(p: MouseEventParams) => void>();

  // Estado do arrasto de pan.
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  /**
   * O `pointerdown` corrente foi consumido por outra camada (`defaultPrevented`)?
   *
   * Guarda a decisao do `pointerdown` para o `pointerup` do mesmo gesto NAO emitir
   * clique. Ver a nota longa em `onPointerDown`.
   */
  private cliqueSuprimido = false;

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
  /** Fronteira HORIZONTAL em arrasto (altura de faixa), ou `null`. */
  private resizingBoundary: FronteiraHorizontal | null = null;
  /** Fronteira VERTICAL em arrasto (largura de coluna), ou `null`. */
  private resizingColumn: FronteiraVertical | null = null;
  /**
   * A pane em que o PAN comecou, ou `null`.
   *
   * ⚠️ Numa coluna comprimida, `dx` de canvas nao vale `dx` de eixo: a coluna tem
   * `barSpacing` escalado, e passar o `dx` cru faria o grafico correr o dobro do dedo. O
   * gesto tem de lembrar ONDE comecou, porque o dedo pode sair da coluna no meio do arrasto.
   */
  private panPane: RetanguloDePane | null = null;

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
        heightFractionFixa: null,
        widthFraction: 1,
        widthFractionFixa: null,
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
    // ⚠️ Emitido DEPOIS de `distributePaneHeights`: quem ouve vai ler `paneRectOf`, e ler
    // durante o calculo devolveria a geometria do quadro anterior.
    for (const l of this.layoutListeners) {
      try {
        l();
      } catch {
        /* ouvinte que lanca nao derruba o redimensionamento */
      }
    }
  }

  /**
   * Recalcula a GEOMETRIA de todas as panes e aplica a altura nas escalas.
   *
   * ⚠️ A altura das panes soma `totalH - timeAxisHeight`, nao `totalH`. E o que
   * impede as series de desenharem por cima dos rotulos de data/hora: a tira
   * `[totalH - timeAxisHeight, totalH]` fica fora de toda pane, livre para o eixo.
   *
   * ⭐ A MATEMATICA saiu daqui e foi para `pane-grid.core.ts`. O motivo nao e organizacao:
   * a geometria e a parte que erra em SILENCIO (um retangulo deslocado nao lanca nada, so
   * desenha no lugar errado), e num nucleo puro ela e medivel sem rasterizar. Aqui ficou so
   * a aplicacao do resultado.
   */
  private distributePaneHeights(totalH: number): void {
    this.arranjo = calcularArranjo(
      this.panes.map((p) => ({
        key: p.index,
        principal: p.index === 0,
        colapsada: p.collapsed,
        heightFraction: p.heightFraction,
        widthFraction: p.widthFraction,
      })),
      {
        largura: this.ts.width,
        altura: totalH,
        alturaEixoTempo: this.timeAxisHeight,
        colunas: this.colunasPedidas,
      },
    );

    for (const p of this.panes) {
      const r = retanguloDe(this.arranjo, p.index);
      const h = r === null ? 0 : r.height;
      // ⚠️ TODAS as escalas da pane recebem a altura — inclusive as de overlay.
      // Elas dividem o mesmo retangulo de pixel e se distinguem por faixa e
      // margem; uma overlay com altura 0 converteria tudo para `null` e o volume
      // simplesmente nao apareceria, sem erro nenhum.
      for (const s of this.allScalesOf(p)) s.height = h;
    }
  }

  /**
   * O retangulo de uma pane, em pixel logico. Nunca `null` para pane existente.
   *
   * ⚠️ Substituiu `paneTop`, que somava as alturas dos vizinhos anteriores. Numa grade essa
   * soma esta ERRADA por construcao: duas panes lado a lado tem o mesmo topo, e a soma daria
   * a segunda um topo abaixo da primeira.
   */
  private paneRect(index: number): RetanguloDePane {
    return (
      retanguloDe(this.arranjo, index) ?? {
        key: index,
        left: 0,
        top: 0,
        width: this.ts.width,
        height: 0,
        linha: -1,
        coluna: 0,
      }
    );
  }

  /**
   * ⭐⭐ O eixo de tempo COMO ESTA PANE O VE.
   *
   * A pane de largura cheia recebe o eixo original (mesma referencia, custo zero). Uma coluna
   * de largura `w` recebe uma COPIA com `width = w` e `barSpacing` escalado por
   * `w / larguraTotal`, mantendo `leftLogical` e `times`.
   *
   * ⭐ Por que isso e correto: a janela visivel e `width / barSpacing`, e escalar os dois pelo
   * mesmo fator a deixa IDENTICA. A coluna mostra as mesmas barras, comprimidas. Nao existe
   * janela por coluna nem estado de eixo por coluna — continua UM eixo, e pan/zoom em qualquer
   * pane movem o grafico inteiro.
   *
   * ⚠️ Deriva por COPIA e nao por mutacao temporaria. Mutar `this.ts` durante o desenho de uma
   * pane e restaurar depois funcionaria e seria uma bomba: qualquer `subscribe` disparado no
   * meio (a autoescala emite faixa) leria um eixo que nao e o do grafico. Copia rasa e barata —
   * o campo pesado (`times`) e compartilhado por referencia, nao clonado.
   */
  private tsDaPane(rect: RetanguloDePane): TimeScaleState {
    const fator = fatorDeCompressao(rect.width, this.ts.width);
    if (fator === 1) return this.ts;
    return { ...this.ts, width: rect.width, barSpacing: this.ts.barSpacing * fator };
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
      heightFractionFixa: null,
      widthFraction: 1,
      widthFractionFixa: null,
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

    // ⭐ Fração FIXADA pelo consumidor vence a repartição automática. Ver
    // `setPaneHeightFraction`: sem isto, ligar o indicador seguinte apagaria a altura que
    // o operador pediu.
    const visiveis = this.panes.filter((p) => p.index !== 0 && !p.collapsed);
    let fixado = 0;
    let semFixar = 0;
    for (const p of visiveis) {
      if (p.heightFractionFixa === null) semFixar += 1;
      else fixado += p.heightFractionFixa;
    }

    // ⚠️ Teto de 80% para os sub-painéis no total: o preço nunca fica com menos de 20% da
    // tela. Sem este piso, fixar 60% em duas panes deixaria o gráfico de preço numa tira
    // de poucos pixels — o defeito de "não aparece nenhuma vela" por outro caminho. O
    // excesso é recortado PROPORCIONALMENTE, para a ordem relativa que o operador pediu
    // ser preservada.
    const TETO_SUBPANEIS = 0.8;
    let escala = 1;
    if (fixado > TETO_SUBPANEIS) {
      escala = TETO_SUBPANEIS / fixado;
      fixado = TETO_SUBPANEIS;
    }

    // O que sobra para as panes SEM fração fixa: até os 38% históricos, limitado pelo que
    // as fixadas já tomaram. Quando todas têm fração fixa, o resto vai para o preço — quem
    // fixou tudo decidiu tudo.
    const paraAsLivres = Math.max(0, Math.min(0.38, TETO_SUBPANEIS - fixado));
    // Piso de 4% por pane livre: abaixo disso ela não cabe nem no eixo de preço dela, e o
    // operador veria uma tira sem nada em vez de um indicador.
    const porPaneLivre = semFixar > 0 ? Math.max(0.04, paraAsLivres / semFixar) : 0;

    let usado = 0;
    for (const p of visiveis) {
      p.heightFraction =
        p.heightFractionFixa === null ? porPaneLivre : p.heightFractionFixa * escala;
      usado += p.heightFraction;
    }
    // O preço fica com o resto, com piso de 20%.
    this.panes[0]!.heightFraction = Math.max(0.2, 1 - usado);
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

  /**
   * ⭐ A ALTURA de um sub-painel, como fração da altura útil do gráfico.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * O PEDIDO QUE ISTO ATENDE
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * *"redução de altura da seção do histograma"*.
   *
   * ⚠️ Antes a repartição era FIXA: 62% para o preço e 38% divididos igualmente entre os
   * sub-painéis. Com três osciladores ligados, cada um ficava com ~12,7% e o preço perdia
   * mais de um terço da tela — para indicadores que só precisam de altura suficiente para
   * mostrar forma, não nível. E o operador não tinha como dizer isso: a divisória
   * arrastável muda a altura de UM par de vizinhos, não a proporção do conjunto, e o valor
   * arrastado se perde na próxima vez que um indicador é ligado (`rebalancePanes` recalcula
   * tudo).
   *
   * ⭐ `fracao` é RELATIVA e não absoluta, e isso importa: o gráfico é redimensionável.
   * Fixar 90 px faria o sub-painel ocupar metade da tela num celular e uma tira invisível
   * num monitor de 4K.
   *
   * ⚠️ A fração pedida é MARCADA (`heightFractionFixa`) e sobrevive a `rebalancePanes` —
   * senão ligar o indicador seguinte apagaria a escolha, que é exatamente o defeito que a
   * divisória arrastável já tem. As panes SEM fração fixa continuam dividindo o que sobra
   * por igual.
   *
   * ⚠️ Piso e teto declarados: abaixo de 4% o sub-painel não cabe nem no eixo de preço
   * dele, e acima de 60% ele deixaria de ser sub-painel. Valor fora da faixa é RECORTADO
   * em vez de recusado — o consumidor pediu "bem pequeno", e recusar deixaria a tela como
   * estava sem dizer por quê.
   *
   * A pane principal (índice 0) não aceita fração: ela recebe o que sobra, por definição.
   */
  setPaneHeightFraction(paneIndex: number, fracao: number | null): void {
    if (this.disposed || paneIndex === 0) return;
    const pane = this.panes.find((p) => p.index === paneIndex);
    if (pane === undefined) return;
    if (fracao === null) {
      pane.heightFractionFixa = null;
    } else {
      if (!Number.isFinite(fracao)) return;
      pane.heightFractionFixa = Math.min(0.6, Math.max(0.04, fracao));
    }
    this.rebalancePanes();
    this.measure();
  }

  /** A fração fixada para um sub-painel, ou `null` quando ele divide o que sobra. */
  paneHeightFraction(paneIndex: number): number | null {
    return this.panes.find((p) => p.index === paneIndex)?.heightFractionFixa ?? null;
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
        // ⭐ O teto por percentil da autoescala de histograma. Ver
        // `PriceScaleOptions.histogramTopPercentile`.
        //
        // ⚠️ `undefined` explícito DESLIGA (volta ao teto no máximo), e é por isso que a
        // verificação é `'histogramTopPercentile' in o` e não `!== undefined`: sem isso, não
        // haveria como desfazer a opção depois de ligada.
        if ('histogramTopPercentile' in o) {
          if (o.histogramTopPercentile === undefined) delete alvo.histogramTopPercentile;
          else alvo.histogramTopPercentile = o.histogramTopPercentile;
        }
        self.scheduleRender();
      },
      width: () => {
        // Largura reservada ao eixo de preco a direita. Fixa e suficiente para o
        // mapeador de coordenada do desenho ancorar a borda util.
        return 56;
      },
    };
  }

  /**
   * O tamanho de uma pane, em pixel logico.
   *
   * ⚠️ A largura passou a ser a REAL da pane, e nao mais a do grafico. Para a pane 0 nada muda
   * — ela sempre ocupa a largura inteira (ver `pane-grid.core.ts`), e e ela que as ferramentas
   * de desenho, o bookmap, o footprint e o perfil de volume consultam (`paneSize()` sem
   * argumento). Para uma coluna da grade, devolver a largura do grafico seria mentir: a camada
   * calcularia a faixa lateral e o recorte sobre um espaco que a pane nao tem.
   */
  paneSize(paneIndex = 0): PaneSize {
    const r = this.paneRect(paneIndex);
    return { width: r.width, height: r.height };
  }

  /**
   * ⭐⭐ Quantas COLUNAS de sub-painel por linha. `'auto'` deriva da largura da janela.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * O PEDIDO
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * *"termos um modo de visualizacao um abaixo do outro ou um ao lado do outro e podermos
   * configurar a quantidade de colunas por linha"*.
   *
   * Com quatro osciladores empilhados o preco perdia quase metade da tela. Em duas colunas
   * eles ocupam DUAS faixas em vez de quatro, e nenhuma informacao foi descartada — o que
   * mudou e que dois indicadores passaram a dividir a mesma faixa vertical.
   *
   * ⚠️ O CUSTO, declarado: a coluna mostra a MESMA janela em menos pixel, entao a
   * correspondencia com o painel de preco deixa de ser pixel-a-pixel e passa a ser
   * PROPORCIONAL. Nao se pode mais encostar uma regua vertical do preco ate a coluna. O que
   * substitui isso e o crosshair, desenhado em cada pane na posicao do MESMO instante — o
   * vinculo temporal continua visivel, so nao e mais uma linha reta continua. Ver
   * `crosshairInPane` e o cabecalho de `pane-grid.core.ts`.
   *
   * ⚠️ O pedido e RECORTADO pelo que cabe (largura minima de coluna e teto de 4). Pedir 4
   * colunas numa janela de 600 px daria 150 px cada, com 56 de eixo de preco — melhor 3
   * legiveis que 4 ilegiveis. O valor EFETIVO sai em `paneGrid()`, para a interface poder
   * dizer o que de fato aconteceu em vez de o recorte ser silencioso.
   */
  setPaneGridColumns(colunas: ColunasPorLinha): void {
    if (this.disposed) return;
    if (colunas !== 'auto') {
      if (!Number.isFinite(colunas)) return;
      const n = Math.floor(colunas);
      if (n < 1) return;
      this.colunasPedidas = n;
    } else {
      this.colunasPedidas = 'auto';
    }
    this.measure();
  }

  /** O arranjo corrente: o que foi PEDIDO, o que ficou EFETIVO, e quantas linhas. */
  paneGrid(): { readonly pedido: ColunasPorLinha; readonly colunas: number; readonly linhas: number } {
    return { pedido: this.colunasPedidas, colunas: this.arranjo.colunas, linhas: this.arranjo.linhas };
  }

  /**
   * ⭐ O PESO da largura de um sub-painel dentro da linha dele.
   *
   * E o par horizontal de `setPaneHeightFraction`, e o que a divisoria vertical arrastavel
   * grava. `null` devolve a coluna a participacao igual.
   *
   * ⚠️ Peso RELATIVO e nao pixel, pelo mesmo motivo da altura: o grafico e redimensionavel, e
   * 300 px sao a tela inteira num celular e um terco num monitor largo.
   *
   * Ignorado na pane principal (ela nunca entra na grade) e no modo empilhado (nao ha com quem
   * dividir a linha).
   */
  setPaneWidthFraction(paneIndex: number, peso: number | null): void {
    if (this.disposed || paneIndex === 0) return;
    const pane = this.panes.find((p) => p.index === paneIndex);
    if (pane === undefined) return;
    if (peso === null) {
      pane.widthFractionFixa = null;
      pane.widthFraction = 1;
    } else {
      if (!Number.isFinite(peso) || peso <= 0) return;
      // Recorte 0,2..5: abaixo disso a coluna nao cabe nem no eixo de preco dela, e acima
      // ela engoliria as vizinhas ate a largura minima, que e o mesmo resultado com mais
      // passos.
      const limitado = Math.min(5, Math.max(0.2, peso));
      pane.widthFractionFixa = limitado;
      pane.widthFraction = limitado;
    }
    this.measure();
  }

  /** O peso de largura fixado para um sub-painel, ou `null` quando ele divide por igual. */
  paneWidthFraction(paneIndex: number): number | null {
    return this.panes.find((p) => p.index === paneIndex)?.widthFractionFixa ?? null;
  }

  subscribeLayoutChange(handler: () => void): void {
    this.layoutListeners.add(handler);
  }

  unsubscribeLayoutChange(handler: () => void): void {
    this.layoutListeners.delete(handler);
  }

  /**
   * ⭐⭐ REORDENA um sub-painel: move-o para outra posicao entre os sub-paineis.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * O PEDIDO
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * *"os histogramas deve ter o recurso de mover com mouse, para poder trocar de posicao"*.
   *
   * ⭐ Barato porque a grade JA preenche as linhas na ordem do array de panes (ver
   * `calcularArranjo`): reordenar e mover um elemento nesse array e remedir. Nao ha geometria
   * a recalcular a mao, e a mesma operacao serve para o modo empilhado e para a grade.
   *
   * `novaPosicao` e o indice entre os SUB-PAINEIS (0 = o primeiro depois do preco), recortado.
   *
   * ⚠️ A pane 0 nao participa: ela e o preco e fica sempre primeira. Um pedido para move-la, ou
   * para mover algo para a posicao dela, e ignorado em vez de reordenar o grafico inteiro.
   *
   * ⚠️ Reordenar NAO mexe em altura nem em largura. As fracoes viajam com a pane — o operador
   * moveu o sub-painel, nao pediu para redimensiona-lo. Um `rebalancePanes` aqui apagaria a
   * altura que ele tinha ajustado a mao.
   */
  movePane(paneIndex: number, novaPosicao: number): void {
    if (this.disposed || paneIndex === 0) return;
    if (!Number.isFinite(novaPosicao)) return;
    const de = this.panes.findIndex((p) => p.index === paneIndex);
    if (de <= 0) return;

    // Posicoes contadas ENTRE os sub-paineis: a lista sem a pane principal.
    const subs = this.panes.slice(1);
    const deSub = subs.findIndex((p) => p.index === paneIndex);
    if (deSub < 0) return;
    const alvo = Math.min(subs.length - 1, Math.max(0, Math.floor(novaPosicao)));
    if (alvo === deSub) return;

    const movida = subs.splice(deSub, 1)[0] as Pane;
    subs.splice(alvo, 0, movida);
    this.panes = [this.panes[0] as Pane, ...subs];
    this.measure();
  }

  /**
   * A ordem corrente das panes, por indice estavel. O primeiro e sempre o preco (0).
   *
   * ⭐ Publicado porque a POSICAO nao e derivavel do indice: o indice e estavel e nunca
   * reusado, e a posicao muda com `movePane`. Sem isto, uma camada de cromo HTML nao teria como
   * saber que ordem desenhar nem para que posicao esta arrastando.
   */
  paneOrder(): readonly number[] {
    return this.panes.map((p) => p.index);
  }

  /** O retangulo de uma pane na tela, em pixel logico. Ver `PaneRect`. */
  paneRectOf(paneIndex: number): PaneRect {
    const r = this.paneRect(paneIndex);
    return { left: r.left, top: r.top, width: r.width, height: r.height, row: r.linha, column: r.coluna };
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
    // ⭐ A REDE DE SEGURANCA do arrasto. Ver `onLostPointerCapture`.
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  private teardownPointer(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
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

  /**
   * O ponto (pixel logico) cai sobre a faixa do eixo de preco DA PANE que o contem?
   *
   * ⚠️ Era uma faixa unica na borda direita do grafico. Numa grade CADA COLUNA tem o seu eixo
   * de preco, na borda direita dela — a faixa antiga acertaria so a ultima coluna, e arrastar
   * o eixo de uma coluna da esquerda faria pan em vez de escalar o preco.
   */
  private isOnPriceAxis(x: number, y: number): boolean {
    const r = this.paneNoPontoInterna(x, y);
    const direita = r === null ? this.ts.width : r.left + r.width;
    return x >= direita - PRICE_AXIS_WIDTH && x <= direita;
  }

  /**
   * Qual pane contem o ponto (pixel logico)?
   *
   * ⚠️ Substituiu `paneAtY`. Numa grade, duas panes dividem a mesma faixa de Y e a resposta
   * passa a depender de X — com o teste so em Y, clicar na coluna da direita responderia a
   * pane da esquerda, e o rotulo de preco sairia lido na escala errada.
   */
  private paneAt(x: number, y: number): Pane | null {
    const r = this.paneNoPontoInterna(x, y);
    if (r === null) return null;
    return this.panes.find((p) => p.index === r.key) ?? null;
  }

  /**
   * A fronteira HORIZONTAL sob o ponto, ou `null`. Redistribui ALTURA.
   *
   * ⚠️ So conta fronteira ENTRE DUAS FAIXAS: a base da ultima e a borda da tira do eixo de
   * tempo, e arrastar ali nao redistribui nada — nao ha faixa abaixo para ceder ou receber
   * altura. Sem sub-painel nao existe fronteira alguma (o grafico nunca muda o cursor).
   *
   * ⭐ Na grade a fronteira pertence a LINHA, nao a uma pane: `acima`/`abaixo` sao listas.
   * Arrastar a divisoria sob uma linha de tres osciladores move os tres — senao a linha
   * ficaria com membros de alturas diferentes e sobraria um buraco de canvas no meio da tela.
   */
  private fronteiraHorizontalEm(x: number, y: number): FronteiraHorizontal | null {
    for (const f of this.arranjo.fronteirasHorizontais) {
      if (Math.abs(y - f.y) <= PANE_DIVIDER_GRAB_PX) {
        void x;
        return f;
      }
    }
    return null;
  }

  /**
   * A fronteira VERTICAL sob o ponto, ou `null`. Redistribui LARGURA entre colunas vizinhas.
   *
   * ⚠️ Limitada a faixa vertical da linha (`topo`/`base`): sem isso o cursor viraria
   * `ew-resize` sobre o painel de preco, prometendo um arrasto que nao faz nada ali.
   */
  private fronteiraVerticalEm(x: number, y: number): FronteiraVertical | null {
    for (const f of this.arranjo.fronteirasVerticais) {
      if (y < f.topo || y > f.base) continue;
      if (Math.abs(x - f.x) <= PANE_DIVIDER_GRAB_PX) return f;
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
  private resizePaneBoundary(f: FronteiraHorizontal, dyPx: number): void {
    if (!Number.isFinite(dyPx)) return;
    const acima = f.acima.map((k) => this.panes.find((p) => p.index === k)).filter(naoNulo);
    const abaixo = f.abaixo.map((k) => this.panes.find((p) => p.index === k)).filter(naoNulo);
    if (acima.length === 0 || abaixo.length === 0) return;

    const util = Math.max(1, this.totalHeight - this.timeAxisHeight);
    // ⚠️ A altura em pixel vem do ARRANJO, e nao de uma reconta das fracoes. Numa grade a
    // altura de uma faixa e o MAXIMO das fracoes dos membros dela, e refazer essa conta aqui
    // seria uma segunda fonte de verdade — divergiria da tela na primeira mudanca da regra.
    const pxA = this.paneRect((acima[0] as Pane).index).height;
    const pxB = this.paneRect((abaixo[0] as Pane).index).height;
    const parAlt = pxA + pxB;
    // Par curto demais para respeitar o piso nas duas: nao ha o que redistribuir.
    if (parAlt < MIN_PANE_HEIGHT_PX * 2) return;

    const alvoA = Math.min(parAlt - MIN_PANE_HEIGHT_PX, Math.max(MIN_PANE_HEIGHT_PX, pxA + dyPx));
    const novoB = parAlt - alvoA;

    // A soma das fracoes DE TODO O ARRANJO (a principal mais uma por linha) e o denominador
    // que converte pixel de volta para fracao. Ler do arranjo mantem as duas contas na mesma
    // fonte.
    const soma = this.somaDeFracoesDoArranjo();
    if (!(soma > 0)) return;
    const fracaoA = (alvoA / util) * soma;
    const fracaoB = (novoB / util) * soma;

    // ⭐⭐ GRAVA COMO INTENCAO (`heightFractionFixa`), e nao so como resultado.
    //
    // ⚠️ Antes o arrasto mexia apenas em `heightFraction`, e o proximo `rebalancePanes`
    // (disparado por ligar qualquer indicador) apagava o valor. Era um defeito conhecido e
    // documentado: o operador ajustava a divisoria, ligava o RSI, e a altura voltava sozinha.
    // O pedido desta rodada e explicito sobre ajustar na mao — de nada serve ajustar e perder.
    //
    // ⚠️ A pane PRINCIPAL nao recebe fracao fixa: ela e definida como "o que sobra". Fixa-la
    // criaria dois donos do resto, e a soma poderia passar de 1.
    for (const p of acima) {
      p.heightFraction = fracaoA;
      if (p.index !== 0) p.heightFractionFixa = fracaoA;
    }
    for (const p of abaixo) {
      p.heightFraction = fracaoB;
      if (p.index !== 0) p.heightFractionFixa = fracaoB;
    }
    this.distributePaneHeights(this.totalHeight);
    this.scheduleRender();
  }

  /**
   * A soma das fracoes que o arranjo usa como denominador: a principal mais UMA por linha.
   *
   * ⚠️ Nao e `Σ` das fracoes de todas as panes. Numa linha de tres osciladores, as tres
   * fracoes valem UMA altura de linha; somar as tres inflaria o denominador e o arrasto
   * andaria menos que o dedo.
   */
  private somaDeFracoesDoArranjo(): number {
    const principal = this.panes.find((p) => p.index === 0);
    let soma = principal !== undefined && !principal.collapsed ? principal.heightFraction : 0;
    const porLinha = new Map<number, number>();
    for (const r of this.arranjo.retangulos) {
      if (r.linha < 0) continue;
      const pane = this.panes.find((p) => p.index === r.key);
      if (pane === undefined) continue;
      porLinha.set(r.linha, Math.max(porLinha.get(r.linha) ?? 0, pane.heightFraction));
    }
    for (const v of porLinha.values()) soma += v;
    return soma;
  }

  /**
   * Redistribui LARGURA entre duas colunas vizinhas — o ajuste manual na horizontal.
   *
   * ⭐ Mesma disciplina da divisoria horizontal: trabalha em PIXEL e converte para peso no
   * fim (o arrasto do operador vem em pixel), preserva a SOMA do par (as outras colunas nao
   * se mexem), e grava como INTENCAO para sobreviver ao rebalanceamento.
   *
   * ⚠️ O piso e `MIN_PANE_WIDTH_PX`, nao zero: uma coluna de largura 0 sai da tela E fica sem
   * area para o cursor reencontrar a divisoria — a coluna estaria perdida sem desfazer.
   */
  private resizeColumnBoundary(f: FronteiraVertical, dxPx: number): void {
    if (!Number.isFinite(dxPx)) return;
    const a = this.panes.find((p) => p.index === f.esquerda);
    const b = this.panes.find((p) => p.index === f.direita);
    if (a === undefined || b === undefined) return;

    const pxA = this.paneRect(a.index).width;
    const pxB = this.paneRect(b.index).width;
    const par = pxA + pxB;
    if (par < MIN_PANE_WIDTH_PX * 2) return;

    const alvoA = Math.min(par - MIN_PANE_WIDTH_PX, Math.max(MIN_PANE_WIDTH_PX, pxA + dxPx));
    const alvoB = par - alvoA;

    // Peso proporcional dentro do par, preservando a soma dos pesos: assim as colunas de
    // OUTRAS linhas (e as outras colunas desta) nao se movem.
    const somaPesos = a.widthFraction + b.widthFraction;
    const escala = somaPesos > 0 ? somaPesos : 2;
    a.widthFraction = (alvoA / par) * escala;
    b.widthFraction = (alvoB / par) * escala;
    a.widthFractionFixa = a.widthFraction;
    b.widthFractionFixa = b.widthFraction;
    this.distributePaneHeights(this.totalHeight);
    this.scheduleRender();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    // ⭐⭐ O GESTO JA FOI CONSUMIDO POR OUTRA CAMADA — e isto corrige um defeito grave.
    //
    // ⚠️ RELATO: *"os componentes de linhas e indicadores para inserir na mão pararam de
    // funcionar, quando clica, o gráfico arrasta por inteiro"*.
    //
    // O motor escuta ponteiro no CANVAS; a camada de desenho escuta no CONTAINER, que e
    // o pai do canvas. O motor ligava `dragging = true` e chamava
    // `canvas.setPointerCapture` ANTES de a ferramenta ser consultada. Em seguida a
    // camada de desenho chamava `container.setPointerCapture`, ROUBANDO a captura — e a
    // partir dai `pointermove` e `pointerup` eram despachados no container. O
    // `onPointerUp` do canvas, unico lugar que baixa `dragging`, NUNCA chegava.
    //
    // Consequencia medida no codigo: terminado o desenho, `dragging` continuava `true` e
    // `lastPointerX` guardava a posicao do gesto ANTERIOR. Qualquer movimento do mouse
    // sobre o grafico — sem botao nenhum pressionado — passava a panar o eixo, com um
    // salto grande no primeiro quadro. O grafico "arrastava por inteiro" e a ferramenta
    // parecia morta porque o eixo corria debaixo dela.
    //
    // ⭐ A CORRECAO E UM CONTRATO, NAO UMA GAMBIARRA: `defaultPrevented` e o mecanismo
    // que o DOM ja tem para "esta camada tratou o gesto". Quem trata chama
    // `preventDefault()` na fase de CAPTURA (antes do canvas, portanto), e o motor nao
    // inicia arrasto nenhum. E o mesmo protocolo do navegador para acao default.
    //
    // ⚠️ O motor continua NAO conhecendo o pacote de desenho (regra 4 do grafo de
    // dependencia). Ele nao pergunta "ha ferramenta ativa?": ele obedece a um sinal
    // padrao do evento, que qualquer camada — desenho, medicao, anotacao — pode usar.
    if (e.defaultPrevented) {
      // O clique tambem nao e do grafico: emiti-lo faria a caixa de propriedades de
      // indicador abrir no meio de uma insercao de linha.
      this.cliqueSuprimido = true;
      return;
    }
    this.cliqueSuprimido = false;

    // ⭐ O usuario agarrou o grafico: a transicao em curso morre AQUI, onde o eixo
    // está. Continuar a rampa faria o conteudo escorregar debaixo da mao dele, e
    // saltar para o destino arrancaria a tela no instante do toque.
    this.cancelarAnimacao();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    this.pointers.set(e.pointerId, { x, y });

    // ⭐ O crosshair tambem e atualizado no PRESSIONAR, e nao so no mover.
    //
    // ⚠️ `emitClick` le a posicao daqui e desiste quando ela e `null`. Num mouse sempre
    // ha `pointermove` antes do clique, entao o defeito nao aparecia — mas num TOQUE o
    // dedo desce sem mover: `crosshair` seguia `null` e o clique NUNCA era emitido.
    // Efeito pratico: "clicar num indicador abre as propriedades dele" nao funcionava em
    // tela sensivel ao toque, sem erro nenhum para dar pista.
    this.crosshair = { x, y };

    // ⭐ Dois ponteiros ativos => PINCA. Cancela pan e escala de eixo em curso: o
    // segundo dedo muda a natureza do gesto, e continuar panando com um deles
    // faria o grafico "escorregar" durante o zoom.
    if (this.pointers.size >= 2) {
      this.dragging = false;
      this.scalingPriceAxis = false;
      this.scalingPane = null;
      this.resizingBoundary = null;
      this.resizingColumn = null;
      this.reiniciarPinca();
      return;
    }

    // Arrasto sobre uma DIVISORIA redimensiona. Tem precedencia sobre o pan e sobre a escala
    // de eixo: a faixa de 4 px e alvo explicito do operador.
    //
    // ⭐ A VERTICAL e testada ANTES da horizontal, e a ordem importa: nos cruzamentos da grade
    // as duas faixas se sobrepoem, e sem uma ordem declarada a resposta dependeria da ordem
    // dos lacos. Vertical primeiro porque a coluna e o eixo NOVO — quem esta no cruzamento
    // acabou de organizar a grade, e o ajuste que ele procura e o de largura.
    //
    // ⚠️⚠️ E ela VENCE O EIXO DE PRECO, diferente da horizontal. Nao e inconsistencia: na
    // grade, o eixo de preco de uma coluna ocupa os 56 px finais DELA, e a divisoria entre
    // duas colunas cai exatamente sobre a borda direita da coluna da esquerda — ou seja,
    // DENTRO do eixo dela. Uma das duas tem de ganhar, e a divisoria ganha porque o alvo dela
    // e de 8 px enquanto o eixo mantem os outros 52 px para arrastar a escala. O inverso
    // deixaria a divisoria de coluna INALCANCAVEL: ela nao existe em nenhum outro X.
    //
    // ⚠️ A borda direita da ULTIMA coluna nao tem divisoria, entao o eixo de preco da direita
    // do grafico continua intocado.
    const coluna = this.fronteiraVerticalEm(x, y);
    if (coluna !== null) {
      this.resizingColumn = coluna;
      this.lastPointerX = e.clientX;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ambiente sem captura */
      }
      return;
    }

    const fronteira = this.fronteiraHorizontalEm(x, y);
    if (fronteira !== null && !this.isOnPriceAxis(x, y)) {
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
    if (this.scaleEnabled() && this.isOnPriceAxis(x, y)) {
      // Por toque, respeita `vertTouchDrag`: e arrasto vertical.
      if (this.isTouch(e) && !this.touchDragEnabled('vert')) return;
      const pane = this.paneAt(x, y);
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
    // Lembra a pane do gesto: e ela que da o fator de compressao do pan.
    this.panPane = this.paneNoPontoInterna(x, y);
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

  /**
   * Ponto MEDIO entre os dois ponteiros, JA no eixo global — a ancora do zoom da pinca.
   *
   * ⚠️ Convertido por `xNoEixoGlobal` pelo mesmo motivo da roda: dois dedos sobre uma coluna
   * comprimida tem um ponto medio de canvas que corresponde a outro instante no eixo global.
   * A pinca ancoraria na barra errada e a tela deslizaria durante o gesto — o mesmo sintoma da
   * translacao residual que a formulacao absoluta desta pinca ja corrigiu uma vez.
   */
  private pontoMedioX(): number | null {
    if (this.pointers.size < 2) return null;
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    if (a === undefined || b === undefined) return null;
    return this.xNoEixoGlobal((a.x + b.x) / 2, (a.y + b.y) / 2);
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

    // ⭐ SEGUNDA REDE: arrasto "em curso" com NENHUM botao pressionado nao existe.
    //
    // ⚠️ Se `pointerup` se perder — captura roubada por outra camada, janela que perde
    // o foco no meio do gesto, ponteiro que sobe fora do documento —, `dragging` ficaria
    // ligado e o simples HOVER passaria a panar o grafico. Foi o defeito relatado ("o
    // gráfico arrasta por inteiro"), e o `lostpointercapture` acima cobre a causa
    // conhecida; esta guarda cobre as que ainda nao aconteceram.
    //
    // ⚠️ Ela so ENCERRA gesto, nunca comeca: um `pointermove` sem botao com nada em
    // curso nao muda nada. E por isso e barata e nao tem como quebrar o pan legitimo,
    // onde `buttons` traz o bit do botao principal durante todo o arrasto.
    if (
      e.buttons === 0 &&
      (this.dragging ||
        this.scalingPriceAxis ||
        this.resizingBoundary !== null ||
        this.resizingColumn !== null)
    ) {
      this.encerrarGestos();
    }

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

    if (this.resizingColumn !== null) {
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.resizeColumnBoundary(this.resizingColumn, dx);
      this.emitCrosshair();
      return;
    }

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
      //
      // ⭐ `dx` e DIVIDIDO pelo fator de compressao da pane onde o gesto comecou. Numa coluna
      // de meia largura, 10 px de dedo valem 20 px de eixo — sem a divisao o grafico correria
      // o DOBRO do dedo, e o operador sentiria o arrasto "escapando" da mao. A pane vem do
      // inicio do gesto porque o dedo pode sair da coluna no meio dele.
      const fator =
        this.panPane === null ? 1 : fatorDeCompressao(this.panPane.width, this.ts.width);
      scrollByPixels(this.ts, -dx / fator);
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
    if (
      this.resizingBoundary !== null ||
      this.resizingColumn !== null ||
      this.dragging ||
      this.scalingPriceAxis
    )
      return;
    // ⭐ EXATAMENTE a precedencia do `pointerdown`: divisoria de coluna primeiro (ela vence o
    // eixo de preco, ver a nota la), depois eixo, depois divisoria de linha. O cursor tem de
    // prometer o gesto que vai acontecer — divergir aqui e o tipo de detalhe que faz o
    // operador achar que o recurso "as vezes nao funciona".
    const desejado =
      this.fronteiraVerticalEm(x, y) !== null
        ? 'ew-resize'
        : this.isOnPriceAxis(x, y)
          ? ''
          : this.fronteiraHorizontalEm(x, y) !== null
            ? 'ns-resize'
            : '';
    // Le antes de escrever: atribuir `style.cursor` a cada `pointermove` invalidaria
    // estilo do elemento dezenas de vezes por segundo sem mudar nada.
    if (this.canvas.style.cursor !== desejado) this.canvas.style.cursor = desejado;
  }

  /**
   * Baixa TODO gesto de arrasto em curso.
   *
   * Existe como metodo porque tres caminhos precisam do mesmo encerramento — soltar,
   * cancelar e PERDER A CAPTURA — e tres copias divergiriam no primeiro campo novo.
   */
  private encerrarGestos(): void {
    this.dragging = false;
    this.scalingPriceAxis = false;
    this.scalingPane = null;
    this.resizingBoundary = null;
    this.resizingColumn = null;
    this.panPane = null;
  }

  /**
   * ⭐ A captura do ponteiro foi PERDIDA — a rede de seguranca do arrasto.
   *
   * ⚠️ Quando outra camada chama `setPointerCapture` no container (a de desenho faz
   * exatamente isso para o gesto nao escapar do elemento), a captura do canvas cai e
   * `pointermove`/`pointerup` passam a ser despachados no container. O `onPointerUp`
   * deste canvas NUNCA chega, e sem este ouvinte `dragging` ficaria `true` para
   * sempre: mover o mouse depois — sem botao — arrastaria o grafico inteiro. Foi o
   * defeito relatado; ver a nota longa em `onPointerDown`.
   *
   * ⚠️ Chamar isto no fim de um arrasto NORMAL e inofensivo por construcao: o
   * navegador solta a captura DEPOIS do `pointerup`, e `pointerup` ja encerrou tudo.
   * O metodo e idempotente.
   */
  private readonly onLostPointerCapture = (e: PointerEvent): void => {
    this.esquecerPonteiro(e.pointerId);
    this.encerrarGestos();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const estavaEscalando = this.scalingPriceAxis;
    const estavaRedimensionando = this.resizingBoundary !== null || this.resizingColumn !== null;
    const estavaEmPinca = this.pointers.size >= 2;
    const gestoDeOutraCamada = this.cliqueSuprimido;

    this.esquecerPonteiro(e.pointerId);
    this.encerrarGestos();
    this.cliqueSuprimido = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ja solto */
    }
    // Arrasto de escala, redimensionamento de pane e pinca nao sao clique do
    // grafico — emiti-los faria a camada de desenho criar uma figura ao fim de cada
    // gesto de ajuste. E gesto que outra camada consumiu no `pointerdown` (ver
    // `cliqueSuprimido`) tambem nao e clique do grafico.
    if (!estavaEscalando && !estavaRedimensionando && !estavaEmPinca && !gestoDeOutraCamada) {
      this.emitClick();
    }
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
    this.encerrarGestos();
    this.cliqueSuprimido = false;
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
    if (!this.isOnPriceAxis(x, y)) return;
    const pane = this.paneAt(x, y);
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
    this.resizingColumn = null;
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
    const y = e.clientY - r.top;
    // Roda para cima (deltaY < 0) aproxima. Fator suave para o zoom nao "pular".
    const fator = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    // ⭐ A ancora do zoom e o INSTANTE sob o cursor, e o eixo que se move e o GLOBAL. Numa
    // coluna, `x` de canvas nao corresponde ao mesmo instante que corresponderia no painel de
    // preco — usar o `x` cru faria a roda sobre um oscilador ancorar noutra barra, e a tela
    // deslizaria para o lado.
    zoomAtCoordinate(this.ts, this.xNoEixoGlobal(x, y), fator);
    this.scheduleRender();
  };

  /**
   * Converte um X de canvas para o X EQUIVALENTE no eixo global, passando pelo instante.
   *
   * ⭐ E a ponte entre "onde o dedo esta" e "que barra e essa" quando o dedo esta numa coluna
   * comprimida. Para pane de largura cheia devolve o proprio `x` (o eixo e o mesmo objeto e a
   * origem e zero), entao o caminho comum nao paga nada.
   *
   * ⚠️ Cai no `x` cru quando o instante nao e resolvivel (grafico sem dado): melhor ancorar
   * aproximado que nao ancorar — devolver `null` faria a roda e a pinca pararem de funcionar
   * num grafico vazio, onde elas ainda precisam mover o eixo.
   */
  private xNoEixoGlobal(x: number, y: number): number {
    const r = this.paneNoPontoInterna(x, y);
    if (r === null) return x;
    const tsPane = this.tsDaPane(r);
    if (tsPane === this.ts) return x;
    const logico = coordinateToLogical(tsPane, x - r.left);
    if (logico === null) return x;
    return logicalToCoordinate(this.ts, logico) ?? x;
  }

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
    // ⭐ `time`/`logical` resolvidos pelo eixo GLOBAL a partir do X equivalente: assim o evento
    // fala do mesmo instante esteja o cursor no painel de preco ou numa coluna comprimida. E
    // `paneIndex` diz ONDE o cursor esta — sem ele, o consumidor de uma grade nao tem como
    // saber de que sub-painel o evento veio.
    const xGlobal = p === null ? 0 : this.xNoEixoGlobal(p.x, p.y);
    const paneDoPonto = p === null ? null : this.paneNoPontoInterna(p.x, p.y);
    const param: MouseEventParams =
      p === null
        ? {}
        : {
            point: { x: p.x, y: p.y },
            time: coordinateToTime(this.ts, xGlobal) ?? undefined,
            logical: coordinateToLogical(this.ts, xGlobal) ?? undefined,
            seriesData: this.barSobCursor(xGlobal),
            ...(paneDoPonto === null ? {} : { paneIndex: paneDoPonto.key }),
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
    const xGlobal = this.xNoEixoGlobal(p.x, p.y);
    const paneDoPonto = this.paneNoPontoInterna(p.x, p.y);
    const param: MouseEventParams = {
      point: { x: p.x, y: p.y },
      time: coordinateToTime(this.ts, xGlobal) ?? undefined,
      logical: coordinateToLogical(this.ts, xGlobal) ?? undefined,
      ...(paneDoPonto === null ? {} : { paneIndex: paneDoPonto.key }),
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
      const rect = this.paneRect(pane.index);
      if (rect.width <= 0 || rect.height <= 0) continue;
      // ⭐⭐ O eixo COMO ESTA PANE O VE: mesma janela logica, escala geometrica da coluna.
      const tsPane = this.tsDaPane(rect);
      const local = this.crosshairInPane(rect, tsPane);
      ctx.save();
      try {
        // Recorta e translada para o RETANGULO da pane, em pixel de bitmap.
        //
        // ⚠️ O `translate` ganhou a componente X. Ele era so vertical porque toda pane
        // comecava em x=0 — e era essa unica linha que, junto com `ts.width`, codificava
        // "pane ocupa a largura inteira".
        ctx.beginPath();
        ctx.rect(
          rect.left * this.dpr,
          rect.top * this.dpr,
          rect.width * this.dpr,
          rect.height * this.dpr,
        );
        ctx.clip();
        ctx.translate(rect.left * this.dpr, rect.top * this.dpr);

        // ⭐ CAMADA `bottom` ANTES DAS SERIES — e isto corrige um defeito relatado:
        // *"o bookmap está sendo plotado em cima das médias de volume"*.
        //
        // ⚠️ Todas as primitives eram desenhadas DEPOIS de `renderPane`, e o `zOrder`
        // só ordenava as primitives ENTRE SI. Logo `'bottom'` não significava nada em
        // relação às séries: o heatmap de livro cobria velas, histograma de volume e
        // linha de indicador. E o contrato da camada afirma o contrário, com estas
        // palavras: *"as formas são emitidas no canvas do gráfico antes das velas, então
        // nenhum pixel de corpo, de sombra ou de borda de vela é coberto"*. O motor
        // quebrava a promessa da própria camada.
        //
        // Agora `'bottom'` é pintado aqui, antes de qualquer série; `'normal'` e `'top'`
        // continuam depois. É o que faz o bookmap ser FUNDO — que é a razão de ele
        // existir como camada de contexto.
        // `true` = esta passada é a que ATUALIZA as views (uma vez por quadro).
        this.drawPrimitives(ctx, pane, ['bottom'], true, rect, tsPane);

        renderPane(
          ctx,
          this.dpr,
          this.dpr,
          // ⭐ O eixo DERIVADO entra aqui, e e o que faz `renderer.ts` nao precisar de UMA
          // LINHA de mudanca: ele le `ts.width` como a largura da area e `ts.barSpacing` para
          // posicionar as barras. Com o eixo da pane, grade vertical, series, eixo de preco e
          // crosshair caem todos no lugar certo dentro da coluna, de graca.
          tsPane,
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

        this.drawPriceLines(ctx, pane, rect);
        // ⭐ `normal` e `top` DEPOIS das series; `bottom` já saiu ANTES (ver acima).
        this.drawPrimitives(ctx, pane, ['normal', 'top'], false, rect, tsPane);
        this.drawMarkers(ctx, pane, rect, tsPane);
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
    const pane = this.paneAt(point.x, point.y);
    if (pane === null) return null;
    const rect = this.paneRect(pane.index);

    // Y local da pane: as escalas de preco convertem no espaco DELA, nao do canvas.
    const yLocal = point.y - rect.top;
    // ⚠️ E X local TAMBEM, com o eixo da pane. Antes so o Y era convertido, porque toda pane
    // comecava em x=0 com a largura do grafico. Numa coluna, X cru resolveria o tempo pelo
    // eixo global — o clique num oscilador acertaria a barra errada, ou nenhuma.
    const xLocal = point.x - rect.left;
    const tsPane = this.tsDaPane(rect);

    let melhor: SeriesImpl<SeriesType> | null = null;
    let melhorPrioridade = -1;
    let melhorDistancia = Number.POSITIVE_INFINITY;

    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      const acerto = this.acertoNaSerie(pane, s, xLocal, yLocal, tolerancePx, tsPane, rect);
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
    tsPane: TimeScaleState = this.ts,
    rect: RetanguloDePane = this.paneRect(pane.index),
  ): { distancia: number; prioridade: number } | null {
    const escala = this.scaleOf(pane, s);
    const dados = s.model.data;
    if (dados.length === 0) return null;

    // Indice do array DA SERIE mais proximo da coluna clicada, resolvido por TEMPO —
    // a serie pode estar desalinhada do eixo (indicador que descartou o aquecimento).
    //
    // ⚠️ Pelo eixo da PANE, com `x` local: numa coluna comprimida o eixo global resolveria
    // outro instante e o clique acertaria a barra errada.
    const t = coordinateToTime(tsPane, x);
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
      const base = yZero === null ? rect.height : yZero;
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
      const xa = timeToCoordinate(tsPane, a.time);
      const xb = timeToCoordinate(tsPane, b.time);
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
      const xp = timeToCoordinate(tsPane, p.time);
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

    // ⭐ Grupo só de histograma: o ZERO É OBRIGATORIAMENTE VISÍVEL (ver o cabeçalho).
    //
    // ═══════════════════════════════════════════════════════════════════════════
    // O DEFEITO RELATADO: "os indicadores de histograma novos não ficam persistentes"
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // ⚠️ A regra anterior era `autoScale(escala, 0, max)` mais `bottomPrice = 0` — e o
    // `min` era DESCARTADO. Ela foi escrita para o VOLUME, cuja premissa "não é
    // negativo" é verdadeira, e foi aplicada a todo grupo só-histograma. Mas
    // histograma de INDICADOR oscila em torno do zero: Awesome Oscillator e a direção
    // do SuperTrend têm o histograma como ÚNICA saída da pane separada, então caem
    // exatamente aqui. Dois regimes de falha, ambos "aparece e desaparece":
    //
    //  1. Janela com máximo positivo (AO entre −50 e +5): a faixa virava `0..5,25` e
    //     TODAS as barras negativas caíam fora do recorte da pane. Metade do
    //     indicador simplesmente não existia na tela, e voltava ao rolar a janela.
    //  2. Janela inteiramente negativa (SuperTrend em baixa, `direction` = −1 fixo):
    //     `autoScale(escala, 0, −1)` dava folga NEGATIVA e faixa INVERTIDA
    //     (`topPrice = −1,05`, base forçada a 0). As barras saíam espelhadas e
    //     `priceTicks` devolvia vazio — sub-painel sem nenhum rótulo de preço era o
    //     sintoma diagnóstico.
    //
    // ⭐ A regra correta não é "a base é zero", é **"o zero está na faixa"**. Ela vale
    // para os dois casos porque é a premissa do próprio desenho: `drawHistogram` mede
    // a altura da barra contra `priceToCoordinate(0)`. Zero fora da faixa = barra
    // medida contra o pé do retângulo, que é desenho sem significado.
    //
    // ⚠️ Para volume o resultado é BYTE-IDÊNTICO ao anterior: com `min >= 0` a base
    // continua colada no zero (sem a folga de 5% que mostraria volume negativo) e o
    // topo continua `max + folga`. O teste herdado que blinda a âncora em zero
    // (`escalas-de-overlay.spec.ts`) mede exatamente esse caso e segue valendo.
    const soHistograma = series.every((s) => s.model.type === 'Histogram');
    if (soHistograma) {
      // ⭐⭐ TETO POR PERCENTIL, quando pedido. Ver `PriceScaleOptions.histogramTopPercentile`:
      // o volume do WIN tem razão de 128x entre a abertura e a tarde, e com o teto no máximo as
      // barras da tarde ficam em menos de 1% da altura — ilegíveis, embora corretas.
      //
      // ⚠️ Ausente ⇒ caminho ANTIGO, byte a byte. É o que garante que nenhum gráfico existente
      // muda de escala por atualização da biblioteca.
      const pct = escala.histogramTopPercentile;
      let tetoEfetivo = max;
      let pisoEfetivo = min;
      if (pct !== undefined) {
        const amostras = this.amostrasDeHistograma(series, lr);
        const t = tetoPorPercentil(amostras, pct);
        if (t.usouPercentil) tetoEfetivo = t.teto;
        // ⚠️ O piso só é comprimido se HOUVER negativo. Num histograma de volume o piso é o
        // zero, e mexer nele abriria faixa de volume negativo que não existe.
        if (min < 0) {
          const p = pisoPorPercentil(amostras, pct);
          if (p.usouPercentil) pisoEfetivo = p.teto;
        }
      }
      autoScale(escala, Math.min(0, pisoEfetivo), Math.max(0, tetoEfetivo));
      // Grandeza que nunca é negativa (volume): cola a base no zero em vez de deixar a
      // folga simétrica abrir uma faixa de volume negativo que não existe.
      if (min >= 0) escala.bottomPrice = 0;
      return;
    }

    autoScale(escala, min, max);
  }

  /**
   * Os valores de histograma da janela visivel, para a estatistica do percentil.
   *
   * ⚠️ Coletados numa passada SEPARADA e so quando o percentil e pedido: o laco da autoescala
   * roda a cada quadro e nao deve alocar um array por escala sem necessidade. Com a opcao
   * ausente este metodo nem e chamado.
   */
  private amostrasDeHistograma(
    series: readonly SeriesImpl<SeriesType>[],
    lr: { from: number; to: number },
  ): number[] {
    const out: number[] = [];
    for (const s of series) {
      const d = s.model.data;
      const { de, ate } = this.faixaVisivelDaSerie(d, lr);
      for (let i = de; i <= ate; i++) {
        const v = (d[i] as { value?: number } | undefined)?.value;
        if (v !== undefined && Number.isFinite(v)) out.push(v);
      }
    }
    return out;
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

  /**
   * O crosshair no espaco LOCAL de uma pane, ou `null`.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ⭐⭐ O X VIAJA POR TEMPO, E E ISSO QUE COSTURA A GRADE
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ⚠️ A versao anterior devolvia `x` CRU. Estava certa enquanto toda pane comecava em x=0 com
   * a largura do grafico; numa grade fica errada de duas formas ao mesmo tempo: o `x` do canvas
   * nao e o `x` local (falta subtrair `left`) e a coluna tem outra escala geometrica.
   *
   * ⭐ A conversao e por INSTANTE: le o tempo sob o cursor no eixo da pane ONDE ELE ESTA, e
   * pergunta a esta pane onde aquele instante cai NELA. E o que mantem a promessa que a grade
   * precisa fazer — a linha vertical em cada coluna marca o MESMO momento que a linha no
   * painel de preco. Sem isso, a grade viraria paineis desconexos e o operador nao teria como
   * relacionar o oscilador com a vela.
   *
   * ⚠️ Y fora da faixa devolve `-1` em vez de `null` (e nao e descuido): `null` apagaria a
   * linha VERTICAL das panes que nao estao sob o cursor, e e justamente ela que atravessa o
   * grafico. `-1` desenha a vertical e joga a horizontal para fora do recorte.
   */
  private crosshairInPane(rect: RetanguloDePane, tsPane: TimeScaleState): CrosshairState | null {
    const c = this.crosshair;
    if (c === null) return null;

    let xLocal: number;
    if (tsPane === this.ts) {
      // Pane de largura cheia: o eixo e o mesmo objeto, entao a conta e a de sempre.
      xLocal = c.x - rect.left;
    } else {
      // Coluna: acha o instante sob o cursor (no eixo da pane que o contem) e projeta.
      const origem = this.paneNoPontoInterna(c.x, c.y);
      const tsOrigem = origem === null ? this.ts : this.tsDaPane(origem);
      const logico = coordinateToLogical(tsOrigem, c.x - (origem?.left ?? 0));
      const projetado = logico === null ? null : logicalToCoordinate(tsPane, logico);
      // ⚠️ Sem tempo resolvivel (grafico vazio), cai na proporcao geometrica em vez de
      // desistir: a linha no lugar aproximado informa mais que linha nenhuma, e `null` aqui
      // apagaria o crosshair do grafico inteiro num grafico sem dado.
      xLocal =
        projetado !== null
          ? projetado
          : ((c.x - (origem?.left ?? 0)) / Math.max(1, origem?.width ?? this.ts.width)) * rect.width;
    }

    const dentro = c.y >= rect.top && c.y <= rect.top + rect.height;
    return { x: xLocal, y: dentro ? c.y - rect.top : -1 };
  }

  /** A pane sob um ponto do canvas, como RETANGULO. `null` fora de todas. */
  private paneNoPontoInterna(x: number, y: number): RetanguloDePane | null {
    return paneNoPonto(this.arranjo, x, y);
  }

  private drawPriceLines(ctx: CanvasRenderingContext2D, pane: Pane, rect: RetanguloDePane): void {
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
        // ⚠️ Largura da PANE, nao do grafico: numa coluna, a linha de preco vazaria por cima
        // da coluna vizinha. O clip a cortaria, mas o desenho estaria errado por sorte.
        ctx.lineTo(rect.width * this.dpr, y * this.dpr);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /**
   * Desenha as primitives das camadas pedidas.
   *
   * ⚠️ A LISTA de camadas é parâmetro porque `'bottom'` é pintado ANTES das séries e as
   * outras duas DEPOIS — ver a nota no `render`. Antes este método desenhava as três de
   * uma vez, sempre depois das séries, e por isso `'bottom'` não significava nada em
   * relação a elas.
   */
  private drawPrimitives(
    ctx: CanvasRenderingContext2D,
    pane: Pane,
    camadas: ReadonlyArray<'bottom' | 'normal' | 'top'>,
    atualizarViews = false,
    rect: RetanguloDePane = this.paneRect(pane.index),
    _tsPane: TimeScaleState = this.ts,
  ): void {
    // ⚠️⚠️ A ORIGEM da pane e passada por DADO, e nao pela transformacao do contexto — e isto
    // corrige um defeito LATENTE, anterior a grade.
    //
    // `createCanvasTarget().useBitmapCoordinateSpace` faz `setTransform(1,0,0,1,0,0)`, que
    // DESCARTA o `translate` aplicado pelo laco de render. Isso passou despercebido porque
    // toda primitive existente (bookmap, footprint, perfil) e anexada a serie da pane 0, onde
    // a origem e (0,0) e descartar a translacao nao muda nada. Numa pane de baixo a camada ja
    // desenhava em Y absoluto errado; numa COLUNA erraria X tambem.
    const target = createCanvasTarget(
      ctx,
      rect.width,
      rect.height,
      this.dpr,
      this.dpr,
      rect.left,
      rect.top,
    );
    // Ordem por z DENTRO do que foi pedido: bottom (bookmap), normal, top (footprint,
    // desenho). A ordem relativa entre as três é preservada.
    const ordem: Array<'bottom' | 'normal' | 'top'> = (['bottom', 'normal', 'top'] as const).filter(
      (z) => camadas.includes(z),
    );
    // Esconder a serie esconde o que esta ancorado nela. O bookmap e anexado a uma
    // serie; se ele continuasse desenhando com a serie oculta, o operador desligaria a
    // serie e o heatmap ficaria flutuando sem a referencia dele.
    const primitives: ISeriesPrimitive[] = [];
    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      for (const prim of s.model.primitives) primitives.push(prim);
    }

    // ⚠️ `updateAllViews` UMA vez por quadro, e nao uma por camada.
    //
    // Este metodo passou a ser chamado DUAS vezes por quadro (antes das series, para
    // `bottom`, e depois, para `normal`/`top`). `updateAllViews` e o gancho de
    // RECALCULO da camada: o `FootprintPrimitive` recalcula as formas ali sem guarda de
    // sujeira, entao chamar de novo dobraria o custo de agregacao por quadro — uma
    // regressao de desempenho invisivel, nascida de uma correcao de ordem de desenho.
    //
    // A primeira passada (a de `bottom`) atualiza; a segunda so desenha. Toda primitive
    // e visitada na primeira, inclusive as que nao tem view de fundo.
    if (atualizarViews) {
      for (const prim of primitives) {
        try {
          prim.updateAllViews?.();
        } catch {
          /* primitive que lanca nao derruba o grafico */
        }
      }
    }

    // ⭐ CAMADA POR FORA, PRIMITIVE POR DENTRO — e esta ordem de lacos e uma correcao.
    //
    // ⚠️ O laco era o inverso (primitive por fora, `zOrder` por dentro), e com isso o
    // `zOrder` so ordenava as views DE UMA MESMA primitive. Entre primitives diferentes
    // quem vencia era a ORDEM DE ANEXACAO: anexar o footprint (`top`) antes de uma
    // camada `normal` deixava o footprint embaixo, contrariando o que ele declara. Um
    // teste de ordem foi escrito para o defeito do bookmap e reprovou tambem por este —
    // ver `ordem-de-camadas.spec.ts`.
    for (const z of ordem) {
      for (const prim of primitives) {
        try {
          const views = prim.paneViews?.() ?? [];
          for (const view of views) {
            if (view.zOrder() !== z) continue;
            view.renderer()?.draw(target);
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
  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    pane: Pane,
    rect: RetanguloDePane = this.paneRect(pane.index),
    tsPane: TimeScaleState = this.ts,
  ): void {
    for (const s of pane.series) {
      if (!RobustusChartCore.visivel(s)) continue;
      const escala = this.scaleOf(pane, s);
      for (const m of s.model.markers) {
        // Eixo da PANE: numa coluna o marcador tem de cair na posicao proporcional dela.
        const x = timeToCoordinate(tsPane, m.time);
        if (x === null) continue;
        // Ancora o marcador ao preco da barra: acima/abaixo/dentro.
        //
        // ⚠️ A barra e achada por TEMPO no array DA SERIE, nao pelo indice logico
        // do eixo. `timeToIndex` devolve indice LOGICO; usa-lo para indexar
        // `s.model.data` acerta so quando a serie esta alinhada ao eixo — numa
        // serie desalinhada o marcador ancorava no preco de outra barra.
        const bar = this.barraPorTempo(s.model.data, m.time);
        let yBase = rect.height / 2;
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

/** Filtro de tipo: descarta `undefined` preservando o tipo do elemento. */
function naoNulo<T>(v: T | undefined): v is T {
  return v !== undefined;
}
