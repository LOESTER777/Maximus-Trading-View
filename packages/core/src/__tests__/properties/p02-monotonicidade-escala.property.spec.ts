/**
 * Property 2 — Monotonicidade da escala de cor. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 2.6.
 *
 * ```
 * ∀ scale, v1, v2 finitos com v1 ≤ v2:  alphaOf(scale, v1) ≤ alphaOf(scale, v2)
 * ∀ scale, v finito:                    alphaMin ≤ alphaOf(scale, v) ≤ alphaMax
 * ∀ scale, v não finito:                alphaOf(scale, v) === alphaMin
 * ```
 *
 * **Validates: Requirements 2.3, 2.4**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **É a que impede a camada de mentir.** Se uma parede maior puder aparecer mais
 * clara que uma menor, o operador lê o **inverso** da realidade — e o produto
 * inteiro é sobre ler onde há liquidez. Uma inversão de opacidade não quebra
 * nada, não lança e não aparece em log: ela apenas faz a tela afirmar o
 * contrário do dado, silenciosamente, e é exatamente esse tipo de erro que uma
 * propriedade pega e um teste por exemplo não pega.
 *
 * O ramo onde a ordem pode de fato quebrar é um só: a interpolação
 *
 *     alpha(q) = alphaMin + (alphaMax − alphaMin) × clamp(t, 0, 1)^gamma
 *     com t = (q − p50) / (p99 − p50)
 *
 * Fora dele as respostas são constantes (`alphaMin` ou `alphaMax`) e a ordem é
 * trivial. Por isso os geradores deste arquivo sorteiam a quantidade **em
 * relação aos percentis da própria escala**, e não de forma independente: sem
 * isso, quase todo par cairia nos platôs e a propriedade passaria sem nunca
 * exercitar a curva. Ver a nota de vacuidade abaixo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS RESSALVAS QUE MUDAM O GERADOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. **A monotonicidade vale sobre o domínio FINITO**, e é assim que o requisito
 *    2.3 a enuncia. Ela **não se estende** a `+Infinity`, que o requisito 2.4
 *    manda tratar como `alphaMin` — e `alphaMin ≤ alphaOf(qualquer finito)` faria
 *    a ordem falhar em `v1 = 10⁶ ≤ v2 = +∞`. As duas regras só coexistem porque a
 *    primeira é qualificada. Daí o par da cláusula 1 ser **finito por
 *    construção**, e o não finito ter cláusula própria.
 *
 * 2. **`alphaOf` tolera escala montada à mão** — que é justamente o que um teste
 *    de propriedade faz. Campo não finito é saneado, e limites que colapsam o
 *    intervalo resultam em resposta constante. Por isso há gerador de escala
 *    degenerada, e não apenas de escala bem formada: a monotonicidade é afirmada
 *    para **toda** escala, inclusive as que nenhuma chamada de produção
 *    produziria.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO OS DOIS TIPOS DE LIMITE SÃO AFIRMADOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A cláusula 2 fala de `alphaMin` e `alphaMax` — mas de quais, se a escala pode
 * chegar com campo inválido que a função saneia? Reimplementar o saneamento aqui
 * para prever o valor esperado seria copiar a implementação e testar a cópia.
 * A saída foi separar em dois:
 *
 * - **Escala de limites válidos** (`0 ≤ alphaMin < alphaMax ≤ 1`): o saneamento é
 *   identidade, então o intervalo esperado é **literalmente** o gerado. É a
 *   afirmação forte, e cobre 100% do que a produção constrói, porque
 *   `computeColorScale` nunca devolve limite fora dessa faixa.
 * - **Escala de construção manual** (campo não finito, limite invertido, `gamma`
 *   fora de faixa): afirma-se a garantia universal — resposta **finita** e dentro
 *   de `[0, 1]`, nunca `NaN`. Não depende de saneamento algum, e `NaN` é o
 *   desfecho que interessa proibir: pintaria transparente e a célula sumiria sem
 *   aviso.
 *
 * O caso de **limites invertidos e ambos em faixa** (`alphaMin > alphaMax`, os
 * dois em `[0, 1]`) tem teste próprio e afirmação exata: o saneamento não altera
 * nenhum dos dois campos, então a resposta constante esperada é o próprio
 * `scale.alphaMin` gerado. Fecha a tolerância documentada sem duplicar código.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de
 * render e a biblioteca de teste. A parte do núcleo que este arquivo exercita não
 * importa nada em tempo de execução. Logo o fechamento transitivo daqui não tem
 * caminho até camada de conexão, de feed de cotação, de envio de ordem, de
 * roteamento ou de estado de conta, e não carrega endereço de rede, credencial
 * nem identificador de conta.
 *
 * Todo insumo é sintetizado pelos geradores; nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma ordem é
 * enviada, nenhum evento de decisão é emitido, nenhuma chave de configuração de
 * trading é criada ou alterada.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  alphaOf,
  computeColorScale,
  BOOKMAP_ALPHA_MIN_DEFAULT,
  BOOKMAP_ALPHA_MAX_DEFAULT,
  BOOKMAP_GAMMA_DEFAULT,
  type ColorScale,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * Distribuição medida nas 22.721 células com fila maior que zero do pregão de
 * referência. Entram nos geradores como valores ponderados para que a
 * propriedade seja exercitada na forma do dado real, não só em números
 * arbitrários.
 */
const P50_MEDIDO = 481;
const P90_MEDIDO = 714;
const P99_MEDIDO = 1_131;

/** Maior fila real dentro da banda que concentra 97,1% das células. */
const MAX_REAL_MEDIDO = 2_442;

/**
 * Maior valor global medido — 32× o `p99`. **Não é parede**: é nível cruzado,
 * artefato de agregação. Entra aqui como quantidade extrema plausível, que a
 * escala precisa saturar sem inverter a ordem.
 */
const MAX_ARTEFATO_MEDIDO = 36_232;

// ═════════════════════════════════════════════════════════════════════════════
// Utilitários de ponto flutuante
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um passo de precisão acima de `v`, aproximadamente um ulp.
 *
 * Existe para produzir o par **colado**: duas quantidades cuja diferença é do
 * tamanho do próprio erro de arredondamento. É o par que testa se a curva de
 * potência preserva a ordem quando `t1` e `t2` são doubles vizinhos — a única
 * forma realista de a monotonicidade quebrar, já que a subtração e a divisão que
 * produzem `t` são corretamente arredondadas e portanto monótonas, enquanto
 * `Math.pow` não tem garantia de arredondamento correto.
 *
 * Sem aritmética de inteiros de 64 bits de propósito: o projeto compila com alvo
 * anterior ao que os admite.
 *
 * Nunca devolve valor não finito — no topo da faixa representável devolve `v`,
 * e um par de valores iguais continua sendo um par ordenado válido.
 */
function umPassoAcima(v: number): number {
  if (!Number.isFinite(v)) return v;
  if (v === 0) return Number.MIN_VALUE;
  const proximo = v + Math.abs(v) * Number.EPSILON;
  return Number.isFinite(proximo) ? proximo : v;
}

/** Teto finito para a faixa "acima do teto da escala", sem estourar. */
function tetoDaFaixaSuperior(p99: number): number {
  const candidato = Math.abs(p99) * 32 + 1e6;
  const limitado = Number.isFinite(candidato) ? candidato : Number.MAX_VALUE;
  return limitado > p99 ? limitado : Number.MAX_VALUE;
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — limites de opacidade e expoente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Par de limites **válido**: `0 ≤ alphaMin < alphaMax ≤ 1`, a faixa que o
 * requisito 2.3 exige e a única que `computeColorScale` devolve.
 *
 * O filtro descarta apenas o par de valores iguais, que é raro; a ordenação
 * posterior garante a desigualdade estrita.
 */
const arbLimitesValidos = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  )
  .filter(([a, b]) => a < b || b < a)
  .map(([a, b]) => (a < b ? { alphaMin: a, alphaMax: b } : { alphaMin: b, alphaMax: a }));

/** Os limites que a produção usa de fato — ponderados para não virarem exceção. */
const arbLimitesDeProducao = fc.constant({
  alphaMin: BOOKMAP_ALPHA_MIN_DEFAULT,
  alphaMax: BOOKMAP_ALPHA_MAX_DEFAULT,
});

const arbLimitesValidosPonderados = fc.oneof(
  { arbitrary: arbLimitesDeProducao, weight: 2 },
  { arbitrary: arbLimitesValidos, weight: 3 },
);

/**
 * Limites **invertidos**, os dois dentro de `[0, 1]`.
 *
 * Caso deliberadamente escolhido para ser afirmável de forma exata: nenhum dos
 * dois campos é alterado pelo saneamento, então a resposta constante esperada é
 * o próprio `alphaMin` gerado.
 */
const arbLimitesInvertidos = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  )
  .filter(([a, b]) => a < b || b < a)
  .map(([a, b]) => (a > b ? { alphaMin: a, alphaMax: b } : { alphaMin: b, alphaMax: a }));

/** Expoente dentro da faixa admitida, com o padrão de produção ponderado. */
const arbGammaValida = fc.oneof(
  { arbitrary: fc.constant(BOOKMAP_GAMMA_DEFAULT), weight: 3 },
  { arbitrary: fc.double({ min: 0.05, max: 8, noNaN: true }), weight: 2 },
);

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — campos numéricos arbitrários
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Número qualquer, com peso nas bordas que quebram guardas aritméticas.
 *
 * `NaN` e `±Infinity` estão aqui porque `alphaOf` promete saneá-los em vez de
 * propagar; `1e300` porque é finito e ainda assim aritmeticamente hostil (a
 * amplitude entre dois valores dessa ordem estoura para `Infinity`); `-0` porque
 * é o valor em que comparação e igualdade estrita divergem.
 */
const arbNumeroQualquer = fc.oneof(
  { arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }), weight: 3 },
  { arbitrary: fc.integer({ min: -50_000, max: 50_000 }), weight: 2 },
  {
    arbitrary: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -0,
      1e300,
      -1e300,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      P50_MEDIDO,
      P99_MEDIDO,
    ),
    weight: 3,
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — percentis
// ═════════════════════════════════════════════════════════════════════════════

interface Percentis {
  readonly p50: number;
  readonly p99: number;
}

/**
 * Percentis com **rampa**: `p99 > p50`, os dois finitos e não negativos. É a
 * única configuração em que o ramo de interpolação roda, e por isso a que recebe
 * o maior peso em toda combinação.
 */
const arbPercentisComRampa = fc.oneof(
  { arbitrary: fc.constant<Percentis>({ p50: P50_MEDIDO, p99: P99_MEDIDO }), weight: 3 },
  {
    arbitrary: fc
      .tuple(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: MAX_ARTEFATO_MEDIDO }),
      )
      .map(([p50, amplitude]): Percentis => ({ p50, p99: p50 + amplitude })),
    weight: 3,
  },
  {
    // Rampa estreitíssima: a divisão por `p99 − p50` amplifica ao máximo
    // qualquer erro de arredondamento, e é onde a ordem tem mais chance de
    // quebrar se a curva de potência não for monótona.
    arbitrary: fc
      .double({ min: 1, max: 5_000, noNaN: true })
      .map((p50): Percentis => ({ p50, p99: p50 + Math.abs(p50) * Number.EPSILON * 4 }))
      .filter(({ p50, p99 }) => p99 > p50),
    weight: 1,
  },
);

/**
 * Percentis **colapsados** com magnitude positiva: a janela visível não tem
 * variação de magnitude. O requisito 2.10 manda saturar toda quantidade positiva
 * nesse caso.
 */
const arbPercentisColapsados = fc
  .oneof(
    { arbitrary: fc.constant(P50_MEDIDO), weight: 2 },
    { arbitrary: fc.integer({ min: 1, max: MAX_ARTEFATO_MEDIDO }), weight: 2 },
    { arbitrary: fc.double({ min: Number.MIN_VALUE, max: 1, noNaN: true }), weight: 1 },
  )
  .map((x): Percentis => ({ p50: x, p99: x }));

/**
 * Amostra vazia. Como zero fica fora da amostra dos percentis, `p99 === 0`
 * identifica sem ambiguidade "não havia nada para medir" — e aí não existe
 * magnitude alguma a representar.
 */
const arbPercentisVazios = fc.constant<Percentis>({ p50: 0, p99: 0 });

/** Percentis arbitrários, inclusive invertidos, negativos e não finitos. */
const arbPercentisDeConstrucaoManual = fc.record<Percentis>({
  p50: arbNumeroQualquer,
  p99: arbNumeroQualquer,
});

/**
 * A rampa recebe o maior peso porque é a única configuração em que o ramo de
 * interpolação roda. As formas degeneradas seguem presentes — são elas que
 * exercitam os guards — mas em minoria deliberada.
 */
const arbPercentisQuaisquer = fc.oneof(
  { arbitrary: arbPercentisComRampa, weight: 7 },
  { arbitrary: arbPercentisColapsados, weight: 2 },
  { arbitrary: arbPercentisVazios, weight: 1 },
  { arbitrary: arbPercentisDeConstrucaoManual, weight: 2 },
);

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — escalas
// ═════════════════════════════════════════════════════════════════════════════

function montarEscala(
  percentis: Percentis,
  limites: { alphaMin: number; alphaMax: number },
  gamma: number,
): ColorScale {
  return {
    p50: percentis.p50,
    p99: percentis.p99,
    alphaMin: limites.alphaMin,
    alphaMax: limites.alphaMax,
    gamma,
  };
}

/**
 * Escala de **limites válidos** com percentis quaisquer.
 *
 * É sobre esta que o intervalo `[alphaMin, alphaMax]` pode ser afirmado
 * literalmente, porque o saneamento dos limites é identidade aqui.
 */
const arbEscalaDeLimitesValidos = fc
  .record({
    percentis: arbPercentisQuaisquer,
    limites: arbLimitesValidosPonderados,
    gamma: arbGammaValida,
  })
  .map(({ percentis, limites, gamma }) => montarEscala(percentis, limites, gamma));

/** Escala de limites válidos com rampa garantida. */
const arbEscalaComRampa = fc
  .record({
    percentis: arbPercentisComRampa,
    limites: arbLimitesValidosPonderados,
    gamma: arbGammaValida,
  })
  .map(({ percentis, limites, gamma }) => montarEscala(percentis, limites, gamma));

/** Escala de limites válidos com percentis colapsados e positivos. */
const arbEscalaColapsada = fc
  .record({
    percentis: arbPercentisColapsados,
    limites: arbLimitesValidosPonderados,
    gamma: arbGammaValida,
  })
  .map(({ percentis, limites, gamma }) => montarEscala(percentis, limites, gamma));

/** Escala de amostra vazia. */
const arbEscalaVazia = fc
  .record({
    limites: arbLimitesValidosPonderados,
    gamma: arbGammaValida,
  })
  .map(({ limites, gamma }) => montarEscala({ p50: 0, p99: 0 }, limites, gamma));

/**
 * Escala **montada à mão**, sem nenhuma garantia: limite fora de faixa ou não
 * finito, limite invertido, `gamma` zero, negativa ou absurda, percentis
 * quaisquer. Nenhuma chamada de produção a produz — e é exatamente por isso que
 * ela precisa estar aqui, já que `alphaOf` declara tolerá-la.
 */
const arbEscalaDeConstrucaoManual = fc
  .record<ColorScale>({
    p50: arbNumeroQualquer,
    p99: arbNumeroQualquer,
    alphaMin: arbNumeroQualquer,
    alphaMax: arbNumeroQualquer,
    gamma: arbNumeroQualquer,
  });

/** Escala com limites invertidos e ambos em faixa — resposta constante exata. */
const arbEscalaDeLimitesInvertidos = fc
  .record({
    percentis: arbPercentisQuaisquer,
    limites: arbLimitesInvertidos,
    gamma: arbGammaValida,
  })
  .map(({ percentis, limites, gamma }) => montarEscala(percentis, limites, gamma));

/** Toda forma de escala que a função precisa atravessar. */
const arbEscalaQualquer = fc.oneof(
  { arbitrary: arbEscalaDeLimitesValidos, weight: 4 },
  { arbitrary: arbEscalaDeConstrucaoManual, weight: 2 },
  { arbitrary: arbEscalaDeLimitesInvertidos, weight: 1 },
);

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — quantidades, sorteadas EM RELAÇÃO à escala
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade finita qualquer, sem olhar a escala. Sempre entra na mistura como
 * rede de segurança: garante cobertura mesmo quando a escala é degenerada e as
 * faixas relativas não existem.
 */
const arbQuantidadeGenerica = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      -1,
      -1e6,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      P50_MEDIDO,
      P90_MEDIDO,
      P99_MEDIDO,
      MAX_REAL_MEDIDO,
      MAX_ARTEFATO_MEDIDO,
    ),
    weight: 3,
  },
  { arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }), weight: 2 },
  { arbitrary: fc.integer({ min: -50_000, max: 50_000 }), weight: 2 },
);

/** Quantidade não positiva — o requisito 2.4 (negativa) e o 2.2 (zero). */
const arbQuantidadeNaoPositiva = fc.oneof(
  { arbitrary: fc.constantFrom(0, -0, -1, -P50_MEDIDO, -MAX_ARTEFATO_MEDIDO), weight: 2 },
  { arbitrary: fc.double({ min: -1e6, max: 0, noNaN: true }), weight: 2 },
);

/** As três formas de não finito que o requisito 2.4 obriga a sanear. */
const arbQuantidadeNaoFinita = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/**
 * Quantidade finita sorteada **em relação aos percentis da escala recebida**.
 *
 * ⚠️ **É aqui que a vacuidade é evitada, e o ajuste não é cosmético.** Sorteando
 * a quantidade de forma independente da escala, quase todo valor cai fora de
 * `[p50, p99]` — a faixa medida tem largura 650 num domínio que vai a dezenas de
 * milhares — e o ramo de interpolação, o único em que a ordem pode quebrar,
 * quase nunca roda. Condicionando à escala, cada faixa recebe peso explícito:
 *
 * | faixa | o que exercita |
 * |---|---|
 * | não positiva | o guard único de `NaN`, negativa e zero |
 * | abaixo do piso | o platô inferior e a borda `t ≤ 0` |
 * | **dentro da rampa** | **a curva de potência — o ramo que decide** |
 * | bordas exatas | `t === 0` e `t === 1`, onde os ramos se encontram |
 * | acima do teto | o platô superior e a saturação do artefato medido |
 *
 * O preço de condicionar é `chain`, que degrada a qualidade do encolhimento: o
 * contraexemplo relatado vem menos reduzido do que viria com geradores
 * independentes. É troca deliberada — um contraexemplo grande que existe vale
 * mais do que um contraexemplo mínimo que nunca é encontrado.
 *
 * ⚠️ **`fc.double({ min: 0, max: 1 })` NÃO serve para sortear a fração da
 * rampa**, e a primeira versão deste arquivo caiu nessa armadilha. O gerador é
 * uniforme sobre **padrões de bits**, não sobre valor: metade dos doubles de
 * `[0, 1]` está abaixo de ~1e-150. Com `p50 + f × amplitude`, essa fração
 * minúscula desaparece no arredondamento e o resultado volta a ser exatamente
 * `p50` — ou seja, o platô inferior. Medido com instrumentação: **4,0% dos pares
 * caíam ambos na rampa mesmo com rampa garantida na escala.** A correção é
 * sortear no domínio do valor: `fc.double` com as **próprias bordas da rampa**
 * como limites (os expoentes ficam todos na mesma ordem de grandeza, então a
 * distribuição por bits já é razoável em valor) e, ao lado, uma fração inteira
 * explicitamente uniforme, que cobre o miolo da rampa de forma homogênea.
 */
function arbQuantidadeFinitaPara(scale: ColorScale): fc.Arbitrary<number> {
  const p50 = Number.isFinite(scale.p50) ? scale.p50 : 0;
  const p99 = Number.isFinite(scale.p99) ? scale.p99 : 0;
  const amplitude = p99 - p50;

  const opcoes: Array<{ arbitrary: fc.Arbitrary<number>; weight: number }> = [
    { arbitrary: arbQuantidadeGenerica, weight: 1 },
    { arbitrary: arbQuantidadeNaoPositiva, weight: 1 },
  ];

  // A rampa só existe com `p99 > p50` e amplitude finita. Amplitude infinita
  // acontece de verdade: `p50 = −1e300` com `p99 = MAX_VALUE` estoura a
  // subtração, e o valor sorteado sairia não finito, violando a pré-condição de
  // par finito da cláusula 1.
  if (p99 > p50 && Number.isFinite(amplitude) && amplitude > 0) {
    opcoes.push({
      arbitrary: fc.double({ min: p50, max: p99, noNaN: true }),
      weight: 5,
    });

    // Fração uniforme em VALOR — é o que garante cobertura homogênea do miolo,
    // inclusive quando a rampa atravessa mais de uma ordem de grandeza e o
    // sorteio por bits se concentra na borda inferior.
    opcoes.push({
      arbitrary: fc
        .integer({ min: 1, max: 999_999 })
        .map((n) => p50 + (amplitude * n) / 1_000_000)
        .filter((v) => Number.isFinite(v)),
      weight: 4,
    });

    opcoes.push({
      arbitrary: fc.constantFrom(
        p50,
        p99,
        p50 + amplitude / 2,
        umPassoAcima(p50),
        p99 - Math.abs(p99) * Number.EPSILON,
      ),
      weight: 2,
    });

    // Vizinhança imediata do teto — os últimos passos de precisão abaixo de
    // `p99`, ainda estritamente dentro da rampa.
    //
    // ⚠️ **Faixa própria, e com peso, de propósito.** É aqui que `t` fica a um
    // punhado de ulps de 1 e `Math.pow(t, gamma)` pode saturar em 1 exato, o que
    // faz a interpolação devolver `alphaMin + (alphaMax − alphaMin)` — que não
    // reproduz `alphaMax` em ponto flutuante. Diluída entre as bordas exatas,
    // essa vizinhança caía em ~3% dos sorteios e o desfecho aparecia ou não
    // conforme o caminho da semente. Com faixa própria, deixa de depender de
    // sorte.
    const ulpDoTeto = Math.abs(p99) * Number.EPSILON;
    if (ulpDoTeto > 0 && amplitude > 8 * ulpDoTeto) {
      opcoes.push({
        arbitrary: fc.integer({ min: 1, max: 8 }).map((k) => p99 - k * ulpDoTeto),
        weight: 2,
      });
    }

    if (p50 > 0) {
      opcoes.push({
        arbitrary: fc.double({ min: 0, max: p50, noNaN: true }),
        weight: 1,
      });
    }

    opcoes.push({
      arbitrary: fc.double({ min: p99, max: tetoDaFaixaSuperior(p99), noNaN: true }),
      weight: 2,
    });
  }

  // Escala colapsada: a fronteira que decide é o zero, e o valor do próprio
  // ponto de colapso.
  if (p99 === p50 && Number.isFinite(p99)) {
    opcoes.push({
      arbitrary: fc.constantFrom(p99, umPassoAcima(p99), Number.MIN_VALUE, 0, -0),
      weight: 2,
    });
  }

  return fc.oneof(...opcoes);
}

/** Quantidade finita ou não, para as afirmações que valem sobre todo o domínio. */
function arbQuantidadeQualquerPara(scale: ColorScale): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: arbQuantidadeFinitaPara(scale), weight: 4 },
    { arbitrary: arbQuantidadeNaoFinita, weight: 1 },
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores compostos — escala + quantidade(s)
// ═════════════════════════════════════════════════════════════════════════════

interface EscalaEQuantidade {
  readonly scale: ColorScale;
  readonly valor: number;
}

function arbEscalaEQuantidadeFinita(
  arbEscala: fc.Arbitrary<ColorScale>,
): fc.Arbitrary<EscalaEQuantidade> {
  return arbEscala.chain((scale) =>
    arbQuantidadeFinitaPara(scale).map((valor) => ({ scale, valor })),
  );
}

function arbEscalaEQuantidadeQualquer(
  arbEscala: fc.Arbitrary<ColorScale>,
): fc.Arbitrary<EscalaEQuantidade> {
  return arbEscala.chain((scale) =>
    arbQuantidadeQualquerPara(scale).map((valor) => ({ scale, valor })),
  );
}

interface EscalaEPar {
  readonly scale: ColorScale;
  readonly menor: number;
  readonly maior: number;
}

/**
 * Escala e par **finito e ordenado**, `menor ≤ maior` por construção.
 *
 * Ordenar com `Math.min`/`Math.max` em vez de filtrar preserva todo sorteio: um
 * filtro de ordem descartaria metade das amostras e reduziria à metade o número
 * de casos efetivamente exercitados dentro do orçamento de execuções.
 *
 * Duas variantes, e a segunda é a que morde:
 * - **par livre** — as duas quantidades sorteadas de forma independente entre as
 *   faixas da escala, cobrindo também os pares que atravessam fronteira;
 * - **par colado** — separado por um passo de precisão. É o par em que `t1` e
 *   `t2` são doubles vizinhos, único cenário realista em que `Math.pow` poderia
 *   inverter a ordem, já que a subtração e a divisão que produzem `t` são
 *   corretamente arredondadas e portanto monótonas.
 */
function arbEscalaEParOrdenado(arbEscala: fc.Arbitrary<ColorScale>): fc.Arbitrary<EscalaEPar> {
  return arbEscala.chain((scale) => {
    const valor = arbQuantidadeFinitaPara(scale);
    return fc.oneof(
      {
        arbitrary: fc.tuple(valor, valor).map(([a, b]) => ({
          scale,
          menor: Math.min(a, b),
          maior: Math.max(a, b),
        })),
        weight: 3,
      },
      {
        arbitrary: valor.map((a) => {
          const b = umPassoAcima(a);
          return { scale, menor: Math.min(a, b), maior: Math.max(a, b) };
        }),
        weight: 2,
      },
    );
  });
}

interface EscalaECadeia {
  readonly scale: ColorScale;
  readonly cadeia: readonly number[];
}

/**
 * Escala e cadeia crescente de até 24 quantidades.
 *
 * Vale mais que o par por dois motivos: cada execução avalia até 24 pontos da
 * curva em vez de 2, e afirma a **transitividade** ao longo da rampa inteira —
 * uma inversão localizada entre dois vizinhos quaisquer da cadeia é apanhada,
 * não apenas entre as duas pontas.
 */
function arbEscalaECadeiaCrescente(
  arbEscala: fc.Arbitrary<ColorScale>,
): fc.Arbitrary<EscalaECadeia> {
  return arbEscala.chain((scale) =>
    fc
      .array(arbQuantidadeFinitaPara(scale), { minLength: 2, maxLength: 24 })
      .map((valores) => ({ scale, cadeia: [...valores].sort((a, b) => a - b) })),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Gerador — escala pelo caminho de produção (`computeColorScale`)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Amostra de quantidades na forma do dado real, com os valores inválidos que o
 * grid pode conter.
 *
 * `Float32Array` é o tipo do grid, não escolha do teste: é o que o desenho
 * consome, e passar por ele garante que a escala medida seja exatamente a que a
 * produção mede — inclusive no arredondamento para 32 bits.
 */
const arbAmostraDeFila = fc
  .array(
    fc.oneof(
      { arbitrary: fc.integer({ min: 1, max: MAX_REAL_MEDIDO }), weight: 6 },
      {
        arbitrary: fc.constantFrom(
          0,
          P50_MEDIDO,
          P90_MEDIDO,
          P99_MEDIDO,
          MAX_ARTEFATO_MEDIDO,
        ),
        weight: 3,
      },
      {
        arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -5, -0),
        weight: 1,
      },
    ),
    { minLength: 0, maxLength: 400 },
  )
  .map((valores) => Float32Array.from(valores));

/**
 * Escala construída pelo caminho de produção. `count` recebe o comprimento na
 * maior parte dos sorteios e valor inválido no restante — a função promete
 * saneá-lo em vez de rejeitá-lo, e a escala resultante tem de continuar válida.
 */
const arbEscalaDeAmostraMedida = arbAmostraDeFila.chain((amostra) =>
  fc
    .oneof(
      { arbitrary: fc.constant(amostra.length), weight: 5 },
      {
        arbitrary: fc.constantFrom(
          -1,
          0,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          amostra.length + 50,
          amostra.length / 2,
        ),
        weight: 2,
      },
    )
    .chain((count) =>
      fc
        .oneof(
          { arbitrary: fc.constant(undefined), weight: 3 },
          {
            arbitrary: fc.record({
              alphaMin: fc.double({ min: 0, max: 1, noNaN: true }),
              alphaMax: fc.double({ min: 0, max: 1, noNaN: true }),
              gamma: arbGammaValida,
            }),
            weight: 2,
          },
        )
        .map((opts) => computeColorScale(amostra, count, opts)),
    ),
);

// ═════════════════════════════════════════════════════════════════════════════
// Propriedade 2
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 2: monotonicidade da escala de cor', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 1 — a quantidade maior nunca recebe opacidade menor
  // ───────────────────────────────────────────────────────────────────────────

  it('par finito ordenado: a quantidade maior nunca recebe opacidade menor, com qualquer escala', () => {
    fc.assert(
      fc.property(arbEscalaEParOrdenado(arbEscalaQualquer), ({ scale, menor, maior }) => {
        // Pré-condição da cláusula 1, garantida pelo gerador e conferida aqui
        // para que uma regressão no gerador não passe por monotonicidade.
        expect(Number.isFinite(menor)).toBe(true);
        expect(Number.isFinite(maior)).toBe(true);
        expect(menor).toBeLessThanOrEqual(maior);

        const alphaMenor = alphaOf(scale, menor);
        const alphaMaior = alphaOf(scale, maior);

        expect(Number.isNaN(alphaMenor)).toBe(false);
        expect(Number.isNaN(alphaMaior)).toBe(false);
        expect(alphaMenor).toBeLessThanOrEqual(alphaMaior);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('cadeia crescente de quantidades produz opacidades não decrescentes em toda a extensão', () => {
    fc.assert(
      fc.property(arbEscalaECadeiaCrescente(arbEscalaQualquer), ({ scale, cadeia }) => {
        const alphas = cadeia.map((v) => alphaOf(scale, v));

        for (let i = 1; i < alphas.length; i += 1) {
          const anterior = alphas[i - 1] ?? 0;
          const atual = alphas[i] ?? 0;
          expect(Number.isNaN(atual)).toBe(false);
          expect(anterior).toBeLessThanOrEqual(atual);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('com rampa garantida, o par colado por um passo de precisão preserva a ordem', () => {
    fc.assert(
      fc.property(arbEscalaEParOrdenado(arbEscalaComRampa), ({ scale, menor, maior }) => {
        expect(alphaOf(scale, menor)).toBeLessThanOrEqual(alphaOf(scale, maior));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('escala derivada da amostra pelo caminho de produção também preserva a ordem', () => {
    fc.assert(
      fc.property(arbEscalaEParOrdenado(arbEscalaDeAmostraMedida), ({ scale, menor, maior }) => {
        const alphaMenor = alphaOf(scale, menor);
        const alphaMaior = alphaOf(scale, maior);

        expect(Number.isNaN(alphaMenor)).toBe(false);
        expect(alphaMenor).toBeLessThanOrEqual(alphaMaior);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 2 — toda opacidade dentro de [alphaMin, alphaMax]
  // ───────────────────────────────────────────────────────────────────────────

  it('quantidade finita recebe opacidade dentro do intervalo declarado pela escala válida', () => {
    fc.assert(
      fc.property(arbEscalaEQuantidadeFinita(arbEscalaDeLimitesValidos), ({ scale, valor }) => {
        // O requisito 2.3 exige a faixa estrita `0 ≤ alphaMin < alphaMax ≤ 1`;
        // afirmada aqui porque é a pré-condição que torna literal o intervalo
        // esperado logo abaixo.
        expect(scale.alphaMin).toBeGreaterThanOrEqual(0);
        expect(scale.alphaMax).toBeLessThanOrEqual(1);
        expect(scale.alphaMin).toBeLessThan(scale.alphaMax);

        const alpha = alphaOf(scale, valor);

        expect(Number.isFinite(alpha)).toBe(true);
        expect(alpha).toBeGreaterThanOrEqual(scale.alphaMin);
        expect(alpha).toBeLessThanOrEqual(scale.alphaMax);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a opacidade é sempre finita e dentro de [0, 1], mesmo com escala montada à mão', () => {
    fc.assert(
      fc.property(arbEscalaEQuantidadeQualquer(arbEscalaQualquer), ({ scale, valor }) => {
        const alpha = alphaOf(scale, valor);

        expect(Number.isNaN(alpha)).toBe(false);
        expect(Number.isFinite(alpha)).toBe(true);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);

        // O piso da escala saneada é observável pela quantidade zero, que o
        // requisito 2.2 fixa em `alphaMin`. Toda opacidade tem de ficar em cima
        // dele — inclusive com a escala corrompida.
        expect(alpha).toBeGreaterThanOrEqual(alphaOf(scale, 0));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('limites invertidos achatam a escala: toda quantidade recebe o mesmo piso', () => {
    fc.assert(
      fc.property(
        arbEscalaEQuantidadeQualquer(arbEscalaDeLimitesInvertidos),
        ({ scale, valor }) => {
          expect(scale.alphaMin).toBeGreaterThan(scale.alphaMax);
          // Nenhum dos dois campos é alterado pelo saneamento, então a resposta
          // constante esperada é exatamente o `alphaMin` gerado — sem prever o
          // saneamento, sem reimplementá-lo.
          expect(alphaOf(scale, valor)).toBe(scale.alphaMin);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a escala derivada da amostra respeita p50 ≤ p99 e os limites da faixa admitida', () => {
    fc.assert(
      fc.property(arbEscalaDeAmostraMedida, (scale) => {
        expect(Number.isFinite(scale.p50)).toBe(true);
        expect(Number.isFinite(scale.p99)).toBe(true);
        expect(scale.p50).toBeLessThanOrEqual(scale.p99);

        expect(scale.alphaMin).toBeGreaterThanOrEqual(0);
        expect(scale.alphaMax).toBeLessThanOrEqual(1);
        expect(scale.alphaMin).toBeLessThan(scale.alphaMax);

        expect(scale.gamma).toBeGreaterThan(0);
        expect(Number.isFinite(scale.gamma)).toBe(true);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 3 — quantidade não finita recebe o piso, nunca NaN
  // ───────────────────────────────────────────────────────────────────────────

  it('quantidade não finita recebe exatamente o piso da escala, nunca NaN', () => {
    fc.assert(
      fc.property(
        arbEscalaDeLimitesValidos,
        arbQuantidadeNaoFinita,
        (scale, naoFinita) => {
          expect(Number.isFinite(naoFinita)).toBe(false);

          const alpha = alphaOf(scale, naoFinita);

          expect(Number.isNaN(alpha)).toBe(false);
          expect(alpha).toBe(scale.alphaMin);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('quantidade negativa e quantidade zero recebem exatamente o piso da escala', () => {
    fc.assert(
      fc.property(
        arbEscalaDeLimitesValidos,
        arbQuantidadeNaoPositiva,
        (scale, naoPositiva) => {
          expect(naoPositiva).toBeLessThanOrEqual(0);
          expect(alphaOf(scale, naoPositiva)).toBe(scale.alphaMin);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Bordas documentadas da rampa (requisito 2.3)
  // ───────────────────────────────────────────────────────────────────────────

  it('com rampa, quantidade menor ou igual ao p50 recebe o piso', () => {
    fc.assert(
      fc.property(
        arbEscalaComRampa.chain((scale) =>
          fc
            .oneof(
              { arbitrary: fc.double({ min: 0, max: scale.p50, noNaN: true }), weight: 3 },
              { arbitrary: fc.constantFrom(0, -0, scale.p50), weight: 2 },
              { arbitrary: arbQuantidadeNaoPositiva, weight: 1 },
            )
            .map((valor) => ({ scale, valor })),
        ),
        ({ scale, valor }) => {
          expect(scale.p99).toBeGreaterThan(scale.p50);
          expect(valor).toBeLessThanOrEqual(scale.p50);
          expect(alphaOf(scale, valor)).toBe(scale.alphaMin);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('com rampa, quantidade maior ou igual ao p99 recebe o teto', () => {
    fc.assert(
      fc.property(
        arbEscalaComRampa.chain((scale) =>
          fc
            .oneof(
              {
                arbitrary: fc.double({
                  min: scale.p99,
                  max: tetoDaFaixaSuperior(scale.p99),
                  noNaN: true,
                }),
                weight: 3,
              },
              {
                arbitrary: fc.constantFrom(
                  scale.p99,
                  umPassoAcima(scale.p99),
                  MAX_ARTEFATO_MEDIDO + scale.p99,
                  Number.MAX_VALUE,
                ),
                weight: 2,
              },
            )
            .map((valor) => ({ scale, valor })),
        ),
        ({ scale, valor }) => {
          expect(scale.p99).toBeGreaterThan(scale.p50);
          expect(valor).toBeGreaterThanOrEqual(scale.p99);
          // A rampa gerada tem `p99 ≥ 1`, então toda quantidade daqui é
          // positiva e não cai no guard de quantidade não positiva.
          expect(valor).toBeGreaterThan(0);
          expect(alphaOf(scale, valor)).toBe(scale.alphaMax);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('janela sem variação de magnitude satura a quantidade positiva e pisa a não positiva', () => {
    fc.assert(
      fc.property(arbEscalaEQuantidadeQualquer(arbEscalaColapsada), ({ scale, valor }) => {
        expect(scale.p99).toBe(scale.p50);
        expect(scale.p99).toBeGreaterThan(0);

        const alpha = alphaOf(scale, valor);
        const esperado =
          Number.isFinite(valor) && valor > 0 ? scale.alphaMax : scale.alphaMin;

        expect(alpha).toBe(esperado);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('amostra vazia responde sempre o piso, para qualquer quantidade', () => {
    fc.assert(
      fc.property(arbEscalaEQuantidadeQualquer(arbEscalaVazia), ({ scale, valor }) => {
        expect(scale.p50).toBe(0);
        expect(scale.p99).toBe(0);
        expect(alphaOf(scale, valor)).toBe(scale.alphaMin);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
