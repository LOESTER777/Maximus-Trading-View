/**
 * `BookmapPrimitive` — a camada de liquidez desenhada **dentro** do canvas do
 * gráfico, atrás das velas. Spec `bookmap-no-mapa-de-decisao`, tarefa 6.1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A ponte entre o núcleo puro e o ciclo de desenho da biblioteca de gráfico.
 * Toda decisão numérica — percentil da escala, agrupamento por zoom,
 * célula→pixel, classe de cobertura — vem de `./bookmap-render.core`, que é o
 * **único** módulo importado da pasta: os arquivos irmãos nunca são importados
 * daqui, para que a repartição interna do núcleo permaneça livre de mudar.
 *
 * O que sobra para este arquivo é o que o núcleo não pode ter, por ser puro:
 * ciclo de vida, cache entre passadas, escopo de sessão, e a emissão de formas
 * no contexto 2D.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ────────────────────────────────────────────
 *
 * ⚠️ **Não implementa `hitTest`.** A ausência do método é o mecanismo que torna
 * a camada estruturalmente incapaz de receber evento de ponteiro — é garantia de
 * tipo, verificada por teste estrutural (Property 3), e não convenção de CSS
 * como nas sete camadas de sobreposição existentes. Adicionar o método aqui
 * reverteria a decisão em silêncio, e é por isso que existe um teste que falha
 * se alguém o adicionar.
 *
 * Também não registra manipulador de ponteiro no elemento do gráfico, não lê
 * DOM fora do contexto que a biblioteca entrega, e não chama nada que dispare
 * renderização de árvore de componentes: o redesenho sai de `requestUpdate()`,
 * que é o ciclo do próprio gráfico (requisito 9.8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES MT5 (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As importações são duas: tipos da biblioteca de gráfico e o módulo público do
 * núcleo desta pasta. O fechamento transitivo delas não alcança serviço de
 * roteamento de conexão, de feed de tick, de execução de ordem, nem módulo de
 * conector de terminal, e não carrega endereço de rede, identificador de conta,
 * credencial ou estado de posição.
 *
 * Nada aqui emite evento de decisão, envia ordem, escreve em tabela ou altera
 * chave de configuração de trading: a camada é exclusivamente visual. Todo
 * insumo de livro chega decodificado, de API; nenhum vem do sistema de arquivos,
 * em CSV ou em qualquer outro formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que evitar: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEGRADAÇÃO ADAPTATIVA DO ORÇAMENTO (tarefa 6.2, requisitos 9.9 e 9.10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O orçamento de células vive no campo mutável `budget`, nunca numa constante
 * literal no caminho de agregação. Quando a **mediana** das 30 passadas de
 * desenho mais recentes excede 8 ms, o orçamento cai **à metade**, limitado ao
 * piso de 500 células.
 *
 * ── POR QUE MEDIANA, E NÃO MÉDIA ──────────────────────────────────────────
 *
 * Uma única passada lenta — troca de aba, coleta de lixo, compilação sob
 * demanda do laço na primeira execução — desloca a média o suficiente para
 * disparar a redução. A mediana de 30 amostras absorve o evento isolado e só
 * excede o alvo quando o custo é sistemático, que é a única situação em que
 * reduzir a resolução da imagem se justifica. É a diferença entre "está devagar"
 * e "engasgou uma vez".
 *
 * ── O QUE A REDUÇÃO NÃO FAZ ───────────────────────────────────────────────
 *
 * Reduzir o teto não recorta a janela visível nem descarta grupo: o núcleo
 * responde ao teto menor dobrando a dimensão mínima de célula e reagrupando mais
 * grosso, de modo que **toda** a região visível continua representada, com menos
 * resolução (requisito 9.9). Nenhum truncamento acontece deste lado.
 *
 * E a redução nunca desabilita a camada. No piso, o valor é mantido, as passadas
 * seguem acontecendo e a camada permanece habilitada (requisito 9.10) — não há
 * caminho de código da degradação para `detachedFlag` nem para grid ausente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTODESATIVAÇÃO POR EXCEÇÃO NO DESENHO (tarefa 6.3, requisitos 10.5 a 10.7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exceção lançada dentro do ciclo de render da biblioteca de gráfico **congela o
 * gráfico inteiro**: velas, linhas de preço, marcadores e volume param junto. O
 * gráfico vale mais que a camada, então a passada é cercada por `try/catch` e a
 * camada se desativa **já na primeira exceção** — sem contar falhas e sem
 * tolerar a segunda. Tolerar a segunda apostaria o gráfico para talvez preservar
 * uma camada de contexto, e essa aposta tem lado errado óbvio.
 *
 * ── DUAS COISAS DISTINTAS, DOIS ESCOPOS DISTINTOS ─────────────────────────
 *
 * O requisito 10.5 pede o **registro** uma única vez; o 10.6 pede o **aviso na
 * tela** enquanto a camada permanecer desativada. São coisas diferentes, e por
 * isso moram em lugares diferentes:
 *
 * | o que | escopo | por quê |
 * |---|---|---|
 * | registro em log | módulo (`selfDisableLogged`) | evento, e o requisito diz "uma única vez" |
 * | aviso na tela | instância (`selfDisabledNotice`) | estado, e o requisito 10.6 é um `WHILE` |
 *
 * Confundir os dois produziria um dos dois defeitos: log repetido a cada troca
 * de timeframe, ou — pior — a segunda autodesativação acontecendo **sem aviso
 * na tela**, deixando o operador com uma camada muda.
 *
 * ── RETOMADA POR INTENÇÃO, REMOÇÃO DO AVISO POR EVIDÊNCIA ─────────────────
 *
 * Desligar e religar a chave do livro retoma as passadas (requisito 10.7): é o
 * caminho `update()` com grid voltando de ausente a presente, ou uma reanexação.
 * Mas o aviso **não** sai nesse instante — sai quando uma passada concluir sem
 * exceção. Reabilitar é intenção; passada limpa é evidência, e só evidência
 * autoriza dizer ao operador que o problema passou.
 *
 * ⚠️ E a passada limpa que conta é a que desenha de verdade. Enquanto a camada
 * está desativada o plano tem **só o aviso**, e uma passada de texto não exercita
 * o caminho que falhou — por isso a remoção do aviso é bloqueada enquanto a
 * desativação estiver em vigor.
 *
 * ── LIMITE ASSUMIDO ──────────────────────────────────────────────────────
 *
 * O aviso viaja pelo mesmo canvas que acabou de falhar, porque a legenda é o
 * mecanismo que a camada já tem para se declarar e inventar um segundo caminho
 * de notificação espalharia o mesmo assunto por dois lugares. Se a falha for no
 * próprio desenho de texto, o aviso não aparece — mas a garantia principal
 * permanece intacta: a exceção segue contida e o gráfico segue desenhando.
 *
 * Convenções: identificadores em inglês, comentários e texto de tela em pt-BR.
 * Todo horário exibido é derivado pelo núcleo, com sufixo de fuso explícito —
 * nenhuma aritmética de fuso acontece neste arquivo. O fuso vem de
 * `BookmapLayerOptions.relogio`; ausente, o núcleo adota BRT sem segundos, que é
 * o comportamento da origem.
 */

import type { CanvasRenderingTarget2D } from '@robustus/chart-core';
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from '@robustus/chart-core';

import {
  BOOKMAP_ALPHA_MAX_DEFAULT,
  BOOKMAP_ALPHA_MIN_DEFAULT,
  aggregateForZoomWithOutcome,
  alphaOf,
  cellToPixels,
  computeColorScalePair,
  computeCoverageView,
  hasMagnitudeVariation,
  isAboveScale,
} from '@robustus/charts-core';
/**
 * Rampa térmica — cor por TAMANHO em vez de por lado. Módulo puro, sem
 * importação em tempo de execução além desta.
 */
import { construirPaletaTermica } from '@robustus/charts-core';
import { TEXT_BOX_PAD_PX, desenharCaixaDeTexto, larguraDoTexto } from './text-box.js';
import type {
  AggregatedCell,
  AggregatedCells,
  BookmapGrid,
  ClockFormatter,
  ColorScale,
  CoordinateFns,
  CoverageView,
  DrawCell,
  MetricaBookmap,
  VisibleWindow,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Opções da camada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que a página entrega à camada. Espelha o painel de indicadores.
 *
 * `grid: null` é estado normal, não erro: é o caminho de desligar a camada sem
 * desanexá-la do gráfico — `renderer()` passa a devolver `null` e a biblioteca
 * deixa de chamar a passada de desenho.
 */
export interface BookmapLayerOptions {
  readonly grid: BookmapGrid | null;
  /** Grandeza desenhada. `AMBAS` desenha fila e marca a execução dentro dela. */
  readonly metrica: MetricaBookmap;
  /** Curva da escala de cor. `P99_LINEAR` desliga o gamma (expoente 1). */
  readonly escala: 'P99_GAMMA' | 'P99_LINEAR';
  /** Incremento mínimo de preço do ativo. */
  readonly tickSize: number;
  /** Teto de células desenhadas por passada. */
  readonly maxCells: number;
  /** Dimensão mínima de célula, em pixels, antes de agrupar. */
  readonly minCellPx: number;
  /**
   * Forma da marca de execução: `BARRA` (original) ou `BOLHA`.
   *
   * ⚠️ **Ausente ⇒ `BARRA`**, de propósito. O requisito 1.5 descreve a marca como
   * barra estreita centrada, distinta do retângulo de fila pela GEOMETRIA, e as
   * bancadas de propriedade constroem esta camada sem informar a opção — manter
   * `BARRA` como omissão preserva aquele comportamento byte a byte.
   *
   * `BOLHA` é a leitura de mesa que a barra não consegue dar: **raio proporcional
   * ao volume** e **cor do agressor**. Com a barra, 50 e 5.000 contratos ocupam a
   * mesma área e diferem só em opacidade — o operador vê que houve negócio, não
   * o tamanho dele nem quem estava mandando.
   */
  readonly marcaExec?: 'BARRA' | 'BOLHA';
  /**
   * Desenhar a legenda e o rodapé de cobertura sobre a área de plotagem.
   *
   * ⚠️ **Ausente ⇒ `true`**, o comportamento original. As bancadas de
   * propriedade e os testes de legenda constroem esta camada sem informar a
   * opção, e a legenda é parte do contrato deles.
   *
   * `false` existe porque a legenda ocupa duas a três linhas de texto SOBRE o
   * gráfico. Com mais de uma camada densa ativa, as legendas somam seis linhas e
   * passam a esconder exactamente o dado que descrevem — foi o que o operador
   * fotografou em 04/09/2026, com a legenda do footprint caindo sobre o eixo de
   * tempo e a marca d'água. Quem passa `false` assume a responsabilidade de
   * mostrar a mesma informação fora do canvas.
   */
  readonly mostrarLegenda?: boolean;
  /**
   * Desenhar o texto de DIAGNÓSTICO sobre a área de plotagem.
   *
   * ⭐ **Ausente ⇒ `false`.** É o único padrão desta camada que NÃO reproduz a
   * origem, e a inversão é deliberada.
   *
   * ── O DEFEITO QUE MOTIVOU ────────────────────────────────────────────────
   *
   * No cockpit de origem a camada escrevia, sempre, os percentis da escala
   * (`p50 481 ct · p99 1.131 ct · escala da janela visível`), a declaração de
   * escala colapsada (`A janela visível não apresenta variação de magnitude.`) e
   * o rodapé de cobertura (`Cobertura não verificada · fila não informado ·
   * execução não informado`). Numa mesa, com o operador treinado e o dado
   * completo, isso é instrumentação útil.
   *
   * Numa biblioteca, não: no playground, com dado sintético e sem livro, essas
   * três linhas somam a maior parte do texto na tela, aparecem SOBRE as velas e
   * quase todas dizem "não informado" — o usuário fotografou a tela e descreveu
   * como poluição ilegível, com razão. Informação de desenvolvimento passa a ser
   * pedida, não imposta.
   *
   * ── O QUE ENTRA NESTE CANAL, E O QUE NÃO ENTRA ───────────────────────────
   *
   * | texto | canal |
   * |---|---|
   * | percentis da escala, `escala da janela visível` | diagnóstico |
   * | `A janela visível não apresenta variação de magnitude.` | diagnóstico |
   * | rodapé de cobertura com os horários | diagnóstico |
   * | identidade da camada (`Livro · fila em repouso`) | legenda |
   * | `Verde: … · Vermelho: …`, `Bolha: raio = volume…` | legenda |
   * | aviso de zoom apertado, aviso de autodesativação | legenda (ressalva) |
   *
   * ⚠️ **Compromisso assumido, declarado:** com o diagnóstico desligado o
   * operador vê a mancha de calor sem os números que a calibram, e sem a ressalva
   * de escala colapsada. Uma escala relativa sem número é menos informativa — era
   * o argumento do requisito 2.7 da origem. A troca é consciente: quem opera de
   * verdade liga `mostrarDiagnostico: true` e recupera tudo, byte a byte, na mesma
   * redação; quem só está vendo o gráfico não paga por instrumentação que não
   * pediu.
   *
   * ⚠️ Subordinado a `mostrarLegenda`: com ela em `false` a camada fica MUDA, e
   * ligar o diagnóstico não a faz falar. É uma porta só — quem cala a camada não
   * quer texto nenhum sobre o gráfico.
   */
  readonly mostrarDiagnostico?: boolean;
  /**
   * Como a cor codifica a informação.
   *
   * ⚠️ **Ausente ⇒ `'LADO'`**, o comportamento original: matiz é o LADO (verde =
   * fila de compra, vermelho = fila de venda) e a opacidade é a intensidade. As
   * bancadas de propriedade medem a cor por lado e constroem esta camada sem
   * informar a opção — manter `LADO` como omissão preserva o contrato delas.
   *
   * `'TERMICA'` é o visual do bookmap comercial: a **cor** codifica o TAMANHO da
   * fila (azul → ciano → amarelo → laranja → branco) e o lado se lê pela POSIÇÃO
   * relativa ao preço. Foi o pedido do operador em 04/09/2026 — *"o Bookmap que
   * eu vi em outros projetos sempre era visual tipo o MarketProfile"* — e a
   * justificativa que eu havia registrado para não fazer ("precisaria de outro
   * canal para o lado") estava errada: no comercial a posição já diz o lado.
   */
  readonly modoCor?: 'LADO' | 'TERMICA';
  /**
   * Formatador dos horários do rodapé de cobertura.
   *
   * ⚠️ **Ausente ⇒ BRT sem segundos**, o comportamento original. As bancadas de
   * propriedade e os testes de legenda constroem esta camada sem informar a
   * opção e comparam o texto do rodapé — manter BRT como omissão preserva o
   * contrato delas byte a byte.
   *
   * ── POR QUE EXISTE (adição da generalização) ────────────────────────────
   *
   * Na origem o fuso `America/Sao_Paulo` estava fixo no núcleo de cobertura, o
   * que é correto num cockpit de mesa brasileira e errado numa biblioteca: a
   * mesma camada pode ser montada por uma mesa em São Paulo, um replay de
   * backtest que raciocina em UTC e um painel em Chicago. Rótulo de horário que
   * mente sobre o fuso, numa tela de fluxo de ordem, custa dinheiro.
   *
   * A camada não constrói o formatador nem lê ambiente — ela apenas repassa o
   * que recebeu ao núcleo puro. Determinismo preservado.
   *
   * @example
   * // Rótulos em UTC, para replay de backtest:
   * layer.update({ relogio: makeClockFormatter(PRESENTATION_UTC, { withSeconds: false }) });
   */
  readonly relogio?: ClockFormatter;
}

// ═════════════════════════════════════════════════════════════════════════════
// Constantes de desenho
// ═════════════════════════════════════════════════════════════════════════════

/** Níveis de cor. Alinhado ao domínio de `DrawCell.bucket` (`0..15`). */
const BUCKETS = 16;

/** Maior índice de bucket. Indexar `BUCKETS` devolveria `undefined`. */
const BUCKET_MAX = BUCKETS - 1;

/** Repouso exigido para recalcular a escala depois de mover o gráfico. */
const SCALE_DEBOUNCE_MS = 120;

// ═════════════════════════════════════════════════════════════════════════════
// Orçamento adaptativo (requisitos 9.9 e 9.10)
// ═════════════════════════════════════════════════════════════════════════════

/** Alvo de tempo da passada de desenho, em milissegundos (requisito 9.3). */
const DRAW_TARGET_MS = 8;

/**
 * Passadas que compõem a amostra da mediana (requisito 9.9).
 *
 * A avaliação só acontece com a janela **cheia**. Com menos amostras não existe
 * "as 30 passadas mais recentes", e o próprio requisito 9.1 descarta as 10
 * primeiras repetições ao apurar tempo — reduzir o orçamento a partir de três
 * amostras contrariaria o mesmo cuidado.
 */
const DRAW_SAMPLE_WINDOW = 30;

/** Piso do orçamento de células: a redução não passa daqui (requisito 9.9). */
const BUDGET_FLOOR_CELLS = 500;

/** Fila de compra — verde. */
const CANAL_BID = '34, 197, 94';

/** Fila de venda — vermelho. */
const CANAL_ASK = '239, 68, 68';

/**
 * Cobertura ausente — âmbar.
 *
 * A mesma cor da hachura e do aviso de rodapé, de propósito: o operador associa
 * a faixa hachurada ao texto que a explica sem precisar de legenda extra.
 */
const CANAL_AMBAR = '245, 158, 11';

/**
 * Marca de execução — cinza claro, e **forma** distinta do retângulo de fila.
 *
 * A distinção principal é geométrica, não cromática: a marca é uma barra
 * estreita centrada dentro da célula (ver `EXEC_MARK_DIVISOR`). Cor sozinha não
 * bastaria — em `EXECUCAO` a marca cai sobre um retângulo já pintado, e duas
 * cores próximas em intensidades próximas seriam indistinguíveis.
 */
const CANAL_EXEC = '226, 232, 240';

/** Fração da largura da célula ocupada pela marca de execução. */
const EXEC_MARK_DIVISOR = 3;

/** Espessura do contorno de célula fora da escala, em pixels lógicos. */
const OUTLINE_PX = 1;

/** Contorno de célula fora da escala — branco quase opaco. */
const OUTLINE_STYLE = 'rgba(255, 255, 255, 0.85)';

/** Distância entre as linhas da hachura, em pixels lógicos. */
const HATCH_STEP_PX = 6;

/** Corpo de texto da legenda, em pixels lógicos. */
const FONT_PX = 11;

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Margem da legenda e do rodapé em relação à borda do painel. */
const TEXT_MARGIN_PX = 8;

/** Altura de linha da legenda, em pixels lógicos. */
const TEXT_LINE_PX = 14;

const TEXT_STYLE = 'rgba(226, 232, 240, 0.92)';
const TEXT_SHADOW_STYLE = 'rgba(0, 0, 0, 0.65)';
const TEXT_AMBAR_STYLE = 'rgba(245, 158, 11, 0.95)';

/**
 * ⭐ A caixa de contraste do texto vive em `./text-box.js`, compartilhada com o
 * footprint: as duas camadas tinham o mesmo defeito de legibilidade e resolvê-lo
 * duas vezes garantiria duas aparências diferentes para a mesma coisa. O módulo
 * também explica por que a caixa **não** pode usar `fillRect`.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Aviso de autodesativação (requisitos 10.6 e 10.7)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que a tela diz enquanto a camada permanece autodesativada (requisito 10.6).
 *
 * As duas primeiras linhas são obrigatórias pelo requisito: a camada de livro foi
 * desativada por falha de desenho, e o restante do gráfico segue operante. A
 * segunda existe porque a primeira, sozinha, deixa o operador sem saber se o que
 * ele está vendo ainda é confiável — e a resposta é que é: o que parou foi a
 * camada de contexto, não o gráfico.
 *
 * A terceira diz o que fazer. Sem ela, o caminho de retomada do requisito 10.7
 * existiria no código e não na cabeça de quem opera.
 */
const AVISO_AUTODESATIVADA: readonly string[] = [
  'Livro · camada desativada por falha de desenho.',
  'O restante do gráfico segue operante: velas, linhas de preço, marcadores e volume continuam.',
  'Desligue e religue a chave do livro no painel de indicadores para tentar de novo.',
];

/**
 * O que a tela diz entre a reabilitação e a primeira passada sem exceção.
 *
 * ⚠️ Texto próprio, e não o de cima: nesse intervalo a camada **está** desenhando,
 * então repetir "camada desativada" seria afirmação falsa sobre o que está na
 * tela. O aviso continua porque nada ainda provou que a falha passou — é
 * exatamente a distinção entre intenção e evidência do requisito 10.7.
 */
const AVISO_NOVA_TENTATIVA: readonly string[] = [
  'Livro · nova tentativa depois de uma falha de desenho.',
  'O restante do gráfico segue operante; este aviso sai quando uma passada concluir sem falha.',
];

// ═════════════════════════════════════════════════════════════════════════════
// Registro de sessão
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O esgotamento de orçamento já foi registrado nesta sessão?
 *
 * ── POR QUE O ESTADO É DE MÓDULO, E NÃO DE INSTÂNCIA ──────────────────────
 *
 * O critério 3.5 pede o registro **uma vez por sessão**, e sessão é a janela
 * entre a montagem e o recarregamento — não a vida de um primitive. O gráfico
 * remonta a cada troca de timeframe, então um flag de instância registraria uma
 * linha por troca e o log viraria ruído, que é a forma prática de o aviso deixar
 * de ser lido.
 *
 * O núcleo não pode guardar isso: ele é puro e não tem escopo de sessão. É por
 * isso que a agregação é chamada por `aggregateForZoomWithOutcome`, que devolve
 * o desfecho ao chamador, em vez de `aggregateForZoom`, que o descarta. Inferir
 * o esgotamento de uma saída vazia seria errado — janela degenerada, janela sem
 * célula e grid vazio produzem a mesma saída vazia e são situações normais.
 */
let budgetExhaustedLogged = false;

/**
 * A degradação adaptativa do orçamento já foi registrada nesta sessão?
 *
 * Mesmo escopo e mesma razão do registro acima: o gráfico remonta a cada troca
 * de timeframe, e uma linha por remontagem transformaria o aviso em ruído.
 *
 * ⚠️ **A janela de medições não mora aqui, e é de propósito.** Ela é estado de
 * instância: cada camada tem o seu orçamento, e amostras de uma instância não
 * descrevem o custo de outra. Só o registro — que é por sessão, por definição —
 * é estado de módulo.
 */
let budgetDegradedLogged = false;

/**
 * A autodesativação por exceção no desenho já foi registrada nesta sessão?
 *
 * ── O ESCOPO ESCOLHIDO, E POR QUE ESTE E NÃO O OUTRO ──────────────────────
 *
 * O requisito 10.5 pede o registro uma única vez "no intervalo entre a montagem
 * do gráfico e o recarregamento da página". O intervalo tem pontas de naturezas
 * diferentes: a montagem é por gráfico e acontece muitas vezes — o gráfico
 * remonta a cada troca de timeframe —, enquanto o recarregamento é por página.
 * Isso admite duas leituras, e elas não coincidem:
 *
 * | leitura | onde o flag mora | quantos registros por página |
 * |---|---|---|
 * | por montagem | instância | um por troca de timeframe |
 * | **por página** | **módulo** | **um, escolhida** |
 *
 * Adotei o escopo de página, que é o mesmo dos dois registros acima. Três razões,
 * na ordem em que pesam:
 *
 * 1. **É a leitura segura.** Com escopo de módulo é impossível registrar duas
 *    vezes dentro de qualquer intervalo montagem→recarregamento, então a
 *    exigência vale para toda leitura do texto. Com escopo de instância a
 *    exigência valeria só para a leitura mais frouxa, e o mesmo intervalo de
 *    página acumularia uma linha por remontagem.
 * 2. **O propósito do registro é ser lido.** Uma linha por troca de timeframe
 *    transforma o aviso em ruído, que é a forma prática de ele deixar de ser
 *    lido — e um aviso não lido não registra nada.
 * 3. **Consistência.** Os outros dois registros desta camada já usam este escopo,
 *    pela mesma razão. Escopos diferentes para avisos vizinhos exigiriam que quem
 *    lê o log soubesse qual é qual.
 *
 * ⚠️ **Consequência aceita, e é ela que justifica o aviso na tela ser de
 * instância.** A segunda autodesativação da mesma página — a do requisito 10.7,
 * quando a exceção se repete depois de o operador religar a chave — **não** gera
 * nova linha de log. O comportamento se repete; o registro não. Se o aviso na
 * tela compartilhasse este escopo, essa segunda autodesativação aconteceria em
 * silêncio absoluto, e é por isso que ele é estado de instância.
 */
let selfDisableLogged = false;

/**
 * Zera os registros de sessão.
 *
 * Existe para o teste poder observar o "uma vez por sessão" sem depender da
 * ordem dos casos — nenhum caminho de produção chama isto.
 *
 * ⚠️ Todo registro de escopo de sessão desta camada precisa ser zerado **aqui**,
 * e não numa função paralela: o teste chama uma única função no preparo de cada
 * caso, e um registro esquecido fora dela vazaria entre casos como estado
 * pendurado — falhando ou passando conforme a ordem de execução.
 */
export function resetBookmapSessionWarnings(): void {
  budgetExhaustedLogged = false;
  budgetDegradedLogged = false;
  selfDisableLogged = false;
}

// ═════════════════════════════════════════════════════════════════════════════
// Utilitários locais
// ═════════════════════════════════════════════════════════════════════════════

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * O relógio padrão da medição de passada.
 *
 * ── POR QUE ESTE RELÓGIO, E POR QUE ELE É O ÚNICO DO ARQUIVO ──────────────
 *
 * A leitura é monotônica e tem resolução de fração de milissegundo. O alvo de
 * comparação é 8 ms, então um relógio de resolução grossa — que salta de 0 para
 * 1 ms e nunca resolve nada entre os dois — classificaria passadas de 7 ms e de
 * 12 ms no mesmo valor e tornaria a mediana incapaz de decidir. Também não volta
 * atrás quando o horário do sistema é ajustado, que produziria duração negativa.
 *
 * ⚠️ Esta é a **única** leitura de relógio do arquivo, e ela fica fora do
 * caminho de agregação de propósito: o núcleo é puro, e medir dentro dele
 * quebraria a determinação de que a mesma entrada produz a mesma saída.
 *
 * Ambiente sem o relógio de alta resolução devolve zero nas duas pontas, logo
 * duração zero e nenhuma degradação. É a direção segura: preferir a imagem
 * completa a reduzir a resolução por uma medição que não existe.
 */
function readHighResolutionClock(): number {
  if (typeof performance === 'undefined') return 0;
  return typeof performance.now === 'function' ? performance.now() : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Descreve o valor lançado, sem nunca lançar por sua vez.
 *
 * ── POR QUE ISTO É DEFENSIVO DE PROPÓSITO ─────────────────────────────────
 *
 * O que chega aqui é um valor **arbitrário** vindo de dentro do ciclo de desenho:
 * `throw` aceita qualquer coisa. E as conversões óbvias falham para valores
 * perfeitamente possíveis — a conversão em texto de um símbolo lança por
 * definição, e um objeto pode ter conversão própria que lança. Uma exceção
 * levantada **dentro** do tratamento chegaria ao gráfico exatamente pela porta
 * que o tratamento existe para fechar.
 *
 * `Object.prototype.toString.call` é a saída segura do último caso: descreve o
 * tipo sem invocar conversão definida por quem lançou.
 */
function describeError(erro: unknown): string {
  try {
    if (typeof erro === 'string') return erro;
    if (erro instanceof Error && typeof erro.message === 'string') return erro.message;
    return Object.prototype.toString.call(erro);
  } catch {
    return 'motivo não legível';
  }
}

/**
 * Alpha → bucket em `0..15`.
 *
 * ⚠️ O `clamp` no teto **não** é decorativo. `floor(t × 16)` devolve exatamente
 * `16` quando `t` chega a `1`, e `16` é uma posição fora de uma tabela de 16
 * cores: o estilo sairia `undefined`, o contexto 2D manteria a cor anterior, e a
 * parede mais forte seria pintada com a cor da anterior — sem lançar e sem
 * aparecer em log. O mesmo defeito já ocorreu nesta feature, dentro do núcleo,
 * e custou uma rodada; o núcleo hoje o previne do lado dele, e este `clamp` o
 * previne do lado de cá, para que a proteção não dependa de nenhum dos dois
 * isoladamente.
 *
 * Amplitude não positiva colapsa no bucket mínimo em vez de dividir por zero.
 */
function bucketFromAlpha(alpha: number, alphaMin: number, alphaMax: number): number {
  const amplitude = alphaMax - alphaMin;
  if (!isFiniteNumber(alpha) || !isFiniteNumber(amplitude) || amplitude <= 0) return 0;
  const t = (alpha - alphaMin) / amplitude;
  if (!isFiniteNumber(t)) return 0;
  return clamp(Math.floor(t * BUCKETS), 0, BUCKET_MAX);
}

/**
 * Paleta de 16 tons de um canal, do bucket 0 ao 15.
 *
 * Construída uma vez por escala e reusada entre passadas: montar 16 cadeias por
 * passada alocaria durante o arrasto, e alocação no laço de desenho aparece como
 * engasgo de coleta de lixo exatamente quando o operador está movendo o gráfico.
 */
function buildPalette(canal: string, alphaMin: number, alphaMax: number): readonly string[] {
  const out: string[] = new Array<string>(BUCKETS);
  const amplitude = alphaMax - alphaMin;
  for (let b = 0; b < BUCKETS; b++) {
    // `+ 0,5` toma o centro da faixa do bucket, não a borda: a borda inferior do
    // bucket 0 seria `alphaMin` exato e a do 15 ficaria abaixo de `alphaMax`,
    // desperdiçando a extremidade da escala que justamente marca a parede.
    const t = amplitude > 0 ? (b + 0.5) / BUCKETS : 1;
    out[b] = `rgba(${canal}, ${(alphaMin + amplitude * t).toFixed(3)})`;
  }
  return out;
}

let formatadorContratos: Intl.NumberFormat | null = null;

/**
 * Quantidade em contratos, no formato pt-BR, sem casas decimais.
 *
 * O formatador é criado na primeira chamada e reusado: construir um por passada
 * é caro, e construí-lo no import cobraria o custo de quem nunca liga a camada.
 */
function formatContratos(v: number): string {
  if (!isFiniteNumber(v)) return '—';
  if (formatadorContratos === null) {
    formatadorContratos = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  }
  return formatadorContratos.format(Math.round(v));
}

/** Rótulo da grandeza para a legenda. */
function rotuloGrandeza(metrica: MetricaBookmap): string {
  return metrica === 'EXECUCAO' ? 'execução' : 'fila em repouso';
}

/** A métrica selecionada inclui execução? */
function incluiExecucao(metrica: MetricaBookmap): boolean {
  return metrica === 'EXECUCAO' || metrica === 'AMBAS';
}



// ═════════════════════════════════════════════════════════════════════════════
// O plano de desenho
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma faixa vertical de hachura, já em pixels e recortada ao viewport.
 *
 * `w >= 1` sempre que a interseção com a janela visível não for vazia
 * (requisito 7.2): faixa de largura zero seria indistinguível de ausência de
 * hachura, e ausência de hachura afirma cobertura que ninguém verificou.
 */
interface HatchBand {
  readonly x: number;
  readonly w: number;
}

/**
 * Uma bolha de execução, já em pixels lógicos.
 *
 * `raio` codifica o VOLUME e `side` codifica o AGRESSOR — as duas perguntas que
 * a barra cinza não respondia. `bucket` só modula a opacidade, para a bolha
 * grande não apagar por completo a vela sob ela.
 */
interface BolhaExec {
  readonly cx: number;
  readonly cy: number;
  readonly raio: number;
  readonly side: 'BID' | 'ASK';
  readonly bucket: number;
}

/**
 * Raio mínimo de bolha, em pixels lógicos.
 *
 * ⚠️ **4, e não 2.** Com 2 px a bolha é um ponto: não se lê como círculo, não se
 * distingue de sujeira de renderização e não comunica lado. Medido na tela do
 * operador em 03/09/2026 — a maior parte das células caía no piso e o resultado
 * foi descrito, com razão, como "objetos sem definição".
 */
const BOLHA_RAIO_MIN_PX = 4;

/** Raio máximo. Acima disso a bolha vira mancha e engole as vizinhas. */
const BOLHA_RAIO_MAX_PX = 18;

/** Opacidade da bolha mais fraca e da mais forte. */
const BOLHA_ALPHA_MIN = 0.4;
const BOLHA_ALPHA_MAX = 0.9;

/** Contorno da bolha — escuro, para separar bolhas encostadas. */
const BOLHA_CONTORNO = 'rgba(0, 0, 0, 0.45)';

/**
 * Fração de bolhas no raio mínimo a partir da qual a legenda avisa que o tamanho
 * deixou de refletir volume.
 *
 * ⚠️ **Metade, e não "alguma".** A célula da borda direita é recortada a 1 px em
 * quase toda passada, então "alguma bolha no piso" é praticamente sempre
 * verdadeiro — o aviso acenderia com o dia enquadrado e as bolhas legíveis. Meio
 * a meio separa "uma célula na borda" de "o dia está comprimido".
 */
const FRACAO_BOLHAS_NO_PISO_PARA_AVISAR = 0.5;

/**
 * Raio da bolha a partir da quantidade executada.
 *
 * ⚠️ **`sqrt`, não linear.** A grandeza que o olho lê num círculo é a ÁREA, e
 * área cresce com o quadrado do raio: raio proporcional ao volume faria uma
 * execução 4× maior parecer 16× maior. Com `sqrt`, a área fica proporcional ao
 * volume e a comparação visual é honesta.
 *
 * ⚠️ **A normalização vai de ZERO a `p99`, e NÃO de `p50` a `p99`.** A primeira
 * versão usava `p50` como piso, o que parecia elegante — a mesma faixa da
 * opacidade — e era um defeito grave: por definição, **metade das células fica
 * abaixo do p50**, então metade recebia o raio mínimo. Com os percentis medidos
 * na tela do operador (exec `p50 = 141 ct`, `p99 = 1.169 ct`), toda célula até
 * 141 contratos virava um ponto de 2 px, indistinguível de sujeira.
 *
 * Partindo de zero, aquelas mesmas células ficam entre 5,8 e 8,9 px — círculos
 * legíveis, com tamanhos distinguíveis entre si. A opacidade continua vindo de
 * `p50`→`p99`, e a diferença de faixa é deliberada: a opacidade só precisa
 * separar "forte" de "fraco"; o raio precisa ser **visível em toda a
 * distribuição**.
 *
 * Amostra sem variação (`p99 <= 0`) devolve o raio máximo para quantidade
 * positiva, espelhando o que `alphaOf` faz com a opacidade nesse caso.
 *
 * Pura e determinística. Nunca devolve valor não finito.
 */
function raioDaBolha(
  quantidade: number,
  scale: ColorScale,
  raioMax: number = BOLHA_RAIO_MAX_PX,
): number {
  if (!isFiniteNumber(quantidade) || quantidade <= 0) return 0;

  // Teto efetivo: nunca abaixo do piso (senão a bolha vira ponto) nem acima do
  // teto absoluto. Valor inválido cai no teto absoluto — degradar para o teto é
  // o comportamento anterior, e é o seguro.
  const teto = isFiniteNumber(raioMax)
    ? Math.min(BOLHA_RAIO_MAX_PX, Math.max(BOLHA_RAIO_MIN_PX, raioMax))
    : BOLHA_RAIO_MAX_PX;

  const p99 = isFiniteNumber(scale.p99) ? scale.p99 : 0;
  const amplitude = teto - BOLHA_RAIO_MIN_PX;

  if (!(p99 > 0)) return teto;

  const t = quantidade / p99;
  if (!isFiniteNumber(t) || t <= 0) return BOLHA_RAIO_MIN_PX;
  if (t >= 1) return teto;

  const raio = BOLHA_RAIO_MIN_PX + amplitude * Math.sqrt(t);
  if (!isFiniteNumber(raio)) return BOLHA_RAIO_MIN_PX;
  return raio < BOLHA_RAIO_MIN_PX
    ? BOLHA_RAIO_MIN_PX
    : raio > teto
      ? teto
      : raio;
}

/**
 * Teto do raio a partir da LARGURA DA CÉLULA — o que impede a corrente de bolhas.
 *
 * ⚠️ O defeito que isto conserta foi medido na tela do operador em 04/09/2026,
 * depois do conserto do recorte: as bolhas apareciam junto das velas, como
 * pedido, **mas fundidas numa corrente contínua** — ele perguntou, com razão,
 * *"como que lê isso?"*.
 *
 * A aritmética: o balde é de 60 s e o raio ia a 18 px, ou seja **36 px de
 * diâmetro**. Com o dia comprimido, cada minuto recebia 3 a 4 px de largura, e
 * bolhas espaçadas de 3 px com 36 px de diâmetro se sobrepõem dez vezes. O
 * contorno escuro — que existe para separar bolhas encostadas — não dá conta de
 * dez camadas.
 *
 * O teto passa a ser a própria largura da célula: centros a `w` de distância com
 * raio `w` se sobrepõem em 50%, o que ainda deixa cada centro visível. Continua
 * valendo a decisão de a bolha PODER exceder a célula — é o que faz a execução
 * grande aparecer num balde estreito —, só não em uma ordem de grandeza.
 *
 * ⚠️ Com célula muito estreita o teto encosta no piso, e aí **o volume deixa de
 * ser distinguível**: todas as bolhas saem no raio mínimo. Isso NÃO é escondido —
 * a legenda passa a dizer, e a saída é enquadrar o dia (botão de foco) ou dar
 * zoom. Perder a codificação de volume e avisar é melhor que uma mancha que não
 * codifica nada e não avisa.
 *
 * Pura e determinística.
 */
function raioMaximoPorEspaco(larguraNominalPx: number): number {
  if (!isFiniteNumber(larguraNominalPx) || larguraNominalPx <= 0) {
    return BOLHA_RAIO_MAX_PX;
  }
  if (larguraNominalPx <= BOLHA_RAIO_MIN_PX) return BOLHA_RAIO_MIN_PX;
  return larguraNominalPx >= BOLHA_RAIO_MAX_PX ? BOLHA_RAIO_MAX_PX : larguraNominalPx;
}

/**
 * Largura NOMINAL de uma célula, em pixels lógicos — o espaçamento entre centros.
 *
 * ⚠️ **Nominal, e não a largura recortada da célula.** Foi um teste pré-existente
 * que pegou a diferença, e ela é grave: `clipAxis` recorta a célula da borda
 * direita a **1 px**, então usar a largura recortada como teto do raio fazia a
 * bolha daquela célula sair no piso **independentemente do volume**. No caso do
 * teste, a MAIOR execução do grid (4.010 ct, na última coluna) recebia a MENOR
 * bolha — inversão de leitura, que é pior que o transbordo que o teto veio
 * consertar.
 *
 * A nominal é a mesma para todas as células da passada, então o teto é uniforme:
 * nenhuma célula é punida por estar na borda, e a comparação de tamanho entre
 * bolhas continua honesta.
 *
 * Derivada da janela visível e do agrupamento, sem consultar coordenada: é a
 * fração da largura do painel que o balde agrupado ocupa.
 */
function larguraNominalDaCelula(
  larguraPainelPx: number,
  tsDe: number,
  tsAte: number,
  baldeSeg: number,
  fatorTempo: number,
): number {
  const janelaMs = tsAte - tsDe;
  if (!isFiniteNumber(janelaMs) || janelaMs <= 0) return Number.NaN;
  if (!isFiniteNumber(larguraPainelPx) || larguraPainelPx <= 0) return Number.NaN;
  const duracaoMs = baldeSeg * Math.max(1, fatorTempo) * 1000;
  if (!isFiniteNumber(duracaoMs) || duracaoMs <= 0) return Number.NaN;
  const largura = (duracaoMs / janelaMs) * larguraPainelPx;
  return isFiniteNumber(largura) ? largura : Number.NaN;
}

/** Paleta de bolha de um lado, 16 tons entre os limites próprios da bolha. */
function buildPaletaBolha(canal: string): readonly string[] {
  return buildPalette(canal, BOLHA_ALPHA_MIN, BOLHA_ALPHA_MAX);
}

/**
 * Tudo o que a passada de desenho consome, calculado **fora** dela.
 *
 * ── POR QUE AGRUPAR POR BUCKET AQUI, E NÃO NO LAÇO DE DESENHO ─────────────
 *
 * O pseudocódigo do design percorre a lista inteira de células uma vez por
 * bucket, descartando com `continue` as que não pertencem ao bucket corrente:
 * com 3.000 células e 16 buckets por lado, são 96.000 iterações e 93.750
 * descartes por passada. Agrupar no cache troca isso por 3.000 iterações e 32
 * trocas de estilo — o mesmo resultado visual, com a mesma ordem de passadas,
 * pela fração do trabalho. A divergência é de implementação, não de
 * comportamento, e está declarada aqui de propósito.
 *
 * Os arrays são reusados entre reconstruções (`length = 0` em vez de novo
 * array), porque realocar 48 arrays a cada quadro de arrasto alocaria justamente
 * durante a movimentação.
 */
class DrawPlan {
  /** Fila de compra, indexada por bucket de cor. */
  readonly bid: DrawCell[][] = Array.from({ length: BUCKETS }, () => [] as DrawCell[]);

  /** Fila de venda, indexada por bucket de cor. */
  readonly ask: DrawCell[][] = Array.from({ length: BUCKETS }, () => [] as DrawCell[]);

  /** Marcas de execução, indexadas pelo bucket da escala de execução. */
  readonly exec: DrawCell[][] = Array.from({ length: BUCKETS }, () => [] as DrawCell[]);

  /**
   * Bolhas de execução (`marcaExec: 'BOLHA'`), na ordem em que foram montadas.
   *
   * ⚠️ **Não** indexadas por bucket, ao contrário de `exec`: o agrupamento por
   * bucket existe para trocar `fillStyle` 16 vezes em vez de uma vez por forma,
   * e isso só compensa quando a forma é `fillRect` em lote. Cada bolha precisa
   * de `beginPath`/`arc`/`fill` própria de qualquer maneira, então agrupar não
   * economizaria nada e obrigaria a percorrer 16 listas quase vazias.
   *
   * A ordem é a das células agregadas — determinística, e faz a bolha de um
   * instante posterior cair sobre a anterior, que é a leitura correta.
   */
  readonly bolhas: BolhaExec[] = [];

  /** Células que estouraram o teto da escala e recebem contorno. */
  readonly outlines: DrawCell[] = [];

  /** Faixas de cobertura ausente. */
  readonly hatch: HatchBand[] = [];

  /** Linhas da legenda, em pt-BR, de cima para baixo. */
  legend: readonly string[] = [];

  /**
   * A legenda carrega o aviso de autodesativação e deve sair em âmbar.
   *
   * Espelha `footerAlerta` de propósito, em vez de um segundo mecanismo de
   * notificação: o aviso do requisito 10.6 precisa se distinguir da legenda
   * normal, e a distinção por cor já é o vocabulário desta camada — a mesma cor
   * da hachura e da ressalva de cobertura.
   */
  legendAlerta = false;

  /** Linha de rodapé com a classe de cobertura e os horários em BRT. */
  footer: string | null = null;

  /** O rodapé carrega ressalva de cobertura e deve sair em âmbar. */
  footerAlerta = false;

  /** Paleta da fila de compra, por bucket. */
  paletteBid: readonly string[] = [];

  /** Paleta da fila de venda, por bucket. */
  paletteAsk: readonly string[] = [];

  /** Paleta da marca de execução, por bucket. */
  paletteExec: readonly string[] = [];

  /** Paleta da bolha de compra agressora, por bucket. */
  paletteBolhaBid: readonly string[] = [];

  /** Paleta da bolha de venda agressora, por bucket. */
  paletteBolhaAsk: readonly string[] = [];

  /**
   * Suavizar a borda das células de fila.
   *
   * ⚠️ **Mora no PLANO, e não em `options` do renderizador — por contrato.** O
   * `BookmapRenderer` não tem acesso às opções e não decide nada; é a mesma razão
   * pela qual a supressão da legenda vive em `buildLegend` e não no desenho.
   * Tentei ler `this.options` aqui e o TypeScript reprovou com TS2339, que é a
   * segunda vez que este contrato me pega.
   *
   * Preenchido por quem monta o plano, a partir do modo de cor: acompanha a rampa
   * térmica, de modo que o modo `LADO` fique byte-idêntico ao histórico.
   */
  suavizar = false;

  /** Há alguma forma a emitir? Legenda e rodapé contam. */
  vazio = true;

  /**
   * Dimensões da ÁREA DE PLOTAGEM, em pixels lógicos — o `paneSize()`.
   *
   * ⚠️ Existe para RECORTAR a bolha de execução, e o motivo é um defeito medido
   * na tela do operador em 04/09/2026: as bolhas apareciam **por cima da escala
   * de preço e dos rótulos** das linhas (Teto, Plano Stop, TOPO DIA…), em vez de
   * junto das velas.
   *
   * A mecânica era o encadeamento de três coisas, cada uma correta em isolado:
   *
   *  1. `clipAxis` (em `bookmap-pixels.core.ts`) EMPURRA para dentro a célula que
   *     toca a borda direita, em vez de descartá-la — decisão deliberada e
   *     documentada lá. Uma célula que só encosta na borda vira `x = limite - w`
   *     com `w` podendo ser 1 px;
   *  2. o centro da bolha é calculado DEPOIS desse recorte
   *     (`cx = drawn.x + drawn.w / 2`), logo cai em `limite - 0,5`;
   *  3. o raio da bolha vai até 18 px lógicos e **não** tem relação com a
   *     largura da célula — por desenho, é assim que a execução grande fica
   *     visível num balde estreito de 60 s.
   *
   * Somando: bolha centrada na última coluna do painel transborda ~18 px para a
   * DIREITA da área de plotagem, que é exatamente onde vivem a escala de preço e
   * os rótulos. E quando várias colunas caem além da borda, TODAS colapsam na
   * mesma coluna e as bolhas se empilham ali.
   *
   * ⚠️ O comentário original em `buildCells` afirmava que "o recorte do canvas
   * impede que ela vaze para fora do painel". **Não havia recorte nenhum** — a
   * afirmação descrevia uma garantia inexistente. Agora há, e é este par de
   * campos que a sustenta.
   *
   * Zero ou não finito ⇒ `fillExecBubbles` não recorta, preservando o
   * comportamento de quem construir o plano sem informar a geometria (as
   * bancadas fazem isso).
   */
  larguraPainelPx = 0;
  alturaPainelPx = 0;

  /**
   * Quantas bolhas saíram com o teto de raio encostado no piso, e quantas houve.
   *
   * Quando a célula é estreita demais, `raioMaximoPorEspaco` colapsa o teto no
   * piso e a bolha sai do tamanho mínimo — o volume deixa de ser codificado. A
   * legenda diz isso em vez de deixar o operador ler tamanho onde não há tamanho
   * a ler.
   *
   * ⚠️ São DUAS contagens, e não um sinalizador, por causa de um falso alarme que
   * um teste pegou antes de a tela ver: `clipAxis` recorta a célula da borda
   * direita a **1 px** em quase toda passada (é o desfecho documentado lá), então
   * um sinalizador do tipo "alguma bolha no piso" acenderia **sempre**, inclusive
   * com o dia enquadrado e as bolhas perfeitamente legíveis. Alarme que sempre
   * soa treina a ignorar alarme.
   *
   * O aviso exige compressão GERAL — ver `FRACAO_BOLHAS_NO_PISO_PARA_AVISAR`.
   */
  bolhasNoPiso = 0;
  bolhasContadas = 0;

  /** A compressão é geral o bastante para o aviso valer? */
  semEscalaDeVolume(): boolean {
    if (this.bolhasContadas <= 0) return false;
    return this.bolhasNoPiso / this.bolhasContadas >= FRACAO_BOLHAS_NO_PISO_PARA_AVISAR;
  }

  /** Alguma bolha a emitir? */
  temBolhas(): boolean {
    return this.bolhas.length > 0;
  }

  reset(): void {
    for (let b = 0; b < BUCKETS; b++) {
      const bid = this.bid[b];
      const ask = this.ask[b];
      const exec = this.exec[b];
      if (bid !== undefined) bid.length = 0;
      if (ask !== undefined) ask.length = 0;
      if (exec !== undefined) exec.length = 0;
    }
    this.bolhas.length = 0;
    this.outlines.length = 0;
    this.hatch.length = 0;
    this.legend = [];
    this.legendAlerta = false;
    this.footer = null;
    this.footerAlerta = false;
    this.larguraPainelPx = 0;
    this.alturaPainelPx = 0;
    this.bolhasNoPiso = 0;
    this.bolhasContadas = 0;
    this.vazio = true;
  }

  /**
   * Solta as paletas.
   *
   * ⚠️ Deliberadamente **fora** de `reset`: `reset` roda a cada reconstrução, e
   * limpar as paletas ali forçaria a remontagem das 48 cadeias de cor por quadro
   * de movimentação — que é exatamente o que o cache de paleta existe para
   * evitar. Só a desanexação as libera.
   */
  clearPalettes(): void {
    this.paletteBid = [];
    this.paletteAsk = [];
    this.paletteExec = [];
    this.paletteBolhaBid = [];
    this.paletteBolhaAsk = [];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// O renderizador
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Emite as formas do plano no contexto 2D.
 *
 * Não decide nada: recebe o plano pronto e o percorre. Toda a passada acontece
 * dentro de **uma única** entrada em espaço de bitmap (requisito 9.8) — entrar e
 * sair por célula custaria uma troca de transformação por retângulo.
 *
 * ⚠️ O corpo está em `paint`, e `draw` só o chama. É esse recorte que permite
 * cercar a passada inteira em `try/catch` — a contenção do requisito 10.5 — sem
 * espalhar tratamento de exceção pelo laço de desenho. Manter a chamada isolada
 * é o que mantém a contenção legível: um lugar só onde a exceção pode surgir, um
 * lugar só onde ela é tratada.
 */
class BookmapRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly plan: DrawPlan,
    private readonly clock: () => number,
    private readonly reportPass: (elapsedMs: number) => void,
    private readonly reportFailure: (erro: unknown) => void,
  ) {}

  /**
   * A passada, cercada pela medição e pela contenção de exceção.
   *
   * ── POR QUE MEDIR AQUI, E NÃO EM `updateAllViews` ─────────────────────────
   *
   * O alvo de 8 ms do requisito 9.3 é da **passada de desenho**, e é aqui que o
   * custo de emitir milhares de retângulos no contexto 2D aparece. Medir a
   * reconstrução do plano mediria outra coisa: ela roda uma vez por invalidação,
   * enquanto a passada pode acontecer mais de uma vez para a mesma invalidação.
   *
   * ⚠️ A duração é reportada **depois** de a passada concluir. Uma passada que
   * lançar não produz amostra — o que é o certo: o tempo até o ponto da exceção
   * não descreve o custo de desenhar, e alimentar a mediana com ele reduziria o
   * orçamento por um motivo que não é lentidão. É também por isso que o `catch`
   * sai por `return` em vez de cair no reporte comum.
   *
   * ── A CONTENÇÃO (requisito 10.5) ──────────────────────────────────────────
   *
   * Exceção que escape daqui entra no ciclo de render da biblioteca e congela o
   * gráfico inteiro. Este bloco é o que impede isso, e é a razão de `paint`
   * existir como método separado: o corpo da passada fica isolado numa chamada
   * só, cercável sem reescrever o laço.
   *
   * ⚠️ **O tratamento também é cercado.** `reportFailure` pede um quadro novo à
   * biblioteca, e essa chamada é código de terceiro que pode lançar por sua vez —
   * chegando ao gráfico exatamente pela porta que este bloco fecha. O `catch`
   * interno engole por decisão: nesse ponto a camada já se marcou desativada, e
   * não há mais nada a relatar que valha o gráfico.
   *
   * Sobre o estado do contexto 2D depois de uma exceção: a entrada em espaço de
   * bitmap da biblioteca de canvas equilibra o próprio par salvar/restaurar num
   * bloco de encerramento, e cada renderizador seguinte reinstala a
   * transformação ao entrar — logo uma passada interrompida não desloca a
   * geometria de quem desenha depois.
   */
  draw(target: CanvasRenderingTarget2D): void {
    const inicioMs = this.clock();
    try {
      this.paint(target);
    } catch (erro) {
      try {
        this.reportFailure(erro);
      } catch {
        // Engolido de propósito — ver o bloco acima.
      }
      return;
    }
    this.reportPass(this.clock() - inicioMs);
  }

  /**
   * O corpo da passada.
   *
   * Ordem fixa, e a ordem é requisito, não estilo: fila de compra, fila de
   * venda, marcas de execução, contornos, hachura, texto. As duas primeiras
   * atendem o critério 1.9 (o mesmo par com os dois lados produz duas células em
   * passadas distintas, sempre na mesma ordem); a terceira atende o 1.4 (a marca
   * é desenhada **depois** do retângulo que a contém).
   */
  private paint(target: CanvasRenderingTarget2D): void {
    const plan = this.plan;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;

      // ── 1 e 2: retângulos de fila, em lote por bucket ──
      //
      // Sem `stroke`: 3.000 contornos custariam mais que os 3.000 preenchimentos,
      // e o único contorno que a camada desenha é o do estouro de escala, abaixo.
      //
      // ⭐ SUAVIZAÇÃO — só no modo TÉRMICA, e por isso o `save`/`restore`.
      //
      // O balde é de 60 s, então cada célula é um minuto achatado e as bordas
      // retas fazem o heatmap ser lido como bloco — foi a palavra do operador
      // ("lego") e é o que o distancia do bookmap comercial, que trabalha em 1 s.
      // Um desfoque de sub-pixel dissolve a borda sem apagar a estrutura.
      //
      // ⚠️ Acompanha o modo de propósito: o modo `LADO` fica byte-idêntico ao que
      // sempre foi, e quem escolhe a térmica recebe o pacote completo. Assim a
      // suavização não é uma terceira opção para o operador administrar.
      //
      // ⚠️ `ctx.filter` não é universal. Onde não existe, a atribuição é ignorada
      // em silêncio e o desenho sai sem desfoque — degradação correta, porque a
      // suavização é acabamento e não informação. E o `try` existe porque em
      // ambiente de teste o contexto falso pode não ter a propriedade.
      const suavizar = plan.suavizar;
      if (suavizar) {
        ctx.save();
        try {
          (ctx as unknown as { filter: string }).filter = `blur(${(0.8 * hpr).toFixed(2)}px)`;
        } catch {
          /* sem filtro: desenha nítido, que é o comportamento anterior */
        }
      }
      this.fillBuckets(ctx, plan.bid, plan.paletteBid, hpr, vpr);
      this.fillBuckets(ctx, plan.ask, plan.paletteAsk, hpr, vpr);
      if (suavizar) ctx.restore();

      // ── 3: execução, sempre DEPOIS dos retângulos de fila ──
      //
      // As duas formas são exclusivas por construção (`buildCells` alimenta uma
      // ou outra), então chamar as duas não sobrepõe nada: a lista da forma não
      // escolhida está vazia.
      this.fillExecMarks(ctx, plan, hpr, vpr);
      this.fillExecBubbles(ctx, plan, hpr, vpr);

      // ── 4: contorno do que estourou o teto da escala ──
      this.strokeOutlines(ctx, plan.outlines, hpr, vpr);

      // ── 5: hachura de cobertura ausente ──
      this.fillHatch(ctx, plan.hatch, scope.bitmapSize.height, hpr, vpr);

      // ── 6: legenda e rodapé, cada um em caixa opaca ──
      // A supressão acontece no PLANO (listas vazias), não aqui: o renderizador
      // não decide nada por contrato. Ver `mostrarLegenda` e `mostrarDiagnostico`
      // — é em `buildLegend` que se decide o que cada canal escreve.
      this.drawText(ctx, plan, scope.bitmapSize.width, scope.bitmapSize.height, hpr, vpr);
    });
  }

  private fillBuckets(
    ctx: CanvasRenderingContext2D,
    byBucket: readonly DrawCell[][],
    palette: readonly string[],
    hpr: number,
    vpr: number,
  ): void {
    for (let b = 0; b < BUCKETS; b++) {
      const cells = byBucket[b];
      if (cells === undefined || cells.length === 0) continue;
      const style = palette[b];
      if (style === undefined) continue;
      ctx.fillStyle = style;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c === undefined) continue;
        ctx.fillRect(c.x * hpr, c.y * vpr, c.w * hpr, c.h * vpr);
      }
    }
  }

  /**
   * A marca de execução: barra estreita centrada na célula.
   *
   * A largura sai de `floor(w / 3)` com piso de 1 px, então a marca **nunca**
   * excede a célula que a contém, inclusive quando a célula tem 1 px de largura
   * — nesse caso marca e célula coincidem, que é o mais próximo de "contida" que
   * uma célula de um pixel admite.
   */
  private fillExecMarks(
    ctx: CanvasRenderingContext2D,
    plan: DrawPlan,
    hpr: number,
    vpr: number,
  ): void {
    for (let b = 0; b < BUCKETS; b++) {
      const cells = plan.exec[b];
      if (cells === undefined || cells.length === 0) continue;
      const style = plan.paletteExec[b];
      if (style === undefined) continue;
      ctx.fillStyle = style;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c === undefined) continue;
        const larguraMarca = Math.max(1, Math.floor(c.w / EXEC_MARK_DIVISOR));
        const offset = Math.floor((c.w - larguraMarca) / 2);
        ctx.fillRect((c.x + offset) * hpr, c.y * vpr, larguraMarca * hpr, c.h * vpr);
      }
    }
  }

  /**
   * As bolhas de execução: raio = volume, cor = agressor.
   *
   * ⚠️ O raio é escalado pela MENOR razão de pixel dos dois eixos
   * (`min(hpr, vpr)`). Escalar por uma só deformaria a bolha em elipse em tela
   * com razões diferentes por eixo — e uma "bolha" achatada deixa de comunicar
   * área, que é justamente o que ela codifica.
   *
   * O contorno escuro não é enfeite: sem ele, duas bolhas encostadas do mesmo
   * lado viram uma mancha só, e o operador perde a contagem de eventos.
   *
   * ⚠️ **RECORTADA à área de plotagem** desde 04/09/2026 — ver
   * `DrawPlan.larguraPainelPx` para o defeito que isto conserta. O recorte é
   * aplicado só aqui, e não na passada inteira, porque as bolhas são a única
   * forma cujo tamanho não deriva da célula recortada: retângulos de fila, marca
   * interna e contorno de estouro já saem de `cellToPixels`, que garante
   * `x + w <= widthPx`. Recortar tudo esconderia esse invariante em vez de
   * confiar nele.
   */
  private fillExecBubbles(
    ctx: CanvasRenderingContext2D,
    plan: DrawPlan,
    hpr: number,
    vpr: number,
  ): void {
    const bolhas = plan.bolhas;
    if (bolhas.length === 0) return;

    const escalaRaio = Math.min(hpr, vpr);

    // Geometria ausente ou degenerada ⇒ desenha sem recortar, como antes. É o
    // caminho de quem monta o plano à mão (bancadas), e recortar contra zero
    // apagaria a passada inteira em silêncio — pior que não recortar.
    const larguraPainel = plan.larguraPainelPx;
    const alturaPainel = plan.alturaPainelPx;
    const recorta =
      Number.isFinite(larguraPainel) && larguraPainel > 0 &&
      Number.isFinite(alturaPainel) && alturaPainel > 0;

    if (!recorta) {
      this.emitirBolhas(ctx, plan, bolhas, escalaRaio, hpr, vpr);
      return;
    }

    // ⚠️ `try/finally` e não save/restore em sequência. Exceção no meio do laço
    // deixaria o recorte EM VIGOR: o `restore` externo de
    // `useBitmapCoordinateSpace` popparia este nível em vez do dele, e todo o
    // resto do gráfico passaria a desenhar recortado e com a transformação
    // deslocada. Há teste que exige o par fechado com a passada interrompida.
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(0, 0, larguraPainel * hpr, alturaPainel * vpr);
      ctx.clip();
      this.emitirBolhas(ctx, plan, bolhas, escalaRaio, hpr, vpr);
    } finally {
      ctx.restore();
    }
  }

  /** O laço de emissão, extraído para o recorte ser opcional sem duplicá-lo. */
  private emitirBolhas(
    ctx: CanvasRenderingContext2D,
    plan: DrawPlan,
    bolhas: readonly BolhaExec[],
    escalaRaio: number,
    hpr: number,
    vpr: number,
  ): void {
    ctx.strokeStyle = BOLHA_CONTORNO;
    ctx.lineWidth = Math.max(1, escalaRaio);

    for (let i = 0; i < bolhas.length; i++) {
      const b = bolhas[i];
      if (b === undefined) continue;
      const paleta = b.side === 'BID' ? plan.paletteBolhaBid : plan.paletteBolhaAsk;
      const style = paleta[b.bucket];
      if (style === undefined) continue;

      const r = b.raio * escalaRaio;
      if (!(r > 0) || !Number.isFinite(r)) continue;

      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(b.cx * hpr, b.cy * vpr, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private strokeOutlines(
    ctx: CanvasRenderingContext2D,
    cells: readonly DrawCell[],
    hpr: number,
    vpr: number,
  ): void {
    if (cells.length === 0) return;
    ctx.strokeStyle = OUTLINE_STYLE;
    ctx.lineWidth = OUTLINE_PX * Math.min(hpr, vpr);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c === undefined) continue;
      ctx.strokeRect(c.x * hpr, c.y * vpr, c.w * hpr, c.h * vpr);
    }
  }

  /**
   * Hachura diagonal âmbar sobre o trecho do dia sem execução capturada.
   *
   * Recorte por `clip` em vez de aritmética por linha: a faixa é vertical e
   * cheia, então cada linha diagonal precisaria de dois cortes calculados à mão,
   * e errar um deles vazaria tinta para fora da faixa — sobre células que têm
   * cobertura, invertendo a leitura.
   */
  private fillHatch(
    ctx: CanvasRenderingContext2D,
    bands: readonly HatchBand[],
    bitmapHeight: number,
    hpr: number,
    vpr: number,
  ): void {
    if (bands.length === 0) return;

    const step = HATCH_STEP_PX * hpr;
    ctx.save();
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (band === undefined) continue;
      const x = band.x * hpr;
      const w = band.w * hpr;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, bitmapHeight);
      ctx.clip();

      // Fundo tênue: marca a faixa mesmo onde as diagonais não passam.
      ctx.fillStyle = `rgba(${CANAL_AMBAR}, 0.07)`;
      ctx.fillRect(x, 0, w, bitmapHeight);

      ctx.strokeStyle = `rgba(${CANAL_AMBAR}, 0.38)`;
      ctx.lineWidth = Math.max(1, Math.round(vpr));
      ctx.beginPath();
      // Diagonais a 45°: começam à esquerda da faixa o suficiente para que a
      // primeira já entre nela com inclinação, sem canto vazio.
      for (let d = x - bitmapHeight; d < x + w; d += step) {
        ctx.moveTo(d, bitmapHeight);
        ctx.lineTo(d + bitmapHeight, 0);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Legenda no canto superior esquerdo e rodapé de cobertura no inferior, cada
   * um dentro de uma caixa opaca.
   *
   * O texto continua sendo desenhado duas vezes, deslocado de um pixel: o gráfico
   * tem fundo variável e a camada é semitransparente. ⭐ **Mas a sombra sozinha
   * não bastava** — sobre a mancha de calor saturada ou sobre o corpo de uma vela
   * clara o texto seguia ilegível, e foi o que o usuário fotografou no playground
   * em 04/09/2026. A caixa de `TEXT_BOX_STYLE` dá fundo próprio ao texto, e a
   * sombra passa a ser o acabamento que ela era para ser.
   *
   * ⚠️ A caixa é desenhada por CAMINHO (`beginPath`/`rect`/`fill`), nunca por
   * `fillRect` nem `strokeRect`. Não é estilo: as bancadas herdadas contam
   * `fillRect` como "célula desenhada" e `strokeRect` como "contorno de estouro
   * de escala", e afirmam **zero** dos dois no estado autodesativado — que é
   * justamente um estado que desenha texto. Uma caixa por `fillRect` faria a
   * caixa ser contada como célula e quebraria a asserção sem que nada estivesse
   * errado na camada.
   */
  private drawText(
    ctx: CanvasRenderingContext2D,
    plan: DrawPlan,
    bitmapWidth: number,
    bitmapHeight: number,
    hpr: number,
    vpr: number,
  ): void {
    if (plan.legend.length === 0 && plan.footer === null) return;

    const fontPx = Math.max(9, Math.round(FONT_PX * vpr));
    ctx.font = `${fontPx}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const margemX = TEXT_MARGIN_PX * hpr;
    const margemY = TEXT_MARGIN_PX * vpr;
    const linha = TEXT_LINE_PX * vpr;
    const padX = TEXT_BOX_PAD_PX * hpr;
    const padY = TEXT_BOX_PAD_PX * vpr;

    // Painel de largura degenerada: nem caixa nem texto. A guarda já existia
    // para o rodapé; agora vale para os dois blocos, porque uma caixa mais larga
    // que o painel cobriria a escala de preço.
    const cabeTexto = bitmapWidth > margemX + padX;

    // Âmbar quando a legenda carrega o aviso de autodesativação: com a cor
    // neutra, o aviso do requisito 10.6 seria lido como mais uma linha de
    // legenda, que é a forma prática de ele não ser lido.
    const estiloLegenda = plan.legendAlerta ? TEXT_AMBAR_STYLE : TEXT_STYLE;

    if (plan.legend.length > 0 && cabeTexto) {
      let larguraMax = 0;
      for (const texto of plan.legend) {
        if (texto === undefined) continue;
        const w = larguraDoTexto(ctx, texto, fontPx);
        if (w > larguraMax) larguraMax = w;
      }
      desenharCaixaDeTexto(
        ctx,
        margemX - padX,
        margemY - padY,
        larguraMax + 2 * padX,
        plan.legend.length * linha + 2 * padY,
        bitmapWidth,
        bitmapHeight,
      );

      let y = margemY;
      for (let i = 0; i < plan.legend.length; i++) {
        const texto = plan.legend[i];
        if (texto === undefined) continue;
        ctx.fillStyle = TEXT_SHADOW_STYLE;
        ctx.fillText(texto, margemX + 1, y + 1);
        ctx.fillStyle = estiloLegenda;
        ctx.fillText(texto, margemX, y);
        y += linha;
      }
    }

    if (plan.footer !== null && cabeTexto) {
      ctx.textBaseline = 'bottom';
      const yBase = bitmapHeight - margemY;
      desenharCaixaDeTexto(
        ctx,
        margemX - padX,
        yBase - fontPx - padY,
        larguraDoTexto(ctx, plan.footer, fontPx) + 2 * padX,
        fontPx + 2 * padY,
        bitmapWidth,
        bitmapHeight,
      );
      ctx.fillStyle = TEXT_SHADOW_STYLE;
      ctx.fillText(plan.footer, margemX + 1, yBase + 1);
      ctx.fillStyle = plan.footerAlerta ? TEXT_AMBAR_STYLE : TEXT_STYLE;
      ctx.fillText(plan.footer, margemX, yBase);
    }
  }

}

// ═════════════════════════════════════════════════════════════════════════════
// A view do painel
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A view que posiciona a camada no fundo da pilha visual.
 *
 * `zOrder(): 'bottom'` é o que põe a camada **antes** da série de velas na mesma
 * passada (requisito 1.2). Não é convenção de empilhamento de CSS: as formas são
 * emitidas no canvas do gráfico antes das velas, então nenhum pixel de corpo, de
 * sombra ou de borda de vela é coberto — e a camada não entra na disputa de
 * ordem das camadas de sobreposição existentes.
 */
class BookmapPaneView implements IPrimitivePaneView {
  constructor(
    private readonly renderer_: BookmapRenderer,
    private readonly hasContent: () => boolean,
  ) {}

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.hasContent() ? this.renderer_ : null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// O primitive
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A camada de bookmap.
 *
 * ⚠️ **NÃO implementa `hitTest`** — ver o cabeçalho do arquivo. A ausência é o
 * mecanismo, e há teste estrutural que falha se o método aparecer.
 *
 * ── DE ONDE VEM CADA RECÁLCULO ────────────────────────────────────────────
 *
 * O requisito 2.8 pede três comportamentos distintos para a escala de cor, e a
 * distinção entre eles é a **origem** da mudança, não a leitura de um evento de
 * ponteiro (que esta camada não tem, por construção):
 *
 * | origem | como chega | escala |
 * |---|---|---|
 * | movimento do gráfico | `updateAllViews()` com janela diferente | congelada, recálculo agendado em 120 ms |
 * | repouso após o movimento | o próprio temporizador | recalculada |
 * | dado novo ou troca de grandeza | `update()` | recalculada na passada seguinte |
 *
 * Deduzir a origem assim é mais forte do que observar o ponteiro: um recálculo
 * disparado por dado novo continua imediato mesmo se o operador estiver com o
 * botão pressionado, e o congelamento continua valendo para movimento por roda,
 * por toque ou por interação de teclado, que não passariam por um manipulador de
 * arrasto.
 */
export class BookmapPrimitive implements ISeriesPrimitive<Time> {
  private options: BookmapLayerOptions;

  /**
   * Orçamento corrente de células.
   *
   * Mutável de propósito: a degradação adaptativa reduz este valor à metade —
   * com piso de 500 — quando a mediana das passadas recentes estoura o alvo.
   * Nada neste arquivo presume que ele seja constante.
   */
  private budget: { maxCells: number; minCellPx: number };

  /**
   * A leitura de relógio usada para medir a passada.
   *
   * ⚠️ **Este é o ponto de injeção.** A degradação depende de tempo medido, que é
   * inerentemente não determinístico; recebê-la pelo construtor permite que o
   * teste faça a mediana estourar o alvo por decisão própria, em vez de depender
   * da velocidade da máquina. Sem isso, um teste da degradação passaria numa
   * máquina e falharia noutra, e um teste instável é pior que nenhum.
   *
   * Ausente, adota o relógio de alta resolução do ambiente.
   */
  private readonly clock: () => number;

  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private readonly plan = new DrawPlan();
  private readonly view: BookmapPaneView;
  private readonly views: readonly IPrimitivePaneView[];

  /** Escala da fila, compartilhada pelos dois lados (requisito 2.9). */
  private scaleFila: ColorScale | null = null;

  /** Escala da execução — amostra própria, nunca reunida com a da fila. */
  private scaleExec: ColorScale | null = null;

  /** As escalas precisam ser recalculadas antes da próxima passada. */
  private scalesDirty = true;

  /**
   * O plano de células está velho e precisa ser reconstruído.
   *
   * Existe porque a redução do orçamento invalida o cache: o plano corrente foi
   * agregado com o teto anterior, e continuar a desenhá-lo manteria justamente a
   * quantidade de células que a degradação acabou de recusar. `paneViews` honra a
   * marca, então a reconstrução acontece mesmo que a biblioteca chame a passada
   * de desenho sem passar antes por `updateAllViews`.
   *
   * ⚠️ Marcar em vez de esvaziar o plano na hora é deliberado: esvaziá-lo dentro
   * da passada deixaria a camada sumir por um quadro se a biblioteca desenhasse
   * outra vez antes de reconstruir. O plano velho continua desenhável até o novo
   * existir.
   */
  private cellsDirty = false;

  /** Assinatura da última janela vista, para detectar movimento do gráfico. */
  private lastWindowKey: string | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Limites de opacidade da última paleta de fila construída. */
  private paletteKeyBase: string | null = null;

  /** Limites de opacidade da última paleta de execução construída. */
  private paletteKeyExec: string | null = null;

  /**
   * A camada foi desanexada.
   *
   * Enquanto verdadeiro, `renderer()` devolve `null` e nenhuma passada acontece
   * (requisito 10.3) — mesmo que a biblioteca ainda tenha uma referência viva
   * no quadro em curso.
   */
  private detachedFlag = false;

  /**
   * A camada se autodesativou por exceção na passada de desenho (requisito 10.5).
   *
   * Enquanto verdadeiro, o plano é reduzido ao aviso e **nenhuma célula é
   * desenhada** (requisito 10.6). Não é o mesmo que `detachedFlag`: desanexada, a
   * camada não desenha nada; autodesativada, ela ainda desenha o texto que
   * explica ao operador por que as células desapareceram.
   *
   * ⚠️ Estado de instância, e não de módulo: uma camada que falhou não diz nada
   * sobre a próxima anexação — o gráfico remonta a cada troca de timeframe, e
   * herdar a desativação condenaria a camada até o recarregamento da página.
   */
  private selfDisabled = false;

  /**
   * O aviso de autodesativação está em exibição.
   *
   * Invariante: `selfDisabled` verdadeiro implica isto verdadeiro. A recíproca
   * **não** vale, e é justamente aí que está o requisito 10.7 — entre a
   * reabilitação e a primeira passada sem exceção, a camada volta a desenhar
   * (`selfDisabled` falso) com o aviso ainda na tela, porque nada ainda provou
   * que a falha passou.
   */
  private selfDisabledNotice = false;

  /**
   * Durações das passadas recentes, em milissegundos.
   *
   * Anel de tamanho fixo, e não lista que cresce: a janela é das 30 passadas
   * **mais recentes**, então acumular além disso guardaria amostra que o
   * requisito manda descartar — e, num arrasto longo, guardaria milhares delas.
   * A escrita circular descarta a mais antiga sem mover nada de lugar.
   */
  private readonly passSamples = new Float64Array(DRAW_SAMPLE_WINDOW);

  /** Próxima posição de escrita no anel. */
  private passWriteAt = 0;

  /** Amostras já gravadas, saturando em `DRAW_SAMPLE_WINDOW`. */
  private passCount = 0;

  /**
   * Cópia ordenável, reusada entre avaliações.
   *
   * A mediana precisa da amostra ordenada, e ordenar o anel destruiria a ordem
   * de chegada — que é o que diz qual amostra é a mais antiga. Reusar o mesmo
   * bloco evita alocar 30 posições por avaliação dentro do quadro de desenho.
   */
  private readonly passScratch = new Float64Array(DRAW_SAMPLE_WINDOW);

  constructor(options: BookmapLayerOptions, clock?: () => number) {
    this.options = { ...options };
    this.budget = {
      maxCells: options.maxCells,
      minCellPx: options.minCellPx,
    };
    this.clock = clock ?? readHighResolutionClock;
    const renderer = new BookmapRenderer(
      this.plan,
      // Fechamento em vez do valor: mantém a leitura ligada à instância e não
      // duplica a decisão de qual relógio vale.
      () => this.clock(),
      (elapsedMs) => this.onPassCompleted(elapsedMs),
      (erro) => this.onPaintFailure(erro),
    );
    this.view = new BookmapPaneView(renderer, () => this.hasContent());
    // Sempre o MESMO array: a biblioteca mantém cache interno por referência e
    // devolver um array novo por chamada invalidaria esse cache a cada quadro.
    this.views = [this.view];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ciclo de vida
  // ───────────────────────────────────────────────────────────────────────────

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.detachedFlag = false;
    // Requisito 10.7: anexar é um dos dois caminhos de retomada. A anexação é a
    // gêmea do caminho por opção nova, e vale para o caso do requisito 10.8 — a
    // série recriada sem desmontar o componente, que reanexa esta mesma
    // instância.
    //
    // ⚠️ O **aviso** não é limpo aqui, de propósito: ele sai por evidência de
    // passada limpa, não por intenção de reanexar.
    this.selfDisabled = false;
    // Anexar não conhece a janela ainda; a primeira reconstrução acontece na
    // chamada de `updateAllViews` que a biblioteca faz antes de desenhar.
    this.scalesDirty = true;
    this.lastWindowKey = null;
    // Amostras da anexação anterior descrevem outro gráfico e outro viewport.
    // Mantê-las poderia reduzir o orçamento na primeira passada da nova
    // anexação, por conta de um custo que não é o desta.
    //
    // ⚠️ O **orçamento** não é reiniciado aqui, e é uma escolha: a lentidão que
    // levou à redução é da máquina, não da instância do gráfico, e o gráfico
    // remonta a cada troca de timeframe. Só opção nova o reinicia.
    this.resetPassSamples();
  }

  /**
   * Solta tudo o que foi guardado e cancela o temporizador pendente.
   *
   * O gráfico remonta a cada troca de timeframe. Um temporizador sobrevivente
   * chamaria `requestUpdate` de um gráfico já destruído, e um plano sobrevivente
   * manteria vivas as 48 listas de células — que é como uma camada desanexada
   * continua custando memória sem desenhar nada.
   */
  detached(): void {
    this.cancelScaleRecompute();
    this.detachedFlag = true;
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.scaleFila = null;
    this.scaleExec = null;
    this.lastWindowKey = null;
    this.paletteKeyBase = null;
    this.paletteKeyExec = null;
    this.cellsDirty = false;
    this.resetPassSamples();
    this.plan.reset();
    this.plan.clearPalettes();
  }

  /**
   * Recebe dado ou opção nova, sem reanexar.
   *
   * Mudança que chega por aqui **não** é movimento de gráfico, então a escala é
   * recalculada na passada seguinte em vez de esperar o repouso de 120 ms
   * (requisito 2.8, terceira cláusula). Um recálculo já agendado é cancelado:
   * ele recalcularia sobre um dado que acabou de ser substituído.
   *
   * ⚠️ Nuance declarada: se dado novo chegar **no meio** de um movimento, a
   * passada seguinte recalcula a escala em vez de mantê-la congelada. É o lado
   * seguro do compromisso — a escala fica correta para o dado que está na tela —
   * e afeta uma única passada, porque o movimento seguinte volta a congelar.
   */
  update(options: Partial<BookmapLayerOptions>): void {
    const gridAnterior = this.options.grid;
    this.options = { ...this.options, ...options };

    // ── retomada depois de uma autodesativação (requisito 10.7) ──
    //
    // O grid voltando de ausente a presente **é** o desligar-e-religar da chave:
    // desligada, a página entrega grid ausente; religada, entrega o grid de novo.
    //
    // ⚠️ A condição é a transição, não a mera presença de grid. Este método
    // também recebe dado novo a cada reconsulta, com grid presente nas duas
    // pontas; retomar ali reabilitaria a camada sozinha a cada minuto, e o
    // requisito 10.6 pede que a desativação **permaneça** até o operador agir.
    if (gridAnterior === null && this.options.grid !== null) {
      this.selfDisabled = false;
      // O plano em vigor é o do aviso, sem células: precisa ser refeito para a
      // camada voltar a desenhar.
      this.cellsDirty = true;
    }

    if (options.maxCells !== undefined || options.minCellPx !== undefined) {
      // Orçamento vindo de fora reinicia o corrente. A degradação parte deste
      // valor, e não de um resíduo da configuração anterior.
      this.budget = {
        maxCells: this.options.maxCells,
        minCellPx: this.options.minCellPx,
      };
      // E a janela de medições é resíduo da mesma natureza: amostras colhidas
      // sob o orçamento anterior reduziriam o novo já na trigésima passada, sem
      // que ele tivesse sido medido uma única vez.
      this.resetPassSamples();
    }

    this.cancelScaleRecompute();
    this.scalesDirty = true;
    this.requestUpdate?.();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recálculo
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reconstrói o plano de desenho.
   *
   * ⚠️ **É aqui que o cache de células vive, não em `draw`** (requisito 9.8). A
   * biblioteca pode chamar a passada de desenho mais de uma vez por invalidação
   * — ao redesenhar o painel de preço, por exemplo —, e recalcular agregação e
   * percentis em cada uma delas multiplicaria o custo do quadro sem mudar um
   * pixel.
   */
  updateAllViews(): void {
    this.rebuild();
  }

  /**
   * Devolve o array de views.
   *
   * ⚠️ Também garante que o plano esteja construído. É rede de segurança, não o
   * lugar do cálculo: se a biblioteca desenhar sem ter chamado `updateAllViews`,
   * a alternativa seria uma passada em branco — e uma camada que às vezes não
   * aparece é pior que uma que custa uma reconstrução extra. O trabalho continua
   * em `rebuild`, chamado por `updateAllViews`, e **nunca** dentro de `draw`.
   *
   * A marca `cellsDirty` entra na condição pelo mesmo motivo: depois de o
   * orçamento cair, o plano corrente descreve o teto antigo, e a reconstrução
   * precisa acontecer mesmo que a biblioteca vá direto à passada de desenho.
   */
  paneViews(): readonly IPrimitivePaneView[] {
    const precisaReconstruir = this.cellsDirty || this.plan.vazio;
    if (precisaReconstruir && this.options.grid !== null && !this.detachedFlag) {
      this.rebuild();
    }
    return this.views;
  }

  /**
   * Há algo a desenhar?
   *
   * ⚠️ Autodesativada, a resposta é **sim**: o plano tem o aviso, e é por esta
   * porta que ele chega à tela. A desativação zera as células, não a passada — a
   * passada que não acontece é a da camada desanexada e a da camada desligada.
   */
  private hasContent(): boolean {
    if (this.detachedFlag) return false;
    // Grid ausente é o caminho de desligar sem desanexar: sem renderizador, a
    // biblioteca não chama a passada de desenho. Vale inclusive para a camada
    // autodesativada — desligada, não há o que avisar.
    if (this.options.grid === null) return false;
    return !this.plan.vazio;
  }

  private cancelScaleRecompute(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Agenda o recálculo da escala para 120 ms de repouso.
   *
   * Cada movimento reagenda, então a escala só é refeita quando o gráfico para.
   * Recalcular por quadro faria a cor tremular durante o arrasto — o operador
   * veria a mesma parede mudando de intensidade enquanto arrasta, o que é
   * exatamente a leitura falsa que a escala por percentil existe para evitar.
   */
  private scheduleScaleRecompute(): void {
    this.cancelScaleRecompute();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.detachedFlag) return;
      this.scalesDirty = true;
      this.requestUpdate?.();
    }, SCALE_DEBOUNCE_MS);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Degradação adaptativa do orçamento (requisitos 9.9 e 9.10)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * O orçamento já está no piso?
   *
   * Derivado do próprio orçamento, sem campo separado: um sinalizador de "no
   * piso" seria resíduo a limpar em `update`, e resíduo de orçamento é
   * exatamente o problema que aquele método já evita.
   *
   * `!(x > piso)` cobre o valor igual ao piso, o valor abaixo dele e o valor não
   * numérico numa comparação só — nenhuma comparação com `NaN` é verdadeira.
   * Orçamento não numérico contar como "no piso" é a direção segura: sem número
   * utilizável não há como reduzir de forma responsável, e o núcleo já adota o
   * padrão dele nesse caso.
   *
   * ⚠️ Orçamento configurado **abaixo** de 500 também conta como no piso, e não
   * é elevado: o piso limita a redução, não o que a página configurou.
   */
  private isBudgetAtFloor(): boolean {
    return !(this.budget.maxCells > BUDGET_FLOOR_CELLS);
  }

  /** Esvazia a janela de medições sem tocar no orçamento. */
  private resetPassSamples(): void {
    this.passWriteAt = 0;
    this.passCount = 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Autodesativação por exceção (requisitos 10.5, 10.6 e 10.7)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Uma passada concluiu **sem** exceção.
   *
   * Duas consequências independentes, nesta ordem: o aviso pode sair, porque
   * agora existe evidência; e a duração entra na amostra da degradação.
   *
   * A ordem importa pouco — as duas são de uma vez só —, mas a remoção do aviso
   * vem primeiro porque é a consequência direta do fato observado, enquanto a
   * medição é um efeito colateral de outra funcionalidade.
   */
  private onPassCompleted(elapsedMs: number): void {
    this.clearSelfDisabledNotice();
    this.recordDrawPass(elapsedMs);
  }

  /**
   * Remove o aviso, se houver, quando a evidência autoriza (requisito 10.7).
   *
   * ⚠️ **A guarda de `selfDisabled` é o ponto todo desta função.** Autodesativada,
   * o plano em vigor tem apenas o aviso: a passada seguinte desenha texto,
   * conclui sem exceção e — sem esta guarda — apagaria o próprio aviso no quadro
   * imediatamente seguinte à falha, contra o requisito 10.6, que manda exibi-lo
   * **enquanto** a desativação durar. Desenhar texto não é evidência de que o
   * caminho que falhou voltou a funcionar; só uma passada do plano completo é.
   */
  private clearSelfDisabledNotice(): void {
    if (this.detachedFlag) return;
    if (this.selfDisabled) return;
    if (!this.selfDisabledNotice) return;

    this.selfDisabledNotice = false;
    // A legenda em vigor ainda tem o aviso: refazer o plano é o que o remove.
    this.cellsDirty = true;
    this.requestUpdate?.();
  }

  /**
   * Uma passada lançou. Desativa a camada e explica ao operador.
   *
   * ── ORDEM DAS OPERAÇÕES, E ELA É DELIBERADA ───────────────────────────────
   *
   * As marcações de estado vêm primeiro porque não podem falhar. Só depois vêm as
   * duas operações que dependem de terceiro — pedir quadro à biblioteca e
   * escrever no log. Assim, mesmo que uma delas lance, a camada já está desativada
   * e a garantia central do requisito 10.5 está cumprida.
   *
   * ── POR QUE PEDIR UM QUADRO DE DENTRO DO TRATAMENTO É LIMITADO ────────────
   *
   * `requestUpdate` durante o ciclo de desenho pede outra passada, e outra passada
   * poderia lançar de novo — o desenho de um laço infinito. Não é o caso: o pedido
   * acontece **só na transição**, e a segunda entrada aqui encontra `selfDisabled`
   * já verdadeiro e sai sem pedir nada. O custo máximo é um quadro extra por
   * autodesativação.
   *
   * Sem o pedido, o aviso só apareceria na próxima invalidação vinda de fora — o
   * operador ficaria olhando a camada sumida sem explicação até mover o gráfico.
   */
  private onPaintFailure(erro: unknown): void {
    // Requisito 10.3: desanexada, a camada não reage a passada nenhuma — nem à
    // que a biblioteca ainda tenha em curso no quadro.
    if (this.detachedFlag) return;

    const primeira = !this.selfDisabled;

    // Requisito 10.5: a primeira exceção já desativa. Nada de contar falhas —
    // tolerar a segunda apostaria o gráfico inteiro para talvez preservar uma
    // camada de contexto.
    this.selfDisabled = true;
    this.selfDisabledNotice = true;

    // Segunda exceção dentro da mesma desativação: já não há o que refazer, e
    // pedir quadro por exceção repetida é que criaria laço.
    if (!primeira) return;

    // O plano em vigor descreve células. Autodesativada, a camada mantém em zero
    // a quantidade de células desenhadas (requisito 10.6), então o plano precisa
    // ser refeito como aviso puro.
    this.cellsDirty = true;

    // Amostras da passada que falhou não descrevem custo de desenho.
    this.resetPassSamples();

    this.requestUpdate?.();

    if (!selfDisableLogged) {
      selfDisableLogged = true;
      console.warn(
        '[bookmap] A passada de desenho da camada de livro lançou exceção e a ' +
          `camada foi desativada (motivo: ${describeError(erro)}). O restante do ` +
          'gráfico segue operante. Desligue e religue a chave do livro no painel ' +
          'de indicadores para tentar de novo.',
      );
    }
  }

  /**
   * Registra a duração de uma passada e decide se o orçamento cai.
   *
   * Chamado pelo renderizador ao fim de cada passada concluída.
   */
  private recordDrawPass(elapsedMs: number): void {
    // Requisito 10.3: desanexada, a camada não faz mais nada — inclusive não
    // aprende com uma passada que a biblioteca ainda tenha em curso no quadro.
    if (this.detachedFlag) return;

    // Requisito 9.10: no piso, sem novas reduções. Sair antes de medir também
    // dispensa a ordenação recorrente, que não mudaria decisão alguma.
    if (this.isBudgetAtFloor()) return;

    // Duração negativa só sai de relógio que andou para trás; não numérica, de
    // relógio ausente. Nenhuma das duas descreve custo de desenho.
    if (!isFiniteNumber(elapsedMs) || elapsedMs < 0) return;

    this.passSamples[this.passWriteAt] = elapsedMs;
    this.passWriteAt = (this.passWriteAt + 1) % DRAW_SAMPLE_WINDOW;
    if (this.passCount < DRAW_SAMPLE_WINDOW) this.passCount += 1;

    // Janela incompleta: não existem "as 30 passadas mais recentes" ainda.
    if (this.passCount < DRAW_SAMPLE_WINDOW) return;
    if (this.medianOfRecentPasses() <= DRAW_TARGET_MS) return;

    this.degradeBudget();
  }

  /**
   * Mediana das 30 passadas mais recentes, em milissegundos.
   *
   * Amostra de tamanho par, então a mediana é a média das duas posições
   * centrais — a definição usual, e a que não privilegia arbitrariamente uma das
   * duas metades da amostra.
   *
   * ⚠️ Pressupõe a janela cheia; é o único caminho que a chama, e ele já
   * verificou. Com janela incompleta devolve zero, que nunca excede o alvo e
   * portanto nunca provoca redução por amostra insuficiente.
   *
   * A ordenação é a do próprio bloco tipado, que compara valores numericamente.
   * Ordenar como texto — o padrão de um vetor comum — colocaria 10 antes de 9 e
   * devolveria a mediana errada sem lançar nada.
   */
  private medianOfRecentPasses(): number {
    if (this.passCount < DRAW_SAMPLE_WINDOW) return 0;

    const scratch = this.passScratch;
    for (let i = 0; i < DRAW_SAMPLE_WINDOW; i += 1) {
      scratch[i] = this.passSamples[i] ?? 0;
    }
    scratch.sort();

    const meio = DRAW_SAMPLE_WINDOW >> 1;
    const inferior = scratch[meio - 1] ?? 0;
    const superior = scratch[meio] ?? 0;
    return (inferior + superior) / 2;
  }

  /**
   * Reduz o orçamento à metade, limitado ao piso.
   *
   * ── O QUE MUDA, E O QUE DELIBERADAMENTE NÃO MUDA ──────────────────────────
   *
   * Só `maxCells` é escrito. `minCellPx` fica intacto porque é o núcleo que o
   * dobra, tantas vezes quantas precisar, até o agrupamento caber no teto novo —
   * e é essa a mecânica que mantém **toda** a região da janela visível
   * representada, com resolução mais grossa em vez de recorte (requisito 9.9).
   * Nenhum grupo é descartado, nem aqui nem lá.
   *
   * A camada permanece habilitada em qualquer desfecho: nada neste método toca o
   * sinalizador de desanexação nem o grid.
   */
  private degradeBudget(): void {
    const atual = this.budget.maxCells;
    const alvo = Math.max(BUDGET_FLOOR_CELLS, Math.floor(atual / 2));

    // A redução nunca aumenta o orçamento. Sem este limite, um orçamento
    // configurado abaixo do piso seria elevado até ele — o piso passaria de
    // limite da redução a valor imposto, contra o que a página pediu.
    const novo = Math.min(atual, alvo);

    if (novo >= atual) {
      // Requisito 9.10: no piso, mantém o valor, sem nova redução. A passada
      // seguinte desenha as células deste orçamento normalmente.
      this.resetPassSamples();
      return;
    }

    this.budget = { maxCells: novo, minCellPx: this.budget.minCellPx };

    // O plano corrente foi agregado com o teto antigo: está velho por
    // construção, e a passada seguinte precisa reagregar.
    this.cellsDirty = true;

    // E as escalas também. Agrupamento mais grosso muda o valor das células —
    // fila combina por máximo, execução por soma —, logo muda os percentis.
    // Manter a escala anterior faria a legenda declarar `p50` e `p99` de uma
    // agregação que não está mais na tela.
    this.scalesDirty = true;

    // Amostras do orçamento anterior não descrevem o novo. Zerar é o que torna a
    // degradação adaptativa em vez de uma cascata: a redução seguinte, se vier,
    // exige 30 passadas medidas já com o teto reduzido.
    this.resetPassSamples();

    this.requestUpdate?.();

    if (!budgetDegradedLogged) {
      budgetDegradedLogged = true;
      console.info(
        `[bookmap] A mediana das ${DRAW_SAMPLE_WINDOW} passadas de desenho mais ` +
          `recentes excedeu ${DRAW_TARGET_MS} ms; o orçamento de células caiu de ` +
          `${atual} para ${novo} (piso de ${BUDGET_FLOOR_CELLS}). A janela visível ` +
          'segue inteiramente representada, com agrupamento mais grosso, e a ' +
          'camada permanece habilitada.',
      );
    }
  }

  /** Janela visível a partir das escalas reais do gráfico. */
  private readVisibleWindow(): VisibleWindow | null {
    const chart = this.chart;
    const series = this.series;
    const grid = this.options.grid;
    if (chart === null || series === null || grid === null) return null;

    const pane = chart.paneSize();
    const larguraPx = pane.width;
    const alturaPx = pane.height;
    if (!isFiniteNumber(larguraPx) || !isFiniteNumber(alturaPx)) return null;
    if (larguraPx <= 0 || alturaPx <= 0) return null;

    const range = chart.timeScale().getVisibleRange();
    if (range === null) return null;
    const from = range.from as unknown;
    const to = range.to as unknown;
    // A janela só é utilizável com tempo numérico. Escala horizontal de outro
    // tipo é caminho legítimo da biblioteca, e sair sem desenhar é melhor que
    // adivinhar um instante.
    if (!isFiniteNumber(from) || !isFiniteNumber(to)) return null;

    const tsDe = from * 1000;
    const tsAte = to * 1000;

    // Coordenada 0 é o topo do painel, logo o preço MAIOR. Trocar as duas
    // pontas produziria janela invertida, que a agregação descartaria — a camada
    // simplesmente não apareceria, sem erro.
    const precoTopo = series.coordinateToPrice(0);
    const precoBase = series.coordinateToPrice(alturaPx);
    if (!isFiniteNumber(precoTopo) || !isFiniteNumber(precoBase)) return null;

    const precoDe = Math.min(precoTopo, precoBase);
    const precoAte = Math.max(precoTopo, precoBase);

    const baldeMs = Math.max(1, grid.baldeSeg * 1000);
    const tick = isFiniteNumber(this.options.tickSize) && this.options.tickSize > 0
      ? this.options.tickSize
      : 1;

    return {
      tsDe,
      tsAte,
      precoDe,
      precoAte,
      larguraPx,
      alturaPx,
      baldesVisiveis: Math.max(0, Math.floor((tsAte - tsDe) / baldeMs) + 1),
      ticksVisiveis: Math.max(0, Math.floor((precoAte - precoDe) / tick) + 1),
    };
  }

  /** Funções de coordenada do próprio gráfico, embrulhadas e nunca refeitas. */
  private buildCoordinateFns(): CoordinateFns | null {
    const chart = this.chart;
    const series = this.series;
    if (chart === null || series === null) return null;

    const timeScale = chart.timeScale();
    return {
      priceToY: (price: number): number | null => {
        if (!Number.isFinite(price)) return null;
        const y = series.priceToCoordinate(price);
        return isFiniteNumber(y) ? y : null;
      },
      timeToX: (timeSec: number): number | null => {
        if (!Number.isFinite(timeSec)) return null;
        // A biblioteca tipa o instante pelo tipo da escala horizontal; aqui ele
        // é numérico em segundos, e é essa a unidade que o núcleo entrega.
        const x = timeScale.timeToCoordinate(timeSec as unknown as Time);
        return isFiniteNumber(x) ? x : null;
      },
    };
  }

  /**
   * O recálculo propriamente dito.
   *
   * Sequência: janela → agregação → escalas → células em pixel → cobertura →
   * legenda. A ordem importa porque a escala depende das células agregadas (é a
   * amostra da janela visível) e o pixel depende da escala (é dela que sai o
   * bucket de cor).
   */
  private rebuild(): void {
    const plan = this.plan;
    plan.reset();

    // A marca é consumida no início, não no fim. Uma saída antecipada abaixo
    // deixa o plano vazio, e `plan.vazio` já obriga a nova tentativa — manter a
    // marca ligada nesse caso apenas duplicaria a condição.
    this.cellsDirty = false;

    if (this.detachedFlag) return;

    // ── autodesativada: só o aviso, zero células (requisito 10.6) ──
    //
    // Antes de qualquer leitura de grid, de janela ou de coordenada: o plano de
    // uma camada desativada não depende de nada disso, e refazer aquele trabalho
    // reabriria justamente os caminhos que podem ter causado a falha.
    if (this.selfDisabled) {
      this.buildSelfDisabledNotice();
      return;
    }

    const grid = this.options.grid;
    if (grid === null) return;

    const window = this.readVisibleWindow();
    if (window === null) return;

    const coords = this.buildCoordinateFns();
    if (coords === null) return;

    // ── congelamento durante o movimento ──
    //
    // Janela diferente sem que nada de fora tenha mudado só pode ser movimento
    // do gráfico: mantém a escala corrente e agenda o recálculo para o repouso.
    const windowKey = this.windowKey(window);
    if (this.lastWindowKey === null || this.scaleFila === null) {
      // Primeira reconstrução: não há escala corrente para congelar.
      this.scalesDirty = true;
    } else if (windowKey !== this.lastWindowKey && !this.scalesDirty) {
      this.scheduleScaleRecompute();
    }
    this.lastWindowKey = windowKey;

    const outcome = aggregateForZoomWithOutcome(grid, window, this.budget);
    const cells = outcome.cells;

    // ── esgotamento de orçamento: uma vez por sessão (critério 3.5) ──
    //
    // O desfecho vem do núcleo em vez de ser inferido da saída vazia, porque
    // janela degenerada, janela sem célula e grid vazio produzem a mesma saída
    // vazia e são situações normais que não merecem registro.
    if (outcome.budgetExhausted && !budgetExhaustedLogged) {
      budgetExhaustedLogged = true;
      console.warn(
        '[bookmap] O agrupamento por zoom esgotou as repetições disponíveis e a ' +
          'camada não desenhou nesta janela. Reduza a faixa visível ou aumente o ' +
          `orçamento de células (atual: ${this.budget.maxCells}).`,
      );
    }

    const metrica = this.options.metrica;
    const gamma = this.options.escala === 'P99_LINEAR' ? 1 : undefined;
    const opts = gamma === undefined ? undefined : { gamma };

    // Uma escala por grandeza, compartilhada pelos dois lados; escalas
    // independentes para fila e para execução (requisito 2.9).
    if (this.scalesDirty || this.scaleFila === null || this.scaleExec === null) {
      this.scaleFila = computeColorScalePair(cells.bid, cells.ask, cells.count, opts);
      this.scaleExec = computeColorScalePair(cells.buy, cells.sell, cells.count, opts);
      this.scalesDirty = false;
    }
    const scaleFila = this.scaleFila;
    const scaleExec = this.scaleExec;

    // A grandeza que dimensiona o retângulo base depende da métrica: em
    // `EXECUCAO` o retângulo É a execução, porque é ela a quantidade da métrica
    // selecionada (critério 1.1).
    const baseIsExec = metrica === 'EXECUCAO';
    const scaleBase = baseIsExec ? scaleExec : scaleFila;

    this.refreshPalettes(scaleBase, scaleExec);

    const coverage = computeCoverageView(grid.cobertura, {
      metrica,
      baldeSeg: grid.baldeSeg,
      // Repassado, não construído: a camada não decide fuso, quem monta decide.
      // Ausente, o núcleo adota BRT sem segundos (comportamento da origem).
      relogio: this.options.relogio,
    });

    // `VAZIA` é a única classe que suprime o desenho (requisito 7.4). Cobertura
    // não verificada preserva as células: a dúvida é sobre a cobertura, não
    // sobre as células que chegaram.
    if (coverage.desenhaCelulas) {
      this.buildCells(cells, coords, window, scaleBase, scaleExec, baseIsExec);
    }

    if (incluiExecucao(metrica)) {
      this.buildHatch(coverage, coords, window);
    }

    this.buildLegend(coverage, scaleBase, scaleExec, metrica, baseIsExec);

    plan.vazio =
      plan.outlines.length === 0 &&
      plan.hatch.length === 0 &&
      plan.legend.length === 0 &&
      plan.footer === null &&
      !this.anyCells();
  }

  /**
   * O plano de uma camada autodesativada: o aviso, e nada além dele.
   *
   * Zero células, zero contornos, zero hachura e nenhum rodapé (requisito 10.6).
   * O rodapé fica de fora de propósito: ele fala de cobertura de dado, e a
   * cobertura não mudou — o que falhou foi o desenho. Mantê-lo faria a tela
   * afirmar duas coisas sobre assuntos diferentes na mesma respiração.
   *
   * `vazio` é escrito à mão porque este caminho não passa pelo cálculo do fim de
   * `rebuild`. O valor coincide com o que aquela fórmula daria — legenda não
   * vazia — e é ele que mantém o renderizador ativo para o texto sair.
   */
  private buildSelfDisabledNotice(): void {
    this.plan.legend = AVISO_AUTODESATIVADA;
    this.plan.legendAlerta = true;
    this.plan.vazio = false;
  }

  /**
   * Reconstrói as paletas **só quando os limites de opacidade mudam**.
   *
   * ⚠️ A guarda não é microotimização: `rebuild` roda a cada quadro de
   * movimentação, e montar 48 cadeias de cor por quadro alocaria exatamente
   * durante o arrasto — que é onde uma pausa de coleta de lixo aparece como
   * engasgo. Os limites vêm da configuração da escala e, na prática, não mudam
   * entre quadros; a reconstrução condicional preserva a intenção declarada em
   * `buildPalette` sem depender de os limites serem constantes.
   */
  private refreshPalettes(scaleBase: ColorScale, scaleExec: ColorScale): void {
    // ⭐ O modo entra na CHAVE da paleta. Sem isso, trocar de modo com os mesmos
    // limites de opacidade não reconstruiria as paletas e o seletor ficaria
    // inerte — a mesma armadilha do `marcaExec`, que só surtia efeito
    // desligando e religando a camada.
    const termica = this.options.modoCor === 'TERMICA';
    // ⚠️ FORA do `if` de reconstrução, de propósito: o bloco abaixo é guardado
    // por cache de paleta e NÃO roda quando ela já está montada. Escrever
    // `suavizar` lá dentro amarraria uma decisão de DESENHO ao ciclo de vida de
    // uma otimização de ALOCAÇÃO — bastaria alguém acrescentar um caminho que
    // reconstrói a paleta, ou mexer nas condições do `if`, para o desfoque
    // aparecer numa passada e sumir na seguinte. Aqui é reescrito em toda
    // passada, e o custo é uma atribuição de booleano.
    //
    // ⚠️ Uma versão anterior deste comentário justificava a posição dizendo que
    // "um `reset()` do plano o zeraria". Isso é FALSO: `DrawPlan.reset()` não
    // toca `suavizar`. A decisão continua certa, o motivo declarado é que estava
    // errado — e comentário que promete garantia inexistente é pior que
    // comentário ausente, porque faz o próximo revisor não olhar.
    //
    // O comportamento observável está travado em `__tests__/suavizacao-termica.spec.ts`
    // (a suavização persiste em 4 passadas com a paleta cacheada). Aquele teste
    // afirma a propriedade, não esta linha — mover o código sem quebrar o
    // desenho é permitido; quebrar o desenho, não.
    this.plan.suavizar = termica;
    const chaveBase = `${scaleBase.alphaMin}|${scaleBase.alphaMax}|${termica ? 'T' : 'L'}`;
    if (chaveBase !== this.paletteKeyBase || this.plan.paletteBid.length === 0) {
      if (termica) {
        // ⚠️ A MESMA paleta nos dois lados, e é o ponto da rampa térmica: a cor
        // passa a codificar TAMANHO, e o lado se lê pela POSIÇÃO relativa ao
        // preço (fila acima é venda, abaixo é compra) — como no bookmap
        // comercial. Foi por não ter percebido isso que registrei, errado, que a
        // rampa "exigiria outro canal para o lado".
        const p = construirPaletaTermica(BUCKETS, scaleBase.alphaMin, scaleBase.alphaMax);
        this.plan.paletteBid = p;
        this.plan.paletteAsk = p;
      } else {
        this.plan.paletteBid = buildPalette(CANAL_BID, scaleBase.alphaMin, scaleBase.alphaMax);
        this.plan.paletteAsk = buildPalette(CANAL_ASK, scaleBase.alphaMin, scaleBase.alphaMax);
      }
      this.paletteKeyBase = chaveBase;
    }

    const chaveExec = `${scaleExec.alphaMin}|${scaleExec.alphaMax}`;
    if (chaveExec !== this.paletteKeyExec || this.plan.paletteExec.length === 0) {
      this.plan.paletteExec = buildPalette(CANAL_EXEC, scaleExec.alphaMin, scaleExec.alphaMax);
      this.paletteKeyExec = chaveExec;
    }

    // As paletas de bolha NÃO dependem da escala: os limites de opacidade delas
    // são fixos (a magnitude já está no RAIO). Montadas uma vez e reusadas.
    if (this.plan.paletteBolhaBid.length === 0) {
      this.plan.paletteBolhaBid = buildPaletaBolha(CANAL_BID);
      this.plan.paletteBolhaAsk = buildPaletaBolha(CANAL_ASK);
    }
  }

  private anyCells(): boolean {
    for (let b = 0; b < BUCKETS; b++) {
      if ((this.plan.bid[b]?.length ?? 0) > 0) return true;
      if ((this.plan.ask[b]?.length ?? 0) > 0) return true;
      if ((this.plan.exec[b]?.length ?? 0) > 0) return true;
    }
    // A bolha é forma a emitir como qualquer outra: sem isto, uma janela em que
    // só houve execução (fila zero, `marcaExec: 'BOLHA'`) seria classificada
    // como plano VAZIO e o renderizador não desenharia nada.
    return this.plan.temBolhas();
  }

  /**
   * Assinatura da janela.
   *
   * Cadeia e não objeto porque a comparação é por igualdade simples entre
   * quadros; e com as dimensões dentro, porque redimensionar o painel muda a
   * amostra visível tanto quanto arrastar.
   */
  private windowKey(w: VisibleWindow): string {
    return `${w.tsDe}|${w.tsAte}|${w.precoDe}|${w.precoAte}|${w.larguraPx}|${w.alturaPx}`;
  }

  /**
   * Agregado → retângulos em pixel, agrupados por bucket de cor.
   *
   * ── DUAS PASSADAS, ORDEM FIXA ─────────────────────────────────────────────
   *
   * O par com fila de compra e de venda ambas positivas produz **duas** células
   * distintas, primeiro a de compra e depois a de venda (critério 1.9). Nenhuma
   * célula combina os dois lados num único valor (critério 1.3): a intensidade
   * de cada uma sai só da quantidade do próprio lado.
   *
   * Quantidade zero não gera célula (critério 1.1). E não gerar é o ponto: a
   * ausência significa quantidade zero, não liquidez fraca. Fila que desaparece
   * a partir de um balde simplesmente deixa de produzir células dali em diante,
   * e as dos baldes anteriores permanecem — nenhum valor é repetido para frente
   * (critério 1.5), porque não há estado entre baldes neste laço.
   */
  private buildCells(
    cells: AggregatedCells,
    coords: CoordinateFns,
    window: VisibleWindow,
    scaleBase: ColorScale,
    scaleExec: ColorScale,
    baseIsExec: boolean,
  ): void {
    const plan = this.plan;
    const geom = {
      baldeSeg: this.options.grid?.baldeSeg ?? 60,
      fatorTempo: cells.fatorTempo,
      tickSize: this.options.tickSize,
      fatorPreco: cells.fatorPreco,
      widthPx: window.larguraPx,
      heightPx: window.alturaPx,
    };

    // A geometria do painel vai para o plano porque a passada de desenho precisa
    // dela para RECORTAR a bolha — ver `DrawPlan.larguraPainelPx`.
    plan.larguraPainelPx = window.larguraPx;
    plan.alturaPainelPx = window.alturaPx;

    const comExec = incluiExecucao(this.options.metrica);
    // Ausente ⇒ BARRA: preserva o comportamento das bancadas, que constroem a
    // camada sem informar a opção. Ver `BookmapLayerOptions.marcaExec`.
    const comBolha = comExec && this.options.marcaExec === 'BOLHA';

    // Teto do raio da bolha: UMA vez por passada, da largura NOMINAL do balde
    // agrupado — nunca da largura recortada de cada célula. Ver
    // `larguraNominalDaCelula` para o defeito que essa distinção evita.
    const raioMaxDaPassada = comBolha
      ? raioMaximoPorEspaco(
          larguraNominalDaCelula(
            window.larguraPx,
            window.tsDe,
            window.tsAte,
            geom.baldeSeg,
            geom.fatorTempo,
          ),
        )
      : BOLHA_RAIO_MAX_PX;
    const aMin = scaleBase.alphaMin;
    const aMax = scaleBase.alphaMax;
    const eMin = scaleExec.alphaMin;
    const eMax = scaleExec.alphaMax;

    // Objeto de célula reusado entre iterações: `cellToPixels` só lê os campos,
    // e alocar 3.000 objetos por reconstrução colocaria pausa de coleta de lixo
    // no meio do arrasto.
    const scratch = { tsMs: 0, preco: 0, bid: 0, ask: 0, buy: 0, sell: 0 };

    for (let k = 0; k < cells.count; k++) {
      const tsMs = cells.tsMs[k] ?? Number.NaN;
      const preco = cells.preco[k] ?? Number.NaN;
      const bid = cells.bid[k] ?? 0;
      const ask = cells.ask[k] ?? 0;
      const buy = cells.buy[k] ?? 0;
      const sell = cells.sell[k] ?? 0;

      scratch.tsMs = tsMs;
      scratch.preco = preco;
      scratch.bid = bid;
      scratch.ask = ask;
      scratch.buy = buy;
      scratch.sell = sell;

      const qtdBid = baseIsExec ? buy : bid;
      const qtdAsk = baseIsExec ? sell : ask;

      // ── passada 1: compra ──
      if (qtdBid > 0) {
        this.pushCell(scratch, coords, geom, scaleBase, qtdBid, 'BID', aMin, aMax, plan.bid);
      }
      // ── passada 2: venda ──
      if (qtdAsk > 0) {
        this.pushCell(scratch, coords, geom, scaleBase, qtdAsk, 'ASK', aMin, aMax, plan.ask);
      }

      // ── marca de execução, depois dos retângulos de fila ──
      //
      // Em `AMBAS`, uma célula com fila zero e execução positiva produz só a
      // marca: a ausência do retângulo informa fila zero, e a marca informa que
      // houve negócio ali — esconder a segunda para preservar a primeira
      // apagaria informação medida.
      if (comExec) {
        const exec = buy + sell;
        if (exec > 0) {
          const bucket = bucketFromAlpha(alphaOf(scaleExec, exec), eMin, eMax);
          const drawn = cellToPixels(scratch, coords, geom, {
            bucket,
            side: buy >= sell ? 'BID' : 'ASK',
            aboveScale: false,
          });
          if (drawn !== null) {
            if (comBolha) {
              // ── bolha: raio pelo VOLUME, cor pelo AGRESSOR ──
              //
              // O centro sai da célula já recortada ao viewport, então a bolha
              // nasce dentro do painel. O raio NÃO é limitado pela célula: é
              // justamente ao exceder a célula que a execução grande fica
              // visível num balde de 60 s estreito.
              //
              // ⚠️ O CENTRO estar dentro do painel não põe a BOLHA dentro dele:
              // com o centro na última coluna e raio de 18 px, ela transbordava
              // por cima da escala de preço e dos rótulos. Quem garante o limite
              // é o recorte em `fillExecBubbles` — que só passou a existir em
              // 04/09/2026. Antes disso, este comentário afirmava uma garantia
              // que não havia.
              //
              // O teto vem da LARGURA DA CÉLULA — ver `raioMaximoPorEspaco`. Sem
              // ele as bolhas se fundem numa corrente quando o dia está
              // comprimido, que foi o segundo relato do mesmo dia.
              plan.bolhasContadas += 1;
              if (raioMaxDaPassada <= BOLHA_RAIO_MIN_PX) plan.bolhasNoPiso += 1;
              const raio = raioDaBolha(exec, scaleExec, raioMaxDaPassada);
              if (raio > 0) {
                plan.bolhas.push({
                  cx: drawn.x + drawn.w / 2,
                  cy: drawn.y + drawn.h / 2,
                  raio,
                  side: buy >= sell ? 'BID' : 'ASK',
                  bucket: drawn.bucket,
                });
              }
            } else {
              const list = plan.exec[drawn.bucket];
              if (list !== undefined) list.push(drawn);
            }
          }
        }
      }
    }
  }

  /** Converte uma célula de um lado e a arquiva no bucket dela. */
  private pushCell(
    cell: AggregatedCell,
    coords: CoordinateFns,
    geom: {
      baldeSeg: number;
      fatorTempo: number;
      tickSize: number;
      fatorPreco: number;
      widthPx: number;
      heightPx: number;
    },
    scale: ColorScale,
    quantidade: number,
    side: 'BID' | 'ASK',
    alphaMin: number,
    alphaMax: number,
    byBucket: DrawCell[][],
  ): void {
    const bucket = bucketFromAlpha(alphaOf(scale, quantidade), alphaMin, alphaMax);
    const acima = isAboveScale(scale, quantidade);
    const drawn = cellToPixels(cell, coords, geom, { bucket, side, aboveScale: acima });
    // `null` é "fora da escala visível" ou "não intersecta o viewport": omite
    // exclusivamente esta célula e a passada segue com as demais (critério 1.8).
    if (drawn === null) return;

    const list = byBucket[drawn.bucket];
    if (list !== undefined) list.push(drawn);
    if (drawn.aboveScale) this.plan.outlines.push(drawn);
  }

  /**
   * Intervalos de cobertura ausente → faixas em pixel.
   *
   * O intervalo é recortado à janela visível **antes** da conversão: fora da
   * faixa visível a função de coordenada devolve ausência de valor, e converter
   * primeiro perderia a faixa inteira sempre que ela começasse antes da borda
   * esquerda — que é justamente o caso do trecho final dos pregões medidos.
   *
   * Largura mínima de 1 px quando a interseção não é vazia (requisito 7.2):
   * faixa de largura zero seria indistinguível de ausência de hachura, e
   * ausência de hachura afirma cobertura que ninguém verificou.
   */
  private buildHatch(
    coverage: CoverageView,
    coords: CoordinateFns,
    window: VisibleWindow,
  ): void {
    if (coverage.hachuras.length === 0) return;

    for (const faixa of coverage.hachuras) {
      const deMs = Math.max(faixa.deMs, window.tsDe);
      const ateMs = Math.min(faixa.ateMs, window.tsAte);
      if (!isFiniteNumber(deMs) || !isFiniteNumber(ateMs)) continue;
      // Interseção vazia: nada a hachurar nesta janela.
      if (ateMs < deMs) continue;

      const x1 = coords.timeToX(deMs / 1000);
      const x2 = coords.timeToX(ateMs / 1000);
      if (x1 === null || x2 === null) continue;

      const esquerda = clamp(Math.round(Math.min(x1, x2)), 0, window.larguraPx);
      const direita = clamp(Math.round(Math.max(x1, x2)), 0, window.larguraPx);
      const largura = Math.max(1, direita - esquerda);
      if (esquerda >= window.larguraPx) continue;

      this.plan.hatch.push({
        x: esquerda,
        w: Math.min(largura, window.larguraPx - esquerda),
      });
    }
  }

  /**
   * Legenda da escala e rodapé de cobertura.
   *
   * ⭐ **Dois canais, não um.** A origem tratava tudo como "legenda" e escrevia
   * sempre; aqui o texto é repartido por NATUREZA:
   *
   * - **legenda** — o que a tela significa: qual camada é, o que cada cor quer
   *   dizer, e as ressalvas que mudam a leitura (zoom apertado, autodesativação).
   *   Ligada por omissão, e desligável por `mostrarLegenda: false`.
   * - **diagnóstico** — instrumentação: os percentis da escala, a declaração de
   *   escala colapsada e o rodapé de cobertura com horários. **Desligado por
   *   omissão**, ligável por `mostrarDiagnostico: true`.
   *
   * O motivo está em `mostrarDiagnostico`: no playground essas três linhas
   * ocupavam a maior parte do texto na tela, quase todas dizendo "não informado",
   * sobre as velas. O requisito 2.7 da origem — números absolutos obrigatórios —
   * continua atendido **quando o diagnóstico está ligado**, na mesma redação.
   *
   * ⚠️ A primeira linha é PARTIDA em vez de suprimida: `Livro · fila em repouso`
   * é identidade da camada (legenda) e os percentis são instrumentação
   * (diagnóstico). Suprimir a linha inteira deixaria a mancha de calor sem dizer
   * de quem ela é, que é o oposto do que se quer.
   *
   * O rodapé sai independentemente do recorte visível e da métrica selecionada
   * (requisitos 7.7 e 7.8) — o que passou a condicioná-lo é só o canal. E a
   * classe vem exclusivamente do campo da resposta, nunca inferida das células
   * desenhadas.
   */
  private buildLegend(
    coverage: CoverageView,
    scaleBase: ColorScale,
    scaleExec: ColorScale,
    metrica: MetricaBookmap,
    baseIsExec: boolean,
  ): void {
    const linhas: string[] = [];

    // ⚠️ Ausência ⇒ diagnóstico DESLIGADO. É a única omissão desta camada que não
    // reproduz a origem, e a justificativa está em `mostrarDiagnostico`.
    const diagnostico = this.options.mostrarDiagnostico === true;

    const grandeza = baseIsExec ? 'execução' : rotuloGrandeza(metrica);
    const identidade = `Livro · ${grandeza}`;
    linhas.push(
      diagnostico
        ? `${identidade} · p50 ${formatContratos(scaleBase.p50)} ct · ` +
            `p99 ${formatContratos(scaleBase.p99)} ct · escala da janela visível`
        : identidade,
    );

    if (diagnostico && !hasMagnitudeVariation(scaleBase)) {
      // Requisito 2.10: escala colapsada é declarada, não escondida. Sem esta
      // linha o operador leria uma tela saturada como distribuição normal.
      //
      // ⚠️ Passou a depender do diagnóstico, e o compromisso é real: com ele
      // desligado, uma escala colapsada fica muda. Foi a troca escolhida porque a
      // frase é longa, aparece justamente quando NÃO há dado — o caso do
      // playground, em que ela era das linhas mais visíveis da tela — e quem
      // precisa dela é quem já está instrumentando a camada.
      linhas.push('A janela visível não apresenta variação de magnitude.');
    }

    // Em `AMBAS` a execução tem escala própria, e a legenda tem de dizer qual é
    // — senão a marca interna fica sem referência numérica.
    if (metrica === 'AMBAS') {
      // ⚠️ O nome da FORMA entra na legenda de propósito. Sem ele, o operador não
      // tem como saber pela tela se está vendo bolha ou barra — e foi exatamente
      // essa dúvida ("não aparece as bolhas") que custou uma rodada de
      // diagnóstico em 03/09/2026. A legenda passa a responder sozinha.
      //
      // ⭐ Por isso a FORMA fica na legenda e só os percentis vão para o
      // diagnóstico: a pergunta que custou a rodada continua respondida na tela
      // por omissão.
      const forma = this.options.marcaExec === 'BOLHA' ? 'Bolha' : 'Marca interna';
      linhas.push(
        diagnostico
          ? `${forma} · execução · p50 ${formatContratos(scaleExec.p50)} ct · ` +
              `p99 ${formatContratos(scaleExec.p99)} ct`
          : `${forma} · execução`,
      );
      if (this.options.marcaExec === 'BOLHA') {
        linhas.push('Bolha: raio = volume executado · cor = lado do agressor');
        // ⚠️ Zoom apertado colapsa o teto do raio no piso: todas as bolhas saem
        // iguais e o tamanho deixa de significar volume. Dizer isso é o que evita
        // o operador ler grandeza onde não há — e aponta a saída.
        if (this.plan.semEscalaDeVolume()) {
          linhas.push('⚠ zoom apertado: tamanho NÃO reflete volume — use "Focar no dia"');
          this.plan.legendAlerta = true;
        }
      }
    }

    // O que verde e vermelho significam depende da grandeza desenhada: em
    // `EXECUCAO` os retângulos são a execução, e o lado é o agressor. Repetir o
    // texto da fila ali faria a legenda mentir sobre o que está na tela.
    linhas.push(
      baseIsExec
        ? 'Verde: agressor comprador · Vermelho: agressor vendedor'
        : 'Verde: fila de compra · Vermelho: fila de venda',
    );

    // Retomada em curso: a camada voltou a desenhar, mas nenhuma passada ainda
    // concluiu sem exceção. O aviso continua até haver evidência (requisito 10.7),
    // com texto próprio — dizer "camada desativada" sobre uma tela que está
    // desenhando seria afirmação falsa.
    if (this.selfDisabledNotice) {
      for (const aviso of AVISO_NOVA_TENTATIVA) linhas.push(aviso);
      this.plan.legendAlerta = true;
    }

    /**
     * ⚠️ Supressão pedida: o plano sai SEM legenda e SEM rodapé, e o
     * renderizador nem chega a escrever (ele retorna cedo com as duas listas
     * vazias). A decisão fica aqui, junto do resto do cálculo do plano, porque o
     * renderizador não decide nada por contrato.
     *
     * ⚠️ O aviso de **camada autodesativada** NÃO é afetado: ele vem de
     * `buildSelfDisabledNotice`, que é caminho alternativo e não passa por aqui.
     * Isso é o comportamento desejado — quando a camada se desativou por falhas
     * repetidas, não há célula nenhuma desenhada, então a legenda não cobre nada
     * e é a única informação disponível na tela. Suprimi-la ali esconderia a
     * falha.
     *
     * O que é suprimido junto é o aviso de **retomada em curso**
     * (`AVISO_NOVA_TENTATIVA`), que faz parte desta legenda. Aceitável: naquele
     * estado a camada está desenhando normalmente.
     *
     * Ausência da opção mantém o desenho, byte a byte como antes.
     */
    if (this.options.mostrarLegenda === false) {
      this.plan.legend = [];
      this.plan.legendAlerta = false;
      this.plan.footer = null;
      this.plan.footerAlerta = false;
      return;
    }

    this.plan.legend = linhas;
    // ⚠️ O rodapé é DIAGNÓSTICO: `Cobertura não verificada · fila não informado ·
    // execução não informado` é o texto que o usuário fotografou no playground,
    // escrito no pé da área de plotagem, sobre o eixo de tempo, dizendo três vezes
    // que não há informação. Quem instrumenta liga a opção e o recupera inteiro.
    this.plan.footer = diagnostico ? coverage.rotulos.resumo : null;
    // Cobertura completa é a única sem ressalva; qualquer outra classe, e a
    // ausência de verificação, merecem destaque em vez de texto neutro.
    this.plan.footerAlerta =
      diagnostico && (coverage.aviso !== null || !coverage.verificada);
  }
}
