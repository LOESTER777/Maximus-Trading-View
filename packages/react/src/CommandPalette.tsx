/**
 * CommandPalette — TODO recurso alcancavel por busca, em dois toques.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE UMA PALETA, E NAO MAIS BOTOES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido foi explicito: *"nao se pode encher a tela de botoes, precisamos saber
 * o que e e para que"*. A biblioteca tem 29 indicadores, 8 ferramentas de
 * desenho, 6 tipos de grafico, alertas, replay, persistencia de layout e umas
 * duas dezenas de opcoes de ambiente. Isso e da ordem de 80 comandos. Nao existe
 * barra de ferramentas que caiba 80 icones e continue legivel: a partir de umas
 * 12 affordances o operador para de VER a barra e passa a procurar nela.
 *
 * A resposta e a mesma que VS Code, Linear e Figma deram: a barra visivel fica
 * so com o que se usa a toda hora, e o resto vive numa paleta com **campo de
 * busca**, alcancada por um atalho. O custo de descobrir um recurso deixa de ser
 * "varrer a tela" e passa a ser "digitar o que eu quero" — que e mais rapido
 * mesmo para quem sabe onde o botao esta.
 *
 * ⭐ **O `hint` e o coracao do "saber o que e e para que".** Cada comando carrega
 * uma frase, e a frase do item SELECIONADO aparece no rodape da paleta. Nao e
 * tooltip: nao depende de parar o mouse em cima, aparece durante a navegacao por
 * teclado, e nao tem tempo de espera. Quem esta navegando com as setas le a
 * explicacao de cada comando ao passar por ele.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ACESSIBILIDADE AQUI NAO E DECORACAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A paleta e um `combobox` com `listbox`, no padrao ARIA. A parte que costuma
 * ser esquecida e a que mais importa: **`aria-activedescendant`**. O foco do DOM
 * NUNCA sai do `<input>` (senao as setas parariam de digitar e a busca quebraria),
 * entao o leitor de tela nao tem como saber qual item a seta selecionou — a
 * unica coisa que anuncia isso e o `aria-activedescendant` do input apontando
 * para o `id` da opcao corrente. Sem ele, um usuario de leitor de tela ouve o
 * campo de busca e mais nada, e a paleta e inutilizavel.
 *
 * As tres armadilhas de modal que este componente resolve, e que sao defeito real
 * em praticamente toda paleta escrita a mao:
 *
 *  1. **Devolucao de foco.** Ao fechar, o foco volta para o elemento que o tinha
 *     antes de abrir. Sem isso o `Tab` seguinte recomeca do topo da pagina, e
 *     quem usa teclado perde o lugar.
 *  2. **Armadilha de foco.** `Tab` circula DENTRO da paleta. Sem isso o foco
 *     escapa para o gráfico atras do overlay, que esta visualmente coberto — o
 *     usuario passa a operar as cegas.
 *  3. **Clique no overlay fecha, clique dentro nao.** Testado por
 *     `event.target === event.currentTarget`, e no `mousedown` e nao no `click`:
 *     arrastar do interior para fora e soltar produz um `click` cujo alvo e o
 *     overlay, e a paleta fecharia por causa de uma selecao de texto.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Icon, type IconName } from './icons.js';
import { fuzzyMatch, type FuzzyMatch } from './fuzzy.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Contrato
// ═════════════════════════════════════════════════════════════════════════════

/** Um comando da paleta. */
export interface Command {
  /** Identidade estavel. Vai para o `key` do React e para o `id` da opcao. */
  readonly id: string;
  /** O que o operador le e o que a busca casa (e destaca). */
  readonly label: string;
  /** Cabecalho sob o qual o comando aparece: `'Indicadores'`, `'Desenho'`… */
  readonly group: string;
  readonly icon?: IconName;
  /**
   * O "para que serve", em uma frase.
   *
   * ⭐ Aparece no RODAPE quando o comando esta selecionado — ver o cabecalho.
   * Deliberadamente nao entra na busca: `hint` e frase, e frase casa com
   * qualquer coisa numa busca por subsequencia, enchendo o resultado de ruido.
   * Termo alternativo de busca vai em `keywords`.
   */
  readonly hint?: string;
  /** Atalho a exibir a direita, ja formatado (ex.: `'Ctrl+K'`). */
  readonly shortcut?: string;
  /**
   * Termos alternativos que a busca aceita, alem do rotulo e do grupo.
   *
   * Para `"Média Móvel Exponencial"` valeria `['ema', 'exponential']` — o
   * operador que aprendeu no ingles acha, e quem le em portugues tambem.
   */
  readonly keywords?: readonly string[];
  /** O que executar. Chamado uma vez, e a paleta fecha em seguida. */
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly commands: readonly Command[];
  /** Controlado: a paleta nao guarda o proprio `open`. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly placeholder?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// O atalho global
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Registra **Ctrl+K** (e **Cmd+K** no macOS) na janela.
 *
 * ⚠️ **Este atalho NAO ignora campo de texto, e isso e deliberado.** A regra que
 * se aprende — "atalho nao dispara enquanto o usuario digita" — vale para atalho
 * de LETRA SOLTA (`c` para vela, `t` para linha de tendencia): ali o teclado
 * pertence ao campo, e roubar a tecla apagaria o que a pessoa esta escrevendo.
 * `Ctrl+K` e ACORDE: nenhum caractere e produzido, nao existe conflito com a
 * digitacao, e o padrao de mercado (VS Code, Linear, Slack, GitHub) e que ele
 * funcione de qualquer lugar. Um atalho de paleta que morre dentro de um input e
 * pior que nao ter atalho, porque ele falha exatamente quando o usuario esta
 * concentrado.
 *
 * ⚠️ **`preventDefault` e obrigatorio.** Sem ele o Firefox abre a barra de busca
 * nativa junto com a paleta, e o Chrome move o foco para a omnibox — o usuario ve
 * a paleta abrir e o que digita vai para outro lugar.
 *
 * ⚠️ **`e.altKey` barra o atalho.** No teclado ABNT2 e em varios layouts
 * europeus, `AltGr` chega como `ctrlKey && altKey`; sem a guarda, digitar um
 * caractere de terceiro nivel abriria a paleta do nada.
 *
 * @example
 * const [aberta, setAberta] = useState(false);
 * useCommandPaletteHotkey(() => setAberta(true));
 * return <CommandPalette open={aberta} onOpenChange={setAberta} commands={cmds} />;
 */
export function useCommandPaletteHotkey(onOpen: () => void): void {
  // O callback vive num ref para que o ouvinte seja registrado UMA vez. Sem
  // isso, um `onOpen` recriado a cada render (o caso normal, uma arrow inline)
  // removeria e reinstalaria o ouvinte por render — e uma tecla pressionada
  // durante a troca cairia no vazio.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (e: globalThis.KeyboardEvent): void => {
      if (e.altKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // `e.key` e não `e.code`: em layout Dvorak/ABNT o `code` da tecla K nao e
      // 'KeyK', e o que o usuario aprendeu foi a LETRA, nao a posicao fisica.
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      onOpenRef.current();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

// ═════════════════════════════════════════════════════════════════════════════
// Ranqueamento — puro, e por isso testavel sem montar nada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Penalidade de quem casou por termo alternativo (grupo ou `keywords`) e nao
 * pelo rotulo.
 *
 * ⚠️ Alta de proposito, para ser INTRANSPONIVEL: qualquer casamento no rotulo
 * vence qualquer casamento em termo alternativo. O operador so ve o rotulo; um
 * item cujo rotulo nao contem as letras digitadas aparecendo ACIMA de um que
 * contem parece defeito, mesmo quando a pontuacao "justifica".
 */
const PENALIDADE_ALTERNATIVO = -10_000;

/** Um comando ja casado, com o destaque a aplicar no rotulo. */
export interface RankedCommand {
  readonly command: Command;
  /** Trechos a destacar no `label`. Vazio quando casou por termo alternativo. */
  readonly ranges: readonly [number, number][];
}

/** Um grupo na ordem de exibicao. */
export interface RankedGroup {
  readonly group: string;
  readonly items: readonly RankedCommand[];
}

/**
 * Casa um comando: primeiro pelo rotulo, e so depois por grupo/`keywords`.
 *
 * ⚠️ **Quem casa por termo alternativo NAO recebe destaque** (`ranges` vazio). O
 * indice casado pertence ao termo, nao ao rotulo — aplica-lo ao rotulo poria
 * negrito em letras aleatorias, e um destaque que nao corresponde ao que foi
 * digitado destroi a confianca na busca inteira.
 */
function matchCommand(query: string, cmd: Command): { score: number; ranges: readonly [number, number][] } | null {
  const noRotulo: FuzzyMatch | null = fuzzyMatch(query, cmd.label);
  if (noRotulo !== null) return { score: noRotulo.score, ranges: noRotulo.ranges };

  let melhor: number | null = null;
  const alternativos = cmd.keywords === undefined ? [cmd.group] : [cmd.group, ...cmd.keywords];
  for (const termo of alternativos) {
    const m = fuzzyMatch(query, termo);
    if (m === null) continue;
    if (melhor === null || m.score > melhor) melhor = m.score;
  }
  if (melhor === null) return null;
  return { score: melhor + PENALIDADE_ALTERNATIVO, ranges: [] };
}

/**
 * Ordena e agrupa os comandos para uma busca. Funcao PURA.
 *
 * ⭐ **Os grupos saem na ordem do MELHOR item de cada um**, e nao numa ordem fixa
 * de grupo. E o que garante que o primeiro item da tela seja sempre o melhor
 * casamento: com ordem fixa, digitar `"bol"` mostraria primeiro o cabecalho
 * "Ambiente" com um casamento fraco e enterraria **Bollinger** tres grupos
 * abaixo. Dentro do grupo, a ordem e a da pontuacao (ver `fuzzyRank`, cujo
 * desempate e o indice de entrada — determinismo por construcao).
 *
 * `flat` e a lista na MESMA ordem visual, e e sobre ela que as setas navegam: o
 * indice de selecao precisa ignorar cabecalho de grupo, senao a seta "para" numa
 * linha que nao e comando.
 */
export function rankCommands(
  query: string,
  commands: readonly Command[],
): { readonly groups: readonly RankedGroup[]; readonly flat: readonly RankedCommand[] } {
  const casados: Array<{ ranked: RankedCommand; score: number; index: number }> = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i] as Command;
    const m = matchCommand(query, cmd);
    if (m === null) continue;
    casados.push({ ranked: { command: cmd, ranges: m.ranges }, score: m.score, index: i });
  }

  // Desempate pelo indice de entrada — ver `fuzzyRank`. Nao dependemos da
  // estabilidade do `sort` do motor.
  casados.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

  const ordemDoGrupo: string[] = [];
  const porGrupo = new Map<string, RankedCommand[]>();
  for (const c of casados) {
    const nome = c.ranked.command.group;
    let lista = porGrupo.get(nome);
    if (lista === undefined) {
      lista = [];
      porGrupo.set(nome, lista);
      ordemDoGrupo.push(nome);
    }
    lista.push(c.ranked);
  }

  const groups: RankedGroup[] = ordemDoGrupo.map((nome) => ({
    group: nome,
    items: porGrupo.get(nome) ?? [],
  }));
  const flat: RankedCommand[] = [];
  for (const g of groups) flat.push(...g.items);

  return { groups, flat };
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A paleta de comandos.
 *
 * @example
 * const [aberta, setAberta] = useState(false);
 * useCommandPaletteHotkey(() => setAberta(true));
 * <CommandPalette
 *   open={aberta}
 *   onOpenChange={setAberta}
 *   commands={[
 *     { id: 'ema', label: 'Média Móvel Exponencial', group: 'Indicadores',
 *       icon: 'indicator', hint: 'Média que pesa mais as barras recentes.',
 *       keywords: ['ema'], run: () => catalog.add('ema') },
 *   ]}
 * />
 */
export function CommandPalette({
  commands,
  open,
  onOpenChange,
  placeholder = 'Buscar comando…',
  emptyMessage = 'Nenhum comando corresponde à busca.',
  className,
  style,
}: CommandPaletteProps): JSX.Element | null {
  const uid = useId();
  const idLista = `${uid}-lista`;
  const idRodape = `${uid}-hint`;

  const [query, setQuery] = useState('');
  const [selecionado, setSelecionado] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  /** Quem tinha o foco antes de abrir. `null` = ninguem util. */
  const gatilhoRef = useRef<HTMLElement | null>(null);

  const { groups, flat } = useMemo(() => rankCommands(query, commands), [query, commands]);

  /**
   * O indice efetivo, CLAMPADO na renderizacao.
   *
   * ⚠️ Clampar aqui em vez de num efeito que corrige `selecionado` evita o quadro
   * intermediario em que a selecao aponta para fora da lista: filtrar de 40 itens
   * para 2 com a selecao em 7 renderizaria uma vez sem `aria-activedescendant`
   * valido, e o leitor de tela anunciaria o desaparecimento do item.
   */
  const indice = flat.length === 0 ? -1 : Math.min(Math.max(selecionado, 0), flat.length - 1);
  const atual = indice < 0 ? null : (flat[indice] ?? null);
  const idOpcao = (i: number): string => `${uid}-o${i}`;

  /**
   * O indice do PRIMEIRO item de cada grupo dentro de `flat`.
   *
   * `flat` e a concatenacao dos grupos na ordem de exibicao, entao o indice de
   * navegacao de cada item e `deslocamento[g] + posicao no grupo`. E aritmetica
   * em vez de `flat.indexOf(item)` por render: a busca linear por item faria a
   * renderizacao ser O(n²) sobre uma lista que e refeita a cada tecla.
   */
  const deslocamentos = useMemo(() => {
    const saida: number[] = [];
    let acc = 0;
    for (const g of groups) {
      saida.push(acc);
      acc += g.items.length;
    }
    return saida;
  }, [groups]);

  // ── Ao abrir: zera a busca ─────────────────────────────────────────────────
  //
  // A paleta abre SEMPRE limpa. Guardar a ultima busca parece util e nao e: o
  // texto herdado ja vem selecionado ou nao, e nos dois casos a primeira tecla
  // produz um resultado que o usuario nao pediu.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelecionado(0);
  }, [open]);

  // ── Foco: toma ao abrir, DEVOLVE ao fechar ────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;

    const anterior = document.activeElement;
    gatilhoRef.current =
      anterior instanceof HTMLElement && anterior !== document.body ? anterior : null;
    inputRef.current?.focus();

    return () => {
      const gatilho = gatilhoRef.current;
      gatilhoRef.current = null;
      // Elemento que saiu do documento no meio (o proprio comando pode ter
      // desmontado o botao que o abriu): focar um no desconectado nao faz nada,
      // mas ler `isConnected` deixa a intencao explicita.
      if (gatilho === null || !gatilho.isConnected) return;
      if (typeof gatilho.focus !== 'function') return;

      // ⭐ Devolve o foco APENAS se ninguem o tomou.
      //
      // Um comando pode mover o foco de proposito — "Desenhar linha de
      // tendencia" foca a tela do grafico, "Configurar alerta" foca o campo de
      // preco. Devolver o foco ao gatilho nesses casos ARRANCARIA o foco do lugar
      // certo, e o usuario de teclado voltaria para o botao em vez de continuar.
      // Quando o input e desmontado sem que nada assuma, o `activeElement` cai
      // para o `<body>` — e e exatamente esse o caso em que a devolucao e devida.
      const ativo = document.activeElement;
      if (ativo !== null && ativo !== document.body && ativo !== document.documentElement) return;
      gatilho.focus();
    };
  }, [open]);

  // ── Rolar o item selecionado para a vista ─────────────────────────────────
  useEffect(() => {
    if (!open || indice < 0) return;
    const lista = listaRef.current;
    if (lista === null) return;
    // ⚠️ `getElementById` e nao `querySelector('#…')`: `useId` do React devolve
    // algo como `:r1:`, e dois-pontos e sintaxe de pseudo-classe — o seletor
    // `#:r1:-o0` lanca `SyntaxError`. `getElementById` nao passa por parser de
    // seletor, entao o id pode conter o que quiser.
    const el = lista.ownerDocument.getElementById(`${uid}-o${indice}`);
    if (el === null) return;
    // ⚠️ O jsdom NAO implementa `scrollIntoView` — o metodo nao existe no
    // prototipo, e chamar daria `TypeError` em TODO teste que navegue com as
    // setas. A guarda e por isso, e nao por navegador antigo.
    if (typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest' });
  }, [open, indice, uid]);

  const fechar = useCallback((): void => onOpenChange(false), [onOpenChange]);

  const executar = useCallback(
    (ranked: RankedCommand | null): void => {
      if (ranked === null) return;
      // Fecha ANTES de executar: o comando pode abrir outro painel ou mover o
      // foco, e a paleta ainda montada por cima disso piscaria na frente.
      onOpenChange(false);
      try {
        ranked.command.run();
      } catch {
        // ⚠️ `throw` de um comando NAO pode derrubar a arvore.
        //
        // E a mesma disciplina da camada de desenho: excecao dentro do ciclo
        // leva o grafico inteiro. Aqui e pior, porque o comando e codigo do
        // CONSUMIDOR — a paleta nao tem como saber se ele e seguro. A paleta ja
        // fechou; o erro fica contido em quem o produziu, a quem cabe reportar.
      }
    },
    [onOpenChange],
  );

  // ── Teclado ───────────────────────────────────────────────────────────────
  const aoTeclar = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fechar();
        return;
      }

      if (e.key === 'Tab') {
        // Armadilha de foco: `Tab` circula dentro da paleta. Ver o cabecalho.
        const focaveis = focaveisEm(dialogRef.current);
        if (focaveis.length === 0) return;
        e.preventDefault();
        const primeiro = focaveis[0] as HTMLElement;
        const ultimo = focaveis[focaveis.length - 1] as HTMLElement;
        const ativo = typeof document === 'undefined' ? null : document.activeElement;
        const pos = focaveis.indexOf(ativo as HTMLElement);
        if (e.shiftKey) {
          (pos <= 0 ? ultimo : (focaveis[pos - 1] as HTMLElement)).focus();
        } else {
          (pos < 0 || pos === focaveis.length - 1 ? primeiro : (focaveis[pos + 1] as HTMLElement)).focus();
        }
        return;
      }

      if (flat.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          // Circula: chegar no fim e continuar leva ao primeiro. Numa lista
          // filtrada e curta, parar no fim faz o usuario achar que travou.
          setSelecionado((s) => (clamp(s, flat.length) + 1) % flat.length);
          return;
        case 'ArrowUp':
          e.preventDefault();
          setSelecionado((s) => (clamp(s, flat.length) - 1 + flat.length) % flat.length);
          return;
        case 'Home':
          e.preventDefault();
          setSelecionado(0);
          return;
        case 'End':
          e.preventDefault();
          setSelecionado(flat.length - 1);
          return;
        case 'Enter':
          e.preventDefault();
          executar(atual);
          return;
        default:
          return;
      }
    },
    [atual, executar, fechar, flat.length],
  );

  const aoMouseDownNoOverlay = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      // Clique DENTRO nao fecha: so fecha quando o alvo e o proprio overlay.
      if (e.target !== e.currentTarget) return;
      fechar();
    },
    [fechar],
  );

  if (!open) return null;

  return (
    <div
      className="robustus-palette__overlay"
      style={estiloOverlay}
      onMouseDown={aoMouseDownNoOverlay}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        className={className ?? 'robustus-palette'}
        style={{ ...estiloDialogo, ...style }}
        onKeyDown={aoTeclar}
      >
        {/* ── Campo de busca ─────────────────────────────────────────────── */}
        <div className="robustus-palette__search" style={estiloBusca}>
          <Icon name="search" size={15} style={{ opacity: 0.6 }} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-label="Buscar comando"
            {...(atual === null ? {} : { 'aria-activedescendant': idOpcao(indice) })}
            {...(atual?.command.hint === undefined ? {} : { 'aria-describedby': idRodape })}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Toda tecla volta a selecao para o topo: o melhor casamento da
              // busca NOVA e o primeiro item, e manter o indice antigo deixaria
              // a selecao num item que o usuario nem estava olhando.
              setSelecionado(0);
            }}
            style={estiloInput}
            // A paleta e busca de comando, nao formulario: sugestao do navegador
            // e corretor automatico so atrapalham.
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="robustus-palette__kbd" style={estiloKbd} aria-hidden="true">
            esc
          </kbd>
        </div>

        {/* ── Resultados ─────────────────────────────────────────────────── */}
        {/*
          `div` com `role="listbox"` em vez de `<ul>`: os unicos filhos validos de
          um `listbox` sao `option` e `group`, e um `<li>` de cabecalho de grupo
          nao e nenhum dos dois. Marcacao ARIA invalida nao e cosmetica — o leitor
          de tela deixa de contar os itens ("1 de 12") quando ha filho estranho.
        */}
        <div
          ref={listaRef}
          id={idLista}
          role="listbox"
          aria-label="Comandos"
          className="robustus-palette__list"
          style={estiloLista}
        >
          {flat.length === 0 ? (
            <p role="status" className="robustus-palette__empty" style={estiloVazio}>
              {emptyMessage}
            </p>
          ) : (
            groups.map((g, gi) => {
              const idCabecalho = `${uid}-g${gi}`;
              const base = deslocamentos[gi] ?? 0;
              return (
                <div key={g.group} role="group" aria-labelledby={idCabecalho}>
                  <div id={idCabecalho} className="robustus-palette__group" style={estiloGrupo}>
                    {g.group}
                  </div>
                  {g.items.map((item, ii) => {
                    const i = base + ii;
                    const selecionadoAqui = i === indice;
                    return (
                      <div
                        key={item.command.id}
                        id={idOpcao(i)}
                        role="option"
                        aria-selected={selecionadoAqui}
                        className={
                          selecionadoAqui
                            ? 'robustus-palette__option robustus-palette__option--active'
                            : 'robustus-palette__option'
                        }
                        style={estiloOpcao(selecionadoAqui)}
                        // ⚠️ `preventDefault` no `mousedown`: sem ele o navegador
                        // move o foco para o item clicado, o `<input>` perde o
                        // foco e `aria-activedescendant` deixa de valer — as
                        // setas param de funcionar depois do primeiro clique.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => executar(item)}
                        // Passar o mouse seleciona: o rodape passa a mostrar o
                        // `hint` daquele item, que e o "para que serve" sem
                        // tooltip e sem tempo de espera.
                        onMouseMove={() => setSelecionado(i)}
                      >
                        {item.command.icon === undefined ? (
                          <span aria-hidden="true" style={{ width: 16, flexShrink: 0 }} />
                        ) : (
                          <Icon name={item.command.icon} size={16} style={{ opacity: 0.8 }} />
                        )}
                        <span className="robustus-palette__label" style={{ flex: 1, minWidth: 0 }}>
                          {destacar(item.command.label, item.ranges)}
                        </span>
                        {item.command.shortcut !== undefined && (
                          <kbd className="robustus-palette__kbd" style={estiloKbd}>
                            {item.command.shortcut}
                          </kbd>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Rodape: o "o que e e para que" do item selecionado ─────────── */}
        <div className="robustus-palette__footer" style={estiloRodape}>
          <span id={idRodape} className="robustus-palette__hint" style={estiloHint}>
            {atual?.command.hint ?? ''}
          </span>
          <span aria-hidden="true" style={{ ...estiloHint, whiteSpace: 'nowrap' }}>
            ↑↓ navegar · ↵ executar · esc fechar
          </span>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parte o rotulo nos trechos casados e poe os casados em `<strong>`.
 *
 * ⭐ E o que faz a busca PARECER inteligente: sem destaque, o usuario que digita
 * `"ps"` e recebe **Parabolic SAR** nao entende por que aquele item apareceu, e
 * conclui que a busca esta errada. Com as letras marcadas, ele ve o motivo.
 */
function destacar(label: string, ranges: readonly [number, number][]): JSX.Element {
  if (ranges.length === 0) return <>{label}</>;

  const partes: JSX.Element[] = [];
  let cursor = 0;
  for (const [inicio, fim] of ranges) {
    if (inicio > cursor) partes.push(<span key={`n${cursor}`}>{label.slice(cursor, inicio)}</span>);
    partes.push(
      <strong key={`m${inicio}`} className="robustus-palette__match" style={estiloDestaque}>
        {label.slice(inicio, fim)}
      </strong>,
    );
    cursor = fim;
  }
  if (cursor < label.length) partes.push(<span key={`n${cursor}`}>{label.slice(cursor)}</span>);
  return <>{partes}</>;
}

/** Os elementos focaveis dentro do dialogo, na ordem do documento. */
function focaveisEm(raiz: HTMLElement | null): HTMLElement[] {
  if (raiz === null) return [];
  const seletor =
    'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  return Array.from(raiz.querySelectorAll<HTMLElement>(seletor)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

function clamp(valor: number, tamanho: number): number {
  if (tamanho <= 0) return 0;
  return Math.min(Math.max(valor, 0), tamanho - 1);
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe `robustus-palette*`
// ═════════════════════════════════════════════════════════════════════════════

const estiloOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  // 12vh e nao centralizado: a paleta cresce para BAIXO conforme os resultados,
  // e centralizada ela pularia na tela a cada tecla digitada.
  paddingTop: '12vh',
  background: 'rgba(2,6,23,0.55)',
  zIndex: 1000,
};

const estiloDialogo: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(560px, 92vw)',
  maxHeight: '70vh',
  borderRadius: 10,
  border: '1px solid rgba(148,163,184,0.25)',
  background: '#0f172a',
  color: '#e2e8f0',
  boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
  overflow: 'hidden',
  fontFamily: 'inherit',
  fontSize: 13,
};

const estiloBusca: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderBottom: '1px solid rgba(148,163,184,0.18)',
};

const estiloInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 14,
};

const estiloLista: CSSProperties = { overflowY: 'auto', padding: 4, flex: 1 };

const estiloGrupo: CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  opacity: 0.55,
  padding: '8px 8px 4px',
};

function estiloOpcao(ativo: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    background: ativo ? 'rgba(56,189,248,0.16)' : 'transparent',
  };
}

const estiloDestaque: CSSProperties = { fontWeight: 700, color: '#38bdf8' };

const estiloKbd: CSSProperties = {
  fontSize: 10,
  fontFamily: 'inherit',
  padding: '1px 5px',
  borderRadius: 4,
  border: '1px solid rgba(148,163,184,0.3)',
  opacity: 0.75,
  whiteSpace: 'nowrap',
};

const estiloRodape: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '7px 12px',
  borderTop: '1px solid rgba(148,163,184,0.18)',
  minHeight: 28,
};

const estiloHint: CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const estiloVazio: CSSProperties = { fontSize: 12, opacity: 0.7, margin: 0, padding: '14px 10px' };
