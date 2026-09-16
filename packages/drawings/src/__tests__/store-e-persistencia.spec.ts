/**
 * store e persistencia — desfazer/refazer e leitura de dado nao confiavel.
 *
 * ⭐ O teste de COALESCENCIA e o que decide se o desfazer serve: um arrasto gera
 * dezenas de estados por segundo, e sem agrupamento o usuario precisaria apertar
 * desfazer 40 vezes para voltar um gesto.
 */
import { describe, expect, it } from 'vitest';
import {
  DrawingsStore,
  EMPTY_STATE,
  addDrawing,
  addToSelection,
  clearSelection,
  removeDrawings,
  replaceDrawing,
  selectOnly,
} from '../store.core.js';
import { DRAWINGS_SCHEMA_VERSION, deserialize, serialize } from '../serialize.core.js';
import { withAnchor, type Drawing } from '../model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Insumos
// ═════════════════════════════════════════════════════════════════════════════

function linha(id: string, t = 100, p = 10): Drawing {
  return {
    id,
    kind: 'TRENDLINE',
    anchors: [
      { timeSec: t, price: p },
      { timeSec: t + 100, price: p + 10 },
    ],
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Transformacoes puras
// ═════════════════════════════════════════════════════════════════════════════

describe('transformacoes de estado', () => {
  it('addDrawing acrescenta ao fim', () => {
    const s = addDrawing(addDrawing(EMPTY_STATE, linha('a')), linha('b'));
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('replaceDrawing troca pelo id e preserva a ordem', () => {
    const s = addDrawing(addDrawing(EMPTY_STATE, linha('a')), linha('b'));
    const t = replaceDrawing(s, linha('a', 999, 99));
    expect(t.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    expect(t.drawings[0]?.anchors[0]?.timeSec).toBe(999);
  });

  it('replaceDrawing com id inexistente devolve o MESMO objeto', () => {
    const s = addDrawing(EMPTY_STATE, linha('a'));
    expect(replaceDrawing(s, linha('z'))).toBe(s);
  });

  /**
   * Deixar id removido na selecao produziria alca desenhada sobre desenho
   * inexistente na proxima passada.
   */
  it('removeDrawings limpa a SELECAO correspondente', () => {
    let s = addDrawing(addDrawing(EMPTY_STATE, linha('a')), linha('b'));
    s = selectOnly(s, ['a', 'b']);
    const t = removeDrawings(s, ['a']);
    expect(t.drawings.map((d) => d.id)).toEqual(['b']);
    expect(t.selectedIds).toEqual(['b']);
  });

  it('selectOnly descarta id inexistente', () => {
    const s = addDrawing(EMPTY_STATE, linha('a'));
    expect(selectOnly(s, ['a', 'fantasma']).selectedIds).toEqual(['a']);
  });

  it('addToSelection nao repete e nao aceita inexistente', () => {
    let s = addDrawing(EMPTY_STATE, linha('a'));
    s = addToSelection(s, 'a');
    s = addToSelection(s, 'a');
    s = addToSelection(s, 'fantasma');
    expect(s.selectedIds).toEqual(['a']);
  });

  it('clearSelection em estado ja limpo devolve o MESMO objeto', () => {
    const s = addDrawing(EMPTY_STATE, linha('a'));
    expect(clearSelection(s)).toBe(s);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Historico
// ═════════════════════════════════════════════════════════════════════════════

describe('DrawingsStore — desfazer e refazer', () => {
  it('comeca sem passado nem futuro', () => {
    const st = new DrawingsStore();
    expect(st.canUndo()).toBe(false);
    expect(st.canRedo()).toBe(false);
    expect(st.drawings()).toEqual([]);
  });

  it('desfaz e refaz uma sequencia', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));
    st.commit(addDrawing(st.state(), linha('b')));
    expect(st.drawings().map((d) => d.id)).toEqual(['a', 'b']);

    st.undo();
    expect(st.drawings().map((d) => d.id)).toEqual(['a']);
    st.undo();
    expect(st.drawings()).toEqual([]);
    expect(st.canUndo()).toBe(false);

    st.redo();
    expect(st.drawings().map((d) => d.id)).toEqual(['a']);
    st.redo();
    expect(st.drawings().map((d) => d.id)).toEqual(['a', 'b']);
    expect(st.canRedo()).toBe(false);
  });

  it('desfazer sem passado e refazer sem futuro nao lancam', () => {
    const st = new DrawingsStore();
    expect(() => st.undo()).not.toThrow();
    expect(() => st.redo()).not.toThrow();
    expect(st.drawings()).toEqual([]);
  });

  it('um commit novo DESCARTA o ramo futuro', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));
    st.commit(addDrawing(st.state(), linha('b')));
    st.undo();
    expect(st.canRedo()).toBe(true);

    st.commit(addDrawing(st.state(), linha('c')));
    expect(st.canRedo()).toBe(false);
    expect(st.drawings().map((d) => d.id)).toEqual(['a', 'c']);
  });

  /**
   * ⭐⭐ A propriedade que faz o desfazer ser util.
   *
   * Um arrasto gera dezenas de commits. Com a mesma chave, todos colapsam num
   * passo — e o usuario volta o gesto inteiro com um Ctrl+Z.
   */
  it('COALESCE commits com a mesma chave — um arrasto e UM passo', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));

    // Simula 40 quadros de arrasto da alca 1.
    for (let i = 0; i < 40; i++) {
      const atual = st.byId('a');
      expect(atual).toBeDefined();
      if (atual === undefined) return;
      st.commit(
        replaceDrawing(st.state(), withAnchor(atual, 1, { timeSec: 200 + i, price: 20 + i })),
        'resize:a:1',
      );
    }
    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(239);

    // UM desfazer volta o gesto todo.
    st.undo();
    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(200);
  });

  /**
   * Sem `endMerge`, dois arrastos da MESMA alca se fundiriam — o usuario perderia
   * a capacidade de desfazer so o ultimo.
   */
  it('endMerge separa dois gestos consecutivos da mesma alca', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));

    const mover = (t: number): void => {
      const atual = st.byId('a');
      if (atual === undefined) return;
      st.commit(replaceDrawing(st.state(), withAnchor(atual, 1, { timeSec: t, price: 20 })), 'resize:a:1');
    };

    mover(300);
    mover(310);
    st.endMerge(); // solta o mouse

    mover(400);
    mover(410);
    st.endMerge();

    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(410);
    st.undo();
    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(310); // volta so o 2o gesto
    st.undo();
    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(200); // volta o 1o
  });

  it('chave `null` NUNCA agrupa — duas operacoes distintas nao se fundem', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')), null);
    st.commit(addDrawing(st.state(), linha('b')), null);
    st.undo();
    expect(st.drawings().map((d) => d.id)).toEqual(['a']);
  });

  it('chaves diferentes nao agrupam', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));
    const a = st.byId('a');
    if (a === undefined) return;
    st.commit(replaceDrawing(st.state(), withAnchor(a, 0, { timeSec: 1, price: 1 })), 'resize:a:0');
    const b = st.byId('a');
    if (b === undefined) return;
    st.commit(replaceDrawing(st.state(), withAnchor(b, 1, { timeSec: 2, price: 2 })), 'resize:a:1');

    st.undo();
    expect(st.byId('a')?.anchors[1]?.timeSec).toBe(200);
    expect(st.byId('a')?.anchors[0]?.timeSec).toBe(1);
  });

  it('respeita o limite de profundidade sem quebrar', () => {
    const st = new DrawingsStore(EMPTY_STATE, 3);
    for (let i = 0; i < 10; i++) st.commit(addDrawing(st.state(), linha(`d${i}`)));
    let passos = 0;
    while (st.canUndo() && passos < 50) {
      st.undo();
      passos++;
    }
    expect(passos).toBeLessThanOrEqual(3);
    expect(() => st.undo()).not.toThrow();
  });

  /**
   * `reset` ZERA o historico de proposito: manter permitiria desfazer o
   * carregamento e cair no documento de OUTRO ativo — estado que o usuario nao
   * consegue explicar.
   */
  it('reset zera o historico', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a')));
    expect(st.canUndo()).toBe(true);

    st.reset({ drawings: [linha('z')], selectedIds: [] });
    expect(st.canUndo()).toBe(false);
    expect(st.canRedo()).toBe(false);
    expect(st.drawings().map((d) => d.id)).toEqual(['z']);
  });

  /** Snapshot so e seguro porque o modelo e imutavel. */
  it('o estado passado NAO e alterado por edicao posterior', () => {
    const st = new DrawingsStore();
    st.commit(addDrawing(st.state(), linha('a', 100, 10)));
    const passado = st.state();

    const a = st.byId('a');
    if (a === undefined) return;
    st.commit(replaceDrawing(st.state(), withAnchor(a, 0, { timeSec: 555, price: 55 })));

    expect(passado.drawings[0]?.anchors[0]?.timeSec).toBe(100);
    expect(st.byId('a')?.anchors[0]?.timeSec).toBe(555);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Leitura de dado nao confiavel
// ═════════════════════════════════════════════════════════════════════════════

describe('deserialize — a entrada e sempre `unknown`', () => {
  it('NUNCA lanca, para qualquer entrada', () => {
    const hostis: unknown[] = [
      null,
      undefined,
      42,
      'texto',
      [],
      {},
      { version: 'um' },
      { version: 1 },
      { version: 1, drawings: 'nao e lista' },
      { version: 1, drawings: [null, 42, 'x', {}] },
      { version: 1, drawings: [{ id: '', kind: 'TRENDLINE', anchors: [] }] },
    ];
    for (const h of hostis) {
      expect(() => deserialize(h)).not.toThrow();
      const r = deserialize(h);
      expect(Array.isArray(r.document.drawings)).toBe(true);
    }
  });

  it('recusa documento de versao FUTURA em vez de carregar parcialmente', () => {
    const r = deserialize({ version: DRAWINGS_SCHEMA_VERSION + 1, drawings: [linha('a')] });
    expect(r.document.drawings).toHaveLength(0);
    expect(r.reasons.join(' ')).toContain('mais nova');
  });

  /**
   * ⭐ Recusa PARCIAL: um item corrompido nao invalida os outros.
   *
   * Perder um desenho e ruim; perder o documento inteiro e pior.
   */
  it('descarta o item ruim e PRESERVA os bons', () => {
    const r = deserialize({
      version: 1,
      drawings: [
        linha('bom1'),
        { id: 'ruim', kind: 'FERRAMENTA_INVENTADA', anchors: [{ timeSec: 1, price: 1 }] },
        linha('bom2'),
        { id: 'sem-ancora', kind: 'TRENDLINE', anchors: [{ timeSec: 1, price: 1 }] },
        linha('bom3'),
      ],
    });
    expect(r.document.drawings.map((d) => d.id)).toEqual(['bom1', 'bom2', 'bom3']);
    expect(r.rejected).toBe(2);
    expect(r.reasons).toHaveLength(2);
  });

  it('descarta ancora nao-finita e recusa o item se faltar o minimo', () => {
    const r = deserialize({
      version: 1,
      drawings: [
        {
          id: 'x',
          kind: 'TRENDLINE',
          anchors: [{ timeSec: 1, price: 1 }, { timeSec: NaN, price: 2 }],
        },
      ],
    });
    // Uma ancora valida so, e TRENDLINE exige duas.
    expect(r.document.drawings).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it('id REPETIDO: o primeiro ganha, o segundo e descartado com motivo', () => {
    const r = deserialize({ version: 1, drawings: [linha('dup', 1, 1), linha('dup', 2, 2)] });
    expect(r.document.drawings).toHaveLength(1);
    expect(r.document.drawings[0]?.anchors[0]?.timeSec).toBe(1);
    expect(r.rejected).toBe(1);
    expect(r.reasons.join(' ')).toContain('repetido');
  });

  /**
   * Campo de estilo invalido e OMITIDO, nao rejeita o desenho: perder a cor e
   * aceitavel (cai no default), perder a linha de tendencia nao e.
   */
  it('estilo invalido cai no default sem derrubar o desenho', () => {
    const r = deserialize({
      version: 1,
      drawings: [
        {
          ...linha('a'),
          style: { color: 42, lineWidth: 99, lineStyle: 'ZIGUEZAGUE', fill: null, label: 7 },
        },
      ],
    });
    expect(r.document.drawings).toHaveLength(1);
    expect(r.document.drawings[0]?.style).toBeUndefined();
  });

  it('preserva os campos de estilo VALIDOS e descarta so os invalidos', () => {
    const r = deserialize({
      version: 1,
      drawings: [{ ...linha('a'), style: { color: '#fff', lineWidth: 99, lineStyle: 'DOTTED' } }],
    });
    const s = r.document.drawings[0]?.style;
    expect(s?.color).toBe('#fff');
    expect(s?.lineStyle).toBe('DOTTED');
    expect(s?.lineWidth).toBeUndefined();
  });

  it('niveis de Fibonacci nao-finitos sao filtrados', () => {
    const r = deserialize({
      version: 1,
      drawings: [{ ...linha('a'), kind: 'FIB_RETRACEMENT', fibLevels: [0, NaN, 0.5, 'x', 1] }],
    });
    expect(r.document.drawings[0]?.fibLevels).toEqual([0, 0.5, 1]);
  });

  it('serialize sem simbolo omite o campo', () => {
    const doc = serialize([linha('a')]);
    expect(doc).not.toHaveProperty('symbol');
    expect(doc.version).toBe(DRAWINGS_SCHEMA_VERSION);
  });
});
