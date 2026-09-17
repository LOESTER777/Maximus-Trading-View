/**
 * correlacao.core — COMPARAR dois ativos, e medir se eles andam juntos.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"analise se é possível termos um gráfico dentro de outro gráfico para podermos ver a
 * correlação"*.
 *
 * ⭐ Duas coisas diferentes, e as duas são necessárias:
 *
 *  1. **Ver** — as duas séries sobrepostas, comparáveis. Exige NORMALIZAR: WIN em 188.000 e
 *     PETR4 em 38 desenhados na mesma escala dariam uma linha e um risco no chão.
 *  2. **Medir** — um número que diga se elas andam juntas. Olho não distingue correlação de
 *     0,4 e de 0,8, e é exactamente nessa faixa que a decisão muda.
 *
 * ⚠️ `.core` = PURO: sem DOM, sem relógio, total e determinístico.
 */

/** Uma barra, no mínimo que estas contas exigem. `time` em SEGUNDOS. */
export interface BarraComparavel {
  readonly time: number;
  readonly close: number;
}

export interface PontoNormalizado {
  readonly time: number;
  /** O fechamento em base 100 na primeira barra da janela. */
  readonly valor: number;
}

/**
 * Reescala uma série para BASE 100 na primeira barra.
 *
 * ⭐⭐ **É o que torna a comparação possível, e não um detalhe de apresentação.** Sobrepor
 * PREÇO de dois ativos não comunica nada: o WIN vale ~188.000 e a PETR4 ~38, então o desenho
 * seria uma linha no topo e outra colada no eixo. Em base 100, as duas partem do mesmo ponto e
 * o que se vê é o CAMINHO — que é a única coisa comparável entre ativos de preço diferente.
 *
 * ⚠️ Primeira barra com fechamento zero ou não finito devolve vazio, e não uma série de
 * `Infinity`: dividir por ela produziria coordenadas que o canvas silenciosamente não pinta, e
 * o operador veria uma das duas linhas desaparecer sem explicação.
 */
export function normalizarBase100(bars: readonly BarraComparavel[]): readonly PontoNormalizado[] {
  const base = bars[0]?.close;
  if (base === undefined || !Number.isFinite(base) || base === 0) return [];
  const saida: PontoNormalizado[] = [];
  for (const b of bars) {
    if (!Number.isFinite(b.close) || !Number.isFinite(b.time)) continue;
    saida.push({ time: b.time, valor: (b.close / base) * 100 });
  }
  return saida;
}

/**
 * Alinha duas séries pelo TEMPO, devolvendo só os instantes que existem nas duas.
 *
 * ⚠️ **Alinhar por tempo e não por índice** é a diferença entre medir e inventar. Dois ativos
 * não têm o mesmo número de barras: feriado de um mercado não é do outro, ação para de
 * negociar antes do futuro, e um começou depois. Pareando por posição, o retorno da PETR4 de
 * terça seria comparado com o do WIN de quarta — e a correlação sairia um número plausível
 * medindo coisa nenhuma.
 *
 * Devolve pares na ordem crescente de tempo. Série com tempo repetido: a primeira ocorrência
 * vence (é o mesmo desempate do resto da biblioteca).
 */
export function alinharPorTempo(
  a: readonly BarraComparavel[],
  b: readonly BarraComparavel[],
): readonly { readonly time: number; readonly a: number; readonly b: number }[] {
  const porTempo = new Map<number, number>();
  for (const x of b) {
    if (!Number.isFinite(x.time) || !Number.isFinite(x.close)) continue;
    if (!porTempo.has(x.time)) porTempo.set(x.time, x.close);
  }
  const pares: { time: number; a: number; b: number }[] = [];
  const vistos = new Set<number>();
  for (const x of a) {
    if (!Number.isFinite(x.time) || !Number.isFinite(x.close)) continue;
    if (vistos.has(x.time)) continue;
    const y = porTempo.get(x.time);
    if (y === undefined) continue;
    vistos.add(x.time);
    pares.push({ time: x.time, a: x.close, b: y });
  }
  pares.sort((p, q) => p.time - q.time);
  return pares;
}

export interface ResultadoDeCorrelacao {
  /** Pearson em `-1..1`, ou `null` quando não há amostra suficiente. */
  readonly coeficiente: number | null;
  /** Quantos pares de RETORNO entraram na conta. */
  readonly amostras: number;
  /** Leitura em pt-BR do que o coeficiente significa. */
  readonly leitura: string;
}

/** Mínimo de pares para o número significar algo. Ver `correlacaoDeRetornos`. */
export const MIN_AMOSTRAS_CORRELACAO = 20;

/**
 * Correlação de Pearson entre os RETORNOS de duas séries.
 *
 * ⭐⭐ **Sobre RETORNO, e nunca sobre PREÇO.** Correlacionar preço de dois ativos que ambos
 * subiram no período dá quase 1 — mesmo que um tenha subido em janeiro e o outro em dezembro.
 * É a correlação espúria clássica: ela mede tendência comum, não movimento conjunto. O que o
 * operador quer saber é *"quando um sobe hoje, o outro sobe hoje?"*, e isso é retorno.
 *
 * ⚠️ Menos de `MIN_AMOSTRAS_CORRELACAO` pares devolve `null`, e não um número. Pearson com 3
 * pontos produz facilmente 0,98 por acaso — e um número forte com amostra fraca é pior que
 * nenhum número, porque parece evidência.
 *
 * ⚠️ Série constante (variância zero) também devolve `null`: o denominador é zero, e qualquer
 * valor devolvido ali seria invenção. Acontece de verdade — um ativo que não negociou no
 * período tem fechamento repetido.
 */
export function correlacaoDeRetornos(
  a: readonly BarraComparavel[],
  b: readonly BarraComparavel[],
): ResultadoDeCorrelacao {
  const pares = alinharPorTempo(a, b);
  // Retornos simples entre barras CONSECUTIVAS do conjunto alinhado.
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < pares.length; i++) {
    const p = pares[i - 1]!;
    const q = pares[i]!;
    if (p.a === 0 || p.b === 0) continue;
    const da = (q.a - p.a) / p.a;
    const db = (q.b - p.b) / p.b;
    if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
    ra.push(da);
    rb.push(db);
  }

  const n = ra.length;
  if (n < MIN_AMOSTRAS_CORRELACAO) {
    return { coeficiente: null, amostras: n, leitura: 'Amostra insuficiente' };
  }

  let somaA = 0;
  let somaB = 0;
  for (let i = 0; i < n; i++) {
    somaA += ra[i]!;
    somaB += rb[i]!;
  }
  const mediaA = somaA / n;
  const mediaB = somaB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i]! - mediaA;
    const db = rb[i]! - mediaB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  if (!(denom > 0)) {
    return { coeficiente: null, amostras: n, leitura: 'Série sem variação' };
  }

  // Recorte em [-1,1]: erro de ponto flutuante pode devolver 1.0000000000000002, e um
  // coeficiente maior que 1 na tela destrói a confiança no número inteiro.
  const r = Math.max(-1, Math.min(1, cov / denom));
  return { coeficiente: r, amostras: n, leitura: leituraDeCorrelacao(r) };
}

/**
 * O que o coeficiente significa, em pt-BR.
 *
 * ⚠️ As faixas são declaradas aqui e não configuráveis: um "forte" que muda de significado por
 * configuração deixa de ser comparável entre pares de ativos, que é a única coisa que ele
 * oferece. E o sinal aparece no texto, não só no número — "forte" sem dizer se é a favor ou
 * contra é a metade errada da informação.
 */
export function leituraDeCorrelacao(r: number): string {
  const forca = Math.abs(r);
  const sentido = r >= 0 ? 'a favor' : 'inversa';
  if (forca >= 0.7) return `Forte, ${sentido}`;
  if (forca >= 0.4) return `Moderada, ${sentido}`;
  if (forca >= 0.15) return `Fraca, ${sentido}`;
  return 'Sem relação clara';
}
