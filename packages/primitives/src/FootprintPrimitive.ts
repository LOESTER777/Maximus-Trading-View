/**
 * FootprintPrimitive — desenha o footprint DENTRO de cada vela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE É, E POR QUE NÃO É O HEATMAP
 * ═══════════════════════════════════════════════════════════════════════════
 * O `BookmapPrimitive` desenha a QUANTIDADE EM REPOUSO (fila do livro) como
 * mancha de calor **atrás** das velas (`zOrder: 'bottom'`). Este desenha a
 * EXECUÇÃO (o que foi agredido) **sobre** a vela (`zOrder: 'top'`), nível de
 * preço por nível de preço.
 *
 * São perguntas diferentes: o heatmap responde "onde há oferta parada"; o
 * footprint responde "onde a oferta foi consumida, e por qual lado".
 *
 * ⚠️ `zOrder: 'top'` é deliberado. O footprint tem de ficar legível SOBRE o
 * corpo da vela — desenhá-lo atrás o esconderia justamente nas velas de corpo
 * cheio, que são as que mais importam.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SEM `hitTest`, PELO MESMO MOTIVO DO BOOKMAP
 * ═══════════════════════════════════════════════════════════════════════════
 * A ausência do método é o que torna a camada estruturalmente incapaz de
 * receber evento de ponteiro — garantia de tipo, não convenção de CSS. Quem
 * adicionar `hitTest` aqui está mudando o contrato da camada.
 *
 * A geometria e a escolha de cor vivem em `footprint-render.core.ts` (puro e
 * testado); este arquivo só emite formas no canvas.
 */
import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from '@robustus/chart-core';

import {
  formasVisiveis,
  textoDaLegendaFootprint,
  velaAdmiteFootprint,
  OPCOES_FOOTPRINT_DEFAULT,
  PALETA_FOOTPRINT_DEFAULT,
  type Conversores,
  type FormaFootprint,
  type ModoFootprint,
  type OpcoesFootprint,
  type PaletaFootprint,
} from '@robustus/charts-core';
import type { VelaFootprint } from '@robustus/charts-core';

import { TEXT_BOX_PAD_PX, desenharCaixaDeTexto, larguraDoTexto } from './text-box.js';

/** O que a camada precisa para desenhar. */
export interface FootprintLayerOptions {
  /** Velas já agregadas por `agregarFootprint`. Vazio ⇒ nada é desenhado. */
  readonly velas: readonly VelaFootprint[];
  readonly opcoes?: Partial<OpcoesFootprint>;
  readonly paleta?: Partial<PaletaFootprint>;
  /** Passo de preço em uso (para converter altura de nível em px). */
  readonly passoPreco: number;
  /** Teto de formas por passada. */
  readonly maxFormas?: number;
  /**
   * Desenhar a linha de legenda no pé do painel.
   *
   * ⚠️ **Ausente ⇒ `true`**, o comportamento original — os testes de legenda
   * montam a camada sem informar a opção.
   *
   * `false` serve ao caso de haver mais de uma camada densa ativa, em que as
   * legendas somadas escondem o gráfico. Ver `mostrarLegenda` em
   * `BookmapLayerOptions`, que tem a mesma semântica.
   *
   * ⭐ **Passou a valer também para o aviso de "Footprint oculto"** (04/09/2026).
   * Antes o aviso era escrito mesmo com a opção em `false`, o que fazia a camada
   * ignorar exatamente o pedido que a opção existe para atender: quem cala a
   * camada não quer texto nenhum sobre o gráfico. Era o caso mais visível do
   * defeito, porque o aviso dispara com a vela estreita — o estado NORMAL de um
   * gráfico com dois pregões na tela.
   */
  readonly mostrarLegenda?: boolean;
  /**
   * ⭐ PUBLICA a linha de legenda em vez de a camada escolher um canto.
   *
   * ⚠️ Esta camada foi do topo para o PÉ do painel com o comentário "o topo à esquerda é
   * da legenda do bookmap" — coordenação por convenção escrita em comentário, que
   * quebrou assim que o bookmap também foi para baixo. Ver `onLegenda` em
   * `BookmapLayerOptions` e `legend-rail.core.ts` no `charts-core`.
   *
   * Notifica só quando o texto MUDA, e publicar é independente de desenhar.
   */
  readonly onLegenda?: (linhas: readonly string[], alerta: boolean) => void;
  /**
   * ⚠️ **Não existe canal de diagnóstico separado nesta camada, de propósito.**
   *
   * O `BookmapLayerOptions` tem `mostrarDiagnostico` porque lá a instrumentação
   * (percentis da escala, rodapé de cobertura) é *linha própria* e dá para
   * suprimir sem tocar no resto. Aqui não dá: o texto da legenda é montado
   * ATOMICAMENTE pelo núcleo puro `textoDaLegendaFootprint`, que devolve razão de
   * velas, modo, limiar, largura de vela e poda numa única cadeia. Repartir por
   * natureza exigiria mudar aquele núcleo — que vive em `@robustus/charts-core`,
   * fora do alcance desta mudança, e cuja assinatura é coberta por testes
   * herdados.
   *
   * Consequência prática, declarada: a camada tem UMA chave de texto
   * (`mostrarLegenda`) em vez de duas. Se um dia a repartição valer o custo, o
   * lugar é o núcleo, e a opção nasce aqui espelhando o nome do livro.
   */
}

const MAX_FORMAS_DEFAULT = 6000;

/**
 * Distância do bloco de texto da camada até o pé do painel, em pixels lógicos.
 *
 * ⚠️ Eram 8 px, e 8 não cabem mais: com a caixa de contraste o texto passou a
 * ocupar meia altura de fonte mais a folga da caixa **abaixo** da linha de base
 * (o alinhamento vertical é `middle`), e a caixa saía recortada pela borda
 * inferior. 14 px deixam a caixa inteira dentro do painel com a fonte de 9 px.
 */
const RODAPE_TEXTO_PX = 14;

/** Emite as formas. Nenhuma decisão de geometria aqui — só canvas. */
class FootprintRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly obterFormas: () => readonly FormaFootprint[]) {}

  draw(target: CanvasRenderingTarget2D): void {
    const formas = this.obterFormas();
    if (formas.length === 0) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;

      // Uma passada por TIPO, para não trocar de estado do canvas a cada forma.
      // Trocar `fillStyle`/`font` por forma é o que faz camadas densas ficarem
      // lentas — aqui a troca acontece no máximo três vezes.
      for (const f of formas) {
        if (f.tipo !== 'retangulo') continue;
        ctx.fillStyle = f.cor;
        ctx.fillRect(
          Math.round(f.x * hpr),
          Math.round(f.y * vpr),
          Math.max(1, Math.round(f.largura * hpr)),
          Math.max(1, Math.round(f.altura * vpr)),
        );
      }

      for (const f of formas) {
        if (f.tipo !== 'linha') continue;
        ctx.strokeStyle = f.cor;
        ctx.lineWidth = Math.max(1, (f.espessura ?? 1) * vpr);
        ctx.beginPath();
        ctx.moveTo(Math.round(f.x * hpr), Math.round(f.y * vpr));
        ctx.lineTo(Math.round((f.x + f.largura) * hpr), Math.round(f.y * vpr));
        ctx.stroke();
      }

      const temTexto = formas.some((f) => f.tipo === 'texto');
      if (temTexto) {
        // Fonte em px de BITMAP: usar px lógico deixa o texto borrado em tela
        // de alta densidade, que é exatamente a queixa de "sem resolução".
        const fontPx = Math.round(9 * vpr);
        ctx.font = `${fontPx}px ui-monospace, monospace`;
        ctx.textBaseline = 'middle';

        // ── caixa de contraste, SÓ para as marcações de legenda ──────────────
        //
        // ⭐ Os números do footprint são desenhados DENTRO da vela e devem se
        // misturar a ela; caixa ali apagaria a vela. A legenda e o aviso, ao
        // contrário, são texto sobre a área de plotagem: sem fundo próprio, ficam
        // ilegíveis sobre a mancha do bookmap e sobre o eixo de tempo — foi o que
        // o usuário fotografou no playground em 04/09/2026. O `papel` é
        // exatamente o campo que distingue os dois casos.
        const padX = TEXT_BOX_PAD_PX * hpr;
        const padY = TEXT_BOX_PAD_PX * vpr;
        for (const f of formas) {
          if (f.tipo !== 'texto' || !f.texto || f.papel !== 'legenda') continue;
          const w = larguraDoTexto(ctx, f.texto, fontPx);
          const x = Math.round(f.x * hpr);
          const y = Math.round(f.y * vpr);
          // O início depende do alinhamento; a legenda usa `left`, e os outros
          // dois entram por robustez — caixa deslocada é pior que caixa nenhuma.
          const inicio =
            f.alinhamento === 'right' ? x - w : f.alinhamento === 'center' ? x - w / 2 : x;
          desenharCaixaDeTexto(
            ctx,
            inicio - padX,
            y - fontPx / 2 - padY,
            w + 2 * padX,
            fontPx + 2 * padY,
            scope.bitmapSize.width,
            scope.bitmapSize.height,
          );
        }

        for (const f of formas) {
          if (f.tipo !== 'texto' || !f.texto) continue;
          ctx.fillStyle = f.cor;
          ctx.textAlign = f.alinhamento ?? 'left';
          ctx.fillText(f.texto, Math.round(f.x * hpr), Math.round(f.y * vpr));
        }
      }
    });
  }
}

/** Põe a camada SOBRE as velas — ver o cabeçalho. */
class FootprintPaneView implements IPrimitivePaneView {
  constructor(
    private readonly renderer_: FootprintRenderer,
    private readonly temConteudo: () => boolean,
  ) {}

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.temConteudo() ? this.renderer_ : null;
  }
}

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  private options: FootprintLayerOptions;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  /** Formas da passada corrente. Recalculadas em `updateAllViews`. */
  private formas: readonly FormaFootprint[] = [];
  private velasDesenhadas = 0;
  private podadas = 0;
  /** Última legenda entregue ao consumidor, como cadeia. Ver `publicarLegenda`. */
  private legendaPublicada: string | null = null;

  private readonly view: FootprintPaneView;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(options: FootprintLayerOptions) {
    this.options = options;
    const renderer = new FootprintRenderer(() => this.formas);
    this.view = new FootprintPaneView(renderer, () => this.formas.length > 0);
    this.views = [this.view];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.recalcular();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.formas = [];
  }

  /** Dado ou opções novos, sem reanexar. */
  update(options: Partial<FootprintLayerOptions>): void {
    this.options = { ...this.options, ...options };
    this.recalcular();
    try {
      this.requestUpdate?.();
    } catch {
      // Gráfico já descartado — nada a redesenhar.
    }
  }

  updateAllViews(): void {
    this.recalcular();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** Diagnóstico: quantas velas entraram e quantas foram podadas. */
  estado(): { readonly velasDesenhadas: number; readonly podadas: number; readonly formas: number } {
    return {
      velasDesenhadas: this.velasDesenhadas,
      podadas: this.podadas,
      formas: this.formas.length,
    };
  }

  /**
   * Recalcula as formas a partir do estado atual do gráfico.
   *
   * ⚠️ Fail-safe: QUALQUER falha (gráfico sem escala, série descartada, conversor
   * devolvendo lixo) esvazia as formas em vez de propagar. Uma camada de
   * visualização não pode derrubar o gráfico de decisão.
   */
  private recalcular(): void {
    try {
      const chart = this.chart;
      const series = this.series;
      if (!chart || !series || this.options.velas.length === 0) {
        this.formas = [];
        this.velasDesenhadas = 0;
        this.podadas = 0;
        return;
      }

      const escalaTempo = chart.timeScale();

      const conv: Conversores = {
        precoParaY: (preco) => {
          const y = series.priceToCoordinate(preco);
          return y === null || !Number.isFinite(y) ? null : y;
        },
        tempoParaX: (tsMs) => {
          // A biblioteca trabalha em SEGUNDOS; o grid do bookmap, em ms.
          const x = escalaTempo.timeToCoordinate((tsMs / 1000) as unknown as Time);
          return x === null || !Number.isFinite(x) ? null : x;
        },
        larguraVelaPx: this.larguraDeVelaPx(),
        alturaNivelPx: this.alturaDeNivelPx(),
      };

      // ── Vela estreita demais: NÃO desenhar, e dizer por quê ──────────────
      //
      // ⚠️ A degradação `NUMEROS → BARRAS` não basta. Com um pregão de M15 na
      // tela a vela recebe ~26 px, a barra de cada nível fica com ~1 px por lado
      // e sai uma faixa de traços — relatado duas vezes pelo operador, com razão.
      //
      // Traço é PIOR que nada: polui a leitura das velas e faz parecer defeito.
      // Aqui a camada se cala e escreve o motivo, com o número que resolve.
      if (!velaAdmiteFootprint(conv.larguraVelaPx)) {
        this.velasDesenhadas = 0;
        this.podadas = 0;

        // ⚠️ Respeita `mostrarLegenda: false`. Antes o aviso saía de qualquer
        // forma, e como ele dispara com a vela estreita — o estado normal de um
        // gráfico com dois pregões na tela — era o texto que MAIS aparecia
        // justamente para quem pediu silêncio.
        const paneAviso = chart.paneSize();
        const larguraAviso = paneAviso.width;
        const cabemAviso = Math.max(
          1,
          Math.floor((Number.isFinite(larguraAviso) && larguraAviso > 0 ? larguraAviso : 900) / 46),
        );
        const textoAviso =
          `Footprint oculto: vela de ${Math.round(conv.larguraVelaPx)} px é estreita demais ` +
          `para ler nível — dê zoom até ~${cabemAviso} velas, ou use o Perfil de volume.`;
        // ⭐ Publica na trilha ANTES de decidir o desenho: com `mostrarLegenda: false` a
        // camada fica muda no canvas e a informação continua chegando ao operador pela
        // trilha. É ressalva, então vai em âmbar.
        this.publicarLegenda([textoAviso], true);

        if (this.options.mostrarLegenda === false) {
          this.formas = [];
          return;
        }

        const pane = paneAviso;
        const cabem = cabemAviso;
        // ⚠️ Foi do topo (`y: 18`) para o PÉ do painel. No topo à esquerda ele
        // caía exatamente sobre a legenda do `BookmapPrimitive`, e com as duas
        // camadas ligadas — a combinação normal — os dois textos se sobrepunham,
        // que é o defeito que o usuário fotografou. O pé é o bloco que esta camada
        // já reserva para si, e só um dos dois textos existe por passada.
        const alturaPainel = Number.isFinite(pane.height) && pane.height > 0 ? pane.height : 0;
        this.formas = [
          {
            tipo: 'texto',
            x: 12,
            y: alturaPainel > 2 * RODAPE_TEXTO_PX ? alturaPainel - RODAPE_TEXTO_PX : RODAPE_TEXTO_PX,
            largura: 0,
            altura: 0,
            texto: textoAviso,
            cor: 'rgba(245, 158, 11, 0.95)',
            alinhamento: 'left',
            // Ganha caixa de contraste no renderizador, como a legenda.
            papel: 'legenda',
          },
        ];
        return;
      }

      const opcoes = { ...OPCOES_FOOTPRINT_DEFAULT, ...(this.options.opcoes ?? {}) };
      const r = formasVisiveis(
        this.options.velas,
        conv,
        opcoes,
        { ...PALETA_FOOTPRINT_DEFAULT, ...(this.options.paleta ?? {}) },
        this.options.maxFormas ?? MAX_FORMAS_DEFAULT,
      );
      this.velasDesenhadas = r.velasDesenhadas;
      this.podadas = r.podadas;

      // ── Legenda: a camada tem de DIZER o que está mostrando ───────────────
      //
      // ⚠️ Antes de 04/09/2026 a camada só escrevia texto quando se CALAVA
      // ("Footprint oculto: vela de N px…"). Desenhando, não dizia nada — e o
      // operador perguntou, sem ter como saber pela tela: *"ele mostra apenas na
      // barra atual, certo? me ajuda a entender ele"*.
      //
      // A resposta é NÃO: `formasVisiveis` percorre todas as velas. O que limita
      // é o DADO — o grid materializado cobre ~1 h e o gráfico mostra 2 a 5
      // pregões, então só um punhado de velas recebe forma. A legenda passa a
      // informar a razão `velas com dado / velas na tela`, que é exatamente o
      // número que responde à pergunta.
      //
      // ⚠️ Suprimida só por pedido explícito (`mostrarLegenda: false`), quando a
      // tela tem mais de uma camada densa e a informação passa a aparecer fora
      // do canvas. Ausência da opção mantém o desenho.
      // ⚠️ `montarLegenda` roda SEMPRE — é ele que publica na trilha (ver `onLegenda`).
      // `mostrarLegenda: false` suprime o DESENHO, não a publicação.
      const legenda = this.montarLegenda(opcoes.modo, opcoes.fatorDiagonal, conv);
      const desenharLegenda = this.options.mostrarLegenda !== false && legenda !== null;
      this.formas = desenharLegenda ? [...r.formas, legenda] : r.formas;
    } catch {
      this.formas = [];
      this.velasDesenhadas = 0;
      this.podadas = 0;
    }
  }

  /**
   * A linha de legenda da camada, ou `null` quando não há o que legendar.
   *
   * Fica no PÉ do painel, à esquerda, de propósito: a legenda do
   * `BookmapPrimitive` ocupa o topo à esquerda, e duas legendas no mesmo canto se
   * sobreporiam — que é justamente o tipo de ilegibilidade que estas camadas
   * vieram consertar.
   *
   * ⚠️ Quando NENHUMA vela tem dado, a legenda diz isso em âmbar em vez de a
   * camada ficar visualmente idêntica a desligada. "Ligado e sem dado" e
   * "desligado" são estados diferentes e precisam parecer diferentes.
   */
  private montarLegenda(
    modo: string,
    fatorDiagonal: number,
    conv: Conversores,
  ): FormaFootprint | null {
    const chart = this.chart;
    if (chart === null) return null;

    const pane = chart.paneSize();
    const alturaPainel =
      Number.isFinite(pane.height) && pane.height > 0 ? pane.height : 0;
    if (alturaPainel <= 0) return null;

    // O TEXTO é decidido no núcleo puro; aqui só se resolve a posição.
    const legenda = textoDaLegendaFootprint({
      comDado: this.velasDesenhadas,
      total: this.options.velas.length,
      modo: modo as ModoFootprint,
      fatorDiagonal,
      larguraVelaPx: conv.larguraVelaPx,
      podadas: this.podadas,
    });
    if (legenda === null) return null;

    this.publicarLegenda([legenda.texto], legenda.alerta);

    return {
      tipo: 'texto',
      x: 12,
      y: alturaPainel - RODAPE_TEXTO_PX,
      largura: 0,
      altura: 0,
      texto: legenda.texto,
      // ⚠️ Cinza-azulado a 0,85 sobre a caixa opaca. Antes esta mesma cor caía
      // direto sobre o gráfico e sobre o eixo de tempo, onde não tinha contraste
      // nenhum — a caixa é o que a torna legível.
      cor: legenda.alerta ? 'rgba(245, 158, 11, 0.95)' : 'rgba(148, 163, 184, 0.85)',
      alinhamento: 'left',
      papel: 'legenda',
    };
  }

  /**
   * Entrega as linhas ao consumidor, uma vez por MUDANÇA de conteúdo. Ver `onLegenda`.
   */
  private publicarLegenda(linhas: readonly string[], alerta: boolean): void {
    const cb = this.options.onLegenda;
    if (cb === undefined) return;
    const chave = `${alerta ? '!' : ''}${linhas.join('\u0000')}`;
    if (chave === this.legendaPublicada) return;
    this.legendaPublicada = chave;
    try {
      cb(linhas, alerta);
    } catch {
      // Consumidor que lança não derruba o recálculo das formas.
    }
  }

  /**
   * Largura de uma vela em px lógico, medida pela distância entre duas velas
   * consecutivas na escala.
   *
   * ⚠️ Medida, não estimada: a `barSpacing` da biblioteca não é pública de forma
   * estável entre versões, e chutar a largura desalinharia o footprint da vela —
   * o pior defeito possível nesta camada.
   */
  private larguraDeVelaPx(): number {
    try {
      const velas = this.options.velas;
      if (velas.length < 2 || !this.chart) return 40;
      const penultima = velas[velas.length - 2];
      const ultima = velas[velas.length - 1];
      if (!penultima || !ultima) return 40;
      const escala = this.chart.timeScale();
      const a = escala.timeToCoordinate((penultima.tempo / 1000) as unknown as Time);
      const b = escala.timeToCoordinate((ultima.tempo / 1000) as unknown as Time);
      if (a === null || b === null) return 40;
      const w = Math.abs(b - a);
      return Number.isFinite(w) && w > 2 ? w : 40;
    } catch {
      return 40;
    }
  }

  /** Altura de um nível em px lógico, medida com o passo de preço em uso. */
  private alturaDeNivelPx(): number {
    try {
      const series = this.series;
      const passo = this.options.passoPreco;
      if (!series || !Number.isFinite(passo) || passo <= 0) return 6;
      // Referência: o preço do POC da última vela com POC definido.
      let ref: number | null = null;
      for (let i = this.options.velas.length - 1; i >= 0; i--) {
        const p = this.options.velas[i]?.poc ?? null;
        if (p !== null) { ref = p; break; }
      }
      if (ref === null) return 6;
      const y1 = series.priceToCoordinate(ref);
      const y2 = series.priceToCoordinate(ref + passo);
      if (y1 === null || y2 === null) return 6;
      const h = Math.abs(y1 - y2);
      return Number.isFinite(h) && h > 0.5 ? h : 6;
    } catch {
      return 6;
    }
  }
}
