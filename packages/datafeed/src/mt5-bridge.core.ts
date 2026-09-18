/**
 * mt5-bridge.core — o DIALETO da bridge MT5 da mesa, e a COSTURA com o histórico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO, E POR QUE ELE É NECESSÁRIO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"os dados históricos são da base de histórico, mas os dados reais do mini índice tem de
 * vir do mt5 direto. histórico é onde vc pegou + o dia atual é sempre do mt5"*
 *
 * ⭐ E a lacuna é MEDIDA, não suposta. Em 17/09/2026 às 16:33 BRT, contra os dois serviços:
 *
 * | fonte | barras de HOJE (17/09) | barras de ONTEM (16/09) |
 * |---|---|---|
 * | `bars_api` (histórico, Postgres da máquina B) | **0** | 114 |
 * | bridge MT5 (`:8229`) | **91** (09:00 → 16:30 BRT) | 500 no lote |
 *
 * O histórico da máquina B é alimentado por um top-up que roda **depois** do pregão. Então
 * durante o dia inteiro de operação o gráfico ficava parado em D-1: exatamente o horário em
 * que alguém olha o gráfico é o horário em que ele não tem dado. Não é defeito do arquivo —
 * é o que um arquivo é. Cotação ao vivo é outra capacidade, e ela vem do terminal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA NÃO COMETER: O FUSO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A bridge devolve `timestamp` que **NÃO é epoch UTC** — é o frame do servidor da corretora, e
 * ele está **3 h à frente**. A correção é `OFFSET_CANDLES_MT5_SEGUNDOS = −10800`, aferida por
 * correlação cruzada sobre um pregão inteiro (114 barras) e confirmada pela razão de volume
 * entre as fontes ser exatamente **1,000**.
 *
 * ⭐ **É o pior tipo de defeito: o preço no horário errado é PLAUSÍVEL.** Um valor deslocado
 * seis horas continua sendo um preço possível para o WIN — só não é o daquele instante. Nada
 * lança, nada fica vazio, e a única coisa que denuncia é cruzar as duas fontes.
 *
 * ⚠️⚠️ **E este arquivo já errou o SINAL dessa constante.** A primeira medição usou três barras
 * e casou por coincidência. Leia a nota de `OFFSET_CANDLES_MT5_SEGUNDOS` antes de mexer em
 * qualquer coisa relacionada a tempo aqui: a lição de método vale mais que o número.
 *
 * A diferença residual de ~12 a 19 pontos entre as fontes alinhadas **não** é erro: é `WINV26`
 * (contrato com vencimento, o que o MT5 cota) contra `WIN` (série contínua ajustada, o que o
 * arquivo guarda). Ver a decisão 2 de `emendarSeries` sobre por que isso proíbe usar o terminal
 * para passado profundo.
 *
 * ⚠️ Medido para `/candles`, `/historical` e `/historical-flow`. **Não** foi medido para o
 * stream WebSocket de tick nem para `/orderbook` — a bridge pode ser inconsistente entre rotas,
 * e afirmar sem medir é exactamente como este defeito nasceu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PURO, E O QUE ISSO CUSTOU DE PROPÓSITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ `.core` = sem `fetch`, sem relógio, sem `URL` global, sem estado de módulo. O "agora"
 * entra por parâmetro em toda função que precisaria dele. É o que permite testar a costura —
 * a parte que de fato pode corromper um gráfico — sem rede e sem esperar o pregão abrir.
 */

import type { Bar, BarsRequest } from './contracts.js';
import { agressorUtilizavel } from './robustus-bars.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// O fuso
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ Segundos a SOMAR no `timestamp` do REST da bridge para obter epoch real. É **POSITIVO**.
 *
 * O `timestamp` da bridge é o epoch de um relógio que marca **hora de Brasília**: formatado como
 * se fosse UTC, ele já mostra o horário local correto. Para virar epoch UTC de verdade, soma-se
 * 3 h (09:00 BRT = 12:00 UTC).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ ESTA CONSTANTE JÁ TROCOU DE SINAL DUAS VEZES. LEIA ANTES DE MEXER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Tentativa 1 — `+10800`, por acidente.** Aferido com UMA janela de 15 min e TRÊS barras. O
 * valor estava certo, mas a medição não provava nada: o WIN oscilou pouco e barras distantes
 * tinham preço parecido.
 *
 * **Tentativa 2 — `−10800`, e ERRADO.** Refiz por correlação cruzada e escolhi o deslocamento de
 * **menor erro médio de fechamento**. `−10800` deu 12 pts contra 195 pts do `+10800`, e a razão
 * de volume deu exatamente 1,000. Parecia definitivo. **Foi o pior erro desta biblioteca**, e o
 * operador o pegou olhando o gráfico e dizendo *"o fuso está errado"*.
 *
 * ⛔ **O defeito de método: eu premiei o SUBCONJUNTO.** O critério de menor erro ignorava QUANTAS
 * barras casavam:
 *
 * ```
 * offset    pares casados   % do pregão   erro médio
 * −10800         41             36 %        12,0 pts   ← escolhido, e errado
 * +10800        113             99 %       203,1 pts   ← correto
 * ```
 *
 * Com `−10800` as duas séries só se sobrepõem numa faixa estreita de 3 h 20 (a interseção
 * artificial entre um pregão deslocado e o outro), e 41 barras escolhidas por coincidência de
 * horário podem ter preços parecidos. **Cobertura vem antes de erro:** um alinhamento que
 * explica 36 % do dia não é um alinhamento.
 *
 * ── AS TRÊS MEDIÇÕES QUE FIXAM `+10800`, e são independentes ──────────────
 *
 * **1. A JANELA DO PREGÃO.** O WIN negocia 09:00–18:25 BRT. É um fato público e verificável, e
 * não depende de comparar com nenhuma outra fonte:
 *
 * ```
 * timestamp cru + 10800, em BRT :  09:00 → 18:20   ✓ é o pregão
 * timestamp cru − 10800, em BRT :  03:00 → 12:20   ✗ impossível
 * ```
 *
 * **2. A RAZÃO DE VOLUME contra o arquivo:** 1,028 na mesma barra. Volume é assinatura.
 *
 * **3. A MÍNIMA DO DIA, conferida contra a TELA DO TERMINAL.** No gráfico do MT5 de 17/09 a
 * queda violenta está entre as marcas de 09:30 e 10:50. Com `+10800`, a mínima (`low` 184.465)
 * cai às **10:40 BRT** — dentro da faixa. Com `−10800` cairia às 04:40, quando não há mercado.
 *
 * ── O QUE APRENDER, e vale para qualquer aferição de tempo ────────────────
 *
 * ⛔ **Não escolha alinhamento por erro médio sem exigir COBERTURA.** Ordene por pares casados
 * primeiro; só entre os que explicam quase toda a série, compare o erro.
 *
 * ⭐ **Prefira uma âncora EXTERNA e verificável a comparar duas fontes.** O horário de
 * funcionamento do mercado é um fato; "qual das duas séries está certa" é uma pergunta que duas
 * fontes erradas do mesmo jeito respondem em coro.
 *
 * ⚠️ O número coincide com 3 h mas **não é o fuso de Brasília calculado** — é o frame do relógio
 * do servidor. Não derive de `Intl` nem aplique horário de verão.
 *
 * ⚠️ Medido para `/candles`, `/historical` e `/historical-flow`. **Não** foi medido para o
 * WebSocket de tick nem para `/orderbook`.
 */
export const OFFSET_CANDLES_MT5_SEGUNDOS = 10_800;

/**
 * Converte o `timestamp` da bridge em epoch real (segundos).
 *
 * Existe como função nomeada, e não como `t + 10800` espalhado, para haver **um** lugar onde
 * a correção acontece. Duas cópias divergem na primeira vez que alguém "simplifica" uma
 * delas, e o sintoma é um gráfico correto em algumas telas e deslocado em outras.
 */
export function epochRealDoMt5(
  timestampDaBridge: number,
  offsetSegundos: number = OFFSET_CANDLES_MT5_SEGUNDOS,
): number {
  return timestampDaBridge + offsetSegundos;
}

/**
 * O inverso: epoch real → o `timestamp` que a bridge entende.
 *
 * ⭐ Necessário para PEDIR janela. Mandar epoch real num filtro de tempo da bridge pediria
 * três horas adiante — em pregão, isso volta vazio e parece "o ativo não negociou".
 */
export function epochParaMt5(
  epochReal: number,
  offsetSegundos: number = OFFSET_CANDLES_MT5_SEGUNDOS,
): number {
  return epochReal - offsetSegundos;
}

// ═════════════════════════════════════════════════════════════════════════════
// O dialeto de período
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Períodos da bridge, de segundos para o rótulo dela.
 *
 * ⭐ **A bridge tem M1 e M30, que o arquivo histórico NÃO tem.** O terminal calcula os
 * períodos a partir do próprio feed, então não há a limitação de materialização da base. Isso
 * significa que, com o MT5 ligado, o playground pode oferecer M1 para o dia corrente — algo
 * que era impossível antes.
 *
 * ⚠️ E é justamente por isso que os dois mapas continuam SEPARADOS (`PERIODOS_DA_MESA` no
 * outro núcleo). Fundir num só mapa faria a interface oferecer M1 e depois mostrar só o dia
 * de hoje, sem histórico, sem explicar por quê. Cada fonte declara o que ela tem; quem
 * concilia é `periodoSuportadoPorAmbas`.
 */
export const PERIODOS_DA_BRIDGE_MT5: ReadonlyMap<number, string> = new Map([
  [60, '1m'],
  [300, '5m'],
  [900, '15m'],
  [1800, '30m'],
  [3600, '1h'],
  [14_400, '4h'],
  [86_400, '1d'],
  [604_800, '1w'],
]);

/** O rótulo da bridge para um período, ou `null` quando ela não o tem. */
export function rotuloDePeriodoMt5(segundos: number): string | null {
  return PERIODOS_DA_BRIDGE_MT5.get(segundos) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// ⭐ A resolução do CONTRATO vigente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Extrai o contrato vigente da DESCRIÇÃO de um símbolo contínuo do MT5.
 *
 * ⭐⭐ **Este é o jeito certo, e ele evita um defeito de 3.400 pontos que já aconteceu.**
 *
 * O contrato do mini índice vira a cada dois meses (`WINQ26` → `WINV26` → …). A forma óbvia
 * de saber qual está vigente é calcular pela DATA — e o projeto de origem fez isso, e pagou:
 * em 12/08/2026 o mercado migrou para `WINV26` **antes** da data de virada teórica, e o
 * pipeline ficou lendo `WINQ26`, um contrato que já não tinha liquidez. O gráfico mostrava
 * preço, e o preço estava 3.400 pontos fora do mercado.
 *
 * ⭐ A informação não precisa ser calculada: **o MT5 já a publica**. A descrição do símbolo
 * contínuo `WIN$` é, literalmente:
 *
 * ```
 * IBOVESPA MINI - Por Liquidez (WINV26) - Ajuste Proporcional
 * ```
 *
 * Quem decide é a corretora, que sabe onde está a liquidez hoje. Ler o parêntese é preferir
 * o fato à dedução — e o fato chega de graça, na mesma resposta que lista os símbolos.
 *
 * ⚠️ Devolve `null`, nunca um palpite, quando a descrição não traz o padrão. `null` significa
 * "não sei" e faz o chamador cair no fallback declarado; um palpite viraria consulta a um
 * contrato inexistente, que a bridge responde com lista vazia — indistinguível de "hoje não
 * negociou".
 */
export function contratoVigenteNaDescricao(descricao: string): string | null {
  // ⚠️ Ancorado em "por liquidez" de propósito, e sem acento na comparação: a descrição vem
  // em pt-BR do terminal, e há outros parênteses possíveis num nome de instrumento. Casar
  // qualquer parêntese pegaria "(Ajuste Proporcional)" num dia em que a ordem mudasse.
  const semAcento = descricao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!semAcento.includes('por liquidez')) return null;
  const m = /\(([A-Z]{3}[A-Z0-9]{1,6})\)/.exec(descricao.toUpperCase());
  return m?.[1] ?? null;
}

/** Um símbolo como a bridge o lista em `/symbols/search`. */
export interface SimboloDaBridge {
  readonly name: string;
  readonly description?: string;
  readonly visible?: boolean;
}

/**
 * Resolve a RAIZ (`WIN`) no contrato que está negociando (`WINV26`).
 *
 * A ordem de preferência é deliberada:
 *
 * 1. ⭐ A **descrição do contínuo** (`WIN$`, `WIN$N`, `WIN@`) — é a corretora dizendo onde
 *    está a liquidez. Ver `contratoVigenteNaDescricao`.
 * 2. O contrato **explícito** já pedido: se o chamador passou `WINV26`, respeita e devolve.
 * 3. `null`.
 *
 * ⚠️ **Não há passo "escolher o de maior volume"** aqui, e a ausência é proposital: volume é
 * dado de mercado, não de catálogo, e buscá-lo custaria uma consulta por contrato candidato.
 * O passo 1 já é a resposta por liquidez, publicada de graça. Se um dia o passo 1 falhar de
 * forma sistemática, a sonda por volume é o próximo recurso — mas ela pertence à camada com
 * I/O, não a um núcleo puro.
 *
 * ⚠️ Devolve `null` em vez de chutar `RAIZ + mês corrente`: um contrato inventado responde
 * vazio, e vazio é indistinguível de "não houve pregão". Melhor recusar e dizer.
 */
export function resolverContratoVigente(
  simbolos: readonly SimboloDaBridge[],
  raiz: string,
): string | null {
  const R = raiz.toUpperCase();

  // 1) O contínuo da mesma raiz, com o contrato na descrição.
  for (const s of simbolos) {
    const nome = s.name.toUpperCase();
    const ehContinuoDaRaiz = nome === `${R}$` || nome === `${R}$N` || nome === `${R}$D` || nome === `${R}@`;
    if (!ehContinuoDaRaiz) continue;
    const achado = contratoVigenteNaDescricao(s.description ?? '');
    if (achado !== null && achado.startsWith(R)) return achado;
  }

  // 2) A raiz JÁ é um contrato específico (`WINV26`): quem pediu sabe o que quer.
  if (/^[A-Z]{3}[A-Z]\d{2}$/.test(R) && simbolos.some((s) => s.name.toUpperCase() === R)) {
    return R;
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// A URL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ Teto de barras por consulta à bridge.
 *
 * O terminal tem `maxbars` (10.000 no perfil medido), mas o gargalo prático é outro: a bridge
 * serializa a resposta inteira em JSON e roda **dentro do Wine**, no mesmo processo que
 * alimenta o robô que opera. Pedir dez mil barras para desenhar uma tela é gastar o recurso de
 * quem está operando de verdade.
 *
 * 1.500 cobre com folga o dia corrente em qualquer período usável (um pregão de 8 h tem 96
 * barras de 5min, 480 de 1min) e é o que este adaptador precisa — o passado profundo é
 * trabalho do arquivo, que existe exatamente para isso.
 */
export const MAX_BARRAS_POR_CONSULTA_MT5 = 1500;

/**
 * ⚠️ Teto de DIAS em `/historical-flow`. O servidor recusa acima de 90 (`le=90`).
 *
 * ⭐ E o default útil é **1**: o dia corrente é tudo o que esta fonte deve buscar. Ver a
 * medição de custo em `montarCaminhoDeCandlesMt5`.
 */
export const MAX_DIAS_FLUXO_MT5 = 90;

/**
 * O caminho da consulta. `null` quando o pedido não é atendível.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ AS DUAS ROTAS TÊM PARÂMETROS DIFERENTES — E CONFUNDI-LOS É CARO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * | rota | recorte | custo medido (WIN 5min) | traz agressor? |
 * |---|---|---|---|
 * | `/candles` | **`limit`** (n últimas barras) | **0,7 s** / 700 barras | não |
 * | `/historical-flow` | **`days`** (default 30, teto 90) | **7,0 s** / 95 barras | **sim** |
 *
 * ⚠️ **Defeito real que este comentário existe para não repetir:** a primeira versão deste
 * arquivo mandava `limit` para as DUAS rotas. Em `/historical-flow` o `limit` é simplesmente
 * ignorado, e a rota caía no default de **30 dias** — trinta dias de tick reclassificados por
 * Lee-Ready a cada consulta. Medido: passou de 60 s e estourou o tempo limite. Não dava erro
 * de parâmetro; só ficava lento.
 *
 * E o custo não é do playground: a bridge roda **dentro do Wine, no mesmo terminal que
 * alimenta o robô que opera**. Um polling de 15 s disparando uma consulta de 7 s ocuparia
 * metade do tempo de um recurso compartilhado com a operação. Por isso `dias` é explícito, o
 * teto existe, e quem liga o fluxo tem de espaçar o polling.
 *
 * ⚠️ **`from_ts`/`to_ts` existem na rota e NÃO funcionam** — medido nos dois frames de tempo
 * (epoch real e epoch da bridge), as duas tentativas devolveram lista vazia em 30 ms. Então
 * `fromSeconds`/`toSeconds` do contrato **não** viram parâmetro de URL em nenhuma das rotas;
 * quem recorta é `parseCandlesDoMt5`, no cliente.
 *
 * ⚠️ É também a razão de esta fonte **não** servir para backfill profundo: as duas rotas
 * entregam o RABO da série (as últimas N barras, os últimos N dias). Pedir 2019 aqui baixaria
 * de hoje para trás até 2019. Passado profundo é trabalho do arquivo, que é indexado.
 */
export function montarCaminhoDeCandlesMt5(
  request: BarsRequest,
  opcoes?: { readonly comFluxo?: boolean; readonly dias?: number },
): string | null {
  const rotulo = rotuloDePeriodoMt5(request.periodSeconds);
  if (rotulo === null) return null;

  const symbol = request.instrument.symbol;
  // O MT5 aceita `$` e `@` no nome (são os contínuos), ao contrário do `bars_api`. A guarda
  // aqui é contra caminho/consulta injetados, não contra o dialeto de símbolo.
  if (symbol.length === 0 || /[/?#&\s]/.test(symbol)) return null;

  const tf = `timeframe=${encodeURIComponent(rotulo)}`;

  // ⭐ `/historical-flow` devolve o MESMO OHLC mais `buy_volume`/`sell_volume` classificados
  // pelo terminal (agressor REAL, não Lee-Ready estimado por nós). É o insumo de delta, CVD e
  // footprint — e o playground já sabe consumir isso pela barra.
  if (opcoes?.comFluxo === true) {
    const dias = Math.min(MAX_DIAS_FLUXO_MT5, Math.max(1, Math.floor(opcoes.dias ?? 1)));
    return `/historical-flow/${encodeURIComponent(symbol)}?${tf}&days=${dias}`;
  }

  const limite = Math.min(
    MAX_BARRAS_POR_CONSULTA_MT5,
    Math.max(1, Math.ceil(request.limit ?? MAX_BARRAS_POR_CONSULTA_MT5)),
  );
  return `/candles/${encodeURIComponent(symbol)}?${tf}&limit=${limite}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// A leitura da resposta
// ═════════════════════════════════════════════════════════════════════════════

/** Número finito, ou `undefined`. `null` da fonte é "não sei" — nunca zero. */
function numeroOuAusente(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Converte a resposta da bridge em barras, **já com o fuso corrigido**.
 *
 * ⚠️ A correção acontece AQUI, na fronteira, e não no consumidor. É a mesma disciplina do
 * resto da biblioteca: a unidade errada não deve circular por dentro nem por um passo. Se o
 * ajuste fosse tarefa de quem consome, bastaria um caminho esquecer para o gráfico deslocar.
 *
 * ⚠️ Devolve `null` só para contrato QUEBRADO (não é lista). Lista vazia devolve `[]`, porque
 * "o pregão não abriu" é resposta legítima e frequente — colapsar as duas faria mudança de
 * formato no backend parecer feriado, e o defeito viveria meses.
 *
 * `janela` é opcional e recorta no cliente (a rota não filtra por tempo).
 */
/**
 * ⭐⭐ Opções de leitura — tudo o que era constante de módulo e agora é do CONSUMIDOR.
 *
 * ⚠️ **A razão é que outro projeto lê de outra fonte.** Os defaults foram MEDIDOS contra uma
 * bridge específica, e não há motivo para outra corretora, outra instalação ou outro fornecedor
 * concordarem com eles. Constante de módulo que o consumidor não pode mudar transforma uma
 * medição local em lei universal.
 */
export interface OpcoesDeLeituraMt5 {
  /** Recorte da janela, em epoch REAL de segundos (a rota não filtra por tempo). */
  readonly deSegundos?: number;
  readonly ateSegundos?: number;
  /**
   * Segundos a somar no `timestamp` da fonte. Default `OFFSET_CANDLES_MT5_SEGUNDOS` (-10800).
   *
   * ⚠️⚠️ **O default vale para a bridge que foi MEDIDA.** Outro servidor, outro frame de tempo —
   * e o sinal errado desloca o gráfico em horas com preço PLAUSÍVEL, que é o defeito mais caro
   * que esta biblioteca já teve. Quem monta contra outra fonte DEVE aferir por correlação
   * cruzada sobre uma série inteira e passar o valor aqui, em vez de herdar uma medição alheia.
   */
  readonly offsetSegundos?: number;
  /**
   * Fração mínima do volume classificada por agressor. Default
   * `COBERTURA_MINIMA_DE_AGRESSOR` (0,9).
   *
   * ⚠️ Parametrizado porque a qualidade da classificação é da FONTE. Uma que informe agressor
   * real merece limiar alto; uma que estime por Lee-Ready num mercado com leilão frequente
   * talvez precise de limiar mais frouxo — e quem sabe disso é quem escolheu a fonte.
   */
  readonly coberturaMinimaDeAgressor?: number;
}

export function parseCandlesDoMt5(
  body: unknown,
  opcoes?: OpcoesDeLeituraMt5,
): readonly Bar[] | null {
  if (!Array.isArray(body)) return null;

  const de = opcoes?.deSegundos;
  const ate = opcoes?.ateSegundos;
  // ⚠️ Com o valor medido nesta bridge como DEFAULT, mas SEMPRE sobreponível. Ver
  // `OpcoesDeLeituraMt5`.
  const offset = opcoes?.offsetSegundos ?? OFFSET_CANDLES_MT5_SEGUNDOS;
  const coberturaMinima = opcoes?.coberturaMinimaDeAgressor;

  const barras: Bar[] = [];
  let ultimoTempo = -Infinity;

  for (const cru of body) {
    if (typeof cru !== 'object' || cru === null) return null;
    const c = cru as Record<string, unknown>;

    const tsBridge = numeroOuAusente(c['timestamp']);
    const open = numeroOuAusente(c['open']);
    const high = numeroOuAusente(c['high']);
    const low = numeroOuAusente(c['low']);
    const close = numeroOuAusente(c['close']);
    // Barra com OHLC incompleto é PULADA, não rejeita o lote: uma barra ruim não pode apagar
    // o resto da tela. Mesma decisão de `parseBarrasDaMesa`.
    if (tsBridge === undefined || open === undefined || high === undefined) continue;
    if (low === undefined || close === undefined) continue;

    const time = epochRealDoMt5(tsBridge, offset);
    if (de !== undefined && time < de) continue;
    if (ate !== undefined && time >= ate) continue;
    // Tempo não crescente quebra o eixo do motor em três lugares (`update` trata tempo igual
    // como mesma barra, `timeToIndex` resolve para o primeiro índice, e os rótulos do eixo).
    if (!(time > ultimoTempo)) continue;
    ultimoTempo = time;

    const volume = numeroOuAusente(c['volume']);
    const compraCrua = numeroOuAusente(c['buy_volume']);
    const vendaCrua = numeroOuAusente(c['sell_volume']);

    // ⭐⭐ A MESMA guarda de cobertura do adaptador do arquivo, e pelo mesmo motivo: delta
    // apurado sobre parte do volume não é uma medida imprecisa, é outra medida — e ela inverte
    // de sinal, porque a parte não classificada não é neutra. Ver
    // `COBERTURA_MINIMA_DE_AGRESSOR` em `robustus-bars.core.ts` para a auditoria que fixou o
    // limiar.
    //
    // ⚠️ Aplicada aqui TAMBÉM, e não só no arquivo, porque a classificação do terminal é
    // Lee-Ready sobre o tape e pode degradar do mesmo jeito num dia de leilão longo ou de
    // feed instável. Uma guarda que vale para uma fonte e não para a outra é uma guarda que
    // vai ser esquecida na próxima fonte.
    const usaAgressor = agressorUtilizavel(volume, compraCrua, vendaCrua, coberturaMinima);
    const buyVolume = usaAgressor ? compraCrua : undefined;
    const sellVolume = usaAgressor ? vendaCrua : undefined;

    barras.push({
      time,
      open,
      high,
      low,
      close,
      ...(volume === undefined ? {} : { volume }),
      // ⚠️ Os DOIS lados ou nenhum. Um lado sozinho seria o volume total disfarçado de
      // desequilíbrio — leitura invertida na melhor hipótese.
      ...(buyVolume === undefined || sellVolume === undefined ? {} : { buyVolume, sellVolume }),
    });
  }

  return barras;
}

/**
 * O período é suportado pelas DUAS fontes?
 *
 * ⭐ É a pergunta que a interface tem de fazer antes de oferecer um período. A bridge tem M1 e
 * M30; o arquivo não. Oferecer M1 sem dizer nada entregaria um gráfico com o dia de hoje e
 * **nenhum** passado, e o operador leria isso como falha da ferramenta.
 *
 * ⚠️ `false` não significa "não use": significa "avise". Um período só do MT5 é legítimo para
 * quem quer o intradiário fino — só não pode ser silencioso.
 */
export function periodoSuportadoPorAmbas(
  segundos: number,
  periodosDoHistorico: ReadonlyMap<number, string>,
): boolean {
  return rotuloDePeriodoMt5(segundos) !== null && periodosDoHistorico.has(segundos);
}

// ═════════════════════════════════════════════════════════════════════════════
// A emenda — REEXPORTADA de onde ela realmente mora
// ═════════════════════════════════════════════════════════════════════════════
//
// ⭐ `emendarSeries` nasceu neste arquivo e foi movida para `splice-series.core.ts`, que é
// AGNÓSTICO de fonte: ela não tem uma linha de MT5, e outro projeto pode emendar arquivo com
// Cedro, PNT, Binance ou WebSocket próprio sem arrastar este dialeto.
//
// ⚠️ O reexport existe para não quebrar quem já importava daqui. Código NOVO deve importar do
// índice do pacote, que é o caminho recomendado.
export { emendarSeries, type SerieEmendada } from './splice-series.core.js';
