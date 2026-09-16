/**
 * @robustus/charts-replay — controlador de REPLAY DE MERCADO.
 *
 * Reproduz um pregao historico barra a barra, como um video. O consumidor pega
 * a fatia revelada (`revealedBars()`) e alimenta o grafico; o controlador cuida
 * de posicao, play/pause, velocidade, passo manual e busca por tempo.
 *
 * Pacote INDEPENDENTE: nao importa nenhum outro pacote do workspace e nao tem
 * dependencia de terceiro. O tipo de barra (`ReplayBar`) e definido localmente.
 *
 * Dois pontos de entrada:
 *  - `ReplayCore` — o nucleo PURO e deterministico. Avanca por tempo decorrido
 *    (`advanceByElapsed`), sem relogio global. Use-o direto se voce ja tem um
 *    laco de animacao (rAF) e quer chamar o avanco voce mesmo.
 *  - `ReplayController` — wrapper fino que liga o nucleo a um `TimerLike`
 *    INJETADO, para o "play" andar sozinho. Use-o se quer que a biblioteca
 *    cuide do timer.
 */
export {
  ReplayCore,
  ReplayController,
} from './replay-controller.core.js';

export type {
  ReplayBar,
  TimerLike,
  ReplayState,
  ReplayControllerOptions,
} from './replay-controller.core.js';
