/**
 * useAlerts + SERIES_CROSS — a costura do cruzamento de DUAS séries no React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO MEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor de alerta já prova o cruzamento (ver `alerts/__tests__/series-cross.spec.ts`).
 * Aqui a pergunta é outra: **a segunda série chega até ele com a barra CERTA?**
 *
 * ⚠️ O casamento é por TEMPO, nunca por índice, e essa é a decisão que este arquivo
 * trava. Indicador descarta o aquecimento, então a saída dele tem menos pontos que a
 * série de barras: `refs[i]` seria o valor de OUTRA barra. É o mesmo mecanismo do
 * defeito que deslocava indicador no eixo do gráfico — aqui ele produziria alerta
 * disparando na barra errada, ou pior, cruzamento que nunca existiu.
 *
 * E a segunda pergunta: barra SEM referência (aquecimento) não pode gerar disparo
 * fantasma quando a referência aparece.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAlerts, type AlertBar } from '../useAlerts.js';
import type { StoreFireEvent } from '@robustus/charts-alerts';

const T0 = 1_700_000_000;

function barras(closes: readonly number[]): AlertBar[] {
  return closes.map((close, i) => ({ time: T0 + i * 60, close, high: close + 1, low: close - 1 }));
}

/** Mapa tempo -> referência, do jeito que o consumidor monta da saída do indicador. */
function refs(pares: ReadonlyArray<readonly [number, number]>): Map<number, number> {
  return new Map(pares.map(([i, v]) => [T0 + i * 60, v]));
}

const CRUZA_ACIMA = {
  key: 'cruz',
  condition: { kind: 'SERIES_CROSS', direction: 'above' } as const,
  options: { mode: 'recurring' as const },
};

describe('useAlerts — references casadas por TEMPO', () => {
  it('⭐ dispara na barra do cruzamento, com a referência da MESMA barra', () => {
    const disparos: StoreFireEvent[] = [];
    const bars = barras([100, 104, 109, 116, 120]);
    // A lenta sobe devagar; a rápida a ultrapassa na barra de índice 3.
    const referencias = refs([
      [0, 110],
      [1, 111],
      [2, 112],
      [3, 113],
      [4, 114],
    ]);

    renderHook(() =>
      useAlerts({
        bars,
        references: referencias,
        alerts: [CRUZA_ACIMA],
        onFire: (e) => disparos.push(e),
      }),
    );

    expect(disparos).toHaveLength(1);
    expect(disparos[0]?.sample?.time).toBe(T0 + 3 * 60);
    expect(disparos[0]?.sample?.reference).toBe(113);
  });

  /**
   * ⭐ O CASO QUE PEGA O CASAMENTO POR ÍNDICE.
   *
   * A referência só existe a partir da 3ª barra (o indicador aqueceu em 3). Se o
   * casamento fosse posicional, a barra 0 receberia a referência da barra 2, e a
   * série de spreads sairia deslocada — aqui isso produziria um cruzamento na barra
   * errada. Com casamento por tempo, as duas primeiras barras vão SEM referência e
   * nada dispara antes do cruzamento real.
   */
  it('referência que começa tarde (aquecimento) não desloca o cruzamento', () => {
    const disparos: StoreFireEvent[] = [];
    const bars = barras([120, 121, 90, 130]);
    // Só as barras 2 e 3 têm referência.
    const referencias = refs([
      [2, 100],
      [3, 100],
    ]);

    renderHook(() =>
      useAlerts({
        bars,
        references: referencias,
        alerts: [CRUZA_ACIMA],
        onFire: (e) => disparos.push(e),
      }),
    );

    // Único cruzamento possível: barra 2 (90, abaixo de 100) -> barra 3 (130, acima).
    expect(disparos).toHaveLength(1);
    expect(disparos[0]?.sample?.time).toBe(T0 + 3 * 60);
  });

  /**
   * ⚠️ Sem este comportamento haveria disparo FANTASMA na barra em que o indicador
   * termina de aquecer: a rápida nasce ACIMA da lenta e nunca cruza, mas um motor que
   * inventasse lado anterior leria isso como cruzamento.
   */
  it('rápida que nasce acima da lenta após o aquecimento NÃO dispara', () => {
    const disparos: StoreFireEvent[] = [];
    renderHook(() =>
      useAlerts({
        bars: barras([120, 121, 122, 123]),
        references: refs([
          [2, 110],
          [3, 111],
        ]),
        alerts: [CRUZA_ACIMA],
        onFire: (e) => disparos.push(e),
      }),
    );
    expect(disparos).toHaveLength(0);
  });

  it('sem `references` o SERIES_CROSS simplesmente não avalia — e não lança', () => {
    const disparos: StoreFireEvent[] = [];
    expect(() => {
      renderHook(() =>
        useAlerts({
          bars: barras([100, 120, 90, 130]),
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      );
    }).not.toThrow();
    expect(disparos).toHaveLength(0);
  });

  /**
   * ⭐ Barra NOVA usa a referência NOVA.
   *
   * `references` vive num ref escrito durante o render, e não na dependência do
   * efeito. Se fosse lido de um closure velho, a barra nova seria avaliada contra a
   * referência da barra anterior — e o cruzamento sairia uma barra atrasado ou não
   * sairia.
   */
  it('barra nova é avaliada contra a referência nova', () => {
    const disparos: StoreFireEvent[] = [];
    const { rerender } = renderHook(
      (props: { bars: AlertBar[]; references: Map<number, number> }) =>
        useAlerts({
          bars: props.bars,
          references: props.references,
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      {
        initialProps: {
          bars: barras([100, 101]),
          references: refs([
            [0, 110],
            [1, 110],
          ]),
        },
      },
    );
    expect(disparos).toHaveLength(0);

    // Chega a barra 2, que cruza — e a referência dela vem no mapa NOVO.
    act(() => {
      rerender({
        bars: barras([100, 101, 120]),
        references: refs([
          [0, 110],
          [1, 110],
          [2, 110],
        ]),
      });
    });

    expect(disparos).toHaveLength(1);
    expect(disparos[0]?.sample?.time).toBe(T0 + 2 * 60);
  });

  /**
   * ⚠️ Barra já alimentada NAO e reprocessada. Re-alimentar reavaliaria cruzamentos
   * antigos e produziria disparo repetido — o motivo do corte por sufixo em
   * `fedCountRef`.
   */
  it('re-render sem barra nova não redispara', () => {
    const disparos: StoreFireEvent[] = [];
    const bars = barras([100, 120]);
    const referencias = refs([
      [0, 110],
      [1, 110],
    ]);
    const { rerender } = renderHook(() =>
      useAlerts({ bars, references: referencias, alerts: [CRUZA_ACIMA], onFire: (e) => disparos.push(e) }),
    );
    expect(disparos).toHaveLength(1);

    act(() => rerender());
    act(() => rerender());
    expect(disparos).toHaveLength(1);
  });

  it('`sampleOf` próprio recebe a referência já casada', () => {
    const vistos: Array<number | undefined> = [];
    renderHook(() =>
      useAlerts({
        bars: barras([100, 120]),
        references: refs([
          [0, 55],
          [1, 66],
        ]),
        // Fonte própria para `value` (ex.: uma média rápida), referência de graça.
        sampleOf: (bar, ref) => {
          vistos.push(ref);
          return { time: bar.time, value: bar.close, reference: ref };
        },
        alerts: [CRUZA_ACIMA],
      }),
    );
    expect(vistos).toEqual([55, 66]);
  });
});

/**
 * ⭐ O reinício é decidido por CONTEÚDO, não por identidade de array.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTES CASOS TRAVAM — ELE TRAVAVA O PROCESSO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O hook decidia "trocou de ativo" comparando a IDENTIDADE do array de barras. Um
 * `bars={[...]}` literal em JSX — a forma mais natural de escrever — tem identidade
 * nova a cada render. Consequência em cadeia:
 *
 *  1. identidade diferente ⇒ "trocou de ativo" ⇒ re-arma tudo e zera o contador;
 *  2. contador zerado ⇒ **re-alimenta a série inteira** ⇒ disparos repetidos;
 *  3. o `setState` do fim do efeito causa outro render, com outro array literal ⇒
 *     volta ao passo 1. **Laço infinito**, medido travando a suíte de teste.
 *
 * Agora a decisão é o tempo da primeira barra e o da última já vista. Ativo novo
 * muda a primeira; correção de histórico muda a última; render a mais não muda
 * nada.
 */
describe('⭐ useAlerts — identidade de array não é troca de ativo', () => {
  it('array literal novo a cada render NÃO re-alimenta nem entra em laço', () => {
    const disparos: StoreFireEvent[] = [];
    // ⚠️ `barras(...)` DENTRO do callback: array novo a cada render, de propósito.
    const { rerender } = renderHook(() =>
      useAlerts({
        bars: barras([100, 120]),
        references: refs([
          [0, 110],
          [1, 110],
        ]),
        alerts: [CRUZA_ACIMA],
        onFire: (e) => disparos.push(e),
      }),
    );

    expect(disparos).toHaveLength(1);
    act(() => rerender());
    act(() => rerender());
    act(() => rerender());
    // Um cruzamento, um disparo — independente de quantos renders houve.
    expect(disparos).toHaveLength(1);
  });

  it('barra nova continua sendo alimentada mesmo com array literal', () => {
    const disparos: StoreFireEvent[] = [];
    const { rerender } = renderHook(
      (props: { closes: number[] }) =>
        useAlerts({
          bars: barras(props.closes),
          references: new Map(props.closes.map((_, i) => [T0 + i * 60, 110])),
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      { initialProps: { closes: [100, 101] } },
    );
    expect(disparos).toHaveLength(0);

    act(() => rerender({ closes: [100, 101, 120] }));
    expect(disparos).toHaveLength(1);
  });

  /**
   * Troca de ATIVO: a primeira barra passa a ter outro tempo. Aí o reinício é
   * necessário — a transição entre séries diferentes não é cruzamento, e o estado
   * antigo não descreve o ativo novo.
   */
  it('primeira barra com outro tempo reinicia e re-arma', () => {
    const disparos: StoreFireEvent[] = [];
    const { rerender } = renderHook(
      (props: { bars: AlertBar[]; references: Map<number, number> }) =>
        useAlerts({
          bars: props.bars,
          references: props.references,
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      {
        initialProps: {
          bars: barras([100, 120]),
          references: refs([
            [0, 110],
            [1, 110],
          ]),
        },
      },
    );
    expect(disparos).toHaveLength(1);

    // Outro ativo: mesma forma, tempos deslocados em uma hora.
    const outro: AlertBar[] = [100, 120].map((close, i) => ({
      time: T0 + 3600 + i * 60,
      close,
      high: close + 1,
      low: close - 1,
    }));
    act(() =>
      rerender({
        bars: outro,
        references: new Map(outro.map((b) => [b.time, 110])),
      }),
    );

    // Alimentou a série nova do zero e detectou o cruzamento dela.
    expect(disparos).toHaveLength(2);
    expect(disparos[1]?.sample?.time).toBe(T0 + 3600 + 60);
  });

  /**
   * ⚠️ Correção de histórico: a barra JÁ VISTA virou outra (o provedor reenviou o
   * trecho com valores diferentes). O prefixo alimentado não descreve mais o dado,
   * então reiniciar é o certo — continuar avaliaria cruzamentos contra um passado que
   * não existe mais.
   */
  it('barra já alimentada que virou outra reinicia a alimentação', () => {
    const disparos: StoreFireEvent[] = [];
    const { rerender } = renderHook(
      (props: { bars: AlertBar[] }) =>
        useAlerts({
          bars: props.bars,
          references: new Map(props.bars.map((b) => [b.time, 110])),
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      { initialProps: { bars: barras([100, 101]) } },
    );
    expect(disparos).toHaveLength(0);

    // Mesmo comprimento, mas a ÚLTIMA barra alimentada agora tem outro tempo.
    const corrigido: AlertBar[] = [
      { time: T0, close: 100, high: 101, low: 99 },
      { time: T0 + 120, close: 120, high: 121, low: 119 },
    ];
    act(() => rerender({ bars: corrigido }));

    expect(disparos).toHaveLength(1);
    expect(disparos[0]?.sample?.time).toBe(T0 + 120);
  });

  it('série que ENCOLHE reinicia sem lançar', () => {
    const disparos: StoreFireEvent[] = [];
    const { rerender } = renderHook(
      (props: { closes: number[] }) =>
        useAlerts({
          bars: barras(props.closes),
          references: new Map(props.closes.map((_, i) => [T0 + i * 60, 110])),
          alerts: [CRUZA_ACIMA],
          onFire: (e) => disparos.push(e),
        }),
      { initialProps: { closes: [100, 120, 121, 122] } },
    );
    expect(disparos).toHaveLength(1);

    expect(() => act(() => rerender({ closes: [100] }))).not.toThrow();
  });
});
