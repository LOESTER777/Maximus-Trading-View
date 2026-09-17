/**
 * Bancada da autodesativação por exceção no desenho da camada de bookmap.
 * Spec `bookmap-no-mapa-de-decisao`, tarefa 6.3.
 *
 * **Validates: Requirements 10.5, 10.6, 10.7**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA SUÍTE EXISTE PARA IMPEDIR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exceção lançada dentro do ciclo de render da biblioteca de gráfico congela o
 * gráfico inteiro — velas, linhas de preço, marcadores e volume param junto com
 * a camada. O defeito não aparece como erro na tela: aparece como um gráfico que
 * parou de responder, e o operador não tem como saber que a culpa foi de uma
 * camada de contexto.
 *
 * Por isso a asserção central desta bancada é negativa: a passada de desenho
 * **não lança**, aconteça o que acontecer dentro dela. Todo o resto — desativar,
 * registrar, avisar, retomar — é consequência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO A FALHA É PROVOCADA, E POR QUE EM TRÊS LUGARES DIFERENTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O contexto 2D e o alvo de render são substituídos por dublês que lançam sob
 * comando. Os três pontos de falha não são variações decorativas do mesmo teste:
 * cada um exercita um trecho distinto da passada, e o comportamento correto
 * difere entre eles.
 *
 * | modo | onde lança | o que isso exercita |
 * |---|---|---|
 * | `EM_CELULA` | emissão de retângulo | o caso realista: o desenho de células falha e o de texto funciona, então o aviso chega à tela |
 * | `EM_TEXTO` | emissão de texto | o limite assumido: nem o aviso sai, e a contenção tem de valer igual |
 * | `NA_ENTRADA` | entrada no espaço de bitmap | alvo inutilizável, falha antes de qualquer forma |
 *
 * ⚠️ `EM_CELULA` é o único modo em que o plano reduzido ao aviso **não** falha —
 * e é essa assimetria que torna observável a diferença entre "desativada" e
 * "desativada e muda".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SEQUÊNCIA DE CHAMADA É A DA BIBLIOTECA, NÃO UM ATALHO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `desenharUmaPassada` reproduz a ordem real: `updateAllViews`, depois
 * `paneViews`, depois `renderer()`, e só desenha se o renderizador vier — porque
 * é assim que a camada desligada e a desanexada deixam de desenhar. Chamar
 * `draw` diretamente pularia justamente as guardas que decidem se a passada
 * acontece, e um teste que pula a guarda não vê a guarda quebrar.
 *
 * E o auxiliar **não** engole exceção: se a camada deixar algo escapar, é o
 * próprio `desenharUmaPassada` que lança, e a asserção fica vermelha em vez de
 * silenciosa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O REGISTRO DE SESSÃO É ESTADO DE MÓDULO — E ISSO EXIGE PREPARO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ O flag que garante "registrar uma única vez" vive no módulo, não na
 * instância: é o escopo de página exigido pelo requisito 10.5. Sem
 * `resetBookmapSessionWarnings()` no preparo de cada caso, o primeiro caso a
 * provocar uma falha consumiria o registro e todos os seguintes passariam ou
 * falhariam conforme a ordem de execução — o modo mais desagradável de suíte
 * instável, porque o caso vermelho não é o caso defeituoso.
 *
 * Nenhuma conexão de terminal, ordem, posição, credencial ou leitura de arquivo
 * participa desta bancada: a camada é exclusivamente visual, e os dublês aqui
 * são de canvas e de escalas de gráfico.
 *
 * Convenções: identificadores em inglês, texto de tela e comentários em pt-BR.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type { SeriesAttachedParameter, SeriesType, Time } from '@robustus/chart-core';

import { BookmapPrimitive, resetBookmapSessionWarnings } from '@robustus/charts-primitives';
import type { BookmapLayerOptions } from '@robustus/charts-primitives';
import type { BookmapGrid, CoberturaHeatmap } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Fragmentos obrigatórios do aviso (requisito 10.6)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As asserções de texto miram **fatos**, não a redação literal.
 *
 * O requisito exige duas afirmações: a camada de livro foi desativada por falha
 * de desenho, e o restante do gráfico segue operante. Comparar com a constante do
 * módulo faria o teste passar por identidade — ele concordaria com qualquer
 * redação, inclusive uma que perdesse um dos dois fatos numa revisão de texto.
 */
const FATO_DESATIVADA = 'desativada por falha de desenho';
const FATO_GRAFICO_OPERANTE = 'restante do gráfico segue operante';

/** Cor de destaque da camada: a mesma da hachura e da ressalva de cobertura. */
const AMBAR = 'rgba(245, 158, 11, 0.95)';

/** Fragmento que identifica o registro desta autodesativação no log. */
const MARCA_DO_REGISTRO = 'lançou exceção';

// ═════════════════════════════════════════════════════════════════════════════
// Dublê de contexto 2D
// ═════════════════════════════════════════════════════════════════════════════

/** Onde o dublê deve lançar. `NUNCA` é a passada saudável. */
type ModoFalha = 'NUNCA' | 'EM_CELULA' | 'EM_TEXTO' | 'NA_ENTRADA';

/** Um texto emitido, junto do estilo em vigor no momento da emissão. */
interface TextoEmitido {
  readonly texto: string;
  readonly estilo: string;
}

/**
 * Contexto 2D mínimo: só o que a passada usa, e contadores do que ela emitiu.
 *
 * Não é um canvas de verdade de propósito. O que esta bancada mede é
 * **quantidade e conteúdo** de formas — quantos retângulos, qual texto, em que
 * cor —, e um canvas real exigiria ler pixels para responder as mesmas
 * perguntas, com resultado dependente de ambiente de DOM.
 */
class FakeContext2D {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';
  textAlign = '';

  /** Retângulos preenchidos: células de fila e marcas de execução. */
  retangulos = 0;

  /** Retângulos contornados: estouro da escala. */
  contornos = 0;

  /** Textos emitidos, com o estilo de cada um. */
  textos: TextoEmitido[] = [];

  saves = 0;
  restores = 0;

  constructor(private readonly falha: () => ModoFalha) {}

  zerar(): void {
    this.retangulos = 0;
    this.contornos = 0;
    this.bolhas = [];
    this.textos = [];
    this.saves = 0;
    this.restores = 0;
    this.recortes = [];
    this.ultimoRect = null;
  }

  fillRect(): void {
    if (this.falha() === 'EM_CELULA') {
      throw new Error('falha proposital ao emitir retângulo');
    }
    this.retangulos += 1;
  }

  strokeRect(): void {
    this.contornos += 1;
  }

  fillText(texto: string): void {
    if (this.falha() === 'EM_TEXTO') {
      throw new Error('falha proposital ao emitir texto');
    }
    this.textos.push({ texto, estilo: this.fillStyle });
  }

  save(): void {
    this.saves += 1;
  }

  restore(): void {
    this.restores += 1;
  }

  setTransform(): void {
    /* sem geometria nesta bancada: as asserções são de quantidade e conteúdo */
  }

  scale(): void {
    /* idem */
  }

  beginPath(): void {}
  /**
   * Último retângulo declarado por `rect`, para o teste do recorte da bolha.
   *
   * ⚠️ Guarda o retângulo em vez de só contar chamadas: o que importa provar é a
   * ÁREA recortada, não que alguém chamou `clip`. Recortar contra o retângulo
   * errado passaria num teste de contagem e continuaria vazando na tela.
   */
  ultimoRect: { x: number; y: number; w: number; h: number } | null = null;
  rect(x?: number, y?: number, w?: number, h?: number): void {
    this.ultimoRect = { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 };
  }
  /** Recortes aplicados, cada um com o retângulo em vigor no momento. */
  recortes: Array<{ x: number; y: number; w: number; h: number }> = [];
  clip(): void {
    if (this.ultimoRect !== null) this.recortes.push({ ...this.ultimoRect });
  }
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  /**
   * Bolhas de execução: raio, cor e CENTRO de cada uma, na ordem de emissão.
   *
   * O centro entra porque o defeito de 04/09/2026 era de POSIÇÃO, não de
   * tamanho — bolha centrada na última coluna do painel transbordando sobre a
   * escala de preço. Sem `cx`, o teste não distingue "dentro" de "fora".
   */
  bolhas: Array<{ raio: number; estilo: string; cx: number; cy: number }> = [];
  arc(cx: number, cy: number, raio: number): void {
    this.bolhas.push({ raio, estilo: this.fillStyle, cx, cy });
  }
  fill(): void {}
}

const LARGURA_PX = 800;
const ALTURA_PX = 400;

/**
 * Alvo de render que reproduz o contrato real da biblioteca de canvas.
 *
 * ⚠️ O par salvar/restaurar fica num bloco de encerramento, **como no original**.
 * É essa fidelidade que permite a esta bancada afirmar algo sobre o estado do
 * contexto depois de uma passada interrompida: um dublê que só restaurasse no
 * caminho felizmente concluído inventaria um desequilíbrio que a biblioteca real
 * não tem, e o teste passaria a medir o dublê.
 */
function criarAlvo(ctx: FakeContext2D, falha: () => ModoFalha): CanvasRenderingTarget2D {
  const alvo = {
    useBitmapCoordinateSpace<T>(f: (scope: unknown) => T): T {
      if (falha() === 'NA_ENTRADA') {
        throw new Error('falha proposital ao entrar no espaço de bitmap');
      }
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
// Dublê de grid e de escalas do gráfico
// ═════════════════════════════════════════════════════════════════════════════

/** Início do dia de referência, em epoch ms. Valor fixo: nada aqui usa relógio. */
const T0_MS = 1_756_000_000_000;

const BALDE_SEG = 60;
const TICK_SIZE = 5;
const PRECO_BASE = 100_000;

const COBERTURA_COMPLETA: CoberturaHeatmap = {
  classe: 'COMPLETA',
  observacao: null,
  filaDeMs: T0_MS,
  filaAteMs: T0_MS + 120_000,
  execDeMs: T0_MS,
  execAteMs: T0_MS + 120_000,
};

/**
 * Grid pequeno com fila nos dois lados em três baldes e três níveis de preço.
 *
 * Pequeno de propósito: a bancada precisa que a passada saudável emita **alguma**
 * célula, e não que ela seja realista em volume. Um grid grande adicionaria
 * agrupamento por zoom à conversa, que é assunto de outra suíte.
 */
function criarGrid(): BookmapGrid {
  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-24',
    baldeSeg: BALDE_SEG,
    times: Float64Array.from([T0_MS, T0_MS + 60_000, T0_MS + 120_000]),
    prices: Float64Array.from([PRECO_BASE, PRECO_BASE + TICK_SIZE, PRECO_BASE + 2 * TICK_SIZE]),
    ti: Uint32Array.from([0, 1, 2]),
    pi: Uint32Array.from([0, 1, 2]),
    bid: Float32Array.from([120, 240, 360]),
    ask: Float32Array.from([90, 180, 270]),
    buy: Float32Array.from([0, 0, 0]),
    sell: Float32Array.from([0, 0, 0]),
    cobertura: COBERTURA_COMPLETA,
  };
}

const PRECO_TOPO = PRECO_BASE + 2 * TICK_SIZE;
const TS_ATE_MS = T0_MS + 120_000;

/**
 * Escalas do gráfico, lineares e sem estado.
 *
 * A coordenada zero é o topo do painel, logo o preço maior — a mesma convenção da
 * biblioteca. Inverter as duas pontas produziria janela vazia e a camada
 * simplesmente não apareceria, sem erro, que é o tipo de dublê errado difícil de
 * diagnosticar depois.
 */
function criarParametroDeAnexacao(
  requestUpdate: () => void,
): SeriesAttachedParameter<Time, SeriesType> {
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

  return { chart, series, requestUpdate } as unknown as SeriesAttachedParameter<Time, SeriesType>;
}

// ═════════════════════════════════════════════════════════════════════════════
// A bancada
// ═════════════════════════════════════════════════════════════════════════════

interface Bancada {
  readonly primitive: BookmapPrimitive;
  readonly ctx: FakeContext2D;
  readonly alvo: CanvasRenderingTarget2D;
  /** Arma ou desarma a falha proposital da próxima passada. */
  armar: (modo: ModoFalha) => void;
  /** Quantos quadros a camada pediu à biblioteca. */
  quadrosPedidos: () => number;
  zerarQuadrosPedidos: () => void;
  /**
   * Uma passada completa, na ordem da biblioteca.
   *
   * Devolve `true` quando o renderizador existia e desenhou. **Não** captura
   * exceção: se a camada deixar algo escapar, este auxiliar lança.
   */
  desenharUmaPassada: () => boolean;
  /** O renderizador corrente, para o caso da referência retida pela biblioteca. */
  rendererCorrente: () => { draw: (alvo: CanvasRenderingTarget2D) => void } | null;
  readonly grid: BookmapGrid;
}

const OPCOES_BASE: Omit<BookmapLayerOptions, 'grid'> = {
  // `FILA` mantém a passada no essencial: sem marca de execução e sem hachura,
  // os retângulos contados são exclusivamente células de fila.
  metrica: 'FILA',
  escala: 'P99_GAMMA',
  tickSize: TICK_SIZE,
  maxCells: 3000,
  minCellPx: 3,
};

/**
 * @param gridExtra Sobrepõe colunas do grid da bancada. Existe para os casos de
 *   EXECUÇÃO: o grid padrão tem `buy`/`sell` zerados de propósito (a suíte
 *   original mede só fila), e sem execução nenhuma marca — barra ou bolha — tem
 *   o que desenhar.
 */
function montarBancada(
  opcoes?: Partial<BookmapLayerOptions>,
  gridExtra?: Partial<BookmapGrid>,
): Bancada {
  let modo: ModoFalha = 'NUNCA';
  const ctx = new FakeContext2D(() => modo);
  const alvo = criarAlvo(ctx, () => modo);
  const grid = { ...criarGrid(), ...(gridExtra ?? {}) };

  let quadros = 0;
  const requestUpdate = (): void => {
    quadros += 1;
  };

  // Relógio parado: a degradação adaptativa do orçamento reduz o teto quando a
  // mediana das passadas estoura o alvo, e uma duração medida de verdade tornaria
  // esta suíte dependente da velocidade da máquina. Com duração zero a degradação
  // nunca dispara e o que sobra na tela é só o que a tarefa 6.3 decide.
  const primitive = new BookmapPrimitive({ grid, ...OPCOES_BASE, ...opcoes }, () => 0);
  primitive.attached(criarParametroDeAnexacao(requestUpdate));

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
    grid,
    armar: (m: ModoFalha) => {
      modo = m;
    },
    quadrosPedidos: () => quadros,
    zerarQuadrosPedidos: () => {
      quadros = 0;
    },
    rendererCorrente,
    // ⚠️ TODAS as views, e não só a primeira: a camada tem duas desde que o motor foi
    // corrigido (o bookmap era desenhado em cima do volume). O heatmap ficou em
    // `zOrder: 'bottom'`, ANTES das velas, e a legenda foi para `'top'` para continuar
    // legível. Estas bancadas afirmam o TEXTO — inspecionar só a primeira view mediria
    // um quadro que o motor nunca produz.
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

/** Os textos emitidos, sem a duplicata de sombra que o desenho de texto faz. */
function textosVisiveis(ctx: FakeContext2D): readonly TextoEmitido[] {
  // O desenho emite cada linha duas vezes, deslocada, para legibilidade sobre
  // fundo variável. A sombra usa estilo próprio; a leitura de conteúdo e de cor
  // interessa na cópia de frente.
  return ctx.textos.filter((t) => t.estilo !== 'rgba(0, 0, 0, 0.65)');
}

function textoJunto(ctx: FakeContext2D): string {
  return textosVisiveis(ctx)
    .map((t) => t.texto)
    .join(' \n ');
}

/** O aviso de autodesativação está na tela? */
function temAviso(ctx: FakeContext2D): boolean {
  const tudo = textoJunto(ctx);
  return tudo.includes(FATO_GRAFICO_OPERANTE);
}

describe('BookmapPrimitive — autodesativação por exceção no desenho (tarefa 6.3)', () => {
  let avisoDoLog: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    // ⚠️ Obrigatório: o registro "uma única vez" é estado de módulo e atravessaria
    // casos de teste. Ver o cabeçalho.
    resetBookmapSessionWarnings();
    avisoDoLog = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Quantas vezes a autodesativação foi registrada. Ignora outros avisos. */
  const registros = (): number =>
    avisoDoLog.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes(MARCA_DO_REGISTRO),
    ).length;

  // ───────────────────────────────────────────────────────────────────────────
  // A passada saudável, para haver com o que comparar
  // ───────────────────────────────────────────────────────────────────────────

  describe('a passada saudável — a referência das demais asserções', () => {
    it('desenha células e legenda, sem aviso e sem registro', () => {
      const b = montarBancada();

      expect(b.desenharUmaPassada()).toBe(true);

      // Se isto for zero, o dublê de escalas está errado e as asserções de
      // "zero células" abaixo passariam por vacuidade — o pior tipo de verde.
      expect(b.ctx.retangulos).toBeGreaterThan(0);
      expect(textoJunto(b.ctx)).toContain('Livro');
      expect(temAviso(b.ctx)).toBe(false);
      expect(registros()).toBe(0);
    });

    it('a legenda saudável sai na cor neutra, não em âmbar', () => {
      const b = montarBancada();
      b.desenharUmaPassada();

      const legenda = textosVisiveis(b.ctx).filter((t) => t.texto.startsWith('Livro'));
      expect(legenda.length).toBeGreaterThan(0);
      for (const linha of legenda) expect(linha.estilo).not.toBe(AMBAR);
    });

    it('o par salvar/restaurar do alvo fecha na passada saudável', () => {
      const b = montarBancada();
      b.desenharUmaPassada();

      expect(b.ctx.saves).toBe(b.ctx.restores);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 10.5
  // ───────────────────────────────────────────────────────────────────────────

  describe('requisito 10.5 — a exceção é contida e a camada desativa na primeira', () => {
    it('a exceção não escapa da passada de desenho', () => {
      const b = montarBancada();
      b.armar('EM_CELULA');

      expect(() => b.desenharUmaPassada()).not.toThrow();
    });

    it('desativa já na primeira exceção, sem tolerar a segunda', () => {
      const b = montarBancada();
      b.armar('EM_CELULA');
      b.desenharUmaPassada();

      // A passada seguinte é a evidência: se a camada tolerasse a primeira falha,
      // ela voltaria a tentar desenhar células.
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(b.ctx.retangulos).toBe(0);
      expect(temAviso(b.ctx)).toBe(true);
    });

    it('o par salvar/restaurar fecha mesmo com a passada interrompida', () => {
      const b = montarBancada();
      b.armar('EM_CELULA');
      b.ctx.zerar();
      b.desenharUmaPassada();

      // Contexto desequilibrado deslocaria a geometria de quem desenha depois —
      // que é o gráfico inteiro.
      expect(b.ctx.saves).toBe(b.ctx.restores);
    });

    it('falha na entrada do espaço de bitmap também é contida', () => {
      const b = montarBancada();
      b.armar('NA_ENTRADA');

      expect(() => b.desenharUmaPassada()).not.toThrow();
      expect(registros()).toBe(1);
    });

    it('falha no desenho de texto também é contida — o limite assumido', () => {
      const b = montarBancada();
      b.armar('EM_TEXTO');

      // O aviso viaja pelo mesmo canvas que falhou: com o texto quebrado ele não
      // aparece. A garantia principal, ainda assim, vale.
      expect(() => b.desenharUmaPassada()).not.toThrow();
      b.ctx.zerar();
      expect(() => b.desenharUmaPassada()).not.toThrow();
      expect(temAviso(b.ctx)).toBe(false);
      expect(b.ctx.retangulos).toBe(0);
    });

    it('valor lançado sem conversão em texto não escapa do tratamento', () => {
      const b = montarBancada();
      // `throw` aceita qualquer coisa, e a conversão em texto de um símbolo lança
      // por definição. Uma exceção dentro do tratamento chegaria ao gráfico
      // exatamente pela porta que o tratamento existe para fechar.
      b.ctx.fillRect = (): void => {
        throw Symbol('sem conversão em texto');
      };

      expect(() => b.desenharUmaPassada()).not.toThrow();
      expect(registros()).toBe(1);
    });

    it('objeto com conversão própria que lança não escapa do tratamento', () => {
      const b = montarBancada();
      const hostil = {
        get message(): string {
          throw new Error('leitura de motivo hostil');
        },
        toString(): string {
          throw new Error('conversão hostil');
        },
      };
      b.ctx.fillRect = (): void => {
        throw hostil;
      };

      expect(() => b.desenharUmaPassada()).not.toThrow();
      expect(registros()).toBe(1);
    });

    it('o registro identifica a camada, a falha e que o gráfico segue', () => {
      const b = montarBancada();
      b.armar('EM_CELULA');
      b.desenharUmaPassada();

      const linha = avisoDoLog.mock.calls
        .map((args) => args[0])
        .find((a): a is string => typeof a === 'string' && a.includes(MARCA_DO_REGISTRO));

      expect(linha).toBeDefined();
      expect(linha).toContain('camada de livro');
      expect(linha).toContain(FATO_GRAFICO_OPERANTE);
    });

    it('registra uma única vez, mesmo com muitas passadas e muitas falhas', () => {
      const b = montarBancada();
      b.armar('EM_TEXTO'); // falha em toda passada, inclusive na do aviso
      for (let i = 0; i < 12; i += 1) b.desenharUmaPassada();

      expect(registros()).toBe(1);
    });

    it('o registro é de sessão: outra instância desativa sem nova linha', () => {
      const primeira = montarBancada();
      primeira.armar('EM_CELULA');
      primeira.desenharUmaPassada();
      expect(registros()).toBe(1);

      // O gráfico remonta a cada troca de timeframe, com camada nova. Registrar de
      // novo transformaria o aviso em ruído — que é a forma prática de ele deixar
      // de ser lido.
      const segunda = montarBancada();
      segunda.armar('EM_CELULA');
      segunda.desenharUmaPassada();

      expect(registros()).toBe(1);

      // Mas a camada nova **se desativa**: o registro é que é uma vez, não o
      // comportamento.
      segunda.ctx.zerar();
      segunda.desenharUmaPassada();
      expect(segunda.ctx.retangulos).toBe(0);
      expect(temAviso(segunda.ctx)).toBe(true);
    });

    it('zerar os registros de sessão libera uma nova linha', () => {
      const primeira = montarBancada();
      primeira.armar('EM_TEXTO');
      primeira.desenharUmaPassada();
      expect(registros()).toBe(1);

      // O intervalo do requisito 10.5 termina no recarregamento da página, e
      // depois dele **tudo** é novo: o registro de sessão e as camadas. Zerar só o
      // registro, mantendo a mesma camada já desativada, seria um estado que não
      // existe em produção.
      resetBookmapSessionWarnings();
      const segunda = montarBancada();
      segunda.armar('EM_TEXTO');
      segunda.desenharUmaPassada();

      expect(registros()).toBe(2);
    });

    it('exceção repetida na mesma desativação não chega ao registro', () => {
      const b = montarBancada();
      b.armar('EM_TEXTO'); // falha em toda passada, inclusive na do aviso
      b.desenharUmaPassada();
      expect(registros()).toBe(1);

      // Zerar o registro de sessão no meio da desativação **não** libera linha
      // nova: quem barra aqui é a guarda de transição, não o flag de sessão. Sem
      // esta asserção os dois travamentos ficariam indistinguíveis, e remover um
      // deles passaria despercebido.
      const antes = registros();
      resetBookmapSessionWarnings();
      for (let i = 0; i < 6; i += 1) b.desenharUmaPassada();

      expect(registros()).toBe(antes);
    });

    it('pede exatamente um quadro por autodesativação, sem laço', () => {
      const b = montarBancada();
      b.armar('EM_TEXTO'); // toda passada falha, inclusive a do aviso
      b.zerarQuadrosPedidos();

      for (let i = 0; i < 5; i += 1) b.desenharUmaPassada();

      // Pedir quadro a cada exceção desenharia um laço: quadro novo, exceção nova,
      // quadro novo. O pedido acontece só na transição.
      expect(b.quadrosPedidos()).toBe(1);
    });

    it('desanexada, a passada em curso não desativa nem registra', () => {
      const b = montarBancada();
      // A biblioteca pode manter a referência do renderizador durante o quadro em
      // curso; desanexar no meio dele não deve produzir efeito nenhum.
      const r = b.rendererCorrente();
      expect(r).not.toBeNull();

      b.primitive.detached();
      b.armar('EM_CELULA');

      expect(() => r?.draw(b.alvo)).not.toThrow();
      expect(registros()).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 10.6
  // ───────────────────────────────────────────────────────────────────────────

  describe('requisito 10.6 — enquanto desativada: aviso em pt-BR e zero células', () => {
    /** Deixa a camada autodesativada com o caminho de texto intacto. */
    function bancadaDesativada(): Bancada {
      const b = montarBancada();
      b.armar('EM_CELULA');
      b.desenharUmaPassada();
      b.armar('NUNCA');
      b.ctx.zerar();
      b.desenharUmaPassada();
      return b;
    }

    it('mantém em zero a quantidade de células desenhadas', () => {
      const b = bancadaDesativada();

      expect(b.ctx.retangulos).toBe(0);
      expect(b.ctx.contornos).toBe(0);
    });

    it('exibe o aviso em pt-BR com os dois fatos obrigatórios', () => {
      const b = bancadaDesativada();
      const tudo = textoJunto(b.ctx);

      expect(tudo).toContain(FATO_DESATIVADA);
      expect(tudo).toContain(FATO_GRAFICO_OPERANTE);
    });

    it('o aviso diz como retomar, para o caminho existir fora do código', () => {
      const b = bancadaDesativada();

      expect(textoJunto(b.ctx)).toContain('religue a chave do livro');
    });

    it('o aviso sai em âmbar, distinto da legenda normal', () => {
      const b = bancadaDesativada();
      const linhas = textosVisiveis(b.ctx);

      expect(linhas.length).toBeGreaterThan(0);
      for (const linha of linhas) expect(linha.estilo).toBe(AMBAR);
    });

    it('não mantém o rodapé de cobertura, que fala de outro assunto', () => {
      // ⚠️ `mostrarDiagnostico: true` é o ÚNICO ajuste feito nesta suíte herdada,
      // e é na guarda de vacuidade, não na asserção que o caso mede. O rodapé de
      // cobertura passou a ser canal de DIAGNÓSTICO, desligado por omissão — ele
      // era um dos textos que poluíam a tela do playground. Sem a opção aqui, a
      // guarda abaixo passaria a falhar por ausência do rodapé em vez de provar
      // que ele existe na passada normal, e o caso perderia o poder de
      // distinguir. A asserção do caso — o estado autodesativado NÃO repete o
      // rodapé — segue medida com as opções de omissão.
      const saudavel = montarBancada({ mostrarDiagnostico: true });
      saudavel.desenharUmaPassada();
      const rodapeSaudavel = textoJunto(saudavel.ctx);
      // Confirma que o rodapé existe na passada normal, senão a asserção abaixo
      // não distinguiria nada.
      expect(rodapeSaudavel).toMatch(/BRT|cobertura/i);

      const b = bancadaDesativada();
      expect(textoJunto(b.ctx)).not.toMatch(/BRT|cobertura/i);
    });

    it('o aviso persiste nas passadas seguintes e não se apaga a si mesmo', () => {
      const b = bancadaDesativada();

      // A passada do aviso conclui sem exceção — só desenha texto. Se isso valesse
      // como evidência, o aviso desapareceria no quadro seguinte à falha e o
      // operador ficaria com a camada muda.
      for (let i = 0; i < 4; i += 1) {
        b.ctx.zerar();
        b.desenharUmaPassada();
        expect(temAviso(b.ctx)).toBe(true);
        expect(b.ctx.retangulos).toBe(0);
      }
    });

    it('camada desligada não avisa: sem grid, não há o que desenhar', () => {
      const b = bancadaDesativada();
      b.primitive.update({ grid: null });
      b.ctx.zerar();

      expect(b.desenharUmaPassada()).toBe(false);
      expect(b.ctx.textos).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requisito 10.7
  // ───────────────────────────────────────────────────────────────────────────

  describe('requisito 10.7 — reabilitar retoma; o aviso sai por evidência', () => {
    /** Autodesativa e devolve a bancada com o caminho de texto intacto. */
    function bancadaDesativada(): Bancada {
      const b = montarBancada();
      b.armar('EM_CELULA');
      b.desenharUmaPassada();
      b.armar('NUNCA');
      return b;
    }

    /** Desliga e religa a chave do livro, como a página faz. */
    function religar(b: Bancada): void {
      b.primitive.update({ grid: null });
      b.primitive.update({ grid: b.grid });
    }

    it('religar a chave retoma as passadas de desenho', () => {
      const b = bancadaDesativada();
      religar(b);
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(b.ctx.retangulos).toBeGreaterThan(0);
    });

    it('o aviso NÃO sai no ato de religar — intenção não é evidência', () => {
      const b = bancadaDesativada();
      religar(b);
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(temAviso(b.ctx)).toBe(true);
    });

    it('no intervalo de nova tentativa o texto não afirma estar desativada', () => {
      const b = bancadaDesativada();
      religar(b);
      b.ctx.zerar();
      b.desenharUmaPassada();

      const tudo = textoJunto(b.ctx);
      // A camada está desenhando: repetir "camada desativada" seria afirmação
      // falsa sobre o que está na tela.
      expect(tudo).toContain('nova tentativa');
      expect(tudo).not.toContain(FATO_DESATIVADA);
      expect(tudo).toContain(FATO_GRAFICO_OPERANTE);
    });

    it('passada que só desenha o aviso não conta como evidência', () => {
      const b = bancadaDesativada();

      // O gráfico redesenha várias vezes enquanto a camada está desativada, e
      // essas passadas concluem sem exceção — mas desenham apenas texto. Elas não
      // exercitam o caminho que falhou, logo não provam que ele voltou.
      for (let i = 0; i < 3; i += 1) b.desenharUmaPassada();

      religar(b);
      b.ctx.zerar();
      b.desenharUmaPassada();

      // Se aquelas passadas valessem como evidência, o operador voltaria a uma
      // tela sem aviso nenhum, com a falha ainda não desmentida por nada.
      expect(temAviso(b.ctx)).toBe(true);
      expect(textoJunto(b.ctx)).toContain('nova tentativa');
    });

    it('o aviso sai depois de uma passada concluir sem exceção', () => {
      const b = bancadaDesativada();
      religar(b);

      // Primeira passada: desenha e produz a evidência.
      b.desenharUmaPassada();
      // Segunda: já sem aviso.
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(temAviso(b.ctx)).toBe(false);
      expect(b.ctx.retangulos).toBeGreaterThan(0);
    });

    it('dado novo com a camada ligada não retoma sozinho', () => {
      const b = bancadaDesativada();
      // Reconsulta periódica: grid presente nas duas pontas. Retomar aqui
      // reabilitaria a camada a cada minuto, contra o requisito 10.6, que manda a
      // desativação permanecer até o operador agir.
      b.primitive.update({ grid: criarGrid() });
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(b.ctx.retangulos).toBe(0);
      expect(temAviso(b.ctx)).toBe(true);
      expect(textoJunto(b.ctx)).toContain(FATO_DESATIVADA);
    });

    it('reanexar também retoma, para a série recriada sem desmontar', () => {
      const b = bancadaDesativada();
      b.primitive.detached();
      b.primitive.attached(criarParametroDeAnexacao(() => {}));
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(b.ctx.retangulos).toBeGreaterThan(0);
      // O aviso continua: reanexar é intenção, e a evidência ainda não existia
      // quando o plano desta passada foi montado.
      expect(temAviso(b.ctx)).toBe(true);
    });

    it('volta a se autodesativar se a exceção se repetir', () => {
      const b = bancadaDesativada();
      religar(b);
      b.armar('EM_CELULA');

      expect(() => b.desenharUmaPassada()).not.toThrow();

      b.armar('NUNCA');
      b.ctx.zerar();
      b.desenharUmaPassada();

      expect(b.ctx.retangulos).toBe(0);
      expect(textoJunto(b.ctx)).toContain(FATO_DESATIVADA);
    });

    it('a segunda autodesativação avisa de novo, sem nova linha de registro', () => {
      const b = bancadaDesativada();
      expect(registros()).toBe(1);

      // Ciclo completo: religar, ver a camada voltar, ver o aviso sair.
      religar(b);
      b.desenharUmaPassada();
      b.ctx.zerar();
      b.desenharUmaPassada();
      expect(temAviso(b.ctx)).toBe(false);

      // E falhar outra vez.
      b.armar('EM_CELULA');
      b.desenharUmaPassada();
      b.armar('NUNCA');
      b.ctx.zerar();
      b.desenharUmaPassada();

      // O aviso na tela é estado e reaparece; o registro é evento e não repete.
      expect(temAviso(b.ctx)).toBe(true);
      expect(registros()).toBe(1);
    });

    it('o ciclo inteiro nunca deixa exceção escapar', () => {
      const b = montarBancada();
      const modos: readonly ModoFalha[] = ['EM_CELULA', 'NUNCA', 'NA_ENTRADA', 'EM_TEXTO', 'NUNCA'];

      expect(() => {
        for (const modo of modos) {
          b.armar(modo);
          b.desenharUmaPassada();
          b.primitive.update({ grid: null });
          b.primitive.update({ grid: b.grid });
          b.desenharUmaPassada();
        }
      }).not.toThrow();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Marca de execução em BOLHA — raio pelo volume, cor pelo agressor
// ═════════════════════════════════════════════════════════════════════════════
//
// Pedido do operador em 03/09/2026: *"nosso bookmap está parecendo um lego, não
// deveria ter visão de bolhas maiores, menores e cores distinguindo quem está
// mandando?"*. A barra cinza original respondia "houve negócio aqui"; não
// respondia "de que tamanho" nem "quem estava agredindo".
//
// ⚠️ O que estes casos protegem, e que é fácil quebrar sem perceber:
//   1. omitir `marcaExec` continua desenhando BARRA — é o que mantém as demais
//      bancadas (que não informam a opção) medindo o mesmo que antes;
//   2. `FILA` não desenha execução em forma alguma;
//   3. a cor sai do LADO AGRESSOR, não do lado do livro.

/**
 * Execução variada nos três baldes: um lado dominando em cada um, com volumes
 * diferentes — é o que permite verificar tamanho E cor.
 */
const GRID_COM_EXEC: Partial<BookmapGrid> = {
  buy: Float32Array.from([500, 40, 2_000]),
  sell: Float32Array.from([30, 900, 15]),
};

describe('BookmapPrimitive — marca de execução em bolha', () => {
  it('sem `marcaExec`, mantém a barra: nenhuma bolha é emitida', () => {
    const b = montarBancada({ metrica: 'AMBAS' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.bolhas).toHaveLength(0);
    // A barra é retângulo, e há retângulo de fila também — o que importa aqui é
    // a ausência de círculo.
    expect(b.ctx.retangulos).toBeGreaterThan(0);
  });

  it('com `marcaExec: BOLHA`, emite círculos em vez de barras', () => {
    const b = montarBancada({ metrica: 'AMBAS', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.bolhas.length).toBeGreaterThan(0);
  });

  it('a métrica FILA não desenha execução — nem barra, nem bolha', () => {
    const b = montarBancada({ metrica: 'FILA', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.bolhas).toHaveLength(0);
  });

  it('o raio fica dentro dos limites e a cor é a do agressor', () => {
    const b = montarBancada({ metrica: 'EXECUCAO', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);

    expect(b.ctx.bolhas.length).toBeGreaterThan(0);
    for (const bolha of b.ctx.bolhas) {
      // Raio em pixels de bitmap: piso 4, teto 18 em pixels lógicos, e a bancada
      // usa razão de pixel 1.
      //
      // ⚠️ O piso é 4 e não 2 porque 2 px não se lê como círculo — vira ponto.
      // E a normalização parte de ZERO (não do p50), senão METADE das células
      // cai no piso por definição de percentil. Os dois defeitos foram medidos
      // na tela em 03/09/2026.
      expect(bolha.raio).toBeGreaterThanOrEqual(4);
      expect(bolha.raio).toBeLessThanOrEqual(18);
      expect(Number.isFinite(bolha.raio)).toBe(true);
      // Verde (34, 197, 94) = comprador agredindo · vermelho (239, 68, 68) =
      // vendedor. Cinza — a cor da barra — não pode aparecer numa bolha.
      expect(bolha.estilo).toMatch(/rgba\((34, 197, 94|239, 68, 68), /);
      expect(bolha.estilo).not.toContain('226, 232, 240');
    }
  });

  it('bolhas de tamanhos diferentes aparecem quando os volumes diferem', () => {
    const b = montarBancada({ metrica: 'EXECUCAO', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    b.desenharUmaPassada();
    const raios = new Set(b.ctx.bolhas.map((x) => Math.round(x.raio * 100)));
    // O grid da bancada tem execução variada; se todos os raios fossem iguais, o
    // volume não estaria sendo codificado — que é justamente o defeito da barra.
    expect(raios.size).toBeGreaterThan(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O defeito medido na tela em 04/09/2026: bolha por cima da escala de preço
// ═════════════════════════════════════════════════════════════════════════════
//
// Relato do operador: *"não dá para ver os agressores, tem de vir mais para a
// esquerda, sem ficar em cima dos preços ou das labels, tinha de ficar próximo
// às barras"*.
//
// A causa era o encadeamento de três decisões, cada uma correta em isolado:
// `clipAxis` EMPURRA para dentro a célula que toca a borda direita; o centro da
// bolha sai da célula JÁ recortada; e o raio vai a 18 px sem relação com a
// largura da célula. Resultado: bolha centrada na última coluna transbordando
// ~18 px sobre a escala de preço e os rótulos das linhas.
//
// ⚠️ O comentário do código afirmava que "o recorte do canvas impede que ela
// vaze" — e NÃO HAVIA recorte. Estes testes existem para que a afirmação passe a
// ser verificada, e não apenas escrita.
describe('BookmapPrimitive — a bolha não invade a escala de preço', () => {
  it('recorta à área de plotagem antes de emitir bolha', () => {
    const b = montarBancada({ metrica: 'AMBAS', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.bolhas.length).toBeGreaterThan(0);

    // O recorte tem de cobrir a área de plotagem inteira e NÃO mais que ela: um
    // retângulo maior não protegeria a escala; um menor cortaria bolha legítima.
    const daArea = b.ctx.recortes.filter(
      (r) => r.x === 0 && r.y === 0 && r.w === LARGURA_PX && r.h === ALTURA_PX,
    );
    expect(daArea.length).toBeGreaterThan(0);
  });

  it('sem geometria de painel no plano, desenha sem recortar (bancadas seguem válidas)', () => {
    // Sem execução não há bolha, logo não há recorte de bolha — e a passada
    // continua saudável. É o caminho de quem monta o plano sem geometria.
    const b = montarBancada({ metrica: 'FILA', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);
    expect(b.ctx.bolhas).toHaveLength(0);
    const daArea = b.ctx.recortes.filter((r) => r.w === LARGURA_PX && r.h === ALTURA_PX);
    expect(daArea).toHaveLength(0);
  });

  it('o par salvar/restaurar do recorte fecha na passada saudável', () => {
    const b = montarBancada({ metrica: 'AMBAS', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    b.desenharUmaPassada();
    // Desequilíbrio deixaria o RECORTE em vigor para o resto do gráfico — o
    // gráfico inteiro passaria a desenhar cortado.
    expect(b.ctx.saves).toBe(b.ctx.restores);
  });

  it('o par fecha mesmo com a passada interrompida', () => {
    const b = montarBancada({ metrica: 'AMBAS', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.armar('EM_CELULA');
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(b.ctx.saves).toBe(b.ctx.restores);
  });

  it('nenhum centro de bolha cai fora da área de plotagem', () => {
    const b = montarBancada({ metrica: 'AMBAS', marcaExec: 'BOLHA' }, GRID_COM_EXEC);
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(b.ctx.bolhas.length).toBeGreaterThan(0);
    for (const bolha of b.ctx.bolhas) {
      expect(bolha.cx).toBeGreaterThanOrEqual(0);
      expect(bolha.cx).toBeLessThanOrEqual(LARGURA_PX);
      expect(bolha.cy).toBeGreaterThanOrEqual(0);
      expect(bolha.cy).toBeLessThanOrEqual(ALTURA_PX);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O defeito medido na tela: metade das bolhas no raio mínimo
// ═════════════════════════════════════════════════════════════════════════════
//
// Em 03/09/2026 o operador reportou "só aparece umas objetos sem definição na
// tela". A causa não era o dado nem a cor: a primeira versão de `raioDaBolha`
// normalizava de `p50` a `p99`, e **por definição de percentil metade das
// células fica abaixo do p50** — logo metade recebia o piso, que então era 2 px.
// Com os percentis da tela dele (exec p50 141 ct, p99 1.169 ct), toda execução
// até 141 contratos virava um ponto.
//
// Este caso trava a correção: quantidade PEQUENA, bem abaixo do p50 da amostra,
// tem de produzir bolha visivelmente maior que o piso.

describe('BookmapPrimitive — bolha pequena não colapsa no piso', () => {
  it('execução muito abaixo do p50 ainda gera bolha legível, e maior que o piso', () => {
    // Amostra com um valor dominante alto e vários baixos: o p50 fica alto e as
    // células pequenas seriam as vítimas do defeito antigo.
    const b = montarBancada(
      { metrica: 'EXECUCAO', marcaExec: 'BOLHA' },
      {
        buy: Float32Array.from([30, 200, 4_000]),
        sell: Float32Array.from([25, 150, 10]),
      },
    );
    b.ctx.zerar();
    expect(b.desenharUmaPassada()).toBe(true);

    const raios = b.ctx.bolhas.map((x) => x.raio).sort((x, y) => x - y);
    expect(raios.length).toBeGreaterThan(1);

    const menor = raios[0] as number;
    const maior = raios[raios.length - 1] as number;

    // A menor bolha tem de ser MAIOR que o piso — se estiver exatamente no piso,
    // a normalização voltou a jogar as células pequenas para o mínimo.
    expect(menor).toBeGreaterThan(4);
    // E a maior tem de ser sensivelmente maior que a menor: é o que prova que o
    // volume está sendo codificado, e não apenas a presença de negócio.
    expect(maior).toBeGreaterThan(menor * 1.3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O terceiro relato do mesmo dia: "como que lê isso?"
// ═════════════════════════════════════════════════════════════════════════════
//
// Depois de o recorte pôr as bolhas junto das velas, elas apareceram **fundidas
// numa corrente contínua**. A aritmética: balde de 60 s, raio até 18 px — 36 px
// de diâmetro — e cada minuto recebendo 3 a 4 px de largura com o dia comprimido.
// Bolhas espaçadas de 3 px com 36 px de diâmetro se sobrepõem dez vezes, e o
// contorno escuro não separa dez camadas.
//
// O teto do raio passa a ser a largura da célula (`raioMaximoPorEspaco`): centros
// a `w` de distância com raio `w` se sobrepõem em 50%, e cada centro continua
// visível. Quando o teto encosta no piso, o volume deixa de ser codificado — e a
// legenda DIZ isso, em vez de deixar o operador ler grandeza onde não há.
describe('BookmapPrimitive — a bolha não se funde em corrente', () => {
  /**
   * Anexação com janela de tempo `fator`× mais larga que a da bancada padrão.
   *
   * `fator = 1` reproduz a bancada (balde de 60 s ocupando 400 px);
   * `fator = 200` comprime o mesmo grid a poucos pixels, que é o caso do relato.
   */
  function anexacaoComJanela(
    requestUpdate: () => void,
    fator: number,
  ): SeriesAttachedParameter<Time, SeriesType> {
    const ateMs = T0_MS + (TS_ATE_MS - T0_MS) * fator;
    const timeScale = {
      getVisibleRange: () => ({ from: T0_MS / 1000, to: ateMs / 1000 }),
      timeToCoordinate: (segundos: unknown): number =>
        ((Number(segundos) * 1000 - T0_MS) / (ateMs - T0_MS)) * LARGURA_PX,
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
    return { chart, series, requestUpdate } as unknown as SeriesAttachedParameter<Time, SeriesType>;
  }

  /** Desenha uma passada com a janela pedida e devolve o contexto observado. */
  function desenharComJanela(fator: number): FakeContext2D {
    const ctx = new FakeContext2D(() => 'NUNCA');
    const alvo = criarAlvo(ctx, () => 'NUNCA');
    const grid = { ...criarGrid(), ...GRID_COM_EXEC };
    const primitive = new BookmapPrimitive(
      { grid, ...OPCOES_BASE, metrica: 'AMBAS', marcaExec: 'BOLHA' },
      () => 0,
    );
    primitive.attached(anexacaoComJanela(() => undefined, fator));
    primitive.updateAllViews();
    ctx.zerar();
    // Todas as views (heatmap em `bottom`, legenda em `top`) — ver a nota em
    // `desenharUmaPassada`: este teste também lê texto (o aviso de zoom apertado).
    for (const view of primitive.paneViews()) {
      const r = view.renderer() as { draw: (a: CanvasRenderingTarget2D) => void } | null;
      if (r !== null) r.draw(alvo);
    }
    return ctx;
  }

  const AVISO_ZOOM = 'zoom apertado';

  it('com espaço sobrando, o volume continua codificado no raio', () => {
    const ctx = desenharComJanela(1);
    expect(ctx.bolhas.length).toBeGreaterThan(0);
    const raios = new Set(ctx.bolhas.map((b) => Math.round(b.raio * 100)));
    // Volumes diferentes ⇒ raios diferentes. É a leitura que a bolha existe para dar.
    expect(raios.size).toBeGreaterThan(1);
    // E nenhum aviso: não há nada a ressalvar.
    const avisos = textosVisiveis(ctx).filter((t) => t.texto.indexOf(AVISO_ZOOM) >= 0);
    expect(avisos).toHaveLength(0);
  });

  it('comprimido, nenhuma bolha passa do teto ditado pela largura da célula', () => {
    const ctx = desenharComJanela(200);
    expect(ctx.bolhas.length).toBeGreaterThan(0);
    for (const b of ctx.bolhas) {
      // Sem o teto por espaço, o volume maior do grid iria a 18 px e produziria a
      // corrente. O limite superior aqui é uma ordem de grandeza menor.
      expect(b.raio).toBeLessThanOrEqual(6);
      expect(b.raio).toBeGreaterThanOrEqual(4);
    }
  });

  it('comprimido, a legenda AVISA que o tamanho não reflete volume', () => {
    const ctx = desenharComJanela(200);
    const avisos = textosVisiveis(ctx).filter((t) => t.texto.indexOf(AVISO_ZOOM) >= 0);
    expect(avisos.length).toBeGreaterThan(0);
    // Em âmbar, o vocabulário de ressalva desta camada — e aponta a saída.
    expect(avisos[0]!.estilo).toBe(AMBAR);
    expect(avisos[0]!.texto).toContain('Focar no dia');
  });

  it('a corrente desaparece: o diâmetro deixa de ser múltiplo da largura da célula', () => {
    const comprimido = desenharComJanela(200);
    const folgado = desenharComJanela(1);
    const maiorComprimido = Math.max(...comprimido.bolhas.map((b) => b.raio));
    const maiorFolgado = Math.max(...folgado.bolhas.map((b) => b.raio));
    // A MESMA execução, no mesmo grid, sai muito menor quando não há espaço — é
    // exatamente essa razão que separa "corrente" de "bolhas legíveis".
    expect(maiorComprimido).toBeLessThan(maiorFolgado);
    expect(maiorFolgado).toBeGreaterThanOrEqual(12);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Legenda fora do canvas (04/09/2026)
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Motivo: a legenda e o rodapé são escritos SOBRE a área de plotagem. Com duas
// ou mais camadas densas ativas (livro, footprint, perfil de volume) os textos
// somam seis linhas e passam a esconder o dado que descrevem — foi o que o
// operador fotografou, com a legenda do footprint sobre o eixo de tempo e a do
// livro sobre as velas.
//
// A supressão acontece no PLANO (legenda e rodapé saem vazios), não no
// renderizador, que por contrato não decide nada. Aqui se mede o texto REALMENTE
// emitido no canvas falso — inspecionar o plano interno deixaria passar o caso em
// que ele está vazio por outro motivo, que é o falso verde mais fácil de cometer
// nesta suíte.
describe('BookmapPrimitive — mostrarLegenda', () => {
  it('a opção AUSENTE mantém legenda e rodapé (comportamento original)', () => {
    const b = montarBancada();
    expect(b.desenharUmaPassada()).toBe(true);
    // Referência: se esta asserção falhar, as de supressão abaixo passariam por
    // vacuidade — não há como suprimir o que já não estava sendo escrito.
    expect(textoJunto(b.ctx)).toContain('Livro');
  });

  it('`true` explícito emite o MESMO texto que a ausência', () => {
    const semOpcao = montarBancada();
    semOpcao.desenharUmaPassada();
    const comTrue = montarBancada({ mostrarLegenda: true });
    comTrue.desenharUmaPassada();
    expect(textoJunto(comTrue.ctx)).toBe(textoJunto(semOpcao.ctx));
  });

  it('`false` não escreve legenda nem rodapé, e SEGUE desenhando as células', () => {
    const b = montarBancada({ mostrarLegenda: false });
    expect(b.desenharUmaPassada()).toBe(true);
    // O ponto da feature: some o TEXTO, não a camada.
    expect(b.ctx.retangulos).toBeGreaterThan(0);
    expect(textosVisiveis(b.ctx)).toHaveLength(0);
  });

  it('a troca chega pelo `update`, na camada já anexada', () => {
    // ⚠️ É o caminho que o `marcaExec` não tinha: suprimir a legenda não altera a
    // presença da camada, então o efeito de anexação não roda de novo e só o
    // patch de `update` pode aplicar a mudança. Sem o campo no patch, a camada
    // manteria para sempre o estado com que nasceu.
    const b = montarBancada();
    b.desenharUmaPassada();
    expect(textosVisiveis(b.ctx).length).toBeGreaterThan(0);

    b.primitive.update({ mostrarLegenda: false });
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(textosVisiveis(b.ctx)).toHaveLength(0);

    b.primitive.update({ mostrarLegenda: true });
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(textosVisiveis(b.ctx).length).toBeGreaterThan(0);
  });

  it('⭐ o aviso de camada AUTODESATIVADA sobrevive à supressão', () => {
    // Naquele estado não há célula desenhada, então a legenda não cobre nada — é
    // a única informação na tela. Suprimi-la esconderia a falha, que é o oposto
    // do objetivo. O aviso vem de `buildSelfDisabledNotice`, caminho alternativo
    // que não passa pelo cálculo da legenda.
    // Mesmo caminho de `bancadaDesativada`: uma exceção durante o desenho de
    // célula desativa a camada; a passada seguinte (já sem falha) escreve o aviso.
    const b = montarBancada({ mostrarLegenda: false });
    b.armar('EM_CELULA');
    b.desenharUmaPassada();
    b.armar('NUNCA');
    b.ctx.zerar();
    b.desenharUmaPassada();
    expect(temAviso(b.ctx)).toBe(true);
  });

  it('e a camada suprimida NÃO escreve nada enquanto está saudável', () => {
    // Contraste com o teste acima: sem falha, silêncio total. É o que garante que
    // o aviso de autodesativação é exceção deliberada, não vazamento da legenda.
    const b = montarBancada({ mostrarLegenda: false });
    b.desenharUmaPassada();
    expect(temAviso(b.ctx)).toBe(false);
    expect(textosVisiveis(b.ctx)).toHaveLength(0);
  });
});
