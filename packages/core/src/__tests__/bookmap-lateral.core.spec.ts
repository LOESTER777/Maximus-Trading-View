/**
 * O PERFIL LATERAL do bookmap — a escada de liquidez por preço.
 *
 * ⭐⭐ Os casos que importam mais não são sobre a soma, e sim sobre as três decisões que mudam o
 * SIGNIFICADO da escada:
 *
 *  1. **a última coluna é a última COM QUANTIDADE**, não a última existente. Num pregão devagar o
 *     balde em formação está vazio; a escada tem de recuar até o último minuto que tem algo a
 *     dizer, senão ela afirma "não há liquidez" onde a verdade é "não houve nada neste minuto";
 *  2. **os dois lados compartilham o `maximo`** — se cada um tivesse o próprio, 800 no bid e 80 no
 *     ask sairiam com barras de comprimento parecido e a comparação de relance passaria a ser
 *     inválida;
 *  3. **no escopo de JANELA a combinação é SOMA**, inclusive para a fila. Não contradiz o `max` da
 *     agregação: `max` responde "qual o pico neste balde" e preserva a parede; somar no TEMPO
 *     responde "quanto passou por este preço", que é a pergunta do escopo.
 *
 * ⚠️ E há um caso de recusa: `null` quando não há nível positivo. É resposta legítima e frequente
 * — o livro não foi gravado em quase todo o histórico da mesa, e a escada de fila fica vazia. Isso
 * é a verdade sobre o dado, não defeito da camada.
 */
import { describe, expect, it } from 'vitest';
import { perfilLateralDoBookmap } from '../bookmap-lateral.core.js';
import type { AggregatedCells } from '../bookmap-types.js';

/**
 * Monta células agregadas a partir de tuplas `[tsMs, preco, bid, ask, buy, sell]`.
 *
 * ⚠️ Aloca as colunas com capacidade MAIOR que `count` de propósito, e as posições excedentes
 * levam valores altos: `count` é a verdade e `length` é capacidade, e um leitor que confundisse os
 * dois veria liquidez que não existe. Há caso que exercita exatamente isso.
 */
function celulas(
  linhas: ReadonlyArray<readonly [number, number, number, number, number, number]>,
  extra = 3,
): AggregatedCells {
  const n = linhas.length;
  const cap = n + extra;
  const tsMs = new Float64Array(cap);
  const preco = new Float64Array(cap);
  const bid = new Float32Array(cap);
  const ask = new Float32Array(cap);
  const buy = new Float32Array(cap);
  const sell = new Float32Array(cap);

  linhas.forEach((l, k) => {
    tsMs[k] = l[0];
    preco[k] = l[1];
    bid[k] = l[2];
    ask[k] = l[3];
    buy[k] = l[4];
    sell[k] = l[5];
  });
  // Lixo além de `count`: quantidade enorme, num instante posterior a tudo.
  for (let k = n; k < cap; k += 1) {
    tsMs[k] = 9_999_999_999_999;
    preco[k] = 1;
    bid[k] = 99_999;
    ask[k] = 99_999;
    buy[k] = 99_999;
    sell[k] = 99_999;
  }

  return { count: n, fatorTempo: 1, fatorPreco: 1, tsMs, preco, bid, ask, buy, sell };
}

const T = 1_756_000_000_000;

describe('perfilLateralDoBookmap — a última coluna', () => {
  it('⭐ usa a coluna de maior instante, e só ela', () => {
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 500, 0, 0, 0],
        [T + 60_000, 100, 200, 0, 0, 0],
        [T + 60_000, 105, 300, 0, 0, 0],
      ]),
      'FILA',
    );
    expect(p).not.toBeNull();
    expect(p!.tsMs).toBe(T + 60_000);
    // A fila de 500 do primeiro balde NÃO entra: ela não é o livro de agora.
    expect(p!.niveis).toEqual([
      { preco: 100, compra: 200, venda: 0 },
      { preco: 105, compra: 300, venda: 0 },
    ]);
    expect(p!.maximo).toBe(300);
  });

  it('⭐⭐ RECUA até a última coluna com quantidade — a coluna vazia não zera a escada', () => {
    // ⚠️ É o defeito que o filtro evita: em pregão devagar o balde em formação chega sem nada, e a
    // escada afirmaria ausência de livro onde a verdade é ausência de negócio NESTE minuto.
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 400, 0, 0, 0],
        [T + 60_000, 100, 0, 0, 0, 0],
        [T + 120_000, 105, 0, 0, 0, 0],
      ]),
      'FILA',
    );
    expect(p).not.toBeNull();
    expect(p!.tsMs).toBe(T);
    expect(p!.niveis).toHaveLength(1);
  });

  it('⭐ os DOIS lados dividem o mesmo `maximo`', () => {
    // Sem isso, 800 no bid e 80 no ask sairiam com comprimentos parecidos.
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 800, 0, 0, 0],
        [T, 105, 0, 80, 0, 0],
      ]),
      'FILA',
    );
    expect(p!.maximo).toBe(800);
  });

  it('soma os dois lados no MESMO preço quando o balde atravessou o spread', () => {
    const p = perfilLateralDoBookmap(celulas([[T, 100, 300, 120, 0, 0]]), 'FILA');
    expect(p!.niveis[0]).toEqual({ preco: 100, compra: 300, venda: 120 });
  });

  it('a saída vem em ordem CRESCENTE de preço, sempre', () => {
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 130, 10, 0, 0, 0],
        [T, 100, 20, 0, 0, 0],
        [T, 115, 30, 0, 0, 0],
      ]),
      'FILA',
    );
    expect(p!.niveis.map((n) => n.preco)).toEqual([100, 115, 130]);
  });
});

describe('perfilLateralDoBookmap — a grandeza', () => {
  it('⭐ `EXECUCAO` lê `buy`/`sell`, e é a grandeza que funciona no histórico da mesa', () => {
    // ⚠️ `bid`/`ask` vêm vazios em quase todo o histórico (o livro não foi gravado). A grandeza é
    // parâmetro por causa disso, e não por gosto.
    const c = celulas([[T, 100, 0, 0, 700, 250]]);
    expect(perfilLateralDoBookmap(c, 'FILA')).toBeNull();
    const p = perfilLateralDoBookmap(c, 'EXECUCAO');
    expect(p!.niveis[0]).toEqual({ preco: 100, compra: 700, venda: 250 });
    expect(p!.maximo).toBe(700);
  });

  it('a fila não contamina a execução, e vice-versa', () => {
    const c = celulas([[T, 100, 900, 900, 10, 20]]);
    expect(perfilLateralDoBookmap(c, 'EXECUCAO')!.maximo).toBe(20);
    expect(perfilLateralDoBookmap(c, 'FILA')!.maximo).toBe(900);
  });
});

describe('perfilLateralDoBookmap — escopo JANELA', () => {
  it('⭐⭐ ACUMULA por preço em todo o período, e `tsMs` fica nulo', () => {
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 100, 0, 0, 0],
        [T + 60_000, 100, 200, 0, 0, 0],
        [T + 120_000, 100, 300, 0, 0, 0],
        [T + 120_000, 105, 50, 0, 0, 0],
      ]),
      'FILA',
      'JANELA',
    );
    expect(p!.tsMs).toBeNull();
    expect(p!.niveis).toEqual([
      { preco: 100, compra: 600, venda: 0 },
      { preco: 105, compra: 50, venda: 0 },
    ]);
    expect(p!.maximo).toBe(600);
  });

  it('⭐ a soma NÃO é `max` — senão o perfil seria o heatmap em outra forma', () => {
    // `max` responde "qual foi o pico"; a soma responde "quanto passou por este preço". A segunda é
    // a pergunta do escopo de janela, e é informação que o heatmap não dá.
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 100, 0, 0, 0],
        [T + 60_000, 100, 100, 0, 0, 0],
      ]),
      'FILA',
      'JANELA',
    );
    expect(p!.niveis[0]?.compra).toBe(200);
  });

  it('sobrevive à última coluna estar vazia, porque não depende dela', () => {
    const p = perfilLateralDoBookmap(
      celulas([
        [T, 100, 400, 0, 0, 0],
        [T + 60_000, 100, 0, 0, 0, 0],
      ]),
      'FILA',
      'JANELA',
    );
    expect(p!.niveis[0]?.compra).toBe(400);
  });
});

describe('perfilLateralDoBookmap — é total, e nunca lança', () => {
  it('⚠️ nível positivo nenhum devolve `null`, e isso é resposta e não erro', () => {
    expect(perfilLateralDoBookmap(celulas([[T, 100, 0, 0, 0, 0]]), 'FILA')).toBeNull();
    expect(perfilLateralDoBookmap(celulas([]), 'FILA')).toBeNull();
  });

  it('⚠️⚠️ `count` é a verdade — o lixo além dele NÃO entra', () => {
    // As colunas do helper têm capacidade maior que `count`, com 99.999 nas posições excedentes.
    // Ler `length` traria liquidez inventada, num instante posterior a tudo — a escada mostraria o
    // livro de um minuto que não existe.
    const p = perfilLateralDoBookmap(celulas([[T, 100, 50, 0, 0, 0]], 5), 'FILA');
    expect(p!.tsMs).toBe(T);
    expect(p!.maximo).toBe(50);
    expect(p!.niveis).toHaveLength(1);
  });

  it('`count` acima do comprimento das colunas é recortado, não estoura', () => {
    const c = celulas([[T, 100, 50, 0, 0, 0]], 0);
    const hostil = { ...c, count: 9_999 } as AggregatedCells;
    const p = perfilLateralDoBookmap(hostil, 'FILA');
    expect(p!.niveis).toHaveLength(1);
  });

  it('`count` não finito ou negativo devolve `null`', () => {
    const c = celulas([[T, 100, 50, 0, 0, 0]]);
    expect(perfilLateralDoBookmap({ ...c, count: Number.NaN }, 'FILA')).toBeNull();
    expect(perfilLateralDoBookmap({ ...c, count: -3 }, 'FILA')).toBeNull();
  });

  it('⚠️ preço ou quantidade não finitos são DESCARTADOS, e o resto sobrevive', () => {
    const c = celulas([
      [T, Number.NaN, 500, 0, 0, 0],
      [T, 100, 200, 0, 0, 0],
    ]);
    c.bid[2] = Number.NaN;
    const p = perfilLateralDoBookmap(c, 'FILA');
    expect(p!.niveis).toEqual([{ preco: 100, compra: 200, venda: 0 }]);
    // ⭐ E o `NaN` não vazou para o denominador do comprimento — seria uma barra que o canvas
    // silenciosamente não pinta, sem erro e sem log.
    expect(Number.isFinite(p!.maximo)).toBe(true);
  });

  it('quantidade NEGATIVA conta como zero em vez de virar barra ao contrário', () => {
    const c = celulas([[T, 100, -400, 0, 0, 0]]);
    expect(perfilLateralDoBookmap(c, 'FILA')).toBeNull();
  });

  it('é determinística: a mesma entrada dá a mesma saída', () => {
    const linhas: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [T, 115, 30, 10, 0, 0],
      [T, 100, 20, 40, 0, 0],
    ];
    const a = perfilLateralDoBookmap(celulas(linhas), 'FILA');
    const b = perfilLateralDoBookmap(celulas(linhas), 'FILA');
    expect(a).toEqual(b);
  });

  it('`maximo` é sempre positivo quando devolve algo', () => {
    const p = perfilLateralDoBookmap(celulas([[T, 100, 1, 0, 0, 0]]), 'FILA');
    expect(p!.maximo).toBeGreaterThan(0);
  });
});
