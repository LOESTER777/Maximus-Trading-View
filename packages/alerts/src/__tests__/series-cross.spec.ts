/**
 * SERIES_CROSS — cruzamento de DUAS séries.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LACUNA QUE ISTO FECHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `CROSS_ABOVE` compara com um `level` FIXO. O alerta mais pedido de uma mesa —
 * "avise quando a EMA de 9 cruzar a de 21", "quando o preço perder a média de 200"
 * — era **inexpressável**: uma média móvel se move a cada barra, e não há nível
 * fixo que a represente. O contorno que sobrava era o consumidor reescrever a
 * condição a cada barra com o valor novo da média, o que quebra a persistência (a
 * condição é o que vai para o layout salvo) e ainda erra o cruzamento na barra em
 * que a reescrita acontece.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS MEDEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O mecanismo é o SINAL DO SPREAD (`value - reference`) passando por zero, e as
 * afirmações difíceis são as de borda:
 *
 *  - as duas séries se movendo (não é "uma cruza um nível");
 *  - encostar exatamente (spread zero) e separar = UM cruzamento, não dois;
 *  - referência AUSENTE durante o aquecimento não pode produzir disparo fantasma
 *    na barra em que o indicador termina de aquecer;
 *  - sem repique: ficar acima por 100 barras dispara uma vez.
 */
import { describe, expect, it } from 'vitest';
import { createAlert, feed } from '../alert-engine.core.js';
import { AlertStore } from '../alert-store.core.js';
import type { Sample, SeriesCrossCondition } from '../conditions.js';

const ACIMA: SeriesCrossCondition = { kind: 'SERIES_CROSS', direction: 'above' };
const ABAIXO: SeriesCrossCondition = { kind: 'SERIES_CROSS', direction: 'below' };
const AMBOS: SeriesCrossCondition = { kind: 'SERIES_CROSS', direction: 'both' };

/** Monta amostras de (rápida, lenta) por barra. `null` na lenta = ainda aquecendo. */
function amostras(pares: ReadonlyArray<readonly [number, number | null]>): Sample[] {
  return pares.map(([value, reference], i) =>
    reference === null
      ? { time: 1_700_000_000 + i * 60, value }
      : { time: 1_700_000_000 + i * 60, value, reference },
  );
}

/** Alimenta a sequência e devolve os tempos em que disparou. */
function disparos(cond: SeriesCrossCondition, pares: ReadonlyArray<readonly [number, number | null]>, mode: 'once' | 'recurring' = 'recurring'): number[] {
  const alerta = createAlert(cond, { mode });
  const out: number[] = [];
  for (const s of amostras(pares)) {
    if (feed(alerta, s).fired) out.push(s.time);
  }
  return out;
}

describe('SERIES_CROSS — as duas séries se movem', () => {
  /**
   * ⭐ O CASO CENTRAL. A rápida vem abaixo e passa por cima da lenta enquanto AMBAS
   * sobem. Nenhum nível fixo descreve isso — é a diferença entre as duas passando
   * por zero.
   */
  it('dispara no cruzamento para CIMA, com as duas subindo', () => {
    const t = disparos(ACIMA, [
      [100, 110],
      [104, 111],
      [109, 112],
      [116, 113], // cruzou aqui: spread -0 -> +3... (antes -3, agora +3)
      [120, 114],
    ]);
    expect(t).toEqual([1_700_000_000 + 3 * 60]);
  });

  it('dispara no cruzamento para BAIXO, simétrico', () => {
    const t = disparos(ABAIXO, [
      [120, 110],
      [116, 112],
      [110, 113], // spread +3 -> -3
      [105, 114],
    ]);
    expect(t).toEqual([1_700_000_000 + 2 * 60]);
  });

  it('`above` IGNORA o cruzamento para baixo, e vice-versa', () => {
    const serie: ReadonlyArray<readonly [number, number | null]> = [
      [100, 110],
      [120, 110], // sobe cruzando
      [100, 110], // desce cruzando
    ];
    expect(disparos(ACIMA, serie)).toHaveLength(1);
    expect(disparos(ABAIXO, serie)).toHaveLength(1);
    expect(disparos(AMBOS, serie)).toHaveLength(2);
  });

  /**
   * ⚠️ SEM REPIQUE. Ficar acima da média por 100 barras é UM cruzamento, não 100
   * disparos. É o bug clássico de alerta, e aqui ele tem uma cara nova: a
   * referência muda a cada barra, então a tentação de comparar "está acima" a cada
   * amostra é ainda maior.
   */
  it('ficar acima por muitas barras dispara UMA vez', () => {
    const pares: Array<readonly [number, number | null]> = [[100, 110]];
    for (let i = 0; i < 100; i++) pares.push([130 + i, 110 + i * 0.1]);
    expect(disparos(ACIMA, pares)).toHaveLength(1);
  });

  /**
   * ⚠️ Encostar exatamente (spread ZERO) e separar é UM cruzamento.
   *
   * A convenção (`<= 0` antes, `> 0` agora) é a mesma do `CROSS_ABOVE`. Sem ela, a
   * barra de toque contaria como cruzamento e a barra seguinte contaria de novo —
   * dois disparos para um evento.
   */
  it('tocar exatamente e separar conta como UM cruzamento', () => {
    const t = disparos(ACIMA, [
      [100, 110],
      [110, 110], // encostou: spread 0 — ainda nao cruzou
      [115, 110], // separou para cima: cruzou AQUI
      [118, 110],
    ]);
    expect(t).toEqual([1_700_000_000 + 2 * 60]);
  });

  it('encostar e voltar para baixo NAO e cruzamento para cima', () => {
    expect(
      disparos(ACIMA, [
        [100, 110],
        [110, 110], // encostou
        [105, 110], // voltou
      ]),
    ).toEqual([]);
  });
});

describe('⚠️ SERIES_CROSS — aquecimento do indicador, sem disparo fantasma', () => {
  /**
   * ⭐ O caso que justifica exigir `reference` nas DUAS amostras.
   *
   * Enquanto a média lenta aquece, o consumidor manda amostra SEM `reference`. Na
   * barra em que ela passa a existir, há uma tentação de tratar a "primeira
   * referência" como um lado anterior — e isso produziria um disparo na barra do
   * fim do aquecimento, que não corresponde a cruzamento nenhum. Aqui a rápida
   * nasce ACIMA da lenta e nunca cruza: o esperado é ZERO disparo.
   */
  it('rapida nasce acima da lenta apos o aquecimento e NAO dispara', () => {
    const t = disparos(ACIMA, [
      [120, null],
      [121, null],
      [122, null],
      [123, 110], // lenta aparece aqui, ja abaixo da rapida
      [124, 111],
      [125, 112],
    ]);
    expect(t).toEqual([]);
  });

  it('o primeiro cruzamento REAL depois do aquecimento e detectado', () => {
    const t = disparos(ACIMA, [
      [100, null],
      [101, null],
      [102, 110], // lenta aparece, rapida abaixo
      [115, 110], // cruzou
    ]);
    expect(t).toEqual([1_700_000_000 + 3 * 60]);
  });

  it('referencia que DESAPARECE no meio interrompe a deteccao sem lancar', () => {
    const alerta = createAlert(ACIMA, { mode: 'recurring' });
    const seq = amostras([
      [100, 110],
      [105, null], // buraco (indicador com null na inversao, ex.: SuperTrend)
      [115, 110], // sem spread anterior: nao cruza
      [120, 110],
    ]);
    const fired = seq.map((s) => feed(alerta, s).fired);
    expect(fired).toEqual([false, false, false, false]);
  });

  it('referencia nao-finita conta como ausente', () => {
    const alerta = createAlert(ACIMA);
    expect(feed(alerta, { time: 1, value: 100, reference: NaN }).fired).toBe(false);
    expect(feed(alerta, { time: 2, value: 120, reference: Number.POSITIVE_INFINITY }).fired).toBe(false);
    expect(feed(alerta, { time: 3, value: 120, reference: 110 }).fired).toBe(false);
  });
});

describe('SERIES_CROSS — modo e re-armamento', () => {
  it('`once` dispara so no primeiro cruzamento', () => {
    const serie: ReadonlyArray<readonly [number, number | null]> = [
      [100, 110],
      [120, 110], // 1o
      [100, 110],
      [120, 110], // 2o — ignorado em `once`
    ];
    expect(disparos(ACIMA, serie, 'once')).toHaveLength(1);
    expect(disparos(ACIMA, serie, 'recurring')).toHaveLength(2);
  });

  /**
   * ⭐ O CASO QUE ENCONTROU UM DEFEITO NO RE-ARMAMENTO.
   *
   * Duas viradas em amostras CONSECUTIVAS: cruza para cima e volta na barra
   * seguinte. O motor exigia que a condição "deixasse de valer" para re-armar — e
   * na barra da volta a condição valia (era um cruzamento para baixo), então ele
   * não re-armava e **engolia o segundo disparo em silêncio**. Numa mesa que opera
   * cruzamento de médias, perder a virada é perder o sinal.
   *
   * A correção: condição de TRANSIÇÃO re-arma na hora (`ehInstantanea`). Repique
   * continua impossível porque permanecer de um lado não satisfaz um cruzamento.
   */
  it('⭐ duas viradas em amostras CONSECUTIVAS disparam as duas', () => {
    const t = disparos(AMBOS, [
      [100, 110],
      [120, 110], // cruzou para cima
      [100, 110], // voltou na barra SEGUINTE
      [130, 110], // e subiu de novo
    ]);
    expect(t).toHaveLength(3);
  });

  /**
   * ⚠️ O contraponto: o re-armamento imediato NAO pode virar repique. Permanecer
   * acima nao satisfaz um cruzamento, entao nao ha o que repicar — mas o caso fica
   * aqui explicito, porque e a propriedade que a correcao poderia ter quebrado.
   */
  it('re-armamento imediato NAO produz repique enquanto fica de um lado', () => {
    const t = disparos(AMBOS, [
      [100, 110],
      [120, 110], // cruzou
      [121, 110],
      [122, 110],
      [123, 110],
    ]);
    expect(t).toHaveLength(1);
  });

  it('`both` + recurring alterna disparo a cada virada', () => {
    const t = disparos(AMBOS, [
      [100, 110],
      [120, 110], // cima
      [118, 110], // segue acima: nao dispara
      [100, 110], // baixo
      [95, 110], // segue abaixo
      [130, 110], // cima
    ]);
    expect(t).toHaveLength(3);
  });

  it('a amostra do disparo vem no resultado, com o tempo do dado', () => {
    const alerta = createAlert(ACIMA);
    feed(alerta, { time: 10, value: 100, reference: 110 });
    const r = feed(alerta, { time: 20, value: 120, reference: 110 });
    expect(r.fired).toBe(true);
    expect(r.sample).toEqual({ time: 20, value: 120, reference: 110 });
  });
});

describe('SERIES_CROSS na coleção — convive com alerta de nível', () => {
  /**
   * A mesma amostra alimenta os dois tipos: um cruzamento de nível fixo e um
   * cruzamento de séries. É o uso real — a mesa tem "avise em 130.100" e "avise
   * quando a rápida cruzar a lenta" ao mesmo tempo.
   */
  it('feedAll dispara os dois tipos na mesma sequencia', () => {
    const store = new AlertStore();
    store.add('nivel', createAlert({ kind: 'CROSS_ABOVE', level: 115 }));
    store.add('medias', createAlert(ACIMA));

    const eventos = store.feedAll(
      amostras([
        [100, 110],
        [120, 110],
      ]),
    );
    expect(eventos.map((e) => e.key)).toEqual(['nivel', 'medias']);
  });

  it('alerta de nivel IGNORA a referencia — campo novo nao muda o antigo', () => {
    const store = new AlertStore();
    store.add('nivel', createAlert({ kind: 'CROSS_ABOVE', level: 115 }));
    // A referencia em 1000 nao tem efeito nenhum sobre o CROSS_ABOVE.
    const eventos = store.feedAll(
      amostras([
        [100, 1000],
        [120, 1000],
      ]),
    );
    expect(eventos).toHaveLength(1);
  });
});
