/**
 * TimeframeSelector — a escolha de PERÍODO da barra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FALTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O relato foi direto: *"gráfico está sem seleção de TF"*. A biblioteca já sabia pedir
 * barras por `periodSeconds` e reamostrar com `rollupBars`, mas não havia como o operador
 * DIZER qual período quer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ RÁPIDOS COMO BOTÃO, O RESTO NUM MENU — "não encher a tela de botões"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nove períodos como nove botões seriam nove botões, e o pedido explícito do usuário foi
 * o oposto disso. A repartição segue o mesmo critério do resto desta interface: **o que
 * se usa a toda hora fica visível; o resto fica a um clique**.
 *
 * Os `quick` (default M1/M5/M15/H1/D1) viram um grupo de escolha única; os demais entram
 * num `<select>` compacto ao lado. Escolher pelo menu NÃO promove o período a botão — a
 * barra tem de ter posição estável, senão o operador perde a memória motora do lugar de
 * cada coisa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A LISTA É INJETADA, COMO O REGISTRY DE INDICADORES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `timeframes` vem por prop, e o tipo é declarado ESTRUTURALMENTE aqui. Este pacote não
 * importa `@robustus/charts-datafeed` — o vocabulário canônico (`TIMEFRAMES`) vive lá,
 * junto de `periodSeconds` e da agregação, e é o consumidor quem os une. É a mesma
 * decisão de `useIndicatorCatalog` com o registry, pelo mesmo motivo: a interface não
 * pode arrastar a camada de dado para dentro de quem só quer desenhar.
 *
 * ⚠️ E é por isso que NÃO há lista default aqui. Uma lista local seria uma segunda
 * verdade — exatamente a duplicação que a lista de preço-fonte custou a esta biblioteca
 * (ver `ParamSpec.options`).
 */
import { useId, useMemo, type CSSProperties } from 'react';
import { SegmentedControl, joinClasses, useChromeStyles } from './SegmentedControl.js';

/**
 * Um período, como este componente o enxerga. Espelha `Timeframe` do datafeed.
 *
 * ⭐ Só o que a interface precisa: identidade estável, rótulo curto para o botão, rótulo
 * longo para leitor de tela. `seconds` entra porque é o que o consumidor manda para o
 * datafeed — o componente não o interpreta, só o devolve.
 */
export interface TimeframeOption {
  readonly id: string;
  readonly seconds: number;
  readonly label: string;
  readonly labelLongo: string;
}

export interface TimeframeSelectorProps {
  /**
   * Os períodos oferecidos, na ordem em que aparecem. INJETADOS — ver o cabeçalho.
   *
   * Tipicamente `TIMEFRAMES` de `@robustus/charts-datafeed`, ou
   * `timeframesAgregaveisDe(base)` quando o dado em mãos não permite todos: oferecer M1
   * com dado de M5 e mostrar tela vazia é pior que não oferecer.
   */
  readonly timeframes: readonly TimeframeOption[];
  /** O `id` do período corrente. */
  readonly value: string;
  readonly onChange: (tf: TimeframeOption) => void;
  /**
   * Quais `id` ficam como BOTÃO. Ausente = M1/M5/M15/H1/D1, filtrados pelos que existem
   * em `timeframes`.
   *
   * ⚠️ O default é uma escolha de mesa (intradiário de índice e dólar), não uma
   * imposição: quem opera semanal passa `['H4','D1','W1']` e o resto vai para o menu.
   */
  readonly quick?: readonly string[];
  /** `'sm'` cabe em barra densa; `'md'` é o default. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Os rápidos default — ver `quick`. */
const QUICK_DEFAULT: readonly string[] = ['M1', 'M5', 'M15', 'H1', 'D1'];

const estiloLinha: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const estiloSelect: CSSProperties = {
  fontSize: 11,
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
};

/**
 * Seletor de período.
 *
 * @example
 * import { TIMEFRAMES } from '@robustus/charts-datafeed';
 *
 * <TimeframeSelector
 *   timeframes={TIMEFRAMES}
 *   value={tf.id}
 *   onChange={(novo) => carregar(novo.seconds)}
 * />
 */
export function TimeframeSelector({
  timeframes,
  value,
  onChange,
  quick = QUICK_DEFAULT,
  size = 'sm',
  className,
  style,
}: TimeframeSelectorProps): JSX.Element {
  useChromeStyles();
  const idSelect = useId();

  const porId = useMemo(() => {
    const m = new Map<string, TimeframeOption>();
    for (const tf of timeframes) m.set(tf.id, tf);
    return m;
  }, [timeframes]);

  // Os rápidos, na ordem de `quick`, mas só os que existem de verdade.
  const rapidos = useMemo(
    () => quick.map((id) => porId.get(id)).filter((tf): tf is TimeframeOption => tf !== undefined),
    [quick, porId],
  );

  const rapidosIds = useMemo(() => new Set(rapidos.map((tf) => tf.id)), [rapidos]);

  const noMenu = useMemo(() => timeframes.filter((tf) => !rapidosIds.has(tf.id)), [
    timeframes,
    rapidosIds,
  ]);

  /**
   * ⚠️ O período corrente pode NÃO estar entre os rápidos (o operador escolheu H4 no
   * menu). Aí o grupo de botões fica sem seleção — e é a resposta certa: o botão de H1 não
   * pode parecer ativo quando o gráfico está em H4. Quem mostra o período corrente nesse
   * caso é o `<select>`, que fica com ele selecionado.
   */
  const valorDoGrupo = rapidosIds.has(value) ? value : '';

  const opcoes = useMemo(
    () =>
      rapidos.map((tf) => ({
        value: tf.id,
        label: tf.label,
        hint: `Período de ${tf.labelLongo}.`,
      })),
    [rapidos],
  );

  return (
    <div
      className={joinClasses('robustus-tf', className)}
      style={{ ...estiloLinha, ...style }}
    >
      {opcoes.length > 0 && (
        <SegmentedControl
          ariaLabel="Período do gráfico"
          options={opcoes}
          value={valorDoGrupo}
          onChange={(id) => {
            const tf = porId.get(id);
            if (tf !== undefined) onChange(tf);
          }}
          size={size}
        />
      )}

      {noMenu.length > 0 && (
        <>
          {/*
            ⚠️ O rótulo é visualmente escondido, não ausente: um `<select>` sem nome
            acessível é anunciado como "caixa de combinação" e nada mais. `title` não
            substitui `<label>` — leitor de tela pode ignorá-lo.
          */}
          <label htmlFor={idSelect} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
            Outros períodos
          </label>
          <select
            id={idSelect}
            value={rapidosIds.has(value) ? '' : value}
            onChange={(e) => {
              const tf = porId.get(e.target.value);
              if (tf !== undefined) onChange(tf);
            }}
            style={estiloSelect}
          >
            {/*
              A opção neutra existe para o `<select>` poder ficar SEM seleção quando o
              período corrente é um dos botões. Sem ela o menu mostraria um período que
              não é o do gráfico — mentira silenciosa.
            */}
            <option value="">…</option>
            {noMenu.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
