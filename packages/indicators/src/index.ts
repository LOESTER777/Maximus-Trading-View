/**
 * @robustus/charts-indicators — a fachada publica do pacote.
 *
 * Exporta o contrato, as primitivas de estado rolante, todas as fabricas e um
 * `registry` (nome -> fabrica). O registry e o ponto unico por onde uma UI ou o
 * motor descobrem e instanciam indicadores por nome, sem conhecer cada arquivo.
 */

// ── Contrato e auxiliares ──────────────────────────────────────────────────
export * from './contracts.js';

// ── Primitivas de estado rolante (reexportadas para quem for compor as suas) ─
export * from './rolling.core.js';

// ── Esqueleto de instancia (util para indicadores externos) ────────────────
export { buildInstance, warmingValue, type IndicatorLogic } from './built-in/instance-base.js';

// ── Fabricas ───────────────────────────────────────────────────────────────
import {
  smaFactory,
  emaFactory,
  wmaFactory,
  rmaFactory,
  demaFactory,
  temaFactory,
} from './built-in/moving-averages.js';
import {
  rsiFactory,
  stochasticFactory,
  cciFactory,
  williamsRFactory,
  rocFactory,
  momentumFactory,
} from './built-in/oscillators.js';
import {
  atrFactory,
  stddevFactory,
  bollingerFactory,
  keltnerFactory,
} from './built-in/volatility.js';
import { macdFactory, adxFactory, obvFactory, vwapFactory } from './built-in/trend-volume.js';

import type { IndicatorFactory } from './contracts.js';

export {
  smaFactory,
  emaFactory,
  wmaFactory,
  rmaFactory,
  demaFactory,
  temaFactory,
  rsiFactory,
  stochasticFactory,
  cciFactory,
  williamsRFactory,
  rocFactory,
  momentumFactory,
  atrFactory,
  stddevFactory,
  bollingerFactory,
  keltnerFactory,
  macdFactory,
  adxFactory,
  obvFactory,
  vwapFactory,
};

/** Toda fabrica embutida, na ordem de categoria (media, oscilador, vol, tendencia/volume). */
export const builtInFactories: readonly IndicatorFactory[] = [
  smaFactory,
  emaFactory,
  wmaFactory,
  rmaFactory,
  demaFactory,
  temaFactory,
  rsiFactory,
  stochasticFactory,
  cciFactory,
  williamsRFactory,
  rocFactory,
  momentumFactory,
  atrFactory,
  stddevFactory,
  bollingerFactory,
  keltnerFactory,
  macdFactory,
  adxFactory,
  obvFactory,
  vwapFactory,
];

/**
 * Registry nome -> fabrica.
 *
 * Construido a partir de `builtInFactories` para nao duplicar a lista de nomes —
 * a chave e sempre `factory.meta.name`, entao registro e metadado nao divergem.
 */
export const registry: ReadonlyMap<string, IndicatorFactory> = new Map(
  builtInFactories.map((f) => [f.meta.name, f]),
);

/** Cria uma instancia por nome, ou `undefined` se o nome nao existir. Nunca lanca. */
export function createIndicator(
  name: string,
  params?: import('./contracts.js').IndicatorParams,
) {
  const factory = registry.get(name);
  return factory ? factory.create(params) : undefined;
}
