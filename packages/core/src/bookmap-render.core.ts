/**
 * `bookmap-render.core` — a superfície pública do núcleo puro de render da
 * camada de bookmap do mapa de decisão. Spec `bookmap-no-mapa-de-decisao`,
 * tarefa 4.3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É — E O QUE ELE NÃO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Só reexportação.** Nenhuma função, nenhuma constante nova, nenhum estado de
 * módulo, nenhum efeito colateral de import: importar este arquivo não executa
 * cálculo algum. Toda a lógica vive nos arquivos irmãos, e as assinaturas
 * chegam aqui exatamente como foram declaradas lá — este módulo não embrulha,
 * não adapta e não renomeia nada.
 *
 * O design nomeia um único núcleo puro de render. A implementação foi partida em
 * arquivos irmãos da mesma pasta por dois motivos práticos: seis tarefas de
 * núcleo puderam avançar sem disputar o mesmo arquivo, e cada parte ficou com
 * suíte própria, do tamanho do que ela decide. Este módulo restaura a superfície
 * única que o design descreve.
 *
 * ── QUEM IMPORTA DAQUI ────────────────────────────────────────────────────
 *
 * O primitive de canvas, o hook de busca e o card de paredes importam
 * **exclusivamente** deste módulo, nunca dos arquivos irmãos. É o que mantém a
 * repartição interna livre para mudar — mover uma função de um irmão para outro
 * não toca em consumidor algum, desde que a reexportação daqui permaneça.
 *
 * A recíproca também vale e é o motivo de o arquivo não ter lógica: se algum
 * cálculo morasse aqui, ele ficaria fora das suítes dos irmãos e sem suíte
 * própria — exatamente o canto onde um erro sobrevive sem ser notado.
 *
 * ── ONDE CADA COISA MORA ──────────────────────────────────────────────────
 *
 * | Irmão                     | O que decide                                  |
 * |---------------------------|-----------------------------------------------|
 * | `bookmap-types`           | os tipos compartilhados (só declarações)      |
 * | `bookmap-decode.core`     | payload colunar → grid tipado                 |
 * | `bookmap-color.core`      | percentis da janela visível → opacidade        |
 * | `bookmap-aggregate.core`  | agrupamento por zoom, sob orçamento de células |
 * | `bookmap-pixels.core`     | célula agregada → retângulo em pixels          |
 * | `bookmap-walls.core`      | qualificação de parede, tendência e causa      |
 * | `bookmap-coverage.core`   | classe de cobertura → hachura e rodapé BRT     |
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES MT5 (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo só importa os sete irmãos da própria pasta. O fechamento
 * transitivo dessas importações é: os próprios irmãos, mais um único utilitário
 * de formatação de horário em BRT alcançado por `bookmap-coverage.core`. Nenhum
 * deles alcança serviço de roteamento de conexão, de feed de tick, de execução
 * de ordem ou módulo de conector de terminal, e nenhum carrega endereço de rede,
 * identificador de conta, credencial ou estado de posição.
 *
 * Nada aqui emite evento de decisão, envia ordem, escreve em tabela ou altera
 * chave de configuração de trading: a camada é exclusivamente visual, e este
 * módulo em particular é apenas o índice dela.
 *
 * Todo insumo de livro chega de API (`GET /api/bookmap/heatmap-depth/:symbol`);
 * nenhum vem do sistema de arquivos, em CSV ou em qualquer outro formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que evitar: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência. Todos os irmãos adotam a
 * mesma disciplina.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR. Tipos saem por
 * `export type` porque o projeto compila com `isolatedModules`.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Tipos compartilhados — `bookmap-types`
// ═════════════════════════════════════════════════════════════════════════════

export type {
  /** Origem do livro; integra a chave primária de `bookmap_depth`. */
  FonteBookmap,
  /** Cobertura das duas metades do heatmap, que vêm de fontes diferentes. */
  CoberturaHeatmap,
  /** Formato verboso — contrato de rede atual, um objeto por célula. */
  CelulaHeatmapVerbosa,
  /** Formato colunar — opt-in, 66% menor no pregão de referência. */
  BookmapDepthColunar,
  /** O payload decodificado em arrays tipados, na forma que o desenho consome. */
  BookmapGrid,
  /** Janela visível do gráfico: limites do dado e dimensões em pixel. */
  VisibleWindow,
  /** Uma célula já agregada por zoom, como `cellToPixels` a recebe. */
  AggregatedCell,
  /** Saída colunar de `aggregateForZoom`. ⚠️ `count` é a verdade, não `length`. */
  AggregatedCells,
  /** Escala de cor derivada da janela visível (`p50`/`p99`, não o máximo global). */
  ColorScale,
  /** Célula pronta para `fillRect`, em pixels. */
  DrawCell,
  /** As funções de coordenada do próprio gráfico, embrulhadas e nunca refeitas. */
  CoordinateFns,
  /** Parede de liquidez detectada — o que o card da fase Pré-Decisão mostra. */
  BookmapWall,
  /** Por que a fila desapareceu: absorvida, cancelada, ou indeterminada. */
  CausaRetirada,
} from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Decodificação — `bookmap-decode.core`
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `decodeColumnar(payload) → BookmapGrid | null`.
 *
 * Único produtor de `BookmapGrid`. Devolve `null` — nunca um grid parcial, nunca
 * uma exceção — quando qualquer invariante do payload falha.
 */
export { decodeColumnar } from './bookmap-decode.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Escala de cor — `bookmap-color.core`
// ═════════════════════════════════════════════════════════════════════════════

export {
  /** Escala a partir de uma coluna de valores da janela visível. */
  computeColorScale,
  /**
   * Escala **compartilhada** pelos dois lados de uma mesma grandeza
   * (requisito 2.9): é o que faz duas células de igual quantidade em lados
   * opostos receberem opacidade igual.
   */
  computeColorScalePair,
  /** Quantidade → opacidade. Monotônica não-decrescente, nunca `NaN`. */
  alphaOf,
  /** Percentil da amostra positiva de um par de colunas, sem mutar a entrada. */
  positiveQuantileOfPair,
  /** A quantidade estourou o teto da escala? Alimenta `DrawCell.aboveScale`. */
  isAboveScale,
  /**
   * A janela visível tem faixa útil de magnitude?
   *
   * `false` significa escala colapsada, que o requisito 2.10 manda declarar na
   * legenda em vez de deixar o operador ler uma tela saturada como normal.
   */
  hasMagnitudeVariation,
  BOOKMAP_ALPHA_MIN_DEFAULT,
  BOOKMAP_ALPHA_MAX_DEFAULT,
  BOOKMAP_GAMMA_DEFAULT,
} from './bookmap-color.core.js';

/** Ajustes opcionais de `computeColorScale` e `computeColorScalePair`. */
export type { ColorScaleOptions } from './bookmap-color.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Agregação por zoom — `bookmap-aggregate.core`
// ═════════════════════════════════════════════════════════════════════════════

export {
  /**
   * `aggregateForZoom(grid, window, budget) → AggregatedCells`.
   *
   * A assinatura fixada pelo design. Fila combina por `max` (a parede é
   * preservada exatamente), execução por `sum`.
   */
  aggregateForZoom,
  /**
   * Mesma agregação, devolvendo também o desfecho.
   *
   * ⚠️ É esta a variante que o primitive usa: o núcleo é puro e não tem escopo
   * de sessão, então quem precisa registrar o esgotamento de orçamento **uma
   * única vez por sessão** precisa receber o desfecho de volta em vez de
   * inferi-lo de uma saída vazia — que também acontece por janela degenerada,
   * por janela sem célula e por grid vazio, situações normais que não merecem
   * registro.
   */
  aggregateForZoomWithOutcome,
} from './bookmap-aggregate.core.js';

/** Saída de `aggregateForZoomWithOutcome`: células, esgotamento e repetições. */
export type { AggregationOutcome } from './bookmap-aggregate.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Célula → pixel — `bookmap-pixels.core`
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `cellToPixels(cell, coords, geom, paint?) → DrawCell | null`.
 *
 * O quarto parâmetro é opcional e carrega os campos de cor já decididos pela
 * escala. Omitido, adota a célula mais fraca — errar para menos subestima a
 * liquidez, em vez de anunciar parede que ninguém mediu.
 */
export { cellToPixels } from './bookmap-pixels.core.js';

export type {
  /** Geometria da passada: duração do balde, fatores de agrupamento, viewport. */
  CellGeometry,
  /** Os campos de cor de `DrawCell`, declarados por `Pick` sobre o tipo canônico. */
  DrawCellPaint,
} from './bookmap-pixels.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Paredes — `bookmap-walls.core`
// ═════════════════════════════════════════════════════════════════════════════

export {
  /** `detectWalls(grid, precoAtual, opts) → DetectedWalls`. */
  detectWalls,
  /** Quantil que define o limiar de quantidade (requisito 6.1). */
  WALL_QUANTILE,
  /** Baldes consecutivos mínimos com fila em repouso (requisito 6.1). */
  WALL_MIN_BALDES_CONSECUTIVOS,
  /** Piso absoluto de quantidade: `opts.minQuantidade` só consegue elevá-lo. */
  WALL_MIN_QUANTIDADE_ABSOLUTO,
  /** Baldes por janela de tendência (requisito 6.5). */
  WALL_BALDES_TENDENCIA_DEFAULT,
  /** Paredes por grupo (requisito 6.2). */
  WALL_MAX_POR_LADO_DEFAULT,
  /** Banda morta do rótulo de tendência, em pontos percentuais (requisito 6.5). */
  WALL_HISTERESE_PCT,
  /** Fração da redução de fila que a execução precisa cobrir (requisito 6.7). */
  WALL_ABSORCAO_MIN_RATIO,
  /**
   * Sentinela de `variacaoPct` quando a janela anterior é nula.
   *
   * ⚠️ O card apresenta o **rótulo** de tendência, não este número: crescer a
   * partir de zero não tem razão finita, e o valor existe só para manter o campo
   * finito e ordenável.
   */
  WALL_VARIACAO_PCT_SEM_BASE,
} from './bookmap-walls.core.js';

export type {
  /** Parâmetros de qualificação e de tendência. */
  DetectWallsOptions,
  /** Os dois grupos do card: `acima` e `abaixo` do preço corrente. */
  DetectedWalls,
} from './bookmap-walls.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Cobertura — `bookmap-coverage.core`
// ═════════════════════════════════════════════════════════════════════════════

export {
  /**
   * `computeCoverageView(cobertura, opts) → CoverageView`.
   *
   * Deriva a classe **exclusivamente** do campo `classe` da resposta, nunca das
   * células desenhadas (requisito 7.8). Cobertura não verificada preserva o
   * desenho das células e declara a dúvida; só `VAZIA` suprime o desenho.
   */
  computeCoverageView,
  /**
   * Instante em epoch ms → `'HH:MM BRT'`, ou `null` quando não informado.
   *
   * ⚠️ Nenhuma aritmética de fuso acontece aqui: os limites de cobertura já são
   * epoch ms padrão e vão inteiros para o formatador.
   */
  formatCoverageClock,
} from './bookmap-coverage.core.js';

export type {
  /** O que a tela precisa saber sobre a cobertura do dia carregado. */
  CoverageView,
  /** Parâmetros de `computeCoverageView`: métrica e duração do balde. */
  CoverageViewOptions,
  /** Um intervalo a hachurar, fechado nos dois lados, com o motivo. */
  HachuraCobertura,
  /** Por que um intervalo do dia ficou sem execução capturada. */
  MotivoHachura,
  /** Horários de cobertura já em BRT, prontos para exibir. */
  RotulosCobertura,
  /** Métrica selecionada no painel — a mesma união de `BookmapLayerOptions`. */
  MetricaBookmap,
  /** As quatro classes de cobertura conhecidas. */
  ClasseCoberturaConhecida,
} from './bookmap-coverage.core.js';
