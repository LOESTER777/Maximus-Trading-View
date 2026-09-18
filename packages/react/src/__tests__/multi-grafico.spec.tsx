/**
 * Vários gráficos na tela: abas, grade e sincronia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS TRAVAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido tinha dois modos: *"separá-los por aba"* (um ativo por vez) e *"deixar na mesma
 * tela para acompanhar a correlação"* (vários ao mesmo tempo, alinhados).
 *
 * ⭐ **A sincronia viaja por TEMPO, não por índice lógico.** É a afirmação mais importante
 * deste arquivo: a barra 100 de M5 e a 100 de H1 estão a 8 h20 e a 100 h do início. Copiar
 * a janela lógica poria os dois gráficos em instantes completamente diferentes, e
 * "sincronizado" seria uma mentira difícil de perceber.
 *
 * ⭐ **E o laço de eco.** A move → aplica em B → B emite → aplica em A → … Um laço infinito
 * com os dois gráficos travados.
 *
 * ⛔⛔ **E aqui houve um defeito DE BANCADA, que vale mais que o defeito de código.** O motor
 * duplo emitia a mudança de faixa **de dentro** de `setVisibleLogicalRange`, ou seja de forma
 * SÍNCRONA. O motor real emite de dentro do `render()`, que roda em `requestAnimationFrame` — um
 * quadro depois. O duplo codificava a MESMA premissa errada do código que ele deveria auditar, e
 * por isso "provava" que a guarda síncrona funcionava.
 *
 * O operador encontrou o que a bancada não achava: *"quando cliquei no botão comparar, nada no
 * gráfico se move mais"*. Agora o duplo emite **diferido** (`emitirPendentes`), como o real, e há
 * caso que reprova a guarda antiga.
 *
 * ⭐ A lição de método: **teste duplo que reproduz a suposição do código sob teste não testa
 * nada.** O que o duplo tem de imitar é o comportamento OBSERVADO do original — aqui, o momento
 * da notificação — e não o comportamento que torna o código conveniente.
 *
 * ⚠️ Motor DUPLO em vez do real: em jsdom o container mede 0 px, então o motor de verdade
 * nunca emitiria faixa visível nenhuma e todos os casos passariam por vacuidade. O duplo
 * expõe só a superfície que o hook consome — o que também documenta o quanto ele exige do
 * motor: `timeScale()` (assinar faixa, `getVisibleRange`, `getVisibleLogicalRange`,
 * `timeToIndex`, `setVisibleLogicalRange`) e o crosshair.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useChartSync } from '../useChartSync.js';
import { SymbolTabs } from '../SymbolTabs.js';
import { ChartGrid, chartGridSlots } from '../ChartGrid.js';
import type { ChartEngine } from '@robustus/charts-engine';

afterEach(cleanup);

// ═════════════════════════════════════════════════════════════════════════════
// Motor duplo — um eixo de tempo com período próprio
// ═════════════════════════════════════════════════════════════════════════════

const T0 = 1_700_000_000;

interface MotorFalso {
  readonly engine: ChartEngine;
  /** Emite "a janela mudou" (o que o motor faz depois de um pan). */
  emitirJanela: () => void;
  /** Emite movimento de crosshair num instante. */
  emitirCrosshair: (time: number | null) => void;
  /** A janela LÓGICA aplicada de fora, ou `null` se ninguém aplicou. */
  janelaAplicada: () => { from: number; to: number } | null;
  /** Quantas vezes alguém aplicou janela aqui — o detector de eco. */
  aplicacoes: () => number;
  /** Muda a faixa de tempo que este gráfico diz estar mostrando. */
  definirFaixa: (de: number, ate: number) => void;
  /**
   * ⭐⭐ Emite as notificações que ficaram PENDENTES — o "quadro seguinte" do motor real.
   *
   * Ver o cabeçalho: o motor avisa os assinantes de faixa de dentro do `render()`, em
   * `requestAnimationFrame`. Sem este passo o duplo mentia sobre o momento da notificação.
   */
  emitirPendentes: () => void;
  ouvintes: () => number;
}

/**
 * @param periodo Duração da barra em segundos. É o que faz índice ≠ tempo entre motores.
 */
function motorFalso(periodo: number, faixa = { from: T0, to: T0 + 100 * periodo }): MotorFalso {
  const ouvintesJanela = new Set<(r: unknown) => void>();
  const ouvintesCrosshair = new Set<(p: unknown) => void>();
  let visivel = { ...faixa };
  let aplicada: { from: number; to: number } | null = null;
  let contaAplicacoes = 0;
  /** A notificação que o motor real emitiria no PRÓXIMO quadro. Ver `emitirPendentes`. */
  let pendente: { from: number; to: number } | null = null;

  const timeScale = {
    subscribeVisibleLogicalRangeChange: (h: (r: unknown) => void) => ouvintesJanela.add(h),
    unsubscribeVisibleLogicalRangeChange: (h: (r: unknown) => void) => ouvintesJanela.delete(h),
    getVisibleRange: () => ({ ...visivel }),
    /**
     * A janela LÓGICA corrente.
     *
     * ⚠️ Derivada da faixa de TEMPO visível, e não "a última aplicada de fora". No motor real as
     * duas são a mesma coisa vista de dois jeitos: um pan muda `leftLogical` e, por consequência,
     * o intervalo de tempo mostrado. A primeira versão deste duplo devolvia a última janela
     * aplicada por `setVisibleLogicalRange`, e com isso um pan simulado por `definirFaixa` mexia
     * no tempo e NÃO na lógica — o que fazia a guarda de eco confundir movimento do operador com
     * eco. Duplo incoerente entre dois getters é armadilha para o teste, não para o código.
     */
    getVisibleLogicalRange: () => ({
      from: (visivel.from - T0) / periodo,
      to: (visivel.to - T0) / periodo,
    }),
    // Índice = (tempo - T0) / periodo. É a tradução que cada motor faz com o SEU período —
    // e é por isso que copiar índice entre gráficos de períodos diferentes está errado.
    timeToIndex: (time: number) => Math.round((time - T0) / periodo),
    setVisibleLogicalRange: (r: { from: number; to: number }) => {
      aplicada = { ...r };
      contaAplicacoes += 1;
      visivel = { from: T0 + r.from * periodo, to: T0 + r.to * periodo };
      // ⭐⭐ A notificação fica PENDENTE, não sai aqui. O motor real notifica de dentro do
      // `render()`, em `requestAnimationFrame` — e era emitir aqui, de forma síncrona, que fazia
      // este duplo esconder o laço de eco. Ver o cabeçalho.
      pendente = { ...r };
    },
  };

  const engine = {
    isDisposed: false,
    api: {
      timeScale: () => timeScale,
      subscribeCrosshairMove: (h: (p: unknown) => void) => ouvintesCrosshair.add(h),
      unsubscribeCrosshairMove: (h: (p: unknown) => void) => ouvintesCrosshair.delete(h),
    },
  };

  return {
    engine: engine as unknown as ChartEngine,
    emitirJanela: () => {
      for (const h of [...ouvintesJanela]) h({ from: 0, to: 10 });
    },
    emitirCrosshair: (time) => {
      for (const h of [...ouvintesCrosshair]) h(time === null ? {} : { time });
    },
    janelaAplicada: () => aplicada,
    aplicacoes: () => contaAplicacoes,
    definirFaixa: (de, ate) => {
      visivel = { from: de, to: ate };
    },
    emitirPendentes: () => {
      if (pendente === null) return;
      const r = pendente;
      pendente = null;
      for (const h of [...ouvintesJanela]) h({ ...r });
    },
    ouvintes: () => ouvintesJanela.size + ouvintesCrosshair.size,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// useChartSync
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐ useChartSync — alinha por TEMPO', () => {
  it('propaga a faixa de tempo, convertida no ÍNDICE DE CADA gráfico', () => {
    const m5 = motorFalso(300);
    const h1 = motorFalso(3600);
    const { result } = renderHook(() => useChartSync());

    act(() => {
      result.current.register('m5', m5.engine);
      result.current.register('h1', h1.engine);
    });
    expect(result.current.count()).toBe(2);

    // O M5 passa a mostrar de T0 até T0 + 12 h.
    m5.definirFaixa(T0, T0 + 12 * 3600);
    act(() => m5.emitirJanela());

    // ⭐ 12 h no H1 são 12 BARRAS — não 144 (que seria o índice do M5 copiado).
    expect(h1.janelaAplicada()).toEqual({ from: 0, to: 12 });
  });

  it('o gráfico de ORIGEM não recebe aplicação de si mesmo', () => {
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });

    act(() => a.emitirJanela());
    expect(a.janelaAplicada()).toBeNull();
    expect(b.janelaAplicada()).not.toBeNull();
  });

  /**
   * ⭐ O CASO DO LAÇO DE ECO.
   *
   * O duplo emite mudança de faixa quando alguém aplica janela nele — como o motor real
   * faz. Sem a guarda de "estou aplicando", B avisaria de volta, A aplicaria em B, e o
   * laço não terminaria (na prática, estouro de pilha ou dois gráficos tremendo).
   *
   * A afirmação é dura: **uma aplicação por gráfico, por evento**.
   */
  it('NÃO entra em laço de eco: uma aplicação por evento', () => {
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });

    act(() => a.emitirJanela());

    expect(b.aplicacoes()).toBe(1);
    expect(a.aplicacoes()).toBe(0);
  });

  it('⛔⛔ NÃO entra em laço quando a notificação chega no QUADRO SEGUINTE', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // O DEFEITO QUE O OPERADOR ENCONTROU E A BANCADA NÃO ACHAVA
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ⚠️ *"quando cliquei no botão comparar, nada no gráfico se move mais"*.
    //
    // O motor notifica os assinantes de faixa de dentro do `render()`, em `requestAnimationFrame`.
    // A guarda antiga era um sinalizador síncrono, baixado no fim da propagação — então, quando o
    // aviso do destino chegava um quadro depois, ela já estava no chão e o eco passava:
    //
    //   quadro 1: A emite → aplica em B
    //   quadro 2: B avisa  → aplica em A      ⇠ eco
    //   quadro 3: A avisa  → aplica em B      ⇠ eco do eco
    //
    // O sintoma não é tremor, é PARALISIA: todo arrasto do operador é sobrescrito no quadro
    // seguinte pela janela que o outro painel devolve.
    //
    // ⭐ A guarda por CONTEÚDO faz o laço parar no quadro 2, e é o que este caso mede.
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });

    a.definirFaixa(T0, T0 + 12 * 3600);
    act(() => a.emitirJanela());
    expect(b.aplicacoes()).toBe(1);

    // O "quadro seguinte": B avisa que a janela dele mudou. Como a janela é EXATAMENTE a que o
    // grupo acabou de aplicar nele, é eco — e A não pode receber nada.
    act(() => b.emitirPendentes());
    expect(a.aplicacoes(), 'A recebeu o eco de B').toBe(0);

    // E o quadro seguinte a esse não pode reabrir o laço.
    act(() => a.emitirPendentes());
    act(() => b.emitirPendentes());
    expect(a.aplicacoes()).toBe(0);
    expect(b.aplicacoes()).toBe(1);
  });

  it('⭐ e o movimento LEGÍTIMO do painel de destino continua propagando', () => {
    // ⚠️ O par do caso acima, e é ele que impede a "correção" preguiçosa de simplesmente ignorar
    // todo evento do destino: depois de receber a janela, B ainda é um gráfico interativo. Se o
    // operador arrastar B, isso TEM de chegar em A — senão a sincronia é de mão única e o painel
    // de comparação vira uma imagem.
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });

    a.definirFaixa(T0, T0 + 12 * 3600);
    act(() => a.emitirJanela());
    act(() => b.emitirPendentes()); // o eco, engolido

    // Agora o operador arrasta B para OUTRO trecho.
    b.definirFaixa(T0 + 20 * 3600, T0 + 30 * 3600);
    act(() => b.emitirJanela());
    expect(a.aplicacoes(), 'o pan de B não chegou em A').toBe(1);
    expect(a.janelaAplicada()).toEqual({ from: 240, to: 360 });
  });

  it('⚠️ voltar À MÃO para a janela recebida ainda propaga — eco é consumido uma vez', () => {
    // ⭐ A guarda por conteúdo tem um risco: se o registro não fosse consumido, o operador que
    // arrastasse e voltasse exatamente para a janela sincronizada ficaria sem sincronia para
    // sempre naquele ponto. Consumir o registro no primeiro reconhecimento resolve.
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });
    a.definirFaixa(T0, T0 + 12 * 3600);
    act(() => a.emitirJanela());
    act(() => b.emitirPendentes()); // primeiro aviso: eco, engolido e CONSUMIDO

    // Segundo aviso com a mesma janela: agora é intenção, e propaga.
    act(() => b.emitirJanela());
    expect(a.aplicacoes()).toBe(1);
  });

  it('⭐⭐ o painel que ENTRA é alinhado ao grupo — ele não abre em outro momento', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // O RELATO
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ⚠️ *"quando mando comparar, o que representa o gráfico que abriu? é um ativo diferente?
    // pois o horário dele está diferente"*.
    //
    // Não era outro ativo — é o mesmo, em outro período. Mas o MOMENTO estava diferente de
    // verdade: a sincronia só agia em resposta a "a janela mudou", e abrir o painel não muda a
    // janela de ninguém. Ele nascia na ponta direita da série DELE enquanto o principal seguia
    // onde o operador o havia deixado. Dois trechos do mesmo ativo lado a lado, sem nada dizendo
    // isso — e a leitura natural é "são ativos diferentes".
    //
    // ⭐ A primeira notificação de um recém-chegado é o LAYOUT INICIAL dele, não um movimento.
    // Então o grupo propaga PARA ele, e não a partir dele.
    const principal = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('principal', principal.engine);
    });
    // O operador arrastou o principal para um trecho qualquer do passado.
    principal.definirFaixa(T0 + 100 * 3600, T0 + 112 * 3600);

    // Agora abre a comparação. O painel novo nasce mostrando OUTRO trecho.
    const comp = motorFalso(3600, { from: T0 + 900 * 3600, to: T0 + 1000 * 3600 });
    act(() => {
      result.current.register('comparacao', comp.engine);
    });
    // ⭐ O primeiro aviso dele (o layout inicial, quando o container finalmente foi medido) puxa a
    // janela do grupo em vez de empurrar a dele.
    act(() => comp.emitirJanela());

    // 100 h a 112 h depois de T0, em barras de 1 h.
    expect(comp.janelaAplicada()).toEqual({ from: 100, to: 112 });
    expect(principal.aplicacoes(), 'o principal foi arrastado pelo painel novo').toBe(0);
  });

  it('⭐ e DEPOIS de alinhado o painel novo move o grupo normalmente', () => {
    // ⚠️ O par do caso acima: "alinhe-se ao entrar" não pode virar "nunca comande". Sem este
    // caso, a correção poderia ser ignorar para sempre os eventos do painel de comparação.
    const principal = motorFalso(300);
    const comp = motorFalso(3600);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('principal', principal.engine);
      result.current.register('comparacao', comp.engine);
    });
    principal.definirFaixa(T0, T0 + 12 * 3600);
    act(() => comp.emitirJanela()); // primeiro aviso: alinhamento
    expect(comp.janelaAplicada()).toEqual({ from: 0, to: 12 });

    // Segundo aviso: o operador arrastou o painel de comparação.
    comp.definirFaixa(T0 + 50 * 3600, T0 + 60 * 3600);
    act(() => comp.emitirJanela());
    expect(principal.aplicacoes(), 'o pan da comparação não chegou no principal').toBe(1);
    expect(principal.janelaAplicada()).toEqual({ from: 600, to: 720 });
  });

  it('⚠️ membro que SAI e VOLTA é REALINHADO, não engolido nem ignorado', () => {
    // ⭐ É o caminho exato de desmarcar e marcar "Comparar": o motor antigo morre e um novo entra
    // sob a mesma chave. O registro de eco do motor MORTO é limpo na saída, e o motor NOVO nasce
    // desalinhado — então o primeiro aviso dele o traz para a janela do grupo.
    const a = motorFalso(300);
    const b1 = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    let sair = (): void => {};
    act(() => {
      result.current.register('a', a.engine);
      sair = result.current.register('comparacao', b1.engine);
    });
    a.definirFaixa(T0, T0 + 12 * 3600);
    act(() => a.emitirJanela());
    act(() => sair());

    const b2 = motorFalso(300);
    act(() => {
      result.current.register('comparacao', b2.engine);
    });
    b2.definirFaixa(T0 + 300 * 3600, T0 + 310 * 3600);
    act(() => b2.emitirJanela());
    // Alinhado à janela do `a`, e o `a` não foi arrastado.
    expect(b2.janelaAplicada()).toEqual({ from: 0, to: 144 });
    expect(a.aplicacoes()).toBe(0);
  });

  it('três gráficos: um evento aplica nos outros dois, uma vez cada', () => {
    const a = motorFalso(300);
    const b = motorFalso(900);
    const c = motorFalso(3600);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
      result.current.register('c', c.engine);
    });

    act(() => a.emitirJanela());
    expect(b.aplicacoes()).toBe(1);
    expect(c.aplicacoes()).toBe(1);
  });

  /**
   * ⚠️ Faixa degenerada: o destino tem uma barra só naquele intervalo (período muito maior
   * que a janela). Sem o piso de uma barra, `{from: 3, to: 3}` daria zoom infinito.
   */
  it('faixa que cabe em menos de uma barra do destino ganha piso de 1', () => {
    const m5 = motorFalso(300);
    const d1 = motorFalso(86_400);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('m5', m5.engine);
      result.current.register('d1', d1.engine);
    });

    // Uma hora de janela no M5: no D1 isso é zero barra.
    m5.definirFaixa(T0, T0 + 3600);
    act(() => m5.emitirJanela());

    const j = d1.janelaAplicada()!;
    expect(j.to - j.from).toBeGreaterThanOrEqual(1);
  });

  it('`viewport: false` não propaga janela', () => {
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result } = renderHook(() => useChartSync({ viewport: false }));
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });
    act(() => a.emitirJanela());
    expect(b.janelaAplicada()).toBeNull();
  });

  /**
   * ⚠️ O crosshair NÃO é desenhado no outro gráfico: o motor não expõe "mover o crosshair
   * por API" (ele nasce do ponteiro). O hook ENTREGA o instante, e quem decide o que
   * mostrar é o consumidor. Prometer a linha e não desenhá-la seria pior.
   */
  it('crosshair entrega o instante e a ORIGEM ao consumidor', () => {
    const a = motorFalso(300);
    const visto: Array<[string, number | null]> = [];
    const { result } = renderHook(() =>
      useChartSync({ onCrosshair: (id, t) => visto.push([id, t]) }),
    );
    act(() => result.current.register('a', a.engine));

    act(() => a.emitirCrosshair(T0 + 600));
    act(() => a.emitirCrosshair(null));

    expect(visto).toEqual([
      ['a', T0 + 600],
      ['a', null],
    ]);
  });

  it('`crosshair: false` cala o canal', () => {
    const a = motorFalso(300);
    const visto: unknown[] = [];
    const { result } = renderHook(() =>
      useChartSync({ crosshair: false, onCrosshair: (id, t) => visto.push([id, t]) }),
    );
    act(() => result.current.register('a', a.engine));
    act(() => a.emitirCrosshair(T0));
    expect(visto).toHaveLength(0);
  });

  it('sair do grupo remove os ouvintes do motor', () => {
    const a = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    let sair = (): void => {};
    act(() => {
      sair = result.current.register('a', a.engine);
    });
    expect(a.ouvintes()).toBe(2);

    act(() => sair());
    expect(a.ouvintes()).toBe(0);
    expect(result.current.count()).toBe(0);
  });

  /**
   * ⚠️ Registrar sob a MESMA chave substitui: o motor antigo tem de ser desligado, senão os
   * ouvintes dele continuariam vivos apontando para um gráfico que a interface já trocou.
   */
  it('registrar sob a mesma chave desliga o motor anterior', () => {
    const velho = motorFalso(300);
    const novo = motorFalso(300);
    const { result } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('slot', velho.engine);
      result.current.register('slot', novo.engine);
    });
    expect(velho.ouvintes()).toBe(0);
    expect(novo.ouvintes()).toBe(2);
    expect(result.current.count()).toBe(1);
  });

  it('motor nulo ou descartado é ignorado sem lançar', () => {
    const { result } = renderHook(() => useChartSync());
    act(() => {
      const sair = result.current.register('x', null);
      expect(() => sair()).not.toThrow();
    });
    expect(result.current.count()).toBe(0);
  });

  it('desmontar o dono do grupo desliga todos', () => {
    const a = motorFalso(300);
    const b = motorFalso(300);
    const { result, unmount } = renderHook(() => useChartSync());
    act(() => {
      result.current.register('a', a.engine);
      result.current.register('b', b.engine);
    });
    unmount();
    expect(a.ouvintes()).toBe(0);
    expect(b.ouvintes()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SymbolTabs
// ═════════════════════════════════════════════════════════════════════════════

const ABAS = [
  { id: 'WIN', label: 'WINV26', hint: 'M5' },
  { id: 'WDO', label: 'WDOV26', hint: 'M5' },
  { id: 'PETR', label: 'PETR4', hint: 'D1' },
];

describe('SymbolTabs — navegação, não escolha', () => {
  it('usa o padrão de abas (tablist/tab), não radiogroup', () => {
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={() => {}} />);
    const lista = screen.getByRole('tablist', { name: 'Ativos' });
    expect(within(lista).getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('a aba corrente está selecionada e é a única focável', () => {
    render(<SymbolTabs tabs={ABAS} value="WDO" onChange={() => {}} />);
    const abas = screen.getAllByRole('tab');
    expect(abas[1]!.getAttribute('aria-selected')).toBe('true');
    // ⭐ Tab stop único: sem isso o operador tabularia por todas as abas antes do gráfico.
    expect(abas.map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('clicar troca de aba', () => {
    const onChange = vi.fn();
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /PETR4/ }));
    expect(onChange).toHaveBeenCalledWith('PETR');
  });

  it('setas andam e CIRCULAM; Home/End vão às pontas', () => {
    const onChange = vi.fn();
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={onChange} />);
    const primeira = screen.getAllByRole('tab')[0]!;

    fireEvent.keyDown(primeira, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('WDO');

    // Circula à esquerda a partir da primeira: vai para a última.
    fireEvent.keyDown(primeira, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('PETR');

    fireEvent.keyDown(primeira, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('PETR');
    fireEvent.keyDown(primeira, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('WIN');
  });

  it('sem `onClose` não há botão de fechar', () => {
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /Fechar/ })).toBeNull();
  });

  /**
   * ⚠️ Fechar NÃO pode trocar de aba antes de fechar — é o `stopPropagation`. Sem ele, o
   * clique no ✕ borbulharia para a aba e o operador veria a aba ativar e desaparecer.
   */
  it('fechar não dispara a troca de aba', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={onChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar PETR4' }));
    expect(onClose).toHaveBeenCalledWith('PETR');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fechar responde ao teclado, também sem trocar de aba', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={onChange} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Fechar WDOV26' }), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledWith('WDO');
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ `closable: false` existe para a ÚLTIMA aba: barra de abas vazia deixa a tela sem
   * gráfico e sem caminho de volta.
   */
  it('`closable: false` esconde o ✕ daquela aba', () => {
    render(
      <SymbolTabs
        tabs={[{ id: 'WIN', label: 'WINV26', closable: false }, ABAS[1]!]}
        value="WIN"
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Fechar WINV26' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fechar WDOV26' })).toBeDefined();
  });

  it('`onAdd` acrescenta o botão de adicionar, com nome acessível', () => {
    const onAdd = vi.fn();
    render(<SymbolTabs tabs={ABAS} value="WIN" onChange={() => {}} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ativo' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('valor que não existe nas abas não deixa a barra sem tab stop', () => {
    render(<SymbolTabs tabs={ABAS} value="FANTASMA" onChange={() => {}} />);
    const focaveis = screen.getAllByRole('tab').filter((a) => a.getAttribute('tabindex') === '0');
    // ⚠️ Zero tab stops tornaria a barra inalcançável por teclado; a primeira aba assume.
    expect(focaveis).toHaveLength(1);
  });

  it('lista vazia não lança', () => {
    expect(() => render(<SymbolTabs tabs={[]} value="" onChange={() => {}} />)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChartGrid
// ═════════════════════════════════════════════════════════════════════════════

describe('ChartGrid — o arranjo, e a ALTURA que costuma sumir', () => {
  it('`chartGridSlots` diz quantas células cada arranjo tem', () => {
    expect(chartGridSlots('1')).toBe(1);
    expect(chartGridSlots('2-horizontal')).toBe(2);
    expect(chartGridSlots('2-vertical')).toBe(2);
    expect(chartGridSlots('3-horizontal')).toBe(3);
    expect(chartGridSlots('4')).toBe(4);
  });

  it('lado a lado usa duas COLUNAS; empilhado, duas LINHAS', () => {
    const { container: h } = render(
      <ChartGrid layout="2-horizontal">
        <div />
        <div />
      </ChartGrid>,
    );
    const gradeH = h.firstElementChild as HTMLElement;
    expect(gradeH.style.gridTemplateColumns).toBe('1fr 1fr');
    expect(gradeH.style.gridTemplateRows).toBe('1fr');

    cleanup();

    const { container: v } = render(
      <ChartGrid layout="2-vertical">
        <div />
        <div />
      </ChartGrid>,
    );
    const gradeV = v.firstElementChild as HTMLElement;
    expect(gradeV.style.gridTemplateColumns).toBe('1fr');
    expect(gradeV.style.gridTemplateRows).toBe('1fr 1fr');
  });

  /**
   * ⭐ A parte que erra não é o `grid-template`, é a ALTURA. O motor mede o container e
   * desenha NADA se a altura for zero — sem erro, sem aviso. `height: 100%` mais os dois
   * `minSize: 0` são o que faz a grade ocupar o espaço dado e poder encolher dentro de um
   * pai flex, em vez de estourá-lo.
   */
  it('a grade ocupa a altura dada e PODE encolher', () => {
    const { container } = render(
      <ChartGrid layout="4">
        <div />
      </ChartGrid>,
    );
    const grade = container.firstElementChild as HTMLElement;
    expect(grade.style.height).toBe('100%');
    // ⚠️ jsdom devolve `'0'` (sem unidade) para `minHeight: 0`, e o navegador devolve
    // `'0px'`. A asserção aceita os dois: medir a formatação do ambiente em vez da
    // propriedade seria um teste sobre o jsdom, não sobre o componente.
    expect(['0', '0px']).toContain(grade.style.minHeight);
    expect(['0', '0px']).toContain(grade.style.minWidth);
  });

  it('renderiza os filhos na ordem, e não recorta o excesso', () => {
    const { container } = render(
      <ChartGrid layout="2-horizontal">
        <div data-testid="a" />
        <div data-testid="b" />
        <div data-testid="c" />
      </ChartGrid>,
    );
    // ⚠️ Três filhos num arranjo de dois: o terceiro CONTINUA na tela. Esconder conteúdo
    // que o consumidor pediu seria pior — e o excesso visível denuncia o erro na hora.
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(3);
  });

  it('tem rótulo de região, sobrescrevível', () => {
    render(
      <ChartGrid layout="1" ariaLabel="Correlação WIN/WDO">
        <div />
      </ChartGrid>,
    );
    expect(screen.getByRole('group', { name: 'Correlação WIN/WDO' })).toBeDefined();
  });
});
