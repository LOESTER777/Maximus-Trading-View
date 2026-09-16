/**
 * `bookmap-desempenho.bancada` — o **executor** da bancada de desempenho. Spec
 * `bookmap-no-mapa-de-decisao`, tarefas 12.1, 12.2 e 12.3. Requisitos 8.10, 9.1
 * a 9.7, 9.9 e 9.10.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO NÃO É COLETADO PELA SUÍTE COMUM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O padrão de coleta de `vitest.config.ts` é
 * `src/**\/*.{test,spec,pbt.test}.{ts,tsx}`, e a terminação `.bancada.ts` não
 * casa com nenhuma das seis expansões. Logo este arquivo é **inalcançável** por
 * `vitest --run` sem configuração própria — não por convenção, por padrão de
 * arquivo. A suíte comum não fica mais lenta por ele existir.
 *
 * Foi preferido a `describe.skip` sob variável de ambiente por dois motivos: um
 * arquivo pulado ainda paga coleta, transformação e montagem de ambiente jsdom a
 * cada execução da suíte comum; e uma condição de ambiente é fácil de ligar por
 * acidente num executor de integração contínua, o que transformaria a suíte
 * comum numa bancada sem ninguém pedir.
 *
 * ── COMO RODAR ────────────────────────────────────────────────────────────
 *
 * ```bash
 * cd /media/rust/UTIL/Projetos/Trading/frontend
 * ./node_modules/.bin/vitest --run --config vitest.bancada.config.ts
 * ```
 *
 * ⚠️ Nunca `npx vitest`: resolve outra versão do cache e não aplica o apelido
 * `@` do projeto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO FAZ — E O QUE FICA PARA A 12.3
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Tarefa 12.1** (primeiro `describe`): provar que o arnês roda de ponta a ponta
 * com o protocolo exatamente como declarado — 100 repetições, descartadas as 10
 * primeiras, percentil 95 das 90 restantes — sobre o conjunto de referência de
 * 25.823 células disponível **sem banco**, e imprimir o ambiente de apuração.
 *
 * **Tarefa 12.2** (segundo `describe`): apurar e relatar os cinco alvos de tempo
 * e de memória, e exercitar a degradação adaptativa até o piso de 500 células.
 *
 * | Alvo | Teto | Requisito |
 * |---|---|---|
 * | `draw()` com o orçamento de células cheio | 8 ms | 9.3 |
 * | `aggregateForZoom` na extensão completa do pregão | 12 ms | 9.4 |
 * | escala de cor sobre 25.823 células | 3 ms | 9.5 |
 * | `decodeColumnar` do payload inteiro | 25 ms | 9.6 |
 * | grid decodificado (eixos + valores) | 614.400 B | 9.7 |
 * | degradação adaptativa até o piso de 500 | — | 9.9, 9.10 |
 *
 * ⚠️ **O requisito 9.3 diz "3.000 células" e 3.000 exatas são inalcançáveis** — não
 * por limitação da bancada, e sim porque a agregação aceita o primeiro
 * agrupamento cuja contagem **cabe** no orçamento, dobrando a dimensão mínima dos
 * dois eixos a cada tentativa; a contagem, então, salta em degraus grossos. A
 * maior carga que cabe em 3.000 sobre este conjunto é **2.975 células**, e o alvo
 * é apurado ali. Ver `VIEWPORT_ORCAMENTO_CHEIO`.
 *
 * ⚠️ **A linha `arnês · escala de cor` do primeiro `describe` não é a apuração do
 * requisito 9.5.** É a verificação de encanamento da 12.1, sai sem teto e vem
 * rotulada `arnês ·`. A apuração do 9.5 é a linha `escala de cor · …` da tabela
 * da 12.2, que declara teto e veredito. Medir duas vezes é o preço de manter a
 * verificação de encanamento independente da apuração — se o arnês quebrar,
 * quebra na 12.1, antes de qualquer alvo.
 *
 * **Tarefa 12.3** (terceiro `describe`): apurar o tamanho do corpo colunar contra
 * o verboso sobre o mesmo conjunto, e conferir o teto de 1,0 MB do requisito
 * 8.10.
 *
 * ⚠️ **O tamanho de corpo apurado aqui é sobre o conjunto SINTÉTICO.** As
 * larguras de dígito são realistas, mas o total em bytes depende da composição
 * exata dos números, então a cifra é aproximação. O relatório da 12.3 imprime o
 * valor sintético **ao lado** dos 2,43 MB / 0,83 MB medidos no pregão real, em
 * linhas separadas e com a procedência de cada um declarada — apresentar o
 * sintético como se fosse o real declararia uma medição que não houve.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ OS TETOS SÃO ORÇAMENTO, E A BANCADA FALHA QUANDO UM ESTOURA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cada alvo é afirmado com asserção contra o teto, e não apenas registrado. Um
 * número que ninguém verifica deixa de ser orçamento e passa a ser diário de
 * bordo: a regressão aparece no relatório e ninguém repara.
 *
 * **A resposta a um estouro é baixar `maxCells`, não otimizar o laço.** 3.000
 * células já é mais informação do que 1.400 px de largura conseguem distinguir,
 * então reduzir o teto de células devolve tempo sem custar leitura. O relatório
 * calcula e imprime o orçamento proposto quando o alvo de desenho estoura —
 * `piso(3.000 × teto ÷ apurado)`, limitado ao piso de 500 —, para que a proposta
 * venha com o número que a sustenta. Afrouxar o protocolo ou o teto para caber
 * inverteria o sentido da bancada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O QUE O TEMPO DE `draw()` MEDIDO AQUI SIGNIFICA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O cronômetro cerca **exclusivamente** a passada de desenho, que é o que os
 * requisitos 9.3 e 9.9 chamam de passada: o mesmo trecho que a camada cronometra
 * internamente para decidir a degradação. `updateAllViews()` vai em `antes`, fora
 * do cronômetro.
 *
 * **Inclui**: o laço de emissão por bucket de cor, as trocas de estilo de
 * preenchimento, as marcas de execução, os contornos de estouro de escala, a
 * hachura de cobertura e o texto de legenda e rodapé.
 *
 * **Exclui, por estarem na reconstrução do plano**: leitura da janela visível,
 * agregação por zoom, cálculo de escala de cor e conversão célula→pixel. Esses
 * três primeiros têm alvo próprio nos requisitos 9.4 e 9.5; a conversão roda uma
 * vez por invalidação, enquanto a passada pode repetir para a mesma invalidação.
 * Para que o custo da passada não seja lido como o custo total de um quadro, o
 * relatório traz também uma linha **informativa** de reconstrução + desenho, sem
 * teto — ela não é alvo de requisito nenhum.
 *
 * **Exclui, por não existir no ambiente**: rasterização, composição e
 * sincronismo de quadro. `jsdom` não tem contexto 2D nem rasterizador, e o dublê
 * conta chamadas em vez de pintar pixel. O valor apurado é o **trabalho da
 * própria camada** — a parte sob controle deste projeto, e onde uma regressão de
 * algoritmo apareceria. **Não é tempo de quadro de navegador**, e o campo
 * `ehNavegadorReal` do ambiente declara isso em toda execução.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mede tempo sobre dado sintético e imprime texto. Nenhuma leitura de banco, de
 * arquivo de dado, de tabela em disco ou de rede; nenhuma escrita em lugar algum;
 * nenhum endereço de rede, identificador de conta, credencial ou estado de
 * posição.
 *
 * Convenções: identificadores em inglês, comentários e saída em pt-BR.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resetBookmapSessionWarnings } from '@robustus/charts-primitives';
import {
  aggregateForZoom,
  aggregateForZoomWithOutcome,
  computeColorScale,
  computeColorScalePair,
  decodeColumnar,
} from '@robustus/charts-core';
import type { AggregationOutcome } from '@robustus/charts-core';
import type { BookmapDepthColunar, BookmapGrid, VisibleWindow } from '@robustus/charts-core';

import {
  BENCH_BALDES,
  BENCH_CELULAS,
  BENCH_PRECOS,
  BENCH_TICK_SIZE,
  celulasVerbosas,
  gridDeReferencia,
  janelaDoMiolo,
  janelaExtensaoCompleta,
  payloadColunar,
  tamanhoDoGridEmBytes,
  type TamanhoDoGrid,
} from './bookmap-bench-referencia.js';

import {
  BANCADA_CONSIDERADAS,
  BANCADA_DESCARTADAS,
  BANCADA_QUANTIL,
  BANCADA_REPETICOES,
  BANCADA_VIEWPORT,
  capturarAmbiente,
  emMiB,
  formatarRelatorio,
  medir,
  tamanhoDoCorpoEmBytes,
  type AmbienteBancada,
  type MedicaoBancada,
  type OrcamentoDeAlvo,
} from './bookmap-bench-protocolo.js';

import {
  montarCamadaDeBancada,
  relogioParado,
  relogioQueForcaDegradacao,
  type CamadaDeBancada,
} from './bookmap-bench-canvas.js';

/** Escreve no relatório da execução. A bancada existe para ser lida. */
function relatar(texto: string): void {
  // eslint-disable-next-line no-console
  console.log(texto);
}

describe('bancada de desempenho · arnês (tarefa 12.1)', () => {
  let ambiente: AmbienteBancada;
  let grid: BookmapGrid;

  beforeAll(() => {
    resetBookmapSessionWarnings();
    ambiente = capturarAmbiente(BANCADA_VIEWPORT);
    grid = gridDeReferencia();

    relatar('');
    relatar('═'.repeat(96));
    relatar('CONJUNTO DE REFERÊNCIA (requisito 9.1) — sintetizado, sem banco');
    relatar('═'.repeat(96));
    relatar(`  células .......... ${grid.ti.length.toLocaleString('pt-BR')}`);
    relatar(`  baldes ........... ${grid.times.length} de ${grid.baldeSeg} s`);
    relatar(`  preços ........... ${grid.prices.length}`);
    relatar(`  contrato ......... ${grid.symbol} · ${grid.fonte} · ${grid.dia}`);
    relatar(`  cobertura ........ ${grid.cobertura?.classe ?? 'não informada'}`);
    relatar('');
    relatar(
      '  ⚠️ Conjunto SINTÉTICO determinístico. A forma medida do pregão real é',
    );
    relatar(
      '     reproduzida por construção; os desvios estão declarados no cabeçalho de',
    );
    relatar('     `bookmap-bench-referencia.ts`.');
  });

  it('roda o protocolo declarado de ponta a ponta e registra o ambiente', () => {
    const medicoes: MedicaoBancada[] = [];

    // Alvo real, e o mais barato dos quatro: se o encanamento do arnês estiver
    // errado, falha aqui em vez de no meio da apuração da 12.2.
    medicoes.push(
      medir({
        nome: 'arnês · escala de cor sobre o conjunto',
        executar: () => computeColorScalePair(grid.bid, grid.ask, grid.bid.length),
      }),
    );

    relatar('');
    relatar(formatarRelatorio(ambiente, medicoes));
    relatar('');
    relatar(
      'Verificação de encanamento — a apuração dos alvos é a tabela da 12.2, ' +
        'abaixo, e o tamanho de corpo é a tabela da 12.3.',
    );
    relatar('');

    const medicao = medicoes[0];
    expect(medicao).toBeDefined();
    if (medicao === undefined) return;

    // O protocolo, conferido no próprio executor: 100 repetições, 10 descartadas,
    // percentil 95 das 90 restantes.
    expect(medicao.repeticoes).toBe(BANCADA_REPETICOES);
    expect(medicao.descartadas).toBe(BANCADA_DESCARTADAS);
    expect(medicao.consideradas).toBe(BANCADA_CONSIDERADAS);
    expect(medicao.quantil).toBe(BANCADA_QUANTIL);
    expect(medicao.protocoloDeclarado).toBe(true);

    // Tempo real, não simulado: o apurado tem de ser um número finito e não
    // negativo. Nenhum teto é afirmado aqui — teto é a 12.2.
    expect(Number.isFinite(medicao.apuradoMs)).toBe(true);
    expect(medicao.apuradoMs).toBeGreaterThanOrEqual(0);
  });

  it('o conjunto de referência tem a forma medida do pregão de 28/08/2026', () => {
    expect(grid.ti.length).toBe(BENCH_CELULAS);
    expect(grid.times.length).toBe(BENCH_BALDES);
    expect(grid.prices.length).toBe(BENCH_PRECOS);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Tarefa 12.2 — apuração dos alvos
// ═════════════════════════════════════════════════════════════════════════════

/** Teto do requisito 9.3, em milissegundos. */
const TETO_DRAW_MS = 8;

/** Teto do requisito 9.4, em milissegundos. */
const TETO_AGREGACAO_MS = 12;

/** Teto do requisito 9.5, em milissegundos. */
const TETO_ESCALA_MS = 3;

/** Teto do requisito 9.6, em milissegundos. */
const TETO_DECODIFICACAO_MS = 25;

/** Teto do requisito 9.7: 600 KB, em bytes. */
const TETO_GRID_BYTES = 614_400;

/** Piso do orçamento de células da degradação adaptativa (requisitos 9.9 e 9.10). */
const PISO_DE_CELULAS = 500;

/**
 * Passadas que a camada mede antes de reavaliar o orçamento.
 *
 * Espelha `DRAW_SAMPLE_WINDOW` de `BookmapPrimitive`. A amostra é zerada a cada
 * redução, então cada degradação exige uma janela cheia **já com o teto novo** —
 * e é isso que torna a descida 3.000 → 1.500 → 750 → 500 previsível em 90
 * passadas, e não uma cascata numa só.
 */
const JANELA_DE_PASSADAS = 30;

/**
 * O orçamento de produção, e é ele que os alvos medem.
 *
 * `BOOKMAP_MAX_CELLS_DEFAULT` e `BOOKMAP_MIN_CELL_PX_DEFAULT` do componente de
 * gráfico valem 3.000 e 3. Repetidos aqui como literal em vez de importados: a
 * bancada não deve depender do módulo de gráfico, que arrasta a árvore de
 * componentes inteira para dentro de uma medição de núcleo.
 */
const ORCAMENTO = { maxCells: 3_000, minCellPx: 3 } as const;

/**
 * Viewport do alvo de desenho com o orçamento cheio (requisito 9.3).
 *
 * ── POR QUE NÃO O VIEWPORT DECLARADO DA BANCADA ───────────────────────────
 *
 * O requisito 9.3 condiciona o alvo a **desenhar 3.000 células**, e no viewport
 * declarado de 1.400 × 620 px a agregação entrega 1.803 — 60% da carga. Apurar
 * ali e apresentar como se a condição estivesse satisfeita declararia folga que
 * a premissa do requisito não tem.
 *
 * ⚠️ **3.000 células exatas são inalcançáveis, e isso é do desenho da agregação,
 * não desta bancada.** O núcleo aceita o primeiro agrupamento cuja contagem
 * **cabe** no orçamento e, a cada tentativa, dobra a dimensão mínima dos **dois**
 * eixos ao mesmo tempo — então a contagem salta em degraus grossos. Varrendo
 * quatro larguras × cinco alturas × quatro dimensões mínimas, a maior contagem
 * que cabe em 3.000 sobre este conjunto é **2.975** (fatores 2 × 5), a 1.920 ×
 * 800 px com a dimensão mínima de produção. É 99,2% do orçamento, e é a carga
 * mais próxima da premissa do 9.3 que a camada consegue produzir.
 *
 * ── E O ORÇAMENTO É O QUE PRENDE, NÃO A DIMENSÃO MÍNIMA ───────────────────
 *
 * Nas duas janelas medidas o número de repetições da agregação é maior que zero,
 * o que só acontece quando a **primeira** tentativa é recusada por estourar o
 * orçamento. Ou seja: as duas apurações são de plano limitado por `maxCells`, que
 * é a condição de que o requisito fala. O relatório imprime esse número.
 */
const VIEWPORT_ORCAMENTO_CHEIO = { larguraPx: 1_920, alturaPx: 800 } as const;

/** Nomes dos alvos. Precisam casar com os do orçamento — e cabem em 38 colunas. */
const ALVO_DRAW_CHEIO = 'draw() · orçamento cheio · 1920×800';
const ALVO_DRAW_PADRAO = 'draw() · viewport da bancada · 1400×620';
const ALVO_PASSADA_CHEIA = 'informativo · reconstrução + desenho';
const ALVO_AGREGACAO = 'aggregateForZoom · extensão completa';
const ALVO_ESCALA = 'escala de cor · 25.823 células';
const ALVO_ESCALA_PAR = 'escala de cor · par (o que a camada usa)';
const ALVO_DECODIFICACAO = 'decodeColumnar · payload inteiro';

/** O renderizador corrente, no tipo que o arnês entrega. */
type RendererDeBancada = ReturnType<CamadaDeBancada['rendererCorrente']>;

/** Uma redução de orçamento observada, com a passada em que aconteceu. */
interface ReducaoObservada {
  readonly passada: number;
  readonly de: number;
  readonly para: number;
}

/** O que a bateria de degradação apurou (requisitos 9.9 e 9.10). */
interface ApuracaoDaDegradacao {
  readonly reducoes: readonly ReducaoObservada[];
  readonly retangulosNoInicio: number;
  readonly retangulosNoPiso: number;
  readonly retangulosDepoisDoPiso: number;
  readonly passadasNaDescida: number;
  readonly passadasNoPiso: number;
  readonly desenhouNoPiso: boolean;
}

/**
 * Uma linha de carga: contagem, fatores de agrupamento, repetições e a janela.
 *
 * As repetições entram porque são a prova de qual limite estava ativo — maior que
 * zero significa que a primeira tentativa foi recusada pelo orçamento.
 */
function descreverCarga(
  desfecho: AggregationOutcome | null,
  janela: VisibleWindow,
): string {
  if (desfecho === null) return 'não apurado';
  const c = desfecho.cells;
  return (
    `${c.count.toLocaleString('pt-BR')} células · agrupamento ${c.fatorTempo} × ${c.fatorPreco}` +
    ` · ${desfecho.repetitions} repetição(ões) · ` +
    `${janela.baldesVisiveis} baldes × ${janela.ticksVisiveis.toLocaleString('pt-BR')} ticks visíveis`
  );
}

/** `bytes` com separador de milhar e o equivalente em KB. */
function bytes(valor: number): string {
  const kb = Math.round((valor / 1_024) * 10) / 10;
  return `${valor.toLocaleString('pt-BR')} B (${kb.toLocaleString('pt-BR')} KB)`;
}

/**
 * Orçamento de células proposto quando o alvo de desenho estoura.
 *
 * Escala linear no número de células — a passada é um laço sobre células, então
 * o tempo é aproximadamente proporcional a elas — e limitado ao piso de 500, que
 * é o mesmo piso da degradação adaptativa. É proposta, não aplicação: quem decide
 * baixar o padrão de produção é o operador, com este número na mão.
 */
function orcamentoProposto(apuradoMs: number, tetoMs: number, atual: number): number {
  if (!Number.isFinite(apuradoMs) || apuradoMs <= 0) return atual;
  const alvo = Math.floor((atual * tetoMs) / apuradoMs);
  return Math.max(PISO_DE_CELULAS, Math.min(atual, alvo));
}

describe('bancada de desempenho · apuração dos alvos (tarefa 12.2)', () => {
  let ambiente: AmbienteBancada;
  let grid: BookmapGrid;
  let janelaMiolo: VisibleWindow;
  let janelaCheia: VisibleWindow;
  let janelaCompleta: VisibleWindow;
  let payload: BookmapDepthColunar;

  /** O que a agregação entrega em cada janela. Sustenta o rótulo de cada alvo. */
  let noMiolo: AggregationOutcome | null = null;
  let noCheio: AggregationOutcome | null = null;
  let naExtensao: AggregationOutcome | null = null;

  const medicoes: MedicaoBancada[] = [];
  const orcamentos: OrcamentoDeAlvo[] = [];

  let tamanhoDoGrid: TamanhoDoGrid | null = null;
  let degradacao: ApuracaoDaDegradacao | null = null;

  beforeAll(() => {
    // Registro de escopo de sessão zerado antes da apuração: o aviso de
    // degradação é emitido uma vez por sessão, e a bateria da degradação depende
    // de poder observá-lo.
    resetBookmapSessionWarnings();

    ambiente = capturarAmbiente(BANCADA_VIEWPORT);
    grid = gridDeReferencia();
    janelaMiolo = janelaDoMiolo(grid, BANCADA_VIEWPORT);
    janelaCheia = janelaDoMiolo(grid, VIEWPORT_ORCAMENTO_CHEIO);
    janelaCompleta = janelaExtensaoCompleta(grid, BANCADA_VIEWPORT);

    // Construído **uma vez**, fora de qualquer cronômetro: montar o payload não é
    // o que o requisito 9.6 mede.
    payload = payloadColunar();

    // Fora do cronômetro: é rótulo do relatório, não alvo. `WithOutcome` porque o
    // número de repetições é o que prova que o orçamento foi o limite ativo.
    noMiolo = aggregateForZoomWithOutcome(grid, janelaMiolo, ORCAMENTO);
    noCheio = aggregateForZoomWithOutcome(grid, janelaCheia, ORCAMENTO);
    naExtensao = aggregateForZoomWithOutcome(grid, janelaCompleta, ORCAMENTO);

    orcamentos.push(
      { nome: ALVO_DRAW_CHEIO, tetoMs: TETO_DRAW_MS, requisito: 'requisito 9.3' },
      {
        nome: ALVO_DRAW_PADRAO,
        tetoMs: TETO_DRAW_MS,
        requisito: 'requisito 9.3 (viewport da bancada)',
      },
      { nome: ALVO_AGREGACAO, tetoMs: TETO_AGREGACAO_MS, requisito: 'requisito 9.4' },
      { nome: ALVO_ESCALA, tetoMs: TETO_ESCALA_MS, requisito: 'requisito 9.5' },
      { nome: ALVO_ESCALA_PAR, tetoMs: TETO_ESCALA_MS, requisito: 'requisito 9.5 (par)' },
      {
        nome: ALVO_DECODIFICACAO,
        tetoMs: TETO_DECODIFICACAO_MS,
        requisito: 'requisito 9.6',
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 9.3 — a passada de desenho
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Apura a passada de desenho numa janela, com o cronômetro **só** no `draw`.
   *
   * Devolve a medição e a camada, para que o chamador confira a contagem de
   * formas emitidas — sem ela, um tempo pequeno pode ser apenas uma passada que
   * não desenhou nada.
   */
  function apurarDesenho(
    nome: string,
    janela: VisibleWindow,
  ): { medicao: MedicaoBancada; camada: CamadaDeBancada } {
    const camada = montarCamadaDeBancada({
      grid,
      janela,
      tickSize: BENCH_TICK_SIZE,
      maxCells: ORCAMENTO.maxCells,
      minCellPx: ORCAMENTO.minCellPx,
      // Relógio parado: a degradação adaptativa não dispara e o orçamento fica o
      // declarado nas 100 repetições. Sem isso o percentil misturaria dois
      // orçamentos diferentes.
      relogio: relogioParado(),
    });

    // Caixa mutável em vez de variável capturada: o valor é escrito num closure e
    // lido em outro, e o compilador não acompanha a ordem entre os dois.
    const corrente: { r: RendererDeBancada } = { r: null };

    const medicao = medir({
      nome,
      antes: () => {
        // Reconstrução do plano — agregação, escala de cor e célula→pixel — FORA
        // do cronômetro. O alvo de 8 ms é da passada de desenho.
        camada.prepararPassada();
        corrente.r = camada.rendererCorrente();
        camada.ctx.zerar();
      },
      executar: () => {
        corrente.r?.draw(camada.alvo);
        // Ao sumidouro: torna o efeito da passada alcançável.
        return camada.ctx.retangulos;
      },
    });

    expect(corrente.r).not.toBeNull();
    return { medicao, camada };
  }

  it('9.3 · a passada de desenho conclui em 8 ms ou menos', () => {
    // ── A carga da premissa do requisito: o orçamento cheio ──
    const cheio = apurarDesenho(ALVO_DRAW_CHEIO, janelaCheia);
    // ── E a mesma medida no viewport declarado da bancada, para comparabilidade
    //    com os outros alvos da tabela ──
    const padrao = apurarDesenho(ALVO_DRAW_PADRAO, janelaMiolo);

    medicoes.push(cheio.medicao, padrao.medicao);

    for (const { camada } of [cheio, padrao]) {
      // A passada precisa ter desenhado, senão o tempo não mediu nada.
      expect(camada.ctx.retangulos).toBeGreaterThan(0);
      // Célula com os dois lados positivos emite dois retângulos (requisito 1.9).
      expect(camada.ctx.retangulos).toBeLessThanOrEqual(2 * ORCAMENTO.maxCells);
      // O par salvar/restaurar da biblioteca de canvas fecha.
      expect(camada.ctx.saves).toBe(camada.ctx.restores);
    }

    // A premissa do 9.3: a carga apurada é o orçamento cheio, a menos do degrau
    // de quantização da agregação. 2.975 de 3.000 é 99,2%.
    expect(noCheio?.cells.count).toBeGreaterThanOrEqual(
      Math.floor(ORCAMENTO.maxCells * 0.99),
    );
    expect(noCheio?.cells.count).toBeLessThanOrEqual(ORCAMENTO.maxCells);

    // E o limite ativo é o orçamento, não a dimensão mínima de célula: repetição
    // maior que zero só acontece quando a primeira tentativa estoura `maxCells`.
    expect(noCheio?.repetitions).toBeGreaterThan(0);
    expect(noCheio?.budgetExhausted).toBe(false);
    expect(noMiolo?.repetitions).toBeGreaterThan(0);
    expect(noMiolo?.budgetExhausted).toBe(false);

    expect(cheio.medicao.protocoloDeclarado).toBe(true);
    expect(padrao.medicao.protocoloDeclarado).toBe(true);

    // O veredito do 9.3 exige as duas cargas dentro do teto.
    expect(cheio.medicao.apuradoMs).toBeLessThanOrEqual(TETO_DRAW_MS);
    expect(padrao.medicao.apuradoMs).toBeLessThanOrEqual(TETO_DRAW_MS);
  });

  it('informativo · reconstrução + desenho, para o custo total ficar visível', () => {
    const camada = montarCamadaDeBancada({
      grid,
      // No orçamento cheio: é o pior caso, e é o que interessa a quem quer saber
      // o custo de um quadro.
      janela: janelaCheia,
      tickSize: BENCH_TICK_SIZE,
      maxCells: ORCAMENTO.maxCells,
      minCellPx: ORCAMENTO.minCellPx,
      relogio: relogioParado(),
    });

    // Sem teto, e de propósito: nenhum requisito orça a soma. A linha existe para
    // que o alvo de 8 ms não seja lido como o custo de um quadro inteiro.
    const medicao = medir({
      nome: ALVO_PASSADA_CHEIA,
      antes: () => {
        camada.ctx.zerar();
      },
      executar: () => camada.desenharUmaPassada(),
    });

    medicoes.push(medicao);

    expect(camada.ctx.retangulos).toBeGreaterThan(0);
    expect(medicao.protocoloDeclarado).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 9.4 — agregação por zoom na extensão completa
  // ───────────────────────────────────────────────────────────────────────────

  it('9.4 · aggregateForZoom na extensão completa conclui em 12 ms ou menos', () => {
    const medicao = medir({
      nome: ALVO_AGREGACAO,
      executar: () => aggregateForZoom(grid, janelaCompleta, ORCAMENTO),
    });

    medicoes.push(medicao);

    // A janela é o pior zoom real do conjunto: 570 baldes e um eixo de preço
    // esticado pelo nível cruzado, o que força agrupamento nos dois eixos.
    expect(janelaCompleta.baldesVisiveis).toBe(BENCH_BALDES);
    expect(janelaCompleta.ticksVisiveis).toBeGreaterThan(4_500);
    expect(naExtensao?.cells.count).toBeGreaterThan(0);
    expect(naExtensao?.cells.count).toBeLessThanOrEqual(ORCAMENTO.maxCells);

    expect(medicao.protocoloDeclarado).toBe(true);
    expect(medicao.apuradoMs).toBeLessThanOrEqual(TETO_AGREGACAO_MS);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 9.5 — escala de cor
  // ───────────────────────────────────────────────────────────────────────────

  it('9.5 · a escala de cor sobre 25.823 células conclui em 3 ms ou menos', () => {
    // `computeColorScale` sobre uma coluna: são exatamente as 25.823 células do
    // conjunto, que é o que o requisito 9.5 nomeia.
    const umaColuna = medir({
      nome: ALVO_ESCALA,
      executar: () => computeColorScale(grid.bid, grid.bid.length),
    });

    // ⚠️ E `computeColorScalePair`, que é o que a camada de fato chama: o
    // requisito 2.9 exige escala compartilhada pelos dois lados, então a amostra
    // percorrida é o dobro. É a variante mais cara, e medi-la é a leitura
    // conservadora do teto — apurar só a coluna isolada declararia folga que a
    // produção não tem.
    const oPar = medir({
      nome: ALVO_ESCALA_PAR,
      executar: () => computeColorScalePair(grid.bid, grid.ask, grid.bid.length),
    });

    medicoes.push(umaColuna, oPar);

    expect(grid.bid.length).toBe(BENCH_CELULAS);
    expect(umaColuna.protocoloDeclarado).toBe(true);
    expect(oPar.protocoloDeclarado).toBe(true);

    // O veredito do 9.5 exige as duas variantes dentro do teto.
    expect(umaColuna.apuradoMs).toBeLessThanOrEqual(TETO_ESCALA_MS);
    expect(oPar.apuradoMs).toBeLessThanOrEqual(TETO_ESCALA_MS);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 9.6 — decodificação do payload colunar
  // ───────────────────────────────────────────────────────────────────────────

  it('9.6 · decodeColumnar do payload inteiro conclui em 25 ms ou menos', () => {
    const medicao = medir({
      nome: ALVO_DECODIFICACAO,
      executar: () => decodeColumnar(payload),
    });

    medicoes.push(medicao);

    // O payload é o conjunto inteiro, e a decodificação tem de suceder — um
    // `null` seria rejeição de invariante, e mediria o caminho de recusa.
    expect(payload.celulas).toBe(BENCH_CELULAS);
    const decodificado = decodeColumnar(payload);
    expect(decodificado).not.toBeNull();
    expect(decodificado?.ti.length).toBe(BENCH_CELULAS);

    expect(medicao.protocoloDeclarado).toBe(true);
    expect(medicao.apuradoMs).toBeLessThanOrEqual(TETO_DECODIFICACAO_MS);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 9.7 — tamanho do grid decodificado
  // ───────────────────────────────────────────────────────────────────────────

  it('9.7 · o grid decodificado cabe em 614.400 bytes de eixos e valores', () => {
    // O requisito fala do grid **decodificado**, então a medida sai da saída de
    // `decodeColumnar`, e não do grid que a referência monta por outra rota.
    const decodificado = decodeColumnar(payload);
    expect(decodificado).not.toBeNull();
    if (decodificado === null) return;

    const medido = tamanhoDoGridEmBytes(decodificado);
    tamanhoDoGrid = medido;

    // Medição sem instantâneo de heap: `byteLength` é o tamanho do buffer, exato
    // e independente de motor.
    expect(medido.eixosMaisValoresBytes).toBeLessThanOrEqual(TETO_GRID_BYTES);

    // A rota da referência tem de dar o mesmo tamanho. Se divergisse, uma das
    // duas estaria descrevendo outro conjunto — e as demais medições usam a da
    // referência.
    const pelaReferencia = tamanhoDoGridEmBytes(grid);
    expect(pelaReferencia.eixosMaisValoresBytes).toBe(medido.eixosMaisValoresBytes);
    expect(pelaReferencia.indicesBytes).toBe(medido.indicesBytes);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisitos 9.9 e 9.10 — degradação adaptativa e o piso de 500
  // ───────────────────────────────────────────────────────────────────────────

  it('9.9 e 9.10 · a degradação desce a 500 células e para lá', () => {
    const mensagens: string[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      mensagens.push(String(args[0] ?? ''));
    });

    try {
      const camada = montarCamadaDeBancada({
        grid,
        janela: janelaMiolo,
        tickSize: BENCH_TICK_SIZE,
        maxCells: ORCAMENTO.maxCells,
        minCellPx: ORCAMENTO.minCellPx,
        // Faz cada passada **parecer** durar 20 ms, acima do alvo de 8 ms do
        // requisito 9.3. Determinístico: não depende de a máquina ser lenta.
        relogio: relogioQueForcaDegradacao(20),
      });

      const reducoes: ReducaoObservada[] = [];
      let jaLidas = 0;
      // Contador de passadas de verdade: o índice reportado tem de ser a passada
      // em que a redução aconteceu, e não uma etiqueta aproximada.
      let passadas = 0;

      /**
       * Uma passada, colhendo a redução se houver.
       *
       * O aviso de degradação é de escopo de sessão e sai **uma vez** por
       * execução. Zerar o registro antes de cada passada é o que permite ler a
       * descida inteira — de outro modo só a primeira redução seria observável, e
       * a apuração de "chega a 500" viraria inferência.
       */
      const passar = (): boolean => {
        resetBookmapSessionWarnings();
        passadas += 1;
        const desenhou = camada.desenharUmaPassada();

        for (let i = jaLidas; i < mensagens.length; i += 1) {
          const texto = mensagens[i] ?? '';
          const achado = /caiu de (\d+) para (\d+)/.exec(texto);
          if (achado === null) continue;
          reducoes.push({
            passada: passadas,
            de: Number(achado[1] ?? 0),
            para: Number(achado[2] ?? 0),
          });
        }
        jaLidas = mensagens.length;
        return desenhou;
      };

      // Estado inicial: o orçamento cheio.
      camada.ctx.zerar();
      expect(passar()).toBe(true);
      const retangulosNoInicio = camada.ctx.retangulos;

      // 30 passadas por redução, com a amostra zerada a cada uma: 3.000 → 1.500 →
      // 750 → 500. São 90 passadas até o piso, contando a primeira.
      const passadasAteOPiso = 3 * JANELA_DE_PASSADAS;
      while (passadas < passadasAteOPiso) passar();

      // ⚠️ A redução acontece **no fim** da passada, em `reportPass`: a passada 90
      // ainda desenha com o teto anterior e só então cai para o piso. Medir o piso
      // nela contaria as células do teto de 750 — foi o que a primeira versão desta
      // bateria fez, e o relatório denunciou a contradição entre os dois números.
      // O piso se mede na passada SEGUINTE.
      camada.ctx.zerar();
      expect(passar()).toBe(true);
      const retangulosNoPiso = camada.ctx.retangulos;

      // Requisito 9.10: no piso não há nova redução, e a camada segue desenhando
      // e habilitada.
      const reducoesAteOPiso = reducoes.length;
      const passadasNoPiso = 2 * JANELA_DE_PASSADAS;
      const alvoDePassadas = passadas + passadasNoPiso - 1;
      while (passadas < alvoDePassadas) passar();

      camada.ctx.zerar();
      const desenhouNoPiso = passar();
      const retangulosDepoisDoPiso = camada.ctx.retangulos;

      degradacao = {
        reducoes,
        retangulosNoInicio,
        retangulosNoPiso,
        retangulosDepoisDoPiso,
        passadasNaDescida: passadasAteOPiso,
        passadasNoPiso,
        desenhouNoPiso,
      };

      // ── Requisito 9.9 ──
      // A descida é pela metade, três vezes, e termina no piso.
      expect(reducoes.length).toBe(3);
      expect(reducoes.map((r) => `${r.de}→${r.para}`)).toEqual([
        '3000→1500',
        '1500→750',
        '750→500',
      ]);

      // Toda a janela visível segue representada: o desenho continua, com
      // agrupamento mais grosso em vez de recorte.
      expect(retangulosNoPiso).toBeGreaterThan(0);
      expect(retangulosNoPiso).toBeLessThan(retangulosNoInicio);
      expect(retangulosNoPiso).toBeLessThanOrEqual(2 * PISO_DE_CELULAS);

      // E o piso é estável: a mesma contagem na primeira passada do piso e depois
      // de outras 60. Se divergissem, uma das duas estaria medindo outro teto.
      expect(retangulosDepoisDoPiso).toBe(retangulosNoPiso);

      // ── Requisito 9.10 ──
      // Nenhuma redução nova depois do piso, e a camada continua desenhando.
      expect(reducoes.length).toBe(reducoesAteOPiso);
      expect(desenhouNoPiso).toBe(true);
      expect(retangulosDepoisDoPiso).toBeGreaterThan(0);
      expect(retangulosDepoisDoPiso).toBeLessThanOrEqual(2 * PISO_DE_CELULAS);
    } finally {
      info.mockRestore();
      resetBookmapSessionWarnings();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O relatório
  // ───────────────────────────────────────────────────────────────────────────

  afterAll(() => {
    relatar('');
    relatar(formatarRelatorio(ambiente, medicoes, orcamentos));

    relatar('');
    relatar('CÉLULAS SOB MEDIÇÃO (o que sustenta o rótulo de cada alvo)');
    relatar(
      `  orçamento cheio .. ${descreverCarga(noCheio, janelaCheia)}` +
        `  [${VIEWPORT_ORCAMENTO_CHEIO.larguraPx} × ${VIEWPORT_ORCAMENTO_CHEIO.alturaPx} px]`,
    );
    relatar(
      `  viewport bancada . ${descreverCarga(noMiolo, janelaMiolo)}` +
        `  [${BANCADA_VIEWPORT.larguraPx} × ${BANCADA_VIEWPORT.alturaPx} px]`,
    );
    relatar(`  extensão completa  ${descreverCarga(naExtensao, janelaCompleta)}`);
    relatar('');
    relatar(
      `  ⚠️ 3.000 células EXATAS são inalcançáveis: a agregação aceita o primeiro`,
    );
    relatar(
      '     agrupamento que CABE no orçamento e dobra a dimensão mínima dos dois eixos',
    );
    relatar(
      `     a cada tentativa, então a contagem salta em degraus. ${(
        noCheio?.cells.count ?? 0
      ).toLocaleString('pt-BR')} é a maior`,
    );
    relatar(
      `     contagem que cabe em ${ORCAMENTO.maxCells.toLocaleString('pt-BR')} neste conjunto ` +
        `(${(((noCheio?.cells.count ?? 0) / ORCAMENTO.maxCells) * 100).toFixed(1)}% do orçamento).`,
    );
    relatar(
      '     "repetições > 0" prova que o limite ativo é o orçamento, não a dimensão',
    );
    relatar('     mínima de célula — que é a condição de que o requisito 9.3 fala.');

    if (tamanhoDoGrid !== null) {
      const t = tamanhoDoGrid;
      const dentro = t.eixosMaisValoresBytes <= TETO_GRID_BYTES;
      relatar('');
      relatar('MEMÓRIA DO GRID DECODIFICADO (requisito 9.7) — sem instantâneo de heap');
      relatar(`  eixos ............ ${bytes(t.eixosBytes)}   (times + prices)`);
      relatar(`  valores .......... ${bytes(t.valoresBytes)}   (bid + ask + buy + sell)`);
      relatar(`  ─────────────────`);
      relatar(`  APURADO .......... ${bytes(t.eixosMaisValoresBytes)}`);
      relatar(`  teto ............. ${bytes(TETO_GRID_BYTES)}`);
      relatar(
        `  situação ......... ${dentro ? 'DENTRO' : 'ESTOUROU'} · folga de ` +
          `${bytes(Math.max(0, TETO_GRID_BYTES - t.eixosMaisValoresBytes))}`,
      );
      relatar('');
      relatar(
        `  índices .......... ${bytes(t.indicesBytes)}   (ti + pi) — FORA da conta do 9.7,`,
      );
      relatar(
        '                     que nomeia eixos e valores. Somados, os arrays do grid',
      );
      relatar(`                     ocupam ${bytes(t.totalBytes)}.`);
    }

    if (degradacao !== null) {
      const d = degradacao;
      relatar('');
      relatar('DEGRADAÇÃO ADAPTATIVA (requisitos 9.9 e 9.10) — relógio forçado a 20 ms/passada');
      relatar(
        `  descida .......... ${d.reducoes
          .map((r) => `${r.de.toLocaleString('pt-BR')}→${r.para.toLocaleString('pt-BR')}`)
          .join(' · ')}`,
      );
      relatar(
        `  na passada ....... ${d.reducoes.map((r) => r.passada).join(' · ')} ` +
          `de ${d.passadasNaDescida} até o piso ` +
          `(uma janela de ${JANELA_DE_PASSADAS} passadas medidas por redução)`,
      );
      relatar(
        `  retângulos ....... ${d.retangulosNoInicio.toLocaleString('pt-BR')} no orçamento ` +
          `cheio → ${d.retangulosNoPiso.toLocaleString('pt-BR')} no piso ` +
          `(teto observável 2 × ${PISO_DE_CELULAS} = ${2 * PISO_DE_CELULAS})`,
      );
      relatar(
        `  no piso .......... ${d.passadasNoPiso} passadas adicionais, ` +
          `${d.reducoes.length === 3 ? 'nenhuma' : 'ALGUMA'} nova redução; a camada ` +
          `${d.desenhouNoPiso ? 'seguiu desenhando' : 'PAROU de desenhar'} ` +
          `(${d.retangulosDepoisDoPiso.toLocaleString('pt-BR')} retângulos)`,
      );
      relatar(
        '  ⚠️ O aviso de degradação é de escopo de sessão e sai uma vez por execução;',
      );
      relatar(
        '     o registro foi zerado antes de cada passada para que a descida inteira',
      );
      relatar('     fosse observada, e não inferida da primeira redução.');
    }

    // ── Veredito, alvo por alvo ──
    relatar('');
    relatar('VEREDITO');
    for (const o of orcamentos) {
      const m = medicoes.find((x) => x.nome === o.nome);
      if (m === undefined) {
        relatar(`  ${o.nome.padEnd(40)} não apurado`);
        continue;
      }
      const dentro = Number.isFinite(m.apuradoMs) && m.apuradoMs <= o.tetoMs;
      relatar(
        `  ${o.nome.padEnd(40)} ${m.apuradoMs.toFixed(3)} ms / ${o.tetoMs} ms ` +
          `— ${dentro ? 'DENTRO' : 'ESTOUROU'} (${o.requisito})`,
      );
      if (!dentro) {
        relatar(
          `     ⚠️ Estouro. A resposta é BAIXAR o orçamento de células, não otimizar o ` +
            `laço: proposta ${orcamentoProposto(
              m.apuradoMs,
              o.tetoMs,
              ORCAMENTO.maxCells,
            ).toLocaleString('pt-BR')} células ` +
            `(hoje ${ORCAMENTO.maxCells.toLocaleString('pt-BR')}, piso ${PISO_DE_CELULAS}).`,
        );
      }
    }
    if (tamanhoDoGrid !== null) {
      const dentro = tamanhoDoGrid.eixosMaisValoresBytes <= TETO_GRID_BYTES;
      relatar(
        `  ${'grid decodificado · eixos + valores'.padEnd(40)} ` +
          `${tamanhoDoGrid.eixosMaisValoresBytes.toLocaleString('pt-BR')} B / ` +
          `${TETO_GRID_BYTES.toLocaleString('pt-BR')} B — ` +
          `${dentro ? 'DENTRO' : 'ESTOUROU'} (requisito 9.7)`,
      );
    }

    const informativa = medicoes.find((m) => m.nome === ALVO_PASSADA_CHEIA);
    if (informativa !== undefined) {
      relatar('');
      relatar(
        `  ${'informativo · reconstrução + desenho'.padEnd(40)} ` +
          `${informativa.apuradoMs.toFixed(3)} ms — SEM TETO (nenhum requisito orça a soma)`,
      );
      relatar(
        '     A reconstrução domina o custo: ela agrega, calcula a escala de cor e',
      );
      relatar(
        '     converte célula→pixel. A linha está aqui para que a passada de desenho não',
      );
      relatar('     seja lida como o custo de um quadro inteiro.');
      // ⚠️ O texto é derivado do número, não afirmado: a soma varia entre execuções
      // (a reconstrução aloca, e a coleta de lixo entra no percentil), e uma frase
      // fixa dizendo "cabe" ficaria errada na execução em que não couber.
      const somaCabe = informativa.apuradoMs <= TETO_DRAW_MS;
      relatar(
        `     Nesta execução a soma ${somaCabe ? 'CABE' : 'NÃO cabe'} no teto de ` +
          `${TETO_DRAW_MS} ms do 9.3 (${informativa.apuradoMs.toFixed(3)} ms, ` +
          `máximo observado ${informativa.maxMs.toFixed(3)} ms). Isso não é veredito` +
          `${somaCabe ? '' : ' de estouro'}:`,
      );
      relatar('     nenhum requisito orça a soma, e o alvo do 9.3 é só a passada.');
    }

    relatar('');
    relatar(
      '⚠️ Sem navegador real, o tempo de passada de desenho é o trabalho da camada:',
    );
    relatar(
      '   inclui o laço de emissão, as trocas de estilo, as marcas de execução, os',
    );
    relatar(
      '   contornos, a hachura e o texto; exclui agregação, escala de cor e conversão',
    );
    relatar(
      '   célula→pixel (que rodam na reconstrução, fora do cronômetro) e exclui',
    );
    relatar(
      '   rasterização, composição e sincronismo de quadro (que não existem em jsdom).',
    );
    relatar('   NÃO é tempo de quadro de navegador.');
    relatar('');
    relatar('Tamanho do corpo colunar contra o verboso: tabela da 12.3, abaixo.');
    relatar('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Tarefa 12.3 — tamanho do corpo da resposta
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Teto do requisito 8.10 — **1,0 MB**, lido como 1.048.576 bytes.
 *
 * ⚠️ O prefixo binário não é escolha desta bancada: o requisito 9.7 fixa
 * "600 KB (614.400 bytes)", que é 600 × 1.024, então é essa a convenção que a
 * própria spec pina. Para que o veredito não dependa da leitura, o relatório
 * confere **também** a leitura decimal de 1.000.000 bytes, que é a mais severa
 * das duas — e diz qual das duas passou.
 */
const TETO_CORPO_BYTES = 1_048_576;

/** A leitura decimal do mesmo teto: mais severa, conferida em paralelo. */
const TETO_CORPO_DECIMAL_BYTES = 1_000_000;

/**
 * Corpo verboso medido no **pregão real**, em MB, como registrado no glossário
 * dos requisitos e em `bookmap-types`.
 *
 * ⚠️ **Referência histórica, não medição desta execução.** Veio do payload do
 * endpoint sobre o pregão real; aqui é reproduzida como número para comparação.
 * O relatório mantém as duas procedências em linhas separadas justamente para
 * que uma não seja lida como a outra.
 */
const REAL_VERBOSO_MB = 2.43;

/** Corpo colunar medido no pregão real, em MB. Mesma procedência histórica. */
const REAL_COLUNAR_MB = 0.83;

/** O que a apuração do tamanho de corpo produziu. */
interface ApuracaoDeCorpo {
  /** Corpo colunar inteiro, envelope e eixos incluídos. */
  readonly colunarBytes: number;
  /** Corpo verboso: o vetor de células, que é o que o contrato atual transporta. */
  readonly verbosoBytes: number;
  /** Parcela do colunar gasta nos dois eixos deduplicados. */
  readonly eixosBytes: number;
  /** Parcela do colunar gasta nas seis colunas paralelas. */
  readonly colunasBytes: number;
  /** Células declaradas no corpo colunar. */
  readonly celulasColunar: number;
  /** Células do corpo verboso. Tem de casar com a de cima. */
  readonly celulasVerboso: number;
}

/** Número com casas fixas e separador decimal pt-BR. */
function numeroPtBr(valor: number, casas: number): string {
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** `bytes` com separador de milhar e o equivalente em MB (mebibytes). */
function corpo(valor: number): string {
  return `${numeroPtBr(emMiB(valor), 3)} MB (${valor.toLocaleString('pt-BR')} B)`;
}

/** Razão colunar/verboso em pontos percentuais, com uma casa. */
function razao(colunar: number, verboso: number): string {
  if (verboso <= 0) return 'não apurável';
  return `${numeroPtBr((colunar / verboso) * 100, 1)}%`;
}

/** Folga contra um teto, em pontos percentuais do teto. */
function folga(valor: number, teto: number): string {
  if (teto <= 0) return '—';
  return `${numeroPtBr(Math.max(0, 1 - valor / teto) * 100, 1)}%`;
}

describe('bancada de desempenho · tamanho do corpo (tarefa 12.3)', () => {
  let apuracao: ApuracaoDeCorpo | null = null;

  beforeAll(() => {
    const colunar = payloadColunar();
    const verboso = celulasVerbosas();

    apuracao = {
      // O corpo colunar é medido **com** o envelope e os eixos, e o verboso só
      // com as células. A assimetria é deliberada e favorece o verboso: se o
      // colunar cabe carregando o próprio envelope, cabe de qualquer modo. Os
      // campos de metadado são poucas dezenas de bytes e comuns aos dois
      // formatos, então incluí-los nos dois não moveria a comparação.
      colunarBytes: tamanhoDoCorpoEmBytes(colunar),
      verbosoBytes: tamanhoDoCorpoEmBytes(verboso),
      eixosBytes: tamanhoDoCorpoEmBytes(colunar.eixos),
      colunasBytes: tamanhoDoCorpoEmBytes(colunar.colunas),
      celulasColunar: colunar.celulas,
      celulasVerboso: verboso.length,
    };
  });

  it('8.10 · o corpo colunar das 25.823 células cabe em 1,0 MB', () => {
    expect(apuracao).not.toBeNull();
    const a = apuracao;
    if (a === null) return;

    // As duas formas descrevem o MESMO conjunto — é a premissa de comparar
    // tamanho numa e tempo na outra. Sem isso, a razão falaria de dois dados.
    expect(a.celulasColunar).toBe(BENCH_CELULAS);
    expect(a.celulasVerboso).toBe(BENCH_CELULAS);

    // Serialização de fato aconteceu: um zero aqui seria `JSON.stringify`
    // devolvendo `undefined`, e o veredito passaria por vacuidade.
    expect(a.colunarBytes).toBeGreaterThan(0);
    expect(a.verbosoBytes).toBeGreaterThan(0);

    // ── O veredito do requisito 8.10 ──
    expect(a.colunarBytes).toBeLessThanOrEqual(TETO_CORPO_BYTES);

    // E a premissa do requisito: é o formato verboso que não cabe no teto. Se
    // cabesse, o colunar não estaria resolvendo problema algum.
    expect(a.verbosoBytes).toBeGreaterThan(TETO_CORPO_BYTES);
    expect(a.colunarBytes).toBeLessThan(a.verbosoBytes);

    // A economia vem de não repetir as seis chaves por célula, então o peso do
    // colunar tem de estar nas colunas, não nos eixos deduplicados.
    expect(a.colunasBytes).toBeGreaterThan(a.eixosBytes);

    // ⚠️ E a referência HISTÓRICA declarada também cabe no teto — é ela, e não o
    // sintético, que o requisito 8.10 cobra. A asserção é sobre literais de
    // propósito: se alguém revisar a medição do pregão real para um valor acima
    // do teto, a bancada acusa em vez de continuar imprimindo "DENTRO".
    expect(REAL_COLUNAR_MB * 1_024 * 1_024).toBeLessThanOrEqual(TETO_CORPO_BYTES);
    expect(REAL_COLUNAR_MB).toBeLessThan(REAL_VERBOSO_MB);
  });

  afterAll(() => {
    if (apuracao === null) return;
    const a = apuracao;

    const realVerbosoBytes = Math.round(REAL_VERBOSO_MB * 1_024 * 1_024);
    const realColunarBytes = Math.round(REAL_COLUNAR_MB * 1_024 * 1_024);
    const dentro = a.colunarBytes <= TETO_CORPO_BYTES;
    const dentroDoDecimal = a.colunarBytes <= TETO_CORPO_DECIMAL_BYTES;

    relatar('');
    relatar('═'.repeat(96));
    relatar('TAMANHO DO CORPO DA RESPOSTA (requisito 8.10, tarefa 12.3)');
    relatar('═'.repeat(96));
    relatar('');
    relatar('  ⚠️ DUAS PROCEDÊNCIAS, e elas NÃO se substituem:');
    relatar(
      '     · "pregão real" é medição do payload do endpoint sobre o pregão real,',
    );
    relatar(
      '       registrada ANTES desta bancada e reproduzida aqui como referência',
    );
    relatar('       histórica. Esta execução não a mediu.');
    relatar(
      '     · "conjunto sintético" é o que ESTA execução mediu, sobre as 25.823',
    );
    relatar(
      '       células construídas em código. As larguras de dígito são realistas, mas',
    );
    relatar(
      '       o total em bytes depende da composição exata dos números — é',
    );
    relatar('       APROXIMAÇÃO do real, não substituto dele.');
    relatar('');
    relatar(
      `  ${''.padEnd(30)}${'verboso'.padStart(24)}${'colunar'.padStart(24)}${'razão'.padStart(10)}`,
    );
    relatar(`  ${'─'.repeat(86)}`);
    relatar(
      `  ${'pregão real (histórico)'.padEnd(30)}` +
        `${corpo(realVerbosoBytes).padStart(24)}` +
        `${corpo(realColunarBytes).padStart(24)}` +
        `${razao(realColunarBytes, realVerbosoBytes).padStart(10)}`,
    );
    relatar(
      `  ${'conjunto sintético (esta)'.padEnd(30)}` +
        `${corpo(a.verbosoBytes).padStart(24)}` +
        `${corpo(a.colunarBytes).padStart(24)}` +
        `${razao(a.colunarBytes, a.verbosoBytes).padStart(10)}`,
    );
    relatar(
      `  ${'teto do requisito 8.10'.padEnd(30)}` +
        `${'—'.padStart(24)}` +
        `${corpo(TETO_CORPO_BYTES).padStart(24)}` +
        `${'—'.padStart(10)}`,
    );
    relatar('');
    relatar('  ONDE ESTÃO OS BYTES DO COLUNAR');
    relatar(
      `    eixos deduplicados . ${bytes(a.eixosBytes)}   ` +
        `(t com ${BENCH_BALDES} instantes + p com ${BENCH_PRECOS} preços)`,
    );
    relatar(
      `    seis colunas ....... ${bytes(a.colunasBytes)}   ` +
        `(ti · pi · fila de compra · fila de venda · exec de compra · exec de venda)`,
    );
    relatar(
      `    envelope ........... ${bytes(
        Math.max(0, a.colunarBytes - a.eixosBytes - a.colunasBytes),
      )}   (contrato, dia, balde, nível, contagem, cobertura)`,
    );
    relatar(
      `    por célula ......... ${numeroPtBr(a.colunarBytes / a.celulasColunar, 1)} B ` +
        `no colunar contra ${numeroPtBr(a.verbosoBytes / a.celulasVerboso, 1)} B no verboso`,
    );
    relatar('');
    relatar('  VEREDITO');
    relatar(
      `    ${'corpo colunar · leitura binária'.padEnd(40)} ` +
        `${a.colunarBytes.toLocaleString('pt-BR')} B / ` +
        `${TETO_CORPO_BYTES.toLocaleString('pt-BR')} B — ` +
        `${dentro ? 'DENTRO' : 'ESTOUROU'} (requisito 8.10)`,
    );
    relatar(
      `    ${'corpo colunar · leitura decimal'.padEnd(40)} ` +
        `${a.colunarBytes.toLocaleString('pt-BR')} B / ` +
        `${TETO_CORPO_DECIMAL_BYTES.toLocaleString('pt-BR')} B — ` +
        `${dentroDoDecimal ? 'DENTRO' : 'ESTOUROU'} (a leitura mais severa)`,
    );
    relatar(
      `    ${'corpo verboso · contra o mesmo teto'.padEnd(40)} ` +
        `${a.verbosoBytes.toLocaleString('pt-BR')} B / ` +
        `${TETO_CORPO_BYTES.toLocaleString('pt-BR')} B — ` +
        `${a.verbosoBytes <= TETO_CORPO_BYTES ? 'DENTRO' : 'ESTOUROU'} ` +
        `(é a premissa do 8.10: o verboso não cabe)`,
    );
    relatar(
      `    ${'corpo colunar REAL · contra o teto'.padEnd(40)} ` +
        `${realColunarBytes.toLocaleString('pt-BR')} B / ` +
        `${TETO_CORPO_BYTES.toLocaleString('pt-BR')} B — ` +
        `${realColunarBytes <= TETO_CORPO_BYTES ? 'DENTRO' : 'ESTOUROU'} ` +
        `(a medição histórica, que é a que o 8.10 cobra)`,
    );

    relatar('');
    // ⚠️ Tudo aqui é derivado dos números impressos acima, não afirmado: se a
    // síntese derivar, o texto acompanha em vez de mentir.
    relatar('  FIDELIDADE DA SÍNTESE — e onde ela é OTIMISTA');
    relatar(
      `    verboso .......... sintético em ${razao(a.verbosoBytes, realVerbosoBytes)} do real ` +
        `— este lado a síntese reproduz bem`,
    );
    relatar(
      `    colunar .......... sintético em ${razao(a.colunarBytes, realColunarBytes)} do real ` +
        `— ⚠️ a síntese é OTIMISTA aqui`,
    );
    relatar(
      `    folga contra o teto  sintética ${folga(a.colunarBytes, TETO_CORPO_BYTES)} ` +
        `contra ${folga(realColunarBytes, TETO_CORPO_BYTES)} da medição real`,
    );
    relatar('');
    relatar(
      '    ⚠️ Logo a folga sintética SUPERESTIMA a real, e o veredito do 8.10 deve ser',
    );
    relatar(
      '       lido pelo número REAL — que também cabe, e é o que a linha "corpo colunar',
    );
    relatar(
      '       REAL" acima afirma. O sintético corrobora a direção; não substitui a medida.',
    );
    relatar(
      '    Hipótese para a diferença, NÃO medida: neste conjunto as duas colunas de',
    );
    relatar(
      '       execução são majoritariamente zero (execução só até 12:31 BRT, e em parte',
    );
    relatar(
      '       das células), e um zero custa dois bytes na coluna. Confirmar exigiria o',
    );
    relatar('       payload real, que a 12.1 optou por não versionar.');
    relatar('');
    relatar(
      '  ⚠️ O corpo colunar é medido COM envelope e eixos; o verboso, só com as',
    );
    relatar(
      '     células. A assimetria favorece o verboso de propósito: se o colunar cabe',
    );
    relatar('     carregando o próprio envelope, cabe de qualquer modo.');
    relatar('');
  });
});
