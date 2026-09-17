/**
 * fuzzy.core — o que estes testes protegem, na ordem em que doeria se quebrasse.
 *
 *  1. **Alinhamento de indice com acento.** O caso `'mm'` em `'Média Móvel'` e o
 *     teste-canario da armadilha do NFD: normalizar a string inteira desloca os
 *     indices a partir do primeiro acento, e o negrito da paleta aparece na letra
 *     errada. O teste afirma os RANGES, nao so o casamento — afirmar so "casou"
 *     deixaria o defeito passar.
 *  2. **O otimo, e nao o guloso.** `'mme'` em `'Media Movel Exponencial'` tem duas
 *     leituras; o guloso pega a errada. E o teste que reprova quem "simplificar" o
 *     DP de volta para uma varredura linear.
 *  3. **A ordem e determinista por construcao.** Empate resolvido pelo indice de
 *     entrada, sem depender da estabilidade do `sort` do motor de JS.
 *  4. **`null` e a unica forma de "nao casa".** Nunca `score: 0` ambiguo.
 */
import { describe, expect, it } from 'vitest';
import { foldChar, fuzzyMatch, fuzzyRank, type FuzzyMatch } from '../fuzzy.core.js';

/** Reduz o resultado ao que a interface consome, para asserções legiveis. */
function casou(needle: string, haystack: string): FuzzyMatch {
  const m = fuzzyMatch(needle, haystack);
  if (m === null) throw new Error(`esperava casar ${needle} em ${haystack}`);
  return m;
}

/** O texto efetivamente destacado, reconstruido dos ranges. */
function destaques(needle: string, haystack: string): string[] {
  return casou(needle, haystack).ranges.map(([i, f]) => haystack.slice(i, f));
}

function nota(needle: string, haystack: string): number {
  return casou(needle, haystack).score;
}

// ═════════════════════════════════════════════════════════════════════════════
// Subsequencia
// ═════════════════════════════════════════════════════════════════════════════

describe('fuzzyMatch — casamento por subsequencia', () => {
  it('acha prefixo contiguo e funde os indices num intervalo so', () => {
    expect(casou('bol', 'Bollinger').ranges).toEqual([[0, 3]]);
  });

  it('acha letras NAO contiguas, na ordem', () => {
    // As iniciais de "Parabolic SAR" — nenhum `includes` acharia isto.
    expect(destaques('ps', 'Parabolic SAR')).toEqual(['P', 'S']);
  });

  it('acha por fronteira camelCase', () => {
    expect(casou('st', 'SuperTrend').ranges).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });

  it('casa o texto inteiro quando a busca e o texto', () => {
    expect(casou('mfi', 'MFI').ranges).toEqual([[0, 3]]);
  });

  it('devolve null quando a ordem nao existe no texto', () => {
    // 'l' vem depois de 'b' em "Bollinger", entao "lb" nao e subsequencia.
    expect(fuzzyMatch('lb', 'Bollinger')).toBeNull();
  });

  it('devolve null quando a busca e maior que o texto', () => {
    expect(fuzzyMatch('bollingerbands', 'Bollinger')).toBeNull();
  });

  it('devolve null, e nao score 0, para nao-casamento', () => {
    // ⚠️ A distincao importa: `0` e score legitimo (busca vazia), e um chamador
    // que testasse `if (!m.score)` descartaria casamento valido.
    expect(fuzzyMatch('xyz', 'Bollinger')).toBeNull();
  });

  it('busca vazia e "sem filtro": casa com score 0 e sem destaque', () => {
    expect(fuzzyMatch('', 'Bollinger')).toEqual({ score: 0, ranges: [] });
  });

  it('texto vazio nunca casa (exceto busca vazia)', () => {
    expect(fuzzyMatch('a', '')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Acento e caixa
// ═════════════════════════════════════════════════════════════════════════════

describe('fuzzyMatch — insensivel a acento e a caixa', () => {
  it('acha "Média" digitando "media"', () => {
    expect(fuzzyMatch('media', 'Média')).not.toBeNull();
  });

  it('acha maiuscula digitando minuscula e vice-versa', () => {
    expect(fuzzyMatch('MFI', 'mfi')).not.toBeNull();
    expect(fuzzyMatch('mfi', 'MFI')).not.toBeNull();
  });

  it('cobre os diacriticos do pt-BR', () => {
    expect(fuzzyMatch('preco', 'Preço típico')).not.toBeNull();
    expect(fuzzyMatch('tipico', 'Preço típico')).not.toBeNull();
    expect(fuzzyMatch('sessao', 'Sessão')).not.toBeNull();
    expect(fuzzyMatch('avo', 'Avô')).not.toBeNull();
  });

  it('⭐ mantem os indices alinhados DEPOIS do acento', () => {
    // A armadilha: 'Média Móvel'.normalize('NFD') tem 13 unidades contra 11 do
    // original, e o segundo 'M' apareceria em 7 em vez de 6 — o negrito cairia
    // no 'ó'. Ver o cabecalho de `fuzzy.core.ts`.
    expect(casou('mm', 'Média Móvel').ranges).toEqual([
      [0, 1],
      [6, 7],
    ]);
    expect(destaques('mm', 'Média Móvel')).toEqual(['M', 'M']);
  });

  it('foldChar preserva o comprimento sempre — e o que garante o alinhamento', () => {
    for (const ch of 'Média Móvel — Preço 12% (típico) ÁÉÍÓÚÂÊÔÃÕÇáéíóúç') {
      expect(foldChar(ch)).toHaveLength(1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Pontuacao
// ═════════════════════════════════════════════════════════════════════════════

describe('fuzzyMatch — a regra de pontuacao', () => {
  it('prefixo vence casamento no meio da palavra', () => {
    expect(nota('ema', 'EMA rápida')).toBeGreaterThan(nota('ema', 'Sistema'));
  });

  it('inicio de palavra vence meio de palavra', () => {
    // 'v' abre a segunda palavra em "Perfil Volume"; em "Divisor" esta no meio.
    expect(nota('v', 'Perfil Volume')).toBeGreaterThan(nota('v', 'Divisor'));
  });

  it('contiguidade vence letras espalhadas', () => {
    expect(nota('abc', 'abc final')).toBeGreaterThan(nota('abc', 'a b c final'));
  });

  it('casamento exato vence prefixo de texto mais longo', () => {
    expect(nota('mfi', 'MFI')).toBeGreaterThan(nota('mfi', 'MFI suavizado'));
  });

  it('texto curto vence texto longo com o mesmo casamento', () => {
    // A penalidade de saida (`GAP_TRAILING`) e o que produz isso: e leve, mas
    // desempata os dois casos em que todo o resto e igual.
    expect(nota('ema', 'EMA')).toBeGreaterThan(nota('ema', 'EMA de EMA de EMA'));
  });

  it('⭐ acha o casamento OTIMO, nao o guloso', () => {
    // Guloso casaria M(0) M(6) e(9) — dentro de "Movel". O otimo casa as tres
    // INICIAIS, porque inicio de palavra paga mais que o pulo economizado.
    expect(casou('mme', 'Media Movel Exponencial').ranges).toEqual([
      [0, 1],
      [6, 7],
      [12, 13],
    ]);
  });

  it('as iniciais vencem o casamento disperso no mesmo texto', () => {
    expect(nota('ps', 'Parabolic SAR')).toBeGreaterThan(nota('ps', 'Pivot Points'));
  });

  it('reconhece o digito depois da letra como inicio', () => {
    expect(destaques('e2', 'EMA20')).toEqual(['E', '2']);
  });

  it('score e sempre finito quando casa — nenhum -Infinity escapa do DP', () => {
    // O DP usa `-Infinity` como "impossivel". Se um caminho impossivel vazasse
    // para o resultado, a ordenacao poria o item no fim em vez de descarta-lo, e
    // a paleta mostraria um item que nao casa. Textos longos e buscas de 1 letra
    // sao onde a matriz tem mais celulas impossiveis.
    const alvos = ['MFI', 'Bollinger', 'Média Móvel', 'Ichimoku Kinko Hyo (nuvem)'];
    for (const alvo of alvos) {
      for (const busca of ['m', 'i', 'ol', 'mo', 'ichi']) {
        const m = fuzzyMatch(busca, alvo);
        if (m === null) continue;
        expect(Number.isFinite(m.score)).toBe(true);
        expect(m.ranges.length).toBeGreaterThan(0);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Determinismo
// ═════════════════════════════════════════════════════════════════════════════

describe('fuzzyMatch — determinismo', () => {
  it('a mesma entrada da o mesmo resultado', () => {
    const a = fuzzyMatch('mme', 'Media Movel Exponencial');
    const b = fuzzyMatch('mme', 'Media Movel Exponencial');
    expect(a).toEqual(b);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// fuzzyRank
// ═════════════════════════════════════════════════════════════════════════════

interface Item {
  readonly id: string;
  readonly label: string;
}

const ITENS: readonly Item[] = [
  { id: 'sma', label: 'Média Móvel Simples' },
  { id: 'ema', label: 'Média Móvel Exponencial' },
  { id: 'bb', label: 'Bandas de Bollinger' },
  { id: 'mfi', label: 'MFI' },
  { id: 'psar', label: 'Parabolic SAR' },
];

const chave = (i: Item): string => i.label;

describe('fuzzyRank', () => {
  it('descarta quem nao casa e poe o inicio de palavra na frente', () => {
    // ⚠️ "Parabolic SAR" TAMBEM casa com "bol" — as letras estao lá, contiguas,
    // dentro de "Para-bol-ic". Ele deve aparecer, e deve aparecer DEPOIS de
    // "Bandas de Bollinger", onde o casamento abre uma palavra. Filtrar itens que
    // casam seria mentir; ordena-los e a resposta.
    const r = fuzzyRank('bol', ITENS, chave);
    expect(r.map((x) => x.item.id)).toEqual(['bb', 'psar']);
  });

  it('descarta de fato quem nao tem as letras', () => {
    expect(fuzzyRank('zzz', ITENS, chave)).toEqual([]);
  });

  it('ordena por pontuacao decrescente', () => {
    const r = fuzzyRank('mm', ITENS, chave);
    const notas = r.map((x) => x.match.score);
    expect(notas).toEqual([...notas].sort((a, b) => b - a));
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it('busca vazia devolve TUDO na ordem de entrada', () => {
    const r = fuzzyRank('', ITENS, chave);
    expect(r.map((x) => x.item.id)).toEqual(ITENS.map((i) => i.id));
  });

  it('⭐ empate resolve pela ordem de ENTRADA, sem depender do sort', () => {
    // Rotulos identicos => pontuacao identica. A ordem tem de ser a de entrada,
    // e nao a que o `sort` do motor decidir.
    const iguais: readonly Item[] = [
      { id: 'primeiro', label: 'EMA' },
      { id: 'segundo', label: 'EMA' },
      { id: 'terceiro', label: 'EMA' },
    ];
    expect(fuzzyRank('ema', iguais, chave).map((x) => x.item.id)).toEqual([
      'primeiro',
      'segundo',
      'terceiro',
    ]);
  });

  it('carrega o match de cada item, com os ranges do proprio rotulo', () => {
    const r = fuzzyRank('bol', ITENS, chave);
    const primeiro = r[0];
    expect(primeiro).toBeDefined();
    if (primeiro === undefined) return;
    const [inicio, fim] = primeiro.match.ranges[0] ?? [0, 0];
    expect(primeiro.item.label.slice(inicio, fim)).toBe('Bol');
  });

  it('lista vazia devolve lista vazia', () => {
    expect(fuzzyRank('x', [], chave)).toEqual([]);
  });
});
