/**
 * Os indicadores de FLUXO DE ORDEM.
 *
 * ⭐⭐ O que estes testes travam não é a aritmética (ela é uma subtração): é a **disciplina de
 * `null` vs ZERO**. Zero em delta significa *"compra e venda se equilibraram"* — uma leitura de
 * mercado. *"Não há classificação de agressor"* não é leitura nenhuma. Confundir os dois
 * desenharia equilíbrio perfeito num ativo sobre o qual não se sabe nada, e o operador leria
 * absorção onde não há dado.
 *
 * ⚠️ E isso importa aqui mais que em qualquer outro indicador do pacote: `bid_size`/`ask_size`
 * vêm nulos em quase todo o histórico antigo da mesa, e `buy_vol`/`sell_vol` existem em 5.163 dos
 * 6.376 dias do WIN — ou seja, **1.213 dias sem classificação**. Um zero silencioso ali seria
 * 1.213 dias de equilíbrio inventado.
 */
import { describe, it, expect } from 'vitest';
import { createIndicator, type IndicatorBar } from '../index.js';

const T0 = 1_700_000_000;

/** Barras COM classificação de agressor. */
function comAgressor(
  lados: readonly (readonly [number, number])[],
  precoBase = 100,
): IndicatorBar[] {
  return lados.map(([compra, venda], i) => ({
    time: T0 + i * 300,
    open: precoBase + i,
    high: precoBase + i + 1,
    low: precoBase + i - 1,
    close: precoBase + i + 0.5,
    volume: compra + venda,
    buyVolume: compra,
    sellVolume: venda,
  }));
}

/** Barras SEM classificação (o histórico antigo da mesa). */
function semAgressor(quantas: number): IndicatorBar[] {
  return Array.from({ length: quantas }, (_, i) => ({
    time: T0 + i * 300,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1000,
  }));
}

function serie(nome: string, barras: readonly IndicatorBar[], chave: string): (number | null)[] {
  const inst = createIndicator(nome);
  expect(inst, `indicador ausente do registry: ${nome}`).toBeDefined();
  return (inst?.warmup(barras) ?? []).map((p) => p.values[chave] ?? null);
}

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ ausência de agressor é `null`, NUNCA zero', () => {
  it('delta: barra sem classificação não vira equilíbrio', () => {
    const valores = serie('delta', semAgressor(5), 'value');
    expect(valores).toHaveLength(5);
    for (const v of valores) expect(v).toBeNull();
  });

  it('delta % e a média também', () => {
    const barras = semAgressor(5);
    expect(serie('delta_ratio', barras, 'value').every((v) => v === null)).toBe(true);
    expect(serie('delta', barras, 'media').every((v) => v === null)).toBe(true);
  });

  it('⚠️ UM lado presente e o outro ausente é dado QUEBRADO, não "o outro foi zero"', () => {
    // Tratar como zero produziria delta MÁXIMO (100% de um lado) exatamente nas barras em que a
    // ingestão falhou — o pior lugar possível para um valor extremo.
    const meia: IndicatorBar[] = [
      { time: T0, open: 100, high: 101, low: 99, close: 100, volume: 500, buyVolume: 500 },
      { time: T0 + 300, open: 100, high: 101, low: 99, close: 100, volume: 500, sellVolume: 500 },
    ];
    expect(serie('delta', meia, 'value')).toEqual([null, null]);
    expect(serie('delta_ratio', meia, 'value')).toEqual([null, null]);
  });

  it('⚠️ lado NEGATIVO é recusado (dado corrompido, não venda negativa)', () => {
    const ruim: IndicatorBar[] = [
      { time: T0, open: 100, high: 101, low: 99, close: 100, volume: 100, buyVolume: -5, sellVolume: 10 },
    ];
    expect(serie('delta', ruim, 'value')).toEqual([null]);
  });

  it('⚠️ soma ZERO no delta % devolve `null` (não houve disputa a medir)', () => {
    const semNegocio = comAgressor([[0, 0]]);
    expect(serie('delta_ratio', semNegocio, 'value')).toEqual([null]);
    // Mas o delta CRU de 0 contra 0 é um zero legítimo: os dois lados existem e empataram.
    expect(serie('delta', semNegocio, 'value')).toEqual([0]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('delta', () => {
  it('é compra menos venda', () => {
    const valores = serie('delta', comAgressor([[800, 200], [300, 700], [500, 500]]), 'value');
    expect(valores).toEqual([600, -400, 0]);
  });

  it('⭐ a média é saída SEPARADA, e o cru continua cru', () => {
    // Substituir o cru pela média apagaria a barra excepcional — que é exatamente o que a média
    // existe para suavizar, e exatamente o que o operador procura.
    const barras = comAgressor([[1000, 0], [500, 500], [500, 500]]);
    expect(serie('delta', barras, 'value')).toEqual([1000, 0, 0]);
    const inst = createIndicator('delta', { smooth: 3 });
    const pontos = inst?.warmup(barras) ?? [];
    // Média de 3 só emite na terceira: (1000 + 0 + 0) / 3.
    expect(pontos[2]?.values['media']).toBeCloseTo(1000 / 3, 9);
  });

  it('⚠️ barra sem agressor NÃO alimenta a média', () => {
    // Empurrar zero ali criaria uma média que confunde "sem dado" com "equilíbrio", e o erro se
    // arrastaria pela janela inteira depois de a classificação voltar.
    // ⚠️ Tempos EXPLÍCITOS: os helpers começam em T0, e barras com o mesmo tempo são recusadas
    // pela guarda de ordem do esqueleto — o teste mediria uma barra só.
    const misto = [
      ...comAgressor([[900, 100]]),
      ...semAgressor(1).map((b) => ({ ...b, time: T0 + 300 })),
      ...comAgressor([[700, 300]]).map((b) => ({ ...b, time: T0 + 600 })),
    ];
    const inst = createIndicator('delta', { smooth: 2 });
    const pontos = inst?.warmup(misto) ?? [];
    expect(pontos[1]?.values['media']).toBeNull();
    // A média de 2 vê os dois valores CLASSIFICADOS (800 e 400), não 800/0/400.
    expect(pontos[2]?.values['media']).toBeCloseTo((800 + 400) / 2, 9);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ CVD — o delta cumulativo', () => {
  it('acumula, e é isso que faz a divergência existir como forma', () => {
    const valores = serie('cvd', comAgressor([[800, 200], [300, 700], [600, 400]]), 'value');
    expect(valores).toEqual([600, 200, 400]);
  });

  it('⭐⭐ barra sem agressor CONGELA o acumulado — não soma, não zera, não quebra', () => {
    // As três alternativas erradas: somar zero é indistinguível de barra equilibrada (patamar
    // falso); devolver `null` quebraria a linha em duas; reiniciar perderia o acumulado do dia
    // por causa de uma barra sem classificação.
    const misto = [
      ...comAgressor([[800, 200]]),
      ...semAgressor(2).map((b, i) => ({ ...b, time: T0 + (1 + i) * 300 })),
      ...comAgressor([[100, 300]]).map((b) => ({ ...b, time: T0 + 3 * 300 })),
    ];
    expect(serie('cvd', misto, 'value')).toEqual([600, 600, 600, 400]);
  });

  it('⭐ a COBERTURA sai como saída, e é o que distingue platô de ausência', () => {
    const misto = [
      ...comAgressor([[800, 200]]),
      ...semAgressor(1).map((b) => ({ ...b, time: T0 + 300 })),
    ];
    const cobertura = serie('cvd', misto, 'cobertura');
    expect(cobertura[0]).toBeCloseTo(100, 9);
    expect(cobertura[1]).toBeCloseTo(50, 9);
  });

  it('⚠️ NÃO reinicia por sessão, e a ausência é deliberada', () => {
    // Reiniciar exigiria saber onde a sessão começa, e isso é regra de MERCADO (o dia da B3 vira
    // às 18h, o de cripto não vira) que um indicador puro não pode adivinhar. Quem quer o CVD do
    // dia alimenta o indicador com as barras do dia.
    const doisDias = comAgressor([[500, 0], [500, 0]]).map((b, i) => ({
      ...b,
      time: T0 + i * 86_400,
    }));
    expect(serie('cvd', doisDias, 'value')).toEqual([500, 1000]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ delta % — a pressão NORMALIZADA', () => {
  it('vai de −100 a +100', () => {
    const valores = serie('delta_ratio', comAgressor([[1000, 0], [0, 1000], [500, 500]]), 'value');
    expect(valores).toEqual([100, -100, 0]);
  });

  it('⭐⭐ é o que torna dois REGIMES comparáveis — o delta cru não é', () => {
    // Mesma proporção, liquidez de ordem de grandeza diferente: o delta cru dá 8.000 e 80, e
    // nenhum limiar serve para os dois. O ratio dá o mesmo número.
    const abertura = comAgressor([[9000, 1000]]);
    const horaMorta = comAgressor([[90, 10]]);
    expect(serie('delta', abertura, 'value')).toEqual([8000]);
    expect(serie('delta', horaMorta, 'value')).toEqual([80]);
    expect(serie('delta_ratio', abertura, 'value')[0]).toBeCloseTo(80, 9);
    expect(serie('delta_ratio', horaMorta, 'value')[0]).toBeCloseTo(80, 9);
  });

  it('⚠️ normaliza pelos dois lados CLASSIFICADOS, e não pelo `volume` total', () => {
    // Leilão e negócio direto entram no volume total e não têm agressor: dividir pelo total daria
    // um ratio artificialmente pequeno justamente nas barras de leilão, que são as de maior
    // volume do dia.
    const comLeilao: IndicatorBar[] = [
      {
        time: T0,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        // 1.000 agredidos (900/100) mais 9.000 de leilão sem agressor.
        volume: 10_000,
        buyVolume: 900,
        sellVolume: 100,
      },
    ];
    // 80% e não 8%.
    expect(serie('delta_ratio', comLeilao, 'value')[0]).toBeCloseTo(80, 9);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('contrato: os três respeitam o pacote', () => {
  it('estão no registry e declaram categoria de volume', () => {
    for (const nome of ['delta', 'cvd', 'delta_ratio']) {
      const inst = createIndicator(nome);
      expect(inst, nome).toBeDefined();
      expect(inst?.meta.category, nome).toBe('volume');
      expect(inst?.meta.outputs.length ?? 0, nome).toBeGreaterThan(0);
    }
  });

  it('⚠️ barra REPETIDA não é reprocessada (o acumulado não dobraria)', () => {
    const inst = createIndicator('cvd');
    const barra = comAgressor([[500, 100]])[0] as IndicatorBar;
    inst?.update(barra);
    const depoisDeUma = inst?.snapshot()['value'];
    inst?.update(barra);
    expect(inst?.snapshot()['value']).toBe(depoisDeUma);
  });

  it('`preview` não muta o acumulado do CVD', () => {
    const inst = createIndicator('cvd');
    inst?.update(comAgressor([[500, 100]])[0] as IndicatorBar);
    const antes = inst?.snapshot()['value'];
    const proj = comAgressor([[1000, 0]])[0] as IndicatorBar;
    inst?.preview({ ...proj, time: T0 + 300 });
    inst?.preview({ ...proj, time: T0 + 300 });
    expect(inst?.snapshot()['value']).toBe(antes);
  });

  it('⭐ warmup == sequência de updates, com barras sem agressor no meio', () => {
    // A propriedade central do pacote, no caminho que mais poderia quebrá-la: o CVD tem estado
    // acumulado E um ramo que não soma.
    const misto = [
      ...comAgressor([[800, 200]]),
      ...semAgressor(1).map((b) => ({ ...b, time: T0 + 300 })),
      ...comAgressor([[100, 500]]).map((b) => ({ ...b, time: T0 + 600 })),
    ];
    const porWarmup = serie('cvd', misto, 'value');
    const inst = createIndicator('cvd');
    const porUpdate = misto.map((b) => inst?.update(b)['value'] ?? null);
    expect(porUpdate).toEqual(porWarmup);
  });
});
