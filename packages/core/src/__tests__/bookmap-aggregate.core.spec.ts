/**
 * Bordas da agregação por zoom e do recorte em pixels — spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.8.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA SUÍTE É — E POR QUE ELA EXISTE AO LADO DAS PROPRIEDADES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Teste **por exemplo**, não por geração. As propriedades p04, p05, p06 e p07 já
 * afirmam por quantificação universal que a fila combina por máximo, que a
 * execução é conservada, que o fator unitário é idempotente e que o orçamento é
 * respeitado sem produzir valor não finito. Repetir aquilo aqui com geradores
 * seria trabalho duplicado e pior.
 *
 * O que uma propriedade **não** entrega é o caso âncora: uma entrada pequena,
 * legível, com o resultado escrito à mão. É isso que documenta o comportamento
 * para quem chega depois, e é isso que falha de forma diagnosticável quando
 * alguém mexer no agrupamento — uma propriedade reprovada devolve um
 * contraexemplo reduzido que ainda precisa ser interpretado; um exemplo com
 * valor esperado literal aponta direto para o que mudou.
 *
 * Cada número esperado abaixo foi derivado do texto dos critérios e da
 * aritmética da geometria, e está justificado no comentário do próprio teste.
 * Nenhum foi copiado de uma execução do código sob teste — a suíte só vale como
 * juiz enquanto isso for verdade.
 *
 * ── AS BORDAS COBERTAS ────────────────────────────────────────────────────
 *
 * | Borda                                            | Critério  |
 * |--------------------------------------------------|-----------|
 * | fator 1 em ambos os eixos, valores intactos      | 3.4, 3.7  |
 * | fator alto: a parede de 2.442 ct não vira média  | 3.2, 3.3  |
 * | janela cujos limites não contêm célula alguma    | 3.4       |
 * | orçamento apertado que força a duplicação        | 3.5       |
 * | doze duplicações esgotadas ⇒ zero células        | 3.5       |
 * | janela invertida, colapsada ou não finita        | 3.9       |
 * | valor de entrada inválido, sanitizado por campo  | 3.10      |
 * | orçamento restringido a `[1, 20.000]`, padrão 3.000 | 3.1    |
 * | dimensão mínima em `[1, 64]`, padrões 3 px e 2 px  | 3.8     |
 * | recorte no viewport com piso de 1 px             | 3.6       |
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PUREZA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nada aqui toca DOM, relógio, sorteio, rede ou sistema de arquivos. As funções
 * de coordenada são substituídas por tabelas de consulta explícitas, de modo que
 * o retângulo esperado seja consequência de aritmética visível e não do estado de
 * um gráfico.
 *
 * Este arquivo importa **exclusivamente** o módulo público do núcleo de render,
 * que por sua vez só alcança os irmãos da própria pasta. Nenhuma camada de
 * roteamento de conexão, de feed de tick, de execução de ordem ou de estado de
 * posição está no fechamento transitivo, e nenhum endereço de rede, identificador
 * de conta ou credencial aparece aqui. Todo insumo é construído em memória pelo
 * próprio teste; nada é lido de arquivo, em CSV ou em qualquer formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente, nem como exemplo do que evitar: a verificação de independência
 * inspeciona **integralmente** todo arquivo criado por esta feature, testes
 * incluídos, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';

import {
  aggregateForZoom,
  aggregateForZoomWithOutcome,
  cellToPixels,
} from '@robustus/charts-core';
import type {
  AggregatedCell,
  AggregatedCells,
  BookmapGrid,
  CellGeometry,
  CoordinateFns,
  VisibleWindow,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes do cenário de referência
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte, e com zero milissegundo para que `tsMs / 1000` seja
 * inteiro exato — o que mantém as tabelas de coordenada casáveis por igualdade.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** O único tamanho de balde materializado. */
const BALDE_MS = 60_000;
const BALDE_SEG = BALDE_MS / 1_000;

/** Base do eixo de preço e o incremento mínimo do ativo de referência. */
const PRECO_BASE = 176_000;
const PRECO_PASSO = 5;

/**
 * A maior oferta em repouso que de fato existiu dentro da banda de ±2.000 pts do
 * miolo. Aparece em quase todo cenário porque é a magnitude cuja perda seria mais
 * danosa: é a parede que o operador olha para decidir.
 */
const PAREDE_CT = 2_442;

// ═════════════════════════════════════════════════════════════════════════════
// Construção de insumo
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
 * Os eixos saem estritamente crescentes por construção, como o decodificador
 * garante em produção. O eixo de tempo é de precisão dupla por necessidade: epoch
 * ms na ordem de 1,79 × 10¹² não cabe na mantissa de 24 bits de um número de
 * precisão simples, e o instante seria arredondado para múltiplos de ~131 s —
 * baldes distintos colidiriam no mesmo grupo e a contagem medida aqui deixaria de
 * ser a contagem real.
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
    baldeSeg: BALDE_SEG,
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

/** Janela que abrange o grid inteiro, com as dimensões em pixel informadas. */
function janelaSobre(
  grid: BookmapGrid,
  px: {
    readonly larguraPx: number;
    readonly alturaPx: number;
    readonly baldesVisiveis: number;
    readonly ticksVisiveis: number;
  },
): VisibleWindow {
  const ultimoTempo = grid.times.length - 1;
  const ultimoPreco = grid.prices.length - 1;
  return {
    tsDe: grid.times[0] ?? Number.NaN,
    tsAte: grid.times[ultimoTempo] ?? Number.NaN,
    precoDe: grid.prices[0] ?? Number.NaN,
    precoAte: grid.prices[ultimoPreco] ?? Number.NaN,
    larguraPx: px.larguraPx,
    alturaPx: px.alturaPx,
    baldesVisiveis: px.baldesVisiveis,
    ticksVisiveis: px.ticksVisiveis,
  };
}

/**
 * Janela deliberadamente **incoerente**: declara uma única unidade visível por
 * eixo enquanto os limites abrangem muitos instantes e muitos preços.
 *
 * Serve a um propósito único e é o cenário que a cota de doze duplicações existe
 * para encerrar. Como `baldesVisiveis` e `ticksVisiveis` chegam por parâmetro,
 * independentes dos limites, os pixels por unidade ficam enormes e os fatores de
 * agrupamento permanecem em 1 **por todas as treze tentativas** — o orçamento
 * estourado nunca é resolvido por agrupamento mais grosso. É a única forma de
 * exercitar o esgotamento sem depender de um grid gigantesco.
 *
 * A aritmética que sustenta isso: a maior dimensão mínima alcançada é
 * `3 × 2¹² = 12.288` px de largura e `2 × 2¹² = 8.192` px de altura; com 20.000 px
 * por unidade, o menor fator que alcança o mínimo continua sendo 1 em ambos.
 */
function janelaIncoerenteSobre(grid: BookmapGrid): VisibleWindow {
  return janelaSobre(grid, {
    larguraPx: 20_000,
    alturaPx: 20_000,
    baldesVisiveis: 1,
    ticksVisiveis: 1,
  });
}

/**
 * Lê a célula `i` da saída colunar.
 *
 * A coalescência existe para satisfazer a verificação de índice do compilador; os
 * testes só leem índices em `[0, count)`, onde as sete colunas estão preenchidas.
 */
function celulaEm(cells: AggregatedCells, i: number): AggregatedCell {
  return {
    tsMs: cells.tsMs[i] ?? Number.NaN,
    preco: cells.preco[i] ?? Number.NaN,
    bid: cells.bid[i] ?? Number.NaN,
    ask: cells.ask[i] ?? Number.NaN,
    buy: cells.buy[i] ?? Number.NaN,
    sell: cells.sell[i] ?? Number.NaN,
  };
}

/**
 * Funções de coordenada por **tabela de consulta**.
 *
 * Em produção são as funções do próprio gráfico; aqui a tabela torna o retângulo
 * esperado consequência de aritmética visível. Instante ou preço fora da tabela
 * devolve ausência de valor, que é a resposta legítima de "fora da escala
 * visível" — não um erro.
 *
 * A consulta usa `has` antes de `get` de propósito: sem isso, um valor nulo
 * gravado na tabela ficaria indistinguível de uma chave ausente, e o teste
 * perderia a capacidade de exercitar os dois caminhos separadamente.
 */
function coordsFixos(
  porTempoSeg: ReadonlyMap<number, number | null>,
  porPreco: ReadonlyMap<number, number | null>,
): CoordinateFns {
  return {
    timeToX: (timeSec) => (porTempoSeg.has(timeSec) ? (porTempoSeg.get(timeSec) ?? null) : null),
    priceToY: (price) => (porPreco.has(price) ? (porPreco.get(price) ?? null) : null),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Fator unitário — critérios 3.4 e 3.7
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: fator unitário em ambos os eixos', () => {
  /**
   * Grid de 2 baldes × 2 preços com **três** das quatro combinações ocupadas. A
   * ausente existe para fixar o contrato do critério 3.4: par que não existe na
   * entrada não gera célula na saída, porque ausência já significa zero.
   */
  const grid = construirGrid(2, 2, [
    { ti: 0, pi: 0, bid: 700, ask: 480, buy: 12, sell: 7 },
    { ti: 0, pi: 1, bid: PAREDE_CT, ask: 15, buy: 3, sell: 21 },
    { ti: 1, pi: 0, bid: 310, ask: 905, buy: 40, sell: 2 },
  ]);

  /**
   * Viewport folgado: 800 px para 2 baldes dá 400 px por balde, e 400 px para 2
   * ticks dá 200 px por tick. Com as dimensões mínimas padrão — 3 px de largura e
   * 2 px de altura —, o menor fator que alcança o mínimo é 1 nos dois eixos.
   *
   * `minCellPx: 0` não é override utilizável, então os padrões por eixo valem: é
   * exatamente o caminho que o critério 3.8 descreve.
   */
  const janela = janelaSobre(grid, {
    larguraPx: 800,
    alturaPx: 400,
    baldesVisiveis: 2,
    ticksVisiveis: 2,
  });
  const orcamento = { maxCells: 3_000, minCellPx: 0 };

  it('entrega uma célula por par existente, com os fatores em 1', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(cells.fatorTempo).toBe(1);
    expect(cells.fatorPreco).toBe(1);
    // Três células de entrada na janela, três na saída. O par (1, 1) não existe e
    // não é inventado.
    expect(cells.count).toBe(3);
  });

  it('preserva os quatro valores de cada célula sem tocá-los, na ordem instante e depois preço', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    // Ordenação exigida pelo critério 3.7: instante crescente e, no empate de
    // instante, preço crescente. As duas células do primeiro balde vêm antes da do
    // segundo, e entre elas o preço menor vem primeiro.
    expect(celulaEm(cells, 0)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE,
      bid: 700,
      ask: 480,
      buy: 12,
      sell: 7,
    });
    expect(celulaEm(cells, 1)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE + PRECO_PASSO,
      bid: PAREDE_CT,
      ask: 15,
      buy: 3,
      sell: 21,
    });
    expect(celulaEm(cells, 2)).toEqual({
      tsMs: ABERTURA_MS + BALDE_MS,
      preco: PRECO_BASE,
      bid: 310,
      ask: 905,
      buy: 40,
      sell: 2,
    });
  });

  it('com fator unitário o preço da célula é o próprio preço de entrada, não uma média de faixa', () => {
    // O preço de saída é o CENTRO do grupo de ticks. Com fator 1 o grupo degenera
    // num ponto, então o centro tem de coincidir com o preço da entrada — é o que
    // a idempotência do critério 3.4 exige, e é onde um erro de ±meio tick se
    // esconderia sem esta afirmação.
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 0).preco).toBe(PRECO_BASE);
    expect(celulaEm(cells, 1).preco).toBe(PRECO_BASE + PRECO_PASSO);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Fator alto — critérios 3.2 e 3.3
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: fator alto colapsando quatro células em uma', () => {
  /**
   * Quatro células no canto do grid, com valores escolhidos para que o operador
   * `max` e o operador `sum` produzam resultados **distinguíveis** de qualquer
   * outra combinação plausível.
   *
   * A fila de compra é a peça central: `2.442`, `222`, `100` e `50`. O máximo é
   * 2.442 e a média é 703,5. Se a implementação diluísse por média, a parede
   * medida em mesa desapareceria do desenho — é a razão inteira de o operador ser
   * o máximo, e a afirmação abaixo é o que impede a troca silenciosa.
   */
  const grid = construirGrid(6, 6, [
    { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
    { ti: 0, pi: 1, bid: 222, ask: 20, buy: 2, sell: 6 },
    { ti: 1, pi: 0, bid: 100, ask: 30, buy: 3, sell: 7 },
    { ti: 1, pi: 1, bid: 50, ask: 2_000, buy: 4, sell: 8 },
  ]);

  /**
   * Zoom afastado: 12 px para 6 baldes declarados visíveis dá 2 px por balde, e o
   * mesmo no eixo de preço. Com override de 4 px, o menor fator que alcança o
   * mínimo é `ceil(4 / 2) = 2` nos dois eixos.
   *
   * O grid tem 6 posições por eixo, então o teto de um grupo por eixo não morde e
   * os fatores ficam em 2. Com fator 2, os índices 0 e 1 caem no mesmo grupo em
   * ambos os eixos: as quatro células colapsam numa só.
   */
  const janela = janelaSobre(grid, {
    larguraPx: 12,
    alturaPx: 12,
    baldesVisiveis: 6,
    ticksVisiveis: 6,
  });
  const orcamento = { maxCells: 3_000, minCellPx: 4 };

  it('adota fator 2 nos dois eixos e entrega um único grupo', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(cells.fatorTempo).toBe(2);
    expect(cells.fatorPreco).toBe(2);
    expect(cells.count).toBe(1);
  });

  it('combina a fila pelo máximo e a execução pela soma, com os valores escritos à mão', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 0)).toEqual({
      // Borda ESQUERDA do grupo de baldes: o índice 0 do eixo, não o centro.
      tsMs: ABERTURA_MS,
      // CENTRO do grupo de ticks: (176.000 + 176.005) / 2.
      preco: PRECO_BASE + PRECO_PASSO / 2,
      // max(2.442, 222, 100, 50)
      bid: PAREDE_CT,
      // max(10, 20, 30, 2.000)
      ask: 2_000,
      // 1 + 2 + 3 + 4
      buy: 10,
      // 5 + 6 + 7 + 8
      sell: 26,
    });
  });

  it('a parede não é diluída: o valor entregue é o máximo, e não a média dos quatro membros', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);
    const mediaDosMembros = (PAREDE_CT + 222 + 100 + 50) / 4;

    // 703,5 é o que uma média produziria. A afirmação existe na forma negativa de
    // propósito: é o valor concreto que já enganou uma leitura de mesa.
    expect(mediaDosMembros).toBe(703.5);
    expect(celulaEm(cells, 0).bid).not.toBe(mediaDosMembros);
    expect(celulaEm(cells, 0).bid).toBe(PAREDE_CT);
  });

  it('a execução não é diluída: o valor entregue é a soma, e não o máximo dos membros', () => {
    // O espelho da afirmação anterior. Trocar `sum` por `max` na execução passaria
    // pelos testes de fila e perderia o total negociado — 10 viraria 4.
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 0).buy).toBe(10);
    expect(celulaEm(cells, 0).buy).not.toBe(4);
    expect(celulaEm(cells, 0).sell).toBe(26);
    expect(celulaEm(cells, 0).sell).not.toBe(8);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Janela sem célula alguma
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: janela cujos limites não contêm célula alguma', () => {
  const grid = construirGrid(3, 3, [
    { ti: 0, pi: 0, bid: 700, ask: 480, buy: 12, sell: 7 },
    { ti: 1, pi: 1, bid: PAREDE_CT, ask: 15, buy: 3, sell: 21 },
    { ti: 2, pi: 2, bid: 310, ask: 905, buy: 40, sell: 2 },
  ]);

  const pixels = { larguraPx: 800, alturaPx: 400, baldesVisiveis: 3, ticksVisiveis: 3 };
  const orcamento = { maxCells: 3_000, minCellPx: 0 };

  it('limites de tempo posteriores ao último balde entregam zero células, sem lançar', () => {
    // A janela é perfeitamente utilizável — pixels positivos, limites ordenados e
    // finitos. Só não há dado nela.
    const depoisDoFim = grid.times[grid.times.length - 1] ?? Number.NaN;
    const janela: VisibleWindow = {
      ...janelaSobre(grid, pixels),
      tsDe: depoisDoFim + BALDE_MS,
      tsAte: depoisDoFim + 2 * BALDE_MS,
    };

    const outcome = aggregateForZoomWithOutcome(grid, janela, orcamento);

    expect(outcome.cells.count).toBe(0);
    // ⚠️ A distinção que importa: vazio por ausência de dado NÃO é evento a
    // registrar. Só o esgotamento de orçamento é, e ele não aconteceu aqui.
    expect(outcome.budgetExhausted).toBe(false);
    expect(outcome.repetitions).toBe(0);
  });

  it('limites de preço acima do eixo entregam zero células, sem lançar', () => {
    const acimaDoTopo = grid.prices[grid.prices.length - 1] ?? Number.NaN;
    const janela: VisibleWindow = {
      ...janelaSobre(grid, pixels),
      precoDe: acimaDoTopo + PRECO_PASSO,
      precoAte: acimaDoTopo + 10 * PRECO_PASSO,
    };

    const outcome = aggregateForZoomWithOutcome(grid, janela, orcamento);

    expect(outcome.cells.count).toBe(0);
    expect(outcome.budgetExhausted).toBe(false);
  });

  it('as colunas da saída vazia existem e têm comprimento zero, em vez de ficarem indefinidas', () => {
    // O laço de desenho percorre as colunas sem verificar existência. Coluna
    // indefinida derrubaria a passada inteira; comprimento zero simplesmente não
    // desenha nada.
    const janela: VisibleWindow = {
      ...janelaSobre(grid, pixels),
      precoDe: PRECO_BASE - 100 * PRECO_PASSO,
      precoAte: PRECO_BASE - 50 * PRECO_PASSO,
    };

    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(cells.count).toBe(0);
    expect(cells.tsMs.length).toBe(0);
    expect(cells.preco.length).toBe(0);
    expect(cells.bid.length).toBe(0);
    expect(cells.ask.length).toBe(0);
    expect(cells.buy.length).toBe(0);
    expect(cells.sell.length).toBe(0);
  });

  it('grid sem célula alguma entrega zero células, sem lançar', () => {
    const vazio = construirGrid(2, 2, []);
    const janela = janelaSobre(vazio, pixels);

    const outcome = aggregateForZoomWithOutcome(vazio, janela, orcamento);

    expect(outcome.cells.count).toBe(0);
    expect(outcome.budgetExhausted).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Orçamento apertado — critério 3.5
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: orçamento apertado força a duplicação da dimensão mínima', () => {
  /**
   * Grid de 8 baldes × 8 preços com **todos** os 64 pares ocupados. A fila de
   * compra é 100 em todo lugar menos numa célula, que carrega a parede; a execução
   * é 1 e 2 por célula, de modo que os totais da janela sejam exatamente 64 e 128
   * e qualquer descarte de grupo apareça como perda aritmética.
   */
  const PAREDE_TI = 5;
  const PAREDE_PI = 6;
  const celulas: CelulaSintetica[] = [];
  for (let ti = 0; ti < 8; ti += 1) {
    for (let pi = 0; pi < 8; pi += 1) {
      const naParede = ti === PAREDE_TI && pi === PAREDE_PI;
      celulas.push({ ti, pi, bid: naParede ? PAREDE_CT : 100, ask: 40, buy: 1, sell: 2 });
    }
  }
  const grid = construirGrid(8, 8, celulas);

  /**
   * 800 px para 8 baldes dá 100 px por balde; 400 px para 8 ticks dá 50 px por
   * tick. A tabela abaixo é a derivação completa das treze tentativas, com as
   * dimensões mínimas dobrando a cada uma:
   *
   * | tentativa | largura mín | fator tempo   | altura mín | fator preço  | grupos |
   * |-----------|-------------|---------------|------------|--------------|--------|
   * | 0         |      3      | ceil(3/100)=1 |      2     | ceil(2/50)=1 | 8×8=64 |
   * | 1         |      6      |             1 |      4     |            1 |     64 |
   * | 2         |     12      |             1 |      8     |            1 |     64 |
   * | 3         |     24      |             1 |     16     |            1 |     64 |
   * | 4         |     48      |             1 |     32     |            1 |     64 |
   * | 5         |     96      |             1 |     64     | ceil(64/50)=2|  8×4=32 |
   * | 6         |    192      | ceil(192/100)=2 |  128     |ceil(128/50)=3|  4×3=12 |
   *
   * Com orçamento de 16 células, as tentativas 0 a 5 estouram e a 6 cabe. Logo:
   * seis repetições consumidas, fatores 2 e 3, doze grupos.
   */
  const janela = janelaSobre(grid, {
    larguraPx: 800,
    alturaPx: 400,
    baldesVisiveis: 8,
    ticksVisiveis: 8,
  });
  const ORCAMENTO = 16;
  const orcamento = { maxCells: ORCAMENTO, minCellPx: 0 };

  it('resolve dobrando a dimensão mínima seis vezes, chegando aos fatores 2 e 3', () => {
    const outcome = aggregateForZoomWithOutcome(grid, janela, orcamento);

    expect(outcome.repetitions).toBe(6);
    expect(outcome.repetitions).toBeLessThanOrEqual(12);
    expect(outcome.budgetExhausted).toBe(false);
    expect(outcome.cells.fatorTempo).toBe(2);
    expect(outcome.cells.fatorPreco).toBe(3);
  });

  it('entrega DOZE células — menos que o orçamento de dezesseis, que é a assinatura de não ter truncado', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    // ⭐ Esta é a afirmação que separa as duas estratégias possíveis. Uma
    // implementação que truncasse por ordenação entregaria exatamente 16 células —
    // as dezesseis maiores de 64 — e ficaria colada no teto. Dobrar a dimensão
    // mínima produz 12, ABAIXO do teto, porque o agrupamento inteiro passou a
    // caber. Contagem igual ao orçamento seria o sintoma do truncamento.
    expect(cells.count).toBe(12);
    expect(cells.count).toBeLessThan(ORCAMENTO);
  });

  it('nenhum grupo é descartado: o pico da fila e o total da execução sobrevivem inteiros', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    let maiorBid = 0;
    let totalBuy = 0;
    let totalSell = 0;
    for (let i = 0; i < cells.count; i += 1) {
      const c = celulaEm(cells, i);
      if (c.bid > maiorBid) maiorBid = c.bid;
      totalBuy += c.buy;
      totalSell += c.sell;
    }

    // A parede está num grupo qualquer, e o máximo global da janela é preservado
    // exatamente — não aproximadamente.
    expect(maiorBid).toBe(PAREDE_CT);
    // 64 células × 1 e × 2. Truncar teria reduzido os dois totais.
    expect(totalBuy).toBe(64);
    expect(totalSell).toBe(128);
  });

  it('o grupo de borda é centrado nos preços que existem, não na faixa nominal do fator', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    // Com fator de preço 3 e oito preços no eixo, o último grupo abrange só os
    // índices 6 e 7 — a faixa nominal de três ticks é truncada pelo fim do eixo.
    // O centro entregue é o dos preços EXISTENTES, (176.030 + 176.035) / 2, e não
    // o centro de uma faixa que passaria do topo do eixo.
    const ultima = celulaEm(cells, cells.count - 1);
    expect(ultima.preco).toBe(PRECO_BASE + 6 * PRECO_PASSO + PRECO_PASSO / 2);
    // Borda esquerda do último grupo de baldes: índice 3 × fator 2 = 6.
    expect(ultima.tsMs).toBe(ABERTURA_MS + 6 * BALDE_MS);
  });

  it('esgotadas as doze repetições, entrega zero células e sinaliza o esgotamento', () => {
    // A janela incoerente mantém os fatores em 1 nas treze tentativas, então
    // agrupar mais grosso nunca resolve. Com orçamento de uma célula e dois grupos
    // formados, o estouro é permanente — é exatamente o caso que a cota encerra em
    // vez de repetir sem fim.
    const doisGrupos = construirGrid(2, 1, [
      { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
      { ti: 1, pi: 0, bid: 100, ask: 20, buy: 2, sell: 6 },
    ]);
    const janelaIncoerente = janelaIncoerenteSobre(doisGrupos);

    const outcome = aggregateForZoomWithOutcome(doisGrupos, janelaIncoerente, {
      maxCells: 1,
      minCellPx: 0,
    });

    expect(outcome.cells.count).toBe(0);
    expect(outcome.budgetExhausted).toBe(true);
    expect(outcome.repetitions).toBe(12);
    // Os fatores relatados descrevem a última tentativa, que de fato permaneceu
    // unitária — é a descrição honesta do que foi tentado.
    expect(outcome.cells.fatorTempo).toBe(1);
    expect(outcome.cells.fatorPreco).toBe(1);
  });

  it('a assinatura fixada pelo projeto devolve a mesma saída vazia, descartando o desfecho', () => {
    const doisGrupos = construirGrid(2, 1, [
      { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
      { ti: 1, pi: 0, bid: 100, ask: 20, buy: 2, sell: 6 },
    ]);
    const janelaIncoerente = janelaIncoerenteSobre(doisGrupos);
    const orcamentoDeUma = { maxCells: 1, minCellPx: 0 };

    const direto = aggregateForZoom(doisGrupos, janelaIncoerente, orcamentoDeUma);
    const comDesfecho = aggregateForZoomWithOutcome(
      doisGrupos,
      janelaIncoerente,
      orcamentoDeUma,
    );

    // ⚠️ Consequência para quem integrar: consumir apenas a assinatura curta deixa
    // o critério 3.5 pela metade — a entrega de zero células acontece, mas o
    // registro único por sessão não tem de onde partir.
    expect(direto.count).toBe(comDesfecho.cells.count);
    expect(direto.count).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Janela degenerada — critério 3.9
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: janela invertida, colapsada ou não finita', () => {
  const grid = construirGrid(3, 3, [
    { ti: 0, pi: 0, bid: 700, ask: 480, buy: 12, sell: 7 },
    { ti: 1, pi: 1, bid: PAREDE_CT, ask: 15, buy: 3, sell: 21 },
    { ti: 2, pi: 2, bid: 310, ask: 905, buy: 40, sell: 2 },
  ]);
  const base = janelaSobre(grid, {
    larguraPx: 800,
    alturaPx: 400,
    baldesVisiveis: 3,
    ticksVisiveis: 3,
  });
  const orcamento = { maxCells: 3_000, minCellPx: 0 };

  /**
   * As formas de degeneração enumeradas pelo critério 3.9, cada uma com o motivo
   * pelo qual ela chega a acontecer em produção.
   */
  const degeneradas: ReadonlyArray<readonly [string, Partial<VisibleWindow>]> = [
    // Painel recolhido ou primeiro quadro antes da medida do contêiner.
    ['largura em pixels igual a zero', { larguraPx: 0 }],
    ['altura em pixels igual a zero', { alturaPx: 0 }],
    ['largura em pixels negativa', { larguraPx: -800 }],
    ['altura em pixels negativa', { alturaPx: -400 }],
    // Divisão por dimensão ainda não medida a montante.
    ['largura em pixels não numérica', { larguraPx: Number.NaN }],
    ['altura em pixels não numérica', { alturaPx: Number.NaN }],
    ['largura em pixels infinita', { larguraPx: Number.POSITIVE_INFINITY }],
    ['altura em pixels infinita', { alturaPx: Number.POSITIVE_INFINITY }],
    // Arrasto que cruza a origem, ou escala de preço invertida.
    ['limite inferior de instante maior que o superior', { tsDe: base.tsAte, tsAte: base.tsDe }],
    [
      'limite inferior de preço maior que o superior',
      { precoDe: base.precoAte, precoAte: base.precoDe },
    ],
    ['limite de instante não numérico', { tsDe: Number.NaN }],
    ['limite de preço não numérico', { precoAte: Number.NaN }],
    ['limite de instante infinito', { tsAte: Number.POSITIVE_INFINITY }],
    ['limite de preço infinito', { precoDe: Number.NEGATIVE_INFINITY }],
  ];

  for (const [rotulo, alteracao] of degeneradas) {
    it(`${rotulo}: entrega zero células e conclui sem lançar`, () => {
      const janela: VisibleWindow = { ...base, ...alteracao };

      let outcome: ReturnType<typeof aggregateForZoomWithOutcome> | null = null;
      expect(() => {
        outcome = aggregateForZoomWithOutcome(grid, janela, orcamento);
      }).not.toThrow();

      // A leitura precisa passar pela variável para o compilador aceitar o
      // estreitamento feito dentro da função anônima acima.
      const resultado = outcome as unknown as ReturnType<typeof aggregateForZoomWithOutcome>;
      expect(resultado.cells.count).toBe(0);
      // Nenhum agrupamento foi tentado, então não há evento a registrar: fatores
      // unitários e zero repetições descrevem isso.
      expect(resultado.cells.fatorTempo).toBe(1);
      expect(resultado.cells.fatorPreco).toBe(1);
      expect(resultado.budgetExhausted).toBe(false);
      expect(resultado.repetitions).toBe(0);
    });
  }

  it('janela de um único instante e de um único preço NÃO é degenerada e entrega a célula que ali existe', () => {
    // O critério fala em limite inferior MAIOR que o superior. Iguais são
    // admitidos, e o recorte é inclusivo nos dois lados — é o zoom máximo, não uma
    // janela inválida. Sem esta afirmação, um `>=` no lugar do `>` passaria.
    const janela: VisibleWindow = {
      ...base,
      tsDe: ABERTURA_MS,
      tsAte: ABERTURA_MS,
      precoDe: PRECO_BASE,
      precoAte: PRECO_BASE,
    };

    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(cells.count).toBe(1);
    expect(celulaEm(cells, 0)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE,
      bid: 700,
      ask: 480,
      buy: 12,
      sell: 7,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Valor de entrada inválido — critério 3.10
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: valor de entrada inválido conta como zero, campo por campo', () => {
  const orcamento = { maxCells: 3_000, minCellPx: 0 };

  /**
   * Quatro células, cada uma com **exatamente um** campo estragado e os outros três
   * íntegros. É o ponto fino do critério 3.10: a sanitização é por campo, não por
   * célula. Uma implementação que descartasse a célula inteira, ou que zerasse os
   * quatro valores, passaria por um teste que só olhasse o campo estragado.
   */
  const grid = construirGrid(1, 4, [
    { ti: 0, pi: 0, bid: Number.NaN, ask: 480, buy: 12, sell: 7 },
    { ti: 0, pi: 1, bid: 700, ask: Number.POSITIVE_INFINITY, buy: 3, sell: 21 },
    { ti: 0, pi: 2, bid: 310, ask: 905, buy: -40, sell: 2 },
    { ti: 0, pi: 3, bid: PAREDE_CT, ask: 15, buy: 9, sell: Number.NEGATIVE_INFINITY },
  ]);
  const janela = janelaSobre(grid, {
    larguraPx: 800,
    alturaPx: 400,
    baldesVisiveis: 1,
    ticksVisiveis: 4,
  });

  it('fila não numérica vira zero e os outros três valores da mesma célula ficam intactos', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 0)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE,
      bid: 0,
      ask: 480,
      buy: 12,
      sell: 7,
    });
  });

  it('fila infinita vira zero e os outros três valores da mesma célula ficam intactos', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 1)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE + PRECO_PASSO,
      bid: 700,
      ask: 0,
      buy: 3,
      sell: 21,
    });
  });

  it('execução negativa vira zero e os outros três valores da mesma célula ficam intactos', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    // Quantidade negativa não existe no domínio; zero é a leitura certa porque
    // ausência de célula já significa zero, e tratar assim mantém as duas
    // ausências indistinguíveis em vez de criar um terceiro estado que o desenho
    // não sabe representar.
    expect(celulaEm(cells, 2)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE + 2 * PRECO_PASSO,
      bid: 310,
      ask: 905,
      buy: 0,
      sell: 2,
    });
  });

  it('execução infinita negativa vira zero e os outros três valores da mesma célula ficam intactos', () => {
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(celulaEm(cells, 3)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE + 3 * PRECO_PASSO,
      bid: PAREDE_CT,
      ask: 15,
      buy: 9,
      sell: 0,
    });
  });

  it('célula com valor inválido NÃO é descartada: as quatro continuam na saída', () => {
    // Descartar a célula seria a alternativa tentadora e estaria errada: o par
    // (balde, preço) existe, e omiti-lo faria o desenho perder posição em que há
    // dado — só o valor estragado é que não se conhece.
    const cells = aggregateForZoom(grid, janela, orcamento);

    expect(cells.count).toBe(4);
  });

  it('dentro de um grupo, fila não numérica não contamina o máximo — a parede sobrevive', () => {
    /**
     * ⭐ A borda mais afiada deste critério. `Math.max(NaN, 2.442)` devolve valor
     * não numérico, e valor não numérico pintado no canvas **não lança**: a célula
     * simplesmente não aparece. A parede desapareceria em silêncio por causa de um
     * único valor estragado num balde vizinho.
     *
     * Geometria: 12 px para 6 baldes declarados dá 2 px por balde; override de 4 px
     * pede `ceil(4 / 2) = 2`, e o grid tem 2 baldes, então o fator fica em 2 e as
     * duas células caem no mesmo grupo. O eixo de preço tem uma posição só, o que
     * mantém o fator de preço em 1 por teto.
     */
    const comValorEstragado = construirGrid(2, 1, [
      { ti: 0, pi: 0, bid: Number.NaN, ask: 10, buy: Number.NaN, sell: 5 },
      { ti: 1, pi: 0, bid: PAREDE_CT, ask: 20, buy: 4, sell: 6 },
    ]);
    const janelaApertada = janelaSobre(comValorEstragado, {
      larguraPx: 12,
      alturaPx: 12,
      baldesVisiveis: 6,
      ticksVisiveis: 6,
    });

    const cells = aggregateForZoom(comValorEstragado, janelaApertada, {
      maxCells: 3_000,
      minCellPx: 4,
    });

    expect(cells.fatorTempo).toBe(2);
    expect(cells.count).toBe(1);
    expect(celulaEm(cells, 0)).toEqual({
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE,
      // max(0, 2.442) — e não valor não numérico.
      bid: PAREDE_CT,
      ask: 20,
      // 0 + 4 — a soma também não é contaminada.
      buy: 4,
      sell: 11,
    });
    expect(Number.isNaN(celulaEm(cells, 0).bid)).toBe(false);
    expect(Number.isNaN(celulaEm(cells, 0).buy)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Normalização do orçamento de células — critério 3.1
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: normalização do orçamento de células', () => {
  /**
   * Grid de uma única célula, para observar o PISO do intervalo.
   *
   * Um grupo cabe em qualquer orçamento maior ou igual a 1. Se um orçamento de
   * zero fosse honrado ao pé da letra, nem esse grupo caberia e a saída viria
   * vazia — é exatamente essa diferença que a afirmação mede.
   */
  const umGrupo = construirGrid(1, 1, [
    { ti: 0, pi: 0, bid: PAREDE_CT, ask: 480, buy: 12, sell: 7 },
  ]);

  /** Grid de dois grupos, para confirmar que o piso é 1 e não 2. */
  const doisGrupos = construirGrid(2, 1, [
    { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
    { ti: 1, pi: 0, bid: 100, ask: 20, buy: 2, sell: 6 },
  ]);

  /**
   * Constrói um grid de `n` grupos: `n` baldes, um preço, uma célula por balde.
   *
   * Serve às afirmações de teto e de padrão, que precisam de contagens grandes
   * para serem observáveis. Os valores são constantes porque o que se mede aqui é
   * a contagem, não a combinação.
   */
  function gridComGrupos(n: number): BookmapGrid {
    const celulas: CelulaSintetica[] = [];
    for (let ti = 0; ti < n; ti += 1) {
      celulas.push({ ti, pi: 0, bid: 100, ask: 40, buy: 1, sell: 2 });
    }
    return construirGrid(n, 1, celulas);
  }

  it('orçamento zero sobe ao piso de uma célula, em vez de suprimir o desenho', () => {
    const janela = janelaIncoerenteSobre(umGrupo);

    const outcome = aggregateForZoomWithOutcome(umGrupo, janela, { maxCells: 0, minCellPx: 0 });

    expect(outcome.cells.count).toBe(1);
    expect(outcome.budgetExhausted).toBe(false);
  });

  it('orçamento negativo sobe ao piso de uma célula', () => {
    const janela = janelaIncoerenteSobre(umGrupo);

    const outcome = aggregateForZoomWithOutcome(umGrupo, janela, { maxCells: -7, minCellPx: 0 });

    expect(outcome.cells.count).toBe(1);
    expect(outcome.budgetExhausted).toBe(false);
  });

  it('o piso é exatamente uma célula: com dois grupos e orçamento zero, o estouro é real', () => {
    // O par da afirmação anterior. Sem ela, um piso de 2 — ou de qualquer valor
    // maior — passaria escondido.
    const janela = janelaIncoerenteSobre(doisGrupos);

    const outcome = aggregateForZoomWithOutcome(doisGrupos, janela, {
      maxCells: 0,
      minCellPx: 0,
    });

    expect(outcome.cells.count).toBe(0);
    expect(outcome.budgetExhausted).toBe(true);
  });

  it('orçamento fracionário cai no padrão de 3.000 e NÃO é arredondado para o valor recebido', () => {
    /**
     * Grid de 3.500 grupos com a janela incoerente, que mantém os fatores em 1: o
     * agrupamento nunca fica mais grosso, então o veredito depende só do teto.
     *
     * - Se `4.000,5` fosse pisado para 4.000, os 3.500 grupos caberiam.
     * - Adotando o padrão de 3.000, eles não cabem e o estouro é permanente.
     *
     * É a diferença entre as duas leituras, e ela existe porque orçamento
     * fracionário indica cálculo errado a montante — adivinhar a intenção
     * esconderia o defeito.
     */
    const grid = gridComGrupos(3_500);
    const janela = janelaIncoerenteSobre(grid);

    const comFracionario = aggregateForZoomWithOutcome(grid, janela, {
      maxCells: 4_000.5,
      minCellPx: 0,
    });
    expect(comFracionario.cells.count).toBe(0);
    expect(comFracionario.budgetExhausted).toBe(true);

    // Controle: o mesmo grid com orçamento inteiro suficiente cabe inteiro. Sem
    // este par, a afirmação acima poderia estar passando por outro motivo.
    const comInteiro = aggregateForZoomWithOutcome(grid, janela, {
      maxCells: 3_500,
      minCellPx: 0,
    });
    expect(comInteiro.cells.count).toBe(3_500);
    expect(comInteiro.budgetExhausted).toBe(false);
  });

  it('orçamento não numérico e orçamento infinito caem no padrão de 3.000', () => {
    const grid = gridComGrupos(3_500);
    const janela = janelaIncoerenteSobre(grid);

    for (const naoInteiro of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = aggregateForZoomWithOutcome(grid, janela, {
        maxCells: naoInteiro,
        minCellPx: 0,
      });
      // Infinito, honrado ao pé da letra, faria os 3.500 grupos caberem.
      expect(outcome.cells.count).toBe(0);
      expect(outcome.budgetExhausted).toBe(true);
    }
  });

  it('o padrão é exatamente 3.000: essa quantidade de grupos cabe, e a seguinte não', () => {
    const janelaDe = (g: BookmapGrid) => janelaIncoerenteSobre(g);
    const naMedida = gridComGrupos(3_000);
    const umAMais = gridComGrupos(3_001);

    const cabe = aggregateForZoomWithOutcome(naMedida, janelaDe(naMedida), {
      maxCells: Number.NaN,
      minCellPx: 0,
    });
    expect(cabe.cells.count).toBe(3_000);
    expect(cabe.budgetExhausted).toBe(false);

    const estoura = aggregateForZoomWithOutcome(umAMais, janelaDe(umAMais), {
      maxCells: Number.NaN,
      minCellPx: 0,
    });
    expect(estoura.cells.count).toBe(0);
    expect(estoura.budgetExhausted).toBe(true);
  });

  it('orçamento acima do teto é restringido a 20.000, não aceito como veio', () => {
    /**
     * O teto é observável só com mais de 20.000 grupos: com 20.000 exatos, um
     * orçamento de 30.000 e um de 20.000 dão o mesmo resultado.
     *
     * - 20.000 grupos com orçamento de 30.000 ⇒ cabe (o teto é 20.000).
     * - 20.001 grupos com o mesmo orçamento ⇒ estoura, o que só acontece se
     *   30.000 tiver sido reduzido a 20.000.
     */
    const noTeto = gridComGrupos(20_000);
    const acimaDoTeto = gridComGrupos(20_001);
    const orcamentoExagerado = { maxCells: 30_000, minCellPx: 0 };

    const cabe = aggregateForZoomWithOutcome(
      noTeto,
      janelaIncoerenteSobre(noTeto),
      orcamentoExagerado,
    );
    expect(cabe.cells.count).toBe(20_000);
    expect(cabe.budgetExhausted).toBe(false);

    const estoura = aggregateForZoomWithOutcome(
      acimaDoTeto,
      janelaIncoerenteSobre(acimaDoTeto),
      orcamentoExagerado,
    );
    expect(estoura.cells.count).toBe(0);
    expect(estoura.budgetExhausted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Normalização da dimensão mínima por eixo — critério 3.8
// ═════════════════════════════════════════════════════════════════════════════

describe('agregação por zoom: normalização da dimensão mínima por eixo', () => {
  /** Grid quadrado de 4 posições por eixo — ceilings folgados para fatores até 4. */
  const grid4 = construirGrid(4, 4, [
    { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
    { ti: 3, pi: 3, bid: 100, ask: 20, buy: 2, sell: 6 },
  ]);

  it('sem override, os padrões por eixo são diferentes: 3 px de largura e 2 px de altura', () => {
    /**
     * ⭐ A afirmação que prova a ASSIMETRIA dos padrões, e ela precisa de uma
     * geometria escolhida com cuidado.
     *
     * 25 px para 10 unidades declaradas dá 2,5 px por unidade em AMBOS os eixos.
     * Com o mesmo número de pixels por unidade nos dois:
     *
     *   largura: ceil(3 / 2,5) = ceil(1,2) = 2   ⇒ agrupa
     *   altura:  ceil(2 / 2,5) = ceil(0,8) = 1   ⇒ não agrupa
     *
     * Se os dois padrões fossem 3 px, o fator de preço também seria 2. Se fossem 2
     * px, o fator de tempo seria 1. Só a combinação 3 e 2 produz este par — e é
     * por isso que a assimetria fica demonstrada, e não apenas afirmada.
     */
    const janela = janelaSobre(grid4, {
      larguraPx: 25,
      alturaPx: 25,
      baldesVisiveis: 10,
      ticksVisiveis: 10,
    });

    const cells = aggregateForZoom(grid4, janela, { maxCells: 3_000, minCellPx: 0 });

    expect(cells.fatorTempo).toBe(2);
    expect(cells.fatorPreco).toBe(1);
  });

  for (const naoUtilizavel of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`override de ${String(naoUtilizavel)} não é utilizável e os padrões por eixo prevalecem`, () => {
      const janela = janelaSobre(grid4, {
        larguraPx: 25,
        alturaPx: 25,
        baldesVisiveis: 10,
        ticksVisiveis: 10,
      });

      const cells = aggregateForZoom(grid4, janela, {
        maxCells: 3_000,
        minCellPx: naoUtilizavel,
      });

      // O mesmo par assimétrico da afirmação anterior: 3 px e 2 px seguem valendo.
      expect(cells.fatorTempo).toBe(2);
      expect(cells.fatorPreco).toBe(1);
    });
  }

  it('override abaixo do piso sobe a 1 px, e vale para os dois eixos', () => {
    /**
     * 3 px para 4 unidades declaradas dá 0,75 px por unidade nos dois eixos.
     *
     *   com o piso de 1 px:  ceil(1   / 0,75) = ceil(1,33) = 2
     *   com 0,5 px honrado:  ceil(0,5 / 0,75) = ceil(0,67) = 1
     *
     * O fator 2 nos dois eixos é o que prova simultaneamente que o piso é 1 px e
     * que o override deliberado se aplica aos dois eixos — se valesse só para a
     * largura, o fator de preço cairia para o padrão de 2 px e daria
     * `ceil(2 / 0,75) = 3`.
     */
    const janela = janelaSobre(grid4, {
      larguraPx: 3,
      alturaPx: 3,
      baldesVisiveis: 4,
      ticksVisiveis: 4,
    });

    const cells = aggregateForZoom(grid4, janela, { maxCells: 3_000, minCellPx: 0.5 });

    expect(cells.fatorTempo).toBe(2);
    expect(cells.fatorPreco).toBe(2);
  });

  it('override acima do teto desce a 64 px, e vale para os dois eixos', () => {
    /**
     * Grid de 12 posições por eixo para que o teto de um grupo por eixo não morda.
     * 120 px para 12 unidades declaradas dá 10 px por unidade nos dois eixos.
     *
     *   com o teto de 64 px:  ceil(64  / 10) = 7
     *   com 100 px honrado:   ceil(100 / 10) = 10
     *
     * Fator 7 nos dois eixos, e não 10.
     */
    const grid12 = construirGrid(12, 12, [
      { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
      { ti: 7, pi: 7, bid: 100, ask: 20, buy: 2, sell: 6 },
    ]);
    const janela = janelaSobre(grid12, {
      larguraPx: 120,
      alturaPx: 120,
      baldesVisiveis: 12,
      ticksVisiveis: 12,
    });

    const cells = aggregateForZoom(grid12, janela, { maxCells: 3_000, minCellPx: 100 });

    expect(cells.fatorTempo).toBe(7);
    expect(cells.fatorPreco).toBe(7);
    // As duas células caem em grupos distintos: índices 0 e 7 com fator 7 dão
    // grupos 0 e 1 em ambos os eixos.
    expect(cells.count).toBe(2);
  });

  it('o fator de um eixo tem teto no comprimento desse eixo: agrupar mais que o eixo inteiro é o mesmo grupo', () => {
    // Eixo de preço com uma posição só. Qualquer dimensão mínima leva ao teto de um
    // grupo por eixo, então o fator fica em 1 — sem isso, um fator maior que o eixo
    // produziria aritmética de índice sem sentido na materialização.
    const umPreco = construirGrid(4, 1, [
      { ti: 0, pi: 0, bid: PAREDE_CT, ask: 10, buy: 1, sell: 5 },
      { ti: 3, pi: 0, bid: 100, ask: 20, buy: 2, sell: 6 },
    ]);
    const janela = janelaSobre(umPreco, {
      larguraPx: 3,
      alturaPx: 3,
      baldesVisiveis: 4,
      ticksVisiveis: 4,
    });

    const cells = aggregateForZoom(umPreco, janela, { maxCells: 3_000, minCellPx: 64 });

    // Largura: ceil(64 / 0,75) = 86, limitado ao comprimento do eixo de tempo (4).
    expect(cells.fatorTempo).toBe(4);
    // Preço: o eixo tem uma posição, então o teto é 1.
    expect(cells.fatorPreco).toBe(1);
    expect(cells.count).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Recorte no viewport com piso de 1 px — critério 3.6
// ═════════════════════════════════════════════════════════════════════════════

describe('recorte em pixels: piso de 1 px, interseção com o viewport e coordenada inteira', () => {
  /**
   * Célula de referência: o primeiro balde da abertura, centrada no preço base.
   *
   * `tsMs / 1000` é inteiro exato porque o instante de abertura tem zero
   * milissegundo, então a chave da tabela de coordenada casa por igualdade.
   */
  const CELULA: AggregatedCell = {
    tsMs: ABERTURA_MS,
    preco: PRECO_BASE,
    bid: PAREDE_CT,
    ask: 480,
    buy: 12,
    sell: 7,
  };

  const T_INI = ABERTURA_MS / 1_000;
  /** Fim do balde com fator unitário: `tIni + 60 s × 1`. */
  const T_FIM = T_INI + BALDE_SEG;

  /**
   * Geometria com fatores unitários. A meia-altura é `5 × 1 / 2 = 2,5`, então as
   * bordas de preço ficam em 176.002,5 e 175.997,5 — ambas exatas em binário,
   * porque são múltiplos de meio.
   */
  const GEOM: CellGeometry = {
    baldeSeg: BALDE_SEG,
    fatorTempo: 1,
    tickSize: PRECO_PASSO,
    fatorPreco: 1,
    widthPx: 800,
    heightPx: 400,
  };
  const PRECO_TOPO = PRECO_BASE + (PRECO_PASSO * 1) / 2;
  const PRECO_BASE_CELULA = PRECO_BASE - (PRECO_PASSO * 1) / 2;

  /** Monta a tabela de coordenada para os quatro pontos que a célula consulta. */
  function coordsPara(
    x1: number | null,
    x2: number | null,
    yTopo: number | null,
    yBase: number | null,
  ): CoordinateFns {
    return coordsFixos(
      new Map<number, number | null>([
        [T_INI, x1],
        [T_FIM, x2],
      ]),
      new Map<number, number | null>([
        [PRECO_TOPO, yTopo],
        [PRECO_BASE_CELULA, yBase],
      ]),
    );
  }

  it('célula sub-pixel recebe largura e altura de 1 px, em vez de desaparecer', () => {
    /**
     * ⭐ O piso existe para a parede FINA — que é justamente a que interessa quando
     * o preço se aproxima dela. Sem ele, ao afastar o zoom a célula ficaria com
     * dimensão zero e não seria desenhada.
     *
     * Horizontal: x de 100,2 a 100,5 dá 0,3 px de largura bruta, elevada a 1.
     *   bordas recortadas 100,2 e 101,2 ⇒ arredondadas 100 e 101 ⇒ largura 1, x 100.
     * Vertical: y de 50,1 a 50,4 dá 0,3 px, elevada a 1.
     *   bordas 50,1 e 51,1 ⇒ arredondadas 50 e 51 ⇒ altura 1, y 50.
     */
    const coords = coordsPara(100.2, 100.5, 50.1, 50.4);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).toEqual({
      x: 100,
      y: 50,
      w: 1,
      h: 1,
      // Cor omitida adota a célula mais fraca: errar para menos subestima a
      // liquidez, em vez de anunciar parede que ninguém mediu.
      bucket: 0,
      side: 'BID',
      aboveScale: false,
    });
  });

  it('as quatro coordenadas saem inteiras, derivadas das bordas arredondadas', () => {
    /**
     * Coordenada fracionária faz o canvas antialiasar a borda, e ~3.000 retângulos
     * antialiasados viram névoa cinza em vez de faixas nítidas.
     *
     * A ordem das operações importa e é o que esta afirmação fixa: **arredondar as
     * bordas e derivar o tamanho delas**, nunca arredondar posição e tamanho
     * separadamente.
     *
     * Horizontal: x de 120,5 a 180,25 ⇒ largura bruta 59,75.
     *   bordas arredondadas 121 e 180 ⇒ largura 59, x 121.
     *   Arredondar posição e tamanho isolados daria 121 e 60, e a soma passaria da
     *   borda direita por 1 px.
     * Vertical: y de 40,5 a 100,25 ⇒ bordas arredondadas 41 e 100 ⇒ altura 59, y 41.
     */
    const coords = coordsPara(120.5, 180.25, 40.5, 100.25);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw).toEqual({ x: 121, y: 41, w: 59, h: 59, bucket: 0, side: 'BID', aboveScale: false });
    expect(Number.isInteger(draw.x)).toBe(true);
    expect(Number.isInteger(draw.y)).toBe(true);
    expect(Number.isInteger(draw.w)).toBe(true);
    expect(Number.isInteger(draw.h)).toBe(true);
  });

  it('retângulo inteiramente à direita do viewport é omitido', () => {
    // Borda esquerda em 900 com viewport de 800 px: nada a desenhar.
    const coords = coordsPara(900, 960, 50, 60);

    expect(cellToPixels(CELULA, coords, GEOM)).toBeNull();
  });

  it('retângulo inteiramente à esquerda do viewport é omitido', () => {
    // De -100 a -40: a borda direita ainda é negativa.
    const coords = coordsPara(-100, -40, 50, 60);

    expect(cellToPixels(CELULA, coords, GEOM)).toBeNull();
  });

  it('retângulo inteiramente abaixo do viewport é omitido', () => {
    // Borda superior em 500 com viewport de 400 px de altura.
    const coords = coordsPara(100, 160, 500, 560);

    expect(cellToPixels(CELULA, coords, GEOM)).toBeNull();
  });

  it('retângulo inteiramente acima do viewport é omitido', () => {
    const coords = coordsPara(100, 160, -200, -140);

    expect(cellToPixels(CELULA, coords, GEOM)).toBeNull();
  });

  it('retângulo que atravessa a borda direita é recortado, sem sair do viewport', () => {
    // De 760 a 900 num viewport de 800 px: a metade de fora é cortada e a de dentro
    // permanece. 800 - 760 = 40 px de largura entregue.
    const coords = coordsPara(760, 900, 50, 110);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.x).toBe(760);
    expect(draw.w).toBe(40);
    expect(draw.x + draw.w).toBeLessThanOrEqual(GEOM.widthPx);
  });

  it('retângulo que atravessa a borda esquerda é recortado a partir de zero', () => {
    // De -30 a 45: a parte negativa é cortada e sobram 45 px a partir da origem.
    const coords = coordsPara(-30, 45, -20, 35);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.x).toBe(0);
    expect(draw.w).toBe(45);
    expect(draw.y).toBe(0);
    expect(draw.h).toBe(35);
  });

  it('célula colada na borda direita é empurrada 1 px para dentro, em vez de ser descartada ou desenhada fora', () => {
    /**
     * ⭐ A borda onde as duas pós-condições do critério 3.6 colidem. Uma célula cuja
     * borda esquerda cai exatamente no limite direito teria, pelo piso de 1 px,
     * `x + w = 801` — um pixel fora de um viewport de 800.
     *
     * Três desfechos eram possíveis: descartar, desenhar 1 px fora, ou empurrar
     * para dentro. O adotado é o terceiro: `x` recua para 799 e o retângulo encosta
     * exatamente no limite. Descartar perderia célula genuinamente visível;
     * desenhar fora violaria o recorte.
     */
    const coords = coordsPara(800, 800.4, 50, 110);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.x).toBe(799);
    expect(draw.w).toBe(1);
    expect(draw.x + draw.w).toBe(GEOM.widthPx);
  });

  it('célula colada na borda inferior é empurrada 1 px para dentro', () => {
    // O espelho vertical: borda superior em 400 num viewport de 400 px de altura.
    const coords = coordsPara(100, 160, 400, 400.4);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.y).toBe(399);
    expect(draw.h).toBe(1);
    expect(draw.y + draw.h).toBe(GEOM.heightPx);
  });

  it('limite fracionário do viewport é pisado para inteiro, deixando o recorte conservador', () => {
    /**
     * A razão de bitmap do dispositivo produz larguras como 799,5. Pisar para
     * inteiro dá o último pixel inteiramente contido, então
     * `x + w <= floor(799,5) = 799 <= 799,5`.
     *
     * De 780,25 a 900,5 com limite 799: borda final recortada a 799, borda inicial
     * arredondada a 780 ⇒ largura 19, x 780. A soma é 799, dentro do limite
     * fracionário.
     */
    const geomFracionaria: CellGeometry = { ...GEOM, widthPx: 799.5 };
    const coords = coordsPara(780.25, 900.5, 50, 110);

    const draw = cellToPixels(CELULA, coords, geomFracionaria);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.x).toBe(780);
    expect(draw.w).toBe(19);
    expect(draw.x + draw.w).toBe(799);
    expect(draw.x + draw.w).toBeLessThanOrEqual(geomFracionaria.widthPx);
  });

  it('viewport que não caiba uma célula de 1 px omite a célula, em vez de entregar dimensão zero', () => {
    // O piso de 1 px e o recorte ao viewport seriam contraditórios aqui. Omitir é a
    // única resposta coerente com as duas pós-condições.
    const coords = coordsPara(0, 0.4, 0, 0.4);

    expect(cellToPixels(CELULA, coords, { ...GEOM, widthPx: 0.5 })).toBeNull();
    expect(cellToPixels(CELULA, coords, { ...GEOM, heightPx: 0 })).toBeNull();
    expect(cellToPixels(CELULA, coords, { ...GEOM, widthPx: -800 })).toBeNull();
  });

  it('o eixo vertical cresce para baixo: preço maior dá coordenada menor, e a altura não fica negativa', () => {
    /**
     * No canvas o eixo vertical cresce para baixo, então o preço do TOPO da célula
     * recebe a coordenada MENOR. A implementação toma mínimo e valor absoluto em
     * vez de assumir ordem — sem isso, a altura sairia negativa e o retângulo não
     * seria desenhado.
     *
     * Topo em 120 e base em 180 ⇒ y 120, altura 60.
     */
    const coords = coordsPara(100, 160, 120, 180);

    const draw = cellToPixels(CELULA, coords, GEOM);

    expect(draw).not.toBeNull();
    if (draw === null) return;

    expect(draw.y).toBe(120);
    expect(draw.h).toBe(60);
    expect(draw.h).toBeGreaterThanOrEqual(1);
  });

  it('a largura do retângulo acompanha o fator de agrupamento no tempo', () => {
    /**
     * Fecha o laço entre a agregação e o recorte: `AggregatedCell.tsMs` é a borda
     * ESQUERDA do grupo, e a largura sai de `baldeSeg × fatorTempo`. Com fator 3, o
     * fim consultado é `tIni + 180 s`, não `tIni + 60 s`.
     *
     * Sem esta afirmação, uma célula agregada por três baldes seria desenhada com a
     * largura de um só e o heatmap mostraria vãos brancos entre grupos vizinhos.
     */
    const geomAgrupada: CellGeometry = { ...GEOM, fatorTempo: 3, fatorPreco: 2 };
    const fimDeTresBaldes = T_INI + BALDE_SEG * 3;
    // Meia-altura com fator 2: 5 × 2 / 2 = 5 pontos para cada lado.
    const topoAgrupado = PRECO_BASE + 5;
    const baseAgrupada = PRECO_BASE - 5;

    const coords = coordsFixos(
      new Map<number, number | null>([
        [T_INI, 200],
        [fimDeTresBaldes, 380],
      ]),
      new Map<number, number | null>([
        [topoAgrupado, 100],
        [baseAgrupada, 140],
      ]),
    );

    const draw = cellToPixels(CELULA, coords, geomAgrupada);

    expect(draw).toEqual({
      x: 200,
      y: 100,
      w: 180,
      h: 40,
      bucket: 0,
      side: 'BID',
      aboveScale: false,
    });
  });
});
