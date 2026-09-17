/**
 * Bancada da PARAMETRIZAÇÃO — a biblioteca serve outra fonte sem edição de código?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"os dados que você está lendo são para ser de forma parametrizada, porque em outros projetos
 * os dados vão vir de outras fontes. isso está bem parametrizado?"*
 *
 * A resposta era **não**, e a auditoria achou quatro amarras. Cada caso abaixo prova que uma
 * delas foi desfeita — e reprova se alguém as reintroduzir.
 *
 * ⭐ O critério de "parametrizado" usado aqui é exigente e concreto: **um consumidor com outra
 * fonte consegue obter o comportamento correto passando argumento, sem tocar no fonte da
 * biblioteca e sem depender de constante de módulo que ele não controla.**
 *
 * ⚠️ Não basta o valor default ser bom. Default é palpite calibrado com UMA fonte; a fonte do
 * próximo projeto não participou dessa calibração.
 */
import { describe, expect, it } from 'vitest';
import {
  COBERTURA_MINIMA_DE_AGRESSOR,
  agressorUtilizavel,
  parseBarrasDaMesa,
} from '../robustus-bars.core.js';
import {
  OFFSET_CANDLES_MT5_SEGUNDOS,
  epochParaMt5,
  epochRealDoMt5,
  parseCandlesDoMt5,
} from '../mt5-bridge.core.js';
import { emendarSeries } from '../splice-series.core.js';
import type { Bar } from '../contracts.js';

function barra(time: number, close: number, extra?: Partial<Bar>): Bar {
  return { time, open: close, high: close, low: close, close, ...extra };
}

describe('⭐⭐ AMARRA 1: o offset de fuso era constante de módulo', () => {
  const cru = [{ timestamp: 1000, open: 1, high: 2, low: 0, close: 1 }];

  it('o default continua o valor medido nesta bridge', () => {
    expect(epochRealDoMt5(1000)).toBe(1000 + OFFSET_CANDLES_MT5_SEGUNDOS);
    expect(parseCandlesDoMt5(cru)?.[0]?.time).toBe(1000 + OFFSET_CANDLES_MT5_SEGUNDOS);
  });

  it('⭐ outra fonte com OUTRO frame de tempo é atendida por argumento', () => {
    // Uma bridge em UTC puro: offset zero.
    expect(epochRealDoMt5(1000, 0)).toBe(1000);
    expect(parseCandlesDoMt5(cru, { offsetSegundos: 0 })?.[0]?.time).toBe(1000);
    // Uma fonte 5 h atrás do epoch real.
    expect(parseCandlesDoMt5(cru, { offsetSegundos: 18_000 })?.[0]?.time).toBe(19_000);
  });

  it('a conversão inversa aceita o mesmo offset, e continua sendo inversa', () => {
    for (const off of [0, -10_800, 18_000, 3600]) {
      expect(epochRealDoMt5(epochParaMt5(1_789_560_000, off), off)).toBe(1_789_560_000);
    }
  });

  it('⚠️ o offset entra no RECORTE da janela também (senão o filtro cortaria errado)', () => {
    const corpo = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1 },
      { timestamp: 2000, open: 2, high: 2, low: 2, close: 2 },
    ];
    // Com offset 0, a janela [2000, ∞) mantém só a segunda.
    const b = parseCandlesDoMt5(corpo, { offsetSegundos: 0, deSegundos: 2000 });
    expect(b?.length).toBe(1);
    expect(b?.[0]?.time).toBe(2000);
  });
});

describe('⭐⭐ AMARRA 2: a cobertura de agressor era fixa nos parsers', () => {
  const corpoDaMesa = {
    cols: ['bar_epoch', 'open', 'high', 'low', 'close', 'volume', 'buy_vol', 'sell_vol'],
    // Cobertura de 80 %: reprovada no default de 0,9.
    rows: [[1000, 10, 11, 9, 10, 1000, 500, 300]],
  };

  it('o default recusa cobertura de 80 % (é o limiar auditado)', () => {
    expect(COBERTURA_MINIMA_DE_AGRESSOR).toBe(0.9);
    const b = parseBarrasDaMesa(corpoDaMesa);
    expect(b?.[0]?.volume).toBe(1000);
    expect(b?.[0]).not.toHaveProperty('buyVolume');
  });

  it('⭐ uma fonte com classificação mais frouxa é atendida por argumento', () => {
    const b = parseBarrasDaMesa(corpoDaMesa, { coberturaMinimaDeAgressor: 0.7 });
    expect(b?.[0]?.buyVolume).toBe(500);
    expect(b?.[0]?.sellVolume).toBe(300);
  });

  it('⭐ e uma fonte mais exigente também (limiar acima do default)', () => {
    const quaseExato = {
      cols: corpoDaMesa.cols,
      rows: [[1000, 10, 11, 9, 10, 1000, 600, 350]], // 95 %
    };
    expect(parseBarrasDaMesa(quaseExato)?.[0]?.buyVolume).toBe(600);
    expect(
      parseBarrasDaMesa(quaseExato, { coberturaMinimaDeAgressor: 0.99 })?.[0],
    ).not.toHaveProperty('buyVolume');
  });

  it('⚠️ compatibilidade: o call site antigo com NÚMERO continua valendo', () => {
    // `parseBarrasDaMesa(body, 300)` existe em consumidor e em teste. Quebrá-lo silenciosamente
    // faria o período deixar de chegar, e o colapso de D1 pararia de acontecer.
    const diario = {
      cols: ['bar_epoch', 'open', 'high', 'low', 'close'],
      rows: [
        [86_400, 1, 1, 1, 1],
        [86_400 + 10_800, 2, 2, 2, 2], // mesmo pregão, outra convenção
      ],
    };
    const colapsado = parseBarrasDaMesa(diario, 86_400);
    expect(colapsado?.length).toBe(1);
  });

  it('o parser do MT5 aceita o mesmo ajuste', () => {
    const cru = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1000, buy_volume: 500, sell_volume: 300 },
    ];
    expect(parseCandlesDoMt5(cru)?.[0]).not.toHaveProperty('buyVolume');
    expect(parseCandlesDoMt5(cru, { coberturaMinimaDeAgressor: 0.7 })?.[0]?.buyVolume).toBe(500);
  });

  it('o limiar também é injetável na função de decisão', () => {
    expect(agressorUtilizavel(1000, 400, 400, 0.7)).toBe(true);
    expect(agressorUtilizavel(1000, 400, 400, 0.95)).toBe(false);
  });
});

describe('⭐⭐ AMARRA 3: a EMENDA morava no adaptador do MT5', () => {
  it('⭐ ela é importável SEM tocar em nada de MT5', () => {
    // O import no topo deste arquivo já é a prova: `splice-series.core.js` não exporta nem
    // conhece offset, dialeto de período ou contrato de bridge.
    expect(typeof emendarSeries).toBe('function');
  });

  it('a PRECEDÊNCIA é escolha do consumidor, não regra fixa', () => {
    const hist = [barra(1000, 100), barra(1300, 101), barra(1600, 102)];
    const vivo = [barra(1000, 555), barra(1300, 666), barra(1900, 103)];

    // 'CORTE' (default): o arquivo é canônico no passado.
    const corte = emendarSeries(hist, vivo, 300);
    expect(corte.barras.find((b) => b.time === 1000)?.close).toBe(100);
    expect(corte.descartadasPeloCorte).toBe(2);

    // 'AO_VIVO_VENCE': a fonte ao vivo manda em tudo que ela tem.
    const aoVivo = emendarSeries(hist, vivo, 300, { precedencia: 'AO_VIVO_VENCE' });
    expect(aoVivo.barras.find((b) => b.time === 1000)?.close).toBe(555);
    expect(aoVivo.descartadasPeloCorte).toBe(0);

    // 'ARQUIVO_VENCE': o ao vivo só acrescenta o que falta.
    const arquivo = emendarSeries(hist, vivo, 300, { precedencia: 'ARQUIVO_VENCE' });
    expect(arquivo.barras.find((b) => b.time === 1000)?.close).toBe(100);
    expect(arquivo.barras.find((b) => b.time === 1300)?.close).toBe(101);
    expect(arquivo.barras.find((b) => b.time === 1900)?.close).toBe(103);
  });

  it('⭐ o ALINHAMENTO por balde é sobreponível nos dois sentidos', () => {
    const D = 86_400;
    // Duas fontes que rotulam o mesmo dia com 3 h de diferença.
    const arq = [barra(D, 100)];
    const term = [barra(D + 10_800, 200)];

    // Default acima de um dia: identidade por balde ⇒ é a MESMA barra.
    expect(emendarSeries(arq, term, D).barras.length).toBe(1);

    // Forçando alinhamento fino: a barra do terminal é rejeitada como fora da grade.
    const fino = emendarSeries(arq, term, D, { alinhamentoPorBalde: false });
    expect(fino.foraDaGrade).toBe(1);

    // E o inverso: forçar balde num período intradiário.
    const balde = emendarSeries([barra(0, 1)], [barra(120, 2)], 300, {
      alinhamentoPorBalde: true,
    });
    expect(balde.barras.length).toBe(1);
  });

  it('a TOLERÂNCIA de lacuna é do consumidor (calendário é do mercado)', () => {
    const hist = [barra(0, 1)];
    const vivo = [barra(3 * 86_400, 2)];
    expect(emendarSeries(hist, vivo, 3600).lacuna).not.toBeNull();
    expect(
      emendarSeries(hist, vivo, 3600, { toleranciaDeSegundos: 4 * 86_400 }).lacuna,
    ).toBeNull();
  });
});

describe('⚠️ o que NÃO deve ser parametrizável — e por que', () => {
  it('a INVARIANTE de tempo crescente não é opção', () => {
    // ⭐ Há coisas que não podem ser configuração, e vale registrar a fronteira: o motor assume
    // tempo estritamente crescente em três lugares, e "aceitar tempo repetido" não é uma
    // preferência de fonte — é um gráfico embaralhado. Fica dentro da biblioteca, sem chave.
    const r = emendarSeries([barra(1000, 1)], [barra(1000, 2), barra(1000, 3)], 300);
    const tempos = r.barras.map((b) => b.time);
    expect(new Set(tempos).size).toBe(tempos.length);
  });

  it('os DOIS lados do agressor, ou nenhum — também não é opção', () => {
    const cru = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 100, buy_volume: 70 },
    ];
    // Nem com limiar zero um lado sozinho passa: seria o volume total disfarçado de
    // desequilíbrio, e delta com sinal inventado é pior que delta ausente.
    expect(parseCandlesDoMt5(cru, { coberturaMinimaDeAgressor: 0 })?.[0]).not.toHaveProperty(
      'buyVolume',
    );
  });
});
