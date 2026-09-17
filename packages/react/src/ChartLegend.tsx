/**
 * ChartLegend — a legenda flutuante sobre o grafico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO E COMPONENTE DE BIBLIOTECA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor NAO desenha a legenda de proposito: ele detecta a barra sob o cursor e
 * publica o dado no evento de crosshair (`MouseEventParams.seriesData`), porque a
 * legenda e HTML/CSS do consumidor. `useCrosshair` traduz esse evento em estado
 * do React. Faltava o ultimo passo — e ele estava sendo escrito **a mao em JSX
 * solto no playground**, o que significa que todo consumidor reescreveria a
 * mesma formatacao, a mesma cor por sinal e os mesmos casos de `null`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `pointerEvents: 'none'` — O DEFEITO QUE ISTO EVITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A legenda fica SOBRE o canvas, no canto superior esquerdo, que e exatamente
 * onde o operador comeca a arrastar para dar pan e onde comeca a maioria das
 * linhas de tendencia. Sem `pointerEvents: 'none'` o `pointerdown` morre na
 * legenda: o grafico nao recebe o inicio do gesto, o arrasto simplesmente **nao
 * acontece** naquela regiao, e o defeito e daqueles que a pessoa nao reporta —
 * ela conclui que "o gráfico travou" e tenta de outro lugar.
 *
 * Consequencia aceita: nada dentro da legenda pode ser clicavel. Isso e limite de
 * projeto, nao esquecimento — controle que precisa de clique vive em barra
 * PROPRIA, fora da area de desenho. Se um dia um item da legenda precisar de
 * clique, ele reabilita `pointerEvents: 'auto'` **so nele**, nunca no container.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ NUNCA EM BRANCO — O ULTIMO VALOR CONHECIDO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `CrosshairReadout` vem vazio quando o cursor esta fora do grafico, e o cursor
 * passa a maior parte do tempo fora. Uma legenda que zera junto pisca a cada vez
 * que o mouse sai, e o operador perde a referencia justamente quando para de
 * mexer para PENSAR.
 *
 * Por isso a legenda retem o ultimo readout valido e o marca como retido
 * (`--stale`, com opacidade menor). Sem cursor nenhuma vez, mostra um convite
 * discreto em vez de campos vazios: campo vazio parece defeito, convite ensina.
 */
import { useRef, type CSSProperties } from 'react';
import type { CrosshairReadout } from './useCrosshair.js';

// ═════════════════════════════════════════════════════════════════════════════
// Vocabulario
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que aparece no lugar de um numero que nao existe.
 *
 * ⚠️ E o mesmo travessao de `PRICE_PLACEHOLDER` do `chart-core`, redeclarado de
 * proposito: `@robustus/charts-react` NAO depende de `chart-core` (ver o grafo de
 * dependencia — quem depende dele e o `engine`), e importar um pacote inteiro
 * para pegar uma string de um caractere amarraria a legenda ao motor. A
 * duplicacao e de UM caractere e esta documentada nas duas pontas.
 */
const SEM_VALOR = '—';

const COR_ALTA = '#22c55e';
const COR_BAIXA = '#ef4444';

/**
 * Os rotulos de O/H/L/C, em pt-BR e com TRES letras.
 *
 * ⚠️ Nao `A`/`M`/`m`/`F`: "Máxima" e "Mínima" comecam com a mesma letra, e
 * distinguir por CAIXA (`M` de máxima, `m` de mínima) e ilegivel a 11 px e
 * invisivel para leitor de tela. Tres letras cabem e nao tem ambiguidade. O
 * `aria-label` de cada campo traz o nome inteiro.
 */
const CAMPOS_OHLC = [
  { chave: 'open', curto: 'Abr', longo: 'Abertura' },
  { chave: 'high', curto: 'Máx', longo: 'Máxima' },
  { chave: 'low', curto: 'Mín', longo: 'Mínima' },
  { chave: 'close', curto: 'Fec', longo: 'Fechamento' },
] as const;

// ═════════════════════════════════════════════════════════════════════════════
// Contrato
// ═════════════════════════════════════════════════════════════════════════════

/** Um valor de indicador a listar na legenda. */
export interface ChartLegendSeries {
  readonly label: string;
  /** `null` = "nao sei" (aquecimento do indicador, barra sem dado). Nunca zero. */
  readonly value: number | null;
  readonly color?: string;
}

export interface ChartLegendProps {
  /** O que `useCrosshair` devolve. */
  readonly readout: CrosshairReadout;
  readonly symbol?: string;
  readonly period?: string;
  readonly series?: readonly ChartLegendSeries[];
  /**
   * ⭐ A TRILHA das camadas de canvas (livro, footprint, perfil de volume).
   *
   * ⚠️ **O defeito que isto encerra:** *"o bookmap ainda está em cima do histograma de
   * volume, ele precisa ficar no topo alinhado ao lado de quem está lá, pois pode haver
   * outros componentes"*. Cada camada escolhia um canto do canvas por conta própria — e
   * duas correções anteriores apenas mudaram o canto da colisão, porque nenhuma camada
   * sabe da faixa do histograma de volume nem desta legenda em HTML.
   *
   * Aqui as linhas entram na MESMA coluna em que já vivem a identidade do ativo, o
   * O/H/L/C e os indicadores. Empilhar é o que garante ausência de sobreposição sem
   * ninguém precisar conhecer a geometria dos outros.
   *
   * Vem de `useLayerLegends(engine)`. Ordem e conteúdo são decididos no núcleo puro
   * `legend-rail.core.ts`; este componente só desenha.
   *
   * ⚠️ Tipado ESTRUTURALMENTE de propósito — o pacote `react` não importa `charts-core`
   * em runtime, mesma regra do registry de indicadores e da lista de períodos.
   */
  readonly notes?: readonly {
    readonly fonte: string;
    readonly linhas: readonly string[];
    readonly alerta?: boolean;
  }[];
  /** Casas decimais. Default 2. */
  readonly precision?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Legenda de O/H/L/C + valores de indicador, para sobrepor ao grafico.
 *
 * ⚠️ Posiciona-se com `position: absolute` — o elemento que envolve o grafico
 * precisa ser `position: relative`, senao a legenda ancora no ancestral
 * posicionado mais proximo (ou no `<body>`) e aparece fora do grafico.
 *
 * @example
 * const ohlc = useCrosshair({ engine });
 * <div style={{ position: 'relative' }}>
 *   <div ref={containerRef} />
 *   <ChartLegend readout={ohlc} symbol="WINFUT" period="5m" />
 * </div>
 */
export function ChartLegend({
  readout,
  symbol,
  period,
  series,
  notes,
  precision = 2,
  className,
  style,
}: ChartLegendProps): JSX.Element {
  /**
   * O ultimo readout com dado. Ver o cabecalho.
   *
   * ⚠️ Escrita em `ref` durante a renderizacao, e nao `useState` + `useEffect`.
   * E cache DERIVADO da prop, idempotente (rodar duas vezes com a mesma prop da
   * o mesmo conteudo, o que satisfaz o modo estrito), e nao deve provocar
   * renderizacao propria: um `setState` aqui dobraria o numero de renders da
   * legenda a cada movimento do mouse — que e o caminho mais quente da interface.
   */
  const ultimoRef = useRef<CrosshairReadout | null>(null);
  if (readout.time !== null) ultimoRef.current = readout;

  const vivo = readout.time !== null;
  const dado = vivo ? readout : ultimoRef.current;
  const nuncaHouveCursor = dado === null;

  return (
    <div
      className={
        className ??
        (vivo ? 'robustus-legend' : 'robustus-legend robustus-legend--stale')
      }
      style={{ ...estiloContainer, opacity: vivo || nuncaHouveCursor ? 1 : 0.66, ...style }}
      // `role="status"` + `aria-live="polite"`: quem usa leitor de tela nao ve o
      // crosshair, e sem isto a legenda seria uma regiao que muda sem anunciar.
      // `polite` e nao `assertive` porque o dado muda por quadro — `assertive`
      // interromperia a fala continuamente e tornaria a pagina inutilizavel.
      role="status"
      aria-live="polite"
      aria-label="Leitura da barra sob o cursor"
    >
      {(symbol !== undefined || period !== undefined) && (
        <div className="robustus-legend__id" style={estiloIdentidade}>
          {symbol !== undefined && (
            <strong className="robustus-legend__symbol" style={{ fontSize: 12 }}>
              {symbol}
            </strong>
          )}
          {period !== undefined && (
            <span className="robustus-legend__period" style={estiloEtiqueta}>
              {period}
            </span>
          )}
        </div>
      )}

      {nuncaHouveCursor ? (
        // Convite, nao campo vazio. Ver o cabecalho.
        <span className="robustus-legend__idle" style={estiloTenue}>
          Passe o cursor sobre o gráfico
        </span>
      ) : dado.value !== null && dado.close === null ? (
        // Serie de linha/area: so `value`, e nao existe variacao intrabar.
        <div className="robustus-legend__ohlc" style={estiloLinha}>
          <Campo curto="Val" longo="Valor" valor={dado.value} precision={precision} />
        </div>
      ) : (
        <div className="robustus-legend__ohlc" style={estiloLinha}>
          {CAMPOS_OHLC.map((c) => (
            <Campo
              key={c.chave}
              curto={c.curto}
              longo={c.longo}
              valor={dado[c.chave]}
              precision={precision}
              // A cor do valor segue o sinal da BARRA (alta/baixa), nao do campo:
              // e a mesma convencao da vela desenhada, e ler cores diferentes por
              // campo dentro da mesma barra confundiria em vez de informar.
              color={corDoSinal(dado.change)}
            />
          ))}
          <Variacao change={dado.change} changePercent={dado.changePercent} precision={precision} />
        </div>
      )}

      {notes !== undefined && notes.length > 0 && (
        <div className="robustus-legend__notes" style={estiloNotas}>
          {notes.map((n) =>
            n.linhas.map((linha, i) => (
              <span
                // A chave junta fonte e ÍNDICE porque a mesma camada emite várias linhas
                // e duas podem ter o mesmo texto (raro, mas possível em estado vazio).
                key={`${n.fonte}-${i}-${linha}`}
                className={`robustus-legend__note robustus-legend__note--${n.fonte}`}
                style={n.alerta === true ? estiloNotaAlerta : estiloNota}
                // Devolve a frase inteira quando ela foi cortada por reticências. Não
                // substitui rótulo: o texto já está no DOM e o leitor de tela o lê todo.
                title={linha}
              >
                {linha}
              </span>
            )),
          )}
        </div>
      )}

      {series !== undefined && series.length > 0 && (
        <div className="robustus-legend__series" style={estiloSeries}>
          {series.map((s) => (
            <span key={s.label} className="robustus-legend__serie" style={estiloSerie}>
              <span
                aria-hidden="true"
                style={{
                  ...estiloPonto,
                  background: s.color ?? 'currentColor',
                }}
              />
              <span style={estiloTenue}>{s.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatar(s.value, precision)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Pecas
// ═════════════════════════════════════════════════════════════════════════════

interface CampoProps {
  readonly curto: string;
  readonly longo: string;
  readonly valor: number | null;
  readonly precision: number;
  readonly color?: string;
}

function Campo({ curto, longo, valor, precision, color }: CampoProps): JSX.Element {
  return (
    <span className="robustus-legend__field" style={estiloCampo}>
      <span aria-hidden="true" style={estiloTenue}>
        {curto}
      </span>
      <span
        aria-label={longo}
        style={{
          fontVariantNumeric: 'tabular-nums',
          ...(color === undefined ? {} : { color }),
        }}
      >
        {formatar(valor, precision)}
      </span>
    </span>
  );
}

interface VariacaoProps {
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly precision: number;
}

/**
 * A variacao intrabar, com sinal explicito.
 *
 * ⚠️ O sinal `+`/`−` vai junto com a cor, e nao no lugar dela: ~8% dos homens tem
 * alguma deficiencia de visao de cor, e verde/vermelho e justamente o par que eles
 * nao distinguem. Cor sem sinal seria informacao inacessivel; sinal sem cor seria
 * lento de ler. Os dois juntos servem os dois casos.
 */
function Variacao({ change, changePercent, precision }: VariacaoProps): JSX.Element | null {
  if (change === null) return null;

  const cor = corDoSinal(change);
  const sinal = change > 0 ? '+' : change < 0 ? '−' : '';
  const classe =
    change > 0
      ? 'robustus-legend__change robustus-legend__change--up'
      : change < 0
        ? 'robustus-legend__change robustus-legend__change--down'
        : 'robustus-legend__change robustus-legend__change--flat';

  return (
    <span
      className={classe}
      style={{ ...estiloCampo, ...(cor === undefined ? {} : { color: cor }) }}
      aria-label="Variação"
    >
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {sinal}
        {formatar(Math.abs(change), precision)}
      </span>
      {changePercent !== null && (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          ({sinal}
          {formatar(Math.abs(changePercent), 2)}%)
        </span>
      )}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Formatacao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Numero para texto.
 *
 * ⚠️ `null` **e** nao-finito viram travessao, nunca `0` nem `'NaN'`. `null`
 * significa "nao sei" — um indicador em aquecimento nao tem valor, e imprimir
 * zero ali poria o operador a ler um dado que nao existe. `toFixed(NaN)` devolve
 * a string `'NaN'`, que na tela parece defeito da biblioteca.
 */
function formatar(valor: number | null, precision: number): string {
  if (valor === null || !Number.isFinite(valor)) return SEM_VALOR;
  // `toFixed` aceita 0..100; um `precision` fora disso lancaria `RangeError`
  // dentro da renderizacao, o que derrubaria a arvore. Grampeado em vez de
  // validado: legenda nao lanca.
  const casas = Number.isFinite(precision) ? Math.min(Math.max(Math.trunc(precision), 0), 20) : 2;
  return valor.toFixed(casas);
}

/** A cor do sinal, ou `undefined` quando nao ha variacao (herda a cor do texto). */
function corDoSinal(change: number | null): string | undefined {
  if (change === null || change === 0) return undefined;
  return change > 0 ? COR_ALTA : COR_BAIXA;
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe `robustus-legend*`
// ═════════════════════════════════════════════════════════════════════════════

const estiloContainer: CSSProperties = {
  // ⭐ A linha que impede o defeito descrito no cabecalho. Nao remover.
  pointerEvents: 'none',
  position: 'absolute',
  top: 8,
  left: 10,
  zIndex: 3,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  // Sem fundo opaco: a legenda flutua sobre as velas e um retangulo cheio
  // esconderia preco. O contraste vem do `textShadow`, que custa nada e nao
  // ocupa area. (A caixa opaca do bookmap e outro caso: la o texto fica sobre
  // celula de calor clara, onde sombra nao basta.)
  textShadow: '0 1px 2px rgba(2,6,23,0.85)',
  fontFamily: 'inherit',
  fontSize: 11,
  lineHeight: 1.35,
  color: 'inherit',
  // `max-content` para a legenda nao esticar sobre o grafico inteiro — mesmo com
  // `pointerEvents: none`, uma caixa larga atrapalharia a depuracao no inspetor.
  width: 'max-content',
  maxWidth: 'calc(100% - 20px)',
};

const estiloIdentidade: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const estiloEtiqueta: CSSProperties = {
  fontSize: 9,
  padding: '0 4px',
  borderRadius: 3,
  border: '1px solid rgba(148,163,184,0.35)',
  opacity: 0.85,
};

const estiloLinha: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };

const estiloCampo: CSSProperties = { display: 'inline-flex', alignItems: 'baseline', gap: 3 };

const estiloTenue: CSSProperties = { opacity: 0.6 };

const estiloSeries: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };

const estiloSerie: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };

/**
 * As notas das camadas: uma linha por item, empilhadas.
 *
 * ⚠️ `flexDirection: column` e NÃO `wrap` horizontal: cada linha de camada é uma frase
 * ("Livro · fila em repouso", "Verde: fila de compra · Vermelho: fila de venda"), não um
 * campo curto como `Abr`/`Máx`. Enfileirá-las na horizontal produziria uma parede de
 * texto sem separação visível entre as frases.
 */
const estiloNotas: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  marginTop: 1,
};

const estiloNota: CSSProperties = {
  fontSize: 10,
  opacity: 0.72,
  whiteSpace: 'nowrap',
  // ⚠️ `nowrap` com `overflow: hidden` e reticências: a frase da camada pode ser longa
  // (o aviso do footprint tem duas orações), e deixá-la quebrar em três linhas empurraria
  // o resto da trilha para baixo do gráfico. Cortar é melhor que empurrar — e o `title`
  // devolve o texto inteiro no repouso do cursor.
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '46ch',
};

/** Ressalva (âmbar): o mesmo vocabulário de cor que as camadas usam no canvas. */
const estiloNotaAlerta: CSSProperties = {
  ...estiloNota,
  color: '#fbbf24',
  opacity: 0.95,
};

const estiloPonto: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 2,
  display: 'inline-block',
  flexShrink: 0,
};
