/**
 * market-day — o dia de pregao, no calendario do MERCADO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O BUG QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A grade de profundidade e recortada por dia. A pergunta "que dia e hoje?"
 * parece trivial e nao e: a resposta depende do fuso do MERCADO, nao do fuso de
 * quem olha a tela.
 *
 * Um pregao brasileiro das 09:00 as 18:00 BRT ocupa 12:00-21:00 UTC. Um operador
 * em Tóquio abrindo a tela as 08:00 JST esta as 20:00 BRT do dia ANTERIOR — o
 * pregao esta em andamento. Se o dia vier do relogio local dele, a consulta pede
 * o dia seguinte e volta vazia, no meio do pregao, sem explicacao.
 *
 * A origem resolvia isso fixando `America/Sao_Paulo`. Correto para uma mesa
 * brasileira, insuficiente para uma biblioteca: o fuso do mercado passa a ser
 * parametro, e o de Sao Paulo continua o default.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NENHUMA ARITMETICA DE FUSO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tudo aqui deriva de `Intl.DateTimeFormat` com `timeZone` explicito. Nao ha
 * `- 3 * 3600_000` em lugar nenhum, e nao deve passar a haver.
 *
 * Somar deslocamento a mao funciona onze meses por ano e erra na virada do
 * horario de verao — que no Brasil e nos EUA cai em datas diferentes, e no Brasil
 * mudou de regra. O projeto de origem registra ter errado conversao em ±3 h mais
 * de uma vez exatamente por esse caminho.
 *
 * Funcoes PURAS: o instante de referencia sempre chega por parametro, nunca de
 * `Date.now()` interno. E o que as torna testaveis sem congelar relogio.
 */

/** Formato do dia de mercado: `YYYY-MM-DD`. */
const PADRAO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fuso de mercado default: B3. */
export const DEFAULT_MARKET_TIME_ZONE = 'America/Sao_Paulo';

/**
 * O dia de mercado de um instante, no fuso dado.
 *
 * @param nowMs    Instante de referencia, epoch ms.
 * @param timeZone Fuso IANA do mercado. Default: `America/Sao_Paulo`.
 * @returns `'YYYY-MM-DD'`, ou `null` se o instante ou o fuso nao servem.
 *
 * @example
 * // 2026-01-02 01:00 UTC ainda e 01/01 em Sao Paulo (UTC-3).
 * marketDayOf(Date.UTC(2026, 0, 2, 1, 0), 'America/Sao_Paulo'); // '2026-01-01'
 * marketDayOf(Date.UTC(2026, 0, 2, 1, 0), 'UTC');               // '2026-01-02'
 */
export function marketDayOf(
  nowMs: number,
  timeZone: string = DEFAULT_MARKET_TIME_ZONE,
): string | null {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  try {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(nowMs));

    const pega = (t: Intl.DateTimeFormatPartTypes): string =>
      partes.find((p) => p.type === t)?.value ?? '';

    const dia = `${pega('year')}-${pega('month')}-${pega('day')}`;
    return PADRAO_DIA.test(dia) ? dia : null;
  } catch {
    // Fuso que o motor rejeita. `null` significa "nao sei", e quem chama decide
    // — melhor que devolver o dia errado com aparencia de certo.
    return null;
  }
}

/**
 * O dia dado e o dia corrente no mercado?
 *
 * Importa porque o dia corrente e o unico que ainda cresce: e o unico que
 * justifica reconsulta periodica. Reconsultar dia fechado gasta banda para
 * receber a mesma resposta.
 */
export function isCurrentMarketDay(
  day: string,
  nowMs: number,
  timeZone: string = DEFAULT_MARKET_TIME_ZONE,
): boolean {
  const hoje = marketDayOf(nowMs, timeZone);
  return hoje !== null && hoje === day;
}

/** O dia e sintaticamente valido? Nao diz se houve pregao. */
export function isValidMarketDay(day: unknown): day is string {
  if (typeof day !== 'string' || !PADRAO_DIA.test(day)) return false;
  // Rejeita data impossivel (`2026-02-31`) sem depender de fuso: comparamos o
  // texto com o que o proprio `Date` produz em UTC para os mesmos componentes.
  const [ano, mes, dia] = day.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  );
}

/**
 * Rotulo do dia para exibicao, com o separador do locale pedido.
 *
 * @example
 * marketDayLabel('2026-08-28');                 // '28/08/2026'
 * marketDayLabel('2026-08-28', 'iso');          // '2026-08-28'
 */
export function marketDayLabel(day: string, formato: 'dmy' | 'iso' = 'dmy'): string | null {
  if (!isValidMarketDay(day)) return null;
  if (formato === 'iso') return day;
  const [ano, mes, dia] = day.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Desloca um dia de mercado em N dias de CALENDARIO.
 *
 * ⚠️ Dia de calendario, nao dia de pregao. Recuar 1 a partir de segunda devolve
 * domingo, que nao teve pregao. Pular fim de semana e feriado exige calendario da
 * bolsa, que esta biblioteca deliberadamente nao tem — feriado de B3, de CME e de
 * NYSE sao conjuntos diferentes e mudam por ano, e manter isso aqui seria manter
 * dado que envelhece sem ninguem perceber.
 *
 * Quem precisa do pregao anterior consulta e trata `INDISPONIVEL`, ou traz o
 * calendario da propria fonte.
 */
export function shiftMarketDay(day: string, deltaDias: number): string | null {
  if (!isValidMarketDay(day)) return null;
  if (!Number.isInteger(deltaDias)) return null;
  const [ano, mes, dia] = day.split('-').map(Number) as [number, number, number];
  // Aritmetica em UTC puro: sem fuso envolvido, nao ha horario de verao para
  // errar. O resultado e um rotulo de calendario, nao um instante.
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + deltaDias);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
