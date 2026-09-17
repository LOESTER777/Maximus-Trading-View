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
  /**
   * Papel numa banda preenchida (Bollinger/Keltner). Ver `OutputSpec.band` no
   * pacote de indicadores — replicado aqui por ESTRUTURA, sem importar aquele
   * pacote. `'upper'`/`'lower'` marcam as bordas do preenchimento; `'middle'` a
   * linha central. Quando um plot tem upper+lower, o plotter cria UMA serie de
   * banda ('Band') alem das linhas.
   */
  readonly band?: 'upper' | 'lower' | 'middle';
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
  /**
   * Visibilidade inicial. Ausente = visivel.
   *
   * ⚠️ Isto e a visibilidade de PARTIDA, lida em `setPlots`. Depois disso quem manda
   * e `setVisible(id, ...)` — trocar este campo e chamar `setPlots` de novo recriaria
   * series e piscaria a tela, que e exatamente o que `setVisible` existe para evitar.
   */
  readonly visible?: boolean;
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

/**
 * Uma serie viva criada pelo plotter, para atualizar ou remover.
 *
 * Uma serie de linha/histograma/area guarda uma unica `outputKey`. Uma serie de
 * BANDA ('Band') guarda `upperKey`+`lowerKey` em vez de `outputKey` — ela e
 * alimentada por DUAS saidas do mesmo indicador, montadas em `{time, upper, lower}`.
 */
interface SerieViva {
  readonly plotId: string;
  /** Chave da saida para series de valor unico; vazia em series de banda. */
  readonly outputKey: string;
  readonly api: ISeriesApi<SeriesType>;
  /** Presente so em serie de banda: as chaves das bordas superior e inferior. */
  readonly band?: { readonly upperKey: string; readonly lowerKey: string };
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
  /**
   * Altura pedida por indicador, como fracao. Ver `setPaneHeight`.
   *
   * ⚠️ Guardada no plotter (e nao so no motor) porque `setPlots` recria as panes: sem isto,
   * adicionar um indicador novo devolveria todos os outros a altura automatica.
   */
  private readonly alturasPorPlot = new Map<string, number>();
  private plots: readonly IndicatorPlot[] = [];
  private corSeq = 0;
  /**
   * Cor EFETIVA por plot e saida — o que esta na tela agora.
   *
   * Existe porque a cor tem tres origens (paleta automatica, `output.color` do
   * descritor, `plot.colors` do consumidor) e depois `applyColors` a muda em runtime.
   * Sem um registro do valor efetivo, quem persiste o layout gravaria a cor
   * ORIGINAL e o operador perderia a que escolheu.
   */
  private readonly coresPorPlot = new Map<string, Record<string, string>>();
  /** Visibilidade corrente por plot. Ausente = visivel. */
  private readonly visiveis = new Map<string, boolean>();
  /**
   * O ultimo historico visto por `updateData`/`setPlots`.
   *
   * ⚠️ Guardado por REFERENCIA, sem copia: a serie de barras de um dia de pregao tem
   * dezenas de milhares de elementos, e copiar a cada tick seria mais caro que o
   * recalculo que este campo existe para permitir. O consumidor entrega array que ele
   * proprio nao muta (contrato do datafeed: barra nova produz array novo).
   */
  private ultimoHistorico: readonly PlottableBar[] | null = null;

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

    // ⚠️ Esquece cor e visibilidade dos plots que SAIRAM do conjunto. Guardar por id
    // e o que faz a escolha do operador sobreviver a um `setPlots` (ele adiciona um
    // segundo indicador e o primeiro nao "reacende"); mas guardar para SEMPRE faria um
    // id reaproveitado depois herdar a cor e o "escondido" de um indicador ja removido
    // — o operador adicionaria uma EMA nova que nasceria invisivel.
    const idsAtuais = new Set(plots.map((p) => p.id));
    for (const id of [...this.coresPorPlot.keys()]) {
      if (!idsAtuais.has(id)) this.coresPorPlot.delete(id);
    }
    for (const id of [...this.visiveis.keys()]) {
      if (!idsAtuais.has(id)) this.visiveis.delete(id);
    }
    for (const id of [...this.alturasPorPlot.keys()]) {
      if (!idsAtuais.has(id)) this.alturasPorPlot.delete(id);
    }

    for (const plot of plots) {
      this.criarSeriesDoPlot(plot);
    }
    this.updateData(history);

    // A visibilidade e reaplicada DEPOIS de tudo criado, porque colapsar pane precisa
    // que a pane exista, e `criarSeriesDoPlot` so a cria no seu turno.
    for (const plot of plots) {
      if (!this.isVisible(plot.id)) this.setVisible(plot.id, false);
    }
  }

  /**
   * Recalcula e reaplica os dados. Chame quando as BARRAS mudarem.
   *
   * Reusa as series ja criadas — nao mexe em pane nem cria serie. Cada indicador
   * e recalculado por `warmup` sobre o historico corrente; para dado ao vivo o
   * consumidor passa o historico ja atualizado.
   */
  updateData(history: readonly PlottableBar[]): void {
    // Guarda o historico para poder recalcular UM plot quando ele voltar a ficar
    // visivel (ver `setVisible`). Sem isso, reexibir um indicador mostraria os dados
    // congelados do instante em que foi escondido, e ele so se corrigiria na proxima
    // barra — num grafico parado, nunca.
    this.ultimoHistorico = history;

    for (const plot of this.plots) {
      // ⭐ Indicador ESCONDIDO nao e calculado. E a diferenca entre esconder e
      // "desenhar transparente": `warmup` percorre o historico inteiro, e com 20
      // indicadores desligados o custo por tick seria pago por algo que ninguem ve.
      if (!this.isVisible(plot.id)) continue;
      this.desenharPlot(plot, history);
    }
  }

  /** Calcula e aplica os dados de UM plot nas series vivas dele. */
  private desenharPlot(plot: IndicatorPlot, history: readonly PlottableBar[]): void {
    const pontos = plot.instance.warmup(history);

    // Series de valor unico (linha/histograma/area), casadas pela outputKey.
    for (const output of plot.instance.meta.outputs) {
      const serie = this.seriesVivas.find(
        (s) => s.plotId === plot.id && s.band === undefined && s.outputKey === output.key,
      );
      if (serie === undefined) continue;
      const dados = this.pontosParaSerie(pontos, output.key);
      serie.api.setData(dados);
    }

    // Serie(s) de banda deste plot: montadas de DUAS chaves (upper+lower).
    for (const serie of this.seriesVivas) {
      if (serie.plotId !== plot.id || serie.band === undefined) continue;
      const dados = this.pontosParaBanda(pontos, serie.band.upperKey, serie.band.lowerKey);
      serie.api.setData(dados);
    }
  }

  /**
   * ⭐ Troca a COR de um indicador SEM recriar serie, pane ou recalcular nada.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * O DEFEITO QUE ISTO FECHA
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * A cor entrava so em `addSeries`, na criacao. Logo mudar a cor de uma EMA exigia
   * chamar `setPlots` de novo, e `setPlots` **destroi e recria tudo**: remove as
   * series, remove as panes, recria, e reexecuta o `warmup` de TODOS os indicadores
   * sobre o historico inteiro. Custos medidos na pratica:
   *
   * - a tela **pisca** (um quadro sem o indicador entre o remove e o add);
   * - a pane do oscilador e recriada, o que **reenquadra a altura** — o operador
   *   perdia o tamanho que havia arrastado na divisoria;
   * - recalculo O(n) de cada indicador para uma mudanca puramente cosmetica.
   *
   * Era por isso que a UI so commitava cor no `blur`, para nao recriar a cada
   * movimento do seletor. Com este metodo a cor pode ser aplicada ao vivo.
   *
   * `chaves` mapeia `outputKey -> cor`. Chave desconhecida e ignorada em silencio
   * (o consumidor pode ter uma lista de cores mais velha que o indicador). Devolve
   * quantas series foram efetivamente repintadas — zero significa plot inexistente,
   * e o chamador pode decidir cair no `setPlots`.
   */
  applyColors(plotId: string, chaves: Readonly<Record<string, string>>): number {
    let pintadas = 0;
    const efetivas = this.coresPorPlot.get(plotId) ?? {};

    for (const serie of this.seriesVivas) {
      if (serie.plotId !== plotId) continue;

      // Serie de banda: a cor do preenchimento acompanha a BORDA SUPERIOR, a mesma
      // regra da criacao. Sem isso, mudar a cor das linhas deixaria a faixa com a cor
      // antiga e o indicador sairia bicolor.
      const chave = serie.band === undefined ? serie.outputKey : serie.band.upperKey;
      const cor = chaves[chave];
      if (cor === undefined) continue;

      try {
        serie.api.applyOptions({ color: cor });
        efetivas[chave] = cor;
        pintadas += 1;
      } catch {
        // Serie ja removida por outro caminho: nao e motivo para abortar as demais.
      }
    }

    if (pintadas > 0) this.coresPorPlot.set(plotId, efetivas);
    return pintadas;
  }

  /**
   * ⭐ Esconde ou mostra um indicador SEM recriar nada — e sem deixar buraco na tela.
   *
   * Duas metades, e a segunda e a que costuma ser esquecida:
   *
   * 1. as series do plot recebem `visible: false` (saem do desenho **e da
   *    autoescala** — ver `SeriesOptionsCommon.visible` no motor);
   * 2. se o plot tem pane propria (oscilador), a pane e **colapsada**. Sem isso o
   *    RSI escondido continuaria reservando a faixa dele, e o operador ganharia um
   *    retangulo de grade vazia em vez de devolver a altura ao preco.
   *
   * O estado fica registrado: `setPlots` posterior com o mesmo `id` **preserva** a
   * escolha do operador, em vez de reexibir o que ele acabou de esconder.
   *
   * ⚠️ Reexibir RECALCULA o plot na hora. Enquanto escondido ele nao e calculado
   * (`updateData` o pula), entao as series dele carregam os dados do instante em que
   * foi ocultado — sem o recalculo, o indicador voltaria defasado e so se corrigiria
   * na proxima barra, o que num grafico parado significa nunca.
   */
  setVisible(plotId: string, visible: boolean): void {
    const antes = this.isVisible(plotId);
    this.visiveis.set(plotId, visible);

    for (const serie of this.seriesVivas) {
      if (serie.plotId !== plotId) continue;
      try {
        serie.api.applyOptions({ visible });
      } catch {
        // Idem: serie orfa nao aborta o laco.
      }
    }

    const pane = this.panesVivas.find((p) => p.plotId === plotId);
    if (pane !== undefined) {
      try {
        this.chart.setPaneVisible(pane.paneIndex, visible);
      } catch {
        // Motor sem a pane (em descarte): no-op.
      }
    }

    // Voltou a aparecer: recalcula agora, com o historico corrente.
    if (visible && !antes && this.ultimoHistorico !== null) {
      const plot = this.plots.find((p) => p.id === plotId);
      if (plot !== undefined) this.desenharPlot(plot, this.ultimoHistorico);
    }
  }

  /**
   * ⭐ A ALTURA do sub-painel de um indicador, como fracao da altura util.
   *
   * Atende o pedido *"reducao de altura da secao do histograma"* sem o consumidor precisar
   * saber que existe indice de pane: ele fala em INDICADOR, que e o vocabulario dele.
   *
   * ⚠️ A fracao e GUARDADA aqui, e nao so repassada, por causa do ciclo de vida: `setPlots`
   * destroi e recria as panes, e a fracao pedida se perderia. Guardar faz o pedido
   * sobreviver a adicionar ou remover outro indicador.
   *
   * Indicador que plota sobre o PRECO (sem pane propria) e no-op: nao ha altura a definir.
   * `null` devolve a pane a reparticao automatica.
   */
  setPaneHeight(plotId: string, fracao: number | null): void {
    if (fracao === null) this.alturasPorPlot.delete(plotId);
    else this.alturasPorPlot.set(plotId, fracao);

    const pane = this.panesVivas.find((p) => p.plotId === plotId);
    if (pane === undefined) return;
    try {
      this.chart.setPaneHeightFraction(pane.paneIndex, fracao);
    } catch {
      // Motor sem a pane (em descarte) ou sem o metodo: no-op.
    }
  }

  /** A fracao pedida para o sub-painel de um indicador, ou `null`. */
  paneHeightOf(plotId: string): number | null {
    return this.alturasPorPlot.get(plotId) ?? null;
  }

  /** O indicador esta visivel? Plot desconhecido conta como visivel (o default). */
  isVisible(plotId: string): boolean {
    return this.visiveis.get(plotId) !== false;
  }

  /**
   * ⭐ De qual indicador e esta serie? `null` quando a serie nao e de indicador nenhum.
   *
   * E a segunda metade de "clicar no indicador abre as propriedades dele": o motor
   * responde QUAL SERIE esta sob o ponto (`chart.seriesAt`), e este metodo traduz a
   * serie para o ID do plot — a identidade que a interface conhece. O motor nao pode
   * fazer essa traducao (nao sabe o que e indicador) e a interface nao pode fazer a
   * geometria (nao tem as coordenadas). O plotter e o unico lugar que tem os dois lados.
   *
   * ⚠️ Compara por IDENTIDADE do handle, nao por indice de pane nem por cor. Pane e
   * cor sao compartilhaveis; o handle e unico por serie.
   */
  plotIdOfSeries(api: unknown): string | null {
    if (api === null || api === undefined) return null;
    for (const s of this.seriesVivas) {
      if (s.api === api) return s.plotId;
    }
    return null;
  }

  /**
   * A saida (`outputKey`) correspondente a uma serie, ou `null`.
   *
   * Util para a interface abrir as propriedades JA no campo certo — o operador clicou na
   * linha do `%D` do Stochastic, e e a cor do `%D` que ele quer mudar. Serie de banda
   * devolve a chave da borda superior, a mesma regra da cor.
   */
  outputKeyOfSeries(api: unknown): string | null {
    for (const s of this.seriesVivas) {
      if (s.api !== api) continue;
      return s.band === undefined ? s.outputKey : s.band.upperKey;
    }
    return null;
  }

  /**
   * As cores EFETIVAS de um plot, por chave de saida — inclusive as que a paleta
   * automatica escolheu.
   *
   * ⭐ E o que permite persistir a aparencia: sem isto, quem salva o layout so
   * conhece as cores que ELE passou, e um indicador que nasceu com cor da paleta
   * voltaria com outra cor na proxima sessao (a paleta e por ordem de insercao, e a
   * ordem muda quando o operador remove um indicador do meio).
   */
  colorsOf(plotId: string): Readonly<Record<string, string>> {
    return { ...(this.coresPorPlot.get(plotId) ?? {}) };
  }

  /** Remove todos os indicadores. */
  clear(): void {
    this.limpar();
    this.plots = [];
    // ⚠️ `clear` esvazia tambem a memoria de cor e visibilidade: sem isso um plot
    // recriado depois com o MESMO id herdaria em silencio a cor e o estado de
    // "escondido" de um indicador que o operador ja removeu — e ele adicionaria uma
    // EMA nova que nasceria invisivel, sem explicacao.
    this.coresPorPlot.clear();
    this.visiveis.clear();
    // Solta a referencia ao historico: sem isto o plotter descartado seguraria o array
    // de barras inteiro vivo, e um grafico desmontado impediria a coleta dele.
    this.ultimoHistorico = null;
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private criarSeriesDoPlot(plot: IndicatorPlot): void {
    // Visibilidade de partida. O estado JA REGISTRADO vence o campo do plot: se o
    // operador escondeu o RSI e depois adicionou uma EMA (novo `setPlots`), o RSI nao
    // pode reacender porque o consumidor mandou `visible` ausente na lista.
    if (!this.visiveis.has(plot.id) && plot.visible === false) {
      this.visiveis.set(plot.id, false);
    }

    // Uma pane por plot que tenha ALGUMA saida 'separate'. As saidas 'price' vao
    // direto no painel principal (indice 0).
    let paneDoPlot: number | null = null;
    const precisaPane = plot.instance.meta.outputs.some((o) => o.pane === 'separate');
    if (precisaPane) {
      paneDoPlot = this.chart.addPane();
      this.panesVivas.push({ plotId: plot.id, paneIndex: paneDoPlot });
      // Reaplica a altura pedida — a pane e NOVA e nasce na reparticao automatica.
      const alturaPedida = this.alturasPorPlot.get(plot.id);
      if (alturaPedida !== undefined) {
        try {
          this.chart.setPaneHeightFraction(paneDoPlot, alturaPedida);
        } catch {
          // Motor sem o metodo: a altura fica a automatica, sem derrubar a criacao.
        }
      }
    }

    // ⭐ Banda preenchida (Bollinger/Keltner): se este plot tem uma saida marcada
    // `band:'upper'` E uma `band:'lower'`, cria UMA serie de banda ('Band') a
    // partir das duas, ALEM das linhas. A banda entra ANTES das linhas para
    // renderizar por baixo delas (a ordem de desenho na pane segue a ordem de
    // insercao). O calculo do indicador nao muda — a banda so reagrupa saidas que
    // ja existem.
    const upperOut = plot.instance.meta.outputs.find((o) => o.band === 'upper');
    const lowerOut = plot.instance.meta.outputs.find((o) => o.band === 'lower');
    if (upperOut !== undefined && lowerOut !== undefined) {
      const paneIndex = upperOut.pane === 'separate' ? (paneDoPlot ?? 0) : 0;
      // Cor da faixa: herda a cor da borda superior, para o preenchimento
      // combinar com as linhas do mesmo indicador.
      const cor = this.registrarCor(plot, upperOut.key, upperOut.color);
      const apiBanda = this.chart.addSeries(
        'Band',
        {
          color: cor,
          priceLineVisible: false,
          lastValueVisible: false,
          // Nasce ja com a visibilidade corrente. `setPlots` tambem reaplica depois
          // (para colapsar a pane), mas criar visivel e esconder em seguida deixaria a
          // serie aparecer se algum quadro caisse entre as duas chamadas.
          visible: this.isVisible(plot.id),
        },
        paneIndex,
      );
      this.seriesVivas.push({
        plotId: plot.id,
        outputKey: '',
        api: apiBanda,
        band: { upperKey: upperOut.key, lowerKey: lowerOut.key },
      });
    }

    for (const output of plot.instance.meta.outputs) {
      const paneIndex = output.pane === 'separate' ? (paneDoPlot ?? 0) : 0;
      const cor = this.registrarCor(plot, output.key, output.color);
      const tipo: SeriesType = output.plot === 'histogram' ? 'Histogram' : output.plot === 'area' ? 'Area' : 'Line';

      const api = this.chart.addSeries(
        tipo,
        {
          color: cor,
          lineWidth: 2,
          lastValueVisible: true,
          priceLineVisible: false,
          visible: this.isVisible(plot.id),
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

  /**
   * Monta os pontos de uma serie de banda a partir de DUAS chaves de saida.
   *
   * So emite ponto quando AMBAS as bordas tem valor finito na mesma barra — a
   * faixa nao existe durante o aquecimento (uma borda ainda nula), e emitir com
   * metade dos dados desenharia uma faixa degenerada. `{time, upper, lower}` e o
   * formato que a serie 'Band' do motor consome.
   */
  private pontosParaBanda(
    pontos: readonly PlottablePoint[],
    upperKey: string,
    lowerKey: string,
  ): readonly SeriesData[] {
    const saida: SeriesData[] = [];
    for (const p of pontos) {
      const u = p.values[upperKey];
      const l = p.values[lowerKey];
      if (
        u === null ||
        l === null ||
        u === undefined ||
        l === undefined ||
        !Number.isFinite(u) ||
        !Number.isFinite(l)
      ) {
        continue;
      }
      saida.push({ time: p.time, upper: u, lower: l } as unknown as SeriesData);
    }
    return saida;
  }

  /**
   * Resolve a cor de uma saida e a REGISTRA como efetiva.
   *
   * Precedencia: cor pedida EXPLICITAMENTE pelo consumidor > cor ja em uso (de um
   * `applyColors` anterior no mesmo id) > cor do descritor > proxima da paleta.
   *
   * ⚠️ As duas primeiras posicoes sao a decisao que importa. Instrucao explicita tem
   * de vencer memoria — senao carregar um layout salvo com cor propria seria ignorado
   * em favor da cor da sessao anterior. Mas a memoria vence o resto: quando o
   * consumidor NAO cita a chave (o caso comum — ele remonta a lista de `plots` porque
   * o operador adicionou OUTRO indicador), a cor escolhida ao vivo sobrevive em vez
   * de reverter para a paleta.
   */
  private registrarCor(plot: IndicatorPlot, chave: string, corDoDescritor?: string): string {
    const efetivas = this.coresPorPlot.get(plot.id) ?? {};
    const cor = plot.colors?.[chave] ?? efetivas[chave] ?? corDoDescritor ?? this.proximaCor();
    efetivas[chave] = cor;
    this.coresPorPlot.set(plot.id, efetivas);
    return cor;
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
