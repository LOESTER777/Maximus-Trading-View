/**
 * Ordem de desenho: primitive `bottom` ANTES das series, `top` DEPOIS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO TRAVA — COM AS PALAVRAS DE QUEM O VIU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"o bookmap está sendo plotado em cima das médias de volume"*.
 *
 * O motor desenhava TODAS as primitives DEPOIS de `renderPane`. O `zOrder` de cada
 * view existia e era respeitado — mas so ordenava as primitives ENTRE SI. Em relacao
 * as series, `'bottom'` nao significava nada: o heatmap de livro cobria corpo de vela,
 * histograma de volume e linha de indicador.
 *
 * E o contrato da camada afirmava o contrario, com estas palavras, no proprio codigo:
 * *"as formas sao emitidas no canvas do grafico antes das velas, entao nenhum pixel de
 * corpo, de sombra ou de borda de vela e coberto"*. O motor quebrava a promessa da
 * camada que ele hospeda.
 *
 * ⭐ Este arquivo mede o MECANISMO — a SEQUENCIA de operacoes no contexto 2D — e nao a
 * aparencia. Nenhum teste anterior olhava ordem: a correcao poderia regredir com a
 * suite inteira verde. Um `expect` de pixel seria impossivel aqui (o jsdom nao
 * rasteriza, e isso e requisito do projeto), e tambem seria o teste errado: o que
 * importa e quem pinta primeiro.
 *
 * ⚠️ GUARDA DE VACUIDADE. Toda assercao de ordem e precedida da verificacao de que as
 * duas coisas comparadas ACONTECERAM. Sem isso, "o fundo veio antes da vela" passaria
 * tambem num quadro em que nem fundo nem vela foram desenhados — que e exatamente o
 * quadro que o jsdom produz por default (contexto 2D nulo). O teste seria vacuo e
 * daria a sensacao mais caras que existe: confianca sem cobertura.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type {
  CanvasRenderingTarget2D,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
} from '../index.js';

const LARGURA = 800;
const ALTURA = 400;

// Cores de PROVA: cada uma identifica quem emitiu o retangulo. Nao ha outro jeito de
// distinguir a origem de um `fillRect` num registro plano de operacoes.
const COR_ALTA = '#00ff00';
const COR_BAIXA = '#ff0000';
const COR_FUNDO_PRIMITIVE = '#0000ff';
const COR_TOPO_PRIMITIVE = '#ffff00';

interface Op {
  readonly tipo: 'fillRect';
  readonly estilo: string;
}

interface Registro {
  ops: Op[];
}

/**
 * Contexto 2D falso que registra a ORDEM das operacoes.
 *
 * Proxy em vez de classe pelo motivo de sempre neste projeto: o renderizador toca
 * dezenas de propriedades (`setLineDash`, `globalAlpha`, `font`, `filter`) e listar
 * todas aqui viraria manutencao pura. O que interessa e registrado; o resto e no-op.
 */
function contextoFalso(reg: Registro): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  const estado: Record<string, unknown> = {
    canvas: { width: LARGURA, height: ALTURA },
    fillStyle: '',
  };
  const metodos: Record<string, unknown> = {
    fillRect: (): void => {
      reg.ops.push({ tipo: 'fillRect', estilo: String(estado.fillStyle) });
    },
    measureText: (): { width: number } => ({ width: 10 }),
    createLinearGradient: (): unknown => ({ addColorStop: noop }),
  };
  return new Proxy(estado, {
    get: (t, prop) => {
      if (typeof prop === 'string' && prop in metodos) return metodos[prop];
      if (prop in t) return t[prop as string];
      return typeof prop === 'string' && /^[a-z]/.test(prop) ? noop : undefined;
    },
    set: (t, p, v) => {
      t[p as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Primitive de prova: pinta UM retangulo com a cor que a identifica. */
function primitiveDeProva(
  z: 'bottom' | 'normal' | 'top',
  cor: string,
): ISeriesPrimitive & { atualizacoes: number } {
  const renderer: IPrimitivePaneRenderer = {
    draw: (alvo: CanvasRenderingTarget2D): void => {
      alvo.useBitmapCoordinateSpace((scope) => {
        scope.context.fillStyle = cor;
        scope.context.fillRect(0, 0, 10, 10);
      });
    },
  };
  const view: IPrimitivePaneView = {
    zOrder: () => z,
    renderer: () => renderer,
  };
  return {
    atualizacoes: 0,
    attached: (): void => undefined,
    detached: (): void => undefined,
    updateAllViews(): void {
      (this as { atualizacoes: number }).atualizacoes += 1;
    },
    paneViews: () => [view],
  };
}

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

function velas(n: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 5) * 8;
    // `close` acima de `open` em todas: o corpo sai na cor de ALTA, e a prova nao
    // depende de adivinhar qual cor cada barra usou.
    return { time: t0 + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 };
  });
}

/** Indice da primeira operacao com o estilo pedido; -1 quando nao houve. */
function primeiro(reg: Registro, estilo: string): number {
  return reg.ops.findIndex((o) => o.estilo === estilo);
}

describe('ordem de desenho — `bottom` e FUNDO de verdade, atras das series', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let reg: Registro;
  let getContextOriginal: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    reg = { ops: [] };
    getContextOriginal = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (tipo: string): unknown {
      return tipo === '2d' ? contextoFalso(reg) : null;
    } as typeof HTMLCanvasElement.prototype.getContext;
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
  });

  afterEach(() => {
    chart.remove();
    el.remove();
    HTMLCanvasElement.prototype.getContext = getContextOriginal;
  });

  /** Um quadro sincrono, sem esperar o rAF. */
  function desenhar(): void {
    reg.ops.length = 0;
    (chart as unknown as { render: (t: number) => void }).render(0);
  }

  it('⭐ o retangulo da primitive `bottom` sai ANTES do corpo da vela', () => {
    const serie = chart.addSeries('Candlestick', {
      upColor: COR_ALTA,
      downColor: COR_BAIXA,
      borderVisible: false,
    } as never);
    serie.setData(velas(40) as never);
    const fundo = primitiveDeProva('bottom', COR_FUNDO_PRIMITIVE);
    serie.attachPrimitive(fundo);
    chart.timeScale().fitContent();

    desenhar();

    const iFundo = primeiro(reg, COR_FUNDO_PRIMITIVE);
    const iVela = primeiro(reg, COR_ALTA);
    // ⚠️ GUARDA DE VACUIDADE: sem as duas linhas abaixo, `-1 < -1` seria falso mas
    // `iFundo < iVela` com ambos ausentes tambem poderia passar por acidente numa
    // reescrita futura. O que importa e afirmar que HOUVE o que se compara.
    expect(iFundo, 'a primitive de fundo nao desenhou nada').toBeGreaterThanOrEqual(0);
    expect(iVela, 'nenhum corpo de vela foi desenhado').toBeGreaterThanOrEqual(0);
    expect(iFundo).toBeLessThan(iVela);
  });

  it('a primitive `top` sai DEPOIS do corpo da vela — o outro lado da mesma prova', () => {
    const serie = chart.addSeries('Candlestick', {
      upColor: COR_ALTA,
      downColor: COR_BAIXA,
      borderVisible: false,
    } as never);
    serie.setData(velas(40) as never);
    serie.attachPrimitive(primitiveDeProva('top', COR_TOPO_PRIMITIVE));
    chart.timeScale().fitContent();

    desenhar();

    const iTopo = primeiro(reg, COR_TOPO_PRIMITIVE);
    const iVela = primeiro(reg, COR_ALTA);
    expect(iTopo, 'a primitive de topo nao desenhou nada').toBeGreaterThanOrEqual(0);
    expect(iVela, 'nenhum corpo de vela foi desenhado').toBeGreaterThanOrEqual(0);
    expect(iTopo).toBeGreaterThan(iVela);
  });

  it('⭐ o caso relatado: heatmap no fundo, HISTOGRAMA de volume por cima', () => {
    // A reproducao do relato. O volume e uma serie de overlay em escala propria; o
    // bookmap e uma primitive `bottom` ancorada nele ou no preco. Antes da correcao o
    // retangulo da primitive saia depois das barras e as apagava.
    const preco = chart.addSeries('Candlestick', {
      upColor: COR_ALTA,
      downColor: COR_BAIXA,
      borderVisible: false,
    } as never);
    preco.setData(velas(40) as never);
    const volume = chart.addSeries('Histogram', {
      priceScaleId: 'volume',
      color: COR_BAIXA,
    } as never);
    volume.setData(
      velas(40).map((v, i) => ({ time: v.time, value: 1_000 + i, color: COR_BAIXA })) as never,
    );
    preco.attachPrimitive(primitiveDeProva('bottom', COR_FUNDO_PRIMITIVE));
    chart.timeScale().fitContent();

    desenhar();

    const iFundo = primeiro(reg, COR_FUNDO_PRIMITIVE);
    const iVolume = primeiro(reg, COR_BAIXA);
    expect(iFundo, 'a primitive de fundo nao desenhou nada').toBeGreaterThanOrEqual(0);
    expect(iVolume, 'nenhuma barra de volume foi desenhada').toBeGreaterThanOrEqual(0);
    expect(iFundo).toBeLessThan(iVolume);
  });

  it('⚠️ `updateAllViews` roda UMA vez por quadro, nao uma por camada', () => {
    // A correcao partiu o desenho em duas passadas (antes e depois das series). Chamar
    // o gancho de recalculo nas duas dobraria o custo de agregacao por quadro — o
    // `FootprintPrimitive` recalcula ali sem guarda de sujeira. Regressao de desempenho
    // invisivel, nascida de uma correcao de ordem de desenho.
    const serie = chart.addSeries('Candlestick', { upColor: COR_ALTA } as never);
    serie.setData(velas(40) as never);
    const fundo = primitiveDeProva('bottom', COR_FUNDO_PRIMITIVE);
    const topo = primitiveDeProva('top', COR_TOPO_PRIMITIVE);
    serie.attachPrimitive(fundo);
    serie.attachPrimitive(topo);
    chart.timeScale().fitContent();

    fundo.atualizacoes = 0;
    topo.atualizacoes = 0;
    desenhar();

    // Guarda de vacuidade: o quadro precisa ter chegado as primitives.
    expect(primeiro(reg, COR_FUNDO_PRIMITIVE)).toBeGreaterThanOrEqual(0);
    expect(primeiro(reg, COR_TOPO_PRIMITIVE)).toBeGreaterThanOrEqual(0);
    // ⭐ E a primitive de `top`, que so DESENHA na segunda passada, tambem e ATUALIZADA
    // exatamente uma vez — a primeira passada visita todas, inclusive as que nao tem
    // view de fundo.
    expect(fundo.atualizacoes).toBe(1);
    expect(topo.atualizacoes).toBe(1);
  });

  it('a ordem relativa entre `bottom`, `normal` e `top` continua valendo', () => {
    const serie = chart.addSeries('Candlestick', { upColor: COR_ALTA } as never);
    serie.setData(velas(40) as never);
    serie.attachPrimitive(primitiveDeProva('top', COR_TOPO_PRIMITIVE));
    serie.attachPrimitive(primitiveDeProva('normal', COR_BAIXA));
    serie.attachPrimitive(primitiveDeProva('bottom', COR_FUNDO_PRIMITIVE));
    chart.timeScale().fitContent();

    desenhar();

    const iFundo = primeiro(reg, COR_FUNDO_PRIMITIVE);
    const iMeio = primeiro(reg, COR_BAIXA);
    const iTopo = primeiro(reg, COR_TOPO_PRIMITIVE);
    for (const [rotulo, i] of [
      ['bottom', iFundo],
      ['normal', iMeio],
      ['top', iTopo],
    ] as const) {
      expect(i, `a primitive ${rotulo} nao desenhou`).toBeGreaterThanOrEqual(0);
    }
    // Anexadas na ordem inversa de proposito: a prova e que o `zOrder` manda, e nao a
    // ordem de anexacao.
    expect(iFundo).toBeLessThan(iMeio);
    expect(iMeio).toBeLessThan(iTopo);
  });
});
