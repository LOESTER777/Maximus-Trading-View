/**
 * TimeframeSelector — a seleção de período, e a decisão de não encher a tela de botões.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS TRAVAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ **A repartição rápidos/menu.** Nove períodos como nove botões seriam nove botões, e o
 * pedido explícito foi o oposto ("não se pode encher a tela de botões"). O que se usa a
 * toda hora fica visível; o resto fica a um clique.
 *
 * ⚠️ **O período corrente pode não estar entre os rápidos.** Aí o grupo de botões fica SEM
 * seleção e quem mostra o período é o menu. O botão de H1 não pode parecer ativo com o
 * gráfico em H4 — seria a interface mentindo sobre o estado.
 *
 * ⚠️ **A lista é INJETADA.** Este pacote não importa o datafeed; o teste passa a lista à
 * mão, que é exatamente o que o consumidor faz com `TIMEFRAMES`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TimeframeSelector, type TimeframeOption } from '../TimeframeSelector.js';

afterEach(cleanup);

const LISTA: readonly TimeframeOption[] = [
  { id: 'M1', seconds: 60, label: '1m', labelLongo: '1 minuto' },
  { id: 'M5', seconds: 300, label: '5m', labelLongo: '5 minutos' },
  { id: 'M15', seconds: 900, label: '15m', labelLongo: '15 minutos' },
  { id: 'M30', seconds: 1800, label: '30m', labelLongo: '30 minutos' },
  { id: 'H1', seconds: 3600, label: '1h', labelLongo: '1 hora' },
  { id: 'H4', seconds: 14_400, label: '4h', labelLongo: '4 horas' },
  { id: 'D1', seconds: 86_400, label: '1D', labelLongo: '1 dia' },
];

function grupo(): HTMLElement {
  return screen.getByRole('radiogroup', { name: 'Período do gráfico' });
}

describe('TimeframeSelector — rápidos como botão, o resto no menu', () => {
  it('mostra os rápidos como botões e o resto num select', () => {
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={() => {}} />);

    // Default: M1/M5/M15/H1/D1 viram botão.
    const botoes = within(grupo()).getAllByRole('radio');
    expect(botoes.map((b) => b.textContent)).toEqual(['1m', '5m', '15m', '1h', '1D']);

    // M30 e H4 sobraram para o menu.
    const menu = screen.getByLabelText('Outros períodos') as HTMLSelectElement;
    const valores = Array.from(menu.options).map((o) => o.value);
    expect(valores).toContain('M30');
    expect(valores).toContain('H4');
    expect(valores).not.toContain('M5');
  });

  it('clicar num rápido devolve o PERÍODO inteiro, não só o id', () => {
    const onChange = vi.fn();
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={onChange} />);
    fireEvent.click(within(grupo()).getByRole('radio', { name: /15m/ }));
    // ⭐ O objeto inteiro: quem recebe precisa do `seconds` para pedir barras, e derivá-lo
    // do id obrigaria o consumidor a manter a própria tabela de tradução.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'M15', seconds: 900 }),
    );
  });

  it('escolher pelo menu também devolve o período', () => {
    const onChange = vi.fn();
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Outros períodos'), { target: { value: 'H4' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'H4', seconds: 14_400 }));
  });

  it('o rápido corrente está marcado', () => {
    render(<TimeframeSelector timeframes={LISTA} value="M15" onChange={() => {}} />);
    const marcado = within(grupo())
      .getAllByRole('radio')
      .find((b) => b.getAttribute('aria-checked') === 'true');
    expect(marcado?.textContent).toBe('15m');
  });

  /**
   * ⭐ O CASO QUE IMPEDE A INTERFACE DE MENTIR: com o gráfico em H4 (que está no menu),
   * NENHUM botão pode aparecer ativo, e o menu mostra H4.
   */
  it('período do MENU: nenhum botão ativo, e o menu o mostra', () => {
    render(<TimeframeSelector timeframes={LISTA} value="H4" onChange={() => {}} />);
    const ativos = within(grupo())
      .getAllByRole('radio')
      .filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(ativos).toHaveLength(0);
    expect((screen.getByLabelText('Outros períodos') as HTMLSelectElement).value).toBe('H4');
  });

  /**
   * ⚠️ E o inverso: com um rápido selecionado, o menu fica na opção neutra. Sem ela o menu
   * mostraria um período que não é o do gráfico.
   */
  it('período de BOTÃO deixa o menu na opção neutra', () => {
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={() => {}} />);
    expect((screen.getByLabelText('Outros períodos') as HTMLSelectElement).value).toBe('');
  });

  it('`quick` próprio muda quem é botão', () => {
    render(
      <TimeframeSelector
        timeframes={LISTA}
        value="D1"
        quick={['H4', 'D1']}
        onChange={() => {}}
      />,
    );
    expect(within(grupo()).getAllByRole('radio').map((b) => b.textContent)).toEqual(['4h', '1D']);
  });

  /**
   * ⚠️ `quick` pode citar um período que a lista não tem (o consumidor filtrou por
   * `timeframesAgregaveisDe`). Citar não pode CRIAR botão — seria oferecer o que não dá
   * para entregar.
   */
  it('`quick` que cita período ausente não inventa botão', () => {
    const soLongos = LISTA.filter((t) => t.seconds >= 3600);
    render(
      <TimeframeSelector
        timeframes={soLongos}
        value="H1"
        quick={['M1', 'M5', 'H1']}
        onChange={() => {}}
      />,
    );
    expect(within(grupo()).getAllByRole('radio').map((b) => b.textContent)).toEqual(['1h']);
  });

  it('todos os períodos como rápidos: nenhum menu é renderizado', () => {
    render(
      <TimeframeSelector
        timeframes={LISTA.slice(0, 3)}
        value="M1"
        quick={['M1', 'M5', 'M15']}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Outros períodos')).toBeNull();
  });

  it('nenhum rápido presente: só o menu, sem grupo vazio', () => {
    render(
      <TimeframeSelector timeframes={LISTA} value="M30" quick={[]} onChange={() => {}} />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect((screen.getByLabelText('Outros períodos') as HTMLSelectElement).value).toBe('M30');
  });

  it('lista vazia não lança e não renderiza controle nenhum', () => {
    expect(() => {
      render(<TimeframeSelector timeframes={[]} value="M5" onChange={() => {}} />);
    }).not.toThrow();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText('Outros períodos')).toBeNull();
  });

  /**
   * ⚠️ O `<label>` do menu é visualmente escondido, não ausente: um `<select>` sem nome
   * acessível é anunciado como "caixa de combinação" e nada mais, e `title` não substitui
   * `<label>` (leitor de tela pode ignorá-lo).
   */
  it('o menu tem nome acessível', () => {
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={() => {}} />);
    expect(screen.getByLabelText('Outros períodos').tagName).toBe('SELECT');
  });

  it('o grupo de rápidos tem nome acessível', () => {
    render(<TimeframeSelector timeframes={LISTA} value="M5" onChange={() => {}} />);
    expect(grupo()).toBeDefined();
  });
});
