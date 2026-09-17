/**
 * As cinco ferramentas novas: raio horizontal, seta, extensão de Fibonacci e as posições.
 *
 * ⭐ O que estes testes travam é o que cada ferramenta AFIRMA na tela:
 *
 *  - o raio começa no ponto e não antes dele (um topo das 10h não era resistência às 9h);
 *  - a seta tem ponta, e ela é feita de traços (herda cor, acerto e recorte de graça);
 *  - a extensão projeta ALÉM do movimento, não dentro dele;
 *  - a posição pinta risco e retorno na PROPORÇÃO, e o alvo segue o múltiplo de risco.
 *
 * ⚠️ Tudo medido no PLANO DE DESENHO (pixel), que é onde as decisões de geometria moram. O
 * jsdom não rasteriza, e isso é requisito do projeto.
 */
import { describe, expect, it } from 'vitest';
import { buildRenderPlan } from '../render-plan.core.js';
import { createDrawing, R_MULTIPLE_DEFAULT, type Drawing } from '../model.js';

const LARGURA = 800;
const ALTURA = 400;

/**
 * Conversores lineares e triviais: tempo→x e preço→y.
 *
 * `preço 0` no pé e `preço 400` no topo, 1 px por unidade — assim a asserção em pixel se lê
 * como preço, e o teste não vira aritmética de escala.
 */
const CONV = {
  timeToX: (t: number): number => t,
  priceToY: (p: number): number => ALTURA - p,
  width: (): number => LARGURA,
  height: (): number => ALTURA,
};

function plano(desenhos: readonly Drawing[]): ReturnType<typeof buildRenderPlan> {
  return buildRenderPlan(desenhos, CONV, 1);
}

function desenho(kind: Drawing['kind'], a: [number, number], b: [number, number], extra: Partial<Drawing> = {}): Drawing {
  return createDrawing(
    {
      kind,
      anchors: [
        { timeSec: a[0], price: a[1] },
        { timeSec: b[0], price: b[1] },
      ],
      ...extra,
    },
    () => 'x1',
  );
}

describe('HORIZONTAL_RAY — vale a partir do ponto, e não antes', () => {
  it('⭐ o traço começa na âncora e vai até a borda direita', () => {
    const item = plano([desenho('HORIZONTAL_RAY', [200, 300], [500, 250])]).items[0];
    expect(item).toBeDefined();
    const s = item!.strokes[0];
    expect(s).toBeDefined();
    expect(s!.a.x).toBe(200);
    expect(s!.b.x).toBe(LARGURA);
  });

  it('⭐⭐ o PREÇO vem da primeira âncora; o `y` da segunda é ignorado', () => {
    // Sem isto, um raio horizontal cujo preço mudasse com a altura do arrasto seria
    // impossível de colocar exatamente num topo — que é a única razão de ele existir.
    const item = plano([desenho('HORIZONTAL_RAY', [200, 300], [500, 120])]).items[0]!;
    const s = item.strokes[0]!;
    expect(s.a.y).toBe(CONV.priceToY(300));
    expect(s.b.y).toBe(CONV.priceToY(300));
  });

  it('arrastar para a ESQUERDA aponta o raio para a esquerda', () => {
    const item = plano([desenho('HORIZONTAL_RAY', [500, 300], [200, 300])]).items[0]!;
    const s = item.strokes[0]!;
    expect(s.a.x).toBe(500);
    expect(s.b.x).toBe(0);
  });

  it('fora da faixa vertical visível, não projeta', () => {
    // Preço 900 num painel de 400 px de altura.
    expect(plano([desenho('HORIZONTAL_RAY', [200, 900], [500, 900])]).items).toHaveLength(0);
  });
});

describe('ARROW — a ponta é feita de traços', () => {
  it('⭐ emite o corpo mais DOIS segmentos de ponta', () => {
    // ⚠️ A ponta como traço herda cor, espessura, tracejado, acerto de ponteiro e recorte
    // sem uma linha nova no renderizador — e fica acertável pela ponta, que é onde o olho a
    // procura.
    const item = plano([desenho('ARROW', [100, 100], [300, 300])]).items[0]!;
    expect(item.strokes).toHaveLength(3);
    const corpo = item.strokes[0]!;
    expect(corpo.a.x).toBe(100);
    expect(corpo.b.x).toBe(300);
  });

  it('os dois segmentos da ponta partem da SEGUNDA âncora', () => {
    const item = plano([desenho('ARROW', [100, 100], [300, 300])]).items[0]!;
    const destino = { x: 300, y: CONV.priceToY(300) };
    for (const s of item.strokes.slice(1)) {
      expect(s.a).toEqual(destino);
    }
  });

  it('⚠️ seta de comprimento ZERO degrada para o segmento, sem ponta com ângulo NaN', () => {
    // `atan2(0,0)` é 0, mas a ponta de tamanho zero produziria segmentos degenerados que o
    // canvas simplesmente não pinta — e a seta apareceria como nada.
    const item = plano([desenho('ARROW', [100, 100], [100, 100])]).items[0]!;
    expect(item.strokes).toHaveLength(1);
    for (const s of item.strokes) {
      expect(Number.isFinite(s.a.x) && Number.isFinite(s.b.x)).toBe(true);
    }
  });

  it('a ponta cresce com o comprimento, com teto', () => {
    const tamanhoDaPonta = (de: [number, number], ate: [number, number]): number => {
      const item = plano([desenho('ARROW', de, ate)]).items[0]!;
      const s = item.strokes[1]!;
      return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    };
    const curta = tamanhoDaPonta([100, 100], [120, 100]);
    const media = tamanhoDaPonta([100, 100], [250, 100]);
    const longa = tamanhoDaPonta([0, 100], [700, 100]);
    // Uma seta curta viraria só ponta; uma longa teria ponta minúscula.
    expect(curta).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(media).toBeGreaterThan(curta);
    expect(longa).toBeLessThanOrEqual(14 + 1e-6);
  });
});

describe('FIB_EXTENSION — projeta ALÉM do movimento', () => {
  it('⭐ os níveis default passam de 1 e o 1 está presente como referência', () => {
    const item = plano([desenho('FIB_EXTENSION', [100, 100], [300, 200])]).items[0]!;
    const niveis = item.fibLines.map((l) => l.level);
    expect(niveis).toEqual([1, 1.272, 1.618, 2, 2.618]);
  });

  it('⭐⭐ o nível 1,618 cai FORA do intervalo entre as âncoras', () => {
    // É a diferença entre extensão e retração: a retração fica dentro do movimento, a
    // extensão o projeta adiante. Um default único faria a extensão nascer mostrando
    // retração — a ferramenta errada com o nome certo.
    const item = plano([desenho('FIB_EXTENSION', [100, 100], [300, 200])]).items[0]!;
    const y100 = CONV.priceToY(100);
    const y200 = CONV.priceToY(200);
    const nivel = item.fibLines.find((l) => l.level === 1.618)!;
    // Movimento de 100 para 200: 1,618 projeta em 261,8 — acima do topo do movimento.
    expect(nivel.y).toBeLessThan(Math.min(y100, y200));
    expect(nivel.y).toBeCloseTo(CONV.priceToY(261.8), 5);
  });

  it('a retração continua com os níveis dela — as duas não se contaminam', () => {
    const item = plano([desenho('FIB_RETRACEMENT', [100, 100], [300, 200])]).items[0]!;
    expect(item.fibLines.map((l) => l.level)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
  });

  it('níveis explícitos vencem o default do tipo', () => {
    const d = desenho('FIB_EXTENSION', [100, 100], [300, 200], { fibLevels: [1.5] });
    expect(plano([d]).items[0]!.fibLines.map((l) => l.level)).toEqual([1.5]);
  });
});

describe('POSITION_LONG / SHORT — risco e retorno na proporção', () => {
  /** Entrada em 200, stop em 180 ⇒ risco de 20 pontos. */
  const compra = (extra: Partial<Drawing> = {}): Drawing =>
    desenho('POSITION_LONG', [100, 200], [200, 180], extra);

  it('⭐ pinta DUAS zonas com cores próprias', () => {
    const item = plano([compra()]).items[0]!;
    expect(item.zonas).toHaveLength(2);
    const cores = item.zonas.map((z) => z.cor);
    // ⚠️ Verde é lucro e vermelho é risco em toda mesa do mundo. Passar as duas pelo
    // `style.fill` daria uma cor só e a informação central desapareceria.
    expect(cores.some((c) => c.includes('22, 199, 132'))).toBe(true);
    expect(cores.some((c) => c.includes('234, 57, 67'))).toBe(true);
  });

  it('⭐⭐ o ALVO sai no múltiplo de risco default (2R)', () => {
    const item = plano([compra()]).items[0]!;
    // Risco de 20 pontos abaixo da entrada ⇒ alvo 40 pontos ACIMA: 240.
    const yAlvo = item.strokes[2]!.a.y;
    expect(yAlvo).toBeCloseTo(CONV.priceToY(200 + 20 * R_MULTIPLE_DEFAULT), 5);
  });

  it('⭐ a zona de LUCRO é `rMultiple` vezes mais alta que a de risco', () => {
    const item = plano([compra()]).items[0]!;
    const altura = (i: number): number => item.zonas[i]!.box.maxY - item.zonas[i]!.box.minY;
    // É o que a ferramenta comunica sem número nenhum: a proporção, vista de longe.
    expect(altura(1) / altura(0)).toBeCloseTo(R_MULTIPLE_DEFAULT, 5);
  });

  it('`rMultiple` explícito muda o alvo e a proporção', () => {
    const item = plano([compra({ rMultiple: 3 })]).items[0]!;
    expect(item.strokes[2]!.a.y).toBeCloseTo(CONV.priceToY(260), 5);
    const altura = (i: number): number => item.zonas[i]!.box.maxY - item.zonas[i]!.box.minY;
    expect(altura(1) / altura(0)).toBeCloseTo(3, 5);
  });

  it('⚠️ `rMultiple` inválido é RECORTADO, nunca põe o alvo em cima da entrada', () => {
    // Zero ou negativo poria o alvo do lado errado, pintando a zona de lucro sobre a de
    // risco e invertendo a leitura da ferramenta.
    for (const r of [0, -5, Number.NaN]) {
      const item = plano([compra({ rMultiple: r })]).items[0]!;
      const yEntrada = item.strokes[0]!.a.y;
      const yAlvo = item.strokes[2]!.a.y;
      expect(yAlvo).not.toBeCloseTo(yEntrada, 5);
      // Numa compra o alvo fica ACIMA da entrada (y menor).
      expect(yAlvo).toBeLessThan(yEntrada);
    }
  });

  it('⭐ na VENDA o stop fica acima e o alvo abaixo — espelho exato', () => {
    // Entrada 200, stop 220 ⇒ alvo 160 (2 × 20 para baixo).
    const item = plano([desenho('POSITION_SHORT', [100, 200], [200, 220])]).items[0]!;
    const yEntrada = item.strokes[0]!.a.y;
    const yStop = item.strokes[1]!.a.y;
    const yAlvo = item.strokes[2]!.a.y;
    expect(yStop).toBeLessThan(yEntrada);
    expect(yAlvo).toBeGreaterThan(yEntrada);
    expect(yAlvo).toBeCloseTo(CONV.priceToY(160), 5);
  });

  it('⚠️ stop no MESMO preço da entrada degrada para o traço da entrada', () => {
    // Não define posição: a zona de risco teria altura zero e o alvo nasceria de uma
    // divisão sem sentido. Acontece durante a criação, antes de o operador arrastar.
    const item = plano([desenho('POSITION_LONG', [100, 200], [200, 200])]).items[0]!;
    expect(item.zonas).toHaveLength(0);
    expect(item.strokes).toHaveLength(1);
  });

  it('a posição tem largura mínima visível mesmo com as âncoras na mesma coluna', () => {
    // Uma posição sem largura não se lê. O piso é de 60 px.
    const item = plano([desenho('POSITION_LONG', [100, 200], [100, 180])]).items[0]!;
    const z = item.zonas[0]!.box;
    expect(z.maxX - z.minX).toBeGreaterThanOrEqual(60);
  });

  it('três traços: entrada, stop e alvo — a zona dá a proporção, o traço dá o número', () => {
    const item = plano([compra()]).items[0]!;
    expect(item.strokes).toHaveLength(3);
    expect(item.strokes[1]!.a.y).toBeCloseTo(CONV.priceToY(180), 5);
  });
});
