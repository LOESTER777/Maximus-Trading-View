/**
 * SymbolTabs — abas de ATIVO (e de qualquer coisa que o operador troque por aba).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO HABILITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido: *"seria importante eu poder carregar outros ativos na tela, separá-los por
 * aba, mas se quiser deixar na mesma tela para acompanhar a correlação"*.
 *
 * São dois modos de ver vários ativos, e este componente cobre o primeiro (um por vez,
 * troca instantânea). O segundo — os dois na tela ao mesmo tempo — é `ChartGrid` mais
 * `useChartSync`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ABA É NAVEGAÇÃO, NÃO ESCOLHA — e por isso não é `radiogroup`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O tipo de gráfico é `radiogroup` (uma escolha entre alternativas). Aba é outra coisa: o
 * padrão ARIA de `tablist`/`tab`/`tabpanel` descreve "regiões de conteúdo alternadas", e é
 * o que leitor de tela e teclado esperam aqui. Usar o padrão errado promete um
 * comportamento de teclado que não se cumpre.
 *
 * ⭐ **Teclado:** ← → andam entre abas, Home/End vão às pontas, e a aba ativa é a ÚNICA
 * focável (`tabIndex` 0 nela, -1 nas outras). Isso é o "tab stop único" do padrão: um Tab
 * entra na barra de abas, outro Tab sai para o conteúdo — em vez de o operador tabular por
 * dez abas para chegar ao gráfico.
 *
 * ⚠️ **Fechar é botão SEPARADO, dentro da aba.** Um `onClick` no ✕ que borbulhasse
 * trocaria de aba antes de fechar; o `stopPropagation` é o que impede isso. E o ✕ tem
 * `aria-label` próprio, senão o leitor anuncia dois controles com o mesmo nome.
 */
import { useCallback, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon } from './icons.js';
import { joinClasses, useChromeStyles } from './SegmentedControl.js';

export interface SymbolTab {
  /** Chave estável. É o que volta em `onChange`/`onClose`. */
  readonly id: string;
  /** O que o operador lê: `'WINV26'`, `'WDO · M5'`. */
  readonly label: string;
  /** Segunda linha discreta: período, bolsa, o que distinguir. */
  readonly hint?: string;
  /**
   * Esta aba pode ser fechada? Default `true` quando `onClose` existe.
   *
   * ⚠️ Serve para a última aba não poder ser fechada: uma barra de abas vazia deixa a tela
   * sem gráfico e sem caminho de volta.
   */
  readonly closable?: boolean;
}

export interface SymbolTabsProps {
  readonly tabs: readonly SymbolTab[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Ausente = abas não fecham (nem mostram o ✕). */
  readonly onClose?: (id: string) => void;
  /** Ausente = não há botão de adicionar. */
  readonly onAdd?: () => void;
  /** Rótulo do conjunto. Default `'Ativos'`. */
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const estiloBarra: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  minWidth: 0,
  // ⚠️ Rolagem horizontal em vez de quebra de linha: uma barra de abas que cresce em
  // altura empurra o gráfico para baixo a cada ativo novo, e o gráfico é o conteúdo.
  overflowX: 'auto',
};

function estiloAba(ativa: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    fontSize: 11,
    fontFamily: 'inherit',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    border: '1px solid rgba(148,163,184,0.2)',
    borderBottomColor: ativa ? 'transparent' : 'rgba(148,163,184,0.2)',
    borderRadius: '6px 6px 0 0',
    background: ativa ? 'rgba(148,163,184,0.14)' : 'transparent',
    color: ativa ? '#e2e8f0' : 'inherit',
  };
}

const estiloFechar: CSSProperties = {
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
  opacity: 0.6,
};

export function SymbolTabs({
  tabs,
  value,
  onChange,
  onClose,
  onAdd,
  ariaLabel = 'Ativos',
  className,
  style,
}: SymbolTabsProps): JSX.Element {
  useChromeStyles();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const indiceAtivo = tabs.findIndex((t) => t.id === value);

  const irPara = useCallback(
    (i: number): void => {
      const alvo = tabs[i];
      if (alvo === undefined) return;
      onChange(alvo.id);
      // ⚠️ Move o FOCO junto: no padrão de abas com seleção automática, navegar é ativar, e
      // deixar o foco atrás faria a próxima seta partir de onde o operador não está.
      refs.current[i]?.focus();
    },
    [tabs, onChange],
  );

  const aoTeclar = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
      if (tabs.length === 0) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        // Circula: numa barra de abas isso é o esperado (diferente do seletor de período,
        // em que circular daria um salto de escala).
        irPara((i + 1) % tabs.length);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        irPara((i - 1 + tabs.length) % tabs.length);
      } else if (e.key === 'Home') {
        e.preventDefault();
        irPara(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        irPara(tabs.length - 1);
      }
    },
    [tabs, irPara],
  );

  return (
    <div
      className={joinClasses('robustus-tabs', className)}
      style={{ ...estiloBarra, ...style }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((t, i) => {
        const ativa = t.id === value;
        const podeFechar = onClose !== undefined && (t.closable ?? true);
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={ativa}
            // ⭐ Tab stop ÚNICO: só a aba ativa é focável. Sem isso o operador tabularia
            // por todas as abas antes de chegar ao gráfico.
            tabIndex={ativa || (indiceAtivo < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => aoTeclar(e, i)}
            style={estiloAba(ativa)}
          >
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span>{t.label}</span>
              {t.hint !== undefined && t.hint !== '' && (
                <span style={{ fontSize: 9, opacity: 0.6 }}>{t.hint}</span>
              )}
            </span>

            {podeFechar && (
              /*
               * ⚠️ Botão DENTRO do botão de aba é inválido em HTML — este é um `<span>` com
               * `role="button"`, focável e acionável por teclado. A alternativa (o ✕ fora
               * da aba) desalinharia o alvo de clique do rótulo que ele fecha.
               */
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Fechar ${t.label}`}
                onClick={(e) => {
                  // Sem isto, fechar também TROCARIA de aba antes de fechar.
                  e.stopPropagation();
                  onClose?.(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose?.(t.id);
                  }
                }}
                style={estiloFechar}
              >
                <Icon name="close" size={10} />
              </span>
            )}
          </button>
        );
      })}

      {onAdd !== undefined && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Adicionar ativo"
          style={{ ...estiloAba(false), borderRadius: 6, opacity: 0.8 }}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  );
}
