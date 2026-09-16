/**
 * Tipos canônicos da camada de bookmap do mapa de decisão — spec
 * `bookmap-no-mapa-de-decisao`, tarefa 2.1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Só declarações. Sem lógica, sem estado de módulo, sem efeito colateral de
 * import — importar este arquivo não executa nada. É o contrato compartilhado
 * entre o núcleo puro (`bookmap-decode.core`, `bookmap-color.core`,
 * `bookmap-render.core`), o primitive de canvas, o hook de busca e o card de
 * paredes.
 *
 * Espelho manual dos tipos do backend (`src/bookmap/*`), com **zero import da
 * árvore NestJS** — mesma convenção de `cluster-zone.types.ts`. Toda mudança de
 * shape no backend tem de ser refletida aqui à mão; o teste de contrato cruzado
 * (tarefa 2.4, sobre a fixture gerada pelo próprio backend) é o que impede
 * codificador e decodificador de divergirem em silêncio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES MT5 (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo **não importa nada**. Sem import não há fechamento transitivo,
 * logo é estruturalmente incapaz de alcançar serviço de roteamento de bridge,
 * de feed de tick, de execução de ordem, ou módulo de conector do terminal — e
 * não carrega endereço de rede, identificador de conta, credencial nem estado de
 * posição.
 *
 * `FonteBookmap` é valor de um filtro parametrizado sobre a coluna `fonte` de
 * `bookmap_depth` — que já integra a PK da tabela —, não seleção de conexão: não
 * existe caminho por onde a escolha de fonte alcance uma bridge.
 *
 * Todo insumo chega de API (`GET /api/bookmap/heatmap-depth/:symbol`); nenhum
 * vem do sistema de arquivos, em CSV ou em qualquer outro formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR, `readonly` em
 * todo campo (o payload é imutável depois de decodificado).
 */

// ═════════════════════════════════════════════════════════════════════════════
// Contrato de rede
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Origem do livro. Integra a chave primária de `bookmap_depth`, que é o que
 * permite MT5 e Cedro coexistirem no mesmo dia sem sobrescrita silenciosa.
 *
 * - `MT5_L2`: 20 níveis, gravado ao vivo pela bridge. **É o único com dado
 *   materializado hoje** (5 pregões de `WINV26`, 24–28/08/2026).
 * - `CEDRO_MBO`: livro por oferta. O parser está validado, mas o serviço de
 *   captura ainda não grava em `bookmap_depth` — a opção aparece na UI
 *   **desabilitada com o motivo escrito**, nunca escondida.
 */
export type FonteBookmap = 'MT5_L2' | 'CEDRO_MBO';

/**
 * Cobertura das duas metades do heatmap, que vêm de fontes DIFERENTES e podem
 * divergir: a fila de `book_deltas`/`book_keyframes` (bridge, ao vivo) e a
 * execução de `win_ticks type='T'`.
 *
 * ⚠️ `EXEC_PARCIAL` é o estado normal, não a exceção: medido em **100% dos 5
 * pregões**, com ~6 h de execução faltando (fila até 18:29, execução até
 * 12:31). Um heatmap assim *parece* completo — as paredes aparecem o dia todo e
 * as bolhas de negócio somem no meio da tarde, o que se lê como "mercado
 * parou" e não como "dado faltando". Por isso a classe é informação de primeira
 * classe na UI (hachura no trecho descoberto + rodapé com os horários), e não
 * um detalhe de rodapé opcional.
 *
 * `null` em qualquer limite significa desconhecido — a UI trata como
 * `cobertura não verificada` em vez de afirmar `COMPLETA` sem prova.
 */
export interface CoberturaHeatmap {
  readonly classe: 'COMPLETA' | 'FILA_SEM_EXEC' | 'EXEC_PARCIAL' | 'VAZIA';
  readonly observacao: string | null;
  /** Primeiro instante com fila agregada, epoch ms. */
  readonly filaDeMs: number | null;
  /** Último instante com fila agregada, epoch ms. */
  readonly filaAteMs: number | null;
  /** Primeiro instante com execução agregada, epoch ms. */
  readonly execDeMs: number | null;
  /** Último instante com execução agregada, epoch ms. */
  readonly execAteMs: number | null;
}

/**
 * Formato VERBOSO — contrato de rede ATUAL, um objeto por célula.
 *
 * ⚠️ **Consumido pelo Robustus** (`.kiro/contratos/robustus-bookmap-microestrutura.md`).
 * NÃO MUDAR: esta feature adiciona o colunar como opção e deixa o verboso
 * byte-idêntico.
 *
 * `filaBid`/`filaAsk` são **pico** no balde (agregados por `max`);
 * `execCompra`/`execVenda` são **soma**. Os operadores diferem porque as
 * grandezas diferem: fila é quantidade em repouso — a média de uma parede de
 * 2.442 ct com onze baldes vazios daria 222 ct e a parede desapareceria —,
 * enquanto execução é fluxo acumulado.
 */
export interface CelulaHeatmapVerbosa {
  readonly tsMs: number;
  readonly preco: number;
  readonly filaBid: number;
  readonly filaAsk: number;
  readonly execCompra: number;
  readonly execVenda: number;
}

/**
 * Formato COLUNAR — novo, opt-in por `?formato=colunar`.
 *
 * Medido: 2,43 MB → 0,83 MB (66% menor) para as 25.823 células de um pregão. A
 * economia vem de não repetir seis chaves JSON 25.823 vezes; os valores são
 * exatamente os mesmos. Recortar por faixa de preço foi medido e **não** ajuda
 * (97% das células já estão na banda do miolo, então a faixa mantém 99% do
 * payload) — o que pesa é a verbosidade, não a abrangência.
 *
 * `eixos.t` e `eixos.p` são ORDENADOS de forma estritamente crescente e
 * DEDUPLICADOS; `colunas.ti`/`colunas.pi` indexam neles.
 *
 * ⚠️ Célula com os quatro valores em zero é **OMITIDA**: ausência significa
 * zero. O round-trip (Property 9) afirma essa exclusão em vez de tolerá-la.
 */
export interface BookmapDepthColunar {
  readonly formato: 'colunar';
  readonly symbol: string;
  readonly fonte: FonteBookmap;
  /** Dia consultado, `YYYY-MM-DD` BRT. */
  readonly de: string;
  readonly baldeSeg: number;
  readonly nivel: 'PROFUNDIDADE';
  /** Quantidade de células — igual ao comprimento de cada uma das seis colunas. */
  readonly celulas: number;
  readonly eixos: {
    /** Baldes, epoch ms, estritamente crescente. */
    readonly t: readonly number[];
    /** Preços, estritamente crescente. */
    readonly p: readonly number[];
  };
  readonly colunas: {
    /** Índice em `eixos.t`. */
    readonly ti: readonly number[];
    /** Índice em `eixos.p`. */
    readonly pi: readonly number[];
    /** `filaBid` — pico no balde. */
    readonly b: readonly number[];
    /** `filaAsk` — pico no balde. */
    readonly a: readonly number[];
    /** `execCompra` — soma no balde. */
    readonly c: readonly number[];
    /** `execVenda` — soma no balde. */
    readonly v: readonly number[];
  };
  readonly cobertura: CoberturaHeatmap | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Modelo em memória — tipado para o desenho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `BookmapGrid` — o payload decodificado, na forma que o desenho consome.
 *
 * ── POR QUE ARRAY TIPADO, E NÃO ARRAY DE OBJETOS ──────────────────────────
 *
 * 25.823 células × 4 métricas em array de objetos JS custa ~4 MB de heap e
 * fragmenta o GC a cada troca de dia. Tipado, os eixos e valores do conjunto de
 * referência somam **422.720 bytes** contíguos, dentro do teto de 600 KB
 * (614.400 bytes) do requisito 9.7:
 *
 *     times   Float64Array    570 × 8 =     4.560 B   ← eixo
 *     prices  Float64Array    624 × 8 =     4.992 B   ← eixo
 *     bid     Float32Array 25.823 × 4 =   103.292 B   ← valor
 *     ask     Float32Array 25.823 × 4 =   103.292 B   ← valor
 *     buy     Float32Array 25.823 × 4 =   103.292 B   ← valor
 *     sell    Float32Array 25.823 × 4 =   103.292 B   ← valor
 *                            eixos + valores =  422.720 B  ✓
 *
 * ⚠️ As duas colunas de índice ficam FORA dessa conta, porque o requisito 9.7
 * define a medida como "a soma dos tamanhos em bytes das estruturas de eixos e
 * de valores". Elas custam mais `2 × 103.292 = 206.584 B`, o que leva o grid
 * inteiro a 629.304 B. Registrado aqui para a bancada da tarefa 12.2 medir o
 * que o requisito pede e não descobrir a diferença sem contexto.
 *
 * E o ganho não é só de tamanho: o laço de `draw()` percorre memória contígua
 * **sem alocar**, então não há pausa de GC no meio de um pan.
 *
 * `times` e `prices` são `Float64Array` e não `Float32Array` por precisão, não
 * por gosto: epoch ms (~1,79 × 10¹²) não cabe nos 24 bits de mantissa de um
 * float de 32 bits — arredondaria o instante para múltiplos de ~131 s e as
 * células do mesmo balde colidiriam. Preço de 6 dígitos com fração de tick tem
 * o mesmo problema, em menor escala.
 *
 * ── INVARIANTES ───────────────────────────────────────────────────────────
 *
 * 1. **Comprimento igual das seis colunas:**
 *
 *        ti.length === pi.length === bid.length === ask.length
 *                  === buy.length === sell.length
 *
 *    A célula `k` é a leitura das seis colunas no mesmo índice `k`. Colunas de
 *    comprimentos divergentes desalinham métrica e coordenada — desenharia
 *    liquidez no preço errado, que é pior que não desenhar.
 *
 * 2. **Todo índice dentro do seu eixo:**
 *
 *        ∀k: 0 ≤ ti[k] < times.length  ∧  0 ≤ pi[k] < prices.length
 *
 * 3. **Eixos estritamente crescentes**, sem repetição — herdado do payload.
 *
 * `decodeColumnar` é o único produtor de `BookmapGrid` e devolve `null` quando
 * qualquer invariante falha; **nunca** um grid parcial.
 */
export interface BookmapGrid {
  readonly symbol: string;
  readonly fonte: FonteBookmap;
  /** Dia do grid, `YYYY-MM-DD` BRT. */
  readonly dia: string;
  readonly baldeSeg: number;
  /** Eixo de tempo: início de cada balde, epoch ms (precisa de 64 bits). */
  readonly times: Float64Array;
  /** Eixo de preço, crescente. */
  readonly prices: Float64Array;
  /** Índice da célula `k` em `times`. */
  readonly ti: Uint32Array;
  /** Índice da célula `k` em `prices`. */
  readonly pi: Uint32Array;
  /** Fila de compra (pico no balde), em contratos. */
  readonly bid: Float32Array;
  /** Fila de venda (pico no balde), em contratos. */
  readonly ask: Float32Array;
  /** Execução por agressor comprador (soma no balde). */
  readonly buy: Float32Array;
  /** Execução por agressor vendedor (soma no balde). */
  readonly sell: Float32Array;
  readonly cobertura: CoberturaHeatmap | null;
}

/**
 * Janela visível do gráfico — limites do dado e dimensões em pixel.
 *
 * Entra por parâmetro em `aggregateForZoom`, nunca lida de `window` ou do DOM:
 * é o que mantém o núcleo puro e a agregação determinística e testável.
 *
 * Pré-condições do consumidor: `tsDe ≤ tsAte` e `precoDe ≤ precoAte`. Janelas
 * degeneradas (largura 0, altura 0, invertida) são geradas de propósito nos
 * testes de propriedade para exercitar os guards — logo o tipo as admite e o
 * comportamento fica com a função, não com o compilador.
 */
export interface VisibleWindow {
  /** Limite inferior de tempo, epoch ms, inclusive. */
  readonly tsDe: number;
  /** Limite superior de tempo, epoch ms, inclusive. */
  readonly tsAte: number;
  /** Limite inferior de preço, inclusive. */
  readonly precoDe: number;
  /** Limite superior de preço, inclusive. */
  readonly precoAte: number;
  /** Largura útil do gráfico, em pixels lógicos. */
  readonly larguraPx: number;
  /** Altura útil do gráfico, em pixels lógicos. */
  readonly alturaPx: number;
  /** Quantidade de baldes abrangidos pela janela. */
  readonly baldesVisiveis: number;
  /** Quantidade de ticks de preço abrangidos pela janela. */
  readonly ticksVisiveis: number;
}

/**
 * Uma célula já agregada por zoom, na forma que `cellToPixels` consome.
 *
 * `tsMs` é a borda ESQUERDA do grupo de baldes e `preco` o CENTRO do grupo de
 * ticks — a largura e a altura do retângulo saem dos fatores de agrupamento
 * (`AggregatedCells.fatorTempo`/`fatorPreco`), não deste tipo.
 */
export interface AggregatedCell {
  readonly tsMs: number;
  readonly preco: number;
  /** Fila de compra combinada por `max`. */
  readonly bid: number;
  /** Fila de venda combinada por `max`. */
  readonly ask: number;
  /** Execução compradora combinada por `sum`. */
  readonly buy: number;
  /** Execução vendedora combinada por `sum`. */
  readonly sell: number;
}

/**
 * Saída de `aggregateForZoom` — colunar pelo mesmo motivo do `BookmapGrid`: o
 * laço de desenho percorre sem alocar um objeto por célula.
 *
 * ⚠️ **`count` é a verdade, não `length`.** As colunas podem ser alocadas com
 * capacidade maior que o preenchido; só os índices `[0, count)` são válidos.
 * Ler além disso devolve zeros que seriam desenhados como liquidez ausente.
 *
 * ── OS OPERADORES DE COMBINAÇÃO ───────────────────────────────────────────
 *
 * - `bid`/`ask` combinam por **`max`**, nunca por média. Uma parede de 2.442 ct
 *   diluída em onze baldes vazios daria 222 ct e desapareceria do desenho. A
 *   consequência formal é `max(agregado) === max(original ∩ janela)`: a parede é
 *   preservada exatamente. É a mesma decisão que o agregador de backend já toma,
 *   herdada e não nova.
 * - `buy`/`sell` combinam por **`sum`**, e a soma é conservada dentro da janela.
 *   Execução é fluxo acumulado; somar é o operador certo lá.
 *
 * `fatorTempo === 1 && fatorPreco === 1` significa que não houve agrupamento —
 * a saída equivale à entrada recortada pela janela (idempotência).
 */
export interface AggregatedCells {
  /** Células válidas. `count ≤ budget.maxCells` e `count ≤ cada coluna.length`. */
  readonly count: number;
  /** Baldes agrupados por célula. `1` = sem agrupamento no tempo. */
  readonly fatorTempo: number;
  /** Ticks agrupados por célula. `1` = sem agrupamento no preço. */
  readonly fatorPreco: number;
  /** Borda esquerda do grupo de baldes, epoch ms (precisa de 64 bits). */
  readonly tsMs: Float64Array;
  /** Centro do grupo de ticks. */
  readonly preco: Float64Array;
  /** Fila de compra combinada por `max`. */
  readonly bid: Float32Array;
  /** Fila de venda combinada por `max`. */
  readonly ask: Float32Array;
  /** Execução compradora combinada por `sum`. */
  readonly buy: Float32Array;
  /** Execução vendedora combinada por `sum`. */
  readonly sell: Float32Array;
}

// ═════════════════════════════════════════════════════════════════════════════
// Escala de cor e desenho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Escala de cor derivada da **janela visível**, não do dia inteiro.
 *
 * ── POR QUE PERCENTIL, E NÃO O MÁXIMO ─────────────────────────────────────
 *
 * Medido nas 22.721 células com fila > 0 do pregão de referência:
 *
 *     p50    481 ct
 *     p90    714 ct
 *     p99  1.131 ct
 *     max 36.232 ct     ← 32× o p99
 *
 * Normalizando linearmente pelo máximo global, a célula de p90 receberia
 * `714 / 36.232 = 2%` de opacidade: **a parede fica invisível**. Isso é
 * aritmética, não preferência estética, e é o argumento inteiro contra a escala
 * linear global.
 *
 * E o máximo global não é uma parede: são **níveis cruzados** — ask 10% abaixo
 * do mercado e bid 10% acima, que seriam executáveis no instante em que
 * existissem. É artefato, não liquidez. Dentro da banda de ±2.000 pts do miolo,
 * que concentra 97,1% das células, o máximo real é 2.442 ct: 15× menor.
 *
 * Daí a escala guardar `p50`/`p99` da janela visível: um outlier fora dela não
 * pode alterar em nada as cores da região que o operador está olhando.
 *
 * `gamma` aplica curva de potência (0,5 = raiz) para preservar contraste na
 * faixa 400↔800 ct, onde o operador decide. Log puro comprimiria exatamente
 * essa faixa — é bom para 6 ordens de grandeza, e aqui há ~1,4.
 */
export interface ColorScale {
  /** Piso da escala, em contratos. Abaixo disso, `alphaMin`. */
  readonly p50: number;
  /** Teto da escala, em contratos. Acima disso, `alphaMax` + contorno. */
  readonly p99: number;
  readonly alphaMin: number;
  readonly alphaMax: number;
  /** Expoente da curva de potência. `0,5` = raiz. */
  readonly gamma: number;
}

/**
 * Célula pronta para `fillRect`, em pixels.
 *
 * `x`, `y`, `w`, `h` são finitos, arredondados e recortados ao viewport, com
 * piso de 1 px em `w` e `h` — célula sub-pixel ainda precisa existir
 * visualmente, senão a parede fina desaparece. O arredondamento é deliberado:
 * coordenada fracionária faz o canvas antialiasar a borda, e 3.000 retângulos
 * antialiasados viram névoa cinza em vez de faixas nítidas.
 */
export interface DrawCell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * Bucket de cor quantizado em 16 níveis (`0..15`), derivado do alpha.
   *
   * Existe para amortizar a troca de `fillStyle`: o laço de desenho agrupa por
   * bucket e faz 16 trocas em vez de 3.000.
   */
  readonly bucket: number;
  readonly side: 'BID' | 'ASK';
  /**
   * A quantidade estourou o `p99` da escala.
   *
   * Recebe traço fino de contorno em vez de ser achatada no `alphaMax` sem
   * aviso — o operador vê que a célula saiu da escala, em vez de achar que é
   * igual às outras saturadas.
   */
  readonly aboveScale: boolean;
}

/**
 * As funções de coordenada do PRÓPRIO gráfico — `series.priceToCoordinate` e
 * `timeScale().timeToCoordinate` do `lightweight-charts`.
 *
 * ⚠️ São embrulhadas, nunca reimplementadas: a escala do chart depende de zoom,
 * pan, margens e modo de preço (linear/log), e derivá-la à mão sairia de sincronia
 * com as velas — o heatmap desenharia no preço errado justamente durante o pan.
 *
 * `null` é resposta legítima e frequente: significa "fora da escala visível". O
 * consumidor pula a célula individualmente, sem tratar como erro.
 */
export interface CoordinateFns {
  /** Preço → coordenada vertical. `null` se fora da escala visível. */
  readonly priceToY: (price: number) => number | null;
  /** Instante em SEGUNDOS epoch → coordenada horizontal. `null` se fora. */
  readonly timeToX: (timeSec: number) => number | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Card de paredes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parede de liquidez detectada — o que o card da fase Pré-Decisão mostra.
 *
 * A informação que decide não é o tamanho, é a **transição**: uma parede que
 * persiste e absorve é suporte; a mesma parede cancelada 30 s antes do toque é
 * o oposto. Por isso `tendencia` acompanha `quantidade`.
 *
 * `tendencia` compara a média dos últimos N baldes contra os N anteriores **no
 * mesmo preço**, com histerese de 15% (`> +15%` ⇒ `CRESCENDO`, `< −15%` ⇒
 * `RETIRANDO`, senão `ESTAVEL`). A histerese existe para o rótulo não piscar a
 * cada balde; amostra insuficiente devolve `ESTAVEL` em vez de inventar
 * tendência.
 */
export interface BookmapWall {
  readonly preco: number;
  readonly lado: 'BID' | 'ASK';
  /** Quantidade em repouso, em contratos. */
  readonly quantidade: number;
  /** Distância até o preço atual, em pontos. Sempre positiva. */
  readonly distanciaPts: number;
  readonly tendencia: 'CRESCENDO' | 'ESTAVEL' | 'RETIRANDO';
  /**
   * Variação percentual que sustenta `tendencia`. Negativa quando retirando.
   *
   * ⚠️ Não é medição em dois casos, e o card deve apresentar o **rótulo**, não o
   * número: amostra insuficiente devolve `0` junto de `ESTAVEL` (não houve
   * comparação), e janela anterior nula devolve o sentinela
   * `WALL_VARIACAO_PCT_SEM_BASE` junto de `CRESCENDO` (crescer a partir de zero
   * não tem razão finita). O requisito 6.3 pede a classificação de tendência,
   * não a porcentagem — este campo é insumo de apoio.
   */
  readonly variacaoPct: number;
  /**
   * Causa da retirada — preenchida **somente** quando `tendencia` é
   * `RETIRANDO`; `null` nos outros dois casos (requisito 6.3, que pede a causa
   * apenas para a parede que está sendo retirada).
   *
   * Viaja junto da parede, e não em estrutura paralela, para que não exista a
   * possibilidade de o card casar a causa com a parede errada por índice.
   */
  readonly causaRetirada: CausaRetirada | null;
}

/**
 * Por que a fila desapareceu — e a distinção decide leitura oposta.
 *
 * - `ABSORVIDA`: a fila foi **consumida** por execução no mesmo preço. Quem
 *   estava do outro lado atravessou a oferta: é sinal de força de quem absorveu.
 * - `CANCELADA`: a fila saiu do livro **sem** execução correspondente. A oferta
 *   nunca pretendeu ser negociada — é a armadilha se desfazendo.
 * - `INDETERMINADA`: não se sabe, porque a captura de execução não cobre o
 *   intervalo avaliado. **Não é sinônimo de `CANCELADA`**: afirmar cancelamento
 *   sem ter capturado a execução do intervalo inverteria a leitura sempre que a
 *   fila tivesse sido, na verdade, absorvida.
 *
 * ⚠️ `INDETERMINADA` é o caminho **frequente**, não o excepcional: os 5 pregões
 * materializados são todos `EXEC_PARCIAL`, com a execução terminando ~6 h antes
 * da fila. Toda parede cujas janelas de tendência caiam depois do fim da
 * execução capturada sai daqui como `INDETERMINADA`.
 */
export type CausaRetirada = 'ABSORVIDA' | 'CANCELADA' | 'INDETERMINADA';
