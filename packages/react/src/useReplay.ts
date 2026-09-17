/**
 * useReplay — liga o REPLAY DE MERCADO ao ciclo do React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE HOOK RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `@robustus/charts-replay` traz o motor puro (`ReplayCore`) e um wrapper com
 * timer INJETADO (`ReplayController`). Nenhum dos dois sabe o que e React nem de
 * onde vem o timer. Este hook e o unico ponto que:
 *
 *  1. injeta o `TimerLike` do ambiente do browser (`setInterval`/`clearInterval`
 *     de `window`) no controlador — o pacote de replay continua sem DOM;
 *  2. traduz cada avanco do replay em estado do React (`position`, `playing`, ...)
 *     para os controles renderizarem;
 *  3. expoe a FATIA REVELADA (`revealedBars`) como o dado a plotar no grafico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O CONTROLADOR VIVE NUMA REF, E O ESTADO ESPELHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `ReplayController` e um objeto vivo com timer; recria-lo a cada render
 * mataria o timer no meio do play. Entao ele mora numa `ref` (criado uma vez por
 * conjunto de barras) e o React so guarda um ESPELHO imutavel do estado
 * (`ReplayState`), atualizado no callback `onAdvance` e apos cada comando. E o
 * mesmo padrao do resto do projeto: a maquina viva de um lado, o instantaneo
 * imutavel do outro.
 *
 * ⚠️ O timer e `window.setInterval`, que devolve `number`; o `clearInterval`
 * recebe esse `number`. O `TimerLike` mantem o handle opaco (`unknown`), entao a
 * ponte aqui so repassa — nunca inspeciona o handle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReplayController,
  type ReplayBar,
  type ReplayState,
  type TimerLike,
} from '@robustus/charts-replay';

/** O que o hook recebe. */
export interface UseReplayParams {
  /**
   * A serie completa a reproduzir.
   *
   * ⭐⭐ O reinicio e decidido por CONTEUDO (quantidade + tempo da primeira e da ultima
   * barra), NAO pela identidade do array. Ver `chaveDaSerie` — e a mesma correcao que o
   * `useAlerts` precisou, e aqui ela virou requisito quando o replay passou a receber dado
   * REAL de provedor.
   */
  readonly bars: readonly ReplayBar[];
  /** Velocidade inicial em barras/segundo. Default 4. */
  readonly speed?: number;
  /**
   * Granularidade do tick do timer, em ms. Default 100 (10 Hz). Nao e a
   * velocidade — ver o pacote de replay.
   */
  readonly tickMs?: number;
  /**
   * Comecar com tudo revelado (`true`) ou do zero (`false`, default). Comecar do
   * zero e o uso classico de "assistir o dia do inicio".
   */
  readonly startAtEnd?: boolean;
}

/** O que o hook devolve: estado + comandos + a fatia a plotar. */
export interface UseReplayResult {
  /** Instantaneo corrente do replay, para renderizar os controles. */
  readonly state: ReplayState;
  /** As barras reveladas ate a posicao corrente — o que o grafico desenha. */
  readonly revealedBars: readonly ReplayBar[];
  /** Da play (liga o avanco automatico). */
  readonly play: () => void;
  /** Pausa. */
  readonly pause: () => void;
  /** Alterna play/pause. */
  readonly toggle: () => void;
  /** Um passo manual (default +1 barra; negativo volta). */
  readonly step: (n?: number) => void;
  /** Vai direto para uma posicao (indice de barra revelada). */
  readonly seek: (position: number) => void;
  /** Muda a velocidade em barras/segundo. */
  readonly setSpeed: (barsPerSecond: number) => void;
}

/**
 * Constroi o `TimerLike` do browser SOB DEMANDA, nunca no topo do modulo.
 *
 * ⚠️ **Nao pode ser uma constante de modulo.** Um `window.setInterval` avaliado
 * no escopo do modulo e executado no INSTANTE do `import` — e no SSR (Next, teste
 * em Node) `window` nao existe ali, entao o simples `import` deste hook derrubaria
 * o servidor com `window is not defined`. Encapsular numa funcao adia o toque em
 * `window` para o efeito, que so roda no cliente.
 *
 * ⚠️ `window.setInterval` num browser devolve `number`; a assinatura do
 * `TimerLike` promete `unknown`, entao o cast e so para satisfazer o contrato
 * generico. O `clearInterval` aceita o `number` de volta sem problema.
 */
function criarBrowserTimer(): TimerLike {
  return {
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (h) => window.clearInterval(h as number),
  };
}

/**
 * Reproduz um pregao barra a barra no ciclo do React.
 *
 * @example
 * const replay = useReplay({ bars: candles, speed: 4 });
 * useChartEngine({ candles: replay.revealedBars });
 * // controles: <button onClick={replay.toggle}>{replay.state.playing ? 'Pausar' : 'Play'}</button>
 */
export function useReplay(params: UseReplayParams): UseReplayResult {
  const { bars, speed = 4, tickMs = 100, startAtEnd = false } = params;

  const controllerRef = useRef<ReplayController | null>(null);
  const [state, setState] = useState<ReplayState>(() => ({
    position: startAtEnd ? bars.length : 0,
    length: bars.length,
    playing: false,
    speed,
    atEnd: startAtEnd ? true : bars.length === 0,
  }));

  // As opcoes iniciais numa ref: nao devem recriar o controlador quando mudam,
  // so uma serie NOVA recria (novo pregao). Sao lidas na construcao.
  const iniciais = useRef({ speed, tickMs, startAtEnd });

  /**
   * ⭐⭐ A identidade da SERIE, por CONTEUDO — e nao a referencia do array.
   *
   * ⚠️ O defeito que isto corrige apareceu quando o replay passou a receber dado REAL: uma
   * fonte de provedor devolve um array NOVO a cada re-render que ela provoca (aqui, cada vez
   * que a bandeira "carregando" vira), com exatamente as mesmas barras dentro. Com a decisao
   * por identidade, o efeito abaixo recriava o `ReplayController`, matava o timer e voltava a
   * posicao a ZERO — o operador via o replay saltar para o inicio do pregao no meio da
   * reproducao, sem nada na tela explicando por que.
   *
   * ⭐ E a MESMA correcao que o `useAlerts` precisou (lá o sintoma foi pior: laco infinito com
   * `bars={[...]}` literal em JSX). A licao virou regra do projeto: dependencia de dado em
   * array e por CONTEUDO.
   *
   * ⚠️ A chave e "quantidade + tempo da primeira + tempo da ultima". Ela nao detecta troca no
   * MEIO da serie mantendo as pontas e o tamanho — e a escolha e deliberada: serie de barras
   * cresce no fim (barra nova) ou no comeco (backfill), e as duas mexem numa das pontas. O
   * alternativo honesto seria somar todos os tempos, o que custaria O(n) a cada render de uma
   * serie de 18 anos para cobrir um caso que a camada de dado nao produz.
   */
  const chaveDaSerie = useMemo(() => {
    if (bars.length === 0) return '0';
    const primeira = bars[0] as ReplayBar;
    const ultima = bars[bars.length - 1] as ReplayBar;
    return `${bars.length}:${primeira.time}:${ultima.time}`;
  }, [bars]);

  // ── Cria o controlador por conjunto de barras; descarta ao trocar/desmontar ──
  //
  // `onAdvance` espelha o estado no React a cada tick que moveu a posicao — e o
  // que faz a fatia revelada crescer na tela durante o play.
  useEffect(() => {
    const { speed: s, tickMs: t, startAtEnd: end } = iniciais.current;
    // O timer e criado AQUI, dentro do efeito (so roda no cliente), nao no topo
    // do modulo — ver `criarBrowserTimer`.
    const controller = new ReplayController(criarBrowserTimer(), {
      bars,
      startPosition: end ? bars.length : 0,
      speed: s,
      tickMs: t,
      onAdvance: (_avancou, snap) => setState(snap),
    });
    controllerRef.current = controller;
    setState(controller.core.snapshot());
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // ⚠️ Depende de `chaveDaSerie` e NAO de `bars` — ver o comentario da chave. O `bars` lido
    // aqui e o do render que criou este efeito, e o conteudo dele casa com a chave por
    // construcao; um array novo com o mesmo conteudo nao reexecuta, o que e exatamente o
    // ponto. (`eslint-disable` seria necessario se a regra de exaustividade estivesse ligada.)
  }, [chaveDaSerie]); // eslint-disable-line react-hooks/exhaustive-deps

  // Espelha o estado apos um comando manual (play/pause/step/seek/setSpeed). O
  // `onAdvance` cobre o avanco automatico; os comandos manuais precisam empurrar
  // o snapshot na mao porque nao passam pelo timer.
  const sincronizar = useCallback(() => {
    const c = controllerRef.current;
    if (c !== null) setState(c.core.snapshot());
  }, []);

  const play = useCallback(() => {
    controllerRef.current?.play();
    sincronizar();
  }, [sincronizar]);

  const pause = useCallback(() => {
    controllerRef.current?.pause();
    sincronizar();
  }, [sincronizar]);

  const toggle = useCallback(() => {
    const c = controllerRef.current;
    if (c === null) return;
    if (c.core.playing) c.pause();
    else c.play();
    sincronizar();
  }, [sincronizar]);

  const step = useCallback(
    (n = 1) => {
      controllerRef.current?.core.step(n);
      sincronizar();
    },
    [sincronizar],
  );

  const seek = useCallback(
    (position: number) => {
      controllerRef.current?.core.seek(position);
      sincronizar();
    },
    [sincronizar],
  );

  const setSpeed = useCallback(
    (barsPerSecond: number) => {
      controllerRef.current?.core.setSpeed(barsPerSecond);
      sincronizar();
    },
    [sincronizar],
  );

  // A fatia revelada e derivada da posicao corrente. Recalcula so quando a
  // posicao ou a serie mudam — nao a cada render.
  const revealedBars = useMemo(
    () => bars.slice(0, state.position),
    [bars, state.position],
  );

  return { state, revealedBars, play, pause, toggle, step, seek, setSpeed };
}
