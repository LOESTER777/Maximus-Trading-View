/**
 * price-format.core — casas por tick, arredondamento e nao-finito.
 *
 * Nucleo PURO: nada de canvas nem DOM. Afirma sobre a string devolvida, que e a
 * verdade observavel do formatador — o mesmo texto que o eixo pinta.
 */
import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  roundToTick,
  decimalsFromTick,
  PRICE_PLACEHOLDER,
} from '../price-format.core.js';

describe('decimalsFromTick', () => {
  it('deriva as casas do tick: 0.01=>2, 0.5=>1, 5=>0', () => {
    expect(decimalsFromTick(0.01)).toBe(2);
    expect(decimalsFromTick(0.5)).toBe(1);
    expect(decimalsFromTick(5)).toBe(0);
  });

  it('tick fino de forex => 5 casas', () => {
    expect(decimalsFromTick(0.00001)).toBe(5);
  });

  /**
   * ⭐ A armadilha que o comentario do nucleo cita: `-log10(0.001)` da 2.9999...
   * por ponto flutuante. A contagem de casas tem de devolver 3, nao 2.
   */
  it('0.001 => 3 casas (sem erro de log10)', () => {
    expect(decimalsFromTick(0.001)).toBe(3);
  });

  it('tick >= 1 e sempre 0 casas', () => {
    expect(decimalsFromTick(1)).toBe(0);
    expect(decimalsFromTick(25)).toBe(0);
  });

  it('tick nao-finito ou <= 0 cai em 0, nunca NaN', () => {
    expect(decimalsFromTick(NaN)).toBe(0);
    expect(decimalsFromTick(0)).toBe(0);
    expect(decimalsFromTick(-1)).toBe(0);
    expect(decimalsFromTick(Infinity)).toBe(0);
  });
});

describe('roundToTick', () => {
  it('arredonda ao multiplo do tick', () => {
    expect(roundToTick(137.23, 5)).toBe(135);
    expect(roundToTick(137.6, 0.5)).toBe(137.5);
    expect(roundToTick(1.23456, 0.01)).toBe(1.23);
  });

  /** ⚠️ sem lixo binario: 0.1+0.2 nao pode reaparecer no valor arredondado. */
  it('nao reintroduz lixo de ponto flutuante', () => {
    expect(roundToTick(0.3, 0.1)).toBe(0.3);
    expect(roundToTick(1.005, 0.01)).toBe(1.0);
  });

  it('tick invalido devolve o preco intacto', () => {
    expect(roundToTick(137.23, 0)).toBe(137.23);
    expect(roundToTick(137.23, NaN)).toBe(137.23);
  });

  it('preco nao-finito passa reto (nao lanca)', () => {
    expect(roundToTick(NaN, 0.5)).toBeNaN();
  });
});

describe('formatPrice', () => {
  it('tickSize 0.01 => 2 casas, arredondado', () => {
    expect(formatPrice(1.23456, { tickSize: 0.01 })).toBe('1.23');
  });

  it('tickSize 0.5 => 1 casa, arredondado ao meio', () => {
    expect(formatPrice(137.6, { tickSize: 0.5 })).toBe('137.5');
  });

  it('tickSize 5 => 0 casas, arredondado ao multiplo de 5', () => {
    expect(formatPrice(137.23, { tickSize: 5 })).toBe('135');
    expect(formatPrice(138, { tickSize: 5 })).toBe('140');
  });

  it('precision explicito vence o tick na contagem de casas', () => {
    // arredonda ao tick 0.5, mas exibe com 3 casas por pedido explicito.
    expect(formatPrice(137.6, { tickSize: 0.5, precision: 3 })).toBe('137.500');
  });

  it('minMove funciona como alias de tickSize quando este falta', () => {
    expect(formatPrice(1.23456, { minMove: 0.01 })).toBe('1.23');
  });

  it('sem opcoes: 2 casas', () => {
    expect(formatPrice(137.239)).toBe('137.24');
  });

  /** ⚠️ Decisao documentada: nao-finito => travessao, nunca vazio nem '0'. */
  it('preco nao-finito devolve o travessao, nao lanca', () => {
    expect(formatPrice(NaN)).toBe(PRICE_PLACEHOLDER);
    expect(formatPrice(Infinity, { tickSize: 0.5 })).toBe(PRICE_PLACEHOLDER);
    expect(formatPrice(-Infinity, { precision: 2 })).toBe(PRICE_PLACEHOLDER);
    expect(PRICE_PLACEHOLDER).toBe('—');
  });

  it('precision invalido e ignorado (cai no tick ou no default)', () => {
    expect(formatPrice(1.239, { precision: -1 })).toBe('1.24');
    expect(formatPrice(1.239, { precision: NaN })).toBe('1.24');
  });
});
