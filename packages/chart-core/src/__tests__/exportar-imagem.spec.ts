/**
 * Exportar imagem: `takeScreenshot` e `toDataURL`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O canvas do motor e privado, e era. Salvar o grafico como imagem — para anexar
 * num relatorio de operacao, num post-mortem de trade — nao tinha caminho nenhum
 * pela API publica.
 *
 * ⚠️ A parte que exige teste NAO e o caso feliz, e o caso SEM RASTERIZACAO. O
 * jsdom nao tem backend de imagem, e o metodo `toDataURL` que ele expoe no
 * prototipo **nao lanca**: devolve `undefined`. Um `try/catch` ingenuo passaria
 * esse `undefined` adiante e o consumidor gravaria um arquivo vazio. A regra do
 * projeto e falha como VALOR DE RETORNO: `null` significa "nao sei rasterizar", e
 * e isso que os dois primeiros casos afirmam.
 *
 * Os casos seguintes injetam um contexto 2D falso no prototipo do canvas — o
 * unico jeito de exercitar o caminho feliz num ambiente que declaradamente nao
 * rasteriza — e medem o MECANISMO: fundo pintado antes da copia, `drawImage` do
 * canvas interno, e validacao do que o `toDataURL` do ambiente devolveu.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';

const LARGURA = 800;
const ALTURA = 400;

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

function velas(n: number): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 5) * 8;
    return { time: t0 + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 };
  });
}

describe('exportar imagem — sem rasterizacao devolve null, nunca imagem vazia', () => {
  let el: HTMLElement;
  let chart: IChartApi;

  beforeEach(() => {
    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    chart.addSeries('Candlestick').setData(velas(40) as never);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
  });

  it('`takeScreenshot` devolve null em ambiente sem contexto 2D (jsdom)', () => {
    expect(chart.takeScreenshot()).toBeNull();
  });

  it('`toDataURL` devolve null — e NAO lanca', () => {
    expect(() => chart.toDataURL()).not.toThrow();
    expect(chart.toDataURL()).toBeNull();
    expect(chart.toDataURL('image/jpeg', 0.8)).toBeNull();
  });

  it('depois de `remove()` continua devolvendo null sem lancar', () => {
    chart.remove();
    expect(chart.takeScreenshot()).toBeNull();
    expect(chart.toDataURL()).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Caminho feliz — contexto 2D injetado no prototipo
// ═════════════════════════════════════════════════════════════════════════════

type Operacao =
  | { tipo: 'fillRect'; x: number; y: number; w: number; h: number; estilo: string }
  | { tipo: 'drawImage' };

/**
 * ⚠️ O registro e uma LISTA ORDENADA de operacoes, e nao "o primeiro fillRect".
 *
 * A razao e um erro que este teste cometeu na primeira versao: `takeScreenshot`
 * descarrega o quadro pendente ANTES de copiar, e esse quadro pinta corpos de vela
 * com `fillRect`. O "primeiro retangulo" era um corpo de vela, nao o fundo. Medir a
 * ORDEM (fundo -> `drawImage`, nesta sequencia, no fim) e o que afirma o mecanismo
 * de verdade: o fundo tem de estar ATRAS da copia do quadro.
 */
interface Registro {
  ops: Operacao[];
}

/**
 * Contexto 2D falso, tolerante a qualquer chamada.
 *
 * Proxy em vez de classe pelo mesmo motivo do contexto inerte do motor: o renderer
 * toca dezenas de propriedades (`setLineDash`, `globalAlpha`, `font`...) e listar
 * todas aqui so criaria manutencao. O que importa e registrado; o resto e no-op.
 */
function contextoFalso(reg: Registro): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  const estado: Record<string, unknown> = { canvas: { width: 0, height: 0 }, fillStyle: '' };
  const metodos: Record<string, unknown> = {
    fillRect: (x: number, y: number, w: number, h: number): void => {
      reg.ops.push({ tipo: 'fillRect', x, y, w, h, estilo: String(estado.fillStyle) });
    },
    drawImage: (): void => {
      reg.ops.push({ tipo: 'drawImage' });
    },
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

describe('exportar imagem — caminho com rasterizacao (contexto injetado)', () => {
  let el: HTMLElement;
  let chart: IChartApi;
  let reg: Registro;
  let getContextOriginal: typeof HTMLCanvasElement.prototype.getContext;
  let toDataURLOriginal: typeof HTMLCanvasElement.prototype.toDataURL;
  let retornoDataURL: unknown = 'data:image/png;base64,QUJD';

  beforeEach(() => {
    reg = { ops: [] };
    getContextOriginal = HTMLCanvasElement.prototype.getContext;
    toDataURLOriginal = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.getContext = function (tipo: string): unknown {
      return tipo === '2d' ? contextoFalso(reg) : null;
    } as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = function (): string {
      return retornoDataURL as string;
    } as typeof HTMLCanvasElement.prototype.toDataURL;

    el = montarContainer();
    chart = createChart(el, { autoSize: false });
    chart.addSeries('Candlestick').setData(velas(40) as never);
  });

  afterEach(() => {
    chart.remove();
    el.remove();
    HTMLCanvasElement.prototype.getContext = getContextOriginal;
    HTMLCanvasElement.prototype.toDataURL = toDataURLOriginal;
    retornoDataURL = 'data:image/png;base64,QUJD';
  });

  it('devolve um canvas NOVO, do tamanho do bitmap interno', () => {
    const snap = chart.takeScreenshot();
    expect(snap).not.toBeNull();
    // ⭐ Nao e o canvas interno: quem guardasse a referencia veria a foto mudar
    // sozinha no proximo pan.
    const interno = el.querySelector('canvas');
    expect(snap).not.toBe(interno);
    expect(snap!.width).toBe(interno!.width);
    expect(snap!.height).toBe(interno!.height);
    expect(snap!.width).toBeGreaterThan(0);
  });

  it('pinta o FUNDO e SO DEPOIS copia o quadro — PNG transparente ficaria ilegivel', () => {
    reg.ops.length = 0;
    const snap = chart.takeScreenshot();
    expect(snap).not.toBeNull();

    // A copia e a ULTIMA operacao, e uma so.
    expect(reg.ops.filter((o) => o.tipo === 'drawImage')).toHaveLength(1);
    expect(reg.ops[reg.ops.length - 1]!.tipo).toBe('drawImage');

    // E imediatamente antes dela, o fundo cobrindo o bitmap inteiro.
    const fundo = reg.ops[reg.ops.length - 2];
    expect(fundo).toBeDefined();
    expect(fundo!.tipo).toBe('fillRect');
    if (fundo!.tipo !== 'fillRect') return;
    expect(fundo.x).toBe(0);
    expect(fundo.y).toBe(0);
    expect(fundo.w).toBe(snap!.width);
    expect(fundo.h).toBe(snap!.height);
    // Tema default e `transparent`; a exportacao substitui por cor solida.
    expect(fundo.estilo).not.toBe('transparent');
    expect(fundo.estilo.startsWith('#')).toBe(true);
  });

  it('respeita a cor de fundo configurada em vez de impor a de exportacao', () => {
    chart.applyOptions({ layout: { background: { color: '#123456' }, textColor: '#fff' } });
    reg.ops.length = 0;
    chart.takeScreenshot();
    const fundo = reg.ops[reg.ops.length - 2];
    expect(fundo!.tipo).toBe('fillRect');
    if (fundo!.tipo !== 'fillRect') return;
    expect(fundo.estilo).toBe('#123456');
  });

  /**
   * ⭐ O render e COALESCIDO. Sem descarregar o quadro pendente, um `setData`
   * seguido de screenshot no mesmo tick fotografaria o estado ANTERIOR ao dado — e
   * de forma intermitente, conforme onde o rAF caiu. Aqui: apos `setData` ha um
   * quadro agendado; a exportacao tem de faze-lo rodar.
   */
  it('descarrega o quadro pendente antes de fotografar', () => {
    const interno = chart as unknown as { frame: number | null };
    chart.addSeries('Line').setData([{ time: 1_700_000_000, value: 1 }] as never);
    expect(interno.frame).not.toBeNull(); // quadro agendado, ainda nao desenhado

    chart.takeScreenshot();
    expect(interno.frame).toBeNull(); // rodou agora, nao no proximo rAF
  });

  it('`toDataURL` devolve a string do ambiente quando ela e um data URL', () => {
    const url = chart.toDataURL();
    expect(url).toBe('data:image/png;base64,QUJD');
  });

  /**
   * ⚠️ A asserção que pega o defeito do jsdom: o ambiente pode devolver algo que
   * NAO e imagem sem lancar. O motor valida o prefixo `data:` e recusa.
   */
  it('`toDataURL` recusa retorno que nao e data URL (o caso do jsdom)', () => {
    retornoDataURL = undefined;
    expect(chart.toDataURL()).toBeNull();
    retornoDataURL = '';
    expect(chart.toDataURL()).toBeNull();
    retornoDataURL = 'nao-e-data-url';
    expect(chart.toDataURL()).toBeNull();
  });
});
