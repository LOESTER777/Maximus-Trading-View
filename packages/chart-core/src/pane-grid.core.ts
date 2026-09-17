/**
 * pane-grid.core — a GEOMETRIA das panes, em núcleo puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PEDIDO, E POR QUE ELE ERA UMA PORTA DE MÃO ÚNICA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"redução de altura da seção do histograma, e termos a possibilidade de termos vários
 * indicadores de histograma e também termos um modo de visualização um abaixo do outro ou um
 * ao lado do outro e podermos configurar a quantidade de colunas por linha"*.
 *
 * Empilhar é o que o motor sempre fez: N sub-painéis, N faixas de largura cheia, e a altura
 * do preço encolhendo a cada indicador ligado. Com quatro osciladores o preço perdia mais da
 * metade da tela. Lado a lado, quatro osciladores em duas colunas ocupam DUAS faixas — o
 * preço recupera metade do que perdeu, e nada de informação foi descartado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ A INVARIANTE QUE TORNA A GRADE POSSÍVEL SEM MENTIR NO EIXO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O obstáculo real não era desenhar retângulos: era o EIXO DE TEMPO. O espaçamento de barra
 * (`barSpacing`) é derivado da largura (`width / span`), e a janela visível é
 * `width / barSpacing`. Duas panes lado a lado, cada uma com metade da largura, mostrariam
 * metade das barras — e o operador leria o oscilador de uma janela e o preço de outra, sem
 * nada na tela avisando.
 *
 * ⭐ A saída: **toda pane mostra a MESMA JANELA LÓGICA; a grade só muda a escala
 * GEOMÉTRICA.** Uma coluna de largura `w` recebe `barSpacing` escalado por `w / larguraTotal`.
 * A conta fecha por construção:
 *
 *     janela = width / barSpacing = (W·k) / (bs·k) = W / bs   ← idêntica, para todo k
 *
 * Consequências, e é isto que faz a decisão ser defensável:
 *
 * - Não existe janela por coluna, nem estado de eixo por coluna. Continua UM eixo, UMA
 *   janela, UM `leftLogical`. Pan e zoom em qualquer pane movem o gráfico inteiro, como hoje.
 * - `getVisibleLogicalRange()` não muda de significado. Nenhum consumidor externo quebra.
 * - A correspondência com o painel de preço deixa de ser pixel-a-pixel e passa a ser
 *   PROPORCIONAL: a barra que está a 50% da largura do preço está a 50% da largura da coluna.
 *   ⚠️ Isso é uma perda REAL e ela é declarada — não se pode encostar uma régua vertical do
 *   preço até a coluna. O que a substitui é o crosshair, que é desenhado em cada pane na
 *   posição do MESMO instante (ver `crosshairInPane` no motor): o vínculo temporal continua
 *   visível, só não é mais uma linha reta contínua.
 * - Com UMA coluna, `k = 1` e todo o cálculo degenera no comportamento anterior, byte a byte.
 *   ⭐ É por isso que as bancadas de altura, divisória e escalas seguem valendo sem uma
 *   asserção alterada — e é a melhor evidência de que a mudança não é uma reescrita.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A PANE DE PREÇO NUNCA ENTRA NA GRADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ela sempre ocupa a largura inteira, e não é negociável. Três razões concretas:
 *
 * 1. As ferramentas de DESENHO ancoram em `paneSize()` (sem índice ⇒ pane 0) e em
 *    `timeToCoordinate`, que é X absoluto de canvas. Uma pane 0 estreita deslocaria toda
 *    linha de tendência já salva.
 * 2. Bookmap, footprint e perfil de volume calculam a faixa lateral e o recorte sobre essa
 *    mesma largura.
 * 3. É o painel onde a leitura é de PREÇO EXATO, e é ali que a régua vertical importa.
 *    Comprimir o preço para caber ao lado de um oscilador é o oposto do que o pedido quer.
 *
 * O operador também nunca pediu isso: o pedido é sobre a *seção do histograma*.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `.core` = PURO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Números entram, números saem. Sem DOM, sem canvas, sem estado de módulo. É o que permite
 * medir a geometria da grade sem rasterizar nada — e a geometria é justamente a parte que
 * erra em silêncio.
 */

/** Uma pane, como a política de altura a deixou. Só o que a geometria precisa saber. */
export interface PaneParaArranjo {
  /** Índice ESTÁVEL da pane no motor. Volta em `RetanguloDePane.key`. */
  readonly key: number;
  /** É a pane principal (o preço)? Ela nunca entra na grade. */
  readonly principal: boolean;
  /** Colapsada = altura zero e fora de toda contagem. */
  readonly colapsada: boolean;
  /** Fração de altura decidida pela política (`rebalancePanes` no motor). */
  readonly heightFraction: number;
  /**
   * Peso da LARGURA dentro da linha dela. Normalizado entre os membros da linha.
   *
   * `1` para todas = colunas iguais. É o que a divisória vertical ajusta.
   */
  readonly widthFraction: number;
}

/** Quantas colunas por linha: um número, ou `'auto'` (deriva da largura). */
export type ColunasPorLinha = number | 'auto';

export interface OpcoesDeArranjo {
  /** Largura total do gráfico, em pixel lógico. */
  readonly largura: number;
  /** Altura total do gráfico, em pixel lógico. */
  readonly altura: number;
  /** Altura da tira do eixo de tempo, reservada na base. */
  readonly alturaEixoTempo: number;
  readonly colunas: ColunasPorLinha;
  /**
   * Largura CONFORTÁVEL de uma coluna, usada só no modo `'auto'`.
   *
   * ⚠️ 420 px não é chute: 56 px vão para o eixo de preço da coluna, e sobram ~364 px de
   * área de plotagem. Com a janela típica de 100 a 200 barras, isso dá 2 a 3,6 px por barra —
   * o suficiente para a FORMA do oscilador (que é o que se lê num sub-painel) continuar
   * legível. Abaixo disso o `'auto'` prefere menos colunas, porque uma coluna ilegível não é
   * economia de espaço: é espaço desperdiçado.
   */
  readonly larguraAlvoColuna?: number;
  /**
   * Largura MÍNIMA de uma coluna. Recorta até o pedido EXPLÍCITO do consumidor.
   *
   * ⚠️ 180 px: 56 são do eixo de preço, sobram 124 de plotagem. É o piso em que ainda se
   * distingue subida de descida. Pedir 4 colunas numa janela de 600 px daria 150 px cada, com
   * 94 px de plotagem — e é melhor entregar 3 colunas legíveis do que 4 ilegíveis. O motor
   * expõe o número EFETIVO (ver `ArranjoDeGrade.colunas`) para a interface poder dizer o que
   * de fato aconteceu, em vez de o recorte ser silencioso.
   */
  readonly larguraMinimaColuna?: number;
  /**
   * Teto de colunas. Default 4.
   *
   * ⚠️ Não é limite técnico: é de leitura. Cinco osciladores lado a lado num monitor comum
   * são cinco tiras onde nenhuma se lê, e o operador perde a única coisa que o sub-painel
   * oferece — reconhecer a forma de relance.
   */
  readonly maxColunas?: number;
}

/** O retângulo de uma pane, em pixel lógico, relativo ao canvas. */
export interface RetanguloDePane {
  readonly key: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Linha na grade dos sub-painéis. `-1` para a pane principal e para as colapsadas. */
  readonly linha: number;
  /** Coluna na linha. `0` para a principal e para as colapsadas. */
  readonly coluna: number;
}

/**
 * Uma fronteira HORIZONTAL arrastável: separa a faixa de cima da de baixo.
 *
 * ⭐ `acima`/`abaixo` são LISTAS de key, não uma pane só. Numa grade, quem cede e recebe
 * altura é a LINHA inteira: arrastar a divisória sob uma linha de três osciladores tem de
 * mover os três, senão a linha ficaria com membros de alturas diferentes e sobraria um
 * buraco de canvas no meio do gráfico.
 */
export interface FronteiraHorizontal {
  readonly y: number;
  readonly acima: readonly number[];
  readonly abaixo: readonly number[];
}

/**
 * Uma fronteira VERTICAL arrastável: separa duas colunas VIZINHAS da mesma linha.
 *
 * ⚠️ Tem extensão vertical (`topo`/`base`) porque ela só existe dentro da faixa daquela
 * linha. Sem isso, o cursor viraria `ew-resize` sobre o painel de preço, prometendo um
 * arrasto que não faz nada ali.
 */
export interface FronteiraVertical {
  readonly x: number;
  readonly topo: number;
  readonly base: number;
  readonly esquerda: number;
  readonly direita: number;
}

export interface ArranjoDeGrade {
  readonly retangulos: readonly RetanguloDePane[];
  /** Colunas EFETIVAS — já recortadas pela largura e pela quantidade de sub-painéis. */
  readonly colunas: number;
  /** Quantidade de linhas de sub-painel. */
  readonly linhas: number;
  /** Altura disponível para as panes (total menos a tira do eixo de tempo). */
  readonly alturaUtil: number;
  readonly fronteirasHorizontais: readonly FronteiraHorizontal[];
  readonly fronteirasVerticais: readonly FronteiraVertical[];
}

const LARGURA_ALVO_COLUNA_DEFAULT = 420;
const LARGURA_MINIMA_COLUNA_DEFAULT = 180;
const MAX_COLUNAS_DEFAULT = 4;

/**
 * Quantas colunas de fato couberam.
 *
 * ⭐ O pedido do consumidor é RECORTADO pela largura, e o valor efetivo é publicado no
 * arranjo. Obedecer cegamente a "4 colunas" numa janela estreita entregaria quatro tiras
 * ilegíveis; recusar o pedido deixaria a tela como estava sem dizer por quê. Recortar e
 * DECLARAR é o único caminho que não engana.
 */
export function resolverColunas(
  quantidadeDeSubpaineis: number,
  largura: number,
  opcoes: Pick<OpcoesDeArranjo, 'colunas' | 'larguraAlvoColuna' | 'larguraMinimaColuna' | 'maxColunas'>,
): number {
  if (quantidadeDeSubpaineis <= 0) return 1;
  const teto = Math.max(1, Math.floor(opcoes.maxColunas ?? MAX_COLUNAS_DEFAULT));
  const larg = Number.isFinite(largura) && largura > 0 ? largura : 0;

  if (opcoes.colunas === 'auto') {
    const alvo = opcoes.larguraAlvoColuna ?? LARGURA_ALVO_COLUNA_DEFAULT;
    const cabe = Math.max(1, Math.floor(larg / alvo));
    return Math.min(quantidadeDeSubpaineis, teto, cabe);
  }

  const pedido = Math.floor(opcoes.colunas);
  if (!Number.isFinite(pedido) || pedido < 1) return 1;
  const minima = opcoes.larguraMinimaColuna ?? LARGURA_MINIMA_COLUNA_DEFAULT;
  // ⚠️ Largura zero (container não medido, jsdom) NÃO recorta para zero: cairia em 1 coluna
  // por acidente e o teste de grade mediria empilhamento. Sem largura, o pedido vale.
  const cabe = larg > 0 ? Math.max(1, Math.floor(larg / minima)) : pedido;
  return Math.min(quantidadeDeSubpaineis, teto, pedido, cabe);
}

/**
 * O fator de compressão horizontal de uma pane: `larguraDaPane / larguraTotal`.
 *
 * ⭐⭐ É o número que sustenta a invariante do cabeçalho. Multiplique `barSpacing` por ele e a
 * pane mostra a MESMA janela lógica em menos pixel. Divida um deslocamento de arrasto por ele
 * e o pan dentro de uma coluna estreita acompanha o dedo em vez de correr o dobro.
 *
 * ⚠️ Devolve 1 (e nunca 0 nem infinito) quando a largura total é inutilizável: um fator zero
 * levaria `barSpacing` a zero e toda conversão de tempo passaria a devolver `null` — o gráfico
 * ficaria vazio sem erro nenhum, que é a família de defeito mais caro deste projeto.
 */
export function fatorDeCompressao(larguraDaPane: number, larguraTotal: number): number {
  if (!Number.isFinite(larguraDaPane) || !Number.isFinite(larguraTotal)) return 1;
  if (larguraTotal <= 0 || larguraDaPane <= 0) return 1;
  return larguraDaPane / larguraTotal;
}

/**
 * Calcula os retângulos de todas as panes e as fronteiras arrastáveis.
 *
 * A ORDEM das panes em `panes` é a ordem de empilhamento e de preenchimento da grade: os
 * sub-painéis visíveis vão para a linha 0 da esquerda para a direita, depois a linha 1, e
 * assim por diante.
 *
 * ⚠️ Função TOTAL: entrada degenerada (nenhuma pane, largura zero, fração negativa) devolve um
 * arranjo coerente em vez de falhar. Ela roda dentro de `measure()`, no caminho do
 * redimensionamento — e um `throw` ali derrubaria o gráfico ao arrastar a borda da janela.
 */
export function calcularArranjo(
  panes: readonly PaneParaArranjo[],
  opcoes: OpcoesDeArranjo,
): ArranjoDeGrade {
  const largura = Number.isFinite(opcoes.largura) && opcoes.largura > 0 ? opcoes.largura : 0;
  const alturaUtil = Math.max(
    1,
    (Number.isFinite(opcoes.altura) ? opcoes.altura : 0) - (opcoes.alturaEixoTempo || 0),
  );

  const principal = panes.find((p) => p.principal);
  const subs = panes.filter((p) => !p.principal && !p.colapsada);
  const colunas = resolverColunas(subs.length, largura, opcoes);

  // Agrupa em linhas, na ordem em que as panes existem.
  const linhas: PaneParaArranjo[][] = [];
  for (let i = 0; i < subs.length; i += colunas) {
    linhas.push(subs.slice(i, i + colunas));
  }

  /**
   * ⭐ A altura de uma LINHA é o MÁXIMO das frações dos membros — e é aqui que a economia
   * de altura acontece.
   *
   * Com quatro osciladores de 11% empilhados, os sub-painéis tomavam 44%. Em duas colunas
   * são duas linhas de 11% = 22%, e o preço recupera os outros 22%. Nada foi encolhido:
   * o que mudou é que dois indicadores passaram a dividir a mesma faixa vertical.
   *
   * ⚠️ MÁXIMO e não média nem soma: os membros da linha recebem TODOS a altura da linha
   * (senão sobraria um buraco de canvas ao lado do membro mais baixo), e usar a média
   * encolheria quem pediu mais. Quem pediu 18% e divide a linha com quem pediu 7% recebe
   * os 18% — o pedido maior é o que tem de ser honrado, porque foi feito por alguém que
   * olhou a tela.
   */
  const fracaoDaLinha = linhas.map((membros) =>
    membros.reduce((maior, p) => Math.max(maior, alturaValida(p.heightFraction)), 0),
  );

  // ⭐ A normalização inclui a principal e as LINHAS (não as panes individuais). Com uma
  // coluna, `fracaoDaLinha[i]` é a fração do único membro, então a soma é idêntica à de
  // antes — é o que faz o modo empilhado degenerar no comportamento histórico.
  const somaFracoes =
    alturaValida(principal?.heightFraction ?? 0) + fracaoDaLinha.reduce((a, b) => a + b, 0);
  const denominador = somaFracoes > 0 ? somaFracoes : 1;
  const alturaDe = (fracao: number): number => (alturaValida(fracao) / denominador) * alturaUtil;

  const retangulos: RetanguloDePane[] = [];
  const fronteirasHorizontais: FronteiraHorizontal[] = [];
  const fronteirasVerticais: FronteiraVertical[] = [];

  let y = 0;
  let acimaDaFronteira: number[] = [];

  if (principal !== undefined) {
    const h = alturaDe(principal.heightFraction);
    retangulos.push({
      key: principal.key,
      left: 0,
      top: 0,
      width: largura,
      height: h,
      linha: -1,
      coluna: 0,
    });
    y += h;
    acimaDaFronteira = [principal.key];
  }

  for (let i = 0; i < linhas.length; i += 1) {
    const membros = linhas[i] as PaneParaArranjo[];
    const hLinha = alturaDe(fracaoDaLinha[i] as number);

    // A fronteira ENTRE a faixa anterior e esta linha. Não há fronteira antes da primeira
    // faixa (nada acima para ceder altura).
    if (acimaDaFronteira.length > 0) {
      fronteirasHorizontais.push({
        y,
        acima: acimaDaFronteira,
        abaixo: membros.map((m) => m.key),
      });
    }

    // Larguras dentro da linha, por peso normalizado.
    const somaPesos = membros.reduce((a, m) => a + pesoValido(m.widthFraction), 0);
    const pesoTotal = somaPesos > 0 ? somaPesos : membros.length;
    let x = 0;
    for (let j = 0; j < membros.length; j += 1) {
      const m = membros[j] as PaneParaArranjo;
      const ultimo = j === membros.length - 1;
      // ⚠️ O ÚLTIMO da linha recebe o RESTO exato, e não a sua fatia calculada. Arredondar
      // cada coluna independentemente deixa uma fresta de sub-pixel na borda direita, e
      // nela aparece o fundo da página — visível como um risco vertical claro.
      //
      // ⭐ E é também o que faz a última linha INCOMPLETA esticar: três osciladores em duas
      // colunas dão uma linha de dois e outra de um, e o solitário ocupa a largura inteira.
      // Rejeitado deixar o buraco: canvas vazio não informa nada, e a pane larga é MAIS
      // legível, não menos. O custo declarado é que a compressão horizontal dela difere
      // das outras — a janela é a mesma, a escala geométrica não.
      const w = ultimo
        ? Math.max(0, largura - x)
        : (pesoValido(m.widthFraction) / pesoTotal) * largura;
      retangulos.push({
        key: m.key,
        left: x,
        top: y,
        width: w,
        height: hLinha,
        linha: i,
        coluna: j,
      });
      if (!ultimo) {
        fronteirasVerticais.push({
          x: x + w,
          topo: y,
          base: y + hLinha,
          esquerda: m.key,
          direita: (membros[j + 1] as PaneParaArranjo).key,
        });
      }
      x += w;
    }

    y += hLinha;
    acimaDaFronteira = membros.map((m) => m.key);
  }

  // ⚠️ Pane COLAPSADA também recebe retângulo, com altura zero. `paneRect` nunca devolver
  // `undefined` é o que permite ao motor não testar o caso em cada consulta — e o retângulo
  // de altura zero é a verdade sobre ela: não ocupa espaço e não é alcançável pelo ponteiro.
  for (const p of panes) {
    if (!p.colapsada || p.principal) continue;
    retangulos.push({ key: p.key, left: 0, top: y, width: largura, height: 0, linha: -1, coluna: 0 });
  }

  return {
    retangulos,
    colunas,
    linhas: linhas.length,
    alturaUtil,
    fronteirasHorizontais,
    fronteirasVerticais,
  };
}

/** O retângulo de uma pane no arranjo, ou `null`. */
export function retanguloDe(arranjo: ArranjoDeGrade, key: number): RetanguloDePane | null {
  return arranjo.retangulos.find((r) => r.key === key) ?? null;
}

/**
 * A pane sob um ponto, ou `null`.
 *
 * ⚠️ Substitui o `paneAtY` do motor, que só olhava Y — numa grade, dois retângulos dividem a
 * mesma faixa de Y e a resposta passa a depender de X. Pane de altura zero (colapsada) é
 * PULADA: `y >= top && y <= top + 0` casa exatamente na fronteira dela, e o crosshair na
 * borda entre duas panes visíveis seria atribuído a uma invisível — o rótulo de preço sairia
 * lido na escala errada. É o mesmo cuidado que o `paneAtY` já tinha.
 */
export function paneNoPonto(arranjo: ArranjoDeGrade, x: number, y: number): RetanguloDePane | null {
  for (const r of arranjo.retangulos) {
    if (r.height <= 0) continue;
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return r;
  }
  return null;
}

/** Altura utilizável, ignorando valor não finito ou negativo. */
function alturaValida(f: number): number {
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/** Peso de largura utilizável. Zero ou lixo vale 1 (participação igual). */
function pesoValido(f: number): number {
  return Number.isFinite(f) && f > 0 ? f : 1;
}
