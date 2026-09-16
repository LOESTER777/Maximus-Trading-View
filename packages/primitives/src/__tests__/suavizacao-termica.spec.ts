/**
 * Suavização das células de fila — o desfoque que acompanha o modo TÉRMICA.
 *
 * Motivo da feature: o balde materializado é de 60 s, então cada célula é um
 * minuto achatado e as bordas retas fazem o heatmap ser lido como bloco. Foi a
 * palavra do operador em 04/09/2026 ("lego") e é o que distancia a camada do
 * bookmap comercial, que trabalha em 1 s. Um desfoque de sub-pixel dissolve a
 * borda sem apagar a estrutura.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE: a suavização foi implementada e publicada sem
 * teste nenhum — `suavizar` tinha ZERO ocorrências em `__tests__/`. Os 644
 * testes do bookmap passavam com e sem o conserto, ou seja, a validação por
 * reversão não tinha alvo. Um teste que só conta retângulos passaria com o
 * defeito presente, porque o desfoque não muda a QUANTIDADE de formas.
 *
 * ⚠️ E as asserções são sobre a PROPRIEDADE observável (o desfoque chega ao
 * contexto, e o par salvar/restaurar fecha), não sobre o mecanismo interno
 * (onde a atribuição de `plan.suavizar` mora dentro de `refreshPalettes`).
 * Mecanismo muda; propriedade é o contrato. Foi o que permitiu descobrir que o
 * comentário daquela linha descrevia um `reset()` que não zera nada.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type { SeriesAttachedParameter, SeriesType, Time } from '@robustus/chart-core';
import { BookmapPrimitive } from '@robustus/charts-primitives';
import type { BookmapLayerOptions } from '@robustus/charts-primitives';
import type { BookmapGrid, CoberturaHeatmap } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Contexto falso — mínimo, e com `filter` RASTREADO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `filter` é um SETTER, não um campo.
 *
 * O código de produção atribui `ctx.filter` dentro de um `try` (a propriedade
 * não é universal entre navegadores). Um campo simples guardaria apenas o
 * último valor e não distinguiria "nunca foi tocado" de "foi tocado e depois
 * sobrescrito" — e é exatamente "nunca foi tocado" que prova a byte-identidade
 * do modo LADO.
 */
class ContextoFalso {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  /** Células de fila e marcas de execução preenchidas. */
  retangulos = 0;
  saves = 0;
  restores = 0;

  /** Todo valor já atribuído a `filter`, na ordem. Vazio = nunca tocado. */
  filtrosAplicados: string[] = [];

  private valorDoFiltro = '';

  get filter(): string {
    return this.valorDoFiltro;
  }

  set filter(v: string) {
    this.valorDoFiltro = v;
    this.filtrosAplicados.push(v);
  }

  zerar(): void {
    this.retangulos = 0;
    this.saves = 0;
    this.restores = 0;
    this.filtrosAplicados = [];
    this.ultimoRect = null;
  }

  fillRect(): void {
    this.retangulos += 1;
  }
  strokeRect(): void {}
  fillText(): void {}
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
  fill(): void {}
}

const LARGURA_PX = 800;
const ALTURA_PX = 400;

/**
 * Alvo de render fiel ao contrato da biblioteca: o par salvar/restaurar fica num
 * bloco de encerramento. Um dublê que restaurasse só no caminho felizmente
 * concluído inventaria um desequilíbrio que a biblioteca real não tem.
 */
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
// Grid e escalas — os mesmos valores da bancada principal, para não divergir
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
  return {
    chart,
    series,
    requestUpdate: () => {},
  } as unknown as SeriesAttachedParameter<Time, SeriesType>;
}

const OPCOES_BASE: Omit<BookmapLayerOptions, 'grid'> = {
  // `FILA` mantém a passada no essencial: sem execução, todo retângulo contado é
  // célula de fila — que é justamente o que a suavização envolve.
  metrica: 'FILA',
  escala: 'P99_GAMMA',
  tickSize: TICK_SIZE,
  maxCells: 3000,
  minCellPx: 3,
};

interface Bancada {
  readonly primitive: BookmapPrimitive;
  readonly ctx: ContextoFalso;
  readonly opcoes: BookmapLayerOptions;
  desenharUmaPassada: () => boolean;
}

function montarBancada(modoCor?: 'LADO' | 'TERMICA'): Bancada {
  const ctx = new ContextoFalso();
  const alvo = criarAlvo(ctx);
  const opcoes: BookmapLayerOptions = {
    grid: criarGrid(),
    ...OPCOES_BASE,
    ...(modoCor === undefined ? {} : { modoCor }),
  };
  // Relógio parado: com duração zero a degradação adaptativa do orçamento nunca
  // dispara e a suíte não depende da velocidade da máquina.
  const primitive = new BookmapPrimitive(opcoes, () => 0);
  primitive.attached(criarParametroDeAnexacao());

  return {
    primitive,
    ctx,
    opcoes,
    desenharUmaPassada: (): boolean => {
      primitive.updateAllViews();
      const view = primitive.paneViews()[0];
      if (view === undefined) return false;
      const r = view.renderer();
      if (r === null) return false;
      (r as { draw: (a: CanvasRenderingTarget2D) => void }).draw(alvo);
      return true;
    },
  };
}

/** Algum desfoque foi aplicado nesta passada? */
function houveDesfoque(ctx: ContextoFalso): boolean {
  return ctx.filtrosAplicados.some((f) => f.startsWith('blur('));
}

// ═════════════════════════════════════════════════════════════════════════════

describe('BookmapPrimitive — suavização acompanha o modo TÉRMICA', () => {
  it('guarda de vacuidade: a passada realmente emite células de fila', () => {
    // Sem esta guarda, todo o resto deste arquivo poderia passar com o
    // renderizador desenhando nada. É a lição do primeiro teste de legenda, que
    // "passava" comparando duas telas vazias.
    const b = montarBancada('TERMICA');
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.retangulos).toBeGreaterThan(0);
  });

  it('⭐ modo TERMICA aplica desfoque de sub-pixel nas células de fila', () => {
    const b = montarBancada('TERMICA');
    b.desenharUmaPassada();
    expect(houveDesfoque(b.ctx)).toBe(true);
  });

  it('⭐ modo LADO NUNCA toca `filter` — byte-idêntico ao histórico', () => {
    const b = montarBancada('LADO');
    b.desenharUmaPassada();
    expect(b.ctx.retangulos).toBeGreaterThan(0); // desenhou
    expect(b.ctx.filtrosAplicados).toEqual([]); // e não suavizou
  });

  it('opção AUSENTE se comporta como LADO — preserva as bancadas de propriedade', () => {
    // Várias suítes constroem a camada sem informar `modoCor`. Se a ausência
    // ligasse a suavização, elas passariam a medir outro desenho.
    const b = montarBancada(undefined);
    b.desenharUmaPassada();
    expect(b.ctx.filtrosAplicados).toEqual([]);
  });

  it('o par salvar/restaurar em torno da suavização fecha', () => {
    // Desequilíbrio aqui vazaria o desfoque para tudo que a biblioteca desenhar
    // depois — as velas inclusive.
    for (const modo of ['TERMICA', 'LADO'] as const) {
      const b = montarBancada(modo);
      b.desenharUmaPassada();
      expect(b.ctx.saves, `saves≠restores no modo ${modo}`).toBe(b.ctx.restores);
      expect(b.ctx.saves).toBeGreaterThan(0);
    }
  });

  it('⭐⭐ a suavização PERSISTE em passadas seguintes, com a paleta já cacheada', () => {
    // Este é o teste do conserto. As paletas são reconstruídas só quando a chave
    // de escala muda, então da segunda passada em diante o bloco de reconstrução
    // não roda. Se a decisão de suavizar dependesse de entrar naquele bloco, o
    // desfoque apareceria na primeira passada e desapareceria nas demais — e o
    // operador veria a camada mudar de aparência sozinha ao mover o gráfico.
    const b = montarBancada('TERMICA');
    for (let passada = 1; passada <= 4; passada += 1) {
      b.ctx.zerar();
      expect(b.desenharUmaPassada()).toBe(true);
      expect(b.ctx.retangulos, `passada ${passada} não desenhou`).toBeGreaterThan(0);
      expect(houveDesfoque(b.ctx), `passada ${passada} perdeu o desfoque`).toBe(true);
    }
  });

  it('⭐ trocar de LADO para TERMICA por `update` liga a suavização sem reanexar', () => {
    // Quarta ocorrência da mesma armadilha desta feature: `marcaExec`,
    // `mostrarLegenda`, `modoCor` e agora a suavização que o acompanha. Trocar o
    // modo não altera `bookmapLayer != null`, então o efeito de ANEXAÇÃO não roda
    // de novo — só o patch de `update`. Campo que não entra nesse patch fica
    // congelado no estado em que a camada nasceu.
    const b = montarBancada('LADO');
    b.desenharUmaPassada();
    expect(houveDesfoque(b.ctx)).toBe(false);

    b.ctx.zerar();
    b.primitive.update({ ...b.opcoes, modoCor: 'TERMICA' });
    b.desenharUmaPassada();
    expect(houveDesfoque(b.ctx)).toBe(true);
  });

  it('e a volta para LADO desliga — a troca é reversível nos dois sentidos', () => {
    const b = montarBancada('TERMICA');
    b.desenharUmaPassada();
    expect(houveDesfoque(b.ctx)).toBe(true);

    b.ctx.zerar();
    b.primitive.update({ ...b.opcoes, modoCor: 'LADO' });
    b.desenharUmaPassada();
    expect(b.ctx.retangulos).toBeGreaterThan(0);
    expect(b.ctx.filtrosAplicados).toEqual([]);
  });
});
