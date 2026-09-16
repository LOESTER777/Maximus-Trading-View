/**
 * Niveis do eixo de preco em escala LOGARITMICA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, EM NUMEROS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `priceTicks` gerava passo LINEAR mesmo com `logarithmic: true`. Numa faixa de 10
 * a 1.000 com 6 divisoes, o passo linear e ~165 e os rotulos saem em 165, 330, 495,
 * 660, 825, 990. Em log, a decada 10..100 ocupa 1/3 da altura da tela e recebe
 * **zero** rotulo, enquanto os cinco ultimos se amontoam no terco de cima. O eixo
 * passa a mentir sobre onde estao os niveis.
 *
 * ⭐ A escada 1/2/5 e a certa porque e quase uniforme EM LOG: os saltos 1→2→5→10
 * valem 0,30 / 0,40 / 0,30 decada. Estes testes medem exatamente isso — que os
 * niveis existem em toda a faixa e que a distancia entre eles NA TELA e regular.
 *
 * ⚠️ E o caso linear e travado por igualdade contra o comportamento historico: e a
 * unica forma de garantir que a mudanca nao mexeu no eixo que todo mundo usa.
 */
import { describe, expect, it } from 'vitest';
import {
  createPriceScaleState,
  priceToCoordinate,
  priceTicks,
  type PriceScaleState,
} from '../price-scale.core.js';

function escala(bottom: number, top: number, log: boolean, height = 400): PriceScaleState {
  const s = createPriceScaleState(0, 0);
  s.height = height;
  s.bottomPrice = bottom;
  s.topPrice = top;
  s.logarithmic = log;
  return s;
}

describe('priceTicks — linear NAO mudou', () => {
  /**
   * As faixas aqui cobrem as quatro mantissas da escada linear (1, 2, 2.5, 5) e
   * varias ordens de magnitude. Os valores esperados sao os que a versao anterior
   * produzia.
   */
  it('mantem o passo bonito 1/2/2.5/5 x potencia de 10', () => {
    // span 10 / 6 = 1,67 -> normalizado cai abaixo de 2 -> passo 1.
    expect(priceTicks(escala(0, 10, false))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // span 30 / 6 = 5 -> passo 5.
    expect(priceTicks(escala(100, 130, false))).toEqual([100, 105, 110, 115, 120, 125, 130]);
    // A mesma escada uma potencia de 10 abaixo: passo 0,1.
    expect(priceTicks(escala(0, 1, false)).map((v) => Number(v.toFixed(10)))).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
    ]);
    // E a mantissa 2,5, que so aparece nesta faixa da escada: span 22 / 6 = 3,67.
    expect(priceTicks(escala(0, 22, false))).toEqual([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  });

  it('faixa degenerada ou invertida devolve vazio', () => {
    expect(priceTicks(escala(10, 10, false))).toEqual([]);
    expect(priceTicks(escala(20, 10, false))).toEqual([]);
    expect(priceTicks(escala(0, Number.POSITIVE_INFINITY, false))).toEqual([]);
  });

  /** A mesma faixa, com e sem log, tem de dar resultados DIFERENTES — guarda de vacuidade. */
  it('log e linear divergem na mesma faixa ampla (senao os testes abaixo mentiriam)', () => {
    const lin = priceTicks(escala(10, 1000, false));
    const log = priceTicks(escala(10, 1000, true));
    expect(log).not.toEqual(lin);
  });
});

describe('priceTicks — logaritmico', () => {
  it('usa potencias de 10 e as subdivisoes 1/2/5', () => {
    const t = priceTicks(escala(1, 100, true));
    expect(t).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  it('cobre TODA a faixa, inclusive a decada de baixo que o passo linear ignorava', () => {
    const t = priceTicks(escala(10, 1000, true));
    // O defeito: nenhum nivel abaixo de 165. Agora ha varios.
    expect(t.filter((v) => v < 100).length).toBeGreaterThan(0);
    expect(t[0]!).toBe(10);
    expect(t[t.length - 1]!).toBe(1000);
  });

  it('so devolve niveis DENTRO da faixa', () => {
    const s = escala(30, 700, true);
    for (const v of priceTicks(s)) {
      expect(v).toBeGreaterThanOrEqual(s.bottomPrice);
      expect(v).toBeLessThanOrEqual(s.topPrice);
    }
  });

  it('sai em ordem crescente e sem repetir', () => {
    const t = priceTicks(escala(1, 10_000, true));
    expect(t.length).toBeGreaterThan(2);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
  });

  /**
   * ⭐ A ASSERÇÃO QUE PEGA O DEFEITO DE VERDADE: espacamento REGULAR NA TELA.
   *
   * O passo linear em escala log produz distancias em pixel que variam por ordens de
   * magnitude (os niveis de baixo ficam a centenas de pixels um do outro, os de cima
   * a poucos). Aqui a maior distancia nao passa de 2x a menor.
   */
  it('o espacamento em PIXEL e regular — o que o passo linear nao dava', () => {
    const s = escala(10, 1000, true);
    const ys = priceTicks(s)
      .map((p) => priceToCoordinate(s, p))
      .filter((y): y is number => y !== null);
    expect(ys.length).toBeGreaterThan(3);

    const gaps: number[] = [];
    for (let i = 1; i < ys.length; i++) gaps.push(Math.abs(ys[i]! - ys[i - 1]!));
    const menor = Math.min(...gaps);
    const maior = Math.max(...gaps);
    expect(menor).toBeGreaterThan(0);
    expect(maior / menor).toBeLessThan(2);

    // E a comparacao direta com o passo LINEAR na mesma escala log: la a razao
    // estoura. E o numero que documenta o defeito.
    const sLin = escala(10, 1000, true);
    const ysLin = priceTicks({ ...sLin, logarithmic: false })
      .map((p) => priceToCoordinate(sLin, p))
      .filter((y): y is number => y !== null);
    const gapsLin: number[] = [];
    for (let i = 1; i < ysLin.length; i++) gapsLin.push(Math.abs(ysLin[i]! - ysLin[i - 1]!));
    const razaoLinear = Math.max(...gapsLin) / Math.min(...gapsLin);
    expect(razaoLinear).toBeGreaterThan(4);
  });

  /** Faixa muito ampla rala as subdivisoes para nao amontoar rotulo. */
  it('faixa de muitas decadas rotula so potencias de 10, pulando se preciso', () => {
    const t = priceTicks(escala(1e-3, 1e9, true));
    expect(t.length).toBeGreaterThan(2);
    expect(t.length).toBeLessThan(16);
    // Todo nivel e uma potencia de 10 exata.
    for (const v of t) {
      const k = Math.log10(v);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });

  /**
   * ⚠️ Faixa de menos de uma decada rende 1 ou 2 niveis 1/2/5 — insuficiente para
   * um eixo. Em amplitude curta o log e praticamente linear, entao o passo linear le
   * melhor e a diferenca visual e desprezivel. E o caso do mini-indice (130.000 a
   * 130.400), que e o uso dominante.
   */
  it('faixa curta cai no passo LINEAR (que le melhor e e visualmente igual)', () => {
    const s = escala(130_000, 130_400, true);
    const t = priceTicks(s);
    const linear = priceTicks({ ...s, logarithmic: false });
    expect(t).toEqual(linear);
    expect(t.length).toBeGreaterThan(2);
  });

  /**
   * ⚠️ Base <= 0 com log e degenerado: log de nao-positivo nao existe, e o piso
   * interno de `toScale` distorceria a faixa em ordens de magnitude. Cai no linear —
   * melhor um eixo linear correto que um log inventado.
   */
  it('base zero ou negativa cai no passo linear, sem lancar', () => {
    const s = escala(0, 100, true);
    expect(() => priceTicks(s)).not.toThrow();
    expect(priceTicks(s)).toEqual(priceTicks({ ...s, logarithmic: false }));

    const sNeg = escala(-50, 100, true);
    expect(priceTicks(sNeg)).toEqual(priceTicks({ ...sNeg, logarithmic: false }));
  });

  it('todo nivel devolvido tem coordenada dentro da area', () => {
    const s = escala(1, 10_000, true);
    for (const p of priceTicks(s)) {
      const y = priceToCoordinate(s, p);
      expect(y).not.toBeNull();
      expect(y!).toBeGreaterThanOrEqual(-1e-6);
      expect(y!).toBeLessThanOrEqual(s.height + 1e-6);
    }
  });
});
