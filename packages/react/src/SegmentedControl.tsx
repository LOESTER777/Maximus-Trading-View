/**
 * SegmentedControl — escolha UNICA com icone, um controle so no Tab.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE ISTO EXISTE: 6 BOTOES SOLTOS NAO SAO UMA ESCOLHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tipo de grafico e escolha unica — nunca vela E linha ao mesmo tempo. Seis
 * botoes independentes nao dizem isso a ninguem: nem ao olho (parecem seis acoes
 * possiveis, e a parede de botoes que o dono pediu para evitar), nem ao leitor de
 * tela (anuncia "botao, botao, botao…" sem dizer que sao alternativas de um
 * mesmo campo), nem ao teclado (seis paradas de Tab para responder UMA pergunta).
 *
 * Aqui e `role="radiogroup"` com `role="radio"` em cada item. Isso muda tres
 * coisas de uma vez: o leitor de tela anuncia "2 de 6, marcado", o Tab entra e
 * sai do grupo como um campo unico, e as setas trocam a escolha.
 *
 * ⚠️ **`radio`, e nao `toolbar` com `aria-pressed`.** A diferenca nao e cosmetica:
 * `aria-pressed` descreve um botao que ALTERNA (ligado/desligado, independente dos
 * vizinhos) — e o certo para camadas e ambiente, na `ChartToolbar`. `radio`
 * descreve alternativas MUTUAMENTE EXCLUSIVAS. Usar `aria-pressed` aqui diria ao
 * usuario que ele pode ligar duas rasterizacoes juntas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ ROVING TABINDEX — a parte que quase todo mundo erra
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Apenas o item SELECIONADO tem `tabIndex=0`; os outros tem `-1`. E o que faz o
 * grupo ser uma parada de Tab so. Dentro do grupo, a navegacao e por seta, e a
 * seta **move a selecao junto com o foco** — que e o comportamento que o padrao
 * ARIA descreve para radiogroup (diferente de `toolbar`, onde a seta so move o
 * foco e a acao exige Espaco/Enter).
 *
 * ⚠️ **O caso que quebra o Tab:** se `value` nao casar com nenhuma opcao (layout
 * salvo com um modo que esta versao nao tem), NENHUM item seria tabbable e o grupo
 * inteiro sairia da ordem de teclado — o usuario nao conseguiria mais trocar de
 * modo justamente na situacao em que ele PRECISA trocar. Por isso, sem
 * correspondencia, o primeiro item recebe o `tabIndex=0`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ TRANSICAO E HOVER VIVEM NA FOLHA, NAO NO ESTILO INLINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `:hover`, `:focus-visible` e `@media (prefers-reduced-motion)` sao inalcancaveis
 * a partir de `style={{}}`. E ha um detalhe que decide a questao: estilo inline
 * VENCE regra de folha, entao um `transition` inline nao poderia ser desligado
 * pelo `@media` de movimento reduzido sem `!important`. Logo a transicao **tem** de
 * morar na folha — e e por isso que `useChromeStyles` existe.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon, type IconName } from './icons.js';
import { Tooltip } from './Tooltip.js';

// ═════════════════════════════════════════════════════════════════════════════
// A folha compartilhada pelas tres pecas de cromo
// ═════════════════════════════════════════════════════════════════════════════

const STYLE_ELEMENT_ID = 'robustus-chrome-styles';

/**
 * O CSS do cromo: transicao curta, hover, foco visivel e movimento reduzido.
 *
 * ⭐ **150 ms e "agil", nao "animado".** Acima de ~200 ms a barra passa a parecer
 * lenta em uso repetido (trocar de modo dez vezes seguidas); abaixo de ~100 ms a
 * transicao nao e percebida e nao comunica nada. O alvo e retorno visual imediato
 * — o "lúdico" pedido — sem nenhuma biblioteca de animacao.
 *
 * ⚠️ Anima apenas COR e SOMBRA. Nao anima largura, altura nem posicao: geometria
 * animada num controle de barra provoca reflow por quadro e, pior, faz o alvo de
 * clique se mover debaixo do cursor.
 */
const CHROME_CSS = `
.robustus-segmented__item,
.robustus-toolbar__btn,
.robustus-toolbar__more,
.robustus-toolbar__menu-item,
.robustus-panel__header {
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}
.robustus-panel__chevron { transition: transform 150ms ease; }
.robustus-segmented__item:hover,
.robustus-toolbar__btn:hover,
.robustus-toolbar__more:hover,
.robustus-toolbar__menu-item:hover,
.robustus-panel__header:hover { background-color: rgba(148, 163, 184, 0.14); }
.robustus-segmented__item:focus-visible,
.robustus-toolbar__btn:focus-visible,
.robustus-toolbar__more:focus-visible,
.robustus-toolbar__menu-item:focus-visible,
.robustus-panel__header:focus-visible {
  outline: 2px solid rgba(56, 189, 248, 0.75);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .robustus-segmented__item,
  .robustus-toolbar__btn,
  .robustus-toolbar__more,
  .robustus-toolbar__menu-item,
  .robustus-panel__header,
  .robustus-panel__chevron { transition: none; }
}
`;

/**
 * Injeta a folha do cromo uma unica vez no documento.
 *
 * ⚠️ **Nunca remove.** Contagem de referencia daria trabalho para resolver um
 * problema que nao existe: sao menos de 1 KB de texto, e o ultimo componente a
 * desmontar nao tem como saber se outro vai montar no proximo quadro. Remover e
 * reinjetar por ciclo de vida seria mais caro que deixar.
 *
 * ⚠️ Em SSR o efeito nao roda, entao o primeiro quadro do servidor sai SEM
 * transicao. E a direcao segura de falhar: perde-se o enfeite, nunca a funcao.
 */
export function useChromeStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
    const el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    el.textContent = CHROME_CSS;
    document.head.appendChild(el);
  }, []);
}

/**
 * Junta a classe da biblioteca com a do consumidor.
 *
 * ⚠️ **Acrescenta, nao substitui.** O padrao `className ?? 'robustus-x'` que
 * existe em `IndicatorToolbox` faria quem passa `className` perder em silencio
 * hover, foco visivel e movimento reduzido — todos ancorados na classe
 * `robustus-*` da folha. Aqui as duas convivem.
 */
export function joinClasses(...partes: readonly (string | undefined | false)[]): string {
  return partes.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

export interface SegmentedOption<T> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
  /** Uma frase de "para que serve". Vira o corpo do `Tooltip`. */
  readonly hint?: string;
}

export interface SegmentedControlProps<T> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (v: T) => void;
  /** `'sm'` cabe em barra densa; `'md'` e o default. */
  readonly size?: 'sm' | 'md';
  /**
   * `false` = so icone (compacto). Default `true`.
   *
   * ⚠️ Sem rotulo visivel o `Tooltip` deixa de ser conforto e passa a ser a UNICA
   * forma de descobrir o que o icone faz — por isso ele e obrigatorio nesse modo,
   * e nao opcional.
   */
  readonly showLabels?: boolean;
  /** Obrigatorio: um `radiogroup` sem nome nao diz QUAL escolha ele representa. */
  readonly ariaLabel: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Grupo de escolha unica com icone.
 *
 * @example
 * <SegmentedControl
 *   ariaLabel="Desenho do gráfico"
 *   options={CHART_TYPE_OPTIONS}
 *   value={tipo}
 *   onChange={setTipo}
 *   showLabels={false}
 * />
 */
export function SegmentedControl<T>({
  options,
  value,
  onChange,
  size = 'md',
  showLabels = true,
  ariaLabel,
  className,
  style,
}: SegmentedControlProps<T>): JSX.Element {
  useChromeStyles();

  const itens = useRef<(HTMLButtonElement | null)[]>([]);

  const selecionado = options.findIndex((o) => Object.is(o.value, value));
  // Sem correspondencia, o primeiro item carrega o `tabIndex`. Ver o cabecalho:
  // e o que impede o grupo inteiro de sair da ordem de Tab.
  const tabbable = selecionado >= 0 ? selecionado : 0;

  const moverPara = (indice: number): void => {
    const destino = options[indice];
    if (destino === undefined) return;
    // Foca ANTES de notificar: a lista nao muda de ordem, e focar aqui evita
    // depender de o consumidor reencaminhar o `value` para o foco acompanhar.
    itens.current[indice]?.focus();
    if (!Object.is(destino.value, value)) onChange(destino.value);
  };

  const aoTeclar = (evento: ReactKeyboardEvent, indice: number): void => {
    const n = options.length;
    if (n === 0) return;
    switch (evento.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        evento.preventDefault();
        // Circular: da ultima volta para a primeira. Barra de ferramenta e usada
        // em repeticao, e parar na ponta obriga a inverter a direcao da mao.
        moverPara((indice + 1) % n);
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
        evento.preventDefault();
        moverPara((indice - 1 + n) % n);
        return;
      case 'Home':
        evento.preventDefault();
        moverPara(0);
        return;
      case 'End':
        evento.preventDefault();
        moverPara(n - 1);
        return;
      default:
        return;
    }
  };

  const metrica = size === 'sm' ? METRICA_SM : METRICA_MD;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={joinClasses('robustus-segmented', className)}
      style={{ ...estiloGrupo, ...style }}
    >
      {options.map((opcao, indice) => {
        const ativo = indice === selecionado;
        const botao = (
          <button
            ref={(el) => {
              itens.current[indice] = el;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            // O nome acessivel vem daqui SEMPRE, com ou sem rotulo visivel: no
            // modo compacto o conteudo do botao e um `<svg aria-hidden>`, ou seja,
            // um botao mudo sem este atributo.
            aria-label={opcao.label}
            tabIndex={indice === tabbable ? 0 : -1}
            onClick={() => {
              if (!ativo) onChange(opcao.value);
            }}
            onKeyDown={(e) => aoTeclar(e, indice)}
            className={joinClasses(
              'robustus-segmented__item',
              ativo && 'robustus-segmented__item--active',
            )}
            style={estiloItem(ativo, metrica, showLabels)}
          >
            {opcao.icon !== undefined && <Icon name={opcao.icon} size={metrica.icone} />}
            {showLabels && <span>{opcao.label}</span>}
          </button>
        );

        // Tooltip quando falta rotulo visivel (obrigatorio) ou quando ha um
        // "para que serve" a dizer (util mesmo com rotulo).
        //
        // ⚠️ O `Tooltip` embrulha o gatilho num `<span>`, o que interpoe um
        // elemento generico entre o `radiogroup` e o `radio`. ARIA admite elemento
        // possuido como DESCENDENTE (nao exige filho direto), e a alternativa
        // seria pior: item so-icone sem nenhuma forma de descobrir o que faz.
        //
        // ⚠️ O `<span>` do caminho SEM tooltip existe por isso: mantem a MESMA
        // estrutura de DOM nos dois casos. Sem ele, um item com hint e um sem hint
        // teriam profundidade diferente e o CSS do consumidor casaria em um so.
        const precisaTooltip = !showLabels || opcao.hint !== undefined;
        return precisaTooltip ? (
          <Tooltip key={opcao.label} label={opcao.label} hint={opcao.hint} placement="bottom">
            {botao}
          </Tooltip>
        ) : (
          // `lineHeight: 0` iguala a altura ao wrapper do `Tooltip`: herdar a
          // altura de linha do texto desalinharia a barra por 2-3 px por item.
          <span key={opcao.label} style={{ display: 'inline-flex', lineHeight: 0 }}>
            {botao}
          </span>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe
// ═════════════════════════════════════════════════════════════════════════════

interface Metrica {
  readonly icone: number;
  readonly fonte: number;
  readonly padY: number;
  readonly padX: number;
}

const METRICA_SM: Metrica = { icone: 14, fonte: 10, padY: 2, padX: 6 };
const METRICA_MD: Metrica = { icone: 16, fonte: 11, padY: 4, padX: 8 };

const estiloGrupo: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.22)',
  // O grupo tem moldura propria e os itens nao: e o que faz seis botoes lerem
  // como UM controle antes mesmo de o leitor de tela anunciar `radiogroup`.
  background: 'rgba(148,163,184,0.06)',
  fontFamily: 'inherit',
  color: 'inherit',
};

function estiloItem(ativo: boolean, m: Metrica, comRotulo: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: comRotulo ? 5 : 0,
    fontSize: m.fonte,
    fontFamily: 'inherit',
    lineHeight: 1.4,
    padding: `${m.padY}px ${m.padX}px`,
    borderRadius: 5,
    border: '1px solid transparent',
    // ⚠️ O estado ativo NAO e so cor de fundo: fundo sozinho desaparece em tema
    // claro de baixo contraste. Borda + fundo sobrevivem aos dois temas.
    borderColor: ativo ? 'rgba(56,189,248,0.55)' : 'transparent',
    background: ativo ? 'rgba(56,189,248,0.18)' : 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/** Reexportado para quem monta opcao sem importar o modulo de icones. */
export type { IconName };
