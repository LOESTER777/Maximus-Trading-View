/**
 * `AssetReadout` — o painel de LEITURA do ativo.
 *
 * ⭐ O pedido, com as palavras do operador: *"widgets de como está o nosso ativo"* —
 * desempenho por janela, sazonalidade sobreposta por ano e um termômetro técnico.
 *
 * ⚠️ **Nenhum dado novo entra aqui.** Tudo sai das barras que já estão na tela, relidas em
 * outra pergunta pelos núcleos puros de `asset-readout.core.ts`. É o que torna o painel
 * barato: zero requisição, zero estado próprio.
 *
 * ⚠️ **A quarta caixa da referência (estrutura a termo de IV) não existe**, e a ausência é
 * declarada em vez de preenchida com um número parecido. Ela exige cadeia de opções, que
 * nenhuma base deste projeto tem. Volatilidade histórica no lugar de implícita seria trocar
 * "o que o mercado paga pelo futuro" por "o que já aconteceu" — dois números diferentes com
 * o mesmo rótulo.
 *
 * ⚠️ Os tipos entram ESTRUTURALMENTE: o pacote `react` não importa `charts-core` em runtime,
 * mesma regra do registry de indicadores, da lista de períodos e da trilha de legendas.
 */
import type { CSSProperties, JSX } from 'react';

export interface DesempenhoDeJanela {
  readonly janela: string;
  readonly variacao: number | null;
  readonly desde?: number | null;
}

export interface AnoSazonal {
  readonly ano: number;
  readonly pontos: readonly { readonly dia: number; readonly acumulado: number }[];
  /**
   * Dias DISTINTOS do ano cobertos por este ano de dado.
   *
   * ⚠️ Opcional para não quebrar consumidor que já monta este objeto à mão. Ausente conta como
   * "não sei", e o componente então usa a contagem de pontos como aproximação pessimista.
   */
  readonly diasCobertos?: number;
}

export interface TermometroLido {
  readonly escore: number;
  readonly leitura: string;
  readonly votantes: number;
  readonly compras: number;
  readonly vendas: number;
  readonly neutros: number;
}

export interface AssetReadoutProps {
  readonly symbol: string;
  /** Rótulo por janela, na ordem de leitura. Ver `desempenhoPorJanela`. */
  readonly performance?: readonly DesempenhoDeJanela[];
  /** Rótulos legíveis por janela (`{ '1S': '1 sem' }`). Sem isso mostra a chave. */
  readonly rotulos?: Readonly<Record<string, string>>;
  readonly seasonality?: readonly AnoSazonal[];
  readonly gauge?: TermometroLido;
  /** Rótulos legíveis da leitura técnica (`{ COMPRA_FORTE: 'Compra forte' }`). */
  readonly rotulosTecnicos?: Readonly<Record<string, string>>;
  /**
   * ⭐⭐ Cobertura MÍNIMA de dias do ano para a sazonalidade ser desenhada. Default 60.
   *
   * Ver `DIAS_MINIMOS_DE_SAZONALIDADE` no `charts-core` — a regra é a mesma, e o número entra
   * por prop para o consumidor poder apertar (não para afrouxar em silêncio).
   */
  readonly diasMinimosSazonalidade?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const COR_ALTA = '#16c784';
const COR_BAIXA = '#ea3943';
const COR_NEUTRA = '#94a3b8';

/** Cores por ano da sazonalidade, em ordem de desenho. */
const CORES_DE_ANO = ['#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

export function AssetReadout({
  symbol,
  performance,
  rotulos,
  seasonality,
  gauge,
  rotulosTecnicos,
  diasMinimosSazonalidade = 60,
  className,
  style,
}: AssetReadoutProps): JSX.Element {
  /**
   * ⭐⭐ A sazonalidade tem COBERTURA para significar algo?
   *
   * ⚠️ Relato: *"Card Sazonalidade tem apenas uma barra vertical"*. O cálculo estava certo — a
   * série era de 20 horas, então todos os pontos caíam no MESMO dia do ano e a curva virava um
   * traço vertical. O erro era o widget DESENHAR em vez de dizer que não tinha o que dizer, e
   * é a pior categoria num painel de leitura: o operador não distingue "o mercado não tem
   * sazonalidade" de "não há dado" — as duas coisas viram um risco.
   *
   * ⚠️ `diasCobertos` ausente cai na contagem de PONTOS, que é pessimista de propósito: um
   * consumidor que monte o objeto à mão sem o campo não passa a guarda por acidente.
   */
  const sazonalidadeUtil =
    seasonality !== undefined &&
    seasonality.some((a) => (a.diasCobertos ?? a.pontos.length) >= diasMinimosSazonalidade);

  /**
   * ⭐ Alguma janela de desempenho tem resposta?
   *
   * ⚠️ As três guardas de `desempenhoPorJanela` recusam janela que a série não ALCANÇA, e com
   * razão. Mas seis chips escritos `—` não comunicam "história curta": parecem defeito. Quando
   * NENHUMA janela responde, a seção diz o motivo em vez de mostrar a grade vazia.
   */
  const algumDesempenho =
    performance !== undefined && performance.some((p) => p.variacao !== null);
  return (
    <section
      className={className ?? 'robustus-readout'}
      style={{ ...estiloRaiz, ...style }}
      aria-label={`Leitura de ${symbol}`}
    >
      {performance !== undefined && performance.length > 0 && (
        <div>
          <h4 style={estiloTitulo}>Desempenho</h4>
          {algumDesempenho ? (
            <div style={estiloGrade}>
              {performance.map((p) => (
                <Chip
                  key={p.janela}
                  rotulo={rotulos?.[p.janela] ?? p.janela}
                  variacao={p.variacao}
                />
              ))}
            </div>
          ) : (
            <SemDado texto="A série na tela é curta demais para comparar janelas. Carregue mais histórico (arraste para a esquerda) ou escolha um período maior." />
          )}
        </div>
      )}

      {seasonality !== undefined && seasonality.length > 0 && (
        <div>
          <h4 style={estiloTitulo}>Sazonalidade</h4>
          {sazonalidadeUtil ? (
            <Sazonalidade anos={seasonality} />
          ) : (
            <SemDado
              texto={`Sazonalidade compara o CAMINHO de anos diferentes, e exige pelo menos ${diasMinimosSazonalidade} dias de pregão num ano. A série na tela cobre ${maiorCobertura(seasonality)}.`}
            />
          )}
        </div>
      )}

      {gauge !== undefined && (
        <div>
          <h4 style={estiloTitulo}>Técnicos</h4>
          <Termometro
            gauge={gauge}
            rotulo={rotulosTecnicos?.[gauge.leitura] ?? gauge.leitura}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Uma caixa de desempenho.
 *
 * ⚠️ `null` mostra `—` e NÃO `0,00%`. A janela sem histórico suficiente é "não sei", e um
 * zero ali afirmaria estabilidade num período que o ativo nem viveu.
 *
 * ⚠️ O SINAL vai junto com a cor, nunca só a cor: verde e vermelho são exatamente o par que
 * ~8% dos homens não distingue, e a informação não pode depender só do matiz.
 */
function Chip({ rotulo, variacao }: { rotulo: string; variacao: number | null }): JSX.Element {
  const desconhecido = variacao === null || !Number.isFinite(variacao);
  const positivo = !desconhecido && variacao > 0;
  const negativo = !desconhecido && variacao < 0;
  const cor = desconhecido ? COR_NEUTRA : positivo ? COR_ALTA : negativo ? COR_BAIXA : COR_NEUTRA;

  return (
    <div
      style={{
        ...estiloChip,
        borderColor: desconhecido ? 'rgba(148,163,184,0.2)' : `${cor}55`,
        background: desconhecido ? 'transparent' : `${cor}14`,
      }}
    >
      <strong style={{ color: cor, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
        {desconhecido
          ? '—'
          : `${positivo ? '+' : negativo ? '−' : ''}${Math.abs(variacao).toFixed(2)}%`}
      </strong>
      <span style={{ fontSize: 9, opacity: 0.65 }}>{rotulo}</span>
    </div>
  );
}

/** A maior cobertura, em dias, entre os anos — para a mensagem dizer o que HÁ. */
function maiorCobertura(anos: readonly AnoSazonal[]): string {
  const maior = anos.reduce((m, a) => Math.max(m, a.diasCobertos ?? a.pontos.length), 0);
  return maior === 1 ? '1 dia' : `${maior} dia${maior === 0 ? 's' : 's'}`;
}

/**
 * ⭐ A ausência de dado, DITA — e não um espaço em branco nem um traço.
 *
 * ⚠️ É o padrão que faltava neste painel. Um widget de leitura que não pode responder tem de
 * dizer POR QUE e O QUE FAZER; sem isso o operador conclui que a ferramenta está quebrada, e é
 * uma conclusão razoável — nada na tela contradiz.
 *
 * `role="note"` e não `alert`: é informação de contexto, não um evento que interrompe.
 */
function SemDado({ texto }: { texto: string }): JSX.Element {
  return (
    <p
      role="note"
      style={{
        margin: 0,
        fontSize: 10,
        lineHeight: 1.45,
        color: 'rgba(148,163,184,0.85)',
        background: 'rgba(148,163,184,0.07)',
        border: '1px dashed rgba(148,163,184,0.25)',
        borderRadius: 5,
        padding: '5px 7px',
      }}
    >
      {texto}
    </p>
  );
}

/**
 * As curvas de sazonalidade, uma por ano, em SVG.
 *
 * ⚠️ SVG e não canvas, e é decisão: são poucas centenas de pontos, o desenho é estático, e
 * SVG escala com o zoom do navegador sem ficar borrado. Canvas exigiria observar
 * redimensionamento e razão de pixel para ganhar nada aqui.
 *
 * ⚠️ A escala vertical é COMPARTILHADA entre os anos. Normalizar cada ano na própria faixa
 * faria um ano de +2% e outro de +40% ocuparem a mesma altura — e a comparação, que é o
 * único propósito do gráfico, deixaria de existir.
 */
function Sazonalidade({ anos }: { anos: readonly AnoSazonal[] }): JSX.Element {
  const L = 260;
  const A = 90;

  let min = Infinity;
  let max = -Infinity;
  for (const ano of anos) {
    for (const p of ano.pontos) {
      if (!Number.isFinite(p.acumulado)) continue;
      if (p.acumulado < min) min = p.acumulado;
      if (p.acumulado > max) max = p.acumulado;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return <></>;
  // Faixa degenerada (um ano inteiramente plano) receberia divisão por zero.
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }

  const x = (dia: number): number => ((Math.min(366, Math.max(1, dia)) - 1) / 365) * L;
  const y = (v: number): number => A - ((v - min) / (max - min)) * A;
  const yZero = y(0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Retorno acumulado por ano: ${anos.map((a) => a.ano).join(', ')}`}
      >
        {/* A linha do zero: é o que dá sentido a "acima" e "abaixo". */}
        {yZero >= 0 && yZero <= A && (
          <line x1={0} y1={yZero} x2={L} y2={yZero} stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
        )}
        {anos.map((ano, i) => (
          <polyline
            key={ano.ano}
            fill="none"
            stroke={CORES_DE_ANO[i % CORES_DE_ANO.length]}
            // O ÚLTIMO ano (o corrente) sai mais grosso: é o que o operador está lendo, e os
            // anteriores são referência.
            strokeWidth={i === anos.length - 1 ? 2 : 1.2}
            opacity={i === anos.length - 1 ? 1 : 0.7}
            points={ano.pontos.map((p) => `${x(p.dia).toFixed(1)},${y(p.acumulado).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {anos.map((ano, i) => (
          <span key={ano.ano} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
            <span
              aria-hidden
              style={{
                width: 7,
                height: 2,
                background: CORES_DE_ANO[i % CORES_DE_ANO.length],
                display: 'inline-block',
              }}
            />
            {ano.ano}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * O termômetro: um arco de venda a compra com o ponteiro no consenso.
 *
 * ⚠️ **Zero votantes é dito com palavras**, não desenhado como "Neutro". Um ponteiro no
 * centro parece um diagnóstico de equilíbrio; a verdade é que nenhum indicador opinou, e as
 * duas coisas levam a decisões diferentes.
 */
function Termometro({ gauge, rotulo }: { gauge: TermometroLido; rotulo: string }): JSX.Element {
  const semVoto = gauge.votantes === 0;
  const cor = semVoto
    ? COR_NEUTRA
    : gauge.escore >= 0.15
      ? COR_ALTA
      : gauge.escore <= -0.15
        ? COR_BAIXA
        : COR_NEUTRA;

  // O arco vai de −90° (venda) a +90° (compra); o escore em −1..1 mapeia linearmente.
  const anguloGraus = Math.max(-1, Math.min(1, gauge.escore)) * 90;
  const rad = ((anguloGraus - 90) * Math.PI) / 180;
  const cx = 60;
  const cy = 56;
  const r = 42;

  return (
    <div>
      <svg viewBox="0 0 120 66" style={{ width: '100%', maxWidth: 180, display: 'block' }} role="img" aria-label={`Consenso técnico: ${rotulo}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy - r}`} fill="none" stroke={COR_BAIXA} strokeWidth={7} opacity={0.5} strokeLinecap="round" />
        <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={COR_ALTA} strokeWidth={7} opacity={0.5} strokeLinecap="round" />
        {!semVoto && (
          <line
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(rad) * (r - 6)}
            y2={cy + Math.sin(rad) * (r - 6)}
            stroke={cor}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}
        <circle cx={cx} cy={cy} r={3} fill={cor} />
      </svg>
      <div style={{ textAlign: 'center', marginTop: 2 }}>
        <strong style={{ color: cor, fontSize: 12 }}>{semVoto ? 'Sem indicadores' : rotulo}</strong>
        <div style={{ fontSize: 9, opacity: 0.6 }}>
          {semVoto
            ? 'Ligue um indicador para ver o consenso'
            : `${gauge.compras} compra · ${gauge.vendas} venda · ${gauge.neutros} neutro`}
        </div>
      </div>
    </div>
  );
}

const estiloRaiz: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: 11,
};

const estiloTitulo: CSSProperties = {
  margin: '0 0 4px',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  opacity: 0.55,
};

const estiloGrade: CSSProperties = {
  display: 'grid',
  // Três colunas: as seis janelas caem em duas linhas de três, como na referência. `1fr`
  // porque os números têm larguras diferentes e a grade tem de manter as caixas iguais.
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};

const estiloChip: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1,
  padding: '4px 2px',
  border: '1px solid',
  borderRadius: 5,
};
