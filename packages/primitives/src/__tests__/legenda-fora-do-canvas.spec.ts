/**
 * Supressão da legenda do FOOTPRINT desenhada sobre a área de plotagem.
 *
 * ⚠️ A parte do LIVRO vive em `BookmapPrimitive.spec.ts`, junto da bancada de
 * canvas falso que já existe lá — medir texto realmente emitido é mais forte que
 * inspecionar o plano interno, e foi assim que descobri que a primeira versão
 * deste arquivo passava por vacuidade: a legenda estava vazia nos dois casos e o
 * teste de supressão "passava" sem provar nada.
 *
 * Motivo da feature: com duas ou mais camadas densas ativas as legendas somam
 * seis linhas de texto sobre o gráfico e escondem o dado que descrevem. Foi o
 * que o operador fotografou em 04/09/2026.
 */

import { describe, it, expect } from 'vitest';
import { FootprintPrimitive, type FootprintLayerOptions } from '@robustus/charts-primitives';
import type { VelaFootprint } from '@robustus/charts-core';

function velaFootprint(tempoSec = 1_788_000_000): VelaFootprint {
  return {
    tempoSec,
    niveis: [
      { preco: 188_000, compra: 40, venda: 10 },
      { preco: 188_005, compra: 8, venda: 55 },
    ],
    totalCompra: 48,
    totalVenda: 65,
    delta: -17,
    poc: 188_005,
  } as unknown as VelaFootprint;
}

function opcoes(over: Partial<FootprintLayerOptions> = {}): FootprintLayerOptions {
  return { velas: [velaFootprint()], passoPreco: 5, ...over };
}

/**
 * Formas emitidas pelo primitive.
 *
 * A legenda é identificada por `papel: 'legenda'` — campo que passou a existir
 * em 03/09/2026 justamente porque POC, colchete de alcance e legenda são todos
 * `tipo: 'linha'`/texto, e distinguir por tipo era frágil.
 */
function formasDo(p: FootprintPrimitive): readonly { papel?: string }[] {
  const interno = p as unknown as { formas?: readonly { papel?: string }[] };
  return interno.formas ?? [];
}

/**
 * Opções guardadas pelo primitive.
 *
 * ⚠️ Acesso via `unknown`, e NÃO via `any`: a regra
 * `@typescript-eslint/no-explicit-any` não está configurada neste projeto, então
 * `eslint-disable` para ela é ERRO de lint e **reprova o `npm run build`** — com
 * `tsc` limpo e vitest verde. Custou um build nesta sessão.
 */
function opcoesInternas(p: FootprintPrimitive): { mostrarLegenda?: boolean } {
  return (p as unknown as { options: { mostrarLegenda?: boolean } }).options;
}

describe('FootprintPrimitive — mostrarLegenda', () => {
  it('a opção AUSENTE não altera o padrão declarado no tipo', () => {
    // Contrato: ausência ⇒ desenha. Aqui se afirma que a construção não inverte
    // o padrão; o desenho em si é exercitado pela suíte do footprint.
    const p = new FootprintPrimitive(opcoes());
      expect(opcoesInternas(p).mostrarLegenda).toBeUndefined();
  });

  it('`false` é preservado na construção', () => {
    const p = new FootprintPrimitive(opcoes({ mostrarLegenda: false }));
      expect(opcoesInternas(p).mostrarLegenda).toBe(false);
  });

  it('`update` propaga a opção — o objeto inteiro é repassado pelo gráfico', () => {
    // ⚠️ Diferente do livro, cujo patch de `update` é montado campo a campo (e foi
    // onde o `marcaExec` ficou de fora por meses), o footprint recebe o objeto
    // completo. Este teste fixa esse contrato: se alguém passar a montar patch
    // parcial para o footprint, a supressão para de chegar e o teste acusa.
    const p = new FootprintPrimitive(opcoes());
    p.update(opcoes({ mostrarLegenda: false }));
      expect(opcoesInternas(p).mostrarLegenda).toBe(false);
    p.update(opcoes({ mostrarLegenda: true }));
      expect(opcoesInternas(p).mostrarLegenda).toBe(true);
  });

  it('sem velas, nenhuma forma é emitida em qualquer dos modos', () => {
    for (const mostrar of [undefined, true, false]) {
      const p = new FootprintPrimitive(
        opcoes({ velas: [], mostrarLegenda: mostrar }),
      );
      expect(formasDo(p)).toHaveLength(0);
    }
  });
});
