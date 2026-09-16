/**
 * Playground — junta motor, camadas de fluxo, desenho, indicadores, tipos de
 * grafico, replay de mercado e alertas de preco num app so.
 *
 * E a superficie para VER a biblioteca funcionando local, sem backend. Nao faz
 * parte da biblioteca: e consumidor dela, e serve de exemplo de montagem.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO OS RECURSOS SE COMPOEM (a ordem importa)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O dado flui por uma cadeia curta, e cada elo tem uma responsabilidade:
 *
 *   pregao sintetico
 *     -> REPLAY decide QUANTAS velas estao reveladas (a fatia visivel)
 *       -> TRANSFORMACAO decide a FORMA (Vela/Heikin-Ashi/Renko)
 *         -> motor plota, com o SeriesType certo (Candlestick/Line/Area/Bar)
 *
 * Alertas e indicadores consomem a MESMA fatia revelada, para o que se ve na
 * tela ser exatamente o que dispara alerta e alimenta indicador — sem isso, um
 * alerta dispararia sobre uma vela que o replay ainda nao mostrou.
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { decodeColumnar } from '@robustus/charts-core';
import { heikinAshi, renko, brickSizeAutomatico } from '@robustus/chart-core';
import {
  useChartEngine,
  useDrawings,
  useIndicators,
  useAlerts,
  useReplay,
} from '@robustus/charts-react';
import type { ActiveTool, SnapBar } from '@robustus/charts-drawings';
import type { IndicatorPlot, PriceSeriesType } from '@robustus/charts-engine';
import { emaFactory, bollingerFactory, rsiFactory, macdFactory } from '@robustus/charts-indicators';
import type { AlertSpec } from '@robustus/charts-react';
import { makeSyntheticBundle } from './synthetic.js';

const FERRAMENTAS: ReadonlyArray<{ id: ActiveTool; rotulo: string }> = [
  { id: null, rotulo: 'Selecionar' },
  { id: 'TRENDLINE', rotulo: 'Linha' },
  { id: 'RAY', rotulo: 'Raio' },
  { id: 'EXTENDED_LINE', rotulo: 'Reta' },
  { id: 'HORIZONTAL_LINE', rotulo: 'Horizontal' },
  { id: 'VERTICAL_LINE', rotulo: 'Vertical' },
  { id: 'RECTANGLE', rotulo: 'Retângulo' },
  { id: 'FIB_RETRACEMENT', rotulo: 'Fibonacci' },
  { id: 'MEASURE', rotulo: 'Régua' },
];

/**
 * Os modos de grafico oferecidos. Alguns sao TRANSFORMACAO de dado (Heikin-Ashi,
 * Renko — plotam como Candlestick), outros sao SeriesType do motor (Linha, Area,
 * Barras). O `tipoSerie` diz ao motor como desenhar; o `transformar` diz como
 * derivar as velas antes.
 */
type ModoGrafico = 'VELA' | 'HEIKIN' | 'RENKO' | 'LINHA' | 'AREA' | 'BARRAS';

const MODOS: ReadonlyArray<{ id: ModoGrafico; rotulo: string; serie: PriceSeriesType }> = [
  { id: 'VELA', rotulo: 'Velas', serie: 'Candlestick' },
  { id: 'HEIKIN', rotulo: 'Heikin-Ashi', serie: 'Candlestick' },
  { id: 'RENKO', rotulo: 'Renko', serie: 'Candlestick' },
  { id: 'BARRAS', rotulo: 'Barras', serie: 'Bar' },
  { id: 'LINHA', rotulo: 'Linha', serie: 'Line' },
  { id: 'AREA', rotulo: 'Área', serie: 'Area' },
];

/** Velocidades de replay oferecidas, em barras/segundo. */
const VELOCIDADES = [1, 2, 4, 8, 16] as const;

function App(): JSX.Element {
  // Pregao sintetico deterministico, gerado uma vez.
  const bundle = useMemo(() => makeSyntheticBundle(240, 300, 42), []);
  const grid = useMemo(() => decodeColumnar(bundle.depth), [bundle]);

  const [mostrarBookmap, setMostrarBookmap] = useState(true);
  const [imaLigado, setImaLigado] = useState(false);
  const [tick, setTick] = useState(0);

  const [modo, setModo] = useState<ModoGrafico>('VELA');
  const [modoReplay, setModoReplay] = useState(false);

  // Indicadores ligados/desligados por toggle.
  const [emaOn, setEmaOn] = useState(true);
  const [bbOn, setBbOn] = useState(false);
  const [rsiOn, setRsiOn] = useState(true);
  const [macdOn, setMacdOn] = useState(false);

  // ── REPLAY ──────────────────────────────────────────────────────────────
  //
  // Reproduz o pregao barra a barra. Quando o replay esta LIGADO, as velas
  // exibidas sao a fatia revelada; quando desligado, sao todas.
  const replay = useReplay({ bars: bundle.candles, speed: 4 });

  // A fatia base de velas: revelada pelo replay quando ligado, senao o pregao
  // inteiro. Tudo daqui pra frente parte desta fatia.
  const velasBase = modoReplay ? replay.revealedBars : bundle.candles;

  // ── TRANSFORMACAO DE FORMA ────────────────────────────────────────────────
  //
  // Aplica Heikin-Ashi/Renko sobre a fatia base. Vela/Linha/Area/Barras usam a
  // fatia como esta. O `brickSizeAutomatico` deriva o tijolo do proprio dado, e
  // e recalculado quando a fatia muda de tamanho — no replay, isso mantem o
  // Renko coerente conforme o dia se revela.
  const velasExibidas = useMemo(() => {
    if (modo === 'HEIKIN') return heikinAshi(velasBase);
    if (modo === 'RENKO') {
      const brick = brickSizeAutomatico(velasBase);
      // `brickSizeAutomatico` devolve `null` quando nao ha dado suficiente para
      // derivar um tijolo — nesse caso o Renko degrada para as velas cruas, em
      // vez de quebrar. `null` significa "nao sei", nunca zero.
      return brick === null ? velasBase : renko(velasBase, brick);
    }
    return velasBase;
  }, [modo, velasBase]);

  const serieAtual = useMemo(() => MODOS.find((m) => m.id === modo)?.serie ?? 'Candlestick', [modo]);

  // Barras para o ima, no formato que o pacote de desenho espera. Segue a fatia
  // exibida para o ima grudar no que esta na tela.
  const barsSnap = useMemo<SnapBar[]>(
    () =>
      velasExibidas.map((c) => ({
        timeSec: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [velasExibidas],
  );
  const barsRef = useRef<SnapBar[]>(barsSnap);
  barsRef.current = barsSnap;

  const { containerRef, engine } = useChartEngine({
    options: { withVolume: true },
    candles: velasExibidas,
    volume: modoReplay ? bundle.volume.slice(0, velasExibidas.length) : bundle.volume,
    bookmap:
      mostrarBookmap && grid !== null
        ? { grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: bundle.tickSize, modoCor: 'TERMICA' }
        : null,
  });

  // ── TROCA DE TIPO DE SERIE NO MOTOR ───────────────────────────────────────
  //
  // Heikin-Ashi/Renko plotam como Candlestick (a forma vem da transformacao dos
  // dados); Linha/Area/Barras trocam o SeriesType do motor. `setPriceSeriesType`
  // preserva a viewport — nao e um salto de camera, e a mesma janela desenhada
  // de outro jeito.
  useEffect(() => {
    if (engine === null) return;
    engine.setPriceSeriesType(serieAtual);
  }, [engine, serieAtual]);

  const desenho = useDrawings({
    engine,
    bars: () => barsRef.current,
    snapEnabled: () => imaLigado,
    onChange: () => setTick((n) => n + 1),
  });

  // ── INDICADORES ───────────────────────────────────────────────────────────
  const plots: IndicatorPlot[] = useMemo(() => {
    const lista: IndicatorPlot[] = [];
    if (emaOn) lista.push({ id: 'ema20', instance: emaFactory.create({ period: 20 }), colors: { value: '#e9c46a' } });
    if (bbOn) lista.push({ id: 'bb', instance: bollingerFactory.create({ period: 20, mult: 2 }) });
    if (rsiOn) lista.push({ id: 'rsi', instance: rsiFactory.create({ period: 14 }) });
    if (macdOn) lista.push({ id: 'macd', instance: macdFactory.create() });
    return lista;
  }, [emaOn, bbOn, rsiOn, macdOn]);

  // Indicadores seguem a fatia EXIBIDA, para o que se calcula ser o que se ve.
  useIndicators({ engine, plots, bars: velasExibidas });

  // ── ALERTAS DE PRECO ──────────────────────────────────────────────────────
  //
  // Dois alertas de exemplo, derivados da faixa do pregao para sempre haver o
  // que disparar. Alimentados pela fatia revelada — no replay, um alerta so
  // dispara quando a vela que o satisfaz e revelada, como no mercado real.
  const [alertasLigados, setAlertasLigados] = useState(true);
  const niveis = useMemo(() => {
    const closes = bundle.candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // Um nivel de cruzamento para cima a 2/3 da faixa e um para baixo a 1/3.
    return {
      acima: min + (max - min) * 0.66,
      abaixo: min + (max - min) * 0.33,
    };
  }, [bundle]);

  const alertSpecs = useMemo<AlertSpec[]>(() => {
    if (!alertasLigados) return [];
    return [
      { key: 'cross-acima', condition: { kind: 'CROSS_ABOVE', level: niveis.acima }, options: { mode: 'recurring' } },
      { key: 'cross-abaixo', condition: { kind: 'CROSS_BELOW', level: niveis.abaixo }, options: { mode: 'recurring' } },
    ];
  }, [alertasLigados, niveis]);

  const alertas = useAlerts({
    bars: velasBase,
    alerts: alertSpecs,
  });

  // Linhas de preco marcando os niveis de alerta, para o operador ver onde eles
  // estao. Seguem os toggles.
  const linhasAlerta = useMemo(
    () =>
      alertasLigados
        ? [
            { price: niveis.acima, color: '#16c784', title: 'Alerta ↑', lineStyle: 2 as const },
            { price: niveis.abaixo, color: '#ea3943', title: 'Alerta ↓', lineStyle: 2 as const },
          ]
        : [],
    [alertasLigados, niveis],
  );

  void tick; // forca re-render quando a colecao de desenho muda

  const estado = replay.state;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid rgba(148,163,184,0.15)',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ color: '#e2e8f0', fontSize: 15 }}>Robustus Charts</strong>
        <span style={{ fontSize: 11, color: '#64748b' }}>playground · dado sintético</span>

        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {FERRAMENTAS.map((f) => {
            const ativa = desenho.tool === f.id;
            return (
              <button key={f.rotulo} type="button" onClick={() => desenho.setTool(f.id)} style={botao(ativa)}>
                {f.rotulo}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button type="button" onClick={desenho.undo} disabled={!desenho.canUndo} style={botao(false)}>
            Desfazer
          </button>
          <button type="button" onClick={desenho.redo} disabled={!desenho.canRedo} style={botao(false)}>
            Refazer
          </button>
          <button type="button" onClick={desenho.deleteSelected} style={botao(false)}>
            Apagar
          </button>
          <button type="button" onClick={() => setImaLigado((v) => !v)} style={botao(imaLigado)}>
            Ímã {imaLigado ? 'on' : 'off'}
          </button>
          <button type="button" onClick={() => setMostrarBookmap((v) => !v)} style={botao(mostrarBookmap)}>
            Bookmap {mostrarBookmap ? 'on' : 'off'}
          </button>
        </div>
      </header>

      {/* Tipo de grafico + indicadores */}
      <div style={barra()}>
        <span style={rotuloBarra()}>Gráfico:</span>
        {MODOS.map((m) => (
          <button key={m.id} type="button" onClick={() => setModo(m.id)} style={botao(modo === m.id)}>
            {m.rotulo}
          </button>
        ))}
        <span style={{ ...rotuloBarra(), marginLeft: 16 }}>Indicadores:</span>
        <button type="button" onClick={() => setEmaOn((v) => !v)} style={botao(emaOn)}>EMA 20</button>
        <button type="button" onClick={() => setBbOn((v) => !v)} style={botao(bbOn)}>Bollinger</button>
        <button type="button" onClick={() => setRsiOn((v) => !v)} style={botao(rsiOn)}>RSI</button>
        <button type="button" onClick={() => setMacdOn((v) => !v)} style={botao(macdOn)}>MACD</button>
      </div>

      {/* Controles de replay */}
      <div style={barra()}>
        <button type="button" onClick={() => setModoReplay((v) => !v)} style={botao(modoReplay)}>
          Replay {modoReplay ? 'on' : 'off'}
        </button>
        <button type="button" onClick={replay.toggle} disabled={!modoReplay} style={botao(estado.playing)}>
          {estado.playing ? '⏸ Pausar' : '▶ Play'}
        </button>
        <button type="button" onClick={() => replay.step(-1)} disabled={!modoReplay} style={botao(false)}>
          ◀ Passo
        </button>
        <button type="button" onClick={() => replay.step(1)} disabled={!modoReplay} style={botao(false)}>
          Passo ▶
        </button>
        <input
          type="range"
          min={0}
          max={estado.length}
          value={estado.position}
          disabled={!modoReplay}
          onChange={(e) => replay.seek(Number(e.target.value))}
          style={{ flex: 1, minWidth: 120, accentColor: '#38bdf8' }}
        />
        <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 78, textAlign: 'right' }}>
          {estado.position} / {estado.length}
        </span>
        <span style={rotuloBarra()}>Vel:</span>
        {VELOCIDADES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => replay.setSpeed(v)}
            disabled={!modoReplay}
            style={botao(estado.speed === v)}
          >
            {v}×
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Painel de alertas */}
        <aside
          style={{
            width: 240,
            borderLeft: '1px solid rgba(148,163,184,0.15)',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ color: '#e2e8f0', fontSize: 13 }}>Alertas</strong>
            <button
              type="button"
              onClick={() => setAlertasLigados((v) => !v)}
              style={{ ...botao(alertasLigados), marginLeft: 'auto' }}
            >
              {alertasLigados ? 'on' : 'off'}
            </button>
          </div>

          {alertas.alerts.map(([key, alert]) => (
            <div key={key} style={cartaoAlerta(alert.state === 'TRIGGERED')}>
              <div style={{ fontSize: 11, color: '#cbd5e1' }}>{rotuloCondicao(key)}</div>
              <div style={{ fontSize: 10, color: alert.state === 'TRIGGERED' ? '#fbbf24' : '#64748b' }}>
                {alert.state === 'TRIGGERED' ? 'disparado' : 'armado'} · {alert.mode}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Disparos: {alertas.fired.length}</span>
            <button type="button" onClick={alertas.clearFired} style={{ ...botao(false), marginLeft: 'auto' }}>
              Limpar
            </button>
            <button type="button" onClick={alertas.rearmAll} style={botao(false)}>
              Re-armar
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
            {alertas.fired.slice(-8).reverse().map((e, i) => (
              <div key={`${e.key}-${e.sample?.time}-${i}`} style={{ fontSize: 10, color: '#94a3b8' }}>
                {rotuloCondicao(e.key)} @ {e.sample?.value.toFixed(1)}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <footer style={{ padding: '6px 16px', fontSize: 11, color: '#64748b', borderTop: '1px solid rgba(148,163,184,0.15)' }}>
        {desenho.drawings.length} desenho(s) · {desenho.selectedIds.length} selecionado(s) ·
        {' '}gesto: {desenho.interaction.kind} ·
        {' '}modo: {MODOS.find((m) => m.id === modo)?.rotulo} ·
        {' '}{modoReplay ? `replay ${estado.position}/${estado.length}` : 'ao vivo'} ·
        {' '}dica: escolha uma ferramenta e arraste; ligue o Replay e dê Play para ver o pregão se revelar.
      </footer>

      {/* As linhas de nivel de alerta entram como price lines via efeito abaixo. */}
      <AplicarLinhasAlerta engine={engine} linhas={linhasAlerta} />
    </div>
  );
}

/**
 * Aplica as linhas de nivel de alerta no motor. E um componente separado so para
 * ter um efeito proprio: as price lines seguem os toggles de alerta sem
 * reaplicar o resto do grafico.
 */
function AplicarLinhasAlerta(props: {
  engine: ReturnType<typeof useChartEngine>['engine'];
  linhas: ReadonlyArray<{ price: number; color: string; title: string; lineStyle: number }>;
}): null {
  const { engine, linhas } = props;
  useEffect(() => {
    if (engine === null) return;
    engine.setPriceLines(linhas);
  }, [engine, linhas]);
  return null;
}

function rotuloCondicao(key: string): string {
  if (key === 'cross-acima') return 'Cruzar ↑ (66%)';
  if (key === 'cross-abaixo') return 'Cruzar ↓ (33%)';
  return key;
}

function barra(): React.CSSProperties {
  return {
    display: 'flex',
    gap: 4,
    padding: '6px 16px',
    borderBottom: '1px solid rgba(148,163,184,0.1)',
    alignItems: 'center',
    flexWrap: 'wrap',
  };
}

function rotuloBarra(): React.CSSProperties {
  return { fontSize: 11, color: '#64748b', marginRight: 6 };
}

function botao(ativo: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid rgba(148,163,184,0.2)',
    background: ativo ? 'rgba(56,189,248,0.2)' : 'transparent',
    color: ativo ? '#7dd3fc' : '#cbd5e1',
    cursor: 'pointer',
  };
}

function cartaoAlerta(disparado: boolean): React.CSSProperties {
  return {
    padding: '6px 8px',
    borderRadius: 6,
    border: `1px solid ${disparado ? 'rgba(251,191,36,0.4)' : 'rgba(148,163,184,0.2)'}`,
    background: disparado ? 'rgba(251,191,36,0.08)' : 'transparent',
  };
}

const raiz = document.getElementById('root');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
