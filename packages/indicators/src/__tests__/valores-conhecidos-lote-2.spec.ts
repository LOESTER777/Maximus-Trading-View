/**
 * Valores conhecidos, LOTE 2 — as médias, a dispersão, os osciladores e o volume.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A suíte já provava duas coisas sobre os 45 indicadores: `incremental == batch` e
 * `preview` não muta estado. **Nenhuma das duas prova que o VALOR está certo.**
 *
 * ⚠️ Um `sma` que dividisse por `period − 1` passaria as duas: seria consistente consigo
 * mesmo e não mutaria nada. Só um valor de REFERÊNCIA pega isso — e antes deste arquivo
 * apenas **13 dos 45** tinham referência conferida.
 *
 * ── COMO AS REFERÊNCIAS FORAM OBTIDAS, e por que o método importa ─────────
 *
 * ⭐⭐ Calculadas em Python, pela definição clássica de cada indicador, **sem olhar a
 * implementação TypeScript**. A independência é o ponto: uma referência derivada do próprio
 * código sob teste não prova nada — ela cimenta o que já existe, inclusive o erro.
 *
 * ⚠️ E isso não é hipotético neste projeto. O offset de fuso da bridge MT5 foi implementado
 * com o SINAL INVERTIDO, e o teste que o cobria passava — porque eu escrevi o teste a partir da
 * mesma medição errada que gerou o código. Ver `OFFSET_CANDLES_MT5_SEGUNDOS`.
 *
 * A série de fechamentos é a mesma dos outros arquivos de valor conhecido (16 pontos, a série
 * clássica de exemplo de Wilder), com `high = close + 0,30`, `low = close − 0,30` e volume
 * crescente de 1.000 em passos de 100 — para o que depende de amplitude e de volume ter dado
 * determinístico e conferível à mão.
 */
import { describe, expect, it } from 'vitest';
import {
  smaFactory,
  wmaFactory,
  rmaFactory,
  stddevFactory,
  rocFactory,
  momentumFactory,
  cciFactory,
  obvFactory,
} from '../index.js';
// ⚠️ Do MÓDULO e não do índice: pelo índice estes dois chegam `undefined` em runtime (ciclo de
// importação). Ver o registro do achado no commit — testar o módulo prova a implementação.
import { vwmaFactory, lsmaFactory } from '../built-in/adaptive-averages.js';
import type { IndicatorBar } from '../contracts.js';

const TOL = 1e-4;

const CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
  46.28, 46.0,
] as const;

/** Barra completa: amplitude simétrica de 0,30 e volume crescente. */
function serie(): IndicatorBar[] {
  return CLOSES.map((c, i) => ({
    time: 1_600_000_000 + i * 60,
    open: c,
    high: c + 0.3,
    low: c - 0.3,
    close: c,
    volume: 1000 + 100 * i,
  }));
}

function serieDe(
  pontos: readonly { values: Readonly<Record<string, number | null>> }[],
  key: string,
): (number | null)[] {
  return pontos.map((p) => p.values[key] ?? null);
}

/** Compara respeitando os `null` de aquecimento, que são parte do contrato. */
function conferir(obtido: readonly (number | null)[], esperado: readonly (number | null)[]): void {
  expect(obtido.length).toBe(esperado.length);
  for (let i = 0; i < esperado.length; i += 1) {
    const e = esperado[i];
    const o = obtido[i];
    if (e === null) {
      expect(o, `índice ${i} deveria ser null (aquecimento)`).toBeNull();
      continue;
    }
    expect(o, `índice ${i} não deveria ser null`).not.toBeNull();
    expect(o as number, `índice ${i}`).toBeCloseTo(e, 4);
  }
}

const _ = null;

describe('médias — a definição de cada uma é distinta e isso importa', () => {
  it('SMA-5: média aritmética simples da janela', () => {
    const esperado = [_, _, _, _, 44.104, 44.202, 44.404, 44.658, 45.104, 45.454, 45.666, 45.852, 45.89, 45.978, 46.018, 46.04];
    const p = smaFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  it('WMA-5: pesos 1..5, o mais recente com peso maior', () => {
    const esperado = [_, _, _, _, 44.070667, 44.312667, 44.612, 44.950667, 45.344667, 45.67, 45.815333, 45.936667, 45.856, 45.986, 46.086667, 46.080667];
    const p = wmaFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  it('⭐ RMA-5 (Wilder) é DISTINTA da EMA — e a diferença é o que faz o RSI bater', () => {
    // RMA usa `(prev*(p-1) + x)/p`; a EMA usa `2/(p+1)`. Confundi-las desloca RSI, ATR e ADX.
    const esperado = [_, _, _, _, 44.104, 44.2492, 44.41936, 44.619488, 44.86359, 45.106872, 45.263498, 45.416798, 45.455439, 45.620351, 45.752281, 45.801825];
    const p = rmaFactory.create({ period: 5, source: 'close' }).warmup(serie());
    const obtido = serieDe(p, 'value');
    conferir(obtido, esperado);
    // E a prova de que NÃO é EMA: no mesmo ponto a EMA vale 44.346.
    expect(obtido[5] as number).not.toBeCloseTo(44.346, 3);
  });

  it('⭐ LSMA-5: regressão linear, projetada no ÚLTIMO ponto da janela', () => {
    // ⚠️ O valor é a reta avaliada em `x = p-1`, não a média nem o intercepto. Avaliar no
    // ponto errado desloca a linha inteira e ela deixa de tocar o preço.
    const esperado = [_, _, _, _, 44.004, 44.534, 45.028, 45.536, 45.826, 46.102, 46.114, 46.106, 45.788, 46.002, 46.224, 46.162];
    const p = lsmaFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  it('⭐ VWMA-5: ponderada por VOLUME, e difere da SMA quando o volume varia', () => {
    const esperado = [_, _, _, _, 44.095667, 44.227538, 44.448571, 44.716533, 45.149125, 45.492118, 45.690889, 45.865368, 45.8849, 45.979143, 46.027364, 46.045304];
    const p = vwmaFactory.create({ period: 5 }).warmup(serie());
    const obtido = serieDe(p, 'value');
    conferir(obtido, esperado);
    // Difere da SMA no mesmo ponto (44.104): se batesse, o volume estaria sendo ignorado.
    expect(obtido[4] as number).not.toBeCloseTo(44.104, 4);
  });
});

describe('dispersão', () => {
  it('⭐ StdDev-5: desvio POPULACIONAL (divide por n, não por n−1)', () => {
    // ⚠️ A escolha importa: com `n−1` as bandas de Bollinger ficam ~12% mais largas em
    // período 5, e o toque de banda — que é o sinal — acontece em outro preço.
    const esperado = [_, _, _, _, 0.265752, 0.394076, 0.522747, 0.634268, 0.512976, 0.459722, 0.35573, 0.233187, 0.165288, 0.222477, 0.253093, 0.245683];
    const p = stddevFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });
});

describe('osciladores de momento', () => {
  it('ROC-5: variação percentual contra 5 barras atrás', () => {
    const esperado = [_, _, _, _, _, 1.105097, 2.290769, 2.876557, 5.113506, 3.947665, 2.364488, 2.062084, 0.418318, 0.95986, 0.434028, 0.239704];
    const p = rocFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  it('⚠️ Momentum-5 é DIFERENÇA absoluta, não percentual (o ROC é o percentual)', () => {
    const esperado = [_, _, _, _, _, 0.49, 1.01, 1.27, 2.23, 1.75, 1.06, 0.93, 0.19, 0.44, 0.2, 0.11];
    const p = momentumFactory.create({ period: 5, source: 'close' }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  // ⚠️ Stochastic e Williams %R saíram DESTE arquivo e estão no lote 3, nos defaults.
  //
  // A primeira versão os testava aqui com `{ period: 5 }` — e o Stochastic usa `periodK`. O
  // parâmetro era ignorado, o indicador rodava no default 14, e o teste "encontrou" um defeito
  // que não existia. A lição ficou registrada no cabeçalho do lote 3: confira o contrato do
  // parâmetro ANTES de acusar a implementação.
  it('CCI-5: preço típico contra desvio médio, com a constante 0,015', () => {
    const esperado = [_, _, _, _, 74.146982, 138.447972, 103.386809, 92.296512, 116.603295, 103.096179, 45.977011, 66.816817, -141.414141, 110.380117, 81.467662, -13.888889];
    const p = cciFactory.create({ period: 5 }).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });
});

describe('volume', () => {
  it('⭐ OBV: acumula com o SINAL da variação do fechamento, e começa em zero', () => {
    // ⚠️ Barra sem variação não soma nem subtrai — tratá-la como alta inflaria a série.
    const esperado = [0, -1100, 100, -1200, 200, 1700, 3300, 5000, 6800, 8700, 6700, 8800, 6600, 8900, 8900, 6400];
    const p = obvFactory.create({}).warmup(serie());
    conferir(serieDe(p, 'value'), esperado);
  });

  it('⚠️ OBV sem volume na barra não inventa zero', () => {
    const semVolume = CLOSES.map((c, i) => ({
      time: 1_600_000_000 + i * 60, open: c, high: c, low: c, close: c,
    }));
    const p = obvFactory.create({}).warmup(semVolume);
    const v = serieDe(p, 'value');
    // Ou tudo null (não sabe), ou constante zero — o que não pode é variar como se houvesse
    // volume. A asserção pega a terceira possibilidade, que seria fabricar dado.
    const distintos = new Set(v.filter((x) => x !== null));
    expect(distintos.size).toBeLessThanOrEqual(1);
  });
});
