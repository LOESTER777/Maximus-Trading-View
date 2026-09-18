/**
 * session-separators.core — a linha vertical que marca o INÍCIO de cada período.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE, E POR QUE NÃO É A GRADE VERTICAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor já tinha grade vertical (`gridVertVisible`), e ela é outra coisa: nasce de
 * `visibleTickIndices`, que distribui marcas a cada ~80 px para ancorar o rótulo do eixo. O
 * espaçamento dela é uma decisão de LEGIBILIDADE, e as linhas caem em barras arbitrárias.
 *
 * ⭐⭐ O separador de sessão responde a outra pergunta: **onde começa o pregão?** Num gráfico de
 * 5 min o operador precisa saber qual bloco de velas é o dia de hoje e onde terminou o de ontem —
 * é o que separa "o preço subiu 800 pontos" de "o preço abriu em gap". A informação é de
 * CALENDÁRIO, não de zoom: ela cai sempre na primeira barra de cada dia, esteja o gráfico
 * apertado ou esticado.
 *
 * ⚠️ E é por isso que as duas coexistem em vez de uma virar opção da outra: ligando a grade para
 * marcar a virada de dia, as linhas apareceriam também no meio do pregão; ligando o separador
 * para servir de grade, o eixo ficaria sem âncora nos dias longos.
 *
 * ── DECISÕES ──────────────────────────────────────────────────────────────
 *
 * ⭐ **A unidade acompanha o período.** Num gráfico intradiário o separador útil é o do DIA; num
 * diário, o do MÊS; num semanal, o do ANO. Marcar o dia num gráfico de 10 anos desenharia 2.500
 * linhas e apagaria as velas. `'auto'` deriva isso do intervalo entre barras — ver
 * `unidadeAutomaticaDeSeparador`.
 *
 * ⚠️ **O fuso é do MERCADO, não da máquina.** O dia do WIN vira à meia-noite de Brasília, e uma
 * máquina em UTC desenharia a linha três horas dentro do pregão anterior. Por isso a resolução
 * passa por `timePartsInZone`, que usa fuso IANA — e não por `floor(t / 86400)` com deslocamento
 * fixo, que erraria em toda data com horário de verão (o Brasil teve até 2019, e a série do
 * arquivo começa em 2005).
 *
 * ⚠️ `.core` = PURO: recebe os tempos e devolve índices. Não conhece canvas, não conhece o estado
 * do eixo, não decide cor. Quem desenha é o renderer, e é ele que sabe se a linha cabe na tela.
 */

import { criarResolvedorDeTempo, type TimeParts } from './time-format.core.js';

/** A unidade de calendário que gera separador. */
export type UnidadeDeSeparador = 'DIA' | 'SEMANA' | 'MES' | 'ANO';

export interface OpcoesDeSeparador {
  /**
   * A unidade. `'auto'` (default) deriva do intervalo entre barras.
   *
   * ⚠️ Explícito vence: um operador que estuda abertura de semana quer `'SEMANA'` num gráfico de
   * 15 min, e nenhuma heurística adivinharia isso.
   */
  readonly unidade?: UnidadeDeSeparador | 'auto';
  /** Fuso IANA do mercado. Default `'America/Sao_Paulo'` (ver `DEFAULT_TIME_ZONE`). */
  readonly timeZone?: string;
}

const SEGUNDOS = { hora: 3600, dia: 86_400, semana: 604_800 } as const;

/**
 * A unidade que faz sentido para um período de barra.
 *
 * ⭐ Os cortes são os do costume de mesa, e a razão é a DENSIDADE de linhas na tela:
 *
 * | período da barra | unidade | linhas num ano de dado |
 * |---|---|---|
 * | até 4 h (intradiário) | `DIA` | ~250 |
 * | até 1 dia | `MES` | 12 |
 * | acima de 1 dia | `ANO` | 1 |
 *
 * ⚠️ Marcar o DIA num gráfico diário daria uma linha por vela — a grade viraria o gráfico. E
 * marcar o MÊS num gráfico de 5 min daria 12 linhas em 18 anos de dado, ou seja, nenhuma
 * informação onde ela mais importa.
 *
 * ⚠️ 4 h e não 1 h no primeiro corte: `H4` ainda é intradiário para quem opera, e um pregão de
 * 9 h 30 tem 2 ou 3 barras de 4 h — a virada de dia continua sendo a marca útil.
 */
export function unidadeAutomaticaDeSeparador(periodoSegundos: number): UnidadeDeSeparador {
  if (!Number.isFinite(periodoSegundos) || periodoSegundos <= 0) return 'DIA';
  if (periodoSegundos <= 4 * SEGUNDOS.hora) return 'DIA';
  if (periodoSegundos <= SEGUNDOS.dia) return 'MES';
  return 'ANO';
}

/**
 * O intervalo MEDIANO entre barras consecutivas, em segundos. `null` sem par utilizável.
 *
 * ⭐ Mediana e não média: fim de semana, feriado e lacuna de coleta produzem intervalos de 3 dias
 * no meio de uma série de 5 min, e a média de uma amostra com esses saltos não descreve nada. A
 * mediana ignora o extremo por construção.
 *
 * ⚠️ Amostra limitada às últimas 400 diferenças: a função é chamada por quadro no pior caso, e
 * ordenar 300 mil elementos a 60 fps não é aceitável. O período de uma série não muda no meio
 * dela — se mudasse, a série estaria misturando grades, que é outro defeito e tem guarda própria.
 */
export function passoMedianoEmSegundos(times: readonly number[]): number | null {
  const n = times.length;
  if (n < 2) return null;
  const inicio = Math.max(1, n - 400);
  const diffs: number[] = [];
  for (let i = inicio; i < n; i += 1) {
    const a = times[i - 1];
    const b = times[i];
    if (a === undefined || b === undefined) continue;
    const d = b - a;
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  diffs.sort((x, y) => x - y);
  const meio = Math.floor(diffs.length / 2);
  return diffs.length % 2 === 1
    ? (diffs[meio] as number)
    : ((diffs[meio - 1] as number) + (diffs[meio] as number)) / 2;
}

/**
 * O índice da SEMANA ISO de uma data (semana começando na SEGUNDA).
 *
 * ⚠️ Derivado das partes já resolvidas no fuso do mercado, e não do epoch: se a virada de semana
 * fosse calculada em UTC, a linha da segunda-feira apareceria no domingo à noite para um mercado
 * em UTC−3.
 *
 * ⭐ A conta é dias-desde-a-época via calendário civil, deslocada em 3 para que a semana comece
 * na segunda — 1970-01-01 foi uma quinta-feira.
 */
function indiceDaSemana(p: TimeParts): number {
  const dias = diasDesdeEpoca(p.year, p.month, p.day);
  return Math.floor((dias + 3) / 7);
}

/**
 * Dias desde 1970-01-01 para uma data civil. `days-from-civil` (Howard Hinnant).
 *
 * ⚠️ Sem `Date`: aqui as partes JÁ estão no fuso do mercado, e criar um `Date` a partir delas
 * reintroduziria o fuso da máquina no cálculo — o erro que este arquivo existe para evitar.
 */
function diasDesdeEpoca(ano: number, mes: number, dia: number): number {
  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes > 2 ? mes - 3 : mes + 9) + 2) / 5) + dia - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  return era * 146_097 + diaDaEra - 719_468;
}

/** A chave de agrupamento de uma barra, na unidade pedida. */
function chaveDaUnidade(p: TimeParts, unidade: UnidadeDeSeparador): number {
  switch (unidade) {
    case 'DIA':
      return diasDesdeEpoca(p.year, p.month, p.day);
    case 'SEMANA':
      return indiceDaSemana(p);
    case 'MES':
      return p.year * 12 + p.month;
    case 'ANO':
      return p.year;
  }
}

/**
 * ⭐⭐ Os ÍNDICES de barra que ABREM uma unidade nova de calendário.
 *
 * A primeira barra da série **não** entra: ela abre a unidade, mas não há nada antes dela para
 * separar, e uma linha na borda esquerda parece moldura do gráfico, não informação.
 *
 * ⚠️ Devolve `[]` — nunca `null` e nunca lança — para qualquer entrada inutilizável. É a
 * disciplina da camada de desenho: o ciclo de render não pode receber exceção, e "não há
 * separador" é resposta legítima (série de um dia só, fuso inválido, série vazia).
 *
 * ⚠️ Varre a série INTEIRA, não a janela visível. O custo é O(n) com uma resolução de fuso por
 * barra, e é por isso que o renderer **não** chama isto por quadro: ele recalcula quando a série
 * muda. Ver a memoização no motor.
 */
export function separadoresDePeriodo(
  times: readonly number[],
  opcoes?: OpcoesDeSeparador,
): number[] {
  const n = times.length;
  if (n < 2) return [];

  const zona = opcoes?.timeZone ?? 'America/Sao_Paulo';
  const pedida = opcoes?.unidade ?? 'auto';
  const unidade =
    pedida === 'auto'
      ? unidadeAutomaticaDeSeparador(passoMedianoEmSegundos(times) ?? SEGUNDOS.dia)
      : pedida;

  // ⭐⭐ UM formatador para a varredura inteira. Ver `criarResolvedorDeTempo`: construir um
  // `Intl.DateTimeFormat` por barra custava 81 µs/barra, e a construção domina o tempo.
  // ⚠️ Fuso inválido devolve `null` aqui e a função sai sem entrar no laço — degradação limpa, sem
  // exceção dentro do que alimenta o ciclo de desenho.
  const resolver = criarResolvedorDeTempo(zona);
  if (resolver === null) return [];

  const indices: number[] = [];
  let anterior: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const t = times[i];
    if (t === undefined) continue;
    const p = resolver(t);
    // ⚠️ Instante irresolvível não interrompe a varredura nem inventa separador: pula. Uma barra
    // com tempo corrompido no meio da série não pode apagar as marcas do resto dela.
    if (p === null) continue;
    const chave = chaveDaUnidade(p, unidade);
    if (anterior !== null && chave !== anterior) indices.push(i);
    anterior = chave;
  }
  return indices;
}
