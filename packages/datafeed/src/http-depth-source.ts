/**
 * http-depth-source — adaptador de referencia para profundidade sobre HTTP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO E, E O QUE ELE NAO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * E um adaptador **de referencia**: mostra a forma de ligar a biblioteca a um
 * backend HTTP, e serve de base para quem tem um. NAO e um cliente de nenhuma
 * API especifica.
 *
 * Duas coisas sao INJETADAS, e e isso que o mantem generico:
 *
 *  1. **o transporte** (`FetchLike`) — a funcao que faz a requisicao;
 *  2. **a montagem da URL** (`buildUrl`) — porque so quem tem o backend sabe a
 *     rota, o nome dos parametros e como autenticar.
 *
 * Nao ha default para nenhuma das duas. Um default de URL seria um palpite sobre
 * o backend de outra pessoa, e um default de `fetch` amarraria a biblioteca ao
 * `globalThis` — o que quebra em ambiente de teste, em SSR e em runtime sem
 * `fetch` global.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE A DECODIFICACAO FICA AQUI, E NAO NO CONSUMIDOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O adaptador devolve `BookmapGrid` — o modelo em array tipado — e nao o JSON
 * cru. A conversao acontece por `decodeColumnar`, que e o **unico produtor
 * legitimo** de grid: ele devolve `null` (nunca grid parcial, nunca excecao)
 * quando qualquer invariante do payload falha.
 *
 * Se o adaptador devolvesse o JSON, cada consumidor decodificaria por conta, e
 * um deles aceitaria um payload meio quebrado. Grid parcial na tela e pior que
 * tela vazia: parece leitura de mercado e nao e.
 *
 * ⚠️ O formato colunar nao e detalhe de otimizacao. Para as ~25.800 celulas de
 * um pregao, colunar sao ~0,83 MB contra ~2,43 MB do verboso — e o payload
 * atravessa a rede a cada troca de dia ou de ativo.
 */

import { decodeColumnar, type BookmapGrid } from '@robustus/charts-core';
import {
  fail,
  ok,
  type DepthCapability,
  type DepthGridRequest,
  type FeedResult,
} from './contracts.js';
import type { FonteBookmap } from '@robustus/charts-core';

/**
 * O subconjunto de `fetch` que este adaptador usa.
 *
 * Declarado como tipo proprio, e nao como `typeof fetch`, de proposito: assim um
 * duble de teste precisa implementar cinco campos em vez de toda a superficie de
 * `Response`, e a assinatura nao muda quando a plataforma acrescenta opcao a
 * `RequestInit`.
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
export type DepthUrlBuilder = (request: DepthGridRequest) => string;

/** Configuracao do adaptador. */
export interface HttpDepthSourceOptions {
  /** Transporte. Obrigatorio — nao ha default por desenho. */
  readonly fetch: FetchLike;
  /** Montagem da URL. Obrigatorio — nao ha default por desenho. */
  readonly buildUrl: DepthUrlBuilder;
  /**
   * Cabecalhos por requisicao.
   *
   * Funcao, e nao objeto, para que credencial de vida curta possa ser lida no
   * momento da chamada. Objeto fixo capturaria um token no momento da construcao
   * e ele venceria em silencio.
   *
   * ⚠️ A biblioteca nunca guarda, registra nem serializa o que sai daqui.
   */
  readonly headers?: () => Record<string, string>;
  /**
   * Limite de espera em ms. Default 10.000.
   *
   * Existe porque requisicao pendurada e pior que requisicao falhada: a tela fica
   * em "carregando" para sempre e o operador nao sabe se espera ou recarrega.
   */
  readonly timeoutMs?: number;
  /** Fontes de livro que este backend serve. Repassado ao contrato. */
  readonly availableSources?: readonly FonteBookmap[];
}

/** Default do limite de espera. */
export const DEPTH_TIMEOUT_MS_DEFAULT = 10_000;

/**
 * Constroi uma capacidade de profundidade sobre HTTP.
 *
 * @example
 * const depth = createHttpDepthSource({
 *   fetch: (url, init) => fetch(url, init),
 *   buildUrl: (r) => {
 *     const qs = new URLSearchParams({
 *       formato: 'colunar',
 *       fonte: r.source,
 *       de: r.day,
 *       baldeSeg: String(r.bucketSeconds),
 *     });
 *     return `/api/bookmap/heatmap-depth/${encodeURIComponent(r.instrument.symbol)}?${qs}`;
 *   },
 *   headers: () => ({ 'x-api-key': lerChaveDaSessao() }),
 * });
 *
 * const feed: Datafeed = { depth };
 */
export function createHttpDepthSource(opts: HttpDepthSourceOptions): DepthCapability {
  const timeoutMs = opts.timeoutMs ?? DEPTH_TIMEOUT_MS_DEFAULT;

  return {
    availableSources: opts.availableSources,

    async getDepthGrid(
      request: DepthGridRequest,
      signal?: AbortSignal,
    ): Promise<FeedResult<BookmapGrid>> {
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
          // 401/403 e "voce nao pode"; 404 e "nao existe"; o resto e falha real.
          // A distincao muda a mensagem e a acao de quem le a tela.
          if (resposta.status === 401 || resposta.status === 403) {
            return fail('NEGADA', `HTTP ${resposta.status}`);
          }
          if (resposta.status === 404 || resposta.status === 204) {
            return fail('INDISPONIVEL', `HTTP ${resposta.status}`);
          }
          return fail('TRANSPORTE', `HTTP ${resposta.status}`);
        }

        const corpo = await resposta.json();

        // `decodeColumnar` e o unico produtor legitimo de grid. `null` = payload
        // violou invariante, e isso e DECODIFICACAO, nao INDISPONIVEL: significa
        // contrato quebrado, e alguem precisa saber.
        const grid = decodeColumnar(corpo);
        if (grid === null) {
          return fail('DECODIFICACAO', 'decodeColumnar recusou o payload');
        }

        return ok(grid);
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
 * Motivos de cancelamento, como sentinelas de identidade.
 *
 * Sao objetos, e nao textos, para que a comparacao seja por identidade. Com
 * texto, um `AbortError` vindo de outra camada com a mesma mensagem seria
 * confundido com o nosso limite de espera — e as duas situacoes tem causa
 * diferente para o operador.
 */
const REASON_TIMEOUT = { motivo: 'timeout' } as const;
const REASON_UPSTREAM = { motivo: 'upstream' } as const;

/** Descreve um valor lancado, sem vazar objeto inteiro para o log. */
function descrever(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  return typeof e;
}
