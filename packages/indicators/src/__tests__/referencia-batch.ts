/**
 * referencia-batch — os indicadores calculados EM LOTE, pela definição, para conferir os
 * incrementais.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE UMA SEGUNDA IMPLEMENTAÇÃO, E POR QUE ELA É LEGÍTIMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Duas implementações do mesmo indicador normalmente são um defeito esperando para
 * divergir. Aqui é o contrário: é o INSTRUMENTO DE MEDIDA. O pacote é incremental por
 * contrato (`warmup` + `update` O(1) com estado rolante), e o property test que existe
 * prova *incremental == batch* **rodando o mesmo código nas duas pontas** — então ele não
 * pode achar erro na fórmula, só na costura.
 *
 * ⭐⭐ E a fórmula ERRA. Dois defeitos reais já foram encontrados exatamente assim:
 *
 * - **ROC e Momentum** usavam defasagem `period + 1`: a janela tinha um elemento a mais que
 *   o declarado. Nenhum teste de propriedade veria — a série era autoconsistente.
 * - **LSMA** errava a partir da SEGUNDA emissão: o acumulador de `Σ(i·y)` não devolvia o
 *   elemento que saía da janela.
 *
 * Taxa: **2 defeitos em 12 indicadores** conferidos. Foi o que motivou conferir os outros 20.
 *
 * ⭐ O que torna esta segunda implementação um instrumento e não uma cópia:
 *
 * 1. **É BATCH.** Reconstrói a janela inteira a cada ponto, sem estado rolante. Todo defeito
 *    de estado (soma que não devolve o que saiu, seed de EMA errado, janela deslocada por um)
 *    é INEXPRIMÍVEL aqui — e é justamente a classe dos dois defeitos achados.
 * 2. **Escrita da DEFINIÇÃO**, não da implementação. Cada função abaixo é a fórmula de livro
 *    transcrita, sem consultar o `.ts` correspondente.
 * 3. **Ela própria é PINADA** por valores literais no `.spec` (âncoras em três índices,
 *    calculados fora, em Python). Sem isso a referência poderia derivar junto com o erro.
 *
 * ⚠️ Não é `.core.ts`: é código de bancada, não entra no build do pacote (`__tests__` é
 * excluído) e não deve ser importado por nada de produção. Se um dia for útil em produção,
 * o caminho é usar o incremental — que é o que existe para isso.
 *
 * ⚠️ **CONVENÇÃO DE AQUECIMENTO, e ela é contrato, não gosto:** a EMA daqui semeia com a SMA
 * dos `n` primeiros pontos e só então emite, igual a `EmaState`. Semear com o primeiro valor
 * (o outro costume) daria números diferentes para sempre, e a divergência seria da convenção,
 * não de defeito — ruído que afogaria o sinal que se quer medir.
 */

/** Uma barra, no mínimo que estes cálculos precisam. */
export interface BarraDeReferencia {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly buyVolume?: number;
  readonly sellVolume?: number;
}

/** `null` = "ainda aquecendo". Nunca zero. */
export type Serie = readonly (number | null)[];

// ═════════════════════════════════════════════════════════════════════════════
// Médias, em lote
// ═════════════════════════════════════════════════════════════════════════════

export function smaRef(xs: Serie, n: number): Serie {
  const out: (number | null)[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    let soma = 0;
    let ok = true;
    for (let k = i - n + 1; k <= i; k += 1) {
      const v = xs[k];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      soma += v;
    }
    out.push(ok ? soma / n : null);
  }
  return out;
}

/**
 * EMA com semente = SMA dos `n` primeiros valores NÃO NULOS.
 *
 * ⚠️ Os `null` de entrada são atravessados sem consumir posição do aquecimento: é assim que a
 * cascata (`EMA` de `EMA`) funciona, e é o que `EmaState` faz ao receber o valor do estágio
 * anterior só quando ele existe.
 */
export function emaRef(xs: Serie, n: number): Serie {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  const k = 2 / (n + 1);
  let atual: number | null = null;
  const semente: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    if (x === null || x === undefined) continue;
    if (atual === null) {
      semente.push(x);
      if (semente.length < n) continue;
      atual = semente.reduce((a, b) => a + b, 0) / n;
      out[i] = atual;
      continue;
    }
    atual = atual + k * (x - atual);
    out[i] = atual;
  }
  return out;
}

/** Suavização de Wilder: mesma semente da EMA, mas `k = 1/n`. */
export function wilderRef(xs: Serie, n: number): Serie {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  let atual: number | null = null;
  const semente: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    if (x === null || x === undefined) continue;
    if (atual === null) {
      semente.push(x);
      if (semente.length < n) continue;
      atual = semente.reduce((a, b) => a + b, 0) / n;
      out[i] = atual;
      continue;
    }
    atual = atual + (x - atual) / n;
    out[i] = atual;
  }
  return out;
}

/** WMA com pesos `1..n`, o mais novo com peso `n`. */
export function wmaRef(xs: Serie, n: number): Serie {
  const out: (number | null)[] = [];
  const den = (n * (n + 1)) / 2;
  for (let i = 0; i < xs.length; i += 1) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    let num = 0;
    let ok = true;
    for (let k = 0; k < n; k += 1) {
      const v = xs[i - n + 1 + k];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      num += (k + 1) * v;
    }
    out.push(ok ? num / den : null);
  }
  return out;
}

/** Desvio padrão POPULACIONAL da janela (divisor `n`, não `n-1`). */
export function stdRef(xs: Serie, n: number): Serie {
  const out: (number | null)[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    const janela: number[] = [];
    let ok = true;
    for (let k = i - n + 1; k <= i; k += 1) {
      const v = xs[k];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      janela.push(v);
    }
    if (!ok) {
      out.push(null);
      continue;
    }
    const m = janela.reduce((a, b) => a + b, 0) / n;
    const varia = janela.reduce((a, b) => a + (b - m) * (b - m), 0) / n;
    out.push(Math.sqrt(varia));
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Insumos de barra
// ═════════════════════════════════════════════════════════════════════════════

export function closesDe(bs: readonly BarraDeReferencia[]): number[] {
  return bs.map((b) => b.close);
}

/** True Range. A primeira barra é `high − low` (não há fechamento anterior). */
export function trRef(bs: readonly BarraDeReferencia[]): number[] {
  return bs.map((b, i) => {
    const hl = b.high - b.low;
    if (i === 0) return hl;
    const c = bs[i - 1]!.close;
    return Math.max(hl, Math.abs(b.high - c), Math.abs(b.low - c));
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Os indicadores
// ═════════════════════════════════════════════════════════════════════════════

export function bollingerRef(
  bs: readonly BarraDeReferencia[],
  n = 20,
  mult = 2,
): { upper: Serie; middle: Serie; lower: Serie } {
  const c = closesDe(bs);
  const m = smaRef(c, n);
  const s = stdRef(c, n);
  return {
    middle: m,
    upper: m.map((v, i) => (v === null ? null : v + mult * (s[i] as number))),
    lower: m.map((v, i) => (v === null ? null : v - mult * (s[i] as number))),
  };
}

export function keltnerRef(
  bs: readonly BarraDeReferencia[],
  n = 20,
  nAtr = 10,
  mult = 2,
): { upper: Serie; middle: Serie; lower: Serie } {
  const m = emaRef(closesDe(bs), n);
  const atr = wilderRef(trRef(bs), nAtr);
  const compor = (sinal: number): Serie =>
    m.map((v, i) => {
      const a = atr[i];
      return v === null || a === null || a === undefined ? null : v + sinal * mult * a;
    });
  return { middle: m, upper: compor(1), lower: compor(-1) };
}

/** DEMA = 2·e1 − e2. */
export function demaRef(xs: Serie, n = 20): Serie {
  const e1 = emaRef(xs, n);
  const e2 = emaRef(e1, n);
  return e1.map((a, i) => {
    const b = e2[i];
    return a === null || b === null || b === undefined ? null : 2 * a - b;
  });
}

/** TEMA = 3·e1 − 3·e2 + e3. */
export function temaRef(xs: Serie, n = 20): Serie {
  const e1 = emaRef(xs, n);
  const e2 = emaRef(e1, n);
  const e3 = emaRef(e2, n);
  return e1.map((a, i) => {
    const b = e2[i];
    const c = e3[i];
    if (a === null || b === null || b === undefined || c === null || c === undefined) return null;
    return 3 * a - 3 * b + c;
  });
}

/** HMA = WMA( 2·WMA(n/2) − WMA(n), √n ). */
export function hmaRef(xs: Serie, n = 16): Serie {
  const meio = Math.max(1, Math.round(n / 2));
  const raiz = Math.max(1, Math.round(Math.sqrt(n)));
  const r = wmaRef(xs, meio);
  const l = wmaRef(xs, n);
  const diff = r.map((a, i) => {
    const b = l[i];
    return a === null || b === null || b === undefined ? null : 2 * a - b;
  });
  return wmaRef(diff, raiz);
}

/**
 * KAMA: `sc = (ER·(2/(fast+1) − 2/(slow+1)) + 2/(slow+1))²`, aplicado como EMA de fator variável.
 *
 * ⚠️ A semente é o preço ANTERIOR ao primeiro ponto em que a janela de `n+1` fecha — é a
 * convenção da implementação, e sem uma semente explícita o primeiro `sc` seria aplicado a nada.
 */
export function kamaRef(xs: readonly number[], n = 10, fast = 2, slow = 30): Serie {
  const fsc = 2 / (fast + 1);
  const ssc = 2 / (slow + 1);
  const out: (number | null)[] = new Array(xs.length).fill(null);
  const varia: number[] = [];
  let k: number | null = null;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i]!;
    varia.push(i === 0 ? 0 : Math.abs(x - xs[i - 1]!));
    const mediaVar =
      varia.length >= n ? varia.slice(-n).reduce((a, b) => a + b, 0) / n : null;
    const maisAntigo = i >= n ? xs[i - n]! : null;
    if (k === null) {
      if (mediaVar === null || maisAntigo === null) continue;
      k = xs[i - 1]!;
    }
    const caminho = mediaVar === null ? 0 : mediaVar * n;
    const er = caminho > 0 && maisAntigo !== null ? Math.abs(x - maisAntigo) / caminho : 0;
    const sc = (er * (fsc - ssc) + ssc) ** 2;
    k = k + sc * (x - k);
    out[i] = k;
  }
  return out;
}

/** TRIX = variação percentual da EMA tripla, com sinal. */
export function trixRef(
  xs: Serie,
  n = 15,
  nSinal = 9,
): { value: Serie; signal: Serie } {
  const e3 = emaRef(emaRef(emaRef(xs, n), n), n);
  const value: (number | null)[] = new Array(xs.length).fill(null);
  let ant: number | null = null;
  for (let i = 0; i < xs.length; i += 1) {
    const t = e3[i];
    if (t === null || t === undefined) continue;
    if (ant === null || ant === 0) {
      ant = t;
      continue;
    }
    value[i] = (100 * (t - ant)) / ant;
    ant = t;
  }
  return { value, signal: emaRef(value, nSinal) };
}

/** PPO = 100·(EMA rápida − EMA lenta) / EMA lenta. */
export function ppoRef(
  xs: Serie,
  nF = 12,
  nL = 26,
  nS = 9,
): { value: Serie; signal: Serie; hist: Serie } {
  const f = emaRef(xs, nF);
  const l = emaRef(xs, nL);
  const value = f.map((a, i) => {
    const b = l[i];
    if (a === null || b === null || b === undefined || b === 0) return null;
    return (100 * (a - b)) / b;
  });
  const signal = emaRef(value, nS);
  return {
    value,
    hist: value.map((v, i) => {
      const s = signal[i];
      return v === null || s === null || s === undefined ? null : v - s;
    }),
    signal,
  };
}

/** RSI de Wilder. Insumo do Stoch RSI. */
export function rsiRef(xs: readonly number[], n = 14): Serie {
  const g: (number | null)[] = [null];
  const p: (number | null)[] = [null];
  for (let i = 1; i < xs.length; i += 1) {
    const d = xs[i]! - xs[i - 1]!;
    g.push(Math.max(d, 0));
    p.push(Math.max(-d, 0));
  }
  const ag = wilderRef(g, n);
  const ap = wilderRef(p, n);
  return ag.map((a, i) => {
    const b = ap[i];
    if (a === null || b === null || b === undefined) return null;
    if (b === 0) return 100;
    return 100 - 100 / (1 + a / b);
  });
}

/**
 * Suaviza por SMA ignorando os `null` de aquecimento — a janela conta só pontos existentes.
 *
 * ⚠️ Necessário porque a implementação alimenta o suavizador SÓ quando o estágio anterior
 * emite. Contar os `null` como posição atrasaria a saída em `n` barras.
 */
function suavizarIgnorandoNulos(src: Serie, n: number): Serie {
  const densos: number[] = [];
  for (const v of src) if (v !== null && v !== undefined) densos.push(v);
  const sm = smaRef(densos, n);
  const out: (number | null)[] = new Array(src.length).fill(null);
  let p = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === null || src[i] === undefined) continue;
    out[i] = sm[p] ?? null;
    p += 1;
  }
  return out;
}

/** Stoch RSI: estocástico DO RSI, suavizado duas vezes. */
export function stochRsiRef(
  xs: readonly number[],
  nRsi = 14,
  nStoch = 14,
  nK = 3,
  nD = 3,
): { k: Serie; d: Serie } {
  const r = rsiRef(xs, nRsi);
  const indices: number[] = [];
  for (let i = 0; i < r.length; i += 1) if (r[i] !== null) indices.push(i);
  const cru: (number | null)[] = new Array(xs.length).fill(null);
  for (let j = 0; j < indices.length; j += 1) {
    if (j < nStoch - 1) continue;
    const janela = indices.slice(j - nStoch + 1, j + 1).map((i) => r[i] as number);
    const hi = Math.max(...janela);
    const lo = Math.min(...janela);
    const atual = r[indices[j]!] as number;
    cru[indices[j]!] = hi === lo ? 0 : (100 * (atual - lo)) / (hi - lo);
  }
  const k = suavizarIgnorandoNulos(cru, nK);
  return { k, d: suavizarIgnorandoNulos(k, nD) };
}

/**
 * Aroon: mede TEMPO, não preço. `up = 100·(n − barras desde a máxima)/n`.
 *
 * ⚠️ Empate resolvido pela ocorrência MAIS RECENTE (a máxima "acabou de acontecer"), que é a
 * convenção usual e a que a implementação usa. A escolha importa: num platô, resolver pelo mais
 * antigo faria o Aroon cair mesmo com o preço no topo.
 */
export function aroonRef(
  bs: readonly BarraDeReferencia[],
  n = 25,
): { up: Serie; down: Serie; osc: Serie } {
  const up: (number | null)[] = new Array(bs.length).fill(null);
  const down: (number | null)[] = new Array(bs.length).fill(null);
  for (let i = 0; i < bs.length; i += 1) {
    if (i < n - 1) continue;
    let iMax = 0;
    let iMin = 0;
    for (let k = 1; k < n; k += 1) {
      if (bs[i - n + 1 + k]!.high >= bs[i - n + 1 + iMax]!.high) iMax = k;
      if (bs[i - n + 1 + k]!.low <= bs[i - n + 1 + iMin]!.low) iMin = k;
    }
    up[i] = (100 * (n - (n - 1 - iMax))) / n;
    down[i] = (100 * (n - (n - 1 - iMin))) / n;
  }
  return {
    up,
    down,
    osc: up.map((v, i) => (v === null ? null : v - (down[i] as number))),
  };
}

/** Choppiness = 100·log10(ΣTR / (máxima − mínima)) / log10(n). Mede REGIME. */
export function choppinessRef(bs: readonly BarraDeReferencia[], n = 14): Serie {
  const tr = trRef(bs);
  const out: (number | null)[] = new Array(bs.length).fill(null);
  for (let i = 0; i < bs.length; i += 1) {
    if (i < n - 1) continue;
    let soma = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - n + 1; k <= i; k += 1) {
      soma += tr[k]!;
      hi = Math.max(hi, bs[k]!.high);
      lo = Math.min(lo, bs[k]!.low);
    }
    const rng = hi - lo;
    if (!(rng > 0) || !(soma > 0)) continue;
    out[i] = (100 * Math.log10(soma / rng)) / Math.log10(Math.max(2, n));
  }
  return out;
}

/** BOP = (fechamento − abertura) / (máxima − mínima): quem ganhou a barra POR DENTRO dela. */
export function bopRef(
  bs: readonly BarraDeReferencia[],
  nMedia = 14,
): { value: Serie; media: Serie } {
  const value = bs.map((b) => (b.high === b.low ? null : (b.close - b.open) / (b.high - b.low)));
  return { value, media: smaRef(value, nMedia) };
}

/** ADL: acumula `((C−L) − (H−C)) / (H−L) · V`. */
export function adlRef(bs: readonly BarraDeReferencia[]): Serie {
  let acc = 0;
  return bs.map((b) => {
    const rng = b.high - b.low;
    const mfm = rng > 0 ? (b.close - b.low - (b.high - b.close)) / rng : 0;
    acc += mfm * b.volume;
    return acc;
  });
}

/** Force Index = EMA( (C − C anterior) · V ). */
export function forceIndexRef(bs: readonly BarraDeReferencia[], n = 13): Serie {
  const f: (number | null)[] = [null];
  for (let i = 1; i < bs.length; i += 1) {
    f.push((bs[i]!.close - bs[i - 1]!.close) * bs[i]!.volume);
  }
  return emaRef(f, n);
}

/** Elder Ray: distância da máxima e da mínima até a EMA. */
export function elderRayRef(
  bs: readonly BarraDeReferencia[],
  n = 13,
): { bull: Serie; bear: Serie } {
  const e = emaRef(closesDe(bs), n);
  return {
    bull: e.map((v, i) => (v === null ? null : bs[i]!.high - v)),
    bear: e.map((v, i) => (v === null ? null : bs[i]!.low - v)),
  };
}

/**
 * ADX/DMI de Wilder.
 *
 * ⚠️ O movimento direcional é EXCLUSIVO: só o maior dos dois conta, e empate zera os dois. Um
 * `>=` no lugar do `>` fabricaria direção em barra interna.
 */
export function adxRef(
  bs: readonly BarraDeReferencia[],
  n = 14,
): { adx: Serie; plus_di: Serie; minus_di: Serie } {
  const pdm: (number | null)[] = [null];
  const ndm: (number | null)[] = [null];
  const tr: (number | null)[] = [null];
  for (let i = 1; i < bs.length; i += 1) {
    const up = bs[i]!.high - bs[i - 1]!.high;
    const dn = bs[i - 1]!.low - bs[i]!.low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    const c = bs[i - 1]!.close;
    tr.push(Math.max(bs[i]!.high - bs[i]!.low, Math.abs(bs[i]!.high - c), Math.abs(bs[i]!.low - c)));
  }
  const atr = wilderRef(tr, n);
  const ap = wilderRef(pdm, n);
  const an = wilderRef(ndm, n);
  const plus: (number | null)[] = new Array(bs.length).fill(null);
  const minus: (number | null)[] = new Array(bs.length).fill(null);
  const dx: (number | null)[] = new Array(bs.length).fill(null);
  for (let i = 0; i < bs.length; i += 1) {
    const a = atr[i];
    const p = ap[i];
    const m = an[i];
    if (a === null || a === undefined || a === 0) continue;
    if (p === null || p === undefined || m === null || m === undefined) continue;
    plus[i] = (100 * p) / a;
    minus[i] = (100 * m) / a;
    const soma = (plus[i] as number) + (minus[i] as number);
    dx[i] = soma === 0 ? 0 : (100 * Math.abs((plus[i] as number) - (minus[i] as number))) / soma;
  }
  return { adx: wilderRef(dx, n), plus_di: plus, minus_di: minus };
}

/** VWAP por SESSÃO, com preço típico `hlc3`. A sessão vira em `floor(time/86400)`. */
export function vwapRef(
  bs: readonly BarraDeReferencia[],
  times: readonly number[],
): Serie {
  const out: (number | null)[] = [];
  let sessao: number | null = null;
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < bs.length; i += 1) {
    const dia = Math.floor(times[i]! / 86_400);
    if (dia !== sessao) {
      sessao = dia;
      pv = 0;
      vv = 0;
    }
    const b = bs[i]!;
    const hlc3 = (b.high + b.low + b.close) / 3;
    pv += hlc3 * b.volume;
    vv += b.volume;
    out.push(vv > 0 ? pv / vv : null);
  }
  return out;
}

/** Delta por barra e sua média. `null` quando a barra não traz agressor. */
export function deltaRef(
  bs: readonly BarraDeReferencia[],
  nMedia = 1,
): { value: Serie; media: Serie } {
  const value = bs.map((b) =>
    b.buyVolume === undefined || b.sellVolume === undefined ? null : b.buyVolume - b.sellVolume,
  );
  // ⚠️ A média consome SÓ as barras com agressor. Empurrar zero nas outras confundiria
  // "sem dado" com "equilíbrio", e o erro se arrastaria pela janela inteira.
  return { value, media: suavizarIgnorandoNulos(value, nMedia) };
}

/** CVD: delta acumulado, mais a fração de barras classificadas. */
export function cvdRef(bs: readonly BarraDeReferencia[]): { value: Serie; cobertura: Serie } {
  let acc = 0;
  let com = 0;
  const value: number[] = [];
  const cobertura: (number | null)[] = [];
  for (let i = 0; i < bs.length; i += 1) {
    const b = bs[i]!;
    if (b.buyVolume !== undefined && b.sellVolume !== undefined) {
      acc += b.buyVolume - b.sellVolume;
      com += 1;
    }
    value.push(acc);
    cobertura.push((100 * com) / (i + 1));
  }
  return { value, cobertura };
}

/** Delta % = 100·(compra − venda)/(compra + venda), com EMA. */
export function deltaRatioRef(
  bs: readonly BarraDeReferencia[],
  nEma = 9,
): { value: Serie; ema: Serie } {
  const value = bs.map((b) => {
    if (b.buyVolume === undefined || b.sellVolume === undefined) return null;
    const soma = b.buyVolume + b.sellVolume;
    return soma > 0 ? (100 * (b.buyVolume - b.sellVolume)) / soma : null;
  });
  return { value, ema: emaRef(value, nEma) };
}
