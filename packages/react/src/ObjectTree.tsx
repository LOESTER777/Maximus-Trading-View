/**
 * `ObjectTree` — TUDO o que está no gráfico, em lista.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"expanda ao máximo tudo sobre o manuseio dos indicadores, componentes dentro do gráfico,
 * leitura de propriedades, movimento e manuseio dos indicadores e objetos, precisa ser de
 * fácil entendimento"*.
 *
 * ⭐ O que faltava não era recurso — era DESCOBERTA. Já existia clique no indicador para
 * abrir propriedades, acerto de ponteiro em desenho, alças de redimensionamento, histórico
 * de desfazer e troca de cor ao vivo. Nada disso se anunciava: o operador tinha de saber que
 * existia para usar. Uma lista de tudo o que está na tela é o índice que faltava — e é onde
 * se descobre que um objeto pode ser escondido, travado ou removido.
 *
 * ⚠️ **`role="list"`, e não `role="tree"`.** O padrão de árvore da ARIA exige navegação por
 * setas com expansão, `aria-expanded`, `aria-level` e um único ponto de tabulação — e entrega
 * isso para uma hierarquia de DOIS níveis fixos (grupo → item), que não tem o que expandir.
 * Uma lista de seções é o que a estrutura realmente é; anunciar árvore prometeria ao leitor
 * de tela uma navegação que não existe.
 *
 * ⚠️ Genérico de propósito: o componente não conhece indicador nem desenho. Quem monta os
 * grupos é o consumidor, que é quem tem os catálogos. Importar `charts-drawings` aqui
 * amarraria a lista a um pacote OPCIONAL — a mesma regra que mantém `useDrawings` fora do
 * motor.
 */
import type { CSSProperties, JSX } from 'react';
import { Icon, type IconName } from './icons.js';

export interface ObjectTreeItem {
  readonly id: string;
  readonly label: string;
  /** Segunda linha, menor: parâmetros, preço, o que distingue dois itens iguais. */
  readonly detail?: string;
  /** Ponto de cor. Ausente = sem ponto (o item não tem cor própria). */
  readonly color?: string;
  readonly icon?: IconName;
  /**
   * Visível no gráfico. `undefined` = este item não tem chave de visibilidade.
   *
   * ⚠️ Distinto de `false`: `undefined` esconde o botão, `false` mostra o botão no estado
   * "escondido". Tratar os dois igual faria a lista oferecer um controle que não faz nada.
   */
  readonly visible?: boolean;
  /** Selecionado no gráfico — o realce tem de concordar com a tela. */
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  readonly onToggleVisible?: () => void;
  readonly onRemove?: () => void;
}

export interface ObjectTreeGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly ObjectTreeItem[];
  /** O que dizer quando o grupo está vazio. Ver `ObjectTree`. */
  readonly emptyHint?: string;
}

export interface ObjectTreeProps {
  readonly groups: readonly ObjectTreeGroup[];
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function ObjectTree({ groups, className, style }: ObjectTreeProps): JSX.Element {
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className={className ?? 'robustus-objects'}
      style={{ ...estiloRaiz, ...style }}
      aria-label={`Objetos no gráfico: ${total}`}
    >
      {groups.map((g) => (
        <section key={g.id} style={estiloSecao} aria-label={g.label}>
          <header style={estiloCabecalho}>
            <span>{g.label}</span>
            <span style={{ opacity: 0.5 }}>{g.items.length}</span>
          </header>

          {g.items.length === 0 ? (
            /*
             * ⚠️ Grupo vazio DIZ o que fazer em vez de desaparecer. Esconder o grupo faria a
             * lista mudar de tamanho conforme o uso, e o operador procuraria a seção que
             * "sumiu". E some com a única dica de como criar o primeiro objeto.
             */
            <p style={estiloVazio}>{g.emptyHint ?? 'Nada aqui ainda.'}</p>
          ) : (
            <ul style={estiloLista} role="list">
              {g.items.map((it) => (
                <li key={it.id} style={estiloItem(it.selected === true)}>
                  {it.color !== undefined && (
                    <span aria-hidden="true" style={{ ...estiloPonto, background: it.color }} />
                  )}
                  {it.icon !== undefined && (
                    <span aria-hidden="true" style={{ opacity: 0.6, display: 'inline-flex' }}>
                      <Icon name={it.icon} size={12} />
                    </span>
                  )}

                  {/*
                    O nome é BOTÃO quando há o que selecionar, e texto quando não há.
                    ⚠️ Um botão que não faz nada é pior que texto: ele recebe foco, é
                    anunciado como acionável pelo leitor de tela e não responde.
                  */}
                  {it.onSelect === undefined ? (
                    <span style={estiloNome}>{it.label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={it.onSelect}
                      style={{ ...estiloNome, ...estiloBotaoNome }}
                      // `aria-current` e não `aria-pressed`: selecionado é "este é o item
                      // corrente da coleção", não um botão em estado ligado.
                      {...(it.selected === true ? { 'aria-current': true } : {})}
                    >
                      {it.label}
                    </button>
                  )}

                  {it.detail !== undefined && (
                    <span style={estiloDetalhe} title={it.detail}>
                      {it.detail}
                    </span>
                  )}

                  <span style={{ flex: 1 }} />

                  {it.visible !== undefined && it.onToggleVisible !== undefined && (
                    <button
                      type="button"
                      onClick={it.onToggleVisible}
                      aria-pressed={it.visible}
                      aria-label={
                        it.visible ? `Esconder ${it.label}` : `Mostrar ${it.label}`
                      }
                      title={it.visible ? 'Esconder' : 'Mostrar'}
                      style={{ ...estiloAcao, opacity: it.visible ? 0.85 : 0.35 }}
                    >
                      <Icon name={it.visible ? 'eye' : 'eyeOff'} size={13} />
                    </button>
                  )}

                  {it.onRemove !== undefined && (
                    <button
                      type="button"
                      onClick={it.onRemove}
                      aria-label={`Remover ${it.label}`}
                      title="Remover"
                      style={estiloAcao}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

const estiloRaiz: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontSize: 11,
};

const estiloSecao: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };

const estiloCabecalho: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  opacity: 0.55,
};

const estiloLista: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

function estiloItem(selecionado: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 5px',
    borderRadius: 4,
    // O realce de seleção tem de CONCORDAR com o gráfico: se o objeto está selecionado lá,
    // a lista mostra isso, senão as duas superfícies discordam sobre o mesmo estado.
    background: selecionado ? 'rgba(56,189,248,0.14)' : 'transparent',
    border: `1px solid ${selecionado ? 'rgba(56,189,248,0.35)' : 'transparent'}`,
  };
}

const estiloPonto: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 2,
  display: 'inline-block',
  flexShrink: 0,
};

const estiloNome: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '16ch',
};

const estiloBotaoNome: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

const estiloDetalhe: CSSProperties = {
  fontSize: 9,
  opacity: 0.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '12ch',
};

const estiloAcao: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  padding: 2,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 3,
};

const estiloVazio: CSSProperties = {
  margin: 0,
  fontSize: 10,
  opacity: 0.5,
  lineHeight: 1.4,
};
