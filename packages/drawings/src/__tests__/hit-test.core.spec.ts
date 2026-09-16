/**
 * hit-test.core — o que esta sob o cursor.
 *
 * ⭐ O teste mais importante deste arquivo e o de PRIORIDADE. Sem ela, arrastar a
 * alca de um retangulo e impossivel: a alca fica dentro da regiao, e um empate por
 * distancia entregaria a regiao — o usuario moveria o retangulo inteiro quando
 * quisesse redimensiona-lo. E o defeito mais comum em ferramenta de desenho, e nao
 * aparece em teste manual rapido porque so se manifesta quando a alca esta sobre o
 * preenchimento.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { HANDLE_HIT_RADIUS_PX, HIT_TOLERANCE_PX } from '../geometry.core.js';
import { HIT_PRIORITY, cursorFor, hitCandidates, hitTest, idsInBox } from '../hit-test.core.js';
import { buildRenderPlan, type LogicalToScreen, type ViewportEpoch } from '../render-plan.core.js';
import type { Drawing } from '../model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Cenario
// ═════════════════════════════════════════════════════════════════════════════

const LARGURA = 800;
const ALTURA = 400;

/**
 * Conversores lineares sinteticos.
 *
 * Tempo 0..1000 mapeia em X 0..800; preco 0..100 mapeia em Y 400..0 (invertido,
 * como num grafico de verdade — preco alto no topo).
 */
const CONV: LogicalToScreen = {
  timeToX: (t) => (Number.isFinite(t) ? (t / 1000) * LARGURA : null),
  priceToY: (p) => (Number.isFinite(p) ? ALTURA - (p / 100) * ALTURA : null),
  width: () => LARGURA,
  height: () => ALTURA,
};

const EPOCA: ViewportEpoch = {
  fromSec: 0,
  toSec: 1000,
  width: LARGURA,
  height: ALTURA,
  topPrice: 100,
  bottomPrice: 0,
};

function plano(drawings: readonly Drawing[]) {
  return buildRenderPlan(drawings, CONV, EPOCA);
}

/** Ponto de tela do par (tempo, preco), pelos mesmos conversores. */
function tela(t: number, p: number): { x: number; y: number } {
  return { x: (t / 1000) * LARGURA, y: ALTURA - (p / 100) * ALTURA };
}

// ═════════════════════════════════════════════════════════════════════════════
// Prioridade — o coracao
// ═════════════════════════════════════════════════════════════════════════════

describe('prioridade de acerto', () => {
  it('a ordem e alca > traco > regiao, como o substrato espera', () => {
    expect(HIT_PRIORITY.HANDLE).toBe(2);
    expect(HIT_PRIORITY.STROKE).toBe(1);
    expect(HIT_PRIORITY.REGION).toBe(0);
  });

  /**
   * ⭐⭐ A propriedade que faz redimensionar funcionar.
   *
   * A alca de um retangulo PREENCHIDO fica dentro da regiao. Sem prioridade, a
   * regiao (distancia 0) venceria sempre.
   */
  it('a ALCA ganha da regiao preenchida em que ela esta dentro', () => {
    const retangulo: Drawing = {
      id: 'r1',
      kind: 'RECTANGLE',
      anchors: [
        { timeSec: 200, price: 30 },
        { timeSec: 800, price: 70 },
      ],
      style: { fill: 'rgba(255,255,255,0.2)' },
    };
    const p = plano([retangulo]);

    // Exatamente sobre a primeira alca — que esta dentro da regiao preenchida.
    const alvo = tela(200, 30);
    const h = hitTest(p, alvo.x, alvo.y);

    expect(h).not.toBeNull();
    expect(h?.part).toBe('HANDLE');
    expect(h?.handleIndex).toBe(0);
    expect(h?.priority).toBe(2);
  });

  it('a ALCA ganha do proprio traco em que ela esta sobre', () => {
    const linha: Drawing = {
      id: 'l1',
      kind: 'TRENDLINE',
      anchors: [
        { timeSec: 200, price: 30 },
        { timeSec: 800, price: 70 },
      ],
    };
    const p = plano([linha]);
    const alvo = tela(200, 30);
    const h = hitTest(p, alvo.x, alvo.y);

    expect(h?.part).toBe('HANDLE');
    expect(h?.handleIndex).toBe(0);
  });

  it('o TRACO ganha da regiao quando o cursor esta na borda', () => {
    const retangulo: Drawing = {
      id: 'r1',
      kind: 'RECTANGLE',
      anchors: [
        { timeSec: 200, price: 30 },
        { timeSec: 800, price: 70 },
      ],
      style: { fill: 'rgba(255,255,255,0.2)' },
    };
    const p = plano([retangulo]);
    // Meio da borda superior — longe das alcas dos cantos.
    const meio = tela(500, 70);
    const h = hitTest(p, meio.x, meio.y);

    expect(h?.part).toBe('STROKE');
  });

  it('a REGIAO responde no interior, longe de borda e de alca', () => {
    const retangulo: Drawing = {
      id: 'r1',
      kind: 'RECTANGLE',
      anchors: [
        { timeSec: 100, price: 10 },
        { timeSec: 900, price: 90 },
      ],
      style: { fill: 'rgba(255,255,255,0.2)' },
    };
    const p = plano([retangulo]);
    const centro = tela(500, 50);
    const h = hitTest(p, centro.x, centro.y);

    expect(h?.part).toBe('REGION');
    expect(h?.distance).toBe(0);
  });

  /**
   * ⭐ Regiao SEM preenchimento nao e acertavel por dentro.
   *
   * Deliberado: um retangulo vazio grande capturaria todo clique no meio do
   * grafico e impediria o pan, que e o gesto mais usado.
   */
  it('regiao SEM preenchimento NAO captura o interior — senao o pan ficaria impossivel', () => {
    const vazio: Drawing = {
      id: 'r1',
      kind: 'RECTANGLE',
      anchors: [
        { timeSec: 100, price: 10 },
        { timeSec: 900, price: 90 },
      ],
      // sem `fill`
    };
    const p = plano([vazio]);
    const centro = tela(500, 50);
    expect(hitTest(p, centro.x, centro.y)).toBeNull();

    // Mas a BORDA continua acertavel.
    const borda = tela(500, 90);
    expect(hitTest(p, borda.x, borda.y)?.part).toBe('STROKE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Alcance
// ═════════════════════════════════════════════════════════════════════════════

describe('alcance do acerto', () => {
  const linha: Drawing = {
    id: 'l1',
    kind: 'TRENDLINE',
    anchors: [
      { timeSec: 0, price: 50 },
      { timeSec: 1000, price: 50 },
    ],
  };

  it('acerta dentro da tolerancia e recusa fora', () => {
    const p = plano([linha]);
    const y = ALTURA - (50 / 100) * ALTURA;

    expect(hitTest(p, 400, y)).not.toBeNull();
    expect(hitTest(p, 400, y + HIT_TOLERANCE_PX - 0.5)).not.toBeNull();
    expect(hitTest(p, 400, y + HIT_TOLERANCE_PX + 2)).toBeNull();
  });

  it('a tolerancia e parametrizavel', () => {
    const p = plano([linha]);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitTest(p, 400, y + 20, 30)).not.toBeNull();
    expect(hitTest(p, 400, y + 20, 3)).toBeNull();
  });

  it('o alvo da alca e MAIOR que o desenhado — a alca e o gesto mais preciso', () => {
    const p = plano([linha]);
    const a = tela(0, 50);
    // Um pixel dentro do raio de acerto: ainda e alca.
    const h = hitTest(p, a.x + HANDLE_HIT_RADIUS_PX - 1, a.y);
    expect(h?.part).toBe('HANDLE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Ordem e bloqueio
// ═════════════════════════════════════════════════════════════════════════════

describe('ordem e bloqueio', () => {
  const A: Drawing = {
    id: 'a',
    kind: 'HORIZONTAL_LINE',
    anchors: [{ timeSec: 0, price: 50 }],
  };
  const B: Drawing = {
    id: 'b',
    kind: 'HORIZONTAL_LINE',
    anchors: [{ timeSec: 0, price: 50 }],
  };

  /** O ultimo e pintado por cima, entao deve ganhar o empate. */
  it('em empate exato ganha o ULTIMO da colecao, que e o pintado por cima', () => {
    const p = plano([A, B]);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitTest(p, 400, y)?.id).toBe('b');
  });

  it('desenho BLOQUEADO nao participa', () => {
    const p = plano([{ ...A, locked: true }]);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitTest(p, 400, y)).toBeNull();
  });

  it('desenho OCULTO nem entra no plano', () => {
    const p = plano([{ ...A, hidden: true }]);
    expect(p.items).toHaveLength(0);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitTest(p, 400, y)).toBeNull();
  });

  it('bloqueado atras de livre entrega o LIVRE', () => {
    const p = plano([{ ...A, locked: false }, { ...B, locked: true }]);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitTest(p, 400, y)?.id).toBe('a');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Robustez e determinismo
// ═════════════════════════════════════════════════════════════════════════════

describe('robustez', () => {
  it('coordenada nao-finita devolve null em vez de lancar', () => {
    const p = plano([
      { id: 'l', kind: 'TRENDLINE', anchors: [{ timeSec: 0, price: 0 }, { timeSec: 1000, price: 100 }] },
    ]);
    expect(hitTest(p, NaN, 100)).toBeNull();
    expect(hitTest(p, 100, NaN)).toBeNull();
    expect(hitTest(p, Infinity, Infinity)).toBeNull();
  });

  it('plano vazio devolve null', () => {
    expect(hitTest(plano([]), 400, 200)).toBeNull();
  });

  /** Mesmo plano e mesmo ponto: mesma resposta. Sem estado escondido. */
  it('e DETERMINISTICO — mesma entrada, mesma saida', () => {
    const desenhos: Drawing[] = [
      { id: 'a', kind: 'TRENDLINE', anchors: [{ timeSec: 100, price: 20 }, { timeSec: 900, price: 80 }] },
      { id: 'b', kind: 'RECTANGLE', anchors: [{ timeSec: 300, price: 40 }, { timeSec: 700, price: 60 }], style: { fill: '#fff' } },
      { id: 'c', kind: 'HORIZONTAL_LINE', anchors: [{ timeSec: 0, price: 50 }] },
    ];
    const p = plano(desenhos);

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: LARGURA, noNaN: true }),
        fc.double({ min: 0, max: ALTURA, noNaN: true }),
        (x, y) => {
          const a = hitTest(p, x, y);
          const b = hitTest(p, x, y);
          expect(a).toEqual(b);
        },
      ),
    );
  });

  it('nunca lanca, para qualquer ponto', () => {
    const p = plano([
      { id: 'a', kind: 'FIB_RETRACEMENT', anchors: [{ timeSec: 100, price: 20 }, { timeSec: 900, price: 80 }] },
      { id: 'b', kind: 'RAY', anchors: [{ timeSec: 100, price: 20 }, { timeSec: 200, price: 30 }] },
      { id: 'c', kind: 'EXTENDED_LINE', anchors: [{ timeSec: 100, price: 20 }, { timeSec: 200, price: 30 }] },
      { id: 'd', kind: 'VERTICAL_LINE', anchors: [{ timeSec: 500, price: 0 }] },
    ]);
    fc.assert(
      fc.property(
        fc.double({ min: -2000, max: 3000, noNaN: true }),
        fc.double({ min: -2000, max: 3000, noNaN: true }),
        (x, y) => {
          expect(() => hitTest(p, x, y)).not.toThrow();
        },
      ),
    );
  });

  it('a distancia reportada e sempre finita e nao-negativa', () => {
    const p = plano([
      { id: 'a', kind: 'TRENDLINE', anchors: [{ timeSec: 100, price: 20 }, { timeSec: 900, price: 80 }] },
    ]);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: LARGURA, noNaN: true }),
        fc.double({ min: 0, max: ALTURA, noNaN: true }),
        (x, y) => {
          const h = hitTest(p, x, y);
          if (h === null) return;
          expect(Number.isFinite(h.distance)).toBe(true);
          expect(h.distance).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Fibonacci
// ═════════════════════════════════════════════════════════════════════════════

describe('niveis de Fibonacci', () => {
  const fib: Drawing = {
    id: 'f',
    kind: 'FIB_RETRACEMENT',
    anchors: [
      { timeSec: 200, price: 0 },
      { timeSec: 800, price: 100 },
    ],
  };

  it('cada nivel e acertavel', () => {
    const p = plano([fib]);
    // Nivel 0.5 => preco 50, no meio do intervalo horizontal.
    const alvo = tela(500, 50);
    expect(hitTest(p, alvo.x, alvo.y)).not.toBeNull();
  });

  it('fora da faixa horizontal do desenho NAO acerta o nivel', () => {
    const p = plano([fib]);
    const y = ALTURA - (50 / 100) * ALTURA;
    // X bem a esquerda de timeSec=200.
    const xFora = (50 / 1000) * LARGURA;
    expect(hitTest(p, xFora, y)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Consultas auxiliares
// ═════════════════════════════════════════════════════════════════════════════

describe('consultas auxiliares', () => {
  const desenhos: Drawing[] = [
    { id: 'a', kind: 'HORIZONTAL_LINE', anchors: [{ timeSec: 0, price: 50 }] },
    { id: 'b', kind: 'HORIZONTAL_LINE', anchors: [{ timeSec: 0, price: 50 }] },
  ];

  it('hitCandidates devolve todos os que a caixa contem, do topo para o fundo', () => {
    const p = plano(desenhos);
    const y = ALTURA - (50 / 100) * ALTURA;
    expect(hitCandidates(p, 400, y)).toEqual(['b', 'a']);
  });

  it('idsInBox seleciona por laco', () => {
    const p = plano(desenhos);
    const y = ALTURA - (50 / 100) * ALTURA;
    const dentro = idsInBox(p, { minX: 0, maxX: LARGURA, minY: y - 5, maxY: y + 5 });
    expect(dentro).toEqual(['a', 'b']);

    const fora = idsInBox(p, { minX: 0, maxX: 10, minY: 0, maxY: 5 });
    expect(fora).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cursor
// ═════════════════════════════════════════════════════════════════════════════

describe('cursorFor', () => {
  /**
   * O cursor e o unico aviso que o usuario tem, ANTES de pressionar, sobre qual
   * gesto vai acontecer. Sem a distincao ele descobre arrastando — e desfazendo.
   */
  it('distingue redimensionar de mover', () => {
    expect(cursorFor('HANDLE')).toBe('grab');
    expect(cursorFor('STROKE')).toBe('move');
    expect(cursorFor('REGION')).toBe('move');
  });
});
