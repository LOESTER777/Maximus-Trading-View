/**
 * price-scale.core — o eixo de preco. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Converte preco em Y de pixel e volta, e decide a faixa de preco visivel por
 * AUTOESCALA: olha o minimo e o maximo das barras que estao na janela horizontal e
 * ajusta o eixo para caberem, com margens.
 *
 * ⚠️ Autoescala pela janela VISIVEL, nao pelo conjunto todo. Se a escala fosse
 * pelo pregao inteiro, dar zoom num trecho lateral deixaria as velas achatadas
 * numa faixa fina, porque o eixo ainda reservaria espaco para uma maxima que nem
 * esta na tela. Reescalar pelo que se ve e o que faz o zoom ser util.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Y CRESCE PARA BAIXO — A INVERSAO QUE TODO GRAFICO TEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Em canvas, y=0 e o TOPO. Preco alto fica no topo (y pequeno), preco baixo
 * embaixo (y grande). A conversao inverte de proposito; errar o sinal aqui poe o
 * grafico de cabeca para baixo, e e o primeiro bug a suspeitar se as velas
 * saírem invertidas.
 */

/** Estado do eixo de preco. Mutavel: objeto de sessao. */
export interface PriceScaleState {
  /** Preco no TOPO da area (y = 0). */
  topPrice: number;
  /** Preco na BASE da area (y = height). */
  bottomPrice: number;
  /** Altura da area de plotagem, em pixel logico. */
  height: number;
  /** Margens como fracao da altura: espaco reservado acima e abaixo do conteudo. */
  marginTop: number;
  marginBottom: number;
  /** Escala logaritmica. */
  logarithmic: boolean;
  /**
   * ⭐ Percentil para o TETO da autoescala quando o grupo e so de HISTOGRAMA.
   *
   * `undefined` (default) = teto no MAXIMO, o comportamento historico. Ver
   * `PriceScaleOptions.histogramTopPercentile` para a medicao que motiva o recurso e para o
   * custo declarado de ligar.
   *
   * ⚠️ Fica no ESTADO da escala, e nao numa opcao global do grafico, porque a decisao e por
   * escala: a de volume quer compressao, a do preco nunca (recortar preco esconderia a maxima
   * do dia, que e um nivel de referencia).
   */
  histogramTopPercentile?: number;
}

export function createPriceScaleState(marginTop = 0.08, marginBottom = 0.2): PriceScaleState {
  return {
    topPrice: 1,
    bottomPrice: 0,
    height: 0,
    marginTop,
    marginBottom,
    logarithmic: false,
  };
}

/** Transforma preco para o espaco onde a escala e linear (identidade, ou log). */
function toScale(s: PriceScaleState, price: number): number {
  if (!s.logarithmic) return price;
  // Log so vale para preco positivo; preco <= 0 nao existe em mercado real, mas
  // um dado sujo poderia trazer, e `log` de nao-positivo e NaN. Piso minusculo.
  return Math.log(Math.max(1e-10, price));
}

function fromScale(s: PriceScaleState, v: number): number {
  return s.logarithmic ? Math.exp(v) : v;
}

/**
 * Preco -> Y em pixel. `null` para preco nao-finito ou faixa degenerada.
 *
 * O Y util fica entre as margens: `marginTop*height` no topo e
 * `height*(1-marginBottom)` na base. As margens sao o respiro que impede a vela
 * de tocar a borda.
 */
export function priceToCoordinate(s: PriceScaleState, price: number): number | null {
  if (!Number.isFinite(price) || s.height <= 0) return null;
  const topo = toScale(s, s.topPrice);
  const base = toScale(s, s.bottomPrice);
  const span = topo - base;
  if (span === 0) return null;

  const yTop = s.height * s.marginTop;
  const yBot = s.height * (1 - s.marginBottom);
  const alturaUtil = yBot - yTop;

  const p = toScale(s, price);
  // (topo - p)/span = 0 no topo, 1 na base -> Y cresce para baixo.
  return yTop + ((topo - p) / span) * alturaUtil;
}

/** Y em pixel -> preco. Inverso exato. */
export function coordinateToPrice(s: PriceScaleState, y: number): number | null {
  if (!Number.isFinite(y) || s.height <= 0) return null;
  const topo = toScale(s, s.topPrice);
  const base = toScale(s, s.bottomPrice);
  const span = topo - base;
  if (span === 0) return null;

  const yTop = s.height * s.marginTop;
  const yBot = s.height * (1 - s.marginBottom);
  const alturaUtil = yBot - yTop;
  if (alturaUtil === 0) return null;

  const frac = (y - yTop) / alturaUtil;
  const p = topo - frac * span;
  return fromScale(s, p);
}

/**
 * Reajusta topo/base para caber [minPrice, maxPrice], com uma folga simetrica.
 *
 * A folga (5% do intervalo) impede a maxima e a minima de tocarem exatamente a
 * borda util — visualmente sugere que o preco "estourou" a tela quando nao
 * estourou. Faixa degenerada (min == max, uma serie plana) recebe uma faixa
 * artificial de ±1 para nao dividir por zero.
 */
export function autoScale(s: PriceScaleState, minPrice: number, maxPrice: number): void {
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return;
  if (minPrice === maxPrice) {
    s.topPrice = maxPrice + 1;
    s.bottomPrice = minPrice - 1;
    return;
  }
  const folga = (maxPrice - minPrice) * 0.05;
  s.topPrice = maxPrice + folga;
  s.bottomPrice = minPrice - folga;
}

/**
 * Gera os niveis de rotulo do eixo, "redondos" e legiveis.
 *
 * Escolhe um passo agradavel (1, 2, 2.5, 5 x potencia de 10) proximo do passo
 * bruto que caberia em ~`target` divisoes. Rotulo em valor quebrado (137,43) e
 * ruido; em valor redondo (137,50) o olho ancora.
 *
 * ⭐ Em escala LOGARITMICA o passo linear e o defeito, nao a solucao: os niveis
 * saem amontoados numa ponta e vazios na outra. Ver `logTicks`.
 */
export function priceTicks(s: PriceScaleState, target = 6): number[] {
  const span = s.topPrice - s.bottomPrice;
  if (span <= 0 || !Number.isFinite(span)) return [];

  if (s.logarithmic) {
    const log = logTicks(s, target);
    // Faixa curta em log (menos de uma decada) rende poucos niveis 1/2/5; ai o
    // passo linear le melhor, e a diferenca visual e desprezivel — ver `logTicks`.
    if (log.length >= 3) return log;
  }

  return linearTicks(s, target);
}

/** O passo linear "bonito" — o comportamento historico, preservado intacto. */
function linearTicks(s: PriceScaleState, target: number): number[] {
  const span = s.topPrice - s.bottomPrice;
  const passoBruto = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  const norm = passoBruto / magnitude;
  const passoBonito =
    (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;

  const inicio = Math.ceil(s.bottomPrice / passoBonito) * passoBonito;
  const ticks: number[] = [];
  for (let p = inicio; p <= s.topPrice + passoBonito * 0.001; p += passoBonito) {
    ticks.push(p);
  }
  return ticks;
}

/**
 * Niveis de rotulo para escala LOGARITMICA: potencias de 10 e as subdivisoes
 * 1 / 2 / 5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO CORRIGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `priceTicks` gerava passo LINEAR mesmo com `logarithmic: true`. Numa faixa de
 * 10 a 1.000 com 6 divisoes, o passo linear e ~165: os rotulos saem em 165, 330,
 * 495, 660, 825, 990 — e em log **os quatro ultimos ficam amontoados no terco
 * superior** enquanto a metade de baixo da tela (10 a 100, uma decada inteira, que
 * em log ocupa 1/3 da altura) recebe ZERO rotulo. O eixo passa a mentir sobre
 * onde estao os niveis.
 *
 * ⭐ A escada 1/2/5 e a certa aqui porque ela e **uniforme em log**: os saltos
 * 1→2→5→10 valem 0,30 / 0,40 / 0,30 decada, quase equidistantes na tela. Uma
 * escada 1/3 ou 1/2,5 daria espacamento visivelmente irregular.
 *
 * ⚠️ Base <= 0 cai fora: log de nao-positivo nao existe, e a faixa em log seria
 * degenerada (o piso de `toScale` distorceria em ordens de magnitude). Devolve
 * vazio e o chamador usa o passo linear — melhor um eixo linear correto que um
 * log inventado.
 */
function logTicks(s: PriceScaleState, target: number): number[] {
  const lo = s.bottomPrice;
  const hi = s.topPrice;
  if (!(lo > 0) || !(hi > lo) || !Number.isFinite(hi)) return [];

  const kMin = Math.floor(Math.log10(lo));
  const kMax = Math.ceil(Math.log10(hi));
  const decadas = kMax - kMin;
  if (!Number.isFinite(decadas) || decadas <= 0 || decadas > 320) return [];

  // Quantas subdivisoes por decada, e de quantas em quantas decadas rotular.
  //
  // Ate 2 decadas cabem as tres mantissas (3 rotulos/decada = ate 6, o `target`).
  // Ate 4 decadas fica 1/5 (2 por decada). Alem disso so a potencia de 10, e se
  // ainda forem muitas, pula decadas — em 12 decadas rotular cada uma amontoaria.
  let mantissas: readonly number[];
  let passoDecada = 1;
  if (decadas <= 2) mantissas = [1, 2, 5];
  else if (decadas <= 4) mantissas = [1, 5];
  else {
    mantissas = [1];
    passoDecada = Math.max(1, Math.ceil(decadas / Math.max(1, target)));
  }

  const ticks: number[] = [];
  for (let k = kMin; k <= kMax; k += passoDecada) {
    const potencia = Math.pow(10, k);
    for (const m of mantissas) {
      const p = m * potencia;
      // Tolerancia relativa: `5 * 1e-7` nao e exatamente representavel, e um `>=`
      // cru descartaria o nivel que coincide com a borda da faixa.
      if (p >= lo * (1 - 1e-9) && p <= hi * (1 + 1e-9)) ticks.push(p);
    }
  }
  // As mantissas saem em ordem dentro de cada decada e as decadas crescem, entao a
  // lista ja e crescente; o sort e barato e blinda contra mudanca na escada.
  return ticks.sort((a, b) => a - b);
}
