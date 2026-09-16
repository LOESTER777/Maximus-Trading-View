/**
 * @robustus/charts-alerts — motor PURO de alertas de preço.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE PACOTE É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O que um trader configura para ser avisado quando o mercado faz algo: cruzar
 * um nível, tocar uma linha, entrar/sair de uma faixa, variar X% desde o
 * armamento. O motor avalia a condição amostra a amostra e dispara UMA vez por
 * armamento — sem repique. Detectar disparar 500 vezes enquanto o preço fica
 * acima do nível é o bug clássico de alerta, e evitá-lo é a razão de existir da
 * máquina de estados em `alert-engine.core.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FRONTEIRAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - AUTOSSUFICIENTE: não importa nenhum outro pacote do workspace nem terceiro.
 *  - PURO: sem DOM, sem relógio (o `time` vem na amostra), sem sorteio, sem I/O,
 *    sem estado de módulo. O `tsconfig` declara `lib` sem DOM como barreira.
 *  - AGNÓSTICO DE FONTE: a fonte é um número por amostra (`sample.value`) que o
 *    consumidor escolhe — close, um valor de indicador, o que for. O pacote não
 *    conhece indicador nenhum.
 *  - SÓ DETECTA: a biblioteca devolve o disparo; som/notificação são do
 *    consumidor.
 */

export type {
  ConditionKind,
  CrossAboveCondition,
  CrossBelowCondition,
  TouchCondition,
  EnterZoneCondition,
  ExitZoneCondition,
  PercentChangeCondition,
  AlertCondition,
  Sample,
} from './conditions.js';

export type {
  AlertMode,
  AlertState,
  AlertOptions,
  Alert,
  FeedResult,
} from './alert-engine.core.js';
export { createAlert, feed, rearm } from './alert-engine.core.js';

export type { StoreFireEvent } from './alert-store.core.js';
export { AlertStore } from './alert-store.core.js';
