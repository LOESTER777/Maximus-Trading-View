/**
 * CommandPalette + ChartLegend — a camada de interface da biblioteca.
 *
 * ⚠️ **Dois componentes num arquivo, de proposito.** Nao e preguica: os dois
 * entram na mesma entrega e compartilham a bancada de jsdom (o que o ambiente NAO
 * tem e o que se descobriu sobre ele esta documentado num lugar so, abaixo).
 * Separar duplicaria o cabecalho sem separar nada de real.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROTEGEM, na ordem em que doeria se quebrasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. **Foco.** Tomar ao abrir e DEVOLVER ao fechar. E o defeito que mais escapa
 *     em paleta escrita a mao, porque so quem navega por teclado sente: sem a
 *     devolucao, o `Tab` seguinte recomeca do topo da pagina. Ha teste tambem
 *     para o caso oposto — comando que move o foco de proposito NAO deve te-lo
 *     arrancado de volta.
 *  2. **`aria-activedescendant`.** O foco do DOM nunca sai do input, entao esse
 *     atributo e a UNICA coisa que anuncia a selecao para leitor de tela. Um
 *     `aria-selected` sem `activedescendant` correspondente e paleta muda.
 *  3. **Overlay fecha, interior nao.** Um `mousedown` no interior que fechasse a
 *     paleta a tornaria inutilizavel por mouse.
 *  4. **`Tab` nao escapa.** Foco atras de um overlay opaco = operar as cegas.
 *  5. **Legenda com `pointerEvents: 'none'`.** A legenda fica sobre a area onde o
 *     pan e o desenho COMECAM; se ela capturar o ponteiro, o arrasto nao acontece
 *     naquele canto e o usuario conclui que "o grafico travou".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O QUE O JSDOM NAO TEM, E QUE APARECEU AQUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **`Element.prototype.scrollIntoView` nao existe.** Nao devolve `undefined`:
 *    o metodo nao esta no prototipo, e chamar da `TypeError`. Como a paleta rola
 *    o item selecionado a cada seta, sem a guarda `typeof === 'function'` TODO
 *    teste de navegacao quebraria. Ha um teste que instala um espiao para provar
 *    que a chamada acontece quando o metodo existe — sem ele, a guarda poderia
 *    estar "protegendo" um caminho morto.
 *  - **`document.activeElement` cai para `<body>` quando o elemento focado sai do
 *    documento.** E disso que depende a regra de devolucao de foco: "devolve so se
 *    ninguem assumiu" se traduz em "o ativo e o body". O comportamento e igual no
 *    navegador, mas foi aqui que ficou verificavel.
 *  - **`useId` do React devolve `:r0:`**, com dois-pontos. `querySelector('#:r0:')`
 *    lanca `SyntaxError` porque `:` e sintaxe de pseudo-classe — por isso a rolagem
 *    usa `getElementById`, que nao passa por parser de seletor.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CommandPalette, rankCommands, useCommandPaletteHotkey, type Command } from '../CommandPalette.js';
import { ChartLegend } from '../ChartLegend.js';
import type { CrosshairReadout } from '../useCrosshair.js';

afterEach(cleanup);

// ═════════════════════════════════════════════════════════════════════════════
// Bancada
// ═════════════════════════════════════════════════════════════════════════════

const executados: string[] = [];

function comandos(): Command[] {
  return [
    {
      id: 'ema',
      label: 'Média Móvel Exponencial',
      group: 'Indicadores',
      icon: 'indicator',
      hint: 'Média que pesa mais as barras recentes.',
      keywords: ['ema'],
      run: () => executados.push('ema'),
    },
    {
      id: 'bb',
      label: 'Bandas de Bollinger',
      group: 'Indicadores',
      icon: 'indicator',
      hint: 'Desvio padrão em torno da média.',
      run: () => executados.push('bb'),
    },
    {
      id: 'vol',
      label: 'Perfil de Volume',
      group: 'Análise',
      // 'poc' NAO esta no rotulo: e o caso que exercita o termo alternativo.
      keywords: ['vpvr', 'poc'],
      hint: 'Volume negociado por região de preço.',
      run: () => executados.push('vol'),
    },
    {
      id: 'bars',
      label: 'Barras',
      group: 'Gráfico',
      icon: 'bars',
      keywords: ['volume', 'ohlc'],
      run: () => executados.push('bars'),
    },
    {
      id: 'trend',
      label: 'Linha de tendência',
      group: 'Desenho',
      icon: 'trendline',
      shortcut: 'T',
      hint: 'Dois pontos, arrastáveis depois.',
      run: () => executados.push('trend'),
    },
  ];
}

/**
 * A paleta como o consumidor a usa: controlada por estado, com um botao que a
 * abre. O botao existe para poder afirmar a DEVOLUCAO de foco — sem um gatilho
 * focavel, nao ha o que devolver.
 */
function Bancada({ cmds, aoFechar }: { cmds?: Command[]; aoFechar?: () => void }): JSX.Element {
  const [aberta, setAberta] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setAberta(true)}>
        Abrir paleta
      </button>
      <CommandPalette
        open={aberta}
        onOpenChange={(v) => {
          setAberta(v);
          if (!v) aoFechar?.();
        }}
        commands={cmds ?? comandos()}
      />
    </div>
  );
}

function abrir(cmds?: Command[]): HTMLInputElement {
  render(<Bancada cmds={cmds} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir paleta' }));
  return screen.getByRole('combobox') as HTMLInputElement;
}

function opcoes(): HTMLElement[] {
  return screen.getAllByRole('option');
}

function selecionada(): HTMLElement {
  const alvo = opcoes().find((o) => o.getAttribute('aria-selected') === 'true');
  if (alvo === undefined) throw new Error('nenhuma opcao selecionada');
  return alvo;
}

afterEach(() => {
  executados.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// Ranqueamento (parte pura)
// ═════════════════════════════════════════════════════════════════════════════

describe('rankCommands', () => {
  it('agrupa e poe o grupo do MELHOR item na frente', () => {
    const { groups } = rankCommands('volume', comandos());
    // "Perfil de Volume" casa no ROTULO; "Barras" casa por `keywords`. O grupo
    // 'Análise' tem de vir antes de 'Gráfico'.
    expect(groups.map((g) => g.group)).toEqual(['Análise', 'Gráfico']);
  });

  it('⭐ casamento no rotulo vence casamento em termo alternativo, sempre', () => {
    const { flat } = rankCommands('volume', comandos());
    expect(flat.map((f) => f.command.id)).toEqual(['vol', 'bars']);
  });

  it('quem casa por termo alternativo nao recebe destaque', () => {
    // ⚠️ 'poc' casa no ROTULO de "Média Móvel Ex-p-o-nen-c-ial" — subsequencia
    // acha o que ninguem procurava, e por isso ele aparece. Mas aparece DEPOIS de
    // quem casou por `keywords`? Nao: casamento de rotulo sempre vem antes. O
    // ponto do teste e o destaque.
    const { flat } = rankCommands('poc', comandos());
    expect(flat.map((f) => f.command.id)).toEqual(['ema', 'vol']);
    // Quem casou no rotulo tem destaque…
    expect(flat[0]?.ranges.length).toBeGreaterThan(0);
    // …e quem casou pelo termo 'poc' NAO tem. Os indices casados pertencem ao
    // termo, nao ao rotulo "Perfil de Volume"; aplica-los ao rotulo poria negrito
    // em letras aleatorias, e destaque que nao corresponde ao digitado destroi a
    // confianca na busca inteira.
    expect(flat[1]?.ranges).toEqual([]);
  });

  it('busca por nome de GRUPO tras os comandos do grupo', () => {
    const { flat } = rankCommands('desenho', comandos());
    expect(flat.map((f) => f.command.id)).toEqual(['trend']);
  });

  it('`flat` esta na mesma ordem visual dos grupos', () => {
    const { groups, flat } = rankCommands('', comandos());
    const concatenado = groups.flatMap((g) => g.items.map((i) => i.command.id));
    expect(flat.map((f) => f.command.id)).toEqual(concatenado);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Abertura e foco
// ═════════════════════════════════════════════════════════════════════════════

describe('CommandPalette — abertura e foco', () => {
  it('nao renderiza nada quando fechada', () => {
    render(<Bancada />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ao abrir, foca o campo de busca', () => {
    const input = abrir();
    expect(document.activeElement).toBe(input);
  });

  it('e um dialogo modal rotulado, com combobox e listbox', () => {
    abrir();
    const dialogo = screen.getByRole('dialog');
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(dialogo.getAttribute('aria-label')).toBe('Paleta de comandos');
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  it('⭐ Escape fecha E devolve o foco a quem o tinha antes', () => {
    const gatilho = (() => {
      render(<Bancada />);
      const b = screen.getByRole('button', { name: 'Abrir paleta' });
      // ⚠️ O `focus()` explicito nao e cerimonia: **`fireEvent.click` do jsdom NAO
      // move o foco**. No navegador o `mousedown` foca o botao antes do `click`, e
      // e daquele foco que a devolucao depende. Sem esta linha o teste mediria o
      // caso "ninguem tinha foco" — que passa por outro caminho — e daria a
      // impressao de que a devolucao esta quebrada.
      b.focus();
      fireEvent.click(b);
      return b;
    })();

    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    // Sem esta devolucao, o `Tab` seguinte recomecaria do topo da pagina.
    expect(document.activeElement).toBe(gatilho);
  });

  it('⭐ NAO arranca o foco de um comando que o tomou de proposito', () => {
    // "Desenhar linha de tendencia" foca a tela; "criar alerta" foca o campo de
    // preco. Devolver o foco ao gatilho nesses casos jogaria o usuario de volta
    // para o botao em vez de deixa-lo continuar onde o comando o pos.
    const destino = document.createElement('input');
    document.body.appendChild(destino);

    const cmds: Command[] = [
      { id: 'foca', label: 'Focar campo', group: 'Teste', run: () => destino.focus() },
    ];
    abrir(cmds);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect(document.activeElement).toBe(destino);
    destino.remove();
  });

  it('reabre com a busca limpa', () => {
    render(<Bancada />);
    const botao = screen.getByRole('button', { name: 'Abrir paleta' });
    fireEvent.click(botao);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bol' } });
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('bol');

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    fireEvent.click(botao);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Teclado
// ═════════════════════════════════════════════════════════════════════════════

describe('CommandPalette — teclado', () => {
  it('aria-activedescendant aponta EXATAMENTE a opcao selecionada', () => {
    const input = abrir();
    expect(input.getAttribute('aria-activedescendant')).toBe(selecionada().id);
    expect(selecionada().textContent).toContain('Média Móvel Exponencial');
  });

  it('a seta move a selecao, e o atributo acompanha', () => {
    const input = abrir();
    const primeira = selecionada().id;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selecionada().id).not.toBe(primeira);
    expect(input.getAttribute('aria-activedescendant')).toBe(selecionada().id);
  });

  it('seta + Enter executa o comando CERTO', () => {
    const input = abrir();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const rotulo = selecionada().textContent;
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(executados).toHaveLength(1);
    expect(rotulo).toContain('Bandas de Bollinger');
    expect(executados[0]).toBe('bb');
    // Executar fecha.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Home e End vao aos extremos', () => {
    const input = abrir();
    fireEvent.keyDown(input, { key: 'End' });
    expect(selecionada()).toBe(opcoes()[opcoes().length - 1]);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(selecionada()).toBe(opcoes()[0]);
  });

  it('a selecao circula nos extremos', () => {
    const input = abrir();
    const total = opcoes().length;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Subir do primeiro leva ao ultimo: numa lista filtrada e curta, parar no
    // extremo faz o usuario achar que travou.
    expect(selecionada()).toBe(opcoes()[total - 1]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selecionada()).toBe(opcoes()[0]);
  });

  it('⚠️ Tab NAO escapa da paleta', () => {
    const input = abrir();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('as setas nao quebram sem `scrollIntoView` — e chamam quando ele existe', () => {
    // ⚠️ O jsdom nao tem `scrollIntoView` no prototipo. O primeiro trecho prova
    // que a guarda funciona; o segundo prova que ela nao esconde um caminho morto.
    const input = abrir();
    expect(() => fireEvent.keyDown(input, { key: 'ArrowDown' })).not.toThrow();

    const espiao = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = espiao;
    try {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(espiao).toHaveBeenCalled();
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
    }
  });

  it('Enter com lista vazia nao faz nada', () => {
    const input = abrir();
    fireEvent.change(input, { target: { value: 'zzzzzzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(executados).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Busca
// ═════════════════════════════════════════════════════════════════════════════

describe('CommandPalette — busca', () => {
  it('filtra e mantem os cabecalhos de grupo', () => {
    const input = abrir();
    expect(screen.getAllByRole('group').length).toBeGreaterThan(1);

    fireEvent.change(input, { target: { value: 'bol' } });
    const grupos = screen.getAllByRole('group');
    expect(grupos).toHaveLength(1);
    expect(within(grupos[0] as HTMLElement).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('Bandas de Bollinger');
  });

  it('acha por acento ausente — "media" acha "Média"', () => {
    const input = abrir();
    fireEvent.change(input, { target: { value: 'media' } });
    expect(screen.getByRole('option').textContent).toContain('Média Móvel Exponencial');
  });

  it('destaca as letras casadas em <strong>', () => {
    const input = abrir();
    fireEvent.change(input, { target: { value: 'bol' } });
    const marcados = screen
      .getByRole('option')
      .querySelectorAll('strong.robustus-palette__match');
    expect(Array.from(marcados).map((m) => m.textContent).join('')).toBe('Bol');
  });

  it('a busca volta a selecao para o topo a cada tecla', () => {
    const input = abrir();
    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.change(input, { target: { value: 'i' } });
    expect(selecionada()).toBe(opcoes()[0]);
  });

  it('lista vazia mostra a mensagem, anunciada por role=status', () => {
    const input = abrir();
    fireEvent.change(input, { target: { value: 'qqqqq' } });
    expect(screen.getByRole('status').textContent).toBe('Nenhum comando corresponde à busca.');
  });

  it('mostra o hint do item selecionado — o "para que serve"', () => {
    const input = abrir();
    expect(screen.getByRole('dialog').textContent).toContain(
      'Média que pesa mais as barras recentes.',
    );
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog').textContent).toContain('Desvio padrão em torno da média.');
  });

  it('mostra o atalho do comando', () => {
    const input = abrir();
    fireEvent.change(input, { target: { value: 'tendencia' } });
    expect(screen.getByRole('option').textContent).toContain('T');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mouse
// ═════════════════════════════════════════════════════════════════════════════

describe('CommandPalette — mouse', () => {
  it('clique numa opcao executa', () => {
    abrir();
    const alvo = opcoes().find((o) => o.textContent?.includes('Linha de tendência'));
    expect(alvo).toBeTruthy();
    fireEvent.click(alvo as HTMLElement);
    expect(executados).toEqual(['trend']);
  });

  it('⚠️ mousedown no OVERLAY fecha; DENTRO nao fecha', () => {
    const input = abrir();
    const dialogo = screen.getByRole('dialog');

    fireEvent.mouseDown(dialogo);
    expect(screen.queryByRole('dialog')).toBeTruthy();
    fireEvent.mouseDown(input);
    expect(screen.queryByRole('dialog')).toBeTruthy();

    const overlay = dialogo.parentElement;
    expect(overlay?.className).toBe('robustus-palette__overlay');
    fireEvent.mouseDown(overlay as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('o mousedown na opcao previne o default — o input nao perde o foco', () => {
    // ⚠️ Sem isso o navegador move o foco para o item clicado, o input o perde e
    // `aria-activedescendant` deixa de valer: as setas param de funcionar depois
    // do primeiro clique.
    abrir();
    const evento = fireEvent.mouseDown(opcoes()[0] as HTMLElement);
    // `fireEvent` devolve `false` quando `preventDefault` foi chamado.
    expect(evento).toBe(false);
  });

  it('passar o mouse seleciona — o rodape passa a explicar aquele item', () => {
    abrir();
    const alvo = opcoes().find((o) => o.textContent?.includes('Perfil de Volume'));
    fireEvent.mouseMove(alvo as HTMLElement);
    expect(selecionada()).toBe(alvo);
    expect(screen.getByRole('dialog').textContent).toContain(
      'Volume negociado por região de preço.',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Robustez
// ═════════════════════════════════════════════════════════════════════════════

describe('CommandPalette — robustez', () => {
  it('⚠️ comando que lanca NAO derruba a arvore', () => {
    const cmds: Command[] = [
      {
        id: 'quebra',
        label: 'Comando defeituoso',
        group: 'Teste',
        run: () => {
          throw new Error('defeito do consumidor');
        },
      },
    ];
    render(<Bancada cmds={cmds} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir paleta' }));
    expect(() => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })).not.toThrow();
    // A paleta fechou, e o botao continua no documento.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir paleta' })).toBeTruthy();
  });

  it('lista de comandos vazia abre sem quebrar', () => {
    abrir([]);
    expect(screen.getByRole('status').textContent).toContain('Nenhum comando');
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O atalho global
// ═════════════════════════════════════════════════════════════════════════════

function BancadaAtalho({ onOpen }: { onOpen: () => void }): JSX.Element {
  useCommandPaletteHotkey(onOpen);
  return <input aria-label="campo qualquer" />;
}

describe('useCommandPaletteHotkey', () => {
  it('Ctrl+K abre e PREVINE o default do navegador', () => {
    const abriu = vi.fn();
    render(<BancadaAtalho onOpen={abriu} />);
    // `false` = `preventDefault` foi chamado. Sem isso o Firefox abre a barra de
    // busca nativa e o Chrome move o foco para a omnibox.
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(false);
    expect(abriu).toHaveBeenCalledTimes(1);
  });

  it('Cmd+K abre (macOS)', () => {
    const abriu = vi.fn();
    render(<BancadaAtalho onOpen={abriu} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(abriu).toHaveBeenCalledTimes(1);
  });

  it('⭐ funciona DENTRO de um campo de texto — e acorde, nao letra solta', () => {
    const abriu = vi.fn();
    render(<BancadaAtalho onOpen={abriu} />);
    const campo = screen.getByLabelText('campo qualquer');
    campo.focus();
    fireEvent.keyDown(campo, { key: 'k', ctrlKey: true });
    expect(abriu).toHaveBeenCalledTimes(1);
  });

  it('K sozinho nao abre', () => {
    const abriu = vi.fn();
    render(<BancadaAtalho onOpen={abriu} />);
    fireEvent.keyDown(window, { key: 'k' });
    expect(abriu).not.toHaveBeenCalled();
  });

  it('⚠️ Ctrl+Alt+K nao abre — no ABNT2 o AltGr chega como ctrl+alt', () => {
    const abriu = vi.fn();
    render(<BancadaAtalho onOpen={abriu} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, altKey: true });
    expect(abriu).not.toHaveBeenCalled();
  });

  it('desmontar remove o ouvinte', () => {
    const abriu = vi.fn();
    const { unmount } = render(<BancadaAtalho onOpen={abriu} />);
    unmount();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(abriu).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChartLegend
// ═════════════════════════════════════════════════════════════════════════════

const VAZIO: CrosshairReadout = {
  time: null,
  open: null,
  high: null,
  low: null,
  close: null,
  value: null,
  change: null,
  changePercent: null,
};

function barra(open: number, close: number): CrosshairReadout {
  return {
    time: 1_700_000_000,
    open,
    high: Math.max(open, close) + 5,
    low: Math.min(open, close) - 5,
    close,
    value: null,
    change: close - open,
    changePercent: ((close - open) / open) * 100,
  };
}

describe('ChartLegend', () => {
  it('⭐ o container tem pointerEvents: none — nao rouba o gesto do grafico', () => {
    render(<ChartLegend readout={barra(100, 110)} />);
    // Sem isto o `pointerdown` morre na legenda e o pan/desenho nao acontece no
    // canto superior esquerdo, que e justamente onde os dois comecam.
    expect(screen.getByRole('status').style.pointerEvents).toBe('none');
  });

  it('mostra O/H/L/C com rotulo acessivel', () => {
    render(<ChartLegend readout={barra(100, 110)} precision={1} />);
    expect(screen.getByLabelText('Abertura').textContent).toBe('100.0');
    expect(screen.getByLabelText('Máxima').textContent).toBe('115.0');
    expect(screen.getByLabelText('Mínima').textContent).toBe('95.0');
    expect(screen.getByLabelText('Fechamento').textContent).toBe('110.0');
  });

  it('cor de ALTA quando fecha acima da abertura', () => {
    render(<ChartLegend readout={barra(100, 110)} />);
    const variacao = screen.getByLabelText('Variação');
    expect(variacao.style.color).toBe('rgb(34, 197, 94)');
    expect(variacao.textContent).toContain('+10.00');
    expect(variacao.className).toContain('robustus-legend__change--up');
  });

  it('cor de BAIXA quando fecha abaixo, com o sinal explicito', () => {
    render(<ChartLegend readout={barra(110, 100)} />);
    const variacao = screen.getByLabelText('Variação');
    expect(variacao.style.color).toBe('rgb(239, 68, 68)');
    // ⚠️ O sinal vai junto com a cor: verde/vermelho e exatamente o par que quem
    // tem deficiencia de visao de cor nao distingue.
    expect(variacao.textContent).toContain('−9.09');
    expect(variacao.className).toContain('robustus-legend__change--down');
  });

  it('barra sem variacao nao pinta nada', () => {
    render(<ChartLegend readout={barra(100, 100)} />);
    const variacao = screen.getByLabelText('Variação');
    expect(variacao.style.color).toBe('');
    expect(variacao.className).toContain('robustus-legend__change--flat');
  });

  it('⚠️ sem cursor nenhuma vez, CONVIDA em vez de ficar em branco', () => {
    render(<ChartLegend readout={VAZIO} symbol="WINFUT" period="5m" />);
    expect(screen.getByRole('status').textContent).toContain('Passe o cursor sobre o gráfico');
    expect(screen.getByRole('status').textContent).toContain('WINFUT');
  });

  it('⭐ retem o ultimo valor conhecido quando o cursor sai', () => {
    const { rerender } = render(<ChartLegend readout={barra(100, 110)} />);
    rerender(<ChartLegend readout={VAZIO} />);
    // Uma legenda que zera junto pisca a cada vez que o mouse sai do grafico, e
    // o operador perde a referencia justamente quando para para pensar.
    expect(screen.getByLabelText('Fechamento').textContent).toBe('110.00');
    expect(screen.getByRole('status').className).toContain('robustus-legend--stale');
    expect(screen.getByRole('status').style.opacity).toBe('0.66');
  });

  it('serie de linha/area mostra so o valor, sem variacao inventada', () => {
    render(<ChartLegend readout={{ ...VAZIO, time: 1, value: 42 }} />);
    expect(screen.getByLabelText('Valor').textContent).toBe('42.00');
    expect(screen.queryByLabelText('Variação')).toBeNull();
  });

  it('lista valores de indicador, e "nao sei" vira travessao', () => {
    render(
      <ChartLegend
        readout={barra(100, 110)}
        series={[
          { label: 'EMA 20', value: 105.5, color: '#38bdf8' },
          { label: 'ATR 14', value: null },
        ]}
      />,
    );
    const texto = screen.getByRole('status').textContent ?? '';
    expect(texto).toContain('EMA 20');
    expect(texto).toContain('105.50');
    // `null` = indicador em aquecimento. Zero ali seria um dado que nao existe.
    expect(texto).toContain('—');
  });

  it('precision fora da faixa de toFixed nao lanca', () => {
    // `toFixed` aceita 0..100; um valor absurdo lancaria `RangeError` DENTRO da
    // renderizacao e derrubaria a arvore. Legenda nao lanca.
    expect(() =>
      render(<ChartLegend readout={barra(100, 110)} precision={-3} />),
    ).not.toThrow();
  });
});
