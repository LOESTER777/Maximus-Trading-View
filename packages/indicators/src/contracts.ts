/**
 * contracts — o contrato de indicador tecnico. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DECISAO CENTRAL: INCREMENTAL, NAO BATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O framework de indicadores da origem (projeto Trading) era BATCH:
 * `calculate(candles[])` recebia o array inteiro e recalculava a serie do zero a
 * cada barra nova. Para uma tela de decisao com poucos indicadores isso passa;
 * para N simbolos x M timeframes x K indicadores x assinantes ao vivo, nao fecha.
 *
 * Aqui o contrato e `warmup(history)` seguido de `update(bar) -> valor`, com
 * estado rolante O(1). Uma barra nova custa uma atualizacao, nao um recalculo.
 *
 * A verificacao que amarra isso e uma propriedade, nao um comentario: alimentar o
 * indicador barra a barra produz **o mesmo** que recalcular tudo de uma vez. Ver
 * `__tests__/incremental-igual-batch.spec.ts` — se um indicador novo violar isso,
 * o teste reprova.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE NAO REUSAMOS O FRAMEWORK DA ORIGEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O da origem tem DAG, cache e metadados bem desenhados — mas o modelo de calculo
 * e batch, e trocar isso e trocar a espinha. Reescrever o contrato como
 * incremental e mais honesto que remendar o batch para "parecer" rolante. Os
 * metadados e a ideia de DAG foram trazidos; o modelo de execucao e novo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BARRA NAO FECHADA — CIDADA DE PRIMEIRA CLASSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A ultima barra de um grafico ao vivo esta EM FORMACAO: seu fechamento muda a
 * cada tick ate a barra fechar. Um indicador ingenuo que so faz `update` no
 * fechamento fica congelado durante a barra corrente; um que faz `update` a cada
 * tick corrompe o estado rolante, porque a mesma barra entra varias vezes.
 *
 * A saida e `preview(bar)`: calcula o valor COMO SE a barra fechasse com aquele
 * fechamento, SEM tocar no estado. Quando a barra fecha de verdade, `update`
 * consolida uma vez. E o que faz o RSI da barra corrente se mexer ao vivo sem
 * envenenar o RSI das barras fechadas.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Insumo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma barra, como o indicador a consome.
 *
 * `time` em epoch SEGUNDOS — a mesma unidade do motor e do desenho. Volume
 * opcional: indicador de preco nao precisa, e a maioria das fontes de forex nao
 * manda volume confiavel.
 */
export interface IndicatorBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/**
 * Qual preco da barra o indicador usa como fonte.
 *
 * `hlc3` (preco tipico) e `ohlc4` existem porque varios indicadores classicos os
 * usam por definicao — CCI usa hlc3, e nao close. Embutir a escolha na fonte
 * evita que cada indicador reimplemente a extracao e erre a definicao.
 */
export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';

/** Extrai o preco-fonte de uma barra. Total: nunca lanca. */
export function priceOf(bar: IndicatorBar, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:
      return bar.close;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Saida
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O valor de um indicador numa barra.
 *
 * Um objeto de campos nomeados, e nao um numero, porque muitos indicadores
 * produzem MAIS de uma serie: MACD tem macd/sinal/histograma, Bollinger tem
 * banda superior/media/inferior, Stochastic tem %K/%D. Um numero so forcaria
 * cada consumidor a saber a ordem posicional, que e fragil.
 *
 * `null` num campo significa **"ainda nao ha valor"** — o periodo de aquecimento
 * nao completou. Nunca zero: zero e um valor de indicador legitimo (um oscilador
 * centrado, um histograma no cruzamento), e confundir "sem valor" com "valor
 * zero" desenharia uma linha reta no zero durante o aquecimento.
 */
export type IndicatorValue = Readonly<Record<string, number | null>>;

/** Um valor associado ao instante da barra. Para montar series de plotagem. */
export interface IndicatorPoint {
  readonly time: number;
  readonly values: IndicatorValue;
}

// ═════════════════════════════════════════════════════════════════════════════
// Metadados
// ═════════════════════════════════════════════════════════════════════════════

/** Categoria, para agrupar na interface e escolher onde plotar. */
export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'oscillator';

/** Descricao de um parametro, tipada o bastante para gerar UI de configuracao. */
export interface ParamSpec {
  readonly name: string;
  readonly label: string;
  readonly type: 'number' | 'source' | 'boolean';
  readonly default: number | PriceSource | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/**
 * Uma serie de saida, e como ela quer ser desenhada.
 *
 * ⚠️ O indicador declara a FORMA de plotagem (linha, histograma, banda) e o
 * PAINEL preferido (sobre o preco ou numa faixa propria), mas NAO desenha. Quem
 * desenha e o motor, lendo este descritor. E o que desacopla calculo de render
 * sem cada indicador conhecer canvas.
 */
export interface OutputSpec {
  /** Chave do valor em `IndicatorValue`. */
  readonly key: string;
  readonly label: string;
  /** Como plotar esta serie. */
  readonly plot: 'line' | 'histogram' | 'area' | 'band';
  /**
   * Painel preferido.
   *
   * `'price'` = sobre as velas (medias moveis, Bollinger, VWAP). `'separate'` =
   * faixa propria embaixo (RSI, MACD, ADX) — oscilador de 0-100 sobre o preco
   * seria invisivel.
   */
  readonly pane: 'price' | 'separate';
  readonly color?: string;
  /** Linhas de referencia horizontais (RSI 30/70, por exemplo). */
  readonly referenceLines?: readonly number[];
  /**
   * Papel desta saida numa BANDA (Bollinger, Keltner).
   *
   * ⭐ Marca as tres saidas de um mesmo indicador como partes de uma faixa: as
   * marcadas `'upper'` e `'lower'` delimitam o preenchimento; `'middle'` e a
   * linha central. NAO muda o `plot` da saida (as linhas continuam sendo linha) —
   * e um dado A MAIS que diz ao plotter "monte tambem uma faixa preenchida entre
   * a `upper` e a `lower` deste indicador". Ausente = saida solta, sem banda.
   *
   * O CALCULO do indicador nao muda por causa disto; so a forma de plotar.
   */
  readonly band?: 'upper' | 'lower' | 'middle';
}

/** Tudo que descreve um indicador sem calcula-lo. */
export interface IndicatorMeta {
  readonly name: string;
  readonly label: string;
  readonly category: IndicatorCategory;
  readonly params: readonly ParamSpec[];
  readonly outputs: readonly OutputSpec[];
  /**
   * Nomes de indicadores dos quais este depende.
   *
   * MACD depende de EMA, por exemplo. O resolvedor usa isto para ordenar o
   * calculo. Vazio para indicador autossuficiente.
   */
  readonly dependencies?: readonly string[];
  /**
   * Barras minimas ate o primeiro valor NAO-nulo, dado os parametros.
   *
   * Serve para a interface avisar "aguardando N barras" em vez de mostrar linha
   * vazia sem explicacao, e para o consumidor dimensionar quanto historico pedir.
   */
  readonly warmup: (params: IndicatorParams) => number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Parametros
// ═════════════════════════════════════════════════════════════════════════════

/** Parametros de uma instancia de indicador. */
export type IndicatorParams = Readonly<Record<string, number | PriceSource | boolean>>;

/** Resultado de validacao de parametros. */
export interface ParamValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// O indicador
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma instancia de indicador, com estado rolante.
 *
 * O ciclo de vida:
 *
 *   1. `warmup(history)` — alimenta o historico de uma vez, na criacao;
 *   2. `update(bar)`     — cada barra FECHADA nova, uma vez; muta o estado;
 *   3. `preview(bar)`    — a barra em formacao, a cada tick; NAO muta o estado;
 *   4. `snapshot()`      — o valor corrente, para consulta sem alimentar nada.
 *
 * ⚠️ `update` e `preview` NAO sao intercambiaveis. Chamar `update` na barra em
 * formacao a cada tick registra a mesma barra varias vezes e corrompe medias
 * rolantes. `preview` existe exatamente para nao fazer isso.
 */
export interface IndicatorInstance {
  readonly meta: IndicatorMeta;
  readonly params: IndicatorParams;

  /**
   * Alimenta o historico e devolve a serie completa.
   *
   * Idempotente por reconstrucao: chamar de novo REINICIA o estado e reprocessa.
   * Nao ha "continuar de onde parou" — para isso e `update`.
   */
  warmup(history: readonly IndicatorBar[]): readonly IndicatorPoint[];

  /**
   * Consome UMA barra fechada e devolve o valor dela. Muta o estado.
   *
   * A barra deve ter tempo MAIOR que a ultima consumida. Barra fora de ordem ou
   * repetida e recusada (devolve o snapshot corrente sem mutar), porque
   * reprocessar a mesma barra envenenaria o estado rolante.
   */
  update(bar: IndicatorBar): IndicatorValue;

  /**
   * Calcula o valor COMO SE a barra fechasse assim, SEM mutar o estado.
   *
   * Para a barra em formacao ao vivo. Chamar mil vezes seguidas com fechamentos
   * diferentes e seguro: o estado consolidado nao muda.
   */
  preview(bar: IndicatorBar): IndicatorValue;

  /** O valor corrente, sem alimentar nada. */
  snapshot(): IndicatorValue;

  /** Reinicia para o estado vazio. */
  reset(): void;
}

/** Uma fabrica de indicador: valida parametros e cria instancias. */
export interface IndicatorFactory {
  readonly meta: IndicatorMeta;
  /** Valida parametros contra os `ParamSpec`. Nunca lanca. */
  validate(params: IndicatorParams): ParamValidation;
  /** Cria uma instancia. Parametros ausentes caem no default do `ParamSpec`. */
  create(params?: IndicatorParams): IndicatorInstance;
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares de parametro
// ═════════════════════════════════════════════════════════════════════════════

/** Le um parametro numerico, com default e piso. Nunca devolve NaN. */
export function numParam(
  params: IndicatorParams,
  spec: ParamSpec,
): number {
  const v = params[spec.name];
  const n = typeof v === 'number' && Number.isFinite(v) ? v : (spec.default as number);
  // Respeita min/max do spec: parametro fora da faixa e clampado, nao rejeitado,
  // porque a validacao ja avisou e a instancia nao deve produzir NaN por isso.
  const min = spec.min ?? -Infinity;
  const max = spec.max ?? Infinity;
  return Math.min(max, Math.max(min, n));
}

/** Le a fonte de preco de um parametro, com default. */
export function sourceParam(params: IndicatorParams, spec: ParamSpec): PriceSource {
  const v = params[spec.name];
  const validas: readonly PriceSource[] = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'];
  return typeof v === 'string' && (validas as readonly string[]).includes(v)
    ? (v as PriceSource)
    : (spec.default as PriceSource);
}

/** Aplica os defaults dos specs a um conjunto parcial de parametros. */
export function withDefaults(specs: readonly ParamSpec[], params?: IndicatorParams): IndicatorParams {
  const saida: Record<string, number | PriceSource | boolean> = {};
  for (const s of specs) saida[s.name] = s.default;
  if (params !== undefined) {
    for (const s of specs) {
      const v = params[s.name];
      if (v !== undefined) saida[s.name] = v;
    }
  }
  return saida;
}

/** Validacao generica contra os specs. Reutilizada por toda fabrica. */
export function validateAgainstSpecs(
  specs: readonly ParamSpec[],
  params: IndicatorParams,
): ParamValidation {
  const errors: string[] = [];
  for (const s of specs) {
    const v = params[s.name];
    if (v === undefined) continue; // ausente cai no default; nao e erro
    if (s.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${s.name}: esperado numero finito`);
        continue;
      }
      if (s.min !== undefined && v < s.min) errors.push(`${s.name}: abaixo do minimo ${s.min}`);
      if (s.max !== undefined && v > s.max) errors.push(`${s.name}: acima do maximo ${s.max}`);
    } else if (s.type === 'boolean' && typeof v !== 'boolean') {
      errors.push(`${s.name}: esperado booleano`);
    }
  }
  return { valid: errors.length === 0, errors };
}
