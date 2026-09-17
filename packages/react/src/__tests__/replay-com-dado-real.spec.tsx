/**
 * `useReplay` com dado de PROVEDOR — e o defeito que só aparece com dado real.
 *
 * ⭐⭐ O caso que importa é `array NOVO com o MESMO conteúdo não reinicia`. Com dado sintético
 * o array nasce de um `useMemo([])` e a identidade nunca muda, então o defeito era invisível.
 * A fonte da mesa (`useMesaBars`) devolve um array novo a cada re-render que ela provoca — e
 * ela provoca um a cada vez que a bandeira "carregando" vira. Com a decisão por IDENTIDADE, o
 * `ReplayController` era recriado, o timer morria e a posição voltava a ZERO no meio da
 * reprodução.
 *
 * ⚠️ Um caso reconstrói o comportamento antigo (efeito por identidade) para mostrar o
 * sintoma. Sem ele, os testes de "não reinicia" passariam por acaso.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { useReplay } from '../useReplay.js';
import type { ReplayBar } from '@robustus/charts-replay';

/** Série determinística de barras, no formato mínimo do replay. */
function serie(n: number, t0 = 1_700_000_000, passo = 300): ReplayBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * passo,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('replay sobre série de provedor', () => {
  it('reproduz a série que recebe, revelando aos poucos', () => {
    const bars = serie(10);
    const { result } = renderHook(() => useReplay({ bars, startAtEnd: false }));
    expect(result.current.state.length).toBe(10);
    expect(result.current.revealedBars).toHaveLength(0);
    act(() => result.current.step(3));
    expect(result.current.revealedBars).toHaveLength(3);
    expect(result.current.revealedBars[2]?.time).toBe(bars[2]?.time);
  });

  it('⭐⭐ array NOVO com o MESMO conteúdo NÃO reinicia a posição', () => {
    // É o que a fonte da mesa faz: mesmo dado, referência nova.
    const conteudo = serie(50);
    const { result, rerender } = renderHook(
      ({ bars }: { bars: readonly ReplayBar[] }) => useReplay({ bars }),
      { initialProps: { bars: conteudo as readonly ReplayBar[] } },
    );
    act(() => result.current.seek(20));
    expect(result.current.state.position).toBe(20);

    // Três re-renders, cada um com um array novo de conteúdo idêntico.
    for (let i = 0; i < 3; i += 1) rerender({ bars: [...conteudo] });

    expect(result.current.state.position, 'o replay voltou ao início').toBe(20);
    expect(result.current.revealedBars).toHaveLength(20);
  });

  it('⭐⭐ GUARDA: o efeito por IDENTIDADE zera a posição — é o defeito reconstruído', () => {
    // Reconstrução mínima do mundo antigo: efeito com dependência `[bars]` que reinicia.
    function useReplayAntigo(bars: readonly ReplayBar[]): {
      readonly position: number;
      readonly seek: (p: number) => void;
    } {
      const [position, setPosition] = useState(0);
      useEffect(() => {
        // Era isto: série "nova" ⇒ controlador novo, posição zero.
        setPosition(0);
      }, [bars]);
      return { position, seek: setPosition };
    }

    const conteudo = serie(50);
    const { result, rerender } = renderHook(
      ({ bars }: { bars: readonly ReplayBar[] }) => useReplayAntigo(bars),
      { initialProps: { bars: conteudo as readonly ReplayBar[] } },
    );
    act(() => result.current.seek(20));
    expect(result.current.position).toBe(20);
    rerender({ bars: [...conteudo] });
    // ⭐ O ESTRAGO: array novo, mesmo conteúdo, e a posição foi para zero.
    expect(result.current.position).toBe(0);
  });

  it('série de verdade DIFERENTE reinicia (troca de ativo, ou barra nova)', () => {
    const a = serie(50);
    const { result, rerender } = renderHook(
      ({ bars }: { bars: readonly ReplayBar[] }) => useReplay({ bars }),
      { initialProps: { bars: a as readonly ReplayBar[] } },
    );
    act(() => result.current.seek(20));
    expect(result.current.state.position).toBe(20);

    // Uma barra nova no fim: a última ponta mudou ⇒ é outra série.
    rerender({ bars: serie(51) });
    expect(result.current.state.position).toBe(0);
    expect(result.current.state.length).toBe(51);
  });

  it('⚠️ backfill (prepend) também é série nova — a primeira ponta mudou', () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: readonly ReplayBar[] }) => useReplay({ bars }),
      { initialProps: { bars: serie(50) as readonly ReplayBar[] } },
    );
    act(() => result.current.seek(10));
    // 20 barras ANTES do início: as posições todas deslocaram, e manter a posição apontaria
    // para outra barra em silêncio.
    rerender({ bars: serie(70, 1_700_000_000 - 20 * 300) });
    expect(result.current.state.position).toBe(0);
    expect(result.current.state.length).toBe(70);
  });

  it('série vazia não quebra, e passa a funcionar quando o dado chega', () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: readonly ReplayBar[] }) => useReplay({ bars }),
      { initialProps: { bars: [] as readonly ReplayBar[] } },
    );
    expect(result.current.state.length).toBe(0);
    expect(result.current.state.atEnd).toBe(true);
    expect(result.current.revealedBars).toEqual([]);

    // O dado da mesa chega depois da montagem — é sempre assim com fonte de rede.
    rerender({ bars: serie(30) });
    expect(result.current.state.length).toBe(30);
    act(() => result.current.step(5));
    expect(result.current.revealedBars).toHaveLength(5);
  });

  it('o play avança pelo timer, e pausar para de avançar', () => {
    vi.useFakeTimers();
    const bars = serie(40);
    const { result } = renderHook(() => useReplay({ bars, speed: 10, tickMs: 100 }));
    act(() => result.current.play());
    expect(result.current.state.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000); // 10 barras/s × 1 s
    });
    const depoisDeUmSegundo = result.current.state.position;
    expect(depoisDeUmSegundo, 'o timer não avançou nada — bancada vazia').toBeGreaterThan(0);
    act(() => result.current.pause());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state.position).toBe(depoisDeUmSegundo);
  });

  it('pausar no FIM não entra em laço', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReplay({ bars: serie(5), speed: 100, tickMs: 100 }));
    act(() => result.current.play());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state.position).toBe(5);
    expect(result.current.state.atEnd).toBe(true);
    expect(result.current.state.playing).toBe(false);
  });
});
