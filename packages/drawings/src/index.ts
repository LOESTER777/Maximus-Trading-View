/**
 * @robustus/charts-drawings — ferramentas de desenho do usuario.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE PACOTE E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Linha de tendencia, raio, reta, horizontal, vertical, retangulo, retracao de
 * Fibonacci e regua — com criacao por arrasto, selecao, edicao por alca, ima ao
 * OHLC, desfazer/refazer e persistencia versionada.
 *
 * E o subsistema que faltava para a biblioteca substituir um provedor de grafico
 * de terceiro. As camadas de fluxo (bookmap, footprint) sao passivas por desenho;
 * desenho do usuario e o oposto — existe para ser manipulado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS TRES ARMADILHAS QUE ESTE PACOTE RESOLVE, E QUE VALE CONHECER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Desenho que desaparece ao trocar de periodo.**
 * `timeToCoordinate` do substrato devolve `null` quando o instante nao e uma barra
 * da escala corrente. Uma linha tracada em M5 tem ancora em instante que nao
 * existe em H1, e a implementacao ingenua conclui "fora de vista". A conversao
 * correta passa por `timeToIndex(t, findNearest)` + `logicalToCoordinate`, com
 * interpolacao da fracao da barra. Ver `chart-converters.ts`.
 *
 * **2. Arrastar a alca move o desenho inteiro.**
 * A alca fica DENTRO da regiao e SOBRE o traco. Sem prioridade de acerto, o empate
 * por distancia entrega a regiao, e redimensionar torna-se impossivel. As alcas
 * reportam prioridade 2, traco 1, regiao 0 — e o substrato resolve. Ver
 * `hit-test.core.ts`.
 *
 * **3. O grafico rola por baixo do desenho.**
 * O substrato usa arrasto com botao pressionado para dar pan, e nao expoe evento de
 * arrasto proprio. O controlador desliga `handleScroll.pressedMouseMove` ao
 * iniciar o gesto e religa ao terminar, com captura de ponteiro para o `pointerup`
 * nao se perder fora do container. Ver `DrawingController.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * VELOCIDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato chama `hitTest` a cada movimento do cursor. O que torna isso barato:
 *
 *  - **plano de tela em cache**, invalidado por epoca de viewport — o hit-test nao
 *    converte coordenada, le pixel pronto;
 *  - **prefiltro por caixa envolvente** antes de qualquer distancia exata;
 *  - **agrupamento por estilo** na pintura, uma troca de estado de canvas por grupo;
 *  - **coalescencia por quadro** do `pointermove`.
 *
 * Sobre indice espacial: NAO ha quadtree, de proposito. Para N na ordem de
 * centenas, o prefiltro AABB em array plano custa microssegundos, e a arvore
 * traria reconstrucao a cada pan com perda de localidade de cache — mais lenta E
 * mais complexa. O ganho de ordem de grandeza esta em nao converter coordenada
 * durante o movimento, e nao na estrutura de indice. Ver `geometry.core.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MONTAGEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```ts
 * const camada = new DrawingsPrimitive({ drawings: [] });
 * serie.attachPrimitive(camada);
 *
 * const ctrl = new DrawingController({
 *   chart, series, container, layer: camada,
 *   bars: () => velasParaIma,
 *   snapEnabled: () => shiftPressionado,
 *   onChange: (estado) => setDesenhos(estado.drawings),
 * });
 *
 * ctrl.setTool('TRENDLINE');  // proximo arrasto cria
 * ctrl.setTool(null);         // volta ao modo de selecao
 *
 * // persistencia
 * localStorage.setItem(chave, JSON.stringify(serialize(ctrl.drawings(), 'WINV26')));
 * const { document, rejected } = deserialize(JSON.parse(texto));
 * ctrl.load(document.drawings);
 *
 * // desmonte
 * ctrl.dispose();
 * ```
 *
 * Atalhos que o controlador ja trata: `Esc` cancela e restaura, `Delete` remove a
 * selecao, `Ctrl/Cmd+Z` desfaz, `Ctrl/Cmd+Shift+Z` e `Ctrl/Cmd+Y` refazem. Todos
 * ignorados quando o foco esta num campo de texto.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Modelo
// ═════════════════════════════════════════════════════════════════════════════
export {
  ANCHORS_REQUIRED,
  FIB_LEVELS_DEFAULT,
  // ⭐ Ferramentas novas: os niveis default da EXTENSAO de Fibonacci e o multiplo de risco
  // das ferramentas de POSICAO.
  FIB_EXTENSION_LEVELS_DEFAULT,
  R_MULTIPLE_DEFAULT,
  rMultipleOf,
  createDefaultIdFactory,
  createDrawing,
  fibLevelsOf,
  isComplete,
  isInteractive,
  isValidAnchor,
  isVisible,
  withAnchor,
  withAppendedAnchor,
  withHidden,
  withLocked,
  withStyle,
  withTranslation,
} from './model.js';

export type {
  Anchor,
  CreateDrawingParams,
  Drawing,
  DrawingKind,
  DrawingLineStyle,
  DrawingStyle,
  IdFactory,
} from './model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Geometria
// ═════════════════════════════════════════════════════════════════════════════
export {
  HANDLE_HIT_RADIUS_PX,
  HANDLE_RADIUS_PX,
  HIT_TOLERANCE_PX,
  boxOfPoints,
  boxesIntersect,
  distanceToHorizontal,
  distanceToLine,
  distanceToRay,
  distanceToRectOutline,
  distanceToSegment,
  distanceToVertical,
  extendLineToBox,
  isInsideBox,
  lerp,
  segmentIntersectsBox,
  viewportBox,
} from './geometry.core.js';

export type { Box, Point } from './geometry.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Projecao
// ═════════════════════════════════════════════════════════════════════════════
export {
  DEFAULT_COLOR,
  MAX_DRAWINGS_DEFAULT,
  buildRenderPlan,
  resolveStyle,
  sameEpoch,
} from './render-plan.core.js';

export type {
  FibLine,
  LogicalToScreen,
  RenderPlan,
  ResolvedStyle,
  ScreenDrawing,
  Stroke,
  ViewportEpoch,
} from './render-plan.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Hit test
// ═════════════════════════════════════════════════════════════════════════════
export { HIT_PRIORITY, cursorFor, hitCandidates, hitTest, idsInBox } from './hit-test.core.js';
export type { Hit, HitPart } from './hit-test.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Ima
// ═════════════════════════════════════════════════════════════════════════════
export { SNAP_RADIUS_PX, barsNear, snapAnchor } from './snap.core.js';
export type { SnapBar, SnapParams, SnapResult, SnapTarget } from './snap.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Colecao e historico
// ═════════════════════════════════════════════════════════════════════════════
export {
  EMPTY_STATE,
  HISTORY_LIMIT_DEFAULT,
  DrawingsStore,
  addDrawing,
  addToSelection,
  clearSelection,
  removeDrawings,
  replaceDrawing,
  selectOnly,
} from './store.core.js';

export type { DrawingsState } from './store.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Persistencia
// ═════════════════════════════════════════════════════════════════════════════
export { DRAWINGS_SCHEMA_VERSION, deserialize, serialize } from './serialize.core.js';
export type { DeserializeResult, DrawingsDocument } from './serialize.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Conversores do grafico
// ═════════════════════════════════════════════════════════════════════════════
export { createChartConverters, readEpoch, timeToX, xToTime, yToPrice } from './chart-converters.js';

// ═════════════════════════════════════════════════════════════════════════════
// Camada e controlador
// ═════════════════════════════════════════════════════════════════════════════
export { DrawingsPrimitive } from './DrawingsPrimitive.js';
export type { DrawingsLayerOptions } from './DrawingsPrimitive.js';

export { DrawingController } from './DrawingController.js';
export type {
  ActiveTool,
  DrawingControllerOptions,
  InteractionState,
} from './DrawingController.js';

// ═════════════════════════════════════════════════════════════════════════════
// Apelidos em ingles
// ═════════════════════════════════════════════════════════════════════════════
export { DrawingsPrimitive as DrawingsLayer } from './DrawingsPrimitive.js';
