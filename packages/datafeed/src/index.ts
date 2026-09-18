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

// ═════════════════════════════════════════════════════════════════════════════
// Vocabulario de PERIODO (timeframe)
// ═════════════════════════════════════════════════════════════════════════════
//
// ⭐ Fecha o "grafico esta sem selecao de TF": a lista canonica, os rotulos e as
// perguntas que um seletor precisa fazer (o que da para agregar do dado que eu tenho?).
// Segundos sao a verdade; rotulo e apresentacao — ver o cabecalho do arquivo.
export {
  TIMEFRAMES,
  timeframePorId,
  timeframePorSegundos,
  podeAgregar,
  timeframesAgregaveisDe,
  proximoTimeframe,
  timeframeAnterior,
  barrasPorBalde,
} from './timeframe.core.js';

export type { Timeframe } from './timeframe.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// A fonte de barras da MESA (histórico real: WIN desde 2005, WDO, BTC, 33 ações)
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ O dialeto é PURO e exportado separado do transporte de propósito: quem quiser usar
// outro cliente HTTP reusa `montarCaminhoDeBarras` + `parseBarrasDaMesa` sem herdar o
// `fetch` injetado, e quem só quer barras chama `criarFonteDeBarrasDaMesa`.

export {
  montarCaminhoDeBarras,
  parseBarrasDaMesa,
  escolherDoParDiario,
  janelaDeBackfill,
  janelaAnterior,
  alcancouInicio,
  periodosDisponiveis,
  rotuloDePeriodo,
  simboloAceito,
  agressorUtilizavel,
  COBERTURA_MINIMA_DE_AGRESSOR,
  PERIODOS_DA_MESA,
  /**
   * ⭐⭐ O par compra/venda cobre o volume o suficiente para o delta valer?
   *
   * Auditado contra o serviço da mesa: 5min e 15min têm 100% de cobertura, mas a agregação de
   * 1h e D1 soma o volume inteiro e só parte do agressor — em junho de 2026, 37,8% de
   * cobertura em D1. Delta apurado sobre um terço do volume inverte de sinal.
   */
  agressorUtilizavel as aggressorIsUsable,
  /** Monta o caminho da consulta de barras; `null` quando o pedido nao e atendivel. */
  montarCaminhoDeBarras as buildDeskBarsPath,
  /** Le o corpo colunar da API; `null` = contrato quebrado. */
  parseBarrasDaMesa as parseDeskBars,
  /** A janela do proximo lote de backfill, andando para tras. */
  janelaDeBackfill as backfillWindow,
  /** A janela ANTERIOR a uma ja pedida — e o que faz lote vazio nao empacar a caminhada. */
  janelaAnterior as previousWindow,
  /** A janela alcancou o inicio conhecido da serie? Lote vazio NAO e fim de historico. */
  alcancouInicio as reachedSeriesStart,
  /** Os periodos que a base REALMENTE tem, em segundos. */
  periodosDisponiveis as deskPeriods,
  /** Qual dos dois registros diarios do mesmo pregao fica. */
  escolherDoParDiario as pickFromDailyPair,
} from './robustus-bars.core.js';

export type { OpcoesDeLeituraDaMesa } from './robustus-bars.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ QUALIDADE DA FONTE — o que a fonte sabe sobre os próprios defeitos, como DADO
// ═════════════════════════════════════════════════════════════════════════════
//
// As guardas anteriores olham para UMA barra (`agressorUtilizavel`) ou para UM par de
// fontes (`medirCoerencia`). Esta olha para o TRECHO: *este histórico é confiável?*
//
// ⚠️ A resposta não é dedutível do dado — é conhecimento sobre a ingestão, e chega de
// fora. `PerfilDeQualidade` é o formato dele, e é um VALOR passado por argumento:
// `PERFIL_DA_MESA` é o desta base, e outro projeto passa o seu.

export {
  avaliarQualidade,
  intervaloTocaSessao,
  filtrarDiasSemPregao,
  PERFIL_DA_MESA,
  SESSAO_B3_FUTUROS,
  SESSAO_B3_ACOES,
  SESSAO_24_7,
  /** Confronta as barras carregadas com o que se sabe da fonte. Nunca recusa: devolve laudo. */
  avaliarQualidade as assessDataQuality,
  /** O intervalo da barra toca alguma sessao de mercado? */
  intervaloTocaSessao as barTouchesSession,
  /** Remove barras que nao sao de pregao nenhum (15 domingos no D1 do WIN; 948 legitimos no BTC). */
  filtrarDiasSemPregao as dropNonTradingDays,
} from './qualidade-da-fonte.core.js';

export type {
  PerfilDeQualidade,
  LaudoDeQualidade,
  SessaoDeMercado,
  RegraDePeriodo,
  JanelaAferida,
} from './qualidade-da-fonte.core.js';

export { criarFonteDeBarrasDaMesa } from './robustus-bars-source.js';
export type { FonteDeBarrasDaMesaOptions } from './robustus-bars-source.js';
export {
  /** Constroi a capacidade de barras contra a API de barras da mesa. */
  criarFonteDeBarrasDaMesa as createDeskBarsSource,
} from './robustus-bars-source.js';

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ A bridge MT5 — o DIA CORRENTE, e a COSTURA com o histórico
// ═════════════════════════════════════════════════════════════════════════════
//
// O arquivo da mesa é alimentado por um top-up que roda DEPOIS do pregão. Medido em
// 17/09/2026 às 16:33 BRT: arquivo = 0 barras de hoje, bridge MT5 = 91 barras (09:00 →
// 16:30). Ou seja, exatamente durante o horário em que alguém olha o gráfico, o arquivo
// está em D-1. Cotação ao vivo é outra capacidade, e vem do terminal.
//
// ⚠️ `OFFSET_CANDLES_MT5_SEGUNDOS` é o achado que mais importa aqui: o `timestamp` da
// bridge NÃO é epoch UTC, e sem a correção o gráfico mostra preço PLAUSÍVEL três horas
// deslocado. Ver a medição no cabeçalho de `mt5-bridge.core.ts`.

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ A EMENDA de duas fontes — AGNÓSTICA de quem são elas
// ═════════════════════════════════════════════════════════════════════════════
//
// ⭐ Vive em `splice-series.core.ts` e não tem uma linha de MT5. A pergunta que ela responde é
// geral: *"tenho um ARQUIVO com o passado e uma fonte AO VIVO com o presente; como faço UMA
// série sem mentir?"*. Vale para Cedro, PNT, Binance, WebSocket próprio ou qualquer par.
//
// ⚠️ Tudo que é decisão do consumidor entra por parâmetro: `precedencia` (quem manda no empate),
// `toleranciaDeSegundos` (calendário é do mercado) e `alinhamentoPorBalde` (fontes que viram o
// dia em fusos diferentes).
export {
  emendarSeries,
  UM_DIA_EM_SEGUNDOS,
  /** ⭐⭐ Emenda duas fontes numa série única, declarando lacuna e barra em formação. */
  emendarSeries as spliceSeries,
} from './splice-series.core.js';

export type {
  SerieEmendada,
  OpcoesDaEmenda,
  PrecedenciaDaEmenda,
} from './splice-series.core.js';

export {
  epochRealDoMt5,
  epochParaMt5,
  rotuloDePeriodoMt5,
  periodoSuportadoPorAmbas,
  contratoVigenteNaDescricao,
  resolverContratoVigente,
  montarCaminhoDeCandlesMt5,
  parseCandlesDoMt5,
  OFFSET_CANDLES_MT5_SEGUNDOS,
  MAX_BARRAS_POR_CONSULTA_MT5,
  MAX_DIAS_FLUXO_MT5,
  PERIODOS_DA_BRIDGE_MT5,
  /** Corrige o `timestamp` da bridge para epoch real — a unidade errada não deve circular. */
  epochRealDoMt5 as mt5TimestampToEpoch,
  /** O inverso: epoch real para o `timestamp` que a bridge entende. */
  epochParaMt5 as epochToMt5Timestamp,
  /** O rótulo de período da bridge (ela tem 1m e 30m, que o arquivo não tem). */
  rotuloDePeriodoMt5 as mt5TimeframeLabel,
  /** O período existe nas DUAS fontes? `false` significa "avise", não "recuse". */
  periodoSuportadoPorAmbas as periodSupportedByBoth,
  /** Resolve a raiz (`WIN`) no contrato vigente (`WINV26`) pela descrição publicada. */
  resolverContratoVigente as resolveActiveContract,
} from './mt5-bridge.core.js';

// ⚠️ `SerieEmendada` NÃO sai daqui: ela pertence a `splice-series.core.js`, que é agnóstico de
// fonte. Reexportá-la pelo adaptador do MT5 sugeriria que a emenda é um recurso dele.
export type { SimboloDaBridge, OpcoesDeLeituraMt5 } from './mt5-bridge.core.js';

export {
  criarFonteDeBarrasDoMt5,
  resolverContratoDaBridge,
  bridgeConectada,
} from './mt5-bridge-source.js';
export type { FonteDeBarrasDoMt5Options } from './mt5-bridge-source.js';
export {
  /** Constroi a capacidade de barras AO VIVO contra a bridge MT5. */
  criarFonteDeBarrasDoMt5 as createMt5BarsSource,
  /** Pergunta a bridge qual contrato esta negociando para uma raiz. */
  resolverContratoDaBridge as fetchActiveContract,
  /** A bridge esta de pe e o terminal conectado? */
  bridgeConectada as isBridgeConnected,
} from './mt5-bridge-source.js';
