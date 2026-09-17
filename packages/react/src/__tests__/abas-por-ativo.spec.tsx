/**
 * `useSymbolWorkspace` — abas por ativo, cada uma com o seu documento.
 *
 * ⭐⭐ O que estes testes travam é a ORDEM (capturar → gravar na que sai → ativar → aplicar) e
 * a CONSEQUÊNCIA dela: ir e voltar entre duas abas devolve o desenho de cada uma. Um dos
 * casos reconstrói o mundo pré-hook (a tela troca sem gravar) e mostra o operador perdendo o
 * trabalho — sem esse caso o resto seria só "o estado muda".
 *
 * ⚠️ Não há motor aqui. O hook não toca no motor de propósito (aplicar é do consumidor), e um
 * motor real em jsdom mede 0 px e não desenharia nada. O que se mede é a SEQUÊNCIA de
 * chamadas de `capturar`/`aplicar` e o conteúdo das abas.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSymbolWorkspace } from '../useSymbolWorkspace.js';
import {
  criarAbas,
  serializeChartState,
  desserializarAbas,
  MAX_ABAS,
  type ChartState,
  type AbaDeAtivo,
  type EstadoDeAbas,
} from '@robustus/charts-engine';

const T0 = 1_700_000_000;

/** Documento com um desenho num preço identificável — é como se prova qual aba voltou. */
function doc(simbolo: string, preco: number): ChartState {
  return serializeChartState({
    symbol: simbolo,
    priceSeriesType: 'Candlestick',
    indicators: [{ id: 'ema20', name: 'ema', params: { period: 20 } }],
    alerts: [{ key: 'a1', condition: { kind: 'CROSS_ABOVE', level: preco } }],
    drawings: {
      version: 1,
      drawings: [{ id: 'd1', kind: 'HORIZONTAL_LINE', anchors: [{ time: T0, price: preco }] }],
    },
  });
}

/**
 * Um "gráfico" de mentira, com estado vivo mutável — é o papel que o playground cumpre.
 * `capturar` fotografa o que está na tela; `aplicar` põe na tela o que veio da aba.
 */
function telaFalsa(inicial: ChartState | null = null): {
  readonly capturar: () => ChartState | null;
  readonly aplicar: (d: ChartState | null, aba: AbaDeAtivo) => void;
  readonly desenhar: (simbolo: string, preco: number) => void;
  readonly naTela: () => ChartState | null;
  readonly aplicacoes: { readonly documento: ChartState | null; readonly aba: AbaDeAtivo }[];
  readonly ordem: string[];
} {
  let vivo = inicial;
  const aplicacoes: { documento: ChartState | null; aba: AbaDeAtivo }[] = [];
  const ordem: string[] = [];
  return {
    capturar: () => {
      ordem.push(`capturar:${vivo?.symbol ?? '—'}`);
      return vivo;
    },
    aplicar: (d, aba) => {
      ordem.push(`aplicar:${aba.symbol}`);
      aplicacoes.push({ documento: d, aba });
      // ⚠️ `null` = "não sei": a tela FICA como está. Limpar aqui apagaria o trabalho.
      if (d !== null) vivo = d;
    },
    desenhar: (simbolo, preco) => {
      vivo = doc(simbolo, preco);
    },
    naTela: () => vivo,
    aplicacoes,
    ordem,
  };
}

function nivelDe(d: ChartState | null | undefined): number | undefined {
  const c = d?.alerts[0]?.condition as { level?: number } | undefined;
  return c?.level;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('montagem', () => {
  it('nasce com a aba inicial ativa', () => {
    const tela = telaFalsa();
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    expect(result.current.abas).toHaveLength(1);
    expect(result.current.aba.symbol).toBe('WIN');
    expect(result.current.recusa).toBeNull();
    // Montar não aplica nada: o consumidor já está mostrando o que quer.
    expect(tela.aplicacoes).toHaveLength(0);
  });

  it('⚠️ coleção degenerada (sem abas) cai para uma aba de partida', () => {
    const tela = telaFalsa();
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: { abas: [], ativa: '' } as EstadoDeAbas,
        capturar: tela.capturar,
        aplicar: tela.aplicar,
      }),
    );
    expect(result.current.abas).toHaveLength(1);
    // A invariante que o resto do módulo assume não pode nascer violada.
    expect(result.current.aba).toBeDefined();
  });

  it('aceita fábrica para o estado inicial, e a chama UMA vez', () => {
    const tela = telaFalsa();
    const fabrica = vi.fn(() => criarAbas({ symbol: 'WDO', periodSeconds: 300 }, T0));
    const { result, rerender } = renderHook(() =>
      useSymbolWorkspace({ estadoInicial: fabrica, capturar: tela.capturar, aplicar: tela.aplicar }),
    );
    rerender();
    rerender();
    expect(fabrica).toHaveBeenCalledTimes(1);
    expect(result.current.aba.symbol).toBe('WDO');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ a ordem da troca', () => {
  it('captura ANTES de aplicar, e aplica a aba de destino', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );

    act(() => result.current.abrir('PETR4', 300));

    // ⭐ A sequência: capturar (o WIN) e só então aplicar (o PETR4). Invertida, o documento
    // gravado na aba do WIN seria o do PETR4.
    const iCapturar = tela.ordem.indexOf('capturar:WIN');
    const iAplicar = tela.ordem.indexOf('aplicar:PETR4');
    expect(iCapturar, 'o teste não capturou nada — bancada vazia').toBeGreaterThanOrEqual(0);
    expect(iAplicar, 'o teste não aplicou nada — bancada vazia').toBeGreaterThanOrEqual(0);
    expect(iCapturar).toBeLessThan(iAplicar);
  });

  it('⭐⭐ ir e voltar devolve o desenho de CADA aba', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );

    // Vai para o PETR4 e marca um suporte lá.
    act(() => result.current.abrir('PETR4', 300));
    act(() => tela.desenhar('PETR4', 32));

    // Volta para o WIN: o que aparece é o nível do WIN.
    act(() => result.current.trocar('aba-1'));
    expect(nivelDe(tela.naTela())).toBe(130_000);

    // E indo de novo ao PETR4, o suporte dele está lá.
    act(() => result.current.trocar('aba-2'));
    expect(nivelDe(tela.naTela())).toBe(32);
  });

  it('⭐⭐ GUARDA: sem gravar na aba que sai, o trabalho do operador desaparece', () => {
    // O mundo pré-hook, reconstruído: a tela troca de ativo e ninguém guarda nada.
    const tela = telaFalsa(doc('WIN', 130_000));
    let simboloNaTela = 'WIN';
    const trocarSemGravar = (simbolo: string): void => {
      simboloNaTela = simbolo;
      // Nada é guardado, e nada é restaurado: a tela fica com o que já estava.
    };
    trocarSemGravar('PETR4');
    tela.desenhar('PETR4', 32);
    trocarSemGravar('WIN');
    expect(simboloNaTela).toBe('WIN');
    // ⭐ O ESTRAGO: no gráfico do WIN está o nível de 32 — uma marcação sobre OUTRO mercado.
    expect(nivelDe(tela.naTela())).toBe(32);

    // Com o hook, o mesmo roteiro devolve 130.000.
    const tela2 = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela2.capturar,
        aplicar: tela2.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.abrir('PETR4', 300));
    act(() => tela2.desenhar('PETR4', 32));
    act(() => result.current.trocar('aba-1'));
    expect(nivelDe(tela2.naTela())).toBe(130_000);
  });

  it('⭐ aba nova herda os INDICADORES e não as marcações', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.abrir('PETR4', 300));
    const aplicado = tela.aplicacoes[0]?.documento;
    expect(aplicado?.indicators.map((i) => i.name)).toEqual(['ema']);
    expect(aplicado?.alerts).toEqual([]);
    expect(aplicado?.drawings['drawings']).toEqual([]);
  });

  it('trocar para a aba já ativa não captura nem aplica', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.trocar('aba-1'));
    expect(tela.aplicacoes).toHaveLength(0);
  });

  it('abrir a combinação que já está na tela não aplica nada', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.abrir('win', 300));
    expect(tela.aplicacoes).toHaveLength(0);
    expect(result.current.abas).toHaveLength(1);
  });

  it('⚠️ `capturar` devolvendo null não apaga o documento da aba', () => {
    const tela = telaFalsa(null); // motor não montado: nada a capturar
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.abrir('PETR4', 300));
    act(() => result.current.trocar('aba-1'));
    expect(nivelDe(result.current.abas[0]?.documento)).toBe(130_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('fechar', () => {
  function comTres(): {
    readonly result: { current: ReturnType<typeof useSymbolWorkspace> };
    readonly tela: ReturnType<typeof telaFalsa>;
  } {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.abrir('PETR4', 300));
    act(() => result.current.abrir('VALE3', 300));
    return { result, tela };
  }

  it('fechar a ATIVA aplica o documento da eleita', () => {
    const { result, tela } = comTres();
    const antes = tela.aplicacoes.length;
    act(() => result.current.fechar('aba-3'));
    expect(result.current.aba.symbol).toBe('PETR4');
    expect(tela.aplicacoes.length).toBe(antes + 1);
    expect(tela.aplicacoes[tela.aplicacoes.length - 1]?.aba.symbol).toBe('PETR4');
  });

  it('⭐ fechar aba de FUNDO não aplica nada (a tela não mudou)', () => {
    const { result, tela } = comTres();
    const antes = tela.aplicacoes.length;
    act(() => result.current.fechar('aba-1'));
    expect(result.current.aba.symbol).toBe('VALE3');
    expect(tela.aplicacoes.length).toBe(antes);
  });

  it('⚠️ a última aba não fecha, e a recusa é DITA', () => {
    const tela = telaFalsa();
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.fechar('aba-1'));
    expect(result.current.abas).toHaveLength(1);
    expect(result.current.recusa).toMatch(/última/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('editar e persistir', () => {
  it('mudar período preserva a identidade e o documento da aba', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        onChange,
        agora: () => T0,
      }),
    );
    act(() => result.current.mudarPeriodo(86_400));
    expect(result.current.aba.id).toBe('aba-1');
    expect(result.current.aba.periodSeconds).toBe(86_400);
    expect(nivelDe(result.current.aba.documento)).toBe(130_000);
    expect(onChange).toHaveBeenCalled();
  });

  it('⭐ duplicar + mudar período dá o MESMO ativo em dois períodos', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.duplicar());
    act(() => result.current.mudarPeriodo(86_400));
    expect(result.current.abas).toHaveLength(2);
    expect(result.current.abas.map((a) => a.periodSeconds)).toEqual([300, 86_400]);
    expect(result.current.abas.every((a) => a.symbol === 'WIN')).toBe(true);
    // ⭐ A cópia levou as marcações: é o MESMO instrumento, os preços valem.
    expect(nivelDe(result.current.aba.documento)).toBe(130_000);
  });

  it('mudar símbolo troca o ativo e mantém o setup da aba', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc('WIN', 130_000) }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.mudarSimbolo('wdo'));
    expect(result.current.aba.symbol).toBe('WDO');
    expect(result.current.aba.id).toBe('aba-1');
  });

  it('`onChange` NÃO é chamado quando nada muda', () => {
    const tela = telaFalsa();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        onChange,
        agora: () => T0,
      }),
    );
    act(() => result.current.mudarPeriodo(300)); // já é 300
    act(() => result.current.trocar('aba-9')); // não existe
    expect(onChange).not.toHaveBeenCalled();
  });

  it('⭐ `paraGravar` captura a aba ATIVA — sem isso persistiria documento velho', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    // O operador desenhou e NUNCA trocou de aba: a aba ainda não tem documento.
    expect(result.current.aba.documento).toBeNull();

    let gravado: ReturnType<typeof result.current.paraGravar> | null = null;
    act(() => {
      gravado = result.current.paraGravar();
    });
    // ⭐ O documento da ativa entrou na gravação.
    const lido = desserializarAbas(JSON.parse(JSON.stringify(gravado)));
    expect(nivelDe(lido.estado?.abas[0]?.documento)).toBe(130_000);
    // E o estado em memória também ficou em dia.
    expect(nivelDe(result.current.aba.documento)).toBe(130_000);
  });

  it('`gravarAtual` guarda o estado vivo na aba ativa', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    act(() => result.current.gravarAtual());
    expect(nivelDe(result.current.aba.documento)).toBe(130_000);
  });

  it(`o teto de ${MAX_ABAS} abas é recusado com motivo legível`, () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result } = renderHook(() =>
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'A0', periodSeconds: 300 }, T0),
        capturar: tela.capturar,
        aplicar: tela.aplicar,
        agora: () => T0,
      }),
    );
    for (let i = 1; i < MAX_ABAS; i += 1) {
      act(() => result.current.abrir(`A${i}`, 300));
    }
    expect(result.current.abas).toHaveLength(MAX_ABAS);
    act(() => result.current.abrir('EXTRA', 300));
    expect(result.current.abas).toHaveLength(MAX_ABAS);
    expect(result.current.recusa).toMatch(/limite/i);
  });

  it('⚠️ callback recriado a cada render não reexecuta nada (a lição do laço do useAlerts)', () => {
    const tela = telaFalsa(doc('WIN', 130_000));
    const { result, rerender } = renderHook(() =>
      // `capturar`/`aplicar` LITERAIS, identidade nova a cada render — é o padrão em JSX.
      useSymbolWorkspace({
        estadoInicial: criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0),
        capturar: () => tela.capturar(),
        aplicar: (d, a) => tela.aplicar(d, a),
        agora: () => T0,
      }),
    );
    for (let i = 0; i < 5; i += 1) rerender();
    // Nenhuma captura, nenhuma aplicação: render não é evento.
    expect(tela.ordem).toEqual([]);
    act(() => result.current.abrir('PETR4', 300));
    expect(tela.aplicacoes).toHaveLength(1);
  });
});
