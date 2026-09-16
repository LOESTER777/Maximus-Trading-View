/**
 * price-format.core — formatacao PURA de preco: casas decimais por tick, e
 * arredondamento ao tick. Sem DOM, sem relogio, sem estado de modulo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE NUCLEO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O eixo de preco e o rotulo de crosshair vinham derivando as casas decimais so
 * da AMPLITUDE visivel (`decimalsForSpan`): span >= 100 => 0 casas, e por aI. Isso
 * acerta a leitura visual, mas ERRA o instrumento — um mini-indice de tick 5
 * pontos nao deveria mostrar "137.25", e um par de forex de tick 0.00001 precisa
 * de 5 casas mesmo quando a janela e larga.
 *
 * O instrumento sabe seu tick; a amplitude nao. Este nucleo formata a partir do
 * QUE O INSTRUMENTO E (tickSize/precision), deixando a heuristica de amplitude
 * como fallback la no renderer para quando nao ha tick configurado.
 *
 * ⚠️ Decisao documentada: preco NAO-FINITO (NaN, ±Infinity) devolve `'—'` (travessao),
 * nunca string vazia nem `'0'`. Vazio somem sem deixar rastro na caixa do eixo e
 * confunde com "sem rotulo"; `'0'` seria um preco legitimo e mentiria. O travessao
 * e o sinal universal de "sem valor" e ocupa espaco, entao a caixa nao colapsa.
 * A funcao e TOTAL: nunca lanca, para nao derrubar o ciclo de render.
 */

/** Sinal de "sem valor" para preco nao-finito. Ver cabecalho. */
export const PRICE_PLACEHOLDER = '—';

/**
 * Opcoes de formatacao de preco.
 *
 * As tres sao opcionais e combinaveis. A precedencia esta documentada em
 * `formatPrice`: `precision` explicito vence; senao `tickSize` deriva as casas;
 * senao caem num default de 2 casas.
 */
export interface PriceFormatOptions {
  /** Casas decimais explicitas. Vence `tickSize` quando ambos vem. */
  readonly precision?: number;
  /**
   * Tamanho do tick do instrumento (menor variacao de preco). Deriva as casas
   * decimais (0.01 => 2, 0.5 => 1, 5 => 0) E arredonda o preco ao multiplo do
   * tick antes de formatar.
   */
  readonly tickSize?: number;
  /**
   * Menor movimento cotavel. Alias pratico de `tickSize` para quem pensa em
   * "minMove"; se ambos vierem, `tickSize` tem precedencia por ser o nome usado
   * no resto do motor. So arredonda/deriva casas se `tickSize` estiver ausente.
   */
  readonly minMove?: number;
}

/**
 * Deriva o numero de casas decimais a partir de um tick.
 *
 * ⭐ A regra e "quantas casas o tick ocupa": 0.01 => 2, 0.5 => 1, 5 => 0,
 * 0.00001 => 5. Implementado por contagem de zeros, NAO por
 * `-Math.log10(tick)` — o log de 0.001 devolve 2.9999... por erro de ponto
 * flutuante, e o arredondamento erraria a casa. Aqui contamos a parte fracionaria
 * da representacao decimal, com teto para nao girar sem fim num tick minusculo.
 *
 * Tick nao-finito ou <= 0 devolve 0 casas (fallback seguro, nunca NaN).
 */
export function decimalsFromTick(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 0;
  // Tick >= 1 (5, 10, 25): inteiro, 0 casas.
  if (tickSize >= 1) return 0;
  // Conta casas ate o tick "fechar" num inteiro. Teto de 10 casas: alem disso e
  // ruido de ponto flutuante, nao precisao real de instrumento.
  let casas = 0;
  let t = tickSize;
  while (casas < 10 && Math.abs(Math.round(t) - t) > 1e-9) {
    t *= 10;
    casas += 1;
  }
  return casas;
}

/**
 * Arredonda um preco ao multiplo mais proximo do tick.
 *
 * ⚠️ Divide, arredonda, multiplica — e depois RE-arredonda ao numero de casas do
 * tick com `toFixed`+`Number`, porque `Math.round(p/tick)*tick` reintroduz lixo
 * binario (0.1+0.2 classico) que faria o `toFixed` posterior mostrar "1.2300000001".
 * Tick nao-finito ou <= 0: devolve o preco intacto (nada a arredondar).
 */
export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price)) return price;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  const arredondado = Math.round(price / tickSize) * tickSize;
  const casas = decimalsFromTick(tickSize);
  return Number(arredondado.toFixed(casas));
}

/**
 * Formata um preco conforme o instrumento. TOTAL: nunca lanca.
 *
 * Precedencia das opcoes:
 *   1. preco nao-finito -> `PRICE_PLACEHOLDER` (travessao), sempre;
 *   2. `precision` explicito -> tantas casas (arredonda ao tick antes, se houver);
 *   3. `tickSize` (ou `minMove` como alias) -> casas derivadas do tick + arredonda;
 *   4. nada -> 2 casas.
 *
 * `precision` negativo ou nao-finito e ignorado (cai na regra seguinte); casas
 * sao clampadas a [0, 20] — o limite que `toFixed` aceita sem lancar.
 */
export function formatPrice(price: number, opts: PriceFormatOptions = {}): string {
  if (!Number.isFinite(price)) return PRICE_PLACEHOLDER;

  // tickSize tem precedencia sobre minMove (ver PriceFormatOptions.minMove).
  const tick =
    opts.tickSize !== undefined && Number.isFinite(opts.tickSize) && opts.tickSize > 0
      ? opts.tickSize
      : opts.minMove !== undefined && Number.isFinite(opts.minMove) && opts.minMove > 0
        ? opts.minMove
        : undefined;

  // Arredonda ao tick primeiro, quando ha tick — o rotulo mostra um preco que o
  // instrumento poderia de fato negociar, nao um valor entre ticks.
  const valor = tick !== undefined ? roundToTick(price, tick) : price;

  let casas: number;
  if (opts.precision !== undefined && Number.isFinite(opts.precision) && opts.precision >= 0) {
    casas = Math.min(20, Math.floor(opts.precision));
  } else if (tick !== undefined) {
    casas = decimalsFromTick(tick);
  } else {
    casas = 2;
  }

  return valor.toFixed(casas);
}
