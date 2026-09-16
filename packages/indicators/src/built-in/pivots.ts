/**
 * pivots — os niveis de pivo como indicador incremental.
 *
 * A formula vive em `pivot-levels.core.ts` (pura, sem estado). Aqui esta a unica
 * parte que precisa de estado: descobrir, barra a barra, QUANDO o periodo anterior
 * fechou.
 */

import {
  validateAgainstSpecs,
  withDefaults,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type IndicatorValue,
  type ParamSpec,
} from '../contracts.js';
import { buildInstance } from './instance-base.js';
import { pivotLevels, type PivotLevels } from './pivot-levels.core.js';

/**
 * Pontos de Pivo classicos, do periodo ANTERIOR, mantidos fixos durante o periodo
 * corrente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE ISTO CABE NO CONTRATO INCREMENTAL (e o que precisou ser resolvido)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pivo e o unico indicador daqui cujo insumo nao e uma janela de N barras, e sim
 * a AGREGACAO DE UM PERIODO DE CALENDARIO — a maxima, a minima e o fechamento do
 * dia que passou. A duvida legitima era se isso caberia no contrato `update(bar)`
 * O(1) sem virar um recalculo retroativo.
 *
 * Cabe, e o mecanismo e simples: manter TRES numeros da sessao em curso (maxima
 * corrente, minima corrente, ultimo fechamento) e detectar a virada comparando o
 * DIA do timestamp da barra com o dia da barra anterior. Na barra em que o dia
 * muda, os tres numeros acumulados JA SAO o resumo definitivo do dia que fechou —
 * nada precisa ser revisitado. Os niveis sao calculados uma vez ali e ficam FIXOS
 * ate a proxima virada.
 *
 * Custo: O(1) por barra, tres numeros de estado. Determinista: o resultado depende
 * so da sequencia de barras, e a fronteira e aritmetica pura sobre o timestamp.
 * Nao ha ZigZag aqui — nada e reescrito para tras.
 *
 * ⚠️ NAO houve necessidade de sair do contrato. A funcao pura
 * `pivotLevelsFromBars` existe ao lado (ver `pivot-levels.core.ts`), mas NAO como
 * escapatoria: como conveniencia para quem ja tem o OHLC diario pronto e nao quer
 * alimentar barra por barra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A FRONTEIRA DE SESSAO — dia-calendario UTC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A virada e `floor(time / 86400)`, exatamente a mesma regra do `vwapFactory`. A
 * consistencia aqui nao e preguica: pivo e VWAP na mesma tela reiniciando em
 * momentos DIFERENTES seria incoerencia visivel, e o operador nao teria como saber
 * qual dos dois esta "certo".
 *
 * A limitacao e conhecida e aceita: mercado cuja sessao nao coincide com o dia UTC
 * (futuros com abertura na tarde anterior, forex com corte em Nova York) tera a
 * fronteira no lugar "errado" face ao pregao. Resolver isso exige o CALENDARIO da
 * bolsa, que e informacao da camada de dado (`charts-datafeed` tem o conceito de
 * dia de mercado), nao do indicador — que recebe barras e nada mais. Preferimos a
 * fronteira simples e DOCUMENTADA a uma heuristica que acerta em uns mercados e
 * erra silenciosamente em outros.
 *
 * ⚠️ NAO HA VALOR ANTES DA PRIMEIRA VIRADA. A primeira sessao alimentada nao tem
 * "dia anterior", logo nao tem niveis — todas as saidas ficam null (nunca zero,
 * que desenharia sete linhas no rodape do grafico). Consequencia pratica: um
 * historico de um unico dia nao produz pivo NENHUM, e isso e correto, nao defeito.
 *
 * ⚠️ `warmup` DEVOLVE 1, e isso e uma aproximacao honesta com a qual o campo nao
 * consegue lidar: o gate real do pivo e TEMPORAL (uma virada de sessao), nao um
 * numero de barras. Quantas barras isso e depende do timeframe — 1 em diario, 1440
 * em um minuto — e o indicador nao conhece o timeframe. Devolver 1 comunica "nao e
 * imediato" sem fingir uma precisao que nao existe.
 */
export const pivotPointsFactory: IndicatorFactory = (() => {
  // Sem parametros: a variante e a classica (ver `pivot-levels.core.ts`) e a
  // fronteira e o dia UTC. Um `variant` entraria como parametro no dia em que
  // houver uma segunda formula implementada — nao antes, para nao publicar um
  // parametro com um unico valor possivel.
  const specs: readonly ParamSpec[] = [];
  const meta: IndicatorMeta = {
    name: 'pivot_points',
    label: 'Pontos de Pivo (Classico)',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'r3', label: 'R3', plot: 'line', pane: 'price' },
      { key: 'r2', label: 'R2', plot: 'line', pane: 'price' },
      { key: 'r1', label: 'R1', plot: 'line', pane: 'price' },
      { key: 'pp', label: 'PP', plot: 'line', pane: 'price' },
      { key: 's1', label: 'S1', plot: 'line', pane: 'price' },
      { key: 's2', label: 'S2', plot: 'line', pane: 'price' },
      { key: 's3', label: 'S3', plot: 'line', pane: 'price' },
    ],
    warmup: () => 1,
  };
  const vazio: IndicatorValue = {
    r3: null,
    r2: null,
    r1: null,
    pp: null,
    s1: null,
    s2: null,
    s3: null,
  };
  const dayOf = (timeSec: number): number => Math.floor(timeSec / 86400);
  /** PivotLevels -> IndicatorValue. Explicito, para nao vazar campo inesperado. */
  const montar = (n: PivotLevels): IndicatorValue => ({
    r3: n.r3,
    r2: n.r2,
    r1: n.r1,
    pp: n.pp,
    s1: n.s1,
    s2: n.s2,
    s3: n.s3,
  });
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      return buildInstance(meta, merged, () => {
        let session: number | null = null;
        // Agregacao da sessao EM CURSO. Vira o resumo do "periodo anterior" no
        // instante em que o dia muda.
        let curHigh = 0;
        let curLow = 0;
        let curClose = 0;
        // Niveis FIXOS da sessao corrente, calculados na virada. null antes dela.
        let levels: PivotLevels | null = null;
        return {
          onUpdate: (bar) => {
            const day = dayOf(bar.time);
            if (session === null) {
              session = day;
              curHigh = bar.high;
              curLow = bar.low;
              curClose = bar.close;
              return vazio; // primeira sessao: nao existe dia anterior
            }
            if (day !== session) {
              // ⭐ A virada. O que foi acumulado E o resumo definitivo do dia que
              // fechou — por isso nao ha nada a recalcular para tras.
              levels = pivotLevels(curHigh, curLow, curClose);
              session = day;
              curHigh = bar.high;
              curLow = bar.low;
              curClose = bar.close;
            } else {
              if (bar.high > curHigh) curHigh = bar.high;
              if (bar.low < curLow) curLow = bar.low;
              curClose = bar.close;
            }
            return levels === null ? vazio : montar(levels);
          },
          onPreview: (bar) => {
            const day = dayOf(bar.time);
            if (session === null) return vazio;
            if (day !== session) {
              // A barra em formacao ABRE uma sessao nova: os niveis dela sairiam do
              // dia que acabou de fechar. Calcula e devolve SEM gravar — nem os
              // niveis, nem a troca de sessao, nem os acumuladores.
              return montar(pivotLevels(curHigh, curLow, curClose));
            }
            // Mesma sessao: os niveis do dia sao FIXOS, a barra em formacao nao os
            // move. Isso e a natureza do indicador, nao um atalho de preview.
            return levels === null ? vazio : montar(levels);
          },
          onReset: () => {
            session = null;
            curHigh = 0;
            curLow = 0;
            curClose = 0;
            levels = null;
          },
        };
      });
    },
  };
})();

// ⚠️ A formula pura NAO e reexportada daqui. A fachada (`index.ts`) a exporta
// direto de `pivot-levels.core.js`, para que exista UM caminho de import para ela
// — dois caminhos para o mesmo simbolo confundem quem le e quem faz grep.
