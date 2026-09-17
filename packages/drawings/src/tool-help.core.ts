/**
 * tool-help.core — o AUXÍLIO de cada ferramenta, em núcleo puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido: *"ferramentas vivas [...] auxílio"*.
 *
 * A barra já tinha `Tooltip` com nome e "para que serve" — mas o tooltip morre no instante em
 * que o operador tira o cursor do botão, que é exatamente o instante em que ele precisa saber
 * O QUE FAZER AGORA. Escolhida a posição de compra, a pergunta deixa de ser "para que serve" e
 * passa a ser *"clico onde primeiro?"*.
 *
 * ⭐ Então o auxílio aqui é de PASSOS, e ele vive enquanto a ferramenta está armada. Duas
 * ferramentas de duas âncoras não têm o mesmo primeiro passo: no retângulo os dois cantos são
 * simétricos; na posição de compra a PRIMEIRA âncora é a entrada e a SEGUNDA é o stop, e trocar
 * a ordem desenha a operação invertida. Sem dizer isso, o operador descobre errando.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `.core` = PURO, e aqui isso tem uma consequência prática
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Texto entra e sai; nada de DOM. É o que permite o MESMO auxílio aparecer na barra, num painel
 * lateral, num tour de primeiro uso ou na paleta de comandos — sem três cópias do texto que
 * divergem na primeira revisão.
 */
import type { DrawingKind } from './model.js';
import { ANCHORS_REQUIRED } from './model.js';

/** O auxílio de uma ferramenta: o que ela produz e a sequência de gestos. */
export interface AjudaDeFerramenta {
  /** Nome curto, para o título da faixa. */
  readonly nome: string;
  /**
   * Os passos, na ordem. Um item por gesto.
   *
   * ⚠️ Escrito no IMPERATIVO e na segunda pessoa ("clique", "arraste"): é instrução, não
   * descrição. "O primeiro ponto define a entrada" obriga o leitor a traduzir para ação.
   */
  readonly passos: readonly string[];
  /**
   * O que muda o resultado depois de desenhado, quando há algo. `null` = nada a dizer.
   *
   * ⭐ Separado dos passos porque é a informação que o operador procura DEPOIS: ele desenhou,
   * viu, e quer ajustar. Misturar com os passos faz a faixa ficar longa justamente no momento
   * em que ela precisa ser lida de relance.
   */
  readonly ajuste: string | null;
}

const AJUDA: Readonly<Record<DrawingKind, AjudaDeFerramenta>> = Object.freeze({
  TRENDLINE: {
    nome: 'Linha de tendência',
    passos: ['Clique no primeiro ponto (um fundo ou topo).', 'Clique no segundo para fechar a reta.'],
    ajuste: 'Arraste as pontas para reancorar. Com o ímã ligado, elas prendem na máxima ou mínima da barra.',
  },
  RAY: {
    nome: 'Raio',
    passos: ['Clique na origem.', 'Clique num segundo ponto: o raio segue por ali para a frente.'],
    ajuste: 'O passado NÃO é marcado — é a diferença em relação à reta estendida.',
  },
  EXTENDED_LINE: {
    nome: 'Reta estendida',
    passos: ['Clique em dois pontos.', 'A reta continua nos dois sentidos por todo o gráfico.'],
    ajuste: 'Afirma o nível antes e depois dos pontos. Para valer só a partir de agora, use o raio.',
  },
  HORIZONTAL_LINE: {
    nome: 'Linha horizontal',
    passos: ['Um clique no preço. Pronto.'],
    ajuste: 'Vale de ponta a ponta do gráfico, inclusive antes do clique.',
  },
  HORIZONTAL_RAY: {
    nome: 'Raio horizontal',
    passos: ['Clique no preço, no instante em que o nível nasceu.', 'Arraste para a direita e solte.'],
    // ⭐ É a razão de a ferramenta existir, e o operador não adivinha.
    ajuste: 'O nível vale só a partir do ponto marcado: um topo formado às 10h não era resistência às 9h.',
  },
  VERTICAL_LINE: {
    nome: 'Linha vertical',
    passos: ['Um clique no instante (abertura, notícia, leilão).'],
    ajuste: null,
  },
  RECTANGLE: {
    nome: 'Retângulo',
    passos: ['Clique num canto.', 'Arraste até o canto oposto e solte.'],
    ajuste: 'Os dois cantos são simétricos — a ordem não importa aqui.',
  },
  ARROW: {
    nome: 'Seta',
    passos: ['Clique onde a seta começa.', 'Clique onde ela APONTA: a ponta fica no segundo ponto.'],
    ajuste: 'É anotação, não medida. A ponta é feita de dois traços e herda a cor da seta.',
  },
  FIB_RETRACEMENT: {
    nome: 'Retração de Fibonacci',
    passos: [
      'Clique no início do movimento (o fundo, numa alta).',
      'Clique no fim dele (o topo). Os níveis saem ENTRE os dois.',
    ],
    ajuste: 'Invertendo a ordem, os níveis invertem — é o que se faz para medir a correção de uma queda.',
  },
  FIB_EXTENSION: {
    nome: 'Extensão de Fibonacci',
    passos: ['Clique no início do movimento.', 'Clique no fim. Os níveis saem ALÉM dele.'],
    ajuste: 'Responde "até onde o preço pode ir", não "onde a correção para" — para isso use a retração.',
  },
  MEASURE: {
    nome: 'Régua',
    passos: ['Clique no ponto de partida.', 'Arraste até o destino: aparece a variação em preço, em % e em barras.'],
    ajuste: null,
  },
  POSITION_LONG: {
    nome: 'Posição de compra',
    passos: [
      'Clique na ENTRADA.',
      'Arraste até o STOP (abaixo) e solte. O alvo sai no múltiplo de risco.',
    ],
    // ⭐ O número que o operador ajusta é o R:R, e não o alvo — é por isso que a ferramenta tem
    // duas âncoras e não três.
    ajuste: 'O alvo é DERIVADO: mude o múltiplo de risco (2R por default) e ele se move. As zonas são pintadas na proporção.',
  },
  POSITION_SHORT: {
    nome: 'Posição de venda',
    passos: ['Clique na ENTRADA.', 'Arraste até o STOP (acima) e solte.'],
    ajuste: 'Espelho da compra: stop acima, alvo abaixo, e o alvo continua derivado do múltiplo de risco.',
  },
});

/**
 * O auxílio de uma ferramenta, ou `null` para o modo de seleção.
 *
 * ⚠️ `null` (o cursor) NÃO recebe passos, e é decisão: uma faixa de ajuda permanente na tela é
 * ruído quando não há gesto em curso. O auxílio aparece porque uma ferramenta está armada e
 * desaparece quando ela é desarmada — é o que o torna informação e não decoração.
 */
export function ajudaDeFerramenta(kind: DrawingKind | null): AjudaDeFerramenta | null {
  if (kind === null) return null;
  return AJUDA[kind] ?? null;
}

/**
 * Quantos cliques a ferramenta espera. Vem de `ANCHORS_REQUIRED`, a mesma fonte do gesto.
 *
 * ⚠️ Lido do modelo e não escrito à mão aqui: uma ferramenta nova cujo número de âncoras
 * mudasse deixaria o texto do auxílio mentindo, e mentira em texto de ajuda é pior que ausência
 * de ajuda — o operador confia nela.
 */
export function ancorasDaFerramenta(kind: DrawingKind): number {
  return ANCHORS_REQUIRED[kind] ?? 2;
}

/**
 * O auxílio existe para toda ferramenta que a barra oferece?
 *
 * ⭐ Guarda de COMPLETUDE, exportada para a bancada: uma ferramenta acrescentada ao
 * `DrawingKind` sem auxílio passaria silenciosamente, e a faixa simplesmente não apareceria
 * para ela. O teste chama isto com a lista de kinds e reprova se faltar algum.
 */
export function ferramentasSemAjuda(kinds: readonly DrawingKind[]): readonly DrawingKind[] {
  return kinds.filter((k) => AJUDA[k] === undefined);
}
