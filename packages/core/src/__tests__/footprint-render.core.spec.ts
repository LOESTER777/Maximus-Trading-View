import { describe, expect, it } from 'vitest';
import {
  abreviar,
  formasDaVela,
  formasVisiveis,
  LARGURA_MINIMA_VELA_PX,
  modoEfetivo,
  textoDaLegendaFootprint,
  velaAdmiteFootprint,
  OPCOES_FOOTPRINT_DEFAULT,
  type Conversores,
} from '@robustus/charts-core';
import type { VelaFootprint, NivelFootprint } from '@robustus/charts-core';

/** Asserção de não-nulo para índice de array sob `noUncheckedIndexedAccess`. */
function naoNulo<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('valor ausente no teste');
  return v;
}

const nivel = (preco: number, compra: number, venda: number): NivelFootprint => ({
  preco, compra, venda,
  delta: compra - venda, total: compra + venda,
  desequilibrio: compra + venda > 0 ? (compra - venda) / (compra + venda) : 0,
});

function vela(niveis: NivelFootprint[], tempo = 1_788_000_000_000): VelaFootprint {
  const totalCompra = niveis.reduce((s, n) => s + n.compra, 0);
  const totalVenda = niveis.reduce((s, n) => s + n.venda, 0);
  const maiorTotal = niveis.reduce((m, n) => Math.max(m, n.total), 0);
  let poc: number | null = null;
  let melhor = -1;
  for (const n of niveis) if (n.total > melhor) { melhor = n.total; poc = n.preco; }
  return { tempo, niveis, totalCompra, totalVenda, delta: totalCompra - totalVenda, poc, maiorTotal };
}

/** Conversores lineares simples: preço 178.000 → y 500, 1 ponto = 1 px. */
const conv: Conversores = {
  precoParaY: (p) => (p >= 177_900 && p <= 178_100 ? 500 - (p - 178_000) : null),
  tempoParaX: (t) => (t === 1_788_000_000_000 ? 300 : null),
  larguraVelaPx: 60,
  alturaNivelPx: 12,
};

describe('modoEfetivo — número só quando cabe', () => {
  it('⭐ NUMEROS cai para BARRAS quando a linha é baixa demais', () => {
    expect(modoEfetivo('NUMEROS', 12, 60)).toBe('NUMEROS');
    expect(modoEfetivo('NUMEROS', 6, 60)).toBe('BARRAS');
  });

  it('⭐ NUMEROS cai para BARRAS quando a vela é estreita demais', () => {
    expect(modoEfetivo('NUMEROS', 12, 30)).toBe('BARRAS');
  });

  it('BARRAS e DELTA são respeitados como pedidos', () => {
    expect(modoEfetivo('BARRAS', 2, 5)).toBe('BARRAS');
    expect(modoEfetivo('DELTA', 2, 5)).toBe('DELTA');
  });

  it('dimensão inválida cai em BARRAS, não explode', () => {
    expect(modoEfetivo('NUMEROS', Number.NaN, 60)).toBe('BARRAS');
    expect(modoEfetivo('NUMEROS', 12, Number.NaN)).toBe('BARRAS');
  });
});

describe('formasDaVela — modo NUMEROS', () => {
  it('⭐ emite venda à ESQUERDA e compra à DIREITA do centro', () => {
    const f = formasDaVela(vela([nivel(178_000, 340, 12)]), conv);
    const textos = f.filter((x) => x.tipo === 'texto');
    expect(textos).toHaveLength(2);
    const venda = textos.find((t) => t.alinhamento === 'right')!;
    const compra = textos.find((t) => t.alinhamento === 'left')!;
    expect(venda.texto).toBe('12');
    expect(compra.texto).toBe('340');
    expect(venda.x).toBeLessThan(300);
    expect(compra.x).toBeGreaterThan(300);
  });

  it('marca o POC com uma linha', () => {
    const f = formasDaVela(vela([nivel(178_000, 900, 60), nivel(178_025, 10, 5)]), conv);
    // ⚠️ Filtra por `papel`, não por `tipo`. Desde 04/09/2026 existe uma segunda
    // espécie de linha — os colchetes de alcance —, e contar `tipo === 'linha'`
    // mediria as duas juntas. O papel é o que separa "marcação de POC" de
    // "marcação de alcance".
    const linhas = f.filter((x) => x.papel === 'poc');
    expect(linhas).toHaveLength(1);
    expect(naoNulo(linhas[0]).y).toBe(500); // o nível 178.000 é o POC
  });

  it('não marca POC quando desligado', () => {
    const f = formasDaVela(vela([nivel(178_000, 900, 60)]), conv, {
      ...OPCOES_FOOTPRINT_DEFAULT, marcarPoc: false,
    });
    expect(f.some((x) => x.papel === 'poc')).toBe(false);
  });

  // ── Colchetes de alcance ────────────────────────────────────────────────────
  //
  // Pedido do operador em 04/09/2026: *"crie mais destaque nele para eu saber o
  // que está havendo"*. Sem marcação, uma vela SEM DADO é visualmente idêntica a
  // "camada desligada" — e foi isso que o fez perguntar se o footprint só
  // desenhava na barra atual.
  it('marca o alcance vertical do dado com DOIS colchetes', () => {
    const f = formasDaVela(vela([nivel(178_000, 900, 60), nivel(178_025, 10, 5)]), conv);
    const alcance = f.filter((x) => x.papel === 'alcance');
    expect(alcance).toHaveLength(2);
    // Um acima do nível mais alto e um abaixo do mais baixo.
    const ys = alcance.map((a) => a.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(ys[1]!);
  });

  it('os colchetes atravessam a vela inteira, não só a faixa das barras', () => {
    const f = formasDaVela(vela([nivel(178_000, 900, 60)]), conv);
    const alcance = f.filter((x) => x.papel === 'alcance');
    expect(alcance.length).toBeGreaterThan(0);
    expect(naoNulo(alcance[0]).largura).toBe(conv.larguraVelaPx);
  });

  it('desligado, nenhum colchete é emitido — e o resto continua igual', () => {
    const semDestaque = { ...OPCOES_FOOTPRINT_DEFAULT, destacarVelas: false };
    const f = formasDaVela(vela([nivel(178_000, 900, 60)]), conv, semDestaque);
    expect(f.some((x) => x.papel === 'alcance')).toBe(false);
    // A ausência do destaque não pode apagar dado nem o POC.
    expect(f.some((x) => x.papel === 'poc')).toBe(true);
    expect(f.some((x) => x.papel === undefined)).toBe(true);
  });

  it('vela SEM nível nenhum não emite colchete — não há alcance a marcar', () => {
    const f = formasDaVela(vela([]), conv);
    expect(f).toHaveLength(0);
  });
});

describe('formasDaVela — modo BARRAS', () => {
  const op = { ...OPCOES_FOOTPRINT_DEFAULT, modo: 'BARRAS' as const, marcarPoc: false };

  it('⭐ largura proporcional ao MAIOR total da vela (comparável entre níveis)', () => {
    const v = vela([nivel(178_000, 100, 0), nivel(178_025, 50, 0)]);
    const f = formasDaVela(v, conv, op);
    const rets = f.filter((x) => x.tipo === 'retangulo');
    expect(rets).toHaveLength(2);
    // o de 50 tem metade da largura do de 100
    const larguras = rets.map((r) => r.largura).sort((a, b) => a - b);
    expect(naoNulo(larguras[1]) / naoNulo(larguras[0])).toBeCloseTo(2, 6);
  });

  it('venda cresce para a ESQUERDA (x + largura chega ao centro)', () => {
    const f = formasDaVela(vela([nivel(178_000, 0, 100)]), conv, op);
    const r = f.find((x) => x.tipo === 'retangulo')!;
    expect(r.x + r.largura).toBeCloseTo(300, 6);
  });

  it('compra começa NO centro', () => {
    const f = formasDaVela(vela([nivel(178_000, 100, 0)]), conv, op);
    const r = f.find((x) => x.tipo === 'retangulo')!;
    expect(r.x).toBe(300);
  });

  it('barra sub-pixel é omitida (ruído)', () => {
    const v = vela([nivel(178_000, 10_000, 0), nivel(178_025, 1, 0)]);
    const f = formasDaVela(v, conv, op);
    expect(f.filter((x) => x.tipo === 'retangulo')).toHaveLength(1);
  });
});

describe('formasDaVela — modo DELTA', () => {
  const op = { ...OPCOES_FOOTPRINT_DEFAULT, modo: 'DELTA' as const, marcarPoc: false };

  it('⭐ 60% e 98% de desequilíbrio produzem OPACIDADES diferentes', () => {
    // É exatamente o que a cor única do deltaBars destrói.
    const fracas = formasDaVela(vela([nivel(178_000, 60, 40)]), conv, op);
    const fortes = formasDaVela(vela([nivel(178_000, 98, 2)]), conv, op);
    const alfa = (c: string) => Number(c.match(/,([\d.]+)\)$/)![1]);
    expect(alfa(naoNulo(fortes[0]).cor)).toBeGreaterThan(alfa(naoNulo(fracas[0]).cor));
  });

  it('delta positivo cresce à direita; negativo à esquerda', () => {
    const pos = naoNulo(formasDaVela(vela([nivel(178_000, 100, 0)]), conv, op)[0]);
    expect(pos.x).toBe(300);
    const neg = naoNulo(formasDaVela(vela([nivel(178_000, 0, 100)]), conv, op)[0]);
    expect(neg.x).toBeLessThan(300);
  });

  it('cor verde para compra, vermelha para venda', () => {
    expect(naoNulo(formasDaVela(vela([nivel(178_000, 100, 0)]), conv, op)[0]).cor).toContain('34,197,94');
    expect(naoNulo(formasDaVela(vela([nivel(178_000, 0, 100)]), conv, op)[0]).cor).toContain('239,68,68');
  });
});

describe('formasDaVela — robustez', () => {
  it('⚠️ nível FORA da escala de preço é descartado, não encostado na borda', () => {
    // Encostar inventaria um nível que o operador leria como real.
    const f = formasDaVela(vela([nivel(999_999, 500, 500)]), conv);
    expect(f).toEqual([]);
  });

  it('vela fora da escala de tempo não emite nada', () => {
    const f = formasDaVela(vela([nivel(178_000, 10, 10)], 1), conv);
    expect(f).toEqual([]);
  });

  it('vela sem níveis não emite nada', () => {
    expect(formasDaVela(vela([]), conv)).toEqual([]);
  });

  it('é determinístico', () => {
    const v = vela([nivel(178_000, 340, 12), nivel(178_025, 90, 200)]);
    expect(formasDaVela(v, conv)).toEqual(formasDaVela(v, conv));
  });
});

describe('formasVisiveis — orçamento', () => {
  const muitasVelas = Array.from({ length: 40 }, (_, i) =>
    vela([nivel(178_000, 100, 50), nivel(178_025, 80, 60)], 1_788_000_000_000),
  );
  // Conversor que aceita QUALQUER tempo, para exercitar o orçamento.
  const convTudo: Conversores = { ...conv, tempoParaX: () => 300 };

  it('⭐ poda por vela INTEIRA, nunca meia vela', () => {
    // meia vela desenhada parece leitura completa e não é.
    const r = formasVisiveis(muitasVelas, convTudo, OPCOES_FOOTPRINT_DEFAULT, undefined, 10);
    expect(r.podadas).toBeGreaterThan(0);
    expect(r.velasDesenhadas).toBeGreaterThan(0);
    expect(r.velasDesenhadas + r.podadas).toBeLessThanOrEqual(muitasVelas.length);
  });

  it('⭐ preserva o PRESENTE: poda do passado para trás', () => {
    const velas = [vela([nivel(178_000, 1, 1)], 100), vela([nivel(178_025, 2, 2)], 200)];
    const convOrdenado: Conversores = { ...conv, tempoParaX: (t) => (t === 200 ? 300 : 100) };
    const r = formasVisiveis(velas, convOrdenado, OPCOES_FOOTPRINT_DEFAULT, undefined, 1);
    // com orçamento de 1 forma, a vela desenhada é a mais RECENTE (tempo 200)
    expect(r.velasDesenhadas).toBe(1);
    expect(r.podadas).toBe(1);
  });

  it('sem poda quando cabe tudo', () => {
    const r = formasVisiveis(muitasVelas.slice(0, 2), convTudo);
    expect(r.podadas).toBe(0);
    expect(r.velasDesenhadas).toBe(2);
  });

  it('lista vazia devolve vazio', () => {
    const r = formasVisiveis([], conv);
    expect(r.formas).toEqual([]);
    expect(r.velasDesenhadas).toBe(0);
  });
});

describe('abreviar', () => {
  it('mantém abaixo de mil; abrevia acima', () => {
    expect(abreviar(0)).toBe('0');
    expect(abreviar(999)).toBe('999');
    expect(abreviar(1234)).toBe('1.2k');
    expect(abreviar(12_345)).toBe('12k');
    expect(abreviar(1_234_567)).toBe('1.2M');
  });
  it('arredonda e trata negativo e inválido', () => {
    expect(abreviar(12.7)).toBe('13');
    expect(abreviar(-1500)).toBe('-1.5k');
    expect(abreviar(Number.NaN)).toBe('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `velaAdmiteFootprint` — traço é pior que nada
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Nasce de dois relatos consecutivos do operador em 03/09/2026: *"sai apenas
// traços"* e, depois da primeira explicação, *"os traços ainda continuam os
// mesmos"*. A degradação `NUMEROS → BARRAS` não resolvia: com um pregão de M15 na
// tela, a vela recebe ~26 px, a barra espelhada de cada nível fica com ~1 px por
// lado e o desenho polui as velas sem informar nada.
//
// A resposta correta é a camada se CALAR e dizer por quê — e é isso que este
// predicado decide, num único lugar, para o primitive e os testes usarem o mesmo
// critério.

describe('velaAdmiteFootprint', () => {
  it('recusa a vela estreita — abaixo do piso nada deve ser desenhado', () => {
    // 26 px é a largura medida na tela do operador com o pregão de M15 aberto.
    expect(velaAdmiteFootprint(26)).toBe(true); // acima do piso de 18: barras ainda valem
    expect(velaAdmiteFootprint(17)).toBe(false);
    expect(velaAdmiteFootprint(6)).toBe(false);
    expect(velaAdmiteFootprint(1)).toBe(false);
  });

  it('aceita a vela larga, onde o footprint tem o que mostrar', () => {
    expect(velaAdmiteFootprint(LARGURA_MINIMA_VELA_PX)).toBe(true);
    expect(velaAdmiteFootprint(46)).toBe(true);
    expect(velaAdmiteFootprint(120)).toBe(true);
  });

  it('largura inválida recusa, em vez de desenhar com valor inventado', () => {
    expect(velaAdmiteFootprint(0)).toBe(false);
    expect(velaAdmiteFootprint(-10)).toBe(false);
    expect(velaAdmiteFootprint(Number.NaN)).toBe(false);
    expect(velaAdmiteFootprint(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('o piso é parametrizável, e piso inválido não bloqueia o desenho', () => {
    expect(velaAdmiteFootprint(10, 8)).toBe(true);
    expect(velaAdmiteFootprint(10, 40)).toBe(false);
    // Piso furado ⇒ não é motivo para esconder a camada.
    expect(velaAdmiteFootprint(10, Number.NaN)).toBe(true);
    expect(velaAdmiteFootprint(10, 0)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A legenda: a camada tem de DIZER o que está mostrando
// ═════════════════════════════════════════════════════════════════════════════
//
// Relato do operador em 04/09/2026: *"eu esperava mais, pois não dá definição
// alguma, e ele mostra apenas na barra atual, certo? me ajuda a entender ele"*.
//
// A pergunta não tinha resposta na tela: desenhando, a camada não escrevia nada —
// só havia texto quando ela se CALAVA. E a premissa dele estava errada:
// `formasVisiveis` percorre TODAS as velas; o que limita é o dado, porque o livro
// materializado cobre ~1 h e o gráfico mostra 2 a 5 pregões.
//
// A razão `velas com dado / velas na tela` é exatamente o número que responde, e
// por isso abre a legenda.
describe('textoDaLegendaFootprint', () => {
  const base = {
    comDado: 12,
    total: 200,
    modo: 'BARRAS' as const,
    fatorDiagonal: 3,
    larguraVelaPx: 26,
    podadas: 0,
  };

  it('abre com a razão de velas com dado — o número que responde à dúvida', () => {
    const r = textoDaLegendaFootprint(base);
    expect(r).not.toBeNull();
    expect(naoNulo(r).texto).toContain('12/200 velas com dado');
    expect(naoNulo(r).alerta).toBe(false);
  });

  it('declara o modo em uso, para o operador saber se está vendo número ou barra', () => {
    expect(naoNulo(textoDaLegendaFootprint(base)).texto).toContain('barras');
    expect(
      naoNulo(textoDaLegendaFootprint({ ...base, modo: 'NUMEROS' })).texto,
    ).toContain('números');
    expect(
      naoNulo(textoDaLegendaFootprint({ ...base, modo: 'DELTA' })).texto,
    ).toContain('delta');
  });

  it('explica as DUAS marcações visuais e o limiar do desequilíbrio', () => {
    const t = naoNulo(textoDaLegendaFootprint({ ...base, fatorDiagonal: 4 })).texto;
    expect(t).toContain('POC');
    expect(t).toContain('4×');
    expect(t).toContain('alcance do dado');
  });

  it('informa a largura da vela — é ela que decide se cabe número', () => {
    expect(naoNulo(textoDaLegendaFootprint(base)).texto).toContain('26 px');
  });

  it('poda por orçamento é declarada, nunca silenciosa', () => {
    const t = naoNulo(textoDaLegendaFootprint({ ...base, podadas: 40 })).texto;
    expect(t).toContain('40 velas antigas podadas');
  });

  it('sem poda, não menciona poda', () => {
    expect(naoNulo(textoDaLegendaFootprint(base)).texto).not.toContain('podadas');
  });

  // ⚠️ O caso que mais importa: ligado e sem dado NÃO pode parecer desligado.
  it('zero velas com dado vira RESSALVA, e aponta a saída', () => {
    const r = textoDaLegendaFootprint({ ...base, comDado: 0 });
    expect(naoNulo(r).alerta).toBe(true);
    expect(naoNulo(r).texto).toContain('0 de 200 velas com dado');
    expect(naoNulo(r).texto).toContain('Focar no dia do livro');
  });

  it('sem vela nenhuma na tela, não há legenda a emitir', () => {
    expect(textoDaLegendaFootprint({ ...base, total: 0 })).toBeNull();
  });

  it('entrada não finita não produz texto corrompido', () => {
    const r = textoDaLegendaFootprint({
      ...base,
      larguraVelaPx: Number.NaN,
      fatorDiagonal: Number.NaN,
      podadas: Number.NaN,
    });
    expect(r).not.toBeNull();
    expect(naoNulo(r).texto).not.toContain('NaN');
    // Sem largura medida, o trecho de largura simplesmente não sai.
    expect(naoNulo(r).texto).not.toContain('px');
  });
});
