/**
 * types — o vocabulario que o motor publica.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE UM VOCABULARIO PROPRIO, E NAO OS TIPOS DO SUBSTRATO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Estes tipos existem para que o consumidor descreva o que quer ver sem importar
 * `lightweight-charts`. Na origem isso foi o que permitiu uma pagina de 7.977
 * linhas depender do substrato **apenas por tipo**: ela falava
 * `ChartPriceLine`/`ChartMarker`, e um unico arquivo traduzia para a API real.
 *
 * O ganho nao e purismo. E que o dia em que o substrato mudar a assinatura de
 * `addSeries` — como mudou entre a v4 e a v5 — o que precisa mudar e o tradutor,
 * nao cada tela.
 */

import type { BookmapLayerOptions, FootprintLayerOptions } from '@robustus/charts-primitives';

// ═════════════════════════════════════════════════════════════════════════════
// Velas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Vela OHLC como o motor a recebe.
 *
 * `time` e epoch em **segundos** — a unidade do substrato.
 */
export interface ChartCandle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * Vela utilizavel: tempo FINITO e OHLC finito.
 *
 * ⚠️ **A finitude nao e zelo excessivo — e correcao de um defeito real.** Na
 * origem o teste de tempo era `c.time != null`, e isso deixava `NaN` passar,
 * porque `NaN != null` e `true`. A vela atravessava o filtro, chegava ao
 * renderizador e voltava como `Uncaught Error: Value is null` de dentro da
 * biblioteca — sem dizer QUAL vela. Foi um dos erros que o operador reportou ao
 * trocar de periodo.
 *
 * Por isso o motor filtra na entrada, e nao confia no chamador: dado de mercado
 * chega da rede, e `null` em OHLC e ocorrencia normal, nao excepcional.
 */
export function isValidCandle(c: unknown): c is ChartCandle {
  if (c === null || typeof c !== 'object') return false;
  const v = c as Record<string, unknown>;
  return (
    typeof v.time === 'number' &&
    Number.isFinite(v.time) &&
    typeof v.open === 'number' &&
    Number.isFinite(v.open) &&
    typeof v.high === 'number' &&
    Number.isFinite(v.high) &&
    typeof v.low === 'number' &&
    Number.isFinite(v.low) &&
    typeof v.close === 'number' &&
    Number.isFinite(v.close)
  );
}

/** Barra de histograma (volume), com cor por barra. */
export interface ChartHistogramBar {
  readonly time: number;
  readonly value: number;
  readonly color?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Sobreposicoes declarativas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Linha horizontal de preco.
 *
 * Serve Fibonacci, area de valor, ajuste, alvo e stop — tudo que e "um preco que
 * importa".
 */
export interface ChartPriceLine {
  readonly price: number;
  readonly color: string;
  /** `0` solida, `1` pontilhada, `2` tracejada, `3` tracejado longo, `4` ponto esparso. */
  readonly lineStyle?: 0 | 1 | 2 | 3 | 4;
  readonly lineWidth?: 1 | 2 | 3 | 4;
  readonly axisLabelVisible?: boolean;
  readonly title?: string;
}

/** Serie de linha sobre o grafico. */
export interface ChartLineSeries {
  readonly data: ReadonlyArray<{ readonly time: number; readonly value: number }>;
  readonly color: string;
  readonly lineWidth?: 1 | 2 | 3 | 4;
  readonly title?: string;
  /**
   * Escala de preco propria.
   *
   * Informar um id diferente de `'right'` cria uma escala de OVERLAY, que e como
   * a origem desenha delta cumulativo junto do preco sem que uma grandeza
   * esmague a outra.
   *
   * ⚠️ Isto NAO e um sub-painel de verdade. Sub-painel exige a API de `pane` do
   * substrato, que a origem nunca usou — ela empurrava a serie para uma faixa do
   * MESMO painel com `scaleMargins`. Para RSI ou MACD embaixo do preco, escala de
   * overlay e aproximacao, nao solucao.
   */
  readonly priceScaleId?: string;
}

/** Marcador pontual ancorado num instante. */
export interface ChartMarker {
  readonly time: number;
  readonly position: 'aboveBar' | 'belowBar' | 'inBar';
  readonly color: string;
  readonly shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  readonly text?: string;
  readonly size?: number;
  /**
   * Identificador livre do consumidor.
   *
   * ⚠️ Existe porque **o substrato nao tem clique nativo em marcador**. Quem
   * precisa reagir ao clique resolve pelo instante mais proximo dentro de uma
   * tolerancia, e usa este campo para saber o que foi clicado. E contorno, e
   * declarado como tal.
   */
  readonly id?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Coordenadas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Conversores de coordenada NATIVOS do grafico.
 *
 * ⭐ Este e o tipo mais importante do pacote, e a razao e especifica: e ele que
 * permite sobreposicao em HTML ou SVG se alinhar ao eixo REAL, respeitando zoom,
 * pan e as margens da escala de preco.
 *
 * A alternativa que parece obvia — calcular `(max - preco) / faixa * altura` —
 * **ignora as margens da escala** e desalinha tudo por uma faixa fixa do topo e
 * da base. Na origem isso foi descoberto depois de varias sobreposicoes
 * desenhadas assim.
 *
 * Os dois primeiros metodos devolvem `null` quando a conversao nao e possivel
 * (grafico nao montado, valor fora da escala corrente). `null` significa "fora de
 * vista": o consumidor pula o desenho daquele elemento, nao desenha em zero.
 */
export interface ChartCoordinateMapper {
  /** Preco -> Y em px, relativo ao topo do painel. */
  priceToY(price: number): number | null;
  /** Instante em epoch MILISSEGUNDOS -> X em px. */
  timeToX(timestampMs: number): number | null;
  /**
   * Janela de tempo visivel, em epoch SEGUNDOS.
   *
   * Serve a quem agrega por regiao visivel — perfil de volume no escopo da
   * janela, por exemplo. Sem isto, um perfil so consegue agregar o dia inteiro e
   * o histograma nao muda ao dar zoom, o que contradiz o proposito dele.
   */
  visibleTimeRangeSec(): { readonly fromSec: number; readonly toSec: number } | null;
  /**
   * Largura da escala de preco a DIREITA, em px.
   *
   * ⚠️ **Existe porque o container do grafico NAO e a area de plotagem.** O
   * elemento medido por `getBoundingClientRect` inclui a escala de preco, entao
   * uma sobreposicao ancorada em `right: 0` cai exatamente SOBRE os precos e
   * sobre os rotulos das linhas.
   *
   * Na origem isso foi reportado quatro vezes sobre o perfil de volume. As tres
   * primeiras foram tratadas como problema de POSICAO, com um afastamento em px
   * — um numero arbitrario que so empurrava o histograma para um ponto qualquer.
   * O pedido era outro: a ancora correta, que e
   * `larguraDoContainer − larguraDaEscala`.
   *
   * `0` quando a escala esta invisivel e o proprio contrato do substrato.
   */
  priceScaleWidthPx(): number | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Camadas de canvas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Teto de celulas desenhadas por passada da camada de livro.
 *
 * Vive no motor, e nao na camada, porque o construtor da camada **exige** os dois
 * campos de orcamento. Nao ter default interno e o que impede uma tela herdar um
 * teto que ninguem escolheu; ter o default AQUI e o que evita cada tela inventar
 * o seu.
 */
export const BOOKMAP_MAX_CELLS_DEFAULT = 3000;

/**
 * Dimensao minima de celula, em pixels, antes de a camada agrupar.
 *
 * ⚠️ **2, e nao 3.** O numero entra em `ceil(minPx / pixelsPorUnidade)` e decide
 * o fator de agrupamento nos DOIS eixos. Com 3, a altura minima subia acima do
 * padrao do proprio nucleo, e cada ponto a mais engrossa o bloco no eixo do
 * preco — na origem o operador descreveu o resultado como *"nosso bookmap esta
 * parecendo um lego"*.
 *
 * **Nao desce a 1:** o antialias do canvas comeca a apagar a celula de 1 px, e
 * celula que desaparece e pior que celula grossa — a parede fina e justamente a
 * que interessa quando o preco se aproxima dela.
 */
export const BOOKMAP_MIN_CELL_PX_DEFAULT = 2;

/**
 * Camada de livro como o consumidor a informa: orcamento OPCIONAL.
 *
 * Os demais campos seguem obrigatorios de proposito. `grid`, `metrica`, `escala`
 * e `tickSize` descrevem o que desenhar, e adivinha-los aqui criaria uma segunda
 * verdade sobre dado que so o consumidor tem.
 *
 * ⚠️ `tickSize` **chega por parametro** e nao e derivado das velas. Derivar
 * produziria um valor divergente do que o consumidor usa nos demais calculos,
 * exatamente no insumo que define a altura de cada celula.
 *
 * O tipo e derivado de `BookmapLayerOptions` em vez de redeclarado, para que
 * `metrica` e `escala` continuem com um unico dominio admitido.
 */
export type BookmapLayerInput = Omit<BookmapLayerOptions, 'maxCells' | 'minCellPx'> &
  Partial<Pick<BookmapLayerOptions, 'maxCells' | 'minCellPx'>>;

/** Camada de footprint como o consumidor a informa. */
export type FootprintLayerInput = FootprintLayerOptions;
