/**
 * replay-controller.core — o controlador de REPLAY DE MERCADO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E REPLAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reproduzir um pregao historico barra a barra, como um video: o operador
 * posiciona no meio do dia e da "play" para ver o mercado se desenrolar, seja
 * para treinar leitura de fluxo, seja para revisar uma operacao ja fechada.
 *
 * O controlador nao desenha nada. Ele guarda QUANTAS barras ja foram reveladas
 * (a `position`, um indice na serie) e expoe a fatia visivel; o consumidor pega
 * essa fatia e alimenta o grafico. A cada avanco, uma barra a mais entra em cena.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS DECISOES DE PROJETO, E O PORQUE DE CADA UMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ **1. Relogio INJETADO, nunca `setInterval` global.**
 *
 * O nucleo (`ReplayCore`) e PURO: ele nao sabe o que e tempo real. Quem decide
 * quanto tempo passou e o consumidor, que chama `advanceByElapsed(deltaMs)`. Com
 * a mesma `position` e a mesma `speed`, o mesmo `deltaMs` avanca sempre o mesmo
 * numero de barras — e por isso o comportamento e testavel sem relogio de
 * verdade, sem `await`, sem timer que torna o teste lento e instavel.
 *
 * O avanco automatico de fato (o "play" que anda sozinho) vive no wrapper
 * `ReplayController`, que recebe um `TimerLike` INJETADO. Em producao passa-se o
 * timer do ambiente (`{ setInterval, clearInterval }` do browser ou do Node, ou
 * um baseado em `requestAnimationFrame`); no teste passa-se um timer falso que o
 * proprio teste controla. O nucleo nunca toca em `setInterval`: um `setInterval`
 * global aqui atrelaria a biblioteca a um ambiente, quebraria em SSR e tornaria
 * o teste dependente de relogio real.
 *
 * ⭐ **2. Ao chegar no fim, PAUSA — nao da loop.**
 *
 * Um pregao tem comeco e fim. Quando a `position` alcanca o ultimo indice, o
 * replay para (pausa automatica) em vez de voltar ao inicio. O motivo e de
 * produto: quem revisa uma operacao quer ver o dia terminar e parar ali, nao
 * reiniciar em loop e reembaralhar a leitura. Loop e uma opcao FUTURA, deixada
 * de fora de proposito para nao ligar por default um comportamento que a maioria
 * dos usos nao quer. Se um dia entrar, sera uma flag explicita.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E A "BARRA EM FORMACAO" DO REPLAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `currentBar()` devolve a barra no indice corrente — a ultima barra revelada.
 * No replay ela faz o papel da "barra em formacao" de um grafico ao vivo: e a
 * barra que o operador esta vendo "acontecer agora" naquele ponto do historico.
 * A diferenca do ao vivo e que aqui ela ja esta fechada (e historico), mas do
 * ponto de vista da leitura ela e o presente do replay.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGRAS TRANSVERSAIS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - **Clamp em toda navegacao.** `position` nunca sai de `[0, length]`. Um pedido
 *   fora da faixa e limitado, nunca lancado.
 * - **Nunca lanca.** Nao ha `throw` em lugar nenhum. Entrada invalida (NaN,
 *   negativa, fracionaria) e saneada.
 * - **Serie vazia e estado valido.** `length === 0` -> `position` fica em 0,
 *   `revealedBars()` e vazia, `currentBar()` e `null`. Nada quebra.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Tipos locais — NAO importados de outro pacote de proposito
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma barra do replay. Tipo definido LOCALMENTE: este pacote e independente e
 * nao importa o contrato de barra de nenhum irmao do workspace. `volume` e
 * opcional — nem toda fonte o fornece, e o replay nao precisa dele para navegar.
 */
export interface ReplayBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/**
 * Contrato minimo de um agendador, injetado no `ReplayController`.
 *
 * ⚠️ Deliberadamente compativel com a assinatura de `setInterval`/`clearInterval`
 * do browser e do Node, mas SEM depender de nenhum dos dois. Isso mantem o
 * `handle` opaco (`unknown`): quem passa o timer sabe o tipo do handle; o
 * controlador so o guarda para devolver no `clear`.
 */
export interface TimerLike {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Instantaneo imutavel do estado do replay, para quem quiser observar. */
export interface ReplayState {
  readonly position: number;
  readonly length: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly atEnd: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// Utilitarios de saneamento — o nucleo nunca confia na entrada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Limita `n` ao inteiro em `[0, length]`. Nao finito ou negativo vira 0; valor
 * acima do teto vira `length`; fracionario e truncado para baixo.
 *
 * O teto e `length`, nao `length - 1`: `position === length` significa "todas as
 * barras reveladas, replay no fim". Com `length` barras, ha `length + 1` posicoes
 * validas (de 0 = nada revelado a `length` = tudo revelado).
 */
function clampPosition(n: number, length: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const inteiro = Math.floor(n);
  return inteiro > length ? length : inteiro;
}

/**
 * Saneia a velocidade em barras/segundo. Nao finita ou negativa vira 0 (parado);
 * o resto passa como esta. Zero e valido: significa "tocando, mas sem avancar" —
 * o `advanceByElapsed` simplesmente nao move.
 */
function sanitizeSpeed(barsPerSecond: number): number {
  if (!Number.isFinite(barsPerSecond) || barsPerSecond < 0) return 0;
  return barsPerSecond;
}

// ═════════════════════════════════════════════════════════════════════════════
// ReplayCore — o nucleo PURO e DETERMINISTICO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O nucleo do replay. Guarda estado (posicao, play/pause, velocidade) e a serie,
 * mas NAO conhece relogio real: o avanco automatico entra por `advanceByElapsed`,
 * que recebe o tempo decorrido de fora.
 *
 * Determinismo: dada a mesma serie, mesma `position` e mesma `speed`, chamar
 * `advanceByElapsed(deltaMs)` produz sempre o mesmo resultado. Nenhum sorteio,
 * nenhum `Date.now`, nenhum estado escondido.
 */
export class ReplayCore {
  private bars: readonly ReplayBar[];
  private pos: number;
  private isPlaying: boolean;
  private barsPerSecond: number;

  /**
   * Fracao de barra acumulada entre chamadas de `advanceByElapsed`.
   *
   * ⚠️ Existe porque o avanco e por tempo continuo mas a posicao e inteira. A
   * 2 barras/s, um tick de 100 ms vale 0,2 barra: sem acumular, cada tick
   * arredondaria para 0 e o replay nunca andaria. O acumulador guarda a sobra
   * ate fechar uma barra inteira. Faz parte do estado, entao `seek`/`step`/`play`
   * o zeram — depois de um salto manual nao faz sentido carregar sobra do passo
   * anterior.
   */
  private carry: number;

  constructor(bars: readonly ReplayBar[] = [], startPosition = 0) {
    this.bars = bars;
    this.pos = clampPosition(startPosition, bars.length);
    this.isPlaying = false;
    this.barsPerSecond = 1;
    this.carry = 0;
  }

  // ─── Leitura de estado ─────────────────────────────────────────────────────

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.bars.length;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get speed(): number {
    return this.barsPerSecond;
  }

  /** `true` quando a posicao alcancou o fim da serie. Serie vazia ja esta no fim. */
  atEnd(): boolean {
    return this.pos >= this.bars.length;
  }

  /** Instantaneo imutavel, conveniente para renderizar controles. */
  snapshot(): ReplayState {
    return {
      position: this.pos,
      length: this.bars.length,
      playing: this.isPlaying,
      speed: this.barsPerSecond,
      atEnd: this.atEnd(),
    };
  }

  // ─── Fatia visivel ─────────────────────────────────────────────────────────

  /**
   * As barras reveladas: de 0 (inclusive) ate `position` (exclusive). E o que o
   * grafico desenha.
   *
   * ⚠️ **E uma COPIA rasa** (`Array.prototype.slice`), nao uma view sobre o array
   * interno. A copia e rasa: os objetos `ReplayBar` sao compartilhados, nao
   * clonados — barreira de imutabilidade fica na `readonly` do tipo, nao em clone
   * profundo. O custo e O(position), aceitavel porque `position` cresce de uma em
   * uma no play e o resultado costuma ir direto para o grafico. Se um consumidor
   * precisar evitar ate a copia rasa em caminho quente, use `revealedCount()` +
   * indexacao propria sobre a serie que ele ja tem.
   */
  revealedBars(): ReplayBar[] {
    return this.bars.slice(0, this.pos);
  }

  /** Quantas barras estao reveladas (== `position`), sem alocar a fatia. */
  revealedCount(): number {
    return this.pos;
  }

  /**
   * A barra na posicao corrente — a "barra em formacao" do replay (ver cabecalho).
   * E a ultima barra revelada, no indice `position - 1`. `null` quando nada foi
   * revelado ainda (`position === 0`) ou a serie e vazia. `null` significa "nao
   * ha barra corrente", nunca uma barra zerada.
   */
  currentBar(): ReplayBar | null {
    if (this.pos <= 0) return null;
    return this.bars[this.pos - 1] ?? null;
  }

  // ─── Navegacao (sempre com clamp, nunca lanca) ───────────────────────────────

  /**
   * Avanca (`n > 0`) ou volta (`n < 0`) `n` barras, com clamp em `[0, length]`.
   * `n` fracionario e truncado; `n` nao finito e ignorado (nao move). Zera a
   * sobra acumulada: um passo manual e um salto, nao continuacao do fluxo.
   */
  step(n: number): void {
    if (!Number.isFinite(n)) return;
    this.pos = clampPosition(this.pos + Math.trunc(n), this.bars.length);
    this.carry = 0;
    this.pauseIfAtEnd();
  }

  /** Vai direto para `position`, com clamp. Zera a sobra acumulada. */
  seek(position: number): void {
    this.pos = clampPosition(position, this.bars.length);
    this.carry = 0;
    this.pauseIfAtEnd();
  }

  /**
   * Posiciona o replay na barra cujo `time` e o maior que nao ultrapassa `time`
   * (busca binaria; assume serie ordenada por `time` crescente, como um pregao).
   *
   * A posicao resultante e "essa barra revelada", ou seja o indice dela + 1. Se
   * `time` for anterior a primeira barra, vai para 0 (nada revelado). Se for
   * posterior a ultima, revela tudo. Serie vazia -> 0. Nao lanca.
   */
  seekToTime(time: number): void {
    const n = this.bars.length;
    if (n === 0 || !Number.isFinite(time)) {
      // Serie vazia ou time invalido: nada a fazer alem de garantir clamp.
      this.seek(this.pos);
      return;
    }

    // Busca binaria pelo ultimo indice com `bar.time <= time`.
    let lo = 0;
    let hi = n - 1;
    let encontrado = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const barra = this.bars[mid];
      if (barra !== undefined && barra.time <= time) {
        encontrado = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // `encontrado` e o indice da barra; revelar ate ela inclui-a, entao +1.
    this.seek(encontrado + 1);
  }

  // ─── Play / pause / velocidade ───────────────────────────────────────────────

  /**
   * Inicia o avanco automatico. Se ja estiver no fim, nao ha o que tocar: entra
   * pausado (nao da loop, ver cabecalho). Zera a sobra para o play comecar limpo.
   */
  play(): void {
    this.carry = 0;
    if (this.atEnd()) {
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
  }

  /** Para o avanco automatico. Idempotente. */
  pause(): void {
    this.isPlaying = false;
  }

  /** Define a velocidade em barras/segundo. Saneada (ver `sanitizeSpeed`). */
  setSpeed(barsPerSecond: number): void {
    this.barsPerSecond = sanitizeSpeed(barsPerSecond);
  }

  // ─── Avanco por tempo decorrido — o coracao puro do "play" ───────────────────

  /**
   * Avanca o replay conforme o tempo decorrido `deltaMs`, dado o estado atual
   * (`playing` e `speed`). Devolve quantas barras avancou.
   *
   * ⭐ **Este e o metodo que torna o replay testavel sem relogio.** A conta e:
   *
   *     barras = floor((deltaMs / 1000) * speed + carry)
   *
   * A sobra fracionaria fica no `carry` para o proximo tick (ver o campo). Como
   * nao consulta relogio nenhum, o resultado so depende de `deltaMs`, `speed`,
   * `position` e `carry` — logo e deterministico.
   *
   * Nao faz nada e devolve 0 se: nao esta tocando, `speed` e 0, `deltaMs` nao e
   * finito ou e <= 0, ou ja esta no fim. Ao alcancar o fim durante o avanco,
   * PAUSA automaticamente (nao da loop).
   */
  advanceByElapsed(deltaMs: number): number {
    if (!this.isPlaying) return 0;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    if (this.barsPerSecond <= 0) return 0;
    if (this.atEnd()) {
      this.isPlaying = false;
      return 0;
    }

    const barrasExatas = (deltaMs / 1000) * this.barsPerSecond + this.carry;
    const inteiras = Math.floor(barrasExatas);
    this.carry = barrasExatas - inteiras;

    if (inteiras <= 0) return 0;

    const anterior = this.pos;
    this.pos = clampPosition(this.pos + inteiras, this.bars.length);
    this.pauseIfAtEnd();
    return this.pos - anterior;
  }

  // ─── Substituicao da serie ───────────────────────────────────────────────────

  /**
   * Troca a serie (ex.: carregou outro pregao). Re-clampa a posicao a nova
   * extensao e zera a sobra. Serie vazia e aceita.
   */
  setBars(bars: readonly ReplayBar[]): void {
    this.bars = bars;
    this.pos = clampPosition(this.pos, bars.length);
    this.carry = 0;
  }

  /**
   * Pausa se a posicao alcancou o fim. Centraliza a regra "para no fim, nao da
   * loop" para que `step`, `seek` e `advanceByElapsed` a apliquem igual.
   */
  private pauseIfAtEnd(): void {
    if (this.atEnd()) this.isPlaying = false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ReplayController — o wrapper FINO que liga o nucleo a um timer INJETADO
// ═════════════════════════════════════════════════════════════════════════════

/** Opcoes de construcao do controlador com timer. */
export interface ReplayControllerOptions {
  /** Serie inicial. Default: vazia. */
  readonly bars?: readonly ReplayBar[];
  /** Posicao inicial. Default: 0. */
  readonly startPosition?: number;
  /** Velocidade inicial em barras/segundo. Default: herda o nucleo (1). */
  readonly speed?: number;
  /**
   * Periodo do tick do timer, em ms. Default: 100 ms (10 Hz).
   *
   * ⚠️ Nao e a velocidade do replay — essa e `speed` em barras/segundo. Isto e a
   * granularidade com que o timer cutuca o nucleo. O nucleo acumula a fracao de
   * barra entre ticks (ver `carry`), entao um tick mais lento nao perde barras,
   * so entrega o avanco em lotes maiores.
   */
  readonly tickMs?: number;
  /** Chamado apos cada tick que moveu a posicao (para redesenhar). Opcional. */
  readonly onAdvance?: (advanced: number, state: ReplayState) => void;
}

/**
 * Envolve `ReplayCore` e liga o avanco automatico a um `TimerLike` INJETADO.
 *
 * ⭐ E deliberadamente FINO: toda a logica de replay vive no nucleo puro. Este
 * wrapper so cuida de (a) ligar/desligar o timer no play/pause e (b) traduzir
 * cada tick em `advanceByElapsed(tickMs)`. Assim o comportamento continua
 * testavel pelo nucleo, e o wrapper e verificavel com um `TimerLike` falso.
 *
 * ⚠️ Este arquivo permanece SEM DOM: nao referencia `window`, `setInterval`
 * global nem nada do ambiente. Quem constroi o controlador passa o timer.
 */
export class ReplayController {
  readonly core: ReplayCore;
  private readonly timer: TimerLike;
  private readonly tickMs: number;
  private readonly onAdvance?: (advanced: number, state: ReplayState) => void;
  private handle: unknown = null;

  constructor(timer: TimerLike, options: ReplayControllerOptions = {}) {
    this.timer = timer;
    this.tickMs = Number.isFinite(options.tickMs) && (options.tickMs ?? 0) > 0 ? options.tickMs! : 100;
    this.onAdvance = options.onAdvance;
    this.core = new ReplayCore(options.bars ?? [], options.startPosition ?? 0);
    if (options.speed !== undefined) this.core.setSpeed(options.speed);
  }

  /** Inicia o replay e liga o timer, se ha o que tocar. */
  play(): void {
    this.core.play();
    // `core.play()` pode ter recusado (ja no fim): so liga o timer se de fato
    // ficou tocando.
    if (this.core.playing && this.handle === null) {
      this.handle = this.timer.setInterval(() => this.tick(), this.tickMs);
    }
  }

  /** Pausa o replay e desliga o timer. */
  pause(): void {
    this.core.pause();
    this.stopTimer();
  }

  /** Um passo do timer: avanca pelo periodo e, se o nucleo pausou (fim), desliga. */
  private tick(): void {
    const avancou = this.core.advanceByElapsed(this.tickMs);
    if (avancou > 0 && this.onAdvance) this.onAdvance(avancou, this.core.snapshot());
    // O nucleo pausa sozinho ao chegar no fim; refletimos isso desligando o timer.
    if (!this.core.playing) this.stopTimer();
  }

  private stopTimer(): void {
    if (this.handle !== null) {
      this.timer.clearInterval(this.handle);
      this.handle = null;
    }
  }

  /** Encerra o controlador, garantindo que o timer seja liberado. */
  dispose(): void {
    this.stopTimer();
  }
}
