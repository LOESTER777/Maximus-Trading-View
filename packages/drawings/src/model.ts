/**
 * model — o modelo de dados de desenho. PURO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DECISAO QUE GOVERNA TODO O PACOTE: ANCORA LOGICA, NUNCA PIXEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo ponto de desenho e `{ timeSec, price }`. Nao existe pixel em lugar nenhum
 * deste arquivo, e nao deve passar a existir.
 *
 * O motivo e a unica coisa que o usuario percebe sobre qualidade de ferramenta de
 * desenho: **a linha tem de continuar no mesmo lugar do GRAFICO**. Se a ancora
 * fosse em pixel, a linha andaria com o pan, mudaria de inclinacao com o zoom e
 * apontaria para outro preco ao trocar o periodo. Ancora logica e o que faz uma
 * resistencia tracada em M5 continuar sendo a mesma resistencia em H1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ARMADILHA QUE ISSO CRIA, E QUE QUASE TODA IMPLEMENTACAO ERRA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ancorar em tempo parece resolver tudo, mas o substrato tem um contrato cruel:
 *
 *     timeToCoordinate(time) -> null se o tempo NAO existe na escala
 *
 * Ou seja: uma linha tracada em M5 as 10:32:00 tem ancora num instante que **nao
 * e uma barra** em H1. `timeToCoordinate` devolve `null`, e a implementacao
 * ingenua conclui "fora de vista" e **nao desenha**. O usuario troca o periodo e
 * seus desenhos desaparecem.
 *
 * A conversao correta esta em `coordinates.ts` e passa por
 * `timeToIndex(time, findNearest=true)` seguido de `logicalToCoordinate(indice)`,
 * que trabalha em espaco logico CONTINUO e interpola entre barras.
 *
 * Registrado aqui, e nao so lá, porque quem le o modelo precisa saber que
 * `timeSec` nao e indice de barra: e instante, e a traducao e responsabilidade da
 * camada de coordenada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IMUTABILIDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo tipo aqui e `readonly`. Editar um desenho produz um objeto NOVO.
 *
 * Isso nao e preferencia de estilo: o historico de desfazer guarda referencias, e
 * mutacao no lugar corromperia estados passados silenciosamente — o usuario
 * desfaria e receberia de volta o estado ja alterado. Com imutabilidade, desfazer
 * e trocar um ponteiro.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Ancora
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um ponto no espaco do MERCADO: instante e preco.
 *
 * `timeSec` e epoch em SEGUNDOS (unidade do substrato de grafico). `price` e o
 * preco do instrumento, na mesma unidade das velas — nao normalizado, nao
 * percentual.
 */
export interface Anchor {
  readonly timeSec: number;
  readonly price: number;
}

/** Ancora utilizavel: os dois campos finitos. */
export function isValidAnchor(a: unknown): a is Anchor {
  if (a === null || typeof a !== 'object') return false;
  const v = a as Record<string, unknown>;
  return (
    typeof v.timeSec === 'number' &&
    Number.isFinite(v.timeSec) &&
    typeof v.price === 'number' &&
    Number.isFinite(v.price)
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tipos de desenho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As ferramentas admitidas.
 *
 * ── POR QUE ESTE CONJUNTO, E NAO 68 FERRAMENTAS ───────────────────────────
 *
 * Existem bibliotecas de terceiro com dezenas de ferramentas (Gann, forquilhas,
 * ciclos). Este conjunto cobre o que se usa de fato numa mesa, e cada item aqui
 * carrega um comportamento de edicao distinto — o que significa que a maquina de
 * estados e o hit-test sao exercitados por inteiro.
 *
 * Acrescentar ferramenta depois e barato: o custo esta na infraestrutura
 * (coordenada, hit-test, alca, historico, persistencia), e ela e comum. Comecar
 * com 68 ferramentas mal editaveis e o erro oposto.
 */
export type DrawingKind =
  /** Segmento entre dois pontos. */
  | 'TRENDLINE'
  /** Comeca em A, passa por B e segue ao infinito num sentido. */
  | 'RAY'
  /** Reta infinita nos dois sentidos, passando por A e B. */
  | 'EXTENDED_LINE'
  /** Preco constante, infinita no tempo. Um ponto basta. */
  | 'HORIZONTAL_LINE'
  /** Instante constante, infinita no preco. Um ponto basta. */
  | 'VERTICAL_LINE'
  /** Regiao entre dois cantos opostos. */
  | 'RECTANGLE'
  /** Retracao de Fibonacci entre dois pontos, com niveis horizontais. */
  | 'FIB_RETRACEMENT'
  /**
   * ⭐ Nivel horizontal que comeca em A e segue SO para a direita.
   *
   * Diferente de `HORIZONTAL_LINE`, que e infinita nos dois sentidos. A diferenca e de
   * LEITURA e importa numa mesa: um topo formado as 10h nao era resistencia as 9h. A linha
   * infinita afirma um nivel que valia antes de existir; o raio marca o nivel a partir do
   * momento em que o mercado o criou.
   */
  | 'HORIZONTAL_RAY'
  /**
   * ⭐ Seta de A para B: o segmento mais a ponta.
   *
   * ⚠️ A ponta e emitida como DOIS segmentos curtos pelo plano de desenho, e nao como uma
   * forma nova no renderizador. Assim ela herda cor, espessura, tracejado, acerto de
   * ponteiro e recorte de viewport sem uma linha de codigo nova em nenhuma dessas camadas —
   * e a seta fica acertavel pela ponta, que e onde o olho a procura.
   */
  | 'ARROW'
  /**
   * ⭐ Extensao de Fibonacci: os niveis ALEM do movimento, para projetar alvo.
   *
   * Mesma geometria da retracao; o que muda sao os niveis default (1,272 / 1,618 / 2,0 /
   * 2,618 em vez de 0,236..0,786). Sao ferramentas diferentes na cabeca do operador
   * (retracao mede onde a correcao para; extensao mede onde o movimento vai) e por isso sao
   * dois botoes — mas uma implementacao.
   */
  | 'FIB_EXTENSION'
  /**
   * ⭐⭐ POSICAO de compra: entrada, stop e alvo, com risco e retorno pintados.
   *
   * E a ferramenta que um operador de verdade usa mais que todas as outras juntas, porque e
   * a unica que responde a pergunta que precede a ordem: *quanto eu perco se eu estiver
   * errado, e quanto eu ganho se eu estiver certo*.
   *
   * ⚠️ **Ancora A e a ENTRADA, ancora B e o STOP.** O alvo e DERIVADO por multiplo de risco
   * (`rMultiple`, default 2). A alternativa era tres ancoras — entrada, stop e alvo
   * arrastaveis de forma independente — e ela foi rejeitada por dois motivos: o fluxo de
   * criacao da camada de gesto conhece uma ou duas ancoras (uma terceira exigiria um estado
   * de "meio criado" que sobrevive a soltar o botao, com todos os casos de cancelamento que
   * vem com isso), e porque o numero que o operador ajusta na pratica NAO e o alvo em
   * pontos: e o R:R. Derivar o alvo do multiplo mantem a razao explicita e sempre coerente —
   * arrastar o stop reposiciona o alvo, que e exatamente o que se quer.
   */
  | 'POSITION_LONG'
  /** ⭐⭐ POSICAO de venda. Espelho de `POSITION_LONG`: o stop fica ACIMA da entrada. */
  | 'POSITION_SHORT'
  /**
   * Regua: mede variacao de preco, de tempo e de barras entre dois pontos.
   *
   * Difere das outras por ser EFEMERA por natureza — normalmente se apaga ao
   * soltar. O modelo nao impede persistir; quem decide e a aplicacao.
   */
  | 'MEASURE';

/** Quantas ancoras cada ferramenta exige para estar completa. */
export const ANCHORS_REQUIRED: Readonly<Record<DrawingKind, 1 | 2>> = Object.freeze({
  TRENDLINE: 2,
  RAY: 2,
  EXTENDED_LINE: 2,
  HORIZONTAL_LINE: 1,
  VERTICAL_LINE: 1,
  RECTANGLE: 2,
  FIB_RETRACEMENT: 2,
  MEASURE: 2,
  HORIZONTAL_RAY: 2,
  ARROW: 2,
  FIB_EXTENSION: 2,
  // ⚠️ DUAS ancoras: entrada e stop. O alvo e derivado do multiplo de risco — ver
  // `POSITION_LONG` para por que tres ancoras foram rejeitadas.
  POSITION_LONG: 2,
  POSITION_SHORT: 2,
});

// ═════════════════════════════════════════════════════════════════════════════
// Estilo
// ═════════════════════════════════════════════════════════════════════════════

/** Tracejado do traco. Espelha a convencao do substrato. */
export type DrawingLineStyle = 'SOLID' | 'DASHED' | 'DOTTED';

/**
 * Aparencia de um desenho.
 *
 * Tudo opcional com default no render: um desenho recem-criado nao deve exigir
 * que a aplicacao escolha sete propriedades antes de aparecer na tela.
 */
export interface DrawingStyle {
  readonly color?: string;
  readonly lineWidth?: 1 | 2 | 3 | 4;
  readonly lineStyle?: DrawingLineStyle;
  /**
   * Preenchimento de regiao, em `rgba()` ou nome de cor.
   *
   * Vale para `RECTANGLE` e para as faixas de `FIB_RETRACEMENT`. Ausente = sem
   * preenchimento, so contorno.
   */
  readonly fill?: string;
  /** Rotulo junto ao desenho. */
  readonly label?: string;
  /** Mostrar o valor do preco no eixo. */
  readonly showPriceLabel?: boolean;
}

/**
 * Niveis default de Fibonacci.
 *
 * `0` e `1` incluidos de proposito: sao as extremidades do movimento, e sem elas
 * o usuario nao ve onde o traco comeca e termina.
 */
export const FIB_LEVELS_DEFAULT: readonly number[] = Object.freeze([
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1,
]);

/**
 * ⭐ Niveis default da EXTENSAO de Fibonacci: os alvos ALEM do movimento.
 *
 * `1` esta incluido porque e a referencia visual do fim do movimento medido — sem ele o
 * operador nao ve de onde as projecoes partem. Os quatro seguintes sao os alvos consagrados;
 * `2,618` e o ultimo porque acima disso a projecao deixa de ser leitura e passa a ser
 * esperanca.
 */
export const FIB_EXTENSION_LEVELS_DEFAULT: readonly number[] = Object.freeze([
  1, 1.272, 1.618, 2, 2.618,
]);

/**
 * ⭐ Multiplo de risco default das ferramentas de posicao: 2R.
 *
 * Nao e numero redondo por acaso — 2:1 e o piso que a maioria das mesas exige para uma
 * entrada ser considerada, porque com 40% de acerto ele ja e lucrativo. Nascer em 1:1 faria
 * a ferramenta sugerir um trade que precisa de mais de 50% de acerto para empatar.
 */
export const R_MULTIPLE_DEFAULT = 2;

// ═════════════════════════════════════════════════════════════════════════════
// O desenho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um desenho do usuario.
 *
 * `id` e opaco e estavel: e a chave do hit-test, da selecao, do historico e da
 * persistencia. Quem cria e a aplicacao ou `createDrawing`.
 */
export interface Drawing {
  readonly id: string;
  readonly kind: DrawingKind;
  /**
   * As ancoras, na ordem em que o usuario as colocou.
   *
   * A ORDEM importa e nao deve ser normalizada: em `FIB_RETRACEMENT`, trocar A por
   * B inverte a direcao da retracao, e um retangulo desenhado da direita para a
   * esquerda deve continuar reportando as ancoras como o usuario as pos — senao a
   * alca que ele arrasta pula para o outro canto.
   */
  readonly anchors: readonly Anchor[];
  readonly style?: DrawingStyle;
  /**
   * Bloqueado: visivel, mas nao selecionavel nem arrastavel.
   *
   * Existe porque nivel de referencia importante e justamente o que mais se
   * arrasta por acidente ao tentar dar pan no grafico.
   */
  readonly locked?: boolean;
  /** Oculto: nao desenha e nao participa do hit-test. */
  readonly hidden?: boolean;
  /**
   * ⭐ Multiplo de risco das ferramentas de POSICAO. Ausente usa `R_MULTIPLE_DEFAULT` (2).
   *
   * O alvo fica a `rMultiple` vezes a distancia entrada-stop, do lado do lucro. E o numero
   * que o operador ajusta de verdade — muito mais que o preco do alvo em pontos.
   *
   * ⚠️ Valor <= 0 nao e recusado no modelo (que e imutavel e sem validacao por desenho); o
   * plano de desenho o recorta. Zero produziria alvo IGUAL a entrada, e uma zona de lucro de
   * altura nula parece uma posicao sem retorno — o que e uma afirmacao, nao um erro de
   * digitacao.
   */
  readonly rMultiple?: number;
  /** Niveis de `FIB_RETRACEMENT` e `FIB_EXTENSION`. Ausente usa o default do tipo. */
  readonly fibLevels?: readonly number[];
  /**
   * Sentido do prolongamento de `RAY`.
   *
   * `'FORWARD'` (default) prolonga de A para B e adiante. `'BACKWARD'` prolonga
   * no sentido oposto.
   */
  readonly rayDirection?: 'FORWARD' | 'BACKWARD';
}

/**
 * Um desenho esta completo (tem ancoras suficientes para ser desenhado)?
 *
 * Desenho INCOMPLETO e estado normal, nao erro: e o que existe entre o primeiro
 * clique e o segundo. A camada de desenho mostra a previa; o hit-test o ignora.
 */
export function isComplete(d: Drawing): boolean {
  const exigidas = ANCHORS_REQUIRED[d.kind];
  if (exigidas === undefined) return false;
  if (d.anchors.length < exigidas) return false;
  for (let i = 0; i < exigidas; i++) {
    if (!isValidAnchor(d.anchors[i])) return false;
  }
  return true;
}

/** O desenho participa do hit-test? */
export function isInteractive(d: Drawing): boolean {
  return d.hidden !== true && d.locked !== true && isComplete(d);
}

/** O desenho deve ser pintado? */
export function isVisible(d: Drawing): boolean {
  return d.hidden !== true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Construcao e edicao — sempre devolvendo objeto novo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Gerador de id.
 *
 * Injetavel porque `crypto.randomUUID` nao existe em todo ambiente (e nao existe
 * em jsdom antigo), e porque teste deterministico precisa de sequencia previsivel.
 */
export type IdFactory = () => string;

/**
 * Gerador default: `crypto.randomUUID` quando houver, senao contador com prefixo.
 *
 * ⚠️ O caminho de contador NAO e criptografico e nao pretende ser. Id de desenho
 * so precisa ser unico dentro de um documento de grafico; se algum dia servir de
 * chave em sistema compartilhado, injete um gerador de verdade.
 */
export function createDefaultIdFactory(): IdFactory {
  let n = 0;
  return () => {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof c?.randomUUID === 'function') return c.randomUUID();
    n += 1;
    return `dwg-${Date.now().toString(36)}-${n.toString(36)}`;
  };
}

/** Parametros de `createDrawing`. */
export interface CreateDrawingParams {
  readonly kind: DrawingKind;
  readonly anchors: readonly Anchor[];
  readonly style?: DrawingStyle;
  readonly fibLevels?: readonly number[];
  readonly rayDirection?: 'FORWARD' | 'BACKWARD';
  /** Múltiplo de risco das ferramentas de posição. Ver `rMultipleOf`. */
  readonly rMultiple?: number;
  readonly id?: string;
}

/** Constroi um desenho, gerando id quando nao informado. */
export function createDrawing(p: CreateDrawingParams, ids: IdFactory): Drawing {
  return {
    id: p.id ?? ids(),
    kind: p.kind,
    anchors: p.anchors.slice(),
    ...(p.style === undefined ? {} : { style: p.style }),
    ...(p.fibLevels === undefined ? {} : { fibLevels: p.fibLevels.slice() }),
    ...(p.rayDirection === undefined ? {} : { rayDirection: p.rayDirection }),
    // ⚠️ **`rMultiple` faltava aqui, e o teste pegou.** A fábrica copia campo por campo (e
    // não por spread) de propósito — para não deixar entrar propriedade desconhecida num
    // modelo imutável que vai para o histórico de desfazer e para a persistência. O preço
    // dessa disciplina é este: campo novo no tipo que não é acrescentado aqui é DESCARTADO
    // EM SILÊNCIO. O sintoma era uma posição criada com `rMultiple: 3` desenhando 2R, sem
    // erro nenhum. Ao acrescentar campo ao `Drawing`, acrescente aqui também.
    ...(p.rMultiple === undefined ? {} : { rMultiple: p.rMultiple }),
  };
}

/**
 * Substitui uma ancora. Devolve objeto NOVO.
 *
 * Indice fora da faixa devolve o desenho inalterado, em vez de crescer o array
 * com buracos — arrastar a alca 5 de uma linha de 2 pontos e erro de quem chama,
 * e criar ancora `undefined` transformaria isso em desenho corrompido que so
 * falha na hora de pintar.
 */
export function withAnchor(d: Drawing, index: number, anchor: Anchor): Drawing {
  if (!Number.isInteger(index) || index < 0 || index >= d.anchors.length) return d;
  if (!isValidAnchor(anchor)) return d;
  const proximas = d.anchors.slice();
  proximas[index] = anchor;
  return { ...d, anchors: proximas };
}

/** Acrescenta uma ancora (usado enquanto o desenho esta sendo criado). */
export function withAppendedAnchor(d: Drawing, anchor: Anchor): Drawing {
  if (!isValidAnchor(anchor)) return d;
  return { ...d, anchors: [...d.anchors, anchor] };
}

/**
 * Desloca TODAS as ancoras — o arrasto do corpo do desenho.
 *
 * O deslocamento e em unidade LOGICA (segundos e preco), nao em pixel. Quem
 * converte o gesto do mouse em delta logico e o controlador; aqui a aritmetica
 * nao sabe que existe tela.
 */
export function withTranslation(d: Drawing, deltaTimeSec: number, deltaPrice: number): Drawing {
  if (!Number.isFinite(deltaTimeSec) || !Number.isFinite(deltaPrice)) return d;
  return {
    ...d,
    anchors: d.anchors.map((a) => ({
      timeSec: a.timeSec + deltaTimeSec,
      price: a.price + deltaPrice,
    })),
  };
}

/** Mescla estilo, preservando o que nao foi informado. */
export function withStyle(d: Drawing, style: DrawingStyle): Drawing {
  return { ...d, style: { ...d.style, ...style } };
}

/** Alterna o bloqueio. */
export function withLocked(d: Drawing, locked: boolean): Drawing {
  return { ...d, locked };
}

/** Alterna a visibilidade. */
export function withHidden(d: Drawing, hidden: boolean): Drawing {
  return { ...d, hidden };
}

/**
 * Os niveis efetivos de Fibonacci: os do desenho, ou o default DO TIPO.
 *
 * ⚠️ O default depende do `kind`: retracao usa 0..1, extensao usa 1..2,618. Um default unico
 * faria a extensao nascer mostrando retracao — a ferramenta errada com o nome certo.
 */
export function fibLevelsOf(d: Drawing): readonly number[] {
  const padrao =
    d.kind === 'FIB_EXTENSION' ? FIB_EXTENSION_LEVELS_DEFAULT : FIB_LEVELS_DEFAULT;
  const n = d.fibLevels;
  if (n === undefined || n.length === 0) return padrao;
  // Descarta nivel nao-finito em vez de propagar `NaN` para a geometria, onde ele
  // viraria coordenada `NaN` e uma linha que o canvas silenciosamente nao pinta.
  const limpos = n.filter((v) => Number.isFinite(v));
  return limpos.length === 0 ? padrao : limpos;
}

/**
 * O multiplo de risco efetivo de uma posicao.
 *
 * ⚠️ Recorta em `[0,1 .. 20]`. O piso existe porque zero (ou negativo) poria o alvo em cima
 * da entrada — ou do lado errado dela, o que pintaria a zona de lucro sobre a de risco e
 * inverteria a leitura da ferramenta. O teto e generoso de proposito: 20R e absurdo mas nao
 * e invalido, e recusar seria opinar sobre a estrategia de quem desenha.
 */
export function rMultipleOf(d: Drawing): number {
  const r = d.rMultiple;
  if (r === undefined || !Number.isFinite(r)) return R_MULTIPLE_DEFAULT;
  return Math.min(20, Math.max(0.1, r));
}
