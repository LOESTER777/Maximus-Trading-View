/**
 * candle-transforms.core — Heikin-Ashi, Renko e o brick automatico.
 *
 * Duas frentes: casos conhecidos calculados A MAO (a formula tem de bater no
 * numero, nao so "parecer certa") e propriedades com fast-check (as invariantes
 * valem para QUALQUER serie, nao so os exemplos escolhidos). O que importa provar:
 *
 *  - Heikin-Ashi: a formula exata numa serie pequena; e que o range HA contem
 *    sempre o corpo HA (haHigh >= max(haOpen,haClose), haLow <= min).
 *  - Renko: N*brickSize monotonico gera N tijolos; reverter exige 2*brickSize;
 *    determinismo; nunca lanca nem entra em laco com brick invalido.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { heikinAshi, renko, brickSizeAutomatico } from '../candle-transforms.core.js';
import type { CandlestickData } from '../contracts.js';

/** Vela de conveniencia; `time` cresce com o indice para manter ordem. */
function vela(i: number, o: number, h: number, l: number, c: number): CandlestickData {
  return { time: 1000 + i * 60, open: o, high: h, low: l, close: c };
}

// ═════════════════════════════════════════════════════════════════════════════
// Heikin-Ashi — caso conhecido
// ═════════════════════════════════════════════════════════════════════════════

describe('heikinAshi — formula exata', () => {
  it('bate no numero para uma serie pequena calculada a mao', () => {
    const entrada: CandlestickData[] = [
      vela(0, 10, 15, 9, 14),
      vela(1, 14, 18, 13, 17),
      vela(2, 17, 19, 12, 13),
    ];
    const ha = heikinAshi(entrada);
    expect(ha).toHaveLength(3);

    // Barra 0: haClose=(10+15+9+14)/4=12; haOpen=(10+14)/2=12 (semente);
    // haHigh=max(15,12,12)=15; haLow=min(9,12,12)=9.
    expect(ha[0]).toMatchObject({ open: 12, high: 15, low: 9, close: 12, time: 1000 });

    // Barra 1: haClose=(14+18+13+17)/4=15.5; haOpen=(12+12)/2=12;
    // haHigh=max(18,12,15.5)=18; haLow=min(13,12,15.5)=12.
    expect(ha[1]).toMatchObject({ open: 12, high: 18, low: 12, close: 15.5 });

    // Barra 2: haClose=(17+19+12+13)/4=15.25; haOpen=(12+15.5)/2=13.75;
    // haHigh=max(19,13.75,15.25)=19; haLow=min(12,13.75,15.25)=12.
    expect(ha[2]).toMatchObject({ open: 13.75, high: 19, low: 12, close: 15.25 });
  });

  it('descarta vela com NaN sem lancar e sem contaminar a recursao', () => {
    const entrada: CandlestickData[] = [
      vela(0, 10, 15, 9, 14),
      { time: 1060, open: NaN, high: 18, low: 13, close: 17 },
      vela(2, 17, 19, 12, 13),
    ];
    const ha = heikinAshi(entrada);
    // A do meio some; sobram duas, e o haOpen da terceira usa a PRIMEIRA como
    // anterior (nao o NaN).
    expect(ha).toHaveLength(2);
    expect(ha.every((c) => Number.isFinite(c.open) && Number.isFinite(c.close))).toBe(true);
  });

  it('serie vazia devolve serie vazia', () => {
    expect(heikinAshi([])).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Heikin-Ashi — propriedade: o range contem o corpo
// ═════════════════════════════════════════════════════════════════════════════

/** Gera uma serie de velas finitas e coerentes (high>=low, corpo dentro). */
const arbSerie = fc.array(
  fc
    .record({
      base: fc.double({ min: 1, max: 1e5, noNaN: true }),
      span: fc.double({ min: 0, max: 1e4, noNaN: true }),
      fo: fc.double({ min: 0, max: 1, noNaN: true }),
      fc_: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ base, span, fo, fc_ }) => {
      const low = base;
      const high = base + span;
      const open = low + fo * span;
      const close = low + fc_ * span;
      return { open, high, low, close };
    }),
  { minLength: 1, maxLength: 60 },
).map((rows) => rows.map((r, i) => vela(i, r.open, r.high, r.low, r.close)));

describe('heikinAshi — propriedade do range', () => {
  it('haHigh >= max(haOpen,haClose) e haLow <= min(haOpen,haClose)', () => {
    fc.assert(
      fc.property(arbSerie, (serie) => {
        const ha = heikinAshi(serie);
        for (const c of ha) {
          const topo = Math.max(c.open, c.close);
          const base = Math.min(c.open, c.close);
          // Folga de ponto flutuante minima.
          expect(c.high).toBeGreaterThanOrEqual(topo - 1e-9);
          expect(c.low).toBeLessThanOrEqual(base + 1e-9);
        }
      }),
    );
  });

  it('e determinista: mesma entrada, mesma saida', () => {
    fc.assert(
      fc.property(arbSerie, (serie) => {
        expect(heikinAshi(serie)).toEqual(heikinAshi(serie));
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Renko
// ═════════════════════════════════════════════════════════════════════════════

/** Serie cujo close segue exatamente a lista dada. */
function serieDeCloses(closes: number[]): CandlestickData[] {
  return closes.map((c, i) => vela(i, c, c, c, c));
}

describe('renko — regra de tijolo', () => {
  it('um movimento monotonico de N*brickSize gera N tijolos', () => {
    // Semente em 100; sobe ate 105 com brick 1 => 5 tijolos.
    const serie = serieDeCloses([100, 101, 102, 103, 104, 105]);
    const tijolos = renko(serie, 1);
    expect(tijolos).toHaveLength(5);
    // Todos de alta: close > open, bordas consecutivas.
    expect(tijolos.map((t) => t.close)).toEqual([101, 102, 103, 104, 105]);
    expect(tijolos.every((t) => t.close > t.open)).toBe(true);
  });

  it('um salto unico de N*brickSize numa barra gera N tijolos de uma vez', () => {
    const serie = serieDeCloses([100, 103]); // salto de 3 com brick 1
    const tijolos = renko(serie, 1);
    expect(tijolos).toHaveLength(3);
    expect(tijolos.map((t) => t.close)).toEqual([101, 102, 103]);
  });

  it('reverter exige 2*brickSize: 1*brickSize contra a tendencia nao inverte', () => {
    // Sobe para 102 (2 tijolos de alta), depois cai so 1 brick (para 101):
    // NAO deve gerar tijolo de baixa.
    const soUm = renko(serieDeCloses([100, 101, 102, 101]), 1);
    expect(soUm).toHaveLength(2); // so os dois de alta

    // Agora cai 2 bricks a partir de 102 (para 100): reverte, gera 1 tijolo baixa.
    const doisBricks = renko(serieDeCloses([100, 101, 102, 100]), 1);
    expect(doisBricks).toHaveLength(3);
    const ultimo = doisBricks[2]!;
    expect(ultimo.close).toBeLessThan(ultimo.open); // tijolo de baixa
    // Reversao para baixo: abre na borda oposta do tijolo de alta corrente
    // (102-1=101) e fecha um brick abaixo (100).
    expect(ultimo.open).toBe(101);
    expect(ultimo.close).toBe(100);
  });

  it('brickSize invalido devolve [] sem lancar nem laco infinito', () => {
    const serie = serieDeCloses([100, 110, 120]);
    expect(renko(serie, 0)).toEqual([]);
    expect(renko(serie, -1)).toEqual([]);
    expect(renko(serie, NaN)).toEqual([]);
    expect(renko(serie, Infinity)).toEqual([]);
  });

  it('e determinista para a mesma serie e o mesmo brick', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 80 }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (closes, brick) => {
          const serie = serieDeCloses(closes);
          expect(renko(serie, brick)).toEqual(renko(serie, brick));
        },
      ),
    );
  });

  it('cada tijolo tem corpo de exatamente um brick (sem pavio)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 80 }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (closes, brick) => {
          const tijolos = renko(serieDeCloses(closes), brick);
          for (const t of tijolos) {
            expect(Math.abs(Math.abs(t.close - t.open) - brick)).toBeLessThan(1e-6);
            // high/low coincidem com as bordas do corpo.
            expect(t.high).toBeCloseTo(Math.max(t.open, t.close), 6);
            expect(t.low).toBeCloseTo(Math.min(t.open, t.close), 6);
          }
        },
      ),
    );
  });

  /**
   * ⭐ O `time` dos tijolos é ESTRITAMENTE CRESCENTE — e isto é correção de defeito.
   *
   * Vários tijolos podem fechar na MESMA barra (salto grande, ou o par "cancela+abre" de
   * uma reversão). Quando todos carregavam o `time` da barra, três premissas do motor
   * quebravam:
   *
   *  - `SeriesImpl.update` lê `time` igual ao último como "a MESMA barra sendo revisada"
   *    e SUBSTITUI — ao vivo, o segundo tijolo da barra apagava o primeiro;
   *  - `timeToIndex` resolve tempo repetido para o PRIMEIRO índice, então crosshair,
   *    marcador e âncora de desenho colavam todos no primeiro tijolo do grupo;
   *  - os rótulos do eixo repetiam o mesmo instante em colunas vizinhas.
   */
  it('⭐ o tempo dos tijolos é estritamente crescente, mesmo com vários na mesma barra', () => {
    // Um salto de 5 bricks numa única barra: 5 tijolos, todos "da mesma barra".
    const tijolos = renko(serieDeCloses([100, 105]), 1);
    expect(tijolos).toHaveLength(5);
    for (let i = 1; i < tijolos.length; i++) {
      expect(tijolos[i]!.time).toBeGreaterThan(tijolos[i - 1]!.time);
    }
    // O primeiro carrega o tempo da barra que o fechou (a segunda vela: 1000+60); os
    // seguintes, +1 s cada.
    expect(tijolos[0]!.time).toBe(1060);
    expect(tijolos[4]!.time).toBe(1064);
  });

  /**
   * ⚠️ O bump pode ULTRAPASSAR o tempo da barra seguinte: 30 tijolos numa barra de 60 s
   * empurram o tempo para além dela. A regra `max(tempo da barra, anterior + 1)` mantém a
   * monotonicidade nesse caso — se fosse só "tempo da barra + k", o primeiro tijolo da
   * barra seguinte andaria PARA TRÁS e o `setData` do motor reordenaria a série.
   */
  it('o tempo nunca ANDA PARA TRÁS quando o bump passa a barra seguinte', () => {
    const tijolos = renko(serieDeCloses([100, 110, 120, 130]), 1);
    expect(tijolos.length).toBeGreaterThan(20);
    for (let i = 1; i < tijolos.length; i++) {
      expect(tijolos[i]!.time).toBeGreaterThan(tijolos[i - 1]!.time);
    }
  });

  it('propriedade: tempo estritamente crescente para qualquer série', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 60 }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (closes, brick) => {
          const tijolos = renko(serieDeCloses(closes), brick);
          for (let i = 1; i < tijolos.length; i++) {
            expect(tijolos[i]!.time).toBeGreaterThan(tijolos[i - 1]!.time);
          }
        },
      ),
    );
  });
});

/**
 * ⭐ `brickSizeAutomatico` MUDOU DE CRITÉRIO — e o critério antigo era o defeito.
 *
 * Ele derivava o tijolo de uma fração do ÚLTIMO PREÇO (0,2% do close). O usuário
 * reportou *"Renko não está funcionando, aparece apenas uma Barra"*, e era exatamente
 * isso, medido no dado do playground:
 *
 *  - preço em ~130.000 ⇒ tijolo de **259,4**;
 *  - a série inteira (240 velas) tinha amplitude de **645 pontos**;
 *  - 645 / 259 = **2 tijolos** no gráfico todo.
 *
 * A raiz é conceitual: o NÍVEL do preço não diz nada sobre o quanto ele SE MOVE. Dois
 * ativos a 130.000 podem oscilar 600 ou 60.000 pontos por sessão, e a fração do preço
 * daria o mesmo tijolo aos dois. Renko é uma grade de movimento; a grade tem de sair do
 * movimento observado — a amplitude média (`high - low`).
 */
describe('brickSizeAutomatico — deriva do MOVIMENTO, não do nível do preço', () => {
  it('é a variação MÉDIA de fechamento', () => {
    // Closes 100, 110, 130 ⇒ variações 10 e 20 ⇒ média 15.
    expect(brickSizeAutomatico(serieDeCloses([100, 110, 130]))).toBeCloseTo(15, 9);
  });

  /**
   * ⭐ O CASO QUE REPRODUZ O DEFEITO RELATADO.
   *
   * Preço alto (130.000) com movimento pequeno (passo típico de 30 pontos). O critério
   * antigo daria 260 — quase dez vezes o passo — e a série rendia 2 tijolos. O novo dá
   * 30, e a mesma série rende gráfico.
   */
  it('preço ALTO com movimento PEQUENO dá tijolo pequeno', () => {
    const serie = serieDeCloses([130_000, 130_030, 130_000, 130_030]);
    const bs = brickSizeAutomatico(serie);
    expect(bs).toBeCloseTo(30, 9);
    // O critério antigo (0,2% de 130.000) seria 260.
    expect(bs!).toBeLessThan(260);
  });

  it('preço BAIXO com movimento GRANDE dá tijolo grande — o inverso do antigo', () => {
    // Um ativo a 10 que anda 4 por vela: o critério antigo daria 0,02.
    expect(brickSizeAutomatico(serieDeCloses([10, 14, 10, 14]))).toBeCloseTo(4, 9);
  });

  /**
   * ⚠️ A amplitude da vela (com pavio) NÃO serve como medida: no dado medido ela era
   * 111,9 contra 29,3 do passo do close — quase 4x — e a série rendia 10 tijolos em vez
   * de 98. Este caso trava a escolha: pavio grande não pode inflar o tijolo, porque o
   * `renko` desta biblioteca é construído sobre CLOSES.
   */
  it('pavio grande NÃO infla o tijolo — o critério é o close', () => {
    // Closes andam 10; os pavios abrem 200 de amplitude em cada vela.
    const serie: CandlestickData[] = [100, 110, 120].map((c, i) =>
      vela(i, c, c + 100, c - 100, c),
    );
    expect(brickSizeAutomatico(serie)).toBeCloseTo(10, 9);
  });

  it('`multiplo` escala a grade', () => {
    const serie = serieDeCloses([100, 110, 130]);
    expect(brickSizeAutomatico(serie, { multiplo: 2 })).toBeCloseTo(30, 9);
    expect(brickSizeAutomatico(serie, { multiplo: 0.5 })).toBeCloseTo(7.5, 9);
  });

  it('devolve null quando nao ha vela valida (nunca zero)', () => {
    expect(brickSizeAutomatico([])).toBeNull();
    const soNaN: CandlestickData[] = [{ time: 1, open: NaN, high: NaN, low: NaN, close: NaN }];
    expect(brickSizeAutomatico(soNaN)).toBeNull();
  });

  /** ⚠️ Uma vela só não define variação nenhuma. */
  it('uma vela só devolve null', () => {
    expect(brickSizeAutomatico(serieDeCloses([100]))).toBeNull();
  });

  /**
   * ⚠️ Série de preço CONSTANTE dá média zero. Não há grade de movimento a construir
   * sobre movimento nenhum, e devolver zero levaria o `renko` a laço infinito.
   */
  it('serie de preco constante devolve null em vez de zero', () => {
    expect(brickSizeAutomatico(serieDeCloses([100, 100, 100]))).toBeNull();
  });

  /**
   * ⚠️ Vela inválida no meio não pode virar a referência da variação seguinte: a
   * comparação usa o último close VÁLIDO, senão um `NaN` envenenaria a soma inteira e o
   * resultado sairia `null` por um buraco isolado no dado.
   */
  it('vela invalida no meio nao envenena a media', () => {
    const serie: CandlestickData[] = [
      vela(0, 100, 100, 100, 100),
      { time: 1, open: NaN, high: NaN, low: NaN, close: NaN },
      vela(2, 120, 120, 120, 120),
    ];
    expect(brickSizeAutomatico(serie)).toBeCloseTo(20, 9);
  });

  it('multiplo invalido devolve null', () => {
    const serie = serieDeCloses([100, 110]);
    expect(brickSizeAutomatico(serie, { multiplo: 0 })).toBeNull();
    expect(brickSizeAutomatico(serie, { multiplo: -1 })).toBeNull();
    expect(brickSizeAutomatico(serie, { multiplo: NaN })).toBeNull();
  });

  /**
   * ⭐ O ciclo completo do defeito: uma série com o perfil do playground tem de render
   * MUITOS tijolos, não dois. É a asserção que reprova a volta do critério antigo.
   */
  it('serie com o perfil do playground rende DEZENAS de tijolos, nao 2', () => {
    // Caminhada com passo típico de 60 e amplitude de vela ~160, preço em 130.000.
    const serie: CandlestickData[] = [];
    let p = 130_000;
    for (let i = 0; i < 240; i++) {
      const close = p + ((i * 37) % 121) - 60;
      serie.push(vela(i, p, Math.max(p, close) + 80, Math.min(p, close) - 80, close));
      p = close;
    }
    const bs = brickSizeAutomatico(serie);
    expect(bs).not.toBeNull();
    expect(renko(serie, bs!).length).toBeGreaterThan(20);
  });
});
