/**
 * bookmap-lateral.core — o PERFIL LATERAL do bookmap. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO É, E POR QUE FALTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O heatmap responde *"como a liquidez se distribuiu no TEMPO"*. A pergunta que ele não
 * responde é a que o operador faz no instante da ordem: *"quanto tem em cada preço AGORA"*.
 *
 * Num heatmap, ler isso significa olhar a coluna mais à direita e comparar intensidades de cor
 * — e cor é a pior régua que existe para quantidade. Dezesseis níveis de opacidade não dizem se
 * uma célula tem o dobro da outra; dizem apenas que uma é mais forte. A escada lateral troca
 * essa comparação por COMPRIMENTO, que o olho mede bem.
 *
 * É o elemento mais reconhecível de um bookmap comercial, e era o que faltava aqui.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ AS TRÊS DECISÕES QUE MUDAM O SIGNIFICADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. "Agora" é a última coluna VISÍVEL, não a última do dia.** As células que entram aqui já
 * foram recortadas à janela; então com o gráfico rolado para trás a escada mostra o livro do
 * instante que está na borda direita da TELA. É o comportamento certo: a escada tem de descrever
 * o que o operador está olhando, senão ela contradiz o heatmap ao lado dela. Mesma disciplina da
 * escala de cor, que também é da janela visível.
 *
 * **2. A grandeza é a MESMA que o heatmap está pintando.** Uma escada de fila ao lado de um mapa
 * de execução seriam duas afirmações sobre coisas diferentes no mesmo pixel de altura, e o
 * operador leria uma como se fosse a outra. Quem escolhe é o chamador, pela `grandeza`.
 *
 * ⚠️ Com dado antigo da mesa, `bid`/`ask` vêm vazios (o livro não foi gravado) e a escada de
 * `FILA` fica vazia — o que é a verdade sobre o dado, não defeito da camada. Em `EXECUCAO` ela
 * funciona no histórico inteiro, e é por isso que a grandeza é parâmetro e não constante.
 *
 * **3. Os dois lados compartilham o MÁXIMO que normaliza o comprimento.** Se cada lado tivesse o
 * próprio, uma fila de 800 no bid e outra de 80 no ask sairiam com barras de comprimento parecido
 * — a comparação que o operador faz de relance passaria a ser inválida. É literalmente o mesmo
 * argumento que faz `computeColorScalePair` pôr os dois lados na mesma amostra.
 */

import type { AggregatedCells } from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Tipos
// ═════════════════════════════════════════════════════════════════════════════

/** Qual par de colunas alimenta a escada. */
export type GrandezaLateral =
  /** `bid`/`ask` — fila em repouso. O livro propriamente dito. */
  | 'FILA'
  /** `buy`/`sell` — volume por agressor. Funciona onde o livro não foi gravado. */
  | 'EXECUCAO';

/**
 * De onde a escada tira os números.
 *
 * ⭐ As duas respondem perguntas diferentes, e as duas são legítimas:
 *
 * - `ULTIMA_COLUNA` = *"quanto tem em cada preço agora"*. É o livro instantâneo, o elemento
 *   clássico do bookmap.
 * - `JANELA` = *"onde a liquidez se concentrou no período que estou olhando"*. É um perfil de
 *   volume por preço, derivado do livro em vez das velas — e ele sobrevive à coluna mais recente
 *   estar vazia, que acontece a todo momento em pregão devagar.
 */
export type EscopoLateral = 'ULTIMA_COLUNA' | 'JANELA';

/** Um nível de preço da escada. */
export interface NivelLateral {
  /** Centro do grupo de ticks — a mesma convenção de `AggregatedCell.preco`. */
  readonly preco: number;
  /** Quantidade do lado de compra. Zero significa ausência, nunca "pouco". */
  readonly compra: number;
  /** Quantidade do lado de venda. */
  readonly venda: number;
}

/** A escada pronta para virar barras. */
export interface PerfilLateral {
  /**
   * Instante da coluna usada, epoch ms — ou `null` no escopo `JANELA`.
   *
   * ⭐ Sai daqui para a legenda poder dizer DE QUANDO é a escada. Sem isso, num pregão devagar o
   * operador veria uma escada parada e concluiria que a camada travou, quando o que aconteceu é
   * que a última coluna com liquidez é de dez minutos atrás.
   */
  readonly tsMs: number | null;
  /** Os níveis, em ordem CRESCENTE de preço. Ordem determinística, para o teste e para o olho. */
  readonly niveis: readonly NivelLateral[];
  /**
   * Maior quantidade entre TODOS os níveis e os DOIS lados — o denominador do comprimento.
   *
   * ⚠️ Compartilhado de propósito. Ver a decisão 3 no cabeçalho.
   */
  readonly maximo: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// A função
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Deriva a escada lateral das células já agregadas e recortadas à janela.
 *
 * Pura, determinística, sem alocação por célula (um `Map` por chamada, e a chamada acontece uma
 * vez por reconstrução de plano, não por quadro de desenho).
 *
 * @param cells    saída da agregação por zoom. `count` é a verdade, não `length`.
 * @param grandeza qual par de colunas usar. Ver `GrandezaLateral`.
 * @param escopo   última coluna ou janela inteira. Ausente ⇒ `'ULTIMA_COLUNA'`.
 *
 * @returns `null` quando não há nível algum com quantidade positiva — que é resposta legítima e
 *   frequente (livro não gravado, pregão sem negócio na janela). Nunca lança, nunca devolve
 *   `NaN`, e `maximo > 0` sempre que devolve algo.
 */
export function perfilLateralDoBookmap(
  cells: AggregatedCells,
  grandeza: GrandezaLateral,
  escopo: EscopoLateral = 'ULTIMA_COLUNA',
): PerfilLateral | null {
  // Célula ausente e `count` inválido caem no mesmo lugar: escada vazia em vez de exceção. Esta
  // função é chamada dentro da construção do plano, onde `throw` é proibido.
  const n = sanitizeCount(cells);
  if (n === 0) return null;

  const colCompra = grandeza === 'EXECUCAO' ? cells.buy : cells.bid;
  const colVenda = grandeza === 'EXECUCAO' ? cells.sell : cells.ask;
  if (colCompra === undefined || colVenda === undefined) return null;

  // ── passada 1: qual coluna de tempo interessa ──
  //
  // ⚠️ A última coluna é a de maior `tsMs` **com quantidade positiva**, e não simplesmente a de
  // maior `tsMs`. Sem esse filtro, uma coluna final de zeros (pregão devagar, ou o balde em
  // formação que ainda não recebeu nada) produziria escada vazia e o operador leria "não há
  // liquidez" onde a verdade é "não houve nada NESTE minuto". A escada recua até o último minuto
  // que tem algo a dizer, e a legenda diz de quando ela é.
  let tsAlvo = Number.NEGATIVE_INFINITY;
  if (escopo === 'ULTIMA_COLUNA') {
    for (let k = 0; k < n; k += 1) {
      const q = (colCompra[k] ?? 0) + (colVenda[k] ?? 0);
      if (!(q > 0)) continue;
      const ts = cells.tsMs[k] ?? Number.NaN;
      if (Number.isFinite(ts) && ts > tsAlvo) tsAlvo = ts;
    }
    if (!Number.isFinite(tsAlvo)) return null;
  }

  // ── passada 2: acumula por preço ──
  //
  // `Map` e não array indexado por tick: os preços vêm do eixo do payload, já agrupados por zoom,
  // e derivar um índice deles exigiria reconstruir `tickSize × fatorPreco` aqui — duplicando uma
  // conta que vive na geometria. A chave é o número do preço, que é exato (vem de `Float64Array`).
  const porPreco = new Map<number, { compra: number; venda: number }>();
  let maximo = 0;

  for (let k = 0; k < n; k += 1) {
    if (escopo === 'ULTIMA_COLUNA' && (cells.tsMs[k] ?? Number.NaN) !== tsAlvo) continue;

    const preco = cells.preco[k] ?? Number.NaN;
    if (!Number.isFinite(preco)) continue;

    const compra = positivoOuZero(colCompra[k]);
    const venda = positivoOuZero(colVenda[k]);
    if (compra === 0 && venda === 0) continue;

    const atual = porPreco.get(preco);
    if (atual === undefined) {
      porPreco.set(preco, { compra, venda });
    } else {
      // ⚠️ SOMA no escopo de janela, e a soma é o operador certo aqui mesmo para a fila — que na
      // agregação por zoom é combinada por `max`. Não é contradição: `max` responde "qual foi o
      // pico neste balde" e é o que preserva a parede; somar ao longo do TEMPO responde "quanto
      // passou por este preço no período", que é a pergunta do escopo `JANELA`. Usar `max`
      // também aqui daria a maior parede do período, e aí o perfil seria uma cópia do heatmap
      // em outra forma em vez de informação nova.
      atual.compra += compra;
      atual.venda += venda;
    }
  }

  if (porPreco.size === 0) return null;

  const niveis: NivelLateral[] = [];
  for (const [preco, v] of porPreco) {
    niveis.push({ preco, compra: v.compra, venda: v.venda });
    if (v.compra > maximo) maximo = v.compra;
    if (v.venda > maximo) maximo = v.venda;
  }
  // Ordem crescente de preço: determinismo para a bancada, e ordem natural para quem inspeciona
  // a saída. A pintura não depende dela (cada nível tem o próprio `y`), mas saída de núcleo puro
  // que depende da ordem de iteração de um `Map` é armadilha para o próximo teste.
  niveis.sort((a, b) => a.preco - b.preco);

  // `maximo` não positivo só aconteceria com todos os níveis em zero, e esses já foram
  // descartados. A guarda existe para o contrato "`maximo > 0` sempre que devolve algo" ser
  // verdade por construção, e não por raciocínio.
  if (!(maximo > 0)) return null;

  return { tsMs: escopo === 'ULTIMA_COLUNA' ? tsAlvo : null, niveis, maximo };
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/** Quantas posições das colunas valem. `count` é a verdade, `length` é capacidade. */
function sanitizeCount(cells: AggregatedCells): number {
  if (cells === null || cells === undefined) return 0;
  const bruto = cells.count;
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  const truncado = Math.floor(bruto);
  const menorColuna = Math.min(
    cells.tsMs?.length ?? 0,
    cells.preco?.length ?? 0,
    cells.bid?.length ?? 0,
    cells.ask?.length ?? 0,
    cells.buy?.length ?? 0,
    cells.sell?.length ?? 0,
  );
  return Math.min(truncado, menorColuna);
}

/** Quantidade utilizável: não finita ou negativa vira zero, nunca `NaN` adiante. */
function positivoOuZero(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
