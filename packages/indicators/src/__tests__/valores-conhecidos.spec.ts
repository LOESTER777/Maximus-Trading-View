/**
 * valores-conhecidos — ancora numerica contra referencias externas.
 *
 * A propriedade incremental==batch prova que o indicador e CONSISTENTE consigo
 * mesmo, mas nao que a formula esta certa: um SMA implementado como "sempre
 * devolve 0" seria consistente e errado. Este arquivo amarra os valores a
 * referencias calculadas fora do codigo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FONTES DAS REFERENCIAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - EMA-5: calculado a mao pela recorrencia classica (semente = SMA das 5
 *   primeiras), sobre a serie de fechamentos de 16 barras que a Investopedia usa
 *   no verbete de medias moveis.
 * - RSI-14: a serie canonica de 20 fechamentos de Wilder ("New Concepts in
 *   Technical Trading Systems", reproduzida pela Investopedia). Os primeiros
 *   valores esperados (~70.46, 66.25, 66.48, 69.35, 66.29, 57.92) sao os
 *   publicados nessa referencia.
 * - ATR-3: True Range e suavizacao de Wilder calculados a mao sobre 6 barras HLC.
 * - MACD(3,6,3): calculado a mao pela definicao (EMA rapida - EMA lenta;
 *   sinal = EMA do macd; histograma = macd - sinal) sobre 14 fechamentos.
 *
 * Conteudo reescrito/derivado por conta propria; os numeros foram recomputados
 * localmente pela definicao e conferidos contra os valores publicados.
 */
import { describe, it, expect } from 'vitest';

import { emaFactory, rsiFactory, atrFactory, macdFactory } from '../index.js';
import type { IndicatorBar } from '../contracts.js';

const TOL = 1e-4;

/** Barra so-fechamento: high=low=close. Serve para indicadores de preco-fonte. */
function barClose(i: number, close: number): IndicatorBar {
  return { time: 1_600_000_000 + i * 60, open: close, high: close, low: close, close };
}

function serieClose(closes: readonly number[]): IndicatorBar[] {
  return closes.map((c, i) => barClose(i, c));
}

/** Extrai a serie de um campo, mantendo nulls. */
function serieDe(pontos: readonly { values: Readonly<Record<string, number | null>> }[], key: string) {
  return pontos.map((p) => p.values[key] ?? null);
}

describe('valores conhecidos', () => {
  it('EMA-5 bate com a recorrencia classica (semente = SMA das 5 primeiras)', () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0,
    ];
    const esperado = [
      null, null, null, null, 44.104, 44.346, 44.597333, 44.871556, 45.19437, 45.48958, 45.623053,
      45.758702, 45.709135, 45.899423, 46.026282, 46.017521,
    ];
    const pontos = emaFactory.create({ period: 5, source: 'close' }).warmup(serieClose(closes));
    const obtido = serieDe(pontos, 'value');
    expect(obtido.length).toBe(esperado.length);
    for (let i = 0; i < esperado.length; i++) {
      if (esperado[i] === null) expect(obtido[i]).toBeNull();
      else expect(obtido[i]).toBeCloseTo(esperado[i] as number, 4);
    }
  });

  it('RSI-14 bate com a serie canonica de Wilder', () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];
    // Barra 0-based; primeiro RSI na barra 14 (precisa de 14 variacoes = 15 barras).
    const esperadoPorBarra: Record<number, number> = {
      14: 70.4641,
      15: 66.2496,
      16: 66.4809,
      17: 69.3469,
      18: 66.2947,
      19: 57.915,
    };
    const pontos = rsiFactory.create({ period: 14, source: 'close' }).warmup(serieClose(closes));
    const rsi = serieDe(pontos, 'value');
    // Antes da barra 14, tudo null (aquecendo).
    for (let i = 0; i < 14; i++) expect(rsi[i]).toBeNull();
    for (const [barra, val] of Object.entries(esperadoPorBarra)) {
      const i = Number(barra);
      expect(rsi[i]).not.toBeNull();
      expect(rsi[i] as number).toBeCloseTo(val, 3);
    }
  });

  it('ATR-3 bate com True Range + suavizacao de Wilder', () => {
    const bars: IndicatorBar[] = [
      { h: 48.7, l: 47.79, c: 48.16 },
      { h: 48.72, l: 48.14, c: 48.61 },
      { h: 48.9, l: 48.39, c: 48.75 },
      { h: 48.87, l: 48.37, c: 48.63 },
      { h: 48.82, l: 48.24, c: 48.74 },
      { h: 49.05, l: 48.64, c: 49.03 },
    ].map((b, i) => ({ time: 1_600_000_000 + i * 60, open: b.c, high: b.h, low: b.l, close: b.c }));
    const esperado = [null, null, 0.666667, 0.611111, 0.600741, 0.53716];
    const pontos = atrFactory.create({ period: 3 }).warmup(bars);
    const atr = serieDe(pontos, 'value');
    for (let i = 0; i < esperado.length; i++) {
      if (esperado[i] === null) expect(atr[i]).toBeNull();
      else expect(atr[i] as number).toBeCloseTo(esperado[i] as number, 4);
    }
  });

  it('MACD(3,6,3) bate com a definicao calculada a mao', () => {
    const closes = [10, 11, 12, 11, 13, 14, 15, 14, 16, 17, 18, 17, 19, 20];
    const pontos = macdFactory
      .create({ fast: 3, slow: 6, signal: 3, source: 'close' })
      .warmup(serieClose(closes));
    const macd = serieDe(pontos, 'macd');
    const signal = serieDe(pontos, 'signal');
    const hist = serieDe(pontos, 'histogram');

    // macd nasce na barra 5 (EMA lenta de 6 aquece); sinal na barra 7.
    expect(macd[5] as number).toBeCloseTo(1.166667, 4);
    expect(macd[6] as number).toBeCloseTo(1.261905, 4);
    expect(signal[5]).toBeNull();
    expect(signal[6]).toBeNull();

    expect(signal[7] as number).toBeCloseTo(1.109977, 4);
    expect(hist[7] as number).toBeCloseTo(-0.208617, 4);
    expect(macd[7] as number).toBeCloseTo(0.901361, 4);

    expect(signal[13] as number).toBeCloseTo(1.137555, 4);
    expect(hist[13] as number).toBeCloseTo(0.064281, 4);
    expect(macd[13] as number).toBeCloseTo(1.201836, 4);
  });
});
