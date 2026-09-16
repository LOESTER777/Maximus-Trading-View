/**
 * renderer — o laco de desenho em canvas. Grade, series, eixos, crosshair.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESPACO DE COORDENADA DE BITMAP, IGUAL AS CAMADAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Desenha em pixel FISICO e multiplica a geometria pelas razoes de dpr, exatamente
 * como bookmap e footprint fazem. E o que mantem o traco nitido em tela de alta
 * densidade. Um unico `setTransform(dpr,0,0,dpr,0,0)` no inicio faria o mesmo com
 * menos codigo, mas ai as PRIMITIVES (que recebem o contexto sem escala, por
 * contrato) desenhariam em outro sistema — misturar os dois quebra o alinhamento.
 * Entao o renderer proprio tambem trabalha em bitmap e multiplica a mao.
 */

import type { SeriesModel } from './series.js';
import {
  logicalToCoordinate,
  visibleLogicalRange,
  type TimeScaleState,
} from './time-scale.core.js';
import { priceToCoordinate, priceTicks, type PriceScaleState } from './price-scale.core.js';

/** Tema de cores do desenho. */
export interface RenderTheme {
  readonly background: string;
  readonly text: string;
  readonly grid: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly crosshair: string;
  readonly gridVisible: boolean;
}

export const DEFAULT_THEME: RenderTheme = {
  background: 'transparent',
  text: '#94a3b8',
  grid: 'rgba(148,163,184,0.10)',
  upColor: '#16c784',
  downColor: '#ea3943',
  crosshair: 'rgba(148,163,184,0.5)',
  gridVisible: true,
};

/** Posicao do crosshair, ou `null` quando o cursor esta fora. */
export interface CrosshairState {
  readonly x: number;
  readonly y: number;
}

/**
 * Desenha uma pane inteira: fundo, grade, series, eixos e crosshair.
 *
 * Recebe tudo por parametro — nao le estado global, nao guarda estado. O motor
 * chama isto uma vez por quadro, dentro do espaco de bitmap.
 */
export function renderPane(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  series: readonly SeriesModel[],
  theme: RenderTheme,
  crosshair: CrosshairState | null,
  mostrarEixoPreco: boolean,
): void {
  const w = ts.width;
  const h = ps.height;
  if (w <= 0 || h <= 0) return;

  if (theme.background !== 'transparent') {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w * hpr, h * vpr);
  }

  if (theme.gridVisible) drawGrid(ctx, hpr, vpr, ps, w, theme);

  for (const s of series) drawSeries(ctx, hpr, vpr, ts, ps, s, theme);

  if (mostrarEixoPreco) drawPriceAxis(ctx, hpr, vpr, ps, w, theme);

  if (crosshair !== null) drawCrosshair(ctx, hpr, vpr, crosshair, w, h, theme);
}

// ═════════════════════════════════════════════════════════════════════════════
// Grade e eixo
// ═════════════════════════════════════════════════════════════════════════════

function drawGrid(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ps: PriceScaleState,
  w: number,
  theme: RenderTheme,
): void {
  // So linhas horizontais nos niveis de preco redondos — a grade vertical compete
  // visualmente com as velas e nao acrescenta leitura.
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = Math.max(1, Math.min(hpr, vpr));
  ctx.beginPath();
  for (const p of priceTicks(ps)) {
    const y = priceToCoordinate(ps, p);
    if (y === null) continue;
    ctx.moveTo(0, Math.round(y * vpr) + 0.5);
    ctx.lineTo(w * hpr, Math.round(y * vpr) + 0.5);
  }
  ctx.stroke();
}

function drawPriceAxis(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ps: PriceScaleState,
  w: number,
  theme: RenderTheme,
): void {
  ctx.fillStyle = theme.text;
  ctx.font = `${Math.round(11 * vpr)}px ui-monospace, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const casas = decimalsFor(ps.topPrice - ps.bottomPrice);
  for (const p of priceTicks(ps)) {
    const y = priceToCoordinate(ps, p);
    if (y === null) continue;
    ctx.fillText(p.toFixed(casas), (w - 6) * hpr, y * vpr);
  }
}

/** Casas decimais adequadas a amplitude — evita "137" onde precisa "137.25". */
function decimalsFor(span: number): number {
  if (span >= 100) return 0;
  if (span >= 10) return 1;
  if (span >= 1) return 2;
  if (span >= 0.1) return 3;
  return 4;
}

// ═════════════════════════════════════════════════════════════════════════════
// Series
// ═════════════════════════════════════════════════════════════════════════════

function drawSeries(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  theme: RenderTheme,
): void {
  const lr = visibleLogicalRange(ts);
  if (lr === null) return;
  // So percorre as barras visiveis, com uma de folga de cada lado para o traco de
  // linha nao "entrar" cortado pela borda.
  const de = Math.max(0, Math.floor(lr.from) - 1);
  const ate = Math.min(s.data.length - 1, Math.ceil(lr.to) + 1);
  if (ate < de) return;

  if (s.type === 'Candlestick') drawCandles(ctx, hpr, vpr, ts, ps, s, de, ate, theme);
  else if (s.type === 'Histogram') drawHistogram(ctx, hpr, vpr, ts, ps, s, de, ate, theme);
  else drawLineOrArea(ctx, hpr, vpr, ts, ps, s, de, ate);
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  de: number,
  ate: number,
  theme: RenderTheme,
): void {
  const up = (s.options.upColor as string) ?? theme.upColor;
  const down = (s.options.downColor as string) ?? theme.downColor;
  // Largura do corpo: 80% do espacamento, com piso de 1 px para nao sumir no
  // zoom-out. O antialias apaga corpo abaixo de 1 px.
  const corpoW = Math.max(1, ts.barSpacing * 0.8 * hpr);
  // A serie e de velas, entao os dados sao CandlestickData — narrowing por cast
  // unico aqui evita repetir a asercao em cada acesso.
  const barras = s.data as readonly CandleLike[];

  // Duas passadas por cor: uma troca de fillStyle para todos os corpos de alta,
  // outra para os de baixa. Mesmo principio do bookmap.
  for (const dir of ['up', 'down'] as const) {
    ctx.fillStyle = dir === 'up' ? up : down;
    ctx.strokeStyle = dir === 'up' ? up : down;
    ctx.lineWidth = Math.max(1, Math.min(hpr, vpr));
    ctx.beginPath();
    for (let i = de; i <= ate; i++) {
      const c = barras[i];
      if (c === undefined) continue;
      const alta = c.close >= c.open;
      if ((dir === 'up') !== alta) continue;

      const x = logicalToCoordinate(ts, i);
      if (x === null) continue;
      const cx = x * hpr;

      const yH = priceToCoordinate(ps, c.high);
      const yL = priceToCoordinate(ps, c.low);
      if (yH === null || yL === null) continue;

      // Pavio: linha no centro do corpo.
      ctx.moveTo(cx, yH * vpr);
      ctx.lineTo(cx, yL * vpr);
    }
    ctx.stroke();

    // Corpos.
    for (let i = de; i <= ate; i++) {
      const c = barras[i];
      if (c === undefined) continue;
      const alta = c.close >= c.open;
      if ((dir === 'up') !== alta) continue;

      const x = logicalToCoordinate(ts, i);
      if (x === null) continue;
      const yO = priceToCoordinate(ps, c.open);
      const yC = priceToCoordinate(ps, c.close);
      if (yO === null || yC === null) continue;

      const topo = Math.min(yO, yC) * vpr;
      const alturaCorpo = Math.max(1, Math.abs(yC - yO) * vpr);
      ctx.fillRect(x * hpr - corpoW / 2, topo, corpoW, alturaCorpo);
    }
  }
}

/** Forma minima de uma vela para o desenho — narrowing local da uniao. */
interface CandleLike {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Forma minima de um ponto de valor. */
interface ValueLike {
  readonly value: number;
  readonly color?: string;
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  de: number,
  ate: number,
  theme: RenderTheme,
): void {
  const larguraBarra = Math.max(1, ts.barSpacing * 0.7 * hpr);
  const yZero = priceToCoordinate(ps, 0);
  const base = yZero !== null ? yZero * vpr : ps.height * vpr;
  const pontos = s.data as readonly ValueLike[];

  for (let i = de; i <= ate; i++) {
    const d = pontos[i];
    if (d === undefined || !Number.isFinite(d.value)) continue;
    const x = logicalToCoordinate(ts, i);
    const y = priceToCoordinate(ps, d.value);
    if (x === null || y === null) continue;
    ctx.fillStyle = d.color ?? (s.options.color as string) ?? theme.text;
    const topo = Math.min(y * vpr, base);
    const alt = Math.max(1, Math.abs(y * vpr - base));
    ctx.fillRect(x * hpr - larguraBarra / 2, topo, larguraBarra, alt);
  }
}

function drawLineOrArea(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  de: number,
  ate: number,
): void {
  const cor = (s.options.color as string) ?? '#38bdf8';
  const largura = ((s.options.lineWidth as number) ?? 1) * Math.min(hpr, vpr);

  ctx.strokeStyle = cor;
  ctx.lineWidth = Math.max(1, largura);
  ctx.beginPath();
  const pontos = s.data as readonly ValueLike[];
  let primeiro = true;
  for (let i = de; i <= ate; i++) {
    const d = pontos[i];
    if (d === undefined || !Number.isFinite(d.value)) continue;
    const x = logicalToCoordinate(ts, i);
    const y = priceToCoordinate(ps, d.value);
    if (x === null || y === null) continue;
    if (primeiro) {
      ctx.moveTo(x * hpr, y * vpr);
      primeiro = false;
    } else {
      ctx.lineTo(x * hpr, y * vpr);
    }
  }
  ctx.stroke();

  if (s.type === 'Area') {
    // Preenche ate a base. `lineTo` de volta fecha o poligono.
    ctx.lineTo(logicalToCoordinate(ts, ate)! * hpr, ps.height * vpr);
    ctx.lineTo(logicalToCoordinate(ts, de)! * hpr, ps.height * vpr);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Crosshair
// ═════════════════════════════════════════════════════════════════════════════

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  cross: CrosshairState,
  w: number,
  h: number,
  theme: RenderTheme,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = Math.max(1, Math.min(hpr, vpr));
    ctx.setLineDash([4 * hpr, 4 * hpr]);
    ctx.beginPath();
    ctx.moveTo(cross.x * hpr, 0);
    ctx.lineTo(cross.x * hpr, h * vpr);
    ctx.moveTo(0, cross.y * vpr);
    ctx.lineTo(w * hpr, cross.y * vpr);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}
