/**
 * ChartProvider — o motor num contexto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS TRAVAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ **`useChart` LANÇA fora do provedor.** O resto desta biblioteca trata falha como valor
 * de retorno, e aqui é o contrário de propósito: usar o hook fora do provedor é erro de
 * MONTAGEM do programador, sempre. Um `null` silencioso viraria um gráfico que não faz nada,
 * e o defeito seria procurado no dado. Quem quer tolerar usa `useChartOptional`.
 *
 * ⭐ **O valor de contexto é memoizado.** Se ele fosse um literal, todo consumidor do
 * contexto re-renderizaria a cada render do provedor — o oposto do que o provedor existe
 * para fazer (evitar que a árvore inteira acorde por causa do motor).
 *
 * ⚠️ **O provedor monta o container.** O motor mede o elemento e desenha NADA com altura
 * zero, sem erro — a armadilha número um da biblioteca. Deixar a `<div>` para o consumidor
 * seria distribuir essa armadilha.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChartProvider, useChart, useChartOptional } from '../ChartProvider.js';

afterEach(cleanup);

const VELAS = Array.from({ length: 30 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
}));

/** Sonda que expõe o que o contexto entregou. */
function Sonda(props: { readonly onValor?: (v: unknown) => void }): JSX.Element {
  const v = useChart();
  props.onValor?.(v);
  return (
    <span data-testid="sonda" data-id={v.id} data-tem-motor={v.engine === null ? 'nao' : 'sim'}>
      sonda
    </span>
  );
}

describe('ChartProvider — o container e a região', () => {
  it('monta o container do gráfico com rótulo acessível', () => {
    render(<ChartProvider candles={VELAS} ariaLabel="WINV26 em 5m" />);
    expect(screen.getByRole('img', { name: 'WINV26 em 5m' })).toBeDefined();
  });

  /**
   * ⚠️ `position: relative` no invólucro é REQUISITO das sobreposições (a `ChartLegend`
   * ancora nele). Sem isso a legenda escaparia para o primeiro ancestral posicionado — que
   * pode ser a janela inteira.
   */
  it('o invólucro é posicionado e pode encolher num pai flex', () => {
    const { container } = render(<ChartProvider candles={VELAS} />);
    const inv = container.firstElementChild as HTMLElement;
    expect(inv.style.position).toBe('relative');
    expect(inv.style.height).toBe('100%');
    expect(['0', '0px']).toContain(inv.style.minHeight);
  });

  it('altura e largura são sobrescrevíveis', () => {
    const { container } = render(<ChartProvider candles={VELAS} height="320px" width="50%" />);
    const inv = container.firstElementChild as HTMLElement;
    expect(inv.style.height).toBe('320px');
    expect(inv.style.width).toBe('50%');
  });

  it('renderiza os filhos SOBRE o gráfico, no mesmo invólucro', () => {
    const { container } = render(
      <ChartProvider candles={VELAS}>
        <div data-testid="sobreposicao" />
      </ChartProvider>,
    );
    const inv = container.firstElementChild as HTMLElement;
    // O container do canvas vem primeiro; a sobreposição, depois (por cima na ordem de
    // pintura, sem precisar de z-index).
    expect(inv.children).toHaveLength(2);
    expect(inv.children[1]!.getAttribute('data-testid')).toBe('sobreposicao');
  });
});

describe('⭐ useChart — o contrato do contexto', () => {
  it('entrega o motor e o id do painel', () => {
    render(
      <ChartProvider candles={VELAS} id="painel-h1">
        <Sonda />
      </ChartProvider>,
    );
    const sonda = screen.getByTestId('sonda');
    expect(sonda.getAttribute('data-id')).toBe('painel-h1');
    // Depois dos efeitos, o motor existe.
    expect(sonda.getAttribute('data-tem-motor')).toBe('sim');
  });

  it('o id default é `chart`', () => {
    render(
      <ChartProvider candles={VELAS}>
        <Sonda />
      </ChartProvider>,
    );
    expect(screen.getByTestId('sonda').getAttribute('data-id')).toBe('chart');
  });

  /**
   * ⚠️ `null` no PRIMEIRO render é normal: o motor nasce num efeito, depois de o container
   * existir no DOM. O tipo não mente dizendo que é sempre `ChartEngine`, e este caso
   * documenta a sequência para quem for consumir.
   */
  it('o motor é `null` no primeiro render e existe depois', () => {
    const vistos: Array<unknown> = [];
    render(
      <ChartProvider candles={VELAS}>
        <Sonda onValor={(v) => vistos.push((v as { engine: unknown }).engine)} />
      </ChartProvider>,
    );
    expect(vistos[0]).toBeNull();
    expect(vistos.at(-1)).not.toBeNull();
  });

  /**
   * ⭐ LANÇA fora do provedor, com mensagem que diz o que fazer. É erro de montagem, não
   * estado de dado — ver o cabeçalho.
   */
  it('LANÇA quando usado fora do provedor', () => {
    // O React registra o erro no console; silenciar mantém a saída da suíte legível.
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Solto(): JSX.Element {
      useChart();
      return <span />;
    }
    expect(() => render(<Solto />)).toThrow(/ChartProvider/);
    silencio.mockRestore();
  });

  it('`useChartOptional` devolve null fora do provedor, sem lançar', () => {
    function Solto(): JSX.Element {
      const v = useChartOptional();
      return <span data-testid="opt">{v === null ? 'fora' : 'dentro'}</span>;
    }
    expect(() => render(<Solto />)).not.toThrow();
    expect(screen.getByTestId('opt').textContent).toBe('fora');
  });

  it('`useChartOptional` devolve o contexto dentro do provedor', () => {
    function Dentro(): JSX.Element {
      const v = useChartOptional();
      return <span data-testid="opt">{v === null ? 'fora' : 'dentro'}</span>;
    }
    render(
      <ChartProvider candles={VELAS}>
        <Dentro />
      </ChartProvider>,
    );
    expect(screen.getByTestId('opt').textContent).toBe('dentro');
  });

  /**
   * ⭐ O valor de contexto é memoizado por (engine, id). Sem isso, todo consumidor do
   * contexto re-renderizaria a cada render do provedor — exatamente o custo que o provedor
   * existe para evitar.
   */
  it('o valor de contexto NÃO troca de identidade em re-render sem mudança', () => {
    const valores: unknown[] = [];
    const { rerender } = render(
      <ChartProvider candles={VELAS}>
        <Sonda onValor={(v) => valores.push(v)} />
      </ChartProvider>,
    );
    const depoisDoMotor = valores.at(-1);

    rerender(
      <ChartProvider candles={VELAS}>
        <Sonda onValor={(v) => valores.push(v)} />
      </ChartProvider>,
    );

    expect(valores.at(-1)).toBe(depoisDoMotor);
  });

  it('dois provedores na tela dão contextos INDEPENDENTES', () => {
    render(
      <>
        <ChartProvider candles={VELAS} id="a">
          <Sonda />
        </ChartProvider>
        <ChartProvider candles={VELAS} id="b">
          <Sonda />
        </ChartProvider>
      </>,
    );
    const ids = screen.getAllByTestId('sonda').map((s) => s.getAttribute('data-id'));
    // ⚠️ É o caso da comparação de períodos: dois gráficos, dois motores, e cada descendente
    // pega o motor do painel EM QUE ESTÁ. Um contexto global impediria isso.
    expect(ids).toEqual(['a', 'b']);
  });

  it('descarta o motor no desmonte', () => {
    let motor: { isDisposed: boolean } | null = null;
    const { unmount } = render(
      <ChartProvider candles={VELAS}>
        <Sonda
          onValor={(v) => {
            const e = (v as { engine: unknown }).engine;
            if (e !== null) motor = e as { isDisposed: boolean };
          }}
        />
      </ChartProvider>,
    );
    expect(motor).not.toBeNull();
    expect((motor as unknown as { isDisposed: boolean }).isDisposed).toBe(false);
    unmount();
    expect((motor as unknown as { isDisposed: boolean }).isDisposed).toBe(true);
  });
});
