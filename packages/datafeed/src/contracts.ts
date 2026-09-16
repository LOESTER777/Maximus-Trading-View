/**
 * contracts — o contrato de fonte de dados da biblioteca.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE GOVERNA ESTE ARQUIVO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Nada aqui sabe de onde o dado vem.** Sem URL, sem `fetch`, sem nome de
 * corretora, sem caminho de endpoint, sem WebSocket, sem cabecalho de
 * autenticacao. Este arquivo descreve o QUE a biblioteca precisa; COMO obter e
 * problema de um adaptador, e o adaptador e escrito por quem tem o backend.
 *
 * O teste para saber se algo pertence aqui: se o simbolo cita um protocolo, uma
 * rota ou um fornecedor, ele nao pertence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CAPACIDADES SAO OPCIONAIS, E ISSO E O PONTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma fonte que so tem candles e uma fonte VALIDA. A maioria e. Profundidade de
 * livro historica e raridade — o proprio provedor MBO que a origem integrou
 * (Plug n' Trade) mantem o livro **so em memoria**, sem nenhum caminho para
 * banco, o que significa que bookmap sobre ele existe ao vivo ou gravado a
 * partir de agora, nunca retroativo.
 *
 * Por isso o `Datafeed` e uma composicao de capacidades opcionais em vez de uma
 * interface grande que toda fonte tem de implementar por inteiro. Quem consome
 * pergunta `if (feed.depth)` antes de oferecer bookmap na interface, em vez de
 * descobrir em runtime que o metodo lanca.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FALHA E VALOR DE RETORNO, NAO EXCECAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Toda operacao devolve um resultado discriminado. Nao ha `throw` no contrato.
 *
 * O motivo e concreto: estas chamadas alimentam camada de desenho, e ali excecao
 * nao tratada derruba o grafico inteiro. Alem disso, "nao ha dado" e resposta
 * legitima e frequente (dia sem pregao, ativo sem livro, plano do provedor sem
 * profundidade) — modelar isso como excecao transforma o caminho normal em
 * caminho de erro.
 *
 * A causa e TIPADA. `'INDISPONIVEL'` e `'DECODIFICACAO'` levam a mensagens
 * diferentes para o operador: a primeira e "tente outro dia", a segunda e "o
 * backend mudou o formato e alguem precisa saber".
 */

import type { BookmapGrid, FonteBookmap } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Resultado
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Por que uma consulta nao entregou dado.
 *
 * Uniao fechada de proposito: cada causa corresponde a uma acao diferente de
 * quem le a tela. Acrescentar causa e mudanca de contrato, e deve ser.
 */
export type FailureCause =
  /** A requisicao foi cancelada (troca de ativo, desmontagem, novo pedido). */
  | 'CANCELADA'
  /** Excedeu o limite de espera. */
  | 'TEMPO_ESGOTADO'
  /** Transporte falhou (rede, DNS, conexao recusada). */
  | 'TRANSPORTE'
  /** A fonte respondeu, mas negou (autenticacao, autorizacao, plano). */
  | 'NEGADA'
  /** A fonte respondeu que nao tem esse dado. Resposta legitima, nao erro. */
  | 'INDISPONIVEL'
  /**
   * A fonte respondeu com algo que nao passou na validacao.
   *
   * ⚠️ Distinta de `INDISPONIVEL` de proposito: esta significa **contrato
   * quebrado**, e alguem precisa ser avisado. Colapsar as duas numa so faz
   * mudanca de formato no backend parecer "dia sem dado" e o defeito viver meses.
   */
  | 'DECODIFICACAO';

/** Sucesso, com o dado. */
export interface Ok<T> {
  readonly ok: true;
  readonly data: T;
}

/** Falha, com causa tipada e detalhe opcional para log. */
export interface Fail {
  readonly ok: false;
  readonly cause: FailureCause;
  /** Texto para log/diagnostico. NUNCA para exibir cru ao operador. */
  readonly detail?: string;
}

/** Resultado de qualquer operacao de fonte de dados. */
export type FeedResult<T> = Ok<T> | Fail;

/** Constroi sucesso. */
export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

/** Constroi falha. */
export function fail(cause: FailureCause, detail?: string): Fail {
  return detail === undefined ? { ok: false, cause } : { ok: false, cause, detail };
}

// ═════════════════════════════════════════════════════════════════════════════
// Identificacao de instrumento
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Como a biblioteca se refere a um instrumento.
 *
 * ⚠️ `symbol` e OPACO. A biblioteca nao interpreta, nao normaliza e nao adivinha
 * vencimento de contrato. `'WINV26'`, `'BTCUSDT'` e `'AAPL'` sao todos apenas
 * texto aqui.
 *
 * Isso e decisao, nao omissao. Simbologia de verdade — contrato continuo,
 * rolagem de vencimento, alias entre corretoras, desdobramento de acao — depende
 * de calendario e de regra por bolsa, e nao cabe numa biblioteca de desenho.
 * Quem resolve simbologia e o dono do backend; aqui chega o resultado.
 */
export interface InstrumentRef {
  /** Identificador na convencao da fonte. Opaco para a biblioteca. */
  readonly symbol: string;
  /**
   * Incremento minimo de preco, quando conhecido.
   *
   * Importa para desenho: o agrupamento de preco do bookmap e do footprint usa
   * o tick como unidade. Ausente, a camada adota heuristica — que funciona, mas
   * erra em ativo de tick incomum.
   */
  readonly tickSize?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Barras (candles)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma barra OHLCV.
 *
 * `time` e epoch em **segundos**, nao milissegundos. A unidade e explicita e
 * documentada porque a confusao entre as duas e a fonte de bug mais comum nesta
 * fronteira — e porque o substrato de grafico trabalha em segundos enquanto o
 * grid de profundidade desta mesma biblioteca trabalha em milissegundos. Os dois
 * conviverem exige que cada um diga qual usa.
 */
export interface Bar {
  /** Inicio do periodo, epoch em SEGUNDOS. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Volume total. Ausente quando a fonte nao informa. */
  readonly volume?: number;
  /**
   * Volume comprador e vendedor, quando a fonte classifica agressor.
   *
   * A maioria das fontes nao entrega isto, e por isso e opcional. Quando
   * entrega, e o insumo de delta e de leitura de fluxo — e vale saber COMO foi
   * classificado: agressor real (o provedor informa lado) e melhor que
   * Lee-Ready estimado, e as duas coisas chegam neste mesmo campo. Se a
   * distincao importa para o consumidor, ela tem de vir da fonte, nao daqui.
   */
  readonly buyVolume?: number;
  readonly sellVolume?: number;
}

/** O que identifica um pedido de barras. */
export interface BarsRequest {
  readonly instrument: InstrumentRef;
  /**
   * Duracao da barra em SEGUNDOS.
   *
   * Segundos em vez de rotulo (`'M5'`, `'1h'`) de proposito: rotulo obriga a
   * biblioteca a manter uma tabela de traducao por fonte, e cada fonte escreve
   * diferente (`5m`, `M5`, `5min`, `300`). Numero nao tem dialeto. O adaptador
   * traduz para o dialeto da sua fonte, que e exatamente o trabalho dele.
   */
  readonly periodSeconds: number;
  /** Inicio da janela, epoch em segundos (inclusive). */
  readonly fromSeconds?: number;
  /** Fim da janela, epoch em segundos (exclusive). */
  readonly toSeconds?: number;
  /** Teto de barras devolvidas, contando da mais recente. */
  readonly limit?: number;
}

/** Capacidade de entregar barras. */
export interface BarsCapability {
  getBars(request: BarsRequest, signal?: AbortSignal): Promise<FeedResult<readonly Bar[]>>;
  /**
   * Assinatura de barras ao vivo, quando a fonte suporta.
   *
   * O callback recebe a barra em formacao a cada atualizacao e a barra fechada
   * quando ela fecha. Distinguir as duas e responsabilidade do consumidor via
   * `time`: mesma `time` = mesma barra sendo revisada.
   *
   * Devolve a funcao de cancelamento. Chamar duas vezes e seguro.
   */
  subscribeBars?(
    request: BarsRequest,
    onBar: (bar: Bar) => void,
  ): () => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// Profundidade de livro (o insumo do bookmap)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pedido de grade de profundidade.
 *
 * ⚠️ O recorte e por DIA, nao por janela livre, e isso vem da natureza do dado:
 * a grade de um pregao tem ~25.800 celulas e ~630 KB em array tipado. Paginar
 * isso por janela arbitraria multiplicaria requisicao sem reduzir o que a tela
 * precisa ter em memoria para permitir pan sem reconsulta.
 */
export interface DepthGridRequest {
  readonly instrument: InstrumentRef;
  /**
   * Dia no calendario do MERCADO, `YYYY-MM-DD`.
   *
   * ⚠️ Calendario do mercado, nao do navegador. Um pregao brasileiro que vai das
   * 09:00 as 18:00 BRT cruza a meia-noite UTC no horario de verao do hemisferio
   * norte; usar o dia local de quem olha traria meio pregao errado. Ver
   * `market-day.ts`, que deriva este campo com fuso explicito.
   */
  readonly day: string;
  /**
   * Origem do livro.
   *
   * Herdado do modelo da origem, onde a mesma tela consome livro de fontes com
   * qualidade diferente (L2 agregado versus MBO por oferta) e precisa dizer qual
   * esta vendo — porque a leitura de fila muda completamente entre as duas.
   */
  readonly source: FonteBookmap;
  /** Duracao do balde temporal em segundos. */
  readonly bucketSeconds: number;
}

/** Capacidade de entregar grade de profundidade. */
export interface DepthCapability {
  getDepthGrid(
    request: DepthGridRequest,
    signal?: AbortSignal,
  ): Promise<FeedResult<BookmapGrid>>;
  /**
   * Fontes de livro que esta implementacao consegue servir.
   *
   * Existe para a interface nao oferecer ao operador uma fonte que vai responder
   * vazio. Descobrir indisponibilidade depois de trocar a chave e pior que nao
   * ver a chave.
   */
  readonly availableSources?: readonly FonteBookmap[];
}

// ═════════════════════════════════════════════════════════════════════════════
// A composicao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma fonte de dados para a biblioteca.
 *
 * Todas as capacidades sao opcionais. Um objeto vazio e um `Datafeed` valido —
 * inutil, mas valido, e o tipo diz isso em vez de mentir.
 *
 * @example
 * // Fonte so de candles: valida e suficiente para grafico de preco.
 * const feed: Datafeed = {
 *   bars: {
 *     async getBars(req) {
 *       const r = await minhaApi(req.instrument.symbol, req.periodSeconds);
 *       return r ? ok(r) : fail('INDISPONIVEL');
 *     },
 *   },
 * };
 *
 * // O consumidor pergunta antes de oferecer:
 * if (feed.depth) habilitarBookmap();
 */
export interface Datafeed {
  readonly bars?: BarsCapability;
  readonly depth?: DepthCapability;
}

/** Verdadeiro se a fonte entrega barras. */
export function hasBars(feed: Datafeed): feed is Datafeed & { bars: BarsCapability } {
  return typeof feed.bars?.getBars === 'function';
}

/** Verdadeiro se a fonte entrega profundidade (ou seja, se o bookmap e possivel). */
export function hasDepth(feed: Datafeed): feed is Datafeed & { depth: DepthCapability } {
  return typeof feed.depth?.getDepthGrid === 'function';
}
