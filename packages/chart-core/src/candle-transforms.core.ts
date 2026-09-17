/**
 * candle-transforms.core — transformacoes PURAS de serie de velas: Heikin-Ashi e
 * Renko. Funcoes totais e deterministicas, sem DOM, sem relogio, sem sorteio, sem
 * I/O, sem estado de modulo. Todo insumo chega por parametro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO E TRANSFORMACAO DE DADO, E NAO MODO DE DESENHO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Heikin-Ashi e Renko produzem uma NOVA serie de `CandlestickData` — os valores
 * open/high/low/close mudam. O consumidor aplica a transformacao e entrega o
 * resultado a uma serie `Candlestick` comum; o motor desenha vela normal, sem
 * saber que o dado foi derivado. Ja o grafico de BARRAS OHLC nao transforma nada:
 * e a MESMA vela desenhada de outro jeito (tick de abertura a esquerda, de
 * fechamento a direita) — por isso vive como `SeriesType` `'Bar'` no renderer, e
 * NAO aqui.
 *
 * ⚠️ Entrada hostil (NaN, Infinity, o<0 sem sentido) e DESCARTADA barra a barra,
 * nunca lanca — `throw` no ciclo que alimenta desenho derrubaria o grafico
 * inteiro. Barra invalida some da saida; o resto continua.
 */

import type { CandlestickData, Time } from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// Sanidade de vela
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma vela e utilizavel quando os quatro precos e o tempo sao finitos.
 *
 * ⚠️ O teste NAO e `x != null`: na origem esse era o criterio e passava `NaN`,
 * porque `NaN != null` e `true`. Aqui exigimos finitude explicita de cada campo.
 * Nao impomos high>=low nem outras relacoes de ordem: dado de mercado real chega
 * com high/low trocados por erro de feed, e queremos transformar o que veio, nao
 * julgar sua coerencia — a transformacao ainda e deterministica.
 */
function isVelaValida(c: CandlestickData): boolean {
  return (
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Heikin-Ashi
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Converte uma serie de velas em velas Heikin-Ashi ("media do balanco", em
 * japones). Suaviza o ruido de curto prazo mostrando a tendencia com mais clareza
 * que a vela crua.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FORMULA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   haClose = (open + high + low + close) / 4        — media dos quatro precos
 *   haOpen  = (haOpenAnterior + haCloseAnterior) / 2 — media do corpo anterior
 *   haHigh  = max(high, haOpen, haClose)
 *   haLow   = min(low,  haOpen, haClose)
 *
 * A PRIMEIRA barra nao tem anterior, entao `haOpen = (open + close) / 2` — a
 * semente convencional. A partir dai `haOpen` depende recursivamente do proprio
 * historico, e e isso que produz a suavizacao: cada corpo comeca no meio do corpo
 * anterior.
 *
 * ⭐ Por construcao `haHigh >= max(haOpen, haClose)` e `haLow <= min(haOpen,
 * haClose)` — o `max`/`min` incluem os dois. Ha property test que reprova se isso
 * quebrar.
 *
 * O `time` de cada vela HA e o `time` da vela de origem: a transformacao e 1:1 e
 * preserva a linearidade temporal (diferente de Renko).
 *
 * Determinismo: mesma serie de entrada, mesma serie de saida — nao ha estado fora
 * da recursao explicita `haOpenAnterior`/`haCloseAnterior`.
 *
 * Velas invalidas sao descartadas (ver `isVelaValida`); a recursao usa a ULTIMA
 * vela HA valida emitida como "anterior", entao um buraco no meio nao contamina o
 * calculo com NaN.
 */
export function heikinAshi(velas: readonly CandlestickData[]): CandlestickData[] {
  const saida: CandlestickData[] = [];
  let haOpenAnterior = 0;
  let haCloseAnterior = 0;
  let temAnterior = false;

  for (const c of velas) {
    if (!isVelaValida(c)) continue;

    const haClose = (c.open + c.high + c.low + c.close) / 4;
    // Primeira barra valida: semente (open+close)/2. Demais: media do corpo HA
    // anterior.
    const haOpen = temAnterior ? (haOpenAnterior + haCloseAnterior) / 2 : (c.open + c.close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    saida.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose });

    haOpenAnterior = haOpen;
    haCloseAnterior = haClose;
    temAnterior = true;
  }

  return saida;
}

// ═════════════════════════════════════════════════════════════════════════════
// Renko
// ═════════════════════════════════════════════════════════════════════════════

/** Opcoes de `brickSizeAutomatico`. */
export interface BrickSizeOptions {
  /**
   * Multiplo da variacao media de fechamento. Default `1`.
   *
   * `2` produz aproximadamente metade dos tijolos (cada um exige o dobro do movimento
   * tipico); `0.5`, cerca do dobro deles.
   */
  readonly multiplo?: number;
}

/**
 * Tamanho de tijolo automatico, derivado da VARIACAO MEDIA DE FECHAMENTO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ESTA FUNCAO MUDOU DE CRITERIO — E O CRITERIO ANTIGO ERA O DEFEITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Antes era uma fracao do ULTIMO PRECO (0,2% do close). O defeito foi reportado
 * assim: *"Renko nao esta funcionando, aparece apenas uma Barra"*. Era exatamente
 * isso, e os numeros do dado do playground explicam:
 *
 * | criterio                          | tijolo | tijolos em 240 velas |
 * |-----------------------------------|--------|----------------------|
 * | 0,2% do preco (ANTIGO)            | 259,4  | **2**                |
 * | amplitude media (`high - low`)    | 111,9  | 10                   |
 * | ⭐ variacao media do close        |  29,3  | **98**               |
 *
 * A raiz do erro e conceitual: **o nivel do preco nao diz nada sobre o quanto ele se
 * move**. Dois ativos a 130.000 podem oscilar 600 ou 60.000 pontos por sessao, e a
 * fracao do preco daria o mesmo tijolo aos dois — bom para um, inutil para o outro.
 * Renko e uma grade de MOVIMENTO; a grade tem de sair do movimento observado.
 *
 * ⭐ E a medida certa do movimento aqui e a **variacao de FECHAMENTO**
 * (`|close[i] - close[i-1]|` medio), nao a amplitude da vela. O motivo e que o
 * `renko` desta biblioteca e construido sobre CLOSES: usar a amplitude (que inclui os
 * pavios) superestima o passo em ~4x no dado medido — 111,9 contra 29,3 — e a serie
 * rende 10 tijolos em vez de 98. Um tijolo do tamanho do passo tipico do close e o que
 * faz cada tijolo custar aproximadamente uma barra de movimento.
 *
 * ⚠️ **A assinatura mudou de `(velas, fracao?: number)` para `(velas, opcoes?)` de
 * proposito.** Um `brickSizeAutomatico(velas, 0.002)` antigo, se continuasse
 * compilando, passaria a pedir `0,002 × 29,3` — tijolo de 0,06 — e o `renko` emitiria
 * centenas de tijolos por vela. Erro de compilacao e infinitamente melhor que essa
 * falha silenciosa.
 *
 * ⚠️ Devolve `null` (nao zero) quando nao ha DUAS velas validas de onde tirar uma
 * variacao, ou quando a variacao media e zero (serie de preco constante). `null` =
 * "nao sei"; `brickSize` zero ou negativo geraria laco infinito no `renko`.
 */
export function brickSizeAutomatico(
  velas: readonly CandlestickData[],
  opcoes: BrickSizeOptions = {},
): number | null {
  const multiplo = opcoes.multiplo ?? 1;
  if (!(multiplo > 0) || !Number.isFinite(multiplo)) return null;

  let soma = 0;
  let n = 0;
  let anterior: number | null = null;
  for (const c of velas) {
    // ⚠️ Vela invalida NAO vira `anterior`: encadear a variacao contra um `NaN`
    // envenenaria a soma, e usar o close anterior VALIDO e o comportamento certo — o
    // buraco no dado nao inventa nem apaga movimento.
    if (!isVelaValida(c)) continue;
    if (anterior !== null) {
      const variacao = Math.abs(c.close - anterior);
      if (Number.isFinite(variacao)) {
        soma += variacao;
        n += 1;
      }
    }
    anterior = c.close;
  }
  // Uma vela so (ou nenhuma) nao define variacao nenhuma.
  if (n === 0) return null;

  const media = soma / n;
  // ⚠️ Serie de preco CONSTANTE da media zero. Nao ha grade de movimento a construir
  // sobre movimento nenhum — devolver "nao sei" e o certo, e impede o laco infinito no
  // `renko`.
  if (!(media > 0)) return null;

  const bs = media * multiplo;
  return bs > 0 && Number.isFinite(bs) ? bs : null;
}

/**
 * Converte uma serie de velas em tijolos Renko de tamanho fixo `brickSize`,
 * derivados dos precos de FECHAMENTO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renko ignora o tempo e reage so a MOVIMENTO de preco. Mantem-se um preco de
 * referencia (a borda do ultimo tijolo). Enquanto o close nao se afasta o
 * bastante, nada acontece.
 *
 *  - CONTINUAR na direcao atual: basta o preco andar `brickSize` alem da borda.
 *    Cada `brickSize` completo gera um tijolo; um salto de 3*brickSize numa barra
 *    gera 3 tijolos de uma vez.
 *  - REVERTER: exige `2*brickSize` na direcao oposta — um tijolo para "cancelar" o
 *    corrente e outro para abrir na nova direcao. E por isso que Renko filtra
 *    ruido: oscilacao menor que dois tijolos nao inverte a serie.
 *
 * O primeiro tijolo nasce quando o preco anda `brickSize` a partir do primeiro
 * close valido (a semente da referencia); antes disso nao ha direcao definida.
 *
 * Cada tijolo e uma "vela" cujo corpo ocupa exatamente uma borda de tijolo:
 * tijolo de alta tem `open` na borda de baixo e `close` na de cima; o de baixa, o
 * inverso. `high`/`low` coincidem com as bordas — Renko nao tem pavio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ RENKO PERDE A LINEARIDADE TEMPORAL — leia antes de plotar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `time` de cada tijolo parte do `time` da barra que o FECHOU. Como uma unica
 * barra pode fechar varios tijolos (salto grande) ou nenhum (mercado parado), a
 * serie resultante NAO e equidistante no tempo. Isso e esperado: Renko e indexado
 * por movimento, nao por tempo, e o eixo do motor e por espaco logico (indice de
 * barra) — os tijolos saem equidistantes na tela, cada um na sua coluna.
 *
 * ⭐ **Mas o `time` e ESTRITAMENTE CRESCENTE**, e isso e correcao de defeito, nao
 * capricho. Quando varios tijolos fechavam na mesma barra, todos carregavam o mesmo
 * `time`, e o motor assume tempo unico por barra em tres lugares:
 *
 *  - `SeriesImpl.update` trata `time` igual ao ultimo como "a MESMA barra sendo
 *    revisada" e **substitui** — ao vivo, o segundo tijolo de uma barra apagava o
 *    primeiro em vez de entrar na serie;
 *  - `timeToIndex` (crosshair, marcador, ancora de desenho) resolve tempo repetido
 *    para o PRIMEIRO indice, entao tudo que e ancorado por tempo colava no primeiro
 *    tijolo do grupo;
 *  - os rotulos do eixo repetiam o mesmo instante em colunas vizinhas.
 *
 * O tempo de cada tijolo e portanto `max(tempo da barra, tempo do tijolo anterior + 1)`.
 * O deslocamento de 1 segundo e irrelevante para a leitura (Renko nao promete eixo
 * temporal fiel) e devolve ao motor a premissa que ele exige.
 *
 * Determinismo: para a MESMA serie e o MESMO `brickSize`, a saida e identica —
 * o unico estado e a referencia e a direcao correntes, ambas derivadas do dado.
 *
 * Guarda dura: `brickSize` nao finito ou <= 0 devolve `[]` (nao lanca, nao entra
 * em laco infinito). Closes invalidos sao pulados.
 */
export function renko(velas: readonly CandlestickData[], brickSize: number): CandlestickData[] {
  const tijolos: CandlestickData[] = [];
  if (!(brickSize > 0) || !Number.isFinite(brickSize)) return tijolos;

  /** Tempo do ultimo tijolo emitido, para garantir crescimento ESTRITO. */
  let ultimoTempo: number | null = null;
  /** O proximo tempo utilizavel a partir do tempo da barra. Ver a nota do cabecalho. */
  const proximoTempo = (tempoDaBarra: number): number => {
    const t = ultimoTempo === null ? tempoDaBarra : Math.max(tempoDaBarra, ultimoTempo + 1);
    ultimoTempo = t;
    return t;
  };

  // Referencia = borda do ultimo tijolo (ou o primeiro close, como semente).
  let referencia: number | null = null;
  // Direcao do ultimo tijolo: +1 alta, -1 baixa, 0 indefinida (ainda sem tijolo).
  let direcao = 0;

  for (const c of velas) {
    if (!isVelaValida(c)) continue;
    const preco = c.close;

    if (referencia === null) {
      referencia = preco;
      continue;
    }

    // `ref` e a mesma `referencia`, mas ja estreitada para `number` — o
    // compilador nao propaga o narrowing de `null` para dentro do laco quando a
    // variavel e reatribuida ali. Manter as duas em passo: escrever em ambas.
    let ref: number = referencia;

    // Limiar de reversao: continuar exige 1 tijolo; virar exige 2. Comeco (direcao
    // 0) trata qualquer lado como "continuar" — o primeiro tijolo so precisa de 1.
    for (;;) {
      // Quantos tijolos "para cima" ou "para baixo" o preco alcancou a partir da
      // referencia. Enquanto o preco nao completar um tijolo (ou dois, na
      // reversao), o laco para e nada mais e emitido nesta barra.
      const diff = preco - ref;

      if (diff >= brickSize && direcao >= 0) {
        // Sobe um tijolo na direcao de alta.
        const de = ref;
        const ate = ref + brickSize;
        tijolos.push({ time: proximoTempo(c.time), open: de, high: ate, low: de, close: ate });
        ref = ate;
        direcao = 1;
      } else if (diff <= -brickSize && direcao <= 0) {
        // Desce um tijolo na direcao de baixa.
        const de = ref;
        const ate = ref - brickSize;
        tijolos.push({ time: proximoTempo(c.time), open: de, high: de, low: ate, close: ate });
        ref = ate;
        direcao = -1;
      } else if (diff >= 2 * brickSize && direcao < 0) {
        // Reversao para cima: precisou de 2*brickSize. Abre UM tijolo de alta a
        // partir da borda oposta do tijolo de baixa corrente.
        const de = ref + brickSize;
        const ate = de + brickSize;
        tijolos.push({ time: proximoTempo(c.time), open: de, high: ate, low: de, close: ate });
        ref = ate;
        direcao = 1;
      } else if (diff <= -2 * brickSize && direcao > 0) {
        // Reversao para baixo, simetrica.
        const de = ref - brickSize;
        const ate = de - brickSize;
        tijolos.push({ time: proximoTempo(c.time), open: de, high: de, low: ate, close: ate });
        ref = ate;
        direcao = -1;
      } else {
        break;
      }
    }
    referencia = ref;
  }

  return tijolos;
}

/** Reexporta o tipo do tempo para consumidores que so importam este modulo. */
export type { Time };
