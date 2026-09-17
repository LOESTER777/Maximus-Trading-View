/**
 * Bancada da COBERTURA DE AGRESSOR — a guarda que impede delta falso na tela.
 *
 * ⭐ Achado por auditoria contra o serviço real da mesa em 17/09/2026, não por leitura de
 * código. A distribuição medida, que é o que justifica o limiar de 90 %:
 *
 * | período | cobertura mínima | p5 | abaixo de 90 % |
 * |---|---|---|---|
 * | `5min` | 100 % | 100 % | 0 de 1.137 |
 * | `15min` | 100 % | 100 % | 0 de 714 |
 * | `1h` | **0,1 %** | **3,1 %** | 96 de 459 |
 * | `D1` | 0,3 % | 96,4 % | 33 de 740 |
 *
 * O tick é íntegro; a agregação da base para períodos maiores soma o volume inteiro e só parte
 * do agressor. Em junho de 2026 a cobertura média em D1 foi de **37,8 %**.
 */
import { describe, expect, it } from 'vitest';
import {
  COBERTURA_MINIMA_DE_AGRESSOR,
  agressorUtilizavel,
  parseBarrasDaMesa,
} from '../robustus-bars.core.js';
import { parseCandlesDoMt5 } from '../mt5-bridge.core.js';

/** Um corpo colunar do serviço da mesa, com uma linha por tupla. */
function corpo(
  linhas: readonly (readonly [number, number, number, number, number, number, number, number])[],
) {
  return {
    cols: ['bar_epoch', 'open', 'high', 'low', 'close', 'volume', 'buy_vol', 'sell_vol'],
    rows: linhas.map((l) => [...l]),
  };
}

describe('agressorUtilizavel — a regra', () => {
  it('o limiar é 90%, escolhido pela distribuição medida', () => {
    expect(COBERTURA_MINIMA_DE_AGRESSOR).toBe(0.9);
  });

  it('⭐ cobertura de 100% passa (é o caso de 5min e 15min, medido)', () => {
    expect(agressorUtilizavel(1000, 600, 400)).toBe(true);
  });

  it('⭐ folga NORMAL de 1 a 2% passa — leilão e cruzamento direto existem', () => {
    // p50 medido em D1 = 98,6 %.
    expect(agressorUtilizavel(1000, 590, 396)).toBe(true);
    expect(agressorUtilizavel(1000, 580, 400)).toBe(true);
  });

  it('⭐⭐ MECANISMO: 37,8% de cobertura é RECUSADO (o junho de 2026 real)', () => {
    // Valores da ordem dos medidos: volume=4.657.110, buy+sell=2.751.130 → 59 %.
    expect(agressorUtilizavel(4_657_110, 1_400_000, 1_351_130)).toBe(false);
    // E o caso pior, 37,8 %.
    expect(agressorUtilizavel(1000, 200, 178)).toBe(false);
  });

  it('⚠️ 0,1% de cobertura (o mínimo medido em 1h) é recusado', () => {
    expect(agressorUtilizavel(1_000_000, 600, 400)).toBe(false);
  });

  it('exatamente no limiar PASSA (a borda é inclusiva)', () => {
    expect(agressorUtilizavel(1000, 500, 400)).toBe(true);
    expect(agressorUtilizavel(1000, 500, 399)).toBe(false);
  });

  it('⚠️ SEM volume para comparar, aceita — não há como aferir', () => {
    expect(agressorUtilizavel(undefined, 600, 400)).toBe(true);
    expect(agressorUtilizavel(0, 600, 400)).toBe(true);
  });

  it('um lado ausente nunca é utilizável', () => {
    expect(agressorUtilizavel(1000, 600, undefined)).toBe(false);
    expect(agressorUtilizavel(1000, undefined, 400)).toBe(false);
    expect(agressorUtilizavel(1000, undefined, undefined)).toBe(false);
  });

  it('lado NEGATIVO é recusado (não existe agressão negativa)', () => {
    expect(agressorUtilizavel(1000, -100, 1100)).toBe(false);
  });

  it('o limiar é injetável, para quem quiser ser mais ou menos rigoroso', () => {
    expect(agressorUtilizavel(1000, 400, 400, 0.7)).toBe(true);
    expect(agressorUtilizavel(1000, 400, 400, 0.95)).toBe(false);
  });
});

describe('⭐⭐ o arquivo: a barra ruim perde o AGRESSOR e mantém o VOLUME', () => {
  it('barra coerente conserva compra e venda', () => {
    const b = parseBarrasDaMesa(corpo([[1000, 10, 11, 9, 10, 1000, 600, 400]]));
    expect(b?.[0]?.volume).toBe(1000);
    expect(b?.[0]?.buyVolume).toBe(600);
    expect(b?.[0]?.sellVolume).toBe(400);
  });

  it('⭐⭐ barra com cobertura baixa: volume FICA, agressor SAI', () => {
    const b = parseBarrasDaMesa(corpo([[1000, 10, 11, 9, 10, 1000, 200, 178]]));
    const barra = b?.[0];
    expect(barra).toBeDefined();
    // O volume total é íntegro e continua desenhado — só a divisão estava quebrada.
    expect(barra?.volume).toBe(1000);
    // E o delta não será calculado: o indicador devolve `null`, que é a verdade.
    expect(barra).not.toHaveProperty('buyVolume');
    expect(barra).not.toHaveProperty('sellVolume');
  });

  it('⚠️ a barra NÃO é descartada — perder o preço por causa do agressor seria pior', () => {
    const b = parseBarrasDaMesa(
      corpo([
        [1000, 10, 11, 9, 10, 1000, 600, 400],
        [1300, 10, 12, 9, 11, 1000, 100, 50],
        [1600, 11, 13, 10, 12, 1000, 550, 440],
      ]),
    );
    expect(b?.length).toBe(3);
    expect(b?.[1]?.close).toBe(11);
    expect(b?.[1]).not.toHaveProperty('buyVolume');
    // As vizinhas boas não são afetadas.
    expect(b?.[0]?.buyVolume).toBe(600);
    expect(b?.[2]?.buyVolume).toBe(550);
  });
});

describe('⭐ o terminal MT5: a MESMA guarda', () => {
  it('barra coerente conserva o agressor', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1000, buy_volume: 600, sell_volume: 400 },
    ]);
    expect(b?.[0]?.buyVolume).toBe(600);
  });

  it('⭐⭐ cobertura baixa no terminal também perde o agressor', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1000, buy_volume: 200, sell_volume: 178 },
    ]);
    expect(b?.[0]?.volume).toBe(1000);
    expect(b?.[0]).not.toHaveProperty('buyVolume');
    expect(b?.[0]).not.toHaveProperty('sellVolume');
  });

  it('⚠️ a guarda vale para as DUAS fontes — nenhuma tem passe livre', () => {
    const ruim = [1000, 10, 11, 9, 10, 1000, 200, 178] as const;
    const arq = parseBarrasDaMesa(corpo([ruim]));
    const mt5 = parseCandlesDoMt5([
      { timestamp: 1000, open: 10, high: 11, low: 9, close: 10, volume: 1000, buy_volume: 200, sell_volume: 178 },
    ]);
    expect(arq?.[0]).not.toHaveProperty('buyVolume');
    expect(mt5?.[0]).not.toHaveProperty('buyVolume');
  });
});
