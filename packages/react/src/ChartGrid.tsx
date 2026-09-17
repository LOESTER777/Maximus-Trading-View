/**
 * ChartGrid — vários gráficos na MESMA tela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO HABILITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O pedido: *"adicionar mais de um TF na mesma tela"* e *"deixar na mesma tela para
 * acompanhar a correlação"*. As abas (`SymbolTabs`) dão um ativo por vez; esta grade dá
 * vários ao mesmo tempo, e `useChartSync` os mantém alinhados.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ POR QUE UM COMPONENTE, SE É "SÓ CSS GRID"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Porque a parte que erra não é o `grid-template`: é a ALTURA. O motor mede o container e
 * desenha nada se a altura for zero — sem erro, sem aviso. Num `display: grid`, uma célula
 * sem altura explícita colapsa para a altura do conteúdo, e o conteúdo é um canvas de
 * altura zero. É a armadilha número um de "o gráfico não aparece", e este componente existe
 * para fechá-la: as linhas usam `1fr` e o container tem `minHeight: 0`, que é o que permite
 * uma célula flex/grid encolher em vez de estourar o pai.
 *
 * ⚠️ E ele NÃO cria gráfico nenhum. Recebe os painéis como filhos — quem monta cada
 * `RobustusChart`/`useChartEngine` é o consumidor, com o dado e as camadas dele. Criar aqui
 * amarraria a grade a uma forma de montar painel.
 */
import { type CSSProperties, type ReactNode } from 'react';
import { joinClasses } from './SegmentedControl.js';

/**
 * Arranjo da grade.
 *
 * ⚠️ Um conjunto FECHADO, e não `{colunas, linhas}` livres, de propósito: os arranjos de
 * mesa são estes, e cada um tem uma leitura própria (`'2-vertical'` é o clássico
 * preço/oscilador; `'2-horizontal'` é o clássico correlação). Um par de números livre
 * convidaria a 5x7, que não é layout de gráfico — é planilha.
 */
export type ChartGridLayout = '1' | '2-horizontal' | '2-vertical' | '3-horizontal' | '4';

export interface ChartGridProps {
  readonly layout: ChartGridLayout;
  /**
   * Um painel por célula, na ordem de leitura.
   *
   * ⚠️ Filho a MAIS que o arranjo comporta continua sendo renderizado, e o navegador o
   * empilha na última célula. Não recortamos a lista: esconder conteúdo que o consumidor
   * pediu para mostrar seria pior — e o excesso é visível na hora, o que faz o próprio
   * layout denunciar o erro.
   */
  readonly children: ReactNode;
  /** Espaço entre painéis, em px. Default 6. */
  readonly gap?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Rótulo da região. Default `'Painéis de gráfico'`. */
  readonly ariaLabel?: string;
}

/** `grid-template` de cada arranjo. */
function template(layout: ChartGridLayout): { colunas: string; linhas: string } {
  switch (layout) {
    case '2-horizontal':
      // Lado a lado: a leitura de correlação (dois ativos, mesmo instante).
      return { colunas: '1fr 1fr', linhas: '1fr' };
    case '2-vertical':
      // Empilhados: a leitura de contexto (o mesmo ativo em dois períodos).
      return { colunas: '1fr', linhas: '1fr 1fr' };
    case '3-horizontal':
      return { colunas: '1fr 1fr 1fr', linhas: '1fr' };
    case '4':
      return { colunas: '1fr 1fr', linhas: '1fr 1fr' };
    case '1':
    default:
      return { colunas: '1fr', linhas: '1fr' };
  }
}

/** Quantas células o arranjo tem. Útil ao consumidor para dimensionar a lista. */
export function chartGridSlots(layout: ChartGridLayout): number {
  switch (layout) {
    case '2-horizontal':
    case '2-vertical':
      return 2;
    case '3-horizontal':
      return 3;
    case '4':
      return 4;
    case '1':
    default:
      return 1;
  }
}

/**
 * Grade de painéis.
 *
 * @example
 * <ChartGrid layout="2-vertical">
 *   <RobustusChart candles={m5} height="100%" />
 *   <RobustusChart candles={h1} height="100%" />
 * </ChartGrid>
 */
export function ChartGrid({
  layout,
  children,
  gap = 6,
  className,
  style,
  ariaLabel = 'Painéis de gráfico',
}: ChartGridProps): JSX.Element {
  const t = template(layout);

  return (
    <div
      className={joinClasses('robustus-grid', className)}
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'grid',
        gridTemplateColumns: t.colunas,
        gridTemplateRows: t.linhas,
        gap,
        // ⚠️ Estes três são o que faz a grade FUNCIONAR dentro de um pai flex:
        // `height: 100%` para ocupar o espaço dado, e os dois `minSize: 0` para poder
        // ENCOLHER. Sem `minHeight: 0`, uma célula com conteúdo grande estoura o pai em vez
        // de caber — e o gráfico é justamente um conteúdo que quer todo o espaço.
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
