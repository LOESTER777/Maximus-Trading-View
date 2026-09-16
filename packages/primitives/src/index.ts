/**
 * @robustus/charts-primitives — camadas de canvas do grafico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE PACOTE E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As camadas que desenham FLUXO sobre o grafico de preco: o heatmap de livro
 * (bookmap) e o footprint. Sao o diferencial visual da biblioteca — a parte que
 * nenhuma biblioteca de charting generica entrega.
 *
 * Cada camada implementa a trinca de primitive do substrato:
 *
 *   ISeriesPrimitive<Time>  — ciclo de vida (`attached`/`detached`/`updateAllViews`)
 *   IPrimitivePaneView      — z-order e producao do renderer
 *   IPrimitivePaneRenderer  — a passada de desenho
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DEPENDENCIA DO SUBSTRATO E SO POR TIPO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lightweight-charts` entra aqui exclusivamente por `import type`. Nenhum valor
 * e importado: nao ha `createChart`, nao ha construtor de serie, nao ha
 * `LineStyle`. Confira com `grep -n "from 'lightweight-charts'"` — as duas
 * ocorrencias sao `import type`.
 *
 * Isso NAO e detalhe de estilo. Sao tres consequencias praticas:
 *
 *  1. O pacote nao contribui um byte de `lightweight-charts` para o bundle.
 *  2. As camadas podem ser testadas com dubles, sem instanciar grafico — e o que
 *     torna a bancada de desempenho possivel em jsdom, que nao tem contexto 2D.
 *  3. Se o substrato for trocado um dia, o que precisa mudar e o pacote `engine`,
 *     nao estas 2.700 linhas de desenho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS GARANTIAS QUE PARECEM OMISSAO E SAO DECISAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Nenhuma camada implementa `hitTest`.** E deliberado: sem `hitTest` a camada
 * nao captura ponteiro, e essa e uma garantia de TIPO, nao de CSS — nao depende
 * de `pointer-events` chegar correto no DOM. Ha property test que falha se o
 * metodo aparecer. Ao construir ferramenta de desenho interativa, ela NAO deve
 * virar uma primitive destas; precisa de camada propria, com hit-test proprio.
 *
 * **Nenhuma camada faz rede.** Todo dado entra por `options`. A camada nao sabe
 * de onde o grid veio, e nao pode saber — quem busca e o `datafeed`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE FAZER QUANDO A CAMADA FALHA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nada. Ela se resolve, e isso e contrato:
 *
 *  - excecao em recalculo esvazia as formas em vez de propagar ("uma camada de
 *    visualizacao nao pode derrubar o grafico");
 *  - mediana das passadas recentes acima do orcamento corta o teto de celulas
 *    pela metade, progressivamente;
 *  - falha de pintura desliga a propria camada e ESCREVE o motivo em ambar sobre
 *    o canvas, em vez de ficar visualmente identica a desligada.
 *
 * A ultima e a que costuma surpreender: texto ambar no canvas nao e bug, e a
 * camada informando por que parou.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Bookmap — heatmap de livro por regiao de preco
// ═════════════════════════════════════════════════════════════════════════════
export { BookmapPrimitive } from './BookmapPrimitive.js';
export type { BookmapLayerOptions } from './BookmapPrimitive.js';

/**
 * Zera os registros de aviso de escopo de SESSAO da camada bookmap.
 *
 * ⚠️ **E ferramenta de teste, nao de aplicacao.** Nenhum caminho de producao
 * chama isto, e nao deve passar a chamar.
 *
 * Existe porque a camada registra esgotamento de orcamento, degradacao e
 * autodesativacao **uma vez por sessao** — sao variaveis de modulo, nao de
 * instancia, para que 40 instancias numa pagina nao produzam 40 linhas iguais de
 * log. Estado de modulo vaza entre casos de teste: sem zerar no preparo, o
 * resultado passa a depender da ordem de execucao.
 *
 * Esta reexportado no indice publico de proposito. A alternativa seria o teste
 * alcancar o arquivo por caminho interno (`.../BookmapPrimitive.js`), o que
 * amarraria a suite ao layout de arquivos do pacote em vez da API — e o layout e
 * exatamente o que uma extracao muda.
 */
export { resetBookmapSessionWarnings } from './BookmapPrimitive.js';

// ═════════════════════════════════════════════════════════════════════════════
// Footprint — volume por preco dentro de cada vela
// ═════════════════════════════════════════════════════════════════════════════
export { FootprintPrimitive } from './FootprintPrimitive.js';
export type { FootprintLayerOptions } from './FootprintPrimitive.js';

// ═════════════════════════════════════════════════════════════════════════════
// Apelidos em ingles — mesmo simbolo, nome alternativo
// ═════════════════════════════════════════════════════════════════════════════
export { BookmapPrimitive as BookmapLayer } from './BookmapPrimitive.js';
export { FootprintPrimitive as FootprintLayer } from './FootprintPrimitive.js';
