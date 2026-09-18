/**
 * range-oscillators — osciladores que respondem a perguntas que o RSI nao responde.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE CADA UM ACRESCENTA, E POR QUE NAO E REDUNDANTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este pacote ja tinha RSI, Stochastic, CCI, Williams %R, ROC e Momentum. Acrescentar mais um
 * oscilador de momento seria ruido. Os daqui respondem perguntas DISTINTAS:
 *
 *   PPO       — MACD em PERCENTUAL. A unica diferenca que importa: MACD nao e comparavel entre
 *               ativos de precos diferentes; PPO e.
 *   Stoch RSI — "o RSI esta esticado DENTRO da propria faixa recente?". Um RSI de 60 pode ser o
 *               maximo das ultimas 14 barras (esticado) ou o meio (neutro), e o RSI nao distingue.
 *   UO        — momento em TRES janelas ao mesmo tempo, para nao depender de um periodo.
 *   Aroon     — "quantas barras desde a maxima/minima da janela?" — mede TEMPO, nao preco. E o
 *               unico aqui que responde "ha quanto tempo o mercado nao faz um topo novo".
 *   Choppiness— "isto e tendencia ou range?" — e um MEDIDOR DE REGIME, nao de direcao. Diz quando
 *               nao usar os outros.
 *   Vortex    — direcao pela relacao entre o range da barra e a distancia ao extremo anterior.
 *   BOP       — quem ganhou a barra POR DENTRO dela (onde fechou face ao range). Nao precisa de
 *               historico nenhum, e por isso e o unico sem aquecimento.
 *   ADL       — a linha de acumulacao/distribuicao: volume pesado por onde o preco fechou no
 *               range. E o irmao do OBV que usa a POSICAO do fechamento em vez do sinal dele.
 *   Force     — variacao de preco VEZES volume: a "forca" de cada barra, suavizada.
 *   Elder Ray — o quanto a maxima e a minima da barra se afastam de uma EMA: pressao de compra e
 *               de venda separadas, em vez de somadas num numero so.
 *
 * ⚠️ Todos incrementais e O(1) por barra, como o contrato exige.
 */

import {
  numParam,
  priceOf,
  SOURCE_PARAM_SPEC,
  sourceParam,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type ParamSpec,
} from '../contracts.js';
import {
  EmaState,
  MinMaxWindow,
  RingWindow,
  SmaState,
  TrueRangeState,
  WilderState,
} from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

const periodSpec = (def: number, name = 'period', label = 'Período'): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

/**
 * ⭐ A especificacao CANONICA de fonte de preco, reusada e nao copiada.
 *
 * ⚠️ Duas bancadas pegaram a copia local que eu havia escrito: uma reprova parametro `source`
 * sem `options` (a interface nao teria de onde montar o seletor) e outra reprova lista de opcoes
 * DIVERGENTE da canonica. Reusar e o unico jeito de as duas nunca mais reprovarem.
 */
const sourceSpec: ParamSpec = SOURCE_PARAM_SPEC;

/** Volume utilizavel: ausente, nao-finito ou negativo conta como 0. */
function volOf(bar: IndicatorBar): number {
  const v = bar.volume;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// PPO — Percentage Price Oscillator
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `PPO = 100 · (EMA_rapida − EMA_lenta) / EMA_lenta`, com sinal e histograma.
 *
 * ⭐ E o MACD dividido pela media lenta. A diferenca parece cosmetica e nao e: o MACD do WIN
 * (130 mil pontos) vive na casa das centenas, e o da PETR4 (32 reais) na casa dos centesimos.
 * Nenhum limiar serve para os dois, e nenhum histograma pode ser comparado. O PPO e em
 * percentual, entao "PPO de +0,8%" significa a mesma coisa em qualquer ativo — e e o que permite
 * varrer uma carteira com um criterio unico.
 *
 * ⚠️ `EMA_lenta === 0` devolve `null`. Acontece se alguem alimentar o PPO com uma serie centrada
 * em zero; dividir daria Infinity e o plotter desenharia uma agulha.
 */
export const ppoFactory: IndicatorFactory = (() => {
  const fastSpec = periodSpec(12, 'fast', 'Rápida');
  const slowSpec = periodSpec(26, 'slow', 'Lenta');
  const signalSpec = periodSpec(9, 'signal', 'Sinal');
  const specs: readonly ParamSpec[] = [fastSpec, slowSpec, signalSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'ppo',
    label: 'PPO (MACD em %)',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'value', label: 'PPO', plot: 'line', pane: 'separate', referenceLines: [0] },
      { key: 'signal', label: 'Sinal', plot: 'line', pane: 'separate', color: '#fbbf24' },
      { key: 'hist', label: 'Histograma', plot: 'histogram', pane: 'separate' },
    ],
    dependencies: ['ema'],
    warmup: (p) =>
      Math.max(1, Math.round(numParam(p, slowSpec))) + Math.max(1, Math.round(numParam(p, signalSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const f = Math.max(1, Math.round(numParam(merged, fastSpec)));
      const l = Math.max(1, Math.round(numParam(merged, slowSpec)));
      const sN = Math.max(1, Math.round(numParam(merged, signalSpec)));
      const fonte = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const rapida = new EmaState(f);
        const lenta = new EmaState(l);
        const sinal = new EmaState(sN);
        const calc = (
          a: number | null,
          b: number | null,
          mutar: boolean,
        ): { value: number | null; signal: number | null; hist: number | null } => {
          if (a === null || b === null || b === 0) return { value: null, signal: null, hist: null };
          const v = (100 * (a - b)) / b;
          const s = mutar ? sinal.push(v) : sinal.peek(v);
          return { value: v, signal: s, hist: s === null ? null : v - s };
        };
        return {
          onUpdate: (bar) => {
            const x = priceOf(bar, fonte);
            // ⚠️ As duas SEMPRE consomem: curto-circuitar a lenta a deixaria eternamente
            // aquecendo.
            return calc(rapida.push(x), lenta.push(x), true);
          },
          onPreview: (bar) => {
            const x = priceOf(bar, fonte);
            return calc(rapida.peek(x), lenta.peek(x), false);
          },
          onReset: () => {
            rapida.reset();
            lenta.reset();
            sinal.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// Stochastic RSI
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O Stochastic aplicado ao RSI: onde o RSI esta DENTRO da propria faixa recente.
 *
 * ⭐⭐ Responde o que o RSI nao responde. Um RSI de 60 pode ser o MAXIMO das ultimas 14 barras
 * (esticado, prestes a corrigir) ou o meio de uma faixa de 40 a 80 (neutro). O RSI diz 60 nos
 * dois casos; o Stoch RSI diz 100 no primeiro e 50 no segundo.
 *
 * ⚠️ `%K` e a estocastica CRUA suavizada por `smoothK`, e `%D` e a media de `%K` — a mesma
 * cascata do Stochastic classico. Sem `smoothK` o indicador salta entre 0 e 100 e nao se lê.
 *
 * ⚠️ Faixa DEGENERADA (RSI constante na janela: `max === min`) devolve `null`, nao 50. "Nao houve
 * variacao a normalizar" nao e "esta no meio".
 *
 * ⚠️ O RSI interno usa Wilder (a mesma `WilderState` do RSI deste pacote, via EMA de razao 1/n),
 * e nao EMA comum: um Stoch RSI construido sobre um RSI diferente do nosso daria dois valores
 * diferentes para o mesmo nome na mesma tela.
 */
export const stochRsiFactory: IndicatorFactory = (() => {
  const rsiSpec = periodSpec(14, 'rsiPeriod', 'RSI');
  const stochSpec = periodSpec(14, 'stochPeriod', 'Estocástica');
  const kSpec = periodSpec(3, 'smoothK', 'Suavizar %K');
  const dSpec = periodSpec(3, 'smoothD', 'Suavizar %D');
  const specs: readonly ParamSpec[] = [rsiSpec, stochSpec, kSpec, dSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'stoch_rsi',
    label: 'Stochastic RSI',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'k', label: '%K', plot: 'line', pane: 'separate', referenceLines: [20, 80] },
      { key: 'd', label: '%D', plot: 'line', pane: 'separate', color: '#fbbf24' },
    ],
    dependencies: ['rsi', 'stochastic'],
    warmup: (p) =>
      Math.max(1, Math.round(numParam(p, rsiSpec))) +
      Math.max(1, Math.round(numParam(p, stochSpec))) +
      Math.max(1, Math.round(numParam(p, kSpec))) +
      Math.max(1, Math.round(numParam(p, dSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const nRsi = Math.max(1, Math.round(numParam(merged, rsiSpec)));
      const nStoch = Math.max(1, Math.round(numParam(merged, stochSpec)));
      const nK = Math.max(1, Math.round(numParam(merged, kSpec)));
      const nD = Math.max(1, Math.round(numParam(merged, dSpec)));
      const fonte = sourceParam(merged, sourceSpec);

      return buildInstance(meta, merged, () => {
        // ⭐⭐ CORRIGIDO em 18/09/2026: era `EmaState(2·nRsi − 1)`, com o comentário "RSI de
        // Wilder, escrito em termos de EMA de razão 1/n". A RAZÃO estava certa
        // (`2/((2n−1)+1) = 1/n`); a SEMENTE, não — e a semente é metade da definição.
        //
        // ⚠️ `EmaState(27)` semeia com a média dos 27 primeiros ganhos; `WilderState(14)` semeia
        // com a média dos 14 primeiros. Dois efeitos, os dois medidos numa série de 60 barras:
        //
        //   1. O RSI interno era um NÚMERO DIFERENTE do que `rsiFactory` publica no mesmo
        //      gráfico. O operador sobrepõe os dois; um Stoch RSI que normaliza um RSI que não é
        //      o RSI da tela é indefensável, e a divergência é invisível (os dois oscilam em
        //      0–100 e passam por "suavização diferente").
        //   2. A primeira emissão de %K caía no índice **42** em vez de **29** — treze barras de
        //      atraso desnecessário, que em 15 min é mais de três horas de pregão sem indicador.
        //
        // ⭐ Agora é literalmente a mesma primitiva que `RsiLogic` usa. Consistência dentro do
        // pacote não é elegância: é o que permite ao operador ler os dois juntos.
        const ganhos = new WilderState(nRsi);
        const perdas = new WilderState(nRsi);
        const faixa = new MinMaxWindow(nStoch);
        const suavK = new SmaState(nK);
        const suavD = new SmaState(nD);
        let anterior: number | null = null;

        const rsiDe = (x: number, mutar: boolean): number | null => {
          if (anterior === null) {
            if (mutar) anterior = x;
            return null;
          }
          const d = x - anterior;
          const g = d > 0 ? d : 0;
          const p = d < 0 ? -d : 0;
          const mg = mutar ? ganhos.push(g) : ganhos.peek(g);
          const mp = mutar ? perdas.push(p) : perdas.peek(p);
          if (mutar) anterior = x;
          if (mg === null || mp === null) return null;
          const total = mg + mp;
          // Sem variacao alguma na janela: o RSI e indefinido. `null`, nao 50.
          if (!(total > 0)) return null;
          return (100 * mg) / total;
        };

        const passo = (
          x: number,
          mutar: boolean,
        ): { k: number | null; d: number | null } => {
          const rsi = rsiDe(x, mutar);
          if (rsi === null) return { k: null, d: null };
          const mm = mutar ? faixa.push(rsi) : faixa.peek(rsi);
          if (mm === null) return { k: null, d: null };
          const amplitude = mm.max - mm.min;
          if (!(amplitude > 0)) return { k: null, d: null };
          const cru = (100 * (rsi - mm.min)) / amplitude;
          const k = mutar ? suavK.push(cru) : suavK.peek(cru);
          if (k === null) return { k: null, d: null };
          return { k, d: mutar ? suavD.push(k) : suavD.peek(k) };
        };

        return {
          onUpdate: (bar) => passo(priceOf(bar, fonte), true),
          onPreview: (bar) => passo(priceOf(bar, fonte), false),
          onReset: () => {
            ganhos.reset();
            perdas.reset();
            faixa.reset();
            suavK.reset();
            suavD.reset();
            anterior = null;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// AROON — quanto TEMPO desde o extremo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `AroonUp = 100 · (n − barras desde a maxima) / n`, e o espelho para baixo.
 *
 * ⭐⭐ E o unico indicador deste pacote que mede TEMPO, e nao preco. A pergunta que ele responde
 * — *"ha quantas barras o mercado nao faz uma maxima nova?"* — nao esta em nenhum outro: RSI,
 * MACD e ADX olham magnitude. Aroon Up caindo com o preco lateral significa que a alta perdeu a
 * capacidade de fazer topo novo, e isso aparece ANTES de o preco cair.
 *
 * ⚠️ Precisa do INDICE do extremo, e nao so do valor — por isso NAO usa `MinMaxWindow` (que
 * devolve min/max sem posicao) e mantem as janelas de maxima e minima em `RingWindow`, varrendo
 * `n` posicoes por barra.
 *
 * ⚠️⚠️ **Esta é a UNICA excecao de custo do pacote: O(n) por barra, e nao O(1).** Ela e declarada
 * porque a alternativa seria uma estrutura de deque monotonico com indices — correta, mas
 * bastante mais codigo para um `n` que em uso real e 14 ou 25. Com `n = 25`, sao 25 comparacoes
 * por barra; a serie de 18 anos de 5min do WIN tem ~1,3 milhao de barras, e isso e um laco de 32
 * milhoes de comparacoes numa recarga completa — mensuravel e aceitavel. ⭐ Se o `n` tipico
 * subir, o deque monotonico e o caminho.
 */
export const aroonFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(25);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'aroon',
    label: 'Aroon',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'up', label: 'Aroon Up', plot: 'line', pane: 'separate', referenceLines: [30, 70] },
      { key: 'down', label: 'Aroon Down', plot: 'line', pane: 'separate', color: '#f472b6' },
      // ⭐ A OSCILACAO (up − down) sai junto porque e a leitura direta de quem manda, e derivar
      // no consumidor exigiria que ele soubesse a formula.
      { key: 'osc', label: 'Oscilador', plot: 'histogram', pane: 'separate', referenceLines: [0] },
    ],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const maximas = new RingWindow(n);
        const minimas = new RingWindow(n);

        /** Aroon a partir das janelas, com `extraHigh/extraLow` projetados (preview). */
        const calcular = (
          extraHigh: number | null,
          extraLow: number | null,
        ): { up: number | null; down: number | null; osc: number | null } => {
          const hs: number[] = [];
          const ls: number[] = [];
          maximas.forEach((v) => hs.push(v));
          minimas.forEach((v) => ls.push(v));
          if (extraHigh !== null && extraLow !== null) {
            // A projecao entra no FIM e o mais antigo sai, se a janela estiver cheia.
            if (hs.length >= n) hs.shift();
            if (ls.length >= n) ls.shift();
            hs.push(extraHigh);
            ls.push(extraLow);
          }
          if (hs.length < n || ls.length < n) return { up: null, down: null, osc: null };
          // ⚠️ `>=` na comparacao: com empate, vence o MAIS RECENTE. E a convencao (uma maxima
          // reencostada conta como maxima nova) e a diferenca aparece justamente em topo duplo.
          let iMax = 0;
          let iMin = 0;
          for (let i = 1; i < n; i += 1) {
            if ((hs[i] as number) >= (hs[iMax] as number)) iMax = i;
            if ((ls[i] as number) <= (ls[iMin] as number)) iMin = i;
          }
          const desdeMax = n - 1 - iMax;
          const desdeMin = n - 1 - iMin;
          const up = (100 * (n - desdeMax)) / n;
          const down = (100 * (n - desdeMin)) / n;
          return { up, down, osc: up - down };
        };

        return {
          onUpdate: (bar) => {
            maximas.push(bar.high);
            minimas.push(bar.low);
            return calcular(null, null);
          },
          onPreview: (bar) => calcular(bar.high, bar.low),
          onReset: () => {
            maximas.reset();
            minimas.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// CHOPPINESS INDEX — tendencia ou range?
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `CHOP = 100 · log10(Σ ATR1 / (maxHigh − minLow)) / log10(n)`, em 0..100.
 *
 * ⭐⭐ E um MEDIDOR DE REGIME, nao de direcao — e por isso ele diz quando NAO usar os outros.
 * Alto (acima de ~61) significa que o preco percorreu muito caminho para ir a pouca distancia:
 * lateralizacao, onde cruzamento de media chicoteia. Baixo (abaixo de ~38) significa movimento
 * eficiente: tendencia, onde seguir tendencia funciona.
 *
 * ⭐ A razao "caminho percorrido / distancia liquida" e a MESMA ideia do `ER` da KAMA. A diferenca
 * e que a KAMA usa isso para se adaptar por dentro, e o CHOP publica o numero para o operador
 * decidir. Ter os dois nao e redundancia: um age, o outro informa.
 *
 * ⚠️ `log10(n)` no denominador NORMALIZA para 0..100 independente da janela — sem isso o valor
 * mudaria de faixa a cada troca de periodo e nenhum limiar serviria.
 *
 * ⚠️ Amplitude zero (todas as barras no mesmo preco) devolve `null`: divisao por zero, e "nao
 * houve movimento" nao e "range maximo".
 */
export const choppinessFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(14);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'chop',
    label: 'Choppiness (regime)',
    category: 'volatility',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: 'CHOP',
        plot: 'line',
        pane: 'separate',
        // 38,2 e 61,8 sao os limiares publicados (e sim, sao Fibonacci — a escolha e do autor
        // do indicador, nao nossa).
        referenceLines: [38.2, 61.8],
      },
    ],
    dependencies: ['atr'],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const logN = Math.log10(Math.max(2, n));
      return buildInstance(meta, merged, () => {
        const tr = new TrueRangeState();
        const mediaTr = new SmaState(n);
        const altas = new MinMaxWindow(n);
        const baixas = new MinMaxWindow(n);
        const calc = (
          somaTr: number | null,
          a: { min: number; max: number } | null,
          b: { min: number; max: number } | null,
        ): number | null => {
          if (somaTr === null || a === null || b === null) return null;
          const amplitude = a.max - b.min;
          if (!(amplitude > 0) || !(somaTr > 0)) return null;
          // `mediaTr · n` e a SOMA dos true ranges — razao de medias sobre a mesma janela.
          const razao = (somaTr * n) / amplitude;
          if (!(razao > 0)) return null;
          return (100 * Math.log10(razao)) / logN;
        };
        return {
          onUpdate: (bar) => {
            const t = tr.push(bar.high, bar.low, bar.close);
            const mt = mediaTr.push(t);
            return { value: calc(mt, altas.push(bar.high), baixas.push(bar.low)) };
          },
          onPreview: (bar) => {
            const t = tr.peek(bar.high, bar.low);
            const mt = mediaTr.peek(t);
            return { value: calc(mt, altas.peek(bar.high), baixas.peek(bar.low)) };
          },
          onReset: () => {
            tr.reset();
            mediaTr.reset();
            altas.reset();
            baixas.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// BOP — Balance of Power
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `BOP = (close − open) / (high − low)`, em −1..+1, com media opcional.
 *
 * ⭐ O unico indicador do pacote SEM aquecimento: ele le uma barra e nada mais. A pergunta e
 * *"por dentro desta barra, quem ganhou?"* — fechou perto da maxima (comprador dominou) ou perto
 * da minima (vendedor dominou), normalizado pelo range da propria barra.
 *
 * ⭐ E o complemento natural do delta: o delta diz quem AGREDIU, o BOP diz quem MANDOU no preco.
 * Delta positivo com BOP negativo e absorcao — o comprador agrediu e nao levou o preco.
 *
 * ⚠️ `high === low` (barra sem range, comum em leilao ou ativo ilíquido) devolve `null`. Zero ali
 * significaria equilibrio, e o que houve foi ausencia de disputa.
 */
export const bopFactory: IndicatorFactory = (() => {
  const smoothSpec = periodSpec(14, 'smooth', 'Média');
  const specs: readonly ParamSpec[] = [smoothSpec];
  const meta: IndicatorMeta = {
    name: 'bop',
    label: 'Balance of Power',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'value', label: 'BOP', plot: 'histogram', pane: 'separate', referenceLines: [0] },
      { key: 'media', label: 'Média', plot: 'line', pane: 'separate', color: '#22d3ee' },
    ],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, smoothSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const smooth = Math.max(1, Math.round(numParam(merged, smoothSpec)));
      const bopDe = (bar: IndicatorBar): number | null => {
        const range = bar.high - bar.low;
        if (!(range > 0)) return null;
        return (bar.close - bar.open) / range;
      };
      return buildInstance(meta, merged, () => {
        const media = new SmaState(smooth);
        return {
          onUpdate: (bar) => {
            const v = bopDe(bar);
            if (v === null) return { value: null, media: null };
            return { value: v, media: media.push(v) };
          },
          onPreview: (bar) => {
            const v = bopDe(bar);
            if (v === null) return { value: null, media: null };
            return { value: v, media: media.peek(v) };
          },
          onReset: () => media.reset(),
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// ADL — Accumulation / Distribution Line
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `ADL += volume · ((close − low) − (high − close)) / (high − low)`.
 *
 * ⭐ E o irmao do OBV, e a diferenca importa: o OBV soma o volume INTEIRO com o sinal da variacao
 * (fechou acima = +tudo), enquanto o ADL pesa pela POSICAO do fechamento no range. Uma barra que
 * sobe e fecha no meio contribui metade no ADL e integralmente no OBV. Em absorcao — barra que
 * sobe muito e fecha no meio — os dois divergem, e a divergencia e a leitura.
 *
 * ⚠️ Volume ausente contribui ZERO (a linha congela), e nao `null`: assim como no CVD, devolver
 * `null` quebraria a linha em duas e o consumidor leria duas series.
 *
 * ⚠️ `high === low` contribui zero em vez de dividir por zero — barra sem range nao acumula nem
 * distribui.
 */
export const adlFactory: IndicatorFactory = (() => {
  const specs: readonly ParamSpec[] = [];
  const meta: IndicatorMeta = {
    name: 'adl',
    label: 'Acumulação/Distribuição (ADL)',
    category: 'volume',
    params: specs,
    outputs: [{ key: 'value', label: 'ADL', plot: 'line', pane: 'separate', color: '#a78bfa' }],
    dependencies: [],
    warmup: () => 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const contribuicao = (bar: IndicatorBar): number => {
        const range = bar.high - bar.low;
        if (!(range > 0)) return 0;
        const mfm = (bar.close - bar.low - (bar.high - bar.close)) / range;
        return mfm * volOf(bar);
      };
      return buildInstance(meta, merged, () => {
        let acumulado = 0;
        return {
          onUpdate: (bar) => {
            acumulado += contribuicao(bar);
            return { value: acumulado };
          },
          onPreview: (bar) => ({ value: acumulado + contribuicao(bar) }),
          onReset: () => {
            acumulado = 0;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// FORCE INDEX
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `Force = (close − close[1]) · volume`, suavizado por EMA.
 *
 * ⭐ Junta as tres coisas que definem um movimento — DIRECAO, MAGNITUDE e VOLUME — num numero. A
 * leitura pratica: alta com Force crescendo e alta comprada; alta com Force caindo e alta sem
 * participacao, que costuma devolver.
 *
 * ⚠️ Sem volume o indicador seria identicamente zero, o que pareceria "sem forca". Devolve `null`
 * nesse caso, pelo mesmo motivo do MFI: ausencia de dado nao e leitura de mercado.
 *
 * ⚠️ EMA e nao SMA: o Force cru e dominado por barras excepcionais (volume de leilao vezes um
 * gap), e a janela da SMA carregaria essa barra por `n` periodos e depois a expulsaria num
 * degrau. A EMA a dilui progressivamente.
 */
export const forceIndexFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(13);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'force_index',
    label: 'Force Index',
    category: 'volume',
    params: specs,
    outputs: [
      { key: 'value', label: 'Force', plot: 'histogram', pane: 'separate', referenceLines: [0] },
    ],
    dependencies: ['ema'],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const ema = new EmaState(n);
        let anterior: number | null = null;
        const bruto = (bar: IndicatorBar): number | null => {
          if (anterior === null) return null;
          const vol = volOf(bar);
          if (!(vol > 0)) return null;
          return (bar.close - anterior) * vol;
        };
        return {
          onUpdate: (bar) => {
            const f = bruto(bar);
            anterior = bar.close;
            if (f === null) return { value: null };
            return { value: ema.push(f) };
          },
          onPreview: (bar) => {
            const f = bruto(bar);
            if (f === null) return { value: null };
            return { value: ema.peek(f) };
          },
          onReset: () => {
            ema.reset();
            anterior = null;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// ELDER RAY — pressao de compra e de venda, SEPARADAS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `BullPower = high − EMA`, `BearPower = low − EMA`.
 *
 * ⭐⭐ O valor esta em NAO somar os dois. Quase todo oscilador entrega um numero liquido, e um
 * numero liquido perde a informacao de que compra e venda podem estar fortes AO MESMO TEMPO
 * (barra de range amplo, os dois lados brigando). Aqui a leitura e o par: BullPower alto com
 * BearPower muito negativo e briga; BullPower alto com BearPower perto de zero e dominio.
 *
 * ⚠️ As duas saidas ficam no MESMO painel separado, em histograma. A magnitude e em PRECO
 * (distancia da maxima a media), entao plotar sobre as velas as esconderia colado no preco.
 */
export const elderRayFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(13);
  const specs: readonly ParamSpec[] = [pSpec];
  const meta: IndicatorMeta = {
    name: 'elder_ray',
    label: 'Elder Ray (touro/urso)',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'bull', label: 'Bull Power', plot: 'histogram', pane: 'separate', referenceLines: [0] },
      { key: 'bear', label: 'Bear Power', plot: 'histogram', pane: 'separate', color: '#f472b6' },
    ],
    dependencies: ['ema'],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      return buildInstance(meta, merged, () => {
        const ema = new EmaState(n);
        return {
          onUpdate: (bar) => {
            const m = ema.push(bar.close);
            if (m === null) return { bull: null, bear: null };
            return { bull: bar.high - m, bear: bar.low - m };
          },
          onPreview: (bar) => {
            const m = ema.peek(bar.close);
            if (m === null) return { bull: null, bear: null };
            return { bull: bar.high - m, bear: bar.low - m };
          },
          onReset: () => ema.reset(),
        };
      });
    },
  };
})();
