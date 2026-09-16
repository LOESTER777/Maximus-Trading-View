/**
 * incremental-igual-batch — A PROVA DE CORRECAO do pacote.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO AFIRMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Para CADA indicador e para qualquer serie de barras:
 *
 *     warmup(serie)  ==  alimentar barra a barra por update()
 *
 * ponto a ponto, dentro de 1e-6. E a propriedade central declarada no contrato:
 * o modelo incremental so vale se produzir a MESMA serie que o batch. Se um
 * indicador novo violar isso — semente errada, soma que deriva, estado que
 * vaza — este teste reprova.
 *
 * O `buildInstance` faz warmup POR reconstrucao (reset + updates), entao warmup
 * e update ja compartilham o caminho por construcao. Este teste fecha o circulo:
 * garante que uma instancia RECEM-CRIADA alimentada por update chega no mesmo
 * lugar que warmup — ou seja, que nao ha estado inicial escondido que o warmup
 * zere mas o update nao.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { builtInFactories, type IndicatorFactory } from '../index.js';
import { arbSerie, valoresQuaseIguais } from './geradores.js';

const NUM_RUNS = 200;
const SEED = 20260830;

function checarIndicador(factory: IndicatorFactory): void {
  fc.assert(
    fc.property(arbSerie(1, 120), (serie) => {
      // Caminho A: warmup de uma vez.
      const inA = factory.create();
      const pontosBatch = inA.warmup(serie);

      // Caminho B: instancia nova, barra a barra por update.
      const inB = factory.create();
      const pontosIncremental = serie.map((bar) => ({
        time: bar.time,
        values: inB.update(bar),
      }));

      expect(pontosIncremental.length).toBe(pontosBatch.length);
      for (let i = 0; i < pontosBatch.length; i++) {
        const b = pontosBatch[i]!;
        const inc = pontosIncremental[i]!;
        expect(inc.time).toBe(b.time);
        const igual = valoresQuaseIguais(inc.values, b.values);
        if (!igual) {
          // Mensagem rica: qual indicador, em que barra, e os dois valores.
          throw new Error(
            `${factory.meta.name}: divergencia na barra ${i}\n` +
              `  batch=${JSON.stringify(b.values)}\n` +
              `  incr =${JSON.stringify(inc.values)}`,
          );
        }
      }
    }),
    { numRuns: NUM_RUNS, seed: SEED },
  );
}

describe('incremental == batch (a prova de correcao)', () => {
  for (const factory of builtInFactories) {
    it(`${factory.meta.name}: warmup(serie) === updates(serie)`, () => {
      checarIndicador(factory);
    });
  }

  it('todo indicador embutido esta coberto por este teste', () => {
    // Guarda contra alguem adicionar fabrica ao registry e esquecer o teste:
    // como iteramos builtInFactories, um indicador novo entra aqui de graca.
    // Esta assercao existe so para documentar a intencao e travar a contagem.
    expect(builtInFactories.length).toBeGreaterThanOrEqual(20);
  });
});
