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
  | 'PERCENT_CHANGE'
  | 'SERIES_CROSS';

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

/**
 * ⭐ Cruzamento de DUAS SÉRIES: `value` cruza `reference` na mesma amostra.
 *
 * É o alerta que faltava, e é o mais pedido de todos: "avise quando a EMA de 9
 * cruzar a de 21", "quando o preço perder a média de 200", "quando o %K cruzar o
 * %D". Com `CROSS_ABOVE` isso era impossível de expressar — ele compara com um
 * `level` FIXO, e uma média móvel se move a cada barra.
 *
 * ── O MECANISMO: SINAL DO SPREAD, NÃO COMPARAÇÃO DE LADO ─────────────────────
 *
 * A tentação é "value antes < reference antes && value agora > reference agora".
 * O que o motor faz é olhar o SINAL do spread (`value - reference`) mudar de
 * não-positivo para positivo. Dá no mesmo resultado e é mais honesto sobre o que
 * está sendo medido: as DUAS séries se movem, e o que cruza é a diferença entre
 * elas passando por zero. Um caso concreto em que a formulação importa: quando as
 * duas se tocam exatamente (spread zero) e depois separam, o cruzamento é UM
 * evento — o `<= 0` na amostra anterior garante isso, do mesmo jeito que o `<=`
 * do `CROSS_ABOVE`.
 *
 * ── ⚠️ EXIGE `reference` NAS DUAS AMOSTRAS ───────────────────────────────────
 *
 * Sem referência anterior não há spread anterior, e sem spread anterior não há
 * transição — a condição simplesmente não vale. É o que faz o aquecimento do
 * indicador se resolver sozinho: enquanto a média lenta ainda é `null` o
 * consumidor manda amostra sem `reference`, nada dispara, e o primeiro
 * cruzamento REAL depois disso é detectado normalmente. Inventar um valor para a
 * referência faltante produziria um disparo fantasma na barra em que o indicador
 * termina de aquecer.
 *
 * `direction` escolhe o sentido, na mesma forma do `PERCENT_CHANGE`:
 *  - `'above'` → `value` cruza `reference` de baixo para cima (compra clássica)
 *  - `'below'` → de cima para baixo
 *  - `'both'`  → qualquer um dos dois
 *
 * ⚠️ `'both'` com modo `recurring` expôs um defeito no re-armamento, hoje
 * corrigido: cruzar para cima e voltar na amostra SEGUINTE perdia o segundo
 * disparo, porque o motor lia "a condição ainda vale" e não re-armava. Cruzamento
 * é evento instantâneo, então condição de transição re-arma na hora — ver
 * `ehInstantanea` em `alert-engine.core.ts`.
 */
export interface SeriesCrossCondition {
  readonly kind: 'SERIES_CROSS';
  readonly direction: 'above' | 'below' | 'both';
}

/** União de todas as condições. Discriminada por `kind`. */
export type AlertCondition =
  | CrossAboveCondition
  | CrossBelowCondition
  | TouchCondition
  | EnterZoneCondition
  | ExitZoneCondition
  | PercentChangeCondition
  | SeriesCrossCondition;

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
  /**
   * ⭐ A SEGUNDA série, para o `SERIES_CROSS`. Ausente/não-finita = "não sei".
   *
   * ⚠️ Um campo na AMOSTRA, e não na condição, de propósito. A referência muda a
   * cada barra (é uma média móvel, uma banda, outro indicador), então gravá-la na
   * condição significaria reescrever a condição a cada barra — e a condição é o
   * que o consumidor PERSISTE no layout. Assim a condição continua sendo a
   * pergunta ("cruzou para cima?") e a amostra continua sendo o dado.
   *
   * Mantém o pacote agnóstico do mesmo jeito que `value`: são dois números que o
   * consumidor escolhe. O pacote não sabe que um deles é uma EMA.
   */
  readonly reference?: number;
}
