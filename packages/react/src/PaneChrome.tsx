/**
 * PaneChrome — o CROMO de cada sub-painel, em HTML, sobre o canvas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PROPOSTA DO OPERADOR, E O QUE FOI ACEITO DELA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"os histogramas deve ter o recurso de mover com mouse, para poder trocar de posição, jogue
 * eles dentro de uma div com colunas, o que vc acha?"*
 *
 * ⭐ **Mover com o mouse: aceito**, e é o que este componente entrega. A grade já preenche as
 * linhas na ordem do array de panes, então reordenar é `movePane` — nada de geometria nova.
 *
 * ⛔ **Uma div por sub-painel: recusado, e não por preguiça.** Cada div seria um canvas próprio,
 * e o custo é concreto: o crosshair pararia de atravessar as panes (hoje é UM canvas; entre divs
 * viraria sincronia por evento, sempre um quadro atrás), o eixo de tempo compartilhado teria de
 * ser reimplementado por div, a divisória entre colunas viraria resize de CSS (perdendo a
 * geometria em pixel de que a escala de preço depende), e a invariante conquistada na grade — UM
 * `ts`, UMA janela — voltaria a ser N estados que podem divergir.
 *
 * ⭐⭐ **O meio-termo, que é o que existe aqui: HTML para o CROMO, canvas para o DADO.** Divs em
 * posição absoluta, alinhados por `paneRectOf()`. Ganha-se o que o HTML faz melhor — alça de
 * arrasto, botões, foco de teclado, leitor de tela, `aria-*` — sem partir o canvas. E isso só
 * ficou possível quando `paneRectOf` passou a devolver a ORIGEM de cada pane; com `PaneSize`
 * (que só tem largura e altura) não havia como posicionar nada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A CAMADA NÃO PODE ROUBAR O PONTEIRO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pointerEvents: 'none'` na camada e `'auto'` só nos controles. É a mesma disciplina do
 * `ToolHelpStrip`, e aqui o risco é maior: a camada cobre TODA a área das panes. Sem a guarda,
 * ela engoliria o pan, o zoom, o crosshair e o clique que abre as propriedades de um indicador —
 * o gráfico ficaria inerte e nada na tela explicaria por quê.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ POR QUE O ARRASTO PRECISA DE UMA ALÇA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A área do sub-painel é onde o PAN acontece. Um arrasto que começasse em qualquer ponto da pane
 * roubaria o gesto mais usado do gráfico — é a mesma colisão que a ferramenta de desenho teve
 * com o pan, e que custou uma rodada para achar. Então o arrasto sai de uma alça explícita, e só
 * ela captura ponteiro.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './icons.js';

/** O mínimo que o motor precisa expor. Tipado ESTRUTURALMENTE — ver a nota da prop `engine`. */
interface MotorParaCromo {
  readonly api: {
    paneRectOf(index: number): {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
      readonly row: number;
      readonly column: number;
    };
    paneOrder(): readonly number[];
    movePane(index: number, novaPosicao: number): void;
    subscribeLayoutChange(h: () => void): void;
    unsubscribeLayoutChange(h: () => void): void;
  };
}

export interface PaneChromeItem {
  /** Índice ESTÁVEL da pane no motor. */
  readonly paneIndex: number;
  /** O que escrever na faixa. Normalmente o nome do indicador. */
  readonly label: string;
  /** Ponto de cor, para casar com o traço no gráfico. */
  readonly color?: string;
  /** Segunda informação curta (período, parâmetro). */
  readonly detail?: string;
  /** `undefined` esconde o botão de visibilidade; `false` mostra no estado escondido. */
  readonly visible?: boolean;
  readonly onToggleVisible?: () => void;
  readonly onRemove?: () => void;
  readonly onOpenSettings?: () => void;
}

export interface PaneChromeProps {
  /**
   * O motor. `null` = ainda não montou, e a camada não desenha nada.
   *
   * ⚠️ Tipado ESTRUTURALMENTE (`MotorParaCromo`) e não como `ChartEngine`: o pacote React já
   * importa o engine, mas amarrar este componente ao tipo completo o tornaria impossível de
   * testar sem construir um motor de verdade — e em jsdom o container mede 0 px, então o teste
   * mediria zero. Com a forma mínima, o duplo do teste é honesto.
   */
  readonly engine: MotorParaCromo | null;
  /** Um item por sub-painel que deve receber cromo. Panes sem item não recebem nada. */
  readonly items: readonly PaneChromeItem[];
  /**
   * Chamado ao soltar o arrasto. Recebe o índice da pane e a POSIÇÃO de destino entre os
   * sub-painéis. Ausente = a alça de arrasto não é renderizada.
   *
   * ⚠️ O componente NÃO chama `movePane` sozinho: quem move é o consumidor. É o que permite ele
   * persistir a ordem (num documento de aba, num template) em vez de a ordem viver só na tela.
   */
  readonly onReorder?: (paneIndex: number, novaPosicao: number) => void;
  /** Rótulo acessível da camada. Default `'Sub-painéis'`. */
  readonly ariaLabel?: string;
  readonly className?: string;
}

/**
 * O cromo de sub-painel: faixa com alça, nome, cor e ações.
 *
 * @example
 * <div style={{ position: 'relative' }}>
 *   <div ref={containerDoGrafico} />
 *   <PaneChrome
 *     engine={engine}
 *     items={indicadores.active.map((a) => ({ paneIndex: a.paneIndex, label: a.label }))}
 *     onReorder={(pane, pos) => engine?.api.movePane(pane, pos)}
 *   />
 * </div>
 */
export function PaneChrome({
  engine,
  items,
  onReorder,
  ariaLabel = 'Sub-painéis',
  className,
}: PaneChromeProps): JSX.Element | null {
  /**
   * Contador que força releitura da geometria.
   *
   * ⚠️ O retângulo de uma pane não é estado do React — é do motor. Em vez de espelhar (dois
   * donos que divergem), a camada RELÊ `paneRectOf` quando o motor avisa. O contador é só o
   * gatilho de render.
   */
  const [versao, setVersao] = useState(0);
  /** Arrasto em curso: qual pane e sobre qual posição ela está. */
  const [arrasto, setArrasto] = useState<{ paneIndex: number; alvo: number } | null>(null);
  const camadaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (engine === null) return;
    const aoMudar = (): void => setVersao((v) => v + 1);
    engine.api.subscribeLayoutChange(aoMudar);
    // ⚠️ Lê UMA vez na assinatura: o motor só avisa quando muda, e uma camada que assina depois
    // de o layout estar pronto ficaria desalinhada até o próximo redimensionamento.
    aoMudar();
    return () => engine.api.unsubscribeLayoutChange(aoMudar);
  }, [engine]);

  /** Os itens com o retângulo de cada um, na ORDEM em que as panes estão. */
  const comRect = useMemo(() => {
    if (engine === null) return [];
    const ordem = engine.api.paneOrder();
    // ⚠️ `versao` é dependência de propósito: ela é o gatilho de releitura. Sem ela o `useMemo`
    // devolveria o retângulo do primeiro render para sempre.
    void versao;
    return items
      .map((item) => {
        const rect = engine.api.paneRectOf(item.paneIndex);
        // Posição entre os SUB-painéis: a ordem sem a pane principal.
        const posicao = ordem.indexOf(item.paneIndex) - 1;
        return { item, rect, posicao };
      })
      // Pane colapsada tem altura zero: não há onde pôr faixa, e uma faixa flutuando sobre a
      // vizinha seria pior que nenhuma.
      .filter((x) => x.rect.height > 8 && x.rect.width > 40 && x.posicao >= 0);
  }, [engine, items, versao]);

  /** Qual posição de sub-painel está sob um ponto do canvas? `null` fora de todos. */
  const posicaoNoPonto = useCallback(
    (clientX: number, clientY: number): number | null => {
      const caixa = camadaRef.current?.getBoundingClientRect();
      if (caixa === undefined) return null;
      const x = clientX - caixa.left;
      const y = clientY - caixa.top;
      for (const { rect, posicao } of comRect) {
        if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
          return posicao;
        }
      }
      return null;
    },
    [comRect],
  );

  if (engine === null || comRect.length === 0) return null;

  return (
    <div
      ref={camadaRef}
      className={className ?? 'robustus-pane-chrome'}
      aria-label={ariaLabel}
      style={{
        position: 'absolute',
        inset: 0,
        // ⚠️ Ver o cabeçalho: a camada cobre TODA a área das panes. Sem isto, ela engoliria o
        // pan, o zoom, o crosshair e o clique de propriedades — o gráfico ficaria inerte.
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {comRect.map(({ item, rect, posicao }) => {
        const arrastando = arrasto?.paneIndex === item.paneIndex;
        const alvoAqui = arrasto !== null && !arrastando && arrasto.alvo === posicao;
        return (
          <div
            key={item.paneIndex}
            data-pane-index={item.paneIndex}
            data-pane-position={posicao}
            style={{
              position: 'absolute',
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none',
              // ⭐ O DESTINO do arrasto é dito por uma borda na pane inteira, não por uma linha
              // fina entre panes: numa GRADE em colunas, "entre" é ambíguo (entre qual par?),
              // enquanto "esta pane troca de lugar com a que você está arrastando" não é.
              outline: alvoAqui ? '2px dashed rgba(56,189,248,0.9)' : 'none',
              outlineOffset: -2,
              background: alvoAqui ? 'rgba(56,189,248,0.07)' : 'transparent',
              opacity: arrastando ? 0.45 : 1,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 4,
                top: 3,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                maxWidth: 'calc(100% - 66px)',
                padding: '1px 4px',
                borderRadius: 4,
                // Caixa translúcida: a faixa fica SOBRE a grade e o traço do indicador, e texto
                // claro sobre linha clara é ilegível. Mesma razão da caixa da legenda do bookmap.
                background: 'rgba(15,23,42,0.72)',
                fontSize: 10,
                lineHeight: 1.3,
                color: '#cbd5e1',
                pointerEvents: 'auto',
              }}
            >
              {onReorder !== undefined && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Mover ${item.label}. Arraste, ou use Alt com as setas.`}
                  title="Arraste para trocar de posição"
                  data-role="alca"
                  onPointerDown={(e) => {
                    // ⚠️ Só o botão principal, e a captura vai para a ALÇA: sem captura, sair do
                    // elemento no meio do arrasto mataria o gesto.
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    } catch {
                      /* ambiente sem captura */
                    }
                    setArrasto({ paneIndex: item.paneIndex, alvo: posicao });
                  }}
                  onPointerMove={(e) => {
                    if (arrasto?.paneIndex !== item.paneIndex) return;
                    const alvo = posicaoNoPonto(e.clientX, e.clientY);
                    if (alvo !== null && alvo !== arrasto.alvo) {
                      setArrasto({ paneIndex: item.paneIndex, alvo });
                    }
                  }}
                  onPointerUp={(e) => {
                    if (arrasto?.paneIndex !== item.paneIndex) return;
                    e.stopPropagation();
                    const destino = arrasto.alvo;
                    setArrasto(null);
                    if (destino !== posicao) onReorder(item.paneIndex, destino);
                  }}
                  onPointerCancel={() => setArrasto(null)}
                  onKeyDown={(e) => {
                    // ⭐ Reordenar por TECLADO, e é obrigatório: arrastar é um gesto que exclui
                    // quem não usa mouse. `Alt` porque as setas soltas rolam a página, e o
                    // ouvinte de atalho de tecla única da barra ignora eventos com modificador.
                    if (!e.altKey) return;
                    const passo = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
                    if (passo === 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onReorder(item.paneIndex, posicao + passo);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    cursor: 'grab',
                    opacity: 0.6,
                    // ⚠️ Alvo de 12 px de largura mínima: menor que isso e a alça vira um pixel
                    // que ninguém acerta, e o operador conclui que não dá para mover.
                    minWidth: 12,
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="layers" size={10} />
                </span>
              )}

              {item.color !== undefined && (
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 2,
                    background: item.color,
                    flex: '0 0 auto',
                  }}
                />
              )}

              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: item.visible === false ? 0.45 : 1,
                }}
                title={item.detail === undefined ? item.label : `${item.label} · ${item.detail}`}
              >
                {item.label}
                {item.detail !== undefined && (
                  <span style={{ opacity: 0.6 }}> · {item.detail}</span>
                )}
              </span>

              {item.onOpenSettings !== undefined && (
                <BotaoCromo
                  rotulo={`Propriedades de ${item.label}`}
                  icone="settings"
                  onAcionar={item.onOpenSettings}
                />
              )}
              {item.onToggleVisible !== undefined && item.visible !== undefined && (
                <BotaoCromo
                  rotulo={`${item.visible ? 'Ocultar' : 'Mostrar'} ${item.label}`}
                  icone={item.visible ? 'eye' : 'eyeOff'}
                  onAcionar={item.onToggleVisible}
                />
              )}
              {item.onRemove !== undefined && (
                <BotaoCromo
                  rotulo={`Remover ${item.label}`}
                  icone="close"
                  onAcionar={item.onRemove}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Um botão do cromo.
 *
 * ⚠️ `stopPropagation` no clique: o botão fica SOBRE a área do gráfico, e sem isso o clique
 * chegaria ao canvas depois de acionar o botão — abrindo as propriedades de um indicador ao
 * mesmo tempo em que o operador o remove.
 */
function BotaoCromo({
  rotulo,
  icone,
  onAcionar,
}: {
  readonly rotulo: string;
  readonly icone: 'settings' | 'eye' | 'eyeOff' | 'close';
  readonly onAcionar: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={(e) => {
        e.stopPropagation();
        onAcionar();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={estiloBotaoCromo}
    >
      <Icon name={icone} size={10} />
    </button>
  );
}

const estiloBotaoCromo: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  padding: 0,
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  opacity: 0.65,
  flex: '0 0 auto',
};
