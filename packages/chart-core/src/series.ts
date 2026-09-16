/**
 * series — implementacao de ISeriesApi e o modelo de dados de serie.
 *
 * Uma serie guarda seus dados, suas opcoes, suas linhas de preco, seus marcadores
 * e as primitives anexadas. Ela NAO desenha (quem desenha e o `renderer`) e NAO
 * calcula escala (quem calcula e a `price-scale`); ela e o dono do dado e o ponto
 * de conversao preco<->pixel que as primitives consultam.
 */

import type {
  Coordinate,
  IPriceLine,
  ISeriesApi,
  ISeriesPrimitive,
  PriceLineOptions,
  SeriesData,
  SeriesMarker,
  SeriesOptionsCommon,
  SeriesType,
} from './contracts.js';
import { coordinateToPrice, priceToCoordinate, type PriceScaleState } from './price-scale.core.js';

/** O modelo interno de uma serie, lido pelo renderer. */
export interface SeriesModel {
  readonly type: SeriesType;
  data: SeriesData[];
  options: SeriesOptionsCommon;
  readonly priceLines: Map<string, PriceLineOptions>;
  markers: SeriesMarker[];
  readonly primitives: ISeriesPrimitive[];
  /** Indice da pane. 0 = principal. */
  paneIndex: number;
}

/**
 * Implementacao da serie.
 *
 * Recebe a `PriceScaleState` da SUA pane por getter — nao por copia — porque a
 * escala muda a cada quadro (autoescala, pan vertical) e a serie precisa converter
 * contra o estado corrente, nao contra um instantaneo velho.
 */
export class SeriesImpl<S extends SeriesType> implements ISeriesApi<S> {
  readonly model: SeriesModel;

  constructor(
    type: S,
    options: Partial<SeriesOptionsCommon>,
    paneIndex: number,
    private readonly getPriceScale: () => PriceScaleState,
    private readonly onChange: () => void,
  ) {
    this.model = {
      type,
      data: [],
      options: { ...options },
      priceLines: new Map(),
      markers: [],
      primitives: [],
      paneIndex,
    };
  }

  setData(data: readonly SeriesData[]): void {
    // Copia e ordena por tempo: o renderer e a busca binaria do eixo assumem ordem
    // crescente, e um consumidor pode entregar fora de ordem sem saber.
    this.model.data = [...data].sort((a, b) => a.time - b.time);
    this.onChange();
  }

  update(bar: SeriesData): void {
    const d = this.model.data;
    const ultimo = d[d.length - 1];
    if (ultimo !== undefined && ultimo.time === bar.time) {
      // Mesma barra: substitui. E o caminho da barra em formacao ao vivo.
      d[d.length - 1] = bar;
    } else if (ultimo === undefined || bar.time > ultimo.time) {
      d.push(bar);
    } else {
      // Fora de ordem: ignora em vez de corromper a monotonicidade do eixo.
      return;
    }
    this.onChange();
  }

  priceToCoordinate(price: number): Coordinate | null {
    return priceToCoordinate(this.getPriceScale(), price);
  }

  coordinateToPrice(y: Coordinate): number | null {
    return coordinateToPrice(this.getPriceScale(), y);
  }

  attachPrimitive(primitive: ISeriesPrimitive): void {
    this.model.primitives.push(primitive);
    // A primitive recebe o gancho de re-render como `requestUpdate`.
    primitive.attached({
      chart: this.chartRef as never,
      series: this as never,
      requestUpdate: this.onChange,
    });
    this.onChange();
  }

  detachPrimitive(primitive: ISeriesPrimitive): void {
    const i = this.model.primitives.indexOf(primitive);
    if (i >= 0) {
      this.model.primitives.splice(i, 1);
      try {
        primitive.detached();
      } catch {
        // Primitive que lanca no detach nao impede a remocao.
      }
      this.onChange();
    }
  }

  createPriceLine(options: PriceLineOptions): IPriceLine {
    const id = `pl-${this.plSeq++}`;
    this.model.priceLines.set(id, options);
    this.onChange();
    return { _id: id };
  }

  removePriceLine(line: IPriceLine): void {
    if (this.model.priceLines.delete(line._id)) this.onChange();
  }

  applyOptions(options: Partial<SeriesOptionsCommon>): void {
    this.model.options = { ...this.model.options, ...options };
    this.onChange();
  }

  setMarkers(markers: readonly SeriesMarker[]): void {
    this.model.markers = [...markers];
    this.onChange();
  }

  /** Referencia ao grafico, injetada apos a construcao (dependencia circular). */
  chartRef: unknown = null;
  private plSeq = 0;
}
