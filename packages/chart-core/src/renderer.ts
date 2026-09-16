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

import type { WatermarkOptions } from './contracts.js';
import type { SeriesModel } from './series.js';
import {
  indexToTime,
  logicalToCoordinate,
  timeToIndex,
  visibleLogicalRange,
  visibleTickIndices,
  type TimeScaleState,
} from './time-scale.core.js';
import { priceToCoordinate, priceTicks, type PriceScaleState } from './price-scale.core.js';
import { formatPrice, type PriceFormatOptions } from './price-format.core.js';
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
  /** Grade HORIZONTAL (niveis de preco). */
  readonly gridVisible: boolean;
  /**
   * Grade VERTICAL (instantes do eixo de tempo). Default DESLIGADA.
   *
   * ⚠️ Opcional no tipo de proposito: `RenderTheme` e superficie publica
   * (exportada no `index.ts`), e torna-lo obrigatorio quebraria todo tema montado
   * como literal la fora. Ausente = `false`, o comportamento historico.
   *
   * A decisao de nascer desligada e antiga e continua valendo: a linha vertical
   * cai exatamente sobre as velas e compete com o corpo delas. Quem quiser a
   * malha completa liga em `grid.vertLines.visible`.
   */
  readonly gridVertVisible?: boolean;
  /** Cor da grade vertical. Ausente = a mesma da horizontal. */
  readonly gridVert?: string;
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
  // Vertical desligada por default — ver o comentario no tipo.
  gridVertVisible: false,
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
  /**
   * A escala PRINCIPAL da pane (o preco). Manda na grade, no eixo desenhado e na
   * altura da area — mas NAO nas series: cada uma traz a sua.
   */
  ps: PriceScaleState,
  /**
   * As series com A ESCALA DE CADA UMA.
   *
   * ⭐ Recebe pares em vez de uma escala unica porque uma pane pode desenhar
   * grandezas de magnitude incompativel: preco (~130.000) e volume (0..40.000). Com
   * escala unica a autoescala misturava as duas e as velas ficavam esmagadas em
   * poucos pixels no topo — o grafico aparecia vazio.
   */
  series: ReadonlyArray<{ readonly model: SeriesModel; readonly scale: PriceScaleState }>,
  theme: RenderTheme,
  crosshair: CrosshairState | null,
  mostrarEixoPreco: boolean,
  /** Preco sob o cursor, ja formatado, para a caixa de crosshair no eixo. */
  priceLabel: string | null = null,
  /**
   * Formatacao de preco do eixo (tick/casas). Ausente => heuristica de amplitude.
   * So afeta os ROTULOS FIXOS do eixo; o rotulo de crosshair chega ja formatado
   * em `priceLabel` (o chamador aplica o mesmo formato la, para os dois baterem).
   */
  priceFormat?: PriceFormatOptions,
  /**
   * Marca d'agua desta pane. O motor passa isto SO na pane principal — repetir a
   * marca em cada sub-painel encheria a tela de texto fantasma.
   */
  watermark?: WatermarkOptions,
): void {
  const w = ts.width;
  const h = ps.height;
  if (w <= 0 || h <= 0) return;

  if (theme.background !== 'transparent') {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w * hpr, h * vpr);
  }

  // ⭐ A marca d'agua vem antes de TUDO que carrega dado (grade inclusa): ela e
  // fundo. Depois da grade ela ja competiria com as linhas de preco.
  if (watermark !== undefined) drawWatermark(ctx, hpr, vpr, w, h, watermark);

  drawGrid(ctx, hpr, vpr, ts, ps, w, theme);

  // Cada serie desenha contra A SUA escala, nao contra a principal.
  for (const s of series) drawSeries(ctx, hpr, vpr, ts, s.scale, s.model, theme);

  if (mostrarEixoPreco) drawPriceAxis(ctx, hpr, vpr, ps, w, theme, priceFormat);

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

/**
 * Grade: horizontais nos niveis de preco redondos, verticais nos instantes do eixo.
 *
 * ⭐ As duas sao INDEPENDENTES (`gridVisible` / `gridVertVisible`), e a vertical
 * nasce desligada — ela cai sobre o corpo das velas e compete com elas. O default
 * historico e mantido; o que mudou e que ligar passou a funcionar (antes o
 * contrato tinha `grid.vertLines.visible` e o renderer simplesmente nao lia).
 *
 * ⚠️ As verticais saem de `visibleTickIndices`, a MESMA fonte dos rotulos de
 * tempo. Reimplementar o passo aqui faria a linha aparecer em instante sem rotulo
 * ao primeiro ajuste de espacamento.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  w: number,
  theme: RenderTheme,
): void {
  const h = ps.height;

  if (theme.gridVisible) {
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

  if (theme.gridVertVisible === true) {
    ctx.strokeStyle = theme.gridVert ?? theme.grid;
    ctx.lineWidth = Math.max(1, Math.min(hpr, vpr));
    ctx.beginPath();
    for (const i of visibleTickIndices(ts)) {
      const x = logicalToCoordinate(ts, i);
      if (x === null || x < 0 || x > w) continue;
      // `+0.5` no pixel de bitmap: sem isso o traco de 1 px cai entre dois pixels
      // e o antialias o transforma em duas linhas cinzas de meia intensidade.
      ctx.moveTo(Math.round(x * hpr) + 0.5, 0);
      ctx.lineTo(Math.round(x * hpr) + 0.5, h * vpr);
    }
    ctx.stroke();
  }
}

/**
 * Marca d'agua central — simbolo, mesa, aviso de ambiente.
 *
 * ⚠️ **Nao usa `textAlign: 'center'` de proposito.** Centralizar pelo contexto
 * daria a mesma imagem com menos codigo, mas esconderia o unico ponto onde o
 * ambiente sem `measureText` importa: `medirLargura` ESTIMA a largura no contexto
 * inerte do jsdom (mesma tolerancia de `larguraDoTexto` na camada de primitives).
 * Calculando o `x` a mao, o comportamento em ambiente inerte fica observavel e
 * testavel — e a caixa medida serve tambem para nao vazar da pane.
 *
 * Alpha 0.08: medido contra fundo escuro — abaixo de ~0.05 a marca desaparece,
 * acima de ~0.15 ela "suja" a leitura do pavio das velas que passam por cima.
 */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  w: number,
  h: number,
  wm: WatermarkOptions,
): void {
  if (wm.visible === false) return;
  const texto = wm.text;
  if (typeof texto !== 'string' || texto.length === 0) return;

  ctx.save();
  try {
    const fontePx = Math.round((wm.fontSize ?? 44) * vpr);
    ctx.font = `600 ${fontePx}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = wm.color ?? '#94a3b8';

    const largura = medirLargura(ctx, texto, fontePx);
    // Centraliza pela largura medida (ou estimada). Se o texto for mais largo que a
    // pane, ancora em 0 em vez de sair pela esquerda — melhor cortado a direita
    // que comecando fora da tela.
    const x = Math.max(0, (w * hpr - largura) / 2);
    ctx.fillText(texto, x, (h / 2) * vpr);
  } finally {
    ctx.restore();
  }
}

function drawPriceAxis(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ps: PriceScaleState,
  w: number,
  theme: RenderTheme,
  priceFormat?: PriceFormatOptions,
): void {
  ctx.fillStyle = theme.text;
  ctx.font = `${Math.round(11 * vpr)}px ui-monospace, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Com `priceFormat` (tick/casas do instrumento) o rotulo vem do formatador
  // puro; sem ele, cai na heuristica de amplitude — o comportamento anterior.
  const usaTick = priceFormat !== undefined;
  const casas = decimalsFor(ps.topPrice - ps.bottomPrice);
  for (const p of priceTicks(ps)) {
    const y = priceToCoordinate(ps, p);
    if (y === null) continue;
    const texto = usaTick ? formatPrice(p, priceFormat) : p.toFixed(casas);
    ctx.fillText(texto, (w - 6) * hpr, y * vpr);
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
 * Percorre so as barras marcadas por `visibleTickIndices` — a MESMA fonte que a
 * grade vertical consome, para rotulo e linha nunca cairem em instantes diferentes.
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
  const indices = visibleTickIndices(ts);
  if (indices.length === 0) return;

  const de = indices[0] as number;
  const ate = indices[indices.length - 1] as number;

  // Intervalo tipico entre barras (mediana grosseira: diferenca central da janela).
  const stepSeconds = medianStepSeconds(ts, de, ate);
  const unit = chooseTickUnit(ts.barSpacing, stepSeconds);

  // A tira ja foi transladada para sua origem pelo chamador: centro vertical dela.
  const yTexto = (stripHeight / 2) * vpr;
  ctx.save();
  try {
    ctx.fillStyle = theme.text;
    ctx.font = `${Math.round(11 * vpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let anterior: TimeParts | null = null;
    for (const i of indices) {
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

/**
 * A janela visivel de UMA serie: quais indices do array dela desenhar, e em que
 * posicao do EIXO cada um vai.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ O DEFEITO QUE ISTO CORRIGE — INDICE DE ARRAY ≠ INDICE LOGICO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O renderer desenhava toda serie assim: `logicalToCoordinate(ts, i)`, com `i`
 * sendo o indice no array DA PROPRIA SERIE. Isso equivale a afirmar que
 * `serie.data[i]` e a barra logica `i` — verdade apenas para a serie que ORIGINA
 * o eixo (as velas, ver `rebuildTimes`).
 *
 * Consequencia medida em tela (240 velas, EMA 20): o plotter de indicadores
 * descarta os pontos de aquecimento, entao a serie da EMA tinha **221** pontos.
 * Desenhados nas colunas 0..220, a linha:
 *  - **terminava 19 barras antes da ultima vela** — o sintoma que o usuario viu;
 *  - e estava **deslocada 19 barras para a ESQUERDA**, ou seja o valor da barra 19
 *    aparecia na coluna da barra 0. O indicador mentia sobre a posicao, nao apenas
 *    "faltava um pedaco".
 *
 * A correcao e posicionar por TEMPO: cada ponto vai onde o `time` dele cai no
 * eixo. Isso conserta a classe inteira do defeito e passa a suportar serie
 * ESPARSA — indicador com buraco no meio (SuperTrend que vira `null` na inversao),
 * serie de outro periodo, barra descartada por dado sujo.
 *
 * ⚠️ **Caminho rapido preservado.** Quando a serie esta alinhada ao eixo (mesmo
 * comprimento e mesmas pontas), o indice de array E o indice logico, e a conversao
 * por tempo seria desperdicio — as velas caem sempre nesse caso, que e o mais
 * quente do laco. So a serie desalinhada paga a busca binaria.
 */
interface JanelaSerie {
  /** Primeiro indice do array da serie a desenhar. */
  readonly de: number;
  /** Ultimo indice do array da serie a desenhar. */
  readonly ate: number;
  /** Posicao no EIXO do ponto `i` do array. `null` = sem posicao (nao desenha). */
  readonly logical: (i: number) => number | null;
}

/** Primeiro indice cujo `time` e >= `t`. Busca binaria; serie ordenada por tempo. */
function primeiroDesde(data: readonly { readonly time: number }[], t: number): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const d = data[mid];
    if (d !== undefined && d.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Calcula a janela de desenho de uma serie. `null` quando nao ha o que desenhar.
 */
function janelaDaSerie(ts: TimeScaleState, s: SeriesModel): JanelaSerie | null {
  const lr = visibleLogicalRange(ts);
  if (lr === null) return null;
  const n = s.data.length;
  if (n === 0) return null;
  const m = ts.times.length;

  // ── Caminho rapido: serie ALINHADA ao eixo ────────────────────────────────
  //
  // Mesmo comprimento E mesmas pontas => o indice de array e o indice logico.
  // Conferir as pontas (e nao so o comprimento) e o que impede uma serie de
  // mesmo tamanho mas deslocada no tempo de entrar aqui por engano.
  const primeiro = s.data[0];
  const ultimo = s.data[n - 1];
  if (
    n === m &&
    primeiro !== undefined &&
    ultimo !== undefined &&
    primeiro.time === ts.times[0] &&
    ultimo.time === ts.times[m - 1]
  ) {
    const de = Math.max(0, Math.floor(lr.from) - 1);
    const ate = Math.min(n - 1, Math.ceil(lr.to) + 1);
    if (ate < de) return null;
    return { de, ate, logical: (i) => i };
  }

  // ── Caminho por TEMPO: serie desalinhada (indicador aquecendo, esparsa) ───
  //
  // Traduz as bordas da janela logica para TEMPO e acha, por busca binaria, o
  // trecho do array da serie que cai nela. Uma de folga de cada lado para o traco
  // de linha entrar e sair pela borda em vez de terminar dentro da tela.
  const tDe = indexToTime(ts, lr.from - 1);
  const tAte = indexToTime(ts, lr.to + 1);

  const de = tDe === null ? 0 : Math.max(0, primeiroDesde(s.data, tDe) - 1);
  const ate =
    tAte === null ? n - 1 : Math.min(n - 1, primeiroDesde(s.data, tAte));
  if (ate < de) return null;

  return {
    de,
    ate,
    logical: (i) => {
      const d = s.data[i];
      if (d === undefined) return null;
      // `findNearest = true`: um ponto cujo tempo nao e barra exata (indicador de
      // outro periodo, ponto projetado) cai no indice FRACIONARIO interpolado, em
      // vez de perder a posicao. E o mesmo mecanismo que mantem desenho ancorado
      // no lugar ao trocar de periodo.
      return timeToIndex(ts, d.time, true);
    },
  };
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  theme: RenderTheme,
): void {
  const janela = janelaDaSerie(ts, s);
  if (janela === null) return;

  if (s.type === 'Candlestick') drawCandles(ctx, hpr, vpr, ts, ps, s, janela, theme);
  else if (s.type === 'Bar') drawBars(ctx, hpr, vpr, ts, ps, s, janela, theme);
  else if (s.type === 'Histogram') drawHistogram(ctx, hpr, vpr, ts, ps, s, janela, theme);
  else if (s.type === 'Band') drawBand(ctx, hpr, vpr, ts, ps, s, janela);
  else drawLineOrArea(ctx, hpr, vpr, ts, ps, s, janela);
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  janela: JanelaSerie,
  theme: RenderTheme,
): void {
  const { de, ate } = janela;
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

      const lg = janela.logical(i);
      if (lg === null) continue;
      const x = logicalToCoordinate(ts, lg);
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

      const lg = janela.logical(i);
      if (lg === null) continue;
      const x = logicalToCoordinate(ts, lg);
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
  janela: JanelaSerie,
  theme: RenderTheme,
): void {
  const { de, ate } = janela;
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

      const lg = janela.logical(i);
      if (lg === null) continue;
      const x = logicalToCoordinate(ts, lg);
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

/** Forma minima de um ponto de banda: a faixa [lower, upper] num instante. */
interface BandLike {
  readonly upper: number;
  readonly lower: number;
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  janela: JanelaSerie,
  theme: RenderTheme,
): void {
  const { de, ate } = janela;
  const larguraBarra = Math.max(1, ts.barSpacing * 0.7 * hpr);
  const yZero = priceToCoordinate(ps, 0);
  const base = yZero !== null ? yZero * vpr : ps.height * vpr;
  const pontos = s.data as readonly ValueLike[];

  for (let i = de; i <= ate; i++) {
    const d = pontos[i];
    if (d === undefined || !Number.isFinite(d.value)) continue;
    const lg = janela.logical(i);
    if (lg === null) continue;
    const x = logicalToCoordinate(ts, lg);
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
  janela: JanelaSerie,
): void {
  const { de, ate } = janela;
  const cor = (s.options.color as string) ?? '#38bdf8';
  const largura = ((s.options.lineWidth as number) ?? 1) * Math.min(hpr, vpr);

  ctx.strokeStyle = cor;
  ctx.lineWidth = Math.max(1, largura);
  ctx.beginPath();
  const pontos = s.data as readonly ValueLike[];
  let primeiro = true;
  // Extremos EFETIVAMENTE desenhados, em pixel — o fechamento da area precisa
  // deles, e nao das bordas da janela: com serie desalinhada ou ponto nao-finito,
  // o primeiro e o ultimo ponto pintados podem estar bem dentro da janela.
  let xPrimeiro: number | null = null;
  let xUltimo: number | null = null;
  for (let i = de; i <= ate; i++) {
    const d = pontos[i];
    if (d === undefined || !Number.isFinite(d.value)) continue;
    const lg = janela.logical(i);
    if (lg === null) continue;
    const x = logicalToCoordinate(ts, lg);
    const y = priceToCoordinate(ps, d.value);
    if (x === null || y === null) continue;
    if (primeiro) {
      ctx.moveTo(x * hpr, y * vpr);
      primeiro = false;
      xPrimeiro = x * hpr;
    } else {
      ctx.lineTo(x * hpr, y * vpr);
    }
    xUltimo = x * hpr;
  }
  ctx.stroke();

  if (s.type === 'Area' && xPrimeiro !== null && xUltimo !== null) {
    // Fecha o poligono contra a base, pelos extremos REAIS do traco.
    //
    // ⚠️ A versao anterior usava `logicalToCoordinate(ts, ate)!` — com `!`. Além de
    // assumir alinhamento entre indice de array e eixo, o `!` mentia: a funcao
    // devolve `null` para entrada nao-finita, e um `null!` viraria `NaN` no caminho
    // do canvas, apagando o preenchimento inteiro sem erro nenhum.
    ctx.lineTo(xUltimo, ps.height * vpr);
    ctx.lineTo(xPrimeiro, ps.height * vpr);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/**
 * Desenha a FAIXA preenchida de uma banda (Bollinger/Keltner) entre `upper` e
 * `lower`, com alpha baixo — o preenchimento tenue que da corpo a banda sem
 * competir com as velas.
 *
 * ⭐ O poligono e montado percorrendo o `upper` da esquerda para a direita e
 * voltando pelo `lower` da direita para a esquerda — o mesmo truque de "ida e
 * volta" da area, mas fechando entre DUAS series moveis em vez de contra a base.
 * Alpha 0.12: medido para a faixa "aparecer" sobre fundo escuro sem borrar a
 * vela; abaixo de ~0.08 some, acima de ~0.2 encardida a leitura do preco.
 *
 * ⚠️ Ponto com upper/lower nao-finito interrompe a faixa (fecha o poligono
 * corrente e recomeca), em vez de ligar por cima do buraco — durante o
 * aquecimento a banda nao existe, e uma faixa "chapada" ligando o vazio mentiria.
 */
function drawBand(
  ctx: CanvasRenderingContext2D,
  hpr: number,
  vpr: number,
  ts: TimeScaleState,
  ps: PriceScaleState,
  s: SeriesModel,
  janela: JanelaSerie,
): void {
  const { de, ate } = janela;
  const cor = (s.options.color as string) ?? '#38bdf8';
  const pontos = s.data as readonly BandLike[];

  ctx.save();
  try {
    ctx.fillStyle = cor;
    ctx.globalAlpha = 0.12;

    // Acumula os segmentos CONTIGUOS (sem buraco) e pinta cada um como um poligono
    // fechado ida-volta. `upper` na ida, `lower` na volta.
    let seg: Array<{ x: number; yU: number; yL: number }> = [];
    const pintar = (): void => {
      if (seg.length < 2) {
        seg = [];
        return;
      }
      ctx.beginPath();
      // Ida pelo topo.
      ctx.moveTo(seg[0]!.x, seg[0]!.yU);
      for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k]!.x, seg[k]!.yU);
      // Volta pela base.
      for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k]!.x, seg[k]!.yL);
      ctx.closePath();
      ctx.fill();
      seg = [];
    };

    for (let i = de; i <= ate; i++) {
      const d = pontos[i];
      if (d === undefined || !Number.isFinite(d.upper) || !Number.isFinite(d.lower)) {
        pintar();
        continue;
      }
      const lg = janela.logical(i);
      const x = lg === null ? null : logicalToCoordinate(ts, lg);
      const yU = priceToCoordinate(ps, d.upper);
      const yL = priceToCoordinate(ps, d.lower);
      if (x === null || yU === null || yL === null) {
        pintar();
        continue;
      }
      seg.push({ x: x * hpr, yU: yU * vpr, yL: yL * vpr });
    }
    pintar();
  } finally {
    ctx.restore();
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
