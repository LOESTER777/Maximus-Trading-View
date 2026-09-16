/**
 * `bookmap-bench-referencia` — o **conjunto de referência** da bancada de
 * desempenho. Spec `bookmap-no-mapa-de-decisao`, tarefa 12.1. Requisito 9.1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO ENTREGA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As **25.823 células** do pregão de referência (`WINV26`, 28/08/2026, balde de
 * 60 s) em três formas, todas construídas em código e **sem banco**:
 *
 * | Forma | Para quê |
 * |---|---|
 * | `celulasVerbosas()`  | tamanho do corpo verboso (tarefa 12.3) |
 * | `payloadColunar()`   | entrada de `decodeColumnar` (requisito 9.6) e tamanho colunar (12.3) |
 * | `gridDeReferencia()` | entrada de `computeColorScale`, `aggregateForZoom` e `draw()` |
 *
 * As três saem do **mesmo** conjunto de células, então medir tamanho numa forma
 * e tempo na outra fala do mesmo dado — o que é o ponto de existir um conjunto
 * de referência em vez de um dado por medida.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE SÍNTESE DETERMINÍSTICA, E NÃO UM JSON VERSIONADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A tarefa admitia duas opções: versionar o payload real do endpoint, ou
 * sintetizar a grade com a distribuição medida a partir de semente fixa. Foi
 * escolhida a **síntese**, por três razões que se somam:
 *
 * 1. **O que se tem do pregão real são estatísticas, não o payload.** As medidas
 *    disponíveis são contagens e percentis (25.823 células, grade 570 × 624,
 *    `p50 481 · p90 714 · p99 1.131 · máx 36.232`, 97,1% na banda do miolo,
 *    maior parede real 2.442 ct). Reconstruir o payload real a partir delas é
 *    impossível; versionar o payload real exigiria **consultar o endpoint** e
 *    congelar 0,83 MB de JSON cuja procedência ainda precisaria ser descrita em
 *    prosa. A síntese torna a procedência **executável**: está tudo aqui.
 *
 * 2. **A fixture de contrato já existe e é outra coisa.**
 *    `__tests__/fixtures/colunar-backend.json` (32 células) é saída **real** de
 *    `toColunar` e existe para pinar o acordo entre codificador e decodificador
 *    — ela é pequena de propósito, e o `sha256` dela é o próprio teste. Um
 *    segundo JSON de 0,83 MB não acrescentaria contrato nenhum: acrescentaria
 *    volume. As duas coisas têm finalidades distintas e ficam separadas.
 *
 * 3. **A fidelidade fica verificável em vez de declarada.** Toda estatística
 *    medida é reproduzida **por construção** e conferida pela suíte
 *    (`__tests__/bookmap-bench-arnes.spec.ts`). Se a construção derivar, o teste
 *    quebra; um JSON versionado só provaria que o arquivo não mudou.
 *
 * ── DETERMINISMO ──────────────────────────────────────────────────────────
 *
 * Zero `Date.now()`, zero `Math.random()`. O único gerador é um `mulberry32`
 * local com **semente fixa** (`SEMENTE`), aritmética inteira de 32 bits (nada de
 * literal `bigint`, que o alvo `ES2017` não compila). `Date.UTC` é função pura.
 * Duas construções na mesma máquina, e em máquinas diferentes, produzem
 * exatamente os mesmos vetores.
 *
 * A ordenação de atribuição de valores desempata por posição, sem depender da
 * estabilidade do `sort` do motor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ DESVIOS EM RELAÇÃO AO CONJUNTO REAL — declarados, porque a tarefa 12.2 vai
 * reportar números medidos sobre este conjunto
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O que é **reproduzido exatamente**:
 *
 * - 25.823 células, 570 baldes de 60 s, 624 preços distintos.
 * - Extensão do dia: fila de 09:00 a 18:30 BRT (o último balde abre 18:29);
 *   execução de 09:00 a 12:31 BRT. Cobertura `EXEC_PARCIAL`, que é o estado de
 *   100% dos pregões materializados.
 * - Fração de células na banda do miolo: 25.074 / 25.823 = 97,099% ≈ 97,1%.
 * - Percentis da fila, na amostra que `computeColorScalePair` de fato toma
 *   (união das quantidades positivas de `bid` e `ask`): `p50 = 481`,
 *   `p90 = 714`, `p99 = 1.131`.
 * - Maior parede real = 2.442 ct; máximo global = 36.232 ct, e este último num
 *   **nível cruzado** (venda em 160.040 com o mercado na casa de 177.000), que é
 *   artefato e não liquidez — exatamente o caso adversário dos requisitos 2.5 e
 *   2.11.
 *
 * O que **difere**, e por quê:
 *
 * 1. **O caminho de preço.** O real é o caminho do dia; aqui é uma varredura
 *    triangular determinística com ruído, ancorada nos extremos para que o eixo
 *    de preço feche em 624 valores distintos. O que se reproduz é a **extensão
 *    do eixo** e a **ocupação** (~44 níveis por balde, como um livro de 20
 *    níveis por lado mais a oscilação do balde), não a trajetória.
 * 2. **Os quantis intermediários da fila.** Os quatro âncoras medidos são
 *    exatos; entre eles a curva é interpolação linear por posto, não a curva
 *    real. Cada âncora tem um platô de cinco postos, para que o valor apurado
 *    não dependa da convenção de percentil adotada a menos de ±2 postos.
 * 3. **A distribuição de execução NÃO foi medida.** Não há estatística dela nos
 *    registros do projeto. Aqui ela é plausível e declarada: presente em parte
 *    das células dos baldes com cobertura, em magnitudes de dezenas a poucas
 *    centenas de contratos por balde e por preço. Qualquer conclusão da 12.2
 *    sobre **execução** herda essa escolha; as conclusões sobre **fila** não.
 * 4. **O tamanho do corpo serializado é aproximação.** As larguras de dígito são
 *    realistas (instante 13 dígitos, preço 6, índices 1–3, quantidades 1–5), mas
 *    o total em bytes depende da composição exata dos números. A 12.3 deve
 *    reportar o valor sintético **ao lado** dos 2,43 MB / 0,83 MB medidos no
 *    pregão real, não em lugar deles.
 * 5. **Uma célula por balde tem os dois lados positivos** (570 no total), no
 *    preço do meio do livro. É o caso do requisito 1.9 — duas passadas de
 *    desenho no mesmo par — e sem ele a medição de `draw()` não exercitaria o
 *    segundo laço. A consequência é que a união de quantidades positivas tem
 *    26.393 entradas, não 25.823; os percentis acima são exatos **nessa** união.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dado sintético produzido em código. Nenhuma leitura de banco, de arquivo, de
 * CSV ou de rede; nenhuma escrita em lugar algum. `symbol`, `fonte` e `de` são
 * rótulos do contrato de rede — `fonte` é valor de filtro sobre uma coluna e não
 * seleciona conexão alguma. Não há aqui endereço de rede, identificador de
 * conta, credencial nem estado de posição. Este módulo só importa tipos da
 * própria pasta.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import type {
  BookmapDepthColunar,
  BookmapGrid,
  CelulaHeatmapVerbosa,
  CoberturaHeatmap,
  FonteBookmap,
  VisibleWindow,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// O que foi medido no pregão de referência
// ═════════════════════════════════════════════════════════════════════════════

/** Contrato do pregão de referência. */
export const BENCH_SYMBOL = 'WINV26';

/** Fonte do livro. Rótulo de filtro; não seleciona conexão. */
export const BENCH_FONTE: FonteBookmap = 'MT5_L2';

/** Dia de referência, `YYYY-MM-DD` BRT. */
export const BENCH_DIA = '2026-08-28';

/** Único balde materializado hoje. */
export const BENCH_BALDE_SEG = 60;

/** Incremento mínimo de preço do mini-índice. */
export const BENCH_TICK_SIZE = 5;

/** Células do conjunto de referência. */
export const BENCH_CELULAS = 25_823;

/** Baldes do eixo de tempo: 570 × 60 s = 09:00 → 18:30 BRT. */
export const BENCH_BALDES = 570;

/** Preços distintos no eixo. */
export const BENCH_PRECOS = 624;

/** Piso da escala de cor medido na fila. */
export const BENCH_FILA_P50 = 481;

/** Percentil 90 medido na fila. */
export const BENCH_FILA_P90 = 714;

/** Teto da escala de cor medido na fila. */
export const BENCH_FILA_P99 = 1_131;

/** Máximo global medido — **nível cruzado**, artefato e não liquidez. */
export const BENCH_FILA_MAX = 36_232;

/** Maior parede **real** medida. Acima disso, só artefato. */
export const BENCH_PAREDE_MAX_REAL = 2_442;

/** Fração das células concentrada na banda do miolo. */
export const BENCH_FRACAO_MIOLO = 0.971;

/** Preço do nível cruzado que carrega o máximo global. */
export const BENCH_PRECO_CRUZADO = 160_040;

// ═════════════════════════════════════════════════════════════════════════════
// Parâmetros da síntese — derivados das medidas acima
// ═════════════════════════════════════════════════════════════════════════════

/** Semente do gerador. Fixa: é o que torna o conjunto reprodutível. */
const SEMENTE = 0x28_08_20_26;

/** Preços contíguos da banda do miolo. 600 × 5 pts = 3.000 pts de amplitude. */
const MIOLO_PRECOS = 600;

/** Preço mais baixo da banda. O mais alto fica em 179.040. */
const MIOLO_PRECO_BASE = 176_045;

/** Preços esparsos abaixo da banda — onde vivem os níveis cruzados. */
const CAUDA_ABAIXO_PRECOS = 12;

/** Preços esparsos acima da banda. */
const CAUDA_ACIMA_PRECOS = 12;

/** Passo entre preços da cauda inferior, a partir de `BENCH_PRECO_CRUZADO`. */
const CAUDA_ABAIXO_PASSO = 1_200;

/** Passo entre preços da cauda superior, a partir do topo da banda. */
const CAUDA_ACIMA_PASSO = 300;

/** Células na banda do miolo: 25.074 / 25.823 = 97,099%. */
const MIOLO_CELULAS = 25_074;

/** Células fora da banda. */
const CAUDA_CELULAS = BENCH_CELULAS - MIOLO_CELULAS;

/** Uma célula por balde com fila nos DOIS lados (requisito 1.9). */
const CELULAS_DOIS_LADOS = BENCH_BALDES;

/** Entradas positivas na união `bid ∪ ask` — a amostra dos percentis. */
const FILA_POSITIVOS = BENCH_CELULAS + CELULAS_DOIS_LADOS;

/** Células de nível cruzado que carregam valor de artefato. */
const ARTEFATOS_CRUZADOS = 8;

/** Índice mais baixo de meio de livro que mantém a janela dentro do eixo. */
const MIOLO_MID_MIN = 22;

/** Índice mais alto de meio de livro que mantém a janela dentro do eixo. */
const MIOLO_MID_MAX = MIOLO_PRECOS - 22;

/** Balde ancorado no extremo inferior da banda, para cobrir o índice 0. */
const BALDE_ANCORA_MIN = 3;

/** Balde ancorado no extremo superior, para cobrir o índice 599. */
const BALDE_ANCORA_MAX = BENCH_BALDES - 4;

/** Ciclos completos da varredura de preço ao longo do dia. */
const VARREDURA_CICLOS = 2;

/** Amplitude do ruído somado à varredura, em índices de preço. */
const VARREDURA_RUIDO = 3;

/** 2026-08-28T12:00:00Z = 09:00 BRT. `Date.UTC` é puro. */
const T0_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** Baldes com execução capturada: 0..211 ⇒ o último abre 12:31 BRT. */
const BALDES_COM_EXEC = 212;

/** Fração das células dos baldes cobertos que carregam execução. */
const EXEC_UMA_EM = 2;

/** Teto plausível de execução por balde e por preço, em contratos. */
const EXEC_MAX = 900;

/** Postos de platô em cada lado do âncora de percentil. */
const PLATO_RAIO = 2;

/**
 * Valores de artefato de nível cruzado, crescentes, terminando no máximo medido.
 *
 * São **oito** e não um: um único valor extremo seria fácil de acomodar por
 * acidente, e o requisito 2.11 exige que o `p99` da janela não se mova mais de
 * um posto na presença desse tipo de célula. Uma pequena cauda torna a exigência
 * mais dura do que um ponto isolado.
 */
const ARTEFATO_VALORES: readonly number[] = [
  2_900, 4_100, 5_800, 8_200, 11_600, 16_400, 24_000, BENCH_FILA_MAX,
];

// ═════════════════════════════════════════════════════════════════════════════
// Gerador determinístico
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `mulberry32` — gerador de 32 bits, aritmética inteira, sem estado global.
 *
 * Escolhido por caber em oito linhas auditáveis e por não usar `bigint`, que o
 * alvo `ES2017` do projeto não compila. Qualidade estatística é irrelevante
 * aqui: o que importa é reprodutibilidade, e as estatísticas do conjunto são
 * impostas por construção, não sorteadas.
 */
function criarGerador(semente: number): () => number {
  let a = semente >>> 0;
  return (): number => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Eixos
// ═════════════════════════════════════════════════════════════════════════════

/** Eixo de tempo: 570 baldes de 60 s a partir de 09:00 BRT. */
function construirEixoDeTempo(): number[] {
  const t: number[] = new Array<number>(BENCH_BALDES);
  for (let i = 0; i < BENCH_BALDES; i += 1) {
    t[i] = T0_MS + i * BENCH_BALDE_SEG * 1_000;
  }
  return t;
}

/**
 * Eixo de preço: cauda inferior esparsa, banda contígua, cauda superior esparsa.
 *
 * Esparso de propósito. O eixo do payload é o **conjunto de preços com célula**,
 * não uma faixa contígua — e é isso que permite ao conjunto conter ao mesmo
 * tempo a banda de oscilação do dia e o nível cruzado em 160.040, a 17.000
 * pontos de distância, sem 3.800 preços vazios no meio.
 */
function construirEixoDePreco(): number[] {
  const p: number[] = [];

  for (let j = 0; j < CAUDA_ABAIXO_PRECOS; j += 1) {
    p.push(BENCH_PRECO_CRUZADO + j * CAUDA_ABAIXO_PASSO);
  }
  for (let j = 0; j < MIOLO_PRECOS; j += 1) {
    p.push(MIOLO_PRECO_BASE + j * BENCH_TICK_SIZE);
  }
  const topoDaBanda = MIOLO_PRECO_BASE + (MIOLO_PRECOS - 1) * BENCH_TICK_SIZE;
  for (let j = 1; j <= CAUDA_ACIMA_PRECOS; j += 1) {
    p.push(topoDaBanda + j * CAUDA_ACIMA_PASSO);
  }

  return p;
}

/** Deslocamento da banda dentro do eixo de preço. */
const OFFSET_MIOLO = CAUDA_ABAIXO_PRECOS;

// ═════════════════════════════════════════════════════════════════════════════
// Ocupação: quais pares (balde, preço) têm célula
// ═════════════════════════════════════════════════════════════════════════════

/** Uma célula em construção, antes da atribuição de quantidade. */
interface CelulaCrua {
  /** Índice em `eixos.t`. */
  ti: number;
  /** Índice em `eixos.p`. */
  pi: number;
  /** Tem fila de compra. */
  temBid: boolean;
  /** Tem fila de venda. */
  temAsk: boolean;
}

/**
 * Células por balde na banda: 564 baldes com 44 e 6 com 43, somando 25.074.
 *
 * 44 níveis por balde é a ordem de grandeza de um livro de 20 níveis por lado
 * mais a oscilação do preço dentro do balde de 60 s.
 */
function contagemDoBalde(t: number): number {
  const base = Math.floor(MIOLO_CELULAS / BENCH_BALDES);
  const resto = MIOLO_CELULAS - base * BENCH_BALDES;
  return t < resto ? base + 1 : base;
}

/**
 * Meio do livro no balde `t`, em índice da banda.
 *
 * Varredura triangular de `VARREDURA_CICLOS` ciclos com ruído, e **âncoras nos
 * extremos**: sem elas a varredura para a um índice do topo por causa do
 * arredondamento, e o eixo de preço fecharia em 623 valores em vez de 624 — o
 * tipo de erro de um índice que passa despercebido até a contagem não fechar.
 */
function meioDoLivro(t: number, ruido: number): number {
  if (t === BALDE_ANCORA_MIN) return MIOLO_MID_MIN;
  if (t === BALDE_ANCORA_MAX) return MIOLO_MID_MAX;

  const amplitude = MIOLO_MID_MAX - MIOLO_MID_MIN;
  const u = (t * VARREDURA_CICLOS * 2) / (BENCH_BALDES - 1);
  const w = u % 2;
  const tri = w <= 1 ? w : 2 - w;

  const bruto = MIOLO_MID_MIN + Math.round(tri * amplitude) + ruido;
  if (bruto < MIOLO_MID_MIN) return MIOLO_MID_MIN;
  if (bruto > MIOLO_MID_MAX) return MIOLO_MID_MAX;
  return bruto;
}

/**
 * Monta a ocupação inteira: banda primeiro, cauda depois, em ordem
 * (balde, preço) crescente dentro de cada bloco.
 *
 * ⚠️ A saída **não** fica globalmente ordenada por (balde, preço), porque as
 * células de cauda entram depois das de banda. Isso é deliberado: o payload
 * colunar não exige coluna ordenada, e a fixture de contrato já prova que o
 * decodificador não presume ordem. Um conjunto de referência ordenado deixaria
 * de exercitar isso.
 */
function construirOcupacao(gerador: () => number): CelulaCrua[] {
  const celulas: CelulaCrua[] = [];

  // ── Banda do miolo ────────────────────────────────────────────────────────
  for (let t = 0; t < BENCH_BALDES; t += 1) {
    const quantas = contagemDoBalde(t);
    const ruido = Math.round((gerador() * 2 - 1) * VARREDURA_RUIDO);
    const mid = meioDoLivro(t, ruido);
    const inicio = mid - (quantas >> 1);

    for (let j = 0; j < quantas; j += 1) {
      const idxBanda = inicio + j;
      celulas.push({
        ti: t,
        pi: OFFSET_MIOLO + idxBanda,
        // Livro de verdade: compra abaixo do meio, venda acima. No próprio meio
        // os dois lados aparecem dentro do balde — o caso do requisito 1.9.
        temBid: idxBanda <= mid,
        temAsk: idxBanda >= mid,
      });
    }
  }

  // ── Caudas: níveis distantes, todos do lado errado do mercado ─────────────
  const precosDeCauda: number[] = [];
  for (let j = 0; j < CAUDA_ABAIXO_PRECOS; j += 1) precosDeCauda.push(j);
  for (let j = 0; j < CAUDA_ACIMA_PRECOS; j += 1) {
    precosDeCauda.push(OFFSET_MIOLO + MIOLO_PRECOS + j);
  }

  const nCauda = precosDeCauda.length;
  const base = Math.floor(CAUDA_CELULAS / nCauda);
  const resto = CAUDA_CELULAS - base * nCauda;

  for (let j = 0; j < nCauda; j += 1) {
    const pi = precosDeCauda[j] ?? 0;
    const quantas = j < resto ? base + 1 : base;
    const passo = Math.max(1, Math.floor(BENCH_BALDES / quantas));
    const deslocamento = Math.floor(gerador() * BENCH_BALDES);

    for (let k = 0; k < quantas; k += 1) {
      // `k * passo < BENCH_BALDES` por construção do passo, então o resto da
      // divisão não colide: os baldes escolhidos são distintos.
      const t = (deslocamento + k * passo) % BENCH_BALDES;
      const abaixoDaBanda = pi < OFFSET_MIOLO;
      // Abaixo da banda, venda é oferta cruzada; acima, compra é. A alternância
      // deixa parte da cauda como oferta profunda legítima do lado certo.
      const cruzado = k % 2 === 0;
      celulas.push({
        ti: t,
        pi,
        temBid: abaixoDaBanda ? !cruzado : cruzado,
        temAsk: abaixoDaBanda ? cruzado : !cruzado,
      });
    }
  }

  return celulas;
}

// ═════════════════════════════════════════════════════════════════════════════
// Quantidades de fila: percentis exatos por construção
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Posto da estatística de ordem que representa o quantil `q` numa amostra de
 * `n` elementos.
 *
 * ⚠️ **Mesma convenção de `bookmap-color.core`** (`quantileIndex`): teto do
 * produto, menos um. Divergir dela aqui faria o conjunto de referência mirar um
 * posto e a medição ler outro, e os âncoras não fechariam — motivo pelo qual a
 * fórmula está repetida em vez de aproximada.
 */
function postoDoQuantil(q: number, n: number): number {
  const idx = Math.ceil(q * n) - 1;
  if (idx < 0) return 0;
  if (idx > n - 1) return n - 1;
  return idx;
}

/**
 * Vetor de quantidades de fila, **ordenado crescente**, de comprimento
 * `FILA_POSITIVOS`.
 *
 * Construído por interpolação linear entre os âncoras medidos, com platô de
 * `PLATO_RAIO` postos de cada lado de cada âncora. O platô é o que dispensa a
 * bancada de depender da convenção exata de percentil: qualquer definição que
 * caia a até dois postos do âncora devolve o valor medido, exato.
 *
 * Os `ARTEFATOS_CRUZADOS` últimos postos são os níveis cruzados, acima da maior
 * parede real.
 */
function construirValoresDeFila(): Float64Array {
  const n = FILA_POSITIVOS;
  const valores = new Float64Array(n);

  const ultimoReal = n - ARTEFATOS_CRUZADOS - 1;
  const postoP50 = postoDoQuantil(0.5, n);
  const postoP90 = postoDoQuantil(0.9, n);
  const postoP99 = postoDoQuantil(0.99, n);

  // Âncoras: (posto, valor). Crescentes nas duas coordenadas.
  const ancoras: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [postoP50, BENCH_FILA_P50],
    [postoP90, BENCH_FILA_P90],
    [postoP99, BENCH_FILA_P99],
    [ultimoReal, BENCH_PAREDE_MAX_REAL],
  ];

  for (let s = 0; s < ancoras.length - 1; s += 1) {
    const de = ancoras[s] ?? [0, 1];
    const ate = ancoras[s + 1] ?? [0, 1];
    const [posDe, valDe] = de;
    const [posAte, valAte] = ate;
    const vao = posAte - posDe;

    for (let i = posDe; i <= posAte; i += 1) {
      const fracao = vao <= 0 ? 1 : (i - posDe) / vao;
      valores[i] = Math.round(valDe + (valAte - valDe) * fracao);
    }
  }

  // Platô nos três âncoras de percentil: torna o valor apurado insensível à
  // convenção de posto a menos de ±PLATO_RAIO.
  const platos: ReadonlyArray<readonly [number, number]> = [
    [postoP50, BENCH_FILA_P50],
    [postoP90, BENCH_FILA_P90],
    [postoP99, BENCH_FILA_P99],
  ];
  for (const plato of platos) {
    const [posto, valor] = plato;
    const de = Math.max(0, posto - PLATO_RAIO);
    const ate = Math.min(ultimoReal, posto + PLATO_RAIO);
    for (let i = de; i <= ate; i += 1) valores[i] = valor;
  }

  // Níveis cruzados no topo.
  for (let i = 0; i < ARTEFATOS_CRUZADOS; i += 1) {
    valores[ultimoReal + 1 + i] = ARTEFATO_VALORES[i] ?? BENCH_FILA_MAX;
  }

  return valores;
}

/**
 * Uma posição de fila a preencher: a célula e o lado.
 *
 * A atribuição acontece por **posto** e não por célula porque é a união
 * `bid ∪ ask` que forma a amostra dos percentis — a mesma que
 * `computeColorScalePair` toma.
 */
interface VagaDeFila {
  /** Índice da célula em `CelulaCrua[]`. */
  readonly celula: number;
  readonly lado: 'BID' | 'ASK';
  /** Chave de ordenação: define quem recebe as quantidades maiores. */
  readonly chave: number;
  /** Desempate: mantém a ordenação determinística sem depender do motor. */
  readonly ordem: number;
}

/** Preço redondo atrai parede. Escada de bônus, do mais redondo ao menos. */
function bonusDePrecoRedondo(preco: number): number {
  if (preco % 5_000 === 0) return 3;
  if (preco % 1_000 === 0) return 2;
  if (preco % 500 === 0) return 1;
  return 0;
}

/**
 * Distribui as quantidades de fila pelas vagas.
 *
 * A chave de ordenação combina uma **força persistente por preço** com o bônus
 * de preço redondo e um ruído pequeno por célula. Como a força é do preço e não
 * da célula, o mesmo preço recebe quantidades consistentemente altas em baldes
 * consecutivos — ou seja, as paredes **persistem**, que é a condição de
 * qualificação do requisito 6.1. Uma permutação uniforme acertaria os percentis
 * e produziria um conjunto sem parede alguma, inútil para medir o que o desenho
 * de fato desenha.
 *
 * Os `ARTEFATOS_CRUZADOS` maiores valores são forçados às vagas de venda no
 * preço cruzado mais baixo — é assim que o máximo de 36.232 ct fica em 160.040,
 * como medido.
 */
function atribuirFila(
  celulas: readonly CelulaCrua[],
  precos: readonly number[],
  gerador: () => number,
): { bid: Float32Array; ask: Float32Array } {
  const forcaDoPreco = new Float64Array(precos.length);
  for (let i = 0; i < precos.length; i += 1) {
    forcaDoPreco[i] = gerador() * 10 + bonusDePrecoRedondo(precos[i] ?? 0);
  }

  const vagas: VagaDeFila[] = [];
  const artefatos: VagaDeFila[] = [];
  let ordem = 0;

  for (let k = 0; k < celulas.length; k += 1) {
    const c = celulas[k];
    if (c === undefined) continue;
    const forca = forcaDoPreco[c.pi] ?? 0;

    const lados: Array<'BID' | 'ASK'> = [];
    if (c.temBid) lados.push('BID');
    if (c.temAsk) lados.push('ASK');

    for (const lado of lados) {
      const vaga: VagaDeFila = {
        celula: k,
        lado,
        chave: forca + gerador(),
        ordem,
      };
      ordem += 1;

      // Venda no preço cruzado mais baixo: candidata a artefato.
      const ehArtefato =
        c.pi === 0 && lado === 'ASK' && artefatos.length < ARTEFATOS_CRUZADOS;
      if (ehArtefato) artefatos.push(vaga);
      else vagas.push(vaga);
    }
  }

  vagas.sort((x, y) => (x.chave !== y.chave ? x.chave - y.chave : x.ordem - y.ordem));
  artefatos.sort((x, y) => x.ordem - y.ordem);

  const valores = construirValoresDeFila();
  const bid = new Float32Array(celulas.length);
  const ask = new Float32Array(celulas.length);

  // As vagas comuns recebem os postos baixos; os artefatos, os postos do topo.
  const ordenadas = [...vagas, ...artefatos];
  for (let i = 0; i < ordenadas.length; i += 1) {
    const vaga = ordenadas[i];
    if (vaga === undefined) continue;
    const v = valores[i] ?? 0;
    if (vaga.lado === 'BID') bid[vaga.celula] = v;
    else ask[vaga.celula] = v;
  }

  return { bid, ask };
}

// ═════════════════════════════════════════════════════════════════════════════
// Quantidades de execução — distribuição NÃO medida, ver o cabeçalho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Execução por célula, restrita aos baldes com cobertura.
 *
 * ⚠️ Nenhuma estatística de execução do pregão real está registrada no projeto.
 * O que se reproduz aqui é a **cobertura** (`EXEC_PARCIAL`, execução só até
 * 12:31 BRT), que é medida; as magnitudes são plausíveis e escolhidas, e estão
 * declaradas como escolha no cabeçalho deste arquivo.
 */
function atribuirExecucao(
  celulas: readonly CelulaCrua[],
  gerador: () => number,
): { buy: Float32Array; sell: Float32Array } {
  const buy = new Float32Array(celulas.length);
  const sell = new Float32Array(celulas.length);

  for (let k = 0; k < celulas.length; k += 1) {
    const c = celulas[k];
    if (c === undefined) continue;
    if (c.ti >= BALDES_COM_EXEC) continue;
    if (k % EXEC_UMA_EM !== 0) continue;

    // Cauda longa: a maioria em dezenas, poucas centenas no topo.
    const u = gerador();
    const magnitude = Math.max(1, Math.round(EXEC_MAX * u * u * u));
    const divisao = 0.3 + gerador() * 0.4;

    buy[k] = Math.round(magnitude * divisao);
    sell[k] = magnitude - Math.round(magnitude * divisao);
  }

  return { buy, sell };
}

// ═════════════════════════════════════════════════════════════════════════════
// Montagem
// ═════════════════════════════════════════════════════════════════════════════

/** O conjunto de referência construído, nas três formas. */
interface ConjuntoDeReferencia {
  readonly celulas: readonly CelulaCrua[];
  readonly times: readonly number[];
  readonly prices: readonly number[];
  readonly bid: Float32Array;
  readonly ask: Float32Array;
  readonly buy: Float32Array;
  readonly sell: Float32Array;
  readonly cobertura: CoberturaHeatmap;
}

/**
 * Cobertura do dia de referência: fila nos 570 baldes, execução nos 212
 * primeiros. Classe `EXEC_PARCIAL` — o estado de 100% dos pregões
 * materializados, e por isso o estado que a bancada deve exercitar.
 */
function construirCobertura(times: readonly number[]): CoberturaHeatmap {
  const primeiro = times[0] ?? T0_MS;
  const ultimo = times[times.length - 1] ?? T0_MS;
  const ultimoComExec = times[BALDES_COM_EXEC - 1] ?? T0_MS;

  return {
    classe: 'EXEC_PARCIAL',
    observacao:
      'Fila agregada de 09:00 a 18:30 BRT; execução agregada de 09:00 a 12:31 BRT. ' +
      'O trecho 12:31–18:30 BRT fica sem execução capturada.',
    filaDeMs: primeiro,
    filaAteMs: ultimo,
    execDeMs: primeiro,
    execAteMs: ultimoComExec,
  };
}

let memo: ConjuntoDeReferencia | null = null;

/**
 * Constrói (uma vez) o conjunto de referência e o guarda.
 *
 * A memoização é de conveniência da bancada, não de correção: o construtor é
 * determinístico e duas construções produzem vetores idênticos. `redefinir()`
 * descarta o guardado para quem quiser provar exatamente isso.
 */
function conjunto(): ConjuntoDeReferencia {
  if (memo !== null) return memo;

  const gerador = criarGerador(SEMENTE);
  const times = construirEixoDeTempo();
  const prices = construirEixoDePreco();
  const celulas = construirOcupacao(gerador);
  const fila = atribuirFila(celulas, prices, gerador);
  const exec = atribuirExecucao(celulas, gerador);

  memo = {
    celulas,
    times,
    prices,
    bid: fila.bid,
    ask: fila.ask,
    buy: exec.buy,
    sell: exec.sell,
    cobertura: construirCobertura(times),
  };
  return memo;
}

/** Descarta o conjunto guardado. Só a suíte do arnês precisa disso. */
export function redefinirConjuntoDeReferencia(): void {
  memo = null;
}

// ═════════════════════════════════════════════════════════════════════════════
// As três formas públicas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O conjunto no **formato colunar** — a entrada de `decodeColumnar`.
 *
 * A ordem das chaves espelha o ramo colunar do controller, para que medir o
 * tamanho deste objeto (tarefa 12.3) fale do corpo que a rede transportaria.
 */
export function payloadColunar(): BookmapDepthColunar {
  const c = conjunto();
  const n = c.celulas.length;

  const ti: number[] = new Array<number>(n);
  const pi: number[] = new Array<number>(n);
  const b: number[] = new Array<number>(n);
  const a: number[] = new Array<number>(n);
  const cc: number[] = new Array<number>(n);
  const v: number[] = new Array<number>(n);

  for (let k = 0; k < n; k += 1) {
    const cel = c.celulas[k];
    ti[k] = cel?.ti ?? 0;
    pi[k] = cel?.pi ?? 0;
    b[k] = c.bid[k] ?? 0;
    a[k] = c.ask[k] ?? 0;
    cc[k] = c.buy[k] ?? 0;
    v[k] = c.sell[k] ?? 0;
  }

  return {
    formato: 'colunar',
    symbol: BENCH_SYMBOL,
    fonte: BENCH_FONTE,
    de: BENCH_DIA,
    baldeSeg: BENCH_BALDE_SEG,
    nivel: 'PROFUNDIDADE',
    celulas: n,
    eixos: { t: c.times, p: c.prices },
    colunas: { ti, pi, b, a, c: cc, v },
    cobertura: c.cobertura,
  };
}

/**
 * O conjunto no **formato verboso** — o contrato de rede atual, um objeto por
 * célula. Existe para a tarefa 12.3 comparar tamanho de corpo.
 */
export function celulasVerbosas(): CelulaHeatmapVerbosa[] {
  const c = conjunto();
  const saida: CelulaHeatmapVerbosa[] = new Array<CelulaHeatmapVerbosa>(c.celulas.length);

  for (let k = 0; k < c.celulas.length; k += 1) {
    const cel = c.celulas[k];
    saida[k] = {
      tsMs: c.times[cel?.ti ?? 0] ?? T0_MS,
      preco: c.prices[cel?.pi ?? 0] ?? 0,
      filaBid: c.bid[k] ?? 0,
      filaAsk: c.ask[k] ?? 0,
      execCompra: c.buy[k] ?? 0,
      execVenda: c.sell[k] ?? 0,
    };
  }

  return saida;
}

/**
 * O conjunto já **decodificado**, em arrays tipados.
 *
 * ⚠️ Construído aqui **sem** passar por `decodeColumnar`, de propósito: a
 * medição do decodificador (requisito 9.6) precisa que o grid de entrada das
 * outras medições não seja produto da função sob medição. Que as duas rotas
 * concordam é asserção da suíte do arnês, não suposição.
 */
export function gridDeReferencia(): BookmapGrid {
  const c = conjunto();
  const n = c.celulas.length;

  const ti = new Uint32Array(n);
  const pi = new Uint32Array(n);
  for (let k = 0; k < n; k += 1) {
    const cel = c.celulas[k];
    ti[k] = cel?.ti ?? 0;
    pi[k] = cel?.pi ?? 0;
  }

  return {
    symbol: BENCH_SYMBOL,
    fonte: BENCH_FONTE,
    dia: BENCH_DIA,
    baldeSeg: BENCH_BALDE_SEG,
    times: Float64Array.from(c.times),
    prices: Float64Array.from(c.prices),
    ti,
    pi,
    // Cópias: o grid entregue é independente do conjunto guardado, então uma
    // medição que mutasse os vetores não contaminaria a seguinte.
    bid: Float32Array.from(c.bid),
    ask: Float32Array.from(c.ask),
    buy: Float32Array.from(c.buy),
    sell: Float32Array.from(c.sell),
    cobertura: c.cobertura,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Contabilidade de bytes do grid (requisito 9.7)
// ═════════════════════════════════════════════════════════════════════════════

/** Tamanho do grid decodificado, separado como o requisito 9.7 separa. */
export interface TamanhoDoGrid {
  /** `times` + `prices`. */
  readonly eixosBytes: number;
  /** `bid` + `ask` + `buy` + `sell`. */
  readonly valoresBytes: number;
  /** **A medida do requisito 9.7**: eixos + valores. Teto de 614.400 bytes. */
  readonly eixosMaisValoresBytes: number;
  /** `ti` + `pi`. Fora da conta do requisito — ver `bookmap-types`. */
  readonly indicesBytes: number;
  /** Tudo, para que a diferença fique visível em vez de surpreender. */
  readonly totalBytes: number;
}

/**
 * Soma os `byteLength` das estruturas do grid.
 *
 * Medição **sem instantâneo de heap**, como o requisito 9.7 exige: `byteLength`
 * de um array tipado é o tamanho do buffer, exato e independente de motor — ao
 * contrário de qualquer estimativa de heap, que varia com a implementação e não
 * seria comparável entre execuções.
 */
export function tamanhoDoGridEmBytes(grid: BookmapGrid): TamanhoDoGrid {
  const eixosBytes = grid.times.byteLength + grid.prices.byteLength;
  const valoresBytes =
    grid.bid.byteLength + grid.ask.byteLength + grid.buy.byteLength + grid.sell.byteLength;
  const indicesBytes = grid.ti.byteLength + grid.pi.byteLength;

  return {
    eixosBytes,
    valoresBytes,
    eixosMaisValoresBytes: eixosBytes + valoresBytes,
    indicesBytes,
    totalBytes: eixosBytes + valoresBytes + indicesBytes,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Janelas visíveis de dimensões fixas (requisito 9.1)
// ═════════════════════════════════════════════════════════════════════════════

/** Dimensões do viewport de uma medição. Fixas por exigência do requisito 9.1. */
export interface DimensoesDeViewport {
  readonly larguraPx: number;
  readonly alturaPx: number;
}

/**
 * Monta uma `VisibleWindow` a partir de limites e viewport.
 *
 * ⚠️ `baldesVisiveis` e `ticksVisiveis` usam **a mesma fórmula** de
 * `BookmapPrimitive` (piso da divisão, mais um, nunca negativo). Divergir dela
 * faria a bancada medir uma agregação que a camada nunca pede.
 */
function montarJanela(
  limites: { tsDe: number; tsAte: number; precoDe: number; precoAte: number },
  viewport: DimensoesDeViewport,
): VisibleWindow {
  const baldeMs = BENCH_BALDE_SEG * 1_000;
  return {
    tsDe: limites.tsDe,
    tsAte: limites.tsAte,
    precoDe: limites.precoDe,
    precoAte: limites.precoAte,
    larguraPx: viewport.larguraPx,
    alturaPx: viewport.alturaPx,
    baldesVisiveis: Math.max(0, Math.floor((limites.tsAte - limites.tsDe) / baldeMs) + 1),
    ticksVisiveis: Math.max(
      0,
      Math.floor((limites.precoAte - limites.precoDe) / BENCH_TICK_SIZE) + 1,
    ),
  };
}

/**
 * Janela que abrange a **extensão completa do pregão** do conjunto — o caso do
 * requisito 9.4.
 *
 * É o pior zoom por dois motivos que se acumulam: 570 baldes em `larguraPx`, e
 * um eixo de preço que vai de 160.040 a 182.640 por causa do nível cruzado, o
 * que produz milhares de ticks visíveis e força o agrupamento no eixo de preço.
 */
export function janelaExtensaoCompleta(
  grid: BookmapGrid,
  viewport: DimensoesDeViewport,
): VisibleWindow {
  const nT = grid.times.length;
  const nP = grid.prices.length;
  return montarJanela(
    {
      tsDe: grid.times[0] ?? T0_MS,
      tsAte: grid.times[nT - 1] ?? T0_MS,
      precoDe: grid.prices[0] ?? 0,
      precoAte: grid.prices[nP - 1] ?? 0,
    },
    viewport,
  );
}

/**
 * Janela restrita à **banda do miolo**, com a extensão de tempo inteira.
 *
 * É a vista de operação: 97,1% das células e nenhum nível cruzado esticando o
 * eixo de preço. Serve à medição de `draw()` com o orçamento cheio de células
 * (requisito 9.3), que na extensão completa ficaria dominada pelo agrupamento.
 */
export function janelaDoMiolo(
  grid: BookmapGrid,
  viewport: DimensoesDeViewport,
): VisibleWindow {
  const nT = grid.times.length;
  const topoDaBanda = MIOLO_PRECO_BASE + (MIOLO_PRECOS - 1) * BENCH_TICK_SIZE;
  return montarJanela(
    {
      tsDe: grid.times[0] ?? T0_MS,
      tsAte: grid.times[nT - 1] ?? T0_MS,
      precoDe: MIOLO_PRECO_BASE,
      precoAte: topoDaBanda,
    },
    viewport,
  );
}

/** Limites do conjunto, para quem precisa montar dublê de escala do gráfico. */
export const BENCH_LIMITES = {
  tsDeMs: T0_MS,
  tsAteMs: T0_MS + (BENCH_BALDES - 1) * BENCH_BALDE_SEG * 1_000,
  precoMiloBase: MIOLO_PRECO_BASE,
  precoMioloTopo: MIOLO_PRECO_BASE + (MIOLO_PRECOS - 1) * BENCH_TICK_SIZE,
  baldesComExec: BALDES_COM_EXEC,
  filaPositivos: FILA_POSITIVOS,
  celulasNoMiolo: MIOLO_CELULAS,
  celulasNaCauda: CAUDA_CELULAS,
  celulasDoisLados: CELULAS_DOIS_LADOS,
  artefatosCruzados: ARTEFATOS_CRUZADOS,
} as const;
