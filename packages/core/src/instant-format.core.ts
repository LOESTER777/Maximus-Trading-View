/**
 * instant-format — formatacao PURA de um instante para um fuso configuravel,
 * com rotulo de fuso explicito imediatamente apos o valor do horario.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORIGEM E O QUE MUDOU NA GENERALIZACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Derivado de `brt-format.ts` do cockpit de origem, que fixava
 * `America/Sao_Paulo` e o sufixo `BRT` no corpo da funcao. Numa biblioteca que
 * qualquer ferramenta vai consumir, fuso fixo no codigo e defeito: o mesmo
 * heatmap pode ser lido por uma mesa em Sao Paulo, um backtest em UTC e um
 * painel em Chicago.
 *
 * O que virou configuravel: **fuso** e **rotulo**.
 *
 * O que NAO virou configuravel, e por que: o **layout** (`dd/MM/yyyy HH:mm:ss`)
 * segue montado parte por parte, a mao. Isso e deliberado e e a garantia
 * central do modulo — a origem monta as partes justamente para que a saida NAO
 * dependa do locale da maquina que executa. Expor um parametro `locale` que
 * reordenasse a data devolveria a instabilidade que a montagem manual existe
 * para eliminar, e seria um botao que promete portabilidade entregando
 * variacao. Formatacao de NUMERO, que tem eixo de locale de verdade, mora em
 * `number-format.core.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGRAS DE PUREZA (inviolaveis, herdadas da origem)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - zero DOM, zero fetch, zero `Date.now()` interno;
 *  - o instante SEMPRE chega por parametro;
 *  - mesma entrada -> mesma saida;
 *  - converte via `Intl.DateTimeFormat` com `timeZone` explicito, portanto
 *    independe da variavel `TZ` do processo.
 *
 * ⚠️ NENHUMA ARITMETICA DE FUSO E FEITA AQUI. O projeto de origem registra ter
 * errado conversao em ±3 h mais de uma vez, em pontos onde o deslocamento foi
 * somado a mao. Epoch entra inteiro no formatador de internacionalizacao.
 */

// ─── Tipos publicos ─────────────────────────────────────────

/**
 * Como um horario deve ser apresentado.
 *
 * `label` vazio omite o sufixo (e o espaco antes dele). Rotulo vazio e escolha
 * legitima para consumidor que ja diz o fuso no cabecalho da tela, mas o
 * default nunca e vazio: horario sem fuso numa tela de mercado e ambiguo, e
 * ambiguidade de horario em fluxo de ordem custa dinheiro.
 */
export interface ClockPresentation {
  /** Fuso IANA, ex.: `'America/Sao_Paulo'`, `'UTC'`, `'America/Chicago'`. */
  readonly timeZone: string;
  /** Sufixo apos o horario, ex.: `'BRT'`. Vazio omite o sufixo. */
  readonly label: string;
}

/** Opcoes de formatacao: apresentacao (parcial) + granularidade. */
export interface InstantFormatOptions extends Partial<ClockPresentation> {
  /** Inclui segundos (`HH:mm:ss`). Default `true`. */
  withSeconds?: boolean;
  /** Prefixa a data (`dd/MM/yyyy`). Default `false`. */
  withDate?: boolean;
}

/**
 * Formatador de relogio pronto para injecao: recebe epoch ms, devolve o rotulo
 * ou `null` quando o instante nao e utilizavel.
 *
 * E este o tipo que os nucleos aceitam por parametro. Assim um nucleo puro
 * formata horario sem saber qual fuso o consumidor escolheu, e sem que o fuso
 * viaje como texto por dentro da regra de negocio.
 */
export type ClockFormatter = (ms: number | null | undefined) => string | null;

// ─── Presets ────────────────────────────────────────────────

/** Horario de Brasilia. Fuso da B3, e o default desta biblioteca. */
export const PRESENTATION_BRT: ClockPresentation = {
  timeZone: 'America/Sao_Paulo',
  label: 'BRT',
};

/** UTC com rotulo explicito. Preferivel para log, backtest e comparacao. */
export const PRESENTATION_UTC: ClockPresentation = {
  timeZone: 'UTC',
  label: 'UTC',
};

/** Horario de Chicago (CME). */
export const PRESENTATION_CME: ClockPresentation = {
  timeZone: 'America/Chicago',
  label: 'CT',
};

/** Horario de Nova York (NYSE / Nasdaq). */
export const PRESENTATION_NYSE: ClockPresentation = {
  timeZone: 'America/New_York',
  label: 'ET',
};

/**
 * Apresentacao usada quando o chamador nao informa nada.
 *
 * ⚠️ E BRT, e nao UTC, por uma razao de compatibilidade que vale registrar: os
 * nucleos copiados da origem tem property test que afirma o sufixo e o
 * deslocamento de Sao Paulo. Trocar o default para UTC mudaria silenciosamente
 * a saida de todo consumidor que nao passa parametro — inclusive a suite que e
 * a rede de seguranca desta extracao. Quem quer outro fuso passa explicitamente;
 * a capacidade esta completa, so o default e conservador.
 */
export const DEFAULT_CLOCK_PRESENTATION: ClockPresentation = PRESENTATION_BRT;

// ─── Funcao publica principal ───────────────────────────────

/**
 * Converte um instante para o fuso pedido e devolve a string formatada.
 *
 * Aceita o instante como:
 *  - `number` — epoch em MILISSEGUNDOS (convencao de `Date.now()`). Quem tem
 *    epoch em SEGUNDOS multiplica por 1000 antes: esta funcao NAO adivinha a
 *    unidade, porque adivinhar erra em 1970 e em datas proximas ao epoch.
 *  - `Date` — qualquer instancia.
 *
 * Formatos (o rotulo vem SEMPRE logo apos o valor do horario):
 *  - default                                  -> `HH:mm:ss BRT`
 *  - `{ withSeconds: false }`                  -> `HH:mm BRT`
 *  - `{ withDate: true }`                      -> `dd/MM/yyyy HH:mm:ss BRT`
 *  - `{ timeZone: 'UTC', label: 'UTC' }`       -> `HH:mm:ss UTC`
 *  - `{ label: '' }`                           -> `HH:mm:ss`
 *
 * Pode lancar `RangeError` para fuso inexistente — o motor de
 * internacionalizacao decide. Quem chama de dentro de ciclo de desenho deve us
 * `makeClockFormatter`, que converte a excecao em `null`.
 */
export function formatInstant(input: number | Date, opts?: InstantFormatOptions): string {
  const withSeconds = opts?.withSeconds !== false; // default true
  const withDate = opts?.withDate === true; // default false
  const timeZone = opts?.timeZone ?? DEFAULT_CLOCK_PRESENTATION.timeZone;
  const label = opts?.label ?? DEFAULT_CLOCK_PRESENTATION.label;

  const ref = typeof input === 'number' ? new Date(input) : input;

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ref);

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  // Alguns motores devolvem a hora da meia-noite como `24` com `hour12: false`;
  // normalizamos para `00` mantendo a faixa 00..23.
  const hour = (pick('hour') === '24' ? '00' : pick('hour')).padStart(2, '0');
  const minute = pick('minute');
  const second = pick('second');

  const timePart = withSeconds ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;
  const datePart = withDate ? `${day}/${month}/${year} ` : '';
  const suffix = label === '' ? '' : ` ${label}`;

  return `${datePart}${timePart}${suffix}`;
}

/**
 * Preset BRT — mesma assinatura e mesma saida do `formatBrt` da origem.
 *
 * Existe para que o codigo copiado continue lendo igual e para que a migracao
 * de um consumidor seja troca de import, nao reescrita de call site.
 */
export function formatBrt(
  input: number | Date,
  opts?: Omit<InstantFormatOptions, 'timeZone' | 'label'>,
): string {
  return formatInstant(input, { ...opts, ...PRESENTATION_BRT });
}

// ─── Fabrica de formatador injetavel ───────────────────────

/**
 * Sentinela de instante utilizavel.
 *
 * Recusa `NaN`, `Infinity` e nao-numero. O teto de 8.64e15 ms e o limite de
 * data valida em JavaScript (`new Date(8.64e15 + 1)` e `Invalid Date`); acima
 * dele o formatador lancaria em vez de formatar.
 */
const MAX_EPOCH_MS = 8.64e15;

function isUsableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_EPOCH_MS;
}

/**
 * Constroi um `ClockFormatter` que NUNCA lanca.
 *
 * Instante inutilizavel -> `null`. Fuso que o motor rejeita -> `null`. As duas
 * degradacoes sao deliberadas e tem a mesma justificativa: horario ausente e
 * degradacao aceitavel numa camada de visualizacao; excecao propagada de dentro
 * do ciclo de desenho derruba o grafico inteiro. `null` significa
 * "desconhecido", e a tela escreve que nao foi informado em vez de exibir um
 * horario inventado.
 *
 * @example
 * const relogio = makeClockFormatter(PRESENTATION_UTC, { withSeconds: false });
 * relogio(1735689600000); // '00:00 UTC'
 * relogio(NaN);           // null
 */
export function makeClockFormatter(
  presentation?: Partial<ClockPresentation>,
  opts?: Omit<InstantFormatOptions, 'timeZone' | 'label'>,
): ClockFormatter {
  return (ms) => {
    if (!isUsableInstant(ms)) return null;
    try {
      return formatInstant(ms, { ...opts, ...presentation });
    } catch {
      return null;
    }
  };
}

/**
 * Formatador default da biblioteca: BRT, sem segundos.
 *
 * Sem segundos porque o consumidor original e rotulo de cobertura (`'09:00
 * BRT'`), onde o segundo e ruido — a cobertura e medida em baldes de 1 s a 1 h.
 */
export const DEFAULT_COVERAGE_CLOCK: ClockFormatter = makeClockFormatter(
  DEFAULT_CLOCK_PRESENTATION,
  { withSeconds: false },
);
