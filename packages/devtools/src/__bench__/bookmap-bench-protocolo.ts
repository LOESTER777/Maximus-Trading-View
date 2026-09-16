/**
 * `bookmap-bench-protocolo` — o **protocolo de medição** da bancada de
 * desempenho e o registro do ambiente de apuração. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 12.1. Requisitos 9.1 e 9.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O PROTOCOLO, LITERAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O requisito 9.1 fixa o procedimento e não deixa margem:
 *
 * > **100 repetições consecutivas** sobre viewport de dimensões fixas,
 * > descartadas as **10 primeiras**, valor apurado igual ao **percentil 95** dos
 * > tempos restantes.
 *
 * Logo: 100 execuções, 90 consideradas, e o apurado é o percentil 95 dessas 90.
 *
 * ── AS TRÊS DECISÕES QUE O REQUISITO NÃO FIXA ─────────────────────────────
 *
 * 1. **Qual definição de percentil.** Com 90 amostras, `p95` cai entre postos e
 *    a resposta depende da convenção. Adotada a mesma de
 *    `bookmap-color.core.quantileIndex` — posto `⌈q·n⌉ − 1`, ou seja o 86º menor
 *    dos 90 tempos. Escolhida por já estar no projeto: um segundo critério de
 *    percentil na mesma feature seria uma divergência esperando para acontecer.
 *
 * 2. **Onde o cronômetro abre e fecha.** Só em torno do que está sob medição.
 *    Preparação por repetição — invalidar cache de escala, repor estado, pedir
 *    ao gráfico que reconstrua a vista — entra em `antes`, que **não é
 *    cronometrado**. Sem essa separação, medir `draw()` mediria também o
 *    `updateAllViews()` que o antecede, e o alvo de 8 ms do requisito 9.3 é da
 *    passada de desenho.
 *
 * 3. **Por que as 10 primeiras se descartam.** É aquecimento: primeira execução
 *    paga compilação de linha de base, promoção a código otimizado e falhas de
 *    cache que não representam o estado de regime. O requisito manda descartar;
 *    aqui elas são **executadas** e só depois excluídas da estatística, que é o
 *    que "descartadas as 10 primeiras" significa — e não "executar 90".
 *
 * ── DEFESA CONTRA ELIMINAÇÃO DE CÓDIGO MORTO ──────────────────────────────
 *
 * Um motor que perceba que o resultado da função sob medição é ignorado tem
 * licença para não computá-lo, e a bancada mediria zero. O retorno de cada
 * repetição é gravado num sumidouro de módulo, observável por `valorRetido()` —
 * o que torna o resultado alcançável e a eliminação inválida.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O AMBIENTE (requisito 9.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um tempo sem ambiente não é interpretável: 8 ms nesta máquina não é 8 ms em
 * outra, e um alvo de desenho medido fora de um navegador mede outra coisa. O
 * requisito exige máquina, navegador e dimensões do viewport, e
 * `capturarAmbiente` registra os três — declarando `ehNavegadorReal: false`
 * quando o ambiente é `jsdom`, em vez de apresentar `jsdom` como navegador.
 *
 * ⚠️ **O que uma medição de `draw()` sob `jsdom` NÃO inclui.** Não há
 * rasterizador: o alvo de canvas da bancada conta chamadas e não pinta pixel.
 * O tempo apurado é o **trabalho da própria camada** — laço de células,
 * conversão de coordenada, troca de estilo, montagem de texto — e exclui
 * rasterização e composição. É a parte que o código do projeto controla, e é
 * também onde uma regressão de algoritmo apareceria; mas o número não é o tempo
 * de quadro de um navegador de verdade, e o relatório precisa dizer isso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este módulo mede tempo e formata texto. Lê `node:os` e `globalThis.navigator`
 * exclusivamente para descrever a máquina e o runtime no relatório. Nenhuma
 * leitura de banco, de arquivo de dado, de CSV ou de rede; nenhuma escrita em
 * lugar algum; nenhum endereço de rede, identificador de conta, credencial ou
 * estado de posição. Não importa nada da árvore de negociação.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import * as os from 'node:os';

// ═════════════════════════════════════════════════════════════════════════════
// O protocolo declarado
// ═════════════════════════════════════════════════════════════════════════════

/** Repetições consecutivas por alvo (requisito 9.1). */
export const BANCADA_REPETICOES = 100;

/** Repetições descartadas do início (requisito 9.1). */
export const BANCADA_DESCARTADAS = 10;

/** Quantil do valor apurado (requisito 9.1). */
export const BANCADA_QUANTIL = 0.95;

/** Repetições que entram na estatística: 100 − 10 = 90. */
export const BANCADA_CONSIDERADAS = BANCADA_REPETICOES - BANCADA_DESCARTADAS;

/**
 * Viewport fixo da bancada (requisito 9.1: "dimensões fixas").
 *
 * 1.400 px de largura é a referência que o projeto usa ao justificar o orçamento
 * de 3.000 células — "3.000 células já é mais informação do que 1.400 px de
 * largura conseguem distinguir". A altura de 620 px é um painel de gráfico
 * plausível na página de decisão. O valor exato importa menos que ser **fixo e
 * registrado**, que é o que o requisito 9.2 cobra.
 */
export const BANCADA_VIEWPORT = { larguraPx: 1_400, alturaPx: 620 } as const;

// ═════════════════════════════════════════════════════════════════════════════
// Percentil
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Percentil por posto sobre uma amostra **já ordenada crescente**.
 *
 * Posto `⌈q·n⌉ − 1`, recortado a `[0, n−1]` — a convenção de
 * `bookmap-color.core.quantileIndex`. Com `n = 90` e `q = 0,95`, devolve o posto
 * 85, isto é o **86º menor** tempo.
 *
 * Amostra vazia devolve `NaN`: não existe percentil de nada, e devolver zero
 * seria afirmar que a medição foi instantânea.
 */
export function percentilPorPosto(ordenadas: readonly number[], q: number): number {
  const n = ordenadas.length;
  if (n <= 0) return Number.NaN;

  const bruto = Math.ceil(q * n) - 1;
  const posto = bruto < 0 ? 0 : bruto > n - 1 ? n - 1 : bruto;
  return ordenadas[posto] ?? Number.NaN;
}

/** Mediana por posto da mesma amostra ordenada. Só compõe o relatório. */
function medianaPorPosto(ordenadas: readonly number[]): number {
  return percentilPorPosto(ordenadas, 0.5);
}

// ═════════════════════════════════════════════════════════════════════════════
// Relógio
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Relógio de maior resolução disponível, em milissegundos fracionários.
 *
 * ⚠️ **Relógio real, nunca simulado.** Sob `vi.useFakeTimers()` o tempo não
 * avança e toda medição sairia zero — a bancada não instala temporizador falso,
 * e quem a estender não deve. O relógio injetado em `BookmapPrimitive` é outra
 * coisa e serve ao propósito oposto: **congelar** o relógio interno da camada
 * para que a degradação adaptativa não altere o orçamento no meio de uma
 * medição de tempo.
 */
export function relogioDeAltaResolucao(): () => number {
  const perf = globalThis.performance;
  if (perf !== undefined && typeof perf.now === 'function') {
    return () => perf.now();
  }
  return () => Date.now();
}

/** Nome do relógio efetivamente usado, para o relatório. */
function nomeDoRelogio(): string {
  const perf = globalThis.performance;
  const temPerf = perf !== undefined && typeof perf.now === 'function';
  return temPerf ? 'performance.now()' : 'Date.now()';
}

// ═════════════════════════════════════════════════════════════════════════════
// Sumidouro
// ═════════════════════════════════════════════════════════════════════════════

let sumidouro: unknown = null;

/**
 * O último valor devolvido por um alvo sob medição.
 *
 * Existe para tornar o resultado **alcançável**, negando ao motor a licença de
 * não computar o que ninguém observa. Ler daqui não tem outra utilidade.
 */
export function valorRetido(): unknown {
  return sumidouro;
}

// ═════════════════════════════════════════════════════════════════════════════
// Alvo e medição
// ═════════════════════════════════════════════════════════════════════════════

/** Um alvo de medição: o que preparar sem cronômetro, e o que cronometrar. */
export interface AlvoDeMedicao<T> {
  /** Rótulo do alvo no relatório. */
  readonly nome: string;
  /** Preparação por repetição. **Fora** do cronômetro. */
  readonly antes?: () => void;
  /** O que está sob medição. O retorno vai ao sumidouro. */
  readonly executar: () => T;
}

/** Ajustes do protocolo. Sem eles, vale o protocolo declarado. */
export interface OpcoesDeMedicao {
  readonly repeticoes?: number;
  readonly descartadas?: number;
  readonly quantil?: number;
  readonly relogio?: () => number;
}

/** O resultado de uma medição, com tudo que o relatório precisa declarar. */
export interface MedicaoBancada {
  readonly nome: string;
  /** Repetições efetivamente executadas. */
  readonly repeticoes: number;
  /** Repetições descartadas do início. */
  readonly descartadas: number;
  /** Repetições que entraram na estatística. */
  readonly consideradas: number;
  readonly quantil: number;
  /** **O valor apurado** — percentil `quantil` das consideradas, em ms. */
  readonly apuradoMs: number;
  readonly minMs: number;
  readonly medianaMs: number;
  readonly maxMs: number;
  readonly mediaMs: number;
  /** Soma das repetições consideradas. Serve para dimensionar a bancada. */
  readonly totalMs: number;
  /**
   * `true` somente quando repetições, descarte e quantil são **exatamente** os
   * do requisito 9.1.
   *
   * O campo existe porque o protocolo é ajustável — a suíte do arnês precisa
   * medir com poucas repetições — e uma medição fora do protocolo não pode ser
   * apresentada como se estivesse dentro dele. `formatarRelatorio` marca a
   * linha.
   */
  readonly protocoloDeclarado: boolean;
}

/** Inteiro finito não negativo, ou o padrão. */
function inteiroOuPadrao(bruto: number | undefined, padrao: number): number {
  if (bruto === undefined) return padrao;
  if (!Number.isFinite(bruto) || !Number.isInteger(bruto) || bruto < 0) return padrao;
  return bruto;
}

/**
 * Executa o protocolo sobre um alvo e apura o valor.
 *
 * Pós-condições:
 *
 * - `executar` é chamado **exatamente** `repeticoes` vezes; `antes`, quando
 *   informado, também — e sempre imediatamente antes, fora do cronômetro.
 * - `consideradas === repeticoes − descartadas`.
 * - `apuradoMs` é o percentil `quantil` das consideradas, por posto.
 * - Nenhuma exceção do alvo é capturada: um alvo que lança **falha a bancada**,
 *   em vez de produzir um tempo que não mediu o trabalho pretendido.
 *
 * @throws se `descartadas >= repeticoes`, o que deixaria a estatística vazia.
 */
export function medir<T>(alvo: AlvoDeMedicao<T>, opts?: OpcoesDeMedicao): MedicaoBancada {
  const repeticoes = Math.max(1, inteiroOuPadrao(opts?.repeticoes, BANCADA_REPETICOES));
  const descartadas = inteiroOuPadrao(opts?.descartadas, BANCADA_DESCARTADAS);
  const quantilBruto = opts?.quantil ?? BANCADA_QUANTIL;
  const quantil =
    Number.isFinite(quantilBruto) && quantilBruto > 0 && quantilBruto <= 1
      ? quantilBruto
      : BANCADA_QUANTIL;

  if (descartadas >= repeticoes) {
    throw new Error(
      `[bancada] descartar ${descartadas} de ${repeticoes} repetições deixaria a ` +
        'amostra vazia; o protocolo exige ao menos uma repetição considerada.',
    );
  }

  const agora = opts?.relogio ?? relogioDeAltaResolucao();
  const tempos: number[] = new Array<number>(repeticoes);

  for (let i = 0; i < repeticoes; i += 1) {
    alvo.antes?.();
    const t0 = agora();
    const produzido = alvo.executar();
    const t1 = agora();
    tempos[i] = t1 - t0;
    // Sumidouro: ver `valorRetido`.
    sumidouro = produzido;
  }

  const consideradas = tempos.slice(descartadas);
  const ordenadas = [...consideradas].sort((a, b) => a - b);

  let total = 0;
  for (const t of consideradas) total += t;

  return {
    nome: alvo.nome,
    repeticoes,
    descartadas,
    consideradas: consideradas.length,
    quantil,
    apuradoMs: percentilPorPosto(ordenadas, quantil),
    minMs: ordenadas[0] ?? Number.NaN,
    medianaMs: medianaPorPosto(ordenadas),
    maxMs: ordenadas[ordenadas.length - 1] ?? Number.NaN,
    mediaMs: consideradas.length > 0 ? total / consideradas.length : Number.NaN,
    totalMs: total,
    protocoloDeclarado:
      repeticoes === BANCADA_REPETICOES &&
      descartadas === BANCADA_DESCARTADAS &&
      quantil === BANCADA_QUANTIL,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tamanho de corpo (tarefa 12.3 e requisito 8.10)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Bytes do corpo serializado de um valor, em UTF-8.
 *
 * `JSON.stringify` sem indentação — é o corpo que a rede transportaria, não uma
 * versão formatada para leitura. `TextEncoder` antes de `Buffer` porque existe
 * nos dois ambientes; caractere fora de ASCII conta os bytes que de fato ocupa.
 */
export function tamanhoDoCorpoEmBytes(valor: unknown): number {
  const texto = JSON.stringify(valor);
  if (texto === undefined) return 0;

  const codificador = globalThis.TextEncoder;
  if (codificador !== undefined) return new codificador().encode(texto).byteLength;

  // Sem `TextEncoder`, o comprimento em UTF-16 é o melhor disponível. Vale para
  // corpo ASCII, que é o caso de um payload de números.
  return texto.length;
}

/** Bytes em mebibytes, para o relatório. */
export function emMiB(bytes: number): number {
  return bytes / (1_024 * 1_024);
}

// ═════════════════════════════════════════════════════════════════════════════
// Ambiente de apuração (requisito 9.2)
// ═════════════════════════════════════════════════════════════════════════════

/** Dimensões do viewport da apuração. */
export interface ViewportDaApuracao {
  readonly larguraPx: number;
  readonly alturaPx: number;
}

/** O ambiente de apuração, como o requisito 9.2 pede que seja registrado. */
export interface AmbienteBancada {
  /** Máquina: sistema, arquitetura e nome do host. */
  readonly maquina: string;
  /** Modelo do processador, ou o motivo de não estar disponível. */
  readonly cpu: string;
  /** Processadores lógicos vistos pelo runtime. */
  readonly nucleos: number;
  readonly memoriaGiB: number;
  /** Runtime que executou a medição. */
  readonly runtime: string;
  /** Navegador, ou a declaração de que não há um. */
  readonly navegador: string;
  /** `false` sob `jsdom` — ver o aviso no cabeçalho. */
  readonly ehNavegadorReal: boolean;
  readonly viewport: ViewportDaApuracao;
  /** Relógio usado na medição. */
  readonly relogio: string;
  /** Instante da captura, ISO 8601. Rótulo do relatório. */
  readonly capturadoEm: string;
}

/** Fonte dos dados de máquina. Injetável para tornar a captura testável. */
export interface FonteDeAmbiente {
  readonly maquina?: () => { plataforma: string; arquitetura: string; host: string };
  readonly cpu?: () => { modelo: string; nucleos: number };
  readonly memoriaBytes?: () => number;
  readonly userAgent?: () => string | null;
  readonly runtime?: () => string;
  readonly agora?: () => Date;
}

/** Nome do runtime: versão do Node, quando disponível. */
function runtimePadrao(): string {
  const proc = globalThis.process as { version?: string } | undefined;
  const versao = proc?.version;
  return versao === undefined ? 'runtime não identificado' : `Node ${versao}`;
}

/** `navigator.userAgent`, ou `null` quando não há objeto de navegador. */
function userAgentPadrao(): string | null {
  const nav = globalThis.navigator as { userAgent?: string } | undefined;
  const ua = nav?.userAgent;
  return typeof ua === 'string' && ua.length > 0 ? ua : null;
}

/**
 * Captura o ambiente de apuração.
 *
 * ⚠️ **`jsdom` não é declarado como navegador.** Um `userAgent` que contenha
 * `jsdom` marca `ehNavegadorReal: false` e o texto do campo diz o que é. Chamar
 * `jsdom` de navegador no relatório levaria alguém a ler o tempo de `draw()`
 * como tempo de quadro, que é justamente o que ele não é.
 */
export function capturarAmbiente(
  viewport: ViewportDaApuracao,
  fonte?: FonteDeAmbiente,
): AmbienteBancada {
  const maquina = fonte?.maquina?.() ?? {
    plataforma: os.platform(),
    arquitetura: os.arch(),
    host: os.hostname(),
  };

  const cpu =
    fonte?.cpu?.() ??
    (() => {
      const lista = os.cpus();
      const primeiro = lista[0];
      return {
        modelo: primeiro === undefined ? 'processador não reportado' : primeiro.model.trim(),
        nucleos: lista.length,
      };
    })();

  const memoriaBytes = fonte?.memoriaBytes?.() ?? os.totalmem();
  const ua = (fonte?.userAgent ?? userAgentPadrao)();
  const ehJsdom = ua !== null && ua.toLowerCase().includes('jsdom');

  const navegador =
    ua === null
      ? 'sem objeto de navegador (execução em Node puro)'
      : ehJsdom
        ? `jsdom — NÃO é navegador real (${ua})`
        : ua;

  return {
    maquina: `${maquina.plataforma}/${maquina.arquitetura} · ${maquina.host}`,
    cpu: cpu.modelo,
    nucleos: cpu.nucleos,
    memoriaGiB: Math.round((memoriaBytes / (1_024 * 1_024 * 1_024)) * 10) / 10,
    runtime: (fonte?.runtime ?? runtimePadrao)(),
    navegador,
    ehNavegadorReal: ua !== null && !ehJsdom,
    viewport: { larguraPx: viewport.larguraPx, alturaPx: viewport.alturaPx },
    relogio: nomeDoRelogio(),
    capturadoEm: (fonte?.agora?.() ?? new Date()).toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Relatório
// ═════════════════════════════════════════════════════════════════════════════

/** Orçamento de um alvo, em milissegundos, com a origem no requisito. */
export interface OrcamentoDeAlvo {
  readonly nome: string;
  readonly tetoMs: number;
  /** Critério de aceitação que fixa o teto, para o relatório citar. */
  readonly requisito: string;
}

function ms(valor: number): string {
  if (!Number.isFinite(valor)) return '     —';
  return valor.toFixed(3).padStart(6);
}

/**
 * Relatório em texto: bloco de ambiente e tabela de medições.
 *
 * Formato de tabela e não de prosa porque é o que se cola num registro e se
 * compara com a apuração seguinte. Toda linha declara as repetições e o
 * descarte usados, então uma medição fora do protocolo não se disfarça de
 * medição dentro dele.
 */
export function formatarRelatorio(
  ambiente: AmbienteBancada,
  medicoes: readonly MedicaoBancada[],
  orcamentos?: readonly OrcamentoDeAlvo[],
): string {
  const linhas: string[] = [];
  const tetoPorNome = new Map<string, OrcamentoDeAlvo>();
  for (const o of orcamentos ?? []) tetoPorNome.set(o.nome, o);

  linhas.push('═'.repeat(96));
  linhas.push('BANCADA DE DESEMPENHO — bookmap no mapa de decisão');
  linhas.push('═'.repeat(96));
  linhas.push('');
  linhas.push('AMBIENTE DE APURAÇÃO (requisito 9.2)');
  linhas.push(`  máquina .......... ${ambiente.maquina}`);
  linhas.push(`  processador ...... ${ambiente.cpu} (${ambiente.nucleos} lógicos)`);
  linhas.push(`  memória .......... ${ambiente.memoriaGiB} GiB`);
  linhas.push(`  runtime .......... ${ambiente.runtime}`);
  linhas.push(`  navegador ........ ${ambiente.navegador}`);
  linhas.push(
    `  viewport ......... ${ambiente.viewport.larguraPx} × ${ambiente.viewport.alturaPx} px (fixo)`,
  );
  linhas.push(`  relógio .......... ${ambiente.relogio}`);
  linhas.push(`  capturado em ..... ${ambiente.capturadoEm}`);

  if (!ambiente.ehNavegadorReal) {
    linhas.push('');
    linhas.push(
      '  ⚠️ Sem navegador real: uma medição de passada de desenho aqui NÃO inclui',
    );
    linhas.push(
      '     rasterização nem composição. O tempo é o trabalho da própria camada.',
    );
  }

  linhas.push('');
  linhas.push(
    'PROTOCOLO (requisito 9.1): ' +
      `${BANCADA_REPETICOES} repetições · descarta as ${BANCADA_DESCARTADAS} primeiras · ` +
      `percentil ${BANCADA_QUANTIL * 100} das ${BANCADA_CONSIDERADAS} restantes ` +
      '(posto ⌈q·n⌉−1)',
  );
  linhas.push('');
  linhas.push(
    'alvo                                     apurado    teto  situação   mín  mediana     máx  rep',
  );
  linhas.push('─'.repeat(96));

  for (const m of medicoes) {
    const orc = tetoPorNome.get(m.nome);
    const teto = orc === undefined ? '    —' : orc.tetoMs.toFixed(1).padStart(5);
    const situacao =
      orc === undefined
        ? '   —   '
        : !Number.isFinite(m.apuradoMs)
          ? '  ?    '
          : m.apuradoMs <= orc.tetoMs
            ? ' DENTRO'
            : ' ESTOUR';
    const marca = m.protocoloDeclarado ? '' : ' ⚠fora-do-protocolo';

    linhas.push(
      `${m.nome.slice(0, 38).padEnd(38)} ${ms(m.apuradoMs)} ${teto} ${situacao} ` +
        `${ms(m.minMs)} ${ms(m.medianaMs)} ${ms(m.maxMs)} ` +
        `${String(m.repeticoes).padStart(3)}/${String(m.descartadas)}${marca}`,
    );
  }

  linhas.push('─'.repeat(96));

  const fora = medicoes.filter((m) => !m.protocoloDeclarado);
  if (fora.length > 0) {
    linhas.push('');
    linhas.push(
      `⚠️ ${fora.length} medição(ões) fora do protocolo declarado — não apresentar como apuração.`,
    );
  }

  for (const o of orcamentos ?? []) {
    const m = medicoes.find((x) => x.nome === o.nome);
    if (m === undefined) continue;
    linhas.push(`  ${o.nome}: teto ${o.tetoMs} ms — ${o.requisito}`);
  }

  return linhas.join('\n');
}
