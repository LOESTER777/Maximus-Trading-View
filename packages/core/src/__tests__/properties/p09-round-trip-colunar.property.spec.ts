/**
 * Property 9 — Round-trip do formato colunar. Spec `bookmap-no-mapa-de-decisao`,
 * tarefa 2.3.
 *
 * ```
 * ∀ células verbosas C (sem duplicata de (tsMs, preco)):
 *     toVerbose(decodeColumnar(toColumnar(C))) ≡ C \ {células integralmente zeradas}
 * ```
 *
 * **Validates: Requirements 8.3**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA PROPRIEDADE PROTEGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O formato colunar existe por medição: 2,43 MB no verboso contra 0,83 MB no
 * colunar para as 25.823 células de um pregão, 66% menor. A economia vem de não
 * repetir seis chaves JSON 25.823 vezes — os valores são os mesmos.
 *
 * O preço dessa economia é que as coordenadas ficam **indiretas**: a célula `k`
 * tem seu instante em `eixos.t[colunas.ti[k]]` e seu preço em
 * `eixos.p[colunas.pi[k]]`. Um índice deslocado em um não produz célula faltando
 * — produz célula **no lugar errado**, com a magnitude de outro preço. O operador
 * leria como suporte uma parede que está em outro nível, e nada acusaria.
 *
 * Esta propriedade é o que garante que a compressão não perde nem inventa
 * célula: o que sai do decodificador é exatamente o que entrou no codificador,
 * menos as células que o contrato manda omitir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A EXCLUSÃO É AFIRMADA, NÃO TOLERADA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `\ {células integralmente zeradas}` do enunciado não é folga concedida à
 * implementação: é **regra do contrato**. O critério 8.4 manda omitir da resposta
 * colunar toda célula cujos quatro valores sejam zero, e restringir essa omissão
 * ao colunar — o verboso continua devolvendo tudo, inclusive as zeradas, porque é
 * o contrato que o consumidor externo já usa.
 *
 * Por isso a cláusula 2 abaixo **exige** a ausência de cada célula zerada, em vez
 * de aceitar tanto a presença quanto a ausência. Um enunciado que só verificasse
 * `⊆` passaria com um codificador que não omitisse nada, e a economia de 66%
 * sumiria sem que teste algum reclamasse.
 *
 * A contrapartida está na cláusula 3: se a ausência significa zero, então nenhum
 * par ausente pode esconder valor diferente de zero. É a segunda metade do
 * critério 8.3 — "SHALL atribuir valor zero a todo par ausente da resposta" — e
 * sem ela a omissão poderia engolir liquidez de verdade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O CODIFICADOR DAQUI É DE REFERÊNCIA, E O CONTRATO CRUZADO É DE OUTRA TAREFA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O codificador colunar de produção vive no **backend**, e o frontend não importa
 * da árvore do backend — convenção do projeto, a mesma que faz os tipos
 * compartilhados serem declarados à mão nos dois lados. Logo o `toColumnar` deste
 * arquivo é um **codificador de referência local**, escrito para espelhar o
 * contrato: eixos deduplicados e ordenados, índices apontando neles, omissão da
 * célula toda-zero, e colunas na ordem de entrada.
 *
 * Consequência a declarar sem rodeio: **esta propriedade testa o decodificador
 * contra um codificador de referência, não contra o codificador real.** Ela não
 * pegaria uma divergência entre as duas pontas — renomear uma coluna num lado e
 * não no outro deixaria o heatmap vazio sem erro nenhum, porque nenhuma das duas
 * pontas participa do teste da outra.
 *
 * Essa fresta é fechada pela **tarefa 2.4**, que atravessa o decodificador real
 * com a fixture versionada `__tests__/fixtures/colunar-backend.json` — saída
 * genuína do codificador do backend, gerada na tarefa 1.6. As duas coisas são
 * complementares e nenhuma substitui a outra: a fixture prova o acordo entre as
 * pontas num caso concreto, esta propriedade prova a álgebra do round-trip em 500
 * conjuntos por cláusula.
 *
 * Um detalhe do codificador real fica deliberadamente fora daqui: ele descarta
 * célula com instante ou preço não finito e sanea quantidade não finita para
 * zero. Os geradores abaixo produzem exclusivamente instante, preço e quantidade
 * finitos, então esses ramos são inalcançáveis por construção — reproduzi-los
 * seria código morto sujeito a divergir. Eles são cobertos pela suíte do próprio
 * núcleo do backend (tarefa 1.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PRECISÃO — POR QUE A QUANTIDADE GERADA É INTEIRA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A exatidão prometida pelo decodificador tem escopo definido, e o gerador
 * respeita esse escopo em vez de cobrar promessa que ninguém fez:
 *
 * - **Eixos**: `Float64Array`. Instante e preço voltam **bit a bit** idênticos ao
 *   payload, e a cláusula 4 verifica isso com `Object.is`. Precisa ser 64 bits
 *   porque epoch ms (~1,79 × 10¹²) não caberia na mantissa de 24 bits de um float
 *   de 32 bits — arredondaria o instante para múltiplos de ~131 s e as células do
 *   mesmo balde colidiriam.
 * - **Valores**: `Float32Array`, por orçamento de memória. Quantidade de
 *   contratos é **inteira** e exata até 2²⁴ = 16.777.216, muito acima do máximo
 *   real medido (36.232 no nível cruzado; 2.442 na banda do miolo).
 *
 * ⚠️ Valor **fracionário** arbitrário não pode ser exato em 32 bits: `0,1` volta
 * como `0,100000001490116…`. Gerar fração e exigir igualdade estrita cobraria uma
 * garantia que o tipo não dá, e o teste falharia por um defeito que não existe.
 * Daí `arbQuantidade` produzir só inteiros — o que também é o que o dado real é.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de render
 * e a biblioteca de teste. O núcleo, por sua vez, alcança apenas os próprios
 * irmãos da pasta e um formatador de horário. Logo o fechamento transitivo deste
 * arquivo não tem caminho até camada de roteamento de conexão, feed de cotação,
 * envio de ordem, gestão de posição ou módulo de conector de terminal, e não
 * carrega endereço de rede, credencial nem identificador de conta.
 *
 * Todo insumo é sintetizado pelos geradores: nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato. Nada aqui emite
 * evento de decisão, envia ordem, escreve em tabela ou altera chave de
 * configuração de trading.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência. Mesma
 * disciplina dos arquivos irmãos.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { decodeColumnar } from '@robustus/charts-core';
import type {
  BookmapDepthColunar,
  BookmapGrid,
  CelulaHeatmapVerbosa,
  FonteBookmap,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * 26/08/2026 09:00 BRT — abertura do dia da fixture de contrato cruzado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte, e **nenhuma** aritmética de fuso acontece aqui: o
 * instante é epoch ms padrão de ponta a ponta. Este projeto já pagou por somar
 * deslocamento de ±3 h à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 26, 12, 0, 0);

/** O único tamanho de balde materializado hoje. */
const BALDE_SEG = 60;
const BALDE_MS = BALDE_SEG * 1_000;

/** Preço inicial e passo de tick, na banda do miolo do pregão de referência. */
const PRECO_BASE = 176_900;
const TICK_PTS = 5;

/**
 * Extensão dos eixos sorteáveis: 12 baldes × 12 preços = 144 pares possíveis,
 * folga confortável para os até 24 pares distintos que o conjunto pode ter.
 */
const MAX_BALDE_IDX = 11;
const MAX_PRECO_IDX = 11;
const MAX_CELULAS = 24;

/** Multiplicador da chave de unicidade do par. Maior que `MAX_PRECO_IDX`. */
const CHAVE_MULT = 100;

const SYMBOL = 'WINV26';
const FONTE: FonteBookmap = 'MT5_L2';
const DIA = '2026-08-26';

/** Maior inteiro exato em vetor de 32 bits — o teto da promessa de precisão. */
const MAX_INTEIRO_EXATO_32 = 2 ** 24;

// ═════════════════════════════════════════════════════════════════════════════
// Utilitários
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Leitura indexada que **falha alto** em vez de devolver `undefined`.
 *
 * O projeto compila com verificação de índice, então toda leitura de vetor é
 * `number | undefined`. O idioma de produção é `?? valorPadrão`, que é o certo
 * lá — mas num teste um padrão silencioso converteria "índice fora do vetor",
 * que é exatamente a falha que esta propriedade caça, numa comparação de números
 * que poderia até passar. Aqui a leitura inválida tem de explodir.
 *
 * `ArrayLike<number>` aceita tanto vetor tipado quanto lista do payload, o que
 * mantém um único utilitário para os dois lados do round-trip.
 */
function emIndice(vetor: ArrayLike<number>, i: number): number {
  const valor = vetor[i];
  if (valor === undefined) {
    throw new Error(`índice ${i} fora de vetor de comprimento ${vetor.length}`);
  }
  return valor;
}

/** As quatro grandezas de uma célula, sem as coordenadas. */
type Quadrupla = Pick<
  CelulaHeatmapVerbosa,
  'filaBid' | 'filaAsk' | 'execCompra' | 'execVenda'
>;

const QUADRUPLA_ZERADA: Quadrupla = {
  filaBid: 0,
  filaAsk: 0,
  execCompra: 0,
  execVenda: 0,
};

/** A célula que o contrato manda omitir do colunar (critério 8.4). */
function ehIntegralmenteZerada(celula: Quadrupla): boolean {
  return (
    celula.filaBid === 0 &&
    celula.filaAsk === 0 &&
    celula.execCompra === 0 &&
    celula.execVenda === 0
  );
}

/**
 * Chave canônica do par `(instante, preço)` — a identidade da célula.
 *
 * Instante e preço são inteiros exatos nos geradores, então a forma textual é
 * injetiva: dois pares distintos nunca produzem a mesma chave, e o mesmo par
 * sempre produz a mesma.
 */
function chaveDoPar(celula: { readonly tsMs: number; readonly preco: number }): string {
  return `${celula.tsMs}|${celula.preco}`;
}

/**
 * Indexa células por par, descartando a ordem.
 *
 * É o que permite comparar dois conjuntos com `toEqual` sem que a ordem das
 * colunas interfira — e a ordem **precisa** ser irrelevante, porque o
 * codificador preserva a ordem de entrada e o enunciado fala de conjuntos.
 */
function indexarPorPar(
  celulas: readonly CelulaHeatmapVerbosa[],
): Record<string, Quadrupla> {
  const porPar: Record<string, Quadrupla> = {};
  for (const celula of celulas) {
    porPar[chaveDoPar(celula)] = {
      filaBid: celula.filaBid,
      filaAsk: celula.filaAsk,
      execCompra: celula.execCompra,
      execVenda: celula.execVenda,
    };
  }
  return porPar;
}

// ═════════════════════════════════════════════════════════════════════════════
// `toColumnar` — codificador de REFERÊNCIA (ver o aviso no topo do arquivo)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Células verbosas → payload colunar completo, espelhando o contrato.
 *
 * **Pós-condições** (as mesmas que o codificador de produção declara)
 * - `eixos.t` e `eixos.p` estritamente crescentes e sem repetição.
 * - `∀k: 0 ≤ colunas.ti[k] < eixos.t.length` e `0 ≤ colunas.pi[k] < eixos.p.length`.
 * - As seis colunas com comprimento igual entre si, e `celulas` igual a esse
 *   comprimento.
 * - Célula com os quatro valores em zero é **omitida** (critério 8.4).
 * - A entrada não é mutada; as colunas preservam a ordem de entrada.
 *
 * **Pré-condição** — sem repetição do par `(tsMs, preco)`, que é a hipótese do
 * enunciado e a garantia que a chave primária da tabela de origem dá. A função
 * **não** deduplica pares repetidos, igual ao codificador real.
 *
 * O `Set` seguido de ordenação numérica é o que produz o eixo estritamente
 * crescente e deduplicado numa única expressão. E o eixo sai das células
 * **emitidas**, não das candidatas: um preço que só existia em célula toda-zero
 * desaparece do eixo, o que é a razão de a omissão acontecer antes.
 */
function toColumnar(celulas: readonly CelulaHeatmapVerbosa[]): BookmapDepthColunar {
  const instantes: number[] = [];
  const precos: number[] = [];
  const b: number[] = [];
  const a: number[] = [];
  const c: number[] = [];
  const v: number[] = [];

  for (const celula of celulas) {
    if (ehIntegralmenteZerada(celula)) continue;

    instantes.push(celula.tsMs);
    precos.push(celula.preco);
    b.push(celula.filaBid);
    a.push(celula.filaAsk);
    c.push(celula.execCompra);
    v.push(celula.execVenda);
  }

  const eixoT = Array.from(new Set(instantes)).sort((x, y) => x - y);
  const eixoP = Array.from(new Set(precos)).sort((x, y) => x - y);

  const posicaoT = new Map<number, number>();
  eixoT.forEach((valor, i) => posicaoT.set(valor, i));
  const posicaoP = new Map<number, number>();
  eixoP.forEach((valor, i) => posicaoP.set(valor, i));

  const ti = instantes.map((valor) => posicaoDe(posicaoT, valor, 'tempo'));
  const pi = precos.map((valor) => posicaoDe(posicaoP, valor, 'preço'));

  return {
    formato: 'colunar',
    symbol: SYMBOL,
    fonte: FONTE,
    de: DIA,
    baldeSeg: BALDE_SEG,
    nivel: 'PROFUNDIDADE',
    celulas: ti.length,
    eixos: { t: eixoT, p: eixoP },
    colunas: { ti, pi, b, a, c, v },
    // Sempre nula aqui, e de propósito: o decodificador repassa a cobertura
    // verbatim, sem lê-la, então ela não participa do round-trip das células.
    // Classificar cobertura é território da Property 12, que a exercita inclusive
    // ausente, malformada e com classe desconhecida.
    cobertura: null,
  };
}

/**
 * Posição de um valor no eixo. A presença é garantida por construção — o eixo
 * foi montado a partir destes mesmos valores —, então a ausência é defeito do
 * codificador de referência e tem de aparecer como falha, não como índice zero.
 */
function posicaoDe(
  eixo: ReadonlyMap<number, number>,
  valor: number,
  qual: string,
): number {
  const posicao = eixo.get(valor);
  if (posicao === undefined) {
    throw new Error(`valor ${valor} ausente do eixo de ${qual}`);
  }
  return posicao;
}

// ═════════════════════════════════════════════════════════════════════════════
// `toVerbose` — o outro lado do round-trip
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Grid decodificado → células verbosas, resolvendo a indireção dos eixos.
 *
 * É aqui que a compressão é desfeita: `grid.ti[k]` e `grid.pi[k]` são posições, e
 * o instante e o preço reais saem de `grid.times` e `grid.prices`. Se o
 * decodificador deslocasse um índice, é esta função que revelaria — a célula
 * viria com a coordenada de outra.
 */
function toVerbose(grid: BookmapGrid): CelulaHeatmapVerbosa[] {
  const celulas: CelulaHeatmapVerbosa[] = [];
  for (let k = 0; k < grid.ti.length; k += 1) {
    celulas.push({
      tsMs: emIndice(grid.times, emIndice(grid.ti, k)),
      preco: emIndice(grid.prices, emIndice(grid.pi, k)),
      filaBid: emIndice(grid.bid, k),
      filaAsk: emIndice(grid.ask, k),
      execCompra: emIndice(grid.buy, k),
      execVenda: emIndice(grid.sell, k),
    });
  }
  return celulas;
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade em contratos: **inteira**, e por isso exata em vetor de 32 bits.
 *
 * As faixas vêm da medição do pregão de referência — p50 481, p90 714, p99 1.131,
 * máximo 2.442 na banda do miolo — mais o outlier real de 36.232 do nível
 * cruzado e o teto da representação exata, que é onde a promessa de precisão
 * termina.
 */
const arbQuantidade = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 1_500 }), weight: 6 },
  { arbitrary: fc.integer({ min: 1_501, max: 2_442 }), weight: 2 },
  { arbitrary: fc.constantFrom(1, 36_232, MAX_INTEIRO_EXATO_32), weight: 1 },
);

/**
 * Quádrupla com **ao menos um** valor diferente de zero — a célula que o
 * codificador emite.
 *
 * A máscara sorteia quais das quatro grandezas estão presentes e o filtro
 * descarta a máscara toda-falsa (1 caso em 16). Assim aparecem célula só de fila
 * de compra, só de fila de venda, fila com execução e todas as quatro juntas —
 * combinações que o dado real produz, porque a agregação por balde toma o pico da
 * fila e a soma da execução, e num balde de 60 s os dois lados podem coexistir no
 * mesmo preço.
 */
const arbQuadruplaNaoZerada: fc.Arbitrary<Quadrupla> = fc
  .tuple(
    fc
      .tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean())
      .filter(([temBid, temAsk, temCompra, temVenda]) =>
        temBid || temAsk || temCompra || temVenda,
      ),
    arbQuantidade,
    arbQuantidade,
    arbQuantidade,
    arbQuantidade,
  )
  .map(
    ([
      [temBid, temAsk, temCompra, temVenda],
      qBid,
      qAsk,
      qCompra,
      qVenda,
    ]): Quadrupla => ({
      filaBid: temBid ? qBid : 0,
      filaAsk: temAsk ? qAsk : 0,
      execCompra: temCompra ? qCompra : 0,
      execVenda: temVenda ? qVenda : 0,
    }),
  );

/** Quádrupla que pode ser a toda-zero — a que o codificador omite. */
const arbQuadruplaTalvezZerada: fc.Arbitrary<Quadrupla> = fc.oneof(
  { arbitrary: fc.constant(QUADRUPLA_ZERADA), weight: 4 },
  { arbitrary: arbQuadruplaNaoZerada, weight: 6 },
);

/** Célula antes de virar coordenada: índices de balde e de preço, mais valores. */
interface CelulaBruta {
  readonly bi: number;
  readonly pi: number;
  readonly q: Quadrupla;
}

/**
 * Conjunto de células verbosas **sem duplicata do par** `(tsMs, preco)` — a
 * hipótese do enunciado, garantida por construção e não por filtro.
 *
 * A unicidade é imposta sobre a chave do par de índices, então o par nunca se
 * repete por mais valores que sejam sorteados. É a formulação direta da
 * pré-condição: em vez de gerar livremente e descartar o que repete, o gerador é
 * incapaz de repetir.
 *
 * ⚠️ `size: 'medium'` é explícito de propósito. Com o tamanho padrão da
 * biblioteca a aferição mostrou média de 4,75 células por conjunto e **nenhum**
 * conjunto com 16 ou mais — eixos curtos demais para que um índice deslocado
 * tivesse onde se manifestar. Com `medium` a média vai a 10,7 e 31% dos conjuntos
 * passam de 16 células. Fixar aqui também desacopla a cobertura da configuração
 * global da biblioteca, que pode mudar sem que ninguém relacione à queda de
 * cobertura deste arquivo.
 *
 * `minLength: 0` é deliberado: o conjunto vazio é instância legítima do ∀ e
 * exercita o grid sem célula alguma, que precisa decodificar sem erro em vez de
 * ser recusado.
 */
function arbConjunto(
  arbQuadrupla: fc.Arbitrary<Quadrupla>,
): fc.Arbitrary<CelulaHeatmapVerbosa[]> {
  return fc
    .uniqueArray(
      fc.record({
        bi: fc.integer({ min: 0, max: MAX_BALDE_IDX }),
        pi: fc.integer({ min: 0, max: MAX_PRECO_IDX }),
        q: arbQuadrupla,
      }),
      {
        selector: (bruta: CelulaBruta) => bruta.bi * CHAVE_MULT + bruta.pi,
        minLength: 0,
        maxLength: MAX_CELULAS,
        size: 'medium',
      },
    )
    .map((brutas) =>
      brutas.map(
        (bruta): CelulaHeatmapVerbosa => ({
          tsMs: ABERTURA_MS + bruta.bi * BALDE_MS,
          preco: PRECO_BASE + bruta.pi * TICK_PTS,
          ...bruta.q,
        }),
      ),
    );
}

/** Conjunto em que **nada** é omitido: toda célula tem valor. */
const arbConjuntoSemZeradas = arbConjunto(arbQuadruplaNaoZerada);

/** Conjunto em que a omissão é provável. */
const arbConjuntoComZeradasProvaveis = arbConjunto(arbQuadruplaTalvezZerada);

/**
 * O gerador dos invariantes gerais: os dois regimes na mesma amostra.
 *
 * ⚠️ A metade sem zeradas **não** é conforto. Sem ela, quase todo conjunto teria
 * alguma célula omitida e o caso "nada a excluir" — em que o round-trip tem de
 * ser igualdade pura, sem subtração — quase não seria exercitado.
 *
 * Aferido com `fc.statistics` nesta semente: **53,0%** dos conjuntos têm célula a
 * omitir e **47,0%** não têm. Os dois caminhos ficam medidos em vez de um deles
 * passar por sorte, e as cláusulas abaixo **verificam** esse equilíbrio em tempo
 * de execução em vez de confiar nesta anotação (ver `MIN_RUNS_POR_REGIME`).
 */
const arbConjuntoQualquer = fc.oneof(
  { arbitrary: arbConjuntoSemZeradas, weight: 4 },
  { arbitrary: arbConjuntoComZeradasProvaveis, weight: 6 },
);

/**
 * Conjunto com **ao menos uma** célula a omitir.
 *
 * A cláusula que afirma a exclusão precisa de exclusão para afirmar: sem esta
 * restrição ela passaria sobre conjuntos sem nada a excluir, que é a forma mais
 * silenciosa de um teste não testar. Por construção 100% dos conjuntos aqui têm
 * célula omitida; aferido, a quantidade se espalha de 1 a 24 por conjunto.
 */
const arbConjuntoComZeradaGarantida = arbConjuntoComZeradasProvaveis.filter(
  (celulas) => celulas.some(ehIntegralmenteZerada),
);

/**
 * Piso de execuções por regime, abaixo do qual a cláusula é considerada vácua.
 *
 * ⚠️ Existe porque este projeto já foi mordido por isso: numa propriedade irmã, o
 * gerador produzia o caso interessante em **0,92%** das execuções e os
 * invariantes passavam quase sem executar o corpo do laço — teste verde que não
 * testava nada. Medir uma vez e anotar no comentário não protege, porque o
 * comentário não falha quando o gerador muda.
 *
 * 10% de 500 é folgado perto do que se mede hoje (53%, 47% e 29,6% nos três
 * regimes acompanhados) e ainda assim reprovaria o caso de 0,92%, que daria ~5
 * execuções. A semente é fixa, então o número é determinístico; um piso relativo
 * sobrevive a variação de distribuição da biblioteca melhor que um valor exato.
 */
const MIN_RUNS_POR_REGIME = Math.floor(NUM_RUNS * 0.1);

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 9: round-trip do formato colunar', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 1 — o enunciado
  // ───────────────────────────────────────────────────────────────────────────

  it('o conjunto decodificado é exatamente o de entrada menos as células integralmente zeradas', () => {
    // Os dois regimes que o enunciado distingue: com subtração e sem subtração.
    let comOmissao = 0;
    let semOmissao = 0;

    fc.assert(
      fc.property(arbConjuntoQualquer, (entrada) => {
        // A pré-condição do enunciado é verificada, não presumida: um gerador que
        // repetisse o par tornaria a comparação de conjuntos ambígua, e a falha
        // apareceria como divergência de valor num lugar que não a causou.
        expect(Object.keys(indexarPorPar(entrada))).toHaveLength(entrada.length);

        const grid = decodeColumnar(toColumnar(entrada));

        // Antes de qualquer comparação: um `null` faria as igualdades abaixo
        // recaírem sobre o vazio e a propriedade valeria por vacuidade.
        expect(grid).not.toBeNull();
        if (grid === null) return;

        const esperado = entrada.filter((celula) => !ehIntegralmenteZerada(celula));
        const obtido = toVerbose(grid);

        if (esperado.length === entrada.length) semOmissao += 1;
        else comOmissao += 1;

        expect(obtido).toHaveLength(esperado.length);
        expect(indexarPorPar(obtido)).toEqual(indexarPorPar(esperado));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    // O guarda de vacuidade: igualdade pura e igualdade com subtração precisam
    // ambas ter sido exercitadas de fato, não só estar previstas no gerador.
    expect(semOmissao).toBeGreaterThanOrEqual(MIN_RUNS_POR_REGIME);
    expect(comOmissao).toBeGreaterThanOrEqual(MIN_RUNS_POR_REGIME);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 2 — a exclusão, afirmada
  // ───────────────────────────────────────────────────────────────────────────

  it('toda célula integralmente zerada está ausente do grid, e nada além delas é omitido', () => {
    fc.assert(
      fc.property(arbConjuntoComZeradaGarantida, (entrada) => {
        const grid = decodeColumnar(toColumnar(entrada));
        expect(grid).not.toBeNull();
        if (grid === null) return;

        const zeradas = entrada.filter(ehIntegralmenteZerada);

        // O gerador garante, mas afirmar aqui é o que impede a cláusula de virar
        // trivial em silêncio se o gerador for afrouxado no futuro.
        expect(zeradas.length).toBeGreaterThan(0);

        const presentes = new Set(toVerbose(grid).map(chaveDoPar));
        for (const zerada of zeradas) {
          expect(presentes.has(chaveDoPar(zerada))).toBe(false);
        }

        // A omissão é exatamente a das zeradas — nem uma célula a mais.
        expect(grid.ti.length).toBe(entrada.length - zeradas.length);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 3 — ausência significa zero
  // ───────────────────────────────────────────────────────────────────────────

  it('nenhum par ausente do grid esconde valor diferente de zero — ausência significa zero', () => {
    /**
     * Execuções em que a ausência foi **observável dentro dos eixos**: a célula
     * omitida teve seu instante e seu preço preservados por outras células, então
     * o par existe no produto cartesiano e o consumidor pode consultá-lo.
     *
     * É o único caso em que a cláusula tem o que conferir. Par cujo instante ou
     * preço saiu do eixo junto com a célula não é consultável e nada prova.
     */
    let comAusenciaObservavel = 0;

    fc.assert(
      fc.property(arbConjuntoQualquer, (entrada) => {
        const grid = decodeColumnar(toColumnar(entrada));
        expect(grid).not.toBeNull();
        if (grid === null) return;

        const naOrigem = indexarPorPar(entrada);
        const presentes = new Set(toVerbose(grid).map(chaveDoPar));
        let observaveisNesteConjunto = 0;

        // O produto cartesiano dos eixos é o universo de pares que o consumidor
        // pode consultar. Para cada um que o grid não traz, o valor de origem tem
        // de ser zero — senão a omissão teria engolido liquidez de verdade.
        for (let i = 0; i < grid.times.length; i += 1) {
          for (let j = 0; j < grid.prices.length; j += 1) {
            const chave = chaveDoPar({
              tsMs: emIndice(grid.times, i),
              preco: emIndice(grid.prices, j),
            });
            if (presentes.has(chave)) continue;

            const valores = naOrigem[chave];
            // Par que nunca existiu na entrada também vale zero, e não há o que
            // conferir contra.
            if (valores === undefined) continue;

            observaveisNesteConjunto += 1;
            expect(valores).toEqual(QUADRUPLA_ZERADA);
          }
        }

        if (observaveisNesteConjunto > 0) comAusenciaObservavel += 1;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    // Sem este piso a cláusula passaria com o laço interno nunca entrando no
    // `expect` — verde sem ter conferido ausência alguma. Aferido em 29,6% das
    // execuções nesta semente.
    expect(comAusenciaObservavel).toBeGreaterThanOrEqual(MIN_RUNS_POR_REGIME);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 4 — a exatidão prometida
  // ───────────────────────────────────────────────────────────────────────────

  it('instante e preço de cada célula voltam bit a bit idênticos ao payload, com os quatro valores exatos', () => {
    fc.assert(
      fc.property(arbConjuntoQualquer, (entrada) => {
        const payload = toColumnar(entrada);
        const grid = decodeColumnar(payload);
        expect(grid).not.toBeNull();
        if (grid === null) return;

        const naOrigem = indexarPorPar(entrada);

        for (let k = 0; k < grid.ti.length; k += 1) {
          const tsEsperado = emIndice(payload.eixos.t, emIndice(payload.colunas.ti, k));
          const precoEsperado = emIndice(payload.eixos.p, emIndice(payload.colunas.pi, k));
          const tsObtido = emIndice(grid.times, emIndice(grid.ti, k));
          const precoObtido = emIndice(grid.prices, emIndice(grid.pi, k));

          // `Object.is` em vez de `===` para que diferença de sinal de zero não
          // passe: aqui a promessa é de identidade, não de igualdade numérica.
          expect(Object.is(tsObtido, tsEsperado)).toBe(true);
          expect(Object.is(precoObtido, precoEsperado)).toBe(true);

          // A célula chegou com as coordenadas da célula de origem certa, e com
          // os quatro valores exatos — quantidade inteira não perde nada no
          // vetor de 32 bits.
          const valores = naOrigem[chaveDoPar({ tsMs: tsObtido, preco: precoObtido })];
          expect(valores).toBeDefined();
          expect({
            filaBid: emIndice(grid.bid, k),
            filaAsk: emIndice(grid.ask, k),
            execCompra: emIndice(grid.buy, k),
            execVenda: emIndice(grid.sell, k),
          }).toEqual(valores);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 5 — não inventa
  // ───────────────────────────────────────────────────────────────────────────

  it('não inventa célula nem posição de eixo: tudo que sai veio da entrada', () => {
    fc.assert(
      fc.property(arbConjuntoQualquer, (entrada) => {
        const payload = toColumnar(entrada);
        const grid = decodeColumnar(payload);
        expect(grid).not.toBeNull();
        if (grid === null) return;

        const daEntrada = new Set(entrada.map(chaveDoPar));
        const decodificadas = toVerbose(grid);

        expect(decodificadas.length).toBeLessThanOrEqual(entrada.length);
        expect(payload.celulas).toBe(decodificadas.length);

        for (const celula of decodificadas) {
          expect(daEntrada.has(chaveDoPar(celula))).toBe(true);
        }

        // Nem os eixos inventam: toda posição de eixo é usada por ao menos uma
        // célula. É o que impede o preço que existia só em célula toda-zero de
        // sobreviver como posição órfã — e posição órfã no eixo desloca todos os
        // índices seguintes.
        expect(new Set(decodificadas.map((celula) => celula.tsMs)).size).toBe(
          grid.times.length,
        );
        expect(new Set(decodificadas.map((celula) => celula.preco)).size).toBe(
          grid.prices.length,
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 6 — o round-trip é estável
  // ───────────────────────────────────────────────────────────────────────────

  it('decodificar não muta o payload e é determinístico — o round-trip é repetível', () => {
    fc.assert(
      fc.property(arbConjuntoQualquer, (entrada) => {
        const payload = toColumnar(entrada);
        const copiaAntes: unknown = JSON.parse(JSON.stringify(payload));

        const primeiro = decodeColumnar(payload);
        const segundo = decodeColumnar(payload);

        // Sem isto, um decodificador que consumisse o payload passaria na
        // cláusula 1 e falharia na segunda leitura — e o hook decodifica de novo
        // a cada reconsulta do dia corrente.
        expect(payload).toEqual(copiaAntes);

        expect(primeiro).not.toBeNull();
        expect(segundo).not.toBeNull();
        if (primeiro === null || segundo === null) return;

        expect(toVerbose(segundo)).toEqual(toVerbose(primeiro));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
