/**
 * useCrosshair — a leitura de O/H/L/C sob o cursor, para montar a LEGENDA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE HOOK RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo cliente de charting mostra, num canto, o Open/High/Low/Close (ou o valor)
 * da barra sob o cursor, e costuma mostrar a variacao. O MOTOR nao desenha essa
 * legenda de proposito — ele so DETECTA e ENTREGA o dado no evento de crosshair
 * (`MouseEventParams.seriesData`), porque a legenda e HTML/CSS do consumidor, e
 * cada um a estiliza do seu jeito. Este hook faz a ponte: assina o crosshair do
 * motor e devolve o dado corrente como estado do React, pronto para renderizar.
 *
 * ⚠️ **A variacao precisa de uma referencia, e a referencia natural e o `open` da
 * propria barra** (variacao intrabar: `close - open`). NAO usamos "barra anterior"
 * porque o evento so traz a barra sob o cursor; puxar a anterior exigiria o motor
 * expor a serie inteira, o que ele nao faz. Variacao intrabar e a leitura honesta
 * com o que o evento entrega, e e a mesma que a cor da vela usa (alta = close >=
 * open). Para Line/Area, que so tem `value`, nao ha variacao — fica `null`.
 *
 * ⚠️ **Coalescido pelo proprio motor.** O motor ja emite o crosshair coalescido
 * por quadro; aqui so guardamos o ultimo. Mover o mouse rapido nao dispara um
 * `setState` por pixel, e sim um por quadro.
 */
import { useEffect, useState } from 'react';
import type { ChartEngine, CrosshairSeriesData, MouseEventParams } from '@robustus/charts-engine';

/** O que o hook devolve — o dado corrente sob o cursor, ou `null` se fora. */
export interface CrosshairReadout {
  /** Instante da barra sob o cursor, em segundos. */
  readonly time: number | null;
  /** O/H/L/C quando a serie e de vela/barra; ausentes para linha/area. */
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  /** Valor quando a serie e linha/area; `null` para vela/barra. */
  readonly value: number | null;
  /**
   * Variacao intrabar `close - open` e seu percentual, quando ha OHLC. `null`
   * para linha/area (sem `open` nao ha o que variar).
   */
  readonly change: number | null;
  readonly changePercent: number | null;
}

const VAZIO: CrosshairReadout = {
  time: null,
  open: null,
  high: null,
  low: null,
  close: null,
  value: null,
  change: null,
  changePercent: null,
};

/** O que o hook recebe. */
export interface UseCrosshairParams {
  /** O motor. `null` antes da montagem — o hook espera. */
  readonly engine: ChartEngine | null;
  /**
   * Chamado a cada movimento do crosshair, alem de atualizar o estado. Opcional —
   * util para quem quer reagir sem re-renderizar (ex.: escrever direto no DOM).
   */
  readonly onMove?: (readout: CrosshairReadout) => void;
}

/**
 * Le O/H/L/C sob o cursor para uma legenda.
 *
 * @example
 * const { engine } = useChartEngine({ candles });
 * const ohlc = useCrosshair({ engine });
 * // <div>O {ohlc.open} A {ohlc.high} B {ohlc.low} F {ohlc.close}
 * //      ({ohlc.changePercent?.toFixed(2)}%)</div>
 */
export function useCrosshair(params: UseCrosshairParams): CrosshairReadout {
  const { engine, onMove } = params;
  const [readout, setReadout] = useState<CrosshairReadout>(VAZIO);

  useEffect(() => {
    if (engine === null || engine.isDisposed) return;

    const handler = (p: MouseEventParams): void => {
      const r = paramParaReadout(p);
      setReadout(r);
      onMove?.(r);
    };

    // `subscribeCrosshairMove` do motor entrega o `MouseEventParams` com o
    // `seriesData` da barra sob o cursor (o motor o preenche em `emitCrosshair`).
    engine.api.subscribeCrosshairMove(handler);

    // ⭐ Agora REMOVE de verdade. Antes esta limpeza era um comentario explicando que o
    // contrato do motor nao tinha `unsubscribe` e que o descarte do motor zerava os
    // assinantes — verdade so quando o motor inteiro morre. Este efeito depende de
    // `onMove`, entao trocar a closure (um `onMove` literal em JSX troca a cada render)
    // acumulava um ouvinte por render NO MESMO motor, cada um segurando a closure
    // anterior. O contrato ganhou `unsubscribeCrosshairMove` e a limpeza deixou de ser
    // uma promessa por escrito.
    return () => {
      try {
        engine.api.unsubscribeCrosshairMove(handler);
      } catch {
        // Motor em descarte: os assinantes morrem com ele.
      }
    };
  }, [engine, onMove]);

  return readout;
}

/** Traduz o evento do motor no readout, calculando a variacao intrabar. */
function paramParaReadout(p: MouseEventParams): CrosshairReadout {
  const sd: CrosshairSeriesData | undefined = p.seriesData;
  const time = typeof p.time === 'number' ? p.time : null;

  if (sd === undefined) {
    return { ...VAZIO, time };
  }

  // Serie de vela/barra: tem OHLC.
  if (sd.open !== undefined && sd.close !== undefined) {
    const open = sd.open;
    const close = sd.close;
    const change = close - open;
    // Percentual so quando `open` nao e zero — divisao por zero daria Infinity, e
    // "nao sei" (null) e a resposta honesta, nunca um numero inventado.
    const changePercent = open !== 0 ? (change / open) * 100 : null;
    return {
      time,
      open,
      high: sd.high ?? null,
      low: sd.low ?? null,
      close,
      value: null,
      change,
      changePercent,
    };
  }

  // Serie de linha/area: so `value`, sem variacao.
  return {
    ...VAZIO,
    time,
    value: sd.value ?? null,
  };
}
