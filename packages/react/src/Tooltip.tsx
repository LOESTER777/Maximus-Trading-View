/**
 * Tooltip — o componente que responde "o que e isso, e para que serve".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE ISTO EXISTE: ICONE MUDO E PIOR QUE BOTAO COM TEXTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A restricao do produto e "nao se pode encher a tela de botoes". A saida obvia —
 * trocar texto por icone — resolve o espaco e cria um problema maior: um glifo de
 * 16 px sem explicacao e adivinhacao. Quem nunca viu o simbolo do Fibonacci nao
 * descobre pelo desenho o que ele traca.
 *
 * Este componente e o outro lado dessa troca. O icone paga o espaco; o tooltip
 * paga a compreensao. Por isso ele carrega TRES campos, e nao um:
 *
 *   `label`    — o NOME ("Régua")
 *   `hint`     — o PARA QUE, numa frase concreta ("mede variação em preço, % e
 *                barras entre dois pontos")
 *   `shortcut` — o ATALHO, para o operador deixar de usar o mouse
 *
 * ⚠️ **`hint` nao deve repetir o `label`.** "Régua — a ferramenta régua" nao
 * ensina nada e ocupa a tela do mesmo jeito. Se nao houver o que dizer, e melhor
 * omitir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ HOVER **E** FOCO — NAO SO HOVER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tooltip so-de-hover e o defeito de acessibilidade mais comum em barra de
 * ferramenta com icone: quem navega por teclado (ou por leitor de tela em modo de
 * foco) percorre exatamente os mesmos botoes e NUNCA recebe a explicacao. Aqui o
 * foco abre a bolha, e a bolha e a mesma que o `aria-describedby` aponta — a
 * informacao e uma, em dois canais.
 *
 * ⚠️ **A bolha fica SEMPRE no DOM, oculta quando fechada.** Renderizar sob
 * condicao faria `aria-describedby` apontar para um id inexistente enquanto
 * fechada, o que e invalido e faz leitor de tela ignorar a descricao no momento em
 * que ela mais importa: ao receber o foco. Oculta por `hidden` + `display:none`,
 * a descricao continua legivel por `aria-describedby` (padrao consagrado) e sai
 * da arvore de acessibilidade como elemento visual.
 *
 * ⚠️ **`aria-describedby`, nunca `aria-label`.** O botao ja tem `aria-label` com o
 * nome; o tooltip e DESCRICAO complementar. Sobrescrever o rotulo trocaria "Régua"
 * por um paragrafo inteiro na leitura, e a lista de botoes ficaria impossivel de
 * percorrer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O DEFEITO DA BOLHA QUE FICA PRESA DEPOIS DO CLIQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Clicar num botao da barra da foco a ele. Se o foco abre o tooltip, a bolha
 * continua na tela depois de o mouse sair — porque o foco nao saiu — e fica
 * pairando sobre o grafico, tapando preco, ate o proximo clique em outro lugar.
 *
 * A correcao: `pointerdown` marca que o foco que vem a seguir e de MOUSE, e o
 * caminho de foco e ignorado nesse caso (o usuario de mouse ja tem o caminho de
 * hover). Foco por `Tab` nao tem `pointerdown` antes, entao continua abrindo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ZERO TERCEIROS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sem popper, sem portal de biblioteca, sem animacao de terceiro. A bolha e
 * `position: absolute` dentro de um wrapper `position: relative` que abraca o
 * gatilho. O custo dessa escolha e conhecido e aceito: a bolha e recortada por um
 * ancestral com `overflow: hidden`. Em troca, nao ha dependencia, nao ha
 * sincronizacao de scroll e o elemento vive ao lado do que ele descreve — o que
 * mantem a ordem do DOM coerente com a leitura.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

// ═════════════════════════════════════════════════════════════════════════════
// Vocabulario
// ═════════════════════════════════════════════════════════════════════════════

/** Lado do gatilho em que a bolha aparece. */
export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

const OPOSTO: Readonly<Record<TooltipPlacement, TooltipPlacement>> = Object.freeze({
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
});

/**
 * Atraso de abertura, em ms.
 *
 * ⭐ 350 ms nao e numero solto: e o tempo que separa "parei para ler" de "passei o
 * mouse por cima indo para outro lugar". Sem atraso, atravessar uma barra de 13
 * botoes com o cursor acende e apaga 13 bolhas em sequencia — o efeito descrito
 * como pisca-pisca. Muito acima disso (600 ms+) o operador conclui que nao ha
 * tooltip e desiste antes de aparecer.
 */
const ATRASO_PADRAO_MS = 350;

/**
 * Folga minima da borda da viewport, em px, antes de virar de lado.
 *
 * 8 px em vez de 0 porque encostar na borda e visualmente igual a estar cortado, e
 * porque a barra de rolagem do sistema come alguns pixels a direita.
 */
const MARGEM_VIEWPORT = 8;

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

export interface TooltipProps {
  /** O NOME do que o gatilho faz. Aparece em destaque. */
  readonly label: string;
  /**
   * O PARA QUE, numa frase curta e concreta.
   *
   * ⚠️ Nao repita o `label` — ver o cabecalho.
   */
  readonly hint?: string;
  /** Atalho de teclado, ja formatado para leitura (`'T'`, `'Shift+F'`). */
  readonly shortcut?: string;
  /**
   * Lado preferido. Default `'top'`.
   *
   * Barra vertical quer `'right'`; barra horizontal quer `'bottom'`. E preferencia,
   * nao garantia: sem espaco, vira para o lado oposto.
   */
  readonly placement?: TooltipPlacement;
  /** Atraso de abertura por hover, em ms. Default 350. */
  readonly delayMs?: number;
  /**
   * Desliga a bolha, mantendo o gatilho intacto.
   *
   * ⚠️ Mesmo desligado o `aria-describedby` continua ligado: a descricao textual e
   * util ao leitor de tela ainda que o consumidor nao queira o balao visual.
   */
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * O gatilho. Deve ser UM elemento focavel (tipicamente `<button>`).
   *
   * ⚠️ Se nao for um elemento React unico, o `aria-describedby` nao pode ser
   * injetado e o componente degrada para tooltip apenas visual — sem lancar, na
   * disciplina da camada (ver `00-projeto`: falha e valor, nao excecao).
   */
  readonly children: ReactNode;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Bolha de explicacao ligada a um gatilho, por hover e por foco.
 *
 * @example
 * <Tooltip
 *   label="Linha de tendência"
 *   hint="Dois pontos: mede a inclinação de um movimento"
 *   shortcut="T"
 *   placement="right"
 * >
 *   <button type="button" aria-label="Linha de tendência">
 *     <Icon name="trendline" />
 *   </button>
 * </Tooltip>
 */
export function Tooltip({
  label,
  hint,
  shortcut,
  placement = 'top',
  delayMs = ATRASO_PADRAO_MS,
  disabled = false,
  className,
  style,
  children,
}: TooltipProps): JSX.Element {
  const idBolha = useId();
  const [aberto, setAberto] = useState(false);
  const [lado, setLado] = useState<TooltipPlacement>(placement);

  const timerRef = useRef<number | null>(null);
  const bolhaRef = useRef<HTMLDivElement | null>(null);
  /** Ja viramos de lado nesta abertura? Impede oscilar entre os dois lados. */
  const jaVirouRef = useRef(false);
  /**
   * O proximo foco vem de mouse?
   *
   * ⚠️ E o que impede a bolha de ficar presa depois do clique — ver o cabecalho.
   */
  const focoDeMouseRef = useRef(false);

  const cancelarTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fechar = useCallback((): void => {
    cancelarTimer();
    setAberto(false);
  }, [cancelarTimer]);

  const abrirComAtraso = useCallback((): void => {
    if (disabled) return;
    cancelarTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setAberto(true);
    }, Math.max(0, delayMs));
  }, [cancelarTimer, delayMs, disabled]);

  const abrirAgora = useCallback((): void => {
    if (disabled) return;
    cancelarTimer();
    setAberto(true);
  }, [cancelarTimer, disabled]);

  // Timer pendente na desmontagem chamaria `setState` em componente morto.
  useEffect(() => cancelarTimer, [cancelarTimer]);

  // Fechada, a decisao de lado e descartada: reabrir em outro ponto da tela (a
  // barra pode ter sido ancorada do outro lado) precisa medir de novo.
  useEffect(() => {
    if (aberto) return;
    jaVirouRef.current = false;
    setLado(placement);
  }, [aberto, placement]);

  /**
   * Vira de lado quando a bolha nao cabe.
   *
   * ⚠️ **jsdom devolve TUDO ZERO em `getBoundingClientRect`.** Nao ha layout no
   * ambiente de teste. Zero nao significa "cabe" nem "nao cabe" — significa "nao
   * sei", e a resposta certa para "nao sei" e manter o lado pedido em vez de
   * inventar uma virada. Sem esta guarda, todo tooltip apareceria virado nos
   * testes (`left: 0 < MARGEM` e verdadeiro para um retangulo nulo) e a suite
   * afirmaria uma posicao que o navegador nunca produz.
   */
  useLayoutEffect(() => {
    if (!aberto || jaVirouRef.current) return;
    const el = bolhaRef.current;
    if (el === null) return;

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // jsdom, ou elemento sem layout

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw === 0 || vh === 0) return;

    const transborda =
      (lado === 'right' && r.right > vw - MARGEM_VIEWPORT) ||
      (lado === 'left' && r.left < MARGEM_VIEWPORT) ||
      (lado === 'top' && r.top < MARGEM_VIEWPORT) ||
      (lado === 'bottom' && r.bottom > vh - MARGEM_VIEWPORT);
    if (!transborda) return;

    jaVirouRef.current = true;
    setLado(OPOSTO[lado]);
  }, [aberto, lado]);

  /**
   * `Escape` fecha.
   *
   * ⚠️ O ouvinte e do DOCUMENTO, nao do wrapper. A bolha pode estar aberta por
   * hover com o foco em outro lugar da pagina — nesse caso nenhum `keydown`
   * passaria pelo wrapper, e a unica forma de fechar seria mover o mouse.
   */
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, fechar]);

  // ── Liga o `aria-describedby` ao filho ────────────────────────────────────
  //
  // O id e injetado SEMPRE (aberto ou fechado): a bolha existe no DOM e e a
  // descricao acessivel do gatilho, independente de estar visivel.
  let gatilho: ReactNode = children;
  if (isValidElement(children)) {
    const atual = (children.props as { readonly 'aria-describedby'?: unknown })[
      'aria-describedby'
    ];
    const descrito =
      typeof atual === 'string' && atual.trim() !== '' ? `${atual} ${idBolha}` : idBolha;
    gatilho = cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
      'aria-describedby': descrito,
    });
  }

  return (
    <span
      className={className ?? 'robustus-tooltip-wrap'}
      style={{ ...estiloWrapper, ...style }}
      // ⚠️ Os manipuladores vivem no WRAPPER, nao no filho clonado. React
      // sintetiza `mouseenter`/`mouseleave` a partir de `mouseover`/`mouseout` e
      // faz `focus`/`blur` borbulharem — entao o wrapper ve tudo o que o gatilho
      // ve, e nao e preciso encadear manipuladores que o consumidor tenha posto
      // no filho (encadear errado engoliria o `onClick` do botao, defeito classico
      // de tooltip que embrulha).
      onMouseEnter={abrirComAtraso}
      onMouseLeave={() => {
        focoDeMouseRef.current = false;
        fechar();
      }}
      // Foco por teclado abre NA HORA. O atraso existe para o mouse que atravessa
      // a barra; `Tab` e ato deliberado, e esperar 350 ms depois de cada tecla
      // faria a barra parecer travada.
      onFocus={() => {
        if (focoDeMouseRef.current) return; // ver o defeito da bolha presa
        abrirAgora();
      }}
      onBlur={() => {
        focoDeMouseRef.current = false;
        fechar();
      }}
      onPointerDown={() => {
        focoDeMouseRef.current = true;
      }}
    >
      {gatilho}

      <div
        id={idBolha}
        ref={bolhaRef}
        role="tooltip"
        hidden={!aberto}
        className="robustus-tooltip"
        style={aberto ? { ...estiloBolha, ...posicao(lado) } : estiloOculto}
      >
        <span className="robustus-tooltip__label" style={estiloLabel}>
          {label}
          {shortcut !== undefined && shortcut !== '' && (
            <kbd className="robustus-tooltip__shortcut" style={estiloAtalho}>
              {shortcut}
            </kbd>
          )}
        </span>
        {hint !== undefined && hint !== '' && (
          <span className="robustus-tooltip__hint" style={estiloHint}>
            {hint}
          </span>
        )}
      </div>
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe
// ═════════════════════════════════════════════════════════════════════════════

const estiloWrapper: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  // ⚠️ Sem isto o wrapper herda a altura de linha do texto e fica mais alto que o
  // botao, o que desalinha a barra por 2-3 px por item.
  lineHeight: 0,
};

/**
 * Posicao da bolha por lado.
 *
 * `translate` de 50% centraliza no eixo transversal sem saber a dimensao da bolha
 * — que e o que permite nao medir nada no caminho normal (a medicao entra so para
 * decidir a virada).
 */
function posicao(lado: TooltipPlacement): CSSProperties {
  switch (lado) {
    case 'top':
      return { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 };
    case 'bottom':
      return { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 };
    case 'left':
      return { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 };
    case 'right':
    default:
      return { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 };
  }
}

const estiloBolha: CSSProperties = {
  position: 'absolute',
  zIndex: 30,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  // 220 px cabe uma frase de ~12 palavras em duas linhas. Mais largo que isso e a
  // bolha vira paragrafo e deixa de ser lida de relance.
  maxWidth: 220,
  width: 'max-content',
  padding: '5px 8px',
  borderRadius: 5,
  border: '1px solid rgba(148,163,184,0.28)',
  background: 'rgba(15,23,42,0.96)',
  color: '#e2e8f0',
  fontFamily: 'inherit',
  lineHeight: 1.35,
  textAlign: 'left',
  // A bolha e informativa e efemera: nao deve capturar o ponteiro, senao ela
  // propria dispara `mouseleave` no gatilho ao aparecer sob o cursor.
  pointerEvents: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
};

const estiloOculto: CSSProperties = { display: 'none' };

const estiloLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const estiloAtalho: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 9,
  fontWeight: 500,
  padding: '0 4px',
  borderRadius: 3,
  border: '1px solid rgba(148,163,184,0.35)',
  opacity: 0.85,
};

const estiloHint: CSSProperties = {
  fontSize: 10,
  opacity: 0.78,
};
