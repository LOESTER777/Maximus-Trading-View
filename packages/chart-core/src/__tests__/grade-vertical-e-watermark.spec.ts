/**
 * Grade VERTICAL opcional e MARCA D'AGUA — o que de fato chega ao canvas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOIS DEFEITOS DE "OPCAO QUE NAO FAZ NADA"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `grid.vertLines.visible` estava no contrato desde o inicio e o renderer
 * **nunca a lia** — `drawGrid` desenhava so as horizontais, e o comentario no
 * codigo dizia que a vertical "nao acrescenta leitura". A decisao de nascer
 * desligada continua certa (a linha cai sobre o corpo das velas), mas configurar
 * `visible: true` tinha de fazer algo, e nao fazia.
 *
 * A marca d'agua simplesmente nao existia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUBLE QUE CONTA CHAMADAS — o padrao do projeto
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Em jsdom nao ha pixel para inspecionar. Este arquivo chama `renderPane`
 * direto com um contexto falso que registra os SEGMENTOS de caminho e os textos —
 * mesmo padrao de `primitives/__tests__/diagnostico-e-caixa-da-legenda.spec.ts`.
 *
 * ⚠️ E ha guarda de vacuidade: cada caso que afirma "nenhuma vertical" tambem
 * afirma que HOUVE horizontal. Sem isso, um `renderPane` que deixasse de desenhar
 * qualquer coisa passaria verde comparando duas telas vazias — o erro registrado na
 * suite herdada.
 *
 * ⭐ `measureText` e OPCIONAL no duble, de proposito: e o unico jeito de exercitar
 * a estimativa de largura da marca d'agua (o caminho que o contexto inerte do jsdom
 * percorre em producao).
 */
import { describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import { DEFAULT_THEME, renderPane, type RenderTheme } from '../renderer.js';
import { createPriceScaleState, type PriceScaleState } from '../price-scale.core.js';
import {
  createTimeScaleState,
  visibleTickIndices,
  type TimeScaleState,
} from '../time-scale.core.js';
import type { SeriesModel } from '../series.js';

const LARGURA = 800;
const ALTURA = 300;

interface Segmento {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly estilo: string;
}

interface Texto {
  readonly texto: string;
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly fonte: string;
  readonly align: string;
  /** `fillStyle` em vigor NO MOMENTO da chamada — depois do `restore` ele muda. */
  readonly estilo: string;
}

/**
 * Contexto falso: pareia cada `moveTo` com o `lineTo` seguinte e guarda o segmento.
 *
 * E assim que se distingue vertical de horizontal sem pixel: segmento com
 * `x0 === x1` e vertical.
 */
class ContextoFalso {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textAlign = '';
  textBaseline = '';
  globalAlpha = 1;

  segmentos: Segmento[] = [];
  textos: Texto[] = [];
  saves = 0;
  restores = 0;

  private pendente: { x: number; y: number } | null = null;
  private readonly pilha: Array<{
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    textAlign: string;
    textBaseline: string;
    globalAlpha: number;
  }> = [];

  constructor(private readonly comMedida: boolean) {}

  beginPath(): void {
    this.pendente = null;
  }
  moveTo(x: number, y: number): void {
    this.pendente = { x, y };
  }
  lineTo(x: number, y: number): void {
    const p = this.pendente;
    if (p !== null) {
      this.segmentos.push({ x0: p.x, y0: p.y, x1: x, y1: y, estilo: this.strokeStyle });
    }
    this.pendente = { x, y };
  }
  stroke(): void {
    this.pendente = null;
  }
  closePath(): void {}
  fill(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  clearRect(): void {}
  rect(): void {}
  clip(): void {}
  arc(): void {}
  setLineDash(): void {}
  translate(): void {}
  /**
   * ⭐ `save`/`restore` restauram DE VERDADE aqui, com pilha.
   *
   * A primeira versao do duble so contava as chamadas, e a asserção de "nao vaza o
   * alpha" media o duble em vez do codigo: `globalAlpha` ficava em 0,08 depois do
   * `restore` porque o duble nunca desfazia nada. Um duble que nao restaura torna
   * impossivel detectar vazamento de estado de contexto — que e exatamente a classe
   * de defeito que a disciplina de `save`/`restore` em par existe para evitar.
   */
  save(): void {
    this.saves++;
    this.pilha.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      globalAlpha: this.globalAlpha,
    });
  }
  restore(): void {
    this.restores++;
    const s = this.pilha.pop();
    if (s === undefined) return;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.globalAlpha = s.globalAlpha;
  }
  fillText(texto: string, x: number, y: number): void {
    this.textos.push({
      texto,
      x,
      y,
      alpha: this.globalAlpha,
      fonte: this.font,
      align: this.textAlign,
      estilo: this.fillStyle,
    });
  }
  measureText(texto: string): TextMetrics | undefined {
    if (!this.comMedida) return undefined;
    // 7 px por caractere: valor estavel, so para a largura ser deterministica.
    return { width: texto.length * 7 } as TextMetrics;
  }

  get verticais(): Segmento[] {
    return this.segmentos.filter((s) => Math.abs(s.x0 - s.x1) < 1e-9);
  }
  get horizontais(): Segmento[] {
    return this.segmentos.filter((s) => Math.abs(s.y0 - s.y1) < 1e-9);
  }
  get ctx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}

function cenario(): { ts: TimeScaleState; ps: PriceScaleState } {
  const ts = createTimeScaleState(8, 2, 12);
  ts.width = LARGURA;
  ts.times = Array.from({ length: 300 }, (_, i) => 1_700_000_000 + i * 60);
  const ps = createPriceScaleState(0.08, 0.2);
  ps.height = ALTURA;
  ps.topPrice = 110;
  ps.bottomPrice = 90;
  return { ts, ps };
}

/** Serie de velas minima, so para a pane nao estar vazia. */
function serieDeVelas(ts: TimeScaleState, ps: PriceScaleState): Array<{ model: SeriesModel; scale: PriceScaleState }> {
  const model = {
    type: 'Candlestick',
    options: {},
    data: ts.times.map((t, i) => ({ time: t, open: 100, high: 101, low: 99, close: 100 + (i % 2) })),
    primitives: [],
    priceLines: new Map(),
    markers: [],
  } as unknown as SeriesModel;
  return [{ model, scale: ps }];
}

describe('grade vertical', () => {
  it('DESLIGADA por default: nenhuma vertical, mas as horizontais aparecem', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, serieDeVelas(ts, ps), DEFAULT_THEME, null, true);

    // Guarda de vacuidade: se a grade horizontal parar de sair, este caso falha
    // antes de os demais mentirem verde.
    expect(c.horizontais.length).toBeGreaterThan(0);
    // A vela desenha pavios (verticais) — filtra so os da cor da grade.
    expect(c.verticais.filter((s) => s.estilo === DEFAULT_THEME.grid)).toHaveLength(0);
  });

  it('LIGADA desenha uma vertical por instante rotulado do eixo de tempo', () => {
    const { ts, ps } = cenario();
    const tema: RenderTheme = { ...DEFAULT_THEME, gridVertVisible: true };
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], tema, null, true);

    // ⭐ A asserção que prova o alinhamento com os rotulos: o conjunto de linhas e
    // exatamente o conjunto de indices que `visibleTickIndices` marca (os que caem
    // dentro da largura). Duas fontes de passo divergiriam e a linha apareceria em
    // instante SEM rotulo.
    const esperados = visibleTickIndices(ts).filter((i) => {
      const x = (i - ts.leftLogical) * ts.barSpacing;
      return x >= 0 && x <= LARGURA;
    });
    expect(esperados.length).toBeGreaterThan(1);
    expect(c.verticais).toHaveLength(esperados.length);

    const xsEsperados = esperados.map((i) => Math.round((i - ts.leftLogical) * ts.barSpacing) + 0.5);
    expect(c.verticais.map((s) => s.x0)).toEqual(xsEsperados);
  });

  it('a vertical vai de topo a base da pane', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], { ...DEFAULT_THEME, gridVertVisible: true }, null, true);
    const v = c.verticais[0]!;
    expect(Math.min(v.y0, v.y1)).toBe(0);
    expect(Math.max(v.y0, v.y1)).toBeCloseTo(ALTURA, 6);
  });

  it('a cor propria vence; sem ela usa a da horizontal', () => {
    const { ts, ps } = cenario();

    const comCor = new ContextoFalso(true);
    renderPane(comCor.ctx, 1, 1, ts, ps, [], { ...DEFAULT_THEME, gridVertVisible: true, gridVert: '#ff0000' }, null, true);
    expect(comCor.verticais.every((s) => s.estilo === '#ff0000')).toBe(true);

    const semCor = new ContextoFalso(true);
    renderPane(semCor.ctx, 1, 1, ts, ps, [], { ...DEFAULT_THEME, gridVertVisible: true }, null, true);
    expect(semCor.verticais.every((s) => s.estilo === DEFAULT_THEME.grid)).toBe(true);
  });

  it('vertical LIGADA e horizontal DESLIGADA e combinacao valida', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(
      c.ctx,
      1,
      1,
      ts,
      ps,
      [],
      { ...DEFAULT_THEME, gridVisible: false, gridVertVisible: true },
      null,
      // Sem eixo de preco: senao os rotulos entrariam na conta de texto.
      false,
    );
    expect(c.verticais.length).toBeGreaterThan(0);
    expect(c.horizontais).toHaveLength(0);
  });
});

describe('marca d agua', () => {
  const WM = { text: 'WIN$N' };

  it('desenha o texto centralizado, na meia-altura, com alpha baixo', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, WM);

    const marca = c.textos.find((t) => t.texto === 'WIN$N');
    expect(marca).toBeDefined();
    expect(marca!.y).toBeCloseTo(ALTURA / 2, 6);
    // Largura medida pelo duble: 5 caracteres x 7 px = 35.
    expect(marca!.x).toBeCloseTo((LARGURA - 35) / 2, 6);
    // Alpha baixo: e fundo, nao conteudo.
    expect(marca!.alpha).toBeGreaterThan(0);
    expect(marca!.alpha).toBeLessThan(0.2);
  });

  /**
   * ⭐ A marca vem ANTES de tudo que carrega dado. Se fosse depois, ela cobriria o
   * pavio das velas justamente no centro da tela, que e onde o operador olha.
   */
  it('e desenhada ATRAS das series e da grade', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, serieDeVelas(ts, ps), DEFAULT_THEME, null, false, null, undefined, WM);

    // Nenhum segmento de grade/serie foi tracado antes do texto da marca.
    expect(c.textos[0]!.texto).toBe('WIN$N');
    expect(c.segmentos.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ O caminho que o jsdom percorre em producao: sem `measureText`, a largura e
   * ESTIMADA. O texto tem de sair mesmo assim — `undefined.width` lancaria dentro do
   * ciclo de desenho e derrubaria o grafico inteiro.
   */
  it('sem `measureText` ESTIMA a largura e nao lanca', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(false);
    expect(() =>
      renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, WM),
    ).not.toThrow();
    const marca = c.textos.find((t) => t.texto === 'WIN$N');
    expect(marca).toBeDefined();
    // Centralizada por estimativa: perto do meio, nao na borda.
    expect(marca!.x).toBeGreaterThan(LARGURA * 0.25);
    expect(marca!.x).toBeLessThan(LARGURA * 0.5);
  });

  it('texto mais largo que a pane ancora em 0 em vez de sair pela esquerda', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    const longo = { text: 'X'.repeat(500) };
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, longo);
    expect(c.textos[0]!.x).toBe(0);
  });

  it('`visible: false` nao desenha', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, {
      text: 'WIN$N',
      visible: false,
    });
    expect(c.textos).toHaveLength(0);
  });

  it('texto vazio nao desenha', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, { text: '' });
    expect(c.textos).toHaveLength(0);
  });

  it('honra `fontSize` e `color`', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, {
      text: 'AB',
      fontSize: 90,
      color: '#00ff00',
    });
    const marca = c.textos[0]!;
    expect(marca.fonte).toContain('90px');
    expect(marca.estilo).toBe('#00ff00');
  });

  /** `save`/`restore` em par: alpha vazado sujaria a camada seguinte. */
  it('nao vaza o alpha para o resto do desenho', () => {
    const { ts, ps } = cenario();
    const c = new ContextoFalso(true);
    renderPane(c.ctx, 1, 1, ts, ps, [], DEFAULT_THEME, null, false, null, undefined, WM);
    expect(c.saves).toBe(c.restores);
    expect(c.globalAlpha).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A costura: da OPCAO do grafico ate o que o renderer recebe
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ Testar `renderPane` sozinho nao basta: o defeito original era justamente a
 * opcao existir no contrato e NAO CHEGAR ao desenho. Estes casos medem a costura —
 * `ChartOptions` -> tema/`watermarkOpts` — incluindo o caminho de `applyOptions`,
 * onde a releitura e facil de esquecer.
 */
describe('costura das opcoes no grafico', () => {
  function montar(opts?: Parameters<typeof createChart>[1]): {
    chart: ReturnType<typeof createChart>;
    el: HTMLElement;
  } {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
    document.body.appendChild(el);
    return { chart: createChart(el, { autoSize: false, ...opts }), el };
  }

  function tema(chart: ReturnType<typeof createChart>): RenderTheme {
    return (chart as unknown as { theme: RenderTheme }).theme;
  }

  it('`grid.vertLines` default DESLIGADA', () => {
    const { chart, el } = montar();
    expect(tema(chart).gridVertVisible).toBe(false);
    chart.remove();
    el.remove();
  });

  it('`grid.vertLines.visible: true` na construcao chega ao tema', () => {
    const { chart, el } = montar({
      grid: { vertLines: { visible: true, color: '#abcdef' }, horzLines: { visible: true } },
    });
    expect(tema(chart).gridVertVisible).toBe(true);
    expect(tema(chart).gridVert).toBe('#abcdef');
    chart.remove();
    el.remove();
  });

  it('`applyOptions` LIGA e DESLIGA a grade vertical depois da construcao', () => {
    const { chart, el } = montar();
    chart.applyOptions({
      grid: { vertLines: { visible: true, color: '#112233' }, horzLines: { visible: true } },
    });
    expect(tema(chart).gridVertVisible).toBe(true);
    expect(tema(chart).gridVert).toBe('#112233');

    chart.applyOptions({
      grid: { vertLines: { visible: false }, horzLines: { visible: true } },
    });
    expect(tema(chart).gridVertVisible).toBe(false);
    chart.remove();
    el.remove();
  });

  it('a cor da grade HORIZONTAL tambem sobrevive ao `applyOptions`', () => {
    const { chart, el } = montar();
    chart.applyOptions({
      grid: { vertLines: { visible: false }, horzLines: { visible: true, color: '#445566' } },
    });
    expect(tema(chart).grid).toBe('#445566');
    chart.remove();
    el.remove();
  });

  it('a marca d agua chega do `ChartOptions`, e `visible: false`/vazia sao filtradas', () => {
    const { chart, el } = montar({ watermark: { text: 'WDO$N', fontSize: 60 } });
    const interno = chart as unknown as { watermarkOpts: () => unknown };
    expect(interno.watermarkOpts()).toMatchObject({ text: 'WDO$N', fontSize: 60 });

    chart.applyOptions({ watermark: { text: 'WDO$N', visible: false } });
    expect(interno.watermarkOpts()).toBeUndefined();

    chart.applyOptions({ watermark: { text: '' } });
    expect(interno.watermarkOpts()).toBeUndefined();

    chart.remove();
    el.remove();
  });

  it('sem `watermark` configurada nao ha marca — quem nao usa nao paga', () => {
    const { chart, el } = montar();
    const interno = chart as unknown as { watermarkOpts: () => unknown };
    expect(interno.watermarkOpts()).toBeUndefined();
    chart.remove();
    el.remove();
  });
});
