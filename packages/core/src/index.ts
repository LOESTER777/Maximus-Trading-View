/**
 * @robustus/charts-core — nucleos PUROS de visualizacao de mercado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE PACOTE E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A aritmetica da visualizacao, sem nenhuma tela. Recebe dado de mercado e
 * devolve numeros prontos para desenhar: celulas agregadas por zoom, opacidade
 * por percentil, retangulos em pixel, paredes de liquidez, perfil de volume,
 * formas de footprint, rotulos de cobertura.
 *
 * Nao ha canvas, DOM, `fetch`, relogio nem estado de modulo em lugar nenhum
 * daqui. A barreira e mecanica, nao documental: o `tsconfig` deste pacote
 * declara `lib` **sem DOM**, entao um `document` ou `fetch` acidental vira erro
 * de compilacao em vez de dependencia escondida descoberta em producao.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS GRAFIAS PARA A MESMA COISA, E POR QUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os nucleos vieram de um projeto de mesa brasileiro e tem identificadores em
 * portugues em varios pontos (`agregarFootprint`, `RAMPA_TERMICA`). Eles foram
 * copiados **verbatim** de proposito: junto com eles veio a suite de testes que
 * os prova, e renomear 500 KB de fonte destruiria justamente a rede de seguranca
 * que torna esta extracao verificavel.
 *
 * Entao este indice publica as DUAS grafias:
 *
 *  - a **original**, via `export *` — e o que os testes e as camadas internas
 *    usam, e continua sendo o nome canonico;
 *  - um **apelido em ingles** para cada ponto de entrada, na secao final — para
 *    que uma ferramenta de terceiro consuma a biblioteca sem precisar ler
 *    portugues.
 *
 * Os apelidos sao `export { x as y }`, ou seja custo zero em runtime e zero
 * duplicacao de logica: sao o MESMO simbolo com dois nomes.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Superficie do bookmap (heatmap por regiao de preco)
// ═════════════════════════════════════════════════════════════════════════════
//
// `bookmap-render.core` ja e um barrel curado e documentado export por export
// na origem — cobre tipos, decodificacao, escala de cor, agregacao por zoom,
// celula->pixel, paredes e cobertura. Reexportar ele em vez de refazer a curadoria
// preserva a documentacao que ja existe em cada simbolo.
export * from './bookmap-render.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// O que o barrel da origem nao cobria
// ═════════════════════════════════════════════════════════════════════════════
export * from './rampa-termica.core.js';
export * from './perfil-de-volume.core.js';
export * from './footprint-aggregate.core.js';
export * from './footprint-render.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Formatadores (adicionados na generalizacao)
// ═════════════════════════════════════════════════════════════════════════════
//
// Na origem o fuso `America/Sao_Paulo` e o locale `pt-BR` estavam cravados no
// corpo dos nucleos. Aqui sao injetaveis, com o comportamento da origem como
// default — ver o cabecalho de cada arquivo para o racional de por que o fuso
// virou parametro e o layout de data NAO virou.
export * from './instant-format.core.js';
export * from './number-format.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Apelidos em ingles — mesma implementacao, nome alternativo
// ═════════════════════════════════════════════════════════════════════════════

// ── Footprint: agregacao ────────────────────────────────────────────────────
export {
  /** Agrega execucoes em velas de footprint (preco x lado x volume). */
  agregarFootprint as aggregateFootprint,
  /** Arredonda um preco ao passo de agrupamento. */
  agruparPreco as groupPrice,
  /** Escolhe o passo de agrupamento de preco para o zoom corrente. */
  agrupamentoPorZoom as priceGroupingForZoom,
  /** Indice da vela que contem um instante, por busca nas fronteiras. */
  indiceDaVela as barIndexAt,
  /** Desequilibrios diagonais compra/venda entre niveis vizinhos. */
  desequilibriosDiagonais as diagonalImbalances,
  /** Resumo de uma linha do footprint, para rotulo e diagnostico. */
  resumirFootprint as summarizeFootprint,
  /** Configuracao default de agregacao de footprint. */
  CONFIG_FOOTPRINT_DEFAULT as FOOTPRINT_CONFIG_DEFAULT,
} from './footprint-aggregate.core.js';

export type {
  /** Uma vela de footprint: fronteiras temporais e niveis de preco. */
  VelaFootprint as FootprintBar,
  /** Um nivel de preco dentro de uma vela: volume de compra e de venda. */
  NivelFootprint as FootprintLevel,
  /** Parametros de agregacao de footprint. */
  ConfigFootprint as FootprintConfig,
} from './footprint-aggregate.core.js';

// ── Footprint: geometria de desenho ─────────────────────────────────────────
export {
  /** Formas (retangulo, linha, texto) de uma vela de footprint. */
  formasDaVela as footprintShapesForBar,
  /** Recorta as formas ao que cabe no orcamento e na area visivel. */
  formasVisiveis as visibleFootprintShapes,
  /** A vela e larga o bastante em pixel para admitir footprint legivel? */
  velaAdmiteFootprint as barAdmitsFootprint,
  /** Modo de exibicao efetivo, dado o pedido e o espaco disponivel. */
  modoEfetivo as effectiveFootprintMode,
  /** Abrevia numero grande para caber no rotulo (ex.: `1.2k`). */
  abreviar as abbreviateNumber,
  /** Texto da legenda do footprint. */
  textoDaLegendaFootprint as footprintLegendText,
  /** Largura minima de vela, em pixel, para footprint ser legivel. */
  LARGURA_MINIMA_VELA_PX as FOOTPRINT_MIN_BAR_WIDTH_PX,
  /** Opcoes default de exibicao de footprint. */
  OPCOES_FOOTPRINT_DEFAULT as FOOTPRINT_OPTIONS_DEFAULT,
  /** Paleta default do footprint. */
  PALETA_FOOTPRINT_DEFAULT as FOOTPRINT_PALETTE_DEFAULT,
} from './footprint-render.core.js';

export type {
  /** Modo de exibicao do footprint. */
  ModoFootprint as FootprintMode,
  /** Opcoes de exibicao do footprint. */
  OpcoesFootprint as FootprintOptions,
  /** Uma forma a desenhar: retangulo, linha ou texto. */
  FormaFootprint as FootprintShape,
  /** Paleta de cores do footprint. */
  PaletaFootprint as FootprintPalette,
  /** Conversores preco/tempo -> pixel que o desenho recebe. */
  Conversores as CoordinateConverters,
} from './footprint-render.core.js';

// ── Perfil de volume ───────────────────────────────────────────────────────
export {
  /** Agrega volume por nivel de preco (perfil / market profile). */
  agregarPerfilDeVolume as aggregateVolumeProfile,
  /** Reduz o perfil ao numero de linhas que cabe na tela. */
  binarizarPerfil as binVolumeProfile,
  /** Quais velas tem resolucao suficiente para leitura de footprint. */
  velasLegiveisParaFootprint as barsReadableAsFootprint,
  /** Linhas default do perfil. */
  LINHAS_PERFIL_PADRAO as VOLUME_PROFILE_ROWS_DEFAULT,
} from './perfil-de-volume.core.js';

export type {
  /** Um nivel do perfil: preco e volume acumulado. */
  NivelDoPerfil as VolumeProfileLevel,
  /** O perfil completo, com POC e area de valor. */
  PerfilDeVolume as VolumeProfile,
  /** Parametros de agregacao do perfil. */
  OpcoesDoPerfil as VolumeProfileOptions,
} from './perfil-de-volume.core.js';

// ── Rampa termica (escala de cor do heatmap) ────────────────────────────────
export {
  /** Cor da rampa termica em `t` ∈ [0,1], por interpolacao entre paradas. */
  corDaRampa as thermalRampColor,
  /** Constroi a paleta de 16 baldes `rgba()` usada pelo heatmap. */
  construirPaletaTermica as buildThermalPalette,
  /** Luminancia perceptual de uma cor — a metrica que a rampa preserva. */
  luminancia as luminance,
  /**
   * As paradas da rampa termica.
   *
   * ⚠️ A ordem tem uma invariante que NAO e estetica: a luminancia e
   * estritamente crescente (68 -> 80 -> 125 -> 177 -> 194 -> 246). A rampa
   * comercial de laranja/vermelho saturado foi rejeitada na origem justamente
   * por quebrar isso (amarelo L=181 seguido de laranja L=150), o que faz o olho
   * ler uma regiao mais quente como mais fria.
   */
  RAMPA_TERMICA as THERMAL_RAMP,
} from './rampa-termica.core.js';

export type {
  /** Uma parada da rampa: posicao e cor. */
  ParadaDaRampa as RampStop,
  /** Cor em componentes RGB. */
  CorRgb as RgbColor,
} from './rampa-termica.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Trilha de legendas — um canto, uma fila
// ═════════════════════════════════════════════════════════════════════════════

export {
  // As duas grafias, como manda a convencao do projeto: pt-BR (a original) e o apelido
  // em ingles. Mesmo simbolo, custo zero em runtime.
  enfileirarNotas,
  alturaEmLinhas,
  notasIguais,
  ORDEM_DA_TRILHA,
  /** Enfileira as notas na ordem canonica de leitura, descartando as vazias. */
  enfileirarNotas as queueLegendNotes,
  /** Quantas linhas a fila ocupa — a medida para reservar altura. */
  alturaEmLinhas as legendLineCount,
  /** As filas sao iguais por CONTEUDO? Evita re-renderizacao por quadro. */
  notasIguais as legendNotesEqual,
  /** A ordem canonica das fontes, de cima para baixo. */
  ORDEM_DA_TRILHA as LEGEND_RAIL_ORDER,
} from './legend-rail.core.js';
export type {
  NotaDeLegenda,
  FonteDeLegenda,
  /** Uma entrada da trilha: fonte, linhas em pt-BR, e se e ressalva. */
  NotaDeLegenda as LegendNote,
  /** Quem pode publicar na trilha. Conjunto fechado. */
  FonteDeLegenda as LegendSource,
} from './legend-rail.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Leitura do ativo — desempenho, sazonalidade e termometro tecnico
// ═════════════════════════════════════════════════════════════════════════════

export {
  desempenhoPorJanela,
  sazonalidadePorAno,
  // ⭐ A guarda de COBERTURA da sazonalidade, exportada de proposito: quem desenha (ou quem
  // gera relatorio, ou um robo) precisa da MESMA decisao. Duplicar a regra no desenho a faria
  // divergir no primeiro ajuste. Ver o defeito relatado no cabecalho da constante.
  sazonalidadeUtilizavel,
  DIAS_MINIMOS_DE_SAZONALIDADE,
  termometroTecnico,
  votoDeOscilador,
  votoDeMedia,
  JANELAS_DE_DESEMPENHO,
  ROTULO_DA_JANELA,
  ROTULO_TECNICO,
  /** Desempenho por janela de CALENDARIO. `null` quando a serie nao alcanca a janela. */
  desempenhoPorJanela as performanceByWindow,
  /** Retorno acumulado de cada ano, normalizado, num eixo de dia do ano. */
  sazonalidadePorAno as seasonalityByYear,
  sazonalidadeUtilizavel as seasonalityIsUsable,
  /** Resume votos de indicadores numa leitura. `NEUTRO` dilui; `null` nao conta. */
  termometroTecnico as technicalGauge,
} from './asset-readout.core.js';
export type {
  BarraDeLeitura as ReadoutBar,
  JanelaDeDesempenho as PerformanceWindow,
  DesempenhoDaJanela as WindowPerformance,
  PontoDeSazonalidade as SeasonalityPoint,
  AnoDeSazonalidade as SeasonalityYear,
  VotoTecnico as TechnicalVote,
  LeituraTecnica as TechnicalReading,
  TermometroTecnico as TechnicalGauge,
} from './asset-readout.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Comparar dois ativos — base 100 e correlacao de RETORNOS
// ═════════════════════════════════════════════════════════════════════════════

export {
  normalizarBase100,
  alinharPorTempo,
  correlacaoDeRetornos,
  leituraDeCorrelacao,
  MIN_AMOSTRAS_CORRELACAO,
  /** Reescala para base 100 na primeira barra — o que torna dois precos comparaveis. */
  normalizarBase100 as rebaseTo100,
  /** Pearson sobre RETORNOS (nunca sobre preco). `null` com amostra fraca. */
  correlacaoDeRetornos as returnsCorrelation,
} from './correlacao.core.js';
export type {
  BarraComparavel as ComparableBar,
  PontoNormalizado as RebasedPoint,
  ResultadoDeCorrelacao as CorrelationResult,
} from './correlacao.core.js';
