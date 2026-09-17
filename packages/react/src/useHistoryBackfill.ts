/**
 * useHistoryBackfill — carregar histórico ANTIGO quando o operador arrasta para trás.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FALTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O gráfico recebia um lote de barras e acabava ali. Arrastar para trás chegava no
 * começo do lote e batia numa parede: nada mais aparecia, e nada dizia que havia mais
 * histórico do outro lado. Carregar tudo de uma vez não é alternativa — um dia de
 * WIN em 1 minuto são ~500 barras, mas seis meses em 1 minuto são ~180 mil, e
 * ninguém quer pagar isso no primeiro quadro para talvez olhar.
 *
 * Este hook fecha o ciclo: observa a janela visível, e quando ela se aproxima da
 * borda esquerda do que existe, PEDE o trecho anterior a quem tem os dados.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ QUEM PRESERVA A POSIÇÃO DA TELA NÃO É ESTE HOOK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * É o motor. `leftLogical` é um ÍNDICE de barra; inserir 500 barras na frente empurra
 * o índice de todas as existentes, e sem compensação a tela saltaria 500 barras no
 * instante em que o histórico chegasse — justamente no momento mais sensível, com o
 * operador olhando um trecho que desapareceria. O `onBarsPrepended` do
 * `chart-core` soma as inseridas ao `leftLogical`, e o motor detecta o prepend por
 * CONTEÚDO (quantos tempos novos são anteriores ao que era o primeiro).
 *
 * Aqui só decidimos QUANDO pedir. O consumidor decide de onde vem o dado — este
 * pacote não conhece `datafeed` nem HTTP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS TRÊS GUARDAS, E O QUE CADA UMA EVITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Um pedido em voo.** O evento de janela dispara a cada quadro de arrasto —
 * dezenas por segundo. Sem a trava, um arrasto de meio segundo abriria trinta
 * requisições do mesmo trecho.
 *
 * **2. Trava de FIM DE HISTÓRICO.** Quando o carregamento devolve zero barras, não há
 * mais passado. Sem a trava, o gráfico parado na borda esquerda pediria para sempre —
 * e o operador que só quer olhar o primeiro dia geraria requisição enquanto a aba
 * estivesse aberta.
 *
 * **3. Teto de falhas consecutivas.** Erro de rede não pode virar martelo. Depois de
 * `MAX_FALHAS` tentativas seguidas sem sucesso, o hook para de pedir até um `reset()`
 * — e reporta o motivo em `error` em vez de engolir.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartEngine } from '@robustus/charts-engine';

/**
 * Barras de margem à esquerda que disparam o pedido.
 *
 * ⚠️ Em BARRAS, não em pixels. É a unidade em que o operador percebe "quanto
 * histórico falta", e a única estável sob zoom: 20 barras são 40 px com espaçamento 2
 * e 400 px com espaçamento 20 — um limiar em pixel dispararia cedo demais afastado e
 * tarde demais aproximado.
 */
const LIMIAR_BARRAS_DEFAULT = 20;

/**
 * Falhas consecutivas antes de desistir.
 *
 * Três porque uma falha isolada é rotina (rede oscila, token renova) e insistir uma ou
 * duas vezes resolve a maioria; três seguidas indicam problema que não vai passar com
 * repetição, e continuar só gera carga.
 */
const MAX_FALHAS = 3;

/** Barra mínima que o hook precisa: só o instante. */
export interface BackfillBar {
  readonly time: number;
}

export interface UseHistoryBackfillParams {
  /** O motor. `null` antes da montagem. */
  readonly engine: ChartEngine | null;
  /**
   * As barras correntes, em ordem crescente de tempo. O hook lê a PRIMEIRA para saber
   * até onde já foi e a contagem para medir a margem restante.
   */
  readonly bars: readonly BackfillBar[];
  /**
   * Carrega o trecho ANTERIOR a `beforeTime` (epoch em segundos, exclusivo) e devolve
   * **quantas barras foram acrescentadas**.
   *
   * ⚠️ O contrato é "quantas", e não `void`, por causa da trava de fim de histórico:
   * `0` é a única resposta que significa "não há mais passado", e sem ela o hook não
   * teria como distinguir "acabou" de "ainda não chegou". Devolver a contagem também
   * evita que o hook precise inspecionar o array depois — o consumidor já sabe.
   *
   * ⚠️ Acrescentar as barras ao estado é do CONSUMIDOR. O hook não muta série nenhuma:
   * quem é dono do dado é quem o guarda, e o motor recebe a série nova pelo caminho
   * normal (`setCandles`), com a viewport preservada pelo `onBarsPrepended`.
   *
   * Pode ser síncrona ou assíncrona. Lançar/rejeitar é tratado: vira `error`, conta
   * como falha, e não trava o fim de histórico.
   */
  readonly loadOlder: (beforeTime: number) => Promise<number> | number;
  /** Margem à esquerda, em barras, que dispara o pedido. Default 20. */
  readonly thresholdBars?: number;
  /**
   * Desliga sem desmontar. Default `true`.
   *
   * Útil durante replay (o dado é sintético e não há passado a buscar) ou quando o
   * consumidor sabe que já carregou tudo.
   */
  readonly enabled?: boolean;
  /**
   * Mudar este valor ZERA as travas (fim de histórico e falhas).
   *
   * ⚠️ Necessário porque trocar de instrumento não pode herdar o "não há mais
   * passado" do anterior — o operador trocaria de ativo e o gráfico nunca mais
   * buscaria histórico, sem nada explicando. Mesma ideia do `resetViewportOn` do
   * `useChartEngine`: um valor que o consumidor muda quando a identidade do dado muda.
   *
   * ⚠️ Não é derivável do próprio `bars`: o tempo da primeira barra muda a cada
   * backfill bem-sucedido (é o objetivo), e o da última muda a cada barra ao vivo —
   * nenhum dos dois distingue "outro ativo" de "mais dado do mesmo".
   */
  readonly resetKey?: unknown;
}

export interface UseHistoryBackfillResult {
  /** Há um carregamento em voo? Para o consumidor mostrar um indicador discreto. */
  readonly loading: boolean;
  /** O histórico acabou (um carregamento devolveu zero)? */
  readonly exhausted: boolean;
  /** Motivo da última falha, ou `null`. Texto para log/aviso, não para o operador. */
  readonly error: string | null;
  /** Zera as travas e permite pedir de novo. */
  readonly reset: () => void;
}

/**
 * Pede histórico antigo quando o operador chega perto da borda esquerda.
 *
 * @example
 * const [velas, setVelas] = useState(lote);
 * const { loading, exhausted } = useHistoryBackfill({
 *   engine,
 *   bars: velas,
 *   resetKey: `${ativo}|${periodo}`,
 *   loadOlder: async (antesDe) => {
 *     const r = await feed.bars.getBars({ instrument, periodSeconds, toSeconds: antesDe, limit: 500 });
 *     if (!r.ok || r.value.length === 0) return 0;
 *     setVelas((atuais) => [...r.value, ...atuais]);
 *     return r.value.length;
 *   },
 * });
 */
export function useHistoryBackfill(params: UseHistoryBackfillParams): UseHistoryBackfillResult {
  const {
    engine,
    bars,
    loadOlder,
    thresholdBars = LIMIAR_BARRAS_DEFAULT,
    enabled = true,
    resetKey,
  } = params;

  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Refs: tudo que o ouvinte de janela precisa LER sem virar dependência ──
  //
  // O ouvinte é registrado uma vez por motor. Se `bars` ou `loadOlder` fossem
  // dependências, cada barra nova o removeria e recriaria — trabalho por tick, e uma
  // janela de tempo em que nenhum ouvinte está registrado.
  const loadOlderRef = useRef(loadOlder);
  loadOlderRef.current = loadOlder;
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const limiarRef = useRef(thresholdBars);
  limiarRef.current = thresholdBars;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /** Pedido em voo — a guarda 1. Em ref, não em estado: precisa ser lido no ato. */
  const emVooRef = useRef(false);
  const esgotadoRef = useRef(false);
  const falhasRef = useRef(0);
  /** Vira `false` no desmonte: resultado que chega depois não pode chamar `setState`. */
  const vivoRef = useRef(true);

  const reset = useCallback(() => {
    esgotadoRef.current = false;
    falhasRef.current = 0;
    setExhausted(false);
    setError(null);
  }, []);

  // Troca de identidade do dado zera as travas (ver `resetKey`).
  useEffect(() => {
    esgotadoRef.current = false;
    falhasRef.current = 0;
    setExhausted(false);
    setError(null);
  }, [resetKey]);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (engine === null || engine.isDisposed) return;

    const ts = engine.api.timeScale();

    const aoMudarJanela = (faixa: { from: number; to: number } | null): void => {
      if (faixa === null) return;
      if (!enabledRef.current || esgotadoRef.current || emVooRef.current) return;
      if (falhasRef.current >= MAX_FALHAS) return;

      const barras = barsRef.current;
      // ⚠️ Sem barras não há `beforeTime`. Pedir "antes de nada" seria pedir tudo, e o
      // primeiro lote é responsabilidade do consumidor, não do backfill.
      if (barras.length === 0) return;

      const primeira = barras[0];
      if (primeira === undefined || !Number.isFinite(primeira.time)) return;

      // ⚠️ A borda esquerda do DADO é o índice 0. `faixa.from` pode ser NEGATIVO
      // (o motor permite rolar para antes da primeira barra, e é o gesto natural de
      // quem quer mais passado), então o teste é "a janela chegou a menos de N barras
      // do índice 0", não "from < N".
      if (faixa.from > limiarRef.current) return;

      emVooRef.current = true;
      if (vivoRef.current) setLoading(true);

      const finalizar = (): void => {
        emVooRef.current = false;
        if (vivoRef.current) setLoading(false);
      };

      const sucesso = (quantas: number): void => {
        falhasRef.current = 0;
        if (quantas <= 0) {
          // Fim do histórico: a trava 2. Sem ela, parado na borda, pediria para sempre.
          esgotadoRef.current = true;
          if (vivoRef.current) setExhausted(true);
        } else if (vivoRef.current) {
          setError(null);
        }
        finalizar();
      };

      const falha = (motivo: unknown): void => {
        falhasRef.current += 1;
        if (vivoRef.current) {
          setError(motivo instanceof Error ? motivo.message : String(motivo));
        }
        finalizar();
      };

      // ⚠️ `loadOlder` pode ser síncrona OU assíncrona, e pode LANÇAR antes de
      // devolver a promessa. O `try` cobre o lançamento síncrono; o `catch` da
      // promessa cobre a rejeição. Sem os dois, uma das formas de falha derrubaria o
      // ouvinte de janela e o backfill morreria em silêncio para o resto da sessão.
      try {
        const r = loadOlderRef.current(primeira.time);
        if (typeof r === 'number') {
          sucesso(r);
        } else {
          void Promise.resolve(r).then(sucesso, falha);
        }
      } catch (e) {
        falha(e);
      }
    };

    ts.subscribeVisibleLogicalRangeChange(aoMudarJanela);
    return () => {
      try {
        ts.unsubscribeVisibleLogicalRangeChange(aoMudarJanela);
      } catch {
        // Motor em descarte: o ouvinte morre com ele.
      }
    };
  }, [engine]);

  return { loading, exhausted, error, reset };
}
