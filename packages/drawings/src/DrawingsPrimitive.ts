/**
 * DrawingsPrimitive — a camada que PINTA os desenhos e responde ao cursor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ A PRIMEIRA CAMADA DESTA BIBLIOTECA COM `hitTest` — E ISSO E DELIBERADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `BookmapPrimitive` e `FootprintPrimitive` NAO implementam `hitTest`, de
 * proposito: sem o metodo elas nao capturam ponteiro, e isso e garantia de TIPO em
 * vez de garantia de CSS. Ha property test que reprova se o metodo aparecer nelas.
 *
 * Aqui e o oposto, e pela mesma razao de fundo: desenho existe para ser
 * MANIPULADO. Ao implementar `hitTest`, a camada ganha do substrato tres coisas de
 * graca:
 *
 *  1. **hover** com resolucao de sobreposicao (por `hitTestPriority`, depois por
 *     `distance`);
 *  2. **cursor** apropriado ao gesto, ANTES de o usuario pressionar;
 *  3. **identificacao no clique**, via `externalId` em `MouseEventParams.hoveredInfo`.
 *
 * ⚠️ O que o substrato NAO da: evento de ARRASTO. Nao existe `mousedown`/`mouseup`
 * na API — so `click` e `dblClick`. Por isso o gesto vive em `DrawingController`,
 * que escuta pointer events do DOM. Esta camada e passiva: pinta e responde onde
 * as coisas estao.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONDE ESTA A VELOCIDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **Plano de tela em cache**, invalidado por epoca de viewport. `hitTest` nao
 *    converte coordenada: le pixel pronto. Ver `render-plan.core.ts`.
 *  - **Agrupamento por estilo** na pintura: uma troca de `strokeStyle` por grupo,
 *    e nao por desenho. Mesmo padrao do bookmap, que troca `fillStyle` uma vez por
 *    balde de cor em vez de uma vez por celula.
 *  - **Espaco de coordenada de BITMAP**, com as razoes vindas do escopo em vez de
 *    `devicePixelRatio` lido a mao — igual as camadas irmas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FALHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Excecao na pintura ou no plano NAO propaga: a camada esvazia o plano e segue.
 * Uma camada de visualizacao nao pode derrubar o grafico — e a mesma disciplina
 * das camadas irmas.
 */

import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from '@robustus/chart-core';
import {
  HANDLE_RADIUS_PX,
  HIT_TOLERANCE_PX,
  type Box,
  type Point,
} from './geometry.core.js';
import { cursorFor, hitTest, type Hit } from './hit-test.core.js';
import type { Drawing } from './model.js';
import {
  MAX_DRAWINGS_DEFAULT,
  TEXT_FONT_SIZE_PX,
  TEXT_PADDING_PX,
  buildRenderPlan,
  sameEpoch,
  type RenderPlan,
  type ScreenDrawing,
  type ViewportEpoch,
} from './render-plan.core.js';
import { createChartConverters, readEpoch } from './chart-converters.js';

// ═════════════════════════════════════════════════════════════════════════════
// Opcoes
// ═════════════════════════════════════════════════════════════════════════════

/** O que a camada recebe. */
export interface DrawingsLayerOptions {
  /** A colecao a pintar. */
  readonly drawings: readonly Drawing[];
  /** Ids selecionados — recebem alcas visiveis. */
  readonly selectedIds?: readonly string[];
  /** Id sob o cursor — recebe realce. */
  readonly hoveredId?: string | null;
  /**
   * Desenho em construcao (previa entre o primeiro clique e o segundo).
   *
   * Pintado, mas NAO participa do hit-test: acertar o desenho que esta sendo
   * criado nao faz sentido e atrapalharia o proprio gesto de criacao.
   */
  readonly draft?: Drawing | null;
  /** Teto de desenhos por passada. Default `MAX_DRAWINGS_DEFAULT`. */
  readonly maxDrawings?: number;
  /** Tolerancia de acerto do traco, em px. Default `HIT_TOLERANCE_PX`. */
  readonly hitTolerance?: number;
}

/** Cor do realce de selecao. */
const SELECTION_COLOR = '#38bdf8';
/** Preenchimento da alca. */
const HANDLE_FILL = '#0f1724';
/**
 * Fundo da caixa de rotulo.
 *
 * ⚠️ Quase opaco (0,88) e nao opaco de todo: um pouco da vela por baixo continua aparecendo, o
 * que ancora o rotulo no lugar do grafico a que ele pertence. Totalmente opaco, uma nota sobre
 * uma regiao densa parece um adesivo colado na tela.
 */
const TEXT_BOX_FILL = 'rgba(15, 23, 36, 0.88)';

// ═════════════════════════════════════════════════════════════════════════════
// Renderer
// ═════════════════════════════════════════════════════════════════════════════

class DrawingsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly plan: RenderPlan | null,
    private readonly draftPlan: RenderPlan | null,
    private readonly selected: ReadonlySet<string>,
    private readonly hoveredId: string | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    if (this.plan === null && this.draftPlan === null) return;
    try {
      target.useBitmapCoordinateSpace((scope) => {
        this.paint(scope.context, scope.horizontalPixelRatio, scope.verticalPixelRatio);
      });
    } catch {
      // Pintura nunca derruba o grafico. Ver o cabecalho.
    }
  }

  private paint(ctx: CanvasRenderingContext2D, hpr: number, vpr: number): void {
    // Ordem: regiao, traco, nivel, previa, alca. A alca vai por ULTIMO para ficar
    // acima de tudo — ela e o alvo do gesto, e alvo escondido nao serve.
    if (this.plan !== null) {
      // ⭐ Zonas ANTES das regiões e dos traços: elas são fundo (ver `fillZones`).
      this.fillZones(ctx, this.plan.items, hpr, vpr);
      this.fillRegions(ctx, this.plan.items, hpr, vpr);
      this.strokeAll(ctx, this.plan.items, hpr, vpr);
      this.strokeFibLevels(ctx, this.plan.items, hpr, vpr);
    }
    if (this.draftPlan !== null) {
      this.strokeAll(ctx, this.draftPlan.items, hpr, vpr, true);
    }
    if (this.plan !== null) {
      // ⭐ Os rotulos vao DEPOIS dos tracos e ANTES das alcas. Depois dos tracos porque a caixa
      // opaca precisa cobrir o que estiver atras para o texto ser legivel sobre heatmap; antes
      // das alcas porque a alca e o alvo do gesto e nao pode ficar escondida sob uma caixa.
      this.drawTexts(ctx, this.plan.items, hpr, vpr);
      this.drawHandles(ctx, this.plan.items, hpr, vpr);
    }
  }

  /**
   * ⭐⭐ Os rotulos — e este metodo fecha um buraco que existia desde o inicio.
   *
   * `DrawingStyle.label` estava no modelo, era resolvido em `resolveStyle`, e **nunca chegava ao
   * canvas**: quem punha rotulo num desenho nao via nada e nao recebia erro. O que trouxe o
   * assunto a tona foi a ferramenta de NOTA, cujo desenho inteiro e o texto — mas a correcao
   * vale para as vinte ferramentas.
   *
   * ⚠️ A caixa de fundo NAO e enfeite. Desenho vive sobre velas e sobre o heatmap de livro, que
   * pode estar em qualquer cor: texto claro sobre celula clara fica ilegivel. E a mesma decisao
   * (e o mesmo incidente) que deu caixa opaca a legenda do bookmap.
   *
   * ⚠️ A LARGURA da caixa vem do plano, que a ESTIMOU sem medir — ver `ScreenText`. Medir aqui
   * com `measureText` daria caixa mais justa e desalinharia a area de ACERTO, que e calculada no
   * nucleo puro: o rotulo apareceria num lugar e pegaria clique noutro.
   */
  private drawTexts(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
  ): void {
    const comTexto = items.filter((it) => it.texts.length > 0);
    if (comTexto.length === 0) return;

    ctx.save();
    try {
      // A escala do bitmap entra no CORPO da fonte, e nao numa transformacao: transformar o
      // contexto escalaria tambem a espessura do traco de qualquer camada que esquecesse de
      // restaurar, e o `save`/`restore` deste bloco nao protege quem vem depois de um `throw`
      // fora dele.
      const corpo = TEXT_FONT_SIZE_PX * Math.min(hpr, vpr);
      ctx.font = `${corpo}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      for (const it of comTexto) {
        const realce = this.selected.has(it.id) || this.hoveredId === it.id;
        for (const t of it.texts) {
          const x = t.box.minX * hpr;
          const y = t.box.minY * vpr;
          const w = (t.box.maxX - t.box.minX) * hpr;
          const h = (t.box.maxY - t.box.minY) * vpr;

          ctx.fillStyle = TEXT_BOX_FILL;
          ctx.fillRect(x, y, w, h);

          // Borda na cor do desenho: e o que amarra o rotulo ao traco que ele nomeia quando ha
          // varios desenhos proximos. Sem ela, dez rotulos identicos nao dizem de quem sao.
          ctx.strokeStyle = realce ? SELECTION_COLOR : it.style.color;
          ctx.lineWidth = Math.max(1, Math.min(hpr, vpr));
          ctx.strokeRect(x, y, w, h);

          ctx.fillStyle = realce ? SELECTION_COLOR : it.style.color;
          ctx.fillText(t.texto, x + TEXT_PADDING_PX * hpr, y + h / 2);
        }
      }
    } finally {
      ctx.restore();
    }
  }

  /**
   * ⭐ As ZONAS de cor própria — risco e retorno da ferramenta de posição.
   *
   * ⚠️ Separadas de `fillRegions` porque a cor vem da ZONA e não do estilo do desenho: verde
   * é lucro e vermelho é risco, e passar as duas por `style.fill` daria uma cor só para as
   * duas — a informação central da ferramenta desapareceria.
   *
   * ⚠️ Desenhadas ANTES dos traços (é o primeiro método chamado no laço de pintura): a zona é
   * fundo, e os traços de entrada/stop/alvo têm de ficar legíveis sobre ela.
   */
  private fillZones(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
  ): void {
    // Agrupa por cor, como as regiões: uma troca de `fillStyle` por grupo em vez de uma por
    // zona. Com várias posições na tela são duas trocas no total.
    const porCor = new Map<string, Array<{ readonly box: Box }>>();
    for (const it of items) {
      for (const z of it.zonas) {
        const lista = porCor.get(z.cor);
        if (lista === undefined) porCor.set(z.cor, [{ box: z.box }]);
        else lista.push({ box: z.box });
      }
    }
    for (const [cor, lista] of porCor) {
      ctx.fillStyle = cor;
      for (const { box } of lista) {
        ctx.fillRect(
          box.minX * hpr,
          box.minY * vpr,
          Math.max(1, (box.maxX - box.minX) * hpr),
          Math.max(1, (box.maxY - box.minY) * vpr),
        );
      }
    }
  }

  private fillRegions(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
  ): void {
    // Agrupa por cor de preenchimento: uma troca de `fillStyle` por grupo.
    const porCor = new Map<string, ScreenDrawing[]>();
    for (const it of items) {
      if (it.region === null || it.style.fill === null) continue;
      const lista = porCor.get(it.style.fill);
      if (lista === undefined) porCor.set(it.style.fill, [it]);
      else lista.push(it);
    }
    for (const [cor, lista] of porCor) {
      ctx.fillStyle = cor;
      for (const it of lista) {
        const r = it.region;
        if (r === null) continue;
        ctx.fillRect(
          r.minX * hpr,
          r.minY * vpr,
          Math.max(1, (r.maxX - r.minX) * hpr),
          Math.max(1, (r.maxY - r.minY) * vpr),
        );
      }
    }
  }

  private strokeAll(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
    ehPrevia = false,
  ): void {
    // Chave de estilo: cor + espessura + tracejado. Desenhos que compartilham
    // estilo entram no MESMO caminho de canvas, e por isso o traco sai numa unica
    // chamada de `stroke()` por grupo.
    const grupos = new Map<string, ScreenDrawing[]>();
    for (const it of items) {
      const realce = !ehPrevia && (this.selected.has(it.id) || this.hoveredId === it.id);
      const cor = realce ? SELECTION_COLOR : it.style.color;
      const chave = `${cor}|${it.style.lineWidth}|${it.style.lineStyle}|${ehPrevia ? 'p' : 'n'}`;
      const lista = grupos.get(chave);
      if (lista === undefined) grupos.set(chave, [it]);
      else lista.push(it);
    }

    for (const [chave, lista] of grupos) {
      const [cor, espessura, tracejado] = chave.split('|') as [string, string, string];
      ctx.save();
      try {
        ctx.strokeStyle = cor;
        // Espessura escalada pela razao de bitmap, com piso de 1: sem o piso o
        // traco desaparece em tela de baixa densidade.
        ctx.lineWidth = Math.max(1, Number(espessura) * Math.min(hpr, vpr));
        aplicarTracejado(ctx, tracejado, ehPrevia, hpr);
        ctx.beginPath();
        for (const it of lista) {
          for (const s of it.strokes) {
            ctx.moveTo(s.a.x * hpr, s.a.y * vpr);
            ctx.lineTo(s.b.x * hpr, s.b.y * vpr);
          }
        }
        ctx.stroke();
      } finally {
        // `restore` em bloco de encerramento: excecao no meio deixaria o
        // tracejado e a espessura vazando para a proxima camada.
        ctx.restore();
      }
    }
  }

  private strokeFibLevels(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
  ): void {
    for (const it of items) {
      if (it.fibLines.length === 0) continue;
      const realce = this.selected.has(it.id) || this.hoveredId === it.id;
      ctx.save();
      try {
        ctx.strokeStyle = realce ? SELECTION_COLOR : it.style.color;
        ctx.lineWidth = Math.max(1, it.style.lineWidth * Math.min(hpr, vpr));
        ctx.beginPath();
        for (const l of it.fibLines) {
          ctx.moveTo(l.x1 * hpr, l.y * vpr);
          ctx.lineTo(l.x2 * hpr, l.y * vpr);
        }
        ctx.stroke();

        if (it.style.fill !== null) {
          // Faixas entre niveis consecutivos. Alternadas, e nao todas: preencher
          // todas as faixas com a mesma cor produz um bloco opaco onde nao se ve
          // mais nivel nenhum nem a vela por baixo.
          ctx.fillStyle = it.style.fill;
          for (let i = 0; i + 1 < it.fibLines.length; i += 2) {
            const a = it.fibLines[i];
            const b = it.fibLines[i + 1];
            if (a === undefined || b === undefined) continue;
            const y = Math.min(a.y, b.y);
            const h = Math.abs(b.y - a.y);
            ctx.fillRect(a.x1 * hpr, y * vpr, Math.max(1, (a.x2 - a.x1) * hpr), Math.max(1, h * vpr));
          }
        }
      } finally {
        ctx.restore();
      }
    }
  }

  private drawHandles(
    ctx: CanvasRenderingContext2D,
    items: readonly ScreenDrawing[],
    hpr: number,
    vpr: number,
  ): void {
    const comAlca = items.filter((it) => this.selected.has(it.id) && !it.locked);
    if (comAlca.length === 0) return;

    const raio = HANDLE_RADIUS_PX * Math.min(hpr, vpr);

    ctx.save();
    try {
      ctx.fillStyle = HANDLE_FILL;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = Math.max(1, 1.5 * Math.min(hpr, vpr));
      // Uma passada de `fill` e uma de `stroke` para TODAS as alcas: o contorno
      // claro sobre miolo escuro e o que mantem a alca visivel sobre o heatmap,
      // que pode estar em qualquer cor por baixo.
      for (const it of comAlca) {
        for (const p of it.points) {
          circulo(ctx, p, raio, hpr, vpr);
          ctx.fill();
          ctx.stroke();
        }
      }
    } finally {
      ctx.restore();
    }
  }
}

function circulo(
  ctx: CanvasRenderingContext2D,
  p: Point,
  raio: number,
  hpr: number,
  vpr: number,
): void {
  ctx.beginPath();
  ctx.arc(p.x * hpr, p.y * vpr, raio, 0, Math.PI * 2);
}

function aplicarTracejado(
  ctx: CanvasRenderingContext2D,
  estilo: string,
  ehPrevia: boolean,
  hpr: number,
): void {
  // A previa e SEMPRE tracejada, independente do estilo escolhido: e o sinal de
  // que o desenho ainda nao existe. Sem essa distincao o usuario nao sabe se ja
  // soltou o segundo ponto.
  if (ehPrevia) {
    ctx.setLineDash([4 * hpr, 4 * hpr]);
    return;
  }
  if (estilo === 'DASHED') ctx.setLineDash([6 * hpr, 4 * hpr]);
  else if (estilo === 'DOTTED') ctx.setLineDash([1 * hpr, 3 * hpr]);
  else ctx.setLineDash([]);
}

// ═════════════════════════════════════════════════════════════════════════════
// Pane view
// ═════════════════════════════════════════════════════════════════════════════

class DrawingsPaneView implements IPrimitivePaneView {
  constructor(private readonly dono: DrawingsPrimitive) {}

  /**
   * `'top'`: desenho do usuario fica ACIMA das velas e das camadas de fluxo.
   *
   * Nao e preferencia estetica. O usuario tracou aquela linha para olhar para ela;
   * se o heatmap de livro a cobrir, o gesto dele foi desperdicado. E a alca precisa
   * estar clicavel, o que exige estar por cima.
   */
  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.dono.rendererAtual();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// A primitive
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Camada de desenhos do usuario.
 *
 * @example
 * const camada = new DrawingsPrimitive({ drawings: [] });
 * serie.attachPrimitive(camada);
 * camada.update({ drawings, selectedIds });
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private options: DrawingsLayerOptions;
  private views: readonly IPrimitivePaneView[];

  private chart: SeriesAttachedParameter<Time, SeriesType>['chart'] | null = null;
  private series: SeriesAttachedParameter<Time, SeriesType>['series'] | null = null;
  private requestUpdate: (() => void) | null = null;

  /** Plano em cache e a epoca que o produziu. O coracao do desempenho. */
  private plan: RenderPlan | null = null;
  private epoch: ViewportEpoch | null = null;
  private draftPlan: RenderPlan | null = null;

  private renderer: DrawingsRenderer | null = null;

  constructor(options: DrawingsLayerOptions) {
    this.options = { ...options };
    this.views = Object.freeze([new DrawingsPaneView(this)]);
  }

  // ── Ciclo de vida ─────────────────────────────────────────────────────────

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.invalidate();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.plan = null;
    this.epoch = null;
    this.draftPlan = null;
    this.renderer = null;
  }

  updateAllViews(): void {
    this.rebuildIfNeeded();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** Mescla opcoes e repinta. */
  update(options: Partial<DrawingsLayerOptions>): void {
    this.options = { ...this.options, ...options };
    this.invalidate();
    try {
      this.requestUpdate?.();
    } catch {
      // Grafico em descarte.
    }
  }

  // ── Hit test ──────────────────────────────────────────────────────────────

  /**
   * O que esta sob o cursor.
   *
   * Chamado pelo substrato a CADA movimento. Nao converte coordenada — le o plano
   * em cache. Se o plano nao existir ainda, devolve `null` em vez de construi-lo:
   * construir plano dentro do hit-test faria o custo da primeira passada cair no
   * caminho mais quente do pacote.
   */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const plano = this.plan;
    if (plano === null) return null;

    const acerto = hitTest(plano, x, y, this.options.hitTolerance ?? HIT_TOLERANCE_PX);
    if (acerto === null) return null;

    return {
      // `externalId` carrega a parte e o indice da alca porque
      // `MouseEventParams.hoveredInfo` e o unico canal do clique de volta para
      // nos. Codificar aqui evita um segundo hit-test no manipulador de clique.
      externalId: encodeHitId(acerto),
      zOrder: 'top',
      cursorStyle: cursorFor(acerto.part),
      distance: acerto.distance,
      hitTestPriority: acerto.priority,
    };
  }

  /** O ultimo acerto decodificado de um `externalId`. Utilitario do controlador. */
  static decodeHitId(externalId: string): Hit | null {
    return decodeHitId(externalId);
  }

  // ── Plano ─────────────────────────────────────────────────────────────────

  /** Marca o plano como sujo. */
  private invalidate(): void {
    this.epoch = null;
  }

  /** Reconstroi quando a epoca mudou. Chamado pelo substrato antes de pintar. */
  private rebuildIfNeeded(): void {
    const chart = this.chart;
    const series = this.series;
    if (chart === null || series === null) {
      this.renderer = null;
      return;
    }

    try {
      const epocaAgora = readEpoch(chart, series);
      if (epocaAgora === null) {
        // Grafico ainda sem faixa visivel. Estado normal na montagem.
        this.plan = null;
        this.draftPlan = null;
        this.renderer = null;
        return;
      }

      if (sameEpoch(epocaAgora, this.epoch) && this.plan !== null) {
        // Nada mudou: o plano em cache serve. Este e o caminho comum, e e ele que
        // torna o hit-test barato.
        this.renderer = this.montarRenderer();
        return;
      }

      const conv = createChartConverters(chart, series);
      const teto = this.options.maxDrawings ?? MAX_DRAWINGS_DEFAULT;

      this.plan = buildRenderPlan(this.options.drawings, conv, epocaAgora, teto);

      const previa = this.options.draft ?? null;
      this.draftPlan =
        previa === null ? null : buildRenderPlan([previa], conv, epocaAgora, 1);

      this.epoch = epocaAgora;
      this.renderer = this.montarRenderer();
    } catch {
      // Plano quebrado esvazia a camada em vez de propagar.
      this.plan = null;
      this.draftPlan = null;
      this.renderer = null;
    }
  }

  private montarRenderer(): DrawingsRenderer | null {
    if (this.plan === null && this.draftPlan === null) return null;
    return new DrawingsRenderer(
      this.plan,
      this.draftPlan,
      new Set(this.options.selectedIds ?? []),
      this.options.hoveredId ?? null,
    );
  }

  /** O renderer corrente. `null` desliga a passada de desenho. */
  rendererAtual(): IPrimitivePaneRenderer | null {
    return this.renderer;
  }

  /** O plano corrente, para o controlador consultar sem refazer conversao. */
  currentPlan(): RenderPlan | null {
    return this.plan;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Codificacao do acerto no `externalId`
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Codifica o acerto num texto.
 *
 * Formato: `<id>|<parte>|<indiceDaAlca>`. O id vem primeiro e pode conter `|`?
 * Nao: ids gerados por `crypto.randomUUID` ou pelo contador nao contem `|`. A
 * decodificacao parte do FIM justamente para tolerar id com separador, caso um dia
 * a aplicacao traga o proprio gerador.
 */
function encodeHitId(h: Hit): string {
  return `${h.id}|${h.part}|${h.handleIndex}`;
}

function decodeHitId(externalId: string): Hit | null {
  const ultimo = externalId.lastIndexOf('|');
  if (ultimo <= 0) return null;
  const penultimo = externalId.lastIndexOf('|', ultimo - 1);
  if (penultimo <= 0) return null;

  const id = externalId.slice(0, penultimo);
  const parte = externalId.slice(penultimo + 1, ultimo);
  const indice = Number(externalId.slice(ultimo + 1));

  if (id === '' || !Number.isInteger(indice)) return null;
  if (parte !== 'HANDLE' && parte !== 'STROKE' && parte !== 'REGION') return null;

  return {
    id,
    part: parte,
    handleIndex: indice,
    distance: 0,
    priority: parte === 'HANDLE' ? 2 : parte === 'STROKE' ? 1 : 0,
  };
}
