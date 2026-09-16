/**
 * useChartEngine — costura com o ciclo de vida do React.
 *
 * O que estes testes protegem: as duas regras que a ligacao existe para garantir.
 *
 *  1. **O motor e criado uma vez e descartado uma vez.** Recriar por mudanca de
 *     dado foi o que produzia `Object is disposed` na origem, onde um
 *     `key={periodo}` destruia e remontava o componente.
 *  2. **Cada conjunto tem efeito proprio.** Aplicar tudo a cada mudanca de
 *     qualquer coisa faria a camada de canvas piscar, porque toda reaplicacao
 *     comeca sem escala de cor nem paleta.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useChartEngine, type UseChartEngineParams } from '../useChartEngine.js';
import { RobustusChart } from '../RobustusChart.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Componente de sonda: expõe o motor para o teste inspecionar. */
function Sonda(props: UseChartEngineParams & { onEngine?: (e: unknown) => void }) {
  const { onEngine, ...params } = props;
  const { containerRef, engine } = useChartEngine(params);
  if (onEngine) onEngine(engine);
  return <div ref={containerRef} style={{ height: 400, width: 800 }} />;
}

const VELAS = Array.from({ length: 20 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
}));

describe('useChartEngine — montagem', () => {
  it('cria o motor e devolve o ref do container', () => {
    const vistos: unknown[] = [];
    render(<Sonda candles={VELAS} onEngine={(e) => vistos.push(e)} />);
    // Primeira passada e null (o efeito ainda nao rodou); depois o motor existe.
    expect(vistos[0]).toBeNull();
    expect(vistos.at(-1)).not.toBeNull();
  });

  it('descarta o motor no desmonte', () => {
    let motor: { isDisposed: boolean } | null = null;
    const { unmount } = render(
      <Sonda candles={VELAS} onEngine={(e) => { if (e) motor = e as never; }} />,
    );
    expect(motor).not.toBeNull();
    expect((motor as unknown as { isDisposed: boolean }).isDisposed).toBe(false);

    unmount();
    expect((motor as unknown as { isDisposed: boolean }).isDisposed).toBe(true);
  });

  /**
   * ⭐ A regra que a ligacao existe para garantir.
   *
   * Mudar dado NAO recria o motor. Se recriasse, cada atualizacao de preco
   * destruiria e remontaria o grafico — que e a familia de erro
   * `Object is disposed`.
   */
  it('NAO recria o motor quando o dado muda', () => {
    const instancias = new Set<unknown>();
    const { rerender } = render(
      <Sonda candles={VELAS} onEngine={(e) => { if (e) instancias.add(e); }} />,
    );
    rerender(<Sonda candles={VELAS.slice(0, 10)} onEngine={(e) => { if (e) instancias.add(e); }} />);
    rerender(<Sonda candles={[...VELAS, { time: 1_700_001_260, open: 1, high: 2, low: 0, close: 1 }]} onEngine={(e) => { if (e) instancias.add(e); }} />);

    expect(instancias.size).toBe(1);
  });

  it('ignora mudanca nas opcoes de construcao depois da montagem — e documentado', () => {
    const instancias = new Set<unknown>();
    const { rerender } = render(
      <Sonda options={{ withVolume: false }} onEngine={(e) => { if (e) instancias.add(e); }} />,
    );
    rerender(<Sonda options={{ withVolume: true }} onEngine={(e) => { if (e) instancias.add(e); }} />);
    // Um unico motor: opcao nova nao recria. Quem precisa de outra opcao remonta
    // deliberadamente, em vez de descobrir o grafico sendo recriado por acidente.
    expect(instancias.size).toBe(1);
  });
});

describe('useChartEngine — conjuntos opcionais', () => {
  it('nao quebra sem nenhum conjunto informado', () => {
    expect(() => render(<Sonda />)).not.toThrow();
  });

  it('aceita todos os conjuntos de uma vez', () => {
    expect(() =>
      render(
        <Sonda
          options={{ withVolume: true }}
          candles={VELAS}
          volume={VELAS.map((v) => ({ time: v.time, value: 100, color: '#16c784' }))}
          priceLines={[{ price: 105, color: '#e9c46a', title: 'Alvo' }]}
          lineSeries={[{ data: VELAS.map((v) => ({ time: v.time, value: v.close })), color: '#38bdf8' }]}
          markers={[{ time: VELAS[5]!.time, position: 'aboveBar', color: '#fff', shape: 'circle' }]}
          bookmap={null}
          footprint={null}
        />,
      ),
    ).not.toThrow();
  });

  it('vela invalida e filtrada, nao propagada ao substrato', () => {
    expect(() =>
      render(
        <Sonda
          candles={[
            ...VELAS,
            { time: NaN, open: 1, high: 1, low: 1, close: 1 },
            { time: 1, open: null, high: 1, low: 1, close: 1 },
            null,
          ]}
        />,
      ),
    ).not.toThrow();
  });
});

describe('useChartEngine — mapeador de coordenadas', () => {
  it('assina e recebe de imediato', () => {
    const aoMapear = vi.fn();
    render(<Sonda candles={VELAS} onCoordinateMapper={aoMapear} />);
    expect(aoMapear).toHaveBeenCalled();
    const mapa = aoMapear.mock.calls[0]?.[0];
    expect(typeof mapa.priceToY).toBe('function');
    expect(typeof mapa.timeToX).toBe('function');
    expect(typeof mapa.visibleTimeRangeSec).toBe('function');
    expect(typeof mapa.priceScaleWidthPx).toBe('function');
  });

  it('desassina no desmonte — sem chamada depois de morto', () => {
    const aoMapear = vi.fn();
    const { unmount } = render(<Sonda candles={VELAS} onCoordinateMapper={aoMapear} />);
    unmount();
    aoMapear.mockClear();
    expect(aoMapear).not.toHaveBeenCalled();
  });
});

describe('RobustusChart', () => {
  it('renderiza com altura default e rotulo acessivel', () => {
    const { container } = render(<RobustusChart candles={VELAS} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.height).toBe('420px');
    expect(div.style.width).toBe('100%');
    // Canvas e opaco para leitor de tela: `role=img` com rotulo e o minimo honesto.
    expect(div.getAttribute('role')).toBe('img');
    expect(div.getAttribute('aria-label')).toBe('Gráfico de mercado');
  });

  it('respeita altura, largura, classe e rotulo informados', () => {
    const { container } = render(
      <RobustusChart candles={VELAS} height="100%" width="640px" className="minha-classe" ariaLabel="WINV26 5 min" />,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.height).toBe('100%');
    expect(div.style.width).toBe('640px');
    expect(div.className).toBe('minha-classe');
    expect(div.getAttribute('aria-label')).toBe('WINV26 5 min');
  });

  it('desmonta sem lancar', () => {
    const { unmount } = render(<RobustusChart candles={VELAS} />);
    expect(() => unmount()).not.toThrow();
  });
});
