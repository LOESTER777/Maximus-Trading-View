/**
 * fuzzy.core — busca por subsequencia com pontuacao, PURA e sem terceiros.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A paleta de comandos (`CommandPalette`) precisa achar um entre ~80 comandos
 * (29 indicadores + 8 ferramentas de desenho + tipos de grafico + ambiente) a
 * partir de tres letras digitadas. `String.includes` nao serve: quem digita
 * `"bol"` espera achar **Bollinger**, mas quem digita `"ps"` espera achar
 * **Parabolic SAR** pelas INICIAIS, e `includes('ps')` nao acha nada ali.
 *
 * A alternativa de mercado seria `fuse.js` ou `fzf` — dependencia de runtime
 * proibida neste projeto, e desproporcional: `fuse.js` traz indice invertido e
 * distancia de Levenshtein para um caso onde a lista tem 80 itens curtos e a
 * resposta certa e "subsequencia com bonus posicional".
 *
 * ⚠️ **`.core.ts` e contrato, nao estilo.** Este arquivo e PURO: funcao total e
 * deterministica, sem DOM, sem relogio, sem sorteio, sem estado de modulo. Todo
 * insumo chega por parametro. Isso e o que permite testa-lo sem montar React, e
 * o que permite a paleta reordenar a lista a cada tecla sem medo de efeito.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ A REGRA DE PONTUACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cada letra casada vale `SCORE_MATCH`. Em cima disso vem UM bonus posicional
 * (o maior aplicavel, nunca somados) mais o bonus de contiguidade:
 *
 * | Situacao da letra casada                        | Pontos |
 * |-------------------------------------------------|--------|
 * | casou (base)                                    |  `+16` |
 * | esta no indice 0 do texto (prefixo)             |  `+24` |
 * | comeca palavra (o char anterior nao e letra/num) |  `+20` |
 * | fronteira `camelCase` (`r`->`T` em SupeRTrend)  |  `+14` |
 * | primeiro digito depois de letra (`EMA20`)       |  `+10` |
 * | contigua a letra casada anterior                |  `+18` |
 * | o texto inteiro e igual a busca (`mfi`/`MFI`)   |  `+32` |
 *
 * E as penalidades, todas por caractere PULADO:
 *
 * | Situacao                                          | Pontos |
 * |---------------------------------------------------|--------|
 * | antes da primeira letra casada (`GAP_LEADING`)     |   `-2` (teto -30) |
 * | entre letras casadas (`GAP_INNER`)                 |   `-3` |
 * | depois da ultima letra casada (`GAP_TRAILING`)     |   `-1` |
 *
 * **A leitura das tres penalidades:** pular no meio e o pior (parte a palavra),
 * pular antes e ruim (o casamento nao esta no comeco), e pular depois e quase
 * irrelevante — mas nao zero, porque e o que faz `"ema"` preferir **EMA** a
 * **Envelope de Media Adaptativa** quando as duas casam. Sao os mesmos tres
 * pesos que o `fzy` usa, com a diferenca de que aqui a escala e inteira e os
 * bonus posicionais sao maiores: uma lista de 80 rotulos curtos precisa que
 * "inicio de palavra" domine, e nao que empate com contiguidade.
 *
 * ⚠️ **Nao e busca gulosa.** O casamento otimo e achado por programacao
 * dinamica O(m x n) sobre `needle` x `haystack`, porque a escolha gulosa erra:
 * em `"Media Movel Exponencial"` com a busca `"mme"`, o guloso casa `M`(0)
 * `e`(2) `M`(6) e perde as tres iniciais. Com 80 rotulos de ~25 chars e uma
 * busca de ~4 letras, o DP custa ~8 mil celulas por tecla — invisivel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ACENTO: A ARMADILHA QUE QUEBRA O DESTAQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os rotulos sao pt-BR e tem acento (`"Média Móvel"`, `"Preço típico"`), e quem
 * digita nao acentua. A dobra e `normalize('NFD')` + remocao dos diacriticos
 * (`U+0300..U+036F`), sem lib.
 *
 * ⚠️ **Mas normalizar a STRING INTEIRA desalinha os indices.**
 * `'Média'.normalize('NFD')` tem **6** unidades (o `é` virou `e` + acento
 * combinante) contra 5 do original. Um indice casado na string dobrada aponta
 * para a letra ERRADA na string original, e o negrito da interface aparece
 * deslocado uma casa a partir do primeiro acento. Por isso a dobra e feita
 * **caractere por caractere**, preservando comprimento e mapeamento 1:1 — ver
 * `foldChar`.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Os pesos (ver a tabela no cabecalho)
// ═════════════════════════════════════════════════════════════════════════════

const SCORE_MATCH = 16;
const BONUS_START_OF_STRING = 24;
const BONUS_WORD_START = 20;
const BONUS_CAMEL = 14;
const BONUS_DIGIT_START = 10;
const BONUS_CONSECUTIVE = 18;
const BONUS_EXACT = 32;

/** O que uma letra contigua a anterior vale, no total. */
const SCORE_CONSECUTIVE = SCORE_MATCH + BONUS_CONSECUTIVE;

const GAP_LEADING = -2;
/**
 * Teto da penalidade de entrada.
 *
 * Sem teto, um rotulo longo cujo casamento comeca no fim seria punido de forma
 * proporcional ao comprimento, e a busca deixaria de achar o que esta no final
 * de uma descricao. Com teto, posicoes profundas empatam na entrada e a
 * diferenca passa a vir dos bonus posicionais — que e a informacao util.
 */
const GAP_LEADING_MAX = -30;
const GAP_INNER = -3;
const GAP_TRAILING = -1;

const SCORE_MIN = -Infinity;

/**
 * Acima disto o DP nao e montado e vale o casamento guloso.
 *
 * ⚠️ Nao e otimizacao especulativa: `fuzzyRank` roda em CADA tecla sobre a lista
 * inteira, e nada impede um consumidor de indexar a DESCRICAO de um comando em
 * vez do rotulo. `512 x 64` celulas ja e o limite do que se paga por item sem
 * o campo de busca engasgar. Acima, o guloso devolve um casamento CORRETO
 * (mesma subsequencia) apenas nao otimo em pontuacao — degradacao honesta.
 */
const MAX_DP_CELLS = 512 * 64;

// ═════════════════════════════════════════════════════════════════════════════
// API
// ═════════════════════════════════════════════════════════════════════════════

/** O resultado de um casamento. */
export interface FuzzyMatch {
  /**
   * Quanto melhor, maior. Nao ha escala absoluta: o numero so tem sentido
   * COMPARADO a outro casamento da MESMA busca. Pode ser negativo (casamento
   * ruim), e `0` acontece apenas para busca vazia.
   */
  readonly score: number;
  /**
   * Os trechos casados, em intervalos MEIO-ABERTOS `[inicio, fim)` sobre os
   * indices do `haystack` ORIGINAL (com acento, com a caixa original).
   *
   * Meio-aberto porque e o que `String.prototype.slice` consome direto:
   * `haystack.slice(inicio, fim)` e exatamente o pedaco a destacar. Indices
   * contiguos vem fundidos num intervalo so — `"bol"` em `"Bollinger"` devolve
   * `[[0, 3]]`, e nao tres intervalos de uma letra.
   */
  readonly ranges: readonly [number, number][];
}

/**
 * Casa `needle` como subsequencia de `haystack`, insensivel a caixa e a acento.
 *
 * @returns o casamento, ou `null` quando NAO casa.
 *
 * ⚠️ **`null` e a unica resposta de "nao casa".** Nunca ha `score: 0` ambiguo
 * para nao-casamento: zero e um score legitimo (busca vazia) e um chamador que
 * testasse `if (!m.score)` descartaria casamento valido. Busca vazia devolve
 * `{ score: 0, ranges: [] }` — "sem filtro" casa com tudo, de forma neutra, e e
 * o que faz `fuzzyRank('')` devolver a lista na ordem de entrada.
 *
 * @example
 * fuzzyMatch('bol', 'Bollinger')   // { score: >0, ranges: [[0, 3]] }
 * fuzzyMatch('media', 'Média')     // casa: a dobra remove o acento
 * fuzzyMatch('xyz', 'Bollinger')   // null
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (needle === '') return { score: 0, ranges: [] };
  if (haystack === '') return null;

  const nf = fold(needle);
  const hf = fold(haystack);
  const m = nf.length;
  const n = hf.length;

  // Busca maior que o texto nao pode ser subsequencia dele. Sai antes de alocar.
  if (m > n) return null;

  // Pre-teste guloso: O(n) e responde "nao casa" para a esmagadora maioria dos
  // itens da lista a cada tecla. Sem ele, cada nao-casamento pagaria o DP.
  const guloso = greedyPositions(nf, hf);
  if (guloso === null) return null;

  if (m === n) {
    // Mesmo comprimento + e subsequencia => e o texto inteiro, letra por letra.
    // A pontuacao e a MESMA que o DP daria (prefixo + tudo contiguo, sem pulo
    // nenhum) mais `BONUS_EXACT`; nao e uma escala paralela.
    return {
      score:
        SCORE_MATCH +
        BONUS_START_OF_STRING +
        (m - 1) * SCORE_CONSECUTIVE +
        BONUS_EXACT,
      ranges: [[0, n]],
    };
  }

  if (m * n > MAX_DP_CELLS) {
    // Degradacao documentada (ver `MAX_DP_CELLS`): casamento correto, pontuacao
    // aproximada pela do proprio caminho guloso.
    return { score: scoreOfPath(haystack, hf, guloso), ranges: mergeRanges(guloso) };
  }

  return dpMatch(haystack, hf, nf, m, n);
}

/**
 * Ordena `items` pela relevancia em relacao a `needle`, descartando quem nao
 * casa.
 *
 * ⚠️ **A ordem e TOTAL e nao depende da estabilidade do `sort`.** O empate de
 * pontuacao e resolvido pelo INDICE DE ENTRADA, comparado explicitamente. A
 * especificacao exige `Array.prototype.sort` estavel desde ES2019, mas depender
 * disso amarraria o resultado a um detalhe do motor de JS — e um empate resolvido
 * "por acaso" faz a lista reordenar sozinha entre navegadores, que e o defeito
 * mais confuso possivel numa paleta (o item sob o cursor troca de lugar).
 * Comparar o indice torna a funcao deterministica por construcao.
 *
 * @example
 * fuzzyRank('ema', catalogo, (c) => c.label)  // [{ item, match }, ...]
 */
export function fuzzyRank<T>(
  needle: string,
  items: readonly T[],
  keyOf: (t: T) => string,
): readonly { item: T; match: FuzzyMatch }[] {
  const casados: Array<{ item: T; match: FuzzyMatch; index: number }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const match = fuzzyMatch(needle, keyOf(item));
    if (match === null) continue;
    casados.push({ item, match, index: i });
  }

  casados.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return a.index - b.index;
  });

  return casados.map(({ item, match }) => ({ item, match }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Dobra de caixa e acento
// ═════════════════════════════════════════════════════════════════════════════

/** Os diacriticos combinantes que o NFD separa da letra base. */
const COMBINANTES = /[\u0300-\u036f]/g;

/**
 * Dobra UM caractere: minuscula, sem acento.
 *
 * ⚠️ **Sempre devolve exatamente 1 caractere.** E o que preserva o mapeamento
 * 1:1 de indices entre a string dobrada e a original — sem isso o destaque da
 * interface sai deslocado a partir do primeiro acento (ver o cabecalho).
 *
 * Quando a decomposicao nao rende uma unica letra base (silaba Hangul, que o NFD
 * abre em tres jamos que NAO sao marcas combinantes), a dobra volta ao original
 * em minuscula. Perde-se a insensibilidade naquele caractere; nao se perde o
 * alinhamento, que e o que a interface precisa.
 */
export function foldChar(ch: string): string {
  const minuscula = ch.toLowerCase();
  // `toLowerCase` tambem pode mudar o comprimento (`İ` -> `i̇`, 2 unidades).
  const base = (minuscula.length === 1 ? minuscula : ch).normalize('NFD').replace(COMBINANTES, '');
  return base.length === 1 ? base : minuscula.length === 1 ? minuscula : ch;
}

/** Dobra a string inteira, caractere por caractere. Comprimento preservado. */
function fold(texto: string): string {
  let saida = '';
  for (let i = 0; i < texto.length; i++) saida += foldChar(texto.charAt(i));
  return saida;
}

// ═════════════════════════════════════════════════════════════════════════════
// Bonus posicional
// ═════════════════════════════════════════════════════════════════════════════

/** Letra ou digito, em qualquer alfabeto. O complemento e "separador". */
const LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;
const DIGITO = /\p{Nd}/u;

/**
 * O bonus da posicao `j`, calculado sobre o texto ORIGINAL.
 *
 * ⚠️ Original, e nao dobrado, de proposito: a fronteira `camelCase` so existe na
 * caixa original (`SupeRTrend`). Calcular no texto dobrado apagaria o sinal que
 * faz `"st"` achar **SuperTrend**.
 *
 * Os bonus NAO se somam entre si: vale o maior aplicavel. Somar faria a primeira
 * letra de um texto valer 44 e desequilibraria a comparacao com um casamento de
 * duas iniciais, que e a intencao mais frequente de quem digita duas letras.
 */
function bonusAt(haystack: string, j: number): number {
  if (j === 0) return BONUS_START_OF_STRING;

  const anterior = haystack.charAt(j - 1);
  const atual = haystack.charAt(j);

  if (!LETRA_OU_DIGITO.test(anterior)) return BONUS_WORD_START;
  if (anterior === anterior.toLowerCase() && atual !== atual.toLowerCase()) return BONUS_CAMEL;
  if (!DIGITO.test(anterior) && DIGITO.test(atual)) return BONUS_DIGIT_START;
  return 0;
}

/** A penalidade de entrada para um casamento que comeca em `j`. */
function leadingGap(j: number): number {
  return Math.max(j * GAP_LEADING, GAP_LEADING_MAX);
}

// ═════════════════════════════════════════════════════════════════════════════
// Casamento guloso — pre-teste e plano B
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As posicoes casadas pela varredura gulosa, ou `null` se nao ha subsequencia.
 *
 * Guloso responde CORRETAMENTE "casa ou nao casa" — a existencia de subsequencia
 * nao depende da escolha, so a QUALIDADE do casamento depende. E por isso que
 * ele serve de pre-teste e de plano B, mas nao de resposta principal.
 */
function greedyPositions(nf: string, hf: string): number[] | null {
  const posicoes: number[] = [];
  let i = 0;
  for (let j = 0; j < hf.length && i < nf.length; j++) {
    if (hf.charAt(j) === nf.charAt(i)) {
      posicoes.push(j);
      i++;
    }
  }
  return i === nf.length ? posicoes : null;
}

/** Pontua um caminho ja escolhido, com as mesmas regras do DP. */
function scoreOfPath(haystack: string, hf: string, posicoes: readonly number[]): number {
  const primeira = posicoes[0];
  if (primeira === undefined) return 0;

  let score = leadingGap(primeira);
  let anterior = -1;
  for (const j of posicoes) {
    if (anterior >= 0) {
      const pulados = j - anterior - 1;
      score += pulados * GAP_INNER;
      if (pulados === 0) {
        score += SCORE_CONSECUTIVE;
        anterior = j;
        continue;
      }
    }
    score += SCORE_MATCH + bonusAt(haystack, j);
    anterior = j;
  }
  const ultima = posicoes[posicoes.length - 1] as number;
  score += (hf.length - 1 - ultima) * GAP_TRAILING;
  return score;
}

// ═════════════════════════════════════════════════════════════════════════════
// Programacao dinamica — o casamento OTIMO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O DP, na forma de duas matrizes:
 *
 *   `D[i][j]` = melhor pontuacao casando `needle[0..i]` com a letra `i` **na**
 *               posicao `j`;
 *   `M[i][j]` = melhor pontuacao casando `needle[0..i]` usando `haystack[0..j]`,
 *               sem exigir que a letra `i` caia em `j`.
 *
 * `M` e o que propaga a penalidade de pulo; `D` e o que permite reconhecer
 * contiguidade (`D[i-1][j-1]` significa "a letra anterior caiu exatamente na
 * casa anterior"). O resultado e `M[m-1][n-1]`, e a ultima linha usa
 * `GAP_TRAILING` no lugar de `GAP_INNER` — o que sobra depois da ultima letra
 * casada nao e um buraco no meio da palavra, e nao deve custar o mesmo.
 *
 * ⚠️ Uma `Float64Array` PLANA de `m * n` no lugar de `number[][]`: nao aloca `m`
 * arrays por chamada, e a paleta chama isto uma vez por item por tecla.
 *
 * ⚠️ A leitura de celula passa por `cell()`, e nao por `A[k]` direto — ver a nota
 * la. `noUncheckedIndexedAccess` vale para `Float64Array` tambem, ao contrario do
 * que se supoe.
 */
function dpMatch(haystack: string, hf: string, nf: string, m: number, n: number): FuzzyMatch {
  const D = new Float64Array(m * n);
  const M = new Float64Array(m * n);

  for (let i = 0; i < m; i++) {
    const alvo = nf.charAt(i);
    const gap = i === m - 1 ? GAP_TRAILING : GAP_INNER;
    let melhorAnterior = SCORE_MIN; // M[i][j-1]

    for (let j = 0; j < n; j++) {
      const k = i * n + j;

      if (alvo === hf.charAt(j)) {
        let score: number;
        if (i === 0) {
          score = leadingGap(j) + SCORE_MATCH + bonusAt(haystack, j);
        } else if (j === 0) {
          // A letra i>0 nao pode cair em 0: nao ha onde a anterior tenha caido.
          score = SCORE_MIN;
        } else {
          const anterior = (i - 1) * n + (j - 1);
          const viaPulo = cell(M, anterior) + SCORE_MATCH + bonusAt(haystack, j);
          const viaContiguo = cell(D, anterior) + SCORE_CONSECUTIVE;
          score = Math.max(viaPulo, viaContiguo);
        }
        D[k] = score;
        M[k] = Math.max(score, melhorAnterior + gap);
      } else {
        D[k] = SCORE_MIN;
        M[k] = melhorAnterior + gap;
      }
      melhorAnterior = M[k];
    }
  }

  return { score: cell(M, m * n - 1), ranges: mergeRanges(traceback(D, M, m, n)) };
}

/**
 * Le uma celula da matriz.
 *
 * ⚠️ `?? SCORE_MIN` e nao assercao de nao-nulo: sob `noUncheckedIndexedAccess`
 * (obrigatorio neste projeto) o acesso indexado tem tipo `number | undefined`
 * **inclusive em `Float64Array`** — a suposicao de que tipada escapa da flag e
 * falsa, e foi o que o `tsc` apontou aqui. `!` calaria o compilador MENTINDO para
 * indice fora da faixa; `SCORE_MIN` e a resposta correta para "celula que nao
 * existe", que no vocabulario do DP e exatamente "caminho impossivel". A leitura
 * continua total.
 */
function cell(A: Float64Array, k: number): number {
  return A[k] ?? SCORE_MIN;
}

/**
 * Reconstroi as posicoes casadas a partir das matrizes.
 *
 * Anda de tras para frente. Numa coluna, a letra `i` caiu em `j` quando
 * `D[i][j] === M[i][j]` — isto e, quando o melhor jeito de casar ate `j` foi
 * justamente casar `i` ali. O sinalizador `exigeCasamento` trata o unico caso em
 * que essa igualdade nao vale: quando o passo escolhido foi o CONTIGUO, a casa
 * anterior e obrigatoria mesmo que `M` ali venha de outro caminho.
 */
function traceback(D: Float64Array, M: Float64Array, m: number, n: number): number[] {
  const posicoes = new Array<number>(m);
  let exigeCasamento = false;
  let j = n - 1;

  for (let i = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      const k = i * n + j;
      if (cell(D, k) === SCORE_MIN) continue;
      if (!exigeCasamento && cell(D, k) !== cell(M, k)) continue;
      exigeCasamento =
        i > 0 && j > 0 && cell(M, k) === cell(D, (i - 1) * n + (j - 1)) + SCORE_CONSECUTIVE;
      posicoes[i] = j;
      j--;
      break;
    }
  }

  return posicoes;
}

/** Funde indices contiguos em intervalos meio-abertos `[inicio, fim)`. */
function mergeRanges(posicoes: readonly number[]): readonly [number, number][] {
  const ranges: [number, number][] = [];
  for (const p of posicoes) {
    // Posicao ausente nao deveria ocorrer (a subsequencia foi verificada antes do
    // DP), mas um intervalo com `NaN` chegaria a interface como `slice(NaN, NaN)`
    // — que devolve string VAZIA e apagaria o pedaco do rotulo em silencio. Um
    // destaque faltando e mais dificil de diagnosticar que um destaque errado.
    if (!Number.isInteger(p)) continue;
    const ultimo = ranges[ranges.length - 1];
    if (ultimo !== undefined && ultimo[1] === p) {
      ultimo[1] = p + 1;
      continue;
    }
    ranges.push([p, p + 1]);
  }
  return ranges;
}
