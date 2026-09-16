/**
 * Motor incremental de alertas de preço.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA CENTRAL: SEM REPIQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um alerta de preço é inútil se dispara repetido. "Avise quando cruzar acima de
 * 130.000" tem que avisar UMA vez no instante do cruzamento — não 500 vezes
 * enquanto o preço fica acima de 130.000. Disparar a cada amostra acima do nível
 * é o bug clássico de alerta: o operador recebe uma enxurrada, silencia o
 * aviso, e perde o próximo cruzamento de verdade. O motor precisa distinguir
 * "está acima" de "acabou de cruzar", e lembrar que já avisou.
 *
 * A distinção é resolvida guardando a AMOSTRA ANTERIOR: cruzamento é a transição
 * de lado entre duas amostras consecutivas. O "já avisei" é resolvido por uma
 * pequena máquina de estados.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MÁQUINA DE ESTADOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *          feed() e condição satisfeita
 *   ARMED ─────────────────────────────────▶ TRIGGERED   (dispara UMA vez)
 *     ▲                                          │
 *     │ recurring: condição deixa de valer       │ once: fica aqui para sempre
 *     └──────────────────────────────────────────┘
 *
 *  - ARMED     — vigiando; a próxima satisfação da condição dispara.
 *  - TRIGGERED — já disparou; NÃO dispara de novo.
 *
 *  `once` (padrão): ao disparar vai para TRIGGERED e permanece. Fim.
 *
 *  `recurring`: ao disparar vai para TRIGGERED, mas RE-ARMA (volta a ARMED)
 *  assim que a condição deixa de valer — o "reset". Só então um novo evento pode
 *  disparar. Ex.: CROSS_ABOVE dispara no cruzamento; para disparar de novo o
 *  valor precisa VOLTAR para baixo do nível (reset) e cruzar outra vez. Isso é o
 *  que impede o repique também no modo recorrente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISMO E ROBUSTEZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mesma sequência de amostras ⇒ mesmos disparos. Sem relógio, sem sorteio, sem
 * estado de módulo — todo estado vive no objeto do alerta e todo tempo vem da
 * amostra.
 *
 * ⚠️ Nunca lança. Amostra com `value` não-finito (NaN, Infinity, ausente) é
 * IGNORADA: não dispara e não corrompe o estado (não vira "amostra anterior",
 * senão um NaN envenenaria o próximo cálculo de cruzamento). É o análogo do
 * "null significa não sei" do resto do projeto: dado ruim não é evento.
 */

import type { AlertCondition, Sample } from './conditions.js';

/** Modo de repique. */
export type AlertMode = 'once' | 'recurring';

/** Estado da máquina. Ver o diagrama no cabeçalho. */
export type AlertState = 'ARMED' | 'TRIGGERED';

/** Opções de criação de um alerta. */
export interface AlertOptions {
  /**
   * `'once'` (padrão) dispara uma vez e desarma para sempre; `'recurring'`
   * re-arma após o reset da condição.
   */
  readonly mode?: AlertMode;
  /** Identificador opcional, ecoado no disparo. O motor não o interpreta. */
  readonly id?: string;
}

/**
 * Um alerta com estado interno mutável. O consumidor cria via `createAlert` e
 * alimenta via `feed` — não deve mexer nos campos internos diretamente.
 *
 * O estado é mutável de propósito: um alerta é uma máquina que avança amostra a
 * amostra. A imutabilidade do projeto vale para dados COM histórico (desenhos);
 * um alerta não guarda histórico, guarda posição corrente.
 */
export interface Alert {
  readonly condition: AlertCondition;
  readonly mode: AlertMode;
  readonly id: string | undefined;
  /** Estado corrente da máquina. */
  state: AlertState;
  /**
   * Última amostra FINITA vista, para detectar transição de lado. `null` = ainda
   * não há amostra anterior (a primeira amostra nunca cruza — não há "de onde").
   */
  previous: Sample | null;
  /**
   * Referência do PERCENT_CHANGE: `value` da primeira amostra finita após o
   * (re)armamento. `null` até haver referência.
   */
  baseline: number | null;
}

/** O resultado de um `feed`. */
export interface FeedResult {
  /** Disparou NESTA amostra? */
  readonly fired: boolean;
  /** Estado após processar a amostra. */
  readonly state: AlertState;
  /** A amostra que causou o disparo — presente só quando `fired`. */
  readonly sample?: Sample;
  /** Eco do `id` do alerta, para o consumidor rotear o disparo. */
  readonly id?: string;
}

/** Um número utilizável (finito). Guarda contra NaN/Infinity/ausência. */
function isFinito(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Cria um alerta ARMADO. */
export function createAlert(condition: AlertCondition, options: AlertOptions = {}): Alert {
  return {
    condition,
    mode: options.mode ?? 'once',
    id: options.id,
    state: 'ARMED',
    previous: null,
    baseline: null,
  };
}

/**
 * A condição está satisfeita NESTA transição (`prev` → `curr`)?
 *
 * Recebe a amostra anterior (`prev`, pode ser `null` na primeira) e a atual
 * (`curr`, já garantida finita), mais a `baseline` do PERCENT_CHANGE. Função
 * total: para todo caso da união devolve `boolean`.
 */
function condicaoSatisfeita(
  condition: AlertCondition,
  prev: Sample | null,
  curr: Sample,
  baseline: number | null,
): boolean {
  switch (condition.kind) {
    case 'CROSS_ABOVE': {
      // Precisa de um lado anterior para haver transição. Sem `prev`, não cruza.
      if (prev === null) return false;
      return prev.value <= condition.level && curr.value > condition.level;
    }
    case 'CROSS_BELOW': {
      if (prev === null) return false;
      return prev.value >= condition.level && curr.value < condition.level;
    }
    case 'TOUCH': {
      // Toque olha a extensão da barra. Sem high/low, o `value` faz os dois — o
      // toque degrada para "o valor bateu no nível".
      const high = isFinito(curr.high) ? curr.high : curr.value;
      const low = isFinito(curr.low) ? curr.low : curr.value;
      return low <= condition.level && condition.level <= high;
    }
    case 'ENTER_ZONE': {
      const dentroAgora = curr.value >= condition.min && curr.value <= condition.max;
      // Entrar é transição de FORA para DENTRO. Se já estava dentro (ou não há
      // anterior e já nasce dentro), não é "entrada" nesta amostra.
      if (!dentroAgora) return false;
      if (prev === null) return false;
      const dentroAntes = prev.value >= condition.min && prev.value <= condition.max;
      return !dentroAntes;
    }
    case 'EXIT_ZONE': {
      const foraAgora = curr.value < condition.min || curr.value > condition.max;
      if (!foraAgora) return false;
      if (prev === null) return false;
      const foraAntes = prev.value < condition.min || prev.value > condition.max;
      return !foraAntes;
    }
    case 'PERCENT_CHANGE': {
      // Sem referência ou referência zero não há variação percentual definida.
      // `baseline === 0` daria divisão por zero → tratamos como "não sei", nunca
      // dispara (o análogo de null; falhar em silêncio é melhor que Infinity).
      if (baseline === null || baseline === 0) return false;
      const variacao = ((curr.value - baseline) / baseline) * 100;
      switch (condition.direction) {
        case 'up':
          return variacao >= condition.percent;
        case 'down':
          return variacao <= -condition.percent;
        case 'both':
          return Math.abs(variacao) >= condition.percent;
      }
    }
  }
}

/**
 * Alimenta uma amostra e devolve o resultado. Ver a máquina de estados no
 * cabeçalho.
 *
 * Ordem do processamento, e o porquê de cada passo:
 *  1. Amostra não-finita é ignorada — não altera `previous`/`baseline`/`state`.
 *  2. Fixa a `baseline` do PERCENT_CHANGE na primeira amostra finita após armar.
 *  3. Se ARMED e a condição está satisfeita → dispara (vai a TRIGGERED).
 *  4. Se TRIGGERED e `recurring` e a condição DEIXOU de valer → re-arma.
 *  5. `previous` recebe a amostra atual (finita) para a próxima transição.
 */
export function feed(alert: Alert, sample: Sample): FeedResult {
  // (1) Dado ruim não é evento. Não vira `previous` para não envenenar o
  // próximo cálculo de cruzamento com um NaN.
  if (!isFinito(sample.value) || !isFinito(sample.time)) {
    return { fired: false, state: alert.state, id: alert.id };
  }

  // (2) Referência do PERCENT_CHANGE: primeira amostra finita após (re)armar.
  if (alert.baseline === null) {
    alert.baseline = sample.value;
  }

  const prev = alert.previous;
  let fired = false;

  if (alert.state === 'ARMED') {
    if (condicaoSatisfeita(alert.condition, prev, sample, alert.baseline)) {
      alert.state = 'TRIGGERED';
      fired = true;
    }
  } else {
    // TRIGGERED. Só o modo recorrente pode voltar a vigiar, e só quando a
    // condição deixou de valer (o reset). É o que impede o repique: enquanto a
    // condição continua satisfeita, ficamos travados em TRIGGERED.
    if (alert.mode === 'recurring') {
      const aindaVale = condicaoSatisfeita(alert.condition, prev, sample, alert.baseline);
      if (!aindaVale) {
        alert.state = 'ARMED';
      }
    }
  }

  // (5) Atualiza a amostra anterior só com dado finito.
  alert.previous = sample;

  const result: FeedResult = { fired, state: alert.state };
  return fired
    ? { ...result, sample, id: alert.id }
    : { ...result, id: alert.id };
}

/**
 * Reseta um alerta ao estado inicial ARMADO, esquecendo amostra anterior e
 * referência. Útil quando o consumidor troca de ativo/sessão e não quer que uma
 * transição espúria entre séries dispare. Puro em relação a entrada externa:
 * apenas zera o estado interno.
 */
export function rearm(alert: Alert): void {
  alert.state = 'ARMED';
  alert.previous = null;
  alert.baseline = null;
}
