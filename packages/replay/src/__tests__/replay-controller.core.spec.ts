/**
 * Testes do controlador de replay.
 *
 * Cobrem: step com clamp, seek, seekToTime, o determinismo de advanceByElapsed
 * (por propriedade, com fast-check), a pausa automatica no fim (nunca loop),
 * revealedBars refletindo a posicao, e serie vazia como estado valido. Ao final,
 * o wrapper ReplayController com um TimerLike FALSO, para provar que o avanco
 * automatico funciona sem relogio real.
 *
 * Convencoes: nomes de teste e comentarios em pt-BR, identificadores em ingles.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  ReplayCore,
  ReplayController,
  type ReplayBar,
  type TimerLike,
} from '../replay-controller.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Serie sintetica de `n` barras com `time` crescente comecando em `t0`, passo
 * `dt`. So o `time` importa para navegacao; OHLC sao placeholders deterministicos.
 */
function serie(n: number, t0 = 1_000, dt = 60): ReplayBar[] {
  const bars: ReplayBar[] = [];
  for (let i = 0; i < n; i++) {
    const time = t0 + i * dt;
    bars.push({ time, open: i, high: i + 1, low: i - 1, close: i, volume: i });
  }
  return bars;
}

/** Timer FALSO: guarda o callback e deixa o teste dispara-lo na mao. */
function timerFalso() {
  let cb: (() => void) | null = null;
  let handleAtual: unknown = null;
  let nextHandle = 1;
  const timer: TimerLike = {
    setInterval(callback: () => void): unknown {
      cb = callback;
      handleAtual = nextHandle++;
      return handleAtual;
    },
    clearInterval(handle: unknown): void {
      if (handle === handleAtual) {
        cb = null;
        handleAtual = null;
      }
    },
  };
  return {
    timer,
    /** Dispara um tick, se o timer estiver ligado. */
    tick(): void {
      cb?.();
    },
    /** `true` se ha timer ligado (callback registrado). */
    get ligado(): boolean {
      return cb !== null;
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// step — clamp em [0, length]
// ═════════════════════════════════════════════════════════════════════════════

describe('step: avanca e volta com clamp em [0, length]', () => {
  it('avanca n barras dentro da faixa', () => {
    const r = new ReplayCore(serie(10));
    r.step(3);
    expect(r.position).toBe(3);
    r.step(2);
    expect(r.position).toBe(5);
  });

  it('volta com n negativo, sem passar de 0', () => {
    const r = new ReplayCore(serie(10), 4);
    r.step(-2);
    expect(r.position).toBe(2);
    r.step(-10);
    expect(r.position).toBe(0);
  });

  it('nao passa do fim (length)', () => {
    const r = new ReplayCore(serie(10), 8);
    r.step(100);
    expect(r.position).toBe(10);
  });

  it('n nao finito nao move; n fracionario e truncado', () => {
    const r = new ReplayCore(serie(10), 3);
    r.step(Number.NaN);
    expect(r.position).toBe(3);
    r.step(Number.POSITIVE_INFINITY);
    expect(r.position).toBe(3);
    r.step(2.9);
    expect(r.position).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// seek — vai direto, com clamp
// ═════════════════════════════════════════════════════════════════════════════

describe('seek: vai direto para a posicao, com clamp', () => {
  it('posiciona no valor pedido dentro da faixa', () => {
    const r = new ReplayCore(serie(20));
    r.seek(7);
    expect(r.position).toBe(7);
  });

  it('clampa acima do fim e abaixo de zero', () => {
    const r = new ReplayCore(serie(20));
    r.seek(999);
    expect(r.position).toBe(20);
    r.seek(-5);
    expect(r.position).toBe(0);
  });

  it('valor nao finito vira 0', () => {
    const r = new ReplayCore(serie(20), 5);
    r.seek(Number.NaN);
    expect(r.position).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// seekToTime — acha a posicao pelo time
// ═════════════════════════════════════════════════════════════════════════════

describe('seekToTime: acha a posicao pelo time (barra revelada = indice + 1)', () => {
  it('time exato de uma barra revela ate ela inclusive', () => {
    // times: 1000, 1060, 1120, 1180, ...
    const r = new ReplayCore(serie(10, 1000, 60));
    r.seekToTime(1120); // barra de indice 2
    expect(r.position).toBe(3); // reveladas: indices 0,1,2
    expect(r.currentBar()?.time).toBe(1120);
  });

  it('time entre duas barras revela ate a anterior', () => {
    const r = new ReplayCore(serie(10, 1000, 60));
    r.seekToTime(1150); // entre 1120 (idx2) e 1180 (idx3)
    expect(r.position).toBe(3);
    expect(r.currentBar()?.time).toBe(1120);
  });

  it('time anterior a primeira barra -> posicao 0 (nada revelado)', () => {
    const r = new ReplayCore(serie(10, 1000, 60), 5);
    r.seekToTime(500);
    expect(r.position).toBe(0);
    expect(r.currentBar()).toBeNull();
  });

  it('time posterior a ultima barra revela tudo', () => {
    const r = new ReplayCore(serie(10, 1000, 60));
    r.seekToTime(999_999);
    expect(r.position).toBe(10);
  });

  it('serie vazia nao quebra', () => {
    const r = new ReplayCore([]);
    r.seekToTime(1000);
    expect(r.position).toBe(0);
  });

  it('encontra a posicao correta para qualquer time (propriedade)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: -100, max: 100_000 }),
        (n, time) => {
          const bars = serie(n, 1000, 60);
          const r = new ReplayCore(bars);
          r.seekToTime(time);

          // A posicao e a contagem de barras com time <= alvo — a definicao
          // independente da busca binaria.
          const esperado = bars.filter((b) => b.time <= time).length;
          expect(r.position).toBe(esperado);
        },
      ),
      { numRuns: 300, seed: 7 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// advanceByElapsed — determinismo e contagem correta (fast-check)
// ═════════════════════════════════════════════════════════════════════════════

describe('advanceByElapsed: avanca o numero certo de barras dado deltaMs e speed', () => {
  it('a 1 barra/s, 1000ms avanca exatamente 1 barra', () => {
    const r = new ReplayCore(serie(100));
    r.setSpeed(1);
    r.play();
    expect(r.advanceByElapsed(1000)).toBe(1);
    expect(r.position).toBe(1);
  });

  it('a 2 barras/s, 100ms nao avanca sozinho mas acumula ate fechar uma barra', () => {
    const r = new ReplayCore(serie(100));
    r.setSpeed(2); // 0,2 barra por tick de 100ms
    r.play();
    expect(r.advanceByElapsed(100)).toBe(0); // carry 0,2
    expect(r.advanceByElapsed(100)).toBe(0); // carry 0,4
    expect(r.advanceByElapsed(100)).toBe(0); // carry 0,6
    expect(r.advanceByElapsed(100)).toBe(0); // carry 0,8
    expect(r.advanceByElapsed(100)).toBe(1); // fecha 1,0 -> avanca 1
    expect(r.position).toBe(1);
  });

  it('nao avanca se pausado, se speed 0, ou se deltaMs invalido', () => {
    const r = new ReplayCore(serie(100));
    r.setSpeed(1);
    // pausado
    expect(r.advanceByElapsed(5000)).toBe(0);
    r.play();
    // speed 0
    r.setSpeed(0);
    expect(r.advanceByElapsed(5000)).toBe(0);
    // deltaMs invalido
    r.setSpeed(1);
    expect(r.advanceByElapsed(Number.NaN)).toBe(0);
    expect(r.advanceByElapsed(-100)).toBe(0);
    expect(r.advanceByElapsed(0)).toBe(0);
    expect(r.position).toBe(0);
  });

  it('e DETERMINISTICO: mesma posicao, speed e deltaMs dao o mesmo resultado (propriedade)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 90 }),
        (speed, deltaMs, start) => {
          const construir = () => {
            const r = new ReplayCore(serie(100), start);
            r.setSpeed(speed);
            r.play();
            return r;
          };

          const a = construir();
          const b = construir();
          const avancoA = a.advanceByElapsed(deltaMs);
          const avancoB = b.advanceByElapsed(deltaMs);

          expect(avancoA).toBe(avancoB);
          expect(a.position).toBe(b.position);

          // Conferencia contra a formula pura, com clamp.
          const esperadoSemClamp = Math.floor((deltaMs / 1000) * speed);
          const esperado = Math.min(start + esperadoSemClamp, 100) - start;
          expect(avancoA).toBe(esperado);
        },
      ),
      { numRuns: 400, seed: 42 },
    );
  });

  it('a soma de avancos por ticks pequenos iguala um avanco unico do mesmo tempo total (propriedade)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 50 }),
        (speed, ticks) => {
          const dt = 100;
          // Serie folgada para nenhum caminho bater no fim e mascarar a soma.
          const total = ticks * dt;
          const barrasNoTotal = Math.floor((total / 1000) * speed);

          const emLotes = new ReplayCore(serie(100_000));
          emLotes.setSpeed(speed);
          emLotes.play();
          let somaLotes = 0;
          for (let i = 0; i < ticks; i++) somaLotes += emLotes.advanceByElapsed(dt);

          const deUmaVez = new ReplayCore(serie(100_000));
          deUmaVez.setSpeed(speed);
          deUmaVez.play();
          const avancoUnico = deUmaVez.advanceByElapsed(total);

          // O carry garante que fatiar o tempo nao perde nem cria barras.
          expect(somaLotes).toBe(barrasNoTotal);
          expect(avancoUnico).toBe(barrasNoTotal);
          expect(emLotes.position).toBe(deUmaVez.position);
        },
      ),
      { numRuns: 200, seed: 99 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Pausa ao chegar no fim — nunca loop
// ═════════════════════════════════════════════════════════════════════════════

describe('pausa automatica no fim (nunca da loop)', () => {
  it('advanceByElapsed pausa ao alcancar o fim e nao volta ao inicio', () => {
    const r = new ReplayCore(serie(5));
    r.setSpeed(1000); // rapido o bastante para estourar o fim num tick
    r.play();
    const avancou = r.advanceByElapsed(1000);
    expect(r.position).toBe(5); // parou no fim, nao deu wrap para 0
    expect(avancou).toBe(5);
    expect(r.playing).toBe(false); // pausou sozinho
    expect(r.atEnd()).toBe(true);
  });

  it('play() no fim nao inicia (nada a tocar)', () => {
    const r = new ReplayCore(serie(5), 5);
    r.play();
    expect(r.playing).toBe(false);
    expect(r.advanceByElapsed(10_000)).toBe(0);
    expect(r.position).toBe(5);
  });

  it('step ao fim tambem pausa', () => {
    const r = new ReplayCore(serie(5), 3);
    r.play();
    // step ainda dentro nao pausa
    r.step(1);
    expect(r.playing).toBe(true);
    // step ate o fim pausa
    r.step(5);
    expect(r.position).toBe(5);
    expect(r.playing).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// revealedBars / currentBar refletem a posicao
// ═════════════════════════════════════════════════════════════════════════════

describe('revealedBars e currentBar refletem a posicao', () => {
  it('revealedBars devolve exatamente as barras de 0 ate position', () => {
    const bars = serie(10);
    const r = new ReplayCore(bars, 4);
    const revelada = r.revealedBars();
    expect(revelada).toHaveLength(4);
    expect(revelada.map((b) => b.time)).toEqual(bars.slice(0, 4).map((b) => b.time));
    expect(r.revealedCount()).toBe(4);
  });

  it('revealedBars e uma copia (mutar o resultado nao afeta o proximo)', () => {
    const r = new ReplayCore(serie(10), 3);
    const primeira = r.revealedBars();
    primeira.pop();
    expect(r.revealedBars()).toHaveLength(3); // inalterado
  });

  it('currentBar e a ultima barra revelada, ou null quando nada revelado', () => {
    const bars = serie(10);
    const r = new ReplayCore(bars);
    expect(r.currentBar()).toBeNull(); // position 0
    r.seek(3);
    expect(r.currentBar()?.time).toBe(bars[2]!.time); // indice position-1
    r.seek(10);
    expect(r.currentBar()?.time).toBe(bars[9]!.time);
  });

  it('revealedBars cresce de uma em uma conforme o replay avanca', () => {
    const r = new ReplayCore(serie(6));
    r.setSpeed(1);
    r.play();
    const contagens: number[] = [r.revealedCount()];
    for (let i = 0; i < 6; i++) {
      r.advanceByElapsed(1000);
      contagens.push(r.revealedCount());
    }
    expect(contagens).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Serie vazia — estado valido
// ═════════════════════════════════════════════════════════════════════════════

describe('serie vazia e estado valido (nao quebra)', () => {
  it('todas as leituras respondem de forma coerente', () => {
    const r = new ReplayCore([]);
    expect(r.length).toBe(0);
    expect(r.position).toBe(0);
    expect(r.revealedBars()).toEqual([]);
    expect(r.revealedCount()).toBe(0);
    expect(r.currentBar()).toBeNull();
    expect(r.atEnd()).toBe(true);
  });

  it('navegacao e play em serie vazia nao lancam e nao movem', () => {
    const r = new ReplayCore([]);
    expect(() => {
      r.step(5);
      r.step(-5);
      r.seek(3);
      r.seekToTime(1000);
      r.play();
      r.advanceByElapsed(5000);
      r.pause();
    }).not.toThrow();
    expect(r.position).toBe(0);
    expect(r.playing).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setBars — troca de serie re-clampa
// ═════════════════════════════════════════════════════════════════════════════

describe('setBars: troca a serie e re-clampa a posicao', () => {
  it('encolher a serie clampa a posicao ao novo fim', () => {
    const r = new ReplayCore(serie(20), 15);
    r.setBars(serie(5));
    expect(r.length).toBe(5);
    expect(r.position).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ReplayController — o wrapper com TimerLike INJETADO (sem relogio real)
// ═════════════════════════════════════════════════════════════════════════════

describe('ReplayController: avanco automatico com timer injetado', () => {
  it('play liga o timer e cada tick avanca o nucleo; pause desliga', () => {
    const fake = timerFalso();
    const avancos: number[] = [];
    const ctrl = new ReplayController(fake.timer, {
      bars: serie(10),
      speed: 10, // 10 barras/s; tick de 100ms => 1 barra por tick
      tickMs: 100,
      onAdvance: (n) => avancos.push(n),
    });

    expect(fake.ligado).toBe(false);
    ctrl.play();
    expect(fake.ligado).toBe(true);

    fake.tick();
    fake.tick();
    fake.tick();
    expect(ctrl.core.position).toBe(3);
    expect(avancos).toEqual([1, 1, 1]);

    ctrl.pause();
    expect(fake.ligado).toBe(false);
  });

  it('o timer se desliga sozinho quando o replay chega ao fim', () => {
    const fake = timerFalso();
    const ctrl = new ReplayController(fake.timer, {
      bars: serie(3),
      speed: 10,
      tickMs: 100,
    });
    ctrl.play();
    fake.tick(); // pos 1
    fake.tick(); // pos 2
    fake.tick(); // pos 3 -> fim, pausa e desliga
    expect(ctrl.core.position).toBe(3);
    expect(ctrl.core.playing).toBe(false);
    expect(fake.ligado).toBe(false);
  });

  it('dispose libera o timer', () => {
    const fake = timerFalso();
    const ctrl = new ReplayController(fake.timer, { bars: serie(10), speed: 5 });
    ctrl.play();
    expect(fake.ligado).toBe(true);
    ctrl.dispose();
    expect(fake.ligado).toBe(false);
  });
});
