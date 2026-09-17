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
 * A bridge devolve `timestamp` que **NÃO é epoch UTC**. Medido contra a mesma barra nas duas
 * fontes — janela BRT de 16/09 14:00..14:15, `WIN` em 5min:
 *
 * ```
 * bars_api (referência)          14:00 → 187695   14:05 → 187660   14:10 → 187745
 * MT5, timestamp CRU                    187190           187225           187225   ⇠ ERRADO
 * MT5, timestamp + 10800                187705           187670           187740   ⇠ casa
 * ```
 *
 * ⭐ **É o pior tipo de defeito: o preço cru é PLAUSÍVEL.** 187.190 é um valor perfeitamente
 * possível para o WIN — só não é o valor daquele horário. Sem esta correção o gráfico mostra
 * um mercado que existiu, deslocado três horas, e ninguém percebe olhando. O que denuncia é
 * cruzar as duas fontes na mesma barra, que é o que a medição acima faz.
 *
 * A diferença residual de 5 a 10 pontos entre as colunas corrigidas **não** é erro: é
 * `WINV26` (contrato com vencimento, o que o MT5 cota) contra `WIN` (série contínua ajustada,
 * o que o arquivo guarda). Ver a nota de `emendarSeries` sobre por que isso proíbe misturar
 * as duas fontes DENTRO de uma barra.
 *
 * ⚠️ O sentido do offset difere por rota na bridge (o stream de tick e o REST de candles não
 * concordam entre si), e é por isso que a constante aqui declara a ROTA que mediu. Não
 * generalize para o WebSocket sem medir de novo.
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

// ═════════════════════════════════════════════════════════════════════════════
// O fuso
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ Segundos a SOMAR no `timestamp` do REST de candles da bridge para obter epoch real.
 *
 * ⚠️ **MEDIDO, não deduzido do fuso de Brasília.** O número coincide com 3 h, mas a causa é o
 * frame de tempo do servidor da corretora, não o fuso do operador — então ele **não** segue
 * horário de verão nem muda se o navegador estiver noutro país. Tratar isto como "fuso do
 * Brasil" e derivar de `Intl` produziria um deslocamento novo no dia em que qualquer um dos
 * dois mudasse.
 *
 * A medição está no cabeçalho do arquivo: com `+10800` as duas fontes descrevem o mesmo
 * preço na mesma barra; sem, erram por ~500 pontos no WIN.
 *
 * ⚠️ Vale para `/candles`, `/historical` e `/historical-flow`. **Não** foi medido para o
 * stream WebSocket de tick nem para `/orderbook` — a bridge é inconsistente entre rotas, e
 * afirmar sem medir é como este defeito nasce.
 */
export const OFFSET_CANDLES_MT5_SEGUNDOS = 10_800;

/**
 * Converte o `timestamp` da bridge em epoch real (segundos).
 *
 * Existe como função nomeada, e não como `t + 10800` espalhado, para haver **um** lugar onde
 * a correção acontece. Duas cópias divergem na primeira vez que alguém "simplifica" uma
 * delas, e o sintoma é um gráfico correto em algumas telas e deslocado em outras.
 */
export function epochRealDoMt5(timestampDaBridge: number): number {
  return timestampDaBridge + OFFSET_CANDLES_MT5_SEGUNDOS;
}

/**
 * O inverso: epoch real → o `timestamp` que a bridge entende.
 *
 * ⭐ Necessário para PEDIR janela. Mandar epoch real num filtro de tempo da bridge pediria
 * três horas adiante — em pregão, isso volta vazio e parece "o ativo não negociou".
 */
export function epochParaMt5(epochReal: number): number {
  return epochReal - OFFSET_CANDLES_MT5_SEGUNDOS;
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
export function parseCandlesDoMt5(
  body: unknown,
  janela?: { readonly deSegundos?: number; readonly ateSegundos?: number },
): readonly Bar[] | null {
  if (!Array.isArray(body)) return null;

  const de = janela?.deSegundos;
  const ate = janela?.ateSegundos;

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

    const time = epochRealDoMt5(tsBridge);
    if (de !== undefined && time < de) continue;
    if (ate !== undefined && time >= ate) continue;
    // Tempo não crescente quebra o eixo do motor em três lugares (`update` trata tempo igual
    // como mesma barra, `timeToIndex` resolve para o primeiro índice, e os rótulos do eixo).
    if (!(time > ultimoTempo)) continue;
    ultimoTempo = time;

    const volume = numeroOuAusente(c['volume']);
    const buyVolume = numeroOuAusente(c['buy_volume']);
    const sellVolume = numeroOuAusente(c['sell_volume']);

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

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ A COSTURA — a parte que pode corromper um gráfico
// ═════════════════════════════════════════════════════════════════════════════

/** O resultado da emenda, com o que o operador precisa saber sobre ela. */
export interface SerieEmendada {
  /** A série única, em ordem crescente de tempo, sem tempo repetido. */
  readonly barras: readonly Bar[];
  /** Tempo da primeira barra que veio do MT5, ou `null` se nenhuma veio. */
  readonly emendaEm: number | null;
  /** Quantas barras vieram de cada lado. Para a trilha de legendas dizer a verdade. */
  readonly doHistorico: number;
  readonly doAoVivo: number;
  /**
   * ⭐⭐ Barras DESCARTADAS por não pertencerem ao período pedido.
   *
   * ⚠️ **Existe por causa de um defeito real e visível.** Ver a nota de `emendarSeries` sobre
   * a grade de período: trocar o TF de 5min para 1h deixava as barras de 5min do terminal
   * emendadas no histórico de 1h, e o gráfico desenhava as duas grades juntas. Medido contra
   * os serviços reais: com 1h escolhido, **101 pares de barras consecutivas a 5 min de
   * distância**.
   *
   * Se isto for maior que zero de forma persistente, há corrida de período em algum lugar do
   * consumidor — o número é o que torna o defeito VISÍVEL em vez de silencioso.
   */
  readonly foraDaGrade: number;
  /**
   * Barras do terminal que SUBSTITUÍRAM a barra do arquivo no balde do corte.
   *
   * ⭐ Em regime é 0 ou 1: só o último balde do arquivo pode ser substituído (ele pode estar em
   * formação). Ver a decisão 2.
   */
  readonly sobrepostas: number;
  /**
   * ⭐⭐ Barras do terminal DESCARTADAS por serem anteriores ao fim do arquivo.
   *
   * ⚠️ **Não é desperdício, é a proteção contra um degrau de preço.** O terminal responde as N
   * últimas barras, então ele sempre traz passado que o arquivo já tem — medido, 117 barras em
   * 15min com um lote de 400. Aceitá-las reescreveria dias de série com o preço do CONTRATO
   * (`WINV26`) no lugar do CONTÍNUO (`WIN`), e a junção apareceria como um degrau no meio do
   * gráfico.
   *
   * Um número alto aqui é NORMAL e saudável. Ele é útil como sinal do contrário: se cair a
   * zero e `doAoVivo` for grande, o arquivo ficou muito atrás (top-up parado).
   */
  readonly descartadasPeloCorte: number;
  /**
   * ⚠️ Há um BURACO entre o fim do histórico e o começo do ao vivo?
   *
   * `null` = contíguo (ou impossível de afirmar). Quando presente, é a janela descoberta, e o
   * consumidor **deve** dizer isso na tela: um gráfico com buraco silencioso parece um pregão
   * sem negócio, e o operador tiraria conclusão de liquidez a partir de uma falha de coleta.
   */
  readonly lacuna: { readonly de: number; readonly ate: number } | null;
  /**
   * Tempo da última barra, que está **EM FORMAÇÃO** quando veio do ao vivo.
   *
   * ⭐⭐ Existe porque indicador incremental **não pode** receber barra parcial em `update()`:
   * o contrato é `warmup`/`update` para barra FECHADA e `preview` para a em formação, e
   * chamar `update` com a mesma barra a cada tick corrompe a média rolante em silêncio. Quem
   * costura tem a informação; quem consome, não teria como saber.
   */
  readonly parcialEm: number | null;
}

/**
 * ⭐⭐ Emenda o histórico do arquivo com o dia corrente do MT5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS QUATRO DECISÕES, E O QUE CADA UMA EVITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. O corte é por TEMPO, e cada barra vem de UMA fonte só.**
 *
 * ⚠️ É a decisão que mais importa, e vem de uma medição: na mesma barra de 16/09 14:00, o
 * arquivo diz `close = 187695` e o MT5 diz `187705`. Os dois estão certos — são instrumentos
 * diferentes (`WIN` contínuo ajustado vs `WINV26`, o contrato). Se a emenda misturasse OHLC
 * das duas fontes numa barra (por exemplo, abertura de uma e fechamento da outra), ela
 * fabricaria um candle que não existiu em mercado nenhum, com pavio inventado. Pior: o valor
 * mudaria conforme a ordem de chegada das respostas.
 *
 * **2. O arquivo é CANÔNICO no passado; o terminal completa a ponta.**
 *
 * ⭐⭐ **Medido, e é o que corrigiu um degrau de preço:** o terminal responde as N últimas
 * barras, e com 400 barras de 15min ele cobre ~4 dias — sobrepondo **117 barras** que o
 * arquivo já tinha. Deixar o terminal vencer todas elas reescreveria quatro dias de série com
 * o preço do CONTRATO (`WINV26`) no lugar do CONTÍNUO (`WIN`), e a junção apareceria como um
 * degrau no meio do gráfico.
 *
 * A regra, que é a mesma que o cockpit de origem usa no SQL (um corte por `MAX(tempo)` do
 * arquivo, com o complemento só acima dele):
 *
 * | balde da barra do terminal | destino |
 * |---|---|
 * | **antes** do último do arquivo | descartada — o arquivo é a fonte canônica do passado |
 * | **igual** ao último do arquivo | substitui — essa pode estar em formação no arquivo |
 * | **depois** do último do arquivo | entra — é o que o arquivo não tem |
 *
 * ⚠️ O balde IGUAL precisa ser substituído: se o top-up rodar no meio do pregão, o arquivo
 * guarda uma barra parcial, e mantê-la congelaria a ponta do gráfico no minuto em que o
 * top-up rodou.
 *
 * ⭐ A emenda continua IDEMPOTENTE: com o arquivo completo, o terminal não acrescenta nada.
 *
 * **3. A LACUNA é detectada e devolvida, nunca fechada por interpolação.**
 *
 * Se a bridge estiver de pé há pouco tempo, o lote dela pode não alcançar o fim do arquivo.
 * Inventar barra no meio seria afirmar preço que ninguém negociou. Declarar o buraco deixa o
 * consumidor mostrá-lo — e um buraco visível é informação; um buraco preenchido é mentira.
 *
 * ⚠️ A tolerância é de **um período**: duas barras consecutivas distam exatamente um período,
 * então `> 1 período` de distância é buraco. Fim de semana e feriado também caem aqui, e é
 * por isso que quem chama passa `toleranciaDeSegundos` quando a emenda cruza dia — o
 * calendário é conhecimento do consumidor, não deste núcleo.
 *
 * **4. Não confia na ordenação de nenhuma das duas.** Ordena e deduplica por tempo. O motor
 * assume tempo estritamente crescente em três lugares; violar isso não dá erro, dá gráfico
 * embaralhado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ DECISÃO 5 — A GRADE DE PERÍODO, E O DEFEITO QUE ELA CORRIGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **Relato:** *"quando muda o TF as barras não estão se ajustando conforme o TF"*.
 *
 * **A causa:** as barras do terminal viviam num estado sem carimbo de período. Trocar o TF
 * disparava uma consulta nova, mas ela é ASSÍNCRONA — e a rota com agressor leva 7 s. Durante
 * esse tempo (e **indefinidamente**, se a consulta falhasse, porque a série anterior é
 * preservada de propósito para não piscar) o gráfico emendava barras de 5min num histórico de
 * 1h e desenhava as **duas grades juntas**.
 *
 * **Medido contra os serviços reais**, com 1h escolhido: 31 barras de 1h do arquivo + 102 de
 * 5min do terminal ⇒ série com **quatro espaçamentos diferentes** e **101 pares consecutivos
 * a 5 min de distância**. O sintoma na tela é o da foto: metade do gráfico com densidade
 * diferente da outra.
 *
 * ⭐ **A invariante que resolve, e por que ela é a certa:** duas barras do mesmo período nunca
 * podem estar MAIS PRÓXIMAS que um período. Distância MAIOR é legítima e frequente (fim de
 * semana, feriado, leilão, ativo sem negócio); distância MENOR é impossível — é outra grade.
 * Então a guarda é `distância >= periodo`, e não "espaçamento uniforme", que reprovaria
 * qualquer série real.
 *
 * ⚠️ Quem é descartado é o **ao vivo**, nunca o histórico: o histórico é a referência de
 * grade (ele foi pedido no período certo e é o dono do passado), e na dúvida é melhor a tela
 * mostrar só o arquivo — que é o comportamento anterior, correto e sem surpresa — do que uma
 * série de grade dupla.
 *
 * ⚠️ E a guarda vale ATÉ COM O HISTÓRICO VAZIO: aí a grade é aferida contra o próprio ao
 * vivo, o que pega a barra intrusa vinda de um lote de outro período.
 *
 * @param historico barras do arquivo (passado profundo). Pode vir vazio.
 * @param aoVivo barras do MT5 (dia corrente), **já com fuso corrigido** por `parseCandlesDoMt5`.
 * @param periodSeconds duração da barra: mede contiguidade E valida a grade.
 * @param opcoes `toleranciaDeSegundos` amplia o limiar de lacuna (fim de semana, feriado).
 */
export function emendarSeries(
  historico: readonly Bar[],
  aoVivo: readonly Bar[],
  periodSeconds: number,
  opcoes?: { readonly toleranciaDeSegundos?: number },
): SerieEmendada {
  const periodo = Number.isFinite(periodSeconds) && periodSeconds > 0 ? Math.floor(periodSeconds) : 0;

  // Caminho degradado: sem ao vivo, o histórico passa intacto. É o que mantém o gráfico
  // funcionando com o terminal fora — e `parcialEm: null` diz que nada está em formação.
  if (aoVivo.length === 0) {
    return {
      barras: [...historico].sort((a, b) => a.time - b.time),
      emendaEm: null,
      doHistorico: historico.length,
      doAoVivo: 0,
      sobrepostas: 0,
      descartadasPeloCorte: 0,
      foraDaGrade: 0,
      lacuna: null,
      parcialEm: null,
    };
  }

  // ── Decisão 5: o ao vivo tem de estar na MESMA grade do período pedido ────
  //
  // ⚠️ A aferição é feita ANTES do merge. Depois de misturar não há como separar: os tempos
  // já estariam no mesmo mapa, e a grade dupla viraria "a série".
  const aoVivoNaGrade = periodo > 0 ? filtrarNaGrade(historico, aoVivo, periodo) : aoVivo;
  const foraDaGrade = aoVivo.length - aoVivoNaGrade.length;

  // Descartou tudo? Então o lote era de outro período por inteiro (o caso da troca de TF).
  // Degrada para o histórico puro, que é o comportamento correto e conhecido.
  if (aoVivoNaGrade.length === 0) {
    return {
      barras: [...historico].sort((a, b) => a.time - b.time),
      emendaEm: null,
      doHistorico: historico.length,
      doAoVivo: 0,
      sobrepostas: 0,
      descartadasPeloCorte: 0,
      foraDaGrade,
      lacuna: null,
      parcialEm: null,
    };
  }

  // ⭐⭐ A identidade é o BALDE, não o instante — e em D1 isso é o que impede o mesmo pregão de
  // virar DUAS barras. Medido: o arquivo rotula o pregão de 16/09 às 00:00 UTC e o terminal às
  // 03:00 UTC; deduplicar por tempo produziria dois "dias 16" lado a lado, com o retorno entre
  // eles sendo ruído puro. É o mesmo estrago que `parseBarrasDaMesa` já combate dentro do
  // arquivo, e que envenenou a correlação PETR4/VALE3 para −0,04.
  //
  // ⚠️ Para período intradiário o balde é equivalente ao tempo (as barras já estão alinhadas na
  // grade), então o caminho é um só e não há ramo especial a manter em sincronia.
  const porBalde = new Map<number, Bar>();
  const chave = (b: Bar): number => (periodo > 0 ? chaveDeBalde(b.time, periodo) : b.time);
  for (const b of historico) porBalde.set(chave(b), b);

  // ⭐⭐ O CORTE (decisão 2): o último balde que o arquivo alcança. O terminal só manda daqui
  // para frente. `null` = arquivo vazio, e aí o terminal manda em tudo.
  let corte: number | null = null;
  for (const b of historico) {
    const k = chave(b);
    if (corte === null || k > corte) corte = k;
  }

  let sobrepostas = 0;
  let doAoVivo = 0;
  let descartadasPeloCorte = 0;
  for (const b of aoVivoNaGrade) {
    const k = chave(b);

    // Antes do corte: o arquivo é canônico. Descartar evita reescrever o passado com o preço
    // do contrato e produzir um degrau na junção.
    if (corte !== null && k < corte) {
      descartadasPeloCorte += 1;
      continue;
    }

    if (porBalde.has(k)) {
      // O balde do corte: substitui, porque a barra do arquivo pode estar em formação.
      //
      // ⚠️ RESSALVA DE RÓTULO: em período diário o TEMPO do histórico é preservado, porque ele
      // é a convenção dominante da série (ver `UM_DIA_EM_SEGUNDOS`). Trocar o rótulo de uma
      // barra existente deslocaria o eixo e qualquer desenho ancorado nela.
      const anterior = porBalde.get(k)!;
      sobrepostas += 1;
      porBalde.set(k, periodo >= UM_DIA_EM_SEGUNDOS ? { ...b, time: anterior.time } : b);
      continue;
    }

    doAoVivo += 1;
    porBalde.set(k, b);
  }

  const barras = [...porBalde.values()].sort((a, b) => a.time - b.time);

  // ⚠️ Só as barras que EFETIVAMENTE entraram contam para a emenda — as descartadas pelo corte
  // não estão na série, e apontar a emenda para uma delas faria a trilha mentir.
  const usadas = aoVivoNaGrade.filter((b) => corte === null || chave(b) >= corte);
  const primeiraAoVivo = usadas.reduce((min, b) => (b.time < min ? b.time : min), Infinity);
  const emendaEm = Number.isFinite(primeiraAoVivo) ? primeiraAoVivo : null;

  // Decisão 3: a lacuna. Medida contra a última barra do histórico que fica ANTES da emenda —
  // e não contra o fim do arquivo, que pode ter barras posteriores (o caso do top-up).
  let lacuna: { readonly de: number; readonly ate: number } | null = null;
  if (emendaEm !== null && periodo > 0 && historico.length > 0) {
    let ultimaAntes = -Infinity;
    for (const b of historico) {
      if (b.time < emendaEm && b.time > ultimaAntes) ultimaAntes = b.time;
    }
    if (Number.isFinite(ultimaAntes)) {
      const limiar = periodo + Math.max(0, opcoes?.toleranciaDeSegundos ?? 0);
      const distancia = emendaEm - ultimaAntes;
      if (distancia > limiar) lacuna = { de: ultimaAntes + periodo, ate: emendaEm };
    }
  }

  // Decisão 4 + a barra parcial: a última barra é em formação SÓ se ela veio do ao vivo.
  //
  // ⚠️ Compara por BALDE e não por tempo, por causa da ressalva de rótulo do D1: ali a barra
  // fica com o tempo do arquivo, então comparar tempo diria "não é do ao vivo" e a barra em
  // formação passaria por fechada — e um indicador a alimentaria com `update()`.
  const ultima = barras[barras.length - 1];
  const parcialEm =
    ultima !== undefined && usadas.some((b) => chave(b) === chave(ultima))
      ? ultima.time
      : null;

  return {
    barras,
    emendaEm,
    doHistorico: barras.length - doAoVivo,
    doAoVivo,
    sobrepostas,
    descartadasPeloCorte,
    foraDaGrade,
    lacuna,
    parcialEm,
  };
}

/**
 * ⭐⭐ Um dia (ou mais) por barra? A partir daí as duas fontes DISCORDAM do rótulo.
 *
 * ⚠️ **Medido em 17/09/2026, e é o achado que separa este caminho do outro.** O pregão de
 * 16/09 (verdade apurada somando as barras de 1h: open 188.165, close 187.600):
 *
 * | fonte | rótulo | em BRT | close |
 * |---|---|---|---|
 * | arquivo | `16/09 00:00 UTC` | 15/09 **21:00** | 187.600 ✓ |
 * | terminal | `16/09 03:00 UTC` | 16/09 **00:00** | 187.600 ✓ |
 *
 * O MESMO pregão, com 3 h de diferença no rótulo: o arquivo vira o dia à meia-noite **UTC**, o
 * terminal à meia-noite **de Brasília**. Nenhum está errado — é vocabulário diferente, e o
 * `parseBarrasDaMesa` já registra que o próprio arquivo tem as duas convenções internamente.
 *
 * ⭐ Consequência: em D1 a identidade da barra é o **dia de calendário**, não o instante.
 * `floor(t / 86400)` dá 20712 para os dois rótulos acima — a mesma chave. Comparar por resto
 * da divisão, como se faz nos períodos intradiários, descartaria o dia corrente inteiro (foi o
 * que a guarda fez na primeira versão, e a medição pegou).
 *
 * ⚠️ Abaixo de um dia as duas fontes CONCORDAM (medido: resto 0 em 5min, 15min e 1h nas duas),
 * então lá o alinhamento é sinal legítimo de grade e vale usá-lo.
 */
const UM_DIA_EM_SEGUNDOS = 86_400;

/**
 * A chave de IDENTIDADE de uma barra: o balde a que ela pertence.
 *
 * ⭐ É o que faz "a mesma barra" ser reconhecida entre fontes que rotulam diferente. Usada
 * tanto na validação de grade quanto na deduplicação, para as duas não poderem divergir.
 */
function chaveDeBalde(time: number, periodo: number): number {
  return Math.floor(time / periodo);
}

/**
 * Filtra o ao vivo para o que pertence à grade do período. Ver a decisão 5 de `emendarSeries`.
 *
 * Duas verificações, e cada uma pega um caso que a outra não pega:
 *
 * 1. **Alinhamento** (só abaixo de um dia — ver `UM_DIA_EM_SEGUNDOS`): o resto da divisão pelo
 *    período é estável dentro de uma grade. Barra de 5min às 09:05 tem resto diferente de
 *    barra de 1h. É assim que a intrusa é pega mesmo sem vizinha próxima para comparar.
 *
 * 2. **Balde distinto**: 09:00 é múltiplo de 5min E de 1h, então uma barra de 5min na hora
 *    cheia passaria pelo teste de resto. O que a pega é cair no MESMO balde que a anterior
 *    aceita — duas barras da mesma grade nunca compartilham balde.
 *
 * ⚠️ Compara com a última ACEITA, não com a anterior do lote: comparar com a anterior faria uma
 * intrusa rejeitada deslocar o critério e arrastar as barras boas seguintes.
 */
function filtrarNaGrade(
  historico: readonly Bar[],
  aoVivo: readonly Bar[],
  periodo: number,
): readonly Bar[] {
  const ordenado = [...aoVivo].sort((a, b) => a.time - b.time);

  // O alinhamento esperado, tirado do histórico. `null` = não se aplica: ou o histórico está
  // vazio, ou o período é diário e as duas fontes usam convenções diferentes de virada.
  let alinhamento: number | null = null;
  if (historico.length > 0 && periodo < UM_DIA_EM_SEGUNDOS) {
    // ⚠️ A MODA e não a primeira barra: o `D1` do arquivo tem duas convenções de virada de dia
    // (ver `parseBarrasDaMesa`), e a mesma prudência vale para qualquer série com exceção na
    // ponta.
    const contagem = new Map<number, number>();
    for (const b of historico) {
      const r = ((b.time % periodo) + periodo) % periodo;
      contagem.set(r, (contagem.get(r) ?? 0) + 1);
    }
    let melhor = -1;
    for (const [r, n] of contagem) {
      if (n > melhor) {
        melhor = n;
        alinhamento = r;
      }
    }
  }

  const aceitas: Bar[] = [];
  let ultimoBalde: number | null = null;
  for (const b of ordenado) {
    if (alinhamento !== null) {
      const resto = ((b.time % periodo) + periodo) % periodo;
      if (resto !== alinhamento) continue;
    }
    const balde = chaveDeBalde(b.time, periodo);
    if (ultimoBalde !== null && balde <= ultimoBalde) continue;
    aceitas.push(b);
    ultimoBalde = balde;
  }
  return aceitas;
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
