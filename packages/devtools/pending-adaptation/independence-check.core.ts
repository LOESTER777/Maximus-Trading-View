/**
 * `independence-check.core` — o núcleo puro da `Independence_Check`.
 * Spec `bookmap-no-mapa-de-decisao`, tarefa 11.1. Requisitos 12.9 e 12.10.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Recebe uma lista de arquivos **já resolvida** — cada item com o caminho e o
 * conteúdo a inspecionar — e devolve as violações de independência encontradas,
 * cada uma com **arquivo e identificador**, que é o que o requisito 12.10 manda
 * informar.
 *
 * Função **pura**: sem relógio, sem sorteio, sem DOM e **sem I/O**. Não abre
 * arquivo, não consulta `git`, não conhece o disco. Quem resolve o conjunto de
 * arquivos e lê o conteúdo é o executor da tarefa 11.2; quem transforma o
 * resultado em falha de suíte é a spec da 11.3. A separação existe para que a
 * decisão "isto é violação?" seja testável sem repositório, sem `git` e sem
 * sistema de arquivos.
 *
 * Determinístico: a mesma lista devolve as mesmas violações, na mesma ordem —
 * arquivos na ordem recebida, regras na ordem declarada, ocorrências da esquerda
 * para a direita. Nenhuma expressão regular é compartilhada entre chamadas
 * (`RegExp` com a marca `g` carrega `lastIndex` mutável, que é estado), então
 * cada chamada compila as suas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O PROBLEMA CENTRAL — CÓDIGO NÃO É PROSA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vários arquivos desta feature **citam** em comentário pt-BR justamente aquilo
 * que a verificação proíbe, porque declaram a AUSÊNCIA daquilo. Casos reais e
 * verificados no repositório:
 *
 * - `BookmapPrimitive.ts`, linhas 41 e 46: um comentário afirma que a camada não
 *   carrega credencial e que nenhum insumo vem do sistema de arquivos, em CSV ou
 *   em outro formato. As duas palavras estão ali, em prosa.
 * - `page.tsx` do mapa de decisão, linha 328: um bloco de documentação cita a
 *   porta de uma bridge; linha 5740: um comentário de JSX afirma que a conta real
 *   permanece intocada, **escrevendo o número da conta**.
 *
 * Uma verificação por **substring de texto** marcaria todos esses casos e
 * reprovaria a própria feature que deveria aprovar. Por isso este núcleo não
 * procura palavra: ele **classifica cada caractere do arquivo por região** e só
 * procura onde a ocorrência produziria efeito.
 *
 * | Região        | Inspecionada? | Por quê |
 * |---------------|---------------|---------|
 * | `comentario`  | **nunca**     | prosa não importa módulo, não chama serviço, não abre conexão |
 * | `codigo`      | sim           | é onde identificador vira referência de verdade |
 * | `texto`       | sim, por regra| SQL, caminho de arquivo e endereço de rede moram em literal |
 * | `importacao`  | sim, por regra| o especificador de `import`/`require` **é** um literal, e é o que amarra módulo |
 *
 * O especificador de importação é tratado **antes** de a regra de literal
 * descartar qualquer coisa, exatamente porque ele é um literal de texto que
 * precisa ser inspecionado.
 *
 * ── Conceito ≠ nome de classe ──────────────────────────────────────────────
 *
 * Metade dos itens proibidos é **conceito**, não nome de classe. Para esses, a
 * regra casa o que produz o efeito, nunca a palavra solta:
 *
 * | Conceito | O que a regra casa | O que ela NÃO casa |
 * |---|---|---|
 * | credencial de conta | nome de variável de ambiente ou de campo de senha/token de conta ou de bridge | a palavra `credencial` |
 * | leitura de CSV | caminho com extensão de dado tabular, chamada de função de CSV, importação de biblioteca de CSV | a palavra `CSV` |
 * | ticket de ordem | `mt5Ticket`, `mt5_ticket`, `orderTicket` e afins | a palavra `ticket` |
 * | tabela de posições ativas | a tabela `active_positions` e a entidade correspondente | a palavra `posição` |
 * | serviço de gestão de posição | identificador de serviço com `Position` no nome | a palavra `posição` |
 * | endereço de rede de bridge | endereço com a porta de uma bridge MT5 | um número qualquer |
 * | escrita em tabela de bookmap | verbo de escrita ou de DDL **junto** do nome da tabela | `SELECT`, que é leitura legítima |
 *
 * A última linha é a que mais importa na prática: consultar `bookmap_depth`,
 * `bookmap_depth_cobertura` e `bookmap_l1` é exatamente o que esta feature faz.
 * Só escrita e alteração de estrutura são proibidas (requisitos 12.3 e 12.5), e é
 * isso que a regra exige — o verbo e o nome da tabela, na mesma vizinhança.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTO-CONSISTÊNCIA — POR QUE ALGUNS PADRÕES TÊM COLCHETE APARENTEMENTE INÚTIL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo é, ele próprio, um arquivo criado por esta feature, e o requisito
 * 12.9 manda inspecionar **integralmente** cada um deles. Ou seja: a verificação
 * inspeciona a si mesma. Como ela precisa **carregar** os identificadores
 * proibidos para poder procurá-los, existe um risco óbvio de ela se reprovar.
 *
 * A saída **não** é abrir exceção para este arquivo — isolar a si mesmo seria um
 * buraco permanente, e é justamente aqui que alguém esconderia uma referência. A
 * saída é escrever cada padrão de forma que ele **não case com o próprio texto**,
 * mantendo intacto o que ele casa no código de verdade. Daí construções como
 * `Order[E]xecutionService` e `1932[4]625`: a classe de um caractere não muda
 * nada no que é casado, e quebra a ocorrência literal aqui dentro.
 *
 * Os padrões vivem como **texto de expressão** (`string`), nunca como literal de
 * expressão regular. Um literal `/.../` é região `codigo` — e é assim de
 * propósito, porque uma referência escondida dentro de uma expressão regular é
 * uma referência. Manter os padrões em `string` é o que os deixa fora do alcance
 * das regras de código.
 *
 * ⚠️ **Ao acrescentar regra, verifique a auto-consistência.** A prova é direta:
 * rodar `checkIndependence` sobre o conteúdo deste próprio arquivo e obter zero
 * violação. A spec da tarefa 11.3 tem esse caso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDETERMINAÇÃO É VIOLAÇÃO (requisito 12.11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Entrada que não permita concluir **nunca** vira aprovação silenciosa. Este
 * núcleo emite `INDETERMINACAO` quando a lista chega vazia, quando um item vem
 * sem caminho, e quando o conteúdo não é texto ou vem vazio — que é o desfecho
 * plausível de uma leitura que falhou. O executor da 11.2 usa
 * `violacaoDeIndeterminacao` para os casos que só ele consegue perceber, como
 * `git diff` indisponível ou conjunto de arquivos irresolvível.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LIMITE DECLARADO — O QUE ESTA VERIFICAÇÃO NÃO PROMETE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Uma chamada de leitura de arquivo, isolada, não é violação aqui.** Só é
 * violação quando o caminho lido tem extensão de dado tabular, ou quando há
 * função ou biblioteca de CSV envolvida.
 *
 * O motivo é concreto: `__tests__/bookmap-decode-contrato-backend.spec.ts` lê com
 * `readFileSync` a fixture versionada em JSON que sustenta o contrato cruzado com
 * o codificador do backend. Marcar toda leitura de arquivo reprovaria esse teste
 * — e um material de bancada versionado no próprio repositório não é fonte de
 * dado de produção. Já a afirmação mais larga do requisito 12.6 (nenhum insumo de
 * livro, de execução ou de cobertura vindo do sistema de arquivos) é asserção da
 * tarefa 11.4, onde ela pode ser feita sobre o caminho de dado e não sobre a
 * presença de uma chamada.
 *
 * Vale registrar o que sustenta essa escolha: a pasta desta feature **não tem
 * nenhuma** ocorrência de extensão de dado tabular, então a regra de extensão é
 * verificadamente livre de falso positivo aqui, e cobre o formato com que este
 * projeto de fato ingere Times & Trades.
 *
 * Convenções: identificadores em inglês, comentários e texto ao operador em
 * pt-BR. Tipos saem por `export type` porque o projeto compila com
 * `isolatedModules`.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Regiões
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As quatro classes de caractere que a classificação distingue.
 *
 * Objeto congelado de dados, não estado: nenhuma função escreve aqui.
 */
export const REGIAO = {
  /** Comentário de linha ou de bloco, inclusive de documentação. Nunca inspecionado. */
  COMENTARIO: 0,
  /** Código executável: identificador, operador, literal numérico, expressão regular. */
  CODIGO: 1,
  /** Conteúdo de literal de texto que não é especificador de importação. */
  TEXTO: 2,
  /** Especificador de `import`, de `export ... from`, de `import()` e de `require()`. */
  IMPORTACAO: 3,
} as const;

/** Região sobre a qual uma regra procura. */
export type RegiaoInspecionada = 'codigo' | 'texto' | 'importacao';

const CODIGO_DE_REGIAO: Readonly<Record<RegiaoInspecionada, number>> = {
  codigo: REGIAO.CODIGO,
  texto: REGIAO.TEXTO,
  importacao: REGIAO.IMPORTACAO,
};

// ═════════════════════════════════════════════════════════════════════════════
// Tipos públicos
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O que cada violação identifica. É o `identificador` exigido pelo requisito
 * 12.10 e o vocabulário que a mensagem de falha da tarefa 11.3 usa.
 */
export type IdentificadorProibido =
  | 'SERVICO_ROTEAMENTO_BRIDGE'
  | 'SERVICO_FEED_TICK'
  | 'SERVICO_EXECUCAO_ORDEM'
  | 'BRIDGE_EXECUCAO_SINAL_B3'
  | 'IMPORTACAO_CONECTOR_TERMINAL'
  | 'ENDERECO_REDE_BRIDGE'
  | 'CONTA_REAL'
  | 'TABELA_POSICOES_ATIVAS'
  | 'SERVICO_GESTAO_POSICAO'
  | 'TICKET_DE_ORDEM'
  | 'CREDENCIAL_DE_CONTA'
  | 'LEITURA_DE_CSV'
  | 'ESCRITA_EM_TABELA_DE_BOOKMAP'
  | 'INDETERMINACAO';

/**
 * Um arquivo a inspecionar, com o conteúdo já lido pelo chamador.
 *
 * `linhas` existe para o requisito 12.9, que manda inspecionar **apenas as linhas
 * adicionadas ou alteradas** nos quatro arquivos preexistentes e manter as
 * preexistentes fora do alcance. Ausente ou `null` significa arquivo inteiro.
 *
 * ⚠️ O conteúdo passado deve ser **sempre o arquivo completo**, mesmo quando
 * `linhas` restringe o alcance: saber se a linha 4.000 está dentro de um
 * comentário de bloco aberto na linha 3.900 exige o arquivo todo. O recorte é
 * aplicado depois da classificação, sobre a posição de cada ocorrência.
 */
export interface ArquivoParaInspecao {
  /** Caminho como o operador o reconhece. Entra na mensagem de falha. */
  readonly arquivo: string;
  /** Conteúdo integral do arquivo. */
  readonly conteudo: string;
  /** Linhas (base 1) no alcance da inspeção; ausente ou `null` = todas. */
  readonly linhas?: readonly number[] | null;
}

/** Uma ocorrência proibida, com o bastante para a mensagem ser acionável. */
export interface ViolacaoIndependencia {
  /** Arquivo onde a ocorrência está, como recebido. */
  readonly arquivo: string;
  /** O identificador proibido — requisito 12.10. */
  readonly identificador: IdentificadorProibido;
  /** Nome legível do identificador, em pt-BR. */
  readonly rotulo: string;
  /** O texto efetivamente encontrado, recortado para caber na mensagem. */
  readonly trecho: string;
  /** Linha da ocorrência, base 1. Zero quando não se aplica (indeterminação). */
  readonly linha: number;
  /** Coluna da ocorrência, base 1. Zero quando não se aplica. */
  readonly coluna: number;
  /** Região em que a ocorrência foi encontrada. */
  readonly regiao: RegiaoInspecionada | 'nenhuma';
  /** Por que isso é proibido, em pt-BR. */
  readonly motivo: string;
}

/** O desfecho da verificação. */
export interface ResultadoIndependencia {
  /** `true` somente com zero violação. Indeterminação reprova. */
  readonly aprovado: boolean;
  /** Violações em ordem determinística. */
  readonly violacoes: readonly ViolacaoIndependencia[];
  /** Quantos arquivos entraram na inspeção com conteúdo utilizável. */
  readonly arquivosInspecionados: number;
}

/** Uma regra declarada. Exposta para a suíte poder enumerar a cobertura. */
export interface RegraIndependencia {
  readonly identificador: IdentificadorProibido;
  readonly rotulo: string;
  readonly motivo: string;
  /** Onde procurar. Vazio nunca acontece: regra sem região não procuraria nada. */
  readonly regioes: readonly RegiaoInspecionada[];
  /** Texto da expressão. Ver a seção de auto-consistência antes de editar. */
  readonly padrao: string;
  /** Marcas da expressão, sempre com `g`. */
  readonly marcas: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// As regras
// ═════════════════════════════════════════════════════════════════════════════

const TODAS: readonly RegiaoInspecionada[] = ['codigo', 'texto', 'importacao'];
const CODIGO_E_TEXTO: readonly RegiaoInspecionada[] = ['codigo', 'texto'];
const TEXTO_E_IMPORTACAO: readonly RegiaoInspecionada[] = ['texto', 'importacao'];

/**
 * O conjunto proibido pela tarefa 11.1, na ordem em que é reportado.
 *
 * Os quatro primeiros são nome de classe e por isso procuram também em literal
 * de texto: injeção por token textual e referência por `string` seriam furos
 * evidentes se só o código fosse olhado.
 *
 * ⚠️ Cada `padrao` é escrito para não casar com este arquivo. Ver a seção de
 * auto-consistência no cabeçalho.
 */
export const REGRAS_INDEPENDENCIA: readonly RegraIndependencia[] = [
  {
    identificador: 'SERVICO_ROTEAMENTO_BRIDGE',
    rotulo: 'serviço de roteamento de bridge',
    motivo:
      'a camada de livro obtém dado exclusivamente do endpoint de bookmap e não resolve conexão alguma (requisito 12.1).',
    regioes: TODAS,
    padrao: '\\bBridge[R]esolverService\\b',
    marcas: 'g',
  },
  {
    identificador: 'SERVICO_FEED_TICK',
    rotulo: 'serviço de feed de tick em tempo real',
    motivo:
      'o livro histórico vem do endpoint de bookmap; a camada não assina feed em tempo real (requisito 12.1).',
    regioes: TODAS,
    padrao: '\\bWebSocket[T]ickClientService\\b',
    marcas: 'g',
  },
  {
    identificador: 'SERVICO_EXECUCAO_ORDEM',
    rotulo: 'serviço de execução de ordem',
    motivo:
      'a feature é exclusivamente visual e não envia ordem (requisitos 12.1 e 12.7).',
    regioes: TODAS,
    padrao: '\\bOrder[E]xecutionService\\b',
    marcas: 'g',
  },
  {
    identificador: 'BRIDGE_EXECUCAO_SINAL_B3',
    rotulo: 'bridge de execução de sinal B3',
    motivo:
      'a camada não emite evento de decisão nem alcança o caminho de execução (requisitos 12.1 e 12.7).',
    regioes: TODAS,
    padrao: '\\bB3Signal[E]xecutionBridge\\b',
    marcas: 'g',
  },
  {
    identificador: 'IMPORTACAO_CONECTOR_TERMINAL',
    rotulo: 'importação de módulo de conector de terminal',
    motivo:
      'nenhum módulo desta feature importa conector de terminal, direta ou transitivamente (requisito 12.1).',
    regioes: TEXTO_E_IMPORTACAO,
    padrao: 'connectors[/\\\\]mt5[/\\\\]',
    marcas: 'gi',
  },
  {
    identificador: 'ENDERECO_REDE_BRIDGE',
    rotulo: 'endereço de rede de bridge MT5',
    motivo:
      'todo insumo chega do endpoint de bookmap do próprio backend; endereço de bridge não aparece na camada visual (requisito 12.1).',
    regioes: TODAS,
    // Casa `:8229`, `localhost:8229`, `127.0.0.1:8230` e afins — as portas das
    // quatro bridges. Um número solto não casa: a porta tem de vir depois de
    // dois-pontos, sem espaço, que é a forma de um endereço.
    padrao: '(?:https?:\\/\\/)?[A-Za-z0-9._-]*:82(?:2[89]|3[01])\\b',
    marcas: 'g',
  },
  {
    identificador: 'CONTA_REAL',
    rotulo: 'conta real do operador',
    motivo:
      'a conta real permanece intocada pela feature; nem referência a ela existe (requisito 12.4).',
    regioes: TODAS,
    padrao: '\\b1932[4]625\\b',
    marcas: 'g',
  },
  {
    identificador: 'TABELA_POSICOES_ATIVAS',
    rotulo: 'tabela de posições ativas',
    motivo:
      'a camada de livro não conhece estado de posição (requisito 12.4).',
    regioes: CODIGO_E_TEXTO,
    padrao: '\\bactive_position[s]\\b|\\bActive[P]osition(?:s|Entity)?\\b',
    marcas: 'g',
  },
  {
    identificador: 'SERVICO_GESTAO_POSICAO',
    rotulo: 'serviço de gestão de posição',
    motivo:
      'gestão de posição é do bridge; a camada visual não a alcança (requisitos 12.4 e 12.8).',
    regioes: CODIGO_E_TEXTO,
    padrao: '\\b[A-Za-z0-9_$]*Position[A-Za-z0-9_$]*Service\\b',
    marcas: 'g',
  },
  {
    identificador: 'TICKET_DE_ORDEM',
    rotulo: 'ticket de ordem',
    motivo:
      'a feature não referencia ordem executada (requisito 12.4).',
    regioes: CODIGO_E_TEXTO,
    padrao: '\\b(?:mt5|order|deal|position)[_]?[tT]icket\\b',
    marcas: 'g',
  },
  {
    identificador: 'CREDENCIAL_DE_CONTA',
    rotulo: 'credencial de conta ou de bridge',
    motivo:
      'a camada visual não carrega credencial: a chamada ao endpoint usa a sessão do próprio frontend (requisito 12.4).',
    regioes: CODIGO_E_TEXTO,
    padrao:
      '\\b(?:MT5|BRIDGE|PG|DB|CEDRO|BROKER)_?[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|SENHA)\\b' +
      '|\\b(?:bridge|mt5|account|conta|investor|broker)(?:Auth)?(?:Token|Password|Secret|Senha)\\b',
    marcas: 'g',
  },
  {
    identificador: 'LEITURA_DE_CSV',
    rotulo: 'caminho de arquivo de dado tabular',
    motivo:
      'todo insumo de livro, de execução e de cobertura vem de tabela ou de endpoint, nunca de arquivo de dado (requisito 12.6).',
    regioes: TEXTO_E_IMPORTACAO,
    // Extensão no fim do nome. `algo.data` e `algo.datum` não casam.
    padrao:
      '\\.(?:[cC][sS][vV]|[tT][sS][vV]|[pP][sS][vV]|[dD][aA][tT]|[pP][aA][rR][qQ][uU][eE][tT]|[tT][xX][tT])(?![A-Za-z0-9])',
    marcas: 'g',
  },
  {
    identificador: 'LEITURA_DE_CSV',
    rotulo: 'chamada de função de CSV',
    motivo:
      'nenhum dado desta feature é analisado a partir de CSV (requisito 12.6).',
    regioes: ['codigo'],
    padrao: '\\b[A-Za-z0-9_$]*[cC][sS][vV][A-Za-z0-9_$]*\\s*\\(',
    marcas: 'g',
  },
  {
    identificador: 'LEITURA_DE_CSV',
    rotulo: 'importação de biblioteca de CSV',
    motivo:
      'nenhuma dependência de CSV entra nesta feature (requisito 12.6).',
    regioes: ['importacao'],
    padrao: '[cC][sS][vV]',
    marcas: 'g',
  },
  {
    identificador: 'ESCRITA_EM_TABELA_DE_BOOKMAP',
    rotulo: 'escrita ou alteração de estrutura em tabela de bookmap',
    motivo:
      'a feature apenas consulta as tabelas de bookmap; o agregador de linha de comando segue como único produtor delas (requisitos 12.3 e 12.5).',
    // A união de código e texto é deliberada: o verbo pode estar no código
    // (construtor de consulta) e o nome da tabela no literal. A classificação
    // preserva as posições originais, então uma ocorrência pode atravessar as
    // duas regiões.
    regioes: CODIGO_E_TEXTO,
    // Leitura (`SELECT`) não casa: é exatamente o que esta feature faz.
    padrao:
      '\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE|ALTER\\s+TABLE|DROP\\s+TABLE' +
      '|CREATE\\s+(?:UNIQUE\\s+)?(?:TABLE|INDEX|VIEW|MATERIALIZED\\s+VIEW)|COPY|MERGE\\s+INTO|UPSERT' +
      '|\\.\\s*(?:insert|update|delete|upsert|softRemove|remove|truncate)\\s*\\()' +
      '[\\s\\S]{0,140}?\\bbookmap_(?:depth_cobertura|depth|l1)\\b',
    marcas: 'gi',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Classificação por região
// ═════════════════════════════════════════════════════════════════════════════

const VAZIO = -1;

/** Leitura de `Uint8Array` sob `noUncheckedIndexedAccess`. Fora do vetor = código. */
function marcaEm(marcas: Uint8Array, i: number): number {
  const v = marcas[i];
  return v === undefined ? REGIAO.CODIGO : v;
}

function ehCaractereDeIdentificador(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '_' ||
    c === '$'
  );
}

function ehEspaco(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

/** Um token lido para trás, com onde ele começa. */
interface TokenAnterior {
  readonly texto: string;
  readonly inicio: number;
}

/**
 * O token significativo imediatamente antes de `pos`, ignorando espaço e
 * comentário. Só funciona para trás, e é por isso que a varredura precisa ser da
 * esquerda para a direita: tudo antes de `pos` já está classificado.
 */
function tokenAnterior(
  conteudo: string,
  marcas: Uint8Array,
  pos: number,
): TokenAnterior | null {
  let i = pos - 1;
  while (i >= 0) {
    if (marcaEm(marcas, i) === REGIAO.COMENTARIO) {
      i -= 1;
      continue;
    }
    if (ehEspaco(conteudo.charAt(i))) {
      i -= 1;
      continue;
    }
    break;
  }
  if (i < 0) return null;

  const c = conteudo.charAt(i);
  if (!ehCaractereDeIdentificador(c)) {
    return { texto: c, inicio: i };
  }

  let inicio = i;
  while (inicio > 0 && ehCaractereDeIdentificador(conteudo.charAt(inicio - 1))) {
    inicio -= 1;
  }
  return { texto: conteudo.slice(inicio, i + 1), inicio };
}

/**
 * O literal que começa em `pos` é especificador de importação?
 *
 * Cobre `import 'x'`, `import ... from 'x'`, `export ... from 'x'`,
 * `import('x')` e `require('x')`. Qualquer outro literal é `texto` — o que não
 * perde cobertura, porque a regra de conector de terminal e a de caminho de dado
 * também procuram em `texto`.
 */
function classeDoLiteral(
  conteudo: string,
  marcas: Uint8Array,
  pos: number,
): number {
  const t1 = tokenAnterior(conteudo, marcas, pos);
  if (t1 === null) return REGIAO.TEXTO;
  if (t1.texto === 'from' || t1.texto === 'import') return REGIAO.IMPORTACAO;
  if (t1.texto === '(') {
    const t2 = tokenAnterior(conteudo, marcas, t1.inicio);
    if (t2 !== null && (t2.texto === 'import' || t2.texto === 'require')) {
      return REGIAO.IMPORTACAO;
    }
  }
  return REGIAO.TEXTO;
}

/**
 * Uma barra em `pos` inicia expressão regular, ou é divisão?
 *
 * Heurística padrão pelo token anterior. Errar para "é divisão" não perde
 * cobertura de regra alguma; errar para "é expressão regular" poderia engolir
 * código como se fosse literal, então a lista de contextos permitidos é
 * fechada.
 *
 * ⚠️ Sem isto, `/https?:\/\//` seria lido como código até topar com `//` no
 * meio da própria expressão e transformar o resto da linha em comentário — um
 * falso negativo silencioso, que é o pior desfecho para uma verificação.
 */
function inicioDeExpressaoRegular(
  conteudo: string,
  marcas: Uint8Array,
  pos: number,
): boolean {
  const t = tokenAnterior(conteudo, marcas, pos);
  if (t === null) return true;

  const texto = t.texto;
  if (texto.length === 1 && '(,=:[!&|?{};+-*%<>~^'.indexOf(texto) >= 0) return true;

  return (
    texto === 'return' ||
    texto === 'typeof' ||
    texto === 'instanceof' ||
    texto === 'in' ||
    texto === 'of' ||
    texto === 'new' ||
    texto === 'delete' ||
    texto === 'void' ||
    texto === 'case' ||
    texto === 'do' ||
    texto === 'else' ||
    texto === 'yield' ||
    texto === 'await' ||
    texto === 'throw'
  );
}

/** Consome a expressão regular que começa em `pos`. `VAZIO` se não fechar na linha. */
function fimDaExpressaoRegular(conteudo: string, pos: number): number {
  const n = conteudo.length;
  let i = pos + 1;
  let dentroDeClasse = false;

  while (i < n) {
    const c = conteudo.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n' || c === '\r') return VAZIO;
    if (dentroDeClasse) {
      if (c === ']') dentroDeClasse = false;
    } else if (c === '[') {
      dentroDeClasse = true;
    } else if (c === '/') {
      i += 1;
      while (i < n && ehCaractereDeIdentificador(conteudo.charAt(i))) i += 1;
      return i;
    }
    i += 1;
  }
  return VAZIO;
}

/**
 * Classifica cada caractere de `conteudo` em uma das quatro regiões.
 *
 * Uma passada, da esquerda para a direita. Exposta para que a suíte possa
 * verificar diretamente que prosa de comentário fica fora do alcance.
 *
 * **Pós-condição**: o vetor devolvido tem exatamente `conteudo.length` posições,
 * e nenhuma posição fica sem classe (o padrão é `CODIGO`).
 */
export function classificarRegioes(conteudo: string): Uint8Array {
  const marcas = new Uint8Array(conteudo.length);
  marcas.fill(REGIAO.CODIGO);
  varrer(conteudo, marcas, 0, false);
  return marcas;
}

/**
 * O laço de varredura. `pararNaChaveFechada` serve à interpolação de template:
 * a varredura de `${ ... }` termina na chave que fecha, contando aninhamento.
 * Devolve o índice em que parou.
 */
function varrer(
  conteudo: string,
  marcas: Uint8Array,
  inicio: number,
  pararNaChaveFechada: boolean,
): number {
  const n = conteudo.length;
  let i = inicio;
  let profundidade = 0;

  while (i < n) {
    const c = conteudo.charAt(i);
    const proximo = conteudo.charAt(i + 1);

    if (c === '/' && proximo === '/') {
      while (i < n && conteudo.charAt(i) !== '\n') {
        marcas[i] = REGIAO.COMENTARIO;
        i += 1;
      }
      continue;
    }

    if (c === '/' && proximo === '*') {
      marcas[i] = REGIAO.COMENTARIO;
      marcas[i + 1] = REGIAO.COMENTARIO;
      i += 2;
      while (i < n) {
        const d = conteudo.charAt(i);
        marcas[i] = REGIAO.COMENTARIO;
        if (d === '*' && conteudo.charAt(i + 1) === '/') {
          marcas[i + 1] = REGIAO.COMENTARIO;
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === '/' && inicioDeExpressaoRegular(conteudo, marcas, i)) {
      const fim = fimDaExpressaoRegular(conteudo, i);
      // Marcas seguem `CODIGO`, que é a classificação desejada: referência
      // escondida em expressão regular é referência.
      i = fim === VAZIO ? i + 1 : fim;
      continue;
    }

    if (c === '"' || c === "'") {
      const classe = classeDoLiteral(conteudo, marcas, i);
      marcas[i] = classe;
      i += 1;
      while (i < n) {
        const d = conteudo.charAt(i);
        if (d === '\\') {
          marcas[i] = classe;
          marcas[i + 1] = classe;
          i += 2;
          continue;
        }
        marcas[i] = classe;
        i += 1;
        if (d === c) break;
        // Literal não fechado na linha: encerra para não engolir o arquivo.
        if (d === '\n') break;
      }
      continue;
    }

    if (c === '`') {
      const classe = classeDoLiteral(conteudo, marcas, i);
      marcas[i] = classe;
      i += 1;
      while (i < n) {
        const d = conteudo.charAt(i);
        if (d === '\\') {
          marcas[i] = classe;
          marcas[i + 1] = classe;
          i += 2;
          continue;
        }
        if (d === '`') {
          marcas[i] = classe;
          i += 1;
          break;
        }
        if (d === '$' && conteudo.charAt(i + 1) === '{') {
          marcas[i] = REGIAO.CODIGO;
          marcas[i + 1] = REGIAO.CODIGO;
          i = varrer(conteudo, marcas, i + 2, true);
          continue;
        }
        marcas[i] = classe;
        i += 1;
      }
      continue;
    }

    if (pararNaChaveFechada) {
      if (c === '{') {
        profundidade += 1;
        i += 1;
        continue;
      }
      if (c === '}') {
        if (profundidade === 0) return i + 1;
        profundidade -= 1;
        i += 1;
        continue;
      }
    }

    i += 1;
  }

  return n;
}

// ═════════════════════════════════════════════════════════════════════════════
// Máscara e posição
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Devolve `conteudo` com tudo fora de `regioes` trocado por espaço, preservando
 * comprimento e quebras de linha.
 *
 * Preservar o comprimento é o que mantém a posição de cada ocorrência igual à do
 * arquivo original — sem isso, linha e coluna reportadas seriam de outro texto.
 * Preservar a quebra de linha é o que mantém a contagem de linhas.
 */
function mascarar(
  conteudo: string,
  marcas: Uint8Array,
  regioes: readonly RegiaoInspecionada[],
): string {
  const permitidas: number[] = [];
  for (let r = 0; r < regioes.length; r += 1) {
    const nome = regioes[r];
    if (nome !== undefined) permitidas.push(CODIGO_DE_REGIAO[nome]);
  }

  const saida: string[] = [];
  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo.charAt(i);
    if (c === '\n' || c === '\r') {
      saida.push(c);
      continue;
    }
    saida.push(permitidas.indexOf(marcaEm(marcas, i)) >= 0 ? c : ' ');
  }
  return saida.join('');
}

/** Deslocamentos em que cada linha começa. `iniciosDeLinha[0] === 0`. */
function iniciosDeLinha(conteudo: string): readonly number[] {
  const inicios: number[] = [0];
  for (let i = 0; i < conteudo.length; i += 1) {
    if (conteudo.charAt(i) === '\n') inicios.push(i + 1);
  }
  return inicios;
}

/** Linha (base 1) do deslocamento, por busca binária. */
function linhaDe(inicios: readonly number[], posicao: number): number {
  let baixo = 0;
  let alto = inicios.length - 1;
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1;
    const inicio = inicios[meio];
    if (inicio !== undefined && inicio <= posicao) baixo = meio;
    else alto = meio - 1;
  }
  return baixo + 1;
}

const TRECHO_MAXIMO = 120;

/** Recorta o achado para a mensagem, em uma linha. */
function recortar(bruto: string): string {
  const emUmaLinha = bruto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return emUmaLinha.length <= TRECHO_MAXIMO
    ? emUmaLinha
    : `${emUmaLinha.slice(0, TRECHO_MAXIMO)}…`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Indeterminação
// ═════════════════════════════════════════════════════════════════════════════

const ROTULO_INDETERMINACAO = 'verificação indeterminada';

/**
 * Constrói a violação de indeterminação do requisito 12.11.
 *
 * Existe como função pública porque parte da indeterminação só o executor da
 * tarefa 11.2 consegue perceber — `git` indisponível, ref de linha de base
 * ausente, conjunto de arquivos irresolvível. O desfecho, em qualquer caso, é o
 * mesmo: **não** aprovação silenciosa.
 */
export function violacaoDeIndeterminacao(
  motivo: string,
  arquivo = '(conjunto de arquivos)',
): ViolacaoIndependencia {
  return {
    arquivo,
    identificador: 'INDETERMINACAO',
    rotulo: ROTULO_INDETERMINACAO,
    trecho: '',
    linha: 0,
    coluna: 0,
    regiao: 'nenhuma',
    motivo,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// checkIndependence
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Procura, em cada arquivo recebido, toda ocorrência proibida pela tarefa 11.1.
 *
 * **Pré-condições** (verificadas, não presumidas)
 * - `arquivos` é vetor com ao menos um item; lista vazia é indeterminação.
 * - cada item tem `arquivo` textual não vazio e `conteudo` textual não vazio;
 *   qualquer desvio é indeterminação daquele item.
 *
 * **Pós-condições**
 * - `aprovado === (violacoes.length === 0)`.
 * - Nenhuma ocorrência em região de comentário é reportada.
 * - Com `linhas` informado, nenhuma violação reportada cai fora dessas linhas.
 * - Nenhuma mutação da entrada: só leitura.
 * - Duas chamadas com a mesma entrada devolvem violações iguais e na mesma ordem.
 *
 * Ordem: arquivos na ordem recebida; dentro do arquivo, regras na ordem de
 * `REGRAS_INDEPENDENCIA`; dentro da regra, ocorrências da esquerda para a
 * direita.
 */
export function checkIndependence(
  arquivos: readonly ArquivoParaInspecao[],
): ResultadoIndependencia {
  const violacoes: ViolacaoIndependencia[] = [];

  if (!Array.isArray(arquivos) || arquivos.length === 0) {
    violacoes.push(
      violacaoDeIndeterminacao(
        'nenhum arquivo foi entregue à verificação: o conjunto a inspecionar não pôde ser determinado.',
      ),
    );
    return { aprovado: false, violacoes, arquivosInspecionados: 0 };
  }

  let inspecionados = 0;

  for (let f = 0; f < arquivos.length; f += 1) {
    const item = arquivos[f];

    if (item === null || item === undefined || typeof item !== 'object') {
      violacoes.push(
        violacaoDeIndeterminacao(
          `o item de posição ${f} da lista não descreve um arquivo.`,
        ),
      );
      continue;
    }

    const nome = typeof item.arquivo === 'string' ? item.arquivo : '';
    if (nome === '') {
      violacoes.push(
        violacaoDeIndeterminacao(
          `o item de posição ${f} da lista chegou sem caminho de arquivo.`,
        ),
      );
      continue;
    }

    if (typeof item.conteudo !== 'string' || item.conteudo.length === 0) {
      violacoes.push(
        violacaoDeIndeterminacao(
          'o conteúdo do arquivo chegou vazio ou não textual, então nada pôde ser concluído sobre ele.',
          nome,
        ),
      );
      continue;
    }

    inspecionados += 1;
    for (const violacao of inspecionarArquivo(nome, item.conteudo, item.linhas ?? null)) {
      violacoes.push(violacao);
    }
  }

  return {
    aprovado: violacoes.length === 0,
    violacoes,
    arquivosInspecionados: inspecionados,
  };
}

/**
 * Inspeciona um arquivo já validado.
 *
 * A classificação roda sobre o conteúdo **inteiro**, e só depois o recorte de
 * `linhasNoAlcance` descarta as ocorrências fora do alcance. É o que permite
 * inspecionar apenas as linhas adicionadas nos quatro arquivos preexistentes sem
 * perder o contexto de comentário de bloco que começa antes delas.
 */
function inspecionarArquivo(
  arquivo: string,
  conteudo: string,
  linhasNoAlcance: readonly number[] | null,
): readonly ViolacaoIndependencia[] {
  const encontradas: ViolacaoIndependencia[] = [];
  const marcas = classificarRegioes(conteudo);
  const inicios = iniciosDeLinha(conteudo);
  const alcance = linhasNoAlcance === null ? null : new Set(linhasNoAlcance);
  if (alcance !== null && alcance.size === 0) return encontradas;

  // Uma máscara por combinação de regiões, reaproveitada entre regras iguais.
  const mascaras = new Map<string, string>();

  for (const regra of REGRAS_INDEPENDENCIA) {
    const chave = regra.regioes.join('+');
    let mascara = mascaras.get(chave);
    if (mascara === undefined) {
      mascara = mascarar(conteudo, marcas, regra.regioes);
      mascaras.set(chave, mascara);
    }

    // Expressão nova a cada chamada: `lastIndex` é estado mutável, e estado
    // compartilhado quebraria o determinismo entre chamadas.
    const expressao = new RegExp(regra.padrao, regra.marcas);
    let achado = expressao.exec(mascara);

    while (achado !== null) {
      const posicao = achado.index;
      const bruto = achado[0];

      if (bruto.length === 0) {
        expressao.lastIndex += 1;
      } else {
        const linha = linhaDe(inicios, posicao);
        if (alcance === null || alcance.has(linha)) {
          const inicioDaLinha = inicios[linha - 1] ?? 0;
          encontradas.push({
            arquivo,
            identificador: regra.identificador,
            rotulo: regra.rotulo,
            // O recorte sai do conteúdo original, não da máscara: o operador
            // precisa ver o que está escrito, não o texto com buracos.
            trecho: recortar(conteudo.slice(posicao, posicao + bruto.length)),
            linha,
            coluna: posicao - inicioDaLinha + 1,
            regiao: regiaoDaPosicao(marcas, posicao, regra.regioes),
            motivo: regra.motivo,
          });
        }
      }

      achado = expressao.exec(mascara);
    }
  }

  return encontradas;
}

/** A região em que a ocorrência começou, entre as que a regra inspeciona. */
function regiaoDaPosicao(
  marcas: Uint8Array,
  posicao: number,
  regioes: readonly RegiaoInspecionada[],
): RegiaoInspecionada | 'nenhuma' {
  const codigo = marcaEm(marcas, posicao);
  for (const nome of regioes) {
    if (CODIGO_DE_REGIAO[nome] === codigo) return nome;
  }
  return 'nenhuma';
}

// ═════════════════════════════════════════════════════════════════════════════
// Mensagem
// ═════════════════════════════════════════════════════════════════════════════

const NOME_DA_REGIAO: Readonly<Record<RegiaoInspecionada | 'nenhuma', string>> = {
  codigo: 'em código',
  texto: 'em literal de texto',
  importacao: 'em especificador de importação',
  nenhuma: 'sem região',
};

/**
 * Monta a mensagem de falha em pt-BR, com **arquivo e identificador** de cada
 * violação — a forma exigida pelo requisito 12.10. É o texto que a spec da
 * tarefa 11.3 entrega ao operador quando reprova.
 */
export function formatarViolacoes(
  violacoes: readonly ViolacaoIndependencia[],
): string {
  if (violacoes.length === 0) {
    return 'Independence_Check: nenhuma violação de independência encontrada.';
  }

  const plural = violacoes.length === 1 ? 'violação' : 'violações';
  const linhas: string[] = [
    `Independence_Check: ${violacoes.length} ${plural} de independência (requisito 12).`,
  ];

  for (let i = 0; i < violacoes.length; i += 1) {
    const v = violacoes[i];
    if (v === undefined) continue;
    const local = v.linha > 0 ? `${v.arquivo}:${v.linha}:${v.coluna}` : v.arquivo;
    const onde = NOME_DA_REGIAO[v.regiao];
    const achado = v.trecho === '' ? '' : ` — encontrado ${onde}: «${v.trecho}»`;
    linhas.push(
      `  ${i + 1}. ${local} — ${v.identificador} (${v.rotulo})${achado}. ${v.motivo}`,
    );
  }

  return linhas.join('\n');
}
