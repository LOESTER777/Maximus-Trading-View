/**
 * A MONTAGEM do playground — a bancada que faltava.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ELA EXISTE, E O QUE ELA COBRE QUE NADA MAIS COBRIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O playground tinha `typecheck:playground` (que já pegou dois defeitos reais) e o Vite
 * servindo a página. Nenhum dos dois prova que a tela MONTA: o type check não executa nada, e
 * o Vite responder 200 só diz que o transform passou.
 *
 * ⭐ E existe uma família de defeito que só aparece na execução, e que o type check não vê:
 * ordem de declaração de hook, dependência circular entre hooks (o "ciclo" das abas, em que
 * elas decidem o ativo mas precisam do estado que o ativo produz), `useState`/`useEffect`
 * condicionais, e leitura de variável `const` antes da inicialização dentro de um callback que
 * é chamado no render em vez de num evento. Todos derrubam a página com a tela BRANCA — o
 * modo mais caro de descobrir, porque não há mensagem no lugar onde se está olhando.
 *
 * ⚠️ **Não é teste de aparência.** Em jsdom o container mede 0 px e `getContext('2d')` devolve
 * `null` (é requisito do projeto, ver as convenções), então não há uma vela desenhada para
 * medir. O que se mede é: a árvore monta, o cromo essencial está lá, e os controles que a
 * rodada mexeu respondem sem lançar.
 *
 * ⭐⭐ **A montagem passa por `<StrictMode>`**, porque é assim que o módulo real monta. Isso
 * dobra render e efeito de propósito: efeito que não é idempotente (dois donos da mesma
 * camada, ouvinte que não se remove, estado inicial recalculado) reprova aqui.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';

/**
 * ⚠️ `fireEvent` e nao `@testing-library/user-event`: o projeto nao acrescenta dependencia,
 * nem de desenvolvimento, por causa de um teste. Aqui a diferenca nao muda o que se mede — o
 * que se exercita e `onChange` de `<select>` e `onClick` de `<button>`, e `fireEvent` despacha
 * os dois dentro de `act`. O `user-event` valeria para gesto composto (arrastar, digitar com
 * teclado real), e disso o teste de montagem nao trata.
 */
function escolher(rotulo: string, valor: string): void {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

function clicar(elemento: HTMLElement): void {
  fireEvent.click(elemento);
}

/**
 * Monta o playground como o navegador monta: cria `#root` e importa o módulo de entrada, que
 * se auto-inicializa.
 *
 * ⚠️ `resetModules` antes de cada importação. Sem isso a segunda montagem reusaria o módulo já
 * avaliado e o `createRoot` não rodaria — o teste ficaria verde medindo a árvore do teste
 * anterior, que é vacuidade.
 */
async function montarPlayground(): Promise<void> {
  vi.resetModules();
  const { App } = (await import('../main.js')) as { App: () => JSX.Element };
  render(
    // ⭐⭐ `StrictMode` porque é assim que o módulo real monta: render e efeito DOBRADOS, então
    // efeito não idempotente (dois donos da mesma camada, ouvinte que não se remove) reprova
    // aqui.
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // A montagem do React 18 é agendada; esperar por um marco da árvore é o sinal de que ela
  // aconteceu — mais honesto que um `setTimeout` arbitrário.
  await waitFor(() => expect(screen.getByText('Robustus')).toBeTruthy());
}

/**
 * Monta pelo CAMINHO DO NAVEGADOR: cria `#root` e deixa o `createRoot` do módulo agir.
 *
 * ⚠️ Usado UMA vez, de propósito. Ele prova que o ponto de entrada de verdade boota — o que
 * `render(<App/>)` não prova — mas a raiz criada assim NÃO é desmontável pelo `cleanup()`, e
 * instâncias vivas de casos anteriores seguiriam gravando em `localStorage`, tornando a suíte
 * dependente de ORDEM. Por isso é um caso só, e o último.
 */
async function montarPeloPontoDeEntrada(): Promise<void> {
  const raiz = document.createElement('div');
  raiz.id = 'root';
  document.body.appendChild(raiz);
  vi.resetModules();
  await import('../main.js');
  await waitFor(() => expect(screen.getByText('Robustus')).toBeTruthy());
}

/**
 * Semeia a área de trabalho no armazenamento, para a aba de partida ser DETERMINÍSTICA.
 *
 * ⚠️ Existe porque o default passou a ser o WIN da mesa, e em jsdom não há mesa: a montagem
 * fresca cai para o sintético por um caminho ASSÍNCRONO. Um teste que precise de uma aba estável
 * não pode depender de quem ganha essa corrida — ele semeia o que quer.
 *
 * ⚠️⚠️ E a aba semeada leva DOCUMENTO, e isso não é detalhe: uma aba sintética sozinha e SEM
 * documento é, por definição, o default nunca tocado — e o app a substitui pelo WIN, que é
 * exatamente o comportamento desejado. Foi o próprio teste que bateu nessa guarda ao tentar
 * semear `SINTETICO` com documento nulo. O documento é o que torna a área de trabalho uma
 * ESCOLHA do operador. Ver `pareceDefaultNaoTocado` em `main.tsx`.
 */
const DOCUMENTO_VAZIO = {
  version: 1,
  priceSeriesType: 'Candlestick',
  indicators: [],
  alerts: [],
  drawings: { version: 1, drawings: [] },
} as const;
function semearAreaDeTrabalho(
  abas: readonly { readonly symbol: string; readonly periodSeconds: number }[],
  ativa = 0,
): void {
  localStorage.setItem(
    'robustus-abas',
    JSON.stringify({
      version: 1,
      ativa: `aba-${ativa + 1}`,
      abas: abas.map((a, i) => ({
        id: `aba-${i + 1}`,
        symbol: a.symbol,
        periodSeconds: a.periodSeconds,
        documento: DOCUMENTO_VAZIO,
        abertaEm: 1_700_000_000,
        atualizadoEm: 1_700_000_000,
      })),
    }),
  );
}

beforeEach(() => {
  // ⚠️ Estado gravado de uma execução anterior mudaria o que a tela monta (a área de trabalho
  // e os setups vivem em `localStorage`). Cada caso parte do zero.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('a tela monta', () => {
  it('⭐ monta sem lançar, com o cromo essencial na tela', async () => {
    const erros: unknown[] = [];
    const espia = vi.spyOn(console, 'error').mockImplementation((...a) => erros.push(a));

    await montarPlayground();

    // O cromo que precisa existir para a tela ser operável.
    expect(screen.getByRole('tablist', { name: 'Ativos' })).toBeTruthy();
    expect(screen.getByLabelText('Ativo')).toBeTruthy();
    expect(screen.getByRole('button', { name: /paleta de comandos/i })).toBeTruthy();
    // A barra vertical de desenho.
    expect(screen.getByRole('toolbar', { name: /desenho/i })).toBeTruthy();

    // ⚠️ Erro de render do React sai por `console.error`, não por exceção — sem esta guarda o
    // teste passaria com a árvore quebrada e um "The above error occurred in..." no log.
    const graves = erros.filter((e) => !/not wrapped in act|Not implemented/i.test(String(e)));
    expect(graves, `console.error na montagem: ${JSON.stringify(graves.slice(0, 2))}`).toEqual([]);
    espia.mockRestore();
  });

  it('a aba mostra o período no rótulo, e é a ativa', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();
    const abas = screen.getAllByRole('tab');
    expect(abas).toHaveLength(1);
    expect(abas[0]?.textContent).toContain('SINTÉTICO');
    // A segunda linha da aba é o período — é o que distingue duas abas do mesmo ativo.
    // ⚠️ O rótulo é `5m` (apresentação), não `M5` (o id). A aba guarda SEGUNDOS; o id e o
    // rótulo são as duas grafias de apresentação, e a tela mostra o rótulo.
    expect(abas[0]?.textContent).toContain('5m');
    expect(abas[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('⭐⭐ o ativo de PARTIDA é o WIN da mesa, em D1', async () => {
    // ⚠️ Relato: *"pq estou vendo ativo Sintético ainda? e não o mini índice?"*. O default era
    // meu e otimizava para o dia em que o túnel cai.
    //
    // ⭐ A asserção é sobre a DECISÃO (as constantes), e não sobre a tela montada: em jsdom não
    // existe mesa, então a tela cai para o sintético por um caminho assíncrono, e medir a tela
    // aqui seria medir quem ganha a corrida. A chegada é o caso seguinte.
    const { SIMBOLO_INICIAL, PERIODO_INICIAL_SEG } = (await import('../main.js')) as unknown as {
      SIMBOLO_INICIAL: string;
      PERIODO_INICIAL_SEG: number;
    };
    expect(SIMBOLO_INICIAL).toBe('WIN');
    // ⭐ D1 e não M5: é o único período em que "Leitura do ativo" consegue responder (desempenho
    // por janela precisa alcançar 1 ano; sazonalidade precisa de 60 dias de pregão).
    expect(PERIODO_INICIAL_SEG).toBe(86_400);
  });

  it('⭐⭐ sem a MESA no ar, a tela cai para o sintético e DIZ por quê', async () => {
    // ⚠️ Uma tela que troca de fonte sozinha e não explica é pior que uma tela de erro: o
    // operador acha que está lendo o mini índice e está lendo um gerador.
    await montarPlayground();
    await waitFor(
      () => {
        const abas = screen.getAllByRole('tab');
        expect(abas[0]?.textContent).toContain('SINTÉTICO');
      },
      { timeout: 3000 },
    );
    // E o motivo aparece na trilha de legendas, não num canto novo.
    await waitFor(() => expect(screen.getByText(/Dado sintetico:/i)).toBeTruthy());
  });

  it('⭐⭐ depois de RECARREGAR, a aba que o operador escolheu NÃO cai para o sintético', async () => {
    // ⚠️ Foi um defeito REAL do meu primeiro desenho: a queda usava "primeiro render deste
    // componente", e depois de um F5 isso é verdade outra vez — VALE3 escolhido a dedo era
    // trocado pelo gerador local em silêncio. A pergunta certa é "esta aba veio do DEFAULT?".
    semearAreaDeTrabalho([{ symbol: 'VALE3', periodSeconds: 86_400 }]);
    await montarPlayground();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getAllByRole('tab')[0]?.textContent).toContain('VALE3');
    expect(screen.queryByText(/Dado sintetico:/i)).toBeNull();
  });

  it('⚠️ a última aba NÃO oferece o ✕ (a barra vazia deixaria a tela sem gráfico)', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();
    expect(screen.queryByRole('button', { name: /^Fechar / })).toBeNull();
  });
});

describe('⭐⭐ as abas, na tela', () => {
  it('escolher um ativo da mesa ABRE uma segunda aba e a ativa', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    escolher('Ativo', 'PETR4');

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    const abas = screen.getAllByRole('tab');
    expect(abas[1]?.textContent).toContain('PETR4');
    expect(abas[1]?.getAttribute('aria-selected')).toBe('true');
    // ⭐ E o seletor de ativo passou a mostrar a aba ATIVA: uma verdade só, com um dono só.
    expect((screen.getByLabelText('Ativo') as HTMLSelectElement).value).toBe('PETR4');
  });

  it('escolher o MESMO ativo de novo não duplica a aba — vai para ela', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();
    const seletor = screen.getByLabelText('Ativo');

    fireEvent.change(seletor, { target: { value: 'PETR4' } });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    fireEvent.change(seletor, { target: { value: 'SINTETICO' } });
    await waitFor(() => expect((seletor as HTMLSelectElement).value).toBe('SINTETICO'));
    fireEvent.change(seletor, { target: { value: 'PETR4' } });

    // Continua com DUAS abas: a do PETR4 foi ativada, não recriada.
    await waitFor(() => expect((seletor as HTMLSelectElement).value).toBe('PETR4'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('⭐ trocar de aba pela barra volta o ativo daquela aba', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    escolher('Ativo', 'WDO');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    // Clica na primeira aba (o sintético).
    clicar(screen.getAllByRole('tab')[0] as HTMLElement);
    await waitFor(() =>
      expect((screen.getByLabelText('Ativo') as HTMLSelectElement).value).toBe('SINTETICO'),
    );
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('⭐ o + DUPLICA a aba, e o período muda só na cópia', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    clicar(screen.getByRole('button', { name: /duplicar esta aba/i }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    // Muda o período: mexe na aba ATIVA (a cópia), e a original fica em 5m.
    // ⚠️ `role="radio"` e não `button`: o seletor de período é uma escolha entre alternativas
    // (`radiogroup`), diferente da barra de ABAS, que é navegação (`tablist`).
    clicar(screen.getByRole('radio', { name: '15m' }));
    await waitFor(() => {
      const abas = screen.getAllByRole('tab');
      expect(abas[0]?.textContent).toContain('5m');
      expect(abas[1]?.textContent).toContain('15m');
    });
    // ⭐ É este par que era INALCANÇÁVEL antes: o mesmo ativo em dois períodos.
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('com duas abas o ✕ aparece, e fechar a ativa elege a vizinha', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    escolher('Ativo', 'WIN');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    clicar(screen.getByRole('button', { name: /^Fechar WIN/ }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect((screen.getByLabelText('Ativo') as HTMLSelectElement).value).toBe('SINTETICO');
    // Voltou a ser a última: o ✕ desaparece de novo.
    expect(screen.queryByRole('button', { name: /^Fechar / })).toBeNull();
  });

  it('⭐ a área de trabalho SOBREVIVE ao recarregamento da página', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();
    escolher('Ativo', 'VALE3');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    // O que "recarregar" significa aqui: desmontar tudo e montar de novo, com o
    // `localStorage` intacto — é o único estado que atravessa.
    expect(localStorage.getItem('robustus-abas'), 'nada foi persistido').not.toBeNull();
    cleanup();
    document.body.innerHTML = '';
    await montarPlayground();

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    expect(screen.getAllByRole('tab')[1]?.textContent).toContain('VALE3');
    expect((screen.getByLabelText('Ativo') as HTMLSelectElement).value).toBe('VALE3');
  });

  it('⚠️ área de trabalho corrompida no armazenamento não derruba a montagem', async () => {
    // Gravação truncada por cota estourada é o caminho realista para isto.
    localStorage.setItem('robustus-abas', '{"version":1,"ativa":"aba-1","ab');
    await montarPlayground();
    // Cai para a aba inicial em vez de deixar a tela branca.
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getAllByRole('tab')[0]?.textContent).toContain('SINTÉTICO');
  });
});

describe('os controles que a rodada mexeu respondem', () => {
  it('o período da barra troca sem lançar, e o rótulo da aba acompanha', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    clicar(screen.getByRole('radio', { name: '1h' }));
    await waitFor(() => expect(screen.getAllByRole('tab')[0]?.textContent).toContain('1h'));
    // Continua UMA aba: mudar período é EDIÇÃO da aba, não abertura de outra.
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('⭐⭐ o arranjo dos sub-painéis troca sem derrubar a tela', async () => {
    await montarPlayground();
    clicar(screen.getByRole('button', { name: /caixa de indicadores|indicadores/i }));

    const seletor = await waitFor(() => screen.getByLabelText(/arranjo dos sub-painéis/i));
    expect((seletor as HTMLSelectElement).value).toBe('auto');

    // ⚠️ O que se mede aqui é a MONTAGEM sobrevivendo à troca de arranjo — a geometria em si
    // é medida contra o motor real em `grade-de-subpaineis.spec.ts`, com quatro sub-painéis.
    // Aqui o playground tem um só, então `auto` resolve para uma coluna: é exatamente a
    // decisão de a grade só aparecer quando há o que arranjar.
    for (const valor of ['2', '3', '4', '1', 'auto']) {
      fireEvent.change(seletor, { target: { value: valor } });
      await waitFor(() => expect((seletor as HTMLSelectElement).value).toBe(valor));
      // A tela continua de pé a cada troca.
      expect(screen.getByText('Robustus')).toBeTruthy();
    }
  });

  it('o painel de replay diz QUE série está na tela', async () => {
    semearAreaDeTrabalho([{ symbol: 'SINTETICO', periodSeconds: 300 }]);
    await montarPlayground();

    clicar(screen.getByRole('button', { name: /replay de mercado/i }));
    // ⭐ Sem esta linha, "posição 240/6376" não diz de que ativo nem de que período.
    // ⚠️ A linha é um `<span>` só, com o símbolo, o período, a contagem e a fonte juntos —
    // então a asserção é sobre o TEXTO dela, não sobre um elemento por pedaço.
    const linha = await waitFor(() => screen.getByText(/dado sintético/i));
    expect(linha.textContent).toMatch(/SINTÉTICO/);
    expect(linha.textContent).toMatch(/5m/);
    expect(linha.textContent).toMatch(/barra\(s\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('o PONTO DE ENTRADA', () => {
  it('⭐ o `createRoot` do módulo boota quando existe `#root`', async () => {
    // ⚠️ Último caso do arquivo de propósito: a raiz criada aqui não é desmontável pelo
    // `cleanup()`, e uma instância viva seguiria gravando na área de trabalho — o que tornaria
    // os casos seguintes dependentes de ORDEM. Foi exatamente esse defeito que fez um caso
    // passar sozinho e reprovar no conjunto.
    await montarPeloPontoDeEntrada();
    expect(screen.getByRole('tablist', { name: 'Ativos' })).toBeTruthy();
  });
});
