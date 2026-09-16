/**
 * rolling.core — acumuladores de estado rolante O(1). PUROS de dependencia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os blocos de construcao de todo indicador incremental: media movel simples,
 * exponencial, de Wilder, janela deslizante, verdadeiro alcance. Cada um consome
 * um valor por vez em tempo constante e guarda o minimo de estado.
 *
 * São CLASSES com estado mutavel — a unica parte do pacote que muta de proposito,
 * porque estado rolante É mutacao controlada. A pureza aqui e outra: nenhuma
 * dependencia externa, nenhum DOM, saida funcao unica da sequencia de entradas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ARMADILHA NUMERICA QUE DECIDE SE INCREMENTAL == BATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A SMA ingenua guarda a soma e faz `soma += novo - antigo`. Isso ACUMULA erro de
 * ponto flutuante: depois de milhares de barras, a soma rolante difere da soma
 * recalculada, e a propriedade "incremental == batch" falha por ulps que crescem.
 *
 * A saida e a **soma de Kahan** (soma compensada): guarda um termo de correcao que
 * captura o erro perdido a cada adicao e o reinjeta. Custa uma subtracao e uma
 * soma a mais por passo — irrelevante — e mantem a soma rolante estavel o
 * suficiente para bater com o batch dentro de tolerancia apertada.
 *
 * Sem isso, o teste central do pacote (incremental == batch) falharia em janelas
 * longas, e a falha seria intermitente e dificil de diagnosticar. Registrado aqui
 * porque e o tipo de decisao que parece over-engineering ate a suite provar que
 * nao e.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Soma compensada de Kahan
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Soma que resiste ao acumulo de erro de ponto flutuante.
 *
 * Mantem um termo de compensacao `c` com o que se perdeu no arredondamento da
 * ultima adicao, e o reinjeta na proxima. E o que permite somar e subtrair da
 * janela por milhares de passos sem a soma derivar.
 */
export class KahanSum {
  private sum = 0;
  private c = 0;

  add(x: number): void {
    const y = x - this.c;
    const t = this.sum + y;
    // `(t - sum)` recupera a parte de `y` que "coube" na soma; subtrair de `y`
    // deixa em `c` a parte que se perdeu no arredondamento.
    this.c = t - this.sum - y;
    this.sum = t;
  }

  /** Subtrair e somar o negativo — a compensacao vale nos dois sentidos. */
  subtract(x: number): void {
    this.add(-x);
  }

  value(): number {
    return this.sum;
  }

  reset(): void {
    this.sum = 0;
    this.c = 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Janela deslizante
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Buffer circular de tamanho fixo. O(1) para empurrar e para ler o que saiu.
 *
 * Circular, e nao um array com `shift()`: `shift` e O(n) porque reindexar o array
 * inteiro a cada barra, e num pipeline de milhares de barras isso vira o gargalo
 * silencioso. O buffer circular sobrescreve a posicao mais antiga em O(1).
 */
export class RingWindow {
  private readonly buf: Float64Array;
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Float64Array(Math.max(1, capacity));
  }

  /** Empurra um valor. Devolve o que SAIU da janela, ou `null` se ainda enchendo. */
  push(x: number): number | null {
    const cheia = this.count === this.capacity;
    const saiu = cheia ? (this.buf[this.head] as number) : null;
    this.buf[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
    if (!cheia) this.count += 1;
    return saiu;
  }

  isFull(): boolean {
    return this.count === this.capacity;
  }

  size(): number {
    return this.count;
  }

  /** Itera os valores na ordem de insercao (mais antigo -> mais novo). */
  forEach(fn: (x: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.capacity * 2) % this.capacity;
      fn(this.buf[idx] as number);
    }
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SMA — media movel simples
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Media dos ultimos `period` valores.
 *
 * Usa janela circular + soma de Kahan: O(1) por passo, estavel em janela longa.
 */
export class SmaState {
  private readonly win: RingWindow;
  private readonly sum = new KahanSum();

  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
  }

  /** Consome um valor. `null` enquanto a janela nao encheu. */
  push(x: number): number | null {
    const saiu = this.win.push(x);
    this.sum.add(x);
    if (saiu !== null) this.sum.subtract(saiu);
    return this.win.isFull() ? this.sum.value() / this.period : null;
  }

  /** O valor COMO SE `x` entrasse, sem mutar. Para a barra em formacao. */
  peek(x: number): number | null {
    if (!this.win.isFull()) {
      // Ainda enchendo: so ha valor se este `x` for o que completa a janela.
      return this.win.size() + 1 === this.period
        ? (this.sum.value() + x) / this.period
        : null;
    }
    // Cheia: o mais antigo sairia. Reconstroi a soma sem ele, sem tocar no estado.
    let soma = this.sum.value() + x;
    let maisAntigo = 0;
    let primeiro = true;
    this.win.forEach((v) => {
      if (primeiro) {
        maisAntigo = v;
        primeiro = false;
      }
    });
    soma -= maisAntigo;
    return soma / this.period;
  }

  reset(): void {
    this.win.reset();
    this.sum.reset();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EMA — media movel exponencial
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Media exponencial com semente por SMA.
 *
 * ⚠️ A SEMENTE importa e e onde implementacoes divergem. A definicao classica
 * (e a que o batch de referencia usa) semeia a EMA com a SMA das primeiras
 * `period` barras, e so entao aplica a recorrencia. Semear com o primeiro valor,
 * ou com zero, produz uma serie sutilmente diferente nas primeiras dezenas de
 * barras — e como MACD e derivados consomem EMA, a diferenca se propaga.
 *
 * Aqui: acumula ate ter `period` valores, emite a SMA deles como primeira EMA, e
 * dali em diante aplica `ema = ema + k*(x - ema)` com `k = 2/(period+1)`.
 */
export class EmaState {
  private readonly k: number;
  private ema: number | null = null;
  private seed = new KahanSum();
  private seedCount = 0;

  constructor(private readonly period: number) {
    this.k = 2 / (period + 1);
  }

  push(x: number): number | null {
    if (this.ema === null) {
      this.seed.add(x);
      this.seedCount += 1;
      if (this.seedCount < this.period) return null;
      this.ema = this.seed.value() / this.period;
      return this.ema;
    }
    this.ema = this.ema + this.k * (x - this.ema);
    return this.ema;
  }

  peek(x: number): number | null {
    if (this.ema === null) {
      if (this.seedCount + 1 < this.period) return null;
      return (this.seed.value() + x) / this.period;
    }
    return this.ema + this.k * (x - this.ema);
  }

  current(): number | null {
    return this.ema;
  }

  reset(): void {
    this.ema = null;
    this.seed.reset();
    this.seedCount = 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RMA / suavizacao de Wilder
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Media suavizada de Wilder (RMA), com `k = 1/period`.
 *
 * NAO e a EMA com outro fator: e a suavizacao que Wilder definiu para RSI, ATR e
 * ADX, e usar EMA no lugar dela produz valores proximos porem ERRADOS por
 * definicao. Muitas bibliotecas confundem as duas; aqui sao classes separadas de
 * proposito, para o RSI bater com a referencia.
 *
 * Semeia com a media simples das primeiras `period` amostras, como o RSI classico.
 */
export class WilderState {
  private readonly k: number;
  private avg: number | null = null;
  private seed = new KahanSum();
  private seedCount = 0;

  constructor(private readonly period: number) {
    this.k = 1 / period;
  }

  push(x: number): number | null {
    if (this.avg === null) {
      this.seed.add(x);
      this.seedCount += 1;
      if (this.seedCount < this.period) return null;
      this.avg = this.seed.value() / this.period;
      return this.avg;
    }
    this.avg = this.avg + this.k * (x - this.avg);
    return this.avg;
  }

  peek(x: number): number | null {
    if (this.avg === null) {
      if (this.seedCount + 1 < this.period) return null;
      return (this.seed.value() + x) / this.period;
    }
    return this.avg + this.k * (x - this.avg);
  }

  current(): number | null {
    return this.avg;
  }

  reset(): void {
    this.avg = null;
    this.seed.reset();
    this.seedCount = 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Desvio padrao rolante
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Desvio padrao populacional dos ultimos `period` valores.
 *
 * Guarda soma e soma dos quadrados, ambas compensadas por Kahan — a variancia por
 * `E[x^2] - E[x]^2` e classicamente instavel (subtrai dois numeros grandes e
 * proximos), e sem compensacao o valor pode ate ficar levemente NEGATIVO por erro
 * de ponto flutuante, produzindo `NaN` na raiz. O `Math.max(0, ...)` antes da raiz
 * e o cinto de seguranca para esse caso residual.
 *
 * Populacional (divide por `period`), nao amostral (`period-1`), porque e a
 * convencao das Bandas de Bollinger — a definicao original divide por N.
 */
export class StdDevState {
  private readonly win: RingWindow;
  private readonly sum = new KahanSum();
  private readonly sumSq = new KahanSum();

  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
  }

  push(x: number): { mean: number; stddev: number } | null {
    const saiu = this.win.push(x);
    this.sum.add(x);
    this.sumSq.add(x * x);
    if (saiu !== null) {
      this.sum.subtract(saiu);
      this.sumSq.subtract(saiu * saiu);
    }
    if (!this.win.isFull()) return null;
    const mean = this.sum.value() / this.period;
    const variancia = Math.max(0, this.sumSq.value() / this.period - mean * mean);
    return { mean, stddev: Math.sqrt(variancia) };
  }

  reset(): void {
    this.win.reset();
    this.sum.reset();
    this.sumSq.reset();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Verdadeiro alcance (True Range)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * True Range: o maior entre (H-L), |H - fechamento anterior| e |L - fechamento
 * anterior|.
 *
 * Precisa do fechamento da barra ANTERIOR, entao guarda esse unico numero. Na
 * PRIMEIRA barra nao ha anterior, e o TR e simplesmente H-L — nao `null`, porque
 * a primeira barra tem alcance de verdade e descartar isso atrasaria o ATR em uma
 * barra sem motivo.
 */
export class TrueRangeState {
  private prevClose: number | null = null;

  push(high: number, low: number, close: number): number {
    const hl = high - low;
    const tr =
      this.prevClose === null
        ? hl
        : Math.max(hl, Math.abs(high - this.prevClose), Math.abs(low - this.prevClose));
    this.prevClose = close;
    return tr;
  }

  peek(high: number, low: number): number {
    const hl = high - low;
    return this.prevClose === null
      ? hl
      : Math.max(hl, Math.abs(high - this.prevClose), Math.abs(low - this.prevClose));
  }

  reset(): void {
    this.prevClose = null;
  }
}
