/**
 * splice-series.core — a EMENDA de duas fontes de barras numa série única.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ POR QUE ESTE ARQUIVO EXISTE SEPARADO, E É AGNÓSTICO DE FONTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este código nasceu dentro de `mt5-bridge.core.ts` e **estava no lugar errado**. Ele não tem
 * uma linha de MT5: recebe duas listas de `Bar` e devolve uma, com as regras de precedência,
 * grade e continuidade. O problema de morar no adaptador do MT5 é concreto — outro projeto que
 * emende arquivo com Cedro, com PNT, com Binance ou com um WebSocket próprio teria de importar
 * `mt5-bridge.core` para usar uma função que nada tem a ver com MT5, e herdaria por tabela o
 * dialeto, o offset de fuso e o vocabulário de período daquela bridge.
 *
 * ⭐ A pergunta que este módulo responde é geral e recorrente: **"tenho um ARQUIVO com o passado
 * e uma fonte AO VIVO com o presente; como faço UMA série sem mentir?"**. A resposta não depende
 * de quem é a fonte.
 *
 * ── O QUE ENTRA POR PARÂMETRO, e por que cada um ─────────────────────────
 *
 * Nada aqui é lido de constante de módulo que o consumidor não possa mudar:
 *
 * | parâmetro | por que é do consumidor, e não nosso |
 * |---|---|
 * | `periodSeconds` | a grade da barra; só quem pediu o dado sabe |
 * | `toleranciaDeSegundos` | fim de semana, feriado e leilão são CALENDÁRIO, e calendário é do mercado, não da biblioteca |
 * | `precedencia` | quem manda no empate depende de qual fonte é canônica NAQUELE arranjo |
 * | `alinhamentoPorBalde` | acima de um dia as fontes discordam do rótulo; abaixo, não |
 *
 * ⚠️ `.core` significa PURO: sem `fetch`, sem relógio, sem estado de módulo. O "agora" nunca é
 * lido aqui. É o que permite testar as regras que podem corromper um gráfico sem rede e sem
 * esperar o pregão abrir.
 */

import type { Bar } from './contracts.js';

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
 * ⚠️⚠️ **E HÁ UM MOTIVO MAIOR QUE O DEGRAU, medido em 17/09/2026: o CONTRATO TEM HISTÓRICO
 * PRÓPRIO, e ele não é o contínuo.** Fechamento diário, arquivo (`WIN`, contínuo ajustado)
 * contra terminal (`WINV26`, o contrato vigente hoje):
 *
 * | dia | arquivo | terminal | erro |
 * |---|---|---|---|
 * | 14/04/2026 | 201.720 | 210.250 | **+4,23 %** |
 * | 14/06/2026 | 173.860 | 177.800 | +2,27 % |
 * | 23/08/2026 | 174.715 | 174.715 | 0,00 % |
 * | 07/09/2026 | 190.025 | 190.025 | 0,00 % |
 *
 * ⭐ A divergência não é ruído: ela DECRESCE até zerar em 23/08, que é quando `WINV26` passou a
 * ser o contrato vigente. Antes disso ele era um futuro de vencimento distante, e futuro
 * distante negocia acima do índice à vista — é a estrutura a termo, não erro de dado.
 *
 * ⚠️ Em WIN, 4,23 % são cerca de **8.000 pontos**. Um gráfico que desenhasse isso poria suporte
 * e resistência em preços onde o mercado nunca esteve, e toda leitura técnica de níveis sairia
 * errada. O corte é o que garante que o passado venha da série contínua, que é a única
 * comparável ao longo do tempo.
 *
 * ⛔ **Não "otimize" removendo o corte** para aproveitar as barras que o terminal já trouxe. Ele
 * não está lá por economia de dado; está lá porque as duas séries só coincidem no presente.
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
  opcoes?: OpcoesDaEmenda,
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
  // ⚠️ `alinhamentoPorBalde` ausente decide pelo período (liga acima de um dia). Ver a nota em
  // `OpcoesDaEmenda`: fontes que viram o dia em fusos diferentes precisam do balde; abaixo de um
  // dia o alinhamento fino é sinal legítimo de grade.
  const porBaldeApenas = opcoes?.alinhamentoPorBalde ?? periodo >= UM_DIA_EM_SEGUNDOS;
  const aoVivoNaGrade =
    periodo > 0 ? filtrarNaGrade(historico, aoVivo, periodo, porBaldeApenas) : aoVivo;
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

  const precedencia: PrecedenciaDaEmenda = opcoes?.precedencia ?? 'CORTE';

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
    if (precedencia === 'CORTE' && corte !== null && k < corte) {
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
      // ⚠️ `'ARQUIVO_VENCE'` mantém a barra do arquivo intacta: o ao vivo não substitui nada
      // que o arquivo já tenha, só acrescenta o que falta.
      if (precedencia !== 'ARQUIVO_VENCE') {
        // ⚠️ RESSALVA DE RÓTULO: com identidade por balde o TEMPO do histórico é preservado (é a
        // convenção dominante da série). Trocar o rótulo de uma barra existente deslocaria o
        // eixo e qualquer desenho ancorado nela.
        porBalde.set(k, porBaldeApenas ? { ...b, time: anterior.time } : b);
      }
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
export const UM_DIA_EM_SEGUNDOS = 86_400;

/**
 * ⭐⭐ Quem manda quando as duas fontes têm a MESMA barra.
 *
 * ⚠️ Precisa ser parâmetro, e não regra fixa, porque depende de qual fonte é canônica NAQUELE
 * arranjo — e isso muda por projeto:
 *
 * - `'CORTE'` — o arquivo manda em tudo até onde ele alcança; o ao vivo só completa daí para
 *   frente, e substitui apenas o ÚLTIMO balde (que pode estar em formação). É o certo quando as
 *   duas fontes cotam instrumentos com preço diferente (série contínua ajustada contra contrato
 *   com vencimento, por exemplo): sem o corte, o ao vivo reescreveria o passado com o preço
 *   dele e a junção apareceria como um degrau no meio do gráfico.
 * - `'AO_VIVO_VENCE'` — o ao vivo manda em toda barra que ele tem. Correto quando as duas fontes
 *   cotam o MESMO instrumento e a ao vivo é simplesmente mais fresca (um arquivo alimentado pelo
 *   mesmo feed, por exemplo).
 * - `'ARQUIVO_VENCE'` — o arquivo manda em toda barra que ele tem, e o ao vivo só acrescenta o
 *   que falta. Correto quando o arquivo passou por consolidação ou ajuste que a fonte ao vivo
 *   não tem.
 *
 * ⚠️ O default é `'CORTE'` porque é o mais conservador: ele nunca reescreve passado.
 */
export type PrecedenciaDaEmenda = 'CORTE' | 'AO_VIVO_VENCE' | 'ARQUIVO_VENCE';

/** Opções da emenda. Todas com default declarado, nenhuma obrigatória. */
export interface OpcoesDaEmenda {
  /**
   * Amplia o limiar de LACUNA, em segundos. Default `0`.
   *
   * ⚠️ É calendário, e calendário é do MERCADO — não da biblioteca. Fim de semana, feriado,
   * recesso e leilão prolongado produzem saltos legítimos, e só o consumidor sabe quais se
   * aplicam ao instrumento dele. Sem tolerância, toda segunda-feira reportaria uma lacuna.
   */
  readonly toleranciaDeSegundos?: number;
  /** Quem manda no empate. Default `'CORTE'` — ver `PrecedenciaDaEmenda`. */
  readonly precedencia?: PrecedenciaDaEmenda;
  /**
   * A identidade da barra é o BALDE de calendário, ignorando o alinhamento fino?
   *
   * `undefined` (default) decide pelo período: **liga acima de um dia, desliga abaixo**.
   *
   * ⭐ A razão é medida e específica de fontes que viram o dia em fusos diferentes: um arquivo
   * que rotula o pregão à meia-noite UTC e um terminal que o rotula à meia-noite local
   * descrevem o MESMO dia com 3 h de diferença. `floor(t / 86400)` dá a mesma chave para os
   * dois; comparar o resto da divisão descartaria o dia inteiro.
   *
   * ⚠️ Abaixo de um dia o alinhamento é sinal legítimo de grade e vale usá-lo — é o que pega
   * barra de 5 min intrusa numa série de 1 h.
   *
   * ⚠️ Passe `true` ou `false` explícito quando conhecer as suas fontes melhor que este
   * default. Duas fontes que concordam do rótulo em D1 ganham precisão com `false`.
   */
  readonly alinhamentoPorBalde?: boolean;
}

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
  porBaldeApenas: boolean,
): readonly Bar[] {
  const ordenado = [...aoVivo].sort((a, b) => a.time - b.time);

  // O alinhamento esperado, tirado do histórico. `null` = não se aplica: ou o histórico está
  // vazio, ou o período é diário e as duas fontes usam convenções diferentes de virada.
  let alinhamento: number | null = null;
  if (historico.length > 0 && !porBaldeApenas) {
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
