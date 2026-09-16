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

/**
 * Tamanho de tijolo automatico por fracao do ULTIMO preco de fechamento.
 *
 * Renko precisa de um `brickSize` em unidade de preco. Fixa-lo a mao exige saber a
 * escala do ativo; esta heuristica deriva um valor razoavel do proprio dado:
 * `fracao` (default 0,2%) do ultimo close valido. Um ativo a 100 ganha tijolo de
 * 0,2; um a 100.000, de 200 — proporcional a escala, sem magica.
 *
 * ⚠️ Devolve `null` (nao zero) quando nao ha close valido de onde tirar a escala:
 * `null` = "nao sei", e `brickSize` zero ou negativo geraria laco infinito de
 * tijolos no `renko`. O chamador decide o que fazer com o "nao sei" — tipicamente
 * nao desenhar Renko ate ter dado.
 *
 * NAO usa ATR de proposito: ATR exige janela e mais parametros; para o brick
 * automatico "bom o suficiente" a fracao do preco basta e e determinista sem
 * escolher periodo. Quem quiser ATR calcula fora e passa o `brickSize` explicito.
 */
export function brickSizeAutomatico(velas: readonly CandlestickData[], fracao = 0.002): number | null {
  if (!(fracao > 0) || !Number.isFinite(fracao)) return null;
  // Ultimo close valido — o preco "corrente" e a melhor referencia de escala.
  for (let i = velas.length - 1; i >= 0; i--) {
    const c = velas[i];
    if (c !== undefined && isVelaValida(c) && c.close > 0) {
      const bs = c.close * fracao;
      return bs > 0 && Number.isFinite(bs) ? bs : null;
    }
  }
  return null;
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
 * O `time` de cada tijolo e o `time` da barra que o FECHOU. Como uma unica barra
 * pode fechar varios tijolos (salto grande) ou nenhum (mercado parado), a serie
 * resultante NAO e equidistante no tempo e pode ter DOIS tijolos com o mesmo
 * `time` — inclusive o par "cancela+abre" de uma reversao. Isso e esperado: Renko
 * e indexado por movimento, nao por tempo. O eixo do motor (`time-scale.core`) e
 * por espaco logico (indice de barra), entao trata os tijolos como sequencia
 * ordenada e indexada, igual a velas — a nao-linearidade do tempo nao quebra o
 * desenho, so a leitura do eixo de tempo, que passa a ser aproximada.
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
        tijolos.push({ time: c.time, open: de, high: ate, low: de, close: ate });
        ref = ate;
        direcao = 1;
      } else if (diff <= -brickSize && direcao <= 0) {
        // Desce um tijolo na direcao de baixa.
        const de = ref;
        const ate = ref - brickSize;
        tijolos.push({ time: c.time, open: de, high: de, low: ate, close: ate });
        ref = ate;
        direcao = -1;
      } else if (diff >= 2 * brickSize && direcao < 0) {
        // Reversao para cima: precisou de 2*brickSize. Abre UM tijolo de alta a
        // partir da borda oposta do tijolo de baixa corrente.
        const de = ref + brickSize;
        const ate = de + brickSize;
        tijolos.push({ time: c.time, open: de, high: ate, low: de, close: ate });
        ref = ate;
        direcao = 1;
      } else if (diff <= -2 * brickSize && direcao > 0) {
        // Reversao para baixo, simetrica.
        const de = ref - brickSize;
        const ate = de - brickSize;
        tijolos.push({ time: c.time, open: de, high: de, low: ate, close: ate });
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
