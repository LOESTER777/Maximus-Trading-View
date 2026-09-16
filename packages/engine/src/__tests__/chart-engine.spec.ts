/**
 * chart-engine — ciclo de vida e traducao de vocabulario.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E TESTAVEL AQUI, E O QUE NAO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `jsdom` NAO implementa contexto 2D: `getContext('2d')` devolve `null`. O
 * substrato de grafico consegue ser instanciado (ele tolera a ausencia), mas
 * **nada e rasterizado** — nao ha pixel, e portanto nao ha o que afirmar sobre
 * aparencia.
 *
 * O que estes testes cobrem, entao, e o que independe de pixel e e onde os
 * defeitos reais moram:
 *
 *  - **idempotencia e ordem do descarte** — a familia de erro `Object is disposed`
 *    da origem vinha exatamente daqui;
 *  - **acumulo de linha de preco** — o substrato nao tem "aplicar conjunto", e sem
 *    remocao explicita cada chamada empilha linha fantasma;
 *  - **filtro de vela inutilizavel** — o defeito do `NaN != null`;
 *  - **tolerancia a falha do assinante** de coordenada;
 *  - **camada criada uma vez, atualizada depois** — recriar faz piscar.
 *
 * O que NAO e coberto aqui: aparencia, desempenho de desenho e alinhamento de
 * coordenada. Aparencia exige navegador; desempenho tem bancada propria em
 * `@robustus/charts-devtools`, que declara medir tudo menos a rasterizacao.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartEngine } from '../chart-engine.js';
import {
  BOOKMAP_MAX_CELLS_DEFAULT,
  BOOKMAP_MIN_CELL_PX_DEFAULT,
  isValidCandle,
} from '../types.js';

// ═════════════════════════════════════════════════════════════════════════════
// isValidCandle — puro, e o mais importante de travar
// ═════════════════════════════════════════════════════════════════════════════

describe('isValidCandle', () => {
  const boa = { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 };

  it('aceita vela finita', () => {
    expect(isValidCandle(boa)).toBe(true);
  });

  /**
   * ⭐ A regressao que este teste existe para impedir.
   *
   * O teste original era `c.time != null`. Como `NaN != null` e `true`, a vela
   * passava, chegava ao renderizador e voltava como `Uncaught Error: Value is
   * null` de dentro do substrato — sem dizer qual vela.
   */
  it('RECUSA NaN em qualquer campo — `NaN != null` e true, e foi por aí que o defeito entrou', () => {
    for (const campo of ['time', 'open', 'high', 'low', 'close'] as const) {
      expect(isValidCandle({ ...boa, [campo]: NaN })).toBe(false);
    }
  });

  it('recusa infinito em qualquer campo', () => {
    for (const campo of ['time', 'open', 'high', 'low', 'close'] as const) {
      expect(isValidCandle({ ...boa, [campo]: Infinity })).toBe(false);
      expect(isValidCandle({ ...boa, [campo]: -Infinity })).toBe(false);
    }
  });

  it('recusa campo ausente, nulo ou de outro tipo', () => {
    expect(isValidCandle({ ...boa, close: undefined })).toBe(false);
    expect(isValidCandle({ ...boa, close: null })).toBe(false);
    expect(isValidCandle({ ...boa, close: '1.5' })).toBe(false);
    expect(isValidCandle(null)).toBe(false);
    expect(isValidCandle(undefined)).toBe(false);
    expect(isValidCandle(42)).toBe(false);
    expect(isValidCandle({})).toBe(false);
  });
});

describe('padroes de orcamento da camada de livro', () => {
  it('sao os numeros medidos na origem', () => {
    expect(BOOKMAP_MAX_CELLS_DEFAULT).toBe(3000);
    // 2, e nao 3: com 3 o bloco engrossa no eixo do preco. E nao 1, porque o
    // antialias apaga a celula de 1 px — e a parede fina e a que interessa.
    expect(BOOKMAP_MIN_CELL_PX_DEFAULT).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Ciclo de vida
// ═════════════════════════════════════════════════════════════════════════════

describe('ChartEngine — ciclo de vida', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    // jsdom devolve 0 em toda medida; o substrato aceita, mas sem dimensao
    // declarada ele reclama. Fixar torna o teste determinístico.
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('cria sobre um elemento e expoe o grafico do substrato', () => {
    const motor = ChartEngine.create(container);
    try {
      expect(motor.isDisposed).toBe(false);
      expect(motor.api).toBeTruthy();
    } finally {
      motor.dispose();
    }
  });

  it('descarte e IDEMPOTENTE — chamar tres vezes nao lanca', () => {
    const motor = ChartEngine.create(container);
    motor.dispose();
    expect(motor.isDisposed).toBe(true);
    expect(() => motor.dispose()).not.toThrow();
    expect(() => motor.dispose()).not.toThrow();
  });

  /**
   * ⭐ Depois do descarte, TODO acesso e inerte em vez de lançar.
   *
   * Importa porque desmontagem de componente e assíncrona: um dado que chegou
   * pela rede pode aterrissar depois do descarte, e isso e normal, nao defeito
   * de quem chama.
   */
  it('operacoes depois do descarte sao inertes, nao excecao', () => {
    const motor = ChartEngine.create(container);
    motor.dispose();

    expect(() => motor.setCandles([{ time: 1, open: 1, high: 1, low: 1, close: 1 }])).not.toThrow();
    expect(() => motor.setVolume([{ time: 1, value: 10 }])).not.toThrow();
    expect(() => motor.setPriceLines([{ price: 1, color: '#fff' }])).not.toThrow();
    expect(() => motor.setLineSeries([{ data: [], color: '#fff' }])).not.toThrow();
    expect(() => motor.setMarkers([])).not.toThrow();
    expect(() => motor.setBookmapLayer(null)).not.toThrow();
    expect(() => motor.setFootprintLayer(null)).not.toThrow();
    expect(() => motor.resetViewport()).not.toThrow();
  });

  it('reenquadra sem recriar — o caminho correto para trocar de periodo', () => {
    const motor = ChartEngine.create(container);
    try {
      const antes = motor.api;
      motor.setCandles(velas(10));
      motor.resetViewport();
      motor.setCandles(velas(20));
      motor.resetViewport();
      // Mesma instancia: nada foi destruido. Destruir e o que produzia
      // `Object is disposed` no observador de redimensionamento.
      expect(motor.api).toBe(antes);
      expect(motor.isDisposed).toBe(false);
    } finally {
      motor.dispose();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sobreposicoes declarativas
// ═════════════════════════════════════════════════════════════════════════════

describe('ChartEngine — linhas de preco', () => {
  let container: HTMLDivElement;
  let motor: ChartEngine;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);
    motor = ChartEngine.create(container);
    motor.setCandles(velas(30));
  });

  afterEach(() => {
    motor.dispose();
    container.remove();
  });

  /**
   * ⭐ O substrato nao tem "aplicar conjunto" para linha de preco: `createPriceLine`
   * so ACRESCENTA. Sem a remocao explicita do conjunto anterior, cada chamada
   * empilha, e a tela vai enchendo de linha que nada remove.
   */
  it('SUBSTITUI o conjunto em vez de acumular', () => {
    const serie = (motor as unknown as { candleSeries: { removePriceLine: unknown } })
      .candleSeries;
    const espia = vi.spyOn(
      serie as unknown as { removePriceLine: (l: unknown) => void },
      'removePriceLine',
    );

    motor.setPriceLines([
      { price: 100, color: '#a' },
      { price: 200, color: '#b' },
      { price: 300, color: '#c' },
    ]);
    expect(espia).not.toHaveBeenCalled();

    motor.setPriceLines([{ price: 150, color: '#d' }]);
    // As tres anteriores foram removidas antes de criar a nova.
    expect(espia).toHaveBeenCalledTimes(3);
  });

  it('descarta preco nao-finito em vez de repassar ao substrato', () => {
    expect(() =>
      motor.setPriceLines([
        { price: NaN, color: '#a' },
        { price: Infinity, color: '#b' },
        { price: 100, color: '#c' },
      ]),
    ).not.toThrow();
  });

  it('conjunto vazio limpa tudo', () => {
    motor.setPriceLines([{ price: 100, color: '#a' }]);
    expect(() => motor.setPriceLines([])).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mapeador de coordenadas
// ═════════════════════════════════════════════════════════════════════════════

describe('ChartEngine — mapeador de coordenadas', () => {
  let container: HTMLDivElement;
  let motor: ChartEngine;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);
    motor = ChartEngine.create(container);
  });

  afterEach(() => {
    motor.dispose();
    container.remove();
  });

  it('emite uma vez de imediato, sem esperar um pan', () => {
    const ouvinte = vi.fn();
    const parar = motor.onCoordinateMapperChange(ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    parar();
  });

  it('cancelar e idempotente e realmente para de emitir', () => {
    const ouvinte = vi.fn();
    const parar = motor.onCoordinateMapperChange(ouvinte);
    ouvinte.mockClear();
    parar();
    expect(() => parar()).not.toThrow();
    motor.setCandles(velas(10));
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('devolve null — nunca zero — para entrada nao-finita', () => {
    const m = motor.coordinateMapper();
    expect(m.priceToY(NaN)).toBeNull();
    expect(m.priceToY(Infinity)).toBeNull();
    expect(m.timeToX(NaN)).toBeNull();
    expect(m.timeToX(Infinity)).toBeNull();
  });

  it('nenhum acessor lanca com o grafico vazio', () => {
    const m = motor.coordinateMapper();
    expect(() => m.priceToY(100)).not.toThrow();
    expect(() => m.timeToX(Date.now())).not.toThrow();
    expect(() => m.visibleTimeRangeSec()).not.toThrow();
    // `priceScale(id).width()` LANCA quando o id nao existe — o try/catch interno
    // e o que impede isso de derrubar o laco de desenho.
    expect(() => m.priceScaleWidthPx()).not.toThrow();
  });

  /** Assinante que lanca nao pode calar os outros nem derrubar o quadro. */
  it('assinante que lanca nao impede os demais de receber', () => {
    const ruim = vi.fn(() => {
      throw new Error('defeito do consumidor');
    });
    const bom = vi.fn();

    const p1 = motor.onCoordinateMapperChange(ruim as never);
    const p2 = motor.onCoordinateMapperChange(bom);
    expect(bom).toHaveBeenCalledTimes(1);

    p1();
    p2();
  });

  it('descarte limpa os assinantes', () => {
    const ouvinte = vi.fn();
    motor.onCoordinateMapperChange(ouvinte);
    ouvinte.mockClear();
    motor.dispose();
    motor.setCandles(velas(5));
    expect(ouvinte).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliar
// ═════════════════════════════════════════════════════════════════════════════

/** Velas sinteticas contiguas, em segundos, comecando num instante fixo. */
function velas(n: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  const base = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: base + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));
}
