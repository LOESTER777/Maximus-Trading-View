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

import { createCanvasTarget } from './canvas-target.js';
import type {
  ChartOptions,
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
} from './contracts.js';
import {
  autoScale,
  coordinateToPrice,
  createPriceScaleState,
  priceToCoordinate,
  type PriceScaleState,
} from './price-scale.core.js';
import { DEFAULT_THEME, renderPane, type CrosshairState, type RenderTheme } from './renderer.js';
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

/** Uma pane: retangulo vertical, escala de preco propria, suas series. */
interface Pane {
  readonly index: number;
  priceScale: PriceScaleState;
  /** Fracao da altura total que esta pane ocupa. */
  heightFraction: number;
  readonly series: SeriesImpl<SeriesType>[];
}

const DEFAULT_OPTIONS: ChartOptions = {
  layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
  grid: { vertLines: { visible: false }, horzLines: { visible: true } },
  crosshair: { mode: 1 },
  timeScale: { rightOffset: 12, barSpacing: 8, minBarSpacing: 2, timeVisible: true, secondsVisible: false },
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
  private opts: ChartOptions;
  private theme: RenderTheme;

  private dpr = 1;
  private frame: number | null = null;
  private disposed = false;

  private crosshair: CrosshairState | null = null;
  private readonly rangeListeners = new Set<(r: LogicalRange | null) => void>();
  private readonly clickListeners = new Set<(p: MouseEventParams) => void>();
  private readonly crosshairListeners = new Set<(p: MouseEventParams) => void>();

  // Estado do arrasto de pan.
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private ro: ResizeObserver | null = null;

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
    };

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
        heightFraction: 1,
        series: [],
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
    } else {
      this.ctx = ctx;
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
    this.distributePaneHeights(h);
    this.scheduleRender();
  }

  /** Reparte a altura entre as panes conforme as fracoes. */
  private distributePaneHeights(totalH: number): void {
    const soma = this.panes.reduce((a, p) => a + p.heightFraction, 0) || 1;
    for (const p of this.panes) {
      p.priceScale.height = (p.heightFraction / soma) * totalH;
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
    const serie = new SeriesImpl<S>(type, options, pane.index, () => pane.priceScale, () => this.scheduleRender());
    serie.chartRef = this;
    pane.series.push(serie as unknown as SeriesImpl<SeriesType>);
    this.scheduleRender();
    return serie;
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

  /** Cria um sub-painel abaixo e devolve o indice. O principal fica com 60%. */
  addPane(): number {
    const index = this.panes.length;
    // O principal mantem a maior fatia; sub-paineis dividem o resto. Sub-painel de
    // oscilador precisa de menos altura que o preco.
    this.panes[0]!.heightFraction = 0.62;
    this.panes.push({
      index,
      priceScale: createPriceScaleState(0.15, 0.15),
      heightFraction: 0.38 / index,
      series: [],
    });
    // Reequilibra sub-paineis existentes.
    for (let k = 1; k < this.panes.length; k++) {
      this.panes[k]!.heightFraction = 0.38 / (this.panes.length - 1);
    }
    this.distributePaneHeights(this.panes[0]!.priceScale.height / (this.panes[0]!.heightFraction || 1));
    this.measure();
    return index;
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
      setVisibleLogicalRange: (r) => {
        setVisibleLogicalRange(self.ts, r);
        self.scheduleRender();
      },
      fitContent: () => {
        fitContent(self.ts);
        self.scheduleRender();
      },
      scrollToRealTime: () => {
        scrollToRealTime(self.ts);
        self.scheduleRender();
      },
      subscribeVisibleLogicalRangeChange: (h) => self.rangeListeners.add(h),
      unsubscribeVisibleLogicalRangeChange: (h) => self.rangeListeners.delete(h),
    };
  }

  priceScale(_id: string): IPriceScaleApi {
    // O projeto usa um eixo de preco por pane; o id nomeia escalas de overlay que
    // aqui mapeiam para a pane principal. Superficie minima: o que o engine chama.
    const self = this;
    return {
      applyOptions: (o: Partial<PriceScaleOptions>) => {
        const ps = self.panes[0]!.priceScale;
        if (o.scaleMargins !== undefined) {
          ps.marginTop = o.scaleMargins.top;
          ps.marginBottom = o.scaleMargins.bottom;
        }
        if (o.mode !== undefined) ps.logarithmic = o.mode === 'logarithmic';
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
    this.theme = {
      ...this.theme,
      background: this.opts.layout.background.color,
      text: this.opts.layout.textColor,
      gridVisible: this.opts.grid.horzLines.visible,
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
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private teardownPointer(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private scrollEnabled(): boolean {
    const h = this.opts.handleScroll;
    if (typeof h === 'boolean') return h;
    return (h as HandleScrollOptions).pressedMouseMove;
  }

  private scaleEnabled(): boolean {
    const h = this.opts.handleScale;
    return typeof h === 'boolean' ? h : h.mouseWheel;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.scrollEnabled()) return;
    this.dragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ambiente sem captura */
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.crosshair = { x: e.clientX - r.left, y: e.clientY - r.top };

    if (this.dragging && this.scrollEnabled()) {
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

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ja solto */
    }
    // Clique sem arrasto conta como click do grafico.
    this.emitClick();
  };

  private readonly onPointerLeave = (): void => {
    this.crosshair = null;
    this.emitCrosshair();
    this.scheduleRender();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.scaleEnabled()) return;
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    // Roda para cima (deltaY < 0) aproxima. Fator suave para o zoom nao "pular".
    const fator = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtCoordinate(this.ts, x, fator);
    this.scheduleRender();
  };

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
        : (cb: () => void): number => setTimeout(cb, 16) as unknown as number;
    this.frame = agendar(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    if (this.disposed) return;

    // Antes de mudar times, guarda se estava seguindo o tempo real.
    const seguia = isFollowingRealTime(this.ts);

    // Recolhe os tempos de TODAS as series de preco (pane 0) para o eixo. As series
    // de sub-painel compartilham o mesmo eixo de tempo, entao os tempos vem da pane
    // principal, que e a fonte da verdade temporal.
    const antesCount = this.ts.times.length;
    this.rebuildTimes();
    if (this.ts.times.length !== antesCount) onBarsAppended(this.ts, antesCount, seguia);

    // Autoescala cada pane pela janela horizontal visivel.
    for (const pane of this.panes) this.autoScalePane(pane);

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
      const topo = this.paneTop(pane.index);
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
          pane.series.map((s) => s.model),
          this.theme,
          // Crosshair so na pane sob o cursor.
          this.crosshairInPane(pane, topo),
          true,
        );

        this.drawPriceLines(ctx, pane);
        this.drawPrimitives(ctx, pane);
        this.drawMarkers(ctx, pane);
      } finally {
        ctx.restore();
      }
    }
  }

  /** Reconstroi o eixo de tempo a partir da serie de preco mais longa da pane 0. */
  private rebuildTimes(): void {
    let fonte: SeriesModel | null = null;
    for (const s of this.panes[0]!.series) {
      if (s.model.type === 'Candlestick' || s.model.type === 'Line' || s.model.type === 'Area') {
        if (fonte === null || s.model.data.length > fonte.data.length) fonte = s.model;
      }
    }
    if (fonte === null) {
      // Sem serie de preco: tenta qualquer serie (ex.: so histograma de volume).
      for (const s of this.panes[0]!.series) {
        if (fonte === null || s.model.data.length > fonte.data.length) fonte = s.model;
      }
    }
    this.ts.times = fonte === null ? [] : fonte.data.map((d) => d.time);
  }

  /** Autoescala uma pane pelo min/max das barras visiveis das suas series. */
  private autoScalePane(pane: Pane): void {
    const lr = visibleLogicalRange(this.ts);
    if (lr === null) return;
    const de = Math.max(0, Math.floor(lr.from));
    const ate = Math.ceil(lr.to);

    let min = Infinity;
    let max = -Infinity;
    for (const s of pane.series) {
      const d = s.model.data;
      for (let i = de; i <= ate && i < d.length; i++) {
        const b = d[i];
        if (b === undefined) continue;
        if ((b as { high?: number }).high !== undefined) {
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
    if (Number.isFinite(min) && Number.isFinite(max)) autoScale(pane.priceScale, min, max);
  }

  private crosshairInPane(pane: Pane, topo: number): CrosshairState | null {
    const c = this.crosshair;
    if (c === null) return null;
    const dentro = c.y >= topo && c.y <= topo + pane.priceScale.height;
    return dentro ? { x: c.x, y: c.y - topo } : { x: c.x, y: -1 };
  }

  private drawPriceLines(ctx: CanvasRenderingContext2D, pane: Pane): void {
    for (const s of pane.series) {
      for (const pl of s.model.priceLines.values()) {
        const y = priceToCoordinate(pane.priceScale, pl.price);
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

  private drawMarkers(ctx: CanvasRenderingContext2D, pane: Pane): void {
    for (const s of pane.series) {
      for (const m of s.model.markers) {
        const x = timeToCoordinate(this.ts, m.time);
        if (x === null) continue;
        // Ancora o marcador ao preco da barra: acima/abaixo/dentro.
        const idx = timeToIndex(this.ts, m.time, false);
        const bar = idx === null ? undefined : s.model.data[idx];
        let yBase = pane.priceScale.height / 2;
        if (bar !== undefined) {
          const c = bar as { high?: number; low?: number; value?: number };
          const preco =
            m.position === 'aboveBar' ? c.high ?? c.value : m.position === 'belowBar' ? c.low ?? c.value : c.value;
          const y = preco !== undefined ? priceToCoordinate(pane.priceScale, preco) : null;
          if (y !== null) yBase = y + (m.position === 'aboveBar' ? -12 : m.position === 'belowBar' ? 12 : 0);
        }
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(x * this.dpr, yBase * this.dpr, (m.size ?? 4) * this.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
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
    rightPriceScale: {
      scaleMargins: { ...base.rightPriceScale.scaleMargins, ...over.rightPriceScale?.scaleMargins },
    },
    handleScroll: over.handleScroll ?? base.handleScroll,
    handleScale: over.handleScale ?? base.handleScale,
    autoSize: over.autoSize ?? base.autoSize,
  };
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
