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
 * ⭐⭐ **CORRIGIDO em 18/09/2026: `1min` e `2min` EXISTEM, e a versão anterior deste mapa
 * afirmava o contrário.**
 *
 * ⚠️ O erro tinha uma causa que vale registrar, porque ela se repete: a afirmação *"a base
 * materializa 5min do tick e deriva o resto"* veio da documentação da própria base, e eu a
 * tratei como inventário. Documentação descreve a INTENÇÃO do pipeline; o inventário é o que
 * a rota devolve. Medido, pedindo:
 *
 * ```
 * tf       meses com dado   barras/mês   agressor        janela
 * 1min     39 (2023-06 →)   ~11.300      100 % até 05/2026   09:00 → 18:31 BRT
 * 2min     39 (2023-06 →)   ~5.650       100 % até 05/2026   09:00 → 18:30 BRT
 * ```
 *
 * ⭐ E o volume FECHA com o de 5min balde a balde (medido: 69.478 contra 69.478), o que prova
 * que é a mesma origem de tick, não uma segunda ingestão. `M1` é o período que mais se usa para
 * operar o mini índice, e a biblioteca estava mandando quem o pedisse para o terminal — que
 * serve 5 h de passado contra os 3 anos que estavam aqui.
 *
 * ⚠️ **Há um buraco, e ele está declarado no perfil de qualidade:** 06/2026 vem VAZIO e 07/2026
 * traz 1.236 barras onde caberiam ~12.000. `1min` e `2min` começam em 2023-06 (antes disso a
 * base não tem: 2015, 2018 e 2021 devolvem vazio).
 *
 * ⚠️ Continuam NÃO existindo `M30` e `H4` como série própria — a rota aceita os rótulos e
 * responde, mas com outra origem: medido, 79,5 % de agressor em 30min e 51,6 % em 4h contra
 * 100 % em 5min, e o balde de 4h cai em 05:00 BRT, fora do pregão. Os dois são AGREGÁVEIS do
 * que existe (`rollupBars`), e a decisão de agregar é do consumidor.
 */
export const PERIODOS_DA_MESA: ReadonlyMap<number, string> = new Map([
  [60, '1min'],
  [120, '2min'],
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

export interface OpcoesDeLeituraDaMesa {
  /**
   * O período pedido, em segundos. Necessário para colapsar o `D1` de dupla convenção.
   *
   * ⚠️ Não é inferido do dado: inferir erraria justamente na série de uma barra só, e a decisão
   * de colapsar é irreversível.
   */
  readonly periodSeconds?: number;
  /**
   * Fração mínima do volume classificada por agressor para o delta valer.
   * Default `COBERTURA_MINIMA_DE_AGRESSOR` (0,9).
   *
   * ⚠️ Parametrizado porque a qualidade da classificação é da FONTE, e outro projeto lê de outra
   * fonte. Ver a nota longa da constante para a auditoria que fixou o default.
   */
  readonly coberturaMinimaDeAgressor?: number;
  /**
   * ⭐⭐ Qual dos dois registros diários do mesmo pregão fica. Default `'MAIS_TARDIO'`.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * A AFERIÇÃO POR ÂNCORA EXTERNA, E O CUSTO QUE ELA EXPÔS
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ⭐ Medido em 18/09/2026 contra o dia apurado somando as barras de `1h` — uma âncora
   * INDEPENDENTE das duas convenções de D1, porque a série intradiária vem da agregação de
   * tick e não participa da disputa. Comparar os dois registros entre si não decidiria nada.
   *
   * ```
   * ativo   dias com par   quem acerta o CLOSE            volume / agressor
   * WIN          40        o MAIS TARDIO, 40/40 (0,000 %)  tardio = 100 % do apurado, com agressor
   *                        o mais cedo erra 3,7 a 5,9 %    cedo   =  32 % do apurado, SEM agressor
   * PETR4        43        o MAIS TARDIO, 43/43 (0,000 %)  os dois iguais no volume, nenhum com agressor
   * WDO          43        o MAIS TARDIO acerta            tardio =  25 % do apurado, SEM agressor
   *                        (o cedo erra só 0,01–0,03 %)    cedo   =  85 % do apurado, COM agressor
   * ```
   *
   * ⇒ `'MAIS_TARDIO'` é o default porque **acerta o preço nos três ativos**, e preço errado num
   * gráfico é o defeito que não perdoa. Mas no WDO ele paga um preço medido: **201 dos 785 pares**
   * da série têm o agressor no registro mais CEDO, e mantendo o tardio esses 201 dias diários
   * ficam sem delta.
   *
   * ⭐ `'PREFERIR_AGRESSOR'` inverte a escolha quando — e só quando — um dos dois tem agressor e
   * o outro não. Para quem lê fluxo em D1 no WDO, isso troca 0,03 % de erro no fechamento por
   * 201 dias de delta. É decisão do consumidor, não da biblioteca: as duas respostas são
   * defensáveis e dependem do que a tela vai mostrar.
   *
   * ⚠️ Nenhuma das duas políticas SOMA os registros. Somar fabricaria um volume que não existiu
   * e um close que não é de nenhuma das séries — o mesmo motivo pelo qual `emendarSeries` proíbe
   * misturar duas fontes dentro de uma barra.
   */
  readonly politicaDeD1?: 'MAIS_TARDIO' | 'PREFERIR_AGRESSOR';
}

/**
 * Qual dos dois registros diários do mesmo pregão fica. Ver `politicaDeD1`.
 *
 * ⚠️ Exportado para ser testável em isolamento: a escolha é a parte da colapsagem em que um
 * erro é invisível na tela (duas velas parecidas) e caro em tudo que é derivado dela.
 */
export function escolherDoParDiario(
  cedo: Bar,
  tardio: Bar,
  politica: 'MAIS_TARDIO' | 'PREFERIR_AGRESSOR' = 'MAIS_TARDIO',
): Bar {
  if (politica !== 'PREFERIR_AGRESSOR') return tardio;
  const cedoTem = cedo.buyVolume !== undefined && cedo.sellVolume !== undefined;
  const tardioTem = tardio.buyVolume !== undefined && tardio.sellVolume !== undefined;
  // ⭐ Só o caso ASSIMÉTRICO inverte. Quando os dois têm agressor, ou nenhum tem, a política
  // não tem informação nova e cai no default aferido — que é o mais tardio. Inverter também
  // no caso simétrico trocaria o preço correto por nada.
  if (cedoTem && !tardioTem) return cedo;
  return tardio;
}

export function parseBarrasDaMesa(
  body: unknown,
  opcoes?: number | OpcoesDeLeituraDaMesa,
): readonly Bar[] | null {
  // ⚠️ Aceita `number` para não quebrar o call site antigo (`parseBarrasDaMesa(body, 300)`), que
  // existe em consumidor e em teste. Compatibilidade explícita é melhor que uma migração
  // silenciosa que passa o objeto onde se esperava número.
  const periodSeconds = typeof opcoes === 'number' ? opcoes : opcoes?.periodSeconds;
  const coberturaMinima = typeof opcoes === 'number' ? undefined : opcoes?.coberturaMinimaDeAgressor;
  const politicaDeD1 = (typeof opcoes === 'number' ? undefined : opcoes?.politicaDeD1) ?? 'MAIS_TARDIO';
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
    const usaAgressor = agressorUtilizavel(volume, compraCrua, vendaCrua, coberturaMinima);
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
  // ⭐⭐ A COLAPSAGEM mantém a barra MAIS TARDIA do par, e isso foi AFERIDO POR ÂNCORA
  // EXTERNA — não pelo raciocínio de volume que estava escrito aqui antes.
  //
  // ⚠️ O argumento antigo era "63.690 contra 31.318, logo o tardio cobre mais do dia". Ele
  // estava CERTO na conclusão e ERRADO no método: comparava os dois suspeitos entre si. A
  // aferição correta usa o dia apurado somando as barras de `1h` (que vêm da agregação de
  // tick e não participam da disputa). Medido em 18/09/2026:
  //
  // ```
  // WIN    o registro tardio acerta o close em 40/40 dias, erro 0,000 %; o cedo erra 3,7–5,9 %
  // PETR4  o tardio acerta em 43/43; o cedo erra ~1,35 %
  // WDO    o tardio acerta o close, mas traz 25 % do volume e nenhum agressor
  // ```
  //
  // ⭐ E a divergência tem DATA: até 2026-01 os dois registros do WIN tinham close IDÊNTICO
  // (mediana 0,000 %, máximo 0,00 % em 3 anos). Em 2026-02 a mediana salta para 3,07 %, e os
  // pares cessam em 29/05/2026. Ou seja: para quase toda a série a escolha é indiferente, e
  // ela só passa a importar exatamente na parte recente — a que o operador olha.
  //
  // ⚠️ O custo, medido: no WDO **201 dos 785 pares** têm o agressor no registro mais CEDO, e
  // manter o tardio deixa esses 201 dias sem delta. `politicaDeD1: 'PREFERIR_AGRESSOR'`
  // inverte a escolha para quem prefere fluxo a 0,03 % de precisão no fechamento.
  //
  // ⚠️ Só para período DIÁRIO ou maior. Em 5min os baldes são alinhados por `floor(epoch/300)`
  // e não há ambiguidade; aplicar a colapsagem lá fundiria barras legítimas.
  if (periodSeconds !== undefined && periodSeconds >= 86_400 && barras.length > 1) {
    const colapsadas: Bar[] = [];
    for (const b of barras) {
      const anterior = colapsadas[colapsadas.length - 1];
      if (anterior !== undefined && b.time - anterior.time < FOLGA_MINIMA_D1) {
        colapsadas[colapsadas.length - 1] = escolherDoParDiario(anterior, b, politicaDeD1);
        continue;
      }
      colapsadas.push(b);
    }
    return colapsadas;
  }

  return barras;
}
