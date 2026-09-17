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
 * ⭐ Para o `SERIES_CROSS` (cruzamento de DUAS séries) há `references`: um
 * `Map<time, valor>` com a segunda série — tipicamente a saída de um indicador
 * reduzida a um número por barra. O hook casa barra e referência POR TEMPO, nunca
 * por índice, porque indicador descarta o aquecimento e o índice apontaria outra
 * barra.
 *
 * ```ts
 * const lenta = new Map(pontosEma21.map((p) => [p.time, p.values.value ?? NaN]));
 * useAlerts({
 *   bars: velas,
 *   references: lenta,
 *   // `value` = média rápida; `reference` = a lenta, já casada por tempo
 *   sampleOf: (bar, ref) => ({ time: bar.time, value: rapidaPorTempo.get(bar.time) ?? NaN, reference: ref }),
 *   alerts: [{ key: 'cruz', condition: { kind: 'SERIES_CROSS', direction: 'above' }, options: { mode: 'recurring' } }],
 * });
 * ```
 *
 * ⚠️ Alimentamos apenas as barras AINDA NÃO VISTAS. A máquina de estados dos
 * alertas é sensível à ordem e ao histórico: re-alimentar barras já processadas
 * reprocessaria cruzamentos e produziria disparos-fantasma. Guardamos quantas
 * barras já entraram (`fedCountRef`) e só alimentamos o sufixo novo. Se a série
 * ENCOLHER, trocar de ativo/sessão, ou uma barra já vista virar outra, reiniciamos
 * do zero e re-armamos os alertas — uma transição entre séries diferentes não é um
 * cruzamento real.
 *
 * ⚠️ Esse "trocou de série" é decidido pelo CONTEÚDO (tempo da primeira barra e da
 * última já vista), **não** pela identidade do array. Pela identidade, um
 * `bars={[...]}` literal em JSX era lido como ativo novo a cada render: re-armava,
 * re-alimentava a série inteira e disparava um `setState` que causava outro render —
 * laço infinito, medido travando o processo de teste. Ver `primeiroTimeRef`.
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
   * ⭐ A SEGUNDA série do `SERIES_CROSS`, indexada por TEMPO da barra.
   *
   * `Map<time, valor>` — a saída de um indicador reduzida ao número que interessa
   * ("a EMA de 21 nesta barra"). O hook casa a barra com a referência pelo tempo e
   * a entrega em `sample.reference`, de onde o `SERIES_CROSS` a lê.
   *
   * ⚠️ Por TEMPO, nunca por índice. Um indicador descarta o aquecimento, então a
   * saída dele tem MENOS pontos que as barras e `refs[i]` seria o valor de outra
   * barra — o mesmo defeito de índice lógico que deslocava indicador no eixo (ver
   * `serie-desalinhada.spec.ts` no motor). Barra sem entrada no mapa vai sem
   * referência, e o `SERIES_CROSS` simplesmente não avalia: é o aquecimento se
   * resolvendo sozinho, sem disparo fantasma.
   */
  readonly references?: ReadonlyMap<number, number> | null;
  /**
   * Como derivar a amostra de uma barra. Default: `close` como `value`, com
   * `high`/`low` repassados para o `TOUCH` e a entrada de `references` (quando
   * houver) como `reference`.
   *
   * O segundo argumento é a referência já casada por tempo — um `sampleOf` próprio
   * que queira usar outra fonte para `value` continua recebendo a referência de
   * graça, em vez de ter de refazer a busca.
   */
  readonly sampleOf?: (bar: AlertBar, reference?: number) => Sample;
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

/**
 * Amostra padrão: `close` é o valor; `high`/`low` alimentam o `TOUCH`; a referência
 * casada por tempo alimenta o `SERIES_CROSS`.
 *
 * ⚠️ A referência só entra quando é FINITA. Escrever `reference: undefined` seria
 * inofensivo, mas escrever um `NaN` que veio do indicador aquecendo não seria: o
 * motor trata não-finito como ausente, e depender disso deixaria a intenção
 * implícita num detalhe do motor.
 */
function amostraPadrao(bar: AlertBar, reference?: number): Sample {
  const base: Sample = { time: bar.time, value: bar.close, high: bar.high, low: bar.low };
  return typeof reference === 'number' && Number.isFinite(reference)
    ? { ...base, reference }
    : base;
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
  const { bars, alerts: specs, sampleOf = amostraPadrao, onFire, references } = params;

  const storeRef = useRef<AlertStore>(new AlertStore());
  // Quantas barras já foram alimentadas à coleção — o corte do sufixo novo.
  const fedCountRef = useRef(0);
  /**
   * ⭐ Assinatura de CONTEÚDO do prefixo já alimentado: o tempo da primeira barra e
   * o da última que entrou.
   *
   * ⚠️ Substitui a comparação por IDENTIDADE do array, que era um alçapão. Um
   * `bars={[...]}` literal em JSX tem identidade nova a cada render; a identidade
   * mudava, o hook concluía "trocou de ativo", re-armava tudo, zerava o contador e
   * **re-alimentava a série inteira** — o que produzia disparos repetidos e, pior,
   * um `setState` que disparava outro render, com outro array literal, num LAÇO
   * INFINITO. Medido: o teste travava o processo.
   *
   * Dois tempos bastam para decidir: se a primeira barra e a última já vista
   * continuam as mesmas, o prefixo é o mesmo dado e o sufixo é continuação
   * legítima. Ativo/sessão diferente muda o tempo da primeira barra; correção de
   * histórico (a barra já vista virou outra) muda o da última. É O(1), e não
   * depende de o consumidor memoizar nada.
   */
  const primeiroTimeRef = useRef<number | null>(null);
  const ultimoTimeAlimentadoRef = useRef<number | null>(null);

  // `onFire`/`sampleOf` em refs: são chamados de dentro do efeito de dados, mas
  // não devem, ao mudar de identidade, reprocessar barras já vistas.
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const sampleOfRef = useRef(sampleOf);
  sampleOfRef.current = sampleOf;
  // ⚠️ `references` também vive num ref, e pelo mesmo motivo: ela muda a cada barra
  // (é a saída de um indicador), e se entrasse na dependência do efeito de dados o
  // efeito rodaria por mudança de referência. Não haveria disparo-fantasma (o
  // sufixo já foi consumido), mas seria trabalho por quadro sem barra nova. Escrever
  // o ref durante o RENDER é o que garante que a barra nova já veja o mapa novo.
  const referencesRef = useRef(references);
  referencesRef.current = references;

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

    // Detecta reinício por CONTEÚDO do prefixo (ver `primeiroTimeRef`): série
    // encolheu, trocou de ativo/sessão, ou uma barra já vista virou outra. Aí
    // re-arma tudo e recomeça do zero — transição entre séries diferentes não é
    // cruzamento real.
    const jaAlimentou = fedCountRef.current > 0;
    const encolheu = bars.length < fedCountRef.current;
    const trocouPrimeira = jaAlimentou && bars[0]?.time !== primeiroTimeRef.current;
    const trocouUltima =
      jaAlimentou && !encolheu && bars[fedCountRef.current - 1]?.time !== ultimoTimeAlimentadoRef.current;

    if (encolheu || trocouPrimeira || trocouUltima) {
      for (const [, alert] of store.list()) rearm(alert);
      fedCountRef.current = 0;
    }

    const inicio = fedCountRef.current;
    if (inicio >= bars.length) {
      // Nada novo. ⚠️ E NADA de `setState` aqui: `store.list()` devolve array novo a
      // cada chamada, então um `setAlertList` incondicional re-renderiza; com um
      // `bars` literal (identidade nova por render) isso fecha um LAÇO INFINITO. Quem
      // muda a lista exibida já chama `setAlertList`: o efeito de specs, `rearmOne` e
      // `rearmAll`.
      return;
    }

    const novos: StoreFireEvent[] = [];
    for (let i = inicio; i < bars.length; i++) {
      const bar = bars[i];
      if (bar === undefined) continue;
      // Casa a referência pelo TEMPO da barra (ver a nota em `references`).
      const ref = referencesRef.current?.get(bar.time);
      const eventos = store.feed(sampleOfRef.current(bar, ref));
      for (const evento of eventos) {
        novos.push(evento);
        onFireRef.current?.(evento);
      }
    }
    fedCountRef.current = bars.length;
    primeiroTimeRef.current = bars[0]?.time ?? null;
    ultimoTimeAlimentadoRef.current = bars[bars.length - 1]?.time ?? null;

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
