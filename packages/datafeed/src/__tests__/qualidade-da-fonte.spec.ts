/**
 * Bancada do laudo de qualidade da fonte.
 *
 * ⭐ Os casos concretos são as MEDIÇÕES de 18/09/2026 contra o serviço da mesa, não
 * exemplos inventados: os 15 domingos do `D1` do WIN, as 948 barras de fim de semana
 * legítimas do BTC, e o agressor que desapareceu de 62 % das barras de julho.
 */

import { describe, expect, it } from 'vitest';

import type { Bar } from '../contracts.js';
import {
  avaliarQualidade,
  filtrarDiasSemPregao,
  intervaloTocaSessao,
  PERFIL_DA_MESA,
  SESSAO_24_7,
  SESSAO_B3_FUTUROS,
  type PerfilDeQualidade,
} from '../qualidade-da-fonte.core.js';

const DIA = 86_400;

/** Epoch UTC de uma data/hora, sem depender do fuso da máquina. */
function utc(ano: number, mes: number, dia: number, hora = 0, minuto = 0): number {
  return Math.floor(Date.UTC(ano, mes - 1, dia, hora, minuto, 0) / 1000);
}

function barra(time: number, extra?: Partial<Bar>): Bar {
  return { time, open: 100, high: 101, low: 99, close: 100.5, ...extra };
}

describe('intervaloTocaSessao — a identidade é o INTERVALO, não o carimbo', () => {
  it('aceita o pregão nas DUAS convenções de rótulo diário da base', () => {
    // Segunda-feira 21/09/2026. A base rotula o mesmo pregão de dois jeitos, e os dois
    // têm de passar: 03:00Z (= 00:00 BRT de segunda) e 00:00Z (= 21:00 BRT de domingo).
    const rotuloBrt = utc(2026, 9, 21, 3, 0);
    const rotuloUtc = utc(2026, 9, 21, 0, 0);
    expect(intervaloTocaSessao(rotuloBrt, DIA, SESSAO_B3_FUTUROS)).toBe(true);
    expect(intervaloTocaSessao(rotuloUtc, DIA, SESSAO_B3_FUTUROS)).toBe(true);
  });

  it('⭐ recusa o domingo 00:00Z — o defeito real: 15 barras assim no D1 do WIN', () => {
    // 31/05/2026 é domingo. Intervalo local: sáb 21:00 → dom 21:00. Nenhuma sessão dentro.
    expect(intervaloTocaSessao(utc(2026, 5, 31), DIA, SESSAO_B3_FUTUROS)).toBe(false);
  });

  it('⭐ recusa o sábado 00:00Z também — a ponta que um teste de dia da semana perderia', () => {
    // 30/05/2026 é sábado. Intervalo local: sex 21:00 → sáb 21:00. A sexta já fechou às
    // 18:35 e o sábado não abre. Um teste sobre o carimbo veria "sábado" e acertaria por
    // sorte; um teste que só olhasse o dia ANTERIOR veria sexta e aprovaria.
    expect(intervaloTocaSessao(utc(2026, 5, 30), DIA, SESSAO_B3_FUTUROS)).toBe(false);
  });

  it('aceita barra intradiária dentro do pregão e recusa a de 21:35', () => {
    // Medido: 3 barras em 27.746 no ano de 2024 caem às 21:35, 21:20 e 21:45 BRT.
    const dentro = utc(2026, 9, 16, 12, 0); // 09:00 BRT
    const fora = utc(2026, 9, 17, 0, 35); // 21:35 BRT do dia 16
    expect(intervaloTocaSessao(dentro, 300, SESSAO_B3_FUTUROS)).toBe(true);
    expect(intervaloTocaSessao(fora, 300, SESSAO_B3_FUTUROS)).toBe(false);
  });

  it('aceita a última barra de 18:30 BRT — o teto é 18:35 de propósito', () => {
    expect(intervaloTocaSessao(utc(2026, 9, 16, 21, 30), 300, SESSAO_B3_FUTUROS)).toBe(true);
  });

  it('⭐⭐ 24/7 aceita fim de semana: é o que salva as 948 barras legítimas do BTC', () => {
    expect(intervaloTocaSessao(utc(2026, 5, 31), DIA, SESSAO_24_7)).toBe(true);
    expect(intervaloTocaSessao(utc(2026, 5, 30, 3, 0), 300, SESSAO_24_7)).toBe(true);
  });

  it('entrada não aferível não é acusação', () => {
    expect(intervaloTocaSessao(Number.NaN, DIA, SESSAO_B3_FUTUROS)).toBe(true);
    expect(intervaloTocaSessao(utc(2026, 5, 31), 0, SESSAO_B3_FUTUROS)).toBe(true);
    expect(
      intervaloTocaSessao(utc(2026, 5, 31), DIA, { ...SESSAO_B3_FUTUROS, diasComPregao: [] }),
    ).toBe(true);
  });
});

describe('filtrarDiasSemPregao', () => {
  it('remove o domingo e mantém a semana', () => {
    const barras = [
      barra(utc(2026, 5, 28)),
      barra(utc(2026, 5, 29)),
      barra(utc(2026, 5, 31)), // domingo — o fantasma
      barra(utc(2026, 6, 1)),
    ];
    const { mantidas, removidas } = filtrarDiasSemPregao(barras, DIA, SESSAO_B3_FUTUROS);
    expect(removidas.map((b) => b.time)).toEqual([utc(2026, 5, 31)]);
    expect(mantidas).toHaveLength(3);
  });

  it('⚠️ NÃO remove por minuto: horário de verão deslocaria a leitura em 1 h', () => {
    // 21:35 BRT está fora da sessão e o LAUDO acusa. O filtro, não: ele só remove dia sem
    // pregão, porque 1 h de erro de fuso não transforma quarta em domingo mas transforma
    // 09:00 em 08:00 — e aí o filtro apagaria a abertura de todo dado pré-2019.
    const barras = [barra(utc(2026, 9, 17, 0, 35))];
    const { mantidas, removidas } = filtrarDiasSemPregao(barras, 300, SESSAO_B3_FUTUROS);
    expect(removidas).toHaveLength(0);
    expect(mantidas).toHaveLength(1);
  });

  it('devolve o MESMO array quando nada sai (identidade importa para memo de React)', () => {
    const barras = [barra(utc(2026, 6, 1)), barra(utc(2026, 6, 2))];
    const r = filtrarDiasSemPregao(barras, DIA, SESSAO_B3_FUTUROS);
    expect(r.mantidas).toBe(barras);
  });

  it('não remove nada num mercado 24/7', () => {
    const barras = [barra(utc(2026, 5, 30)), barra(utc(2026, 5, 31))];
    const r = filtrarDiasSemPregao(barras, DIA, SESSAO_24_7);
    expect(r.removidas).toHaveLength(0);
    expect(r.mantidas).toBe(barras);
  });
});

describe('avaliarQualidade', () => {
  const perfilSimples: PerfilDeQualidade = {
    nome: 'teste',
    janelaAferida: { de: utc(2024, 1, 1), ate: utc(2026, 3, 31, 23, 59) },
    sessao: SESSAO_B3_FUTUROS,
    fracaoMinimaComAgressor: 0.5,
    fracaoToleradaForaDaSessao: 0.02,
  };

  it('série dentro de tudo sai OK e sem motivo', () => {
    const barras = [
      barra(utc(2025, 6, 2, 12, 0), { volume: 10, buyVolume: 5, sellVolume: 5 }),
      barra(utc(2025, 6, 2, 12, 5), { volume: 10, buyVolume: 6, sellVolume: 4 }),
    ];
    const laudo = avaliarQualidade(perfilSimples, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('OK');
    expect(laudo.motivos).toEqual([]);
    expect(laudo.fracaoComAgressor).toBe(1);
  });

  it('⭐ barras depois do fim da janela aferida geram RESSALVA, nunca recusa', () => {
    const barras = [
      barra(utc(2026, 9, 16, 12, 0), { volume: 10, buyVolume: 5, sellVolume: 5 }),
      barra(utc(2026, 9, 16, 12, 5), { volume: 10, buyVolume: 5, sellVolume: 5 }),
    ];
    const laudo = avaliarQualidade(perfilSimples, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('RESSALVA');
    expect(laudo.foraDaJanelaAferida).toBe(2);
    expect(laudo.motivos.join(' ')).toContain('fora da janela aferida');
    // ⚠️ O laudo não tem como remover nada: não devolve barras.
    expect(Object.keys(laudo)).not.toContain('barras');
  });

  it('⭐⭐ agressor ausente na maioria das barras é RESSALVA (jul/2026: 62 % sem)', () => {
    const barras = Array.from({ length: 100 }, (_, i) =>
      i < 62
        ? barra(utc(2025, 7, 1, 12, 0) + i * 300, { volume: 10 })
        : barra(utc(2025, 7, 1, 12, 0) + i * 300, { volume: 10, buyVolume: 5, sellVolume: 5 }),
    );
    const laudo = avaliarQualidade(perfilSimples, { periodSeconds: 300, barras });
    expect(laudo.semAgressor).toBe(62);
    expect(laudo.fracaoComAgressor).toBeCloseTo(0.38, 5);
    expect(laudo.nivel).toBe('RESSALVA');
    expect(laudo.motivos.join(' ')).toContain('38%');
  });

  it('poucas barras fora da sessão NÃO alarmam (3 em 27.746 é resíduo)', () => {
    // 113 barras de 5 min a partir de 09:00 BRT = o pregão inteiro até 18:20, dentro da
    // janela. Mais uma às 21:35, que é o resíduo medido no arquivo.
    const barras = [
      ...Array.from({ length: 113 }, (_, i) =>
        barra(utc(2025, 6, 2, 12, 0) + i * 300, { volume: 1, buyVolume: 1, sellVolume: 0 }),
      ),
      barra(utc(2025, 6, 3, 0, 35), { volume: 1, buyVolume: 1, sellVolume: 0 }), // 21:35 BRT
    ];
    const laudo = avaliarQualidade(perfilSimples, { periodSeconds: 300, barras });
    expect(laudo.foraDaSessao).toHaveLength(1);
    // 1/114 = 0,9 % < 2 % tolerado ⇒ nem motivo.
    expect(laudo.nivel).toBe('OK');
    expect(laudo.motivos).toEqual([]);
  });

  it('⭐⭐ fuso errado põe uma HORA inteira fora e isso é REPROVADO, não ressalva', () => {
    // Uma série deslocada 3 h: tudo o que era 09:00–18:30 vira 06:00–15:30, e a primeira
    // parte cai fora. Aqui simula-se o caso extremo: metade fora.
    const dentro = Array.from({ length: 50 }, (_, i) =>
      barra(utc(2025, 6, 2, 12, 0) + i * 300, { volume: 1, buyVolume: 1, sellVolume: 0 }),
    );
    const fora = Array.from({ length: 50 }, (_, i) =>
      barra(utc(2025, 6, 2, 9, 0) + i * 300, { volume: 1, buyVolume: 1, sellVolume: 0 }),
    );
    const laudo = avaliarQualidade(perfilSimples, {
      periodSeconds: 300,
      barras: [...fora, ...dentro],
    });
    expect(laudo.nivel).toBe('REPROVADO');
    expect(laudo.motivos.join(' ')).toContain('suspeita de fuso errado');
  });

  it('série vazia não inventa fração de agressor', () => {
    const laudo = avaliarQualidade(perfilSimples, { periodSeconds: 300, barras: [] });
    expect(laudo.fracaoComAgressor).toBeNull();
    expect(laudo.nivel).toBe('OK');
  });

  it('perfil sem nada declarado nunca reclama — parametrização não impõe política', () => {
    const laudo = avaliarQualidade({ nome: 'cru' }, {
      periodSeconds: 300,
      barras: [barra(utc(1999, 1, 1))],
    });
    expect(laudo.nivel).toBe('OK');
    expect(laudo.motivos).toEqual([]);
    expect(laudo.regraDoPeriodo).toBeNull();
  });
});

describe('PERFIL_DA_MESA — o conhecimento medido', () => {
  it('30min e 4h são REPROVADOS: não existem na base', () => {
    const barras = [barra(utc(2025, 6, 2, 12, 0), { volume: 1, buyVolume: 1, sellVolume: 0 })];
    for (const p of [1800, 14_400]) {
      const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: p, barras });
      expect(laudo.nivel).toBe('REPROVADO');
      expect(laudo.regraDoPeriodo?.situacao).toBe('REPROVADO');
      expect(laudo.motivos.join(' ')).toContain('não existe na base');
    }
  });

  it('5min dentro da janela é CONFIAVEL e cala', () => {
    const barras = Array.from({ length: 10 }, (_, i) =>
      barra(utc(2025, 6, 2, 12, 0) + i * 300, { volume: 10, buyVolume: 5, sellVolume: 5 }),
    );
    const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('OK');
    expect(laudo.motivos).toEqual([]);
  });

  it('⭐⭐ o pregão de HOJE cai fora da janela aferida — e isso é ressalva, não erro', () => {
    // A base declara conferência até 31/03/2026. Setembro de 2026 é justamente o dado que
    // ninguém conferiu, e o operador precisa saber disso sem perder a tela.
    const barras = Array.from({ length: 10 }, (_, i) =>
      barra(utc(2026, 9, 16, 12, 0) + i * 300, { volume: 10, buyVolume: 5, sellVolume: 5 }),
    );
    const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('RESSALVA');
    expect(laudo.foraDaJanelaAferida).toBe(10);
    expect(laudo.motivos.join(' ')).toContain('31/03/2026');
  });

  it('D1 declara a dupla convenção e 1h declara o agressor incompleto', () => {
    const barras = [barra(utc(2025, 6, 2, 12, 0), { volume: 1, buyVolume: 1, sellVolume: 0 })];
    const d1 = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 86_400, barras });
    expect(d1.nivel).toBe('RESSALVA');
    expect(d1.motivos.join(' ')).toContain('dois registros por pregão');
    const h1 = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 3600, barras });
    expect(h1.nivel).toBe('RESSALVA');
    expect(h1.motivos.join(' ')).toContain('agressor incompleto');
  });
});
