/**
 * `CorrelationInset` — o gráfico DENTRO do gráfico, para ver correlação.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO, E A DECISÃO DE NÃO USAR UM SEGUNDO MOTOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"analise se é possível termos um gráfico dentro de outro gráfico para podermos ver a
 * correlação"*.
 *
 * É possível de dois jeitos, e escolhi o segundo:
 *
 *  1. **Um segundo motor** num `<div>` absoluto, com pan/zoom desligados e a janela espelhada.
 *     Dá tudo o que o motor dá — e cobra por tudo: outro canvas, outro observador de
 *     redimensionamento, outro ciclo de quadro, e um estado a mais para manter em acordo com o
 *     gráfico de baixo.
 *  2. **SVG**, com as duas séries em base 100 e o coeficiente escrito. É o que este arquivo é.
 *
 * ⭐ A escolha é sobre o que o inset É: uma leitura de RELAÇÃO, não um gráfico operável. Não se
 * desenha em cima dele, não se dá zoom nele, não se lê preço nele — se olha se as duas linhas
 * andam juntas. Para isso, canvas com ciclo de quadro é peso sem retorno, e SVG escala com o
 * zoom do navegador sem ficar borrado.
 *
 * ⚠️ E o número importa mais que o desenho. Olho não distingue correlação de 0,4 de correlação
 * de 0,8, e é justamente nessa faixa que a decisão de hedge muda. O desenho mostra QUANDO
 * divergiram; o coeficiente diz QUANTO andam juntas.
 *
 * ⚠️ Os tipos entram ESTRUTURALMENTE: `react` não importa `charts-core` em runtime — a mesma
 * regra do registry de indicadores, da trilha de legendas e da leitura do ativo.
 */
import type { CSSProperties, JSX } from 'react';

export interface SerieDoInset {
  readonly label: string;
  readonly color: string;
  /** Pontos JÁ em base 100. Ver `normalizarBase100` no `charts-core`. */
  readonly pontos: readonly { readonly time: number; readonly valor: number }[];
}

export interface CorrelationInsetProps {
  readonly a: SerieDoInset;
  readonly b: SerieDoInset;
  /** Pearson dos RETORNOS, em `-1..1`. `null` = amostra insuficiente ou sem variação. */
  readonly coeficiente: number | null;
  /** Leitura em pt-BR do coeficiente. */
  readonly leitura?: string;
  readonly amostras?: number;
  /** Onde o inset ancora dentro do gráfico. Default `'superior-direita'`. */
  readonly posicao?: 'superior-direita' | 'inferior-direita' | 'inferior-esquerda';
  readonly onFechar?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const LARGURA = 220;
const ALTURA = 96;

export function CorrelationInset({
  a,
  b,
  coeficiente,
  leitura,
  amostras,
  posicao = 'superior-direita',
  onFechar,
  className,
  style,
}: CorrelationInsetProps): JSX.Element | null {
  // ⚠️ Sem as DUAS séries não há comparação a mostrar. Desenhar uma linha só num painel
  // rotulado "correlação" faria o operador procurar a segunda achando que ela sumiu.
  if (a.pontos.length < 2 || b.pontos.length < 2) return null;

  const todos = [...a.pontos, ...b.pontos];
  let min = Infinity;
  let max = -Infinity;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of todos) {
    if (!Number.isFinite(p.valor) || !Number.isFinite(p.time)) continue;
    if (p.valor < min) min = p.valor;
    if (p.valor > max) max = p.valor;
    if (p.time < tMin) tMin = p.time;
    if (p.time > tMax) tMax = p.time;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(tMax > tMin)) return null;
  // ⭐ Escala vertical COMPARTILHADA pelas duas séries — é o ponto de estarem em base 100.
  // Normalizar cada uma na própria faixa faria uma alta de 2% e uma de 40% ocuparem a mesma
  // altura, e a comparação, que é o único propósito, deixaria de existir.
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }

  const x = (t: number): number => ((t - tMin) / (tMax - tMin)) * LARGURA;
  const y = (v: number): number => ALTURA - ((v - min) / (max - min)) * ALTURA;
  const caminho = (s: SerieDoInset): string =>
    s.pontos
      .filter((p) => Number.isFinite(p.valor) && Number.isFinite(p.time))
      .map((p) => `${x(p.time).toFixed(1)},${y(p.valor).toFixed(1)}`)
      .join(' ');

  const y100 = y(100);
  const corDoNumero =
    coeficiente === null
      ? '#94a3b8'
      : coeficiente >= 0.4
        ? '#16c784'
        : coeficiente <= -0.4
          ? '#ea3943'
          : '#94a3b8';

  return (
    <aside
      className={className ?? 'robustus-inset'}
      style={{ ...estiloBase, ...ancora(posicao), ...style }}
      aria-label={`Correlação entre ${a.label} e ${b.label}`}
    >
      <header style={estiloCabecalho}>
        <span style={{ opacity: 0.7 }}>Correlação</span>
        <strong style={{ color: corDoNumero, fontVariantNumeric: 'tabular-nums' }}>
          {/*
            ⚠️ `—` e não `0,00` quando não há amostra: zero afirma "não andam juntas", e a
            verdade é "não sei". É a mesma regra de `null` do resto da biblioteca.
          */}
          {coeficiente === null ? '—' : coeficiente.toFixed(2)}
        </strong>
        {onFechar !== undefined && (
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar comparação"
            title="Fechar"
            style={estiloFechar}
          >
            ×
          </button>
        )}
      </header>

      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${a.label} e ${b.label}, em base 100`}
      >
        {/* A linha do 100: é ela que dá sentido a "acima" e "abaixo" do ponto de partida. */}
        {y100 >= 0 && y100 <= ALTURA && (
          <line x1={0} y1={y100} x2={LARGURA} y2={y100} stroke="rgba(148,163,184,0.3)" strokeWidth={1} />
        )}
        <polyline fill="none" stroke={a.color} strokeWidth={1.6} points={caminho(a)} />
        <polyline fill="none" stroke={b.color} strokeWidth={1.6} points={caminho(b)} />
      </svg>

      <footer style={estiloRodape}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span aria-hidden style={{ width: 7, height: 2, background: a.color }} />
          {a.label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span aria-hidden style={{ width: 7, height: 2, background: b.color }} />
          {b.label}
        </span>
        {leitura !== undefined && (
          <span style={{ opacity: 0.6 }}>
            {leitura}
            {/* A contagem entra junto: "forte" com 22 amostras e com 4.000 não valem o mesmo. */}
            {amostras !== undefined && amostras > 0 ? ` · ${amostras}` : ''}
          </span>
        )}
      </footer>
    </aside>
  );
}

/**
 * ⚠️ `pointerEvents: 'none'` no involucro e `'auto'` só no botão de fechar.
 *
 * O inset flutua SOBRE a área de plotagem, e um retângulo opaco de 220 px capturando ponteiro
 * ali criaria uma região do gráfico onde o pan não começa e o desenho não desenha — o mesmo
 * defeito que a `ChartLegend` documenta e que já custou uma rodada de diagnóstico.
 */
const estiloBase: CSSProperties = {
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 4,
  width: 240,
  padding: 6,
  borderRadius: 6,
  border: '1px solid rgba(148,163,184,0.22)',
  background: 'rgba(15,23,42,0.86)',
  fontSize: 10,
  lineHeight: 1.3,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

function ancora(p: NonNullable<CorrelationInsetProps['posicao']>): CSSProperties {
  // ⚠️ A direita reserva 60 px: é a faixa do eixo de preço do motor. Ancorar em `right: 8`
  // poria o inset por cima dos rótulos de preço, que é informação que ele não pode cobrir.
  switch (p) {
    case 'inferior-direita':
      return { bottom: 34, right: 62 };
    case 'inferior-esquerda':
      return { bottom: 34, left: 10 };
    default:
      return { top: 8, right: 62 };
  }
}

const estiloCabecalho: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
};

const estiloRodape: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  fontSize: 9,
};

const estiloFechar: CSSProperties = {
  // Só o botão volta a receber ponteiro — ver a nota em `estiloBase`.
  pointerEvents: 'auto',
  marginLeft: 'auto',
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  padding: '0 2px',
};
