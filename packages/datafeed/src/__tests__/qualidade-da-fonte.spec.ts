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
  diaDeMercado,
  filtrarDiasSemPregao,
  intervaloTocaSessao,
  intradiarioDegradado,
  medirCoberturaDeVolume,
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

  it('⭐⭐ fora da janela aferida é RESSALVA, não erro — e o D1 é o caso puro', () => {
    // A base declara conferência até 31/03/2026. Setembro de 2026 é justamente o dado que
    // ninguém conferiu, e o operador precisa saber disso sem perder a tela.
    //
    // ⚠️ O período é D1 de propósito: no INTRADIÁRIO de set/2026 há um segundo problema, mais
    // grave (a fonte perdeu negócios), e ele leva o laudo a REPROVADO — ver o teste seguinte. Em
    // D1 o fechamento continua exato, então sobra só a ressalva de janela, que é o que se afere
    // aqui.
    // ⚠️ Os dias são os PREGÕES REAIS de setembro/2026, não `i * 86400`: dias corridos incluem o
    // fim de semana e o feriado de 7/9, a guarda de sessão acusaria 30% das barras fora do pregão
    // e o laudo sairia REPROVADO por um defeito do fixture. Foi o que aconteceu na primeira
    // escrita deste teste.
    const pregoes = [1, 2, 3, 4, 8, 9, 10, 11, 14, 15];
    const barras = pregoes.map((d) =>
      barra(utc(2026, 9, d), { volume: 10, buyVolume: 5, sellVolume: 5 }),
    );
    const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 86_400, barras });
    expect(laudo.nivel).toBe('RESSALVA');
    expect(laudo.foraDaJanelaAferida).toBe(10);
    expect(laudo.motivos.join(' ')).toContain('31/03/2026');
  });

  it('⭐⭐⭐ o INTRADIÁRIO de set/2026 é REPROVADO — a fonte perdeu os negócios', () => {
    // ⚠️ É a distinção que importa na tela: "ninguém conferiu" (ressalva) é diferente de "a fonte
    // não tem os negócios" (reprovado). A segunda desenha um mercado que não existiu — medido,
    // amplitude 1.075 pontos contra 4.620 reais no pregão de 17/09/2026.
    const barras = Array.from({ length: 10 }, (_, i) =>
      barra(utc(2026, 9, 16, 12, 0) + i * 300, { volume: 10, buyVolume: 5, sellVolume: 5 }),
    );
    const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('REPROVADO');
    expect(laudo.motivos.join(' ')).toContain('perdeu negócios');
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

describe('⭐⭐⭐ cobertura de volume contra a ÂNCORA OFICIAL', () => {
  /**
   * O caso é o real, com os números medidos: o arquivo da mesa trazia 100 % do volume que a B3
   * registrou até mai/2026 e passou a trazer ~21 % em set/2026. É o que explica a amplitude do dia
   * sair 3–4x menor que a real — os negócios que faltam são os que fazem a máxima e a mínima.
   */
  function pregao(dia: number, volumePorBarra: number): Bar[] {
    return Array.from({ length: 10 }, (_, i) => ({
      time: utc(2026, 9, dia, 12, 0) + i * 300,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: volumePorBarra,
    }));
  }

  it('mede a fração por dia contra o volume oficial', () => {
    const barras = [...pregao(14, 100), ...pregao(15, 20)];
    const oficial = new Map([
      ['2026-09-14', 1000],
      ['2026-09-15', 1000],
    ]);
    const c = medirCoberturaDeVolume(barras, SESSAO_B3_FUTUROS, oficial);
    expect(c.diasAferidos).toBe(2);
    expect(c.porDia.get('2026-09-14')).toBeCloseTo(1, 9);
    expect(c.porDia.get('2026-09-15')).toBeCloseTo(0.2, 9);
    expect(c.medianaDaFracao).toBeCloseTo(0.6, 9);
    expect(c.piorFracao).toBeCloseTo(0.2, 9);
    expect(c.diasAbaixoDoMinimo).toBe(1);
  });

  it('⚠️ dia SEM número oficial é pulado, não contado como zero', () => {
    // ⭐ O pregão corrente nunca tem liquidação publicada. Tratá-lo como falta produziria alarme
    // todo dia — e foi exatamente o falso positivo que a primeira versão da auditoria deu.
    const barras = [...pregao(14, 100), ...pregao(17, 100)];
    const c = medirCoberturaDeVolume(barras, SESSAO_B3_FUTUROS, new Map([['2026-09-14', 1000]]));
    expect(c.diasAferidos).toBe(1);
    expect(c.diasAbaixoDoMinimo).toBe(0);
    expect(c.porDia.has('2026-09-17')).toBe(false);
  });

  it('sem nenhum dia aferível não inventa mediana', () => {
    const c = medirCoberturaDeVolume(pregao(14, 100), SESSAO_B3_FUTUROS, new Map());
    expect(c.diasAferidos).toBe(0);
    expect(c.medianaDaFracao).toBeNull();
    expect(c.piorFracao).toBeNull();
  });

  it('barra sem volume não entra na soma (ausência não é zero)', () => {
    const semVolume: Bar[] = [{ time: utc(2026, 9, 14, 12, 0), open: 1, high: 1, low: 1, close: 1 }];
    const c = medirCoberturaDeVolume(
      [...pregao(14, 100), ...semVolume],
      SESSAO_B3_FUTUROS,
      new Map([['2026-09-14', 1000]]),
    );
    expect(c.porDia.get('2026-09-14')).toBeCloseTo(1, 9);
  });

  it('⭐ `diaDeMercado` usa o fuso do MERCADO, não o da máquina', () => {
    // 17/09 00:30 UTC é ainda 16/09 21:30 em Brasília: o pregão é o de 16/09.
    expect(diaDeMercado(utc(2026, 9, 17, 0, 30), SESSAO_B3_FUTUROS)).toBe('2026-09-16');
    expect(diaDeMercado(utc(2026, 9, 17, 12, 0), SESSAO_B3_FUTUROS)).toBe('2026-09-17');
    // Num mercado sem offset o dia é o do próprio carimbo.
    expect(diaDeMercado(utc(2026, 9, 17, 0, 30), SESSAO_24_7)).toBe('2026-09-17');
  });
});

describe('⭐⭐⭐ intradiarioDegradado — a decisão de quem manda na emenda', () => {
  it('o intradiário DEPOIS do corte é degradado; o de antes, não', () => {
    const antes = utc(2026, 5, 20, 12, 0);
    const depois = utc(2026, 9, 17, 12, 0);
    expect(intradiarioDegradado(PERFIL_DA_MESA, 300, antes)).toBe(false);
    expect(intradiarioDegradado(PERFIL_DA_MESA, 300, depois)).toBe(true);
  });

  it('⭐ o DIÁRIO nunca é degradado — o fechamento continua exato', () => {
    // Medido: idêntico ao oficial da B3 em 62 de 62 dias. O negócio do leilão de fechamento é
    // grande e nunca escapa da captura; o que se perde é o CAMINHO dentro do dia.
    const depois = utc(2026, 9, 17, 12, 0);
    expect(intradiarioDegradado(PERFIL_DA_MESA, 86_400, depois)).toBe(false);
  });

  it('⚠️ perfil que não declara o corte nunca degrada nada', () => {
    // ⭐ É o critério de parametrização: outra fonte não herda o defeito desta.
    const outra: PerfilDeQualidade = { nome: 'outra fonte' };
    expect(intradiarioDegradado(outra, 300, utc(2026, 9, 17, 12, 0))).toBe(false);
  });

  it('o laudo REPROVA e explica, sem esvaziar a tela', () => {
    const barras = Array.from({ length: 20 }, (_, i) => ({
      time: utc(2026, 9, 17, 12, 0) + i * 300,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
      buyVolume: 5,
      sellVolume: 5,
    }));
    const laudo = avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 300, barras });
    expect(laudo.nivel).toBe('REPROVADO');
    expect(laudo.motivos.join(' ')).toContain('perdeu negócios no intradiário');
    // ⭐ E continua sendo só um laudo: nenhuma barra é devolvida nem removida.
    expect(barras).toHaveLength(20);
  });
});
