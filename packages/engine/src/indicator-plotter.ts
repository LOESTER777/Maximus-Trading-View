/**
 * indicator-plotter — liga o CALCULO de um indicador ao DESENHO no motor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pacote `@robustus/charts-indicators` calcula series (RSI, MACD, Bollinger...)
 * e DECLARA, em `OutputSpec`, como cada saida quer ser desenhada: `plot`
 * (line/histogram/area/band) e `pane` (`'price'` sobre as velas, `'separate'`
 * numa faixa propria). Ele NAO desenha — nao conhece canvas.
 *
 * O motor desenha, mas nao conhece indicador. Este arquivo e a ponte: recebe
 * instancias de indicador + a serie de barras, calcula os pontos, le o descritor
 * e plota no lugar certo. E ele que faz a EMA aparecer sobre o preco e o RSI numa
 * faixa embaixo, SEM o motor importar o pacote de indicadores nem o pacote de
 * indicadores importar o motor. Cada um dos dois so conhece este ponto de costura.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUB-PAINEL: UMA PANE POR OSCILADOR ( com reuso)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um oscilador de 0..100 (RSI) sobre o preco de um indice de 130.000 pontos seria
 * uma linha reta colada na base — invisivel. Por isso vai em pane propria, com
 * escala propria. Duas SAIDAS do MESMO indicador (%K e %D do Stochastic, +DI/-DI/
 * ADX) compartilham a pane — sao a mesma leitura. Saidas de indicadores
 * DIFERENTES marcados como `separate` ganham panes separadas.
 *
 * ⚠️ `addPane` do motor cria a faixa; recriar pane a cada atualizacao de dado
 * seria caro e piscaria. Entao o plotter mantem o mapeamento
 * indicador->pane->series entre chamadas e so recria quando o CONJUNTO de
 * indicadores muda, nao quando o dado muda.
 */

import type { IChartApi, ISeriesApi, SeriesData, SeriesType } from '@robustus/chart-core';

// ═════════════════════════════════════════════════════════════════════════════
// O que o plotter consome do pacote de indicadores — por ESTRUTURA, nao import
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A forma minima de um indicador que o plotter precisa.
 *
 * Declarada aqui por ESTRUTURA em vez de importar `@robustus/charts-indicators`.
 * Assim `engine` nao passa a depender do pacote de indicadores: quem tem os dois
 * (a aplicacao, o binding React) injeta a instancia, e o motor continua util para
 * quem nao usa indicador nenhum. E o mesmo princIpio do datafeed injetado.
 */
export interface PlottableIndicator {
  readonly meta: {
    readonly name: string;
    readonly label: string;
    readonly outputs: readonly PlottableOutput[];
  };
  warmup(history: readonly PlottableBar[]): readonly PlottablePoint[];
}

export interface PlottableOutput {
  readonly key: string;
  readonly label: string;
  readonly plot: 'line' | 'histogram' | 'area' | 'band';
  readonly pane: 'price' | 'separate';
  readonly color?: string;
  readonly referenceLines?: readonly number[];
}

export interface PlottableBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

export interface PlottablePoint {
  readonly time: number;
  readonly values: Readonly<Record<string, number | null>>;
}

/** Um indicador a plotar, com uma cor base opcional por saida. */
export interface IndicatorPlot {
  readonly instance: PlottableIndicator;
  /** Cores por chave de saida; sobrescrevem a cor do descritor. */
  readonly colors?: Readonly<Record<string, string>>;
  /** Chave estavel para o plotter reconhecer o MESMO plot entre atualizacoes. */
  readonly id: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Paleta default por ordem — para o indicador nascer visivel sem configuracao
// ═════════════════════════════════════════════════════════════════════════════

const PALETA: readonly string[] = [
  '#38bdf8', // azul
  '#e9c46a', // ambar
  '#f472b6', // rosa
  '#a3e635', // lima
  '#c084fc', // roxo
  '#fb923c', // laranja
];

// ═════════════════════════════════════════════════════════════════════════════
// O plotter
// ═════════════════════════════════════════════════════════════════════════════

/** Uma serie viva criada pelo plotter, para atualizar ou remover. */
interface SerieViva {
  readonly plotId: string;
  readonly outputKey: string;
  readonly api: ISeriesApi<SeriesType>;
}

/** Uma pane de sub-painel criada pelo plotter. */
interface PaneViva {
  /** Chave = id do plot que pediu a pane (osciladores nao dividem pane entre si). */
  readonly plotId: string;
  readonly paneIndex: number;
}

/**
 * Plota indicadores num `IChartApi`, mantendo estado entre atualizacoes.
 *
 * Fluxo de uso: crie uma vez com o `chart`, chame `setPlots` quando o CONJUNTO de
 * indicadores mudar (adicionar/remover EMA), e `updateData` quando as BARRAS
 * mudarem (nova vela). Separar os dois e o que evita recriar pane e serie a cada
 * tick de preco.
 */
export class IndicatorPlotter {
  private readonly seriesVivas: SerieViva[] = [];
  private readonly panesVivas: PaneViva[] = [];
  private plots: readonly IndicatorPlot[] = [];
  private corSeq = 0;

  constructor(private readonly chart: IChartApi) {}

  /**
   * Define o CONJUNTO de indicadores. Recria series e panes.
   *
   * ⚠️ So chame quando o conjunto muda (indicador adicionado ou removido), nao a
   * cada barra. Recriar serie a cada tick piscaria e desperdicaria alocacao.
   */
  setPlots(plots: readonly IndicatorPlot[], history: readonly PlottableBar[]): void {
    // Remove tudo que existia: e mais simples e seguro que casar por diff, e o
    // conjunto de indicadores muda raramente (acao do usuario), nao por quadro.
    this.limpar();
    this.plots = plots;
    this.corSeq = 0;

    for (const plot of plots) {
      this.criarSeriesDoPlot(plot);
    }
    this.updateData(history);
  }

  /**
   * Recalcula e reaplica os dados. Chame quando as BARRAS mudarem.
   *
   * Reusa as series ja criadas — nao mexe em pane nem cria serie. Cada indicador
   * e recalculado por `warmup` sobre o historico corrente; para dado ao vivo o
   * consumidor passa o historico ja atualizado.
   */
  updateData(history: readonly PlottableBar[]): void {
    for (const plot of this.plots) {
      const pontos = plot.instance.warmup(history);
      for (const output of plot.instance.meta.outputs) {
        const serie = this.seriesVivas.find(
          (s) => s.plotId === plot.id && s.outputKey === output.key,
        );
        if (serie === undefined) continue;
        const dados = this.pontosParaSerie(pontos, output.key);
        serie.api.setData(dados);
      }
    }
  }

  /** Remove todos os indicadores. */
  clear(): void {
    this.limpar();
    this.plots = [];
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private criarSeriesDoPlot(plot: IndicatorPlot): void {
    // Uma pane por plot que tenha ALGUMA saida 'separate'. As saidas 'price' vao
    // direto no painel principal (indice 0).
    let paneDoPlot: number | null = null;
    const precisaPane = plot.instance.meta.outputs.some((o) => o.pane === 'separate');
    if (precisaPane) {
      paneDoPlot = this.chart.addPane();
      this.panesVivas.push({ plotId: plot.id, paneIndex: paneDoPlot });
    }

    for (const output of plot.instance.meta.outputs) {
      const paneIndex = output.pane === 'separate' ? (paneDoPlot ?? 0) : 0;
      const cor = plot.colors?.[output.key] ?? output.color ?? this.proximaCor();
      const tipo: SeriesType = output.plot === 'histogram' ? 'Histogram' : output.plot === 'area' ? 'Area' : 'Line';

      const api = this.chart.addSeries(
        tipo,
        {
          color: cor,
          lineWidth: 2,
          lastValueVisible: true,
          priceLineVisible: false,
        },
        paneIndex,
      );

      // Linhas de referencia (RSI 30/70, MACD 0) como linhas de preco tenues na
      // pane do indicador. Sao guia de leitura, nao dado — cor esmaecida.
      for (const ref of output.referenceLines ?? []) {
        try {
          api.createPriceLine({ price: ref, color: 'rgba(148,163,184,0.35)', lineStyle: 2 });
        } catch {
          // Linha de referencia e cosmetica; se a serie nao aceitar, seguimos.
        }
      }

      this.seriesVivas.push({ plotId: plot.id, outputKey: output.key, api });
    }
  }

  private pontosParaSerie(
    pontos: readonly PlottablePoint[],
    key: string,
  ): readonly SeriesData[] {
    const saida: SeriesData[] = [];
    for (const p of pontos) {
      const v = p.values[key];
      // `null` = aquecendo. Nao emite ponto: a linha comeca onde o indicador
      // passa a ter valor, em vez de uma reta no zero durante o aquecimento.
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      saida.push({ time: p.time, value: v } as unknown as SeriesData);
    }
    return saida;
  }

  private proximaCor(): string {
    const cor = PALETA[this.corSeq % PALETA.length] ?? '#94a3b8';
    this.corSeq += 1;
    return cor;
  }

  private limpar(): void {
    for (const s of this.seriesVivas) {
      try {
        this.chart.removeSeries(s.api);
      } catch {
        // Ja removida com a pane.
      }
    }
    this.seriesVivas.length = 0;
    // Remove as panes que este plotter criou — fecha a divida de "pane orfa" que
    // existia enquanto o motor nao tinha removePane. `removePane` ja desanexa as
    // series restantes e recompacta o layout; remover em ordem decrescente de
    // posicao nao e necessario porque o motor identifica por indice estavel, nao
    // por posicao.
    for (const pane of this.panesVivas) {
      try {
        this.chart.removePane(pane.paneIndex);
      } catch {
        // Motor sem a pane (ja removida) ou em descarte: no-op.
      }
    }
    this.panesVivas.length = 0;
  }
}
