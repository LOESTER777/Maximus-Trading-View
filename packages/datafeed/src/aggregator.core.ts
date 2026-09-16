/**
 * aggregator.core — agregacao PURA de trades em barras, e rollup de barras.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO E `.core` (PURO)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sem DOM, sem relogio, sem sorteio, sem I/O, sem estado de modulo. Todo insumo
 * chega por parametro; a mesma entrada da sempre a mesma saida. E o que o torna
 * testavel sem rede e sem congelar relogio — e por isso ele vive fora dos
 * adaptadores, que sao sujos por natureza (transporte, socket, tempo real).
 *
 * A necessidade e concreta: nem toda fonte entrega candles. Muita entrega SO
 * trades (um evento por negocio), e cabe ao consumidor agrega-los em barras.
 * Outras entregam SO M1 e o consumidor quer M5. As duas transformacoes sao
 * determinismo puro, e agrupa-las aqui evita que cada consumidor reimplemente —
 * e reimplemente com o mesmo bug de fronteira de balde.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FRONTEIRA DO BALDE — a decisao que importa
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma barra de passo `stepSec` cobre `[k*stepSec, (k+1)*stepSec)` em segundos, e
 * o `time` da barra e o INICIO do balde (`k*stepSec`), alinhado ao epoch. E a
 * convencao de `Bar.time` (inicio do periodo, em segundos) e a que o substrato
 * de grafico espera. Alinhar ao epoch, e nao ao primeiro trade, e o que faz M5
 * de dois consumidores diferentes casar: o balde das 09:00 e o mesmo balde para
 * todo mundo, independentemente de quando o primeiro negocio caiu.
 *
 * ⚠️ Intervalo semiaberto `[inicio, fim)`: um trade exatamente no segundo de
 * virada pertence ao balde SEGUINTE. Fechar nos dois lados poria o trade em dois
 * baldes e a soma de volume nao conservaria — este e o erro de fronteira
 * classico, e a razao de a regra estar escrita e testada.
 */

import type { Bar } from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// Trade
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um negocio individual.
 *
 * `time` em SEGUNDOS, como `Bar.time` — a fronteira inteira do pacote trabalha
 * em segundos para candles, e misturar unidade aqui reintroduziria o bug que a
 * documentacao de `contracts.ts` descreve.
 */
export interface Trade {
  /** Instante do negocio, epoch em SEGUNDOS. */
  readonly time: number;
  /** Preco negociado. */
  readonly price: number;
  /** Quantidade negociada. Ausente = "nao sei"; nao entra no volume. */
  readonly size?: number;
  /**
   * Lado do agressor, quando a fonte classifica.
   *
   * `'buy'` = agressor comprador; `'sell'` = agressor vendedor. Ausente quando a
   * fonte nao informa — e ai a barra sai sem `buyVolume`/`sellVolume`, porque
   * ausencia e "nao sei", nao "zero de cada lado".
   */
  readonly side?: 'buy' | 'sell';
}

// ═════════════════════════════════════════════════════════════════════════════
// aggregateTrades
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Agrega trades em barras OHLCV de passo `stepSec` segundos.
 *
 * Determinismo puro. As barras saem ORDENADAS por `time` crescente,
 * independentemente da ordem dos trades na entrada — o consumidor pode passar
 * trades fora de ordem (chegam assim ao vivo) e recebe serie limpa.
 *
 * Regras, e o porque de cada uma:
 *  - `open` e o preco do PRIMEIRO trade do balde EM TEMPO (nao o primeiro do
 *    array): reordenamos por tempo antes de reduzir, senao trade atrasado
 *    corromperia o open.
 *  - `close` e o preco do ULTIMO trade em tempo.
 *  - `high`/`low` sao max/min dos precos.
 *  - `volume` e a soma de `size`; sai ausente se NENHUM trade do balde tinha
 *    `size` (ausencia total = "nao sei"), e conta so os que tinham.
 *  - `buyVolume`/`sellVolume` somam `size` por lado; saem ausentes se nenhum
 *    trade do balde trazia lado classificado.
 *
 * @param trades  Negocios, em qualquer ordem.
 * @param stepSec Duracao do balde em segundos. Precisa ser inteiro positivo
 *                finito; caso contrario devolve `[]` (passo invalido nao produz
 *                barra — e melhor serie vazia que barra com fronteira absurda).
 * @returns Barras ordenadas por `time`. Array vazio se nao ha trade utilizavel.
 */
export function aggregateTrades(
  trades: readonly Trade[],
  stepSec: number,
): readonly Bar[] {
  if (!ehPassoValido(stepSec)) return [];
  if (trades.length === 0) return [];

  // Agrupa por indice de balde. Mapa por chave numerica do balde: e O(n) e nao
  // depende de os trades chegarem ordenados.
  const grupos = new Map<number, MutableBucket>();

  for (const trade of trades) {
    // Trade com tempo ou preco nao-finito e ruido; descarta em vez de deixar
    // `NaN` contaminar open/high/low/close do balde inteiro.
    if (!ehFinito(trade.time) || !ehFinito(trade.price)) continue;

    const balde = Math.floor(trade.time / stepSec);
    const inicio = balde * stepSec;

    let acc = grupos.get(balde);
    if (acc === undefined) {
      acc = criarBucket(inicio);
      grupos.set(balde, acc);
    }
    acumularTrade(acc, trade);
  }

  // Ordena os baldes por tempo de inicio. `Map` preserva ordem de insercao, que
  // NAO e a ordem temporal quando os trades chegam fora de ordem — por isso
  // ordenamos explicitamente.
  const baldes = Array.from(grupos.values()).sort((a, b) => a.time - b.time);
  return baldes.map(finalizarBucket);
}

// ═════════════════════════════════════════════════════════════════════════════
// rollupBars
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Agrega barras de passo `fromStep` em barras de passo `toStep` (ex.: M1->M5).
 *
 * Determinismo puro. Conserva OHLC pela definicao classica: `open` da primeira
 * barra do balde maior (em tempo), `high` o maior high, `low` o menor low,
 * `close` da ultima barra, `volume` a soma dos volumes. `buyVolume`/`sellVolume`
 * somam por lado quando presentes.
 *
 * ⚠️ `toStep` precisa ser MULTIPLO INTEIRO de `fromStep`. M1->M5 e valido
 * (300/60 = 5); M1->M7 nao e. Multiplo nao-inteiro alinharia baldes maiores a
 * fronteiras que nao coincidem com as menores, e uma barra de origem cairia em
 * dois baldes de destino — a mesma armadilha de fronteira do `aggregateTrades`,
 * agravada porque aqui nao ha trade individual para reatribuir. Passo invalido
 * ou nao-multiplo devolve `[]`.
 *
 * As barras de entrada NAO precisam vir ordenadas nem contiguas: reordenamos por
 * `time`, e balde de destino sem barra de origem simplesmente nao aparece (buraco
 * na origem = buraco no destino, nunca barra inventada).
 *
 * @param bars     Barras de origem, em qualquer ordem.
 * @param fromStep Passo das barras de origem, em segundos.
 * @param toStep   Passo desejado, em segundos. Multiplo inteiro de `fromStep`.
 * @returns Barras de passo `toStep`, ordenadas por `time`. `[]` se invalido.
 */
export function rollupBars(
  bars: readonly Bar[],
  fromStep: number,
  toStep: number,
): readonly Bar[] {
  if (!ehPassoValido(fromStep) || !ehPassoValido(toStep)) return [];
  // O destino tem de ser um agrupamento inteiro do origem. `>=` e nao `>`
  // permite `fromStep === toStep` (identidade util: reamostra e limpa).
  if (toStep < fromStep) return [];
  if (toStep % fromStep !== 0) return [];
  if (bars.length === 0) return [];

  const grupos = new Map<number, MutableBucket>();

  for (const bar of bars) {
    // Barra com tempo ou OHLC nao-finito e invalida; descarta para nao
    // contaminar o balde de destino.
    if (
      !ehFinito(bar.time) ||
      !ehFinito(bar.open) ||
      !ehFinito(bar.high) ||
      !ehFinito(bar.low) ||
      !ehFinito(bar.close)
    ) {
      continue;
    }

    const balde = Math.floor(bar.time / toStep);
    const inicio = balde * toStep;

    let acc = grupos.get(balde);
    if (acc === undefined) {
      acc = criarBucket(inicio);
      grupos.set(balde, acc);
    }
    acumularBarra(acc, bar);
  }

  const baldes = Array.from(grupos.values()).sort((a, b) => a.time - b.time);
  return baldes.map(finalizarBucket);
}

// ═════════════════════════════════════════════════════════════════════════════
// Acumulador interno
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Estado mutavel de um balde em construcao.
 *
 * ⚠️ Mutavel, e local a chamada — nao e estado de modulo. A pureza esta
 * preservada: nada aqui sobrevive ao retorno da funcao. A mutacao local e o que
 * mantem a agregacao O(n) em vez de reconstruir imutavel a cada trade.
 *
 * `firstTime`/`lastTime` guardam o tempo do primeiro e do ultimo membro EM
 * TEMPO, para que `open`/`close` nao dependam da ordem de chegada. `hasVolume` e
 * os `has*` distinguem "somou zero" de "nunca teve" — sem eles, uma barra sem
 * volume informado sairia com `volume: 0`, afirmando o que nao sabe.
 */
interface MutableBucket {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  firstTime: number;
  lastTime: number;
  volume: number;
  hasVolume: boolean;
  buyVolume: number;
  hasBuy: boolean;
  sellVolume: number;
  hasSell: boolean;
}

function criarBucket(time: number): MutableBucket {
  return {
    time,
    open: Number.NaN,
    high: Number.NEGATIVE_INFINITY,
    low: Number.POSITIVE_INFINITY,
    close: Number.NaN,
    firstTime: Number.POSITIVE_INFINITY,
    lastTime: Number.NEGATIVE_INFINITY,
    volume: 0,
    hasVolume: false,
    buyVolume: 0,
    hasBuy: false,
    sellVolume: 0,
    hasSell: false,
  };
}

/** Atualiza open/high/low/close pela relacao temporal, comum a trade e barra. */
function atualizarOHLC(
  acc: MutableBucket,
  tempo: number,
  open: number,
  high: number,
  low: number,
  close: number,
): void {
  if (tempo < acc.firstTime) {
    acc.firstTime = tempo;
    acc.open = open;
  }
  if (tempo > acc.lastTime) {
    acc.lastTime = tempo;
    acc.close = close;
  }
  if (high > acc.high) acc.high = high;
  if (low < acc.low) acc.low = low;
}

function acumularTrade(acc: MutableBucket, trade: Trade): void {
  // Para um trade, o proprio preco e open/high/low/close daquele instante.
  atualizarOHLC(acc, trade.time, trade.price, trade.price, trade.price, trade.price);

  const size = trade.size;
  if (ehFinito(size)) {
    acc.volume += size;
    acc.hasVolume = true;
    if (trade.side === 'buy') {
      acc.buyVolume += size;
      acc.hasBuy = true;
    } else if (trade.side === 'sell') {
      acc.sellVolume += size;
      acc.hasSell = true;
    }
  }
}

function acumularBarra(acc: MutableBucket, bar: Bar): void {
  atualizarOHLC(acc, bar.time, bar.open, bar.high, bar.low, bar.close);

  if (ehFinito(bar.volume)) {
    acc.volume += bar.volume;
    acc.hasVolume = true;
  }
  if (ehFinito(bar.buyVolume)) {
    acc.buyVolume += bar.buyVolume;
    acc.hasBuy = true;
  }
  if (ehFinito(bar.sellVolume)) {
    acc.sellVolume += bar.sellVolume;
    acc.hasSell = true;
  }
}

/** Converte o acumulador na barra final, so com os campos que existem. */
function finalizarBucket(acc: MutableBucket): Bar {
  const barra: Bar = {
    time: acc.time,
    open: acc.open,
    high: acc.high,
    low: acc.low,
    close: acc.close,
  };
  return {
    ...barra,
    ...(acc.hasVolume ? { volume: acc.volume } : {}),
    ...(acc.hasBuy ? { buyVolume: acc.buyVolume } : {}),
    ...(acc.hasSell ? { sellVolume: acc.sellVolume } : {}),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Guardas
// ═════════════════════════════════════════════════════════════════════════════

/** Passo valido: inteiro positivo finito. */
function ehPassoValido(step: number): boolean {
  return Number.isInteger(step) && step > 0;
}

/** Numero finito (rejeita `undefined`, `NaN`, `Infinity`). */
function ehFinito(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
