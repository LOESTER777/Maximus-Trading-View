/**
 * Condições de alerta — o QUE o mercado precisa fazer para avisar o trader.
 *
 * ── POR QUE UMA UNIÃO DISCRIMINADA ──────────────────────────────────────────
 *
 * Cada tipo de alerta responde uma pergunta diferente ("cruzou para cima?",
 * "tocou o nível?", "entrou na faixa?") e carrega parâmetros diferentes (um
 * nível único, um par [min,max], um percentual). Modelar isso como união
 * discriminada pelo campo `kind` faz o motor tratar cada caso num `switch`
 * exaustivo — o `noFallthroughCasesInSwitch` do tsconfig transforma um caso
 * esquecido em erro de compilação, não em alerta que nunca dispara.
 *
 * ── A "FONTE" É UM NÚMERO INJETADO, NÃO UM INDICADOR ─────────────────────────
 *
 * Este pacote não sabe o que é RSI, close ou média móvel. A fonte de um alerta
 * é apenas `sample.value`: um número por amostra que o consumidor escolhe. Quem
 * quiser alertar sobre RSI calcula o RSI fora e alimenta o valor aqui. Isso
 * mantém o pacote autossuficiente (regra do projeto: alerts não importa outro
 * pacote do workspace) e reutilizável para qualquer série numérica.
 *
 * Puro: sem DOM, sem relógio, sem I/O, sem estado de módulo.
 */

/** Tipos de condição suportados. É o discriminante `kind` da união. */
export type ConditionKind =
  | 'CROSS_ABOVE'
  | 'CROSS_BELOW'
  | 'TOUCH'
  | 'ENTER_ZONE'
  | 'EXIT_ZONE'
  | 'PERCENT_CHANGE';

/**
 * A fonte (`sample.value`) cruza um nível DE BAIXO PARA CIMA.
 *
 * ⚠️ Cruzamento é TRANSIÇÃO entre duas amostras, não "estar acima". Dispara no
 * instante em que `anterior <= level` e `atual > level`. Ficar acima do nível
 * por 500 amostras não deve produzir 500 disparos — esse é o bug clássico de
 * alerta, tratado na máquina de estados do motor (ver `alert-engine.core.ts`).
 */
export interface CrossAboveCondition {
  readonly kind: 'CROSS_ABOVE';
  readonly level: number;
}

/**
 * A fonte cruza um nível DE CIMA PARA BAIXO. Dispara quando `anterior >= level`
 * e `atual < level`. Simétrico ao `CROSS_ABOVE`.
 */
export interface CrossBelowCondition {
  readonly kind: 'CROSS_BELOW';
  readonly level: number;
}

/**
 * O preço TOCA um nível dentro da barra: `low <= level <= high`.
 *
 * Diferente do cruzamento, o toque olha a EXTENSÃO da barra (máxima e mínima),
 * não a transição entre amostras. Uma mecha que perfura o nível e volta conta
 * como toque, e é justamente o que o trader quer saber ("encostou na minha
 * linha?"). Quando `high`/`low` não vierem na amostra, o motor usa `value` como
 * os dois — o toque degrada para "o valor bateu no nível".
 */
export interface TouchCondition {
  readonly kind: 'TOUCH';
  readonly level: number;
}

/**
 * A fonte ENTRA numa faixa `[min, max]` (dentro = `min <= value <= max`).
 *
 * Dispara na transição de FORA para DENTRO, não enquanto permanece dentro.
 */
export interface EnterZoneCondition {
  readonly kind: 'ENTER_ZONE';
  readonly min: number;
  readonly max: number;
}

/**
 * A fonte SAI de uma faixa `[min, max]`. Dispara na transição de DENTRO para
 * FORA.
 */
export interface ExitZoneCondition {
  readonly kind: 'EXIT_ZONE';
  readonly min: number;
  readonly max: number;
}

/**
 * A variação percentual da fonte DESDE O ARMAMENTO excede `percent` %.
 *
 * A referência (`baseline`) é o `value` da primeira amostra finita vista após o
 * armamento — não um preço de relógio, para manter o pacote determinístico.
 * `direction` decide o sentido:
 *  - `'up'`   → dispara quando `(value - baseline) / baseline * 100 >= percent`
 *  - `'down'` → dispara quando `(value - baseline) / baseline * 100 <= -percent`
 *  - `'both'` → dispara quando `|variação| >= percent`
 *
 * `percent` é sempre positivo (a magnitude); o sentido vem de `direction`.
 */
export interface PercentChangeCondition {
  readonly kind: 'PERCENT_CHANGE';
  readonly percent: number;
  readonly direction: 'up' | 'down' | 'both';
}

/** União de todas as condições. Discriminada por `kind`. */
export type AlertCondition =
  | CrossAboveCondition
  | CrossBelowCondition
  | TouchCondition
  | EnterZoneCondition
  | ExitZoneCondition
  | PercentChangeCondition;

/**
 * Uma amostra alimentada ao motor. `value` é a fonte; `high`/`low` são opcionais
 * e só o `TOUCH` os usa. `time` é o relógio DO DADO (vem de fora, o pacote nunca
 * lê o relógio da máquina) e serve de carimbo no disparo.
 */
export interface Sample {
  readonly time: number;
  readonly value: number;
  readonly high?: number;
  readonly low?: number;
}
