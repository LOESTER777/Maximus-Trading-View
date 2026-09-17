/**
 * SegmentedControl + ChartToolbar + CollapsiblePanel — o cromo da barra horizontal.
 *
 * O que estes testes protegem, na ordem em que doeria se quebrasse:
 *
 *  1. **O tipo de grafico e um `radiogroup` de verdade.** `aria-checked` em UM
 *     item so, seta trocando a escolha, e **roving tabindex** — inclusive no caso
 *     que quebra o Tab: `value` que nao casa com nenhuma opcao. Sem o fallback,
 *     nenhum item seria tabbable e o grupo sairia da ordem de teclado justamente
 *     quando o usuario precisa consertar o modo.
 *  2. **Os grupos tem NOME.** `role="group"` com `aria-label` por proposito e a
 *     materializacao de "separacao do que e grafico e do que e e para que". Se
 *     alguem achatar a barra num `div` solto, estes testes reprovam.
 *  3. **O colapso acontece por MEDIDA, e o menu preserva a categoria.** O teste
 *     instala um `ResizeObserver` controlavel e um `offsetWidth` de verdade —
 *     porque o `vitest.setup.ts` (de proposito) da um observador que NUNCA
 *     notifica e o jsdom da `offsetWidth` zero. Sem essa instrumentacao o caminho
 *     do colapso seria codigo nunca executado em teste.
 *  4. **Sem medida, mostra tudo.** O oposto — colapsar por falta de informacao —
 *     esconderia botao em qualquer ambiente sem layout (SSR, jsdom).
 *  5. **`CollapsiblePanel` controlado obedece ao pai.** Um painel que abre sozinho
 *     quando controlado produz interface e estado do pai discordando sem que nada
 *     falhe: o defeito mais caro de achar da classe.
 *
 * ⚠️ Nota sobre consultas: o `Tooltip` mantem a bolha no DOM (com `hidden`) mesmo
 * fechada, entao o texto do `label` aparece DUAS vezes no documento no modo
 * compacto — uma no botao, uma na bolha. Por isso os testes de modo compacto
 * afirmam sobre `textContent` do BOTAO e sobre o nome acessivel, nunca com
 * `getByText`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { SegmentedControl, type SegmentedOption } from '../SegmentedControl.js';
import { ChartToolbar, CHART_TOOLBAR_GROUP_LABELS, CHART_TYPE_OPTIONS } from '../ChartToolbar.js';
import { CollapsiblePanel } from '../CollapsiblePanel.js';

afterEach(cleanup);

// ═════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═════════════════════════════════════════════════════════════════════════════

const TRES: readonly SegmentedOption<string>[] = [
  { value: 'Candlestick', label: 'Velas', icon: 'candles', hint: 'OHLC por barra' },
  { value: 'Line', label: 'Linha', icon: 'line' },
  { value: 'Renko', label: 'Renko', icon: 'renko' },
];

const CAMADAS = [
  { id: 'bookmap', label: 'Bookmap', icon: 'bookmap' as const, active: true, hint: 'Livro por região de preço' },
  { id: 'footprint', label: 'Footprint', icon: 'layers' as const, active: false },
];

const AMBIENTE = [
  { id: 'grid', label: 'Grade', icon: 'grid' as const, active: true },
  { id: 'watermark', label: "Marca d'água", icon: 'watermark' as const, active: false },
];

const ACOES = [
  { id: 'screenshot', label: 'Exportar imagem', icon: 'camera' as const },
  { id: 'save', label: 'Salvar layout', icon: 'save' as const },
];

/** Harness controlado: a seta so "move a selecao" se o pai reencaminhar o valor. */
function SegmentadoControlado({
  inicial,
  onChange,
  showLabels = true,
}: {
  readonly inicial: string;
  readonly onChange?: (v: string) => void;
  readonly showLabels?: boolean;
}): JSX.Element {
  const [v, setV] = useState(inicial);
  return (
    <SegmentedControl
      ariaLabel="Desenho do gráfico"
      options={TRES}
      value={v}
      showLabels={showLabels}
      onChange={(novo) => {
        setV(novo);
        onChange?.(novo);
      }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SegmentedControl
// ═════════════════════════════════════════════════════════════════════════════

describe('SegmentedControl', () => {
  it('é um radiogroup nomeado, com aria-checked em UM item só', () => {
    render(<SegmentedControl ariaLabel="Desenho do gráfico" options={TRES} value="Line" onChange={() => {}} />);

    const grupo = screen.getByRole('radiogroup', { name: 'Desenho do gráfico' });
    const itens = within(grupo).getAllByRole('radio');
    expect(itens).toHaveLength(3);
    expect(itens.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('roving tabindex: só o selecionado é tabbable', () => {
    render(<SegmentedControl ariaLabel="Desenho do gráfico" options={TRES} value="Renko" onChange={() => {}} />);

    const itens = screen.getAllByRole('radio');
    expect(itens.map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('⚠️ value fora da lista não tira o grupo da ordem de Tab', () => {
    // O caso real: layout salvo com um modo que esta versao nao tem. Sem o
    // fallback, os tres itens ficariam com `tabIndex=-1` e o usuario nao
    // alcancaria o controle pelo teclado para consertar.
    render(<SegmentedControl ariaLabel="Desenho do gráfico" options={TRES} value="Inexistente" onChange={() => {}} />);

    const itens = screen.getAllByRole('radio');
    expect(itens.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(itens.map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('seta move a seleção e leva o foco junto', () => {
    const espiao = vi.fn();
    render(<SegmentadoControlado inicial="Candlestick" onChange={espiao} />);

    const itens = screen.getAllByRole('radio');
    fireEvent.keyDown(itens[0] as HTMLElement, { key: 'ArrowRight' });

    expect(espiao).toHaveBeenLastCalledWith('Line');
    expect(document.activeElement).toBe(itens[1]);
    expect(screen.getAllByRole('radio').map((el) => el.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    // E o tabindex acompanha a selecao — o grupo continua sendo UMA parada de Tab.
    expect(screen.getAllByRole('radio').map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('seta circula da última para a primeira, e Home/End vão às pontas', () => {
    const espiao = vi.fn();
    render(<SegmentadoControlado inicial="Renko" onChange={espiao} />);

    const itens = screen.getAllByRole('radio');
    fireEvent.keyDown(itens[2] as HTMLElement, { key: 'ArrowRight' });
    expect(espiao).toHaveBeenLastCalledWith('Candlestick');

    fireEvent.keyDown(screen.getAllByRole('radio')[0] as HTMLElement, { key: 'End' });
    expect(espiao).toHaveBeenLastCalledWith('Renko');

    fireEvent.keyDown(screen.getAllByRole('radio')[2] as HTMLElement, { key: 'Home' });
    expect(espiao).toHaveBeenLastCalledWith('Candlestick');
  });

  it('clique troca a escolha; clicar no já selecionado não notifica', () => {
    const espiao = vi.fn();
    render(<SegmentedControl ariaLabel="Desenho do gráfico" options={TRES} value="Line" onChange={espiao} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Renko' }));
    expect(espiao).toHaveBeenCalledWith('Renko');

    espiao.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Linha' }));
    expect(espiao).not.toHaveBeenCalled();
  });

  it('showLabels=false deixa o botão sem texto, mas com nome acessível', () => {
    render(<SegmentadoControlado inicial="Candlestick" showLabels={false} />);

    const item = screen.getByRole('radio', { name: 'Renko' });
    // Icone e `aria-hidden`: o botao nao tem texto nenhum. Sem `aria-label` ele
    // seria um botao mudo — e por isso o nome acessivel e afirmado aqui.
    expect(item.textContent).toBe('');
    expect(item.getAttribute('aria-label')).toBe('Renko');
  });

  it('a folha do cromo é injetada uma única vez', () => {
    render(<SegmentedControl ariaLabel="a" options={TRES} value="Line" onChange={() => {}} />);
    render(<SegmentedControl ariaLabel="b" options={TRES} value="Line" onChange={() => {}} />);

    const folhas = document.querySelectorAll('style#robustus-chrome-styles');
    expect(folhas).toHaveLength(1);
    // ⭐ A transicao TEM de morar na folha: estilo inline vence `@media`, e
    // `prefers-reduced-motion` nao teria como desligar o movimento.
    const css = folhas[0]?.textContent ?? '';
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('150ms');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChartToolbar — grupos e callbacks
// ═════════════════════════════════════════════════════════════════════════════

function renderBarra(over: Partial<Parameters<typeof ChartToolbar>[0]> = {}) {
  const espioes = {
    tipo: vi.fn(),
    camada: vi.fn(),
    ambiente: vi.fn(),
    acao: vi.fn(),
  };
  const resultado = render(
    <ChartToolbar
      chartType="Candlestick"
      chartTypes={CHART_TYPE_OPTIONS}
      onChartTypeChange={espioes.tipo}
      layers={CAMADAS}
      onToggleLayer={espioes.camada}
      environment={AMBIENTE}
      onToggleEnvironment={espioes.ambiente}
      actions={ACOES}
      onAction={espioes.acao}
      {...over}
    />,
  );
  return { ...resultado, espioes };
}

describe('ChartToolbar — grupos por propósito', () => {
  it('renderiza os quatro grupos, cada um com aria-label próprio', () => {
    renderBarra();

    for (const rotulo of Object.values(CHART_TOOLBAR_GROUP_LABELS)) {
      expect(screen.getByRole('group', { name: rotulo })).toBeTruthy();
    }
    // O container tambem e um grupo nomeado — e NAO um `toolbar`: o radiogroup
    // interno reivindica as setas, e prometer teclado de toolbar seria mentir.
    expect(screen.getByRole('group', { name: 'Barra de ferramentas do gráfico' })).toBeTruthy();
  });

  it('dispara o callback de cada grupo, com o id do item', () => {
    const { espioes } = renderBarra();

    fireEvent.click(screen.getByRole('radio', { name: 'Renko' }));
    expect(espioes.tipo).toHaveBeenCalledWith('Renko');

    fireEvent.click(screen.getByRole('button', { name: 'Footprint' }));
    expect(espioes.camada).toHaveBeenCalledWith('footprint');

    fireEvent.click(screen.getByRole('button', { name: 'Grade' }));
    expect(espioes.ambiente).toHaveBeenCalledWith('grid');

    fireEvent.click(screen.getByRole('button', { name: 'Exportar imagem' }));
    expect(espioes.acao).toHaveBeenCalledWith('screenshot');
  });

  it('alternável usa aria-pressed; ação NÃO tem aria-pressed', () => {
    renderBarra();

    // ⚠️ A distincao nao e cosmetica: `aria-pressed` numa acao pontual diria ao
    // leitor de tela que "Exportar imagem" fica ligada.
    expect(screen.getByRole('button', { name: 'Bookmap' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Footprint' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Salvar layout' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('compact deixa os botões sem texto, mantendo o nome acessível', () => {
    renderBarra({ compact: true });

    const botao = screen.getByRole('button', { name: 'Bookmap' });
    expect(botao.textContent).toBe('');
    expect(botao.getAttribute('aria-label')).toBe('Bookmap');
  });

  it('⭐ sem medida (jsdom/SSR) mostra TUDO: nada colapsa e não há botão "Mais"', () => {
    // O `vitest.setup.ts` da um `ResizeObserver` que nunca notifica e o jsdom da
    // `offsetWidth` zero. A barra nao sabe a largura — e a resposta certa para
    // "nao sei" e mostrar tudo, nunca esconder.
    renderBarra();

    expect(screen.queryByRole('button', { name: 'Mais ferramentas' })).toBeNull();
    expect(screen.getByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.actions })).toBeTruthy();
  });

  it('trailing aparece à direita', () => {
    renderBarra({ trailing: <button type="button">Comandos</button> });
    expect(screen.getByRole('button', { name: 'Comandos' })).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChartToolbar — o colapso, com medida instrumentada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um `ResizeObserver` que o teste consegue acionar.
 *
 * ⚠️ O duble do `vitest.setup.ts` NUNCA notifica, de proposito (nao inventar
 * dimensao em teste de grafico). Aqui a dimensao e declarada pelo teste, entao ela
 * nao e inventada — e a unica forma de exercitar o caminho do colapso.
 */
class ResizeObserverControlavel {
  static instancias: ResizeObserverControlavel[] = [];
  private readonly alvos: Element[] = [];
  constructor(private readonly cb: ResizeObserverCallback) {
    ResizeObserverControlavel.instancias.push(this);
  }
  observe(el: Element): void {
    this.alvos.push(el);
  }
  unobserve(): void {
    /* nao usado */
  }
  disconnect(): void {
    /* nao usado */
  }
  emitir(width: number): void {
    const entradas = this.alvos.map((target) => ({
      target,
      contentRect: { width, height: 40 },
    })) as unknown as ResizeObserverEntry[];
    act(() => {
      this.cb(entradas, this as unknown as ResizeObserver);
    });
  }
}

describe('ChartToolbar — responsivo sem media query', () => {
  const originalRO = globalThis.ResizeObserver;
  const descritorOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  beforeEach(() => {
    ResizeObserverControlavel.instancias = [];
    globalThis.ResizeObserver = ResizeObserverControlavel as unknown as typeof ResizeObserver;
    // Larguras naturais fabricadas: 200 px por grupo, 78 px no botao "Mais".
    // O jsdom nao faz layout, entao sem isto `offsetWidth` e sempre 0 e a barra
    // (corretamente) desiste de medir.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement): number {
        const classe = typeof this.className === 'string' ? this.className : '';
        if (classe.includes('robustus-toolbar__group')) return 200;
        if (classe.includes('robustus-toolbar__more')) return 78;
        return 0;
      },
    });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalRO;
    if (descritorOriginal !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descritorOriginal);
    }
  });

  /** A conta: 4 grupos x 200 px + 3 x 8 px de espaco = 824 px de largura natural. */
  const NATURAL = 824;

  it('largura folgada: nada colapsa', () => {
    renderBarra();
    const ro = ResizeObserverControlavel.instancias.at(-1);
    expect(ro).toBeDefined();

    ro?.emitir(NATURAL + 100);

    expect(screen.queryByRole('button', { name: 'Mais ferramentas' })).toBeNull();
  });

  it('⭐ aperta e o grupo MENOS essencial (Ações) sai da barra para o menu "Mais"', () => {
    const { espioes } = renderBarra();
    const ro = ResizeObserverControlavel.instancias.at(-1);

    // 720 px: cabe tudo menos as acoes (824 - 208 + 86 do botao "Mais" = 702).
    ro?.emitir(720);

    // A barra perdeu o grupo de acoes…
    expect(screen.queryByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.actions })).toBeNull();
    // …e o desenho do preco, que nunca colapsa, continua lá.
    expect(screen.getByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.chartType })).toBeTruthy();
    expect(screen.getByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.layers })).toBeTruthy();

    const mais = screen.getByRole('button', { name: 'Mais ferramentas' });
    expect(mais.getAttribute('aria-haspopup')).toBe('menu');
    expect(mais.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(mais);
    expect(mais.getAttribute('aria-expanded')).toBe('true');

    const menu = screen.getByRole('menu', { name: 'Mais ferramentas' });
    // ⭐ Colapsar economiza espaco sem destruir a categoria: a secao dentro do
    // menu tem o MESMO nome que o grupo tinha na barra.
    expect(within(menu).getByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.actions })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Exportar imagem/ }));
    expect(espioes.acao).toHaveBeenCalledWith('screenshot');
    // Acao encerra o assunto: o menu fecha.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('aperta mais e as camadas também colapsam, como menuitemcheckbox', () => {
    const { espioes } = renderBarra();
    const ro = ResizeObserverControlavel.instancias.at(-1);

    ro?.emitir(300);

    expect(screen.queryByRole('group', { name: CHART_TOOLBAR_GROUP_LABELS.layers })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ferramentas' }));

    const menu = screen.getByRole('menu');
    const item = within(menu).getByRole('menuitemcheckbox', { name: /Bookmap/ });
    // Alternavel no menu carrega o estado: `aria-checked`, nao `aria-pressed`
    // (dentro de `menu` o papel correto e `menuitemcheckbox`).
    expect(item.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(item);
    expect(espioes.camada).toHaveBeenCalledWith('bookmap');
    // Alternavel MANTEM o menu aberto: ligar duas camadas e uma intencao só.
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('Escape fecha o menu e devolve o foco ao botão', () => {
    renderBarra();
    ResizeObserverControlavel.instancias.at(-1)?.emitir(300);

    const mais = screen.getByRole('button', { name: 'Mais ferramentas' });
    fireEvent.click(mais);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(mais);
  });

  it('voltar a caber fecha o menu pendurado (o botão que o ancora deixa de existir)', () => {
    renderBarra();
    const ro = ResizeObserverControlavel.instancias.at(-1);

    ro?.emitir(300);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ferramentas' }));
    expect(screen.queryByRole('menu')).not.toBeNull();

    ro?.emitir(NATURAL + 100);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais ferramentas' })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CollapsiblePanel
// ═════════════════════════════════════════════════════════════════════════════

describe('CollapsiblePanel', () => {
  /** O cabecalho anuncia titulo + badge, entao o nome acessivel casa por regex. */
  const cabecalho = (): HTMLElement => screen.getByRole('button', { name: /Indicadores/ });
  const corpoDe = (el: HTMLElement): HTMLElement => {
    const id = el.getAttribute('aria-controls') ?? '';
    const corpo = document.getElementById(id);
    expect(corpo).not.toBeNull();
    return corpo as HTMLElement;
  };

  it('não controlado: defaultOpen manda, e o clique alterna', () => {
    const espiao = vi.fn();
    render(
      <CollapsiblePanel title="Indicadores" icon="indicator" defaultOpen={false} badge="3 ativos" onOpenChange={espiao}>
        <p>conteúdo</p>
      </CollapsiblePanel>,
    );

    const h = cabecalho();
    expect(h.getAttribute('aria-expanded')).toBe('false');
    expect(corpoDe(h).hidden).toBe(true);

    fireEvent.click(h);
    expect(espiao).toHaveBeenCalledWith(true);
    expect(cabecalho().getAttribute('aria-expanded')).toBe('true');
    expect(corpoDe(cabecalho()).hidden).toBe(false);

    fireEvent.click(cabecalho());
    expect(espiao).toHaveBeenLastCalledWith(false);
    expect(cabecalho().getAttribute('aria-expanded')).toBe('false');
  });

  it('⭐ fechado, o badge continua informando que há algo ali', () => {
    render(
      <CollapsiblePanel title="Indicadores" defaultOpen={false} badge="3 ativos">
        <p>conteúdo</p>
      </CollapsiblePanel>,
    );

    // Visivel na tela E no nome acessivel do cabecalho: fechar economiza espaco
    // sem esconder estado.
    expect(screen.getByText('3 ativos')).toBeTruthy();
    expect(cabecalho().getAttribute('aria-label')).toBeNull();
    expect(cabecalho().textContent).toContain('3 ativos');
  });

  it('⚠️ controlado: o pai manda — sem reagir ao callback, o painel NÃO abre', () => {
    const espiao = vi.fn();
    const { rerender } = render(
      <CollapsiblePanel title="Indicadores" open={false} onOpenChange={espiao}>
        <p>conteúdo</p>
      </CollapsiblePanel>,
    );

    fireEvent.click(cabecalho());
    expect(espiao).toHaveBeenCalledWith(true);
    // O estado interno NAO foi tocado: interface e estado do pai nao podem
    // discordar em silencio.
    expect(cabecalho().getAttribute('aria-expanded')).toBe('false');
    expect(corpoDe(cabecalho()).hidden).toBe(true);

    rerender(
      <CollapsiblePanel title="Indicadores" open onOpenChange={espiao}>
        <p>conteúdo</p>
      </CollapsiblePanel>,
    );
    expect(cabecalho().getAttribute('aria-expanded')).toBe('true');
    expect(corpoDe(cabecalho()).hidden).toBe(false);
  });

  it('aria-controls aponta para um elemento que EXISTE, aberto ou fechado', () => {
    render(
      <CollapsiblePanel title="Indicadores" defaultOpen={false}>
        <p>conteúdo</p>
      </CollapsiblePanel>,
    );

    // ⚠️ O corpo nao e desmontado ao fechar: referencia pendurada quebraria o
    // `aria-expanded`, e desmontar jogaria fora o estado dos filhos.
    const corpo = corpoDe(cabecalho());
    expect(corpo.textContent).toBe('conteúdo');
    expect(corpo.hidden).toBe(true);
  });
});
