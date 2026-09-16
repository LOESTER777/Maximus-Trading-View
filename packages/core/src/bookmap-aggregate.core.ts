/**
 * Agregação adaptativa por nível de zoom — spec `bookmap-no-mapa-de-decisao`,
 * tarefa 3.1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROBLEMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O balde de 60 s é o único materializado. Num pregão inteiro isso dá 25.823
 * células; afastado o zoom, cada balde ocupa fração de pixel e desenhar tudo
 * custa mais que o orçamento de frame. A saída é agrupar no cliente — puro e
 * determinístico — mantendo ~3.000 células desenhadas em qualquer escala.
 *
 * ── OS DOIS OPERADORES, E POR QUE NÃO SÃO O MESMO ─────────────────────────
 *
 * **Fila combina por `max`, nunca por média.** Uma parede de 2.442 ct diluída
 * em onze baldes vazios daria 222 ct e **desapareceria do desenho**. A
 * consequência formal do `max` é `max(agregado) === max(original ∩ janela)`: a
 * parede é preservada exatamente, em qualquer zoom. É a mesma decisão que o
 * agregador de retaguarda já toma — herdada, não nova.
 *
 * **Execução combina por `sum`**, e a soma é conservada dentro da janela.
 * Execução é fluxo acumulado; somar é o operador certo lá. Somar fila daria
 * quantidade que nunca esteve em repouso ao mesmo tempo, e tirar média de
 * execução perderia o total negociado.
 *
 * ── ESTOURO DE ORÇAMENTO: DOBRA O MÍNIMO, NÃO TRUNCA ──────────────────────
 *
 * Truncar por ordenação manteria as N maiores células e descartaria o resto —
 * o heatmap ficaria com **buracos** onde havia liquidez pequena, e buraco é
 * indistinguível de ausência de liquidez. Dobrar a dimensão mínima degrada a
 * resolução **uniformemente**, o que é honesto: a imagem fica mais grossa, não
 * mentirosa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PUREZA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Só o tipo é importado. Sem DOM, sem objeto global de janela do navegador, sem
 * relógio, sem gerador pseudoaleatório, sem entrada e saída. Mesma tripla de
 * argumentos ⇒ mesma saída, sempre.
 *
 * ⚠️ O parâmetro público se chama `window` porque a assinatura é fixada pelo
 * projeto — é o objeto `VisibleWindow`, e o identificador global homônimo do
 * navegador fica sombreado dentro das duas funções exportadas. Nenhuma leitura
 * de ambiente acontece aqui. As funções auxiliares usam outro nome de propósito,
 * para que nelas o sombreamento não exista e não reste ambiguidade sobre a
 * origem de nenhum valor.
 *
 * Este módulo não importa nada além do arquivo de tipos, que por sua vez não
 * importa nada — logo o fechamento transitivo é vazio e a camada é
 * estruturalmente incapaz de alcançar roteamento de conexão, feed de tick,
 * envio de ordem, módulo de conector de terminal, endereço de rede,
 * identificador de conta ou estado de posição. Todo insumo chega decodificado
 * de API; nenhum vem do sistema de arquivos, em CSV ou em qualquer formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente, nem como exemplo do que evitar: a verificação de independência
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import type { AggregatedCells, BookmapGrid, VisibleWindow } from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Orçamento — limites e padrões
// ═════════════════════════════════════════════════════════════════════════════

/** Orçamento adotado quando o recebido não for inteiro finito. */
const DEFAULT_MAX_CELLS = 3_000;
const MIN_MAX_CELLS = 1;
const MAX_MAX_CELLS = 20_000;

/** Intervalo admitido para a dimensão mínima de célula, em pixels lógicos. */
const MIN_CELL_PX_FLOOR = 1;
const MIN_CELL_PX_CEIL = 64;

/**
 * Padrões por eixo. São diferentes de propósito: 3 px de largura mantém a
 * coluna de balde distinguível, e 2 px de altura é o suficiente para o tick não
 * virar linha de 1 px — que é onde o antialias do canvas começa a apagar a
 * célula fina.
 */
const DEFAULT_MIN_WIDTH_PX = 3;
const DEFAULT_MIN_HEIGHT_PX = 2;

/**
 * Repetições admitidas depois da primeira tentativa. Dobrar doze vezes
 * multiplica a dimensão mínima por 4.096 — para uma janela coerente, os fatores
 * alcançam o teto de um grupo por eixo muito antes disso, e o agrupamento passa
 * a caber em qualquer orçamento maior ou igual a 1.
 *
 * A cota permanece como defesa que **não pode ser dissolvida por raciocínio**:
 * `baldesVisiveis` e `ticksVisiveis` chegam por parâmetro e são independentes
 * dos limites da janela, então uma janela incoerente (poucas unidades visíveis
 * declaradas, muitos instantes dentro dos limites) mantém os fatores em 1
 * enquanto o orçamento continua estourado. É esse caso que a cota encerra, em
 * vez de repetir sem fim.
 */
const MAX_REPETITIONS = 12;

// ═════════════════════════════════════════════════════════════════════════════
// Resultado com desfecho — como o evento de esgotamento chega ao chamador
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Desfecho da agregação, para o chamador que precisa distinguir **por que** a
 * saída veio vazia.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * O critério de esgotamento pede que o evento seja registrado **uma vez por
 * sessão**. "Sessão" é escopo que um núcleo puro não possui e não pode possuir:
 * guardar a marca num estado de módulo mutável tornaria a saída dependente de
 * quantas vezes a função já foi chamada, quebraria o determinismo e faria os
 * testes dependerem da ordem de execução — exatamente o que a suíte de
 * propriedades existe para impedir.
 *
 * A informação é então **devolvida ao chamador**. Quem tem sessão — a camada de
 * canvas — recebe o fato e faz o registro único, do mesmo modo que já concentra
 * o registro único da autodesativação por falha de desenho. O núcleo informa; a
 * camada com escopo de sessão registra.
 *
 * ⚠️ Consequência para quem integrar: consumir apenas `aggregateForZoom` deixa
 * o critério pela metade — a entrega de zero células acontece, mas o registro
 * não. A camada de canvas precisa chamar `aggregateForZoomWithOutcome` e
 * registrar quando `budgetExhausted` for verdadeiro.
 *
 * `AggregatedCells` permanece com a forma fixada pelo projeto: nenhum campo foi
 * acrescentado a ela, porque o mapeamento célula→pixel e o laço de desenho
 * dependem daquele contrato.
 */
export interface AggregationOutcome {
  /** A saída da agregação, exatamente como `aggregateForZoom` a devolve. */
  readonly cells: AggregatedCells;
  /**
   * As repetições se esgotaram e **por isso** `cells.count` é zero.
   *
   * Falso em toda outra origem de saída vazia — janela degenerada, janela sem
   * nenhuma célula, grid vazio —, que são situações normais e não merecem
   * registro.
   */
  readonly budgetExhausted: boolean;
  /**
   * Repetições consumidas. Zero significa que o agrupamento couber na primeira
   * tentativa, com a dimensão mínima configurada.
   */
  readonly repetitions: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares puros
// ═════════════════════════════════════════════════════════════════════════════

interface ResolvedBudget {
  readonly maxCells: number;
  readonly minWidthPx: number;
  readonly minHeightPx: number;
}

/**
 * Normaliza o orçamento recebido.
 *
 * `maxCells` só é aceito como inteiro finito — `NaN`, infinito e fracionário
 * caem no padrão em vez de serem arredondados, porque orçamento fracionário
 * indica cálculo errado a montante e adivinhar a intenção esconderia o defeito.
 * Aceito, é restringido ao intervalo admitido.
 *
 * `minCellPx` positivo e finito é override deliberado e vale para **os dois**
 * eixos, restringido ao intervalo admitido. Não utilizável ⇒ padrões por eixo,
 * que são diferentes entre si.
 */
function resolveBudget(budget: { maxCells: number; minCellPx: number }): ResolvedBudget {
  const rawMax = budget.maxCells;
  const maxCells = Number.isInteger(rawMax)
    ? Math.min(MAX_MAX_CELLS, Math.max(MIN_MAX_CELLS, rawMax))
    : DEFAULT_MAX_CELLS;

  const rawPx = budget.minCellPx;
  if (Number.isFinite(rawPx) && rawPx > 0) {
    const clamped = Math.min(MIN_CELL_PX_CEIL, Math.max(MIN_CELL_PX_FLOOR, rawPx));
    return { maxCells, minWidthPx: clamped, minHeightPx: clamped };
  }

  return { maxCells, minWidthPx: DEFAULT_MIN_WIDTH_PX, minHeightPx: DEFAULT_MIN_HEIGHT_PX };
}

/**
 * A janela é utilizável?
 *
 * `!(x > 0)` cobre zero, negativo e `NaN` numa comparação só — `NaN > 0` é
 * falso. A checagem de finitude que vem depois recolhe o infinito positivo, que
 * passaria pela primeira.
 */
function isUsableWindow(visible: VisibleWindow): boolean {
  if (!(visible.larguraPx > 0) || !(visible.alturaPx > 0)) return false;
  if (!Number.isFinite(visible.larguraPx) || !Number.isFinite(visible.alturaPx)) return false;
  if (!Number.isFinite(visible.tsDe) || !Number.isFinite(visible.tsAte)) return false;
  if (!Number.isFinite(visible.precoDe) || !Number.isFinite(visible.precoAte)) return false;
  if (visible.tsDe > visible.tsAte) return false;
  if (visible.precoDe > visible.precoAte) return false;
  return true;
}

/**
 * Menor fator inteiro de agrupamento que faz a dimensão da célula alcançar ou
 * exceder o mínimo do eixo. Devolve 1 quando a dimensão já alcança o mínimo.
 *
 * O teto de `unitsOnAxis` mantém o fator finito e é semanticamente inócuo:
 * agrupar mais que o eixo inteiro produz o mesmo grupo único que agrupar o eixo
 * inteiro. Sem ele, `pxPerUnit` subnormal geraria fator infinito e o resultado
 * do piso viraria `NaN` na materialização.
 */
function groupingFactorFor(
  totalPx: number,
  visibleUnits: number,
  minPx: number,
  unitsOnAxis: number,
): number {
  const denominator = Math.max(1, Number.isFinite(visibleUnits) ? Math.floor(visibleUnits) : 1);
  const pxPerUnit = totalPx / denominator;
  const ceiling = Math.max(1, unitsOnAxis);

  // Dimensão colapsada: um grupo por eixo é a leitura conservadora.
  if (!(pxPerUnit > 0)) return ceiling;

  const raw = Math.ceil(minPx / pxPerUnit);
  if (!Number.isFinite(raw)) return ceiling;
  return Math.min(ceiling, Math.max(1, raw));
}

/**
 * Valor de entrada não finito ou negativo conta como zero, **sem** contaminar
 * os outros três valores da mesma célula: a sanitização é por campo.
 *
 * Zero é a leitura certa aqui porque ausência de célula já significa zero no
 * contrato do payload — tratar valor inválido como zero mantém as duas
 * ausências indistinguíveis, em vez de introduzir um terceiro estado que o
 * desenho não sabe representar.
 *
 * Admite `undefined` de propósito: com verificação de índice ativada no
 * compilador, toda leitura de coluna tem esse tipo, e concentrar o tratamento
 * aqui evita espalhar coalescência pelo laço quente.
 */
function sanitizeValue(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/** Saída vazia, com os fatores efetivamente aplicados. */
function emptyCells(fatorTempo: number, fatorPreco: number): AggregatedCells {
  return {
    count: 0,
    fatorTempo,
    fatorPreco,
    tsMs: new Float64Array(0),
    preco: new Float64Array(0),
    bid: new Float32Array(0),
    ask: new Float32Array(0),
    buy: new Float32Array(0),
    sell: new Float32Array(0),
  };
}

interface WindowBounds {
  readonly tsDe: number;
  readonly tsAte: number;
  readonly precoDe: number;
  readonly precoAte: number;
}

/**
 * Uma tentativa de agrupamento com os fatores dados.
 *
 * Devolve `null` quando o número de grupos excede o orçamento — sinal para o
 * chamador dobrar a dimensão mínima e repetir. **Nenhum grupo é descartado por
 * ordenação ou truncamento em nenhuma tentativa**: ou o agrupamento inteiro
 * cabe, ou a tentativa é abandonada por completo.
 */
function attemptGrouping(
  grid: BookmapGrid,
  bounds: WindowBounds,
  fatorTempo: number,
  fatorPreco: number,
  maxCells: number,
): AggregatedCells | null {
  const { times, prices, ti, pi, bid, ask, buy, sell } = grid;

  const timeAxisLength = times.length;
  const priceAxisLength = prices.length;

  // Comprimento efetivo das colunas. A decodificação garante que as seis são
  // iguais; tomar o mínimo custa nada e impede leitura além do preenchido, que
  // devolveria zeros desenhados como ausência de liquidez.
  const cellCount = Math.min(
    ti.length,
    pi.length,
    bid.length,
    ask.length,
    buy.length,
    sell.length,
  );

  /**
   * Base do encaixe da chave de grupo. `bt * priceGroups + bp` é **bijetivo**
   * enquanto `bp < priceGroups`, então não existe colisão de chave — e é
   * monótono na ordem lexicográfica de `(bt, bp)`, que é exatamente a ordenação
   * exigida na saída. A chave serve de chave de ordenação sem trabalho extra.
   *
   * Multiplicador primo com módulo implícito seria hash, não encaixe: duas
   * coordenadas distintas poderiam colidir e o grupo somaria execução de preços
   * diferentes.
   */
  const priceGroups = Math.max(1, Math.ceil(priceAxisLength / fatorPreco));

  const slotByKey = new Map<number, number>();
  const keys: number[] = [];
  const accTsMs: number[] = [];
  const accPreco: number[] = [];
  const accBid: number[] = [];
  const accAsk: number[] = [];
  const accBuy: number[] = [];
  const accSell: number[] = [];

  for (let k = 0; k < cellCount; k += 1) {
    // `?? NaN` reprova todas as comparações seguintes, então índice ausente cai
    // no mesmo caminho de omissão que índice fora do eixo.
    const timeIndex = ti[k] ?? Number.NaN;
    const priceIndex = pi[k] ?? Number.NaN;

    // Índice fora do eixo: a célula não tem coordenada, então é omitida em vez
    // de desenhada em lugar arbitrário.
    if (!(timeIndex >= 0 && timeIndex < timeAxisLength)) continue;
    if (!(priceIndex >= 0 && priceIndex < priceAxisLength)) continue;

    // Recorte pela janela, limites inclusive. Escrito como `>=`/`<=` para que
    // coordenada não finita — se algum produtor futuro divergir — reprove a
    // comparação e a célula seja omitida, em vez de propagar `NaN`.
    const ts = times[timeIndex] ?? Number.NaN;
    if (!(ts >= bounds.tsDe && ts <= bounds.tsAte)) continue;
    const price = prices[priceIndex] ?? Number.NaN;
    if (!(price >= bounds.precoDe && price <= bounds.precoAte)) continue;

    const bucketTime = Math.floor(timeIndex / fatorTempo);
    const bucketPrice = Math.floor(priceIndex / fatorPreco);
    const key = bucketTime * priceGroups + bucketPrice;

    const valueBid = sanitizeValue(bid[k]);
    const valueAsk = sanitizeValue(ask[k]);
    const valueBuy = sanitizeValue(buy[k]);
    const valueSell = sanitizeValue(sell[k]);

    const slot = slotByKey.get(key);
    if (slot === undefined) {
      // O número de grupos só cresce com o avanço da passada, então o veredito
      // de estouro já é definitivo: abandona agora em vez de terminar uma
      // passada cujo resultado seria descartado.
      if (keys.length >= maxCells) return null;

      // Coordenada do GRUPO, resolvida uma única vez na criação. Guardá-la aqui
      // — em vez de recalcular por célula de saída — troca três leituras de
      // eixo por saída por uma só por grupo, e deixa a materialização sem
      // aritmética de índice.
      //
      // Borda ESQUERDA do grupo de baldes. O índice existe sempre, porque
      // `bucketTime * fatorTempo <= timeIndex < times.length`.
      const groupLowTime = bucketTime * fatorTempo;

      // CENTRO do grupo de ticks. Com fator 1 o intervalo degenera num ponto e
      // o centro é o próprio preço de entrada — que é o que a idempotência
      // exige.
      const groupLowPrice = bucketPrice * fatorPreco;
      const groupHighPrice = Math.min(groupLowPrice + fatorPreco - 1, priceAxisLength - 1);
      const lowPrice = prices[groupLowPrice] ?? Number.NaN;
      const highPrice = prices[groupHighPrice] ?? Number.NaN;

      slotByKey.set(key, keys.length);
      keys.push(key);
      accTsMs.push(times[groupLowTime] ?? Number.NaN);
      accPreco.push((lowPrice + highPrice) / 2);
      accBid.push(valueBid);
      accAsk.push(valueAsk);
      accBuy.push(valueBuy);
      accSell.push(valueSell);
    } else {
      // INVARIANTE DO LAÇO: todo grupo já criado guarda o MÁXIMO das duas filas
      // e a SOMA das duas execuções dos membros inseridos até aqui. Vale na
      // criação (um membro: máximo e soma coincidem com o próprio valor) e é
      // conservado por estas quatro atualizações.
      //
      // O `?? 0` das leituras é inalcançável — `slot` veio do mapa e as sete
      // colunas crescem em passo travado —, e existe só para satisfazer a
      // verificação de índice do compilador.
      const currentBid = accBid[slot] ?? 0;
      if (valueBid > currentBid) accBid[slot] = valueBid;
      const currentAsk = accAsk[slot] ?? 0;
      if (valueAsk > currentAsk) accAsk[slot] = valueAsk;
      accBuy[slot] = (accBuy[slot] ?? 0) + valueBuy;
      accSell[slot] = (accSell[slot] ?? 0) + valueSell;
    }
  }

  const count = keys.length;

  // Ordena por permutação de slots. As chaves são únicas, então a ordem é total
  // e o resultado não depende de a ordenação ser estável — nem da ordem de
  // inserção no mapa.
  const order: number[] = new Array<number>(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  order.sort((a, b) => (keys[a] ?? 0) - (keys[b] ?? 0));

  const outTsMs = new Float64Array(count);
  const outPreco = new Float64Array(count);
  const outBid = new Float32Array(count);
  const outAsk = new Float32Array(count);
  const outBuy = new Float32Array(count);
  const outSell = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const slot = order[i] ?? 0;
    outTsMs[i] = accTsMs[slot] ?? Number.NaN;
    outPreco[i] = accPreco[slot] ?? Number.NaN;
    outBid[i] = accBid[slot] ?? 0;
    outAsk[i] = accAsk[slot] ?? 0;
    outBuy[i] = accBuy[slot] ?? 0;
    outSell[i] = accSell[slot] ?? 0;
  }

  return {
    count,
    fatorTempo,
    fatorPreco,
    tsMs: outTsMs,
    preco: outPreco,
    bid: outBid,
    ask: outAsk,
    buy: outBuy,
    sell: outSell,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// API pública
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Agrega o grid para a janela visível, com desfecho explícito.
 *
 * ── ALGORITMO ─────────────────────────────────────────────────────────────
 *
 * 1. Normaliza o orçamento e a dimensão mínima por eixo.
 * 2. Janela degenerada ⇒ zero células, sem lançar.
 * 3. Deriva o fator de cada eixo a partir dos pixels por unidade.
 * 4. Acumula em grupos: fila por `max`, execução por `sum`.
 * 5. Estourou o orçamento ⇒ dobra as duas dimensões mínimas e repete, até doze
 *    vezes. Esgotadas, zero células e `budgetExhausted`.
 *
 * A repetição substitui a recursão do projeto por laço com cota explícita, por
 * dois motivos. Reentrar pela função pública restringiria a dimensão dobrada ao
 * intervalo admitido outra vez e, ao alcançar o topo do intervalo, a duplicação
 * pararia de progredir — a garantia de repetição ficaria vazia justamente no
 * caso que ela existe para cobrir. E a cota de doze fica auditável num só
 * lugar, em vez de espalhada pela profundidade da pilha. O comportamento
 * observável é o descrito no projeto: mesma dobra, mesmo teto, mesma ausência
 * de descarte por ordenação.
 *
 * A terminação é garantida: as dimensões mínimas crescem, os fatores são
 * monótonos não-decrescentes nelas e têm teto no comprimento do eixo. No teto,
 * o eixo inteiro colapsa num grupo, e um grupo cabe em qualquer orçamento maior
 * ou igual a 1.
 */
export function aggregateForZoomWithOutcome(
  grid: BookmapGrid,
  window: VisibleWindow,
  budget: { maxCells: number; minCellPx: number },
): AggregationOutcome {
  const resolved = resolveBudget(budget);

  if (!isUsableWindow(window)) {
    // Nenhum agrupamento foi tentado — fatores unitários descrevem isso, e a
    // saída vazia não é evento a registrar.
    return { cells: emptyCells(1, 1), budgetExhausted: false, repetitions: 0 };
  }

  const bounds: WindowBounds = {
    tsDe: window.tsDe,
    tsAte: window.tsAte,
    precoDe: window.precoDe,
    precoAte: window.precoAte,
  };

  const widthPx = window.larguraPx;
  const heightPx = window.alturaPx;
  const visibleBuckets = window.baldesVisiveis;
  const visibleTicks = window.ticksVisiveis;

  let minWidthPx = resolved.minWidthPx;
  let minHeightPx = resolved.minHeightPx;
  let fatorTempo = 1;
  let fatorPreco = 1;

  // `repetition === 0` é a primeira tentativa, com a dimensão configurada; de 1
  // a 12 são as repetições admitidas, cada uma com a dimensão dobrada.
  for (let repetition = 0; repetition <= MAX_REPETITIONS; repetition += 1) {
    fatorTempo = groupingFactorFor(widthPx, visibleBuckets, minWidthPx, grid.times.length);
    fatorPreco = groupingFactorFor(heightPx, visibleTicks, minHeightPx, grid.prices.length);

    const attempt = attemptGrouping(grid, bounds, fatorTempo, fatorPreco, resolved.maxCells);
    if (attempt !== null) {
      return { cells: attempt, budgetExhausted: false, repetitions: repetition };
    }

    minWidthPx *= 2;
    minHeightPx *= 2;
  }

  // Doze repetições e o orçamento segue estourado. Entrega zero células com os
  // fatores da última tentativa — descrição honesta do que foi tentado — e
  // sinaliza o evento para que a camada com escopo de sessão o registre.
  return {
    cells: emptyCells(fatorTempo, fatorPreco),
    budgetExhausted: true,
    repetitions: MAX_REPETITIONS,
  };
}

/**
 * Agrega o grid para a janela visível.
 *
 * ── PÓS-CONDIÇÕES ─────────────────────────────────────────────────────────
 *
 * - `count <= budget.maxCells`, restringido a `[1, 20.000]` e com padrão 3.000
 *   quando o orçamento recebido não for inteiro finito.
 * - Fila combinada por `max`: `max(agregado) === max(original ∩ janela)`, em
 *   cada lado separadamente.
 * - Execução combinada por `sum`, conservada dentro da janela, em cada lado
 *   separadamente — a menos do arredondamento de precisão simples do
 *   armazenamento de saída.
 * - `fatorTempo === 1 && fatorPreco === 1` ⇒ saída equivalente ao recorte
 *   simples da entrada pela janela.
 * - Saída ordenada por instante crescente e, no empate, por preço crescente.
 * - Determinística. Nunca lança.
 *
 * ⚠️ Célula cujos quatro valores sejam zero **não** é descartada: com fatores
 * unitários a saída tem uma célula por par existente na janela, e filtrar
 * zeros quebraria essa equivalência. Ausência de célula já significa zero.
 *
 * ⚠️ Para registrar o esgotamento de orçamento uma única vez por sessão, use
 * `aggregateForZoomWithOutcome` — esta função descarta o desfecho de propósito,
 * para manter a assinatura fixada pelo projeto.
 */
export function aggregateForZoom(
  grid: BookmapGrid,
  window: VisibleWindow,
  budget: { maxCells: number; minCellPx: number },
): AggregatedCells {
  return aggregateForZoomWithOutcome(grid, window, budget).cells;
}
