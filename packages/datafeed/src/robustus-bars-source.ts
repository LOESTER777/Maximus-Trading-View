/**
 * robustus-bars-source — a fonte de barras da mesa, montada.
 *
 * ⭐ Este arquivo é DELIBERADAMENTE pequeno: ele só amarra o dialeto puro
 * (`robustus-bars.core.ts`) ao transporte que já existe (`createHttpBarsSource`, com
 * `fetch` injetado, tempo esgotado, cancelamento e mapa de causa). Escrever um segundo
 * cliente HTTP daria dois lugares para tratar as mesmas cinco falhas, e eles divergiriam
 * na primeira correção.
 *
 * @example
 * // Na máquina da mesa, o serviço chega pelo túnel local.
 * const feed: Datafeed = {
 *   bars: criarFonteDeBarrasDaMesa({
 *     fetch: (url, init) => fetch(url, init),
 *     baseUrl: 'http://127.0.0.1:18899',
 *     apiKey: () => lerChaveDaSessao(),
 *   }),
 * };
 * const r = await feed.bars!.getBars({
 *   instrument: { symbol: 'WIN' },
 *   periodSeconds: 300,
 *   fromSeconds: 1789430400,
 *   toSeconds: 1789516800,
 * });
 */

import { fail, type BarsCapability, type BarsRequest, type FeedResult, type Bar } from './contracts.js';
import { createHttpBarsSource, type FetchLike } from './http-bars-source.js';
import {
  montarCaminhoDeBarras,
  parseBarrasDaMesa,
  rotuloDePeriodo,
  simboloAceito,
} from './robustus-bars.core.js';

export interface FonteDeBarrasDaMesaOptions {
  /** Transporte. Obrigatório — a biblioteca não toca em `globalThis.fetch`. */
  readonly fetch: FetchLike;
  /**
   * Origem do serviço, sem barra no fim. Ex.: `http://127.0.0.1:18899`.
   *
   * ⚠️ Sem default, e de propósito. O endereço depende de ONDE o consumidor roda: pelo
   * túnel local na máquina da mesa, pela LAN, ou por um domínio atrás de autenticação.
   * Um default seria palpite sobre a topologia de rede de quem usa.
   */
  readonly baseUrl: string;
  /**
   * A chave de aplicação, lida NO MOMENTO da chamada.
   *
   * ⚠️ Função, e não cadeia: credencial de vida curta capturada na construção vence em
   * silêncio, e o sintoma seria "o gráfico parou de carregar depois de um tempo".
   *
   * ⚠️ A biblioteca não guarda, não registra e não serializa este valor. E quando o
   * serviço está sem chave configurada ele libera a leitura — então ausência aqui é
   * configuração válida, não esquecimento.
   */
  readonly apiKey?: () => string;
  /** Limite de espera em ms. Ver o default do transporte. */
  readonly timeoutMs?: number;
}

/**
 * Constrói a capacidade de barras contra a API de barras da mesa.
 *
 * ⚠️ `getBars` sem `fromSeconds` **nem** `toSeconds` falha por `INDISPONIVEL`, e isso é
 * intencional: a rota não tem `LIMIT`, então uma consulta sem janela devolveria a série
 * inteira (18 anos de 5min para o WIN) numa resposta só. Ver a nota longa em
 * `montarCaminhoDeBarras`.
 */
export function criarFonteDeBarrasDaMesa(opts: FonteDeBarrasDaMesaOptions): BarsCapability {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const transporte = createHttpBarsSource({
    fetch: opts.fetch,
    buildUrl: (request) => {
      const caminho = montarCaminhoDeBarras(request);
      // Inatingível na prática: `getBars` abaixo recusa esses pedidos ANTES de chegar aqui
      // (ver a nota sobre a causa). A guarda fica porque `buildUrl` é público por tipo e
      // não pode lançar — exceção aqui subiria pelo ciclo de desenho.
      return caminho === null ? '' : `${base}${caminho}`;
    },
    // ⚠️ O PERÍODO vai ao parser porque o `D1` da base tem duas convenções de virada de dia e
    // precisa ser colapsado — ver a nota longa em `parseBarrasDaMesa`.
    parseBars: (body, request) => parseBarrasDaMesa(body, request.periodSeconds),
    headers: () => {
      const chave = opts.apiKey?.();
      return {
        // ⭐ `gzip` importa de verdade aqui: o corpo é colunar e repetitivo (18 anos de
        // barras), e o serviço honra a negociação. Sem isto o backfill trafega alguns
        // megabytes por lote.
        'Accept-Encoding': 'gzip',
        ...(chave === undefined || chave === '' ? {} : { 'X-Api-Key': chave }),
      };
    },
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });

  return {
    /**
     * ⭐⭐ A RECUSA ACONTECE ANTES DA REDE, E COM A CAUSA CERTA.
     *
     * ⚠️ **Defeito medido contra o serviço real em 17/09/2026**, antes desta camada
     * existir: pedir M1 (que a base não tem), `WIN$` (que a rota recusa) ou uma consulta
     * sem janela devolvia `cause: 'TRANSPORTE'`. E `TRANSPORTE` significa *"a rede
     * quebrou"* — uma mentira, três vezes:
     *
     *  - a interface mostraria "erro de conexão" e o operador tentaria de novo, para
     *    sempre, contra um pedido que NUNCA vai ser atendido;
     *  - o diagnóstico apontaria para a rede, e a rede está boa;
     *  - e a causa honesta (`INDISPONIVEL` = *"a fonte não tem esse dado"*) é justamente
     *    a que existe no contrato para o consumidor decidir esconder o período do
     *    seletor em vez de insistir.
     *
     * A raiz era o atalho de devolver URL vazia e deixar o transporte "resolver": o
     * transporte só sabe falar de transporte. Quem conhece o motivo é quem valida.
     *
     * ⚠️ E a recusa é ANTES da rede também por custo: um período inexistente não vale um
     * `fetch`, e uma consulta sem janela vale menos ainda — ela é a que derrubaria o
     * serviço para todo mundo, inclusive para o robô que opera.
     */
    async getBars(
      request: BarsRequest,
      signal?: AbortSignal,
    ): Promise<FeedResult<readonly Bar[]>> {
      if (rotuloDePeriodo(request.periodSeconds) === null) {
        return fail(
          'INDISPONIVEL',
          `periodo de ${request.periodSeconds}s nao existe nesta fonte (5min, 15min, 1h, D1)`,
        );
      }
      if (!simboloAceito(request.instrument.symbol)) {
        // Sem ecoar o símbolo cru num campo que pode ir para log de terceiro: o nome é do
        // consumidor, e a mensagem já diz o que fazer.
        return fail('INDISPONIVEL', 'simbolo fora do formato aceito (letras e digitos, ate 16)');
      }
      if (montarCaminhoDeBarras(request) === null) {
        return fail(
          'INDISPONIVEL',
          'consulta sem janela utilizavel: informe fromSeconds e/ou toSeconds',
        );
      }
      return transporte.getBars(request, signal);
    },
  };
}
