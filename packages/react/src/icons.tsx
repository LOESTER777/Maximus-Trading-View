/**
 * icons — o conjunto de icones da biblioteca. SVG PROPRIO, zero terceiros.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ICONE PROPRIO, E NAO UMA BIBLIOTECA DE ICONE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A regra do projeto e dura: nada de terceiros. Isso vale para icone tambem —
 * `lucide`, `heroicons` e `react-icons` sao dependencia de runtime, arrastam
 * milhares de glifos para o pacote de quem usa cinco, e amarram a aparencia a
 * decisao de outro projeto.
 *
 * Aqui cada icone e uma funcao que devolve os `path`/`line` de um `<svg>` de
 * 24x24. Custo em runtime: zero alem do proprio JSX. E o consumidor pode
 * substituir qualquer um — `Icon` aceita `render` proprio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ TRES DECISOES QUE FAZEM O ICONE SER LEGIVEL A 16 px
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. `stroke="currentColor"`, nunca cor fixa.** O icone herda a cor do texto do
 * botao, entao estado (ativo, desabilitado, hover) e tema (claro/escuro) sao
 * resolvidos por CSS no elemento pai. Cor cravada no `path` exigiria um icone por
 * estado.
 *
 * **2. Traco de 1,75 e `viewBox` de 24, com o desenho ocupando 18.** A margem de
 * 3 px em volta impede o traco de encostar na borda quando o icone e escalado
 * para 16 px — encostado, o antialias come meio pixel e o glifo parece cortado.
 *
 * **3. Geometria MINIMA, e semantica antes de bonita.** Um icone de 16 px nao
 * comporta detalhe: a vela e tres tracos, o Fibonacci sao quatro linhas
 * horizontais desiguais. O que importa e o operador reconhecer a FERRAMENTA de
 * relance — por isso cada icone imita a FORMA que a ferramenta desenha, nao uma
 * metafora abstrata.
 *
 * ⚠️ **Icone nunca vai sozinho.** Todo icone e `aria-hidden`; o significado vem do
 * `aria-label`/`title` do botao que o contem. Icone sem rotulo textual acessivel e
 * botao mudo para leitor de tela — e, na pratica, tambem para quem nunca viu o
 * simbolo antes (ver `Tooltip`, que resolve o "o que e e para que").
 */
import type { CSSProperties, ReactNode } from 'react';

// ═════════════════════════════════════════════════════════════════════════════
// O nome de cada icone — a chave que as barras usam
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Nomes disponiveis.
 *
 * Agrupados por FAMILIA na ordem em que aparecem na interface, e nao em ordem
 * alfabetica: quem for acrescentar um icone acha o vizinho semantico dele.
 */
export type IconName =
  // ── Ferramentas de desenho (a barra vertical) ──
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'extendedLine'
  | 'horizontalLine'
  | 'verticalLine'
  | 'rectangle'
  | 'fibonacci'
  | 'measure'
  | 'magnet'
  | 'undo'
  | 'redo'
  | 'trash'
  // ── Tipos de grafico (a barra horizontal) ──
  | 'candles'
  | 'bars'
  | 'line'
  | 'area'
  | 'heikinAshi'
  | 'renko'
  // ── Analise ──
  | 'indicator'
  | 'oscillator'
  | 'alert'
  | 'replay'
  | 'bookmap'
  // ── Replay ──
  | 'play'
  | 'pause'
  | 'stepForward'
  | 'stepBack'
  // ── Ambiente e acoes ──
  | 'grid'
  | 'watermark'
  | 'camera'
  | 'save'
  | 'restore'
  | 'settings'
  | 'search'
  | 'command'
  | 'eye'
  | 'eyeOff'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'plus'
  | 'close'
  | 'layers'
  | 'crosshair'
  | 'help';

// ═════════════════════════════════════════════════════════════════════════════
// A geometria
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O desenho de cada icone: os filhos do `<svg>`.
 *
 * ⚠️ Coordenadas no `viewBox` 0..24, desenho dentro de 3..21. Ver a decisao 2 no
 * cabecalho — a margem existe para o traco nao ser comido pelo antialias a 16 px.
 */
const GEOMETRIA: Readonly<Record<IconName, ReactNode>> = {
  // ── Desenho: cada icone imita a FORMA que a ferramenta produz ─────────────
  cursor: <path d="M5 3l6 16 2.5-5.5L19 11z" />,
  // Segmento com as duas alcas visiveis — e o que distingue "linha de tendencia"
  // de "linha" solta: ela tem ponta que se arrasta.
  trendline: (
    <>
      <line x1="5" y1="18" x2="19" y2="7" />
      <circle cx="5" cy="18" r="1.9" />
      <circle cx="19" cy="7" r="1.9" />
    </>
  ),
  // Raio: uma alca, e a ponta que segue sem fim (seta).
  ray: (
    <>
      <line x1="5" y1="18" x2="19" y2="7" />
      <circle cx="5" cy="18" r="1.9" />
      <path d="M15.5 6.2L19.3 6.6L18.8 10.4" />
    </>
  ),
  // Reta estendida: sem alca nas pontas, transborda os dois lados.
  extendedLine: (
    <>
      <line x1="3" y1="19" x2="21" y2="5" />
      <circle cx="9" cy="14.3" r="1.7" />
      <circle cx="15" cy="9.7" r="1.7" />
    </>
  ),
  horizontalLine: (
    <>
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="1.9" />
    </>
  ),
  verticalLine: (
    <>
      <line x1="12" y1="3" x2="12" y2="21" />
      <circle cx="12" cy="12" r="1.9" />
    </>
  ),
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  // Fibonacci: niveis desiguais, como os 0.236/0.382/0.618 que ele traca.
  fibonacci: (
    <>
      <line x1="4" y1="5" x2="20" y2="5" />
      <line x1="4" y1="9.5" x2="20" y2="9.5" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </>
  ),
  // Regua: segmento com marcas de medida.
  measure: (
    <>
      <line x1="4" y1="20" x2="20" y2="4" />
      <line x1="7.5" y1="14.5" x2="10" y2="17" />
      <line x1="11.5" y1="10.5" x2="14" y2="13" />
      <line x1="15.5" y1="6.5" x2="18" y2="9" />
    </>
  ),
  magnet: (
    <>
      <path d="M7 4v8a5 5 0 0010 0V4" />
      <line x1="4" y1="4" x2="10" y2="4" />
      <line x1="14" y1="4" x2="20" y2="4" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h11a5 5 0 010 10H8" />
      <path d="M8 4L4 9l4 5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9H9a5 5 0 000 10h7" />
      <path d="M16 4l4 5-4 5" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M6.5 7l1 13h9l1-13" />
    </>
  ),

  // ── Tipos de grafico: o icone e a propria rasterizacao, em miniatura ──────
  candles: (
    <>
      <line x1="8" y1="4" x2="8" y2="20" />
      <rect x="5.5" y="8" width="5" height="7" rx="0.5" />
      <line x1="16" y1="6" x2="16" y2="19" />
      <rect x="13.5" y="10" width="5" height="6" rx="0.5" />
    </>
  ),
  bars: (
    <>
      <line x1="8" y1="5" x2="8" y2="19" />
      <line x1="5" y1="9" x2="8" y2="9" />
      <line x1="8" y1="15" x2="11" y2="15" />
      <line x1="16" y1="7" x2="16" y2="18" />
      <line x1="13" y1="12" x2="16" y2="12" />
      <line x1="16" y1="16" x2="19" y2="16" />
    </>
  ),
  line: <path d="M4 17l5-6 4 3 7-8" />,
  area: (
    <>
      <path d="M4 17l5-6 4 3 7-8" />
      <path d="M4 17l5-6 4 3 7-8V20H4z" fill="currentColor" fillOpacity="0.18" stroke="none" />
    </>
  ),
  // Heikin-Ashi: velas de corpo cheio e encostadas, a leitura "suavizada".
  heikinAshi: (
    <>
      <rect x="4.5" y="12" width="4" height="6" rx="0.5" fill="currentColor" fillOpacity="0.25" />
      <rect x="10" y="8" width="4" height="8" rx="0.5" fill="currentColor" fillOpacity="0.25" />
      <rect x="15.5" y="5" width="4" height="7" rx="0.5" fill="currentColor" fillOpacity="0.25" />
    </>
  ),
  // Renko: tijolos em escada, sem eixo de tempo regular.
  renko: (
    <>
      <rect x="4" y="14" width="5" height="5" rx="0.5" />
      <rect x="9.5" y="9" width="5" height="5" rx="0.5" />
      <rect x="15" y="4" width="5" height="5" rx="0.5" />
    </>
  ),

  // ── Analise ───────────────────────────────────────────────────────────────
  // Indicador sobre o preco: uma curva media atravessando.
  indicator: (
    <>
      <path d="M3 16c3 0 4-8 7-8s4 8 7 8 3-4 4-4" />
      <circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Oscilador: onda entre dois limites — a leitura 0..100 de sub-painel.
  oscillator: (
    <>
      <line x1="3" y1="7" x2="21" y2="7" strokeDasharray="2 2" strokeOpacity="0.5" />
      <line x1="3" y1="17" x2="21" y2="17" strokeDasharray="2 2" strokeOpacity="0.5" />
      <path d="M3 14c2.5 0 3-8 6-8s3.5 12 6 12 3-6 6-6" />
    </>
  ),
  alert: (
    <>
      <path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10.5 19a1.8 1.8 0 003 0" />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 108-8" />
      <path d="M4 4v5h5" />
      <path d="M11 10l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  // Bookmap: malha de calor por regiao de preco.
  bookmap: (
    <>
      <rect x="4" y="5" width="4" height="4" fillOpacity="0.5" fill="currentColor" stroke="none" />
      <rect x="9" y="5" width="4" height="4" fillOpacity="0.2" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="4" fillOpacity="0.75" fill="currentColor" stroke="none" />
      <rect x="4" y="10.5" width="4" height="4" fillOpacity="0.2" fill="currentColor" stroke="none" />
      <rect x="9" y="10.5" width="4" height="4" fillOpacity="0.85" fill="currentColor" stroke="none" />
      <rect x="14" y="10.5" width="4" height="4" fillOpacity="0.35" fill="currentColor" stroke="none" />
      <rect x="4" y="16" width="4" height="4" fillOpacity="0.6" fill="currentColor" stroke="none" />
      <rect x="9" y="16" width="4" height="4" fillOpacity="0.3" fill="currentColor" stroke="none" />
      <rect x="14" y="16" width="4" height="4" fillOpacity="0.15" fill="currentColor" stroke="none" />
    </>
  ),

  // ── Replay ────────────────────────────────────────────────────────────────
  play: <path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stepForward: (
    <>
      <path d="M6 5.5l9 6.5-9 6.5z" fill="currentColor" stroke="none" />
      <line x1="18" y1="5" x2="18" y2="19" />
    </>
  ),
  stepBack: (
    <>
      <path d="M18 5.5l-9 6.5 9 6.5z" fill="currentColor" stroke="none" />
      <line x1="6" y1="5" x2="6" y2="19" />
    </>
  ),

  // ── Ambiente e acoes ──────────────────────────────────────────────────────
  grid: (
    <>
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </>
  ),
  watermark: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" strokeOpacity="0.55" />
      <path d="M8 14l2.5-4 2 3 1.5-2 2 3" strokeOpacity="0.9" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  save: (
    <>
      <path d="M5 5h11l3 3v11H5z" />
      <path d="M9 5v5h6V5" />
      <rect x="9" y="14" width="6" height="5" />
    </>
  ),
  restore: (
    <>
      <path d="M20 12a8 8 0 11-8-8" />
      <path d="M20 4v5h-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.2M17.6 15.3l2.2 1.2M4.2 16.5l2.2-1.2M17.6 8.7l2.2-1.2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15" y1="15" x2="20" y2="20" />
    </>
  ),
  // Tecla de comando: o simbolo, para anunciar o atalho.
  command: (
    <path d="M9 6a2 2 0 10-2 2h10a2 2 0 10-2-2v12a2 2 0 102-2H7a2 2 0 10 2 2z" />
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 6l16 12" />
      <path d="M9.5 7.1A9.7 9.7 0 0112 6.5c6 0 9.5 5.5 9.5 5.5a17 17 0 01-2.6 3.1" />
      <path d="M6.3 8.6A16.6 16.6 0 002.5 12S6 17.5 12 17.5a9.4 9.4 0 002.7-.4" />
    </>
  ),
  chevronLeft: <path d="M14.5 5l-7 7 7 7" />,
  chevronRight: <path d="M9.5 5l7 7-7 7" />,
  chevronDown: <path d="M5 9.5l7 7 7-7" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8 4.2-8 4.2-8-4.2z" />
      <path d="M4 13.2l8 4.2 8-4.2" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2.5" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="21.5" y2="12" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 114.4 1.6c-.8.9-2 1.2-2 2.5" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

export interface IconProps {
  readonly name: IconName;
  /** Aresta do quadrado, em px. Default 16 — o tamanho de barra de ferramenta. */
  readonly size?: number;
  /** Espessura do traco. Default 1.75 (ver decisao 2 no cabecalho). */
  readonly strokeWidth?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * Substitui a geometria embutida.
   *
   * Existe para o consumidor trocar um icone sem forkar o pacote: passa os filhos
   * de um `<svg viewBox="0 0 24 24">` e o resto (tamanho, cor herdada,
   * `aria-hidden`) continua valendo.
   */
  readonly render?: ReactNode;
}

/**
 * Um icone.
 *
 * ⚠️ **Sempre `aria-hidden`.** O significado vem do botao que o contem — icone
 * anunciado por leitor de tela viraria ruido ("imagem, imagem, imagem") e ainda
 * competiria com o `aria-label` do botao. Ver o cabecalho.
 *
 * @example
 * <button aria-label="Linha de tendência"><Icon name="trendline" /></button>
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  style,
  render,
}: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {render ?? GEOMETRIA[name]}
    </svg>
  );
}

/** Os nomes disponiveis, para montar galeria ou validar configuracao. */
export const ICON_NAMES = Object.keys(GEOMETRIA) as readonly IconName[];
