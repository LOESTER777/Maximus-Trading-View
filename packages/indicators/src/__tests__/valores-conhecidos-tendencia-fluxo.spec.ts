/**
 * valores-conhecidos-tendencia-fluxo — ancora numerica dos indicadores de
 * tendencia, canal, fluxo e pivo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE, SE JA HA DOIS TESTES DE PROPRIEDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `incremental-igual-batch` prova que o indicador e CONSISTENTE consigo mesmo e
 * `preview-nao-muta` prova que ele nao se contamina ao vivo. Nenhum dos dois
 * olha para a FORMULA: um SuperTrend que devolvesse sempre a minima da barra
 * passaria os dois folgadamente.
 *
 * Aqui cada valor esperado vem de uma derivacao ARITMETICA ESCRITA no proprio
 * teste, passo a passo, sobre series curtas de numeros redondos. A referencia nao
 * e "o que o codigo devolveu" — e a definicao aplicada a mao. Se a implementacao
 * mudar de comportamento, este arquivo diz QUAL numero mudou e a derivacao ao lado
 * diz qual deveria ser.
 *
 * ⚠️ As series sao deliberadamente curtas e com valores redondos. Serie longa com
 * numeros feios daria mais cobertura e ZERO conferibilidade — ninguem revisa 120
 * barras a mao, e um valor esperado que ninguem consegue conferir e so um registro
 * do que o codigo faz hoje, nao uma prova de que esta certo.
 *
 * ⚠️ Serie A cobre DUAS reversoes de tendencia de proposito (barras 2-3 e 8): e
 * exatamente nas reversoes que SuperTrend e SAR se diferenciam de qualquer outra
 * coisa, e um teste que so passa por tendencia continua nao testa o que importa.
 */
import { describe, it, expect } from 'vitest';

import {
  supertrendFactory,
  parabolicSarFactory,
  ichimokuFactory,
  donchianFactory,
  vwapBandsFactory,
  mfiFactory,
  cmfFactory,
  awesomeOscillatorFactory,
  pivotPointsFactory,
  pivotLevels,
  pivotLevelsFromBars,
  summarizePeriod,
} from '../index.js';
import type { IndicatorBar } from '../contracts.js';

/** Barra a partir de high/low/close (open = close; volume opcional). */
function bar(i: number, high: number, low: number, close: number, volume?: number): IndicatorBar {
  return { time: 1_600_000_000 + i * 60, open: close, high, low, close, volume };
}

/** Extrai a serie de um campo, mantendo nulls. */
function serieDe(
  pontos: readonly { values: Readonly<Record<string, number | null>> }[],
  key: string,
): (number | null)[] {
  return pontos.map((p) => p.values[key] ?? null);
}

/** Confere uma serie esperada (null == aquecendo) com 6 casas. */
function conferir(obtido: readonly (number | null)[], esperado: readonly (number | null)[]): void {
  expect(obtido.length).toBe(esperado.length);
  for (let i = 0; i < esperado.length; i++) {
    const e = esperado[i] ?? null;
    if (e === null) {
      expect(obtido[i], `barra ${i} deveria estar aquecendo (null)`).toBeNull();
    } else {
      expect(obtido[i], `barra ${i} nao deveria ser null`).not.toBeNull();
      expect(obtido[i] as number, `barra ${i}`).toBeCloseTo(e, 6);
    }
  }
}

/**
 * SERIE A — nove barras high/low/close, compartilhada por SuperTrend, SAR,
 * Donchian, AO e Ichimoku.
 *
 *   i | high | low  | close
 *   --+------+------+------
 *   0 |  10  |   8  |  9
 *   1 |  12  |   9  | 11
 *   2 |  11  |   7  |  8     <- queda: derruba o SAR de alta
 *   3 |  13  |  10  | 12     <- alta: derruba o SAR de baixa
 *   4 |  12  |  11  | 11.5
 *   5 |  14  |   9  | 13     <- novo extremo: acelera o SAR
 *   6 |  13  |  11  | 11
 *   7 |  12  |   9  |  9.5
 *   8 |  10  |   6  |  6.5   <- rompe a banda: vira o SuperTrend
 */
const SERIE_A: readonly IndicatorBar[] = (
  [
    [10, 8, 9],
    [12, 9, 11],
    [11, 7, 8],
    [13, 10, 12],
    [12, 11, 11.5],
    [14, 9, 13],
    [13, 11, 11],
    [12, 9, 9.5],
    [10, 6, 6.5],
  ] as const
).map(([h, l, c], i) => bar(i, h, l, c, 100));

describe('valores conhecidos — tendencia, canal, fluxo e pivo', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  it('SuperTrend(3, mult 1) bate com a derivacao a mao, incluindo a reversao', () => {
    /**
     * PASSO 1 — True Range (max entre H-L, |H-Cant|, |L-Cant|):
     *   i0: 10-8 = 2                                (sem anterior: e o H-L)
     *   i1: max(3, |12-9|=3, |9-9|=0)      = 3
     *   i2: max(4, |11-11|=0, |7-11|=4)    = 4
     *   i3: max(3, |13-8|=5, |10-8|=2)     = 5
     *   i4: max(1, |12-12|=0, |11-12|=1)   = 1
     *   i5: max(5, |14-11.5|=2.5, |9-11.5|=2.5) = 5
     *   i6: max(2, |13-13|=0, |11-13|=2)   = 2
     *   i7: max(3, |12-11|=1, |9-11|=2)    = 3
     *   i8: max(4, |10-9.5|=0.5, |6-9.5|=3.5) = 4
     *
     * PASSO 2 — ATR de Wilder(3): semente = media dos 3 primeiros TR, depois
     * `atr += (tr - atr)/3`. ⚠️ Wilder (k=1/3), NAO EMA (k=2/4) — com EMA os
     * numeros abaixo seriam todos outros.
     *   i2: (2+3+4)/3            = 3
     *   i3: 3 + (5-3)/3          = 3.666666667
     *   i4: 3.666667 + (1-3.666667)/3 = 2.777777778
     *   i5: 2.777778 + (5-2.777778)/3 = 3.518518519
     *   i6: 3.518519 + (2-3.518519)/3 = 3.012345679
     *   i7: 3.012346 + (3-3.012346)/3 = 3.008230453
     *   i8: 3.008230 + (4-3.008230)/3 = 3.338820302
     *
     * PASSO 3 — bandas base (hl2 +/- 1*ATR), travagem pela banda anterior e
     * direcao. A travagem usa o fechamento ANTERIOR contra a banda ANTERIOR:
     *
     *   i2: hl2=9,    base=[6.000, 12.000]; sem anterior -> dir=1 (arranque)
     *       -> SuperTrend = banda inferior = 6
     *   i3: hl2=11.5, base=[7.833, 15.167]
     *       fechAnt 8 > infAnt 6      -> inf = max(7.833, 6)      = 7.833333333
     *       fechAnt 8 < supAnt 12     -> sup = min(15.167, 12)    = 12
     *       dir segue 1 (fech 12 nao caiu abaixo de infAnt 6) -> 7.833333333
     *   i4: hl2=11.5, base=[8.722, 14.278]
     *       fechAnt 12 > infAnt 7.833 -> inf = max(8.722, 7.833)  = 8.722222222
     *       fechAnt 12 < supAnt 12? NAO (12<12 e falso) -> sup = 14.277777778
     *       dir 1 -> 8.722222222
     *   i5: hl2=11.5, base=[7.981, 15.019]
     *       inf = max(7.981, 8.722) = 8.722222222   (a travagem SEGURA a linha:
     *       a banda base RECUOU e o SuperTrend nao recua numa alta — e este o
     *       ponto todo da travagem) -> 8.722222222
     *   i6: hl2=12,   base=[8.988, 15.012]; inf = max(8.988, 8.722) = 8.987654321
     *   i7: hl2=10.5, base=[7.492, 13.508]; inf = max(7.492, 8.988) = 8.987654321
     *       sup = min(13.508, 14.278) = 13.508230453
     *   i8: hl2=8,    base=[4.661, 11.339]
     *       inf = max(4.661, 8.988) = 8.987654321
     *       sup = min(11.339, 13.508) = 11.338820302
     *       ⭐ fech 6.5 < infAnt 8.987654 -> REVERSAO: dir = -1, e a linha passa a
     *       ser a banda SUPERIOR = 11.338820302
     */
    const pontos = supertrendFactory.create({ period: 3, mult: 1 }).warmup(SERIE_A);
    conferir(serieDe(pontos, 'value'), [
      null,
      null,
      6,
      7.833333333,
      8.722222222,
      8.722222222,
      8.987654321,
      8.987654321,
      11.338820302,
    ]);
    // A direcao acompanha: alta desde o arranque, baixa so na barra 8.
    conferir(serieDe(pontos, 'direction'), [null, null, 1, 1, 1, 1, 1, 1, -1]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('SAR Parabolico(0.02, 0.2) bate com a derivacao a mao (clamp, reversao e aceleracao)', () => {
    /**
     * ARRANQUE (barra 1): fech 11 >= fech 9 -> ALTA. SAR = minima da barra 0 = 8;
     * EP = max(10, 12) = 12; AF = 0.02.  -> SAR(i1) = 8
     *
     * i2 (H=11 L=7): SAR = 8 + 0.02*(12-8) = 8.08
     *     ⚠️ CLAMP das duas barras anteriores: min(8.08, minAnt 9, minAnt2 8) = 8
     *     minima 7 < 8 -> REVERSAO para baixa. SAR salta para o EP = 12, o EP passa
     *     a ser a minima da barra (7) e o AF volta a 0.02.  -> SAR(i2) = 12
     *
     * i3 (H=13 L=10): SAR = 12 + 0.02*(7-12) = 11.9
     *     clamp de baixa: max(11.9, maxAnt 11, maxAnt2 12) = 12
     *     maxima 13 > 12 -> REVERSAO para alta. SAR = EP = 7, EP = 13, AF = 0.02.
     *     -> SAR(i3) = 7
     *
     * i4 (H=12 L=11): SAR = 7 + 0.02*(13-7) = 7.12
     *     clamp: min(7.12, minAnt 10, minAnt2 7) = 7  <- ⚠️ o clamp MORDE aqui: a
     *     minima da barra 2 (7) segura o SAR, que senao subiria para 7.12.
     *     maxima 12 nao supera o EP 13 -> AF nao sobe.  -> SAR(i4) = 7
     *
     * i5 (H=14 L=9): SAR = 7 + 0.02*(13-7) = 7.12; clamp min(7.12, 11, 10) = 7.12
     *     ⭐ maxima 14 > EP 13 -> EXTREMO NOVO: EP = 14 e AF = 0.04. A aceleracao
     *     acontece SO aqui, nao a cada barra.  -> SAR(i5) = 7.12
     *
     * i6 (H=13 L=11): SAR = 7.12 + 0.04*(14-7.12) = 7.3952       -> 7.3952
     * i7 (H=12 L=9):  SAR = 7.3952 + 0.04*(14-7.3952) = 7.659392 -> 7.659392
     * i8 (H=10 L=6):  SAR = 7.659392 + 0.04*(14-7.659392) = 7.91301632
     *     minima 6 < 7.913 -> REVERSAO: SAR salta para o EP = 14.  -> SAR(i8) = 14
     */
    const pontos = parabolicSarFactory.create({ step: 0.02, max: 0.2 }).warmup(SERIE_A);
    conferir(serieDe(pontos, 'value'), [
      null,
      8,
      12,
      7,
      7,
      7.12,
      7.3952,
      7.659392,
      14,
    ]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('Donchian(3) e o range puro das 3 ultimas barras, com o MEIO do canal', () => {
    /**
     * Janela de 3 barras (INCLUI a corrente), sobre as 5 primeiras da serie A:
     *
     *   i2: max(10,12,11) = 12 ; min(8,9,7) = 7  ; meio = (12+7)/2 = 9.5
     *   i3: max(12,11,13) = 13 ; min(9,7,10) = 7 ; meio = (13+7)/2 = 10
     *   i4: max(11,13,12) = 13 ; min(7,10,11) = 7; meio = (13+7)/2 = 10
     *
     * ⚠️ O meio e (superior+inferior)/2, NAO a SMA dos fechamentos. Confere-se
     * aqui: a SMA(3) dos fechamentos em i3 seria (8+12+11.5)/3 = 10.5, diferente
     * do 10 esperado. Se alguem trocar a definicao, este numero acusa.
     */
    const pontos = donchianFactory.create({ period: 3 }).warmup(SERIE_A.slice(0, 5));
    conferir(serieDe(pontos, 'upper'), [null, null, 12, 13, 13]);
    conferir(serieDe(pontos, 'middle'), [null, null, 9.5, 10, 10]);
    conferir(serieDe(pontos, 'lower'), [null, null, 7, 7, 7]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('Awesome Oscillator(2, 4) usa o PONTO MEDIO, nao o fechamento', () => {
    /**
     * hl2 das 5 primeiras: 9, 10.5, 9, 11.5, 11.5
     *
     *   SMA2: i1=(9+10.5)/2=9.75  i2=(10.5+9)/2=9.75
     *         i3=(9+11.5)/2=10.25 i4=(11.5+11.5)/2=11.5
     *   SMA4: i3=(9+10.5+9+11.5)/4   = 40/4   = 10
     *         i4=(10.5+9+11.5+11.5)/4 = 42.5/4 = 10.625
     *   AO = SMA2 - SMA4: i3 = 0.25 ; i4 = 0.875
     *
     * ⚠️ Com `close` no lugar do ponto medio, i3 daria (12+11.5)/2 -
     * (9+11+8+12)/4 = 11.75 - 10 = 1.75, quase sete vezes o valor certo. E a
     * troca mais comum de implementacao do AO — este numero a pega.
     */
    const pontos = awesomeOscillatorFactory.create({ fast: 2, slow: 4 }).warmup(SERIE_A.slice(0, 5));
    conferir(serieDe(pontos, 'value'), [null, null, null, 0.25, 0.875]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('Ichimoku(2, 4, 6) usa o MEIO DO RANGE de cada janela, e a nuvem espera as duas linhas', () => {
    /**
     * Cada linha e (maxima da janela + minima da janela)/2 — nao a media dos
     * fechamentos. Sobre as 6 primeiras barras da serie A:
     *
     *   Tenkan(2): i1 (12+8)/2=10   i2 (12+7)/2=9.5  i3 (13+7)/2=10
     *              i4 (13+10)/2=11.5  i5 (14+9)/2=11.5
     *   Kijun(4):  i3 (13+7)/2=10   i4 (13+7)/2=10   i5 (14+7)/2=10.5
     *   SenkouB(6):i5 (14+7)/2=10.5
     *   SenkouA = (Tenkan+Kijun)/2: i3 10 ; i4 (11.5+10)/2=10.75 ; i5 (11.5+10.5)/2=11
     *   Chikou = fechamento da barra (ver a decisao de deslocamento no indicador)
     *
     * ⚠️ Em i1 e i2 a Tenkan JA TEM valor e a Senkou A ainda e null: a Senkou A
     * precisa das DUAS linhas, e "metade da Tenkan" seria um numero plausivel e
     * errado. Este teste trava esse null.
     *
     * ⚠️ E a Chikou tem valor desde a barra 0, porque ela E o fechamento — o
     * deslocamento de 26 barras para tras e da plotagem, nao do calculo.
     */
    const pontos = ichimokuFactory
      .create({ tenkan: 2, kijun: 4, senkouB: 6, displacement: 2 })
      .warmup(SERIE_A.slice(0, 6));
    conferir(serieDe(pontos, 'tenkan'), [null, 10, 9.5, 10, 11.5, 11.5]);
    conferir(serieDe(pontos, 'kijun'), [null, null, null, 10, 10, 10.5]);
    conferir(serieDe(pontos, 'senkou_a'), [null, null, null, 10, 10.75, 11]);
    conferir(serieDe(pontos, 'senkou_b'), [null, null, null, null, null, 10.5]);
    conferir(serieDe(pontos, 'chikou'), [9, 11, 8, 12, 11.5, 13]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('VWAP com bandas: desvio PONDERADO POR VOLUME, conferido pela forma longa', () => {
    /**
     * Duas barras, mesmo dia UTC:
     *   i0: H=12 L=8  C=10 -> hlc3 = 10, volume 100
     *   i1: H=22 L=18 C=20 -> hlc3 = 20, volume 300
     *
     * i0: VWAP = 1000/100 = 10. Uma observacao so: variancia 0, bandas colam
     *     na VWAP (10/10/10). ⚠️ Nao e null — o valor E conhecido.
     *
     * i1: VWAP = (10*100 + 20*300)/400 = 7000/400 = 17.5
     *     ⭐ Conferencia pela forma LONGA da variancia ponderada (a definicao),
     *     nao pela forma computacional que o codigo usa:
     *       [100*(10-17.5)² + 300*(20-17.5)²] / 400
     *       = [100*56.25 + 300*6.25] / 400 = 7500/400 = 18.75
     *     desvio = raiz(18.75) = 4.330127019
     *     superior = 17.5 + 4.330127019 = 21.830127019
     *     inferior = 17.5 - 4.330127019 = 13.169872981
     *
     *     O codigo calcula por `E[p²]-E[p]²` (130000/400 - 306.25 = 18.75), que e
     *     algebricamente a mesma coisa e numericamente mais fragil. Conferir pela
     *     forma longa e o que torna este teste uma prova da DEFINICAO, e nao um
     *     eco da implementacao.
     *
     * ⚠️ Desvio PONDERADO: o desvio simples dos dois hlc3 em torno de 17.5 seria
     * raiz((56.25+6.25)/2) = 5.590, e as bandas ficariam em 23.09/11.91. Os
     * numeros acima so fecham com a ponderacao por volume.
     */
    const barras = [bar(0, 12, 8, 10, 100), bar(1, 22, 18, 20, 300)];
    const pontos = vwapBandsFactory.create({ mult: 1 }).warmup(barras);
    conferir(serieDe(pontos, 'value'), [10, 17.5]);
    conferir(serieDe(pontos, 'upper'), [10, 21.830127019]);
    conferir(serieDe(pontos, 'lower'), [10, 13.169872981]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('MFI(2): fluxo por preco tipico, empate nao vota, extremos em 0 e 100', () => {
    /**
     *   i | H  | L  | C  | vol | hlc3 | vs anterior | fluxo (hlc3*vol)
     *   --+----+----+----+-----+------+-------------+------------------
     *   0 | 12 |  8 | 10 | 100 |  10  |     —       | —
     *   1 | 22 | 18 | 20 | 300 |  20  |   SUBIU     | +6000
     *   2 | 16 | 14 | 15 | 200 |  15  |   CAIU      | -3000
     *   3 | 17 | 13 | 15 | 400 |  15  |   IGUAL     | ⚠️ nao vota (0 e 0)
     *   4 | 26 | 24 | 25 | 100 |  25  |   SUBIU     | +2500
     *
     * MFI = 100 * positivo/(positivo+negativo), janela de 2 fluxos:
     *   i0, i1: aquecendo (i0 nao tem anterior; i1 tem 1 fluxo so)
     *   i2: pos 6000, neg 3000 -> 100*6000/9000 = 66.666667
     *   i3: pos 0,    neg 3000 -> 0             ⭐ ZERO de verdade, nao "sem valor"
     *   i4: pos 2500, neg 0    -> 100           ⭐ sem divisao por zero: a forma
     *       publicada (100 - 100/(1+pos/neg)) exigiria caso especial aqui.
     *
     * ⚠️ A barra 3 fecha no MESMO preco tipico da 2 (15) apesar de ter high/low
     * diferentes. E o caso que separa "compara preco tipico" de "compara
     * fechamento": os fechamentos tambem sao 15 e 15 aqui, mas o hlc3 e o que a
     * definicao manda usar, e a barra nao vota para nenhum lado.
     */
    const barras = [
      bar(0, 12, 8, 10, 100),
      bar(1, 22, 18, 20, 300),
      bar(2, 16, 14, 15, 200),
      bar(3, 17, 13, 15, 400),
      bar(4, 26, 24, 25, 100),
    ];
    const pontos = mfiFactory.create({ period: 2 }).warmup(barras);
    conferir(serieDe(pontos, 'value'), [null, null, 66.666666667, 0, 100]);
  });

  it('MFI sem volume nenhum e null (indefinido), nunca 50', () => {
    // Sem volume o fluxo de dinheiro e zero nos dois lados: nao ha "equilibrio",
    // ha AUSENCIA de informacao. null e a resposta honesta.
    const barras = [bar(0, 12, 8, 10), bar(1, 22, 18, 20), bar(2, 16, 14, 15)];
    const pontos = mfiFactory.create({ period: 2 }).warmup(barras);
    expect(serieDe(pontos, 'value')).toEqual([null, null, null]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  it('CMF(2): posicao do fechamento no range, pesada por volume', () => {
    /**
     * multiplicador = ((C-L) - (H-C)) / (H-L) = (2C - H - L)/(H-L)
     *
     *   i | H  | L  | C    | vol | mult                  | fluxo (mult*vol)
     *   --+----+----+------+-----+-----------------------+------------------
     *   0 | 12 |  8 | 10   | 100 | (20-20)/4 = 0         |    0   (meio exato)
     *   1 | 16 | 14 | 16   | 200 | (32-30)/2 = +1        | +200   (fecha na maxima)
     *   2 | 17 | 13 | 13   | 400 | (26-30)/4 = -1        | -400   (fecha na minima)
     *   3 | 20 | 10 | 17.5 | 100 | (35-30)/10 = +0.5     |  +50
     *
     * CMF = soma(fluxo, 2) / soma(volume, 2):
     *   i0: aquecendo (janela de 2 nao encheu)
     *   i1: (0 + 200)/(100+200)   =  200/300 =  0.666667
     *   i2: (200 - 400)/(200+400) = -200/600 = -0.333333
     *   i3: (-400 + 50)/(400+100) = -350/500 = -0.7
     *
     * ⚠️ O CMF vive em -1..+1 por construcao (o multiplicador esta em -1..+1 e o
     * resultado e uma media ponderada dele) — os valores acima respeitam isso.
     */
    const barras = [
      bar(0, 12, 8, 10, 100),
      bar(1, 16, 14, 16, 200),
      bar(2, 17, 13, 13, 400),
      bar(3, 20, 10, 17.5, 100),
    ];
    const pontos = cmfFactory.create({ period: 2 }).warmup(barras);
    conferir(serieDe(pontos, 'value'), [null, 0.666666667, -0.333333333, -0.7]);
  });

  it('CMF: barra sem range nao vota, e janela sem volume e null', () => {
    // H == L: nao existe "onde dentro do range", entao o multiplicador e 0 — a
    // barra nao empurra o CMF para nenhum lado. Aqui as duas barras da janela sao
    // travadas, logo o fluxo total e 0 com volume > 0: CMF = 0 (equilibrio real).
    const travadas = [bar(0, 10, 10, 10, 100), bar(1, 10, 10, 10, 100)];
    const cmfTravado = cmfFactory.create({ period: 2 }).warmup(travadas);
    expect(serieDe(cmfTravado, 'value')).toEqual([null, 0]);

    // Sem volume: denominador 0 -> indefinido -> null, nao 0. A distincao importa,
    // porque 0 aqui seria lido como "pressao equilibrada" num ativo sobre o qual
    // nao se mediu nada.
    const semVolume = [bar(0, 16, 14, 16), bar(1, 17, 13, 13)];
    const cmfSemVol = cmfFactory.create({ period: 2 }).warmup(semVolume);
    expect(serieDe(cmfSemVol, 'value')).toEqual([null, null]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Pivo
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * DIA 1 e DIA 2 em dias UTC vizinhos. 1_728_000_000 = 86400 * 20000, ou seja
   * exatamente a meia-noite UTC de um dia — escolhido assim para a fronteira ser
   * conferivel a olho, sem depender de fuso.
   *
   * Dia 1 agregado: maxima 120 (barra 2), minima 90 (barra 1), fechamento 115
   * (ultima barra do dia).
   */
  const D = 1_728_000_000;
  const SERIE_PIVO: readonly IndicatorBar[] = [
    { time: D, open: 100, high: 110, low: 90, close: 100 },
    { time: D + 3600, open: 100, high: 120, low: 95, close: 115 },
    { time: D + 86400, open: 116, high: 118, low: 112, close: 116 },
  ];

  /**
   * Derivacao dos niveis do dia 2, a partir de H=120 L=90 C=115:
   *
   *   PP = (120+90+115)/3 = 325/3       = 108.333333
   *   range = 120-90 = 30
   *   R1 = 2*PP - L  = 216.666667 - 90  = 126.666667
   *   S1 = 2*PP - H  = 216.666667 - 120 =  96.666667
   *   R2 = PP + 30                      = 138.333333
   *   S2 = PP - 30                      =  78.333333
   *   R3 = H + 2*(PP - L) = 120 + 2*18.333333 = 156.666667
   *   S3 = L - 2*(H - PP) =  90 - 2*11.666667 =  66.666667
   */
  const NIVEIS_ESPERADOS = {
    pp: 108.333333333,
    r1: 126.666666667,
    r2: 138.333333333,
    r3: 156.666666667,
    s1: 96.666666667,
    s2: 78.333333333,
    s3: 66.666666667,
  } as const;

  it('pivotLevels: a formula classica, conferida termo a termo', () => {
    const n = pivotLevels(120, 90, 115);
    for (const [k, v] of Object.entries(NIVEIS_ESPERADOS)) {
      expect(n[k as keyof typeof NIVEIS_ESPERADOS], k).toBeCloseTo(v, 6);
    }
    // ⭐ Ordem estrutural: as resistencias sobem, os suportes descem, o PP no meio.
    // Nao e conferencia de valor — e a invariante que a formula deve respeitar
    // para qualquer entrada coerente, e que um sinal trocado quebraria.
    expect(n.s3 < n.s2 && n.s2 < n.s1 && n.s1 < n.pp).toBe(true);
    expect(n.pp < n.r1 && n.r1 < n.r2 && n.r2 < n.r3).toBe(true);
  });

  it('summarizePeriod agrega maxima/minima do periodo e o ULTIMO fechamento', () => {
    const resumo = summarizePeriod(SERIE_PIVO.slice(0, 2));
    expect(resumo).not.toBeNull();
    expect(resumo?.high).toBe(120);
    expect(resumo?.low).toBe(90);
    // ⚠️ O fechamento e o da ULTIMA barra (115), nao o maior nem o da primeira.
    expect(resumo?.close).toBe(115);
    // Sequencia vazia nao tem resumo: null, nunca zeros (que dariam niveis de
    // pivo em torno do preco zero).
    expect(summarizePeriod([])).toBeNull();
  });

  it('pivot_points fixa os niveis do dia anterior na virada de sessao UTC', () => {
    const pontos = pivotPointsFactory.create().warmup(SERIE_PIVO);
    // ⚠️ Durante a PRIMEIRA sessao nao existe dia anterior: tudo null. Um
    // historico de um unico dia nao produz pivo nenhum, e isso e correto.
    for (const k of ['pp', 'r1', 'r2', 'r3', 's1', 's2', 's3']) {
      expect(serieDe(pontos, k).slice(0, 2)).toEqual([null, null]);
    }
    // Na primeira barra do dia 2, os niveis do dia 1 (120/90/115) estao fixados.
    for (const [k, v] of Object.entries(NIVEIS_ESPERADOS)) {
      expect(pontos[2]?.values[k] as number, k).toBeCloseTo(v, 6);
    }
  });

  it('pivot_points e pivotLevelsFromBars concordam — a fabrica nao reimplementa a formula', () => {
    // A fabrica agrega barra a barra e a funcao pura recebe o dia inteiro de uma
    // vez. Os dois caminhos tem de chegar no mesmo lugar: se divergirem, a
    // agregacao incremental da sessao esta errada (e e ela, nao a formula, a parte
    // que tem estado e portanto pode errar).
    const daFuncao = pivotLevelsFromBars(SERIE_PIVO.slice(0, 2));
    expect(daFuncao).not.toBeNull();
    const daFabrica = pivotPointsFactory.create().warmup(SERIE_PIVO)[2]?.values;
    for (const k of ['pp', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const) {
      expect(daFabrica?.[k] as number, k).toBeCloseTo(daFuncao?.[k] as number, 9);
    }
  });

  it('pivot_points: os niveis NAO se movem durante a sessao, e a barra em formacao nao os move', () => {
    // A natureza do indicador: dentro do dia os niveis sao constantes. Alimentar
    // mais barras do dia 2 nao pode mexer neles — quem os move e so a proxima
    // virada.
    const comMaisBarras: readonly IndicatorBar[] = [
      ...SERIE_PIVO,
      { time: D + 86400 + 3600, open: 116, high: 130, low: 111, close: 129 },
      { time: D + 86400 + 7200, open: 129, high: 131, low: 100, close: 105 },
    ];
    const pontos = pivotPointsFactory.create().warmup(comMaisBarras);
    expect(pontos[3]?.values.pp as number).toBeCloseTo(NIVEIS_ESPERADOS.pp, 6);
    expect(pontos[4]?.values.pp as number).toBeCloseTo(NIVEIS_ESPERADOS.pp, 6);
    // ⭐ E a barra em formacao TAMBEM nao os move: o preview da mesma coisa que o
    // snapshot, e nao contamina o dia seguinte.
    const inst = pivotPointsFactory.create();
    inst.warmup(comMaisBarras);
    const espiada = inst.preview({
      time: D + 86400 + 10800,
      open: 105,
      high: 200,
      low: 5,
      close: 200,
    });
    expect(espiada.pp as number).toBeCloseTo(NIVEIS_ESPERADOS.pp, 6);
    expect(inst.snapshot().pp as number).toBeCloseTo(NIVEIS_ESPERADOS.pp, 6);
  });

  it('pivot_points: o preview de uma barra que ABRE nova sessao mostra os niveis novos sem grava-los', () => {
    /**
     * ⭐ O caso que a virada de sessao torna delicado. A barra em formacao pertence
     * ao dia 3; os niveis dela vem do dia 2, que acabou de fechar. O preview tem de
     * MOSTRAR esses niveis e NAO consolidar nada — se consolidasse, um tick que
     * chegasse com timestamp adiantado fixaria os niveis do dia com base numa
     * sessao incompleta, e o erro ficaria gravado.
     *
     * Dia 2 aqui: uma barra so (H=118 L=112 C=116).
     *   PP = (118+112+116)/3 = 346/3 = 115.333333
     */
    const inst = pivotPointsFactory.create();
    inst.warmup(SERIE_PIVO);
    const antes = inst.snapshot().pp as number;
    const dia3 = { time: D + 2 * 86400, open: 116, high: 125, low: 115, close: 120 };
    const espiada = inst.preview(dia3);
    expect(espiada.pp as number).toBeCloseTo(346 / 3, 6);
    // O estado consolidado continua com os niveis do dia 2 (derivados do dia 1).
    expect(inst.snapshot().pp as number).toBeCloseTo(antes, 9);
    // E o update de verdade produz o mesmo que o preview mostrou.
    expect(inst.update(dia3).pp as number).toBeCloseTo(346 / 3, 6);
  });
});
