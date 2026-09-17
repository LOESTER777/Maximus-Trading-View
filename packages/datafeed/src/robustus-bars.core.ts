/**
 * robustus-bars.core — o DIALETO da API de barras da mesa, em núcleo puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A mesa já tem histórico de verdade: um Postgres na máquina B com barras
 * derivadas de tick, servido por um serviço HTTP de leitura. Medido nesta máquina em
 * 17/09/2026, pelo túnel `127.0.0.1:18899`:
 *
 * | ativo | período diário | de | até |
 * |---|---|---|---|
 * | `WIN` | 6.376 barras | 2005-02-18 | 2026-09-16 |
 * | `WDO` | 2.574 | 2021-05 | 2026-09-16 |
 * | `BTC` | 3.318 | 2017-08 | 2026-09-16 |
 * | `PETR4`, `VALE3`, `ITUB4`, … (33 ações) | ~2.536 | 2021-07 | 2026-09-16 |
 * | `BOVA11` | 1.248 | 2021-07 | 2026-08 |
 *
 * E 5.163 dos 6.376 dias do WIN trazem **volume por agressor** (`buy_vol`/`sell_vol`),
 * que é o insumo de delta e de footprint — dado que quase nenhum provedor entrega.
 *
 * ⭐ Este arquivo é só o DIALETO: como pedir e como ler. O transporte é o
 * `createHttpBarsSource`, que já existe e recebe `fetch` injetado — escrever um segundo
 * cliente HTTP daria dois lugares para tratar tempo esgotado, cancelamento e mapa de
 * causa, e eles divergiriam na primeira correção.
 *
 * ⚠️ `.core` significa PURO: sem `fetch`, sem relógio, sem `URL` global. Tudo entra por
 * parâmetro e a mesma entrada dá sempre a mesma saída. É o que torna o formato testável
 * sem rede — e o formato é justamente onde um backend muda em silêncio.
 */

import type { Bar, BarsRequest } from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// O dialeto de período
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Períodos que a base REALMENTE tem, de segundos para o rótulo da API.
 *
 * ⚠️ **`M1` (60 s) não existe na base**, e a ausência é declarada em vez de contornada.
 * A agregação materializa `5min` a partir do tick e deriva `15min`/`1h`/`D1` dela; um
 * minuto nunca foi materializado. Oferecer M1 na interface para depois mostrar tela
 * vazia é pior que não oferecer — é a mesma regra que o seletor de período já segue com
 * `timeframesAgregaveisDe`.
 *
 * ⚠️ Também não existem `M30` nem `H4`. Os dois são AGREGÁVEIS a partir do que existe
 * (`rollupBars` de 5min ou 1h), e a decisão de agregar é do consumidor, não deste mapa:
 * o mapa diz o que a FONTE tem, e mentir aqui esconderia que o dado é derivado.
 */
export const PERIODOS_DA_MESA: ReadonlyMap<number, string> = new Map([
  [300, '5min'],
  [900, '15min'],
  [3600, '1h'],
  [86_400, 'D1'],
]);

/** Os períodos disponíveis, em segundos, em ordem crescente. */
export function periodosDisponiveis(): readonly number[] {
  return [...PERIODOS_DA_MESA.keys()].sort((a, b) => a - b);
}

/**
 * O rótulo da API para um período em segundos, ou `null` quando a base não o tem.
 *
 * `null` significa **"não sei"**, e é o que impede o adaptador de inventar: sem rótulo,
 * a consulta não é montada e o consumidor recebe `INDISPONIVEL` em vez de uma URL que o
 * servidor recusaria com 400.
 */
export function rotuloDePeriodo(segundos: number): string | null {
  return PERIODOS_DA_MESA.get(segundos) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// A URL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ O símbolo aceito pela API é `[A-Za-z0-9]{1,16}` — **`WIN$` e `WDO$` são
 * RECUSADOS**, e é por isso que esta guarda existe aqui e não só no servidor.
 *
 * O nome canônico da série contínua é `WIN`, sem sufixo de vencimento e sem `$`: ela é
 * costurada por contrato de maior volume do dia. Deixar o `$` passar produziria um 400
 * que o operador leria como "o ativo não existe".
 */
const SIMBOLO_VALIDO = /^[A-Za-z0-9]{1,16}$/;

/** O símbolo é aceitável para esta fonte? */
export function simboloAceito(symbol: string): boolean {
  return SIMBOLO_VALIDO.test(symbol);
}

/**
 * Monta o caminho da consulta de barras. `null` quando o pedido não é atendível.
 *
 * ⭐⭐ **A JANELA É OBRIGATÓRIA, e esta é a decisão mais importante do arquivo.**
 *
 * A rota `/candles` **não tem `LIMIT` nem paginação**: sem `from`/`to` ela devolve a
 * série INTEIRA ordenada por tempo. Para o WIN em 5min isso são 18 anos de barras numa
 * resposta só. O projeto de origem já matou o próprio processo servindo 28 MB de JSON de
 * uma vez, e registrou o episódio — repetir isso a partir do gráfico derrubaria o
 * serviço para todo mundo, inclusive para o robô que opera.
 *
 * Então: pedido sem `fromSeconds` **nem** `toSeconds` é RECUSADO aqui. Não é limitação
 * do adaptador; é o adaptador se recusando a fazer uma pergunta cujo custo ele conhece.
 * O consumidor de gráfico sempre sabe a janela que quer — é dela que ele desenha.
 *
 * ⚠️ `limit` do contrato é IGNORADO de propósito: a fonte não o implementa, e traduzi-lo
 * para "corte no cliente" faria a biblioteca baixar tudo para jogar quase tudo fora,
 * que é exatamente o custo que se quer evitar. Recortar por janela é o caminho.
 *
 * ⚠️ `to` é EXCLUSIVO no servidor (`bar_epoch < to`). O backfill se apoia nisso: pedir
 * `to = tempo da barra mais antiga já carregada` não duplica a barra de borda.
 */
export function montarCaminhoDeBarras(request: BarsRequest): string | null {
  const rotulo = rotuloDePeriodo(request.periodSeconds);
  if (rotulo === null) return null;

  const symbol = request.instrument.symbol;
  if (!simboloAceito(symbol)) return null;

  const de = request.fromSeconds;
  const ate = request.toSeconds;
  // Ver a nota longa acima: janela aberta nos DOIS lados é recusada.
  if (de === undefined && ate === undefined) return null;
  if (de !== undefined && (!Number.isFinite(de) || de < 0)) return null;
  if (ate !== undefined && (!Number.isFinite(ate) || ate < 0)) return null;
  // Janela invertida ou degenerada não devolveria nada; recusar é mais honesto que
  // pedir e receber lista vazia, porque distingue "não há dado" de "pergunta errada".
  if (de !== undefined && ate !== undefined && !(de < ate)) return null;

  const partes = [`asset=${encodeURIComponent(symbol)}`, `tf=${encodeURIComponent(rotulo)}`];
  if (de !== undefined) partes.push(`from=${Math.floor(de)}`);
  if (ate !== undefined) partes.push(`to=${Math.ceil(ate)}`);
  return `/candles?${partes.join('&')}`;
}

/**
 * A janela do próximo lote de BACKFILL, andando para trás.
 *
 * `maisAntigaCarregada` é o `time` da barra mais antiga que já está na tela. O lote pedido
 * termina EXATAMENTE nela (exclusivo no servidor), então nada se duplica e nada se perde.
 *
 * ⚠️ Devolve `null` para entrada não utilizável em vez de uma janela inventada: janela
 * errada num backfill produz um buraco no meio do histórico, que é o defeito mais difícil
 * de perceber num gráfico — ele parece um pregão sem negócio.
 */
export function janelaDeBackfill(
  maisAntigaCarregada: number,
  periodSeconds: number,
  quantidade: number,
): { readonly fromSeconds: number; readonly toSeconds: number } | null {
  if (!Number.isFinite(maisAntigaCarregada) || maisAntigaCarregada <= 0) return null;
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return null;
  if (!Number.isFinite(quantidade) || quantidade < 1) return null;

  const ate = Math.floor(maisAntigaCarregada);
  // ⚠️ A janela é CALENDÁRIO, e o retorno costuma trazer MENOS barras que `quantidade`:
  // fim de semana, feriado e madrugada não têm pregão. Isso é correto — compensar
  // multiplicando por um "fator de folga" faria o lote variar de tamanho por ativo e a
  // rolagem ficaria irregular. Quem quiser mais barras pede outro lote.
  const de = ate - Math.ceil(quantidade) * Math.floor(periodSeconds);
  if (de >= ate) return null;
  return { fromSeconds: Math.max(0, de), toSeconds: ate };
}

/**
 * ⭐⭐ A janela ANTERIOR à que já foi pedida — o que faz a caminhada para trás não empacar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ARMADILHA, MEDIDA CONTRA O SERVIÇO REAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Em 17/09/2026, três lotes de backfill de WIN em 5min contra a API real:
 *
 * ```
 * lote 0: 114 barras, mais antiga 2026-09-14T12:00Z   (segunda)
 * lote 1:   0 barras                                   ⇠ domingo
 * lote 2:   0 barras                                   ⇠ o MESMO domingo, de novo
 * ```
 *
 * O lote 1 pediu um domingo e voltou vazio — **correto**, não houve pregão. Mas quem
 * caminha usando *"o tempo da barra mais antiga recebida"* como próximo `to` não tem barra
 * nenhuma para usar, então repete a mesma janela para sempre. O sintoma na tela é o pior
 * possível: o gráfico afirma *"não há mais histórico"* a cada fim de semana, com 18 anos
 * de dado do outro lado do buraco.
 *
 * ⭐ A regra correta é: quando o lote vem VAZIO, ande a mesma distância a partir do
 * `from` que você já pediu — o vazio é informação sobre o CALENDÁRIO, não sobre o fim do
 * histórico. Só uma janela que atinge o começo da série é fim de histórico, e isso quem
 * sabe é a cobertura do ativo, não um lote vazio.
 *
 * ⚠️ Existe como função pura para haver UM lugar com essa aritmética. Duas cópias — uma
 * no hook de React, outra no adaptador — divergiriam, e a divergência aqui produz buraco
 * silencioso no meio do histórico.
 */
export function janelaAnterior(
  janela: { readonly fromSeconds: number; readonly toSeconds: number },
  periodSeconds: number,
  quantidade: number,
): { readonly fromSeconds: number; readonly toSeconds: number } | null {
  // O `from` da janela anterior vira o `to` da próxima: contíguo e sem sobreposição,
  // porque `to` é exclusivo no servidor.
  return janelaDeBackfill(janela.fromSeconds, periodSeconds, quantidade);
}

/**
 * A janela já alcançou o início conhecido da série?
 *
 * ⚠️ É ISTO que significa "fim do histórico", e não um lote vazio. Sem esta distinção, a
 * caminhada para trás não tem critério de parada e ficaria pedindo 2004, 2003, 1999… para
 * sempre, uma requisição por rolagem, contra um banco de 250 GB.
 *
 * `inicioConhecido` vem da cobertura do ativo (o `MIN(bar_epoch)` que a fonte publica).
 * Sem cobertura conhecida, devolve `false`: é melhor pedir um lote a mais que parar cedo e
 * afirmar que não há passado.
 */
export function alcancouInicio(
  janela: { readonly fromSeconds: number },
  inicioConhecido: number | null | undefined,
): boolean {
  if (typeof inicioConhecido !== 'number' || !Number.isFinite(inicioConhecido)) return false;
  return janela.fromSeconds <= inicioConhecido;
}

// ═════════════════════════════════════════════════════════════════════════════
// A leitura da resposta
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O corpo que a API devolve: colunar, não uma lista de objetos.
 *
 * ⭐ `cols` vem na resposta de propósito, e o adaptador **mapeia por NOME**, nunca por
 * posição. A ordem é estável hoje; amarrar-se a ela faria uma coluna nova no meio
 * deslocar preço para volume em silêncio — e um gráfico com o preço errado não parece
 * quebrado, parece um mercado que não existiu.
 */
interface CorpoDeBarras {
  readonly cols: readonly string[];
  readonly rows: readonly (readonly (number | null)[])[];
}

function ehCorpoDeBarras(body: unknown): body is CorpoDeBarras {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as { cols?: unknown; rows?: unknown };
  if (!Array.isArray(b.cols) || !Array.isArray(b.rows)) return false;
  return b.cols.every((c) => typeof c === 'string');
}

/** Número finito, ou `undefined`. `null` da fonte significa "não sei" — nunca zero. */
function numeroOuAusente(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Converte o corpo em barras. `null` = contrato quebrado (vira `DECODIFICACAO`).
 *
 * ⚠️ **Corpo bem-formado com zero linhas devolve `[]`, não `null`.** A distinção é o
 * ponto: `[]` é "não houve pregão nessa janela", resposta legítima e frequente; `null` é
 * "o formato mudou e alguém precisa saber". Colapsar as duas faz mudança de formato no
 * backend parecer dia sem negócio, e o defeito vive meses.
 *
 * ⚠️ `bid_size`/`ask_size` são DESCARTADOS aqui, e não zerados: no WIN eles vêm nulos em
 * praticamente todo o histórico (o book não foi gravado). Zero seria uma afirmação falsa
 * sobre a liquidez do topo do livro; ausência é a verdade. O contrato de `Bar` não tem
 * campo para eles justamente porque livro é outra capacidade.
 */
/**
 * ⭐⭐ FOLGA MÍNIMA entre barras diárias, em segundos. Ver `parseBarrasDaMesa`.
 *
 * 12 h: separa "dois registros do MESMO pregão" (3 h de diferença) de "dois pregões" (24 h).
 */
const FOLGA_MINIMA_D1 = 12 * 3600;

/**
 * ⭐⭐ Fração MÍNIMA do volume que precisa estar classificada por agressor para o delta valer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO DE DADO QUE ISTO BARRA, E A MEDIÇÃO QUE ESCOLHEU O NÚMERO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A invariante honesta de uma barra com agressor é `buy_vol + sell_vol ≈ volume`. Uma folga de
 * 1 a 2 % é normal e esperada (leilão, cruzamento direto, negócio sem agressor identificável).
 *
 * ⚠️ Auditado contra o serviço da mesa em 17/09/2026 (`scripts/auditoria-de-dados.mjs`), e o
 * resultado separa claramente o dado bom do dado quebrado:
 *
 * | período | cobertura mínima | p5 | barras abaixo de 90 % |
 * |---|---|---|---|
 * | `5min` | **100 %** | 100 % | **0** de 1.137 |
 * | `15min` | **100 %** | 100 % | **0** de 714 |
 * | `1h` | **0,1 %** | 3,1 % | **96** de 459 (21 %) |
 * | `D1` | 0,3 % | 96,4 % | 33 de 740 (4,5 %) |
 *
 * ⭐ O tick é PERFEITO; quem quebra é a AGREGAÇÃO da base para os períodos maiores — ela soma o
 * `volume` de todos os negócios mas só parte do `buy_vol`/`sell_vol`. Em junho de 2026 a
 * cobertura média em D1 caiu para **37,8 %**: o delta daqueles dias estava sendo calculado
 * sobre um TERÇO do volume.
 *
 * ⚠️ **E o gráfico exibia isso como delta legítimo.** Um delta apurado sobre 37 % do volume não
 * é uma medida imprecisa, é outra medida — e ela inverte de sinal com facilidade, porque a
 * parte não classificada não é neutra. Para quem lê fluxo, isso aponta na direção errada.
 *
 * ⭐ **90 % é o limiar, e ele foi escolhido pela distribuição, não por gosto:** não recusa NADA
 * em 5min e 15min (onde o dado é íntegro) e barra exatamente as barras arruinadas de 1h e D1.
 * Um limiar de 98 % recusaria 20 % das barras diárias boas (o p50 é 98,6 %); um de 80 % deixaria
 * passar barra com 85 % de cobertura, onde o delta já pode inverter.
 *
 * ⚠️ Recusar significa **omitir** `buyVolume`/`sellVolume`, e o indicador de delta devolve
 * `null` naquela barra. É a disciplina do projeto: `null` é *"não sei"*, e é infinitamente
 * melhor que um número errado numa tela de decisão. O `volume` total continua íntegro e
 * continua sendo desenhado — o que se perde é só a divisão por agressor, que é o que estava
 * quebrado.
 */
export const COBERTURA_MINIMA_DE_AGRESSOR = 0.9;

/**
 * O par compra/venda é utilizável para esta barra?
 *
 * ⚠️ Sem `volume` para comparar, ACEITA: não há como aferir, e recusar por falta de referência
 * jogaria fora dado possivelmente bom. O que não se pode é aceitar quando a aferição REPROVA.
 */
export function agressorUtilizavel(
  volume: number | undefined,
  compra: number | undefined,
  venda: number | undefined,
  minimo: number = COBERTURA_MINIMA_DE_AGRESSOR,
): boolean {
  if (compra === undefined || venda === undefined) return false;
  if (compra < 0 || venda < 0) return false;
  if (volume === undefined || !(volume > 0)) return true;
  return (compra + venda) / volume >= minimo;
}

export function parseBarrasDaMesa(body: unknown, periodSeconds?: number): readonly Bar[] | null {
  if (!ehCorpoDeBarras(body)) return null;

  const idx = new Map<string, number>();
  body.cols.forEach((c, i) => idx.set(c, i));

  const iTempo = idx.get('bar_epoch');
  const iOpen = idx.get('open');
  const iHigh = idx.get('high');
  const iLow = idx.get('low');
  const iClose = idx.get('close');
  // Sem as cinco colunas obrigatórias não há barra a montar: é contrato quebrado.
  if (
    iTempo === undefined ||
    iOpen === undefined ||
    iHigh === undefined ||
    iLow === undefined ||
    iClose === undefined
  ) {
    return null;
  }
  const iVolume = idx.get('volume');
  const iCompra = idx.get('buy_vol');
  const iVenda = idx.get('sell_vol');

  const barras: Bar[] = [];
  let ultimoTempo = -Infinity;

  for (const linha of body.rows) {
    if (!Array.isArray(linha)) return null;

    const time = numeroOuAusente(linha[iTempo]);
    const open = numeroOuAusente(linha[iOpen]);
    const high = numeroOuAusente(linha[iHigh]);
    const low = numeroOuAusente(linha[iLow]);
    const close = numeroOuAusente(linha[iClose]);
    // ⚠️ Linha com OHLC incompleto é PULADA, não rejeita o lote inteiro. Uma barra ruim
    // num histórico de 18 anos não pode apagar os outros 18 anos da tela — e o episódio
    // de contaminação registrado na origem (13-14% de barras impossíveis por relógio
    // deslocado) mostra que barra ruim acontece de verdade.
    if (time === undefined || open === undefined || high === undefined) continue;
    if (low === undefined || close === undefined) continue;
    // Tempo não crescente quebra o eixo do motor em três lugares (`update` trata tempo
    // igual como mesma barra, `timeToIndex` resolve para o primeiro índice, e os rótulos
    // do eixo). Descartar é o que mantém a invariante que o motor assume.
    if (!(time > ultimoTempo)) continue;
    ultimoTempo = time;

    const volume = iVolume === undefined ? undefined : numeroOuAusente(linha[iVolume]);
    const compraCrua = iCompra === undefined ? undefined : numeroOuAusente(linha[iCompra]);
    const vendaCrua = iVenda === undefined ? undefined : numeroOuAusente(linha[iVenda]);

    // ⭐⭐ O agressor só passa se COBRIR o volume. Ver `COBERTURA_MINIMA_DE_AGRESSOR`: a
    // agregação de 1h e D1 da base soma o volume inteiro mas só parte da classificação, e em
    // junho de 2026 isso chegou a 37,8 % de cobertura — delta apurado sobre um terço do
    // volume, exibido como se fosse bom.
    //
    // ⚠️ Os DOIS são omitidos juntos, sempre. Um lado sozinho seria o volume total disfarçado
    // de desequilíbrio, que é pior que ausência.
    const usaAgressor = agressorUtilizavel(volume, compraCrua, vendaCrua);
    const buyVolume = usaAgressor ? compraCrua : undefined;
    const sellVolume = usaAgressor ? vendaCrua : undefined;

    barras.push({
      time,
      open,
      high,
      low,
      close,
      // Campo omitido em vez de `undefined` explícito: `exactOptionalPropertyTypes`
      // distingue os dois, e um `volume: undefined` serializado vira `null` no JSON.
      ...(volume === undefined ? {} : { volume }),
      ...(buyVolume === undefined ? {} : { buyVolume }),
      ...(sellVolume === undefined ? {} : { sellVolume }),
    });
  }

  // ⭐⭐ D1 DA MESA TEM DUAS CONVENÇÕES DE VIRADA DE DIA, E ISSO É UM DEFEITO DO DADO.
  //
  // ⚠️ Medido contra o serviço em 17/09/2026, `PETR4` em `D1`:
  //
  // ```
  // 2026-05-29T00:00:00Z  fecha 41.43  vol 63.690
  // 2026-05-29T03:00:00Z  fecha 41.87  vol 31.318   ⇠ o MESMO pregão, outra vez
  // 2026-06-01T00:00:00Z  fecha 41.79  vol 97.977
  // 2026-06-01T03:00:00Z  fecha 42.36  vol 51.093   ⇠ idem
  // ```
  //
  // São DOIS registros do mesmo dia: um a meia-noite UTC e outro a meia-noite de Brasília
  // (03:00 UTC no inverno). A base tem dois pipelines de ingestão com convenções diferentes de
  // virada de dia, e nenhum dos dois está "errado" — errado é conviverem na mesma série.
  //
  // ⚠️ **O sintoma NÃO é visível no gráfico**: duas velas quase idênticas lado a lado passam
  // por dois dias parecidos. O estrago aparece em tudo que é DERIVADO: o retorno entre as duas
  // barras do mesmo dia é ruído puro, e foi o que fez a correlação de retornos entre PETR4 e
  // VALE3 sair em −0,04 (duas blue chips do mesmo índice, que andam claramente juntas). Também
  // envenena janela de desempenho, sazonalidade e qualquer média.
  //
  // ⭐ A COLAPSAGEM mantém a barra MAIS TARDIA do par, e a razão é o volume: 63.690 contra
  // 31.318 na amostra acima mostra que os dois registros cobrem RECORTES diferentes do dia. O
  // último a fechar é o que mais se aproxima do fechamento da sessão — e escolher a primeira
  // daria o fechamento de um dia parcial.
  //
  // ⚠️ Só para período DIÁRIO ou maior. Em 5min os baldes são alinhados por `floor(epoch/300)`
  // e não há ambiguidade; aplicar a colapsagem lá fundiria barras legítimas.
  if (periodSeconds !== undefined && periodSeconds >= 86_400 && barras.length > 1) {
    const colapsadas: Bar[] = [];
    for (const b of barras) {
      const anterior = colapsadas[colapsadas.length - 1];
      if (anterior !== undefined && b.time - anterior.time < FOLGA_MINIMA_D1) {
        colapsadas[colapsadas.length - 1] = b;
        continue;
      }
      colapsadas.push(b);
    }
    return colapsadas;
  }

  return barras;
}
