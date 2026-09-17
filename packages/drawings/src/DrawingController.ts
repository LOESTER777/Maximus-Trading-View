/**
 * DrawingController — o gesto: maquina de estados sobre pointer events.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA CLASSE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato de grafico expoe `click` e `dblClick`, e **nada mais**. Nao ha
 * `mousedown`, `mousemove` nem `mouseup` na API dele.
 *
 * Arrastar, porem, e a operacao central de uma ferramenta de desenho: e o gesto de
 * criar (pressiona, arrasta, solta) e o de editar (pega a alca, arrasta, solta).
 * Sem evento de arrasto, a unica saida e escutar pointer events do DOM no
 * container e traduzi-los.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ARMADILHA NUMERO UM: O GRAFICO TAMBEM QUER O ARRASTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato usa arrasto com botao pressionado para dar PAN. Se nada for feito, o
 * usuario tenta mover uma linha de tendencia e o grafico rola por baixo — os dois
 * gestos acontecem juntos e o resultado e inutilizavel.
 *
 * A correcao e desligar `handleScroll.pressedMouseMove` ao INICIAR o arrasto e
 * religar ao terminar. Religar precisa acontecer em bloco de encerramento: se uma
 * excecao no meio do arrasto deixasse o pan desligado, o grafico ficaria travado
 * para sempre e o usuario nao teria como descobrir por que.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ARMADILHA NUMERO DOIS: CAPTURA DE PONTEIRO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sem `setPointerCapture`, arrastar rapido para fora do container faz o
 * `pointerup` cair noutro elemento. O arrasto nunca termina: o desenho fica
 * "colado" no cursor, o pan segue desligado, e o unico jeito de sair e recarregar.
 *
 * Com captura, todos os eventos do gesto chegam ao mesmo elemento ate soltar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DESEMPENHO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pointermove` dispara mais de uma vez por quadro. Cada movimento so guarda a
 * posicao e agenda um quadro; o trabalho acontece uma vez por quadro. Sem isso, um
 * arrasto rapido faria duas a tres reconstrucoes de plano por quadro, todas
 * descartadas menos a ultima.
 */

import type { IChartApi, ISeriesApi, SeriesType } from '@robustus/chart-core';
import { xToTime, yToPrice } from './chart-converters.js';
import { hitTest } from './hit-test.core.js';
import {
  ANCHORS_REQUIRED,
  createDefaultIdFactory,
  createDrawing,
  withAnchor,
  withStyle,
  withTranslation,
  type Anchor,
  type Drawing,
  type DrawingKind,
  type DrawingStyle,
  type IdFactory,
} from './model.js';
import type { DrawingsPrimitive } from './DrawingsPrimitive.js';
import {
  DrawingsStore,
  addDrawing,
  clearSelection,
  removeDrawings,
  replaceDrawing,
  selectOnly,
  type DrawingsState,
} from './store.core.js';
import { barsNear, snapAnchor, type SnapBar } from './snap.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Estado do gesto
// ═════════════════════════════════════════════════════════════════════════════

/** O que o controlador esta fazendo. */
export type InteractionState =
  /** Nada em curso. */
  | { readonly kind: 'IDLE' }
  /** Criando: primeira ancora posta, aguardando a segunda. */
  | {
      readonly kind: 'CREATING';
      readonly tool: DrawingKind;
      readonly first: Anchor;
      readonly draft: Drawing;
    }
  /** Arrastando o corpo de um desenho. */
  | {
      readonly kind: 'MOVING';
      readonly id: string;
      readonly origin: Anchor;
      readonly before: Drawing;
    }
  /** Arrastando uma alca. */
  | {
      readonly kind: 'RESIZING';
      readonly id: string;
      readonly handleIndex: number;
      readonly before: Drawing;
    };

/** Ferramenta ativa. `null` = modo de selecao. */
export type ActiveTool = DrawingKind | null;

// ═════════════════════════════════════════════════════════════════════════════
// Opcoes
// ═════════════════════════════════════════════════════════════════════════════

/** Configuracao do controlador. */
export interface DrawingControllerOptions {
  readonly chart: IChartApi;
  readonly series: ISeriesApi<SeriesType>;
  /** O elemento que hospeda o grafico. Fonte dos pointer events. */
  readonly container: HTMLElement;
  /** A camada que pinta. O controlador a mantem atualizada. */
  readonly layer: DrawingsPrimitive;
  /** Colecao com historico. Ausente cria uma vazia. */
  readonly store?: DrawingsStore;
  /** Gerador de id. Ausente usa o default. */
  readonly ids?: IdFactory;
  /** Estilo dos desenhos novos. */
  readonly defaultStyle?: DrawingStyle;
  /**
   * Barras para o ima, em ordem CRESCENTE de tempo.
   *
   * Funcao, e nao array, para o controlador ler o conjunto corrente sem que o
   * chamador precise reconstruir o controlador a cada vela nova.
   */
  readonly bars?: () => readonly SnapBar[];
  /**
   * O ima esta ativo neste gesto?
   *
   * Consultado a CADA movimento, o que permite atrelar a uma tecla modificadora e
   * o usuario ligar e desligar dentro do mesmo arrasto. Ausente = sem ima.
   */
  readonly snapEnabled?: () => boolean;
  /** Notificado a cada mudanca de estado, para a interface refletir. */
  readonly onChange?: (state: DrawingsState, interaction: InteractionState) => void;
  /** Notificado quando um desenho e concluido. */
  readonly onDrawingCreated?: (d: Drawing) => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// O controlador
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Traduz gesto em edicao de desenho.
 *
 * @example
 * const ctrl = new DrawingController({ chart, series, container, layer });
 * ctrl.setTool('TRENDLINE');   // proximo arrasto cria uma linha
 * ctrl.setTool(null);          // volta ao modo de selecao
 * // no desmonte:
 * ctrl.dispose();
 */
export class DrawingController {
  private readonly opts: DrawingControllerOptions;
  private readonly store: DrawingsStore;
  private readonly ids: IdFactory;

  private tool: ActiveTool = null;
  private interaction: InteractionState = { kind: 'IDLE' };

  private hoveredId: string | null = null;
  private frame: number | null = null;
  /** Ultima posicao do ponteiro, consumida uma vez por quadro. */
  private pendingPoint: { x: number; y: number } | null = null;
  private pointerId: number | null = null;

  /** Estado do pan antes de o arrasto desligar, para restaurar exatamente. */
  private scrollAntes: unknown = null;
  private disposed = false;

  constructor(opts: DrawingControllerOptions) {
    this.opts = opts;
    this.store = opts.store ?? new DrawingsStore();
    this.ids = opts.ids ?? createDefaultIdFactory();

    const el = opts.container;
    // ⭐⭐ FASE DE CAPTURA (`capture: true`) — e isto corrige um defeito grave.
    //
    // ⚠️ RELATO: *"os componentes de linhas e indicadores para inserir na mão pararam de
    // funcionar, quando clica, o gráfico arrasta por inteiro"*.
    //
    // O container e ANCESTRAL do `<canvas>` onde o motor escuta ponteiro. Em fase de
    // BOLHA (o default) este ouvinte rodava DEPOIS do motor, que ja havia ligado o
    // arrasto de pan e capturado o ponteiro no canvas. O `preventDefault()` daqui
    // chegava tarde: nao tem efeito retroativo. Pior, o `setPointerCapture` de
    // `captureDrag` roubava a captura, o `pointerup` deixava de chegar ao canvas, e o
    // motor ficava com o arrasto ligado PARA SEMPRE — mover o mouse depois, sem botao
    // nenhum, arrastava o grafico inteiro.
    //
    // Em fase de CAPTURA o percurso e de fora para dentro: este ouvinte roda ANTES do
    // canvas, e o `preventDefault()` chega em tempo de o motor ver `defaultPrevented` e
    // nao iniciar arrasto nenhum. E o protocolo padrao do DOM para "esta camada tratou o
    // gesto", e mantem o motor sem conhecer este pacote (regra 4 do grafo).
    //
    // ⚠️ `capture: true` tem de aparecer TAMBEM no `removeEventListener`: as duas
    // chamadas precisam concordar na fase, senao o ouvinte nao e removido e o
    // controlador descartado continua tratando gesto do proximo.
    el.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    el.addEventListener('pointermove', this.onPointerMove, { capture: true });
    el.addEventListener('pointerup', this.onPointerUp, { capture: true });
    el.addEventListener('pointercancel', this.onPointerCancel, { capture: true });
    // `keydown` no container exige foco; no documento funciona sempre. O custo e
    // ter de checar se o alvo e um campo de texto — ver `onKeyDown`.
    document.addEventListener('keydown', this.onKeyDown);

    this.push();
  }

  // ── API ───────────────────────────────────────────────────────────────────

  /** Define a ferramenta. `null` volta ao modo de selecao. */
  setTool(tool: ActiveTool): void {
    this.tool = tool;
    // Trocar de ferramenta no meio de uma criacao descarta a previa: o usuario
    // mudou de ideia, e manter a ancora antiga produziria um desenho hibrido.
    if (this.interaction.kind === 'CREATING') this.interaction = { kind: 'IDLE' };
    this.push();
  }

  /** A ferramenta ativa. */
  activeTool(): ActiveTool {
    return this.tool;
  }

  /** O gesto em curso. */
  interactionState(): InteractionState {
    return this.interaction;
  }

  /** A colecao, para a aplicacao ler e persistir. */
  drawings(): readonly Drawing[] {
    return this.store.drawings();
  }

  /** A colecao com historico. */
  drawingsStore(): DrawingsStore {
    return this.store;
  }

  undo(): void {
    this.store.undo();
    this.push();
  }

  redo(): void {
    this.store.redo();
    this.push();
  }

  /** Remove os selecionados. */
  deleteSelected(): void {
    const s = this.store.state();
    if (s.selectedIds.length === 0) return;
    this.store.commit(removeDrawings(s, s.selectedIds));
    this.push();
  }

  /**
   * ⭐⭐ Altera o ESTILO de um desenho existente, agrupando no historico.
   *
   * Existe por causa da nota de texto, e serve a qualquer propriedade: cor, espessura,
   * tracejado, rotulo.
   *
   * ⚠️⚠️ **O agrupamento e a razao de este metodo existir em vez de a aplicacao chamar `load`.**
   * Digitar "suporte do dia" sao quinze teclas. Sem chave de agrupamento seriam QUINZE passos de
   * desfazer, e `Ctrl+Z` apagaria uma letra por vez — o operador aperta tres vezes esperando
   * voltar ao estado anterior e recebe "suporte do d". Pior seria `load`, que **zera o
   * historico**: escrever um rotulo destruiria o desfazer de tudo o que ele desenhou antes.
   *
   * A chave e `style:<id>`, entao o burst de teclas colapsa num passo, e mexer noutro desenho
   * comeca passo novo. Quem fecha o passo e `endStyleEdit`, no `blur` ou no `Enter`.
   *
   * ⚠️ Mescla em vez de substituir (usa `withStyle`): informar so `label` nao pode apagar a cor
   * que o operador escolheu.
   */
  setStyle(id: string, style: DrawingStyle): void {
    const atual = this.store.byId(id);
    if (atual === undefined) return;
    this.store.commit(replaceDrawing(this.store.state(), withStyle(atual, style)), `style:${id}`);
    this.push();
  }

  /**
   * Fecha o passo de desfazer da edicao de estilo.
   *
   * Idempotente: `endMerge` com chave nula nao faz nada. Chamar a mais e inofensivo, e chamar a
   * menos so funde duas edicoes que o operador veria como uma — o lado errado seguro.
   */
  endStyleEdit(): void {
    this.store.endMerge();
    this.push();
  }

  /** Substitui tudo, zerando o historico. Para carregar documento salvo. */
  load(drawings: readonly Drawing[]): void {
    this.store.reset({ drawings: drawings.slice(), selectedIds: [] });
    this.push();
  }

  /**
   * Cancela o gesto em curso e limpa a selecao.
   *
   * Restaura o estado anterior quando havia arrasto: o usuario aperta Esc no meio
   * de mover uma linha e espera que ela VOLTE, nao que fique onde parou.
   */
  cancel(): void {
    const i = this.interaction;
    if (i.kind === 'MOVING' || i.kind === 'RESIZING') {
      this.store.commit(replaceDrawing(this.store.state(), i.before));
      this.store.endMerge();
    }
    this.interaction = { kind: 'IDLE' };
    this.store.commit(clearSelection(this.store.state()));
    this.releaseDrag();
    this.push();
  }

  /** Solta os ouvintes e restaura o pan. Idempotente. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const el = this.opts.container;
    // A fase tem de casar com o registro — ver a nota no construtor.
    el.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    el.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    el.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    el.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
    document.removeEventListener('keydown', this.onKeyDown);

    if (this.frame !== null) {
      cancelarQuadro(this.frame);
      this.frame = null;
    }
    // Sem isto, descartar o controlador no meio de um arrasto deixaria o grafico
    // com o pan desligado permanentemente.
    this.releaseDrag();
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.disposed) return;
    // Só botao principal. Botao direito e do menu de contexto, e do meio e do pan.
    if (e.button !== 0) return;

    const p = this.localPoint(e);
    if (p === null) return;

    // ── Ferramenta ativa: criar ──
    if (this.tool !== null) {
      // ⭐ COM FERRAMENTA ATIVA, O GESTO E DA FERRAMENTA — sempre, e antes de qualquer
      // conta poder falhar. `preventDefault` e o sinal que impede o motor de panar (ver
      // a nota no construtor sobre a fase de captura).
      //
      // ⚠️ Ficar depois do `anchorAt` era um buraco: ancora nula (clique na faixa do
      // eixo de preco, eixo de tempo ainda vazio) saia por `return` sem marcar nada, e o
      // motor panava um gesto que o operador fez para desenhar. Chamar aqui, no alto,
      // fecha esse e todos os outros retornos antecipados deste ramo.
      e.preventDefault();

      const ancora = this.anchorAt(p.x, p.y);
      if (ancora === null) return;

      const exigidas = ANCHORS_REQUIRED[this.tool];

      if (exigidas === 1) {
        // Uma ancora basta: nasce completo no pressionar.
        //
        // ⚠️ Este ramo NAO chama `captureDrag` (nao ha arrasto a acompanhar), e por isso
        // era o pior caso do defeito: sem captura e sem `preventDefault`, pressionar
        // para inserir uma linha horizontal panava o grafico na hora. O
        // `preventDefault` acima e o que resolve — e o motivo de ele estar no alto do
        // ramo, e nao dentro de `captureDrag`.
        const d = createDrawing(
          { kind: this.tool, anchors: [ancora], ...this.estiloNovo() },
          this.ids,
        );
        this.store.commit(addDrawing(this.store.state(), d));
        this.opts.onDrawingCreated?.(d);
        this.interaction = { kind: 'IDLE' };
        this.push();
        return;
      }

      // Duas ancoras: a segunda vem no arrastar/soltar.
      const draft = createDrawing(
        { kind: this.tool, anchors: [ancora, ancora], ...this.estiloNovo() },
        this.ids,
      );
      this.interaction = { kind: 'CREATING', tool: this.tool, first: ancora, draft };
      this.captureDrag(e);
      this.push();
      return;
    }

    // ── Modo de selecao: acertar algo? ──
    const plano = this.opts.layer.currentPlan();
    const acerto = plano === null ? null : hitTest(plano, p.x, p.y);

    if (acerto === null) {
      // Vazio: limpa a selecao e DEIXA o pan acontecer — nao chama
      // preventDefault. Roubar o clique vazio impediria o gesto mais usado do
      // grafico.
      this.store.commit(clearSelection(this.store.state()));
      this.push();
      return;
    }

    const antes = this.store.byId(acerto.id);
    if (antes === undefined) return;

    this.store.commit(selectOnly(this.store.state(), [acerto.id]));

    if (acerto.part === 'HANDLE') {
      this.interaction = {
        kind: 'RESIZING',
        id: acerto.id,
        handleIndex: acerto.handleIndex,
        before: antes,
      };
    } else {
      const origem = this.anchorAt(p.x, p.y);
      if (origem === null) return;
      this.interaction = { kind: 'MOVING', id: acerto.id, origin: origem, before: antes };
    }

    this.captureDrag(e);
    this.push();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;

    const p = this.localPoint(e);
    if (p === null) return;

    // Sem gesto em curso: só atualizar o realce de hover, e sem agendar quadro
    // para isso — o realce muda pouco e nao vale um quadro por movimento.
    if (this.interaction.kind === 'IDLE') {
      const plano = this.opts.layer.currentPlan();
      const acerto = plano === null ? null : hitTest(plano, p.x, p.y);
      const novo = acerto?.id ?? null;
      if (novo !== this.hoveredId) {
        this.hoveredId = novo;
        this.opts.layer.update({ hoveredId: novo });
      }
      return;
    }

    // Gesto em curso: guarda e agenda. O trabalho acontece uma vez por quadro.
    this.pendingPoint = p;
    this.scheduleFrame();
  };

  private readonly onPointerUp = (): void => {
    if (this.disposed) return;

    // Consome o ultimo movimento pendente ANTES de concluir: sem isto, soltar
    // rapido perde o ultimo deslocamento e o desenho fica alguns pixels atras de
    // onde o usuario soltou.
    this.flushFrame();

    const i = this.interaction;

    if (i.kind === 'CREATING') {
      const d = i.draft;
      const a0 = d.anchors[0];
      const a1 = d.anchors[1];
      // Clique sem arrasto: as duas ancoras coincidem. Descartar em vez de criar
      // um desenho de comprimento zero, que fica invisivel e ainda assim captura
      // cliques pelo resto da sessao.
      const degenerado =
        a0 !== undefined && a1 !== undefined && a0.timeSec === a1.timeSec && a0.price === a1.price;
      if (!degenerado) {
        this.store.commit(addDrawing(this.store.state(), d));
        this.opts.onDrawingCreated?.(d);
      }
    }

    if (i.kind === 'MOVING' || i.kind === 'RESIZING') {
      // Fecha o agrupamento: o arrasto inteiro virou UM passo de desfazer, e o
      // proximo arrasto da mesma alca sera outro passo.
      this.store.endMerge();
    }

    this.interaction = { kind: 'IDLE' };
    this.releaseDrag();
    this.opts.layer.update({ draft: null });
    this.push();
  };

  private readonly onPointerCancel = (): void => {
    if (this.disposed) return;
    this.cancel();
  };

  // ── Teclado ───────────────────────────────────────────────────────────────

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;

    // Nao roubar tecla de campo de texto. Sem esta guarda, apagar uma letra num
    // campo de anotacao apagaria o desenho selecionado.
    const alvo = e.target as HTMLElement | null;
    if (alvo !== null) {
      const tag = alvo.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || alvo.isContentEditable) {
        return;
      }
    }

    if (e.key === 'Escape') {
      this.cancel();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.store.state().selectedIds.length === 0) return;
      e.preventDefault();
      this.deleteSelected();
      return;
    }

    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (meta && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.redo();
    }
  };

  // ── Quadro ────────────────────────────────────────────────────────────────

  private scheduleFrame(): void {
    if (this.frame !== null) return;
    this.frame = agendarQuadro(() => {
      this.frame = null;
      this.applyPending();
    });
  }

  private flushFrame(): void {
    if (this.frame !== null) {
      cancelarQuadro(this.frame);
      this.frame = null;
    }
    this.applyPending();
  }

  /** Aplica o ultimo ponto pendente ao gesto em curso. */
  private applyPending(): void {
    const p = this.pendingPoint;
    this.pendingPoint = null;
    if (p === null || this.disposed) return;

    const ancora = this.anchorAt(p.x, p.y);
    if (ancora === null) return;

    const i = this.interaction;

    if (i.kind === 'CREATING') {
      const draft = withAnchor(i.draft, 1, ancora);
      this.interaction = { ...i, draft };
      // A previa vive na camada, nao na colecao: ela nao deve entrar no historico
      // nem ser acertavel pelo hit-test.
      this.opts.layer.update({ draft });
      this.opts.onChange?.(this.store.state(), this.interaction);
      return;
    }

    if (i.kind === 'RESIZING') {
      const atual = this.store.byId(i.id);
      if (atual === undefined) return;
      const proximo = withAnchor(atual, i.handleIndex, ancora);
      // Chave de agrupamento inclui o indice da alca: arrastar a alca 0 e depois a
      // alca 1 sao dois passos de desfazer, e nao um.
      this.store.commit(replaceDrawing(this.store.state(), proximo), `resize:${i.id}:${i.handleIndex}`);
      this.push();
      return;
    }

    if (i.kind === 'MOVING') {
      const atual = this.store.byId(i.id);
      if (atual === undefined) return;
      // Delta em unidade LOGICA, medido a partir da ancora de origem do gesto.
      // Recalcular do original a cada quadro (em vez de acumular deltas) evita
      // deriva: acumular somaria o erro de arredondamento de cada quadro.
      const dt = ancora.timeSec - i.origin.timeSec;
      const dp = ancora.price - i.origin.price;
      const proximo = withTranslation(i.before, dt, dp);
      this.store.commit(replaceDrawing(this.store.state(), proximo), `move:${i.id}`);
      this.push();
    }
  }

  // ── Auxiliares ────────────────────────────────────────────────────────────

  /** Posicao do ponteiro relativa a area de plotagem. */
  private localPoint(e: PointerEvent): { x: number; y: number } | null {
    try {
      const r = this.opts.container.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch {
      return null;
    }
  }

  /** Pixel -> ancora logica, com ima quando ativo. */
  private anchorAt(x: number, y: number): Anchor | null {
    const t = xToTime(this.opts.chart, x);
    const p = yToPrice(this.opts.series, y);
    if (t === null || p === null) return null;

    const cru: Anchor = { timeSec: t, price: p };

    if (this.opts.snapEnabled?.() !== true) return cru;

    const todas = this.opts.bars?.() ?? [];
    if (todas.length === 0) return cru;

    const r = snapAnchor({
      raw: cru,
      bars: barsNear(todas, t, 1),
      priceToY: (preco) => {
        try {
          const yy = this.opts.series.priceToCoordinate(preco);
          return yy === null || !Number.isFinite(yy) ? null : yy;
        } catch {
          return null;
        }
      },
    });
    return r.anchor;
  }

  private estiloNovo(): { style?: DrawingStyle } {
    const s = this.opts.defaultStyle;
    return s === undefined ? {} : { style: s };
  }

  /**
   * Inicia o arrasto: captura o ponteiro e desliga o pan.
   *
   * As duas coisas juntas, sempre. Ver as armadilhas 1 e 2 no cabecalho.
   */
  private captureDrag(e: PointerEvent): void {
    try {
      this.opts.container.setPointerCapture(e.pointerId);
      this.pointerId = e.pointerId;
    } catch {
      // Ambiente sem captura de ponteiro (jsdom). O gesto ainda funciona dentro
      // do elemento; só perde robustez ao sair dele.
    }

    try {
      const atual = this.opts.chart.options().handleScroll;
      this.scrollAntes = atual;
      this.opts.chart.applyOptions({
        handleScroll: { pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false, mouseWheel: true },
      });
    } catch {
      this.scrollAntes = null;
    }

    // Impede a selecao de texto do navegador durante o arrasto, que de outro modo
    // pinta o container de azul.
    e.preventDefault();
  }

  /** Termina o arrasto: solta o ponteiro e RELIGA o pan. */
  private releaseDrag(): void {
    if (this.pointerId !== null) {
      try {
        this.opts.container.releasePointerCapture(this.pointerId);
      } catch {
        // Ja soltou.
      }
      this.pointerId = null;
    }

    if (this.scrollAntes !== null) {
      try {
        this.opts.chart.applyOptions({
          handleScroll: this.scrollAntes as never,
        });
      } catch {
        // Grafico em descarte.
      }
      this.scrollAntes = null;
    }
  }

  /** Empurra o estado para a camada e para o observador. */
  private push(): void {
    const s = this.store.state();
    try {
      this.opts.layer.update({
        drawings: s.drawings,
        selectedIds: s.selectedIds,
        hoveredId: this.hoveredId,
        draft: this.interaction.kind === 'CREATING' ? this.interaction.draft : null,
      });
    } catch {
      // Camada desanexada.
    }
    try {
      this.opts.onChange?.(s, this.interaction);
    } catch {
      // Observador que lanca nao derruba o gesto.
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Quadro, com saida para ambiente sem rAF
// ═════════════════════════════════════════════════════════════════════════════

function agendarQuadro(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, 0) as unknown as number;
}

function cancelarQuadro(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}
