/**
 * IndicatorPlotter — trocar COR e esconder INDICADOR sem recriar nada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS DUAS LIMITACOES QUE ISTO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Cor.** Era lida so em `criarSeriesDoPlot`. Trocar a cor de uma EMA exigia
 * `setPlots`, que remove e recria TODAS as series e panes e reexecuta o `warmup` de
 * cada indicador. Custos: a tela piscava, a pane do oscilador voltava a altura
 * default (perdendo o tamanho que o operador arrastou na divisoria) e havia recalculo
 * O(n) por uma mudanca puramente cosmetica. Era por isso que a interface commitava
 * cor no `blur`.
 *
 * **2. Visibilidade.** O motor nao sabia esconder serie, entao "desligar" um
 * indicador era DESTRUI-LO, e religar recriava tudo. E o estado salvo perdia o
 * indicador desligado por completo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS MEDEM — MECANISMO, NAO SINTOMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `IChartApi` falso conta `addSeries`, `removeSeries`, `addPane`, `removePane` e
 * `setPaneVisible`, e registra as opcoes aplicadas por serie. As afirmacoes centrais
 * sao NEGATIVAS — "nenhuma serie foi criada", "nenhuma pane removida" — porque o
 * defeito era justamente a criacao/destruicao acontecer. Cada uma vem com guarda de
 * vacuidade (a cor MUDOU, a pane COLAPSOU), senao um plotter que nao fizesse nada
 * passaria verde.
 */
import { describe, expect, it } from 'vitest';
import { IndicatorPlotter, type PlottableIndicator } from '../indicator-plotter.js';
import type { SeriesData, SeriesOptionsCommon, SeriesType } from '@robustus/chart-core';

// ═════════════════════════════════════════════════════════════════════════════
// IChartApi falso, com contagem de ciclo de vida
// ═════════════════════════════════════════════════════════════════════════════

interface SerieRegistrada {
  readonly tipo: SeriesType;
  opcoes: Partial<SeriesOptionsCommon>;
  dados: readonly SeriesData[];
  readonly paneIndex: number;
  removida: boolean;
  /**
   * O HANDLE devolvido ao plotter.
   *
   * ⚠️ Guardado porque `plotIdOfSeries` compara por IDENTIDADE do handle — é o mesmo
   * objeto que `chart.seriesAt` devolveria no navegador. Sem ele, o teste da identidade
   * teria de reconstruir o handle e mediria outra coisa.
   */
  handle: unknown;
}

interface Contagem {
  addSeries: number;
  removeSeries: number;
  addPane: number;
  removePane: number;
  setPaneVisible: Array<{ index: number; visible: boolean }>;
}

function chartFalso() {
  const series: SerieRegistrada[] = [];
  const panesVisiveis = new Map<number, boolean>();
  const contagem: Contagem = {
    addSeries: 0,
    removeSeries: 0,
    addPane: 0,
    removePane: 0,
    setPaneVisible: [],
  };
  let nextPane = 1;

  const api = {
    addSeries(tipo: SeriesType, opts: Partial<SeriesOptionsCommon> = {}, paneIndex = 0) {
      contagem.addSeries += 1;
      const reg: SerieRegistrada = {
        tipo,
        opcoes: { ...opts },
        dados: [],
        paneIndex,
        removida: false,
        handle: null,
      };
      series.push(reg);
      const handle = {
        setData(d: readonly SeriesData[]) {
          reg.dados = d;
        },
        applyOptions(o: Partial<SeriesOptionsCommon>) {
          reg.opcoes = { ...reg.opcoes, ...o };
        },
        createPriceLine() {
          return { _id: 'x' };
        },
        _reg: reg,
      };
      reg.handle = handle;
      return handle as never;
    },
    removeSeries(handle: { _reg?: SerieRegistrada }) {
      contagem.removeSeries += 1;
      if (handle._reg !== undefined) handle._reg.removida = true;
    },
    addPane() {
      contagem.addPane += 1;
      const i = nextPane++;
      panesVisiveis.set(i, true);
      return i;
    },
    removePane(index: number) {
      contagem.removePane += 1;
      panesVisiveis.delete(index);
    },
    setPaneVisible(index: number, visible: boolean) {
      contagem.setPaneVisible.push({ index, visible });
      panesVisiveis.set(index, visible);
    },
    isPaneVisible(index: number) {
      return panesVisiveis.get(index) === true;
    },
  };
  return { api: api as never, series, contagem, panesVisiveis };
}

// ═════════════════════════════════════════════════════════════════════════════
// Indicadores falsos — o plotter os consome por ESTRUTURA
// ═════════════════════════════════════════════════════════════════════════════

/** Conta quantas vezes o `warmup` foi chamado: e o custo de recalcular. */
interface IndicadorFalso extends PlottableIndicator {
  warmups: number;
}

function indicadorSobrePreco(nome = 'ema'): IndicadorFalso {
  const ind = {
    warmups: 0,
    meta: {
      name: nome,
      label: nome.toUpperCase(),
      outputs: [{ key: 'value', label: 'Valor', plot: 'line' as const, pane: 'price' as const }],
    },
    warmup(history: readonly { time: number; close: number }[]) {
      ind.warmups += 1;
      return history.map((b) => ({ time: b.time, values: { value: b.close } }));
    },
  };
  return ind as unknown as IndicadorFalso;
}

function indicadorEmSubPainel(nome = 'rsi'): IndicadorFalso {
  const ind = {
    warmups: 0,
    meta: {
      name: nome,
      label: nome.toUpperCase(),
      outputs: [{ key: 'v', label: 'V', plot: 'line' as const, pane: 'separate' as const }],
    },
    warmup(history: readonly { time: number; close: number }[]) {
      ind.warmups += 1;
      return history.map((b) => ({ time: b.time, values: { v: 50 } }));
    },
  };
  return ind as unknown as IndicadorFalso;
}

function velas(n: number) {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i;
    return { time: t0 + i * 60, open: close, high: close + 1, low: close - 1, close };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Cor
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐ applyColors — repinta sem recriar serie nem recalcular', () => {
  it('muda a cor da serie viva e NAO cria nem remove serie nenhuma', () => {
    const { api, series, contagem } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind, colors: { value: '#111111' } }], velas(30));

    const criadasAntes = contagem.addSeries;
    const warmupsAntes = ind.warmups;
    expect(series[0]!.opcoes.color).toBe('#111111');

    const pintadas = plotter.applyColors('ema20', { value: '#ff00ff' });

    // Guarda de vacuidade: a cor MUDOU de fato.
    expect(pintadas).toBe(1);
    expect(series[0]!.opcoes.color).toBe('#ff00ff');
    // ⭐ As afirmacoes que pegam o defeito: nada foi criado, nada removido, nada
    // recalculado. Era exatamente isso que `setPlots` fazia por uma troca de cor.
    expect(contagem.addSeries).toBe(criadasAntes);
    expect(contagem.removeSeries).toBe(0);
    expect(ind.warmups).toBe(warmupsAntes);
  });

  it('chave desconhecida e ignorada em silencio, sem tocar nas outras', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots(
      [{ id: 'ema20', instance: indicadorSobrePreco(), colors: { value: '#111111' } }],
      velas(30),
    );

    // Uma lista de cores mais velha que o indicador (saida renomeada) nao pode quebrar.
    expect(plotter.applyColors('ema20', { chave_que_nao_existe: '#abcdef' })).toBe(0);
    expect(series[0]!.opcoes.color).toBe('#111111');
  });

  it('plot inexistente devolve 0 — o chamador decide se cai no setPlots', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));
    expect(plotter.applyColors('nao-existe', { value: '#000000' })).toBe(0);
  });

  /**
   * ⭐ `colorsOf` conhece a cor da PALETA, que ninguem mais conhece.
   *
   * Indicador adicionado sem cor recebe uma da paleta por ORDEM DE INSERCAO. Essa cor
   * nao existe no estado do consumidor; salvar o layout sem consultar isto guardaria
   * "sem cor", e na sessao seguinte a ordem seria outra (o operador removeu um
   * indicador do meio) e o mesmo indicador voltaria com cor diferente.
   */
  it('colorsOf reporta a cor EFETIVA, inclusive a escolhida pela paleta', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));

    const daPaleta = plotter.colorsOf('ema20').value;
    expect(typeof daPaleta).toBe('string');
    expect(daPaleta).toBe(series[0]!.opcoes.color);

    plotter.applyColors('ema20', { value: '#123456' });
    expect(plotter.colorsOf('ema20').value).toBe('#123456');
  });

  it('colorsOf devolve COPIA — mutar o retorno nao contamina o plotter', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));

    const copia = plotter.colorsOf('ema20') as Record<string, string>;
    const original = copia.value;
    copia.value = '#deadbe';
    expect(plotter.colorsOf('ema20').value).toBe(original);
  });

  /**
   * ⚠️ Instrucao EXPLICITA vence memoria; ausencia de instrucao deixa a memoria valer.
   *
   * Sem a primeira metade, carregar um layout salvo com cor propria seria ignorado em
   * favor da cor da sessao. Sem a segunda, um `setPlots` disparado por outro motivo (o
   * operador adicionou um segundo indicador) reverteria a cor escolhida ao vivo.
   */
  it('setPlots posterior PRESERVA a cor aplicada ao vivo quando nao a cita', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));
    plotter.applyColors('ema20', { value: '#abcdef' });

    // Novo conjunto, sem citar cor nenhuma — o caso comum.
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));
    const viva = series.find((s) => !s.removida)!;
    expect(viva.opcoes.color).toBe('#abcdef');
  });

  it('setPlots que CITA a cor vence a memoria (layout salvo tem de mandar)', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));
    plotter.applyColors('ema20', { value: '#abcdef' });

    plotter.setPlots([{ id: 'ema20', instance: ind, colors: { value: '#00ff00' } }], velas(30));
    const viva = series.find((s) => !s.removida)!;
    expect(viva.opcoes.color).toBe('#00ff00');
  });

  it('clear esquece a cor — id reaproveitado nao herda aparencia de indicador removido', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));
    plotter.applyColors('ema20', { value: '#abcdef' });

    plotter.clear();
    expect(plotter.colorsOf('ema20')).toEqual({});
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Visibilidade
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐ setVisible — esconde sem destruir, colapsa a pane e para de calcular', () => {
  it('aplica visible nas series e NAO remove nada', () => {
    const { api, series, contagem } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));

    plotter.setVisible('ema20', false);

    expect(series[0]!.opcoes.visible).toBe(false);
    expect(series[0]!.removida).toBe(false);
    expect(contagem.removeSeries).toBe(0);
    expect(contagem.removePane).toBe(0);
    expect(plotter.isVisible('ema20')).toBe(false);
  });

  /**
   * ⭐ A metade que se esquece: a PANE.
   *
   * Esconder as series do oscilador sem colapsar a faixa deixaria um retangulo de
   * grade vazia ocupando altura. E `setPaneVisible`, nao `removePane`: colapsar
   * preserva a serie, a cor e a linha de referencia.
   */
  it('colapsa a pane do oscilador — e nao a REMOVE', () => {
    const { api, contagem, panesVisiveis } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'rsi', instance: indicadorEmSubPainel() }], velas(30));
    expect(contagem.addPane).toBe(1);

    plotter.setVisible('rsi', false);
    expect(contagem.setPaneVisible).toEqual([{ index: 1, visible: false }]);
    expect(panesVisiveis.get(1)).toBe(false);
    expect(contagem.removePane).toBe(0);

    plotter.setVisible('rsi', true);
    expect(panesVisiveis.get(1)).toBe(true);
  });

  /**
   * ⭐ Indicador escondido nao e CALCULADO.
   *
   * E a diferenca entre esconder e "desenhar transparente": `warmup` percorre o
   * historico inteiro, e com 20 indicadores desligados o custo por tick seria pago por
   * algo que ninguem ve.
   */
  it('escondido sai do recalculo por barra', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));

    plotter.setVisible('ema20', false);
    const antes = ind.warmups;
    plotter.updateData(velas(31));
    plotter.updateData(velas(32));
    expect(ind.warmups).toBe(antes);
  });

  /**
   * ⚠️ E por isso reexibir RECALCULA na hora. Sem isso o indicador voltaria com os
   * dados do instante em que foi escondido e so se corrigiria na proxima barra — num
   * grafico parado, nunca.
   */
  it('reexibir recalcula com o historico corrente', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));

    plotter.setVisible('ema20', false);
    plotter.updateData(velas(45)); // 15 barras novas enquanto escondido
    expect(series[0]!.dados).toHaveLength(30);

    plotter.setVisible('ema20', true);
    expect(series[0]!.dados).toHaveLength(45);
  });

  it('reexibir o que JA estava visivel nao recalcula de graca', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ind = indicadorSobrePreco();
    plotter.setPlots([{ id: 'ema20', instance: ind }], velas(30));
    const antes = ind.warmups;
    plotter.setVisible('ema20', true);
    expect(ind.warmups).toBe(antes);
  });

  /**
   * ⭐ A escolha do operador sobrevive a um `setPlots`: ele esconde o RSI, depois
   * adiciona uma EMA (novo conjunto), e o RSI NAO pode reacender.
   */
  it('setPlots preserva o "escondido" quando o id continua no conjunto', () => {
    const { api, series, panesVisiveis } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const rsi = indicadorEmSubPainel();
    const ema = indicadorSobrePreco();

    plotter.setPlots([{ id: 'rsi', instance: rsi }], velas(30));
    plotter.setVisible('rsi', false);

    plotter.setPlots(
      [
        { id: 'rsi', instance: rsi },
        { id: 'ema20', instance: ema },
      ],
      velas(30),
    );

    const serieRsi = series.filter((s) => !s.removida && s.paneIndex !== 0);
    expect(serieRsi.every((s) => s.opcoes.visible === false)).toBe(true);
    expect(plotter.isVisible('rsi')).toBe(false);
    // A pane nova tambem nasce colapsada.
    expect(panesVisiveis.get(2)).toBe(false);
    // E a EMA nova nasce VISIVEL — o estado de um nao contamina o outro.
    expect(plotter.isVisible('ema20')).toBe(true);
  });

  /**
   * ⚠️ O inverso: id que SAIU do conjunto e esquecido. Guardar para sempre faria uma
   * EMA nova com id reaproveitado nascer invisivel, sem explicacao nenhuma.
   */
  it('id removido do conjunto perde o estado de escondido', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    const ema = indicadorSobrePreco();

    plotter.setPlots([{ id: 'ema20', instance: ema }], velas(30));
    plotter.setVisible('ema20', false);

    // Conjunto sem ele (o operador removeu).
    plotter.setPlots([], velas(30));
    // E de volta, com o mesmo id (o operador adicionou uma EMA nova).
    plotter.setPlots([{ id: 'ema20', instance: ema }], velas(30));

    expect(plotter.isVisible('ema20')).toBe(true);
  });

  it('`visible: false` no proprio plot faz a serie NASCER escondida', () => {
    const { api, series, panesVisiveis } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots(
      [{ id: 'rsi', instance: indicadorEmSubPainel(), visible: false }],
      velas(30),
    );

    expect(series[0]!.opcoes.visible).toBe(false);
    expect(panesVisiveis.get(1)).toBe(false);
  });

  it('plot desconhecido conta como visivel — o default nao pode ser "some"', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    expect(plotter.isVisible('nunca-visto')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⭐ De qual indicador é esta série? — a metade da identidade
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que estes casos fecham: *"quando clicar no indicador dentro do gráfico, eu preciso
 * abrir as propriedades do indicador selecionado"*.
 *
 * O gesto exige DUAS respostas, e nenhuma camada tem as duas:
 *
 *  - **geometria** — qual série está sob aquele pixel. É do motor (`chart.seriesAt`), que
 *    tem as coordenadas e não sabe o que é indicador.
 *  - **identidade** — de qual indicador aquela série é. É do plotter, que fez o
 *    mapeamento e não tem coordenada nenhuma.
 *
 * Estes casos medem a segunda. A primeira está em
 * `chart-core/__tests__/serie-sob-o-ponto.spec.ts`.
 */
describe('⭐ plotIdOfSeries / outputKeyOfSeries — a série sabe de quem é', () => {
  /** Um indicador de DUAS saídas, para provar que a chave é por série, não por plot. */
  function indicadorDeDuasSaidas(): IndicadorFalso {
    const ind = {
      warmups: 0,
      meta: {
        name: 'stoch',
        label: 'STOCH',
        outputs: [
          { key: 'k', label: '%K', plot: 'line' as const, pane: 'separate' as const },
          { key: 'd', label: '%D', plot: 'line' as const, pane: 'separate' as const },
        ],
      },
      warmup(history: readonly { time: number; close: number }[]) {
        ind.warmups += 1;
        return history.map((b) => ({ time: b.time, values: { k: 50, d: 40 } }));
      },
    };
    return ind as unknown as IndicadorFalso;
  }

  it('traduz a série no id do plot', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots(
      [
        { id: 'ema20', instance: indicadorSobrePreco() },
        { id: 'rsi', instance: indicadorEmSubPainel() },
      ],
      velas(30),
    );

    // O `handle` que o motor devolveria em `seriesAt` é o mesmo objeto que o `addSeries`
    // entregou ao plotter — a comparação é por IDENTIDADE.
    const handleEma = series[0]!.handle;
    const handleRsi = series[1]!.handle;
    expect(plotter.plotIdOfSeries(handleEma)).toBe('ema20');
    expect(plotter.plotIdOfSeries(handleRsi)).toBe('rsi');
  });

  /**
   * ⭐ A chave da SAÍDA, e não só o plot: o operador clicou na linha do `%D`, e é a cor
   * do `%D` que ele quer mudar. Abrir as propriedades no campo certo depende disto.
   */
  it('traduz a série na chave da SAÍDA', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'stoch', instance: indicadorDeDuasSaidas() }], velas(30));

    expect(plotter.outputKeyOfSeries(series[0]!.handle)).toBe('k');
    expect(plotter.outputKeyOfSeries(series[1]!.handle)).toBe('d');
    // As duas são do mesmo indicador.
    expect(plotter.plotIdOfSeries(series[0]!.handle)).toBe('stoch');
    expect(plotter.plotIdOfSeries(series[1]!.handle)).toBe('stoch');
  });

  it('série desconhecida (ou nula) devolve null — nunca lança', () => {
    const { api } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));

    expect(plotter.plotIdOfSeries({})).toBeNull();
    expect(plotter.plotIdOfSeries(null)).toBeNull();
    expect(plotter.plotIdOfSeries(undefined)).toBeNull();
    expect(plotter.outputKeyOfSeries({})).toBeNull();
  });

  /**
   * ⚠️ Depois de `clear`, a série antiga não pode mais responder por um indicador que já
   * não existe — senão um clique numa referência guardada abriria propriedades de algo
   * removido.
   */
  it('depois de clear, a série antiga não responde mais', () => {
    const { api, series } = chartFalso();
    const plotter = new IndicatorPlotter(api);
    plotter.setPlots([{ id: 'ema20', instance: indicadorSobrePreco() }], velas(30));
    const handle = series[0]!.handle;
    expect(plotter.plotIdOfSeries(handle)).toBe('ema20');

    plotter.clear();
    expect(plotter.plotIdOfSeries(handle)).toBeNull();
  });
});
