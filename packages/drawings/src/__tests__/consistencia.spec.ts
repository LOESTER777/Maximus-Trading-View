/**
 * consistencia — as propriedades que decidem se a ferramenta e boa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO PROVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Consistencia, para ferramenta de desenho, e uma coisa so: **a linha continua no
 * mesmo lugar do MERCADO**. Nao do ecra — do mercado. Isso se decompoe em:
 *
 *  1. pintar NAO altera o modelo (a projecao e leitura, nao efeito);
 *  2. pan e zoom nao mudam a ancora;
 *  3. trocar de periodo nao faz o desenho desaparecer;
 *  4. salvar e carregar devolve o mesmo desenho.
 *
 * A propriedade 3 e a que quase toda implementacao erra, e o teste dela abaixo
 * reproduz o mecanismo do defeito em vez de so verificar o resultado.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  buildRenderPlan,
  sameEpoch,
  type LogicalToScreen,
  type ViewportEpoch,
} from '../render-plan.core.js';
import { hitTest } from '../hit-test.core.js';
import { DRAWINGS_SCHEMA_VERSION, deserialize, serialize } from '../serialize.core.js';
import {
  createDefaultIdFactory,
  createDrawing,
  withAnchor,
  withTranslation,
  type Anchor,
  type Drawing,
  type DrawingKind,
} from '../model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Um grafico sintetico, com faixa visivel ajustavel
// ═════════════════════════════════════════════════════════════════════════════

interface GraficoFalso {
  readonly conv: LogicalToScreen;
  readonly epoca: ViewportEpoch;
}

/**
 * Constroi conversores lineares para uma faixa dada.
 *
 * Linear e suficiente: o que se testa aqui e invariancia, e ela nao depende da
 * forma da projecao — depende de a projecao ser funcao SO da epoca.
 */
function grafico(
  deSec: number,
  ateSec: number,
  precoBaixo: number,
  precoAlto: number,
  largura = 800,
  altura = 400,
): GraficoFalso {
  const conv: LogicalToScreen = {
    timeToX: (t) =>
      Number.isFinite(t) ? ((t - deSec) / (ateSec - deSec)) * largura : null,
    priceToY: (p) =>
      Number.isFinite(p) ? altura - ((p - precoBaixo) / (precoAlto - precoBaixo)) * altura : null,
    width: () => largura,
    height: () => altura,
  };
  return {
    conv,
    epoca: {
      fromSec: deSec,
      toSec: ateSec,
      width: largura,
      height: altura,
      topPrice: precoAlto,
      bottomPrice: precoBaixo,
    },
  };
}

const LINHA: Drawing = {
  id: 'l1',
  kind: 'TRENDLINE',
  anchors: [
    { timeSec: 1_700_000_300, price: 120 },
    { timeSec: 1_700_003_900, price: 160 },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. Projetar nao altera o modelo
// ═════════════════════════════════════════════════════════════════════════════

describe('a projecao e LEITURA, nunca efeito', () => {
  it('as ancoras sao identicas depois de projetar', () => {
    const antes = JSON.stringify(LINHA);
    const g = grafico(1_700_000_000, 1_700_004_000, 100, 200);
    buildRenderPlan([LINHA], g.conv, g.epoca);
    expect(JSON.stringify(LINHA)).toBe(antes);
  });

  it('projetar dez vezes em epocas diferentes nao muda o desenho', () => {
    const antes = JSON.stringify(LINHA);
    for (let i = 0; i < 10; i++) {
      const g = grafico(1_700_000_000 + i * 100, 1_700_004_000 + i * 500, 100 + i, 200 + i * 2);
      buildRenderPlan([LINHA], g.conv, g.epoca);
    }
    expect(JSON.stringify(LINHA)).toBe(antes);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Pan e zoom nao mudam a ancora — mudam so o pixel
// ═════════════════════════════════════════════════════════════════════════════

describe('pan e zoom mexem no PIXEL, nao na ancora', () => {
  it('a mesma ancora projeta em pixel diferente e continua a mesma ancora', () => {
    const g1 = grafico(1_700_000_000, 1_700_004_000, 100, 200);
    const g2 = grafico(1_700_001_000, 1_700_003_000, 110, 180); // zoom + pan

    const p1 = buildRenderPlan([LINHA], g1.conv, g1.epoca);
    const p2 = buildRenderPlan([LINHA], g2.conv, g2.epoca);

    const i1 = p1.items[0];
    const i2 = p2.items[0];
    expect(i1).toBeDefined();
    expect(i2).toBeDefined();
    if (i1 === undefined || i2 === undefined) return;

    // O pixel mudou...
    expect(i1.points[0]?.x).not.toBeCloseTo(i2.points[0]?.x ?? -1, 3);
    // ...e a ancora nao.
    expect(LINHA.anchors[0]?.timeSec).toBe(1_700_000_300);
    expect(LINHA.anchors[0]?.price).toBe(120);
  });

  /**
   * ⭐ Ida e volta pela projecao: pixel -> ancora -> pixel devolve o mesmo pixel.
   *
   * E o que garante que arrastar e soltar no mesmo lugar nao desloca o desenho.
   */
  it('pixel -> ancora -> pixel e estavel', () => {
    const de = 1_700_000_000;
    const ate = 1_700_004_000;
    const baixo = 100;
    const alto = 200;
    const largura = 800;
    const altura = 400;
    const g = grafico(de, ate, baixo, alto, largura, altura);

    const xParaTempo = (x: number): number => de + (x / largura) * (ate - de);
    const yParaPreco = (y: number): number => baixo + ((altura - y) / altura) * (alto - baixo);

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: largura, noNaN: true }),
        fc.double({ min: 0, max: altura, noNaN: true }),
        (x, y) => {
          const t = xParaTempo(x);
          const p = yParaPreco(y);
          const xVolta = g.conv.timeToX(t);
          const yVolta = g.conv.priceToY(p);
          expect(xVolta).not.toBeNull();
          expect(yVolta).not.toBeNull();
          expect(Math.abs((xVolta as number) - x)).toBeLessThan 	(1e-6);
          expect(Math.abs((yVolta as number) - y)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('a epoca identifica a projecao: iguais valem cache, diferentes nao', () => {
    const a = grafico(0, 100, 0, 10).epoca;
    const b = grafico(0, 100, 0, 10).epoca;
    expect(sameEpoch(a, b)).toBe(true);

    // Cada dimensao da epoca precisa invalidar por conta.
    expect(sameEpoch(a, { ...a, fromSec: 1 })).toBe(false);
    expect(sameEpoch(a, { ...a, toSec: 101 })).toBe(false);
    // ⚠️ Redimensionar a janela NAO muda a faixa de tempo. Sem o tamanho na
    // epoca, o cache sobreviveria a um resize e o hit-test responderia em
    // coordenada velha.
    expect(sameEpoch(a, { ...a, width: 801 })).toBe(false);
    expect(sameEpoch(a, { ...a, height: 401 })).toBe(false);
    // Mudar a escala de preco tambem nao muda a faixa de tempo.
    expect(sameEpoch(a, { ...a, topPrice: 11 })).toBe(false);
    expect(sameEpoch(a, { ...a, bottomPrice: -1 })).toBe(false);
    expect(sameEpoch(null, a)).toBe(false);
    expect(sameEpoch(a, null)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ⭐⭐ SOBREVIVENCIA A TROCA DE PERIODO
// ═════════════════════════════════════════════════════════════════════════════

describe('troca de periodo — o defeito que quase toda implementacao tem', () => {
  /**
   * Reproduz o MECANISMO do defeito.
   *
   * `timeToCoordinate` do substrato devolve `null` quando o instante nao e uma
   * barra da escala. Este conversor imita isso: so aceita multiplos do periodo.
   */
  function convApenasBarras(periodoSec: number, deSec: number, largura = 800): LogicalToScreen {
    return {
      timeToX: (t) => {
        // Exatamente o comportamento do substrato: nao e barra, nao ha coordenada.
        if ((t - deSec) % periodoSec !== 0) return null;
        return ((t - deSec) / periodoSec) * 10;
      },
      priceToY: (p) => 400 - p,
      width: () => largura,
      height: () => 400,
    };
  }

  /** O conversor CORRETO: acha a barra mais proxima e interpola a fracao. */
  function convComInterpolacao(periodoSec: number, deSec: number, largura = 800): LogicalToScreen {
    return {
      timeToX: (t) => {
        if (!Number.isFinite(t)) return null;
        // Indice fracionario — e o que `timeToIndex(findNearest)` +
        // `logicalToCoordinate` produzem juntos.
        const indice = (t - deSec) / periodoSec;
        return indice * 10;
      },
      priceToY: (p) => 400 - p,
      width: () => largura,
      height: () => 400,
    };
  }

  const DE = 1_700_000_000;
  const M5 = 300;
  const H1 = 3600;

  // Ancora criada em M5, num instante que NAO e barra de H1.
  const emM5: Drawing = {
    id: 'd1',
    kind: 'TRENDLINE',
    anchors: [
      { timeSec: DE + 5 * M5, price: 120 }, // +25min: e barra de M5, nao de H1
      { timeSec: DE + 11 * M5, price: 160 }, // +55min: idem
    ],
  };

  const epoca: ViewportEpoch = {
    fromSec: DE,
    toSec: DE + 24 * H1,
    width: 800,
    height: 400,
    topPrice: 400,
    bottomPrice: 0,
  };

  it('em M5 o desenho aparece nos dois conversores', () => {
    const ingenuo = buildRenderPlan([emM5], convApenasBarras(M5, DE), epoca);
    const correto = buildRenderPlan([emM5], convComInterpolacao(M5, DE), epoca);
    expect(ingenuo.items).toHaveLength(1);
    expect(correto.items).toHaveLength(1);
  });

  /**
   * ⭐⭐ AQUI ESTA O DEFEITO.
   *
   * Trocado para H1, o conversor ingenuo perde o desenho — porque +25min nao e
   * barra de H1 e `timeToCoordinate` devolve `null`. Para o usuario: "troquei o
   * periodo e meus desenhos sumiram".
   */
  it('trocado para H1, o conversor INGENUO PERDE o desenho', () => {
    const plano = buildRenderPlan([emM5], convApenasBarras(H1, DE), epoca);
    expect(plano.items).toHaveLength(0);
    expect(plano.culled).toBe(1);
  });

  /** E o conversor com interpolacao o mantem. E a razao de `chart-converters.ts`. */
  it('trocado para H1, o conversor com INTERPOLACAO mantem o desenho', () => {
    const plano = buildRenderPlan([emM5], convComInterpolacao(H1, DE), epoca);
    expect(plano.items).toHaveLength(1);

    const item = plano.items[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    // E numa posicao FRACIONARIA da barra, nao colada ao centro dela: 25min de
    // 60min = 0,4166 da barra 0.
    const x0 = item.points[0]?.x ?? -1;
    expect(x0).toBeGreaterThan(0);
    expect(x0).toBeLessThan(10); // dentro da primeira barra de H1
    expect(x0).toBeCloseTo((25 / 60) * 10, 6);
  });

  it('sobrevive a qualquer periodo, e a ancora nunca muda', () => {
    const antes = JSON.stringify(emM5);
    for (const periodo of [60, 120, M5, 900, H1, 4 * H1, 86_400]) {
      const plano = buildRenderPlan([emM5], convComInterpolacao(periodo, DE), epoca);
      expect(plano.items.length).toBe(1);
    }
    expect(JSON.stringify(emM5)).toBe(antes);
  });

  it('e o desenho continua ACERTAVEL depois da troca', () => {
    const conv = convComInterpolacao(H1, DE);
    const plano = buildRenderPlan([emM5], conv, epoca);
    const item = plano.items[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    const p = item.points[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    // Sobre a primeira alca.
    const h = hitTest(plano, p.x, p.y);
    expect(h?.id).toBe('d1');
    expect(h?.part).toBe('HANDLE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Salvar e carregar
// ═════════════════════════════════════════════════════════════════════════════

describe('persistencia — ida e volta', () => {
  const ids = createDefaultIdFactory();

  const TIPOS: readonly DrawingKind[] = [
    'TRENDLINE',
    'RAY',
    'EXTENDED_LINE',
    'HORIZONTAL_LINE',
    'VERTICAL_LINE',
    'RECTANGLE',
    'FIB_RETRACEMENT',
    'MEASURE',
  ];

  it('round-trip preserva todo tipo de desenho', () => {
    const originais = TIPOS.map((kind, i) =>
      createDrawing(
        {
          kind,
          anchors: [
            { timeSec: 1_700_000_000 + i * 60, price: 100 + i },
            { timeSec: 1_700_000_600 + i * 60, price: 150 + i },
          ],
          style: { color: '#abcdef', lineWidth: 2, lineStyle: 'DASHED', fill: 'rgba(1,2,3,0.4)', label: `r${i}` },
        },
        ids,
      ),
    );

    const doc = serialize(originais, 'WINV26');
    const lido = deserialize(JSON.parse(JSON.stringify(doc)));

    expect(lido.rejected).toBe(0);
    expect(lido.document.symbol).toBe('WINV26');
    expect(lido.document.version).toBe(DRAWINGS_SCHEMA_VERSION);
    expect(lido.document.drawings).toHaveLength(originais.length);

    for (let i = 0; i < originais.length; i++) {
      const o = originais[i];
      const v = lido.document.drawings[i];
      expect(v?.id).toBe(o?.id);
      expect(v?.kind).toBe(o?.kind);
      expect(v?.anchors[0]).toEqual(o?.anchors[0]);
      expect(v?.style?.color).toBe('#abcdef');
      expect(v?.style?.lineStyle).toBe('DASHED');
    }
  });

  it('round-trip preserva a ancora bit a bit, para qualquer valor plausivel', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e8, max: 2e9, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (timeSec, price) => {
          const d: Drawing = {
            id: 'x',
            kind: 'HORIZONTAL_LINE',
            anchors: [{ timeSec, price }],
          };
          const lido = deserialize(JSON.parse(JSON.stringify(serialize([d]))));
          const volta = lido.document.drawings[0]?.anchors[0];
          expect(volta).toBeDefined();
          if (volta === undefined) return;
          /*
           * ⚠️ Igualdade NUMERICA, e nao `Object.is`.
           *
           * `-0` nao sobrevive a um round-trip JSON: `JSON.stringify(-0)` produz
           * `"0"`, e o valor volta como `+0`. `Object.is(-0, 0)` e `false`, entao
           * `toBe` reprovaria — foi o que este teste pegou.
           *
           * Para instante e preco a distincao e inocua: `-0 === 0` em toda
           * aritmetica, e nenhuma coordenada muda. Afirmar identidade de sinal de
           * zero aqui seria exigir do formato uma garantia que ele nao da e que
           * nao precisamos.
           */
          expect(volta.timeSec === timeSec).toBe(true);
          expect(volta.price === price).toBe(true);
        },
      ),
    );
  });

  /** O documento nao deve compartilhar referencia com o estado vivo. */
  it('serializar COPIA — editar depois nao altera o que foi salvo', () => {
    const d = createDrawing(
      { kind: 'TRENDLINE', anchors: [{ timeSec: 1, price: 1 }, { timeSec: 2, price: 2 }] },
      ids,
    );
    const doc = serialize([d]);
    // Edicao produz objeto novo (o modelo e imutavel), mas ainda: o documento nao
    // deve apontar para os MESMOS arrays.
    const movido = withTranslation(d, 1000, 50);
    expect(movido).not.toBe(d);
    expect(doc.drawings[0]?.anchors[0]?.timeSec).toBe(1);
    expect(doc.drawings[0]?.anchors).not.toBe(d.anchors);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Imutabilidade do modelo — o que sustenta o desfazer
// ═════════════════════════════════════════════════════════════════════════════

describe('imutabilidade', () => {
  const base: Drawing = {
    id: 'b',
    kind: 'TRENDLINE',
    anchors: [
      { timeSec: 100, price: 10 },
      { timeSec: 200, price: 20 },
    ],
  };

  it('withAnchor devolve objeto NOVO e nao toca no original', () => {
    const novo = withAnchor(base, 1, { timeSec: 999, price: 99 });
    expect(novo).not.toBe(base);
    expect(base.anchors[1]).toEqual({ timeSec: 200, price: 20 });
    expect(novo.anchors[1]).toEqual({ timeSec: 999, price: 99 });
    expect(novo.anchors[0]).toEqual(base.anchors[0]);
  });

  it('withTranslation desloca TODAS as ancoras, sem tocar no original', () => {
    const novo = withTranslation(base, 50, 5);
    expect(novo.anchors[0]).toEqual({ timeSec: 150, price: 15 });
    expect(novo.anchors[1]).toEqual({ timeSec: 250, price: 25 });
    expect(base.anchors[0]).toEqual({ timeSec: 100, price: 10 });
  });

  /**
   * Indice fora da faixa devolve o desenho INALTERADO.
   *
   * Crescer o array com buracos transformaria erro de quem chama em desenho
   * corrompido que so falha na hora de pintar.
   */
  it('indice de alca invalido devolve o mesmo objeto, sem criar buraco', () => {
    expect(withAnchor(base, 5, { timeSec: 1, price: 1 })).toBe(base);
    expect(withAnchor(base, -1, { timeSec: 1, price: 1 })).toBe(base);
    expect(withAnchor(base, 1.5, { timeSec: 1, price: 1 })).toBe(base);
  });

  it('ancora nao-finita e recusada em vez de propagar NaN para a geometria', () => {
    expect(withAnchor(base, 0, { timeSec: NaN, price: 1 })).toBe(base);
    expect(withAnchor(base, 0, { timeSec: 1, price: Infinity })).toBe(base);
    expect(withTranslation(base, NaN, 0)).toBe(base);
  });

  it('translacao por zero e identidade NUMERICA', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        (t, p) => {
          const d: Drawing = {
            id: 'x',
            kind: 'TRENDLINE',
            anchors: [
              { timeSec: t, price: p },
              { timeSec: t + 1, price: p + 1 },
            ],
          };
          const igual = withTranslation(d, 0, 0);
          /*
           * ⚠️ Comparacao NUMERICA, e nao `toEqual`.
           *
           * `withTranslation(d, 0, 0)` faz `x + 0`, e isso normaliza `-0` para
           * `+0`. `toEqual` distingue os dois, entao a propriedade de "identidade"
           * reprovaria para uma ancora em `-0` — foi o que este teste pegou.
           *
           * Afirmar identidade de sinal de zero seria exigir do modelo uma
           * garantia sem consequencia: `-0 === 0` em toda aritmetica de
           * coordenada, e nenhum pixel muda.
           */
          expect(igual.anchors).toHaveLength(d.anchors.length);
          for (let i = 0; i < d.anchors.length; i++) {
            expect(igual.anchors[i]?.timeSec === d.anchors[i]?.timeSec).toBe(true);
            expect(igual.anchors[i]?.price === d.anchors[i]?.price).toBe(true);
          }
        },
      ),
    );
  });

  it('translacao e reversivel', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        (dt, dp) => {
          const ida = withTranslation(base, dt, dp);
          const volta = withTranslation(ida, -dt, -dp);
          const a0 = volta.anchors[0] as Anchor;
          expect(Math.abs(a0.timeSec - 100)).toBeLessThan(1e-6);
          expect(Math.abs(a0.price - 10)).toBeLessThan(1e-6);
        },
      ),
    );
  });
});
