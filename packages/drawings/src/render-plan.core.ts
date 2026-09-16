/**
 * render-plan.core — projeta desenhos logicos em formas de TELA. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ ESTE ARQUIVO E O GANHO DE DESEMPENHO DO PACOTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato chama `hitTest` a cada movimento do cursor. A implementacao ingenua
 * converte, dentro do `hitTest`, cada ancora de cada desenho de (tempo, preco)
 * para pixel — e conversao passa por `timeToIndex` + `logicalToCoordinate`, que
 * atravessam a escala do grafico.
 *
 * Com 200 desenhos de 2 ancoras isso da 400 conversoes por movimento, a
 * ~100 movimentos por segundo: 40.000 travessias de escala por segundo, para
 * responder uma pergunta cuja resposta nao mudou.
 *
 * Aqui a conversao acontece **uma vez por mudanca de viewport**. O movimento do
 * cursor le pixel ja calculado, e o hit-test vira comparacao de ponto flutuante.
 * Nao e micro-otimizacao: e a diferenca entre O(desenhos x movimentos) e
 * O(desenhos x mudancas de viewport).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CHAVE DE INVALIDACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O cache e invalidado por uma `ViewportEpoch` — um valor que muda quando
 * qualquer coisa que afeta a projecao muda: faixa visivel, tamanho do painel,
 * escala de preco, e a propria colecao de desenhos.
 *
 * ⚠️ Errar isso e pior que nao ter cache: desenho anexado a coordenada velha fica
 * visualmente correto e responde ao hit-test no lugar errado — o usuario clica na
 * linha e nada acontece, ou seleciona uma linha que esta noutro lugar. Por isso a
 * epoca inclui o tamanho do painel: redimensionar a janela nao dispara mudanca de
 * faixa visivel, e sem incluir o tamanho o cache sobreviveria a um resize.
 */

import {
  ANCHORS_REQUIRED,
  fibLevelsOf,
  isComplete,
  isVisible,
  type Drawing,
  type DrawingKind,
  type DrawingLineStyle,
} from './model.js';
import {
  HIT_TOLERANCE_PX,
  boxOfPoints,
  bothFinite,
  extendLineToBox,
  lerp,
  segmentIntersectsBox,
  viewportBox,
  type Box,
  type Point,
} from './geometry.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Conversores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que a projecao precisa saber do grafico.
 *
 * Injetado, nunca construido aqui: e o que mantem este arquivo puro e testavel
 * com conversores sinteticos.
 *
 * ⚠️ `timeToX` DEVE tolerar instante que nao e uma barra. O substrato nao tolera —
 * `timeToCoordinate` devolve `null` nesse caso, e usa-lo direto faria todo desenho
 * desaparecer ao trocar de periodo. A implementacao correta esta em
 * `chart-converters.ts`, via `timeToIndex(t, findNearest)` + `logicalToCoordinate`.
 */
export interface LogicalToScreen {
  /** Instante (epoch segundos) -> X em pixel, ou `null` se impossivel. */
  timeToX(timeSec: number): number | null;
  /** Preco -> Y em pixel, ou `null` se impossivel. */
  priceToY(price: number): number | null;
  /** Largura da area de plotagem, em pixel. */
  width(): number;
  /** Altura da area de plotagem, em pixel. */
  height(): number;
}

/**
 * Identidade da projecao corrente.
 *
 * Duas epocas iguais garantem que a mesma ancora projeta no mesmo pixel. E o
 * contrato do cache.
 */
export interface ViewportEpoch {
  readonly fromSec: number;
  readonly toSec: number;
  readonly width: number;
  readonly height: number;
  /** Preco no topo e na base da area visivel — pega mudanca de escala de preco. */
  readonly topPrice: number;
  readonly bottomPrice: number;
}

/** As duas epocas descrevem a mesma projecao? */
export function sameEpoch(a: ViewportEpoch | null, b: ViewportEpoch | null): boolean {
  if (a === null || b === null) return false;
  return (
    a.fromSec === b.fromSec &&
    a.toSec === b.toSec &&
    a.width === b.width &&
    a.height === b.height &&
    a.topPrice === b.topPrice &&
    a.bottomPrice === b.bottomPrice
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo resolvido
// ═════════════════════════════════════════════════════════════════════════════

/** Estilo com todos os defaults aplicados — o desenho nao precisa decidir nada. */
export interface ResolvedStyle {
  readonly color: string;
  readonly lineWidth: number;
  readonly lineStyle: DrawingLineStyle;
  readonly fill: string | null;
  readonly label: string | null;
}

/** Cor default: ambar, que le bem sobre fundo escuro e sobre o heatmap. */
export const DEFAULT_COLOR = '#e9c46a';

/** Aplica os defaults de estilo. */
export function resolveStyle(d: Drawing): ResolvedStyle {
  const s = d.style;
  return {
    color: s?.color ?? DEFAULT_COLOR,
    lineWidth: s?.lineWidth ?? 1,
    lineStyle: s?.lineStyle ?? 'SOLID',
    fill: s?.fill ?? null,
    label: s?.label ?? null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Forma de tela
// ═════════════════════════════════════════════════════════════════════════════

/** Um traco a desenhar e a testar. */
export interface Stroke {
  readonly a: Point;
  readonly b: Point;
}

/** Uma linha de nivel de Fibonacci, ja projetada. */
export interface FibLine {
  readonly level: number;
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
}

/**
 * Um desenho projetado em pixel — a unidade que o desenho e o hit-test consomem.
 *
 * `points` sao as ancoras projetadas, na MESMA ordem do modelo: e por isso que o
 * indice de alca devolvido pelo hit-test pode ser usado direto em `withAnchor`.
 */
export interface ScreenDrawing {
  readonly id: string;
  readonly kind: DrawingKind;
  /** Ancoras em pixel, na ordem do modelo. Alca `i` corresponde a ancora `i`. */
  readonly points: readonly Point[];
  /** Tracos a pintar e a testar. Vazio para desenho so de regiao. */
  readonly strokes: readonly Stroke[];
  /** Regiao preenchida, quando houver (`RECTANGLE`). */
  readonly region: Box | null;
  /** Niveis de Fibonacci projetados. */
  readonly fibLines: readonly FibLine[];
  /** Caixa envolvente COM a folga de tolerancia, para o prefiltro. */
  readonly box: Box;
  /** Bloqueado: pinta, mas nao participa do hit-test. */
  readonly locked: boolean;
  readonly style: ResolvedStyle;
}

/** Resultado da projecao de uma colecao. */
export interface RenderPlan {
  readonly epoch: ViewportEpoch;
  readonly items: readonly ScreenDrawing[];
  /** Quantos desenhos foram descartados por caírem fora da area visivel. */
  readonly culled: number;
  /** Quantos foram descartados por o orcamento estourar. */
  readonly dropped: number;
}

/** Teto de desenhos projetados por passada. */
export const MAX_DRAWINGS_DEFAULT = 500;

// ═════════════════════════════════════════════════════════════════════════════
// A projecao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Projeta a colecao de desenhos em formas de tela.
 *
 * Ordem de trabalho, do mais barato ao mais caro — de proposito:
 *  1. descarta oculto e incompleto (comparacao de campo);
 *  2. projeta as ancoras (a parte cara, uma vez cada);
 *  3. recorta o que nao cruza a area visivel;
 *  4. deriva tracos, regiao e niveis.
 *
 * Nunca lanca: ancora que nao projeta simplesmente nao entra.
 *
 * @param drawings  a colecao logica
 * @param conv      conversores do grafico
 * @param epoch     identidade da projecao, para o cache do chamador
 * @param maxItems  teto de itens; excedente e contado em `dropped`
 */
export function buildRenderPlan(
  drawings: readonly Drawing[],
  conv: LogicalToScreen,
  epoch: ViewportEpoch,
  maxItems: number = MAX_DRAWINGS_DEFAULT,
): RenderPlan {
  const largura = conv.width();
  const altura = conv.height();
  // A folga do recorte e a propria tolerancia: desenho a 7 px de entrar na tela
  // ainda pode ser acertado pelo cursor na borda.
  const recorte = viewportBox(largura, altura, HIT_TOLERANCE_PX);

  const items: ScreenDrawing[] = [];
  let culled = 0;
  let dropped = 0;

  for (const d of drawings) {
    if (!isVisible(d) || !isComplete(d)) continue;

    if (items.length >= maxItems) {
      dropped += 1;
      continue;
    }

    const forma = projectOne(d, conv, recorte, largura, altura);
    if (forma === null) {
      culled += 1;
      continue;
    }
    items.push(forma);
  }

  return { epoch, items, culled, dropped };
}

/** Projeta um desenho. `null` = nao projetavel ou fora da area visivel. */
function projectOne(
  d: Drawing,
  conv: LogicalToScreen,
  recorte: Box,
  largura: number,
  altura: number,
): ScreenDrawing | null {
  const exigidas = ANCHORS_REQUIRED[d.kind];
  const pontos: Point[] = [];

  for (let i = 0; i < exigidas; i++) {
    const a = d.anchors[i];
    if (a === undefined) return null;
    const x = conv.timeToX(a.timeSec);
    const y = conv.priceToY(a.price);
    if (x === null || y === null || !bothFinite(x, y)) return null;
    pontos.push({ x, y });
  }

  const style = resolveStyle(d);
  const locked = d.locked === true;
  const p0 = pontos[0];
  if (p0 === undefined) return null;

  switch (d.kind) {
    case 'HORIZONTAL_LINE': {
      // Infinita no tempo: vai de borda a borda. Recortar pelo X da ancora seria
      // errado — a ancora e so onde o usuario clicou, nao o comeco da linha.
      if (p0.y < recorte.minY || p0.y > recorte.maxY) return null;
      const strokes: Stroke[] = [{ a: { x: 0, y: p0.y }, b: { x: largura, y: p0.y } }];
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes,
        region: null,
        fibLines: [],
        // A caixa cobre a largura toda: a linha e acertavel em qualquer X.
        box: { minX: 0, maxX: largura, minY: p0.y - HIT_TOLERANCE_PX, maxY: p0.y + HIT_TOLERANCE_PX },
        locked,
        style,
      };
    }

    case 'VERTICAL_LINE': {
      if (p0.x < recorte.minX || p0.x > recorte.maxX) return null;
      const strokes: Stroke[] = [{ a: { x: p0.x, y: 0 }, b: { x: p0.x, y: altura } }];
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes,
        region: null,
        fibLines: [],
        box: { minX: p0.x - HIT_TOLERANCE_PX, maxX: p0.x + HIT_TOLERANCE_PX, minY: 0, maxY: altura },
        locked,
        style,
      };
    }

    case 'TRENDLINE':
    case 'MEASURE': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      // ⚠️ Intersecao de SEGMENTO com a caixa, nao caixa-contra-caixa: uma linha
      // longa com as duas pontas fora da tela pode cruzar o meio dela, e o teste
      // de caixa das pontas a descartaria justamente no zoom de perto.
      if (!segmentIntersectsBox(p0.x, p0.y, p1.x, p1.y, recorte)) return null;
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes: [{ a: p0, b: p1 }],
        region: null,
        fibLines: [],
        box: boxOfPoints(pontos, HIT_TOLERANCE_PX) ?? recorte,
        locked,
        style,
      };
    }

    case 'RAY':
    case 'EXTENDED_LINE': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      const modo =
        d.kind === 'EXTENDED_LINE'
          ? 'LINE'
          : d.rayDirection === 'BACKWARD'
            ? 'RAY_BACKWARD'
            : 'RAY_FORWARD';
      // Recortar na borda em vez de desenhar com coordenada gigante: o canvas
      // perde precisao de rasterizacao em magnitude alta.
      const recortado = extendLineToBox(p0.x, p0.y, p1.x, p1.y, recorte, modo);
      if (recortado === null) return null;
      const [ini, fim] = recortado;
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes: [{ a: ini, b: fim }],
        region: null,
        fibLines: [],
        // A caixa e a do TRACO recortado, nao a das ancoras: a reta e acertavel
        // onde ela aparece, e nao apenas entre os dois cliques do usuario.
        box: boxOfPoints([ini, fim], HIT_TOLERANCE_PX) ?? recorte,
        locked,
        style,
      };
    }

    case 'RECTANGLE': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      const regiao: Box = {
        minX: Math.min(p0.x, p1.x),
        maxX: Math.max(p0.x, p1.x),
        minY: Math.min(p0.y, p1.y),
        maxY: Math.max(p0.y, p1.y),
      };
      if (
        regiao.maxX < recorte.minX ||
        regiao.minX > recorte.maxX ||
        regiao.maxY < recorte.minY ||
        regiao.minY > recorte.maxY
      ) {
        return null;
      }
      const cantos: Stroke[] = [
        { a: { x: regiao.minX, y: regiao.minY }, b: { x: regiao.maxX, y: regiao.minY } },
        { a: { x: regiao.maxX, y: regiao.minY }, b: { x: regiao.maxX, y: regiao.maxY } },
        { a: { x: regiao.maxX, y: regiao.maxY }, b: { x: regiao.minX, y: regiao.maxY } },
        { a: { x: regiao.minX, y: regiao.maxY }, b: { x: regiao.minX, y: regiao.minY } },
      ];
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes: cantos,
        region: regiao,
        fibLines: [],
        box: {
          minX: regiao.minX - HIT_TOLERANCE_PX,
          maxX: regiao.maxX + HIT_TOLERANCE_PX,
          minY: regiao.minY - HIT_TOLERANCE_PX,
          maxY: regiao.maxY + HIT_TOLERANCE_PX,
        },
        locked,
        style,
      };
    }

    case 'FIB_RETRACEMENT': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      const x1 = Math.min(p0.x, p1.x);
      const x2 = Math.max(p0.x, p1.x);
      // ⚠️ A interpolacao usa a ORDEM das ancoras, nao o min/max: o nivel 0 fica
      // na primeira ancora e o 1 na segunda. Normalizar inverteria a retracao de
      // quem tracou de cima para baixo, que e como se marca um movimento de queda.
      const fibLines: FibLine[] = fibLevelsOf(d).map((level) => ({
        level,
        y: lerp(p0.y, p1.y, level),
        x1,
        x2,
      }));
      const ys = fibLines.map((l) => l.y);
      const minY = Math.min(...ys, p0.y, p1.y);
      const maxY = Math.max(...ys, p0.y, p1.y);
      if (x2 < recorte.minX || x1 > recorte.maxX || maxY < recorte.minY || minY > recorte.maxY) {
        return null;
      }
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        // O traco diagonal entre as ancoras faz parte da ferramenta: e ele que
        // mostra o movimento que esta sendo retraido.
        strokes: [{ a: p0, b: p1 }],
        region: null,
        fibLines,
        box: {
          minX: x1 - HIT_TOLERANCE_PX,
          maxX: x2 + HIT_TOLERANCE_PX,
          minY: minY - HIT_TOLERANCE_PX,
          maxY: maxY + HIT_TOLERANCE_PX,
        },
        locked,
        style,
      };
    }

    default: {
      // Ferramenta nova sem projecao: nao desenha, em vez de desenhar errado.
      return null;
    }
  }
}
