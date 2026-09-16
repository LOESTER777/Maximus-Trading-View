/**
 * Testes da coleção de alertas. Foco: add/remove/list, disparo carimbado com a
 * chave, e `feedAll` determinístico sobre uma sequência.
 */

import { describe, it, expect } from 'vitest';
import { AlertStore, createAlert, type Sample } from '../index.js';

function amostra(time: number, value: number): Sample {
  return { time, value };
}

describe('AlertStore — add/remove/list', () => {
  it('adiciona, lista na ordem de inserção e remove', () => {
    const store = new AlertStore();
    store.add('a', createAlert({ kind: 'CROSS_ABOVE', level: 100 }));
    store.add('b', createAlert({ kind: 'CROSS_BELOW', level: 50 }));
    expect(store.size).toBe(2);
    expect(store.list().map(([k]) => k)).toEqual(['a', 'b']);
    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).not.toBeNull();
  });
});

describe('AlertStore — feed / feedAll', () => {
  it('coleta só os disparos, carimbados com a chave', () => {
    const store = new AlertStore();
    store.add('acima', createAlert({ kind: 'CROSS_ABOVE', level: 100 }));
    store.add('abaixo', createAlert({ kind: 'CROSS_BELOW', level: 100 }));

    // 99 → 101: só 'acima' cruza.
    store.feed(amostra(0, 99));
    const eventos = store.feed(amostra(1, 101));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.key).toBe('acima');
    expect(eventos[0]?.sample?.value).toBe(101);
  });

  it('feedAll reproduz uma sequência e é determinístico', () => {
    const construir = () => {
      const s = new AlertStore();
      s.add('x', createAlert({ kind: 'CROSS_ABOVE', level: 100 }, { mode: 'recurring' }));
      return s;
    };
    const seq = [99, 101, 102, 98, 105].map((v, i) => amostra(i, v));

    const e1 = construir().feedAll(seq);
    const e2 = construir().feedAll(seq);
    expect(e1.map((e) => [e.key, e.sample?.time])).toEqual(e2.map((e) => [e.key, e.sample?.time]));
    // Dois cruzamentos: em time=1 e time=4.
    expect(e1.map((e) => e.sample?.time)).toEqual([1, 4]);
  });

  it('feedAll com coleção vazia devolve vazio', () => {
    const store = new AlertStore();
    expect(store.feedAll([amostra(0, 1), amostra(1, 2)])).toEqual([]);
  });
});
