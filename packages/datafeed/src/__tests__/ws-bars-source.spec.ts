/**
 * ws-bars-source — barras ao vivo sobre um WebSocket falso.
 *
 * O que estes testes protegem:
 *  - subscribe entrega as barras que o parser extrai, na ordem;
 *  - barra em formacao e barra fechada chegam pelo callback com a semantica de
 *    `time` (mesma time = revisao; time nova = anterior fechou);
 *  - queda (`onclose`) vira RECONEXAO com backoff, nunca excecao;
 *  - erro de socket e mensagem irreconhecivel nao derrubam a assinatura;
 *  - cancelar para de vez e nao reconecta.
 *
 * O socket e um duble que implementa `WebSocketLike` — cinco campos. O teste
 * dispara os handlers manualmente, o que torna cada transicao explicita.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createWsBarsSource,
  type CloseEventLike,
  type MessageEventLike,
  type TimerLike,
  type WebSocketLike,
} from '../ws-bars-source.js';
import type { Bar, BarsRequest } from '../contracts.js';

const PEDIDO: BarsRequest = {
  instrument: { symbol: 'WINV26' },
  periodSeconds: 60,
};

// ═════════════════════════════════════════════════════════════════════════════
// Duble de socket
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um `WebSocketLike` controlavel pelo teste.
 *
 * Guarda o que foi enviado e expoe metodos para simular os eventos do servidor.
 * Cada `connect` cria uma instancia nova e a registra em `criados`, para que o
 * teste inspecione a reconexao (que troca a instancia).
 */
class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEventLike) => void) | null = null;
  onclose: ((event: CloseEventLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readonly enviados: string[] = [];
  fechado = false;

  send(data: string): void {
    if (this.fechado) throw new Error('socket fechado');
    this.enviados.push(data);
  }

  close(): void {
    this.fechado = true;
  }

  // ── Gatilhos do "servidor" ────────────────────────────────────────────────
  abrir(): void {
    this.onopen?.();
  }
  mensagem(data: unknown): void {
    this.onmessage?.({ data });
  }
  erro(event: unknown = new Error('falha de socket')): void {
    this.onerror?.(event);
  }
  cair(evento: CloseEventLike = {}): void {
    this.onclose?.(evento);
  }
}

/** Uma fabrica que registra cada socket criado, para o teste inspecionar. */
function fabricaDeSockets(): { connect: (url: string) => WebSocketLike; criados: FakeSocket[]; urls: string[] } {
  const criados: FakeSocket[] = [];
  const urls: string[] = [];
  return {
    criados,
    urls,
    connect: (url: string) => {
      urls.push(url);
      const s = new FakeSocket();
      criados.push(s);
      return s;
    },
  };
}

/** Um `TimerLike` de mentira que executa o callback quando o teste mandar. */
function relogioManual(): TimerLike & { rodarPendentes: () => void; pendentes: () => number } {
  let seq = 0;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  return {
    setTimeout: (h) => {
      const id = ++seq;
      timeouts.set(id, h);
      return id;
    },
    clearTimeout: (id) => {
      timeouts.delete(id as number);
    },
    setInterval: (h) => {
      const id = ++seq;
      intervals.set(id, h);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id as number);
    },
    // Dispara os timeouts pendentes (usado para forcar a reconexao agendada).
    rodarPendentes: () => {
      const copia = Array.from(timeouts.entries());
      timeouts.clear();
      for (const [, h] of copia) h();
    },
    pendentes: () => timeouts.size,
  };
}

/** Parser que aceita `{t,o,h,l,c,v?}` e ignora o resto (pong etc.). */
function parseMessage(data: unknown): Bar | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o['tipo'] !== 'bar') return null;
  return {
    time: o['t'] as number,
    open: o['o'] as number,
    high: o['h'] as number,
    low: o['l'] as number,
    close: o['c'] as number,
    ...(typeof o['v'] === 'number' ? { volume: o['v'] } : {}),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Assinatura basica
// ═════════════════════════════════════════════════════════════════════════════

describe('createWsBarsSource — assinatura', () => {
  it('conecta a URL montada e entrega as barras que o parser extrai', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: (r) => `wss://x/${r.instrument.symbol}?tf=${r.periodSeconds}`,
      parseMessage,
      timers: relogioManual(),
    });

    const cancelar = subscribe(PEDIDO, (b) => recebidas.push(b));

    expect(fab.urls[0]).toBe('wss://x/WINV26?tf=60');
    const s = fab.criados[0]!;
    s.abrir();
    s.mensagem({ tipo: 'bar', t: 60, o: 1, h: 2, l: 0, c: 1.5, v: 10 });

    expect(recebidas).toEqual([{ time: 60, open: 1, high: 2, low: 0, close: 1.5, volume: 10 }]);
    cancelar();
  });

  it('mensagem que nao e barra (pong) e ignorada em silencio', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
    });

    subscribe(PEDIDO, (b) => recebidas.push(b));
    const s = fab.criados[0]!;
    s.abrir();
    s.mensagem({ tipo: 'pong' });
    s.mensagem('lixo');

    expect(recebidas).toEqual([]);
  });

  it('um frame com lote de barras entrega todas, na ordem', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      // Parser que devolve array.
      parseMessage: (data) => {
        const arr = data as { time: number }[];
        return arr.map((x) => ({ time: x.time, open: 1, high: 1, low: 1, close: 1 }));
      },
      timers: relogioManual(),
    });

    subscribe(PEDIDO, (b) => recebidas.push(b));
    fab.criados[0]!.abrir();
    fab.criados[0]!.mensagem([{ time: 1 }, { time: 2 }, { time: 3 }]);

    expect(recebidas.map((b) => b.time)).toEqual([1, 2, 3]);
  });

  it('envia a mensagem de assinatura ao abrir, quando fornecida', () => {
    const fab = fabricaDeSockets();
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      buildSubscribeMessage: (r) => JSON.stringify({ sub: r.instrument.symbol }),
      timers: relogioManual(),
    });

    subscribe(PEDIDO, () => {});
    fab.criados[0]!.abrir();

    expect(fab.criados[0]!.enviados).toEqual([JSON.stringify({ sub: 'WINV26' })]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Barra em formacao vs fechada — semantica de `time`
// ═════════════════════════════════════════════════════════════════════════════

describe('createWsBarsSource — barra em formacao vs fechada', () => {
  it('a mesma `time` chega revisada; `time` nova indica que a anterior fechou', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
    });

    subscribe(PEDIDO, (b) => recebidas.push(b));
    const s = fab.criados[0]!;
    s.abrir();

    // Barra do balde 60 sendo revisada: mesma time, close subindo.
    s.mensagem({ tipo: 'bar', t: 60, o: 1, h: 1, l: 1, c: 1 });
    s.mensagem({ tipo: 'bar', t: 60, o: 1, h: 2, l: 1, c: 1.8 });
    // Nova time: a de 60 fechou, comeca a de 120.
    s.mensagem({ tipo: 'bar', t: 120, o: 1.8, h: 1.9, l: 1.7, c: 1.85 });

    // O adaptador entrega tudo na ordem; a distincao formando/fechada e do
    // consumidor via time. As duas primeiras compartilham time; a terceira nao.
    expect(recebidas.map((b) => b.time)).toEqual([60, 60, 120]);
    expect(recebidas[0]!.close).toBe(1);
    expect(recebidas[1]!.close).toBe(1.8);
    expect(recebidas[2]!.time).toBe(120);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Reconexao com backoff
// ═════════════════════════════════════════════════════════════════════════════

describe('createWsBarsSource — reconexao', () => {
  it('apos onclose, reconecta quando o backoff expira', () => {
    const fab = fabricaDeSockets();
    const relogio = relogioManual();
    const eventos: string[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
      onEvent: (e) => eventos.push(e.type),
    });

    subscribe(PEDIDO, () => {});
    expect(fab.criados.length).toBe(1);

    // Abre, depois cai.
    fab.criados[0]!.abrir();
    fab.criados[0]!.cair({ code: 1006, reason: 'queda' });

    // A queda AGENDOU uma reconexao (nao reconectou ainda).
    expect(fab.criados.length).toBe(1);
    expect(eventos).toContain('close');
    expect(eventos).toContain('reconnecting');
    expect(relogio.pendentes()).toBe(1);

    // Expira o backoff: agora sim conecta de novo, num socket NOVO.
    relogio.rodarPendentes();
    expect(fab.criados.length).toBe(2);
  });

  it('o backoff cresce a cada queda seguida e respeita o teto', () => {
    const fab = fabricaDeSockets();
    const relogio = relogioManual();
    const atrasos: number[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
      reconnect: { initialDelayMs: 100, factor: 2, maxDelayMs: 500 },
      onEvent: (e) => {
        if (e.type === 'reconnecting') atrasos.push(e.delayMs);
      },
    });

    subscribe(PEDIDO, () => {});

    // Sequencia de quedas sem abertura bem-sucedida no meio: o backoff sobe.
    for (let i = 0; i < 5; i += 1) {
      const s = fab.criados[fab.criados.length - 1]!;
      s.cair();
      relogio.rodarPendentes();
    }

    // 100, 200, 400, e depois limitado a 500 (o teto), nao 800/1600.
    expect(atrasos.slice(0, 3)).toEqual([100, 200, 400]);
    expect(atrasos[3]).toBe(500);
    expect(atrasos[4]).toBe(500);
  });

  it('uma abertura bem-sucedida zera o backoff', () => {
    const fab = fabricaDeSockets();
    const relogio = relogioManual();
    const atrasos: number[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
      reconnect: { initialDelayMs: 100, factor: 2, maxDelayMs: 5_000 },
      onEvent: (e) => {
        if (e.type === 'reconnecting') atrasos.push(e.delayMs);
      },
    });

    subscribe(PEDIDO, () => {});

    // Cai duas vezes: backoff 100, 200.
    fab.criados[0]!.cair();
    relogio.rodarPendentes();
    fab.criados[1]!.cair();
    relogio.rodarPendentes();

    // Terceira tentativa ABRE com sucesso, depois cai: o backoff volta a 100.
    fab.criados[2]!.abrir();
    fab.criados[2]!.cair();

    expect(atrasos).toEqual([100, 200, 100]);
  });

  it('desiste apos maxRetries e emite giveup', () => {
    const fab = fabricaDeSockets();
    const relogio = relogioManual();
    const eventos: string[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
      reconnect: { initialDelayMs: 10, maxRetries: 2 },
      onEvent: (e) => eventos.push(e.type),
    });

    subscribe(PEDIDO, () => {});

    // Cai repetidamente. Depois de 2 reconexoes, a 3a queda desiste.
    fab.criados[0]!.cair(); // agenda tentativa 1
    relogio.rodarPendentes();
    fab.criados[1]!.cair(); // agenda tentativa 2
    relogio.rodarPendentes();
    fab.criados[2]!.cair(); // atinge o teto -> giveup

    expect(eventos.filter((e) => e === 'reconnecting').length).toBe(2);
    expect(eventos).toContain('giveup');
  });

  it('erro de socket nao derruba a assinatura, so registra', () => {
    const fab = fabricaDeSockets();
    const eventos: string[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
      onEvent: (e) => eventos.push(e.type),
    });

    subscribe(PEDIDO, () => {});
    // Nao lanca:
    expect(() => fab.criados[0]!.erro(new Error('rede'))).not.toThrow();
    expect(eventos).toContain('error');
  });

  it('parser que lanca descarta a mensagem, nao a assinatura', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const eventos: string[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage: (data) => {
        if (data === 'veneno') throw new Error('parser explodiu');
        return parseMessage(data);
      },
      timers: relogioManual(),
      onEvent: (e) => eventos.push(e.type),
    });

    subscribe(PEDIDO, (b) => recebidas.push(b));
    const s = fab.criados[0]!;
    s.abrir();
    expect(() => s.mensagem('veneno')).not.toThrow();
    // A mensagem seguinte, boa, ainda e entregue: a assinatura sobreviveu.
    s.mensagem({ tipo: 'bar', t: 1, o: 1, h: 1, l: 1, c: 1 });

    expect(eventos).toContain('parse-error');
    expect(recebidas.map((b) => b.time)).toEqual([1]);
  });

  it('callback do consumidor que lanca nao mata o socket', () => {
    const fab = fabricaDeSockets();
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
    });

    let vezes = 0;
    subscribe(PEDIDO, () => {
      vezes += 1;
      throw new Error('consumidor com bug');
    });
    const s = fab.criados[0]!;
    s.abrir();
    expect(() => s.mensagem({ tipo: 'bar', t: 1, o: 1, h: 1, l: 1, c: 1 })).not.toThrow();
    expect(() => s.mensagem({ tipo: 'bar', t: 2, o: 1, h: 1, l: 1, c: 1 })).not.toThrow();
    expect(vezes).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cancelamento
// ═════════════════════════════════════════════════════════════════════════════

describe('createWsBarsSource — cancelamento', () => {
  it('cancelar fecha o socket e nao reconecta na queda seguinte', () => {
    const fab = fabricaDeSockets();
    const relogio = relogioManual();
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
    });

    const cancelar = subscribe(PEDIDO, () => {});
    fab.criados[0]!.abrir();
    cancelar();

    expect(fab.criados[0]!.fechado).toBe(true);

    // Uma queda que chegue depois do cancelamento nao agenda reconexao.
    fab.criados[0]!.cair();
    expect(relogio.pendentes()).toBe(0);
    expect(fab.criados.length).toBe(1);
  });

  it('cancelar duas vezes e seguro', () => {
    const fab = fabricaDeSockets();
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
    });

    const cancelar = subscribe(PEDIDO, () => {});
    fab.criados[0]!.abrir();
    cancelar();
    expect(() => cancelar()).not.toThrow();
  });

  it('mensagem que chega apos o cancelamento nao vira barra', () => {
    const fab = fabricaDeSockets();
    const recebidas: Bar[] = [];
    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogioManual(),
    });

    const cancelar = subscribe(PEDIDO, (b) => recebidas.push(b));
    const s = fab.criados[0]!;
    s.abrir();
    cancelar();
    s.mensagem({ tipo: 'bar', t: 1, o: 1, h: 1, l: 1, c: 1 });

    expect(recebidas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Heartbeat
// ═════════════════════════════════════════════════════════════════════════════

describe('createWsBarsSource — heartbeat', () => {
  it('envia ping no intervalo configurado depois de abrir', () => {
    const fab = fabricaDeSockets();
    // Relogio que expoe o disparo dos intervals.
    let intervalHandler: (() => void) | null = null;
    const relogio: TimerLike = {
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: (h) => {
        intervalHandler = h;
        return 1;
      },
      clearInterval: () => {
        intervalHandler = null;
      },
    };

    const subscribe = createWsBarsSource({
      connect: fab.connect,
      buildUrl: () => 'wss://x',
      parseMessage,
      timers: relogio,
      heartbeat: { intervalMs: 1_000, message: 'ping' },
    });

    subscribe(PEDIDO, () => {});
    const s = fab.criados[0]!;
    // Sem heartbeat antes de abrir.
    expect(intervalHandler).toBeNull();
    s.abrir();
    expect(intervalHandler).not.toBeNull();

    intervalHandler!();
    intervalHandler!();
    expect(s.enviados).toEqual(['ping', 'ping']);
  });
});
