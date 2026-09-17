/**
 * ChartToolbar — a barra HORIZONTAL, agrupada por PROPOSITO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ A SEPARACAO QUE EVITA A PAREDE DE BOTOES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido foi "separacao do que e grafico e do que e e para que". A leitura que
 * este arquivo implementa: separar **o que MUDA O DESENHO** do preco do que
 * **ACRESCENTA ANALISE** sobre ele. Sao quatro naturezas, e cada uma e um
 * `role="group"` com nome proprio:
 *
 *  1. **Desenho do gráfico** — como o preco e RASTERIZADO (vela, barra, linha,
 *     area, Heikin-Ashi, Renko). Escolha UNICA: nunca duas rasterizacoes juntas.
 *     Por isso e um `SegmentedControl` (`radiogroup`), nao botoes soltos.
 *  2. **Camadas de análise** — o que e SOBREPOSTO ao preco (bookmap, footprint,
 *     indicadores, alertas). Escolha MULTIPLA e independente: cada uma liga e
 *     desliga sozinha, entao sao botoes com `aria-pressed`.
 *  3. **Ambiente do gráfico** — o que e cenario e nao dado (grade, marca d'agua,
 *     mira). Tambem alternavel, mas separado das camadas de proposito: ligar a
 *     grade nao acrescenta informacao de mercado nenhuma, e misturar as duas
 *     coisas no mesmo grupo e exatamente o que produz a parede de botoes sem
 *     significado.
 *  4. **Ações** — o que ACONTECE UMA VEZ e nao tem estado (exportar imagem,
 *     salvar layout, restaurar). Botao comum, sem `aria-pressed`: anunciar estado
 *     de pressao numa acao pontual diria ao leitor de tela que "exportar" fica
 *     ligado.
 *
 * ⚠️ **O outro erro que essa separacao evita:** um grupo unico obrigaria um unico
 * criterio de colapso. Com quatro grupos, o colapso remove o MENOS essencial
 * primeiro (acoes, depois ambiente, depois camadas) e o desenho do preco — sem o
 * qual a barra nao serve para nada — nunca sai da tela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ RESPONSIVO SEM MEDIA QUERY — e o LOOP que a implementacao ingenua cria
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `@media` mede a JANELA. Uma barra de biblioteca nao vive na janela: ela vive
 * numa coluna de 320 px ou num painel de 1.400 px na MESMA janela. Medir a janela
 * daria a resposta certa para o lugar errado.
 *
 * Entao medimos o CONTAINER, com `ResizeObserver`. E a decisao que faz isso
 * funcionar e esta:
 *
 * ⚠️ **A largura natural de cada grupo e medida UMA VEZ, com tudo visivel, e
 * guardada.** A decisao de colapsar sai dessa medida GUARDADA mais a largura do
 * container — nunca do DOM corrente. A versao ingenua (medir o conteudo atual,
 * colapsar, medir de novo) oscila para sempre: colapsar libera espaco, o espaco
 * liberado diz "cabe", expandir tira o espaco, e a barra pisca a 60 quadros por
 * segundo. Medida guardada nao tem esse retorno.
 *
 * ⚠️ E por isso a medida e invalidada apenas quando muda a **assinatura** do
 * conteudo (quais itens existem), NAO quando muda o estado `active` deles: ligar
 * uma camada nao altera a largura de nada, e remedir ali seria trabalho por nada
 * a cada clique.
 *
 * ⚠️ **Sem medida, mostra tudo.** No jsdom o `ResizeObserver` do
 * `vitest.setup.ts` nunca notifica e `offsetWidth` e 0 — de proposito, para nao
 * inventar coordenada em teste. Em SSR nao ha layout nenhum. Nos dois casos a
 * barra renderiza completa e o `flexWrap: 'wrap'` quebra em duas linhas se nao
 * couber. ⭐ Quebrar linha, e nao `overflow: hidden`: botao cortado e botao
 * perdido, e o usuario nao tem como saber que ele existia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ POR QUE O CONTAINER NAO E `role="toolbar"`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `toolbar` promete uma parada de Tab so, com as setas navegando entre TODOS os
 * controles. Nao e o que acontece aqui: o `SegmentedControl` interno e um
 * `radiogroup` e ja reivindica as setas para trocar a rasterizacao — os dois
 * teclados brigariam pelo mesmo evento. Anunciar `toolbar` seria prometer um
 * comportamento que este componente nao entrega, e promessa quebrada em ARIA e
 * pior que ausencia: o usuario de leitor de tela aperta seta, nada acontece, e ele
 * conclui que o controle esta defeituoso. `role="group"` descreve o que existe de
 * verdade — grupos nomeados, cada um com seu teclado.
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { PriceSeriesType } from '@robustus/charts-engine';
import { Icon, type IconName } from './icons.js';
import {
  SegmentedControl,
  joinClasses,
  useChromeStyles,
  type SegmentedOption,
} from './SegmentedControl.js';
import { Tooltip } from './Tooltip.js';

// ═════════════════════════════════════════════════════════════════════════════
// Vocabulario dos grupos
// ═════════════════════════════════════════════════════════════════════════════

/** Os ids de grupo. Sao chave de medida e de colapso, nunca texto de tela. */
type GroupId = 'chartType' | 'layers' | 'environment' | 'actions';

/**
 * O nome de cada grupo. E o `aria-label` do `role="group"` **e** o titulo da
 * secao dentro do menu "Mais" — a mesma string nos dois lugares de proposito:
 * colapsar nao pode renomear a categoria, senao o usuario nao reconhece onde o
 * botao foi parar.
 */
export const CHART_TOOLBAR_GROUP_LABELS: Readonly<Record<GroupId, string>> = {
  chartType: 'Desenho do gráfico',
  layers: 'Camadas de análise',
  environment: 'Ambiente do gráfico',
  actions: 'Ações',
};

/** Ordem VISUAL, da esquerda para a direita. Usada tambem para somar largura. */
const ORDEM_VISUAL: readonly GroupId[] = ['chartType', 'layers', 'environment', 'actions'];

/**
 * Ordem de COLAPSO: o primeiro a sair da barra quando falta espaco.
 *
 * ⭐ Do menos essencial para o mais: acao pontual e usada uma vez por sessao,
 * ambiente quase nunca muda depois de configurado, camada de analise e ligada e
 * desligada durante a operacao. `chartType` **nao esta na lista** — a barra sem o
 * desenho do preco nao tem razao de existir.
 */
const ORDEM_COLAPSO: readonly GroupId[] = ['actions', 'environment', 'layers'];

/** Espaco entre grupos, em px. Entra na conta de quem cabe. */
const GAP = 8;

/**
 * Largura assumida para o botao "Mais" enquanto ele nao existe no DOM.
 *
 * ⚠️ Ele so aparece DEPOIS de haver algo oculto, e a decisao de ocultar precisa
 * da largura dele antes — a galinha e o ovo. Estimar por cima e o lado seguro de
 * errar: colapsa um grupo antes da conta exata, em vez de deixar transbordar.
 */
const LARGURA_MAIS_ESTIMADA = 78;

const VAZIO: ReadonlySet<string> = new Set<string>();

// ═════════════════════════════════════════════════════════════════════════════
// Tipos de gráfico — a lista pronta, com hint
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Os modos de desenho do preco.
 *
 * ⚠️ Os quatro primeiros sao `SeriesType` do motor; **`HeikinAshi` e `Renko` nao
 * sao** — sao transformacao de DADO (`candle-transforms.core.ts`) plotada como
 * vela comum. Eles convivem aqui porque, para o operador, sao a mesma pergunta
 * ("como quero ver o preco"); quem aplica e o consumidor, e por isso o `chartType`
 * da barra e `string` e nao `PriceSeriesType`.
 */
export type ChartTypeId = 'Candlestick' | 'Bar' | 'Line' | 'Area' | 'HeikinAshi' | 'Renko';

/**
 * ⭐ Prova de tipo com CUSTO ZERO em runtime: se o motor renomear ou acrescentar
 * um `PriceSeriesType`, este arquivo para de compilar — em vez de a barra passar a
 * mandar (ou a nunca oferecer) um id que o `setPriceSeriesType` ignora em silencio.
 *
 * A direcao da checagem importa: exige que TODO `PriceSeriesType` tenha id aqui, e
 * nao o contrario — `HeikinAshi` e `Renko` existem so aqui, de proposito.
 */
type AssertContem<Todos, Parte extends Todos> = [Todos, Parte] extends [unknown, unknown]
  ? true
  : never;
type _PROVA_ALINHAMENTO_COM_O_MOTOR = AssertContem<ChartTypeId, PriceSeriesType>;

/**
 * Lista pronta para o caso comum. O `hint` responde "para que serve", que e o que
 * o dono pediu — icone sozinho nao ensina Renko a ninguem.
 */
export const CHART_TYPE_OPTIONS: readonly SegmentedOption<string>[] = [
  {
    value: 'Candlestick',
    label: 'Velas',
    icon: 'candles',
    hint: 'Abertura, máxima, mínima e fechamento em cada barra. A leitura padrão de preço.',
  },
  {
    value: 'Bar',
    label: 'Barras',
    icon: 'bars',
    hint: 'Os mesmos OHLC das velas, sem corpo preenchido — ocupa menos largura por barra.',
  },
  {
    value: 'Line',
    label: 'Linha',
    icon: 'line',
    hint: 'Só o fechamento, ligado. Limpa o ruído do intrabarra para ver tendência.',
  },
  {
    value: 'Area',
    label: 'Área',
    icon: 'area',
    hint: 'A linha de fechamento com preenchimento até a base. Boa para comparar volume de movimento.',
  },
  {
    value: 'HeikinAshi',
    label: 'Heikin-Ashi',
    icon: 'heikinAshi',
    hint: 'Velas médias: suaviza a oscilação e evidencia a continuidade do movimento. Não é preço real.',
  },
  {
    value: 'Renko',
    label: 'Renko',
    icon: 'renko',
    hint: 'Tijolos por variação de preço, sem tempo regular. Isola movimento de ruído lateral.',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

/** Item que LIGA e DESLIGA (camada, ambiente). Tem estado. */
export interface ToolbarToggleItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly hint?: string;
  readonly active: boolean;
}

/** Item que ACONTECE UMA VEZ (exportar, salvar). Nao tem estado. */
export interface ToolbarActionItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly hint?: string;
}

export interface ChartToolbarProps {
  // ── Grupo DESENHO DO GRAFICO: como o preco e rasterizado ──
  /** Id do modo corrente. Inclui Heikin-Ashi/Renko (ver `ChartTypeId`). */
  readonly chartType: string;
  readonly chartTypes: readonly SegmentedOption<string>[];
  readonly onChartTypeChange: (v: string) => void;

  // ── Grupo CAMADAS: o que e sobreposto ao preco ──
  readonly layers?: readonly ToolbarToggleItem[];
  readonly onToggleLayer?: (id: string) => void;

  // ── Grupo AMBIENTE: grade, marca d'agua, mira ──
  readonly environment?: readonly ToolbarToggleItem[];
  readonly onToggleEnvironment?: (id: string) => void;

  // ── Grupo ACOES: exportar, salvar, restaurar ──
  readonly actions?: readonly ToolbarActionItem[];
  readonly onAction?: (id: string) => void;

  /** Espaco livre a direita (ex.: o botao da paleta de comandos). */
  readonly trailing?: ReactNode;
  /** `true` = so icones. O `Tooltip` passa a ser a unica fonte de significado. */
  readonly compact?: boolean;
  /** Nome do container. Default `'Barra de ferramentas do gráfico'`. */
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// Medida
// ═════════════════════════════════════════════════════════════════════════════

interface Medidas {
  /** Largura natural por grupo, medida com TUDO visivel. */
  readonly grupos: ReadonlyMap<string, number>;
  /** Largura do botao "Mais", ou 0 se ele ainda nao existia na medicao. */
  readonly mais: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A barra horizontal do grafico.
 *
 * @example
 * <ChartToolbar
 *   chartType={tipo}
 *   chartTypes={CHART_TYPE_OPTIONS}
 *   onChartTypeChange={setTipo}
 *   layers={[{ id: 'bookmap', label: 'Bookmap', icon: 'bookmap', active: liga, hint: '…' }]}
 *   onToggleLayer={alternarCamada}
 *   environment={[{ id: 'grid', label: 'Grade', icon: 'grid', active: grade }]}
 *   onToggleEnvironment={alternarAmbiente}
 *   actions={[{ id: 'screenshot', label: 'Exportar imagem', icon: 'camera' }]}
 *   onAction={executar}
 * />
 */
export function ChartToolbar({
  chartType,
  chartTypes,
  onChartTypeChange,
  layers,
  onToggleLayer,
  environment,
  onToggleEnvironment,
  actions,
  onAction,
  trailing,
  compact = false,
  ariaLabel = 'Barra de ferramentas do gráfico',
  className,
  style,
}: ChartToolbarProps): JSX.Element {
  useChromeStyles();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const elGrupos = useRef<Map<string, HTMLElement>>(new Map());
  const elMais = useRef<HTMLButtonElement | null>(null);

  const [medidas, setMedidas] = useState<Medidas | null>(null);
  const [largura, setLargura] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  /**
   * A identidade do CONTEUDO: quais itens existem, e se ha rotulo visivel.
   *
   * ⚠️ `active` de proposito fora: alternar camada nao muda largura, e remedir a
   * cada clique seria trabalho por nada (ver o cabecalho).
   */
  const assinatura = useMemo(
    () =>
      [
        compact ? 'compacto' : 'completo',
        chartTypes.map((o) => o.label).join(','),
        (layers ?? []).map((i) => i.label).join(','),
        (environment ?? []).map((i) => i.label).join(','),
        (actions ?? []).map((i) => i.label).join(','),
        trailing === undefined ? '' : 'trailing',
      ].join('|'),
    [compact, chartTypes, layers, environment, actions, trailing],
  );

  // Conteudo mudou: invalida a medida. A proxima passada renderiza TUDO (porque
  // sem medida nada colapsa) e e nessa passada que a medicao acontece.
  useEffect(() => {
    setMedidas(null);
  }, [assinatura]);

  // A medicao. Roda so quando nao ha medida valida.
  useEffect(() => {
    if (medidas !== null) return;
    const grupos = new Map<string, number>();
    for (const [id, el] of elGrupos.current) {
      const w = el.offsetWidth;
      // 0 = sem layout (jsdom, SSR, elemento em `display:none`). Nao entra: uma
      // medida zero faria a conta concluir que tudo cabe em qualquer largura.
      if (w > 0) grupos.set(id, w);
    }
    if (grupos.size === 0) return;
    setMedidas({ grupos, mais: elMais.current?.offsetWidth ?? 0 });
  }, [medidas, assinatura]);

  // A largura disponivel. ⚠️ Observa o CONTAINER, nunca o conteudo — ver o
  // cabecalho: observar o conteudo produz oscilacao infinita.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const inicial = el.clientWidth;
    if (inicial > 0) setLargura(inicial);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entradas) => {
      for (const entrada of entradas) {
        const w = entrada.contentRect?.width ?? 0;
        // `null` = "nao sei", e nunca zero: zero significaria "nao cabe nada" e
        // colapsaria a barra inteira num ambiente que so nao sabe medir.
        setLargura(w > 0 ? w : null);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const temLayers = layers !== undefined && layers.length > 0;
  const temEnvironment = environment !== undefined && environment.length > 0;
  const temActions = actions !== undefined && actions.length > 0;

  const ocultos = useMemo<ReadonlySet<string>>(() => {
    if (largura === null || medidas === null) return VAZIO;
    const nat = medidas.grupos;

    const presentes = [...ORDEM_VISUAL, '__trailing'].filter((id) => nat.has(id));
    let necessario = presentes.reduce((soma, id) => soma + (nat.get(id) ?? 0), 0);
    necessario += GAP * Math.max(0, presentes.length - 1);

    const larguraMais = medidas.mais > 0 ? medidas.mais : LARGURA_MAIS_ESTIMADA;
    const ocultar = new Set<string>();
    for (const id of ORDEM_COLAPSO) {
      if (necessario <= largura) break;
      const w = nat.get(id);
      if (w === undefined) continue;
      necessario -= w + GAP;
      // O botao "Mais" entra na conta uma unica vez, no primeiro grupo oculto.
      if (ocultar.size === 0) necessario += larguraMais + GAP;
      ocultar.add(id);
    }
    return ocultar;
  }, [largura, medidas]);

  // Grupo que colapsou nao pode deixar o menu aberto pendurado quando volta a
  // caber: o botao que ancora o menu deixa de existir e o foco iria para o body.
  useEffect(() => {
    if (ocultos.size === 0 && menuAberto) setMenuAberto(false);
  }, [ocultos, menuAberto]);

  const registrar = (id: string) => (el: HTMLElement | null) => {
    if (el === null) elGrupos.current.delete(id);
    else elGrupos.current.set(id, el);
  };

  // ── Os blocos visiveis, na ordem ──────────────────────────────────────────
  const blocos: { readonly id: string; readonly node: ReactNode }[] = [];

  if (chartTypes.length > 0) {
    blocos.push({
      id: 'chartType',
      node: (
        <div
          ref={registrar('chartType')}
          role="group"
          aria-label={CHART_TOOLBAR_GROUP_LABELS.chartType}
          className="robustus-toolbar__group"
          style={estiloGrupo}
        >
          <SegmentedControl
            options={chartTypes}
            value={chartType}
            onChange={onChartTypeChange}
            size={compact ? 'sm' : 'md'}
            showLabels={!compact}
            ariaLabel={CHART_TOOLBAR_GROUP_LABELS.chartType}
          />
        </div>
      ),
    });
  }

  if (temLayers && !ocultos.has('layers')) {
    blocos.push({
      id: 'layers',
      node: (
        <div
          ref={registrar('layers')}
          role="group"
          aria-label={CHART_TOOLBAR_GROUP_LABELS.layers}
          className="robustus-toolbar__group"
          style={estiloGrupo}
        >
          {layers.map((item) => (
            <BotaoAlternavel
              key={item.id}
              item={item}
              compact={compact}
              onClick={() => onToggleLayer?.(item.id)}
            />
          ))}
        </div>
      ),
    });
  }

  if (temEnvironment && !ocultos.has('environment')) {
    blocos.push({
      id: 'environment',
      node: (
        <div
          ref={registrar('environment')}
          role="group"
          aria-label={CHART_TOOLBAR_GROUP_LABELS.environment}
          className="robustus-toolbar__group"
          style={estiloGrupo}
        >
          {environment.map((item) => (
            <BotaoAlternavel
              key={item.id}
              item={item}
              compact={compact}
              onClick={() => onToggleEnvironment?.(item.id)}
            />
          ))}
        </div>
      ),
    });
  }

  if (temActions && !ocultos.has('actions')) {
    blocos.push({
      id: 'actions',
      node: (
        <div
          ref={registrar('actions')}
          role="group"
          aria-label={CHART_TOOLBAR_GROUP_LABELS.actions}
          className="robustus-toolbar__group"
          style={estiloGrupo}
        >
          {actions.map((item) => (
            <BotaoAcao
              key={item.id}
              item={item}
              compact={compact}
              onClick={() => onAction?.(item.id)}
            />
          ))}
        </div>
      ),
    });
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={joinClasses('robustus-toolbar', className)}
      style={{ ...estiloBarra, ...style }}
    >
      {blocos.map((b, i) => (
        <Fragment key={b.id}>
          {i > 0 && (
            // Separador DECORATIVO: `aria-hidden`. Ele existe para o olho ver a
            // fronteira entre propositos; para o leitor de tela a fronteira ja e
            // o `role="group"` com nome, e anunciar a barrinha seria ruido.
            <span aria-hidden="true" className="robustus-toolbar__separator" style={estiloSeparador} />
          )}
          {b.node}
        </Fragment>
      ))}

      {ocultos.size > 0 && (
        <MenuMais
          registrarBotao={(el) => {
            elMais.current = el;
          }}
          aberto={menuAberto}
          onAbertoChange={setMenuAberto}
          compact={compact}
          ocultos={ocultos}
          layers={temLayers ? layers : undefined}
          environment={temEnvironment ? environment : undefined}
          actions={temActions ? actions : undefined}
          onToggleLayer={onToggleLayer}
          onToggleEnvironment={onToggleEnvironment}
          onAction={onAction}
        />
      )}

      {trailing !== undefined && (
        <div
          ref={registrar('__trailing')}
          className="robustus-toolbar__trailing"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {trailing}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Botoes
// ═════════════════════════════════════════════════════════════════════════════

interface BotaoAlternavelProps {
  readonly item: ToolbarToggleItem;
  readonly compact: boolean;
  readonly onClick: () => void;
}

/**
 * Um alternavel (camada, ambiente).
 *
 * ⚠️ `aria-pressed`, e nao `aria-checked`: `checked` pertence a `radio`/`checkbox`
 * e diz "opcao de um campo"; `pressed` diz "botao que fica ligado", que e o que
 * uma camada e. E `aria-label` esta SEMPRE presente, com ou sem rotulo visivel —
 * no modo compacto o conteudo e um `<svg aria-hidden>`, ou seja, um botao mudo sem
 * ele.
 */
function BotaoAlternavel({ item, compact, onClick }: BotaoAlternavelProps): JSX.Element {
  const botao = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={item.active}
      aria-label={item.label}
      className={joinClasses('robustus-toolbar__btn', item.active && 'robustus-toolbar__btn--active')}
      style={estiloBotao(item.active, compact)}
    >
      {item.icon !== undefined && <Icon name={item.icon} size={compact ? 15 : 16} />}
      {!compact && <span>{item.label}</span>}
    </button>
  );
  return compact || item.hint !== undefined ? (
    <Tooltip label={item.label} hint={item.hint} placement="bottom">
      {botao}
    </Tooltip>
  ) : (
    botao
  );
}

interface BotaoAcaoProps {
  readonly item: ToolbarActionItem;
  readonly compact: boolean;
  readonly onClick: () => void;
}

/** Uma acao pontual. Sem `aria-pressed` — ver o item 4 do cabecalho. */
function BotaoAcao({ item, compact, onClick }: BotaoAcaoProps): JSX.Element {
  const botao = (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      className="robustus-toolbar__btn"
      style={estiloBotao(false, compact)}
    >
      {item.icon !== undefined && <Icon name={item.icon} size={compact ? 15 : 16} />}
      {!compact && <span>{item.label}</span>}
    </button>
  );
  return compact || item.hint !== undefined ? (
    <Tooltip label={item.label} hint={item.hint} placement="bottom">
      {botao}
    </Tooltip>
  ) : (
    botao
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// O menu "Mais" — o destino de quem nao caiu na barra
// ═════════════════════════════════════════════════════════════════════════════

interface MenuMaisProps {
  readonly aberto: boolean;
  readonly onAbertoChange: (a: boolean) => void;
  readonly compact: boolean;
  readonly ocultos: ReadonlySet<string>;
  readonly layers?: readonly ToolbarToggleItem[];
  readonly environment?: readonly ToolbarToggleItem[];
  readonly actions?: readonly ToolbarActionItem[];
  readonly onToggleLayer?: (id: string) => void;
  readonly onToggleEnvironment?: (id: string) => void;
  readonly onAction?: (id: string) => void;
  /**
   * Entrega o elemento do BOTAO a barra, para ela medir a largura dele.
   *
   * ⚠️ E uma prop, e nao `forwardRef`: a barra precisa do BOTAO, e o `ref` de um
   * `forwardRef` teria de escolher entre expor o botao ou a raiz do menu. Prop
   * nomeada diz qual dos dois e, sem ambiguidade.
   */
  readonly registrarBotao: (el: HTMLButtonElement | null) => void;
}

/**
 * O botao "Mais" e seu menu.
 *
 * ⭐ **O menu repete os NOMES DOS GRUPOS.** Colapsar economiza espaco; nao pode
 * destruir a categorizacao, que e a coisa que o dono pediu. Dentro do menu,
 * "Camadas de análise" e "Ações" continuam sendo secoes distintas, com os mesmos
 * nomes que tinham na barra — e assim o usuario reconhece para onde o botao foi.
 *
 * ⚠️ **Alternavel MANTEM o menu aberto; acao FECHA.** Nao e capricho: ligar
 * bookmap e footprint sao dois cliques na mesma intencao, e fechar entre eles
 * obrigaria a reabrir. "Exportar imagem", ao contrario, termina o assunto — deixar
 * o menu aberto sobre o grafico que se quer olhar e o oposto do desejado.
 */
function MenuMais({
  registrarBotao,
  aberto,
  onAbertoChange,
  compact,
  ocultos,
  layers,
  environment,
  actions,
  onToggleLayer,
  onToggleEnvironment,
  onAction,
}: MenuMaisProps): JSX.Element {
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itens = useRef<(HTMLButtonElement | null)[]>([]);

  // Fecha ao apontar fora. `pointerdown` e nao `click`: o clique fora costuma
  // acionar outra coisa, e fechar so no `click` deixa o menu por cima do alvo no
  // instante em que o usuario mira nele.
  useEffect(() => {
    if (!aberto) return;
    if (typeof document === 'undefined') return;
    const aoApontar = (e: Event): void => {
      const alvo = e.target;
      if (!(alvo instanceof Node)) return;
      if (menuRef.current?.contains(alvo) === true) return;
      if (botaoRef.current?.contains(alvo) === true) return;
      onAbertoChange(false);
    };
    document.addEventListener('pointerdown', aoApontar);
    return () => document.removeEventListener('pointerdown', aoApontar);
  }, [aberto, onAbertoChange]);

  const fecharEDevolverFoco = (): void => {
    onAbertoChange(false);
    botaoRef.current?.focus();
  };

  const aoTeclarNoMenu = (evento: ReactKeyboardEvent): void => {
    const lista = itens.current.filter((el): el is HTMLButtonElement => el !== null);
    if (lista.length === 0) return;
    const atual = lista.findIndex((el) => el === document.activeElement);
    switch (evento.key) {
      case 'Escape':
        evento.preventDefault();
        fecharEDevolverFoco();
        return;
      case 'ArrowDown':
        evento.preventDefault();
        lista[(atual + 1) % lista.length]?.focus();
        return;
      case 'ArrowUp':
        evento.preventDefault();
        lista[(atual - 1 + lista.length) % lista.length]?.focus();
        return;
      case 'Home':
        evento.preventDefault();
        lista[0]?.focus();
        return;
      case 'End':
        evento.preventDefault();
        lista[lista.length - 1]?.focus();
        return;
      case 'Tab':
        // Tab sai do menu: fecha, mas NAO chama `preventDefault` — prender o Tab
        // num menu de barra de ferramenta e armadilha de foco sem saida.
        onAbertoChange(false);
        return;
      default:
        return;
    }
  };

  // Indice corrido, para o array de refs atravessar as secoes.
  let indice = 0;
  const secoes: ReactNode[] = [];

  const secaoAlternavel = (
    grupo: GroupId,
    lista: readonly ToolbarToggleItem[] | undefined,
    onToggle: ((id: string) => void) | undefined,
  ): void => {
    if (lista === undefined || lista.length === 0 || !ocultos.has(grupo)) return;
    secoes.push(
      <div key={grupo} role="group" aria-label={CHART_TOOLBAR_GROUP_LABELS[grupo]}>
        <p style={estiloTituloSecao}>{CHART_TOOLBAR_GROUP_LABELS[grupo]}</p>
        {lista.map((item) => {
          const i = indice++;
          return (
            <button
              key={item.id}
              ref={(el) => {
                itens.current[i] = el;
              }}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.active}
              onClick={() => onToggle?.(item.id)}
              className="robustus-toolbar__menu-item"
              style={estiloItemMenu}
            >
              <Icon name={item.active ? 'eye' : 'eyeOff'} size={14} />
              {item.icon !== undefined && <Icon name={item.icon} size={14} />}
              <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
            </button>
          );
        })}
      </div>,
    );
  };

  secaoAlternavel('layers', layers, onToggleLayer);
  secaoAlternavel('environment', environment, onToggleEnvironment);

  if (actions !== undefined && actions.length > 0 && ocultos.has('actions')) {
    secoes.push(
      <div key="actions" role="group" aria-label={CHART_TOOLBAR_GROUP_LABELS.actions}>
        <p style={estiloTituloSecao}>{CHART_TOOLBAR_GROUP_LABELS.actions}</p>
        {actions.map((item) => {
          const i = indice++;
          return (
            <button
              key={item.id}
              ref={(el) => {
                itens.current[i] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => {
                onAction?.(item.id);
                fecharEDevolverFoco();
              }}
              className="robustus-toolbar__menu-item"
              style={estiloItemMenu}
            >
              {item.icon !== undefined && <Icon name={item.icon} size={14} />}
              <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
            </button>
          );
        })}
      </div>,
    );
  }

  const botao = (
    <button
      ref={(el) => {
        botaoRef.current = el;
        registrarBotao(el);
      }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={aberto}
      aria-label="Mais ferramentas"
      onClick={() => onAbertoChange(!aberto)}
      className="robustus-toolbar__more"
      style={estiloBotao(aberto, compact)}
    >
      <Icon name="chevronDown" size={compact ? 15 : 16} />
      {!compact && <span>Mais</span>}
    </button>
  );

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip
        label="Mais ferramentas"
        hint="Os grupos que não couberam na largura atual continuam aqui, com os mesmos nomes."
        placement="bottom"
      >
        {botao}
      </Tooltip>
      {aberto && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Mais ferramentas"
          onKeyDown={aoTeclarNoMenu}
          className="robustus-toolbar__menu"
          style={estiloMenu}
        >
          {secoes}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo
// ═════════════════════════════════════════════════════════════════════════════

const estiloBarra: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP,
  width: '100%',
  // ⚠️ `minWidth: 0` num flex item nao encolhe sozinho: sem isto a barra dentro de
  // um flex pai imporia sua largura natural ao pai, e o container medido nunca
  // ficaria estreito — o colapso jamais dispararia.
  minWidth: 0,
  padding: '4px 6px',
  // ⭐ Quebra linha em vez de cortar. Ver o cabecalho: sem medida (jsdom, SSR) a
  // barra sai completa, e transbordar em duas linhas e melhor que esconder botao.
  flexWrap: 'wrap',
  fontFamily: 'inherit',
  color: 'inherit',
};

const estiloGrupo: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};

const estiloSeparador: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 18,
  background: 'rgba(148,163,184,0.28)',
};

function estiloBotao(ativo: boolean, compact: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: compact ? 0 : 5,
    fontSize: compact ? 10 : 11,
    fontFamily: 'inherit',
    lineHeight: 1.4,
    padding: compact ? '4px 5px' : '4px 8px',
    borderRadius: 6,
    border: '1px solid',
    borderColor: ativo ? 'rgba(56,189,248,0.55)' : 'rgba(148,163,184,0.22)',
    background: ativo ? 'rgba(56,189,248,0.18)' : 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const estiloMenu: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  minWidth: 190,
  padding: 4,
  borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.28)',
  background: '#0f172a',
  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
  // Acima das camadas do grafico, e abaixo de dialogo modal do consumidor.
  zIndex: 20,
};

const estiloTituloSecao: CSSProperties = {
  margin: '4px 6px 2px',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  opacity: 0.6,
};

const estiloItemMenu: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '4px 6px',
  borderRadius: 5,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
