/**
 * @robustus/charts-devtools — ferramental de medicao e teste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NAO E PARA ENTRAR EM APLICACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este pacote existe para MEDIR e para TESTAR as camadas de canvas. Nada aqui
 * deve ser importado por codigo de producao. Ele e `devDependency` de quem
 * desenvolve a biblioteca, nao dependencia de quem a consome.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A camada bookmap **cronometra a si mesma** e degrada o proprio orcamento
 * quando a mediana das passadas recentes passa de 8 ms. Isso e otimo em producao
 * e hostil para medir: a coisa que voce quer medir muda de comportamento porque
 * voce esta medindo.
 *
 * Some-se a isso que `jsdom` **nao implementa contexto 2D** — `getContext('2d')`
 * devolve `null`. Nao ha como pintar pixel no ambiente de teste.
 *
 * A bancada resolve os dois:
 *
 *  - **relogio injetavel.** `relogioParado()` congela o tempo para a degradacao
 *    nao disparar no meio das 100 repeticoes (senao o percentil misturaria dois
 *    orcamentos diferentes e o numero nao significaria nada).
 *    `relogioQueForcaDegradacao()` faz o oposto, para exercitar a degradacao de
 *    forma deterministica.
 *  - **duble de contexto 2D que so CONTA.** `ContextoDeBancada` registra
 *    retangulos, contornos, textos e trocas de estilo, com corpo de metodo o mais
 *    curto possivel — qualquer trabalho ali entraria na medicao como se fosse da
 *    camada.
 *
 * ⚠️ **O QUE O NUMERO DA BANCADA INCLUI:** leitura de janela, agregacao, escala
 * de cor, conversao celula->pixel, laco de emissao e trocas de estado do canvas.
 *
 * ⚠️ **O QUE ELE NAO INCLUI:** rasterizacao, composicao e sincronismo de quadro.
 * **Nao ha pixel.** Um relatorio de bancada tem o campo `ehNavegadorReal`
 * justamente para que ninguem confunda os dois. Numero de bancada nao e FPS.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Dubles de canvas e de ciclo de vida
// ═════════════════════════════════════════════════════════════════════════════
export {
  /** Contexto 2D falso que apenas CONTA operacoes de desenho. */
  ContextoDeBancada,
  /** Alvo de desenho (`CanvasRenderingTarget2D`) sobre o contexto falso. */
  criarAlvoDeBancada,
  /** Parametro de `attached()` falso: grafico, serie e `requestUpdate`. */
  criarParametroDeAnexacao,
  /** Limites em pixel derivados de uma janela visivel. */
  limitesDaJanela,
  /** Relogio congelado — a degradacao nunca dispara. */
  relogioParado,
  /** Relogio que avanca o suficiente para FORCAR degradacao a cada passada. */
  relogioQueForcaDegradacao,
  /** Monta uma camada bookmap pronta para medicao, com relogio injetado. */
  montarCamadaDeBancada,
} from './__bench__/bookmap-bench-canvas.js';

export type {
  /** Limites de vista: largura, altura e faixas. */
  LimitesDaVista,
  /** A camada montada mais os dubles que a cercam. */
  CamadaDeBancada,
  /** Parametros de `montarCamadaDeBancada`. */
  OpcoesDaCamadaDeBancada,
} from './__bench__/bookmap-bench-canvas.js';

// ═════════════════════════════════════════════════════════════════════════════
// Protocolo de medicao
// ═════════════════════════════════════════════════════════════════════════════
//
// Os numeros do protocolo NAO sao arbitrarios: 100 repeticoes com as 10 primeiras
// DESCARTADAS (aquecimento de JIT) e percentil 95 por posto — nao por
// interpolacao, para o valor relatado ser sempre uma amostra que aconteceu de
// verdade, e nao uma media entre duas que nunca aconteceram.
export {
  medir,
  percentilPorPosto,
  relogioDeAltaResolucao,
  valorRetido,
  tamanhoDoCorpoEmBytes,
  emMiB,
  BANCADA_REPETICOES,
  BANCADA_DESCARTADAS,
  BANCADA_CONSIDERADAS,
  BANCADA_QUANTIL,
  BANCADA_VIEWPORT,
} from './__bench__/bookmap-bench-protocolo.js';

export type {
  AlvoDeMedicao,
  OpcoesDeMedicao,
  MedicaoBancada,
} from './__bench__/bookmap-bench-protocolo.js';

// ═════════════════════════════════════════════════════════════════════════════
// Pregao de referencia — os numeros medidos que ancoram os testes
// ═════════════════════════════════════════════════════════════════════════════
//
// ⭐ Estes valores sao MEDICAO de um pregao real (WINV26, 28/08/2026), nao
// invencao de fixture. Sao eles que justificam decisoes de projeto que de outra
// forma pareceriam arbitrarias — em especial a escala de cor por percentil:
//
//   BENCH_FILA_P50 =    481
//   BENCH_FILA_P90 =    714
//   BENCH_FILA_P99 =  1.131
//   BENCH_FILA_MAX = 36.232   ← 32x o p99, e e nivel CRUZADO, nao parede
//
// Normalizar a cor pelo maximo daria ~2% de opacidade ao p90, ou seja apagaria
// da tela quase todo o livro. E por isso que a escala usa p50/p99.
export * from './__bench__/bookmap-bench-referencia.js';
