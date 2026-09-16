/**
 * vitest.setup — preenche as lacunas do jsdom que o substrato de grafico usa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O `lightweight-charts` depende de `fancy-canvas`, que observa mudanca de
 * `devicePixelRatio` para redimensionar o bitmap do canvas. Ele faz isso com
 * `window.matchMedia('(resolution: Xdppx)')`.
 *
 * **O jsdom nao implementa `matchMedia`.** O resultado nao e um teste vermelho
 * limpo: sao dezenas de `Unhandled Rejection: this._window.matchMedia is not a
 * function`, disparadas de dentro de uma promessa do observador. Medido: 63 delas
 * numa unica execucao de 18 testes.
 *
 * Isso e pior que uma falha, por dois motivos:
 *
 *  1. **Afoga o sinal.** Um erro de verdade no meio de 63 rejeicoes de ruido nao
 *     e visto por ninguem.
 *  2. **Nao e defeito da biblioteca.** E lacuna conhecida do ambiente de teste, e
 *     o lugar certo de tratar e a fronteira do ambiente — aqui — e nao um
 *     `try/catch` defensivo espalhado pelo codigo de producao para acomodar o
 *     jsdom.
 *
 * ⚠️ **O que este arquivo NAO faz:** ele nao habilita rasterizacao. `getContext('2d')`
 * continua devolvendo `null` no jsdom, e continua nao havendo pixel. Nenhum teste
 * desta suite afirma aparencia, e as bancadas de desempenho declaram
 * explicitamente medir tudo MENOS a rasterizacao. Um stub de `matchMedia` que
 * fizesse parecer que ha canvas real seria pior que a lacuna.
 */

// ── matchMedia ──────────────────────────────────────────────────────────────
//
// Contrato minimo do `MediaQueryList` que o `fancy-canvas` consome: `matches`,
// `media`, e o par de registro de ouvinte nas duas grafias (a moderna
// `addEventListener` e a legada `addListener`, que bibliotecas ainda usam para
// compatibilidade).
//
// `matches: false` e a resposta correta e nao um atalho: significa "a consulta de
// resolucao nao casa", e o observador entao mantem o `devicePixelRatio` corrente
// em vez de tentar reagir a uma mudanca que nunca vem.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// ── getContext ──────────────────────────────────────────────────────────────
//
// O jsdom nao implementa `HTMLCanvasElement.prototype.getContext`, e o jeito
// como ele NAO implementa importa: em vez de devolver `null`, ele emite
// `Error: Not implemented: HTMLCanvasElement.prototype.getContext` no console
// virtual. O substrato trata o retorno vazio sem problema — mas o rastro de pilha
// aparece a cada criacao e a cada descarte de grafico, e afoga o sinal.
//
// Devolver `null` explicitamente e HONESTO, nao maquiagem: `null` e exatamente o
// que a especificacao manda um contexto indisponivel retornar, e e o que o codigo
// da biblioteca ja espera. As bancadas de desempenho documentam depender disso.
//
// ⚠️ O que NAO fazer aqui: instalar o pacote `canvas` para dar contexto 2D real.
// Isso faria os testes rasterizarem de verdade, e entao as bancadas passariam a
// medir rasterizacao — quebrando a afirmacao central delas, que e medir tudo
// MENOS o pixel. A ausencia de canvas e requisito, nao limitacao.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext(): null {
    return null;
  } as unknown as HTMLCanvasElement['getContext'];
}

// ── ResizeObserver ──────────────────────────────────────────────────────────
//
// O substrato usa `ResizeObserver` para o modo `autoSize`. O jsdom nao o tem.
//
// O duble NUNCA notifica, e isso e deliberado: notificar exigiria inventar uma
// dimensao, e dimensao inventada em teste de grafico produz coordenada inventada
// — que e justamente o tipo de numero que nao se deve afirmar em jsdom. Os testes
// que precisam de dimensao a declaram no proprio elemento.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverDuble implements ResizeObserver {
    observe(): void {
      /* nao notifica — ver a nota acima */
    }
    unobserve(): void {
      /* idem */
    }
    disconnect(): void {
      /* idem */
    }
  }
  globalThis.ResizeObserver = ResizeObserverDuble as unknown as typeof ResizeObserver;
}
