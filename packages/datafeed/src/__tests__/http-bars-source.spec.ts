/**
 * http-bars-source — adaptador de referencia de barras sobre HTTP.
 *
 * O que estes testes protegem, igual ao depth source: o mapeamento de FALHA. O
 * adaptador traduz status HTTP, cancelamento, limite de espera e payload
 * recusado em causas tipadas. A distincao que mais importa e `DECODIFICACAO` vs
 * `INDISPONIVEL`: parser que recusa e contrato quebrado, nao "dia sem dado".
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createHttpBarsSource,
  parseBarsDefault,
  BARS_TIMEOUT_MS_DEFAULT,
  type FetchLike,
} from '../http-bars-source.js';
import type { BarsRequest } from '../contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// Insumos
// ═════════════════════════════════════════════════════════════════════════════

const PEDIDO: BarsRequest = {
  instrument: { symbol: 'WINV26', tickSize: 5 },
  periodSeconds: 300,
  fromSeconds: 1_700_000_000,
  toSeconds: 1_700_003_600,
  limit: 500,
};

/** Duas barras no formato que o parser default aceita. */
function payloadValido(): unknown {
  return [
    { time: 1_700_000_000, open: 100, high: 105, low: 99, close: 104, volume: 12 },
    { time: 1_700_000_300, open: 104, high: 108, low: 103, close: 107, volume: 8 },
  ];
}

/** Constroi um `FetchLike` que responde o que o teste pedir. */
function fetchQueResponde(resposta: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}): FetchLike {
  return async () => ({
    ok: resposta.ok ?? true,
    status: resposta.status ?? 200,
    json: resposta.json ?? (async () => payloadValido()),
  });
}

const URL_FIXA = () => '/qualquer/rota';

// ═════════════════════════════════════════════════════════════════════════════
// Caminho de sucesso
// ═════════════════════════════════════════════════════════════════════════════

describe('createHttpBarsSource — sucesso', () => {
  it('devolve as barras decodificadas pelo parser default', async () => {
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({}),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getBars(PEDIDO);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBe(2);
    expect(r.data[0]).toEqual({
      time: 1_700_000_000,
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 12,
    });
    expect(r.data[1]?.close).toBe(107);
  });

  it('usa o parseBars injetado quando fornecido, ignorando o default', async () => {
    const parseBars = vi.fn(() => [
      { time: 1, open: 2, high: 3, low: 1, close: 2 },
    ]);
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({ json: async () => ({ formato: 'esquisito' }) }),
      buildUrl: URL_FIXA,
      parseBars,
    });

    const r = await fonte.getBars(PEDIDO);

    expect(parseBars).toHaveBeenCalledTimes(1);
    // O parser recebe corpo cru E o pedido.
    expect(parseBars.mock.calls[0]?.[1]).toBe(PEDIDO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data[0]?.time).toBe(1);
  });

  it('repassa a URL que o consumidor montou, sem reescrever', async () => {
    const buildUrl = vi.fn(() => '/candles?symbol=WINV26&tf=300');
    const fetch = vi.fn(fetchQueResponde({}));

    await createHttpBarsSource({ fetch, buildUrl }).getBars(PEDIDO);

    expect(buildUrl).toHaveBeenCalledWith(PEDIDO);
    expect(fetch.mock.calls[0]?.[0]).toBe('/candles?symbol=WINV26&tf=300');
  });

  it('le os cabecalhos NO MOMENTO da chamada, nao na construcao', async () => {
    let geracao = 0;
    const headers = vi.fn(() => ({ 'x-api-key': `chave-${++geracao}` }));
    const fetch = vi.fn(fetchQueResponde({}));
    const fonte = createHttpBarsSource({ fetch, buildUrl: URL_FIXA, headers });

    await fonte.getBars(PEDIDO);
    await fonte.getBars(PEDIDO);

    expect(headers).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ 'x-api-key': 'chave-1' });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ 'x-api-key': 'chave-2' });
  });

  it('nao envia campo de cabecalho quando nao ha `headers`', async () => {
    const fetch = vi.fn(fetchQueResponde({}));
    await createHttpBarsSource({ fetch, buildUrl: URL_FIXA }).getBars(PEDIDO);
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('headers');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O parser default, isolado
// ═════════════════════════════════════════════════════════════════════════════

describe('parseBarsDefault', () => {
  it('aceita array de OHLCV e ignora campos extras', () => {
    const r = parseBarsDefault(
      [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 5, extra: 'x' }],
      PEDIDO,
    );
    expect(r).toEqual([{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 5 }]);
  });

  it('mantem buyVolume/sellVolume quando presentes e finitos', () => {
    const r = parseBarsDefault(
      [{ time: 1, open: 1, high: 2, low: 0, close: 1, buyVolume: 3, sellVolume: 2 }],
      PEDIDO,
    );
    expect(r?.[0]).toEqual({
      time: 1,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
      buyVolume: 3,
      sellVolume: 2,
    });
  });

  it('omite volume ausente — ausencia e "nao sei", nunca zero', () => {
    const r = parseBarsDefault([{ time: 1, open: 1, high: 2, low: 0, close: 1 }], PEDIDO);
    expect(r?.[0]).not.toHaveProperty('volume');
    expect(r?.[0]).not.toHaveProperty('buyVolume');
  });

  it('omite volume nao-finito em vez de deixar NaN vazar', () => {
    const r = parseBarsDefault(
      [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: Number.NaN }],
      PEDIDO,
    );
    expect(r?.[0]).not.toHaveProperty('volume');
  });

  it.each([
    ['nao e array', { time: 1 }],
    ['null', null],
    ['numero', 42],
    ['campo OHLC faltando', [{ time: 1, open: 1, high: 2, low: 0 }]],
    ['OHLC nao-finito', [{ time: 1, open: Number.NaN, high: 2, low: 0, close: 1 }]],
    ['OHLC como string', [{ time: 1, open: '1', high: 2, low: 0, close: 1 }]],
    ['membro nao-objeto', [42]],
  ])('recusa (%s) devolvendo null', (_nome, corpo) => {
    expect(parseBarsDefault(corpo, PEDIDO)).toBeNull();
  });

  it('UMA barra ruim condena a serie inteira — buraco no meio e pior que recusa', () => {
    const r = parseBarsDefault(
      [
        { time: 1, open: 1, high: 2, low: 0, close: 1 },
        { time: 2, open: 1, high: 2, low: 0 }, // sem close
        { time: 3, open: 1, high: 2, low: 0, close: 1 },
      ],
      PEDIDO,
    );
    expect(r).toBeNull();
  });

  it('array vazio e serie vazia valida, nao recusa', () => {
    expect(parseBarsDefault([], PEDIDO)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mapeamento de falha — o coracao deste arquivo
// ═════════════════════════════════════════════════════════════════════════════

describe('createHttpBarsSource — cada falha tem causa propria', () => {
  it.each([
    [401, 'NEGADA'],
    [403, 'NEGADA'],
    [404, 'INDISPONIVEL'],
    [204, 'INDISPONIVEL'],
    [500, 'TRANSPORTE'],
    [502, 'TRANSPORTE'],
    [418, 'TRANSPORTE'],
  ])('HTTP %i -> %s', async (status, causa) => {
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({ ok: false, status }),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getBars(PEDIDO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cause).toBe(causa);
    expect(r.detail).toContain(String(status));
  });

  it('payload recusado pelo parser e DECODIFICACAO, nunca INDISPONIVEL', async () => {
    const invalidos: unknown[] = [
      null,
      42,
      'texto',
      {},
      [{ time: 1, open: 1, high: 2, low: 0 }], // sem close
      [{ time: Number.NaN, open: 1, high: 2, low: 0, close: 1 }], // time nao-finito
    ];

    for (const corpo of invalidos) {
      const fonte = createHttpBarsSource({
        fetch: fetchQueResponde({ json: async () => corpo }),
        buildUrl: URL_FIXA,
      });
      const r = await fonte.getBars(PEDIDO);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.cause).toBe('DECODIFICACAO');
    }
  });

  it('parser injetado que lanca vira DECODIFICACAO, nao excecao', async () => {
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({}),
      buildUrl: URL_FIXA,
      parseBars: () => {
        throw new Error('formato inesperado');
      },
    });

    const r = await fonte.getBars(PEDIDO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe('DECODIFICACAO');
      expect(r.detail).toContain('parseBars lancou');
    }
  });

  it('falha de transporte nao escapa como excecao', async () => {
    const fonte = createHttpBarsSource({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getBars(PEDIDO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe('TRANSPORTE');
      expect(r.detail).toContain('TypeError');
    }
  });

  it('`json()` que lanca vira TRANSPORTE, nao excecao', async () => {
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getBars(PEDIDO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('TRANSPORTE');
  });

  it('`buildUrl` do consumidor que lanca nao derruba o ciclo de desenho', async () => {
    const fonte = createHttpBarsSource({
      fetch: fetchQueResponde({}),
      buildUrl: () => {
        throw new Error('esqueci o symbol');
      },
    });

    const r = await fonte.getBars(PEDIDO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe('TRANSPORTE');
      expect(r.detail).toContain('buildUrl lancou');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cancelamento e limite de espera
// ═════════════════════════════════════════════════════════════════════════════

describe('createHttpBarsSource — cancelamento', () => {
  it('sinal ja cancelado nao gasta requisicao', async () => {
    const fetch = vi.fn(fetchQueResponde({}));
    const controlador = new AbortController();
    controlador.abort();

    const r = await createHttpBarsSource({ fetch, buildUrl: URL_FIXA }).getBars(
      PEDIDO,
      controlador.signal,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('CANCELADA');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancelamento durante a requisicao vira CANCELADA, nao TRANSPORTE', async () => {
    const controlador = new AbortController();
    const fonte = createHttpBarsSource({
      fetch: (_url, init) =>
        new Promise((_resolver, rejeitar) => {
          init?.signal?.addEventListener('abort', () =>
            rejeitar(new DOMException('Aborted', 'AbortError')),
          );
        }),
      buildUrl: URL_FIXA,
    });

    const promessa = fonte.getBars(PEDIDO, controlador.signal);
    controlador.abort();
    const r = await promessa;

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('CANCELADA');
  });

  it('backend pendurado vira TEMPO_ESGOTADO, e nao espera para sempre', async () => {
    vi.useFakeTimers();
    try {
      const fonte = createHttpBarsSource({
        fetch: (_url, init) =>
          new Promise((_resolver, rejeitar) => {
            init?.signal?.addEventListener('abort', () =>
              rejeitar(new DOMException('Aborted', 'AbortError')),
            );
          }),
        buildUrl: URL_FIXA,
        timeoutMs: 5_000,
      });

      const promessa = fonte.getBars(PEDIDO);
      await vi.advanceTimersByTimeAsync(5_001);
      const r = await promessa;

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.cause).toBe('TEMPO_ESGOTADO');
        expect(r.detail).toContain('5000');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('o limite default e 10 s', () => {
    expect(BARS_TIMEOUT_MS_DEFAULT).toBe(10_000);
  });

  it('resposta rapida nao e afetada pelo cronometro', async () => {
    vi.useFakeTimers();
    try {
      const fonte = createHttpBarsSource({
        fetch: fetchQueResponde({}),
        buildUrl: URL_FIXA,
        timeoutMs: 50,
      });
      const r = await fonte.getBars(PEDIDO);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
