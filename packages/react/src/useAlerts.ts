/**
 * useAlerts — liga os ALERTAS DE PREÇO ao ciclo do React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE HOOK RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `@robustus/charts-alerts` traz um motor PURO: uma `AlertStore` que guarda N
 * alertas e os alimenta amostra a amostra, devolvendo os disparos. Ele não sabe
 * o que é React, canvas, som ou notificação — só DETECTA. Este hook é a costura:
 *
 *  1. mantém a `AlertStore` viva numa `ref` (recriá-la a cada render perderia o
 *     estado da máquina — quem já disparou, quem está armado);
 *  2. alimenta a coleção com a AMOSTRA de cada barra nova, na ordem;
 *  3. entrega ao consumidor a lista corrente de alertas (para renderizar o
 *     painel) e chama `onFire` quando algum dispara (para o consumidor tocar
 *     som/notificar — a fronteira "biblioteca detecta, consumidor reage").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO AS BARRAS VIRAM AMOSTRAS, E POR QUE SÓ AS NOVAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A fonte de um alerta é um número por amostra (`sample.value`). Por padrão
 * usamos o `close` da barra e passamos `high`/`low` para o `TOUCH` funcionar; o
 * consumidor pode trocar a fonte via `sampleOf` (ex.: alertar sobre o valor de
 * um indicador).
 *
 * ⚠️ Alimentamos apenas as barras AINDA NÃO VISTAS. A máquina de estados dos
 * alertas é sensível à ordem e ao histórico: re-alimentar barras já processadas
 * reprocessaria cruzamentos e produziria disparos-fantasma. Guardamos quantas
 * barras já entraram (`fedCountRef`) e só alimentamos o sufixo novo. Se a série
 * ENCOLHER ou trocar de identidade (novo ativo/sessão), reiniciamos do zero e
 * re-armamos os alertas — uma transição entre séries diferentes não é um
 * cruzamento real.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertStore,
  createAlert,
  rearm,
  type Alert,
  type AlertCondition,
  type AlertOptions,
  type Sample,
  type StoreFireEvent,
} from '@robustus/charts-alerts';

/** Uma barra mínima da qual derivamos a amostra. Compatível com a vela do motor. */
export interface AlertBar {
  readonly time: number;
  readonly close: number;
  readonly high?: number;
  readonly low?: number;
}

/** Descritor de um alerta a manter na coleção, vindo do consumidor. */
export interface AlertSpec {
  /** Chave estável na coleção. Trocar a condição sob a mesma chave substitui o alerta. */
  readonly key: string;
  /** A condição a vigiar. */
  readonly condition: AlertCondition;
  /** Opções (modo once/recurring, id ecoado). */
  readonly options?: AlertOptions;
}

/** O que o hook recebe. */
export interface UseAlertsParams {
  /**
   * As barras da série. Só o SUFIXO novo é alimentado (ver cabeçalho). Encolher
   * ou trocar a identidade reinicia e re-arma.
   */
  readonly bars: readonly AlertBar[];
  /** Os alertas a manter. Mudar a lista sincroniza a coleção (add/remove). */
  readonly alerts: readonly AlertSpec[];
  /**
   * Como derivar a amostra de uma barra. Default: `close` como `value`, com
   * `high`/`low` repassados para o `TOUCH`.
   */
  readonly sampleOf?: (bar: AlertBar) => Sample;
  /**
   * Chamado a cada disparo, na ordem. É AQUI que o consumidor reage — toca som,
   * notifica, pisca a tela. A biblioteca só detecta.
   */
  readonly onFire?: (event: StoreFireEvent) => void;
}

/** O que o hook devolve. */
export interface UseAlertsResult {
  /** Os alertas correntes, na ordem de inserção — para renderizar o painel. */
  readonly alerts: ReadonlyArray<readonly [string, Alert]>;
  /** Os disparos acumulados na sessão, mais recente por último. */
  readonly fired: readonly StoreFireEvent[];
  /** Re-arma um alerta específico (volta a vigiar). Útil no painel. */
  readonly rearmOne: (key: string) => void;
  /** Re-arma todos (ex.: trocou de ativo). */
  readonly rearmAll: () => void;
  /** Limpa o histórico de disparos exibido. */
  readonly clearFired: () => void;
}

/** Amostra padrão: `close` é o valor; `high`/`low` alimentam o `TOUCH`. */
function amostraPadrao(bar: AlertBar): Sample {
  return { time: bar.time, value: bar.close, high: bar.high, low: bar.low };
}

/**
 * Vigia alertas de preço sobre uma série de barras, no ciclo do React.
 *
 * @example
 * const { alerts, fired, rearmOne } = useAlerts({
 *   bars: candles,
 *   alerts: [{ key: 'a1', condition: { kind: 'CROSS_ABOVE', level: 130000 } }],
 *   onFire: (e) => new Audio('/ping.mp3').play(),
 * });
 */
export function useAlerts(params: UseAlertsParams): UseAlertsResult {
  const { bars, alerts: specs, sampleOf = amostraPadrao, onFire } = params;

  const storeRef = useRef<AlertStore>(new AlertStore());
  // Quantas barras já foram alimentadas à coleção — o corte do sufixo novo.
  const fedCountRef = useRef(0);
  // Identidade da série alimentada, para detectar troca de ativo/sessão.
  const barsIdentityRef = useRef<readonly AlertBar[] | null>(null);

  // `onFire`/`sampleOf` em refs: são chamados de dentro do efeito de dados, mas
  // não devem, ao mudar de identidade, reprocessar barras já vistas.
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const sampleOfRef = useRef(sampleOf);
  sampleOfRef.current = sampleOf;

  const [alertList, setAlertList] = useState<ReadonlyArray<readonly [string, Alert]>>([]);
  const [fired, setFired] = useState<readonly StoreFireEvent[]>([]);

  // ── Sincroniza a COLEÇÃO com os specs: add o que falta, remove o que sumiu ──
  //
  // Depende da lista de specs por conteúdo (chave + kind + nível), não por
  // identidade de array — assim um literal em JSX não recria os alertas a cada
  // render, o que zeraria o estado da máquina (quem já disparou).
  const assinatura = specs
    .map((s) => `${s.key}:${JSON.stringify(s.condition)}:${s.options?.mode ?? 'once'}`)
    .join('|');

  useEffect(() => {
    const store = storeRef.current;
    const chavesDesejadas = new Set(specs.map((s) => s.key));

    // Remove o que não está mais na lista.
    for (const [key] of store.list()) {
      if (!chavesDesejadas.has(key)) store.remove(key);
    }

    // Adiciona/atualiza. Só recria o alerta se ele NÃO existir ou se a condição
    // mudou — recriar um alerta que só mudou de posição na lista descartaria o
    // estado da máquina sem motivo.
    for (const spec of specs) {
      const existente = store.get(spec.key);
      const precisaRecriar =
        existente === null ||
        JSON.stringify(existente.condition) !== JSON.stringify(spec.condition) ||
        existente.mode !== (spec.options?.mode ?? 'once');
      if (precisaRecriar) {
        store.add(spec.key, createAlert(spec.condition, spec.options));
      }
    }

    setAlertList(store.list());
    // `assinatura` captura a mudança de conteúdo dos specs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  // ── Alimenta APENAS o sufixo novo de barras ────────────────────────────────
  useEffect(() => {
    const store = storeRef.current;

    // Detecta reinício: série trocou de identidade ou encolheu abaixo do que já
    // alimentamos. Nesse caso re-arma tudo e recomeça do zero — a transição
    // entre séries diferentes não é um cruzamento real.
    const trocouIdentidade = barsIdentityRef.current !== null && barsIdentityRef.current !== bars;
    const encolheu = bars.length < fedCountRef.current;
    if (trocouIdentidade || encolheu) {
      for (const [, alert] of store.list()) rearm(alert);
      fedCountRef.current = 0;
    }
    barsIdentityRef.current = bars;

    const inicio = fedCountRef.current;
    if (inicio >= bars.length) {
      // Nada novo (pode acontecer quando só os specs mudaram). Ainda assim
      // atualiza a lista exibida para refletir estado (ex.: re-arme).
      setAlertList(store.list());
      return;
    }

    const novos: StoreFireEvent[] = [];
    for (let i = inicio; i < bars.length; i++) {
      const bar = bars[i];
      if (bar === undefined) continue;
      const eventos = store.feed(sampleOfRef.current(bar));
      for (const evento of eventos) {
        novos.push(evento);
        onFireRef.current?.(evento);
      }
    }
    fedCountRef.current = bars.length;

    if (novos.length > 0) setFired((anteriores) => [...anteriores, ...novos]);
    setAlertList(store.list());
  }, [bars]);

  const rearmOne = useCallback((key: string) => {
    const alert = storeRef.current.get(key);
    if (alert !== null) {
      rearm(alert);
      setAlertList(storeRef.current.list());
    }
  }, []);

  const rearmAll = useCallback(() => {
    for (const [, alert] of storeRef.current.list()) rearm(alert);
    setAlertList(storeRef.current.list());
  }, []);

  const clearFired = useCallback(() => setFired([]), []);

  return { alerts: alertList, fired, rearmOne, rearmAll, clearFired };
}
