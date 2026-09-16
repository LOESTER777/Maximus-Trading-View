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

/**
 * ⚠️ `tempo` é epoch **ms** — o nome e a unidade do tipo real. O parâmetro se
 * chamava `tempoSec` e alimentava um campo `tempoSec` que `VelaFootprint` não
 * tem; passava porque os casos deste arquivo só contavam formas. O caso do aviso
 * de vela estreita mede a LARGURA da vela, que é medida a partir de `tempo`, e com
 * o campo errado a largura caía no valor de reserva (40 px) e o aviso nunca
 * disparava.
 */
function velaFootprint(tempo = 1_788_000_000_000): VelaFootprint {
  return {
    tempo,
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

// ═════════════════════════════════════════════════════════════════════════════
// Gráfico falso — o mínimo para o aviso de "Footprint oculto" ser exercitado
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Os casos acima constroem o primitive SEM anexá-lo, então `recalcular` sai
// cedo e nenhuma forma é emitida — o que basta para medir a opção guardada, e não
// basta para medir o AVISO. Este dublê existe para o aviso: duas velas com 6 px de
// distância deixam a vela abaixo do mínimo legível (18 px) e disparam o caminho.

const LARGURA_PAINEL = 800;
const ALTURA_PAINEL = 400;

/** Distância entre velas, em px. Abaixo de `LARGURA_MINIMA_VELA_PX` (18). */
const ESPACO_ESTREITO_PX = 6;

function anexarComVelaEstreita(p: FootprintPrimitive): void {
  const timeScale = {
    getVisibleRange: () => ({ from: 0, to: 1 }),
    timeToCoordinate: (segundos: unknown): number => Number(segundos) * ESPACO_ESTREITO_PX,
  };
  const chart = {
    paneSize: () => ({ width: LARGURA_PAINEL, height: ALTURA_PAINEL }),
    timeScale: () => timeScale,
  };
  const series = {
    priceToCoordinate: (preco: number): number => 400 - (preco - 188_000),
    coordinateToPrice: (y: number): number => 188_000 + (400 - y),
  };
  p.attached({ chart, series, requestUpdate: () => {} } as unknown as Parameters<
    FootprintPrimitive['attached']
  >[0]);
}

/** Duas velas em segundos consecutivos: 6 px de distância na escala falsa. */
function duasVelas(): readonly VelaFootprint[] {
  return [velaFootprint(1_788_000_000_000), velaFootprint(1_788_000_001_000)];
}

describe('FootprintPrimitive — o aviso de vela estreita respeita a supressão', () => {
  it('guarda de vacuidade: com vela estreita o aviso É emitido por omissão', () => {
    const p = new FootprintPrimitive(opcoes({ velas: duasVelas() }));
    anexarComVelaEstreita(p);

    const formas = formasDo(p) as readonly { papel?: string; texto?: string; y?: number }[];
    expect(formas).toHaveLength(1);
    expect(formas[0]?.texto ?? '').toContain('Footprint oculto');
  });

  it('⭐ `mostrarLegenda: false` cala também o aviso', () => {
    // ⚠️ Era o defeito: o aviso saía de qualquer forma, e como ele dispara com a
    // vela estreita — o estado normal de um gráfico com dois pregões na tela —
    // era o texto que MAIS aparecia para quem tinha pedido silêncio.
    const p = new FootprintPrimitive(opcoes({ velas: duasVelas(), mostrarLegenda: false }));
    anexarComVelaEstreita(p);

    expect(formasDo(p)).toHaveLength(0);
  });

  it('⭐ o aviso fica no PÉ do painel, não no topo onde mora a legenda do livro', () => {
    // No topo à esquerda ele caía exatamente sobre a legenda do `BookmapPrimitive`,
    // e com as duas camadas ligadas os dois textos se sobrepunham.
    const p = new FootprintPrimitive(opcoes({ velas: duasVelas() }));
    anexarComVelaEstreita(p);

    const forma = (formasDo(p) as readonly { papel?: string; y?: number }[])[0];
    expect(forma?.y ?? 0).toBeGreaterThan(ALTURA_PAINEL / 2);
    // `papel: 'legenda'` é o que faz o renderizador desenhar a caixa de contraste.
    expect(forma?.papel).toBe('legenda');
  });
});

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
