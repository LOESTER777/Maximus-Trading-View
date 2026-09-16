/**
 * instance-base — o esqueleto comum de toda instancia de indicador.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo indicador repete o MESMO ritual em volta da matematica propria:
 *
 *   - `warmup(history)` = reset + alimentar cada barra por `update`, coletando os
 *     pontos. Reconstruir por `update` (em vez de um caminho batch separado) e o
 *     que GARANTE, por construcao, que warmup e update produzem a mesma serie —
 *     eles literalmente correm o mesmo codigo. A propriedade central do pacote
 *     deixa de depender de disciplina e passa a ser estrutural.
 *
 *   - guarda de ordem em `update`: barra com tempo <= ultima consumida e recusada
 *     devolvendo o snapshot corrente, sem mutar. Reprocessar a mesma barra
 *     envenenaria o estado rolante (a mesma amostra entraria duas vezes na media).
 *
 *   - `snapshot()` devolve o ultimo valor; `preview(bar)` calcula sem mutar.
 *
 * Extrair isso num unico lugar significa que cada indicador escreve SO tres
 * funcoes puras — `onUpdate` (muta e devolve valor), `onPreview` (nao muta) e
 * `onReset` — e herda ordem, warmup-por-reconstrucao e snapshot de graca.
 *
 * ⚠️ Nunca lanca. Entrada hostil (NaN, barra fora de ordem) resolve para o
 * snapshot corrente ou para um valor com campos null — nunca excecao, porque uma
 * excecao aqui derrubaria o pipeline ao vivo que consome o indicador.
 */

import type {
  IndicatorBar,
  IndicatorInstance,
  IndicatorMeta,
  IndicatorParams,
  IndicatorPoint,
  IndicatorValue,
} from '../contracts.js';

/**
 * As tres operacoes que um indicador precisa fornecer. Todo o resto (ordem,
 * warmup, snapshot) e servico do esqueleto.
 */
export interface IndicatorLogic {
  /** Consome a barra e MUTA o estado. Devolve o valor da barra. */
  onUpdate(bar: IndicatorBar): IndicatorValue;
  /** Calcula o valor COMO SE a barra fechasse assim, SEM mutar. */
  onPreview(bar: IndicatorBar): IndicatorValue;
  /** Reinicia o estado interno. */
  onReset(): void;
}

/** O valor "tudo aquecendo": cada saida declarada mapeada para null. */
export function warmingValue(meta: IndicatorMeta): IndicatorValue {
  const v: Record<string, number | null> = {};
  for (const o of meta.outputs) v[o.key] = null;
  return v;
}

/**
 * Monta uma `IndicatorInstance` a partir da logica pura do indicador.
 *
 * `makeLogic` e uma fabrica de estado: chamada uma vez na criacao e de novo a
 * cada `reset`/`warmup`, para que o estado rolante nasca limpo. Isso mantem cada
 * arquivo de indicador focado so na recorrencia matematica.
 */
export function buildInstance(
  meta: IndicatorMeta,
  params: IndicatorParams,
  makeLogic: () => IndicatorLogic,
): IndicatorInstance {
  let logic = makeLogic();
  let lastTime = -Infinity;
  let last: IndicatorValue = warmingValue(meta);

  const reset = (): void => {
    logic.onReset();
    // Recria a logica para zerar qualquer estado que o `onReset` da instancia
    // nao alcance — barato e a prova de esquecimento.
    logic = makeLogic();
    lastTime = -Infinity;
    last = warmingValue(meta);
  };

  return {
    meta,
    params,

    warmup(history: readonly IndicatorBar[]): readonly IndicatorPoint[] {
      // Reconstrucao total: reinicia e reprocessa por `update`. Ver o cabecalho —
      // e isto que faz warmup == sequencia de updates por definicao.
      reset();
      const pontos: IndicatorPoint[] = [];
      for (const bar of history) {
        if (!isFiniteBar(bar) || bar.time <= lastTime) continue;
        const values = logic.onUpdate(bar);
        lastTime = bar.time;
        last = values;
        pontos.push({ time: bar.time, values });
      }
      return pontos;
    },

    update(bar: IndicatorBar): IndicatorValue {
      // Barra fora de ordem, repetida ou nao-finita: recusa sem mutar. Devolver o
      // snapshot corrente e a resposta honesta ("nada mudou"), e nunca lanca.
      if (!isFiniteBar(bar) || bar.time <= lastTime) return last;
      const values = logic.onUpdate(bar);
      lastTime = bar.time;
      last = values;
      return values;
    },

    preview(bar: IndicatorBar): IndicatorValue {
      if (!isFiniteBar(bar)) return last;
      return logic.onPreview(bar);
    },

    snapshot(): IndicatorValue {
      return last;
    },

    reset,
  };
}

/**
 * Uma barra e utilizavel se OHLC forem finitos. Volume ausente e legitimo (forex
 * raramente traz volume confiavel); volume presente mas NaN e tratado como 0 no
 * ponto de uso, nao aqui. Barra com preco NaN e descartada porque envenenaria
 * qualquer media rolante de forma irreversivel.
 */
function isFiniteBar(bar: IndicatorBar): boolean {
  return (
    bar != null &&
    Number.isFinite(bar.time) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close)
  );
}
