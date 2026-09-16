/**
 * ws-bars-source — barras ao vivo sobre WebSocket, para `subscribeBars`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O WEBSOCKET E INJETADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A factory recebe `(url) => WebSocketLike` de fora. NAO usa o `WebSocket`
 * global, pela mesma razao que o HTTP source nao usa o `fetch` global: uma
 * biblioteca nao pode assumir que o global existe. Em Node puro (teste, SSR,
 * ferramenta de linha de comando) nao ha `WebSocket` global antes do Node 21, e
 * mesmo onde ha, um duble de teste precisa poder substitui-lo sem monkeypatch de
 * `globalThis` — que vaza entre testes e e a fonte classica de flake.
 *
 * `WebSocketLike` e um contrato MINIMO (send/close + os quatro handlers). Nao e
 * `typeof WebSocket`: assim o duble implementa cinco coisas em vez de toda a
 * superficie de `WebSocket`, e nao dependemos do lib DOM alem do necessario.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE RECONEXAO COM BACKOFF E TETO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Conexao ao vivo cai — rede oscila, servidor reinicia, proxy expira ocioso. Uma
 * assinatura que nao reconecta obriga o consumidor a detectar a queda e refazer,
 * e cada consumidor faria diferente. Entao reconectamos aqui.
 *
 * O backoff e EXPONENCIAL para nao martelar um servidor que caiu: reconectar
 * 100 vezes por segundo num backend em recuperacao atrasa a propria
 * recuperacao. E tem TETO porque backoff sem teto vira minutos de espera depois
 * de algumas falhas — e o operador que voltou do almoco quer o dado agora, nao
 * daqui a oito minutos. Teto tambem impede o atraso de crescer sem limite quando
 * o servidor fica horas fora.
 *
 * Uma reconexao BEM-SUCEDIDA zera o backoff: a proxima queda recomeca do minimo,
 * porque a rede que funcionou agora provavelmente volta rapido.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BARRA EM FORMACAO vs FECHADA — o contrato de `subscribeBars`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O callback recebe a barra a cada atualizacao. Distinguir formando de fechada e
 * do consumidor, via `time`: MESMA `time` = mesma barra sendo revisada; `time`
 * nova = a anterior fechou. Este arquivo nao decide isso — so entrega o que o
 * parser extrai da mensagem, na ordem que chega. E deliberado: fechamento de
 * barra e regra de mercado (o balde fecha no segundo cheio? no primeiro trade do
 * proximo?) e cabe a fonte, nao a biblioteca de desenho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NUNCA LANCA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Igual ao resto do contrato: erro de socket vira reconexao, mensagem
 * irreconhecivel e descartada, parser que lanca e contido. Nada aqui sobe
 * excecao para o ciclo de desenho. `subscribeBars` devolve a funcao de
 * cancelamento; chama-la para de vez (nao reconecta) e e segura de chamar duas
 * vezes.
 */

import type { Bar, BarsRequest } from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// O contrato minimo de socket
// ═════════════════════════════════════════════════════════════════════════════

/** Um evento de mensagem, so com o campo que lemos. */
export interface MessageEventLike {
  readonly data: unknown;
}

/** Um evento de fechamento, so com o que interessa ao log. */
export interface CloseEventLike {
  readonly code?: number;
  readonly reason?: string;
}

/**
 * O subconjunto de `WebSocket` que este adaptador usa.
 *
 * Handlers como propriedades atribuiveis (`onopen = ...`), no estilo do
 * `WebSocket` do DOM, para que um duble seja trivial de escrever e a factory de
 * producao possa devolver o `WebSocket` real sem adaptacao.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEventLike) => void) | null;
  onclose: ((event: CloseEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Cria um socket para a URL dada. Quem tem o backend fornece. */
export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * Extrai barras de uma mensagem crua do socket.
 *
 * Devolve as barras que a mensagem carrega (pode ser zero, uma ou varias — um
 * frame pode trazer um lote), ou `null`/`[]` para mensagem que nao e de barra
 * (ex.: pong, confirmacao de assinatura, keepalive). NUNCA lanca; se lancar, e
 * contido e a mensagem e descartada.
 *
 * Recebe o pedido para o caso de a mensagem so fazer sentido com ele (ex.:
 * montar `time` a partir do `periodSeconds`).
 */
export type WsMessageParser = (
  data: unknown,
  request: BarsRequest,
) => readonly Bar[] | Bar | null;

/**
 * Monta a mensagem de assinatura enviada ao abrir o socket.
 *
 * Opcional: sockets que ja assinam pela URL nao precisam. Devolve a string a
 * enviar, ou `null` para nao enviar nada.
 */
export type WsSubscribeMessageBuilder = (request: BarsRequest) => string | null;

/** Configuracao do adaptador. */
export interface WsBarsSourceOptions {
  /** Cria o socket. Obrigatorio — nao ha default por desenho (sem global). */
  readonly connect: WebSocketFactory;
  /** URL do socket para o pedido. Obrigatorio — so o backend a conhece. */
  readonly buildUrl: (request: BarsRequest) => string;
  /** Extrai barras da mensagem. Obrigatorio — o formato e do backend. */
  readonly parseMessage: WsMessageParser;
  /** Mensagem de assinatura ao abrir, se o socket precisar. */
  readonly buildSubscribeMessage?: WsSubscribeMessageBuilder;
  /**
   * Reportado quando algo digno de log acontece (queda, reconexao, parser que
   * lancou). Opcional. NUNCA recebe credencial nem payload cru inteiro.
   */
  readonly onEvent?: (event: WsBarsEvent) => void;
  /** Ajustes de reconexao. Todos com default sensato. */
  readonly reconnect?: ReconnectOptions;
  /** Heartbeat/ping opcional, para manter o socket vivo atras de proxy ocioso. */
  readonly heartbeat?: HeartbeatOptions;
  /**
   * Relogio injetavel para os temporizadores. Default: `setTimeout` global.
   *
   * Existe para o teste controlar backoff e heartbeat com fake timers sem
   * depender do global — e para ambiente sem `setTimeout` poder fornece-lo.
   */
  readonly timers?: TimerLike;
}

/** Parametros de reconexao com backoff exponencial e teto. */
export interface ReconnectOptions {
  /** Ligar/desligar a reconexao. Default `true`. */
  readonly enabled?: boolean;
  /** Espera inicial em ms. Default 500. */
  readonly initialDelayMs?: number;
  /** Teto da espera em ms. Default 30.000. */
  readonly maxDelayMs?: number;
  /** Multiplicador a cada tentativa. Default 2. */
  readonly factor?: number;
  /**
   * Teto de tentativas seguidas antes de desistir. Default `Infinity`.
   *
   * Desistir e opcional de proposito: para dado ao vivo, tentar para sempre
   * (com o backoff no teto) costuma ser o certo — o servidor volta e o operador
   * quer o dado. Quem prefere desistir e mostrar "sem conexao" define um teto.
   */
  readonly maxRetries?: number;
}

/** Parametros do heartbeat/ping. */
export interface HeartbeatOptions {
  /** Intervalo entre pings em ms. Ausente ou <=0 desliga o heartbeat. */
  readonly intervalMs?: number;
  /**
   * A mensagem de ping. String fixa, ou funcao chamada a cada envio (para ping
   * com timestamp/sequencia). Default: `'ping'`.
   */
  readonly message?: string | (() => string);
}

/** O que precisamos de um agendador. Subconjunto de `setTimeout`. */
export interface TimerLike {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Evento de diagnostico emitido por `onEvent`. */
export type WsBarsEvent =
  | { readonly type: 'open' }
  | { readonly type: 'close'; readonly code?: number; readonly reason?: string }
  | { readonly type: 'error'; readonly detail: string }
  | { readonly type: 'reconnecting'; readonly attempt: number; readonly delayMs: number }
  | { readonly type: 'giveup'; readonly attempts: number }
  | { readonly type: 'parse-error'; readonly detail: string };

// ═════════════════════════════════════════════════════════════════════════════
// Defaults
// ═════════════════════════════════════════════════════════════════════════════

export const WS_RECONNECT_INITIAL_MS_DEFAULT = 500;
export const WS_RECONNECT_MAX_MS_DEFAULT = 30_000;
export const WS_RECONNECT_FACTOR_DEFAULT = 2;
export const WS_HEARTBEAT_MESSAGE_DEFAULT = 'ping';

/** Relogio default: os globais. Isolado para o teste substituir por inteiro. */
const TIMERS_GLOBAIS: TimerLike = {
  setTimeout: (h, ms) => setTimeout(h, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (h, ms) => setInterval(h, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

// ═════════════════════════════════════════════════════════════════════════════
// A capacidade
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Constroi um `subscribeBars` ao vivo sobre WebSocket.
 *
 * Devolve a funcao pronta para compor num `BarsCapability`:
 *
 * @example
 * const subscribeBars = createWsBarsSource({
 *   connect: (url) => new WebSocket(url),          // no navegador
 *   buildUrl: (r) => `wss://meu-backend/stream/${r.instrument.symbol}?tf=${r.periodSeconds}`,
 *   parseMessage: (data) => {
 *     const m = JSON.parse(String(data));
 *     return m.tipo === 'bar' ? { time: m.t, open: m.o, high: m.h, low: m.l, close: m.c, volume: m.v } : null;
 *   },
 *   heartbeat: { intervalMs: 15_000 },
 * });
 *
 * const feed: Datafeed = { bars: { getBars, subscribeBars } };
 */
export function createWsBarsSource(
  opts: WsBarsSourceOptions,
): (request: BarsRequest, onBar: (bar: Bar) => void) => () => void {
  const timers = opts.timers ?? TIMERS_GLOBAIS;

  const reconnectEnabled = opts.reconnect?.enabled ?? true;
  const initialDelayMs = opts.reconnect?.initialDelayMs ?? WS_RECONNECT_INITIAL_MS_DEFAULT;
  const maxDelayMs = opts.reconnect?.maxDelayMs ?? WS_RECONNECT_MAX_MS_DEFAULT;
  const factor = opts.reconnect?.factor ?? WS_RECONNECT_FACTOR_DEFAULT;
  const maxRetries = opts.reconnect?.maxRetries ?? Number.POSITIVE_INFINITY;

  const heartbeatMs = opts.heartbeat?.intervalMs ?? 0;
  const heartbeatMsg = opts.heartbeat?.message ?? WS_HEARTBEAT_MESSAGE_DEFAULT;

  return function subscribeBars(request: BarsRequest, onBar: (bar: Bar) => void): () => void {
    // Estado da assinatura. Vive na clausura para que a funcao de cancelamento
    // possa desligar tudo, e para que a reconexao troque o socket sem perder o
    // fio.
    let socket: WebSocketLike | null = null;
    let cancelado = false;
    /** Tentativas de reconexao SEGUIDAS; zera ao conectar com sucesso. */
    let tentativas = 0;
    let timerReconexao: unknown = null;
    let timerHeartbeat: unknown = null;

    const emitir = (evento: WsBarsEvent): void => {
      // O log do consumidor nao pode derrubar a assinatura. Contem qualquer
      // excecao dele.
      try {
        opts.onEvent?.(evento);
      } catch {
        /* log que lanca nao e problema nosso, e nao pode virar nosso */
      }
    };

    const pararHeartbeat = (): void => {
      if (timerHeartbeat !== null) {
        timers.clearInterval(timerHeartbeat);
        timerHeartbeat = null;
      }
    };

    const iniciarHeartbeat = (): void => {
      if (heartbeatMs <= 0) return;
      pararHeartbeat();
      timerHeartbeat = timers.setInterval(() => {
        const alvo = socket;
        if (alvo === null) return;
        const texto = typeof heartbeatMsg === 'function' ? heartbeatMsg() : heartbeatMsg;
        // `send` pode lancar se o socket fechou entre o tick e agora. Conter:
        // o proprio onclose ja vai tratar a reconexao.
        try {
          alvo.send(texto);
        } catch {
          /* socket fechando; onclose cuida */
        }
      }, heartbeatMs);
    };

    /** Espera desta tentativa: exponencial, limitada pelo teto. */
    const atrasoDaTentativa = (n: number): number => {
      const bruto = initialDelayMs * Math.pow(factor, n);
      // `Math.min` com o teto, e ainda protege de `Infinity`/`NaN` que um factor
      // esquisito produziria — atraso nao-finito congelaria a reconexao.
      const limitado = Math.min(bruto, maxDelayMs);
      return Number.isFinite(limitado) ? limitado : maxDelayMs;
    };

    const agendarReconexao = (): void => {
      if (cancelado || !reconnectEnabled) return;
      if (tentativas >= maxRetries) {
        emitir({ type: 'giveup', attempts: tentativas });
        return;
      }
      const atraso = atrasoDaTentativa(tentativas);
      tentativas += 1;
      emitir({ type: 'reconnecting', attempt: tentativas, delayMs: atraso });
      timerReconexao = timers.setTimeout(() => {
        timerReconexao = null;
        conectar();
      }, atraso);
    };

    const conectar = (): void => {
      if (cancelado) return;

      let novo: WebSocketLike;
      try {
        // A factory ou o buildUrl do consumidor podem lancar. Isso nao pode
        // virar excecao no ciclo de desenho — tratamos como falha de conexao e
        // reagendamos.
        novo = opts.connect(opts.buildUrl(request));
      } catch (e) {
        emitir({ type: 'error', detail: descrever(e) });
        agendarReconexao();
        return;
      }
      socket = novo;

      novo.onopen = (): void => {
        if (cancelado) return;
        // Conexao boa: zera o backoff. A proxima queda recomeca do minimo.
        tentativas = 0;
        emitir({ type: 'open' });

        if (opts.buildSubscribeMessage) {
          try {
            const msg = opts.buildSubscribeMessage(request);
            if (msg !== null) novo.send(msg);
          } catch (e) {
            emitir({ type: 'error', detail: `buildSubscribeMessage: ${descrever(e)}` });
          }
        }

        iniciarHeartbeat();
      };

      novo.onmessage = (event: MessageEventLike): void => {
        if (cancelado) return;
        let extraido: readonly Bar[] | Bar | null;
        try {
          extraido = opts.parseMessage(event.data, request);
        } catch (e) {
          // Parser que lanca nao derruba a assinatura: descarta a mensagem e
          // segue. Frame ruido no meio de um stream vivo e esperado.
          emitir({ type: 'parse-error', detail: descrever(e) });
          return;
        }
        if (extraido === null) return;

        // Entrega na ordem de chegada. Distinguir formando de fechada e do
        // consumidor, por `time` (ver doc do arquivo). O callback do consumidor
        // e contido: se ele lancar, nao pode matar o socket.
        const barras = Array.isArray(extraido) ? extraido : [extraido];
        for (const barra of barras) {
          try {
            onBar(barra);
          } catch {
            /* callback do consumidor lancou; nao e problema do transporte */
          }
        }
      };

      novo.onerror = (event: unknown): void => {
        if (cancelado) return;
        // Erro de socket nao e excecao para nos: e sinal de queda. O onclose
        // costuma vir logo depois; aqui so registramos.
        emitir({ type: 'error', detail: descrever(event) });
      };

      novo.onclose = (event: CloseEventLike): void => {
        pararHeartbeat();
        socket = null;
        if (cancelado) return;
        emitir({ type: 'close', code: event.code, reason: event.reason });
        // Queda vira reconexao, nao exceicao. Este e o ponto do backoff.
        agendarReconexao();
      };
    };

    // Conecta ja, de forma sincrona. O primeiro erro tambem reagenda.
    conectar();

    // A funcao de cancelamento. Idempotente: chamar duas vezes e seguro porque
    // `cancelado` corta todos os caminhos e os timers so sao limpos se existirem.
    return function cancelar(): void {
      if (cancelado) return;
      cancelado = true;
      if (timerReconexao !== null) {
        timers.clearTimeout(timerReconexao);
        timerReconexao = null;
      }
      pararHeartbeat();
      const alvo = socket;
      socket = null;
      if (alvo !== null) {
        // `close` pode lancar se o socket ja estava fechando. Conter: estamos
        // desistindo de qualquer jeito.
        try {
          alvo.close();
        } catch {
          /* ja estava fechando */
        }
      }
    };
  };
}

/** Descreve um valor lancado/evento, sem vazar objeto inteiro para o log. */
function descrever(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  if (e !== null && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o['message'] === 'string') return o['message'];
    if (typeof o['type'] === 'string') return `evento ${o['type']}`;
  }
  return typeof e;
}
