/**
 * `decodeColumnar` — payload colunar da rede → `BookmapGrid` em memória.
 * Spec `bookmap-no-mapa-de-decisao`, tarefa 2.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O **único produtor de `BookmapGrid` no sistema**. Todo consumidor — escala de
 * cor, agregação por zoom, mapeamento célula→pixel, detecção de paredes, laço de
 * desenho — confia nos invariantes que esta função garante e não os reverifica.
 * Por isso a validação vive aqui inteira, e não espalhada em cada leitor.
 *
 * Função **pura**: sem DOM, sem `window`, sem relógio, sem sorteio, sem I/O e
 * sem estado de módulo. Duas chamadas com o mesmo payload devolvem o mesmo grid.
 * É o que torna o round-trip (Property 9) e o contrato cruzado com o codificador
 * do backend testáveis sem navegador e sem rede.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE "NUNCA PARCIAL" É REQUISITO, E NÃO ZELO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As coordenadas de cada célula são INDIRETAS: `colunas.ti[k]` e `colunas.pi[k]`
 * são posições nos eixos, e o valor real sai de `eixos.t[ti[k]]` e
 * `eixos.p[pi[k]]`. Um índice deslocado não produz célula faltando — produz
 * célula **no lugar errado**, com a magnitude de outro preço. Um grid meio
 * preenchido desenharia liquidez em preço que não a tem, e o operador leria como
 * suporte algo que não existe. Isso é pior que não desenhar nada.
 *
 * Daí a regra ser binária: ou o payload satisfaz TODOS os invariantes e o grid
 * sai completo, ou a função devolve `null` e o chamador exibe o motivo em pt-BR
 * (requisito 8.7 — decodificação ausente, grid anterior preservado, zero exceção
 * propagada). **Nunca lança e nunca devolve grid parcial.**
 *
 * ── O que REJEITA (devolve `null`) ─────────────────────────────────────────
 *
 * | Condição | Por quê |
 * |---|---|
 * | envoltória ausente / não é objeto | ler campo de `null` lançaria, e lançar é proibido |
 * | `formato` diferente de `colunar` | sem o discriminante, nada garante que as colunas signifiquem o que se supõe (8.7) |
 * | `eixos` ou `colunas` ausente / não é objeto | idem |
 * | qualquer uma das seis colunas não é vetor | idem |
 * | as seis colunas com comprimentos divergentes | desalinha métrica e coordenada (8.7) |
 * | eixo com elemento não numérico ou não finito | não indexa posição alguma |
 * | eixo não estritamente crescente (inclui repetição) | busca por posição deixa de ser bem definida (8.7) |
 * | índice fora do eixo, ou não inteiro | ver abaixo |
 * | valor de fila ou de execução não finito | ver abaixo |
 *
 * **Índice não inteiro** rejeita porque `Uint32Array` truncaria `1.5` para `1`
 * **em silêncio**, movendo a célula para o balde vizinho — e a pós-condição de
 * round-trip exato (`grid.times[grid.ti[k]]` reproduz o instante de origem)
 * deixaria de valer sem que nada acusasse. Posição fracionária não é posição.
 *
 * **Valor não finito** rejeita porque `NaN` em `fillRect` não lança: apenas não
 * desenha, em silêncio. O codificador do backend já sanea não-finito para zero
 * na origem justamente porque este decodificador rejeita o grid inteiro ao topar
 * com valor inválido — as duas pontas concordam, e o custo de sanear lá é uma
 * comparação.
 *
 * ── O que NÃO rejeita (decisões deliberadas) ───────────────────────────────
 *
 * - **Quantidade negativa** passa. Não é risco de coordenada, e a escala de cor
 *   trata valor negativo com a opacidade mínima — rejeitar aqui tornaria esse
 *   caminho inalcançável.
 * - **`celulas` divergente do comprimento das colunas** passa. O comprimento
 *   autoritativo é o das próprias colunas, que é o que o laço percorre; o campo
 *   é declaração da envoltória e sua divergência não move nenhuma célula de
 *   lugar. Rejeitar apagaria o pregão da tela por um campo que ninguém lê.
 * - **`cobertura` malformada** passa verbatim, inclusive `null`. Classificar
 *   cobertura ausente, classe desconhecida ou limites incoerentes é
 *   responsabilidade do núcleo de cobertura, que precisa **receber** o caso para
 *   poder marcá-lo como não verificado em vez de afirmar cobertura completa.
 * - **`baldeSeg` inaproveitável** passa. Largura de balde não é invariante do
 *   grid; o mapeamento célula→pixel já descarta individualmente a célula cuja
 *   conversão não seja finita, sem interromper a passada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PRECISÃO — ONDE O ROUND-TRIP É EXATO E ONDE NÃO PODE SER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os **eixos** são `Float64Array`, então instante e preço voltam bit a bit
 * idênticos ao payload: `grid.times[grid.ti[k]] === eixos.t[colunas.ti[k]]` para
 * todo `k`. É a pós-condição exigida, e é exata porque epoch ms (~1,79 × 10¹²)
 * não caberia na mantissa de 24 bits de um float de 32 bits.
 *
 * Os **valores** são `Float32Array` por orçamento de memória (requisito 9.7).
 * Quantidade de contratos é inteira e vai muito abaixo de 2²⁴ = 16.777.216, logo
 * é representada exatamente. ⚠️ Valor **fracionário** arbitrário, não: `0,1`
 * volta como `0,100000001490116…`. Quem escrever a propriedade de round-trip
 * deve gerar quantidade inteira, ou comparar com tolerância relativa — a
 * exatidão prometida é a dos eixos, não a de real arbitrário.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Importa **exclusivamente tipos** de `./bookmap-types`, que por sua vez não
 * importa nada. O fechamento transitivo de importação deste arquivo é, portanto,
 * vazio em tempo de execução: é estruturalmente incapaz de alcançar serviço de
 * roteamento, feed em tempo real, caminho de execução de ordem ou módulo de
 * conector de terminal, e não carrega endereço de rede, identificador de conta,
 * credencial nem estado de posição.
 *
 * Nada aqui lê arquivo, em CSV ou em qualquer outro formato: o payload chega por
 * parâmetro, vindo do endpoint de heatmap de profundidade.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência. Mesma disciplina de
 * `bookmap-types.ts`.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR. Os nomes de campo
 * em português (`eixos`, `colunas`, `celulas`, `cobertura`) são do contrato de
 * rede e não são traduzidos aqui.
 */

import type {
  BookmapDepthColunar,
  BookmapGrid,
  CoberturaHeatmap,
  FonteBookmap,
} from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Visão frouxa do payload
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O payload chega de `JSON.parse`, então em tempo de execução **qualquer** forma
 * é possível, por mais que a assinatura declare `BookmapDepthColunar`. Este tipo
 * existe para que a validação leia cada campo como `unknown` e o compilador
 * cobre a checagem, em vez de confiar na declaração e lançar no primeiro campo
 * ausente — lançar é justamente o que o requisito 8.7 proíbe.
 */
interface LoosePayload {
  readonly formato?: unknown;
  readonly symbol?: unknown;
  readonly fonte?: unknown;
  readonly de?: unknown;
  readonly baldeSeg?: unknown;
  readonly eixos?: { readonly t?: unknown; readonly p?: unknown } | null;
  readonly colunas?: {
    readonly ti?: unknown;
    readonly pi?: unknown;
    readonly b?: unknown;
    readonly a?: unknown;
    readonly c?: unknown;
    readonly v?: unknown;
  } | null;
  readonly cobertura?: unknown;
}

// ═════════════════════════════════════════════════════════════════════════════
// Validadores locais
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Eixo válido: vetor de números finitos **estritamente crescente**.
 *
 * A comparação é `<=` contra o anterior, o que rejeita repetição junto com
 * desordem numa única passada — são a mesma falha do ponto de vista do
 * consumidor, porque as duas quebram a busca por posição.
 *
 * Devolve o vetor tipado quando válido, `null` quando não. Uma passada, O(n).
 */
function readStrictAxis(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const axis = value as readonly unknown[];

  let previous = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < axis.length; i += 1) {
    const x = axis[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    if (x <= previous) return null;
    previous = x;
  }

  return axis as readonly number[];
}

/**
 * Só confirma que é vetor. O conteúdo é verificado célula a célula no laço
 * principal, junto da cópia — evita uma segunda passada sobre 25.823 posições
 * seis vezes, que é o que o orçamento de 25 ms do requisito 9.6 não tem de
 * sobra.
 */
function readArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

/**
 * Normalização mínima de campo textual de identificação.
 *
 * Não rejeita e não inventa: apenas evita que `undefined` de um payload
 * malformado circule declarado como `string` e apareça na tela como o texto
 * `undefined`. Esses campos são rótulo, não entram em conta nenhuma.
 */
function readLabel(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ═════════════════════════════════════════════════════════════════════════════
// decodeColumnar
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Decodifica o payload colunar no grid tipado que o desenho consome.
 *
 * **Pré-condições** (verificadas em execução, não presumidas)
 * - `payload.formato === 'colunar'`.
 * - `eixos.t` e `eixos.p` estritamente crescentes, sem repetição.
 * - As seis colunas com o mesmo comprimento.
 * - `∀k: 0 ≤ ti[k] < eixos.t.length ∧ 0 ≤ pi[k] < eixos.p.length`, ambos inteiros.
 *
 * **Pós-condições**
 * - Devolve `BookmapGrid` com os invariantes declarados em `bookmap-types.ts`,
 *   ou `null` se qualquer pré-condição falhar. Nunca lança; nunca devolve grid
 *   parcial.
 * - `grid.times[grid.ti[k]] === payload.eixos.t[payload.colunas.ti[k]]` para
 *   todo `k`, e o mesmo em preço — round-trip exato, sem perda.
 * - Nenhuma mutação de `payload`: só leitura, e todo vetor do grid é alocado
 *   novo. Alterar o payload depois da chamada não altera o grid.
 *
 * **Invariante de laço** — na iteração `k`, todo índice já copiado é válido no
 * seu eixo e todo valor já copiado é finito. Índice ou valor inválido **aborta**
 * e devolve `null`; os vetores parcialmente preenchidos morrem sem sair da
 * função, o que é o que sustenta a pós-condição de "nunca parcial" com uma única
 * passada de cópia.
 */
export function decodeColumnar(
  payload: BookmapDepthColunar | unknown,
): BookmapGrid | null {
  // ── 1. Envoltória e discriminante ─────────────────────────────────────────
  //
  // ── ALARGAMENTO DO PARÂMETRO (generalização) ──────────────────────────────
  //
  // Na origem o parâmetro era declarado `BookmapDepthColunar`, mas a primeira
  // linha do corpo sempre foi este `as unknown as LoosePayload | null | undefined`
  // seguido de validação completa — inclusive de `null` e de não-objeto. Ou seja,
  // o tipo declarado era MAIS ESTREITO que a tolerância real da função.
  //
  // Num app isso é inofensivo: o payload chega de um lugar conhecido. Numa
  // biblioteca é armadilha: o dado entra pela rede como `unknown`, e a assinatura
  // estreita obrigava todo adaptador a escrever um cast — que parece inseguro,
  // vira ruído em revisão, e a certa altura alguém o troca por um `any` e perde
  // a validação de outra coisa junto.
  //
  // Aceitar `unknown` é estritamente mais permissivo: toda chamada que compilava
  // antes continua compilando. E é honesto sobre o que a função faz — ela é o
  // ponto de validação, não uma função que confia no chamador.
  const raw = payload as LoosePayload | null | undefined;
  if (raw === null || typeof raw !== 'object') return null;
  if (raw.formato !== 'colunar') return null;

  const eixos = raw.eixos;
  const colunas = raw.colunas;
  if (eixos === null || typeof eixos !== 'object') return null;
  if (colunas === null || typeof colunas !== 'object') return null;

  // ── 2. Eixos ──────────────────────────────────────────────────────────────
  const axisT = readStrictAxis(eixos.t);
  const axisP = readStrictAxis(eixos.p);
  if (axisT === null || axisP === null) return null;

  // ── 3. Colunas: existem e concordam no comprimento ────────────────────────
  const srcTi = readArray(colunas.ti);
  const srcPi = readArray(colunas.pi);
  const srcBid = readArray(colunas.b);
  const srcAsk = readArray(colunas.a);
  const srcBuy = readArray(colunas.c);
  const srcSell = readArray(colunas.v);
  if (
    srcTi === null ||
    srcPi === null ||
    srcBid === null ||
    srcAsk === null ||
    srcBuy === null ||
    srcSell === null
  ) {
    return null;
  }

  const n = srcTi.length;
  if (
    srcPi.length !== n ||
    srcBid.length !== n ||
    srcAsk.length !== n ||
    srcBuy.length !== n ||
    srcSell.length !== n
  ) {
    return null;
  }

  // ── 4. Cópia validada, célula a célula ────────────────────────────────────
  // Eixos em 64 bits (epoch ms não cabe em 32), índices em `Uint32Array` e
  // valores em `Float32Array` — a composição que fecha o teto de 600 KB do
  // requisito 9.7 para o conjunto de referência.
  const times = new Float64Array(axisT);
  const prices = new Float64Array(axisP);
  const lenT = axisT.length;
  const lenP = axisP.length;

  const ti = new Uint32Array(n);
  const pi = new Uint32Array(n);
  const bid = new Float32Array(n);
  const ask = new Float32Array(n);
  const buy = new Float32Array(n);
  const sell = new Float32Array(n);

  for (let k = 0; k < n; k += 1) {
    const kTi = srcTi[k];
    const kPi = srcPi[k];

    // Inteiro e dentro do eixo. `Number.isInteger` já descarta `undefined`,
    // fração e não finito; o `typeof` é o que faz o compilador estreitar o tipo.
    if (
      typeof kTi !== 'number' ||
      !Number.isInteger(kTi) ||
      kTi < 0 ||
      kTi >= lenT ||
      typeof kPi !== 'number' ||
      !Number.isInteger(kPi) ||
      kPi < 0 ||
      kPi >= lenP
    ) {
      return null;
    }

    const kBid = srcBid[k];
    const kAsk = srcAsk[k];
    const kBuy = srcBuy[k];
    const kSell = srcSell[k];

    if (
      typeof kBid !== 'number' ||
      !Number.isFinite(kBid) ||
      typeof kAsk !== 'number' ||
      !Number.isFinite(kAsk) ||
      typeof kBuy !== 'number' ||
      !Number.isFinite(kBuy) ||
      typeof kSell !== 'number' ||
      !Number.isFinite(kSell)
    ) {
      return null;
    }

    ti[k] = kTi;
    pi[k] = kPi;
    bid[k] = kBid;
    ask[k] = kAsk;
    buy[k] = kBuy;
    sell[k] = kSell;
  }

  // ── 5. Grid completo ──────────────────────────────────────────────────────
  return {
    symbol: readLabel(raw.symbol),
    fonte: raw.fonte as FonteBookmap,
    dia: readLabel(raw.de),
    baldeSeg: raw.baldeSeg as number,
    times,
    prices,
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    // Repassada verbatim, inclusive `null` e inclusive malformada: quem
    // classifica cobertura é o núcleo de cobertura, e ele precisa receber o caso
    // para marcá-lo como não verificado em vez de afirmar cobertura completa.
    cobertura: (raw.cobertura ?? null) as CoberturaHeatmap | null,
  };
}
