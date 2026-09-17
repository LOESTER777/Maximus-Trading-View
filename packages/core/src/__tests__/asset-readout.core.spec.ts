/**
 * A leitura do ativo: desempenho, sazonalidade e termômetro.
 *
 * ⭐ O que estes testes travam não é a aritmética (ela é trivial), são as três decisões que
 * fazem os números serem verdade:
 *
 *  1. janela de CALENDÁRIO e não de posição — 30 barras diárias são ~43 dias corridos;
 *  2. `null` para janela sem histórico — zero afirmaria "não variou";
 *  3. no termômetro, `NEUTRO` dilui e `null` não conta — indicador aquecendo não votou.
 */
import { describe, expect, it } from 'vitest';
import {
  desempenhoPorJanela,
  sazonalidadePorAno,
  termometroTecnico,
  votoDeMedia,
  votoDeOscilador,
  type BarraDeLeitura,
} from '../asset-readout.core.js';

const DIA = 86_400;
/** 2026-09-16T00:00:00Z */
const AGORA = 1_789_516_800;

/** Série diária terminando em `AGORA`, com fechamento crescente por `passo`. */
function serieDiaria(dias: number, primeiro: number, passo: number): BarraDeLeitura[] {
  const out: BarraDeLeitura[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    out.push({ time: AGORA - i * DIA, close: primeiro + (dias - 1 - i) * passo });
  }
  return out;
}

describe('desempenhoPorJanela — calendário, e `null` quando não sei', () => {
  it('calcula a variação de cada janela a partir do fechamento', () => {
    // 400 dias, de 100 subindo 1 por dia ⇒ último = 499.
    const bars = serieDiaria(400, 100, 1);
    const r = desempenhoPorJanela(bars, AGORA);
    const porJanela = new Map(r.map((x) => [x.janela, x]));

    const umaSemana = porJanela.get('1S')!;
    // 7 dias atrás o fechamento era 492 ⇒ (499−492)/492.
    expect(umaSemana.variacao).toBeCloseTo(((499 - 492) / 492) * 100, 6);
    expect(umaSemana.desde).toBe(AGORA - 7 * DIA);

    const umAno = porJanela.get('1A')!;
    expect(umAno.variacao).toBeCloseTo(((499 - 134) / 134) * 100, 6);
  });

  it('⭐ a janela é de CALENDÁRIO, não de posição', () => {
    // Série com BURACOS (fim de semana): 20 barras espalhadas por 40 dias.
    const bars: BarraDeLeitura[] = [];
    for (let i = 39; i >= 0; i -= 2) bars.push({ time: AGORA - i * DIA, close: 100 + (40 - i) });
    const r = desempenhoPorJanela(bars, AGORA);
    const umaSemana = r.find((x) => x.janela === '1S')!;

    // ⚠️ Contar 7 POSIÇÕES pegaria uma barra de 14 dias atrás — um "1 semana" que mede duas.
    expect(umaSemana.desde).not.toBeNull();
    expect(AGORA - umaSemana.desde!).toBeLessThanOrEqual(8 * DIA);
  });

  it('⭐⭐ janela sem histórico devolve `null`, nunca zero', () => {
    // Três meses de série: a janela de 1 ano não tem como ser respondida.
    const bars = serieDiaria(90, 100, 1);
    const r = desempenhoPorJanela(bars, AGORA);
    const umAno = r.find((x) => x.janela === '1A')!;
    // ⚠️ Zero diria "o ano foi estável" num ativo que só tem 90 dias de vida.
    expect(umAno.variacao).toBeNull();
    expect(umAno.desde).toBeNull();
    // E a janela que CABE continua respondida.
    expect(r.find((x) => x.janela === '1M')!.variacao).not.toBeNull();
  });

  it('⭐ `ANO` é o ano CIVIL corrente, não 365 dias', () => {
    // 3 de janeiro: "no ano" são dois dias, não doze meses.
    const tresDeJaneiro = Date.UTC(2026, 0, 3) / 1000;
    const bars: BarraDeLeitura[] = [
      { time: Date.UTC(2025, 11, 20) / 1000, close: 100 },
      { time: Date.UTC(2026, 0, 1) / 1000, close: 200 },
      { time: tresDeJaneiro, close: 220 },
    ];
    const r = desempenhoPorJanela(bars, tresDeJaneiro);
    const ano = r.find((x) => x.janela === 'ANO')!;
    // Base é 1º de janeiro (200), não o fechamento de dezembro (100).
    expect(ano.variacao).toBeCloseTo(10, 6);
    expect(ano.desde).toBe(Date.UTC(2026, 0, 1) / 1000);
  });

  it('série cuja janela cabe numa barra só devolve `null`', () => {
    // ⚠️ A primeira barra tem de ser ANTERIOR ao limite de 1 ano (365 d + tolerância),
    // senão a janela é recusada — e recusar é o certo: 300 dias não são um ano. Este teste
    // nasceu com 300 dias e a asserção estava errada, não o código.
    const bars: BarraDeLeitura[] = [
      { time: AGORA - 380 * DIA, close: 100 },
      { time: AGORA, close: 150 },
    ];
    const r = desempenhoPorJanela(bars, AGORA);
    // A barra de início da janela de 1 semana É a última — não há variação a medir.
    expect(r.find((x) => x.janela === '1S')!.variacao).toBeNull();
    expect(r.find((x) => x.janela === '1A')!.variacao).toBeCloseTo(50, 6);
  });

  it('⭐ série que não ALCANÇA o limite recusa a janela — 300 dias não são um ano', () => {
    const bars: BarraDeLeitura[] = [
      { time: AGORA - 300 * DIA, close: 100 },
      { time: AGORA, close: 150 },
    ];
    const r = desempenhoPorJanela(bars, AGORA);
    // Medir 300 dias e rotular "1 ano" produziria um número plausível de outra pergunta.
    expect(r.find((x) => x.janela === '1A')!.variacao).toBeNull();
    // E as janelas que a série CABE continuam respondidas.
    expect(r.find((x) => x.janela === '6M')!.variacao).toBeCloseTo(50, 6);
  });

  it('a tolerância aceita a primeira barra alguns dias depois do limite', () => {
    // Fim de semana e feriado fazem a primeira barra raramente cair no dia exato. Sem
    // tolerância, quase toda série real recusaria a janela de 1 mês por 1 ou 2 dias.
    const bars: BarraDeLeitura[] = [
      { time: AGORA - 29 * DIA, close: 100 },
      { time: AGORA, close: 110 },
    ];
    expect(desempenhoPorJanela(bars, AGORA).find((x) => x.janela === '1M')!.variacao).toBeCloseTo(
      10,
      6,
    );
  });

  it('entrada degenerada não lança e devolve tudo `null`', () => {
    for (const bars of [[], [{ time: AGORA, close: 10 }]]) {
      const r = desempenhoPorJanela(bars, AGORA);
      expect(r).toHaveLength(6);
      expect(r.every((x) => x.variacao === null)).toBe(true);
    }
    expect(desempenhoPorJanela(serieDiaria(10, 100, 1), Number.NaN).every((x) => x.variacao === null)).toBe(
      true,
    );
    // Fechamento zero na última barra não divide por zero em silêncio.
    expect(
      desempenhoPorJanela([{ time: AGORA - DIA, close: 5 }, { time: AGORA, close: 0 }], AGORA).every(
        (x) => x.variacao === null,
      ),
    ).toBe(true);
  });
});

describe('sazonalidadePorAno — o que se compara é o CAMINHO', () => {
  it('⭐⭐ normaliza cada ano para partir de ZERO', () => {
    const bars: BarraDeLeitura[] = [
      { time: Date.UTC(2025, 0, 2) / 1000, close: 100 },
      { time: Date.UTC(2025, 5, 2) / 1000, close: 110 },
      { time: Date.UTC(2026, 0, 2) / 1000, close: 1000 },
      { time: Date.UTC(2026, 5, 2) / 1000, close: 1100 },
    ];
    const r = sazonalidadePorAno(bars, 2);
    expect(r.map((a) => a.ano)).toEqual([2025, 2026]);
    // ⭐ Níveis de preço muito diferentes (100 e 1000) produzem o MESMO caminho: +10%. Sem
    // normalizar, seriam duas linhas paralelas empilhadas por nível, sem informação.
    expect(r[0]!.pontos[0]!.acumulado).toBe(0);
    expect(r[1]!.pontos[0]!.acumulado).toBe(0);
    expect(r[0]!.pontos[1]!.acumulado).toBeCloseTo(10, 6);
    expect(r[1]!.pontos[1]!.acumulado).toBeCloseTo(10, 6);
  });

  it('o eixo é DIA DO ANO, para os anos se alinharem', () => {
    const bars: BarraDeLeitura[] = [
      { time: Date.UTC(2026, 0, 1) / 1000, close: 100 },
      { time: Date.UTC(2026, 1, 1) / 1000, close: 105 },
    ];
    const r = sazonalidadePorAno(bars, 1);
    expect(r[0]!.pontos.map((p) => p.dia)).toEqual([1, 32]);
  });

  it('devolve do mais ANTIGO para o mais recente, e respeita o limite de anos', () => {
    const bars: BarraDeLeitura[] = [];
    for (const ano of [2022, 2023, 2024, 2025, 2026]) {
      bars.push({ time: Date.UTC(ano, 0, 2) / 1000, close: 100 });
      bars.push({ time: Date.UTC(ano, 6, 2) / 1000, close: 120 });
    }
    // Os 3 mais recentes, na ordem de desenho (o corrente por cima).
    expect(sazonalidadePorAno(bars, 3).map((a) => a.ano)).toEqual([2024, 2025, 2026]);
  });

  it('ano com UMA barra é descartado — não há caminho a traçar', () => {
    const bars: BarraDeLeitura[] = [
      { time: Date.UTC(2025, 0, 2) / 1000, close: 100 },
      { time: Date.UTC(2026, 0, 2) / 1000, close: 100 },
      { time: Date.UTC(2026, 3, 2) / 1000, close: 110 },
    ];
    expect(sazonalidadePorAno(bars, 5).map((a) => a.ano)).toEqual([2026]);
  });

  it('entrada vazia e pedido de zero anos devolvem vazio, sem lançar', () => {
    expect(sazonalidadePorAno([], 3)).toEqual([]);
    expect(sazonalidadePorAno(serieDiaria(10, 100, 1), 0)).toEqual([]);
    expect(sazonalidadePorAno(serieDiaria(10, 100, 1), -1)).toEqual([]);
  });
});

describe('termometroTecnico — `NEUTRO` dilui, `null` não conta', () => {
  it('unanimidade de compra é compra forte', () => {
    const r = termometroTecnico(['COMPRA', 'COMPRA', 'COMPRA']);
    expect(r.escore).toBe(1);
    expect(r.leitura).toBe('COMPRA_FORTE');
    expect(r.votantes).toBe(3);
  });

  it('⭐⭐ `NEUTRO` entra no denominador e `null` NÃO', () => {
    // 2 compras + 2 neutros = escore 0,5 (compra forte, no limite).
    const comNeutro = termometroTecnico(['COMPRA', 'COMPRA', 'NEUTRO', 'NEUTRO']);
    expect(comNeutro.votantes).toBe(4);
    expect(comNeutro.escore).toBeCloseTo(0.5, 6);

    // Os mesmos 2 votos com 2 indicadores AQUECENDO: eles não olharam, não diluem.
    const comNulo = termometroTecnico(['COMPRA', 'COMPRA', null, null]);
    expect(comNulo.votantes).toBe(2);
    expect(comNulo.escore).toBe(1);
    // ⚠️ Contar `null` empurraria a leitura ao centro por uma razão que não é o mercado.
    expect(comNulo.escore).toBeGreaterThan(comNeutro.escore);
  });

  it('empate entre compra e venda é neutro, e a contagem é preservada', () => {
    const r = termometroTecnico(['COMPRA', 'VENDA', 'COMPRA', 'VENDA']);
    expect(r.escore).toBe(0);
    expect(r.leitura).toBe('NEUTRO');
    expect(r.compras).toBe(2);
    expect(r.vendas).toBe(2);
  });

  it('⚠️ ZERO votantes é neutro por AUSÊNCIA, e isso aparece no retorno', () => {
    const r = termometroTecnico([null, null]);
    expect(r.leitura).toBe('NEUTRO');
    // Quem mostra tem de poder dizer "nenhum indicador ativo" em vez de exibir um
    // diagnóstico que não existe.
    expect(r.votantes).toBe(0);
    expect(termometroTecnico([]).votantes).toBe(0);
  });

  it('as cinco faixas saem nos limites declarados', () => {
    // 1 de 10 = 0,1 ⇒ neutro; 2 de 10 = 0,2 ⇒ compra; 5 de 10 = 0,5 ⇒ compra forte.
    const dez = (compras: number): ReturnType<typeof termometroTecnico> =>
      termometroTecnico([
        ...Array.from({ length: compras }, () => 'COMPRA' as const),
        ...Array.from({ length: 10 - compras }, () => 'NEUTRO' as const),
      ]);
    expect(dez(1).leitura).toBe('NEUTRO');
    expect(dez(2).leitura).toBe('COMPRA');
    expect(dez(5).leitura).toBe('COMPRA_FORTE');
    const vendas = (n: number): ReturnType<typeof termometroTecnico> =>
      termometroTecnico([
        ...Array.from({ length: n }, () => 'VENDA' as const),
        ...Array.from({ length: 10 - n }, () => 'NEUTRO' as const),
      ]);
    expect(vendas(2).leitura).toBe('VENDA');
    expect(vendas(5).leitura).toBe('VENDA_FORTE');
  });
});

describe('votos — a convenção de mesa, e o ruído que a tolerância remove', () => {
  it('⚠️ sobrecomprado é voto de VENDA (a convenção consagrada)', () => {
    expect(votoDeOscilador(78)).toBe('VENDA');
    expect(votoDeOscilador(22)).toBe('COMPRA');
    expect(votoDeOscilador(50)).toBe('NEUTRO');
  });

  it('oscilador aquecendo não vota', () => {
    expect(votoDeOscilador(null)).toBeNull();
    expect(votoDeOscilador(Number.NaN)).toBeNull();
  });

  it('as faixas do oscilador são ajustáveis (MFI usa 20/80)', () => {
    expect(votoDeOscilador(25, 20, 80)).toBe('NEUTRO');
    expect(votoDeOscilador(85, 20, 80)).toBe('VENDA');
  });

  it('preço encostado na média é NEUTRO, não sinal', () => {
    // Sem a tolerância, o voto piscaria entre compra e venda a cada tick numa lateralização
    // — e termômetro que oscila por ruído é ignorado.
    expect(votoDeMedia(100.05, 100)).toBe('NEUTRO');
    expect(votoDeMedia(101, 100)).toBe('COMPRA');
    expect(votoDeMedia(99, 100)).toBe('VENDA');
  });

  it('média ausente ou zero não vota', () => {
    expect(votoDeMedia(100, null)).toBeNull();
    expect(votoDeMedia(null, 100)).toBeNull();
    expect(votoDeMedia(100, 0)).toBeNull();
  });
});
