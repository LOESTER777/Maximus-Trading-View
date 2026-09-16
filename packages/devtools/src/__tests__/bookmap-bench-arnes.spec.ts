/**
 * Suíte do **arnês** de medição — não da medição. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 12.1. Requisitos 9.1 e 9.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA SUÍTE AFIRMA — E POR QUE ELA RODA NA SUÍTE COMUM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Afirma que o **instrumento** está certo: que o protocolo executa 100
 * repetições, descarta as 10 primeiras e apura o percentil 95 das 90 restantes;
 * que o conjunto de referência tem as 25.823 células com a distribuição medida;
 * que a contabilidade de bytes fecha; e que os dublês de canvas permitem chamar
 * `draw()`.
 *
 * **Não** afirma nada sobre os alvos de tempo — isso é a tarefa 12.2, e depende
 * da máquina. Aqui o cronômetro é sempre **injetado**, com durações conhecidas,
 * de modo que cada asserção tem um valor esperado exato e a suíte não fica
 * dependente da velocidade de quem a roda.
 *
 * Roda na suíte comum de propósito, e custa milissegundos: a aritmética de
 * percentil e o contrato do conjunto de referência são exatamente o tipo de
 * coisa que precisa de regressão permanente, porque um erro ali contamina toda
 * medição futura em silêncio. O que é caro — 100 repetições sobre 25.823 células
 * em quatro alvos — vive em `../__bench__/bookmap-desempenho.bancada.ts`, que a
 * varredura da suíte comum **não alcança**: o padrão de coleta é
 * `src/**\/*.{test,spec,pbt.test}.{ts,tsx}` e `.bancada.ts` não casa com nenhuma
 * dessas terminações.
 *
 * Convenções: identificadores em inglês, comentários e mensagens em pt-BR.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBookmapSessionWarnings } from '@robustus/charts-primitives';
import {
  computeColorScalePair,
  decodeColumnar,
  positiveQuantileOfPair,
} from '@robustus/charts-core';

import {
  BENCH_BALDES,
  BENCH_BALDE_SEG,
  BENCH_CELULAS,
  BENCH_DIA,
  BENCH_FILA_MAX,
  BENCH_FILA_P50,
  BENCH_FILA_P90,
  BENCH_FILA_P99,
  BENCH_FONTE,
  BENCH_LIMITES,
  BENCH_PAREDE_MAX_REAL,
  BENCH_PRECOS,
  BENCH_PRECO_CRUZADO,
  BENCH_SYMBOL,
  BENCH_TICK_SIZE,
  celulasVerbosas,
  gridDeReferencia,
  janelaDoMiolo,
  janelaExtensaoCompleta,
  payloadColunar,
  redefinirConjuntoDeReferencia,
  tamanhoDoGridEmBytes,
} from '../__bench__/bookmap-bench-referencia.js';

import {
  BANCADA_CONSIDERADAS,
  BANCADA_DESCARTADAS,
  BANCADA_QUANTIL,
  BANCADA_REPETICOES,
  BANCADA_VIEWPORT,
  capturarAmbiente,
  emMiB,
  formatarRelatorio,
  medir,
  percentilPorPosto,
  tamanhoDoCorpoEmBytes,
  valorRetido,
  type FonteDeAmbiente,
} from '../__bench__/bookmap-bench-protocolo.js';

import {
  montarCamadaDeBancada,
  relogioParado,
  relogioQueForcaDegradacao,
} from '../__bench__/bookmap-bench-canvas.js';

/** Teto do requisito 9.7, em bytes. */
const TETO_GRID_BYTES = 614_400;

/** Piso do orçamento de células da degradação adaptativa (requisito 9.9). */
const PISO_DE_CELULAS = 500;

/**
 * Cronômetro falso cuja repetição `i` dura exatamente `i` ms.
 *
 * A camada lê o relógio duas vezes por repetição — abertura e fechamento —,
 * então o dublê alterna: a leitura de abertura devolve `0` e a de fechamento
 * devolve o número da repetição. Durações 0, 1, 2, … tornam o percentil apurável
 * na mão, que é o que permite afirmar o valor exato em vez de "algum número".
 */
function cronometroCrescente(): () => number {
  let i = -1;
  let abrindo = true;
  return () => {
    if (abrindo) {
      abrindo = false;
      i += 1;
      return 0;
    }
    abrindo = true;
    return i;
  };
}

beforeEach(() => {
  // Estado de MÓDULO: sem isto, um aviso já emitido por outra suíte deixaria a
  // asserção de degradação passando ou falhando conforme a ordem de execução.
  resetBookmapSessionWarnings();
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · percentil por posto', () => {
  it('adota o posto ⌈q·n⌉−1 e devolve o 86º menor de 90 amostras', () => {
    const noventa = Array.from({ length: 90 }, (_, i) => i + 1);

    // ⌈0,95 × 90⌉ − 1 = 86 − 1 = 85 ⇒ o 86º menor, que aqui vale 86.
    expect(percentilPorPosto(noventa, 0.95)).toBe(86);
    expect(percentilPorPosto(noventa, 0.5)).toBe(45);
    expect(percentilPorPosto(noventa, 1)).toBe(90);
  });

  it('recorta o posto aos extremos e devolve NaN para amostra vazia', () => {
    expect(percentilPorPosto([7], 0.95)).toBe(7);
    expect(percentilPorPosto([1, 2, 3], 0.0001)).toBe(1);
    // Amostra vazia não tem percentil. Zero seria afirmar medição instantânea.
    expect(Number.isNaN(percentilPorPosto([], 0.95))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · protocolo declarado (requisito 9.1)', () => {
  it('as constantes são 100 repetições, 10 descartadas, percentil 95 de 90', () => {
    expect(BANCADA_REPETICOES).toBe(100);
    expect(BANCADA_DESCARTADAS).toBe(10);
    expect(BANCADA_QUANTIL).toBe(0.95);
    expect(BANCADA_CONSIDERADAS).toBe(90);
  });

  it('executa 100 vezes, descarta as 10 primeiras e apura o p95 das 90', () => {
    let execucoes = 0;
    let preparacoes = 0;

    const medicao = medir(
      {
        nome: 'alvo trivial',
        antes: () => {
          preparacoes += 1;
        },
        executar: () => {
          execucoes += 1;
          return execucoes;
        },
      },
      { relogio: cronometroCrescente() },
    );

    // "Descartadas as 10 primeiras" é descartar da ESTATÍSTICA, não deixar de
    // executar: as 10 são o aquecimento e precisam rodar.
    expect(execucoes).toBe(100);
    expect(preparacoes).toBe(100);

    expect(medicao.repeticoes).toBe(100);
    expect(medicao.descartadas).toBe(10);
    expect(medicao.consideradas).toBe(90);
    expect(medicao.protocoloDeclarado).toBe(true);

    // Durações 0..99; consideradas 10..99; ordenadas, o posto 85 vale 95.
    expect(medicao.apuradoMs).toBe(95);
    expect(medicao.minMs).toBe(10);
    expect(medicao.maxMs).toBe(99);
    expect(medicao.medianaMs).toBe(54);
    expect(medicao.mediaMs).toBeCloseTo(54.5, 10);
    expect(medicao.totalMs).toBe(4_905);
  });

  it('marca como fora do protocolo quando repetições ou descarte divergem', () => {
    const medicao = medir(
      { nome: 'reduzido', executar: () => 1 },
      { repeticoes: 12, descartadas: 2, relogio: cronometroCrescente() },
    );

    expect(medicao.repeticoes).toBe(12);
    expect(medicao.consideradas).toBe(10);
    expect(medicao.protocoloDeclarado).toBe(false);
  });

  it('recusa descartar tudo, em vez de apurar sobre amostra vazia', () => {
    expect(() =>
      medir({ nome: 'vazio', executar: () => 1 }, { repeticoes: 5, descartadas: 5 }),
    ).toThrow(/amostra vazia/);
  });

  it('não captura exceção do alvo: alvo que lança falha a bancada', () => {
    expect(() =>
      medir({
        nome: 'explode',
        executar: () => {
          throw new Error('falha proposital');
        },
      }),
    ).toThrow('falha proposital');
  });

  it('retém o último valor produzido, negando a eliminação de código morto', () => {
    medir(
      { nome: 'retido', executar: () => 'ultimo-valor' },
      { repeticoes: 3, descartadas: 1, relogio: cronometroCrescente() },
    );
    expect(valorRetido()).toBe('ultimo-valor');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · conjunto de referência: forma medida', () => {
  it('tem 25.823 células, 570 baldes e 624 preços, sem banco', () => {
    const grid = gridDeReferencia();

    expect(grid.ti.length).toBe(BENCH_CELULAS);
    expect(grid.pi.length).toBe(BENCH_CELULAS);
    expect(grid.bid.length).toBe(BENCH_CELULAS);
    expect(grid.ask.length).toBe(BENCH_CELULAS);
    expect(grid.buy.length).toBe(BENCH_CELULAS);
    expect(grid.sell.length).toBe(BENCH_CELULAS);

    expect(grid.times.length).toBe(BENCH_BALDES);
    expect(grid.prices.length).toBe(BENCH_PRECOS);

    expect(grid.symbol).toBe(BENCH_SYMBOL);
    expect(grid.fonte).toBe(BENCH_FONTE);
    expect(grid.dia).toBe(BENCH_DIA);
    expect(grid.baldeSeg).toBe(BENCH_BALDE_SEG);
  });

  it('honra os invariantes do grid: índices no eixo e eixos crescentes', () => {
    const grid = gridDeReferencia();

    let fora = 0;
    for (let k = 0; k < grid.ti.length; k += 1) {
      const ti = grid.ti[k] ?? -1;
      const pi = grid.pi[k] ?? -1;
      if (ti < 0 || ti >= grid.times.length) fora += 1;
      if (pi < 0 || pi >= grid.prices.length) fora += 1;
    }
    expect(fora).toBe(0);

    let naoCrescente = 0;
    for (let i = 1; i < grid.times.length; i += 1) {
      if ((grid.times[i] ?? 0) <= (grid.times[i - 1] ?? 0)) naoCrescente += 1;
    }
    for (let i = 1; i < grid.prices.length; i += 1) {
      if ((grid.prices[i] ?? 0) <= (grid.prices[i - 1] ?? 0)) naoCrescente += 1;
    }
    expect(naoCrescente).toBe(0);
  });

  it('todo balde e todo preço do eixo tem ao menos uma célula', () => {
    const grid = gridDeReferencia();
    const baldesUsados = new Set<number>();
    const precosUsados = new Set<number>();

    for (let k = 0; k < grid.ti.length; k += 1) {
      baldesUsados.add(grid.ti[k] ?? -1);
      precosUsados.add(grid.pi[k] ?? -1);
    }

    // Eixo com valor sem célula seria eixo maior que o dado — a contagem de
    // 624 preços deixaria de descrever o conjunto.
    expect(baldesUsados.size).toBe(BENCH_BALDES);
    expect(precosUsados.size).toBe(BENCH_PRECOS);
  });

  it('nenhum par (balde, preço) se repete e nenhuma célula é toda-zero', () => {
    const grid = gridDeReferencia();
    const vistos = new Set<number>();
    let repetidos = 0;
    let todasZero = 0;

    for (let k = 0; k < grid.ti.length; k += 1) {
      const chave = (grid.ti[k] ?? 0) * BENCH_PRECOS + (grid.pi[k] ?? 0);
      if (vistos.has(chave)) repetidos += 1;
      vistos.add(chave);

      const soma =
        (grid.bid[k] ?? 0) + (grid.ask[k] ?? 0) + (grid.buy[k] ?? 0) + (grid.sell[k] ?? 0);
      if (soma === 0) todasZero += 1;
    }

    expect(repetidos).toBe(0);
    // Requisito 8.4: célula toda-zero é omitida. Se o conjunto tivesse alguma,
    // ele não representaria um payload real.
    expect(todasZero).toBe(0);
  });

  it('concentra 97,1% das células na banda do miolo', () => {
    const grid = gridDeReferencia();
    let noMiolo = 0;

    for (let k = 0; k < grid.pi.length; k += 1) {
      const preco = grid.prices[grid.pi[k] ?? 0] ?? 0;
      if (preco >= BENCH_LIMITES.precoMiloBase && preco <= BENCH_LIMITES.precoMioloTopo) {
        noMiolo += 1;
      }
    }

    expect(noMiolo).toBe(BENCH_LIMITES.celulasNoMiolo);
    expect(noMiolo / BENCH_CELULAS).toBeCloseTo(0.971, 3);
  });

  it('tem execução só nos baldes cobertos, e cobertura EXEC_PARCIAL', () => {
    const grid = gridDeReferencia();
    let execForaDaCobertura = 0;
    let execDentro = 0;

    for (let k = 0; k < grid.ti.length; k += 1) {
      const temExec = (grid.buy[k] ?? 0) + (grid.sell[k] ?? 0) > 0;
      if (!temExec) continue;
      if ((grid.ti[k] ?? 0) >= BENCH_LIMITES.baldesComExec) execForaDaCobertura += 1;
      else execDentro += 1;
    }

    // Execução fora da janela de cobertura contradiria a própria cobertura
    // declarada, e a hachura do requisito 7.2 passaria a mentir.
    expect(execForaDaCobertura).toBe(0);
    expect(execDentro).toBeGreaterThan(0);

    expect(grid.cobertura?.classe).toBe('EXEC_PARCIAL');
    expect(grid.cobertura?.filaDeMs).toBe(grid.times[0]);
    expect(grid.cobertura?.filaAteMs).toBe(grid.times[BENCH_BALDES - 1]);
    expect(grid.cobertura?.execAteMs).toBe(grid.times[BENCH_LIMITES.baldesComExec - 1]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · conjunto de referência: distribuição medida da fila', () => {
  it('reproduz p50 481, p90 714 e p99 1.131 na união bid ∪ ask', () => {
    const grid = gridDeReferencia();
    const escala = computeColorScalePair(grid.bid, grid.ask, BENCH_CELULAS);

    expect(escala.p50).toBe(BENCH_FILA_P50);
    expect(escala.p99).toBe(BENCH_FILA_P99);
    expect(positiveQuantileOfPair(grid.bid, grid.ask, BENCH_CELULAS, 0.9)).toBe(
      BENCH_FILA_P90,
    );
  });

  it('tem 26.393 quantidades positivas — 570 células com os dois lados', () => {
    const grid = gridDeReferencia();
    let positivos = 0;
    let doisLados = 0;

    for (let k = 0; k < grid.bid.length; k += 1) {
      const b = grid.bid[k] ?? 0;
      const a = grid.ask[k] ?? 0;
      if (b > 0) positivos += 1;
      if (a > 0) positivos += 1;
      if (b > 0 && a > 0) doisLados += 1;
    }

    // Sem célula de dois lados a medição de `draw()` não exercitaria a segunda
    // passada do requisito 1.9, e o tempo apurado subestimaria o desenho real.
    expect(doisLados).toBe(BENCH_LIMITES.celulasDoisLados);
    expect(positivos).toBe(BENCH_LIMITES.filaPositivos);
    expect(positivos).toBe(BENCH_CELULAS + BENCH_LIMITES.celulasDoisLados);
  });

  it('põe o máximo de 36.232 num nível cruzado em 160.040, na venda', () => {
    const grid = gridDeReferencia();

    let maximo = 0;
    let precoDoMaximo = 0;
    let ladoDoMaximo = '';

    for (let k = 0; k < grid.bid.length; k += 1) {
      const preco = grid.prices[grid.pi[k] ?? 0] ?? 0;
      const b = grid.bid[k] ?? 0;
      const a = grid.ask[k] ?? 0;
      if (b > maximo) {
        maximo = b;
        precoDoMaximo = preco;
        ladoDoMaximo = 'BID';
      }
      if (a > maximo) {
        maximo = a;
        precoDoMaximo = preco;
        ladoDoMaximo = 'ASK';
      }
    }

    expect(maximo).toBe(BENCH_FILA_MAX);
    // Venda muito abaixo do mercado: oferta cruzada, artefato e não liquidez.
    // É o caso adversário dos requisitos 2.5 e 2.11.
    expect(precoDoMaximo).toBe(BENCH_PRECO_CRUZADO);
    expect(ladoDoMaximo).toBe('ASK');
  });

  it('limita a maior parede real a 2.442 e a cauda de artefato a 8 células', () => {
    const grid = gridDeReferencia();
    const acimaDaParede: number[] = [];

    for (let k = 0; k < grid.bid.length; k += 1) {
      const b = grid.bid[k] ?? 0;
      const a = grid.ask[k] ?? 0;
      if (b > BENCH_PAREDE_MAX_REAL) acimaDaParede.push(b);
      if (a > BENCH_PAREDE_MAX_REAL) acimaDaParede.push(a);
    }

    expect(acimaDaParede.length).toBe(BENCH_LIMITES.artefatosCruzados);
    // Toda quantidade acima da maior parede real precisa ser artefato, senão o
    // conjunto afirmaria uma parede que a medição do pregão não viu.
    for (const v of acimaDaParede) expect(v).toBeGreaterThan(BENCH_PAREDE_MAX_REAL);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · conjunto de referência: determinismo e rotas equivalentes', () => {
  it('duas construções produzem exatamente os mesmos vetores', () => {
    const primeira = gridDeReferencia();
    redefinirConjuntoDeReferencia();
    const segunda = gridDeReferencia();

    expect(Array.from(segunda.times)).toEqual(Array.from(primeira.times));
    expect(Array.from(segunda.prices)).toEqual(Array.from(primeira.prices));
    expect(Array.from(segunda.ti)).toEqual(Array.from(primeira.ti));
    expect(Array.from(segunda.pi)).toEqual(Array.from(primeira.pi));
    expect(Array.from(segunda.bid)).toEqual(Array.from(primeira.bid));
    expect(Array.from(segunda.ask)).toEqual(Array.from(primeira.ask));
    expect(Array.from(segunda.buy)).toEqual(Array.from(primeira.buy));
    expect(Array.from(segunda.sell)).toEqual(Array.from(primeira.sell));
  });

  it('o payload colunar decodifica no mesmo grid entregue direto', () => {
    const direto = gridDeReferencia();
    const decodificado = decodeColumnar(payloadColunar());

    // O grid das medições não passa pelo decodificador de propósito — a medição
    // do decodificador (requisito 9.6) não pode depender da própria função sob
    // medição para produzir sua entrada. Que as duas rotas concordam é asserção,
    // não suposição.
    expect(decodificado).not.toBeNull();
    if (decodificado === null) return;

    expect(Array.from(decodificado.times)).toEqual(Array.from(direto.times));
    expect(Array.from(decodificado.prices)).toEqual(Array.from(direto.prices));
    expect(Array.from(decodificado.ti)).toEqual(Array.from(direto.ti));
    expect(Array.from(decodificado.pi)).toEqual(Array.from(direto.pi));
    expect(Array.from(decodificado.bid)).toEqual(Array.from(direto.bid));
    expect(Array.from(decodificado.ask)).toEqual(Array.from(direto.ask));
    expect(Array.from(decodificado.buy)).toEqual(Array.from(direto.buy));
    expect(Array.from(decodificado.sell)).toEqual(Array.from(direto.sell));
    expect(decodificado.cobertura).toEqual(direto.cobertura);
  });

  it('a forma verbosa carrega as mesmas 25.823 células, resolvidas em valor', () => {
    const grid = gridDeReferencia();
    const verbosas = celulasVerbosas();

    expect(verbosas.length).toBe(BENCH_CELULAS);

    const primeira = verbosas[0];
    expect(primeira?.tsMs).toBe(grid.times[grid.ti[0] ?? 0]);
    expect(primeira?.preco).toBe(grid.prices[grid.pi[0] ?? 0]);
    expect(primeira?.filaBid).toBe(grid.bid[0]);
    expect(primeira?.filaAsk).toBe(grid.ask[0]);
  });

  it('entrega vetores independentes: mutar um grid não contamina o seguinte', () => {
    const primeiro = gridDeReferencia();
    const antes = primeiro.bid[0] ?? 0;
    primeiro.bid[0] = 999_999;

    const segundo = gridDeReferencia();
    expect(segundo.bid[0]).toBe(antes);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · contabilidade de bytes (requisito 9.7)', () => {
  it('soma eixos e valores sem instantâneo de heap, e fica sob 600 KB', () => {
    const grid = gridDeReferencia();
    const t = tamanhoDoGridEmBytes(grid);

    // 570×8 + 624×8 = 9.552 bytes de eixo.
    expect(t.eixosBytes).toBe(BENCH_BALDES * 8 + BENCH_PRECOS * 8);
    // 4 colunas × 25.823 × 4 bytes.
    expect(t.valoresBytes).toBe(4 * BENCH_CELULAS * 4);
    expect(t.eixosMaisValoresBytes).toBe(t.eixosBytes + t.valoresBytes);
    expect(t.eixosMaisValoresBytes).toBeLessThanOrEqual(TETO_GRID_BYTES);

    // Os índices ficam FORA da medida do requisito; a diferença precisa estar
    // visível para a 12.2 não descobri-la sem contexto.
    expect(t.indicesBytes).toBe(2 * BENCH_CELULAS * 4);
    expect(t.totalBytes).toBe(t.eixosMaisValoresBytes + t.indicesBytes);
    expect(t.totalBytes).toBeGreaterThan(TETO_GRID_BYTES);
  });

  it('mede corpo serializado em bytes UTF-8 e converte para MiB', () => {
    expect(tamanhoDoCorpoEmBytes({ a: 1 })).toBe('{"a":1}'.length);
    // 'ç' ocupa 2 bytes em UTF-8, 1 unidade em UTF-16.
    expect(tamanhoDoCorpoEmBytes('ç')).toBe(4);
    expect(tamanhoDoCorpoEmBytes(undefined)).toBe(0);
    expect(emMiB(1_048_576)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · janelas de dimensões fixas (requisito 9.1)', () => {
  it('o viewport da bancada é fixo e declarado', () => {
    expect(BANCADA_VIEWPORT.larguraPx).toBe(1_400);
    expect(BANCADA_VIEWPORT.alturaPx).toBe(620);
  });

  it('a extensão completa cobre os 570 baldes e o eixo de preço inteiro', () => {
    const grid = gridDeReferencia();
    const janela = janelaExtensaoCompleta(grid, BANCADA_VIEWPORT);

    expect(janela.tsDe).toBe(grid.times[0]);
    expect(janela.tsAte).toBe(grid.times[BENCH_BALDES - 1]);
    expect(janela.precoDe).toBe(grid.prices[0]);
    expect(janela.precoAte).toBe(grid.prices[BENCH_PRECOS - 1]);
    expect(janela.baldesVisiveis).toBe(BENCH_BALDES);
    expect(janela.larguraPx).toBe(BANCADA_VIEWPORT.larguraPx);
    expect(janela.alturaPx).toBe(BANCADA_VIEWPORT.alturaPx);

    // O nível cruzado estica o eixo de preço: milhares de ticks visíveis, o que
    // é justamente o pior caso de agregação do requisito 9.4.
    expect(janela.ticksVisiveis).toBeGreaterThan(BENCH_PRECOS);
  });

  it('a janela do miolo exclui os níveis cruzados e mantém o dia inteiro', () => {
    const grid = gridDeReferencia();
    const janela = janelaDoMiolo(grid, BANCADA_VIEWPORT);

    expect(janela.precoDe).toBe(BENCH_LIMITES.precoMiloBase);
    expect(janela.precoAte).toBe(BENCH_LIMITES.precoMioloTopo);
    expect(janela.baldesVisiveis).toBe(BENCH_BALDES);
    expect(janela.ticksVisiveis).toBe(
      (BENCH_LIMITES.precoMioloTopo - BENCH_LIMITES.precoMiloBase) / BENCH_TICK_SIZE + 1,
    );
    expect(janela.ticksVisiveis).toBeLessThan(
      janelaExtensaoCompleta(grid, BANCADA_VIEWPORT).ticksVisiveis,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · ambiente de apuração (requisito 9.2)', () => {
  const fonteFixa: FonteDeAmbiente = {
    maquina: () => ({ plataforma: 'linux', arquitetura: 'x64', host: 'bancada' }),
    cpu: () => ({ modelo: 'CPU de teste', nucleos: 8 }),
    memoriaBytes: () => 16 * 1_024 * 1_024 * 1_024,
    userAgent: () => 'Mozilla/5.0 (linux) jsdom/20.0.3',
    runtime: () => 'Node v18.20.8',
    agora: () => new Date('2026-08-29T20:00:00.000Z'),
  };

  it('registra máquina, navegador e dimensões do viewport', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT, fonteFixa);

    expect(ambiente.maquina).toBe('linux/x64 · bancada');
    expect(ambiente.cpu).toBe('CPU de teste');
    expect(ambiente.nucleos).toBe(8);
    expect(ambiente.memoriaGiB).toBe(16);
    expect(ambiente.runtime).toBe('Node v18.20.8');
    expect(ambiente.viewport).toEqual({ larguraPx: 1_400, alturaPx: 620 });
    expect(ambiente.capturadoEm).toBe('2026-08-29T20:00:00.000Z');
  });

  it('não apresenta jsdom como navegador', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT, fonteFixa);

    expect(ambiente.ehNavegadorReal).toBe(false);
    expect(ambiente.navegador).toContain('NÃO é navegador real');
  });

  it('declara ausência de navegador quando não há objeto de navegador', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT, {
      ...fonteFixa,
      userAgent: () => null,
    });

    expect(ambiente.ehNavegadorReal).toBe(false);
    expect(ambiente.navegador).toContain('sem objeto de navegador');
  });

  it('reconhece navegador real quando o agente não é jsdom', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT, {
      ...fonteFixa,
      userAgent: () => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0.0.0',
    });

    expect(ambiente.ehNavegadorReal).toBe(true);
    expect(ambiente.navegador).toContain('Chrome/128');
  });

  it('captura o ambiente real sem lançar, e nomeia o relógio usado', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT);

    expect(ambiente.maquina.length).toBeGreaterThan(0);
    expect(ambiente.nucleos).toBeGreaterThan(0);
    expect(['performance.now()', 'Date.now()']).toContain(ambiente.relogio);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · relatório', () => {
  it('traz o ambiente, o protocolo e a situação frente ao teto', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT, {
      maquina: () => ({ plataforma: 'linux', arquitetura: 'x64', host: 'bancada' }),
      cpu: () => ({ modelo: 'CPU de teste', nucleos: 8 }),
      memoriaBytes: () => 16 * 1_024 * 1_024 * 1_024,
      userAgent: () => null,
      runtime: () => 'Node v18.20.8',
      agora: () => new Date('2026-08-29T20:00:00.000Z'),
    });

    const dentro = medir(
      { nome: 'alvo dentro', executar: () => 1 },
      { relogio: cronometroCrescente() },
    );
    const fora = medir(
      { nome: 'alvo reduzido', executar: () => 1 },
      { repeticoes: 20, descartadas: 2, relogio: cronometroCrescente() },
    );

    const texto = formatarRelatorio(ambiente, [dentro, fora], [
      { nome: 'alvo dentro', tetoMs: 1_000, requisito: 'critério de exemplo' },
    ]);

    expect(texto).toContain('AMBIENTE DE APURAÇÃO');
    expect(texto).toContain('linux/x64 · bancada');
    expect(texto).toContain('1400 × 620 px (fixo)');
    expect(texto).toContain('100 repetições');
    expect(texto).toContain('percentil 95 das 90 restantes');
    expect(texto).toContain('DENTRO');
    // Medição fora do protocolo não pode se disfarçar de apuração.
    expect(texto).toContain('fora-do-protocolo');
    expect(texto).toContain('não apresentar como apuração');
    // Sem navegador real, o relatório precisa dizer o que o número não inclui.
    expect(texto).toContain('NÃO inclui');
  });

  it('marca ESTOUR quando o apurado passa do teto', () => {
    const ambiente = capturarAmbiente(BANCADA_VIEWPORT);
    const medicao = medir(
      { nome: 'estourado', executar: () => 1 },
      { relogio: cronometroCrescente() },
    );

    const texto = formatarRelatorio(ambiente, [medicao], [
      { nome: 'estourado', tetoMs: 1, requisito: 'teto de exemplo' },
    ]);

    expect(texto).toContain('ESTOUR');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('arnês · dublês de canvas e de escalas', () => {
  it('permite chamar draw() e emite células sobre o conjunto de referência', () => {
    const grid = gridDeReferencia();
    const janela = janelaDoMiolo(grid, BANCADA_VIEWPORT);
    const camada = montarCamadaDeBancada({
      grid,
      janela,
      tickSize: BENCH_TICK_SIZE,
      maxCells: 3_000,
      minCellPx: 3,
    });

    expect(camada.desenharUmaPassada()).toBe(true);

    // Sem célula emitida não haveria o que cronometrar, e um alvo de 8 ms sobre
    // zero retângulo seria um número sem sentido.
    expect(camada.ctx.retangulos).toBeGreaterThan(0);
    expect(camada.ctx.retangulos).toBeLessThanOrEqual(3_000 * 2);
    // O par salvar/restaurar da biblioteca fecha.
    expect(camada.ctx.saves).toBe(camada.ctx.restores);
  });

  it('separa preparação de desenho, para o cronômetro cercar só o draw', () => {
    const grid = gridDeReferencia();
    const camada = montarCamadaDeBancada({
      grid,
      janela: janelaDoMiolo(grid, BANCADA_VIEWPORT),
      tickSize: BENCH_TICK_SIZE,
      maxCells: 3_000,
      minCellPx: 3,
    });

    camada.prepararPassada();
    const renderer = camada.rendererCorrente();
    expect(renderer).not.toBeNull();

    camada.ctx.zerar();
    renderer?.draw(camada.alvo);
    expect(camada.ctx.retangulos).toBeGreaterThan(0);
  });

  it('com relógio parado, a degradação adaptativa não dispara', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const grid = gridDeReferencia();
      const camada = montarCamadaDeBancada({
        grid,
        janela: janelaDoMiolo(grid, BANCADA_VIEWPORT),
        tickSize: BENCH_TICK_SIZE,
        maxCells: 3_000,
        minCellPx: 3,
        relogio: relogioParado(),
      });

      for (let i = 0; i < 35; i += 1) camada.desenharUmaPassada();

      // É o que mantém o orçamento estável ao longo das 100 repetições de uma
      // medição de tempo: sem isso o percentil misturaria dois orçamentos.
      const reduziu = info.mock.calls.some((c) =>
        String(c[0] ?? '').includes('orçamento de células caiu'),
      );
      expect(reduziu).toBe(false);
    } finally {
      info.mockRestore();
    }
  });

  it('com relógio que força duração, a degradação dispara — a alavanca da 12.2', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const grid = gridDeReferencia();
      const camada = montarCamadaDeBancada({
        grid,
        janela: janelaDoMiolo(grid, BANCADA_VIEWPORT),
        tickSize: BENCH_TICK_SIZE,
        maxCells: 3_000,
        minCellPx: 3,
        // Acima do alvo de 8 ms do requisito 9.3, de forma determinística e
        // independente da velocidade da máquina.
        relogio: relogioQueForcaDegradacao(20),
      });

      // A avaliação só acontece com a janela de 30 passadas cheia.
      for (let i = 0; i < 31; i += 1) camada.desenharUmaPassada();

      const reduziu = info.mock.calls.some((c) =>
        String(c[0] ?? '').includes('orçamento de células caiu'),
      );
      expect(reduziu).toBe(true);
    } finally {
      info.mockRestore();
    }
  });

  it('a alavanca chega ao piso de 500 células e para lá (requisitos 9.9 e 9.10)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const grid = gridDeReferencia();
      const camada = montarCamadaDeBancada({
        grid,
        janela: janelaDoMiolo(grid, BANCADA_VIEWPORT),
        tickSize: BENCH_TICK_SIZE,
        maxCells: 3_000,
        minCellPx: 3,
        relogio: relogioQueForcaDegradacao(20),
      });

      camada.desenharUmaPassada();
      const noInicio = camada.ctx.retangulos;

      // 30 passadas por redução, com a amostra zerada a cada uma: 3.000 → 1.500
      // → 750 → 500. São 90 passadas para alcançar o piso, e é esse o número que
      // a tarefa 12.2 precisa saber para exercitar a degradação inteira.
      for (let i = 1; i < 90; i += 1) camada.desenharUmaPassada();

      camada.ctx.zerar();
      camada.desenharUmaPassada();
      const noPiso = camada.ctx.retangulos;

      // Célula com os dois lados positivos desenha dois retângulos (requisito
      // 1.9), então o teto observável do piso é 2 × 500.
      expect(noPiso).toBeGreaterThan(0);
      expect(noPiso).toBeLessThanOrEqual(2 * PISO_DE_CELULAS);
      expect(noPiso).toBeLessThan(noInicio);

      // Requisito 9.10: no piso não há nova redução, e a camada segue desenhando.
      for (let i = 0; i < 30; i += 1) camada.desenharUmaPassada();
      camada.ctx.zerar();
      camada.desenharUmaPassada();

      expect(camada.ctx.retangulos).toBeGreaterThan(0);
      expect(camada.ctx.retangulos).toBeLessThanOrEqual(2 * PISO_DE_CELULAS);
    } finally {
      info.mockRestore();
    }
  });
});
