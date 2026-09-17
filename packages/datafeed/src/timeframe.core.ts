/**
 * timeframe.core — o vocabulário de PERÍODO da barra. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LACUNA QUE ISTO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O relato foi direto: *"gráfico está sem seleção de TF"*. E era verdade em dois
 * níveis. A biblioteca tinha `periodSeconds` no pedido de barras e `rollupBars` para
 * reamostrar (M1→M5), mas **não tinha o vocabulário**: nenhuma lista de períodos, nenhum
 * rótulo, nenhuma noção de qual período dá para derivar de qual. Sem isso, cada
 * consumidor escreveria a sua lista — e todas divergiriam no rótulo (`5m`, `M5`, `5min`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ SEGUNDOS SÃO A VERDADE; O RÓTULO É APRESENTAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `seconds` é o que viaja para o `BarsRequest` e para o `rollupBars`. O `id` é chave
 * estável para persistir layout (`'M5'`), e o `label` é o que o operador lê.
 *
 * ⚠️ **Nunca derive o período de um rótulo.** Rótulo é dialeto: `'1h'`, `'H1'`, `'60'` e
 * `'60m'` são o mesmo período escrito por quatro provedores diferentes. É exatamente por
 * isso que `BarsRequest.periodSeconds` é número — e é a mesma razão pela qual esta lista
 * carrega os três campos em vez de tentar parsear um.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE NÚCLEO NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Não busca dado, não converte fuso, não decide sessão. A agregação vive em
 * `aggregator.core.ts` (`rollupBars`); a fronteira de dia, em `market-day.ts`. Aqui só
 * existe o vocabulário e as perguntas que se responde sobre ele — sem relógio, sem I/O,
 * sem estado de módulo.
 */

/** Um período de barra. */
export interface Timeframe {
  /**
   * Chave ESTÁVEL, no dialeto `M1`/`H1`/`D1`.
   *
   * ⚠️ É o que vai para o layout salvo, então mudar um `id` invalida layout de usuário.
   * Acrescentar período novo é seguro; renomear existente, não.
   */
  readonly id: string;
  /** Duração em SEGUNDOS — o que o `BarsRequest` e o `rollupBars` consomem. */
  readonly seconds: number;
  /** Rótulo curto para botão de barra de ferramentas (`'5m'`, `'1h'`). */
  readonly label: string;
  /** Rótulo longo, para menu e leitor de tela (`'5 minutos'`). */
  readonly labelLongo: string;
}

const MINUTO = 60;
const HORA = 3600;
const DIA = 86_400;

/**
 * Os períodos canônicos, do menor para o maior.
 *
 * ⚠️ **A ordem é crescente e isso é contrato**, não estética: `proximoTimeframe`,
 * `timeframesAgregaveisDe` e qualquer seletor que mostre "o próximo mais longo" leem a
 * lista na ordem. Inserir um período no lugar errado quebraria os três em silêncio.
 *
 * ⚠️ A escolha dos períodos é a de mesa brasileira: M1/M5/M15/M30 para intradiário de
 * índice e dólar, H1/H4 para swing curto, D1/W1/MN1 para posição. Não há S1 nem S30
 * porque abaixo de um minuto o que se opera é fluxo (bookmap, footprint), não vela — e
 * essa leitura a biblioteca já entrega por outro caminho.
 */
export const TIMEFRAMES: readonly Timeframe[] = [
  { id: 'M1', seconds: MINUTO, label: '1m', labelLongo: '1 minuto' },
  { id: 'M5', seconds: 5 * MINUTO, label: '5m', labelLongo: '5 minutos' },
  { id: 'M15', seconds: 15 * MINUTO, label: '15m', labelLongo: '15 minutos' },
  { id: 'M30', seconds: 30 * MINUTO, label: '30m', labelLongo: '30 minutos' },
  { id: 'H1', seconds: HORA, label: '1h', labelLongo: '1 hora' },
  { id: 'H4', seconds: 4 * HORA, label: '4h', labelLongo: '4 horas' },
  { id: 'D1', seconds: DIA, label: '1D', labelLongo: '1 dia' },
  { id: 'W1', seconds: 7 * DIA, label: '1S', labelLongo: '1 semana' },
  // ⚠️ Mês como 30 dias é APROXIMAÇÃO, e ela está aqui declarada. Mês civil não tem
  // duração fixa, e `rollupBars` agrupa por múltiplo inteiro de segundos — um "mês real"
  // exigiria calendário, que é outro problema (e outro núcleo). Para leitura de posição a
  // aproximação serve; para contabilidade, não use isto.
  { id: 'MN1', seconds: 30 * DIA, label: '1M', labelLongo: '1 mês (30 dias)' },
];

/** Acha um período pelo `id`. `null` quando o id não existe. */
export function timeframePorId(id: string): Timeframe | null {
  for (const tf of TIMEFRAMES) {
    if (tf.id === id) return tf;
  }
  return null;
}

/** Acha um período pela duração em segundos. `null` quando não é período canônico. */
export function timeframePorSegundos(seconds: number): Timeframe | null {
  if (!Number.isFinite(seconds)) return null;
  for (const tf of TIMEFRAMES) {
    if (tf.seconds === seconds) return tf;
  }
  return null;
}

/**
 * O período `alvo` pode ser derivado do `base` por agregação?
 *
 * ⚠️ Exige múltiplo INTEIRO, a mesma regra do `rollupBars` — e a duplicação da regra é
 * deliberada: aqui ela responde ANTES de agregar (para a interface desabilitar a opção),
 * lá ela protege a agregação. Se fossem uma só, a interface teria de tentar agregar para
 * descobrir se pode, o que é caro e obscuro.
 *
 * M1→M5 vale (300/60 = 5). M5→M15 vale. Mas **H4→D1 NÃO vale** (86400/14400 = 6, inteiro,
 * então vale — o exemplo real de recusa é W1→MN1: 2.592.000/604.800 = 4,285…). Nesses
 * casos a barra de origem cairia em dois baldes de destino, e nenhuma reatribuição
 * honesta é possível.
 */
export function podeAgregar(base: Timeframe, alvo: Timeframe): boolean {
  if (alvo.seconds < base.seconds) return false;
  return alvo.seconds % base.seconds === 0;
}

/**
 * Os períodos que dão para montar a partir de `base`, incluindo ele mesmo.
 *
 * É o que um seletor de TF usa para não oferecer o que não consegue entregar: com dado
 * de M5 em mãos, M1 não existe — e oferecer M1 para depois mostrar tela vazia é pior que
 * não oferecer.
 */
export function timeframesAgregaveisDe(base: Timeframe): readonly Timeframe[] {
  return TIMEFRAMES.filter((tf) => podeAgregar(base, tf));
}

/**
 * O período seguinte na lista (mais longo), ou `null` no fim.
 *
 * Serve ao atalho de teclado "subir de período", que é como o operador navega sem
 * procurar o botão.
 */
export function proximoTimeframe(atual: Timeframe): Timeframe | null {
  const i = TIMEFRAMES.findIndex((tf) => tf.id === atual.id);
  if (i < 0) return null;
  return TIMEFRAMES[i + 1] ?? null;
}

/** O período anterior na lista (mais curto), ou `null` no começo. */
export function timeframeAnterior(atual: Timeframe): Timeframe | null {
  const i = TIMEFRAMES.findIndex((tf) => tf.id === atual.id);
  if (i <= 0) return null;
  return TIMEFRAMES[i - 1] ?? null;
}

/**
 * Quantas barras de `base` cabem em uma de `alvo`. `null` quando não agrega.
 *
 * Útil para o consumidor dimensionar o pedido: para mostrar 300 barras de H1 com dado de
 * M1, ele precisa de 300 × 60 barras de origem.
 */
export function barrasPorBalde(base: Timeframe, alvo: Timeframe): number | null {
  if (!podeAgregar(base, alvo)) return null;
  return alvo.seconds / base.seconds;
}
