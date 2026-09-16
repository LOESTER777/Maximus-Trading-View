/**
 * `independence-check.spec` — a `Independence_Check` como falha de suíte.
 * Spec `bookmap-no-mapa-de-decisao`, tarefa 11.3. Requisitos 12.10 e 12.11.
 *
 * **Validates: Requirements 12.10, 12.11**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A verificação de independência tem três peças. O núcleo puro
 * (`independence-check.core`, tarefa 11.1) decide "isto é violação?". O executor
 * (`independence-check.runner`, tarefa 11.2) resolve qual conjunto de arquivos
 * inspecionar e lê o disco. **Este arquivo é a terceira**: é o que transforma o
 * resultado em falha da suíte automatizada, que é o verbo exato do requisito
 * 12.10 — «SHALL falhar a suíte automatizada da feature e SHALL informar o
 * arquivo e o identificador encontrados».
 *
 * Sem este arquivo as outras duas peças são biblioteca: alguém precisaria
 * lembrar de executá-las. Com ele, a independência das conexões MT5 deixa de
 * depender de inspeção manual e passa a reprovar sozinha, em cada execução da
 * suíte, para sempre.
 *
 * Os quatro grupos de casos:
 *
 * | Grupo | O que prova | Requisito |
 * |---|---|---|
 * | árvore real aprova | a feature, como está, é independente | 12.9, 12.10 |
 * | sintético reprova | a verificação **detecta**, e informa arquivo e identificador | 12.10 |
 * | indeterminação reprova | ausência de conclusão nunca vira aprovação | 12.11 |
 * | recorte é indispensável | por que as linhas preexistentes ficam fora do alcance | 12.9 |
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ A ARMADILHA CENTRAL — ESTE ARQUIVO SE INSPECIONA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo mora dentro de `frontend/src/components/decision/bookmap`, que o
 * executor registra como raiz criada pela feature. Logo **a verificação
 * inspeciona este arquivo integralmente**, e o grupo de casos sintéticos exige,
 * por definição, um conteúdo que contenha identificador proibido.
 *
 * Escrever `Bridge` seguido de `ResolverService` numa única cadeia reprovaria a
 * verificação **a partir do próprio arquivo de teste** — o que já aconteceu na
 * sondagem da tarefa 11.2 e em sete testes da tarefa 11.4. A saída adotada é a
 * mesma que o núcleo usa para si: **os identificadores proibidos são montados em
 * tempo de execução**, por concatenação, na tabela `PECAS` abaixo. Cada metade,
 * isolada, não casa com nenhuma regra; a cadeia inteira só existe em memória,
 * durante a execução, nunca no texto do arquivo.
 *
 * A verificação distingue região, e comentário **nunca** é inspecionado — então
 * este bloco de documentação poderia citar os identificadores em prosa sem
 * reprovar nada. Mesmo assim ele não os cita: o custo de manter a disciplina em
 * todo o arquivo é baixo, e depender da classificação de região justamente aqui
 * seria trocar uma garantia por uma sutileza.
 *
 * ⚠️ **A saída que NÃO foi tomada: excluir este arquivo da varredura.** Isolar a
 * si mesmo abriria um buraco permanente — e um arquivo de teste fora do alcance
 * é exatamente onde alguém esconderia uma referência real, com a desculpa de que
 * «é só um fixture». Em vez disso, o primeiro grupo de casos **fecha o ciclo**:
 * ele afirma que este caminho está entre os arquivos inspecionados e que a
 * verificação aprovou. Se alguém escrever aqui uma referência de verdade, este
 * mesmo teste reprova. O guarda da armadilha é o teste, não uma exceção.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTO, E POR QUE A VERIFICAÇÃO REAL RODA UMA VEZ SÓ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `executarIndependenceCheck` lê dezenas de arquivos do disco e consulta o
 * repositório uma vez por arquivo. É a única parte cara desta suíte, e ela é
 * **determinística**: o mesmo repositório devolve o mesmo resultado.
 *
 * Por isso a execução real é memoizada em `verificacaoReal` e compartilhada por
 * todos os casos do primeiro grupo, em vez de repetida por caso. O quarto grupo
 * precisa de uma segunda execução — é o ponto dele, comparar com e sem recorte —
 * e essa também é memoizada. Duas execuções no total, medidas e reportadas.
 *
 * ⚠️ Não trocar a memoização por `beforeAll` com estado mutável: o valor é
 * imutável e a função preguiçosa dá o mesmo resultado com menos maquinaria.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO AS FALHAS FALAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O caso principal compara **o texto do relatório** com o texto de aprovação, em
 * vez de afirmar `aprovado === true`. A diferença importa na hora da falha: um
 * booleano produz «esperava true, recebeu false», que não diz nada; o texto
 * produz a lista completa de violações, cada uma com arquivo, linha, coluna,
 * identificador e motivo — que é precisamente o que o requisito 12.10 manda
 * informar, entregue a quem estiver lendo a saída da suíte.
 *
 * Convenções: identificadores em inglês, comentários e texto ao operador em
 * pt-BR.
 */
import { describe, expect, it } from 'vitest';

import {
  REGRAS_INDEPENDENCIA,
  checkIndependence,
  formatarViolacoes,
  violacaoDeIndeterminacao,
  type IdentificadorProibido,
  type ViolacaoIndependencia,
} from '../independence-check.core';
import {
  REF_LINHA_DE_BASE,
  executarIndependenceCheck,
  formatarRelatorio,
  type PortaDeArquivos,
  type PortaDeProcesso,
  type ResultadoDoExecutor,
} from '../independence-check.runner';

// ═════════════════════════════════════════════════════════════════════════════
// A execução real, uma vez só
// ═════════════════════════════════════════════════════════════════════════════

/** Caminho deste próprio arquivo, como o executor o reporta. */
const ESTE_ARQUIVO =
  'frontend/src/components/decision/bookmap/__tests__/independence-check.spec.ts';

/** A raiz que o executor registra como criada pela feature. */
const RAIZ_DA_FEATURE = 'frontend/src/components/decision/bookmap/';

/** O texto que o núcleo produz quando não há violação alguma. */
const SEM_VIOLACAO = 'Independence_Check: nenhuma violação de independência encontrada.';

let memoriaReal: ResultadoDoExecutor | null = null;
let memoriaSemRecorte: ResultadoDoExecutor | null = null;

/**
 * A verificação contra o repositório real, com **todos os padrões** — nenhuma
 * porta injetada, nenhuma opção. É de propósito: é o caminho que roda em
 * produção da suíte, e testá-lo com porta injetada testaria outra coisa.
 */
function verificacaoReal(): ResultadoDoExecutor {
  if (memoriaReal === null) memoriaReal = executarIndependenceCheck();
  return memoriaReal;
}

/** A mesma verificação com o recorte de linhas preexistentes desligado. */
function verificacaoSemRecorte(): ResultadoDoExecutor {
  if (memoriaSemRecorte === null) {
    memoriaSemRecorte = executarIndependenceCheck({ recortarPreexistentes: false });
  }
  return memoriaSemRecorte;
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A primeira violação, com falha explícita quando não há nenhuma.
 *
 * Existe porque o projeto compila com `noUncheckedIndexedAccess`: indexar um
 * vetor devolve `T | undefined`. Afirmar com `!` esconderia o caso vazio atrás
 * de um erro de acesso a propriedade de `undefined`; esta função o transforma na
 * mensagem que descreve o que faltou.
 */
function primeiraViolacao(
  violacoes: readonly ViolacaoIndependencia[],
): ViolacaoIndependencia {
  const v = violacoes[0];
  if (v === undefined) {
    throw new Error(
      'esperava ao menos uma violação e a verificação não devolveu nenhuma: ' +
        'o conteúdo sintético deixou de casar com a regra que ele deveria exercitar.',
    );
  }
  return v;
}

/** Junta linhas num conteúdo de arquivo, com quebra final. */
function comoArquivo(...linhas: readonly string[]): string {
  return `${linhas.join('\n')}\n`;
}

/** Os identificadores distintos presentes numa lista de violações. */
function identificadoresDe(
  violacoes: readonly ViolacaoIndependencia[],
): readonly IdentificadorProibido[] {
  const vistos = new Set<IdentificadorProibido>();
  for (let i = 0; i < violacoes.length; i += 1) {
    const v = violacoes[i];
    if (v !== undefined) vistos.add(v.identificador);
  }
  return [...vistos].sort();
}

// ═════════════════════════════════════════════════════════════════════════════
// As peças proibidas, montadas em tempo de execução
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cada cadeia proibida, partida em pedaços que **nenhuma regra casa
 * isoladamente**. Ver a seção da armadilha no cabeçalho.
 *
 * ⚠️ Ao acrescentar peça, conferir os dois lados: (a) que a cadeia montada casa
 * a regra pretendida, o que o caso sintético correspondente prova; e (b) que
 * cada pedaço, sozinho, **não** casa nada — o que o primeiro grupo de casos
 * prova, porque ele inspeciona este arquivo. O corte deve cair **dentro** do
 * trecho que a regra procura, nunca antes dele: partir
 * `TickPositionMonitorService` em `Tick` e o resto deixaria a segunda metade
 * casando a regra de serviço de gestão de posição sozinha.
 */
const PECAS = {
  roteamentoDeBridge: `${'Bridge'}${'ResolverService'}`,
  feedDeTick: `${'WebSocket'}${'TickClientService'}`,
  execucaoDeOrdem: `${'Order'}${'ExecutionService'}`,
  bridgeDeSinal: `${'B3Signal'}${'ExecutionBridge'}`,
  conectorDeTerminal: `${'connectors/'}${'mt5/cliente-de-terminal'}`,
  enderecoDeBridge: `${'http://127.0.0.1:'}${'8229'}`,
  contaDoOperador: `${'1932'}${'4625'}`,
  tabelaDePosicoes: `${'active_'}${'positions'}`,
  servicoDePosicao: `${'Position'}${'ManagementService'}`,
  ticketDeOrdem: `${'mt5'}${'Ticket'}`,
  credencialDeBridge: `${'bridge'}${'Token'}`,
  caminhoTabular: `dados/livro-do-dia.${'csv'}`,
  escritaEmTabela: `${'INSERT'}${' INTO '}${'bookmap'}${'_depth (ts, preco) VALUES (1, 2)'}`,
} as const;

/** Um arquivo sintético e o identificador que ele deve provocar. */
interface CasoSintetico {
  readonly identificador: IdentificadorProibido;
  readonly rotulo: string;
  readonly arquivo: string;
  readonly conteudo: string;
}

/**
 * Um caso por identificador proibido declarado — a cobertura é conferida pelo
 * teste que compara este conjunto com `REGRAS_INDEPENDENCIA`.
 *
 * Os caminhos são fictícios de propósito (`sintetico/...`): nenhum deles existe
 * no disco, o que deixa claro na mensagem de falha que a origem é este teste e
 * não um arquivo do repositório.
 */
const CASOS_SINTETICOS: readonly CasoSintetico[] = [
  {
    identificador: 'SERVICO_ROTEAMENTO_BRIDGE',
    rotulo: 'serviço de roteamento de bridge no código',
    arquivo: 'sintetico/roteamento-de-bridge.ts',
    conteudo: comoArquivo(
      'export function resolver() {',
      `  const alvo = new ${PECAS.roteamentoDeBridge}();`,
      '  return alvo;',
      '}',
    ),
  },
  {
    identificador: 'SERVICO_FEED_TICK',
    rotulo: 'serviço de feed de tick no código',
    arquivo: 'sintetico/feed-de-tick.ts',
    conteudo: comoArquivo(`const feed = new ${PECAS.feedDeTick}();`, 'export default feed;'),
  },
  {
    identificador: 'SERVICO_EXECUCAO_ORDEM',
    rotulo: 'serviço de execução de ordem no código',
    arquivo: 'sintetico/execucao-de-ordem.ts',
    conteudo: comoArquivo(`export const executor = ${PECAS.execucaoDeOrdem};`),
  },
  {
    identificador: 'BRIDGE_EXECUCAO_SINAL_B3',
    rotulo: 'bridge de execução de sinal B3 no código',
    arquivo: 'sintetico/bridge-de-sinal.ts',
    conteudo: comoArquivo(`export type Ponte = ${PECAS.bridgeDeSinal};`),
  },
  {
    identificador: 'IMPORTACAO_CONECTOR_TERMINAL',
    rotulo: 'importação de conector de terminal no especificador',
    arquivo: 'sintetico/importa-conector.ts',
    conteudo: comoArquivo(
      `import { cliente } from '${PECAS.conectorDeTerminal}';`,
      'export default cliente;',
    ),
  },
  {
    identificador: 'ENDERECO_REDE_BRIDGE',
    rotulo: 'endereço de rede de bridge em literal',
    arquivo: 'sintetico/endereco-de-bridge.ts',
    conteudo: comoArquivo(`export const base = '${PECAS.enderecoDeBridge}';`),
  },
  {
    identificador: 'CONTA_REAL',
    rotulo: 'conta do operador em literal numérico',
    arquivo: 'sintetico/conta-do-operador.ts',
    conteudo: comoArquivo(`export const conta = ${PECAS.contaDoOperador};`),
  },
  {
    identificador: 'TABELA_POSICOES_ATIVAS',
    rotulo: 'tabela de posições ativas em consulta',
    arquivo: 'sintetico/consulta-posicoes.ts',
    conteudo: comoArquivo(`export const sql = 'SELECT 1 FROM ${PECAS.tabelaDePosicoes}';`),
  },
  {
    identificador: 'SERVICO_GESTAO_POSICAO',
    rotulo: 'serviço de gestão de posição no código',
    arquivo: 'sintetico/gestao-de-posicao.ts',
    conteudo: comoArquivo(`export declare const gestor: ${PECAS.servicoDePosicao};`),
  },
  {
    identificador: 'TICKET_DE_ORDEM',
    rotulo: 'ticket de ordem como campo',
    arquivo: 'sintetico/ticket-de-ordem.ts',
    conteudo: comoArquivo(`export const alvo = registro.${PECAS.ticketDeOrdem};`),
  },
  {
    identificador: 'CREDENCIAL_DE_CONTA',
    rotulo: 'credencial de bridge como campo',
    arquivo: 'sintetico/credencial.ts',
    conteudo: comoArquivo(`export const cabecalho = opcoes.${PECAS.credencialDeBridge};`),
  },
  {
    identificador: 'LEITURA_DE_CSV',
    rotulo: 'caminho de arquivo de dado tabular em literal',
    arquivo: 'sintetico/caminho-tabular.ts',
    conteudo: comoArquivo(`export const caminho = '${PECAS.caminhoTabular}';`),
  },
  {
    identificador: 'ESCRITA_EM_TABELA_DE_BOOKMAP',
    rotulo: 'escrita em tabela de bookmap em consulta',
    arquivo: 'sintetico/escrita-em-bookmap.ts',
    conteudo: comoArquivo(`export const sql = '${PECAS.escritaEmTabela}';`),
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Grupo 1 — a árvore real aprova
// ═════════════════════════════════════════════════════════════════════════════

describe('Independence_Check — a árvore real (requisitos 12.9, 12.10)', () => {
  it('aprova, sem nenhuma violação de independência', () => {
    const resultado = verificacaoReal();

    // O relatório inteiro entra na comparação de propósito: quando reprovar, a
    // saída da suíte já traz arquivo, linha, identificador e motivo de cada
    // ocorrência, que é a informação exigida pelo requisito 12.10.
    expect(formatarRelatorio(resultado)).toContain(SEM_VIOLACAO);
    expect(resultado.violacoes).toEqual([]);
    expect(resultado.aprovado).toBe(true);
  });

  it('inspecionou este próprio arquivo de teste, integralmente', () => {
    // ⚠️ Este é o guarda da armadilha do cabeçalho. A verificação não abre
    // exceção para si mesma: se este arquivo saísse do conjunto, a aprovação
    // acima passaria a valer para uma árvore que não o contém, e qualquer
    // referência escondida aqui ficaria invisível para sempre.
    const resultado = verificacaoReal();
    const diagnostico = resultado.diagnostico;
    expect(diagnostico).not.toBeNull();
    if (diagnostico === null) return;

    const eu = diagnostico.arquivos.find((a) => a.caminho === ESTE_ARQUIVO);
    expect(eu, `${ESTE_ARQUIVO} não entrou no conjunto inspecionado`).toBeDefined();
    if (eu === undefined) return;

    expect(eu.origem).toBe('CRIADO');
    expect(eu.alcance).toBe('INTEGRAL');
    expect(eu.linhasNoAlcance).toBeNull();
    expect(eu.linhasNoArquivo).toBeGreaterThan(0);
  });

  it('resolveu a linha de base registrada para um commit', () => {
    const diagnostico = verificacaoReal().diagnostico;
    expect(diagnostico).not.toBeNull();
    if (diagnostico === null) return;

    expect(diagnostico.refLinhaDeBase).toBe(REF_LINHA_DE_BASE);
    // Identificador completo de commit: quarenta dígitos hexadecimais.
    expect(diagnostico.refResolvidoPara).toMatch(/^[0-9a-f]{40}$/);
  });

  it('cobre os três escopos do requisito 12.9', () => {
    const diagnostico = verificacaoReal().diagnostico;
    expect(diagnostico).not.toBeNull();
    if (diagnostico === null) return;

    const criados = diagnostico.arquivos.filter((a) => a.origem === 'CRIADO');
    const preexistentes = diagnostico.arquivos.filter((a) => a.origem === 'PREEXISTENTE');
    const doFechamento = diagnostico.arquivos.filter((a) => a.origem === 'FECHAMENTO');

    expect(criados.length).toBeGreaterThan(0);
    expect(preexistentes.length).toBeGreaterThan(0);
    expect(doFechamento.length).toBeGreaterThan(0);

    // Tudo que a feature criou é inspecionado integralmente — é o que o
    // requisito 12.9 chama de «totalidade de cada arquivo criado».
    for (const a of criados) {
      expect(a.alcance, `${a.caminho} deveria ser inspecionado integralmente`).toBe(
        'INTEGRAL',
      );
    }

    // ⚠️ Não vale afirmar que todo arquivo criado mora sob a raiz da feature: o
    // executor também registra arquivos que a feature criou **dentro de
    // diretórios que a precedem**, e esses ficam fora dessa raiz.
    //
    // O que vale afirmar é que as três peças da própria verificação entraram no
    // conjunto — o núcleo, o executor e esta spec. É a forma concreta de dizer
    // que a verificação não se poupa.
    const caminhosCriados = new Set(criados.map((a) => a.caminho));
    expect(caminhosCriados.has(`${RAIZ_DA_FEATURE}independence-check.core.ts`)).toBe(true);
    expect(caminhosCriados.has(`${RAIZ_DA_FEATURE}independence-check.runner.ts`)).toBe(
      true,
    );
    expect(caminhosCriados.has(ESTE_ARQUIVO)).toBe(true);

    // O fechamento é restrito a módulos do próprio repositório: nenhum
    // especificador externo entra como arquivo.
    expect(diagnostico.modulosDoFechamento.length).toBe(doFechamento.length);
  });

  it('mantém as linhas preexistentes fora do alcance onde há linha de base', () => {
    const diagnostico = verificacaoReal().diagnostico;
    expect(diagnostico).not.toBeNull();
    if (diagnostico === null) return;

    const recortados = diagnostico.arquivos.filter(
      (a) => a.alcance === 'LINHAS_ADICIONADAS',
    );
    expect(recortados.length).toBeGreaterThan(0);

    for (const a of recortados) {
      // Recorte de verdade: menos linhas no alcance do que no arquivo, e ao
      // menos uma linha adicionada — registro que apodreceu viraria
      // indeterminação no executor, não recorte vazio.
      expect(a.linhasNoAlcance).not.toBeNull();
      const noAlcance = a.linhasNoAlcance ?? 0;
      expect(noAlcance).toBeGreaterThan(0);
      expect(noAlcance).toBeLessThan(a.linhasNoArquivo);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Grupo 2 — o sintético reprova, informando arquivo e identificador
// ═════════════════════════════════════════════════════════════════════════════

describe('Independence_Check — conteúdo proibido reprova (requisito 12.10)', () => {
  it('reprova e informa o arquivo e o identificador encontrados', () => {
    const arquivo = 'sintetico/gate-que-nao-deveria-existir.ts';
    const conteudo = comoArquivo(
      'export function decidir() {',
      `  const roteador = new ${PECAS.roteamentoDeBridge}();`,
      '  return roteador.resolveForAsset("WINV26");',
      '}',
    );

    const resultado = checkIndependence([{ arquivo, conteudo }]);

    expect(resultado.aprovado).toBe(false);
    expect(resultado.violacoes).toHaveLength(1);

    const v = primeiraViolacao(resultado.violacoes);
    expect(v.arquivo).toBe(arquivo);
    expect(v.identificador).toBe('SERVICO_ROTEAMENTO_BRIDGE');
    expect(v.regiao).toBe('codigo');
    expect(v.linha).toBe(2);
    expect(v.coluna).toBeGreaterThan(0);
    expect(v.trecho).toBe(PECAS.roteamentoDeBridge);

    // O requisito 12.10 exige que a falha **informe** arquivo e identificador.
    // Não basta estarem no objeto: precisam chegar à mensagem que o operador lê.
    const mensagem = formatarViolacoes(resultado.violacoes);
    expect(mensagem).toContain(arquivo);
    expect(mensagem).toContain('SERVICO_ROTEAMENTO_BRIDGE');
    expect(mensagem).toContain('serviço de roteamento de bridge');
    expect(mensagem).toContain(':2:');
  });

  // Um caso por identificador declarado. Laço em vez de `it.each` de propósito:
  // a tabela é tipada (`CasoSintetico`), e a desestruturação de tupla do `each`
  // perderia esse tipo sem ganhar nada em legibilidade da saída.
  for (const caso of CASOS_SINTETICOS) {
    it(`detecta ${caso.rotulo}`, () => {
      const resultado = checkIndependence([
        { arquivo: caso.arquivo, conteudo: caso.conteudo },
      ]);

      expect(resultado.aprovado).toBe(false);
      expect(identificadoresDe(resultado.violacoes)).toContain(caso.identificador);

      const mensagem = formatarViolacoes(resultado.violacoes);
      expect(mensagem).toContain(caso.arquivo);
      expect(mensagem).toContain(caso.identificador);
    });
  }

  it('tem um caso sintético para cada identificador que as regras declaram', () => {
    // Guarda contra apodrecimento: uma regra nova sem caso sintético entraria em
    // produção sem nunca ter sido exercitada. `INDETERMINACAO` fica de fora
    // porque não vem de regra — é o desfecho do requisito 12.11, coberto no
    // grupo seguinte.
    const declarados = new Set<IdentificadorProibido>();
    for (const regra of REGRAS_INDEPENDENCIA) declarados.add(regra.identificador);
    declarados.delete('INDETERMINACAO');

    const exercitados = new Set<IdentificadorProibido>();
    for (const caso of CASOS_SINTETICOS) exercitados.add(caso.identificador);

    expect([...exercitados].sort()).toEqual([...declarados].sort());
  });

  it('não reprova por citação em comentário, que é o que permite a feature aprovar', () => {
    // O núcleo classifica região justamente por isto: vários arquivos desta
    // feature **declaram em prosa** a ausência do que a verificação proíbe. Uma
    // busca por substring reprovaria a feature pelo comentário que a defende.
    const conteudo = comoArquivo(
      '/**',
      ` * Esta camada não conhece ${PECAS.roteamentoDeBridge} nem a conta`,
      ` * ${PECAS.contaDoOperador}, e não carrega ${PECAS.credencialDeBridge}.`,
      ' */',
      `// Também não usa ${PECAS.execucaoDeOrdem}.`,
      'export const inofensivo = true;',
    );

    const resultado = checkIndependence([{ arquivo: 'sintetico/so-prosa.ts', conteudo }]);

    expect(formatarViolacoes(resultado.violacoes)).toBe(SEM_VIOLACAO);
    expect(resultado.aprovado).toBe(true);
    expect(resultado.arquivosInspecionados).toBe(1);
  });

  it('não reprova a consulta de leitura das tabelas de bookmap, que é o que a feature faz', () => {
    // Só escrita e alteração de estrutura são proibidas (requisitos 12.3 e
    // 12.5). Marcar `SELECT` reprovaria o caminho de dado da própria feature.
    const conteudo = comoArquivo(
      `export const sql = 'SELECT ts, preco FROM ${'bookmap'}${'_depth'} WHERE dia = $1';`,
    );

    const resultado = checkIndependence([{ arquivo: 'sintetico/leitura.ts', conteudo }]);

    expect(formatarViolacoes(resultado.violacoes)).toBe(SEM_VIOLACAO);
    expect(resultado.aprovado).toBe(true);
  });

  it('respeita o recorte de linhas: ocorrência fora do alcance não reprova', () => {
    // É a mecânica que sustenta o requisito 12.9 nos arquivos preexistentes.
    const conteudo = comoArquivo(
      `const preexistente = new ${PECAS.execucaoDeOrdem}();`,
      'const adicionada = 1;',
      `const tambemPreexistente = ${PECAS.contaDoOperador};`,
    );

    const soALinhaDois = checkIndependence([
      { arquivo: 'sintetico/preexistente.ts', conteudo, linhas: [2] },
    ]);
    expect(formatarViolacoes(soALinhaDois.violacoes)).toBe(SEM_VIOLACAO);
    expect(soALinhaDois.aprovado).toBe(true);

    // Sem recorte, as duas ocorrências aparecem — o conteúdo é o mesmo.
    const arquivoInteiro = checkIndependence([
      { arquivo: 'sintetico/preexistente.ts', conteudo },
    ]);
    expect(arquivoInteiro.aprovado).toBe(false);
    expect(arquivoInteiro.violacoes).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Grupo 3 — indeterminação é violação
// ═════════════════════════════════════════════════════════════════════════════

describe('Independence_Check — indeterminação reprova (requisito 12.11)', () => {
  /** Uma porta de arquivos que nunca é consultada: o repositório falha antes. */
  const arquivosInertes: PortaDeArquivos = {
    existe: () => false,
    ehDiretorio: () => false,
    ler: () => {
      throw new Error('a porta de arquivos inerte não lê nada.');
    },
    listar: () => [],
  };

  it('reprova quando o repositório não pode ser consultado', () => {
    // ⚠️ A porta injetada é o que permite provar isto **sem quebrar o
    // repositório**: nenhum comando real é executado.
    const processoQueFalha: PortaDeProcesso = () => {
      throw new Error('comando indisponível nesta máquina.');
    };

    const resultado = executarIndependenceCheck({
      processo: processoQueFalha,
      arquivos: arquivosInertes,
    });

    expect(resultado.aprovado).toBe(false);
    expect(identificadoresDe(resultado.violacoes)).toEqual(['INDETERMINACAO']);
    expect(resultado.arquivosInspecionados).toBe(0);
    expect(resultado.diagnostico).toBeNull();

    const mensagem = formatarRelatorio(resultado);
    expect(mensagem).toContain('INDETERMINACAO');
    expect(mensagem).toContain('a resolução do conjunto não pôde ser concluída');
  });

  it('reprova quando o ref de linha de base não resolve', () => {
    // Ref sintaticamente válido e inexistente: o comando roda de verdade e
    // falha, que é o caso de um registro de linha de base apodrecido.
    const refInexistente = '0'.repeat(40);

    const resultado = executarIndependenceCheck({ refLinhaDeBase: refInexistente });

    expect(resultado.aprovado).toBe(false);
    expect(identificadoresDe(resultado.violacoes)).toEqual(['INDETERMINACAO']);
    expect(resultado.diagnostico).toBeNull();
    expect(formatarRelatorio(resultado)).toContain(refInexistente);
  });

  it('reprova quando o ref resolve para vazio', () => {
    const processoMudo: PortaDeProcesso = () => '';

    const resultado = executarIndependenceCheck({
      processo: processoMudo,
      arquivos: arquivosInertes,
    });

    expect(resultado.aprovado).toBe(false);
    expect(identificadoresDe(resultado.violacoes)).toEqual(['INDETERMINACAO']);
  });

  it('reprova quando o conjunto de arquivos não pode ser determinado', () => {
    // O repositório responde e a linha de base resolve, mas o disco não tem a
    // raiz registrada como criada pela feature. É o registro que apodreceu — e
    // seguir em frente aprovaria por omissão, inspecionando nada.
    const commitFalso = 'a'.repeat(40);
    const processoQueResolve: PortaDeProcesso = (_programa, argumentos) =>
      argumentos[0] === 'rev-parse' ? `${commitFalso}\n` : '';

    const resultado = executarIndependenceCheck({
      processo: processoQueResolve,
      arquivos: arquivosInertes,
    });

    expect(resultado.aprovado).toBe(false);
    expect(identificadoresDe(resultado.violacoes)).toContain('INDETERMINACAO');
    expect(resultado.arquivosInspecionados).toBe(0);
  });

  it('reprova quando nenhum arquivo chega ao núcleo', () => {
    const resultado = checkIndependence([]);

    expect(resultado.aprovado).toBe(false);
    const v = primeiraViolacao(resultado.violacoes);
    expect(v.identificador).toBe('INDETERMINACAO');
    expect(v.linha).toBe(0);
    expect(v.coluna).toBe(0);
    expect(v.regiao).toBe('nenhuma');
    expect(formatarViolacoes(resultado.violacoes)).toContain('INDETERMINACAO');
  });

  it('reprova quando um arquivo chega sem conteúdo utilizável', () => {
    // Conteúdo vazio é o desfecho plausível de uma leitura que falhou em
    // silêncio. Aprovar aqui seria aprovar exatamente o arquivo que não se leu.
    const resultado = checkIndependence([
      { arquivo: 'sintetico/nao-lido.ts', conteudo: '' },
    ]);

    expect(resultado.aprovado).toBe(false);
    const v = primeiraViolacao(resultado.violacoes);
    expect(v.identificador).toBe('INDETERMINACAO');
    expect(v.arquivo).toBe('sintetico/nao-lido.ts');
    expect(resultado.arquivosInspecionados).toBe(0);
  });

  it('reprova quando um item da lista chega sem caminho', () => {
    const resultado = checkIndependence([
      { arquivo: '', conteudo: 'export const x = 1;\n' },
    ]);

    expect(resultado.aprovado).toBe(false);
    expect(primeiraViolacao(resultado.violacoes).identificador).toBe('INDETERMINACAO');
  });

  it('trata indeterminação como violação também quando o resto está limpo', () => {
    // A composição importa: um arquivo íntegro ao lado de um ilegível **não**
    // aprova. Basta uma indeterminação para o conjunto todo reprovar.
    const resultado = checkIndependence([
      { arquivo: 'sintetico/integro.ts', conteudo: 'export const x = 1;\n' },
      { arquivo: 'sintetico/ilegivel.ts', conteudo: '' },
    ]);

    expect(resultado.aprovado).toBe(false);
    expect(resultado.arquivosInspecionados).toBe(1);
    expect(identificadoresDe(resultado.violacoes)).toEqual(['INDETERMINACAO']);
  });

  it('a violação de indeterminação carrega motivo em pt-BR e arquivo identificável', () => {
    const v = violacaoDeIndeterminacao('o repositório não respondeu.', 'sintetico/x.ts');

    expect(v.identificador).toBe('INDETERMINACAO');
    expect(v.arquivo).toBe('sintetico/x.ts');
    expect(v.motivo).toBe('o repositório não respondeu.');

    // Sem arquivo, o motivo aponta para o conjunto, nunca para lugar nenhum.
    expect(violacaoDeIndeterminacao('sem conjunto.').arquivo).toBe(
      '(conjunto de arquivos)',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Grupo 4 — o recorte de linhas preexistentes é indispensável
// ═════════════════════════════════════════════════════════════════════════════

describe('Independence_Check — o recorte é indispensável (requisito 12.9)', () => {
  it('sem o recorte, reprova por código que esta feature nunca escreveu', () => {
    // Este caso é a razão de o requisito 12.9 mandar manter as linhas
    // preexistentes fora do alcance. Sem o recorte, o conjunto cresce — as
    // importações preexistentes dos arquivos tocados entram no fechamento — e a
    // verificação passa a reprovar por texto de módulos que a feature apenas
    // atravessou. Seria uma verificação severa em vez de verdadeira.
    const semRecorte = verificacaoSemRecorte();

    expect(semRecorte.aprovado).toBe(false);
    expect(semRecorte.violacoes.length).toBeGreaterThan(0);
    expect(identificadoresDe(semRecorte.violacoes)).not.toContain('INDETERMINACAO');

    // As violações vêm de fora da feature: é o que caracteriza o falso positivo.
    const forasteiras = semRecorte.violacoes.filter(
      (v) => !v.arquivo.startsWith(RAIZ_DA_FEATURE),
    );
    expect(forasteiras.length).toBeGreaterThan(0);
  });

  it('com o recorte, os mesmos arquivos deixam de reprovar', () => {
    // O par com o caso acima: a diferença entre reprovar e aprovar é **só** o
    // recorte, sobre a mesma árvore, no mesmo instante.
    const comRecorte = verificacaoReal();
    const semRecorte = verificacaoSemRecorte();

    expect(comRecorte.aprovado).toBe(true);
    expect(semRecorte.aprovado).toBe(false);

    // Nenhum arquivo que reprovava sem recorte reprova com ele.
    const culpados = new Set(semRecorte.violacoes.map((v) => v.arquivo));
    for (const v of comRecorte.violacoes) {
      expect(culpados.has(v.arquivo)).toBe(false);
    }

    // E o conjunto inspecionado é menor com o recorte, porque o fechamento não
    // arrasta as dependências preexistentes.
    expect(comRecorte.arquivosInspecionados).toBeLessThan(
      semRecorte.arquivosInspecionados,
    );
  });
});
