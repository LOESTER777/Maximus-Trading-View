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

export { useDrawings } from './useDrawings.js';
export type { UseDrawingsParams, UseDrawingsResult } from './useDrawings.js';

export { useIndicators, useIndicatorPlots } from './useIndicators.js';
export type { UseIndicatorsParams } from './useIndicators.js';

// ── Caixa de ferramentas de indicadores ───────────────────────────────────────
//
// ⚠️ O `registry` e INJETADO pelo consumidor (`import { registry } from
// '@robustus/charts-indicators'`). Este pacote NAO depende do pacote de
// indicadores de proposito — ver o cabecalho de `useIndicatorCatalog.ts`.
export {
  useIndicatorCatalog,
  nextIndicatorId,
  paramsWithDefaults,
  paneKindOf,
  plotsSignature,
  CATEGORY_LABELS,
} from './useIndicatorCatalog.js';
export type {
  UseIndicatorCatalogParams,
  UseIndicatorCatalogResult,
  ActiveIndicator,
  ActiveIndicatorInit,
  CatalogEntry,
  CatalogGroup,
  CatalogFactory,
  CatalogInstance,
  CatalogMeta,
  CatalogOutputSpec,
  CatalogParamSpec,
  CatalogParamValue,
  CatalogParams,
  CatalogValidation,
  CatalogLoadResult,
  IndicatorPaneKind,
  ParamUpdateResult,
} from './useIndicatorCatalog.js';

export { IndicatorToolbox } from './IndicatorToolbox.js';
export type { IndicatorToolboxProps } from './IndicatorToolbox.js';

export { useAlerts } from './useAlerts.js';
export type {
  UseAlertsParams,
  UseAlertsResult,
  AlertBar,
  AlertSpec,
} from './useAlerts.js';

export { useReplay } from './useReplay.js';
export type { UseReplayParams, UseReplayResult } from './useReplay.js';

export { useCrosshair } from './useCrosshair.js';
export type { UseCrosshairParams, CrosshairReadout } from './useCrosshair.js';

export { useChartState } from './useChartState.js';
export type { UseChartStateResult, CaptureInput } from './useChartState.js';

export { RobustusChart } from './RobustusChart.js';
export type { RobustusChartProps } from './RobustusChart.js';

// ═══════════════════════════════════════════════════════════════════════════
// Cromo de interface — a caixa de ferramentas, as barras e a paleta
// ═══════════════════════════════════════════════════════════════════════════
//
// ⭐ Sao pecas de BIBLIOTECA, nao do playground: qualquer projeto do usuario monta
// a mesma interface sem reescrever barra, tooltip nem busca. Zero terceiros —
// icone e SVG proprio, busca e nucleo puro, animacao e transicao CSS.
//
// A divisao responde ao pedido de "separar o que e grafico do que e e para que":
//   `DrawingToolbar`  — barra VERTICAL: o que DESENHA sobre o preco
//   `ChartToolbar`    — barra HORIZONTAL: como o preco e desenhado + camadas +
//                       ambiente + acoes, cada um um grupo nomeado
//   `CommandPalette`  — TODO recurso por busca (Ctrl+K), para a tela nao virar
//                       parede de botao
//   `CollapsiblePanel`— mostrar/ocultar sem esconder que ha algo ali (badge)
//   `Tooltip`         — nome + PARA QUE + atalho, no hover E no foco
//   `ChartLegend`     — O/H/L/C sob o cursor, sobre o grafico

export { Icon, ICON_NAMES } from './icons.js';
export type { IconName, IconProps } from './icons.js';

export { Tooltip } from './Tooltip.js';
export type { TooltipProps, TooltipPlacement } from './Tooltip.js';

export { DrawingToolbar } from './DrawingToolbar.js';
export type { DrawingToolbarProps } from './DrawingToolbar.js';

export { SegmentedControl, useChromeStyles, joinClasses } from './SegmentedControl.js';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl.js';

export {
  ChartToolbar,
  CHART_TOOLBAR_GROUP_LABELS,
  CHART_TYPE_OPTIONS,
} from './ChartToolbar.js';
export type {
  ChartToolbarProps,
  ChartTypeId,
  ToolbarToggleItem,
  ToolbarActionItem,
} from './ChartToolbar.js';

export { CollapsiblePanel } from './CollapsiblePanel.js';
export type { CollapsiblePanelProps } from './CollapsiblePanel.js';

export { CommandPalette, useCommandPaletteHotkey, rankCommands } from './CommandPalette.js';
export type {
  Command,
  CommandPaletteProps,
  RankedCommand,
  RankedGroup,
} from './CommandPalette.js';

export { fuzzyMatch, fuzzyRank, foldChar } from './fuzzy.core.js';
export type { FuzzyMatch } from './fuzzy.core.js';

export { ChartLegend } from './ChartLegend.js';
export type { ChartLegendProps, ChartLegendSeries } from './ChartLegend.js';

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
