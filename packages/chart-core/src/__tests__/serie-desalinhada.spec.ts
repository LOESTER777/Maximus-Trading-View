/**
 * Serie DESALINHADA do eixo — o defeito do indicador que parava antes da ultima vela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, COMO FOI VISTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O usuario fotografou o playground: as velas iam ate o fim, o histograma de
 * volume tambem, mas a EMA 20 e as bandas de Bollinger **paravam ~20 barras antes
 * da ultima vela**.
 *
 * A causa nao era "faltar um pedaco no fim". O renderer desenhava toda serie com
 * `logicalToCoordinate(ts, i)`, onde `i` era o indice no array DA PROPRIA SERIE —
 * o que afirma que `serie.data[i]` e a barra logica `i`. Isso so vale para a serie
 * que ORIGINA o eixo (as velas).
 *
 * O plotter de indicadores descarta os pontos de aquecimento, entao a EMA 20 sobre
 * 240 velas tem **221** pontos. Desenhados nas colunas 0..220, a serie ficava
 * **deslocada 19 barras para a ESQUERDA**: o valor da barra 19 aparecia na coluna
 * da barra 0. O "termina antes" era o sintoma visivel de um erro de POSICAO — o
 * indicador mentia sobre onde cada valor estava.
 *
 * ⭐ A correcao: posicionar por TEMPO (`janelaDaSerie` no renderer). Estes testes
 * medem o MECANISMO — que um ponto cujo `time` e o da ULTIMA barra seja desenhado
 * na coluna da ULTIMA barra, e nao onde o indice do array cairia.
 *
 * ⚠️ jsdom nao rasteriza. O que se mede e a POSICAO em pixel logico que o motor
 * calcula para cada ponto, via as conversoes publicas do eixo — que sao as mesmas
 * que o renderer usa.
 */
import { describe, expect, it } from 'vitest';
import {
  createTimeScaleState,
  indexToTime,
  logicalToCoordinate,
  timeToIndex,
  visibleLogicalRange,
  type TimeScaleState,
} from '../time-scale.core.js';

const T0 = 1_700_000_000;
const PASSO = 60;

/** Eixo com `n` barras de 1 minuto, largura de 800 px, tudo visivel. */
function eixo(n: number): TimeScaleState {
  const ts = createTimeScaleState(4, 2, 0);
  ts.width = 800;
  ts.times = Array.from({ length: n }, (_, i) => T0 + i * PASSO);
  ts.leftLogical = 0;
  return ts;
}

/**
 * Reimplementa a decisao de POSICAO do renderer para uma serie, do jeito CERTO
 * (por tempo) e do jeito ERRADO (por indice de array).
 *
 * ⚠️ Nao e duplicacao de logica: e a formulacao minima do mecanismo, e ter os DOIS
 * lado a lado e o que faz o teste documentar o defeito em vez de so afirmar o
 * resultado. O caminho errado tem de FALHAR a asserção que o certo passa — e a
 * mesma tecnica do `consistencia.spec.ts` do pacote de desenho, que mantem um
 * conversor defeituoso ao lado do correto.
 */
function xPorTempo(ts: TimeScaleState, tempo: number): number | null {
  const lg = timeToIndex(ts, tempo, true);
  if (lg === null) return null;
  return logicalToCoordinate(ts, lg);
}

function xPorIndiceDeArray(ts: TimeScaleState, indice: number): number | null {
  return logicalToCoordinate(ts, indice);
}

describe('serie desalinhada — o mecanismo do defeito', () => {
  /**
   * ⭐ O TESTE QUE REPRODUZ O DEFEITO.
   *
   * A EMA 20 sobre 240 velas comeca na barra 19 e tem 221 pontos. O ULTIMO ponto
   * dela tem o tempo da ULTIMA vela, logo tem de ser desenhado na MESMA coluna que
   * a ultima vela.
   */
  it('o ultimo ponto do indicador cai na coluna da ULTIMA vela', () => {
    const n = 240;
    const warmup = 19;
    const ts = eixo(n);

    // Tempos da serie do indicador: as barras `warmup..n-1`.
    const tempos = ts.times.slice(warmup);
    expect(tempos).toHaveLength(n - warmup); // 221

    const xUltimaVela = xPorTempo(ts, ts.times[n - 1] as number);
    const xUltimoPontoIndicador = xPorTempo(ts, tempos[tempos.length - 1] as number);

    expect(xUltimoPontoIndicador).not.toBeNull();
    expect(xUltimoPontoIndicador).toBeCloseTo(xUltimaVela!, 9);

    // ⚠️ E a asserção que PEGA o defeito: pelo indice do array, o ultimo ponto
    // (indice 220) cairia na coluna da barra 220, nao da 239 — 19 barras a
    // esquerda. E a distancia exata do que apareceu na foto.
    const xErrado = xPorIndiceDeArray(ts, tempos.length - 1);
    expect(xErrado).not.toBeCloseTo(xUltimaVela!, 3);
    const barrasDeErro = (xUltimaVela! - xErrado!) / ts.barSpacing;
    expect(barrasDeErro).toBeCloseTo(warmup, 9);
  });

  /**
   * ⭐ E o defeito NAO era so no fim: o PRIMEIRO ponto tambem estava no lugar
   * errado. Pelo indice de array ele cairia na coluna 0, quando pertence a coluna
   * 19. Ou seja a serie inteira estava deslocada, nao truncada.
   */
  it('o primeiro ponto do indicador NAO cai na coluna 0 — a serie nao e deslocada', () => {
    const warmup = 19;
    const ts = eixo(240);
    const tempos = ts.times.slice(warmup);

    const xPrimeiroPonto = xPorTempo(ts, tempos[0] as number);
    const xBarra19 = xPorTempo(ts, ts.times[warmup] as number);
    const xBarra0 = xPorTempo(ts, ts.times[0] as number);

    expect(xPrimeiroPonto).toBeCloseTo(xBarra19!, 9);
    expect(xPrimeiroPonto).not.toBeCloseTo(xBarra0!, 3);

    // Pelo indice de array, cairia exatamente na coluna 0 — o erro.
    expect(xPorIndiceDeArray(ts, 0)).toBeCloseTo(xBarra0!, 9);
  });

  /** Todo ponto da serie desalinhada cai na coluna da barra de mesmo tempo. */
  it('CADA ponto cai na coluna da barra de mesmo tempo', () => {
    const warmup = 19;
    const ts = eixo(120);
    const tempos = ts.times.slice(warmup);

    for (let k = 0; k < tempos.length; k++) {
      const t = tempos[k] as number;
      const indiceDaBarra = warmup + k;
      expect(xPorTempo(ts, t)).toBeCloseTo(
        logicalToCoordinate(ts, indiceDaBarra)!,
        9,
      );
    }
  });

  /**
   * Serie ESPARSA — buraco no MEIO, nao só no aquecimento.
   *
   * ⚠️ E o caso que a alternativa "guardar um offset por serie" NAO resolveria, e
   * por isso a correcao foi por tempo: SuperTrend vira `null` na inversao, pivot
   * existe uma vez por sessao, e um feed sujo descarta barra no meio. Com offset
   * unico, tudo depois do buraco voltaria a ficar deslocado.
   */
  it('serie ESPARSA (buraco no meio) mantem cada ponto no lugar', () => {
    const ts = eixo(100);
    // Pontos nas barras 10..29 e 60..79 — um vao de 30 barras no meio.
    const indices = [
      ...Array.from({ length: 20 }, (_, i) => 10 + i),
      ...Array.from({ length: 20 }, (_, i) => 60 + i),
    ];
    const tempos = indices.map((i) => ts.times[i] as number);

    for (let k = 0; k < tempos.length; k++) {
      const esperado = logicalToCoordinate(ts, indices[k] as number);
      expect(xPorTempo(ts, tempos[k] as number)).toBeCloseTo(esperado!, 9);
    }

    // E o ultimo ponto (barra 79) nao cai na coluna 39 (o indice dele no array).
    const xUltimo = xPorTempo(ts, tempos[tempos.length - 1] as number);
    expect(xUltimo).not.toBeCloseTo(logicalToCoordinate(ts, 39)!, 3);
  });

  /**
   * Ponto cujo tempo NAO e barra exata (indicador de outro periodo) cai no lugar
   * INTERPOLADO, em vez de perder a posicao.
   *
   * ⚠️ `timeToCoordinate` direto devolveria `null` aqui — e o mesmo contrato que
   * fazia desenho desaparecer ao trocar de periodo. `findNearest = true` e o que
   * mantem a posicao.
   */
  it('tempo que nao e barra cai na posicao INTERPOLADA', () => {
    const ts = eixo(50);
    // Exatamente entre a barra 10 e a 11.
    const tMeio = (ts.times[10] as number) + PASSO / 2;

    const lg = timeToIndex(ts, tMeio, true);
    expect(lg).toBeCloseTo(10.5, 9);

    const x = xPorTempo(ts, tMeio);
    const x10 = logicalToCoordinate(ts, 10)!;
    const x11 = logicalToCoordinate(ts, 11)!;
    expect(x).toBeCloseTo((x10 + x11) / 2, 9);
  });

  /**
   * O caminho RAPIDO (serie alinhada) tem de dar o MESMO resultado do caminho por
   * tempo. Se divergissem, as velas se moveriam ao ganhar um ponto de indicador na
   * mesma pane — e o defeito seria intermitente.
   */
  it('serie ALINHADA: os dois caminhos coincidem, ponto a ponto', () => {
    const ts = eixo(200);
    const lr = visibleLogicalRange(ts);
    expect(lr).not.toBeNull();

    for (let i = 0; i < ts.times.length; i++) {
      const porTempo = xPorTempo(ts, ts.times[i] as number);
      const porIndice = xPorIndiceDeArray(ts, i);
      expect(porTempo).toBeCloseTo(porIndice!, 9);
    }
  });

  /**
   * A janela de desenho tem de ser resolvida por TEMPO tambem: converter as bordas
   * da janela logica em instante e achar o trecho do array. Sem isso, a serie
   * desalinhada seria percorrida no trecho errado (e no zoom lateral, num trecho
   * que nem esta na tela).
   */
  it('as bordas da janela viram TEMPO para achar o trecho da serie', () => {
    const ts = eixo(300);
    // Zoom num trecho lateral: janela nas barras 200..299.
    ts.barSpacing = 8;
    ts.leftLogical = 200;
    const lr = visibleLogicalRange(ts);
    expect(lr).not.toBeNull();

    const tDe = indexToTime(ts, lr!.from);
    const tAte = indexToTime(ts, lr!.to);
    expect(tDe).toBeCloseTo(ts.times[200] as number, 6);

    // Uma serie de indicador que comeca na barra 19 tem, nessa janela, os pontos
    // de indice 181 em diante (200 - 19). E isso que a busca por tempo encontra.
    const warmup = 19;
    const tempos = ts.times.slice(warmup);
    const primeiroNaJanela = tempos.findIndex((t) => t >= (tDe as number));
    expect(primeiroNaJanela).toBe(200 - warmup);

    // ⚠️ Indexar pelo indice logico (200) daria o ponto da barra 219 — 19 barras
    // adiante do que a janela pede.
    const pontoErrado = tempos[200];
    expect(pontoErrado).toBe(ts.times[200 + warmup]);
    expect(tAte).not.toBeNull();
  });
});
