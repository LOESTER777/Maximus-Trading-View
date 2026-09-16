/**
 * http-bars-source — adaptador de referencia para barras sobre HTTP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO E, E O QUE ELE NAO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * E o gemeo de `http-depth-source.ts` para o outro lado do contrato: entrega
 * `Bar[]` em vez de `BookmapGrid`. Mesma forma, mesmas injecoes, mesmo
 * mapeamento de falha — de proposito. Um consumidor que ja aprendeu o depth
 * source nao reaprende nada aqui, e o mapeamento de causa e o MESMO porque a
 * acao de quem le a tela e a mesma (401/403 e "voce nao pode", 404/204 e "nao
 * existe", resto e "quebrou de verdade").
 *
 * Duas coisas sao INJETADAS, e e isso que o mantem generico:
 *
 *  1. **o transporte** (`FetchLike`) — a funcao que faz a requisicao;
 *  2. **a montagem da URL** (`buildUrl`) — porque so quem tem o backend sabe a
 *     rota, o nome dos parametros e como pedir o periodo.
 *
 * Nao ha default para nenhuma das duas, pela mesma razao do depth source: um
 * default de URL seria palpite sobre o backend de outra pessoa, e um default de
 * `fetch` amarraria a biblioteca ao `globalThis` (quebra em teste, em SSR e em
 * runtime sem `fetch` global).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O PARSE E INJETAVEL, MAS TEM DEFAULT (AO CONTRARIO DA URL)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A URL nao tem default porque nao HA forma generica de adivinha-la. O parse
 * tem, porque existe uma forma comum e obvia: um array de objetos
 * `{time,open,high,low,close,volume}`. O default aceita exatamente isso, e e
 * TOLERANTE de um jeito especifico — devolve `null` (nunca barra parcial, nunca
 * excecao) quando o payload nao e um array de objetos com os cinco campos OHLC
 * finitos. `null` do parser vira `DECODIFICACAO`, igual ao grid recusado do
 * depth source: significa contrato quebrado, nao "dia sem dado".
 *
 * Quem tem um backend com outro formato injeta o seu `parseBars` e ignora o
 * default. O default existe para o caso comum funcionar sem cerimonia, nao para
 * ser um palpite arriscado como uma URL seria.
 *
 * ⚠️ `time` em SEGUNDOS. E a convencao de `Bar` (ver contracts.ts), e a fonte de
 * bug mais comum nesta fronteira e mandar milissegundos. O default NAO adivinha
 * a unidade — se o backend manda ms, o consumidor converte no proprio
 * `parseBars`. Adivinhar (ex.: "> 1e12 e ms") acertaria hoje e erraria num ativo
 * com epoch pequeno, e erro silencioso de unidade e pior que recusa.
 */

import {
  fail,
  ok,
  type Bar,
  type BarsCapability,
  type BarsRequest,
  type FeedResult,
} from './contracts.js';

/**
 * O subconjunto de `fetch` que este adaptador usa.
 *
 * Identico ao do depth source de proposito: um duble de teste implementa os
 * mesmos cinco campos, e o mesmo duble serve para os dois adaptadores.
 */
export type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal; readonly headers?: Record<string, string> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

/** Monta a URL de consulta a partir do pedido. Quem tem o backend escreve. */
export type BarsUrlBuilder = (request: BarsRequest) => string;

/**
 * Converte o corpo cru da resposta em barras.
 *
 * Devolve `null` quando o payload nao e reconhecivel — NUNCA lanca, NUNCA
 * devolve barra parcial. `null` vira `DECODIFICACAO` no resultado, o que
 * distingue "backend mudou o formato" de "backend disse que nao tem".
 *
 * Recebe tambem o pedido para o caso de o formato depender dele (ex.: um backend
 * que devolve colunas separadas e precisa do `periodSeconds` para montar a
 * barra). A maioria dos parsers ignora o segundo argumento.
 */
export type BarsParser = (body: unknown, request: BarsRequest) => readonly Bar[] | null;

/** Configuracao do adaptador. */
export interface HttpBarsSourceOptions {
  /** Transporte. Obrigatorio — nao ha default por desenho. */
  readonly fetch: FetchLike;
  /** Montagem da URL. Obrigatorio — nao ha default por desenho. */
  readonly buildUrl: BarsUrlBuilder;
  /**
   * Conversao do corpo em barras. Opcional: sem ele, usa `parseBarsDefault`,
   * que aceita um array de `{time,open,high,low,close,volume}`.
   */
  readonly parseBars?: BarsParser;
  /**
   * Cabecalhos por requisicao.
   *
   * Funcao, e nao objeto, para que credencial de vida curta possa ser lida no
   * momento da chamada. Objeto fixo capturaria um token na construcao e ele
   * venceria em silencio.
   *
   * ⚠️ A biblioteca nunca guarda, registra nem serializa o que sai daqui.
   */
  readonly headers?: () => Record<string, string>;
  /**
   * Limite de espera em ms. Default 10.000.
   *
   * Existe porque requisicao pendurada e pior que requisicao falhada: a tela
   * fica em "carregando" para sempre e o operador nao sabe se espera ou
   * recarrega.
   */
  readonly timeoutMs?: number;
}

/** Default do limite de espera. Igual ao do depth source, por simetria. */
export const BARS_TIMEOUT_MS_DEFAULT = 10_000;

/**
 * Constroi uma capacidade de barras sobre HTTP.
 *
 * @example
 * const bars = createHttpBarsSource({
 *   fetch: (url, init) => fetch(url, init),
 *   buildUrl: (r) => {
 *     const qs = new URLSearchParams({
 *       symbol: r.instrument.symbol,
 *       tf: String(r.periodSeconds),
 *       ...(r.fromSeconds != null ? { de: String(r.fromSeconds) } : {}),
 *       ...(r.toSeconds != null ? { ate: String(r.toSeconds) } : {}),
 *       ...(r.limit != null ? { limite: String(r.limit) } : {}),
 *     });
 *     return `/api/candles?${qs}`;
 *   },
 *   headers: () => ({ 'x-api-key': lerChaveDaSessao() }),
 * });
 *
 * const feed: Datafeed = { bars };
 */
export function createHttpBarsSource(opts: HttpBarsSourceOptions): BarsCapability {
  const timeoutMs = opts.timeoutMs ?? BARS_TIMEOUT_MS_DEFAULT;
  const parseBars = opts.parseBars ?? parseBarsDefault;

  return {
    async getBars(
      request: BarsRequest,
      signal?: AbortSignal,
    ): Promise<FeedResult<readonly Bar[]>> {
      // Cancelamento que chegou ANTES da requisicao sair: nao vale gastar
      // conexao para descobrir que ninguem quer a resposta.
      if (signal?.aborted) return fail('CANCELADA');

      let url: string;
      try {
        url = opts.buildUrl(request);
      } catch (e) {
        // Montador de URL do consumidor lancou. E defeito dele, mas nao pode
        // virar excecao no ciclo de desenho.
        return fail('TRANSPORTE', `buildUrl lancou: ${descrever(e)}`);
      }

      // Une o cancelamento de quem chamou com o limite de espera nosso. Assim o
      // consumidor cancela por troca de ativo E o relogio protege de backend
      // pendurado, sem que um caminho anule o outro.
      const controlador = new AbortController();
      const cronometro = setTimeout(() => controlador.abort(REASON_TIMEOUT), timeoutMs);
      const repassar = (): void => controlador.abort(REASON_UPSTREAM);
      signal?.addEventListener('abort', repassar, { once: true });

      try {
        const resposta = await opts.fetch(url, {
          signal: controlador.signal,
          ...(opts.headers ? { headers: opts.headers() } : {}),
        });

        if (!resposta.ok) {
          // Mesmo mapeamento do depth source: a distincao muda a mensagem e a
          // acao de quem le a tela.
          if (resposta.status === 401 || resposta.status === 403) {
            return fail('NEGADA', `HTTP ${resposta.status}`);
          }
          if (resposta.status === 404 || resposta.status === 204) {
            return fail('INDISPONIVEL', `HTTP ${resposta.status}`);
          }
          return fail('TRANSPORTE', `HTTP ${resposta.status}`);
        }

        const corpo = await resposta.json();

        // `parseBars` e o unico produtor legitimo de barras aqui. `null` =
        // payload nao reconhecido, e isso e DECODIFICACAO, nao INDISPONIVEL:
        // significa contrato quebrado, e alguem precisa saber.
        let barras: readonly Bar[] | null;
        try {
          barras = parseBars(corpo, request);
        } catch (e) {
          // Parser do consumidor lancou. Tratamos como formato irreconhecivel,
          // nao como excecao — o ciclo de desenho nao pode cair por isso.
          return fail('DECODIFICACAO', `parseBars lancou: ${descrever(e)}`);
        }
        if (barras === null) {
          return fail('DECODIFICACAO', 'parseBars recusou o payload');
        }

        return ok(barras);
      } catch (e) {
        if (controlador.signal.reason === REASON_TIMEOUT) {
          return fail('TEMPO_ESGOTADO', `${timeoutMs} ms`);
        }
        if (signal?.aborted || controlador.signal.reason === REASON_UPSTREAM) {
          return fail('CANCELADA');
        }
        return fail('TRANSPORTE', descrever(e));
      } finally {
        clearTimeout(cronometro);
        signal?.removeEventListener('abort', repassar);
      }
    },
  };
}

/**
 * Parser default: array de objetos `{time,open,high,low,close,volume?}`.
 *
 * Tolerante no sentido de que aceita campos extras e ignora — o backend pode
 * mandar mais do que a barra usa. Rigoroso no que importa: os cinco campos OHLC
 * (`time`, `open`, `high`, `low`, `close`) tem de existir e ser numeros finitos,
 * senao a barra inteira e recusada e o parse devolve `null`.
 *
 * ⚠️ Devolve `null` (o array inteiro), nao pula a barra ruim. Barra faltando no
 * meio da serie e pior que serie recusada: um buraco no grafico parece
 * pregao sem negocio, e nao e. Se UMA barra nao decodifica, o formato esta
 * errado e o consumidor precisa saber — nao mascarar uma parte.
 *
 * `volume`, `buyVolume` e `sellVolume` sao opcionais no contrato: quando
 * presentes e finitos, entram; quando ausentes ou nao-finitos, ficam de fora
 * (ausencia = "nao sei", nunca zero).
 */
export function parseBarsDefault(body: unknown, _request: BarsRequest): readonly Bar[] | null {
  if (!Array.isArray(body)) return null;

  const saida: Bar[] = [];
  for (const bruto of body) {
    const barra = lerBarra(bruto);
    // Uma barra irreconhecivel condena a serie inteira, de proposito (ver doc).
    if (barra === null) return null;
    saida.push(barra);
  }
  return saida;
}

/** Le uma barra de um objeto cru, ou `null` se algum campo OHLC nao serve. */
function lerBarra(bruto: unknown): Bar | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const o = bruto as Record<string, unknown>;

  const time = numeroFinito(o['time']);
  const open = numeroFinito(o['open']);
  const high = numeroFinito(o['high']);
  const low = numeroFinito(o['low']);
  const close = numeroFinito(o['close']);

  // Os cinco campos OHLC sao obrigatorios. Faltando um, a barra nao existe.
  if (
    time === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  const barra: Bar = { time, open, high, low, close };

  // Campos opcionais entram so quando sao numero finito. Ausencia e "nao sei",
  // e nao zero: zero de volume afirmaria "houve pregao e ninguem negociou", que
  // e leitura diferente de "a fonte nao informou".
  const volume = numeroFinito(o['volume']);
  const buyVolume = numeroFinito(o['buyVolume']);
  const sellVolume = numeroFinito(o['sellVolume']);

  return {
    ...barra,
    ...(volume !== null ? { volume } : {}),
    ...(buyVolume !== null ? { buyVolume } : {}),
    ...(sellVolume !== null ? { sellVolume } : {}),
  };
}

/** Numero finito, ou `null`. Rejeita `NaN`, `Infinity`, string e ausencia. */
function numeroFinito(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Motivos de cancelamento, como sentinelas de identidade.
 *
 * Sao objetos, e nao textos, para que a comparacao seja por identidade — igual
 * ao depth source, pela mesma razao: um `AbortError` de outra camada com a mesma
 * mensagem nao pode ser confundido com o nosso limite de espera.
 */
const REASON_TIMEOUT = { motivo: 'timeout' } as const;
const REASON_UPSTREAM = { motivo: 'upstream' } as const;

/** Descreve um valor lancado, sem vazar objeto inteiro para o log. */
function descrever(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  return typeof e;
}
