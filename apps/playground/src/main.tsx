/**
 * Playground — junta motor, camadas de fluxo e ferramentas de desenho num app.
 *
 * E a superficie para VER a biblioteca funcionando local, sem backend. Nao faz
 * parte da biblioteca: e consumidor dela, e serve de exemplo de montagem.
 */
import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { decodeColumnar } from '@robustus/charts-core';
import { useChartEngine, useDrawings, useIndicators } from '@robustus/charts-react';
import type { ActiveTool, SnapBar } from '@robustus/charts-drawings';
import type { IndicatorPlot } from '@robustus/charts-engine';
import { emaFactory, bollingerFactory, rsiFactory, macdFactory } from '@robustus/charts-indicators';
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

function App(): JSX.Element {
  // Pregao sintetico deterministico, gerado uma vez.
  const bundle = useMemo(() => makeSyntheticBundle(240, 300, 42), []);
  const grid = useMemo(() => decodeColumnar(bundle.depth), [bundle]);

  const [mostrarBookmap, setMostrarBookmap] = useState(true);
  const [imaLigado, setImaLigado] = useState(false);
  const [tick, setTick] = useState(0);

  // Indicadores ligados/desligados por toggle.
  const [emaOn, setEmaOn] = useState(true);
  const [bbOn, setBbOn] = useState(false);
  const [rsiOn, setRsiOn] = useState(true);
  const [macdOn, setMacdOn] = useState(false);

  // Barras para o ima, no formato que o pacote de desenho espera.
  const barsRef = useRef<SnapBar[]>(
    bundle.candles.map((c) => ({
      timeSec: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })),
  );

  const { containerRef, engine } = useChartEngine({
    options: { withVolume: true },
    candles: bundle.candles,
    volume: bundle.volume,
    bookmap:
      mostrarBookmap && grid !== null
        ? { grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: bundle.tickSize, modoCor: 'TERMICA' }
        : null,
  });

  const desenho = useDrawings({
    engine,
    bars: () => barsRef.current,
    snapEnabled: () => imaLigado,
    onChange: () => setTick((n) => n + 1),
  });

  // Monta a lista de indicadores a plotar conforme os toggles. A instancia e
  // criada aqui; o hook a alimenta com as barras. `useMemo` estabiliza a
  // identidade para o hook nao recriar series a cada render — recria so quando
  // um toggle muda.
  const plots: IndicatorPlot[] = useMemo(() => {
    const lista: IndicatorPlot[] = [];
    if (emaOn) lista.push({ id: 'ema20', instance: emaFactory.create({ period: 20 }), colors: { value: '#e9c46a' } });
    if (bbOn) lista.push({ id: 'bb', instance: bollingerFactory.create({ period: 20, mult: 2 }) });
    if (rsiOn) lista.push({ id: 'rsi', instance: rsiFactory.create({ period: 14 }) });
    if (macdOn) lista.push({ id: 'macd', instance: macdFactory.create() });
    return lista;
  }, [emaOn, bbOn, rsiOn, macdOn]);

  useIndicators({ engine, plots, bars: bundle.candles });

  void tick; // forca re-render quando a colecao muda, para os contadores atualizarem

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
              <button
                key={f.rotulo}
                type="button"
                onClick={() => desenho.setTool(f.id)}
                style={botao(ativa)}
              >
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

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 16px',
          borderBottom: '1px solid rgba(148,163,184,0.1)',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: '#64748b', marginRight: 6 }}>Indicadores:</span>
        <button type="button" onClick={() => setEmaOn((v) => !v)} style={botao(emaOn)}>EMA 20</button>
        <button type="button" onClick={() => setBbOn((v) => !v)} style={botao(bbOn)}>Bollinger</button>
        <button type="button" onClick={() => setRsiOn((v) => !v)} style={botao(rsiOn)}>RSI</button>
        <button type="button" onClick={() => setMacdOn((v) => !v)} style={botao(macdOn)}>MACD</button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
          EMA/Bollinger sobre o preço · RSI/MACD em sub-painel
        </span>
      </div>

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

      <footer style={{ padding: '6px 16px', fontSize: 11, color: '#64748b', borderTop: '1px solid rgba(148,163,184,0.15)' }}>
        {desenho.drawings.length} desenho(s) · {desenho.selectedIds.length} selecionado(s) ·
        {' '}gesto: {desenho.interaction.kind} ·
        {' '}dica: escolha uma ferramenta e arraste no gráfico; clique em Selecionar para mover/editar; Ctrl+Z desfaz.
      </footer>
    </div>
  );
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

const raiz = document.getElementById('root');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
