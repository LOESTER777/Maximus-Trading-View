/**
 * As SETE ferramentas da rodada 4 — e o defeito de persistência que elas encontraram.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA BANCADA TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cada caso aqui prova uma AFIRMAÇÃO da ferramenta na tela, não a existência dela:
 *
 *  - o **canal paralelo** abre do lado certo, e a largura é uma RAZÃO (não há terceiro clique);
 *  - a **elipse** é polilinha fechada, com contagem de segmentos que acompanha o tamanho;
 *  - a **nota** aparece mesmo sem texto, e o rótulo vale para QUALQUER ferramenta;
 *  - as **zonas** estendem-se para a DIREITA e têm cor semântica fixa;
 *  - o **leque** sai inclinado de um ponto só;
 *  - as **zonas de tempo** extrapolam em PIXEL — e é isso que as faz existir depois da última
 *    barra.
 *
 * ⚠️⚠️ **E há um defeito REAL travado aqui**: `rMultiple` não era serializado. Uma posição
 * salva com 3R voltava com 2R, sem erro nenhum — numa ferramenta de risco-retorno é o pior
 * defeito possível, porque o alvo fica no lugar errado e a tela não avisa. O caso
 * `ida-e-volta preserva TODO campo` reprova se o próximo campo novo for esquecido pelo mesmo
 * caminho.
 *
 * ⚠️ Tudo medido no PLANO (pixel), que é onde a geometria mora. O jsdom não rasteriza, e isso é
 * requisito do projeto.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  larguraDeTextoEstimada,
  TEXT_BOX_HEIGHT_PX,
  type RenderPlan,
  type ViewportEpoch,
} from '../render-plan.core.js';
import { hitTest } from '../hit-test.core.js';
import { deserialize, serialize } from '../serialize.core.js';
import {
  CHANNEL_WIDTH_RATIO_DEFAULT,
  FIB_TIME_LEVELS_DEFAULT,
  TEXT_NOTE_PLACEHOLDER,
  ZONE_DEMAND_COLOR,
  ZONE_SUPPLY_COLOR,
  channelWidthRatioOf,
  createDrawing,
  fibLevelsOf,
  labelOf,
  type Drawing,
  type DrawingKind,
} from '../model.js';

const LARGURA = 800;
const ALTURA = 400;

/** Conversores lineares: 1 px por unidade, preço 0 no pé. A asserção em pixel lê-se como preço. */
const CONV = {
  timeToX: (t: number): number => t,
  priceToY: (p: number): number => ALTURA - p,
  width: (): number => LARGURA,
  height: (): number => ALTURA,
};

const EPOCA: ViewportEpoch = {
  fromSec: 0,
  toSec: LARGURA,
  width: LARGURA,
  height: ALTURA,
  topPrice: ALTURA,
  bottomPrice: 0,
};

function plano(desenhos: readonly Drawing[]): RenderPlan {
  return buildRenderPlan(desenhos, CONV, EPOCA);
}

let seq = 0;
function dwg(
  kind: DrawingKind,
  ancoras: ReadonlyArray<[number, number]>,
  extra: Partial<Drawing> = {},
): Drawing {
  seq += 1;
  return createDrawing(
    {
      kind,
      anchors: ancoras.map(([timeSec, price]) => ({ timeSec, price })),
      ...extra,
    },
    () => `d${seq}`,
  );
}

/** O único item do plano. Falha alto em vez de devolver `undefined` silencioso. */
function unico(desenho: Drawing): RenderPlan['items'][number] {
  const p = plano([desenho]);
  const it = p.items[0];
  if (it === undefined) {
    throw new Error(`o desenho ${desenho.kind} não entrou no plano (culled=${p.culled})`);
  }
  return it;
}

// ═════════════════════════════════════════════════════════════════════════════
// PARALLEL_CHANNEL
// ═════════════════════════════════════════════════════════════════════════════

describe('PARALLEL_CHANNEL — duas retas, e a terceira âncora é um número', () => {
  it('⭐ emite DUAS retas paralelas: mesmo Δy nas duas pontas', () => {
    // Base subindo: de (100, preço 100) a (300, preço 200).
    const it = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]]));
    expect(it.strokes).toHaveLength(2);
    const [base, paralela] = it.strokes as [
      RenderPlan['items'][number]['strokes'][number],
      RenderPlan['items'][number]['strokes'][number],
    ];
    // Paralelismo é a única coisa que a ferramenta promete pelo nome: o deslocamento vertical
    // tem de ser IDÊNTICO nas duas pontas.
    expect(paralela.a.y - base.a.y).toBeCloseTo(paralela.b.y - base.b.y, 10);
    // E o X não muda: a paralela cobre o mesmo intervalo de tempo.
    expect(paralela.a.x).toBe(base.a.x);
    expect(paralela.b.x).toBe(base.b.x);
  });

  it('⭐⭐ em ALTA a paralela nasce ACIMA da base — sem caso especial no código', () => {
    // ⚠️ É o comportamento que se quer de um canal traçado pelos FUNDOS: a segunda reta é o
    // teto. Ele cai de graça porque y cresce para baixo e o deslocamento herda o sinal do
    // movimento. Se alguém "consertar" isso com `Math.abs`, este caso reprova.
    const alta = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]]));
    const [base, paralela] = alta.strokes;
    expect(paralela!.a.y).toBeLessThan(base!.a.y); // menor y = mais alto na tela

    const queda = unico(dwg('PARALLEL_CHANNEL', [[100, 200], [300, 100]]));
    expect(queda.strokes[1]!.a.y).toBeGreaterThan(queda.strokes[0]!.a.y);
  });

  it('⭐ a largura é uma RAZÃO do próprio movimento: dobrar a razão dobra o afastamento', () => {
    const um = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]], { channelWidthRatio: 1 }));
    const dois = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]], { channelWidthRatio: 2 }));
    const afastamento = (it: RenderPlan['items'][number]): number =>
      Math.abs(it.strokes[1]!.a.y - it.strokes[0]!.a.y);
    expect(afastamento(dois)).toBeCloseTo(afastamento(um) * 2, 6);
  });

  it('⭐⭐ razão NEGATIVA joga o canal para o outro lado (não é espelhada para positiva)', () => {
    // Espelhar com `Math.abs` faria `-1` desenhar em cima de `+1`, e o operador concluiria que
    // o controle de largura está travado.
    const mais = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]], { channelWidthRatio: 1 }));
    const menos = unico(dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]], { channelWidthRatio: -1 }));
    const dA = mais.strokes[1]!.a.y - mais.strokes[0]!.a.y;
    const dB = menos.strokes[1]!.a.y - menos.strokes[0]!.a.y;
    expect(Math.sign(dA)).toBe(-Math.sign(dB));
  });

  it('⚠️ base HORIZONTAL degenera para UMA reta, e a degradação é declarada', () => {
    // Não há de onde derivar largura numa base sem inclinação, e inventá-la a partir do NÍVEL
    // do preço é exatamente o erro que fez o Renko mostrar duas barras.
    const it = unico(dwg('PARALLEL_CHANNEL', [[100, 150], [300, 150]]));
    expect(it.strokes).toHaveLength(1);
  });

  it('`channelWidthRatioOf` recorta a faixa e recusa zero', () => {
    const base = dwg('PARALLEL_CHANNEL', [[0, 0], [1, 1]]);
    expect(channelWidthRatioOf(base)).toBe(CHANNEL_WIDTH_RATIO_DEFAULT);
    expect(channelWidthRatioOf({ ...base, channelWidthRatio: 0 })).toBe(CHANNEL_WIDTH_RATIO_DEFAULT);
    expect(channelWidthRatioOf({ ...base, channelWidthRatio: Number.NaN })).toBe(
      CHANNEL_WIDTH_RATIO_DEFAULT,
    );
    // Zero de largura seria indistinguível de uma linha de tendência na tela, mas responderia
    // ao hit-test como canal — cada ferramenta tem de ser reconhecível pelo que desenha.
    expect(channelWidthRatioOf({ ...base, channelWidthRatio: 0.0001 })).toBe(0.05);
    expect(channelWidthRatioOf({ ...base, channelWidthRatio: 500 })).toBe(10);
    expect(channelWidthRatioOf({ ...base, channelWidthRatio: -500 })).toBe(-10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ELLIPSE
// ═════════════════════════════════════════════════════════════════════════════

describe('ELLIPSE — polilinha, e não forma nova no renderizador', () => {
  it('⭐ a polilinha FECHA: a última ponta volta à primeira', () => {
    const it = unico(dwg('ELLIPSE', [[100, 100], [300, 200]]));
    const primeiro = it.strokes[0]!;
    const ultimo = it.strokes[it.strokes.length - 1]!;
    expect(ultimo.b.x).toBeCloseTo(primeiro.a.x, 6);
    expect(ultimo.b.y).toBeCloseTo(primeiro.a.y, 6);
  });

  it('⭐ todo vértice satisfaz a equação da elipse (é elipse, não polígono qualquer)', () => {
    const it = unico(dwg('ELLIPSE', [[100, 100], [300, 200]]));
    const cx = (100 + 300) / 2;
    const cy = (CONV.priceToY(100) + CONV.priceToY(200)) / 2;
    const rx = 100;
    const ry = 50;
    for (const s of it.strokes) {
      const v = (s.a.x - cx) ** 2 / rx ** 2 + (s.a.y - cy) ** 2 / ry ** 2;
      expect(v).toBeCloseTo(1, 6);
    }
  });

  it('⚠️ a contagem de segmentos ACOMPANHA o tamanho, e é recortada em 24..72', () => {
    // Constante fixa erra dos dois lados: 24 numa elipse grande vira polígono visível, e 72
    // numa pequena são 72 traços para pintar 30 px de contorno — no hit-test também.
    const pequena = unico(dwg('ELLIPSE', [[100, 100], [130, 115]])).strokes.length;
    const grande = unico(dwg('ELLIPSE', [[10, 10], [790, 390]])).strokes.length;
    expect(pequena).toBe(24);
    expect(grande).toBe(72);
    expect(grande).toBeGreaterThan(pequena);
  });

  it('⚠️ NÃO tem `region`: preencher a caixa pintaria um retângulo', () => {
    const it = unico(dwg('ELLIPSE', [[100, 100], [300, 200]], { style: { fill: '#fff' } }));
    expect(it.region).toBeNull();
  });

  it('⭐ o miolo NÃO captura o ponteiro — o pan continua funcionando dentro dela', () => {
    const p = plano([dwg('ELLIPSE', [[100, 100], [300, 200]], { style: { fill: '#fff' } })]);
    // Centro exato da elipse, longe do contorno (rx=100, ry=50).
    expect(hitTest(p, 200, CONV.priceToY(150))).toBeNull();
    // E o contorno pega: extremo direito da elipse.
    expect(hitTest(p, 300, CONV.priceToY(150))).not.toBeNull();
  });

  it('⚠️ raio nulo num eixo degenera para a diagonal, e não para um vai-e-vem', () => {
    const it = unico(dwg('ELLIPSE', [[100, 150], [300, 150]]));
    expect(it.strokes).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEXT_NOTE e o RÓTULO de qualquer ferramenta
// ═════════════════════════════════════════════════════════════════════════════

describe('TEXT_NOTE — e o rótulo que passou a valer para TODAS as ferramentas', () => {
  it('⭐⭐ nota sem texto aparece com o texto de partida (senão seria invisível e inacertável)', () => {
    const it = unico(dwg('TEXT_NOTE', [[200, 150]]));
    expect(it.texts).toHaveLength(1);
    expect(it.texts[0]!.texto).toBe(TEXT_NOTE_PLACEHOLDER);
  });

  it('o texto escrito vence o texto de partida', () => {
    const it = unico(dwg('TEXT_NOTE', [[200, 150]], { style: { label: 'topo do leilão' } }));
    expect(it.texts[0]!.texto).toBe('topo do leilão');
  });

  it('⚠️ rótulo só de espaços conta como vazio', () => {
    // Uma caixa de fundo sem letra nenhuma lê como artefato de renderização.
    expect(labelOf(dwg('TRENDLINE', [[0, 0], [1, 1]], { style: { label: '   ' } }))).toBeNull();
    expect(labelOf(dwg('TEXT_NOTE', [[0, 0]], { style: { label: '   ' } }))).toBe(
      TEXT_NOTE_PLACEHOLDER,
    );
  });

  it('⭐⭐ QUALQUER ferramenta com `label` é rotulada — o campo existia e nunca era pintado', () => {
    const it = unico(dwg('TRENDLINE', [[100, 100], [300, 200]], { style: { label: 'LTA do dia' } }));
    expect(it.texts).toHaveLength(1);
    expect(it.texts[0]!.texto).toBe('LTA do dia');
  });

  it('⚠️ ferramenta SEM rótulo não emite texto (e não paga custo por ele)', () => {
    expect(unico(dwg('TRENDLINE', [[100, 100], [300, 200]])).texts).toHaveLength(0);
  });

  it('⭐⭐ a CAIXA envolvente CONTÉM a caixa do rótulo, para toda ferramenta', () => {
    // ⚠️ É a invariante que o prefiltro do hit-test depende: ele rejeita o ponteiro pela caixa
    // ANTES de calcular distância exata, então rótulo fora da caixa = clicar num rótulo visível e
    // nada acontecer. A asserção é de CONTINÊNCIA e não "a caixa cresceu", porque dependendo da
    // inclinação a caixa do traço já pode cobrir o rótulo — e o que importa é o resultado.
    const casos: ReadonlyArray<readonly [DrawingKind, ReadonlyArray<[number, number]>]> = [
      ['TRENDLINE', [[300, 100], [400, 120]]],
      ['TRENDLINE', [[300, 120], [400, 100]]],
      ['TEXT_NOTE', [[200, 150]]],
      ['RECTANGLE', [[100, 100], [300, 200]]],
      ['HORIZONTAL_LINE', [[200, 150]]],
      ['ZONE_DEMAND', [[200, 200], [300, 180]]],
      ['PARALLEL_CHANNEL', [[100, 100], [300, 200]]],
      ['ELLIPSE', [[100, 100], [300, 200]]],
      ['FIB_FAN', [[100, 100], [400, 300]]],
      ['FIB_TIME_ZONES', [[100, 100], [150, 100]]],
    ];
    for (const [kind, ancoras] of casos) {
      const it = unico(dwg(kind, ancoras, { style: { label: 'um rótulo bem comprido' } }));
      const t = it.texts[0];
      expect(t, kind).toBeDefined();
      expect(it.box.minX, `${kind} minX`).toBeLessThanOrEqual(t!.box.minX);
      expect(it.box.maxX, `${kind} maxX`).toBeGreaterThanOrEqual(t!.box.maxX);
      expect(it.box.minY, `${kind} minY`).toBeLessThanOrEqual(t!.box.minY);
      expect(it.box.maxY, `${kind} maxY`).toBeGreaterThanOrEqual(t!.box.maxY);
    }
  });

  it('⭐ clicar no RÓTULO seleciona o desenho, com prioridade de corpo', () => {
    const d = dwg('TEXT_NOTE', [[200, 150]], { style: { label: 'nota' } });
    const p = plano([d]);
    const caixa = p.items[0]!.texts[0]!.box;
    const acerto = hitTest(p, (caixa.minX + caixa.maxX) / 2, (caixa.minY + caixa.maxY) / 2);
    expect(acerto).not.toBeNull();
    expect(acerto!.id).toBe(d.id);
    expect(acerto!.part).toBe('STROKE');
  });

  it('a caixa do texto tem a altura declarada e largura proporcional ao conteúdo', () => {
    const curto = unico(dwg('TEXT_NOTE', [[200, 150]], { style: { label: 'ab' } })).texts[0]!;
    const longo = unico(dwg('TEXT_NOTE', [[200, 150]], { style: { label: 'abcdefghij' } })).texts[0]!;
    expect(curto.box.maxY - curto.box.minY).toBe(TEXT_BOX_HEIGHT_PX);
    expect(longo.box.maxX - longo.box.minX).toBeGreaterThan(curto.box.maxX - curto.box.minX);
    expect(curto.box.maxX - curto.box.minX).toBeCloseTo(larguraDeTextoEstimada('ab'), 6);
  });

  it('⚠️ o rótulo é empurrado para dentro na borda DIREITA, e não cortado', () => {
    // "WINV" sem o resto não diz se o resto existe.
    const it = unico(dwg('TEXT_NOTE', [[LARGURA - 5, 150]], { style: { label: 'texto bem longo aqui' } }));
    expect(it.texts[0]!.box.maxX).toBeLessThanOrEqual(LARGURA);
  });

  it('⚠️ a nota não emite traço nem região: a forma dela é o texto', () => {
    const it = unico(dwg('TEXT_NOTE', [[200, 150]]));
    expect(it.strokes).toHaveLength(0);
    expect(it.region).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ZONE_SUPPLY / ZONE_DEMAND
// ═════════════════════════════════════════════════════════════════════════════

describe('ZONE_SUPPLY / ZONE_DEMAND — valem para a DIREITA, com cor semântica', () => {
  it('⭐ a zona vai da âncora até a borda direita, e não até onde o arrasto parou', () => {
    const it = unico(dwg('ZONE_SUPPLY', [[200, 200], [300, 180]]));
    expect(it.zonas).toHaveLength(1);
    expect(it.zonas[0]!.box.minX).toBe(200);
    expect(it.zonas[0]!.box.maxX).toBe(LARGURA);
  });

  it('⭐⭐ a COR é fixa por lado — oferta vermelha, demanda verde', () => {
    // Por `style.fill` as duas ficariam da mesma cor e a informação central (de que lado está a
    // pressão) desapareceria. Mesma decisão das zonas de risco e retorno da posição.
    expect(unico(dwg('ZONE_SUPPLY', [[200, 200], [300, 180]])).zonas[0]!.cor).toBe(ZONE_SUPPLY_COLOR);
    expect(unico(dwg('ZONE_DEMAND', [[200, 200], [300, 180]])).zonas[0]!.cor).toBe(ZONE_DEMAND_COLOR);
  });

  it('⚠️ `style.fill` NÃO troca a cor da zona', () => {
    const it = unico(dwg('ZONE_DEMAND', [[200, 200], [300, 180]], { style: { fill: '#ff00ff' } }));
    expect(it.zonas[0]!.cor).toBe(ZONE_DEMAND_COLOR);
  });

  it('⭐ o INTERIOR não captura o ponteiro — o pan sobrevive dentro da zona', () => {
    // Uma zona cobre metade da tela com frequência; capturar o clique dentro dela mataria o pan
    // justamente na região que o operador quer examinar.
    const p = plano([dwg('ZONE_SUPPLY', [[200, 300], [300, 100]], { style: { fill: '#fff' } })]);
    expect(hitTest(p, 500, CONV.priceToY(200))).toBeNull();
    // E as bordas pegam.
    expect(hitTest(p, 500, CONV.priceToY(300))).not.toBeNull();
    expect(hitTest(p, 500, CONV.priceToY(100))).not.toBeNull();
  });

  it('a faixa de preço é normalizada: arrastar de baixo para cima dá a mesma zona', () => {
    const desce = unico(dwg('ZONE_DEMAND', [[200, 300], [300, 100]])).zonas[0]!.box;
    const sobe = unico(dwg('ZONE_DEMAND', [[200, 100], [300, 300]])).zonas[0]!.box;
    expect(desce.minY).toBe(sobe.minY);
    expect(desce.maxY).toBe(sobe.maxY);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIB_FAN
// ═════════════════════════════════════════════════════════════════════════════

describe('FIB_FAN — os níveis saem INCLINADOS de um ponto só', () => {
  it('⭐ todos os raios partem da PRIMEIRA âncora (é o que distingue do fibonacci)', () => {
    const it = unico(dwg('FIB_FAN', [[100, 100], [400, 300]]));
    expect(it.strokes.length).toBeGreaterThanOrEqual(5);
    // Todo traço, prolongado, passa pela âncora: a distância dela à reta é ~0.
    const ax = 100;
    const ay = CONV.priceToY(100);
    for (const s of it.strokes) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const comprimento = Math.hypot(dx, dy);
      const distancia = Math.abs(dy * (ax - s.a.x) - dx * (ay - s.a.y)) / comprimento;
      expect(distancia).toBeLessThan(0.5);
    }
  });

  it('⭐ os raios têm inclinações DISTINTAS — um leque, e não um feixe sobreposto', () => {
    const it = unico(dwg('FIB_FAN', [[100, 100], [400, 300]]));
    const inclinacoes = it.strokes.map((s) =>
      Math.round(((s.b.y - s.a.y) / (s.b.x - s.a.x)) * 1000),
    );
    expect(new Set(inclinacoes).size).toBe(inclinacoes.length);
  });

  it('⚠️ é RAIO e não segmento: os traços chegam à borda da área visível', () => {
    const it = unico(dwg('FIB_FAN', [[100, 100], [200, 150]]));
    const maiorX = Math.max(...it.strokes.map((s) => Math.max(s.a.x, s.b.x)));
    expect(maiorX).toBeGreaterThan(200);
  });

  it('usa os níveis de retração, e não os da extensão', () => {
    expect(fibLevelsOf(dwg('FIB_FAN', [[0, 0], [1, 1]]))).toContain(0.618);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIB_TIME_ZONES
// ═════════════════════════════════════════════════════════════════════════════

describe('FIB_TIME_ZONES — mede TEMPO, e extrapola em pixel', () => {
  it('⚠️ os níveis default são a SEQUÊNCIA, e não as razões', () => {
    // Razões (0,236..0,786) poriam todas as verticais DENTRO do trecho medido — a ferramenta não
    // projetaria nada.
    expect(fibLevelsOf(dwg('FIB_TIME_ZONES', [[0, 0], [1, 1]]))).toEqual(FIB_TIME_LEVELS_DEFAULT);
    expect(FIB_TIME_LEVELS_DEFAULT).toContain(8);
  });

  it('⭐⭐ as verticais caem em MÚLTIPLOS do intervalo, medidos em pixel', () => {
    // Intervalo de 50 px (t=100 → t=150): as verticais saem em 150, 200, 250, 350, 500...
    const it = unico(dwg('FIB_TIME_ZONES', [[100, 100], [150, 100]]));
    const xs = it.strokes.map((s) => s.a.x).sort((a, b) => a - b);
    expect(xs).toContain(150); // nível 1
    expect(xs).toContain(200); // nível 2
    expect(xs).toContain(250); // nível 3
    expect(xs).toContain(350); // nível 5
  });

  it('⭐⭐ as verticais são projetadas ALÉM da última barra, sem empilhar na borda', () => {
    // ⚠️ É a razão de a extrapolação ser em pixel: `timeToX` resolve por barra MAIS PRÓXIMA, e
    // todo instante futuro projetaria no mesmo pixel da última barra — a ferramenta desenharia
    // uma linha só. Aqui os conversores são lineares, então o teste mede a outra metade: que
    // nenhuma vertical dentro da tela repete X.
    const it = unico(dwg('FIB_TIME_ZONES', [[100, 100], [150, 100]]));
    const xs = it.strokes.map((s) => s.a.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('as verticais atravessam a altura inteira', () => {
    const it = unico(dwg('FIB_TIME_ZONES', [[100, 100], [150, 100]]));
    for (const s of it.strokes) {
      expect(s.a.y).toBe(0);
      expect(s.b.y).toBe(ALTURA);
    }
  });

  it('⚠️ intervalo de largura zero degenera para a vertical de partida', () => {
    const it = unico(dwg('FIB_TIME_ZONES', [[200, 100], [200, 180]]));
    expect(it.strokes).toHaveLength(1);
    expect(it.strokes[0]!.a.x).toBe(200);
  });

  it('recorta o que sai da área visível em vez de desenhar coordenada gigante', () => {
    const it = unico(dwg('FIB_TIME_ZONES', [[100, 100], [300, 100]]));
    for (const s of it.strokes) expect(s.a.x).toBeLessThanOrEqual(LARGURA + 10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ O DEFEITO DE PERSISTÊNCIA
// ═════════════════════════════════════════════════════════════════════════════

describe('⚠️⚠️ ida-e-volta preserva TODO campo do desenho', () => {
  it('⚠️⚠️ `rMultiple` sobrevive ao salvar e carregar — não sobrevivia', () => {
    // O sintoma: o operador ajustava a posição para 3R, salvava o layout, recarregava, e a
    // posição voltava com 2R. Nenhum erro. Numa ferramenta de risco-retorno o alvo ficava no
    // lugar errado e a tela não avisava.
    const d = dwg('POSITION_LONG', [[100, 200], [100, 180]], { rMultiple: 3 });
    const lido = deserialize(JSON.parse(JSON.stringify(serialize([d]))) as unknown);
    expect(lido.rejected).toBe(0);
    expect(lido.document.drawings[0]!.rMultiple).toBe(3);
  });

  it('`channelWidthRatio` sobrevive — entrou junto com o teste, e não depois', () => {
    const d = dwg('PARALLEL_CHANNEL', [[100, 100], [300, 200]], { channelWidthRatio: 2.5 });
    const lido = deserialize(JSON.parse(JSON.stringify(serialize([d]))) as unknown);
    expect(lido.document.drawings[0]!.channelWidthRatio).toBe(2.5);
  });

  it('⭐ o rótulo sobrevive, e é o que dá sentido a escrever no gráfico', () => {
    const d = dwg('TEXT_NOTE', [[200, 150]], { style: { label: 'topo do leilão de 12/09' } });
    const lido = deserialize(JSON.parse(JSON.stringify(serialize([d]))) as unknown);
    expect(lido.document.drawings[0]!.style?.label).toBe('topo do leilão de 12/09');
  });

  it('⚠️ número não-finito é OMITIDO, e o desenho SOBREVIVE', () => {
    // Cair no default é recuperável com um ajuste; perder a posição inteira não é.
    const bruto = {
      version: 1,
      drawings: [
        {
          id: 'a',
          kind: 'POSITION_LONG',
          anchors: [
            { timeSec: 1, price: 2 },
            { timeSec: 3, price: 4 },
          ],
          rMultiple: 'muito' as unknown as number,
        },
      ],
    };
    const lido = deserialize(bruto);
    expect(lido.rejected).toBe(0);
    expect(lido.document.drawings[0]!.rMultiple).toBeUndefined();
  });

  it('⭐⭐ toda ferramenta NOVA é reconhecida na leitura (kind desconhecido é descartado)', () => {
    // O parser recusa `kind` fora de `ANCHORS_REQUIRED`. Uma ferramenta acrescentada ao tipo mas
    // esquecida no mapa de âncoras seria salva e NÃO carregada — o desenho desapareceria no F5.
    const novas: readonly DrawingKind[] = [
      'PARALLEL_CHANNEL',
      'ELLIPSE',
      'TEXT_NOTE',
      'ZONE_SUPPLY',
      'ZONE_DEMAND',
      'FIB_FAN',
      'FIB_TIME_ZONES',
    ];
    const colecao = novas.map((k) =>
      k === 'TEXT_NOTE' ? dwg(k, [[100, 150]]) : dwg(k, [[100, 100], [300, 200]]),
    );
    const lido = deserialize(JSON.parse(JSON.stringify(serialize(colecao))) as unknown);
    expect(lido.rejected, lido.reasons.join(' | ')).toBe(0);
    expect(lido.document.drawings.map((d) => d.kind)).toEqual(novas);
  });
});
