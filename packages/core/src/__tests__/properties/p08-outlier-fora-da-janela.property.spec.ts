/**
 * Property 8 — A escala é robusta a outlier fora da janela. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 2.7.
 *
 * ```
 * ∀ grid, window, v arbitrariamente grande, preço fora de window:
 *     cores(grid, window) === cores(grid + célula(v, fora), window)
 * ```
 *
 * **Validates: Requirements 2.5, 2.11**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE — DERIVADA DE MEDIÇÃO, NÃO DE TEORIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medido nas 22.721 células com fila maior que zero do pregão de referência:
 *
 *     p50      481 ct
 *     p90      714 ct
 *     p99    1.131 ct
 *     max   36.232 ct     ← 32× o p99
 *
 * E o máximo **não é parede**: é **nível cruzado** — venda de 36.232 ct em
 * 160.040 com o mercado em 177.000 (10% abaixo), e compra de 29.036 ct em
 * 195.600 (10% acima). Ofertas assim seriam executáveis no instante em que
 * existissem: artefato de agregação, não liquidez.
 *
 * Essa célula real não pode alterar **em nada** as cores das 22.721 células que
 * o operador está olhando. Escala global falha esta propriedade; percentil da
 * janela visível passa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS DUAS CLÁUSULAS, E POR QUE SÃO DIFERENTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O requisito virou **dois** critérios, e a tabela de rastreabilidade aponta
 * para ambos:
 *
 * - **2.5 — outlier FORA da janela**: `p50`, `p99` e as opacidades das células
 *   dentro da janela são **idênticos** aos que seriam produzidos sem a célula
 *   externa. Igualdade exata, sem tolerância.
 * - **2.11 — outlier DENTRO da janela**: aqui a igualdade é impossível (a
 *   amostra mudou), então o critério é mais fraco e mais fino: o `p99` difere em
 *   **no máximo um posto de percentil**, e toda quantidade igual ao `p90` da
 *   janela recebe opacidade **não inferior a 30% da amplitude** entre
 *   `alphaMin` e `alphaMax`.
 *
 * O mecanismo que dá a robustez está documentado em `bookmap-color.core`: o
 * percentil é o **posto** `ceil(q·n) − 1`, colhido por seleção parcial. Inserir
 * um valor cresce a amostra de `n` para `n+1` e o desloca para o topo da
 * ordenação, então todo posto abaixo dele fica intacto e o posto do p99 anda no
 * máximo uma casa. Nos números medidos, `idx99` sai de 22.493 para 22.494.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO A PROPRIEDADE FOI TORNADA NÃO-VÁCUA — leia antes de simplificar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Escrita de forma ingênua, a cláusula 2.5 é **tautológica**: se o próprio teste
 * filtrasse as células pela janela com um laço próprio, a célula externa sairia
 * pelo filtro do teste e a igualdade seria verdadeira por construção, sem
 * exercitar linha alguma de produção.
 *
 * Três decisões evitam isso, e nenhuma é ornamento:
 *
 * 1. **O recorte é o de produção.** `cores(grid, window)` é composto por
 *    `aggregateForZoom` — a função que de fato restringe o grid à janela — e só
 *    então pela escala. O orçamento é escolhido para forçar **fator de
 *    agrupamento unitário** (afirmado dentro de cada propriedade, para que uma
 *    deriva de gerador falhe alto em vez de silenciar), o que torna o recorte
 *    equivalente ao recorte simples e mantém a comparação entre as duas
 *    execuções válida célula a célula.
 *
 * 2. **A célula externa é acrescentada ao GRID, não à amostra.** Ela entra nos
 *    eixos, reindexa preços e instantes acima dela, e passa pelo recorte real.
 *    Se o recorte deixasse de excluí-la, a propriedade quebraria.
 *
 * 3. **Há dentes explícitos.** Toda cláusula de igualdade vem acompanhada de uma
 *    afirmação de que o outlier **está mesmo lá e é alcançável**: o máximo
 *    calculado sobre o grid inteiro muda, enquanto o da janela não. É a
 *    demonstração direta do argumento do projeto — uma escala ancorada no máximo
 *    global cairia; a de percentil da janela não.
 *
 * E há um quarto caminho, que é o modo realista de a informação externa vazar
 * para dentro da escala: o contrato de `AggregatedCells` admite **capacidade
 * maior que o preenchido** (`count` é a verdade, não `length`). Um chamador que
 * reaproveite um buffer do tamanho do grid e informe apenas a contagem da janela
 * deixa o outlier fisicamente dentro do array entregue. A propriedade do buffer
 * com cauda cobre exatamente isso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ CONTRAEVIDÊNCIA: DUAS CONDIÇÕES SOB AS QUAIS O PISO DE 30% NÃO VALE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O piso de 30% do requisito 2.11 **não é uma propriedade só da
 * implementação**: é uma afirmação conjunta sobre a implementação e a **forma da
 * distribuição**. Duas condições precisam valer, e as duas estão declaradas aqui
 * em vez de escondidas no gerador.
 *
 * **(a) `p90 > p50`.** Numa distribuição em que os dois coincidam (massa
 * concentrada num valor único com cauda rala), o 2.11 pediria 30% da amplitude
 * para uma quantidade que o requisito 2.3 obriga a receber `alphaMin` — os dois
 * só são satisfazíveis quando `p90 > p50`. A implementação honra o 2.3, que é o
 * que impede a camada de mentir, e essa escolha está registrada no cabeçalho de
 * `bookmap-color.core`. Aqui, os geradores produzem amostras **com dispersão**,
 * que é a forma do dado real, e a condição é **afirmada** em cada execução — não
 * pressuposta.
 *
 * **(b) A amostra da janela precisa ter ao menos 99 quantidades positivas.**
 * Esta condição não estava no enunciado e apareceu na aritmética dos postos:
 *
 *     idx99(n+1) ≤ n−1  ⟺  ceil(0,99·(n+1)) ≤ n  ⟺  n ≥ 99
 *
 * Abaixo de 99, o posto do p99 da amostra ampliada é o **último**, isto é, o
 * próprio outlier. O `p99` então salta para a magnitude do artefato, a amplitude
 * `p99 − p50` explode e a posição relativa do p90 tende a zero: o piso de 30%
 * deixa de valer. Note que o deslocamento de **um posto** continua verdadeiro
 * nesse regime — o que se perde é o piso, não a robustez do posto.
 *
 * O caso que o próprio requisito cita vive folgadamente acima do limiar: 22.721
 * células. Os geradores da cláusula 2.11 produzem, por construção, amostra
 * grande, e a propriedade **afirma** `n ≥ 99` para que a condição seja
 * deliberada e visível.
 *
 * Uma terceira condição, mais frouxa, também é distribucional e vale a pena
 * registrar: com `gamma = 0,5` o piso de 30% exige
 * `(p90 − p50) ≥ 0,09 · (p99 − p50)`. No caso medido isso é `233 ≥ 58,5` —
 * folga de 4×. A última propriedade do arquivo afirma essa fronteira de forma
 * **exata e independente de distribuição**, para que o limite fique medido em
 * vez de suposto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AFERIÇÃO DOS GERADORES — medida, não presumida
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A instrumentação de distribuição foi rodada sobre os dois cenários, 500
 * execuções, semente 42, e depois removida. O que ela mediu:
 *
 *     cenário FORA (cláusula 2.5)
 *       células excluídas pela janela ....... 12 em 100% das execuções
 *       o outlier entrou no recorte ......... 0%          ← nunca
 *       p99 > p50 (escala com faixa útil) ... 100%        ← nunca degenerada
 *       modo de exclusão .................... 21–28% cada, nos quatro
 *       células dentro da janela ............ 42% em 25–59 · 42% abaixo de 25
 *                                             16% em 60 ou mais
 *
 *     cenário DENTRO (cláusula 2.11)
 *       amostra positiva abaixo de 99 ....... 0%          ← a condição (b) vale
 *       p90 > p50 ........................... 100%        ← a condição (a) vale
 *       o p99 virou o outlier ............... 0%          ← o posto anda 1 casa
 *       posição relativa t .................. mínimo na faixa 0,12–0,16
 *                                             67% em 0,20–0,30 · 21% acima
 *       fração da amplitude no p90 .......... mínimo na faixa 0,35–0,40
 *                                             49% em 0,50–0,60 · 6% acima
 *
 * Duas leituras que importam. Primeira: **nada é vácuo** — a janela sempre
 * exclui células, a escala nunca colapsa, e os quatro caminhos de exclusão são
 * exercitados de forma equilibrada. Segunda: **o piso de 30% tem folga medida** —
 * a menor fração observada fica entre 0,35 e 0,40, e `t` nunca se aproxima do
 * limiar de 0,09 (mínimo entre 0,12 e 0,16, contra 0,358 do caso real). A
 * cláusula passa por margem, não por sorte de arredondamento.
 *
 * ⚠️ A cláusula 2.5 é exercitada em boa parte com amostra **abaixo** de 99
 * (41% abaixo de 30 posições). Isso é desejável e não contradiz a condição (b):
 * a igualdade exata do 2.5 não depende do tamanho da amostra, e esse regime é
 * justamente onde o comportamento do posto do p99 seria diferente — cobri-lo
 * amplia o alcance em vez de reduzi-lo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são o módulo público do núcleo puro e a
 * biblioteca de teste. O fechamento transitivo do núcleo é: os arquivos irmãos
 * da mesma pasta, mais um utilitário de formatação de horário alcançado pela
 * parte de cobertura. Nenhum deles alcança camada de conexão, de feed de
 * cotação, de envio de ordem ou de estado de conta, e nenhum carrega endereço de
 * rede, credencial nem identificador de conta.
 *
 * Todo insumo é sintetizado pelos geradores; nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato. Nada aqui emite
 * evento de decisão nem escreve em lugar algum.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente, nem como exemplo do que evitar: a verificação de independência
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  aggregateForZoom,
  alphaOf,
  computeColorScale,
  computeColorScalePair,
  isAboveScale,
  positiveQuantileOfPair,
  BOOKMAP_ALPHA_MAX_DEFAULT,
  BOOKMAP_ALPHA_MIN_DEFAULT,
  BOOKMAP_GAMMA_DEFAULT,
  type AggregatedCells,
  type BookmapGrid,
  type ColorScale,
  type VisibleWindow,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso acontece aqui.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** Único balde materializado. */
const BALDE_MS = 60_000;

/** Tick do contrato de índice. */
const TICK = 5;

/** Miolo do pregão de referência — a região que o operador está olhando. */
const PRECO_MERCADO = 177_000;

/** Maior fila realista dentro da banda do miolo, medida. */
const MAX_FILA_REALISTA = 2_442;

/**
 * Piso de magnitude do outlier quando a propriedade depende de ele ser o
 * **máximo estrito** da amostra.
 *
 * ⚠️ Acima de `10³`, e de propósito. A faixa do projeto para o gerador é
 * `10³–10⁶`, mas a fila realista alcança 2.442 ct: um valor de 1.000 ct **não é
 * outlier**, é miolo. Onde a propriedade fala do máximo ou do posto do p99, a
 * magnitude precisa superar a amostra inteira, senão a afirmação seria sobre
 * outra coisa. A faixa completa `10³–10⁶` é exercitada na cláusula 2.5, onde a
 * magnitude é irrelevante — o que exclui a célula ali é a **posição**, não o
 * tamanho.
 */
const MAGNITUDE_ESTRITA_MIN = 3_000;

/** Teto da faixa de magnitude do projeto. */
const MAGNITUDE_MAX = 1_000_000;

/** Fração da amplitude de opacidade que o `p90` da janela precisa alcançar. */
const PISO_AMPLITUDE_P90 = 0.3;

/** Quantis de interesse, na notação da escala. */
const Q_P50 = 0.5;
const Q_P90 = 0.9;
const Q_P99 = 0.99;
/** Quantil do máximo — é por ele que os dentes das cláusulas são afirmados. */
const Q_MAX = 1;

/**
 * Orçamento escolhido para forçar **fator de agrupamento unitário**.
 *
 * Com fator 1 o agrupamento é célula a célula, então `aggregateForZoom` degenera
 * exatamente no recorte pela janela — o que torna as duas execuções (com e sem a
 * célula externa) comparáveis coluna a coluna. Fator maior que 1 combinaria
 * células por `max` e por `sum`, e a reindexação do eixo de preço provocada pela
 * inserção do outlier poderia mudar a composição dos grupos: a propriedade
 * passaria a medir a agregação em vez da escala.
 *
 * O fator unitário é **afirmado** em cada propriedade, não apenas pretendido.
 */
const ORCAMENTO: { maxCells: number; minCellPx: number } = {
  maxCells: 20_000,
  minCellPx: 1,
};

// ═════════════════════════════════════════════════════════════════════════════
// Modelo de célula e construção de grid
// ═════════════════════════════════════════════════════════════════════════════

/** Uma célula do heatmap, na forma verbosa (a que o eixo é derivado). */
interface Celula {
  readonly tsMs: number;
  readonly preco: number;
  readonly bid: number;
  readonly ask: number;
  readonly buy: number;
  readonly sell: number;
}

/** As quatro quantidades de uma célula, sem coordenada. */
interface Lados {
  readonly bid: number;
  readonly ask: number;
  readonly buy: number;
  readonly sell: number;
}

const LADOS_ZERADOS: Lados = { bid: 0, ask: 0, buy: 0, sell: 0 };

function tempoDoIndice(indice: number): number {
  return ABERTURA_MS + indice * BALDE_MS;
}

function precoDoOffset(offset: number): number {
  return PRECO_MERCADO + offset * TICK;
}

/**
 * Monta o grid a partir da lista de células, derivando os eixos como o
 * decodificador faz: ordenados de forma estritamente crescente e deduplicados.
 *
 * É isto que faz "grid + célula" ser a operação do enunciado e não uma
 * conveniência: acrescentar uma célula pode **inserir** um preço ou um instante
 * no meio do eixo e reindexar tudo acima dela. A propriedade tem de sobreviver a
 * essa reindexação, e não apenas a um `push` no fim de um array.
 *
 * Pré-condição dos geradores: nenhum par `(tsMs, preco)` repetido — as
 * coordenadas reservadas de cada família de célula garantem isso por
 * construção.
 */
function construirGrid(celulas: readonly Celula[]): BookmapGrid {
  const times = Array.from(new Set(celulas.map((c) => c.tsMs))).sort((a, b) => a - b);
  const prices = Array.from(new Set(celulas.map((c) => c.preco))).sort((a, b) => a - b);

  const indiceDoTempo = new Map<number, number>(times.map((t, i) => [t, i]));
  const indiceDoPreco = new Map<number, number>(prices.map((p, i) => [p, i]));

  const total = celulas.length;
  const ti = new Uint32Array(total);
  const pi = new Uint32Array(total);
  const bid = new Float32Array(total);
  const ask = new Float32Array(total);
  const buy = new Float32Array(total);
  const sell = new Float32Array(total);

  celulas.forEach((c, k) => {
    ti[k] = indiceDoTempo.get(c.tsMs) ?? 0;
    pi[k] = indiceDoPreco.get(c.preco) ?? 0;
    bid[k] = c.bid;
    ask[k] = c.ask;
    buy[k] = c.buy;
    sell[k] = c.sell;
  });

  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-28',
    baldeSeg: 60,
    times: Float64Array.from(times),
    prices: Float64Array.from(prices),
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    cobertura: null,
  };
}

/**
 * Janela visível a partir dos limites, com pixels por unidade suficientes para
 * que a dimensão mínima de 1 px seja alcançada sem agrupamento (fator 1).
 */
function janela(
  tsDe: number,
  tsAte: number,
  precoDe: number,
  precoAte: number,
): VisibleWindow {
  const baldesVisiveis = Math.max(1, Math.round((tsAte - tsDe) / BALDE_MS) + 1);
  const ticksVisiveis = Math.max(1, Math.round((precoAte - precoDe) / TICK) + 1);
  return {
    tsDe,
    tsAte,
    precoDe,
    precoAte,
    larguraPx: baldesVisiveis * 4,
    alturaPx: ticksVisiveis * 4,
    baldesVisiveis,
    ticksVisiveis,
  };
}

/** `cores(grid, window)`, primeira metade: o recorte de produção. */
function recortar(grid: BookmapGrid, visible: VisibleWindow): AggregatedCells {
  return aggregateForZoom(grid, visible, ORCAMENTO);
}

// ═════════════════════════════════════════════════════════════════════════════
// Leitura das saídas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As `count` primeiras posições de uma coluna, como array comum.
 *
 * ⚠️ Recorta por `count` e não por `length` porque é `count` que é a verdade no
 * contrato de `AggregatedCells`.
 */
function colunaVisivel(coluna: Float32Array, count: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) out.push(coluna[k] ?? 0);
  return out;
}

/**
 * A amostra de percentis de uma grandeza, ordenada — referência independente da
 * seleção parcial do núcleo.
 *
 * Mesma regra do núcleo: os dois lados entram na **mesma** amostra
 * (requisito 2.9) e o zero fica fora (requisito 2.2). A ordem de coleta é
 * irrelevante: percentil é função do multiconjunto.
 */
function amostraOrdenada(cells: AggregatedCells): number[] {
  const out: number[] = [];
  for (let k = 0; k < cells.count; k += 1) {
    const b = cells.bid[k] ?? 0;
    if (b > 0 && Number.isFinite(b)) out.push(b);
    const a = cells.ask[k] ?? 0;
    if (a > 0 && Number.isFinite(a)) out.push(a);
  }
  return out.sort((x, y) => x - y);
}

/**
 * Posto da estatística de ordem que representa o quantil — a aritmética que
 * sustenta a cláusula "no máximo um posto".
 */
function postoDoQuantil(q: number, n: number): number {
  if (n <= 0) return 0;
  const idx = Math.ceil(q * n) - 1;
  if (idx < 0) return 0;
  if (idx > n - 1) return n - 1;
  return idx;
}

/** Máximo da grandeza de fila sobre o grid **inteiro**, sem recorte de janela. */
function maximoDoGrid(grid: BookmapGrid): number {
  return positiveQuantileOfPair(grid.bid, grid.ask, grid.bid.length, Q_MAX);
}

/**
 * Buffer de capacidade maior que o preenchido: o prefixo é a janela, a cauda é o
 * que um chamador poderia ter deixado no mesmo array.
 */
function estenderBuffer(
  coluna: Float32Array,
  count: number,
  cauda: readonly number[],
): Float32Array {
  const out = new Float32Array(count + cauda.length);
  for (let k = 0; k < count; k += 1) out[k] = coluna[k] ?? 0;
  cauda.forEach((v, i) => {
    out[count + i] = v;
  });
  return out;
}

/** Cópia defensiva para conferir que a função sob teste não mutou a entrada. */
function copiar(coluna: Float32Array): number[] {
  return Array.from(coluna);
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores de quantidade
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fila com a **forma medida** da distribuição, e é a forma que sustenta o piso
 * de 30% do requisito 2.11.
 *
 * Os pesos reproduzem os quantis do pregão de referência — p50 481, p90 714,
 * p99 1.131, máximo do miolo 2.442 —, com massa suficiente entre o p50 e o p90
 * para que `p90 > p50` com folga. Gerador uniforme em faixa larga produziria
 * `p90` colado no `p50` e transformaria a contraevidência declarada no
 * cabeçalho em falha intermitente.
 */
const arbFilaRealista = fc.oneof(
  { arbitrary: fc.integer({ min: 380, max: 620 }), weight: 60 },
  { arbitrary: fc.integer({ min: 620, max: 830 }), weight: 25 },
  { arbitrary: fc.integer({ min: 830, max: 1_300 }), weight: 12 },
  { arbitrary: fc.integer({ min: 1_300, max: MAX_FILA_REALISTA }), weight: 3 },
);

/** Fila que pode ser ausente — zero significa ausência de liquidez, não fila fraca. */
const arbFilaOuAusente = fc.oneof(
  { arbitrary: arbFilaRealista, weight: 6 },
  { arbitrary: fc.constant(0), weight: 4 },
);

/** Execução no balde, ordem de grandeza menor que a fila em repouso. */
const arbExecucaoOuAusente = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 400 }), weight: 6 },
  { arbitrary: fc.constant(0), weight: 4 },
);

/**
 * Magnitude do outlier na faixa completa do projeto, `10³–10⁶`.
 *
 * Usada só onde a magnitude é irrelevante para a afirmação — a cláusula 2.5
 * exclui a célula pela **posição**, não pelo tamanho. Inclui os dois níveis
 * cruzados medidos e as duas bordas da faixa.
 */
const arbMagnitudeQualquer = fc.oneof(
  { arbitrary: fc.constantFrom(36_232, 29_036), weight: 3 },
  { arbitrary: fc.integer({ min: 1_000, max: MAGNITUDE_MAX }), weight: 4 },
  { arbitrary: fc.constantFrom(1_000, MAGNITUDE_MAX), weight: 2 },
);

/**
 * Magnitude que supera a amostra inteira — usada onde a afirmação é sobre o
 * máximo ou sobre o posto do p99. Ver `MAGNITUDE_ESTRITA_MIN`.
 */
const arbMagnitudeEstrita = fc.oneof(
  { arbitrary: fc.constantFrom(36_232, 29_036), weight: 3 },
  { arbitrary: fc.integer({ min: MAGNITUDE_ESTRITA_MIN, max: MAGNITUDE_MAX }), weight: 5 },
  { arbitrary: fc.constantFrom(MAGNITUDE_ESTRITA_MIN, MAGNITUDE_MAX), weight: 2 },
);

/**
 * Distância do outlier até a borda da janela, em ticks.
 *
 * Cobre o artefato **logo além** da borda e o **muito distante** — 3.392 e 3.720
 * ticks são exatamente os 16.960 e 18.600 pontos dos dois níveis cruzados
 * medidos.
 */
const arbDeslocamentoTicks = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 8 }), weight: 3 },
  { arbitrary: fc.constantFrom(3_392, 3_720), weight: 3 },
  { arbitrary: fc.integer({ min: 100, max: 4_000 }), weight: 2 },
);

const arbLadoDoOutlier = fc.constantFrom<'BID' | 'ASK'>('BID', 'ASK');

// ═════════════════════════════════════════════════════════════════════════════
// Geometria dos cenários
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mapa de coordenadas reservadas, por família de célula. É o que garante a
 * unicidade de `(tsMs, preco)` sem rejeição de amostra:
 *
 *     eixo de tempo (índice de balde)
 *       0 .. nBaldes-1        bloco denso, DENTRO da janela
 *       nBaldes               reservado ao outlier interno (cláusula 2.11)
 *       nBaldes+1 .. +4       células fora da janela por TEMPO
 *       nBaldes+10            reservado ao outlier externo por tempo
 *
 *     eixo de preço (offset de tick a partir do miolo)
 *       0 .. nTicks-1         bloco denso, DENTRO da janela
 *       -4 .. -1              células fora por PREÇO, abaixo
 *       nTicks .. nTicks+3    células fora por PREÇO, acima
 *       ≤ -5  ou  ≥ nTicks+4  reservado ao outlier externo por preço
 */
interface Geometria {
  readonly nBaldes: number;
  readonly nTicks: number;
}

/** Bloco denso dentro da janela, uma célula por par `(balde, tick)`. */
function celulasDensas(geo: Geometria, lados: readonly Lados[]): Celula[] {
  const out: Celula[] = [];
  let k = 0;
  for (let i = 0; i < geo.nBaldes; i += 1) {
    for (let j = 0; j < geo.nTicks; j += 1) {
      const l = lados[k] ?? LADOS_ZERADOS;
      out.push({ tsMs: tempoDoIndice(i), preco: precoDoOffset(j), ...l });
      k += 1;
    }
  }
  return out;
}

/**
 * Coordenadas fora da janela com quantidade **normal**.
 *
 * Existem para que o recorte tenha trabalho real antes de o outlier entrar: sem
 * elas, a janela abrangeria o grid inteiro e a exclusão por limite nunca seria
 * exercitada.
 */
function coordenadasFora(geo: Geometria): ReadonlyArray<readonly [number, number]> {
  const coords: Array<readonly [number, number]> = [];
  const baldeInterno = Math.min(1, geo.nBaldes - 1);
  // Fora por preço — abaixo e acima da faixa, em instante DENTRO da janela.
  for (let d = 1; d <= 4; d += 1) coords.push([0, -d]);
  for (let d = 0; d < 4; d += 1) coords.push([baldeInterno, geo.nTicks + d]);
  // Fora por tempo — em preço DENTRO da faixa.
  for (let d = 0; d < 4; d += 1) {
    coords.push([geo.nBaldes + 1 + d, Math.min(d, geo.nTicks - 1)]);
  }
  return coords;
}

function celulasFora(geo: Geometria, lados: readonly Lados[]): Celula[] {
  return coordenadasFora(geo).map(([i, j], k) => ({
    tsMs: tempoDoIndice(i),
    preco: precoDoOffset(j),
    ...(lados[k] ?? LADOS_ZERADOS),
  }));
}

/** Por onde o outlier fica fora da janela. */
type ModoFora = 'PRECO_ABAIXO' | 'PRECO_ACIMA' | 'TEMPO_DEPOIS' | 'AMBOS_FORA';

const arbModoFora = fc.constantFrom<ModoFora>(
  'PRECO_ABAIXO',
  'PRECO_ACIMA',
  'TEMPO_DEPOIS',
  'AMBOS_FORA',
);

/**
 * A célula do outlier.
 *
 * A magnitude vai para **um** lado da fila e para o lado correspondente da
 * execução — um só positivo por grandeza, que é o que a aritmética do posto
 * exige e o que o artefato real é (uma ponta cruzada, não as duas).
 */
function celulaOutlier(tsMs: number, preco: number, lado: 'BID' | 'ASK', magnitude: number): Celula {
  return lado === 'BID'
    ? { tsMs, preco, bid: magnitude, ask: 0, buy: magnitude, sell: 0 }
    : { tsMs, preco, bid: 0, ask: magnitude, buy: 0, sell: magnitude };
}

function outlierFora(
  geo: Geometria,
  modo: ModoFora,
  deslocTicks: number,
  lado: 'BID' | 'ASK',
  magnitude: number,
): Celula {
  const abaixo = precoDoOffset(-(4 + deslocTicks));
  const acima = precoDoOffset(geo.nTicks + 3 + deslocTicks);
  const depois = tempoDoIndice(geo.nBaldes + 10);
  switch (modo) {
    case 'PRECO_ABAIXO':
      return celulaOutlier(tempoDoIndice(0), abaixo, lado, magnitude);
    case 'PRECO_ACIMA':
      return celulaOutlier(tempoDoIndice(0), acima, lado, magnitude);
    case 'TEMPO_DEPOIS':
      return celulaOutlier(depois, precoDoOffset(0), lado, magnitude);
    case 'AMBOS_FORA':
      return celulaOutlier(depois, abaixo, lado, magnitude);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Cenário da cláusula 2.5 — outlier FORA da janela
// ═════════════════════════════════════════════════════════════════════════════

interface CenarioFora {
  readonly semOutlier: readonly Celula[];
  readonly comOutlier: readonly Celula[];
  readonly outlier: Celula;
  readonly magnitude: number;
  readonly modo: ModoFora;
  readonly window: VisibleWindow;
}

/**
 * Cenário com a célula externa, parametrizado pela faixa de magnitude.
 *
 * ⚠️ `chain` é necessário porque o bloco denso tem tamanho dependente: são
 * `nBaldes × nTicks` conjuntos de quantidades. Gerar um array de tamanho fixo e
 * reciclá-lo introduziria repetição sistemática de valores e enviesaria os
 * quantis.
 */
function arbCenarioFora(arbMagnitude: fc.Arbitrary<number>): fc.Arbitrary<CenarioFora> {
  return fc
    .tuple(fc.integer({ min: 2, max: 10 }), fc.integer({ min: 2, max: 10 }))
    .chain(([nBaldes, nTicks]) => {
      const geo: Geometria = { nBaldes, nTicks };
      const arbLados = fc.record({
        bid: arbFilaOuAusente,
        ask: arbFilaOuAusente,
        buy: arbExecucaoOuAusente,
        sell: arbExecucaoOuAusente,
      });
      const totalDenso = nBaldes * nTicks;
      const totalFora = coordenadasFora(geo).length;
      return fc
        .tuple(
          fc.array(arbLados, { minLength: totalDenso, maxLength: totalDenso }),
          fc.array(arbLados, { minLength: totalFora, maxLength: totalFora }),
          arbModoFora,
          arbDeslocamentoTicks,
          arbLadoDoOutlier,
          arbMagnitude,
        )
        .map(([ladosDensos, ladosFora, modo, desloc, lado, magnitude]): CenarioFora => {
          const base = [...celulasDensas(geo, ladosDensos), ...celulasFora(geo, ladosFora)];
          const outlier = outlierFora(geo, modo, desloc, lado, magnitude);
          return {
            semOutlier: base,
            comOutlier: [...base, outlier],
            outlier,
            magnitude,
            modo,
            window: janela(
              tempoDoIndice(0),
              tempoDoIndice(nBaldes - 1),
              precoDoOffset(0),
              precoDoOffset(nTicks - 1),
            ),
          };
        });
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// Cenário da cláusula 2.11 — outlier DENTRO da janela
// ═════════════════════════════════════════════════════════════════════════════

interface CenarioDentro {
  readonly semOutlier: readonly Celula[];
  readonly comOutlier: readonly Celula[];
  readonly magnitude: number;
  readonly window: VisibleWindow;
}

/**
 * Cenário com o outlier **dentro** da janela.
 *
 * Duas escolhas de construção carregam as condições declaradas no cabeçalho:
 *
 * - **`bid` sempre positivo no bloco denso**, com o bloco tendo ao menos
 *   `13 × 13 = 169` células. Garante amostra positiva acima do limiar de 99, sem
 *   depender de sorte do gerador nem de rejeição de amostra.
 * - **um balde reservado dentro da janela** para o outlier, o que dá a ele um
 *   par `(instante, preço)` novo e mantém a amostra ampliada exatamente uma
 *   posição maior.
 */
const arbCenarioDentro: fc.Arbitrary<CenarioDentro> = fc
  .tuple(fc.integer({ min: 13, max: 22 }), fc.integer({ min: 13, max: 20 }))
  .chain(([nBaldes, nTicks]) => {
    const geo: Geometria = { nBaldes, nTicks };
    const arbLadosDensos = fc.record({
      bid: arbFilaRealista,
      ask: arbFilaOuAusente,
      buy: arbExecucaoOuAusente,
      sell: arbExecucaoOuAusente,
    });
    const arbLadosFora = fc.record({
      bid: arbFilaOuAusente,
      ask: arbFilaOuAusente,
      buy: arbExecucaoOuAusente,
      sell: arbExecucaoOuAusente,
    });
    const totalDenso = nBaldes * nTicks;
    const totalFora = coordenadasFora(geo).length;
    return fc
      .tuple(
        fc.array(arbLadosDensos, { minLength: totalDenso, maxLength: totalDenso }),
        fc.array(arbLadosFora, { minLength: totalFora, maxLength: totalFora }),
        fc.integer({ min: 0, max: nTicks - 1 }),
        arbLadoDoOutlier,
        arbMagnitudeEstrita,
      )
      .map(([ladosDensos, ladosFora, offsetOutlier, lado, magnitude]): CenarioDentro => {
        const base = [...celulasDensas(geo, ladosDensos), ...celulasFora(geo, ladosFora)];
        const outlier = celulaOutlier(
          tempoDoIndice(nBaldes),
          precoDoOffset(offsetOutlier),
          lado,
          magnitude,
        );
        return {
          semOutlier: base,
          comOutlier: [...base, outlier],
          magnitude,
          // A janela abrange o balde reservado, então o outlier está DENTRO.
          window: janela(
            tempoDoIndice(0),
            tempoDoIndice(nBaldes),
            precoDoOffset(0),
            precoDoOffset(nTicks - 1),
          ),
        };
      });
  });

// ═════════════════════════════════════════════════════════════════════════════
// Asserções compartilhadas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O recorte precisa ter acontecido sem agrupamento, senão a comparação célula a
 * célula entre as duas execuções não é válida. Afirmado, não pressuposto.
 */
function exigirFatorUnitario(cells: AggregatedCells): void {
  expect(cells.fatorTempo).toBe(1);
  expect(cells.fatorPreco).toBe(1);
}

/** Toda opacidade finita e dentro de `[alphaMin, alphaMax]` (requisito 2.3). */
function exigirOpacidadeValida(escala: ColorScale, valor: number): void {
  const alpha = alphaOf(escala, valor);
  expect(Number.isFinite(alpha)).toBe(true);
  expect(alpha).toBeGreaterThanOrEqual(escala.alphaMin);
  expect(alpha).toBeLessThanOrEqual(escala.alphaMax);
}

// ═════════════════════════════════════════════════════════════════════════════
// Cláusula 2.5 — a célula externa não altera nada dentro da janela
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 8: a escala é robusta a outlier fora da janela', () => {
  it('célula externa de magnitude arbitrária não altera p50 nem p99 da janela', () => {
    fc.assert(
      fc.property(arbCenarioFora(arbMagnitudeQualquer), (cenario) => {
        const sem = recortar(construirGrid(cenario.semOutlier), cenario.window);
        const com = recortar(construirGrid(cenario.comOutlier), cenario.window);

        exigirFatorUnitario(sem);
        exigirFatorUnitario(com);

        // O recorte não vê a célula externa — nem no tamanho, nem nos valores.
        // A igualdade coluna a coluna é exigível porque o fator é unitário e a
        // ordenação da saída é lexicográfica em (balde, preço), preservada sob a
        // reindexação que a inserção do outlier provoca.
        expect(com.count).toBe(sem.count);
        expect(colunaVisivel(com.bid, com.count)).toEqual(colunaVisivel(sem.bid, sem.count));
        expect(colunaVisivel(com.ask, com.count)).toEqual(colunaVisivel(sem.ask, sem.count));
        expect(colunaVisivel(com.buy, com.count)).toEqual(colunaVisivel(sem.buy, sem.count));
        expect(colunaVisivel(com.sell, com.count)).toEqual(colunaVisivel(sem.sell, sem.count));

        // Escala de FILA, compartilhada pelos dois lados (requisito 2.9).
        const filaSem = computeColorScalePair(sem.bid, sem.ask, sem.count);
        const filaCom = computeColorScalePair(com.bid, com.ask, com.count);
        expect(filaCom).toEqual(filaSem);

        // Escala de EXECUÇÃO, independente da de fila e igualmente intocada.
        const execSem = computeColorScalePair(sem.buy, sem.sell, sem.count);
        const execCom = computeColorScalePair(com.buy, com.sell, com.count);
        expect(execCom).toEqual(execSem);

        // E também por lado isolado, que é a outra porta de entrada da escala.
        expect(computeColorScale(com.bid, com.count)).toEqual(
          computeColorScale(sem.bid, sem.count),
        );
        expect(computeColorScale(com.ask, com.count)).toEqual(
          computeColorScale(sem.ask, sem.count),
        );

        // Todo quantil da janela é idêntico, inclusive o máximo — que é o mais
        // sensível a artefato e o que uma escala global usaria.
        for (const q of [Q_P50, Q_P90, Q_P99, Q_MAX]) {
          expect(positiveQuantileOfPair(com.bid, com.ask, com.count, q)).toBe(
            positiveQuantileOfPair(sem.bid, sem.ask, sem.count, q),
          );
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('as opacidades e o marcador de estouro de escala são idênticos, célula a célula', () => {
    fc.assert(
      fc.property(arbCenarioFora(arbMagnitudeQualquer), (cenario) => {
        const sem = recortar(construirGrid(cenario.semOutlier), cenario.window);
        const com = recortar(construirGrid(cenario.comOutlier), cenario.window);

        const escalaSem = computeColorScalePair(sem.bid, sem.ask, sem.count);
        const escalaCom = computeColorScalePair(com.bid, com.ask, com.count);

        // É a cor que o operador lê — a igualdade de p50/p99 seria insuficiente
        // se a conversão para opacidade dependesse de outra coisa.
        for (let k = 0; k < sem.count; k += 1) {
          const valorBid = sem.bid[k] ?? 0;
          const valorAsk = sem.ask[k] ?? 0;

          expect(alphaOf(escalaCom, valorBid)).toBe(alphaOf(escalaSem, valorBid));
          expect(alphaOf(escalaCom, valorAsk)).toBe(alphaOf(escalaSem, valorAsk));

          expect(isAboveScale(escalaCom, valorBid)).toBe(isAboveScale(escalaSem, valorBid));
          expect(isAboveScale(escalaCom, valorAsk)).toBe(isAboveScale(escalaSem, valorAsk));

          exigirOpacidadeValida(escalaCom, valorBid);
          exigirOpacidadeValida(escalaCom, valorAsk);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('o outlier está de fato no grid: o máximo do dia inteiro muda, o da janela não', () => {
    fc.assert(
      fc.property(arbCenarioFora(arbMagnitudeEstrita), (cenario) => {
        const gridSem = construirGrid(cenario.semOutlier);
        const gridCom = construirGrid(cenario.comOutlier);

        // Dentes da propriedade. Sem esta afirmação, a igualdade acima poderia
        // estar passando porque o outlier nunca chegou ao grid — e o teste seria
        // vácuo sem dar sinal algum.
        const maxSem = maximoDoGrid(gridSem);
        const maxCom = maximoDoGrid(gridCom);
        expect(maxCom).toBe(cenario.magnitude);
        expect(maxCom).toBeGreaterThan(maxSem);
        expect(gridCom.bid.length).toBe(gridSem.bid.length + 1);

        // E é exatamente esta a demonstração do argumento do projeto: a mesma
        // célula que desloca o máximo global — âncora de uma escala linear — não
        // desloca o percentil da janela em nada.
        const sem = recortar(gridSem, cenario.window);
        const com = recortar(gridCom, cenario.window);
        expect(computeColorScalePair(com.bid, com.ask, com.count)).toEqual(
          computeColorScalePair(sem.bid, sem.ask, sem.count),
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('quantidade além de count não entra na amostra, mesmo compartilhando o buffer', () => {
    fc.assert(
      fc.property(
        arbCenarioFora(arbMagnitudeEstrita),
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        (cenario, formaDaCauda, posicao) => {
          const cells = recortar(construirGrid(cenario.semOutlier), cenario.window);
          const escala = computeColorScalePair(cells.bid, cells.ask, cells.count);

          // A cauda é o que um chamador poderia ter deixado no mesmo array ao
          // reaproveitar um buffer do tamanho do grid: zeros, quantidades
          // normais, e o outlier em alguma posição além de `count`.
          const cauda = formaDaCauda.map((tipo, i) =>
            i === posicao % formaDaCauda.length
              ? cenario.magnitude
              : tipo === 0
                ? 0
                : tipo * 700,
          );

          const bufBid = estenderBuffer(cells.bid, cells.count, cauda);
          const bufAsk = estenderBuffer(cells.ask, cells.count, cauda);

          // `count` é a verdade, não `length`: a cauda não pode entrar na
          // amostra dos percentis.
          expect(computeColorScalePair(bufBid, bufAsk, cells.count)).toEqual(escala);
          expect(computeColorScale(bufBid, cells.count)).toEqual(
            computeColorScale(cells.bid, cells.count),
          );

          // Dentes: a cauda existe e é alcançável — informar o comprimento
          // inteiro a traz para dentro e muda o máximo.
          const maxNoPrefixo = positiveQuantileOfPair(bufBid, bufAsk, cells.count, Q_MAX);
          const maxComCauda = positiveQuantileOfPair(bufBid, bufAsk, bufBid.length, Q_MAX);
          expect(maxComCauda).toBe(cenario.magnitude);
          expect(maxComCauda).toBeGreaterThan(maxNoPrefixo);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cláusula 2.11 — o outlier DENTRO da janela desloca no máximo um posto
  // ═══════════════════════════════════════════════════════════════════════════

  it('outlier dentro da janela desloca o p99 em no máximo um posto de percentil', () => {
    fc.assert(
      fc.property(arbCenarioDentro, (cenario) => {
        const sem = recortar(construirGrid(cenario.semOutlier), cenario.window);
        const com = recortar(construirGrid(cenario.comOutlier), cenario.window);

        exigirFatorUnitario(sem);
        exigirFatorUnitario(com);

        // Dentes: o outlier entrou na janela, e entrou uma única vez.
        expect(com.count).toBe(sem.count + 1);

        const ordSem = amostraOrdenada(sem);
        const ordCom = amostraOrdenada(com);
        const n = ordSem.length;

        // A condição declarada no cabeçalho, afirmada em vez de pressuposta.
        expect(n).toBeGreaterThanOrEqual(99);

        // Sendo o máximo estrito, o outlier ocupa o topo da ordenação e o
        // prefixo é literalmente a amostra original. É isto que dá sentido a
        // "um posto": os dois percentis são lidos na MESMA ordenação.
        expect(ordCom).toHaveLength(n + 1);
        expect(ordCom.slice(0, n)).toEqual(ordSem);
        expect(ordCom[n]).toBe(cenario.magnitude);

        const postoSem = postoDoQuantil(Q_P99, n);
        const postoCom = postoDoQuantil(Q_P99, n + 1);
        expect(postoCom - postoSem).toBeGreaterThanOrEqual(0);
        expect(postoCom - postoSem).toBeLessThanOrEqual(1);

        const escalaSem = computeColorScalePair(sem.bid, sem.ask, sem.count);
        const escalaCom = computeColorScalePair(com.bid, com.ask, com.count);

        // O p99 de cada execução é o valor no seu posto — conferência cruzada
        // entre a seleção parcial do núcleo e a ordenação de referência.
        expect(escalaSem.p99).toBe(ordSem[postoSem] ?? 0);
        expect(escalaCom.p99).toBe(ordCom[postoCom] ?? 0);

        // E o p99 ampliado NÃO é o artefato: veio da amostra original, que é a
        // consequência prática de o posto andar no máximo uma casa.
        expect(escalaCom.p99).toBeLessThan(cenario.magnitude);

        // O mesmo mecanismo vale para o piso da escala — reforço, não requisito.
        const postoBaixoSem = postoDoQuantil(Q_P50, n);
        const postoBaixoCom = postoDoQuantil(Q_P50, n + 1);
        expect(postoBaixoCom - postoBaixoSem).toBeLessThanOrEqual(1);
        expect(escalaCom.p50).toBe(ordCom[postoBaixoCom] ?? 0);
        expect(escalaCom.p50).toBeLessThanOrEqual(escalaCom.p99);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a quantidade igual ao p90 da janela recebe ao menos 30% da amplitude de opacidade', () => {
    fc.assert(
      fc.property(arbCenarioDentro, (cenario) => {
        const com = recortar(construirGrid(cenario.comOutlier), cenario.window);
        const escala = computeColorScalePair(com.bid, com.ask, com.count);
        const p90 = positiveQuantileOfPair(com.bid, com.ask, com.count, Q_P90);

        const ord = amostraOrdenada(com);
        expect(ord.length).toBeGreaterThanOrEqual(100);
        expect(p90).toBe(ord[postoDoQuantil(Q_P90, ord.length)] ?? 0);

        // A condição (a) do cabeçalho: sem dispersão entre o p50 e o p90 o
        // requisito 2.11 colidiria com o 2.3, e a implementação honra o 2.3.
        expect(escala.p99).toBeGreaterThan(escala.p50);
        expect(p90).toBeGreaterThan(escala.p50);
        expect(p90).toBeLessThanOrEqual(escala.p99);

        const amplitude = escala.alphaMax - escala.alphaMin;
        const piso = escala.alphaMin + PISO_AMPLITUDE_P90 * amplitude;
        expect(alphaOf(escala, p90)).toBeGreaterThanOrEqual(piso);

        // A parede do p90 tem de continuar distinguível do fundo mesmo com o
        // artefato presente: é o objetivo do requisito, não só o número.
        expect(alphaOf(escala, p90)).toBeGreaterThan(alphaOf(escala, escala.p50));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Invariantes que sustentam as duas cláusulas
  // ═══════════════════════════════════════════════════════════════════════════

  it('é determinística e não muta as colunas recebidas', () => {
    fc.assert(
      fc.property(arbCenarioFora(arbMagnitudeQualquer), (cenario) => {
        const cells = recortar(construirGrid(cenario.comOutlier), cenario.window);

        const bidAntes = copiar(cells.bid);
        const askAntes = copiar(cells.ask);

        const primeira = computeColorScalePair(cells.bid, cells.ask, cells.count);
        const segunda = computeColorScalePair(cells.bid, cells.ask, cells.count);

        // Sem determinismo nenhuma das outras propriedades significaria algo: um
        // contraexemplo não seria reproduzível.
        expect(segunda).toEqual(primeira);

        // A seleção parcial reordena a amostra no lugar — a cópia interna é o
        // que impede a coluna do recorte de sair permutada e o desenho de
        // pintar quantidade no par (instante, preço) errado.
        expect(copiar(cells.bid)).toEqual(bidAntes);
        expect(copiar(cells.ask)).toEqual(askAntes);

        expect(Number.isFinite(primeira.p50)).toBe(true);
        expect(Number.isFinite(primeira.p99)).toBe(true);
        expect(primeira.p50).toBeLessThanOrEqual(primeira.p99);
        expect(primeira.alphaMin).toBeLessThan(primeira.alphaMax);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  /**
   * A fronteira exata do piso de 30%, independente de distribuição.
   *
   * ⚠️ Esta propriedade **relata** o limite do requisito 2.11 em vez de
   * contorná-lo. Com a curva de potência,
   *
   *     alpha(q) ≥ alphaMin + 0,3·(alphaMax − alphaMin)
   *       ⟺  t^gamma ≥ 0,3        onde  t = (q − p50)/(p99 − p50)
   *       ⟺  t ≥ 0,3^(1/gamma)
   *
   * e com `gamma = 0,5` o limiar é `t ≥ 0,09`. Fora dessa faixa o piso é
   * inalcançável **por aritmética**, não por defeito: a única resposta
   * compatível com a monotonicidade do requisito 2.3 é a opacidade mínima.
   * Registrar a equivalência aqui é o que mantém a cláusula anterior honesta —
   * ela vale porque a distribuição medida satisfaz a condição, não porque a
   * implementação a satisfaria para qualquer forma de amostra.
   */
  it('o piso de 30% é alcançado exatamente quando a posição relativa passa de 0,09', () => {
    const limiar = Math.pow(PISO_AMPLITUDE_P90, 1 / BOOKMAP_GAMMA_DEFAULT);
    expect(limiar).toBeCloseTo(0.09, 10);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (piso, amplitudeQtd, fracao) => {
          const escala: ColorScale = {
            p50: piso,
            p99: piso + amplitudeQtd,
            alphaMin: BOOKMAP_ALPHA_MIN_DEFAULT,
            alphaMax: BOOKMAP_ALPHA_MAX_DEFAULT,
            gamma: BOOKMAP_GAMMA_DEFAULT,
          };

          const quantidade = piso + fracao * amplitudeQtd;
          const t = (quantidade - escala.p50) / (escala.p99 - escala.p50);

          const amplitudeAlpha = escala.alphaMax - escala.alphaMin;
          const pisoAlpha = escala.alphaMin + PISO_AMPLITUDE_P90 * amplitudeAlpha;
          const alcancou = alphaOf(escala, quantidade) >= pisoAlpha;

          // Tolerância só na vizinhança imediata do limiar, onde o
          // arredondamento de ponto flutuante decide o lado.
          if (Math.abs(t - limiar) > 1e-9) {
            expect(alcancou).toBe(t >= limiar);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
