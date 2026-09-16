/**
 * geometry.core — a matematica de hit-test e de forma. PURA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aritmetica em ESPACO DE TELA (pixel). Recebe numeros, devolve numeros. Sem
 * canvas, sem DOM, sem substrato de grafico, sem estado de modulo.
 *
 * A separacao importa porque hit-test e a operacao mais chamada de todo o pacote:
 * o substrato invoca `hitTest` a **cada movimento do cursor**. Manter a
 * matematica pura e o que permite medi-la e prova-la sem montar grafico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DECISAO DE DESEMPENHO, E POR QUE NAO E UMA ARVORE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A literatura recomenda quadtree ou R-tree para hit-test em O(log n). Aqui o
 * indice e um **prefiltro de caixa envolvente sobre array plano**, deliberadamente.
 *
 * O raciocinio, com numeros: um grafico de mesa tem dezenas de desenhos, talvez
 * centenas no caso patologico. Um teste de caixa envolvente sao 4 comparacoes de
 * ponto flutuante. Para N=500 isso e 2.000 comparacoes por movimento de cursor —
 * na ordem de microssegundos, sobre um orcamento de 16 ms por quadro.
 *
 * Uma quadtree traria: construcao a cada mudanca de viewport (pan continuo
 * reconstruiria dezenas de vezes por segundo), invalidacao a cada arrasto, e
 * percurso com salto de ponteiro que perde localidade de cache. Para este N ela
 * seria mais lenta E mais complexa.
 *
 * ⚠️ O ganho de verdade nao esta na estrutura de indice — esta em **nao converter
 * coordenada durante o movimento**. A conversao logico→pixel acontece uma vez por
 * mudanca de viewport; o movimento do cursor le pixel ja pronto. E isso que muda
 * a ordem de grandeza, e e o que `render-plan.core.ts` implementa.
 *
 * Se algum dia N chegar a milhares, o lugar de mexer e aqui, com medicao na mao —
 * e a bancada existe para isso.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Tipos
// ═════════════════════════════════════════════════════════════════════════════

/** Um ponto em pixel. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Caixa envolvente alinhada aos eixos, em pixel. */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Tolerancia de acerto, em pixels CSS.
 *
 * ⚠️ **7, e nao 3.** Traco de 1 px com tolerancia de 3 px exige precisao de
 * cirurgiao, e o usuario conclui que a linha "nao pega". A referencia
 * de acessibilidade para alvo de ponteiro e da ordem de 24 px de area; 7 px de
 * raio da um alvo de 14 px de largura, que e o meio-termo praticavel num grafico
 * denso onde alvos grandes se sobrepoem.
 *
 * Nao e maior porque, com muitos desenhos proximos, tolerancia larga faz o
 * cursor "grudar" no desenho errado — e ai a resolucao por distancia do substrato
 * passa a decidir entre candidatos que o usuario nem considerou.
 */
export const HIT_TOLERANCE_PX = 7;

/**
 * Raio da alca desenhada, em pixels CSS.
 *
 * A alca e desenhada com este raio, mas seu alvo de acerto e maior (ver
 * `HANDLE_HIT_RADIUS_PX`): alvo maior que o desenho e correto aqui, porque a alca
 * e o gesto mais preciso que o usuario precisa acertar.
 */
export const HANDLE_RADIUS_PX = 4;

/** Raio de ACERTO da alca. Maior que o desenhado, de proposito. */
export const HANDLE_HIT_RADIUS_PX = 9;

// ═════════════════════════════════════════════════════════════════════════════
// Distancias
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Distancia de um ponto ao SEGMENTO `ab`. O cavalo de batalha do hit-test.
 *
 * Projeta o ponto na reta e recorta o parametro a `[0,1]`, o que faz a distancia
 * medir ate a extremidade quando a projecao cai fora do segmento — que e o
 * comportamento correto: clicar muito depois do fim de uma linha de tendencia NAO
 * deve acerta-la.
 *
 * Segmento degenerado (a == b) resolve para a distancia ao ponto, sem divisao por
 * zero. Acontece de verdade: e o estado entre o primeiro clique e o mouse ainda
 * nao ter se movido.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimentoQuadrado = dx * dx + dy * dy;

  if (comprimentoQuadrado === 0) {
    // Degenerado: distancia ao proprio ponto.
    return Math.hypot(px - ax, py - ay);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / comprimentoQuadrado;
  // O recorte e o que distingue segmento de reta infinita.
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Distancia de um ponto a RETA INFINITA que passa por `a` e `b`.
 *
 * Sem recorte de parametro: e o que `EXTENDED_LINE` precisa.
 */
export function distanceToLine(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimento = Math.hypot(dx, dy);
  if (comprimento === 0) return Math.hypot(px - ax, py - ay);
  // Area do paralelogramo dividida pela base = altura. Estavel e sem divisao
  // pelo quadrado, o que evita perda de precisao em segmento muito curto.
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / comprimento;
}

/**
 * Distancia de um ponto ao RAIO que sai de `a` passando por `b`.
 *
 * Recorta o parametro somente em `0`: nao ha limite adiante.
 */
export function distanceToRay(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimentoQuadrado = dx * dx + dy * dy;
  if (comprimentoQuadrado === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / comprimentoQuadrado;
  if (t < 0) t = 0; // atras da origem do raio: mede ate a origem

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Distancia de um ponto ao CONTORNO de um retangulo.
 *
 * ⚠️ Ao contorno, e nao a regiao. Ponto DENTRO do retangulo devolve a distancia
 * ate a borda mais proxima, nao zero.
 *
 * Isso e deliberado e importa para a resolucao de sobreposicao: um retangulo
 * grande cobrindo meia tela nao deve ganhar de uma linha de tendencia so por o
 * cursor estar dentro dele. Quem quer o comportamento de regiao usa
 * `isInsideBox`, e reporta prioridade de regiao (0) em vez de prioridade de
 * traco (1).
 */
export function distanceToRectOutline(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  return Math.min(
    distanceToSegment(px, py, minX, minY, maxX, minY), // topo
    distanceToSegment(px, py, maxX, minY, maxX, maxY), // direita
    distanceToSegment(px, py, maxX, maxY, minX, maxY), // base
    distanceToSegment(px, py, minX, maxY, minX, minY), // esquerda
  );
}

/** Distancia a uma horizontal infinita em `y`. */
export function distanceToHorizontal(py: number, y: number): number {
  return Math.abs(py - y);
}

/** Distancia a uma vertical infinita em `x`. */
export function distanceToVertical(px: number, x: number): number {
  return Math.abs(px - x);
}

// ═════════════════════════════════════════════════════════════════════════════
// Caixas
// ═════════════════════════════════════════════════════════════════════════════

/** Caixa envolvente de um conjunto de pontos, com folga. */
export function boxOfPoints(pontos: readonly Point[], folga = 0): Box | null {
  if (pontos.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of pontos) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Todos os pontos nao-finitos: nao ha caixa. `null` em vez de caixa com
  // `Infinity`, que passaria em qualquer teste de intersecao e faria o prefiltro
  // aceitar tudo — exatamente o oposto do proposito dele.
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    minX: minX - folga,
    minY: minY - folga,
    maxX: maxX + folga,
    maxY: maxY + folga,
  };
}

/** O ponto esta dentro da caixa (bordas inclusive)? */
export function isInsideBox(box: Box, px: number, py: number): boolean {
  return px >= box.minX && px <= box.maxX && py >= box.minY && py <= box.maxY;
}

/** As duas caixas se intersectam? */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Caixa que abrange a area visivel, para recortar o que nao precisa ser desenhado.
 *
 * A folga evita descartar desenho que comeca fora e ATRAVESSA a area visivel: um
 * segmento com as duas pontas fora da tela pode cruzar o meio dela, e recortar
 * pela caixa das pontas o apagaria. A folga nao resolve o caso geral — quem
 * resolve e testar a intersecao do segmento com a caixa — mas cobre o caso comum
 * a custo zero.
 */
export function viewportBox(width: number, height: number, folga = 0): Box {
  return { minX: -folga, minY: -folga, maxX: width + folga, maxY: height + folga };
}

/**
 * O SEGMENTO `ab` intersecta a caixa?
 *
 * Recorte de Liang-Barsky, forma reduzida. Necessario porque o teste de caixa
 * envolvente das pontas produz falso NEGATIVO no caso que mais aparece na
 * pratica: linha de tendencia longa cujas duas ancoras estao fora da tela mas que
 * cruza a area visivel. Descartar essa linha a faria desaparecer justamente
 * quando o usuario da zoom para olhar de perto.
 */
export function segmentIntersectsBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: Box,
): boolean {
  // Ponta dentro resolve de imediato, e e o caso mais comum.
  if (isInsideBox(box, ax, ay) || isInsideBox(box, bx, by)) return true;

  const dx = bx - ax;
  const dy = by - ay;

  let t0 = 0;
  let t1 = 1;

  const bordas: ReadonlyArray<readonly [number, number]> = [
    [-dx, ax - box.minX],
    [dx, box.maxX - ax],
    [-dy, ay - box.minY],
    [dy, box.maxY - ay],
  ];

  for (const [p, q] of bordas) {
    if (p === 0) {
      // Paralela a esta borda: se esta fora dela, nao ha intersecao possivel.
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }

  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Prolongamento de reta ate a borda da tela
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Prolonga a reta que passa por `a` e `b` ate as bordas da caixa.
 *
 * Existe porque `RAY` e `EXTENDED_LINE` sao infinitas no modelo e finitas no
 * canvas. Desenhar com coordenada gigante (`x = 1e9`) "funciona" e e armadilha:
 * o canvas perde precisao de rasterizacao em magnitude alta e a linha sai
 * tremida ou desalinhada por um pixel que varia com o pan.
 *
 * @returns as duas pontas recortadas, ou `null` se a reta nao cruza a caixa.
 */
export function extendLineToBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: Box,
  modo: 'LINE' | 'RAY_FORWARD' | 'RAY_BACKWARD',
): readonly [Point, Point] | null {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return null;

  // Parametro em relacao a `a`, com `b` em t = 1.
  let tMin = modo === 'LINE' ? -Infinity : modo === 'RAY_FORWARD' ? 0 : -Infinity;
  let tMax = modo === 'LINE' ? Infinity : modo === 'RAY_FORWARD' ? Infinity : 0;

  const recortar = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
    return true;
  };

  if (!recortar(-dx, ax - box.minX)) return null;
  if (!recortar(dx, box.maxX - ax)) return null;
  if (!recortar(-dy, ay - box.minY)) return null;
  if (!recortar(dy, box.maxY - ay)) return null;

  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax < tMin) return null;

  return [
    { x: ax + tMin * dx, y: ay + tMin * dy },
    { x: ax + tMax * dx, y: ay + tMax * dy },
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// Utilitarios
// ═════════════════════════════════════════════════════════════════════════════

/** Os dois numeros sao finitos? Guarda usada antes de toda aritmetica de tela. */
export function bothFinite(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b);
}

/** Interpola linearmente. `t` fora de `[0,1]` extrapola, de proposito. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
