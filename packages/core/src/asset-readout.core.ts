/**
 * asset-readout.core — a LEITURA do ativo: desempenho, sazonalidade e termômetro técnico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O painel lateral que o operador pediu, com as palavras dele: *"widgets de como está o
 * nosso ativo"* — desempenho por janela (1S, 1M, 3M, 6M, ano, 1A), sazonalidade sobreposta
 * por ano, e um termômetro que resume os indicadores em uma palavra.
 *
 * ⭐ Tudo aqui sai das BARRAS que já estão na tela. Nenhuma fonte nova, nenhuma requisição
 * nova: é releitura do mesmo dado em outra pergunta, e é isso que torna o painel barato.
 *
 * ⚠️ A quarta caixa da referência (estrutura a termo de volatilidade implícita) NÃO está
 * aqui, e a ausência é declarada: ela exige cadeia de opções — preço de calls e puts por
 * vencimento e por strike — que não existe em nenhuma base deste projeto. Estimá-la a
 * partir de volatilidade histórica seria inventar um número com nome de outro: IV é o que o
 * mercado PAGA pelo futuro, HV é o que já aconteceu. Um gráfico rotulado "ATM IV" mostrando
 * desvio-padrão passado é pior que caixa vazia.
 *
 * ⚠️ `.core` = PURO. Sem relógio próprio (o "agora" entra por parâmetro), sem DOM, sem
 * sorteio. A mesma entrada dá sempre a mesma saída — o que faz o painel ser testável sem
 * congelar tempo global.
 */

/** Uma barra, no mínimo que estas contas exigem. `time` em SEGUNDOS. */
export interface BarraDeLeitura {
  readonly time: number;
  readonly close: number;
  readonly high?: number;
  readonly low?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Desempenho por janela
// ═════════════════════════════════════════════════════════════════════════════

/** Os rótulos das janelas, na ordem de leitura da referência. */
export type JanelaDeDesempenho = '1S' | '1M' | '3M' | '6M' | 'ANO' | '1A';

export const JANELAS_DE_DESEMPENHO: readonly JanelaDeDesempenho[] = [
  '1S',
  '1M',
  '3M',
  '6M',
  'ANO',
  '1A',
];

/** Rótulo curto para a tela. `ANO` é o ano corrente (o "YTD" da referência). */
export const ROTULO_DA_JANELA: Readonly<Record<JanelaDeDesempenho, string>> = {
  '1S': '1 sem',
  '1M': '1 mês',
  '3M': '3 meses',
  '6M': '6 meses',
  ANO: 'no ano',
  '1A': '1 ano',
};

const DIA = 86_400;

/** Quantos dias de CALENDÁRIO cada janela olha para trás. `ANO` é caso próprio. */
const DIAS_DA_JANELA: Readonly<Record<Exclude<JanelaDeDesempenho, 'ANO'>, number>> = {
  '1S': 7,
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1A': 365,
};

export interface DesempenhoDaJanela {
  readonly janela: JanelaDeDesempenho;
  /** Variação percentual, ou `null` quando não há histórico suficiente. */
  readonly variacao: number | null;
  /** O instante da barra usada como referência de início, ou `null`. */
  readonly desde: number | null;
}

/**
 * O desempenho em cada janela, a partir do fechamento.
 *
 * ⚠️ **A janela é de CALENDÁRIO e a barra é a PRIMEIRA a partir do limite** — não "a barra
 * de N posições atrás". Contar posições daria janelas erradas em toda série real: o
 * mercado fecha em fim de semana e feriado, e 30 barras diárias são ~43 dias corridos. Um
 * "1 mês" que na verdade mede seis semanas é o tipo de erro que ninguém percebe e que
 * envenena qualquer comparação.
 *
 * ⚠️ **Janela sem histórico devolve `null`, nunca zero.** Zero afirma "não variou", e a
 * verdade é "não sei" — num ativo com 3 meses de série, o campo de 1 ano tem de aparecer
 * vazio em vez de dizer que o ano foi estável. É a mesma regra de `null` do resto do
 * projeto.
 *
 * ⭐ `ANO` (o YTD) não é uma janela de N dias: é *desde o primeiro fechamento do ano civil
 * corrente*. Aproximá-lo por 365 dias daria o número errado em janeiro por um fator enorme
 * — em 3 de janeiro, "no ano" são dois dias, não doze meses.
 *
 * @param bars Barras em ordem CRESCENTE de tempo.
 * @param agoraSegundos O instante de referência. Entra por parâmetro porque `.core` é puro.
 */
export function desempenhoPorJanela(
  bars: readonly BarraDeLeitura[],
  agoraSegundos: number,
): readonly DesempenhoDaJanela[] {
  const vazio = JANELAS_DE_DESEMPENHO.map((janela) => ({ janela, variacao: null, desde: null }));
  if (bars.length < 2 || !Number.isFinite(agoraSegundos)) return vazio;

  const ultima = bars[bars.length - 1];
  if (ultima === undefined || !Number.isFinite(ultima.close) || ultima.close === 0) return vazio;

  return JANELAS_DE_DESEMPENHO.map((janela) => {
    const limite =
      janela === 'ANO' ? inicioDoAnoUtc(agoraSegundos) : agoraSegundos - DIAS_DA_JANELA[janela] * DIA;

    // ⭐⭐ A SÉRIE TEM DE ALCANÇAR O LIMITE. Sem esta guarda, uma série de 90 dias
    // responderia a janela de 1 ano medindo os 90 dias que ela tem — e rotulando de "1
    // ano". O teste pegou exatamente isso: o número saía plausível (89%) e era de outra
    // pergunta. Medir menos e rotular como mais é pior que não responder.
    //
    // ⚠️ A tolerância existe porque a primeira barra raramente cai no dia exato do limite:
    // fim de semana, feriado e o primeiro pregão do ativo. `max(3 dias, 3% da janela)` cobre
    // um fim de semana longo nas janelas curtas e ~11 dias na de um ano, sem chegar perto de
    // deixar meio mês passar por ano inteiro.
    const primeira = bars[0];
    const tolerancia = Math.max(3 * DIA, (agoraSegundos - limite) * 0.03);
    if (primeira === undefined || primeira.time > limite + tolerancia) {
      return { janela, variacao: null, desde: null };
    }

    const inicio = barraDeReferencia(bars, limite);
    if (inicio === null || !Number.isFinite(inicio.close) || inicio.close === 0) {
      return { janela, variacao: null, desde: null };
    }
    // ⚠️ Barra de início IGUAL à última significa que a janela inteira cabe numa barra: não
    // há variação a medir, e `0%` seria afirmação falsa. Acontece de verdade em `1S` num
    // gráfico diário recém-carregado.
    if (inicio.time === ultima.time) return { janela, variacao: null, desde: null };

    // ⭐ E o PONTO DE PARTIDA não pode ser muito mais velho que a janela. É a segunda metade
    // da mesma honestidade, e a primeira versão errou aqui: numa série com barras em −380 d
    // e hoje, a janela de "1 semana" encontrava como partida o fechamento de −380 d e
    // reportava +50% — a variação de um ano inteiro rotulada como semanal. Não há barra
    // NENHUMA dentro daquela semana; a resposta certa é "não sei".
    //
    // O limite de uma janela inteira de folga é o que separa "a partida caiu num fim de
    // semana" (aceitável) de "não há dado no período" (recusar).
    const tamanhoDaJanela = agoraSegundos - limite;
    if (Math.abs(inicio.time - limite) > tamanhoDaJanela) {
      return { janela, variacao: null, desde: null };
    }

    return {
      janela,
      variacao: ((ultima.close - inicio.close) / inicio.close) * 100,
      desde: inicio.time,
    };
  });
}

/**
 * A barra que serve de PONTO DE PARTIDA da janela: a última com `time <= limite`.
 *
 * ⭐⭐ É a ÚLTIMA barra ANTES do limite, e não a primeira depois — e a diferença não é
 * cosmética. Dois testes reprovaram na primeira versão por causa disso:
 *
 * Numa série esparsa (barras em −380 d e hoje), a janela de 1 ano tem limite em −365 d. "A
 * primeira barra depois do limite" é a barra de HOJE — a própria barra final — e a variação
 * saía nula, como se não houvesse histórico. Mas há: o fechamento de −380 d é exatamente o
 * preço de onde o ano começou. A convenção de mesa é comparar com o último fechamento
 * conhecido ANTES da janela, e é ela que dá o número certo.
 *
 * ⚠️ Sem nenhuma barra antes do limite (a série começa DENTRO da janela, dentro da
 * tolerância de alcance), cai na primeira barra da série: é o melhor ponto de partida que
 * existe, e a guarda de alcance já garantiu que ele não está longe do limite.
 */
function barraDeReferencia(
  bars: readonly BarraDeLeitura[],
  limite: number,
): BarraDeLeitura | null {
  // Busca binária pelo primeiro índice com `time > limite`; a referência é o anterior.
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = bars[mid];
    if (b !== undefined && b.time <= limite) lo = mid + 1;
    else hi = mid;
  }
  return bars[lo - 1] ?? bars[0] ?? null;
}

/** Meia-noite UTC de 1º de janeiro do ano do instante dado. */
function inicioDoAnoUtc(segundos: number): number {
  const d = new Date(segundos * 1000);
  return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
}

// ═════════════════════════════════════════════════════════════════════════════
// Sazonalidade
// ═════════════════════════════════════════════════════════════════════════════

export interface PontoDeSazonalidade {
  /** Dia do ano, 1 a 366. É o eixo comum entre anos diferentes. */
  readonly dia: number;
  /** Retorno acumulado desde o primeiro fechamento do ano, em %. */
  readonly acumulado: number;
}

export interface AnoDeSazonalidade {
  readonly ano: number;
  readonly pontos: readonly PontoDeSazonalidade[];
}

/**
 * Sazonalidade: o retorno acumulado de cada ano, sobreposto num eixo de dia do ano.
 *
 * ⭐⭐ **A NORMALIZAÇÃO É O PONTO, e não um detalhe de apresentação.** Sobrepor PREÇO de
 * anos diferentes não comunica nada: o WIN saiu de 27 mil em 2005 para 188 mil em 2026, e o
 * gráfico viraria seis linhas paralelas empilhadas por nível. O que se compara é o CAMINHO —
 * retorno acumulado desde o primeiro fechamento do ano, todos partindo de zero.
 *
 * ⚠️ O eixo é **dia do ano**, não índice de barra. Anos têm número diferente de pregões
 * (feriado cai em dia de semana diferente, ano bissexto), e indexar por posição desalinharia
 * os anos progressivamente — em dezembro o desvio passa de uma semana.
 *
 * ⚠️ Ano com UMA barra só é descartado: não há caminho a traçar, e um ponto solto em zero
 * sugeriria um ano inteiro sem variação.
 *
 * @param anosDesejados Quantos anos mais recentes devolver. `0` ou negativo devolve vazio.
 */
export function sazonalidadePorAno(
  bars: readonly BarraDeLeitura[],
  anosDesejados = 3,
): readonly AnoDeSazonalidade[] {
  if (bars.length === 0 || anosDesejados <= 0) return [];

  const porAno = new Map<number, BarraDeLeitura[]>();
  for (const b of bars) {
    if (!Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
    const ano = new Date(b.time * 1000).getUTCFullYear();
    const lista = porAno.get(ano);
    if (lista === undefined) porAno.set(ano, [b]);
    else lista.push(b);
  }

  const anos = [...porAno.keys()].sort((a, b) => b - a).slice(0, Math.floor(anosDesejados));

  const saida: AnoDeSazonalidade[] = [];
  // Devolve do mais ANTIGO para o mais recente: é a ordem de desenho que deixa o ano
  // corrente por cima, e ele é o que o operador está lendo.
  for (const ano of anos.sort((a, b) => a - b)) {
    const lista = porAno.get(ano) ?? [];
    if (lista.length < 2) continue;
    const base = lista[0];
    if (base === undefined || base.close === 0) continue;

    const pontos: PontoDeSazonalidade[] = [];
    for (const b of lista) {
      pontos.push({
        dia: diaDoAnoUtc(b.time),
        acumulado: ((b.close - base.close) / base.close) * 100,
      });
    }
    saida.push({ ano, pontos });
  }
  return saida;
}

/** Dia do ano (1 a 366) em UTC. */
function diaDoAnoUtc(segundos: number): number {
  const d = new Date(segundos * 1000);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - inicio) / (DIA * 1000)) + 1;
}

// ═════════════════════════════════════════════════════════════════════════════
// Termômetro técnico
// ═════════════════════════════════════════════════════════════════════════════

/** O voto de um indicador. `null` = sem opinião (aquecendo, sem dado). */
export type VotoTecnico = 'COMPRA' | 'VENDA' | 'NEUTRO' | null;

/** As cinco faixas do termômetro, do vendedor ao comprador. */
export type LeituraTecnica =
  | 'VENDA_FORTE'
  | 'VENDA'
  | 'NEUTRO'
  | 'COMPRA'
  | 'COMPRA_FORTE';

export const ROTULO_TECNICO: Readonly<Record<LeituraTecnica, string>> = {
  VENDA_FORTE: 'Venda forte',
  VENDA: 'Venda',
  NEUTRO: 'Neutro',
  COMPRA: 'Compra',
  COMPRA_FORTE: 'Compra forte',
};

export interface TermometroTecnico {
  /** Consenso em `-1..+1`. `0` é o centro do ponteiro. */
  readonly escore: number;
  readonly leitura: LeituraTecnica;
  readonly compras: number;
  readonly vendas: number;
  readonly neutros: number;
  /** Quantos indicadores tinham opinião. `0` ⇒ `NEUTRO` por ausência, não por equilíbrio. */
  readonly votantes: number;
}

/**
 * Resume votos de indicadores numa leitura só.
 *
 * ⚠️ **NEUTRO entra no denominador; `null` NÃO.** A distinção decide o número: um indicador
 * que olhou e não viu direção é evidência de indecisão e tem de diluir o consenso; um
 * indicador que ainda está aquecendo não olhou, e contá-lo empurraria a leitura para o
 * centro por uma razão que não é o mercado. Foi o erro que a primeira versão desta função
 * cometeu.
 *
 * ⚠️ **Zero votantes devolve `NEUTRO` com `votantes: 0`**, e quem mostra tem de dizer isso —
 * "Neutro" com nenhum indicador ativo parece um diagnóstico e é ausência de diagnóstico. É
 * por isso que `votantes` faz parte do retorno em vez de ficar implícito no escore.
 *
 * ⭐ Os limites (0,5 e 0,15) são declarados aqui e não configuráveis de propósito: um
 * termômetro cujo "compra forte" muda de significado por configuração deixa de ser
 * comparável entre ativos, que é a única coisa que ele oferece.
 */
export function termometroTecnico(votos: readonly VotoTecnico[]): TermometroTecnico {
  let compras = 0;
  let vendas = 0;
  let neutros = 0;
  for (const v of votos) {
    if (v === 'COMPRA') compras += 1;
    else if (v === 'VENDA') vendas += 1;
    else if (v === 'NEUTRO') neutros += 1;
  }
  const votantes = compras + vendas + neutros;
  if (votantes === 0) {
    return { escore: 0, leitura: 'NEUTRO', compras, vendas, neutros, votantes };
  }

  const escore = (compras - vendas) / votantes;
  const leitura: LeituraTecnica =
    escore >= 0.5
      ? 'COMPRA_FORTE'
      : escore >= 0.15
        ? 'COMPRA'
        : escore <= -0.5
          ? 'VENDA_FORTE'
          : escore <= -0.15
            ? 'VENDA'
            : 'NEUTRO';

  return { escore, leitura, compras, vendas, neutros, votantes };
}

/**
 * Voto de um oscilador com faixa conhecida (RSI, estocástico, MFI).
 *
 * ⚠️ A convenção é a de MESA e é o oposto da intuição: sobrecomprado é voto de VENDA. Quem
 * lê "RSI 78, logo compra" está lendo força como oportunidade, e o termômetro existe para
 * resumir a leitura consagrada, não para inventar uma.
 *
 * `null` entra e `null` sai: indicador aquecendo não vota.
 */
export function votoDeOscilador(
  valor: number | null,
  sobrevendido = 30,
  sobrecomprado = 70,
): VotoTecnico {
  if (valor === null || !Number.isFinite(valor)) return null;
  if (valor <= sobrevendido) return 'COMPRA';
  if (valor >= sobrecomprado) return 'VENDA';
  return 'NEUTRO';
}

/**
 * Voto por posição do preço em relação a uma média.
 *
 * Acima da média é tendência de alta; abaixo, de baixa. A `tolerancia` em % existe porque
 * preço encostado na média não é sinal: sem ela, o voto piscaria entre compra e venda a
 * cada tick numa lateralização, e um termômetro que oscila por ruído é ignorado.
 */
export function votoDeMedia(
  preco: number | null,
  media: number | null,
  toleranciaPct = 0.1,
): VotoTecnico {
  if (preco === null || media === null) return null;
  if (!Number.isFinite(preco) || !Number.isFinite(media) || media === 0) return null;
  const distancia = ((preco - media) / media) * 100;
  if (distancia > toleranciaPct) return 'COMPRA';
  if (distancia < -toleranciaPct) return 'VENDA';
  return 'NEUTRO';
}
