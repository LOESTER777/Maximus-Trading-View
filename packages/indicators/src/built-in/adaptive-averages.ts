/**
 * adaptive-averages — medias que respondem MAIS RAPIDO sem o atraso da SMA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA COMUM QUE AS QUATRO ATACAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Toda media movel troca ruido por ATRASO: quanto mais lisa, mais tarde ela vira. Numa mesa isso
 * custa dinheiro duas vezes — entra tarde na virada e sai tarde do fim do movimento. As quatro
 * daqui atacam o atraso por caminhos diferentes:
 *
 *   HMA  — cancela o atraso por CONSTRUCAO: uma combinacao de WMAs cuja soma de defasagens se
 *          anula. Vira quase junto com o preco, ao custo de passar do ponto (overshoot).
 *   VWMA — pondera por VOLUME: barra de 50 mil contratos pesa mais que uma de 500. Onde ha
 *          leilao e negocio direto, e a media que representa "o preco onde de fato houve
 *          negocio".
 *   KAMA — ADAPTA a velocidade a eficiencia do movimento: rapida em tendencia, quase parada em
 *          lateralizacao. E a resposta direta a "a media chicoteia no range".
 *   LSMA — a reta de MINIMOS QUADRADOS da janela, avaliada no ultimo ponto. Nao e uma media com
 *          atraso: e uma projecao da tendencia local.
 *
 * ⚠️ Todas incrementais e O(1) por barra, como o contrato do pacote exige. Onde a formula
 * classica pede um laco pela janela (LSMA), o estado guarda as SOMAS necessarias e o laco
 * desaparece — ver a nota em `LsmaLogic`.
 */

import {
  numParam,
  priceOf,
  SOURCE_PARAM_SPEC,
  sourceParam,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type ParamSpec,
  type PriceSource,
} from '../contracts.js';
import { EmaState, KahanSum, RingWindow, SmaState } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

const periodSpec = (def: number, name = 'period', label = 'Período'): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

/**
 * ⭐ A especificacao CANONICA de fonte de preco, reusada e nao copiada.
 *
 * ⚠️ Duas bancadas pegaram a copia local que eu havia escrito: uma reprova parametro `source`
 * sem `options` (a interface nao teria de onde montar o seletor) e outra reprova lista de opcoes
 * DIVERGENTE da canonica. Reusar e o unico jeito de as duas nunca mais reprovarem.
 */
const sourceSpec: ParamSpec = SOURCE_PARAM_SPEC;

// ═════════════════════════════════════════════════════════════════════════════
// WMA rolante — a peca que a HMA precisa tres vezes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Media ponderada linearmente (peso `i` para a i-esima barra da janela), em O(1).
 *
 * ⭐ A recorrencia que evita o laco: mantendo `soma` (simples) e `somaPesada`
 * (`Σ i·x[i]`), ao entrar `x` e sair `velho` a atualizacao e
 * `somaPesada += period·x − soma_antiga` — porque todo peso desce de 1 ao deslizar a janela.
 * Sem essa identidade, cada barra custaria O(period) e a HMA (que usa tres WMAs) custaria o
 * triplo.
 *
 * ⚠️ Existe aqui e nao em `rolling.core.ts` porque so a HMA a usa; promover cedo teria criado
 * uma primitiva publica com um consumidor so.
 */
class WmaState {
  private readonly win: RingWindow;
  private readonly soma = new KahanSum();
  private readonly somaPesada = new KahanSum();
  private readonly denominador: number;

  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
    // Σ 1..n = n(n+1)/2
    this.denominador = (period * (period + 1)) / 2;
  }

  push(x: number): number | null {
    // ⚠️ A soma ANTES de a barra nova entrar e a que a identidade do deslizamento usa. Ler
    // depois daria o valor errado por exatamente `x`.
    const somaAntes = this.soma.value();
    const saiu = this.win.push(x);
    this.soma.add(x);
    if (saiu !== null) this.soma.add(-saiu);
    // ⭐ A identidade: ao deslizar, todo peso desce 1 (perde-se `Σ y`) e o novo entra com o peso
    // maximo. Enquanto a janela enche, o peso maximo e o tamanho corrente.
    const pesoNovo = saiu !== null ? this.period : this.win.size();
    this.somaPesada.add(pesoNovo * x - (saiu !== null ? somaAntes : 0));
    if (!this.win.isFull()) return null;
    return this.somaPesada.value() / this.denominador;
  }

  /**
   * O valor COMO SE `x` entrasse, sem mutar.
   *
   * ⚠️ Só emite quando a janela PROJETADA estará cheia: com `size === period − 1` a entrada de
   * `x` a completa, e antes disso não há valor a projetar.
   */
  peek(x: number): number | null {
    if (this.win.size() < this.period - 1) return null;
    const cheia = this.win.isFull();
    const saiu = cheia ? (this.win.oldest() ?? 0) : null;
    const pesoNovo = saiu !== null ? this.period : this.win.size() + 1;
    const pesadaProj = this.somaPesada.value() + pesoNovo * x - (saiu !== null ? this.soma.value() : 0);
    return pesadaProj / this.denominador;
  }

  reset(): void {
    this.win.reset();
    this.soma.reset();
    this.somaPesada.reset();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HMA — Hull Moving Average
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `HMA = WMA(2·WMA(n/2) − WMA(n), sqrt(n))`.
 *
 * ⭐ A ideia: `2·WMA(n/2) − WMA(n)` e uma extrapolacao que CANCELA o atraso (a defasagem da
 * rapida entra com peso 2 e a da lenta subtrai), e a WMA final de `sqrt(n)` alisa o ruido que a
 * subtracao amplificou. O resultado vira quase junto com o preco.
 *
 * ⚠️ O custo declarado: ela PASSA DO PONTO. A extrapolacao que mata o atraso projeta a
 * tendencia, e no fim do movimento projeta para o lado errado. HMA nao serve como suporte
 * dinamico — serve para datar a virada.
 *
 * ⚠️ `sqrt(n)` arredondado, e `n/2` arredondado: com `n = 9` sao 4 e 3. Truncar em vez de
 * arredondar daria uma HMA visivelmente diferente da de qualquer outro terminal, e o operador
 * concluiria que a nossa esta errada.
 */
export const hmaFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(16);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'hma',
    label: 'Média de Hull (HMA)',
    category: 'trend',
    params: specs,
    outputs: [{ key: 'value', label: 'HMA', plot: 'line', pane: 'price', color: '#a78bfa' }],
    dependencies: ['wma'],
    // A lenta manda, mais a suavizacao final.
    warmup: (p) => {
      const n = Math.max(1, Math.round(numParam(p, pSpec)));
      return n + Math.max(1, Math.round(Math.sqrt(n)));
    },
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const fonte = sourceParam(merged, sourceSpec);
      const meio = Math.max(1, Math.round(n / 2));
      const raiz = Math.max(1, Math.round(Math.sqrt(n)));
      return buildInstance(meta, merged, () => {
        const rapida = new WmaState(meio);
        const lenta = new WmaState(n);
        const final = new WmaState(raiz);
        return {
          onUpdate: (bar) => {
            const x = priceOf(bar, fonte);
            const r = rapida.push(x);
            const l = lenta.push(x);
            // ⚠️ As duas SEMPRE consomem: curto-circuitar a lenta a deixaria eternamente
            // aquecendo, e a HMA nunca sairia de `null`.
            if (r === null || l === null) return { value: null };
            return { value: final.push(2 * r - l) };
          },
          onPreview: (bar) => {
            const x = priceOf(bar, fonte);
            const r = rapida.peek(x);
            const l = lenta.peek(x);
            if (r === null || l === null) return { value: null };
            return { value: final.peek(2 * r - l) };
          },
          onReset: () => {
            rapida.reset();
            lenta.reset();
            final.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// VWMA — Volume Weighted Moving Average
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `VWMA = Σ(preco·volume) / Σ(volume)` na janela de N.
 *
 * ⭐ Diferente da VWAP: a VWAP acumula desde o inicio da SESSAO (e por isso e uma referencia do
 * dia), a VWMA e uma JANELA rolante (e por isso e uma media movel comparavel a SMA). Quem
 * compara VWMA com SMA esta perguntando "o preco medio ponderado por negocio esta acima ou
 * abaixo do preco medio simples?" — isto e, se o volume aconteceu em cima ou embaixo.
 *
 * ⚠️ Volume ausente ou zero na janela inteira devolve `null`, nao a SMA. Cair para a SMA
 * silenciosamente entregaria uma linha com o nome errado: o operador leria ponderacao por volume
 * onde nao houve nenhuma.
 */
export const vwmaFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(20);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'vwma',
    label: 'Média ponderada por volume (VWMA)',
    category: 'volume',
    params: specs,
    outputs: [{ key: 'value', label: 'VWMA', plot: 'line', pane: 'price', color: '#38bdf8' }],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const fonte = sourceParam(merged, sourceSpec);
      const volOf = (b: IndicatorBar): number =>
        typeof b.volume === 'number' && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 0;
      return buildInstance(meta, merged, () => {
        const pv = new SmaState(n);
        const v = new SmaState(n);
        const calc = (somaPv: number | null, somaV: number | null): number | null => {
          if (somaPv === null || somaV === null) return null;
          // Razao de MEDIAS sobre a mesma janela = razao das somas. Reusa o Kahan do `SmaState`
          // em vez de um segundo acumulador de soma.
          if (!(somaV > 0)) return null;
          return somaPv / somaV;
        };
        return {
          onUpdate: (bar) => {
            const vol = volOf(bar);
            return { value: calc(pv.push(priceOf(bar, fonte) * vol), v.push(vol)) };
          },
          onPreview: (bar) => {
            const vol = volOf(bar);
            return { value: calc(pv.peek(priceOf(bar, fonte) * vol), v.peek(vol)) };
          },
          onReset: () => {
            pv.reset();
            v.reset();
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// KAMA — Kaufman Adaptive Moving Average
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Media cuja VELOCIDADE se adapta a eficiencia do movimento.
 *
 *     ER (efficiency ratio) = |preco − preco[n]| / Σ|variação de cada barra|
 *     sc = (ER·(fastSc − slowSc) + slowSc)²        com fastSc = 2/(2+1), slowSc = 2/(30+1)
 *     KAMA = KAMA[1] + sc·(preco − KAMA[1])
 *
 * ⭐ O ER e a pergunta *"o preco foi de A a B em linha reta ou serrote?"*. Em tendencia limpa o
 * caminho percorrido e quase igual a distancia liquida, `ER → 1`, e a media anda rapido. Em
 * lateralizacao o caminho e muito maior que a distancia, `ER → 0`, e a media quase congela — que
 * e exatamente onde a EMA chicoteia e gera falso sinal.
 *
 * ⚠️ O `sc` e ELEVADO AO QUADRADO, e nao e detalhe cosmetico: sem o quadrado a media nao chega a
 * ficar lenta o suficiente no range, e o indicador perde a propriedade que o justifica.
 *
 * ⚠️ Soma de variacoes ZERO (preco constante na janela) daria `0/0`. Nesse caso `ER = 0` — preco
 * parado e ineficiencia total, e a media deve congelar. Devolver `null` ali quebraria a linha num
 * mercado apenas parado.
 */
export const kamaFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(10, 'period', 'Período do ER');
  const fastSpec = periodSpec(2, 'fast', 'Rápida');
  const slowSpec = periodSpec(30, 'slow', 'Lenta');
  const specs: readonly ParamSpec[] = [pSpec, fastSpec, slowSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'kama',
    label: 'Média adaptativa (KAMA)',
    category: 'trend',
    params: specs,
    outputs: [{ key: 'value', label: 'KAMA', plot: 'line', pane: 'price', color: '#22d3ee' }],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))) + 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const fast = Math.max(1, Math.round(numParam(merged, fastSpec)));
      const slow = Math.max(1, Math.round(numParam(merged, slowSpec)));
      const fonte = sourceParam(merged, sourceSpec);
      const fastSc = 2 / (fast + 1);
      const slowSc = 2 / (slow + 1);

      return buildInstance(meta, merged, () => {
        // Janela dos precos (para a distancia liquida) e das variacoes absolutas (o caminho).
        const precos = new RingWindow(n + 1);
        const variacoes = new SmaState(n);
        let anterior: number | null = null;
        let kama: number | null = null;

        const passo = (x: number, mutar: boolean): number | null => {
          const varAbs = anterior === null ? 0 : Math.abs(x - anterior);
          const mediaVar = mutar ? variacoes.push(varAbs) : variacoes.peek(varAbs);
          const maisAntigo = precos.isFull() ? precos.oldest() : null;
          if (mutar) {
            precos.push(x);
            anterior = x;
          }
          if (mediaVar === null || maisAntigo === null) {
            // Ainda aquecendo: a KAMA nasce no primeiro preco utilizavel, como a EMA nasce na
            // semente. Sem semente, o primeiro `sc` seria aplicado a `null`.
            if (mutar && kama === null && precos.isFull()) kama = x;
            return null;
          }
          const caminho = mediaVar * n;
          const er = caminho > 0 ? Math.abs(x - maisAntigo) / caminho : 0;
          const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
          const base = kama ?? x;
          const proximo = base + sc * (x - base);
          if (mutar) kama = proximo;
          return proximo;
        };

        return {
          onUpdate: (bar) => ({ value: passo(priceOf(bar, fonte), true) }),
          onPreview: (bar) => ({ value: passo(priceOf(bar, fonte), false) }),
          onReset: () => {
            precos.reset();
            variacoes.reset();
            anterior = null;
            kama = null;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// LSMA — Least Squares Moving Average (regressao linear)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A reta de MINIMOS QUADRADOS da janela, avaliada no ULTIMO ponto dela.
 *
 * ⭐ Nao e uma media: e o valor que a tendencia local prevê para agora. Por isso ela "cola" no
 * preco em tendencia e nao fica atrasada como a SMA — o que ela perde e estabilidade, porque uma
 * barra excepcional gira a reta inteira.
 *
 * ⭐⭐ **A parte que importa: isto e O(1), nao O(n).** A formula publicada pede um laco pela
 * janela para `Σx`, `Σy`, `Σxy`, `Σx²`. Mas o eixo `x` e o INDICE dentro da janela (0..n−1), e ao
 * deslizar a janela todos os indices caem em 1 — o que da a identidade
 * `Σ(i·y) := Σ(i·y) − Σy_antiga + (n−1)·y_novo`. Com `Σx` e `Σx²` constantes (dependem so de
 * `n`), sobram duas somas rolantes. E o mesmo truque da `WmaState` acima, e ele e o que permite
 * a LSMA existir num pacote que promete O(1).
 *
 * ⚠️ A saida `slope` sai junto porque e informacao GRATUITA e independente: a inclinacao da reta
 * responde "a que ritmo", e quem le tendencia precisa dos dois. Calcular a LSMA e descartar o
 * coeficiente angular seria jogar fora metade do resultado.
 */
class LsmaLogic {
  private readonly win: RingWindow;
  private readonly somaY = new KahanSum();
  private readonly somaIY = new KahanSum();
  private readonly somaX: number;
  private readonly somaX2: number;

  constructor(private readonly period: number) {
    this.win = new RingWindow(period);
    const n = period;
    this.somaX = ((n - 1) * n) / 2;
    this.somaX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  }

  private resolver(somaY: number, somaIY: number): { valor: number; slope: number } | null {
    const n = this.period;
    if (n < 2) return { valor: somaY, slope: 0 };
    const denom = n * this.somaX2 - this.somaX * this.somaX;
    if (!(Math.abs(denom) > 0)) return null;
    const slope = (n * somaIY - this.somaX * somaY) / denom;
    const intercepto = (somaY - slope * this.somaX) / n;
    // Avaliada no ULTIMO indice da janela (n−1): e "onde a reta esta agora".
    return { valor: intercepto + slope * (n - 1), slope };
  }

  /**
   * ⚠️⚠️ DEFEITO CORRIGIDO EM 17/09/2026: faltava DEVOLVER o elemento que saiu.
   *
   * A identidade do deslizamento, derivada com cuidado. Ao entrar `y` e sair o elemento de
   * indice 0, todos os que ficam descem uma posicao:
   *
   * ```
   * Σ(i·y)_novo = Σ((i−1)·y) dos que ficam            + (n−1)·y
   *             = Σ(i·y)_antes − Σ(y dos que FICAM)   + (n−1)·y
   *             = Σ(i·y)_antes − (somaYAntes − saiu)  + (n−1)·y
   *                                          ↑↑↑↑↑
   *                              este termo estava AUSENTE
   * ```
   *
   * ⭐ O elemento que sai tinha indice 0, entao contribuia `0·saiu = 0` para `Σ(i·y)` e nao tira
   * nada dela ao sair. Mas ele ESTAVA em `somaYAntes`, e por isso precisa ser devolvido — senao
   * subtrai-se o deslizamento de um elemento que nem esta mais na janela.
   *
   * ⚠️ O sintoma era caracteristico e foi o que denunciou: a PRIMEIRA emissao estava CERTA
   * (quando a janela acabou de encher, `saiu === null` e o ramo defeituoso nem roda) e todas as
   * seguintes erravam, com o erro acumulando. Medido com `period = 25`: indice 24 correto
   * (102.432892), indice 25 devolvia 101.526615 contra 102.458 da referencia.
   *
   * ⚠️ E era INVISIVEL para a suite: `incremental == batch` passava porque os dois caminhos
   * usam este mesmo `push` e erravam igual. Só referencia externa pega isso.
   */
  push(y: number): { valor: number; slope: number } | null {
    const somaYAntes = this.somaY.value();
    const saiu = this.win.push(y);
    this.somaY.add(y);
    if (saiu !== null) this.somaY.add(-saiu);
    // Enquanto enche, o indice do novo e o tamanho corrente menos 1.
    const pesoNovo = saiu !== null ? this.period - 1 : this.win.size() - 1;
    this.somaIY.add(pesoNovo * y - (saiu !== null ? somaYAntes - saiu : 0));
    if (!this.win.isFull()) return null;
    return this.resolver(this.somaY.value(), this.somaIY.value());
  }

  peek(y: number): { valor: number; slope: number } | null {
    if (this.win.size() < this.period - 1) return null;
    const cheia = this.win.isFull();
    const saiu = cheia ? (this.win.oldest() ?? 0) : null;
    const somaYProj = this.somaY.value() + y - (saiu ?? 0);
    const pesoNovo = saiu !== null ? this.period - 1 : this.win.size();
    // ⚠️ A MESMA correcao do `push`: devolver o `saiu`. Divergir aqui faria `preview` e `update`
    // discordarem na mesma barra, que e o defeito que o property test de preview persegue.
    const somaIYProj =
      this.somaIY.value() + pesoNovo * y - (saiu !== null ? this.somaY.value() - saiu : 0);
    return this.resolver(somaYProj, somaIYProj);
  }

  reset(): void {
    this.win.reset();
    this.somaY.reset();
    this.somaIY.reset();
  }
}

export const lsmaFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(25);
  const specs: readonly ParamSpec[] = [pSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'lsma',
    label: 'Regressão linear (LSMA)',
    category: 'trend',
    params: specs,
    outputs: [
      { key: 'value', label: 'LSMA', plot: 'line', pane: 'price', color: '#f472b6' },
      // ⚠️ Em painel SEPARADO: a inclinacao e em preco-por-barra, uma grandeza que nao cabe na
      // escala do preco. Plotada junto, ela viraria uma linha colada no zero.
      {
        key: 'slope',
        label: 'Inclinação',
        plot: 'histogram',
        pane: 'separate',
        referenceLines: [0],
      },
    ],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, pSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const fonte: PriceSource = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const logica = new LsmaLogic(n);
        return {
          onUpdate: (bar) => {
            const r = logica.push(priceOf(bar, fonte));
            return { value: r?.valor ?? null, slope: r?.slope ?? null };
          },
          onPreview: (bar) => {
            const r = logica.peek(priceOf(bar, fonte));
            return { value: r?.valor ?? null, slope: r?.slope ?? null };
          },
          onReset: () => logica.reset(),
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// TRIX — taxa de variacao da EMA TRIPLA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `TRIX = 100 · (EMA³ − EMA³[1]) / EMA³[1]`, com sinal opcional.
 *
 * ⭐ A tripla suavizacao remove praticamente todo o ruido de curto prazo, e a derivada percentual
 * transforma o que sobrou num oscilador em torno do ZERO. A leitura e o cruzamento do zero
 * (mudanca de regime) e a divergencia com o preco.
 *
 * ⚠️ Percentual e nao absoluto: TRIX de dois ativos com precos de ordens diferentes (WIN em 130
 * mil, PETR4 em 32) tem de ser comparavel, e a diferenca absoluta de EMAs nao e.
 *
 * ⚠️ `EMA³[1] === 0` devolve `null`, nao Infinity. Acontece com serie centrada em zero (delta,
 * por exemplo, se alguem alimentar o TRIX com ele).
 */
export const trixFactory: IndicatorFactory = (() => {
  const pSpec = periodSpec(15);
  const sinalSpec = periodSpec(9, 'signal', 'Sinal');
  const specs: readonly ParamSpec[] = [pSpec, sinalSpec, sourceSpec];
  const meta: IndicatorMeta = {
    name: 'trix',
    label: 'TRIX',
    category: 'momentum',
    params: specs,
    outputs: [
      { key: 'value', label: 'TRIX', plot: 'line', pane: 'separate', referenceLines: [0] },
      { key: 'signal', label: 'Sinal', plot: 'line', pane: 'separate', color: '#fbbf24' },
    ],
    dependencies: ['ema'],
    warmup: (p) =>
      3 * Math.max(1, Math.round(numParam(p, pSpec))) + Math.max(1, Math.round(numParam(p, sinalSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const n = Math.max(1, Math.round(numParam(merged, pSpec)));
      const sinalN = Math.max(1, Math.round(numParam(merged, sinalSpec)));
      const fonte = sourceParam(merged, sourceSpec);
      return buildInstance(meta, merged, () => {
        const e1 = new EmaState(n);
        const e2 = new EmaState(n);
        const e3 = new EmaState(n);
        const sinal = new EmaState(sinalN);
        let anterior: number | null = null;

        const triplo = (x: number, mutar: boolean): number | null => {
          const a = mutar ? e1.push(x) : e1.peek(x);
          if (a === null) return null;
          const b = mutar ? e2.push(a) : e2.peek(a);
          if (b === null) return null;
          return mutar ? e3.push(b) : e3.peek(b);
        };

        return {
          onUpdate: (bar) => {
            const t = triplo(priceOf(bar, fonte), true);
            if (t === null) return { value: null, signal: null };
            const ant = anterior;
            anterior = t;
            if (ant === null || ant === 0) return { value: null, signal: null };
            const v = (100 * (t - ant)) / ant;
            return { value: v, signal: sinal.push(v) };
          },
          onPreview: (bar) => {
            const t = triplo(priceOf(bar, fonte), false);
            if (t === null || anterior === null || anterior === 0) {
              return { value: null, signal: null };
            }
            const v = (100 * (t - anterior)) / anterior;
            return { value: v, signal: sinal.peek(v) };
          },
          onReset: () => {
            e1.reset();
            e2.reset();
            e3.reset();
            sinal.reset();
            anterior = null;
          },
        };
      });
    },
  };
})();
