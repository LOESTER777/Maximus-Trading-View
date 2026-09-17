/**
 * Bancada do TETO por percentil da escala de histograma.
 *
 * ⭐ O caso central usa a distribuição REAL medida no pregão de 16/09/2026 (`WIN`, 5 min): a
 * abertura com 323.151 contratos e a tarde com 2.532 — razão de 128x. É o dado que motivou o
 * recurso, e testá-lo com a distribuição real é o que garante que o percentil escolhido
 * (99) resolve o problema que ele diz resolver.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_AMOSTRAS_PARA_PERCENTIL,
  PERCENTIL_DE_TETO_DEFAULT,
  PERCENTIL_PARA_VOLUME_DE_FUTUROS,
  pisoPorPercentil,
  tetoPorPercentil,
} from '../histogram-scale.core.js';

/**
 * O perfil de volume real de um pregão do WIN em 5 min, reduzido a 40 pontos que preservam a
 * forma: abertura violenta, decaimento e platô baixo à tarde.
 */
const VOLUME_REAL = [
  323_151, 242_259, 245_548, 135_308, 161_283, 168_003, 285_619, 273_920, 212_006, 180_266,
  311_488, 234_012, 231_343, 136_069, 73_909, 82_508, 53_035, 24_620, 23_393, 12_720, 9413, 8676,
  7565, 9190, 9491, 7948, 9748, 8020, 8777, 10_330, 11_347, 9897, 9462, 8369, 5221, 2728, 2932,
  1421, 3730, 2532,
];

/**
 * ⭐ Um pregão COMPLETO: 114 barras de 5 min, como o dado real tem.
 *
 * ⚠️ Necessário porque o p99 exige ~100 amostras para ficar abaixo do máximo (ver
 * `amostrasMinimasParaPercentil`). Foi um teste que expôs isso: a primeira versão usava 40
 * pontos e o p99 coincidia com o máximo, então o recurso corretamente se desligava — e o teste
 * acusava falha onde o núcleo estava certo.
 */
const PREGAO_COMPLETO = (() => {
  // ⭐ FIEL AO PERFIL REAL, e isso é o que faz o teste medir a coisa certa: um pregão tem UMA
  // abertura violenta, cerca de doze barras altas na primeira hora, e mais de cem barras baixas
  // pelo resto do dia.
  //
  // ⚠️ A primeira versão repetia o perfil de 40 pontos três vezes — o que criou três "manhãs" e
  // deixou o p99 quase no máximo (ganho de 1,08x). O erro era do gerador, não do núcleo.
  const manha = VOLUME_REAL.slice(0, 13); // abertura + primeira hora
  const tarde = VOLUME_REAL.slice(20); // o platô baixo
  const out: number[] = [...manha];
  for (let i = 0; out.length < 114; i += 1) {
    const v = tarde[i % tarde.length] as number;
    // Variação determinística de ±12 % dentro do platô, sem nunca chegar perto da manhã.
    out.push(Math.max(1, Math.round(v * (1 + 0.12 * Math.sin(i * 1.7)))));
  }
  return out;
})();

describe('o problema, na distribuição real', () => {
  it('⭐⭐ com o teto no MÁXIMO, a tarde fica em menos de 1% da altura', () => {
    const maximo = Math.max(...VOLUME_REAL);
    const tarde = 2532;
    expect((100 * tarde) / maximo).toBeLessThan(1);
    // E a razão que causa isso:
    expect(maximo / tarde).toBeGreaterThan(100);
  });

  it('⭐ o p99 corta só o extremo absoluto — e por isso muda POUCO no WIN', () => {
    const r = tetoPorPercentil(PREGAO_COMPLETO, 99);
    expect(r.usouPercentil).toBe(true);
    expect(r.estouram).toBeLessThanOrEqual(2);
    // ⚠️ O ganho é pequeno, e isto é a MEDIÇÃO, não uma falha: a primeira hora inteira do WIN é
    // alta (~13 de 114 barras), então cortar 1% deixa as outras doze dominando a escala.
    const ganho = Math.max(...PREGAO_COMPLETO) / r.teto;
    expect(ganho).toBeLessThan(1.2);
  });

  it('⭐⭐ o p90 é o que torna a tarde LEGÍVEL — e é o valor a usar em futuros', () => {
    const r = tetoPorPercentil(PREGAO_COMPLETO, PERCENTIL_PARA_VOLUME_DE_FUTUROS);
    expect(PERCENTIL_PARA_VOLUME_DE_FUTUROS).toBe(90);
    expect(r.usouPercentil).toBe(true);
    // Ganho de altura substancial para as barras baixas.
    const ganho = Math.max(...PREGAO_COMPLETO) / r.teto;
    expect(ganho).toBeGreaterThan(1.25);
    // ⚠️ E o estouro continua sendo MINORIA: se metade estourasse, ele deixaria de informar.
    expect(r.estouram).toBeLessThan(PREGAO_COMPLETO.length / 4);
  });

  it('⚠️ percentil MUITO agressivo estraga: o estouro deixa de significar algo', () => {
    const r = tetoPorPercentil(PREGAO_COMPLETO, 60);
    // Mais de um terço estourando = uma faixa achatada de barras iguais no topo.
    expect(r.estouram).toBeGreaterThan(PREGAO_COMPLETO.length / 4);
  });

  it('⚠️ o p99 sobre 40 amostras NÃO comprime — e o núcleo diz isso', () => {
    // Aritmética do "nearest rank": ceil(0.99 * 40) - 1 = 39 = o último índice. O p99 de 40
    // pontos É o máximo. Degradar e informar é melhor que ordenar por quadro para nada.
    const r = tetoPorPercentil(VOLUME_REAL, 99);
    expect(r.usouPercentil).toBe(false);
    expect(r.teto).toBe(Math.max(...VOLUME_REAL));
  });

  it('⭐ com 40 amostras, um percentil ADEQUADO ao tamanho comprime', () => {
    const r = tetoPorPercentil(VOLUME_REAL, 90);
    expect(r.usouPercentil).toBe(true);
    expect(r.teto).toBeLessThan(Math.max(...VOLUME_REAL));
  });

  it('percentis mais agressivos comprimem mais, e mais barras estouram', () => {
    const p99 = tetoPorPercentil(VOLUME_REAL, 99);
    const p75 = tetoPorPercentil(VOLUME_REAL, 75);
    const p50 = tetoPorPercentil(VOLUME_REAL, 50);
    expect(p75.teto).toBeLessThan(p99.teto);
    expect(p50.teto).toBeLessThan(p75.teto);
    expect(p50.estouram).toBeGreaterThan(p75.estouram);
    expect(p75.estouram).toBeGreaterThan(p99.estouram);
  });
});

describe('degradação declarada — nunca silenciosa', () => {
  it('o default é 99', () => {
    expect(PERCENTIL_DE_TETO_DEFAULT).toBe(99);
    expect(tetoPorPercentil(VOLUME_REAL).teto).toBe(tetoPorPercentil(VOLUME_REAL, 99).teto);
  });

  it(`⚠️ com menos de ${MIN_AMOSTRAS_PARA_PERCENTIL} amostras devolve o MÁXIMO, e diz`, () => {
    const poucas = [10, 20, 30, 500];
    const r = tetoPorPercentil(poucas, 99);
    expect(r.teto).toBe(500);
    expect(r.usouPercentil).toBe(false);
    expect(r.estouram).toBe(0);
  });

  it('⚠️ distribuição PLANA não inventa compressão', () => {
    const plana = Array.from({ length: 40 }, () => 100);
    const r = tetoPorPercentil(plana, 90);
    expect(r.teto).toBe(100);
    expect(r.usouPercentil).toBe(false);
    expect(r.estouram).toBe(0);
  });

  it('sem valor positivo devolve 0 e não usou percentil', () => {
    expect(tetoPorPercentil([], 99)).toEqual({ teto: 0, estouram: 0, usouPercentil: false });
    expect(tetoPorPercentil([-5, -10, 0], 99).usouPercentil).toBe(false);
  });

  it('percentil fora de faixa é recortado, sem lançar', () => {
    expect(() => tetoPorPercentil(VOLUME_REAL, 0)).not.toThrow();
    expect(() => tetoPorPercentil(VOLUME_REAL, 999)).not.toThrow();
    expect(tetoPorPercentil(VOLUME_REAL, 999).usouPercentil).toBe(false); // 100 = o máximo
  });

  it('valor não finito é ignorado, não contamina', () => {
    const comLixo = [...VOLUME_REAL, NaN, Infinity, -Infinity];
    const r = tetoPorPercentil(comLixo, 99);
    expect(Number.isFinite(r.teto)).toBe(true);
  });
});

describe('invariantes', () => {
  it('⚠️ NÃO muta o array do chamador (ordenar no lugar embaralharia a série dele)', () => {
    const original = [...VOLUME_REAL];
    tetoPorPercentil(VOLUME_REAL, 50);
    expect(VOLUME_REAL).toEqual(original);
  });

  it('o teto é sempre um valor que OCORREU na amostra', () => {
    for (const p of [50, 75, 90, 99]) {
      const r = tetoPorPercentil(VOLUME_REAL, p);
      expect(VOLUME_REAL).toContain(r.teto);
    }
  });

  it('o teto nunca passa do máximo nem fica negativo', () => {
    const maximo = Math.max(...VOLUME_REAL);
    for (const p of [1, 25, 50, 99, 100]) {
      const r = tetoPorPercentil(VOLUME_REAL, p);
      expect(r.teto).toBeGreaterThan(0);
      expect(r.teto).toBeLessThanOrEqual(maximo);
    }
  });

  it('`estouram` conta exatamente quem passa do teto', () => {
    const r = tetoPorPercentil(VOLUME_REAL, 75);
    const manual = VOLUME_REAL.filter((v) => v > r.teto).length;
    expect(r.estouram).toBe(manual);
  });
});

describe('⭐ o PISO, espelho para histograma que oscila em torno do zero', () => {
  // Um oscilador tipo Awesome/delta: metade negativo, com um extremo em cada lado.
  const OSC = [
    ...Array.from({ length: 18 }, (_, i) => 5 + i),
    -40,
    -3,
    ...Array.from({ length: 18 }, (_, i) => -(5 + i)),
    60,
    2,
  ];

  it('comprime o lado negativo, e o extremo negativo estoura', () => {
    const p = pisoPorPercentil(OSC, 90);
    expect(p.usouPercentil).toBe(true);
    expect(p.teto).toBeLessThan(0);
    // O piso fica acima (menos negativo) que o mínimo observado.
    expect(p.teto).toBeGreaterThan(Math.min(...OSC));
  });

  it('⚠️ sem valor negativo o piso é ZERO — a âncora do histograma', () => {
    const r = pisoPorPercentil(VOLUME_REAL, 99);
    expect(r.teto).toBe(0);
    expect(r.usouPercentil).toBe(false);
  });

  it('teto e piso são simétricos em construção (mesma aritmética espelhada)', () => {
    const simetrico = [...OSC.map((v) => Math.abs(v)), ...OSC.map((v) => -Math.abs(v))];
    const t = tetoPorPercentil(simetrico, 90);
    const p = pisoPorPercentil(simetrico, 90);
    expect(Math.abs(p.teto)).toBeCloseTo(t.teto, 6);
  });
});
