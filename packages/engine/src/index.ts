/**
 * @robustus/charts-engine — o motor de grafico, sem framework.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O UNICO PACOTE QUE IMPORTA O SUBSTRATO EM RUNTIME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `core` e puro. `primitives` importa `lightweight-charts` so por tipo. `datafeed`
 * nao o conhece. Este pacote e a fronteira: e aqui que `createChart` e chamado.
 *
 * A consequencia pratica e que uma eventual troca de substrato mexe neste
 * arquivo e no `chart-engine.ts` — nao nas 2.700 linhas de desenho do bookmap,
 * nem nos 14 nucleos puros, nem em nenhuma tela do consumidor. Foi para isso que
 * o vocabulario proprio de `types.ts` existe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```ts
 * const motor = ChartEngine.create(container, { withVolume: true });
 *
 * motor.setCandles(velas);
 * motor.setPriceLines([{ price: 130_000, color: '#e9c46a', title: 'Alvo' }]);
 * motor.setBookmapLayer({ grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: 5 });
 *
 * // Sobreposicoes em HTML/SVG alinhadas ao eixo real:
 * const parar = motor.onCoordinateMapperChange((m) => {
 *   const y = m.priceToY(130_000);          // null = fora de vista
 *   const folga = m.priceScaleWidthPx();    // ancora da borda direita util
 * });
 *
 * // Troca de periodo: reenquadre, NAO recrie.
 * motor.setCandles(outroPeriodo);
 * motor.resetViewport();
 *
 * parar();
 * motor.dispose();
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE O MOTOR AINDA NAO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vale dizer, porque e o que separa isto de um substituto completo:
 *
 * **Nao ha ferramenta de desenho do usuario.** Sem linha de tendencia, regua nem
 * Fibonacci desenhado a mao. Fibonacci existe na origem, mas CALCULADO pelo
 * backend e entregue como `ChartLineSeries` — nao tracado pelo operador. Desenho
 * interativo precisa de acerto de ponteiro, alca de arrasto e estado de selecao,
 * e as camadas de canvas desta biblioteca deliberadamente NAO tem `hitTest` (ha
 * property test que falha se aparecer). Portanto e subsistema novo, nao extensao.
 *
 * **Nao ha sub-painel (`pane`) de verdade.** `ChartLineSeries.priceScaleId` cria
 * escala de OVERLAY no mesmo painel, que e como a origem desenha delta cumulativo.
 * Para RSI ou MACD numa faixa propria embaixo do preco, o substrato v5 tem panes
 * nativos — nunca usados na origem, e ainda nao expostos aqui.
 *
 * **Nao ha persistencia de layout.** Nem template nomeado, nem sincronizacao com
 * servidor.
 */

export { ChartEngine } from './chart-engine.js';
export type { ChartEngineOptions } from './chart-engine.js';

export {
  isValidCandle,
  BOOKMAP_MAX_CELLS_DEFAULT,
  BOOKMAP_MIN_CELL_PX_DEFAULT,
} from './types.js';

export type {
  ChartCandle,
  ChartHistogramBar,
  ChartPriceLine,
  ChartLineSeries,
  ChartMarker,
  ChartCoordinateMapper,
  BookmapLayerInput,
  FootprintLayerInput,
} from './types.js';
