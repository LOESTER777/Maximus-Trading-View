/**
 * O dialeto da API de barras da mesa.
 *
 * ⭐ A amostra de `RESPOSTA_REAL` foi CAPTURADA do serviço em 17/09/2026, pelo túnel
 * `127.0.0.1:18899` (`/candles?asset=WIN&tf=1h&from=1789430400&to=1789516800`). Não é
 * inventada, e isso importa: um formato imaginado passa a existir no teste e não no
 * servidor, e a divergência aparece como gráfico vazio em produção.
 *
 * ⚠️ Os testes de FORMATO valem mais que os de caminho felizes aqui, porque é o formato
 * que muda sem avisar. A distinção entre "zero barras" e "contrato quebrado" é o que faz
 * uma mudança de coluna no backend ser vista em vez de virar "dia sem pregão".
 */
import { describe, expect, it } from 'vitest';
import {
  alcancouInicio,
  janelaAnterior,
  janelaDeBackfill,
  montarCaminhoDeBarras,
  parseBarrasDaMesa,
  periodosDisponiveis,
  rotuloDePeriodo,
  simboloAceito,
} from '../robustus-bars.core.js';
import type { BarsRequest } from '../contracts.js';

/** Amostra REAL: WIN, 1h, três barras de 15/09/2026. Ver o cabeçalho. */
const RESPOSTA_REAL = {
  asset: 'WIN',
  tf: '1h',
  count: 3,
  cols: [
    'bar_epoch',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'buy_vol',
    'sell_vol',
    'trades',
    'bid_size',
    'ask_size',
  ],
  rows: [
    [1789473600, 188810, 189190, 188525, 188635, 1166688, 570410, 596278, 120051, null, null],
    [1789477200, 188635, 188940, 188320, 188330, 1069810, 522523, 547287, 102693, null, null],
    [1789480800, 188335, 188675, 188270, 188480, 624582, 320942, 303640, 65759, null, null],
  ],
};

function pedido(p: Partial<BarsRequest> = {}): BarsRequest {
  return {
    instrument: { symbol: 'WIN' },
    periodSeconds: 300,
    fromSeconds: 1_789_430_400,
    toSeconds: 1_789_516_800,
    ...p,
  };
}

describe('período — o mapa diz o que a FONTE tem, e não o que seria bonito ter', () => {
  it('traduz os períodos materializados', () => {
    expect(rotuloDePeriodo(300)).toBe('5min');
    expect(rotuloDePeriodo(900)).toBe('15min');
    expect(rotuloDePeriodo(3600)).toBe('1h');
    expect(rotuloDePeriodo(86_400)).toBe('D1');
  });

  it('⭐⭐ M1 e M2 EXISTEM — esta asserção era o contrário, e estava errada', () => {
    // ⚠️ A versão anterior deste teste afirmava `rotuloDePeriodo(60) === null`, com a
    // justificativa "a agregação materializa 5min do tick e deriva o resto". Isso vinha da
    // DOCUMENTAÇÃO do pipeline, e documentação descreve intenção — inventário é o que a rota
    // devolve. Medido em 18/09/2026 contra o serviço:
    //
    //   1min: 39 meses desde jun/2023, ~11.300 barras/mês, agressor 100% até mai/2026
    //   2min: 39 meses, ~5.650/mês, mesma cobertura
    //   e o volume de 1min FECHA balde a balde com o de 5min (69.478 = 69.478)
    //
    // ⭐ O custo do erro era concreto: quem pedia M1 era mandado ao terminal, que serve 5 h de
    // passado. Estavam aqui 3 anos, no período que mais se usa para operar o mini índice.
    expect(rotuloDePeriodo(60)).toBe('1min');
    expect(rotuloDePeriodo(120)).toBe('2min');
  });

  it('M30 e H4 são `null` — a rota responde, mas com OUTRA origem', () => {
    // ⚠️ Aqui a ausência continua correta, e por um motivo medido, não documental: a rota aceita
    // os rótulos e devolve barras, mas com 79,5% de agressor em 30min e 51,6% em 4h contra 100%
    // em 5min — e o balde de 4h cai às 05:00 BRT, fora do pregão. Não é a mesma série.
    // Quem quiser 30min agrega 5min com `rollupBars`, e aí sabe que o dado é derivado.
    expect(rotuloDePeriodo(1800)).toBeNull();
    expect(rotuloDePeriodo(14_400)).toBeNull();
  });

  it('a lista sai em ordem crescente', () => {
    expect(periodosDisponiveis()).toEqual([60, 120, 300, 900, 3600, 86_400]);
  });
});

describe('símbolo — `WIN$` é RECUSADO pela fonte', () => {
  it('aceita o nome canônico da série contínua', () => {
    expect(simboloAceito('WIN')).toBe(true);
    expect(simboloAceito('WDO')).toBe(true);
    expect(simboloAceito('PETR4')).toBe(true);
    expect(simboloAceito('BOVA11')).toBe(true);
  });

  it('⚠️ recusa `$` e `.` — o servidor devolveria 400 e pareceria "ativo inexistente"', () => {
    expect(simboloAceito('WIN$')).toBe(false);
    expect(simboloAceito('WIN$N')).toBe(false);
    expect(simboloAceito('PETR4.SA')).toBe(false);
    expect(simboloAceito('')).toBe(false);
    expect(simboloAceito('A'.repeat(17))).toBe(false);
  });
});

describe('montarCaminhoDeBarras — a janela é OBRIGATÓRIA', () => {
  it('monta a consulta com asset, tf e a janela', () => {
    expect(montarCaminhoDeBarras(pedido())).toBe(
      '/candles?asset=WIN&tf=5min&from=1789430400&to=1789516800',
    );
  });

  it('⭐⭐ RECUSA pedido sem janela nenhuma', () => {
    // A rota não tem LIMIT: sem `from`/`to` ela devolve a série inteira — 18 anos de
    // 5min para o WIN. A origem já matou o próprio processo servindo 28 MB de uma vez.
    const r = montarCaminhoDeBarras({
      instrument: { symbol: 'WIN' },
      periodSeconds: 300,
    });
    expect(r).toBeNull();
  });

  it('aceita janela aberta de UM lado', () => {
    expect(montarCaminhoDeBarras(pedido({ fromSeconds: undefined }))).toBe(
      '/candles?asset=WIN&tf=5min&to=1789516800',
    );
    expect(montarCaminhoDeBarras(pedido({ toSeconds: undefined }))).toBe(
      '/candles?asset=WIN&tf=5min&from=1789430400',
    );
  });

  it('recusa período que a base não tem, símbolo inválido e janela invertida', () => {
    // ⚠️ 1800 (M30) e não 60: `1min` passou a existir na base — ver a medição no bloco de
    // período. M30 continua recusado porque a rota o serve de OUTRA origem.
    expect(montarCaminhoDeBarras(pedido({ periodSeconds: 1800 }))).toBeNull();
    expect(montarCaminhoDeBarras(pedido({ instrument: { symbol: 'WIN$' } }))).toBeNull();
    expect(montarCaminhoDeBarras(pedido({ fromSeconds: 200, toSeconds: 100 }))).toBeNull();
    // Janela degenerada devolveria lista vazia; recusar distingue "sem dado" de
    // "pergunta errada".
    expect(montarCaminhoDeBarras(pedido({ fromSeconds: 100, toSeconds: 100 }))).toBeNull();
  });

  it('recusa janela não finita em vez de mandar `NaN` na URL', () => {
    expect(montarCaminhoDeBarras(pedido({ fromSeconds: Number.NaN }))).toBeNull();
    expect(montarCaminhoDeBarras(pedido({ toSeconds: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('`limit` é ignorado — a fonte não o implementa', () => {
    // Traduzi-lo para corte no cliente faria baixar tudo para jogar quase tudo fora.
    expect(montarCaminhoDeBarras(pedido({ limit: 50 }))).toBe(
      '/candles?asset=WIN&tf=5min&from=1789430400&to=1789516800',
    );
  });
});

describe('parseBarrasDaMesa — sobre a amostra REAL do serviço', () => {
  it('⭐ lê as três barras com preço, volume e AGRESSOR', () => {
    const barras = parseBarrasDaMesa(RESPOSTA_REAL);
    expect(barras).not.toBeNull();
    expect(barras!).toHaveLength(3);
    expect(barras![0]).toEqual({
      time: 1_789_473_600,
      open: 188_810,
      high: 189_190,
      low: 188_525,
      close: 188_635,
      volume: 1_166_688,
      buyVolume: 570_410,
      sellVolume: 596_278,
    });
  });

  it('⚠️ `bid_size`/`ask_size` nulos NÃO viram zero — eles não entram na barra', () => {
    // No WIN o book não foi gravado em praticamente todo o histórico. Zero seria uma
    // afirmação falsa sobre a liquidez do topo do livro; ausência é a verdade.
    const barras = parseBarrasDaMesa(RESPOSTA_REAL)!;
    expect(Object.keys(barras[0]!)).not.toContain('bidSize');
    expect(JSON.stringify(barras[0])).not.toContain('null');
  });

  it('o tempo já é em SEGUNDOS — nenhuma conversão', () => {
    const barras = parseBarrasDaMesa(RESPOSTA_REAL)!;
    // 1789473600 = 2026-09-15T12:00:00Z. Em milissegundos seria ano 56 mil.
    expect(barras[0]!.time).toBeLessThan(2e10);
  });

  it('⭐ mapeia por NOME de coluna, não por posição', () => {
    // A prova: colunas em ordem trocada continuam produzindo a barra certa. Amarrar-se à
    // posição faria uma coluna nova no meio deslocar preço para volume em silêncio.
    const trocado = {
      cols: ['close', 'bar_epoch', 'volume', 'open', 'low', 'high'],
      rows: [[188_635, 1_789_473_600, 1_166_688, 188_810, 188_525, 189_190]],
    };
    expect(parseBarrasDaMesa(trocado)).toEqual([
      {
        time: 1_789_473_600,
        open: 188_810,
        high: 189_190,
        low: 188_525,
        close: 188_635,
        volume: 1_166_688,
      },
    ]);
  });

  it('⭐⭐ zero linhas devolve `[]`; formato quebrado devolve `null`', () => {
    // A distinção é o ponto: `[]` é "não houve pregão nessa janela" (dia de feriado, o
    // caso normal); `null` é "o formato mudou e alguém precisa saber". Colapsar as duas
    // faz mudança de backend parecer dia sem negócio, e o defeito vive meses.
    expect(parseBarrasDaMesa({ cols: RESPOSTA_REAL.cols, rows: [] })).toEqual([]);
    expect(parseBarrasDaMesa(null)).toBeNull();
    expect(parseBarrasDaMesa('não é json de barras')).toBeNull();
    expect(parseBarrasDaMesa({ rows: [] })).toBeNull();
    expect(parseBarrasDaMesa({ cols: ['bar_epoch'], rows: [] })).toBeNull();
  });

  it('linha com OHLC incompleto é PULADA, sem derrubar o lote', () => {
    // Uma barra ruim num histórico de 18 anos não pode apagar os outros 18 anos da tela.
    // E barra ruim acontece: a origem registrou 13-14% de barras impossíveis por relógio
    // deslocado numa faixa.
    const corpo = {
      cols: ['bar_epoch', 'open', 'high', 'low', 'close'],
      rows: [
        [1000, 10, 12, 9, 11],
        [1300, null, 12, 9, 11],
        [1600, 10, 12, 9, 11],
      ],
    };
    const barras = parseBarrasDaMesa(corpo)!;
    expect(barras.map((b) => b.time)).toEqual([1000, 1600]);
  });

  it('⚠️ tempo NÃO crescente é descartado — o motor assume tempo único', () => {
    // Tempo repetido quebra o eixo em três lugares: `update` trata tempo igual como a
    // mesma barra (substitui), `timeToIndex` resolve para o primeiro índice, e os
    // rótulos do eixo. É a mesma invariante que o Renko teve de respeitar.
    const corpo = {
      cols: ['bar_epoch', 'open', 'high', 'low', 'close'],
      rows: [
        [1000, 10, 12, 9, 11],
        [1000, 11, 13, 10, 12],
        [900, 11, 13, 10, 12],
        [1100, 11, 13, 10, 12],
      ],
    };
    expect(parseBarrasDaMesa(corpo)!.map((b) => b.time)).toEqual([1000, 1100]);
  });

  it('`rows` com item que não é array é contrato quebrado', () => {
    expect(parseBarrasDaMesa({ cols: ['bar_epoch'], rows: [42] })).toBeNull();
  });
});

describe('janelaDeBackfill — andar para trás sem buraco e sem duplicata', () => {
  it('⭐ o lote termina EXATAMENTE na barra mais antiga carregada', () => {
    // `to` é exclusivo no servidor, então a barra de borda não vem duas vezes.
    const j = janelaDeBackfill(1_789_473_600, 3600, 120)!;
    expect(j.toSeconds).toBe(1_789_473_600);
    expect(j.fromSeconds).toBe(1_789_473_600 - 120 * 3600);
  });

  it('a janela é de CALENDÁRIO: o retorno traz menos barras, e está certo', () => {
    // Fim de semana e madrugada não têm pregão. Compensar com um "fator de folga" faria
    // o tamanho do lote variar por ativo e a rolagem ficaria irregular.
    const j = janelaDeBackfill(1_789_473_600, 86_400, 30)!;
    expect(j.toSeconds - j.fromSeconds).toBe(30 * 86_400);
  });

  it('nunca produz janela negativa perto do epoch', () => {
    const j = janelaDeBackfill(1000, 3600, 100)!;
    expect(j.fromSeconds).toBe(0);
    expect(j.toSeconds).toBe(1000);
  });

  it('entrada inutilizável devolve `null`, nunca uma janela inventada', () => {
    // Janela errada no backfill produz um buraco no meio do histórico — o defeito mais
    // difícil de ver num gráfico, porque parece um pregão sem negócio.
    expect(janelaDeBackfill(0, 300, 10)).toBeNull();
    expect(janelaDeBackfill(Number.NaN, 300, 10)).toBeNull();
    expect(janelaDeBackfill(1000, 0, 10)).toBeNull();
    expect(janelaDeBackfill(1000, 300, 0)).toBeNull();
    expect(janelaDeBackfill(1000, 300, Number.NaN)).toBeNull();
  });
});

describe('janelaAnterior — lote vazio NÃO é fim de histórico', () => {
  it('⭐⭐ anda pelo `from` pedido, não pela barra mais antiga recebida', () => {
    // A armadilha medida contra o serviço real: pedir um domingo devolve zero barras
    // (correto), e quem caminha usando "o tempo da barra mais antiga" não tem barra
    // nenhuma — repete a mesma janela para sempre. Na tela: "não há mais histórico" a
    // cada fim de semana, com 18 anos de dado do outro lado do buraco.
    const primeira = janelaDeBackfill(1_789_473_600, 300, 288)!;
    const segunda = janelaAnterior(primeira, 300, 288)!;
    expect(segunda.toSeconds).toBe(primeira.fromSeconds);
    expect(segunda.fromSeconds).toBe(primeira.fromSeconds - 288 * 300);
  });

  it('as janelas são CONTÍGUAS e não se sobrepõem', () => {
    // `to` é exclusivo no servidor, então `to` da anterior == `from` da atual não
    // duplica a barra de borda. Provado contra a API real: 570 barras únicas em 8 lotes,
    // zero duplicadas.
    let j = janelaDeBackfill(1_789_473_600, 3600, 24)!;
    const bordas: number[] = [j.toSeconds];
    for (let i = 0; i < 5; i++) {
      bordas.push(j.fromSeconds);
      j = janelaAnterior(j, 3600, 24)!;
    }
    // Estritamente decrescente e sem repetição.
    for (let i = 1; i < bordas.length; i++) {
      expect(bordas[i]!).toBeLessThan(bordas[i - 1]!);
    }
    expect(new Set(bordas).size).toBe(bordas.length);
  });

  it('devolve `null` quando a caminhada já chegou ao epoch', () => {
    expect(janelaAnterior({ fromSeconds: 0, toSeconds: 300 }, 300, 10)).toBeNull();
  });
});

describe('alcancouInicio — o único critério honesto de "fim do histórico"', () => {
  const INICIO_WIN = 1_108_692_000; // 2005-02-18, medido na base

  it('para quando a janela alcança o início conhecido da série', () => {
    expect(alcancouInicio({ fromSeconds: INICIO_WIN }, INICIO_WIN)).toBe(true);
    expect(alcancouInicio({ fromSeconds: INICIO_WIN - 86_400 }, INICIO_WIN)).toBe(true);
  });

  it('não para antes disso', () => {
    expect(alcancouInicio({ fromSeconds: INICIO_WIN + 86_400 }, INICIO_WIN)).toBe(false);
  });

  it('⚠️ sem cobertura conhecida, NÃO para', () => {
    // Melhor pedir um lote a mais que parar cedo e afirmar que não há passado. Sem este
    // ramo, a caminhada ficaria pedindo 2004, 2003, 1999… para sempre contra um banco de
    // 250 GB — ou pararia no primeiro lote, dependendo do palpite.
    expect(alcancouInicio({ fromSeconds: 1 }, null)).toBe(false);
    expect(alcancouInicio({ fromSeconds: 1 }, undefined)).toBe(false);
    expect(alcancouInicio({ fromSeconds: 1 }, Number.NaN)).toBe(false);
  });
});

describe('⭐⭐ D1 com DUAS convenções de virada de dia — o defeito do DADO', () => {
  /**
   * Amostra REAL, capturada do serviço em 17/09/2026 (`PETR4`, `D1`):
   * dois registros do MESMO pregão, um a 00:00 UTC e outro a 03:00 UTC (meia-noite de
   * Brasília). A base tem dois pipelines com convenções diferentes, e nenhum está errado —
   * errado é conviverem na mesma série.
   */
  const DOIS_POR_DIA = {
    cols: ['bar_epoch', 'open', 'high', 'low', 'close', 'volume'],
    rows: [
      [1_780_012_800, 41.2, 41.5, 41.0, 41.43, 63_690], // 2026-05-29T00:00Z
      [1_780_023_600, 41.4, 42.0, 41.3, 41.87, 31_318], // 2026-05-29T03:00Z — mesmo dia
      [1_780_272_000, 41.8, 42.0, 41.5, 41.79, 97_977], // 2026-06-01T00:00Z
      [1_780_282_800, 41.9, 42.5, 41.8, 42.36, 51_093], // 2026-06-01T03:00Z — mesmo dia
    ],
  };

  it('⭐⭐ em D1, o par do mesmo pregão é COLAPSADO', () => {
    // ⚠️ O sintoma não é visível no gráfico (duas velas parecidas passam por dois dias), mas o
    // retorno entre as duas barras do mesmo dia é ruído puro — e foi o que fez a correlação
    // entre PETR4 e VALE3 sair em −0,04, duas blue chips que andam claramente juntas.
    const barras = parseBarrasDaMesa(DOIS_POR_DIA, 86_400)!;
    expect(barras).toHaveLength(2);
    expect(barras.map((b) => b.time)).toEqual([1_780_023_600, 1_780_282_800]);
  });

  it('⭐ mantém a barra MAIS TARDIA — o volume mostra que os recortes são diferentes', () => {
    // 63.690 contra 31.318 no mesmo dia: os dois registros cobrem trechos distintos da sessão.
    // O último a fechar é o mais próximo do fechamento real; o primeiro é um dia parcial.
    const barras = parseBarrasDaMesa(DOIS_POR_DIA, 86_400)!;
    expect(barras[0]!.close).toBe(41.87);
    expect(barras[1]!.close).toBe(42.36);
  });

  it('⚠️ INTRADIÁRIO não é colapsado — lá os baldes são alinhados e não há ambiguidade', () => {
    // Aplicar a colapsagem em 5min fundiria barras legítimas: duas barras de 5min distam 300 s,
    // muito abaixo da folga de 12 h, e o dia inteiro viraria uma barra.
    const cincoMin = {
      cols: ['bar_epoch', 'open', 'high', 'low', 'close'],
      rows: [
        [1_789_473_600, 1, 2, 0, 1],
        [1_789_473_900, 1, 2, 0, 1],
        [1_789_474_200, 1, 2, 0, 1],
      ],
    };
    expect(parseBarrasDaMesa(cincoMin, 300)).toHaveLength(3);
    // E sem período informado também não colapsa: sem saber o período, mexer seria palpite.
    expect(parseBarrasDaMesa(cincoMin)).toHaveLength(3);
  });

  it('dias LEGÍTIMOS (24 h de distância) não são fundidos', () => {
    const umPorDia = {
      cols: ['bar_epoch', 'open', 'high', 'low', 'close'],
      rows: [
        [1_780_012_800, 1, 2, 0, 1],
        [1_780_099_200, 1, 2, 0, 2],
        [1_780_185_600, 1, 2, 0, 3],
      ],
    };
    expect(parseBarrasDaMesa(umPorDia, 86_400)).toHaveLength(3);
  });

  it('semanal também colapsa (período >= D1), e barra única passa intacta', () => {
    expect(parseBarrasDaMesa(DOIS_POR_DIA, 604_800)).toHaveLength(2);
    const uma = { cols: ['bar_epoch', 'open', 'high', 'low', 'close'], rows: [[1, 1, 2, 0, 1]] };
    expect(parseBarrasDaMesa(uma, 86_400)).toHaveLength(1);
  });
});
