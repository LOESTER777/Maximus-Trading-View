/**
 * Bancada do separador de período.
 *
 * ⭐ O que importa aqui não é a contagem de linhas: é a POSIÇÃO. Uma linha de virada de dia
 * meia hora dentro do pregão anterior é pior que nenhuma linha — ela afirma que o pregão começou
 * onde não começou, e é exatamente o erro que aparece quando se calcula a virada em UTC.
 */

import { describe, expect, it } from 'vitest';

import {
  passoMedianoEmSegundos,
  separadoresDePeriodo,
  unidadeAutomaticaDeSeparador,
} from '../session-separators.core.js';

const BRT = 'America/Sao_Paulo';

/** Epoch UTC de uma data/hora, sem depender do fuso da máquina. */
function utc(ano: number, mes: number, dia: number, hora = 0, minuto = 0): number {
  return Math.floor(Date.UTC(ano, mes - 1, dia, hora, minuto, 0) / 1000);
}

/** Um pregão da B3 em barras de 5 min: 09:00 → 18:25 BRT, ou seja 12:00 → 21:25 UTC. */
function pregao(ano: number, mes: number, dia: number): number[] {
  const inicio = utc(ano, mes, dia, 12, 0);
  return Array.from({ length: 114 }, (_, i) => inicio + i * 300);
}

describe('unidadeAutomaticaDeSeparador', () => {
  it('intradiário marca DIA', () => {
    for (const p of [60, 120, 300, 900, 3600, 4 * 3600]) {
      expect(unidadeAutomaticaDeSeparador(p), `${p}s`).toBe('DIA');
    }
  });

  it('diário marca MÊS — uma linha por vela não é grade, é apagar o gráfico', () => {
    expect(unidadeAutomaticaDeSeparador(86_400)).toBe('MES');
  });

  it('acima de um dia marca ANO', () => {
    expect(unidadeAutomaticaDeSeparador(7 * 86_400)).toBe('ANO');
    expect(unidadeAutomaticaDeSeparador(30 * 86_400)).toBe('ANO');
  });

  it('entrada inutilizável cai em DIA, sem lançar', () => {
    expect(unidadeAutomaticaDeSeparador(Number.NaN)).toBe('DIA');
    expect(unidadeAutomaticaDeSeparador(0)).toBe('DIA');
    expect(unidadeAutomaticaDeSeparador(-300)).toBe('DIA');
  });
});

describe('passoMedianoEmSegundos', () => {
  it('acha o passo de uma série regular', () => {
    expect(passoMedianoEmSegundos(pregao(2026, 9, 16))).toBe(300);
  });

  it('⭐ IGNORA o salto do fim de semana — é por isso que é mediana e não média', () => {
    // Dois pregões de sexta e segunda: entre eles há ~62 h de intervalo. A média daria ~2.900 s
    // e a unidade automática cairia em MÊS num gráfico de 5 min.
    const serie = [...pregao(2026, 9, 11), ...pregao(2026, 9, 14)];
    expect(passoMedianoEmSegundos(serie)).toBe(300);
    expect(unidadeAutomaticaDeSeparador(passoMedianoEmSegundos(serie) as number)).toBe('DIA');
  });

  it('série curta não inventa passo', () => {
    expect(passoMedianoEmSegundos([])).toBeNull();
    expect(passoMedianoEmSegundos([1000])).toBeNull();
  });

  it('tempo não crescente é descartado em vez de virar passo negativo', () => {
    expect(passoMedianoEmSegundos([1000, 1000, 1300, 1600])).toBe(300);
  });
});

describe('separadoresDePeriodo — a POSIÇÃO é o que importa', () => {
  it('⭐⭐ marca a PRIMEIRA barra de cada pregão, e não a primeira da série', () => {
    const serie = [...pregao(2026, 9, 14), ...pregao(2026, 9, 15), ...pregao(2026, 9, 16)];
    const sep = separadoresDePeriodo(serie, { timeZone: BRT });
    // Três dias ⇒ DUAS linhas: a primeira barra da série abre um dia, mas não há nada antes dela
    // para separar, e uma linha na borda esquerda parece moldura do gráfico.
    expect(sep).toEqual([114, 228]);
    // E cada índice é exatamente a abertura, 09:00 BRT = 12:00 UTC.
    for (const i of sep) {
      const t = serie[i] as number;
      expect((t - utc(2026, 1, 1)) % 86_400).toBe(12 * 3600 - ((utc(2026, 1, 1) % 86_400) % 86_400));
    }
  });

  it('⭐⭐⭐ a virada é no fuso do MERCADO — em UTC a linha cairia DENTRO do pregão anterior', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // O DEFEITO QUE ESTE TESTE IMPEDE
    // ═══════════════════════════════════════════════════════════════════════
    //
    // O pregão do WIN vai de 12:00 a 21:25 UTC (09:00–18:25 BRT). A meia-noite UTC cai no MEIO
    // de nada — mas a meia-noite de Brasília é 03:00 UTC, e um cálculo em UTC colocaria a virada
    // de dia às 00:00 UTC, ou seja **21:00 BRT do dia anterior**. Numa série que atravessa dias
    // isso desloca a linha para dentro do pregão que acabou.
    //
    // ⭐ Aqui a prova é direta: com o fuso do mercado a linha cai na barra 114 (abertura do dia
    // seguinte). Com UTC ela cairia no mesmo lugar NESTA série (porque não há barra entre 21:25 e
    // 12:00), então o teste usa uma série que TEM barra na madrugada — o caso de um mercado 24 h,
    // ou de dado residual como as barras de 21:35 medidas no arquivo.
    const serie = [
      utc(2026, 9, 15, 21, 0), // 18:00 BRT do dia 15
      utc(2026, 9, 15, 23, 0), // 20:00 BRT do dia 15  ⇠ ainda dia 15 em BRT, JÁ dia 16 em… não
      utc(2026, 9, 16, 1, 0), // 22:00 BRT do dia 15  ⇠ mas 01:00 UTC do dia 16!
      utc(2026, 9, 16, 4, 0), // 01:00 BRT do dia 16
      utc(2026, 9, 16, 12, 0), // 09:00 BRT do dia 16
    ];
    // Em BRT o dia vira entre o índice 2 (22:00 do dia 15) e o 3 (01:00 do dia 16).
    expect(separadoresDePeriodo(serie, { timeZone: BRT })).toEqual([3]);
    // Em UTC viraria entre o índice 1 e o 2 — uma barra ANTES, e às 22:00 BRT do dia anterior.
    expect(separadoresDePeriodo(serie, { timeZone: 'UTC' })).toEqual([2]);
  });

  it('SEMANA começa na SEGUNDA', () => {
    // 11/09/2026 é sexta, 12 sábado, 14 segunda. Uma série de sexta + segunda tem uma virada.
    const serie = [
      utc(2026, 9, 10, 12, 0), // quinta
      utc(2026, 9, 11, 12, 0), // sexta
      utc(2026, 9, 14, 12, 0), // segunda ⇠ semana nova
      utc(2026, 9, 15, 12, 0), // terça
    ];
    expect(separadoresDePeriodo(serie, { unidade: 'SEMANA', timeZone: BRT })).toEqual([2]);
  });

  it('MES e ANO marcam a virada do calendário', () => {
    const serie = [
      utc(2026, 9, 30, 12, 0),
      utc(2026, 10, 1, 12, 0), // mês novo
      utc(2026, 12, 31, 12, 0),
      utc(2027, 1, 4, 12, 0), // mês E ano novos
    ];
    expect(separadoresDePeriodo(serie, { unidade: 'MES', timeZone: BRT })).toEqual([1, 2, 3]);
    expect(separadoresDePeriodo(serie, { unidade: 'ANO', timeZone: BRT })).toEqual([3]);
  });

  it('⭐ `auto` num diário marca MÊS, não DIA', () => {
    // 70 dias corridos de barras diárias, de 01/09/2026. Com DIA seriam 69 linhas — uma por vela.
    const serie = Array.from({ length: 70 }, (_, i) => utc(2026, 9, 1, 12, 0) + i * 86_400);
    const auto = separadoresDePeriodo(serie, { timeZone: BRT });
    const porDia = separadoresDePeriodo(serie, { unidade: 'DIA', timeZone: BRT });
    expect(porDia).toHaveLength(69);
    // 01/09 + 69 dias = 09/11: viradas em 01/10 e 01/11.
    expect(auto).toHaveLength(2);
  });

  it('⚠️ série curta ou vazia devolve `[]`, nunca `null` e nunca lança', () => {
    expect(separadoresDePeriodo([])).toEqual([]);
    expect(separadoresDePeriodo([utc(2026, 9, 16, 12, 0)])).toEqual([]);
  });

  it('⚠️ um tempo corrompido no meio não apaga as marcas do resto', () => {
    const serie = [
      utc(2026, 9, 15, 12, 0),
      Number.NaN, // barra com tempo irresolvível
      utc(2026, 9, 16, 12, 0),
      utc(2026, 9, 17, 12, 0),
    ];
    // ⚠️ Unidade EXPLÍCITA, e a razão é o que a primeira escrita deste teste revelou: com `'auto'`
    // o `NaN` invalida duas das três diferenças, a mediana sobra 86.400 s e a unidade cai em MÊS —
    // aí as três barras válidas são todas de setembro e o resultado correto é `[]`. Comportamento
    // certo, teste medindo outra coisa. Aqui o que se afere é a RESILIÊNCIA da varredura.
    expect(separadoresDePeriodo(serie, { unidade: 'DIA', timeZone: BRT })).toEqual([2, 3]);
  });

  it('⚠️ fuso inválido não lança — degrada para nenhum separador', () => {
    const serie = [...pregao(2026, 9, 15), ...pregao(2026, 9, 16)];
    expect(() => separadoresDePeriodo(serie, { timeZone: 'Nao/Existe' })).not.toThrow();
    expect(separadoresDePeriodo(serie, { timeZone: 'Nao/Existe' })).toEqual([]);
  });

  it('um pregão só não tem separador — não há período anterior', () => {
    expect(separadoresDePeriodo(pregao(2026, 9, 16), { timeZone: BRT })).toEqual([]);
  });

  it('desempenho: série longa resolve em tempo aceitável', () => {
    // ⭐ Medido e impresso, com limite FOLGADO: a resolução é por barra
    // (`Intl.DateTimeFormat`), e é justamente por causa deste custo que o motor memoiza em vez de
    // recalcular por quadro. O objetivo é reprovar regressão de ORDEM DE GRANDEZA.
    const serie: number[] = [];
    for (let d = 0; d < 60; d += 1) serie.push(...pregao(2026, 7, 1).map((t) => t + d * 86_400));
    const t0 = Date.now();
    const sep = separadoresDePeriodo(serie, { timeZone: BRT });
    const ms = Date.now() - t0;
    console.log(`separadores: ${serie.length} barras em ${ms} ms (${sep.length} linhas)`);
    expect(sep.length).toBeGreaterThan(50);
    expect(ms).toBeLessThan(4000);
  });
});
