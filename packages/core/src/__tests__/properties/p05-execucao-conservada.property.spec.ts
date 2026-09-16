/**
 * Property 5 — A agregação conserva a execução. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.3.
 *
 * ```
 * ∀ grid, window, budget:
 *     Σ agregado.buy  === Σ {grid.buy[k]  : k dentro de window}
 *     Σ agregado.sell === Σ {grid.sell[k] : k dentro de window}
 * ```
 *
 * **Validates: Requirements 3.3**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Execução é **fluxo acumulado**, então `sum` é o operador certo — diferente da
 * fila, que combina por `max` porque é quantidade em repouso. A consequência
 * que o operador enxerga é direta: **o total negociado não muda com o nível de
 * zoom**. Se mudasse, cada escala mostraria um volume diferente e nenhuma das
 * leituras seria confiável — o que é pior que não desenhar, porque a tela
 * continuaria parecendo correta.
 *
 * Duas somas separadas, não uma. O critério 3.3 pede `exec_compra` e
 * `exec_venda` combinadas **separadamente**, e é isso que distingue agressor
 * comprador de vendedor: uma implementação que somasse os dois lados num só
 * acumulador conservaria o total e destruiria o desequilíbrio, que é a
 * informação.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A TOLERÂNCIA DE 1e-6 RELATIVA, E POR QUE NÃO É FROUXIDÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O critério 3.3 diz "exatamente igual"; o projeto registra tolerância relativa
 * de `1e-6`. Não é contradição, é o custo do armazenamento: `AggregatedCells`
 * guarda execução em precisão simples, cujo épsilon relativo é `≈1,19e-7`. A
 * soma de um grupo é acumulada em precisão dupla e **arredondada uma vez** ao
 * ser gravada na coluna de saída.
 *
 * O erro daí é limitado e pequeno. Como todo valor saneado é não-negativo, os
 * arredondamentos não se cancelam nem se amplificam: o erro relativo do total é
 * limitado pelo maior erro relativo de gravação, `≈6e-8` — cerca de **16 vezes
 * dentro** da tolerância adotada. Ou seja, `1e-6` acomoda a precisão simples com
 * folga e ainda assim reprova qualquer troca de operador: substituir `sum` por
 * `max`, por `avg` ou por `min` produz desvio de ordem de grandeza, não de
 * arredondamento.
 *
 * Enfraquecer para `1e-3` esconderia erro real; exigir igualdade exata
 * reprovaria a implementação correta por causa do tipo de armazenamento. E a
 * tolerância é **puramente relativa**: quando a soma esperada é zero, a
 * igualdade exigida é exata, sem piso absoluto que sirva de escape.
 *
 * ── O que fica FORA do domínio gerado, de propósito ────────────────────────
 *
 * Magnitudes que estouram ou subnormalizam a precisão simples (acima de
 * `≈3,4e38`, abaixo de `≈1,18e-38`). Elas mediriam o limite do tipo de
 * armazenamento, não a conservação: o valor transportado é contagem de
 * contratos, cujo maior artefato medido no pregão de referência é 36.232. Os
 * geradores cobrem essa faixa inteira, com folga de ordens de grandeza.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro e a
 * biblioteca de teste. O núcleo de agregação, por sua vez, importa apenas o
 * arquivo de tipos — que não importa nada. Logo o fechamento transitivo deste
 * arquivo não tem caminho até camada de roteamento de conexão, de feed de
 * cotação, de envio de ordem ou de estado de conta, e não carrega endereço de
 * rede, credencial nem identificador de conta.
 *
 * Todo insumo é sintetizado pelos geradores; nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato. Nada aqui emite
 * evento de decisão nem toca chave de configuração de trading.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO A PROPRIEDADE FOI TORNADA PRECISA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O enunciado curto tem três condições que vêm dos critérios vizinhos e sem as
 * quais ele seria falso — cada uma ganhou propriedade própria em vez de ser
 * silenciosamente evitada pelo gerador:
 *
 * 1. **`k dentro de window` pressupõe janela utilizável.** O critério 3.9 manda
 *    entregar zero células quando a janela é degenerada, então ali a soma é zero
 *    dos dois lados — não a soma dos limites invertidos.
 * 2. **`grid.buy[k]` é o valor SANEADO, não o bruto.** O critério 3.10 manda
 *    tratar valor não finito ou negativo como zero, preservando os demais campos
 *    da mesma célula.
 * 3. **Orçamento esgotado entrega zero células.** O critério 3.5 escolhe
 *    deliberadamente zero células em vez de buracos, e nesse caso a conservação
 *    é abandonada por decisão de projeto. A propriedade central é condicionada
 *    ao desfecho, e a fronteira tem propriedade própria afirmando o zero.
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

/** Tolerância relativa fixada pelo projeto, por causa da precisão simples. */
const REL_TOL = 1e-6;

/** Padrões que o núcleo aplica quando a dimensão mínima não é sobrescrita. */
const DEFAULT_MIN_WIDTH_PX = 3;
const DEFAULT_MIN_HEIGHT_PX = 2;

/** Orçamento adotado quando o recebido não é inteiro finito. */
const DEFAULT_MAX_CELLS = 3_000;

const BALDE_MS = 60_000;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso acontece aqui: este
 * projeto já errou conversão em ±3 h somando deslocamento à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** Miolo do índice e o passo de tick, na forma do dado real. */
const PRECO_BASE = 177_000;
const TICK = 5;

/** Eixos do pregão de referência: 570 baldes de 60 s, 624 níveis de preço. */
const BALDES_DO_PREGAO = 570;
const TICKS_DO_PREGAO = 624;

// ═════════════════════════════════════════════════════════════════════════════
// Construção do grid
// ═════════════════════════════════════════════════════════════════════════════

interface CellSpec {
  readonly ti: number;
  readonly pi: number;
  readonly bid: number;
  readonly ask: number;
  readonly buy: number;
  readonly sell: number;
}

interface GridSpec {
  readonly times: readonly number[];
  readonly prices: readonly number[];
  readonly cells: readonly CellSpec[];
}

/**
 * Monta o grid tipado diretamente, **sem** passar pelo decodificador.
 *
 * ⚠️ É deliberado, e é a única forma de exercitar os critérios 3.10 e o descarte
 * de índice fora do eixo: o decodificador rejeita o payload inteiro nesses casos
 * — devolve ausência de grid em vez de grid parcial —, então um grid produzido
 * por ele **nunca** carregaria valor não finito nem índice inválido. Testar a
 * agregação só com grid decodificado deixaria os dois guardas sem cobertura.
 *
 * O invariante de comprimento igual das seis colunas é respeitado por
 * construção: as colunas nascem do mesmo vetor de células. Colunas de
 * comprimentos divergentes estão fora do contrato do tipo, e gerá-las tornaria a
 * própria soma de referência ambígua.
 */
function buildGrid(spec: GridSpec): BookmapGrid {
  const count = spec.cells.length;

  const ti = new Uint32Array(count);
  const pi = new Uint32Array(count);
  const bid = new Float32Array(count);
  const ask = new Float32Array(count);
  const buy = new Float32Array(count);
  const sell = new Float32Array(count);

  for (let k = 0; k < count; k += 1) {
    const cell = spec.cells[k];
    if (cell === undefined) continue;
    ti[k] = cell.ti;
    pi[k] = cell.pi;
    bid[k] = cell.bid;
    ask[k] = cell.ask;
    buy[k] = cell.buy;
    sell[k] = cell.sell;
  }

  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-28',
    baldeSeg: 60,
    times: new Float64Array(spec.times),
    prices: new Float64Array(spec.prices),
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
// A soma de referência
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O saneamento que o critério 3.10 exige: valor não finito ou negativo conta
 * como zero.
 *
 * Zero — e não descarte da célula — porque ausência de célula já significa zero
 * no contrato do payload. Um terceiro estado não teria representação no desenho.
 */
function saneValue(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

interface ReferenceSums {
  readonly buy: number;
  readonly sell: number;
  /** Células efetivamente selecionadas — usado para aferir vacuidade. */
  readonly selected: number;
}

/**
 * Soma de referência: filtra e soma, sem agrupar.
 *
 * ⚠️ **Pré-condição: a janela é utilizável.** O caso degenerado é do critério
 * 3.9 e tem propriedade própria, justamente para que esta função não precise
 * reproduzir aquele guarda — reproduzi-lo aqui aproximaria o oráculo da
 * implementação sem ganho.
 *
 * O que esta função reproduz da implementação é apenas o **recorte**, que é a
 * definição de `k dentro de window` no enunciado: índice válido, coordenada
 * dentro dos limites inclusive. Não reproduz agrupamento, chave de grupo,
 * orçamento, fator, ordenação nem repetição — que é onde vive tudo o que a
 * propriedade testa.
 *
 * Os valores são lidos **de volta das colunas tipadas**, já em precisão simples.
 * Somar os números brutos que o gerador sorteou mediria o arredondamento da
 * entrada, que não é o que se está afirmando: o enunciado fala de `grid.buy[k]`,
 * o valor que o grid de fato carrega.
 */
function referenceSums(grid: BookmapGrid, visible: VisibleWindow): ReferenceSums {
  const timeAxisLength = grid.times.length;
  const priceAxisLength = grid.prices.length;
  const cellCount = grid.ti.length;

  let buy = 0;
  let sell = 0;
  let selected = 0;

  for (let k = 0; k < cellCount; k += 1) {
    // As colunas de índice são inteiros sem sinal, então o limite inferior de
    // zero é garantido pelo tipo; só o superior precisa de checagem.
    const timeIndex = grid.ti[k] ?? Number.NaN;
    const priceIndex = grid.pi[k] ?? Number.NaN;
    if (!(timeIndex < timeAxisLength)) continue;
    if (!(priceIndex < priceAxisLength)) continue;

    const ts = grid.times[timeIndex] ?? Number.NaN;
    const price = grid.prices[priceIndex] ?? Number.NaN;
    if (!(ts >= visible.tsDe && ts <= visible.tsAte)) continue;
    if (!(price >= visible.precoDe && price <= visible.precoAte)) continue;

    buy += saneValue(grid.buy[k]);
    sell += saneValue(grid.sell[k]);
    selected += 1;
  }

  return { buy, sell, selected };
}

/** Soma uma coluna de execução sobre `[0, count)` — nunca sobre `length`. */
function sumColumn(cells: AggregatedCells, column: 'buy' | 'sell'): number {
  const values = cells[column];
  let total = 0;
  for (let i = 0; i < cells.count; i += 1) total += values[i] ?? Number.NaN;
  return total;
}

/**
 * Comparação com tolerância **puramente relativa**.
 *
 * Soma esperada nula exige igualdade exata: um total de zeros é gravado sem
 * arredondamento em qualquer precisão, então não há erro a tolerar — e um piso
 * absoluto ali serviria de escape para desvio real em grid de execução vazia.
 */
function expectConserved(actual: number, expected: number, label: string): void {
  expect(Number.isFinite(actual), `${label}: total não finito (${actual})`).toBe(true);

  if (expected === 0) {
    expect(actual, `${label}: esperado zero exato`).toBe(0);
    return;
  }

  const relative = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    relative,
    `${label}: esperado ${expected}, obtido ${actual}, erro relativo ${relative}`,
  ).toBeLessThanOrEqual(REL_TOL);
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade como pode chegar numa coluna de execução.
 *
 * A distribuição é enviesada para contagem inteira de contratos porque é a forma
 * do dado real, e inclui os valores medidos no pregão de referência. A faixa
 * fracionária existe para que o arredondamento de precisão simples seja de fato
 * exercitado — só com inteiros pequenos a conservação sairia exata e a
 * tolerância nunca seria posta à prova. O limite inferior de `0,01` mantém a
 * amostra fora da região subnormal, por onde a garantia de erro relativo não
 * passa.
 */
const arbQuantidade = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 2_500 }), weight: 6 },
  { arbitrary: fc.integer({ min: 2_500, max: 40_000 }), weight: 2 },
  // p50, p90, p99, maior parede real e o artefato de níveis cruzados.
  { arbitrary: fc.constantFrom(481, 714, 1_131, 2_442, 36_232), weight: 2 },
  { arbitrary: fc.double({ min: 0.01, max: 1e5, noNaN: true }), weight: 3 },
  // O que o critério 3.10 manda contar como zero.
  {
    arbitrary: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
      -1,
      -0.5,
      -40_000,
    ),
    weight: 3,
  },
  { arbitrary: fc.constant(0), weight: 2 },
);

/**
 * Comprimentos dos dois eixos.
 *
 * O último ramo é a forma do pregão de referência — 570 baldes × 624 níveis —,
 * injetado explicitamente para que a escala real não dependa de sorte do
 * gerador. Eixo vazio entra pelos ramos menores e é caso legítimo: torna todo
 * índice inválido, e a conservação passa a afirmar que zero é conservado.
 */
const arbAxisLengths = fc.oneof(
  {
    arbitrary: fc.tuple(fc.integer({ min: 0, max: 24 }), fc.integer({ min: 0, max: 20 })),
    weight: 6,
  },
  {
    arbitrary: fc.tuple(fc.integer({ min: 24, max: 130 }), fc.integer({ min: 20, max: 80 })),
    weight: 3,
  },
  {
    arbitrary: fc.constant<[number, number]>([BALDES_DO_PREGAO, TICKS_DO_PREGAO]),
    weight: 1,
  },
);

function timeAxis(length: number): readonly number[] {
  const axis: number[] = new Array<number>(length);
  for (let i = 0; i < length; i += 1) axis[i] = ABERTURA_MS + i * BALDE_MS;
  return axis;
}

function priceAxis(length: number): readonly number[] {
  const axis: number[] = new Array<number>(length);
  for (let i = 0; i < length; i += 1) axis[i] = PRECO_BASE + i * TICK;
  return axis;
}

/**
 * Uma célula. O índice pode exceder o eixo de propósito, com peso pequeno: é o
 * caso que a implementação omite, e a soma de referência tem de omitir também.
 */
function arbCell(timeLength: number, priceLength: number): fc.Arbitrary<CellSpec> {
  const arbIndex = (length: number): fc.Arbitrary<number> =>
    fc.oneof(
      { arbitrary: fc.integer({ min: 0, max: Math.max(0, length - 1) }), weight: 9 },
      { arbitrary: fc.integer({ min: length, max: length + 3 }), weight: 1 },
    );

  return fc.record({
    ti: arbIndex(timeLength),
    pi: arbIndex(priceLength),
    // A fila entra sorteada, e não fixa em zero, para que a propriedade também
    // reprove uma implementação que misturasse as grandezas: fila somada na
    // execução alteraria o total.
    bid: arbQuantidade,
    ask: arbQuantidade,
    buy: arbQuantidade,
    sell: arbQuantidade,
  });
}

/**
 * Quantidade de células. Duplicata de par `(instante, preço)` é permitida com
 * peso baixo: o produtor do payload não a gera, mas a agregação a trata
 * naturalmente — os dois membros caem no mesmo grupo — e a soma de referência
 * também. Serve para provar que a conservação não depende de unicidade.
 */
const arbCellCount = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 60 }), weight: 5 },
  { arbitrary: fc.integer({ min: 60, max: 600 }), weight: 5 },
);

const arbGridSpec: fc.Arbitrary<GridSpec> = arbAxisLengths.chain(([timeLength, priceLength]) =>
  arbCellCount.chain((count) =>
    fc.array(arbCell(timeLength, priceLength), { minLength: count, maxLength: count }).map(
      (cells): GridSpec => ({
        times: timeAxis(timeLength),
        prices: priceAxis(priceLength),
        cells,
      }),
    ),
  ),
);

/**
 * Pixels por unidade de eixo.
 *
 * ⚠️ A janela é gerada por **pixels por unidade**, não por largura absoluta, e é
 * o que torna o fator de agrupamento controlável: o núcleo agrupa quando a
 * dimensão da célula fica abaixo do mínimo do eixo, então valor abaixo de 3 px
 * de largura ou de 2 px de altura força fator maior que 1. Sortear largura solta
 * deixaria a fração de casos com agrupamento ao acaso — e sem agrupamento a
 * conservação é trivial, o que tornaria a suíte quase vazia.
 *
 * `1,4` e `0,64` não são arbitrários: são os pixels por balde e por tick do
 * pregão de referência num gráfico de 800 × 400.
 */
const arbPxPorBalde = fc.oneof(
  { arbitrary: fc.constantFrom(0.2, 0.5, 1, 1.4, 2, 2.9), weight: 7 },
  { arbitrary: fc.constantFrom(3, 4, 8, 20), weight: 3 },
);

const arbPxPorTick = fc.oneof(
  { arbitrary: fc.constantFrom(0.2, 0.5, 0.64, 1, 1.9), weight: 7 },
  { arbitrary: fc.constantFrom(2, 3, 6, 16), weight: 3 },
);

interface Scenario {
  readonly grid: BookmapGrid;
  readonly window: VisibleWindow;
}

/**
 * Limites de janela derivados dos próprios eixos, de modo que a janela seja
 * **utilizável** por construção (critério 3.9 satisfeito) e selecione células.
 *
 * O ramo de cobertura total tem peso porque é o caso em que a conservação
 * abrange o grid inteiro — o mais forte dos dois.
 */
function arbUsableWindow(spec: GridSpec): fc.Arbitrary<VisibleWindow> {
  const timeLength = spec.times.length;
  const priceLength = spec.prices.length;

  // Eixo vazio não oferece índice para ancorar limites: a janela cobre a faixa
  // do domínio e nenhuma célula é selecionável, porque todo índice é inválido.
  if (timeLength === 0 || priceLength === 0) {
    return fc.tuple(arbPxPorBalde, arbPxPorTick).map(
      ([pxPorBalde, pxPorTick]): VisibleWindow => ({
        tsDe: ABERTURA_MS,
        tsAte: ABERTURA_MS + BALDES_DO_PREGAO * BALDE_MS,
        precoDe: PRECO_BASE,
        precoAte: PRECO_BASE + TICKS_DO_PREGAO * TICK,
        larguraPx: pxPorBalde,
        alturaPx: pxPorTick,
        baldesVisiveis: 1,
        ticksVisiveis: 1,
      }),
    );
  }

  const arbRange = (length: number): fc.Arbitrary<readonly [number, number]> =>
    fc.oneof(
      { arbitrary: fc.constant<readonly [number, number]>([0, length - 1]), weight: 4 },
      {
        arbitrary: fc
          .tuple(fc.integer({ min: 0, max: length - 1 }), fc.integer({ min: 0, max: length - 1 }))
          .map(([a, b]): readonly [number, number] => (a <= b ? [a, b] : [b, a])),
        weight: 6,
      },
    );

  return fc
    .tuple(arbRange(timeLength), arbRange(priceLength), arbPxPorBalde, arbPxPorTick)
    .map(([[i0, i1], [j0, j1], pxPorBalde, pxPorTick]): VisibleWindow => {
      const baldesVisiveis = i1 - i0 + 1;
      const ticksVisiveis = j1 - j0 + 1;
      return {
        tsDe: spec.times[i0] ?? ABERTURA_MS,
        tsAte: spec.times[i1] ?? ABERTURA_MS,
        precoDe: spec.prices[j0] ?? PRECO_BASE,
        precoAte: spec.prices[j1] ?? PRECO_BASE,
        larguraPx: baldesVisiveis * pxPorBalde,
        alturaPx: ticksVisiveis * pxPorTick,
        baldesVisiveis,
        ticksVisiveis,
      };
    });
}

const arbScenario: fc.Arbitrary<Scenario> = arbGridSpec.chain((spec) =>
  arbUsableWindow(spec).map((visible) => ({ grid: buildGrid(spec), window: visible })),
);

/**
 * Orçamento. O ramo não-inteiro existe para exercitar a adoção do padrão, e o
 * ramo apertado para forçar as repetições que dobram a dimensão mínima.
 */
const arbBudget = fc.oneof(
  {
    arbitrary: fc
      .constantFrom(3_000, 20_000, 1_000, 500)
      .map((maxCells) => ({ maxCells, minCellPx: 0 })),
    weight: 4,
  },
  {
    arbitrary: fc
      .integer({ min: 1, max: 128 })
      .map((maxCells) => ({ maxCells, minCellPx: 0 })),
    weight: 3,
  },
  {
    arbitrary: fc
      .tuple(fc.integer({ min: 1, max: 20_000 }), fc.constantFrom(0, 1, 2, 3, 8, 64, 200, -1))
      .map(([maxCells, minCellPx]) => ({ maxCells, minCellPx })),
    weight: 2,
  },
  {
    arbitrary: fc
      .constantFrom(Number.NaN, 2.5, Number.POSITIVE_INFINITY, -7)
      .map((maxCells) => ({ maxCells, minCellPx: 0 })),
    weight: 1,
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 5: a agregação conserva a execução', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // A cláusula central
  // ───────────────────────────────────────────────────────────────────────────

  it('a soma de cada lado da execução sobre as células entregues iguala a soma sobre a janela', () => {
    fc.assert(
      fc.property(arbScenario, arbBudget, ({ grid, window: visible }, budget) => {
        const outcome = aggregateForZoomWithOutcome(grid, visible, budget);

        if (outcome.budgetExhausted) {
          // Fronteira do critério 3.5: o projeto escolhe zero células em vez de
          // buracos, e a conservação é abandonada ali por decisão explícita.
          // Tem propriedade própria abaixo; aqui só se registra o desvio.
          expect(outcome.cells.count).toBe(0);
          return;
        }

        const expected = referenceSums(grid, visible);

        expectConserved(sumColumn(outcome.cells, 'buy'), expected.buy, 'execução compradora');
        expectConserved(sumColumn(outcome.cells, 'sell'), expected.sell, 'execução vendedora');
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('conserva cada lado separadamente, mesmo quando os dois totais diferem muito', () => {
    fc.assert(
      fc.property(arbScenario, arbBudget, ({ grid, window: visible }, budget) => {
        const outcome = aggregateForZoomWithOutcome(grid, visible, budget);
        if (outcome.budgetExhausted) return;

        const expected = referenceSums(grid, visible);

        // Somar os dois lados num único acumulador conservaria o total e
        // destruiria o desequilíbrio entre agressor comprador e vendedor — que é
        // a informação que a execução carrega. Esta asserção reprova essa troca:
        // o par de somas tem de bater lado a lado, não em conjunto.
        const totalEsperado = expected.buy + expected.sell;
        const totalObtido =
          sumColumn(outcome.cells, 'buy') + sumColumn(outcome.cells, 'sell');
        expectConserved(totalObtido, totalEsperado, 'execução total');

        if (expected.buy !== expected.sell) {
          expectConserved(sumColumn(outcome.cells, 'buy'), expected.buy, 'compradora');
          expectConserved(sumColumn(outcome.cells, 'sell'), expected.sell, 'vendedora');
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Conservação sob agrupamento forçado e sob repetição
  // ───────────────────────────────────────────────────────────────────────────

  it('conserva quando o orçamento aperta e a dimensão mínima é dobrada — nenhum grupo é descartado', () => {
    fc.assert(
      fc.property(
        arbGridSpec.chain((spec) =>
          // Cobertura total do eixo, para que o número de grupos seja o maior
          // possível e o orçamento apertado de fato force repetições.
          arbUsableWindow(spec).map((visible) => ({ grid: buildGrid(spec), window: visible })),
        ),
        fc.integer({ min: 1, max: 24 }),
        ({ grid, window: visible }, maxCells) => {
          const outcome = aggregateForZoomWithOutcome(grid, visible, { maxCells, minCellPx: 0 });
          if (outcome.budgetExhausted) {
            expect(outcome.cells.count).toBe(0);
            return;
          }

          expect(outcome.cells.count).toBeLessThanOrEqual(maxCells);

          // O ponto desta propriedade: repetir dobrando o mínimo **agrega mais
          // grosso**, não descarta. Truncar por ordenação passaria na cláusula
          // do teto e falharia aqui, que é exatamente a regressão a impedir —
          // buraco no heatmap é indistinguível de ausência de liquidez.
          const expected = referenceSums(grid, visible);
          expectConserved(sumColumn(outcome.cells, 'buy'), expected.buy, 'compradora');
          expectConserved(sumColumn(outcome.cells, 'sell'), expected.sell, 'vendedora');
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A propriedade metamórfica — o enunciado sem oráculo
  // ───────────────────────────────────────────────────────────────────────────

  it('o total negociado não muda com o nível de zoom sobre a mesma janela', () => {
    fc.assert(
      fc.property(
        arbGridSpec,
        fc.tuple(arbPxPorBalde, arbPxPorTick),
        fc.tuple(arbPxPorBalde, arbPxPorTick),
        arbBudget,
        arbBudget,
        (spec, [pxBaldeA, pxTickA], [pxBaldeB, pxTickB], budgetA, budgetB) => {
          const grid = buildGrid(spec);

          const timeLength = spec.times.length;
          const priceLength = spec.prices.length;
          const baldesVisiveis = Math.max(1, timeLength);
          const ticksVisiveis = Math.max(1, priceLength);

          // Os LIMITES são idênticos nas duas leituras; muda só a densidade de
          // pixels e o orçamento. Logo o conjunto selecionado é o mesmo e a
          // igualdade das somas é o enunciado do requisito na forma direta,
          // **sem oráculo**: nada aqui recalcula a soma esperada, então nenhuma
          // suposição sobre o recorte é reintroduzida no teste.
          const bounds = {
            tsDe: spec.times[0] ?? ABERTURA_MS,
            tsAte: spec.times[timeLength - 1] ?? ABERTURA_MS,
            precoDe: spec.prices[0] ?? PRECO_BASE,
            precoAte: spec.prices[priceLength - 1] ?? PRECO_BASE,
            baldesVisiveis,
            ticksVisiveis,
          };

          const zoomA: VisibleWindow = {
            ...bounds,
            larguraPx: baldesVisiveis * pxBaldeA,
            alturaPx: ticksVisiveis * pxTickA,
          };
          const zoomB: VisibleWindow = {
            ...bounds,
            larguraPx: baldesVisiveis * pxBaldeB,
            alturaPx: ticksVisiveis * pxTickB,
          };

          const a = aggregateForZoomWithOutcome(grid, zoomA, budgetA);
          const b = aggregateForZoomWithOutcome(grid, zoomB, budgetB);
          if (a.budgetExhausted || b.budgetExhausted) return;

          expectConserved(
            sumColumn(b.cells, 'buy'),
            sumColumn(a.cells, 'buy'),
            'compradora entre zooms',
          );
          expectConserved(
            sumColumn(b.cells, 'sell'),
            sumColumn(a.cells, 'sell'),
            'vendedora entre zooms',
          );
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // As três condições que tornam o enunciado curto verdadeiro
  // ───────────────────────────────────────────────────────────────────────────

  it('valor de execução inválido conta como zero, sem contaminar o outro lado da mesma célula', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 20 }),
        fc.boolean(),
        fc.array(
          fc.tuple(
            fc.constantFrom(
              Number.NaN,
              Number.POSITIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
              -1,
              -0.25,
              -36_232,
            ),
            fc.integer({ min: 1, max: 2_442 }),
          ),
          { minLength: 1, maxLength: 80 },
        ),
        arbBudget,
        arbPxPorBalde,
        arbPxPorTick,
        (timeLength, priceLength, invalidoNaCompra, pares, budget, pxBalde, pxTick) => {
          // Um lado recebe **só** valor inválido; o outro, só contagem positiva.
          // É o que torna a afirmação de isolamento por campo verificável em vez
          // de inferida: o lado inválido tem de somar zero exato, e o lado válido
          // tem de somar tudo. Uma implementação que zerasse a célula inteira ao
          // ver um valor inválido passaria na cláusula central e falharia aqui.
          const cells: CellSpec[] = pares.map(([invalido, valido], k) => ({
            ti: k % timeLength,
            pi: k % priceLength,
            bid: valido,
            ask: invalido,
            buy: invalidoNaCompra ? invalido : valido,
            sell: invalidoNaCompra ? valido : invalido,
          }));

          const spec: GridSpec = {
            times: timeAxis(timeLength),
            prices: priceAxis(priceLength),
            cells,
          };
          const grid = buildGrid(spec);

          const visible: VisibleWindow = {
            tsDe: spec.times[0] ?? ABERTURA_MS,
            tsAte: spec.times[timeLength - 1] ?? ABERTURA_MS,
            precoDe: spec.prices[0] ?? PRECO_BASE,
            precoAte: spec.prices[priceLength - 1] ?? PRECO_BASE,
            larguraPx: timeLength * pxBalde,
            alturaPx: priceLength * pxTick,
            baldesVisiveis: timeLength,
            ticksVisiveis: priceLength,
          };

          const outcome = aggregateForZoomWithOutcome(grid, visible, budget);
          if (outcome.budgetExhausted) return;

          const expected = referenceSums(grid, visible);
          const somaValida = pares.reduce((acc, [, valido]) => acc + valido, 0);

          // O gerador de fato produziu o caso interessante: há execução válida a
          // preservar. Sem esta asserção, a propriedade poderia passar por
          // vacuidade se todos os pares fossem selecionados fora da janela.
          expect(somaValida).toBeGreaterThan(0);

          const ladoInvalido = invalidoNaCompra ? 'buy' : 'sell';
          const ladoValido = invalidoNaCompra ? 'sell' : 'buy';

          expect(expected[ladoInvalido]).toBe(0);
          expect(expected[ladoValido]).toBe(somaValida);

          expectConserved(sumColumn(outcome.cells, ladoInvalido), 0, 'lado inválido');
          expectConserved(sumColumn(outcome.cells, ladoValido), somaValida, 'lado válido');
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('janela degenerada entrega zero células e soma zero dos dois lados, sem lançar', () => {
    /** Cada ramo viola uma das cláusulas do critério 3.9, uma por vez. */
    const arbDegenerada = (spec: GridSpec): fc.Arbitrary<VisibleWindow> => {
      const base = {
        tsDe: spec.times[0] ?? ABERTURA_MS,
        tsAte: spec.times[spec.times.length - 1] ?? ABERTURA_MS + BALDE_MS,
        precoDe: spec.prices[0] ?? PRECO_BASE,
        precoAte: spec.prices[spec.prices.length - 1] ?? PRECO_BASE + TICK,
        larguraPx: 800,
        alturaPx: 400,
        baldesVisiveis: Math.max(1, spec.times.length),
        ticksVisiveis: Math.max(1, spec.prices.length),
      };

      return fc.oneof(
        fc.constantFrom<VisibleWindow>(
          { ...base, larguraPx: 0 },
          { ...base, larguraPx: -800 },
          { ...base, alturaPx: 0 },
          { ...base, alturaPx: -400 },
          { ...base, larguraPx: Number.NaN },
          { ...base, alturaPx: Number.POSITIVE_INFINITY },
          // Limites invertidos.
          { ...base, tsDe: base.tsAte + BALDE_MS, tsAte: base.tsDe },
          { ...base, precoDe: base.precoAte + TICK, precoAte: base.precoDe },
          // Limites não finitos.
          { ...base, tsDe: Number.NaN },
          { ...base, tsAte: Number.NaN },
          { ...base, precoDe: Number.NEGATIVE_INFINITY, precoAte: Number.POSITIVE_INFINITY },
          { ...base, precoAte: Number.NaN },
        ),
      );
    };

    fc.assert(
      fc.property(
        arbGridSpec.chain((spec) =>
          arbDegenerada(spec).map((visible) => ({ grid: buildGrid(spec), window: visible })),
        ),
        arbBudget,
        ({ grid, window: visible }, budget) => {
          const outcome = aggregateForZoomWithOutcome(grid, visible, budget);

          expect(outcome.cells.count).toBe(0);
          expect(sumColumn(outcome.cells, 'buy')).toBe(0);
          expect(sumColumn(outcome.cells, 'sell')).toBe(0);

          // Nenhum agrupamento foi tentado, então não há evento a registrar: a
          // janela degenerada é situação normal durante a montagem do gráfico, e
          // confundi-la com esgotamento de orçamento encheria o log de ruído.
          expect(outcome.budgetExhausted).toBe(false);
          expect(outcome.repetitions).toBe(0);
          expect(outcome.cells.fatorTempo).toBe(1);
          expect(outcome.cells.fatorPreco).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('orçamento esgotado entrega zero células — a conservação é abandonada por decisão de projeto', () => {
    fc.assert(
      fc.property(
        // Janela incoerente por construção: declara **uma** unidade visível por
        // eixo dentro de um viewport enorme, enquanto os limites abrangem todos
        // os instantes e preços do grid.
        //
        // ⚠️ A incoerência é o ponto, não um atalho. `baldesVisiveis` e
        // `ticksVisiveis` chegam por parâmetro e são independentes dos limites,
        // então um produtor que os calcule de forma inconsistente cai aqui: com
        // pixels de sobra por unidade declarada, dobrar a dimensão mínima doze
        // vezes não reduz grupo algum e os fatores ficam em 1. É exatamente o
        // caso que a cota de repetições existe para encerrar — sem ela, o laço
        // não terminaria.
        //
        // Janela coerente **não** esgota: os fatores crescem até colapsar cada
        // eixo num grupo, e um grupo cabe em qualquer orçamento maior ou igual a
        // 1. Foi o que a primeira versão desta propriedade descobriu, ao supor
        // que orçamento de uma célula bastasse para esgotar.
        fc.integer({ min: 2, max: 40 }),
        fc.integer({ min: 2, max: 20 }),
        (timeLength, priceLength) => {
          const cells: CellSpec[] = [];
          for (let i = 0; i < timeLength; i += 1) {
            for (let j = 0; j < priceLength; j += 1) {
              cells.push({ ti: i, pi: j, bid: 0, ask: 0, buy: 100, sell: 250 });
            }
          }

          const spec: GridSpec = {
            times: timeAxis(timeLength),
            prices: priceAxis(priceLength),
            cells,
          };
          const grid = buildGrid(spec);

          const visible: VisibleWindow = {
            tsDe: spec.times[0] ?? ABERTURA_MS,
            tsAte: spec.times[timeLength - 1] ?? ABERTURA_MS,
            precoDe: spec.prices[0] ?? PRECO_BASE,
            precoAte: spec.prices[priceLength - 1] ?? PRECO_BASE,
            // Grande o suficiente para que doze duplicações da dimensão mínima
            // (3 px → 12.288 px) não cheguem sequer ao fator 2: `ceil(12288 /
            // 1e6) = 1`. Assim o esgotamento é garantido para qualquer par de
            // comprimentos gerado, em vez de depender do tamanho sorteado.
            larguraPx: 1_000_000,
            alturaPx: 1_000_000,
            baldesVisiveis: 1,
            ticksVisiveis: 1,
          };

          const outcome = aggregateForZoomWithOutcome(grid, visible, {
            maxCells: 1,
            minCellPx: 0,
          });

          // Há mais de um grupo a formar e o orçamento é de um só, então o
          // esgotamento é o desfecho esperado.
          expect(cells.length).toBeGreaterThan(1);
          expect(outcome.budgetExhausted).toBe(true);
          expect(outcome.cells.count).toBe(0);
          expect(sumColumn(outcome.cells, 'buy')).toBe(0);

          // E a execução da janela **não** é zero: o registro explícito de que a
          // conservação foi deliberadamente rompida aqui, e por isso a cláusula
          // central é condicionada ao desfecho em vez de valer sem ressalva.
          expect(referenceSums(grid, visible).buy).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O que sustenta as demais
  // ───────────────────────────────────────────────────────────────────────────

  it('é função total e determinística: nunca lança, e a soma entregue é sempre finita', () => {
    fc.assert(
      fc.property(arbScenario, arbBudget, ({ grid, window: visible }, budget) => {
        // A chamada é a asserção de que não lança: valor não finito, índice fora
        // do eixo e orçamento inutilizável resolvem por saneamento, não por
        // exceção. Exceção propagada daqui alcançaria o ciclo de desenho do
        // gráfico e o congelaria por causa de uma camada de contexto.
        const cells = aggregateForZoom(grid, visible, budget);
        const outcome = aggregateForZoomWithOutcome(grid, visible, budget);

        // Determinismo: sem ele um contraexemplo das outras propriedades não
        // seria reproduzível, e nenhuma delas significaria algo.
        const again = aggregateForZoom(grid, visible, budget);
        expect(Array.from(again.buy.subarray(0, again.count))).toEqual(
          Array.from(cells.buy.subarray(0, cells.count)),
        );
        expect(Array.from(again.sell.subarray(0, again.count))).toEqual(
          Array.from(cells.sell.subarray(0, cells.count)),
        );

        // Nenhum valor de execução entregue é não finito nem negativo: o
        // saneamento é por campo e a soma preserva o sinal. Valor não finito não
        // faz o desenho lançar — simplesmente não desenha, em silêncio —, então
        // a proibição é afirmada aqui.
        for (let i = 0; i < cells.count; i += 1) {
          const buy = cells.buy[i] ?? Number.NaN;
          const sell = cells.sell[i] ?? Number.NaN;
          expect(Number.isFinite(buy)).toBe(true);
          expect(Number.isFinite(sell)).toBe(true);
          expect(buy).toBeGreaterThanOrEqual(0);
          expect(sell).toBeGreaterThanOrEqual(0);
        }

        // O teto do orçamento vale junto da conservação: conservar somando tudo
        // numa única célula seria uma forma de passar na cláusula central
        // violando o requisito 3.1.
        const maxCells = Number.isInteger(budget.maxCells)
          ? Math.min(20_000, Math.max(1, budget.maxCells))
          : DEFAULT_MAX_CELLS;
        expect(cells.count).toBeLessThanOrEqual(maxCells);

        // E os fatores refletem o mínimo por eixo que o núcleo aplica: fator 1
        // só quando a dimensão já alcança o mínimo. É o que amarra a agregação à
        // densidade de pixels declarada, em vez de a um número escolhido à parte.
        expect(cells.fatorTempo).toBeGreaterThanOrEqual(1);
        expect(cells.fatorPreco).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(cells.fatorTempo)).toBe(true);
        expect(Number.isInteger(cells.fatorPreco)).toBe(true);

        // ⚠️ A cláusula vale para a dimensão mínima **configurada**, logo só
        // quando nenhuma repetição ocorreu: o critério 3.5 manda dobrar o mínimo
        // a cada repetição, e depois de dobrar o fator 1 deixa de ser o esperado
        // — é a diferença entre "já alcança o mínimo" e "já alcançava o mínimo
        // anterior". A primeira versão desta propriedade omitia a condição e
        // reprovava a implementação correta com orçamento apertado.
        const usaMinimoPadrao = !(Number.isFinite(budget.minCellPx) && budget.minCellPx > 0);
        if (usaMinimoPadrao && cells.count > 0 && outcome.repetitions === 0) {
          const pxPorBalde = visible.larguraPx / Math.max(1, visible.baldesVisiveis);
          if (pxPorBalde >= DEFAULT_MIN_WIDTH_PX) expect(cells.fatorTempo).toBe(1);
          const pxPorTick = visible.alturaPx / Math.max(1, visible.ticksVisiveis);
          if (pxPorTick >= DEFAULT_MIN_HEIGHT_PX) expect(cells.fatorPreco).toBe(1);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
