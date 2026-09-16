/**
 * http-depth-source — adaptador de referencia de profundidade.
 *
 * O que estes testes protegem: o mapeamento de FALHA. O adaptador traduz status
 * HTTP, cancelamento, limite de espera e payload recusado em causas tipadas — e
 * cada causa leva a uma acao diferente de quem le a tela. Colapsar duas delas
 * (tipicamente `INDISPONIVEL` com `DECODIFICACAO`) faz contrato quebrado no
 * backend parecer "dia sem dado", e o defeito vive meses.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createHttpDepthSource,
  DEPTH_TIMEOUT_MS_DEFAULT,
  type FetchLike,
} from '../http-depth-source.js';
import type { DepthGridRequest } from '../contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// Insumos
// ═════════════════════════════════════════════════════════════════════════════

const PEDIDO: DepthGridRequest = {
  instrument: { symbol: 'WINV26', tickSize: 5 },
  day: '2026-08-28',
  source: 'MT5_L2',
  bucketSeconds: 60,
};

/**
 * Payload colunar MINIMO que `decodeColumnar` aceita.
 *
 * Duas celulas, dois instantes, dois precos. Pequeno de proposito: o objetivo
 * aqui e exercitar o adaptador, nao a decodificacao — que tem suite propria e
 * fixture real no pacote core.
 */
function payloadValido(): unknown {
  return {
    formato: 'colunar',
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    de: '2026-08-28',
    baldeSeg: 60,
    nivel: 'PROFUNDIDADE',
    celulas: 2,
    eixos: { t: [1_000_000, 1_060_000], p: [130_000, 130_005] },
    colunas: {
      ti: [0, 1],
      pi: [0, 1],
      b: [10, 20],
      a: [30, 40],
      c: [1, 2],
      v: [3, 4],
    },
    cobertura: null,
  };
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

describe('createHttpDepthSource — sucesso', () => {
  it('devolve o grid DECODIFICADO, nao o JSON cru', async () => {
    const fonte = createHttpDepthSource({
      fetch: fetchQueResponde({}),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getDepthGrid(PEDIDO);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Array tipado é a prova de que passou pelo decodificador: o JSON tem array
    // comum, o grid tem Float64Array/Float32Array.
    expect(r.data.times).toBeInstanceOf(Float64Array);
    expect(r.data.prices).toBeInstanceOf(Float64Array);
    expect(r.data.bid).toBeInstanceOf(Float32Array);
    expect(r.data.ti).toBeInstanceOf(Uint32Array);
    // Duas células: os índices e os valores têm o comprimento das colunas.
    expect(r.data.ti.length).toBe(2);
    expect(r.data.bid.length).toBe(2);
    // Round-trip exato dos eixos, que é a pós-condição declarada do decodificador.
    expect(Array.from(r.data.times)).toEqual([1_000_000, 1_060_000]);
    expect(Array.from(r.data.prices)).toEqual([130_000, 130_005]);
    // Metadados do pedido preservados no grid.
    expect(r.data.symbol).toBe('WINV26');
    expect(r.data.fonte).toBe('MT5_L2');
    expect(r.data.dia).toBe('2026-08-28');
    expect(r.data.baldeSeg).toBe(60);
  });

  it('repassa a URL que o consumidor montou, sem reescrever', async () => {
    const buildUrl = vi.fn(() => '/minha/rota?x=1');
    const fetch = vi.fn(fetchQueResponde({}));

    await createHttpDepthSource({ fetch, buildUrl }).getDepthGrid(PEDIDO);

    expect(buildUrl).toHaveBeenCalledWith(PEDIDO);
    expect(fetch.mock.calls[0]?.[0]).toBe('/minha/rota?x=1');
  });

  it('le os cabecalhos NO MOMENTO da chamada, nao na construcao', async () => {
    // Importa para credencial de vida curta: objeto fixo capturaria um valor na
    // construcao e ele venceria em silencio.
    let geracao = 0;
    const headers = vi.fn(() => ({ 'x-api-key': `chave-${++geracao}` }));
    const fetch = vi.fn(fetchQueResponde({}));
    const fonte = createHttpDepthSource({ fetch, buildUrl: URL_FIXA, headers });

    await fonte.getDepthGrid(PEDIDO);
    await fonte.getDepthGrid(PEDIDO);

    expect(headers).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ 'x-api-key': 'chave-1' });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ 'x-api-key': 'chave-2' });
  });

  it('nao envia campo de cabecalho quando nao ha `headers`', async () => {
    const fetch = vi.fn(fetchQueResponde({}));
    await createHttpDepthSource({ fetch, buildUrl: URL_FIXA }).getDepthGrid(PEDIDO);
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('headers');
  });

  it('repassa as fontes disponiveis ao contrato', () => {
    const fonte = createHttpDepthSource({
      fetch: fetchQueResponde({}),
      buildUrl: URL_FIXA,
      availableSources: ['MT5_L2', 'CEDRO_MBO'],
    });
    expect(fonte.availableSources).toEqual(['MT5_L2', 'CEDRO_MBO']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mapeamento de falha — o coracao deste arquivo
// ═════════════════════════════════════════════════════════════════════════════

describe('createHttpDepthSource — cada falha tem causa propria', () => {
  it.each([
    [401, 'NEGADA'],
    [403, 'NEGADA'],
    [404, 'INDISPONIVEL'],
    [204, 'INDISPONIVEL'],
    [500, 'TRANSPORTE'],
    [502, 'TRANSPORTE'],
    [418, 'TRANSPORTE'],
  ])('HTTP %i -> %s', async (status, causa) => {
    const fonte = createHttpDepthSource({
      fetch: fetchQueResponde({ ok: false, status }),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getDepthGrid(PEDIDO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cause).toBe(causa);
    expect(r.detail).toContain(String(status));
  });

  /**
   * ⭐ A distincao que importa mais.
   *
   * Payload que o decodificador recusa NAO e "dia sem dado" — e contrato
   * quebrado. Se isto virar `INDISPONIVEL`, uma mudanca de formato no backend
   * passa a parecer feriado.
   */
  it('payload recusado pelo decodificador e DECODIFICACAO, nunca INDISPONIVEL', async () => {
    const invalidos: unknown[] = [
      null,
      42,
      'texto',
      {},
      { formato: 'verboso' }, // formato errado
      { ...(payloadValido() as object), eixos: { t: [2, 1], p: [1, 2] } }, // eixo decrescente
      { ...(payloadValido() as object), colunas: { ti: [0], pi: [0], b: [1] } }, // colunas desiguais
    ];

    for (const corpo of invalidos) {
      const fonte = createHttpDepthSource({
        fetch: fetchQueResponde({ json: async () => corpo }),
        buildUrl: URL_FIXA,
      });
      const r = await fonte.getDepthGrid(PEDIDO);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.cause).toBe('DECODIFICACAO');
    }
  });

  it('falha de transporte nao escapa como excecao', async () => {
    const fonte = createHttpDepthSource({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getDepthGrid(PEDIDO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cause).toBe('TRANSPORTE');
    expect(r.detail).toContain('TypeError');
  });

  it('`json()` que lanca vira TRANSPORTE, nao excecao', async () => {
    const fonte = createHttpDepthSource({
      fetch: fetchQueResponde({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }),
      buildUrl: URL_FIXA,
    });

    const r = await fonte.getDepthGrid(PEDIDO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('TRANSPORTE');
  });

  it('`buildUrl` do consumidor que lanca nao derruba o ciclo de desenho', async () => {
    const fonte = createHttpDepthSource({
      fetch: fetchQueResponde({}),
      buildUrl: () => {
        throw new Error('esqueci o symbol');
      },
    });

    const r = await fonte.getDepthGrid(PEDIDO);
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

describe('createHttpDepthSource — cancelamento', () => {
  it('sinal ja cancelado nao gasta requisicao', async () => {
    const fetch = vi.fn(fetchQueResponde({}));
    const controlador = new AbortController();
    controlador.abort();

    const r = await createHttpDepthSource({ fetch, buildUrl: URL_FIXA }).getDepthGrid(
      PEDIDO,
      controlador.signal,
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('CANCELADA');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancelamento durante a requisicao vira CANCELADA, nao TRANSPORTE', async () => {
    const controlador = new AbortController();
    const fonte = createHttpDepthSource({
      fetch: (_url, init) =>
        new Promise((_resolver, rejeitar) => {
          init?.signal?.addEventListener('abort', () =>
            rejeitar(new DOMException('Aborted', 'AbortError')),
          );
        }),
      buildUrl: URL_FIXA,
    });

    const promessa = fonte.getDepthGrid(PEDIDO, controlador.signal);
    controlador.abort();
    const r = await promessa;

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('CANCELADA');
  });

  it('backend pendurado vira TEMPO_ESGOTADO, e nao espera para sempre', async () => {
    vi.useFakeTimers();
    try {
      const fonte = createHttpDepthSource({
        fetch: (_url, init) =>
          new Promise((_resolver, rejeitar) => {
            init?.signal?.addEventListener('abort', () =>
              rejeitar(new DOMException('Aborted', 'AbortError')),
            );
          }),
        buildUrl: URL_FIXA,
        timeoutMs: 5_000,
      });

      const promessa = fonte.getDepthGrid(PEDIDO);
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
    expect(DEPTH_TIMEOUT_MS_DEFAULT).toBe(10_000);
  });

  it('resposta rapida nao e afetada pelo cronometro', async () => {
    vi.useFakeTimers();
    try {
      const fonte = createHttpDepthSource({
        fetch: fetchQueResponde({}),
        buildUrl: URL_FIXA,
        timeoutMs: 50,
      });
      const r = await fonte.getDepthGrid(PEDIDO);
      // Avanca bem depois do limite: o cronometro ja foi limpo, e nada muda.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
