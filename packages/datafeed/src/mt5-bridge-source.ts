/**
 * mt5-bridge-source — a fonte de barras AO VIVO, do terminal MT5.
 *
 * ⭐ Pequeno de propósito, como o irmão `robustus-bars-source`: só amarra o dialeto puro
 * (`mt5-bridge.core.ts`) ao transporte que já existe. Um segundo cliente HTTP daria dois
 * lugares para tratar tempo esgotado, cancelamento e mapa de causa, e eles divergiriam na
 * primeira correção.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ESTA FONTE NÃO SERVE PARA HISTÓRICO PROFUNDO, E ISSO É DECLARADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A rota `/candles` da bridge devolve as **N últimas** barras; ela não filtra por janela. Então
 * pedir uma janela de 2019 aqui baixaria de hoje para trás até 2019 — dezenas de milhares de
 * barras, serializadas em JSON, por um processo que roda dentro do Wine **no mesmo terminal que
 * alimenta o robô que opera**. Gastar esse recurso para desenhar uma tela é o tipo de coisa que
 * derruba a operação.
 *
 * Divisão de trabalho, e cada um faz o que sabe:
 *
 * | | quem responde | por quê |
 * |---|---|---|
 * | passado profundo (18 anos) | `bars_api` da máquina B | é um arquivo, indexado, com janela |
 * | **dia corrente** | **esta fonte** | é o único que TEM (medido: arquivo = 0 barras hoje) |
 *
 * Quem une as duas é `emendarSeries`, no núcleo puro.
 *
 * @example
 * const aoVivo = criarFonteDeBarrasDoMt5({
 *   fetch: (url, init) => fetch(url, init),
 *   baseUrl: '/mt5',                       // proxy do Vite, em desenvolvimento
 *   token: () => lerTokenDaSessao(),
 *   comFluxo: true,                        // buy/sell volume, o insumo de delta
 * });
 */

import { fail, type BarsCapability, type BarsRequest, type FeedResult, type Bar } from './contracts.js';
import { createHttpBarsSource, type FetchLike } from './http-bars-source.js';
import {
  montarCaminhoDeCandlesMt5,
  parseCandlesDoMt5,
  resolverContratoVigente,
  rotuloDePeriodoMt5,
  type SimboloDaBridge,
} from './mt5-bridge.core.js';

export interface FonteDeBarrasDoMt5Options {
  /** Transporte. Obrigatório — a biblioteca não toca em `globalThis.fetch`. */
  readonly fetch: FetchLike;
  /**
   * Origem da bridge, sem barra no fim. Ex.: `http://127.0.0.1:8229` ou `/mt5` (proxy).
   *
   * ⚠️ Sem default: a bridge do mini índice e a de Forex são processos diferentes em portas
   * diferentes, e adivinhar a porta errada entregaria cotação de OUTRO mercado — com preço
   * plausível. Quem monta declara.
   */
  readonly baseUrl: string;
  /**
   * O token, lido NO MOMENTO da chamada.
   *
   * ⚠️ Função, e não cadeia: token de vida curta capturado na construção vence em silêncio, e
   * o sintoma seria "o gráfico parou de atualizar depois de um tempo".
   *
   * ⚠️ A biblioteca não guarda, não registra e não serializa este valor.
   */
  readonly token?: () => string;
  /**
   * ⭐ Pedir `/historical-flow` (com `buy_volume`/`sell_volume`) em vez de `/candles`.
   *
   * O fluxo é o insumo de delta, CVD e footprint — e o terminal classifica agressor de
   * verdade, não por Lee-Ready estimado por nós.
   *
   * ⚠️⚠️ **Custa 10x mais, e o custo é do TERMINAL QUE OPERA.** Medido no WIN 5min:
   * `/candles` = 0,7 s para 700 barras; `/historical-flow` = 7,0 s para 95 barras. A bridge
   * roda dentro do Wine, no mesmo processo que alimenta o robô. Quem liga isto **precisa**
   * espaçar o polling — ver `INTERVALO_AO_VIVO_MS` no consumidor.
   */
  readonly comFluxo?: boolean;
  /**
   * Quantos DIAS pedir quando `comFluxo`. Default **1** (o dia corrente).
   *
   * ⚠️ Ignorado sem `comFluxo`: `/candles` recorta por `limit`, não por dias. As duas rotas
   * têm parâmetros diferentes — ver a nota em `montarCaminhoDeCandlesMt5`.
   */
  readonly dias?: number;
  /** Limite de espera em ms. */
  readonly timeoutMs?: number;
}

/** Constrói a capacidade de barras contra a bridge MT5. */
export function criarFonteDeBarrasDoMt5(opts: FonteDeBarrasDoMt5Options): BarsCapability {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const comFluxo = opts.comFluxo === true;
  const rota = { comFluxo, ...(opts.dias === undefined ? {} : { dias: opts.dias }) };

  const cabecalhos = (): Record<string, string> => {
    const t = opts.token?.();
    return {
      'Accept-Encoding': 'gzip',
      ...(t === undefined || t === '' ? {} : { Authorization: `Bearer ${t}` }),
    };
  };

  const transporte = createHttpBarsSource({
    fetch: opts.fetch,
    buildUrl: (request) => {
      const caminho = montarCaminhoDeCandlesMt5(request, rota);
      // Inatingível na prática — `getBars` recusa antes. A guarda fica porque `buildUrl` é
      // público por tipo e não pode lançar: exceção aqui subiria pelo ciclo de desenho.
      return caminho === null ? '' : `${base}${caminho}`;
    },
    // ⭐ O recorte por janela acontece no PARSER, porque a rota não filtra por tempo. E o
    // parser é quem corrige o fuso — a unidade errada não circula nem por um passo.
    parseBars: (body, request) =>
      parseCandlesDoMt5(body, {
        ...(request.fromSeconds === undefined ? {} : { deSegundos: request.fromSeconds }),
        ...(request.toSeconds === undefined ? {} : { ateSegundos: request.toSeconds }),
      }),
    headers: cabecalhos,
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });

  return {
    /**
     * ⚠️ A recusa acontece ANTES da rede, e com a causa CERTA (`INDISPONIVEL`, não
     * `TRANSPORTE`). Mesma lição do adaptador do arquivo: `TRANSPORTE` significa "a rede
     * quebrou", e dizer isso sobre um período que a fonte não tem faz o operador tentar de
     * novo para sempre contra um pedido que nunca será atendido.
     */
    async getBars(
      request: BarsRequest,
      signal?: AbortSignal,
    ): Promise<FeedResult<readonly Bar[]>> {
      if (rotuloDePeriodoMt5(request.periodSeconds) === null) {
        return fail(
          'INDISPONIVEL',
          `periodo de ${request.periodSeconds}s nao existe nesta bridge`,
        );
      }
      if (montarCaminhoDeCandlesMt5(request, rota) === null) {
        return fail('INDISPONIVEL', 'simbolo fora do formato aceito pela bridge');
      }
      return transporte.getBars(request, signal);
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A resolução do contrato vigente, com I/O
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pergunta à bridge qual contrato está negociando para uma RAIZ (`WIN` → `WINV26`).
 *
 * ⭐ A decisão é do núcleo puro (`resolverContratoVigente`, que lê a descrição publicada pela
 * corretora); aqui só acontece a busca. Ver a nota longa lá sobre por que resolver por DATA
 * custou 3.400 pontos de erro na origem.
 *
 * ⚠️ Devolve `null` em qualquer falha — rede fora, token recusado, formato inesperado. `null`
 * é **"não sei"**, e o chamador cai no fallback declarado. Nunca lança: esta função é chamada
 * de dentro do ciclo de montagem do gráfico, e exceção ali derruba a tela inteira.
 */
export async function resolverContratoDaBridge(
  opts: Pick<FonteDeBarrasDoMt5Options, 'fetch' | 'baseUrl' | 'token'>,
  raiz: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  try {
    const t = opts.token?.();
    const r = await opts.fetch(`${base}/symbols/search?q=${encodeURIComponent(raiz)}`, {
      ...(signal === undefined ? {} : { signal }),
      headers: {
        Accept: 'application/json',
        ...(t === undefined || t === '' ? {} : { Authorization: `Bearer ${t}` }),
      },
    });
    if (!r.ok) return null;
    const corpo: unknown = await r.json();
    if (!Array.isArray(corpo)) return null;
    // Filtra para o que o núcleo entende, descartando entrada malformada em vez de rejeitar
    // a lista inteira: um símbolo estranho no catálogo não pode apagar os outros.
    const simbolos: SimboloDaBridge[] = [];
    for (const s of corpo) {
      if (typeof s !== 'object' || s === null) continue;
      const o = s as Record<string, unknown>;
      if (typeof o['name'] !== 'string') continue;
      simbolos.push({
        name: o['name'],
        ...(typeof o['description'] === 'string' ? { description: o['description'] } : {}),
        ...(typeof o['visible'] === 'boolean' ? { visible: o['visible'] } : {}),
      });
    }
    return resolverContratoVigente(simbolos, raiz);
  } catch {
    // Inclui `AbortError`. Cancelamento não é falha a reportar — é o consumidor desistindo.
    return null;
  }
}

/**
 * A bridge está de pé e o terminal conectado?
 *
 * ⭐ `/health` é aberto (não exige token), e é o que permite decidir se vale tentar o resto.
 * Distinguir "bridge fora" de "token errado" importa: a primeira degrada para o arquivo em
 * silêncio aceitável, a segunda é configuração e precisa aparecer.
 *
 * ⚠️ Nunca lança, pelo mesmo motivo de `resolverContratoDaBridge`.
 */
export async function bridgeConectada(
  opts: Pick<FonteDeBarrasDoMt5Options, 'fetch' | 'baseUrl'>,
  signal?: AbortSignal,
): Promise<boolean> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  try {
    const r = await opts.fetch(`${base}/health`, {
      ...(signal === undefined ? {} : { signal }),
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return false;
    const corpo: unknown = await r.json();
    return (
      typeof corpo === 'object' &&
      corpo !== null &&
      (corpo as { connected?: unknown }).connected === true
    );
  } catch {
    return false;
  }
}
