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
  rMultipleOf,
  isComplete,
  isVisible,
  type Drawing,
  type DrawingKind,
  type DrawingLineStyle,
} from './model.js';
import {
  HIT_TOLERANCE_PX,
  boxOfPoints,
  boxesIntersect,
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
/**
 * As cores das zonas de posicao.
 *
 * ⚠️ Fixas, e nao configuraveis: verde e lucro e vermelho e risco em toda mesa do mundo, e
 * uma posicao com as cores trocadas seria lida ao contrario por qualquer operador que olhasse
 * a tela de longe. Alpha baixo porque a zona e FUNDO — ela nao pode cobrir a vela que a
 * justifica.
 */
const COR_ZONA_LUCRO = 'rgba(22, 199, 132, 0.16)';
const COR_ZONA_RISCO = 'rgba(234, 57, 67, 0.16)';

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
  /**
   * ⭐ Zonas preenchidas com cor PROPRIA — o risco e o retorno da ferramenta de posicao.
   *
   * ⚠️ Separadas de `region`, que usa `style.fill` (a cor do desenho). Aqui a cor NAO e
   * escolha estetica: verde e a zona de lucro e vermelho e a de risco, e trocar isso
   * inverteria a leitura da ferramenta. Passar as duas por `style.fill` daria uma cor so
   * para as duas zonas — a informacao central desapareceria.
   *
   * Vazio para todo desenho que nao seja posicao.
   */
  readonly zonas: readonly { readonly box: Box; readonly cor: string }[];
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
        zonas: [],
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
        zonas: [],
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
        zonas: [],
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
        zonas: [],
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
        zonas: [],
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
        zonas: [],
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

    case 'HORIZONTAL_RAY': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      // ⚠️ O preco vem da PRIMEIRA ancora e o sentido da segunda. A segunda serve para o
      // operador dizer "para a direita" arrastando; o `y` dela e ignorado de proposito —
      // um raio horizontal cujo preco mudasse com a altura do arrasto seria impossivel de
      // colocar exatamente num topo.
      const paraDireita = p1.x >= p0.x;
      const strokes: Stroke[] = [
        { a: p0, b: { x: paraDireita ? largura : 0, y: p0.y } },
      ];
      if (p0.y < recorte.minY || p0.y > recorte.maxY) return null;
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes,
        region: null,
        fibLines: [],
        zonas: [],
        box: {
          minX: paraDireita ? p0.x - HIT_TOLERANCE_PX : 0,
          maxX: paraDireita ? largura : p0.x + HIT_TOLERANCE_PX,
          minY: p0.y - HIT_TOLERANCE_PX,
          maxY: p0.y + HIT_TOLERANCE_PX,
        },
        locked,
        style,
      };
    }
    case 'ARROW': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const comprimento = Math.hypot(dx, dy);
      // ⚠️ Seta de comprimento zero nao tem direcao: a ponta sairia com angulo `NaN` e o
      // canvas simplesmente nao pintaria nada. Degrada para o segmento puro.
      const strokes: Stroke[] = [{ a: p0, b: p1 }];
      if (comprimento > 1) {
        // ⭐ A ponta como DOIS segmentos: herda cor, espessura, tracejado, acerto de ponteiro
        // e recorte sem tocar no renderizador. O tamanho acompanha o comprimento (com teto),
        // senao uma seta curta viraria só ponta e uma longa teria uma ponta minúscula.
        const tamanho = Math.min(14, Math.max(6, comprimento * 0.18));
        const ang = Math.atan2(dy, dx);
        const abertura = 0.42; // ~24°, a abertura que lê como seta sem virar V
        for (const sinal of [-1, 1]) {
          const a2 = ang + Math.PI + sinal * abertura;
          strokes.push({
            a: p1,
            b: { x: p1.x + Math.cos(a2) * tamanho, y: p1.y + Math.sin(a2) * tamanho },
          });
        }
      }
      const caixa = boxOfPoints([p0, p1], HIT_TOLERANCE_PX + 14);
      if (caixa === null) return null;
      if (!boxesIntersect(caixa, recorte)) return null;
      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        strokes,
        region: null,
        fibLines: [],
        zonas: [],
        box: caixa,
        locked,
        style,
      };
    }
    case 'FIB_EXTENSION': {
      // ⭐ MESMA geometria da retracao: `lerp` com nivel > 1 projeta ALEM da segunda ancora,
      // que e exatamente o que a extensao mede. O que difere sao os niveis default, e isso
      // vive em `fibLevelsOf` — reimplementar a projecao aqui daria duas verdades.
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      const x1 = Math.min(p0.x, p1.x);
      const x2 = Math.max(p0.x, p1.x);
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
        strokes: [{ a: p0, b: p1 }],
        region: null,
        fibLines,
        zonas: [],
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
    case 'POSITION_LONG':
    case 'POSITION_SHORT': {
      const p1 = pontos[1];
      if (p1 === undefined) return null;
      // ⭐ A: entrada. B: stop. O alvo e derivado — ver `POSITION_LONG` no modelo.
      const yEntrada = p0.y;
      const yStop = p1.y;
      const risco = yStop - yEntrada; // em PIXEL, com sinal
      // ⚠️ Stop no mesmo pixel da entrada nao define posicao: a zona de risco teria altura
      // zero e a de lucro nasceria de uma divisao sem sentido. Degrada para o traco da
      // entrada, que e informacao verdadeira (o operador ainda esta colocando).
      if (Math.abs(risco) < 1) {
        return {
          id: d.id,
          kind: d.kind,
          points: pontos,
          strokes: [{ a: { x: p0.x, y: yEntrada }, b: { x: largura, y: yEntrada } }],
          region: null,
          fibLines: [],
          zonas: [],
          box: {
            minX: p0.x - HIT_TOLERANCE_PX,
            maxX: largura,
            minY: yEntrada - HIT_TOLERANCE_PX,
            maxY: yEntrada + HIT_TOLERANCE_PX,
          },
          locked,
          style,
        };
      }
      // O alvo fica do lado OPOSTO ao stop, a `rMultiple` vezes a distancia.
      const yAlvo = yEntrada - risco * rMultipleOf(d);

      // A extensao horizontal: da entrada para a direita, ate a coluna do stop ou, se ela
      // ficar atras, uma largura minima. Uma posicao sem largura visivel nao se le.
      const xInicio = Math.min(p0.x, p1.x);
      const xFim = Math.max(p0.x + 60, Math.max(p0.x, p1.x));

      const caixa = (yA: number, yB: number): Box => ({
        minX: xInicio,
        maxX: xFim,
        minY: Math.min(yA, yB),
        maxY: Math.max(yA, yB),
      });
      const zonaRisco = caixa(yEntrada, yStop);
      const zonaLucro = caixa(yEntrada, yAlvo);

      const envolvente: Box = {
        minX: xInicio - HIT_TOLERANCE_PX,
        maxX: xFim + HIT_TOLERANCE_PX,
        minY: Math.min(zonaRisco.minY, zonaLucro.minY) - HIT_TOLERANCE_PX,
        maxY: Math.max(zonaRisco.maxY, zonaLucro.maxY) + HIT_TOLERANCE_PX,
      };
      if (!boxesIntersect(envolvente, recorte)) return null;

      return {
        id: d.id,
        kind: d.kind,
        points: pontos,
        // Tres tracos horizontais: entrada, stop e alvo. Sao eles que dao o preco exato de
        // cada nivel — a zona pintada da a proporcao, o traco da o numero.
        strokes: [
          { a: { x: xInicio, y: yEntrada }, b: { x: xFim, y: yEntrada } },
          { a: { x: xInicio, y: yStop }, b: { x: xFim, y: yStop } },
          { a: { x: xInicio, y: yAlvo }, b: { x: xFim, y: yAlvo } },
        ],
        region: null,
        fibLines: [],
        zonas: [
          { box: zonaRisco, cor: COR_ZONA_RISCO },
          { box: zonaLucro, cor: COR_ZONA_LUCRO },
        ],
        box: envolvente,
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
