/**
 * Property 6 — Idempotência com fator unitário. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.4.
 *
 * ```
 * ∀ grid, window:
 *     aggregateForZoom(grid, window, {maxCells: ∞, minCellPx: 0})
 *       ≡ recorte(grid, window)
 * ```
 *
 * **Validates: Requirements 3.4**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As Properties 4 e 5 cuidam do caso em que há agrupamento: a parede sobrevive
 * ao `max`, o total negociado sobrevive ao `sum`. Esta cuida do caso oposto e
 * mais fácil de estragar sem ninguém notar — **quando não há nada a agrupar**.
 *
 * É o caso do zoom aproximado, que é onde o operador passa a maior parte do
 * tempo e é a única escala em que ele consegue conferir o que vê contra o
 * terminal. Se a agregação deslocar meio balde, arredondar o preço para o centro
 * de um grupo que não existe, reordenar por empate ou perder a célula cujos
 * quatro valores são zero, o defeito aparece exatamente aqui — e as duas
 * propriedades irmãs continuariam verdes, porque `max` de um membro é o próprio
 * membro e `sum` de um membro também.
 *
 * O critério 3.4 é literal quanto ao que "não agrupar" significa: **uma célula
 * por par (balde, preço) existente na janela, com os quatro valores idênticos aos
 * da célula de entrada, e nenhuma célula cujo par não exista na entrada.** Não é
 * "aproximadamente o recorte": é o recorte.
 *
 * ── A FORMA DE PONTO FIXO, E POR QUE ELA É MAIS FORTE ─────────────────────
 *
 * "Equivale ao recorte" é comparação contra uma referência que este arquivo
 * escreve. Isso deixa uma brecha: referência e implementação podem estar
 * igualmente erradas se a referência tiver sido copiada da implementação.
 *
 * A segunda forma fecha essa brecha sem depender de referência alguma. Com fator
 * unitário a agregação tem de ser **idempotente**: reerguer a saída a grid e
 * agregar de novo, com a mesma janela e o mesmo orçamento, tem de devolver
 * exatamente a mesma coisa.
 *
 *     agregar(agregar(grid)) ≡ agregar(grid)
 *
 * Isso é verificável sem juiz externo, e reprova defeitos que a comparação com
 * referência poderia deixar passar: deslocamento sistemático do instante (a
 * segunda passada deslocaria de novo), centro de grupo calculado sobre intervalo
 * que degenerou num ponto, reordenação dependente da ordem de inserção no mapa
 * de grupos, e perda de célula na fronteira da janela.
 *
 * As duas formas estão afirmadas. A idempotência é a que dá nome à propriedade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO O ENUNCIADO FOI TORNADO PRECISO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **`{maxCells: ∞, minCellPx: 0}` do enunciado NÃO produz fator unitário por
 * si só**, e isto não é detalhe de implementação — é o critério 3.1 e o 3.8
 * agindo como escritos. `∞` não é inteiro finito, então o orçamento adotado é o
 * padrão de 3.000; `0` não é positivo, então as dimensões mínimas adotadas são as
 * padrão do eixo, **3 px de largura e 2 px de altura**. Uma janela que declare
 * 570 baldes visíveis em 800 px tem 1,4 px por balde e agrupa de 3 em 3 — com
 * exatamente aquele orçamento do enunciado.
 *
 * O antecedente correto é o do critério 3.4: **os dois fatores iguais a 1**. Isso
 * acontece quando a janela dá ao menos a dimensão mínima a cada célula, e quando
 * o número de pares distintos cabe no orçamento. Este arquivo **constrói** o
 * cenário para que isso valha — dimensionando o viewport a partir do grid e da
 * dimensão mínima efetiva — e **afirma que os dois fatores saíram 1** em toda
 * execução. Sem essa asserção, um cenário que caísse em fator 2 tornaria o
 * arquivo inteiro vacuamente verdadeiro e nada indicaria isso.
 *
 * Um teste concreto ao fim do arquivo demonstra as duas metades disso: com o
 * orçamento literal do enunciado e viewport estreito o fator é 3; com o mesmo
 * orçamento e viewport folgado o fator é 1 e a idempotência vale.
 *
 * ── COMPARAÇÃO EXATA, SEM TOLERÂNCIA ──────────────────────────────────────
 *
 * Nada de `toBeCloseTo` aqui, e é uma escolha justificada. Com fator unitário
 * **não há aritmética**: nenhum máximo a escolher entre membros, nenhuma soma a
 * acumular. Cada valor atravessa o agrupamento por cópia, entre duas colunas de
 * precisão simples. Tolerância admitiria erro que não pode existir e enfraqueceria
 * a propriedade justamente onde ela é mais afiada.
 *
 * A Property 5 precisa de tolerância relativa porque lá há soma de vários membros;
 * aqui, não.
 *
 * ── PAR REPETIDO NA ENTRADA ───────────────────────────────────────────────
 *
 * O critério 3.4 fala de "a célula de entrada correspondente", no singular, o que
 * pressupõe par único — e é a invariante do payload real, cujos eixos são
 * deduplicados e cujas células não repetem par (é o que a Property 9 afirma).
 *
 * Ainda assim o gerador produz par repetido em parte dos casos, porque nada no
 * **tipo** o proíbe, e o comportamento definido é o das Properties 4 e 5: fila por
 * `max`, execução por `sum`. A referência deste arquivo implementa essa
 * generalização, e uma propriedade separada afirma a forma literal do critério —
 * valor por valor, contra a célula de entrada — restrita aos grids sem repetição,
 * que são os de produção.
 *
 * ⚠️ A idempotência é **insensível** a isso: a primeira passada já entrega pares
 * únicos, então a segunda não tem o que combinar. Vale nos dois casos.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETALHES DA IMPLEMENTAÇÃO QUE O TESTE RESPEITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - **`count` é a verdade, não `length`.** As colunas podem ser alocadas com
 *   capacidade maior que o preenchido, e ler além disso devolve zeros que a tela
 *   apresentaria como liquidez ausente. Todo laço para em `count`, o reerguimento
 *   a grid recorta em `count`, e uma asserção afirma `count ≤ length` em cada uma
 *   das seis colunas.
 * - **`tsMs` é a borda ESQUERDA do grupo de baldes e `preco` o CENTRO do grupo de
 *   ticks.** Com fator unitário o grupo degenera num ponto, então a borda e o
 *   centro coincidem com o valor de eixo da própria célula — e é exatamente essa
 *   coincidência que a idempotência cobra. Um centro calculado com intervalo
 *   aberto, ou uma borda tomada do próximo balde, quebraria a segunda passada.
 * - **Valor não finito ou negativo conta como zero** (critério 3.10), e a
 *   sanitização é **por campo**. Os geradores produzem `NaN`, ±infinito,
 *   negativo, `-0`, subnormal e os extremos que não sobrevivem à precisão
 *   simples.
 * - **Célula com os quatro valores em zero NÃO é descartada.** É a diferença
 *   entre esta propriedade e o round-trip colunar da Property 9, onde a omissão é
 *   intencional: ali "ausência significa zero" na REDE; aqui a entrada já existe
 *   e filtrá-la quebraria a contagem de uma célula por par.
 * - **Limites da janela inclusive nos dois lados**, como o recorte é definido.
 * - **Eixos estritamente crescentes** no grid gerado e no grid reerguido — a
 *   invariante 3 do tipo. O reerguimento a confere, para que um par repetido
 *   escapado não faça a segunda passada medir outra coisa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de render
 * e a biblioteca de teste. Aquele módulo é só reexportação, e o fechamento
 * transitivo dos irmãos que ele reexporta alcança um único utilitário de
 * formatação de horário — que não importa nada. Logo não existe caminho daqui até
 * camada de roteamento de conexão, feed de cotação, envio de ordem ou estado de
 * posição, e nada aqui carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Todo insumo é sintetizado pelos geradores, em memória. Nada é lido de rede, de
 * banco ou do sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma
 * escrita acontece em nenhuma tabela, e nenhum evento de decisão é emitido.
 * Nenhuma função aqui consulta relógio ou gerador pseudoaleatório do ambiente: a
 * aleatoriedade toda vem da semente fixa da biblioteca de propriedades.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a verificação de
 * independência inspeciona **integralmente** todo arquivo criado por esta
 * feature, teste incluído, e uma citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COBERTURA AFERIDA DOS GERADORES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medida em 500 casos com semente 42, e **verificada por asserção** — não só
 * anotada aqui. As duas propriedades da seção de guarda contam estas frações e
 * reprovam se qualquer uma colapsar, porque um gerador que deixa de exercitar o
 * recorte não faz o teste falhar: faz o teste virar tautologia e continuar verde.
 * Na mesma seção, uma terceira propriedade confere o **comparador** deste arquivo
 * contra corrupções deliberadas — ele é o gargalo por onde todas as igualdades
 * passam, e um comparador complacente esvaziaria a suíte inteira em silêncio.
 *
 * | condição exercitada                                  | 1ª versão | atual  |
 * |------------------------------------------------------|-----------|--------|
 * | fator unitário nos DOIS eixos                        | **97,2%** | 100,0% |
 * | janela com ao menos uma célula                       |    —      |  91,0% |
 * | recorte exclui ao menos uma célula da entrada        |    —      |  77,4% |
 * | empate de instante na saída (mesmo balde, 2+ preços) | **20,4%** |  57,6% |
 * | par repetido na entrada, combinado por max/sum       |    —      |  63,2% |
 * | ao menos um valor hostil dentro da janela            |    —      |  81,4% |
 * | célula com os quatro valores em zero na janela       |  **4,0%** |  36,6% |
 * | dimensão mínima adotada por padrão (3 px × 2 px)     |    —      |  41,8% |
 * | dimensão mínima sobrescrita e restringida            |    —      |  58,2% |
 * | (gerador sem repetição) janela com ao menos 1 célula |    —      |  89,4% |
 *
 * As três linhas em negrito são os defeitos que a aferição encontrou **no
 * gerador**, e cada um está anotado no respectivo trecho:
 *
 * 1. **Fator unitário em 97,2%**, quando o antecedente da propriedade exige 100%.
 *    Causa: `-7` na lista de orçamentos "não inteiros". Ele é inteiro, é aceito e
 *    restringido ao piso de uma célula — o orçamento se esgotava e o núcleo dobrava
 *    a dimensão mínima doze vezes. Catorze execuções ficavam fora da hipótese.
 * 2. **Empate de instante em 20,4%.** O gerador de arranjo da biblioteca enviesa
 *    para arranjo curto, e o eixo de tempo ia a 48 baldes: meia célula por balde,
 *    quase nenhum empate, e a cláusula de desempate por preço do critério 3.7
 *    praticamente não era lida.
 * 3. **Célula toda-zero em 4,0%.** Quatro valores independentes caírem todos em
 *    zero tem probabilidade da ordem de 0,3% por célula. Um filtro de zeros
 *    passaria por aqui sem ser notado — e as Properties 4 e 5 também não o veriam,
 *    porque `max` e `sum` de zeros continuam zero.
 *
 * Os pisos afirmados são folgados em relação ao medido, de propósito: servem para
 * detectar colapso, não para fixar a distribuição corrente.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { aggregateForZoom, aggregateForZoomWithOutcome } from '@robustus/charts-core';
import type { AggregatedCells, BookmapGrid, VisibleWindow } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso acontece aqui: este
 * projeto já errou conversão em ±3 h somando deslocamento à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** O único tamanho de balde materializado. */
const BALDE_MS = 60_000;

/** Miolo do índice e o incremento mínimo do ativo de referência. */
const PRECO_BASE = 177_000;
const TICK = 5;

/**
 * Dimensões mínimas padrão por eixo (critério 3.8). São diferentes entre si de
 * propósito, e é por isso que o dimensionamento do viewport neste arquivo trata
 * os dois eixos separadamente em vez de usar um número só.
 */
const DEFAULT_MIN_WIDTH_PX = 3;
const DEFAULT_MIN_HEIGHT_PX = 2;

/** Intervalo admitido da dimensão mínima de célula (critério 3.8). */
const MIN_CELL_PX_FLOOR = 1;
const MIN_CELL_PX_CEIL = 64;

/** Orçamento adotado quando o recebido não é inteiro finito (critério 3.1). */
const DEFAULT_MAX_CELLS = 3_000;

/**
 * Teto de células por grid gerado.
 *
 * Todo orçamento sorteado neste arquivo é maior ou igual a este número, o que
 * mantém o agrupamento fora do caminho de repetição por estouro — que é assunto
 * da Property 7, e cuja saída vazia deliberada não tem recorte a comparar. O
 * `budgetExhausted` é afirmado como falso, de modo que a garantia é verificada e
 * não suposta.
 */
const MAX_CELULAS_GERADAS = 300;

/** A parede real medida dentro da banda de ±2.000 pts do miolo. */
const PAREDE_CT = 2_442;

// ═════════════════════════════════════════════════════════════════════════════
// Construção de grid sintético
// ═════════════════════════════════════════════════════════════════════════════

/** Uma célula candidata, antes de virar coluna. */
interface CelulaSintetica {
  readonly ti: number;
  readonly pi: number;
  readonly bid: number;
  readonly ask: number;
  readonly buy: number;
  readonly sell: number;
}

/**
 * Monta um `BookmapGrid` válido a partir dos tamanhos de eixo e das células.
 *
 * Os eixos são estritamente crescentes por construção, e as colunas de valor são
 * de precisão simples como em produção — é isso que torna a comparação por
 * igualdade estrita legítima adiante: a quantidade lida de volta do grid **é** a
 * quantidade que o agrupamento vê, sem arredondamento intermediário.
 *
 * O eixo de tempo é de precisão dupla por necessidade: epoch ms na ordem de
 * 1,79 × 10¹² não cabe na mantissa de 24 bits de um número de precisão simples, e
 * o instante seria arredondado para múltiplos de ~131 s — baldes distintos
 * colidiriam e a idempotência mediria outra coisa.
 */
function construirGrid(
  nBaldes: number,
  nPrecos: number,
  celulas: readonly CelulaSintetica[],
): BookmapGrid {
  const times = new Float64Array(nBaldes);
  for (let i = 0; i < nBaldes; i += 1) times[i] = ABERTURA_MS + i * BALDE_MS;

  const prices = new Float64Array(nPrecos);
  for (let j = 0; j < nPrecos; j += 1) prices[j] = PRECO_BASE + j * TICK;

  const n = celulas.length;
  const ti = new Uint32Array(n);
  const pi = new Uint32Array(n);
  const bid = new Float32Array(n);
  const ask = new Float32Array(n);
  const buy = new Float32Array(n);
  const sell = new Float32Array(n);

  for (let k = 0; k < n; k += 1) {
    const celula = celulas[k];
    if (celula === undefined) continue;
    ti[k] = celula.ti;
    pi[k] = celula.pi;
    bid[k] = celula.bid;
    ask[k] = celula.ask;
    buy[k] = celula.buy;
    sell[k] = celula.sell;
  }

  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-28',
    baldeSeg: BALDE_MS / 1_000,
    times,
    prices,
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    cobertura: null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Os critérios, na forma executável — escritos do requisito, não da implementação
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Critério 3.10: valor de entrada que não seja número finito maior ou igual a
 * zero conta como zero.
 *
 * `Math.max(0, …)` devolve zero positivo mesmo para zero negativo, e é o que
 * torna a comparação estrita segura adiante — `Object.is(0, -0)` é falso.
 */
function sanitizar(valor: number | undefined): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 0;
  return Math.max(0, valor);
}

/**
 * Critério 3.8: as dimensões mínimas efetivas de cada eixo.
 *
 * Dimensão positiva e finita é sobrescrita deliberada e vale para **os dois**
 * eixos, restringida a `[1 px, 64 px]`. Não utilizável ⇒ padrões por eixo, que
 * são **diferentes entre si** (3 px de largura, 2 px de altura).
 */
function dimensoesMinimasEfetivas(minCellPx: number): { larguraPx: number; alturaPx: number } {
  if (Number.isFinite(minCellPx) && minCellPx > 0) {
    const restrito = Math.min(MIN_CELL_PX_CEIL, Math.max(MIN_CELL_PX_FLOOR, minCellPx));
    return { larguraPx: restrito, alturaPx: restrito };
  }
  return { larguraPx: DEFAULT_MIN_WIDTH_PX, alturaPx: DEFAULT_MIN_HEIGHT_PX };
}

/**
 * Critério 3.9: a janela é utilizável?
 *
 * `!(x > 0)` cobre zero, negativo e indefinido numa comparação só; a checagem de
 * finitude que vem depois recolhe o infinito positivo, que passaria pela
 * primeira.
 *
 * ⚠️ Existe aqui porque afirmar o fator unitário **não** prova que a janela era
 * utilizável: janela recusada também devolve fatores 1 e 1, com zero células. Sem
 * esta função, um defeito no dimensionamento do viewport apareceria como "fator
 * unitário, saída vazia" e passaria por sucesso.
 */
function janelaUtilizavel(visible: VisibleWindow): boolean {
  if (!(visible.larguraPx > 0) || !(visible.alturaPx > 0)) return false;
  if (!Number.isFinite(visible.larguraPx) || !Number.isFinite(visible.alturaPx)) return false;
  if (!Number.isFinite(visible.tsDe) || !Number.isFinite(visible.tsAte)) return false;
  if (!Number.isFinite(visible.precoDe) || !Number.isFinite(visible.precoAte)) return false;
  if (visible.tsDe > visible.tsAte) return false;
  if (visible.precoDe > visible.precoAte) return false;
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// A referência — `recorte(grid, window)`, o lado direito do enunciado
// ═════════════════════════════════════════════════════════════════════════════

/** Uma célula do recorte, já com os valores sanitizados e combinados. */
interface CelulaDoRecorte {
  readonly tsMs: number;
  readonly preco: number;
  /** Índice no eixo de tempo — usado só para conferir a ordenação da referência. */
  readonly ti: number;
  readonly pi: number;
  bid: number;
  ask: number;
  buy: number;
  sell: number;
  /** Quantas células de entrada foram combinadas neste par. */
  membros: number;
}

/** O recorte da janela, mais os números que as guardas de vacuidade medem. */
interface Recorte {
  /** Uma por par distinto, ordenada por instante crescente e preço crescente. */
  readonly celulas: readonly CelulaDoRecorte[];
  /** Células de entrada que caíram dentro da janela, antes de combinar pares. */
  readonly celulasNaJanela: number;
  /** Células de entrada excluídas — fora dos limites ou com índice inválido. */
  readonly celulasExcluidas: number;
  /** Algum par apareceu mais de uma vez na entrada? */
  readonly houveParRepetido: boolean;
  /** Algum valor de entrada dentro da janela precisou ser sanitizado? */
  readonly houveValorHostil: boolean;
  /** Algum par da janela tem os quatro valores em zero? */
  readonly houveCelulaZerada: boolean;
  /** Instantes da saída que aparecem em mais de um preço — o caso de empate. */
  readonly instantesComEmpate: number;
}

/**
 * `recorte(grid, window)` — uma célula por par (balde, preço) existente na
 * janela, com os quatro valores da entrada.
 *
 * ── O QUE "DENTRO DA JANELA" SIGNIFICA ────────────────────────────────────
 *
 * Limites de tempo e de preço **inclusive nos dois lados**. As comparações estão
 * escritas na forma positiva (`>=` e `<=`) de propósito: coordenada não finita
 * reprova as duas e a célula fica fora, em vez de propagar indefinição.
 *
 * Célula cujo índice caia fora do próprio eixo **não pode** estar dentro da
 * janela — sem coordenada não há como situá-la —, então é excluída. Grid assim é
 * impossível em produção, porque o decodificador devolve ausência e nunca um grid
 * parcial; a verificação existe como rede, não como expectativa.
 *
 * ── PAR REPETIDO ──────────────────────────────────────────────────────────
 *
 * Não acontece no payload real, mas o tipo o admite. A combinação segue os
 * operadores das Properties 4 e 5 — fila por `max`, execução por `sum` —, e a
 * acumulação é feita em precisão dupla e só arredondada na materialização, como a
 * implementação faz: arredondar a cada passo daria total diferente.
 */
function recorteDaJanela(grid: BookmapGrid, visible: VisibleWindow): Recorte {
  const comprimento = Math.min(
    grid.ti.length,
    grid.pi.length,
    grid.bid.length,
    grid.ask.length,
    grid.buy.length,
    grid.sell.length,
  );

  const porPar = new Map<string, CelulaDoRecorte>();
  let celulasNaJanela = 0;
  let celulasExcluidas = 0;
  let houveParRepetido = false;
  let houveValorHostil = false;

  for (let k = 0; k < comprimento; k += 1) {
    const indiceTempo = grid.ti[k] ?? Number.NaN;
    const indicePreco = grid.pi[k] ?? Number.NaN;
    if (!(indiceTempo >= 0 && indiceTempo < grid.times.length)) {
      celulasExcluidas += 1;
      continue;
    }
    if (!(indicePreco >= 0 && indicePreco < grid.prices.length)) {
      celulasExcluidas += 1;
      continue;
    }

    const instante = grid.times[indiceTempo] ?? Number.NaN;
    const preco = grid.prices[indicePreco] ?? Number.NaN;
    if (!(instante >= visible.tsDe && instante <= visible.tsAte)) {
      celulasExcluidas += 1;
      continue;
    }
    if (!(preco >= visible.precoDe && preco <= visible.precoAte)) {
      celulasExcluidas += 1;
      continue;
    }

    celulasNaJanela += 1;

    const cruas: readonly (number | undefined)[] = [
      grid.bid[k],
      grid.ask[k],
      grid.buy[k],
      grid.sell[k],
    ];
    const filaCompra = sanitizar(cruas[0]);
    const filaVenda = sanitizar(cruas[1]);
    const execCompra = sanitizar(cruas[2]);
    const execVenda = sanitizar(cruas[3]);
    for (const crua of cruas) {
      if (crua !== sanitizar(crua)) houveValorHostil = true;
    }

    const chave = `${indiceTempo}|${indicePreco}`;
    const existente = porPar.get(chave);
    if (existente === undefined) {
      porPar.set(chave, {
        tsMs: instante,
        preco,
        ti: indiceTempo,
        pi: indicePreco,
        bid: filaCompra,
        ask: filaVenda,
        buy: execCompra,
        sell: execVenda,
        membros: 1,
      });
    } else {
      houveParRepetido = true;
      existente.bid = Math.max(existente.bid, filaCompra);
      existente.ask = Math.max(existente.ask, filaVenda);
      existente.buy += execCompra;
      existente.sell += execVenda;
      existente.membros += 1;
    }
  }

  // Instante crescente e, no empate, preço crescente (critério 3.7). Ordenar
  // pelos VALORES de eixo, e não pelos índices, é o que torna a referência
  // independente da forma como a implementação encaixa a chave de grupo.
  const celulas = [...porPar.values()].sort((a, b) =>
    a.tsMs !== b.tsMs ? a.tsMs - b.tsMs : a.preco - b.preco,
  );

  const precosPorInstante = new Map<number, number>();
  let houveCelulaZerada = false;
  for (const celula of celulas) {
    precosPorInstante.set(celula.tsMs, (precosPorInstante.get(celula.tsMs) ?? 0) + 1);
    if (celula.bid === 0 && celula.ask === 0 && celula.buy === 0 && celula.sell === 0) {
      houveCelulaZerada = true;
    }
  }
  let instantesComEmpate = 0;
  for (const quantidade of precosPorInstante.values()) {
    if (quantidade > 1) instantesComEmpate += 1;
  }

  return {
    celulas,
    celulasNaJanela,
    celulasExcluidas,
    houveParRepetido,
    houveValorHostil,
    houveCelulaZerada,
    instantesComEmpate,
  };
}

/**
 * O recorte na forma de `AggregatedCells`, para comparação campo a campo.
 *
 * Materializar nos **mesmos tipos de array** da saída é o que faz o arredondamento
 * de precisão simples acontecer no mesmo lugar dos dois lados. Comparar contra os
 * números de precisão dupla acumulados daria divergência espúria na soma de pares
 * repetidos — e a divergência seria do teste, não da implementação.
 */
function recorteComoCelulas(recorte: Recorte): AggregatedCells {
  const n = recorte.celulas.length;
  const tsMs = new Float64Array(n);
  const preco = new Float64Array(n);
  const bid = new Float32Array(n);
  const ask = new Float32Array(n);
  const buy = new Float32Array(n);
  const sell = new Float32Array(n);

  for (let i = 0; i < n; i += 1) {
    const celula = recorte.celulas[i];
    if (celula === undefined) continue;
    tsMs[i] = celula.tsMs;
    preco[i] = celula.preco;
    bid[i] = celula.bid;
    ask[i] = celula.ask;
    buy[i] = celula.buy;
    sell[i] = celula.sell;
  }

  return { count: n, fatorTempo: 1, fatorPreco: 1, tsMs, preco, bid, ask, buy, sell };
}

// ═════════════════════════════════════════════════════════════════════════════
// Comparação exata e reerguimento a grid
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Primeira divergência entre duas saídas, em pt-BR, ou `null` quando idênticas.
 *
 * ── POR QUE UMA FUNÇÃO, E NÃO UM LAÇO DE ASSERÇÕES ────────────────────────
 *
 * Comparar seis colunas de até 300 células em 500 execuções daria quase um milhão
 * de asserções — a suíte passaria de segundos para minutos sem ganhar nada. Esta
 * função devolve **uma** mensagem e o chamador faz **uma** asserção, apontando
 * exatamente o índice, o campo e os dois valores.
 *
 * A comparação usa `Object.is`, que distingue zero positivo de zero negativo e
 * trata indefinição como igual a si mesma. As duas escolhas importam: um valor
 * sanitizado tem de sair como zero **positivo**, e uma coluna que passe a devolver
 * indefinição nos dois lados não deve ser lida como acerto — é por isso que a
 * finitude é afirmada em separado, e não deduzida daqui.
 */
function primeiraDivergencia(
  obtido: AggregatedCells,
  esperado: AggregatedCells,
  rotuloObtido = 'obtido',
  rotuloEsperado = 'esperado',
): string | null {
  const escalares: readonly (keyof AggregatedCells)[] = ['count', 'fatorTempo', 'fatorPreco'];
  for (const campo of escalares) {
    const a = obtido[campo] as number;
    const b = esperado[campo] as number;
    if (!Object.is(a, b)) {
      return `${String(campo)}: ${rotuloObtido}=${a} ${rotuloEsperado}=${b}`;
    }
  }

  const colunas: readonly (keyof AggregatedCells)[] = [
    'tsMs',
    'preco',
    'bid',
    'ask',
    'buy',
    'sell',
  ];
  for (let i = 0; i < obtido.count; i += 1) {
    for (const coluna of colunas) {
      const a = (obtido[coluna] as Float64Array | Float32Array)[i];
      const b = (esperado[coluna] as Float64Array | Float32Array)[i];
      if (!Object.is(a, b)) {
        return `célula ${i}, ${String(coluna)}: ${rotuloObtido}=${String(a)} ${rotuloEsperado}=${String(b)}`;
      }
    }
  }

  return null;
}

/**
 * Reergue a saída agregada a um `BookmapGrid`, para a segunda passada.
 *
 * ── POR QUE ISTO É LEGÍTIMO, E NÃO UM TRUQUE ──────────────────────────────
 *
 * Com fator unitário, `tsMs` é a borda esquerda de um grupo de um balde e `preco`
 * é o centro de um grupo de um tick — ou seja, os próprios valores de eixo da
 * célula. Então os valores distintos de `tsMs` **são** um eixo de tempo válido, e
 * os de `preco` **são** um eixo de preço válido: ordenados e deduplicados, eles
 * satisfazem a invariante 3 do tipo, e os índices reconstruídos satisfazem a 2.
 *
 * As colunas de valor são copiadas com o mesmo tipo de array, logo o reerguimento
 * é **sem perda**: nenhum arredondamento acontece na volta. Qualquer diferença que
 * a segunda passada mostre é diferença da agregação.
 *
 * ⚠️ Recorta em `count`, nunca em `length` — as colunas de saída podem ter
 * capacidade folgada, e as posições além do preenchido são zeros que virariam
 * células no preço errado.
 */
function elevarParaGrid(cells: AggregatedCells, base: BookmapGrid): BookmapGrid {
  const instantes = new Set<number>();
  const precos = new Set<number>();
  for (let i = 0; i < cells.count; i += 1) {
    instantes.add(cells.tsMs[i] ?? Number.NaN);
    precos.add(cells.preco[i] ?? Number.NaN);
  }

  const times = Float64Array.from([...instantes].sort((a, b) => a - b));
  const prices = Float64Array.from([...precos].sort((a, b) => a - b));

  const indiceDoInstante = new Map<number, number>();
  for (let i = 0; i < times.length; i += 1) indiceDoInstante.set(times[i] ?? Number.NaN, i);
  const indiceDoPreco = new Map<number, number>();
  for (let j = 0; j < prices.length; j += 1) indiceDoPreco.set(prices[j] ?? Number.NaN, j);

  const n = cells.count;
  const ti = new Uint32Array(n);
  const pi = new Uint32Array(n);
  for (let k = 0; k < n; k += 1) {
    ti[k] = indiceDoInstante.get(cells.tsMs[k] ?? Number.NaN) ?? 0;
    pi[k] = indiceDoPreco.get(cells.preco[k] ?? Number.NaN) ?? 0;
  }

  return {
    symbol: base.symbol,
    fonte: base.fonte,
    dia: base.dia,
    baldeSeg: base.baldeSeg,
    times,
    prices,
    ti,
    pi,
    bid: new Float32Array(cells.bid.subarray(0, n)),
    ask: new Float32Array(cells.ask.subarray(0, n)),
    buy: new Float32Array(cells.buy.subarray(0, n)),
    sell: new Float32Array(cells.sell.subarray(0, n)),
    cobertura: base.cobertura,
  };
}

/** O eixo é estritamente crescente? Invariante 3 do tipo. */
function estritamenteCrescente(eixo: Float64Array): boolean {
  for (let i = 1; i < eixo.length; i += 1) {
    const anterior = eixo[i - 1] ?? Number.NaN;
    const atual = eixo[i] ?? Number.NaN;
    if (!(atual > anterior)) return false;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade na faixa que o dado real ocupa.
 *
 * A distribuição medida nas 22.721 células com fila do pregão de referência é
 * `p50 = 481 ct`, `p90 = 714 ct`, `p99 = 1.131 ct`. O zero tem peso próprio
 * porque **célula com os quatro valores em zero não é descartada** com fator
 * unitário — e é justamente o caso que um filtro de zeros bem-intencionado
 * quebraria sem que as Properties 4 e 5 notassem.
 */
const arbQuantidadeRealista = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 1_200 }), weight: 5 },
  { arbitrary: fc.integer({ min: 1_200, max: 2_600 }), weight: 2 },
  { arbitrary: fc.constantFrom(0, 0, 481, 714, 1_131, PAREDE_CT, 36_232), weight: 3 },
);

/**
 * Quantidade que o critério 3.10 manda contar como zero, mais as bordas de
 * precisão.
 *
 * `Number.MAX_VALUE` e `Number.MIN_VALUE` estão aqui porque não sobrevivem à
 * coluna de precisão simples — o primeiro vira infinito, o segundo vira zero —, e
 * a referência precisa concordar com isso lendo o valor **de volta do grid**, e
 * não do número gerado. É a diferença entre testar a função e testar o gerador.
 *
 * `0.5` e `1e-45` não são hostis no sentido do critério: sobrevivem como valor
 * fracionário e como subnormal. Estão aqui porque com fator unitário eles têm de
 * atravessar **intactos**, e um arredondamento indevido apareceria neles antes de
 * aparecer em qualquer outro valor.
 */
const arbQuantidadeHostil = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  -1,
  -PAREDE_CT,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  1e-45,
  0.5,
);

const arbQuantidade = fc.oneof(
  { arbitrary: arbQuantidadeRealista, weight: 7 },
  { arbitrary: arbQuantidadeHostil, weight: 3 },
);

/**
 * Dimensão mínima de célula pedida ao orçamento.
 *
 * Os três primeiros valores não são utilizáveis e fazem o núcleo adotar os padrões
 * **por eixo**, que são diferentes entre si — é o ramo que exercita a assimetria
 * de 3 px contra 2 px. Os demais sobrescrevem os dois eixos com o mesmo número, e
 * incluem o piso (`0.5` sobe para 1), o teto (`200` desce para 64) e um valor
 * fracionário que sobrevive à restrição.
 */
const arbMinCellPx = fc.oneof(
  { arbitrary: fc.constantFrom(0, Number.NaN, -1), weight: 4 },
  { arbitrary: fc.constantFrom(0.5, 1, 2, 2.5, 3, 8, 64, 200), weight: 6 },
);

/**
 * Orçamento de células.
 *
 * Todo valor é maior ou igual ao teto de células geradas, ou cai no padrão de
 * 3.000 por não ser inteiro finito — em ambos os casos o número de pares
 * distintos cabe na primeira tentativa, que é a condição para o fator
 * permanecer unitário. O ramo não-inteiro existe para exercitar a adoção do
 * padrão do critério 3.1.
 *
 * ⚠️ **Inteiro pequeno ou negativo NÃO entra aqui**, e a primeira versão deste
 * arquivo errou nisso: `-7` é inteiro finito, logo é aceito e restringido ao piso
 * de **uma** célula — o orçamento se esgota, o núcleo dobra a dimensão mínima
 * doze vezes e o fator sai muito maior que 1. A asserção de fator unitário pegou
 * o defeito no gerador, que é exatamente para isso que ela existe. O ramo de
 * orçamento apertado é assunto da Property 7, onde a saída vazia deliberada tem
 * significado.
 */
const arbMaxCells = fc.oneof(
  { arbitrary: fc.constantFrom(MAX_CELULAS_GERADAS, 3_000, 20_000, 50_000), weight: 7 },
  { arbitrary: fc.constantFrom(Number.NaN, 1.5, Number.POSITIVE_INFINITY, -7.5), weight: 3 },
);

/**
 * Eixos curtos, de propósito.
 *
 * ⚠️ **O comprimento do eixo é o que mantém o viewport plausível.** Fator unitário
 * exige `pixels ≥ dimensãoMínima × unidadesVisíveis`; com a dimensão mínima
 * chegando a 64 px, um eixo de 570 baldes — o pregão inteiro — pediria 36.480 px
 * de largura. Eixo curto é o análogo honesto do zoom aproximado, que é a escala em
 * que o fator **é** unitário na prática.
 *
 * O ramo de um único balde ou de um único preço existe porque nele o eixo
 * degenera: o grupo tem borda e centro no mesmo ponto, e é onde um cálculo de
 * centro sobre intervalo aberto quebraria.
 *
 * ⚠️ **A forma do eixo também é o que produz o empate de instante**, que é o único
 * caso em que a ordenação secundária por preço decide algo. Empate exige duas
 * células do mesmo balde em preços diferentes dentro da janela, então eixo de
 * tempo longo com eixo de preço curto quase nunca o produz: com 48 baldes e 24
 * células, a média é de meia célula por balde. Os dois ramos de eixo de tempo
 * curto com eixo de preço alto existem para isso.
 *
 * O ramo de preço único **nunca** produz empate, e é intencional.
 */
const arbComprimentosDeEixo = fc.oneof(
  {
    arbitrary: fc.tuple(fc.integer({ min: 4, max: 24 }), fc.integer({ min: 4, max: 32 })),
    weight: 4,
  },
  { arbitrary: fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 })), weight: 1 },
  { arbitrary: fc.tuple(fc.constant(1), fc.integer({ min: 8, max: 32 })), weight: 2 },
  {
    arbitrary: fc.tuple(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 8, max: 32 })),
    weight: 2,
  },
  { arbitrary: fc.tuple(fc.integer({ min: 8, max: 48 }), fc.constant(1)), weight: 1 },
);

interface EspecificacaoDeGrid {
  readonly nBaldes: number;
  readonly nPrecos: number;
  readonly celulas: readonly CelulaSintetica[];
}

/**
 * Quantidade de células, com um ramo denso explícito.
 *
 * ⚠️ O gerador de arranjo da biblioteca **enviesa para arranjo curto** quando o
 * comprimento mínimo é zero, e a primeira versão deste arquivo tomou isso como
 * densidade suficiente. Não era: a maioria dos casos saía com poucas células, e o
 * empate de instante — dependente de duas células no mesmo balde — ficou em
 * 20,4%. Fixar um piso alto no ramo denso é o que corrige, e o ramo curto
 * permanece com peso porque é ele que produz janela vazia e grid vazio, casos que
 * o denso não alcança.
 *
 * O teto respeita o domínio de pares distintos, que é o que permite reusar este
 * gerador no arranjo sem repetição sem pedir mais pares únicos do que existem.
 */
function arbQuantidadeDeCelulas(paresPossiveis: number): fc.Arbitrary<number> {
  const teto = Math.min(MAX_CELULAS_GERADAS, paresPossiveis);
  const pisoDenso = Math.min(24, Math.max(0, Math.floor(teto / 2)));
  return fc.oneof(
    { arbitrary: fc.integer({ min: pisoDenso, max: teto }), weight: 6 },
    { arbitrary: fc.integer({ min: 0, max: Math.min(12, teto) }), weight: 4 },
  );
}

/**
 * Os quatro valores de uma célula.
 *
 * ⚠️ O ramo **toda-zero** é explícito de propósito. Com fator unitário essa célula
 * NÃO é descartada — é a diferença entre esta propriedade e o round-trip colunar
 * da Property 9, onde a omissão é intencional. E o sorteio independente dos quatro
 * valores quase nunca a produz por acaso: a probabilidade de os quatro caírem em
 * zero é da ordem de 0,3% por célula, o que deixou a cobertura medida em 4%. Sem
 * este ramo, um filtro de zeros bem-intencionado passaria por aqui sem ser
 * notado — e as Properties 4 e 5 também não o veriam, porque `max` e `sum` de
 * zeros continuam zero.
 */
const arbValoresDaCelula = fc.oneof(
  {
    arbitrary: fc.record({
      bid: arbQuantidade,
      ask: arbQuantidade,
      buy: arbQuantidade,
      sell: arbQuantidade,
    }),
    weight: 8,
  },
  { arbitrary: fc.constant({ bid: 0, ask: 0, buy: 0, sell: 0 }), weight: 2 },
);

function arbCelula(nBaldes: number, nPrecos: number): fc.Arbitrary<CelulaSintetica> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: nBaldes - 1 }),
      fc.integer({ min: 0, max: nPrecos - 1 }),
      arbValoresDaCelula,
    )
    .map(([ti, pi, valores]): CelulaSintetica => ({ ti, pi, ...valores }));
}

/**
 * Grid com pares possivelmente repetidos.
 *
 * Repetição de par é consequência natural da densidade sobre eixos curtos, e
 * exercita a combinação por `max`/`sum` também no regime unitário — onde ela é o
 * único desvio da leitura literal do critério 3.4.
 */
const arbEspecificacaoComRepeticao: fc.Arbitrary<EspecificacaoDeGrid> =
  arbComprimentosDeEixo.chain(([nBaldes, nPrecos]) =>
    arbQuantidadeDeCelulas(MAX_CELULAS_GERADAS).chain((n) =>
      fc
        .array(arbCelula(nBaldes, nPrecos), { minLength: n, maxLength: n })
        .map((celulas) => ({ nBaldes, nPrecos, celulas })),
    ),
  );

/**
 * Grid **sem** par repetido — a invariante do payload real.
 *
 * Existe para que a forma literal do critério 3.4 possa ser afirmada: "os quatro
 * valores idênticos aos da célula de entrada correspondente", no singular, só faz
 * sentido quando existe uma única célula de entrada por par.
 *
 * ⚠️ O comprimento pedido é limitado ao número de pares distintos do grid. Sem
 * esse limite, um eixo de um balde por um preço receberia pedido de dezenas de
 * pares únicos sobre um domínio de um, e a geração ficaria tentando cumprir um
 * mínimo impossível.
 */
const arbEspecificacaoSemRepeticao: fc.Arbitrary<EspecificacaoDeGrid> =
  arbComprimentosDeEixo.chain(([nBaldes, nPrecos]) =>
    arbQuantidadeDeCelulas(nBaldes * nPrecos).chain((n) =>
      fc
        .uniqueArray(arbCelula(nBaldes, nPrecos), {
          minLength: n,
          maxLength: n,
          selector: (celula) => `${celula.ti}|${celula.pi}`,
        })
        .map((celulas) => ({ nBaldes, nPrecos, celulas })),
    ),
  );

/** Folga sobre o mínimo de pixels. `1` é o caso justo, onde a borda é exata. */
const arbFolgaDePixel = fc.constantFrom(1, 1, 1.25, 2, 3, 10);

/** Faixa de índices de um eixo, opcionalmente crescida em torno de uma âncora. */
function arbFaixaDeEixo(
  limite: number,
  ancora: number | null,
): fc.Arbitrary<readonly [number, number]> {
  const livre = fc
    .tuple(fc.integer({ min: 0, max: limite - 1 }), fc.integer({ min: 0, max: limite - 1 }))
    .map(([a, b]): readonly [number, number] => (a <= b ? [a, b] : [b, a]));

  if (ancora === null) return livre;

  return fc
    .tuple(fc.integer({ min: 0, max: limite }), fc.integer({ min: 0, max: limite }))
    .map(([antes, depois]): readonly [number, number] => [
      Math.max(0, ancora - antes),
      Math.min(limite - 1, ancora + depois),
    ]);
}

/**
 * A janela, dimensionada **a partir do grid** para que o fator saia unitário.
 *
 * ── O CÁLCULO, E POR QUE ELE É CONSTRUÍDO E NÃO SORTEADO ──────────────────
 *
 * O critério 3.8 fixa o fator como o menor inteiro que faz a dimensão da célula
 * alcançar o mínimo, e fator 1 para o eixo que já o alcança. Então o antecedente
 * do critério 3.4 — os dois fatores iguais a 1 — é equivalente a
 *
 *     larguraPx / baldesVisiveis ≥ larguraMínimaEfetiva
 *     alturaPx  / ticksVisiveis  ≥ alturaMínimaEfetiva
 *
 * Sortear os pixels soltos deixaria a fração de casos com fator unitário ao
 * acaso, e cada caso com fator 2 sairia da hipótese da propriedade — o teste
 * viraria uma coleção de execuções que não afirmam nada. Dimensionar a partir do
 * grid garante o antecedente por construção; a asserção de fator unitário na
 * própria propriedade garante que a construção continua correta se este cálculo
 * mudar.
 *
 * `Math.ceil` cobre a folga fracionária: `ceil(2,5 × 3) / 3 = 8 / 3 = 2,67 ≥ 2,5`.
 *
 * ⚠️ **`minCellPx` entra por parâmetro, não é sorteado aqui.** Ele é a mesma
 * dimensão mínima que vai para o orçamento: sortear duas independentemente
 * romperia o antecedente — o viewport seria dimensionado para 2 px enquanto o
 * núcleo exigiria 64 px, e o fator sairia maior que 1.
 *
 * ── ANCORAGEM ─────────────────────────────────────────────────────────────
 *
 * A janela é ancorada numa célula existente na maior parte dos casos, e sorteada
 * livre no restante. A ancoragem garante recorte não vazio; a janela livre é a
 * que exercita recorte vazio e recorte que exclui parte da entrada, e nenhuma das
 * duas coisas o outro ramo produz.
 *
 * A âncora sai de **uma única** célula, com os dois índices do mesmo par: âncoras
 * independentes por eixo apontariam para um cruzamento que pode não conter célula
 * alguma, e a garantia de recorte não vazio se perderia sem aviso.
 */
function arbJanelaUnitaria(
  spec: EspecificacaoDeGrid,
  minCellPx: number,
  folgaLargura: number,
  folgaAltura: number,
): fc.Arbitrary<VisibleWindow> {
  const { nBaldes, nPrecos, celulas } = spec;
  const minimo = dimensoesMinimasEfetivas(minCellPx);

  const semAncora: fc.Arbitrary<CelulaSintetica | null> = fc.constant(null);
  const arbAncora: fc.Arbitrary<CelulaSintetica | null> =
    celulas.length === 0
      ? semAncora
      : fc.oneof(
          {
            arbitrary: fc
              .integer({ min: 0, max: celulas.length - 1 })
              .map((k) => celulas[k] ?? null),
            weight: 7,
          },
          { arbitrary: semAncora, weight: 3 },
        );

  return arbAncora.chain((ancora) =>
    fc
      .tuple(
        arbFaixaDeEixo(nBaldes, ancora === null ? null : ancora.ti),
        arbFaixaDeEixo(nPrecos, ancora === null ? null : ancora.pi),
      )
      .map(([[i0, i1], [j0, j1]]): VisibleWindow => {
        const baldesVisiveis = i1 - i0 + 1;
        const ticksVisiveis = j1 - j0 + 1;
        return {
          tsDe: ABERTURA_MS + i0 * BALDE_MS,
          tsAte: ABERTURA_MS + i1 * BALDE_MS,
          precoDe: PRECO_BASE + j0 * TICK,
          precoAte: PRECO_BASE + j1 * TICK,
          larguraPx: Math.ceil(minimo.larguraPx * baldesVisiveis * folgaLargura),
          alturaPx: Math.ceil(minimo.alturaPx * ticksVisiveis * folgaAltura),
          baldesVisiveis,
          ticksVisiveis,
        };
      }),
  );
}

/** Orçamento e dimensão mínima, na forma que a função pública recebe. */
interface Orcamento {
  readonly maxCells: number;
  readonly minCellPx: number;
}

/** Uma tripla completa: grid, janela e orçamento. */
interface Cenario {
  readonly grid: BookmapGrid;
  readonly janela: VisibleWindow;
  readonly orcamento: Orcamento;
}

/** Monta o cenário com a dimensão mínima compartilhada entre viewport e orçamento. */
function arbCenarioDe(arbSpec: fc.Arbitrary<EspecificacaoDeGrid>): fc.Arbitrary<Cenario> {
  return arbSpec.chain((spec) =>
    fc
      .tuple(arbMinCellPx, arbFolgaDePixel, arbFolgaDePixel, arbMaxCells)
      .chain(([minCellPx, folgaLargura, folgaAltura, maxCells]) =>
        arbJanelaUnitaria(spec, minCellPx, folgaLargura, folgaAltura).map(
          (janela): Cenario => ({
            grid: construirGrid(spec.nBaldes, spec.nPrecos, spec.celulas),
            janela,
            orcamento: { maxCells, minCellPx },
          }),
        ),
      ),
  );
}

const arbCenario = arbCenarioDe(arbEspecificacaoComRepeticao);
const arbCenarioSemRepeticao = arbCenarioDe(arbEspecificacaoSemRepeticao);

/**
 * O mesmo cenário, com uma **permutação** das células da entrada.
 *
 * O conteúdo é idêntico; só a ordem das colunas muda. É o que expõe dependência
 * da ordem de inserção no mapa de grupos.
 */
interface CenarioPermutado extends Cenario {
  readonly permutado: BookmapGrid;
}

const arbCenarioPermutado: fc.Arbitrary<CenarioPermutado> = arbEspecificacaoComRepeticao.chain(
  (spec) =>
    fc
      .tuple(
        arbMinCellPx,
        arbFolgaDePixel,
        arbFolgaDePixel,
        arbMaxCells,
        fc.shuffledSubarray([...spec.celulas], {
          minLength: spec.celulas.length,
          maxLength: spec.celulas.length,
        }),
      )
      .chain(([minCellPx, folgaLargura, folgaAltura, maxCells, permutadas]) =>
        arbJanelaUnitaria(spec, minCellPx, folgaLargura, folgaAltura).map(
          (janela): CenarioPermutado => ({
            grid: construirGrid(spec.nBaldes, spec.nPrecos, spec.celulas),
            permutado: construirGrid(spec.nBaldes, spec.nPrecos, permutadas),
            janela,
            orcamento: { maxCells, minCellPx },
          }),
        ),
      ),
);

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 6: idempotência com fator unitário', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // A cláusula central: a saída É o recorte
  // ───────────────────────────────────────────────────────────────────────────

  it('com fator unitário, a saída é exatamente o recorte da janela — campo a campo, sem tolerância', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        // A janela é utilizável por CONSTRUÇÃO; afirmar isso mantém a garantia
        // verificada. Janela recusada também devolveria fatores 1 e 1 com zero
        // células, e o teste passaria sem nunca ter agregado nada.
        expect(janelaUtilizavel(janela)).toBe(true);

        const { cells, budgetExhausted, repetitions } = aggregateForZoomWithOutcome(
          grid,
          janela,
          orcamento,
        );

        // O antecedente do critério 3.4, afirmado e não suposto. É esta asserção
        // que impede o arquivo inteiro de virar tautologia se o dimensionamento
        // do viewport deixar de garantir o fator unitário.
        expect(cells.fatorTempo).toBe(1);
        expect(cells.fatorPreco).toBe(1);

        // O orçamento acomoda na primeira tentativa: nenhuma repetição, nenhum
        // esgotamento. Sem isso, a saída vazia deliberada do critério 3.5 entraria
        // aqui disfarçada de recorte vazio.
        expect(repetitions).toBe(0);
        expect(budgetExhausted).toBe(false);

        // `count` é a verdade, não `length` — a capacidade pode ser folgada, e ler
        // além do preenchido devolveria zeros lidos como liquidez ausente.
        expect(cells.tsMs.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.preco.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.bid.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.ask.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.buy.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.sell.length).toBeGreaterThanOrEqual(cells.count);

        const recorte = recorteDaJanela(grid, janela);

        // Uma célula por par distinto da janela — nem mais, nem menos.
        expect(cells.count).toBe(recorte.celulas.length);

        expect(primeiraDivergencia(cells, recorteComoCelulas(recorte), 'agregado', 'recorte')).toBe(
          null,
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A forma de ponto fixo — a idempotência que dá nome à propriedade
  // ───────────────────────────────────────────────────────────────────────────

  it('agregar uma segunda vez com fator unitário não altera nada', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const primeira = aggregateForZoom(grid, janela, orcamento);
        expect(primeira.fatorTempo).toBe(1);
        expect(primeira.fatorPreco).toBe(1);

        const reerguido = elevarParaGrid(primeira, grid);

        // O reerguimento produziu um grid VÁLIDO: eixos estritamente crescentes
        // (invariante 3) e índices dentro deles (invariante 2). Sem esta conferência,
        // um eixo com valor repetido faria a segunda passada combinar células que a
        // primeira havia separado, e a igualdade seguinte mediria outra coisa.
        expect(estritamenteCrescente(reerguido.times)).toBe(true);
        expect(estritamenteCrescente(reerguido.prices)).toBe(true);
        expect(reerguido.ti.length).toBe(primeira.count);
        expect(reerguido.pi.length).toBe(primeira.count);
        for (let k = 0; k < reerguido.ti.length; k += 1) {
          expect(reerguido.ti[k] ?? -1).toBeLessThan(reerguido.times.length);
          expect(reerguido.pi[k] ?? -1).toBeLessThan(reerguido.prices.length);
        }

        const segunda = aggregateForZoom(reerguido, janela, orcamento);

        // A mesma janela sobre um grid cujos eixos são um subconjunto do primeiro
        // mantém os pixels por unidade, então o fator continua unitário.
        expect(segunda.fatorTempo).toBe(1);
        expect(segunda.fatorPreco).toBe(1);

        expect(primeiraDivergencia(segunda, primeira, 'segunda passada', 'primeira')).toBe(null);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A forma literal do critério 3.4, com par único — a invariante de produção
  // ───────────────────────────────────────────────────────────────────────────

  it('sem par repetido na entrada, cada célula entregue tem os quatro valores da célula de entrada correspondente', () => {
    fc.assert(
      fc.property(arbCenarioSemRepeticao, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        expect(cells.fatorTempo).toBe(1);
        expect(cells.fatorPreco).toBe(1);

        const recorte = recorteDaJanela(grid, janela);
        expect(recorte.houveParRepetido).toBe(false);

        // Cada par da janela tem exatamente UM membro, então a combinação não
        // acontece e os valores vêm da célula de entrada, sem passar por `max` nem
        // por `sum`. É a leitura literal do critério.
        const maiorNumeroDeMembros = recorte.celulas.reduce((m, c) => Math.max(m, c.membros), 0);
        expect(maiorNumeroDeMembros).toBeLessThanOrEqual(1);

        // Mapa dos valores de ENTRADA, indexado pelo par — construído a partir das
        // colunas cruas do grid, sem passar pela referência de recorte.
        const entradaPorPar = new Map<string, readonly [number, number, number, number]>();
        for (let k = 0; k < grid.ti.length; k += 1) {
          const indiceTempo = grid.ti[k] ?? Number.NaN;
          const indicePreco = grid.pi[k] ?? Number.NaN;
          entradaPorPar.set(`${indiceTempo}|${indicePreco}`, [
            sanitizar(grid.bid[k]),
            sanitizar(grid.ask[k]),
            sanitizar(grid.buy[k]),
            sanitizar(grid.sell[k]),
          ]);
        }

        for (let i = 0; i < cells.count; i += 1) {
          const instante = cells.tsMs[i] ?? Number.NaN;
          const preco = cells.preco[i] ?? Number.NaN;

          // Indefinição nunca sai daqui. Sem esta asserção, uma coluna com
          // indefinição faria a busca do par falhar de um jeito que a mensagem não
          // explicaria.
          expect(Number.isFinite(instante)).toBe(true);
          expect(Number.isFinite(preco)).toBe(true);

          const indiceTempo = Math.round((instante - ABERTURA_MS) / BALDE_MS);
          const indicePreco = Math.round((preco - PRECO_BASE) / TICK);

          // O instante e o preço entregues caem EXATAMENTE sobre uma entrada de
          // eixo — nada de meio balde nem de centro de grupo inexistente.
          expect(ABERTURA_MS + indiceTempo * BALDE_MS).toBe(instante);
          expect(PRECO_BASE + indicePreco * TICK).toBe(preco);

          const daEntrada = entradaPorPar.get(`${indiceTempo}|${indicePreco}`);

          // Segunda metade do critério 3.4: nenhuma célula entregue tem par que não
          // exista na entrada.
          expect(daEntrada).toBeDefined();
          if (daEntrada === undefined) continue;

          expect(cells.bid[i]).toBe(daEntrada[0]);
          expect(cells.ask[i]).toBe(daEntrada[1]);
          expect(cells.buy[i]).toBe(daEntrada[2]);
          expect(cells.sell[i]).toBe(daEntrada[3]);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Os pares, nos dois sentidos — nada falta e nada é inventado
  // ───────────────────────────────────────────────────────────────────────────

  it('o conjunto de pares entregues é exatamente o conjunto de pares da janela, nos dois sentidos', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        expect(cells.fatorTempo).toBe(1);
        expect(cells.fatorPreco).toBe(1);

        const recorte = recorteDaJanela(grid, janela);

        const esperados = new Set(recorte.celulas.map((c) => `${c.tsMs}|${c.preco}`));
        const entregues = new Set<string>();
        for (let i = 0; i < cells.count; i += 1) {
          entregues.add(`${cells.tsMs[i] ?? Number.NaN}|${cells.preco[i] ?? Number.NaN}`);
        }

        // Sem duplicata na saída: o conjunto tem o mesmo tamanho da sequência.
        expect(entregues.size).toBe(cells.count);

        // Nada inventado — critério 3.4, segunda metade.
        for (const par of entregues) expect(esperados.has(par)).toBe(true);
        // E nada perdido, inclusive na fronteira inclusiva da janela.
        for (const par of esperados) expect(entregues.has(par)).toBe(true);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A ordem, e a insensibilidade à ordem de entrada
  // ───────────────────────────────────────────────────────────────────────────

  it('a saída é ordenada por instante crescente e, no empate, por preço crescente', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        expect(cells.fatorTempo).toBe(1);
        expect(cells.fatorPreco).toBe(1);

        // ESTRITAMENTE crescente na ordem lexicográfica: com fator unitário os
        // pares são únicos, então empate completo seria célula duplicada.
        for (let i = 1; i < cells.count; i += 1) {
          const instanteAnterior = cells.tsMs[i - 1] ?? Number.NaN;
          const instanteAtual = cells.tsMs[i] ?? Number.NaN;
          expect(instanteAtual).toBeGreaterThanOrEqual(instanteAnterior);
          if (instanteAtual === instanteAnterior) {
            const precoAnterior = cells.preco[i - 1] ?? Number.NaN;
            const precoAtual = cells.preco[i] ?? Number.NaN;
            expect(precoAtual).toBeGreaterThan(precoAnterior);
          }
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a ordem das células na entrada não altera a saída — a idempotência vale inclusive na ordem', () => {
    fc.assert(
      fc.property(arbCenarioPermutado, ({ grid, permutado, janela, orcamento }) => {
        const daOriginal = aggregateForZoom(grid, janela, orcamento);
        const daPermutada = aggregateForZoom(permutado, janela, orcamento);

        expect(daOriginal.fatorTempo).toBe(1);
        expect(daOriginal.fatorPreco).toBe(1);

        // ⚠️ Os grupos nascem num mapa, cuja ordem de inserção segue a ordem das
        // células. Se a ordenação da saída dependesse dessa ordem em vez da chave de
        // grupo, a permutação produziria sequência diferente — e o heatmap desenharia
        // as mesmas células em ordem diferente entre dois frames com o mesmo dado.
        //
        // A comparação vale mesmo com par repetido: `max` e `sum` são comutativos, e
        // a soma em precisão dupla de valores não negativos independe da ordem dentro
        // da magnitude usada aqui.
        expect(primeiraDivergencia(daPermutada, daOriginal, 'permutada', 'original')).toBe(null);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O enunciado literal do projeto, e o que ele NÃO garante sozinho
  // ───────────────────────────────────────────────────────────────────────────

  it('o orçamento literal do enunciado só dá fator unitário com viewport folgado — e aí a idempotência vale', () => {
    // Um grid pequeno e explícito: 4 baldes × 3 preços, um valor por célula.
    const celulas: CelulaSintetica[] = [];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        celulas.push({ ti: i, pi: j, bid: 100 + i, ask: 200 + j, buy: 10 * i, sell: 10 * j });
      }
    }
    const grid = construirGrid(4, 3, celulas);

    const limites = {
      tsDe: ABERTURA_MS,
      tsAte: ABERTURA_MS + 3 * BALDE_MS,
      precoDe: PRECO_BASE,
      precoAte: PRECO_BASE + 2 * TICK,
      baldesVisiveis: 4,
      ticksVisiveis: 3,
    };

    // `∞` não é inteiro finito ⇒ orçamento 3.000; `0` não é positivo ⇒ dimensões
    // mínimas padrão, 3 px de largura e 2 px de altura.
    const orcamentoDoEnunciado = {
      maxCells: Number.POSITIVE_INFINITY,
      minCellPx: 0,
    };

    // ── viewport ESTREITO: 1 px por balde contra os 3 px mínimos ──
    const estreito = aggregateForZoom(
      grid,
      { ...limites, larguraPx: 4, alturaPx: 3 },
      orcamentoDoEnunciado,
    );

    // É o critério 3.8 agindo como escrito, não defeito: `ceil(3 / 1) = 3`.
    expect(estreito.fatorTempo).toBe(3);
    expect(estreito.fatorPreco).toBe(2);
    expect(estreito.count).toBeLessThan(celulas.length);

    // ── viewport FOLGADO: 3 px por balde e 2 px por tick, o mínimo exato ──
    const janelaFolgada = { ...limites, larguraPx: 4 * DEFAULT_MIN_WIDTH_PX, alturaPx: 3 * DEFAULT_MIN_HEIGHT_PX };
    const folgado = aggregateForZoom(grid, janelaFolgada, orcamentoDoEnunciado);

    expect(folgado.fatorTempo).toBe(1);
    expect(folgado.fatorPreco).toBe(1);
    expect(folgado.count).toBe(celulas.length);

    // Cada célula chegou intacta, na ordem lexicográfica de (instante, preço).
    const recorte = recorteComoCelulas(recorteDaJanela(grid, janelaFolgada));
    expect(primeiraDivergencia(folgado, recorte, 'agregado', 'recorte')).toBe(null);

    // E a segunda passada não move nada.
    const segunda = aggregateForZoom(elevarParaGrid(folgado, grid), janelaFolgada, orcamentoDoEnunciado);
    expect(primeiraDivergencia(segunda, folgado, 'segunda passada', 'primeira')).toBe(null);

    // O padrão do critério 3.1 foi de fato adotado — 12 grupos cabem em 3.000, e é
    // esse número que o teto `∞` virou.
    expect(folgado.count).toBeLessThanOrEqual(DEFAULT_MAX_CELLS);
  });

  it('a parede de 2.442 ct e a célula toda-zero atravessam intactas, e a célula zerada não é descartada', () => {
    // Duas células no mesmo balde: uma com a parede, outra com os quatro valores
    // em zero. Com fator unitário as DUAS têm de sair — filtrar zeros quebraria a
    // contagem de uma célula por par, e o operador leria o buraco como ausência de
    // liquidez em vez de liquidez ausente.
    const grid = construirGrid(1, 2, [
      { ti: 0, pi: 0, bid: PAREDE_CT, ask: 0, buy: 0, sell: 0 },
      { ti: 0, pi: 1, bid: 0, ask: 0, buy: 0, sell: 0 },
    ]);

    const janela: VisibleWindow = {
      tsDe: ABERTURA_MS,
      tsAte: ABERTURA_MS,
      precoDe: PRECO_BASE,
      precoAte: PRECO_BASE + TICK,
      larguraPx: 800,
      alturaPx: 400,
      baldesVisiveis: 1,
      ticksVisiveis: 2,
    };

    const cells = aggregateForZoom(grid, janela, { maxCells: DEFAULT_MAX_CELLS, minCellPx: 0 });

    expect(cells.fatorTempo).toBe(1);
    expect(cells.fatorPreco).toBe(1);
    expect(cells.count).toBe(2);

    // Ordem por preço crescente dentro do mesmo instante.
    expect(cells.preco[0]).toBe(PRECO_BASE);
    expect(cells.preco[1]).toBe(PRECO_BASE + TICK);
    expect(cells.bid[0]).toBe(PAREDE_CT);
    expect(cells.bid[1]).toBe(0);

    // O centro do grupo de um único tick é o próprio preço — e não a média de dois
    // ticks vizinhos, que é o erro que a idempotência detectaria na segunda passada.
    const segunda = aggregateForZoom(elevarParaGrid(cells, grid), janela, {
      maxCells: DEFAULT_MAX_CELLS,
      minCellPx: 0,
    });
    expect(primeiraDivergencia(segunda, cells, 'segunda passada', 'primeira')).toBe(null);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Guarda contra vacuidade — a propriedade tem de exercitar o que protege
  // ───────────────────────────────────────────────────────────────────────────

  it('o comparador deste arquivo acusa divergência — sem isto, toda igualdade acima seria vazia', () => {
    // ⚠️ `primeiraDivergencia` é lógica DESTE ARQUIVO, e todas as igualdades da
    // suíte passam por ela. Um comparador que devolvesse `null` sempre — por um
    // laço que não roda, por um `Object.is` invertido, por um `count` lido do lado
    // errado — faria as sete propriedades acima passarem sem comparar nada, e
    // nenhuma delas falharia para avisar. É o buraco mais barato de abrir e o mais
    // difícil de perceber depois.
    const base: AggregatedCells = {
      count: 2,
      fatorTempo: 1,
      fatorPreco: 1,
      tsMs: Float64Array.from([ABERTURA_MS, ABERTURA_MS + BALDE_MS]),
      preco: Float64Array.from([PRECO_BASE, PRECO_BASE + TICK]),
      bid: Float32Array.from([PAREDE_CT, 0]),
      ask: Float32Array.from([0, 481]),
      buy: Float32Array.from([10, 20]),
      sell: Float32Array.from([30, 0]),
    };

    // Idêntico a si mesmo, e a uma cópia independente.
    expect(primeiraDivergencia(base, base)).toBe(null);
    expect(
      primeiraDivergencia(base, {
        ...base,
        tsMs: Float64Array.from(base.tsMs),
        bid: Float32Array.from(base.bid),
      }),
    ).toBe(null);

    // Cada corrupção é acusada, e a mensagem nomeia o campo.
    expect(primeiraDivergencia(base, { ...base, count: 1 })).toContain('count');
    expect(primeiraDivergencia(base, { ...base, fatorTempo: 2 })).toContain('fatorTempo');
    expect(primeiraDivergencia(base, { ...base, fatorPreco: 3 })).toContain('fatorPreco');

    const instanteDeslocado = Float64Array.from(base.tsMs);
    instanteDeslocado[1] = (instanteDeslocado[1] ?? 0) + 1;
    expect(primeiraDivergencia(base, { ...base, tsMs: instanteDeslocado })).toContain('tsMs');

    const precoNoCentroErrado = Float64Array.from(base.preco);
    precoNoCentroErrado[0] = PRECO_BASE + TICK / 2;
    expect(primeiraDivergencia(base, { ...base, preco: precoNoCentroErrado })).toContain('preco');

    // A parede diluída pela média — o defeito que a Property 4 proíbe, aqui só para
    // provar que este comparador o veria.
    const filaDiluida = Float32Array.from(base.bid);
    filaDiluida[0] = PAREDE_CT / 11;
    expect(primeiraDivergencia(base, { ...base, bid: filaDiluida })).toContain('bid');

    const ordemInvertida = Float32Array.from([481, 0]);
    expect(primeiraDivergencia(base, { ...base, ask: ordemInvertida })).toContain('ask');

    const execPerdida = Float32Array.from(base.buy);
    execPerdida[1] = 0;
    expect(primeiraDivergencia(base, { ...base, buy: execPerdida })).toContain('buy');

    // Zero negativo é acusado: um valor sanitizado tem de sair como zero POSITIVO,
    // e é `Object.is` que faz essa distinção. Comparação por `===` não faria.
    const zeroNegativo = Float64Array.from(base.preco);
    const comZeroNegativo: AggregatedCells = {
      ...base,
      preco: zeroNegativo,
      sell: Float32Array.from([30, -0]),
    };
    expect(primeiraDivergencia(base, comZeroNegativo)).toContain('sell');

    // E o que está ALÉM de `count` não é comparado — é a capacidade folgada da
    // coluna, que o desenho nunca lê.
    const comCaudaDiferente: AggregatedCells = {
      ...base,
      bid: Float32Array.from([PAREDE_CT, 0, 9_999]),
    };
    expect(primeiraDivergencia(base, comCaudaDiferente)).toBe(null);
  });

  it('os geradores exercitam de fato o fator unitário sobre recorte não trivial', () => {
    // ⚠️ Esta asserção existe porque a hipótese desta propriedade — fator unitário
    // — é justamente a condição em que a agregação faz menos trabalho. Um gerador
    // que caísse em janela vazia, ou em janela que cobre o grid inteiro sem
    // excluir nada, satisfaria o enunciado sem exercitar o recorte: o teste não
    // falharia, viraria tautologia e continuaria verde.
    //
    // Medir a cobertura numa asserção, e não só num comentário, é o que impede a
    // regressão silenciosa. Encurtar um eixo, alargar uma janela ou mexer no
    // dimensionamento do viewport no futuro pode devolver o arquivo àquele estado,
    // e o único sintoma seria a suíte continuar verde. Os pisos são folgados em
    // relação ao medido, de propósito.
    const cenarios = fc.sample(arbCenario, { numRuns: NUM_RUNS, seed: SEED });
    expect(cenarios).toHaveLength(NUM_RUNS);

    let comFatorUnitario = 0;
    let comCelulaNaJanela = 0;
    let comExclusao = 0;
    let comEmpateDeInstante = 0;
    let comParRepetido = 0;
    let comValorHostil = 0;
    let comCelulaZerada = 0;
    let comMinimoPadrao = 0;
    let comMinimoSobrescrito = 0;

    for (const { grid, janela, orcamento } of cenarios) {
      const cells = aggregateForZoom(grid, janela, orcamento);
      const recorte = recorteDaJanela(grid, janela);

      if (cells.fatorTempo === 1 && cells.fatorPreco === 1) comFatorUnitario += 1;
      if (recorte.celulas.length > 0) comCelulaNaJanela += 1;
      // O recorte precisa RECORTAR: célula de entrada que ficou fora da janela é o
      // que distingue "recorte" de "identidade".
      if (recorte.celulasExcluidas > 0) comExclusao += 1;
      // Empate de instante é o único caso em que a ordenação secundária por preço
      // decide algo. Sem ele, a cláusula de desempate do critério 3.7 nunca é lida.
      if (recorte.instantesComEmpate > 0) comEmpateDeInstante += 1;
      if (recorte.houveParRepetido) comParRepetido += 1;
      if (recorte.houveValorHostil) comValorHostil += 1;
      if (recorte.houveCelulaZerada) comCelulaZerada += 1;
      if (Number.isFinite(orcamento.minCellPx) && orcamento.minCellPx > 0) {
        comMinimoSobrescrito += 1;
      } else {
        comMinimoPadrao += 1;
      }
    }

    // O antecedente da propriedade vale em TODAS as execuções — não é uma fração a
    // tolerar, é a construção do cenário.
    expect(comFatorUnitario).toBe(NUM_RUNS);

    expect(comCelulaNaJanela / NUM_RUNS).toBeGreaterThan(0.6);
    expect(comExclusao / NUM_RUNS).toBeGreaterThan(0.4);
    expect(comEmpateDeInstante / NUM_RUNS).toBeGreaterThan(0.3);
    expect(comParRepetido / NUM_RUNS).toBeGreaterThan(0.15);
    expect(comValorHostil / NUM_RUNS).toBeGreaterThan(0.4);
    expect(comCelulaZerada / NUM_RUNS).toBeGreaterThan(0.2);
    // Os dois ramos da dimensão mínima: o padrão é assimétrico entre os eixos
    // (3 px × 2 px) e o sobrescrito é simétrico, então cobrir um só deixaria
    // metade do critério 3.8 sem exercício.
    expect(comMinimoPadrao / NUM_RUNS).toBeGreaterThan(0.2);
    expect(comMinimoSobrescrito / NUM_RUNS).toBeGreaterThan(0.2);
  });

  it('o gerador sem par repetido de fato não repete par, e ainda entrega célula', () => {
    // A propriedade da forma literal do critério 3.4 afirma `houveParRepetido ===
    // false`. Se o gerador de pares únicos passasse a produzir só grids vazios, a
    // afirmação continuaria verdadeira e a propriedade não leria nada.
    const cenarios = fc.sample(arbCenarioSemRepeticao, { numRuns: NUM_RUNS, seed: SEED });

    let comCelulaNaJanela = 0;
    let comRepeticao = 0;

    for (const { grid, janela } of cenarios) {
      const recorte = recorteDaJanela(grid, janela);
      if (recorte.celulas.length > 0) comCelulaNaJanela += 1;
      if (recorte.houveParRepetido) comRepeticao += 1;
    }

    expect(comRepeticao).toBe(0);
    expect(comCelulaNaJanela / NUM_RUNS).toBeGreaterThan(0.6);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Determinismo — sem ele nenhum contraexemplo seria reproduzível
  // ───────────────────────────────────────────────────────────────────────────

  it('é determinística, e as duas variantes públicas entregam a mesma saída', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const primeira = aggregateForZoom(grid, janela, orcamento);
        const segunda = aggregateForZoom(grid, janela, orcamento);
        const comDesfecho = aggregateForZoomWithOutcome(grid, janela, orcamento);

        expect(primeiraDivergencia(segunda, primeira, 'segunda chamada', 'primeira')).toBe(null);
        expect(
          primeiraDivergencia(comDesfecho.cells, primeira, 'com desfecho', 'sem desfecho'),
        ).toBe(null);
        expect(comDesfecho.repetitions).toBe(0);
        expect(comDesfecho.budgetExhausted).toBe(false);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
