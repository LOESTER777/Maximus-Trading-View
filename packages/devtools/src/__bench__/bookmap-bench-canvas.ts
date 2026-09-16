/**
 * `bookmap-bench-canvas` — os dublês de canvas e de escalas do gráfico que
 * permitem **cronometrar a passada de desenho**. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 12.1. Requisitos 9.1 e 9.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTEM DUBLÊS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `BookmapPrimitive.draw()` recebe um `CanvasRenderingTarget2D` e o ambiente da
 * suíte é `jsdom`, que **não tem contexto 2D**: `getContext('2d')` devolve `null`
 * e não há rasterizador por trás. Sem dublê não há como chamar `draw()` — e o
 * requisito 9.3 é sobre `draw()`.
 *
 * Os dublês daqui são irmãos dos de `__tests__/BookmapPrimitive.spec.ts`, com a
 * mesma forma de alvo (incluindo o par salvar/restaurar em bloco de
 * encerramento, como a biblioteca real faz) e a mesma convenção de escalas
 * (coordenada 0 no topo do painel, logo o preço maior). A duplicação é
 * deliberada: aqueles não são exportados, e uma bancada que importasse de um
 * arquivo de teste passaria a depender da ordem de coleta da suíte.
 *
 * A diferença é de propósito e aparece no contexto: o da suíte **acumula** os
 * textos emitidos para permitir asserção de conteúdo; o daqui só **conta**. Num
 * laço de 100 repetições sobre milhares de células, acumular textos alocaria a
 * cada passada e a bancada mediria a alocação do dublê.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O QUE O TEMPO MEDIDO AQUI SIGNIFICA — E O QUE NÃO SIGNIFICA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Inclui**: leitura da janela visível pelas escalas, agregação por zoom quando
 * o plano está sujo, cálculo de escala de cor, conversão célula→pixel, o laço de
 * emissão e as trocas de estilo.
 *
 * **Exclui**: rasterização, composição e sincronismo de quadro. Não há pixel.
 *
 * Portanto o valor apurado é o **trabalho da camada**, que é a parte sob
 * controle deste projeto e onde uma regressão de algoritmo apareceria. Não é o
 * tempo de quadro de um navegador. O relatório declara isso pelo campo
 * `ehNavegadorReal` do ambiente, e quem ler o número precisa dessa qualificação.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O RELÓGIO INJETADO NA CAMADA (e por que ele fica CONGELADO)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `BookmapPrimitive` aceita um relógio no segundo parâmetro do construtor e o usa
 * para a **degradação adaptativa**: quando a mediana das 30 passadas mais
 * recentes excede 8 ms, o orçamento de células cai à metade (requisito 9.9).
 *
 * Numa medição de tempo isso é veneno: a camada mudaria o orçamento no meio das
 * 100 repetições e o percentil misturaria dois orçamentos diferentes. Por isso o
 * padrão de `montarCamadaDeBancada` é **relógio parado** (`() => 0`) — a
 * degradação nunca dispara, o orçamento permanece o declarado, e o tempo é
 * medido de fora, pelo relógio real do protocolo.
 *
 * Para **exercitar** a degradação (o que a tarefa 12.2 também precisa fazer), o
 * mesmo parâmetro serve com o sinal oposto: um relógio que avance mais que o
 * alvo por passada força a redução de forma determinística, sem depender da
 * velocidade da máquina. `relogioQueForcaDegradacao` é isso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Só dublês em memória. Nenhuma leitura de banco, de arquivo, de CSV ou de rede;
 * nenhuma escrita; nenhum endereço de rede, identificador de conta, credencial ou
 * estado de posição. Importa exclusivamente a camada e os tipos da própria pasta,
 * mais tipos das bibliotecas de gráfico.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';

import { BookmapPrimitive, type BookmapLayerOptions } from '@robustus/charts-primitives';
import type { BookmapGrid, VisibleWindow } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Contexto 2D de contagem
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Contexto 2D mínimo: aceita tudo que a passada emite e **só conta**.
 *
 * Cada método é o corpo mais curto possível de propósito. O que se quer medir é
 * o custo da camada, e qualquer trabalho aqui entraria no número como se fosse
 * dela.
 */
export class ContextoDeBancada {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  /** Retângulos preenchidos: células de fila e marcas de execução. */
  retangulos = 0;

  /** Retângulos contornados: células que estouraram o teto da escala. */
  contornos = 0;

  /** Textos emitidos. Contados, não guardados — ver o cabeçalho. */
  textos = 0;

  /** Trocas de estilo de preenchimento. Diz quantos baldes de cor a passada usou. */
  trocasDeEstilo = 0;

  saves = 0;
  restores = 0;

  zerar(): void {
    this.retangulos = 0;
    this.contornos = 0;
    this.textos = 0;
    this.trocasDeEstilo = 0;
    this.saves = 0;
    this.restores = 0;
  }

  fillRect(): void {
    this.retangulos += 1;
  }

  strokeRect(): void {
    this.contornos += 1;
  }

  fillText(): void {
    this.textos += 1;
  }

  save(): void {
    this.saves += 1;
  }

  restore(): void {
    this.restores += 1;
  }

  setTransform(): void {
    /* sem geometria: a bancada não afirma nada sobre posição */
  }

  scale(): void {
    /* idem */
  }

  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
}

/**
 * Alvo de render com o contrato da biblioteca de canvas.
 *
 * O par salvar/restaurar fica em bloco de encerramento, **como no original** — um
 * dublê que só restaurasse no caminho felizmente concluído inventaria um
 * desequilíbrio que a biblioteca real não tem.
 */
export function criarAlvoDeBancada(
  ctx: ContextoDeBancada,
  larguraPx: number,
  alturaPx: number,
): CanvasRenderingTarget2D {
  const escopo = {
    context: ctx,
    mediaSize: { width: larguraPx, height: alturaPx },
    bitmapSize: { width: larguraPx, height: alturaPx },
    horizontalPixelRatio: 1,
    verticalPixelRatio: 1,
  };

  const alvo = {
    useBitmapCoordinateSpace<T>(f: (scope: unknown) => T): T {
      try {
        ctx.save();
        ctx.setTransform();
        return f(escopo);
      } finally {
        ctx.restore();
      }
    },
    useMediaCoordinateSpace<T>(f: (scope: unknown) => T): T {
      return f({ context: ctx, mediaSize: escopo.mediaSize });
    },
  };

  return alvo as unknown as CanvasRenderingTarget2D;
}

// ═════════════════════════════════════════════════════════════════════════════
// Escalas do gráfico
// ═════════════════════════════════════════════════════════════════════════════

/** Limites que as escalas do dublê devem reproduzir. */
export interface LimitesDaVista {
  readonly tsDeMs: number;
  readonly tsAteMs: number;
  readonly precoDe: number;
  readonly precoAte: number;
  readonly larguraPx: number;
  readonly alturaPx: number;
}

/**
 * Parâmetro de anexação com escalas lineares e sem estado.
 *
 * ⚠️ **A camada deriva a própria janela visível destas escalas**, não de um
 * `VisibleWindow` recebido: ela lê `paneSize()`, `timeScale().getVisibleRange()`
 * e `series.coordinateToPrice(0 | alturaPx)`. Então é aqui — e só aqui — que se
 * escolhe o zoom sob medição.
 *
 * Coordenada 0 é o topo do painel, logo o preço **maior**, que é a convenção da
 * biblioteca. Inverter as pontas produziria janela vazia e a camada
 * simplesmente não apareceria, sem erro — o dublê errado mais difícil de
 * diagnosticar depois.
 */
export function criarParametroDeAnexacao(
  limites: LimitesDaVista,
  requestUpdate: () => void,
): SeriesAttachedParameter<Time, SeriesType> {
  const vaoMs = limites.tsAteMs - limites.tsDeMs;
  const vaoPreco = limites.precoAte - limites.precoDe;

  const timeScale = {
    getVisibleRange: () => ({ from: limites.tsDeMs / 1000, to: limites.tsAteMs / 1000 }),
    // A camada entrega o instante em segundos; ver `buildCoordinateFns`.
    timeToCoordinate: (segundos: unknown): number =>
      vaoMs === 0
        ? 0
        : ((Number(segundos) * 1000 - limites.tsDeMs) / vaoMs) * limites.larguraPx,
  };

  const chart = {
    paneSize: () => ({ width: limites.larguraPx, height: limites.alturaPx }),
    timeScale: () => timeScale,
  };

  const series = {
    coordinateToPrice: (y: number): number =>
      limites.precoAte - (y / limites.alturaPx) * vaoPreco,
    priceToCoordinate: (preco: number): number =>
      vaoPreco === 0 ? 0 : ((limites.precoAte - preco) / vaoPreco) * limites.alturaPx,
  };

  return { chart, series, requestUpdate } as unknown as SeriesAttachedParameter<
    Time,
    SeriesType
  >;
}

/** Converte uma janela visível nos limites que o dublê de escala reproduz. */
export function limitesDaJanela(janela: VisibleWindow): LimitesDaVista {
  return {
    tsDeMs: janela.tsDe,
    tsAteMs: janela.tsAte,
    precoDe: janela.precoDe,
    precoAte: janela.precoAte,
    larguraPx: janela.larguraPx,
    alturaPx: janela.alturaPx,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Relógios injetáveis
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Relógio parado — o padrão da bancada.
 *
 * Duração interna medida sempre zero ⇒ a degradação adaptativa nunca dispara ⇒ o
 * orçamento de células fica o declarado durante as 100 repetições.
 */
export function relogioParado(): () => number {
  return () => 0;
}

/**
 * Relógio que faz cada passada **parecer** durar `msPorPassada`.
 *
 * Serve para exercitar a degradação adaptativa (requisitos 9.9 e 9.10) de forma
 * determinística, sem depender de a máquina ser lenta. Cada leitura avança
 * metade do passo, porque a camada lê o relógio duas vezes por passada — na
 * abertura e no fechamento.
 */
export function relogioQueForcaDegradacao(msPorPassada: number): () => number {
  let t = 0;
  const meio = msPorPassada / 2;
  return () => {
    const atual = t;
    t += meio;
    return atual;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A camada montada
// ═════════════════════════════════════════════════════════════════════════════

/** O que `montarCamadaDeBancada` entrega. */
export interface CamadaDeBancada {
  readonly primitive: BookmapPrimitive;
  readonly ctx: ContextoDeBancada;
  readonly alvo: CanvasRenderingTarget2D;
  /** Quantos quadros a camada pediu à biblioteca. */
  quadrosPedidos: () => number;
  zerarQuadrosPedidos: () => void;
  /**
   * Reconstrói a vista. **Fora do cronômetro** — é o `antes` de uma medição de
   * `draw()`.
   */
  prepararPassada: () => void;
  /**
   * O renderizador corrente, ou `null` quando não há conteúdo.
   *
   * Obtido depois de `prepararPassada`, e é o `draw` dele que se cronometra.
   */
  rendererCorrente: () => { draw: (alvo: CanvasRenderingTarget2D) => void } | null;
  /**
   * Uma passada completa: preparar e desenhar. Devolve `true` quando desenhou.
   *
   * ⚠️ Inclui a preparação, então **não** serve para apurar o alvo de 8 ms do
   * requisito 9.3 — para isso, `prepararPassada` em `antes` e só o `draw` dentro
   * do cronômetro. Existe para verificação e para exercitar a degradação, onde o
   * que importa é a contagem de passadas.
   */
  desenharUmaPassada: () => boolean;
}

/** Ajustes de `montarCamadaDeBancada`. */
export interface OpcoesDaCamadaDeBancada {
  /** O grid sob medição. */
  readonly grid: BookmapGrid;
  /** A janela que define o zoom — vira as escalas do dublê. */
  readonly janela: VisibleWindow;
  /** Incremento mínimo de preço do ativo. */
  readonly tickSize: number;
  /** Orçamento de células. Sem padrão interno, como a camada exige. */
  readonly maxCells: number;
  /** Dimensão mínima de célula antes de agrupar. */
  readonly minCellPx: number;
  /** Grandeza desenhada. Padrão `FILA`. */
  readonly metrica?: BookmapLayerOptions['metrica'];
  /** Curva da escala. Padrão `P99_GAMMA`. */
  readonly escala?: BookmapLayerOptions['escala'];
  /** Relógio interno da camada. Padrão: parado — ver o cabeçalho. */
  readonly relogio?: () => number;
}

/**
 * Monta uma camada anexada, com contexto e alvo de bancada, pronta para medição.
 *
 * A camada sai **anexada**: `attached` é chamado aqui, fora de qualquer
 * cronômetro, porque anexar não é o que se mede.
 */
export function montarCamadaDeBancada(opcoes: OpcoesDaCamadaDeBancada): CamadaDeBancada {
  const ctx = new ContextoDeBancada();
  const limites = limitesDaJanela(opcoes.janela);
  const alvo = criarAlvoDeBancada(ctx, limites.larguraPx, limites.alturaPx);

  let quadros = 0;
  const requestUpdate = (): void => {
    quadros += 1;
  };

  const camada: BookmapLayerOptions = {
    grid: opcoes.grid,
    metrica: opcoes.metrica ?? 'FILA',
    escala: opcoes.escala ?? 'P99_GAMMA',
    tickSize: opcoes.tickSize,
    maxCells: opcoes.maxCells,
    minCellPx: opcoes.minCellPx,
  };

  const primitive = new BookmapPrimitive(camada, opcoes.relogio ?? relogioParado());
  primitive.attached(criarParametroDeAnexacao(limites, requestUpdate));

  const rendererCorrente = (): { draw: (a: CanvasRenderingTarget2D) => void } | null => {
    const views = primitive.paneViews();
    const view = views[0];
    if (view === undefined) return null;
    const r = view.renderer();
    return r === null ? null : (r as { draw: (a: CanvasRenderingTarget2D) => void });
  };

  return {
    primitive,
    ctx,
    alvo,
    quadrosPedidos: () => quadros,
    zerarQuadrosPedidos: () => {
      quadros = 0;
    },
    prepararPassada: () => {
      primitive.updateAllViews();
    },
    rendererCorrente,
    desenharUmaPassada: (): boolean => {
      primitive.updateAllViews();
      const r = rendererCorrente();
      if (r === null) return false;
      r.draw(alvo);
      return true;
    },
  };
}
