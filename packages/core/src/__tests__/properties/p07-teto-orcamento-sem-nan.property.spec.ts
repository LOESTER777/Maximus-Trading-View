/**
 * Property 7 — Teto de orçamento e ausência de `NaN`. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.7.
 *
 * ```
 * ∀ grid, window, budget:
 *     aggregateForZoom(...).count ≤ orçamentoEfetivo(budget)
 * ∀ DrawCell d produzida:
 *     finito(d.x) ∧ finito(d.y) ∧ d.w ≥ 1 ∧ d.h ≥ 1
 *     ∧ 0 ≤ d.x ∧ d.x + d.w ≤ widthPx
 *     ∧ 0 ≤ d.y ∧ d.y + d.h ≤ heightPx
 * ```
 *
 * **Validates: Requirements 3.1, 3.6**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Duas garantias, e cada uma protege contra um modo de falha diferente.
 *
 * **O teto** é o que sustenta o orçamento de frame. Um pregão inteiro em baldes
 * de 60 s dá 25.823 células; desenhar todas custa mais que o quadro dispõe, e o
 * gráfico passa a engasgar durante o arrasto — justamente quando o operador está
 * procurando o nível. O teto não é otimização: é a diferença entre a camada
 * informar e a camada atrapalhar.
 *
 * **A ausência de indefinição** protege contra algo pior que lentidão.
 *
 * ⚠️ `fillRect` com coordenada indefinida **não lança**: simplesmente não
 * desenha, em silêncio. Uma parede de 2.442 ct cuja coordenada saísse indefinida
 * desapareceria da tela sem exceção, sem aviso no console e sem entrada de log —
 * o operador leria ausência de liquidez onde havia a maior oferta em repouso da
 * janela. É a falha mais perigosa desta camada inteira, porque a tela continua
 * parecendo correta.
 *
 * Por isso a proibição é **explícita e universal**: vale para todo campo
 * numérico de toda `DrawCell` produzida, em todo caminho de entrada, inclusive
 * quando a entrada é hostil. O caminho de erro admitido é `null` — célula
 * omitida, que é contável — nunca coordenada indefinida, que é invisível.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO O ENUNCIADO FOI TORNADO PRECISO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O texto curto diz `count ≤ budget.maxCells`. Tomado ao pé da letra ele é
 * **falso**, e o motivo está no próprio requisito 3.1, não é conveniência para o
 * teste passar: o orçamento recebido é **normalizado** antes de valer.
 *
 * - Não sendo inteiro finito, adota-se o padrão de **3.000** — então
 *   `maxCells: NaN` admite 3.000 células, não zero.
 * - Sendo inteiro finito, é restringido a **`[1, 20.000]`** — então
 *   `maxCells: 0` admite uma célula, e `maxCells: 999.999` admite 20.000.
 *
 * A referência `orcamentoEfetivo` implementa essa normalização **a partir do
 * texto do critério 3.1**, não copiando a implementação. É o que a mantém um
 * juiz independente: se as duas leituras do requisito divergirem, o teste
 * falha — que é exatamente o que se quer de um teste.
 *
 * ⚠️ O caso `maxCells: 1.5` merece nota: o critério manda **cair no padrão**, não
 * arredondar. Orçamento fracionário indica cálculo errado a montante, e adivinhar
 * a intenção esconderia o defeito. Então `1.5` admite 3.000, e não 1 nem 2.
 *
 * Para a segunda garantia não há ressalva alguma. Nenhuma entrada, por hostil que
 * seja, autoriza uma `DrawCell` com campo indefinido: ou a célula sai íntegra e
 * dentro do viewport, ou não sai.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O PIPELINE COMPLETO, E NÃO CADA FUNÇÃO ISOLADA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As asserções percorrem `aggregateForZoom` **e depois** `cellToPixels` sobre a
 * saída dela. Testar só a segunda com células sintéticas deixaria de fora a
 * composição — e é na composição que a indefinição costuma nascer, porque a
 * agregação produz coordenada de grupo por aritmética (`(low + high) / 2` no
 * preço, leitura de eixo no tempo) e é essa coordenada derivada que alimenta o
 * mapeamento de pixel.
 *
 * Os fatores de agrupamento entregues pela agregação também entram na geometria
 * da passada (`fatorTempo` e `fatorPreco`), então usá-los como o desenho real os
 * usa é o que fecha o circuito. Um fator indefinido não seria detectado por
 * nenhum dos dois lados isoladamente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de
 * render e a biblioteca de teste. Aquele módulo é só reexportação, e o fechamento
 * transitivo dos irmãos que ele reexporta alcança um único utilitário de
 * formatação de horário — que não importa nada. Logo não existe caminho daqui até
 * camada de roteamento de conexão, feed de cotação, envio de ordem ou estado de
 * posição, e nada aqui carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Todo insumo é sintetizado pelos geradores, em memória. Nada é lido de rede, de
 * banco ou do sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma
 * escrita acontece em nenhuma tabela, nenhum evento de decisão é emitido e
 * nenhuma chave de configuração é alterada.
 *
 * Sem DOM, sem relógio, sem sorteio próprio: as funções de coordenada são
 * sintetizadas e determinísticas, e a única fonte de variação é o gerador com
 * semente fixa.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a verificação de
 * independência inspeciona **integralmente** todo arquivo criado por esta
 * feature, teste incluído, e uma citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COBERTURA AFERIDA DOS GERADORES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medida em 500 casos com semente 42 e **verificada por asserção** ao fim do
 * arquivo — não só anotada aqui. O motivo é o mesmo que vale para as
 * propriedades irmãs: um gerador que deixa de exercitar o caminho protegido não
 * faz o teste falhar, faz o teste virar tautologia e continuar verde.
 *
 * O caso crítico é o **estouro de orçamento**: se nenhum caso gerar mais grupos
 * brutos que o teto, a repetição por duplicação da dimensão mínima nunca roda e o
 * teto nunca é exercitado — a desigualdade `count ≤ teto` passaria por folga, não
 * por mérito. Há duas asserções distintas para isso, porque são dois caminhos
 * diferentes: **estouro resolvido** pela duplicação (a recursão de fato correu e
 * o resultado couber) e **estouro esgotado** (doze repetições sem caber, entrega
 * vazia).
 *
 * | O que foi medido                                  | em 500 | fração |
 * |---------------------------------------------------|--------|--------|
 * | grupos brutos acima do teto (o orçamento aperta)  | 145    | 29,0%  |
 * | **estouro resolvido pela duplicação**             | **89** | 17,8%  |
 * | **estouro esgotado nas doze repetições**          | **33** |  6,6%  |
 * | teto normalizado no piso de 1                     | 105    | 21,0%  |
 * | teto normalizado no topo de 20.000                |  52    | 10,4%  |
 * | teto caído no padrão de 3.000                     | 157    | 31,4%  |
 *
 * E, sobre os dois geradores de cenário somados (1.000 casos):
 *
 * | O que foi medido                                  | em 1.000 | fração |
 * |---------------------------------------------------|----------|--------|
 * | casos com ao menos uma célula desenhada           | 576      | 57,6%  |
 * | casos com ao menos uma célula omitida             | 208      | 20,8%  |
 * | **retângulos de fato conferidos**                 | **8.511**| —      |
 * | limite de viewport fracionário (razão de bitmap)  | 230      | 23,0%  |
 * | `bucket` fora do domínio `0..15`                  | 398      | 39,8%  |
 * | valor de entrada que o critério 3.10 zera         | 952      | 95,2%  |
 *
 * A linha dos 8.511 retângulos é a medida direta de não-vacuidade da garantia de
 * finitude: é o número de `DrawCell` que passaram pelas asserções, e não o número
 * de casos que rodaram.
 *
 * ⚠️ **Os dois geradores são medidos, não um só.** A propriedade central de
 * finitude roda sobre `arbCenario`; a de totalidade, sobre `arbCenarioQualquer`.
 * A primeira versão desta guarda media apenas o segundo, e por isso registrava
 * 24,2% de casos com desenho — número que descrevia o gerador errado e teria
 * escondido um colapso do gerador que a propriedade central usa.
 *
 * ── VERIFICADO POR MUTAÇÃO ────────────────────────────────────────────────
 *
 * Para confirmar que as asserções têm força, as três checagens de finitude de
 * coordenada de `cellToPixels` foram removidas em cópia temporária e a suíte
 * reprovou com contraexemplo mínimo na variante de coordenada indefinida —
 * `larguraPx: 800`, `alturaPx: 400`, um balde, três preços — falhando exatamente
 * em `Number.isFinite(d.x)`. A implementação foi restaurada byte a byte em
 * seguida, conferida por resumo criptográfico.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  aggregateForZoom,
  aggregateForZoomWithOutcome,
  cellToPixels,
} from '@robustus/charts-core';
import type {
  AggregatedCell,
  AggregatedCells,
  BookmapGrid,
  CellGeometry,
  CoordinateFns,
  DrawCell,
  DrawCellPaint,
  VisibleWindow,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso acontece aqui: este
 * projeto já errou conversão em ±3 h somando deslocamento à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** O único tamanho de balde materializado. */
const BALDE_MS = 60_000;
const BALDE_SEG = BALDE_MS / 1_000;

/** Base do eixo de preço e o incremento mínimo do ativo de referência. */
const PRECO_BASE = 176_000;
const PRECO_PASSO = 5;

/** Orçamento adotado quando o recebido não é inteiro finito (critério 3.1). */
const ORCAMENTO_PADRAO = 3_000;

/** Intervalo admitido para o orçamento (critério 3.1). */
const ORCAMENTO_MIN = 1;
const ORCAMENTO_MAX = 20_000;

/** Piso de dimensão de célula desenhada, em pixels (critério 3.6). */
const MIN_CELL_PX = 1;

/** Domínio de `DrawCell.bucket`: 16 níveis de cor. */
const BUCKET_MIN = 0;
const BUCKET_MAX = 15;

/**
 * A parede real medida dentro da banda de ±2.000 pts do miolo.
 *
 * Aparece nos geradores porque é a magnitude cuja perda seria mais danosa: é a
 * maior oferta em repouso que de fato existiu onde o operador olha.
 */
const PAREDE_CT = 2_442;

// ═════════════════════════════════════════════════════════════════════════════
// Construção de grid sintético
// ═════════════════════════════════════════════════════════════════════════════

/** Uma célula candidata, antes de virar coluna. */
interface CelulaSintetica {
  readonly ti: number;
  readonly pi: number;
  readonly bid: number;
  readonly ask: number;
  readonly buy: number;
  readonly sell: number;
}

/**
 * Monta um `BookmapGrid` válido a partir dos tamanhos de eixo e das células.
 *
 * Os eixos são estritamente crescentes por construção, como o decodificador
 * garante em produção.
 *
 * O eixo de tempo é de precisão dupla por necessidade, não por gosto: epoch ms na
 * ordem de 1,79 × 10¹² não cabe na mantissa de 24 bits de um número de precisão
 * simples, e o instante seria arredondado para múltiplos de ~131 s — células de
 * baldes distintos colidiriam no mesmo grupo e a contagem de grupos medida aqui
 * deixaria de ser a contagem real.
 */
function construirGrid(
  nBaldes: number,
  nPrecos: number,
  celulas: readonly CelulaSintetica[],
): BookmapGrid {
  const times = new Float64Array(nBaldes);
  for (let i = 0; i < nBaldes; i += 1) times[i] = ABERTURA_MS + i * BALDE_MS;

  const prices = new Float64Array(nPrecos);
  for (let j = 0; j < nPrecos; j += 1) prices[j] = PRECO_BASE + j * PRECO_PASSO;

  const n = celulas.length;
  const ti = new Uint32Array(n);
  const pi = new Uint32Array(n);
  const bid = new Float32Array(n);
  const ask = new Float32Array(n);
  const buy = new Float32Array(n);
  const sell = new Float32Array(n);

  for (let k = 0; k < n; k += 1) {
    const celula = celulas[k];
    if (celula === undefined) continue;
    ti[k] = celula.ti;
    pi[k] = celula.pi;
    bid[k] = celula.bid;
    ask[k] = celula.ask;
    buy[k] = celula.buy;
    sell[k] = celula.sell;
  }

  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-28',
    baldeSeg: BALDE_SEG,
    times,
    prices,
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    cobertura: null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A referência — os critérios escritos a partir do texto, não da implementação
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Critério 3.1 na forma executável: qual teto de fato vale.
 *
 * Escrito a partir do requisito, não copiado do núcleo — é o que o mantém um juiz
 * independente. Duas cláusulas, na ordem em que o critério as enuncia:
 *
 * 1. **Não inteiro finito ⇒ padrão de 3.000.** Cobre indefinição, infinito nos
 *    dois sinais e fracionário. ⚠️ Fracionário **não** é arredondado: orçamento
 *    fracionário indica cálculo errado a montante, e adivinhar a intenção
 *    esconderia o defeito.
 * 2. **Inteiro finito ⇒ restringido a `[1, 20.000]`.** Zero e negativo sobem ao
 *    piso de uma célula; valor acima do teto desce a 20.000.
 */
function orcamentoEfetivo(maxCells: number): number {
  if (!Number.isInteger(maxCells)) return ORCAMENTO_PADRAO;
  return Math.min(ORCAMENTO_MAX, Math.max(ORCAMENTO_MIN, maxCells));
}

/**
 * Critério 3.9 na forma executável: a janela é utilizável?
 *
 * `!(x > 0)` cobre zero, negativo e indefinido numa comparação só — a comparação
 * com indefinição é falsa. A checagem de finitude que vem depois recolhe o
 * infinito positivo, que passaria pela primeira.
 */
function janelaUtilizavel(visible: VisibleWindow): boolean {
  if (!(visible.larguraPx > 0) || !(visible.alturaPx > 0)) return false;
  if (!Number.isFinite(visible.larguraPx) || !Number.isFinite(visible.alturaPx)) return false;
  if (!Number.isFinite(visible.tsDe) || !Number.isFinite(visible.tsAte)) return false;
  if (!Number.isFinite(visible.precoDe) || !Number.isFinite(visible.precoAte)) return false;
  if (visible.tsDe > visible.tsAte) return false;
  if (visible.precoDe > visible.precoAte) return false;
  return true;
}

/**
 * Quantos grupos o agrupamento formaria com os fatores dados — a contagem
 * **bruta**, antes de qualquer decisão de orçamento.
 *
 * É o insumo da guarda de vacuidade: comparar esta contagem contra o teto efetivo
 * é o que diz se o caso **aperta** o orçamento. Sem ela não há como afirmar que a
 * duplicação da dimensão mínima foi exercitada — e uma desigualdade satisfeita por
 * folga não prova nada sobre o mecanismo que existe para garanti-la.
 *
 * A chave de grupo replica o encaixe do critério 3.8: piso do índice pelo fator em
 * cada eixo, e o par resultante identifica o grupo. Contar pares distintos num
 * conjunto evita depender de qualquer detalhe de indexação da implementação.
 */
function gruposBrutos(
  grid: BookmapGrid,
  visible: VisibleWindow,
  fatorTempo: number,
  fatorPreco: number,
): number {
  const comprimento = Math.min(
    grid.ti.length,
    grid.pi.length,
    grid.bid.length,
    grid.ask.length,
    grid.buy.length,
    grid.sell.length,
  );

  const chaves = new Set<string>();

  for (let k = 0; k < comprimento; k += 1) {
    const indiceTempo = grid.ti[k] ?? Number.NaN;
    const indicePreco = grid.pi[k] ?? Number.NaN;
    if (!(indiceTempo >= 0 && indiceTempo < grid.times.length)) continue;
    if (!(indicePreco >= 0 && indicePreco < grid.prices.length)) continue;

    const instante = grid.times[indiceTempo] ?? Number.NaN;
    if (!(instante >= visible.tsDe && instante <= visible.tsAte)) continue;
    const preco = grid.prices[indicePreco] ?? Number.NaN;
    if (!(preco >= visible.precoDe && preco <= visible.precoAte)) continue;

    chaves.add(`${Math.floor(indiceTempo / fatorTempo)}:${Math.floor(indicePreco / fatorPreco)}`);
  }

  return chaves.size;
}

/** Células da entrada que caem dentro da janela — o conjunto de referência. */
function celulasNaJanela(grid: BookmapGrid, visible: VisibleWindow): number {
  return gruposBrutos(grid, visible, 1, 1);
}

// ═════════════════════════════════════════════════════════════════════════════
// Funções de coordenada sintéticas
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que a biblioteca de gráfico faz — e o que ela faz de errado — reproduzido em
 * variantes determinísticas.
 *
 * ⚠️ Nenhuma delas é a escala real. Elas existem porque a função sob teste
 * **recebe** as funções de coordenada por parâmetro e não pode confiar nelas: em
 * produção quem responde é a biblioteca de terceiro, sob zoom, arrasto, margem e
 * modo de preço logarítmico. Um retorno indefinido dali é possível, então tem de
 * ser tratado — e a única forma de exercitar o tratamento é sintetizar o retorno
 * ruim aqui.
 *
 * `SEMPRE_NULO` e `SEMPRE_INDEFINIDO` cobrem a ausência declarada, que é resposta
 * legítima ("fora da escala visível"). `INDEFINIDA` cobre a variante que devolve
 * indefinição **em vez de** ausência — o caso perigoso, e o motivo desta
 * propriedade existir: sem tratamento, aquela indefinição atravessaria até
 * `fillRect` e a célula desapareceria sem rastro.
 */
type VarianteCoord =
  | 'LINEAR'
  | 'INVERTIDA'
  | 'LOG'
  | 'DEGENERADA'
  | 'FORA_DA_ESCALA'
  | 'SEMPRE_NULO'
  | 'SEMPRE_INDEFINIDO'
  | 'INDEFINIDA'
  | 'INFINITA'
  | 'GIGANTE'
  | 'PARCIAL_NULO';

/**
 * Constrói as funções de coordenada da variante escolhida.
 *
 * ⚠️ `timeToX` recebe **segundos** epoch — é a convenção da biblioteca, e a
 * conversão de milissegundos é responsabilidade da função sob teste. As escalas
 * daqui trabalham em segundos de propósito, para que um erro de fator mil na
 * conversão apareça como coordenada fora do viewport em vez de passar batido.
 *
 * Todas são puras e determinísticas: mesma entrada, mesma saída, sempre. Sem
 * relógio e sem estado — de outro modo um contraexemplo não seria reproduzível.
 */
function construirCoords(
  variante: VarianteCoord,
  tsDeSeg: number,
  tsAteSeg: number,
  precoDe: number,
  precoAte: number,
  widthPx: number,
  heightPx: number,
): CoordinateFns {
  const vaoTempo = tsAteSeg - tsDeSeg;
  const vaoPreco = precoAte - precoDe;

  // Vão nulo é caso real: janela de um balde só, ou de um tick só. Cair em 1
  // evita divisão por zero na escala sintética sem esconder nada da função sob
  // teste, que recebe a coordenada resultante como qualquer outra.
  const divTempo = vaoTempo === 0 ? 1 : vaoTempo;
  const divPreco = vaoPreco === 0 ? 1 : vaoPreco;

  switch (variante) {
    case 'LINEAR':
      return {
        timeToX: (t) => ((t - tsDeSeg) / divTempo) * widthPx,
        // Eixo vertical do canvas cresce para baixo: preço maior dá coordenada
        // menor. É a orientação real, e é o que faz a função sob teste precisar
        // de `min`/`max` em vez de assumir ordem.
        priceToY: (p) => heightPx - ((p - precoDe) / divPreco) * heightPx,
      };

    case 'INVERTIDA':
      // Orientação trocada nos dois eixos. Nenhuma dimensão pode sair negativa.
      return {
        timeToX: (t) => widthPx - ((t - tsDeSeg) / divTempo) * widthPx,
        priceToY: (p) => ((p - precoDe) / divPreco) * heightPx,
      };

    case 'LOG':
      // Modo logarítmico de preço, que a biblioteca oferece. O preço base é
      // grande e positivo, então o logaritmo é finito.
      return {
        timeToX: (t) => ((t - tsDeSeg) / divTempo) * widthPx,
        priceToY: (p) => {
          const razao = p > 0 ? Math.log(p) : 0;
          const base = precoDe > 0 ? Math.log(precoDe) : 0;
          const topo = precoAte > 0 ? Math.log(precoAte) : base + 1;
          const vao = topo - base === 0 ? 1 : topo - base;
          return heightPx - ((razao - base) / vao) * heightPx;
        },
      };

    case 'DEGENERADA':
      // Escala colapsada: tudo no mesmo ponto. Toda célula fica com dimensão
      // zero antes do piso, então é o caso que exercita o piso de 1 px junto com
      // o recorte — a borda onde as duas pós-condições do critério 3.6 colidem.
      return { timeToX: () => 0, priceToY: () => 0 };

    case 'FORA_DA_ESCALA':
      // Coordenada finita mas inteiramente fora do viewport: a célula tem de ser
      // omitida por não intersectar, e não recortada para dentro.
      return {
        timeToX: () => widthPx + 5_000,
        priceToY: () => -5_000,
      };

    case 'SEMPRE_NULO':
      // Ausência declarada — a via normal de descartar célula invisível.
      return { timeToX: () => null, priceToY: () => null };

    case 'SEMPRE_INDEFINIDO':
      // A biblioteca pode devolver ausência não declarada. O tipo diz `null`; a
      // realidade de terceiro admite ausência de valor, e o tratamento tem de
      // cobrir as duas.
      return {
        timeToX: () => undefined as unknown as number | null,
        priceToY: () => undefined as unknown as number | null,
      };

    case 'INDEFINIDA':
      // ⚠️ O caso que dá nome a esta propriedade. Coordenada indefinida vinda da
      // escala **não pode** virar `DrawCell`: se virasse, `fillRect` não
      // desenharia e a célula sumiria sem exceção e sem log.
      return { timeToX: () => Number.NaN, priceToY: () => Number.NaN };

    case 'INFINITA':
      return {
        timeToX: () => Number.POSITIVE_INFINITY,
        priceToY: () => Number.NEGATIVE_INFINITY,
      };

    case 'GIGANTE':
      // Magnitude que estoura ao ser somada: `MAX_VALUE + MAX_VALUE` é infinito.
      // Exercita a aritmética interna do recorte, não só a entrada.
      return {
        timeToX: () => Number.MAX_VALUE,
        priceToY: () => -Number.MAX_VALUE,
      };

    case 'PARCIAL_NULO':
      // Um eixo responde, o outro não. A célula tem de ser omitida por inteiro —
      // meia coordenada não desenha nada de útil.
      return {
        timeToX: (t) => ((t - tsDeSeg) / divTempo) * widthPx,
        priceToY: () => null,
      };
  }
}

/** As variantes cujas coordenadas são finitas e podem produzir célula desenhável. */
const VARIANTES_DESENHAVEIS: readonly VarianteCoord[] = [
  'LINEAR',
  'INVERTIDA',
  'LOG',
  'DEGENERADA',
];

/** Todas as variantes, inclusive as que só podem produzir omissão. */
const VARIANTES_TODAS: readonly VarianteCoord[] = [
  'LINEAR',
  'INVERTIDA',
  'LOG',
  'DEGENERADA',
  'FORA_DA_ESCALA',
  'SEMPRE_NULO',
  'SEMPRE_INDEFINIDO',
  'INDEFINIDA',
  'INFINITA',
  'GIGANTE',
  'PARCIAL_NULO',
];

// ═════════════════════════════════════════════════════════════════════════════
// O pipeline completo: agregação → pixel
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lê a célula agregada no índice `i`.
 *
 * ⚠️ **`count` é a verdade, não `length`.** As colunas podem ser alocadas com
 * capacidade maior que o preenchido, e ler além disso devolveria zeros que a tela
 * apresentaria como liquidez ausente. Todo laço deste arquivo para em `count`.
 *
 * `?? NaN` em vez de conversão de tipo: com verificação de índice ativa no
 * compilador toda leitura de coluna é opcional, e propagar a indefinição até a
 * asserção é o que se quer — não silenciá-la com zero.
 */
function celulaEm(cells: AggregatedCells, i: number): AggregatedCell {
  return {
    tsMs: cells.tsMs[i] ?? Number.NaN,
    preco: cells.preco[i] ?? Number.NaN,
    bid: cells.bid[i] ?? Number.NaN,
    ask: cells.ask[i] ?? Number.NaN,
    buy: cells.buy[i] ?? Number.NaN,
    sell: cells.sell[i] ?? Number.NaN,
  };
}

/** Resultado de uma passada de desenho simulada. */
interface Passada {
  readonly cells: AggregatedCells;
  /** As células que sairiam para `fillRect`. */
  readonly desenhadas: readonly DrawCell[];
  /** Quantas foram omitidas por ausência de coordenada ou por não intersectar. */
  readonly omitidas: number;
  readonly geom: CellGeometry;
}

/**
 * Roda o pipeline exatamente na ordem em que a camada de canvas o roda: agrega
 * para o zoom e converte cada célula entregue em retângulo.
 *
 * Os fatores usados na geometria vêm da **própria saída** da agregação, não do
 * gerador. É o que fecha o circuito: um fator indefinido produzido pelo
 * agrupamento chegaria à conversão de pixel, e nenhuma das duas funções o pegaria
 * isoladamente.
 */
function rodarPassada(
  grid: BookmapGrid,
  janela: VisibleWindow,
  orcamento: { maxCells: number; minCellPx: number },
  coords: CoordinateFns,
  widthPx: number,
  heightPx: number,
  paint?: DrawCellPaint | null,
): Passada {
  const cells = aggregateForZoom(grid, janela, orcamento);

  const geom: CellGeometry = {
    baldeSeg: grid.baldeSeg,
    fatorTempo: cells.fatorTempo,
    tickSize: PRECO_PASSO,
    fatorPreco: cells.fatorPreco,
    widthPx,
    heightPx,
  };

  const desenhadas: DrawCell[] = [];
  let omitidas = 0;

  for (let i = 0; i < cells.count; i += 1) {
    const desenhada = cellToPixels(celulaEm(cells, i), coords, geom, paint);
    if (desenhada === null) omitidas += 1;
    else desenhadas.push(desenhada);
  }

  return { cells, desenhadas, omitidas, geom };
}

/**
 * O critério 3.6 inteiro, aplicado a uma `DrawCell`.
 *
 * ── POR QUE CADA ASSERÇÃO ESTÁ AQUI ───────────────────────────────────────
 *
 * A finitude vem primeiro e é a razão de ser desta propriedade: coordenada
 * indefinida em `fillRect` não lança, então nada além desta asserção a pegaria.
 * Note que a checagem é de **finitude**, não só de não-indefinição — infinito
 * também não desenha, e uma asserção que só reprovasse indefinição deixaria essa
 * metade passar.
 *
 * O teste de integralidade existe porque coordenada fracionária faz o canvas
 * antialiasar a borda: com ~3.000 retângulos, bordas antialiasadas viram névoa
 * cinza uniforme em vez de faixas nítidas de liquidez.
 *
 * O piso de 1 px protege a parede **fina** — justamente a que interessa quando o
 * preço se aproxima dela — de desaparecer ao afastar o zoom.
 *
 * O recorte usa o **piso** do limite porque a razão de bitmap do dispositivo
 * produz larguras fracionárias como `799,5`, e o último pixel inteiramente contido
 * no viewport é `floor` dela. Desenhar além disso pintaria fora da área útil.
 *
 * `bucket` fecha a lista porque o laço de desenho **indexa a paleta por ele**: um
 * índice fracionário, negativo ou fora do domínio selecionaria estilo inexistente
 * e a célula não apareceria — a mesma falha silenciosa da coordenada indefinida,
 * por outra porta.
 */
function conferirDrawCell(d: DrawCell, widthPx: number, heightPx: number): void {
  // ── ausência de indefinição: a garantia central ──
  expect(Number.isFinite(d.x)).toBe(true);
  expect(Number.isFinite(d.y)).toBe(true);
  expect(Number.isFinite(d.w)).toBe(true);
  expect(Number.isFinite(d.h)).toBe(true);
  expect(Number.isFinite(d.bucket)).toBe(true);

  // Redundante com a finitude, e mantida de propósito: é a asserção cujo nome
  // aponta direto para o defeito quando ela falha.
  expect(Number.isNaN(d.x)).toBe(false);
  expect(Number.isNaN(d.y)).toBe(false);
  expect(Number.isNaN(d.w)).toBe(false);
  expect(Number.isNaN(d.h)).toBe(false);
  expect(Number.isNaN(d.bucket)).toBe(false);

  // ── grade inteira: sem borda antialiasada ──
  expect(Number.isInteger(d.x)).toBe(true);
  expect(Number.isInteger(d.y)).toBe(true);
  expect(Number.isInteger(d.w)).toBe(true);
  expect(Number.isInteger(d.h)).toBe(true);

  // ── piso de 1 px ──
  expect(d.w).toBeGreaterThanOrEqual(MIN_CELL_PX);
  expect(d.h).toBeGreaterThanOrEqual(MIN_CELL_PX);

  // ── recorte ao viewport ──
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(d.x + d.w).toBeLessThanOrEqual(Math.floor(widthPx));
  expect(d.y + d.h).toBeLessThanOrEqual(Math.floor(heightPx));

  // ── domínio dos campos de cor ──
  expect(Number.isInteger(d.bucket)).toBe(true);
  expect(d.bucket).toBeGreaterThanOrEqual(BUCKET_MIN);
  expect(d.bucket).toBeLessThanOrEqual(BUCKET_MAX);
  expect(d.side === 'BID' || d.side === 'ASK').toBe(true);
  expect(typeof d.aboveScale).toBe('boolean');
}

/**
 * As colunas de saída da agregação não carregam indefinição nos índices válidos.
 *
 * Separada de `conferirDrawCell` porque pega o defeito **uma etapa antes**: uma
 * coordenada de grupo indefinida vinda do agrupamento seria depois convertida em
 * omissão pela conversão de pixel — e a omissão é silenciosa. Sem esta asserção o
 * sintoma seria "o heatmap ficou vazio", sem indicação de onde nasceu.
 */
function conferirColunasFinitas(cells: AggregatedCells): void {
  expect(cells.tsMs.length).toBeGreaterThanOrEqual(cells.count);
  expect(cells.preco.length).toBeGreaterThanOrEqual(cells.count);
  expect(cells.bid.length).toBeGreaterThanOrEqual(cells.count);
  expect(cells.ask.length).toBeGreaterThanOrEqual(cells.count);
  expect(cells.buy.length).toBeGreaterThanOrEqual(cells.count);
  expect(cells.sell.length).toBeGreaterThanOrEqual(cells.count);

  expect(Number.isFinite(cells.fatorTempo)).toBe(true);
  expect(Number.isFinite(cells.fatorPreco)).toBe(true);
  expect(cells.fatorTempo).toBeGreaterThanOrEqual(1);
  expect(cells.fatorPreco).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < cells.count; i += 1) {
    const celula = celulaEm(cells, i);
    expect(Number.isFinite(celula.tsMs)).toBe(true);
    expect(Number.isFinite(celula.preco)).toBe(true);
    expect(Number.isFinite(celula.bid)).toBe(true);
    expect(Number.isFinite(celula.ask)).toBe(true);
    expect(Number.isFinite(celula.buy)).toBe(true);
    expect(Number.isFinite(celula.sell)).toBe(true);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade na faixa que o dado real ocupa.
 *
 * A distribuição medida nas 22.721 células com fila do pregão de referência é
 * `p50 = 481 ct`, `p90 = 714 ct`, `p99 = 1.131 ct`. A parede e o artefato de nível
 * cruzado entram como valores nomeados por serem os extremos.
 */
const arbQuantidadeRealista = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 1_200 }), weight: 6 },
  { arbitrary: fc.integer({ min: 1_200, max: 2_600 }), weight: 2 },
  { arbitrary: fc.constantFrom(0, 481, 714, 1_131, PAREDE_CT, 36_232), weight: 2 },
);

/**
 * Valores que o critério 3.10 manda contar como zero, mais as bordas de precisão.
 *
 * ⚠️ **São obrigatórios nesta propriedade, não decoração.** O critério manda que
 * valor não finito ou negativo conte como zero **preservando os demais valores da
 * mesma célula** — a sanitização é por campo. Se ela vazasse, a indefinição
 * atravessaria o agrupamento, chegaria à coordenada de grupo e de lá a
 * `fillRect`. É exatamente o caminho que esta propriedade fecha, então a entrada
 * hostil é a única forma de exercitá-lo.
 *
 * `MAX_VALUE` e `MIN_VALUE` não sobrevivem à coluna de precisão simples — o
 * primeiro vira infinito, o segundo vira zero. Estão aqui para que a sanitização
 * seja exercitada sobre o valor **lido de volta do grid**, e não sobre o número
 * gerado.
 */
const arbQuantidadeHostil = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  -1,
  -PAREDE_CT,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  1e-45,
  0.5,
);

/** Peso alto no hostil: é a entrada que exercita a garantia de finitude. */
const arbQuantidade = fc.oneof(
  { arbitrary: arbQuantidadeRealista, weight: 6 },
  { arbitrary: arbQuantidadeHostil, weight: 4 },
);

/** Grid de eixos e densidade dados. O par (balde, preço) pode repetir. */
function arbGridCom(
  baldes: { min: number; max: number },
  precos: { min: number; max: number },
  celulas: { minLength: number; maxLength: number },
): fc.Arbitrary<BookmapGrid> {
  return fc
    .record({ nBaldes: fc.integer(baldes), nPrecos: fc.integer(precos) })
    .chain(({ nBaldes, nPrecos }) =>
      fc
        .array(
          fc.record({
            ti: fc.integer({ min: 0, max: nBaldes - 1 }),
            pi: fc.integer({ min: 0, max: nPrecos - 1 }),
            bid: arbQuantidade,
            ask: arbQuantidade,
            buy: arbQuantidade,
            sell: arbQuantidade,
          }),
          celulas,
        )
        .map((lista) => construirGrid(nBaldes, nPrecos, lista)),
    );
}

/**
 * ⚠️ **A densidade é o que faz o teto ser exercitado.**
 *
 * Um grid esparso forma poucos grupos, e poucos grupos cabem em qualquer
 * orçamento — a desigualdade `count ≤ teto` passaria por folga, sem nunca
 * acionar a duplicação da dimensão mínima. O grid denso com muitos pares
 * distintos é o que produz contagem bruta acima de tetos pequenos.
 */
const arbGridDenso = arbGridCom(
  { min: 1, max: 48 },
  { min: 1, max: 8 },
  { minLength: 1, maxLength: 400 },
);

/** Forma transposta: os dois eixos têm dimensão mínima e fator independentes. */
const arbGridAlto = arbGridCom(
  { min: 1, max: 8 },
  { min: 1, max: 48 },
  { minLength: 1, maxLength: 400 },
);

/**
 * Grid **largo em pares distintos** — o que aperta o teto de verdade.
 *
 * Eixos de 60 × 40 dão 2.400 pares possíveis, e até 900 células sorteadas sobre
 * eles produzem algumas centenas de grupos distintos. Contra tetos de 1 a 10 o
 * estouro é certo, e é este gerador que faz a duplicação da dimensão mínima
 * rodar de fato.
 */
const arbGridLargo = arbGridCom(
  { min: 40, max: 60 },
  { min: 20, max: 40 },
  { minLength: 200, maxLength: 900 },
);

/** Esparso: exercita janela sem célula e eixo longo, que os densos não produzem. */
const arbGridEsparso = arbGridCom(
  { min: 1, max: 240 },
  { min: 1, max: 120 },
  { minLength: 0, maxLength: 400 },
);

const arbGrid: fc.Arbitrary<BookmapGrid> = fc.oneof(
  { arbitrary: arbGridDenso, weight: 3 },
  { arbitrary: arbGridAlto, weight: 2 },
  { arbitrary: arbGridLargo, weight: 3 },
  { arbitrary: arbGridEsparso, weight: 2 },
);

/**
 * Dimensões de pixel do gráfico.
 *
 * As pequenas estão aqui de propósito: o fator de um eixo só passa de 1 quando
 * `dimensãoMínima × unidadesVisíveis > pixelsDoEixo`. Se todas as janelas fossem
 * largas, a maioria dos casos rodaria com fator 1.
 *
 * ⚠️ As fracionárias (`799,5` e `449,5`) reproduzem a razão de bitmap do
 * dispositivo e são o único caminho até a asserção de recorte contra o **piso** do
 * limite. Sem elas, `x + w ≤ floor(largura)` e `x + w ≤ largura` seriam
 * indistinguíveis, e a diferença é 1 px pintado fora da área útil.
 */
const arbLarguraPx = fc.constantFrom(1, 3, 40, 120, 300, 799.5, 800, 1_600);
const arbAlturaPx = fc.constantFrom(1, 2, 30, 80, 200, 449.5, 400, 900);

/** Monta a janela a partir de um retângulo de índices de eixo. */
function montarJanela(
  grid: BookmapGrid,
  tiDe: number,
  tiAte: number,
  piDe: number,
  piAte: number,
  larguraPx: number,
  alturaPx: number,
): VisibleWindow {
  return {
    tsDe: grid.times[tiDe] ?? ABERTURA_MS,
    tsAte: grid.times[tiAte] ?? ABERTURA_MS,
    precoDe: grid.prices[piDe] ?? PRECO_BASE,
    precoAte: grid.prices[piAte] ?? PRECO_BASE,
    larguraPx,
    alturaPx,
    // Derivação honesta, que é a que a camada de canvas faz: a contagem de
    // entradas de eixo dentro dos limites.
    baldesVisiveis: tiAte - tiDe + 1,
    ticksVisiveis: piAte - piDe + 1,
  };
}

/** Janela que cobre os eixos inteiros — a que forma o maior número de grupos. */
function arbJanelaAmpla(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({ larguraPx: arbLarguraPx, alturaPx: arbAlturaPx })
    .map(({ larguraPx, alturaPx }) =>
      montarJanela(grid, 0, nT - 1, 0, nP - 1, larguraPx, alturaPx),
    );
}

/** Janela sorteada livremente — pode não conter célula alguma. */
function arbJanelaLivre(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({
      tiDe: fc.integer({ min: 0, max: Math.max(0, nT - 1) }),
      tiVao: fc.integer({ min: 0, max: Math.max(0, nT - 1) }),
      piDe: fc.integer({ min: 0, max: Math.max(0, nP - 1) }),
      piVao: fc.integer({ min: 0, max: Math.max(0, nP - 1) }),
      larguraPx: arbLarguraPx,
      alturaPx: arbAlturaPx,
    })
    .map(({ tiDe, tiVao, piDe, piVao, larguraPx, alturaPx }) =>
      montarJanela(
        grid,
        tiDe,
        Math.min(tiDe + tiVao, nT - 1),
        piDe,
        Math.min(piDe + piVao, nP - 1),
        larguraPx,
        alturaPx,
      ),
    );
}

/**
 * Janela ancorada numa célula que existe, crescida ao redor dela.
 *
 * Garante ao menos uma célula dentro. Sem isso, janela sorteada solta sobre eixos
 * esparsos cai no vazio com frequência alta — e no vazio não há `DrawCell` a
 * conferir, então a propriedade retornaria sem ter olhado nenhuma.
 */
function arbJanelaAncorada(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const n = grid.ti.length;
  if (n === 0) return arbJanelaLivre(grid);

  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({
      k: fc.integer({ min: 0, max: n - 1 }),
      antesT: fc.integer({ min: 0, max: 120 }),
      depoisT: fc.integer({ min: 0, max: 120 }),
      antesP: fc.integer({ min: 0, max: 60 }),
      depoisP: fc.integer({ min: 0, max: 60 }),
      larguraPx: arbLarguraPx,
      alturaPx: arbAlturaPx,
    })
    .map(({ k, antesT, depoisT, antesP, depoisP, larguraPx, alturaPx }) => {
      const ancoraT = grid.ti[k] ?? 0;
      const ancoraP = grid.pi[k] ?? 0;
      return montarJanela(
        grid,
        Math.max(0, ancoraT - antesT),
        Math.min(nT - 1, ancoraT + depoisT),
        Math.max(0, ancoraP - antesP),
        Math.min(nP - 1, ancoraP + depoisP),
        larguraPx,
        alturaPx,
      );
    });
}

function arbJanelaUtilizavel(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  return fc.oneof(
    { arbitrary: arbJanelaAmpla(grid), weight: 4 },
    { arbitrary: arbJanelaAncorada(grid), weight: 4 },
    { arbitrary: arbJanelaLivre(grid), weight: 2 },
  );
}

/**
 * Janela utilizável cujas contagens de unidades visíveis são **incoerentes** com
 * os limites: declara uma unidade por eixo enquanto os limites cobrem tudo.
 *
 * Não é entrada inventada — as contagens chegam por parâmetro e são independentes
 * dos limites, então nada impede que divirjam. É justamente o caso que mantém os
 * fatores de agrupamento em 1 enquanto o orçamento continua estourado, e é o
 * único caminho até o **esgotamento** das doze repetições: com fator travado, a
 * duplicação da dimensão mínima não reduz o número de grupos e as doze se
 * consomem.
 */
function arbJanelaIncoerente(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  return fc
    .record({ larguraPx: fc.constantFrom(800, 1_600), alturaPx: fc.constantFrom(400, 900) })
    .map(({ larguraPx, alturaPx }) => ({
      ...montarJanela(grid, 0, nT - 1, 0, nP - 1, larguraPx, alturaPx),
      baldesVisiveis: 1,
      ticksVisiveis: 1,
    }));
}

/**
 * Janela que o critério 3.9 manda recusar: pixel não positivo, limite invertido,
 * limite não finito. Todas entregam zero células, sem lançar.
 */
function arbJanelaDegenerada(grid: BookmapGrid): fc.Arbitrary<VisibleWindow> {
  return arbJanelaUtilizavel(grid).chain((base) =>
    fc.oneof(
      fc.constant({ ...base, larguraPx: 0 }),
      fc.constant({ ...base, alturaPx: 0 }),
      fc.constant({ ...base, larguraPx: -1 }),
      fc.constant({ ...base, alturaPx: -0.5 }),
      fc.constant({ ...base, alturaPx: Number.NaN }),
      fc.constant({ ...base, larguraPx: Number.NaN }),
      fc.constant({ ...base, larguraPx: Number.POSITIVE_INFINITY }),
      fc.constant({ ...base, alturaPx: Number.POSITIVE_INFINITY }),
      fc.constant({ ...base, tsDe: base.tsAte + BALDE_MS, tsAte: base.tsDe }),
      fc.constant({ ...base, precoDe: base.precoAte + PRECO_PASSO, precoAte: base.precoDe }),
      fc.constant({ ...base, tsDe: Number.NaN }),
      fc.constant({ ...base, tsAte: Number.NaN }),
      fc.constant({ ...base, precoDe: Number.NEGATIVE_INFINITY }),
      fc.constant({ ...base, precoAte: Number.POSITIVE_INFINITY }),
    ),
  );
}

/** Orçamento e dimensão mínima. */
interface Orcamento {
  readonly maxCells: number;
  readonly minCellPx: number;
}

/**
 * Orçamento **apertado**, que estoura em grid denso.
 *
 * ⚠️ Este é o gerador que faz a propriedade do teto valer algo. Tetos de 1 a 30
 * contra grids de centenas de grupos distintos garantem estouro, e o estouro é o
 * único caminho até a duplicação da dimensão mínima.
 *
 * `minCellPx` pequeno é deliberado: dimensão mínima grande colapsa o eixo num
 * grupo só já na primeira tentativa, e o orçamento passa a caber sem que a
 * repetição rode. Dimensão pequena é o que mantém a duplicação avançando devagar
 * e a torna observável.
 */
const arbOrcamentoApertado: fc.Arbitrary<Orcamento> = fc.record({
  maxCells: fc.constantFrom(1, 1, 2, 2, 3, 5, 8, 10, 16, 30),
  minCellPx: fc.constantFrom(0, 0, 1, 1, 2, 3),
});

/**
 * Orçamento nos **limites** do intervalo admitido e nos casos de normalização do
 * critério 3.1.
 *
 * Cobre os quatro casos que o critério nomeia, e a cobertura é aferida por
 * asserção adiante:
 *
 * - `1` — piso do intervalo;
 * - `20.000` — teto do intervalo;
 * - `0`, `-1`, `-100` — abaixo do piso, sobem a 1;
 * - `999.999`, `1e9` — acima do teto, descem a 20.000;
 * - indefinição, infinito e fracionário — caem no padrão de 3.000. ⚠️ `1.5` cai
 *   no padrão e **não** é arredondado.
 */
const arbOrcamentoLimite: fc.Arbitrary<Orcamento> = fc.record({
  maxCells: fc.constantFrom(
    ORCAMENTO_MIN,
    ORCAMENTO_MAX,
    0,
    -1,
    -100,
    999_999,
    1e9,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    2.999,
    ORCAMENTO_PADRAO,
  ),
  minCellPx: fc.constantFrom(0, 1, 2, 3, 8, 24, 64, 128, Number.NaN, -1, Number.POSITIVE_INFINITY),
});

/** Orçamento que acomoda qualquer grid destes geradores (no máximo 900 células). */
const arbOrcamentoFolgado: fc.Arbitrary<Orcamento> = fc.record({
  maxCells: fc.constantFrom(1_000, ORCAMENTO_PADRAO, ORCAMENTO_MAX, Number.NaN),
  minCellPx: fc.constantFrom(0, 1, 2, 3, 8, 24, 64),
});

const arbOrcamento: fc.Arbitrary<Orcamento> = fc.oneof(
  { arbitrary: arbOrcamentoApertado, weight: 4 },
  { arbitrary: arbOrcamentoLimite, weight: 4 },
  { arbitrary: arbOrcamentoFolgado, weight: 2 },
);

/** Uma tripla completa mais o que a passada de desenho precisa. */
interface Cenario {
  readonly grid: BookmapGrid;
  readonly janela: VisibleWindow;
  readonly orcamento: Orcamento;
  readonly variante: VarianteCoord;
  readonly paint: DrawCellPaint | null | undefined;
}

/**
 * Campos de cor, incluindo os hostis.
 *
 * `bucket` fora do domínio e não finito estão aqui porque o laço de desenho
 * **indexa a paleta** por esse campo: um índice inválido selecionaria estilo
 * inexistente e a célula não apareceria. A ausência (`null`/indefinido) exercita o
 * padrão, que adota a célula mais fraca da escala — errar para menos subestima a
 * liquidez em vez de anunciar parede que ninguém mediu.
 */
const arbPaint: fc.Arbitrary<DrawCellPaint | null | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.record({
    bucket: fc.constantFrom(
      0,
      1,
      7,
      15,
      -1,
      -100,
      16,
      99,
      3.4,
      15.6,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
    side: fc.constantFrom<'BID' | 'ASK'>('BID', 'ASK'),
    aboveScale: fc.boolean(),
  }),
  // Objeto com campos de tipo errado: o núcleo é a fronteira entre dado de rede e
  // desenho, e a fronteira tem de ser total.
  fc.constant({
    bucket: 'oito' as unknown as number,
    side: 'MEIO' as unknown as 'BID',
    aboveScale: 1 as unknown as boolean,
  }),
);

/** Cenário com janela utilizável — o caso em que há células a conferir. */
const arbCenario: fc.Arbitrary<Cenario> = arbGrid.chain((grid) =>
  fc.record({
    grid: fc.constant(grid),
    janela: arbJanelaUtilizavel(grid),
    orcamento: arbOrcamento,
    variante: fc.constantFrom(...VARIANTES_DESENHAVEIS),
    paint: arbPaint,
  }),
);

/**
 * Cenário sem restrição alguma: janela degenerada, janela incoerente e as
 * variantes de coordenada que devolvem ausência, indefinição ou infinito.
 *
 * É o gerador da totalidade — o que afirma que nenhuma entrada, por hostil que
 * seja, produz `DrawCell` corrompida nem faz o pipeline lançar.
 */
const arbCenarioQualquer: fc.Arbitrary<Cenario> = arbGrid.chain((grid) =>
  fc.record({
    grid: fc.constant(grid),
    janela: fc.oneof(
      { arbitrary: arbJanelaUtilizavel(grid), weight: 5 },
      { arbitrary: arbJanelaDegenerada(grid), weight: 2 },
      { arbitrary: arbJanelaIncoerente(grid), weight: 3 },
    ),
    orcamento: arbOrcamento,
    variante: fc.constantFrom(...VARIANTES_TODAS),
    paint: arbPaint,
  }),
);

/**
 * As coordenadas de um cenário, derivadas da janela dele.
 *
 * O parâmetro é declarado pelos **dois campos que a função lê**, e não pelo
 * `Cenario` inteiro: o cenário de viewport minúsculo não tem campos de cor, e
 * exigir o tipo completo obrigaria a preenchê-los com valor inerte só para
 * satisfazer o compilador. Pedir o mínimo mantém a função reusável por qualquer
 * cenário que traga janela e variante.
 */
function coordsDo(cenario: Pick<Cenario, 'janela' | 'variante'>): CoordinateFns {
  const { janela, variante } = cenario;
  return construirCoords(
    variante,
    janela.tsDe / 1_000,
    janela.tsAte / 1_000,
    janela.precoDe,
    janela.precoAte,
    janela.larguraPx,
    janela.alturaPx,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 7: teto de orçamento e ausência de NaN', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Garantia 1 — o teto de orçamento (critério 3.1)
  // ───────────────────────────────────────────────────────────────────────────

  it('a contagem entregue nunca excede o orçamento efetivo, normalizado como o critério manda', () => {
    fc.assert(
      fc.property(arbCenarioQualquer, ({ grid, janela, orcamento }) => {
        const cells = aggregateForZoom(grid, janela, orcamento);
        const teto = orcamentoEfetivo(orcamento.maxCells);

        // A desigualdade do enunciado, contra o teto NORMALIZADO — que é o que o
        // critério 3.1 define. Comparar contra `orcamento.maxCells` cru seria
        // falso por construção: `maxCells: 0` admite uma célula, e
        // `maxCells: NaN` admite três mil.
        expect(cells.count).toBeLessThanOrEqual(teto);

        // O teto normalizado está no intervalo admitido, sempre. Sem isto, um
        // erro na própria referência passaria despercebido.
        expect(teto).toBeGreaterThanOrEqual(ORCAMENTO_MIN);
        expect(teto).toBeLessThanOrEqual(ORCAMENTO_MAX);

        // `count` nunca excede a capacidade de nenhuma coluna: é a outra metade
        // de "`count` é a verdade". Coluna mais curta que `count` faria o laço de
        // desenho ler além do preenchido.
        expect(cells.count).toBeGreaterThanOrEqual(0);
        conferirColunasFinitas(cells);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('no piso do intervalo: orçamento 1 entrega no máximo uma célula, mesmo com grid denso', () => {
    fc.assert(
      fc.property(
        arbGrid.chain((grid) =>
          fc.record({ grid: fc.constant(grid), janela: arbJanelaAmpla(grid) }),
        ),
        // Dois orçamentos que o critério manda restringir ao piso de uma célula:
        // o próprio `1`, e valores abaixo dele.
        fc.constantFrom(ORCAMENTO_MIN, 0, -1, -100),
        ({ grid, janela }, maxCells) => {
          const cells = aggregateForZoom(grid, janela, { maxCells, minCellPx: 1 });
          expect(orcamentoEfetivo(maxCells)).toBe(ORCAMENTO_MIN);
          expect(cells.count).toBeLessThanOrEqual(ORCAMENTO_MIN);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('no teto do intervalo: valor acima de 20.000 é restringido a 20.000, não aceito como veio', () => {
    fc.assert(
      fc.property(fc.constantFrom(ORCAMENTO_MAX, 20_001, 999_999, 1e9, 2 ** 40), (maxCells) => {
        expect(orcamentoEfetivo(maxCells)).toBe(ORCAMENTO_MAX);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('orçamento que não é inteiro finito cai no padrão de 3.000, e fracionário não é arredondado', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          1.5,
          2.999,
          0.1,
          -3.7,
          1e9 + 0.5,
        ),
        (maxCells) => {
          // ⚠️ O ponto do critério 3.1: cai no PADRÃO, não arredonda. `1.5`
          // admite 3.000 células, não 1 nem 2 — orçamento fracionário indica
          // cálculo errado a montante, e adivinhar a intenção esconderia o
          // defeito.
          expect(orcamentoEfetivo(maxCells)).toBe(ORCAMENTO_PADRAO);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('grid grande com orçamento apertado resolve por duplicação da dimensão mínima, sem descartar grupo por truncamento', () => {
    fc.assert(
      fc.property(
        arbGridLargo.chain((grid) =>
          fc.record({
            grid: fc.constant(grid),
            janela: arbJanelaAmpla(grid),
            orcamento: arbOrcamentoApertado,
          }),
        ),
        ({ grid, janela, orcamento }) => {
          const { cells, budgetExhausted, repetitions } = aggregateForZoomWithOutcome(
            grid,
            janela,
            orcamento,
          );
          const teto = orcamentoEfetivo(orcamento.maxCells);

          // O teto vale mesmo quando a duplicação correu.
          expect(cells.count).toBeLessThanOrEqual(teto);

          // A cota de doze repetições é respeitada — a terminação é garantida, e
          // sem esta asserção uma repetição sem fim travaria a suíte em vez de
          // reprovar.
          expect(repetitions).toBeGreaterThanOrEqual(0);
          expect(repetitions).toBeLessThanOrEqual(12);

          if (budgetExhausted) {
            // Critério 3.5: esgotadas as doze, entrega zero células. É preferir
            // vazio a truncar — buraco no heatmap é indistinguível de ausência de
            // liquidez, e o vazio ao menos é honesto.
            expect(cells.count).toBe(0);
            expect(repetitions).toBe(12);
            return;
          }

          // ⚠️ A asserção que proíbe truncamento. Se a implementação resolvesse
          // o estouro cortando grupos, a contagem entregue bateria exatamente no
          // teto — é a assinatura do corte. Resolvendo por duplicação, a contagem
          // é o número de grupos que os fatores finais formam, e ela pode ficar
          // abaixo do teto sem que nada tenha sido descartado.
          const brutosComFatoresFinais = gruposBrutos(
            grid,
            janela,
            cells.fatorTempo,
            cells.fatorPreco,
          );
          expect(cells.count).toBe(brutosComFatoresFinais);

          // Houve repetição ⇒ o agrupamento de fato ficou mais grosso. Fator
          // parado em 1 depois de repetir significaria que a duplicação não
          // produziu efeito e o laço girou em falso.
          if (repetitions > 0) {
            expect(cells.fatorTempo > 1 || cells.fatorPreco > 1).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Garantia 2 — ausência de indefinição em toda DrawCell (critério 3.6)
  // ───────────────────────────────────────────────────────────────────────────

  it('toda DrawCell produzida pelo pipeline tem campos finitos, inteiros, com piso de 1 px e recortados ao viewport', () => {
    fc.assert(
      fc.property(arbCenario, (cenario) => {
        const { grid, janela, orcamento, paint } = cenario;
        const coords = coordsDo(cenario);

        const passada = rodarPassada(
          grid,
          janela,
          orcamento,
          coords,
          janela.larguraPx,
          janela.alturaPx,
          paint,
        );

        // A saída do agrupamento já não pode carregar indefinição: se carregasse,
        // a conversão de pixel a transformaria em omissão silenciosa e o sintoma
        // seria "o heatmap ficou vazio", sem indicação da origem.
        conferirColunasFinitas(passada.cells);

        for (const desenhada of passada.desenhadas) {
          conferirDrawCell(desenhada, janela.larguraPx, janela.alturaPx);
        }

        // Conservação da contagem: cada célula agregada virou desenho ou omissão,
        // e nada além disso. Uma célula que sumisse do balanço estaria sendo
        // perdida por um caminho não previsto.
        expect(passada.desenhadas.length + passada.omitidas).toBe(passada.cells.count);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('nenhuma entrada hostil produz DrawCell corrompida: coordenada indefinida, infinita ou ausente resulta em omissão', () => {
    fc.assert(
      fc.property(arbCenarioQualquer, (cenario) => {
        const { grid, janela, orcamento, paint, variante } = cenario;
        const coords = coordsDo(cenario);

        // A passada inteira não lança, em nenhuma combinação. `null` omite
        // exclusivamente a célula afetada, então o restante do heatmap sobrevive
        // a uma célula fora da escala.
        const passada = rodarPassada(
          grid,
          janela,
          orcamento,
          coords,
          janela.larguraPx,
          janela.alturaPx,
          paint,
        );

        for (const desenhada of passada.desenhadas) {
          conferirDrawCell(desenhada, janela.larguraPx, janela.alturaPx);
        }

        // As variantes que nunca produzem coordenada utilizável não podem
        // produzir desenho algum. É a asserção que distingue "tratou" de
        // "deixou passar": sem ela, uma implementação que aceitasse indefinição
        // satisfaria o balanço de contagem e falharia só na finitude — e a
        // finitude é justamente o que se quer garantir que nunca chega ali.
        if (
          variante === 'SEMPRE_NULO' ||
          variante === 'SEMPRE_INDEFINIDO' ||
          variante === 'INDEFINIDA' ||
          variante === 'INFINITA' ||
          variante === 'PARCIAL_NULO'
        ) {
          expect(passada.desenhadas).toHaveLength(0);
          expect(passada.omitidas).toBe(passada.cells.count);
        }

        // Coordenada finita mas inteiramente fora do viewport: omissão por não
        // intersectar, não recorte para dentro. Desenhar seria pior que omitir —
        // apareceria liquidez na borda onde não há nenhuma.
        if (variante === 'FORA_DA_ESCALA') {
          expect(passada.desenhadas).toHaveLength(0);
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('janela degenerada entrega zero células e nenhuma DrawCell, sem lançar', () => {
    fc.assert(
      fc.property(
        arbGrid.chain((grid) =>
          fc.record({
            grid: fc.constant(grid),
            janela: arbJanelaDegenerada(grid),
            orcamento: arbOrcamento,
            variante: fc.constantFrom(...VARIANTES_TODAS),
            paint: arbPaint,
          }),
        ),
        (cenario) => {
          const { grid, janela, orcamento, paint } = cenario;

          // A precondição do gerador, afirmada: se um caso escapasse utilizável,
          // o teste passaria medindo outra coisa.
          expect(janelaUtilizavel(janela)).toBe(false);

          const coords = coordsDo(cenario);
          const passada = rodarPassada(
            grid,
            janela,
            orcamento,
            coords,
            janela.larguraPx,
            janela.alturaPx,
            paint,
          );

          // Critério 3.9: zero células, sem lançar — mesmo quando há células
          // dentro dos limites de tempo e de preço.
          expect(passada.cells.count).toBe(0);
          expect(passada.desenhadas).toHaveLength(0);
          expect(passada.omitidas).toBe(0);

          // Os fatores continuam finitos mesmo no caminho degenerado: eles vão
          // para a geometria da passada, e um fator indefinido ali contaminaria
          // toda largura e altura calculadas.
          conferirColunasFinitas(passada.cells);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('viewport que não caiba uma célula de 1 px não produz DrawCell, em vez de produzir dimensão zero', () => {
    fc.assert(
      fc.property(
        arbGrid.chain((grid) =>
          fc.record({
            grid: fc.constant(grid),
            janela: arbJanelaAmpla(grid),
            orcamento: arbOrcamentoFolgado,
            // Dimensão útil abaixo de um pixel inteiro: o piso de 1 px e o
            // recorte ao viewport seriam contraditórios, e omitir é a única
            // resposta coerente com as duas pós-condições do critério 3.6.
            widthPx: fc.constantFrom(0, 0.4, 0.99, -1, Number.NaN),
            heightPx: fc.constantFrom(0, 0.4, 0.99, -1, Number.NaN),
            variante: fc.constantFrom(...VARIANTES_DESENHAVEIS),
          }),
        ),
        (cenario) => {
          const coords = coordsDo(cenario);
          const passada = rodarPassada(
            cenario.grid,
            cenario.janela,
            cenario.orcamento,
            coords,
            cenario.widthPx,
            cenario.heightPx,
          );

          expect(passada.desenhadas).toHaveLength(0);
          expect(passada.omitidas).toBe(passada.cells.count);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Guardas de vacuidade — a propriedade tem de exercitar o que protege
  // ───────────────────────────────────────────────────────────────────────────

  it('os geradores de fato apertam o orçamento: há casos com mais grupos brutos que o teto', () => {
    // ⚠️ **Esta é a guarda mais importante do arquivo.** A desigualdade
    // `count ≤ teto` é trivialmente verdadeira quando o grid forma menos grupos
    // que o teto — e nesse caso o mecanismo que existe para garanti-la (a
    // duplicação da dimensão mínima) nunca roda. O teste passaria por folga, não
    // por mérito, e uma regressão no tratamento de estouro não seria notada.
    //
    // Medir por asserção, e não só anotar num comentário, é o que impede a
    // regressão silenciosa: encurtar um eixo ou afrouxar um teto no futuro pode
    // devolver o arquivo ao estado vazio, e o único sintoma seria a suíte
    // continuar verde.
    const cenarios = fc.sample(arbCenarioQualquer, { numRuns: NUM_RUNS, seed: SEED });
    expect(cenarios).toHaveLength(NUM_RUNS);

    let apertaram = 0;
    let resolveramPorDuplicacao = 0;
    let esgotaram = 0;
    let noPiso = 0;
    let noTeto = 0;
    let noPadrao = 0;

    for (const { grid, janela, orcamento } of cenarios) {
      const teto = orcamentoEfetivo(orcamento.maxCells);
      const { cells, budgetExhausted, repetitions } = aggregateForZoomWithOutcome(
        grid,
        janela,
        orcamento,
      );

      // Contagem bruta SEM agrupamento: quantos grupos existiriam com fator 1. Se
      // ela excede o teto, o caso obriga a implementação a agir.
      if (celulasNaJanela(grid, janela) > teto) apertaram += 1;
      // A duplicação correu e o resultado couber — o caminho de sucesso do
      // critério 3.5.
      if (repetitions > 0 && !budgetExhausted && cells.count > 0) resolveramPorDuplicacao += 1;
      // As doze se consumiram — o caminho de esgotamento do mesmo critério.
      if (budgetExhausted) esgotaram += 1;

      if (teto === ORCAMENTO_MIN) noPiso += 1;
      if (teto === ORCAMENTO_MAX) noTeto += 1;
      if (teto === ORCAMENTO_PADRAO) noPadrao += 1;
    }

    // O caso que exercita o teto de fato. Sem ele, tudo acima é tautologia.
    expect(apertaram).toBeGreaterThan(0);

    // Os DOIS desfechos do critério 3.5, separadamente — são caminhos de código
    // diferentes, e cobrir um deixaria o outro sem exercício.
    expect(resolveramPorDuplicacao).toBeGreaterThan(0);
    expect(esgotaram).toBeGreaterThan(0);

    // Os três regimes de normalização do critério 3.1.
    expect(noPiso).toBeGreaterThan(0);
    expect(noTeto).toBeGreaterThan(0);
    expect(noPadrao).toBeGreaterThan(0);
  });

  it('os geradores de fato produzem DrawCell: há células desenhadas e há células omitidas', () => {
    // A garantia de finitude só diz algo sobre células que existem. Um gerador que
    // produzisse zero `DrawCell` faria todo laço de conferência rodar em vazio, e
    // a propriedade central passaria sem nunca ter olhado um retângulo.
    //
    // A recíproca também precisa de guarda: se nenhuma célula fosse omitida, o
    // caminho `null` — que é o tratamento de coordenada ruim — ficaria sem
    // exercício.
    //
    // ⚠️ **Os DOIS geradores são medidos, e não um só.** A propriedade central de
    // finitude roda sobre `arbCenario`; a de totalidade, sobre
    // `arbCenarioQualquer`. Medir apenas o segundo deixaria o primeiro sem guarda
    // — e é justamente o primeiro que produz a maioria dos retângulos conferidos.
    const cenarios = [
      ...fc.sample(arbCenario, { numRuns: NUM_RUNS, seed: SEED }),
      ...fc.sample(arbCenarioQualquer, { numRuns: NUM_RUNS, seed: SEED }),
    ];
    const total = cenarios.length;
    expect(total).toBe(NUM_RUNS * 2);

    let comDesenho = 0;
    let comOmissao = 0;
    let totalDesenhadas = 0;
    let comLimiteFracionario = 0;
    let comBucketForaDoDominio = 0;
    let comValorHostilNaEntrada = 0;

    for (const cenario of cenarios) {
      const { grid, janela, orcamento, paint } = cenario;
      const coords = coordsDo(cenario);
      const passada = rodarPassada(
        grid,
        janela,
        orcamento,
        coords,
        janela.larguraPx,
        janela.alturaPx,
        paint,
      );

      if (passada.desenhadas.length > 0) comDesenho += 1;
      if (passada.omitidas > 0) comOmissao += 1;
      totalDesenhadas += passada.desenhadas.length;

      // O caso que distingue recorte contra o piso do limite de recorte contra o
      // limite cru — a diferença é 1 px pintado fora da área útil.
      if (!Number.isInteger(janela.larguraPx) || !Number.isInteger(janela.alturaPx)) {
        comLimiteFracionario += 1;
      }

      if (paint !== null && paint !== undefined) {
        const bruto = paint.bucket;
        if (!Number.isInteger(bruto) || bruto < BUCKET_MIN || bruto > BUCKET_MAX) {
          comBucketForaDoDominio += 1;
        }
      }

      // Entrada que o critério 3.10 manda contar como zero. É ela que exercita a
      // sanitização por campo, cujo vazamento levaria indefinição até a
      // coordenada de grupo.
      let hostil = false;
      for (let k = 0; k < grid.bid.length; k += 1) {
        const valores = [grid.bid[k], grid.ask[k], grid.buy[k], grid.sell[k]];
        if (valores.some((v) => v === undefined || !Number.isFinite(v) || v < 0)) {
          hostil = true;
          break;
        }
      }
      if (hostil) comValorHostilNaEntrada += 1;
    }

    // Pisos folgados em relação ao medido, de propósito: servem para detectar
    // colapso do gerador, não para fixar a distribuição corrente.
    expect(comDesenho / total).toBeGreaterThan(0.2);
    expect(comOmissao / total).toBeGreaterThan(0.2);

    // O número de retângulos de fato conferidos por `conferirDrawCell`. É a
    // medida direta de não-vacuidade da propriedade central: com zero aqui, todo
    // laço dela roda em vazio e a garantia de finitude não diz nada.
    expect(totalDesenhadas).toBeGreaterThan(1_000);

    expect(comLimiteFracionario / total).toBeGreaterThan(0.05);
    expect(comBucketForaDoDominio / total).toBeGreaterThan(0.05);
    expect(comValorHostilNaEntrada / total).toBeGreaterThan(0.2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Determinismo — sem ele nenhum contraexemplo seria reproduzível
  // ───────────────────────────────────────────────────────────────────────────

  it('o pipeline é determinístico: duas passadas com as mesmas entradas produzem os mesmos retângulos', () => {
    fc.assert(
      fc.property(arbCenarioQualquer, (cenario) => {
        const { grid, janela, orcamento, paint } = cenario;
        const coords = coordsDo(cenario);

        const primeira = rodarPassada(
          grid,
          janela,
          orcamento,
          coords,
          janela.larguraPx,
          janela.alturaPx,
          paint,
        );
        const segunda = rodarPassada(
          grid,
          janela,
          orcamento,
          coords,
          janela.larguraPx,
          janela.alturaPx,
          paint,
        );

        // Igualdade estrutural das duas listas. Um retângulo instável faria o
        // heatmap tremer entre quadros com os mesmos dados.
        expect(segunda.desenhadas).toEqual(primeira.desenhadas);
        expect(segunda.omitidas).toBe(primeira.omitidas);
        expect(segunda.cells.count).toBe(primeira.cells.count);
        expect(segunda.geom).toEqual(primeira.geom);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});

