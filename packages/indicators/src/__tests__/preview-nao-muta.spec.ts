/**
 * preview-nao-muta — preview() e uma consulta pura sobre a barra em formacao.
 *
 * O contrato promete: chamar `preview` N vezes com fechamentos diferentes NAO
 * altera o estado consolidado. Se preview vazasse mutacao, o RSI/EMA/etc das
 * barras fechadas seriam corrompidos pela barra ao vivo — o exato bug que a
 * separacao update/preview existe para impedir.
 *
 * Estrategia: aquece com um historico, tira um snapshot, bombardeia preview com
 * varios fechamentos, e afirma que o snapshot NAO mudou. Depois confirma que um
 * update de verdade AINDA produz o mesmo que teria produzido sem os previews —
 * ou seja, os previews nao deixaram residuo.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { builtInFactories, type IndicatorFactory } from '../index.js';
import { arbSerie, valoresQuaseIguais } from './geradores.js';

const NUM_RUNS = 150;
const SEED = 777;

/** Varia uma barra so no fechamento (e nos extremos coerentes), mantendo o tempo. */
function variarFechamento(
  base: { time: number; open: number; high: number; low: number; close: number; volume?: number },
  novoClose: number,
) {
  return {
    time: base.time,
    open: base.open,
    high: Math.max(base.high, novoClose),
    low: Math.min(base.low, novoClose),
    close: novoClose,
    volume: base.volume,
  };
}

function checar(factory: IndicatorFactory): void {
  fc.assert(
    fc.property(
      arbSerie(2, 80),
      fc.array(fc.double({ min: 5, max: 250, noNaN: true, noDefaultInfinity: true }), {
        minLength: 1,
        maxLength: 12,
      }),
      (serie, fechamentos) => {
        const inst = factory.create();
        // Aquece com todas menos a ultima; a ultima serve de "barra em formacao".
        const historico = serie.slice(0, serie.length - 1);
        const proxima = serie[serie.length - 1]!;
        inst.warmup(historico);
        const snapAntes = inst.snapshot();

        // Bombardeia preview com fechamentos variados — inclusive o real.
        for (const c of fechamentos) {
          inst.preview(variarFechamento(proxima, c));
        }
        inst.preview(proxima);

        const snapDepois = inst.snapshot();
        // O estado consolidado nao pode ter mudado por causa dos previews.
        expect(valoresQuaseIguais(snapAntes, snapDepois, 0)).toBe(true);

        // E o update de verdade tem de bater com o de uma instancia que NUNCA
        // viu preview — prova de que preview nao deixou residuo no estado.
        const limpa = factory.create();
        limpa.warmup(historico);
        const valLimpa = limpa.update(proxima);
        const valSujeita = inst.update(proxima);
        expect(valoresQuaseIguais(valSujeita, valLimpa)).toBe(true);
      },
    ),
    { numRuns: NUM_RUNS, seed: SEED },
  );
}

describe('preview() nao muta o estado', () => {
  for (const factory of builtInFactories) {
    it(`${factory.meta.name}: previews repetidos nao alteram snapshot nem o proximo update`, () => {
      checar(factory);
    });
  }
});
