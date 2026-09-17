/**
 * VolumeProfilePrimitive — o histograma POR LINHA, e o ambiente que ele respeita.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA CAMADA RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O gráfico só tinha histograma por COLUNA (volume por barra, no pé do painel), que
 * responde *quando* negociou. Faltava o *a que preço* — a leitura que o núcleo
 * `perfil-de-volume.core.ts` já calculava e que nenhuma camada desenhava.
 *
 * O pedido: *"criar separações dos ambientes dos histogramas, e poder inserir histograma
 * por linha e por coluna, para assim economizar espaço do gráfico"*.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS AFIRMAÇÕES QUE IMPORTAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. **A camada é uma FAIXA.** Nada é desenhado fora dela — sem isso o perfil vira uma
 *     mancha sobre as velas, que é o oposto de economizar espaço.
 *  2. **A faixa da direita desconta o EIXO DE PREÇO**, perguntando a largura ao gráfico
 *     em vez de assumir 56 px.
 *  3. **`margemInferiorFracao` separa os ambientes**: o perfil para onde o volume por
 *     coluna começa, e os dois histogramas deixam de compartilhar pixel.
 *  4. **POC e área de valor atravessam o painel**, porque são níveis de PREÇO — dentro da
 *     faixa seriam decoração.
 *  5. **Sem `hitTest`** (property test do pacote cobre), e **falha esvazia** em vez de
 *     propagar.
 */
import { describe, expect, it } from 'vitest';
import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type { SeriesAttachedParameter, SeriesType, Time } from '@robustus/chart-core';
import { VolumeProfilePrimitive } from '@robustus/charts-primitives';
import type { VolumeProfileLayerOptions } from '@robustus/charts-primitives';
import type { NivelDoPerfil, PerfilDeVolume } from '@robustus/charts-core';

const LARGURA_PX = 800;
const ALTURA_PX = 400;
const LARGURA_EIXO_PX = 56;

/** Faixa de preço que a escala falsa cobre. */
const PRECO_BASE = 100;
const PRECO_TOPO = 200;

// ═════════════════════════════════════════════════════════════════════════════
// Contexto falso — registra retângulos e segmentos COM coordenada
// ═════════════════════════════════════════════════════════════════════════════

interface Ret {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly estilo: string;
}

interface Seg {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly estilo: string;
}

class ContextoFalso {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  retangulos: Ret[] = [];
  segmentos: Seg[] = [];
  textos: string[] = [];
  saves = 0;
  restores = 0;

  private de: { x: number; y: number } | null = null;

  fillRect(x: number, y: number, w: number, h: number): void {
    this.retangulos.push({ x, y, w, h, estilo: this.fillStyle });
  }
  fillText(t: string): void {
    this.textos.push(t);
  }
  measureText(t: string): { width: number } {
    return { width: t.length * 6 };
  }
  moveTo(x: number, y: number): void {
    this.de = { x, y };
  }
  lineTo(x: number, y: number): void {
    if (this.de !== null) {
      this.segmentos.push({ x1: this.de.x, y1: this.de.y, x2: x, y2: y, estilo: this.strokeStyle });
    }
  }
  beginPath(): void {
    this.de = null;
  }
  stroke(): void {}
  fill(): void {}
  rect(): void {}
  clip(): void {}
  setLineDash(): void {}
  setTransform(): void {}
  scale(): void {}
  save(): void {
    this.saves += 1;
  }
  restore(): void {
    this.restores += 1;
  }
}

function criarAlvo(ctx: ContextoFalso): CanvasRenderingTarget2D {
  return {
    useBitmapCoordinateSpace<T>(f: (scope: unknown) => T): T {
      try {
        ctx.save();
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

/**
 * Parâmetro de anexação com escala LINEAR de preço.
 *
 * `comEscalaDePreco = false` simula um gráfico cuja `priceScale` lança (dublê antigo,
 * motor em descarte): a camada tem de continuar desenhando, só sem o desconto do eixo.
 */
function criarParametro(comEscalaDePreco = true): SeriesAttachedParameter<Time, SeriesType> {
  const chart = {
    paneSize: () => ({ width: LARGURA_PX, height: ALTURA_PX }),
    timeScale: () => ({ timeToCoordinate: () => 0 }),
    priceScale: (): { width: () => number } => {
      if (!comEscalaDePreco) throw new Error('sem escala nomeada');
      return { width: () => LARGURA_EIXO_PX };
    },
  };
  const series = {
    // Preço alto no topo (y=0), preço baixo embaixo (y=ALTURA) — como o eixo real.
    priceToCoordinate: (preco: number): number =>
      ((PRECO_TOPO - preco) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX,
    coordinateToPrice: (y: number): number =>
      PRECO_TOPO - (y / ALTURA_PX) * (PRECO_TOPO - PRECO_BASE),
  };
  return { chart, series, requestUpdate: () => {} } as unknown as SeriesAttachedParameter<
    Time,
    SeriesType
  >;
}

// ═════════════════════════════════════════════════════════════════════════════
// Perfis de teste
// ═════════════════════════════════════════════════════════════════════════════

function nivel(preco: number, compra: number, venda: number): NivelDoPerfil {
  return { preco, compra, venda, total: compra + venda };
}

/** Perfil decrescente em preço, como o núcleo produz. */
function perfilDeTeste(over: Partial<PerfilDeVolume> = {}): PerfilDeVolume {
  const niveis = [nivel(180, 30, 20), nivel(160, 200, 100), nivel(140, 60, 40), nivel(120, 10, 10)];
  return {
    niveis,
    maiorTotal: 300,
    totalGeral: 500,
    poc: 160,
    vah: 180,
    val: 140,
    fracaoAreaDeValor: 0.7,
    motivoVazio: null,
    ...over,
  };
}

const PERFIL_VAZIO: PerfilDeVolume = {
  niveis: [],
  maiorTotal: 0,
  totalGeral: 0,
  poc: null,
  vah: null,
  val: null,
  fracaoAreaDeValor: 0.7,
  motivoVazio: 'Sem grid de livro carregado.',
};

interface Bancada {
  readonly camada: VolumeProfilePrimitive;
  readonly ctx: ContextoFalso;
  desenhar: () => boolean;
}

function montar(
  over: Partial<VolumeProfileLayerOptions> = {},
  comEscalaDePreco = true,
): Bancada {
  const ctx = new ContextoFalso();
  const alvo = criarAlvo(ctx);
  const camada = new VolumeProfilePrimitive({ perfil: perfilDeTeste(), ...over });
  camada.attached(criarParametro(comEscalaDePreco));
  return {
    camada,
    ctx,
    desenhar: (): boolean => {
      camada.updateAllViews();
      const view = camada.paneViews()[0];
      if (view === undefined) return false;
      const r = view.renderer();
      if (r === null) return false;
      r.draw(alvo);
      return true;
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════

describe('VolumeProfilePrimitive — a faixa é o ambiente', () => {
  it('desenha uma barra por nível com volume', () => {
    const b = montar({ modoCor: 'total' });
    expect(b.desenhar()).toBe(true);
    // 4 níveis, uma barra cada no modo `total`.
    expect(b.ctx.retangulos).toHaveLength(4);
  });

  /**
   * ⭐ A LARGURA CODIFICA O VOLUME, e o POC é o mais longo. Sem esta propriedade o perfil
   * é um enfeite: é a comparação de larguras que responde "onde negociou mais".
   */
  it('a largura é proporcional ao volume, e o POC é a barra mais longa', () => {
    const b = montar({ modoCor: 'total' });
    b.desenhar();
    const larguras = b.ctx.retangulos.map((r) => r.w);
    const maior = Math.max(...larguras);
    // O nível de 300 (o POC) contra o de 20 (o menor): 15x de diferença.
    expect(maior / Math.min(...larguras)).toBeGreaterThan(10);

    // E a barra mais longa está na altura do POC (preço 160).
    const yPoc = ((PRECO_TOPO - 160) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX;
    const barraMaior = b.ctx.retangulos.find((r) => r.w === maior)!;
    expect(Math.abs(barraMaior.y + barraMaior.h / 2 - yPoc)).toBeLessThan(2);
  });

  /**
   * ⭐ O CASO DO EIXO DE PREÇO. À direita, a faixa tem de PARAR antes do eixo — encostar
   * na borda poria o perfil por baixo dos rótulos de preço.
   */
  it('à direita, nenhuma barra invade a faixa do eixo de preço', () => {
    const b = montar({ modoCor: 'total' });
    b.desenhar();
    const limite = LARGURA_PX - LARGURA_EIXO_PX;
    for (const r of b.ctx.retangulos) {
      expect(r.x + r.w).toBeLessThanOrEqual(limite);
    }
    // Guarda de vacuidade: a barra maior chega PERTO do limite (não é que tudo ficou no
    // canto esquerdo por acidente).
    const maisADireita = Math.max(...b.ctx.retangulos.map((r) => r.x + r.w));
    expect(limite - maisADireita).toBeLessThan(12);
  });

  it('sem `priceScale` utilizável, desenha sem o desconto — e não lança', () => {
    const b = montar({ modoCor: 'total' }, false);
    expect(() => b.desenhar()).not.toThrow();
    expect(b.ctx.retangulos.length).toBeGreaterThan(0);
  });

  it("`lado: 'esquerda'` ancora na borda esquerda", () => {
    const b = montar({ modoCor: 'total', lado: 'esquerda' });
    b.desenhar();
    // Todas as barras começam junto à borda esquerda.
    for (const r of b.ctx.retangulos) expect(r.x).toBeLessThan(8);
    // E nenhuma passa da metade da tela com a fração default.
    for (const r of b.ctx.retangulos) expect(r.x + r.w).toBeLessThan(LARGURA_PX / 2);
  });

  it('`larguraFracao` muda a largura da faixa, e é recortada', () => {
    const estreita = montar({ modoCor: 'total', larguraFracao: 0.06 });
    estreita.desenhar();
    const larga = montar({ modoCor: 'total', larguraFracao: 0.45 });
    larga.desenhar();
    const maxEstreita = Math.max(...estreita.ctx.retangulos.map((r) => r.w));
    const maxLarga = Math.max(...larga.ctx.retangulos.map((r) => r.w));
    expect(maxLarga).toBeGreaterThan(maxEstreita * 3);

    // Fração absurda é recortada a 50% da largura do painel.
    const absurda = montar({ modoCor: 'total', larguraFracao: 5 });
    absurda.desenhar();
    for (const r of absurda.ctx.retangulos) expect(r.w).toBeLessThanOrEqual(LARGURA_PX * 0.5);
  });

  /**
   * ⭐ A SEPARAÇÃO DE AMBIENTES pedida: com `margemInferiorFracao`, o perfil não entra na
   * faixa em que vive o histograma por COLUNA. Sem isso os dois se cruzam no canto
   * inferior direito e as duas leituras ficam ilegíveis ali.
   */
  it('`margemInferiorFracao` mantém o perfil FORA da faixa do volume por coluna', () => {
    const b = montar({ modoCor: 'total', margemInferiorFracao: 0.25 });
    b.desenhar();
    const limiteY = ALTURA_PX * 0.75;
    // ⚠️ A comparação é com a BASE da barra (`y + h`), não com o topo: uma barra cujo
    // centro está acima do limite ainda pode invadir a faixa reservada com a metade de
    // baixo — e invadir é exatamente o que a margem existe para impedir.
    for (const r of b.ctx.retangulos) expect(r.y + r.h).toBeLessThanOrEqual(limiteY);
    // Guarda de vacuidade: SEM a margem, há barra invadindo aquele limite.
    const semMargem = montar({ modoCor: 'total' });
    semMargem.desenhar();
    expect(semMargem.ctx.retangulos.some((r) => r.y + r.h > limiteY)).toBe(true);
  });

  it('modo `lado` divide a barra em compra e venda, sem mudar o total', () => {
    const porLado = montar({ modoCor: 'lado' });
    porLado.desenhar();
    const total = montar({ modoCor: 'total' });
    total.desenhar();

    // Duas cores por nível (compra + venda) contra uma.
    expect(porLado.ctx.retangulos.length).toBeGreaterThan(total.ctx.retangulos.length);

    // A soma das duas partes de um nível é a largura da barra única daquele nível.
    const larguraTotalPoc = Math.max(...total.ctx.retangulos.map((r) => r.w));
    const yPoc = ((PRECO_TOPO - 160) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX;
    const partesDoPoc = porLado.ctx.retangulos.filter((r) => Math.abs(r.y + r.h / 2 - yPoc) < 2);
    const soma = partesDoPoc.reduce((s, r) => s + r.w, 0);
    expect(soma).toBeCloseTo(larguraTotalPoc, 5);
  });
});

describe('VolumeProfilePrimitive — POC e área de valor', () => {
  /**
   * ⭐ Eles ATRAVESSAM o painel, e é isso que os torna úteis: o POC é um nível de PREÇO, e
   * serve para ler se a vela está acima ou abaixo dele. Um tracinho dentro da faixa
   * lateral seria decoração.
   */
  it('a linha do POC atravessa o painel inteiro', () => {
    const b = montar();
    b.desenhar();
    const yPoc = ((PRECO_TOPO - 160) / (PRECO_TOPO - PRECO_BASE)) * ALTURA_PX;
    const linhaPoc = b.ctx.segmentos.find((s) => Math.abs(s.y1 - yPoc) < 1);
    expect(linhaPoc).toBeDefined();
    expect(linhaPoc!.x1).toBe(0);
    expect(linhaPoc!.x2).toBe(LARGURA_PX);
  });

  it('as bordas da área de valor saem em duas linhas', () => {
    const b = montar();
    b.desenhar();
    // POC + VAH + VAL = 3 linhas horizontais.
    expect(b.ctx.segmentos).toHaveLength(3);
  });

  it('podem ser desligadas de forma independente', () => {
    const semPoc = montar({ mostrarPOC: false });
    semPoc.desenhar();
    expect(semPoc.ctx.segmentos).toHaveLength(2);

    const semArea = montar({ mostrarAreaDeValor: false });
    semArea.desenhar();
    expect(semArea.ctx.segmentos).toHaveLength(1);

    const semNada = montar({ mostrarPOC: false, mostrarAreaDeValor: false });
    semNada.desenhar();
    expect(semNada.ctx.segmentos).toHaveLength(0);
  });

  it('perfil sem POC/área (dado degenerado) não desenha linha nenhuma', () => {
    const b = montar({ perfil: perfilDeTeste({ poc: null, vah: null, val: null }) });
    b.desenhar();
    expect(b.ctx.segmentos).toHaveLength(0);
    // Mas as barras continuam.
    expect(b.ctx.retangulos.length).toBeGreaterThan(0);
  });
});

describe('VolumeProfilePrimitive — estados de exceção', () => {
  /**
   * ⚠️ "Ligada e sem dado" e "desligada" são estados DIFERENTES e têm de parecer
   * diferentes. Com perfil vazio a camada escreve o motivo em vez de ficar visualmente
   * idêntica a desligada — o defeito de tela vazia sem explicação que este projeto já
   * pagou várias vezes.
   */
  it('perfil vazio escreve o MOTIVO em vez de ficar igual a desligado', () => {
    const b = montar({ perfil: PERFIL_VAZIO });
    expect(b.desenhar()).toBe(true);
    expect(b.ctx.retangulos).toHaveLength(0);
    expect(b.ctx.textos.join(' ')).toContain('Sem grid de livro carregado');
  });

  it('perfil vazio com `mostrarLegenda: false` não desenha NADA', () => {
    const b = montar({ perfil: PERFIL_VAZIO, mostrarLegenda: false });
    // Sem conteúdo, o renderer nem é produzido.
    expect(b.desenhar()).toBe(false);
  });

  it('a legenda diz níveis, POC e área de valor', () => {
    const b = montar();
    b.desenhar();
    const texto = b.ctx.textos.join(' ');
    expect(texto).toContain('Perfil de volume');
    expect(texto).toContain('4 níveis');
    expect(texto).toContain('POC 160');
    expect(texto).toContain('70%');
  });

  it('`mostrarLegenda: false` cala a camada sem apagar o desenho', () => {
    const b = montar({ mostrarLegenda: false });
    b.desenhar();
    expect(b.ctx.textos).toHaveLength(0);
    expect(b.ctx.retangulos.length).toBeGreaterThan(0);
  });

  it('sem anexar, não produz renderer nem lança', () => {
    const solta = new VolumeProfilePrimitive({ perfil: perfilDeTeste() });
    expect(() => solta.updateAllViews()).not.toThrow();
    expect(solta.paneViews()[0]!.renderer()).toBeNull();
  });

  it('`detached` esvazia o plano', () => {
    const b = montar();
    b.desenhar();
    expect(b.camada.estado().barras).toBeGreaterThan(0);
    b.camada.detached();
    expect(b.camada.estado().barras).toBe(0);
  });

  it('`update` troca o perfil sem reanexar', () => {
    const b = montar({ modoCor: 'total' });
    b.desenhar();
    const antes = b.ctx.retangulos.length;
    b.ctx.retangulos = [];

    b.camada.update({ perfil: perfilDeTeste({ niveis: [nivel(150, 5, 5)], maiorTotal: 10 }) });
    b.desenhar();
    expect(b.ctx.retangulos.length).toBe(1);
    expect(antes).toBeGreaterThan(1);
  });

  it('vai ATRÁS das velas (zOrder bottom)', () => {
    const b = montar();
    expect(b.camada.paneViews()[0]!.zOrder()).toBe('bottom');
  });

  /**
   * ⚠️ A garantia estrutural do pacote: sem `hitTest`, a camada não captura ponteiro. É
   * garantia de TIPO, não de CSS.
   */
  it('NÃO implementa hitTest', () => {
    const b = montar();
    expect((b.camada as unknown as { hitTest?: unknown }).hitTest).toBeUndefined();
  });

  it('o par salvar/restaurar fecha', () => {
    const b = montar();
    b.desenhar();
    expect(b.ctx.saves).toBe(b.ctx.restores);
  });
});
