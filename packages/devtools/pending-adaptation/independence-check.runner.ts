/**
 * `independence-check.runner` — o executor da `Independence_Check`.
 * Spec `bookmap-no-mapa-de-decisao`, tarefa 11.2. Requisitos 12.9 e 12.11.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O núcleo puro (`independence-check.core`) sabe decidir "isto é violação?" a
 * partir de uma lista de arquivos **já resolvida**. Este executor é quem resolve
 * essa lista: consulta o repositório, lê o disco, recorta linhas e percorre
 * importações. É a única peça da verificação que toca I/O.
 *
 * Divide-se em três escopos, que são exatamente os três do requisito 12.9:
 *
 * | Escopo | O que entra | Alcance |
 * |---|---|---|
 * | criado pela feature | todo arquivo que a feature trouxe | **integral** |
 * | preexistente tocado | os quatro arquivos nomeados no 12.9 | **só as linhas adicionadas ou alteradas** |
 * | fechamento das importações | módulos do repositório alcançados pelas importações da feature | integral |
 *
 * A terceira coluna é o ponto sensível: nos quatro arquivos preexistentes, as
 * linhas que já estavam lá **ficam fora do alcance**, e isso não é conveniência.
 * O `page.tsx` do mapa de decisão tem, em prosa preexistente, uma linha que cita
 * a porta de uma bridge e outra que escreve o número da conta real — duas
 * ocorrências que o núcleo marca corretamente como proibidas. Inspecionar o
 * arquivo inteiro reprovaria a feature por texto que ela não escreveu. O recorte
 * é o que torna a verificação verdadeira em vez de apenas severa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LINHA DE BASE, E POR QUE ESTE REF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `REF_LINHA_DE_BASE` é o commit que era `HEAD` quando esta feature começou.
 * Toda a feature está fora de commit, então esse ref é, literalmente, a árvore
 * de antes dela.
 *
 * Registrar o identificador do commit — e não `HEAD` — é deliberado: quando a
 * feature for enfim commitada, `HEAD` passa a **conter** a feature e o recorte
 * de linhas adicionadas viraria vazio, aprovando por omissão. O identificador
 * fixo continua sendo ancestral, e a comparação continua devolvendo as mesmas
 * linhas adicionadas depois do commit. Ou seja: o ref fixo é o que faz esta
 * verificação sobreviver ao próprio commit da feature.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O CASO DURO — UM DOS QUATRO ARQUIVOS NÃO TEM LINHA DE BASE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fato verificado no repositório: `src/bookmap/` é **inteiramente não
 * rastreado**, e nenhum commit em nenhum ref jamais o conteve. Logo o
 * `bookmap.controller.ts`, que o requisito 12.9 nomeia entre os preexistentes,
 * **não existe na linha de base**.
 *
 * A consequência é tratada por uma regra única, sem exceção para arquivo algum:
 *
 * - arquivo **ausente** da linha de base ⇒ toda linha dele é linha adicionada
 *   ⇒ inspeção **integral**;
 * - arquivo **presente** e diferente ⇒ apenas as linhas que a comparação apontar.
 *
 * Para o `bookmap.controller.ts` isso significa inspeção integral, que é o
 * desfecho **mais** rigoroso, não o mais frouxo: nenhuma linha escapa. O
 * conjunto de linhas preexistentes dele, medido contra a linha de base
 * registrada, é vazio — então nada é mantido fora do alcance, e o requisito 12.9
 * continua satisfeito por construção.
 *
 * ⚠️ **Mas o mesmo raciocínio não pode valer para as importações.** Um controller
 * de NestJS preexistente já está ligado ao grafo de injeção da aplicação. Tratar
 * todas as importações dele como "adicionadas pela feature" faz o fechamento
 * transitivo sair de 6 para **453 módulos** e alcançar o backend de execução
 * inteiro — a medição passa a descrever o grafo da aplicação, não a pegada da
 * feature. Medido: uma única dependência preexistente do controller responde por
 * 448 desses módulos sozinha.
 *
 * O requisito 12.9 é preciso quanto a isso: o fechamento é das importações que
 * esta feature **adicionar**. Uma dependência que o controller já tinha antes da
 * feature não é dela. Daí `MODULOS_FORA_DO_ALCANCE`, que registra essas
 * dependências preexistentes com justificativa, uma a uma, e é guardado contra
 * apodrecimento: se um registro deixar de existir no disco, ou deixar de ser
 * importado por quem o justificava, a verificação declara indeterminação em vez
 * de seguir com um registro que não descreve mais a realidade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDETERMINAÇÃO É VIOLAÇÃO (requisito 12.11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nada aqui aprova em silêncio. Toda condição abaixo produz
 * `violacaoDeIndeterminacao` e, portanto, reprova:
 *
 * - o repositório não pôde ser consultado (comando indisponível, erro, timeout);
 * - o ref de linha de base não resolve;
 * - um arquivo registrado não existe no disco, ou não pôde ser lido;
 * - um arquivo registrado como criado **existe** na linha de base (o registro
 *   está errado: ele não é criado por esta feature);
 * - um arquivo registrado como preexistente e tocado não tem **nenhuma** linha
 *   adicionada (o registro apodreceu);
 * - a raiz de diretório registrada como criada pela feature não existe;
 * - um registro de `MODULOS_FORA_DO_ALCANCE` apodreceu;
 * - um especificador de importação do próprio repositório não pôde ser resolvido
 *   para um arquivo — não se inspeciona o que não se acha;
 * - o conjunto final ficou vazio.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTAS DE IMPLEMENTAÇÃO QUE NÃO SÃO ÓBVIAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Caminho com colchete.** O `page.tsx` mora sob um diretório cujo nome tem
 * colchetes. Colchete é metacaractere em expressão regular **e** em pathspec do
 * repositório, onde `[symbol]` significa "um caractere entre s, y, m, b, o, l".
 * Por isso: nenhum caminho deste arquivo é transformado em expressão ou em
 * padrão de glob — a comparação é sempre igualdade de texto — e todo pathspec
 * passa com a magia `:(literal)`, que desliga a interpretação de curinga.
 *
 * **Extração de importação reusa o núcleo.** Em vez de uma expressão regular
 * própria sobre o arquivo cru — que colheria um `from '...'` escrito dentro de um
 * comentário e puxaria um módulo inexistente para o fechamento —, o executor
 * chama `classificarRegioes` e lê apenas os trechos que o núcleo classificou como
 * especificador de importação. A mesma classificação que protege a inspeção de
 * falso positivo protege aqui a montagem do grafo.
 *
 * **Ciclo.** O grafo de importação deste projeto tem ciclo, e travessia ingênua
 * não terminaria. A travessia é em largura com conjunto de visitados, e um
 * módulo entra no conjunto antes de ser expandido.
 *
 * **Conteúdo integral mesmo quando o alcance é recortado.** O núcleo exige o
 * arquivo completo junto do recorte de linhas, porque saber se a linha 4.000 cai
 * dentro de um comentário de bloco aberto na 3.900 exige o texto todo. Este
 * executor sempre entrega o conteúdo integral e deixa o recorte para o campo
 * `linhas`.
 *
 * **Portas injetáveis.** Processo e sistema de arquivos entram por parâmetro, com
 * o comportamento real como padrão. É o que permite à spec da tarefa 11.3 provar
 * a indeterminação sem quebrar o repositório: basta injetar uma porta de processo
 * que falha.
 *
 * Convenções: identificadores em inglês, comentários e texto ao operador em
 * pt-BR. Tipos saem por `export type` porque o projeto compila com
 * `isolatedModules`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REGIAO,
  checkIndependence,
  classificarRegioes,
  formatarViolacoes,
  violacaoDeIndeterminacao,
  type ArquivoParaInspecao,
  type ResultadoIndependencia,
  type ViolacaoIndependencia,
} from './independence-check.core';

// ═════════════════════════════════════════════════════════════════════════════
// A linha de base registrada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O commit que era `HEAD` quando esta feature começou — a árvore de antes dela.
 *
 * Ver a seção correspondente no cabeçalho: o identificador é fixo de propósito,
 * para que a comparação continue apontando as mesmas linhas adicionadas depois
 * de a feature ser commitada.
 */
export const REF_LINHA_DE_BASE = 'd928846d302f797c701bd1e1369a9f0edb700eda';

// ═════════════════════════════════════════════════════════════════════════════
// O inventário registrado
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Diretórios que **não existiam** antes desta feature. Tudo abaixo deles é da
 * feature, então o conteúdo é derivado por varredura em vez de listado à mão —
 * um arquivo novo aqui entra na verificação sozinho, sem ninguém lembrar de
 * registrá-lo.
 */
const RAIZES_CRIADAS: readonly string[] = [
  'frontend/src/components/decision/bookmap',
];

/**
 * Arquivos criados pela feature em diretórios que **a precedem**.
 *
 * Aqui a derivação por varredura não serve, e a razão é concreta: `src/bookmap/`
 * já existia (veio da spec de microestrutura) e é inteiramente não rastreado,
 * então "não está na linha de base" não distingue o que esta feature criou do
 * que a spec anterior criou. Varrer o diretório arrastaria o agregador de linha
 * de comando, que grava nas tabelas de bookmap por projeto — e que o requisito
 * 12.3 preserva justamente como o único produtor legítimo delas. Ele não é desta
 * feature e não pode ser julgado como se fosse.
 *
 * Cada entrada é guardada: precisa existir no disco e precisa estar **ausente**
 * da linha de base. Um registro que falhe em qualquer das duas condições produz
 * indeterminação.
 */
const ARQUIVOS_CRIADOS: readonly string[] = [
  'src/bookmap/bookmap-columnar.core.ts',
  'src/bookmap/bookmap.service.ts',
  'src/bookmap/__tests__/bookmap-columnar.core.spec.ts',
  'src/bookmap/__tests__/bookmap-contrato-preservado.spec.ts',
  'src/bookmap/__tests__/bookmap-cobertura-depth.spec.ts',
  'src/bookmap/__tests__/bookmap-inviolaveis.spec.ts',
  'frontend/src/app/trading/decision/[symbol]/_components/BookmapWallsCard.tsx',
  'frontend/src/app/trading/decision/[symbol]/__tests__/BookmapWallsCard.test.tsx',
  'frontend/src/components/trading/__tests__/TradingChart.bookmap-paridade.spec.tsx',
  'frontend/vitest.bancada.config.ts',
];

/**
 * Os quatro arquivos que o requisito 12.9 nomeia: existiam antes, a feature os
 * tocou, e só as linhas tocadas entram no alcance.
 */
const ARQUIVOS_PREEXISTENTES: readonly string[] = [
  'src/bookmap/bookmap.controller.ts',
  'frontend/src/components/trading/TradingChart.tsx',
  'frontend/src/app/trading/decision/[symbol]/_components/chart-indicator-panel.tsx',
  'frontend/src/app/trading/decision/[symbol]/page.tsx',
];

/** Uma dependência preexistente que o fechamento não deve seguir. */
interface ModuloForaDoAlcance {
  /** Caminho do módulo, relativo à raiz do repositório. */
  readonly caminho: string;
  /** Quem o importa, e é por isso que ele apareceria no fechamento. */
  readonly importadoPor: string;
  /** Por que ele não é uma importação **adicionada por esta feature**. */
  readonly porque: string;
}

/**
 * Dependências que já existiam antes desta feature e que, por isso, ficam fora
 * do fechamento transitivo do requisito 12.9 — que é o fechamento das
 * importações **adicionadas** por ela.
 *
 * ⚠️ Esta lista é curta de propósito e cada item carrega justificativa. Ela é o
 * único ponto do executor em que a fronteira é declarada em vez de derivada, e é
 * declarada porque a linha de base não a expressa: o arquivo que importa a
 * dependência também não está na linha de base, então a comparação não consegue
 * dizer se a importação é antiga ou nova.
 */
const MODULOS_FORA_DO_ALCANCE: readonly ModuloForaDoAlcance[] = [
  {
    caminho: 'src/bookmap/live-book-persistence.service.ts',
    importadoPor: 'src/bookmap/bookmap.controller.ts',
    porque:
      'serviço da spec de microestrutura, anterior a esta feature: sustenta o ' +
      'endpoint de heatmap de nível 1, cujo comportamento o requisito 12.5 manda ' +
      'preservar idêntico. Como todo serviço de NestJS, ele alcança o grafo de ' +
      'injeção da aplicação — 448 módulos medidos — e seguir por ele mediria a ' +
      'aplicação, não a feature.',
  },
];

/** Extensões que o executor trata como módulo de código. */
const EXTENSOES_DE_MODULO: readonly string[] = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Extensões que entram na inspeção sem serem módulo.
 *
 * O requisito 12.9 fala da **totalidade** de cada arquivo criado, e o material de
 * bancada versionado junto (documentação e fixture) é arquivo criado por esta
 * feature. Entram, portanto. Não são módulo: não têm importação e nunca semeiam
 * o fechamento.
 */
const EXTENSOES_ACOMPANHANTES: readonly string[] = ['.md', '.json'];

/** Diretórios que a varredura nunca desce. */
const DIRETORIOS_IGNORADOS: readonly string[] = [
  'node_modules',
  '.next',
  '.git',
  'dist',
  'coverage',
];

// ═════════════════════════════════════════════════════════════════════════════
// Portas injetáveis
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Executa um programa e devolve a saída padrão.
 *
 * Deve **lançar** quando o programa falha — é assim que a indisponibilidade do
 * repositório chega ao executor e vira indeterminação.
 */
export type PortaDeProcesso = (
  programa: string,
  argumentos: readonly string[],
  diretorio: string,
) => string;

/** O mínimo de sistema de arquivos que o executor usa. */
export interface PortaDeArquivos {
  existe(caminho: string): boolean;
  ehDiretorio(caminho: string): boolean;
  ler(caminho: string): string;
  listar(caminho: string): readonly string[];
}

/** Tempo máximo de um comando de consulta ao repositório. */
const TEMPO_MAXIMO_MS = 30_000;

const processoReal: PortaDeProcesso = (programa, argumentos, diretorio) =>
  execFileSync(programa, [...argumentos], {
    cwd: diretorio,
    encoding: 'utf8',
    timeout: TEMPO_MAXIMO_MS,
    maxBuffer: 64 * 1024 * 1024,
    // A saída de erro não vai para o terminal: o desfecho é a exceção, e o
    // ruído de um comando que falha de propósito na spec da 11.3 só confundiria.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const arquivosReais: PortaDeArquivos = {
  existe: (caminho) => existsSync(caminho),
  ehDiretorio: (caminho) => {
    try {
      return statSync(caminho).isDirectory();
    } catch {
      return false;
    }
  },
  ler: (caminho) => readFileSync(caminho, 'utf8'),
  listar: (caminho) => readdirSync(caminho),
};

// ═════════════════════════════════════════════════════════════════════════════
// Opções e diagnóstico
// ═════════════════════════════════════════════════════════════════════════════

/** Como o alcance de um arquivo foi decidido. */
export type Alcance = 'INTEGRAL' | 'LINHAS_ADICIONADAS';

/** A que escopo do requisito 12.9 o arquivo pertence. */
export type Origem = 'CRIADO' | 'PREEXISTENTE' | 'FECHAMENTO';

/** Um arquivo que entrou no conjunto, com o porquê do seu alcance. */
export interface ArquivoResolvido {
  /** Caminho relativo à raiz do repositório, com barra normal. */
  readonly caminho: string;
  readonly origem: Origem;
  readonly alcance: Alcance;
  /** Quantas linhas entraram no alcance; `null` quando é o arquivo inteiro. */
  readonly linhasNoAlcance: number | null;
  /** Total de linhas do arquivo. Com o campo acima, mostra o tamanho do recorte. */
  readonly linhasNoArquivo: number;
}

/** O que o executor apurou. Serve à mensagem e à inspeção pela suíte. */
export interface DiagnosticoDaResolucao {
  readonly refLinhaDeBase: string;
  /** O identificador completo em que o ref resolveu. */
  readonly refResolvidoPara: string;
  readonly arquivos: readonly ArquivoResolvido[];
  /** Módulos do repositório alcançados pelo fechamento, em ordem de descoberta. */
  readonly modulosDoFechamento: readonly string[];
  /** Especificadores externos ignorados, sem repetição. */
  readonly especificadoresExternos: readonly string[];
  readonly modulosForaDoAlcance: readonly string[];
}

/** Ajustes do executor. Sem nenhum deles, roda contra o repositório real. */
export interface OpcoesDoExecutor {
  /** Raiz do repositório. Padrão: derivada da localização deste arquivo. */
  readonly raizDoRepositorio?: string;
  /** Ref de linha de base. Padrão: `REF_LINHA_DE_BASE`. */
  readonly refLinhaDeBase?: string;
  readonly processo?: PortaDeProcesso;
  readonly arquivos?: PortaDeArquivos;
  /**
   * Recortar os arquivos preexistentes às linhas adicionadas. Padrão `true`, que
   * é o comportamento exigido pelo requisito 12.9.
   *
   * Existe em `false` para a spec da tarefa 11.3 poder **demonstrar** que o
   * recorte é indispensável: sem ele, a prosa preexistente do `page.tsx`
   * reprova a feature.
   */
  readonly recortarPreexistentes?: boolean;
}

/** O conjunto resolvido, pronto para o núcleo. */
export interface ConjuntoResolvido {
  readonly paraInspecao: readonly ArquivoParaInspecao[];
  /** Indeterminações apuradas na resolução. Não vazio ⇒ a verificação reprova. */
  readonly indeterminacoes: readonly ViolacaoIndependencia[];
  /** `null` quando a resolução não avançou o bastante para diagnosticar. */
  readonly diagnostico: DiagnosticoDaResolucao | null;
}

/** O desfecho do executor: o do núcleo, mais o que foi inspecionado. */
export interface ResultadoDoExecutor {
  readonly aprovado: boolean;
  readonly violacoes: readonly ViolacaoIndependencia[];
  readonly arquivosInspecionados: number;
  readonly diagnostico: DiagnosticoDaResolucao | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Caminhos
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A raiz do repositório, deduzida da localização deste arquivo.
 *
 * Este arquivo mora em `frontend/src/components/decision/bookmap`, cinco níveis
 * abaixo da raiz.
 */
function raizPadrao(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
}

/** Junta a raiz com um caminho relativo em barra normal. */
function caminhoAbsoluto(raiz: string, relativo: string): string {
  const partes = relativo.split('/');
  let atual = raiz;
  for (let i = 0; i < partes.length; i += 1) {
    const parte = partes[i];
    if (parte !== undefined && parte !== '') atual = join(atual, parte);
  }
  return atual;
}

/** Normaliza um caminho absoluto para a forma relativa com barra normal. */
function paraRelativo(raiz: string, absoluto: string): string {
  const raizNormal = raiz.split('\\').join('/');
  const alvo = absoluto.split('\\').join('/');
  const prefixo = raizNormal.endsWith('/') ? raizNormal : `${raizNormal}/`;
  return alvo.indexOf(prefixo) === 0 ? alvo.slice(prefixo.length) : alvo;
}

/** A extensão do caminho, em minúsculas, com o ponto. Vazio se não houver. */
function extensaoDe(caminho: string): string {
  const barra = caminho.lastIndexOf('/');
  const nome = barra >= 0 ? caminho.slice(barra + 1) : caminho;
  const ponto = nome.lastIndexOf('.');
  return ponto <= 0 ? '' : nome.slice(ponto).toLowerCase();
}

function ehModulo(caminho: string): boolean {
  return EXTENSOES_DE_MODULO.indexOf(extensaoDe(caminho)) >= 0;
}

function ehAcompanhante(caminho: string): boolean {
  return EXTENSOES_ACOMPANHANTES.indexOf(extensaoDe(caminho)) >= 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Consulta ao repositório
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Um pathspec que o repositório trata como texto literal.
 *
 * ⚠️ Sem a magia `:(literal)`, `[symbol]` no caminho do `page.tsx` seria lido
 * como classe de caracteres — "um caractere entre s, y, m, b, o, l" — e não
 * casaria com o diretório de nome `[symbol]`.
 */
function pathspecLiteral(relativo: string): string {
  return `:(literal)${relativo}`;
}

/** O que se conseguiu apurar do repositório, ou o motivo de não ter dado. */
interface ConsultaAoRepositorio {
  readonly refResolvido: string | null;
  readonly motivoDaFalha: string | null;
}

function resolverRef(
  processo: PortaDeProcesso,
  raiz: string,
  ref: string,
): ConsultaAoRepositorio {
  try {
    const saida = processo('git', ['rev-parse', '--verify', `${ref}^{commit}`], raiz);
    const identificador = saida.split('\n')[0];
    const limpo = identificador === undefined ? '' : identificador.trim();
    if (limpo === '') {
      return {
        refResolvido: null,
        motivoDaFalha: `o ref de linha de base «${ref}» resolveu para vazio.`,
      };
    }
    return { refResolvido: limpo, motivoDaFalha: null };
  } catch (erro) {
    return {
      refResolvido: null,
      motivoDaFalha:
        `o repositório não pôde ser consultado para resolver o ref de linha de base ` +
        `«${ref}»: ${mensagemDe(erro)}. Sem linha de base não há como distinguir ` +
        `linha adicionada de linha preexistente.`,
    };
  }
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error && erro.message !== '') return erro.message;
  return String(erro);
}

/** O arquivo existe na linha de base? `null` quando não se pôde apurar. */
function existeNaLinhaDeBase(
  processo: PortaDeProcesso,
  raiz: string,
  ref: string,
  relativo: string,
): boolean | null {
  try {
    processo('git', ['cat-file', '-e', `${ref}:${relativo}`], raiz);
    return true;
  } catch (erro) {
    // O comando falha tanto por ausência do arquivo — o caso comum e esperado —
    // quanto por problema real. A mensagem distingue: ausência menciona o
    // caminho; falha de repositório, não.
    const texto = mensagemDe(erro);
    if (
      texto.indexOf('does not exist') >= 0 ||
      texto.indexOf('exists on disk, but not in') >= 0 ||
      texto.indexOf('Not a valid object name') >= 0 ||
      texto.indexOf('bad revision') >= 0 ||
      texto.indexOf('no such path') >= 0
    ) {
      return false;
    }
    return null;
  }
}

/**
 * As linhas do arquivo no disco que foram adicionadas ou alteradas em relação à
 * linha de base.
 *
 * Lê os cabeçalhos de trecho da comparação sem contexto: em `@@ -a,b +c,d @@`, o
 * lado `+` dá a primeira linha e a quantidade no arquivo atual. `d` ausente
 * significa uma linha; `d` igual a zero é remoção pura e não adiciona nada.
 */
function linhasAdicionadas(
  processo: PortaDeProcesso,
  raiz: string,
  ref: string,
  relativo: string,
): { linhas: readonly number[] | null; motivoDaFalha: string | null } {
  let saida: string;
  try {
    saida = processo(
      'git',
      ['diff', '--unified=0', '--no-color', '--no-ext-diff', ref, '--', pathspecLiteral(relativo)],
      raiz,
    );
  } catch (erro) {
    return {
      linhas: null,
      motivoDaFalha:
        `a comparação com a linha de base falhou para este arquivo: ${mensagemDe(erro)}.`,
    };
  }

  const encontradas: number[] = [];
  const linhasDaSaida = saida.split('\n');
  for (let i = 0; i < linhasDaSaida.length; i += 1) {
    const linha = linhasDaSaida[i];
    if (linha === undefined || linha.indexOf('@@') !== 0) continue;
    const cabecalho = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(linha);
    if (cabecalho === null) continue;
    const inicioTexto = cabecalho[1];
    if (inicioTexto === undefined) continue;
    const inicio = Number.parseInt(inicioTexto, 10);
    const quantidadeTexto = cabecalho[2];
    const quantidade =
      quantidadeTexto === undefined ? 1 : Number.parseInt(quantidadeTexto, 10);
    if (!Number.isFinite(inicio) || !Number.isFinite(quantidade)) continue;
    for (let n = 0; n < quantidade; n += 1) encontradas.push(inicio + n);
  }

  return { linhas: encontradas, motivoDaFalha: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// Importações e fechamento transitivo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Os especificadores de importação do arquivo, na ordem em que aparecem.
 *
 * Reusa `classificarRegioes` do núcleo e colhe apenas os trechos classificados
 * como especificador de importação. É o que impede um `from '...'` escrito dentro
 * de um comentário de virar aresta do grafo.
 */
export function especificadoresDeImportacao(conteudo: string): readonly string[] {
  const marcas = classificarRegioes(conteudo);
  const achados: string[] = [];
  let i = 0;

  while (i < marcas.length) {
    if (marcas[i] !== REGIAO.IMPORTACAO) {
      i += 1;
      continue;
    }
    let fim = i;
    while (fim < marcas.length && marcas[fim] === REGIAO.IMPORTACAO) fim += 1;
    // O trecho inclui as aspas de abertura e de fechamento, que a classificação
    // marca junto do conteúdo. Sai o miolo.
    const bruto = conteudo.slice(i, fim);
    const semAspas = bruto.replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (semAspas !== '') achados.push(semAspas);
    i = fim;
  }

  return achados;
}

/** Um especificador aponta para o próprio repositório? */
function ehDoRepositorio(especificador: string): boolean {
  if (especificador.indexOf('@/') === 0) return true;
  if (especificador.indexOf('./') === 0) return true;
  if (especificador.indexOf('../') === 0) return true;
  return especificador === '.' || especificador === '..';
}

/**
 * Resolve um especificador do repositório para um caminho relativo à raiz.
 *
 * Cobre o apelido `@` para a pasta de fonte do frontend, extensão implícita e
 * arquivo de índice de diretório. Devolve `null` quando nada casa — e quem chama
 * trata isso como indeterminação, porque não se inspeciona o que não se acha.
 */
function resolverEspecificador(
  arquivos: PortaDeArquivos,
  raiz: string,
  deArquivoRelativo: string,
  especificador: string,
): string | null {
  let baseRelativa: string;

  if (especificador.indexOf('@/') === 0) {
    baseRelativa = `frontend/src/${especificador.slice(2)}`;
  } else {
    const diretorioDoImportador = deArquivoRelativo.split('/').slice(0, -1).join('/');
    baseRelativa = normalizarRelativo(`${diretorioDoImportador}/${especificador}`);
  }

  const candidatos: string[] = [baseRelativa];

  // Um especificador escrito com `.js` pode designar o `.ts` correspondente.
  const extensao = extensaoDe(baseRelativa);
  if (extensao === '.js' || extensao === '.jsx') {
    const semExtensao = baseRelativa.slice(0, baseRelativa.length - extensao.length);
    candidatos.push(`${semExtensao}.ts`, `${semExtensao}.tsx`);
  }

  for (let i = 0; i < EXTENSOES_DE_MODULO.length; i += 1) {
    const ext = EXTENSOES_DE_MODULO[i];
    if (ext !== undefined) candidatos.push(`${baseRelativa}${ext}`);
  }
  for (let i = 0; i < EXTENSOES_DE_MODULO.length; i += 1) {
    const ext = EXTENSOES_DE_MODULO[i];
    if (ext !== undefined) candidatos.push(`${baseRelativa}/index${ext}`);
  }

  for (let i = 0; i < candidatos.length; i += 1) {
    const candidato = candidatos[i];
    if (candidato === undefined) continue;
    const absoluto = caminhoAbsoluto(raiz, candidato);
    if (arquivos.existe(absoluto) && !arquivos.ehDiretorio(absoluto)) return candidato;
  }

  return null;
}

/** Resolve `.` e `..` de um caminho relativo em barra normal. */
function normalizarRelativo(caminho: string): string {
  const saida: string[] = [];
  const partes = caminho.split('/');
  for (let i = 0; i < partes.length; i += 1) {
    const parte = partes[i];
    if (parte === undefined || parte === '' || parte === '.') continue;
    if (parte === '..') {
      if (saida.length > 0) saida.pop();
      continue;
    }
    saida.push(parte);
  }
  return saida.join('/');
}

// ═════════════════════════════════════════════════════════════════════════════
// Varredura de diretório
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Todo arquivo sob a raiz dada, em ordem estável.
 *
 * A ordenação existe para o determinismo do relatório: a mesma árvore produz a
 * mesma lista, na mesma ordem, em qualquer sistema de arquivos.
 */
function varrer(
  arquivos: PortaDeArquivos,
  raizDoRepositorio: string,
  relativoDaRaiz: string,
): readonly string[] {
  const encontrados: string[] = [];
  const pilha: string[] = [relativoDaRaiz];

  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (atual === undefined) continue;
    const absoluto = caminhoAbsoluto(raizDoRepositorio, atual);
    let entradas: readonly string[];
    try {
      entradas = arquivos.listar(absoluto);
    } catch {
      continue;
    }
    const ordenadas = [...entradas].sort();
    for (let i = 0; i < ordenadas.length; i += 1) {
      const nome = ordenadas[i];
      if (nome === undefined || nome === '') continue;
      if (DIRETORIOS_IGNORADOS.indexOf(nome) >= 0) continue;
      const filhoRelativo = `${atual}/${nome}`;
      const filhoAbsoluto = caminhoAbsoluto(raizDoRepositorio, filhoRelativo);
      if (arquivos.ehDiretorio(filhoAbsoluto)) pilha.push(filhoRelativo);
      else encontrados.push(filhoRelativo);
    }
  }

  return [...encontrados].sort();
}

// ═════════════════════════════════════════════════════════════════════════════
// Resolução do conjunto
// ═════════════════════════════════════════════════════════════════════════════

/** Quantas linhas o texto tem, contando a última mesmo sem quebra final. */
function contarLinhas(conteudo: string): number {
  if (conteudo === '') return 0;
  let n = 1;
  for (let i = 0; i < conteudo.length; i += 1) {
    if (conteudo.charAt(i) === '\n') n += 1;
  }
  return n;
}

/** Estado da montagem do conjunto, para não passar dez parâmetros adiante. */
interface Montagem {
  readonly raiz: string;
  readonly arquivos: PortaDeArquivos;
  readonly processo: PortaDeProcesso;
  readonly ref: string;
  readonly paraInspecao: ArquivoParaInspecao[];
  readonly indeterminacoes: ViolacaoIndependencia[];
  readonly resolvidos: ArquivoResolvido[];
  /** Caminhos já no conjunto, para não inspecionar duas vezes. */
  readonly jaNoConjunto: Set<string>;
}

/** Lê um arquivo, registrando indeterminação quando não dá. */
function lerOuIndeterminar(m: Montagem, relativo: string): string | null {
  const absoluto = caminhoAbsoluto(m.raiz, relativo);
  if (!m.arquivos.existe(absoluto)) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        'o arquivo está registrado no inventário da verificação mas não existe no ' +
          'disco: o conjunto a inspecionar não pôde ser determinado.',
        relativo,
      ),
    );
    return null;
  }
  try {
    return m.arquivos.ler(absoluto);
  } catch (erro) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        `o arquivo não pôde ser lido: ${mensagemDe(erro)}.`,
        relativo,
      ),
    );
    return null;
  }
}

/** Acrescenta um arquivo ao conjunto com alcance integral. */
function acrescentarIntegral(m: Montagem, relativo: string, origem: Origem): void {
  if (m.jaNoConjunto.has(relativo)) return;
  const conteudo = lerOuIndeterminar(m, relativo);
  if (conteudo === null) return;
  m.jaNoConjunto.add(relativo);
  m.paraInspecao.push({ arquivo: relativo, conteudo, linhas: null });
  m.resolvidos.push({
    caminho: relativo,
    origem,
    alcance: 'INTEGRAL',
    linhasNoAlcance: null,
    linhasNoArquivo: contarLinhas(conteudo),
  });
}

/**
 * Acrescenta um dos quatro arquivos preexistentes, recortado às linhas que a
 * feature adicionou ou alterou.
 *
 * Devolve os especificadores de importação que estão **nessas** linhas — são
 * eles, e só eles, que semeiam o fechamento por este arquivo, porque o requisito
 * 12.9 pede o fechamento das importações que a feature **adicionar**.
 */
function acrescentarRecortado(
  m: Montagem,
  relativo: string,
  recortar: boolean,
): readonly string[] {
  if (m.jaNoConjunto.has(relativo)) return [];

  const conteudo = lerOuIndeterminar(m, relativo);
  if (conteudo === null) return [];

  const presente = existeNaLinhaDeBase(m.processo, m.raiz, m.ref, relativo);
  if (presente === null) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        'não foi possível apurar no repositório se este arquivo existe na linha de ' +
          'base, então o recorte de linhas adicionadas não pôde ser determinado.',
        relativo,
      ),
    );
    return [];
  }

  // Ausente da linha de base ⇒ nenhuma linha dele é preexistente ⇒ integral.
  // Ver a seção do cabeçalho sobre o arquivo sem linha de base.
  if (!presente || !recortar) {
    acrescentarIntegral(m, relativo, 'PREEXISTENTE');
    // As importações de um arquivo sem linha de base não são, por si, prova de
    // que a feature as adicionou. O que a feature adicionou está registrado em
    // `MODULOS_FORA_DO_ALCANCE` pelo avesso: o que não é dela.
    return especificadoresDeImportacao(conteudo);
  }

  const apuracao = linhasAdicionadas(m.processo, m.raiz, m.ref, relativo);
  if (apuracao.linhas === null) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        apuracao.motivoDaFalha ??
          'as linhas adicionadas não puderam ser apuradas no repositório.',
        relativo,
      ),
    );
    return [];
  }

  if (apuracao.linhas.length === 0) {
    // O inventário afirma que esta feature tocou o arquivo. Se a comparação não
    // aponta linha alguma, o registro não descreve mais a realidade — e seguir
    // adiante inspecionaria o vazio, aprovando por omissão.
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        'o arquivo está registrado entre os preexistentes tocados por esta feature, ' +
          'mas a comparação com a linha de base não aponta nenhuma linha adicionada ' +
          'ou alterada: o registro não corresponde mais ao repositório.',
        relativo,
      ),
    );
    return [];
  }

  m.jaNoConjunto.add(relativo);
  m.paraInspecao.push({ arquivo: relativo, conteudo, linhas: apuracao.linhas });
  m.resolvidos.push({
    caminho: relativo,
    origem: 'PREEXISTENTE',
    alcance: 'LINHAS_ADICIONADAS',
    linhasNoAlcance: apuracao.linhas.length,
    linhasNoArquivo: contarLinhas(conteudo),
  });

  return especificadoresNasLinhas(conteudo, apuracao.linhas);
}

/**
 * Os especificadores de importação que aparecem nas linhas dadas.
 *
 * A classificação roda sobre o conteúdo inteiro — é o que garante que um trecho
 * dentro de comentário de bloco aberto antes do recorte seja reconhecido como
 * comentário — e o recorte é aplicado depois, sobre a linha de cada achado.
 */
function especificadoresNasLinhas(
  conteudo: string,
  linhas: readonly number[],
): readonly string[] {
  const alcance = new Set(linhas);
  const marcas = classificarRegioes(conteudo);
  const achados: string[] = [];
  let linhaAtual = 1;
  let i = 0;

  while (i < conteudo.length) {
    if (marcas[i] === REGIAO.IMPORTACAO) {
      const linhaDoAchado = linhaAtual;
      let fim = i;
      while (fim < marcas.length && marcas[fim] === REGIAO.IMPORTACAO) {
        if (conteudo.charAt(fim) === '\n') linhaAtual += 1;
        fim += 1;
      }
      if (alcance.has(linhaDoAchado)) {
        const bruto = conteudo.slice(i, fim);
        const semAspas = bruto.replace(/^['"`]/, '').replace(/['"`]$/, '');
        if (semAspas !== '') achados.push(semAspas);
      }
      i = fim;
      continue;
    }
    if (conteudo.charAt(i) === '\n') linhaAtual += 1;
    i += 1;
  }

  return achados;
}

// ═════════════════════════════════════════════════════════════════════════════
// resolverConjuntoDeArquivos
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve o conjunto de arquivos do requisito 12.9 e entrega tudo pronto para o
 * núcleo, junto das indeterminações apuradas no caminho.
 *
 * **Pós-condições**
 * - `paraInspecao` traz sempre o conteúdo **integral** de cada arquivo; o recorte
 *   viaja em `linhas`, como o núcleo exige.
 * - `indeterminacoes` não vazio significa que a verificação reprova, qualquer que
 *   seja o resultado da inspeção.
 * - Nenhum caminho aparece duas vezes.
 * - A ordem é determinística: criados, preexistentes, fechamento.
 */
export function resolverConjuntoDeArquivos(
  opcoes: OpcoesDoExecutor = {},
): ConjuntoResolvido {
  const raiz = opcoes.raizDoRepositorio ?? raizPadrao();
  const arquivos = opcoes.arquivos ?? arquivosReais;
  const processo = opcoes.processo ?? processoReal;
  const ref = opcoes.refLinhaDeBase ?? REF_LINHA_DE_BASE;
  const recortar = opcoes.recortarPreexistentes ?? true;

  // ── O repositório responde? A linha de base existe? ───────────────────────
  const consulta = resolverRef(processo, raiz, ref);
  if (consulta.refResolvido === null) {
    return {
      paraInspecao: [],
      indeterminacoes: [
        violacaoDeIndeterminacao(
          consulta.motivoDaFalha ?? 'a linha de base não pôde ser resolvida.',
        ),
      ],
      diagnostico: null,
    };
  }

  const m: Montagem = {
    raiz,
    arquivos,
    processo,
    ref,
    paraInspecao: [],
    indeterminacoes: [],
    resolvidos: [],
    jaNoConjunto: new Set<string>(),
  };

  const foraDoAlcance = new Set<string>();
  for (let i = 0; i < MODULOS_FORA_DO_ALCANCE.length; i += 1) {
    const registro = MODULOS_FORA_DO_ALCANCE[i];
    if (registro === undefined) continue;
    foraDoAlcance.add(registro.caminho);
    conferirRegistroForaDoAlcance(m, registro);
  }

  // ── Escopo 1: tudo que a feature criou, integralmente ────────────────────
  for (let i = 0; i < RAIZES_CRIADAS.length; i += 1) {
    const raizCriada = RAIZES_CRIADAS[i];
    if (raizCriada === undefined) continue;
    const absoluta = caminhoAbsoluto(raiz, raizCriada);
    if (!arquivos.existe(absoluta) || !arquivos.ehDiretorio(absoluta)) {
      m.indeterminacoes.push(
        violacaoDeIndeterminacao(
          'o diretório está registrado como criado por esta feature mas não existe ' +
            'no disco: o conjunto a inspecionar não pôde ser determinado.',
          raizCriada,
        ),
      );
      continue;
    }
    const encontrados = varrer(arquivos, raiz, raizCriada);
    for (let j = 0; j < encontrados.length; j += 1) {
      const arquivo = encontrados[j];
      if (arquivo === undefined) continue;
      if (!ehModulo(arquivo) && !ehAcompanhante(arquivo)) continue;
      acrescentarIntegral(m, arquivo, 'CRIADO');
    }
  }

  for (let i = 0; i < ARQUIVOS_CRIADOS.length; i += 1) {
    const arquivo = ARQUIVOS_CRIADOS[i];
    if (arquivo === undefined) continue;
    // Um arquivo registrado como criado por esta feature não pode existir na
    // linha de base. Se existir, o registro está errado — e o alcance dele
    // deveria ser recortado, não integral.
    const presente = existeNaLinhaDeBase(processo, raiz, ref, arquivo);
    if (presente === null) {
      m.indeterminacoes.push(
        violacaoDeIndeterminacao(
          'não foi possível apurar no repositório se este arquivo existe na linha de base.',
          arquivo,
        ),
      );
      continue;
    }
    if (presente) {
      m.indeterminacoes.push(
        violacaoDeIndeterminacao(
          'o arquivo está registrado como criado por esta feature, mas existe na ' +
            'linha de base: o registro está errado e o alcance apurado seria maior ' +
            'que o do requisito 12.9.',
          arquivo,
        ),
      );
      continue;
    }
    acrescentarIntegral(m, arquivo, 'CRIADO');
  }

  // ── Escopo 2: os quatro preexistentes, recortados ────────────────────────
  const sementes: string[] = [];
  for (let i = 0; i < ARQUIVOS_PREEXISTENTES.length; i += 1) {
    const arquivo = ARQUIVOS_PREEXISTENTES[i];
    if (arquivo === undefined) continue;
    const especificadores = acrescentarRecortado(m, arquivo, recortar);
    for (let j = 0; j < especificadores.length; j += 1) {
      const especificador = especificadores[j];
      if (especificador === undefined) continue;
      sementes.push(`${arquivo}\u0000${especificador}`);
    }
  }

  // ── Escopo 3: fechamento transitivo, restrito ao repositório ─────────────
  const modulosDoFechamento: string[] = [];
  const externos: string[] = [];
  const externosVistos = new Set<string>();
  const visitados = new Set<string>();

  // Semeia também com os módulos que a feature criou: as importações deles são,
  // por construção, importações que esta feature adicionou.
  const fila: string[] = [];
  for (let i = 0; i < m.paraInspecao.length; i += 1) {
    const item = m.paraInspecao[i];
    if (item === undefined) continue;
    if (!ehModulo(item.arquivo)) continue;
    const resolvido = m.resolvidos[i];
    if (resolvido !== undefined && resolvido.origem === 'PREEXISTENTE') continue;
    const especificadores = especificadoresDeImportacao(item.conteudo);
    for (let j = 0; j < especificadores.length; j += 1) {
      const especificador = especificadores[j];
      if (especificador === undefined) continue;
      fila.push(`${item.arquivo}\u0000${especificador}`);
    }
  }
  for (let i = 0; i < sementes.length; i += 1) {
    const semente = sementes[i];
    if (semente !== undefined) fila.push(semente);
  }

  while (fila.length > 0) {
    const aresta = fila.shift();
    if (aresta === undefined) continue;
    const separador = aresta.indexOf('\u0000');
    const deArquivo = aresta.slice(0, separador);
    const especificador = aresta.slice(separador + 1);

    if (!ehDoRepositorio(especificador)) {
      if (!externosVistos.has(especificador)) {
        externosVistos.add(especificador);
        externos.push(especificador);
      }
      continue;
    }

    const alvo = resolverEspecificador(arquivos, raiz, deArquivo, especificador);
    if (alvo === null) {
      m.indeterminacoes.push(
        violacaoDeIndeterminacao(
          `a importação «${especificador}» aponta para o próprio repositório mas não ` +
            'pôde ser resolvida para um arquivo: o fechamento transitivo ficou ' +
            'incompleto, e não se inspeciona o que não se acha.',
          deArquivo,
        ),
      );
      continue;
    }

    if (foraDoAlcance.has(alvo)) continue;
    // Guarda de ciclo: o grafo de importação deste projeto tem ciclo, e a marca
    // é posta antes de expandir.
    if (visitados.has(alvo)) continue;
    visitados.add(alvo);

    if (!ehModulo(alvo)) continue;

    const jaEstava = m.jaNoConjunto.has(alvo);
    if (!jaEstava) {
      acrescentarIntegral(m, alvo, 'FECHAMENTO');
      modulosDoFechamento.push(alvo);
    }

    const conteudo = conteudoNoConjunto(m, alvo);
    if (conteudo === null) continue;
    const especificadores = especificadoresDeImportacao(conteudo);
    for (let j = 0; j < especificadores.length; j += 1) {
      const proximo = especificadores[j];
      if (proximo === undefined) continue;
      fila.push(`${alvo}\u0000${proximo}`);
    }
  }

  if (m.paraInspecao.length === 0) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        'a resolução não encontrou nenhum arquivo para inspecionar.',
      ),
    );
  }

  const modulosRegistradosForaDoAlcance: string[] = [];
  for (let i = 0; i < MODULOS_FORA_DO_ALCANCE.length; i += 1) {
    const registro = MODULOS_FORA_DO_ALCANCE[i];
    if (registro !== undefined) modulosRegistradosForaDoAlcance.push(registro.caminho);
  }

  return {
    paraInspecao: m.paraInspecao,
    indeterminacoes: m.indeterminacoes,
    diagnostico: {
      refLinhaDeBase: ref,
      refResolvidoPara: consulta.refResolvido,
      arquivos: m.resolvidos,
      modulosDoFechamento,
      especificadoresExternos: externos,
      modulosForaDoAlcance: modulosRegistradosForaDoAlcance,
    },
  };
}

/** O conteúdo já lido de um arquivo do conjunto. */
function conteudoNoConjunto(m: Montagem, relativo: string): string | null {
  for (let i = 0; i < m.paraInspecao.length; i += 1) {
    const item = m.paraInspecao[i];
    if (item !== undefined && item.arquivo === relativo) return item.conteudo;
  }
  return null;
}

/**
 * Guarda contra apodrecimento de um registro de `MODULOS_FORA_DO_ALCANCE`.
 *
 * Um registro só se justifica enquanto o módulo existe **e** enquanto quem o
 * importava continua importando. Se a dependência sumiu, o registro está
 * escondendo nada — e é justamente aí que ele se tornaria um buraco permanente,
 * pronto para acomodar uma dependência nova que ninguém revisou.
 */
function conferirRegistroForaDoAlcance(m: Montagem, registro: ModuloForaDoAlcance): void {
  const absolutoDoModulo = caminhoAbsoluto(m.raiz, registro.caminho);
  if (!m.arquivos.existe(absolutoDoModulo)) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        'o módulo está registrado como dependência preexistente fora do alcance do ' +
          'fechamento, mas não existe no disco: o registro apodreceu e a fronteira ' +
          'do fechamento não pôde ser determinada.',
        registro.caminho,
      ),
    );
    return;
  }

  const absolutoDoImportador = caminhoAbsoluto(m.raiz, registro.importadoPor);
  if (!m.arquivos.existe(absolutoDoImportador)) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        `o arquivo que justificava manter «${registro.caminho}» fora do alcance não ` +
          'existe no disco: o registro apodreceu.',
        registro.importadoPor,
      ),
    );
    return;
  }

  let conteudo: string;
  try {
    conteudo = m.arquivos.ler(absolutoDoImportador);
  } catch (erro) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        `o arquivo que justificava a exclusão não pôde ser lido: ${mensagemDe(erro)}.`,
        registro.importadoPor,
      ),
    );
    return;
  }

  const especificadores = especificadoresDeImportacao(conteudo);
  let importaDeFato = false;
  for (let i = 0; i < especificadores.length; i += 1) {
    const especificador = especificadores[i];
    if (especificador === undefined || !ehDoRepositorio(especificador)) continue;
    const alvo = resolverEspecificador(
      m.arquivos,
      m.raiz,
      registro.importadoPor,
      especificador,
    );
    if (alvo === registro.caminho) {
      importaDeFato = true;
      break;
    }
  }

  if (!importaDeFato) {
    m.indeterminacoes.push(
      violacaoDeIndeterminacao(
        `«${registro.importadoPor}» não importa mais «${registro.caminho}», então o ` +
          'registro que o mantinha fora do alcance do fechamento perdeu a ' +
          'justificativa e precisa ser removido.',
        registro.caminho,
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// executarIndependenceCheck
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve o conjunto e roda a verificação.
 *
 * **Pós-condições**
 * - `aprovado` é `true` somente com zero violação e zero indeterminação.
 * - Indeterminação aparece em `violacoes` antes das ocorrências do núcleo: é o
 *   requisito 12.11 tratado como violação, e é o que o operador precisa ler
 *   primeiro, porque uma verificação indeterminada não diz nada sobre o resto.
 */
export function executarIndependenceCheck(
  opcoes: OpcoesDoExecutor = {},
): ResultadoDoExecutor {
  const conjunto = resolverConjuntoDeArquivos(opcoes);

  if (conjunto.paraInspecao.length === 0) {
    return {
      aprovado: false,
      violacoes: conjunto.indeterminacoes,
      arquivosInspecionados: 0,
      diagnostico: conjunto.diagnostico,
    };
  }

  const resultado: ResultadoIndependencia = checkIndependence(conjunto.paraInspecao);
  const violacoes: ViolacaoIndependencia[] = [
    ...conjunto.indeterminacoes,
    ...resultado.violacoes,
  ];

  return {
    aprovado: violacoes.length === 0,
    violacoes,
    arquivosInspecionados: resultado.arquivosInspecionados,
    diagnostico: conjunto.diagnostico,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Relatório
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O relatório em pt-BR: o que foi inspecionado e, se houver, o que reprovou.
 *
 * A parte das violações vem de `formatarViolacoes`, do núcleo, que já produz a
 * forma exigida pelo requisito 12.10 — arquivo e identificador de cada
 * ocorrência.
 */
export function formatarRelatorio(resultado: ResultadoDoExecutor): string {
  const partes: string[] = [];
  const d = resultado.diagnostico;

  if (d === null) {
    partes.push('Independence_Check: a resolução do conjunto não pôde ser concluída.');
  } else {
    let criados = 0;
    let recortados = 0;
    let integraisPreexistentes = 0;
    let doFechamento = 0;
    for (let i = 0; i < d.arquivos.length; i += 1) {
      const a = d.arquivos[i];
      if (a === undefined) continue;
      if (a.origem === 'CRIADO') criados += 1;
      else if (a.origem === 'FECHAMENTO') doFechamento += 1;
      else if (a.alcance === 'LINHAS_ADICIONADAS') recortados += 1;
      else integraisPreexistentes += 1;
    }
    partes.push(
      `Independence_Check — linha de base ${d.refLinhaDeBase.slice(0, 7)} ` +
        `(${d.refResolvidoPara.slice(0, 7)}).`,
      `  arquivos criados pela feature, inspecionados integralmente: ${criados}`,
      `  arquivos preexistentes recortados às linhas adicionadas: ${recortados}`,
      `  arquivos preexistentes sem linha de base, inspecionados integralmente: ${integraisPreexistentes}`,
      `  módulos alcançados pelo fechamento das importações: ${doFechamento}`,
      `  dependências preexistentes fora do fechamento: ${d.modulosForaDoAlcance.length}`,
    );
    for (let i = 0; i < d.arquivos.length; i += 1) {
      const a = d.arquivos[i];
      if (a === undefined || a.alcance !== 'LINHAS_ADICIONADAS') continue;
      partes.push(
        `    recorte em ${a.caminho}: ${a.linhasNoAlcance ?? 0} de ${a.linhasNoArquivo} linhas`,
      );
    }
  }

  partes.push(formatarViolacoes(resultado.violacoes));
  return partes.join('\n');
}
