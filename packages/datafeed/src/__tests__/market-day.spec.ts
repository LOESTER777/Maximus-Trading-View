/**
 * market-day — o dia de pregao no fuso do MERCADO.
 *
 * O que estes testes protegem: a generalizacao trocou `America/Sao_Paulo` fixo
 * por parametro. O risco de uma troca assim e alguem "simplificar" depois somando
 * deslocamento a mao, o que funciona onze meses por ano e erra na virada do
 * horario de verao. Os casos de horario de verao abaixo existem para essa
 * simplificacao ser reprovada em vez de passar.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_TIME_ZONE,
  isCurrentMarketDay,
  isValidMarketDay,
  marketDayLabel,
  marketDayOf,
  shiftMarketDay,
} from '../market-day.js';

describe('marketDayOf — o dia depende do fuso do mercado, nao do da maquina', () => {
  it('o default e o fuso da B3', () => {
    expect(DEFAULT_MARKET_TIME_ZONE).toBe('America/Sao_Paulo');
  });

  it('01:00 UTC ainda e o dia anterior em Sao Paulo', () => {
    // 02/01/2026 01:00 UTC = 01/01/2026 22:00 BRT.
    const t = Date.UTC(2026, 0, 2, 1, 0, 0);
    expect(marketDayOf(t, 'America/Sao_Paulo')).toBe('2026-01-01');
    expect(marketDayOf(t, 'UTC')).toBe('2026-01-02');
  });

  it('o mesmo instante rende tres dias diferentes em tres mercados', () => {
    // 31/12/2026 23:30 UTC.
    const t = Date.UTC(2026, 11, 31, 23, 30, 0);
    expect(marketDayOf(t, 'UTC')).toBe('2026-12-31');
    expect(marketDayOf(t, 'America/Sao_Paulo')).toBe('2026-12-31'); // 20:30, mesmo dia
    expect(marketDayOf(t, 'Asia/Tokyo')).toBe('2027-01-01'); // 08:30 do dia seguinte
  });

  it('usa o default quando o fuso e omitido', () => {
    const t = Date.UTC(2026, 0, 2, 1, 0, 0);
    expect(marketDayOf(t)).toBe(marketDayOf(t, 'America/Sao_Paulo'));
  });

  /**
   * ⭐ O caso que reprova aritmetica de fuso a mao.
   *
   * Nova York troca para horario de verao em 08/03/2026 as 02:00 locais. Antes o
   * deslocamento e -5, depois e -4. Codigo que subtrai constante erra num dos dois.
   */
  it('respeita a virada do horario de verao em Nova York', () => {
    const antes = Date.UTC(2026, 2, 8, 4, 30, 0); // 23:30 do dia 07 (EST, -5)
    const depois = Date.UTC(2026, 2, 9, 3, 30, 0); // 23:30 do dia 08 (EDT, -4)
    expect(marketDayOf(antes, 'America/New_York')).toBe('2026-03-07');
    expect(marketDayOf(depois, 'America/New_York')).toBe('2026-03-08');
  });

  it('nao depende da variavel TZ do processo', () => {
    const t = Date.UTC(2026, 0, 2, 1, 0, 0);
    const anterior = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Kolkata';
      expect(marketDayOf(t, 'America/Sao_Paulo')).toBe('2026-01-01');
      process.env.TZ = 'Pacific/Kiritimati';
      expect(marketDayOf(t, 'America/Sao_Paulo')).toBe('2026-01-01');
    } finally {
      if (anterior === undefined) delete process.env.TZ;
      else process.env.TZ = anterior;
    }
  });

  it('devolve null — nao um dia inventado — para instante inutilizavel', () => {
    expect(marketDayOf(NaN)).toBeNull();
    expect(marketDayOf(Infinity)).toBeNull();
    expect(marketDayOf(-Infinity)).toBeNull();
    // @ts-expect-error entrada hostil deliberada
    expect(marketDayOf('2026-01-01')).toBeNull();
    // @ts-expect-error entrada hostil deliberada
    expect(marketDayOf(null)).toBeNull();
  });

  it('devolve null para fuso que o motor rejeita, em vez de lancar', () => {
    const t = Date.UTC(2026, 0, 2, 1, 0, 0);
    expect(() => marketDayOf(t, 'Nao/Existe')).not.toThrow();
    expect(marketDayOf(t, 'Nao/Existe')).toBeNull();
  });
});

describe('isCurrentMarketDay — so o dia corrente justifica reconsulta', () => {
  it('verdadeiro para o dia do instante, no fuso do mercado', () => {
    const t = Date.UTC(2026, 0, 2, 1, 0, 0); // 01/01 em BRT
    expect(isCurrentMarketDay('2026-01-01', t, 'America/Sao_Paulo')).toBe(true);
    expect(isCurrentMarketDay('2026-01-02', t, 'America/Sao_Paulo')).toBe(false);
  });

  it('o mesmo dia pode ser corrente num mercado e nao noutro', () => {
    const t = Date.UTC(2026, 0, 2, 1, 0, 0);
    expect(isCurrentMarketDay('2026-01-02', t, 'UTC')).toBe(true);
    expect(isCurrentMarketDay('2026-01-02', t, 'America/Sao_Paulo')).toBe(false);
  });

  it('falso quando o instante e inutilizavel — nunca reconsulta por engano', () => {
    expect(isCurrentMarketDay('2026-01-01', NaN)).toBe(false);
  });
});

describe('isValidMarketDay — sintaxe, e nao existencia de pregao', () => {
  it('aceita dia bem formado', () => {
    expect(isValidMarketDay('2026-08-28')).toBe(true);
    expect(isValidMarketDay('2024-02-29')).toBe(true); // ano bissexto
  });

  it('recusa formato errado', () => {
    for (const ruim of ['28/08/2026', '2026-8-28', '2026-08-28T00:00', '', 'ontem']) {
      expect(isValidMarketDay(ruim)).toBe(false);
    }
  });

  it('recusa data impossivel, que o padrao textual sozinho aceitaria', () => {
    expect(isValidMarketDay('2026-02-30')).toBe(false);
    expect(isValidMarketDay('2026-13-01')).toBe(false);
    expect(isValidMarketDay('2026-00-10')).toBe(false);
    expect(isValidMarketDay('2025-02-29')).toBe(false); // 2025 nao e bissexto
  });

  it('recusa nao-texto', () => {
    for (const ruim of [null, undefined, 42, {}, []]) {
      expect(isValidMarketDay(ruim)).toBe(false);
    }
  });
});

describe('marketDayLabel', () => {
  it('formata em dia/mes/ano por default', () => {
    expect(marketDayLabel('2026-08-28')).toBe('28/08/2026');
  });

  it('devolve o proprio ISO quando pedido', () => {
    expect(marketDayLabel('2026-08-28', 'iso')).toBe('2026-08-28');
  });

  it('devolve null para dia invalido, em vez de texto quebrado', () => {
    expect(marketDayLabel('2026-02-30')).toBeNull();
    expect(marketDayLabel('nao-e-dia')).toBeNull();
  });
});

describe('shiftMarketDay — dia de CALENDARIO, e o contrato diz isso', () => {
  it('avanca e recua', () => {
    expect(shiftMarketDay('2026-08-28', 1)).toBe('2026-08-29');
    expect(shiftMarketDay('2026-08-28', -1)).toBe('2026-08-27');
    expect(shiftMarketDay('2026-08-28', 0)).toBe('2026-08-28');
  });

  it('cruza mes, ano e 29 de fevereiro', () => {
    expect(shiftMarketDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftMarketDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftMarketDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftMarketDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftMarketDay('2024-03-01', -1)).toBe('2024-02-29');
  });

  /**
   * Documenta a limitacao NO TESTE, e nao so no comentario: recuar 1 a partir de
   * uma segunda devolve domingo, que nao teve pregao. E deliberado — calendario
   * de feriado por bolsa nao mora nesta biblioteca, porque envelheceria sem
   * ninguem perceber.
   */
  it('NAO pula fim de semana — e calendario, nao pregao', () => {
    // 31/08/2026 e segunda-feira.
    expect(shiftMarketDay('2026-08-31', -1)).toBe('2026-08-30'); // domingo
    expect(shiftMarketDay('2026-08-31', -2)).toBe('2026-08-29'); // sabado
  });

  it('atravessa a virada do horario de verao sem perder nem ganhar dia', () => {
    // A aritmetica e em UTC puro exatamente para isto nao depender de fuso.
    expect(shiftMarketDay('2026-03-07', 1)).toBe('2026-03-08');
    expect(shiftMarketDay('2026-11-01', 1)).toBe('2026-11-02');
    expect(shiftMarketDay('2026-10-17', 1)).toBe('2026-10-18');
  });

  it('recusa entrada invalida em vez de devolver dia torto', () => {
    expect(shiftMarketDay('2026-02-30', 1)).toBeNull();
    expect(shiftMarketDay('nao-e-dia', 1)).toBeNull();
    expect(shiftMarketDay('2026-08-28', 1.5)).toBeNull();
    expect(shiftMarketDay('2026-08-28', NaN)).toBeNull();
  });

  it('ida e volta devolve o mesmo dia', () => {
    for (const dia of ['2026-01-01', '2026-02-28', '2026-08-31', '2026-12-31']) {
      for (const n of [1, 7, 30, 365]) {
        const ida = shiftMarketDay(dia, n);
        expect(ida).not.toBeNull();
        expect(shiftMarketDay(ida as string, -n)).toBe(dia);
      }
    }
  });
});
