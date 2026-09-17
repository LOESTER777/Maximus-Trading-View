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

/**
 * ⭐⭐ Uma FAMILIA: um botao que carrega varias variantes da mesma ideia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O RELATO, E O QUE ELE MEDIA DE VERDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"tem redundancia nas ferramentas da esquerda"*.
 *
 * ⚠️ Nao havia ferramenta duplicada — havia dezoito alvos numa tira estreita, e SEIS deles eram
 * icones de linha. `TRENDLINE`, `RAY` e `EXTENDED_LINE` diferem so em ATE ONDE a reta segue;
 * `HORIZONTAL_LINE` e `HORIZONTAL_RAY` diferem so em SE ela vale para a esquerda. Distincoes que
 * importam de verdade numa mesa (um topo das 10h nao era resistencia as 9h) e que, a 14 px numa
 * coluna, sao seis riscos parecidos. A redundancia era de ICONE, nao de ferramenta.
 *
 * ⭐ Uma familia mostra UMA variante — a que esta em uso — e guarda as outras num menu. Dezoito
 * alvos caem para onze, e nenhuma ferramenta foi perdida.
 *
 * ⚠️⚠️ A variante exibida e DERIVADA da ferramenta ativa quando ela pertence a familia, e so cai
 * na memoria quando nao pertence. Sem isso, apertar `H` (linha horizontal) pelo atalho deixaria
 * a familia mostrando "linha de tendencia" ACESA enquanto a ferramenta ativa era outra — a barra
 * afirmando uma coisa e o gesto fazendo outra. Ver `varianteExibida`.
 */
interface ItemFamilia extends ItemBase {
  readonly kind: 'FAMILY';
  /** As variantes, na ordem do menu. A primeira e o default de partida. */
  readonly variantes: readonly ItemTool[];
}

type ToolbarItem = ItemTool | ItemToggle | ItemAction | ItemFamilia;

interface ToolbarGroup {
  readonly id: string;
  /** Nome da familia. Vira `aria-label` do `role="group"`. */
  readonly label: string;
  /**
   * ⭐ A COR da familia. Atende *"ferramentas vivas e em cores para melhor visualizacao"*.
   *
   * ⚠️ Ela pinta o item ATIVO e o anel de foco, nunca o icone em repouso. Uma barra com dez
   * icones coloridos ao mesmo tempo e uma barra sem hierarquia: tudo grita e nada informa. A cor
   * aqui responde "onde eu estou", e para isso ela precisa aparecer em UM lugar de cada vez.
   *
   * ⚠️ E nenhuma delas e verde nem vermelho: os dois significam ALTA e BAIXA em todo pixel deste
   * gráfico, e uma ferramenta acesa em verde seria lida como afirmacao sobre o mercado. Mesma
   * regra que fez o alerta disparado ser ciano.
   */
  readonly cor: string;
  readonly items: readonly ToolbarItem[];
}

/**
 * A variante que a familia deve MOSTRAR.
 *
 * ⭐⭐ Regra: se a ferramenta ativa pertence a familia, e ela — venha de clique, de menu ou de
 * atalho de teclado. Senao, a ultima lembrada; senao, a primeira.
 *
 * ⚠️ Derivar em vez de guardar e o que mantem os tres caminhos de acao coerentes com um estado
 * so. Guardar "a ultima clicada" faria o atalho `H` divergir do que a barra desenha.
 */
function varianteExibida(
  familia: ItemFamilia,
  toolAtiva: ActiveTool,
  memoria: string | undefined,
): ItemTool {
  const daFerramenta = familia.variantes.find((v) => v.tool === toolAtiva);
  if (daFerramenta !== undefined) return daFerramenta;
  const lembrada = familia.variantes.find((v) => v.id === memoria);
  return lembrada ?? (familia.variantes[0] as ItemTool);
}

/** Achata familias para percorrer todo item acionavel (atalho, roving tabindex). */
function itensPlanos(grupos: readonly ToolbarGroup[]): readonly ToolbarItem[] {
  const saida: ToolbarItem[] = [];
  for (const g of grupos) {
    for (const i of g.items) {
      saida.push(i);
      // ⚠️ As variantes entram TAMBEM: os atalhos delas (`T`, `R`, `E`, `H`, `J`, `V`) tem de
      // continuar funcionando com a familia fechada. Uma variante escondida num menu nao pode
      // perder o atalho — quem usa teclado nunca abre o menu.
      if (i.kind === 'FAMILY') saida.push(...i.variantes);
    }
  }
  return saida;
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
    cor: '#94a3b8',
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
    cor: '#38bdf8',
    items: [
      {
        id: 'family-lines',
        kind: 'FAMILY',
        icon: 'trendline',
        label: 'Linhas',
        hint: 'Seis variantes que diferem em ATÉ ONDE a reta vale. Clique para usar a atual; clique direito (ou Alt+↓) para escolher outra.',
        variantes: [
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
            id: 'horizontalRay',
            kind: 'TOOL',
            tool: 'HORIZONTAL_RAY',
            icon: 'horizontalRay',
            label: 'Raio horizontal',
            hint: 'Nível que vale a partir do ponto marcado para a direita — e não antes dele. Um topo formado às 10h não era resistência às 9h.',
            shortcut: 'J',
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
    ],
  },
  {
    // ⚠️ Seta e retângulo ficam SOLTOS, sem família: são duas formas visualmente distintas a
    // 14 px, e agrupá-las esconderia uma atrás de um menu para economizar um alvo. Família se
    // justifica quando os ícones se confundem — que é o caso das seis linhas, não deste.
    id: 'shapes',
    label: 'Formas',
    cor: '#a78bfa',
    items: [
      {
        id: 'arrow',
        kind: 'TOOL',
        tool: 'ARROW',
        icon: 'arrow',
        label: 'Seta',
        hint: 'Aponta para o que importa na tela. Para anotar leitura, não para medir.',
        shortcut: 'N',
      },
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
    cor: '#fbbf24',
    items: [
      {
        id: 'family-measure',
        kind: 'FAMILY',
        icon: 'fibonacci',
        label: 'Medição',
        hint: 'Retração, extensão e régua. Clique para usar a atual; clique direito (ou Alt+↓) para escolher outra.',
        variantes: [
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
            id: 'fibExtension',
            kind: 'TOOL',
            tool: 'FIB_EXTENSION',
            icon: 'fibExtension',
            label: 'Extensão de Fibonacci',
            hint: 'Projeta 127,2%, 161,8%, 200% e 261,8% ALÉM do movimento — onde o preço pode chegar, não onde a correção para.',
            shortcut: 'X',
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
    ],
  },
  {
    // ⭐⭐ Grupo PRÓPRIO, e a separação é decisão: posição não é forma nem medição — é a
    // pergunta que precede a ordem ("quanto perco se estiver errado, quanto ganho se
    // estiver certo"). Enfiá-la entre retângulo e régua a esconderia justamente na
    // ferramenta que um operador usa mais que todas as outras juntas.
    id: 'position',
    label: 'Posição',
    cor: '#22d3ee',
    items: [
      {
        id: 'family-position',
        kind: 'FAMILY',
        icon: 'positionLong',
        label: 'Posição',
        hint: 'Compra e venda com risco-retorno. Clique para usar a atual; clique direito (ou Alt+↓) para trocar o lado.',
        variantes: [
          {
            id: 'positionLong',
            kind: 'TOOL',
            tool: 'POSITION_LONG',
            icon: 'positionLong',
            label: 'Posição de compra',
            hint: 'Marque a ENTRADA e arraste até o STOP. O alvo sai em 2R e as zonas de risco e retorno são pintadas na proporção.',
            shortcut: 'P',
          },
          {
            id: 'positionShort',
            kind: 'TOOL',
            tool: 'POSITION_SHORT',
            icon: 'positionShort',
            label: 'Posição de venda',
            hint: 'Espelho da compra: o stop fica acima da entrada e o alvo abaixo.',
            shortcut: 'O',
          },
        ],
      },
    ],
  },
  {
    id: 'precision',
    label: 'Ajuda de precisão',
    cor: '#f472b6',
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
    cor: '#94a3b8',
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
  /**
   * ⭐ ZOOM da barra: o tamanho do icone em pixel. Default 14, recortado entre 12 e 28.
   *
   * Atende *"zoom de barra de ferramentas"*. ⚠️ E o ICONE que cresce, e o botao acompanha por
   * padding — nao uma escala CSS do conjunto. `transform: scale()` ampliaria a borda e o texto
   * do tooltip junto, e deixaria o alvo de clique fora do lugar em que o navegador o calcula
   * para o teclado.
   *
   * ⚠️ Recortado e nao recusado: 8 px nao e clicavel e 60 px empurra o grafico. O consumidor
   * pediu "grande"; entregar o maior legivel e melhor que ignorar o pedido.
   */
  readonly iconSize?: number;
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
  iconSize = 14,
  className,
  style,
}: DrawingToolbarProps): JSX.Element {
  const vertical = orientation === 'vertical';
  const barraRef = useRef<HTMLDivElement | null>(null);
  /** Item que carrega o `tabIndex=0`. `null` = ainda nao houve interacao. */
  const [itemFocado, setItemFocado] = useState<string | null>(null);
  /**
   * A ultima variante escolhida em cada familia, por id de familia.
   *
   * ⚠️ E MEMORIA, nao verdade: a variante exibida e derivada da ferramenta ativa quando ela
   * pertence a familia (ver `varianteExibida`). Esta memoria so responde "e quando nenhuma
   * variante desta familia esta armada?".
   */
  const [memoriaDeVariante, setMemoriaDeVariante] = useState<Record<string, string>>({});
  /**
   * Ref espelhando a memoria — lida dentro de `executar`, que vive numa ref para o ouvinte de
   * atalho ser registrado uma vez. Ler o estado ali capturaria o valor do render em que o
   * ouvinte nasceu.
   */
  const memoriaRef = useRef(memoriaDeVariante);
  memoriaRef.current = memoriaDeVariante;
  /** Id da familia com o menu ABERTO, ou `null`. Uma por vez. */
  const [familiaAberta, setFamiliaAberta] = useState<string | null>(null);
  // ⭐ Tamanho efetivo do icone, recortado. Ver a prop `iconSize`.
  const tamanhoIcone = Math.min(28, Math.max(12, Math.round(iconSize)));

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
      // ⭐ A familia esta ACESA quando QUALQUER variante dela e a ferramenta ativa. Acender so
      // pela variante exibida seria pior de duas formas: o atalho `H` deixaria a familia apagada
      // com a linha horizontal armada, e o operador nao teria como ver em que familia esta.
      if (item.kind === 'FAMILY') {
        return {
          ativo: item.variantes.some((v) => v.tool === drawings.tool),
          desabilitado: false,
        };
      }
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
        case 'FAMILY':
          // Clicar na familia arma a variante EXIBIDA — o caminho de um clique para a
          // ferramenta que o operador usou por ultimo naquela familia.
          drawings.setTool(varianteExibida(item, drawings.tool, memoriaRef.current[item.id]).tool);
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
    // ⚠️ Familias NAO sao achatadas aqui: o roving tabindex percorre o que esta DESENHADO, e a
    // variante escondida num menu fechado nao tem botao. Achatar poria o `tabIndex=0` num
    // elemento inexistente e a barra sairia da ordem de tabulacao.
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
    // ⚠️ Com `Alt` a seta NAO move o foco: `Alt+↓` e o combo padrao de "abrir o popup" deste
    // botao, e os dois eixos de seta ja estao ocupados pelo roving tabindex (ver o cabecalho).
    // Sem esta linha, `Alt+↓` moveria o foco E abriria o menu de outro item.
    if (e.altKey) return;
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
      // ⚠️ Aqui as familias SAO achatadas (`itensPlanos`): os atalhos das variantes tem de
      // continuar funcionando com o menu fechado. Quem usa teclado nunca abre o menu.
      for (const item of itensPlanos(vivoRef.current.gruposVisiveis)) {
        if (item.shortcut === undefined || item.shortcut.toUpperCase() !== tecla) continue;
        e.preventDefault();
        exec(item);
        return;
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
            cor="#94a3b8"
            tamanhoIcone={tamanhoIcone}
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
              if (item.kind === 'FAMILY') {
                const exibida = varianteExibida(item, drawings.tool, memoriaDeVariante[item.id]);
                return (
                  <BotaoFamilia
                    key={item.id}
                    familia={item}
                    exibida={exibida}
                    ativo={ativo === true}
                    aberta={familiaAberta === item.id}
                    cor={g.cor}
                    tamanhoIcone={tamanhoIcone}
                    tabulavel={idTabulavel === item.id}
                    placement={lado}
                    vertical={vertical}
                    onFocado={setItemFocado}
                    onAcionar={() => executar(item)}
                    onAbrir={(abre) => setFamiliaAberta(abre ? item.id : null)}
                    onEscolher={(v) => {
                      setMemoriaDeVariante((m) => ({ ...m, [item.id]: v.id }));
                      setFamiliaAberta(null);
                      drawings.setTool(v.tool);
                    }}
                  />
                );
              }
              return (
                <BotaoItem
                  key={item.id}
                  item={item}
                  ativo={ativo}
                  desabilitado={desabilitado}
                  cor={g.cor}
                  tamanhoIcone={tamanhoIcone}
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
  /** Cor da familia. Pinta SO o estado ativo — ver `ToolbarGroup.cor`. */
  readonly cor: string;
  readonly tamanhoIcone: number;
  readonly tabulavel: boolean;
  readonly placement: TooltipPlacement;
  readonly onFocado: (id: string) => void;
  readonly onAcionar: () => void;
}

function BotaoItem({
  item,
  ativo,
  desabilitado,
  cor,
  tamanhoIcone,
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
        // ⭐ `aria-keyshortcuts` é o atributo padrão para "esta tecla aciona isto", e ele
        // faltava: o atalho existia no código e era invisível para leitor de tela — quem
        // navega por voz não tinha como descobrir que a barra tem atalhos.
        //
        // ⚠️ E é ele que torna a COLISÃO de atalho testável. Ela aconteceu de verdade: a
        // seta nasceu com `A`, que o ímã já usava, e a extensão de Fibonacci com `E`, da
        // reta infinita. O sintoma não é erro nenhum — o atalho aciona o primeiro item que
        // casa, e o operador aperta a tecla de sempre e recebe outra ferramenta.
        {...(item.shortcut === undefined ? {} : { 'aria-keyshortcuts': item.shortcut })}
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
        style={estiloBotao(ativo === true, desabilitado, cor, tamanhoIcone)}
        onClick={onAcionar}
        onFocus={() => onFocado(item.id)}
      >
        <Icon name={item.icon} size={tamanhoIcone} />
      </button>
    </Tooltip>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ Uma FAMILIA: um botao com menu de variantes
// ═════════════════════════════════════════════════════════════════════════════

interface BotaoFamiliaProps {
  readonly familia: ItemFamilia;
  readonly exibida: ItemTool;
  readonly ativo: boolean;
  readonly aberta: boolean;
  readonly cor: string;
  readonly tamanhoIcone: number;
  readonly tabulavel: boolean;
  readonly placement: TooltipPlacement;
  readonly vertical: boolean;
  readonly onFocado: (id: string) => void;
  readonly onAcionar: () => void;
  readonly onAbrir: (abrir: boolean) => void;
  readonly onEscolher: (v: ItemTool) => void;
}

/**
 * O botao de familia: clique ARMA a variante exibida, e tres gestos ABREM o menu.
 *
 * ⭐ Os tres caminhos de abertura existem porque cada um cobre um jeito de operar, e nenhum
 * deles custa um alvo novo na barra:
 *
 *  - **clique direito** — o gesto de mouse para "outras opcoes", e aqui e um botao, nao a area
 *    do grafico, entao nao rouba menu de contexto de nada que importe;
 *  - **pressao longa** (400 ms) — o equivalente em TOQUE, onde nao existe clique direito;
 *  - **`Alt+↓` / `Alt+Enter`** — o combo padrao de "abrir popup" no teclado. `Alt` esta livre
 *    porque os dois eixos de seta ja movem o foco (roving tabindex) e o ouvinte de atalho de
 *    tecla unica ignora eventos com modificador.
 *
 * ⚠️ A alternativa comum — um segundo botao de setinha ao lado — foi REJEITADA: ela devolveria
 * a barra aos dezoito alvos que a familia existe para reduzir. O triangulo no canto e a
 * affordance visual, e o `hint` do tooltip diz como abrir.
 *
 * ⚠️ `role="menu"` com `menuitemradio` e nao `listbox`: sao ACOES que tambem tem estado de
 * escolha, e `radio` e o que anuncia "uma destas esta selecionada".
 */
function BotaoFamilia({
  familia,
  exibida,
  ativo,
  aberta,
  cor,
  tamanhoIcone,
  tabulavel,
  placement,
  vertical,
  onFocado,
  onAcionar,
  onAbrir,
  onEscolher,
}: BotaoFamiliaProps): JSX.Element {
  const pressaoRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const botaoRef = useRef<HTMLButtonElement | null>(null);

  // ⚠️ Ao abrir, o foco vai para o menu: sem isso o teclado continuaria na barra e as setas
  // moveriam o foco por tras de um menu aberto — o operador veria o menu e navegaria outra coisa.
  useEffect(() => {
    if (!aberta) return;
    const primeiro = menuRef.current?.querySelector<HTMLButtonElement>('button');
    primeiro?.focus();
  }, [aberta]);

  const cancelarPressao = (): void => {
    if (pressaoRef.current !== null) {
      window.clearTimeout(pressaoRef.current);
      pressaoRef.current = null;
    }
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip
        label={exibida.label}
        hint={`${exibida.hint} · ${familia.hint}`}
        shortcut={exibida.shortcut}
        placement={placement}
      >
        <button
          ref={botaoRef}
          type="button"
          aria-label={exibida.label}
          aria-pressed={ativo}
          // ⭐ Anuncia que ha um menu, e se ele esta aberto. Sem isto o leitor de tela nao teria
          // como saber que existem outras variantes atras deste botao.
          aria-haspopup="menu"
          aria-expanded={aberta}
          {...(exibida.shortcut === undefined ? {} : { 'aria-keyshortcuts': exibida.shortcut })}
          data-item-id={familia.id}
          data-family-current={exibida.id}
          tabIndex={tabulavel ? 0 : -1}
          className={[
            'robustus-drawing-toolbar__button',
            `robustus-drawing-toolbar__button--${familia.id}`,
            ativo ? 'robustus-drawing-toolbar__button--active' : '',
          ]
            .filter((c) => c !== '')
            .join(' ')}
          style={estiloBotao(ativo, false, cor, tamanhoIcone)}
          onClick={onAcionar}
          onFocus={() => onFocado(familia.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            onAbrir(!aberta);
          }}
          onPointerDown={() => {
            cancelarPressao();
            pressaoRef.current = window.setTimeout(() => onAbrir(true), 400);
          }}
          onPointerUp={cancelarPressao}
          onPointerLeave={cancelarPressao}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowDown' || e.key === 'Enter')) {
              e.preventDefault();
              e.stopPropagation();
              onAbrir(true);
            }
          }}
        >
          <Icon name={exibida.icon} size={tamanhoIcone} />
          {/* ⚠️ A affordance de "ha mais aqui": um triangulo no canto inferior direito, em CSS
              puro. Um icone extra ocuparia espaco do proprio icone da ferramenta a 14 px. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 0,
              height: 0,
              borderLeft: '3px solid transparent',
              borderTop: '3px solid transparent',
              borderRight: `3px solid ${ativo ? cor : 'rgba(148,163,184,0.55)'}`,
              borderBottom: `3px solid ${ativo ? cor : 'rgba(148,163,184,0.55)'}`,
            }}
          />
        </button>
      </Tooltip>

      {aberta && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Variantes de ${familia.label}`}
          className="robustus-drawing-toolbar__menu"
          style={{
            position: 'absolute',
            zIndex: 40,
            ...(vertical ? { left: '100%', top: 0, marginLeft: 6 } : { top: '100%', left: 0, marginTop: 6 }),
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 4,
            minWidth: 190,
            borderRadius: 7,
            border: '1px solid rgba(148,163,184,0.28)',
            background: 'rgba(15,23,42,0.97)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
          onKeyDown={(e) => {
            // ⚠️ `stopPropagation` em tudo: as setas aqui navegam o MENU, e sem isto elas
            // subiriam para o roving tabindex da barra e moveriam o foco para fora do menu.
            if (e.key === 'Escape') {
              e.stopPropagation();
              onAbrir(false);
              botaoRef.current?.focus();
              return;
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            e.stopPropagation();
            const itens = Array.from(
              menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
            );
            const i = itens.findIndex((b) => b === document.activeElement);
            const passo = e.key === 'ArrowDown' ? 1 : -1;
            itens[(Math.max(0, i) + passo + itens.length) % itens.length]?.focus();
          }}
          // Clicar fora fecha: o `blur` do container cobre mouse e teclado de uma vez.
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onAbrir(false);
          }}
        >
          {familia.variantes.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.id === exibida.id}
              data-item-id={`${familia.id}:${v.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '5px 7px',
                fontSize: 11,
                fontFamily: 'inherit',
                textAlign: 'left',
                borderRadius: 5,
                border: '1px solid transparent',
                borderColor: v.id === exibida.id ? cor : 'transparent',
                background: v.id === exibida.id ? 'rgba(148,163,184,0.14)' : 'transparent',
                color: '#e2e8f0',
                cursor: 'pointer',
              }}
              onClick={() => onEscolher(v)}
            >
              <Icon name={v.icon} size={14} />
              <span style={{ flex: 1 }}>{v.label}</span>
              {v.shortcut !== undefined && (
                <kbd
                  style={{
                    fontSize: 9,
                    padding: '0 3px',
                    borderRadius: 3,
                    border: '1px solid rgba(148,163,184,0.3)',
                    opacity: 0.75,
                  }}
                >
                  {v.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
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

/**
 * O estilo de um botao da barra.
 *
 * ⭐ A COR da familia entra aqui, e SO no estado ativo (ver `ToolbarGroup.cor`). Em repouso o
 * icone e neutro: dez icones coloridos ao mesmo tempo e uma barra sem hierarquia, onde tudo
 * grita e nada informa. A cor responde "onde eu estou".
 *
 * ⚠️ Tres pistas para o mesmo estado, e nao uma: fundo, BORDA e o icone tingido. Quem nao
 * distingue matiz le a borda; quem esta a um metro da tela le o fundo. Uma pista so — a cor —
 * excluiria os dois.
 *
 * ⭐ O ZOOM cresce o icone E o botao junto (`tamanho`), em vez de escalar o conjunto por CSS.
 * `transform: scale()` ampliaria a borda, o raio e o tooltip, e deixaria o alvo de clique
 * calculado pelo navegador fora do lugar desenhado.
 */
function estiloBotao(
  ativo: boolean,
  desabilitado: boolean,
  cor = '#38bdf8',
  tamanhoIcone = 14,
): CSSProperties {
  // 26 px e o menor alvo que ainda se acerta com o mouse sem mirar; abaixo disso o operador erra
  // o botao vizinho. O `+12` de folga mantem essa proporcao quando o icone cresce.
  const lado = Math.max(26, tamanhoIcone + 12);
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: lado,
    height: lado,
    padding: 0,
    borderRadius: 5,
    border: '1px solid',
    borderColor: ativo ? cor : 'transparent',
    background: ativo ? `${cor}2e` : 'transparent',
    // ⚠️ O icone tingido e a TERCEIRA pista, e a que sobrevive a tema claro.
    color: ativo ? cor : 'inherit',
    cursor: desabilitado ? 'default' : 'pointer',
    opacity: desabilitado ? 0.35 : 1,
  };
}
