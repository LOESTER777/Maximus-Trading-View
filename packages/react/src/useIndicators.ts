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
import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  /**
   * Cores por plot -> chave de saida.
   *
   * ⭐ Canal SEPARADO de `plots` de proposito. Mudar cor aqui NAO recria serie nem
   * pane: vai por `IndicatorPlotter.applyColors`. Passar a cor dentro de `plots`
   * tambem funciona, mas ai a identidade de `plots` muda e `setPlots` destroi e
   * recria tudo — a tela pisca e a altura arrastada do sub-painel se perde.
   */
  readonly colors?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Visibilidade por plot. Ausente = visivel.
   *
   * ⭐ Mesmo motivo: esconder por aqui apaga o desenho, tira da autoescala, colapsa a
   * pane do oscilador e **para de calcular** o indicador — sem destruir a serie. O
   * caminho antigo (tirar o indicador da lista de `plots`) o destruia, e religar
   * recriava tudo.
   */
  readonly visibility?: Readonly<Record<string, boolean>>;
  /**
   * ⭐ ALTURA do sub-painel de cada indicador, como fracao da altura util do grafico.
   *
   * Atende o pedido *"reducao de altura da secao do histograma"*. Canal SEPARADO de
   * `plots` pela mesma razao de `colors` e `visibility`: mudar altura nao pode recriar
   * serie nem recalcular indicador — `setPlots` destroi e recria tudo, a tela pisca e a
   * pane perde o tamanho que o operador arrastou.
   *
   * Chave = `plot.id`. Indicador que plota sobre o PRECO nao tem pane propria e e
   * ignorado. Ausente = este consumidor nao controla altura por aqui.
   */
  readonly paneHeights?: Readonly<Record<string, number>>;
  /**
   * ⭐⭐ Quantas COLUNAS de sub-painel por linha. `1` = empilhado. `'auto'` deriva da largura.
   *
   * Atende *"um modo de visualizacao um abaixo do outro ou um ao lado do outro e podermos
   * configurar a quantidade de colunas por linha"*. Com quatro osciladores empilhados o preco
   * perde quase metade da tela; em duas colunas eles ocupam duas faixas em vez de quatro.
   *
   * ⚠️ Canal SEPARADO de `plots`, como `colors`, `visibility` e `paneHeights`: mudar o arranjo
   * nao pode recriar serie nem recalcular indicador. `setPlots` destroi e recria tudo, a tela
   * pisca e as panes perdem o tamanho que o operador arrastou.
   *
   * ⚠️ E uma propriedade do GRAFICO, nao de um indicador — por isso e um valor, e nao um mapa
   * por `plot.id`. Um arranjo por indicador nao existe: a linha e compartilhada.
   *
   * Ausente = este consumidor nao controla o arranjo (o motor fica no default, empilhado).
   */
  readonly paneColumns?: number | 'auto';
  /**
   * ⭐ Chamado quando o operador CLICA num indicador dentro do gráfico.
   *
   * Recebe o `id` do plot e a chave da saída clicada (`'value'`, `'%D'`, ...). É o que
   * liga "cliquei nesta linha" a "abra as propriedades DELA".
   *
   * ⚠️ Ausente = o hook **não assina** o clique do motor. Não é economia de código: sem
   * este callback, assinar faria o hook consumir o evento de clique num gráfico que
   * talvez use o clique para desenhar (a ferramenta de linha de tendência começa num
   * clique). Recurso opcional não pode custar comportamento a quem não o usa.
   *
   * ⚠️ Clique FORA de qualquer indicador não chama nada — nem com `plotId` nulo. Quem
   * quer saber de todos os cliques assina `subscribeClick` no motor direto; aqui o
   * evento é "clicou num indicador", e um callback que dispara em qualquer lugar da tela
   * obrigaria o consumidor a filtrar o que o hook já sabe.
   */
  readonly onIndicatorClick?: (plotId: string, outputKey: string | null) => void;
  /** Raio de acerto do clique, em px. Default 6 — ver `IChartApi.seriesAt`. */
  readonly clickTolerancePx?: number;
}

/** O que o hook devolve. */
export interface UseIndicatorsResult {
  /**
   * As cores EFETIVAS de um plot, inclusive as escolhidas pela paleta automatica.
   *
   * ⭐ E o que fecha a persistencia da aparencia: indicador adicionado sem cor recebe
   * uma da paleta POR ORDEM DE INSERCAO, e essa cor nao existe em lugar nenhum do
   * estado do React. Salvar o layout sem consultar isto guardaria "sem cor", e na
   * sessao seguinte a ordem seria outra (o operador removeu um indicador do meio) e o
   * mesmo indicador voltaria com cor diferente sem ninguem ter mudado nada.
   *
   * Devolve `{}` antes da montagem ou para plot desconhecido.
   */
  readonly effectiveColors: (plotId: string) => Readonly<Record<string, string>>;
  /**
   * Qual indicador está sob um ponto da tela (px lógico, relativo ao canvas)?
   *
   * Exposto além do `onIndicatorClick` para quem quer outro gesto: destacar a linha no
   * `hover`, abrir menu de contexto no botão direito, mostrar cursor de "mão".
   */
  readonly indicatorAt: (point: {
    readonly x: number;
    readonly y: number;
  }) => { readonly plotId: string; readonly outputKey: string | null } | null;
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
export function useIndicators(params: UseIndicatorsParams): UseIndicatorsResult {
  const {
    engine,
    plots,
    bars,
    colors,
    visibility,
    paneHeights,
    paneColumns,
    onIndicatorClick,
    clickTolerancePx,
  } =
    params;
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

  // ── Visibilidade: nem recria, nem recalcula ──
  //
  // ⚠️ Roda ANTES do efeito de cor e DEPOIS do de conjunto (ordem de declaracao, que e
  // a ordem de execucao no React). Vem antes da cor porque repintar uma serie que sera
  // escondida no mesmo commit e trabalho jogado fora; e depois do conjunto porque
  // colapsar pane exige que a pane exista.
  useEffect(() => {
    const plotter = plotterRef.current;
    // ⚠️ `visibility` ausente NAO significa "tudo visivel" — significa "este consumidor
    // nao controla visibilidade por aqui". Tratar como "tudo visivel" reacenderia um
    // plot marcado `visible: false` na propria lista de `plots`, contradizendo o que o
    // consumidor pediu.
    if (plotter === null || visibility === undefined) return;
    for (const plot of plots) {
      const desejado = visibility[plot.id] ?? plot.visible ?? true;
      // Compara antes de aplicar: `setVisible` de "visivel para visivel" dispararia o
      // recalculo do plot sem necessidade a cada mudanca de QUALQUER indicador.
      if (plotter.isVisible(plot.id) !== desejado) plotter.setVisible(plot.id, desejado);
    }
  }, [plots, visibility, engine]);

  // ── Altura das panes: nem recria, nem recalcula ──
  //
  // ⚠️ Depois do efeito de conjunto, pela mesma razao da visibilidade: definir altura exige
  // que a pane exista. E compara antes de aplicar, senao cada mudanca de QUALQUER indicador
  // remediria o layout inteiro.
  useEffect(() => {
    const plotter = plotterRef.current;
    if (plotter === null || paneHeights === undefined) return;
    for (const plot of plots) {
      const desejada = paneHeights[plot.id];
      const atual = plotter.paneHeightOf(plot.id);
      if (desejada === undefined) {
        // ⚠️ Chave AUSENTE devolve a pane a reparticao automatica em vez de deixar a altura
        // velha: sem isto, remover a chave do estado nao teria efeito nenhum e o operador
        // veria a interface discordar da tela.
        if (atual !== null) plotter.setPaneHeight(plot.id, null);
        continue;
      }
      if (atual !== desejada) plotter.setPaneHeight(plot.id, desejada);
    }
  }, [plots, paneHeights, engine]);

  // ── ⭐⭐ O ARRANJO das panes de sub-painel: empilhado ou em grade ──
  //
  // ⚠️ Fala DIRETO com o motor (`engine.api`), e nao pelo plotter: o arranjo e do grafico e
  // vale para toda pane, inclusive as que outro consumidor tenha criado. Passar pelo plotter
  // sugeriria que a grade e dos indicadores dele.
  //
  // ⚠️ Depois dos efeitos de conjunto e de altura, pela mesma razao: o arranjo e calculado
  // sobre as panes que EXISTEM e as fracoes que elas tem.
  useEffect(() => {
    if (engine === null || paneColumns === undefined) return;
    try {
      engine.api.setPaneGridColumns(paneColumns);
    } catch {
      // Motor sem o metodo (versao anterior do chart-core) ou em descarte: no-op. O arranjo
      // fica no default empilhado, que e o comportamento historico — degradar para "como era"
      // e melhor que derrubar a montagem por um recurso de layout.
    }
  }, [engine, paneColumns, plots]);

  // ── Cores: nem recria, nem recalcula ──
  useEffect(() => {
    const plotter = plotterRef.current;
    if (plotter === null || colors === undefined) return;
    for (const [plotId, chaves] of Object.entries(colors)) {
      plotter.applyColors(plotId, chaves);
    }
  }, [colors, plots, engine]);

  // ── Barras: so recalcula. Nao mexe em pane ──
  useEffect(() => {
    const plotter = plotterRef.current;
    if (plotter === null) return;
    plotter.updateData(bars as readonly PlottableBar[]);
  }, [bars]);

  const effectiveColors = useCallback(
    (plotId: string): Readonly<Record<string, string>> =>
      plotterRef.current?.colorsOf(plotId) ?? {},
    [],
  );

  // ── Qual indicador está sob um ponto ──────────────────────────────────────
  //
  // ⭐ Duas metades: o MOTOR resolve a geometria (`seriesAt` devolve a série desenhada
  // sob o pixel) e o PLOTTER resolve a identidade (`plotIdOfSeries` traduz a série para o
  // id do indicador). Nenhum dos dois faz o outro lado: o motor não sabe o que é
  // indicador, e a interface não tem coordenadas.
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const tolRef = useRef(clickTolerancePx);
  tolRef.current = clickTolerancePx;

  const indicatorAt = useCallback(
    (point: { readonly x: number; readonly y: number }) => {
      const motor = engineRef.current;
      const plotter = plotterRef.current;
      if (motor === null || motor.isDisposed || plotter === null) return null;
      const serie = motor.api.seriesAt(point, tolRef.current);
      if (serie === null) return null;
      const plotId = plotter.plotIdOfSeries(serie);
      if (plotId === null) return null;
      return { plotId, outputKey: plotter.outputKeyOfSeries(serie) };
    },
    [],
  );

  // ── Clique no indicador ───────────────────────────────────────────────────
  const onClickRef = useRef(onIndicatorClick);
  onClickRef.current = onIndicatorClick;

  useEffect(() => {
    // ⚠️ Sem callback, NÃO assina. Ver a nota em `onIndicatorClick`: assinar por padrão
    // faria este hook interferir num gráfico que usa o clique para desenhar.
    if (engine === null || engine.isDisposed || onIndicatorClick === undefined) return;

    const handler = (param: { point?: { x: number; y: number } }): void => {
      const p = param.point;
      if (p === undefined) return;
      const achado = indicatorAt(p);
      // Clique fora de indicador não chama nada — ver a nota do campo.
      if (achado === null) return;
      onClickRef.current?.(achado.plotId, achado.outputKey);
    };

    engine.api.subscribeClick(handler);
    return () => {
      try {
        engine.api.unsubscribeClick(handler);
      } catch {
        // Motor em descarte: o ouvinte morre com ele.
      }
    };
    // `onIndicatorClick` entra na dependência só como PRESENÇA (ligado/desligado): a
    // identidade da função vive no ref, então trocar a closure não reassina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, onIndicatorClick === undefined, indicatorAt]);

  return { effectiveColors, indicatorAt };
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
