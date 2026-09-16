/**
 * snap.core — o ima: prende a ancora a um preco significativo. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma linha de tendencia tracada "no olho" fica a alguns centavos da maxima que
 * ela pretendia tocar. Visualmente parece certa; numericamente nao e. Quando o
 * mesmo desenho e usado para alerta, para nivel de entrada ou para conferir se o
 * preco respeitou a linha, esses centavos sao a diferenca entre acerto e erro.
 *
 * O ima resolve prendendo a ancora ao OHLC da barra mais proxima. E convencao
 * consolidada em plataforma de mesa, e a razao pela qual profissional consegue
 * marcar topo e fundo rapido sem dar zoom maximo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS TRES DECISOES DE PROJETO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. O ima tem RAIO, e o raio e em pixel.** Prender sempre seria pior que nao
 * prender: o usuario que quer tracar num nivel arbitrario (uma projecao, um alvo)
 * ficaria impedido. Fora do raio, o valor cru passa intacto.
 *
 * O raio e em PIXEL, e nao em preco, porque e a distancia que o olho ve. Em preco,
 * o mesmo raio seria imperceptivel num ativo de tick grande e capturaria meio
 * grafico num de tick pequeno.
 *
 * **2. O ima e OPT-IN por chamada, nao estado global.** Quem decide se o gesto
 * corrente usa ima e o controlador, tipicamente por uma tecla modificadora. Estado
 * global de ima e fonte de confusao: o usuario esquece que ligou e nao entende por
 * que a linha "pula".
 *
 * **3. Nao ha ima de TEMPO por default.** Prender o instante a barra parece obvio
 * e atrapalha: linha de tendencia entre dois topos precisa da inclinacao real, e
 * quantizar o tempo ao centro da barra muda a inclinacao de forma visivel em
 * periodo alto. Existe `snapTimeToBar` para quem quiser, desligado por default.
 */

import type { Anchor } from './model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Insumo
// ═════════════════════════════════════════════════════════════════════════════

/** Uma barra, como o ima precisa dela. */
export interface SnapBar {
  readonly timeSec: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Qual preco da barra foi escolhido. `NONE` = nao houve captura. */
export type SnapTarget = 'NONE' | 'OPEN' | 'HIGH' | 'LOW' | 'CLOSE';

/** Resultado da captura. */
export interface SnapResult {
  readonly anchor: Anchor;
  readonly target: SnapTarget;
  /** Distancia em pixel do cursor ao preco capturado. `null` se nao capturou. */
  readonly distancePx: number | null;
}

/** Raio do ima, em pixels CSS. */
export const SNAP_RADIUS_PX = 12;

/** Parametros de `snapAnchor`. */
export interface SnapParams {
  /** A ancora crua, derivada da posicao do cursor. */
  readonly raw: Anchor;
  /**
   * Barras candidatas.
   *
   * O chamador passa apenas as proximas — tipicamente a barra sob o cursor e as
   * vizinhas. Passar o pregao inteiro funciona e desperdicia: o ima e chamado a
   * cada movimento durante o desenho.
   */
  readonly bars: readonly SnapBar[];
  /** Preco -> Y em pixel. Necessario porque o raio e medido em pixel. */
  readonly priceToY: (price: number) => number | null;
  /** Raio do ima em pixel. Default `SNAP_RADIUS_PX`. */
  readonly radiusPx?: number;
  /** Prender tambem o instante ao da barra capturada. Default `false`. */
  readonly snapTimeToBar?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// A captura
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Prende a ancora ao OHLC mais proximo, se houver algum dentro do raio.
 *
 * Nunca lanca. Sem barra, sem conversor utilizavel ou fora do raio, devolve a
 * ancora crua com `target: 'NONE'` — o gesto do usuario nunca e perdido.
 */
export function snapAnchor(p: SnapParams): SnapResult {
  const semCaptura: SnapResult = { anchor: p.raw, target: 'NONE', distancePx: null };

  const raio = p.radiusPx ?? SNAP_RADIUS_PX;
  if (!Number.isFinite(raio) || raio <= 0) return semCaptura;
  if (p.bars.length === 0) return semCaptura;

  const yCursor = p.priceToY(p.raw.price);
  if (yCursor === null || !Number.isFinite(yCursor)) return semCaptura;

  let melhorPreco = 0;
  let melhorAlvo: SnapTarget = 'NONE';
  let melhorDistancia = Infinity;
  let melhorTempo = p.raw.timeSec;

  // A ordem de teste — high, low, close, open — decide EMPATE, e nao e arbitraria:
  // extremos primeiro. Topo e fundo sao o que se marca; abertura e fechamento
  // interessam menos, e numa barra doji os quatro coincidem em pixel.
  const alvos: readonly SnapTarget[] = ['HIGH', 'LOW', 'CLOSE', 'OPEN'];

  for (const barra of p.bars) {
    if (!Number.isFinite(barra.timeSec)) continue;

    for (const alvo of alvos) {
      const preco = precoDe(barra, alvo);
      if (preco === null || !Number.isFinite(preco)) continue;

      const y = p.priceToY(preco);
      if (y === null || !Number.isFinite(y)) continue;

      const d = Math.abs(y - yCursor);
      // `<` estrito preserva a ordem de preferencia acima em caso de empate.
      if (d < melhorDistancia) {
        melhorDistancia = d;
        melhorPreco = preco;
        melhorAlvo = alvo;
        melhorTempo = barra.timeSec;
      }
    }
  }

  if (melhorAlvo === 'NONE' || melhorDistancia > raio) return semCaptura;

  return {
    anchor: {
      timeSec: p.snapTimeToBar === true ? melhorTempo : p.raw.timeSec,
      price: melhorPreco,
    },
    target: melhorAlvo,
    distancePx: melhorDistancia,
  };
}

function precoDe(b: SnapBar, alvo: SnapTarget): number | null {
  switch (alvo) {
    case 'OPEN':
      return b.open;
    case 'HIGH':
      return b.high;
    case 'LOW':
      return b.low;
    case 'CLOSE':
      return b.close;
    default:
      return null;
  }
}

/**
 * As barras vizinhas de um instante, por janela de indice.
 *
 * Conveniencia para o chamador nao passar o pregao inteiro. Busca binaria: a
 * colecao de barras e crescente em tempo, e o ima e chamado a cada movimento.
 *
 * @param bars    barras em ordem CRESCENTE de tempo
 * @param timeSec instante de referencia
 * @param span    quantas barras de cada lado. Default 1 (tres barras).
 */
export function barsNear(
  bars: readonly SnapBar[],
  timeSec: number,
  span = 1,
): readonly SnapBar[] {
  if (bars.length === 0 || !Number.isFinite(timeSec)) return [];

  let baixo = 0;
  let alto = bars.length - 1;
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    const b = bars[meio];
    if (b === undefined) break;
    if (b.timeSec < timeSec) baixo = meio + 1;
    else alto = meio;
  }

  const de = Math.max(0, baixo - span);
  const ate = Math.min(bars.length, baixo + span + 1);
  return bars.slice(de, ate);
}
