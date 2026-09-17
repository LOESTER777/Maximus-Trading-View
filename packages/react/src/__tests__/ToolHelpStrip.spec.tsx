/**
 * A faixa de AUXÍLIO da ferramenta armada.
 *
 * ⭐⭐ O caso que importa mais é `NÃO captura ponteiro`: a faixa fica SOBRE a área de desenho, e
 * o gesto que ela explica é justamente um clique ali. Sem `pointerEvents: 'none'` ela engoliria o
 * primeiro clique da ferramenta que acabou de ser escolhida — o defeito mais irônico possível
 * para uma ajuda, e invisível num teste que só verifique o texto.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ToolHelpStrip } from '../ToolHelpStrip.js';

afterEach(cleanup);

describe('ToolHelpStrip', () => {
  it('⚠️ o modo de SELEÇÃO não desenha nada — faixa permanente é ruído', () => {
    const { container } = render(<ToolHelpStrip tool={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('mostra o nome e os passos da ferramenta armada', () => {
    render(<ToolHelpStrip tool="POSITION_LONG" />);
    expect(screen.getByText('Posição de compra')).toBeTruthy();
    const passos = screen.getAllByRole('listitem');
    expect(passos.length).toBeGreaterThan(1);
    // ⭐ A ordem das âncoras é o que o operador não adivinha: entrada primeiro, stop depois.
    expect(passos[0]?.textContent).toMatch(/ENTRADA/);
    expect(passos[1]?.textContent).toMatch(/STOP/);
  });

  it('⭐⭐ NÃO captura ponteiro — só o botão de fechar é clicável', () => {
    const { container } = render(<ToolHelpStrip tool="MEASURE" />);
    const faixa = container.firstElementChild as HTMLElement;
    expect(faixa.style.pointerEvents).toBe('none');
    const fechar = screen.getByRole('button');
    expect(fechar.style.pointerEvents).toBe('auto');
  });

  it('⚠️ é `status` com `aria-live` polido, e não `alert`', () => {
    // `alert` faria o leitor de tela cortar o que estivesse falando a cada troca de ferramenta.
    render(<ToolHelpStrip tool="RECTANGLE" />);
    const faixa = screen.getByRole('status');
    expect(faixa.getAttribute('aria-live')).toBe('polite');
  });

  it('⭐ fechar cala a ajuda DAQUELA ferramenta, e a de outra volta', () => {
    const { rerender } = render(<ToolHelpStrip tool="MEASURE" />);
    expect(screen.queryByText('Régua')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Régua')).toBeNull();

    // Outra ferramenta: a ajuda aparece. Um "não mostrar mais" global calaria justamente o caso
    // em que ela serve — a ferramenta que o operador nunca usou.
    rerender(<ToolHelpStrip tool="FIB_EXTENSION" />);
    expect(screen.queryByText('Extensão de Fibonacci')).toBeTruthy();
  });

  it('a linha de AJUSTE pode ser desligada, e some quando não há o que dizer', () => {
    const { rerender } = render(<ToolHelpStrip tool="HORIZONTAL_RAY" />);
    expect(screen.getByText(/não era resistência/i)).toBeTruthy();
    rerender(<ToolHelpStrip tool="HORIZONTAL_RAY" showAdjust={false} />);
    expect(screen.queryByText(/não era resistência/i)).toBeNull();
    // `VERTICAL_LINE` não tem ajuste: nada é renderizado no lugar.
    rerender(<ToolHelpStrip tool="VERTICAL_LINE" />);
    expect(screen.getByText('Linha vertical')).toBeTruthy();
  });

  it('⚠️ ancora embaixo por default (o topo é da fita OHLC e da trilha de legendas)', () => {
    const { container, rerender } = render(<ToolHelpStrip tool="ARROW" />);
    expect((container.firstElementChild as HTMLElement).style.bottom).not.toBe('');
    rerender(<ToolHelpStrip tool="ARROW" anchor="top" />);
    expect((container.firstElementChild as HTMLElement).style.top).not.toBe('');
  });
});
