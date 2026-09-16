/**
 * trend-following — os que dizem PARA ONDE, e onde fica o stop.
 *
 *   SuperTrend — banda de ATR que alterna de lado do preco. Sobre o preco.
 *   Parabolic SAR — parada e reversao de Wilder, com fator de aceleracao.
 *   Ichimoku Kinko Hyo — as cinco linhas do "equilibrio num relance".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ O PADRAO DESTE ARQUIVO: ESTADO IMUTAVEL + PASSO PURO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SuperTrend e SAR sao os primeiros indicadores do pacote com estado
 * PATH-DEPENDENT de verdade: a saida de hoje depende da DIRECAO em que o
 * indicador estava ontem, que dependia da de anteontem. Nao ha janela para
 * recalcular — o caminho e o estado.
 *
 * Isso torna `preview` perigoso: qualquer atalho que reaproveite o objeto de
 * estado para "espiar" arrisca deixar residuo, e residuo aqui nao e um valor
 * levemente errado — e uma reversao de tendencia fantasma que fica gravada para
 * sempre no estado consolidado.
 *
 * A saida adotada e escrever o passo como FUNCAO PURA sobre um estado IMUTAVEL:
 * `passo(estadoAnterior, barra) -> { estado, valor }`. O `update` guarda o estado
 * devolvido; o `preview` simplesmente o JOGA FORA. Nao existe caminho de codigo
 * onde preview possa mutar, porque preview nao tem o que mutar — a mesma razao
 * pela qual `Drawing` e `readonly` por inteiro no pacote de desenho.
 */

import {
  numParam,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type IndicatorValue,
  type ParamSpec,
} from '../contracts.js';
import { WilderState, TrueRangeState, MinMaxWindow } from '../rolling.core.js';
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
// SuperTrend
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O estado do SuperTrend. `readonly` por inteiro — ver o cabecalho do arquivo.
 *
 * `upper`/`lower` sao as bandas FINAIS (ja travadas), nao as basicas: a travagem
 * e o que impede a linha de recuar contra a tendencia, e ela olha para a banda da
 * barra anterior. `prevClose` existe porque a regra de travagem compara o
 * fechamento ANTERIOR com a banda ANTERIOR, nao o corrente.
 */
interface SuperTrendState {
  readonly upper: number;
  readonly lower: number;
  readonly dir: 1 | -1;
  readonly prevClose: number;
}

/**
 * Um passo do SuperTrend. PURO: nao toca em nada fora dos argumentos.
 *
 * ⚠️ VARIANTE ESCOLHIDA — importa, porque circulam pelo menos tres.
 * Implementada a formulacao que virou de facto padrao (a do Pine do TradingView):
 *
 *     bandaBase superior = hl2 + mult*ATR;  inferior = hl2 - mult*ATR
 *     inferior_final = fechAnterior > inferior_final_anterior
 *                        ? max(inferior, inferior_final_anterior) : inferior
 *     superior_final = fechAnterior < superior_final_anterior
 *                        ? min(superior, superior_final_anterior) : superior
 *     dir = era_baixa && fech > superior_anterior ?  1
 *         : era_alta  && fech < inferior_anterior ? -1
 *         : dir_anterior
 *     SuperTrend = dir alta ? inferior_final : superior_final
 *
 * A variante alternativa compara o fechamento CORRENTE (em vez do anterior) na
 * travagem, e antecipa a reversao em uma barra. Nao e "mais certa" — e outra
 * definicao; ficou a difundida para que os valores conferiveis contra o grafico
 * que o operador ja usa.
 *
 * ⚠️ ARRANQUE: a primeira barra com ATR nao tem direcao anterior, e Wilder nao
 * definiu qual assumir. Adotamos ALTA (`dir = 1`), como as implementacoes
 * difundidas. A escolha e arbitraria e se auto-corrige na primeira rompida de
 * banda; documentada porque explica a unica diferenca possivel contra outra
 * implementacao nas primeiras barras apos o aquecimento.
 */
function superTrendStep(
  prev: SuperTrendState | null,
  bar: IndicatorBar,
  atr: number,
  mult: number,
): { state: SuperTrendState; value: number; dir: 1 | -1 } {
  const hl2 = (bar.high + bar.low) / 2;
  let lower = hl2 - mult * atr;
  let upper = hl2 + mult * atr;
  let dir: 1 | -1 = 1;

  if (prev !== null) {
    if (prev.prevClose > prev.lower) lower = Math.max(lower, prev.lower);
    if (prev.prevClose < prev.upper) upper = Math.min(upper, prev.upper);
    dir =
      prev.dir === -1 && bar.close > prev.upper
        ? 1
        : prev.dir === 1 && bar.close < prev.lower
          ? -1
          : prev.dir;
  }

  const value = dir === 1 ? lower : upper;
  return { state: { upper, lower, dir, prevClose: bar.close }, value, dir };
}

/**
 * SuperTrend: ATR de Wilder + travagem de banda.
 *
 * ⚠️ O ATR aqui e Wilder (`WilderState`), nao EMA — mesma razao do `atrFactory`:
 * o ATR de Wilder usa k=1/period, e trocar por EMA daria uma linha proxima e
 * errada por definicao, deslocando cada reversao em algumas barras.
 *
 * A direcao sai como saida propria em painel SEPARADO. Poderia ir junto no painel
 * do preco, mas +1/-1 ao lado de precos de 5 digitos seria uma linha colada no
 * zero, invisivel: a escala do painel do preco e do preco. Em faixa propria, como
 * histograma, ela e legivel — e o regime de tendencia e informacao que se le
 * melhor como bloco do que como linha.
 */
export const supertrendFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec('period', 'Periodo ATR', 10);
  const mSpec: ParamSpec = {
    name: 'mult',
    label: 'Multiplicador',
    type: 'number',
    default: 3,
    min: 0.1,
    max: 20,
    step: 0.1,
  };
  const specs: readonly ParamSpec[] = [pSpec, mSpec];
  const meta: IndicatorMeta = {
    name: 'supertrend',
    label: 'SuperTrend',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'value', label: 'SuperTrend', plot: 'line', pane: 'price' },
      {
        key: 'direction',
        label: 'Direcao',
        plot: 'histogram',
        pane: 'separate',
        referenceLines: [0],
      },
    ],
    dependencies: ['atr'],
    // O primeiro valor sai na barra em que o ATR de Wilder emite: `period` barras.
    warmup: (p) => Math.round(numParam(p, pSpec)),
  };
  const vazio: IndicatorValue = { value: null, direction: null };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const period = Math.max(1, Math.round(numParam(merged, pSpec)));
      const mult = numParam(merged, mSpec);
      return buildInstance(meta, merged, () => {
        const tr = new TrueRangeState();
        const wilder = new WilderState(period);
        let state: SuperTrendState | null = null;
        return {
          onUpdate: (bar) => {
            const atr = wilder.push(tr.push(bar.high, bar.low, bar.close));
            if (atr === null) return vazio;
            const passo = superTrendStep(state, bar, atr, mult);
            state = passo.state;
            return { value: passo.value, direction: passo.dir };
          },
          onPreview: (bar) => {
            const atr = wilder.peek(tr.peek(bar.high, bar.low));
            if (atr === null) return vazio;
            // O estado devolvido e DESCARTADO — e isto que torna o preview puro.
            const passo = superTrendStep(state, bar, atr, mult);
            return { value: passo.value, direction: passo.dir };
          },
          onReset: () => {
            tr.reset();
            wilder.reset();
            state = null;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// Parabolic SAR
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O estado do SAR. `readonly` por inteiro.
 *
 * `ep` e o ponto extremo (o topo da alta corrente, ou o fundo da baixa); `af` e o
 * fator de aceleracao, que sobe um `step` a cada novo extremo ate `maxAf`.
 * `prevHigh2`/`prevLow2` guardam a ANTEPENULTIMA barra porque a regra de Wilder
 * proibe o SAR de entrar no range das DUAS barras anteriores.
 */
interface SarState {
  readonly isLong: boolean;
  readonly sar: number;
  readonly ep: number;
  readonly af: number;
  readonly prevHigh: number;
  readonly prevLow: number;
  readonly prevHigh2: number | null;
  readonly prevLow2: number | null;
}

/**
 * Um passo do SAR. PURO.
 *
 * A recorrencia de Wilder:
 *
 *     SAR(n+1) = SAR(n) + af * (EP - SAR(n))
 *
 * mais tres regras que a formula sozinha nao diz e que sao onde as
 * implementacoes divergem:
 *
 *   1. ⚠️ O SAR nunca entra no range das DUAS barras anteriores. Sem esse limite,
 *      numa tendencia acelerada o SAR passa por dentro da barra e dispara stop no
 *      meio do movimento que ele deveria acompanhar.
 *   2. ⚠️ Na REVERSAO o SAR salta para o EP (o extremo da tendencia que acabou),
 *      o EP vira o extremo da barra corrente e o `af` volta ao `step`. Zerar o
 *      `af` e o que faz a nova tendencia comecar devagar de novo.
 *   3. ⚠️ O `af` sobe SO quando ha extremo NOVO — nao a cada barra. Subir sempre e
 *      o erro classico, e produz um SAR que colide com o preco cedo demais.
 */
function sarStep(
  prev: SarState,
  bar: IndicatorBar,
  step: number,
  maxAf: number,
): { state: SarState; value: number } {
  let isLong = prev.isLong;
  let ep = prev.ep;
  let af = prev.af;
  let sar = prev.sar + prev.af * (prev.ep - prev.sar);

  if (isLong) {
    // Regra 1: nao pode subir acima do minimo das duas barras anteriores.
    sar = Math.min(sar, prev.prevLow, prev.prevLow2 ?? prev.prevLow);
    if (bar.low < sar) {
      // Regra 2: reversao para baixa.
      isLong = false;
      sar = prev.ep;
      ep = bar.low;
      af = step;
    } else if (bar.high > prev.ep) {
      // Regra 3: extremo novo -> acelera.
      ep = bar.high;
      af = Math.min(maxAf, prev.af + step);
    }
  } else {
    sar = Math.max(sar, prev.prevHigh, prev.prevHigh2 ?? prev.prevHigh);
    if (bar.high > sar) {
      isLong = true;
      sar = prev.ep;
      ep = bar.high;
      af = step;
    } else if (bar.low < prev.ep) {
      ep = bar.low;
      af = Math.min(maxAf, prev.af + step);
    }
  }

  return {
    state: {
      isLong,
      sar,
      ep,
      af,
      prevHigh: bar.high,
      prevLow: bar.low,
      prevHigh2: prev.prevHigh,
      prevLow2: prev.prevLow,
    },
    value: sar,
  };
}

/**
 * Parabolic SAR (parada e reversao) de Wilder.
 *
 * ⚠️ ARRANQUE: Wilder pressupoe que o OPERADOR informa em que tendencia se esta
 * entrando — o indicador nao deduz. Como aqui nao ha operador, a convencao
 * adotada e: a segunda barra decide o lado comparando os dois primeiros
 * fechamentos (subiu = alta), o SAR inicial e o extremo OPOSTO da primeira barra
 * (a minima, se alta) e o EP e o extremo das duas barras no sentido da tendencia.
 * E por isso que o primeiro valor sai na barra 1, nao na 0 — e por isso que o
 * inicio pode divergir de outra implementacao por algumas barras, ate a primeira
 * reversao alinhar os dois.
 *
 * ⚠️ PLOTAGEM: o SAR e classicamente uma NUVEM DE PONTOS, um por barra, e o
 * vocabulario de `plot` do contrato tem linha/histograma/area/banda, nao pontos.
 * Declara `'line'` por ser o mais proximo. Na reversao o valor SALTA de um lado do
 * preco ao outro, e uma linha continua desenha esse salto como um degrau vertical;
 * quem quiser o visual classico deteta a reversao pela troca de lado do SAR face
 * ao preco. Registrado como limitacao conhecida do vocabulario de plotagem, nao
 * como defeito do calculo.
 */
export const parabolicSarFactory: IndicatorFactory = (() => {
  const stepSpec: ParamSpec = {
    name: 'step',
    label: 'Passo',
    type: 'number',
    default: 0.02,
    min: 0.001,
    max: 1,
    step: 0.001,
  };
  const maxSpec: ParamSpec = {
    name: 'max',
    label: 'Aceleracao Maxima',
    type: 'number',
    default: 0.2,
    min: 0.001,
    max: 1,
    step: 0.01,
  };
  const specs: readonly ParamSpec[] = [stepSpec, maxSpec];
  const meta: IndicatorMeta = {
    name: 'psar',
    label: 'SAR Parabolico',
    category: 'trend',
    params: specs,
    outputs: [{ key: 'value', label: 'SAR', plot: 'line', pane: 'price' }],
    // Duas barras: a primeira nao tem direcao, a segunda a estabelece.
    warmup: () => 2,
  };
  const vazio: IndicatorValue = { value: null };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const step = numParam(merged, stepSpec);
      // ⚠️ maxAf abaixo do step deixaria o af preso no arranque; o piso e o step.
      const maxAf = Math.max(step, numParam(merged, maxSpec));
      /** Arranque: monta o primeiro estado a partir das duas primeiras barras. */
      const arrancar = (b0: IndicatorBar, b1: IndicatorBar): SarState => {
        const isLong = b1.close >= b0.close;
        return {
          isLong,
          sar: isLong ? b0.low : b0.high,
          ep: isLong ? Math.max(b0.high, b1.high) : Math.min(b0.low, b1.low),
          af: step,
          prevHigh: b1.high,
          prevLow: b1.low,
          prevHigh2: b0.high,
          prevLow2: b0.low,
        };
      };
      return buildInstance(meta, merged, () => {
        let primeira: IndicatorBar | null = null;
        let state: SarState | null = null;
        return {
          onUpdate: (bar) => {
            if (state === null) {
              if (primeira === null) {
                primeira = bar;
                return vazio; // sem barra anterior nao ha direcao a deduzir
              }
              state = arrancar(primeira, bar);
              return { value: state.sar };
            }
            const passo = sarStep(state, bar, step, maxAf);
            state = passo.state;
            return { value: passo.value };
          },
          onPreview: (bar) => {
            if (state === null) {
              // Barra em formacao que ARRANCARIA o indicador: calcula o arranque
              // e descarta. `primeira` nao e consumida.
              if (primeira === null) return vazio;
              return { value: arrancar(primeira, bar).sar };
            }
            return { value: sarStep(state, bar, step, maxAf).value };
          },
          onReset: () => {
            primeira = null;
            state = null;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// Ichimoku Kinko Hyo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Ichimoku Kinko Hyo — "grafico de equilibrio num relance", de Goichi Hosoda.
 *
 * As cinco linhas, com os periodos classicos (9/26/52, deslocamento 26):
 *
 *   Tenkan-sen  (conversao) = (max(high,9)  + min(low,9))  / 2
 *   Kijun-sen   (base)      = (max(high,26) + min(low,26)) / 2
 *   Senkou A    (leading A) = (Tenkan + Kijun) / 2
 *   Senkou B    (leading B) = (max(high,52) + min(low,52)) / 2
 *   Chikou      (atrasada)  = fechamento
 *
 * ⚠️ NAO e media movel. Cada linha e o PONTO MEDIO DO RANGE da janela (a media
 * entre a maxima e a minima do periodo), nao a media dos fechamentos. Trocar uma
 * pela outra e o erro mais comum de implementacao do Ichimoku, e o resultado
 * parece plausivel — por isso o registro aqui.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ A DECISAO DO DESLOCAMENTO — leia antes de comparar com outro grafico
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O Ichimoku e o unico classico que DESLOCA NO TEMPO: as Senkou sao desenhadas 26
 * barras A FRENTE (formando a "nuvem" no futuro) e a Chikou 26 barras ATRAS. O
 * contrato deste pacote, por outro lado, emite UM valor POR BARRA consumida, e o
 * ponto emitido carrega o `time` daquela barra.
 *
 * Havia duas saidas, e a escolhida foi a PRIMEIRA:
 *
 *   (a) ⭐ ESCOLHIDA — emitir na barra corrente o valor CALCULADO com os dados
 *       ate ela, SEM deslocar, e deixar o deslocamento visual para a plotagem.
 *       O parametro `displacement` fica no meta justamente para que o plotter
 *       saiba quanto deslocar cada saida.
 *
 *   (b) recusada — emitir a Senkou ja alinhada ao futuro. Impossivel sem violar o
 *       contrato: o valor da Senkou A de 26 barras a frente pertence a um `time`
 *       que AINDA NAO EXISTE na serie. O indicador teria de inventar timestamps
 *       futuros (precisaria conhecer o timeframe, que ele nao conhece) ou emitir
 *       um valor que nao corresponde ao `time` do ponto — e a segunda opcao e pior
 *       que nao deslocar, porque MENTE em silencio: o consumidor leria a nuvem
 *       como se fosse do presente e nao teria como saber.
 *
 * A leitura correta de (a), portanto: `senkou_a` no ponto de tempo T e o valor que
 * o grafico classico desenharia em T + 26 barras; `chikou` em T e o que o classico
 * desenha em T - 26. Quem plota aplica o deslocamento; quem le o numero cru sabe,
 * por este comentario, que ele NAO esta deslocado. O calculo e identico as duas
 * formas — o que muda e so onde o pixel cai.
 *
 * ⚠️ Consequencia pratica: a Chikou aqui e literalmente o fechamento da barra.
 * Parece redundante, e e — o valor dela e o cruzamento com o preco de 26 barras
 * atras, que so aparece DEPOIS de deslocada. Mantida como saida propria para que
 * a plotagem tenha a serie pronta, em vez de cada consumidor redescobrir que
 * Chikou == close.
 */
export const ichimokuFactory: IndicatorFactory = (() => {
  const tenkanSpec = periodSpec('tenkan', 'Tenkan-sen', 9);
  const kijunSpec = periodSpec('kijun', 'Kijun-sen', 26);
  const senkouBSpec = periodSpec('senkouB', 'Senkou B', 52);
  const deslocSpec = periodSpec('displacement', 'Deslocamento', 26);
  const specs: readonly ParamSpec[] = [tenkanSpec, kijunSpec, senkouBSpec, deslocSpec];
  const meta: IndicatorMeta = {
    name: 'ichimoku',
    label: 'Ichimoku Kinko Hyo',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'tenkan', label: 'Tenkan-sen', plot: 'line', pane: 'price' },
      { key: 'kijun', label: 'Kijun-sen', plot: 'line', pane: 'price' },
      // ⚠️ Senkou A e B formam a NUVEM (kumo) — a faixa preenchida entre as duas.
      // Marcadas com `band` para o plotter pintar essa faixa, que e a leitura
      // central do indicador. Nao ha `middle`: a nuvem nao tem linha central.
      { key: 'senkou_a', label: 'Senkou Span A', plot: 'line', pane: 'price', band: 'upper' },
      { key: 'senkou_b', label: 'Senkou Span B', plot: 'line', pane: 'price', band: 'lower' },
      { key: 'chikou', label: 'Chikou Span', plot: 'line', pane: 'price' },
    ],
    // A Senkou B e a mais lenta: define quando o conjunto esta completo.
    warmup: (p) =>
      Math.max(
        Math.round(numParam(p, tenkanSpec)),
        Math.round(numParam(p, kijunSpec)),
        Math.round(numParam(p, senkouBSpec)),
      ),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const tenkan = Math.max(1, Math.round(numParam(merged, tenkanSpec)));
      const kijun = Math.max(1, Math.round(numParam(merged, kijunSpec)));
      const senkouB = Math.max(1, Math.round(numParam(merged, senkouBSpec)));
      /** Ponto medio do range, ou null se a janela ainda nao encheu. */
      const meio = (r: { min: number; max: number } | null): number | null =>
        r === null ? null : (r.max + r.min) / 2;
      const montar = (
        t: number | null,
        k: number | null,
        b: number | null,
        close: number,
      ): IndicatorValue => ({
        tenkan: t,
        kijun: k,
        // Senkou A precisa das DUAS: enquanto a Kijun aquece, ela e null (nunca
        // "metade da Tenkan", que seria um numero plausivel e errado).
        senkou_a: t === null || k === null ? null : (t + k) / 2,
        senkou_b: b,
        chikou: close,
      });
      return buildInstance(meta, merged, () => {
        const tH = new MinMaxWindow(tenkan);
        const tL = new MinMaxWindow(tenkan);
        const kH = new MinMaxWindow(kijun);
        const kL = new MinMaxWindow(kijun);
        const bH = new MinMaxWindow(senkouB);
        const bL = new MinMaxWindow(senkouB);
        /** Combina os extremos de duas janelas (uma de high, uma de low). */
        const parear = (
          hi: { min: number; max: number } | null,
          lo: { min: number; max: number } | null,
        ): number | null => (hi === null || lo === null ? null : meio({ min: lo.min, max: hi.max }));
        return {
          onUpdate: (bar) => {
            const t = parear(tH.push(bar.high), tL.push(bar.low));
            const k = parear(kH.push(bar.high), kL.push(bar.low));
            const b = parear(bH.push(bar.high), bL.push(bar.low));
            return montar(t, k, b, bar.close);
          },
          onPreview: (bar) => {
            const t = parear(tH.peek(bar.high), tL.peek(bar.low));
            const k = parear(kH.peek(bar.high), kL.peek(bar.low));
            const b = parear(bH.peek(bar.high), bL.peek(bar.low));
            return montar(t, k, b, bar.close);
          },
          onReset: () => {
            tH.reset();
            tL.reset();
            kH.reset();
            kL.reset();
            bH.reset();
            bL.reset();
          },
        };
      });
    },
  };
})();
