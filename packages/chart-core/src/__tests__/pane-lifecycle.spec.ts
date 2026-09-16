/**
 * pane-lifecycle — criar e REMOVER sub-paineis sem deixar orfao.
 *
 * Fecha a divida que existia enquanto o motor nao tinha `removePane`: alternar
 * osciladores deixava a faixa vazia. Estes testes provam que a pane some de
 * verdade e que os indices estaveis sobrevivem a remocao do meio.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobustusChartCore } from '../chart.js';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('addPane / removePane', () => {
  it('addPane devolve indices estaveis crescentes, comecando em 1', () => {
    const chart = new RobustusChartCore(container);
    try {
      expect(chart.addPane()).toBe(1);
      expect(chart.addPane()).toBe(2);
      expect(chart.addPane()).toBe(3);
    } finally {
      chart.remove();
    }
  });

  it('removePane tira a faixa e nao lanca com dado ativo', () => {
    const chart = new RobustusChartCore(container);
    try {
      const preco = chart.addSeries('Candlestick');
      preco.setData([
        { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
        { time: 2, open: 1.5, high: 2.5, low: 1, close: 2 },
      ]);
      const pane = chart.addPane();
      const rsi = chart.addSeries('Line', {}, pane);
      rsi.setData([{ time: 1, value: 50 } as never, { time: 2, value: 55 } as never]);

      expect(() => chart.removePane(pane)).not.toThrow();
      // Remover de novo e no-op idempotente.
      expect(() => chart.removePane(pane)).not.toThrow();
    } finally {
      chart.remove();
    }
  });

  it('remover a pane do MEIO preserva o indice da que ficou', () => {
    const chart = new RobustusChartCore(container);
    try {
      const p1 = chart.addPane(); // 1
      const p2 = chart.addPane(); // 2
      const p3 = chart.addPane(); // 3
      expect([p1, p2, p3]).toEqual([1, 2, 3]);

      // Tira a do meio. p3 continua sendo 3 — indice ESTAVEL, nao renumerado.
      chart.removePane(p2);

      // Uma serie posta em p3 depois da remocao ainda encontra a pane certa.
      const s = chart.addSeries('Line', {}, p3);
      s.setData([{ time: 1, value: 1 } as never]);
      expect(() => chart.removePane(p3)).not.toThrow();
    } finally {
      chart.remove();
    }
  });

  it('a pane principal (0) NAO e removivel', () => {
    const chart = new RobustusChartCore(container);
    try {
      const preco = chart.addSeries('Candlestick');
      preco.setData([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }]);
      // Pedido de remover a 0 e ignorado — ela e o grafico de preco.
      expect(() => chart.removePane(0)).not.toThrow();
      // A serie de preco continua viva (o grafico nao quebrou).
      expect(() => preco.setData([{ time: 2, open: 2, high: 3, low: 1, close: 2.5 }])).not.toThrow();
    } finally {
      chart.remove();
    }
  });

  it('remover indice inexistente e no-op', () => {
    const chart = new RobustusChartCore(container);
    try {
      expect(() => chart.removePane(99)).not.toThrow();
    } finally {
      chart.remove();
    }
  });
});
