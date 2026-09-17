/**
 * CollapsiblePanel — o "mostrar/ocultar" que o dono pediu, sem esconder informacao.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ FECHAR NAO PODE APAGAR A NOTICIA DE QUE HA ALGO ALI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um painel que fecha e nao deixa rastro cria o pior estado possivel: o operador
 * tem tres indicadores plotados no grafico e nenhuma pista de ONDE liga-los ou
 * desliga-los. Ele passa a ver linhas que nao sabe de onde vem.
 *
 * Por isso o `badge` existe e mora no CABECALHO, que continua visivel fechado:
 * "3 indicadores", "2 alertas". Fechado, o painel some da tela mas continua
 * dizendo o que carrega — que e a diferenca entre economizar espaco e esconder
 * estado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ CONTROLADO **E** NAO CONTROLADO — e por que `open` sempre manda
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sem `open`, o painel guarda o estado dele e `defaultOpen` e o valor inicial.
 * Com `open`, quem manda e o pai e o estado interno e IGNORADO — inclusive quando
 * o pai nao reage ao `onOpenChange`, caso em que o painel simplesmente nao abre.
 *
 * ⚠️ Isso e proposital e e o padrao do React: um componente que "abre de qualquer
 * jeito" quando controlado produz o defeito mais dificil de achar da classe —
 * interface e estado do pai discordando sem que nada falhe. Se o pai passa `open`,
 * ele assumiu a responsabilidade; o painel obedece e apenas AVISA pelo callback.
 *
 * `onOpenChange` e chamado nos DOIS modos, sempre com o valor pretendido — assim o
 * consumidor pode instrumentar (telemetria, persistir layout) sem virar controlado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O CORPO CONTINUA MONTADO QUANDO FECHADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fechado, o corpo recebe o atributo `hidden` em vez de ser desmontado. Duas
 * razoes, ambas concretas:
 *
 *  1. **`aria-controls` tem de apontar para um elemento QUE EXISTE.** Desmontar
 *     deixaria a referencia pendurada e o leitor de tela sem o alvo do
 *     `aria-expanded`.
 *  2. **Desmontar joga fora o estado dos filhos.** O `IndicatorToolbox` tem campo
 *     numerico com rascunho de digitacao; fechar e reabrir o painel apagaria o que
 *     o operador estava escrevendo.
 *
 * O custo e real e fica registrado: filho pesado continua renderizando fechado. Se
 * algum dia isso pesar, o caminho e o consumidor nao passar o filho — e nao este
 * componente desmontar por conta e quebrar os dois pontos acima.
 */
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { joinClasses, useChromeStyles } from './SegmentedControl.js';
import { Tooltip } from './Tooltip.js';

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

export interface CollapsiblePanelProps {
  readonly title: string;
  readonly icon?: IconName;
  /** Valor inicial no modo NAO controlado. Default `true`. */
  readonly defaultOpen?: boolean;
  /** Presente = modo controlado; o pai manda (ver o cabecalho). */
  readonly open?: boolean;
  /** Chamado nos dois modos, com o valor PRETENDIDO. */
  readonly onOpenChange?: (o: boolean) => void;
  /** Ex.: contagem de itens ativos. Visivel tambem com o painel fechado. */
  readonly badge?: ReactNode;
  /** "Para que serve este painel". Vira `Tooltip` no cabecalho. */
  readonly hint?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Secao recolhivel com cabecalho clicavel.
 *
 * @example
 * // nao controlado
 * <CollapsiblePanel title="Indicadores" icon="indicator" badge={`${n} ativo(s)`}>
 *   <IndicatorToolbox catalog={cat} />
 * </CollapsiblePanel>
 *
 * @example
 * // controlado (o pai persiste o estado no layout)
 * <CollapsiblePanel title="Alertas" open={aberto} onOpenChange={setAberto}>
 *   …
 * </CollapsiblePanel>
 */
export function CollapsiblePanel({
  title,
  icon,
  defaultOpen = true,
  open,
  onOpenChange,
  badge,
  hint,
  children,
  className,
  style,
}: CollapsiblePanelProps): JSX.Element {
  useChromeStyles();

  const prefixo = useId();
  const idCorpo = `${prefixo}-body`;
  const idCabecalho = `${prefixo}-header`;

  const [interno, setInterno] = useState(defaultOpen);
  const controlado = open !== undefined;
  const aberto = controlado ? open : interno;

  const alternar = (): void => {
    const pretendido = !aberto;
    // No modo controlado NAO tocamos no estado interno: se um dia o `open`
    // desaparecer das props, o painel voltaria com um estado interno defasado e
    // pularia visualmente. Manter o interno intocado deixa o fallback previsivel
    // (`defaultOpen`, o mesmo de sempre).
    if (!controlado) setInterno(pretendido);
    onOpenChange?.(pretendido);
  };

  const cabecalho = (
    <button
      id={idCabecalho}
      type="button"
      onClick={alternar}
      aria-expanded={aberto}
      aria-controls={idCorpo}
      className={joinClasses('robustus-panel__header', aberto && 'robustus-panel__header--open')}
      style={estiloCabecalho}
    >
      {/*
        O chevron gira em vez de trocar de glifo: a rotacao mostra o CAMINHO entre
        os dois estados, e e o que faz o painel parecer responder ao clique. O
        `transition: transform` vive na folha do cromo (`useChromeStyles`), entao
        `prefers-reduced-motion` desliga o giro sem tocar nesta linha.
      */}
      <Icon
        name="chevronDown"
        size={14}
        className={joinClasses('robustus-panel__chevron', aberto && 'robustus-panel__chevron--open')}
        style={{ transform: aberto ? 'rotate(0deg)' : 'rotate(-90deg)' }}
      />
      {icon !== undefined && <Icon name={icon} size={15} />}
      <span className="robustus-panel__title" style={{ fontSize: 12, fontWeight: 600, flex: 1, textAlign: 'left' }}>
        {title}
      </span>
      {badge !== undefined && badge !== null && badge !== false && (
        <span className="robustus-panel__badge" style={estiloBadge}>
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <section
      className={joinClasses('robustus-panel', className)}
      style={{ ...estiloSecao, ...style }}
      aria-labelledby={idCabecalho}
    >
      {hint === undefined ? cabecalho : (
        <Tooltip label={title} hint={hint} placement="right">
          {cabecalho}
        </Tooltip>
      )}

      {/*
        ⚠️ Sempre renderizado, `hidden` quando fechado — ver o cabecalho. O
        `hidden` do HTML ja retira o elemento da arvore de acessibilidade e da
        ordem de foco; nao ha necessidade de `aria-hidden` nem de `tabIndex={-1}`
        nos filhos, e acrescenta-los seria redundancia que envelhece mal.
      */}
      <div
        id={idCorpo}
        role="group"
        aria-labelledby={idCabecalho}
        hidden={!aberto}
        className="robustus-panel__body"
        style={aberto ? estiloCorpo : undefined}
      >
        {children}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo
// ═════════════════════════════════════════════════════════════════════════════

const estiloSecao: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 7,
  fontFamily: 'inherit',
  color: 'inherit',
  overflow: 'hidden',
};

const estiloCabecalho: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '5px 8px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const estiloBadge: CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid rgba(148,163,184,0.28)',
  opacity: 0.85,
  whiteSpace: 'nowrap',
};

const estiloCorpo: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '6px 8px 8px',
  borderTop: '1px solid rgba(148,163,184,0.15)',
};
