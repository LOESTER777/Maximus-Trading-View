/**
 * RobustusChart — o componente pronto.
 *
 * Envolve `useChartEngine` num elemento com dimensao. E conveniencia: quem precisa
 * de controle sobre o container usa o hook direto.
 *
 * ⚠️ **O container PRECISA ter altura.** Altura zero produz grafico invisivel sem
 * erro nenhum, e e o primeiro lugar a olhar quando "o grafico nao aparece". O
 * default de `height` existe justamente para o caso trivial nao cair nessa
 * armadilha; num container flex, passe `height="100%"` e garanta a altura fora.
 */
import { type CSSProperties } from 'react';
import { useChartEngine, type UseChartEngineParams } from './useChartEngine.js';

export interface RobustusChartProps extends UseChartEngineParams {
  /** Altura CSS. Default `'420px'`. Ver a nota sobre altura zero. */
  readonly height?: string;
  /** Largura CSS. Default `'100%'`. */
  readonly width?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Rotulo acessivel da regiao do grafico. */
  readonly ariaLabel?: string;
}

export function RobustusChart({
  height = '420px',
  width = '100%',
  className,
  style,
  ariaLabel = 'Gráfico de mercado',
  ...params
}: RobustusChartProps): JSX.Element {
  const { containerRef } = useChartEngine(params);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, width, ...style }}
      /*
       * O grafico e desenhado em canvas, portanto e opaco para leitor de tela.
       * `role="img"` com rotulo e o minimo honesto: anuncia que ali ha conteudo
       * grafico e o que ele representa, em vez de a regiao passar em silencio.
       *
       * ⚠️ Isto NAO torna o grafico acessivel. Dado de serie temporal precisa de
       * alternativa textual ou tabular equivalente, e essa alternativa depende do
       * que o consumidor esta plotando — nao pode ser gerada aqui. Quem publica
       * para o publico deve oferecer essa alternativa ao lado.
       */
      role="img"
      aria-label={ariaLabel}
    />
  );
}
