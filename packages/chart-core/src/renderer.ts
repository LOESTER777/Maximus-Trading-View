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
import {
  chooseTickUnit,
  formatDiaMes,
  formatHoraMinuto,
  formatHoraMinutoSegundo,
  formatMesAno,
  mudouODia,
  mudouOMes,
  timePartsInZone,
  type TimeParts,
} from './time-format.core.js';

/** Tema de cores do desenho. */
export interface RenderTheme {
  readonly background: string;
  readonly text: string;
  readonly grid: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly crosshair: string;
  /** Fundo das caixas de rotulo do crosshair (opaco, sobrepoe grade/rotulos). */
  readonly crosshairLabelBg: string;
  /** Texto das caixas de rotulo do crosshair. */
  readonly crosshairLabelText: string;
  readonly gridVisible: boolean;
}

export const DEFAULT_THEME: RenderTheme = {
  background: 'transparent',
  text: '#94a3b8',
  grid: 'rgba(148,163,184,0.10)',
  upColor: '#16c784',
  downColor: '#ea3943',
  crosshair: 'rgba(148,163,184,0.5)',
  // Caixa escura com texto claro — contraste alto para leitura instantanea sobre
  // qualquer fundo de vela. Cor solida, nao translucida: precisa TAPAR o rotulo
  // fixo do eixo que fica atras.
  crosshairLabelBg: '#334155',
  crosshairLabelText: '#e2e8f0',
  gridVisible: true,
};

/** Posicao do crosshair, ou `null` quando o cursor esta fora. */
export interface CrosshairState {
  readonly x: number;
  readonly y: number;
}

/**
 * Altura reservada, em pixel logico, para a faixa de rotulos de data/hora na base.
 *
 * ⚠️ 22 px e escolha medida, nao arbitraria: uma fonte de 11 px (a mesma do eixo
 * de preco) precisa de ~15 px de caixa; sobram ~7 px de respiro acima e abaixo
 * para o rotulo nao encostar na ultima vela nem na borda do canvas. Abaixo de ~18
 * o texto cola na grade; acima de ~26 rouba altura util do preco sem ganho de
 * leitura.
 */
export const TIME_AXIS_HEIGHT = 22;

/**
 * Configuracao do eixo de tempo entregue a pane que o desenha (a de baixo).
 *
 * So a pane inferior recebe isto; as de cima passam `null`. O eixo de tempo e um
 * so, compartilhado — desenha-lo em cada pane repetiria os rotulos.
 */
export interface TimeAxisConfig {
  /** Altura da faixa de rotulos, em pixel logico. */
  readonly height: number;
  /** Fuso IANA para os rotulos. Ex.: `'America/Sao_Paulo'`. */
  readonly timeZone: string;
  /** Mostrar segundos na caixa de crosshair (grafico de tick/segundo). */
  readonly secondsVisible: boolean;
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
  /** Preco sob o cursor, ja formatado, para a caixa de crosshair no eixo. */
  priceLabel: string | null = null,
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

  if (crosshair !== null) {
    drawCrosshair(ctx, hpr, vpr, crosshair, w, h, theme);
    // Caixa de PRECO na borda direita, na altura do cursor. E por-pane porque cada
    // pane tem sua propria escala de preco.
    if (priceLabel !== null && crosshair.y >= 0 && crosshair.y <= h) {
      drawPriceCrosshairLabel(ctx, hpr, vpr, crosshair.y, w, priceLabel, theme);
    }
  }
}

/**
 * Desenha o eixo de TEMPO na faixa reservada abaixo das panes.
 *
 * ⭐ Standalone e chamado UMA vez pelo motor, na tira `[0, stripHeight]` do proprio
 * sistema de coordenada (o chamador ja transladou para o topo da tira). O eixo de
 * tempo e compartilhado por todas as panes — desenha-lo aqui, fora do laco de
 * panes, evita repetir os rotulos e mantem a tira livre das velas.
 *
 * `crosshairX` (pixel logico) e `timeLabel` (ja formatado) desenham a caixa de
 * data/hora sob o cursor; `null` os omite.
 */
export function renderTimeAxis(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  width: number,
  stripHeight: number,
  cfg: TimeAxisConfig,
  theme: RenderTheme,
  crosshairX: number | null,
  timeLabel: string | null,
): void {
  if (width <= 0 || stripHeight <= 0) return;
  ctx.save();
  try {
    drawTimeLabels(ctx, hpr, vpr, ts, width, stripHeight, cfg, theme);
    if (crosshairX !== null && timeLabel !== null && crosshairX >= 0 && crosshairX <= width) {
      drawTimeCrosshairLabel(ctx, hpr, vpr, crosshairX, width, stripHeight, timeLabel, theme);
    }
  } finally {
    ctx.restore();
  }
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

/**
 * Largura de um texto, tolerante a contexto inerte.
 *
 * ⚠️ O contexto no-op do jsdom (`chart.ts`) devolve `undefined` de `measureText`,
 * e `undefined.width` lancaria dentro do ciclo de render — derrubando o grafico
 * inteiro num ambiente que e REQUISITO de teste. Estima por `~6.2 px/char` (largura
 * media de uma monospace de 11 px em bitmap) quando a medicao real nao existe.
 */
function medirLargura(ctx: CanvasRenderingContext2D, texto: string, fontePx: number): number {
  const m = ctx.measureText(texto) as TextMetrics | undefined;
  if (m !== undefined && Number.isFinite(m.width) && m.width > 0) return m.width;
  return texto.length * fontePx * 0.62;
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
// Eixo de tempo — rotulos de data/hora na base
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Desenha os rotulos de tempo na faixa reservada abaixo da area de plotagem.
 *
 * ⭐ O passo do rotulo muda com o zoom (ver `chooseTickUnit`): em zoom-in mostra
 * `HH:mm`, em zoom-out `dd/MMM` ou `MMM/yyyy`. E marca a virada de dia — a
 * primeira barra de um dia novo ganha a DATA, as demais a HORA — porque um eixo
 * intraday que so mostra hora nao diz de que dia ela e.
 *
 * Percorre so as barras VISIVEIS (indices inteiros dentro da janela), converte
 * cada uma em pixel, e pinta um rotulo a cada `passo` barras para nao amontoar.
 */
function drawTimeLabels(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  w: number,
  stripHeight: number,
  cfg: TimeAxisConfig,
  theme: RenderTheme,
): void {
  const lr = visibleLogicalRange(ts);
  if (lr === null) return;
  const n = ts.times.length;
  if (n === 0) return;

  const de = Math.max(0, Math.floor(lr.from));
  const ate = Math.min(n - 1, Math.ceil(lr.to));
  if (ate < de) return;

  // Intervalo tipico entre barras (mediana grosseira: diferenca central da janela).
  const stepSeconds = medianStepSeconds(ts, de, ate);
  const unit = chooseTickUnit(ts.barSpacing, stepSeconds);

  // Passo em barras: quantas barras pular entre rotulos para o espacamento visual
  // ficar em torno de ~80 px. Piso de 1.
  const passo = Math.max(1, Math.round(80 / Math.max(ts.barSpacing, 0.0001)));

  // A tira ja foi transladada para sua origem pelo chamador: centro vertical dela.
  const yTexto = (stripHeight / 2) * vpr;
  ctx.save();
  try {
    ctx.fillStyle = theme.text;
    ctx.font = `${Math.round(11 * vpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let anterior: TimeParts | null = null;
    for (let i = de; i <= ate; i += passo) {
      const t = ts.times[i];
      if (t === undefined) continue;
      const p = timePartsInZone(t, cfg.timeZone);
      if (p === null) continue;

      const x = logicalToCoordinate(ts, i);
      if (x === null) continue;
      const cx = x * hpr;
      if (cx < 0 || cx > w * hpr) {
        anterior = p;
        continue;
      }

      const rotulo = rotuloParaUnidade(unit, p, anterior);
      ctx.fillText(rotulo, cx, yTexto);
      anterior = p;
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Texto do rotulo conforme a unidade e a virada de calendario.
 *
 * `anterior` e a barra rotulada imediatamente antes; a comparacao com ela decide
 * se este rotulo marca uma virada (dia/mes) e ganha a forma "grossa" (data), ou se
 * e continuacao e ganha a forma "fina" (hora).
 */
function rotuloParaUnidade(
  unit: ReturnType<typeof chooseTickUnit>,
  p: TimeParts,
  anterior: TimeParts | null,
): string {
  switch (unit) {
    case 'second':
      // Em segundo/minuto marca a virada de dia com a data; senao HH:mm:ss / HH:mm.
      return anterior !== null && mudouODia(anterior, p) ? formatDiaMes(p) : formatHoraMinutoSegundo(p);
    case 'minute':
    case 'hour':
      return anterior !== null && mudouODia(anterior, p) ? formatDiaMes(p) : formatHoraMinuto(p);
    case 'day':
      // Em escala de dias, a virada de mes ganha `MMM/yyyy`; os demais `dd/MMM`.
      return anterior !== null && mudouOMes(anterior, p) ? formatMesAno(p) : formatDiaMes(p);
    case 'month':
      return formatMesAno(p);
  }
}

/** Mediana grosseira do intervalo entre barras visiveis, em segundos. */
function medianStepSeconds(ts: TimeScaleState, de: number, ate: number): number {
  if (ate <= de) {
    // Janela de uma barra so: usa qualquer par disponivel.
    if (ts.times.length >= 2) {
      const a = ts.times[ts.times.length - 2] as number;
      const b = ts.times[ts.times.length - 1] as number;
      return Math.max(1, b - a);
    }
    return 60;
  }
  const meio = (de + ate) >> 1;
  const a = ts.times[meio];
  const b = ts.times[meio + 1] ?? ts.times[meio - 1];
  if (a === undefined || b === undefined) return 60;
  return Math.max(1, Math.abs((b as number) - (a as number)));
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
  else if (s.type === 'Bar') drawBars(ctx, hpr, vpr, ts, ps, s, de, ate, theme);
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

/**
 * Barras OHLC (bar chart): a MESMA `CandlestickData` desenhada como barra de tick.
 *
 * ⭐ Nao ha corpo. Cada barra e uma linha vertical do `high` ao `low`, com um tick
 * horizontal para a ESQUERDA na altura do `open` e outro para a DIREITA na altura
 * do `close`. E a leitura classica de fita: abre a esquerda, fecha a direita. A
 * cor segue a direcao (alta/baixa), igual a vela — up quando `close >= open`.
 *
 * Isto NAO transforma dado: Heikin-Ashi e Renko produzem `CandlestickData` novo e
 * usam `drawCandles`. Barra OHLC so muda o traco da mesma vela; por isso e um
 * `SeriesType` proprio (`'Bar'`) e vive no renderer, nao em `candle-transforms`.
 */
function drawBars(
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
  // Comprimento do tick, em pixel de bitmap: metade do espacamento de barra, com
  // piso de 1 px para nao sumir no zoom-out (o antialias apaga tick menor que 1).
  const tick = Math.max(1, ts.barSpacing * 0.4 * hpr);
  const barras = s.data as readonly CandleLike[];

  // Uma passada por cor, como no candle: agrupa o strokeStyle e reduz troca de
  // estado do contexto.
  for (const dir of ['up', 'down'] as const) {
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
      const yO = priceToCoordinate(ps, c.open);
      const yC = priceToCoordinate(ps, c.close);
      if (yH === null || yL === null || yO === null || yC === null) continue;

      // Linha vertical do range high-low.
      ctx.moveTo(cx, yH * vpr);
      ctx.lineTo(cx, yL * vpr);
      // Tick de abertura, para a esquerda.
      ctx.moveTo(cx - tick, yO * vpr);
      ctx.lineTo(cx, yO * vpr);
      // Tick de fechamento, para a direita.
      ctx.moveTo(cx, yC * vpr);
      ctx.lineTo(cx + tick, yC * vpr);
    }
    ctx.stroke();
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

/**
 * Caixa de PRECO do crosshair, ancorada na borda direita, na altura do cursor.
 *
 * ⭐ E o que todo grafico de mercado tem: o operador le o valor exato sob o cursor
 * sem contar pixel. A caixa e opaca — TAPA o rotulo fixo do eixo que fica atras.
 */
function drawPriceCrosshairLabel(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  cursorY: number,
  w: number,
  texto: string,
  theme: RenderTheme,
): void {
  ctx.save();
  try {
    const fontePx = Math.round(11 * vpr);
    ctx.font = `${fontePx}px ui-monospace, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const padX = 6 * hpr;
    const padY = 3 * vpr;
    const alturaCaixa = fontePx + padY * 2;
    const larguraCaixa = medirLargura(ctx, texto, fontePx) + padX * 2;
    const yc = cursorY * vpr;
    const xDireita = w * hpr;
    ctx.fillStyle = theme.crosshairLabelBg;
    ctx.fillRect(xDireita - larguraCaixa, yc - alturaCaixa / 2, larguraCaixa, alturaCaixa);
    ctx.fillStyle = theme.crosshairLabelText;
    ctx.fillText(texto, xDireita - padX, yc);
  } finally {
    ctx.restore();
  }
}

/**
 * Caixa de DATA/HORA do crosshair, ancorada na tira do eixo de tempo, na coluna
 * do cursor. A tira ja foi transladada para sua origem pelo chamador.
 */
function drawTimeCrosshairLabel(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  cursorX: number,
  w: number,
  stripHeight: number,
  texto: string,
  theme: RenderTheme,
): void {
  ctx.save();
  try {
    const fontePx = Math.round(11 * vpr);
    ctx.font = `${fontePx}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 6 * hpr;
    const larguraCaixa = medirLargura(ctx, texto, fontePx) + padX * 2;
    const meia = larguraCaixa / 2;
    let cx = cursorX * hpr;
    // Prende a caixa dentro do canvas para nao vazar nas bordas.
    if (cx - meia < 0) cx = meia;
    if (cx + meia > w * hpr) cx = w * hpr - meia;
    const yc = (stripHeight / 2) * vpr;
    ctx.fillStyle = theme.crosshairLabelBg;
    ctx.fillRect(cx - meia, 0, larguraCaixa, stripHeight * vpr);
    ctx.fillStyle = theme.crosshairLabelText;
    ctx.fillText(texto, cx, yc);
  } finally {
    ctx.restore();
  }
}
