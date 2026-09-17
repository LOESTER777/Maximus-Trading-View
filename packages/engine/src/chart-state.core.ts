/**
 * chart-state.core — persistencia do ESTADO COMPLETO do grafico. PURA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE, E POR QUE E O QUE SEPARA "PECAS" DE "CLIENTE"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ate aqui so os DESENHOS sabiam se salvar (`@robustus/charts-drawings`
 * `serialize.core.ts`). Mas um operador que monta seu grafico escolhe muito mais
 * que desenhos: o tipo de serie (vela/linha/area/barra), quais indicadores
 * ligou e com quais parametros, os alertas que armou, e onde a janela estava.
 * Sem gravar isso, ele remonta tudo a cada sessao — e a diferenca pratica entre
 * uma biblioteca de PECAS e um CLIENTE de charting e exatamente essa memoria.
 *
 * Este nucleo descreve o estado inteiro como DADO serializavel, versionado, e o
 * le de volta com tolerancia. NAO toca no motor, no React nem no armazenamento:
 * e o consumidor quem lê do motor/hooks para montar o `SerializeChartInput`, e
 * quem decide onde o texto mora (localStorage, IndexedDB, servidor).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS TRES DISCIPLINAS HERDADAS DO SERIALIZE DE DESENHO (mesma razao)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Versao de esquema.** Estado salvo e dado do usuario; a primeira mudanca
 * de formato sem versao transforma layout salvo em lixo silencioso. Com versao,
 * documento antigo e migrado ou recusado com motivo.
 *
 * **2. Validacao na leitura.** O que volta do armazenamento e `unknown` — pode
 * ter sido editado a mao, truncado por cota, ou escrito por versao futura. Um
 * `period: NaN` num indicador viraria um indicador quebrado. Recusar na fronteira
 * e o que impede isso.
 *
 * **3. Recusa PARCIAL.** Um indicador corrompido nao pode invalidar o layout
 * inteiro. `deserializeChartState` descarta o item ruim, conta, e devolve o resto.
 *
 * ⚠️ O que este nucleo NAO faz: instanciar indicador, aplicar no motor, nem
 * validar se o `name` do indicador existe no registry — isso e do consumidor, que
 * tem o registry em maos. Aqui so gravamos `{name, params}` como dado. Manter
 * assim mantem o nucleo PURO e independente do pacote de indicadores.
 */

import type { PriceSeriesType } from './chart-engine.js';

// ═════════════════════════════════════════════════════════════════════════════
// ⚠️ POR QUE O DOCUMENTO DE DESENHO E OPACO AQUI
// ═════════════════════════════════════════════════════════════════════════════
//
// A regra 4 do projeto e dura: `engine` NAO importa `@robustus/charts-drawings`
// — desenho e opcional, e se o motor o importasse toda aplicacao pagaria o peso.
// Este nucleo vive no `engine`, entao NAO pode puxar o pacote de desenho.
//
// A saida: o documento de desenho entra e sai como DADO OPACO (`DrawingsDocumentLike`,
// um `unknown` estruturado). Quem tem os dois pacotes — a camada React em
// `useChartState` — serializa os desenhos com o proprio `serialize` do pacote de
// desenho ANTES de montar o input, e reconstroi com o `deserialize` dele DEPOIS
// de ler. Aqui so guardamos e devolvemos o bloco, sem validar seu interior (o
// pacote de desenho ja o valida na sua fronteira, com as tres disciplinas). Assim
// o estado completo persiste sem violar o grafo de dependencia.

/**
 * O documento de desenho, tratado como bloco opaco serializavel. E o que o
 * `serialize` do pacote de desenho devolve — um objeto JSON com `version` e
 * `drawings`. Nao o validamos aqui (o pacote de desenho o faz); so exigimos que
 * seja um objeto para nao gravar lixo no lugar dele.
 */
export type DrawingsDocumentLike = Readonly<Record<string, unknown>>;

// ═════════════════════════════════════════════════════════════════════════════
// Formato
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Versao do esquema do estado completo.
 *
 * Independente da versao do documento de DESENHO (que este documento embute):
 * cada um evolui no seu ritmo. Suba ao mudar o formato de forma incompativel e
 * acrescente a migracao em `migrate`. Nao suba por campo opcional novo.
 */
export const CHART_STATE_SCHEMA_VERSION = 1;

/** Um indicador salvo: o nome no registry e os parametros. Nada de instancia. */
export interface IndicatorState {
  /** Id estavel do plot no grafico (o mesmo usado no `useIndicators`). */
  readonly id: string;
  /** Nome no registry de indicadores (ex.: `'ema'`, `'rsi'`). */
  readonly name: string;
  /** Parametros do indicador (ex.: `{ period: 20 }`). So numero/string/boolean. */
  readonly params?: Readonly<Record<string, number | string | boolean>>;
  /**
   * O indicador esta visivel? Ausente = visivel.
   *
   * ⚠️ Campo OPCIONAL de proposito, e por isso a versao do esquema NAO subiu (ver a
   * nota em `CHART_STATE_SCHEMA_VERSION`): estado gravado antes deste campo le como
   * visivel, que e o comportamento antigo exato. Subir a versao transformaria todo
   * layout ja salvo em documento "de versao velha" sem nenhum ganho.
   *
   * Precisa ser persistido porque esconder o indicador e uma decisao de leitura, nao
   * um estado transitorio: o operador deixa a nuvem do Ichimoku desligada por semanas
   * e espera encontra-la assim — e, sem o campo, a alternativa dele e REMOVER o
   * indicador e perder os parametros.
   */
  readonly visible?: boolean;
  /**
   * Cores por chave de saida, como estao na tela (`IndicatorPlotter.colorsOf`).
   *
   * ⚠️ Grave o que o plotter reporta, nao o que voce pediu. Indicador que nasceu com
   * cor da PALETA nao tem cor pedida, e a paleta e por ordem de insercao — remover um
   * indicador do meio muda a ordem, e na sessao seguinte o mesmo indicador voltaria
   * com outra cor sem ninguem ter mudado nada.
   */
  readonly colors?: Readonly<Record<string, string>>;
}

/**
 * Um alerta salvo. A condicao e gravada como dado opaco (o formato vem do pacote
 * de alertas), validado apenas o suficiente para nao aceitar lixo.
 */
export interface AlertState {
  readonly key: string;
  /**
   * A condicao, como objeto serializavel (ex.: `{kind:'CROSS_ABOVE', level:130000}`).
   *
   * ⚠️ **O tipo exige apenas `kind`, de proposito, e isto NAO e frouxidao.**
   *
   * A tentativa natural — `Readonly<Record<string, unknown>>` — parece mais
   * precisa e na verdade **quebra o consumidor**: a `AlertCondition` do pacote de
   * alertas e uma uniao discriminada de interfaces NOMEADAS, e o TypeScript recusa
   * atribuir interface nomeada a um tipo com assinatura de indice (falta a
   * `[k: string]` nela). O type check do playground pegou exatamente isso —
   * `CrossAboveCondition is not assignable to Readonly<Record<string, unknown>>`.
   *
   * Exigir so `kind` aceita qualquer condicao do pacote de alertas sem cast no
   * consumidor, e e coerente com o papel deste nucleo: ele NAO interpreta a
   * condicao, so a carrega. Os demais campos (`level`, `min`, `max`, `percent`)
   * sobrevivem em runtime — o clone e por spread — e quem revalida o formato e o
   * pacote de alertas ao reconstruir o alerta.
   */
  readonly condition: { readonly kind: string };
  readonly mode?: 'once' | 'recurring';
}

/** A janela visivel, em espaco logico (indice de barra). `null` = deixar o motor decidir. */
export interface ViewportState {
  readonly from: number;
  readonly to: number;
}

/** O documento de estado completo do grafico. */
export interface ChartState {
  readonly version: number;
  /**
   * Identificacao do instrumento. Impede o erro de carregar o layout de um ativo
   * no grafico de outro. Quem carrega deve conferir.
   */
  readonly symbol?: string;
  /** Tipo da serie de preco. Default `'Candlestick'` na leitura, se ausente/invalido. */
  readonly priceSeriesType: PriceSeriesType;
  readonly indicators: readonly IndicatorState[];
  readonly alerts: readonly AlertState[];
  /** Desenhos, como bloco opaco (documento ja serializado pelo pacote de desenho). */
  readonly drawings: DrawingsDocumentLike;
  /** Janela visivel; ausente = o motor reenquadra. */
  readonly viewport?: ViewportState;
}

/** O que o consumidor junta do motor/hooks para gravar. */
export interface SerializeChartInput {
  readonly symbol?: string;
  readonly priceSeriesType: PriceSeriesType;
  readonly indicators: readonly IndicatorState[];
  readonly alerts: readonly AlertState[];
  /**
   * O documento de desenho JA SERIALIZADO pelo pacote de desenho (`serialize(...)`).
   * O consumidor o produz antes de chamar; aqui e bloco opaco. `undefined` grava
   * um documento de desenho vazio.
   */
  readonly drawings?: DrawingsDocumentLike;
  readonly viewport?: ViewportState;
}

/** Resultado da leitura, com contagem e motivos do que foi descartado. */
export interface DeserializeResult {
  readonly state: ChartState;
  /** Quantos itens (indicadores + alertas) foram descartados na validacao. */
  readonly rejected: number;
  /** Por que cada item caiu. Para log, nao para o operador. */
  readonly reasons: readonly string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// Escrita
// ═════════════════════════════════════════════════════════════════════════════

const PRICE_SERIES_TYPES = new Set<string>(['Candlestick', 'Line', 'Area', 'Bar']);
const ALERT_MODES = new Set<string>(['once', 'recurring']);

/**
 * Monta o documento de estado. Nao serializa para texto — devolve a estrutura, e
 * quem escolhe `JSON.stringify`/armazenamento e o chamador (mesma regra do
 * serialize de desenho).
 *
 * Copia por item para o documento nao compartilhar referencia com o estado vivo:
 * uma edicao posterior nao pode alterar o que ja foi "salvo".
 */
export function serializeChartState(input: SerializeChartInput): ChartState {
  return {
    version: CHART_STATE_SCHEMA_VERSION,
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    priceSeriesType: input.priceSeriesType,
    indicators: input.indicators.map(cloneIndicator),
    alerts: input.alerts.map(cloneAlert),
    // Bloco opaco: copia rasa para o documento nao compartilhar referencia com o
    // que o consumidor tem em maos. Ausente = documento de desenho vazio.
    drawings: input.drawings === undefined ? documentoDesenhoVazio() : { ...input.drawings },
    ...(input.viewport === undefined ? {} : { viewport: { ...input.viewport } }),
  };
}

function cloneIndicator(i: IndicatorState): IndicatorState {
  return {
    id: i.id,
    name: i.name,
    ...(i.params === undefined ? {} : { params: { ...i.params } }),
    // `visible` so e gravado quando FALSO. Gravar `true` em todo indicador seria ruido
    // em cada documento — e "ausente = visivel" ja e a leitura correta.
    ...(i.visible === false ? { visible: false } : {}),
    ...(i.colors === undefined ? {} : { colors: { ...i.colors } }),
  };
}

function cloneAlert(a: AlertState): AlertState {
  return {
    key: a.key,
    condition: { ...a.condition },
    ...(a.mode === undefined ? {} : { mode: a.mode }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Leitura
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Le um estado de origem nao confiavel. NUNCA lanca.
 *
 * Entrada irrecuperavel devolve estado vazio com o motivo; item invalido e
 * descartado (recusa parcial). O documento de desenho embutido e delegado ao
 * `deserialize` do proprio pacote de desenho, que ja aplica as mesmas tres
 * disciplinas — nao reimplementamos a validacao de desenho aqui.
 */
export function deserializeChartState(entrada: unknown): DeserializeResult {
  const motivos: string[] = [];

  if (entrada === null || typeof entrada !== 'object') {
    return vazio(['documento nao e objeto']);
  }
  const doc = entrada as Record<string, unknown>;

  const versao = doc.version;
  if (typeof versao !== 'number' || !Number.isInteger(versao)) {
    return vazio(['versao ausente ou nao inteira']);
  }
  if (versao > CHART_STATE_SCHEMA_VERSION) {
    // Documento do FUTURO: recusar. Carregar parcial faria o usuario perder o
    // que a versao nova acrescentou, e regravar por cima perpetuaria a perda.
    return vazio([`versao ${versao} e mais nova que a suportada (${CHART_STATE_SCHEMA_VERSION})`]);
  }

  const migrado = migrate(doc, versao, motivos);
  if (migrado === null) return vazio(motivos);

  // Tipo de serie: default Candlestick se ausente/invalido — e o tipo canonico.
  const pst =
    typeof migrado.priceSeriesType === 'string' && PRICE_SERIES_TYPES.has(migrado.priceSeriesType)
      ? (migrado.priceSeriesType as PriceSeriesType)
      : 'Candlestick';

  let rejeitados = 0;

  // ── Indicadores ──
  const indicadores: IndicatorState[] = [];
  const idsVistos = new Set<string>();
  if (Array.isArray(migrado.indicators)) {
    for (let i = 0; i < migrado.indicators.length; i++) {
      const parsed = parseIndicator(migrado.indicators[i], i, motivos);
      if (parsed === null) {
        rejeitados += 1;
        continue;
      }
      if (idsVistos.has(parsed.id)) {
        rejeitados += 1;
        motivos.push(`indicador ${i}: id repetido "${parsed.id}"`);
        continue;
      }
      idsVistos.add(parsed.id);
      indicadores.push(parsed);
    }
  } else if (migrado.indicators !== undefined) {
    motivos.push('campo `indicators` nao e lista');
  }

  // ── Alertas ──
  const alertas: AlertState[] = [];
  const chavesVistas = new Set<string>();
  if (Array.isArray(migrado.alerts)) {
    for (let i = 0; i < migrado.alerts.length; i++) {
      const parsed = parseAlert(migrado.alerts[i], i, motivos);
      if (parsed === null) {
        rejeitados += 1;
        continue;
      }
      if (chavesVistas.has(parsed.key)) {
        rejeitados += 1;
        motivos.push(`alerta ${i}: chave repetida "${parsed.key}"`);
        continue;
      }
      chavesVistas.add(parsed.key);
      alertas.push(parsed);
    }
  } else if (migrado.alerts !== undefined) {
    motivos.push('campo `alerts` nao e lista');
  }

  // ── Desenhos: guardamos o bloco OPACO como veio. A validacao das tres
  // disciplinas e do pacote de desenho, aplicada pelo consumidor ao reconstruir
  // com o `deserialize` dele (ver a nota do topo sobre a regra 4). Aqui so
  // garantimos que e um objeto; se nao for, gravamos um documento vazio. ──
  const desenho =
    migrado.drawings !== null && typeof migrado.drawings === 'object' && !Array.isArray(migrado.drawings)
      ? (migrado.drawings as DrawingsDocumentLike)
      : documentoDesenhoVazio();
  if (migrado.drawings !== undefined && (migrado.drawings === null || typeof migrado.drawings !== 'object')) {
    motivos.push('campo `drawings` nao e objeto — documento de desenho vazio adotado');
  }

  const symbol = typeof migrado.symbol === 'string' ? migrado.symbol : undefined;
  const viewport = parseViewport(migrado.viewport);

  return {
    state: {
      version: CHART_STATE_SCHEMA_VERSION,
      ...(symbol === undefined ? {} : { symbol }),
      priceSeriesType: pst,
      indicators: indicadores,
      alerts: alertas,
      drawings: desenho,
      ...(viewport === undefined ? {} : { viewport }),
    },
    rejected: rejeitados,
    reasons: motivos,
  };
}

/** Documento de desenho vazio, no formato que o pacote de desenho produz. */
function documentoDesenhoVazio(): DrawingsDocumentLike {
  // Espelha o `{ version: 1, drawings: [] }` do serialize de desenho. Nao
  // importamos a constante de la (regra 4); o pacote de desenho tolera este
  // documento vazio na leitura.
  return { version: 1, drawings: [] };
}

function vazio(motivos: readonly string[]): DeserializeResult {
  return {
    state: {
      version: CHART_STATE_SCHEMA_VERSION,
      priceSeriesType: 'Candlestick',
      indicators: [],
      alerts: [],
      drawings: documentoDesenhoVazio(),
    },
    rejected: 0,
    reasons: motivos.slice(),
  };
}

/**
 * Migra um estado antigo para o esquema corrente.
 *
 * Ha uma versao so hoje; a funcao existe agora para o lugar da migracao estar
 * obvio ANTES de alguem precisar dela.
 */
function migrate(
  doc: Record<string, unknown>,
  versao: number,
  _motivos: string[],
): Record<string, unknown> | null {
  if (versao === CHART_STATE_SCHEMA_VERSION) return doc;
  return null;
}

/** Valida um indicador salvo. `null` = descartar. */
function parseIndicator(bruto: unknown, indice: number, motivos: string[]): IndicatorState | null {
  if (bruto === null || typeof bruto !== 'object') {
    motivos.push(`indicador ${indice}: nao e objeto`);
    return null;
  }
  const v = bruto as Record<string, unknown>;

  const id = v.id;
  if (typeof id !== 'string' || id === '') {
    motivos.push(`indicador ${indice}: id ausente ou vazio`);
    return null;
  }
  const name = v.name;
  if (typeof name !== 'string' || name === '') {
    motivos.push(`indicador ${indice}: name ausente ou vazio`);
    return null;
  }

  // `visible` so vira `false` quando e EXATAMENTE `false`. Qualquer outro valor —
  // ausente, `0`, `'nao'`, `null` — le como visivel. Um documento editado a mao com
  // `visible: 0` esconder o indicador em silencio seria pior que ignorar o campo: o
  // operador veria um indicador na lista sem nada na tela e nao teria como saber por
  // que.
  const visible = v.visible === false ? { visible: false } : {};

  return { id, name, ...parseParams(v.params), ...visible, ...parseColors(v.colors) };
}

/**
 * Valida o mapa de cores: so aceita string nao vazia por chave.
 *
 * Nao validamos o FORMATO da cor (hex, rgb, nome CSS): quem consome e o canvas, que
 * ignora cor invalida sem lancar, e uma lista branca de formatos recusaria cor
 * legitima (`color-mix`, `oklch`) que o navegador aceita. O que barramos e o que nao
 * e cor nenhuma — numero, objeto, string vazia.
 */
function parseColors(bruto: unknown): { colors?: Record<string, string> } {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const out: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === 'string' && valor !== '') out[chave] = valor;
  }
  return Object.keys(out).length === 0 ? {} : { colors: out };
}

/**
 * Valida os parametros: so aceita numero FINITO, string e boolean. Um `NaN` que
 * passasse viraria um indicador com periodo invalido; um objeto aninhado nao e
 * parametro de indicador. Campo invalido e OMITIDO, nao rejeita o indicador
 * inteiro — cai no default do indicador na hora de instanciar.
 */
function parseParams(bruto: unknown): { params?: Record<string, number | string | boolean> } {
  if (bruto === null || typeof bruto !== 'object') return {};
  const v = bruto as Record<string, unknown>;
  const out: Record<string, number | string | boolean> = {};
  for (const [chave, valor] of Object.entries(v)) {
    if (typeof valor === 'number' && Number.isFinite(valor)) out[chave] = valor;
    else if (typeof valor === 'string') out[chave] = valor;
    else if (typeof valor === 'boolean') out[chave] = valor;
    // NaN, objeto, array, null: ignorados.
  }
  return Object.keys(out).length === 0 ? {} : { params: out };
}

/** Valida um alerta salvo. `null` = descartar. */
function parseAlert(bruto: unknown, indice: number, motivos: string[]): AlertState | null {
  if (bruto === null || typeof bruto !== 'object') {
    motivos.push(`alerta ${indice}: nao e objeto`);
    return null;
  }
  const v = bruto as Record<string, unknown>;

  const key = v.key;
  if (typeof key !== 'string' || key === '') {
    motivos.push(`alerta ${indice}: key ausente ou vazia`);
    return null;
  }

  const cond = v.condition;
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
    motivos.push(`alerta ${indice}: condition ausente ou nao e objeto`);
    return null;
  }
  // A condicao precisa ao menos de um `kind` string — sem isso o motor de alerta
  // nao sabe o que avaliar. O formato exato e validado pelo pacote de alertas na
  // hora de reconstruir; aqui so barramos o obviamente quebrado.
  const kind = (cond as Record<string, unknown>).kind;
  if (typeof kind !== 'string' || kind === '') {
    motivos.push(`alerta ${indice}: condition.kind ausente`);
    return null;
  }

  const mode =
    typeof v.mode === 'string' && ALERT_MODES.has(v.mode) ? (v.mode as 'once' | 'recurring') : undefined;

  // O `kind` acabou de ser validado como string nao vazia; os demais campos vao
  // como vieram (dado opaco — este nucleo nao interpreta condicao). O cast expressa
  // essa validacao ja feita, e nao um "confie em mim".
  const condicao = { ...(cond as Record<string, unknown>), kind } as { readonly kind: string };

  return {
    key,
    condition: condicao,
    ...(mode === undefined ? {} : { mode }),
  };
}

/** Valida o viewport: dois numeros finitos com `from <= to`. Ausente/invalido = undefined. */
function parseViewport(bruto: unknown): ViewportState | undefined {
  if (bruto === null || typeof bruto !== 'object') return undefined;
  const v = bruto as Record<string, unknown>;
  const from = v.from;
  const to = v.to;
  if (typeof from !== 'number' || typeof to !== 'number') return undefined;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  if (from > to) return undefined;
  return { from, to };
}
