/**
 * DrawingToolbar — a barra de ferramentas de desenho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ O AGRUPAMENTO E A DOCUMENTACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A restricao e "nao encher a tela de botoes, mas saber o que e e para que". Sao
 * treze acoes. Treze icones em fila e um teclado sem legenda: o operador tem de
 * decorar posicao.
 *
 * A resposta aqui e SEMANTICA, em duas camadas:
 *
 *  1. **Familia, com separador visual.** Selecionar / Linhas / Formas / Medicao /
 *     Precisao / Historico. A vizinhanca ja diz metade — um icone desconhecido no
 *     grupo "Medicao" ja e entendido como algo que mede, antes de qualquer texto.
 *     Cada grupo e um `role="group"` com `aria-label`, entao o leitor de tela
 *     anuncia a familia ao entrar nela: a mesma informacao que o separador da ao
 *     olho.
 *  2. **`Tooltip` com nome + PARA QUE + atalho.** Ver `Tooltip.tsx`. Nenhum texto
 *     permanente na tela, explicacao completa sob demanda, nos dois canais (hover
 *     e foco).
 *
 * ⚠️ **Os `hint` nao repetem o nome.** "Régua — ferramenta régua" nao ensina nada.
 * Cada um diz o que a ferramenta PRODUZ e quando se usa. Ao acrescentar item aqui,
 * escreva o hint pensando em quem nunca viu a ferramenta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O DEFEITO DO ATALHO QUE DISPARA DENTRO DE UM CAMPO DE TEXTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Atalho de tecla unica em ouvinte de documento e comodo e tem um defeito
 * classico: digitar num `<input>` da pagina (o campo de simbolo, o periodo de um
 * indicador, uma caixa de busca) troca a ferramenta a cada letra. Escrever "PETR4"
 * ativaria o retangulo no `R`. Guardas, todas necessarias:
 *
 *  - foco em `INPUT`, `TEXTAREA`, `SELECT` ou em `contenteditable` -> ignora;
 *  - `Ctrl`/`Meta`/`Alt` pressionado -> ignora (`Ctrl+R` recarrega a pagina, e
 *    roubar isso e pior que nao ter atalho);
 *  - evento ja tratado (`defaultPrevented`) -> ignora.
 *
 * ⚠️ **`Ctrl+Z` NAO e implementado aqui, de proposito, e por isso nao e
 * anunciado.** Desfazer global pertence ao aplicativo, que tem outras coisas para
 * desfazer alem de desenho; uma barra de grafico sequestrando `Ctrl+Z` do
 * documento quebraria o desfazer de tudo o mais. Anunciar no tooltip um atalho que
 * a barra nao implementa seria mentir para o usuario.
 *
 * ⚠️ **`shortcutsEnabled` existe por causa de duas barras na mesma pagina.** Dois
 * graficos lado a lado, dois ouvintes de documento: `T` ativaria a linha de
 * tendencia nos dois. Quem monta layout multiplo desliga o atalho no que nao esta
 * em foco.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ROVING TABINDEX, E A ARMADILHA DO BOTAO DESABILITADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Padrao ARIA de `toolbar`: a barra inteira e UMA parada de `Tab`, e as setas movem
 * o foco dentro dela. Sem isso, treze botoes sao treze `Tab` entre o grafico e o
 * proximo controle da pagina.
 *
 * Isso exige um unico botao com `tabIndex=0` e o resto com `-1`. ⚠️ E aqui esta a
 * armadilha: `Desfazer`, `Refazer` e `Apagar` ficam DESABILITADOS a maior parte do
 * tempo, e botao desabilitado nao recebe foco. Se o `tabIndex=0` cair num deles, a
 * barra inteira desaparece da ordem de tabulacao — fica inalcancavel por teclado.
 * Por isso o indice efetivo e recalculado a cada render: se o item lembrado estiver
 * desabilitado, o `tabIndex=0` vai para o primeiro habilitado.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ActiveTool } from '@robustus/charts-drawings';
import { Icon, type IconName } from './icons.js';
import { Tooltip, type TooltipPlacement } from './Tooltip.js';
import type { UseDrawingsResult } from './useDrawings.js';

// ═════════════════════════════════════════════════════════════════════════════
// O vocabulario da barra
// ═════════════════════════════════════════════════════════════════════════════

/** Acoes que nao trocam a ferramenta. */
type ToolbarAction = 'undo' | 'redo' | 'delete' | 'collapse';

interface ItemBase {
  /** Chave estavel. Vai para `data-item-id`, que a navegacao por seta usa. */
  readonly id: string;
  readonly icon: IconName;
  /** O NOME, tambem usado como `aria-label` do botao. */
  readonly label: string;
  /** O PARA QUE, numa frase. ⚠️ Nao repita o nome. */
  readonly hint: string;
  /** Tecla unica, sem modificador. */
  readonly shortcut?: string;
}

interface ItemTool extends ItemBase {
  readonly kind: 'TOOL';
  /** `null` = modo de selecao (o cursor). */
  readonly tool: ActiveTool;
}

interface ItemToggle extends ItemBase {
  readonly kind: 'TOGGLE';
}

interface ItemAction extends ItemBase {
  readonly kind: 'ACTION';
  readonly action: ToolbarAction;
}

type ToolbarItem = ItemTool | ItemToggle | ItemAction;

interface ToolbarGroup {
  readonly id: string;
  /** Nome da familia. Vira `aria-label` do `role="group"`. */
  readonly label: string;
  readonly items: readonly ToolbarItem[];
}

/**
 * As familias, na ordem em que aparecem.
 *
 * ⭐ A ordem nao e estetica: vai do que se usa a toda hora (selecionar, linha) para
 * o que se usa as vezes (medicao) e termina no que corrige (historico). Mao que
 * volta ao mesmo lugar e mao que nao procura.
 */
const GRUPOS: readonly ToolbarGroup[] = Object.freeze([
  {
    id: 'select',
    label: 'Selecionar',
    items: [
      {
        id: 'cursor',
        kind: 'TOOL',
        tool: null,
        icon: 'cursor',
        label: 'Selecionar',
        hint: 'Escolhe e arrasta desenho já traçado. Não cria nada novo.',
        shortcut: 'S',
      },
    ],
  },
  {
    id: 'lines',
    label: 'Linhas',
    items: [
      {
        id: 'trendline',
        kind: 'TOOL',
        tool: 'TRENDLINE',
        icon: 'trendline',
        label: 'Linha de tendência',
        hint: 'Dois pontos: mede a inclinação de um movimento e serve de suporte inclinado.',
        shortcut: 'T',
      },
      {
        id: 'ray',
        kind: 'TOOL',
        tool: 'RAY',
        icon: 'ray',
        label: 'Raio',
        hint: 'Parte de um ponto e segue só para a frente: projeta o rumo sem marcar o passado.',
        shortcut: 'R',
      },
      {
        id: 'extendedLine',
        kind: 'TOOL',
        tool: 'EXTENDED_LINE',
        icon: 'extendedLine',
        label: 'Reta estendida',
        hint: 'Prolonga a reta de dois pontos nos dois sentidos, por todo o gráfico.',
        shortcut: 'E',
      },
      {
        id: 'horizontalLine',
        kind: 'TOOL',
        tool: 'HORIZONTAL_LINE',
        icon: 'horizontalLine',
        label: 'Linha horizontal',
        hint: 'Um preço fixo de ponta a ponta: suporte, resistência ou o preço de entrada.',
        shortcut: 'H',
      },
      {
        id: 'verticalLine',
        kind: 'TOOL',
        tool: 'VERTICAL_LINE',
        icon: 'verticalLine',
        label: 'Linha vertical',
        hint: 'Um instante fixo: abertura, notícia ou o horário de um evento.',
        shortcut: 'V',
      },
    ],
  },
  {
    id: 'shapes',
    label: 'Formas',
    items: [
      {
        id: 'rectangle',
        kind: 'TOOL',
        tool: 'RECTANGLE',
        icon: 'rectangle',
        label: 'Retângulo',
        hint: 'Delimita uma região de preço e tempo: congestão, canal ou zona de valor.',
        shortcut: 'B',
      },
    ],
  },
  {
    id: 'measure',
    label: 'Medição',
    items: [
      {
        id: 'fibonacci',
        kind: 'TOOL',
        tool: 'FIB_RETRACEMENT',
        icon: 'fibonacci',
        label: 'Retração de Fibonacci',
        hint: 'Traça 23,6%, 38,2%, 50% e 61,8% entre o topo e o fundo que você marcar.',
        shortcut: 'F',
      },
      {
        id: 'ruler',
        kind: 'TOOL',
        tool: 'MEASURE',
        icon: 'measure',
        label: 'Régua',
        hint: 'Mede variação em preço, em % e em barras entre dois pontos.',
        shortcut: 'M',
      },
    ],
  },
  {
    id: 'precision',
    label: 'Ajuda de precisão',
    items: [
      {
        id: 'magnet',
        kind: 'TOGGLE',
        icon: 'magnet',
        label: 'Ímã',
        hint: 'Prende o ponto na máxima, mínima ou fechamento da barra mais próxima.',
        shortcut: 'A',
      },
    ],
  },
  {
    id: 'history',
    label: 'Histórico',
    items: [
      {
        id: 'undo',
        kind: 'ACTION',
        action: 'undo',
        icon: 'undo',
        label: 'Desfazer',
        // ⚠️ Sem `shortcut`: `Ctrl+Z` e do aplicativo, nao desta barra. Ver o
        // cabecalho.
        hint: 'Volta a última alteração de desenho.',
      },
      {
        id: 'redo',
        kind: 'ACTION',
        action: 'redo',
        icon: 'redo',
        label: 'Refazer',
        hint: 'Reaplica a alteração que você desfez.',
      },
      {
        id: 'delete',
        kind: 'ACTION',
        action: 'delete',
        icon: 'trash',
        label: 'Apagar selecionado',
        hint: 'Remove os desenhos marcados. Desfazer traz de volta.',
      },
    ],
  },
]);

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

export interface DrawingToolbarProps {
  /**
   * O retorno de `useDrawings`.
   *
   * Passar o objeto inteiro em vez de espalhar dez props e deliberado, e o mesmo
   * critério do `IndicatorToolbox`: as operacoes so fazem sentido juntas (nao ha
   * `undo` sem `canUndo`), e separa-las convidaria a montar um subconjunto
   * inconsistente.
   */
  readonly drawings: UseDrawingsResult;
  /** Default `'vertical'` — a lateral, como numa mesa. */
  readonly orientation?: 'vertical' | 'horizontal';
  /** O ima esta ligado? Estado do CONSUMIDOR (e ele que alimenta `useDrawings`). */
  readonly snapEnabled?: boolean;
  /**
   * Alterna o ima.
   *
   * ⚠️ Sem esta funcao o botao do ima **nao e renderizado**. Um ima que nao liga e
   * pior que ausencia: o operador clica, nada muda, e ele conclui que a barra esta
   * quebrada.
   */
  readonly onToggleSnap?: () => void;
  /** Barra recolhida? Controlado pelo consumidor. */
  readonly collapsed?: boolean;
  /** Alterna o recolhimento. Sem ela, o botao de recolher nao aparece. */
  readonly onToggleCollapsed?: () => void;
  /**
   * Atalhos de tecla unica ligados. Default `true`.
   *
   * ⚠️ Desligue na barra que nao esta em foco quando houver duas na pagina — ver o
   * cabecalho.
   */
  readonly shortcutsEnabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Barra de ferramentas de desenho, agrupada por familia.
 *
 * @example
 * const desenho = useDrawings({ engine, snapEnabled: () => ima });
 * const [ima, setIma] = useState(false);
 * const [recolhida, setRecolhida] = useState(false);
 *
 * <DrawingToolbar
 *   drawings={desenho}
 *   snapEnabled={ima}
 *   onToggleSnap={() => setIma((v) => !v)}
 *   collapsed={recolhida}
 *   onToggleCollapsed={() => setRecolhida((v) => !v)}
 * />
 */
export function DrawingToolbar({
  drawings,
  orientation = 'vertical',
  snapEnabled = false,
  onToggleSnap,
  collapsed = false,
  onToggleCollapsed,
  shortcutsEnabled = true,
  className,
  style,
}: DrawingToolbarProps): JSX.Element {
  const vertical = orientation === 'vertical';
  const barraRef = useRef<HTMLDivElement | null>(null);
  /** Item que carrega o `tabIndex=0`. `null` = ainda nao houve interacao. */
  const [itemFocado, setItemFocado] = useState<string | null>(null);

  /**
   * Grupos efetivamente visiveis.
   *
   * Recolhida, a barra mostra **so o grupo de selecao** — o cursor e o unico item
   * cujo estado importa quando nao ha espaco (e ele que devolve o controle do
   * gráfico ao mouse). Recolher escondendo TUDO deixaria o operador preso na
   * ferramenta ativa sem forma de sair.
   */
  const gruposVisiveis = useMemo<readonly ToolbarGroup[]>(() => {
    const base = collapsed ? GRUPOS.filter((g) => g.id === 'select') : GRUPOS;
    if (onToggleSnap !== undefined) return base;
    // Sem `onToggleSnap`, o ima sai — e o grupo dele desaparece com ele, para nao
    // sobrar separador solto.
    return base
      .map((g) => ({ ...g, items: g.items.filter((i) => i.id !== 'magnet') }))
      .filter((g) => g.items.length > 0);
  }, [collapsed, onToggleSnap]);

  // ── Estado de cada item, num lugar so ─────────────────────────────────────
  //
  // `ativo` alimenta `aria-pressed` + destaque; `desabilitado` alimenta o
  // `disabled` e o calculo do roving tabindex.
  const estadoDoItem = useCallback(
    (item: ToolbarItem): { readonly ativo: boolean | undefined; readonly desabilitado: boolean } => {
      if (item.kind === 'TOOL') return { ativo: drawings.tool === item.tool, desabilitado: false };
      if (item.kind === 'TOGGLE') return { ativo: snapEnabled, desabilitado: false };
      switch (item.action) {
        case 'undo':
          return { ativo: undefined, desabilitado: !drawings.canUndo };
        case 'redo':
          return { ativo: undefined, desabilitado: !drawings.canRedo };
        case 'delete':
          return { ativo: undefined, desabilitado: drawings.selectedIds.length === 0 };
        default:
          return { ativo: undefined, desabilitado: false };
      }
    },
    [drawings.canRedo, drawings.canUndo, drawings.selectedIds.length, drawings.tool, snapEnabled],
  );

  const executar = useCallback(
    (item: ToolbarItem): void => {
      switch (item.kind) {
        case 'TOOL':
          drawings.setTool(item.tool);
          return;
        case 'TOGGLE':
          onToggleSnap?.();
          return;
        case 'ACTION':
          if (item.action === 'undo') drawings.undo();
          else if (item.action === 'redo') drawings.redo();
          else if (item.action === 'delete') drawings.deleteSelected();
          else onToggleCollapsed?.();
          return;
        default:
          return;
      }
    },
    [drawings, onToggleCollapsed, onToggleSnap],
  );

  // ── Roving tabindex: qual item leva o `tabIndex=0` ────────────────────────
  //
  // ⚠️ Ver a armadilha no cabecalho: item lembrado que esteja DESABILITADO nao
  // pode carregar o `tabIndex=0`, senao a barra sai inteira da ordem de tabulacao.
  const idTabulavel = useMemo<string | null>(() => {
    const planos = gruposVisiveis.flatMap((g) => g.items);
    const habilitados = planos.filter((i) => !estadoDoItem(i).desabilitado);
    if (itemFocado !== null && habilitados.some((i) => i.id === itemFocado)) return itemFocado;
    if (itemFocado === 'collapse' && onToggleCollapsed !== undefined) return 'collapse';
    return habilitados[0]?.id ?? (onToggleCollapsed !== undefined ? 'collapse' : null);
  }, [estadoDoItem, gruposVisiveis, itemFocado, onToggleCollapsed]);

  /**
   * Setas movem o foco dentro da barra; `Tab` sai dela.
   *
   * ⚠️ **Os dois eixos de seta funcionam nas duas orientacoes**, embora o ARIA
   * associe cada eixo a uma orientacao. O motivo e pratico: a mesma barra e
   * ancorada de lado ou em cima pela decisao do consumidor, e exigir que o usuario
   * saiba a orientacao corrente para acertar a tecla e fricção sem retorno.
   *
   * ⚠️ A lista de destinos e lida do DOM, nao de um registro paralelo de refs.
   * Ordem do DOM E a ordem visual, e `b.disabled` e a verdade sobre o que pode
   * receber foco — dois estados espelhados divergiriam no primeiro item novo.
   */
  const aoTeclarNaBarra = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const passo =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    const inicio = e.key === 'Home';
    const fim = e.key === 'End';
    if (passo === 0 && !inicio && !fim) return;

    const raiz = barraRef.current;
    if (raiz === null) return;
    const botoes = Array.from(raiz.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => !b.disabled,
    );
    if (botoes.length === 0) return;

    const atual = botoes.findIndex((b) => b === document.activeElement);
    let alvo: HTMLButtonElement | undefined;
    if (inicio) alvo = botoes[0];
    else if (fim) alvo = botoes[botoes.length - 1];
    else {
      // Foco fora da barra (clique no separador, por exemplo): entra pela ponta
      // coerente com o sentido da seta em vez de pular para o meio.
      const base = atual < 0 ? (passo > 0 ? -1 : 0) : atual;
      alvo = botoes[(base + passo + botoes.length) % botoes.length];
    }
    if (alvo === undefined) return;

    // Seta dentro da barra nao deve rolar a pagina nem mover o grafico.
    e.preventDefault();
    alvo.focus();
    const id = alvo.dataset['itemId'];
    if (id !== undefined) setItemFocado(id);
  }, []);

  // ── Atalhos de tecla unica ────────────────────────────────────────────────
  //
  // Props vao para uma ref para o ouvinte ser registrado UMA vez. `drawings` e
  // objeto novo a cada render do pai; como dependencia, remontaria o ouvinte a
  // cada quadro.
  const vivoRef = useRef({ drawings, gruposVisiveis, executar });
  vivoRef.current = { drawings, gruposVisiveis, executar };

  useEffect(() => {
    if (!shortcutsEnabled) return;

    const aoTeclar = (e: KeyboardEvent): void => {
      // ⚠️ As tres guardas do defeito documentado no cabecalho.
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (focoEmCampoDeTexto()) return;

      const { executar: exec, drawings: d } = vivoRef.current;

      // `Escape` devolve ao modo de selecao. E a saida universal de uma ferramenta
      // — sem ela, sair exige mirar no cursor com o mouse, que e justamente o que
      // a ferramenta ativa dificulta.
      if (e.key === 'Escape') {
        if (d.tool !== null) {
          e.preventDefault();
          d.setTool(null);
        }
        return;
      }

      if (e.key.length !== 1) return;
      const tecla = e.key.toUpperCase();
      // ⚠️ Busca nos grupos VISIVEIS: recolhida, a barra nao deve ativar por
      // teclado uma ferramenta que ela nao mostra — o operador nao teria como ver
      // qual esta ativa.
      for (const g of vivoRef.current.gruposVisiveis) {
        for (const item of g.items) {
          if (item.shortcut === undefined || item.shortcut.toUpperCase() !== tecla) continue;
          e.preventDefault();
          exec(item);
          return;
        }
      }
    };

    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [shortcutsEnabled]);

  const lado: TooltipPlacement = vertical ? 'right' : 'bottom';

  return (
    <div
      ref={barraRef}
      role="toolbar"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label="Ferramentas de desenho"
      className={className ?? 'robustus-drawing-toolbar'}
      onKeyDown={aoTeclarNaBarra}
      style={{
        ...estiloBarra,
        flexDirection: vertical ? 'column' : 'row',
        ...style,
      }}
    >
      {onToggleCollapsed !== undefined && (
        <>
          <BotaoItem
            item={{
              id: 'collapse',
              kind: 'ACTION',
              action: 'collapse',
              // Chevron aponta para onde a barra VAI, nao para onde ela esta: e a
              // convencao que o usuario le sem pensar.
              icon: collapsed ? 'chevronRight' : 'chevronLeft',
              label: collapsed ? 'Mostrar ferramentas' : 'Recolher ferramentas',
              hint: collapsed
                ? 'Abre a barra inteira de volta.'
                : 'Encolhe a barra a uma faixa fina e devolve o espaço ao gráfico.',
            }}
            ativo={undefined}
            desabilitado={false}
            tabulavel={idTabulavel === 'collapse'}
            placement={lado}
            onFocado={setItemFocado}
            onAcionar={() => onToggleCollapsed()}
          />
          <Separador vertical={vertical} />
        </>
      )}

      {gruposVisiveis.map((g, i) => (
        // ⚠️ O separador e IRMAO do grupo, nunca filho: dentro do `role="group"`
        // ele entraria na contagem de itens da familia que o leitor de tela anuncia.
        <Fragment key={g.id}>
          <div
            role="group"
            aria-label={g.label}
            className={`robustus-drawing-toolbar__group robustus-drawing-toolbar__group--${g.id}`}
            data-group-id={g.id}
            style={{ ...estiloGrupo, flexDirection: vertical ? 'column' : 'row' }}
          >
            {g.items.map((item) => {
              const { ativo, desabilitado } = estadoDoItem(item);
              return (
                <BotaoItem
                  key={item.id}
                  item={item}
                  ativo={ativo}
                  desabilitado={desabilitado}
                  tabulavel={idTabulavel === item.id}
                  placement={lado}
                  onFocado={setItemFocado}
                  onAcionar={() => executar(item)}
                />
              );
            })}
          </div>
          {/* Separador ENTRE grupos, nunca depois do ultimo — linha solta no fim
              da barra parece defeito de renderizacao. */}
          {i < gruposVisiveis.length - 1 && <Separador vertical={vertical} />}
        </Fragment>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Um botao
// ═════════════════════════════════════════════════════════════════════════════

interface BotaoItemProps {
  readonly item: ToolbarItem;
  /** `undefined` = o botao nao e de estado, e nao leva `aria-pressed`. */
  readonly ativo: boolean | undefined;
  readonly desabilitado: boolean;
  readonly tabulavel: boolean;
  readonly placement: TooltipPlacement;
  readonly onFocado: (id: string) => void;
  readonly onAcionar: () => void;
}

function BotaoItem({
  item,
  ativo,
  desabilitado,
  tabulavel,
  placement,
  onFocado,
  onAcionar,
}: BotaoItemProps): JSX.Element {
  return (
    <Tooltip label={item.label} hint={item.hint} shortcut={item.shortcut} placement={placement}>
      <button
        type="button"
        // ⚠️ `aria-label` no botao e `aria-describedby` (do Tooltip) sao papeis
        // distintos: o rotulo e o NOME curto que o leitor de tela anuncia ao
        // percorrer; a descricao e a frase de "para que serve". Trocar um pelo
        // outro tornaria a barra ilegivel de percorrer.
        aria-label={item.label}
        {...(ativo === undefined ? {} : { 'aria-pressed': ativo })}
        disabled={desabilitado}
        data-item-id={item.id}
        // Roving tabindex — ver o cabecalho.
        tabIndex={tabulavel ? 0 : -1}
        className={[
          'robustus-drawing-toolbar__button',
          `robustus-drawing-toolbar__button--${item.id}`,
          ativo === true ? 'robustus-drawing-toolbar__button--active' : '',
        ]
          .filter((c) => c !== '')
          .join(' ')}
        style={estiloBotao(ativo === true, desabilitado)}
        onClick={onAcionar}
        onFocus={() => onFocado(item.id)}
      >
        <Icon name={item.icon} />
      </button>
    </Tooltip>
  );
}

function Separador({ vertical }: { readonly vertical: boolean }): JSX.Element {
  return (
    <span
      // ⚠️ A orientacao do separador e PERPENDICULAR a da barra: numa barra
      // vertical a linha que divide grupos e horizontal.
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      className="robustus-drawing-toolbar__separator"
      style={{
        flex: '0 0 auto',
        background: 'rgba(148,163,184,0.25)',
        ...(vertical
          ? { width: '70%', height: 1, margin: '3px auto' }
          : { width: 1, height: '70%', margin: 'auto 3px' }),
      }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Guarda de foco
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O foco esta num lugar onde digitar significa TEXTO?
 *
 * ⚠️ Esta funcao e a correcao do defeito descrito no cabecalho: sem ela, escrever
 * "PETR4" num campo de simbolo ativa o retangulo no `R`.
 */
function focoEmCampoDeTexto(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (el === null) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe
// ═════════════════════════════════════════════════════════════════════════════

const estiloBarra: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.2)',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  // A bolha do tooltip escapa da barra; `overflow: hidden` aqui a cortaria.
  overflow: 'visible',
};

const estiloGrupo: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};

function estiloBotao(ativo: boolean, desabilitado: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // 26 px e o menor alvo que ainda se acerta com o mouse sem mirar; abaixo disso
    // o operador erra o botao vizinho.
    width: 26,
    height: 26,
    padding: 0,
    borderRadius: 5,
    border: '1px solid',
    borderColor: ativo ? 'rgba(56,189,248,0.55)' : 'transparent',
    background: ativo ? 'rgba(56,189,248,0.18)' : 'transparent',
    // ⚠️ O destaque do ativo NAO e so a cor de fundo: quem nao distingue matiz
    // precisa da borda. Duas pistas para o mesmo estado.
    color: 'inherit',
    cursor: desabilitado ? 'default' : 'pointer',
    opacity: desabilitado ? 0.35 : 1,
  };
}
