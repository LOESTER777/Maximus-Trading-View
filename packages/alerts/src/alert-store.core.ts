/**
 * Coleção de alertas — add/remove/list e alimentação em lote.
 *
 * ── O QUE ESTA CAMADA FAZ E O QUE NÃO FAZ ───────────────────────────────────
 *
 * Faz: guardar N alertas, alimentá-los com a mesma amostra e coletar os
 * disparos. É pura — não toca em som, notificação, DOM nem relógio. A biblioteca
 * DETECTA o disparo; o consumidor decide o que fazer com ele (tocar um som,
 * empurrar uma notificação, piscar a tela). Manter essa fronteira é o que deixa
 * o pacote sem DOM e testável em Node puro.
 *
 * Não faz: persistência em disco, IDs automáticos globais, ordenação por
 * prioridade. São decisões do consumidor.
 *
 * O identificador de cada alerta na coleção é fornecido no `add`; a coleção não
 * inventa IDs (seria estado de módulo — um contador — que este projeto proíbe).
 */

import type { Sample } from './conditions.js';
import type { Alert, FeedResult } from './alert-engine.core.js';
import { feed } from './alert-engine.core.js';

/** Um disparo coletado pelo `feedAll`, carimbado com a chave do alerta. */
export interface StoreFireEvent extends FeedResult {
  /** A chave do alerta na coleção (o `key` passado ao `add`). */
  readonly key: string;
}

/**
 * Coleção mutável de alertas indexada por chave.
 *
 * Mutável pela mesma razão do `Alert`: é uma estrutura de vigilância viva, não
 * um dado com histórico de desfazer. Um `Map` interno mantém a ordem de
 * inserção, o que torna `feedAll` determinístico na ordem dos disparos.
 */
export class AlertStore {
  private readonly alerts = new Map<string, Alert>();

  /**
   * Adiciona (ou substitui) um alerta sob `key`. Substituir uma chave existente
   * troca o alerta inteiro — o estado do antigo é descartado.
   */
  add(key: string, alert: Alert): void {
    this.alerts.set(key, alert);
  }

  /** Remove o alerta sob `key`. Devolve `true` se algo foi removido. */
  remove(key: string): boolean {
    return this.alerts.delete(key);
  }

  /** Busca um alerta por chave, ou `null` se não existir. */
  get(key: string): Alert | null {
    return this.alerts.get(key) ?? null;
  }

  /** Lista os pares `[chave, alerta]` na ordem de inserção. */
  list(): ReadonlyArray<readonly [string, Alert]> {
    return [...this.alerts.entries()];
  }

  /** Quantos alertas há na coleção. */
  get size(): number {
    return this.alerts.size;
  }

  /** Remove todos os alertas. */
  clear(): void {
    this.alerts.clear();
  }

  /**
   * Alimenta UMA amostra a TODOS os alertas e devolve apenas os que dispararam,
   * na ordem de inserção. Alertas que não dispararam não entram no resultado —
   * o consumidor só se importa com o que aconteceu.
   */
  feed(sample: Sample): StoreFireEvent[] {
    const eventos: StoreFireEvent[] = [];
    for (const [key, alert] of this.alerts) {
      const resultado = feed(alert, sample);
      if (resultado.fired) {
        eventos.push({ ...resultado, key });
      }
    }
    return eventos;
  }

  /**
   * Alimenta uma SEQUÊNCIA de amostras, em ordem, a todos os alertas. Devolve
   * todos os disparos acumulados (cada um com a amostra e a chave). Equivale a
   * chamar `feed` para cada amostra e concatenar — existe para o caso comum de
   * reproduzir um histórico de barras de uma vez.
   *
   * Determinístico: a mesma sequência produz exatamente os mesmos disparos, na
   * mesma ordem.
   */
  feedAll(samples: readonly Sample[]): StoreFireEvent[] {
    const eventos: StoreFireEvent[] = [];
    for (const sample of samples) {
      for (const evento of this.feed(sample)) {
        eventos.push(evento);
      }
    }
    return eventos;
  }
}
