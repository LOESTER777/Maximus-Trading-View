/**
 * flow-oscillators — osciladores em faixa propria que leem FLUXO, nao so preco.
 *
 *   MFI — Money Flow Index: RSI ponderado por volume, 0..100.
 *   CMF — Chaikin Money Flow: onde o fechamento cai no range, pesado por volume.
 *   AO  — Awesome Oscillator: SMA5 - SMA34 do ponto medio. (sem volume, mas e
 *         oscilador de histograma e mora melhor aqui que entre as medias)
 *
 * ⚠️ MFI e CMF dependem de VOLUME. Volume ausente e legitimo no contrato (forex
 * raramente traz volume confiavel) e nesse caso os dois sao INDEFINIDOS -> null,
 * nunca zero. Zero num oscilador de fluxo significa "fluxo equilibrado", que e uma
 * leitura de mercado; "nao ha volume" nao e leitura nenhuma. Confundir os dois
 * desenharia uma linha de equilibrio perfeito num ativo sobre o qual nao se sabe
 * nada.
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
import { SmaState } from '../rolling.core.js';
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

/** Volume utilizavel da barra: ausente ou nao-finito conta como 0. */
function volOf(bar: IndicatorBar): number {
  return typeof bar.volume === 'number' && Number.isFinite(bar.volume) ? bar.volume : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// MFI — Money Flow Index
// ═════════════════════════════════════════════════════════════════════════════

/**
 * MFI = 100 * fluxoPositivo / (fluxoPositivo + fluxoNegativo), na janela de N.
 *
 *     preco tipico = hlc3
 *     fluxo bruto  = preco tipico * volume
 *     positivo se o preco tipico SUBIU face a barra anterior, negativo se caiu
 *
 * ⚠️ USA hlc3, nao o fechamento — e a definicao. E compara o preco TIPICO com o
 * tipico anterior, nao fechamento com fechamento: uma barra pode fechar em baixa e
 * ainda assim ter preco tipico maior que o da anterior.
 *
 * ⚠️ Barra com preco tipico IGUAL ao anterior nao conta para nenhum dos lados —
 * nao e "positivo por empate". O fluxo dela simplesmente nao entra, e a janela
 * conta essa barra com zero nos dois acumuladores.
 *
 * ⚠️ A formula publicada e `100 - 100/(1+razao)` com `razao = pos/neg`. E a MESMA
 * expressao que `100*pos/(pos+neg)`, algebricamente, e esta segunda forma nao
 * divide por zero quando nao houve nenhuma queda na janela — caso em que a
 * publicada da Infinity e precisa de um caso especial. Escolhida a forma total.
 *
 * ⚠️ Precisa de N+1 barras: os fluxos vem de PARES de barras, como as variacoes
 * do RSI.
 *
 * ⭐ Usa `SmaState` (media rolante) em vez de soma rolante nos dois acumuladores:
 * o MFI e uma RAZAO entre os dois, e razao de medias sobre a mesma janela e igual
 * a razao das somas. Ganha-se de graca o `peek` estavel (Kahan) que o `SmaState`
 * ja tem, sem escrever um segundo acumulador de soma com janela.
 */
class MfiLogic {
  private readonly pos: SmaState;
  private readonly neg: SmaState;
  private prevTp: number | null = null;

  constructor(period: number) {
    this.pos = new SmaState(period);
    this.neg = new SmaState(period);
  }

  private mfiFrom(p: number | null, n: number | null): number | null {
    if (p === null || n === null) return null;
    const total = p + n;
    // Sem fluxo algum na janela (sem volume, ou preco tipico constante): o indice
    // e indefinido. null, nao 50 — nao ha equilibrio a reportar, ha ausencia.
    if (!(total > 0)) return null;
    return (100 * p) / total;
  }

  update(bar: IndicatorBar): number | null {
    const tp = priceOf(bar, 'hlc3');
    if (this.prevTp === null) {
      this.prevTp = tp;
      return null; // primeira barra: nao ha variacao de preco tipico
    }
    const fluxo = tp * volOf(bar);
    const sobe = tp > this.prevTp ? fluxo : 0;
    const desce = tp < this.prevTp ? fluxo : 0;
    this.prevTp = tp;
    const p = this.pos.push(sobe);
    const n = this.neg.push(desce);
    return this.mfiFrom(p, n);
  }

  preview(bar: IndicatorBar): number | null {
    const tp = priceOf(bar, 'hlc3');
    if (this.prevTp === null) return null;
    const fluxo = tp * volOf(bar);
    const sobe = tp > this.prevTp ? fluxo : 0;
    const desce = tp < this.prevTp ? fluxo : 0;
    return this.mfiFrom(this.pos.peek(sobe), this.neg.peek(desce));
  }

  reset(): void {
    this.pos.reset();
    this.neg.reset();
    this.prevTp = null;
  }
}

export const mfiFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 14);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'mfi',
    label: 'Indice de Fluxo de Dinheiro (MFI)',
    category: 'volume',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: 'MFI',
        plot: 'line',
        pane: 'separate',
        // 20/80, nao 30/70 do RSI: o MFI e mais volatil por causa do peso do
        // volume, e os extremos convencionados sao mais afastados.
        referenceLines: [20, 80],
      },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const m = new MfiLogic(period);
        return {
          onUpdate: (bar) => ({ value: m.update(bar) }),
          onPreview: (bar) => ({ value: m.preview(bar) }),
          onReset: () => m.reset(),
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// CMF — Chaikin Money Flow
// ═════════════════════════════════════════════════════════════════════════════

/**
 * CMF = soma(volumeDeFluxo, N) / soma(volume, N), com
 *
 *     multiplicador = ((close - low) - (high - close)) / (high - low)
 *     volumeDeFluxo = multiplicador * volume
 *
 * O multiplicador vale +1 se a barra fecha na maxima, -1 se fecha na minima, 0 no
 * meio — ou seja, mede ONDE dentro do range o fechamento caiu. O CMF e a media
 * dessa posicao pesada por volume, e vive em -1..+1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ QUAL DEFINICAO DE "CHAIKIN" ESTA AQUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Marc Chaikin da nome a TRES indicadores diferentes, e "Chaikin" sozinho e
 * ambiguo:
 *
 *   (a) ⭐ IMPLEMENTADO — **Chaikin Money Flow (CMF)**, janela de 20: a razao de
 *       somas acima. Oscilador LIMITADO em -1..+1, com zero significativo (acima
 *       de zero = pressao compradora), O(1) com janela rolante e sem acumulador
 *       eterno.
 *
 *   (b) NAO implementado — **Oscilador de Chaikin** = EMA(3, ADL) - EMA(10, ADL),
 *       onde ADL e a Linha de Acumulacao/Distribuicao (o volume de fluxo somado
 *       desde sempre). Preterido porque depende de um acumulador ETERNO: o valor
 *       da ADL — e portanto do oscilador nas primeiras barras — muda conforme
 *       QUANTO historico foi alimentado. Dois graficos do mesmo ativo com janelas
 *       de historico diferentes mostrariam osciladores diferentes, e isso e
 *       confuso de explicar e pior de conferir. O CMF, sendo janela fixa, nao tem
 *       esse problema.
 *
 *   (c) NAO implementado — **Volatilidade de Chaikin**, que nem usa volume.
 *
 * ⚠️ Barra sem range (high == low, mercado travado ou tick unico) daria divisao
 * por zero; o multiplicador e 0 nesse caso. Nao e arbitrario: sem range nao ha
 * "onde dentro do range", entao a barra nao vota — e 0 e o voto neutro.
 *
 * ⚠️ Janela sem volume nenhum -> denominador 0 -> null, nao zero (ver cabecalho).
 *
 * ⭐ Mesmo truque do MFI: `SmaState` nos dois acumuladores, porque o CMF e uma
 * razao e razao de medias == razao de somas na mesma janela.
 */
export const cmfFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo', 20);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'cmf',
    label: 'Fluxo de Dinheiro de Chaikin (CMF)',
    category: 'volume',
    params: specs,
    outputs: [
      { key: 'value', label: 'CMF', plot: 'line', pane: 'separate', referenceLines: [-0.05, 0, 0.05] },
    ],
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      /** Volume de fluxo da barra: posicao do fechamento no range, x volume. */
      const fluxoDe = (bar: IndicatorBar): number => {
        const range = bar.high - bar.low;
        if (!(range > 0)) return 0;
        const mult = (2 * bar.close - bar.high - bar.low) / range;
        return mult * volOf(bar);
      };
      const cmfDe = (f: number | null, v: number | null): number | null => {
        if (f === null || v === null || !(v > 0)) return null;
        return f / v;
      };
      return buildInstance(meta, merged, () => {
        const fluxo = new SmaState(period);
        const volume = new SmaState(period);
        return {
          onUpdate: (bar) => ({ value: cmfDe(fluxo.push(fluxoDe(bar)), volume.push(volOf(bar))) }),
          onPreview: (bar) => ({ value: cmfDe(fluxo.peek(fluxoDe(bar)), volume.peek(volOf(bar))) }),
          onReset: () => {
            fluxo.reset();
            volume.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// AO — Awesome Oscillator
// ═════════════════════════════════════════════════════════════════════════════

/**
 * AO = SMA(hl2, 5) - SMA(hl2, 34), de Bill Williams.
 *
 * ⚠️ Sobre o PONTO MEDIO `(high+low)/2`, nao sobre o fechamento. Williams e
 * explicito nisso: o ponto medio representa o "centro de gravidade" da barra e nao
 * sofre do vies de fechamento (leilao, ultimo tick). Implementar com `close` da
 * uma serie parecida e errada por definicao — e o desvio mais comum de
 * implementacao do AO.
 *
 * ⚠️ As DUAS SMAs sao simples, nao exponenciais, e sao 5 e 34 por definicao
 * (numeros de Fibonacci, na escolha de Williams). Ficam parametrizaveis para quem
 * quiser experimentar, mas o default e o canonico.
 *
 * ⚠️ COR DO HISTOGRAMA: o AO classico pinta a barra de VERDE quando o valor subiu
 * face a barra anterior e VERMELHO quando caiu — a cor codifica a DERIVADA, nao o
 * sinal. O `OutputSpec` deste pacote carrega uma `color` unica e estatica, entao a
 * pintura barra-a-barra e responsabilidade de quem plota: ela e derivavel da
 * propria serie (compara o ponto com o anterior), sem dado extra do indicador. Nao
 * inventamos uma saida `cor` para isso — cor nao e valor de indicador, e o
 * consumidor tem tudo de que precisa.
 */
export const awesomeOscillatorFactory: IndicatorFactory = (() => {
  const fastSpec = periodSpec('fast', 'SMA Rapida', 5);
  const slowSpec = periodSpec('slow', 'SMA Lenta', 34);
  const specs: readonly ParamSpec[] = [fastSpec, slowSpec];
  const meta: IndicatorMeta = {
    name: 'ao',
    label: 'Awesome Oscillator',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'value', label: 'AO', plot: 'histogram', pane: 'separate', referenceLines: [0] },
    ],
    dependencies: ['sma'],
    // A lenta manda: enquanto ela nao encher, nao ha diferenca a calcular.
    warmup: (p) => Math.max(Math.round(numParam(p, fastSpec)), Math.round(numParam(p, slowSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const fast = Math.max(1, Math.round(numParam(merged, fastSpec)));
      const slow = Math.max(1, Math.round(numParam(merged, slowSpec)));
      const diff = (f: number | null, s: number | null): number | null =>
        f === null || s === null ? null : f - s;
      return buildInstance(meta, merged, () => {
        const rapida = new SmaState(fast);
        const lenta = new SmaState(slow);
        return {
          onUpdate: (bar) => {
            const m = priceOf(bar, 'hl2');
            // ⚠️ As duas SEMPRE consomem, mesmo quando a lenta ainda nao emite —
            // curto-circuitar a lenta a deixaria eternamente aquecendo.
            const f = rapida.push(m);
            const s = lenta.push(m);
            return { value: diff(f, s) };
          },
          onPreview: (bar) => {
            const m = priceOf(bar, 'hl2');
            return { value: diff(rapida.peek(m), lenta.peek(m)) };
          },
          onReset: () => {
            rapida.reset();
            lenta.reset();
          },
        };
      });
    },
  };
})();
