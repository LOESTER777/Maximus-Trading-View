/**
 * histogram-scale.core — o TETO da escala de um histograma, por percentil.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ O PROBLEMA, MEDIDO NO DADO REAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O volume do mini índice é violentamente concentrado na abertura. Auditado no pregão de
 * 16/09/2026, `WIN` em 5 min (114 barras):
 *
 * ```
 * 09:00  323.151  ████████████████████████████████████████   (o máximo)
 * 11:00   82.508  ██████████
 * 13:00    8.676  █
 * 15:00    8.020
 * 17:50    2.532                                              (0,8 % do máximo)
 * ```
 *
 * A razão entre a abertura e a tarde é de **128x**. Com a escala ancorada em zero e o teto no
 * MÁXIMO — que é o que todo gráfico de volume faz, e o que este motor fazia — as barras da
 * tarde ocupam menos de 1 % da altura disponível. Elas existem, estão corretas, e são
 * **ilegíveis**: o operador não consegue comparar o volume das 15:00 com o das 16:00, que é
 * exatamente a leitura que ele precisa fazer para ler absorção.
 *
 * ⭐ **Esta biblioteca já sabia disso, em outro lugar.** A escala de cor do bookmap usa
 * percentil justamente por esse motivo, e o comentário lá registra a medição:
 * *"p50=481, p90=714, p99=1131, max=36.232; normalizar pelo máximo daria 2% de opacidade ao
 * p90"*. É a mesma aritmética e o mesmo remédio; só não tinha sido aplicado ao histograma.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DECISÃO, E O QUE ELA CUSTA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O teto passa a ser um PERCENTIL da janela visível, e as barras acima dele **estouram** — são
 * desenhadas até o topo e recortadas pela pane.
 *
 * ⚠️ **O custo é real e precisa ser dito:** a barra de abertura deixa de ser proporcional. Quem
 * olhar a altura dela vai subestimar o volume. Em troca, as outras 113 barras passam a ser
 * comparáveis entre si.
 *
 * ⭐ A troca vale porque a pergunta que o operador faz do histograma é RELATIVA
 * (*"este volume é grande para este horário?"*), não absoluta (*"quantos contratos?"*) — para o
 * número absoluto existe o rótulo e o crosshair. E uma barra estourada comunica *"fora de
 * escala"*, que é informação; uma barra de 1 px comunica *"não houve volume"*, que é mentira.
 *
 * ⚠️ **Por isso é OPCIONAL e o default é o comportamento antigo.** Ninguém deve ter a escala do
 * gráfico alterada por atualizar a biblioteca, e há usos legítimos do teto no máximo (comparar
 * dois dias, medir o pico de uma notícia).
 *
 * ⚠️ `.core` = PURO. Sem canvas, sem estado, sem relógio.
 */

/**
 * Percentil default quando se liga o recurso sem escolher: **99**.
 *
 * ⚠️ Escolhido pela distribuição medida, não por gosto. No pregão auditado, o p99 do volume de
 * 5 min é ~1,7x a mediana e ~0,55 do máximo: as barras normais ganham quase o dobro de altura e
 * só a de abertura estoura. Um p90 comprimiria demais (barras de volume alto legítimo passariam
 * a estourar em grupo, e o estouro deixa de informar quando é frequente); um p99,9 quase não
 * mudaria nada em série de 114 pontos, porque não há amostra para o percentil discriminar.
 */
export const PERCENTIL_DE_TETO_DEFAULT = 99;

/**
 * ⭐⭐ Percentil EFETIVO para volume de futuros — medido, e diferente do default conservador.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DESCOBERTA: O PERCENTIL ÚTIL DEPENDE DE QUÃO RARO É O EXTREMO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O p99 corta o 1 % mais alto. Ele só comprime de forma útil quando o extremo É ~1 % da amostra.
 *
 * ⚠️ E no volume do WIN não é. Medido no pregão de 16/09/2026 (114 barras de 5 min): a primeira
 * HORA inteira é alta — cerca de **13 barras**, ou 11 % da amostra. Então:
 *
 * | percentil | teto | ganho de altura | quantas estouram |
 * |---|---|---|---|
 * | p99 | 299.660 | **1,08x** | 1 |
 * | p95 | 273.189 | 1,18x | 5 |
 * | **p90** | **240.276** | **1,34x** | 11 |
 * | p75 | 158.303 | 2,04x | ~28 |
 *
 * ⭐ Com p99 o recurso quase não faz diferença: ele corta a barra de abertura e deixa as outras
 * doze da manhã dominando a escala. O que de fato torna a tarde legível é **p90**, que reconhece
 * a manhã inteira como o regime alto.
 *
 * ⚠️ Por isso o default da OPÇÃO continua 99 (conservador — quem liga sem pensar muda pouco) mas
 * quem monta um gráfico de volume de futuros deve passar `90`. A constante existe para esse
 * valor não ser um número solto no código do consumidor.
 *
 * ⚠️ E p75 é demais: com 28 de 114 barras estourando, o estouro deixa de significar "fora do
 * comum" e a metade superior da escala vira uma faixa achatada de barras iguais.
 */
export const PERCENTIL_PARA_VOLUME_DE_FUTUROS = 90;

/**
 * ⚠️ Piso absoluto de amostras. Abaixo disto nenhum percentil discrimina nada.
 */
export const MIN_AMOSTRAS_PARA_PERCENTIL = 20;

/**
 * ⭐⭐ Quantas amostras um percentil PRECISA para não coincidir com o máximo.
 *
 * ⚠️ **Foi um teste que expôs a necessidade disto**, e o achado é aritmético: com o método do
 * "nearest rank" (`ceil(p/100 · n) − 1`), o p99 sobre 40 amostras cai no índice 39 — que é o
 * ÚLTIMO. Ou seja, o p99 de 40 pontos *é* o máximo, e ligar o recurso não faria absolutamente
 * nada além de gastar uma ordenação por quadro.
 *
 * A condição para o percentil `p` ficar ABAIXO do máximo é `ceil(p/100 · n) < n`, que resolve
 * para `n > 100 / (100 − p)`:
 *
 * | percentil | amostras mínimas |
 * |---|---|
 * | 90 | 10 |
 * | 95 | 20 |
 * | 99 | **100** |
 * | 99,5 | 200 |
 *
 * ⭐ Na prática isso é atendido: uma janela visível de intradiário tem 100 a 400 barras. Mas com
 * o gráfico bem ampliado (20 barras na tela) o p99 volta a ser o máximo — e aí o recurso
 * corretamente se desliga e informa, em vez de fingir que comprimiu.
 */
export function amostrasMinimasParaPercentil(percentil: number): number {
  const p = Math.min(100, Math.max(1, percentil));
  if (p >= 100) return Number.POSITIVE_INFINITY;
  return Math.max(MIN_AMOSTRAS_PARA_PERCENTIL, Math.ceil(100 / (100 - p)) + 1);
}

/** O resultado, com a informação que o consumidor precisa para explicar a tela. */
export interface TetoDeHistograma {
  /** O valor que vira o topo da escala. */
  readonly teto: number;
  /** Quantas amostras ficaram ACIMA do teto (vão estourar). */
  readonly estouram: number;
  /**
   * O percentil foi de fato aplicado?
   *
   * `false` significa que o teto é o máximo — porque não havia amostra suficiente, porque o
   * percentil coincidiu com o máximo, ou porque a distribuição é plana. Quem mostra legenda
   * deve usar isto para não afirmar "escala p99" quando a escala é o máximo.
   */
  readonly usouPercentil: boolean;
}

/**
 * O teto da escala de um histograma, por percentil dos valores POSITIVOS.
 *
 * ⭐ Só os positivos entram na estatística, e isso importa: um histograma que oscila em torno
 * do zero (Awesome Oscillator, delta) tem metade dos valores negativos, e incluí-los na
 * distribuição do "teto" faria o percentil cair para perto de zero. Para a parte negativa existe
 * `pisoPorPercentil`.
 *
 * ⚠️ Devolve o MÁXIMO, com `usouPercentil: false`, em todos os casos degenerados: amostra
 * pequena, nenhum valor positivo, percentil fora de faixa. Nunca devolve zero nem `null` — o
 * teto é usado para dimensionar a escala, e zero colapsaria o desenho.
 *
 * @param valores a janela visível. Não é mutada (a ordenação é feita em cópia).
 * @param percentil 1..100. Fora da faixa é recortado.
 */
export function tetoPorPercentil(
  valores: readonly number[],
  percentil: number = PERCENTIL_DE_TETO_DEFAULT,
): TetoDeHistograma {
  const positivos: number[] = [];
  let maximo = 0;
  for (const v of valores) {
    if (!Number.isFinite(v) || v <= 0) continue;
    positivos.push(v);
    if (v > maximo) maximo = v;
  }

  if (positivos.length === 0) {
    return { teto: 0, estouram: 0, usouPercentil: false };
  }
  const p = Math.min(100, Math.max(1, percentil));
  // ⚠️ O mínimo depende do PERCENTIL, não é um número fixo. Ver
  // `amostrasMinimasParaPercentil`: o p99 sobre 40 amostras É o máximo, e o recurso não faria
  // nada. Degradar aqui é declarar isso em vez de gastar uma ordenação por quadro para nada.
  if (positivos.length < amostrasMinimasParaPercentil(p)) {
    return { teto: maximo, estouram: 0, usouPercentil: false };
  }
  // ⚠️ Cópia antes de ordenar: `valores` é do chamador, e ordenar no lugar embaralharia a série
  // dele — um defeito silencioso do tipo mais difícil de rastrear.
  const ordenados = [...positivos].sort((a, b) => a - b);
  // ⚠️ Índice pelo método do "nearest rank", que é o mesmo do bookmap: `ceil(p/100 · n) − 1`,
  // recortado. Interpolar entre vizinhos daria um teto que não existe na amostra, e o teto
  // precisa ser um volume que de fato ocorreu para a leitura fazer sentido.
  const idx = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  const teto = ordenados[idx] as number;

  // Distribuição plana ou percentil no topo: o percentil não acrescenta nada.
  if (!(teto > 0) || teto >= maximo) {
    return { teto: maximo, estouram: 0, usouPercentil: false };
  }

  let estouram = 0;
  for (const v of positivos) if (v > teto) estouram += 1;
  return { teto, estouram, usouPercentil: true };
}

/**
 * O piso da escala, por percentil dos valores NEGATIVOS. Espelho de `tetoPorPercentil`.
 *
 * ⭐ Existe porque histograma de indicador oscila em torno do zero, e comprimir só um lado
 * deixaria a escala assimétrica — o operador leria "a alta é maior que a baixa" a partir de uma
 * decisão de escala, não do mercado.
 *
 * ⚠️ Devolve `0` quando não há negativos, e isso é o certo: sem valor negativo o piso da escala
 * é o zero, que é a âncora do histograma.
 */
export function pisoPorPercentil(
  valores: readonly number[],
  percentil: number = PERCENTIL_DE_TETO_DEFAULT,
): TetoDeHistograma {
  // Reflete, reusa a mesma aritmética, e reflete de volta. Duas implementações do mesmo
  // percentil divergiriam na primeira correção.
  const espelhado = tetoPorPercentil(
    valores.map((v) => -v),
    percentil,
  );
  // ⚠️ `|| 0` normaliza o `-0`: espelhar zero produz `-0`, que passa em `=== 0` mas falha em
  // `Object.is(x, 0)` e aparece como "-0" em log e em asserção. Sujeira que confunde depuração.
  return { ...espelhado, teto: -espelhado.teto || 0 };
}
