/**
 * chart-state.core — testes do serializador de estado COMPLETO do grafico.
 *
 * O nucleo e puro (sem DOM/relogio), entao aqui nao ha jsdom a exercitar: o que
 * importa e a disciplina de dado do usuario — round-trip fiel, versao gravada,
 * validacao na leitura e recusa PARCIAL (item ruim nao derruba o documento).
 */
import { describe, it, expect } from 'vitest';
import {
  serializeChartState,
  deserializeChartState,
  CHART_STATE_SCHEMA_VERSION,
  type SerializeChartInput,
} from '../chart-state.core.js';

const desenhoVazio = { version: 1, drawings: [] };

function inputBase(): SerializeChartInput {
  return {
    symbol: 'WINV26',
    priceSeriesType: 'Candlestick',
    indicators: [
      { id: 'ema20', name: 'ema', params: { period: 20 } },
      { id: 'rsi', name: 'rsi', params: { period: 14 } },
    ],
    alerts: [
      { key: 'a1', condition: { kind: 'CROSS_ABOVE', level: 130000 }, mode: 'recurring' },
    ],
    drawings: desenhoVazio,
    viewport: { from: 10, to: 120 },
  };
}

describe('serializeChartState', () => {
  it('grava a versao do esquema', () => {
    const doc = serializeChartState(inputBase());
    expect(doc.version).toBe(CHART_STATE_SCHEMA_VERSION);
  });

  it('preserva tipo de serie, indicadores, alertas, viewport e symbol', () => {
    const doc = serializeChartState(inputBase());
    expect(doc.symbol).toBe('WINV26');
    expect(doc.priceSeriesType).toBe('Candlestick');
    expect(doc.indicators).toHaveLength(2);
    expect(doc.indicators[0]).toEqual({ id: 'ema20', name: 'ema', params: { period: 20 } });
    expect(doc.alerts[0]).toEqual({
      key: 'a1',
      condition: { kind: 'CROSS_ABOVE', level: 130000 },
      mode: 'recurring',
    });
    expect(doc.viewport).toEqual({ from: 10, to: 120 });
  });

  /**
   * ⭐ O documento salvo NAO pode compartilhar referencia com o estado vivo —
   * senao editar um indicador depois de "salvar" alteraria o que foi salvo.
   */
  it('copia por item — nao compartilha referencia com a entrada', () => {
    const input = inputBase();
    const doc = serializeChartState(input);
    expect(doc.indicators[0]).not.toBe(input.indicators[0]);
    expect(doc.alerts[0]!.condition).not.toBe(input.alerts[0]!.condition);
  });

  it('drawings ausente vira documento de desenho vazio', () => {
    const doc = serializeChartState({ ...inputBase(), drawings: undefined });
    expect(doc.drawings).toEqual({ version: 1, drawings: [] });
  });
});

describe('deserializeChartState — round-trip', () => {
  it('le de volta o que foi gravado, fielmente', () => {
    const doc = serializeChartState(inputBase());
    const { state, rejected } = deserializeChartState(doc);
    expect(rejected).toBe(0);
    expect(state.priceSeriesType).toBe('Candlestick');
    expect(state.indicators).toHaveLength(2);
    expect(state.alerts).toHaveLength(1);
    expect(state.viewport).toEqual({ from: 10, to: 120 });
    expect(state.symbol).toBe('WINV26');
  });
});

describe('deserializeChartState — entrada hostil, nunca lanca', () => {
  it('nao-objeto devolve estado vazio com motivo', () => {
    for (const ruim of [null, undefined, 42, 'x', []]) {
      const r = deserializeChartState(ruim);
      expect(r.state.indicators).toHaveLength(0);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('versao ausente ou nao inteira recusa', () => {
    expect(deserializeChartState({ indicators: [] }).reasons[0]).toMatch(/versao/i);
    expect(deserializeChartState({ version: 1.5 }).reasons[0]).toMatch(/versao/i);
  });

  /**
   * ⭐ Documento do FUTURO e recusado inteiro: carregar parcial faria o usuario
   * perder o que a versao nova acrescentou, e regravar por cima perpetuaria a perda.
   */
  it('versao mais nova que a suportada e recusada', () => {
    const r = deserializeChartState({ version: CHART_STATE_SCHEMA_VERSION + 1 });
    expect(r.state.indicators).toHaveLength(0);
    expect(r.reasons[0]).toMatch(/mais nova/i);
  });

  it('tipo de serie invalido cai no default Candlestick', () => {
    const r = deserializeChartState({ version: 1, priceSeriesType: 'Foo' });
    expect(r.state.priceSeriesType).toBe('Candlestick');
  });

  it('tipo de serie valido e respeitado', () => {
    for (const t of ['Line', 'Area', 'Bar', 'Candlestick'] as const) {
      const r = deserializeChartState({ version: 1, priceSeriesType: t });
      expect(r.state.priceSeriesType).toBe(t);
    }
  });
});

describe('deserializeChartState — recusa PARCIAL', () => {
  /**
   * ⭐ Um indicador corrompido nao invalida o layout inteiro: o ruim e descartado
   * e contado, o resto passa.
   */
  it('descarta indicador sem id/name e mantem os validos', () => {
    const r = deserializeChartState({
      version: 1,
      indicators: [
        { id: 'ok', name: 'ema', params: { period: 20 } },
        { id: '', name: 'rsi' }, // id vazio
        { id: 'x' }, // sem name
        'lixo',
      ],
    });
    expect(r.state.indicators).toHaveLength(1);
    expect(r.state.indicators[0]!.id).toBe('ok');
    expect(r.rejected).toBe(3);
  });

  it('descarta indicador com id repetido — o primeiro ganha', () => {
    const r = deserializeChartState({
      version: 1,
      indicators: [
        { id: 'dup', name: 'ema' },
        { id: 'dup', name: 'sma' },
      ],
    });
    expect(r.state.indicators).toHaveLength(1);
    expect(r.state.indicators[0]!.name).toBe('ema');
    expect(r.rejected).toBe(1);
  });

  /**
   * ⚠️ Parametro NaN/objeto e OMITIDO, nao rejeita o indicador — cai no default
   * do indicador ao instanciar. So numero finito/string/boolean sobrevivem.
   */
  it('sanea params: NaN, objeto e array somem; validos ficam', () => {
    const r = deserializeChartState({
      version: 1,
      indicators: [
        {
          id: 'i',
          name: 'x',
          params: { period: 20, ruim: NaN, obj: { a: 1 }, arr: [1], txt: 'src', flag: true },
        },
      ],
    });
    expect(r.state.indicators[0]!.params).toEqual({ period: 20, txt: 'src', flag: true });
  });

  it('descarta alerta sem key ou sem condition.kind', () => {
    const r = deserializeChartState({
      version: 1,
      alerts: [
        { key: 'ok', condition: { kind: 'TOUCH', level: 100 } },
        { key: '', condition: { kind: 'TOUCH' } }, // key vazia
        { key: 'x', condition: { level: 100 } }, // sem kind
        { key: 'y', condition: null }, // condition invalida
      ],
    });
    expect(r.state.alerts).toHaveLength(1);
    expect(r.state.alerts[0]!.key).toBe('ok');
    expect(r.rejected).toBe(3);
  });
});

describe('deserializeChartState — viewport e drawings', () => {
  it('viewport com from > to e descartado', () => {
    const r = deserializeChartState({ version: 1, viewport: { from: 100, to: 10 } });
    expect(r.state.viewport).toBeUndefined();
  });

  it('viewport com nao-finito e descartado', () => {
    const r = deserializeChartState({ version: 1, viewport: { from: NaN, to: 10 } });
    expect(r.state.viewport).toBeUndefined();
  });

  it('drawings nao-objeto vira documento vazio com motivo', () => {
    const r = deserializeChartState({ version: 1, drawings: 'lixo' });
    expect(r.state.drawings).toEqual({ version: 1, drawings: [] });
    expect(r.reasons.some((m) => /drawings/i.test(m))).toBe(true);
  });

  it('drawings objeto e preservado como bloco opaco', () => {
    const doc = { version: 1, drawings: [{ id: 'd1', kind: 'TRENDLINE' }] };
    const r = deserializeChartState({ version: 1, drawings: doc });
    expect(r.state.drawings).toEqual(doc);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⭐ Visibilidade e cor do indicador — campos NOVOS, sem subir a versao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que estes casos travam, e por que a versao do esquema NAO subiu.
 *
 * Antes, o esquema nao tinha visibilidade, e o catalogo do React so gravava os
 * indicadores VISIVEIS. Consequencia pratica severa: desligar um indicador e salvar o
 * layout **apagava o indicador do layout**. O operador voltava na sessao seguinte, ele
 * nao estava mais lá, e nao havia como saber que a configuracao tinha sido perdida.
 *
 * `visible` e `colors` entraram como campos OPCIONAIS. Documento gravado ANTES deles
 * le exatamente como antes — visivel, sem cor — entao subir a versao so transformaria
 * todo layout ja salvo em "documento de versao velha" sem ganho nenhum.
 */
describe('⭐ IndicatorState.visible — persistir "desligado" sem perder o indicador', () => {
  it('grava `visible: false` e o le de volta', () => {
    const doc = serializeChartState({
      priceSeriesType: 'Candlestick',
      indicators: [
        { id: 'rsi', name: 'rsi', params: { period: 14 }, visible: false },
        { id: 'ema20', name: 'ema' },
      ],
      alerts: [],
    });
    expect(doc.indicators[0]?.visible).toBe(false);

    const lido = deserializeChartState(JSON.parse(JSON.stringify(doc)));
    expect(lido.rejected).toBe(0);
    expect(lido.state.indicators[0]).toMatchObject({ id: 'rsi', visible: false });
  });

  /**
   * ⚠️ `visible` so e GRAVADO quando falso. "Ausente = visivel" ja e a leitura correta,
   * e gravar `true` em todo indicador seria ruido em cada documento salvo.
   */
  it('NAO grava `visible` quando o indicador esta visivel', () => {
    const doc = serializeChartState({
      priceSeriesType: 'Candlestick',
      indicators: [{ id: 'ema20', name: 'ema', visible: true }],
      alerts: [],
    });
    expect('visible' in (doc.indicators[0] as object)).toBe(false);
  });

  /**
   * ⭐ COMPATIBILIDADE: documento gravado ANTES do campo existir. E o motivo de a versao
   * do esquema nao ter subido — este documento tem de continuar valido.
   */
  it('documento SEM o campo le como visivel (compatibilidade)', () => {
    const antigo = {
      version: CHART_STATE_SCHEMA_VERSION,
      priceSeriesType: 'Candlestick',
      indicators: [{ id: 'ema20', name: 'ema', params: { period: 20 } }],
      alerts: [],
      drawings: desenhoVazio,
    };
    const lido = deserializeChartState(antigo);
    expect(lido.rejected).toBe(0);
    expect(lido.state.indicators[0]?.visible).toBeUndefined();
  });

  /**
   * ⚠️ So `false` EXATO esconde. Um documento editado a mao com `visible: 0` esconder o
   * indicador em silencio seria pior que ignorar o campo: o operador veria o indicador
   * na lista, nada na tela, e nenhuma pista da causa.
   */
  it('valor truthy/estranho no lugar de `false` le como VISIVEL', () => {
    for (const valor of [0, '', 'nao', null, [], {}]) {
      const lido = deserializeChartState({
        version: CHART_STATE_SCHEMA_VERSION,
        priceSeriesType: 'Line',
        indicators: [{ id: 'x', name: 'ema', visible: valor }],
        alerts: [],
        drawings: desenhoVazio,
      });
      expect(lido.state.indicators[0]?.visible).toBeUndefined();
    }
  });
});

describe('IndicatorState.colors — a aparencia escolhida sobrevive', () => {
  it('round-trip das cores por chave de saida', () => {
    const doc = serializeChartState({
      priceSeriesType: 'Candlestick',
      indicators: [{ id: 'bb', name: 'bollinger', colors: { upper: '#0af', lower: '#0af' } }],
      alerts: [],
    });
    const lido = deserializeChartState(JSON.parse(JSON.stringify(doc)));
    expect(lido.state.indicators[0]?.colors).toEqual({ upper: '#0af', lower: '#0af' });
  });

  it('copia o mapa — editar a cor depois de salvar nao altera o salvo', () => {
    const cores: Record<string, string> = { value: '#111' };
    const doc = serializeChartState({
      priceSeriesType: 'Line',
      indicators: [{ id: 'ema', name: 'ema', colors: cores }],
      alerts: [],
    });
    cores.value = '#999';
    expect(doc.indicators[0]?.colors).toEqual({ value: '#111' });
  });

  /**
   * ⚠️ O FORMATO da cor nao e validado, e isso e escolha: quem consome e o canvas, que
   * ignora cor invalida sem lancar, e uma lista branca recusaria cor legitima que o
   * navegador aceita (`oklch`, `color-mix`). O que se barra e o que nao e cor nenhuma.
   */
  it('descarta entrada que nao e string nao vazia, mantendo as boas', () => {
    const lido = deserializeChartState({
      version: CHART_STATE_SCHEMA_VERSION,
      priceSeriesType: 'Line',
      indicators: [
        {
          id: 'x',
          name: 'ema',
          colors: { boa: '#abc', vazia: '', numero: 7, nulo: null, objeto: {}, exotica: 'oklch(70% 0.1 200)' },
        },
      ],
      alerts: [],
      drawings: desenhoVazio,
    });
    expect(lido.state.indicators[0]?.colors).toEqual({ boa: '#abc', exotica: 'oklch(70% 0.1 200)' });
  });

  it('mapa de cores todo invalido some do estado em vez de virar objeto vazio', () => {
    const lido = deserializeChartState({
      version: CHART_STATE_SCHEMA_VERSION,
      priceSeriesType: 'Line',
      indicators: [{ id: 'x', name: 'ema', colors: { a: 1, b: null } }],
      alerts: [],
      drawings: desenhoVazio,
    });
    expect(lido.state.indicators[0]?.colors).toBeUndefined();
  });

  it('`colors` que nao e objeto e ignorado, sem rejeitar o indicador', () => {
    const lido = deserializeChartState({
      version: CHART_STATE_SCHEMA_VERSION,
      priceSeriesType: 'Line',
      indicators: [{ id: 'x', name: 'ema', colors: ['#fff'] }],
      alerts: [],
      drawings: desenhoVazio,
    });
    // Recusa PARCIAL do CAMPO, nao do item: o indicador continua no layout.
    expect(lido.rejected).toBe(0);
    expect(lido.state.indicators[0]?.id).toBe('x');
    expect(lido.state.indicators[0]?.colors).toBeUndefined();
  });
});
