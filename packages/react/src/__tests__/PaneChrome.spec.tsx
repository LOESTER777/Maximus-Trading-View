/**
 * O CROMO de sub-painel sobre o canvas.
 *
 * ⭐⭐ O caso que importa mais é `a camada NÃO captura ponteiro`: ela cobre TODA a área das
 * panes, e sem a guarda engoliria o pan, o zoom, o crosshair e o clique que abre propriedades de
 * indicador — o gráfico ficaria inerte e nada na tela explicaria por quê.
 *
 * ⭐ E o segundo é `reordenar por TECLADO`: arrastar é um gesto que exclui quem não usa mouse, e
 * uma reordenação só por arrasto seria um recurso inacessível por construção.
 *
 * ⚠️ Motor DUPLO, e não o real: em jsdom o container mede 0 px, então `paneRectOf` do motor
 * devolveria retângulos de altura zero e a camada filtraria tudo — o teste mediria vácuo. O duplo
 * deixa a geometria explícita.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { PaneChrome, type PaneChromeItem } from '../PaneChrome.js';

afterEach(cleanup);

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  row: number;
  column: number;
}

/** Motor duplo: geometria fixa, ordem mutável, e registro das chamadas. */
function motorDuplo(
  rects: Readonly<Record<number, Rect>>,
  ordem: number[] = [0, 1, 2, 3],
): {
  engine: Parameters<typeof PaneChrome>[0]['engine'];
  chamadas: { move: [number, number][] };
  emitirLayout: () => void;
} {
  const ouvintes = new Set<() => void>();
  const chamadas = { move: [] as [number, number][] };
  const engine = {
    api: {
      paneRectOf: (i: number) =>
        rects[i] ?? { left: 0, top: 0, width: 0, height: 0, row: -1, column: 0 },
      paneOrder: () => ordem,
      movePane: (i: number, pos: number) => {
        chamadas.move.push([i, pos]);
      },
      subscribeLayoutChange: (h: () => void) => ouvintes.add(h),
      unsubscribeLayoutChange: (h: () => void) => ouvintes.delete(h),
    },
  };
  return { engine, chamadas, emitirLayout: () => ouvintes.forEach((h) => h()) };
}

const RECTS_EMPILHADO: Record<number, Rect> = {
  0: { left: 0, top: 0, width: 800, height: 300, row: -1, column: 0 },
  1: { left: 0, top: 300, width: 800, height: 90, row: 0, column: 0 },
  2: { left: 0, top: 390, width: 800, height: 90, row: 1, column: 0 },
};

function itens(over: Partial<PaneChromeItem> = {}): PaneChromeItem[] {
  return [
    { paneIndex: 1, label: 'RSI', color: '#38bdf8', detail: '14', ...over },
    { paneIndex: 2, label: 'MACD', color: '#fbbf24' },
  ];
}

/**
 * Um evento de ponteiro utilizável.
 *
 * ⚠️ jsdom NÃO implementa `PointerEvent` (é requisito conhecido deste projeto), e o
 * `fireEvent.pointerMove` do Testing Library descarta `clientX`/`clientY` quando cai no
 * construtor genérico. Sem isto o teste de arrasto mediria movimento em (0,0) e passaria por
 * vacuidade — é o mesmo padrão dos helpers `ponteiro()` das bancadas de `chart-core`.
 */
function ponteiro(type: string, init: MouseEventInit & { pointerId?: number }): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, buttons: 1, ...init });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

/** Alinha o retângulo da camada com o espaço lógico do motor duplo. */
function alinharCamada(container: HTMLElement): void {
  const camada = container.querySelector('.robustus-pane-chrome') as HTMLElement | null;
  if (camada === null) return;
  camada.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

describe('PaneChrome', () => {
  it('sem motor não desenha nada', () => {
    const { container } = render(<PaneChrome engine={null} items={itens()} />);
    expect(container.firstChild).toBeNull();
  });

  it('desenha uma faixa por sub-painel, alinhada ao retângulo dele', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const { container } = render(<PaneChrome engine={engine} items={itens()} />);
    const faixas = container.querySelectorAll('[data-pane-index]');
    expect(faixas).toHaveLength(2);
    const rsi = container.querySelector('[data-pane-index="1"]') as HTMLElement;
    expect(rsi.style.top).toBe('300px');
    expect(rsi.style.height).toBe('90px');
    expect(screen.getByText(/RSI/)).toBeTruthy();
  });

  it('⭐⭐ a CAMADA não captura ponteiro; os controles sim', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const { container } = render(
      <PaneChrome
        engine={engine}
        items={[{ paneIndex: 1, label: 'RSI', visible: true, onToggleVisible: () => undefined }]}
        onReorder={() => undefined}
      />,
    );
    const camada = container.querySelector('.robustus-pane-chrome') as HTMLElement;
    expect(camada.style.pointerEvents).toBe('none');
    // A faixa por pane também não captura: só a caixinha de controles dentro dela.
    const faixa = container.querySelector('[data-pane-index="1"]') as HTMLElement;
    expect(faixa.style.pointerEvents).toBe('none');
    const caixa = faixa.firstElementChild as HTMLElement;
    expect(caixa.style.pointerEvents).toBe('auto');
  });

  it('⚠️ pane COLAPSADA (altura zero) não recebe faixa', () => {
    // Uma faixa flutuando sobre a pane vizinha seria pior que nenhuma.
    const { engine } = motorDuplo({
      ...RECTS_EMPILHADO,
      2: { left: 0, top: 480, width: 800, height: 0, row: -1, column: 0 },
    });
    const { container } = render(<PaneChrome engine={engine} items={itens()} />);
    expect(container.querySelectorAll('[data-pane-index]')).toHaveLength(1);
  });

  it('a POSIÇÃO vem da ordem do motor, não da ordem dos itens', () => {
    // ⚠️ O índice é estável e nunca reusado; a posição muda com `movePane`. Derivar posição do
    // índice daria o destino errado depois da primeira reordenação.
    const { engine } = motorDuplo(RECTS_EMPILHADO, [0, 2, 1]);
    const { container } = render(<PaneChrome engine={engine} items={itens()} />);
    expect((container.querySelector('[data-pane-index="2"]') as HTMLElement).dataset['panePosition']).toBe('0');
    expect((container.querySelector('[data-pane-index="1"]') as HTMLElement).dataset['panePosition']).toBe('1');
  });

  it('relê a geometria quando o motor AVISA', () => {
    const rects: Record<number, Rect> = { ...RECTS_EMPILHADO };
    const { engine, emitirLayout } = motorDuplo(rects);
    const { container } = render(<PaneChrome engine={engine} items={itens()} />);
    expect((container.querySelector('[data-pane-index="1"]') as HTMLElement).style.top).toBe('300px');
    // O motor remediu (janela redimensionada, indicador ligado).
    rects[1] = { left: 0, top: 200, width: 800, height: 120, row: 0, column: 0 };
    // ⚠️ `act`: o aviso do motor vem de FORA do React (é um `Set` de callbacks), então o
    // `setState` dele não é enfileirado pelo Testing Library sozinho.
    act(() => emitirLayout());
    expect((container.querySelector('[data-pane-index="1"]') as HTMLElement).style.top).toBe('200px');
  });

  it('⭐ ARRASTAR a alça reordena, e o destino é dito na tela', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const onReorder = vi.fn();
    const { container } = render(
      <PaneChrome engine={engine} items={itens()} onReorder={onReorder} />,
    );
    alinharCamada(container);
    const alca = screen.getByRole('button', { name: /Mover RSI/ });

    act(() => {
      alca.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 100, clientY: 340 }));
    });
    // Move para dentro do retângulo da pane 2 (posição 1).
    act(() => {
      alca.dispatchEvent(ponteiro('pointermove', { clientX: 400, clientY: 430 }));
    });
    // ⭐ O destino é dito por uma borda na pane inteira: numa GRADE em colunas, "entre" é
    // ambíguo, e "esta pane troca de lugar com a sua" não é.
    const alvo = container.querySelector('[data-pane-index="2"]') as HTMLElement;
    expect(alvo.style.outline).toMatch(/dashed/);

    act(() => {
      alca.dispatchEvent(ponteiro('pointerup', { clientX: 400, clientY: 430 }));
    });
    expect(onReorder).toHaveBeenCalledWith(1, 1);
  });

  it('soltar na MESMA posição não reordena', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const onReorder = vi.fn();
    const { container } = render(
      <PaneChrome engine={engine} items={itens()} onReorder={onReorder} />,
    );
    alinharCamada(container);
    const alca = screen.getByRole('button', { name: /Mover RSI/ });
    act(() => {
      alca.dispatchEvent(ponteiro('pointerdown', { button: 0, clientX: 100, clientY: 340 }));
    });
    act(() => {
      alca.dispatchEvent(ponteiro('pointermove', { clientX: 400, clientY: 340 }));
    });
    act(() => {
      alca.dispatchEvent(ponteiro('pointerup', { clientX: 400, clientY: 340 }));
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('⭐⭐ reordena por TECLADO com Alt+setas', () => {
    // Arrastar é um gesto que exclui quem não usa mouse: uma reordenação só por arrasto seria
    // inacessível por construção.
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const onReorder = vi.fn();
    render(<PaneChrome engine={engine} items={itens()} onReorder={onReorder} />);
    const alca = screen.getByRole('button', { name: /Mover RSI/ });
    fireEvent.keyDown(alca, { key: 'ArrowDown', altKey: true });
    expect(onReorder).toHaveBeenCalledWith(1, 1);
    fireEvent.keyDown(alca, { key: 'ArrowUp', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, -1);
  });

  it('⚠️ seta SEM Alt não reordena (setas soltas rolam a página)', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const onReorder = vi.fn();
    render(<PaneChrome engine={engine} items={itens()} onReorder={onReorder} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Mover RSI/ }), { key: 'ArrowDown' });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('sem `onReorder` a alça NÃO é renderizada', () => {
    // Alça que não move é pior que ausência: o operador arrasta, nada acontece, e conclui que a
    // ferramenta está quebrada.
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    render(<PaneChrome engine={engine} items={itens()} />);
    expect(screen.queryByRole('button', { name: /Mover/ })).toBeNull();
  });

  it('os botões de ação chamam o consumidor', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const esconder = vi.fn();
    const remover = vi.fn();
    const abrir = vi.fn();
    render(
      <PaneChrome
        engine={engine}
        items={[
          {
            paneIndex: 1,
            label: 'RSI',
            visible: true,
            onToggleVisible: esconder,
            onRemove: remover,
            onOpenSettings: abrir,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar RSI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover RSI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Propriedades de RSI' }));
    expect(esconder).toHaveBeenCalledTimes(1);
    expect(remover).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it('`visible: undefined` esconde o botão de visibilidade; `false` mostra o estado oculto', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const { rerender } = render(
      <PaneChrome engine={engine} items={[{ paneIndex: 1, label: 'RSI' }]} />,
    );
    expect(screen.queryByRole('button', { name: /Ocultar|Mostrar/ })).toBeNull();
    rerender(
      <PaneChrome
        engine={engine}
        items={[{ paneIndex: 1, label: 'RSI', visible: false, onToggleVisible: () => undefined }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mostrar RSI' })).toBeTruthy();
  });

  it('funciona com a grade em COLUNAS (dois retângulos na mesma faixa de Y)', () => {
    const { engine } = motorDuplo({
      0: { left: 0, top: 0, width: 800, height: 300, row: -1, column: 0 },
      1: { left: 0, top: 300, width: 400, height: 100, row: 0, column: 0 },
      2: { left: 400, top: 300, width: 400, height: 100, row: 0, column: 1 },
    });
    const { container } = render(<PaneChrome engine={engine} items={itens()} />);
    const a = container.querySelector('[data-pane-index="1"]') as HTMLElement;
    const b = container.querySelector('[data-pane-index="2"]') as HTMLElement;
    expect(a.style.left).toBe('0px');
    expect(b.style.left).toBe('400px');
    expect(a.style.top).toBe(b.style.top);
  });

  it('item de pane inexistente é descartado, sem lançar', () => {
    const { engine } = motorDuplo(RECTS_EMPILHADO);
    const { container } = render(
      <PaneChrome engine={engine} items={[{ paneIndex: 99, label: 'Fantasma' }]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
