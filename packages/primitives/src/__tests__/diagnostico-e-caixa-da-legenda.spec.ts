/**
 * Texto do bookmap: canal de DIAGNÓSTICO desligado por omissão, e caixa de
 * contraste atrás da legenda.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No playground (04/09/2026) a camada escrevia sobre as velas, sempre e sem
 * fundo próprio:
 *
 * - `Livro · fila em repouso · p50 0 ct · p99 0 ct · escala da janela visível`
 * - `A janela visível não apresenta variação de magnitude.`
 * - `Cobertura não verificada · fila não informado · execução não informado`
 *
 * Três linhas de instrumentação, quase todas dizendo "não informado", em cinza
 * claro sobre fundo variável. O usuário fotografou a tela: ilegível e poluída.
 *
 * A correção tem duas metades, e as duas são medidas aqui:
 * 1. o texto foi repartido em **legenda** (o que a tela significa) e
 *    **diagnóstico** (instrumentação), e o diagnóstico saiu do ar por omissão;
 * 2. o que sobra é desenhado dentro de uma **caixa opaca**.
 *
 * ⚠️ As asserções são sobre o texto REALMENTE emitido no canvas, não sobre o
 * plano interno. É a lição registrada na suíte herdada: a primeira versão do
 * teste de supressão de legenda passava por vacuidade, comparando duas telas
 * vazias.
 *
 * ⚠️ E há uma guarda de vacuidade explícita: se a passada parar de emitir
 * célula, o primeiro caso falha antes de os demais mentirem verde.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type { SeriesAttachedParameter, SeriesType, Time } from '@robustus/chart-core';
import { BookmapPrimitive } from '@robustus/charts-primitives';
import type { BookmapLayerOptions } from '@robustus/charts-primitives';
import type { BookmapGrid, CoberturaHeatmap } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Contexto falso — texto e CAIXA rastreados
// ═════════════════════════════════════════════════════════════════════════════

interface Caixa {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly estilo: string;
}

/**
 * ⚠️ `measureText` é OPCIONAL neste dublê, de propósito.
 *
 * Os contextos falsos herdados não têm o método — foi por isso que a medida do
 * texto no código de produção ficou guarda-costas de si mesma (`larguraDoTexto`
 * cai numa estimativa). Aqui os dois caminhos são exercitados: sem o método, para
 * reproduzir a bancada herdada; com ele, para o caminho real do navegador.
 */
class ContextoFalso {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  /** Retângulos preenchidos por `fillRect` — células e marcas de execução. */
  retangulos = 0;

  /** Retângulos contornados por `strokeRect` — estouro de escala. */
  contornos = 0;

  /** Textos emitidos, com o estilo em vigor. */
  textos: Array<{ texto: string; estilo: string }> = [];

  /**
   * Caixas preenchidas por CAMINHO (`beginPath`/`rect`/`fill`).
   *
   * A única coisa que esta camada preenche por caminho é a caixa de texto; as
   * bolhas de execução usam `arc`, que este dublê não registra como caixa.
   */
  caixas: Caixa[] = [];

  saves = 0;
  restores = 0;

  constructor(private readonly comMedida: boolean) {
    if (comMedida) {
      // 6 px por caractere: valor arbitrário e estável, só para a largura da
      // caixa não depender de rasterização.
      (this as unknown as { measureText: (t: string) => { width: number } }).measureText = (
        t: string,
      ) => ({ width: t.length * 6 });
    }
  }

  temMedida(): boolean {
    return this.comMedida;
  }

  zerar(): void {
    this.retangulos = 0;
    this.contornos = 0;
    this.textos = [];
    this.caixas = [];
    this.saves = 0;
    this.restores = 0;
    this.ultimoRect = null;
  }

  fillRect(): void {
    this.retangulos += 1;
  }
  strokeRect(): void {
    this.contornos += 1;
  }
  fillText(texto: string): void {
    this.textos.push({ texto, estilo: this.fillStyle });
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
  ultimoRect: { x: number; y: number; w: number; h: number } | null = null;
  rect(x?: number, y?: number, w?: number, h?: number): void {
    this.ultimoRect = { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 };
  }
  clip(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  arc(): void {}
  fill(): void {
    if (this.ultimoRect === null) return;
    this.caixas.push({ ...this.ultimoRect, estilo: this.fillStyle });
  }
}

const LARGURA_PX = 800;
const ALTURA_PX = 400;

/** Alvo fiel ao contrato: par salvar/restaurar em bloco de encerramento. */
function criarAlvo(ctx: ContextoFalso): CanvasRenderingTarget2D {
  const alvo = {
    useBitmapCoordinateSpace<T>(f: (scope: unknown) => T): T {
      try {
        ctx.save();
        ctx.setTransform();
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
  };
  return alvo as unknown as CanvasRenderingTarget2D;
}

// ═════════════════════════════════════════════════════════════════════════════
// Grid e escalas — os mesmos valores das bancadas irmãs, para não divergir
// ═════════════════════════════════════════════════════════════════════════════

const T0_MS = 1_756_000_000_000;
const BALDE_SEG = 60;
const TICK_SIZE = 5;
const PRECO_BASE = 100_000;
const PRECO_TOPO = PRECO_BASE + 2 * TICK_SIZE;
const TS_ATE_MS = T0_MS + 120_000;

const COBERTURA_COMPLETA: CoberturaHeatmap = {
  classe: 'COMPLETA',
  observacao: null,
  filaDeMs: T0_MS,
  filaAteMs: TS_ATE_MS,
  execDeMs: T0_MS,
  execAteMs: TS_ATE_MS,
};

function criarGrid(): BookmapGrid {
  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-24',
    baldeSeg: BALDE_SEG,
    times: Float64Array.from([T0_MS, T0_MS + 60_000, TS_ATE_MS]),
    prices: Float64Array.from([PRECO_BASE, PRECO_BASE + TICK_SIZE, PRECO_TOPO]),
    ti: Uint32Array.from([0, 1, 2]),
    pi: Uint32Array.from([0, 1, 2]),
    bid: Float32Array.from([120, 240, 360]),
    ask: Float32Array.from([90, 180, 270]),
    buy: Float32Array.from([0, 0, 0]),
    sell: Float32Array.from([0, 0, 0]),
    cobertura: COBERTURA_COMPLETA,
  };
}

function criarParametroDeAnexacao(): SeriesAttachedParameter<Time, SeriesType> {
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
  return { chart, series, requestUpdate: () => {} } as unknown as SeriesAttachedParameter<
    Time,
    SeriesType
  >;
}

const OPCOES_BASE: Omit<BookmapLayerOptions, 'grid'> = {
  metrica: 'FILA',
  escala: 'P99_GAMMA',
  tickSize: TICK_SIZE,
  maxCells: 3000,
  minCellPx: 3,
};

interface Bancada {
  readonly primitive: BookmapPrimitive;
  readonly ctx: ContextoFalso;
  desenharUmaPassada: () => boolean;
}

function montarBancada(
  extra: Partial<BookmapLayerOptions> = {},
  comMedida = false,
): Bancada {
  const ctx = new ContextoFalso(comMedida);
  const alvo = criarAlvo(ctx);
  const opcoes: BookmapLayerOptions = { grid: criarGrid(), ...OPCOES_BASE, ...extra };
  // Relógio parado: a degradação adaptativa do orçamento não pode entrar na
  // conversa, senão a suíte passa a depender da velocidade da máquina.
  const primitive = new BookmapPrimitive(opcoes, () => 0);
  primitive.attached(criarParametroDeAnexacao());

  return {
    primitive,
    ctx,
    // ⚠️ Desenha TODAS as views, e não `paneViews()[0]`, porque a camada passou a ter
    // DUAS: o heatmap em `zOrder: 'bottom'` (antes das velas) e a legenda em `'top'`
    // (para não ficar atrás do histograma de volume). Inspecionar só a primeira mediria
    // um quadro que o motor nunca produz — e é justamente o TEXTO que estas bancadas
    // afirmam. O motor faz o mesmo laço, agrupando por camada.
    desenharUmaPassada: (): boolean => {
      primitive.updateAllViews();
      let desenhou = false;
      for (const view of primitive.paneViews()) {
        const r = view.renderer();
        if (r === null) continue;
        (r as { draw: (a: CanvasRenderingTarget2D) => void }).draw(alvo);
        desenhou = true;
      }
      return desenhou;
    },
  };
}

/** Sombra do texto: cópia deslocada, com estilo próprio. Não é conteúdo novo. */
const SOMBRA = 'rgba(0, 0, 0, 0.65)';

function textoJunto(ctx: ContextoFalso): string {
  return ctx.textos
    .filter((t) => t.estilo !== SOMBRA)
    .map((t) => t.texto)
    .join(' \n ');
}

// ═════════════════════════════════════════════════════════════════════════════

describe('BookmapPrimitive — diagnóstico desligado por omissão', () => {
  it('guarda de vacuidade: a passada emite célula E texto', () => {
    // Sem esta guarda, "não escreveu p50" passaria com a camada desenhando nada.
    const b = montarBancada();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.retangulos).toBeGreaterThan(0);
    expect(b.ctx.textos.length).toBeGreaterThan(0);
  });

  it('⭐ por omissão NÃO escreve percentil, escala colapsada nem rodapé de cobertura', () => {
    const b = montarBancada();
    b.desenharUmaPassada();
    const tudo = textoJunto(b.ctx);

    // As três linhas fotografadas pelo usuário.
    expect(tudo).not.toContain('p50');
    expect(tudo).not.toContain('p99');
    expect(tudo).not.toContain('escala da janela visível');
    expect(tudo).not.toContain('variação de magnitude');
    expect(tudo).not.toMatch(/BRT|Cobertura/i);
  });

  it('⭐ mas a LEGENDA continua: a camada diz quem é e o que a cor significa', () => {
    // O oposto do defeito também é defeito: uma mancha de calor anônima obriga o
    // operador a adivinhar se é fila ou execução, e qual lado é qual.
    const b = montarBancada();
    b.desenharUmaPassada();
    const tudo = textoJunto(b.ctx);

    expect(tudo).toContain('Livro · fila em repouso');
    expect(tudo).toContain('Verde: fila de compra · Vermelho: fila de venda');
  });

  it('`mostrarDiagnostico: true` devolve percentil, rodapé e a ressalva de escala', () => {
    const b = montarBancada({ mostrarDiagnostico: true });
    b.desenharUmaPassada();
    const tudo = textoJunto(b.ctx);

    expect(tudo).toContain('p50');
    expect(tudo).toContain('p99');
    expect(tudo).toContain('escala da janela visível');
    // O rodapé de cobertura volta a sair, com o horário no fuso do núcleo.
    expect(tudo).toMatch(/BRT|Cobertura/i);
    // E a identidade da camada não é perdida no caminho.
    expect(tudo).toContain('Livro · fila em repouso');
  });

  it('a troca chega pelo `update`, na camada já anexada', () => {
    // ⚠️ A armadilha que já mordeu `marcaExec`, `mostrarLegenda` e `modoCor`:
    // trocar a opção não altera a presença da camada, então o efeito de anexação
    // não roda de novo e só o patch de `update` pode aplicar a mudança.
    const b = montarBancada();
    b.desenharUmaPassada();
    expect(textoJunto(b.ctx)).not.toContain('p99');

    b.primitive.update({ mostrarDiagnostico: true });
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(textoJunto(b.ctx)).toContain('p99');

    b.primitive.update({ mostrarDiagnostico: false });
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(textoJunto(b.ctx)).not.toContain('p99');
  });

  it('⚠️ `mostrarLegenda: false` cala a camada mesmo com o diagnóstico ligado', () => {
    // Uma porta só: quem pede silêncio não quer texto nenhum sobre o gráfico. E as
    // células seguem desenhando — o que some é o TEXTO.
    const b = montarBancada({ mostrarLegenda: false, mostrarDiagnostico: true });
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.retangulos).toBeGreaterThan(0);
    expect(b.ctx.textos).toHaveLength(0);
  });
});

describe('BookmapPrimitive — caixa de contraste da legenda', () => {
  it('⭐ a legenda ganha caixa opaca, dentro do painel', () => {
    const b = montarBancada({}, true);
    b.desenharUmaPassada();

    const caixas = b.ctx.caixas.filter((c) => c.estilo === 'rgba(15, 23, 42, 0.82)');
    expect(caixas.length).toBeGreaterThan(0);
    for (const c of caixas) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      // Não invade a escala de preço nem o eixo de tempo: o recorte aritmético da
      // caixa é o que garante isso, e é o que este caso mede.
      expect(c.x + c.w).toBeLessThanOrEqual(LARGURA_PX);
      expect(c.y + c.h).toBeLessThanOrEqual(ALTURA_PX);
    }
  });

  it('⭐ a caixa NÃO passa por `fillRect` nem `strokeRect`', () => {
    // ⚠️ É contrato com a suíte herdada, não estilo: lá `fillRect` é contado como
    // "célula desenhada" e `strokeRect` como "contorno de estouro de escala", e há
    // casos que afirmam ZERO dos dois num estado que ainda desenha texto. Se a
    // caixa passasse por `fillRect`, ela seria contada como célula.
    const comTexto = montarBancada({}, true);
    comTexto.desenharUmaPassada();

    const semTexto = montarBancada({ mostrarLegenda: false }, true);
    semTexto.desenharUmaPassada();

    expect(comTexto.ctx.retangulos).toBe(semTexto.ctx.retangulos);
    expect(comTexto.ctx.contornos).toBe(semTexto.ctx.contornos);
    expect(comTexto.ctx.caixas.length).toBeGreaterThan(semTexto.ctx.caixas.length);
  });

  it('sem `measureText` no contexto, a caixa ainda sai com largura útil', () => {
    // ⚠️ O caminho de emergência de `larguraDoTexto`. Os dublês herdados não têm
    // o método, e exigi-lo lançaria dentro do desenho — a camada se
    // autodesativaria e a suíte inteira passaria a medir o dublê.
    const b = montarBancada({}, false);
    expect(b.desenharUmaPassada()).toBe(true);

    const caixas = b.ctx.caixas.filter((c) => c.estilo === 'rgba(15, 23, 42, 0.82)');
    expect(caixas.length).toBeGreaterThan(0);
    for (const c of caixas) expect(c.w).toBeGreaterThan(20);
  });

  it('o par salvar/restaurar fecha com o texto em caixa', () => {
    const b = montarBancada({ mostrarDiagnostico: true }, true);
    b.desenharUmaPassada();

    expect(b.ctx.saves).toBe(b.ctx.restores);
  });
});

/**
 * ⭐ Canto da legenda — o defeito "bookmap sobrepondo componente no topo esquerdo".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FOI RELATADO, E POR QUE A CORREÇÃO É UMA OPÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A legenda desta camada escrevia SEMPRE no canto superior esquerdo. É exactamente
 * ali que a aplicação põe a leitura de fita (a `ChartLegend` do pacote React, ancorada
 * em `top/left`), e o resultado é duas coisas no mesmo pixel — o usuário fotografou.
 *
 * A camada não tem como saber o que a aplicação ancorou por cima dela, e adivinhar
 * seria pior. A correcção é **deixar de assumir que o canto superior esquerdo é dela**:
 * `posicaoLegenda` dá a escolha a quem monta a tela.
 *
 * ⚠️ Só os cantos ESQUERDOS existem. A faixa da direita é o eixo de preço (56 px no
 * motor) e esta camada não conhece essa largura — oferecer um canto direito seria
 * oferecer texto por baixo do eixo.
 */
describe('⭐ posicaoLegenda — a legenda não é dona do canto superior esquerdo', () => {
  /** Só as caixas de texto (o estilo próprio delas), na ordem de desenho. */
  function caixasDeTexto(ctx: ContextoFalso): Caixa[] {
    return ctx.caixas.filter((c) => c.estilo === 'rgba(15, 23, 42, 0.82)');
  }

  it('por omissão continua no topo — o comportamento herdado não muda', () => {
    const b = montarBancada({}, true);
    expect(b.desenharUmaPassada()).toBe(true);
    const caixas = caixasDeTexto(b.ctx);
    expect(caixas.length).toBeGreaterThan(0);
    // Guarda de vacuidade: há legenda escrita, e ela está na metade de CIMA.
    expect(textoJunto(b.ctx)).toContain('Livro');
    expect(caixas[0]!.y).toBeLessThan(ALTURA_PX / 2);
  });

  it("`'inferior-esquerda'` desce a legenda para a metade de baixo", () => {
    const b = montarBancada({ posicaoLegenda: 'inferior-esquerda' }, true);
    expect(b.desenharUmaPassada()).toBe(true);
    const caixas = caixasDeTexto(b.ctx);
    expect(caixas.length).toBeGreaterThan(0);
    // O mesmo texto, outro canto.
    expect(textoJunto(b.ctx)).toContain('Livro');
    expect(caixas[0]!.y).toBeGreaterThan(ALTURA_PX / 2);
    // E dentro do painel: a caixa não pode vazar por baixo.
    expect(caixas[0]!.y + caixas[0]!.h).toBeLessThanOrEqual(ALTURA_PX);
  });

  /**
   * ⭐ A parte que seria o defeito de cabeça para baixo: com o diagnóstico ligado há
   * um RODAPÉ de cobertura no canto de baixo. A legenda tem de EMPILHAR ACIMA dele, não
   * cair em cima.
   */
  it("`'inferior-esquerda'` empilha ACIMA do rodapé de cobertura", () => {
    const b = montarBancada(
      { posicaoLegenda: 'inferior-esquerda', mostrarDiagnostico: true },
      true,
    );
    expect(b.desenharUmaPassada()).toBe(true);

    const caixas = caixasDeTexto(b.ctx);
    // Duas caixas: legenda (desenhada primeiro) e rodapé.
    expect(caixas.length).toBe(2);
    const legenda = caixas[0]!;
    const rodape = caixas[1]!;

    // Guarda de vacuidade: o rodapé de cobertura existe mesmo.
    expect(textoJunto(b.ctx)).toContain('Cobertura');
    // A base da legenda não passa do topo do rodapé.
    expect(legenda.y + legenda.h).toBeLessThanOrEqual(rodape.y);
  });

  it('no topo, a legenda também não colide com o rodapé (o caso herdado)', () => {
    const b = montarBancada({ mostrarDiagnostico: true }, true);
    expect(b.desenharUmaPassada()).toBe(true);
    const caixas = caixasDeTexto(b.ctx);
    expect(caixas.length).toBe(2);
    expect(caixas[0]!.y + caixas[0]!.h).toBeLessThanOrEqual(caixas[1]!.y);
  });

  it('trocar de canto NÃO muda o conteúdo do texto', () => {
    const topo = montarBancada({}, true);
    topo.desenharUmaPassada();
    const baixo = montarBancada({ posicaoLegenda: 'inferior-esquerda' }, true);
    baixo.desenharUmaPassada();
    expect(textoJunto(baixo.ctx)).toBe(textoJunto(topo.ctx));
  });
});
