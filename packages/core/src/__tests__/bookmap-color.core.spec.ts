/**
 * Testes unitários de **borda** da escala de cor — spec
 * `bookmap-no-mapa-de-decisao`, tarefa 2.8. Requisitos 2.2, 2.9, 2.10.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É — E O QUE ELE DELIBERADAMENTE NÃO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Teste **por exemplo**, com valores concretos e nomeados. Complementa — e não
 * duplica — as propriedades `p02` (monotonicidade da escala) e `p08` (robustez
 * a outlier fora da janela), que já cobrem o comportamento *universal* com
 * geradores. Aqui ficam as **bordas nomeadas**: amostra vazia, amostra sem
 * dispersão, zeros, o outlier medido, quantidade não finita e `ColorScale`
 * montada à mão com campo corrompido.
 *
 * A divisão de trabalho é intencional. Propriedade prova que *nenhuma* entrada
 * viola a regra; exemplo fixa em pedra o valor de retorno de um caso que o
 * operador consegue reconhecer, e é o que dá diagnóstico legível quando quebra.
 * Um gerador que sorteasse o par `(p50, p99)` da regressão de ponto flutuante
 * abaixo levaria muitas execuções para reencontrá-lo; o exemplo o encontra
 * sempre, na primeira.
 *
 * ── A REGRESSÃO QUE MOTIVOU METADE DESTE ARQUIVO ──────────────────────────
 *
 * `alphaOf` estourava o teto em **um ulp** e, ao fazê-lo, quebrava a própria
 * monotonicidade que existe para garantir. Dois fatos de ponto flutuante se
 * somam:
 *
 *   1. `Math.pow(t, gamma)` satura em `1` **exato** para `t` a poucos passos de
 *      precisão abaixo de 1, quando `gamma` é pequena.
 *   2. `alphaMin + (alphaMax − alphaMin)` **não** reconstrói `alphaMax`: com os
 *      defaults, `0,92 − 0,06 = 0,8600000000000001` e a soma de volta dá
 *      `0,9200000000000002`.
 *
 * Resultado: a quantidade um ulp **abaixo** do teto da escala recebia
 * `0,9200000000000002`, enquanto o próprio teto recebe `alphaMax = 0,92` pelo
 * ramo de saturação. A fila **maior** saía **menos** opaca que a menor — a
 * camada passava a mentir sobre a magnitude, que é exatamente o que a escala
 * existe para não fazer.
 *
 * A correção foi recortar nos dois limites. O teste `alphaOf — regressão de
 * precisão` abaixo cobre isso, e é **não vacuoso por construção**: ele mede
 * também a fórmula sem recorte e exige que ela tenha de fato estourado o teto
 * nas gammas em que o defeito se manifesta. Sem essa segunda metade, o teste
 * continuaria verde mesmo se alguém removesse o recorte e trocasse a fórmula
 * por outra que não estoura — passaria a testar nada.
 *
 * ⚠️ `gamma` é campo de `ColorScale` saneado para `[0,05, 8]`, então as gammas
 * baixas em que o defeito aparece são **alcançáveis por configuração, sem
 * mudar código**. Por isso a varredura cobre a faixa inteira, e não apenas o
 * default de produção `0,5`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PUREZA E INDEPENDÊNCIA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sem DOM, sem relógio, sem sorteio, sem I/O e sem leitura de arquivo em
 * qualquer formato. Onde é preciso desordenar uma amostra, o embaralhamento sai
 * de um gerador congruente linear de semente fixa — reprodutível, ao contrário
 * de um sorteio da biblioteca padrão. Todo insumo é literal no próprio arquivo.
 *
 * Nada aqui alcança serviço de roteamento de conexão, de feed de tick ou de
 * execução de ordem, e nada carrega endereço de rede, identificador de conta,
 * credencial ou estado de posição. A importação é única e aponta para a
 * superfície pública do núcleo puro.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente, nem como exemplo do que evitar: a `Independence_Check` da
 * tarefa 11 inspeciona **integralmente** todo arquivo criado por esta feature,
 * testes incluídos, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: identificadores em inglês, comentários e nomes de teste em pt-BR.
 */

import { describe, it, expect } from 'vitest';

import {
  alphaOf,
  computeColorScale,
  computeColorScalePair,
  hasMagnitudeVariation,
  isAboveScale,
  BOOKMAP_ALPHA_MIN_DEFAULT,
  BOOKMAP_ALPHA_MAX_DEFAULT,
  BOOKMAP_GAMMA_DEFAULT,
  type ColorScale,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// A distribuição medida — os números que dão sentido às bordas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Percentis das **22.721** células com fila maior que zero do pregão de
 * referência. Não são números arbitrários: é a forma do dado real, e é dela que
 * sai a escolha de percentil em vez de máximo.
 */
const P50_MEDIDO = 481;
const P90_MEDIDO = 714;
const P99_MEDIDO = 1_131;

/** Quantas células positivas o pregão de referência tinha. */
const CELULAS_MEDIDAS = 22_721;

/** Maior fila real dentro da banda que concentra 97,1% das células. */
const MAX_REAL_MEDIDO = 2_442;

/**
 * O outlier medido: **32× o `p99` e 50× o `p90`**. Não é parede — é nível
 * cruzado, artefato de agregação. Normalizar linearmente por ele daria ao `p90`
 * apenas `714 / 36.232 = 2,0%` de opacidade, e a parede ficaria invisível.
 */
const OUTLIER_MEDIDO = 36_232;

/** Piso de opacidade do `p90` exigido pelo requisito 2.11, em fração. */
const PISO_AMPLITUDE_P90 = 0.3;

/**
 * Toda a faixa que `gamma` admite depois do saneamento, mais o default. As duas
 * primeiras são justamente aquelas em que a saturação de `Math.pow` produzia o
 * estouro do teto.
 */
const GAMMAS_ADMITIDAS = [0.05, 0.1, 0.25, 0.5, 1, 2, 8] as const;

// ═════════════════════════════════════════════════════════════════════════════
// Utilitários de ponto flutuante
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A metade baixa do padrão de bits de um `Float64Array` fica no índice 0?
 *
 * `1.0` é `0x3FF0000000000000`: metade alta `0x3FF00000`, metade baixa zero.
 * Logo `words[0] === 0` identifica ordenação little-endian sem depender de
 * suposição sobre a plataforma.
 */
const BAIXA_PRIMEIRO = (() => {
  const probe = new Float64Array([1]);
  return (new Uint32Array(probe.buffer)[0] ?? 0) === 0;
})();

/**
 * Vizinho representável imediatamente **abaixo** de `x`, para `x` finito e
 * positivo.
 *
 * ⚠️ Decrementar o padrão de bits é o único jeito exato de andar um ulp.
 * Subtrair `Number.EPSILON` ou dividir repetidamente **não serve**: `EPSILON` é
 * o ulp de 1, não o de 1.131, e a diferença de escala é de mais de dez ordens
 * de grandeza — o passo cairia inteiro no arredondamento e devolveria `x` de
 * volta, deixando o teste verde sem nunca ter chegado na vizinhança do teto.
 *
 * ⚠️ Feito em palavras de 32 bits, e não com `BigInt64Array`, porque o projeto
 * compila com `target: ES2017`, em que literal de `bigint` não é aceito. Para
 * `x` positivo, decrementar o padrão equivale a decrementar a metade baixa com
 * empréstimo da alta.
 */
function nextBelow(x: number): number {
  const bytes = new Float64Array(1);
  const words = new Uint32Array(bytes.buffer);
  bytes[0] = x;

  const iLow = BAIXA_PRIMEIRO ? 0 : 1;
  const iHigh = BAIXA_PRIMEIRO ? 1 : 0;

  const low = words[iLow] ?? 0;
  if (low === 0) {
    words[iHigh] = (words[iHigh] ?? 0) - 1;
    words[iLow] = 0xffffffff;
  } else {
    words[iLow] = low - 1;
  }

  return bytes[0] ?? x;
}

/** `k` vizinhos representáveis abaixo de `x`. */
function ulpsBelow(x: number, k: number): number {
  let v = x;
  for (let i = 0; i < k; i += 1) v = nextBelow(v);
  return v;
}

/**
 * A fórmula de interpolação **sem** o recorte externo — a versão anterior à
 * correção.
 *
 * Existe só para provar que a regressão testada abaixo é real: se esta fórmula
 * não estourar o teto na entrada escolhida, o teste não está exercitando o
 * defeito e precisa ser reescrito, não relaxado.
 */
function interpolacaoSemRecorte(
  t: number,
  gamma: number,
  alphaMin: number,
  alphaMax: number,
): number {
  return alphaMin + (alphaMax - alphaMin) * Math.pow(t, gamma);
}

/** Onde a opacidade caiu dentro da amplitude da escala, em fração de 0 a 1. */
function fracaoDaAmplitude(alpha: number, scale: ColorScale): number {
  return (alpha - scale.alphaMin) / (scale.alphaMax - scale.alphaMin);
}

// ═════════════════════════════════════════════════════════════════════════════
// Construção de amostras
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Posto da estatística de ordem que representa o quantil `q` numa amostra de
 * `n` elementos — a mesma conta que o núcleo usa.
 *
 * Reproduzida aqui de propósito: é o que permite montar uma amostra cujos
 * percentis caem em valores **exatos** e conhecidos, e assim afirmar
 * `p99 === 1131` em vez de `p99 ≈ 1131`.
 */
function quantileIndex(q: number, n: number): number {
  const idx = Math.ceil(q * n) - 1;
  if (idx < 0) return 0;
  return idx > n - 1 ? n - 1 : idx;
}

/**
 * Amostra ordenada de `CELULAS_MEDIDAS` quantidades cuja mediana, `p90` e `p99`
 * caem **exatamente** em `481`, `714` e `1.131`, com máximo real em `2.442`.
 *
 * Quatro trechos lineares crescentes ancorados nos três postos de percentil.
 * Os valores são inteiros e cabem sem perda em `Float32Array` (inteiros abaixo
 * de 2^24 são exatos), então o que se afirma sobre eles vale literalmente.
 */
function amostraRealistaOrdenada(): Float32Array {
  const n = CELULAS_MEDIDAS;
  const i50 = quantileIndex(0.5, n);
  const i90 = quantileIndex(0.9, n);
  const i99 = quantileIndex(0.99, n);

  const rampa = (de: number, ate: number, t: number): number =>
    Math.round(de + (ate - de) * t);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (i <= i50) out[i] = rampa(120, P50_MEDIDO, i / i50);
    else if (i <= i90) out[i] = rampa(P50_MEDIDO, P90_MEDIDO, (i - i50) / (i90 - i50));
    else if (i <= i99) out[i] = rampa(P90_MEDIDO, P99_MEDIDO, (i - i90) / (i99 - i90));
    else out[i] = rampa(P99_MEDIDO, MAX_REAL_MEDIDO, (i - i99) / (n - 1 - i99));
  }
  return out;
}

/**
 * Embaralha uma cópia por Fisher–Yates com gerador congruente linear de semente
 * fixa.
 *
 * Serve para que a amostra não chegue ordenada ao seletor: entrada ordenada
 * exercita um caminho específico da escolha de pivô, e o caso realista precisa
 * passar pelo caminho comum. Determinístico por exigência do requisito 2.1 —
 * sorteio faria a suíte deixar de ser reprodutível.
 */
function embaralharDeterministico(values: Float32Array, seed: number): Float32Array {
  const out = Float32Array.from(values);
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    const tmp = out[i] ?? 0;
    out[i] = out[j] ?? 0;
    out[j] = tmp;
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// `computeColorScale` — amostra vazia
// ═════════════════════════════════════════════════════════════════════════════

describe('computeColorScale: amostra vazia (count = 0)', () => {
  it('devolve escala degenerada com p50 e p99 em zero e os limites default', () => {
    const scale = computeColorScale(new Float32Array(0), 0);

    expect(scale.p50).toBe(0);
    expect(scale.p99).toBe(0);
    expect(scale.alphaMin).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    expect(scale.alphaMax).toBe(BOOKMAP_ALPHA_MAX_DEFAULT);
    expect(scale.gamma).toBe(BOOKMAP_GAMMA_DEFAULT);
  });

  it('ignora o conteúdo do vetor quando count é zero: só count decide', () => {
    // O vetor tem capacidade e dado, mas nada dele vale. Ler além de `count`
    // traria quantidade que não está na janela visível.
    const values = Float32Array.from([P50_MEDIDO, P99_MEDIDO, OUTLIER_MEDIDO]);
    const scale = computeColorScale(values, 0);

    expect(scale.p50).toBe(0);
    expect(scale.p99).toBe(0);
  });

  it('alphaOf sobre a escala vazia responde o piso para toda quantidade, e nunca NaN', () => {
    const scale = computeColorScale(new Float32Array(0), 0);
    const entradas = [0, 1, P50_MEDIDO, P99_MEDIDO, OUTLIER_MEDIDO, 1e30, -5];

    for (const v of entradas) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(Number.isFinite(alpha)).toBe(true);
      expect(alpha).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    }
  });

  it('a escala vazia não pede contorno nem declara variação de magnitude', () => {
    // Nada a medir não é o mesmo que "tudo saturado": o requisito 2.10 fala da
    // janela sem variação, e é o `p99 === 0` que separa os dois casos.
    const scale = computeColorScale(new Float32Array(0), 0);

    expect(hasMagnitudeVariation(scale)).toBe(false);
    expect(isAboveScale(scale, OUTLIER_MEDIDO)).toBe(false);
  });

  it('count inválido é saneado para amostra vazia em vez de rejeitado', () => {
    const values = Float32Array.from([P50_MEDIDO, P99_MEDIDO]);

    for (const count of [-1, -0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const scale = computeColorScale(values, count);
      expect(scale.p50).toBe(0);
      expect(scale.p99).toBe(0);
      expect(alphaOf(scale, P99_MEDIDO)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    }
  });

  it('count acima do comprimento é recortado ao vetor, sem ler além dele', () => {
    const values = Float32Array.from([P50_MEDIDO, P99_MEDIDO]);
    const recortado = computeColorScale(values, 999);
    const exato = computeColorScale(values, values.length);

    expect(recortado).toEqual(exato);
  });

  it('amostra só de zeros equivale a amostra vazia: nada positivo a medir', () => {
    // Fronteira sutil: `count` é 64, mas nenhum valor entra nos percentis.
    const scale = computeColorScale(new Float32Array(64), 64);

    expect(scale.p50).toBe(0);
    expect(scale.p99).toBe(0);
    expect(alphaOf(scale, 0)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    expect(alphaOf(scale, 1_000)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `computeColorScale` — zeros fora da amostra (requisito 2.2)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeColorScale: zeros excluídos dos percentis (requisito 2.2)', () => {
  /**
   * Célula vazia não é liquidez fraca: é **ausência** de liquidez. Incluí-la
   * derrubaria o `p50` e clarearia o desenho inteiro.
   */
  it('intercalar zeros não move p50 nem p99', () => {
    const positivos = [100, 200, 300, 400, 500, 600, 700, 800];
    const semZeros = Float32Array.from(positivos);

    const comZeros: number[] = [];
    for (const v of positivos) comZeros.push(0, v, 0);
    const densa = Float32Array.from(comZeros);

    const a = computeColorScale(semZeros, semZeros.length);
    const b = computeColorScale(densa, densa.length);

    expect(b.p50).toBe(a.p50);
    expect(b.p99).toBe(a.p99);
  });

  it('a quantidade zero recebe a opacidade mínima da escala', () => {
    const values = Float32Array.from([0, P50_MEDIDO, 0, P90_MEDIDO, 0, P99_MEDIDO]);
    const scale = computeColorScale(values, values.length);

    expect(alphaOf(scale, 0)).toBe(scale.alphaMin);
  });

  it('a proporção de zeros é irrelevante: mil zeros dão a mesma escala que nenhum', () => {
    const positivos = [P50_MEDIDO, P90_MEDIDO, P99_MEDIDO, MAX_REAL_MEDIDO];
    const enxuta = Float32Array.from(positivos);

    const inflada = new Float32Array(1_000 + positivos.length);
    // Os positivos entram no fim, depois de mil zeros, para que a posição no
    // vetor também não influa.
    for (let i = 0; i < positivos.length; i += 1) {
      inflada[1_000 + i] = positivos[i] ?? 0;
    }

    const a = computeColorScale(enxuta, enxuta.length);
    const b = computeColorScale(inflada, inflada.length);

    expect(b.p50).toBe(a.p50);
    expect(b.p99).toBe(a.p99);
  });

  it('quantidade negativa também fica fora da amostra e recebe o piso', () => {
    const limpa = Float32Array.from([200, 400, 600, 800]);
    const suja = Float32Array.from([-1, 200, -50, 400, -1e6, 600, 800]);

    const a = computeColorScale(limpa, limpa.length);
    const b = computeColorScale(suja, suja.length);

    expect(b.p50).toBe(a.p50);
    expect(b.p99).toBe(a.p99);
    expect(alphaOf(b, -1)).toBe(b.alphaMin);
    expect(alphaOf(b, -1e6)).toBe(b.alphaMin);
  });

  it('valor não finito na amostra não envenena os percentis', () => {
    // Um `NaN` solto quebraria as comparações do seletor; um `Infinity`
    // reescreveria o teto. Nenhum dos dois entra.
    const limpa = Float32Array.from([200, 400, 600, 800]);
    const suja = Float32Array.from([
      Number.NaN,
      200,
      Number.POSITIVE_INFINITY,
      400,
      600,
      Number.NEGATIVE_INFINITY,
      800,
    ]);

    const a = computeColorScale(limpa, limpa.length);
    const b = computeColorScale(suja, suja.length);

    expect(Number.isFinite(b.p50)).toBe(true);
    expect(Number.isFinite(b.p99)).toBe(true);
    expect(b.p50).toBe(a.p50);
    expect(b.p99).toBe(a.p99);
  });

  it('não muta o vetor recebido, mesmo precisando reordenar para selecionar', () => {
    // O vetor pertence ao grid: reordená-lo no lugar embaralharia as colunas
    // paralelas e a célula `k` deixaria de ser a mesma em todas elas.
    const original = embaralharDeterministico(amostraRealistaOrdenada(), 7);
    const copia = Float32Array.from(original);

    computeColorScale(original, original.length);

    expect(Array.from(original)).toEqual(Array.from(copia));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `computeColorScale` — janela sem variação de magnitude (requisito 2.10)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeColorScale: todos os valores iguais (requisito 2.10)', () => {
  it('p50 e p99 colapsam no valor único da amostra', () => {
    const values = new Float32Array(512).fill(P50_MEDIDO);
    const scale = computeColorScale(values, values.length);

    expect(scale.p50).toBe(P50_MEDIDO);
    expect(scale.p99).toBe(P50_MEDIDO);
    expect(scale.p50).toBe(scale.p99);
  });

  it('toda quantidade maior que zero recebe a opacidade máxima', () => {
    const values = new Float32Array(512).fill(P50_MEDIDO);
    const scale = computeColorScale(values, values.length);

    // Abaixo, no ponto e acima do valor único — os três saturam, porque não há
    // faixa útil que os distinga.
    for (const v of [Number.MIN_VALUE, 1, P50_MEDIDO - 1, P50_MEDIDO, P50_MEDIDO + 1, OUTLIER_MEDIDO]) {
      expect(alphaOf(scale, v)).toBe(scale.alphaMax);
    }
  });

  it('a quantidade zero e a negativa continuam recebendo a opacidade mínima', () => {
    const values = new Float32Array(512).fill(P50_MEDIDO);
    const scale = computeColorScale(values, values.length);

    expect(alphaOf(scale, 0)).toBe(scale.alphaMin);
    expect(alphaOf(scale, -1)).toBe(scale.alphaMin);
  });

  it('toda opacidade é finita e definida na escala colapsada', () => {
    const values = new Float32Array(128).fill(MAX_REAL_MEDIDO);
    const scale = computeColorScale(values, values.length);

    for (const v of [-1, 0, 1, MAX_REAL_MEDIDO, OUTLIER_MEDIDO, 1e30]) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(Number.isFinite(alpha)).toBe(true);
      expect(alpha).toBeGreaterThanOrEqual(scale.alphaMin);
      expect(alpha).toBeLessThanOrEqual(scale.alphaMax);
    }
  });

  it('nenhuma célula recebe contorno, porque todas estão saturadas', () => {
    // O requisito 2.10 é explícito: sem contorno. Marcar todas não informaria
    // nada ao operador.
    const values = new Float32Array(128).fill(P90_MEDIDO);
    const scale = computeColorScale(values, values.length);

    expect(isAboveScale(scale, P90_MEDIDO)).toBe(false);
    expect(isAboveScale(scale, P90_MEDIDO + 1)).toBe(false);
    expect(isAboveScale(scale, OUTLIER_MEDIDO)).toBe(false);
  });

  it('declara ausência de variação de magnitude, para a legenda poder avisar', () => {
    const values = new Float32Array(128).fill(P90_MEDIDO);
    const colapsada = computeColorScale(values, values.length);

    expect(hasMagnitudeVariation(colapsada)).toBe(false);

    // E o contraste: com dispersão, a escala tem faixa útil.
    const dispersa = computeColorScale(
      Float32Array.from([P50_MEDIDO, P90_MEDIDO, P99_MEDIDO]),
      3,
    );
    expect(hasMagnitudeVariation(dispersa)).toBe(true);
  });

  it('um único valor positivo na amostra também colapsa a escala', () => {
    // Fronteira mínima do caso: `n = 1`, então os dois postos de percentil
    // apontam para o mesmo elemento.
    const scale = computeColorScale(Float32Array.from([P99_MEDIDO]), 1);

    expect(scale.p50).toBe(P99_MEDIDO);
    expect(scale.p99).toBe(P99_MEDIDO);
    expect(alphaOf(scale, P99_MEDIDO)).toBe(scale.alphaMax);
    expect(alphaOf(scale, 1)).toBe(scale.alphaMax);
    expect(alphaOf(scale, 0)).toBe(scale.alphaMin);
    expect(hasMagnitudeVariation(scale)).toBe(false);
  });

  it('dois valores distintos já produzem faixa útil, com piso e teto nos extremos', () => {
    const scale = computeColorScale(Float32Array.from([P50_MEDIDO, P99_MEDIDO]), 2);

    expect(scale.p50).toBeLessThan(scale.p99);
    expect(alphaOf(scale, scale.p50)).toBe(scale.alphaMin);
    expect(alphaOf(scale, scale.p99)).toBe(scale.alphaMax);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `computeColorScale` — o outlier medido (requisitos 2.2 e 2.11)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeColorScale: um outlier de 36.232 entre 22.721 valores realistas', () => {
  /** A amostra sem o outlier, na ordem em que o seletor a receberia. */
  const realista = embaralharDeterministico(amostraRealistaOrdenada(), 42);

  /** A mesma amostra, com o artefato de nível cruzado acrescentado ao fim. */
  const comOutlier = (() => {
    const out = new Float32Array(realista.length + 1);
    out.set(realista);
    out[realista.length] = OUTLIER_MEDIDO;
    return out;
  })();

  it('a amostra de referência reproduz exatamente a distribuição medida', () => {
    // Sem esta conferência, todo o resto do bloco poderia estar medindo uma
    // distribuição inventada e ainda assim passar.
    const scale = computeColorScale(realista, realista.length);

    expect(scale.p50).toBe(P50_MEDIDO);
    expect(scale.p99).toBe(P99_MEDIDO);
    expect(realista.length).toBe(CELULAS_MEDIDAS);
  });

  it('o outlier desloca o p99 em no máximo um posto de percentil', () => {
    const sem = computeColorScale(realista, realista.length);
    const com = computeColorScale(comOutlier, comOutlier.length);

    // O posto anda de 22.493 para 22.494; o valor sobe de 1.131 para o vizinho
    // seguinte da rampa, não para perto de 36.232.
    expect(com.p50).toBe(sem.p50);
    expect(com.p99).toBeGreaterThanOrEqual(sem.p99);

    const i99Sem = quantileIndex(0.99, realista.length);
    const i99Com = quantileIndex(0.99, comOutlier.length);
    expect(i99Com - i99Sem).toBe(1);

    // O valor no posto seguinte da amostra ordenada — o teto legítimo com o
    // outlier dentro. Igualdade, não aproximação.
    const ordenada = amostraRealistaOrdenada();
    expect(com.p99).toBe(ordenada[i99Com]);
  });

  it('o outlier não achata a escala: o p90 mantém opacidade relevante', () => {
    const scale = computeColorScale(comOutlier, comOutlier.length);
    const fracao = fracaoDaAmplitude(alphaOf(scale, P90_MEDIDO), scale);

    // O requisito 2.11 exige 30% da amplitude. A curva de raiz entrega ~59,6%,
    // quase o dobro do piso — e é ela o mecanismo que sustenta o requisito.
    expect(fracao).toBeGreaterThanOrEqual(PISO_AMPLITUDE_P90);
    expect(fracao).toBeGreaterThan(0.5);
  });

  it('a opacidade do p90 quase não muda com a entrada do outlier', () => {
    const sem = computeColorScale(realista, realista.length);
    const com = computeColorScale(comOutlier, comOutlier.length);

    const antes = fracaoDaAmplitude(alphaOf(sem, P90_MEDIDO), sem);
    const depois = fracaoDaAmplitude(alphaOf(com, P90_MEDIDO), com);

    // Um posto de percentil de diferença move a fração em menos de 1 ponto.
    expect(Math.abs(depois - antes)).toBeLessThan(0.01);
  });

  it('a escala linear pelo máximo é o que estaria errado, e a aritmética mostra', () => {
    // Não é preferência estética: normalizando pelo máximo, a parede do p90
    // receberia 2,0% da amplitude e desapareceria da tela. É o argumento
    // inteiro contra a alternativa rejeitada no design.
    const fracaoLinearPeloMaximo = P90_MEDIDO / OUTLIER_MEDIDO;
    expect(fracaoLinearPeloMaximo).toBeLessThan(0.021);

    const scale = computeColorScale(comOutlier, comOutlier.length);
    const fracaoPercentil = fracaoDaAmplitude(alphaOf(scale, P90_MEDIDO), scale);

    // Vinte e nove vezes mais visível pelo caminho adotado.
    expect(fracaoPercentil / fracaoLinearPeloMaximo).toBeGreaterThan(25);
  });

  it('o outlier satura o teto e pede contorno, em vez de passar por parede comum', () => {
    const scale = computeColorScale(comOutlier, comOutlier.length);

    expect(alphaOf(scale, OUTLIER_MEDIDO)).toBe(scale.alphaMax);
    expect(isAboveScale(scale, OUTLIER_MEDIDO)).toBe(true);

    // E o `p99` em si não recebe contorno: ele é o teto, não o excedeu.
    expect(isAboveScale(scale, scale.p99)).toBe(false);
  });

  it('é determinística: a mesma amostra devolve a mesma escala', () => {
    const a = computeColorScale(comOutlier, comOutlier.length);
    const b = computeColorScale(comOutlier, comOutlier.length);

    expect(b).toEqual(a);
  });

  it('a ordem de chegada da amostra não altera a escala', () => {
    // O seletor reordena a cópia; o resultado não pode depender de como o dado
    // chegou, senão a cor mudaria conforme o zoom reagrupasse as células.
    const ordenada = amostraRealistaOrdenada();
    const invertida = Float32Array.from(ordenada).reverse();
    const outraSemente = embaralharDeterministico(ordenada, 4_242);

    const base = computeColorScale(ordenada, ordenada.length);
    expect(computeColorScale(invertida, invertida.length)).toEqual(base);
    expect(computeColorScale(outraSemente, outraSemente.length)).toEqual(base);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `alphaOf` — quantidade não finita (requisito 2.4)
// ═════════════════════════════════════════════════════════════════════════════

describe('alphaOf: Infinity, -Infinity e NaN', () => {
  const scale = computeColorScale(
    Float32Array.from([P50_MEDIDO, P90_MEDIDO, P99_MEDIDO, MAX_REAL_MEDIDO]),
    4,
  );

  it('as três quantidades não finitas recebem exatamente a opacidade mínima', () => {
    // `NaN` como opacidade pintaria transparente: a célula sumiria em silêncio,
    // sem log e sem exceção. O requisito 2.4 manda desenhá-la com o piso.
    expect(alphaOf(scale, Number.POSITIVE_INFINITY)).toBe(scale.alphaMin);
    expect(alphaOf(scale, Number.NEGATIVE_INFINITY)).toBe(scale.alphaMin);
    expect(alphaOf(scale, Number.NaN)).toBe(scale.alphaMin);
  });

  it('nenhuma delas produz NaN', () => {
    for (const v of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(Number.isFinite(alpha)).toBe(true);
    }
  });

  it('+Infinity NÃO satura o teto: o requisito 2.4 tem precedência sobre a ordem', () => {
    // Fronteira deliberada. A monotonicidade do requisito 2.3 é enunciada sobre
    // o domínio **finito**, e é só por causa dessa qualificação que as duas
    // regras coexistem: `+Infinity` é maior que o `p99` e ainda assim recebe o
    // piso. Quem ler a monotonicidade como irrestrita vai achar que isto é bug.
    expect(alphaOf(scale, Number.POSITIVE_INFINITY)).toBe(scale.alphaMin);
    expect(alphaOf(scale, scale.p99)).toBe(scale.alphaMax);
    expect(alphaOf(scale, Number.POSITIVE_INFINITY)).toBeLessThan(
      alphaOf(scale, scale.p99),
    );
  });

  it('a maior quantidade finita representável satura, e a não finita não', () => {
    expect(alphaOf(scale, Number.MAX_VALUE)).toBe(scale.alphaMax);
    expect(alphaOf(scale, Number.POSITIVE_INFINITY)).toBe(scale.alphaMin);
  });

  it('não finita também recebe o piso na escala colapsada e na vazia', () => {
    const colapsada = computeColorScale(new Float32Array(16).fill(P50_MEDIDO), 16);
    const vazia = computeColorScale(new Float32Array(0), 0);

    for (const s of [colapsada, vazia]) {
      for (const v of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
        expect(alphaOf(s, v)).toBe(s.alphaMin);
      }
    }
  });

  it('a quantidade não finita nunca pede contorno', () => {
    expect(isAboveScale(scale, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isAboveScale(scale, Number.NaN)).toBe(false);
    expect(isAboveScale(scale, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `alphaOf` — regressão de precisão no teto da escala
// ═════════════════════════════════════════════════════════════════════════════

describe('alphaOf: regressão de precisão a um ulp do teto da escala', () => {
  /** A escala do pregão de referência, com `gamma` variável. */
  const escalaMedida = (gamma: number): ColorScale => ({
    p50: P50_MEDIDO,
    p99: P99_MEDIDO,
    alphaMin: BOOKMAP_ALPHA_MIN_DEFAULT,
    alphaMax: BOOKMAP_ALPHA_MAX_DEFAULT,
    gamma,
  });

  /** A quantidade um passo de precisão abaixo do teto. */
  const UM_ULP_ABAIXO = nextBelow(P99_MEDIDO);

  it('a quantidade testada é de fato o vizinho representável abaixo do p99', () => {
    // Se esta conferência cair, o teste deixou de exercitar a vizinhança do
    // teto e passou a medir um ponto qualquer da rampa.
    expect(UM_ULP_ABAIXO).toBe(1130.9999999999998);
    expect(UM_ULP_ABAIXO).toBeLessThan(P99_MEDIDO);

    // Não existe representável estritamente entre os dois: o ponto médio
    // arredonda de volta para um deles. É isso que caracteriza "um ulp".
    const medio = (UM_ULP_ABAIXO + P99_MEDIDO) / 2;
    expect([UM_ULP_ABAIXO, P99_MEDIDO]).toContain(medio);

    // E a subtração ingênua não chega aqui: `EPSILON` é o ulp de 1, não o de
    // 1.131, então o passo desapareceria no arredondamento.
    expect(P99_MEDIDO - Number.EPSILON).toBe(P99_MEDIDO);
  });

  /**
   * O par de opacidade que EXIBE o defeito de precisão.
   *
   * ⚠️ Fixado no teste, e não lido dos defaults de produção. Motivo medido em
   * 03/09/2026: o piso passou de `0,06` para `0,18` (metade das células ficava
   * invisível a 6% de opacidade sobre fundo escuro, atrás das velas), e com
   * `0,18` a aritmética simplesmente **não estoura** —
   * `0,18 + (0,92 − 0,18) === 0,92` exato.
   *
   * O recorte no núcleo continua necessário: ele protege QUALQUER par de
   * opacidade, e `alphaMin`/`alphaMax` são configuráveis. Amarrar esta prova aos
   * defaults faria a regressão desaparecer da suíte a cada recalibração de cor —
   * exatamente o que aconteceu — dando a impressão de que o defeito deixou de
   * existir quando o que mudou foi só o valor que o exercita.
   */
  const ALPHA_MIN_QUE_ESTOURA = 0.06;
  const ALPHA_MAX_QUE_ESTOURA = 0.92;

  it('o defeito existia: sem recorte, a fórmula estoura o teto nas gammas baixas', () => {
    // ⚠️ Esta é a metade que torna o teste **não vacuoso**. Ela prova que a
    // entrada escolhida realmente ativa o defeito; sem ela, remover o recorte
    // do núcleo poderia deixar a suíte verde.
    const t = (UM_ULP_ABAIXO - P50_MEDIDO) / (P99_MEDIDO - P50_MEDIDO);
    expect(t).toBeLessThan(1);

    const estouram = GAMMAS_ADMITIDAS.filter(
      (gamma) =>
        interpolacaoSemRecorte(
          t,
          gamma,
          ALPHA_MIN_QUE_ESTOURA,
          ALPHA_MAX_QUE_ESTOURA,
        ) > ALPHA_MAX_QUE_ESTOURA,
    );

    // `Math.pow` satura em 1 exato para as duas gammas mais baixas, e aí a soma
    // `alphaMin + (alphaMax − alphaMin)` devolve 0,9200000000000002.
    expect(estouram).toEqual([0.05, 0.1]);
    expect(
      ALPHA_MIN_QUE_ESTOURA + (ALPHA_MAX_QUE_ESTOURA - ALPHA_MIN_QUE_ESTOURA),
    ).toBeGreaterThan(ALPHA_MAX_QUE_ESTOURA);
  });

  it('e o recorte protege o par que estoura, não só os defaults', () => {
    // O núcleo tem de respeitar o teto também com o par antigo — é o que prova
    // que a correção está no CÁLCULO, e não na escolha da constante.
    for (const gamma of GAMMAS_ADMITIDAS) {
      const alpha = alphaOf(
        {
          p50: P50_MEDIDO,
          p99: P99_MEDIDO,
          alphaMin: ALPHA_MIN_QUE_ESTOURA,
          alphaMax: ALPHA_MAX_QUE_ESTOURA,
          gamma,
        },
        UM_ULP_ABAIXO,
      );
      expect(alpha).toBeLessThanOrEqual(ALPHA_MAX_QUE_ESTOURA);
      expect(alpha).toBeGreaterThanOrEqual(ALPHA_MIN_QUE_ESTOURA);
    }
  });

  it('está corrigido: em toda a faixa de gamma o resultado respeita o teto', () => {
    for (const gamma of GAMMAS_ADMITIDAS) {
      const scale = escalaMedida(gamma);
      const alpha = alphaOf(scale, UM_ULP_ABAIXO);

      expect(Number.isFinite(alpha)).toBe(true);
      // Inclusive nos dois limites — é o contrato do requisito 2.3.
      expect(alpha).toBeGreaterThanOrEqual(BOOKMAP_ALPHA_MIN_DEFAULT);
      expect(alpha).toBeLessThanOrEqual(BOOKMAP_ALPHA_MAX_DEFAULT);
    }
  });

  it('está corrigido: a quantidade menor nunca sai mais opaca que o próprio p99', () => {
    // A consequência que o defeito produzia — fila maior pintada mais clara —
    // e o motivo de a escala existir.
    for (const gamma of GAMMAS_ADMITIDAS) {
      const scale = escalaMedida(gamma);
      expect(alphaOf(scale, UM_ULP_ABAIXO)).toBeLessThanOrEqual(
        alphaOf(scale, P99_MEDIDO),
      );
    }
  });

  it('a ordem se mantém ao varrer os 64 passos de precisão abaixo do p99', () => {
    // Um ponto isolado não bastaria: a saturação de `Math.pow` cobre uma
    // vizinhança, não um valor. A varredura confirma que não sobrou inversão.
    for (const gamma of GAMMAS_ADMITIDAS) {
      const scale = escalaMedida(gamma);
      const noTeto = alphaOf(scale, P99_MEDIDO);

      let anterior = alphaOf(scale, ulpsBelow(P99_MEDIDO, 64));
      for (let k = 63; k >= 0; k -= 1) {
        const atual = alphaOf(scale, ulpsBelow(P99_MEDIDO, k));

        expect(Number.isFinite(atual)).toBe(true);
        expect(atual).toBeGreaterThanOrEqual(BOOKMAP_ALPHA_MIN_DEFAULT);
        expect(atual).toBeLessThanOrEqual(BOOKMAP_ALPHA_MAX_DEFAULT);
        expect(atual).toBeGreaterThanOrEqual(anterior);
        expect(atual).toBeLessThanOrEqual(noTeto);

        anterior = atual;
      }
    }
  });

  it('a vizinhança do piso também respeita o intervalo, com qualquer gamma', () => {
    // O outro extremo da rampa. A alternativa descartada no núcleo — interpolar
    // a partir do teto — devolvia o teto exato e furava aqui, justamente com a
    // gamma default de produção.
    for (const gamma of GAMMAS_ADMITIDAS) {
      const scale = escalaMedida(gamma);

      for (let k = 0; k <= 64; k += 1) {
        const alpha = alphaOf(scale, P50_MEDIDO + k * Number.EPSILON * P50_MEDIDO);

        expect(Number.isFinite(alpha)).toBe(true);
        expect(alpha).toBeGreaterThanOrEqual(BOOKMAP_ALPHA_MIN_DEFAULT);
        expect(alpha).toBeLessThanOrEqual(BOOKMAP_ALPHA_MAX_DEFAULT);
      }

      expect(alphaOf(scale, P50_MEDIDO)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
      expect(alphaOf(scale, nextBelow(P50_MEDIDO))).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    }
  });

  it('o recorte não achata a rampa: o meio da escala continua entre os limites', () => {
    // Recortar nos extremos não pode ter transformado a função numa escada de
    // dois degraus.
    for (const gamma of GAMMAS_ADMITIDAS) {
      const scale = escalaMedida(gamma);
      const meio = (P50_MEDIDO + P99_MEDIDO) / 2;
      const alpha = alphaOf(scale, meio);

      expect(alpha).toBeGreaterThan(BOOKMAP_ALPHA_MIN_DEFAULT);
      expect(alpha).toBeLessThan(BOOKMAP_ALPHA_MAX_DEFAULT);
    }
  });

  it('gamma fora da faixa admitida é saneada em vez de propagar para a opacidade', () => {
    // `gamma = 0` faria `0^0 === 1` e toda quantidade abaixo do p50 saltaria
    // para o teto, quebrando o requisito 2.3.
    const meio = (P50_MEDIDO + P99_MEDIDO) / 2;

    for (const gamma of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e-9, 1e9]) {
      const scale = escalaMedida(gamma);

      const alpha = alphaOf(scale, meio);
      expect(Number.isFinite(alpha)).toBe(true);
      expect(alpha).toBeGreaterThanOrEqual(BOOKMAP_ALPHA_MIN_DEFAULT);
      expect(alpha).toBeLessThanOrEqual(BOOKMAP_ALPHA_MAX_DEFAULT);

      expect(alphaOf(scale, P50_MEDIDO)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
      expect(alphaOf(scale, P99_MEDIDO)).toBe(BOOKMAP_ALPHA_MAX_DEFAULT);
      expect(alphaOf(scale, nextBelow(P99_MEDIDO))).toBeLessThanOrEqual(
        BOOKMAP_ALPHA_MAX_DEFAULT,
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `alphaOf` — `ColorScale` montada à mão
// ═════════════════════════════════════════════════════════════════════════════

describe('alphaOf: ColorScale montada à mão com campo corrompido', () => {
  const meio = (P50_MEDIDO + P99_MEDIDO) / 2;

  it('p50 ou p99 não finito é lido como zero, sem lançar e sem NaN', () => {
    const casos: ColorScale[] = [
      { p50: Number.NaN, p99: P99_MEDIDO, alphaMin: 0.06, alphaMax: 0.92, gamma: 0.5 },
      { p50: P50_MEDIDO, p99: Number.NaN, alphaMin: 0.06, alphaMax: 0.92, gamma: 0.5 },
      { p50: Number.NaN, p99: Number.NaN, alphaMin: 0.06, alphaMax: 0.92, gamma: 0.5 },
      {
        p50: Number.NEGATIVE_INFINITY,
        p99: Number.POSITIVE_INFINITY,
        alphaMin: 0.06,
        alphaMax: 0.92,
        gamma: 0.5,
      },
    ];

    for (const scale of casos) {
      for (const v of [-1, 0, 1, meio, P99_MEDIDO, OUTLIER_MEDIDO]) {
        const alpha = alphaOf(scale, v);
        expect(Number.isNaN(alpha)).toBe(false);
        expect(Number.isFinite(alpha)).toBe(true);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it('limites de opacidade não finitos caem nos defaults', () => {
    const scale: ColorScale = {
      p50: P50_MEDIDO,
      p99: P99_MEDIDO,
      alphaMin: Number.NaN,
      alphaMax: Number.NaN,
      gamma: 0.5,
    };

    expect(alphaOf(scale, 0)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
    expect(alphaOf(scale, P99_MEDIDO)).toBe(BOOKMAP_ALPHA_MAX_DEFAULT);
  });

  it('limites fora de [0, 1] são recortados antes de qualquer conta', () => {
    const scale: ColorScale = {
      p50: P50_MEDIDO,
      p99: P99_MEDIDO,
      alphaMin: -5,
      alphaMax: 42,
      gamma: 0.5,
    };

    expect(alphaOf(scale, P50_MEDIDO)).toBe(0);
    expect(alphaOf(scale, P99_MEDIDO)).toBe(1);
    expect(alphaOf(scale, meio)).toBeGreaterThan(0);
    expect(alphaOf(scale, meio)).toBeLessThan(1);
  });

  it('limites invertidos achatam a escala em vez de inverter a rampa', () => {
    // Amplitude negativa manteria a função monotônica e **invertida** — parede
    // maior mais clara. Achatar é a direção segura.
    const scale: ColorScale = {
      p50: P50_MEDIDO,
      p99: P99_MEDIDO,
      alphaMin: 0.9,
      alphaMax: 0.1,
      gamma: 0.5,
    };

    for (const v of [-1, 0, P50_MEDIDO, meio, P99_MEDIDO, OUTLIER_MEDIDO]) {
      expect(alphaOf(scale, v)).toBe(0.9);
    }
  });

  it('limites iguais colapsam o intervalo sem produzir NaN', () => {
    const scale: ColorScale = {
      p50: P50_MEDIDO,
      p99: P99_MEDIDO,
      alphaMin: 0.4,
      alphaMax: 0.4,
      gamma: 0.5,
    };

    for (const v of [0, P50_MEDIDO, meio, P99_MEDIDO]) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(alpha).toBe(0.4);
    }
  });

  it('p99 abaixo do p50 é tratado como escala sem faixa útil', () => {
    // `computeColorScale` nunca produz isso — `p50 ≤ p99` é estrutural. Mas uma
    // escala montada à mão pode, e a função não pode responder com NaN.
    const scale: ColorScale = {
      p50: P99_MEDIDO,
      p99: P50_MEDIDO,
      alphaMin: 0.06,
      alphaMax: 0.92,
      gamma: 0.5,
    };

    for (const v of [0, P50_MEDIDO, meio, P99_MEDIDO, OUTLIER_MEDIDO]) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(alpha).toBeGreaterThanOrEqual(0.06);
      expect(alpha).toBeLessThanOrEqual(0.92);
    }

    expect(hasMagnitudeVariation(scale)).toBe(false);
    expect(isAboveScale(scale, OUTLIER_MEDIDO)).toBe(false);
  });

  it('escala inteiramente corrompida ainda responde valor finito', () => {
    const scale: ColorScale = {
      p50: Number.NaN,
      p99: Number.NaN,
      alphaMin: Number.NaN,
      alphaMax: Number.NaN,
      gamma: Number.NaN,
    };

    for (const v of [
      -1,
      0,
      1,
      meio,
      OUTLIER_MEDIDO,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const alpha = alphaOf(scale, v);
      expect(Number.isNaN(alpha)).toBe(false);
      expect(Number.isFinite(alpha)).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `computeColorScalePair` — escala compartilhada pelos dois lados (req. 2.9)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeColorScalePair: escala única para os dois lados (requisito 2.9)', () => {
  it('a escala compartilhada vê os dois lados, e escalas por lado discordariam', () => {
    // É o ponto do requisito. A borda a demonstrar é que escala **por lado**
    // atribuiria opacidades diferentes à MESMA quantidade — uma parede de 600
    // pareceria maior ou menor conforme o lado, e a comparação que o operador
    // faz de relance passaria a ser inválida.
    const compra = Float32Array.from([200, 300, 400, 600]);
    const venda = Float32Array.from([900, 1_500, 2_100, 2_400]);

    const porLadoCompra = computeColorScale(compra, 4);
    const porLadoVenda = computeColorScale(venda, 4);
    const compartilhada = computeColorScalePair(compra, venda, 4);

    // O que o requisito proíbe, demonstrado: os dois lados discordam em 600.
    expect(alphaOf(porLadoCompra, 600)).not.toBe(alphaOf(porLadoVenda, 600));

    // O que o requisito exige: uma escala só, logo uma resposta só por
    // quantidade, qualquer que seja o lado de origem da célula.
    expect(compartilhada.p99).toBeGreaterThanOrEqual(porLadoCompra.p99);
    expect(compartilhada.p50).toBeGreaterThanOrEqual(porLadoCompra.p50);
    expect(compartilhada.p50).toBeLessThanOrEqual(porLadoVenda.p50);
  });

  it('count zero nos dois lados devolve escala vazia', () => {
    const scale = computeColorScalePair(
      Float32Array.from([500, 600]),
      Float32Array.from([700, 800]),
      0,
    );

    expect(scale.p50).toBe(0);
    expect(scale.p99).toBe(0);
    expect(alphaOf(scale, 700)).toBe(BOOKMAP_ALPHA_MIN_DEFAULT);
  });

  it('um lado inteiramente zerado não derruba os percentis do outro', () => {
    const compra = Float32Array.from([200, 400, 600, 800]);
    const vazio = new Float32Array(4);

    const par = computeColorScalePair(compra, vazio, 4);
    const soUmLado = computeColorScale(compra, 4);

    expect(par.p50).toBe(soUmLado.p50);
    expect(par.p99).toBe(soUmLado.p99);
  });

  it('a ordem dos lados é irrelevante para a escala resultante', () => {
    const a = Float32Array.from([200, 400, 600, 800]);
    const b = Float32Array.from([150, 900, 1_200, 300]);

    expect(computeColorScalePair(b, a, 4)).toEqual(computeColorScalePair(a, b, 4));
  });

  it('lados todos iguais colapsam a escala e saturam o positivo', () => {
    const compra = new Float32Array(32).fill(P90_MEDIDO);
    const venda = new Float32Array(32).fill(P90_MEDIDO);
    const scale = computeColorScalePair(compra, venda, 32);

    expect(scale.p50).toBe(P90_MEDIDO);
    expect(scale.p99).toBe(P90_MEDIDO);
    expect(hasMagnitudeVariation(scale)).toBe(false);
    expect(alphaOf(scale, P90_MEDIDO)).toBe(scale.alphaMax);
    expect(alphaOf(scale, 0)).toBe(scale.alphaMin);
  });

  it('não muta nenhuma das duas colunas recebidas', () => {
    const compra = embaralharDeterministico(Float32Array.from([200, 400, 600, 800]), 3);
    const venda = embaralharDeterministico(Float32Array.from([150, 900, 1_200, 300]), 5);
    const copiaCompra = Float32Array.from(compra);
    const copiaVenda = Float32Array.from(venda);

    computeColorScalePair(compra, venda, 4);

    expect(Array.from(compra)).toEqual(Array.from(copiaCompra));
    expect(Array.from(venda)).toEqual(Array.from(copiaVenda));
  });
});
