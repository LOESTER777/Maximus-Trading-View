/**
 * Property 3 — A camada nunca intercepta ponteiro. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 6.4.
 *
 * ```
 * 'hitTest' ∉ BookmapPrimitive.prototype  ∧  'hitTest' ∉ instância
 * ```
 *
 * **Validates: Requirements 1.7**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA PROPRIEDADE É DIFERENTE DAS OUTRAS ONZE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As demais quantificam sobre **dados**: dado tal entra, resultado tal sai. Esta
 * quantifica sobre **construção**. A garantia não é "o método devolve ausência
 * de item apontado" — é que **o método não existe**.
 *
 * A distinção é o mecanismo inteiro. A biblioteca de gráfico só consulta a
 * camada para acerto de ponteiro quando o membro está presente; ausente, não há
 * caminho de código da biblioteca até a camada quando o cursor se move. A camada
 * fica estruturalmente incapaz de receber evento — é garantia de tipo, não
 * convenção de folha de estilo nem propriedade de CSS que desliga o ponteiro,
 * como acontece nas sete camadas de sobreposição em DOM que já existem no
 * gráfico.
 *
 * Um membro que existisse e devolvesse ausência de item seria mais fraco em dois
 * sentidos: passaria a ser chamado a cada movimento de cursor (custo por quadro
 * que o orçamento de desempenho não prevê) e uma linha alterada dentro dele
 * bastaria para a camada começar a consumir evento, sem que nada estrutural
 * mudasse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O VALOR DESTE ARQUIVO É SER UMA CERCA TEMPORAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hoje o membro não existe, então o teste passa sem esforço. O trabalho que ele
 * faz é **futuro**: ele fica vermelho no instante em que alguém adicionar o
 * membro sem revisar a decisão de projeto. Por isso a mensagem de falha não é um
 * `toEqual([])` com diferença ilegível — é um texto escrito para essa pessoa,
 * que explica que a ausência é intencional e o que ela está prestes a quebrar.
 *
 * ⚠️ Se a varredura encontrar o membro, a resposta correta **não** é apagar a
 * asserção nem remover o membro em silêncio: as duas coisas são mudança de
 * decisão de projeto e precisam de revisão do requisito 1.7. Está escrito no
 * próprio relatório de falha.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS QUATRO CAMADAS QUE A VARREDURA COBRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. **Instância** — o operador `in` sobre o objeto construído, que é
 *    exatamente a consulta que a biblioteca faria.
 * 2. **Protótipo** — método de classe não é propriedade própria da instância;
 *    mora no protótipo, e é lá que uma adição futura apareceria.
 * 3. **Cadeia inteira de protótipos**, até o protótipo de `Object` inclusive.
 *    Uma classe intermediária que passasse a ser estendida no futuro colocaria o
 *    membro dois níveis acima, e uma varredura de um só nível não veria.
 * 4. **As views devolvidas por `paneViews()`** — o acerto de ponteiro pode ser
 *    consultado na view, não apenas no primitive. Verificar só o primitive
 *    deixaria essa porta aberta.
 *
 * Além do nome exato, a varredura recusa qualquer chave cujo nome **se pareça**
 * com acerto de ponteiro, por um vocabulário fixo e comparação insensível a
 * caixa e a separador. É deliberadamente mais largo que o nome exato: o objetivo
 * é a cerca, e um membro de acerto de ponteiro batizado de outro jeito quebraria
 * a mesma decisão.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A VARREDURA NUNCA LÊ O VALOR DA CHAVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ela usa `in`, a lista de nomes de propriedades próprias e o descritor — nunca
 * o acesso ao valor. Um membro declarado como leitor de propriedade poderia
 * executar código ao ser lido, e um teste que o lesse trocaria uma asserção
 * vermelha e informativa por uma exceção sem contexto. Há controle específico
 * para isso abaixo: um objeto cujo leitor lança, e que precisa ser **reprovado
 * sem que a exceção aconteça**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * GUARDA DE VACUIDADE: A VARREDURA TEM DE TER DENTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma verificação que só afirma ausência é o caso mais fácil de passar por
 * engano. Uma função que devolvesse lista vazia sempre — por erro de travessia,
 * por vocabulário vazio, por comparar a chave errada — seria indistinguível de
 * uma correta enquanto o membro não existisse, ou seja, para sempre em condição
 * normal.
 *
 * Então a vacuidade é atacada em três frentes, todas por asserção:
 *
 * - **Controles positivos.** Objetos construídos **com** o membro — na própria
 *   instância, no protótipo, no avô, no bisavô, em grafia alternativa, como
 *   leitor que lança, e escondido numa view — e a exigência de que a **mesma**
 *   função os reprove, com o nível correto identificado.
 * - **Testemunho da travessia.** A varredura devolve quantos níveis de protótipo
 *   percorreu, quantas chaves inspecionou e se alcançou o protótipo de `Object`.
 *   Uma travessia que parasse cedo não passa dessas asserções.
 * - **Cobertura do gerador.** Cada dimensão que o enunciado promete quantificar
 *   é contada e afirmada maior que zero, para que um gerador degenerado não
 *   deixe a propriedade passando sem exercer nada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A QUANTIFICAÇÃO: SEQUÊNCIA DE CICLO DE VIDA E OPÇÕES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "O membro não existe" precisa valer **em qualquer estado**, não apenas na
 * instância recém-construída. A propriedade sorteia uma sequência de chamadas de
 * ciclo de vida — anexar, desanexar, receber opção nova, invalidar as views, ler
 * as views — em ordem arbitrária e com repetição, e confere a varredura **antes
 * da sequência e depois de cada passo**.
 *
 * Isso importa porque estado é onde membros aparecem sem que ninguém escreva a
 * declaração: uma atribuição condicional dentro de `attached`, uma mesclagem de
 * objeto de opções, uma view trocada por outra depois de desanexar. Conferir só
 * a instância recém-construída não veria nenhuma dessas.
 *
 * As opções também são sorteadas, incluindo grid ausente e valores de orçamento
 * degenerados — a camada não tem valor padrão interno para o teto de células nem
 * para a dimensão mínima, e a ausência do membro não pode depender de a
 * configuração ser sadia.
 *
 * ⚠️ O relógio é sorteado entre injetado e ausente porque são **dois caminhos de
 * construção** distintos, e a varredura é estrutural: um caminho de construção
 * poderia, em princípio, anexar membros que o outro não anexa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INDEPENDÊNCIA DAS CONEXÕES DE TERMINAL (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As importações de execução são três: a camada em teste, a biblioteca de teste
 * e o gerador de propriedades. As demais são só de tipo. O fechamento transitivo
 * não alcança camada de roteamento de conexão, feed de cotação, envio de ordem
 * nem estado de posição, e não carrega endereço de rede de serviço
 * intermediário, credencial ou identificador de conta.
 *
 * O gráfico e a série que a anexação recebe são objetos sintetizados aqui, sem
 * rede e sem DOM. Todo insumo de livro é fabricado pelos geradores em memória;
 * nada é lido de banco nem do sistema de arquivos, em CSV ou em qualquer outro
 * formato. Nada aqui envia ordem, emite evento de decisão, escreve em tabela ou
 * altera chave de configuração de trading.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente neste arquivo, nem como exemplo do que evitar: a verificação de
 * independência inspeciona **integralmente** todo arquivo criado por esta
 * feature, teste incluído, e citação em comentário contaria como ocorrência.
 *
 * Convenções: `fast-check` com semente 42 e 500 execuções, nomes de teste e
 * comentários em pt-BR, identificadores em inglês.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

import { BookmapPrimitive, resetBookmapSessionWarnings } from '@robustus/charts-primitives';
import type { BookmapLayerOptions } from '@robustus/charts-primitives';
import type { BookmapGrid, FonteBookmap, MetricaBookmap } from '@robustus/charts-core';
import type { SeriesAttachedParameter, SeriesType, Time } from '@robustus/chart-core';

// ═════════════════════════════════════════════════════════════════════════════
// Orçamento de execução
// ═════════════════════════════════════════════════════════════════════════════

const SEED = 42;

/** Execuções por propriedade. Número padrão das propriedades desta spec. */
const NUM_RUNS = 500;

// ═════════════════════════════════════════════════════════════════════════════
// O nome exato e o vocabulário de acerto de ponteiro
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O nome exato que a biblioteca consulta.
 *
 * Fica numa constante porque aparece em três lugares — o operador `in`, a
 * varredura difusa e os controles positivos — e uma divergência entre eles
 * tornaria o teste silenciosamente parcial.
 */
const MEMBRO_EXATO = 'hitTest';

/**
 * Vocabulário de acerto de ponteiro, já normalizado.
 *
 * ── COMO A LISTA FOI ESCOLHIDA ────────────────────────────────────────────
 *
 * São os termos com que a biblioteca de gráfico e o padrão de eventos do
 * navegador nomeiam interação por cursor. Cada um tem ao menos cinco caracteres,
 * de propósito: termos curtos como três letras produziriam colisão acidental com
 * identificador legítimo em português ou inglês, e um teste que acusa nome
 * inocente é abandonado — o que anula a cerca.
 *
 * ⚠️ A lista é intencionalmente mais larga que o nome exato. Se um membro
 * legítimo vier a colidir com o vocabulário sem interceptar nada, a saída certa é
 * **renomear o membro**, não afrouxar a lista: é o vocabulário que define a
 * fronteira, e alargá-lo abre exatamente o buraco que ele fecha.
 */
const VOCABULARIO_DE_PONTEIRO: readonly string[] = [
  'hittest',
  'hover',
  'pointer',
  'mouse',
  'click',
  'crosshair',
  'cursor',
  'touch',
];

/**
 * Reduz um nome de chave à forma comparável: minúsculas, sem separador.
 *
 * Faz `hitTest`, `hit_test`, `HIT-TEST` e `hittest` colapsarem no mesmo texto.
 * Sem isso, a cerca seria contornável por uma convenção de nome diferente.
 */
function normalizar(nome: string): string {
  return nome.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

/** O nome se parece com acerto de ponteiro? */
function pareceInterceptacao(nome: string): boolean {
  const alvo = normalizar(nome);
  if (alvo.length === 0) return false;
  return VOCABULARIO_DE_PONTEIRO.some((token) => alvo.indexOf(token) >= 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// A varredura estrutural
// ═════════════════════════════════════════════════════════════════════════════

/** Uma ocorrência encontrada. `origem` é o que permite localizar o culpado. */
interface Achado {
  /** Qual objeto: `primitive`, `view[0]`, ... */
  readonly camada: string;
  /** Nível na cadeia: `instância`, `protótipo`, `protótipo+2`, ... */
  readonly nivel: string;
  readonly chave: string;
  /** Por que foi acusada: nome exato, operador `in`, ou vocabulário. */
  readonly motivo: string;
}

/**
 * O que a varredura viu, e não apenas o que ela reprovou.
 *
 * ⚠️ Os três campos de contagem existem **para a guarda de vacuidade**. Sem eles
 * não haveria como distinguir "nada foi encontrado" de "nada foi olhado", e as
 * duas coisas produzem a mesma lista vazia.
 */
interface Varredura {
  readonly achados: readonly Achado[];
  /** Chaves efetivamente inspecionadas, somando instância e cadeia. */
  readonly chavesInspecionadas: number;
  /** Níveis de protótipo percorridos acima da instância. */
  readonly niveisDePrototipo: number;
  /** A travessia chegou ao topo? Falso denuncia parada precoce. */
  readonly alcancouObjectPrototype: boolean;
}

/**
 * A cadeia de protótipos acima de um objeto, do mais próximo ao topo.
 *
 * ── POR QUE EXISTE UM LIMITE, E CONTRA O QUÊ ──────────────────────────────
 *
 * ⚠️ **Não é contra cadeia circular.** Medido nesta bancada: a engine recusa
 * fechar um ciclo de protótipo, com exceção de tipo — não há como construí-lo, e
 * há teste que afirma essa recusa em vez de presumi-la.
 *
 * O limite é contra cadeia **ilimitada**, que é construível: um objeto cujo
 * desvio de leitura de protótipo devolve um objeto novo a cada consulta produz
 * uma cadeia sem fim. Sem o corte, a travessia não terminaria — e um teste que
 * não termina é pior que um teste que falha, porque trava a suíte inteira sem
 * dizer por quê.
 */
function cadeiaDePrototipos(alvo: object): readonly object[] {
  const cadeia: object[] = [];
  let atual: unknown = Object.getPrototypeOf(alvo);
  let guarda = 0;
  while (atual !== null && atual !== undefined && guarda < 64) {
    cadeia.push(atual as object);
    atual = Object.getPrototypeOf(atual as object);
    guarda += 1;
  }
  return cadeia;
}

/**
 * Nomes de propriedades próprias, incluindo as não enumeráveis.
 *
 * `Object.getOwnPropertyNames` e não `Object.keys`: método de classe é não
 * enumerável, então `Object.keys` sobre o protótipo devolveria lista vazia e a
 * varredura passaria por vacuidade justamente na camada que mais importa.
 */
function chavesProprias(alvo: object): readonly string[] {
  try {
    return Object.getOwnPropertyNames(alvo);
  } catch {
    // Objeto exótico cuja enumeração falha. Tratar como indeterminado seria
    // aceitar o desconhecido; devolver nada aqui é seguro porque o operador
    // `in`, que não passa por este caminho, continua valendo.
    return [];
  }
}

/**
 * Descreve o que a chave é, **sem ler o valor**.
 *
 * Ler acionaria um leitor de propriedade, que pode executar código e lançar. O
 * descritor entrega o formato do membro sem esse risco.
 */
function formaDaChave(dono: object, chave: string): string {
  const d = Object.getOwnPropertyDescriptor(dono, chave);
  if (d === undefined) return 'descritor ausente';
  if (typeof d.get === 'function') return 'leitor de propriedade';
  if (typeof d.set === 'function') return 'escritor de propriedade';
  return 'propriedade de dado';
}

/**
 * Varre um único objeto: instância, protótipo e toda a cadeia até o topo.
 *
 * ⚠️ Esta é a função que os controles positivos exercitam. Os controles não
 * reimplementam a checagem — eles passam pela **mesma** função, que é o único
 * jeito de a guarda de vacuidade provar algo sobre o que roda de verdade.
 */
function varrerObjeto(alvo: object, camada: string): Varredura {
  const achados: Achado[] = [];
  let chavesInspecionadas = 0;

  // ── camada 1: o operador `in`, que é a consulta da própria biblioteca ──
  //
  // Cobre a instância e a cadeia inteira de uma vez, e cobre também membro
  // declarado como leitor de propriedade — sem lê-lo.
  let temPeloOperadorIn = false;
  try {
    temPeloOperadorIn = MEMBRO_EXATO in alvo;
  } catch {
    // `in` sobre alvo exótico. Indeterminação conta como ocorrência: a decisão
    // de projeto exige ausência demonstrável, e o que não se pode demonstrar não
    // passa.
    achados.push({
      camada,
      nivel: 'instância',
      chave: MEMBRO_EXATO,
      motivo: 'o operador `in` não pôde ser avaliado, e indeterminação conta como ocorrência',
    });
  }
  if (temPeloOperadorIn) {
    achados.push({
      camada,
      nivel: 'instância ou cadeia (via operador `in`)',
      chave: MEMBRO_EXATO,
      motivo: 'o operador `in` encontrou o membro — é exatamente a consulta que a biblioteca faz',
    });
  }

  // ── camadas 2 a 4: chaves próprias da instância e de cada protótipo ──
  const niveis: readonly { readonly dono: object; readonly rotulo: string }[] = [
    { dono: alvo, rotulo: 'instância' },
    ...cadeiaDePrototipos(alvo).map((dono, i) => ({
      dono,
      rotulo: i === 0 ? 'protótipo' : `protótipo+${i}`,
    })),
  ];

  for (const nivel of niveis) {
    for (const chave of chavesProprias(nivel.dono)) {
      chavesInspecionadas += 1;
      if (chave === MEMBRO_EXATO) {
        achados.push({
          camada,
          nivel: nivel.rotulo,
          chave,
          motivo: `nome exato do membro de acerto de ponteiro (${formaDaChave(nivel.dono, chave)})`,
        });
        continue;
      }
      if (pareceInterceptacao(chave)) {
        achados.push({
          camada,
          nivel: nivel.rotulo,
          chave,
          motivo: `o nome casa com o vocabulário de acerto de ponteiro (${formaDaChave(nivel.dono, chave)})`,
        });
      }
    }
  }

  const cadeia = cadeiaDePrototipos(alvo);
  return {
    achados,
    chavesInspecionadas,
    niveisDePrototipo: cadeia.length,
    alcancouObjectPrototype: cadeia.some((p) => p === Object.prototype),
  };
}

/** O contrato mínimo que a varredura da camada precisa do objeto inspecionado. */
interface ComPaneViews {
  paneViews(): readonly unknown[];
}

function temPaneViews(alvo: unknown): alvo is ComPaneViews {
  return (
    typeof alvo === 'object' &&
    alvo !== null &&
    typeof (alvo as { paneViews?: unknown }).paneViews === 'function'
  );
}

/**
 * Varre o primitive **e** cada view que ele devolve.
 *
 * A soma das duas pernas é o que responde ao requisito 1.7: a biblioteca pode
 * consultar acerto de ponteiro no primitive ou na view, e cobrir só o primeiro
 * deixaria a segunda porta aberta.
 */
function varrerCamada(alvo: object, rotulo: string): Varredura {
  const doPrimitive = varrerObjeto(alvo, `${rotulo}`);
  const achados: Achado[] = [...doPrimitive.achados];
  let chavesInspecionadas = doPrimitive.chavesInspecionadas;
  let niveisDePrototipo = doPrimitive.niveisDePrototipo;
  let alcancouObjectPrototype = doPrimitive.alcancouObjectPrototype;

  if (temPaneViews(alvo)) {
    let views: readonly unknown[] = [];
    try {
      views = alvo.paneViews();
    } catch {
      achados.push({
        camada: rotulo,
        nivel: 'views',
        chave: '(indeterminado)',
        motivo: 'a leitura das views lançou, e indeterminação conta como ocorrência',
      });
    }
    views.forEach((view, i) => {
      if (typeof view !== 'object' || view === null) return;
      const daView = varrerObjeto(view, `${rotulo}.paneViews()[${i}]`);
      achados.push(...daView.achados);
      chavesInspecionadas += daView.chavesInspecionadas;
      niveisDePrototipo = Math.max(niveisDePrototipo, daView.niveisDePrototipo);
      alcancouObjectPrototype = alcancouObjectPrototype && daView.alcancouObjectPrototype;
    });
  }

  return { achados, chavesInspecionadas, niveisDePrototipo, alcancouObjectPrototype };
}

// ═════════════════════════════════════════════════════════════════════════════
// O relatório de falha — escrito para quem vier depois
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Monta o texto que a pessoa do futuro vai ler.
 *
 * ── POR QUE O RELATÓRIO É UM TEXTO, E NÃO `toEqual([])` ───────────────────
 *
 * A diferença de uma lista de objetos numa saída de teste é ilegível e não
 * explica nada. Quem quebrar esta asserção precisa entender três coisas antes de
 * decidir o que fazer: que a ausência é intencional, o que ela protege, e qual é
 * o caminho legítimo para mudar de ideia. Nada disso cabe num nome de asserção.
 *
 * Cadeia vazia devolve texto vazio, então a asserção é `toBe('')` — comparação
 * de texto, cuja diferença a saída de teste mostra por inteiro.
 */
function montarRelatorio(contexto: string, achados: readonly Achado[]): string {
  if (achados.length === 0) return '';
  return [
    `A camada de bookmap passou a expor acerto de ponteiro (${contexto}).`,
    '',
    'LEIA ANTES DE MEXER NESTE TESTE. A ausência desse membro é INTENCIONAL, e não',
    'esquecimento. A biblioteca de gráfico só consulta a camada quando o membro',
    'existe; ausente, não há caminho de código da biblioteca até a camada no',
    'movimento do cursor. É garantia de tipo — não convenção de folha de estilo,',
    'como nas sete camadas de sobreposição em DOM que já existem no gráfico.',
    'Ver o requisito 1.7 da spec e o cabeçalho de `BookmapPrimitive.ts`.',
    '',
    'O QUE VOCÊ ESTÁ PRESTES A QUEBRAR:',
    '  1. zoom, pan, crosshair e clique deixam de seguir como antes — a camada passa',
    '     a disputar o evento de ponteiro com os destinatários atuais;',
    '  2. o membro passa a ser chamado a CADA movimento de cursor, custo por quadro',
    '     que o orçamento de desempenho da camada não prevê nem mede; e',
    '  3. a camada é exclusivamente visual por decisão de projeto. Reagir a ponteiro',
    '     a torna interativa, e interatividade dentro do canvas do gráfico não foi',
    '     desenhada, não foi medida e não tem teste que a cubra.',
    '',
    'SE A INTERATIVIDADE FOR MESMO DESEJADA, isso é mudança de decisão de projeto:',
    'revise o requisito 1.7, atualize o cabeçalho de `BookmapPrimitive.ts` e só',
    'então altere este teste. Apagar a asserção sem essa revisão remove a única',
    'barreira que existe — e ela é estrutural justamente porque convenção não',
    'segura.',
    '',
    'SE O NOME APENAS SE PARECE com acerto de ponteiro e nada intercepta, renomeie',
    'o membro: é o vocabulário desta cerca que define a fronteira, e alargá-lo',
    'abre o buraco que ele fecha.',
    '',
    'Encontrado:',
    ...achados.map((a) => `  • ${a.camada} → [${a.nivel}] "${a.chave}" — ${a.motivo}`),
  ].join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// Insumos sintéticos — grid e parâmetro de anexação
// ═════════════════════════════════════════════════════════════════════════════

interface FormaDoGrid {
  readonly fonte: FonteBookmap;
  readonly baldeSeg: number;
  readonly t0Sec: number;
  readonly nBaldes: number;
  readonly preco0: number;
  readonly tick: number;
  readonly nPrecos: number;
  readonly comExecucao: boolean;
}

/**
 * Um grid pequeno e válido.
 *
 * Pequeno de propósito: a propriedade é estrutural e não olha um pixel, mas
 * precisa que o caminho de reconstrução **rode de verdade** — é durante ele que
 * uma atribuição indevida a um membro apareceria. Um grid grande só somaria
 * tempo de execução.
 *
 * `cobertura: null` é estado válido do tipo e o caminho mais comum quando a
 * resposta não traz o bloco de cobertura.
 */
function criarGrid(f: FormaDoGrid): BookmapGrid {
  const total = f.nBaldes * f.nPrecos;
  const times = new Float64Array(f.nBaldes);
  for (let i = 0; i < f.nBaldes; i += 1) {
    times[i] = (f.t0Sec + i * f.baldeSeg) * 1000;
  }
  const prices = new Float64Array(f.nPrecos);
  for (let j = 0; j < f.nPrecos; j += 1) {
    prices[j] = f.preco0 + j * f.tick;
  }
  const ti = new Uint32Array(total);
  const pi = new Uint32Array(total);
  const bid = new Float32Array(total);
  const ask = new Float32Array(total);
  const buy = new Float32Array(total);
  const sell = new Float32Array(total);
  let k = 0;
  for (let i = 0; i < f.nBaldes; i += 1) {
    for (let j = 0; j < f.nPrecos; j += 1) {
      ti[k] = i;
      pi[k] = j;
      // Valores crescentes e distintos para que a escala de cor tenha rampa e o
      // caminho de bucket seja realmente exercido.
      bid[k] = (k + 1) * 13;
      ask[k] = (k + 1) * 7;
      buy[k] = f.comExecucao ? (k + 1) * 3 : 0;
      sell[k] = f.comExecucao ? (k + 1) * 2 : 0;
      k += 1;
    }
  }
  return {
    symbol: 'WINV26',
    fonte: f.fonte,
    dia: '2026-08-28',
    baldeSeg: f.baldeSeg,
    times,
    prices,
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    cobertura: null,
  };
}

interface FormaDoGrafico {
  readonly larguraPx: number;
  readonly alturaPx: number;
  /** Ausente faz a faixa visível responder ausência, caminho legítimo. */
  readonly janelaDeSec: number | null;
  readonly janelaAteSec: number;
  readonly precoTopo: number;
  readonly precoBase: number;
  /** Falso faz as conversões para coordenada responderem ausência. */
  readonly coordenadasUtilizaveis: boolean;
}

/**
 * O parâmetro de anexação, sintetizado.
 *
 * ⚠️ **A conversão de tipo é deliberada e está isolada aqui.** As interfaces de
 * gráfico e de série da biblioteca têm dezenas de membros, e a camada usa
 * exatamente cinco: dimensão do painel, faixa visível, preço a partir de
 * coordenada, coordenada a partir de preço e coordenada a partir de instante.
 * Implementar as interfaces inteiras só para satisfazer o compilador
 * acrescentaria centenas de linhas sem acrescentar uma asserção — e, pior,
 * acrescentaria membros inventados por este teste a objetos que a varredura
 * inspeciona.
 *
 * A conversão passa por `unknown` de propósito: é a forma que não silencia
 * incompatibilidade em outro lugar do arquivo.
 */
function criarParametroDeAnexacao(g: FormaDoGrafico): SeriesAttachedParameter<Time, SeriesType> {
  const larguraUtil = g.janelaAteSec - (g.janelaDeSec ?? 0);
  const alturaUtil = g.precoBase - g.precoTopo;

  const timeScale = {
    getVisibleRange: () =>
      g.janelaDeSec === null ? null : { from: g.janelaDeSec, to: g.janelaAteSec },
    timeToCoordinate: (t: unknown): number | null => {
      if (!g.coordenadasUtilizaveis) return null;
      if (typeof t !== 'number' || !Number.isFinite(t)) return null;
      if (g.janelaDeSec === null || larguraUtil === 0) return null;
      return ((t - g.janelaDeSec) / larguraUtil) * g.larguraPx;
    },
  };

  const chart = {
    paneSize: () => ({ width: g.larguraPx, height: g.alturaPx }),
    timeScale: () => timeScale,
  };

  const series = {
    // Coordenada 0 é o topo do painel, logo o preço maior — a mesma convenção
    // que a camada assume ao ler a janela.
    coordinateToPrice: (y: number): number | null => {
      if (!Number.isFinite(y) || g.alturaPx === 0) return null;
      return g.precoTopo + (y / g.alturaPx) * alturaUtil;
    },
    priceToCoordinate: (p: number): number | null => {
      if (!g.coordenadasUtilizaveis) return null;
      if (!Number.isFinite(p) || alturaUtil === 0) return null;
      return ((p - g.precoTopo) / alturaUtil) * g.alturaPx;
    },
  };

  return {
    chart,
    series,
    requestUpdate: () => {
      /* a camada pede redesenho; sem gráfico real, nada a fazer */
    },
    horzScaleBehavior: {},
  } as unknown as SeriesAttachedParameter<Time, SeriesType>;
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

// ⚠️ As CINCO. `DELTA` e `VOLUME` entraram junto com a implementação: a garantia de que a camada
// nunca captura ponteiro tem de valer em todo estado, e métrica nova é estado novo.
const METRICAS: readonly MetricaBookmap[] = ['FILA', 'EXECUCAO', 'AMBAS', 'DELTA', 'VOLUME'];
const ESCALAS: readonly BookmapLayerOptions['escala'][] = ['P99_GAMMA', 'P99_LINEAR'];
const FONTES: readonly FonteBookmap[] = ['MT5_L2', 'CEDRO_MBO'];

const arbFormaDoGrid: fc.Arbitrary<FormaDoGrid> = fc.record({
  fonte: fc.constantFrom(...FONTES),
  baldeSeg: fc.constantFrom(1, 5, 60),
  t0Sec: fc.constantFrom(1_787_000_000, 1_787_003_600),
  nBaldes: fc.integer({ min: 1, max: 4 }),
  preco0: fc.constantFrom(130_000, 178_500),
  tick: fc.constantFrom(1, 5),
  nPrecos: fc.integer({ min: 1, max: 4 }),
  comExecucao: fc.boolean(),
});

/**
 * Valor de orçamento, incluindo os degenerados.
 *
 * A camada **não tem valor padrão interno** para o teto de células nem para a
 * dimensão mínima: os dois chegam obrigatoriamente de fora. A ausência do membro
 * de acerto de ponteiro não pode depender de a configuração ser sadia, então o
 * gerador produz também o que uma tela mal configurada mandaria.
 */
const arbValorDeOrcamento = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 8_000 }), weight: 6 },
  {
    arbitrary: fc.constantFrom(
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
    weight: 2,
  },
);

const arbTickSize = fc.oneof(
  { arbitrary: fc.constantFrom(0.5, 1, 5), weight: 6 },
  { arbitrary: fc.constantFrom(0, -1, Number.NaN), weight: 1 },
);

const arbGrid: fc.Arbitrary<BookmapGrid | null> = fc.oneof(
  // Grid ausente é o caminho de desligar sem desanexar, e é estado normal.
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: arbFormaDoGrid.map(criarGrid), weight: 5 },
);

const arbOptions: fc.Arbitrary<BookmapLayerOptions> = fc.record({
  grid: arbGrid,
  metrica: fc.constantFrom(...METRICAS),
  escala: fc.constantFrom(...ESCALAS),
  tickSize: arbTickSize,
  maxCells: arbValorDeOrcamento,
  minCellPx: arbValorDeOrcamento,
});

/**
 * Opção parcial com ao menos uma chave presente.
 *
 * A distinção entre subconjuntos importa porque a camada trata a presença de
 * teto de células e de dimensão mínima como reinício de orçamento, e um caminho
 * de código só percorrido nesse caso poderia introduzir membro.
 */
const arbOptionsParcialComChaves: fc.Arbitrary<Partial<BookmapLayerOptions>> = fc.record(
  {
    grid: arbGrid,
    metrica: fc.constantFrom(...METRICAS),
    escala: fc.constantFrom(...ESCALAS),
    tickSize: arbTickSize,
    maxCells: arbValorDeOrcamento,
    minCellPx: arbValorDeOrcamento,
  },
  { requiredKeys: [] },
);

/**
 * Opção parcial, incluindo a atualização **vazia**.
 *
 * ⚠️ **O ramo vazio é explícito, e não é redundância.** Medido nesta bancada:
 * `fc.record` com todas as seis chaves opcionais produziu o registro
 * completamente vazio **zero** vez em 3.000 sorteios — a distribuição dele se
 * concentra entre quatro e seis chaves presentes, e "nenhuma chave" fica com
 * probabilidade desprezível.
 *
 * Sem este ramo, a atualização vazia nunca seria exercida — e ela é caminho
 * real: a tela pode reemitir a opção sem que nada tenha mudado, e esse caminho
 * ainda assim invalida a escala e pede redesenho. Foi a asserção de cobertura
 * abaixo que apanhou a lacuna, o que é exatamente o serviço que ela presta.
 */
const arbOptionsParcial: fc.Arbitrary<Partial<BookmapLayerOptions>> = fc.oneof(
  { arbitrary: fc.constant<Partial<BookmapLayerOptions>>({}), weight: 1 },
  { arbitrary: arbOptionsParcialComChaves, weight: 6 },
);

const arbFormaDoGrafico: fc.Arbitrary<FormaDoGrafico> = fc
  .record({
    larguraPx: fc.constantFrom(0, 1, 640, 1_280),
    alturaPx: fc.constantFrom(0, 1, 480, 900),
    janelaDeSec: fc.oneof(
      { arbitrary: fc.constant(null), weight: 1 },
      { arbitrary: fc.constantFrom(1_787_000_000, 1_787_003_000), weight: 4 },
    ),
    duracaoSec: fc.constantFrom(0, 60, 3_600),
    precoTopo: fc.constantFrom(178_900, 130_400),
    alturaPreco: fc.constantFrom(0, 500, 2_000),
    coordenadasUtilizaveis: fc.oneof(
      { arbitrary: fc.constant(true), weight: 4 },
      { arbitrary: fc.constant(false), weight: 1 },
    ),
  })
  .map((r) => ({
    larguraPx: r.larguraPx,
    alturaPx: r.alturaPx,
    janelaDeSec: r.janelaDeSec,
    janelaAteSec: (r.janelaDeSec ?? 1_787_000_000) + r.duracaoSec,
    precoTopo: r.precoTopo,
    // Coordenada 0 é o topo, logo o preço da base é MENOR. A camada ordena as
    // duas pontas por conta própria; produzir a ordem natural aqui apenas evita
    // que o cenário seja sempre o invertido.
    precoBase: r.precoTopo - r.alturaPreco,
    coordenadasUtilizaveis: r.coordenadasUtilizaveis,
  }));

/** Um passo de ciclo de vida. */
type Passo =
  | { readonly tipo: 'ANEXAR' }
  | { readonly tipo: 'DESANEXAR' }
  | { readonly tipo: 'ATUALIZAR'; readonly parcial: Partial<BookmapLayerOptions> }
  | { readonly tipo: 'ATUALIZAR_VIEWS' }
  | { readonly tipo: 'LER_VIEWS' };

const arbPasso: fc.Arbitrary<Passo> = fc.oneof(
  { arbitrary: fc.constant<Passo>({ tipo: 'ANEXAR' }), weight: 3 },
  { arbitrary: fc.constant<Passo>({ tipo: 'DESANEXAR' }), weight: 2 },
  {
    arbitrary: arbOptionsParcial.map<Passo>((parcial) => ({ tipo: 'ATUALIZAR', parcial })),
    weight: 3,
  },
  { arbitrary: fc.constant<Passo>({ tipo: 'ATUALIZAR_VIEWS' }), weight: 3 },
  { arbitrary: fc.constant<Passo>({ tipo: 'LER_VIEWS' }), weight: 3 },
);

interface Cenario {
  readonly options: BookmapLayerOptions;
  readonly grafico: FormaDoGrafico;
  /**
   * O relógio é injetado?
   *
   * Dois caminhos de construção distintos. A varredura é estrutural, então a
   * dimensão é pertinente: um caminho poderia, em princípio, anexar membro que o
   * outro não anexa.
   */
  readonly comRelogioInjetado: boolean;
  readonly passos: readonly Passo[];
}

const arbCenario: fc.Arbitrary<Cenario> = fc.record({
  options: arbOptions,
  grafico: arbFormaDoGrafico,
  comRelogioInjetado: fc.boolean(),
  passos: fc.array(arbPasso, { minLength: 1, maxLength: 10 }),
});

// ═════════════════════════════════════════════════════════════════════════════
// Execução de um cenário
// ═════════════════════════════════════════════════════════════════════════════

function construir(c: Cenario): BookmapPrimitive {
  // Relógio fixo quando injetado: a medição de passada não participa desta
  // propriedade, e um relógio determinístico remove uma fonte de variação que
  // nada acrescentaria aqui.
  return c.comRelogioInjetado
    ? new BookmapPrimitive(c.options, () => 0)
    : new BookmapPrimitive(c.options);
}

function executarPasso(
  p: BookmapPrimitive,
  passo: Passo,
  param: SeriesAttachedParameter<Time, SeriesType>,
): void {
  switch (passo.tipo) {
    case 'ANEXAR':
      p.attached(param);
      return;
    case 'DESANEXAR':
      p.detached();
      return;
    case 'ATUALIZAR':
      p.update(passo.parcial);
      return;
    case 'ATUALIZAR_VIEWS':
      p.updateAllViews();
      return;
    case 'LER_VIEWS':
      p.paneViews();
      return;
  }
}

function descreverPasso(passo: Passo): string {
  if (passo.tipo !== 'ATUALIZAR') return passo.tipo;
  const chaves = Object.keys(passo.parcial);
  return chaves.length === 0 ? 'ATUALIZAR(vazio)' : `ATUALIZAR(${chaves.join(',')})`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Preparo de cada caso
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  // Os registros de aviso são estado de MÓDULO, não de instância. Sem o
  // reinício, a ordem dos casos passaria a importar.
  resetBookmapSessionWarnings();

  // A camada registra esgotamento de orçamento e degradação no console. Com
  // orçamento degenerado no gerador, o registro é esperado — silenciar mantém a
  // saída da suíte legível sem esconder falha de asserção.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);

  // O recálculo de escala agenda um temporizador de repouso. Sem relógio
  // simulado, centenas de temporizadores reais ficariam pendentes entre os
  // casos desta suíte.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetBookmapSessionWarnings();
});

// ═════════════════════════════════════════════════════════════════════════════
// Guarda de vacuidade — a varredura tem dentes
// ═════════════════════════════════════════════════════════════════════════════

/** Controle: o membro na própria instância. */
const controleNaInstancia = {
  hitTest: (): null => null,
};

/** Controle: o membro no protótipo, que é onde método de classe mora. */
class ControleNoPrototipo {
  hitTest(): null {
    return null;
  }
}

/** Controle: o membro dois níveis acima — avô da instância. */
class ControleAvo {
  hitTest(): null {
    return null;
  }
}
class ControleFilho extends ControleAvo {}

/** Controle: o membro três níveis acima — bisavô da instância. */
class ControleNeto extends ControleFilho {}

/** Controle: grafia alternativa, que só o vocabulário difuso apanha. */
const controleGrafiaAlternativa = {
  hit_test: (): null => null,
};

/** Controle: outro nome do mesmo vocabulário. */
const controleOutroVocabulario = {
  onPointerMove: (): null => null,
};

/**
 * Controle: o membro como leitor de propriedade que **lança** se for lido.
 *
 * Prova que a varredura não lê o valor. Se ela lesse, este caso produziria uma
 * exceção em vez de uma ocorrência — e o teste ficaria vermelho pelo motivo
 * errado, sem relatório.
 */
const controleLeitorQueLanca: object = Object.defineProperty({}, MEMBRO_EXATO, {
  get(): never {
    throw new Error('a varredura não deveria ler o valor da chave');
  },
  configurable: true,
  enumerable: false,
});

/** Controle: primitive limpo, mas com o membro escondido numa das views. */
const controleComMembroNaView = {
  paneViews(): readonly unknown[] {
    return [
      {
        zOrder: (): string => 'bottom',
        renderer: (): null => null,
        hitTest: (): null => null,
      },
    ];
  },
};

/**
 * Controle mais forte de todos: **a própria classe em teste**, estendida com o
 * membro.
 *
 * Os controles acima são objetos de brinquedo — provam que a varredura funciona,
 * mas não que ela funciona sobre o grafo de objetos real. Este prova: a cadeia de
 * protótipos é a verdadeira (subclasse → camada → protótipo de `Object`), as
 * views são as verdadeiras, o estado é o verdadeiro. A única diferença em
 * relação ao objeto que o enunciado aprova é o membro acrescentado.
 *
 * É a forma mais próxima possível de simular a mudança que esta cerca existe
 * para apanhar, sem tocar no arquivo de produção.
 */
class ControleDerivadoDaCamada extends BookmapPrimitive {
  hitTest(): null {
    return null;
  }
}

const GRAFICO_CANONICO: FormaDoGrafico = {
  larguraPx: 1_280,
  alturaPx: 900,
  janelaDeSec: 1_787_000_000,
  janelaAteSec: 1_787_003_600,
  precoTopo: 178_900,
  precoBase: 176_900,
  coordenadasUtilizaveis: true,
};

const OPCOES_CANONICAS: BookmapLayerOptions = {
  grid: criarGrid({
    fonte: 'MT5_L2',
    baldeSeg: 60,
    t0Sec: 1_787_000_000,
    nBaldes: 3,
    preco0: 177_000,
    tick: 5,
    nPrecos: 3,
    comExecucao: true,
  }),
  metrica: 'AMBAS',
  escala: 'P99_GAMMA',
  tickSize: 5,
  maxCells: 4_000,
  minCellPx: 2,
};

describe('Property 3 — guarda de vacuidade: a varredura reprova quem tem o membro', () => {
  it('reprova o membro na própria instância', () => {
    const v = varrerCamada(controleNaInstancia, 'controle');
    expect(v.achados.length).toBeGreaterThan(0);
    expect(v.achados.some((a) => a.chave === MEMBRO_EXATO)).toBe(true);
    // O relatório também precisa sair preenchido: é ele que a asserção central
    // compara, e um relatório vazio para um controle reprovado tornaria a
    // asserção central cega.
    expect(montarRelatorio('controle', v.achados)).not.toBe('');
  });

  it('reprova o membro no protótipo', () => {
    const v = varrerCamada(new ControleNoPrototipo(), 'controle');
    expect(v.achados.some((a) => a.nivel === 'protótipo' && a.chave === MEMBRO_EXATO)).toBe(true);
  });

  it('reprova o membro dois e três níveis acima na cadeia', () => {
    const doFilho = varrerCamada(new ControleFilho(), 'controle');
    expect(doFilho.achados.some((a) => a.nivel === 'protótipo+1')).toBe(true);

    const doNeto = varrerCamada(new ControleNeto(), 'controle');
    expect(doNeto.achados.some((a) => a.nivel === 'protótipo+2')).toBe(true);
  });

  it('reprova grafia alternativa e outro termo do mesmo vocabulário', () => {
    const grafia = varrerCamada(controleGrafiaAlternativa, 'controle');
    expect(grafia.achados.some((a) => a.chave === 'hit_test')).toBe(true);

    const outro = varrerCamada(controleOutroVocabulario, 'controle');
    expect(outro.achados.some((a) => a.chave === 'onPointerMove')).toBe(true);
  });

  it('reprova leitor de propriedade sem executá-lo', () => {
    // A ausência de exceção é metade da asserção: a outra metade é a ocorrência.
    let v: Varredura | null = null;
    expect(() => {
      v = varrerCamada(controleLeitorQueLanca, 'controle');
    }).not.toThrow();
    const resultado = v as Varredura | null;
    expect(resultado).not.toBeNull();
    expect(resultado?.achados.some((a) => a.chave === MEMBRO_EXATO)).toBe(true);
  });

  it('reprova o membro escondido numa view, com o primitive limpo', () => {
    const v = varrerCamada(controleComMembroNaView, 'controle');
    // O achado precisa apontar a VIEW, e não o primitive: é o que prova que a
    // perna das views foi percorrida, e não apenas que algo foi encontrado.
    expect(v.achados.some((a) => a.camada.indexOf('paneViews()[0]') >= 0)).toBe(true);
    // E o primitive de controle é de fato limpo, senão o caso não provaria nada.
    expect(varrerObjeto(controleComMembroNaView, 'controle').achados).toEqual([]);
  });

  it('reprova a PRÓPRIA camada estendida com o membro, em qualquer estado do ciclo de vida', () => {
    const derivado = new ControleDerivadoDaCamada(OPCOES_CANONICAS, () => 0);
    const param = criarParametroDeAnexacao(GRAFICO_CANONICO);
    try {
      const conferirReprovacao = (estado: string): void => {
        const v = varrerCamada(derivado, `derivado[${estado}]`);
        // Reprovado pelo operador `in` e pelo nome exato no protótipo da
        // subclasse — as duas pernas, no grafo de objetos real.
        expect(MEMBRO_EXATO in derivado).toBe(true);
        expect(v.achados.some((a) => a.nivel === 'protótipo' && a.chave === MEMBRO_EXATO)).toBe(
          true,
        );
        expect(montarRelatorio(estado, v.achados)).not.toBe('');
        // A camada real está no nível seguinte, e a travessia chega ao topo: é o
        // que prova que a reprovação veio da cadeia verdadeira.
        expect(v.niveisDePrototipo).toBeGreaterThanOrEqual(3);
        expect(v.alcancouObjectPrototype).toBe(true);
      };

      conferirReprovacao('recém-construída');
      derivado.attached(param);
      conferirReprovacao('anexada');
      derivado.updateAllViews();
      conferirReprovacao('com as views reconstruídas');
      derivado.update({ metrica: 'FILA', maxCells: 900 });
      conferirReprovacao('atualizada');
      derivado.detached();
      conferirReprovacao('desanexada');
    } finally {
      derivado.detached();
    }

    // E o inverso, no mesmo estado e com as mesmas opções: a camada sem o membro
    // passa. É este par — mesma varredura, mesmo grafo, único membro de
    // diferença — que dá sentido à asserção central.
    const limpo = new BookmapPrimitive(OPCOES_CANONICAS, () => 0);
    try {
      limpo.attached(param);
      limpo.updateAllViews();
      const v = varrerCamada(limpo, 'limpo[anexada]');
      expect(montarRelatorio('camada sem o membro', v.achados)).toBe('');
      expect(MEMBRO_EXATO in limpo).toBe(false);
    } finally {
      limpo.detached();
    }
  });

  it('o vocabulário e a normalização não são vazios nem inertes', () => {
    // Vocabulário vazio faria toda varredura difusa passar por vacuidade.
    expect(VOCABULARIO_DE_PONTEIRO.length).toBeGreaterThan(0);
    // Termos curtos colidem com identificador legítimo; a decisão está no
    // comentário do vocabulário e é afirmada aqui.
    expect(VOCABULARIO_DE_PONTEIRO.every((t) => t.length >= 5)).toBe(true);
    expect(VOCABULARIO_DE_PONTEIRO.every((t) => t === normalizar(t))).toBe(true);
    // A normalização precisa colapsar as grafias, senão a cerca é contornável.
    expect(normalizar('hitTest')).toBe('hittest');
    expect(normalizar('HIT-TEST')).toBe('hittest');
    expect(normalizar('hit_test')).toBe('hittest');
    expect(pareceInterceptacao('hitTest')).toBe(true);
    expect(pareceInterceptacao('onHitTestData')).toBe(true);
    // E precisa deixar em paz os nomes legítimos da camada, senão a cerca acusa
    // inocente e acaba desligada por quem se cansar dela.
    for (const legitimo of [
      'attached',
      'detached',
      'update',
      'updateAllViews',
      'paneViews',
      'renderer',
      'zOrder',
      'constructor',
      'hasContent',
      'hasOwnProperty',
      'propertyIsEnumerable',
      'toLocaleString',
    ]) {
      expect(pareceInterceptacao(legitimo)).toBe(false);
    }
  });

  it('a travessia da cadeia de protótipos não para cedo', () => {
    // Sem esta asserção, uma travessia que devolvesse cadeia vazia deixaria a
    // asserção central passando sem olhar protótipo algum.
    const cadeia = cadeiaDePrototipos(new ControleNeto());
    expect(cadeia).toContain(ControleNeto.prototype);
    expect(cadeia).toContain(ControleFilho.prototype);
    expect(cadeia).toContain(ControleAvo.prototype);
    expect(cadeia).toContain(Object.prototype);
    // A ordem é do mais próximo ao topo; o topo é o último.
    expect(cadeia[0]).toBe(ControleNeto.prototype);
    expect(cadeia[cadeia.length - 1]).toBe(Object.prototype);
  });

  it('a travessia termina mesmo diante de cadeia ilimitada', () => {
    // ── por que o limite de segurança existe, e por que NÃO é contra ciclo ──
    //
    // Ciclo de protótipo é impossível de construir: a própria engine recusa.
    // Medido aqui em vez de presumido, porque é o que justifica o limite ser
    // contra outra coisa.
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    Object.setPrototypeOf(a, b);
    expect(() => Object.setPrototypeOf(b, a)).toThrow(TypeError);

    // A ameaça real é cadeia ILIMITADA, e ela é construível: um objeto cujo
    // desvio de leitura de protótipo devolve um objeto novo a cada consulta
    // produz uma cadeia sem fim. Sem o limite, a travessia não terminaria — e um
    // teste que não termina é pior que um teste que falha.
    const cadeiaSemFim = (): object =>
      new Proxy(
        {},
        {
          getPrototypeOf: (): object => cadeiaSemFim(),
        },
      );
    const percorrida = cadeiaDePrototipos(cadeiaSemFim());
    expect(percorrida.length).toBe(64);

    // E a varredura sobre esse objeto termina e não acusa nada: ele não expõe
    // chave própria alguma. O que se está afirmando aqui é término, não ausência
    // — a ausência é o objeto do enunciado, e vem depois.
    let v: Varredura | null = null;
    expect(() => {
      v = varrerObjeto(cadeiaSemFim(), 'controle-ilimitado');
    }).not.toThrow();
    expect((v as Varredura | null)?.niveisDePrototipo).toBe(64);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cobertura do gerador — a promessa de variedade, medida
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 3 — cobertura do gerador de cenários', () => {
  it('produz os cinco passos de ciclo de vida, os dois caminhos de construção e opções degeneradas', () => {
    const passosVistos = new Set<Passo['tipo']>();
    const metricasVistas = new Set<MetricaBookmap>();
    const escalasVistas = new Set<string>();
    let comRelogio = 0;
    let semRelogio = 0;
    let gridAusente = 0;
    let gridPresente = 0;
    let orcamentoSadio = 0;
    let orcamentoDegenerado = 0;
    let graficoUtilizavel = 0;
    let graficoDegenerado = 0;
    let janelaAusente = 0;
    let atualizacaoVazia = 0;
    let atualizacaoDeOrcamento = 0;
    let sequenciaComAnexarEDesanexar = 0;
    let sequenciaLonga = 0;

    fc.assert(
      fc.property(arbCenario, (c) => {
        for (const p of c.passos) {
          passosVistos.add(p.tipo);
          if (p.tipo === 'ATUALIZAR') {
            const chaves = Object.keys(p.parcial);
            if (chaves.length === 0) atualizacaoVazia += 1;
            if (chaves.indexOf('maxCells') >= 0 || chaves.indexOf('minCellPx') >= 0) {
              atualizacaoDeOrcamento += 1;
            }
          }
        }
        if (
          c.passos.some((p) => p.tipo === 'ANEXAR') &&
          c.passos.some((p) => p.tipo === 'DESANEXAR')
        ) {
          sequenciaComAnexarEDesanexar += 1;
        }
        if (c.passos.length >= 6) sequenciaLonga += 1;

        metricasVistas.add(c.options.metrica);
        escalasVistas.add(c.options.escala);
        if (c.comRelogioInjetado) comRelogio += 1;
        else semRelogio += 1;
        if (c.options.grid === null) gridAusente += 1;
        else gridPresente += 1;

        const tetoSadio = Number.isFinite(c.options.maxCells) && c.options.maxCells > 0;
        const minSadio = Number.isFinite(c.options.minCellPx) && c.options.minCellPx >= 0;
        if (tetoSadio && minSadio) orcamentoSadio += 1;
        else orcamentoDegenerado += 1;

        if (c.grafico.janelaDeSec === null) janelaAusente += 1;
        if (
          c.grafico.larguraPx > 0 &&
          c.grafico.alturaPx > 0 &&
          c.grafico.janelaDeSec !== null &&
          c.grafico.coordenadasUtilizaveis
        ) {
          graficoUtilizavel += 1;
        } else {
          graficoDegenerado += 1;
        }
        return true;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    // Cada dimensão que o enunciado promete quantificar é afirmada. Sem isto, um
    // gerador degenerado deixaria a propriedade central passando por vacuidade.
    expect(passosVistos.size).toBe(5);
    expect(metricasVistas.size).toBe(METRICAS.length);
    expect(escalasVistas.size).toBe(ESCALAS.length);
    expect(comRelogio).toBeGreaterThan(0);
    expect(semRelogio).toBeGreaterThan(0);
    expect(gridAusente).toBeGreaterThan(0);
    expect(gridPresente).toBeGreaterThan(0);
    expect(orcamentoSadio).toBeGreaterThan(0);
    expect(orcamentoDegenerado).toBeGreaterThan(0);
    expect(graficoUtilizavel).toBeGreaterThan(0);
    expect(graficoDegenerado).toBeGreaterThan(0);
    expect(janelaAusente).toBeGreaterThan(0);
    expect(atualizacaoVazia).toBeGreaterThan(0);
    expect(atualizacaoDeOrcamento).toBeGreaterThan(0);
    expect(sequenciaComAnexarEDesanexar).toBeGreaterThan(0);
    expect(sequenciaLonga).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Property 3 — o enunciado
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 3: a camada nunca intercepta ponteiro', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 1 — o operador `in`, que é a consulta da própria biblioteca
  // ───────────────────────────────────────────────────────────────────────────
  it('o operador `in` não encontra o membro na instância, com qualquer opção', () => {
    fc.assert(
      fc.property(arbCenario, (c) => {
        const p = construir(c);
        try {
          // A forma literal do enunciado da Property 3, escrita como está na
          // spec: nem a instância nem a cadeia acima dela expõem o membro.
          expect(MEMBRO_EXATO in p).toBe(false);
        } finally {
          p.detached();
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('o membro não está no protótipo da classe nem em nível algum da cadeia', () => {
    // A cadeia da classe não depende de instância nem de opção — é afirmada uma
    // vez, sem quantificação, porque quantificar sobre ela não acrescentaria
    // caso algum.
    const cadeia = [BookmapPrimitive.prototype, ...cadeiaDePrototipos(BookmapPrimitive.prototype)];
    // Guarda de vacuidade da travessia: a cadeia precisa existir e chegar ao
    // topo, senão a varredura abaixo não olharia nada.
    expect(cadeia.length).toBeGreaterThanOrEqual(2);
    expect(cadeia).toContain(Object.prototype);

    const achados: Achado[] = [];
    cadeia.forEach((nivel, i) => {
      for (const chave of chavesProprias(nivel)) {
        if (chave === MEMBRO_EXATO || pareceInterceptacao(chave)) {
          achados.push({
            camada: 'BookmapPrimitive.prototype',
            nivel: i === 0 ? 'protótipo' : `protótipo+${i}`,
            chave,
            motivo: 'chave de acerto de ponteiro na cadeia da classe',
          });
        }
      }
    });
    expect(montarRelatorio('cadeia de protótipos da classe', achados)).toBe('');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 2 — em qualquer estado do ciclo de vida
  // ───────────────────────────────────────────────────────────────────────────
  it('nenhuma chave de acerto de ponteiro aparece em estado algum da sequência de ciclo de vida', () => {
    let estadosVerificados = 0;
    let chavesInspecionadasNoTotal = 0;

    fc.assert(
      fc.property(arbCenario, (c) => {
        const param = criarParametroDeAnexacao(c.grafico);
        const p = construir(c);
        try {
          // Estado inicial: recém-construída, antes de qualquer chamada.
          const inicial = varrerCamada(p, 'primitive[recém-construída]');
          expect(montarRelatorio('recém-construída', inicial.achados)).toBe('');
          // Testemunho de que a varredura olhou algo. Uma varredura que não
          // inspecionasse chave alguma devolveria a mesma lista vazia.
          expect(inicial.chavesInspecionadas).toBeGreaterThan(20);
          expect(inicial.niveisDePrototipo).toBeGreaterThanOrEqual(2);
          expect(inicial.alcancouObjectPrototype).toBe(true);
          estadosVerificados += 1;
          chavesInspecionadasNoTotal += inicial.chavesInspecionadas;

          // E depois de cada passo, porque estado é onde membro aparece sem que
          // ninguém escreva a declaração.
          let trilha = '';
          for (const passo of c.passos) {
            executarPasso(p, passo, param);
            trilha = trilha === '' ? descreverPasso(passo) : `${trilha} → ${descreverPasso(passo)}`;
            const v = varrerCamada(p, `primitive[após ${trilha}]`);
            expect(montarRelatorio(`após ${trilha}`, v.achados)).toBe('');
            expect(v.chavesInspecionadas).toBeGreaterThan(20);
            expect(v.alcancouObjectPrototype).toBe(true);
            estadosVerificados += 1;
            chavesInspecionadasNoTotal += v.chavesInspecionadas;
          }
        } finally {
          // Encerramento, não parte da sequência: solta o temporizador de
          // repouso que um passo possa ter agendado.
          p.detached();
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    // Vacuidade da própria propriedade: com 500 execuções e sequências de 1 a 10
    // passos, o número de estados verificados tem de ser bem maior que o de
    // execuções. Um laço que não rodasse deixaria isto vermelho.
    expect(estadosVerificados).toBeGreaterThan(NUM_RUNS);
    expect(chavesInspecionadasNoTotal).toBeGreaterThan(NUM_RUNS * 20);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 3 — as views também não interceptam
  // ───────────────────────────────────────────────────────────────────────────
  it('as views devolvidas não expõem chave de acerto de ponteiro, em estado algum', () => {
    let viewsInspecionadas = 0;
    let comViewNaoVazia = 0;

    fc.assert(
      fc.property(arbCenario, (c) => {
        const param = criarParametroDeAnexacao(c.grafico);
        const p = construir(c);
        try {
          const conferirViews = (contexto: string): void => {
            const views = p.paneViews();
            if (views.length > 0) comViewNaoVazia += 1;
            views.forEach((view, i) => {
              viewsInspecionadas += 1;
              const v = varrerObjeto(view, `view[${i}] ${contexto}`);
              expect(montarRelatorio(`view ${i} ${contexto}`, v.achados)).toBe('');
              expect(MEMBRO_EXATO in view).toBe(false);
              // Testemunho: a view tem protótipo próprio e o topo é alcançado.
              expect(v.chavesInspecionadas).toBeGreaterThan(3);
              expect(v.alcancouObjectPrototype).toBe(true);
            });
          };

          conferirViews('recém-construída');
          for (const passo of c.passos) {
            executarPasso(p, passo, param);
            conferirViews(`após ${descreverPasso(passo)}`);
          }
        } finally {
          p.detached();
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    // A camada devolve sempre a mesma referência de array com uma view; se algum
    // dia devolvesse vazio, esta cláusula passaria sem inspecionar nada.
    expect(viewsInspecionadas).toBeGreaterThan(NUM_RUNS);
    expect(comViewNaoVazia).toBeGreaterThan(NUM_RUNS);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Os quatro estados nomeados pelo enunciado, na ordem canônica
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A sequência `recém-construída → anexada → atualizada → desanexada` está
 * afirmada dentro da propriedade acima, mas dispersa entre as combinações
 * sorteadas. Aqui ela aparece na ordem canônica e nomeada, para que a falha
 * aponte o estado exato sem precisar ler a saída de redução do gerador.
 */
describe('Property 3 — os quatro estados nomeados, na ordem canônica', () => {
  it('recém-construída, anexada, atualizada e desanexada: nenhuma delas intercepta', () => {
    const p = new BookmapPrimitive(OPCOES_CANONICAS, () => 0);
    const param = criarParametroDeAnexacao(GRAFICO_CANONICO);
    try {
      const conferir = (estado: string): void => {
        const v = varrerCamada(p, `primitive[${estado}]`);
        expect(montarRelatorio(estado, v.achados)).toBe('');
        expect(MEMBRO_EXATO in p).toBe(false);
        // Testemunho por estado: sem ele, um estado em que a varredura falhasse
        // em enumerar chaves passaria calado.
        expect(v.chavesInspecionadas).toBeGreaterThan(20);
        expect(v.alcancouObjectPrototype).toBe(true);
      };

      conferir('recém-construída');

      p.attached(param);
      conferir('anexada');

      p.updateAllViews();
      conferir('anexada, com as views reconstruídas');

      p.update({ metrica: 'FILA', maxCells: 900, minCellPx: 4 });
      conferir('atualizada');

      // O temporizador de repouso da escala é o único trabalho agendado. Deixar
      // o relógio simulado correr põe a camada no estado pós-repouso, que é
      // outro estado e merece a mesma conferência.
      vi.advanceTimersByTime(1_000);
      conferir('após o repouso da escala');

      p.detached();
      conferir('desanexada');

      // Reanexar depois de desanexar é caminho real: o gráfico remonta a cada
      // troca de intervalo de tempo.
      p.attached(param);
      p.paneViews();
      conferir('reanexada');
    } finally {
      p.detached();
    }
  });
});
