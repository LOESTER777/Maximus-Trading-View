/**
 * ChartProvider — o motor num CONTEXTO, para parar de passá-lo de mão em mão.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todos os hooks desta biblioteca recebem `engine` por parâmetro. Numa tela pequena isso é
 * bom: explícito e testável. Numa tela real, o motor nasce num componente e é usado em
 * cinco: a barra de ferramentas exporta PNG, a legenda lê o crosshair, o painel lateral
 * plota indicadores, o rodapé mostra o replay. Passar `engine` por prop até cada um deles
 * é o *prop drilling* clássico — e o custo não é digitar: é que **todo componente no
 * caminho passa a re-renderizar** quando o motor aparece, incluindo os que não o usam.
 *
 * Com o provedor, quem precisa do motor pede (`useChart()`), e quem não precisa não fica
 * sabendo que ele existe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O PROVEDOR RENDERIZA O CONTAINER — e isso é decisão, não conveniência
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor precisa de um elemento com ALTURA para medir. Se o provedor só fornecesse o
 * `containerRef`, todo consumidor teria de montar a `<div>` e lembrar da altura — e altura
 * zero produz gráfico invisível **sem erro nenhum**, que é a armadilha número um da
 * biblioteca. O provedor monta o container e um invólucro `position: relative`, que é o que
 * as sobreposições (`ChartLegend`) exigem para ancorar.
 *
 * Os `children` são renderizados SOBRE o gráfico, no mesmo invólucro. É o que faz
 * `<ChartProvider><ChartLegend/></ChartProvider>` funcionar sem o consumidor saber de
 * `position`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ OS HOOKS NÃO MUDARAM — e continuam aceitando `engine` explícito
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `useIndicators`, `useDrawings`, `useAlerts` e companhia continuam recebendo `engine` por
 * parâmetro. Fazê-los ler o contexto por padrão seria pior:
 *
 *  - **duas fontes de motor** no mesmo hook (parâmetro e contexto), com regra de precedência
 *    para o consumidor decorar;
 *  - **hook que só funciona dentro do provedor**, quebrando o uso avulso que os testes
 *    desta biblioteca e as telas simples fazem;
 *  - **duas telas com dois gráficos** (a comparação de períodos) ficariam ambíguas — qual
 *    contexto é o de cada hook?
 *
 * O padrão é `const { engine } = useChart()` e passar adiante. Uma linha por componente que
 * usa o motor, e nenhuma para quem não usa.
 */
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ChartEngine } from '@robustus/charts-engine';
import { useChartEngine, type UseChartEngineParams } from './useChartEngine.js';

/** O que o contexto oferece. */
export interface ChartContextValue {
  /**
   * O motor, ou `null` antes da montagem.
   *
   * ⚠️ `null` no PRIMEIRO render é normal e não é erro: o motor nasce num efeito, depois de
   * o container existir no DOM. Todo consumidor tem de tolerar — é a mesma disciplina de
   * `useChartEngine`, e é por isso que o tipo não mente dizendo que é sempre `ChartEngine`.
   */
  readonly engine: ChartEngine | null;
  /**
   * Um identificador do painel, útil quando há vários gráficos na tela.
   *
   * Vem de `ChartProviderProps.id`. É o que um componente descendente usa para se registrar
   * no `useChartSync` sem o consumidor ter de repassar a chave por prop.
   */
  readonly id: string;
}

/**
 * ⚠️ O default é `undefined`, e não um valor "vazio", de propósito: é o que permite
 * `useChart` DISTINGUIR "estou fora do provedor" de "o motor ainda não nasceu". Um default
 * `{ engine: null }` faria o uso fora do provedor parecer "carregando", para sempre.
 */
const ChartContext = createContext<ChartContextValue | undefined>(undefined);

export interface ChartProviderProps extends UseChartEngineParams {
  /** Identificador do painel. Default `'chart'`. Ver `ChartContextValue.id`. */
  readonly id?: string;
  /** Sobreposições e controles que precisam do motor. Renderizados SOBRE o gráfico. */
  readonly children?: ReactNode;
  /** Altura CSS do invólucro. Default `'100%'`. Ver a nota sobre altura zero. */
  readonly height?: string;
  /** Largura CSS. Default `'100%'`. */
  readonly width?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Rótulo acessível da região do gráfico. */
  readonly ariaLabel?: string;
}

/**
 * Cria o motor e o oferece à árvore.
 *
 * @example
 * <ChartProvider candles={velas} options={{ withVolume: true }}>
 *   <ChartLegend readout={ohlc} symbol="WINV26" period="5m" />
 *   <MinhaBarra />        // usa `useChart()` por dentro
 * </ChartProvider>
 */
export function ChartProvider({
  id = 'chart',
  children,
  height = '100%',
  width = '100%',
  className,
  style,
  ariaLabel = 'Gráfico de mercado',
  ...params
}: ChartProviderProps): JSX.Element {
  const { containerRef, engine } = useChartEngine(params);

  // ⚠️ Memoizado por (engine, id): o valor de contexto muda quando o motor nasce, e NÃO a
  // cada render do provedor. Um objeto literal aqui re-renderizaria todo consumidor do
  // contexto a cada quadro do pai — o oposto do que o provedor existe para fazer.
  const valor = useMemo<ChartContextValue>(() => ({ engine, id }), [engine, id]);

  return (
    <ChartContext.Provider value={valor}>
      <div
        className={className}
        // `position: relative` é requisito das sobreposições (a `ChartLegend` ancora aqui).
        // `minHeight/minWidth: 0` deixam o invólucro ENCOLHER dentro de um pai flex/grid, em
        // vez de estourá-lo.
        style={{ position: 'relative', height, width, minHeight: 0, minWidth: 0, ...style }}
      >
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
          /*
           * O gráfico é canvas, portanto opaco para leitor de tela. `role="img"` com rótulo
           * é o mínimo honesto — e NÃO torna o gráfico acessível: dado de série temporal
           * precisa de alternativa textual equivalente, que depende do que se está plotando
           * e por isso não pode ser gerada aqui.
           */
          role="img"
          aria-label={ariaLabel}
        />
        {children}
      </div>
    </ChartContext.Provider>
  );
}

/**
 * Lê o motor do contexto.
 *
 * ⚠️ **Lança fora do provedor**, e isso é deliberado. As outras camadas desta biblioteca
 * tratam falha como valor de retorno, mas aqui não há "falha de dado" a modelar: usar
 * `useChart` fora de um `ChartProvider` é **erro de montagem do programador**, e sempre. Um
 * `null` silencioso viraria um gráfico que não faz nada, e o programador procuraria o
 * defeito no dado. Quem quer tolerar a ausência usa `useChartOptional`.
 */
export function useChart(): ChartContextValue {
  const v = useContext(ChartContext);
  if (v === undefined) {
    throw new Error(
      '`useChart` foi chamado fora de um `<ChartProvider>`. ' +
        'Envolva a árvore no provedor, ou use `useChartOptional` se a ausência for esperada.',
    );
  }
  return v;
}

/**
 * O mesmo, tolerante: `null` fora do provedor.
 *
 * Existe para componente que serve nos dois modos — dentro do provedor pega o motor sozinho,
 * fora recebe por prop. É o caso de uma barra de ferramentas que a biblioteca publica e o
 * consumidor pode usar solta.
 */
export function useChartOptional(): ChartContextValue | null {
  return useContext(ChartContext) ?? null;
}
