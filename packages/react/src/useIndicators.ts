/**
 * useIndicators — liga indicadores a um `ChartEngine` no ciclo do React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONDE A COSTURA ACONTECE, E POR QUE AQUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `engine` sabe desenhar mas nao conhece indicador; `indicators` sabe calcular
 * mas nao conhece canvas. O `IndicatorPlotter` (no engine) e a ponte por
 * estrutura, e este hook e quem tem os DOIS pacotes e os injeta um no outro — do
 * mesmo jeito que `useDrawings` liga o desenho. Manter a costura no React (e nao
 * no engine) e o que impede `engine` de depender de `indicators`: quem nao usa
 * indicador nao carrega o pacote.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOIS EFEITOS SEPARADOS, PELA MESMA RAZAO DE SEMPRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O CONJUNTO de indicadores (adicionar RSI, remover EMA) e as BARRAS (nova vela)
 * mudam em ritmos diferentes: conjunto por acao do usuario, barras por tick.
 * `setPlots` recria series e panes; `updateData` so recalcula. Um efeito para
 * cada — fundir recriaria pane a cada tick e o sub-painel piscaria.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  IndicatorPlotter,
  type ChartEngine,
  type IndicatorPlot,
  type PlottableBar,
} from '@robustus/charts-engine';

/** O que o hook recebe. */
export interface UseIndicatorsParams {
  /** O motor. `null` antes da montagem. */
  readonly engine: ChartEngine | null;
  /** Os indicadores a plotar. Mudar a identidade recria as series. */
  readonly plots: readonly IndicatorPlot[];
  /** As barras. Mudar recalcula os indicadores. */
  readonly bars: readonly PlottableBar[];
}

/**
 * Monta indicadores sobre um motor.
 *
 * @example
 * const { engine } = useChartEngine({ candles });
 * useIndicators({
 *   engine,
 *   plots: [
 *     { id: 'ema20', instance: emaFactory.create({ period: 20 }) },
 *     { id: 'rsi', instance: rsiFactory.create({ period: 14 }) },
 *   ],
 *   bars: candles,
 * });
 */
export function useIndicators(params: UseIndicatorsParams): void {
  const { engine, plots, bars } = params;
  const plotterRef = useRef<IndicatorPlotter | null>(null);

  // ── Cria o plotter quando o motor existe; descarta ao trocar/desmontar ──
  useEffect(() => {
    if (engine === null || engine.isDisposed) return;
    const plotter = new IndicatorPlotter(engine.api);
    plotterRef.current = plotter;
    return () => {
      try {
        plotter.clear();
      } catch {
        // Motor em descarte.
      }
      plotterRef.current = null;
    };
  }, [engine]);

  // ── Conjunto de indicadores: recria series/panes. Depende da identidade ──
  //
  // `plots` e as `bars` correntes entram juntos porque criar a serie ja precisa
  // dos dados para a primeira pintura. `barsRef` evita que uma mudanca de barra
  // dispare este efeito (que recriaria pane).
  const barsRef = useRef(bars);
  barsRef.current = bars;

  useEffect(() => {
    const plotter = plotterRef.current;
    if (plotter === null) return;
    plotter.setPlots(plots, barsRef.current as readonly PlottableBar[]);
    // `engine` na dependencia garante recriacao quando o motor troca (o plotter
    // novo comeca vazio e precisa receber os plots).
  }, [plots, engine]);

  // ── Barras: so recalcula. Nao mexe em pane ──
  useEffect(() => {
    const plotter = plotterRef.current;
    if (plotter === null) return;
    plotter.updateData(bars as readonly PlottableBar[]);
  }, [bars]);
}

/**
 * Conveniencia: memoiza uma lista de plots a partir de pares (id, instancia).
 *
 * Existe porque `useIndicators` recria series quando a IDENTIDADE de `plots`
 * muda; um array literal no corpo do componente teria identidade nova a cada
 * render e recriaria tudo a cada quadro. Este helper estabiliza a referencia
 * enquanto os ids e as instancias forem os mesmos.
 */
export function useIndicatorPlots(
  entradas: readonly IndicatorPlot[],
  deps: readonly unknown[],
): readonly IndicatorPlot[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => entradas, deps);
}
