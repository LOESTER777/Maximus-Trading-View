/**
 * Tooltip + DrawingToolbar — a barra de desenho e a bolha que a explica.
 *
 * O que estes testes protegem, na ordem em que doeria se quebrasse:
 *
 *  1. **⭐ O atalho de tecla unica e IGNORADO com foco em campo de texto.** E o
 *     defeito real e caro: sem a guarda, digitar "PETR4" num campo de simbolo
 *     ativa o retangulo no `R` e a proxima vez que o operador clicar no grafico
 *     ele desenha sem querer. Ha teste explicito, e ha teste do caminho oposto
 *     (foco fora de campo -> o atalho FUNCIONA), porque uma guarda larga demais
 *     desligaria o atalho por inteiro e o teste "ignora" passaria igual.
 *  2. **O tooltip abre no FOCO, nao so no hover.** Quem navega por teclado percorre
 *     os mesmos treze icones e precisa da mesma explicacao. Este e o teste que
 *     reprova a regressao de "so hover", que e o estado padrao de quem escreve
 *     tooltip sem pensar em teclado.
 *  3. **`aria-describedby` liga o botao a bolha, sem apagar o `aria-label`.** O
 *     nome curto e a frase de explicacao sao papeis distintos.
 *  4. **Recolher esconde os grupos mas MANTEM o cursor.** Recolher escondendo tudo
 *     prenderia o operador na ferramenta ativa sem forma de sair.
 *  5. **Roving tabindex.** Um botao com `tabIndex=0`, os outros com `-1`, e a seta
 *     movendo o foco. E ha teste da armadilha: item desabilitado nao pode carregar
 *     o `tabIndex=0`, senao a barra inteira sai da ordem de tabulacao.
 *
 * ⚠️ **Sobre `fireEvent` e hover:** React NAO ouve `mouseenter` — ele sintetiza
 * `onMouseEnter` a partir de `mouseover`/`mouseout` no nó raiz. `fireEvent.mouseEnter`
 * nao dispara o manipulador; `fireEvent.mouseOver` dispara. Isso e do React, nao do
 * componente, e e por isso que os testes usam `mouseOver`/`mouseOut`.
 *
 * ⚠️ **Sobre foco:** `element.focus()` de verdade (do jsdom) e usado em vez de
 * `fireEvent.focus`, porque em React 18 `onFocus` e implementado sobre `focusin`, e
 * `fireEvent.focus` dispara apenas `focus` — que nao borbulha e nao chega ao wrapper.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ActiveTool, Drawing } from '@robustus/charts-drawings';
import { Tooltip } from '../Tooltip.js';
import { DrawingToolbar } from '../DrawingToolbar.js';
import type { UseDrawingsResult } from '../useDrawings.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// Um `UseDrawingsResult` de mentira
// ═════════════════════════════════════════════════════════════════════════════
//
// A barra e uma peca de APRESENTACAO: ela nao precisa de motor, de canvas nem de
// controlador para ser verificada. Montar o `ChartEngine` aqui trocaria um teste de
// interface por um teste de integracao lento e ainda dependente do jsdom sem
// contexto 2D.

interface DubleOpcoes {
  readonly tool?: ActiveTool;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly selectedIds?: readonly string[];
}

function fakeDrawings(over: DubleOpcoes = {}): UseDrawingsResult & {
  readonly chamadas: { readonly tools: ActiveTool[]; readonly acoes: string[] };
} {
  const tools: ActiveTool[] = [];
  const acoes: string[] = [];
  return {
    controller: null,
    drawings: [] as readonly Drawing[],
    selectedIds: over.selectedIds ?? [],
    interaction: { kind: 'IDLE' },
    tool: over.tool ?? null,
    setTool: (t) => {
      tools.push(t);
    },
    canUndo: over.canUndo ?? false,
    canRedo: over.canRedo ?? false,
    undo: () => {
      acoes.push('undo');
    },
    redo: () => {
      acoes.push('redo');
    },
    deleteSelected: () => {
      acoes.push('delete');
    },
    load: () => undefined,
    chamadas: { tools, acoes },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tooltip
// ═════════════════════════════════════════════════════════════════════════════

describe('Tooltip', () => {
  it('liga o botao a bolha por aria-describedby, sem tocar no aria-label', () => {
    render(
      <Tooltip label="Régua" hint="Mede variação em preço, % e barras" shortcut="M">
        <button type="button" aria-label="Régua">
          ícone
        </button>
      </Tooltip>,
    );

    const botao = screen.getByRole('button', { name: 'Régua' });
    const descrito = botao.getAttribute('aria-describedby');
    expect(descrito).toBeTruthy();
    // O rotulo curto sobreviveu: a bolha e DESCRICAO, nao substituto do nome.
    expect(botao.getAttribute('aria-label')).toBe('Régua');

    // A bolha existe no DOM mesmo fechada — senao o `aria-describedby` apontaria
    // para um id inexistente justamente quando o foco chega.
    const bolha = document.getElementById(descrito ?? '');
    expect(bolha).not.toBeNull();
    expect(bolha?.getAttribute('role')).toBe('tooltip');
    expect(bolha?.textContent).toContain('Mede variação em preço');
  });

  it('fica fechada ate o atraso vencer, e entao abre no hover', () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Ímã" hint="Prende o ponto na barra mais próxima" delayMs={350}>
        <button type="button" aria-label="Ímã" />
      </Tooltip>,
    );

    expect(screen.queryByRole('tooltip')).toBeNull();

    // ⚠️ `mouseOver`, nao `mouseEnter` — ver o cabecalho.
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Ímã' }));

    // Antes do atraso nao ha bolha: e o que impede o pisca-pisca ao atravessar a
    // barra com o cursor.
    act(() => {
      vi.advanceTimersByTime(340);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByRole('tooltip').textContent).toContain('Prende o ponto');
  });

  it('fecha imediatamente ao sair com o mouse', () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Raio" hint="Projeta o rumo para a frente">
        <button type="button" aria-label="Raio" />
      </Tooltip>,
    );
    const botao = screen.getByRole('button', { name: 'Raio' });

    fireEvent.mouseOver(botao);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    fireEvent.mouseOut(botao);
    // Sem avancar o relogio: fechar e imediato, so abrir tem atraso.
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('⭐ abre NO FOCO por teclado, sem esperar o atraso', () => {
    render(
      <Tooltip label="Fibonacci" hint="Traça 23,6%, 38,2%, 50% e 61,8%" shortcut="F">
        <button type="button" aria-label="Fibonacci" />
      </Tooltip>,
    );
    const botao = screen.getByRole('button', { name: 'Fibonacci' });

    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      botao.focus();
    });

    const bolha = screen.getByRole('tooltip');
    expect(bolha.textContent).toContain('Traça 23,6%');
    // O atalho e anunciado no mesmo lugar: quem le a descricao aprende a tecla.
    expect(bolha.textContent).toContain('F');
  });

  it('fecha com Escape', () => {
    render(
      <Tooltip label="Retângulo" hint="Delimita região de preço e tempo">
        <button type="button" aria-label="Retângulo" />
      </Tooltip>,
    );
    act(() => {
      screen.getByRole('button', { name: 'Retângulo' }).focus();
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    // ⚠️ No DOCUMENTO: a bolha pode estar aberta por hover com o foco em outro
    // lugar, e nesse caso nenhum keydown passaria pelo wrapper.
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('nao abre pelo foco que vem de um clique de mouse (a bolha presa)', () => {
    render(
      <Tooltip label="Selecionar" hint="Escolhe e arrasta desenho já traçado">
        <button type="button" aria-label="Selecionar" />
      </Tooltip>,
    );
    const botao = screen.getByRole('button', { name: 'Selecionar' });

    // pointerdown -> focus e a sequencia de um clique. O caminho de hover ja
    // governa o mouse; abrir de novo pelo foco deixaria a bolha na tela depois de
    // o cursor sair, tapando o grafico.
    fireEvent.pointerDown(botao);
    act(() => {
      botao.focus();
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('degrada sem lancar quando o filho nao e um elemento unico', () => {
    // Disciplina da camada: falha e valor, nunca excecao. Aqui "falha" e nao poder
    // injetar `aria-describedby` — o tooltip visual continua existindo.
    expect(() =>
      render(
        <Tooltip label="Texto solto" hint="sem elemento para descrever">
          apenas texto
        </Tooltip>,
      ),
    ).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DrawingToolbar — estrutura
// ═════════════════════════════════════════════════════════════════════════════

describe('DrawingToolbar — estrutura e grupos', () => {
  it('e um toolbar com orientacao declarada e agrupado por familia', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} onToggleSnap={() => undefined} />);

    const barra = screen.getByRole('toolbar', { name: 'Ferramentas de desenho' });
    expect(barra.getAttribute('aria-orientation')).toBe('vertical');

    // Cada grupo anunciado por nome — e o que da o "para que" antes de qualquer texto.
    //
    // ⭐ `Anotação` entrou como grupo próprio na rodada das sete ferramentas novas, e `Formas`
    // virou `Formas e zonas`. A separação é por ATO: delimitar uma área, afirmar de que lado
    // está a pressão, e dizer algo a quem olha depois.
    for (const nome of [
      'Selecionar',
      'Linhas',
      'Formas e zonas',
      'Anotação',
      'Medição',
      'Ajuda de precisão',
      'Histórico',
    ]) {
      expect(within(barra).getByRole('group', { name: nome })).toBeTruthy();
    }

    // ⭐ `Posição` entrou como grupo PROPRIO (e nao dentro de Formas ou Medição): ela nao e
    // forma nem medida, e a pergunta que precede a ordem — quanto se perde estando errado e
    // quanto se ganha estando certo.
    expect(within(barra).getByRole('group', { name: 'Posição' })).toBeTruthy();
    // Separador visual entre grupos: um a menos que o numero de grupos, nunca um solto no
    // fim. Oito grupos agora (entrou `Anotação`).
    expect(within(barra).getAllByRole('separator')).toHaveLength(7);
  });

  it('⭐ NENHUM atalho e usado por duas ferramentas', () => {
    // ⚠️ Este teste existe porque a colisao ACONTECEU: ao acrescentar as ferramentas de
    // posicao eu dei `A` a seta (que o ima ja usava) e `E` a extensao de Fibonacci (que a
    // reta infinita ja usava). O sintoma nao e erro nenhum — o atalho aciona o PRIMEIRO item
    // que casa, e o operador aperta a tecla de sempre e recebe outra ferramenta. Foi o teste
    // do ima que pegou uma das duas; sem uma guarda geral, a proxima colisao passa.
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} onToggleSnap={() => undefined} />);

    // ⚠️ Agora a barra tem FAMILIAS, e as variantes vivem num menu fechado. Ler so os botoes
    // visiveis mediria 7 atalhos de 16 — e a colisao entre duas variantes de familias diferentes
    // passaria. Entao o teste ABRE cada familia e recolhe tudo.
    const barra = screen.getByRole('toolbar', { name: 'Ferramentas de desenho' });
    const atalhos: string[] = [];

    // ⚠️ O botao de FAMILIA e excluido daqui: o `aria-keyshortcuts` dele e o da variante
    // exibida, que tambem aparece no menu. Contar os dois criaria uma "colisao" que nao existe.
    for (const b of within(barra).getAllByRole('button')) {
      if (b.getAttribute('aria-haspopup') === 'menu') continue;
      const a = b.getAttribute('aria-keyshortcuts');
      if (a !== null && a !== '') atalhos.push(a);
    }

    // E as variantes, uma familia por vez.
    for (const familia of within(barra)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-haspopup') === 'menu')) {
      fireEvent.contextMenu(familia);
      for (const m of within(barra).getAllByRole('menuitemradio')) {
        const kbd = m.querySelector('kbd')?.textContent ?? '';
        if (kbd !== '') atalhos.push(kbd);
      }
      fireEvent.contextMenu(familia);
    }

    // Guarda de vacuidade: sem atalho lido, a assercao de unicidade seria vazia.
    expect(atalhos.length, `atalhos lidos: ${atalhos.join(',')}`).toBeGreaterThan(12);
    expect(new Set(atalhos).size, `repetidos em: ${atalhos.join(',')}`).toBe(atalhos.length);
  });

  it('honra orientation horizontal', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} orientation="horizontal" />);
    expect(screen.getByRole('toolbar').getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('omite o ima quando o consumidor nao oferece como alterna-lo', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    // Ima que nao liga e pior que ausencia: o clique nao faz nada e a barra
    // parece quebrada.
    expect(screen.queryByRole('button', { name: 'Ímã' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Ajuda de precisão' })).toBeNull();
  });

  it('marca a ferramenta ativa com aria-pressed', () => {
    const d = fakeDrawings({ tool: 'TRENDLINE' });
    render(<DrawingToolbar drawings={d} />);

    expect(
      screen.getByRole('button', { name: 'Linha de tendência' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Selecionar' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    // Acao nao e estado: `aria-pressed` num botao de desfazer anunciaria um
    // "ligado/desligado" que nao existe.
    expect(screen.getByRole('button', { name: 'Desfazer' }).hasAttribute('aria-pressed')).toBe(
      false,
    );
  });

  it('clicar troca a ferramenta e acionar historico chama a operacao', () => {
    const d = fakeDrawings({ canUndo: true, canRedo: true, selectedIds: ['a'] });
    render(<DrawingToolbar drawings={d} />);

    // ⚠️ A régua vive na família "Medição" agora: abre o menu e escolhe.
    fireEvent.contextMenu(screen.getByRole('button', { name: /Fibonacci/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Régua/ }));
    expect(d.chamadas.tools).toEqual(['MEASURE']);

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apagar selecionado' }));
    expect(d.chamadas.acoes).toEqual(['undo', 'delete']);
  });

  it('desabilita historico sem historico e apagar sem selecao', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    expect((screen.getByRole('button', { name: 'Desfazer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Refazer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Apagar selecionado' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DrawingToolbar — atalhos
// ═════════════════════════════════════════════════════════════════════════════

describe('DrawingToolbar — atalhos de teclado', () => {
  it('tecla unica troca a ferramenta', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);

    fireEvent.keyDown(document, { key: 't' });
    fireEvent.keyDown(document, { key: 'B' });
    fireEvent.keyDown(document, { key: 's' });
    // Minuscula e maiuscula valem igual: o operador nao vai olhar o Caps Lock.
    expect(d.chamadas.tools).toEqual(['TRENDLINE', 'RECTANGLE', null]);
  });

  it('⭐ IGNORA o atalho com o foco dentro de um campo de texto', () => {
    const d = fakeDrawings();
    render(
      <>
        <input aria-label="Símbolo" />
        <DrawingToolbar drawings={d} />
      </>,
    );

    const campo = screen.getByRole('textbox', { name: 'Símbolo' });
    act(() => {
      campo.focus();
    });

    // Digitar "PETR4": sem a guarda, o `R` ativaria o retangulo e o `T` a linha de
    // tendencia, e o proximo clique no grafico desenharia sem querer.
    for (const tecla of ['P', 'E', 'T', 'R', '4']) {
      fireEvent.keyDown(campo, { key: tecla, bubbles: true });
      fireEvent.keyDown(document, { key: tecla });
    }
    expect(d.chamadas.tools).toEqual([]);
  });

  it('IGNORA o atalho com modificador (Ctrl+R recarrega, e isso e do navegador)', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);

    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'r', metaKey: true });
    fireEvent.keyDown(document, { key: 'r', altKey: true });
    expect(d.chamadas.tools).toEqual([]);

    // E o caminho oposto continua vivo — guarda larga demais desligaria tudo.
    fireEvent.keyDown(document, { key: 'r' });
    expect(d.chamadas.tools).toEqual(['RAY']);
  });

  it('o atalho do ima alterna o ima, nao a ferramenta', () => {
    const d = fakeDrawings();
    let vezes = 0;
    render(<DrawingToolbar drawings={d} onToggleSnap={() => (vezes += 1)} />);

    fireEvent.keyDown(document, { key: 'a' });
    expect(vezes).toBe(1);
    expect(d.chamadas.tools).toEqual([]);
  });

  it('Escape devolve ao modo de selecao, e nao faz nada se ja esta nele', () => {
    const comFerramenta = fakeDrawings({ tool: 'RECTANGLE' });
    const { unmount } = render(<DrawingToolbar drawings={comFerramenta} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(comFerramenta.chamadas.tools).toEqual([null]);
    unmount();

    const semFerramenta = fakeDrawings({ tool: null });
    render(<DrawingToolbar drawings={semFerramenta} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(semFerramenta.chamadas.tools).toEqual([]);
  });

  it('shortcutsEnabled=false desliga o ouvinte (duas barras na mesma pagina)', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} shortcutsEnabled={false} />);
    fireEvent.keyDown(document, { key: 't' });
    expect(d.chamadas.tools).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DrawingToolbar — recolher
// ═════════════════════════════════════════════════════════════════════════════

describe('DrawingToolbar — recolher', () => {
  it('esconde os grupos mas MANTEM o cursor e o botao de abrir', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} collapsed onToggleCollapsed={() => undefined} />);

    // O cursor sobrevive: recolher escondendo tudo prenderia o operador na
    // ferramenta ativa sem forma de sair.
    expect(screen.getByRole('button', { name: 'Selecionar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mostrar ferramentas' })).toBeTruthy();

    expect(screen.queryByRole('group', { name: 'Linhas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Régua' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('recolhida, o atalho de uma ferramenta oculta nao dispara', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} collapsed onToggleCollapsed={() => undefined} />);

    // Ativar por teclado o que a barra nao mostra deixaria o operador sem ver qual
    // ferramenta esta ativa.
    fireEvent.keyDown(document, { key: 't' });
    expect(d.chamadas.tools).toEqual([]);

    fireEvent.keyDown(document, { key: 's' });
    expect(d.chamadas.tools).toEqual([null]);
  });

  it('sem onToggleCollapsed nao existe botao de recolher', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    expect(screen.queryByRole('button', { name: /recolher|mostrar ferramentas/i })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DrawingToolbar — roving tabindex
// ═════════════════════════════════════════════════════════════════════════════

describe('DrawingToolbar — navegacao por teclado na barra', () => {
  it('um unico botao e tabulavel; a seta move o foco', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    const barra = screen.getByRole('toolbar');
    const botoes = within(barra).getAllByRole('button');

    const tabulaveis = botoes.filter((b) => b.getAttribute('tabindex') === '0');
    expect(tabulaveis).toHaveLength(1);
    expect(tabulaveis[0]?.getAttribute('aria-label')).toBe('Selecionar');

    act(() => {
      tabulaveis[0]?.focus();
    });
    fireEvent.keyDown(barra, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Linha de tendência');

    fireEvent.keyDown(barra, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Selecionar');

    // O `tabIndex=0` acompanha o foco — e o que faz `Tab` voltar para onde o
    // usuario estava.
    fireEvent.keyDown(barra, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
    expect(
      within(barra)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('tabindex') === '0'),
    ).toHaveLength(1);
  });

  it('a seta SALTA botao desabilitado', () => {
    const d = fakeDrawings({ tool: 'MEASURE' });
    render(<DrawingToolbar drawings={d} onToggleSnap={() => undefined} />);
    const barra = screen.getByRole('toolbar');

    act(() => {
      screen.getByRole('button', { name: 'Ímã' }).focus();
    });
    // Depois do ima vem o grupo de historico, todo desabilitado — a seta tem de
    // dar a volta ate o primeiro habilitado.
    fireEvent.keyDown(barra, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Selecionar');
  });

  it('End e Home vao para as pontas habilitadas', () => {
    const d = fakeDrawings({ canUndo: true });
    render(<DrawingToolbar drawings={d} />);
    const barra = screen.getByRole('toolbar');

    act(() => {
      screen.getByRole('button', { name: 'Selecionar' }).focus();
    });
    fireEvent.keyDown(barra, { key: 'End' });
    // `Refazer` e `Apagar` estao desabilitados; a ultima parada real e `Desfazer`.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Desfazer');

    fireEvent.keyDown(barra, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Selecionar');
  });

  it('⚠️ item desabilitado NUNCA carrega o tabIndex=0', () => {
    // A armadilha: se o `tabIndex=0` cai num botao desabilitado, a barra inteira
    // sai da ordem de tabulacao e fica inalcancavel por teclado.
    const d = fakeDrawings({ canUndo: true });
    const { rerender } = render(<DrawingToolbar drawings={d} />);
    const barra = screen.getByRole('toolbar');

    const desfazer = screen.getByRole('button', { name: 'Desfazer' });
    act(() => {
      desfazer.focus();
    });
    fireEvent.keyDown(barra, { key: 'End' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Desfazer');
    expect(desfazer.getAttribute('tabindex')).toBe('0');

    // O historico esvazia (o operador desfez tudo): `Desfazer` fica desabilitado.
    rerender(<DrawingToolbar drawings={fakeDrawings({ canUndo: false })} />);

    const tabulaveis = within(screen.getByRole('toolbar'))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('tabindex') === '0');
    expect(tabulaveis).toHaveLength(1);
    expect((tabulaveis[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ FAMILIAS, cores e zoom — a barra "viva"
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ RELATO: *"tem redundancia nas ferramentas da esquerda"* e *"ferramentas vivas e em cores
// para melhor visualizacao, zoom de barra de ferramentas, auxilio"*. A redundancia era de ICONE:
// dezoito alvos numa tira estreita, seis deles riscos de linha quase identicos a 14 px.
describe('⭐⭐ familias de ferramenta', () => {
  it('⭐ a barra tem MENOS alvos, e nenhuma ferramenta foi perdida', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} onToggleSnap={() => undefined} />);
    const barra = screen.getByRole('toolbar');
    const alvos = within(barra).getAllByRole('button');
    // ⭐⭐ O que se mede e a RAZAO entre ferramentas e alvos, nao o numero absoluto.
    //
    // Historico: 13 ferramentas em 18 alvos -> 11 alvos. Depois das sete novas: **20 ferramentas
    // em 13 alvos** (cursor, 1 familia de linhas, 2 de formas/zonas, 1 de anotacao, 1 de
    // medicao, 1 de posicao, ima, 3 de historico, recolher). Sete ferramentas entraram e a barra
    // cresceu DOIS alvos — que e exatamente o ponto de existir familia.
    expect(alvos.length).toBeLessThanOrEqual(13);

    // E as SETE linhas continuam alcancaveis, uma a uma (entrou o canal paralelo).
    const familiaLinhas = within(barra).getByRole('button', { name: /Linha de tend|Raio|Reta|vertical/ });
    fireEvent.contextMenu(familiaLinhas);
    const variantes = within(barra).getAllByRole('menuitemradio');
    expect(variantes).toHaveLength(7);
  });

  it('⭐⭐ escolher no menu ARMA a ferramenta e passa a ser a exibida', () => {
    const d = fakeDrawings();
    const { rerender } = render(<DrawingToolbar drawings={d} />);
    const familia = screen.getByRole('button', { name: /Linha de tend/ });
    fireEvent.contextMenu(familia);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Linha vertical/ }));
    expect(d.chamadas.tools).toEqual(['VERTICAL_LINE']);

    // Com a ferramenta armada, a familia mostra a variante dela.
    rerender(<DrawingToolbar drawings={fakeDrawings({ tool: 'VERTICAL_LINE' })} />);
    expect(screen.getByRole('button', { name: 'Linha vertical' })).toBeTruthy();
  });

  it('⭐⭐ a variante exibida é DERIVADA da ferramenta ativa, não da memória de clique', () => {
    // ⚠️ É o defeito que a derivação evita: apertar `H` pelo atalho deixaria a família mostrando
    // "linha de tendência" ACESA enquanto a ferramenta ativa era a horizontal — a barra
    // afirmando uma coisa e o gesto fazendo outra.
    const d = fakeDrawings({ tool: 'HORIZONTAL_RAY' });
    render(<DrawingToolbar drawings={d} />);
    const botao = screen.getByRole('button', { name: 'Raio horizontal' });
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect(botao.dataset['familyCurrent']).toBe('horizontalRay');
  });

  it('a família fica ACESA com QUALQUER variante dela armada', () => {
    for (const [tool, nome] of [
      ['RAY', /Raio$/],
      ['EXTENDED_LINE', /Reta estendida/],
      ['MEASURE', /Régua/],
      ['POSITION_SHORT', /Posição de venda/],
    ] as const) {
      const { unmount } = render(<DrawingToolbar drawings={fakeDrawings({ tool })} />);
      expect(screen.getByRole('button', { name: nome }).getAttribute('aria-pressed')).toBe('true');
      unmount();
    }
  });

  it('clicar na família arma a variante EXIBIDA (um clique para a de sempre)', () => {
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    fireEvent.click(screen.getByRole('button', { name: /Linha de tend/ }));
    expect(d.chamadas.tools).toEqual(['TRENDLINE']);
  });

  it('⚠️ o atalho de uma variante ESCONDIDA continua funcionando', () => {
    // Quem usa teclado nunca abre o menu. Perder o atalho ao agrupar seria trocar um problema
    // de leitura por um de acesso.
    const d = fakeDrawings();
    render(<DrawingToolbar drawings={d} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    expect(d.chamadas.tools).toEqual(['VERTICAL_LINE']);
  });

  it('o menu anuncia qual variante está escolhida', () => {
    render(<DrawingToolbar drawings={fakeDrawings({ tool: 'RAY' })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /Raio$/ }));
    const marcados = screen
      .getAllByRole('menuitemradio')
      .filter((m) => m.getAttribute('aria-checked') === 'true');
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.textContent).toMatch(/Raio/);
  });

  it('⭐ `Alt+↓` abre o menu pelo TECLADO, e Escape fecha', () => {
    render(<DrawingToolbar drawings={fakeDrawings()} />);
    const familia = screen.getByRole('button', { name: /Linha de tend/ });
    expect(familia.getAttribute('aria-haspopup')).toBe('menu');
    expect(familia.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(familia, { key: 'ArrowDown', altKey: true });
    expect(familia.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitemradio').length).toBe(7);

    fireEvent.keyDown(screen.getAllByRole('menuitemradio')[0] as HTMLElement, { key: 'Escape' });
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });

  it('⚠️ `Alt+seta` NÃO move o foco da barra (a seta é do menu)', () => {
    render(<DrawingToolbar drawings={fakeDrawings()} />);
    const barra = screen.getByRole('toolbar');
    const primeiro = within(barra).getAllByRole('button')[0] as HTMLElement;
    primeiro.focus();
    fireEvent.keyDown(barra, { key: 'ArrowDown', altKey: true });
    expect(document.activeElement).toBe(primeiro);
  });

  it('⭐ o ZOOM cresce o ícone e o botão junto, recortado nas pontas', () => {
    const { rerender } = render(<DrawingToolbar drawings={fakeDrawings()} iconSize={24} />);
    const alvo = screen.getByRole('button', { name: 'Selecionar' });
    expect(alvo.style.width).toBe('36px'); // 24 + 12 de folga
    // ⚠️ Recortado e não recusado: 8 px não é clicável e 60 px empurra o gráfico.
    rerender(<DrawingToolbar drawings={fakeDrawings()} iconSize={4} />);
    expect(screen.getByRole('button', { name: 'Selecionar' }).style.width).toBe('26px');
    rerender(<DrawingToolbar drawings={fakeDrawings()} iconSize={999} />);
    expect(screen.getByRole('button', { name: 'Selecionar' }).style.width).toBe('40px');
  });

  it('⭐ a COR da família aparece só no item ATIVO, com três pistas', () => {
    render(<DrawingToolbar drawings={fakeDrawings({ tool: 'TRENDLINE' })} />);
    const aceso = screen.getByRole('button', { name: /Linha de tend/ });
    const apagado = screen.getByRole('button', { name: 'Selecionar' });
    // Fundo, borda E cor do ícone — quem não distingue matiz lê a borda.
    expect(aceso.style.borderColor).not.toBe('transparent');
    expect(aceso.style.background).not.toBe('transparent');
    expect(aceso.style.color).not.toBe('inherit');
    // ⚠️ Em repouso o ícone é neutro: dez ícones coloridos ao mesmo tempo é uma barra sem
    // hierarquia, onde tudo grita e nada informa.
    expect(apagado.style.borderColor).toBe('transparent');
    expect(apagado.style.background).toBe('transparent');
  });

  it('⚠️ nenhuma cor de família é verde ou vermelha', () => {
    // Os dois significam ALTA e BAIXA em todo pixel deste gráfico: uma ferramenta acesa em
    // verde seria lida como afirmação sobre o mercado. Mesma regra do alerta disparado em ciano.
    const cores: string[] = [];
    for (const tool of ['TRENDLINE', 'RECTANGLE', 'MEASURE', 'POSITION_LONG'] as const) {
      const { unmount } = render(<DrawingToolbar drawings={fakeDrawings({ tool })} />);
      for (const b of screen.getAllByRole('button')) {
        if (b.getAttribute('aria-pressed') === 'true') cores.push(b.style.borderColor);
      }
      unmount();
    }
    expect(cores.length).toBeGreaterThan(3);
    for (const c of cores) {
      expect(c, `cor proibida: ${c}`).not.toMatch(/#16c784|#ea3943|\bgreen\b|\bred\b|#22c55e|#ef4444/i);
    }
  });
});
