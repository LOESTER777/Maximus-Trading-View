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
 */
export function priceTicks(s: PriceScaleState, target = 6): number[] {
  const span = s.topPrice - s.bottomPrice;
  if (span <= 0 || !Number.isFinite(span)) return [];

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
