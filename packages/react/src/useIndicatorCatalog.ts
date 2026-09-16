/**
 * useIndicatorCatalog — a caixa de ferramentas de indicadores, dirigida por METADADO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O playground tinha um `CATALOGO` escrito a mao: 14 entradas com `criar: () =>
 * emaFactory.create({ period: 20 })`. Consequencias medidas nele:
 *
 *  - **15 dos 29 indicadores eram inalcancaveis.** Quem quisesse CCI ou Ichimoku
 *    com outro periodo tinha de editar o codigo do app.
 *  - **Parametro era CONSTANTE.** `period: 20` estava no literal. Nao havia como
 *    trocar para 200 pela interface, e o layout salvo gravava `{ id, name }` SEM
 *    params — restaurar reconstruia com os parametros do literal, nao com os que
 *    o operador tinha escolhido (porque nao havia escolha).
 *  - **Um formulario por indicador nao escala.** 29 indicadores x N parametros
 *    seria uma parede de codigo que divergiria do calculo no primeiro ajuste.
 *
 * A saida e nao escrever catalogo nenhum: `IndicatorMeta` JA descreve `label`,
 * `category`, `params: ParamSpec[]` (com tipo, default, min, max, step) e
 * `outputs: OutputSpec[]` (com `pane`). Isso e suficiente para GERAR a interface
 * de propriedades. Indicador novo registrado aparece na caixa de ferramentas sem
 * uma linha de UI escrita.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ O REGISTRY E INJETADO — E ISSO NAO E CERIMONIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `@robustus/charts-react` **nao depende** de `@robustus/charts-indicators` (ver
 * `package.json`: as dependencias sao core, chart-core, datafeed, drawings,
 * engine, primitives, alerts, replay — indicators nao esta la). Importar aqui
 * criaria a dependencia e faria quem usa o grafico SEM indicador nenhum carregar
 * os 29 mesmo assim — a mesma regra 4 do projeto que mantem `engine` sem
 * `drawings`.
 *
 * Por isso o registry chega por parametro, e o contrato que este arquivo consome
 * e declarado por ESTRUTURA (`CatalogFactory` etc.), do mesmo jeito que o
 * `IndicatorPlotter` do engine declara `PlottableIndicator`. O consumidor passa
 * `registry` de `@robustus/charts-indicators` — ou o proprio, com indicadores
 * caseiros: a caixa de ferramentas funciona igual, porque ela le metadado, nao
 * nomes conhecidos.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  IndicatorPlot,
  IndicatorState,
  PlottableBar,
  PlottablePoint,
} from '@robustus/charts-engine';

// ═════════════════════════════════════════════════════════════════════════════
// O contrato de indicador, por ESTRUTURA (nao por import)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Valor de um parametro de indicador.
 *
 * ⚠️ `string` e proposital em vez do `PriceSource` real (`'close' | 'hlc3' | ...`):
 * amarrar a uniao fechada aqui obrigaria este pacote a conhecer o vocabulario do
 * pacote de indicadores, que e exatamente o que a injecao evita. A uniao continua
 * sendo respeitada onde importa — `sourceParam` do pacote de indicadores recusa
 * string invalida e cai no default, e `validate` reporta o erro.
 *
 * ⭐ Coincide com o tipo de `IndicatorState.params` (o formato PERSISTIDO), o que
 * torna a persistencia uma passagem direta, sem conversao que possa perder dado.
 */
export type CatalogParamValue = number | string | boolean;

/** Parametros de uma instancia, como este pacote os enxerga. */
export type CatalogParams = Readonly<Record<string, CatalogParamValue>>;

/**
 * Descricao de um parametro. Espelha `ParamSpec` do pacote de indicadores.
 *
 * ⭐ E deste descritor que a interface de propriedades e gerada: `type` escolhe o
 * controle (`number` -> input numerico com min/max/step; `source` -> select de
 * preco-fonte; `boolean` -> checkbox), `label` e o texto do `<label>`, `default`
 * e o valor de partida.
 */
export interface CatalogParamSpec {
  readonly name: string;
  readonly label: string;
  readonly type: 'number' | 'source' | 'boolean';
  readonly default: CatalogParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** Descricao de uma saida. Espelha `OutputSpec`. */
export interface CatalogOutputSpec {
  readonly key: string;
  readonly label: string;
  readonly plot: 'line' | 'histogram' | 'area' | 'band';
  readonly pane: 'price' | 'separate';
  readonly color?: string;
  readonly referenceLines?: readonly number[];
  readonly band?: 'upper' | 'lower' | 'middle';
}

/** Metadado de um indicador. Espelha `IndicatorMeta` (sem `warmup`/`dependencies`). */
export interface CatalogMeta {
  readonly name: string;
  readonly label: string;
  /**
   * Categoria, para agrupar o menu.
   *
   * ⚠️ `string`, e nao a uniao fechada `IndicatorCategory`. Categoria nova no
   * pacote de indicadores (ou num indicador caseiro do consumidor) tem de
   * aparecer no menu sem exigir alteracao aqui — uma uniao fechada faria o
   * indicador desaparecer da caixa de ferramentas em silencio.
   */
  readonly category: string;
  readonly params: readonly CatalogParamSpec[];
  readonly outputs: readonly CatalogOutputSpec[];
}

/**
 * Uma instancia de indicador, na forma minima que a plotagem exige.
 *
 * E de proposito um subconjunto de `IndicatorInstance`: `update`/`preview`/
 * `snapshot`/`reset` sao do ciclo ao vivo, e o `IndicatorPlotter` recalcula por
 * `warmup` sobre o historico corrente. Pedir menos aceita mais implementacoes.
 */
export interface CatalogInstance {
  readonly meta: CatalogMeta;
  warmup(history: readonly PlottableBar[]): readonly PlottablePoint[];
}

/** Resultado de validacao. Espelha `ParamValidation`. */
export interface CatalogValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Uma fabrica de indicador. Espelha `IndicatorFactory`.
 *
 * ⚠️ Os metodos usam sintaxe de METODO (`validate(...)`) e nao de propriedade
 * (`validate: (...) => ...`) de proposito: o TypeScript trata parametro de metodo
 * como bivariante, e e isso que permite passar o `registry` real
 * (`ReadonlyMap<string, IndicatorFactory>`, cujos parametros usam a uniao fechada
 * `PriceSource`) sem `as` no consumidor. Com sintaxe de propriedade e `strictFunctionTypes`,
 * a atribuicao seria recusada e o playground precisaria de cast.
 */
export interface CatalogFactory {
  readonly meta: CatalogMeta;
  validate(params: CatalogParams): CatalogValidation;
  create(params?: CatalogParams): CatalogInstance;
}

// ═════════════════════════════════════════════════════════════════════════════
// O estado de um indicador ATIVO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um indicador ativo na caixa de ferramentas.
 *
 * Imutavel por inteiro: toda operacao (`update`, `setColor`, `setVisible`) produz
 * objeto novo. E a mesma disciplina de `Drawing`/`DrawingsState` — aqui o motivo
 * e a memoizacao: `plots` compara conteudo, e mutacao no lugar passaria
 * despercebida e deixaria a tela dessincronizada do estado.
 */
export interface ActiveIndicator {
  /** Id estavel do plot. O MESMO que vai para `IndicatorState.id` no layout salvo. */
  readonly id: string;
  /** Nome no registry (ex.: `'ema'`). */
  readonly name: string;
  /** Parametros efetivos — sempre COMPLETOS (defaults do `ParamSpec` aplicados). */
  readonly params: CatalogParams;
  /** Cor por chave de saida. Ausente = paleta do plotter. */
  readonly colors?: Readonly<Record<string, string>>;
  /**
   * Se entra em `plots`.
   *
   * ⚠️ `false` **remove de `plots`** (o motor nao tem "esconder serie": a serie
   * existe ou nao existe) mas **mantem em `active`**, com params e cores. E o que
   * permite desligar um oscilador para olhar o preco limpo e religar sem
   * reconfigurar periodo e cor. Ver a nota sobre persistencia em `states`.
   */
  readonly visible: boolean;
}

/** Semente para criar um ativo: so o `name` e obrigatorio. */
export interface ActiveIndicatorInit {
  readonly name: string;
  /** Id desejado. Ausente ou em uso -> um id derivado do nome e gerado. */
  readonly id?: string;
  readonly params?: CatalogParams;
  readonly colors?: Readonly<Record<string, string>>;
  /** Default `true`. */
  readonly visible?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// Catalogo apresentavel
// ═════════════════════════════════════════════════════════════════════════════

/** Onde o indicador vive: sobre o preco, em sub-painel, ou nos dois. */
export type IndicatorPaneKind = 'price' | 'separate' | 'both';

/** Uma entrada do catalogo, pronta para montar menu e formulario. */
export interface CatalogEntry {
  readonly name: string;
  readonly label: string;
  readonly category: string;
  /** Rotulo pt-BR da categoria, ou a propria chave quando desconhecida. */
  readonly categoryLabel: string;
  readonly params: readonly CatalogParamSpec[];
  readonly outputs: readonly CatalogOutputSpec[];
  /** Derivado de `outputs[].pane` — o que a UI mostra como "Preço"/"Sub-painel". */
  readonly pane: IndicatorPaneKind;
}

/** Um grupo do menu de adicionar. */
export interface CatalogGroup {
  readonly category: string;
  readonly label: string;
  readonly entries: readonly CatalogEntry[];
}

/**
 * Rotulos pt-BR das categorias conhecidas.
 *
 * ⚠️ Um mapa com FALLBACK, nao uma uniao fechada: categoria desconhecida cai no
 * proprio nome dela e o indicador continua no menu. Um `switch` exaustivo faria o
 * indicador com categoria nova sumir da interface sem erro nenhum — o pior tipo
 * de falha, porque nao se manifesta.
 */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  trend: 'Tendência',
  momentum: 'Momento',
  oscillator: 'Oscilador',
  volatility: 'Volatilidade',
  volume: 'Volume',
};

/** Ordem de exibicao das categorias conhecidas. Desconhecidas vao ao fim, em ordem alfabetica. */
const ORDEM_CATEGORIAS: readonly string[] = [
  'trend',
  'momentum',
  'oscillator',
  'volatility',
  'volume',
];

// ═════════════════════════════════════════════════════════════════════════════
// Nucleos puros — testaveis sem montar componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Gera um id estavel a partir do nome, sem colidir com os ja tomados.
 *
 * ⚠️ **Sem contador de modulo.** Estado de modulo e proibido no projeto, e aqui
 * seria pior que estilo: dois graficos na mesma pagina compartilhariam o contador,
 * e o id de um dependeria da ordem de montagem do outro — o layout salvo de um
 * grafico deixaria de casar com o do outro sem ninguem mexer em nada. O sufixo
 * vem do conjunto ATIVO, entao a resposta e funcao apenas do estado visivel.
 *
 * `ema` -> `ema`; com `ema` tomado -> `ema-2`; e assim por diante.
 */
export function nextIndicatorId(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  // Comeca em 2 porque o primeiro e o nome nu: `ema`, `ema-2`, `ema-3`.
  for (let k = 2; k < taken.size + 3; k += 1) {
    const candidato = `${name}-${k}`;
    if (!taken.has(candidato)) return candidato;
  }
  // Inalcancavel: o laco cobre mais candidatos que o tamanho do conjunto. O
  // retorno existe para o tipo, nao para o fluxo.
  return `${name}-${taken.size + 3}`;
}

/**
 * Preenche os parametros ausentes com o default do `ParamSpec`.
 *
 * Os params de um ativo sao sempre COMPLETOS. O motivo e a interface: um input
 * controlado com `value={undefined}` vira campo nao controlado no meio do
 * caminho, e o React avisa em runtime enquanto o campo passa a ignorar o estado.
 * Completar na entrada faz o formulario ter sempre valor para mostrar.
 */
export function paramsWithDefaults(
  specs: readonly CatalogParamSpec[],
  params?: CatalogParams,
): CatalogParams {
  const saida: Record<string, CatalogParamValue> = {};
  for (const s of specs) saida[s.name] = s.default;
  if (params !== undefined) {
    // Somente chaves DECLARADAS: um param estranho vindo de layout antigo nao
    // entra, porque a fabrica o ignoraria e ele apareceria no formulario como
    // campo fantasma sem descritor.
    for (const s of specs) {
      const v = params[s.name];
      if (v !== undefined) saida[s.name] = v;
    }
  }
  return saida;
}

/** Deriva o painel de um indicador a partir das saidas. */
export function paneKindOf(outputs: readonly CatalogOutputSpec[]): IndicatorPaneKind {
  let temPreco = false;
  let temSeparado = false;
  for (const o of outputs) {
    if (o.pane === 'separate') temSeparado = true;
    else temPreco = true;
  }
  if (temPreco && temSeparado) return 'both';
  if (temSeparado) return 'separate';
  return 'price';
}

/**
 * Assinatura de conteudo de um ativo, para decidir se `plots` precisa mudar.
 *
 * ⚠️ Chaves ORDENADAS. `JSON.stringify` preserva a ordem de insercao, e
 * `{period:20, source:'close'}` produziria texto diferente de
 * `{source:'close', period:20}` — mesmo estado, assinatura diferente, series
 * recriadas de graca. Editar um param reinsere a chave e mudaria a ordem.
 */
function assinatura(a: ActiveIndicator): string {
  return [
    a.id,
    a.name,
    a.visible ? '1' : '0',
    serializarOrdenado(a.params),
    a.colors === undefined ? '' : serializarOrdenado(a.colors),
  ].join('\u0001');
}

function serializarOrdenado(obj: Readonly<Record<string, CatalogParamValue>>): string {
  const chaves = Object.keys(obj).sort();
  return chaves.map((k) => `${k}=${String(obj[k])}`).join(',');
}

/** Assinatura do CONJUNTO. Muda exatamente quando `plots` deve mudar de identidade. */
export function plotsSignature(active: readonly ActiveIndicator[]): string {
  return active.map(assinatura).join('\u0002');
}

// ═════════════════════════════════════════════════════════════════════════════
// Resultados de operacao — falha e valor de retorno, nunca excecao
// ═════════════════════════════════════════════════════════════════════════════

/** Resultado de `update`. */
export interface ParamUpdateResult {
  /** `true` = os params novos entraram no estado. */
  readonly applied: boolean;
  /** Mensagens da fabrica quando `applied` e `false`. Vazio quando aplicou. */
  readonly errors: readonly string[];
}

/** Resultado de `load`. */
export interface CatalogLoadResult {
  readonly accepted: readonly ActiveIndicator[];
  /** Nomes recusados por nao existirem no registry. */
  readonly rejected: readonly string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// O hook
// ═════════════════════════════════════════════════════════════════════════════

export interface UseIndicatorCatalogParams {
  /**
   * O registry nome -> fabrica. INJETADO — ver o cabecalho.
   *
   * Tipicamente `registry` de `@robustus/charts-indicators`. Pode ser um Map
   * proprio, com indicadores caseiros ou um subconjunto curado dos 29.
   */
  readonly registry: ReadonlyMap<string, CatalogFactory>;
  /**
   * Indicadores iniciais.
   *
   * ⚠️ Lido UMA vez, na primeira renderizacao (inicializador tardio do
   * `useState`). Mudar depois nao tem efeito, de proposito: um array literal em
   * JSX tem identidade nova a cada render e reaplicar zeraria as edicoes do
   * operador a cada quadro. Para trocar o conjunto depois, use `load`.
   */
  readonly initial?: readonly ActiveIndicatorInit[];
}

export interface UseIndicatorCatalogResult {
  /** Todos os ativos, inclusive os invisiveis. Ordem de insercao. */
  readonly active: readonly ActiveIndicator[];
  /**
   * Pronto para `useIndicators({ plots })`. Contem so os VISIVEIS.
   *
   * ⭐ Memoizado por CONTEUDO: a identidade muda quando conjunto, params, cores
   * ou visibilidade mudam, e **nao** muda quando um `setState` produz o mesmo
   * conteudo. Isso importa porque `useIndicators` chama `setPlots`, que recria
   * TODAS as series e panes — identidade nova a cada render piscaria a tela.
   */
  readonly plots: readonly IndicatorPlot[];
  /** O catalogo inteiro do registry, ordenado por categoria e rotulo. */
  readonly catalog: readonly CatalogEntry[];
  /** O mesmo catalogo, agrupado por categoria — para `<optgroup>` ou menu. */
  readonly groups: readonly CatalogGroup[];
  /**
   * Adiciona um indicador. Devolve o id gerado, ou `null` quando o nome nao
   * existe no registry.
   *
   * ⚠️ `null` significa **"não sei quem é esse indicador"** — nada foi
   * adicionado. Nunca uma string vazia: id vazio seria aceito pelo plotter e
   * produziria um plot anonimo impossivel de remover pela interface.
   */
  readonly add: (name: string, params?: CatalogParams) => string | null;
  readonly remove: (id: string) => void;
  /**
   * Altera parametros. Patch parcial: chaves ausentes ficam como estao.
   *
   * Recusa o patch inteiro quando a fabrica reprova (periodo negativo, NaN), e
   * devolve os motivos. Recusar e melhor que clampar em silencio: o operador que
   * digitou `-5` precisa saber que o indicador continua em 14.
   */
  readonly update: (id: string, patch: CatalogParams) => ParamUpdateResult;
  readonly setVisible: (id: string, visible: boolean) => void;
  readonly setColor: (id: string, outputKey: string, color: string) => void;
  /**
   * Substitui o conjunto ativo — para restaurar layout salvo.
   *
   * Nome desconhecido e DESCARTADO e reportado em `rejected` (recusa parcial, a
   * mesma disciplina do `deserializeChartState`): um layout de uma versao com
   * outro registry carrega o que existe em vez de falhar inteiro.
   */
  readonly load: (states: readonly ActiveIndicatorInit[]) => CatalogLoadResult;
  /**
   * Os ativos no formato PERSISTIDO (`IndicatorState[]`), memoizado.
   *
   * ⚠️ **So os visiveis.** `IndicatorState` (esquema versao 1) nao tem campo de
   * visibilidade, e inventar um em `params` colidiria com o espaco de nomes dos
   * parametros do proprio indicador (um `visible` de indicador futuro seria
   * sobrescrito). Consequencia aceita e documentada: indicador desligado nao
   * sobrevive ao salvar/restaurar. Persistir visibilidade exige subir o esquema
   * do `chart-state.core.ts`, que e do pacote `engine`.
   */
  readonly states: readonly IndicatorState[];
  /** A entrada de catalogo de um nome, ou `null` se o nome nao existe. */
  readonly entryOf: (name: string) => CatalogEntry | null;
}

/**
 * Gerencia os indicadores ativos de um grafico, dirigido pelos metadados do
 * registry.
 *
 * @example
 * import { registry } from '@robustus/charts-indicators';
 *
 * const cat = useIndicatorCatalog({ registry, initial: [{ name: 'ema' }, { name: 'rsi' }] });
 * useIndicators({ engine, plots: cat.plots, bars: velas });
 * return <IndicatorToolbox catalog={cat} />;
 */
export function useIndicatorCatalog(
  params: UseIndicatorCatalogParams,
): UseIndicatorCatalogResult {
  const { registry } = params;

  // O registry vive num ref porque as callbacks (`add`, `update`, ...) precisam
  // dele sem virar dependencia: um Map literal no consumidor teria identidade
  // nova a cada render e trocaria a identidade de toda callback, o que anularia a
  // memoizacao de quem as recebe por prop.
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const [active, setActive] = useState<readonly ActiveIndicator[]>(() =>
    construirIniciais(params.initial ?? [], registry),
  );

  // `active` num ref para as callbacks lerem o valor corrente sem depender dele
  // (o que trocaria a identidade de toda callback a cada edicao, e propagaria
  // re-render para todo componente memoizado que as recebe por prop).
  const activeRef = useRef(active);
  activeRef.current = active;

  // ── Catalogo apresentavel ────────────────────────────────────────────────
  const catalog = useMemo(() => construirCatalogo(registry), [registry]);
  const groups = useMemo(() => agruparCatalogo(catalog), [catalog]);

  // ── Instancias, em cache por (id + params) ───────────────────────────────
  //
  // ⭐ A instancia e RECRIADA quando um parametro muda, e reusada quando nao
  // muda. Nao ha escolha: o periodo e lido na CONSTRUCAO (`numParam` no
  // construtor da fabrica) e vive no estado rolante — nao existe `setPeriod`, e
  // nem deveria: mudar o periodo de um estado rolante pela metade produziria uma
  // serie que nao corresponde a nenhum periodo. A chave do cache carrega os
  // params exatamente por isso.
  const cacheRef = useRef<Map<string, CatalogInstance>>(new Map());

  const signature = useMemo(() => plotsSignature(active), [active]);

  const plots = useMemo(
    () => construirPlots(active, registryRef.current, cacheRef.current),
    // A assinatura de CONTEUDO e a dependencia, nao `active`: dois estados com o
    // mesmo conteudo (arrastar o seletor de cor devolvendo a mesma cor, redigitar
    // o mesmo periodo) nao devem recriar serie nenhuma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const states = useMemo<readonly IndicatorState[]>(
    () =>
      active
        .filter((a) => a.visible)
        .map((a) => ({ id: a.id, name: a.name, params: a.params })),
    [active],
  );

  // ── Operacoes ────────────────────────────────────────────────────────────

  const add = useCallback((name: string, paramsIniciais?: CatalogParams): string | null => {
    const factory = registryRef.current.get(name);
    if (factory === undefined) return null;
    const id = nextIndicatorId(name, new Set(activeRef.current.map((a) => a.id)));
    const novo: ActiveIndicator = {
      id,
      name,
      params: paramsWithDefaults(factory.meta.params, paramsIniciais),
      visible: true,
    };
    setActive((atual) => [...atual, novo]);
    return id;
  }, []);

  const remove = useCallback((id: string): void => {
    setActive((atual) => atual.filter((a) => a.id !== id));
  }, []);

  const update = useCallback((id: string, patch: CatalogParams): ParamUpdateResult => {
    const alvo = activeRef.current.find((a) => a.id === id);
    if (alvo === undefined) return { applied: false, errors: [`indicador ${id} nao esta ativo`] };
    const factory = registryRef.current.get(alvo.name);
    if (factory === undefined) {
      return { applied: false, errors: [`indicador ${alvo.name} nao esta no registry`] };
    }

    const candidato = paramsWithDefaults(factory.meta.params, { ...alvo.params, ...patch });
    const v = factory.validate(candidato);
    if (!v.valid) return { applied: false, errors: v.errors };

    setActive((atual) =>
      atual.map((a) => (a.id === id ? { ...a, params: candidato } : a)),
    );
    return { applied: true, errors: [] };
  }, []);

  const setVisible = useCallback((id: string, visible: boolean): void => {
    setActive((atual) => atual.map((a) => (a.id === id ? { ...a, visible } : a)));
  }, []);

  const setColor = useCallback((id: string, outputKey: string, color: string): void => {
    setActive((atual) =>
      atual.map((a) =>
        a.id === id ? { ...a, colors: { ...(a.colors ?? {}), [outputKey]: color } } : a,
      ),
    );
  }, []);

  const load = useCallback((entrada: readonly ActiveIndicatorInit[]): CatalogLoadResult => {
    const reg = registryRef.current;
    const rejected: string[] = [];
    const accepted: ActiveIndicator[] = [];
    const tomados = new Set<string>();
    for (const item of entrada) {
      const factory = reg.get(item.name);
      if (factory === undefined) {
        rejected.push(item.name);
        continue;
      }
      // Id pedido, se livre; senao derivado do nome. Layout com id duplicado nao
      // pode sobrescrever plot: o plotter casa serie por id e um id repetido
      // deixaria uma das series orfa de dado.
      const id =
        item.id !== undefined && item.id !== '' && !tomados.has(item.id)
          ? item.id
          : nextIndicatorId(item.name, tomados);
      tomados.add(id);
      accepted.push({
        id,
        name: item.name,
        params: paramsWithDefaults(factory.meta.params, item.params),
        ...(item.colors === undefined ? {} : { colors: item.colors }),
        visible: item.visible ?? true,
      });
    }
    setActive(accepted);
    return { accepted, rejected };
  }, []);

  const entryOf = useCallback(
    (name: string): CatalogEntry | null => catalog.find((e) => e.name === name) ?? null,
    [catalog],
  );

  return {
    active,
    plots,
    catalog,
    groups,
    add,
    remove,
    update,
    setVisible,
    setColor,
    load,
    states,
    entryOf,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Internos
// ═════════════════════════════════════════════════════════════════════════════

function construirIniciais(
  iniciais: readonly ActiveIndicatorInit[],
  registry: ReadonlyMap<string, CatalogFactory>,
): readonly ActiveIndicator[] {
  const saida: ActiveIndicator[] = [];
  const tomados = new Set<string>();
  for (const item of iniciais) {
    const factory = registry.get(item.name);
    if (factory === undefined) continue; // nome desconhecido: nao entra
    const id =
      item.id !== undefined && item.id !== '' && !tomados.has(item.id)
        ? item.id
        : nextIndicatorId(item.name, tomados);
    tomados.add(id);
    saida.push({
      id,
      name: item.name,
      params: paramsWithDefaults(factory.meta.params, item.params),
      ...(item.colors === undefined ? {} : { colors: item.colors }),
      visible: item.visible ?? true,
    });
  }
  return saida;
}

function construirCatalogo(
  registry: ReadonlyMap<string, CatalogFactory>,
): readonly CatalogEntry[] {
  const entradas: CatalogEntry[] = [];
  for (const factory of registry.values()) {
    const m = factory.meta;
    entradas.push({
      name: m.name,
      label: m.label,
      category: m.category,
      categoryLabel: CATEGORY_LABELS[m.category] ?? m.category,
      params: m.params,
      outputs: m.outputs,
      pane: paneKindOf(m.outputs),
    });
  }
  // Ordena por posicao da categoria, depois por rotulo. `localeCompare` com
  // 'pt-BR' porque rotulo acentuado ordenado por code point coloca "Média" depois
  // de "Volume".
  entradas.sort((a, b) => {
    const pa = posicaoCategoria(a.category);
    const pb = posicaoCategoria(b.category);
    if (pa !== pb) return pa - pb;
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'pt-BR');
    return a.label.localeCompare(b.label, 'pt-BR');
  });
  return entradas;
}

function posicaoCategoria(categoria: string): number {
  const i = ORDEM_CATEGORIAS.indexOf(categoria);
  // Categoria desconhecida vai ao fim, nao ao inicio: o menu conhecido nao se
  // reordena porque alguem registrou um indicador com categoria nova.
  return i === -1 ? ORDEM_CATEGORIAS.length : i;
}

/**
 * Agrupa por categoria APROVEITANDO a ordenacao previa do catalogo.
 *
 * Como `construirCatalogo` ja ordenou por categoria, entradas da mesma categoria
 * sao contiguas e uma passada basta. Um `Map` aqui funcionaria igual, mas
 * reintroduziria a duvida de qual ordem os grupos saem — a passada linear herda a
 * ordem da lista, que e a fonte unica.
 */
function agruparCatalogo(catalog: readonly CatalogEntry[]): readonly CatalogGroup[] {
  const grupos: CatalogGroup[] = [];
  let atual: CatalogEntry[] = [];
  let categoriaAtual: string | null = null;

  const fechar = (): void => {
    if (categoriaAtual === null || atual.length === 0) return;
    grupos.push({
      category: categoriaAtual,
      label: CATEGORY_LABELS[categoriaAtual] ?? categoriaAtual,
      entries: atual,
    });
  };

  for (const e of catalog) {
    if (e.category !== categoriaAtual) {
      fechar();
      categoriaAtual = e.category;
      atual = [];
    }
    atual.push(e);
  }
  fechar();
  return grupos;
}

/**
 * Monta a lista de plots, reusando instancias cujo (id + params) nao mudou.
 *
 * ⚠️ Envolve `create` em `try`: a fabrica NAO deve lancar (o contrato diz que
 * `validate` nunca lanca e `create` cai nos defaults), mas uma fabrica de
 * terceiro injetada pelo consumidor pode. Excecao aqui subiria durante a
 * renderizacao do painel e derrubaria a arvore inteira — a mesma razao pela qual
 * a camada de visualizacao envolve `draw()`.
 */
function construirPlots(
  active: readonly ActiveIndicator[],
  registry: ReadonlyMap<string, CatalogFactory>,
  cache: Map<string, CatalogInstance>,
): readonly IndicatorPlot[] {
  const plots: IndicatorPlot[] = [];
  const usadas = new Set<string>();

  for (const a of active) {
    if (!a.visible) continue;
    const factory = registry.get(a.name);
    if (factory === undefined) continue;

    const chave = `${a.id}\u0001${serializarOrdenado(a.params)}`;
    usadas.add(chave);

    let inst = cache.get(chave);
    if (inst === undefined) {
      try {
        inst = factory.create(a.params);
      } catch {
        continue; // fabrica quebrada: o indicador nao plota, o grafico segue
      }
      cache.set(chave, inst);
    }

    plots.push({
      id: a.id,
      instance: inst,
      ...(a.colors === undefined ? {} : { colors: a.colors }),
    });
  }

  // Descarta instancias que ninguem mais usa. Sem isto o cache cresceria a cada
  // edicao de parametro — 40 ajustes de periodo deixariam 40 instancias vivas,
  // cada uma com o estado rolante da serie inteira.
  for (const chave of [...cache.keys()]) {
    if (!usadas.has(chave)) cache.delete(chave);
  }

  return plots;
}
