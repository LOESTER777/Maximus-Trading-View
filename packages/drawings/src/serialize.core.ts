/**
 * serialize.core — persistencia dos desenhos. PURA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO NAO E `JSON.stringify` DIRETO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O modelo e JSON puro, entao `JSON.stringify(drawings)` "funciona". Ele funciona
 * hoje e falha depois, por tres motivos que valem o arquivo:
 *
 * **1. Versao de esquema.** Desenho e dado do USUARIO: ele traca uma linha e
 * espera encontra-la meses depois. Sem versao gravada, a primeira mudanca de
 * formato transforma documento salvo em lixo silencioso — carrega, nao reclama, e
 * desenha errado. Com versao, um documento antigo e ou migrado ou recusado com
 * motivo.
 *
 * **2. Validacao na leitura.** O que volta do armazenamento e `unknown`, sempre.
 * Pode ter sido editado a mao, truncado por cota, ou escrito por versao futura.
 * Um `NaN` que entra como preco vira coordenada `NaN`, e o canvas simplesmente
 * nao pinta — o desenho desaparece sem erro. Recusar o item invalido na fronteira
 * e o que impede isso.
 *
 * **3. Recusa PARCIAL.** Um desenho corrompido nao pode invalidar os outros 99.
 * `deserialize` descarta o item ruim, conta quantos descartou, e devolve o resto —
 * porque perder um desenho e ruim, e perder o documento inteiro e pior.
 *
 * ⚠️ O que NAO e serializado: selecao e historico. Selecao e estado de sessao, e
 * restaurar historico entre sessoes permitiria desfazer para um estado que o
 * usuario nao lembra de ter criado.
 */

import {
  ANCHORS_REQUIRED,
  isValidAnchor,
  type Anchor,
  type Drawing,
  type DrawingKind,
  type DrawingLineStyle,
  type DrawingStyle,
} from './model.js';

// ═════════════════════════════════════════════════════════════════════════════
// Formato
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Versao do esquema.
 *
 * Suba ao mudar o formato de forma incompativel, e acrescente a migracao em
 * `migrate`. Nao suba para acrescentar campo OPCIONAL — isso e compativel, e subir
 * sem necessidade obriga migracao inutil.
 */
export const DRAWINGS_SCHEMA_VERSION = 1;

/** O documento persistido. */
export interface DrawingsDocument {
  readonly version: number;
  /**
   * Identificacao do que o documento descreve.
   *
   * Existe para impedir o erro mais irritante possivel: carregar os desenhos de
   * WINV26 no grafico de WDOV26. Quem carrega deve conferir.
   */
  readonly symbol?: string;
  readonly drawings: readonly Drawing[];
}

/** Resultado da leitura. */
export interface DeserializeResult {
  readonly document: DrawingsDocument;
  /** Quantos itens foram descartados por nao passar na validacao. */
  readonly rejected: number;
  /** Por que cada item foi descartado. Para log, nao para o operador. */
  readonly reasons: readonly string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// Escrita
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Monta o documento.
 *
 * Nao serializa para texto: devolve a estrutura, e quem escolhe `JSON.stringify`,
 * `localStorage`, IndexedDB ou uma requisicao e o chamador. Uma biblioteca de
 * desenho nao deve decidir onde o dado do usuario mora.
 */
export function serialize(
  drawings: readonly Drawing[],
  symbol?: string,
): DrawingsDocument {
  return {
    version: DRAWINGS_SCHEMA_VERSION,
    ...(symbol === undefined ? {} : { symbol }),
    // Copia rasa por item: o documento nao deve compartilhar referencia com o
    // estado vivo, senao uma edicao posterior alteraria o que ja foi "salvo".
    drawings: drawings.map(cloneDrawing),
  };
}

function cloneDrawing(d: Drawing): Drawing {
  return {
    id: d.id,
    kind: d.kind,
    anchors: d.anchors.map((a) => ({ timeSec: a.timeSec, price: a.price })),
    ...(d.style === undefined ? {} : { style: { ...d.style } }),
    ...(d.locked === undefined ? {} : { locked: d.locked }),
    ...(d.hidden === undefined ? {} : { hidden: d.hidden }),
    ...(d.fibLevels === undefined ? {} : { fibLevels: d.fibLevels.slice() }),
    ...(d.rayDirection === undefined ? {} : { rayDirection: d.rayDirection }),
    // ⚠️⚠️ **DEFEITO REAL, e ele estava em produção.** `rMultiple` faltava aqui e em
    // `parseDrawing`. A copia e campo por campo (e nao por spread) de proposito — para nao
    // gravar propriedade desconhecida num documento versionado — e o preco dessa disciplina e
    // que campo novo esquecido e DESCARTADO EM SILENCIO.
    //
    // O sintoma: o operador ajustava a posicao para 3R, salvava o layout, recarregava, e a
    // posicao voltava com 2R. Nenhum erro, nenhum aviso — o alvo simplesmente estava no lugar
    // errado, o que numa ferramenta de risco-retorno e o pior defeito possivel.
    //
    // ⚠️ `createDrawing` no modelo tem um comentario avisando exatamente disto, e a persistencia
    // repetiu o erro de qualquer modo. Sao TRES lugares para cada campo novo: o tipo, a fabrica
    // e este par escrita/leitura. Ha teste de ida-e-volta por campo agora.
    ...(d.rMultiple === undefined ? {} : { rMultiple: d.rMultiple }),
    ...(d.channelWidthRatio === undefined ? {} : { channelWidthRatio: d.channelWidthRatio }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Leitura
// ═════════════════════════════════════════════════════════════════════════════

const KINDS_CONHECIDOS = new Set<string>(Object.keys(ANCHORS_REQUIRED));
const LINE_STYLES = new Set<string>(['SOLID', 'DASHED', 'DOTTED']);
const RAY_DIRECTIONS = new Set<string>(['FORWARD', 'BACKWARD']);

/**
 * Le um documento de origem nao confiavel.
 *
 * NUNCA lanca. Entrada irrecuperavel devolve documento vazio com o motivo — a
 * aplicacao mostra "nao foi possivel carregar" em vez de quebrar a tela.
 */
export function deserialize(entrada: unknown): DeserializeResult {
  const motivos: string[] = [];

  if (entrada === null || typeof entrada !== 'object') {
    return vazio(['documento nao e objeto']);
  }

  const doc = entrada as Record<string, unknown>;

  const versao = doc.version;
  if (typeof versao !== 'number' || !Number.isInteger(versao)) {
    return vazio(['versao ausente ou nao inteira']);
  }
  if (versao > DRAWINGS_SCHEMA_VERSION) {
    // Documento do FUTURO. Recusar e a resposta certa: carregar parcialmente
    // faria o usuario perder o que a versao nova acrescentou, e salvar de novo
    // gravaria a perda por cima do original.
    return vazio([
      `versao ${versao} e mais nova que a suportada (${DRAWINGS_SCHEMA_VERSION})`,
    ]);
  }

  const migrado = migrate(doc, versao, motivos);
  if (migrado === null) return vazio(motivos);

  const bruto = migrado.drawings;
  if (!Array.isArray(bruto)) return vazio([...motivos, 'campo `drawings` nao e lista']);

  const aceitos: Drawing[] = [];
  let rejeitados = 0;
  const vistos = new Set<string>();

  for (let i = 0; i < bruto.length; i++) {
    const d = parseDrawing(bruto[i], i, motivos);
    if (d === null) {
      rejeitados += 1;
      continue;
    }
    // Id repetido quebra hit-test, selecao e historico de formas confusas. O
    // primeiro ganha; o segundo e descartado com motivo.
    if (vistos.has(d.id)) {
      rejeitados += 1;
      motivos.push(`item ${i}: id repetido "${d.id}"`);
      continue;
    }
    vistos.add(d.id);
    aceitos.push(d);
  }

  const symbol = typeof migrado.symbol === 'string' ? migrado.symbol : undefined;

  return {
    document: {
      version: DRAWINGS_SCHEMA_VERSION,
      ...(symbol === undefined ? {} : { symbol }),
      drawings: aceitos,
    },
    rejected: rejeitados,
    reasons: motivos,
  };
}

function vazio(motivos: readonly string[]): DeserializeResult {
  return {
    document: { version: DRAWINGS_SCHEMA_VERSION, drawings: [] },
    rejected: 0,
    reasons: motivos.slice(),
  };
}

/**
 * Migra um documento antigo para o esquema corrente.
 *
 * Hoje ha uma versao so, então nada a fazer. A funcao existe agora, e nao quando
 * for preciso, porque o lugar da migracao tem de estar obvio ANTES de alguem
 * precisar dela — senao a primeira migracao vira um `if` solto no meio do parser.
 */
function migrate(
  doc: Record<string, unknown>,
  versao: number,
  _motivos: string[],
): Record<string, unknown> | null {
  if (versao === DRAWINGS_SCHEMA_VERSION) return doc;
  // Nenhuma versao anterior existiu ainda. Documento com versao menor e
  // desconhecida: recusa em vez de adivinhar.
  return null;
}

/** Valida e normaliza um desenho. `null` = descartar. */
function parseDrawing(bruto: unknown, indice: number, motivos: string[]): Drawing | null {
  if (bruto === null || typeof bruto !== 'object') {
    motivos.push(`item ${indice}: nao e objeto`);
    return null;
  }
  const v = bruto as Record<string, unknown>;

  const id = v.id;
  if (typeof id !== 'string' || id === '') {
    motivos.push(`item ${indice}: id ausente ou vazio`);
    return null;
  }

  const kind = v.kind;
  if (typeof kind !== 'string' || !KINDS_CONHECIDOS.has(kind)) {
    // Ferramenta desconhecida: pode ser de versao futura ou lixo. Descartar o
    // item e melhor que desenhar nada e melhor que quebrar o documento.
    motivos.push(`item ${indice}: ferramenta desconhecida "${String(kind)}"`);
    return null;
  }
  const tipo = kind as DrawingKind;

  const ancorasBrutas = v.anchors;
  if (!Array.isArray(ancorasBrutas)) {
    motivos.push(`item ${indice}: anchors nao e lista`);
    return null;
  }
  const ancoras: Anchor[] = [];
  for (const a of ancorasBrutas) {
    if (!isValidAnchor(a)) continue;
    ancoras.push({ timeSec: a.timeSec, price: a.price });
  }
  const exigidas = ANCHORS_REQUIRED[tipo];
  if (ancoras.length < exigidas) {
    motivos.push(`item ${indice}: ${ancoras.length} ancora(s) validas, exige ${exigidas}`);
    return null;
  }

  return {
    id,
    kind: tipo,
    anchors: ancoras,
    ...parseStyle(v.style),
    ...(typeof v.locked === 'boolean' ? { locked: v.locked } : {}),
    ...(typeof v.hidden === 'boolean' ? { hidden: v.hidden } : {}),
    ...parseFibLevels(v.fibLevels),
    ...(typeof v.rayDirection === 'string' && RAY_DIRECTIONS.has(v.rayDirection)
      ? { rayDirection: v.rayDirection as 'FORWARD' | 'BACKWARD' }
      : {}),
    // ⚠️ O outro lado do defeito documentado em `cloneDrawing`. Numero nao-finito e OMITIDO em
    // vez de rejeitar o desenho: cair no default (2R / 1x) e recuperavel com um ajuste; perder
    // a posicao inteira nao e. Mesma regra do estilo.
    ...numeroOpcional(v.rMultiple, 'rMultiple'),
    ...numeroOpcional(v.channelWidthRatio, 'channelWidthRatio'),
  };
}

/**
 * Um campo numerico opcional, validado.
 *
 * ⚠️ Sem recorte de faixa aqui de proposito. O recorte vive em `rMultipleOf` e
 * `channelWidthRatioOf`, que sao a fonte unica da regra; recortar tambem na leitura daria duas
 * verdades, e a divergencia apareceria como "o valor salvo nao e o valor lido".
 */
function numeroOpcional(bruto: unknown, campo: 'rMultiple' | 'channelWidthRatio'): Record<string, number> {
  if (typeof bruto !== 'number' || !Number.isFinite(bruto)) return {};
  return { [campo]: bruto };
}

/**
 * Valida estilo campo por campo.
 *
 * Campo invalido e OMITIDO, nao rejeita o desenho: perder a cor e aceitavel (cai
 * no default e o usuario reajusta), perder a linha de tendencia nao e.
 */
function parseStyle(bruto: unknown): { style?: DrawingStyle } {
  if (bruto === null || typeof bruto !== 'object') return {};
  const v = bruto as Record<string, unknown>;
  const s: Record<string, unknown> = {};

  if (typeof v.color === 'string') s.color = v.color;
  if (v.lineWidth === 1 || v.lineWidth === 2 || v.lineWidth === 3 || v.lineWidth === 4) {
    s.lineWidth = v.lineWidth;
  }
  if (typeof v.lineStyle === 'string' && LINE_STYLES.has(v.lineStyle)) {
    s.lineStyle = v.lineStyle as DrawingLineStyle;
  }
  if (typeof v.fill === 'string') s.fill = v.fill;
  if (typeof v.label === 'string') s.label = v.label;
  if (typeof v.showPriceLabel === 'boolean') s.showPriceLabel = v.showPriceLabel;

  return Object.keys(s).length === 0 ? {} : { style: s as DrawingStyle };
}

function parseFibLevels(bruto: unknown): { fibLevels?: readonly number[] } {
  if (!Array.isArray(bruto)) return {};
  const niveis = bruto.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return niveis.length === 0 ? {} : { fibLevels: niveis };
}
