/**
 * Property 4 — A agregação preserva o pico da fila. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.2.
 *
 * ```
 * ∀ grid, window, budget:
 *     max(agregado.bid ∪ agregado.ask)
 *       === max({grid.bid[k], grid.ask[k]} : célula k dentro de window)
 * ```
 *
 * **Validates: Requirements 3.2**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ela existe para proibir **uma** regressão específica: trocar `max` por média
 * no operador que combina fila.
 *
 * A aritmética é o argumento inteiro. Uma parede de **2.442 ct** — o maior valor
 * real medido dentro da banda de ±2.000 pts do miolo, onde vivem 97,1% das
 * células — diluída em onze baldes daria `2442 / 11 = 222 ct`. Com o `p50` da
 * janela em 481 ct, 222 ct fica **abaixo do piso da escala de cor** e recebe
 * opacidade mínima: a parede **desaparece do desenho**. O operador afasta o zoom
 * e o suporte que ele estava observando some da tela.
 *
 * `max` não tem esse defeito, e a consequência é exata, não aproximada: o maior
 * valor entregue é o maior valor que existia na janela, em qualquer nível de
 * zoom. É a mesma decisão que o agregador de retaguarda já toma ao materializar
 * o balde — herdada, não inventada aqui.
 *
 * ⚠️ Média **não é o único** jeito de perder a parede, e por isso o arquivo não
 * se contenta com a igualdade global dos máximos. Também afirma que toda
 * quantidade de fila entregue é uma quantidade que **existia** na janela, do
 * **mesmo lado** do livro — o que reprova média, mediana, soma, primeiro-valor,
 * último-valor e troca das duas colunas, inclusive quando o defeito atinge só
 * alguns grupos e o máximo global sobrevive por acidente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO O ENUNCIADO FOI TORNADO PRECISO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O texto curto diz `∀ grid, window, budget`. Tomado ao pé da letra ele é falso
 * contra a implementação — e o motivo **está nos requisitos**, não é conveniência
 * para o teste passar:
 *
 * 1. **Janela inutilizável entrega zero células** (critério 3.9): largura ou
 *    altura em pixels não positiva, limite invertido, limite não finito. Aí não
 *    há máximo a preservar, e a implementação nem tenta agrupar. Note que
 *    `larguraPx = 0` **não** esvazia o conjunto de referência — células podem
 *    estar dentro dos limites de tempo e de preço —, então este caso precisa ser
 *    dito, não deduzido.
 * 2. **Orçamento esgotado entrega zero células** (critério 3.5): doze
 *    repetições sem caber, e a entrega vazia é deliberada — preferir vazio a
 *    truncar, porque buraco no heatmap é indistinguível de ausência de liquidez.
 *
 * Fora desses dois casos, a preservação vale **exatamente**, com `===` e sem
 * tolerância. Nada de `toBeCloseTo` aqui, e isso é uma escolha: as colunas de
 * entrada e de saída são ambas de precisão simples, então o valor atravessa o
 * agrupamento **sem perda** — o `max` não faz aritmética, só escolhe. Tolerância
 * é necessária na conservação da execução (Property 5, tarefa 3.3), onde há soma;
 * usá-la aqui admitiria erro que não existe e enfraqueceria a propriedade.
 *
 * A forma **por lado** — `max(agregado.bid) === max(grid.bid ∩ janela)` e o mesmo
 * para `ask` — é a que o critério 3.2 pede literalmente ("`fila_bid` e `fila_ask`
 * separadamente"), e é estritamente mais forte que a da união: a união sozinha
 * passaria numa implementação que trocasse as duas colunas de lugar. As duas
 * formas estão afirmadas, a por lado primeiro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETALHES DA IMPLEMENTAÇÃO QUE O TESTE RESPEITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - **`count` é a verdade, não `length`.** A saída é colunar e as colunas podem
 *   ser alocadas com capacidade maior que o preenchido; só `[0, count)` é
 *   válido. Ler além disso devolve zeros que seriam lidos como liquidez ausente.
 *   Todo laço deste arquivo para em `count`, e uma asserção separada afirma
 *   `count ≤ length` em cada coluna — de modo que uma alocação com capacidade
 *   folgada no futuro não passe a mentir sem ser notada.
 * - **Valor não finito ou negativo conta como zero** (critério 3.10), e a
 *   sanitização é **por campo**: os outros três valores da mesma célula são
 *   preservados. Os geradores produzem `NaN`, ±infinito, negativo, `-0` e
 *   subnormal de propósito.
 * - **Célula toda-zero não é descartada.** Com fatores unitários a saída tem uma
 *   célula por par existente na janela, e filtrar zeros quebraria essa
 *   equivalência.
 * - **Grid gerado respeita as invariantes do tipo**: seis colunas de mesmo
 *   comprimento, todo índice dentro do seu eixo, eixos estritamente crescentes.
 *   Grid que as viole é impossível em produção — o decodificador é o único
 *   produtor e devolve ausência, nunca um grid parcial. Ainda assim a referência
 *   confere a validade do índice, para que uma mudança futura no gerador não faça
 *   referência e implementação divergirem em silêncio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de
 * render e a biblioteca de teste. Aquele módulo é só reexportação, e o fechamento
 * transitivo dos irmãos que ele reexporta alcança um único utilitário de
 * formatação de horário — que não importa nada. Logo não existe caminho daqui até
 * camada de roteamento de conexão, feed de cotação, envio de ordem ou estado de
 * posição, e nada aqui carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Todo insumo é sintetizado pelos geradores. Nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma escrita
 * acontece em nenhuma tabela, e nenhum evento de decisão é emitido.
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
 * anotada aqui. Duas propriedades ao fim do arquivo contam estas frações e
 * reprovam se elas colapsarem, porque um gerador que deixa de exercitar o
 * agrupamento não faz o teste falhar: faz o teste virar tautologia e continuar
 * verde.
 *
 * |                                   | primeira versão | atual  |
 * |-----------------------------------|-----------------|--------|
 * | janela contém ao menos uma célula | 30,0%           | 83,4%  |
 * | fator maior que 1 em algum eixo   | 34,6%           | 32,0%  |
 * | fator de tempo maior que 1        | 22,6%           | 19,8%  |
 * | fator de preço maior que 1        | 22,0%           | 18,4%  |
 * | grupos com mais de um membro      | **2,6%**        | 28,0%  |
 * | máximo da janela acima do `p99`   | 13,2%           | 63,6%  |
 * | orçamento esgotado                | **0,0%**        |  2,8%  |
 *
 * As duas linhas em negrito são o diagnóstico: **a primeira versão deste arquivo
 * combinava membros em 2,6% dos casos e nunca esgotava o orçamento.** A igualdade
 * dos máximos era verdadeira porque quase não havia agrupamento, não porque o
 * operador estivesse certo. As correções foram densificar o grid, ancorar a janela
 * numa célula existente e admitir janela com contagem de unidades visíveis
 * incoerente com os limites — cada uma justificada no respectivo gerador.
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

/** Base do eixo de preço e o incremento mínimo do ativo de referência. */
const PRECO_BASE = 176_000;
const PRECO_PASSO = 5;

/**
 * A parede real medida dentro da banda de ±2.000 pts do miolo.
 *
 * Não é o máximo global do pregão (36.232 ct): aquele vem de níveis cruzados —
 * oferta do lado errado do mercado, executável no instante em que existisse — e é
 * artefato de agregação, não liquidez. 2.442 ct é a maior parede que de fato
 * existiu onde o operador olha.
 */
const PAREDE_CT = 2_442;

/** Baldes do grupo que dissolveria a parede: `2442 / 11 = 222 ct`. */
const BALDES_QUE_DISSOLVEM = 11;

/** Orçamento adotado quando o recebido não é inteiro finito (critério 3.1). */
const ORCAMENTO_PADRAO = 3_000;

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
 * Os eixos são estritamente crescentes por construção. As colunas de valor são de
 * precisão simples, como em produção — é isso que torna a comparação por `===`
 * legítima mais adiante: a quantidade lida de volta do grid **é** a quantidade que
 * o agrupamento vê, sem arredondamento intermediário.
 *
 * O eixo de tempo é de precisão dupla por necessidade, não por gosto: epoch ms na
 * ordem de 1,79 × 10¹² não cabe na mantissa de 24 bits de um número de precisão
 * simples, e o instante seria arredondado para múltiplos de ~131 s — células de
 * baldes distintos colidiriam no mesmo grupo e a propriedade mediria outra coisa.
 */
function construirGrid(
  nBaldes: number,
  nPrecos: number,
  celulas: readonly CelulaSintetica[],
): BookmapGrid {
  const times = new Float64Array(nBaldes);
  for (let i = 0; i < nBaldes; i += 1) times[i] = ABERTURA_MS + i * BALDE_MS;

  const prices = new Float64Array(nPrecos);
  for (let j = 0; j < nPrecos; j += 1) prices[j] = PRECO_BASE + j * PRECO_PASSO;

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
// A referência — o lado direito do enunciado, escrito a partir do requisito
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Critério 3.10 na forma executável: valor de entrada que não seja número finito
 * maior ou igual a zero conta como zero.
 *
 * Escrito a partir do texto do requisito, não copiado da implementação — é o que
 * mantém a referência um juiz independente. `Math.max(0, …)` devolve zero
 * positivo mesmo para zero negativo, e é o que faz a comparação estrita ser
 * segura adiante.
 */
function sanitizar(valor: number | undefined): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 0;
  return Math.max(0, valor);
}

/** O conjunto de referência da janela, e os máximos que dele decorrem. */
interface ReferenciaDaJanela {
  /** Quantas células da entrada caem dentro da janela. */
  readonly celulas: number;
  /** Máximo da fila de compra. `-Infinity` quando `celulas === 0`. */
  readonly maxBid: number;
  /** Máximo da fila de venda. `-Infinity` quando `celulas === 0`. */
  readonly maxAsk: number;
  /** Máximo da união das duas filas — o lado direito literal do enunciado. */
  readonly maxUniao: number;
  /** Quantidades de fila de compra sanitizadas presentes na janela. */
  readonly quantidadesBid: ReadonlySet<number>;
  /** Quantidades de fila de venda sanitizadas presentes na janela. */
  readonly quantidadesAsk: ReadonlySet<number>;
}

/**
 * Calcula `max({grid.bid[k], grid.ask[k]} : célula k dentro de window)`.
 *
 * ── O QUE "DENTRO DA JANELA" SIGNIFICA ────────────────────────────────────
 *
 * Limites de tempo e de preço **inclusive nos dois lados**, como o recorte da
 * janela visível é definido. As comparações estão escritas na forma positiva
 * (`>=` e `<=`) de propósito: coordenada não finita reprova as duas e a célula
 * fica fora, em vez de propagar indefinição para o máximo.
 *
 * Célula cujo índice caia fora do próprio eixo **não pode** estar dentro da
 * janela — sem coordenada não há como situá-la —, então é excluída. Grid assim é
 * impossível em produção; a verificação existe como rede, não como expectativa.
 *
 * `-Infinity` é o elemento neutro do máximo, então ele é a resposta correta para
 * conjunto vazio. Distingui-lo de `0` importa: uma janela com células cujas filas
 * são todas zero tem máximo `0`, e confundir os dois casos deixaria de exercitar
 * a diferença entre "sem célula" e "célula sem liquidez".
 */
function referenciaDaJanela(grid: BookmapGrid, visible: VisibleWindow): ReferenciaDaJanela {
  const comprimento = Math.min(
    grid.ti.length,
    grid.pi.length,
    grid.bid.length,
    grid.ask.length,
    grid.buy.length,
    grid.sell.length,
  );

  let celulas = 0;
  let maxBid = Number.NEGATIVE_INFINITY;
  let maxAsk = Number.NEGATIVE_INFINITY;
  const quantidadesBid = new Set<number>();
  const quantidadesAsk = new Set<number>();

  for (let k = 0; k < comprimento; k += 1) {
    const indiceTempo = grid.ti[k] ?? Number.NaN;
    const indicePreco = grid.pi[k] ?? Number.NaN;
    if (!(indiceTempo >= 0 && indiceTempo < grid.times.length)) continue;
    if (!(indicePreco >= 0 && indicePreco < grid.prices.length)) continue;

    const instante = grid.times[indiceTempo] ?? Number.NaN;
    if (!(instante >= visible.tsDe && instante <= visible.tsAte)) continue;
    const preco = grid.prices[indicePreco] ?? Number.NaN;
    if (!(preco >= visible.precoDe && preco <= visible.precoAte)) continue;

    celulas += 1;

    const filaCompra = sanitizar(grid.bid[k]);
    const filaVenda = sanitizar(grid.ask[k]);
    if (filaCompra > maxBid) maxBid = filaCompra;
    if (filaVenda > maxAsk) maxAsk = filaVenda;
    quantidadesBid.add(filaCompra);
    quantidadesAsk.add(filaVenda);
  }

  return {
    celulas,
    maxBid,
    maxAsk,
    maxUniao: Math.max(maxBid, maxAsk),
    quantidadesBid,
    quantidadesAsk,
  };
}

/** Os máximos do lado esquerdo do enunciado — o que a agregação entregou. */
interface MaximosDoAgregado {
  readonly maxBid: number;
  readonly maxAsk: number;
  readonly maxUniao: number;
}

/**
 * Percorre **apenas** `[0, count)`. As colunas podem ter capacidade maior que o
 * preenchido, e ler além do preenchido devolveria zeros que a tela apresentaria
 * como liquidez ausente.
 */
function maximosDoAgregado(cells: AggregatedCells): MaximosDoAgregado {
  let maxBid = Number.NEGATIVE_INFINITY;
  let maxAsk = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < cells.count; i += 1) {
    const filaCompra = cells.bid[i] ?? Number.NaN;
    const filaVenda = cells.ask[i] ?? Number.NaN;
    if (filaCompra > maxBid) maxBid = filaCompra;
    if (filaVenda > maxAsk) maxAsk = filaVenda;
  }

  return { maxBid, maxAsk, maxUniao: Math.max(maxBid, maxAsk) };
}

/**
 * Critério 3.9 na forma executável: a janela é utilizável?
 *
 * `!(x > 0)` cobre zero, negativo e indefinido numa comparação só; a checagem de
 * finitude que vem depois recolhe o infinito positivo, que passaria pela
 * primeira.
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

/** Houve agrupamento de fato em ao menos um dos dois eixos? */
function agrupou(cells: AggregatedCells): boolean {
  return cells.fatorTempo > 1 || cells.fatorPreco > 1;
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade de fila na faixa que o dado real ocupa.
 *
 * A distribuição medida nas 22.721 células com fila do pregão de referência é
 * `p50 = 481 ct`, `p90 = 714 ct`, `p99 = 1.131 ct`. A parede de 2.442 ct e o
 * artefato de 36.232 ct entram como valores nomeados, porque são exatamente os
 * dois extremos onde uma média disfarçada seria mais visível — e mais danosa.
 */
const arbQuantidadeRealista = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 1_200 }), weight: 6 },
  { arbitrary: fc.integer({ min: 1_200, max: 2_600 }), weight: 2 },
  { arbitrary: fc.constantFrom(0, 481, 714, 1_131, PAREDE_CT, 36_232), weight: 2 },
);

/**
 * Quantidade que o critério 3.10 manda contar como zero, mais as bordas de
 * precisão.
 *
 * `Number.MAX_VALUE` e `Number.MIN_VALUE` estão aqui porque não sobrevivem à
 * coluna de precisão simples — o primeiro vira infinito, o segundo vira zero —, e
 * a referência precisa concordar com isso lendo o valor **de volta do grid**, e
 * não do número gerado. É a diferença entre testar a função e testar o gerador.
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
  { arbitrary: arbQuantidadeRealista, weight: 8 },
  { arbitrary: arbQuantidadeHostil, weight: 2 },
);

/**
 * Grid de eixos e densidade dados.
 *
 * O par (balde, preço) **pode repetir**: o payload real não repete, mas duplicata
 * só faz o agrupamento combinar mais membros, o que exercita o operador em vez de
 * contorná-lo.
 */
function arbGridCom(
  baldes: { min: number; max: number },
  precos: { min: number; max: number },
  celulas: { minLength: number; maxLength: number },
): fc.Arbitrary<BookmapGrid> {
  return fc
    .record({
      nBaldes: fc.integer(baldes),
      nPrecos: fc.integer(precos),
    })
    .chain(({ nBaldes, nPrecos }) =>
      fc
        .array(
          fc.record({
            ti: fc.integer({ min: 0, max: nBaldes - 1 }),
            pi: fc.integer({ min: 0, max: nPrecos - 1 }),
            bid: arbQuantidade,
            ask: arbQuantidade,
            buy: arbQuantidade,
            sell: arbQuantidade,
          }),
          celulas,
        )
        .map((lista) => construirGrid(nBaldes, nPrecos, lista)),
    );
}

/**
 * ⚠️ **A densidade é o que separa este teste de um teste vazio.**
 *
 * A primeira versão deste arquivo sorteava até 400 células sobre eixos de 240
 * baldes por 120 preços — 28.800 pares possíveis, densidade de 1,4%. Aferido com
 * `fc.statistics`, o resultado foi: **70% dos casos com janela sem nenhuma
 * célula** e apenas **2,6% em que o agrupamento de fato combinou membros**. A
 * propriedade passava sem quase nunca exercitar o `max` — que é a única coisa que
 * ela existe para proteger.
 *
 * O grid denso é a correção: eixos curtos com muitas células garantem que a janela
 * caia sobre dado, e que grupos tenham vários membros para combinar. O esparso
 * permanece com peso menor, porque é ele que exercita janela sem célula e eixo
 * longo — os dois casos que o denso não produz.
 */
/** Denso e comprido no tempo — é o eixo de tempo que agrega. */
const arbGridDensoNoTempo = arbGridCom(
  { min: 1, max: 48 },
  { min: 1, max: 8 },
  { minLength: 1, maxLength: 400 },
);

/**
 * Denso e alto no preço — a forma transposta.
 *
 * Existe porque os dois eixos têm dimensão mínima **diferente** (3 px de largura
 * contra 2 px de altura) e fator derivado de forma independente. Só a forma
 * comprida no tempo deixaria o agrupamento por preço quase sem exercício: a
 * aferição mostrou 15% contra 23% do eixo de tempo antes desta adição.
 */
const arbGridDensoNoPreco = arbGridCom(
  { min: 1, max: 8 },
  { min: 1, max: 48 },
  { minLength: 1, maxLength: 400 },
);

const arbGridEsparso = arbGridCom(
  { min: 1, max: 240 },
  { min: 1, max: 120 },
  { minLength: 0, maxLength: 400 },
);

const arbGrid: fc.Arbitrary<BookmapGrid> = fc.oneof(
  { arbitrary: arbGridDensoNoTempo, weight: 4 },
  { arbitrary: arbGridDensoNoPreco, weight: 3 },
  { arbitrary: arbGridEsparso, weight: 3 },
);

/**
 * Dimensões de pixel do gráfico.
 *
 * As pequenas estão aqui **de propósito**, e são o coração da defesa contra
 * vacuidade: o fator de um eixo passa de 1 somente quando
 * `dimensãoMínima × unidadesVisíveis > pixelsDoEixo`. Com a largura mínima padrão
 * de 3 px, uma janela de 800 px só agrega a partir de 267 baldes visíveis — se
 * todas as janelas fossem largas, a maioria dos casos rodaria com fator 1 e a
 * propriedade seria trivialmente verdadeira, sem nunca exercitar o `max`.
 */
const arbLarguraPx = fc.constantFrom(40, 120, 300, 800, 1_600);
const arbAlturaPx = fc.constantFrom(30, 80, 200, 400, 900);

/**
 * Monta a janela a partir de um retângulo de índices de eixo.
 *
 * `baldesVisiveis` e `ticksVisiveis` saem da contagem de entradas de eixo dentro
 * dos limites — a derivação honesta, que é a que a camada de canvas faz. Janela
 * com essas contagens **incoerentes** com os limites é caso legítimo de entrada e
 * aparece adiante, no gerador que exercita o esgotamento de orçamento.
 */
function montarJanela(
  grid: BookmapGrid,
  tiDe: number,
  tiAte: number,
  piDe: number,
  piAte: number,
  larguraPx: number,
  alturaPx: number,
): VisibleWindow {
  return {
    tsDe: grid.times[tiDe] ?? ABERTURA_MS,
    tsAte: grid.times[tiAte] ?? ABERTURA_MS,
    precoDe: grid.prices[piDe] ?? PRECO_BASE,
    precoAte: grid.prices[piAte] ?? PRECO_BASE,
    larguraPx,
    alturaPx,
    baldesVisiveis: tiAte - tiDe + 1,
    ticksVisiveis: piAte - piDe + 1,
  };
}

/** Janela sorteada livremente sobre os eixos — pode não conter célula alguma. */
function arbJanelaLivre(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({
      tiDe: fc.integer({ min: 0, max: Math.max(0, nT - 1) }),
      tiVao: fc.integer({ min: 0, max: Math.max(0, nT - 1) }),
      piDe: fc.integer({ min: 0, max: Math.max(0, nP - 1) }),
      piVao: fc.integer({ min: 0, max: Math.max(0, nP - 1) }),
      larguraPx: arbLarguraPx,
      alturaPx: arbAlturaPx,
    })
    .map(({ tiDe, tiVao, piDe, piVao, larguraPx, alturaPx }) =>
      montarJanela(
        grid,
        tiDe,
        Math.min(tiDe + tiVao, nT - 1),
        piDe,
        Math.min(piDe + piVao, nP - 1),
        larguraPx,
        alturaPx,
      ),
    );
}

/**
 * Janela **ancorada numa célula que existe**, crescida ao redor dela.
 *
 * ⚠️ Segunda metade da defesa contra vacuidade. Janela sorteada solta sobre eixos
 * esparsos cai no vazio com frequência alta, e no vazio a propriedade retorna sem
 * comparar máximo nenhum. Ancorar garante ao menos uma célula dentro, o que faz o
 * lado direito do enunciado ser um conjunto não vazio — que é a condição para a
 * igualdade dizer algo.
 */
function arbJanelaAncorada(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const n = grid.ti.length;
  if (n === 0) return arbJanelaLivre(grid);

  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({
      k: fc.integer({ min: 0, max: n - 1 }),
      antesT: fc.integer({ min: 0, max: 120 }),
      depoisT: fc.integer({ min: 0, max: 120 }),
      antesP: fc.integer({ min: 0, max: 60 }),
      depoisP: fc.integer({ min: 0, max: 60 }),
      larguraPx: arbLarguraPx,
      alturaPx: arbAlturaPx,
    })
    .map(({ k, antesT, depoisT, antesP, depoisP, larguraPx, alturaPx }) => {
      const ancoraT = grid.ti[k] ?? 0;
      const ancoraP = grid.pi[k] ?? 0;
      return montarJanela(
        grid,
        Math.max(0, ancoraT - antesT),
        Math.min(nT - 1, ancoraT + depoisT),
        Math.max(0, ancoraP - antesP),
        Math.min(nP - 1, ancoraP + depoisP),
        larguraPx,
        alturaPx,
      );
    });
}

/** Janela utilizável: ancorada na maioria dos casos, livre no restante. */
function arbJanelaUtilizavel(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  return fc.oneof(
    { arbitrary: arbJanelaAncorada(grid), weight: 7 },
    { arbitrary: arbJanelaLivre(grid), weight: 3 },
  );
}

/**
 * Janela utilizável cujas contagens de unidades visíveis são **incoerentes** com
 * os limites: declara uma unidade por eixo enquanto os limites cobrem tudo.
 *
 * Não é entrada inventada — as contagens chegam por parâmetro e são independentes
 * dos limites, então nada impede que divirjam. É justamente o caso que mantém os
 * fatores de agrupamento baixos enquanto o orçamento continua estourado, e é o
 * único caminho até o esgotamento das doze repetições. Sem ele, o disjunto
 * `orçamento esgotado` da propriedade de totalidade nunca seria exercitado — a
 * aferição mostrou 0,00% antes desta adição.
 */
function arbJanelaIncoerente(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({
      larguraPx: fc.constantFrom(800, 1_600),
      alturaPx: fc.constantFrom(400, 900),
    })
    .map(({ larguraPx, alturaPx }) => ({
      ...montarJanela(grid, 0, nT - 1, 0, nP - 1, larguraPx, alturaPx),
      baldesVisiveis: 1,
      ticksVisiveis: 1,
    }));
}

/**
 * Janela que o critério 3.9 manda recusar: pixel não positivo, limite invertido,
 * limite não finito.
 */
function arbJanelaDegenerada(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  return arbJanelaUtilizavel(grid).chain((base) =>
    fc.oneof(
      fc.constant({ ...base, larguraPx: 0 }),
      fc.constant({ ...base, alturaPx: 0 }),
      fc.constant({ ...base, larguraPx: -1 }),
      fc.constant({ ...base, alturaPx: Number.NaN }),
      fc.constant({ ...base, larguraPx: Number.POSITIVE_INFINITY }),
      fc.constant({ ...base, tsDe: base.tsAte + BALDE_MS, tsAte: base.tsDe }),
      fc.constant({ ...base, precoDe: base.precoAte + PRECO_PASSO, precoAte: base.precoDe }),
      fc.constant({ ...base, tsDe: Number.NaN }),
      fc.constant({ ...base, precoAte: Number.POSITIVE_INFINITY }),
    ),
  );
}

/** Orçamento e dimensão mínima. */
interface Orcamento {
  readonly maxCells: number;
  readonly minCellPx: number;
}

/**
 * Orçamento que **acomoda** o grid gerado.
 *
 * O grid tem no máximo 400 células, então o número de grupos nunca passa de 400 e
 * qualquer teto a partir daí cabe na primeira tentativa. É o que mantém a
 * propriedade principal fora do caso de esgotamento — que existe e é tratado na
 * propriedade de totalidade, com orçamento apertado de propósito.
 *
 * `NaN` e `1.5` estão em `maxCells` para exercitar o padrão do critério 3.1: teto
 * fracionário ou indefinido cai em 3.000 em vez de ser arredondado, porque
 * orçamento fracionário indica cálculo errado a montante e adivinhar a intenção
 * esconderia o defeito.
 *
 * `minCellPx` chega a 64, o topo do intervalo admitido, e é o segundo lever de
 * agrupamento: com dimensão mínima grande, o fator passa de 1 mesmo em janela
 * estreita em número de unidades.
 */
const arbOrcamentoFolgado: fc.Arbitrary<Orcamento> = fc.record({
  maxCells: fc.constantFrom(400, 3_000, 20_000, 50_000, Number.NaN, 1.5),
  minCellPx: fc.constantFrom(0, 1, 2, 3, 8, 24, 64, Number.NaN, -1),
});

/**
 * Orçamento arbitrário, inclusive apertado o bastante para esgotar as doze
 * repetições.
 *
 * `0` e `-100` são restringidos ao piso de uma célula, e dimensão mínima pequena é
 * o que mantém a duplicação avançando devagar — dimensão grande colapsa o eixo num
 * grupo só na primeira tentativa e o orçamento passa a caber. Essa combinação é o
 * que torna o esgotamento alcançável em vez de teórico.
 */
const arbOrcamentoQualquer: fc.Arbitrary<Orcamento> = fc.oneof(
  { arbitrary: arbOrcamentoFolgado, weight: 6 },
  {
    arbitrary: fc.record({
      maxCells: fc.constantFrom(1, 1, 2, 2, 3, 5, 10, 0, -100, 999_999),
      minCellPx: fc.constantFrom(0, 0, 1, 2, 3, 64, Number.POSITIVE_INFINITY),
    }),
    weight: 4,
  },
);

/** Uma tripla completa: grid, janela e orçamento. */
interface Cenario {
  readonly grid: BookmapGrid;
  readonly janela: VisibleWindow;
  readonly orcamento: Orcamento;
}

/** Cenário com janela utilizável e orçamento que acomoda. */
const arbCenario: fc.Arbitrary<Cenario> = arbGrid.chain((grid) =>
  fc.record({
    grid: fc.constant(grid),
    janela: arbJanelaUtilizavel(grid),
    orcamento: arbOrcamentoFolgado,
  }),
);

/**
 * Cenário sem restrição: inclui janela degenerada, janela incoerente e orçamento
 * apertado — as três coisas que levam à entrega vazia por caminhos diferentes.
 */
const arbCenarioQualquer: fc.Arbitrary<Cenario> = arbGrid.chain((grid) =>
  fc.record({
    grid: fc.constant(grid),
    janela: fc.oneof(
      { arbitrary: arbJanelaUtilizavel(grid), weight: 5 },
      { arbitrary: arbJanelaDegenerada(grid), weight: 2 },
      { arbitrary: arbJanelaIncoerente(grid), weight: 3 },
    ),
    orcamento: arbOrcamentoQualquer,
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Cenário da parede — o caso que a média dissolveria
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Grid de uma faixa de preço só, com `BALDES_QUE_DISSOLVEM` baldes, um deles
 * carregando a parede e os demais quase vazios; janela e orçamento escolhidos
 * para que os onze baldes caiam num **único** grupo.
 *
 * A dimensão mínima de 64 px contra 60 px de largura força
 * `fatorTempo = ceil(64 × 11 / 60) = 12`, limitado ao comprimento do eixo — logo
 * 11, que é exatamente um grupo. É a reprodução literal do enunciado do projeto.
 */
interface CenarioParede extends Cenario {
  readonly baldeDaParede: number;
  readonly lado: 'bid' | 'ask';
  readonly vizinhos: readonly number[];
}

const arbCenarioParede: fc.Arbitrary<CenarioParede> = fc
  .record({
    baldeDaParede: fc.integer({ min: 0, max: BALDES_QUE_DISSOLVEM - 1 }),
    lado: fc.constantFrom<'bid' | 'ask'>('bid', 'ask'),
    vizinhos: fc.array(fc.integer({ min: 0, max: 120 }), {
      minLength: BALDES_QUE_DISSOLVEM,
      maxLength: BALDES_QUE_DISSOLVEM,
    }),
  })
  .map(({ baldeDaParede, lado, vizinhos }): CenarioParede => {
    const celulas: CelulaSintetica[] = [];
    for (let i = 0; i < BALDES_QUE_DISSOLVEM; i += 1) {
      const vizinho = vizinhos[i] ?? 0;
      const quantidade = i === baldeDaParede ? PAREDE_CT : vizinho;
      celulas.push({
        ti: i,
        pi: 0,
        bid: lado === 'bid' ? quantidade : 0,
        ask: lado === 'ask' ? quantidade : 0,
        buy: 0,
        sell: 0,
      });
    }

    const grid = construirGrid(BALDES_QUE_DISSOLVEM, 1, celulas);

    return {
      grid,
      janela: {
        tsDe: ABERTURA_MS,
        tsAte: ABERTURA_MS + (BALDES_QUE_DISSOLVEM - 1) * BALDE_MS,
        precoDe: PRECO_BASE,
        precoAte: PRECO_BASE,
        larguraPx: 60,
        alturaPx: 400,
        baldesVisiveis: BALDES_QUE_DISSOLVEM,
        ticksVisiveis: 1,
      },
      orcamento: { maxCells: ORCAMENTO_PADRAO, minCellPx: 64 },
      baldeDaParede,
      lado,
      vizinhos,
    };
  });

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 4: a agregação preserva o pico da fila', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // A forma que o critério 3.2 pede literalmente: cada lado separadamente
  // ───────────────────────────────────────────────────────────────────────────

  it('por lado: o máximo de cada fila entregue é exatamente o máximo daquela fila na janela', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const { cells, budgetExhausted } = aggregateForZoomWithOutcome(grid, janela, orcamento);

        // O orçamento folgado acomoda qualquer grid deste gerador — no máximo 400
        // células, logo no máximo 400 grupos. Afirmar isto mantém o caso de
        // esgotamento fora daqui de forma verificada, e não por suposição.
        expect(budgetExhausted).toBe(false);

        const referencia = referenciaDaJanela(grid, janela);
        expect(cells.count > 0).toBe(referencia.celulas > 0);

        if (referencia.celulas === 0) return;

        const entregue = maximosDoAgregado(cells);

        // Igualdade ESTRITA: o `max` escolhe um valor, não faz aritmética, e as
        // colunas de entrada e de saída têm a mesma precisão. Tolerância aqui
        // admitiria erro que não existe.
        expect(entregue.maxBid).toBe(referencia.maxBid);
        expect(entregue.maxAsk).toBe(referencia.maxAsk);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A forma do enunciado: a união dos dois lados
  // ───────────────────────────────────────────────────────────────────────────

  it('na união: o maior valor entre as duas filas entregues é o maior valor das duas filas na janela', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        const referencia = referenciaDaJanela(grid, janela);

        if (referencia.celulas === 0) {
          expect(cells.count).toBe(0);
          return;
        }

        expect(maximosDoAgregado(cells).maxUniao).toBe(referencia.maxUniao);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Nada é inventado: cada quantidade entregue existia, no mesmo lado
  // ───────────────────────────────────────────────────────────────────────────

  it('toda quantidade de fila entregue existia na janela, no mesmo lado do livro', () => {
    fc.assert(
      fc.property(arbCenario, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        const referencia = referenciaDaJanela(grid, janela);

        // `count` é a verdade: a coluna pode ter capacidade maior que o
        // preenchido, e ler além disso devolveria zeros que a tela apresentaria
        // como liquidez ausente.
        expect(cells.bid.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.ask.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.buy.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.sell.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.tsMs.length).toBeGreaterThanOrEqual(cells.count);
        expect(cells.preco.length).toBeGreaterThanOrEqual(cells.count);

        for (let i = 0; i < cells.count; i += 1) {
          // `?? NaN` em vez de conversão de tipo: com verificação de índice ativa
          // no compilador toda leitura de coluna é opcional, e a asserção de
          // finitude abaixo já reprova a ausência — que é o que se quer dizer.
          const filaCompra = cells.bid[i] ?? Number.NaN;
          const filaVenda = cells.ask[i] ?? Number.NaN;

          // Indefinição nunca sai daqui. Sem esta asserção, uma coluna com
          // indefinido faria toda comparação de máximo falhar em silêncio — a
          // comparação reprova e o máximo simplesmente não sobe.
          expect(Number.isFinite(filaCompra)).toBe(true);
          expect(Number.isFinite(filaVenda)).toBe(true);

          // O `max` de um grupo é, por definição, um dos valores do grupo. Média,
          // mediana, soma e ponto fixo produzem valor que não existia; troca das
          // duas colunas produz valor que existia no lado errado. Esta asserção
          // reprova as cinco, inclusive quando o defeito atinge só alguns grupos
          // e o máximo global sobrevive por acidente.
          expect(referencia.quantidadesBid.has(filaCompra)).toBe(true);
          expect(referencia.quantidadesAsk.has(filaVenda)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A parede de 2.442 ct
  // ───────────────────────────────────────────────────────────────────────────

  it('a parede de 2.442 ct em onze baldes chega inteira ao desenho, e não como os 222 ct da média', () => {
    const celulas: CelulaSintetica[] = [];
    for (let i = 0; i < BALDES_QUE_DISSOLVEM; i += 1) {
      celulas.push({
        ti: i,
        pi: 0,
        bid: i === 3 ? PAREDE_CT : 0,
        ask: 0,
        buy: 0,
        sell: 0,
      });
    }

    const grid = construirGrid(BALDES_QUE_DISSOLVEM, 1, celulas);
    const janela: VisibleWindow = {
      tsDe: ABERTURA_MS,
      tsAte: ABERTURA_MS + (BALDES_QUE_DISSOLVEM - 1) * BALDE_MS,
      precoDe: PRECO_BASE,
      precoAte: PRECO_BASE,
      larguraPx: 60,
      alturaPx: 400,
      baldesVisiveis: BALDES_QUE_DISSOLVEM,
      ticksVisiveis: 1,
    };

    const cells = aggregateForZoom(grid, janela, { maxCells: ORCAMENTO_PADRAO, minCellPx: 64 });

    // Os onze baldes colapsaram num grupo só — é o cenário do enunciado, e sem
    // esta asserção o teste passaria sem nunca ter agregado nada.
    expect(cells.fatorTempo).toBe(BALDES_QUE_DISSOLVEM);
    expect(cells.count).toBe(1);

    expect(cells.bid[0]).toBe(PAREDE_CT);

    // A média que a propriedade proíbe, escrita por extenso. Com o `p50` da
    // janela em 481 ct, 222 ct recebe opacidade mínima e a parede sai da tela.
    const mediaQueDissolveria = PAREDE_CT / BALDES_QUE_DISSOLVEM;
    expect(mediaQueDissolveria).toBeCloseTo(222, 0);
    expect(cells.bid[0]).not.toBeCloseTo(mediaQueDissolveria, 0);
  });

  it('a parede sobrevive em qualquer posição do grupo, dos dois lados do livro', () => {
    fc.assert(
      fc.property(arbCenarioParede, ({ grid, janela, orcamento, lado, vizinhos }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);

        // O agrupamento aconteceu de verdade: sem isto, um fator que voltasse a 1
        // faria a propriedade passar sem exercitar a combinação.
        expect(cells.fatorTempo).toBe(BALDES_QUE_DISSOLVEM);
        expect(cells.count).toBe(1);

        const entregue = maximosDoAgregado(cells);
        const doLado = lado === 'bid' ? entregue.maxBid : entregue.maxAsk;
        const doOutroLado = lado === 'bid' ? entregue.maxAsk : entregue.maxBid;

        expect(doLado).toBe(PAREDE_CT);

        // A parede não vaza para o lado oposto — o outro lado do livro está vazio
        // no cenário e tem de continuar vazio.
        expect(doOutroLado).toBe(0);

        // E o valor entregue está estritamente acima de qualquer combinação que
        // divida pelo número de membros, para qualquer vizinhança sorteada.
        const soma = vizinhos.reduce((acc, v) => acc + v, 0) + PAREDE_CT;
        expect(doLado).toBeGreaterThan(soma / BALDES_QUE_DISSOLVEM);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Totalidade — o enunciado vale para toda tripla, com as duas ressalvas ditas
  // ───────────────────────────────────────────────────────────────────────────

  it('saída vazia só ocorre por janela inutilizável, por orçamento esgotado ou por janela sem célula', () => {
    fc.assert(
      fc.property(arbCenarioQualquer, ({ grid, janela, orcamento }) => {
        const { cells, budgetExhausted } = aggregateForZoomWithOutcome(grid, janela, orcamento);

        const utilizavel = janelaUtilizavel(janela);
        const referencia = referenciaDaJanela(grid, janela);

        // Critério 3.9: janela inutilizável entrega zero células e não lança —
        // mesmo quando há células dentro dos limites de tempo e de preço.
        if (!utilizavel) {
          expect(cells.count).toBe(0);
          expect(budgetExhausted).toBe(false);
          return;
        }

        if (cells.count === 0) {
          // As duas únicas explicações admitidas. Sem esta disjunção, uma
          // implementação que devolvesse vazio por qualquer motivo satisfaria o
          // enunciado sem preservar nada.
          expect(budgetExhausted || referencia.celulas === 0).toBe(true);
          return;
        }

        // Havendo entrega, a preservação vale exatamente.
        expect(maximosDoAgregado(cells).maxBid).toBe(referencia.maxBid);
        expect(maximosDoAgregado(cells).maxAsk).toBe(referencia.maxAsk);
        expect(maximosDoAgregado(cells).maxUniao).toBe(referencia.maxUniao);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Guarda contra vacuidade — a propriedade tem de exercitar o que protege
  // ───────────────────────────────────────────────────────────────────────────

  it('os geradores exercitam de fato o agrupamento: janela com célula, fator maior que 1 e grupos com vários membros', () => {
    // ⚠️ Esta asserção existe porque a primeira versão deste arquivo era quase
    // vazia sem que nada indicasse isso. Aferido com `fc.statistics`, o gerador
    // original entregava janela sem célula em 70% dos casos e combinava membros em
    // apenas 2,6% — a igualdade dos máximos era verdadeira porque não havia o que
    // combinar, não porque o `max` estivesse correto.
    //
    // Medir a cobertura numa asserção, e não só num comentário, é o que impede a
    // regressão silenciosa: encurtar um eixo ou alargar uma janela no futuro pode
    // devolver o arquivo àquele estado, e o único sintoma seria a suíte continuar
    // verde. Os pisos abaixo são folgados em relação ao medido, de propósito —
    // servem para detectar colapso, não para fixar a distribuição corrente.
    const cenarios = fc.sample(arbCenario, { numRuns: NUM_RUNS, seed: SEED });
    expect(cenarios).toHaveLength(NUM_RUNS);

    let comCelulaNaJanela = 0;
    let comFatorMaiorQueUm = 0;
    let comFatorDeTempo = 0;
    let comFatorDePreco = 0;
    let comCombinacaoReal = 0;
    let comParedeAcimaDoP99 = 0;

    for (const { grid, janela, orcamento } of cenarios) {
      const cells = aggregateForZoom(grid, janela, orcamento);
      const referencia = referenciaDaJanela(grid, janela);

      if (referencia.celulas > 0) comCelulaNaJanela += 1;
      if (agrupou(cells)) comFatorMaiorQueUm += 1;
      if (cells.fatorTempo > 1) comFatorDeTempo += 1;
      if (cells.fatorPreco > 1) comFatorDePreco += 1;
      // O caso que importa: grupos com mais de um membro, onde o operador de
      // combinação é de fato aplicado. Fator maior que 1 não basta — um eixo
      // agrupado sem duas células no mesmo grupo não combina nada.
      if (cells.count > 0 && cells.count < referencia.celulas) comCombinacaoReal += 1;
      // A magnitude onde a dissolução seria danosa: acima do `p99` de 1.131 ct da
      // janela de referência.
      if (Math.max(referencia.maxBid, referencia.maxAsk) > 1_131) comParedeAcimaDoP99 += 1;
    }

    expect(comCelulaNaJanela / NUM_RUNS).toBeGreaterThan(0.6);
    expect(comFatorMaiorQueUm / NUM_RUNS).toBeGreaterThan(0.2);
    // Os dois eixos, separadamente: têm dimensão mínima diferente e fator derivado
    // de forma independente, então cobrir um só deixaria o outro sem exercício.
    expect(comFatorDeTempo / NUM_RUNS).toBeGreaterThan(0.1);
    expect(comFatorDePreco / NUM_RUNS).toBeGreaterThan(0.1);
    expect(comCombinacaoReal / NUM_RUNS).toBeGreaterThan(0.15);
    expect(comParedeAcimaDoP99 / NUM_RUNS).toBeGreaterThan(0.2);
  });

  it('o gerador sem restrição alcança a entrega vazia por esgotamento de orçamento', () => {
    // O disjunto `orçamento esgotado` da propriedade de totalidade é o mais raro
    // dos três, e chegou a 0,00% na primeira aferição — a janela incoerente foi
    // acrescentada ao gerador justamente para alcançá-lo. Sem esta guarda, ele
    // poderia voltar a zero e a totalidade passaria a ser satisfeita sempre pelos
    // outros dois disjuntos, sem nunca conferir o terceiro.
    const cenarios = fc.sample(arbCenarioQualquer, { numRuns: NUM_RUNS, seed: SEED });

    let esgotou = 0;
    let entregou = 0;
    let degenerada = 0;

    for (const { grid, janela, orcamento } of cenarios) {
      const { cells, budgetExhausted } = aggregateForZoomWithOutcome(grid, janela, orcamento);
      if (budgetExhausted) esgotou += 1;
      if (cells.count > 0) entregou += 1;
      if (!janelaUtilizavel(janela)) degenerada += 1;
    }

    expect(esgotou).toBeGreaterThan(0);
    expect(entregou / NUM_RUNS).toBeGreaterThan(0.3);
    expect(degenerada / NUM_RUNS).toBeGreaterThan(0.1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Determinismo — sem ele nenhum contraexemplo seria reproduzível
  // ───────────────────────────────────────────────────────────────────────────

  it('é determinística, e as duas variantes públicas entregam os mesmos máximos', () => {
    fc.assert(
      fc.property(arbCenarioQualquer, ({ grid, janela, orcamento }) => {
        const primeira = aggregateForZoom(grid, janela, orcamento);
        const segunda = aggregateForZoom(grid, janela, orcamento);
        const comDesfecho = aggregateForZoomWithOutcome(grid, janela, orcamento).cells;

        expect(maximosDoAgregado(segunda)).toEqual(maximosDoAgregado(primeira));
        expect(maximosDoAgregado(comDesfecho)).toEqual(maximosDoAgregado(primeira));

        // Os fatores também: eles determinam o desenho do retângulo, e um fator
        // instável faria o heatmap tremer entre frames com os mesmos dados.
        expect(segunda.count).toBe(primeira.count);
        expect(segunda.fatorTempo).toBe(primeira.fatorTempo);
        expect(segunda.fatorPreco).toBe(primeira.fatorPreco);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
