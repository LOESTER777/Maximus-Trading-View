/**
 * channels — faixas em volta do preco que NAO vem de desvio padrao do fechamento.
 *
 *   Donchian   — o range puro: maxima e minima de N barras. Sobre o preco (banda).
 *   VWAP+bandas— VWAP da sessao com desvio padrao PONDERADO POR VOLUME.
 *
 * Bollinger (SMA +/- desvio) e Keltner (EMA +/- ATR) moram em `volatility.ts`.
 * A divisao nao e por forma — as quatro sao bandas — e por NATUREZA do que a
 * largura mede: volatilidade estatistica la, extremos observados e volume aqui.
 */

import {
  numParam,
  priceOf,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type IndicatorValue,
  type ParamSpec,
} from '../contracts.js';
import { KahanSum, MinMaxWindow } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

const periodSpec = (name: string, label: string, def: number): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

// ═════════════════════════════════════════════════════════════════════════════
// Donchian Channels
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Canais de Donchian: superior = max(high, N), inferior = min(low, N).
 *
 * ⚠️ A LINHA CENTRAL e o MEIO DO CANAL — `(superior + inferior) / 2` — e NAO uma
 * media movel dos fechamentos. Sao coisas diferentes e o nome "media" confunde:
 * o meio do canal e insensivel a onde os fechamentos ficaram dentro do range,
 * enquanto a SMA e exatamente isso. A definicao de Donchian (e a que as Turtles
 * operavam) e o meio do canal; quem quiser a SMA tem `smaFactory`.
 *
 * ⚠️ VARIANTE: esta INCLUI a barra corrente na janela, como o padrao do
 * TradingView. A variante de rompimento classica EXCLUI a barra corrente (senao a
 * maxima de hoje E o topo do canal, e o preco nunca "rompe" o proprio canal). Quem
 * quiser essa leitura compara o fechamento com o canal da barra ANTERIOR — o que
 * a serie ja permite, sem precisar de um segundo indicador. Incluir e a escolha
 * menos surpreendente para quem so quer ver o range desenhado.
 */
export const donchianFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 20);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'donchian',
    label: 'Canais de Donchian',
    category: 'volatility',
    params: specs,
    outputs: [
      { key: 'upper', label: 'Superior', plot: 'line', pane: 'price', band: 'upper' },
      { key: 'middle', label: 'Meio do Canal', plot: 'line', pane: 'price', band: 'middle' },
      { key: 'lower', label: 'Inferior', plot: 'line', pane: 'price', band: 'lower' },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  const vazio: IndicatorValue = { upper: null, middle: null, lower: null };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const montar = (
        hi: { min: number; max: number } | null,
        lo: { min: number; max: number } | null,
      ): IndicatorValue => {
        if (hi === null || lo === null) return vazio;
        return { upper: hi.max, middle: (hi.max + lo.min) / 2, lower: lo.min };
      };
      return buildInstance(meta, merged, () => {
        const highs = new MinMaxWindow(period);
        const lows = new MinMaxWindow(period);
        return {
          onUpdate: (bar) => montar(highs.push(bar.high), lows.push(bar.low)),
          onPreview: (bar) => montar(highs.peek(bar.high), lows.peek(bar.low)),
          onReset: () => {
            highs.reset();
            lows.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// VWAP com bandas de desvio
// ═════════════════════════════════════════════════════════════════════════════

/**
 * VWAP da sessao com bandas de desvio padrao PONDERADO POR VOLUME.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE UMA FABRICA NOVA, E NAO BANDAS NO `vwapFactory` EXISTENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A alternativa era acrescentar `mult` + saidas `upper`/`lower` ao `vwap` que ja
 * existe. Recusada por duas razoes concretas, nenhuma delas estetica:
 *
 *   1. `vwap` hoje declara UMA saida (`value`) e ZERO parametros. Quem o consome
 *      — inclusive o estado de grafico persistido, que grava indicadores com seus
 *      params e le de volta validando — passaria a receber tres series onde
 *      gravou uma. Todo grafico salvo com VWAP ganharia duas linhas que o usuario
 *      nunca pediu, na proxima abertura. Isso e mudanca de comportamento
 *      silenciosa em dado JA PERSISTIDO.
 *
 *   2. Nao existe `mult` neutro. Qualquer default desenha banda; `mult` 0 colapsa
 *      as bandas sobre a VWAP e desenha tres linhas em cima uma da outra. Ou seja,
 *      nao ha como adicionar o parametro sem mudar o desenho de quem so queria a
 *      VWAP.
 *
 * ⇒ `vwap` fica INTOCADO (uma linha, sem parametro) e quem quer as bandas pede
 * `vwap_bands`. Duas fabricas, duas intencoes explicitas, nenhum consumidor
 * surpreendido. O custo e um pouco de calculo repetido se alguem ligar os dois ao
 * mesmo tempo — irrelevante frente a quebrar layout salvo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A MATEMATICA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     VWAP     = soma(p*v) / soma(v),              p = hlc3 (preco tipico)
 *     variancia= soma(p²*v) / soma(v) - VWAP²      (ponderada por volume)
 *     banda    = VWAP +/- mult * raiz(variancia)
 *
 * ⚠️ O desvio e PONDERADO POR VOLUME, nao o desvio simples dos fechamentos em
 * volta da VWAP. Essa e a definicao coerente: se a VWAP pesa por volume, a
 * dispersao em torno dela tambem tem de pesar, senao um tick de 1 lote afasta a
 * banda tanto quanto um bloco de 10 mil.
 *
 * ⚠️ `E[p²] - E[p]²` e a forma classicamente instavel de variancia (subtrai dois
 * numeros grandes e proximos) — as tres somas usam Kahan e o resultado e clampado
 * em 0 antes da raiz, exatamente como `StdDevState` faz e pela mesma razao: sem o
 * clamp, um residuo negativo de ponto flutuante viraria `NaN` na raiz.
 *
 * ⚠️ SESSAO: reinicia na virada de dia-calendario UTC, igual ao `vwap`. Mesma
 * fronteira de proposito — duas VWAPs na mesma tela nao podem reiniciar em
 * momentos diferentes.
 *
 * ⚠️ Sem volume na sessao (denominador 0) o VWAP e INDEFINIDO -> null, nao zero.
 */
export const vwapBandsFactory: IndicatorFactory = (() => {
  const mSpec: ParamSpec = {
    name: 'mult',
    label: 'Multiplicador',
    type: 'number',
    default: 1,
    min: 0.1,
    max: 10,
    step: 0.1,
  };
  const specs: readonly ParamSpec[] = [mSpec];
  const meta: IndicatorMeta = {
    name: 'vwap_bands',
    label: 'VWAP com Bandas de Desvio',
    category: 'volume',
    params: specs,
    outputs: [
      { key: 'upper', label: 'Superior', plot: 'line', pane: 'price', band: 'upper' },
      { key: 'value', label: 'VWAP', plot: 'line', pane: 'price', band: 'middle' },
      { key: 'lower', label: 'Inferior', plot: 'line', pane: 'price', band: 'lower' },
    ],
    dependencies: ['vwap'],
    // Existe a partir da primeira barra COM volume; nao ha janela a encher.
    warmup: () => 0,
  };
  const vazio: IndicatorValue = { upper: null, value: null, lower: null };
  const dayOf = (timeSec: number): number => Math.floor(timeSec / 86400);
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const mult = numParam(merged, mSpec);
      /** Monta as tres saidas a partir das somas acumuladas. */
      const montar = (somaPV: number, somaP2V: number, somaV: number): IndicatorValue => {
        if (!(somaV > 0)) return vazio;
        const vwap = somaPV / somaV;
        const variancia = Math.max(0, somaP2V / somaV - vwap * vwap);
        const sd = Math.sqrt(variancia);
        return { upper: vwap + mult * sd, value: vwap, lower: vwap - mult * sd };
      };
      return buildInstance(meta, merged, () => {
        const pv = new KahanSum();
        const p2v = new KahanSum();
        const vv = new KahanSum();
        let session: number | null = null;
        const vol = (b: IndicatorBar): number =>
          typeof b.volume === 'number' && Number.isFinite(b.volume) ? b.volume : 0;
        return {
          onUpdate: (bar) => {
            const day = dayOf(bar.time);
            if (session !== day) {
              pv.reset();
              p2v.reset();
              vv.reset();
              session = day;
            }
            const v = vol(bar);
            const p = priceOf(bar, 'hlc3');
            pv.add(p * v);
            p2v.add(p * p * v);
            vv.add(v);
            return montar(pv.value(), p2v.value(), vv.value());
          },
          onPreview: (bar) => {
            const day = dayOf(bar.time);
            const v = vol(bar);
            const p = priceOf(bar, 'hlc3');
            if (session !== day) {
              // A barra abriria a sessao: a VWAP e ela mesma e o desvio e 0 (uma
              // unica observacao nao tem dispersao). Bandas colam na VWAP — nao
              // sao null, porque o valor E conhecido: e o proprio preco.
              return v > 0 ? { upper: p, value: p, lower: p } : vazio;
            }
            return montar(pv.value() + p * v, p2v.value() + p * p * v, vv.value() + v);
          },
          onReset: () => {
            pv.reset();
            p2v.reset();
            vv.reset();
            session = null;
          },
        };
      });
    },
  };
})();
