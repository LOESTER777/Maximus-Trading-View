/**
 * useHistoryBackfill — QUANDO pedir histórico antigo, e as guardas que impedem abuso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE É TESTADO AQUI, E O QUE É TESTADO NO MOTOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A preservação da POSIÇÃO da tela quando as barras entram na frente é do motor, e está
 * provada em `chart-core/__tests__/backfill-de-historico.spec.ts` (`onBarsPrepended`).
 *
 * Aqui a pergunta é a decisão: pedir só ao chegar perto da borda, um pedido por vez,
 * parar quando o histórico acaba, e não martelar em caso de erro.
 *
 * ⚠️ O motor REAL não serve para este arquivo, e a razão é do ambiente: em jsdom o
 * container mede 0 px, então `visibleLogicalRange` devolve `null` e o motor nunca emite
 * faixa nenhuma — nenhum caso disparia. O hook precisa de uma superfície mínima
 * (`api.timeScale().subscribeVisibleLogicalRangeChange` e `isDisposed`), e é ela que o
 * duplo abaixo oferece. Isso também DOCUMENTA o quanto o hook exige do motor: quase
 * nada.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useHistoryBackfill, type BackfillBar } from '../useHistoryBackfill.js';
import type { ChartEngine } from '@robustus/charts-engine';

afterEach(cleanup);

const T0 = 1_700_000_000;
const PASSO = 60;

function barras(n: number, desdeIndice = 0): BackfillBar[] {
  return Array.from({ length: n }, (_, k) => ({ time: T0 + (desdeIndice + k) * PASSO }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Motor duplo: só a superfície que o hook consome
// ═════════════════════════════════════════════════════════════════════════════

interface MotorFalso {
  readonly engine: ChartEngine;
  /** Emite uma faixa visível para todos os ouvintes. */
  emitir: (faixa: { from: number; to: number } | null) => void;
  /** Quantos ouvintes estão registrados — para provar a limpeza no desmonte. */
  ouvintes: () => number;
}

function motorFalso(): MotorFalso {
  const listeners = new Set<(f: { from: number; to: number } | null) => void>();
  const engine = {
    isDisposed: false,
    api: {
      timeScale: () => ({
        subscribeVisibleLogicalRangeChange: (h: (f: { from: number; to: number } | null) => void) => {
          listeners.add(h);
        },
        unsubscribeVisibleLogicalRangeChange: (h: (f: { from: number; to: number } | null) => void) => {
          listeners.delete(h);
        },
      }),
    },
  };
  return {
    engine: engine as unknown as ChartEngine,
    emitir: (faixa) => {
      for (const h of [...listeners]) h(faixa);
    },
    ouvintes: () => listeners.size,
  };
}

describe('useHistoryBackfill — quando pedir', () => {
  it('⭐ pede quando a janela chega perto da borda esquerda', () => {
    const m = motorFalso();
    const pedidos: number[] = [];
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: (antesDe) => {
          pedidos.push(antesDe);
          return 100;
        },
      }),
    );

    act(() => m.emitir({ from: 5, to: 60 }));
    // O pedido carrega o tempo da PRIMEIRA barra: "me dê o que vem antes disto".
    expect(pedidos).toEqual([T0]);
  });

  it('NÃO pede quando a janela está longe da borda', () => {
    const m = motorFalso();
    const pedidos: number[] = [];
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: (t) => {
          pedidos.push(t);
          return 100;
        },
      }),
    );

    act(() => m.emitir({ from: 100, to: 160 }));
    expect(pedidos).toEqual([]);
  });

  /**
   * ⚠️ `from` NEGATIVO é normal: o motor deixa rolar para antes da primeira barra, e é
   * o gesto natural de quem quer mais passado. Um teste `from < N` que não previsse
   * negativo funcionaria por acidente; este caso o torna explícito.
   */
  it('faixa com `from` negativo também pede', () => {
    const m = motorFalso();
    let pediu = false;
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          pediu = true;
          return 10;
        },
      }),
    );
    act(() => m.emitir({ from: -40, to: 20 }));
    expect(pediu).toBe(true);
  });

  it('o limiar é configurável, em BARRAS', () => {
    const m = motorFalso();
    let pediu = false;
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        thresholdBars: 100,
        loadOlder: () => {
          pediu = true;
          return 10;
        },
      }),
    );
    // 60 estaria longe com o limiar default (20); com 100, está perto.
    act(() => m.emitir({ from: 60, to: 120 }));
    expect(pediu).toBe(true);
  });

  /**
   * ⚠️ Sem barras não há `beforeTime`. Pedir "antes de nada" seria pedir tudo, e o
   * primeiro lote é responsabilidade do consumidor.
   */
  it('série vazia não pede nada', () => {
    const m = motorFalso();
    let pediu = false;
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: [],
        loadOlder: () => {
          pediu = true;
          return 1;
        },
      }),
    );
    act(() => m.emitir({ from: -10, to: 40 }));
    expect(pediu).toBe(false);
  });

  it('faixa nula é ignorada sem lançar', () => {
    const m = motorFalso();
    expect(() => {
      renderHook(() =>
        useHistoryBackfill({ engine: m.engine, bars: barras(50), loadOlder: () => 0 }),
      );
      act(() => m.emitir(null));
    }).not.toThrow();
  });

  it('`enabled: false` desliga sem desmontar', () => {
    const m = motorFalso();
    let pediu = false;
    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        enabled: false,
        loadOlder: () => {
          pediu = true;
          return 1;
        },
      }),
    );
    act(() => m.emitir({ from: 0, to: 40 }));
    expect(pediu).toBe(false);
  });

  it('motor nulo não registra ouvinte nem lança', () => {
    expect(() => {
      renderHook(() => useHistoryBackfill({ engine: null, bars: barras(10), loadOlder: () => 0 }));
    }).not.toThrow();
  });

  it('desmontar remove o ouvinte', () => {
    const m = motorFalso();
    const { unmount } = renderHook(() =>
      useHistoryBackfill({ engine: m.engine, bars: barras(50), loadOlder: () => 0 }),
    );
    expect(m.ouvintes()).toBe(1);
    unmount();
    expect(m.ouvintes()).toBe(0);
  });
});

describe('⭐ useHistoryBackfill — as três guardas', () => {
  /**
   * ⭐ GUARDA 1: um pedido em voo.
   *
   * O evento de janela dispara a cada quadro de arrasto — dezenas por segundo. Sem a
   * trava, meio segundo de arrasto abriria trinta requisições do MESMO trecho.
   */
  it('não abre um segundo pedido enquanto o primeiro está em voo', async () => {
    const m = motorFalso();
    let chamadas = 0;
    let resolver: ((n: number) => void) | null = null;

    renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          return new Promise<number>((r) => {
            resolver = r;
          });
        },
      }),
    );

    act(() => m.emitir({ from: 5, to: 60 }));
    act(() => m.emitir({ from: 4, to: 59 }));
    act(() => m.emitir({ from: 3, to: 58 }));
    expect(chamadas).toBe(1);

    // Resolvido, um novo evento pode pedir de novo.
    await act(async () => {
      resolver!(50);
    });
    act(() => m.emitir({ from: 2, to: 57 }));
    expect(chamadas).toBe(2);
  });

  it('`loading` reflete o pedido em voo', async () => {
    const m = motorFalso();
    let resolver: ((n: number) => void) | null = null;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () =>
          new Promise<number>((r) => {
            resolver = r;
          }),
      }),
    );

    expect(result.current.loading).toBe(false);
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolver!(10);
    });
    expect(result.current.loading).toBe(false);
  });

  /**
   * ⭐ GUARDA 2: fim de histórico.
   *
   * Zero barras devolvidas significa "não há mais passado". Sem a trava, o gráfico
   * parado na borda esquerda pediria para sempre — o operador que só quer olhar o
   * primeiro dia geraria requisição enquanto a aba estivesse aberta.
   */
  it('carregamento que devolve 0 TRAVA os pedidos e marca `exhausted`', () => {
    const m = motorFalso();
    let chamadas = 0;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          return 0;
        },
      }),
    );

    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(1);
    expect(result.current.exhausted).toBe(true);

    act(() => m.emitir({ from: 4, to: 59 }));
    act(() => m.emitir({ from: 3, to: 58 }));
    expect(chamadas).toBe(1);
  });

  it('`reset()` destrava depois do fim de histórico', () => {
    const m = motorFalso();
    let chamadas = 0;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          return 0;
        },
      }),
    );
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(1);

    act(() => result.current.reset());
    expect(result.current.exhausted).toBe(false);
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(2);
  });

  /**
   * ⚠️ Trocar de instrumento não pode herdar o "não há mais passado" do anterior — o
   * operador trocaria de ativo e o gráfico nunca mais buscaria histórico, sem nada
   * explicando. E isso NÃO é derivável de `bars`: o tempo da primeira barra muda a cada
   * backfill (é o objetivo) e o da última muda a cada barra ao vivo.
   */
  it('`resetKey` diferente zera a trava de fim de histórico', () => {
    const m = motorFalso();
    let chamadas = 0;
    const { rerender } = renderHook(
      (props: { chave: string }) =>
        useHistoryBackfill({
          engine: m.engine,
          bars: barras(200),
          resetKey: props.chave,
          loadOlder: () => {
            chamadas += 1;
            return 0;
          },
        }),
      { initialProps: { chave: 'WIN|60' } },
    );

    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(1);
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(1); // travado

    act(() => rerender({ chave: 'WDO|60' }));
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(chamadas).toBe(2);
  });

  /**
   * ⭐ GUARDA 3: teto de falhas consecutivas.
   *
   * Erro de rede não pode virar martelo. Uma falha isolada é rotina e insistir resolve;
   * três seguidas indicam problema que repetição não conserta.
   */
  it('para de pedir depois de 3 falhas consecutivas, e reporta o motivo', async () => {
    const m = motorFalso();
    let chamadas = 0;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          return Promise.reject(new Error('rede fora'));
        },
      }),
    );

    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        m.emitir({ from: 5 - i, to: 60 });
      });
    }

    expect(chamadas).toBe(3);
    expect(result.current.error).toBe('rede fora');
    // ⚠️ Falha NÃO é fim de histórico: pode haver passado, só não conseguimos buscar.
    expect(result.current.exhausted).toBe(false);
  });

  it('sucesso ZERA o contador de falhas', async () => {
    const m = motorFalso();
    let chamadas = 0;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          // Falha, falha, sucesso, e depois pode falhar de novo mais 3 vezes.
          return chamadas === 3 ? Promise.resolve(10) : Promise.reject(new Error('x'));
        },
      }),
    );

    for (let i = 0; i < 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        m.emitir({ from: 5, to: 60 });
      });
    }

    // 2 falhas + 1 sucesso (zera) + 3 falhas = 6 chamadas, e então travou.
    expect(chamadas).toBe(6);
    expect(result.current.error).toBe('x');
  });

  /**
   * ⚠️ `loadOlder` pode LANÇAR de forma síncrona, antes de devolver promessa. Sem o
   * `try` em volta da chamada, a exceção subiria pelo ouvinte de janela do motor e o
   * backfill morreria em silêncio para o resto da sessão.
   */
  it('exceção SÍNCRONA no loadOlder é tratada como falha, não derruba o ouvinte', () => {
    const m = motorFalso();
    let chamadas = 0;
    const { result } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () => {
          chamadas += 1;
          throw new Error('deu ruim na hora');
        },
      }),
    );

    expect(() => act(() => m.emitir({ from: 5, to: 60 }))).not.toThrow();
    expect(result.current.error).toBe('deu ruim na hora');
    // O ouvinte continua vivo: pede de novo no evento seguinte.
    act(() => m.emitir({ from: 4, to: 59 }));
    expect(chamadas).toBe(2);
  });

  it('carregamento síncrono também funciona (não exige promessa)', () => {
    const m = motorFalso();
    const { result } = renderHook(() =>
      useHistoryBackfill({ engine: m.engine, bars: barras(200), loadOlder: () => 42 }),
    );
    act(() => m.emitir({ from: 5, to: 60 }));
    expect(result.current.loading).toBe(false);
    expect(result.current.exhausted).toBe(false);
    expect(result.current.error).toBeNull();
  });

  /**
   * ⚠️ Resultado que chega DEPOIS do desmonte não pode chamar `setState` — é o aviso
   * clássico de vazamento, e num backfill lento (rede ruim) é o caso comum: o operador
   * troca de tela antes de a resposta voltar.
   */
  it('resposta que chega após o desmonte não atualiza estado', async () => {
    const m = motorFalso();
    let resolver: ((n: number) => void) | null = null;
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = renderHook(() =>
      useHistoryBackfill({
        engine: m.engine,
        bars: barras(200),
        loadOlder: () =>
          new Promise<number>((r) => {
            resolver = r;
          }),
      }),
    );

    act(() => m.emitir({ from: 5, to: 60 }));
    unmount();
    await act(async () => {
      resolver!(0);
    });

    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  /**
   * ⚠️ O ouvinte é registrado UMA vez por motor. Se `bars` ou `loadOlder` fossem
   * dependências do efeito, cada barra nova o removeria e recriaria — trabalho por
   * tick, e uma janela em que nenhum ouvinte está registrado.
   */
  it('barra nova NÃO recria o ouvinte, e o pedido usa a série ATUAL', () => {
    const m = motorFalso();
    const pedidos: number[] = [];
    const { rerender } = renderHook(
      (props: { bars: BackfillBar[] }) =>
        useHistoryBackfill({
          engine: m.engine,
          bars: props.bars,
          loadOlder: (t) => {
            pedidos.push(t);
            return 10;
          },
        }),
      { initialProps: { bars: barras(200) } },
    );
    expect(m.ouvintes()).toBe(1);

    // Chegou histórico: a primeira barra agora é outra.
    act(() => rerender({ bars: barras(300, -100) }));
    expect(m.ouvintes()).toBe(1);

    act(() => m.emitir({ from: 5, to: 60 }));
    expect(pedidos).toEqual([T0 - 100 * PASSO]);
  });
});
