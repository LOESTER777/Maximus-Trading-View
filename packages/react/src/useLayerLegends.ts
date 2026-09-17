/**
 * `useLayerLegends` — a TRILHA DE LEGENDAS no ciclo do React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO ENCERRA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"o bookmap ainda está em cima do histograma de volume, ele precisa ficar no topo
 * alinhado ao lado de quem está lá, pois pode haver outros componentes"*.
 *
 * As camadas de canvas (livro, footprint, perfil) escreviam texto cada uma no seu canto,
 * sem saber das outras nem da `ChartLegend` em HTML. Duas correções anteriores só
 * MUDARAM o canto da colisão. Agora cada camada PUBLICA as linhas, o motor as enfileira
 * (`legend-rail.core.ts`, ordem canônica de leitura) e este hook traz a fila para o
 * render — para a `ChartLegend` empilhar tudo num lugar só, alinhado.
 *
 * ⭐ O ganho não é só a colisão: quem lê a trilha em HTML ganha o que o canvas não dá —
 * texto selecionável, leitor de tela (`role="status"`), quebra de linha responsiva e
 * zoom do navegador. Legenda em canvas é imagem de texto; aqui é texto.
 *
 * @example
 * const notas = useLayerLegends(engine);
 * <ChartLegend readout={ohlc} symbol="WINFUT" notes={notas} />
 * // e nas camadas: mostrarLegenda: false — o canvas fica limpo.
 */
import { useEffect, useState } from 'react';
import type { ChartEngine } from '@robustus/charts-engine';
import type { LegendNote } from '@robustus/charts-core';

const VAZIO: readonly LegendNote[] = [];

export function useLayerLegends(engine: ChartEngine | null): readonly LegendNote[] {
  const [notas, setNotas] = useState<readonly LegendNote[]>(VAZIO);

  useEffect(() => {
    if (engine === null || engine.isDisposed) {
      // ⚠️ Zera ao perder o motor. Sem isto a trilha do gráfico ANTERIOR continuaria na
      // tela depois de trocar de ativo — texto afirmando um livro que não existe mais.
      setNotas(VAZIO);
      return;
    }
    // `subscribeLegend` já emite o estado corrente na assinatura, então não há janela em
    // que a trilha apareça vazia por ter assinado tarde.
    return engine.subscribeLegend(setNotas);
  }, [engine]);

  return notas;
}
