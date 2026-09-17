/**
 * useChartSync — sincroniza CROSSHAIR e JANELA entre vários gráficos.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO HABILITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido: *"seria legal podermos adicionar mais de um TF na mesma tela"* e *"deixar na
 * mesma tela para acompanhar a correlação, isso daria vida ao trader"*.
 *
 * Dois gráficos lado a lado só servem se se movem juntos. Sem sincronia, comparar M5 com
 * H1 (ou WIN com WDO) exige alinhar a janela à mão a cada pan — e o operador desiste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ SINCRONIA POR TEMPO, NUNCA POR ÍNDICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A tentação é copiar a janela lógica (`{from, to}`) de um gráfico para o outro. Está
 * errado sempre que os dois não têm exatamente as mesmas barras:
 *
 * - **períodos diferentes:** a barra 100 de M5 é 8h20 depois do início; a 100 de H1 é 100
 *   horas depois. Copiar o índice põe os dois em instantes completamente diferentes.
 * - **ativos diferentes:** WDO e WIN têm buracos de negociação distintos, então o índice
 *   50 de um não é o instante do índice 50 do outro.
 *
 * Então o que viaja é **TEMPO**: o gráfico origem informa a faixa de tempo visível, e cada
 * destino converte esse instante para o índice DELE (`timeToIndex(findNearest)`). Mesma
 * disciplina que corrigiu o indicador deslocado no eixo, aplicada entre gráficos.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O LAÇO DE ECO — o defeito que qualquer implementação ingênua tem
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A move → aplica em B → B emite mudança de janela → aplica em A → A emite → …
 * Um laço infinito de `requestAnimationFrame`, com os dois gráficos tremendo.
 *
 * A guarda é um sinalizador de "estou aplicando": enquanto ele está de pé, os eventos
 * recebidos são IGNORADOS. Ele é baixado no fim do ciclo de aplicação — e como a aplicação
 * é síncrona, um sinalizador simples basta (não é preciso `setTimeout`, que introduziria
 * uma janela em que o eco passa).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ChartEngine } from '@robustus/charts-engine';

/** O que sincronizar. */
export interface ChartSyncOptions {
  /**
   * Alinhar a JANELA visível (pan e zoom). Default `true`.
   *
   * ⚠️ Sincronizar janela entre períodos diferentes alinha o INTERVALO DE TEMPO, não o
   * zoom: 60 barras de M5 (5 h) viram 5 barras de H1. É o comportamento certo — o
   * operador quer ver o mesmo trecho do dia nos dois, não o mesmo número de barras.
   */
  readonly viewport?: boolean;
  /**
   * Alinhar o CROSSHAIR (a coluna sob o cursor). Default `true`.
   *
   * ⚠️ O motor não expõe "mover o crosshair por API" — ele nasce do ponteiro. Então este
   * hook não desenha o crosshair no outro gráfico; ele ENTREGA o instante ao consumidor
   * (`onCrosshair`), que decide o que mostrar: uma linha própria, o valor na legenda do
   * outro painel, um destaque. Prometer a linha e não desenhá-la seria pior.
   */
  readonly crosshair?: boolean;
}

export interface UseChartSyncResult {
  /**
   * Registra um gráfico no grupo. Devolve a função de saída.
   *
   * @example
   * const sync = useChartSync();
   * useEffect(() => sync.register('m5', engineM5), [sync, engineM5]);
   */
  readonly register: (id: string, engine: ChartEngine | null) => () => void;
  /** Quantos gráficos estão no grupo agora. Para diagnóstico e para a interface. */
  readonly count: () => number;
}

export interface UseChartSyncParams extends ChartSyncOptions {
  /**
   * Chamado quando o crosshair se move em ALGUM gráfico do grupo.
   *
   * `id` é o gráfico de ORIGEM (o que está sob o cursor) e `time` o instante em segundos,
   * ou `null` quando o cursor saiu. Quem recebe decide como mostrar nos demais — ver a
   * nota em `crosshair`.
   */
  readonly onCrosshair?: (id: string, time: number | null) => void;
}

interface Membro {
  readonly id: string;
  readonly engine: ChartEngine;
  /** Ouvintes registrados neste motor, para remover na saída. */
  readonly desligar: () => void;
}

/**
 * Mantém um grupo de gráficos alinhados.
 *
 * @example
 * const sync = useChartSync({ onCrosshair: (id, t) => setInstante(t) });
 *
 * // em cada painel:
 * useEffect(() => sync.register('m5', engine), [sync, engine]);
 */
export function useChartSync(params: UseChartSyncParams = {}): UseChartSyncResult {
  const { viewport = true, crosshair = true, onCrosshair } = params;

  /**
   * Os membros do grupo.
   *
   * ⚠️ Num `ref`, não em estado: `register` é chamado de dentro de `useEffect` dos painéis,
   * e um `setState` ali disparia um render que remontaria os efeitos — cada painel entrando
   * faria todos os outros se reinscreverem.
   */
  const membrosRef = useRef<Map<string, Membro>>(new Map());

  /** ⭐ A guarda de eco. Ver o cabeçalho: sem ela, dois gráficos entram em laço. */
  const aplicandoRef = useRef(false);

  const onCrosshairRef = useRef(onCrosshair);
  onCrosshairRef.current = onCrosshair;
  const opcoesRef = useRef({ viewport, crosshair });
  opcoesRef.current = { viewport, crosshair };

  /**
   * Aplica a faixa de TEMPO de `origem` em todos os outros.
   *
   * ⚠️ Converte tempo → índice NO DESTINO (`timeToIndex(findNearest)`). Copiar a janela
   * lógica alinharia índices, e índice não é tempo quando os gráficos têm períodos ou
   * buracos diferentes.
   */
  const propagarJanela = useCallback((idOrigem: string): void => {
    if (aplicandoRef.current) return;
    const membros = membrosRef.current;
    const origem = membros.get(idOrigem);
    if (origem === undefined || origem.engine.isDisposed) return;

    const faixa = origem.engine.api.timeScale().getVisibleRange();
    if (faixa === null) return;

    aplicandoRef.current = true;
    try {
      for (const [id, m] of membros) {
        if (id === idOrigem || m.engine.isDisposed) continue;
        const ts = m.engine.api.timeScale();
        // `findNearest` porque o instante da borda quase nunca é barra exata NO DESTINO —
        // e recusar por isso deixaria o gráfico parado, que é pior que um alinhamento com
        // erro de meia barra.
        const de = ts.timeToIndex(faixa.from, true);
        const ate = ts.timeToIndex(faixa.to, true);
        if (de === null || ate === null) continue;
        // ⚠️ Faixa degenerada (o destino tem uma barra só no intervalo) alargaria o zoom
        // para o infinito. Uma barra de folga mantém a janela utilizável.
        const largura = Math.max(1, ate - de);
        ts.setVisibleLogicalRange({ from: de, to: de + largura });
      }
    } finally {
      // No `finally`: uma exceção no meio da propagação não pode deixar a guarda de pé
      // para sempre — o grupo inteiro pararia de sincronizar, em silêncio.
      aplicandoRef.current = false;
    }
  }, []);

  const register = useCallback(
    (id: string, engine: ChartEngine | null): (() => void) => {
      if (engine === null || engine.isDisposed) return () => {};

      const membros = membrosRef.current;
      // Substituir sob a mesma chave: desliga o anterior primeiro, senão os ouvintes do
      // motor antigo continuariam vivos apontando para ele.
      membros.get(id)?.desligar();

      const ao = {
        janela: (): void => {
          if (opcoesRef.current.viewport) propagarJanela(id);
        },
        crosshair: (p: { time?: number }): void => {
          if (!opcoesRef.current.crosshair) return;
          if (aplicandoRef.current) return;
          onCrosshairRef.current?.(id, p.time ?? null);
        },
      };

      const ts = engine.api.timeScale();
      ts.subscribeVisibleLogicalRangeChange(ao.janela);
      engine.api.subscribeCrosshairMove(ao.crosshair);

      const desligar = (): void => {
        try {
          ts.unsubscribeVisibleLogicalRangeChange(ao.janela);
          engine.api.unsubscribeCrosshairMove(ao.crosshair);
        } catch {
          // Motor em descarte: os ouvintes morrem com ele.
        }
      };

      membros.set(id, { id, engine, desligar });

      return () => {
        const atual = membros.get(id);
        // Só remove se ainda for ESTE membro: um `register` posterior sob a mesma chave já
        // substituiu, e apagar aqui removeria o novo.
        if (atual !== undefined && atual.engine === engine) {
          atual.desligar();
          membros.delete(id);
        }
      };
    },
    [propagarJanela],
  );

  // Desliga tudo no desmonte do dono do grupo.
  useEffect(
    () => () => {
      for (const m of membrosRef.current.values()) m.desligar();
      membrosRef.current.clear();
    },
    [],
  );

  const count = useCallback(() => membrosRef.current.size, []);

  return { register, count };
}
