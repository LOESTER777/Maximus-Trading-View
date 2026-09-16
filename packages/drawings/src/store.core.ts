/**
 * store.core — a colecao de desenhos, com desfazer e refazer. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE SNAPSHOT, E NAO COMANDO INVERSIVEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ha duas formas de implementar desfazer: guardar o comando com seu inverso, ou
 * guardar o estado inteiro a cada mudanca. A literatura prefere comandos, por
 * memoria.
 *
 * Aqui e **snapshot**, e a razao e o tamanho do dado: um desenho tem 2 ancoras e
 * um punhado de campos. Cem desenhos sao alguns kilobytes. Um historico de 100
 * passos e da ordem de centenas de kilobytes — irrelevante num navegador que ja
 * carrega ~630 KB de grade de profundidade por pregao.
 *
 * O que se ganha em troca e o que importa: **desfazer nao pode ter defeito**. Com
 * comando inversivel, cada operacao nova exige escrever o inverso correto, e um
 * inverso errado corrompe o documento de forma que o usuario percebe tarde. Com
 * snapshot, desfazer e trocar um ponteiro, e nao existe inverso para errar.
 *
 * Isso so e seguro porque o modelo e **imutavel** (ver `model.ts`): snapshot de
 * estrutura mutavel guardaria referencias que mudam por baixo, e o passado
 * "lembraria" o presente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COALESCENCIA: O DETALHE QUE DECIDE SE O DESFAZER E UTIL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Arrastar uma alca gera dezenas de estados por segundo. Sem agrupamento, um
 * unico arrasto enche o historico e o usuario precisa apertar desfazer 40 vezes
 * para voltar um gesto — o que na pratica significa que o desfazer nao serve.
 *
 * `commit` aceita uma `mergeKey`. Mudancas consecutivas com a mesma chave
 * SUBSTITUEM o topo em vez de empilhar. O controlador usa a chave do gesto
 * (`drag:<id>:<indice>`), e o gesto inteiro vira um passo.
 */

import type { Drawing } from './model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Estado
// ═════════════════════════════════════════════════════════════════════════════

/** Um estado do documento de desenhos. */
export interface DrawingsState {
  readonly drawings: readonly Drawing[];
  readonly selectedIds: readonly string[];
}

/** Estado vazio. */
export const EMPTY_STATE: DrawingsState = Object.freeze({
  drawings: Object.freeze([]),
  selectedIds: Object.freeze([]),
});

/** Profundidade default do historico. */
export const HISTORY_LIMIT_DEFAULT = 100;

/** Um passo do historico. */
interface HistoryEntry {
  readonly state: DrawingsState;
  /** Chave de agrupamento; `null` = passo isolado. */
  readonly mergeKey: string | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// A colecao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Colecao de desenhos com historico.
 *
 * Nao emite evento e nao conhece tela: quem observa e o controlador, que chama
 * `state()` depois de cada operacao. Manter assim e o que permite testar o
 * historico inteiro sem grafico.
 */
export class DrawingsStore {
  private passado: HistoryEntry[] = [];
  private futuro: HistoryEntry[] = [];
  private atual: HistoryEntry;
  private readonly limite: number;

  constructor(inicial: DrawingsState = EMPTY_STATE, historyLimit = HISTORY_LIMIT_DEFAULT) {
    this.atual = { state: inicial, mergeKey: null };
    this.limite = Math.max(1, historyLimit);
  }

  /** O estado corrente. */
  state(): DrawingsState {
    return this.atual.state;
  }

  /** Os desenhos correntes. */
  drawings(): readonly Drawing[] {
    return this.atual.state.drawings;
  }

  /** Um desenho por id, ou `undefined`. */
  byId(id: string): Drawing | undefined {
    return this.atual.state.drawings.find((d) => d.id === id);
  }

  /**
   * Aplica um novo estado, empilhando no historico.
   *
   * @param proximo  o estado novo
   * @param mergeKey quando igual a do topo, SUBSTITUI em vez de empilhar. E o que
   *                 faz um arrasto inteiro virar um unico passo de desfazer.
   */
  commit(proximo: DrawingsState, mergeKey: string | null = null): void {
    // Agrupa com o passo corrente quando a chave bate. `null` nunca agrupa —
    // senao duas operacoes distintas sem chave viriam a se fundir por acidente.
    if (mergeKey !== null && this.atual.mergeKey === mergeKey) {
      this.atual = { state: proximo, mergeKey };
      // Refazer deixa de fazer sentido: o ramo futuro pertencia a outra historia.
      this.futuro = [];
      return;
    }

    this.passado.push(this.atual);
    if (this.passado.length > this.limite) this.passado.shift();
    this.atual = { state: proximo, mergeKey };
    this.futuro = [];
  }

  /**
   * Fecha o agrupamento corrente.
   *
   * Chamado ao soltar o mouse. Sem isto, um segundo arrasto da MESMA alca se
   * fundiria com o primeiro — dois gestos separados virariam um passo, e o
   * usuario perderia a capacidade de desfazer so o ultimo.
   */
  endMerge(): void {
    if (this.atual.mergeKey !== null) {
      this.atual = { state: this.atual.state, mergeKey: null };
    }
  }

  canUndo(): boolean {
    return this.passado.length > 0;
  }

  canRedo(): boolean {
    return this.futuro.length > 0;
  }

  /** Desfaz. Sem efeito quando nao ha passado. */
  undo(): DrawingsState {
    const anterior = this.passado.pop();
    if (anterior === undefined) return this.atual.state;
    this.futuro.push(this.atual);
    this.atual = anterior;
    return this.atual.state;
  }

  /** Refaz. Sem efeito quando nao ha futuro. */
  redo(): DrawingsState {
    const proximo = this.futuro.pop();
    if (proximo === undefined) return this.atual.state;
    this.passado.push(this.atual);
    this.atual = proximo;
    return this.atual.state;
  }

  /**
   * Substitui tudo e ZERA o historico.
   *
   * Para carregar um documento salvo. Zera de proposito: manter o historico
   * permitiria desfazer o carregamento e cair no documento de OUTRO ativo, que e
   * um estado que o usuario nao consegue explicar.
   */
  reset(estado: DrawingsState): void {
    this.passado = [];
    this.futuro = [];
    this.atual = { state: estado, mergeKey: null };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Transformacoes puras de estado
// ═════════════════════════════════════════════════════════════════════════════

/** Acrescenta um desenho. */
export function addDrawing(s: DrawingsState, d: Drawing): DrawingsState {
  return { ...s, drawings: [...s.drawings, d] };
}

/** Substitui um desenho pelo id. Id inexistente devolve o estado inalterado. */
export function replaceDrawing(s: DrawingsState, d: Drawing): DrawingsState {
  let achou = false;
  const proximos = s.drawings.map((x) => {
    if (x.id !== d.id) return x;
    achou = true;
    return d;
  });
  return achou ? { ...s, drawings: proximos } : s;
}

/** Remove desenhos e limpa a selecao correspondente. */
export function removeDrawings(s: DrawingsState, ids: readonly string[]): DrawingsState {
  if (ids.length === 0) return s;
  const alvo = new Set(ids);
  return {
    drawings: s.drawings.filter((d) => !alvo.has(d.id)),
    // Deixar id removido na selecao produziria alca desenhada sobre desenho
    // inexistente na proxima passada.
    selectedIds: s.selectedIds.filter((id) => !alvo.has(id)),
  };
}

/** Define a selecao. Ids inexistentes sao descartados. */
export function selectOnly(s: DrawingsState, ids: readonly string[]): DrawingsState {
  const existentes = new Set(s.drawings.map((d) => d.id));
  return { ...s, selectedIds: ids.filter((id) => existentes.has(id)) };
}

/** Acrescenta a selecao, sem repetir. */
export function addToSelection(s: DrawingsState, id: string): DrawingsState {
  if (s.selectedIds.includes(id)) return s;
  if (!s.drawings.some((d) => d.id === id)) return s;
  return { ...s, selectedIds: [...s.selectedIds, id] };
}

/** Limpa a selecao. */
export function clearSelection(s: DrawingsState): DrawingsState {
  return s.selectedIds.length === 0 ? s : { ...s, selectedIds: [] };
}
