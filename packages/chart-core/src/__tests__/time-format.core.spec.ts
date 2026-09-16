/**
 * time-format.core — o formatador de tempo do eixo e a escolha do passo de rotulo.
 *
 * ⚠️ O que mais importa aqui e a estabilidade de fuso: a saida NAO pode depender do
 * `TZ` do processo que roda o teste. Por isso as asercoes fixam o fuso
 * explicitamente (`UTC`, `America/Sao_Paulo`) e comparam com o valor esperado
 * NAQUELE fuso — nunca com "a hora local da maquina". Foi o erro classico da
 * origem: somar deslocamento a mao e errar em ±3 h.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIME_ZONE,
  chooseTickUnit,
  formatDataHoraCompleta,
  formatDiaMes,
  formatHoraMinuto,
  formatHoraMinutoSegundo,
  formatMesAno,
  mudouODia,
  mudouOMes,
  timePartsInZone,
} from '../time-format.core.js';

// Um instante conhecido: 2026-01-05 12:30:45 UTC (epoch em SEGUNDOS).
const EPOCH_S = Date.UTC(2026, 0, 5, 12, 30, 45) / 1000;

describe('timePartsInZone — resolucao de instante para fuso explicito', () => {
  it('resolve as partes em UTC sem depender do TZ do processo', () => {
    const p = timePartsInZone(EPOCH_S, 'UTC');
    expect(p).not.toBeNull();
    expect(p).toMatchObject({ year: 2026, month: 1, day: 5, hour: 12, minute: 30, second: 45 });
  });

  it('aplica o deslocamento de Sao Paulo (UTC-3 em janeiro) via Intl, nao a mao', () => {
    const p = timePartsInZone(EPOCH_S, 'America/Sao_Paulo');
    // 12:30 UTC => 09:30 em Sao Paulo (UTC-3). O DIA nao muda.
    expect(p).toMatchObject({ day: 5, hour: 9, minute: 30 });
  });

  it('a virada de dia por fuso e respeitada: 02:00 UTC vira dia anterior em SP', () => {
    const madrugadaUtc = Date.UTC(2026, 0, 5, 2, 0, 0) / 1000;
    const p = timePartsInZone(madrugadaUtc, 'America/Sao_Paulo');
    // 02:00 UTC => 23:00 do dia 4 em Sao Paulo.
    expect(p).toMatchObject({ day: 4, hour: 23 });
  });

  it('recusa instante inutilizavel devolvendo null (nunca lanca)', () => {
    expect(timePartsInZone(NaN, 'UTC')).toBeNull();
    expect(timePartsInZone(Infinity, 'UTC')).toBeNull();
    expect(timePartsInZone(1e30, 'UTC')).toBeNull();
  });

  it('recusa fuso inexistente devolvendo null em vez de propagar excecao', () => {
    expect(timePartsInZone(EPOCH_S, 'Marte/Cratera')).toBeNull();
  });

  it('o default e Brasilia (B3)', () => {
    expect(DEFAULT_TIME_ZONE).toBe('America/Sao_Paulo');
  });
});

describe('formatadores — layout montado a mao, independente de locale', () => {
  const p = timePartsInZone(EPOCH_S, 'UTC')!;

  it('HH:mm e HH:mm:ss', () => {
    expect(formatHoraMinuto(p)).toBe('12:30');
    expect(formatHoraMinutoSegundo(p)).toBe('12:30:45');
  });

  it('dd/MMM e MMM/yyyy usam nome de mes abreviado pt-BR', () => {
    expect(formatDiaMes(p)).toBe('05/jan');
    expect(formatMesAno(p)).toBe('jan/2026');
  });

  it('data/hora completa, com e sem segundos', () => {
    expect(formatDataHoraCompleta(p, false)).toBe('05/01/2026 12:30');
    expect(formatDataHoraCompleta(p, true)).toBe('05/01/2026 12:30:45');
  });
});

describe('mudouODia / mudouOMes — deteccao de virada de calendario', () => {
  const a = timePartsInZone(Date.UTC(2026, 0, 5, 23, 0) / 1000, 'UTC')!;
  const mesmoDia = timePartsInZone(Date.UTC(2026, 0, 5, 8, 0) / 1000, 'UTC')!;
  const diaSeguinte = timePartsInZone(Date.UTC(2026, 0, 6, 1, 0) / 1000, 'UTC')!;
  const mesSeguinte = timePartsInZone(Date.UTC(2026, 1, 1, 1, 0) / 1000, 'UTC')!;

  it('mesmo dia => nao mudou', () => {
    expect(mudouODia(a, mesmoDia)).toBe(false);
  });
  it('dia seguinte => mudou o dia, mas nao o mes', () => {
    expect(mudouODia(a, diaSeguinte)).toBe(true);
    expect(mudouOMes(a, diaSeguinte)).toBe(false);
  });
  it('mes seguinte => mudou dia e mes', () => {
    expect(mudouODia(a, mesSeguinte)).toBe(true);
    expect(mudouOMes(a, mesSeguinte)).toBe(true);
  });
});

describe('chooseTickUnit — o passo de rotulo muda com o zoom', () => {
  // Barras de 1 minuto (60 s).
  const M1 = 60;
  // Barras diarias (86400 s).
  const D1 = 86400;

  it('zoom-in em M1 (vela larga) pede HH:mm, entao unidade fina (minute/second)', () => {
    // barSpacing grande => poucas barras por 80px => intervalo curto => fino.
    const unit = chooseTickUnit(40, M1);
    expect(['second', 'minute']).toContain(unit);
  });

  it('zoom-out em M1 (vela estreita) sobe para unidade mais grossa que o zoom-in', () => {
    const ordem = ['second', 'minute', 'hour', 'day', 'month'];
    const zoomIn = chooseTickUnit(40, M1);
    const zoomOut = chooseTickUnit(2, M1);
    // O passo do zoom-out e igual ou mais grosso que o do zoom-in — nunca mais fino.
    expect(ordem.indexOf(zoomOut)).toBeGreaterThanOrEqual(ordem.indexOf(zoomIn));
    // E em zoom-out bem forte (barSpacing minusculo) chega a hora/dia/mes.
    const zoomOutForte = chooseTickUnit(0.5, M1);
    expect(['hour', 'day', 'month']).toContain(zoomOutForte);
  });

  it('em D1 o mesmo barSpacing resulta em unidade mais grossa que em M1', () => {
    // ⭐ A decisao usa DUAS grandezas: o mesmo zoom significa densidades diferentes
    // em M1 e D1. Em D1 o intervalo real por rotulo e muito maior.
    const emM1 = chooseTickUnit(8, M1);
    const emD1 = chooseTickUnit(8, D1);
    const ordem = ['second', 'minute', 'hour', 'day', 'month'];
    expect(ordem.indexOf(emD1)).toBeGreaterThanOrEqual(ordem.indexOf(emM1));
  });

  it('degrada para dia com entrada invalida em vez de lancar', () => {
    expect(chooseTickUnit(0, M1)).toBe('day');
    expect(chooseTickUnit(NaN, M1)).toBe('day');
  });
});
