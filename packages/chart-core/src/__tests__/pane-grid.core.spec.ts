/**
 * A GEOMETRIA da grade de sub-painéis.
 *
 * ⭐⭐ O caso que importa mais é `uma coluna dá o MESMO layout de antes`: é a prova de que a
 * grade não é uma reescrita do empilhamento, e é o que autoriza as bancadas de altura, de
 * divisória e de escalas a continuarem valendo sem uma asserção alterada.
 *
 * ⭐ E o segundo é `a mesma janela lógica em toda pane`: a invariante do módulo, medida como
 * conta e não como intenção. Se ela cair, o operador lê o oscilador de uma janela e o preço de
 * outra, sem nada na tela avisando.
 */
import { describe, it, expect } from 'vitest';
import {
  calcularArranjo,
  resolverColunas,
  fatorDeCompressao,
  paneNoPonto,
  retanguloDe,
  type PaneParaArranjo,
  type OpcoesDeArranjo,
} from '../pane-grid.core.js';

const EIXO = 22;

/** Panes: a principal mais N sub-painéis, todos com a mesma fração. */
function panes(nSubs: number, fracaoSub = 0.11, fracaoPreco = 1 - nSubs * 0.11): PaneParaArranjo[] {
  const lista: PaneParaArranjo[] = [
    { key: 0, principal: true, colapsada: false, heightFraction: fracaoPreco, widthFraction: 1 },
  ];
  for (let i = 1; i <= nSubs; i += 1) {
    lista.push({
      key: i,
      principal: false,
      colapsada: false,
      heightFraction: fracaoSub,
      widthFraction: 1,
    });
  }
  return lista;
}

function base(over: Partial<OpcoesDeArranjo> = {}): OpcoesDeArranjo {
  return { largura: 1000, altura: 600, alturaEixoTempo: EIXO, colunas: 1, ...over };
}

// ═════════════════════════════════════════════════════════════════════════════
describe('resolverColunas', () => {
  it('sem sub-painel é sempre 1', () => {
    expect(resolverColunas(0, 1600, { colunas: 4 })).toBe(1);
    expect(resolverColunas(0, 1600, { colunas: 'auto' })).toBe(1);
  });

  it('nunca passa da quantidade de sub-painéis', () => {
    expect(resolverColunas(2, 1600, { colunas: 4 })).toBe(2);
    expect(resolverColunas(1, 1600, { colunas: 3 })).toBe(1);
  });

  it('teto de 4 colunas, por LEITURA e não por técnica', () => {
    expect(resolverColunas(9, 4000, { colunas: 9 })).toBe(4);
  });

  it('⭐ pedido explícito é RECORTADO pela largura mínima, e o efetivo é publicado', () => {
    // 4 colunas em 600 px dariam 150 px cada, com 56 do eixo de preço.
    expect(resolverColunas(4, 600, { colunas: 4 })).toBe(3);
    expect(resolverColunas(4, 300, { colunas: 4 })).toBe(1);
    expect(resolverColunas(4, 1600, { colunas: 4 })).toBe(4);
  });

  it("'auto' deriva da largura pela coluna CONFORTÁVEL, não pela mínima", () => {
    expect(resolverColunas(4, 800, { colunas: 'auto' })).toBe(1);
    expect(resolverColunas(4, 900, { colunas: 'auto' })).toBe(2);
    expect(resolverColunas(4, 1400, { colunas: 'auto' })).toBe(3);
    expect(resolverColunas(4, 1800, { colunas: 'auto' })).toBe(4);
  });

  it('⚠️ largura ZERO (container não medido) não recorta o pedido', () => {
    // Em jsdom o container mede 0 px; recortar aqui faria o teste de grade medir
    // empilhamento e passar por acaso.
    expect(resolverColunas(4, 0, { colunas: 3 })).toBe(3);
  });

  it('pedido inválido cai para 1', () => {
    expect(resolverColunas(4, 1600, { colunas: 0 })).toBe(1);
    expect(resolverColunas(4, 1600, { colunas: -2 })).toBe(1);
    expect(resolverColunas(4, 1600, { colunas: Number.NaN })).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('fatorDeCompressao', () => {
  it('meia largura dá meio fator', () => {
    expect(fatorDeCompressao(500, 1000)).toBe(0.5);
    expect(fatorDeCompressao(1000, 1000)).toBe(1);
  });

  it('⚠️ entrada degenerada devolve 1, e NUNCA 0', () => {
    // Fator 0 levaria `barSpacing` a 0, e toda conversão de tempo passaria a devolver
    // `null`: o gráfico ficaria vazio sem erro nenhum.
    expect(fatorDeCompressao(0, 1000)).toBe(1);
    expect(fatorDeCompressao(500, 0)).toBe(1);
    expect(fatorDeCompressao(Number.NaN, 1000)).toBe(1);
    expect(fatorDeCompressao(500, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ uma coluna dá o MESMO layout do empilhamento histórico', () => {
  it('as panes se empilham na largura inteira, somando a altura útil', () => {
    const a = calcularArranjo(panes(3), base());
    expect(a.colunas).toBe(1);
    expect(a.linhas).toBe(3);
    const rs = a.retangulos;
    expect(rs).toHaveLength(4);
    for (const r of rs) {
      expect(r.left).toBe(0);
      expect(r.width).toBe(1000);
    }
    // Empilhadas em sequência, sem sobreposição nem buraco.
    const ordenadas = [...rs].sort((x, y) => x.top - y.top);
    let esperado = 0;
    for (const r of ordenadas) {
      expect(r.top).toBeCloseTo(esperado, 6);
      esperado += r.height;
    }
    expect(esperado).toBeCloseTo(a.alturaUtil, 6);
  });

  it('a altura útil reserva a tira do eixo de tempo', () => {
    const a = calcularArranjo(panes(1), base({ altura: 600 }));
    expect(a.alturaUtil).toBe(600 - EIXO);
    const total = a.retangulos.reduce((s, r) => s + r.height, 0);
    expect(total).toBeCloseTo(600 - EIXO, 6);
  });

  it('a proporção 62/38 histórica é preservada', () => {
    const a = calcularArranjo(
      [
        { key: 0, principal: true, colapsada: false, heightFraction: 0.62, widthFraction: 1 },
        { key: 1, principal: false, colapsada: false, heightFraction: 0.38, widthFraction: 1 },
      ],
      base(),
    );
    const preco = retanguloDe(a, 0);
    const sub = retanguloDe(a, 1);
    expect(preco?.height).toBeCloseTo(0.62 * (600 - EIXO), 6);
    expect(sub?.height).toBeCloseTo(0.38 * (600 - EIXO), 6);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐ a grade em COLUNAS', () => {
  it('quatro sub-painéis em duas colunas dão DUAS linhas', () => {
    const a = calcularArranjo(panes(4), base({ colunas: 2, largura: 1200 }));
    expect(a.colunas).toBe(2);
    expect(a.linhas).toBe(2);
    const subs = a.retangulos.filter((r) => r.key !== 0);
    expect(subs.map((r) => [r.linha, r.coluna])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it('⭐⭐ é isto que DEVOLVE ALTURA AO PREÇO — o pedido do operador', () => {
    const empilhado = calcularArranjo(panes(4), base({ colunas: 1, largura: 1200 }));
    const emGrade = calcularArranjo(panes(4), base({ colunas: 2, largura: 1200 }));
    const alturaPrecoEmpilhado = retanguloDe(empilhado, 0)?.height ?? 0;
    const alturaPrecoEmGrade = retanguloDe(emGrade, 0)?.height ?? 0;

    expect(alturaPrecoEmpilhado, 'bancada vazia').toBeGreaterThan(0);
    // Quatro osciladores de 11% empilhados tomam 44%; em duas linhas tomam 22%.
    expect(alturaPrecoEmGrade).toBeGreaterThan(alturaPrecoEmpilhado);
    // E a altura de cada oscilador NÃO foi sacrificada: a linha tem a altura pedida.
    const subEmpilhado = retanguloDe(empilhado, 1)?.height ?? 0;
    const subEmGrade = retanguloDe(emGrade, 1)?.height ?? 0;
    expect(subEmGrade).toBeGreaterThan(subEmpilhado * 0.99);
  });

  it('as colunas de uma linha dividem a largura e não deixam fresta', () => {
    const a = calcularArranjo(panes(2), base({ colunas: 2, largura: 1000 }));
    const linha = a.retangulos.filter((r) => r.linha === 0).sort((x, y) => x.left - y.left);
    expect(linha).toHaveLength(2);
    expect(linha[0]?.left).toBe(0);
    expect(linha[0]?.width).toBeCloseTo(500, 6);
    expect(linha[1]?.left).toBeCloseTo(500, 6);
    // ⚠️ O último recebe o RESTO exato: sem isso sobra sub-pixel e aparece o fundo da
    // página como um risco vertical claro na borda.
    expect((linha[1]?.left ?? 0) + (linha[1]?.width ?? 0)).toBe(1000);
  });

  it('os membros de uma linha têm a MESMA altura e o MESMO topo', () => {
    const a = calcularArranjo(panes(3), base({ colunas: 2, largura: 1200 }));
    const linha0 = a.retangulos.filter((r) => r.linha === 0);
    expect(linha0).toHaveLength(2);
    expect(linha0[0]?.top).toBe(linha0[1]?.top);
    expect(linha0[0]?.height).toBe(linha0[1]?.height);
  });

  it('⭐ a última linha INCOMPLETA estica para a largura inteira', () => {
    const a = calcularArranjo(panes(3), base({ colunas: 2, largura: 1200 }));
    const linha1 = a.retangulos.filter((r) => r.linha === 1);
    expect(linha1).toHaveLength(1);
    expect(linha1[0]?.left).toBe(0);
    expect(linha1[0]?.width).toBe(1200);
  });

  it('⚠️ a pane de PREÇO nunca entra na grade — sempre largura inteira', () => {
    const a = calcularArranjo(panes(4), base({ colunas: 3, largura: 1600 }));
    const preco = retanguloDe(a, 0);
    expect(preco?.left).toBe(0);
    expect(preco?.width).toBe(1600);
    expect(preco?.linha).toBe(-1);
  });

  it('a altura da LINHA é o MÁXIMO dos membros, e o maior pedido é honrado', () => {
    const lista: PaneParaArranjo[] = [
      { key: 0, principal: true, colapsada: false, heightFraction: 0.6, widthFraction: 1 },
      { key: 1, principal: false, colapsada: false, heightFraction: 0.07, widthFraction: 1 },
      { key: 2, principal: false, colapsada: false, heightFraction: 0.2, widthFraction: 1 },
    ];
    const a = calcularArranjo(lista, base({ colunas: 2, largura: 1200 }));
    const soma = 0.6 + 0.2; // a linha vale 0.2, não 0.27
    const util = 600 - EIXO;
    expect(retanguloDe(a, 1)?.height).toBeCloseTo((0.2 / soma) * util, 6);
    expect(retanguloDe(a, 2)?.height).toBeCloseTo((0.2 / soma) * util, 6);
    expect(retanguloDe(a, 0)?.height).toBeCloseTo((0.6 / soma) * util, 6);
  });

  it('peso de largura desigual reparte proporcionalmente', () => {
    const lista = panes(2);
    lista[1] = { ...(lista[1] as PaneParaArranjo), widthFraction: 3 };
    lista[2] = { ...(lista[2] as PaneParaArranjo), widthFraction: 1 };
    const a = calcularArranjo(lista, base({ colunas: 2, largura: 1000 }));
    expect(retanguloDe(a, 1)?.width).toBeCloseTo(750, 6);
    expect(retanguloDe(a, 2)?.width).toBeCloseTo(250, 6);
  });

  it('peso inválido conta como participação IGUAL, sem colapsar a coluna', () => {
    const lista = panes(2);
    lista[1] = { ...(lista[1] as PaneParaArranjo), widthFraction: 0 };
    lista[2] = { ...(lista[2] as PaneParaArranjo), widthFraction: Number.NaN };
    const a = calcularArranjo(lista, base({ colunas: 2, largura: 1000 }));
    expect(retanguloDe(a, 1)?.width).toBeCloseTo(500, 6);
    expect(retanguloDe(a, 2)?.width).toBeCloseTo(500, 6);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('fronteiras arrastáveis', () => {
  it('empilhado: uma fronteira horizontal por par de faixas vizinhas', () => {
    const a = calcularArranjo(panes(2), base({ colunas: 1 }));
    expect(a.fronteirasHorizontais).toHaveLength(2);
    expect(a.fronteirasHorizontais[0]?.acima).toEqual([0]);
    expect(a.fronteirasHorizontais[0]?.abaixo).toEqual([1]);
    expect(a.fronteirasHorizontais[1]?.abaixo).toEqual([2]);
    expect(a.fronteirasVerticais).toHaveLength(0);
  });

  it('⭐ na grade, a fronteira horizontal move a LINHA INTEIRA', () => {
    const a = calcularArranjo(panes(4), base({ colunas: 2, largura: 1200 }));
    expect(a.fronteirasHorizontais).toHaveLength(2);
    // Preço acima, os dois membros da primeira linha abaixo.
    expect(a.fronteirasHorizontais[0]?.acima).toEqual([0]);
    expect(a.fronteirasHorizontais[0]?.abaixo).toEqual([1, 2]);
    // E entre as duas linhas, dois de cada lado.
    expect(a.fronteirasHorizontais[1]?.acima).toEqual([1, 2]);
    expect(a.fronteirasHorizontais[1]?.abaixo).toEqual([3, 4]);
  });

  it('⭐ fronteira VERTICAL entre colunas vizinhas, limitada à faixa da linha', () => {
    const a = calcularArranjo(panes(4), base({ colunas: 2, largura: 1200 }));
    expect(a.fronteirasVerticais).toHaveLength(2); // uma por linha
    const f = a.fronteirasVerticais[0];
    expect(f?.x).toBeCloseTo(600, 6);
    expect(f?.esquerda).toBe(1);
    expect(f?.direita).toBe(2);
    // ⚠️ Tem extensão vertical: sem isso o cursor viraria `ew-resize` sobre o painel de
    // preço, prometendo um arrasto que não faz nada ali.
    const linha0 = a.retangulos.filter((r) => r.linha === 0)[0];
    expect(f?.topo).toBeCloseTo(linha0?.top ?? -1, 6);
    expect(f?.base).toBeCloseTo((linha0?.top ?? 0) + (linha0?.height ?? 0), 6);
  });

  it('a última linha incompleta não tem fronteira vertical', () => {
    const a = calcularArranjo(panes(3), base({ colunas: 2, largura: 1200 }));
    expect(a.fronteirasVerticais).toHaveLength(1);
    expect(a.fronteirasVerticais[0]?.esquerda).toBe(1);
  });

  it('sem sub-painel não há fronteira nenhuma', () => {
    const a = calcularArranjo(panes(0, 0.11, 1), base());
    expect(a.fronteirasHorizontais).toHaveLength(0);
    expect(a.fronteirasVerticais).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('pane colapsada', () => {
  it('não ocupa espaço, não vira linha, e ainda tem retângulo', () => {
    const lista = panes(2);
    lista[1] = { ...(lista[1] as PaneParaArranjo), colapsada: true };
    const a = calcularArranjo(lista, base({ colunas: 2, largura: 1200 }));
    expect(a.linhas).toBe(1);
    const r = retanguloDe(a, 1);
    expect(r).not.toBeNull();
    expect(r?.height).toBe(0);
    // A visível ficou sozinha na linha e esticou.
    expect(retanguloDe(a, 2)?.width).toBe(1200);
  });

  it('⚠️ pane de altura zero NÃO é encontrada pelo ponteiro', () => {
    const lista = panes(2);
    lista[1] = { ...(lista[1] as PaneParaArranjo), colapsada: true };
    const a = calcularArranjo(lista, base({ colunas: 1, largura: 1000 }));
    const r = retanguloDe(a, 1) as { top: number };
    // Exatamente na fronteira dela: quem responde é a vizinha visível, nunca a colapsada.
    const achada = paneNoPonto(a, 500, r.top);
    expect(achada?.key).not.toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('paneNoPonto', () => {
  it('resolve por X e por Y — é o que o empilhamento não precisava', () => {
    const a = calcularArranjo(panes(2), base({ colunas: 2, largura: 1000 }));
    const esq = retanguloDe(a, 1) as { top: number; height: number };
    // Mesmo Y, X diferente: panes diferentes. Com `paneAtY` as duas respostas seriam iguais.
    expect(paneNoPonto(a, 100, esq.top + esq.height / 2)?.key).toBe(1);
    expect(paneNoPonto(a, 900, esq.top + esq.height / 2)?.key).toBe(2);
  });

  it('fora de qualquer pane (a tira do eixo de tempo) devolve null', () => {
    const a = calcularArranjo(panes(1), base());
    expect(paneNoPonto(a, 500, 599)).toBeNull();
  });

  it('o ponto no painel de preço devolve a principal, em qualquer X', () => {
    const a = calcularArranjo(panes(2), base({ colunas: 2, largura: 1000 }));
    expect(paneNoPonto(a, 10, 10)?.key).toBe(0);
    expect(paneNoPonto(a, 990, 10)?.key).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('entrada degenerada não derruba o arranjo', () => {
  it('nenhuma pane', () => {
    const a = calcularArranjo([], base());
    expect(a.retangulos).toHaveLength(0);
    expect(a.linhas).toBe(0);
    expect(a.colunas).toBe(1);
  });

  it('largura e altura zero (o container do jsdom)', () => {
    const a = calcularArranjo(panes(2), base({ largura: 0, altura: 0 }));
    expect(a.alturaUtil).toBe(1);
    for (const r of a.retangulos) {
      expect(Number.isFinite(r.left)).toBe(true);
      expect(Number.isFinite(r.width)).toBe(true);
      expect(Number.isFinite(r.top)).toBe(true);
      expect(Number.isFinite(r.height)).toBe(true);
    }
  });

  it('frações não finitas ou negativas não produzem NaN na tela', () => {
    const lista: PaneParaArranjo[] = [
      { key: 0, principal: true, colapsada: false, heightFraction: Number.NaN, widthFraction: 1 },
      { key: 1, principal: false, colapsada: false, heightFraction: -0.5, widthFraction: 1 },
    ];
    const a = calcularArranjo(lista, base());
    for (const r of a.retangulos) {
      expect(Number.isFinite(r.height)).toBe(true);
      expect(r.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('todas as frações zero não divide por zero', () => {
    const lista: PaneParaArranjo[] = [
      { key: 0, principal: true, colapsada: false, heightFraction: 0, widthFraction: 1 },
      { key: 1, principal: false, colapsada: false, heightFraction: 0, widthFraction: 1 },
    ];
    const a = calcularArranjo(lista, base());
    for (const r of a.retangulos) expect(Number.isFinite(r.height)).toBe(true);
  });
});
