/**
 * Testes do motor de alertas.
 *
 * A regra que mais importa aqui é "sem repique": os testes de `once`/`recurring`
 * e o de "CROSS_ABOVE só na transição" são a rede que impede o bug clássico de
 * um alerta disparar em cada amostra acima do nível. O property test fecha o
 * determinismo.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createAlert,
  feed,
  rearm,
  type Alert,
  type AlertCondition,
  type Sample,
} from '../index.js';

/** Constrói uma amostra com defaults compactos. */
function amostra(time: number, value: number, high?: number, low?: number): Sample {
  return { time, value, high, low };
}

/** Alimenta uma série e devolve os índices em que houve disparo. */
function indicesDeDisparo(alert: Alert, valores: readonly number[]): number[] {
  const disparos: number[] = [];
  valores.forEach((v, i) => {
    if (feed(alert, amostra(i, v)).fired) disparos.push(i);
  });
  return disparos;
}

describe('CROSS_ABOVE — só na transição', () => {
  const cond: AlertCondition = { kind: 'CROSS_ABOVE', level: 100 };

  it('dispara no instante do cruzamento de baixo para cima', () => {
    const a = createAlert(cond);
    // 98 → 99 (abaixo), 101 (cruza), 102 (já acima), ...
    expect(indicesDeDisparo(a, [98, 99, 101, 102])).toEqual([2]);
  });

  it('NÃO dispara quando já nasce acima do nível (sem amostra anterior)', () => {
    const a = createAlert(cond);
    // Primeira amostra já acima: não há "de onde" cruzar.
    expect(indicesDeDisparo(a, [150, 151, 152])).toEqual([]);
  });

  it('NÃO repica enquanto permanece acima', () => {
    const a = createAlert(cond);
    // Um único cruzamento em i=1, depois fica acima por muitas amostras.
    const valores = [99, 101, 102, 103, 104, 105, 106, 107];
    expect(indicesDeDisparo(a, valores)).toEqual([1]);
  });

  it('tocar exatamente o nível não é cruzar (level não conta como acima)', () => {
    const a = createAlert(cond);
    // 99 → 100 (igual, prev<=level && curr>level é falso) → 101 (cruza)
    expect(indicesDeDisparo(a, [99, 100, 101])).toEqual([2]);
  });
});

describe('CROSS_BELOW — só na transição', () => {
  const cond: AlertCondition = { kind: 'CROSS_BELOW', level: 100 };

  it('dispara ao cruzar de cima para baixo', () => {
    const a = createAlert(cond);
    expect(indicesDeDisparo(a, [102, 101, 99, 98])).toEqual([2]);
  });

  it('não dispara enquanto sobe', () => {
    const a = createAlert(cond);
    expect(indicesDeDisparo(a, [98, 99, 101, 102])).toEqual([]);
  });
});

describe('TOUCH — high/low da barra', () => {
  it('dispara quando a mecha perfura o nível mesmo que o value volte', () => {
    const a = createAlert({ kind: 'TOUCH', level: 130 });
    // value fecha longe, mas high alcança o nível.
    expect(feed(a, amostra(0, 125, 131, 124)).fired).toBe(true);
  });

  it('não dispara quando a barra não alcança o nível', () => {
    const a = createAlert({ kind: 'TOUCH', level: 130 });
    expect(feed(a, amostra(0, 125, 128, 124)).fired).toBe(false);
  });

  it('sem high/low, o value faz os dois', () => {
    const a = createAlert({ kind: 'TOUCH', level: 130 });
    expect(feed(a, amostra(0, 130)).fired).toBe(true);
    const b = createAlert({ kind: 'TOUCH', level: 130 });
    expect(feed(b, amostra(0, 129)).fired).toBe(false);
  });
});

describe('ENTER_ZONE / EXIT_ZONE — transições', () => {
  it('ENTER_ZONE dispara ao entrar, não enquanto permanece dentro', () => {
    const a = createAlert({ kind: 'ENTER_ZONE', min: 100, max: 110 });
    // fora → entra (i=1) → dentro → dentro
    expect(indicesDeDisparo(a, [90, 105, 106, 108])).toEqual([1]);
  });

  it('EXIT_ZONE dispara ao sair, não enquanto permanece fora', () => {
    const a = createAlert({ kind: 'EXIT_ZONE', min: 100, max: 110 });
    // dentro → dentro → sai (i=2) → fora
    expect(indicesDeDisparo(a, [105, 106, 120, 121])).toEqual([2]);
  });

  it('ENTER_ZONE não dispara se a primeira amostra já nasce dentro', () => {
    const a = createAlert({ kind: 'ENTER_ZONE', min: 100, max: 110 });
    expect(indicesDeDisparo(a, [105, 106])).toEqual([]);
  });
});

describe('PERCENT_CHANGE — variação desde o armamento', () => {
  it("dispara 'up' quando sobe o percentual pedido a partir da baseline", () => {
    const a = createAlert({ kind: 'PERCENT_CHANGE', percent: 5, direction: 'up' });
    // baseline = 100; 104 (+4%) não; 105 (+5%) dispara.
    expect(indicesDeDisparo(a, [100, 104, 105])).toEqual([2]);
  });

  it("dispara 'down' com variação negativa", () => {
    const a = createAlert({ kind: 'PERCENT_CHANGE', percent: 10, direction: 'down' });
    expect(indicesDeDisparo(a, [100, 95, 90])).toEqual([2]);
  });

  it("'both' dispara em qualquer sentido que exceda a magnitude", () => {
    const a = createAlert({ kind: 'PERCENT_CHANGE', percent: 3, direction: 'both' });
    expect(indicesDeDisparo(a, [100, 101, 97])).toEqual([2]);
  });

  it('baseline zero nunca dispara (variação indefinida, não Infinity)', () => {
    const a = createAlert({ kind: 'PERCENT_CHANGE', percent: 1, direction: 'both' });
    expect(indicesDeDisparo(a, [0, 100, -100])).toEqual([]);
  });
});

describe('sem repique — once vs recurring', () => {
  const cond: AlertCondition = { kind: 'CROSS_ABOVE', level: 100 };

  it('once dispara uma vez e fica DESARMADO para sempre', () => {
    const a = createAlert(cond, { mode: 'once' });
    // cruza (i=1), volta pra baixo, cruza de novo (i=4) — mas once não repica.
    expect(indicesDeDisparo(a, [99, 101, 98, 97, 105])).toEqual([1]);
    expect(a.state).toBe('TRIGGERED');
  });

  it('recurring re-arma SÓ após o reset da condição e dispara de novo', () => {
    const a = createAlert(cond, { mode: 'recurring' });
    // cruza (i=1) → fica acima (não repica) → volta pra baixo (reset) →
    // cruza de novo (i=5).
    expect(indicesDeDisparo(a, [99, 101, 102, 103, 98, 105])).toEqual([1, 5]);
  });

  it('recurring não re-arma enquanto a condição continua valendo', () => {
    const a = createAlert(cond, { mode: 'recurring' });
    // Cruza e permanece acima: um único disparo.
    expect(indicesDeDisparo(a, [99, 101, 110, 120, 130])).toEqual([1]);
  });

  it('rearm() zera o estado e permite disparar de novo', () => {
    const a = createAlert(cond, { mode: 'once' });
    expect(indicesDeDisparo(a, [99, 101])).toEqual([1]);
    rearm(a);
    expect(a.state).toBe('ARMED');
    expect(feed(a, amostra(10, 99)).fired).toBe(false);
    expect(feed(a, amostra(11, 101)).fired).toBe(true);
  });
});

describe('amostra não-finita é ignorada', () => {
  const cond: AlertCondition = { kind: 'CROSS_ABOVE', level: 100 };

  it('NaN/Infinity não disparam nem viram amostra anterior', () => {
    const a = createAlert(cond);
    expect(feed(a, amostra(0, 99)).fired).toBe(false);
    // NaN no meio: ignorado, não vira previous.
    expect(feed(a, amostra(1, NaN)).fired).toBe(false);
    expect(feed(a, amostra(2, Infinity)).fired).toBe(false);
    // A transição 99 → 101 ainda é detectada, pois o previous continua 99.
    expect(feed(a, amostra(3, 101)).fired).toBe(true);
  });

  it('time não-finito também é ignorado', () => {
    const a = createAlert(cond);
    expect(feed(a, amostra(0, 99)).fired).toBe(false);
    expect(feed(a, amostra(NaN, 101)).fired).toBe(false);
    // O 101 com time NaN foi ignorado; previous segue 99.
    expect(feed(a, amostra(1, 101)).fired).toBe(true);
  });

  it('não quebra o estado: o alerta segue funcional após muito lixo', () => {
    const a = createAlert(cond);
    feed(a, amostra(0, 99));
    for (let i = 0; i < 50; i++) feed(a, amostra(i + 1, NaN));
    expect(feed(a, amostra(100, 101)).fired).toBe(true);
  });
});

describe('determinismo (fast-check)', () => {
  it('a mesma sequência produz exatamente os mesmos disparos', () => {
    const condArb = fc.oneof(
      fc.record({ kind: fc.constant('CROSS_ABOVE' as const), level: fc.integer({ min: -50, max: 50 }) }),
      fc.record({ kind: fc.constant('CROSS_BELOW' as const), level: fc.integer({ min: -50, max: 50 }) }),
      fc.record({ kind: fc.constant('TOUCH' as const), level: fc.integer({ min: -50, max: 50 }) }),
      fc.record({
        kind: fc.constant('ENTER_ZONE' as const),
        min: fc.integer({ min: -50, max: 0 }),
        max: fc.integer({ min: 1, max: 50 }),
      }),
      fc.record({
        kind: fc.constant('EXIT_ZONE' as const),
        min: fc.integer({ min: -50, max: 0 }),
        max: fc.integer({ min: 1, max: 50 }),
      }),
      fc.record({
        kind: fc.constant('PERCENT_CHANGE' as const),
        percent: fc.integer({ min: 1, max: 20 }),
        direction: fc.constantFrom('up' as const, 'down' as const, 'both' as const),
      }),
    );

    const seqArb = fc.array(
      fc.record({
        value: fc.integer({ min: -100, max: 100 }),
        // Injeta lixo ocasional para exercitar o descarte de não-finito.
        garbage: fc.boolean(),
      }),
      { maxLength: 60 },
    );

    fc.assert(
      fc.property(condArb, seqArb, fc.constantFrom('once' as const, 'recurring' as const), (cond, seq, mode) => {
        const rodar = () => {
          const a = createAlert(cond as AlertCondition, { mode });
          return seq.map((s, i) =>
            feed(a, amostra(i, s.garbage ? NaN : s.value)).fired,
          );
        };
        expect(rodar()).toEqual(rodar());
      }),
      { numRuns: 200 },
    );
  });

  it('nunca lança, mesmo com entrada arbitrária', () => {
    const sampleArb = fc.record({
      time: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(Infinity)),
      value: fc.oneof(fc.double(), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
      high: fc.option(fc.double(), { nil: undefined }),
      low: fc.option(fc.double(), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(sampleArb, { maxLength: 40 }), (samples) => {
        const a = createAlert({ kind: 'CROSS_ABOVE', level: 0 }, { mode: 'recurring' });
        expect(() => samples.forEach((s) => feed(a, s as Sample))).not.toThrow();
      }),
    );
  });
});
