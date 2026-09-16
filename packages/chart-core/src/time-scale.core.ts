/**
 * time-scale.core — o eixo de tempo. A parte genuinamente dificil do motor. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA: TEMPO DE MERCADO NAO E CONTINUO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um grafico de linha comum mapeia tempo -> x linearmente: `x = (t - t0) / escala`.
 * Num grafico de MERCADO isso esta errado, e o erro e visivel: entre a sexta as
 * 18h e a segunda as 9h nao ha pregao, mas ha ~63 horas de relogio. Mapeando por
 * tempo real, apareceria um vao enorme e vazio a cada fim de semana, e as velas
 * de segunda ficariam espremidas.
 *
 * A solucao que toda plataforma seria usa: **espaco logico**. Cada barra recebe um
 * INDICE inteiro (0, 1, 2, ...), independente de quanto tempo de relogio a separa
 * da anterior. O eixo e linear no INDICE, nao no tempo:
 *
 *     x = (indiceLogico - indiceDaEsquerda) * barSpacing
 *
 * Assim as velas ficam equidistantes na tela — sexta e segunda coladas — e o fim
 * de semana simplesmente nao ocupa espaco. E o comportamento correto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O INDICE LOGICO E CONTINUO, E E ISSO QUE SALVA O DESENHO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O indice de uma barra e inteiro, mas a FUNCAO indice<->pixel aceita fracao. Um
 * desenho ancorado num instante que nao e barra (uma linha de M5 vista em H1) cai
 * num indice FRACIONARIO — 3,42, digamos — e `logicalToCoordinate(3,42)` devolve o
 * pixel interpolado entre a barra 3 e a 4.
 *
 * E por isso que `timeToIndex(t, findNearest)` seguido de `logicalToCoordinate`
 * mantem o desenho no lugar ao trocar de periodo, enquanto `timeToCoordinate`
 * direto o faz sumir (ele so acha coordenada para tempo que E barra). Este
 * comportamento e o contrato que `drawings/chart-converters.ts` assume — e agora
 * ele e NOSSO, nao de terceiro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUSCA POR TEMPO: BINARIA, PORQUE E CHAMADA A TODO QUADRO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As barras estao em ordem crescente de tempo. `timeToIndex` faz busca binaria —
 * O(log n) — porque a conversao acontece dezenas de vezes por quadro durante um
 * pan, e busca linear num pregao de milhares de barras viraria o gargalo.
 */

import type { Coordinate, Logical, LogicalRange, Time, TimeRange } from './contracts.js';

/** Estado interno do eixo. Mutavel de proposito: e um objeto de sessao. */
export interface TimeScaleState {
  /** Tempos das barras, em ordem CRESCENTE. Indice do array = indice logico. */
  times: number[];
  /** Pixels por barra. Cresce com zoom-in. */
  barSpacing: number;
  /** Espaco minimo entre barras — piso do zoom-out. */
  minBarSpacing: number;
  /**
   * Indice logico na borda ESQUERDA da area de plotagem.
   *
   * Fracionario: um pan de meia barra desloca isto em 0,5. E o unico numero que o
   * pan altera — mover o grafico e mudar qual indice fica na esquerda.
   */
  leftLogical: number;
  /** Largura da area de plotagem, em pixel logico. */
  width: number;
  /**
   * Barras vazias a direita da ultima, para a ultima vela nao colar na borda.
   *
   * Sem isso, o preco corrente fica grudado no eixo de preco e o operador nao ve
   * para onde a barra em formacao esta indo.
   */
  rightOffset: number;
}

/** Cria o estado com valores default. */
export function createTimeScaleState(barSpacing = 8, minBarSpacing = 2, rightOffset = 12): TimeScaleState {
  return {
    times: [],
    barSpacing,
    minBarSpacing,
    leftLogical: 0,
    width: 0,
    rightOffset,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Conversoes fundamentais
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Indice logico -> X em pixel.
 *
 * Linear no indice. Aceita fracao: e o que interpola entre barras e mantem
 * desenho ancorado em instante intermediario no lugar certo.
 */
export function logicalToCoordinate(s: TimeScaleState, logical: Logical): Coordinate | null {
  if (!Number.isFinite(logical)) return null;
  return (logical - s.leftLogical) * s.barSpacing;
}

/** X em pixel -> indice logico. Inverso exato do anterior. */
export function coordinateToLogical(s: TimeScaleState, x: Coordinate): Logical | null {
  if (!Number.isFinite(x) || s.barSpacing <= 0) return null;
  return s.leftLogical + x / s.barSpacing;
}

/**
 * Tempo -> indice logico.
 *
 * `findNearest = false` (default): so devolve indice para tempo que E exatamente
 * uma barra; senao `null`. E o comportamento de `timeToCoordinate` do substrato.
 *
 * `findNearest = true`: devolve o indice FRACIONARIO interpolado — a barra mais
 * proxima mais a fracao do intervalo ate a vizinha. E este ramo que faz o desenho
 * sobreviver a troca de periodo.
 *
 * ⚠️ Tempo ALEM da ultima barra (a direita, no futuro) tambem interpola, usando o
 * espacamento medio das ultimas barras — senao um desenho ancorado no futuro (um
 * alvo de projecao) nao teria coordenada.
 */
export function timeToIndex(s: TimeScaleState, time: Time, findNearest = false): Logical | null {
  const n = s.times.length;
  if (n === 0 || !Number.isFinite(time)) return null;

  // Busca binaria: primeiro indice cujo tempo e >= `time`.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((s.times[mid] as number) < time) lo = mid + 1;
    else hi = mid;
  }

  // Coincidencia exata.
  if (lo < n && s.times[lo] === time) return lo;

  if (!findNearest) return null;

  // ── Interpolacao ──
  if (lo === 0) {
    // Antes da primeira barra: extrapola para a esquerda pelo primeiro intervalo.
    if (n === 1) return 0;
    const t0 = s.times[0] as number;
    const t1 = s.times[1] as number;
    const passo = t1 - t0;
    return passo > 0 ? (time - t0) / passo : 0;
  }

  if (lo >= n) {
    // Depois da ultima barra: extrapola para a direita pelo ultimo intervalo.
    if (n === 1) return 0;
    const tPen = s.times[n - 2] as number;
    const tUlt = s.times[n - 1] as number;
    const passo = tUlt - tPen;
    return passo > 0 ? n - 1 + (time - tUlt) / passo : n - 1;
  }

  // Entre a barra `lo-1` e `lo`: fracao do intervalo.
  const tA = s.times[lo - 1] as number;
  const tB = s.times[lo] as number;
  const passo = tB - tA;
  return passo > 0 ? lo - 1 + (time - tA) / passo : lo - 1;
}

/**
 * Indice logico -> tempo.
 *
 * Inverso de `timeToIndex(findNearest)`. Indice inteiro devolve o tempo da barra;
 * fracionario interpola. Fora da faixa extrapola pelo intervalo da ponta — e o que
 * permite ao cursor a direita da ultima vela reportar um instante futuro.
 */
export function indexToTime(s: TimeScaleState, logical: Logical): Time | null {
  const n = s.times.length;
  if (n === 0 || !Number.isFinite(logical)) return null;

  const base = Math.floor(logical);
  const frac = logical - base;

  if (base < 0) {
    if (n < 2) return s.times[0] ?? null;
    const passo = (s.times[1] as number) - (s.times[0] as number);
    return (s.times[0] as number) + logical * passo;
  }
  if (base >= n - 1) {
    if (n < 2) return s.times[n - 1] ?? null;
    const passo = (s.times[n - 1] as number) - (s.times[n - 2] as number);
    return (s.times[n - 1] as number) + (logical - (n - 1)) * passo;
  }

  const tA = s.times[base] as number;
  const tB = s.times[base + 1] as number;
  return tA + frac * (tB - tA);
}

/** Tempo -> X, direto. `null` quando o tempo nao e barra (contrato do substrato). */
export function timeToCoordinate(s: TimeScaleState, time: Time): Coordinate | null {
  const idx = timeToIndex(s, time, false);
  if (idx === null) return null;
  return logicalToCoordinate(s, idx);
}

/** X -> tempo, passando por indice logico (interpola, nao quantiza). */
export function coordinateToTime(s: TimeScaleState, x: Coordinate): Time | null {
  const idx = coordinateToLogical(s, x);
  if (idx === null) return null;
  return indexToTime(s, idx);
}

// ═════════════════════════════════════════════════════════════════════════════
// Faixa visivel
// ═════════════════════════════════════════════════════════════════════════════

/** A faixa de indices logicos que cabe na largura corrente. */
export function visibleLogicalRange(s: TimeScaleState): LogicalRange | null {
  if (s.width <= 0 || s.barSpacing <= 0) return null;
  return { from: s.leftLogical, to: s.leftLogical + s.width / s.barSpacing };
}

/** A faixa de tempo visivel. */
export function visibleTimeRange(s: TimeScaleState): TimeRange | null {
  const lr = visibleLogicalRange(s);
  if (lr === null) return null;
  const from = indexToTime(s, lr.from);
  const to = indexToTime(s, lr.to);
  if (from === null || to === null) return null;
  return { from, to };
}

/**
 * Ajusta `barSpacing` e `leftLogical` para uma faixa logica caber na largura.
 *
 * Usado ao restaurar um layout salvo ou ao aplicar zoom programatico.
 */
export function setVisibleLogicalRange(s: TimeScaleState, range: LogicalRange): void {
  const span = range.to - range.from;
  if (span <= 0 || s.width <= 0) return;
  s.barSpacing = Math.max(s.minBarSpacing, s.width / span);
  s.leftLogical = range.from;
}

/**
 * Enquadra todo o conjunto de barras na largura, com o `rightOffset` de folga.
 *
 * ⚠️ Inclui o `rightOffset` no calculo do espacamento: sem isso, as barras
 * ocupariam a largura inteira e a folga a direita empurraria as mais antigas para
 * fora — enquadrar deixaria de mostrar tudo, que e o oposto do que "fit" promete.
 */
export function fitContent(s: TimeScaleState): void {
  const n = s.times.length;
  if (n === 0 || s.width <= 0) return;
  const barrasVisiveis = n + s.rightOffset;
  s.barSpacing = Math.max(s.minBarSpacing, s.width / barrasVisiveis);
  s.leftLogical = 0;
}

/** Rola para que a ultima barra fique visivel, respeitando o `rightOffset`. */
export function scrollToRealTime(s: TimeScaleState): void {
  const n = s.times.length;
  if (n === 0 || s.width <= 0 || s.barSpacing <= 0) return;
  const barrasNaTela = s.width / s.barSpacing;
  // A ultima barra fica a `rightOffset` barras da borda direita.
  s.leftLogical = n - 1 + s.rightOffset - barrasNaTela;
}

// ═════════════════════════════════════════════════════════════════════════════
// Pan e zoom — mutacoes do estado
// ═════════════════════════════════════════════════════════════════════════════

/** Desloca a esquerda em `deltaPx` pixels. Pan horizontal. */
export function scrollByPixels(s: TimeScaleState, deltaPx: number): void {
  if (s.barSpacing <= 0) return;
  s.leftLogical += deltaPx / s.barSpacing;
}

/**
 * Zoom em torno de um X ANCORA, preservando o tempo sob o cursor.
 *
 * ⚠️ O ponto de ancora importa e nao e detalhe: dar zoom deve aproximar do que
 * esta SOB o cursor, nao do centro. Se o eixo escalasse em torno da borda
 * esquerda, o conteudo escaparia lateralmente e o usuario perderia o que estava
 * olhando. A conta preserva `logicalNoCursor` no mesmo pixel antes e depois.
 *
 * @param factor >1 aproxima (zoom-in), <1 afasta.
 */
export function zoomAtCoordinate(s: TimeScaleState, anchorX: Coordinate, factor: number): void {
  if (s.barSpacing <= 0 || !Number.isFinite(anchorX) || factor <= 0) return;
  const logicalNoCursor = s.leftLogical + anchorX / s.barSpacing;
  const novoEspacamento = Math.max(s.minBarSpacing, Math.min(80, s.barSpacing * factor));
  // Recoloca `logicalNoCursor` exatamente sob `anchorX` com o novo espacamento.
  s.leftLogical = logicalNoCursor - anchorX / novoEspacamento;
  s.barSpacing = novoEspacamento;
}

/**
 * Ao acrescentar barras novas, mantem a visao ancorada na direita se ja estava.
 *
 * Se o usuario estava olhando o tempo real (borda direita), barra nova rola junto
 * — o comportamento esperado ao vivo. Se ele tinha rolado para o passado, a visao
 * NAO se mexe — mexer arrancaria o operador de onde ele estava investigando.
 */
export function onBarsAppended(s: TimeScaleState, antesCount: number, seguindoRealTime: boolean): void {
  if (seguindoRealTime) {
    const delta = s.times.length - antesCount;
    s.leftLogical += delta;
  }
}

/** A visao esta ancorada perto do tempo real (ultima barra visivel)? */
export function isFollowingRealTime(s: TimeScaleState): boolean {
  const n = s.times.length;
  if (n === 0 || s.barSpacing <= 0) return true;
  const direitaLogical = s.leftLogical + s.width / s.barSpacing;
  // Tolerancia de 1 barra: considerado "seguindo" se a ultima barra esta a menos
  // de uma barra da borda direita util.
  return direitaLogical >= n - 1 - 1;
}
