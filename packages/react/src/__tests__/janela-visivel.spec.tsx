/**
 * `useVisibleTimeRange` — a janela visível, e a guarda que impede o pan de travar.
 *
 * ⭐ O hook existe para o "perfil da janela visível": reagregar quando a janela muda. O que
 * estes testes travam é a GUARDA, porque sem ela o recurso é uma regressão de desempenho
 * disfarçada de recurso — o motor emite mudança de janela a cada quadro do arrasto, e
 * reagregar milhares de células 60 vezes por segundo trava o gesto mais usado do gráfico.
 *
 * ⚠️ Motor DUPLO, e não o real: em jsdom o container mede 0 px e o motor nunca emitiria faixa
 * (é a mesma razão do duplo em `multi-grafico.spec.tsx`). O duplo deixa o teste controlar
 * exatamente quantas emissões acontecem, que é o que se quer medir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisibleTimeRange } from '../useVisibleTimeRange.js';
import type { ChartEngine } from '@robustus/charts-engine';

interface Ouvinte {
  (r: unknown): void;
}

/** Motor duplo: expõe `emitir` para o teste disparar mudança de janela. */
function motorDuplo(inicial: { from: number; to: number } | null = { from: 100, to: 200 }): {
  engine: ChartEngine;
  emitir: (faixa: { from: number; to: number } | null) => void;
  assinaturas: () => number;
} {
  let faixa = inicial;
  const ouvintes = new Set<Ouvinte>();
  const engine = {
    isDisposed: false,
    api: {
      timeScale: () => ({
        getVisibleRange: () => faixa,
        subscribeVisibleLogicalRangeChange: (h: Ouvinte) => ouvintes.add(h),
        unsubscribeVisibleLogicalRangeChange: (h: Ouvinte) => ouvintes.delete(h),
      }),
    },
  } as unknown as ChartEngine;

  return {
    engine,
    emitir: (nova) => {
      faixa = nova;
      for (const h of ouvintes) h(nova);
    },
    assinaturas: () => ouvintes.size,
  };
}

describe('useVisibleTimeRange', () => {
  beforeEach(() => {
    // ⚠️ `requestAnimationFrame` é substituído por temporizador FALSO: a coalescência por
    // quadro é o cerne da guarda, e com rAF real o teste dependeria do relógio da máquina.
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Deixa o quadro agendado rodar. */
  function passarQuadro(): void {
    act(() => {
      vi.advanceTimersByTime(20);
    });
  }

  it('⭐ lê a janela IMEDIATAMENTE, sem esperar a primeira mudança', () => {
    // ⚠️ Num gráfico que ninguém arrastou, o motor não emite nada. Sem a leitura inicial o
    // consumidor ficaria com `null` para sempre — vendo o perfil do dia inteiro achando que
    // era o da janela.
    const { engine } = motorDuplo({ from: 1000, to: 2000 });
    const { result } = renderHook(() => useVisibleTimeRange({ engine }));
    expect(result.current).toEqual({ de: 1000, ate: 2000 });
  });

  it('atualiza quando a janela muda de verdade', () => {
    const { engine, emitir } = motorDuplo({ from: 1000, to: 2000 });
    const { result } = renderHook(() => useVisibleTimeRange({ engine }));

    act(() => emitir({ from: 5000, to: 6000 }));
    passarQuadro();
    expect(result.current).toEqual({ de: 5000, ate: 6000 });
  });

  it('⭐⭐ COALESCE várias emissões no mesmo quadro numa atualização só', () => {
    // É a metade da guarda que alinha o custo ao que a tela mostra: o arrasto emite por
    // quadro, e o consumidor reagrega uma vez.
    const { engine, emitir } = motorDuplo({ from: 0, to: 100 });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useVisibleTimeRange({ engine });
    });
    const rendersIniciais = renders;

    act(() => {
      for (let i = 1; i <= 20; i++) emitir({ from: i * 10, to: i * 10 + 100 });
    });
    passarQuadro();

    // Vinte emissões, UMA atualização de estado (portanto um render a mais).
    expect(renders).toBe(rendersIniciais + 1);
    // E o valor é o ÚLTIMO, não o primeiro: coalescer não pode entregar dado velho.
    expect(result.current).toEqual({ de: 200, ate: 300 });
  });

  it('⭐ a ZONA MORTA descarta mudança menor que a tolerância', () => {
    // Durante o zoom as bordas variam por fração de segundo. Sem a zona morta, o `setState`
    // dispararia com a janela praticamente parada.
    const { engine, emitir } = motorDuplo({ from: 1000, to: 2000 });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useVisibleTimeRange({ engine, toleranciaSegundos: 150 });
    });
    const antes = renders;

    act(() => emitir({ from: 1050, to: 2050 }));
    passarQuadro();
    expect(renders).toBe(antes);
    expect(result.current).toEqual({ de: 1000, ate: 2000 });

    // Além da tolerância: atualiza.
    act(() => emitir({ from: 1400, to: 2400 }));
    passarQuadro();
    expect(result.current).toEqual({ de: 1400, ate: 2400 });
  });

  it('⚠️ faixa INVERTIDA ou não finita é descartada, nunca propagada', () => {
    // Ela viraria um recorte vazio, e o perfil apareceria em branco sem explicação.
    const { engine, emitir } = motorDuplo({ from: 1000, to: 2000 });
    const { result } = renderHook(() => useVisibleTimeRange({ engine }));

    for (const ruim of [
      { from: 2000, to: 1000 },
      { from: Number.NaN, to: 2000 },
      { from: 1000, to: Number.POSITIVE_INFINITY },
      null,
    ]) {
      act(() => emitir(ruim as never));
      passarQuadro();
      expect(result.current).toEqual({ de: 1000, ate: 2000 });
    }
  });

  it('motor `null` devolve `null` e não assina nada', () => {
    const { result } = renderHook(() => useVisibleTimeRange({ engine: null }));
    expect(result.current).toBeNull();
  });

  it('⚠️ perder o motor ZERA a faixa — a janela do gráfico anterior não fica', () => {
    // Sem isto, a janela do ativo A recortaria o perfil do ativo B: dado de um no desenho do
    // outro, sem erro nenhum.
    const a = motorDuplo({ from: 1000, to: 2000 });
    const { result, rerender } = renderHook(
      ({ engine }: { engine: ChartEngine | null }) => useVisibleTimeRange({ engine }),
      { initialProps: { engine: a.engine } },
    );
    expect(result.current).not.toBeNull();

    rerender({ engine: null });
    expect(result.current).toBeNull();
  });

  it('o desmonte remove o ouvinte do motor', () => {
    const { engine, assinaturas } = motorDuplo();
    const { unmount } = renderHook(() => useVisibleTimeRange({ engine }));
    expect(assinaturas()).toBe(1);
    unmount();
    expect(assinaturas()).toBe(0);
  });

  it('trocar de motor reassina no novo e solta o antigo', () => {
    const a = motorDuplo({ from: 100, to: 200 });
    const b = motorDuplo({ from: 900, to: 1000 });
    const { result, rerender } = renderHook(
      ({ engine }: { engine: ChartEngine }) => useVisibleTimeRange({ engine }),
      { initialProps: { engine: a.engine } },
    );
    rerender({ engine: b.engine });
    expect(a.assinaturas()).toBe(0);
    expect(b.assinaturas()).toBe(1);
    expect(result.current).toEqual({ de: 900, ate: 1000 });
  });
});
