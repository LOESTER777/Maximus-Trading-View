/**
 * Escala de cor da camada de bookmap — spec `bookmap-no-mapa-de-decisao`,
 * tarefa 2.5. Requisitos 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10, 2.11.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Função pura: dado um vetor de quantidades, devolve a escala (`p50`, `p99`) e
 * converte quantidade em opacidade. Sem DOM, sem relógio, sem sorteio, sem I/O
 * e **sem estado de módulo** — as únicas ligações no escopo do arquivo são
 * constantes numéricas imutáveis. Chamar duas vezes com a mesma entrada devolve
 * a mesma saída, sempre (requisito 2.1).
 *
 * Em tempo de execução este módulo **não importa nada**: a única importação é de
 * tipo (`import type`), apagada na compilação. Sem importação não há fechamento
 * transitivo, então o arquivo é estruturalmente incapaz de alcançar qualquer
 * outro subsistema, e não carrega credencial, identificador nem endereço de
 * espécie alguma (requisito 12.1). Todo insumo entra por parâmetro.
 *
 * Nenhum dado é lido de arquivo, em CSV ou em qualquer outro formato.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE PERCENTIL, E NÃO O MÁXIMO — a aritmética que decide
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medido nas 22.721 células com fila maior que zero do pregão de referência:
 *
 *     p50      481 ct
 *     p90      714 ct
 *     p99    1.131 ct
 *     max   36.232 ct     ← 32× o p99, 50× o p90
 *
 * Normalizando linearmente pelo máximo, a célula de p90 receberia
 * `714 / 36.232 = 2,0%` de opacidade: **a parede fica invisível**. Isso é
 * aritmética, não preferência estética, e é o argumento inteiro contra a escala
 * linear global.
 *
 * E o máximo não é parede: é **nível cruzado** — venda 10% abaixo do mercado
 * (36.232 ct em 160.040, com o mercado em 177.000) e compra 10% acima. Ofertas
 * assim seriam executáveis no instante em que existissem: artefato de
 * agregação, não liquidez. Dentro da banda de ±2.000 pts do miolo, que
 * concentra 97,1% das células, o máximo real é 2.442 ct — 15× menor.
 *
 * Log puro foi rejeitado por comprimir justamente 400↔800 ct, a faixa onde o
 * operador decide: é bom para 6 ordens de grandeza, e aqui há ~1,4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE `gamma = 0,5` — é o que faz o piso de 30% caber
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O requisito 2.11 exige que a quantidade igual ao `p90` da janela receba pelo
 * menos **30% da amplitude** entre `alphaMin` e `alphaMax`. Com os números
 * medidos, a posição relativa do p90 na escala é
 *
 *     t = (714 − 481) / (1.131 − 481) = 233 / 650 = 0,358
 *
 * Numa rampa **linear** o p90 receberia 35,8% — apenas 5,8 pontos acima do
 * piso, margem que qualquer variação de distribuição consumiria. Com a raiz,
 * `0,358^0,5 = 0,599`, ou seja **59,9%**: quase o dobro do piso.
 *
 * Dito de outro jeito: com `gamma = 0,5` o piso de 30% passa a exigir só
 * `t ≥ 0,09`, isto é `p90 − p50 ≥ 0,09 × (p99 − p50)`. No caso medido isso é
 * `233 ≥ 58,5` — folga de 4×. **A curva de potência não é enfeite; é o
 * mecanismo que sustenta o requisito.**
 *
 * ⚠️ Limite conhecido e declarado: numa distribuição em que o `p90` coincida
 * com o `p50` (massa concentrada num valor único e cauda longa e rala), `t = 0`
 * e a opacidade cai para `alphaMin`. Nesse caso o requisito 2.11 pede 30% da
 * amplitude para uma quantidade que o requisito 2.3 obriga a receber `alphaMin`
 * — os dois só são satisfazíveis ao mesmo tempo quando `p90 > p50`. A escolha
 * aqui é honrar o 2.3 (monotonicidade e piso no p50), porque é ele que impede a
 * camada de mentir. Quem escrever a propriedade da tarefa 2.7 deve gerar
 * amostras com dispersão, que é a forma do dado real.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTATÍSTICA DE ORDEM, E NÃO INTERPOLAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O percentil é o **posto** `ceil(q × n) − 1` da amostra ordenada, colhido por
 * seleção parcial. Isso é o que dá a robustez que o requisito 2.11 exige, e dá
 * de graça:
 *
 *     idx(n)   = ceil(q·n) − 1
 *     idx(n+1) = ceil(q·n + q) − 1        com 0 < q ≤ 1
 *     ⇒ idx(n+1) − idx(n) ∈ {0, 1}
 *
 * Inserir **um** valor arbitrariamente grande cresce a amostra de `n` para
 * `n+1` e o desloca para o topo da ordenação, então todo posto abaixo dele fica
 * intacto e o posto do p99 anda no máximo **uma** casa. Nos números medidos:
 * `idx99` sai de 22.493 para 22.494 — um posto, exatamente o teto do requisito.
 *
 * Interpolação linear entre postos vizinhos não teria essa garantia, e
 * normalizar pelo máximo não teria garantia nenhuma.
 *
 * `p50 ≤ p99` é **estrutural**, não conferido no fim: como `ceil` é monótona,
 * `idx50 ≤ idx99`; o p99 é selecionado primeiro e o p50 é selecionado depois
 * **dentro do prefixo** `[0, idx99]`, que após a primeira seleção contém
 * exatamente os `idx99 + 1` menores elementos. Sai mais barato e sai correto
 * por construção.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ZEROS FORA DA AMOSTRA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Célula vazia não é liquidez fraca: é **ausência** de liquidez. Incluí-la
 * derruba o p50 artificialmente e clareia o desenho inteiro. Zero fica fora da
 * amostra dos percentis e recebe `alphaMin` (requisito 2.2).
 *
 * Consequência que a implementação explora: como só entram valores maiores que
 * zero, uma amostra não vazia tem `p99 > 0` necessariamente. Logo `p99 === 0`
 * identifica **amostra vazia** sem precisar de campo novo em `ColorScale` — é o
 * que permite distinguir "não havia nada para medir" (`count === 0`, tudo
 * recebe `alphaMin`) de "a janela não tem variação de magnitude" (`p99 === p50`
 * com os dois positivos, quantidade positiva recebe `alphaMax`, requisito
 * 2.10). Sem essa distinção as duas regras se contradiriam.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPLEXIDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O(n) por seleção parcial com particionamento de três vias e pivô pela **nona**
 * (mediana de três medianas-de-três) — não O(n log n) de ordenação completa.
 *
 * O particionamento de três vias não é preciosismo: quantidade em repouso
 * repete muito, e amostra inteiramente igual resolve numa única passada em vez
 * de degradar. A nona também não: com pivô de três amostras a entrada já
 * ordenada custava **62 n** em vez de 4 n — ver `choosePivot`, que traz a
 * medição. Os dois são determinísticos, o que o requisito 2.1 exige.
 *
 * Alvo de desempenho: ≤ 3 ms sobre 25.823 células. Chamada no repouso do
 * arrasto (debounce de 120 ms), nunca por quadro.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import type { ColorScale } from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Piso de opacidade. **Não é zero de propósito**: o requisito 2.4 manda
 * desenhar a célula de quantidade inválida com a opacidade mínima "em vez de
 * omiti-la", e `alpha = 0` a omitiria de fato, em silêncio.
 */
export const BOOKMAP_ALPHA_MIN_DEFAULT = 0.18;
/*
 * ⚠️ **0,18, e não 0,06 — corrigido em 03/09/2026 com o operador olhando a tela.**
 *
 * O piso vale para toda célula com quantidade até o `p50` da janela visível, e
 * "até o p50" é, por definição de percentil, **metade das células**. Com 0,06,
 * metade do heatmap era pintada a 6% de opacidade sobre fundo escuro e ATRÁS das
 * velas: invisível. O relato foi "só aparece umas objetos sem definição na tela",
 * e ele estava certo — a camada desenhava, e não dava para ver.
 *
 * É o mesmo defeito que atingiu o raio da bolha, por outro caminho: tratar o p50
 * como piso da escala visual desperdiça metade da distribuição. Aqui a correção é
 * elevar o piso; lá foi normalizar a partir de zero.
 *
 * Não sobe mais que isso porque o teto é 0,92 e a amplitude precisa continuar
 * grande o suficiente para os 16 níveis se distinguirem — e porque a camada é
 * CONTEXTO: ela não pode competir com a vela.
 */

/**
 * Teto de opacidade. Abaixo de 1 para a parede saturada não virar bloco opaco
 * que apaga a vela por baixo dela.
 */
export const BOOKMAP_ALPHA_MAX_DEFAULT = 0.92;

/** Expoente da curva de potência. `0,5` = raiz. Ver o cabeçalho. */
export const BOOKMAP_GAMMA_DEFAULT = 0.5;

/** Quantil do piso da escala. */
const QUANTILE_LOW = 0.5;

/** Quantil do teto da escala. */
const QUANTILE_HIGH = 0.99;

/**
 * Faixa admitida para `gamma`. O limite inferior é o que impede `gamma = 0`, em
 * que `0^0 === 1` faria toda quantidade abaixo do p50 saltar para `alphaMax` e
 * quebrar o requisito 2.3.
 */
const GAMMA_MIN = 0.05;
const GAMMA_MAX = 8;

// ═════════════════════════════════════════════════════════════════════════════
// Opções
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Ajustes opcionais da escala. Shape idêntico ao parâmetro `opts` do design;
 * nomeado apenas para ser reaproveitado pelas duas funções de construção.
 *
 * Todo campo ausente, não finito ou fora de faixa cai no default — a escala
 * produzida **nunca** carrega valor inválido adiante.
 */
export interface ColorScaleOptions {
  readonly alphaMin?: number;
  readonly alphaMax?: number;
  readonly gamma?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Saneamento de entrada
// ═════════════════════════════════════════════════════════════════════════════

/** Quantas posições de `values` são realmente válidas. */
function sanitizeCount(length: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const truncated = Math.floor(count);
  return truncated < length ? truncated : length;
}

/** Recorta opacidade a `[0, 1]`; ausente ou não finita cai no default. */
function clampAlpha(raw: number | undefined, fallback: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * `gamma` sempre estritamente positiva e finita — é o que preserva a
 * monotonicidade de `alphaOf` (requisito 2.3) mesmo com escala montada à mão.
 */
function sanitizeGamma(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return BOOKMAP_GAMMA_DEFAULT;
  }
  if (raw < GAMMA_MIN) return GAMMA_MIN;
  if (raw > GAMMA_MAX) return GAMMA_MAX;
  return raw;
}

/** Leitura de escala tolerante a campo não finito, sem deixar `NaN` escapar. */
function finiteOrZero(raw: number): number {
  return Number.isFinite(raw) ? raw : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Seleção parcial — O(n), determinística
// ═════════════════════════════════════════════════════════════════════════════

function swap(a: Float32Array, i: number, j: number): void {
  const tmp = a[i] ?? 0;
  a[i] = a[j] ?? 0;
  a[j] = tmp;
}

/** Mediana de três valores. Sem alocação, sem ramificação inútil. */
function median3(x: number, y: number, z: number): number {
  if (x < y) {
    if (y < z) return y;
    return x < z ? z : x;
  }
  if (x < z) return x;
  return y < z ? z : y;
}

/**
 * Intervalo curto é resolvido por ordenação por inserção em vez de mais uma
 * rodada de particionamento. Corta a cauda de passadas minúsculas, e em
 * intervalo desse tamanho a inserção é mais rápida que a partição.
 */
const INSERTION_CUTOFF = 16;

/** Abaixo disto o pivô sai de três amostras; acima, de nove. */
const NINTHER_CUTOFF = 64;

/**
 * Escolha do pivô — **determinística**, porque sorteio quebraria a
 * reprodutibilidade que o requisito 2.1 exige.
 *
 * ⚠️ Mediana de **três** (extremos e centro) não basta, e isto foi medido, não
 * suposto. A partição de três vias move o menor elemento restante para o topo
 * do intervalo ao trocar `i` com `gt`; num vetor crescente isso faz a amostra
 * de três cair sistematicamente perto do **mínimo**, cada passada descarta ~1
 * elemento e o custo explode:
 *
 * Medido com `n = 25.823`, iterações do laço de partição:
 *
 *     entrada         com 3 amostras      com a nona
 *     aleatória        4,35 n              4,78 n
 *     toda igual       1,99 n              1,99 n
 *     crescente       62,47 n   ← 182 passadas    3,98 n   ← 26 passadas
 *     decrescente     28,58 n   ← 141 passadas    3,99 n   ← 28 passadas
 *
 * A correção é a **nona** (mediana de três medianas-de-três, Bentley–McIlroy):
 * nove amostras espalhadas pelo intervalo não colapsam com esse padrão, porque
 * nenhuma posição isolada determina o pivô. Custa oito leituras a mais por
 * passada, é indiferente no caso aleatório e traz os dois casos ordenados de
 * volta para ~4 n. Em tempo de parede, o vetor crescente saiu de **3,34 ms**
 * para **0,30 ms** — de fora para dentro do alvo de 3 ms.
 *
 * ⚠️ Não trocar por mediana de três "porque é mais simples": a degeneração não
 * aparece no dado aleatório do banco de testes, só na entrada quase ordenada,
 * que é justamente a que a agregação por zoom pode produzir.
 */
function choosePivot(a: Float32Array, lo: number, hi: number): number {
  const len = hi - lo + 1;
  const mid = lo + (len >> 1);

  if (len < NINTHER_CUTOFF) {
    return median3(a[lo] ?? 0, a[mid] ?? 0, a[hi] ?? 0);
  }

  // `len >= 64` ⇒ `step >= 8`, então todos os nove índices caem dentro de
  // `[lo, hi]`: o mais baixo é `lo` e o mais alto é `hi`.
  const step = len >> 3;
  const low = median3(a[lo] ?? 0, a[lo + step] ?? 0, a[lo + 2 * step] ?? 0);
  const center = median3(a[mid - step] ?? 0, a[mid] ?? 0, a[mid + step] ?? 0);
  const high = median3(a[hi - 2 * step] ?? 0, a[hi - step] ?? 0, a[hi] ?? 0);
  return median3(low, center, high);
}

/** Ordena `a[lo..hi]` por inserção. Usada só em intervalo curto. */
function insertionSort(a: Float32Array, lo: number, hi: number): void {
  for (let i = lo + 1; i <= hi; i += 1) {
    const v = a[i] ?? 0;
    let j = i - 1;
    while (j >= lo && (a[j] ?? 0) > v) {
      a[j + 1] = a[j] ?? 0;
      j -= 1;
    }
    a[j + 1] = v;
  }
}

/**
 * Reordena `a[lo..hi]` no lugar até que `a[k]` seja o `k`-ésimo menor do
 * intervalo, e que todo elemento antes de `k` seja menor ou igual a ele e todo
 * elemento depois seja maior ou igual.
 *
 * Particionamento de três vias (menor / igual / maior). Amostra inteiramente
 * igual cai toda na faixa central e a busca termina na primeira passada, em vez
 * de degradar para O(n²) — caso frequente aqui, porque quantidade em repouso
 * repete muito.
 *
 * Iterativa de propósito: recursão de cauda em amostra de 50 mil posições não
 * precisa consumir pilha.
 *
 * Pré-condição: `a` sem valor não finito (garantida por `collectPositive`), sem
 * a qual um `NaN` envenenaria as comparações.
 */
function selectKth(a: Float32Array, k: number, lo: number, hi: number): void {
  let l = lo;
  let h = hi;

  while (l < h) {
    if (h - l + 1 <= INSERTION_CUTOFF) {
      insertionSort(a, l, h);
      return;
    }

    const pivot = choosePivot(a, l, h);

    // Invariante do laço: a[l..lt-1] < pivô, a[lt..i-1] === pivô,
    // a[gt+1..h] > pivô, e a[i..gt] ainda não classificado.
    let lt = l;
    let gt = h;
    let i = l;

    while (i <= gt) {
      const v = a[i] ?? 0;
      if (v < pivot) {
        swap(a, i, lt);
        lt += 1;
        i += 1;
      } else if (v > pivot) {
        swap(a, i, gt);
        gt -= 1;
      } else {
        i += 1;
      }
    }

    // A faixa central é sempre não vazia (contém o próprio pivô), então cada
    // volta encurta estritamente `[l, h]` — o laço termina.
    if (k < lt) {
      h = lt - 1;
    } else if (k > gt) {
      l = gt + 1;
    } else {
      return;
    }
  }
}

/**
 * Quantil pedido, recortado a `(0, 1]`.
 *
 * Valor não finito, negativo ou zero cai em `1` — o **máximo** da amostra. É a
 * direção conservadora para quem usa o quantil como limiar de corte: limiar
 * alto seleciona menos, e selecionar de menos é preferível a selecionar de
 * mais a partir de parâmetro corrompido.
 */
function sanitizeQuantile(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return 1;
  return raw;
}

/** Posto da estatística de ordem que representa o quantil `q`. */
function quantileIndex(q: number, n: number): number {
  const idx = Math.ceil(q * n) - 1;
  if (idx < 0) return 0;
  if (idx > n - 1) return n - 1;
  return idx;
}

// ═════════════════════════════════════════════════════════════════════════════
// Amostragem
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Copia para `out`, a partir de `offset`, as quantidades finitas e maiores que
 * zero de `values[0..n)`. Devolve a nova posição de escrita.
 *
 * A cópia existe para que a seleção parcial possa reordenar à vontade: o vetor
 * recebido pertence ao grid e **não é mutado** em nenhuma circunstância.
 */
function collectPositive(
  out: Float32Array,
  offset: number,
  values: Float32Array,
  n: number,
): number {
  let w = offset;
  for (let i = 0; i < n; i += 1) {
    const v = values[i] ?? 0;
    if (v > 0 && Number.isFinite(v)) {
      out[w] = v;
      w += 1;
    }
  }
  return w;
}

/** Escala degenerada: nada a medir. `p99 === 0` é a marca dessa condição. */
function emptyScale(alphaMin: number, alphaMax: number, gamma: number): ColorScale {
  return { p50: 0, p99: 0, alphaMin, alphaMax, gamma };
}

/**
 * Núcleo compartilhado pelas duas funções públicas de construção. Recebe a
 * amostra **já copiada** (e pode reordená-la) com `n` posições válidas.
 */
function scaleFromSample(
  sample: Float32Array,
  n: number,
  opts?: ColorScaleOptions,
): ColorScale {
  let alphaMin = clampAlpha(opts?.alphaMin, BOOKMAP_ALPHA_MIN_DEFAULT);
  let alphaMax = clampAlpha(opts?.alphaMax, BOOKMAP_ALPHA_MAX_DEFAULT);

  // O requisito 2.3 exige `0 ≤ alphaMin < alphaMax ≤ 1` — estrito. Par que
  // colapsa o intervalo volta aos defaults em bloco, para não produzir escala
  // de amplitude nula.
  if (!(alphaMin < alphaMax)) {
    alphaMin = BOOKMAP_ALPHA_MIN_DEFAULT;
    alphaMax = BOOKMAP_ALPHA_MAX_DEFAULT;
  }

  const gamma = sanitizeGamma(opts?.gamma);

  if (n <= 0) return emptyScale(alphaMin, alphaMax, gamma);

  const idxHigh = quantileIndex(QUANTILE_HIGH, n);
  const idxLow = quantileIndex(QUANTILE_LOW, n);

  // Teto primeiro: depois desta seleção, `sample[0..idxHigh]` é exatamente o
  // conjunto dos `idxHigh + 1` menores elementos da amostra.
  selectKth(sample, idxHigh, 0, n - 1);
  const p99 = sample[idxHigh] ?? 0;

  // Piso restrito a esse prefixo — mais barato, e `p50 ≤ p99` sai por
  // construção em vez de por conferência posterior.
  let p50 = p99;
  if (idxLow < idxHigh) {
    selectKth(sample, idxLow, 0, idxHigh);
    p50 = sample[idxLow] ?? 0;
  }

  return { p50, p99, alphaMin, alphaMax, gamma };
}

// ═════════════════════════════════════════════════════════════════════════════
// API pública
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Deriva a escala de cor de **uma** grandeza a partir das células da janela
 * visível (requisito 2.1).
 *
 * `values` é a coluna de quantidades já recortada à janela; `count` diz quantas
 * posições valem — o vetor pode ter capacidade maior que o preenchido, e ler
 * além disso traria zeros que não são dado.
 *
 * Não muta `values`. `count` não finito, negativo ou acima do comprimento é
 * saneado em vez de rejeitado.
 *
 * @returns escala com `p50 ≤ p99`, `0 ≤ alphaMin < alphaMax ≤ 1` e `gamma > 0`.
 *   Amostra vazia devolve `p50 = p99 = 0`, e então `alphaOf` responde
 *   `alphaMin` para qualquer quantidade. Nunca devolve `NaN`.
 */
export function computeColorScale(
  values: Float32Array,
  count: number,
  opts?: ColorScaleOptions,
): ColorScale {
  const n = sanitizeCount(values.length, count);
  const sample = new Float32Array(n);
  const sampled = collectPositive(sample, 0, values, n);
  return scaleFromSample(sample, sampled, opts);
}

/**
 * Deriva **uma única escala compartilhada** pelos dois lados de uma mesma
 * grandeza (requisito 2.9).
 *
 * É por aqui que a fila de compra e a fila de venda entram na mesma amostra de
 * percentis, o que garante que duas células de igual quantidade em lados
 * opostos recebam opacidade igual — se cada lado tivesse escala própria, uma
 * parede de 800 ct pareceria maior ou menor conforme o lado, e a comparação que
 * o operador faz de relance passaria a ser inválida.
 *
 * O mesmo requisito exige o oposto entre grandezas: fila e execução são
 * medidas diferentes e **não** podem cair na mesma amostra. Isso se cumpre pelo
 * uso — duas chamadas, uma por grandeza —, e é o motivo de esta função receber
 * só um par de colunas em vez de todas as quatro.
 *
 * `count` é único porque as colunas do grid são paralelas: a posição `k` é a
 * mesma célula em ambas.
 */
export function computeColorScalePair(
  sideA: Float32Array,
  sideB: Float32Array,
  count: number,
  opts?: ColorScaleOptions,
): ColorScale {
  const nA = sanitizeCount(sideA.length, count);
  const nB = sanitizeCount(sideB.length, count);
  const sample = new Float32Array(nA + nB);
  let sampled = collectPositive(sample, 0, sideA, nA);
  sampled = collectPositive(sample, sampled, sideB, nB);
  return scaleFromSample(sample, sampled, opts);
}

/**
 * Converte quantidade em opacidade.
 *
 *     t        = clamp((q − p50)/(p99 − p50), 0, 1)
 *     alpha(q) = clamp(alphaMin + (alphaMax − alphaMin) × t^gamma,
 *                      alphaMin, alphaMax)
 *
 * **Monotônica não-decrescente sobre quantidades finitas** (requisito 2.3): a
 * posição relativa cresce com `q`, elevar a expoente positivo preserva a
 * ordem, e a amplitude é não negativa. Esta é a propriedade que impede a camada
 * de mentir — sem ela uma parede maior poderia aparecer mais clara que uma
 * menor, e o operador leria o inverso da realidade.
 *
 * ⚠️ **O recorte externo não é redundante, e essa foi a lição.** O argumento de
 * monotonicidade acima é válido em números reais e **falso em ponto flutuante**:
 * `Math.pow` satura em `1` exato para `t` a poucos ulps abaixo de 1, e a soma
 * `alphaMin + (alphaMax − alphaMin)` não reconstrói `alphaMax` — com os
 * defaults ela dá `0,9200000000000002`. Sem o recorte, a quantidade um ulp
 * abaixo do `p99` ficava **mais opaca** que o próprio `p99`, ou seja a
 * propriedade que a função existe para garantir era violada por ela mesma. Ver
 * o comentário no corpo.
 *
 * Casos de borda, todos finitos e definidos:
 *
 * | entrada | resposta | por quê |
 * |---|---|---|
 * | não finita (`NaN`, `±Infinity`) | `alphaMin` | requisito 2.4 — `NaN` pintaria transparente e a célula sumiria em silêncio |
 * | negativa | `alphaMin` | requisito 2.4 |
 * | zero | `alphaMin` | requisito 2.2 — ausência de liquidez |
 * | `≤ p50` | `alphaMin` | requisito 2.3 |
 * | `≥ p99` | `alphaMax` | requisito 2.3 |
 * | qualquer, com `p99 === p50 > 0` | `alphaMax` se positiva | requisito 2.10 |
 * | qualquer, com `p99 === 0` | `alphaMin` | amostra vazia |
 *
 * ⚠️ A monotonicidade vale sobre o domínio **finito**, e é assim que o
 * requisito 2.3 a enuncia. Ela não se estende a `+Infinity`, que o requisito
 * 2.4 manda tratar como `alphaMin`: as duas regras só coexistem porque a
 * primeira é qualificada. Quem escrever a propriedade da tarefa 2.6 precisa
 * gerar pares finitos para o caso da ordem, e cobrir o não finito à parte.
 *
 * Tolerante a `ColorScale` montada à mão (é o que os testes de propriedade
 * fazem): campo não finito é saneado e limites que colapsam o intervalo
 * resultam em resposta constante `alphaMin`. Nunca lança, nunca devolve `NaN`.
 *
 * Sem alocação — roda no laço de desenho, onde uma pausa de coleta de lixo
 * apareceria como engasgo durante o arrasto.
 */
export function alphaOf(scale: ColorScale, value: number): number {
  const alphaMin = clampAlpha(scale.alphaMin, BOOKMAP_ALPHA_MIN_DEFAULT);
  const alphaMaxRaw = clampAlpha(scale.alphaMax, BOOKMAP_ALPHA_MAX_DEFAULT);
  // Limites incoerentes achatam a escala em vez de produzir amplitude negativa,
  // o que manteria o resultado monotônico mas invertido.
  const alphaMax = alphaMaxRaw > alphaMin ? alphaMaxRaw : alphaMin;

  // Cobre de uma vez: não finita, negativa e zero.
  if (!Number.isFinite(value) || value <= 0) return alphaMin;

  const p50 = finiteOrZero(scale.p50);
  const p99 = finiteOrZero(scale.p99);

  if (p99 > p50) {
    const t = (value - p50) / (p99 - p50);
    if (t <= 0) return alphaMin;
    if (t >= 1) return alphaMax;

    const interpolated =
      alphaMin + (alphaMax - alphaMin) * Math.pow(t, sanitizeGamma(scale.gamma));

    // ⚠️ **O recorte conserta um defeito medido, não uma preocupação teórica.**
    //
    // `Math.pow(t, gamma)` satura em `1` exato para `t` a poucos ulps abaixo de
    // 1, e aí a interpolação vira `alphaMin + (alphaMax − alphaMin)` — que
    // **não** reproduz `alphaMax` em ponto flutuante: com os defaults,
    // `0,92 − 0,06 = 0,8600000000000001` e `0,06 + 0,8600000000000001 =
    // 0,9200000000000002`, um ulp acima do teto.
    //
    // Varrendo os 4096 passos de precisão abaixo de 1, isso acontece com `gamma`
    // em `0,05`, `0,1` e `0,25` — todos dentro da faixa que `sanitizeGamma`
    // admite, logo **alcançável por configuração, sem mudar código**.
    //
    // Duas coisas quebravam, não uma: o intervalo do requisito 2.3 e a **própria
    // monotonicidade**, porque a quantidade um ulp abaixo do `p99` recebia
    // `0,9200000000000002` enquanto o `p99` recebe `alphaMax` pelo ramo acima —
    // a fila MAIOR saía mais opaca que a menor. E a jusante o desenho por lote
    // calcula `floor(((alpha − alphaMin)/(alphaMax − alphaMin)) × 16)`, que daria
    // `16` numa tabela de 16 posições: índice fora da faixa, estilo `undefined`,
    // `fillStyle` mantendo a cor anterior — a parede mais forte pintada com a cor
    // errada, sem lançar e sem aparecer em log.
    //
    // Recortar **preserva a ordem**: o recorte é monótono não-decrescente e a
    // composição de monótonas é monótona. Verificado por varredura: a versão sem
    // recorte tinha 4 inversões de ordem na vizinhança do teto; com recorte, zero.
    //
    // ⚠️ Interpolar pelo outro lado (`alphaMax − amplitude × (1 − pow)`) devolve
    // `alphaMax` exato e foi **descartado por ser pior**: troca o estouro do teto
    // por um furo no piso (`0,92 − 0,8600000000000001 = 0,05999999999999994`) e o
    // furo aparece com `gamma = 0,5`, o **default de produção** — enquanto o
    // defeito original só aparecia com `gamma ≤ 0,25`. Além disso a subtração
    // `1 − pow` perde precisão justamente no pé da rampa, onde está a maioria das
    // células.
    if (interpolated > alphaMax) return alphaMax;

    // O piso é estruturalmente inalcançável aqui (amplitude não negativa, `pow`
    // positiva, soma corretamente arredondada), e a varredura não achou um caso.
    // Fica explícito para que o contrato de faixa da função seja legível na
    // própria função, em vez de depender de raciocínio sobre arredondamento.
    return interpolated < alphaMin ? alphaMin : interpolated;
  }

  // `p99 === p50`. Como zero fica fora da amostra, `p99 === 0` só acontece com
  // amostra vazia — aí não há magnitude alguma para representar.
  if (p99 <= 0) return alphaMin;

  // Janela sem variação de magnitude: quantidade positiva satura (requisito
  // 2.10). A quantidade não positiva já saiu pelo guard acima.
  return alphaMax;
}

/**
 * Quantil arbitrário das quantidades **positivas** de duas colunas paralelas,
 * pela mesma estatística de ordem que sustenta `computeColorScale`.
 *
 * Existe para que a detecção de paredes (requisito 6.1, percentil 90 das
 * células de fila não nula) **não escreva um segundo seletor**. O seletor desta
 * casa já é O(n), determinístico e endurecido contra a degeneração medida em
 * `choosePivot`; duplicá-lo lá significaria duas implementações do mesmo
 * percentil, livres para divergir — e a divergência apareceria como parede
 * desenhada com uma intensidade e listada no card com outro critério.
 *
 * ⚠️ **Escopo diferente do da escala de cor, de propósito.** `computeColorScale`
 * mede a **janela visível**, porque a cor tem de responder ao que o operador
 * está olhando. O limiar de parede mede o **grid inteiro**: uma parede não deixa
 * de ser parede porque o operador deu zoom, e um limiar que mudasse com o zoom
 * faria a lista do card aparecer e desaparecer sem o dado mudar. Quem chama
 * escolhe o escopo pelo par de colunas e pelo `count` que passa.
 *
 * Herda o resto do contrato de `computeColorScale`: zero fica fora da amostra
 * (ausência de liquidez não é liquidez fraca), `values` **não é mutado**,
 * `count` inválido é saneado, e nunca devolve `NaN`.
 *
 * @returns o valor no posto `ceil(q × n) − 1` da amostra positiva ordenada, ou
 *   `0` quando não houver nenhuma quantidade positiva. Como a amostra só admite
 *   valores maiores que zero, `0` identifica sem ambiguidade a amostra vazia.
 */
/**
 * Como duas colunas paralelas se combinam numa grandeza DERIVADA.
 *
 * ⭐ Existe porque as métricas `DELTA` e `VOLUME` não são colunas do grid: são contas sobre
 * `execCompra` e `execVenda`. A escala delas precisa dos percentis da grandeza COMBINADA — usar
 * a escala de `EXECUCAO` calibraria a cor pela distribuição dos lados separados, e a
 * distribuição da soma e a do módulo da diferença não são a mesma.
 *
 * Com números: mil células de 500×500 (compra×venda) dão delta zero e volume 1.000. A escala de
 * `EXECUCAO` teria p99 ≈ 500; o volume real satura em 1.000 e o delta é nulo. Uma pintaria tudo
 * saturado, a outra pintaria tudo no piso.
 */
export type CombinacaoDeColunas =
  /** `|a − b|`. É o DELTA: quanto um lado venceu o outro, sem o sinal. */
  | 'DIFERENCA_ABS'
  /** `a + b`. É o VOLUME total, sem lado. */
  | 'SOMA';

/** Escreve a grandeza combinada positiva na amostra. Devolve a nova marca de escrita. */
function collectCombined(
  out: Float32Array,
  offset: number,
  a: Float32Array,
  b: Float32Array,
  n: number,
  combinacao: CombinacaoDeColunas,
): number {
  let w = offset;
  for (let i = 0; i < n; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    // ⚠️ A combinação é feita ANTES do filtro de positividade, e não depois. `|500 − 500| = 0`
    // sai da amostra por ser zero — que é o correto: delta nulo é equilíbrio, e equilíbrio não
    // tem magnitude a calibrar. Filtrar as colunas primeiro descartaria o par inteiro sempre
    // que um dos lados fosse zero, e é justamente o par `(800, 0)` que define o topo do delta.
    const v = combinacao === 'SOMA' ? va + vb : Math.abs(va - vb);
    if (v > 0 && Number.isFinite(v)) {
      out[w] = v;
      w += 1;
    }
  }
  return w;
}

/**
 * Escala de cor de uma grandeza DERIVADA de duas colunas paralelas.
 *
 * Mesmo contrato de `computeColorScalePair`: não muta as entradas, saneia `count`, nunca devolve
 * `NaN`, e amostra vazia devolve `p50 = p99 = 0` (então `alphaOf` responde `alphaMin` para
 * qualquer valor).
 *
 * ⚠️ A amostra tem **uma** posição por par, e não duas: a grandeza derivada é UMA por célula.
 * Por isso este não é `computeColorScalePair` com outro operador — o tamanho da amostra difere, e
 * o posto do percentil sai de `n`.
 */
export function computeColorScaleOfCombination(
  sideA: Float32Array,
  sideB: Float32Array,
  count: number,
  combinacao: CombinacaoDeColunas,
  opts?: ColorScaleOptions,
): ColorScale {
  const n = Math.min(sanitizeCount(sideA.length, count), sanitizeCount(sideB.length, count));
  const sample = new Float32Array(n);
  const sampled = collectCombined(sample, 0, sideA, sideB, n, combinacao);
  return scaleFromSample(sample, sampled, opts);
}

export function positiveQuantileOfPair(
  sideA: Float32Array,
  sideB: Float32Array,
  count: number,
  quantile: number,
): number {
  const nA = sanitizeCount(sideA.length, count);
  const nB = sanitizeCount(sideB.length, count);
  const sample = new Float32Array(nA + nB);
  let sampled = collectPositive(sample, 0, sideA, nA);
  sampled = collectPositive(sample, sampled, sideB, nB);

  if (sampled <= 0) return 0;

  const idx = quantileIndex(sanitizeQuantile(quantile), sampled);
  selectKth(sample, idx, 0, sampled - 1);
  return sample[idx] ?? 0;
}

/**
 * A quantidade estourou o teto da escala e merece contorno (requisito 2.6)?
 *
 * Exige `p99 > p50`: com a janela sem variação de magnitude, o requisito 2.10
 * manda desenhar **sem** contorno — todas as células estão saturadas e marcar
 * todas não informaria nada.
 *
 * É o predicado que alimenta `DrawCell.aboveScale`. Vive aqui, junto da escala
 * que o define, para que a camada de desenho não redescubra o critério e
 * divirja dele.
 */
export function isAboveScale(scale: ColorScale, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const p50 = finiteOrZero(scale.p50);
  const p99 = finiteOrZero(scale.p99);
  return p99 > p50 && value > p99;
}

/**
 * A janela visível apresenta variação de magnitude?
 *
 * `false` significa que a escala colapsou (`p99 === p50`), o que o requisito
 * 2.10 manda declarar na legenda em pt-BR em vez de deixar o operador
 * interpretar uma tela inteira saturada como se fosse leitura normal.
 *
 * Mesma leitura de limites de `isAboveScale`, de propósito: um único critério
 * para "a escala tem faixa útil".
 */
export function hasMagnitudeVariation(scale: ColorScale): boolean {
  return finiteOrZero(scale.p99) > finiteOrZero(scale.p50);
}
