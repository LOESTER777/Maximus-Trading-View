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
  MAX_BARRAS_CAMINHO_PROFUNDO_MT5,
  MAX_BARRAS_POR_CONSULTA_MT5,
  OFFSET_CANDLES_MT5_SEGUNDOS,
  epochParaMt5,
  epochRealDoMt5,
  montarCaminhoDeCandlesMt5,
  parseCandlesDoMt5,
} from '../mt5-bridge.core.js';
import { emendarSeries } from '../splice-series.core.js';
import {
  PERFIL_DA_MESA,
  SESSAO_24_7,
  SESSAO_B3_FUTUROS,
  avaliarQualidade,
} from '../qualidade-da-fonte.core.js';
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
    // ⚠️ Preços PRÓXIMOS de propósito: a guarda de coerência (ver AMARRA 5) recusa fontes que
    // divergem além de 0,1 %, e com 100 contra 555 ela barraria a emenda antes de a precedência
    // ser exercida. A diferença aqui é de centésimos, como duas agregações do mesmo dado.
    const hist = [barra(1000, 100), barra(1300, 101), barra(1600, 102)];
    const vivo = [barra(1000, 100.05), barra(1300, 101.05), barra(1900, 103)];

    // 'CORTE' (default): o arquivo é canônico no passado.
    const corte = emendarSeries(hist, vivo, 300);
    expect(corte.barras.find((b) => b.time === 1000)?.close).toBe(100);
    expect(corte.descartadasPeloCorte).toBe(2);

    // 'AO_VIVO_VENCE': a fonte ao vivo manda em tudo que ela tem.
    const aoVivo = emendarSeries(hist, vivo, 300, { precedencia: 'AO_VIVO_VENCE' });
    expect(aoVivo.barras.find((b) => b.time === 1000)?.close).toBe(100.05);
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

describe('⭐⭐ AMARRA 5: emendar fontes INCOMPATÍVEIS produzia degrau silencioso', () => {
  /**
   * ⚠️ Achado real: o arquivo da mesa e o terminal, alinhados corretamente no tempo (as duas
   * fontes abrem 09:00 BRT, 98 % das barras casando), ainda assim discordam do PREÇO em 0,16 % e
   * do VOLUME por um fator de 9. São séries diferentes do mesmo mercado.
   *
   * Emendar assim desenha um degrau de preço na junção e um salto de volume de uma ordem de
   * grandeza — os dois indistinguíveis de movimento de mercado para quem olha o gráfico.
   */
  const P = 300;
  // Mesmo instante nas duas fontes, com preço divergindo ~0,5 % e volume por fator de 9.
  const hist = [
    barra(1000, 187_675, { volume: 323_151 }),
    barra(1300, 187_940, { volume: 242_259 }),
    barra(1600, 187_950, { volume: 245_548 }),
  ];
  const vivoDivergente = [
    barra(1300, 188_620, { volume: 2_180_000 }),
    barra(1600, 188_800, { volume: 2_209_000 }),
    barra(1900, 188_690, { volume: 1_500_000 }),
  ];

  it('⭐⭐ detecta a divergência e NÃO emenda (default: só o histórico)', () => {
    const r = emendarSeries(hist, vivoDivergente, P);
    expect(r.coerencia).not.toBeNull();
    expect(r.coerencia?.compativeis).toBe(false);
    expect(r.coerencia?.motivo).toContain('preço');
    // A série é só o histórico — sem degrau.
    expect(r.barras.length).toBe(3);
    expect(r.doAoVivo).toBe(0);
    expect(r.parcialEm).toBeNull();
  });

  it('o motivo distingue divergência de PREÇO de divergência de VOLUME', () => {
    // Preço igual, volume 9x: o motivo tem de falar de volume.
    const soVolume = [
      barra(1300, 187_940, { volume: 2_180_000 }),
      barra(1600, 187_950, { volume: 2_209_000 }),
    ];
    const r = emendarSeries(hist, soVolume, P);
    expect(r.coerencia?.compativeis).toBe(false);
    expect(r.coerencia?.motivo).toContain('volume');
  });

  it('⭐ `SO_AO_VIVO` para quem confia mais na fonte de tempo real', () => {
    const r = emendarSeries(hist, vivoDivergente, P, { aoDivergir: 'SO_AO_VIVO' });
    expect(r.barras.length).toBe(3);
    expect(r.doAoVivo).toBe(3);
    expect(r.barras[0]?.close).toBe(188_620);
  });

  it('⭐ `EMENDAR_MESMO_ASSIM` para quem já sabe e quer os dois', () => {
    const r = emendarSeries(hist, vivoDivergente, P, { aoDivergir: 'EMENDAR_MESMO_ASSIM' });
    expect(r.coerencia?.compativeis).toBe(false);
    // A emenda aconteceu: a barra nova de 1900 entrou.
    expect(r.barras.some((b) => b.time === 1900)).toBe(true);
  });

  it('⚠️ fontes COMPATÍVEIS emendam normalmente (a guarda não é um bloqueio cego)', () => {
    const vivoOk = [
      barra(1600, 187_960, { volume: 246_000 }),
      barra(1900, 188_010, { volume: 190_000 }),
    ];
    const r = emendarSeries(hist, vivoOk, P);
    expect(r.coerencia?.compativeis).toBe(true);
    expect(r.coerencia?.motivo).toBeNull();
    expect(r.doAoVivo).toBe(1);
  });

  it('⚠️ SEM sobreposição não há o que medir — e isso NÃO é incompatibilidade', () => {
    // O caso normal e desejável: o ao vivo traz só o dia que o arquivo não tem.
    const r = emendarSeries(hist, [barra(1900, 188_690, { volume: 1_500_000 })], P);
    expect(r.coerencia).toBeNull();
    expect(r.doAoVivo).toBe(1);
  });

  it('os limiares são PARAMETRIZADOS (outra fonte, outra tolerância)', () => {
    // Com tolerância frouxa, a mesma divergência de preço passa.
    const r = emendarSeries(hist, vivoDivergente, P, {
      toleranciaRelativaDePreco: 0.05,
      razaoDeVolumeAceitavel: [0.1, 20],
    });
    expect(r.coerencia?.compativeis).toBe(true);
    expect(r.doAoVivo).toBe(1);
  });
});

describe('⭐⭐ AMARRA 6: a escolha do par diário de D1 era decisão embutida', () => {
  /**
   * A base grava DOIS registros para o mesmo pregão, de escritores diferentes. A colapsagem
   * mantinha o mais tardio sem opção, e a escolha estava justificada por um argumento circular
   * (comparava os dois suspeitos entre si).
   *
   * ⭐ Aferido em 18/09/2026 contra o dia apurado somando `1h` — âncora EXTERNA às duas
   * convenções: o mais tardio acerta o fechamento em 40/40 dias no WIN, 43/43 no PETR4, e
   * acerta no WDO. Default confirmado.
   *
   * ⚠️ E o custo apareceu: no WDO **201 dos 785 pares** têm o agressor no registro mais CEDO.
   * Manter o tardio deixa 201 dias diários sem delta. Quem lê fluxo em D1 precisa da outra
   * escolha, e agora ela é um ARGUMENTO.
   */
  const corpoComPar = {
    cols: ['bar_epoch', 'open', 'high', 'low', 'close', 'volume', 'buy_vol', 'sell_vol'],
    rows: [
      // 00:00Z: tem agressor, volume maior — o caso do WDO.
      [1_774_915_200, 5180, 5195, 5170, 5185.5, 695_857, 340_000, 345_000],
      // 03:00Z: fechamento canônico, mas sem agressor e com 25 % do volume.
      [1_774_926_000, 5180, 5195, 5170, 5186.0, 207_586, null, null],
    ],
  };

  it('o default MANTÉM o mais tardio — é ele que acerta o fechamento', () => {
    const barras = parseBarrasDaMesa(corpoComPar, { periodSeconds: 86_400 });
    expect(barras).toHaveLength(1);
    expect(barras?.[0]?.close).toBe(5186.0);
    expect(barras?.[0]).not.toHaveProperty('buyVolume');
  });

  it('⭐ `PREFERIR_AGRESSOR` troca 0,03 % de fechamento por 201 dias de delta', () => {
    const barras = parseBarrasDaMesa(corpoComPar, {
      periodSeconds: 86_400,
      politicaDeD1: 'PREFERIR_AGRESSOR',
    });
    expect(barras).toHaveLength(1);
    expect(barras?.[0]?.close).toBe(5185.5);
    expect(barras?.[0]?.buyVolume).toBe(340_000);
  });

  it('⚠️ com agressor nos DOIS a política não inverte: não há informação nova', () => {
    const corpo = {
      cols: corpoComPar.cols,
      rows: [
        [1_774_915_200, 1, 2, 0, 10, 100, 50, 50],
        [1_774_926_000, 1, 2, 0, 20, 100, 60, 40],
      ],
    };
    for (const politica of ['MAIS_TARDIO', 'PREFERIR_AGRESSOR'] as const) {
      const barras = parseBarrasDaMesa(corpo, { periodSeconds: 86_400, politicaDeD1: politica });
      expect(barras?.[0]?.close).toBe(20);
    }
  });

  it('⚠️ nenhuma política SOMA os registros — isso fabricaria volume inexistente', () => {
    const soma = 695_857 + 207_586;
    for (const politica of ['MAIS_TARDIO', 'PREFERIR_AGRESSOR'] as const) {
      const barras = parseBarrasDaMesa(corpoComPar, {
        periodSeconds: 86_400,
        politicaDeD1: politica,
      });
      expect(barras?.[0]?.volume).not.toBe(soma);
    }
  });

  it('⚠️ em 5min a colapsagem não acontece: os baldes são inequívocos', () => {
    const corpo = {
      cols: corpoComPar.cols,
      rows: [
        [1_774_915_200, 1, 2, 0, 10, 100, 50, 50],
        [1_774_915_500, 1, 2, 0, 20, 100, 50, 50],
      ],
    };
    expect(parseBarrasDaMesa(corpo, { periodSeconds: 300 })).toHaveLength(2);
  });
});

describe('⭐⭐ AMARRA 7: o conhecimento de QUALIDADE da fonte era comentário, não dado', () => {
  /**
   * A janela em que a base foi conferida, os períodos que ela não materializa e o mês em que o
   * agressor quebrou estavam escritos em prosa nos comentários — inúteis para o consumidor e
   * impossíveis de trocar por outra fonte.
   *
   * ⭐ Agora é `PerfilDeQualidade`, um VALOR. `PERFIL_DA_MESA` é o desta base; outro projeto
   * passa o seu sem tocar no fonte da biblioteca.
   */
  it('⭐ um perfil VAZIO não impõe política nenhuma', () => {
    const laudo = avaliarQualidade(
      { nome: 'outra fonte' },
      { periodSeconds: 1800, barras: [barra(1000, 1)] },
    );
    expect(laudo.nivel).toBe('OK');
    expect(laudo.motivos).toEqual([]);
  });

  it('⭐ o MESMO período reprovado numa fonte é confiável na outra', () => {
    const barras = [barra(1_700_000_000, 1)];
    expect(avaliarQualidade(PERFIL_DA_MESA, { periodSeconds: 1800, barras }).nivel).toBe(
      'REPROVADO',
    );
    expect(
      avaliarQualidade(
        {
          nome: 'fonte que materializa 30min',
          regrasPorPeriodo: [{ periodSeconds: 1800, situacao: 'CONFIAVEL' }],
        },
        { periodSeconds: 1800, barras },
      ).nivel,
    ).toBe('OK');
  });

  it('⚠️ a SESSÃO é do ativo, não da biblioteca: 24/7 não tem fim de semana inválido', () => {
    // Fixo em "futuros não abrem sábado" apagaria as 948 barras diárias legítimas do BTC.
    const domingo = 1_780_185_600; // 31/05/2026 00:00Z
    const barras = [barra(domingo, 1)];
    expect(
      avaliarQualidade(
        { nome: 'b3', sessao: SESSAO_B3_FUTUROS, fracaoToleradaForaDaSessao: 0 },
        { periodSeconds: 86_400, barras },
      ).foraDaSessao,
    ).toHaveLength(1);
    expect(
      avaliarQualidade(
        { nome: 'cripto', sessao: SESSAO_24_7, fracaoToleradaForaDaSessao: 0 },
        { periodSeconds: 86_400, barras },
      ).foraDaSessao,
    ).toHaveLength(0);
  });
});

describe('⭐⭐⭐ AMARRA 8: "o passado profundo é do arquivo" era regra embutida', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * A PREMISSA QUE DEIXOU DE VALER
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * O adaptador da bridge tinha duas decisões escritas como se fossem leis da natureza:
   * *"o volume vem sempre"* e *"o passado profundo é trabalho do arquivo"*. As duas se apoiavam
   * na mesma premissa — que o arquivo é íntegro.
   *
   * ⚠️ Medido em 18/09/2026 contra o `traded_qty` oficial da B3: o arquivo tinha 100 % do volume
   * do mercado até mai/2026 e passou a ter **21 % a 31 %** de jun/2026 em diante. Com um quinto
   * dos negócios a amplitude do dia sai 3–4x menor que a real, porque os negócios que faltam são
   * os que fazem a máxima e a mínima. O operador viu isso na tela antes de qualquer teste pegar.
   *
   * ⭐ As duas decisões viraram ARGUMENTO. E a fronteira segue clara: nada aqui muda o default.
   */
  const cruSemFluxo = [
    { timestamp: 1000, open: 1, high: 2, low: 0, close: 1, volume: 4104 },
    { timestamp: 1300, open: 1, high: 2, low: 0, close: 1, volume: 4436 },
  ];

  it('⭐ `omitirVolume` some com o campo em vez de entregar tick volume', () => {
    // ⚠️ `/candles` devolve tick volume; `/historical-flow`, contratos. Medido na mesma barra:
    // 4.104 contra 36.819. Emendar os dois desenha um degrau de 10x no histograma, indistinguível
    // de explosão de liquidez.
    const comVolume = parseCandlesDoMt5(cruSemFluxo);
    expect(comVolume?.[0]).toHaveProperty('volume', 4104);

    const sem = parseCandlesDoMt5(cruSemFluxo, { omitirVolume: true });
    expect(sem).toHaveLength(2);
    // ⭐ AUSENTE, não zero: `undefined` é "não sei" e o histograma não desenha; zero seria a
    // afirmação de que não houve negócio.
    expect(sem?.[0]).not.toHaveProperty('volume');
    expect(sem?.[1]).not.toHaveProperty('volume');
    // O PREÇO — que é o motivo de usar esta rota — continua intacto.
    expect(sem?.[0]?.close).toBe(1);
    expect(sem?.[0]?.high).toBe(2);
  });

  it('⚠️ o default NÃO omite: quem não pede nada continua recebendo o que recebia', () => {
    expect(parseCandlesDoMt5(cruSemFluxo, {})?.[0]).toHaveProperty('volume');
    expect(parseCandlesDoMt5(cruSemFluxo, { omitirVolume: false })?.[0]).toHaveProperty('volume');
  });

  it('⭐ `tetoDeBarras` deixa o consumidor pedir o caminho PROFUNDO', () => {
    const pedido = { instrument: { symbol: 'WINV26' }, periodSeconds: 300 };
    // Default conservador: 1.500 protege o polling, porque a bridge roda no mesmo processo que
    // alimenta o robô que opera.
    expect(montarCaminhoDeCandlesMt5(pedido)).toContain(`limit=${MAX_BARRAS_POR_CONSULTA_MT5}`);
    // ⭐ E a busca PONTUAL alcança 63 dias, medidos em 0,1 s — é o que traz o preço real do
    // período em que o arquivo perdeu negócios.
    expect(
      montarCaminhoDeCandlesMt5(pedido, { tetoDeBarras: MAX_BARRAS_CAMINHO_PROFUNDO_MT5 }),
    ).toContain(`limit=${MAX_BARRAS_CAMINHO_PROFUNDO_MT5}`);
  });

  it('⚠️ o teto RECORTA o pedido, e nunca o amplia', () => {
    const pedido = { instrument: { symbol: 'WINV26' }, periodSeconds: 300, limit: 99_999 };
    expect(montarCaminhoDeCandlesMt5(pedido, { tetoDeBarras: 2000 })).toContain('limit=2000');
    // Pedido menor que o teto é respeitado: o teto é proteção, não piso.
    expect(
      montarCaminhoDeCandlesMt5(
        { instrument: { symbol: 'WINV26' }, periodSeconds: 300, limit: 50 },
        { tetoDeBarras: 5000 },
      ),
    ).toContain('limit=50');
  });

  it('⚠️ `tetoDeBarras` é IGNORADO na rota de fluxo — ela recorta por `days`', () => {
    // ⭐ É a armadilha já registrada: mandar `limit` para `/historical-flow` faz o parâmetro ser
    // ignorado e a rota cair no default de 30 dias de tick reclassificado, que estourou 60 s.
    const caminho = montarCaminhoDeCandlesMt5(
      { instrument: { symbol: 'WINV26' }, periodSeconds: 300 },
      { comFluxo: true, dias: 2, tetoDeBarras: 5000 },
    );
    expect(caminho).toContain('days=2');
    expect(caminho).not.toContain('limit');
  });

  it('⭐⭐ a EMENDA com o terminal vencendo produz a amplitude REAL, e é o conserto', () => {
    // ⚠️ Reproduz o caso medido no pregão de 17/09/2026 em escala: o arquivo tem um dia de 1.075
    // pontos de amplitude e o terminal, 4.620. Com o arquivo canônico (default `'CORTE'`) a
    // amplitude que sai é a INCOMPLETA — e é o que o operador viu na tela.
    //
    // ⚠️ O extremo do terminal está no balde do MEIO, não no último, e isso é essencial para o
    // teste medir o que ele diz medir: no default `'CORTE'` o ao vivo substitui o ÚLTIMO balde do
    // arquivo (ele pode estar em formação). Um extremo no último balde entraria mesmo com corte, e
    // o teste passaria sem provar nada sobre a precedência.
    const arquivo = [
      barra(300, 100, { high: 100.5, low: 99.9 }),
      barra(600, 100, { high: 100.4, low: 99.95 }),
      barra(900, 100, { high: 100.6, low: 99.8 }),
    ];
    const terminal = [
      barra(300, 100, { high: 100.5, low: 99.9 }),
      barra(600, 100, { high: 104, low: 96 }),
      barra(900, 100, { high: 100.6, low: 99.8 }),
    ];

    const comCorte = emendarSeries(arquivo, terminal, 300, { toleranciaDeSegundos: 4 * 86_400 });
    const ampCorte =
      Math.max(...comCorte.barras.map((b) => b.high)) - Math.min(...comCorte.barras.map((b) => b.low));

    const comTerminal = emendarSeries(arquivo, terminal, 300, {
      precedencia: 'AO_VIVO_VENCE',
      toleranciaDeSegundos: 4 * 86_400,
      aoDivergir: 'EMENDAR_MESMO_ASSIM',
    });
    const ampReal =
      Math.max(...comTerminal.barras.map((b) => b.high)) -
      Math.min(...comTerminal.barras.map((b) => b.low));

    // ⭐ Com corte, a amplitude é a do ARQUIVO: 100,6 − 99,8. O extremo real não entra.
    expect(ampCorte).toBeCloseTo(0.8, 6);
    // ⭐⭐ Com o terminal vencendo, é a REAL: 104 − 96.
    expect(ampReal).toBeCloseTo(8, 6);
    // ⭐ E a contagem de barras NÃO muda: é substituição, não acréscimo. Uma emenda que crescesse
    // aqui estaria duplicando barra em vez de trocar a errada pela certa.
    expect(comTerminal.barras).toHaveLength(3);
  });

  it('⚠️ `EMENDAR_MESMO_ASSIM` é necessário aqui, e é o único lugar onde é', () => {
    // ⭐ `medirCoerencia` VAI reprovar: as duas séries discordam do preço, e é justamente por isso
    // que esta camada existe. Com o default (`'SO_HISTORICO'`) a emenda devolveria o arquivo — a
    // série ERRADA. Registrar isto evita que alguém "conserte" removendo a opção.
    const arquivo = [barra(300, 100, { high: 100.5, low: 99.9 })];
    const terminal = [barra(300, 108, { high: 110, low: 96 })];
    const recusada = emendarSeries(arquivo, terminal, 300, { precedencia: 'AO_VIVO_VENCE' });
    expect(recusada.coerencia?.compativeis).toBe(false);
    expect(recusada.barras[0]?.close).toBe(100);

    const forcada = emendarSeries(arquivo, terminal, 300, {
      precedencia: 'AO_VIVO_VENCE',
      aoDivergir: 'EMENDAR_MESMO_ASSIM',
    });
    expect(forcada.barras[0]?.close).toBe(108);
  });
});
