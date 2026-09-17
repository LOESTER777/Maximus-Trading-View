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

// Historico ANTIGO sob demanda: pede o trecho anterior quando o operador arrasta para
// trás. A posicao da tela e preservada pelo MOTOR (`onBarsPrepended`), nao aqui — ver o
// cabecalho do arquivo.
export { useHistoryBackfill } from './useHistoryBackfill.js';
export type {
  BackfillBar,
  UseHistoryBackfillParams,
  UseHistoryBackfillResult,
} from './useHistoryBackfill.js';

export { useCrosshair } from './useCrosshair.js';
export type { UseCrosshairParams, CrosshairReadout } from './useCrosshair.js';

export { useChartState } from './useChartState.js';
export type { UseChartStateResult, CaptureInput } from './useChartState.js';

// ⭐ O motor num CONTEXTO: acaba com o `engine` passado de mao em mao pela arvore. Os hooks
// NAO mudaram — continuam recebendo `engine` explicito; o padrao e
// `const { engine } = useChart()` e passar adiante. Ver o cabecalho do arquivo para o porque
// de nao ler o contexto por dentro dos hooks.
export { ChartProvider, useChart, useChartOptional } from './ChartProvider.js';
export type { ChartProviderProps, ChartContextValue } from './ChartProvider.js';

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

// ⭐ VARIOS graficos na tela: abas (um ativo por vez), grade (varios ao mesmo tempo) e a
// sincronia entre eles. A sincronia viaja por TEMPO, nunca por indice logico — ver o
// cabecalho de `useChartSync`.
export { SymbolTabs } from './SymbolTabs.js';
export type { SymbolTabsProps, SymbolTab } from './SymbolTabs.js';

export { ChartGrid, chartGridSlots } from './ChartGrid.js';
export type { ChartGridProps, ChartGridLayout } from './ChartGrid.js';

export { useChartSync } from './useChartSync.js';
export type { UseChartSyncParams, UseChartSyncResult, ChartSyncOptions } from './useChartSync.js';

// ⭐ Selecao de PERIODO. A lista e INJETADA (`TIMEFRAMES` de
// `@robustus/charts-datafeed`): este pacote nao importa a camada de dado, pela mesma
// regra do registry de indicadores.
export { TimeframeSelector } from './TimeframeSelector.js';
export type { TimeframeSelectorProps, TimeframeOption } from './TimeframeSelector.js';

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
  VolumeProfileLayerInput,
} from '@robustus/charts-engine';

export { ChartEngine, isValidCandle } from '@robustus/charts-engine';

// ⭐ A trilha de legendas das camadas de canvas — ver `useLayerLegends.ts`.
export { useLayerLegends } from './useLayerLegends.js';

// ⭐ O painel de LEITURA do ativo (desempenho, sazonalidade, termometro) — ver `AssetReadout.tsx`.
export { AssetReadout } from './AssetReadout.js';
export type {
  AssetReadoutProps,
  DesempenhoDeJanela,
  AnoSazonal,
  TermometroLido,
} from './AssetReadout.js';

// ⭐ A arvore de OBJETOS do grafico (indicadores, desenhos, alertas) — ver `ObjectTree.tsx`.
export { ObjectTree } from './ObjectTree.js';
export type { ObjectTreeProps, ObjectTreeGroup, ObjectTreeItem } from './ObjectTree.js';

// ⭐ A janela visivel em TEMPO — insumo do "perfil da janela visivel". Ver `useVisibleTimeRange.ts`.
export { useVisibleTimeRange } from './useVisibleTimeRange.js';
export type { FaixaDeTempoVisivel, UseVisibleTimeRangeParams } from './useVisibleTimeRange.js';

// ⭐ O grafico DENTRO do grafico: correlacao em base 100. Ver `CorrelationInset.tsx` — e SVG e
// nao um segundo motor, porque o inset e leitura de RELACAO e nao um grafico operavel.
export { CorrelationInset } from './CorrelationInset.js';
export type { CorrelationInsetProps, SerieDoInset } from './CorrelationInset.js';
// ⭐⭐ ABAS por ativo, cada uma com o SEU documento de grafico. Ver `useSymbolWorkspace.ts`.
//
// ⚠️ Este hook e a costura; `SymbolTabs` e a aparencia; `chart-workspace.core.ts` (no engine)
// e a regra. Trocar de aba GRAVA a que sai antes de ativar a que entra — a ordem invertida
// grava o estado da aba nova no lugar do da antiga, e o operador perde o trabalho.
export { useSymbolWorkspace } from './useSymbolWorkspace.js';
export type {
  UseSymbolWorkspaceOptions,
  UseSymbolWorkspaceResult,
} from './useSymbolWorkspace.js';

// ⭐ A faixa de AUXILIO da ferramenta armada, sobre o grafico. Ver `ToolHelpStrip.tsx` — o texto
// vem do nucleo puro `ajudaDeFerramenta` (pacote de desenho), e a faixa nao captura ponteiro.
export { ToolHelpStrip } from './ToolHelpStrip.js';
export type { ToolHelpStripProps } from './ToolHelpStrip.js';
