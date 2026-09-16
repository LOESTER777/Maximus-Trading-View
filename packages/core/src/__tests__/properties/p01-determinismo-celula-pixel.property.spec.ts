/**
 * Property 1 — Determinismo do mapeamento célula→pixel. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 3.6.
 *
 * ```
 * ∀ cell, coords, geom:
 *     cellToPixels(cell, coords, geom) === cellToPixels(cell, coords, geom)
 * ```
 *
 * Igualdade estrutural, **incluindo o caso de resultado ausente**.
 *
 * **Validates: Requirements 1.6**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ela proíbe **uma** falha específica, e a falha é visual: se o mesmo dado puder
 * produzir retângulos diferentes em passadas consecutivas, o heatmap **treme**
 * entre frames. O gráfico redesenha a cada movimento de crosshair, então uma
 * célula que oscile um pixel pisca continuamente — e o operador não tem como
 * distinguir tremor de mudança real na liquidez, que é exatamente a informação
 * que a camada existe para dar.
 *
 * Fontes reais de tremor, todas proibidas por esta propriedade:
 *
 * - leitura de relógio no cálculo (a mesma célula muda de lugar com o tempo);
 * - sorteio para desempatar arredondamento;
 * - cache guardado em variável de módulo, que responde diferente na segunda
 *   chamada;
 * - memoização indexada pela **identidade** do objeto de conversão — o embrulho
 *   é recriado a cada frame, então um cache assim acertaria uma vez e erraria na
 *   seguinte.
 *
 * ⚠️ Hoje a implementação é uma função pura e a propriedade passa por
 * construção. Isso não a torna dispensável: ela é a **cerca** que faz qualquer
 * uma das quatro fontes acima ser reprovada no momento em que for introduzida.
 * Sem ela, um cache "para economizar chamada de coordenada" pareceria uma
 * otimização inofensiva.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE "AS MESMAS FUNÇÕES DE CONVERSÃO" SIGNIFICA AQUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O núcleo **nunca reimplementa escala**: `priceToY` e `timeToX` são as funções
 * do próprio gráfico, embrulhadas e recebidas por parâmetro. Logo a propriedade
 * só diz algo se as conversões injetadas forem elas mesmas **puras**. Uma
 * conversão com estado faria as duas chamadas divergirem, e o teste estaria
 * medindo a fixture em vez do código sob teste.
 *
 * Duas defesas, ambas por asserção:
 *
 * 1. As conversões são materializadas de uma **descrição de dados congelada** —
 *    uma fórmula sobre o argumento, sem contador, sem relógio, sem sorteio. Uma
 *    propriedade dedicada confere isso sondando cada conversão três vezes na
 *    mesma entrada.
 * 2. Um controle negativo mostra que a asserção **tem dentes**: com uma
 *    conversão que muda de resposta entre chamadas, as duas execuções divergem e
 *    a comparação reprova. Sem esse controle, uma igualdade sempre verdadeira
 *    seria indistinguível de uma igualdade vazia.
 *
 * A propriedade é afirmada nas duas leituras possíveis de "as mesmas funções": o
 * **mesmo objeto** de conversão nas duas chamadas (a leitura literal, e o que
 * acontece dentro de um frame) e **dois objetos distintos materializados da
 * mesma descrição** (a leitura forte, que reprova memoização por identidade).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE A FINITUDE DA SAÍDA É AFIRMADA JUNTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `Object.is(NaN, NaN)` é **verdadeiro**, e o comparador de igualdade profunda
 * usa `Object.is` para número. Consequência incômoda: uma implementação que
 * devolvesse `{x: NaN, y: NaN, w: NaN, h: NaN}` satisfaria o determinismo
 * perfeitamente — as duas chamadas seriam "iguais" — e ainda assim **nada
 * apareceria na tela**, porque `fillRect` com valor indefinido não lança,
 * simplesmente não desenha.
 *
 * Por isso o caminho de sucesso afirma que os cinco campos que o requisito 1.6
 * enumera — coordenada, largura, altura, lado e cor — são valores definidos. É o
 * que separa "as duas chamadas concordam" de "as duas chamadas concordam em não
 * dizer nada". O inventário completo de pós-condições de `DrawCell` (piso de
 * 1 px, recorte ao viewport, arredondamento) pertence à Property 7, e não é
 * repetido aqui.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * GUARDA CONTRA VACUIDADE — OS QUATRO DESFECHOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `cellToPixels` tem dois desfechos observáveis, e o mais fácil de errar num
 * teste é exercitar só um deles. A defesa está **na própria propriedade
 * principal**, e não em comentário nem em amostragem paralela: os desfechos são
 * contados **nos mesmos 500 casos que fazem as asserções**, e ao fim do teste
 * cada classe tem um piso afirmado. As classes são quatro, porque a ausência tem
 * três causas distintas e uma delas mascararia as outras se fossem contadas
 * juntas:
 *
 * | classe             | significado                                          |
 * |--------------------|------------------------------------------------------|
 * | `RETANGULO`        | devolveu `DrawCell`                                  |
 * | `ENTRADA_INVALIDA` | célula ou geometria com valor indefinido, ou viewport que não cabe 1 px |
 * | `CONVERSAO`        | entrada sã, mas uma conversão devolveu ausência ou valor indefinido |
 * | `FORA`             | entrada sã e conversões definidas, e o retângulo não intersectou o viewport |
 *
 * Medido em 500 casos com semente 42:
 *
 * | classe             | primeira versão | atual  |
 * |--------------------|-----------------|--------|
 * | `RETANGULO`        | **1,4%**        | 47,4%  |
 * | `CONVERSAO`        | —               | 30,0%  |
 * | `ENTRADA_INVALIDA` | —               | 13,6%  |
 * | `FORA`             | —               |  9,0%  |
 *
 * ⚠️ **A primeira versão deste arquivo produzia retângulo em 1,4% dos casos** —
 * ou seja, provava o determinismo quase exclusivamente do caminho de ausência, e
 * a exigência de "igualdade estrutural inclusive no caso ausente" era a única
 * metade de fato verificada. O piso reprovou, e o diagnóstico foi o gerador: as
 * escalas sorteavam `pxPorUnidade` solto, e escala solta joga a célula para fora
 * do viewport quase sempre — `0,13 px` por segundo sobre um pregão de 8 h dá
 * 3.744 px, contra um viewport de 800.
 *
 * A correção foi **ajustar a escala ao viewport**, que é o que o gráfico real
 * faz: a escala mapeia o domínio visível sobre a dimensão em pixels do eixo. Daí
 * a família `ALINHADA`, em que célula, escala e viewport são coerentes entre si. A
 * família `LIVRE` permanece, com peso menor, porque é ela que produz as três
 * causas de ausência.
 *
 * ⚠️ O classificador é usado **exclusivamente para medir cobertura**, nunca como
 * oráculo. O oráculo é sempre "as duas chamadas concordam". Isso importa: um erro
 * no classificador só pode tornar um piso de cobertura errado — jamais pode
 * fazer a propriedade passar quando o núcleo estiver errado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de render
 * e a biblioteca de teste. Aquele módulo é só reexportação, e o fechamento
 * transitivo dos irmãos que ele reexporta alcança um único utilitário de
 * formatação de horário — que não importa nada. Logo não existe caminho daqui até
 * camada de roteamento de conexão, feed de cotação, envio de ordem ou estado de
 * posição, e nada aqui carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Todo insumo é sintetizado pelos geradores, em memória. Nada é lido de rede, de
 * banco ou do sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma
 * escrita acontece em tabela alguma, nenhum evento de decisão é emitido e nenhuma
 * chave de configuração de trading é tocada.
 *
 * Sem DOM, sem relógio, sem `Math.random()`: o único uso de tempo é uma constante
 * de data construída em UTC, e a única aleatoriedade é a do gerador da biblioteca
 * de propriedades, com semente fixa.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que evitar: a verificação de
 * independência inspeciona **integralmente** todo arquivo criado por esta
 * feature, teste incluído, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { cellToPixels } from '@robustus/charts-core';
import type {
  AggregatedCell,
  CellGeometry,
  CoordinateFns,
  DrawCell,
  DrawCellPaint,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso acontece aqui: este
 * projeto já errou conversão em ±3 h somando deslocamento à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** O mesmo instante em SEGUNDOS — a unidade que `timeToX` recebe. */
const ABERTURA_SEG = ABERTURA_MS / 1_000;

/** O único tamanho de balde materializado. */
const BALDE_SEG = 60;
const BALDE_MS = BALDE_SEG * 1_000;

/** Base do eixo de preço e o incremento mínimo do ativo de referência. */
const PRECO_BASE = 176_000;
const PRECO_PASSO = 5;

/** Menor e maior bucket de cor admitidos por `DrawCell`: 16 níveis. */
const BUCKET_MIN = 0;
const BUCKET_MAX = 15;

// ═════════════════════════════════════════════════════════════════════════════
// As conversões de coordenada, materializadas de descrição de dados
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Forma da escala.
 *
 * `LOG` existe porque o gráfico admite eixo de preço logarítmico, e é justamente
 * o modo em que derivar a escala à mão sairia de sincronia com as velas.
 */
type ModoEscala = 'AFIM' | 'LOG';

/**
 * Como a escala se comporta fora da faixa visível.
 *
 * - `AUSENCIA_FORA_DO_DOMINIO` é o comportamento real da biblioteca de gráfico:
 *   ausência de valor significa "fora da escala visível", e é resposta legítima e
 *   frequente, não erro.
 * - `INDEFINIDO_FORA_DO_DOMINIO` modela a variante que devolve valor indefinido
 *   em vez de ausência. É o caso perigoso: sem a checagem de finitude no núcleo,
 *   a coordenada indefinida chegaria ao desenho e a célula desapareceria em
 *   silêncio.
 * - `NENHUM` extrapola sem limite, o que produz retângulo longe do viewport — o
 *   principal caminho até a classe `FORA`.
 * - `SEMPRE_AUSENTE` é o gráfico ainda sem escala atribuída, antes do primeiro
 *   ajuste de janela.
 */
type DefeitoEscala =
  | 'NENHUM'
  | 'AUSENCIA_FORA_DO_DOMINIO'
  | 'INDEFINIDO_FORA_DO_DOMINIO'
  | 'SEMPRE_AUSENTE';

/** Descrição de uma escala. É **dado**, não função: fast-check encolhe isto. */
interface EscalaSpec {
  readonly modo: ModoEscala;
  /** Valor de referência, mapeado para `origemPx`. */
  readonly centro: number;
  readonly origemPx: number;
  /** Pixels por unidade. Negativo inverte o eixo — o caso do preço. */
  readonly pxPorUnidade: number;
  readonly dominioDe: number;
  readonly dominioAte: number;
  readonly defeito: DefeitoEscala;
}

/**
 * Materializa a conversão a partir da descrição.
 *
 * ── POR QUE A DESCRIÇÃO É CONGELADA ──────────────────────────────────────
 *
 * A função devolvida fecha sobre uma **cópia congelada** da descrição, e lê
 * apenas essa cópia e o próprio argumento. Duas consequências, ambas necessárias
 * para o teste dizer algo:
 *
 * - a conversão é pura por construção — não há contador, relógio nem sorteio onde
 *   um estado pudesse morar;
 * - nem o gerador nem uma asserção posterior conseguem alterar o comportamento da
 *   conversão depois de ela existir, o que preserva a comparação entre duas
 *   materializações independentes da mesma descrição.
 *
 * A comparação `!(valor >= de && valor <= ate)` está na forma negada de
 * propósito: valor indefinido reprova as duas desigualdades e cai fora do
 * domínio, em vez de propagar indefinição para dentro da fórmula.
 */
function materializarEscala(spec: EscalaSpec): (valor: number) => number | null {
  const congelado: EscalaSpec = Object.freeze({ ...spec });

  return (valor: number): number | null => {
    if (congelado.defeito === 'SEMPRE_AUSENTE') return null;

    const foraDoDominio = !(valor >= congelado.dominioDe && valor <= congelado.dominioAte);
    if (foraDoDominio) {
      if (congelado.defeito === 'AUSENCIA_FORA_DO_DOMINIO') return null;
      if (congelado.defeito === 'INDEFINIDO_FORA_DO_DOMINIO') return Number.NaN;
      // `NENHUM` extrapola: segue para a fórmula.
    }

    if (congelado.modo === 'LOG') {
      // Escala logarítmica não mapeia valor não positivo. Ausência é a resposta
      // honesta — e é o que a biblioteca real faz em modo logarítmico.
      if (!(valor > 0) || !(congelado.centro > 0)) return null;
      return congelado.origemPx + congelado.pxPorUnidade * Math.log(valor / congelado.centro);
    }

    return congelado.origemPx + congelado.pxPorUnidade * (valor - congelado.centro);
  };
}

/**
 * A escala **ajustada ao viewport** — o que o gráfico real produz.
 *
 * Mapeia `[dominioDe, dominioAte]` sobre `[0, dimensaoPx]`, com `sinal = -1`
 * invertendo o eixo. É esta construção que faz a célula dentro do domínio cair
 * dentro do viewport, e é o que a primeira versão deste arquivo não tinha —
 * sorteando `pxPorUnidade` solto, 98,6% dos casos caíam fora e o caminho de
 * sucesso ficava sem exercício.
 *
 * ⚠️ `sinal = -1` é o caso **normal** no eixo de preço, não a exceção: o eixo
 * vertical do canvas cresce para baixo, então preço maior recebe coordenada
 * menor. É por isso que o núcleo ordena as duas bordas com mínimo e máximo em vez
 * de assumir qual delas é o topo.
 */
function escalaAjustada(
  modo: ModoEscala,
  dominioDe: number,
  dominioAte: number,
  dimensaoPx: number,
  sinal: 1 | -1,
  defeito: DefeitoEscala,
): EscalaSpec {
  const extensao = modo === 'LOG' ? Math.log(dominioAte / dominioDe) : dominioAte - dominioDe;
  return {
    modo,
    centro: dominioDe,
    origemPx: sinal > 0 ? 0 : dimensaoPx,
    pxPorUnidade: extensao > 0 ? (sinal * dimensaoPx) / extensao : 0,
    dominioDe,
    dominioAte,
    defeito,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Cenário
// ═════════════════════════════════════════════════════════════════════════════

/** Uma entrada completa de `cellToPixels`, ainda em forma de dado. */
interface Cenario {
  readonly cell: AggregatedCell;
  readonly escalaTempo: EscalaSpec;
  readonly escalaPreco: EscalaSpec;
  readonly geom: CellGeometry;
  /** `undefined` representa a chamada de três argumentos, a do design. */
  readonly paint: DrawCellPaint | null | undefined;
}

/** Materializa as duas conversões do cenário num objeto novo. */
function coordsDe(cenario: Cenario): CoordinateFns {
  return {
    timeToX: materializarEscala(cenario.escalaTempo),
    priceToY: materializarEscala(cenario.escalaPreco),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — peças
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Quantidade de fila e de execução na faixa que o dado real ocupa, mais os
 * valores indefinidos.
 *
 * A distribuição medida nas 22.721 células com fila do pregão de referência é
 * `p50 = 481 ct`, `p99 = 1.131 ct`, com a maior parede real da banda central em
 * 2.442 ct e o artefato de nível cruzado em 36.232 ct.
 *
 * ⚠️ Estes quatro campos são **inertes** para o mapeamento: o retângulo sai de
 * `tsMs`, de `preco` e da geometria, e a cor chega pronta pelo quarto parâmetro.
 * Eles são gerados justamente para que uma propriedade adiante possa afirmar essa
 * inércia — se um dia a magnitude passar a influenciar a geometria, existirão
 * duas fontes de verdade para o tamanho da célula e a afirmação reprova.
 */
const arbQuantidade = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 2_600 }), weight: 7 },
  {
    arbitrary: fc.constantFrom(
      0,
      481,
      1_131,
      2_442,
      36_232,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ),
    weight: 3,
  },
);

const arbQuantidades = fc.record({
  bid: arbQuantidade,
  ask: arbQuantidade,
  buy: arbQuantidade,
  sell: arbQuantidade,
});

/** Instante realista: borda esquerda de um balde do pregão de referência. */
const arbInstanteRealista = fc.integer({ min: 0, max: 480 }).map((k) => ABERTURA_MS + k * BALDE_MS);

/**
 * Instante muito distante da janela — dias antes ou depois do pregão.
 *
 * É metade do caminho até a classe `FORA`: com escala que extrapola, um instante
 * assim produz coordenada finita e longíssima do viewport, que é exatamente o
 * caso "não intersecta" que o requisito 3.6 manda omitir.
 */
const arbInstanteDistante = fc
  .integer({ min: -30, max: 30 })
  .map((dias) => ABERTURA_MS + dias * 86_400_000);

const arbInstanteIndefinido = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0,
  -1e308,
);

const arbPrecoRealista = fc
  .integer({ min: -400, max: 400 })
  .map((j) => PRECO_BASE + j * PRECO_PASSO);

const arbPrecoDistante = fc.constantFrom(
  PRECO_BASE - 60_000,
  PRECO_BASE + 60_000,
  PRECO_BASE * 4,
  1,
);

const arbPrecoIndefinido = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0,
  -PRECO_BASE,
);

/** Célula sorteada livremente: as três faixas de posição e as quatro magnitudes. */
const arbCelulaLivre: fc.Arbitrary<AggregatedCell> = fc
  .record({
    tsMs: fc.oneof(
      { arbitrary: arbInstanteRealista, weight: 6 },
      { arbitrary: arbInstanteDistante, weight: 3 },
      { arbitrary: arbInstanteIndefinido, weight: 1 },
    ),
    preco: fc.oneof(
      { arbitrary: arbPrecoRealista, weight: 6 },
      { arbitrary: arbPrecoDistante, weight: 3 },
      { arbitrary: arbPrecoIndefinido, weight: 1 },
    ),
    quantidades: arbQuantidades,
  })
  .map(({ tsMs, preco, quantidades }) => ({ tsMs, preco, ...quantidades }));

const arbDefeitoQualquer = fc.oneof(
  { arbitrary: fc.constant<DefeitoEscala>('NENHUM'), weight: 5 },
  { arbitrary: fc.constant<DefeitoEscala>('AUSENCIA_FORA_DO_DOMINIO'), weight: 3 },
  { arbitrary: fc.constant<DefeitoEscala>('INDEFINIDO_FORA_DO_DOMINIO'), weight: 1 },
  { arbitrary: fc.constant<DefeitoEscala>('SEMPRE_AUSENTE'), weight: 1 },
);

/** Os dois comportamentos que a biblioteca de gráfico de fato apresenta. */
const arbDefeitoRealista = fc.oneof(
  { arbitrary: fc.constant<DefeitoEscala>('AUSENCIA_FORA_DO_DOMINIO'), weight: 3 },
  { arbitrary: fc.constant<DefeitoEscala>('NENHUM'), weight: 2 },
);

const arbModo = fc.oneof(
  { arbitrary: fc.constant<ModoEscala>('AFIM'), weight: 4 },
  { arbitrary: fc.constant<ModoEscala>('LOG'), weight: 1 },
);

/** Extensão do domínio de tempo, em baldes — o "zoom" horizontal. */
const arbBaldesDoDominio = fc.constantFrom(1, 30, 120, 480);

/** Metade da extensão do domínio de preço, em pontos — o "zoom" vertical. */
const arbRaioDoDominio = fc.constantFrom(50, 500, 2_000, 20_000);

/**
 * Escala de tempo **descolada** do viewport: origem e inclinação sorteadas.
 *
 * `pxPorUnidade` inclui `0` (janela colapsada, em que as duas bordas do balde
 * caem no mesmo pixel e o piso de 1 px é o que mantém a célula visível), valor
 * negativo (eixo invertido) e `1e308` — este último para que a multiplicação
 * estoure e a conversão devolva valor indefinido mesmo em modo `NENHUM`, que é o
 * caminho que a checagem de finitude do núcleo existe para cobrir.
 */
const arbEscalaTempoLivre: fc.Arbitrary<EscalaSpec> = fc
  .record({
    modo: arbModo,
    origemPx: fc.constantFrom(0, 40, 400, -5_000, 5_000),
    pxPorUnidade: fc.constantFrom(0, 0.02, 0.13, 1.5, -0.13, 1e308),
    baldesDoDominio: arbBaldesDoDominio,
    defeito: arbDefeitoQualquer,
  })
  .map(({ modo, origemPx, pxPorUnidade, baldesDoDominio, defeito }) => ({
    modo,
    centro: ABERTURA_SEG,
    origemPx,
    pxPorUnidade,
    dominioDe: ABERTURA_SEG,
    dominioAte: ABERTURA_SEG + baldesDoDominio * BALDE_SEG,
    defeito,
  }));

/** Escala de preço descolada do viewport. */
const arbEscalaPrecoLivre: fc.Arbitrary<EscalaSpec> = fc
  .record({
    modo: arbModo,
    origemPx: fc.constantFrom(0, 30, 200, -4_000, 4_000),
    pxPorUnidade: fc.constantFrom(-2, -0.4, 0, 0.4, 2, 1e308),
    raioDoDominio: arbRaioDoDominio,
    defeito: arbDefeitoQualquer,
  })
  .map(({ modo, origemPx, pxPorUnidade, raioDoDominio, defeito }) => ({
    modo,
    centro: PRECO_BASE,
    origemPx,
    pxPorUnidade,
    dominioDe: PRECO_BASE - raioDoDominio,
    dominioAte: PRECO_BASE + raioDoDominio,
    defeito,
  }));

/** Geometria sã: viewport de tamanho plausível e fatores de agrupamento reais. */
const arbGeometriaSa: fc.Arbitrary<CellGeometry> = fc.record({
  baldeSeg: fc.constant(BALDE_SEG),
  fatorTempo: fc.constantFrom(1, 2, 3, 11, 64),
  tickSize: fc.constantFrom(PRECO_PASSO, 0.5, 0.01),
  fatorPreco: fc.constantFrom(1, 2, 4, 64),
  // `799,5` e `400,5` são fracionários de propósito: a razão de bitmap do
  // dispositivo produz dimensões assim, e é o que exercita o piso do limite do
  // eixo para inteiro dentro do recorte.
  widthPx: fc.constantFrom(3, 40, 120, 300, 799.5, 800, 1_600),
  heightPx: fc.constantFrom(2, 30, 80, 200, 400.5, 900),
});

/**
 * Geometria que o núcleo tem de recusar: dimensão indefinida, viewport que não
 * cabe uma célula de 1 px, fator ou tick não positivo.
 *
 * Recusar é devolver ausência — e a ausência também tem de ser determinística,
 * que é a metade do enunciado que um gerador só com geometria sã deixaria sem
 * verificação.
 */
const arbGeometriaHostil: fc.Arbitrary<CellGeometry> = arbGeometriaSa.chain((base) =>
  fc.oneof(
    fc.constant({ ...base, widthPx: 0 }),
    fc.constant({ ...base, widthPx: 0.5 }),
    fc.constant({ ...base, widthPx: -10 }),
    fc.constant({ ...base, widthPx: Number.NaN }),
    fc.constant({ ...base, widthPx: Number.POSITIVE_INFINITY }),
    fc.constant({ ...base, heightPx: 0 }),
    fc.constant({ ...base, heightPx: 0.5 }),
    fc.constant({ ...base, heightPx: Number.NaN }),
    fc.constant({ ...base, baldeSeg: Number.NaN }),
    fc.constant({ ...base, baldeSeg: 0 }),
    fc.constant({ ...base, fatorTempo: 0 }),
    fc.constant({ ...base, fatorTempo: -1 }),
    fc.constant({ ...base, fatorTempo: Number.POSITIVE_INFINITY }),
    fc.constant({ ...base, tickSize: 0 }),
    fc.constant({ ...base, tickSize: -PRECO_PASSO }),
    fc.constant({ ...base, fatorPreco: Number.NaN }),
  ),
);

/** Cor válida: bucket dentro dos 16 níveis, lado conhecido. */
const arbPaintValido: fc.Arbitrary<DrawCellPaint> = fc.record({
  bucket: fc.integer({ min: BUCKET_MIN, max: BUCKET_MAX }),
  side: fc.constantFrom<DrawCell['side']>('BID', 'ASK'),
  aboveScale: fc.boolean(),
});

/**
 * Cor fora do domínio.
 *
 * `bucket` é declarado como número, então valor negativo, fracionário, excedente
 * ou indefinido é **tipável** e pode chegar de um cálculo de escala errado a
 * montante. O lado desconhecido exige conversão explícita de tipo: ele modela
 * chamada vinda de código sem checagem estática, que é como um valor assim
 * apareceria na prática. Os dois caminhos de normalização também precisam ser
 * determinísticos.
 */
const arbPaintHostil: fc.Arbitrary<DrawCellPaint> = fc.record({
  bucket: fc.constantFrom(-3, 99, 7.4, Number.NaN, Number.POSITIVE_INFINITY, BUCKET_MAX + 1),
  side: fc.constantFrom<DrawCell['side']>(
    'BID',
    'ASK',
    'DESCONHECIDO' as unknown as DrawCell['side'],
  ),
  aboveScale: fc.boolean(),
});

/**
 * O quarto argumento, nas quatro formas admitidas pela assinatura: ausente,
 * indefinido, nulo e informado. As duas primeiras adotam a célula mais fraca da
 * escala, e essa escolha também tem de ser estável entre chamadas.
 */
const arbPaintArgumento: fc.Arbitrary<DrawCellPaint | null | undefined> = fc.oneof(
  { arbitrary: fc.constant<DrawCellPaint | null | undefined>(undefined), weight: 2 },
  { arbitrary: fc.constant<DrawCellPaint | null | undefined>(null), weight: 1 },
  { arbitrary: arbPaintValido, weight: 5 },
  { arbitrary: arbPaintHostil, weight: 2 },
);

// ═════════════════════════════════════════════════════════════════════════════
// Geradores — as duas famílias de cenário
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Família `ALINHADA`: célula, escala e viewport coerentes entre si.
 *
 * A escala mapeia o domínio visível sobre a dimensão do eixo, e a célula é
 * posicionada **dentro** desse domínio — que é o estado normal do gráfico. É esta
 * família que exercita o caminho de sucesso, e sem ela a propriedade estaria
 * provando o determinismo apenas da ausência.
 *
 * A célula é quantizada na grade real (borda de balde no tempo, múltiplo do tick
 * no preço) porque é assim que ela chega da agregação: `tsMs` é a borda ESQUERDA
 * do grupo de baldes e `preco` o CENTRO do grupo de ticks.
 */
const arbCenarioAlinhado: fc.Arbitrary<Cenario> = fc
  .record({
    geom: arbGeometriaSa,
    modoTempo: arbModo,
    modoPreco: arbModo,
    baldesDoDominio: arbBaldesDoDominio,
    raioDoDominio: arbRaioDoDominio,
    sinalTempo: fc.constantFrom<1 | -1>(1, -1),
    sinalPreco: fc.constantFrom<1 | -1>(-1, 1),
    defeitoTempo: arbDefeitoRealista,
    defeitoPreco: arbDefeitoRealista,
    // Posição relativa dentro do domínio, em `[0, 1]` no tempo e `[-1, 1]` no
    // preço. Os extremos entram para exercitar a borda do viewport, onde o piso
    // de 1 px e o recorte se tensionam.
    posicaoNoTempo: fc.double({ min: 0, max: 1, noNaN: true }),
    posicaoNoPreco: fc.double({ min: -1, max: 1, noNaN: true }),
    quantidades: arbQuantidades,
    paint: arbPaintArgumento,
  })
  .map(
    ({
      geom,
      modoTempo,
      modoPreco,
      baldesDoDominio,
      raioDoDominio,
      sinalTempo,
      sinalPreco,
      defeitoTempo,
      defeitoPreco,
      posicaoNoTempo,
      posicaoNoPreco,
      quantidades,
      paint,
    }): Cenario => {
      const tempoDe = ABERTURA_SEG;
      const tempoAte = ABERTURA_SEG + baldesDoDominio * BALDE_SEG;
      const precoDe = PRECO_BASE - raioDoDominio;
      const precoAte = PRECO_BASE + raioDoDominio;

      const balde = Math.round(posicaoNoTempo * baldesDoDominio);
      const passos = Math.round((posicaoNoPreco * raioDoDominio) / PRECO_PASSO);

      return {
        cell: {
          tsMs: ABERTURA_MS + balde * BALDE_MS,
          preco: PRECO_BASE + passos * PRECO_PASSO,
          ...quantidades,
        },
        escalaTempo: escalaAjustada(
          modoTempo,
          tempoDe,
          tempoAte,
          geom.widthPx,
          sinalTempo,
          defeitoTempo,
        ),
        escalaPreco: escalaAjustada(
          modoPreco,
          precoDe,
          precoAte,
          geom.heightPx,
          sinalPreco,
          defeitoPreco,
        ),
        geom,
        paint,
      };
    },
  );

/**
 * Família `LIVRE`: nada é coerente com nada.
 *
 * Escala descolada do viewport, célula em qualquer posição — inclusive a dias do
 * pregão e com valor indefinido — e geometria que pode ser degenerada. É esta
 * família que produz as três causas de ausência, e é ela que a primeira versão
 * deste arquivo tinha sozinha.
 */
const arbCenarioLivre: fc.Arbitrary<Cenario> = fc.record({
  cell: arbCelulaLivre,
  escalaTempo: arbEscalaTempoLivre,
  escalaPreco: arbEscalaPrecoLivre,
  geom: fc.oneof(
    { arbitrary: arbGeometriaSa, weight: 6 },
    { arbitrary: arbGeometriaHostil, weight: 4 },
  ),
  paint: arbPaintArgumento,
});

const arbCenario: fc.Arbitrary<Cenario> = fc.oneof(
  { arbitrary: arbCenarioAlinhado, weight: 6 },
  { arbitrary: arbCenarioLivre, weight: 4 },
);

// ═════════════════════════════════════════════════════════════════════════════
// Classificação de desfecho — só para medir cobertura, nunca como oráculo
// ═════════════════════════════════════════════════════════════════════════════

type ClasseDesfecho = 'RETANGULO' | 'ENTRADA_INVALIDA' | 'CONVERSAO' | 'FORA';

/** Verdadeiro só para número definido e finito. */
function ehFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/**
 * A célula e a geometria admitem cálculo?
 *
 * Escrito a partir do texto dos requisitos, não copiado da implementação: valor
 * indefinido em qualquer campo usado no cálculo, e viewport que não caiba uma
 * célula de 1 px, tornam o retângulo impossível de definir.
 */
function entradaAdmiteCalculo(cenario: Cenario): boolean {
  const { cell, geom } = cenario;
  const usados = [
    cell.tsMs,
    cell.preco,
    geom.baldeSeg,
    geom.fatorTempo,
    geom.tickSize,
    geom.fatorPreco,
    geom.widthPx,
    geom.heightPx,
  ];
  if (usados.some((valor) => !ehFinito(valor))) return false;
  return geom.widthPx >= 1 && geom.heightPx >= 1;
}

/**
 * As quatro conversões que o mapeamento precisa devolveram valor utilizável?
 *
 * As entradas são as mesmas quatro que o núcleo consulta: as duas bordas do grupo
 * de baldes, em SEGUNDOS, e as duas bordas do grupo de ticks, a meia altura do
 * centro para cada lado.
 */
function conversoesUteis(cenario: Cenario, coords: CoordinateFns): boolean {
  const tIni = cenario.cell.tsMs / 1_000;
  const tFim = tIni + cenario.geom.baldeSeg * cenario.geom.fatorTempo;
  const meiaAltura = (cenario.geom.tickSize * cenario.geom.fatorPreco) / 2;
  const precoTopo = cenario.cell.preco + meiaAltura;
  const precoBase = cenario.cell.preco - meiaAltura;

  if (!ehFinito(tIni) || !ehFinito(tFim)) return false;
  if (!ehFinito(precoTopo) || !ehFinito(precoBase)) return false;

  return [
    coords.timeToX(tIni),
    coords.timeToX(tFim),
    coords.priceToY(precoTopo),
    coords.priceToY(precoBase),
  ].every((valor) => ehFinito(valor));
}

/**
 * Em qual das quatro classes o caso caiu.
 *
 * ⚠️ Recebe o resultado **observado** e só o usa para separar sucesso de
 * ausência; as causas da ausência são deduzidas dos requisitos. Assim um erro
 * aqui não consegue fazer a propriedade passar indevidamente — no máximo torna um
 * piso de cobertura impreciso.
 */
function classificar(
  cenario: Cenario,
  coords: CoordinateFns,
  resultado: DrawCell | null,
): ClasseDesfecho {
  if (resultado !== null) return 'RETANGULO';
  if (!entradaAdmiteCalculo(cenario)) return 'ENTRADA_INVALIDA';
  if (!conversoesUteis(cenario, coords)) return 'CONVERSAO';
  return 'FORA';
}

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 1: determinismo do mapeamento célula→pixel', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // O enunciado, com a guarda de vacuidade nos mesmos casos que o afirmam
  // ───────────────────────────────────────────────────────────────────────────

  it('duas chamadas com a mesma célula, as mesmas conversões e a mesma geometria devolvem resultado estruturalmente igual, inclusive quando o resultado é ausente', () => {
    // Os desfechos são contados **nos próprios casos que fazem as asserções**, e
    // não numa amostragem paralela. Sem estes contadores, um gerador que deixasse
    // de produzir ausência — ou que deixasse de produzir retângulo, que foi o que
    // aconteceu na primeira versão deste arquivo — tornaria metade do enunciado
    // sem verificação, e o único sintoma seria a suíte continuar verde.
    const ocorrencias: Record<ClasseDesfecho, number> = {
      RETANGULO: 0,
      ENTRADA_INVALIDA: 0,
      CONVERSAO: 0,
      FORA: 0,
    };

    fc.assert(
      fc.property(arbCenario, (cenario) => {
        // Um único objeto de conversão nas duas chamadas: é a leitura literal de
        // "as mesmas funções de coordenada", e é o que acontece dentro de um
        // frame de desenho.
        const coords = coordsDe(cenario);

        const primeira = cellToPixels(cenario.cell, coords, cenario.geom, cenario.paint);
        const segunda = cellToPixels(cenario.cell, coords, cenario.geom, cenario.paint);

        ocorrencias[classificar(cenario, coords, primeira)] += 1;

        // Igualdade estrutural estrita. Cobre os dois desfechos de uma vez:
        // ausência nas duas chamadas, ou retângulo com os seis campos iguais.
        expect(segunda).toStrictEqual(primeira);

        // A ausência é dita explicitamente, e nos dois sentidos — uma chamada não
        // pode devolver retângulo e a outra ausência.
        expect(segunda === null).toBe(primeira === null);

        if (primeira === null || segunda === null) return;

        // ⚠️ `Object.is(NaN, NaN)` é verdadeiro, então a igualdade acima seria
        // satisfeita por uma saída inteiramente indefinida — que o canvas
        // simplesmente não desenharia, sem lançar. Afirmar que os cinco campos do
        // requisito 1.6 são definidos é o que separa "as duas chamadas concordam"
        // de "concordam em não dizer nada".
        expect(ehFinito(primeira.x)).toBe(true);
        expect(ehFinito(primeira.y)).toBe(true);
        expect(ehFinito(primeira.w)).toBe(true);
        expect(ehFinito(primeira.h)).toBe(true);
        expect(ehFinito(primeira.bucket)).toBe(true);
        expect(primeira.side === 'BID' || primeira.side === 'ASK').toBe(true);
        expect(typeof primeira.aboveScale).toBe('boolean');

        // E a igualdade vale campo a campo com identidade de valor, que distingue
        // zero negativo de zero positivo — duas coordenadas que a comparação
        // estrutural também distingue, mas que aqui ficam ditas.
        expect(Object.is(segunda.x, primeira.x)).toBe(true);
        expect(Object.is(segunda.y, primeira.y)).toBe(true);
        expect(Object.is(segunda.w, primeira.w)).toBe(true);
        expect(Object.is(segunda.h, primeira.h)).toBe(true);
        expect(Object.is(segunda.bucket, primeira.bucket)).toBe(true);
        expect(segunda.side).toBe(primeira.side);
        expect(segunda.aboveScale).toBe(primeira.aboveScale);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    const total =
      ocorrencias.RETANGULO +
      ocorrencias.ENTRADA_INVALIDA +
      ocorrencias.CONVERSAO +
      ocorrencias.FORA;
    expect(total).toBe(NUM_RUNS);

    // Os dois desfechos do enunciado, cada um com massa relevante. Os pisos são
    // folgados em relação ao medido, de propósito: servem para detectar colapso
    // do gerador, não para fixar a distribuição corrente.
    expect(ocorrencias.RETANGULO / NUM_RUNS).toBeGreaterThan(0.15);
    expect((NUM_RUNS - ocorrencias.RETANGULO) / NUM_RUNS).toBeGreaterThan(0.15);

    // E as três causas de ausência, separadamente: contadas juntas, a mais
    // frequente mascararia as outras duas. `FORA` é a mais rara das três — 9,0%
    // no medido — porque exige entrada sã, conversão definida e ainda assim
    // retângulo longe do viewport.
    expect(ocorrencias.ENTRADA_INVALIDA / NUM_RUNS).toBeGreaterThan(0.03);
    expect(ocorrencias.CONVERSAO / NUM_RUNS).toBeGreaterThan(0.08);
    expect(ocorrencias.FORA / NUM_RUNS).toBeGreaterThan(0.02);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A leitura forte: duas materializações distintas da mesma escala
  // ───────────────────────────────────────────────────────────────────────────

  it('duas materializações independentes das mesmas escalas produzem o mesmo resultado — não há memoização por identidade do objeto de conversão', () => {
    let comRetangulo = 0;
    let comAusencia = 0;

    fc.assert(
      fc.property(arbCenario, (cenario) => {
        // Objetos diferentes, comportamento idêntico. É a diferença que importa:
        // um cache indexado pela identidade do objeto de conversão passaria na
        // propriedade anterior e falharia aqui — e é justamente o defeito mais
        // provável, porque o embrulho é recriado a cada frame.
        const primeirasCoords = coordsDe(cenario);
        const segundasCoords = coordsDe(cenario);
        expect(primeirasCoords).not.toBe(segundasCoords);

        const primeira = cellToPixels(cenario.cell, primeirasCoords, cenario.geom, cenario.paint);
        const segunda = cellToPixels(cenario.cell, segundasCoords, cenario.geom, cenario.paint);

        if (primeira === null) comAusencia += 1;
        else comRetangulo += 1;

        expect(segunda).toStrictEqual(primeira);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    expect(comRetangulo).toBeGreaterThan(0);
    expect(comAusencia).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O quarto parâmetro
  // ───────────────────────────────────────────────────────────────────────────

  it('a chamada de três argumentos e a chamada com cor concordam na ausência e na geometria: informar cor não introduz não-determinismo', () => {
    let comRetangulo = 0;
    let comAusencia = 0;
    let corMudouOBucket = 0;

    fc.assert(
      fc.property(arbCenario, arbPaintValido, (cenario, cor) => {
        const coords = coordsDe(cenario);

        // A forma de três argumentos — a assinatura que o design fixa. Chamada
        // duas vezes para que a omissão do quarto parâmetro também tenha o seu
        // determinismo afirmado, e não apenas herdado.
        const semCor = cellToPixels(cenario.cell, coords, cenario.geom);
        const semCorDeNovo = cellToPixels(cenario.cell, coords, cenario.geom);
        expect(semCorDeNovo).toStrictEqual(semCor);

        const comCor = cellToPixels(cenario.cell, coords, cenario.geom, cor);
        const comCorDeNovo = cellToPixels(cenario.cell, coords, cenario.geom, cor);
        expect(comCorDeNovo).toStrictEqual(comCor);

        // A cor não decide se a célula existe: ela é aplicada depois de o
        // retângulo estar resolvido. Se um dia passar a decidir, a camada
        // deixaria de desenhar liquidez por causa de um valor de escala — e esta
        // asserção reprova antes disso.
        expect(comCor === null).toBe(semCor === null);

        if (semCor === null || comCor === null) {
          comAusencia += 1;
          return;
        }

        comRetangulo += 1;

        // Mesmo retângulo, sob qualquer cor.
        expect(comCor.x).toBe(semCor.x);
        expect(comCor.y).toBe(semCor.y);
        expect(comCor.w).toBe(semCor.w);
        expect(comCor.h).toBe(semCor.h);

        // E a cor informada é a que chega ao desenho — sem isto, "informar cor
        // não muda nada" poderia ser verdade por a cor estar sendo ignorada.
        expect(comCor.bucket).toBe(cor.bucket);
        expect(comCor.side).toBe(cor.side);
        expect(comCor.aboveScale).toBe(cor.aboveScale);

        if (comCor.bucket !== semCor.bucket) corMudouOBucket += 1;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    expect(comRetangulo).toBeGreaterThan(0);
    expect(comAusencia).toBeGreaterThan(0);
    // O quarto parâmetro de fato alterou a cor em parte dos casos. Sem esta
    // contagem, um gerador que só produzisse o bucket mais fraco tornaria a
    // comparação de cor acima vazia.
    expect(corMudouOBucket).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A saída é função exclusiva das entradas que o mapeamento declara usar
  // ───────────────────────────────────────────────────────────────────────────

  it('as quantidades de fila e de execução da célula não influenciam o resultado', () => {
    let comRetangulo = 0;
    let comAusencia = 0;

    fc.assert(
      fc.property(arbCenario, arbQuantidades, (cenario, outrasQuantidades) => {
        const coords = coordsDe(cenario);

        // Mesma posição, mesma geometria, mesma cor — apenas as magnitudes mudam.
        // O retângulo sai de `tsMs`, de `preco` e da geometria, e a cor chega
        // pronta pelo quarto parâmetro; se a magnitude passar a influenciar a
        // geometria, existirão duas fontes de verdade para o tamanho da célula e
        // elas divergirão em silêncio.
        const original = cellToPixels(cenario.cell, coords, cenario.geom, cenario.paint);
        const comOutrasQuantidades = cellToPixels(
          { ...cenario.cell, ...outrasQuantidades },
          coords,
          cenario.geom,
          cenario.paint,
        );

        if (original === null) comAusencia += 1;
        else comRetangulo += 1;

        expect(comOutrasQuantidades).toStrictEqual(original);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    expect(comRetangulo).toBeGreaterThan(0);
    expect(comAusencia).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A forma literal do requisito 1.6: a sequência inteira
  // ───────────────────────────────────────────────────────────────────────────

  it('mapear a mesma sequência de células duas vezes devolve a mesma quantidade, na mesma ordem, com ausência nas mesmas posições', () => {
    let comAmbosOsDesfechos = 0;
    let sequenciasNaoVazias = 0;
    let sequenciasVazias = 0;

    fc.assert(
      fc.property(
        arbCenario,
        fc.array(arbCelulaLivre, { minLength: 0, maxLength: 40 }),
        (cenario, extras) => {
          // A célula do cenário abre a sequência para que a família alinhada
          // contribua com um caso de sucesso; as demais vêm soltas, e é a mistura
          // que torna a preservação de posição verificável. Sequência vazia é
          // caso legítimo — a janela pode não conter célula alguma.
          const celulas = extras.length === 0 ? [] : [cenario.cell, ...extras];

          // Um único par de conversões para toda a sequência — é o que acontece
          // numa passada de desenho.
          const coords = coordsDe(cenario);

          const mapear = (): Array<DrawCell | null> =>
            celulas.map((cell) => cellToPixels(cell, coords, cenario.geom, cenario.paint));

          const primeira = mapear();
          const segunda = mapear();

          // "A mesma quantidade de células de saída" — a posição na sequência é
          // preservada porque a ausência ocupa lugar em vez de ser filtrada. Se a
          // ausência fosse removida da lista, uma célula fora da escala deslocaria
          // todas as seguintes e a camada desenharia liquidez no lugar errado.
          expect(segunda).toHaveLength(primeira.length);
          expect(segunda.length).toBe(celulas.length);

          // "Na mesma ordem, com coordenada, largura, altura, lado e cor iguais em
          // cada posição, incluindo o caso de resultado ausente."
          expect(segunda).toStrictEqual(primeira);

          const ausentes = primeira.filter((item) => item === null).length;
          const presentes = primeira.length - ausentes;
          expect(segunda.filter((item) => item === null)).toHaveLength(ausentes);

          if (primeira.length > 0) sequenciasNaoVazias += 1;
          else sequenciasVazias += 1;
          if (ausentes > 0 && presentes > 0) comAmbosOsDesfechos += 1;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    expect(sequenciasNaoVazias).toBeGreaterThan(0);
    expect(sequenciasVazias).toBeGreaterThan(0);
    // Ao menos uma sequência misturou ausência e retângulo. É o caso em que a
    // preservação de posição importa de verdade: numa sequência homogênea,
    // filtrar a ausência passaria despercebido.
    expect(comAmbosOsDesfechos).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // As fixtures são puras — sem isto o teste mediria a si mesmo
  // ───────────────────────────────────────────────────────────────────────────

  it('as conversões injetadas são puras: repetir a mesma entrada devolve o mesmo valor', () => {
    fc.assert(
      fc.property(
        arbEscalaTempoLivre,
        arbEscalaPrecoLivre,
        fc.array(
          fc.oneof(
            fc.constantFrom(
              ABERTURA_SEG,
              ABERTURA_SEG + BALDE_SEG,
              PRECO_BASE,
              PRECO_BASE + PRECO_PASSO,
              0,
              -1,
              Number.NaN,
              Number.POSITIVE_INFINITY,
            ),
            fc.double({ min: -1e9, max: 1e9, noNaN: true }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        (escalaTempo, escalaPreco, sondas) => {
          const paraTempo = materializarEscala(escalaTempo);
          const paraPreco = materializarEscala(escalaPreco);

          for (const sonda of sondas) {
            // Três chamadas, não duas: um estado que só se manifestasse a partir
            // da segunda invocação passaria por um par.
            const t1 = paraTempo(sonda);
            const t2 = paraTempo(sonda);
            const t3 = paraTempo(sonda);
            expect(Object.is(t2, t1)).toBe(true);
            expect(Object.is(t3, t1)).toBe(true);

            const p1 = paraPreco(sonda);
            const p2 = paraPreco(sonda);
            const p3 = paraPreco(sonda);
            expect(Object.is(p2, p1)).toBe(true);
            expect(Object.is(p3, p1)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Controle negativo — a igualdade afirmada tem dentes
  // ───────────────────────────────────────────────────────────────────────────

  it('com uma conversão que muda de resposta entre chamadas, as duas execuções divergem — a comparação detecta não-determinismo', () => {
    const cell: AggregatedCell = {
      tsMs: ABERTURA_MS,
      preco: PRECO_BASE,
      bid: 481,
      ask: 714,
      buy: 0,
      sell: 0,
    };
    const geom: CellGeometry = {
      baldeSeg: BALDE_SEG,
      fatorTempo: 1,
      tickSize: PRECO_PASSO,
      fatorPreco: 1,
      widthPx: 800,
      heightPx: 600,
    };

    // Referência: a conversão pura devolve o mesmo retângulo nas duas chamadas.
    const coordsPuras: CoordinateFns = {
      timeToX: () => 100,
      priceToY: (preco) => (preco > PRECO_BASE ? 10 : 20),
    };
    const referencia = cellToPixels(cell, coordsPuras, geom);
    expect(referencia).not.toBeNull();
    expect(cellToPixels(cell, coordsPuras, geom)).toStrictEqual(referencia);

    // ⚠️ Fixture DELIBERADAMENTE impura, e o único lugar deste arquivo em que
    // isso acontece: uma fila de respostas consumida por chamada. Ela representa,
    // vista de fora, qualquer das fontes de tremor listadas no cabeçalho —
    // relógio, sorteio, cache de módulo.
    const respostasDePreco = [10, 20, 300, 400];
    let consumidas = 0;
    const coordsComEstado: CoordinateFns = {
      timeToX: () => 100,
      priceToY: () => {
        const resposta = respostasDePreco[consumidas] ?? 0;
        consumidas += 1;
        return resposta;
      },
    };

    const primeira = cellToPixels(cell, coordsComEstado, geom);
    const segunda = cellToPixels(cell, coordsComEstado, geom);

    // As quatro respostas foram consumidas: duas por chamada, uma por borda de
    // preço. Sem esta conferência, um núcleo que consultasse a escala um número
    // diferente de vezes invalidaria o controle sem aviso.
    expect(consumidas).toBe(4);

    expect(primeira).not.toBeNull();
    expect(segunda).not.toBeNull();
    // É esta a asserção que prova que a propriedade principal não é vazia: a
    // mesma comparação usada lá reprova aqui.
    expect(segunda).not.toStrictEqual(primeira);
    expect(primeira?.y).toBe(10);
    expect(segunda?.y).toBe(300);
  });
});
