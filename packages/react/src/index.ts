/**
 * @robustus/charts-react — ligacao React.
 *
 * O motor nao sabe que React existe; este pacote e o unico que sabe. E fino de
 * proposito: todo comportamento difícil mora em `@robustus/charts-engine`, onde e
 * testavel sem montar componente.
 *
 * ```tsx
 * import { RobustusChart } from '@robustus/charts-react';
 *
 * <RobustusChart
 *   options={{ withVolume: true }}
 *   candles={velas}
 *   bookmap={grid ? { grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: 5 } : null}
 *   resetViewportOn={periodo}
 *   height="520px"
 * />
 * ```
 *
 * ⚠️ **Nao use `key={periodo}`** para trocar de periodo. `key` destroi e remonta,
 * e foi o que produzia `Object is disposed` na origem. Use `resetViewportOn`.
 *
 * ⚠️ **Memoize os conjuntos** (`candles`, `priceLines`, ...) ou passe referencia
 * estavel. Array literal em JSX tem identidade nova a cada render, e cada efeito
 * deste pacote depende da identidade — sem memoizacao, tudo e reaplicado a cada
 * render do pai.
 */

export { useChartEngine } from './useChartEngine.js';
export type { UseChartEngineParams, UseChartEngineResult } from './useChartEngine.js';

export { RobustusChart } from './RobustusChart.js';
export type { RobustusChartProps } from './RobustusChart.js';

// Reexporta o vocabulario para o consumidor nao precisar instalar o pacote do
// motor so para tipar as props.
export type {
  ChartCandle,
  ChartHistogramBar,
  ChartPriceLine,
  ChartLineSeries,
  ChartMarker,
  ChartCoordinateMapper,
  ChartEngineOptions,
  BookmapLayerInput,
  FootprintLayerInput,
} from '@robustus/charts-engine';

export { ChartEngine, isValidCandle } from '@robustus/charts-engine';
