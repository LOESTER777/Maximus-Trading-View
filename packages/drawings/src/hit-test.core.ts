/**
 * hit-test.core — o que esta sob o cursor. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A OPERACAO MAIS CHAMADA DO PACOTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato invoca isto a cada movimento do cursor. Ele consome o plano de
 * tela ja projetado (`RenderPlan`), portanto **nao faz nenhuma conversao de
 * coordenada** — so comparacao de ponto flutuante. Ver o cabecalho de
 * `render-plan.core.ts` para por que essa separacao muda a ordem de grandeza.
 *
 * Duas passadas, e a ordem e o que da a velocidade:
 *
 *  1. **prefiltro por caixa envolvente** — 4 comparacoes por desenho, descarta a
 *     grande maioria;
 *  2. **distancia exata** — so nos sobreviventes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PRIORIDADE, E POR QUE ELA IMPORTA MAIS QUE A DISTANCIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O substrato resolve sobreposicao por `hitTestPriority` e depois por `distance`,
 * e da precedencia especial a acerto de PONTO. A ordem adotada aqui espelha isso:
 *
 *     2  alca      — o gesto mais preciso que o usuario precisa acertar
 *     1  traco     — a linha em si
 *     0  regiao    — interior de retangulo
 *
 * ⚠️ Sem essa ordem, arrastar a alça de um retângulo seria impossível: a alça fica
 * DENTRO da região, e um empate por distância entregaria a região — o usuário
 * moveria o retângulo inteiro quando quisesse redimensioná-lo. É o defeito mais
 * comum em ferramenta de desenho, e ele não aparece em teste manual rápido porque
 * só se manifesta quando a alça está sobre o preenchimento.
 */

import {
  HANDLE_HIT_RADIUS_PX,
  HIT_TOLERANCE_PX,
  distanceToHorizontal,
  distanceToSegment,
  distanceToVertical,
  isInsideBox,
  type Box,
} from './geometry.core.js';
import type { RenderPlan, ScreenDrawing } from './render-plan.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Tipos
// ═════════════════════════════════════════════════════════════════════════════

/** O que foi acertado dentro de um desenho. */
export type HitPart =
  /** Uma alca. `handleIndex` diz qual, e corresponde ao indice da ancora. */
  | 'HANDLE'
  /** O traco. Arrastar move o desenho inteiro. */
  | 'STROKE'
  /** O interior de uma regiao. Arrastar move o desenho inteiro. */
  | 'REGION';

/** Prioridade de acerto, na convencao do substrato. */
export const HIT_PRIORITY: Readonly<Record<HitPart, 0 | 1 | 2>> = Object.freeze({
  HANDLE: 2,
  STROKE: 1,
  REGION: 0,
});

/** Um acerto. */
export interface Hit {
  readonly id: string;
  readonly part: HitPart;
  /** Indice da ancora, quando `part === 'HANDLE'`. `-1` nos demais. */
  readonly handleIndex: number;
  /** Distancia em pixels CSS. Regiao reporta `0`. */
  readonly distance: number;
  readonly priority: 0 | 1 | 2;
}

/**
 * Cursor CSS sugerido para um acerto.
 *
 * Alca recebe cursor de redimensionamento e corpo recebe cursor de mover: o
 * cursor e o unico aviso que o usuario tem, ANTES de pressionar, sobre qual gesto
 * vai acontecer. Sem essa distincao ele descobre arrastando — e desfazendo.
 */
export function cursorFor(part: HitPart): string {
  return part === 'HANDLE' ? 'grab' : 'move';
}

// ═════════════════════════════════════════════════════════════════════════════
// A busca
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O melhor acerto na posicao, ou `null`.
 *
 * Percorre do FIM para o COMECO da colecao. A ordem importa: desenhos posteriores
 * sao pintados por cima, entao devem ganhar o empate — o usuario espera acertar o
 * que ele ve na frente.
 *
 * @param plan       plano de tela ja projetado
 * @param x          coordenada do cursor
 * @param y          coordenada do cursor
 * @param tolerance  raio de acerto do traco. Default `HIT_TOLERANCE_PX`.
 */
export function hitTest(
  plan: RenderPlan,
  x: number,
  y: number,
  tolerance: number = HIT_TOLERANCE_PX,
): Hit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  /**
   * ⚠️ Folga extra do prefiltro quando a tolerancia pedida excede a que a
   * projecao usou para dimensionar a caixa.
   *
   * A caixa de cada item foi montada em `buildRenderPlan` com `HIT_TOLERANCE_PX`
   * de folga. Sem esta correcao, chamar `hitTest` com tolerancia MAIOR nao teria
   * efeito nenhum: o prefiltro rejeitaria o ponto antes de a distancia exata ser
   * calculada, e o parametro mentiria em silencio.
   *
   * Foi um teste que pegou isso — `hitTest(p, x, y, 30)` devolvia `null` para um
   * ponto a 20 px do traco. O caminho de tolerancia MENOR sempre funcionou, o que
   * torna o defeito facil de nao notar.
   */
  const folgaExtra = Math.max(0, tolerance - HIT_TOLERANCE_PX);

  let melhor: Hit | null = null;

  for (let i = plan.items.length - 1; i >= 0; i--) {
    const item = plan.items[i];
    if (item === undefined) continue;
    // Bloqueado nao participa: e o proposito do bloqueio.
    if (item.locked) continue;

    // ── Passada 1: prefiltro. 4 comparacoes, descarta a maioria. ──
    if (!isInsideBoxWithSlack(item.box, x, y, folgaExtra)) continue;

    // ── Passada 2: distancia exata, so nos sobreviventes. ──
    const acerto = hitOne(item, x, y, tolerance);
    if (acerto === null) continue;

    if (melhor === null || vence(acerto, melhor)) melhor = acerto;
  }

  return melhor;
}

/**
 * Prefiltro com folga adicional.
 *
 * `folga === 0` e o caminho comum e cai em `isInsideBox` direto, sem aritmetica
 * extra — o prefiltro e chamado a cada movimento de cursor, para cada desenho.
 */
function isInsideBoxWithSlack(box: Box, x: number, y: number, folga: number): boolean {
  if (folga === 0) return isInsideBox(box, x, y);
  return (
    x >= box.minX - folga &&
    x <= box.maxX + folga &&
    y >= box.minY - folga &&
    y <= box.maxY + folga
  );
}

/**
 * `a` ganha de `b`?
 *
 * Prioridade primeiro, distancia depois — espelha a resolucao do substrato. Em
 * empate exato mantem o incumbente, o que preserva a ordem de pintura por a
 * varredura ir do topo para o fundo.
 */
function vence(a: Hit, b: Hit): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  return a.distance < b.distance;
}

/** O melhor acerto dentro de UM desenho. */
function hitOne(item: ScreenDrawing, x: number, y: number, tolerance: number): Hit | null {
  // ── Alcas primeiro, sempre ──
  //
  // Nao e otimizacao: e correcao. A alca fica sobre o traco e dentro da regiao, e
  // testar depois faria o traco ganhar por distancia menor num pixel qualquer.
  for (let i = 0; i < item.points.length; i++) {
    const p = item.points[i];
    if (p === undefined) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= HANDLE_HIT_RADIUS_PX) {
      return {
        id: item.id,
        part: 'HANDLE',
        handleIndex: i,
        distance: d,
        priority: HIT_PRIORITY.HANDLE,
      };
    }
  }

  // ── Tracos ──
  let menor = Infinity;
  for (const s of item.strokes) {
    const d = distanceToSegment(x, y, s.a.x, s.a.y, s.b.x, s.b.y);
    if (d < menor) menor = d;
  }

  // ── Niveis de Fibonacci: cada um e um traco horizontal acertavel ──
  for (const l of item.fibLines) {
    if (x < l.x1 - tolerance || x > l.x2 + tolerance) continue;
    const d = distanceToHorizontal(y, l.y);
    if (d < menor) menor = d;
  }

  // ── Rotulos: a caixa do texto e acertavel por DENTRO ──
  //
  // ⭐ E a excecao deliberada a regra "regiao sem preenchimento nao pega por dentro". A caixa de
  // um rotulo tem algumas dezenas de pixels e e OPACA: ela cobre a vela que esta atras, entao o
  // clique nela nao pertence mais ao grafico. Deixa-la passar tornaria a NOTA praticamente
  // inacertavel — o unico alvo dela seria a alca de 9 px de raio, ao lado do texto.
  //
  // ⚠️ Reportado como `STROKE` e nao como `REGION`: numa nota o texto E o corpo do desenho, e em
  // qualquer outra ferramenta clicar no rotulo deve selecionar o desenho que ele nomeia — as
  // duas leituras querem a prioridade do corpo, nao a de fundo.
  for (const t of item.texts) {
    if (isInsideBox(t.box, x, y)) {
      menor = 0;
      break;
    }
  }

  // Linha infinita: a distancia e puramente no eixo perpendicular. Ja coberto
  // pelos `strokes`, que a projecao emitiu de borda a borda — mas o calculo
  // explicito evita depender de o traco cobrir exatamente a largura corrente.
  if (item.kind === 'HORIZONTAL_LINE') {
    const p = item.points[0];
    if (p !== undefined) menor = Math.min(menor, distanceToHorizontal(y, p.y));
  }
  if (item.kind === 'VERTICAL_LINE') {
    const p = item.points[0];
    if (p !== undefined) menor = Math.min(menor, distanceToVertical(x, p.x));
  }

  if (menor <= tolerance) {
    return {
      id: item.id,
      part: 'STROKE',
      handleIndex: -1,
      distance: menor,
      priority: HIT_PRIORITY.STROKE,
    };
  }

  // ── Regiao, por ultimo e so se preenchida ──
  //
  // ⚠️ Regiao SEM preenchimento nao e acertavel por dentro, de proposito: um
  // retangulo vazio grande capturaria todo clique no meio do grafico e impediria
  // pan — que e o gesto mais usado. Contorno visivel, interior transparente:
  // acerto no contorno.
  if (item.region !== null && item.style.fill !== null && isInsideBox(item.region, x, y)) {
    return {
      id: item.id,
      part: 'REGION',
      handleIndex: -1,
      distance: 0,
      priority: HIT_PRIORITY.REGION,
    };
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Consultas auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/** Todos os desenhos cuja caixa contem o ponto. Util para menu de contexto. */
export function hitCandidates(plan: RenderPlan, x: number, y: number): readonly string[] {
  const ids: string[] = [];
  for (let i = plan.items.length - 1; i >= 0; i--) {
    const item = plan.items[i];
    if (item === undefined || item.locked) continue;
    if (isInsideBox(item.box, x, y)) ids.push(item.id);
  }
  return ids;
}

/** Ids cujos desenhos intersectam a caixa. Util para selecao por laco. */
export function idsInBox(plan: RenderPlan, box: Box): readonly string[] {
  const ids: string[] = [];
  for (const item of plan.items) {
    if (item.locked) continue;
    if (
      item.box.minX <= box.maxX &&
      item.box.maxX >= box.minX &&
      item.box.minY <= box.maxY &&
      item.box.maxY >= box.minY
    ) {
      ids.push(item.id);
    }
  }
  return ids;
}
