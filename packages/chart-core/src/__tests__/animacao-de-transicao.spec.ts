/**
 * Transição animada do eixo de tempo — o último item que faltava do motor v1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE, E O QUE DELIBERADAMENTE NÃO ANIMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mudança de janela por COMANDO (`fitContent`, ir para uma data, `resetViewport` do
 * engine, restaurar layout) trocava o eixo de um quadro para o outro. O salto
 * desorienta: o operador não vê para onde a tela foi.
 *
 * ⚠️ Pan e zoom do USUÁRIO nunca são animados — o eixo tem de acompanhar o dedo no
 * mesmo quadro. E interação em curso CANCELA a transição, deixando o eixo onde está:
 * brigar com o operador é pior que não animar.
 *
 * ⚠️ E a opção nasce DESLIGADA. `fitContent()` seguido de `timeToCoordinate()` é um
 * par síncrono por contrato; animar por default faria esse par mentir durante a
 * transição, e a camada de desenho ancoraria elementos contra uma janela que já
 * mudou. Quem liga aceita a troca.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO SE TESTA TEMPO SEM ESPERAR TEMPO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O núcleo (`animation.core.ts`) recebe `agora` por parâmetro — não lê relógio. E o
 * `render` privado do motor aceita o instante, do mesmo jeito que o
 * `requestAnimationFrame` o entrega. Então a suíte "avança o tempo" chamando
 * `render(t)` com os instantes que quiser, sem timer nenhum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '../chart.js';
import type { IChartApi } from '../contracts.js';
import {
  ANIMATION_DEFAULT_MS,
  animationProgress,
  animationState,
  animationWorthwhile,
  easeOutCubic,
  type TimeScaleAnimation,
} from '../animation.core.js';
import type { TimeScaleState } from '../time-scale.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// O núcleo puro
// ═════════════════════════════════════════════════════════════════════════════

function anim(over: Partial<TimeScaleAnimation> = {}): TimeScaleAnimation {
  return {
    deLeftLogical: 0,
    paraLeftLogical: 100,
    deBarSpacing: 8,
    paraBarSpacing: 8,
    inicio: 1000,
    duracaoMs: 200,
    ...over,
  };
}

describe('easeOutCubic', () => {
  it('vai de 0 a 1 e é monotônica', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let anterior = -1;
    for (let i = 0; i <= 10; i++) {
      const v = easeOutCubic(i / 10);
      expect(v).toBeGreaterThan(anterior);
      anterior = v;
    }
  });

  /**
   * ⭐ `ease-out`, não `ease-in-out`: a transição é RESPOSTA a um comando, e uma
   * resposta que começa devagar é lida como travamento. Na metade do tempo, mais da
   * metade do caminho já foi percorrido.
   */
  it('parte RÁPIDO — na metade do tempo passou da metade do caminho', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });

  it('recorta fora de [0,1] e NaN termina (nunca congela num quadro)', () => {
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
    expect(easeOutCubic(NaN)).toBe(1);
  });
});

describe('animationProgress', () => {
  it('0 no início, 0.5 no meio, 1 no fim e depois', () => {
    const a = anim();
    expect(animationProgress(a, 1000)).toBe(0);
    expect(animationProgress(a, 1100)).toBeCloseTo(0.5, 10);
    expect(animationProgress(a, 1200)).toBe(1);
    expect(animationProgress(a, 99999)).toBe(1);
  });

  /**
   * ⚠️ Duração não-positiva devolve 1. É o que faz `durationMs: 0` significar "sem
   * animação" sem ramo especial no motor, e o que impede uma divisão por zero de
   * virar `NaN` no meio da interpolação.
   */
  it('duração 0 ou negativa termina na hora', () => {
    expect(animationProgress(anim({ duracaoMs: 0 }), 1000)).toBe(1);
    expect(animationProgress(anim({ duracaoMs: -10 }), 1000)).toBe(1);
  });

  /** ⚠️ Relógio antes do início TERMINA. Congelar a tela é o pior caso inaceitável. */
  it('agora antes do início, ou NaN, termina em vez de congelar', () => {
    expect(animationProgress(anim(), 500)).toBe(1);
    expect(animationProgress(anim(), NaN)).toBe(1);
  });
});

describe('animationState', () => {
  it('parte da origem e chega ao destino exato', () => {
    const a = anim({ deLeftLogical: 10, paraLeftLogical: 50 });
    expect(animationState(a, 1000).leftLogical).toBeCloseTo(10, 10);
    expect(animationState(a, 1200).leftLogical).toBeCloseTo(50, 10);
  });

  /**
   * ⭐ O CASO QUE JUSTIFICA A INTERPOLAÇÃO GEOMÉTRICA.
   *
   * Zoom é multiplicativo: de 2 a 32 px/barra são quatro dobras, e cada dobra tem de
   * custar o mesmo tempo. Na METADE do caminho (t=0.5 na curva, antes da suavização)
   * o valor certo é a média GEOMÉTRICA (8), não a aritmética (17). Com interpolação
   * linear a primeira metade do tempo cobriria três dobras e a segunda menos de uma —
   * um solavanco no começo e uma arrastada no fim.
   *
   * ⚠️ Medimos com a suavização aplicada, então usamos o instante em que
   * `easeOutCubic` vale 0.5. `1 - (1-t)³ = 0.5` ⇒ `t = 1 - 0.5^(1/3)`.
   */
  it('barSpacing anda em passos MULTIPLICATIVOS, não aditivos', () => {
    const a = anim({ deBarSpacing: 2, paraBarSpacing: 32, inicio: 0, duracaoMs: 1000 });
    const tMeio = 1 - Math.cbrt(0.5); // onde a suavização vale 0.5
    const meio = animationState(a, tMeio * 1000).barSpacing;

    // Média geométrica de 2 e 32 = 8. A aritmética seria 17.
    expect(meio).toBeCloseTo(8, 4);
    expect(meio).toBeLessThan(12);
  });

  it('leftLogical anda LINEARMENTE — posição é aditiva', () => {
    const a = anim({ deLeftLogical: 0, paraLeftLogical: 100, inicio: 0, duracaoMs: 1000 });
    const tMeio = 1 - Math.cbrt(0.5);
    expect(animationState(a, tMeio * 1000).leftLogical).toBeCloseTo(50, 4);
  });

  /** ⚠️ `Math.log(0)` é `-Infinity`; sem a guarda o desenho receberia NaN. */
  it('espaçamento não-positivo cai no linear, sem NaN', () => {
    const a = anim({ deBarSpacing: 0, paraBarSpacing: 10, inicio: 0, duracaoMs: 100 });
    const s = animationState(a, 50);
    expect(Number.isFinite(s.barSpacing)).toBe(true);
  });
});

describe('animationWorthwhile', () => {
  /**
   * ⚠️ Existe para não animar o que não se move. Um `fitContent()` sobre janela já
   * enquadrada agendaria 260 ms pintando o mesmo quadro — e, enquanto corresse,
   * qualquer toque a "cancelaria", fazendo o motor tratar como transição algo que
   * nunca teve efeito.
   */
  it('recusa deslocamento e zoom imperceptíveis', () => {
    expect(animationWorthwhile(10, 10.01, 8, 8)).toBe(false);
    expect(animationWorthwhile(10, 10, 8, 8.05)).toBe(false);
  });

  it('aceita deslocamento ou zoom visíveis', () => {
    expect(animationWorthwhile(10, 12, 8, 8)).toBe(true);
    expect(animationWorthwhile(10, 10, 8, 16)).toBe(true);
  });

  it('valor não-finito nunca vale a pena', () => {
    expect(animationWorthwhile(NaN, 10, 8, 8)).toBe(false);
    expect(animationWorthwhile(0, Infinity, 8, 8)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A costura no motor
// ═════════════════════════════════════════════════════════════════════════════

const LARGURA = 800;
const ALTURA = 400;

function velas(n: number) {
  const t0 = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));
}

interface Interno {
  render: (agora?: number) => void;
  ts: TimeScaleState;
  anim: TimeScaleAnimation | null;
}

function interno(chart: IChartApi): Interno {
  return chart as unknown as Interno;
}

function montar(animacao?: { enabled?: boolean; durationMs?: number }): {
  chart: IChartApi;
  el: HTMLElement;
} {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  const chart = createChart(el, {
    autoSize: false,
    ...(animacao === undefined ? {} : { animation: animacao }),
  });
  chart.addSeries('Candlestick').setData(velas(300) as never);
  interno(chart).render(0);
  return { chart, el };
}

describe('⚠️ animação DESLIGADA por default — o contrato síncrono é preservado', () => {
  let montado: { chart: IChartApi; el: HTMLElement };

  beforeEach(() => {
    montado = montar();
  });

  afterEach(() => {
    montado.chart.remove();
    montado.el.remove();
  });

  /**
   * ⭐ O caso que trava a decisão: `fitContent()` seguido de leitura de coordenada
   * tem de ver a janela NOVA no mesmo quadro. Se a animação fosse ligada por default,
   * a coordenada devolvida seria da janela ANTIGA por ~260 ms — e a camada de desenho
   * ancoraria elementos no lugar errado, sem erro nenhum.
   */
  it('fitContent aplica a janela NA HORA, sem transição', () => {
    const { chart } = montado;
    const antes = interno(chart).ts.barSpacing;
    chart.timeScale().fitContent();

    expect(interno(chart).anim).toBeNull();
    // O eixo JÁ está no destino, antes de qualquer quadro novo.
    expect(interno(chart).ts.barSpacing).not.toBeCloseTo(antes, 6);
    expect(interno(chart).ts.leftLogical).toBe(0);
  });

  it('setVisibleLogicalRange e scrollToRealTime também são imediatos', () => {
    const { chart } = montado;
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    expect(interno(chart).anim).toBeNull();
    expect(interno(chart).ts.leftLogical).toBeCloseTo(10, 6);

    chart.timeScale().scrollToRealTime();
    expect(interno(chart).anim).toBeNull();
  });
});

describe('⭐ animação LIGADA — o eixo VIAJA até o destino', () => {
  let montado: { chart: IChartApi; el: HTMLElement };

  beforeEach(() => {
    montado = montar({ enabled: true, durationMs: 200 });
  });

  afterEach(() => {
    montado.chart.remove();
    montado.el.remove();
  });

  it('a janela não salta: fica ENTRE origem e destino durante a transição', () => {
    const { chart } = montado;
    const origem = interno(chart).ts.leftLogical;

    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    expect(interno(chart).anim).not.toBeNull();
    const destino = interno(chart).anim!.paraLeftLogical;
    expect(destino).not.toBeCloseTo(origem, 3);

    // Assim que a transição começa, o eixo ainda está na ORIGEM.
    expect(interno(chart).ts.leftLogical).toBeCloseTo(origem, 6);

    // Um quadro no meio do caminho: entre os dois, em nenhum dos dois.
    const inicio = interno(chart).anim!.inicio;
    interno(chart).render(inicio + 100);
    const meio = interno(chart).ts.leftLogical;
    const menor = Math.min(origem, destino);
    const maior = Math.max(origem, destino);
    expect(meio).toBeGreaterThan(menor);
    expect(meio).toBeLessThan(maior);
  });

  /**
   * ⭐ POUSA NO DESTINO EXATO. Sem o "snap" final, o eixo pararia no último valor
   * interpolado — próximo do destino, não igual — e um `fitContent` deixaria uma
   * fração de barra fora da tela para sempre.
   */
  it('termina no destino EXATO e limpa a transição', () => {
    const { chart } = montado;
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    const a = interno(chart).anim!;
    const destino = a.paraLeftLogical;
    const destinoBar = a.paraBarSpacing;

    interno(chart).render(a.inicio + 200);

    expect(interno(chart).anim).toBeNull();
    expect(interno(chart).ts.leftLogical).toBe(destino);
    expect(interno(chart).ts.barSpacing).toBe(destinoBar);
  });

  /**
   * ⭐ A ESCALA DE PREÇO ACOMPANHA DE GRAÇA.
   *
   * Ela é recalculada por quadro a partir da janela visível; se a janela anda em
   * rampa, a faixa de preço anda em rampa. É por isso que o motor NÃO animar o preço
   * diretamente é a decisão certa: a autoescala roda depois e sobrescreveria a
   * interpolação, com dois donos disputando o mesmo estado.
   */
  it('a faixa de preço muda progressivamente junto com a janela', () => {
    const { chart } = montado;
    const panes = (chart as unknown as { panes: Array<{ priceScale: { topPrice: number; bottomPrice: number } }> })
      .panes;
    const faixa = (): number => panes[0]!.priceScale.topPrice - panes[0]!.priceScale.bottomPrice;

    // Vai de uma janela larga (300 barras) para uma estreita (20): a amplitude de
    // preço visível tem de encolher.
    const faixaAntes = faixa();
    chart.timeScale().setVisibleLogicalRange({ from: 280, to: 300 });
    const a = interno(chart).anim!;

    interno(chart).render(a.inicio + 100);
    const faixaMeio = faixa();
    interno(chart).render(a.inicio + 200);
    const faixaFim = faixa();

    // Encolheu, e o valor do meio está entre as duas pontas — não pulou.
    expect(faixaFim).toBeLessThan(faixaAntes);
    expect(faixaMeio).toBeLessThan(faixaAntes);
    expect(faixaMeio).toBeGreaterThan(faixaFim);
  });

  /**
   * ⭐ INTERAÇÃO CANCELA, deixando o eixo ONDE ESTÁ.
   *
   * Não pula para o destino: saltar no instante em que o operador agarrou o eixo
   * arrancaria a tela debaixo da mão dele.
   */
  it('a roda do mouse cancela a transição no ponto em que ela estava', () => {
    const { chart, el } = montado;
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    const a = interno(chart).anim!;
    interno(chart).render(a.inicio + 100);
    const noMeio = interno(chart).ts.leftLogical;

    const canvas = el.querySelector('canvas')!;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 200, bubbles: true }));

    expect(interno(chart).anim).toBeNull();
    // O eixo não voltou para a origem nem pulou para o destino: o zoom do usuário
    // partiu de onde a transição estava.
    const depois = interno(chart).ts.leftLogical;
    expect(Math.abs(depois - noMeio)).toBeLessThan(Math.abs(a.paraLeftLogical - noMeio));
  });

  /**
   * ⚠️ Transições NÃO se somam. Um comando novo durante a transição SUBSTITUI a
   * anterior, partindo de onde o eixo está — encadear duas rampas produziria um
   * caminho em ziguezague que ninguém pediu.
   */
  it('comando novo durante a transição substitui a anterior, partindo do ponto atual', () => {
    const { chart } = montado;
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    const primeira = interno(chart).anim!;
    interno(chart).render(primeira.inicio + 100);
    const noMeio = interno(chart).ts.leftLogical;

    chart.timeScale().setVisibleLogicalRange({ from: 200, to: 250 });
    const segunda = interno(chart).anim!;

    expect(segunda).not.toBe(primeira);
    expect(segunda.deLeftLogical).toBeCloseTo(noMeio, 6);
    expect(segunda.paraLeftLogical).toBeCloseTo(200, 6);
  });

  it('destino igual à origem NÃO agenda transição', () => {
    const { chart } = montado;
    chart.timeScale().fitContent();
    interno(chart).render(interno(chart).anim!.inicio + 999);
    expect(interno(chart).anim).toBeNull();

    // De novo, já enquadrado: nada a animar.
    chart.timeScale().fitContent();
    expect(interno(chart).anim).toBeNull();
  });

  it('durationMs 0 equivale a desligado', () => {
    const outro = montar({ enabled: true, durationMs: 0 });
    try {
      outro.chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
      expect(interno(outro.chart).anim).toBeNull();
      expect(interno(outro.chart).ts.leftLogical).toBeCloseTo(10, 6);
    } finally {
      outro.chart.remove();
      outro.el.remove();
    }
  });

  it('a duração default é usada quando não se informa', () => {
    const outro = montar({ enabled: true });
    try {
      outro.chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
      expect(interno(outro.chart).anim?.duracaoMs).toBe(ANIMATION_DEFAULT_MS);
    } finally {
      outro.chart.remove();
      outro.el.remove();
    }
  });
});

/**
 * ⚠️ `prefers-reduced-motion: reduce` VENCE a configuração.
 *
 * Não é cortesia: para parte dos usuários movimento na tela causa mal-estar físico, e
 * a preferência do sistema é a declaração disso. É consultada em CADA transição, não
 * guardada na construção — o usuário pode mudar a preferência com a página aberta.
 */
describe('⭐ prefers-reduced-motion desliga a animação', () => {
  const matchMediaOriginal = window.matchMedia;

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
    vi.restoreAllMocks();
  });

  function simularReducao(reduz: boolean): void {
    window.matchMedia = ((consulta: string) =>
      ({
        matches: reduz && consulta.includes('prefers-reduced-motion'),
        media: consulta,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  it('com a preferência ligada, a mudança é imediata mesmo com enabled: true', () => {
    simularReducao(true);
    const { chart, el } = montar({ enabled: true, durationMs: 200 });
    try {
      chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
      expect(interno(chart).anim).toBeNull();
      expect(interno(chart).ts.leftLogical).toBeCloseTo(10, 6);
    } finally {
      chart.remove();
      el.remove();
    }
  });

  it('sem a preferência, a transição acontece — guarda de vacuidade', () => {
    simularReducao(false);
    const { chart, el } = montar({ enabled: true, durationMs: 200 });
    try {
      chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
      expect(interno(chart).anim).not.toBeNull();
    } finally {
      chart.remove();
      el.remove();
    }
  });

  /**
   * ⚠️ Ambiente SEM `matchMedia` (Node, SSR) conta como "sem preferência declarada",
   * não como "reduza". Tratar ausência de API como pedido de redução desligaria a
   * animação em todo navegador antigo.
   */
  it('ambiente sem matchMedia não desliga a animação nem lança', () => {
    // @ts-expect-error — remoção deliberada da API para simular o ambiente.
    delete window.matchMedia;
    const { chart, el } = montar({ enabled: true, durationMs: 200 });
    try {
      expect(() => chart.timeScale().fitContent()).not.toThrow();
      expect(interno(chart).anim).not.toBeNull();
    } finally {
      chart.remove();
      el.remove();
    }
  });
});
