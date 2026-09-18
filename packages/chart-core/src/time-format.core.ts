/**
 * time-format.core — formatacao PURA de instante para o eixo de tempo, e escolha
 * do passo de rotulo conforme o zoom. Sem DOM, sem terceiros.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE UM FORMATADOR LOCAL, E NAO O DE @robustus/charts-core
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pacote de nucleos puros (`@robustus/charts-core`, com 's') ja tem
 * `instant-format.core.ts` com `makeClockFormatter`. Nao o importamos aqui de
 * proposito: o grafo de dependencia deste projeto proibe `chart-core` (o motor)
 * de depender de qualquer outro pacote — ele e o motor, e carregar um pacote
 * irmao so pela formatacao criaria acoplamento onde havia isolamento.
 *
 * Entao replicamos a MESMA disciplina aqui, em versao minima: `Intl.DateTimeFormat`
 * com `timeZone` explicito, layout montado parte por parte para nao depender do
 * locale da maquina, e ZERO aritmetica de fuso a mao. A origem registra ter errado
 * conversao em ±3 h ao somar deslocamento manualmente; epoch entra inteiro no
 * motor de internacionalizacao e sai formatado.
 *
 * ⚠️ Aqui o instante chega em SEGUNDOS (a convencao de `Time` do motor —
 * `contracts.ts`), nao em milissegundos como no pacote de nucleos. Multiplicamos
 * por 1000 na fronteira, uma vez, com comentario — para nao repetir o erro de
 * adivinhar a unidade.
 */

/** Fuso default: B3 / horario de Brasilia. Igual ao default do pacote de nucleos. */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Campos de um instante ja resolvidos no fuso pedido.
 *
 * Extrair as partes uma vez e reusar evita criar um `Intl.DateTimeFormat` por
 * rotulo — no zoom-in o eixo pode ter dezenas de rotulos por quadro.
 */
export interface TimeParts {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
  readonly second: number; // 0..59
}

/**
 * Resolve um epoch (SEGUNDOS) para as partes de data/hora no fuso pedido.
 *
 * Devolve `null` para instante inutilizavel (NaN, Infinity, fora da faixa de data
 * valida) ou fuso que o motor rejeita. `null` = "desconhecido": a camada de
 * desenho escreve nada em vez de inventar horario, e nunca lanca dentro do ciclo
 * de render.
 */
export function timePartsInZone(epochSeconds: number, timeZone: string): TimeParts | null {
  const resolver = criarResolvedorDeTempo(timeZone);
  return resolver === null ? null : resolver(epochSeconds);
}

/**
 * ⭐⭐ Um resolvedor REUSÁVEL: cria o formatador UMA vez e devolve a função que o usa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O CUSTO QUE ISTO CORRIGE, MEDIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ `timePartsInZone` construía um `Intl.DateTimeFormat` a **cada chamada** — apesar de o
 * cabeçalho deste arquivo declarar que `TimeParts` existe justamente para evitar isso. Com poucos
 * rótulos de eixo por quadro, ninguém notou. Ao varrer uma série inteira em busca de virada de
 * dia, o custo apareceu: **6.840 barras em 554 ms**, ou 81 µs por barra, sendo que a construção do
 * formatador domina o tempo.
 *
 * ⭐ `Intl.DateTimeFormat` é imutável e feito para ser reusado. Criando um e chamando
 * `formatToParts` em laço, o custo por barra cai por mais de uma ordem de grandeza.
 *
 * ⚠️ **Não há cache de módulo aqui, de propósito.** A tentação é um `Map<timeZone, formatador>`
 * global, e ele funcionaria — mas `.core.ts` é contrato neste projeto: função total, determinística
 * e **sem estado de módulo**. Uma fábrica que devolve closure dá o mesmo ganho mantendo o estado
 * LOCAL à chamada de quem varre, e é o chamador que decide o tempo de vida.
 *
 * `null` quando o fuso é inválido — e aí o chamador nem entra no laço.
 */
export function criarResolvedorDeTempo(
  timeZone: string,
): ((epochSeconds: number) => TimeParts | null) | null {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }

  return (epochSeconds: number): TimeParts | null => {
    // 8.64e15 ms e o limite de data valida em JS; acima o formatador lancaria.
    if (!Number.isFinite(epochSeconds) || Math.abs(epochSeconds) > 8.64e12) return null;
    try {
      // SEGUNDOS -> milissegundos aqui, uma vez, na fronteira. Vide cabecalho.
      const parts = fmt.formatToParts(new Date(epochSeconds * 1000));

      const pick = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((p) => p.type === type)?.value ?? '';

      // Alguns motores devolvem a meia-noite como hora `24`; normaliza para 0.
      const rawHour = pick('hour');
      const hour = rawHour === '24' ? 0 : Number(rawHour);

      return {
        year: Number(pick('year')),
        month: Number(pick('month')),
        day: Number(pick('day')),
        hour,
        minute: Number(pick('minute')),
        second: Number(pick('second')),
      };
    } catch {
      return null;
    }
  };
}

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const dois = (n: number): string => String(n).padStart(2, '0');

/** `HH:mm`. */
export function formatHoraMinuto(p: TimeParts): string {
  return `${dois(p.hour)}:${dois(p.minute)}`;
}

/** `HH:mm:ss`. */
export function formatHoraMinutoSegundo(p: TimeParts): string {
  return `${dois(p.hour)}:${dois(p.minute)}:${dois(p.second)}`;
}

/** `dd/MMM` — ex.: `05/jan`. Compacto para a virada de dia no eixo. */
export function formatDiaMes(p: TimeParts): string {
  return `${dois(p.day)}/${NOMES_MES[p.month - 1] ?? '??'}`;
}

/** `MMM/yyyy` — ex.: `jan/2026`. Para zoom-out extremo, onde so muda o mes. */
export function formatMesAno(p: TimeParts): string {
  return `${NOMES_MES[p.month - 1] ?? '??'}/${p.year}`;
}

/** `dd/MM/yyyy HH:mm` — rotulo cheio da caixa de crosshair do eixo de tempo. */
export function formatDataHoraCompleta(p: TimeParts, comSegundos: boolean): string {
  const data = `${dois(p.day)}/${dois(p.month)}/${p.year}`;
  const hora = comSegundos ? formatHoraMinutoSegundo(p) : formatHoraMinuto(p);
  return `${data} ${hora}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Escolha do passo de rotulo por zoom
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Granularidade do rotulo do eixo de tempo, do mais fino ao mais grosso.
 *
 * O passo muda com o zoom porque um eixo de mercado precisa dizer coisas
 * diferentes em cada escala: com a vela ocupando muitos pixels (zoom-in) o
 * operador quer `HH:mm`; com centenas de velas espremidas (zoom-out) `HH:mm` seria
 * ilegivel e sem sentido — ali o que importa e a virada de dia ou de mes.
 */
export type TimeTickUnit = 'second' | 'minute' | 'hour' | 'day' | 'month';

/**
 * Escolhe a unidade do rotulo a partir do `barSpacing` (pixels por barra) e do
 * intervalo mediano entre barras (segundos).
 *
 * ⚠️ A decisao usa DUAS grandezas, e nao so o zoom: o mesmo `barSpacing` significa
 * densidades muito diferentes num grafico de M1 e num de D1. O que importa para a
 * legibilidade e quantos SEGUNDOS de tempo real cabem entre dois rotulos na tela.
 * Miramos ~<rotulo a cada ~80 px> e escolhemos a unidade "redonda" logo acima
 * desse intervalo.
 *
 * @param barSpacing pixels por barra (do eixo de tempo)
 * @param stepSeconds intervalo tipico entre barras, em segundos
 */
export function chooseTickUnit(barSpacing: number, stepSeconds: number): TimeTickUnit {
  if (!Number.isFinite(barSpacing) || barSpacing <= 0) return 'day';
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) stepSeconds = 60;

  // Quantos segundos de tempo real ha por pixel, e por ~80 px (o alvo de
  // espacamento visual entre rotulos — mais apertado polui, mais largo deixa o
  // eixo vazio).
  const ALVO_PX = 80;
  const segundosPorBarra = stepSeconds;
  const barrasPorAlvo = ALVO_PX / barSpacing;
  const segundosPorAlvo = barrasPorAlvo * segundosPorBarra;

  // Escadas "redondas" de tempo. Escolhe a menor unidade cujo respiro cobre o alvo.
  if (segundosPorAlvo <= 1) return 'second';
  if (segundosPorAlvo <= 60) return 'second';
  if (segundosPorAlvo <= 60 * 60) return 'minute';
  if (segundosPorAlvo <= 60 * 60 * 24) return 'hour';
  if (segundosPorAlvo <= 60 * 60 * 24 * 28) return 'day';
  return 'month';
}

/**
 * Duas partes de tempo caem em dias de calendario diferentes?
 *
 * ⭐ E a virada de dia que decide se o rotulo mostra DATA em vez de HORA. Num eixo
 * intraday, so a primeira barra de cada dia ganha `dd/MMM`; as demais ganham
 * `HH:mm`. Sem isso o eixo repetiria a mesma hora sem dizer de que dia ela e.
 */
export function mudouODia(a: TimeParts, b: TimeParts): boolean {
  return a.year !== b.year || a.month !== b.month || a.day !== b.day;
}

/** Mudou o mes (para zoom-out onde o dia ja e ruido)? */
export function mudouOMes(a: TimeParts, b: TimeParts): boolean {
  return a.year !== b.year || a.month !== b.month;
}
