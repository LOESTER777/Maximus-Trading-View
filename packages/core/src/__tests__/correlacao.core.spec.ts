/**
 * Comparar dois ativos: base 100 e correlação de RETORNOS.
 *
 * ⭐ Três decisões, e as três mudam o número que aparece na tela:
 *
 *  1. base 100 — sobrepor preço de WIN (188.000) e PETR4 (38) daria uma linha e um risco;
 *  2. alinhar por TEMPO — parear por posição compararia terça de um com quarta do outro;
 *  3. correlacionar RETORNO e não PREÇO — dois ativos que subiram no ano dão ~1 mesmo que um
 *     tenha subido em janeiro e o outro em dezembro.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_AMOSTRAS_CORRELACAO,
  alinharPorTempo,
  correlacaoDeRetornos,
  leituraDeCorrelacao,
  normalizarBase100,
  type BarraComparavel,
} from '../correlacao.core.js';

const DIA = 86_400;
const T0 = 1_700_000_000;

/** Série com fechamentos dados, uma barra por dia. */
function serie(closes: readonly number[], passo = DIA, inicio = T0): BarraComparavel[] {
  return closes.map((close, i) => ({ time: inicio + i * passo, close }));
}

describe('normalizarBase100 — o que torna a comparação possível', () => {
  it('⭐⭐ dois ativos de PREÇO muito diferente ficam comparáveis', () => {
    const win = normalizarBase100(serie([188_000, 190_820]));
    const petr = normalizarBase100(serie([38, 38.57]));
    // +1,5% nos dois ⇒ o MESMO caminho, apesar de 5 ordens de magnitude de diferença.
    expect(win[0]!.valor).toBe(100);
    expect(petr[0]!.valor).toBe(100);
    expect(win[1]!.valor).toBeCloseTo(101.5, 4);
    expect(petr[1]!.valor).toBeCloseTo(101.5, 1);
  });

  it('preserva o tempo de cada ponto', () => {
    const r = normalizarBase100(serie([10, 11, 12]));
    expect(r.map((p) => p.time)).toEqual([T0, T0 + DIA, T0 + 2 * DIA]);
  });

  it('⚠️ base zero ou não finita devolve VAZIO, nunca `Infinity`', () => {
    // Dividir por ela produziria coordenadas que o canvas não pinta, e o operador veria uma
    // das duas linhas desaparecer sem explicação.
    expect(normalizarBase100(serie([0, 10]))).toEqual([]);
    expect(normalizarBase100(serie([Number.NaN, 10]))).toEqual([]);
    expect(normalizarBase100([])).toEqual([]);
  });

  it('ponto com fechamento inválido no MEIO é pulado, o resto sobrevive', () => {
    const r = normalizarBase100([
      { time: T0, close: 100 },
      { time: T0 + DIA, close: Number.NaN },
      { time: T0 + 2 * DIA, close: 110 },
    ]);
    // `toBeCloseTo` e não `toEqual`: 110/100*100 dá 110.00000000000001 em ponto flutuante, e
    // arredondar no núcleo esconderia precisão de quem desenha.
    expect(r).toHaveLength(2);
    expect(r[0]!.valor).toBe(100);
    expect(r[1]!.valor).toBeCloseTo(110, 9);
  });
});

describe('alinharPorTempo — parear por instante, não por posição', () => {
  it('⭐⭐ só os instantes que existem NAS DUAS entram', () => {
    // Feriado de um mercado não é do outro. Pareando por posição, o retorno de terça de um
    // seria comparado com o de quarta do outro — número plausível medindo coisa nenhuma.
    const a = serie([10, 11, 12, 13]); // T0, T0+1d, T0+2d, T0+3d
    const b = [
      { time: T0, close: 100 },
      { time: T0 + 2 * DIA, close: 120 }, // faltou o dia 1
      { time: T0 + 3 * DIA, close: 130 },
    ];
    const pares = alinharPorTempo(a, b);
    expect(pares.map((p) => p.time)).toEqual([T0, T0 + 2 * DIA, T0 + 3 * DIA]);
    expect(pares[1]).toEqual({ time: T0 + 2 * DIA, a: 12, b: 120 });
  });

  it('devolve em ordem crescente de tempo mesmo com entrada desordenada', () => {
    const a = [
      { time: T0 + DIA, close: 2 },
      { time: T0, close: 1 },
    ];
    const b = [
      { time: T0, close: 10 },
      { time: T0 + DIA, close: 20 },
    ];
    expect(alinharPorTempo(a, b).map((p) => p.time)).toEqual([T0, T0 + DIA]);
  });

  it('tempo repetido: a primeira ocorrência vence', () => {
    const a = [
      { time: T0, close: 1 },
      { time: T0, close: 999 },
    ];
    const b = [{ time: T0, close: 10 }];
    const pares = alinharPorTempo(a, b);
    expect(pares).toHaveLength(1);
    expect(pares[0]!.a).toBe(1);
  });

  it('sem interseção devolve vazio', () => {
    expect(alinharPorTempo(serie([1, 2]), serie([1, 2], DIA, T0 + 999 * DIA))).toEqual([]);
  });
});

describe('correlacaoDeRetornos', () => {
  /** Série de n barras com retorno diário constante. */
  function comRetorno(n: number, taxa: number, base = 100): BarraComparavel[] {
    const closes: number[] = [base];
    for (let i = 1; i < n; i++) closes.push(closes[i - 1]! * (1 + taxa));
    return serie(closes);
  }

  it('⭐ séries que sobem e descem JUNTAS dão coeficiente perto de +1', () => {
    const a: BarraComparavel[] = [];
    const b: BarraComparavel[] = [];
    let pa = 100;
    let pb = 50;
    for (let i = 0; i < 60; i++) {
      // Retorno idêntico nas duas, alternando de sinal para haver variância.
      const r = i % 2 === 0 ? 0.01 : -0.008;
      pa *= 1 + r;
      pb *= 1 + r;
      a.push({ time: T0 + i * DIA, close: pa });
      b.push({ time: T0 + i * DIA, close: pb });
    }
    const r = correlacaoDeRetornos(a, b);
    expect(r.coeficiente).not.toBeNull();
    expect(r.coeficiente!).toBeCloseTo(1, 6);
    expect(r.leitura).toContain('Forte');
    expect(r.leitura).toContain('a favor');
  });

  it('⭐ retornos OPOSTOS dão perto de −1, e a leitura diz "inversa"', () => {
    const a: BarraComparavel[] = [];
    const b: BarraComparavel[] = [];
    let pa = 100;
    let pb = 100;
    for (let i = 0; i < 60; i++) {
      const r = i % 2 === 0 ? 0.01 : -0.01;
      pa *= 1 + r;
      pb *= 1 - r;
      a.push({ time: T0 + i * DIA, close: pa });
      b.push({ time: T0 + i * DIA, close: pb });
    }
    const r = correlacaoDeRetornos(a, b);
    expect(r.coeficiente!).toBeLessThan(-0.9);
    expect(r.leitura).toContain('inversa');
  });

  it('⭐⭐ RETORNO e não PREÇO: duas altas em MESES DIFERENTES não são correlacionadas', () => {
    // A correlação espúria clássica. Em preço, as duas séries sobem no período e Pearson daria
    // quase 1 — mas uma subiu na primeira metade e a outra na segunda, e num dia qualquer o
    // movimento de uma não diz nada sobre o da outra.
    const a: BarraComparavel[] = [];
    const b: BarraComparavel[] = [];
    let pa = 100;
    let pb = 100;
    for (let i = 0; i < 60; i++) {
      // `a` sobe só na primeira metade; `b` só na segunda.
      pa *= 1 + (i < 30 ? 0.01 : 0);
      pb *= 1 + (i < 30 ? 0 : 0.01);
      a.push({ time: T0 + i * DIA, close: pa });
      b.push({ time: T0 + i * DIA, close: pb });
    }
    const r = correlacaoDeRetornos(a, b);
    expect(r.coeficiente).not.toBeNull();
    // Retorno de uma é zero quando o da outra não é ⇒ correlação NEGATIVA ou perto de zero,
    // nunca a quase-1 que o preço daria.
    expect(r.coeficiente!).toBeLessThan(0.2);
  });

  it('⚠️ amostra pequena devolve `null`, não um número forte por acaso', () => {
    // Pearson com 3 pontos produz 0,98 facilmente, e número forte com amostra fraca é pior que
    // número nenhum: parece evidência.
    const r = correlacaoDeRetornos(comRetorno(5, 0.01), comRetorno(5, 0.01, 50));
    expect(r.coeficiente).toBeNull();
    expect(r.amostras).toBeLessThan(MIN_AMOSTRAS_CORRELACAO);
    expect(r.leitura).toContain('insuficiente');
  });

  it('⚠️ série CONSTANTE devolve `null` — variância zero não tem correlação', () => {
    // Acontece de verdade: um ativo que não negociou no período tem fechamento repetido.
    const constante = serie(Array.from({ length: 40 }, () => 100));
    const variando = comRetorno(40, 0.01);
    const r = correlacaoDeRetornos(variando, constante);
    expect(r.coeficiente).toBeNull();
    expect(r.leitura).toContain('sem variação');
  });

  it('conta as amostras de RETORNO (uma a menos que os pares)', () => {
    const a = comRetorno(41, 0.01);
    const b = comRetorno(41, -0.005, 20);
    const r = correlacaoDeRetornos(a, b);
    expect(r.amostras).toBe(40);
  });

  it('séries sem interseção devolvem `null` sem lançar', () => {
    const r = correlacaoDeRetornos(comRetorno(40, 0.01), serie([1, 2, 3], DIA, T0 + 5000 * DIA));
    expect(r.coeficiente).toBeNull();
    expect(r.amostras).toBe(0);
  });

  it('o coeficiente nunca escapa de [-1, 1]', () => {
    const a = comRetorno(100, 0.013);
    const r = correlacaoDeRetornos(a, a);
    // Erro de ponto flutuante devolveria 1.0000000000000002, e >1 na tela destrói a confiança
    // no número inteiro.
    expect(r.coeficiente!).toBeLessThanOrEqual(1);
    expect(r.coeficiente!).toBeGreaterThanOrEqual(-1);
  });
});

describe('leituraDeCorrelacao — o sinal aparece no TEXTO', () => {
  it('as quatro faixas, com sentido', () => {
    expect(leituraDeCorrelacao(0.9)).toBe('Forte, a favor');
    expect(leituraDeCorrelacao(-0.9)).toBe('Forte, inversa');
    expect(leituraDeCorrelacao(0.5)).toBe('Moderada, a favor');
    expect(leituraDeCorrelacao(-0.2)).toBe('Fraca, inversa');
    expect(leituraDeCorrelacao(0.05)).toBe('Sem relação clara');
  });

  it('⚠️ "forte" sozinho seria a metade errada da informação', () => {
    // Forte a favor e forte inversa levam a decisões OPOSTAS de hedge.
    expect(leituraDeCorrelacao(0.8)).not.toBe(leituraDeCorrelacao(-0.8));
  });
});
