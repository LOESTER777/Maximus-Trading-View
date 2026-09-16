/**
 * @robustus/charts-datafeed — contrato agnostico de fonte de dados.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA QUE ESTE PACOTE RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Na origem, a busca de dado vivia dentro da pagina: a URL do backend estava
 * cravada no componente, o dia era derivado no fuso de Sao Paulo, e a mesclagem
 * do delta acontecia no meio do `useState`. Funciona quando ha um app e um
 * backend. Impede reuso quando ha dois.
 *
 * Este pacote separa QUE dado a biblioteca precisa de COMO obte-lo:
 *
 *   contracts.ts    — o que a biblioteca precisa. Sem URL, sem fetch, sem fornecedor.
 *   market-day.ts   — o dia de pregao no fuso do MERCADO, nao do navegador.
 *   http-depth-*.ts — adaptador de REFERENCIA, com transporte e URL injetados.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO LIGAR SEU BACKEND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O minimo util e uma fonte de barras. Profundidade e opcional, e a maioria das
 * fontes nao tem:
 *
 * ```ts
 * import { ok, fail, type Datafeed } from '@robustus/charts-datafeed';
 *
 * const feed: Datafeed = {
 *   bars: {
 *     async getBars(req, signal) {
 *       const r = await fetch(minhaUrl(req), { signal });
 *       if (!r.ok) return fail(r.status === 404 ? 'INDISPONIVEL' : 'TRANSPORTE');
 *       return ok(await r.json());
 *     },
 *   },
 * };
 * ```
 *
 * Para bookmap, `createHttpDepthSource` cuida de limite de espera, cancelamento
 * e decodificacao; voce fornece transporte e URL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS ARMADILHAS QUE VALEM SABER ANTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Unidade de tempo muda de lado.** `Bar.time` e epoch em SEGUNDOS (convencao do
 * substrato de grafico); `DepthGridRequest.day` e rotulo de calendario; e o grid
 * decodificado usa MILISSEGUNDOS nos eixos. Nao e inconsistencia por descuido —
 * cada fronteira herda a unidade de quem esta do outro lado. Por isso cada campo
 * declara a sua.
 *
 * **Profundidade historica e raridade.** Provedor de livro costuma manter estado
 * so em memoria, sem persistencia — o provedor MBO que a origem integrou e assim.
 * Nesses casos bookmap existe ao vivo ou gravado a partir de agora, nunca
 * retroativo. Se bookmap historico importa, o gravador precisa existir ANTES:
 * livro que nao foi gravado nao volta.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Contrato
// ═════════════════════════════════════════════════════════════════════════════
export {
  ok,
  fail,
  hasBars,
  hasDepth,
} from './contracts.js';

export type {
  Datafeed,
  FeedResult,
  Ok,
  Fail,
  FailureCause,
  InstrumentRef,
  Bar,
  BarsRequest,
  BarsCapability,
  DepthGridRequest,
  DepthCapability,
} from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// Dia de mercado
// ═════════════════════════════════════════════════════════════════════════════
export {
  marketDayOf,
  isCurrentMarketDay,
  isValidMarketDay,
  marketDayLabel,
  shiftMarketDay,
  DEFAULT_MARKET_TIME_ZONE,
} from './market-day.js';

// ═════════════════════════════════════════════════════════════════════════════
// Adaptador de referencia — profundidade sobre HTTP
// ═════════════════════════════════════════════════════════════════════════════
export {
  createHttpDepthSource,
  DEPTH_TIMEOUT_MS_DEFAULT,
} from './http-depth-source.js';

export type {
  FetchLike,
  DepthUrlBuilder,
  HttpDepthSourceOptions,
} from './http-depth-source.js';

// ═════════════════════════════════════════════════════════════════════════════
// Adaptador de referencia — barras sobre HTTP
// ═════════════════════════════════════════════════════════════════════════════
export {
  createHttpBarsSource,
  parseBarsDefault,
  BARS_TIMEOUT_MS_DEFAULT,
} from './http-bars-source.js';

export type {
  BarsUrlBuilder,
  BarsParser,
  HttpBarsSourceOptions,
} from './http-bars-source.js';

// ═════════════════════════════════════════════════════════════════════════════
// Adaptador de referencia — barras ao vivo sobre WebSocket
// ═════════════════════════════════════════════════════════════════════════════
export {
  createWsBarsSource,
  WS_RECONNECT_INITIAL_MS_DEFAULT,
  WS_RECONNECT_MAX_MS_DEFAULT,
  WS_RECONNECT_FACTOR_DEFAULT,
  WS_HEARTBEAT_MESSAGE_DEFAULT,
} from './ws-bars-source.js';

export type {
  WebSocketLike,
  WebSocketFactory,
  MessageEventLike,
  CloseEventLike,
  WsMessageParser,
  WsSubscribeMessageBuilder,
  WsBarsSourceOptions,
  ReconnectOptions,
  HeartbeatOptions,
  TimerLike,
  WsBarsEvent,
} from './ws-bars-source.js';

// ═════════════════════════════════════════════════════════════════════════════
// Agregacao pura — trades -> barras, e rollup de barras
// ═════════════════════════════════════════════════════════════════════════════
export {
  aggregateTrades,
  rollupBars,
} from './aggregator.core.js';

export type {
  Trade,
} from './aggregator.core.js';
