/**
 * `cellToPixels` — mapeamento célula agregada → retângulo em pixels, spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Núcleo **puro**: função total, determinística e sem estado de módulo. Sem DOM,
 * sem objeto global de janela, sem relógio, sem sorteio, sem I/O. O único import
 * é de tipos (`bookmap-types`), que por sua vez não importa nada — logo não há
 * fechamento transitivo por onde alcançar qualquer camada de conexão, de feed,
 * de execução de ordem ou de estado de conta, e não há endereço de rede,
 * credencial nem identificador de conta neste arquivo.
 *
 * Todo insumo chega por parâmetro. Nada é lido de ambiente.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE AS ESCALAS SÃO RECEBIDAS, E NÃO DERIVADAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `coords.priceToY` e `coords.timeToX` são as funções de coordenada do PRÓPRIO
 * gráfico, embrulhadas e passadas por parâmetro. Nunca reimplementadas.
 *
 * A escala do gráfico depende de zoom, de pan, de margens e do modo de preço
 * (linear ou logarítmico). Derivá-la à mão a partir dos limites da janela
 * produziria um mapeamento que **sai de sincronia com as velas exatamente
 * durante o arrasto** — o heatmap desenharia liquidez no preço errado, que é
 * pior que não desenhar. Reusar as funções nativas é o que garante que a célula
 * de um preço fique alinhada à vela daquele preço em qualquer estado da
 * viewport.
 *
 * Consequência aceita: `null` é resposta legítima e frequente dessas funções,
 * significando "fora da escala visível". Isso não é erro — é a via normal de
 * descartar célula invisível.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O ARREDONDAMENTO NO FIM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Coordenada fracionária faz o canvas antialiasar a borda do retângulo. Com
 * ~3.000 retângulos por passada, o resultado de bordas antialiasadas é névoa
 * cinza uniforme em vez de faixas nítidas de liquidez. Arredondar é o que dá o
 * acabamento — não é micro-otimização, é a diferença entre a camada informar e a
 * camada sujar a tela.
 *
 * ⚠️ **`NaN` em `fillRect` não lança — simplesmente não desenha, em silêncio.**
 * Por isso toda saída desta função é validada como finita antes de existir: o
 * caminho de erro é `null` explícito, nunca coordenada não finita. Uma célula
 * omitida é visível na contagem; uma célula com `NaN` desaparece sem rastro.
 */

import type { AggregatedCell, CoordinateFns, DrawCell } from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Piso de dimensão, em pixels.
 *
 * Célula sub-pixel ainda precisa existir visualmente: sem o piso, a parede fina
 * — que é justamente a que interessa quando o preço se aproxima dela —
 * desapareceria ao afastar o zoom.
 */
const MIN_CELL_PX = 1;

/** Menor bucket de cor admitido por `DrawCell.bucket`. */
const BUCKET_MIN = 0;

/** Maior bucket de cor admitido por `DrawCell.bucket` (16 níveis: `0..15`). */
const BUCKET_MAX = 15;

// ═════════════════════════════════════════════════════════════════════════════
// Tipos de entrada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Geometria da passada de desenho — a forma exata do parâmetro `geom` do design.
 *
 * Nomeada em vez de inline para que o primitive (tarefa 6.1) possa declarar a
 * variável uma vez por passada e reusá-la nas ~3.000 chamadas, sem repetir o
 * literal de tipo. Estruturalmente idêntica ao design, então todo ponto de
 * chamada escrito contra a assinatura original continua válido.
 *
 * - `baldeSeg` × `fatorTempo` = duração coberta pela célula, em segundos. É a
 *   LARGURA do retângulo, porque `AggregatedCell.tsMs` é a borda esquerda do
 *   grupo de baldes.
 * - `tickSize` × `fatorPreco` = faixa de preço coberta pela célula. É a ALTURA,
 *   centrada em `AggregatedCell.preco` — que é o centro do grupo de ticks, não
 *   uma de suas bordas.
 * - `widthPx` / `heightPx` = dimensões úteis do viewport, em pixels lógicos.
 */
export interface CellGeometry {
  /** Duração de um balde, em segundos. */
  readonly baldeSeg: number;
  /** Baldes agrupados por célula. `1` = sem agrupamento no tempo. */
  readonly fatorTempo: number;
  /** Incremento mínimo de preço do ativo. */
  readonly tickSize: number;
  /** Ticks agrupados por célula. `1` = sem agrupamento no preço. */
  readonly fatorPreco: number;
  /** Largura útil do viewport, em pixels lógicos. */
  readonly widthPx: number;
  /** Altura útil do viewport, em pixels lógicos. */
  readonly heightPx: number;
}

/**
 * Os campos de COR de `DrawCell`, já decididos pela escala.
 *
 * ── POR QUE ISTO ENTRA POR PARÂMETRO ──────────────────────────────────────
 *
 * `DrawCell` carrega `bucket`, `side` e `aboveScale`, e os três dependem da
 * escala de cor — `bucket` é a quantização do alpha em 16 níveis, `aboveScale`
 * é a comparação da quantidade contra o `p99` da janela visível. Nenhum dos três
 * é derivável da geometria.
 *
 * Havia três caminhos possíveis e este arquivo escolhe o terceiro:
 *
 * 1. **Importar o módulo de cor** e calcular aqui. Rejeitado: acopla o
 *    mapeamento de pixel à escala de cor e cria dois lugares que decidem cor,
 *    que é exatamente a duplicação a evitar. Também tornaria esta função
 *    dependente de percentis da janela, que ela não precisa conhecer.
 * 2. **Devolver só a geometria** e deixar o chamador compor o `DrawCell`.
 *    Rejeitado por mudar o tipo de retorno fixado no design (`DrawCell | null`)
 *    e por empurrar para o laço de desenho a montagem de objeto — alocação por
 *    célula no caminho quente, que é o que a escolha por arrays tipados existe
 *    para evitar.
 * 3. **Receber os três campos já decididos**, como parâmetro OPCIONAL. É o que
 *    está implementado. A lógica de cor permanece inteira e única no módulo de
 *    escala; aqui os valores só são repassados. A função segue determinística —
 *    saída é função exclusiva das entradas — e segue chamável com os três
 *    argumentos do design, o que mantem a assinatura original válida e permite
 *    exercitar a geometria em teste sem construir escala nenhuma.
 *
 * Declarado por `Pick` sobre `DrawCell` de propósito: se o tipo canônico mudar,
 * este acompanha por construção, sem chance de divergir em silêncio.
 */
export type DrawCellPaint = Pick<DrawCell, 'bucket' | 'side' | 'aboveScale'>;

/**
 * Cor adotada quando o chamador não informa nenhuma.
 *
 * `bucket: BUCKET_MIN` é escolha na direção segura: quem esquecer de passar a
 * cor obtém a célula mais fraca da escala, que subestima a liquidez em vez de
 * anunciar uma parede que ninguém mediu. Errar para menos é recuperável; pintar
 * volume inexistente com intensidade máxima leva o operador a confiar num
 * suporte que não existe.
 */
const PAINT_PADRAO: DrawCellPaint = { bucket: BUCKET_MIN, side: 'BID', aboveScale: false };

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares puros
// ═════════════════════════════════════════════════════════════════════════════

/** Verdadeiro só para número finito — descarta `NaN`, `Infinity` e não-número. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Restringe `value` a `[lo, hi]`.
 *
 * Pré-condição do chamador: `lo <= hi`. A ordem `max(lo, min(hi, v))` também
 * normaliza `-0` para `+0` sempre que `lo` for `0`, o que mantém a saída
 * estruturalmente comparável — `-0` e `0` são valores distintos para o
 * comparador de igualdade profunda usado pela property test de determinismo.
 */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Normaliza os campos de cor, tornando-os totais.
 *
 * ⚠️ Não calcula cor: apenas confina `bucket` ao domínio `0..15` que o próprio
 * `DrawCell` declara, e resolve `side` para um dos dois valores admitidos. Não
 * há limiar, percentil nem opacidade aqui — a decisão de cor continua inteira no
 * módulo de escala.
 *
 * O confinamento existe porque o laço de desenho indexa a paleta por `bucket`:
 * um índice fracionário, negativo ou não finito selecionaria estilo inexistente
 * e a célula não apareceria — a mesma falha silenciosa do `NaN` em coordenada.
 */
function normalizePaint(paint?: DrawCellPaint | null): DrawCellPaint {
  if (paint === null || paint === undefined) return PAINT_PADRAO;

  const bucket = isFiniteNumber(paint.bucket)
    ? clamp(Math.round(paint.bucket), BUCKET_MIN, BUCKET_MAX)
    : BUCKET_MIN;

  return {
    bucket,
    side: paint.side === 'ASK' ? 'ASK' : 'BID',
    aboveScale: paint.aboveScale === true,
  };
}

/**
 * Recorta um eixo ao viewport, devolvendo posição e tamanho inteiros.
 *
 * Entrada em pixels fracionários (`inicio`, `tamanho`) e o limite do eixo
 * (`limitePx`). Saída inteira satisfazendo, simultaneamente:
 *
 *     0 <= inicio            tamanho >= MIN_CELL_PX            inicio + tamanho <= limitePx
 *
 * ── A TENSÃO ENTRE O PISO DE 1 PX E O RECORTE ─────────────────────────────
 *
 * As duas pós-condições do design colidem numa borda: uma célula cuja borda
 * esquerda cai exatamente no limite direito do viewport teria, pelo piso,
 * `inicio + tamanho = limite + 1` — ou seja, 1 px fora. Três desfechos eram
 * possíveis: descartar a célula, desenhar 1 px fora, ou deslocar a célula para
 * dentro. Adotado o terceiro: a célula é empurrada até caber, deslocando-se no
 * máximo 1 px. Descartar perderia célula genuinamente visível; desenhar fora
 * violaria o recorte.
 *
 * ── POR QUE O LIMITE É PISADO PARA INTEIRO ────────────────────────────────
 *
 * `limitePx` pode ser fracionário (a razão de bitmap do dispositivo produz
 * larguras como `799,5`). Pisar para inteiro dá o último pixel inteiramente
 * contido no viewport, então `inicio + tamanho <= floor(limitePx) <= limitePx` —
 * o recorte fica conservador por construção, e todo o cálculo se passa na grade
 * inteira em que o canvas desenha de fato.
 *
 * A ordem das operações importa: **arredondar as bordas e derivar o tamanho
 * delas**, nunca arredondar posição e tamanho de forma independente. Com
 * `limite = 10`, `inicio = 8,5` e `tamanho = 1,5`, arredondar cada um daria
 * `9 + 2 = 11` e estouraria o limite mesmo tendo `8,5 + 1,5 = 10` antes do
 * arredondamento.
 *
 * @returns Par recortado, ou `null` se o eixo não admitir célula alguma.
 */
function clipAxis(
  inicio: number,
  tamanho: number,
  limitePx: number,
): { readonly inicio: number; readonly tamanho: number } | null {
  const limite = Math.floor(limitePx);

  // Guarda redundante — o chamador já exige `limitePx >= MIN_CELL_PX`, e o piso
  // de um valor `>= 1` é `>= 1`. Mantida para a função ser total por si só.
  if (!isFiniteNumber(limite) || limite < MIN_CELL_PX) return null;

  const fim = inicio + tamanho;
  if (!isFiniteNumber(fim)) return null;

  // Bordas recortadas ao viewport, ainda fracionárias.
  const bordaInicial = clamp(inicio, 0, limite);
  const bordaFinal = clamp(fim, 0, limite);

  // Arredonda as bordas e deriva o tamanho a partir delas.
  const inicioArredondado = Math.round(bordaInicial);
  const tamanhoPx = clamp(
    Math.max(MIN_CELL_PX, Math.round(bordaFinal) - inicioArredondado),
    MIN_CELL_PX,
    limite,
  );

  // `limite - tamanhoPx >= 0` porque `tamanhoPx <= limite`, então o intervalo do
  // clamp é válido e o resultado nunca é negativo.
  const inicioPx = clamp(inicioArredondado, 0, limite - tamanhoPx);

  return { inicio: inicioPx, tamanho: tamanhoPx };
}

// ═════════════════════════════════════════════════════════════════════════════
// A função
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Converte uma célula agregada no retângulo em pixels que o canvas desenha.
 *
 * ── PÓS-CONDIÇÕES (requisitos 1.8, 3.6, 3.7) ──────────────────────────────
 *
 * Quando devolve `DrawCell`:
 * - `x`, `y`, `w`, `h` são inteiros finitos;
 * - `w >= 1` e `h >= 1`;
 * - `0 <= x`, `x + w <= geom.widthPx`, `0 <= y`, `y + h <= geom.heightPx`;
 * - `bucket` é inteiro em `0..15` e `side` é `'BID'` ou `'ASK'`.
 *
 * Quando devolve `null`:
 * - qualquer conversão de coordenada resultou em ausência de valor ou em valor
 *   não finito;
 * - o retângulo não intersecta o viewport;
 * - a geometria ou a célula trazem valor não finito, ou o viewport não admite
 *   uma célula de 1 px.
 *
 * ⚠️ `null` omite **exclusivamente** a célula afetada. Nunca lança, então a
 * passada de desenho prossegue com as demais células da janela — uma célula fora
 * da escala não pode custar o restante do heatmap.
 *
 * **Determinística e sem estado**: a mesma tripla de entradas produz a mesma
 * saída, incluindo o caso `null` (Property 1). Não lê relógio, objeto global de
 * janela nem DOM.
 *
 * @param cell   Célula agregada. `tsMs` é a borda ESQUERDA do grupo de baldes;
 *               `preco` é o CENTRO do grupo de ticks.
 * @param coords Funções de coordenada do próprio gráfico. `timeToX` recebe
 *               SEGUNDOS epoch.
 * @param geom   Geometria da passada.
 * @param paint  Campos de cor já decididos pela escala. Omitido, adota a célula
 *               mais fraca — ver `DrawCellPaint`.
 */
export function cellToPixels(
  cell: AggregatedCell,
  coords: CoordinateFns,
  geom: CellGeometry,
  paint?: DrawCellPaint | null,
): DrawCell | null {
  if (cell === null || cell === undefined) return null;
  if (coords === null || coords === undefined) return null;
  if (geom === null || geom === undefined) return null;
  if (typeof coords.timeToX !== 'function' || typeof coords.priceToY !== 'function') return null;

  const { widthPx, heightPx } = geom;
  if (!isFiniteNumber(widthPx) || !isFiniteNumber(heightPx)) return null;

  // Viewport que não caiba uma célula de 1 px não admite desenho algum: o piso
  // de 1 px e o recorte ao viewport seriam contraditórios. Omitir é a única
  // resposta coerente com as duas pós-condições.
  if (widthPx < MIN_CELL_PX || heightPx < MIN_CELL_PX) return null;

  if (!isFiniteNumber(cell.tsMs) || !isFiniteNumber(cell.preco)) return null;
  if (!isFiniteNumber(geom.baldeSeg) || !isFiniteNumber(geom.fatorTempo)) return null;
  if (!isFiniteNumber(geom.tickSize) || !isFiniteNumber(geom.fatorPreco)) return null;

  // ── eixo horizontal: da borda esquerda do balde à borda do balde seguinte ──
  //
  // ⚠️ `tsMs` está em MILISSEGUNDOS e `timeToX` recebe SEGUNDOS — é a convenção
  // da biblioteca de gráfico. A divisão é responsabilidade desta função; omiti-la
  // desenharia o heatmap a três décadas de distância, ou fora da tela, sem
  // qualquer sinal de erro.
  const tIni = cell.tsMs / 1000;
  const tFim = tIni + geom.baldeSeg * geom.fatorTempo;
  if (!isFiniteNumber(tIni) || !isFiniteNumber(tFim)) return null;

  const x1 = coords.timeToX(tIni);
  const x2 = coords.timeToX(tFim);
  // `null` significa "fora da escala visível" — resposta legítima, não erro.
  // A checagem de finitude cobre a função que devolve `NaN` em vez de `null`.
  if (x1 === null || x1 === undefined || x2 === null || x2 === undefined) return null;
  if (!isFiniteNumber(x1) || !isFiniteNumber(x2)) return null;

  // ── eixo vertical: o retângulo cobre o grupo de ticks, não uma linha ──
  //
  // `preco` é o CENTRO do grupo, então as bordas ficam a meia altura de
  // distância para cada lado.
  const meiaAltura = (geom.tickSize * geom.fatorPreco) / 2;
  const precoTopo = cell.preco + meiaAltura;
  const precoBase = cell.preco - meiaAltura;
  if (!isFiniteNumber(precoTopo) || !isFiniteNumber(precoBase)) return null;

  const yTopo = coords.priceToY(precoTopo);
  const yBase = coords.priceToY(precoBase);
  if (yTopo === null || yTopo === undefined || yBase === null || yBase === undefined) return null;
  if (!isFiniteNumber(yTopo) || !isFiniteNumber(yBase)) return null;

  // ── retângulo sem recorte ──
  //
  // `min`/`max` em vez de assumir ordem: o eixo vertical do canvas cresce para
  // baixo, então preço maior dá coordenada menor. Isso também absorve fator de
  // agrupamento ou `tickSize` de sinal invertido sem produzir dimensão negativa.
  const x = Math.min(x1, x2);
  const w = Math.max(MIN_CELL_PX, Math.abs(x2 - x1));
  const y = Math.min(yTopo, yBase);
  const h = Math.max(MIN_CELL_PX, Math.abs(yBase - yTopo));

  // ── interseção com o viewport ──
  if (x > widthPx || x + w < 0) return null;
  if (y > heightPx || y + h < 0) return null;

  const horizontal = clipAxis(x, w, widthPx);
  const vertical = clipAxis(y, h, heightPx);
  if (horizontal === null || vertical === null) return null;

  return {
    x: horizontal.inicio,
    y: vertical.inicio,
    w: horizontal.tamanho,
    h: vertical.tamanho,
    ...normalizePaint(paint),
  };
}
