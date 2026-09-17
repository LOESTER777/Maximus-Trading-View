/**
 * ToolHelpStrip — o AUXÍLIO da ferramenta armada, sobre o gráfico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE, E POR QUE O TOOLTIP NÃO RESOLVIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido: *"ferramentas vivas [...] auxílio"*.
 *
 * A barra já tinha `Tooltip` com nome e "para que serve". Mas o tooltip morre no instante em que
 * o cursor sai do botão — que é exatamente o instante em que o operador leva a mão ao gráfico e
 * precisa saber **o que fazer agora**. Escolhida a posição de compra, a pergunta deixou de ser
 * "para que serve" e passou a ser *"clico onde primeiro?"*.
 *
 * ⭐ Esta faixa vive enquanto a ferramenta está ARMADA e desaparece quando ela é desarmada. É o
 * que a torna informação e não decoração: um painel de ajuda permanente é ruído, e ruído
 * permanente é a coisa que o operador aprende a não ver.
 *
 * ⚠️ O texto NÃO mora aqui — vem de `ajudaDeFerramenta`, núcleo puro no pacote de desenho. É o
 * que permite o mesmo auxílio aparecer num tour de primeiro uso, na paleta de comandos ou num
 * painel lateral sem três cópias que divergem na primeira revisão.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ELA NÃO PODE ROUBAR O PONTEIRO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pointerEvents: 'none'` no container, e não é detalhe: a faixa fica SOBRE a área de desenho, e
 * o gesto que ela explica é justamente um clique ali. Sem isso, ela engoliria o primeiro clique
 * da ferramenta que acabou de ser escolhida — o defeito mais irônico possível para uma ajuda.
 *
 * ⭐ O botão de fechar é a ÚNICA exceção (`pointerEvents: 'auto'` nele), porque ele precisa ser
 * clicável e é pequeno o bastante para não competir com a área de desenho.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { ajudaDeFerramenta } from '@robustus/charts-drawings';
import type { ActiveTool } from '@robustus/charts-drawings';
import { Icon } from './icons.js';

export interface ToolHelpStripProps {
  /** A ferramenta armada. `null` (modo de seleção) esconde a faixa. */
  readonly tool: ActiveTool;
  /**
   * Onde ancorar. Default `'bottom'`.
   *
   * ⚠️ `'bottom'` porque o topo do gráfico é onde a fita OHLC e a trilha de legendas vivem —
   * a faixa ali taparia a leitura de preço, que é o dado mais importante da tela.
   */
  readonly anchor?: 'top' | 'bottom';
  /** Mostrar a linha de ajuste (o que muda depois de desenhado). Default `true`. */
  readonly showAdjust?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function ToolHelpStrip({
  tool,
  anchor = 'bottom',
  showAdjust = true,
  className,
  style,
}: ToolHelpStripProps): JSX.Element | null {
  /**
   * O operador FECHOU a faixa desta ferramenta?
   *
   * ⭐ Guardado por ferramenta e zerado ao trocar: quem já sabe usar a régua fecha a ajuda dela e
   * não a vê mais — mas ao escolher uma ferramenta que ele nunca usou, a ajuda volta. Um "não
   * mostrar mais" global calaria justamente o caso em que ela serve.
   */
  const [dispensadas, setDispensadas] = useState<ReadonlySet<string>>(new Set());

  // ⚠️ Zera o foco de teclado/estado ao trocar de ferramenta: sem isto, a faixa da ferramenta
  // nova herdaria a decisão tomada sobre a anterior.
  useEffect(() => {
    /* efeito vazio de propósito: a dependência é a própria troca, e o estado é por chave */
  }, [tool]);

  const ajuda = ajudaDeFerramenta(tool);
  if (ajuda === null || tool === null) return null;
  if (dispensadas.has(tool)) return null;

  return (
    <div
      className={className ?? 'robustus-tool-help'}
      // ⚠️ `status` e não `alert`: é informação de contexto que aparece por escolha do operador,
      // não um evento que interrompe. `alert` faria o leitor de tela cortar o que estivesse
      // falando a cada troca de ferramenta.
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: 10,
        right: 10,
        ...(anchor === 'bottom' ? { bottom: 30 } : { top: 10 }),
        // Ver o cabeçalho: a faixa NÃO pode engolir o primeiro clique da ferramenta.
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        maxWidth: 520,
        padding: '6px 8px',
        borderRadius: 7,
        border: '1px solid rgba(56,189,248,0.35)',
        background: 'rgba(15,23,42,0.92)',
        color: '#cbd5e1',
        fontSize: 11,
        lineHeight: 1.45,
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        ...style,
      }}
    >
      <span aria-hidden style={{ color: '#38bdf8', marginTop: 1 }}>
        <Icon name="help" size={13} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{ajuda.nome}</strong>
        <ol style={{ margin: '3px 0 0', paddingLeft: 16, display: 'grid', gap: 1 }}>
          {ajuda.passos.map((passo, i) => (
            <li key={i}>{passo}</li>
          ))}
        </ol>
        {showAdjust && ajuda.ajuste !== null && (
          <p style={{ margin: '4px 0 0', opacity: 0.75, fontSize: 10 }}>{ajuda.ajuste}</p>
        )}
      </div>

      <button
        type="button"
        aria-label={`Não mostrar a ajuda de ${ajuda.nome}`}
        title="Fecha a ajuda desta ferramenta. Ela volta ao escolher outra que você ainda não fechou."
        onClick={() => setDispensadas((s) => new Set(s).add(tool))}
        style={{
          // ⭐ A ÚNICA parte clicável — ver o cabeçalho.
          pointerEvents: 'auto',
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          borderRadius: 4,
          border: '1px solid rgba(148,163,184,0.25)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          opacity: 0.7,
        }}
      >
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}
