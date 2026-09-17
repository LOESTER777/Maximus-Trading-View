/**
 * useChartEngine — a ligacao React do motor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO E FINO DE PROPOSITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo o comportamento difícil — traducao de vocabulario, ciclo de vida das
 * camadas, coalescencia por quadro, tolerancia a falha — mora em
 * `@robustus/charts-engine`, onde e testavel sem montar componente. Aqui so
 * acontece a costura com o ciclo de vida do React.
 *
 * Inverter isso e o erro comum: quando a logica mora no componente, ela so pode
 * ser testada renderizando, e passa a ser refeita para Vue, para Svelte e para o
 * proximo framework.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS DECISOES QUE VALEM EXPLICAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. O motor e criado UMA vez e nunca recriado por mudanca de dado.**
 * As opcoes de construcao sao lidas na montagem e ignoradas depois — de
 * proposito. Recriar o grafico para trocar cor ou periodo foi exatamente o que
 * produzia `Object is disposed` na origem, onde um `key={timeframe}` destruia e
 * remontava o componente. Para trocar periodo, mande velas novas e chame
 * `resetViewport`.
 *
 * **2. Cada conjunto tem seu proprio efeito.**
 * Velas, volume, linhas, series, marcadores e camadas sao aplicados em efeitos
 * separados, cada um com sua dependencia. Um efeito unico reaplicaria tudo a cada
 * mudanca de qualquer coisa — e reaplicar camada de canvas a cada tick de preco
 * faz o heatmap piscar, porque a camada perde escala de cor e paleta.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ChartEngine,
  type BookmapLayerInput,
  type ChartCoordinateMapper,
  type ChartEngineOptions,
  type ChartHistogramBar,
  type ChartLineSeries,
  type ChartMarker,
  type ChartPriceLine,
  type FootprintLayerInput,
  type VolumeProfileLayerInput,
} from '@robustus/charts-engine';

/** O que o hook recebe. */
export interface UseChartEngineParams {
  /**
   * Opcoes de construcao.
   *
   * ⚠️ Lidas apenas na MONTAGEM. Mudar depois nao tem efeito, e isso e
   * deliberado — ver a nota 1 no cabecalho.
   */
  readonly options?: ChartEngineOptions;

  readonly candles?: readonly unknown[];
  readonly volume?: readonly ChartHistogramBar[];
  readonly priceLines?: readonly ChartPriceLine[];
  readonly lineSeries?: readonly ChartLineSeries[];
  readonly markers?: readonly ChartMarker[];

  /** Camada de livro. `null` ou ausente desliga sem desanexar. */
  readonly bookmap?: BookmapLayerInput | null;
  /** Camada de footprint. `null` ou ausente desliga sem desanexar. */
  readonly footprint?: FootprintLayerInput | null;
  /**
   * ⭐ Perfil de volume — o histograma por LINHA, em faixa lateral propria.
   *
   * `null` ou ausente desliga sem desanexar. O perfil chega JA AGREGADO
   * (`agregarPerfilDeVolume`): quem decide o escopo (dia, janela visivel) e o consumidor.
   *
   * ⚠️ Memoize, como os outros conjuntos. Um objeto literal em JSX tem identidade nova a
   * cada render e reaplicaria a camada por quadro.
   */
  readonly volumeProfile?: VolumeProfileLayerInput | null;

  /**
   * Chamado a cada mudanca de janela visivel (pan, zoom, dado novo), coalescido
   * por quadro. E por aqui que sobreposicao em HTML/SVG se alinha ao eixo real.
   */
  readonly onCoordinateMapper?: (mapper: ChartCoordinateMapper) => void;

  /**
   * Reenquadra quando este valor muda.
   *
   * ⚠️ Use isto no lugar de `key={periodo}` no componente. `key` DESTROI e
   * remonta, e foi o que produzia `Object is disposed` de dentro do observador de
   * redimensionamento na origem. Trocar o valor aqui mantem o grafico vivo e
   * apenas reenquadra.
   */
  readonly resetViewportOn?: unknown;
}

/** O que o hook devolve. */
export interface UseChartEngineResult {
  /** Anexe ao elemento que vai hospedar o grafico. */
  readonly containerRef: React.RefObject<HTMLDivElement>;
  /** O motor, ou `null` antes da montagem. */
  readonly engine: ChartEngine | null;
}

/**
 * Monta e mantem um `ChartEngine` no ciclo de vida do React.
 *
 * @example
 * const { containerRef } = useChartEngine({
 *   options: { withVolume: true },
 *   candles,
 *   bookmap: grid ? { grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: 5 } : null,
 *   onCoordinateMapper: setMapper,
 *   resetViewportOn: periodo,
 * });
 *
 * return <div ref={containerRef} className="h-[520px] w-full" />;
 */
export function useChartEngine(params: UseChartEngineParams): UseChartEngineResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const [engine, setEngine] = useState<ChartEngine | null>(null);

  // As opcoes de construcao ficam numa ref para NAO entrarem como dependencia:
  // um objeto literal em JSX tem identidade nova a cada render, e como
  // dependencia recriaria o grafico a cada render.
  const optionsRef = useRef(params.options);

  // ── Montagem e desmontagem ────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const motor = ChartEngine.create(container, optionsRef.current ?? {});
    engineRef.current = motor;
    setEngine(motor);

    return () => {
      engineRef.current = null;
      setEngine(null);
      motor.dispose();
    };
    // Vazio de proposito: o motor vive enquanto o componente viver.
  }, []);

  // ── Conjuntos de dado, um efeito cada ────────────────────────────────────
  const { candles } = params;
  useEffect(() => {
    if (candles !== undefined) engineRef.current?.setCandles(candles);
  }, [candles]);

  const { volume } = params;
  useEffect(() => {
    if (volume !== undefined) engineRef.current?.setVolume(volume);
  }, [volume]);

  const { priceLines } = params;
  useEffect(() => {
    if (priceLines !== undefined) engineRef.current?.setPriceLines(priceLines);
  }, [priceLines]);

  const { lineSeries } = params;
  useEffect(() => {
    if (lineSeries !== undefined) engineRef.current?.setLineSeries(lineSeries);
  }, [lineSeries]);

  const { markers } = params;
  useEffect(() => {
    if (markers !== undefined) engineRef.current?.setMarkers(markers);
  }, [markers]);

  // ── Camadas de canvas ─────────────────────────────────────────────────────
  //
  // `engine` entra como dependencia porque a camada precisa ser aplicada assim
  // que o motor existe: na primeira passada os efeitos acima rodam antes de o
  // estado do motor estar disponivel.
  const { bookmap } = params;
  useEffect(() => {
    if (engine === null) return;
    engine.setBookmapLayer(bookmap ?? null);
  }, [engine, bookmap]);

  const { volumeProfile } = params;

  useEffect(() => {
    if (engine === null) return;
    engine.setVolumeProfileLayer(volumeProfile ?? null);
  }, [engine, volumeProfile]);

  const { footprint } = params;
  useEffect(() => {
    if (engine === null) return;
    engine.setFootprintLayer(footprint ?? null);
  }, [engine, footprint]);

  // ── Mapeador de coordenadas ───────────────────────────────────────────────
  const { onCoordinateMapper } = params;
  useEffect(() => {
    if (engine === null || onCoordinateMapper === undefined) return;
    return engine.onCoordinateMapperChange(onCoordinateMapper);
  }, [engine, onCoordinateMapper]);

  // ── Reenquadramento ───────────────────────────────────────────────────────
  const { resetViewportOn } = params;
  useEffect(() => {
    if (engine === null || resetViewportOn === undefined) return;
    engine.resetViewport();
  }, [engine, resetViewportOn]);

  return { containerRef, engine };
}
