/**
 * pivot-levels.core — os niveis de pivo classicos. FUNCAO PURA.
 *
 * ⚠️ Sufixo `.core.ts`: total e deterministica, sem estado de modulo, sem relogio,
 * sem I/O. Todo insumo chega por parametro. Existe separada da fabrica de
 * indicador de proposito — os niveis de pivo sao uma formula fechada sobre TRES
 * numeros (maxima, minima e fechamento de um periodo), e quem tem esses tres
 * numeros nao deveria precisar instanciar um indicador com estado rolante para
 * obte-los.
 *
 * Ha dois consumidores, e e por isso que a formula mora aqui e nao dentro da
 * fabrica:
 *
 *   1. `pivotPointsFactory` (em `pivots.ts`), que agrega a sessao barra a barra e
 *      chama isto na virada de dia;
 *   2. quem ja TEM o resumo do dia anterior — um backend que devolve OHLC diario,
 *      uma tabela de fechamentos — e so quer os niveis, sem alimentar barras.
 */

/** Os sete niveis do pivo classico. */
export interface PivotLevels {
  /** Ponto de pivo: o centro de gravidade do periodo. */
  readonly pp: number;
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

/**
 * Niveis de pivo CLASSICOS (tambem chamados "padrao" ou "de chao") a partir da
 * maxima, minima e fechamento do periodo ANTERIOR.
 *
 *     PP = (H + L + C) / 3
 *     R1 = 2*PP - L        S1 = 2*PP - H
 *     R2 = PP + (H - L)    S2 = PP - (H - L)
 *     R3 = H + 2*(PP - L)  S3 = L - 2*(H - PP)
 *
 * ⚠️ VARIANTE: esta e a classica. Existem pelo menos quatro outras em uso —
 * Fibonacci (usa 0.382/0.618/1.0 do range sobre o PP), Camarilla (1.1/1.2/... do
 * range), Woodie (pesa o fechamento em dobro e usa a abertura do periodo atual) e
 * DeMark. Nao sao refinamentos umas das outras: sao formulas distintas com niveis
 * distintos. Implementada so a classica, que e a referencia comum; qualquer outra
 * entra como funcao propria ao lado desta, nunca como "correcao" desta.
 *
 * ⚠️ NAO valida a coerencia dos insumos. Se `high < low` (entrada absurda), a
 * formula ainda devolve numeros — e aritmetica, nao ha o que lancar. A funcao e
 * TOTAL por design: quem alimenta e responsavel pela coerencia, e o
 * `pivotPointsFactory` alimenta agregando barras reais, onde high >= low vale por
 * construcao.
 */
export function pivotLevels(high: number, low: number, close: number): PivotLevels {
  const pp = (high + low + close) / 3;
  const range = high - low;
  return {
    pp,
    r1: 2 * pp - low,
    r2: pp + range,
    r3: high + 2 * (pp - low),
    s1: 2 * pp - high,
    s2: pp - range,
    s3: low - 2 * (high - pp),
  };
}

/** O resumo de um periodo: o que os niveis de pivo consomem. */
export interface PeriodSummary {
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * Agrega barras num resumo de periodo: maxima do periodo, minima do periodo e
 * fechamento da ULTIMA barra.
 *
 * ⚠️ O fechamento e o da ultima barra da sequencia, e a sequencia e assumida em
 * ordem cronologica — nao ha `time` aqui de proposito, para a funcao servir tanto a
 * barras intradiarias de um dia quanto a barras diarias de uma semana. Ordenar e
 * de quem chama.
 *
 * Devolve `null` para sequencia vazia ou sem nenhuma barra finita: `null` = "nao
 * sei", jamais zeros, que seriam niveis de pivo em torno do preco zero.
 */
export function summarizePeriod(
  bars: readonly { readonly high: number; readonly low: number; readonly close: number }[],
): PeriodSummary | null {
  let high = -Infinity;
  let low = Infinity;
  let close: number | null = null;
  for (const b of bars) {
    if (b == null) continue;
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) continue;
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    close = b.close;
  }
  if (close === null || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low, close };
}

/**
 * Atalho: niveis de pivo a partir das barras do periodo ANTERIOR (o dia que
 * fechou, tipicamente). `null` se as barras nao permitirem um resumo.
 *
 * E a composicao das duas funcoes acima, exposta porque e o uso de 90% dos casos e
 * ninguem deveria ter de descobrir que precisa chamar duas.
 */
export function pivotLevelsFromBars(
  bars: readonly { readonly high: number; readonly low: number; readonly close: number }[],
): PivotLevels | null {
  const resumo = summarizePeriod(bars);
  return resumo === null ? null : pivotLevels(resumo.high, resumo.low, resumo.close);
}
