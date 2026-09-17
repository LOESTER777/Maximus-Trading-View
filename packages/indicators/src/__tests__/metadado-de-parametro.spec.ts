/**
 * O METADADO de parametro tem de bastar para gerar a interface.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO TRAVA, E O DEFEITO QUE MOTIVOU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ParamSpec` dizia `type: 'source'` — "isto e um preco-fonte" — e **nao enumerava**
 * quais. A camada de interface (`IndicatorToolbox`, no pacote React, que NAO importa
 * este pacote) mantinha as sete fontes escritas a mao. Duas listas, e a de la
 * condenada a envelhecer: fonte nova aqui nao apareceria no select, sem erro de
 * compilacao e sem teste reprovando.
 *
 * `ParamSpec.options` fechou o buraco — a lista viaja no metadado. Estes casos travam
 * as tres propriedades que fazem isso funcionar:
 *
 *  1. TODO parametro `type: 'source'` de TODO indicador embutido traz `options`
 *     (senao a interface cai na reserva e o buraco volta pela porta de tras);
 *  2. as opcoes cobrem a uniao `PriceSource` INTEIRA e nada alem dela;
 *  3. todo `value` de opcao e aceito por `priceOf` — opcao que a interface oferece e
 *     o calculo nao entende seria pior que opcao ausente.
 *
 * ⚠️ A cobertura da uniao tambem e garantida pelo COMPILADOR (`PRICE_SOURCE_LABELS` e
 * um `Record<PriceSource, string>`). Este arquivo mede o outro lado — que a lista
 * publicada nao ganhou entrada A MAIS, o que o tipo nao pega.
 */
import { describe, expect, it } from 'vitest';
import { builtInFactories } from '../index.js';
import { PRICE_SOURCE_OPTIONS, SOURCE_PARAM_SPEC, priceOf, type PriceSource } from '../contracts.js';

const BARRA = { time: 1_700_000_000, open: 10, high: 20, low: 5, close: 15, volume: 100 };

/** As sete fontes, escritas a mao AQUI de proposito: e o oraculo independente. */
const FONTES_ESPERADAS: readonly PriceSource[] = [
  'close',
  'open',
  'high',
  'low',
  'hl2',
  'hlc3',
  'ohlc4',
];

describe('PRICE_SOURCE_OPTIONS — a lista canonica de preco-fonte', () => {
  it('cobre exatamente a uniao PriceSource, sem faltar nem sobrar', () => {
    const valores = PRICE_SOURCE_OPTIONS.map((o) => o.value);
    expect([...valores].sort()).toEqual([...FONTES_ESPERADAS].sort());
  });

  it('`close` vem PRIMEIRO — e o default e o caso dominante', () => {
    expect(PRICE_SOURCE_OPTIONS[0]?.value).toBe('close');
  });

  it('todo rotulo e texto legivel, nao a chave crua', () => {
    for (const o of PRICE_SOURCE_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(2);
      expect(o.label).not.toBe(o.value);
    }
  });

  /**
   * ⚠️ Opcao que a interface oferece e o calculo nao entende cairia no `default` de
   * `priceOf` (fechamento) em silencio: o operador escolheria "Máxima" e veria a media
   * do fechamento, sem erro nenhum.
   */
  it('todo valor de opcao e entendido por priceOf', () => {
    const esperado: Readonly<Record<PriceSource, number>> = {
      open: 10,
      high: 20,
      low: 5,
      close: 15,
      hl2: 12.5,
      hlc3: (20 + 5 + 15) / 3,
      ohlc4: (10 + 20 + 5 + 15) / 4,
    };
    for (const o of PRICE_SOURCE_OPTIONS) {
      const fonte = o.value as PriceSource;
      expect(priceOf(BARRA, fonte)).toBeCloseTo(esperado[fonte], 10);
    }
  });
});

describe('SOURCE_PARAM_SPEC — o spec canonico, reusado pelos indicadores', () => {
  it('traz as opcoes e o default `close`', () => {
    expect(SOURCE_PARAM_SPEC.type).toBe('source');
    expect(SOURCE_PARAM_SPEC.default).toBe('close');
    expect(SOURCE_PARAM_SPEC.options).toBe(PRICE_SOURCE_OPTIONS);
  });
});

describe('⭐ todo indicador embutido publica opcoes nos parametros enumerados', () => {
  /**
   * A guarda que impede a regressao pela porta de tras: um indicador NOVO que declare
   * `type: 'source'` escrevendo o spec a mao (em vez de reusar `SOURCE_PARAM_SPEC`)
   * ficaria sem `options`, e a interface cairia na lista de reserva — exatamente o
   * estado que se quis eliminar.
   */
  it('nenhum parametro `source` sem `options`', () => {
    const faltando: string[] = [];
    let conferidos = 0;
    for (const f of builtInFactories) {
      for (const p of f.meta.params) {
        if (p.type !== 'source') continue;
        conferidos += 1;
        if (p.options === undefined || p.options.length === 0) {
          faltando.push(`${f.meta.name}.${p.name}`);
        }
      }
    }
    // Guarda de vacuidade: se nenhum parametro `source` fosse encontrado, o caso
    // passaria verde sem medir nada.
    expect(conferidos).toBeGreaterThanOrEqual(8);
    expect(faltando).toEqual([]);
  });

  it('as opcoes de `source` sao as canonicas, nao uma copia divergente', () => {
    for (const f of builtInFactories) {
      for (const p of f.meta.params) {
        if (p.type !== 'source') continue;
        expect(p.options?.map((o) => o.value)).toEqual(PRICE_SOURCE_OPTIONS.map((o) => o.value));
      }
    }
  });

  /**
   * ⚠️ E o inverso: parametro que NAO e enumerado nao pode trazer `options`, senao a
   * interface o transformaria num select e o operador perderia o campo numerico livre
   * (digitar 200 no periodo viraria escolher entre valores fixos).
   */
  it('parametro numerico nao traz `options` por acidente', () => {
    for (const f of builtInFactories) {
      for (const p of f.meta.params) {
        if (p.type === 'number') expect(p.options).toBeUndefined();
      }
    }
  });
});
