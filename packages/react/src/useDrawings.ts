/**
 * useDrawings — liga as ferramentas de desenho a um `ChartEngine`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE A LIGACAO MORA AQUI, E NAO NO MOTOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor NAO importa `@robustus/charts-drawings`, de proposito: se importasse,
 * toda aplicacao pagaria o peso do subsistema de desenho — o modelo, a geometria,
 * o hit-test, o historico, a persistencia — mesmo sem oferecer desenho ao usuario.
 *
 * O motor expoe o que o desenho precisa (`api`, `priceSeries`, `container`) e o
 * acoplamento fica neste arquivo, que e opcional por natureza: quem nao importa
 * este hook nao carrega o pacote.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ORDEM DE MONTAGEM IMPORTA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A camada e anexada ANTES de o controlador existir, e o controlador e descartado
 * ANTES de a camada ser desanexada. Invertendo, o controlador poderia receber um
 * `pointerup` e tentar atualizar uma camada ja desanexada — que e inocuo hoje
 * (`update` tem `try`), e seria uma falha silenciosa se algum dia deixasse de ser.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChartEngine } from '@robustus/charts-engine';
import {
  DrawingController,
  DrawingsPrimitive,
  type ActiveTool,
  type Drawing,
  type DrawingStyle,
  type DrawingsState,
  type InteractionState,
  type SnapBar,
} from '@robustus/charts-drawings';

/** O que o hook recebe. */
export interface UseDrawingsParams {
  /** O motor. `null` antes da montagem — o hook espera. */
  readonly engine: ChartEngine | null;
  /** Desenhos iniciais. Lidos UMA vez, na montagem. */
  readonly initialDrawings?: readonly Drawing[];
  /** Estilo dos desenhos novos. */
  readonly defaultStyle?: DrawingStyle;
  /** Barras para o ima, em ordem crescente de tempo. */
  readonly bars?: () => readonly SnapBar[];
  /** O ima esta ativo? Consultado a cada movimento. */
  readonly snapEnabled?: () => boolean;
  /** Notificado a cada mudanca — use para persistir. */
  readonly onChange?: (state: DrawingsState) => void;
}

/** O que o hook devolve. */
export interface UseDrawingsResult {
  /** O controlador, ou `null` antes da montagem. */
  readonly controller: DrawingController | null;
  /** A colecao corrente, para renderizar lista lateral. */
  readonly drawings: readonly Drawing[];
  /** Ids selecionados. */
  readonly selectedIds: readonly string[];
  /** O gesto em curso. */
  readonly interaction: InteractionState;
  /** A ferramenta ativa. `null` = modo de selecao. */
  readonly tool: ActiveTool;
  /** Troca a ferramenta. */
  readonly setTool: (t: ActiveTool) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly deleteSelected: () => void;
  /** Substitui tudo, zerando o historico. Para carregar documento salvo. */
  readonly load: (drawings: readonly Drawing[]) => void;
}

/**
 * Monta camada e controlador de desenho sobre um motor.
 *
 * @example
 * const { containerRef, engine } = useChartEngine({ candles });
 * const desenho = useDrawings({
 *   engine,
 *   bars: () => velas,
 *   snapEnabled: () => shiftPressionado,
 *   onChange: (s) => salvar(s.drawings),
 * });
 *
 * <button onClick={() => desenho.setTool('TRENDLINE')}>Linha</button>
 * <button onClick={desenho.undo} disabled={!desenho.canUndo}>Desfazer</button>
 */
export function useDrawings(params: UseDrawingsParams): UseDrawingsResult {
  const { engine } = params;

  const [controller, setController] = useState<DrawingController | null>(null);
  const [drawings, setDrawings] = useState<readonly Drawing[]>(params.initialDrawings ?? []);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [interaction, setInteraction] = useState<InteractionState>({ kind: 'IDLE' });
  const [tool, setToolState] = useState<ActiveTool>(null);
  const [historyTick, setHistoryTick] = useState(0);

  // Callbacks e conjuntos vao para refs para NAO entrarem como dependencia: uma
  // funcao literal em JSX tem identidade nova a cada render, e como dependencia
  // recriaria o controlador — e recriar no meio de um arrasto perderia o gesto.
  const barsRef = useRef(params.bars);
  const snapRef = useRef(params.snapEnabled);
  const onChangeRef = useRef(params.onChange);
  const styleRef = useRef(params.defaultStyle);
  const initialRef = useRef(params.initialDrawings);

  barsRef.current = params.bars;
  snapRef.current = params.snapEnabled;
  onChangeRef.current = params.onChange;

  useEffect(() => {
    if (engine === null || engine.isDisposed) return;

    const camada = new DrawingsPrimitive({ drawings: initialRef.current ?? [] });
    engine.priceSeries.attachPrimitive(camada);

    const ctrl = new DrawingController({
      chart: engine.api,
      series: engine.priceSeries,
      container: engine.container,
      layer: camada,
      ...(styleRef.current === undefined ? {} : { defaultStyle: styleRef.current }),
      bars: () => barsRef.current?.() ?? [],
      snapEnabled: () => snapRef.current?.() ?? false,
      onChange: (estado, gesto) => {
        setDrawings(estado.drawings);
        setSelectedIds(estado.selectedIds);
        setInteraction(gesto);
        // `canUndo`/`canRedo` vivem no store, que nao emite evento. Este contador
        // forca a releitura sem duplicar o estado do historico no React — duas
        // fontes de verdade sobre o historico divergiriam.
        setHistoryTick((n) => n + 1);
        onChangeRef.current?.(estado);
      },
    });

    if (initialRef.current !== undefined && initialRef.current.length > 0) {
      ctrl.load(initialRef.current);
    }

    setController(ctrl);

    return () => {
      // Controlador PRIMEIRO: ver a nota de ordem no cabecalho.
      ctrl.dispose();
      try {
        engine.priceSeries.detachPrimitive(camada);
      } catch {
        // Serie ja descartada com o motor.
      }
      setController(null);
    };
  }, [engine]);

  const store = controller?.drawingsStore();
  // `historyTick` entra na expressao de proposito: e ele que dispara a releitura
  // do store depois de cada mudanca.
  void historyTick;

  return {
    controller,
    drawings,
    selectedIds,
    interaction,
    tool,
    setTool: (t) => {
      setToolState(t);
      controller?.setTool(t);
    },
    canUndo: store?.canUndo() ?? false,
    canRedo: store?.canRedo() ?? false,
    undo: () => controller?.undo(),
    redo: () => controller?.redo(),
    deleteSelected: () => controller?.deleteSelected(),
    load: (ds) => controller?.load(ds),
  };
}
