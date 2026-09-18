/**
 * Bancada do dialeto da bridge MT5 e da COSTURA com o histórico.
 *
 * ⭐ O foco é a costura e o fuso: são as duas coisas que corrompem um gráfico em SILÊNCIO.
 * As duas têm caso que reproduz o MECANISMO do defeito, não só o resultado — a disciplina
 * do projeto (ver `consistencia.spec.ts`, que simula `timeToCoordinate` devolvendo `null`).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BARRAS_POR_CONSULTA_MT5,
  MAX_DIAS_FLUXO_MT5,
  OFFSET_CANDLES_MT5_SEGUNDOS,
  PERIODOS_DA_BRIDGE_MT5,
  contratoVigenteNaDescricao,
  emendarSeries,
  epochParaMt5,
  epochRealDoMt5,
  montarCaminhoDeCandlesMt5,
  parseCandlesDoMt5,
  periodoSuportadoPorAmbas,
  resolverContratoVigente,
  rotuloDePeriodoMt5,
} from '../mt5-bridge.core.js';
import { PERIODOS_DA_MESA } from '../robustus-bars.core.js';
import type { Bar } from '../contracts.js';

/** Uma barra sintética, só com o que a asserção precisa. */
function barra(time: number, close: number, extra?: Partial<Bar>): Bar {
  return { time, open: close, high: close, low: close, close, ...extra };
}

describe('⭐⭐ fuso — aferido por ÂNCORA EXTERNA, não por comparação de fontes', () => {
  /**
   * ⚠️ Este bloco já esteve ERRADO, com o sinal invertido, e passando. A lição está na nota de
   * `OFFSET_CANDLES_MT5_SEGUNDOS`: eu escolhi o alinhamento pelo menor erro médio de preço, sem
   * exigir COBERTURA — e um subconjunto de 36 % das barras tinha erro pequeno por coincidência.
   *
   * ⭐ Agora a âncora é EXTERNA e verificável: o horário de funcionamento do mercado. Ele não
   * depende de nenhuma outra fonte de dado, e é por isso que duas fontes erradas do mesmo jeito
   * não conseguem enganá-lo.
   */
  it('o offset é POSITIVO: a bridge marca hora de Brasília, e epoch UTC é 3 h à frente', () => {
    expect(OFFSET_CANDLES_MT5_SEGUNDOS).toBe(10_800);
    expect(OFFSET_CANDLES_MT5_SEGUNDOS).toBeGreaterThan(0);
  });

  /** O horário de Brasília de um epoch, para conferir contra o pregão. */
  function horaBRT(epoch: number): string {
    return new Date(epoch * 1000).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  it('⭐⭐ ÂNCORA: a janela do pregão do WIN é 09:00–18:25 BRT', () => {
    // Valores CRUS medidos na bridge em 16/09/2026: primeira e última barra de 5 min do dia.
    const primeiraCrua = 1_789_549_200;
    const ultimaCrua = 1_789_582_800;

    expect(horaBRT(epochRealDoMt5(primeiraCrua))).toBe('09:00');
    expect(horaBRT(epochRealDoMt5(ultimaCrua))).toBe('18:20');
  });

  it('⚠️ MECANISMO: com o sinal invertido a série cai FORA do pregão', () => {
    const primeiraCrua = 1_789_549_200;
    // O que a versão errada produzia: 03:00, quando não há mercado nenhum.
    expect(horaBRT(primeiraCrua - 10_800)).toBe('03:00');
    // E o certo:
    expect(horaBRT(epochRealDoMt5(primeiraCrua))).toBe('09:00');
  });

  it('⭐ ÂNCORA 2: a mínima de 17/09 cai às 10:40, como na tela do terminal', () => {
    // Conferido contra a captura do gráfico do MT5: a queda violenta está entre as marcas de
    // 09:30 e 10:50. `low` = 184.465 no timestamp cru abaixo.
    const minimaCrua = 1_789_641_600;
    expect(horaBRT(epochRealDoMt5(minimaCrua))).toBe('10:40');
  });

  it('epochParaMt5 é o inverso exato de epochRealDoMt5', () => {
    for (const off of [undefined, 0, 10_800, 18_000]) {
      const t = 1_789_560_000;
      const ida = off === undefined ? epochParaMt5(t) : epochParaMt5(t, off);
      const volta = off === undefined ? epochRealDoMt5(ida) : epochRealDoMt5(ida, off);
      expect(volta).toBe(t);
    }
  });

  it('⭐ a correção acontece na FRONTEIRA: parseCandlesDoMt5 já devolve epoch real', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1_789_549_200, open: 187_700, high: 187_750, low: 187_650, close: 187_705 },
    ]);
    expect(b).not.toBeNull();
    expect(horaBRT(b![0]!.time)).toBe('09:00');
  });
});

describe('período', () => {
  it('⭐ a bridge tem M1 e M30, que o arquivo NÃO tem', () => {
    expect(rotuloDePeriodoMt5(60)).toBe('1m');
    expect(rotuloDePeriodoMt5(1800)).toBe('30m');
    // E o arquivo não os tem — é o que justifica os dois mapas separados.
    expect(PERIODOS_DA_MESA.has(60)).toBe(false);
    expect(PERIODOS_DA_MESA.has(1800)).toBe(false);
  });

  it('período desconhecido devolve null, nunca um rótulo inventado', () => {
    expect(rotuloDePeriodoMt5(137)).toBeNull();
    expect(rotuloDePeriodoMt5(0)).toBeNull();
    expect(rotuloDePeriodoMt5(-300)).toBeNull();
  });

  it('periodoSuportadoPorAmbas separa "as duas têm" de "só o MT5 tem"', () => {
    expect(periodoSuportadoPorAmbas(300, PERIODOS_DA_MESA)).toBe(true);
    expect(periodoSuportadoPorAmbas(3600, PERIODOS_DA_MESA)).toBe(true);
    // M1: a bridge tem, o arquivo não ⇒ precisa de aviso, não de silêncio.
    expect(periodoSuportadoPorAmbas(60, PERIODOS_DA_MESA)).toBe(false);
    expect(periodoSuportadoPorAmbas(1800, PERIODOS_DA_MESA)).toBe(false);
  });

  it('todo rótulo do mapa é o que a bridge documenta', () => {
    expect([...PERIODOS_DA_BRIDGE_MT5.values()]).toEqual([
      '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w',
    ]);
  });
});

describe('⭐ resolução do contrato vigente — o defeito de 3.400 pontos', () => {
  it('extrai o contrato do parêntese da descrição do contínuo', () => {
    expect(
      contratoVigenteNaDescricao('IBOVESPA MINI - Por Liquidez (WINV26) - Ajuste Proporcional'),
    ).toBe('WINV26');
  });

  it('funciona com acento e caixa diferentes (a descrição vem do terminal em pt-BR)', () => {
    expect(contratoVigenteNaDescricao('DÓLAR MINI - por liquidéz (WDOV26) - Sem Ajustes')).toBe(
      'WDOV26',
    );
  });

  it('⚠️ descrição SEM "por liquidez" devolve null — não casa parêntese qualquer', () => {
    expect(contratoVigenteNaDescricao('IBOVESPA MINI (Ajuste Proporcional)')).toBeNull();
    expect(contratoVigenteNaDescricao('')).toBeNull();
  });

  it('resolve a raiz pelo contínuo que a corretora publica', () => {
    const simbolos = [
      { name: 'WIN$', description: 'IBOVESPA MINI - Por Liquidez (WINV26) - Ajuste Proporcional' },
      { name: 'WINQ26', description: 'IBOVESPA MINI' },
      { name: 'WINV26', description: 'IBOVESPA MINI' },
    ];
    expect(resolverContratoVigente(simbolos, 'WIN')).toBe('WINV26');
  });

  it('⭐⭐ MECANISMO: o contrato vencido EXISTE na lista e não é escolhido', () => {
    // Foi exatamente o defeito da origem: `WINQ26` continuava listado e negociável, só não
    // tinha liquidez. Escolher por data o pegava; escolher pela descrição, não.
    const simbolos = [
      { name: 'WINQ26', description: 'IBOVESPA MINI' },
      { name: 'WIN$', description: 'IBOVESPA MINI - Por Liquidez (WINV26) - Ajuste Proporcional' },
    ];
    const escolhido = resolverContratoVigente(simbolos, 'WIN');
    expect(escolhido).toBe('WINV26');
    expect(escolhido).not.toBe('WINQ26');
  });

  it('respeita contrato explícito já pedido', () => {
    const simbolos = [{ name: 'WINV26', description: 'IBOVESPA MINI' }];
    expect(resolverContratoVigente(simbolos, 'WINV26')).toBe('WINV26');
  });

  it('⚠️ sem informação devolve null em vez de chutar RAIZ+mês', () => {
    expect(resolverContratoVigente([], 'WIN')).toBeNull();
    expect(resolverContratoVigente([{ name: 'PETR4' }], 'WIN')).toBeNull();
  });

  it('não confunde raízes diferentes', () => {
    const simbolos = [
      { name: 'WDO$', description: 'DOLAR MINI - Por Liquidez (WDOV26) - Sem Ajustes' },
    ];
    expect(resolverContratoVigente(simbolos, 'WIN')).toBeNull();
    expect(resolverContratoVigente(simbolos, 'WDO')).toBe('WDOV26');
  });
});

describe('URL', () => {
  const req = (symbol: string, periodSeconds: number, limit?: number) => ({
    instrument: { symbol },
    periodSeconds,
    ...(limit === undefined ? {} : { limit }),
  });

  it('monta /candles com rótulo e limite', () => {
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 300, 100))).toBe(
      '/candles/WINV26?timeframe=5m&limit=100',
    );
  });

  it('⭐ comFluxo troca a rota por /historical-flow (buy/sell volume)', () => {
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 300), { comFluxo: true })).toBe(
      '/historical-flow/WINV26?timeframe=5m&days=1',
    );
  });

  it('⭐⭐ MECANISMO: /historical-flow usa `days`, NUNCA `limit` — o defeito de 30 dias', () => {
    // A primeira versão mandava `limit` para as duas rotas. Em `/historical-flow` o `limit` é
    // ignorado e a rota cai no default de 30 DIAS de tick reclassificado: medido, passou de
    // 60 s e estourou o tempo limite, contra o terminal que o robô usa para operar.
    const url = montarCaminhoDeCandlesMt5(req('WINV26', 300, 700), { comFluxo: true })!;
    expect(url).not.toContain('limit');
    expect(url).toContain('days=1');
  });

  it('⚠️ `dias` é recortado pelo teto do servidor (le=90) e pelo piso de 1', () => {
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 300), { comFluxo: true, dias: 9999 })).toContain(
      `days=${MAX_DIAS_FLUXO_MT5}`,
    );
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 300), { comFluxo: true, dias: 0 })).toContain(
      'days=1',
    );
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 300), { comFluxo: true, dias: -5 })).toContain(
      'days=1',
    );
  });

  it('⚠️ o limite de /candles é RECORTADO pelo teto — não deixa pedir dez mil barras', () => {
    const url = montarCaminhoDeCandlesMt5(req('WINV26', 300, 99_999));
    expect(url).toContain(`limit=${MAX_BARRAS_POR_CONSULTA_MT5}`);
  });

  it('⚠️ from/to do contrato NÃO viram parâmetro (medido: a rota os ignora)', () => {
    const url = montarCaminhoDeCandlesMt5({
      instrument: { symbol: 'WINV26' },
      periodSeconds: 300,
      fromSeconds: 1_789_668_000,
      toSeconds: 1_789_669_800,
    })!;
    expect(url).not.toContain('from_ts');
    expect(url).not.toContain('to_ts');
  });

  it('período que a bridge não tem recusa a URL', () => {
    expect(montarCaminhoDeCandlesMt5(req('WINV26', 137))).toBeNull();
  });

  it('⚠️ aceita $ e @ (são os contínuos do MT5), ao contrário do bars_api', () => {
    expect(montarCaminhoDeCandlesMt5(req('WIN$', 300))).toContain('WIN%24');
  });

  it('recusa símbolo com separador de caminho ou consulta', () => {
    expect(montarCaminhoDeCandlesMt5(req('WIN/../etc', 300))).toBeNull();
    expect(montarCaminhoDeCandlesMt5(req('WIN?x=1', 300))).toBeNull();
    expect(montarCaminhoDeCandlesMt5(req('WIN 26', 300))).toBeNull();
    expect(montarCaminhoDeCandlesMt5(req('', 300))).toBeNull();
  });
});

describe('leitura da resposta', () => {
  it('lê OHLC + volume e corrige o tempo', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 3, low: 0.5, close: 2, volume: 42 },
    ]);
    expect(b?.[0]).toEqual({
      time: 1000 + OFFSET_CANDLES_MT5_SEGUNDOS,
      open: 1,
      high: 3,
      low: 0.5,
      close: 2,
      volume: 42,
    });
  });

  it('⭐ lê buy_volume/sell_volume do /historical-flow', () => {
    const b = parseCandlesDoMt5([
      {
        timestamp: 1000, open: 1, high: 3, low: 0.5, close: 2,
        volume: 100, buy_volume: 70, sell_volume: 30,
      },
    ]);
    expect(b?.[0]?.buyVolume).toBe(70);
    expect(b?.[0]?.sellVolume).toBe(30);
  });

  it('⚠️ um lado só do agressor é DESCARTADO (seria volume disfarçado de desequilíbrio)', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, buy_volume: 70 },
    ]);
    expect(b?.[0]).not.toHaveProperty('buyVolume');
    expect(b?.[0]).not.toHaveProperty('sellVolume');
  });

  it('⚠️ lista vazia é [] (feriado), corpo inválido é null (contrato quebrado)', () => {
    expect(parseCandlesDoMt5([])).toEqual([]);
    expect(parseCandlesDoMt5(null)).toBeNull();
    expect(parseCandlesDoMt5({ candles: [] })).toBeNull();
    expect(parseCandlesDoMt5('[]')).toBeNull();
  });

  it('barra com OHLC incompleto é pulada, o resto do lote sobrevive', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 2, low: 0, close: 1 },
      { timestamp: 1300, open: 1, high: null, low: 0, close: 1 },
      { timestamp: 1600, open: 2, high: 3, low: 1, close: 2 },
    ]);
    expect(b?.length).toBe(2);
  });

  it('tempo não crescente é descartado (o motor assume ordem estrita)', () => {
    const b = parseCandlesDoMt5([
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1 },
      { timestamp: 1000, open: 2, high: 2, low: 2, close: 2 },
      { timestamp: 900, open: 3, high: 3, low: 3, close: 3 },
    ]);
    expect(b?.length).toBe(1);
    expect(b?.[0]?.close).toBe(1);
  });

  it('a janela recorta no cliente, e o corte usa epoch REAL', () => {
    const corpo = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1 },
      { timestamp: 1300, open: 2, high: 2, low: 2, close: 2 },
      { timestamp: 1600, open: 3, high: 3, low: 3, close: 3 },
    ];
    const de = epochRealDoMt5(1300);
    const b = parseCandlesDoMt5(corpo, { deSegundos: de });
    expect(b?.length).toBe(2);
    expect(b?.[0]?.time).toBe(de);
    // `ate` é exclusivo, como no resto da biblioteca.
    const b2 = parseCandlesDoMt5(corpo, { deSegundos: de, ateSegundos: epochRealDoMt5(1600) });
    expect(b2?.length).toBe(1);
  });
});

describe('⭐⭐ a COSTURA — histórico + dia corrente', () => {
  const P = 300;

  it('caso do pedido: arquivo até ontem, MT5 traz hoje', () => {
    const hist = [barra(1000, 100), barra(1300, 101)];
    const vivo = [barra(1600, 102), barra(1900, 103)];
    const r = emendarSeries(hist, vivo, P);

    expect(r.barras.map((b) => b.time)).toEqual([1000, 1300, 1600, 1900]);
    expect(r.doHistorico).toBe(2);
    expect(r.doAoVivo).toBe(2);
    expect(r.emendaEm).toBe(1600);
    expect(r.lacuna).toBeNull();
  });

  it('⭐⭐ DECISÃO 1: cada barra vem de UMA fonte — nunca OHLC misturado', () => {
    // Medição real: a MESMA barra vale 187695 no arquivo e 187705 no MT5 (contínuo vs
    // contrato). A emenda não pode fabricar um candle com abertura de um e fecho do outro.
    const hist = [barra(1000, 187_695, { open: 187_600, high: 187_800, low: 187_500 })];
    const vivo = [barra(1000, 187_705, { open: 187_610, high: 187_810, low: 187_510 })];
    const r = emendarSeries(hist, vivo, P);

    expect(r.barras.length).toBe(1);
    const b = r.barras[0]!;
    // Veio inteira do ao vivo: os quatro campos são dele, nenhum é do arquivo.
    expect(b.close).toBe(187_705);
    expect(b.open).toBe(187_610);
    expect(b.high).toBe(187_810);
    expect(b.low).toBe(187_510);
  });

  it('⭐ DECISÃO 2: no balde do CORTE o terminal vence (a barra pode estar em formação)', () => {
    const hist = [barra(1000, 100), barra(1300, 101)];
    const vivo = [barra(1300, 999), barra(1600, 102)];
    // ⚠️ `EMENDAR_MESMO_ASSIM` porque este caso usa valores artificialmente distantes para
    // tornar a origem de cada barra ÓBVIA na asserção. A guarda de coerência (que recusa fontes
    // divergentes) os barraria antes de a precedência ser exercida, e o que está sob teste aqui é
    // a precedência. Ver `medirCoerencia`.
    const r = emendarSeries(hist, vivo, P, { aoDivergir: 'EMENDAR_MESMO_ASSIM' });

    expect(r.barras.find((b) => b.time === 1300)?.close).toBe(999);
    expect(r.sobrepostas).toBe(1);
    expect(r.doAoVivo).toBe(1);
    expect(r.doHistorico).toBe(2);
    expect(r.barras.length).toBe(3);
  });

  it('⭐⭐ DECISÃO 2: ANTES do corte o ARQUIVO é canônico — evita o degrau de preço', () => {
    // Medido: o terminal responde as N últimas barras e sobrepõe dias que o arquivo já tem
    // (117 barras em 15min com lote de 400). Aceitá-las reescreveria o passado com o preço do
    // contrato em vez do contínuo, e a junção apareceria como degrau.
    const hist = [barra(1000, 100), barra(1300, 101), barra(1600, 102)];
    const vivo = [barra(1000, 555), barra(1300, 666), barra(1600, 777), barra(1900, 103)];
    // ⚠️ `EMENDAR_MESMO_ASSIM` porque este caso usa valores artificialmente distantes para
    // tornar a origem de cada barra ÓBVIA na asserção. A guarda de coerência (que recusa fontes
    // divergentes) os barraria antes de a precedência ser exercida, e o que está sob teste aqui é
    // a precedência. Ver `medirCoerencia`.
    const r = emendarSeries(hist, vivo, P, { aoDivergir: 'EMENDAR_MESMO_ASSIM' });

    // As duas primeiras do terminal foram descartadas: o arquivo manda no passado.
    expect(r.barras.find((b) => b.time === 1000)?.close).toBe(100);
    expect(r.barras.find((b) => b.time === 1300)?.close).toBe(101);
    expect(r.descartadasPeloCorte).toBe(2);
    // O balde do corte foi substituído (pode estar em formação).
    expect(r.barras.find((b) => b.time === 1600)?.close).toBe(777);
    expect(r.sobrepostas).toBe(1);
    // E a ponta nova entrou.
    expect(r.doAoVivo).toBe(1);
    // ⚠️ A emenda começa no balde do CORTE (1600), não na primeira barra inédita (1900): é
    // dali que o terminal passa a mandar no conteúdo. Apontar para 1900 diria que 1600 veio do
    // arquivo, e ela não veio.
    expect(r.emendaEm).toBe(1600);
  });

  it('⭐ a emenda é IDEMPOTENTE: rodar com arquivo mais completo não duplica', () => {
    const vivo = [barra(1600, 102), barra(1900, 103)];
    const antes = emendarSeries([barra(1000, 100), barra(1300, 101)], vivo, P);
    // No dia seguinte o top-up cobriu o que era "ao vivo".
    const depois = emendarSeries(
      [barra(1000, 100), barra(1300, 101), barra(1600, 102), barra(1900, 103)],
      vivo,
      P,
    );
    expect(depois.barras.length).toBe(antes.barras.length);
    expect(depois.doAoVivo).toBe(0);
    // A de 1600 caiu pelo corte; a de 1900 substituiu o balde do corte.
    expect(depois.descartadasPeloCorte).toBe(1);
    expect(depois.sobrepostas).toBe(1);
  });

  it('⭐⭐ DECISÃO 3: a LACUNA é devolvida, e nenhuma barra é inventada', () => {
    const hist = [barra(1000, 100), barra(1300, 101)];
    // Buraco de 3 períodos.
    const vivo = [barra(2500, 105)];
    const r = emendarSeries(hist, vivo, P);

    expect(r.lacuna).toEqual({ de: 1600, ate: 2500 });
    // E a série NÃO ganhou barra de enchimento.
    expect(r.barras.map((b) => b.time)).toEqual([1000, 1300, 2500]);
  });

  it('contíguo não reporta lacuna, e a tolerância cobre fim de semana', () => {
    expect(emendarSeries([barra(1000, 1)], [barra(1300, 2)], P).lacuna).toBeNull();
    // Salto de fim de semana com tolerância declarada pelo consumidor.
    const fimDeSemana = emendarSeries([barra(1000, 1)], [barra(1000 + 3 * 86_400, 2)], P, {
      toleranciaDeSegundos: 3 * 86_400,
    });
    expect(fimDeSemana.lacuna).toBeNull();
  });

  it('⭐ DECISÃO 4: ordena e deduplica mesmo com entrada fora de ordem', () => {
    const hist = [barra(1300, 101), barra(1000, 100)];
    const vivo = [barra(1900, 103), barra(1600, 102)];
    const r = emendarSeries(hist, vivo, P);
    expect(r.barras.map((b) => b.time)).toEqual([1000, 1300, 1600, 1900]);
    for (let i = 1; i < r.barras.length; i += 1) {
      expect(r.barras[i]!.time).toBeGreaterThan(r.barras[i - 1]!.time);
    }
  });

  it('⭐⭐ parcialEm marca a barra EM FORMAÇÃO — o indicador precisa saber', () => {
    const r = emendarSeries([barra(1000, 100)], [barra(1300, 101), barra(1600, 102)], P);
    // A última do ao vivo ainda não fechou.
    expect(r.parcialEm).toBe(1600);
  });

  it('⚠️ sem ao vivo NADA é parcial — o arquivo só tem barra fechada', () => {
    const r = emendarSeries([barra(1000, 100), barra(1300, 101)], [], P);
    expect(r.parcialEm).toBeNull();
    expect(r.emendaEm).toBeNull();
    expect(r.doHistorico).toBe(2);
    expect(r.doAoVivo).toBe(0);
  });

  it('degrada: MT5 fora devolve o histórico intacto e ordenado', () => {
    const r = emendarSeries([barra(1300, 101), barra(1000, 100)], [], P);
    expect(r.barras.map((b) => b.time)).toEqual([1000, 1300]);
    expect(r.lacuna).toBeNull();
  });

  it('degrada: só ao vivo (arquivo fora) funciona e não inventa lacuna', () => {
    const r = emendarSeries([], [barra(1600, 102), barra(1900, 103)], P);
    expect(r.barras.length).toBe(2);
    expect(r.doHistorico).toBe(0);
    expect(r.doAoVivo).toBe(2);
    expect(r.lacuna).toBeNull();
    expect(r.emendaEm).toBe(1600);
  });

  it('as duas vazias devolvem série vazia, sem lançar', () => {
    const r = emendarSeries([], [], P);
    expect(r.barras).toEqual([]);
    expect(r.parcialEm).toBeNull();
  });

  describe('⭐⭐ DECISÃO 5: a grade de período — "as barras não respeitam o TF"', () => {
    const H = 3600;

    it('⭐⭐ MECANISMO: barras de 5min NÃO entram numa série de 1h', () => {
      // Reprodução do defeito relatado, com as proporções medidas contra os serviços reais:
      // o operador troca para 1h, o histórico vem em 1h, e o terminal ainda responde 5min
      // porque a consulta nova leva 7 s.
      const hist1h = [barra(0, 100), barra(3600, 101), barra(7200, 102)];
      const vivo5m = Array.from({ length: 12 }, (_, i) => barra(10_800 + i * 300, 200 + i));

      const r = emendarSeries(hist1h, vivo5m, H);

      // Só as que caem na grade de 1h sobrevivem — no caso, a de 10:800 (múltiplo de 3600).
      expect(r.foraDaGrade).toBeGreaterThan(0);
      // E a invariante que o defeito violava: nenhum par consecutivo mais próximo que 1 h.
      for (let i = 1; i < r.barras.length; i += 1) {
        expect(r.barras[i]!.time - r.barras[i - 1]!.time).toBeGreaterThanOrEqual(H);
      }
    });

    it('⭐ lote INTEIRO de outro período degrada para o histórico puro', () => {
      const hist1h = [barra(0, 100), barra(3600, 101)];
      // Todas desalinhadas da grade de 1h.
      const vivo5m = [barra(7500, 200), barra(7800, 201), barra(8100, 202)];

      const r = emendarSeries(hist1h, vivo5m, H);

      expect(r.barras.map((b) => b.time)).toEqual([0, 3600]);
      expect(r.doAoVivo).toBe(0);
      expect(r.foraDaGrade).toBe(3);
      // ⚠️ E nada de parcial: não há barra do terminal na série.
      expect(r.parcialEm).toBeNull();
      expect(r.emendaEm).toBeNull();
    });

    it('⚠️ a grade CERTA passa inteira — a guarda não é um filtro cego', () => {
      const hist1h = [barra(0, 100), barra(3600, 101)];
      const vivo1h = [barra(7200, 102), barra(10_800, 103)];

      const r = emendarSeries(hist1h, vivo1h, H);

      expect(r.foraDaGrade).toBe(0);
      expect(r.doAoVivo).toBe(2);
      expect(r.barras.map((b) => b.time)).toEqual([0, 3600, 7200, 10_800]);
    });

    it('⭐ SALTO legítimo (fim de semana, feriado, leilão) NÃO é descartado', () => {
      // A invariante é "nunca MAIS PRÓXIMO que um período" — nunca "espaçamento uniforme",
      // que reprovaria qualquer série real.
      const hist = [barra(0, 100), barra(3600, 101)];
      const vivo = [barra(3 * 86_400, 102), barra(3 * 86_400 + 3600, 103)];

      const r = emendarSeries(hist, vivo, H, { toleranciaDeSegundos: 4 * 86_400 });

      expect(r.foraDaGrade).toBe(0);
      expect(r.doAoVivo).toBe(2);
      expect(r.lacuna).toBeNull();
    });

    it('⚠️ o alinhamento vem da MODA do histórico, não da primeira barra', () => {
      // O `D1` do arquivo tem duas convenções de virada de dia; a primeira barra pode ser a
      // exceção. Aqui a maioria está alinhada em 0 e a primeira em 1800.
      const hist = [barra(1800, 99), barra(3600, 100), barra(7200, 101), barra(10_800, 102)];
      const vivo = [barra(14_400, 103)];

      const r = emendarSeries(hist, vivo, H);
      expect(r.foraDaGrade).toBe(0);
      expect(r.doAoVivo).toBe(1);
    });

    it('⚠️ com histórico VAZIO a grade é aferida contra o próprio ao vivo', () => {
      // Uma intrusa entre barras boas: 3600, 3900 (intrusa de 5min), 7200.
      const r = emendarSeries([], [barra(3600, 1), barra(3900, 2), barra(7200, 3)], H);
      expect(r.foraDaGrade).toBe(1);
      expect(r.barras.map((b) => b.time)).toEqual([3600, 7200]);
    });

    it('⚠️ intrusa rejeitada NÃO arrasta as barras boas seguintes', () => {
      // O critério compara com a última ACEITA, não com a anterior do lote.
      const r = emendarSeries([], [barra(0, 1), barra(300, 2), barra(3600, 3), barra(7200, 4)], H);
      expect(r.barras.map((b) => b.time)).toEqual([0, 3600, 7200]);
      expect(r.foraDaGrade).toBe(1);
    });

    it('período inválido não aplica a guarda (nem lança)', () => {
      const r = emendarSeries([barra(0, 1)], [barra(300, 2)], 0);
      expect(r.foraDaGrade).toBe(0);
      expect(r.barras.length).toBe(2);
    });

    describe('⭐⭐ D1: as fontes DISCORDAM do rótulo, e a identidade é o dia', () => {
      const D = 86_400;
      // Medido em 17/09/2026: o pregão de 16/09 é rotulado 16/09 00:00 UTC pelo arquivo e
      // 16/09 03:00 UTC pelo terminal. `floor(t/86400)` dá 20712 para os dois.
      const ARQ_16 = 1_789_516_800;
      const MT5_16 = 1_789_527_600;
      const MT5_17 = 1_789_614_000;

      it('MECANISMO: a guarda por RESTO descartaria o dia corrente — por dia, não', () => {
        // Os restos divergem (0 contra 10800): é o que quebrava.
        expect(ARQ_16 % D).toBe(0);
        expect(MT5_16 % D).toBe(10_800);
        // E a chave de dia coincide: é a identidade certa.
        expect(Math.floor(ARQ_16 / D)).toBe(Math.floor(MT5_16 / D));

        const r = emendarSeries([barra(ARQ_16, 187_600)], [barra(MT5_17, 187_780)], D);
        expect(r.foraDaGrade).toBe(0);
        expect(r.doAoVivo).toBe(1);
        expect(r.barras.length).toBe(2);
      });

      it('⭐⭐ o MESMO pregão não vira DUAS barras (o estrago que envenena correlação)', () => {
        const r = emendarSeries([barra(ARQ_16, 187_600)], [barra(MT5_16, 187_600)], D);
        expect(r.barras.length).toBe(1);
        expect(r.sobrepostas).toBe(1);
        expect(r.doAoVivo).toBe(0);
      });

      it('⚠️ em D1 o RÓTULO do histórico é preservado (o eixo e os desenhos dependem dele)', () => {
        const r = emendarSeries([barra(ARQ_16, 187_600)], [barra(MT5_16, 999_999)], D, {
          aoDivergir: 'EMENDAR_MESMO_ASSIM',
        });
        const b = r.barras[0]!;
        // Conteúdo do ao vivo (mais fresco), tempo do arquivo (convenção dominante).
        expect(b.close).toBe(999_999);
        expect(b.time).toBe(ARQ_16);
      });

      it('em período INTRADIÁRIO o rótulo do ao vivo vence (as fontes concordam da grade)', () => {
        const r = emendarSeries([barra(3600, 1)], [barra(3600, 999)], 3600, {
          aoDivergir: 'EMENDAR_MESMO_ASSIM',
        });
        expect(r.barras[0]!.close).toBe(999);
        expect(r.barras[0]!.time).toBe(3600);
      });

      it('dia novo do terminal entra, e a série fica com um dia a mais', () => {
        const r = emendarSeries(
          [barra(ARQ_16 - D, 100), barra(ARQ_16, 187_600)],
          [barra(MT5_16, 187_600), barra(MT5_17, 187_780)],
          D,
        );
        expect(r.barras.length).toBe(3);
        expect(r.doAoVivo).toBe(1);
        expect(r.sobrepostas).toBe(1);
        expect(r.parcialEm).toBe(MT5_17);
      });
    });

    it('a soma por fonte continua fechando com a guarda ativa', () => {
      const r = emendarSeries(
        [barra(0, 1), barra(3600, 2)],
        [barra(3900, 9), barra(7200, 3)],
        H,
      );
      expect(r.doHistorico + r.doAoVivo).toBe(r.barras.length);
    });
  });

  it('período inválido não lança nem inventa lacuna', () => {
    const r = emendarSeries([barra(1000, 1)], [barra(9999, 2)], 0);
    expect(r.barras.length).toBe(2);
    expect(r.lacuna).toBeNull();
  });

  it('a contagem por fonte sempre soma o total (invariante da trilha de legendas)', () => {
    const r = emendarSeries(
      [barra(1000, 1), barra(1300, 2), barra(1600, 3)],
      [barra(1600, 9), barra(1900, 4)],
      P,
    );
    expect(r.doHistorico + r.doAoVivo).toBe(r.barras.length);
  });
});
