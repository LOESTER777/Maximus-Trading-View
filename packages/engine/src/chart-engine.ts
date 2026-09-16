/**
 * chart-engine — o motor de grafico, SEM framework.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A peca que traduz o vocabulario proprio (`ChartPriceLine`, `ChartMarker`, ...)
 * para a API do motor `@robustus/chart-core` — o motor PROPRIO, em canvas, sem
 * nenhum terceiro. Anexa as camadas de bookmap, footprint e desenho.
 *
 * Nao ha React, Vue nem DOM alem do container que chega por parametro. A ligacao
 * com framework e outro pacote, e ela e fina de proposito: tudo que e dificil
 * mora aqui, onde pode ser testado sem montar componente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TRES ARMADILHAS QUE A ORIGEM PAGOU PARA DESCOBRIR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Nao destrua o grafico para trocar de periodo.**
 * Na origem o componente usava `key={timeframe}` no React, o que DESTRUIA e
 * recriava o grafico a cada troca — e produzia `Uncaught Error: Object is
 * disposed` de dentro do `resizeCanvasElement`, porque o observador de
 * redimensionamento ainda apontava para o canvas morto. A correcao foi manter o
 * grafico vivo e apenas reenquadrar: e o que `resetViewport()` faz.
 *
 * **2. Anexar a camada e atualizar a camada sao operacoes SEPARADAS.**
 * Fundir as duas recria a primitive a cada payload — e cada recriacao comeca sem
 * escala de cor, sem paleta e sem plano de desenho, o que faz a camada PISCAR a
 * cada atualizacao. Num dia corrente sao dezenas de atualizacoes por hora.
 * Aqui: `attachBookmap` cria uma vez, `setBookmapLayer` so chama `update()`.
 *
 * **3. `priceScale(id).width()` LANCA quando o id nao existe.**
 * Nao devolve `null`, nao devolve `0` — lanca. Como isso e consultado a cada
 * quadro pelo mapeador de coordenadas, uma escala de overlay ainda nao criada
 * derrubaria o laco de desenho. Daí o `try/catch` em `priceScaleWidthPx`.
 */

import {
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type PriceLineOptions,
  type SeriesData,
  type SeriesMarker,
  type SeriesOptionsCommon,
  type SeriesType,
  type Time,
} from '@robustus/chart-core';
import { BookmapPrimitive, FootprintPrimitive } from '@robustus/charts-primitives';
import {
  BOOKMAP_MAX_CELLS_DEFAULT,
  BOOKMAP_MIN_CELL_PX_DEFAULT,
  isValidCandle,
  type BookmapLayerInput,
  type ChartCandle,
  type ChartCoordinateMapper,
  type ChartHistogramBar,
  type ChartLineSeries,
  type ChartMarker,
  type ChartPriceLine,
  type FootprintLayerInput,
} from './types.js';

/** Identificador da escala do histograma de volume. */
const VOLUME_SCALE_ID = 'volume';

/**
 * Tipos de serie que a serie de PRECO pode assumir.
 *
 * ⭐ E um subconjunto do `SeriesType` do motor: so os que fazem sentido como a
 * serie principal de preco. `Histogram` fica de fora de proposito — ele e o
 * volume, uma grandeza distinta que vive na sua propria escala de overlay.
 */
export type PriceSeriesType = 'Candlestick' | 'Line' | 'Area' | 'Bar';

/** Opcoes de construcao do motor. */
export interface ChartEngineOptions {
  /**
   * Desenhar o histograma de volume.
   *
   * Quando ligado, o volume ocupa os 15% inferiores do MESMO painel, via
   * `scaleMargins` numa escala de overlay — nao um sub-painel de verdade.
   */
  readonly withVolume?: boolean;
  /** Espacamento inicial entre barras, em px. */
  readonly barSpacing?: number;
  /** Cores. Ausentes, adotam um tema escuro neutro. */
  readonly colors?: {
    readonly upColor?: string;
    readonly downColor?: string;
    readonly gridColor?: string;
    readonly textColor?: string;
  };
}

/**
 * Motor de grafico. Construa com `ChartEngine.create`.
 *
 * @example
 * const motor = ChartEngine.create(container, { withVolume: true });
 * motor.setCandles(velas);
 * motor.setPriceLines([{ price: 130_000, color: '#e9c46a', title: 'Alvo' }]);
 *
 * const parar = motor.onCoordinateMapperChange((m) => posicionarOverlays(m));
 *
 * // no desmonte:
 * parar();
 * motor.dispose();
 */
export class ChartEngine {
  private readonly chart: IChartApi;
  /** O elemento hospedeiro, guardado para quem precisa de pointer events. */
  private readonly host: HTMLElement;
  /**
   * A serie de PRECO. Nao e `readonly` nem fixa em `'Candlestick'`: pode trocar
   * de tipo em runtime via `setPriceSeriesType`.
   *
   * ⚠️ **O nome do campo continua `candleSeries` de proposito.** Um teste de
   * regressao alcanca a serie por esse nome (`(motor as ...).candleSeries`) para
   * espiar `removePriceLine`. Renomear quebraria esse acesso sem ganho real — o
   * tipo foi generalizado para `SeriesType`, que e o que muda de fato.
   */
  private candleSeries: ISeriesApi<SeriesType>;
  private readonly volumeSeries: ISeriesApi<'Histogram'> | null;

  /** Tipo corrente da serie de preco. Comparado em `setPriceSeriesType`. */
  private priceSeriesType: PriceSeriesType = 'Candlestick';
  /** Cores da serie de preco, guardadas para recriar a serie ao trocar de tipo. */
  private readonly priceColors: { readonly up: string; readonly down: string };

  /**
   * Velas correntes, ja filtradas.
   *
   * ⭐ Guardadas para poder REAPLICAR ao trocar de tipo de serie. Line/Area
   * consomem o `close` de cada vela como `value`; Candlestick/Bar consomem o OHLC
   * inteiro. Sem esta copia, trocar de tipo apagaria o grafico — a serie nova
   * nasce vazia.
   */
  private candles: readonly CandlestickData[] = [];
  /** Marcadores correntes, para reaplicar na serie nova ao trocar de tipo. */
  private markers: readonly SeriesMarker<Time>[] = [];
  /**
   * Configuracao das linhas de preco correntes, para recria-las na serie nova.
   *
   * ⚠️ Guardamos as OPCOES, nao os `IPriceLine` — o handle so vale na serie que o
   * criou. Ao trocar de serie, os handles velhos morrem com a serie antiga e
   * precisam ser recriados na nova a partir da configuracao.
   */
  private priceLineOptions: readonly PriceLineOptions[] = [];

  /** Linhas de preco vivas, para remover antes de aplicar o proximo conjunto. */
  private priceLines: IPriceLine[] = [];
  /** Series de linha vivas, indexadas pela ordem em que foram informadas. */
  private lineSeries: ISeriesApi<'Line'>[] = [];

  private bookmap: BookmapPrimitive | null = null;
  private footprint: FootprintPrimitive | null = null;

  /** Assinantes do mapeador de coordenadas. */
  private readonly mapperListeners = new Set<(m: ChartCoordinateMapper) => void>();
  /** Quadro agendado para emissao coalescida. `null` = nada agendado. */
  private frame: number | null = null;
  private disposed = false;

  private constructor(chart: IChartApi, host: HTMLElement, opts: ChartEngineOptions) {
    this.chart = chart;
    this.host = host;

    this.priceColors = {
      up: opts.colors?.upColor ?? '#16c784',
      down: opts.colors?.downColor ?? '#ea3943',
    };

    // API do motor proprio: o tipo de serie e uma STRING, nao uma factory. Foi
    // decisao do contrato — string nao tem dialeto entre versoes, factory sim.
    // A criacao passa pelo mesmo ponto que a troca de tipo em runtime, para as
    // cores e opcoes nao divergirem entre "criou como Candlestick" e "trocou para
    // Candlestick".
    this.candleSeries = this.createPriceSeries('Candlestick');

    if (opts.withVolume === true) {
      this.volumeSeries = chart.addSeries('Histogram', {
        priceFormat: { type: 'volume' },
        priceScaleId: VOLUME_SCALE_ID,
      });
      // Empurra o volume para a faixa inferior do MESMO painel. Nao e sub-painel.
      chart.priceScale(VOLUME_SCALE_ID).applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
    } else {
      this.volumeSeries = null;
    }

    // No motor proprio o marcador vive na propria serie (setMarkers), nao num
    // plugin separado — o plugin era um detalhe da API v5 de terceiro.

    // Emitir o mapeador a cada mudanca de janela visivel, coalescido por quadro:
    // pan continuo dispara o evento dezenas de vezes por segundo, e reposicionar
    // sobreposicao a cada disparo desperdicia trabalho que o navegador vai
    // descartar no mesmo quadro.
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.scheduleEmit);
  }

  /**
   * Cria o motor sobre um elemento do DOM.
   *
   * O container precisa ter dimensao no momento da chamada. Container com altura
   * zero produz grafico invisivel sem erro algum — se acontecer, o problema esta
   * no CSS, nao aqui.
   */
  static create(container: HTMLElement, opts: ChartEngineOptions = {}): ChartEngine {
    const chart = createChart(container, {
      layout: {
        // Fundo transparente para o consumidor decidir o tema por CSS.
        background: { color: 'transparent' },
        textColor: opts.colors?.textColor ?? '#94a3b8',
      },
      grid: {
        // Só linha horizontal: a vertical compete visualmente com as velas e não
        // acrescenta leitura num gráfico de preço.
        vertLines: { visible: false },
        horzLines: { visible: true, color: opts.colors?.gridColor ?? 'rgba(148,163,184,0.10)' },
      },
      crosshair: { mode: 0 },
      timeScale: {
        rightOffset: 12,
        barSpacing: opts.barSpacing ?? 8,
        minBarSpacing: 3,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      autoSize: true,
    });

    return new ChartEngine(chart, container, opts);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dado
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Aplica o conjunto de velas.
   *
   * Filtra vela inutilizavel na entrada — ver `isValidCandle` para o defeito
   * concreto que isso evita. O filtro e silencioso de proposito: dado de mercado
   * com buraco e normal, e avisar a cada vela descartada encheria o console no
   * momento em que ele mais precisa estar legivel.
   */
  setCandles(candles: readonly unknown[]): void {
    if (this.disposed) return;
    const validas = candles.filter(isValidCandle) as unknown as CandlestickData[];
    // Guarda as velas correntes para reaplicar ao trocar de tipo de serie: Line/
    // Area precisam do `close`, Candlestick/Bar do OHLC, e a serie nova nasce
    // vazia.
    this.candles = validas;
    this.applyCandlesToPriceSeries();
    this.scheduleEmit();
  }

  /**
   * Escreve as velas correntes na serie de preco, no formato que o tipo dela pede.
   *
   * ⭐ Candlestick/Bar recebem o OHLC como esta; Line/Area recebem pontos
   * `{time, value}` derivados do `close`. E o unico ponto que conhece essa
   * traducao, chamado tanto no `setCandles` quanto na troca de tipo.
   */
  private applyCandlesToPriceSeries(): void {
    if (this.priceSeriesType === 'Line' || this.priceSeriesType === 'Area') {
      const pontos = this.candles.map((c) => ({ time: c.time, value: c.close }));
      this.candleSeries.setData(pontos as unknown as SeriesData[]);
    } else {
      this.candleSeries.setData(this.candles as unknown as SeriesData[]);
    }
  }

  /** Aplica o histograma de volume. Sem efeito se o motor foi criado sem volume. */
  setVolume(bars: readonly ChartHistogramBar[]): void {
    if (this.disposed || this.volumeSeries === null) return;
    this.volumeSeries.setData(
      bars.filter((b) => Number.isFinite(b.time) && Number.isFinite(b.value)) as never,
    );
  }

  /**
   * Substitui o conjunto de linhas de preco.
   *
   * Remove as anteriores antes de criar as novas. O substrato nao tem "aplicar
   * conjunto" para linha de preco — sem a remocao, cada chamada ACUMULA, e a tela
   * vai enchendo de linha fantasma que nada remove.
   */
  setPriceLines(lines: readonly ChartPriceLine[]): void {
    if (this.disposed) return;
    for (const linha of this.priceLines) {
      try {
        this.candleSeries.removePriceLine(linha);
      } catch {
        // Serie ja descartada: nada a remover, e nada a relatar.
      }
    }
    // Guarda as OPCOES resolvidas (nao os handles): ao trocar de tipo de serie,
    // os handles morrem com a serie antiga e precisam ser recriados na nova a
    // partir desta configuracao.
    this.priceLineOptions = lines
      .filter((l) => Number.isFinite(l.price))
      .map((l) => ({
        price: l.price,
        color: l.color,
        lineWidth: l.lineWidth ?? 1,
        lineStyle: l.lineStyle ?? 0,
        axisLabelVisible: l.axisLabelVisible ?? true,
        title: l.title ?? '',
      }));
    this.priceLines = this.priceLineOptions.map((o) => this.candleSeries.createPriceLine(o));
  }

  /**
   * Substitui o conjunto de series de linha.
   *
   * Recria as series. Como as linhas mudam de QUANTIDADE entre atualizacoes
   * (Fibonacci muda de niveis, alvos aparecem e somem), reaproveitar por indice
   * deixaria serie orfa com dado velho na tela.
   */
  setLineSeries(series: readonly ChartLineSeries[]): void {
    if (this.disposed) return;
    for (const s of this.lineSeries) {
      try {
        this.chart.removeSeries(s);
      } catch {
        // Ja removida.
      }
    }
    this.lineSeries = series.map((cfg) => {
      const s = this.chart.addSeries('Line', {
        color: cfg.color,
        lineWidth: cfg.lineWidth ?? 1,
        priceScaleId: cfg.priceScaleId ?? 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      s.setData(
        cfg.data.filter(
          (p) => Number.isFinite(p.time) && Number.isFinite(p.value),
        ) as unknown as SeriesData[],
      );
      // Escala de overlay pedida pelo consumidor: dar margem para nao colar nas
      // bordas. Sem isto a linha encosta no topo e na base do painel.
      if (cfg.priceScaleId !== undefined && cfg.priceScaleId !== 'right') {
        try {
          this.chart
            .priceScale(cfg.priceScaleId)
            .applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
        } catch {
          // Escala inexistente: o substrato a cria com a serie, mas a ordem
          // varia entre versoes. Sem margem e degradacao aceitavel.
        }
      }
      return s;
    });
  }

  /** Substitui o conjunto de marcadores. */
  setMarkers(markers: readonly ChartMarker[]): void {
    if (this.disposed) return;
    // No motor proprio o marcador vive na serie, nao num plugin.
    // Guarda o conjunto mapeado para reaplicar na serie nova ao trocar de tipo.
    this.markers = markers
      .filter((m) => Number.isFinite(m.time))
      .map((m) => ({
        time: m.time as Time,
        position: m.position,
        color: m.color,
        shape: m.shape,
        ...(m.text === undefined ? {} : { text: m.text }),
        ...(m.size === undefined ? {} : { size: m.size }),
      })) as SeriesMarker<Time>[];
    this.candleSeries.setMarkers(this.markers);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tipo da serie de preco
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cria uma serie de preco do tipo pedido, com as opcoes de cor coerentes.
   *
   * ⭐ Ponto UNICO de criacao da serie de preco — usado pelo construtor e pela
   * troca de tipo. Candlestick e Bar usam `upColor`/`downColor` (a direcao pinta
   * a vela/barra); Line e Area usam uma unica `color` de traco. Nao ha `throw`:
   * `addSeries` do motor sempre devolve uma serie.
   */
  private createPriceSeries(type: PriceSeriesType): ISeriesApi<SeriesType> {
    const { up, down } = this.priceColors;
    let options: Partial<SeriesOptionsCommon>;
    if (type === 'Candlestick' || type === 'Bar') {
      options = {
        upColor: up,
        downColor: down,
        borderVisible: false,
        wickUpColor: up,
        wickDownColor: down,
      };
    } else {
      // Line/Area: uma cor de traco so. Reaproveita a cor de ALTA como cor da
      // linha — e a cor "positiva" do tema, a escolha natural para o traco unico.
      options = { color: up, lineWidth: 2 };
    }
    return this.chart.addSeries(type, options);
  }

  /**
   * Troca o tipo da serie de preco em runtime, SEM recriar o grafico nem perder a
   * viewport.
   *
   * ⚠️ **Nao chama `resetViewport`.** Trocar o desenho das mesmas velas nao e
   * trocar de dado — o operador quer ver o MESMO trecho, so desenhado de outro
   * jeito. Reenquadrar aqui seria um salto de camera que ninguem pediu.
   *
   * ⭐ Reaplica tudo que estava preso a serie antiga: velas (no formato do novo
   * tipo), marcadores, linhas de preco e as camadas (bookmap/footprint). A serie
   * antiga e removida do motor; os handles de linha de preco morrem com ela e sao
   * recriados a partir da configuracao guardada.
   *
   * No-op se o tipo pedido ja for o corrente — evita o custo de recriar a serie e
   * o piscar das camadas por nada.
   */
  setPriceSeriesType(type: PriceSeriesType): void {
    if (this.disposed || type === this.priceSeriesType) return;

    const antiga = this.candleSeries;

    // Cria a nova ANTES de remover a antiga: o eixo de tempo reconstroi a partir
    // da serie de preco mais longa da pane, e ter a nova ja com dado evita um
    // quadro intermediario com o eixo vazio.
    this.priceSeriesType = type;
    this.candleSeries = this.createPriceSeries(type);
    this.applyCandlesToPriceSeries();
    this.candleSeries.setMarkers(this.markers);

    // Recria as linhas de preco na serie nova a partir das opcoes guardadas: os
    // handles antigos so valiam na serie que os criou.
    this.priceLines = this.priceLineOptions.map((o) => this.candleSeries.createPriceLine(o));

    // Move as camadas de canvas para a serie nova. Desanexa da antiga (que sera
    // removida) e anexa na nova, preservando a instancia — recriar faria piscar,
    // igual a disciplina de `setBookmapLayer`.
    if (this.bookmap !== null) {
      try {
        antiga.detachPrimitive(this.bookmap);
      } catch {
        // Serie antiga em descarte: nada a desanexar.
      }
      this.candleSeries.attachPrimitive(this.bookmap);
    }
    if (this.footprint !== null) {
      try {
        antiga.detachPrimitive(this.footprint);
      } catch {
        // Idem.
      }
      this.candleSeries.attachPrimitive(this.footprint);
    }

    // Agora remove a serie antiga do motor.
    try {
      this.chart.removeSeries(antiga);
    } catch {
      // Ja removida.
    }

    // O mapeador de coordenada aponta para a serie corrente; reemite para os
    // assinantes reposicionarem sobreposicoes contra a serie nova.
    this.scheduleEmit();
  }

  /** O tipo corrente da serie de preco. */
  get currentPriceSeriesType(): PriceSeriesType {
    return this.priceSeriesType;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Camadas de canvas
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Liga, atualiza ou desliga a camada de livro.
   *
   * ⚠️ **A primitive e criada UMA vez e depois so atualizada.** Recria-la a cada
   * payload faria a camada piscar, porque toda instancia nova comeca sem escala
   * de cor, sem paleta e sem plano de desenho. Ver a nota 2 no cabecalho.
   *
   * `null` desliga sem desanexar: a propria camada passa a devolver `null` no
   * renderizador e o substrato deixa de chamar a passada de desenho. E mais
   * barato que desanexar e anexar de novo, e preserva a escala corrente.
   */
  setBookmapLayer(layer: BookmapLayerInput | null): void {
    if (this.disposed) return;

    if (layer === null) {
      this.bookmap?.update({ grid: null });
      return;
    }

    const opcoes = {
      ...layer,
      maxCells: layer.maxCells ?? BOOKMAP_MAX_CELLS_DEFAULT,
      minCellPx: layer.minCellPx ?? BOOKMAP_MIN_CELL_PX_DEFAULT,
    };

    if (this.bookmap === null) {
      this.bookmap = new BookmapPrimitive(opcoes);
      this.candleSeries.attachPrimitive(this.bookmap);
      return;
    }
    this.bookmap.update(opcoes);
  }

  /** Liga, atualiza ou desliga a camada de footprint. Mesma disciplina do bookmap. */
  setFootprintLayer(layer: FootprintLayerInput | null): void {
    if (this.disposed) return;

    if (layer === null) {
      this.footprint?.update({ velas: [] });
      return;
    }

    if (this.footprint === null) {
      this.footprint = new FootprintPrimitive(layer);
      this.candleSeries.attachPrimitive(this.footprint);
      return;
    }
    this.footprint.update(layer);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Coordenadas
  // ═══════════════════════════════════════════════════════════════════════════

  /** O mapeador de coordenadas no estado atual do grafico. */
  coordinateMapper(): ChartCoordinateMapper {
    const chart = this.chart;
    const series = this.candleSeries;

    return {
      priceToY: (price) => {
        if (!Number.isFinite(price)) return null;
        const y = series.priceToCoordinate(price);
        return y === null || !Number.isFinite(y) ? null : y;
      },

      timeToX: (timestampMs) => {
        if (!Number.isFinite(timestampMs)) return null;
        // O substrato trabalha em SEGUNDOS; a entrada aqui e em milissegundos.
        // A conversao e explicita neste ponto justamente para o consumidor nao
        // precisar lembrar qual lado usa qual unidade.
        const x = chart.timeScale().timeToCoordinate((timestampMs / 1000) as Time);
        return x === null || !Number.isFinite(x) ? null : x;
      },

      visibleTimeRangeSec: () => {
        const faixa = chart.timeScale().getVisibleRange();
        if (faixa === null) return null;
        const de = Number(faixa.from);
        const ate = Number(faixa.to);
        // Escala horizontal pode nao ser numerica (o substrato admite tempo em
        // string). Nesse caso nao ha faixa em segundos, e `null` e a resposta
        // honesta — nao `0`, que pareceria "comeco do epoch".
        if (!Number.isFinite(de) || !Number.isFinite(ate)) return null;
        return { fromSec: de, toSec: ate };
      },

      priceScaleWidthPx: () => {
        try {
          const w = chart.priceScale('right').width();
          return Number.isFinite(w) ? w : null;
        } catch {
          // ⚠️ `width()` LANCA quando o id nao existe — nao devolve null nem 0.
          // Ver a nota 3 no cabecalho: isto e consultado a cada quadro.
          return null;
        }
      },
    };
  }

  /**
   * Assina mudancas do mapeador (pan, zoom, novo dado).
   *
   * Emite uma vez de imediato, para o assinante nao precisar de um primeiro pan
   * para posicionar as sobreposicoes.
   *
   * @returns funcao de cancelamento; chamar duas vezes e seguro.
   */
  onCoordinateMapperChange(listener: (m: ChartCoordinateMapper) => void): () => void {
    this.mapperListeners.add(listener);

    if (!this.disposed) {
      // ⚠️ O `try` aqui NAO e simetria decorativa com `scheduleEmit`.
      //
      // Sem ele, o caminho AGENDADO tolera assinante que lanca e o caminho
      // IMEDIATO nao — o mesmo defeito do consumidor seria engolido durante um
      // pan e propagado no momento da assinatura. Pior: propagado de dentro de
      // `onCoordinateMapperChange`, que o chamador nao espera que execute nada.
      //
      // Foi exatamente esta assimetria que o teste "assinante que lanca nao
      // impede os demais de receber" pegou.
      try {
        listener(this.coordinateMapper());
      } catch {
        // Defeito de quem assina nao vira defeito de quem publica.
      }
    }

    return () => {
      this.mapperListeners.delete(listener);
    };
  }

  private readonly scheduleEmit = (): void => {
    if (this.disposed || this.frame !== null) return;
    // `requestAnimationFrame` quando existir; `setTimeout(0)` como saida para
    // ambiente sem ele (Node, SSR, teste). Sem a saida, o motor so funcionaria
    // no navegador.
    const agendar =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void): number => setTimeout(cb, 0) as unknown as number;

    this.frame = agendar(() => {
      this.frame = null;
      if (this.disposed) return;
      const mapa = this.coordinateMapper();
      for (const l of this.mapperListeners) {
        try {
          l(mapa);
        } catch {
          // Assinante que lanca nao pode impedir os outros de receber, nem
          // derrubar o quadro.
        }
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Ciclo de vida
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reenquadra para caber o conjunto atual.
   *
   * ⚠️ **Use isto para trocar de periodo — nao destrua e recrie o motor.** Ver a
   * nota 1 no cabecalho: recriar produz `Object is disposed` de dentro do
   * observador de redimensionamento.
   */
  resetViewport(): void {
    if (this.disposed) return;
    this.chart.timeScale().fitContent();
  }

  /** Acesso ao grafico do substrato, para o que o motor ainda nao cobre. */
  get api(): IChartApi {
    return this.chart;
  }

  /**
   * A serie de preco, para anexar camada propria.
   *
   * Exposta para que pacotes OPCIONAIS — as ferramentas de desenho, por exemplo —
   * possam anexar primitives sem que o motor precise depender deles. Se o motor
   * importasse `@robustus/charts-drawings`, toda aplicacao pagaria o peso do
   * desenho mesmo sem usar.
   */
  get priceSeries(): ISeriesApi<SeriesType> {
    return this.candleSeries;
  }

  /**
   * O elemento que hospeda o grafico.
   *
   * Necessario para quem precisa de pointer events do DOM — o substrato expoe
   * `click` e `dblClick`, e nada de arrasto. Sem acesso ao container nao ha como
   * implementar gesto de arrastar.
   */
  get container(): HTMLElement {
    return this.host;
  }

  /** O motor ja foi descartado? */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Descarta o grafico e libera tudo. Idempotente.
   *
   * A ordem importa: cancelar o quadro agendado ANTES de remover o grafico. Ao
   * contrario, o quadro dispara depois do descarte e consulta um grafico morto —
   * que e exatamente a familia de erro descrita na nota 1.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
      else clearTimeout(this.frame as unknown as ReturnType<typeof setTimeout>);
      this.frame = null;
    }

    this.mapperListeners.clear();

    try {
      this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.scheduleEmit);
    } catch {
      // Grafico ja em descarte.
    }

    this.bookmap = null;
    this.footprint = null;
    this.priceLines = [];
    this.lineSeries = [];
    this.candles = [];
    this.markers = [];
    this.priceLineOptions = [];

    try {
      this.chart.remove();
    } catch {
      // Remover duas vezes lanca; idempotencia e o contrato deste metodo.
    }
  }
}
