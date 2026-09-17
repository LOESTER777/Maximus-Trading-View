/**
 * Valores conhecidos, LOTE 3 — os indicadores nos PARÂMETROS DE DEFAULT.
 *
 * ⭐⭐ **Por que os defaults, e não períodos curtos:** o default é o que 99 % dos operadores vão
 * usar, porque é o que a interface oferece pronto. Um erro que só aparece no default é o erro
 * que mais gente veria — e é o menos provável de ser pego, porque testes tendem a usar períodos
 * pequenos para caber numa série curta de exemplo.
 *
 * A série tem **60 pontos** de propósito: `lsma` tem default 25, `vwma` 20, `stochastic` 14.
 * Com 16 pontos (a série clássica dos outros arquivos) metade deles nem sairia do aquecimento.
 *
 * ── REFERÊNCIAS INDEPENDENTES ─────────────────────────────────────────────
 *
 * Calculadas em Python, pela definição de cada indicador, **sem consultar a implementação**.
 * A série é determinística (soma de dois harmônicos, sem sorteio) para ser reproduzível.
 *
 * ⚠️ E há uma correção de método registrada aqui: a primeira tentativa deste lote passou
 * `{ period: 5 }` para o `stochastic`, que na verdade usa `periodK`/`periodD`. O parâmetro foi
 * ignorado, o indicador rodou no default 14, e o teste acusou "defeito" onde não havia. A
 * lição: **antes de acusar a implementação, confira o contrato dela**. Usar os defaults elimina
 * essa classe de erro por construção.
 */
import { describe, expect, it } from 'vitest';
import { rocFactory, momentumFactory, stochasticFactory, williamsRFactory } from '../index.js';
// ⚠️ VWMA e LSMA vêm do MÓDULO, não do índice: pelo índice eles chegam `undefined` em runtime
// (ciclo de importação). Testar o módulo direto prova a implementação, que é o objetivo aqui —
// o defeito de empacotamento do índice é outro problema, e está registrado à parte.
import { vwmaFactory, lsmaFactory } from '../built-in/adaptive-averages.js';
import type { IndicatorBar } from '../contracts.js';

/** A série: 60 fechamentos determinísticos, amplitude de 0,50 e volume variável. */
const CLOSES = [
  100.9, 102.72, 104.93, 106.77, 107.56, 107.05, 105.49, 103.51, 101.85, 101.03, 101.12, 101.73,
  102.26, 102.17, 101.3, 99.92, 98.67, 98.22, 98.96, 100.79, 103.18, 105.32, 106.55, 106.57, 105.6,
  104.23, 103.14, 102.77, 103.13, 103.81, 104.17, 103.72, 102.33, 100.36, 98.51, 97.49, 97.74,
  99.19, 101.32, 103.36, 104.65, 104.92, 104.38, 103.58, 103.14, 103.43, 104.38, 105.5, 106.12,
  105.72, 104.19, 101.93, 99.67, 98.14, 97.83, 98.71, 100.28, 101.83, 102.77, 102.87,
] as const;

function serie(): IndicatorBar[] {
  return CLOSES.map((c, i) => ({
    time: 1_600_000_000 + i * 60,
    open: c,
    high: Math.round((c + 0.5) * 100) / 100,
    low: Math.round((c - 0.5) * 100) / 100,
    close: c,
    volume: 1000 + ((i * 37) % 500),
  }));
}

function serieDe(
  pontos: readonly { values: Readonly<Record<string, number | null>> }[],
  key: string,
): (number | null)[] {
  return pontos.map((p) => p.values[key] ?? null);
}

/**
 * Compara a partir do primeiro ponto NÃO NULO da referência.
 *
 * ⚠️ Deliberadamente tolerante quanto ao COMPRIMENTO do aquecimento, e rigorosa quanto ao
 * VALOR. Há duas convenções legítimas para "quantas barras o indicador precisa" (janela de `n`
 * versus defasagem de `n`), e discutir isso não é o objetivo aqui — o objetivo é provar que,
 * quando o indicador responde, ele responde o número CERTO. Um erro de aquecimento desloca uma
 * barra; um erro de valor mente sobre o mercado.
 */
function conferirValores(
  obtido: readonly (number | null)[],
  esperado: readonly (number | null)[],
  rotulo: string,
): void {
  expect(obtido.length).toBe(esperado.length);
  let comparados = 0;
  for (let i = 0; i < esperado.length; i += 1) {
    const e = esperado[i];
    const o = obtido[i];
    if (e === null || o === null) continue;
    expect(o, `${rotulo} no índice ${i}`).toBeCloseTo(e, 4);
    comparados += 1;
  }
  // ⚠️ PISO: sem isto, um indicador que devolvesse `null` para tudo passaria calado — o laço
  // não compararia nada e o teste ficaria verde provando exatamente nada.
  expect(comparados, `${rotulo}: poucos pontos comparados`).toBeGreaterThan(20);
}

const _ = null;

describe('ROC e Momentum nos defaults — as duas escalas não se confundem', () => {
  it('ROC (default 9): variação PERCENTUAL', () => {
    const esperado = [_, _, _, _, _, _, _, _, _, 0.12884, -1.557632, -3.049652, -4.224033, -5.011157, -5.371322, -5.280121, -4.675877, -3.564065, -2.048896, -0.326345, 1.425342, 2.992372, 4.286973, 5.202369, 5.684548, 5.634945, 5.009163, 3.85004, 2.321659, 0.610583, -1.09191, -2.65603, -3.978606, -4.962121, -5.487863, -5.477991, -4.894424, -3.820421, -2.398613, -0.777575, 0.896645, 2.531027, 4.00558, 5.146686, 5.795466, 5.821567, 5.232382, 4.125543, 2.670279, 1.022456, -0.695768, -2.347193, -3.77486, -4.84778, -5.41429, -5.432075, -4.947867, -4.042593, -2.79039, -1.266916];
    conferirValores(serieDe(rocFactory.create({}).warmup(serie()), 'value'), esperado, 'ROC');
  });

  it('Momentum (default 10): DIFERENÇA absoluta em pontos', () => {
    const esperado = [_, _, _, _, _, _, _, _, _, _, 0.22, -0.99, -2.67, -4.6, -6.26, -7.13, -6.82, -5.29, -2.89, -0.24, 2.06, 3.59, 4.29, 4.4, 4.3, 4.31, 4.47, 4.55, 4.17, 3.02, 0.99, -1.6, -4.22, -6.21, -7.09, -6.74, -5.4, -3.58, -1.81, -0.45, 0.48, 1.2, 2.05, 3.22, 4.63, 5.94, 6.64, 6.31, 4.8, 2.36, -0.46, -2.99, -4.71, -5.44, -5.31, -4.72, -4.1, -3.67, -3.35, -2.85];
    conferirValores(serieDe(momentumFactory.create({}).warmup(serie()), 'value'), esperado, 'Momentum');
  });
});

describe('Stochastic e Williams %R nos defaults', () => {
  it('Stochastic %K (default 14) e %D (SMA-3 do %K)', () => {
    const k = [_, _, _, _, _, _, _, _, _, _, _, _, _, 23.10705, 10.225764, 5.787037, 5.055612, 4.83559, 12.614446, 37.122128, 86.804452, 93.82716, 94.640943, 94.652406, 84.278075, 69.625668, 57.967914, 54.010695, 57.860963, 65.13369, 68.983957, 61.091754, 30.088496, 6.934813, 5.518764, 4.960317, 7.440476, 24.149286, 55.943152, 82.942708, 93.872549, 94.068802, 87.663108, 78.173191, 72.953737, 76.393832, 87.663108, 94.45061, 94.807892, 90.405117, 69.356873, 19.137931, 6.711409, 5.567929, 5.382131, 14.854682, 31.754575, 48.439182, 58.557589, 59.634015];
    const d = [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 13.03995, 7.022804, 5.22608, 7.501882, 18.190721, 45.513675, 72.58458, 91.757518, 94.373503, 91.190475, 82.85205, 70.623886, 60.534759, 56.613191, 59.001783, 63.99287, 65.0698, 53.388069, 32.705021, 14.180691, 5.804631, 5.973186, 12.18336, 29.177638, 54.345049, 77.586137, 90.294686, 91.868153, 86.635034, 79.596679, 75.840253, 79.003559, 86.169183, 92.307203, 93.221207, 84.856627, 59.633307, 31.735404, 10.472423, 5.887156, 8.601581, 17.330463, 31.682813, 46.250449, 55.543595];
    const p = stochasticFactory.create({}).warmup(serie());
    conferirValores(serieDe(p, 'k'), k, 'Stoch %K');
    conferirValores(serieDe(p, 'd'), d, 'Stoch %D');
  });

  it('Williams %R (default 14)', () => {
    const esperado = [_, _, _, _, _, _, _, _, _, _, _, _, _, -76.89295, -89.774236, -94.212963, -94.944388, -95.16441, -87.385554, -62.877872, -13.195548, -6.17284, -5.359057, -5.347594, -15.721925, -30.374332, -42.032086, -45.989305, -42.139037, -34.86631, -31.016043, -38.908246, -69.911504, -93.065187, -94.481236, -95.039683, -92.559524, -75.850714, -44.056848, -17.057292, -6.127451, -5.931198, -12.336892, -21.826809, -27.046263, -23.606168, -12.336892, -5.54939, -5.192108, -9.594883, -30.643127, -80.862069, -93.288591, -94.432071, -94.617869, -85.145318, -68.245425, -51.560818, -41.442411, -40.365985];
    conferirValores(serieDe(williamsRFactory.create({}).warmup(serie()), 'value'), esperado, '%R');
  });

  it('⭐⭐ A IDENTIDADE %R = %K − 100 vale ponto a ponto (mesmo default nos dois)', () => {
    // ⚠️ Prova ESTRUTURAL, e a mais forte deste arquivo: a identidade é álgebra, não convenção.
    //   %R = −100·(H−C)/(H−L) = −100 + 100·(C−L)/(H−L) = %K − 100
    // Se ela quebra, um dos dois usa janela diferente do que declara — e nenhuma tabela de
    // referência pegaria isso se os dois estivessem errados do mesmo jeito.
    const r = serieDe(williamsRFactory.create({}).warmup(serie()), 'value');
    const k = serieDe(stochasticFactory.create({}).warmup(serie()), 'k');
    let comparados = 0;
    for (let i = 0; i < r.length; i += 1) {
      if (r[i] === null || k[i] === null) continue;
      expect((r[i] as number) - ((k[i] as number) - 100), `índice ${i}`).toBeCloseTo(0, 6);
      comparados += 1;
    }
    expect(comparados).toBeGreaterThan(30);
  });
});

describe('médias com janela longa, nos defaults', () => {
  it('VWMA (default 20): ponderada por volume', () => {
    const esperado = [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 102.348273, 102.45044, 102.588543, 102.697255, 102.725557, 102.663717, 102.547275, 102.441112, 102.408252, 102.46552, 102.597497, 102.747265, 102.849513, 102.859094, 102.775828, 102.618946, 102.466368, 102.38075, 102.393742, 102.491204, 102.618971, 102.707588, 102.66551, 102.536463, 102.366008, 102.221553, 102.162845, 102.21329, 102.346805, 102.510268, 102.62429, 102.640228, 102.552025, 102.401097, 102.255777, 102.181823, 102.278534, 102.432131, 102.58206, 102.662005, 102.631102];
    conferirValores(serieDe(vwmaFactory.create({}).warmup(serie()), 'value'), esperado, 'VWMA');
  });

  it('LSMA (default 25): regressão linear avaliada no último ponto', () => {
    const esperado = [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 102.432892, 102.458, 102.433631, 102.5264, 102.840585, 103.354092, 103.915692, 104.311231, 104.355138, 103.980123, 103.274338, 102.445231, 101.736123, 101.324862, 101.255877, 101.432708, 101.674615, 101.813569, 101.777415, 101.622985, 101.505969, 101.602185, 102.010523, 102.6948, 103.483846, 104.139138, 104.453046, 104.339385, 103.866554, 103.220462, 102.628092, 102.2524, 102.127815, 102.157477, 102.175877, 102.039108];
    conferirValores(serieDe(lsmaFactory.create({}).warmup(serie()), 'value'), esperado, 'LSMA');
  });
});
