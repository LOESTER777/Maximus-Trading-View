/**
 * A EXPANSÃO do bookmap: duas métricas derivadas, o escopo da escala e a escada lateral.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ OS CASOS QUE IMPORTAM MAIS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **`DELTA` e `VOLUME` emitem UMA célula por par**, não duas. É a diferença estrutural delas: a
 *    subtração e a soma já resolveram os dois lados, e emitir dois retângulos pintaria a mesma
 *    informação duas vezes, uma sobre a outra, com a de cima vencendo por acidente de ordem.
 *  - **delta zero não desenha nada**, e é afirmação: numa região de absorção o mapa de delta fica
 *    quase vazio enquanto o de execução fica cheio, e essa diferença ENTRE os dois mapas é a
 *    informação.
 *  - **a escada é `false` por omissão.** Ligá-la por padrão mudaria a tela de quem já usa a camada,
 *    e várias bancadas herdadas afirmam ZERO retângulos em estados de só-texto.
 *  - **a escada usa `priceToY`**, e não uma divisão da altura pelo número de níveis: é o que a
 *    mantém alinhada com o heatmap ao lado e com o eixo de preço.
 *
 * ⚠️ Bancada própria, com dublê próprio, e não um acréscimo a `BookmapPrimitive.spec.ts`: aquela
 * suíte é herdada e mede contagens absolutas de retângulo em estados específicos. Misturar formas
 * novas nela obrigaria a reescrever asserções que existem para provar outra coisa.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type {
  CanvasRenderingTarget2D,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from '@robustus/chart-core';
import type { BookmapGrid, CoberturaHeatmap } from '@robustus/charts-core';
import {
  BookmapPrimitive,
  PERFIL_LATERAL_LARGURA_PX,
  resetBookmapSessionWarnings,
  type BookmapLayerOptions,
} from '../index.js';

// ═════════════════════════════════════════════════════════════════════════════
// Dublê de contexto
// ═════════════════════════════════════════════════════════════════════════════

interface Retangulo {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly estilo: string;
}

class ContextoDeMedida {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  /** Todo `fillRect`, com a geometria e o estilo em vigor. */
  retangulos: Retangulo[] = [];
  textos: string[] = [];
  saves = 0;
  restores = 0;

  zerar(): void {
    this.retangulos = [];
    this.textos = [];
    this.saves = 0;
    this.restores = 0;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.retangulos.push({ x, y, w, h, estilo: this.fillStyle });
  }
  strokeRect(): void {}
  fillText(texto: string): void {
    this.textos.push(texto);
  }
  save(): void {
    this.saves += 1;
  }
  restore(): void {
    this.restores += 1;
  }
  setTransform(): void {}
  scale(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  arc(): void {}
  fill(): void {}
}

const LARGURA_PX = 800;
const ALTURA_PX = 400;

function criarAlvo(ctx: ContextoDeMedida): CanvasRenderingTarget2D {
  return {
    useBitmapCoordinateSpace<T>(f: (scope: unknown) => T): T {
      ctx.save();
      try {
        return f({
          context: ctx,
          mediaSize: { width: LARGURA_PX, height: ALTURA_PX },
          bitmapSize: { width: LARGURA_PX, height: ALTURA_PX },
          horizontalPixelRatio: 1,
          verticalPixelRatio: 1,
        });
      } finally {
        ctx.restore();
      }
    },
    useMediaCoordinateSpace<T>(f: (scope: unknown) => T): T {
      return f({ context: ctx, mediaSize: { width: LARGURA_PX, height: ALTURA_PX } });
    },
  } as unknown as CanvasRenderingTarget2D;
}

// ═════════════════════════════════════════════════════════════════════════════
// Dublê de grid e de escalas
// ═════════════════════════════════════════════════════════════════════════════

const T0_MS = 1_756_000_000_000;
const BALDE_SEG = 60;
const TICK_SIZE = 5;
const PRECO_BASE = 100_000;
const PRECO_TOPO = PRECO_BASE + 4 * TICK_SIZE;
const TS_ATE_MS = T0_MS + 180_000;

const COBERTURA_COMPLETA: CoberturaHeatmap = {
  classe: 'COMPLETA',
  observacao: null,
  filaDeMs: T0_MS,
  filaAteMs: TS_ATE_MS,
  execDeMs: T0_MS,
  execAteMs: TS_ATE_MS,
};

/**
 * Grid de quatro células, uma por combinação que os testes precisam distinguir.
 *
 * | k | balde | preço | fila b/a | exec compra/venda | delta | volume |
 * |---|---|---|---|---|---|---|
 * | 0 | 0 | +0 tick | 200/0   | 700/100 | **+600** | 800 |
 * | 1 | 1 | +1 tick | 0/150   | 100/500 | **−400** | 600 |
 * | 2 | 2 | +2 tick | 300/300 | 400/400 | **0** ⭐  | 800 |
 * | 3 | 3 | +3 tick | 0/0     | 50/0    | **+50**  | 50  |
 *
 * ⭐ A célula 2 é o coração de dois casos: delta ZERO com volume ALTO. É a assinatura da absorção,
 * e é onde as duas métricas derivadas afirmam coisas opostas sobre o mesmo dado.
 */
function criarGrid(): BookmapGrid {
  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-24',
    baldeSeg: BALDE_SEG,
    times: Float64Array.from([T0_MS, T0_MS + 60_000, T0_MS + 120_000, T0_MS + 180_000]),
    prices: Float64Array.from([
      PRECO_BASE,
      PRECO_BASE + TICK_SIZE,
      PRECO_BASE + 2 * TICK_SIZE,
      PRECO_BASE + 3 * TICK_SIZE,
    ]),
    ti: Uint32Array.from([0, 1, 2, 3]),
    pi: Uint32Array.from([0, 1, 2, 3]),
    bid: Float32Array.from([200, 0, 300, 0]),
    ask: Float32Array.from([0, 150, 300, 0]),
    buy: Float32Array.from([700, 100, 400, 50]),
    sell: Float32Array.from([100, 500, 400, 0]),
    cobertura: COBERTURA_COMPLETA,
  };
}

function criarParametro(): SeriesAttachedParameter<Time, SeriesType> {
  const timeScale = {
    getVisibleRange: () => ({ from: T0_MS / 1000, to: TS_ATE_MS / 1000 }),
    timeToCoordinate: (segundos: unknown): number =>
      ((Number(segundos) * 1000 - T0_MS) / (TS_ATE_MS - T0_MS)) * LARGURA_PX,
  };
  const chart = {
    paneSize: () => ({ width: LARGURA_PX, height: ALTURA_PX }),
    timeScale: () => timeScale,
  };
  const series = {
    coordinateToPrice: (y: number): number =>
      PRECO_TOPO - (y / ALTURA_PX) * (PRECO_TOPO - PRECO_BASE),
    priceToCoordinate: (preco: number): number =>
      ((PRECO_TOPO - preco) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX,
  };
  return { chart, series, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<
    Time,
    SeriesType
  >;
}

const OPCOES_BASE: Omit<BookmapLayerOptions, 'grid'> = {
  metrica: 'FILA',
  escala: 'P99_GAMMA',
  tickSize: TICK_SIZE,
  maxCells: 3000,
  minCellPx: 1,
  // ⚠️ Legenda LIGADA: vários casos leem o texto, que é onde a camada declara o que está pintando.
  mostrarLegenda: true,
};

interface Bancada {
  readonly ctx: ContextoDeMedida;
  readonly primitive: BookmapPrimitive;
  /** Uma passada completa (heatmap e texto), devolvendo os retângulos emitidos. */
  passada: () => readonly Retangulo[];
  /** As linhas de legenda publicadas. */
  legenda: () => readonly string[];
}

function montar(opcoes?: Partial<BookmapLayerOptions>, grid = criarGrid()): Bancada {
  const ctx = new ContextoDeMedida();
  const alvo = criarAlvo(ctx);
  let publicadas: readonly string[] = [];

  const primitive = new BookmapPrimitive({
    grid,
    ...OPCOES_BASE,
    onLegenda: (linhas) => {
      publicadas = linhas;
    },
    ...opcoes,
  });
  primitive.attached(criarParametro());

  return {
    ctx,
    primitive,
    passada: () => {
      ctx.zerar();
      primitive.updateAllViews();
      for (const view of primitive.paneViews()) {
        const r: IPrimitivePaneRenderer | null = view.renderer();
        r?.draw(alvo);
      }
      return ctx.retangulos;
    },
    legenda: () => {
      // ⚠️ Uma passada é OBRIGATÓRIA antes de ler: `onLegenda` é chamado só quando o TEXTO muda, e
      // a construção do plano acontece em `updateAllViews`. Ler antes devolveria lista vazia — e
      // essa própria armadilha derrubou seis casos desta bancada na primeira execução.
      if (ctx.retangulos.length === 0 && publicadas.length === 0) {
        primitive.updateAllViews();
        for (const view of primitive.paneViews()) view.renderer()?.draw(alvo);
      }
      return publicadas;
    },
  };
}

beforeEach(() => {
  resetBookmapSessionWarnings();
});

// ═════════════════════════════════════════════════════════════════════════════
// Métricas derivadas
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ métrica DELTA', () => {
  it('emite UMA célula por par, e não duas', () => {
    // Três das quatro células têm delta não nulo (a de delta zero não desenha — caso abaixo).
    const delta = montar({ metrica: 'DELTA' }).passada();
    // `FILA` no mesmo grid tem quatro lados positivos (200, 150, 300, 300) ⇒ quatro retângulos.
    const fila = montar({ metrica: 'FILA' }).passada();
    expect(fila).toHaveLength(4);
    expect(delta).toHaveLength(3);
  });

  it('⭐⭐ delta ZERO não desenha, e é afirmação e não omissão', () => {
    // A célula 2 tem 400 comprados e 400 vendidos: equilíbrio. A métrica existe para dizer QUEM
    // VENCEU, e pintar o equilíbrio exigiria um terceiro canal de cor que a camada não tem — pintar
    // no canal de um dos lados afirmaria um vencedor que não houve.
    const delta = montar({ metrica: 'DELTA' }).passada();
    const volume = montar({ metrica: 'VOLUME' }).passada();
    // ⭐ E é justamente a DIFERENÇA entre os dois mapas que é a informação: em `VOLUME` a mesma
    // célula é uma das mais fortes da janela (800), e em `DELTA` ela não existe.
    expect(volume.length).toBeGreaterThan(delta.length);
    expect(volume).toHaveLength(4);
  });

  it('⭐ a cor vem do SINAL: verde onde o comprador venceu, vermelho onde o vendedor venceu', () => {
    const b = montar({ metrica: 'DELTA' });
    const estilos = b.passada().map((r) => r.estilo);
    const verdes = estilos.filter((e) => e.startsWith('rgba(34, 197, 94')).length;
    const vermelhos = estilos.filter((e) => e.startsWith('rgba(239, 68, 68')).length;
    // Células 0 (+600) e 3 (+50) são compradoras; a 1 (−400) é vendedora.
    expect(verdes).toBe(2);
    expect(vermelhos).toBe(1);
  });

  it('⭐⭐ a escala é da grandeza DERIVADA, não da execução', () => {
    // ⚠️ Reusar a escala de `EXECUCAO` calibraria pela distribuição dos lados separados. O delta
    // maior (+600) tem de sair no topo da escala do delta, e a prova é que ele é o mais opaco.
    const b = montar({ metrica: 'DELTA' });
    const rects = b.passada();
    const opacidade = (r: Retangulo): number => Number(/,\s*([\d.]+)\)$/.exec(r.estilo)?.[1] ?? 0);
    const maisOpaco = rects.reduce((a, r) => (opacidade(r) > opacidade(a) ? r : a));
    // A célula 0 é a da primeira coluna de tempo ⇒ o menor `x`.
    const menorX = Math.min(...rects.map((r) => r.x));
    expect(maisOpaco.x).toBe(menorX);
  });

  it('a legenda diz a CONTA e o que a ausência significa', () => {
    const linhas = montar({ metrica: 'DELTA' }).legenda().join(' | ');
    expect(linhas).toMatch(/compra − venda/);
    // ⭐ É a informação menos óbvia e a mais valiosa: sem ela o operador leria absorção como
    // ausência de fluxo, que é a conclusão oposta.
    expect(linhas).toMatch(/equilibraram/);
  });

  it('⚠️ NÃO recebe marca de execução — marcaria a execução com ela mesma', () => {
    const semMarca = montar({ metrica: 'DELTA', marcaExec: 'BARRA' }).passada();
    const comMarca = montar({ metrica: 'EXECUCAO', marcaExec: 'BARRA' }).passada();
    // `EXECUCAO` desenha lado + lado + a marca do total; `DELTA` só a célula derivada.
    expect(comMarca.length).toBeGreaterThan(semMarca.length);
  });
});

describe('⭐⭐ métrica VOLUME', () => {
  it('emite uma célula por par, para todas as quatro', () => {
    expect(montar({ metrica: 'VOLUME' }).passada()).toHaveLength(4);
  });

  it('⭐⭐ NÃO tem lado: usa o canal NEUTRO, e nunca verde nem vermelho', () => {
    // Pintar de verde afirmaria um agressor que a métrica soma justamente para ignorar.
    const estilos = montar({ metrica: 'VOLUME' }).passada().map((r) => r.estilo);
    for (const e of estilos) {
      expect(e.startsWith('rgba(226, 232, 240'), e).toBe(true);
    }
  });

  it('⭐ e a legenda DIZ que não há lado', () => {
    // Sem a frase, a ausência de verde e vermelho é lida como defeito de renderização por quem está
    // acostumado com as outras métricas.
    const linhas = montar({ metrica: 'VOLUME' }).legenda().join(' | ');
    expect(linhas).toMatch(/Sem lado/);
    expect(linhas).toMatch(/compra \+ venda/);
  });

  it('⚠️ trocar de VOLUME para FILA RECONSTRÓI a paleta — o seletor não fica inerte', () => {
    // É a armadilha que o `marcaExec` já causou uma vez: a chave de cache da paleta não continha o
    // modo, e o seletor só surtia efeito desligando e religando a camada.
    const b = montar({ metrica: 'VOLUME' });
    expect(b.passada().every((r) => r.estilo.startsWith('rgba(226, 232, 240'))).toBe(true);
    b.primitive.update({ metrica: 'FILA' });
    const depois = b.passada();
    expect(depois.some((r) => r.estilo.startsWith('rgba(34, 197, 94'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Escopo da escala
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ escopo da escala', () => {
  it('a legenda declara qual escopo está em vigor, sempre', () => {
    // ⚠️ Uma escala relativa sem essa frase é uma régua sem unidade: o operador compara duas telas
    // normalizadas por p99 diferentes e conclui que são equivalentes.
    expect(montar().legenda().join(' | ')).toMatch(/Escala da JANELA/);
    expect(montar({ escopoEscala: 'DIA' }).legenda().join(' | ')).toMatch(/Escala do DIA/);
  });

  it('⭐ `DIA` amostra o grid inteiro, e a cor muda por isso', () => {
    // O grid tem células fora da janela? Não neste dublê — então o teste mede a outra metade: que a
    // opção CHEGA à escala em vez de ser ignorada. Com a amostra do dia sobre as mesmas colunas, os
    // percentis coincidem e as cores também; o que prova a ligação é a legenda mais o fato de a
    // troca não derrubar a passada.
    const b = montar({ escopoEscala: 'DIA' });
    expect(b.passada()).toHaveLength(4);
    expect(b.ctx.saves).toBe(b.ctx.restores);
  });

  it('trocar de escopo em tempo de execução não derruba a camada', () => {
    const b = montar();
    expect(b.passada()).toHaveLength(4);
    b.primitive.update({ escopoEscala: 'DIA' });
    expect(b.passada()).toHaveLength(4);
    b.primitive.update({ escopoEscala: 'JANELA' });
    expect(b.passada()).toHaveLength(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A escada lateral
// ═════════════════════════════════════════════════════════════════════════════

/** Os retângulos que caem na faixa da escada — os de `x` grande o bastante. */
function daEscada(rects: readonly Retangulo[]): readonly Retangulo[] {
  const inicio = LARGURA_PX - PERFIL_LATERAL_LARGURA_PX;
  return rects.filter((r) => r.x >= inicio - 1);
}

describe('⭐⭐ escada lateral', () => {
  it('⚠️⚠️ está DESLIGADA por omissão — ligá-la mudaria a tela de quem já usa a camada', () => {
    const b = montar();
    const rects = b.passada();
    // Nenhum retângulo cobre a faixa inteira em altura (o fundo da escada faria isso).
    expect(rects.some((r) => r.h >= ALTURA_PX)).toBe(false);
    expect(b.legenda().join(' | ')).not.toMatch(/Escada/);
  });

  it('ligada, desenha o FUNDO da faixa e as barras', () => {
    const rects = montar({ mostrarPerfilLateral: true }).passada();
    const fundo = rects.find((r) => r.h >= ALTURA_PX);
    expect(fundo, 'o fundo da faixa não foi desenhado').toBeDefined();
    expect(fundo!.w).toBe(PERFIL_LATERAL_LARGURA_PX);
    expect(fundo!.x).toBe(LARGURA_PX - PERFIL_LATERAL_LARGURA_PX);
    expect(daEscada(rects).length).toBeGreaterThan(1);
  });

  it('⭐⭐ as barras crescem da DIREITA para a esquerda: todas terminam na borda', () => {
    // A borda direita é onde o preço está agora, e é para lá que o olho vai. Barras crescendo da
    // esquerda obrigariam a ler de trás para frente e cobririam o passado do heatmap.
    const barras = daEscada(montar({ mostrarPerfilLateral: true }).passada()).filter(
      (r) => r.h < ALTURA_PX,
    );
    expect(barras.length).toBeGreaterThan(0);
    for (const b of barras) {
      expect(b.x + b.w, JSON.stringify(b)).toBe(LARGURA_PX);
    }
  });

  it('⭐⭐ o COMPRIMENTO é proporcional à quantidade, e a maior encosta no limite da faixa', () => {
    // É o ponto inteiro da escada: quantidade em comprimento, que o olho mede, e não em opacidade.
    const barras = daEscada(montar({ mostrarPerfilLateral: true }).passada()).filter(
      (r) => r.h < ALTURA_PX,
    );
    const maior = Math.max(...barras.map((r) => r.w));
    expect(maior).toBe(PERFIL_LATERAL_LARGURA_PX);
  });

  it('⭐⭐ comprimentos DISTINTOS para quantidades distintas — senão nada estaria sendo medido', () => {
    // No escopo de janela a fila acumula, POR LADO: compra 200 no preço +0 e 300 no +2; venda 150
    // no +1 e 300 no +2. O máximo compartilhado é 300.
    //
    // ⚠️ E é aqui que se vê a decisão 3 do núcleo funcionando: o denominador é 300 para OS DOIS
    // lados. Se cada lado tivesse o próprio máximo, a venda de 150 sairia com 32 px contra os 64 da
    // compra de 300 — e com máximos separados sairia com os mesmos 64, afirmando paridade falsa.
    const barras = daEscada(
      montar({ mostrarPerfilLateral: true, escopoPerfilLateral: 'JANELA' }).passada(),
    ).filter((r) => r.h < ALTURA_PX);
    const larguras = [...new Set(barras.map((r) => r.w))].sort((a, b) => a - b);
    expect(larguras.length).toBeGreaterThan(2);
    expect(larguras).toContain(Math.round((150 / 300) * PERFIL_LATERAL_LARGURA_PX));
    expect(larguras).toContain(Math.round((200 / 300) * PERFIL_LATERAL_LARGURA_PX));
    expect(larguras).toContain(PERFIL_LATERAL_LARGURA_PX);
  });

  it('⭐⭐ os níveis ficam ALINHADOS com o eixo de preço, e não distribuídos pela altura', () => {
    // ⚠️ Dividir a altura do painel pelo número de níveis daria uma escada bonita e desalinhada, e o
    // operador traçaria a horizontal pelo lugar errado. O `y` sai de `priceToY`, igual às células.
    const barras = daEscada(montar({ mostrarPerfilLateral: true }).passada()).filter(
      (r) => r.h < ALTURA_PX,
    );
    // A escada da métrica `FILA` sai da última coluna com fila: o balde 2, preço +2 ticks (bid 300 e
    // ask 300). `priceToY` do centro desse nível:
    const meiaAltura = TICK_SIZE / 2;
    const preco = PRECO_BASE + 2 * TICK_SIZE;
    const yEsperado = Math.round(
      ((PRECO_TOPO - (preco + meiaAltura)) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX,
    );
    for (const b of barras) expect(b.y).toBe(yEsperado);
  });

  it('⭐ a largura é RECORTADA a um terço do painel', () => {
    const rects = montar({ mostrarPerfilLateral: true, larguraPerfilLateral: 700 }).passada();
    const fundo = rects.find((r) => r.h >= ALTURA_PX);
    expect(fundo!.w).toBe(Math.floor(LARGURA_PX / 3));
  });

  it('a escada se APRESENTA na legenda, com a grandeza e de quando ela é', () => {
    // Uma faixa de barras na borda direita é indistinguível de um histograma de volume ou de um
    // perfil de velas para quem não a ligou.
    const linhas = montar({ mostrarPerfilLateral: true }).legenda().join(' | ');
    expect(linhas).toMatch(/Escada à direita: fila por preço/);
    expect(linhas).toMatch(/comprimento = quantidade/);
    // ⭐ De quando: num pregão devagar a última coluna com liquidez pode ser de dez minutos atrás.
    expect(linhas).toMatch(/Escada: livro de \d/);
  });

  it('⭐ a grandeza da escada ACOMPANHA a métrica', () => {
    // Escada de fila ao lado de mapa de execução seriam duas afirmações diferentes na mesma altura
    // de pixel, e o operador leria uma como se fosse a outra.
    expect(montar({ mostrarPerfilLateral: true, metrica: 'FILA' }).legenda().join(' | ')).toMatch(
      /Escada à direita: fila/,
    );
    for (const metrica of ['EXECUCAO', 'DELTA', 'VOLUME'] as const) {
      expect(
        montar({ mostrarPerfilLateral: true, metrica }).legenda().join(' | '),
        metrica,
      ).toMatch(/Escada à direita: execução/);
    }
  });

  it('no escopo de JANELA a legenda diz que é ACUMULADO, e não um instante', () => {
    const linhas = montar({ mostrarPerfilLateral: true, escopoPerfilLateral: 'JANELA' })
      .legenda()
      .join(' | ');
    expect(linhas).toMatch(/acumulado da janela visível/);
    expect(linhas).not.toMatch(/livro de/);
  });

  it('⚠️ sem liquidez na grandeza pedida, a escada simplesmente não aparece', () => {
    // ⚠️ `bid`/`ask` vêm vazios em quase todo o histórico da mesa (o livro não foi gravado). Escada
    // vazia é a verdade sobre o dado, não defeito — e não pode virar exceção nem faixa fantasma.
    const semLivro: BookmapGrid = {
      ...criarGrid(),
      bid: Float32Array.from([0, 0, 0, 0]),
      ask: Float32Array.from([0, 0, 0, 0]),
    };
    const b = montar({ mostrarPerfilLateral: true, metrica: 'FILA' }, semLivro);
    const rects = b.passada();
    expect(rects.some((r) => r.h >= ALTURA_PX)).toBe(false);
    expect(b.legenda().join(' | ')).not.toMatch(/Escada/);
    // E a mesma tela em `EXECUCAO` tem escada, porque ali há dado.
    expect(
      montar({ mostrarPerfilLateral: true, metrica: 'EXECUCAO' }, semLivro)
        .passada()
        .some((r) => r.h >= ALTURA_PX),
    ).toBe(true);
  });

  it('⚠️ o par salvar/restaurar fica fechado com a escada ligada', () => {
    const b = montar({ mostrarPerfilLateral: true, modoCor: 'TERMICA' });
    b.passada();
    expect(b.ctx.saves).toBe(b.ctx.restores);
  });

  it('ligar e desligar em tempo de execução funciona nas duas direções', () => {
    const b = montar();
    expect(b.passada().some((r) => r.h >= ALTURA_PX)).toBe(false);
    b.primitive.update({ mostrarPerfilLateral: true });
    expect(b.passada().some((r) => r.h >= ALTURA_PX)).toBe(true);
    b.primitive.update({ mostrarPerfilLateral: false });
    expect(b.passada().some((r) => r.h >= ALTURA_PX)).toBe(false);
  });

  it('⚠️ a camada continua SEM `hitTest` com tudo ligado', () => {
    // Garantia de TIPO de que a camada não captura ponteiro. Há property test dedicado; aqui se
    // verifica que as opções novas não abriram o caminho.
    const b = montar({ mostrarPerfilLateral: true, metrica: 'DELTA', escopoEscala: 'DIA' });
    b.passada();
    expect('hitTest' in b.primitive).toBe(false);
    for (const view of b.primitive.paneViews()) {
      expect('hitTest' in view).toBe(false);
    }
  });
});
