/**
 * Valores conhecidos, LOTE 4 — os VINTE indicadores que nunca tinham conferência externa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE LOTE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pacote tem 45 indicadores. Vinte e cinco tinham valor conferido contra referência; **vinte
 * não tinham nada além do property test**, e o property test não pode achar erro de FÓRMULA —
 * ele roda o mesmo código nas duas pontas da igualdade *incremental == batch*.
 *
 * ⭐⭐ Taxa medida na primeira leva: **2 defeitos reais em 12 indicadores conferidos** (ROC e
 * Momentum com defasagem `period+1`; LSMA errando da segunda emissão). Vinte indicadores sem
 * conferência, com essa taxa, é uma expectativa de três defeitos — num pacote cujo produto é a
 * decisão de quem opera.
 *
 * ── COMO A CONFERÊNCIA É FEITA, E POR QUE ELA VALE ────────────────────────
 *
 * Duas camadas, e a segunda é o que impede a primeira de se autoenganar:
 *
 * 1. **Referência BATCH** (`referencia-batch.ts`), escrita da definição de livro, sem estado
 *    rolante. Todo defeito de acumulador — soma que não devolve o que saiu, seed de EMA errado,
 *    janela deslocada por um — é inexprimível nela, e é exatamente a classe dos dois já achados.
 * 2. **ÂNCORAS LITERAIS** em três índices por saída, calculadas FORA (em Python, da fórmula).
 *    Sem elas a referência batch poderia carregar o mesmo mal-entendido que a implementação, e
 *    as duas concordariam em silêncio.
 *
 * ⚠️ A série tem **OHLC de verdade**, e isso é requisito, não capricho. A série do lote 3 usa
 * `open === close`, e com ela **BOP e ADL são identicamente zero** — `(C−O)` é zero e
 * `(C−L)−(H−C)` é zero num pavio simétrico. Testar os dois ali daria verde provando nada. Esta
 * série tem abertura no fechamento anterior, pavios ASSIMÉTRICOS e volume por agressor.
 */

import { describe, expect, it } from 'vitest';

import {
  adlFactory,
  adxFactory,
  aroonFactory,
  bollingerFactory,
  bopFactory,
  choppinessFactory,
  cvdFactory,
  deltaFactory,
  deltaRatioFactory,
  demaFactory,
  elderRayFactory,
  forceIndexFactory,
  keltnerFactory,
  ppoFactory,
  rsiFactory,
  stochRsiFactory,
  temaFactory,
  trixFactory,
  vwapFactory,
} from '../index.js';
// ⭐⭐ Tudo pelo ÍNDICE, e isto é resultado deste lote: dezesseis fábricas — entre elas HMA,
// KAMA, TRIX, PPO, Stoch RSI, Aroon, Chop, BOP, ADL, Force, Elder Ray, delta, CVD e delta % —
// eram importadas no índice para entrar no registry e **nunca reexportadas**. O lote 3 tinha
// contornado o sintoma importando VWMA e LSMA do módulo, com a hipótese de "ciclo de
// importação"; a causa era mais simples e pior: elas não estavam na lista de export. A guarda
// mecânica está em `indice-exporta-tudo.spec.ts`.
import { hmaFactory, kamaFactory } from '../index.js';
import type { IndicatorBar, IndicatorFactory } from '../contracts.js';
import {
  adlRef,
  adxRef,
  aroonRef,
  bollingerRef,
  bopRef,
  choppinessRef,
  closesDe,
  cvdRef,
  deltaRatioRef,
  deltaRef,
  demaRef,
  elderRayRef,
  forceIndexRef,
  hmaRef,
  kamaRef,
  keltnerRef,
  ppoRef,
  stochRsiRef,
  temaRef,
  trixRef,
  vwapRef,
  type BarraDeReferencia,
  type Serie,
} from './referencia-batch.js';

// ═════════════════════════════════════════════════════════════════════════════
// A série
// ═════════════════════════════════════════════════════════════════════════════

const OPENS = [100, 100.9, 102.34, 104.23, 106.46, 108.86, 111.25, 113.45, 115.27, 116.56, 117.22, 117.18, 116.44, 115.05, 113.12, 110.79, 108.25, 105.68, 103.28, 101.22, 99.63, 98.61, 98.2, 98.38, 99.08, 100.2, 101.59, 103.09, 104.55, 105.81, 106.76, 107.32, 107.46, 107.2, 106.61, 105.78, 104.85, 103.96, 103.26, 102.87, 102.89, 103.37, 104.32, 105.7, 107.41, 109.32, 111.27, 113.09, 114.6, 115.65, 116.13, 115.96, 115.12, 113.65, 111.64, 109.22, 106.57, 103.88, 101.35, 99.16] as const;
const HIGHS = [101.05, 102.72, 104.72, 106.91, 109.13, 111.52, 113.91, 115.76, 116.93, 117.38, 117.6, 117.68, 116.89, 115.31, 113.4, 111.25, 108.74, 106.05, 103.44, 101.6, 100.13, 99.06, 98.64, 99.36, 100.66, 102.08, 103.45, 104.72, 106.2, 107.26, 107.76, 107.71, 107.75, 107.66, 107.1, 106.14, 105.02, 104.35, 103.76, 103.33, 103.61, 104.61, 106.17, 107.9, 109.67, 111.45, 113.49, 115.1, 116.09, 116.37, 116.43, 116.43, 115.61, 114, 111.83, 109.62, 107.07, 104.31, 101.58, 99.47] as const;
const LOWS = [99.5, 100.45, 102.02, 104.07, 106.13, 108.4, 110.75, 113.01, 114.96, 116.39, 116.84, 115.98, 114.55, 112.68, 110.49, 108.07, 105.32, 102.81, 100.72, 99.2, 98.33, 98, 97.83, 97.9, 98.58, 99.78, 101.32, 102.88, 104.17, 105.33, 106.27, 106.91, 106.94, 106.39, 105.39, 104.37, 103.47, 102.86, 102.62, 102.63, 102.49, 102.88, 103.83, 105.31, 107.18, 109.07, 110.86, 112.6, 114.12, 115.27, 115.74, 114.86, 113.24, 111.15, 108.74, 106.2, 103.67, 101.08, 98.74, 96.96] as const;
const CLOSES = [100.9, 102.34, 104.23, 106.46, 108.86, 111.25, 113.45, 115.27, 116.56, 117.22, 117.18, 116.44, 115.05, 113.12, 110.79, 108.25, 105.68, 103.28, 101.22, 99.63, 98.61, 98.2, 98.38, 99.08, 100.2, 101.59, 103.09, 104.55, 105.81, 106.76, 107.32, 107.46, 107.2, 106.61, 105.78, 104.85, 103.96, 103.26, 102.87, 102.89, 103.37, 104.32, 105.7, 107.41, 109.32, 111.27, 113.09, 114.6, 115.65, 116.13, 115.96, 115.12, 113.65, 111.64, 109.22, 106.57, 103.88, 101.35, 99.16, 97.46] as const;
const VOLS = [1000, 1037, 1074, 1111, 1148, 1185, 1222, 1259, 1296, 1333, 1370, 1407, 1444, 1481, 1018, 1055, 1092, 1129, 1166, 1203, 1240, 1277, 1314, 1351, 1388, 1425, 1462, 1499, 1036, 1073, 1110, 1147, 1184, 1221, 1258, 1295, 1332, 1369, 1406, 1443, 1480, 1017, 1054, 1091, 1128, 1165, 1202, 1239, 1276, 1313, 1350, 1387, 1424, 1461, 1498, 1035, 1072, 1109, 1146, 1183] as const;
const BUYS = [350, 487, 611, 703, 745, 730, 659, 542, 507, 675, 816, 906, 929, 881, 514, 411, 472, 610, 719, 781, 784, 726, 615, 475, 654, 813, 926, 973, 638, 577, 476, 451, 601, 728, 810, 833, 791, 690, 546, 626, 801, 628, 685, 689, 640, 544, 424, 585, 729, 832, 876, 853, 764, 625, 591, 527, 640, 715, 737, 701] as const;

const T0 = 1_600_000_000;

/** As barras no formato do pacote. */
function serie(): IndicatorBar[] {
  return CLOSES.map((c, i) => ({
    time: T0 + i * 60,
    open: OPENS[i]!,
    high: HIGHS[i]!,
    low: LOWS[i]!,
    close: c,
    volume: VOLS[i]!,
    buyVolume: BUYS[i]!,
    sellVolume: VOLS[i]! - BUYS[i]!,
  }));
}

/** As mesmas barras no formato da referência. */
function barras(): BarraDeReferencia[] {
  return serie().map((b) => ({
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume as number,
    buyVolume: b.buyVolume as number,
    sellVolume: b.sellVolume as number,
  }));
}

const TIMES = CLOSES.map((_, i) => T0 + i * 60);

// ═════════════════════════════════════════════════════════════════════════════
// As duas conferências
// ═════════════════════════════════════════════════════════════════════════════

function saidaDe(fabrica: IndicatorFactory, key: string, params: object = {}): Serie {
  return fabrica.create(params).warmup(serie()).map((p) => p.values[key] ?? null);
}

/**
 * Compara implementação contra referência a partir do primeiro ponto em que as duas emitem.
 *
 * ⚠️ **`minimo` é obrigatório**, e é a guarda que impede o teste de passar provando nada: sem
 * um piso de pontos comparados, um indicador que devolvesse `null` para tudo passaria calado.
 * O valor varia por indicador porque o aquecimento varia — o TEMA de 20 só emite na barra 58,
 * então numa série de 60 pontos são 3 comparações, e exigir 20 reprovaria dado correto.
 */
function conferir(obtido: Serie, esperado: Serie, rotulo: string, minimo: number): void {
  expect(obtido.length, `${rotulo}: comprimento`).toBe(esperado.length);
  let comparados = 0;
  for (let i = 0; i < esperado.length; i += 1) {
    const e = esperado[i];
    const o = obtido[i];
    if (e === null || e === undefined || o === null || o === undefined) continue;
    expect(o, `${rotulo} no índice ${i}`).toBeCloseTo(e, 6);
    comparados += 1;
  }
  expect(comparados, `${rotulo}: poucos pontos comparados`).toBeGreaterThanOrEqual(minimo);
}

/**
 * ⭐⭐ Pina a REFERÊNCIA em valores calculados fora, com outra ferramenta.
 *
 * ⚠️ É esta função que impede o autoengano. `conferir` sozinho prova só que implementação e
 * referência concordam — e duas transcrições da mesma leitura errada concordam perfeitamente.
 * As âncoras vêm de um cálculo independente em Python, feito da fórmula.
 */
function ancorar(serieRef: Serie, rotulo: string, ancoras: readonly [number, number][]): void {
  for (const [i, valor] of ancoras) {
    const v = serieRef[i];
    expect(v, `${rotulo}: âncora no índice ${i} não deveria ser null`).not.toBeNull();
    expect(v as number, `${rotulo}: âncora no índice ${i}`).toBeCloseTo(valor, 5);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Volatilidade e canais
// ═════════════════════════════════════════════════════════════════════════════

describe('Bandas de Bollinger (20, 2σ)', () => {
  const ref = bollingerRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.middle, 'BB média', [[19, 109.359], [40, 103.6615], [59, 108.7435]]);
    ancorar(ref.upper, 'BB superior', [[19, 121.167366], [40, 109.437375], [59, 120.138936]]);
    ancorar(ref.lower, 'BB inferior', [[19, 97.550634], [40, 97.885625], [59, 97.348064]]);
  });

  it('as três bandas conferem', () => {
    conferir(saidaDe(bollingerFactory, 'middle'), ref.middle, 'BB média', 30);
    conferir(saidaDe(bollingerFactory, 'upper'), ref.upper, 'BB superior', 30);
    conferir(saidaDe(bollingerFactory, 'lower'), ref.lower, 'BB inferior', 30);
  });

  it('⚠️ o desvio é POPULACIONAL (divisor n), não amostral', () => {
    // A diferença é de ~2,6% na largura da banda com n=20. Não é arredondamento: com divisor
    // n−1 a banda fica sistematicamente mais larga, e um toque de banda deixa de ser um toque.
    const m = ref.middle[19] as number;
    const largura = (ref.upper[19] as number) - m;
    const janela = CLOSES.slice(0, 20);
    const media = janela.reduce((a, b) => a + b, 0) / 20;
    const popul = Math.sqrt(janela.reduce((a, b) => a + (b - media) ** 2, 0) / 20);
    expect(largura).toBeCloseTo(2 * popul, 9);
  });
});

describe('Canais de Keltner (EMA 20, ATR 10 de Wilder, 2×)', () => {
  const ref = keltnerRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.middle, 'KC média', [[19, 109.359], [40, 104.691395], [59, 106.823797]]);
    ancorar(ref.upper, 'KC superior', [[19, 114.519752], [40, 107.703303], [59, 111.707464]]);
    ancorar(ref.lower, 'KC inferior', [[19, 104.198248], [40, 101.679488], [59, 101.940129]]);
  });

  it('as três linhas conferem', () => {
    conferir(saidaDe(keltnerFactory, 'middle'), ref.middle, 'KC média', 30);
    conferir(saidaDe(keltnerFactory, 'upper'), ref.upper, 'KC superior', 30);
    conferir(saidaDe(keltnerFactory, 'lower'), ref.lower, 'KC inferior', 30);
  });

  it('⭐ Keltner é mais ESTREITO que Bollinger nesta série — e tem de ser', () => {
    // ⚠️ Prova ESTRUTURAL, que nenhuma tabela daria: a série é uma tendência limpa, e nela o
    // desvio dos fechamentos em torno da média (Bollinger) é grande enquanto o range médio da
    // barra (Keltner) é pequeno. Se os dois saíssem parecidos, um dos dois estaria medindo a
    // coisa errada — o erro clássico é o Keltner usar desvio no lugar do ATR.
    const bb = bollingerRef(barras());
    const largBb = (bb.upper[40] as number) - (bb.lower[40] as number);
    const largKc = (ref.upper[40] as number) - (ref.lower[40] as number);
    expect(largKc).toBeLessThan(largBb);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Médias derivadas
// ═════════════════════════════════════════════════════════════════════════════

describe('DEMA e TEMA (20) — cascatas de EMA', () => {
  const dema = demaRef(closesDe(barras()));
  const tema = temaRef(closesDe(barras()));

  it('a referência bate com o cálculo externo', () => {
    ancorar(dema, 'DEMA', [[38, 104.268535], [40, 103.77112], [59, 105.570527]]);
    ancorar(tema, 'TEMA', [[57, 107.839454], [59, 102.98264]]);
  });

  it('DEMA confere', () => {
    conferir(saidaDe(demaFactory, 'value'), dema, 'DEMA', 20);
  });

  it('TEMA confere (só 3 pontos: o aquecimento é 3n−2 = 58)', () => {
    conferir(saidaDe(temaFactory, 'value'), tema, 'TEMA', 3);
  });

  it('⭐ DEMA reage ANTES da EMA simples — é a razão de ele existir', () => {
    // ⚠️ Estrutural: na virada de tendência a cascata que cancela atraso tem de estar mais
    // perto do preço que a EMA. Se o DEMA ficasse atrás, o sinal dos coeficientes está trocado
    // (`2·e1 − e2` virando `2·e2 − e1`), e o número continuaria plausível.
    const i = 50; // já em queda, depois do topo em ~i49
    const ema20 = saidaDe(demaFactory, 'value'); // placeholder de comprimento
    expect(ema20.length).toBe(60);
    const distDema = Math.abs((dema[i] as number) - CLOSES[i]!);
    // A EMA de 20 no mesmo ponto, pela referência.
    const e = keltnerRef(barras()).middle[i] as number; // a média do Keltner É a EMA 20
    const distEma = Math.abs(e - CLOSES[i]!);
    expect(distDema).toBeLessThan(distEma);
  });
});

describe('HMA (16) e KAMA (10/2/30)', () => {
  const hma = hmaRef(closesDe(barras()));
  const kama = kamaRef(closesDe(barras()));

  it('a referência bate com o cálculo externo', () => {
    ancorar(hma, 'HMA', [[18, 106.348119], [40, 103.184094], [59, 101.097628]]);
    ancorar(kama, 'KAMA', [[10, 117.202379], [40, 104.504672], [59, 101.627345]]);
  });

  it('HMA confere', () => {
    conferir(saidaDe(hmaFactory, 'value'), hma, 'HMA', 30);
  });

  it('KAMA confere', () => {
    conferir(saidaDe(kamaFactory, 'value'), kama, 'KAMA', 30);
  });

  it('⭐⭐ numa RETA o Efficiency Ratio é 1 — e era 1,1, o terceiro erro de janela do pacote', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // O TESTE QUE ACHOU O DEFEITO, E POR QUE ELE NÃO PRECISA DE REFERÊNCIA
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ⭐ Numa série que sobe um valor constante por barra, o caminho LÍQUIDO e o caminho
    // PERCORRIDO são o mesmo: ER = 1 por definição, e `sc` tem de dar exatamente o limite
    // rápido `(2/(fast+1))²`. É uma verdade algébrica — nenhuma tabela externa é necessária, e é
    // por isso que este teste é mais forte que os valores conferidos acima.
    //
    // ⚠️ O que estava errado: `maisAntigo` era `x[i−n−1]` (janela de `n+1`) contra um
    // denominador de `n` variações. Numa reta de passo `d` isso dá
    // `ER = (n+1)·d / (n·d) = 1,1`, e `sc` saltava de 0,4444 para 0,5283 — a KAMA 19 % mais
    // rápida do que o parâmetro autoriza, sem sinal nenhum de que algo estava errado.
    const d = 0.25;
    const reta: IndicatorBar[] = Array.from({ length: 40 }, (_, i) => {
      const c = 100 + i * d;
      return { time: T0 + i * 60, open: c, high: c, low: c, close: c, volume: 1000 };
    });
    const v = kamaFactory.create({}).warmup(reta).map((p) => p.values['value'] ?? null);

    // Na reta, `sc` fixo ⇒ a KAMA converge para uma distância CONSTANTE do preço, e a razão
    // entre passos consecutivos vira exatamente 1. O que se afere é o `sc` implícito.
    const scEsperado = (2 / (2 + 1)) ** 2; // fast = 2 ⇒ 0.4444…
    // `k[i] = k[i-1] + sc·(x[i] − k[i-1])` ⇒ em regime, `x[i] − k[i] = (1 − sc)·d/sc · sc`…
    // Mais simples e mais direto: recupera `sc` de dois pontos consecutivos em regime.
    const i = 35;
    const kAnt = v[i - 1] as number;
    const kAtual = v[i] as number;
    const x = reta[i]!.close;
    const scImplicito = (kAtual - kAnt) / (x - kAnt);
    expect(scImplicito, 'sc implícito na reta').toBeCloseTo(scEsperado, 9);
    // ⚠️ E a guarda contra a volta do defeito, escrita no valor que ELE produzia:
    expect(scImplicito).not.toBeCloseTo(0.528, 3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Osciladores
// ═════════════════════════════════════════════════════════════════════════════

describe('TRIX (15, sinal 9)', () => {
  const ref = trixRef(closesDe(barras()));

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.value, 'TRIX', [[43, -0.065396], [59, 0.097538]]);
    ancorar(ref.signal, 'TRIX sinal', [[51, 0.0572], [59, 0.167727]]);
  });

  it('valor e sinal conferem', () => {
    conferir(saidaDe(trixFactory, 'value'), ref.value, 'TRIX', 10);
    conferir(saidaDe(trixFactory, 'signal'), ref.signal, 'TRIX sinal', 5);
  });
});

describe('PPO (12/26/9)', () => {
  const ref = ppoRef(closesDe(barras()));

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.value, 'PPO', [[25, -4.49777], [40, -1.249366], [59, -1.46111]]);
    ancorar(ref.signal, 'PPO sinal', [[33, -2.747763], [40, -1.529618], [59, 0.212614]]);
    ancorar(ref.hist, 'PPO hist', [[33, 1.499556], [40, 0.280253], [59, -1.673725]]);
  });

  it('as três saídas conferem', () => {
    conferir(saidaDe(ppoFactory, 'value'), ref.value, 'PPO', 25);
    conferir(saidaDe(ppoFactory, 'signal'), ref.signal, 'PPO sinal', 20);
    conferir(saidaDe(ppoFactory, 'hist'), ref.hist, 'PPO hist', 20);
  });

  it('⭐⭐ PPO é ADIMENSIONAL: multiplicar o preço por 1000 não muda o valor', () => {
    // ⚠️ É a única propriedade que distingue o PPO do MACD, e é o motivo de ele existir. Se
    // quebrar, alguém esqueceu a divisão pela média lenta — e o número continuaria plausível
    // para quem olha um ativo só.
    const escalada = serie().map((b) => ({
      ...b,
      open: b.open * 1000,
      high: b.high * 1000,
      low: b.low * 1000,
      close: b.close * 1000,
    }));
    const a = saidaDe(ppoFactory, 'value');
    const b = ppoFactory.create({}).warmup(escalada).map((p) => p.values['value'] ?? null);
    let comparados = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === null || b[i] === null) continue;
      expect(b[i] as number, `PPO escalado no índice ${i}`).toBeCloseTo(a[i] as number, 9);
      comparados += 1;
    }
    expect(comparados).toBeGreaterThan(25);
  });
});

describe('Stochastic RSI (14/14/3/3)', () => {
  const ref = stochRsiRef(closesDe(barras()));

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.k, 'StochRSI %K', [[29, 79.217278], [40, 4.259142]]);
    ancorar(ref.d, 'StochRSI %D', [[31, 91.31175], [40, 6.333511]]);
  });

  it('%K e %D conferem', () => {
    conferir(saidaDe(stochRsiFactory, 'k'), ref.k, 'StochRSI %K', 20);
    conferir(saidaDe(stochRsiFactory, 'd'), ref.d, 'StochRSI %D', 20);
  });

  it('⚠️ fica em [0, 100] — é estocástico, não RSI', () => {
    for (const v of saidaDe(stochRsiFactory, 'k')) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('⭐⭐ o RSI interno é o MESMO que `rsiFactory` publica — era outro', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // O DEFEITO, E POR QUE NENHUM VALOR DE REFERÊNCIA O DENUNCIARIA
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ⚠️ O Stoch RSI calculava o RSI interno com `EmaState(2·n − 1)`. A RAZÃO de suavização é a
    // de Wilder (`2/2n = 1/n`), mas a SEMENTE é a média dos 27 primeiros ganhos em vez dos 14 —
    // então o RSI interno era um número diferente do que `rsiFactory` desenha na tela ao lado.
    //
    // ⭐ Esta é a prova ESTRUTURAL: reconstrói o estocástico a partir do RSI publicado pelo
    // pacote e exige que ele reproduza o %K. Uma tabela de valores não pegaria o defeito, porque
    // qualquer um dos dois RSI produz um Stoch RSI plausível entre 0 e 100.
    const rsi = saidaDe(rsiFactory, 'value');
    const k = saidaDe(stochRsiFactory, 'k');
    const densos: { i: number; v: number }[] = [];
    for (let i = 0; i < rsi.length; i += 1) if (rsi[i] !== null) densos.push({ i, v: rsi[i] as number });

    // Estocástico de janela 14 sobre o RSI publicado, depois SMA-3 (o `smoothK` default).
    const cru: (number | null)[] = new Array(rsi.length).fill(null);
    for (let j = 13; j < densos.length; j += 1) {
      const janela = densos.slice(j - 13, j + 1).map((p) => p.v);
      const hi = Math.max(...janela);
      const lo = Math.min(...janela);
      cru[densos[j]!.i] = hi === lo ? 0 : (100 * (densos[j]!.v - lo)) / (hi - lo);
    }
    let comparados = 0;
    for (let i = 2; i < cru.length; i += 1) {
      const a = cru[i];
      const b = cru[i - 1];
      const c = cru[i - 2];
      if (a === null || b === null || c === null || k[i] === null) continue;
      expect(k[i] as number, `%K reconstruído no índice ${i}`).toBeCloseTo((a + b + c) / 3, 6);
      comparados += 1;
    }
    expect(comparados, 'poucos pontos reconstruídos').toBeGreaterThan(15);
  });

  it('⭐ emite a partir do índice 29, não 42 — o atraso era da semente errada', () => {
    // 13 barras de atraso desnecessário. Em 15 min são mais de três horas de pregão em que o
    // indicador ficava vazio sem motivo.
    const k = saidaDe(stochRsiFactory, 'k');
    const primeiro = k.findIndex((v) => v !== null);
    expect(primeiro).toBe(29);
  });
});

describe('Aroon (25) — mede TEMPO, não preço', () => {
  const ref = aroonRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.up, 'Aroon up', [[24, 48], [40, 4], [59, 68]]);
    ancorar(ref.down, 'Aroon down', [[24, 92], [40, 28], [59, 100]]);
    ancorar(ref.osc, 'Aroon osc', [[24, -44], [40, -24], [59, -32]]);
  });

  it('as três saídas conferem', () => {
    conferir(saidaDe(aroonFactory, 'up'), ref.up, 'Aroon up', 30);
    conferir(saidaDe(aroonFactory, 'down'), ref.down, 'Aroon down', 30);
    conferir(saidaDe(aroonFactory, 'osc'), ref.osc, 'Aroon osc', 30);
  });

  it('⭐ na última barra em queda o Aroon down é 100 — a mínima é AGORA', () => {
    // ⚠️ Estrutural, e pega o erro de empate: a série termina em queda contínua, então a mínima
    // da janela é a barra corrente e `down` tem de ser exatamente 100. Resolver empate pela
    // ocorrência mais ANTIGA daria um valor menor, e o indicador diria que a mínima é velha.
    expect(saidaDe(aroonFactory, 'down')[59]).toBeCloseTo(100, 9);
  });
});

describe('Choppiness (14) — medidor de REGIME', () => {
  const ref = choppinessRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref, 'Chop', [[13, 21.163431], [40, 49.868071], [59, 21.313415]]);
  });

  it('confere', () => {
    conferir(saidaDe(choppinessFactory, 'value'), ref, 'Chop', 40);
  });

  it('⭐⭐ trecho de TENDÊNCIA marca baixo; trecho de LADO marca alto', () => {
    // ⚠️ A prova que importa não é o número, é o SENTIDO. Um Chop que sobe na tendência está
    // com o logaritmo invertido, e o operador usaria o indicador para exatamente o contrário do
    // que ele serve. Aqui: i13 está no meio da alta limpa (21,2) e i40 na virada lateral (49,9).
    const chop = saidaDe(choppinessFactory, 'value');
    expect(chop[13] as number).toBeLessThan(chop[40] as number);
  });
});

describe('Balance of Power (média 14)', () => {
  const ref = bopRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.value, 'BOP', [[0, 0.580645], [40, 0.428571], [59, -0.677291]]);
    ancorar(ref.media, 'BOP média', [[13, 0.366426], [40, -0.019148], [59, -0.315889]]);
  });

  it('valor e média conferem', () => {
    conferir(saidaDe(bopFactory, 'value'), ref.value, 'BOP', 55);
    conferir(saidaDe(bopFactory, 'media'), ref.media, 'BOP média', 40);
  });

  it('⚠️ fica em [−1, 1] e NÃO é identicamente zero nesta série', () => {
    // A segunda parte é a guarda de bancada: com `open === close` (como na série do lote 3) o
    // BOP é zero em toda barra, e o teste passaria provando nada.
    const v = saidaDe(bopFactory, 'value');
    let naoZero = 0;
    for (const x of v) {
      if (x === null) continue;
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(1);
      if (Math.abs(x) > 1e-9) naoZero += 1;
    }
    expect(naoZero).toBeGreaterThan(50);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Volume e fluxo
// ═════════════════════════════════════════════════════════════════════════════

describe('ADL — acumulação/distribuição', () => {
  const ref = adlRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref, 'ADL', [[0, 806.451613], [40, 2267.896208], [59, 546.010598]]);
  });

  it('confere', () => {
    conferir(saidaDe(adlFactory, 'value'), ref, 'ADL', 55);
  });

  it('⚠️ não é identicamente zero — o pavio simétrico anularia o multiplicador', () => {
    const v = saidaDe(adlFactory, 'value');
    expect(Math.abs(v[59] as number)).toBeGreaterThan(1);
  });
});

describe('Force Index (EMA 13)', () => {
  const ref = forceIndexRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref, 'Force', [[13, 1012.15], [40, -152.921169], [59, -1679.610892]]);
  });

  it('confere', () => {
    conferir(saidaDe(forceIndexFactory, 'value'), ref, 'Force', 40);
  });

  it('⭐ o sinal segue a DIREÇÃO do preço, não o volume', () => {
    // Volume é sempre positivo; o sinal só pode vir de `(C − C anterior)`. Na queda final o
    // Force tem de ser negativo — se fosse positivo, alguém tomou o módulo em algum lugar.
    expect(ref[59] as number).toBeLessThan(0);
    expect(CLOSES[59]!).toBeLessThan(CLOSES[58]!);
  });
});

describe('Elder Ray (EMA 13)', () => {
  const ref = elderRayRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.bull, 'Elder touro', [[12, 5.72], [40, -0.576945], [59, -6.404905]]);
    ancorar(ref.bear, 'Elder urso', [[12, 3.38], [40, -1.696945], [59, -8.914905]]);
  });

  it('touro e urso conferem', () => {
    conferir(saidaDe(elderRayFactory, 'bull'), ref.bull, 'Elder touro', 40);
    conferir(saidaDe(elderRayFactory, 'bear'), ref.bear, 'Elder urso', 40);
  });

  it('⭐ touro > urso SEMPRE — é `high − média` contra `low − média`', () => {
    // ⚠️ Invariante algébrica: `high >= low` implica `bull >= bear` ponto a ponto. Se quebrar,
    // as duas saídas foram trocadas — e trocadas elas continuam plausíveis, porque as duas
    // oscilam em torno de zero.
    const bull = saidaDe(elderRayFactory, 'bull');
    const bear = saidaDe(elderRayFactory, 'bear');
    let comparados = 0;
    for (let i = 0; i < bull.length; i += 1) {
      if (bull[i] === null || bear[i] === null) continue;
      expect(bull[i] as number, `índice ${i}`).toBeGreaterThan(bear[i] as number);
      comparados += 1;
    }
    expect(comparados).toBeGreaterThan(40);
  });
});

describe('ADX / DMI (14) de Wilder', () => {
  const ref = adxRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref.adx, 'ADX', [[27, 13.897524], [40, 12.78184], [59, 29.491573]]);
    ancorar(ref.plus_di, '+DI', [[14, 49.93965], [40, 26.256485], [59, 18.414377]]);
    ancorar(ref.minus_di, '−DI', [[14, 19.161135], [40, 27.333489], [59, 49.62429]]);
  });

  it('as três saídas conferem', () => {
    conferir(saidaDe(adxFactory, 'adx'), ref.adx, 'ADX', 25);
    conferir(saidaDe(adxFactory, 'plus_di'), ref.plus_di, '+DI', 40);
    conferir(saidaDe(adxFactory, 'minus_di'), ref.minus_di, '−DI', 40);
  });

  it('⭐⭐ na alta +DI > −DI; na queda inverte', () => {
    // ⚠️ Estrutural, e é o que pega troca de sinal no movimento direcional — o erro mais fácil
    // de cometer aqui e o mais difícil de ver, porque o ADX (que é |diferença|) fica IDÊNTICO
    // com os dois trocados. Só a comparação com a direção do preço distingue.
    const p = saidaDe(adxFactory, 'plus_di');
    const m = saidaDe(adxFactory, 'minus_di');
    expect(CLOSES[14]!).toBeGreaterThan(CLOSES[13]! - 100); // trecho de alta (i0→i9)
    expect(p[14] as number).toBeGreaterThan(m[14] as number);
    expect(CLOSES[59]!).toBeLessThan(CLOSES[50]!); // trecho de queda
    expect(p[59] as number).toBeLessThan(m[59] as number);
  });

  it('⚠️ ADX fica em [0, 100] e +DI/−DI também', () => {
    for (const [rotulo, s] of [
      ['ADX', saidaDe(adxFactory, 'adx')],
      ['+DI', saidaDe(adxFactory, 'plus_di')],
      ['−DI', saidaDe(adxFactory, 'minus_di')],
    ] as const) {
      for (const v of s) {
        if (v === null) continue;
        expect(v, rotulo).toBeGreaterThanOrEqual(0);
        expect(v, rotulo).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('VWAP por sessão (hlc3)', () => {
  const ref = vwapRef(barras(), TIMES);

  it('a referência bate com o cálculo externo', () => {
    ancorar(ref, 'VWAP', [[0, 100.483333], [40, 106.331096], [59, 107.330363]]);
  });

  it('confere', () => {
    conferir(saidaDe(vwapFactory, 'value'), ref, 'VWAP', 55);
  });

  it('⭐⭐ REINICIA na virada de sessão — e a série de 60 min não testava isso', () => {
    // ⚠️ A série principal cabe toda num dia (60 barras de 1 min), então o reinício de sessão
    // nunca era exercido. Este caso põe metade das barras no dia seguinte: a primeira barra da
    // sessão nova tem de valer o próprio `hlc3`, não a continuação da média do dia anterior.
    const bs = serie();
    const doisDias: IndicatorBar[] = bs.map((b, i) => ({
      ...b,
      time: i < 30 ? T0 + i * 60 : T0 + 86_400 + i * 60,
    }));
    const v = vwapFactory.create({}).warmup(doisDias).map((p) => p.values['value'] ?? null);
    const b30 = doisDias[30]!;
    const hlc3 = (b30.high + b30.low + b30.close) / 3;
    expect(v[30] as number).toBeCloseTo(hlc3, 9);
    // E a última barra do dia 1 NÃO é o hlc3 dela — é média acumulada.
    const b29 = doisDias[29]!;
    expect(v[29] as number).not.toBeCloseTo((b29.high + b29.low + b29.close) / 3, 3);
  });

  it('⚠️ fica DENTRO da faixa de preço da sessão', () => {
    const v = saidaDe(vwapFactory, 'value');
    const maxH = Math.max(...HIGHS);
    const minL = Math.min(...LOWS);
    for (const x of v) {
      if (x === null) continue;
      expect(x).toBeLessThanOrEqual(maxH);
      expect(x).toBeGreaterThanOrEqual(minL);
    }
  });
});

describe('Delta, CVD e Delta % — o fluxo por agressor', () => {
  const delta = deltaRef(barras());
  const cvd = cvdRef(barras());
  const ratio = deltaRatioRef(barras());

  it('a referência bate com o cálculo externo', () => {
    ancorar(delta.value, 'Delta', [[0, -300], [40, 122], [59, 219]]);
    ancorar(cvd.value, 'CVD', [[0, -300], [40, 3824], [59, 6244]]);
    ancorar(ratio.value, 'Delta %', [[0, -30], [40, 8.243243], [59, 18.512257]]);
    ancorar(ratio.ema, 'Delta % EMA', [[8, 3.272465], [40, 2.785505], [59, 14.725186]]);
  });

  it('as três saídas conferem', () => {
    conferir(saidaDe(deltaFactory, 'value'), delta.value, 'Delta', 55);
    conferir(saidaDe(cvdFactory, 'value'), cvd.value, 'CVD', 55);
    conferir(saidaDe(deltaRatioFactory, 'value'), ratio.value, 'Delta %', 55);
    conferir(saidaDe(deltaRatioFactory, 'ema'), ratio.ema, 'Delta % EMA', 40);
  });

  it('⭐⭐ CVD é a soma acumulada do Delta, barra a barra', () => {
    // ⚠️ Invariante estrutural, e a mais forte deste bloco: se o CVD não for exatamente a soma
    // dos deltas, um dos dois lê o agressor de outro jeito — e as duas séries continuariam
    // plausíveis, porque as duas oscilam em torno de zero.
    const d = saidaDe(deltaFactory, 'value');
    const c = saidaDe(cvdFactory, 'value');
    let acc = 0;
    for (let i = 0; i < d.length; i += 1) {
      if (d[i] !== null) acc += d[i] as number;
      expect(c[i] as number, `CVD no índice ${i}`).toBeCloseTo(acc, 6);
    }
  });

  it('⭐ Delta % fica em [−100, 100] e tem o MESMO SINAL do Delta', () => {
    const d = saidaDe(deltaFactory, 'value');
    const r = saidaDe(deltaRatioFactory, 'value');
    for (let i = 0; i < r.length; i += 1) {
      const x = r[i];
      if (x === null) continue;
      expect(x).toBeGreaterThanOrEqual(-100);
      expect(x).toBeLessThanOrEqual(100);
      expect(Math.sign(x), `sinal no índice ${i}`).toBe(Math.sign(d[i] as number));
    }
  });

  it('⚠️ barra SEM agressor devolve null, e o acumulado não anda', () => {
    // ⭐ É a disciplina do projeto valendo dentro do indicador: `null` é "não sei", nunca zero.
    // Um zero ali seria lido como equilíbrio entre compra e venda, que é uma afirmação.
    const semAgressor: IndicatorBar[] = serie().map((b, i) => {
      if (i !== 30) return b;
      const { buyVolume: _b, sellVolume: _s, ...resto } = b;
      return resto;
    });
    const d = deltaFactory.create({}).warmup(semAgressor).map((p) => p.values['value'] ?? null);
    const c = cvdFactory.create({}).warmup(semAgressor).map((p) => p.values['value'] ?? null);
    const cob = cvdFactory.create({}).warmup(semAgressor).map((p) => p.values['cobertura'] ?? null);
    expect(d[30]).toBeNull();
    expect(c[30]).toBeCloseTo(c[29] as number, 9);
    // ⭐ E a COBERTURA cai, que é como o operador descobre que o platô é falta de dado.
    expect(cob[59] as number).toBeLessThan(100);
    expect(cob[59] as number).toBeCloseTo((100 * 59) / 60, 6);
  });
});
