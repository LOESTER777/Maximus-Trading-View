/**
 * VolumeProfilePrimitive — o histograma POR LINHA (perfil de volume).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE É, E POR QUE É OUTRO AMBIENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O gráfico já tinha histograma POR COLUNA: o volume por barra, no pé do painel. Ele
 * responde *"quando"* negociou. Este responde *"a que preço"* — uma barra horizontal
 * por nível, empilhada no eixo de preço.
 *
 * O pedido foi exatamente esse: *"criar separações dos ambientes dos histogramas, e
 * poder inserir histograma por linha e por coluna, para assim economizar espaço do
 * gráfico"*. E a economia é real: as duas leituras ocupam eixos PERPENDICULARES, então
 * cabem no mesmo painel sem competir por altura — o que não caberia era um segundo
 * sub-painel por baixo.
 *
 * ⭐ **"Ambiente" aqui é literal: uma FAIXA.** Esta camada desenha apenas dentro de uma
 * faixa lateral (`larguraFracao` da largura do painel) e nada fora dela. Sem essa
 * disciplina o perfil viraria uma mancha sobre as velas — que é o oposto de economizar
 * espaço.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A FAIXA DA DIREITA E O EIXO DE PREÇO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor reserva os ~56 px da direita para o eixo de preço. Desenhar o perfil
 * encostado na borda direita o poria POR BAIXO do eixo. A camada não adivinha esse
 * número: pergunta ao gráfico (`priceScale('right').width()`), e cai em 0 se a pergunta
 * falhar. Assim ela funciona com qualquer largura de eixo, inclusive uma futura.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SEM `hitTest`, COMO AS IRMÃS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A ausência do método é o que torna a camada estruturalmente incapaz de receber evento
 * de ponteiro — garantia de TIPO, não convenção de CSS. Há property test que reprova se
 * `hitTest` aparecer em qualquer camada deste pacote.
 *
 * A agregação (níveis, POC, área de valor) vive em `perfil-de-volume.core.ts`, puro e
 * testado. Este arquivo só emite formas: **quem decide o ESCOPO do perfil é o
 * consumidor** (dia inteiro, janela visível, última hora) — a camada recebe o perfil
 * pronto, do mesmo jeito que não sabe de onde o grid veio.
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
import type { PerfilDeVolume } from '@robustus/charts-core';

import { TEXT_BOX_PAD_PX, desenharCaixaDeTexto, larguraDoTexto } from './text-box.js';

// ═════════════════════════════════════════════════════════════════════════════
// Contrato
// ═════════════════════════════════════════════════════════════════════════════

/** Cores da camada. Todas sobrescrevíveis. */
export interface PaletaPerfil {
  /** Parte da barra executada com o COMPRADOR agredindo. */
  readonly compra: string;
  /** Parte da barra executada com o VENDEDOR agredindo. */
  readonly venda: string;
  /** Barra dos níveis DENTRO da área de valor, quando o modo é `'total'`. */
  readonly dentroDaArea: string;
  /** Barra dos níveis fora da área de valor, quando o modo é `'total'`. */
  readonly foraDaArea: string;
  /** Linha do POC. */
  readonly poc: string;
  /** Bordas da área de valor. */
  readonly areaDeValor: string;
  readonly texto: string;
}

export const PALETA_PERFIL_DEFAULT: PaletaPerfil = {
  // ⚠️ Mesmas cores de alta/baixa do resto da biblioteca: o operador já associa verde a
  // comprador agredindo. Inventar uma segunda convenção de cor por camada é como
  // inventar um segundo idioma.
  compra: 'rgba(22, 199, 132, 0.55)',
  venda: 'rgba(234, 57, 67, 0.55)',
  dentroDaArea: 'rgba(148, 163, 184, 0.55)',
  foraDaArea: 'rgba(148, 163, 184, 0.24)',
  poc: 'rgba(233, 196, 106, 0.95)',
  areaDeValor: 'rgba(148, 163, 184, 0.45)',
  texto: 'rgba(226, 232, 240, 0.9)',
};

export interface VolumeProfileLayerOptions {
  /**
   * O perfil JÁ AGREGADO (`agregarPerfilDeVolume` de `@robustus/charts-core`).
   *
   * ⚠️ A camada não agrega, e isso é a mesma fronteira do resto do pacote: quem decide o
   * ESCOPO (dia inteiro, janela visível, última hora) é o consumidor, porque é uma
   * decisão de leitura, não de desenho. Agregar aqui obrigaria a camada a conhecer o
   * grid, o recorte de tempo e quando recalcular.
   *
   * Perfil vazio ⇒ nada é desenhado (com uma linha dizendo o motivo, se houver legenda).
   */
  readonly perfil: PerfilDeVolume;
  /** De que lado do painel a faixa fica. Default `'direita'`. */
  readonly lado?: 'direita' | 'esquerda';
  /**
   * Largura da faixa como FRAÇÃO da largura do painel. Default `0,18`.
   *
   * ⚠️ Fração, não pixel: o perfil tem de ocupar a mesma proporção num gráfico de 600 px
   * e num de 2.400 px. Recortada a `[0,05; 0,5]` — abaixo de 5% a barra não codifica
   * nada, e acima de 50% o perfil passa a ser o gráfico.
   */
  readonly larguraFracao?: number;
  /**
   * Como colorir a barra. Default `'lado'`.
   *
   * `'lado'` divide a barra em compra/venda (a leitura de fluxo); `'total'` usa uma cor
   * só e destaca a área de valor por opacidade (a leitura clássica de perfil).
   */
  readonly modoCor?: 'lado' | 'total';
  /** Desenhar a linha do POC atravessando o painel. Default `true`. */
  readonly mostrarPOC?: boolean;
  /** Desenhar as bordas da área de valor (VAH/VAL). Default `true`. */
  readonly mostrarAreaDeValor?: boolean;
  /**
   * Escrever a linha de identidade da camada. Default `true`.
   *
   * ⚠️ Mesma semântica de `mostrarLegenda` nas camadas irmãs: com mais de uma camada
   * densa ligada, os textos somados escondem o dado que descrevem.
   */
  readonly mostrarLegenda?: boolean;
  /**
   * Fração da altura reservada NO PÉ do painel, onde a camada não desenha.
   * Default `0`.
   *
   * ⭐ É a "separação de ambientes" entre os dois histogramas. O volume POR COLUNA vive
   * nos ~15% de baixo (via `scaleMargins`), e o perfil, sendo vertical, cruzaria com ele
   * no canto inferior. Passar `0.15` faz o perfil parar onde o outro começa, e os dois
   * histogramas deixam de compartilhar pixel.
   */
  readonly margemInferiorFracao?: number;
  readonly paleta?: Partial<PaletaPerfil>;
}

// ═════════════════════════════════════════════════════════════════════════════
// Constantes de geometria
// ═════════════════════════════════════════════════════════════════════════════

const LARGURA_FRACAO_DEFAULT = 0.18;
const LARGURA_FRACAO_MIN = 0.05;
const LARGURA_FRACAO_MAX = 0.5;

/**
 * Altura mínima de uma barra de nível, em pixel lógico.
 *
 * ⚠️ 1 px, e não 0: com muitos níveis na tela a altura calculada cai abaixo de um pixel
 * e a barra desaparece. Um perfil com metade dos níveis invisíveis mente sobre a
 * distribuição — é melhor um pixel sólido que um nível ausente. (É a mesma decisão do
 * piso de célula do bookmap, por identicamente o mesmo motivo.)
 */
const ALTURA_MIN_PX = 1;

/** Folga entre a faixa do perfil e a borda do painel (ou o eixo), em px lógico. */
const FOLGA_PX = 4;

const FONT_PX = 11;
const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const TEXTO_MARGEM_PX = 8;

// ═════════════════════════════════════════════════════════════════════════════
// Formas — o que o renderizador emite. Nenhuma decisão aqui.
// ═════════════════════════════════════════════════════════════════════════════

interface BarraDoPerfil {
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
  readonly cor: string;
}

interface LinhaDoPerfil {
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
  readonly cor: string;
  readonly tracejada: boolean;
}

interface TextoDoPerfil {
  readonly x: number;
  readonly y: number;
  readonly texto: string;
  readonly cor: string;
}

interface PlanoDoPerfil {
  barras: readonly BarraDoPerfil[];
  linhas: readonly LinhaDoPerfil[];
  texto: TextoDoPerfil | null;
}

const PLANO_VAZIO: PlanoDoPerfil = { barras: [], linhas: [], texto: null };

class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly obterPlano: () => PlanoDoPerfil) {}

  draw(target: CanvasRenderingTarget2D): void {
    const plano = this.obterPlano();
    if (plano.barras.length === 0 && plano.linhas.length === 0 && plano.texto === null) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;

      ctx.save();
      try {
        for (const b of plano.barras) {
          ctx.fillStyle = b.cor;
          // ⚠️ `fillRect` aqui é correto e intencional: as bancadas herdadas que contam
          // `fillRect` como "célula do bookmap" instanciam a camada do bookmap, não esta.
          // A caixa de TEXTO continua por caminho, como manda a regra do pacote.
          ctx.fillRect(
            b.x * hpr,
            b.y * vpr,
            Math.max(1, b.largura * hpr),
            Math.max(1, b.altura * vpr),
          );
        }

        for (const l of plano.linhas) {
          ctx.strokeStyle = l.cor;
          ctx.lineWidth = Math.max(1, vpr);
          if (l.tracejada) ctx.setLineDash([4 * hpr, 4 * hpr]);
          ctx.beginPath();
          ctx.moveTo(l.x1 * hpr, l.y * vpr);
          ctx.lineTo(l.x2 * hpr, l.y * vpr);
          ctx.stroke();
          if (l.tracejada) ctx.setLineDash([]);
        }

        if (plano.texto !== null) {
          const fontPx = Math.max(9, Math.round(FONT_PX * vpr));
          ctx.font = `${fontPx}px ${FONT_FAMILY}`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          const x = plano.texto.x * hpr;
          const y = plano.texto.y * vpr;
          const w = larguraDoTexto(ctx, plano.texto.texto, fontPx);
          const pad = TEXT_BOX_PAD_PX * Math.min(hpr, vpr);
          desenharCaixaDeTexto(
            ctx,
            x - pad,
            y - pad,
            w + 2 * pad,
            fontPx + 2 * pad,
            scope.bitmapSize.width,
            scope.bitmapSize.height,
          );
          ctx.fillStyle = plano.texto.cor;
          ctx.fillText(plano.texto.texto, x, y);
        }
      } finally {
        ctx.restore();
      }
    });
  }
}

/**
 * O perfil vai ATRÁS das velas (`zOrder: 'bottom'`).
 *
 * ⚠️ Ele é contexto, não leitura pontual: por cima, as barras horizontais cobririam
 * corpo e pavio das velas na faixa lateral, e é justamente ali que fica o preço mais
 * recente — o que o operador menos pode perder de vista. É a mesma escolha do bookmap,
 * pelo mesmo motivo, e o oposto da do footprint (que precisa ser lido sobre a vela).
 */
class VolumeProfilePaneView implements IPrimitivePaneView {
  constructor(
    private readonly renderer_: VolumeProfileRenderer,
    private readonly temConteudo: () => boolean,
  ) {}

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.temConteudo() ? this.renderer_ : null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// A camada
// ═════════════════════════════════════════════════════════════════════════════

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private options: VolumeProfileLayerOptions;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private plano: PlanoDoPerfil = PLANO_VAZIO;

  private readonly views: readonly IPrimitivePaneView[];

  constructor(options: VolumeProfileLayerOptions) {
    this.options = options;
    const renderer = new VolumeProfileRenderer(() => this.plano);
    this.views = [
      new VolumeProfilePaneView(
        renderer,
        () => this.plano.barras.length > 0 || this.plano.texto !== null,
      ),
    ];
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
    this.plano = PLANO_VAZIO;
  }

  /** Dado ou opções novos, sem reanexar. */
  update(options: Partial<VolumeProfileLayerOptions>): void {
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

  /** Diagnóstico: quantas barras e linhas a passada corrente emitiu. */
  estado(): { readonly barras: number; readonly linhas: number; readonly temTexto: boolean } {
    return {
      barras: this.plano.barras.length,
      linhas: this.plano.linhas.length,
      temTexto: this.plano.texto !== null,
    };
  }

  /**
   * Monta o plano a partir do estado atual do gráfico.
   *
   * ⚠️ Fail-safe: QUALQUER falha esvazia o plano em vez de propagar. Camada de
   * visualização não derruba o gráfico — a mesma regra das irmãs.
   */
  private recalcular(): void {
    try {
      const chart = this.chart;
      const series = this.series;
      if (chart === null || series === null) {
        this.plano = PLANO_VAZIO;
        return;
      }

      const pane = chart.paneSize();
      const largura = Number.isFinite(pane.width) && pane.width > 0 ? pane.width : 0;
      const altura = Number.isFinite(pane.height) && pane.height > 0 ? pane.height : 0;
      if (largura <= 0 || altura <= 0) {
        this.plano = PLANO_VAZIO;
        return;
      }

      const perfil = this.options.perfil;
      const paleta = { ...PALETA_PERFIL_DEFAULT, ...(this.options.paleta ?? {}) };
      const comLegenda = this.options.mostrarLegenda !== false;

      // Perfil vazio: a camada DIZ o motivo em vez de ficar idêntica a desligada.
      // "Ligado e sem dado" e "desligado" são estados diferentes.
      if (perfil.niveis.length === 0 || !(perfil.maiorTotal > 0)) {
        this.plano = comLegenda
          ? {
              barras: [],
              linhas: [],
              texto: {
                x: TEXTO_MARGEM_PX,
                y: TEXTO_MARGEM_PX,
                texto: `Perfil de volume: ${perfil.motivoVazio ?? 'sem dado na janela.'}`,
                cor: paleta.texto,
              },
            }
          : PLANO_VAZIO;
        return;
      }

      const faixa = this.faixaDaCamada(chart, largura);
      const alturaUtil = altura * (1 - this.margemInferior());

      const barras: BarraDoPerfil[] = [];
      // Altura de cada barra: o espaçamento entre níveis vizinhos em pixel. Derivada do
      // PRÓPRIO eixo de preço, não de uma divisão da altura pelo número de níveis — a
      // escala pode ser logarítmica, e dividir por igual desalinharia a barra do preço
      // que ela representa.
      const alturaNivel = this.alturaDeNivelPx(perfil);

      for (const nivel of perfil.niveis) {
        const y = series.priceToCoordinate(nivel.preco);
        if (y === null || !Number.isFinite(y)) continue;
        // Fora do ambiente (acima do painel ou dentro da margem inferior): não desenha.
        if (y < 0 || y > alturaUtil) continue;

        const proporcao = nivel.total / perfil.maiorTotal;
        const larguraBarra = Math.max(1, proporcao * faixa.largura);
        const alturaBarra = Math.max(ALTURA_MIN_PX, alturaNivel);
        const yBarra = y - alturaBarra / 2;

        if (this.options.modoCor === 'total') {
          const dentro =
            perfil.val !== null && perfil.vah !== null
              ? nivel.preco >= perfil.val && nivel.preco <= perfil.vah
              : true;
          barras.push({
            x: faixa.sentido === 1 ? faixa.base : faixa.base - larguraBarra,
            y: yBarra,
            largura: larguraBarra,
            altura: alturaBarra,
            cor: dentro ? paleta.dentroDaArea : paleta.foraDaArea,
          });
        } else {
          // ⚠️ Compra e venda EMPILHADAS na mesma barra, na proporção do total — não duas
          // barras concorrentes. A largura total continua comparável entre níveis, que é
          // o que a leitura do perfil exige; o que a divisão acrescenta é de que lado
          // veio o volume daquele preço.
          const totalLados = nivel.compra + nivel.venda;
          const fracCompra = totalLados > 0 ? nivel.compra / totalLados : 0;
          const larguraCompra = larguraBarra * fracCompra;
          const larguraVenda = larguraBarra - larguraCompra;

          if (larguraCompra > 0) {
            barras.push({
              x: faixa.sentido === 1 ? faixa.base : faixa.base - larguraCompra,
              y: yBarra,
              largura: larguraCompra,
              altura: alturaBarra,
              cor: paleta.compra,
            });
          }
          if (larguraVenda > 0) {
            barras.push({
              x:
                faixa.sentido === 1
                  ? faixa.base + larguraCompra
                  : faixa.base - larguraCompra - larguraVenda,
              y: yBarra,
              largura: larguraVenda,
              altura: alturaBarra,
              cor: paleta.venda,
            });
          }
        }
      }

      const linhas: LinhaDoPerfil[] = [];

      // ⭐ POC e área de valor atravessam o painel INTEIRO, não só a faixa.
      //
      // ⚠️ É a decisão que dá utilidade a eles: o POC é um nível de PREÇO, e serve para
      // ler se a vela está acima ou abaixo dele. Um tracinho dentro da faixa lateral
      // seria decoração — a linha atravessando é o que responde a pergunta.
      if (this.options.mostrarPOC !== false && perfil.poc !== null) {
        const y = series.priceToCoordinate(perfil.poc);
        if (y !== null && Number.isFinite(y) && y >= 0 && y <= alturaUtil) {
          linhas.push({ y, x1: 0, x2: largura, cor: paleta.poc, tracejada: false });
        }
      }
      if (this.options.mostrarAreaDeValor !== false) {
        for (const preco of [perfil.vah, perfil.val]) {
          if (preco === null) continue;
          const y = series.priceToCoordinate(preco);
          if (y === null || !Number.isFinite(y) || y < 0 || y > alturaUtil) continue;
          linhas.push({ y, x1: 0, x2: largura, cor: paleta.areaDeValor, tracejada: true });
        }
      }

      this.plano = {
        barras,
        linhas,
        texto: comLegenda ? this.montarLegenda(perfil, paleta) : null,
      };
    } catch {
      this.plano = PLANO_VAZIO;
    }
  }

  /**
   * A faixa em que a camada pode desenhar.
   *
   * `base` é a borda de onde as barras CRESCEM; `sentido` é `+1` (para a direita) ou
   * `-1` (para a esquerda).
   *
   * ⚠️ Na direita, a base é descontada da largura do EIXO DE PREÇO. A camada pergunta ao
   * gráfico em vez de assumir 56 px: o número é do motor, e duplicá-lo aqui criaria uma
   * segunda verdade que envelheceria em silêncio.
   */
  private faixaDaCamada(
    chart: IChartApiBase<Time>,
    larguraPainel: number,
  ): { base: number; largura: number; sentido: 1 | -1 } {
    const fracao = Math.min(
      LARGURA_FRACAO_MAX,
      Math.max(LARGURA_FRACAO_MIN, this.options.larguraFracao ?? LARGURA_FRACAO_DEFAULT),
    );
    const larguraFaixa = larguraPainel * fracao;

    if (this.options.lado === 'esquerda') {
      // Ancorada na borda ESQUERDA, crescendo para a direita — o espelho exato do lado
      // direito. O que ancora não é a faixa, é a BORDA DO PAINEL: a barra de maior volume
      // encosta na borda, e a leitura de "qual nível é o maior" fica no mesmo lugar
      // independentemente do lado escolhido.
      //
      // ⚠️ Não há desconto de eixo aqui: o motor desenha um eixo só, à direita.
      return { base: FOLGA_PX, largura: larguraFaixa, sentido: 1 };
    }

    const larguraEixo = this.larguraDoEixoPx(chart);
    return {
      base: larguraPainel - larguraEixo - FOLGA_PX,
      largura: larguraFaixa,
      sentido: -1,
    };
  }

  /** Largura do eixo de preço, perguntada ao gráfico. `0` quando indisponível. */
  private larguraDoEixoPx(chart: IChartApiBase<Time>): number {
    try {
      const w = chart.priceScale('right').width();
      return Number.isFinite(w) && w > 0 ? w : 0;
    } catch {
      // Gráfico sem escala nomeada (dublê de teste, motor em descarte): sem desconto.
      return 0;
    }
  }

  private margemInferior(): number {
    const m = this.options.margemInferiorFracao ?? 0;
    if (!Number.isFinite(m) || m <= 0) return 0;
    // Recortada a 0,6: reservar mais que isso deixaria o perfil sem altura para existir.
    return Math.min(0.6, m);
  }

  /**
   * Altura de uma barra de nível, em px.
   *
   * Derivada do EIXO: a distância em pixel entre dois níveis vizinhos do perfil. Com um
   * nível só (ou conversão indisponível) cai no piso — uma barra fina é leitura pobre,
   * mas barra nenhuma é leitura ausente.
   */
  private alturaDeNivelPx(perfil: PerfilDeVolume): number {
    const series = this.series;
    if (series === null || perfil.niveis.length < 2) return ALTURA_MIN_PX;
    const a = perfil.niveis[0];
    const b = perfil.niveis[1];
    if (a === undefined || b === undefined) return ALTURA_MIN_PX;
    const ya = series.priceToCoordinate(a.preco);
    const yb = series.priceToCoordinate(b.preco);
    if (ya === null || yb === null) return ALTURA_MIN_PX;
    const d = Math.abs(yb - ya);
    // ⚠️ Menos de 1 px de espaçamento entre níveis: usa o piso e ACEITA a sobreposição.
    // A alternativa (binarizar aqui) mudaria o dado que o consumidor agregou — se ele
    // quer menos linhas, `binarizarPerfil` é dele.
    return Number.isFinite(d) && d > ALTURA_MIN_PX ? d : ALTURA_MIN_PX;
  }

  /** A linha de identidade da camada, no topo da faixa. */
  private montarLegenda(perfil: PerfilDeVolume, paleta: PaletaPerfil): TextoDoPerfil {
    const partes = [`Perfil de volume · ${perfil.niveis.length} níveis`];
    if (perfil.poc !== null) partes.push(`POC ${perfil.poc}`);
    if (perfil.vah !== null && perfil.val !== null) {
      partes.push(`VA ${Math.round(perfil.fracaoAreaDeValor * 100)}% ${perfil.val}–${perfil.vah}`);
    }
    return {
      x: TEXTO_MARGEM_PX,
      // ⚠️ No PÉ do painel, não no topo: o topo à esquerda é da legenda do bookmap e da
      // fita de O/H/L/C da aplicação. Foi a colisão nesse canto que o operador relatou.
      y: Math.max(TEXTO_MARGEM_PX, (this.chart?.paneSize().height ?? 0) - 2 * FONT_PX),
      texto: partes.join(' · '),
      cor: paleta.texto,
    };
  }
}
