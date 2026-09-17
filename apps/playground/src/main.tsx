/**
 * Playground — a montagem de referencia da biblioteca, com a interface completa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ANATOMIA DA TELA, E POR QUE ELA E ASSIM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ┌──────────────────────────────────────────────────────┬──────────┐
 *   │ ChartToolbar (HORIZONTAL) — desenho · camadas ·      │          │
 *   │   ambiente · acoes            [Ctrl+K comandos]      │          │
 *   ├───┬──────────────────────────────────────────────────┤ painéis  │
 *   │ D │ ChartLegend (O/H/L/C sob o cursor)               │ colapsá- │
 *   │ r │                                                  │ veis:    │
 *   │ a │                  o GRAFICO                       │ · indica-│
 *   │ w │                                                  │   dores  │
 *   │ i │                                                  │ · alertas│
 *   │ n │                                                  │ · replay │
 *   │ g │                                                  │          │
 *   └───┴──────────────────────────────────────────────────┴──────────┘
 *
 * ⭐ **A separacao e por PROPOSITO, nao por tipo de controle.** Foi o pedido:
 * "separacao do que e grafico e do que e e para que".
 *
 *  - **Barra VERTICAL (esquerda):** o que o operador DESENHA. Fica junto do
 *    gráfico porque a mao vai da ferramenta ao traco sem atravessar a tela.
 *  - **Barra HORIZONTAL (topo):** como o preco e DESENHADO (escolha unica),
 *    o que e SOBREPOSTO a ele, o AMBIENTE (cenario, nao dado) e as ACOES
 *    pontuais. Quatro grupos nomeados, com separador entre eles.
 *  - **Paineis colapsaveis (direita):** o que se CONFIGURA e se le. Cada um fecha
 *    e continua dizendo o que carrega, pelo badge.
 *  - **Paleta de comandos (Ctrl+K):** TODO o resto. E o que permite ter 29
 *    indicadores e dezenas de opcoes sem encher a tela de botao.
 *
 * ⚠️ Este arquivo e CONSUMIDOR da biblioteca, nao parte dela. Toda peca de
 * interface aqui vem de `@robustus/charts-react` — se algo tiver de ser
 * reescrito por projeto, e sinal de que a peca esta no lugar errado.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { agregarPerfilDeVolume, decodeColumnar } from '@robustus/charts-core';
// ⭐ O vocabulário de PERÍODO vive no datafeed (junto de `periodSeconds` e da agregação);
// o componente de seleção vive no pacote React e recebe a lista por prop. É o consumidor
// — este app — que une os dois.
import {
  TIMEFRAMES,
  rollupBars,
  timeframesAgregaveisDe,
  timeframePorId,
  type Timeframe,
} from '@robustus/charts-datafeed';
import { heikinAshi, renko, brickSizeAutomatico } from '@robustus/chart-core';
import {
  useChartEngine,
  useDrawings,
  useIndicators,
  useIndicatorCatalog,
  IndicatorToolbox,
  TimeframeSelector,
  SymbolTabs,
  ChartGrid,
  useChartSync,
  ChartProvider,
  useChart,
  useAlerts,
  useReplay,
  useHistoryBackfill,
  useCrosshair,
  useChartState,
  // ── Cromo de interface ──
  Icon,
  Tooltip,
  DrawingToolbar,
  ChartToolbar,
  CHART_TYPE_OPTIONS,
  CollapsiblePanel,
  CommandPalette,
  useCommandPaletteHotkey,
  ChartLegend,
  type Command,
  type ToolbarToggleItem,
  type ToolbarActionItem,
} from '@robustus/charts-react';
import type { SnapBar } from '@robustus/charts-drawings';
import type { ChartEngine, PriceSeriesType, ChartPriceLine } from '@robustus/charts-engine';
import { registry } from '@robustus/charts-indicators';
import type { AlertSpec } from '@robustus/charts-react';
import {
  makeOlderCandles,
  makeSyntheticBundle,
  type SyntheticBundle,
  type SyntheticCandle,
} from './synthetic.js';

/**
 * O modo de grafico.
 *
 * ⚠️ Os ids vem de `CHART_TYPE_OPTIONS` da biblioteca. Os quatro primeiros sao
 * `SeriesType` do motor; `HeikinAshi` e `Renko` NAO sao — sao transformacao de
 * DADO plotada como vela. A traducao mora em `serieDoModo`.
 */
type ModoGrafico = 'Candlestick' | 'Bar' | 'Line' | 'Area' | 'HeikinAshi' | 'Renko';

/** O `SeriesType` que o motor deve usar para cada modo. */
function serieDoModo(modo: ModoGrafico): PriceSeriesType {
  if (modo === 'Line') return 'Line';
  if (modo === 'Area') return 'Area';
  if (modo === 'Bar') return 'Bar';
  // Vela, Heikin-Ashi e Renko: todos plotam como Candlestick. A forma vem do dado.
  return 'Candlestick';
}

const VELOCIDADES = [1, 2, 4, 8, 16] as const;

/** Indicadores de partida. A caixa de ferramentas alcanca os 29 do registry. */
const INDICADORES_INICIAIS = [
  { name: 'ema', params: { period: 20 }, colors: { value: '#e9c46a' } },
  { name: 'rsi', params: { period: 14 } },
] as const;

function App(): JSX.Element {
  const bundle = useMemo(() => makeSyntheticBundle(240, 300, 42), []);
  const grid = useMemo(() => decodeColumnar(bundle.depth), [bundle]);

  // ── Estado de interface ───────────────────────────────────────────────────
  const [modo, setModo] = useState<ModoGrafico>('Candlestick');
  /**
   * Período corrente.
   *
   * ⚠️ O dado sintético nasce em M5 (`makeSyntheticBundle(240, 300, ...)`), então M5 é a
   * BASE: só os múltiplos inteiros dela são oferecidos. Oferecer M1 e mostrar tela vazia
   * seria pior que não oferecer — ver `timeframesAgregaveisDe`.
   */
  const [tfId, setTfId] = useState('M5');
  /**
   * Período do painel de COMPARAÇÃO, e se ele está na tela.
   *
   * ⚠️ O playground tem um ativo só (dado sintético), então a comparação aqui é
   * multi-PERÍODO: o mesmo ativo em M5 e H1 lado a lado, sincronizados. Com dois ativos
   * de verdade, a mesma montagem serve para correlação — o que muda é a fonte de dado.
   */
  const [comparar, setComparar] = useState(false);
  const [tfComparacao, setTfComparacao] = useState('H1');
  /** Ativo corrente. Uma aba só até o playground ganhar segunda fonte de dado. */
  const [ativo, setAtivo] = useState('SINTETICO');
  const [mostrarBookmap, setMostrarBookmap] = useState(true);
  const [mostrarPerfil, setMostrarPerfil] = useState(false);
  const [imaLigado, setImaLigado] = useState(false);
  const [gradeVertical, setGradeVertical] = useState(false);
  const [marcaDagua, setMarcaDagua] = useState(true);
  const [alertasLigados, setAlertasLigados] = useState(true);
  const [modoReplay, setModoReplay] = useState(false);
  const [barraRecolhida, setBarraRecolhida] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [tick, setTick] = useState(0);
  /** Indicador clicado no gráfico, com nonce para reabrir no clique repetido. */
  const [indicadorClicado, setIndicadorClicado] = useState<{ id: string; nonce: number } | null>(
    null,
  );

  // Ctrl+K abre a paleta, de qualquer lugar da pagina.
  useCommandPaletteHotkey(() => setPaletaAberta(true));

  // ── Caixa de ferramentas de indicadores ───────────────────────────────────
  const indicadores = useIndicatorCatalog({ registry, initial: INDICADORES_INICIAIS });

  // ── Período (timeframe) ────────────────────────────────────────────────────
  //
  // ⭐ O dado base é M5; períodos maiores saem por AGREGAÇÃO (`rollupBars`), que é o
  // mesmo caminho de um provedor real que só entrega o período mínimo.
  const TF_BASE = useMemo(() => timeframePorId('M5') as Timeframe, []);
  const tfsDisponiveis = useMemo(() => timeframesAgregaveisDe(TF_BASE), [TF_BASE]);
  const tf = useMemo(() => timeframePorId(tfId) ?? TF_BASE, [tfId, TF_BASE]);

  // ── Perfil de volume (histograma por LINHA) ────────────────────────────────
  //
  // ⚠️ Agregado AQUI, não na camada. É o consumidor que decide o escopo: este playground
  // usa o dia inteiro do grid. Para "perfil da janela visível", reagregue com
  // `{ janela: { tsDe, tsAte } }` quando a janela mudar.
  const perfil = useMemo(
    () => (mostrarPerfil && grid !== null ? agregarPerfilDeVolume(grid) : null),
    [mostrarPerfil, grid],
  );

  // ── Histórico carregado sob demanda (backfill) ─────────────────────────────
  //
  // ⭐ O que o `useHistoryBackfill` observa é a janela; quem guarda o dado é o
  // consumidor — aqui, este estado. Arrastar para trás até a borda faz o hook pedir, e
  // o `loadOlder` abaixo faz o papel do provedor (dado sintético, sem backend).
  const [historico, setHistorico] = useState<SyntheticCandle[]>([]);
  const [volumeHistorico, setVolumeHistorico] = useState<SyntheticBundle['volume']>([]);

  // ── Replay ────────────────────────────────────────────────────────────────
  const replay = useReplay({ bars: bundle.candles, speed: 4 });
  const velasComHistorico = useMemo(
    () => (historico.length === 0 ? bundle.candles : [...historico, ...bundle.candles]),
    [historico, bundle.candles],
  );
  const velasCruas = modoReplay ? replay.revealedBars : velasComHistorico;

  // ── Agregação para o período escolhido ─────────────────────────────────────
  //
  // ⚠️ `rollupBars` trabalha com `Bar` do datafeed (que tem `volume` opcional); as velas
  // sintéticas são OHLC sem volume, e isso basta — a agregação preserva OHLC pela
  // definição clássica e simplesmente não soma volume que não existe.
  //
  // ⚠️ Período IGUAL à base passa direto, sem reamostrar: `rollupBars(x, 300, 300)` é
  // identidade, mas pagar uma varredura para não mudar nada é desperdício no caminho mais
  // comum.
  const velasBase = useMemo(() => {
    if (tf.seconds === TF_BASE.seconds) return velasCruas;
    const agregadas = rollupBars(velasCruas, TF_BASE.seconds, tf.seconds);
    // ⚠️ Agregação vazia (período não múltiplo, dado insuficiente) DEGRADA para as velas
    // cruas em vez de esvaziar a tela. Tela vazia sem explicação é o defeito que este
    // projeto já pagou várias vezes.
    return agregadas.length === 0 ? velasCruas : (agregadas as typeof velasCruas);
  }, [velasCruas, tf, TF_BASE]);

  // ── Forma das velas ───────────────────────────────────────────────────────
  const velasExibidas = useMemo(() => {
    if (modo === 'HeikinAshi') return heikinAshi(velasBase);
    if (modo === 'Renko') {
      const brick = brickSizeAutomatico(velasBase);
      // `null` = sem dado para derivar tijolo. Degrada para as velas cruas.
      return brick === null ? velasBase : renko(velasBase, brick);
    }
    return velasBase;
  }, [modo, velasBase]);

  // ── Volume por COLUNA, no mesmo período das velas ───────────────────────────
  //
  // ⚠️ Sem isto o histograma ficaria no período BASE enquanto as velas subiam de período:
  // 12 barrinhas de volume por vela de 1 h, desalinhadas do eixo. Agregar o volume junto é
  // requisito, não refinamento.
  const volumeExibido = useMemo(() => {
    const cru = modoReplay
      ? bundle.volume.slice(0, velasCruas.length)
      : volumeHistorico.length === 0
        ? bundle.volume
        : [...volumeHistorico, ...bundle.volume];
    if (tf.seconds === TF_BASE.seconds) return cru;

    // Soma por balde do período alvo. A COR vem da vela agregada (alta/baixa), não da
    // última barrinha do balde — a cor tem de concordar com a vela que está em cima dela.
    const somaPorBalde = new Map<number, number>();
    for (const v of cru) {
      const balde = Math.floor(v.time / tf.seconds) * tf.seconds;
      somaPorBalde.set(balde, (somaPorBalde.get(balde) ?? 0) + v.value);
    }
    const velaPorTempo = new Map(velasBase.map((c) => [c.time, c]));
    return [...somaPorBalde.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => {
        const vela = velaPorTempo.get(time);
        const alta = vela === undefined ? true : vela.close >= vela.open;
        return { time, value, color: alta ? '#16c784' : '#ea3943' };
      });
  }, [modoReplay, bundle.volume, velasCruas.length, volumeHistorico, tf, TF_BASE, velasBase]);

  const barsSnap = useMemo<SnapBar[]>(
    () =>
      velasExibidas.map((c) => ({
        timeSec: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [velasExibidas],
  );
  const barsRef = useRef<SnapBar[]>(barsSnap);
  barsRef.current = barsSnap;

  const { containerRef, engine } = useChartEngine({
    // ⭐ Animação LIGADA aqui de propósito: o playground existe para ver a
    // biblioteca funcionando, e a transição de "Reenquadrar" é onde ela aparece.
    // O default da biblioteca é DESLIGADO — ver `ChartOptions.animation`.
    options: { withVolume: true, animation: { enabled: true } },
    candles: velasExibidas,
    volume: volumeExibido,
    // ⭐ Perfil de volume: o histograma por LINHA, em faixa própria à direita.
    // `margemInferiorFracao: 0.15` é a SEPARAÇÃO DE AMBIENTES — é onde o histograma
    // por COLUNA (volume por barra) começa, e os dois deixam de compartilhar pixel.
    volumeProfile: perfil === null ? null : { perfil, larguraFracao: 0.16, margemInferiorFracao: 0.15 },
    bookmap:
      mostrarBookmap && grid !== null
        ? {
            grid,
            metrica: 'AMBAS',
            escala: 'P99_GAMMA',
            tickSize: bundle.tickSize,
            modoCor: 'TERMICA',
            // ⭐ Legenda do bookmap no canto de BAIXO: o de cima é da `ChartLegend`
            // (O/H/L/C). As duas ali era o "bookmap sobrepondo componente no topo
            // esquerdo" — ver `posicaoLegenda` na primitive.
            posicaoLegenda: 'inferior-esquerda',
          }
        : null,
  });

  // Tipo de serie no motor. Preserva a viewport — nao e salto de camera.
  useEffect(() => {
    if (engine === null) return;
    engine.setPriceSeriesType(serieDoModo(modo));
  }, [engine, modo]);

  // ── Backfill: arrastar para trás carrega mais passado ──────────────────────
  //
  // ⚠️ Teto de 3 lotes (360 velas) de propósito: é o que faz o `exhausted` acontecer
  // no playground e provar que a trava de fim de histórico funciona. Um provedor real
  // simplesmente devolve zero quando não há mais dado.
  const LOTE = 120;
  const TETO_HISTORICO = 360;
  const backfill = useHistoryBackfill({
    engine,
    bars: velasComHistorico,
    // Replay é dado sintético revelado aos poucos; buscar passado ali não faz sentido.
    enabled: !modoReplay,
    loadOlder: (antesDe) => {
      if (historico.length >= TETO_HISTORICO) return 0;
      const chegada = velasComHistorico[0]?.open ?? 130_000;
      const { candles, volume } = makeOlderCandles(antesDe, LOTE, 300, chegada);
      setHistorico((atual) => [...candles, ...atual]);
      setVolumeHistorico((atual) => [...volume, ...atual]);
      return candles.length;
    },
  });

  // ── Sincronia entre painéis (multi-período na mesma tela) ──────────────────
  //
  // ⭐ A janela viaja por TEMPO: 60 barras de M5 (5 h) viram 5 barras de H1. Copiar a
  // janela lógica poria os dois em instantes diferentes — ver `useChartSync`.
  const sync = useChartSync({ onCrosshair: () => undefined });
  useEffect(() => sync.register('principal', engine), [sync, engine]);

  // As velas do painel de comparação, no período dele.
  const tfComp = useMemo(() => timeframePorId(tfComparacao) ?? TF_BASE, [tfComparacao, TF_BASE]);
  const velasComparacao = useMemo(() => {
    if (!comparar) return [];
    if (tfComp.seconds === TF_BASE.seconds) return velasCruas;
    const r = rollupBars(velasCruas, TF_BASE.seconds, tfComp.seconds);
    return r.length === 0 ? velasCruas : (r as typeof velasCruas);
  }, [comparar, velasCruas, tfComp, TF_BASE]);

  const desenho = useDrawings({
    engine,
    bars: () => barsRef.current,
    snapEnabled: () => imaLigado,
    onChange: () => setTick((n) => n + 1),
  });

  // ⭐ `colors` e `visibility` entram como canal SEPARADO de `plots`: mudar cor ou
  // esconder um indicador altera a serie viva (repinta / colapsa a pane) em vez de
  // recriar tudo. Passar essas duas coisas dentro de `plots` faria a tela piscar e a
  // pane do oscilador perder a altura arrastada.
  //
  // ⭐ `onIndicatorClick`: clicar na linha de um indicador NO GRÁFICO abre as
  // propriedades dele na caixa de ferramentas. O `nonce` faz o segundo clique na mesma
  // linha reabrir o painel se o operador o tiver fechado.
  useIndicators({
    engine,
    plots: indicadores.plots,
    bars: velasExibidas,
    colors: indicadores.colors,
    visibility: indicadores.visibility,
    onIndicatorClick: (plotId) =>
      setIndicadorClicado((atual) => ({ id: plotId, nonce: (atual?.nonce ?? 0) + 1 })),
  });

  const ohlc = useCrosshair({ engine });
  const { capture, restore } = useChartState();

  // ── Alertas ───────────────────────────────────────────────────────────────
  const niveis = useMemo(() => {
    const closes = bundle.candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    return { acima: min + (max - min) * 0.66, abaixo: min + (max - min) * 0.33 };
  }, [bundle]);

  const alertSpecs = useMemo<AlertSpec[]>(
    () =>
      alertasLigados
        ? [
            { key: 'cross-acima', condition: { kind: 'CROSS_ABOVE', level: niveis.acima }, options: { mode: 'recurring' } },
            { key: 'cross-abaixo', condition: { kind: 'CROSS_BELOW', level: niveis.abaixo }, options: { mode: 'recurring' } },
          ]
        : [],
    [alertasLigados, niveis],
  );

  const alertas = useAlerts({ bars: velasBase, alerts: alertSpecs });

  const linhasAlerta = useMemo<ChartPriceLine[]>(
    () =>
      alertasLigados
        ? [
            { price: niveis.acima, color: '#16c784', title: 'Alerta ↑', lineStyle: 2 },
            { price: niveis.abaixo, color: '#ea3943', title: 'Alerta ↓', lineStyle: 2 },
          ]
        : [],
    [alertasLigados, niveis],
  );

  // ── Ambiente do motor ─────────────────────────────────────────────────────
  useEffect(() => {
    if (engine === null) return;
    engine.api.applyOptions({
      grid: {
        vertLines: { visible: gradeVertical, color: 'rgba(148,163,184,0.07)' },
        horzLines: { visible: true, color: 'rgba(148,163,184,0.10)' },
      },
      watermark: marcaDagua ? { text: 'SINTÉTICO', fontSize: 64 } : { text: '', visible: false },
      rightPriceScale: {
        scaleMargins: { top: 0.08, bottom: 0.2 },
        priceFormat: { tickSize: bundle.tickSize },
      },
    });
  }, [engine, gradeVertical, marcaDagua, bundle.tickSize]);

  // ── Acoes ─────────────────────────────────────────────────────────────────
  const exportarPng = useCallback((): void => {
    if (engine === null) return;
    const url = engine.api.toDataURL('image/png');
    // `null` = sem rasterizacao. Baixar aqui daria arquivo quebrado.
    if (url === null) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `robustus-${Date.now()}.png`;
    a.click();
  }, [engine]);

  const salvarLayout = useCallback((): void => {
    const doc = capture({
      symbol: 'SINTETICO',
      priceSeriesType: serieDoModo(modo),
      indicators: indicadores.states,
      alerts: alertSpecs.map((s) => ({ key: s.key, condition: s.condition, mode: s.options?.mode })),
      drawings: desenho.drawings,
    });
    localStorage.setItem('robustus-layout', JSON.stringify(doc));
    setTick((n) => n + 1);
  }, [alertSpecs, capture, desenho.drawings, indicadores.states, modo]);

  const restaurarLayout = useCallback((): void => {
    const bruto = localStorage.getItem('robustus-layout');
    if (bruto === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bruto);
    } catch {
      return;
    }
    const { state } = restore(parsed);
    setModo(state.priceSeriesType as ModoGrafico);
    indicadores.load(state.indicators);
    desenho.load(state.drawings.drawings as never);
    setTick((n) => n + 1);
  }, [desenho, indicadores, restore]);

  // ── Grupos da barra horizontal ────────────────────────────────────────────
  //
  // ⭐ Camada e AMBIENTE sao grupos distintos de proposito: bookmap acrescenta
  // informacao de mercado, grade nao. Misturar os dois e o que produz parede de
  // botao sem significado.
  const camadas = useMemo<ToolbarToggleItem[]>(
    () => [
      {
        id: 'bookmap',
        label: 'Bookmap',
        icon: 'bookmap',
        active: mostrarBookmap,
        hint: 'Heatmap do livro por região de preço: onde há oferta parada.',
      },
      {
        id: 'perfil',
        label: 'Perfil',
        icon: 'volumeProfile',
        active: mostrarPerfil,
        hint: 'Histograma por LINHA: quanto negociou em cada preço, com POC e área de valor.',
      },
      {
        id: 'alertas',
        label: 'Alertas',
        icon: 'alert',
        active: alertasLigados,
        hint: 'Vigia níveis e avisa no cruzamento, sem repetir o aviso.',
      },
    ],
    [alertasLigados, mostrarBookmap, mostrarPerfil],
  );

  const ambiente = useMemo<ToolbarToggleItem[]>(
    () => [
      {
        id: 'grade',
        label: 'Grade',
        icon: 'grid',
        active: gradeVertical,
        hint: 'Linhas verticais nos instantes rotulados do eixo de tempo.',
      },
      {
        id: 'marca',
        label: "Marca d'água",
        icon: 'watermark',
        active: marcaDagua,
        hint: 'Identifica o painel ao fundo, atrás das velas.',
      },
      {
        id: 'ima',
        label: 'Ímã',
        icon: 'magnet',
        active: imaLigado,
        hint: 'Prende o desenho na máxima, mínima ou fechamento da barra.',
      },
    ],
    [gradeVertical, imaLigado, marcaDagua],
  );

  const acoes = useMemo<ToolbarActionItem[]>(
    () => [
      { id: 'png', label: 'Exportar PNG', icon: 'camera', hint: 'Salva o quadro atual como imagem.' },
      { id: 'salvar', label: 'Salvar layout', icon: 'save', hint: 'Grava tipo de gráfico, indicadores, alertas e desenhos.' },
      { id: 'restaurar', label: 'Restaurar layout', icon: 'restore', hint: 'Recarrega o último layout salvo.' },
    ],
    [],
  );

  const alternarCamada = useCallback((id: string): void => {
    if (id === 'bookmap') setMostrarBookmap((v) => !v);
    else if (id === 'perfil') setMostrarPerfil((v) => !v);
    else if (id === 'alertas') setAlertasLigados((v) => !v);
  }, []);

  const alternarAmbiente = useCallback((id: string): void => {
    if (id === 'grade') setGradeVertical((v) => !v);
    else if (id === 'marca') setMarcaDagua((v) => !v);
    else if (id === 'ima') setImaLigado((v) => !v);
  }, []);

  const executarAcao = useCallback(
    (id: string): void => {
      if (id === 'png') exportarPng();
      else if (id === 'salvar') salvarLayout();
      else if (id === 'restaurar') restaurarLayout();
    },
    [exportarPng, restaurarLayout, salvarLayout],
  );

  // ── Comandos da paleta ────────────────────────────────────────────────────
  //
  // ⭐ Aqui esta a resposta a "nao encher a tela de botoes": os 29 indicadores
  // entram na paleta por nome, com o "para que serve" no rodape. A barra visivel
  // fica so com o que se usa a toda hora.
  const comandos = useMemo<Command[]>(() => {
    const lista: Command[] = [];

    // Indicadores: um comando por entrada do registry.
    for (const entrada of indicadores.catalog) {
      lista.push({
        id: `ind:${entrada.name}`,
        label: entrada.label,
        group: 'Indicadores',
        icon: entrada.pane === 'separate' ? 'oscillator' : 'indicator',
        hint: `${entrada.categoryLabel} · plota ${
          entrada.pane === 'separate' ? 'em sub-painel' : entrada.pane === 'both' ? 'no preço e em sub-painel' : 'sobre o preço'
        }.`,
        keywords: [entrada.name, entrada.category],
        run: () => indicadores.add(entrada.name),
      });
    }

    // Modos de gráfico.
    for (const opcao of CHART_TYPE_OPTIONS) {
      lista.push({
        id: `modo:${String(opcao.value)}`,
        label: `Gráfico: ${opcao.label}`,
        group: 'Gráfico',
        icon: opcao.icon,
        hint: opcao.hint,
        keywords: [String(opcao.value)],
        run: () => setModo(String(opcao.value) as ModoGrafico),
      });
    }

    // Ferramentas de desenho.
    const ferramentas: ReadonlyArray<[string, string, Parameters<typeof desenho.setTool>[0]]> = [
      ['Selecionar', 'S', null],
      ['Linha de tendência', 'T', 'TRENDLINE'],
      ['Raio', 'R', 'RAY'],
      ['Reta estendida', 'E', 'EXTENDED_LINE'],
      ['Linha horizontal', 'H', 'HORIZONTAL_LINE'],
      ['Linha vertical', 'V', 'VERTICAL_LINE'],
      ['Retângulo', 'B', 'RECTANGLE'],
      ['Retração de Fibonacci', 'F', 'FIB_RETRACEMENT'],
      ['Régua', 'M', 'MEASURE'],
    ];
    for (const [rotulo, atalho, tool] of ferramentas) {
      lista.push({
        id: `tool:${rotulo}`,
        label: `Desenhar: ${rotulo}`,
        group: 'Desenho',
        icon: 'trendline',
        shortcut: atalho,
        hint: 'Ativa a ferramenta na barra lateral.',
        run: () => desenho.setTool(tool),
      });
    }

    // Ambiente e ações.
    lista.push(
      { id: 'env:grade', label: 'Alternar grade', group: 'Ambiente', icon: 'grid', run: () => setGradeVertical((v) => !v) },
      { id: 'env:marca', label: "Alternar marca d'água", group: 'Ambiente', icon: 'watermark', run: () => setMarcaDagua((v) => !v) },
      { id: 'env:ima', label: 'Alternar ímã', group: 'Ambiente', icon: 'magnet', shortcut: 'A', run: () => setImaLigado((v) => !v) },
      { id: 'env:bookmap', label: 'Alternar bookmap', group: 'Ambiente', icon: 'bookmap', run: () => setMostrarBookmap((v) => !v) },
      { id: 'env:perfil', label: 'Alternar perfil de volume', group: 'Ambiente', icon: 'volumeProfile', hint: 'Histograma por LINHA, na faixa lateral.', run: () => setMostrarPerfil((v) => !v) },
      { id: 'env:replay', label: 'Alternar replay', group: 'Ambiente', icon: 'replay', hint: 'Reproduz o pregão barra a barra.', run: () => setModoReplay((v) => !v) },
      { id: 'act:png', label: 'Exportar PNG', group: 'Ações', icon: 'camera', run: exportarPng },
      { id: 'act:salvar', label: 'Salvar layout', group: 'Ações', icon: 'save', run: salvarLayout },
      { id: 'act:restaurar', label: 'Restaurar layout', group: 'Ações', icon: 'restore', run: restaurarLayout },
      { id: 'act:limpar', label: 'Apagar desenho selecionado', group: 'Ações', icon: 'trash', run: desenho.deleteSelected },
    );

    return lista;
  }, [desenho, exportarPng, indicadores, restaurarLayout, salvarLayout]);

  // Valores de indicador para a legenda: o ultimo ponto de cada plot visivel.
  const seriesLegenda = useMemo(
    () =>
      indicadores.active
        .filter((a) => a.visible)
        .map((a) => ({
          label: indicadores.entryOf(a.name)?.label ?? a.name,
          value: null as number | null,
          color: a.colors?.['value'],
        })),
    [indicadores],
  );

  void tick;
  const estado = replay.state;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#cbd5e1' }}>
      {/* ═══ Barra HORIZONTAL: como o preço é desenhado, camadas, ambiente, ações ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
        <strong style={{ color: '#e2e8f0', fontSize: 14, whiteSpace: 'nowrap' }}>Robustus</strong>
        {/*
          ⭐ Período ANTES do resto da barra, e separado dele: TF é a pergunta "que
          recorte de tempo eu estou olhando", que vem antes de "como desenho" e "que
          camadas ligo". Enfiá-lo entre as camadas o esconderia justamente no controle
          que o operador troca mais vezes por sessão.

          ⚠️ A lista é `timeframesAgregaveisDe(M5)`, não `TIMEFRAMES`: o dado sintético
          nasce em M5, e oferecer M1 para depois mostrar tela vazia é pior que não
          oferecer.
        */}
        <TimeframeSelector
          timeframes={tfsDisponiveis}
          value={tf.id}
          onChange={(novo) => setTfId(novo.id)}
        />
        <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'rgba(148,163,184,0.18)' }} />
        <ChartToolbar
          chartType={modo}
          chartTypes={CHART_TYPE_OPTIONS}
          onChartTypeChange={(v) => setModo(v as ModoGrafico)}
          layers={camadas}
          onToggleLayer={alternarCamada}
          environment={ambiente}
          onToggleEnvironment={alternarAmbiente}
          actions={acoes}
          onAction={executarAcao}
          trailing={
            <Tooltip
              label="Paleta de comandos"
              hint="Busca qualquer recurso da biblioteca por nome, com a explicação de cada um."
              shortcut="Ctrl+K"
              placement="bottom"
            >
              <button
                type="button"
                onClick={() => setPaletaAberta(true)}
                aria-label="Abrir paleta de comandos"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.25)',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <Icon name="command" size={14} />
                <span>Comandos</span>
                <kbd style={{ fontSize: 9, padding: '0 4px', borderRadius: 3, border: '1px solid rgba(148,163,184,0.3)', opacity: 0.7 }}>
                  Ctrl K
                </kbd>
              </button>
            </Tooltip>
          }
        />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ═══ Barra VERTICAL: o que desenha sobre o preço ═══ */}
        <div style={{ padding: '6px 4px', borderRight: '1px solid rgba(148,163,184,0.12)' }}>
          <DrawingToolbar
            drawings={desenho}
            orientation="vertical"
            snapEnabled={imaLigado}
            onToggleSnap={() => setImaLigado((v) => !v)}
            collapsed={barraRecolhida}
            onToggleCollapsed={() => setBarraRecolhida((v) => !v)}
          />
        </div>

        {/* ═══ Os painéis de gráfico ═══ */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
          {/* Abas de ATIVO. Uma só enquanto o playground tem uma fonte de dado; a barra
              existe para a montagem estar demonstrada e testável. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 0' }}>
            <SymbolTabs
              tabs={[{ id: 'SINTETICO', label: 'SINTÉTICO', hint: tf.label, closable: false }]}
              value={ativo}
              onChange={setAtivo}
            />
            <span style={{ flex: 1 }} />
            {/* ⭐ Comparação lado a lado: o MESMO ativo em outro período, sincronizado. */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="checkbox"
                checked={comparar}
                onChange={(e) => setComparar(e.target.checked)}
              />
              Comparar
            </label>
            {comparar && (
              <TimeframeSelector
                timeframes={tfsDisponiveis}
                value={tfComp.id}
                onChange={(novo) => setTfComparacao(novo.id)}
                quick={['M15', 'H1', 'D1']}
              />
            )}
          </div>

          <ChartGrid
            layout={comparar ? '2-horizontal' : '1'}
            ariaLabel={comparar ? 'Comparação de períodos' : 'Painel de gráfico'}
            style={{ flex: 1, minHeight: 0, padding: 4 }}
          >
            {/* ⚠️ `position: relative` é requisito da ChartLegend, que ancora aqui. */}
            <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
              <ChartLegend
                readout={ohlc}
                symbol="SINTÉTICO"
                period={tf.label}
                series={seriesLegenda}
                precision={1}
              />
              <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            </div>

            {comparar && (
              /*
               * O painel de comparação é um `RobustusChart` cru: sem indicadores, sem
               * bookmap, sem desenho. É de propósito — ele existe para dar CONTEXTO de
               * outro período, e replicar as camadas ali dobraria o custo de desenho para
               * uma leitura que é de referência.
               */
              <PainelDeComparacao
                velas={velasComparacao}
                rotulo={tfComp.label}
                registrar={(e) => sync.register('comparacao', e)}
              />
            )}
          </ChartGrid>
        </div>

        {/* ═══ Painéis colapsáveis: o que se configura ═══ */}
        <aside
          style={{
            width: 310,
            borderLeft: '1px solid rgba(148,163,184,0.15)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflowY: 'auto',
          }}
        >
          <CollapsiblePanel
            title="Indicadores"
            icon="indicator"
            badge={`${indicadores.active.length} ativo(s)`}
            hint="Insira, remova e configure os 29 indicadores. Os campos vêm do metadado de cada um."
          >
            {/* ⭐ `openIndicator` vem do clique NO GRÁFICO: a linha clicada abre as
                propriedades dela aqui, sem o operador ter de procurar na lista. */}
            <IndicatorToolbox catalog={indicadores} title="" openIndicator={indicadorClicado} />
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Alertas"
            icon="alert"
            badge={`${alertas.fired.length} disparo(s)`}
            hint="Vigia níveis de preço e avisa no cruzamento, uma vez por armamento."
            defaultOpen={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alertas.alerts.map(([key, alert]) => (
                <div
                  key={key}
                  style={{
                    padding: '5px 7px',
                    borderRadius: 6,
                    border: `1px solid ${alert.state === 'TRIGGERED' ? 'rgba(251,191,36,0.4)' : 'rgba(148,163,184,0.2)'}`,
                    background: alert.state === 'TRIGGERED' ? 'rgba(251,191,36,0.08)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 11 }}>{key === 'cross-acima' ? 'Cruzar ↑ (66%)' : 'Cruzar ↓ (33%)'}</div>
                  <div style={{ fontSize: 10, color: alert.state === 'TRIGGERED' ? '#fbbf24' : '#64748b' }}>
                    {alert.state === 'TRIGGERED' ? 'disparado' : 'armado'} · {alert.mode}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={alertas.clearFired} style={botaoPequeno}>
                  Limpar
                </button>
                <button type="button" onClick={alertas.rearmAll} style={botaoPequeno}>
                  Re-armar
                </button>
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Replay de mercado"
            icon="replay"
            badge={modoReplay ? `${estado.position}/${estado.length}` : 'off'}
            hint="Reproduz o pregão barra a barra, como um vídeo, para treinar leitura."
            defaultOpen={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button type="button" onClick={() => setModoReplay((v) => !v)} style={botaoPequeno}>
                {modoReplay ? 'Desligar replay' : 'Ligar replay'}
              </button>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button type="button" onClick={() => replay.step(-1)} disabled={!modoReplay} style={botaoIcone} aria-label="Um passo atrás">
                  <Icon name="stepBack" size={14} />
                </button>
                <button type="button" onClick={replay.toggle} disabled={!modoReplay} style={botaoIcone} aria-label={estado.playing ? 'Pausar' : 'Play'}>
                  <Icon name={estado.playing ? 'pause' : 'play'} size={14} />
                </button>
                <button type="button" onClick={() => replay.step(1)} disabled={!modoReplay} style={botaoIcone} aria-label="Um passo à frente">
                  <Icon name="stepForward" size={14} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={estado.length}
                  value={estado.position}
                  disabled={!modoReplay}
                  onChange={(e) => replay.seek(Number(e.target.value))}
                  aria-label="Posição do replay"
                  style={{ flex: 1, minWidth: 60, accentColor: '#38bdf8' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>Velocidade</span>
                {VELOCIDADES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => replay.setSpeed(v)}
                    disabled={!modoReplay}
                    style={{ ...botaoPequeno, background: estado.speed === v ? 'rgba(56,189,248,0.2)' : 'transparent' }}
                  >
                    {v}×
                  </button>
                ))}
              </div>
            </div>
          </CollapsiblePanel>
        </aside>
      </div>

      <footer style={{ padding: '4px 12px', fontSize: 10, color: '#64748b', borderTop: '1px solid rgba(148,163,184,0.15)' }}>
        {desenho.drawings.length} desenho(s) · {desenho.selectedIds.length} selecionado(s) ·{' '}
        {indicadores.active.length} indicador(es) · gesto: {desenho.interaction.kind} ·{' '}
        {modoReplay ? `replay ${estado.position}/${estado.length}` : 'ao vivo'} ·{' '}
        {velasComHistorico.length} barra(s)
        {backfill.loading ? ' · carregando histórico…' : ''}
        {backfill.exhausted ? ' · início do histórico' : ''}
        {backfill.error === null ? '' : ` · falha no histórico: ${backfill.error}`} ·{' '}
        <strong>Ctrl+K</strong> abre a paleta de comandos
      </footer>

      <CommandPalette
        commands={comandos}
        open={paletaAberta}
        onOpenChange={setPaletaAberta}
        placeholder="Buscar indicador, ferramenta, modo de gráfico…"
      />

      <AplicarLinhasAlerta engine={engine} linhas={linhasAlerta} />
    </div>
  );
}

/** Aplica as linhas de nível de alerta. Efeito próprio, para seguir só o toggle. */
function AplicarLinhasAlerta(props: {
  engine: ReturnType<typeof useChartEngine>['engine'];
  linhas: readonly ChartPriceLine[];
}): null {
  const { engine, linhas } = props;
  useEffect(() => {
    if (engine === null) return;
    engine.setPriceLines(linhas);
  }, [engine, linhas]);
  return null;
}

const botaoPequeno: React.CSSProperties = {
  fontSize: 10,
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

const botaoIcone: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  borderRadius: 5,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

/**
 * Painel de COMPARAÇÃO: o mesmo ativo em outro período, ao lado do principal.
 *
 * ⚠️ Componente separado porque ele precisa do próprio `useChartEngine` — hook não pode
 * ser chamado condicionalmente dentro do `App`, e um segundo gráfico é exatamente um
 * segundo motor.
 *
 * ⚠️ `registrar` devolve a função de saída do grupo de sincronia, e o `useEffect` a
 * devolve como limpeza: sem isso, esconder a comparação deixaria um membro morto no grupo
 * e a janela do principal continuaria sendo propagada para um motor descartado.
 */
function PainelDeComparacao(props: {
  readonly velas: readonly SyntheticCandle[];
  readonly rotulo: string;
  readonly registrar: (engine: ChartEngine | null) => () => void;
}): JSX.Element {
  return (
    /*
     * ⭐ Aqui o painel usa o `ChartProvider` em vez de `useChartEngine` direto — de
     * propósito, para o provedor estar demonstrado no app. Ele monta o invólucro
     * `position: relative` e o container com altura, que são justamente as duas coisas que
     * o painel principal faz à mão logo acima.
     */
    <ChartProvider
      id="comparacao"
      options={{ barSpacing: 6 }}
      candles={props.velas}
      ariaLabel={`Gráfico de comparação em ${props.rotulo}`}
    >
      <span
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          zIndex: 2,
          fontSize: 10,
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(15,23,42,0.7)',
          color: '#cbd5e1',
        }}
      >
        SINTÉTICO · {props.rotulo}
      </span>
      <RegistrarNaSincronia registrar={props.registrar} />
    </ChartProvider>
  );
}

/**
 * Registra o motor DO PAINEL EM QUE ESTÁ no grupo de sincronia.
 *
 * ⚠️ Componente em vez de código no pai porque o motor vem do CONTEXTO (`useChart`), e o
 * contexto só existe dentro do provedor. É exatamente o padrão que o `ChartProvider`
 * habilita: quem precisa do motor pede, sem ninguém passar `engine` por prop.
 *
 * ⚠️ E devolve a saída do grupo como limpeza do efeito: sem isso, esconder a comparação
 * deixaria um membro morto no grupo, e a janela do painel principal continuaria sendo
 * propagada para um motor descartado.
 */
function RegistrarNaSincronia(props: {
  readonly registrar: (engine: ChartEngine | null) => () => void;
}): null {
  const { engine } = useChart();
  const { registrar } = props;
  useEffect(() => registrar(engine), [registrar, engine]);
  return null;
}

const raiz = document.getElementById('root');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
