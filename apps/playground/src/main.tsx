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
  useLayerLegends,
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
  AssetReadout,
  ObjectTree,
  useVisibleTimeRange,
  CorrelationInset,
} from '@robustus/charts-react';
// ⭐ Os núcleos puros da LEITURA do ativo. Ver `asset-readout.core.ts`: tudo sai das barras
// que já estão na tela, sem requisição nova.
import {
  desempenhoPorJanela,
  correlacaoDeRetornos,
  normalizarBase100,
  sazonalidadePorAno,
  termometroTecnico,
  votoDeMedia,
  votoDeOscilador,
  ROTULO_DA_JANELA,
  ROTULO_TECNICO,
} from '@robustus/charts-core';
import type { SnapBar } from '@robustus/charts-drawings';
import type { ChartEngine, PriceSeriesType, ChartPriceLine } from '@robustus/charts-engine';
import { registry } from '@robustus/charts-indicators';
import type { AlertSpec } from '@robustus/charts-react';
// ⭐ O alerta DESENHADO: o estado (armado/disparado) virando cor e traço. Ver
// `alert-line.core.ts` — é núcleo puro, e o pacote de alerta continua sem conhecer canvas.
import { linhasDeAlertas } from '@robustus/charts-alerts';
// ⭐ Templates de layout NOMEADOS. Núcleo PURO: a persistência é deste app (`localStorage`), o
// núcleo só decide o que é nome válido, como a coleção muda e como sobrevive a leitura ruim.
import {
  acharTemplate,
  desserializarTemplates,
  ordenarParaExibicao,
  removerTemplate,
  salvarTemplate,
  serializarTemplates,
  type ColecaoDeTemplates,
} from '@robustus/charts-engine';
import {
  makeOlderCandles,
  makeSyntheticBundle,
  type SyntheticBundle,
  type SyntheticCandle,
} from './synthetic.js';
// ⭐ O histórico REAL da mesa. Ver `mesa.ts`: WIN desde 2005, com volume por agressor.
import { ATIVOS_DA_MESA, PERIODOS_DA_MESA_IDS, useMesaBars } from './mesa.js';

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
  /**
   * ⭐ A FONTE do dado. `sintetico` continua o default, e é decisão:
   *
   * ⚠️ O sintético não depende de rede, é determinístico (semente fixa) e faz o playground
   * funcionar em qualquer máquina. A mesa depende do túnel para a máquina B estar no ar —
   * e ele JÁ FICOU quatro dias fora sem ninguém notar, segundo o registro do projeto de
   * origem. Nascer apontando para uma dependência que pode estar ausente faria a primeira
   * impressão do playground ser uma tela de erro.
   */
  const [fonte, setFonte] = useState<'sintetico' | 'mesa'>('sintetico');
  /**
   * ⭐ A altura dos sub-painéis de indicador, em três degraus.
   *
   * ⚠️ UM controle para todos, e não um seletor por indicador. Com 29 indicadores
   * disponíveis, uma barra de altura por linha da lista seria a "parede de botões" que este
   * projeto evita por regra — e a pergunta real do operador é *"quero os osciladores
   * discretos ou dominantes"*, que é uma decisão só. Quem quiser altura por indicador
   * chama `setPaneHeight` direto: a API é por indicador, a INTERFACE é agregada.
   *
   * `null` = repartição automática (o comportamento histórico, 38% divididos).
   */
  const [alturaOsciladores, setAlturaOsciladores] = useState<number | null>(0.11);
  const [ativoMesa, setAtivoMesa] = useState('WIN');
  /**
   * ⭐ O ativo do INSET de correlação. `null` = inset fechado.
   *
   * ⚠️ Só faz sentido com dado da mesa: correlacionar o sintético com ele mesmo produziria 1,00
   * e ensinaria a leitura errada. O controle nem aparece em modo sintético.
   */
  const [ativoCorrelacao, setAtivoCorrelacao] = useState<string | null>(null);
  const [mostrarBookmap, setMostrarBookmap] = useState(true);
  const [mostrarPerfil, setMostrarPerfil] = useState(false);
  /** O perfil segue a JANELA VISÍVEL (default) ou agrega o dia inteiro. */
  const [perfilNaJanela, setPerfilNaJanela] = useState(true);
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
  const tfsDisponiveis = useMemo(() => {
    const agregaveis = timeframesAgregaveisDe(TF_BASE);
    // ⚠️ Em modo mesa só os períodos MATERIALIZADOS são oferecidos. A base não tem M1, e
    // oferecer para depois mostrar tela vazia é pior que não oferecer.
    return fonte === 'mesa'
      ? agregaveis.filter((x) => PERIODOS_DA_MESA_IDS.includes(x.id))
      : agregaveis;
  }, [TF_BASE, fonte]);
  const tf = useMemo(() => timeframePorId(tfId) ?? TF_BASE, [tfId, TF_BASE]);

  // ── Perfil de volume (histograma por LINHA) ────────────────────────────────
  //
  // ⚠️ Agregado AQUI, não na camada. É o consumidor que decide o escopo: este playground
  // usa o dia inteiro do grid. Para "perfil da janela visível", reagregue com
  // `{ janela: { tsDe, tsAte } }` quando a janela mudar.

  // ── Histórico carregado sob demanda (backfill) ─────────────────────────────
  //
  // ⭐ O que o `useHistoryBackfill` observa é a janela; quem guarda o dado é o
  // consumidor — aqui, este estado. Arrastar para trás até a borda faz o hook pedir, e
  // o `loadOlder` abaixo faz o papel do provedor (dado sintético, sem backend).
  const [historico, setHistorico] = useState<SyntheticCandle[]>([]);
  const [volumeHistorico, setVolumeHistorico] = useState<SyntheticBundle['volume']>([]);

  // ── O histórico REAL da mesa ───────────────────────────────────────────────
  //
  // ⭐ Em modo mesa o período é pedido DIRETO à fonte, sem `rollupBars`: os quatro
  // períodos (5min/15min/1h/D1) são materializados lá a partir do TICK, e reagregar em
  // cima da derivada só perderia precisão.
  const mesa = useMesaBars({
    ligado: fonte === 'mesa',
    symbol: ativoMesa,
    periodSeconds: tf.seconds,
  });

  /**
   * ⭐ O SEGUNDO ativo, para o inset de correlação.
   *
   * ⚠️ Mesmo período do principal, de propósito: correlacionar 5min com D1 pareia coisas que
   * não são comparáveis, e o alinhamento por tempo devolveria pouquíssimos pares — o número
   * sairia com amostra fraca e o núcleo o recusaria (o que é o certo, mas o operador não
   * entenderia por quê).
   */
  const mesaCorrelacao = useMesaBars({
    ligado: fonte === 'mesa' && ativoCorrelacao !== null,
    symbol: ativoCorrelacao ?? 'WIN',
    periodSeconds: tf.seconds,
  });

  // A série de partida, conforme a fonte escolhida.
  const velasDaFonte = fonte === 'mesa' ? mesa.candles : bundle.candles;
  const volumeDaFonte = fonte === 'mesa' ? mesa.volume : bundle.volume;

  // ── Replay ────────────────────────────────────────────────────────────────
  const replay = useReplay({ bars: velasDaFonte, speed: 4 });
  const velasComHistorico = useMemo(
    () =>
      // Em modo mesa o passado já vem dentro de `mesa.candles` (a caminhada para trás
      // acontece lá); o `historico` local é do gerador sintético.
      fonte === 'mesa'
        ? velasDaFonte
        : historico.length === 0
          ? velasDaFonte
          : [...historico, ...velasDaFonte],
    [fonte, historico, velasDaFonte],
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
    // ⚠️ Em modo mesa o dado JÁ vem no período pedido — agregar de novo seria reamostrar
    // 1h sobre 1h e produzir uma barra só.
    if (fonte === 'mesa') return velasCruas;
    if (tf.seconds === TF_BASE.seconds) return velasCruas;
    const agregadas = rollupBars(velasCruas, TF_BASE.seconds, tf.seconds);
    // ⚠️ Agregação vazia (período não múltiplo, dado insuficiente) DEGRADA para as velas
    // cruas em vez de esvaziar a tela. Tela vazia sem explicação é o defeito que este
    // projeto já pagou várias vezes.
    return agregadas.length === 0 ? velasCruas : (agregadas as typeof velasCruas);
  }, [fonte, velasCruas, tf, TF_BASE]);

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
      ? volumeDaFonte.slice(0, velasCruas.length)
      : fonte === 'mesa' || volumeHistorico.length === 0
        ? volumeDaFonte
        : [...volumeHistorico, ...volumeDaFonte];
    // Em modo mesa o volume já vem no período das velas (mesma consulta).
    if (fonte === 'mesa' || tf.seconds === TF_BASE.seconds) return cru;

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
  }, [fonte, modoReplay, volumeDaFonte, velasCruas.length, volumeHistorico, tf, TF_BASE, velasBase]);

  /** O ativo da mesa em uso, ou `null` em modo sintético. */
  const ativoAtual = useMemo(
    () => (fonte === 'mesa' ? (ATIVOS_DA_MESA.find((a) => a.symbol === ativoMesa) ?? null) : null),
    [fonte, ativoMesa],
  );
  /**
   * A casa de preço do ativo.
   *
   * ⚠️ Importa mais do que parece: `WDO` anda em 0,5 e `PETR4` em 0,01. Usar o tick do
   * sintético (5) no `PETR4` faria o eixo de preço arredondar tudo para múltiplos de 5 —
   * uma ação de R$ 38,42 apareceria como 40, e o gráfico mentiria sobre o preço.
   */
  const tickSizeAtual = ativoAtual?.tickSize ?? bundle.tickSize;
  const simboloExibido = fonte === 'mesa' ? ativoMesa : 'SINTÉTICO';

  /**
   * A trilha da FONTE: o que está carregado, e o que falhou.
   *
   * ⭐ Entra na mesma trilha das camadas (`useLayerLegends` → `ChartLegend notes`) em vez
   * de abrir um canto novo na tela. É exatamente o que a trilha existe para evitar: mais
   * um dono de canto.
   */
  const notasDaFonte = useMemo(() => {
    if (fonte !== 'mesa') return [];
    if (mesa.erro !== null) {
      return [{ fonte: 'preco', linhas: [mesa.erro], alerta: true }];
    }
    if (mesa.carregando && mesa.candles.length === 0) {
      return [{ fonte: 'preco', linhas: [`Carregando ${ativoMesa} ${tf.label}…`] }];
    }
    if (mesa.candles.length === 0) {
      return [
        {
          fonte: 'preco',
          linhas: [`Sem barras de ${ativoMesa} ${tf.label} na janela buscada.`],
          alerta: true,
        },
      ];
    }
    const primeira = mesa.candles[0];
    const desde =
      primeira === undefined
        ? ''
        : ` · desde ${new Date(primeira.time * 1000).toLocaleDateString('pt-BR')}`;
    const comDelta = mesa.delta.size;
    return [
      {
        fonte: 'preco',
        linhas: [
          `Mesa · ${mesa.candles.length} barras${desde}` +
            (comDelta > 0 ? ` · ${comDelta} com agressor` : ' · sem agressor') +
            (mesa.esgotado ? ' · início da série' : ''),
        ],
      },
    ];
  }, [fonte, mesa.erro, mesa.carregando, mesa.candles, mesa.delta, mesa.esgotado, ativoMesa, tf.label]);

  // ── A LEITURA do ativo: desempenho, sazonalidade e termômetro ──────────────
  //
  // ⭐ Tudo derivado das MESMAS barras que estão na tela. Nenhuma requisição nova.
  const leitura = useMemo(() => {
    const barras = velasBase.map((c) => ({ time: c.time, close: c.close }));
    const ultima = barras[barras.length - 1];
    // ⚠️ O "agora" é o tempo da ÚLTIMA BARRA, e não `Date.now()`. Num gráfico de histórico
    // (WIN de 2005, ou um ativo cuja série terminou) o relógio da máquina está anos à frente
    // do dado, e todas as janelas sairiam vazias — o painel pareceria quebrado quando o que
    // está velho é a série. O desempenho é do ativo, medido de onde ele parou.
    const agora = ultima?.time ?? 0;
    return {
      desempenho: desempenhoPorJanela(barras, agora),
      // Três anos: mais que isso vira emaranhado num painel de 260 px de largura.
      sazonalidade: sazonalidadePorAno(barras, 3),
    };
  }, [velasBase]);

  /**
   * O termômetro técnico a partir dos indicadores LIGADOS.
   *
   * ⚠️ Só indicadores VISÍVEIS votam: um indicador escondido não está na leitura do operador,
   * e deixá-lo votar faria o consenso discordar do que está na tela.
   *
   * ⚠️ O voto sai do ÚLTIMO valor calculado de cada um, por natureza: oscilador com faixa
   * (RSI, MFI, estocástico) vota por sobrecompra/sobrevenda; média vota por posição do preço.
   * Indicador sem regra conhecida NÃO vota — inventar uma faria o número parecer mais
   * informado do que é.
   */
  const termometro = useMemo(() => {
    const ultimoFechamento = velasBase[velasBase.length - 1]?.close ?? null;
    // ⚠️ A INSTÂNCIA vive em `plots` e o `name`/`visible` em `active`: são duas visões do
    // mesmo indicador, e o cruzamento é pelo id. Só `plots` tem como calcular.
    const barrasParaCalculo = velasBase.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const votos = indicadores.plots
      .map((plot) => {
        const meta = indicadores.active.find((a) => a.id === plot.id);
        if (meta === undefined || !meta.visible) return null;
        const pontos = plot.instance.warmup(barrasParaCalculo);
        const ultimo = pontos[pontos.length - 1]?.values ?? {};
        const valor = (ultimo['value'] ?? null) as number | null;
        const nome = meta.name;
        if (nome === 'rsi' || nome === 'stoch' || nome === 'cci') return votoDeOscilador(valor);
        if (nome === 'mfi') return votoDeOscilador(valor, 20, 80);
        if (nome.startsWith('ema') || nome.startsWith('sma') || nome === 'vwap') {
          return votoDeMedia(ultimoFechamento, valor);
        }
        return null;
      });
    return termometroTecnico(votos);
  }, [indicadores.plots, indicadores.active, velasBase]);

  /**
   * ⭐ A CORRELAÇÃO: as duas séries em base 100 mais o coeficiente dos RETORNOS.
   *
   * ⚠️ Base 100 é o que torna a comparação possível — WIN em 188.000 e PETR4 em 38 na mesma
   * escala dariam uma linha e um risco no chão. E o coeficiente é sobre RETORNO e nunca sobre
   * preço: dois ativos que subiram no período dão quase 1 em preço mesmo que um tenha subido em
   * janeiro e o outro em dezembro. Ver `correlacao.core.ts`.
   */
  const correlacao = useMemo(() => {
    if (ativoCorrelacao === null) return null;
    const a = velasBase.map((c) => ({ time: c.time, close: c.close }));
    const b = mesaCorrelacao.candles.map((c) => ({ time: c.time, close: c.close }));
    if (a.length < 2 || b.length < 2) return null;
    return {
      a: { label: simboloExibido, color: '#38bdf8', pontos: normalizarBase100(a) },
      b: { label: ativoCorrelacao, color: '#f59e0b', pontos: normalizarBase100(b) },
      ...correlacaoDeRetornos(a, b),
    };
  }, [ativoCorrelacao, velasBase, mesaCorrelacao.candles, simboloExibido]);

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
    // ⚠️ `mostrarLegenda: false` NÃO silencia a informação: a camada continua PUBLICANDO
    // as linhas, e elas aparecem na trilha da `ChartLegend` (ver `useLayerLegends`). O
    // que sai é só o texto desenhado no canvas — que era o que colidia.
    // ⭐⭐ `null` na CRIAÇÃO, e a camada é dona de um efeito — por causa de um CICLO.
    //
    // ⚠️ O perfil da janela visível depende da janela, que só existe depois de o motor
    // existir; e o motor nascia recebendo o perfil. Passar o perfil aqui e também atualizá-lo
    // pelo efeito daria DOIS donos escrevendo na mesma camada, e a ordem entre eles dependeria
    // da ordem de declaração dos hooks — o tipo de acoplamento que quebra ao mover uma linha.
    //
    // Um dono só: o efeito abaixo (`// ── Perfil de volume`). Aqui a camada nasce desligada.
    volumeProfile: null,
    bookmap:
      mostrarBookmap && grid !== null
        ? {
            grid,
            metrica: 'AMBAS',
            escala: 'P99_GAMMA',
            tickSize: tickSizeAtual,
            modoCor: 'TERMICA',
            // ⭐ A legenda do livro sai do CANVAS e entra na TRILHA.
            //
            // ⚠️ Antes era `posicaoLegenda: 'inferior-esquerda'`, para fugir da fita de
            // O/H/L/C no topo. Só que o canto de baixo é a faixa do histograma de volume
            // — daí o relato *"o bookmap ainda está em cima do histograma de volume"*. A
            // camada não conhece essa faixa (ela vem de `scaleMargins` numa escala de
            // overlay) e não tem como conhecer. Escolher canto era o problema; a trilha
            // empilha tudo num lugar só, alinhado, que é o que foi pedido.
            mostrarLegenda: false,
          }
        : null,
  });

  /**
   * ⭐ PERFIL DA JANELA VISÍVEL, e não do dia inteiro.
   *
   * ⚠️ A diferença é a razão de o perfil existir: o perfil do dia inteiro é história, e o da
   * janela visível é onde o preço está negociando AGORA. Um operador que dá zoom nas últimas
   * duas horas quer o POC dessas duas horas — o POC do dia inteiro fica em outro preço e o
   * levaria a operar contra um nível que já não é referência.
   *
   * ⚠️ A tolerância é METADE de uma barra do período em uso. A guarda existe porque o motor
   * emite mudança de janela a cada quadro do arrasto (60 vezes por segundo): sem ela, cada
   * emissão reagregaria milhares de células e o pan travaria no gesto mais usado do gráfico.
   * Meia barra é o limiar em que o perfil muda de forma perceptível.
   *
   * ⚠️ `perfilNaJanela` desligado devolve o perfil do dia inteiro (`janela` ausente), que é o
   * comportamento anterior — a leitura clássica de perfil de sessão continua a um clique.
   */
  const faixaVisivel = useVisibleTimeRange({ engine, toleranciaSegundos: tf.seconds / 2 });
  const perfil = useMemo(() => {
    if (!mostrarPerfil || grid === null) return null;
    if (!perfilNaJanela || faixaVisivel === null) return agregarPerfilDeVolume(grid);
    // ⚠️ O núcleo recorta em MILISSEGUNDOS (é a unidade do grid de profundidade), e a faixa
    // visível vem em segundos (a unidade do eixo de tempo). As duas convivem na biblioteca de
    // propósito, e cada fronteira declara a sua — converter aqui é a fronteira.
    return agregarPerfilDeVolume(grid, {
      janela: { tsDe: faixaVisivel.de * 1000, tsAte: faixaVisivel.ate * 1000 },
    });
  }, [mostrarPerfil, grid, perfilNaJanela, faixaVisivel]);

  // ── Perfil de volume: o efeito é o ÚNICO dono da camada ────────────────────
  //
  // ⚠️ Ver a nota em `volumeProfile: null` na criação do motor: o perfil da janela visível
  // depende da janela, que depende do motor. Um dono só evita duas escritas concorrentes na
  // mesma camada.
  useEffect(() => {
    if (engine === null || engine.isDisposed) return;
    engine.setVolumeProfileLayer(
      perfil === null
        ? null
        : { perfil, larguraFracao: 0.16, margemInferiorFracao: 0.15, mostrarLegenda: false },
    );
  }, [engine, perfil]);

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
      // ⭐ Em modo mesa quem anda para trás é o hook da mesa (ele conhece a borda PEDIDA e
      // atravessa fim de semana e feriado). Devolver 0 aqui não é "não há mais": o
      // `carregarMaisAntigo` é assíncrono e o dado entra pelo estado dele.
      if (fonte === 'mesa') {
        void mesa.carregarMaisAntigo();
        return 0;
      }
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
  /**
   * A altura pedida por indicador — a mesma para todos, vinda do degrau escolhido.
   *
   * ⚠️ `{}` quando o degrau é automático, e NÃO um objeto com `undefined`: o hook trata
   * chave ausente como "devolva à repartição automática", que é exatamente o que se quer.
   */
  const alturasDeIndicador = useMemo<Record<string, number>>(() => {
    if (alturaOsciladores === null) return {};
    const m: Record<string, number> = {};
    for (const p of indicadores.plots) m[p.id] = alturaOsciladores;
    return m;
  }, [alturaOsciladores, indicadores.plots]);

  useIndicators({
    engine,
    plots: indicadores.plots,
    paneHeights: alturasDeIndicador,
    bars: velasExibidas,
    colors: indicadores.colors,
    visibility: indicadores.visibility,
    onIndicatorClick: (plotId) =>
      setIndicadorClicado((atual) => ({ id: plotId, nonce: (atual?.nonce ?? 0) + 1 })),
  });

  const ohlc = useCrosshair({ engine });
  // ⭐ A trilha: o que cada camada de canvas tem a dizer, enfileirado pelo motor na ordem
  // canônica de leitura. Ver `useLayerLegends` e `legend-rail.core.ts`.
  const notasDasCamadas = useLayerLegends(engine);
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

  /**
   * ⭐ A ÁRVORE DE OBJETOS: tudo o que está no gráfico, em lista.
   *
   * ⚠️ Os desenhos são identificados por TIPO + preço, e não por id: o id é opaco
   * (`drawing-7`) e não diz nada a quem olha. "Linha horizontal · 188.420" localiza o objeto
   * na tela sem o operador ter de clicar em cada um para descobrir qual é.
   */
  const gruposDeObjetos = useMemo(() => {
    const rotuloDeDesenho: Record<string, string> = {
      TRENDLINE: 'Linha de tendência',
      RAY: 'Raio',
      EXTENDED_LINE: 'Reta infinita',
      HORIZONTAL_LINE: 'Linha horizontal',
      HORIZONTAL_RAY: 'Raio horizontal',
      VERTICAL_LINE: 'Linha vertical',
      RECTANGLE: 'Retângulo',
      ARROW: 'Seta',
      FIB_RETRACEMENT: 'Retração de Fib.',
      FIB_EXTENSION: 'Extensão de Fib.',
      MEASURE: 'Régua',
      POSITION_LONG: 'Posição de compra',
      POSITION_SHORT: 'Posição de venda',
    };
    return [
      {
        id: 'indicadores',
        label: 'Indicadores',
        emptyHint: 'Nenhum indicador no gráfico. Escolha um na caixa de indicadores.',
        items: indicadores.active.map((a) => ({
          id: a.id,
          label: indicadores.entryOf(a.name)?.label ?? a.name,
          ...(a.colors?.['value'] === undefined ? {} : { color: a.colors['value'] }),
          visible: a.visible,
          onToggleVisible: () => indicadores.setVisible(a.id, !a.visible),
          onRemove: () => indicadores.remove(a.id),
          // Clicar no nome abre as propriedades — o mesmo caminho do clique no gráfico.
          onSelect: () =>
            setIndicadorClicado((atual) => ({ id: a.id, nonce: (atual?.nonce ?? 0) + 1 })),
        })),
      },
      {
        id: 'desenhos',
        label: 'Desenhos',
        emptyHint: 'Nenhum desenho. Escolha uma ferramenta na barra à esquerda.',
        items: desenho.drawings.map((d) => {
          const preco = d.anchors[0]?.price;
          return {
            id: d.id,
            label: rotuloDeDesenho[d.kind] ?? d.kind,
            ...(preco === undefined ? {} : { detail: preco.toFixed(1) }),
            selected: desenho.selectedIds.includes(d.id),
            onRemove: () => desenho.load(desenho.drawings.filter((x) => x.id !== d.id)),
          };
        }),
      },
      {
        id: 'alertas',
        label: 'Alertas',
        emptyHint: 'Nenhum alerta armado.',
        items: alertas.alerts.map(([key, alert]) => ({
          id: key,
          label: key === 'cross-acima' ? 'Cruzar ↑' : 'Cruzar ↓',
          detail: alert.state === 'TRIGGERED' ? 'disparado' : 'armado',
          color: alert.state === 'TRIGGERED' ? '#fbbf24' : '#64748b',
        })),
      },
    ];
  }, [indicadores, desenho, alertas.alerts]);


  /**
   * ⭐ As linhas de alerta com o ESTADO virando aparência.
   *
   * ⚠️ Antes eram duas linhas de cor FIXA (verde e vermelho) que nunca mudavam: o alerta
   * disparava, o painel lateral registrava, e a linha no gráfico continuava idêntica. O
   * operador olhava um nível achando que ele ainda vigiava algo.
   *
   * ⚠️ E a cor era enganosa: verde/vermelho já significam ALTA e BAIXA em todo pixel deste
   * gráfico (vela, volume, delta, zona de posição), então "alerta em vermelho" era lido como
   * afirmação sobre o mercado. Agora armado é âmbar tracejado (a cor de ressalva do projeto) e
   * disparado é ciano sólido — ver `alert-line.core.ts`.
   */
  const linhasAlerta = useMemo<ChartPriceLine[]>(() => {
    if (!alertasLigados) return [];
    return linhasDeAlertas(
      alertas.alerts.map(([key, alert]) => ({
        condicao: alert.condition,
        estado: alert.state,
        nome: key === 'cross-acima' ? 'Cruzar ↑' : 'Cruzar ↓',
      })),
      1,
    ) as unknown as ChartPriceLine[];
  }, [alertasLigados, alertas.alerts]);

  // ── Ambiente do motor ─────────────────────────────────────────────────────
  useEffect(() => {
    if (engine === null) return;
    engine.api.applyOptions({
      grid: {
        vertLines: { visible: gradeVertical, color: 'rgba(148,163,184,0.07)' },
        horzLines: { visible: true, color: 'rgba(148,163,184,0.10)' },
      },
      // ⚠️ A marca d'água diz o ATIVO, e não uma palavra fixa: com dado real na tela,
      // "SINTÉTICO" escrito em 64 px atrás das velas seria uma afirmação falsa — e a marca
      // d'água existe justamente para dizer o que se está vendo.
      watermark: marcaDagua ? { text: simboloExibido, fontSize: 64 } : { text: '', visible: false },
      rightPriceScale: {
        scaleMargins: { top: 0.08, bottom: 0.2 },
        priceFormat: { tickSize: tickSizeAtual },
      },
    });
  }, [engine, gradeVertical, marcaDagua, tickSizeAtual, simboloExibido]);

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

  /**
   * ⭐ TEMPLATES NOMEADOS: os setups do operador.
   *
   * ⚠️ Havia UM lugar para salvar, e salvar sobrescrevia. Um operador tem vários setups pelo
   * mesmo ativo — fluxo, tendência, abertura — e troca entre eles no meio do pregão. Sem nome,
   * cada troca é reconstruir tudo à mão, e é justamente no pregão que ninguém tem tempo.
   *
   * ⚠️ A leitura NUNCA lança: o núcleo descarta item corrompido e devolve avisos. Perder todos
   * os templates por causa de um corrompido é o desfecho que a validação evita — e um `JSON.parse`
   * solto num `try` vazio perderia a lista inteira.
   */
  const CHAVE_TEMPLATES = 'robustus-templates';
  const [templates, setTemplates] = useState<ColecaoDeTemplates>(() => {
    const bruto = localStorage.getItem(CHAVE_TEMPLATES);
    if (bruto === null) return [];
    try {
      return desserializarTemplates(JSON.parse(bruto)).colecao;
    } catch {
      // JSON inválido (gravação truncada por cota estourada): começa vazio em vez de derrubar
      // a montagem do aplicativo.
      return [];
    }
  });
  const [nomeDoTemplate, setNomeDoTemplate] = useState('');

  /** O documento de estado corrente — o que qualquer "salvar" guarda. */
  const documentoAtual = useCallback(
    () =>
      capture({
        symbol: simboloExibido,
        priceSeriesType: serieDoModo(modo),
        indicators: indicadores.states,
        alerts: alertSpecs.map((s) => ({ key: s.key, condition: s.condition, mode: s.options?.mode })),
        drawings: desenho.drawings,
      }) as unknown as Record<string, unknown>,
    [alertSpecs, capture, desenho.drawings, indicadores.states, modo, simboloExibido],
  );

  const gravarTemplates = useCallback((colecao: ColecaoDeTemplates): void => {
    setTemplates(colecao);
    try {
      localStorage.setItem(CHAVE_TEMPLATES, JSON.stringify(serializarTemplates(colecao)));
    } catch {
      // ⚠️ Cota de `localStorage` estourada. O estado em memória FICA (o operador não perde o
      // trabalho da sessão) e a próxima gravação tenta de novo — melhor que derrubar a
      // interface por causa de armazenamento cheio.
    }
  }, []);

  const salvarComoTemplate = useCallback((): void => {
    const r = salvarTemplate(templates, nomeDoTemplate, documentoAtual(), Math.floor(Date.now() / 1000));
    if (!r.ok) return;
    gravarTemplates(r.colecao);
    setNomeDoTemplate('');
    setTick((n) => n + 1);
  }, [documentoAtual, gravarTemplates, nomeDoTemplate, templates]);

  const carregarTemplate = useCallback(
    (nome: string): void => {
      const t = acharTemplate(templates, nome);
      if (t === null) return;
      const { state } = restore(t.documento);
      setModo(state.priceSeriesType as ModoGrafico);
      indicadores.load(state.indicators);
      desenho.load(state.drawings.drawings as never);
      setTick((n) => n + 1);
    },
    [desenho, indicadores, restore, templates],
  );

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
    () =>
      ([
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
        hint: 'Histograma por LINHA: quanto negociou em cada preço, com POC e área de valor. Segue a janela visível.',
      },
      {
        // ⭐ O ESCOPO do perfil como chave própria, e não como um segundo botão "Perfil":
        // são duas perguntas diferentes — "eu quero perfil?" e "de que recorte?". Fundir as
        // duas num só controle obrigaria a desligar o perfil para trocar o escopo.
        //
        // ⚠️ Só aparece com o perfil LIGADO: um controle que não afeta nada visível é ruído.
        id: 'perfil-janela',
        label: 'Perfil da janela',
        icon: 'volumeProfile',
        active: perfilNaJanela,
        hint: 'Liga: o perfil reagrega no que está na tela (o POC é o da janela). Desliga: agrega o dia inteiro, a leitura clássica de sessão.',
      },
      {
        id: 'alertas',
        label: 'Alertas',
        icon: 'alert',
        active: alertasLigados,
        hint: 'Vigia níveis e avisa no cruzamento, sem repetir o aviso.',
      },
      ] as ToolbarToggleItem[])
        // ⚠️ O escopo do perfil só entra na barra com o perfil LIGADO: um controle que não
        // afeta nada visível é ruído, e esta barra tem a regra de não encher a tela de botões.
        .filter((item) => item.id !== 'perfil-janela' || mostrarPerfil),
    [alertasLigados, mostrarBookmap, mostrarPerfil, perfilNaJanela],
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
    else if (id === 'perfil-janela') setPerfilNaJanela((v) => !v);
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
        {/*
          ⭐ UM controle só para "o que eu estou vendo", e isso é decisão de interface.
          Escolher `WIN` já implica dado REAL da mesa; escolher `SINTÉTICO` implica gerador
          local. Dois controles (uma chave "fonte" e um seletor "ativo") criariam a
          combinação impossível — fonte sintética com ativo `PETR4` — e o operador teria de
          administrar um estado que não significa nada. Um `select` também não enche a tela
          de botões, que é a regra desta barra.
        */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ opacity: 0.6 }}>Ativo</span>
          <select
            value={fonte === 'mesa' ? ativoMesa : 'SINTETICO'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'SINTETICO') {
                setFonte('sintetico');
                return;
              }
              setFonte('mesa');
              setAtivoMesa(v);
              // ⚠️ Período que a mesa não tem cai para M5 em vez de mostrar tela vazia: o
              // sintético oferece M1 e a mesa não, então trocar de fonte com M1 escolhido
              // deixaria o seletor apontando para um período inexistente.
              if (!PERIODOS_DA_MESA_IDS.includes(tf.id)) setTfId('M5');
            }}
            style={{
              background: 'rgba(15,23,42,0.6)',
              color: '#cbd5e1',
              border: '1px solid rgba(148,163,184,0.28)',
              borderRadius: 4,
              fontSize: 11,
              padding: '2px 4px',
            }}
          >
            <option value="SINTETICO">SINTÉTICO (local)</option>
            {ATIVOS_DA_MESA.map((a) => (
              <option key={a.symbol} value={a.symbol}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
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
            {/*
              ⭐ O ativo do INSET de correlação. ⚠️ Só em modo mesa: correlacionar o sintético
              com ele mesmo daria 1,00 e ensinaria a leitura errada. E o ativo principal sai da
              lista — correlação de um ativo consigo é 1 por definição, e oferecer isso é
              oferecer um número que não informa.
            */}
            {fonte === 'mesa' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <span style={{ opacity: 0.6 }}>Correlação</span>
                <select
                  value={ativoCorrelacao ?? ''}
                  onChange={(e) => setAtivoCorrelacao(e.target.value === '' ? null : e.target.value)}
                  style={{
                    background: 'rgba(15,23,42,0.6)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(148,163,184,0.28)',
                    borderRadius: 4,
                    fontSize: 11,
                    padding: '2px 4px',
                  }}
                >
                  <option value="">nenhuma</option>
                  {ATIVOS_DA_MESA.filter((x) => x.symbol !== ativoMesa).map((x) => (
                    <option key={x.symbol} value={x.symbol}>
                      {x.symbol}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                symbol={simboloExibido}
                period={tf.label}
                series={seriesLegenda}
                notes={[...notasDaFonte, ...notasDasCamadas]}
                precision={1}
              />
              <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
              {/*
                ⭐ O gráfico DENTRO do gráfico. Fica na célula `position: relative` junto da
                legenda, e é SVG e não um segundo motor — ver `CorrelationInset.tsx`.
              */}
              {correlacao !== null && (
                <CorrelationInset
                  a={correlacao.a}
                  b={correlacao.b}
                  coeficiente={correlacao.coeficiente}
                  leitura={correlacao.leitura}
                  amostras={correlacao.amostras}
                  onFechar={() => setAtivoCorrelacao(null)}
                />
              )}
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
          {/*
            ⭐ A LEITURA do ativo, em primeiro lugar no painel lateral — e a posição é
            decisão: "como está o ativo" é a pergunta que se faz ANTES de configurar
            indicador ou alerta. Aberto por default pelo mesmo motivo.
          */}
          <CollapsiblePanel
            title="Leitura do ativo"
            icon="indicator"
            badge={simboloExibido}
            hint="Desempenho por janela, sazonalidade por ano e consenso dos indicadores ligados. Tudo derivado das barras que já estão na tela."
          >
            <AssetReadout
              symbol={simboloExibido}
              performance={leitura.desempenho}
              rotulos={ROTULO_DA_JANELA}
              seasonality={leitura.sazonalidade}
              gauge={termometro}
              rotulosTecnicos={ROTULO_TECNICO}
            />
          </CollapsiblePanel>

          {/*
            ⭐ A ÁRVORE de objetos vem antes da caixa de indicadores: ela é o ÍNDICE do que já
            está na tela, e a caixa é o catálogo do que se pode acrescentar. Ver o que existe
            precede escolher o que somar.
          */}
          {/*
            ⭐ TEMPLATES: os setups do operador, com nome. Fica depois da leitura do ativo e
            antes dos objetos — é configuração de SESSÃO, não do gráfico corrente.
          */}
          <CollapsiblePanel
            title="Meus setups"
            icon="save"
            badge={`${templates.length}`}
            hint="Salve a combinação atual de indicadores, desenhos e alertas com um nome, e volte a ela com um clique. Salvar com um nome que já existe sobrescreve."
            defaultOpen={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  value={nomeDoTemplate}
                  onChange={(e) => setNomeDoTemplate(e.target.value)}
                  // ⚠️ Enter salva: é o gesto que qualquer campo de nome tem, e obrigar o
                  // operador a ir com o mouse até o botão no meio do pregão é atrito.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') salvarComoTemplate();
                  }}
                  placeholder="Nome do setup (ex.: Fluxo abertura)"
                  aria-label="Nome do setup"
                  maxLength={48}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(15,23,42,0.6)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(148,163,184,0.28)',
                    borderRadius: 4,
                    fontSize: 11,
                    padding: '3px 6px',
                  }}
                />
                <button
                  type="button"
                  onClick={salvarComoTemplate}
                  // ⚠️ Desabilitado com nome vazio, em vez de salvar como "sem nome": um item
                  // sem nome na lista é indistinguível do próximo item sem nome.
                  disabled={nomeDoTemplate.trim().length === 0}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(148,163,184,0.28)',
                    background: 'rgba(56,189,248,0.12)',
                    color: '#cbd5e1',
                    cursor: nomeDoTemplate.trim().length === 0 ? 'not-allowed' : 'pointer',
                    opacity: nomeDoTemplate.trim().length === 0 ? 0.45 : 1,
                  }}
                >
                  {acharTemplate(templates, nomeDoTemplate) === null ? 'Salvar' : 'Sobrescrever'}
                </button>
              </div>

              {/*
                ⭐ O botão DIZ "Sobrescrever" quando o nome já existe. O núcleo sobrescreve de
                propósito (recusar obrigaria a inventar "Fluxo 2" para atualizar o setup), mas
                sobrescrever em silêncio destrói trabalho — o rótulo é o aviso.
              */}
              <ObjectTree
                groups={[
                  {
                    id: 'templates',
                    label: 'Salvos',
                    emptyHint: 'Nenhum setup salvo. Dê um nome à combinação atual e salve.',
                    items: ordenarParaExibicao(templates).map((tpl) => ({
                      id: tpl.nome,
                      label: tpl.nome,
                      detail:
                        tpl.atualizadoEm > 0
                          ? new Date(tpl.atualizadoEm * 1000).toLocaleDateString('pt-BR')
                          : undefined,
                      onSelect: () => carregarTemplate(tpl.nome),
                      onRemove: () => gravarTemplates(removerTemplate(templates, tpl.nome)),
                    })),
                  },
                ]}
              />
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Objetos no gráfico"
            icon="settings"
            badge={`${gruposDeObjetos.reduce((n, g) => n + g.items.length, 0)}`}
            hint="Tudo o que está desenhado: indicadores, desenhos e alertas. Esconda, remova ou abra as propriedades daqui."
          >
            <ObjectTree groups={gruposDeObjetos} />
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Indicadores"
            icon="indicator"
            badge={`${indicadores.active.length} ativo(s)`}
            hint="Insira, remova e configure os 29 indicadores. Os campos vêm do metadado de cada um."
          >
            {/*
              ⭐ ALTURA dos sub-painéis, em três degraus mais o automático.
              ⚠️ Um controle para o conjunto, não um por indicador: a pergunta do operador é
              "quero os osciladores discretos ou dominantes", e é uma decisão só. Um seletor
              por linha em 29 indicadores seria a parede de botões que este projeto evita.
            */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                marginBottom: 8,
              }}
            >
              <span style={{ opacity: 0.7 }}>Altura dos sub-painéis</span>
              <select
                value={alturaOsciladores === null ? 'auto' : String(alturaOsciladores)}
                onChange={(e) =>
                  setAlturaOsciladores(e.target.value === 'auto' ? null : Number(e.target.value))
                }
                style={{
                  background: 'rgba(15,23,42,0.6)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148,163,184,0.28)',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 4px',
                }}
              >
                <option value="0.07">Mínima</option>
                <option value="0.11">Baixa</option>
                <option value="0.18">Média</option>
                <option value="auto">Automática</option>
              </select>
            </label>
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
