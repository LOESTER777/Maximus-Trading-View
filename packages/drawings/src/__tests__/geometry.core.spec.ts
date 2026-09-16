/**
 * geometry.core — a matematica de hit-test.
 *
 * Property tests com `fast-check` onde a propriedade e o que importa, e caso
 * nomeado onde o valor exato e o que importa.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  HIT_TOLERANCE_PX,
  boxOfPoints,
  boxesIntersect,
  distanceToHorizontal,
  distanceToLine,
  distanceToRay,
  distanceToRectOutline,
  distanceToSegment,
  distanceToVertical,
  extendLineToBox,
  isInsideBox,
  lerp,
  segmentIntersectsBox,
  viewportBox,
} from '../geometry.core.js';

/** Coordenada de tela plausivel: finita e de magnitude razoavel. */
const coord = fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true });

describe('distanceToSegment', () => {
  it('zero num ponto do proprio segmento', () => {
    expect(distanceToSegment(5, 5, 0, 0, 10, 10)).toBeCloseTo(0, 10);
    expect(distanceToSegment(0, 0, 0, 0, 10, 10)).toBeCloseTo(0, 10);
    expect(distanceToSegment(10, 10, 0, 0, 10, 10)).toBeCloseTo(0, 10);
  });

  it('mede a perpendicular quando a projecao cai DENTRO', () => {
    // Segmento horizontal de (0,0) a (10,0); ponto em (5,3).
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 10);
  });

  /**
   * ⭐ O recorte do parametro e o que distingue segmento de reta infinita.
   *
   * Sem ele, clicar muito depois do fim de uma linha de tendencia a acertaria — e
   * o usuario selecionaria uma linha que visualmente esta longe do cursor.
   */
  it('mede ate a EXTREMIDADE quando a projecao cai fora', () => {
    // Muito a direita do fim: distancia ate (10,0), nao a perpendicular.
    expect(distanceToSegment(110, 0, 0, 0, 10, 0)).toBeCloseTo(100, 10);
    // Muito a esquerda do inicio.
    expect(distanceToSegment(-100, 0, 0, 0, 10, 0)).toBeCloseTo(100, 10);
  });

  it('segmento degenerado resolve para distancia ao ponto, sem divisao por zero', () => {
    const d = distanceToSegment(3, 4, 0, 0, 0, 0);
    expect(d).toBeCloseTo(5, 10);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('nunca devolve NaN nem negativo, para qualquer entrada finita', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, (px, py, ax, ay, bx, by) => {
        const d = distanceToSegment(px, py, ax, ay, bx, by);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('e simetrico na troca das extremidades', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, (px, py, ax, ay, bx, by) => {
        const ab = distanceToSegment(px, py, ax, ay, bx, by);
        const ba = distanceToSegment(px, py, bx, by, ax, ay);
        expect(Math.abs(ab - ba)).toBeLessThan(1e-6);
      }),
    );
  });

  it('nunca e MENOR que a distancia a reta infinita', () => {
    // Consequencia do recorte: o segmento e subconjunto da reta.
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, (px, py, ax, ay, bx, by) => {
        const seg = distanceToSegment(px, py, ax, ay, bx, by);
        const reta = distanceToLine(px, py, ax, ay, bx, by);
        expect(seg).toBeGreaterThanOrEqual(reta - 1e-6);
      }),
    );
  });
});

describe('distanceToLine', () => {
  it('ignora as extremidades — a reta e infinita', () => {
    // Muito a direita do "fim": a reta horizontal ainda passa em y=0.
    expect(distanceToLine(1000, 3, 0, 0, 10, 0)).toBeCloseTo(3, 10);
  });

  it('degenerada resolve para distancia ao ponto', () => {
    expect(distanceToLine(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 10);
  });
});

describe('distanceToRay', () => {
  it('adiante e como a reta', () => {
    expect(distanceToRay(1000, 3, 0, 0, 10, 0)).toBeCloseTo(3, 10);
  });

  it('ATRAS da origem mede ate a origem', () => {
    expect(distanceToRay(-100, 0, 0, 0, 10, 0)).toBeCloseTo(100, 10);
  });

  it('fica entre a reta e o segmento', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, (px, py, ax, ay, bx, by) => {
        const reta = distanceToLine(px, py, ax, ay, bx, by);
        const raio = distanceToRay(px, py, ax, ay, bx, by);
        const seg = distanceToSegment(px, py, ax, ay, bx, by);
        expect(raio).toBeGreaterThanOrEqual(reta - 1e-6);
        expect(raio).toBeLessThanOrEqual(seg + 1e-6);
      }),
    );
  });
});

describe('distanceToRectOutline', () => {
  it('zero na borda', () => {
    expect(distanceToRectOutline(0, 5, 0, 0, 10, 10)).toBeCloseTo(0, 10);
    expect(distanceToRectOutline(5, 10, 0, 0, 10, 10)).toBeCloseTo(0, 10);
  });

  /**
   * ⭐ Ponto DENTRO devolve a distancia a borda, nao zero.
   *
   * Deliberado: um retangulo grande cobrindo meia tela nao deve ganhar de uma
   * linha de tendencia so por o cursor estar dentro dele.
   */
  it('ponto no CENTRO devolve a distancia a borda mais proxima, nao zero', () => {
    // Centro de um retangulo 0..10 x 0..20: borda mais proxima a 5 px.
    expect(distanceToRectOutline(5, 10, 0, 0, 10, 20)).toBeCloseTo(5, 10);
  });

  it('independe da ordem dos cantos', () => {
    const a = distanceToRectOutline(20, 20, 0, 0, 10, 10);
    const b = distanceToRectOutline(20, 20, 10, 10, 0, 0);
    const c = distanceToRectOutline(20, 20, 0, 10, 10, 0);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeCloseTo(c, 10);
  });
});

describe('distancias a infinitas', () => {
  it('horizontal e vertical medem no eixo perpendicular', () => {
    expect(distanceToHorizontal(10, 3)).toBe(7);
    expect(distanceToVertical(10, 3)).toBe(7);
    expect(distanceToHorizontal(-5, 5)).toBe(10);
  });
});

describe('boxOfPoints', () => {
  it('envolve os pontos com a folga', () => {
    const b = boxOfPoints([{ x: 10, y: 20 }, { x: 30, y: 5 }], 2);
    expect(b).toEqual({ minX: 8, minY: 3, maxX: 32, maxY: 22 });
  });

  it('lista vazia devolve null', () => {
    expect(boxOfPoints([])).toBeNull();
  });

  /**
   * ⭐ Nao pode devolver caixa com `Infinity`: ela passaria em qualquer teste de
   * intersecao e o prefiltro aceitaria TUDO — o oposto do proposito dele.
   */
  it('todos os pontos nao-finitos devolve null, nunca caixa infinita', () => {
    expect(boxOfPoints([{ x: NaN, y: 1 }, { x: Infinity, y: NaN }])).toBeNull();
  });

  it('ignora ponto nao-finito e usa os validos', () => {
    const b = boxOfPoints([{ x: NaN, y: NaN }, { x: 5, y: 5 }], 0);
    expect(b).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });

  it('contem todos os pontos de entrada', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ x: coord, y: coord }), { minLength: 1 }), (pontos) => {
        const b = boxOfPoints(pontos, 0);
        expect(b).not.toBeNull();
        if (b === null) return;
        for (const p of pontos) expect(isInsideBox(b, p.x, p.y)).toBe(true);
      }),
    );
  });
});

describe('isInsideBox / boxesIntersect', () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('inclui as bordas', () => {
    expect(isInsideBox(box, 0, 0)).toBe(true);
    expect(isInsideBox(box, 10, 10)).toBe(true);
    expect(isInsideBox(box, 10.001, 5)).toBe(false);
  });

  it('intersecao e simetrica e reflexiva', () => {
    expect(boxesIntersect(box, box)).toBe(true);
    const outra = { minX: 5, minY: 5, maxX: 20, maxY: 20 };
    expect(boxesIntersect(box, outra)).toBe(boxesIntersect(outra, box));
    expect(boxesIntersect(box, outra)).toBe(true);
  });

  it('encostar conta como intersecao', () => {
    expect(boxesIntersect(box, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
    expect(boxesIntersect(box, { minX: 10.001, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });
});

describe('segmentIntersectsBox', () => {
  const tela = viewportBox(800, 400, 0);

  it('ponta dentro intersecta', () => {
    expect(segmentIntersectsBox(400, 200, 5000, 5000, tela)).toBe(true);
  });

  /**
   * ⭐ O caso que o teste de caixa das pontas erra.
   *
   * Uma linha de tendencia longa com as DUAS ancoras fora da tela pode cruzar o
   * meio dela. Descarta-la a faria desaparecer justamente no zoom de perto.
   */
  it('ATRAVESSA com as duas pontas fora — o caso que caixa-contra-caixa erra', () => {
    // De muito a esquerda para muito a direita, na altura do meio.
    expect(segmentIntersectsBox(-5000, 200, 5000, 200, tela)).toBe(true);
    // Diagonal cruzando o canto.
    expect(segmentIntersectsBox(-100, -100, 900, 500, tela)).toBe(true);
  });

  it('completamente fora nao intersecta', () => {
    expect(segmentIntersectsBox(-100, -100, -50, -50, tela)).toBe(false);
    expect(segmentIntersectsBox(1000, 500, 2000, 600, tela)).toBe(false);
    // Paralela acima da tela.
    expect(segmentIntersectsBox(-100, -10, 900, -10, tela)).toBe(false);
  });

  it('nunca lanca', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, (ax, ay, bx, by) => {
        expect(() => segmentIntersectsBox(ax, ay, bx, by, tela)).not.toThrow();
        expect(typeof segmentIntersectsBox(ax, ay, bx, by, tela)).toBe('boolean');
      }),
    );
  });
});

describe('extendLineToBox', () => {
  const tela = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it('reta horizontal vai de borda a borda', () => {
    const r = extendLineToBox(10, 50, 20, 50, tela, 'LINE');
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r[0].x).toBeCloseTo(0, 6);
    expect(r[1].x).toBeCloseTo(100, 6);
    expect(r[0].y).toBeCloseTo(50, 6);
    expect(r[1].y).toBeCloseTo(50, 6);
  });

  /** O raio adiante comeca em `a` e nao volta atras dela. */
  it('RAY_FORWARD comeca na origem', () => {
    const r = extendLineToBox(10, 50, 20, 50, tela, 'RAY_FORWARD');
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r[0].x).toBeCloseTo(10, 6);
    expect(r[1].x).toBeCloseTo(100, 6);
  });

  it('RAY_BACKWARD termina na origem', () => {
    const r = extendLineToBox(10, 50, 20, 50, tela, 'RAY_BACKWARD');
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r[0].x).toBeCloseTo(0, 6);
    expect(r[1].x).toBeCloseTo(10, 6);
  });

  it('degenerada devolve null', () => {
    expect(extendLineToBox(10, 10, 10, 10, tela, 'LINE')).toBeNull();
  });

  it('reta que nao cruza a caixa devolve null', () => {
    // Horizontal muito acima da caixa.
    expect(extendLineToBox(0, -50, 100, -50, tela, 'LINE')).toBeNull();
  });

  /**
   * ⭐ O resultado fica DENTRO da caixa.
   *
   * E a razao de existir: desenhar com coordenada gigante faz o canvas perder
   * precisao de rasterizacao e a linha sai tremida.
   */
  it('as pontas ficam dentro da caixa, com folga de arredondamento', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (ax, ay, bx, by) => {
          const r = extendLineToBox(ax, ay, bx, by, tela, 'LINE');
          if (r === null) return;
          for (const p of r) {
            expect(p.x).toBeGreaterThanOrEqual(-1e-6);
            expect(p.x).toBeLessThanOrEqual(100 + 1e-6);
            expect(p.y).toBeGreaterThanOrEqual(-1e-6);
            expect(p.y).toBeLessThanOrEqual(100 + 1e-6);
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('constantes de tolerancia', () => {
  /**
   * A tolerancia de 7 px nao e arbitraria: 3 px exige precisao de cirurgiao num
   * traco de 1 px, e mais que isso faz o cursor grudar no desenho errado quando ha
   * varios proximos.
   */
  it('a tolerancia do traco e utilizavel e nao excessiva', () => {
    expect(HIT_TOLERANCE_PX).toBe(7);
    expect(HIT_TOLERANCE_PX).toBeGreaterThan(3);
    expect(HIT_TOLERANCE_PX).toBeLessThan(15);
  });
});

describe('lerp', () => {
  it('interpola e extrapola', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    // Extrapolacao e deliberada: nivel de Fibonacci acima de 1 (extensao) precisa.
    expect(lerp(0, 10, 1.618)).toBeCloseTo(16.18, 10);
    expect(lerp(0, 10, -0.5)).toBeCloseTo(-5, 10);
  });
});
