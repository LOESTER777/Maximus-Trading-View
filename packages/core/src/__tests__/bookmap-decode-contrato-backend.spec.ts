/**
 * Contrato cruzado — a saída real do codificador do backend atravessa o
 * decodificador real do frontend. Spec `bookmap-no-mapa-de-decisao`, tarefa 2.4.
 *
 * **Validates: Requirements 8.1, 8.7**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE, E POR QUE A PROPERTY 9 NÃO O SUBSTITUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O codificador colunar vive no **backend** e o decodificador vive no
 * **frontend**. São dois arquivos, em dois projetos, com os tipos declarados **à
 * mão em cada lado** — o frontend não importa da árvore do backend, seguindo a
 * mesma convenção dos outros tipos compartilhados do projeto.
 *
 * A Property 9 (`properties/p09-round-trip-colunar.property.spec.ts`) roda sobre
 * payload **gerado dentro do próprio teste**: ela prova que o decodificador é
 * inverso de um codificador de referência que o teste escreveu. Isso é valioso —
 * é a álgebra do round-trip em 500 conjuntos por cláusula — mas tem uma cegueira
 * estrutural: **nenhuma das duas pontas de produção participa do teste da
 * outra.** Renomear uma coluna num lado e não no outro deixaria o heatmap vazio
 * **sem erro nenhum**: o decodificador devolveria `null`, a tela mostraria
 * "decodificação ausente", e ninguém ligaria a causa ao rename.
 *
 * Este arquivo fecha exatamente essa fresta. A fixture
 * `fixtures/colunar-backend.json` é a saída **genuína** do codificador do
 * backend, versionada na tarefa 1.6, e atravessa aqui o decodificador **real**
 * do frontend. Se qualquer uma das duas pontas mudar sem a outra, esta suíte
 * reprova.
 *
 * ── CONSEQUÊNCIA DE MÉTODO: OS ESPERADOS SÃO LITERAIS ─────────────────────
 *
 * A tabela `CELULAS_ESPERADAS` foi **transcrita à mão** da fixture, valor por
 * valor. Nada aqui recalcula a decodificação para descobrir o que esperar —
 * derivar o esperado reimplementando o decodificador reintroduziria a mesma
 * cegueira que a Property 9 tem, e o arquivo perderia a razão de existir.
 *
 * O único trabalho que o teste faz sobre o grid é **resolver a indireção dos
 * eixos** para localizar cada célula pelo par `(instante, preço)`, que é
 * precisamente o que todo consumidor do grid faz. Localizar não é derivar: os
 * quatro valores comparados são literais escritos abaixo.
 *
 * Casar por par, e não por índice de coluna, é deliberado. A ordem das colunas é
 * a ordem de entrada do codificador — `colunas.ti` começa em `3, 0, 5, 1, 2, …`
 * de propósito — e um teste que comparasse posição por posição passaria a
 * depender de uma ordem que o contrato não promete.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O sha256 DA FIXTURE É AFIRMADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A fixture é byte-estável por construção (sem relógio, sem sorteio,
 * serialização fixa), então seu `sha256` é uma constante do contrato. Afirmá-lo
 * troca uma falha obscura de valor — "esperava 1201, recebeu 0" em uma célula
 * qualquer — por uma mensagem que diz o que realmente aconteceu: **a fixture
 * mudou**. Quem mudou o formato de propósito atualiza o hash junto e o histórico
 * registra que as duas pontas foram mexidas na mesma leva.
 *
 * ⚠️ Se este teste falhar **só** no hash, o formato provavelmente mudou de
 * propósito e falta atualizar esta suíte. Se falhar no hash **e** nos valores, é
 * divergência real entre as pontas — que é o achado que este arquivo existe para
 * produzir. Nesse caso o conserto não é silencioso: identifique qual lado
 * mudou antes de tocar em qualquer um dos dois.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LEITURA DE ARQUIVO AQUI, E POR QUE ELA NÃO É FONTE DE DADO (requisito 12.6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este é o **único** arquivo da feature que lê do sistema de arquivos, e o que
 * ele lê é um **artefato de teste versionado no repositório** — autorizado pela
 * tarefa 1.6, documentado em `fixtures/README.md`. Não é insumo de livro, de
 * execução nem de cobertura: nada em tempo de execução do produto passa por
 * aqui. O caminho de produção obtém tudo do endpoint de heatmap de
 * profundidade, e continua sem tocar o sistema de arquivos, em CSV ou em
 * qualquer outro formato.
 *
 * A leitura acontece **uma única vez**, e os mesmos bytes alimentam o hash e o
 * `JSON.parse`. Ler duas vezes — uma para o hash, outra para o objeto — tornaria
 * o hash uma afirmação sobre um arquivo que não é necessariamente o que foi
 * decodificado. Com uma leitura, o hash é uma afirmação sobre o objeto sob
 * teste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports são a superfície pública do núcleo puro de render, a
 * biblioteca de teste e três módulos nativos de plataforma usados só para
 * localizar, ler e resumir a fixture. O núcleo, por sua vez, alcança apenas os
 * próprios irmãos da pasta e um formatador de horário. Logo o fechamento
 * transitivo deste arquivo não tem caminho até camada de roteamento de conexão,
 * feed de cotação, envio de ordem, gestão de posição ou módulo de conector de
 * terminal, e não carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Nada aqui emite evento de decisão, envia ordem, escreve em tabela, altera
 * chave de configuração de trading ou escreve no sistema de arquivos — a
 * fixture é aberta somente para leitura, e um dos casos abaixo confirma que
 * seus bytes em disco continuam intactos ao fim da suíte.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência. Mesma
 * disciplina dos arquivos irmãos.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 * Os nomes de campo em português (`eixos`, `colunas`, `celulas`, `cobertura`)
 * são do contrato de rede e não são traduzidos.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeColumnar } from '@robustus/charts-core';
import type {
  BookmapDepthColunar,
  BookmapGrid,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// A fixture: uma leitura, dois usos
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `fileURLToPath` não é conveniência: sob o ambiente de teste, o `URL` global
 * é o do DOM e **não** o da plataforma, então passar `new URL(...)` direto para
 * a leitura falha com "must be of type string or an instance of Buffer or URL".
 * Converter para caminho textual evita esse choque de globais.
 */
const CAMINHO_FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/colunar-backend.json',
);

/** Os bytes crus. Lidos **uma vez**; alimentam o hash e todos os `JSON.parse`. */
const BYTES_FIXTURE = readFileSync(CAMINHO_FIXTURE);

/**
 * `sha256` esperado, documentado em `fixtures/README.md`.
 *
 * A fixture é byte-estável: `Date.UTC` é puro, não há relógio nem sorteio, e a
 * serialização é fixa. Duas gerações produzem este mesmo resumo. Se ele mudar
 * sem que a entrada do gerador tenha mudado, o **codificador** mudou.
 */
const SHA256_ESPERADO =
  'c0ceedc0984628203a7c83fa2057ea5ff572cfef53c153054d80ba8ebd027fb5';

/** Tamanho em bytes, junto do hash: identifica truncamento de forma direta. */
const BYTES_ESPERADOS = 2_764;

/**
 * Um objeto **novo** por chamada, sempre dos mesmos bytes.
 *
 * Cada caso recebe o seu, para que o caso de mutação possa mexer no payload sem
 * contaminar os vizinhos — um objeto de módulo compartilhado tornaria a suíte
 * sensível à ordem de execução.
 */
function lerFixture(): BookmapDepthColunar {
  return JSON.parse(BYTES_FIXTURE.toString('utf8')) as BookmapDepthColunar;
}

// ═════════════════════════════════════════════════════════════════════════════
// Envoltória esperada — literais transcritos da fixture
// ═════════════════════════════════════════════════════════════════════════════

const SYMBOL_ESPERADO = 'WINV26';
const FONTE_ESPERADA = 'MT5_L2';
/** No contrato de rede o campo é `de`; no grid ele chega como `dia`. */
const DIA_ESPERADO = '2026-08-26';
const BALDE_SEG_ESPERADO = 60;
const CELULAS_ESPERADAS_TOTAL = 32;

/**
 * Os seis baldes do eixo de tempo, em epoch ms, transcritos da fixture.
 *
 * `1787745600000` é 2026-08-26T12:00:00Z, ou seja **09:00 BRT** — a abertura.
 * Os demais avançam de 60 s, cobrindo 09:00 a 09:05 BRT.
 *
 * Precisam ser literais e não leituras do próprio eixo: é justamente a
 * identidade entre o eixo da fixture e o eixo do grid que está sob teste.
 */
const T0 = 1_787_745_600_000; // 09:00 BRT
const T1 = 1_787_745_660_000; // 09:01 BRT
const T2 = 1_787_745_720_000; // 09:02 BRT
const T3 = 1_787_745_780_000; // 09:03 BRT
const T4 = 1_787_745_840_000; // 09:04 BRT
const T5 = 1_787_745_900_000; // 09:05 BRT

const EIXO_T_ESPERADO: readonly number[] = [T0, T1, T2, T3, T4, T5];

/** Os seis preços do eixo, transcritos da fixture. Passo de 5 pontos. */
const EIXO_P_ESPERADO: readonly number[] = [
  176_985, 176_990, 176_995, 177_000, 177_005, 177_010,
];

/**
 * `EXEC_PARCIAL` é o estado **normal** do dado, não a exceção — medido em 100%
 * dos pregões materializados. A fixture reproduz isso de propósito, com os
 * quatro limites informados.
 */
const COBERTURA_ESPERADA = {
  classe: 'EXEC_PARCIAL',
  observacao:
    'Fila agregada de 09:00 a 09:05 BRT; execução agregada de 09:01 a 09:04 BRT. ' +
    'Os trechos 09:00–09:01 BRT e 09:04–09:05 BRT ficam sem execução capturada.',
  filaDeMs: T0,
  filaAteMs: T5,
  execDeMs: T1,
  execAteMs: T4,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// A tabela de células — transcrita à mão, célula por célula
// ═════════════════════════════════════════════════════════════════════════════

interface CelulaEsperada {
  readonly tsMs: number;
  readonly preco: number;
  readonly filaBid: number;
  readonly filaAsk: number;
  readonly execCompra: number;
  readonly execVenda: number;
}

/**
 * As 32 células emitidas, agrupadas por balde para leitura, com os quatro
 * valores de cada uma escritos à mão a partir da fixture.
 *
 * ── AS FAIXAS DE VALOR SÃO DISJUNTAS DE PROPÓSITO ─────────────────────────
 *
 * `filaBid` fica em 1.0xx–1.9xx, `filaAsk` em 2.0xx–2.9xx, `execCompra` em 3xx e
 * `execVenda` em 4xx. É a escolha que torna **detectável por inspeção do valor**
 * o erro mais provável de todos: duas colunas trocadas entre as pontas. Um
 * `filaBid` de 2.543 não é "um número diferente do esperado", é a coluna errada.
 * Como as faixas não se encostam, uma troca par a par dentro da célula também
 * não passa.
 *
 * ── OS CASOS QUE A TABELA COBRE, E POR QUE CADA UM ────────────────────────
 *
 * - `T1 @ 177000` tem as **quatro** grandezas não nulas e distintas.
 * - `T3 @ 176995` tem os **dois lados da fila** no mesmo par, que é o caso das
 *   duas passadas de desenho.
 * - `T4 @ 177000` tem **execução sem fila** — só `execCompra`/`execVenda`.
 * - A maioria tem **zero como valor legítimo** em parte das métricas: zero não
 *   pode ser confundido com ausência dentro de uma célula emitida.
 */
const CELULAS_ESPERADAS: readonly CelulaEsperada[] = [
  // ── T0 = 09:00 BRT — seis células; sem execução alguma, fora da cobertura ──
  { tsMs: T0, preco: 176_985, filaBid: 1201, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T0, preco: 176_990, filaBid: 1422, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T0, preco: 176_995, filaBid: 1610, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T0, preco: 177_000, filaBid: 1837, filaAsk: 2129, execCompra: 0, execVenda: 0 },
  { tsMs: T0, preco: 177_005, filaBid: 0, filaAsk: 2410, execCompra: 0, execVenda: 0 },
  { tsMs: T0, preco: 177_010, filaBid: 0, filaAsk: 2664, execCompra: 0, execVenda: 0 },

  // ── T1 = 09:01 BRT — cinco células; 177005 foi omitida (toda-zero) ─────────
  { tsMs: T1, preco: 176_985, filaBid: 1240, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T1, preco: 176_990, filaBid: 1390, filaAsk: 0, execCompra: 0, execVenda: 407 },
  { tsMs: T1, preco: 176_995, filaBid: 1655, filaAsk: 0, execCompra: 322, execVenda: 431 },
  // As quatro grandezas não nulas e distintas.
  { tsMs: T1, preco: 177_000, filaBid: 1861, filaAsk: 2207, execCompra: 355, execVenda: 453 },
  { tsMs: T1, preco: 177_010, filaBid: 0, filaAsk: 2731, execCompra: 0, execVenda: 0 },

  // ── T2 = 09:02 BRT — cinco células; 176990 foi omitida (toda-zero) ─────────
  { tsMs: T2, preco: 176_985, filaBid: 1188, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T2, preco: 176_995, filaBid: 1702, filaAsk: 0, execCompra: 333, execVenda: 0 },
  { tsMs: T2, preco: 177_000, filaBid: 0, filaAsk: 2284, execCompra: 366, execVenda: 442 },
  { tsMs: T2, preco: 177_005, filaBid: 0, filaAsk: 2476, execCompra: 388, execVenda: 0 },
  { tsMs: T2, preco: 177_010, filaBid: 0, filaAsk: 2798, execCompra: 0, execVenda: 0 },

  // ── T3 = 09:03 BRT — cinco células; 177010 foi omitida (toda-zero) ─────────
  { tsMs: T3, preco: 176_985, filaBid: 1305, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T3, preco: 176_990, filaBid: 1476, filaAsk: 0, execCompra: 311, execVenda: 0 },
  // Os dois lados da fila no mesmo par: exercita as duas passadas de desenho.
  { tsMs: T3, preco: 176_995, filaBid: 1099, filaAsk: 2018, execCompra: 0, execVenda: 0 },
  { tsMs: T3, preco: 177_000, filaBid: 1925, filaAsk: 0, execCompra: 344, execVenda: 464 },
  { tsMs: T3, preco: 177_005, filaBid: 0, filaAsk: 2543, execCompra: 0, execVenda: 486 },

  // ── T4 = 09:04 BRT — cinco células; 176985 foi omitida (toda-zero) ─────────
  { tsMs: T4, preco: 176_990, filaBid: 1533, filaAsk: 0, execCompra: 0, execVenda: 418 },
  { tsMs: T4, preco: 176_995, filaBid: 1748, filaAsk: 0, execCompra: 0, execVenda: 0 },
  // Execução sem fila alguma.
  { tsMs: T4, preco: 177_000, filaBid: 0, filaAsk: 0, execCompra: 377, execVenda: 475 },
  { tsMs: T4, preco: 177_005, filaBid: 0, filaAsk: 2115, execCompra: 399, execVenda: 0 },
  { tsMs: T4, preco: 177_010, filaBid: 0, filaAsk: 2855, execCompra: 0, execVenda: 497 },

  // ── T5 = 09:05 BRT — seis células; sem execução alguma, fora da cobertura ──
  { tsMs: T5, preco: 176_985, filaBid: 1017, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T5, preco: 176_990, filaBid: 1044, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T5, preco: 176_995, filaBid: 1063, filaAsk: 0, execCompra: 0, execVenda: 0 },
  { tsMs: T5, preco: 177_000, filaBid: 1978, filaAsk: 2351, execCompra: 0, execVenda: 0 },
  { tsMs: T5, preco: 177_005, filaBid: 0, filaAsk: 2609, execCompra: 0, execVenda: 0 },
  { tsMs: T5, preco: 177_010, filaBid: 0, filaAsk: 2922, execCompra: 0, execVenda: 0 },
];

/**
 * Os quatro pares que a grade 6 × 6 admite e que a fixture **não** traz, porque
 * a célula correspondente tinha os quatro valores em zero (critério 8.4).
 *
 * A ausência é afirmada, não tolerada: um codificador que parasse de omitir
 * passaria por um teste que só verificasse `⊆`, e a economia de 66% do formato
 * sumiria sem que nada reclamasse.
 */
const PARES_OMITIDOS: readonly { readonly tsMs: number; readonly preco: number }[] = [
  { tsMs: T1, preco: 177_005 },
  { tsMs: T2, preco: 176_990 },
  { tsMs: T3, preco: 177_010 },
  { tsMs: T4, preco: 176_985 },
];

/**
 * A **quinta** omissão da fixture não aparece em `PARES_OMITIDOS` porque não é
 * um par da grade: era o único registro do preço `177015`, e por isso esse preço
 * desapareceu do eixo inteiro.
 *
 * É a prova de que a omissão acontece **antes** da construção dos eixos. Um
 * codificador que montasse os eixos sobre a entrada bruta deixaria `177015` no
 * eixo de preço, e o decodificador acusaria índice fora do eixo — ou pior,
 * desenharia uma faixa de preço vazia no meio do heatmap.
 */
const PRECO_SOMENTE_EM_CELULA_ZERADA = 177_015;

/** 6 × 6 = 36 pares possíveis, menos os 4 omitidos, dá as 32 emitidas. */
const PARES_POSSIVEIS_NA_GRADE = 36;

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares de leitura
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Leitura indexada que **falha alto** em vez de devolver `undefined`.
 *
 * O projeto compila com `noUncheckedIndexedAccess`, então todo acesso indexado é
 * `number | undefined`. Silenciar isso com `?? 0` transformaria índice fora de
 * faixa — exatamente o defeito que esta suíte caça — em um zero plausível.
 */
function emIndice(vetor: ArrayLike<number>, i: number): number {
  const valor = vetor[i];
  if (valor === undefined) {
    throw new Error(`índice ${i} fora de vetor de comprimento ${vetor.length}`);
  }
  return valor;
}

/**
 * Decodifica, ou falha com mensagem que diz o que aconteceu.
 *
 * `expect(grid).not.toBeNull()` não estreita o tipo, e um `!` mais adiante
 * transformaria a falha mais importante desta suíte — a fixture do backend não
 * decodifica — num confuso "cannot read property of null" dezenas de linhas
 * depois. Aqui ela aparece pelo nome.
 */
function decodificarOuFalhar(payload: BookmapDepthColunar): BookmapGrid {
  const grid = decodeColumnar(payload);
  if (grid === null) {
    throw new Error(
      'decodeColumnar devolveu null para a fixture do backend: as duas pontas ' +
        'do formato colunar divergiram. Confira qual lado mudou antes de ' +
        'ajustar qualquer um dos dois.',
    );
  }
  return grid;
}

/** Chave do par `(instante, preço)` — a identidade real de uma célula. */
function chaveDoPar(tsMs: number, preco: number): string {
  return `${tsMs}|${preco}`;
}

/** As quatro grandezas de uma célula do grid, sem as coordenadas. */
interface QuadruplaLida {
  readonly filaBid: number;
  readonly filaAsk: number;
  readonly execCompra: number;
  readonly execVenda: number;
}

/**
 * Mapa `(instante, preço) → quatro valores`, resolvendo a indireção dos eixos.
 *
 * Este é o único processamento que a suíte faz sobre o grid, e é o mesmo que
 * qualquer consumidor faz: `grid.ti[k]` e `grid.pi[k]` são **posições**, e o
 * instante e o preço reais saem de `grid.times` e `grid.prices`. Resolver a
 * indireção é o que permite casar por par em vez de por posição de coluna — e é
 * por aqui que um índice deslocado se revela, porque a célula apareceria sob a
 * coordenada de outra.
 *
 * Falha em caso de par repetido: o contrato pressupõe unicidade de
 * `(instante, preço)`, e um par duplicado sobrescreveria silenciosamente o
 * primeiro, escondendo o defeito.
 */
function indexarPorPar(grid: BookmapGrid): Map<string, QuadruplaLida> {
  const porPar = new Map<string, QuadruplaLida>();
  for (let k = 0; k < grid.ti.length; k += 1) {
    const tsMs = emIndice(grid.times, emIndice(grid.ti, k));
    const preco = emIndice(grid.prices, emIndice(grid.pi, k));
    const chave = chaveDoPar(tsMs, preco);
    if (porPar.has(chave)) {
      throw new Error(`par (instante, preço) repetido no grid: ${chave}`);
    }
    porPar.set(chave, {
      filaBid: emIndice(grid.bid, k),
      filaAsk: emIndice(grid.ask, k),
      execCompra: emIndice(grid.buy, k),
      execVenda: emIndice(grid.sell, k),
    });
  }
  return porPar;
}

/** Vetor tipado → vetor comum, para comparação legível na mensagem de falha. */
function comoLista(vetor: ArrayLike<number>): number[] {
  const saida: number[] = [];
  for (let i = 0; i < vetor.length; i += 1) saida.push(emIndice(vetor, i));
  return saida;
}

// ═════════════════════════════════════════════════════════════════════════════
// Casos
// ═════════════════════════════════════════════════════════════════════════════

describe('contrato cruzado: a saída do codificador do backend no decodificador do frontend', () => {
  describe('a fixture sob teste', () => {
    it('tem o sha256 e o tamanho documentados em fixtures/README.md', () => {
      const resumo = createHash('sha256').update(BYTES_FIXTURE).digest('hex');

      // Falhar aqui, e só aqui, significa "a fixture mudou" — não "o
      // decodificador quebrou". A distinção é o motivo desta asserção existir.
      expect(resumo).toBe(SHA256_ESPERADO);
      expect(BYTES_FIXTURE.length).toBe(BYTES_ESPERADOS);
    });

    it('declara o formato colunar e as 32 células, com as seis colunas de igual comprimento', () => {
      const fixture = lerFixture();

      expect(fixture.formato).toBe('colunar');
      expect(fixture.celulas).toBe(CELULAS_ESPERADAS_TOTAL);

      // O comprimento autoritativo é o das colunas; `celulas` é declaração da
      // envoltória. Aqui os dois têm de concordar, e concordar com a tabela.
      const { ti, pi, b, a, c, v } = fixture.colunas;
      expect(ti).toHaveLength(CELULAS_ESPERADAS_TOTAL);
      expect(pi).toHaveLength(CELULAS_ESPERADAS_TOTAL);
      expect(b).toHaveLength(CELULAS_ESPERADAS_TOTAL);
      expect(a).toHaveLength(CELULAS_ESPERADAS_TOTAL);
      expect(c).toHaveLength(CELULAS_ESPERADAS_TOTAL);
      expect(v).toHaveLength(CELULAS_ESPERADAS_TOTAL);
    });

    it('traz as colunas fora de ordem, para que o decodificador não possa presumir ordenação', () => {
      const fixture = lerFixture();

      // Se algum dia a fixture vier ordenada, os casos abaixo continuariam
      // passando por acidente e deixariam de exercitar o que se quer. Este caso
      // é o alarme para isso.
      expect(comoLista(fixture.colunas.ti).slice(0, 5)).toEqual([3, 0, 5, 1, 2]);
      expect(comoLista(fixture.colunas.pi).slice(0, 5)).toEqual([4, 0, 5, 3, 2]);
    });
  });

  describe('decodificação', () => {
    it('decodifica a fixture sem devolver null — nunca grid parcial', () => {
      const grid = decodeColumnar(lerFixture());

      expect(grid).not.toBeNull();
      // "Sem null" só vale se o grid vier inteiro: um grid completo com zero
      // célula satisfaria `not.toBeNull()` e não decodificaria nada.
      expect(decodificarOuFalhar(lerFixture()).ti).toHaveLength(
        CELULAS_ESPERADAS_TOTAL,
      );
    });

    it('não lança nem em uma segunda passada, e é determinística', () => {
      const primeira = decodificarOuFalhar(lerFixture());
      const segunda = decodificarOuFalhar(lerFixture());

      expect(comoLista(segunda.times)).toEqual(comoLista(primeira.times));
      expect(comoLista(segunda.prices)).toEqual(comoLista(primeira.prices));
      expect(comoLista(segunda.bid)).toEqual(comoLista(primeira.bid));
      expect(comoLista(segunda.ask)).toEqual(comoLista(primeira.ask));
      expect(comoLista(segunda.buy)).toEqual(comoLista(primeira.buy));
      expect(comoLista(segunda.sell)).toEqual(comoLista(primeira.sell));
    });
  });

  describe('eixos', () => {
    it('reproduz os dois eixos exatamente como a fixture os traz', () => {
      const grid = decodificarOuFalhar(lerFixture());

      expect(comoLista(grid.times)).toEqual(EIXO_T_ESPERADO);
      expect(comoLista(grid.prices)).toEqual(EIXO_P_ESPERADO);
    });

    it('mantém os dois eixos estritamente crescentes e sem repetição', () => {
      const grid = decodificarOuFalhar(lerFixture());

      // `<=` contra o anterior rejeita desordem e repetição na mesma passada:
      // as duas quebram igualmente a busca por posição.
      for (let i = 1; i < grid.times.length; i += 1) {
        expect(emIndice(grid.times, i)).toBeGreaterThan(
          emIndice(grid.times, i - 1),
        );
      }
      for (let i = 1; i < grid.prices.length; i += 1) {
        expect(emIndice(grid.prices, i)).toBeGreaterThan(
          emIndice(grid.prices, i - 1),
        );
      }
    });

    it('mantém todo índice dentro do eixo correspondente, e inteiro', () => {
      const grid = decodificarOuFalhar(lerFixture());

      for (let k = 0; k < grid.ti.length; k += 1) {
        const ti = emIndice(grid.ti, k);
        const pi = emIndice(grid.pi, k);

        expect(Number.isInteger(ti)).toBe(true);
        expect(ti).toBeGreaterThanOrEqual(0);
        expect(ti).toBeLessThan(grid.times.length);

        expect(Number.isInteger(pi)).toBe(true);
        expect(pi).toBeGreaterThanOrEqual(0);
        expect(pi).toBeLessThan(grid.prices.length);
      }
    });

    it('não traz no eixo de preço o nível que só existia em célula zerada', () => {
      const grid = decodificarOuFalhar(lerFixture());

      // A omissão da célula toda-zero acontece ANTES da construção dos eixos.
      expect(comoLista(grid.prices)).not.toContain(
        PRECO_SOMENTE_EM_CELULA_ZERADA,
      );
    });
  });

  describe('round-trip das coordenadas', () => {
    it('reproduz o instante de origem em grid.times[grid.ti[k]], bit a bit', () => {
      const fixture = lerFixture();
      const grid = decodificarOuFalhar(fixture);

      for (let k = 0; k < grid.ti.length; k += 1) {
        const daFixture = emIndice(
          fixture.eixos.t,
          emIndice(fixture.colunas.ti, k),
        );
        const doGrid = emIndice(grid.times, emIndice(grid.ti, k));

        // `Object.is` porque a promessa é de igualdade exata: os eixos são de 64
        // bits justamente para que epoch ms (~1,79 × 10¹²) volte sem perda.
        expect(Object.is(doGrid, daFixture)).toBe(true);
      }
    });

    it('reproduz o preço de origem em grid.prices[grid.pi[k]], bit a bit', () => {
      const fixture = lerFixture();
      const grid = decodificarOuFalhar(fixture);

      for (let k = 0; k < grid.pi.length; k += 1) {
        const daFixture = emIndice(
          fixture.eixos.p,
          emIndice(fixture.colunas.pi, k),
        );
        const doGrid = emIndice(grid.prices, emIndice(grid.pi, k));

        expect(Object.is(doGrid, daFixture)).toBe(true);
      }
    });
  });

  describe('valores por par (instante, preço)', () => {
    it('reproduz os quatro valores de cada uma das 32 células', () => {
      const porPar = indexarPorPar(decodificarOuFalhar(lerFixture()));

      expect(porPar.size).toBe(CELULAS_ESPERADAS_TOTAL);
      expect(CELULAS_ESPERADAS).toHaveLength(CELULAS_ESPERADAS_TOTAL);

      for (const esperada of CELULAS_ESPERADAS) {
        const chave = chaveDoPar(esperada.tsMs, esperada.preco);
        const lida = porPar.get(chave);

        // Par ausente é falha distinta de valor errado, e a mensagem diz qual é.
        expect(lida, `par ausente do grid: ${chave}`).toBeDefined();
        expect(lida, `valores divergentes no par ${chave}`).toEqual({
          filaBid: esperada.filaBid,
          filaAsk: esperada.filaAsk,
          execCompra: esperada.execCompra,
          execVenda: esperada.execVenda,
        });
      }
    });

    it('não traz par algum além dos 32 esperados', () => {
      const porPar = indexarPorPar(decodificarOuFalhar(lerFixture()));

      const esperados = new Set(
        CELULAS_ESPERADAS.map((c) => chaveDoPar(c.tsMs, c.preco)),
      );
      const inesperados = Array.from(porPar.keys()).filter(
        (chave) => !esperados.has(chave),
      );

      expect(inesperados).toEqual([]);
    });

    it('mantém cada grandeza na sua faixa de valor, o que expõe coluna trocada', () => {
      const grid = decodificarOuFalhar(lerFixture());

      // As faixas são disjuntas por construção da fixture. Uma coluna inteira
      // trocada entre as pontas cai fora da faixa e é acusada aqui, com nome —
      // em vez de virar "esperava 1201, recebeu 0" numa célula qualquer.
      for (let k = 0; k < grid.ti.length; k += 1) {
        const bid = emIndice(grid.bid, k);
        const ask = emIndice(grid.ask, k);
        const compra = emIndice(grid.buy, k);
        const venda = emIndice(grid.sell, k);

        if (bid !== 0) {
          expect(bid, `filaBid fora da faixa na célula ${k}`).toBeGreaterThanOrEqual(1_000);
          expect(bid, `filaBid fora da faixa na célula ${k}`).toBeLessThan(2_000);
        }
        if (ask !== 0) {
          expect(ask, `filaAsk fora da faixa na célula ${k}`).toBeGreaterThanOrEqual(2_000);
          expect(ask, `filaAsk fora da faixa na célula ${k}`).toBeLessThan(3_000);
        }
        if (compra !== 0) {
          expect(compra, `execCompra fora da faixa na célula ${k}`).toBeGreaterThanOrEqual(300);
          expect(compra, `execCompra fora da faixa na célula ${k}`).toBeLessThan(400);
        }
        if (venda !== 0) {
          expect(venda, `execVenda fora da faixa na célula ${k}`).toBeGreaterThanOrEqual(400);
          expect(venda, `execVenda fora da faixa na célula ${k}`).toBeLessThan(500);
        }
      }
    });
  });

  describe('omissão da célula integralmente zerada (critério 8.4)', () => {
    it('não emite célula alguma com os quatro valores em zero', () => {
      const grid = decodificarOuFalhar(lerFixture());

      const zeradas: number[] = [];
      for (let k = 0; k < grid.ti.length; k += 1) {
        if (
          emIndice(grid.bid, k) === 0 &&
          emIndice(grid.ask, k) === 0 &&
          emIndice(grid.buy, k) === 0 &&
          emIndice(grid.sell, k) === 0
        ) {
          zeradas.push(k);
        }
      }

      // Medido: a fixture emite ZERO célula toda-zerada — das 37 candidatas do
      // gerador, as 5 nessa condição saíram omitidas. Logo a omissão é afirmada
      // aqui na forma positiva, e não registrada como "não havia caso".
      expect(zeradas).toEqual([]);
    });

    it('omite os quatro pares da grade cujos quatro valores eram zero', () => {
      const porPar = indexarPorPar(decodificarOuFalhar(lerFixture()));

      for (const omitido of PARES_OMITIDOS) {
        const chave = chaveDoPar(omitido.tsMs, omitido.preco);
        expect(
          porPar.has(chave),
          `par deveria estar omitido, mas veio no grid: ${chave}`,
        ).toBe(false);
      }
    });

    it('fecha a aritmética: 36 pares da grade, 4 omitidos, 32 emitidos', () => {
      const grid = decodificarOuFalhar(lerFixture());

      expect(grid.times.length * grid.prices.length).toBe(
        PARES_POSSIVEIS_NA_GRADE,
      );
      expect(PARES_POSSIVEIS_NA_GRADE - PARES_OMITIDOS.length).toBe(
        CELULAS_ESPERADAS_TOTAL,
      );
      expect(grid.ti.length).toBe(CELULAS_ESPERADAS_TOTAL);
    });
  });

  describe('envoltória', () => {
    it('leva symbol, fonte, dia e baldeSeg da fixture para o grid', () => {
      const grid = decodificarOuFalhar(lerFixture());

      expect(grid.symbol).toBe(SYMBOL_ESPERADO);
      expect(grid.fonte).toBe(FONTE_ESPERADA);
      // ⚠️ Renome de campo entre as pontas: `de` no contrato de rede, `dia` no
      // grid. É o tipo de tradução que diverge sem ninguém notar.
      expect(grid.dia).toBe(DIA_ESPERADO);
      expect(grid.baldeSeg).toBe(BALDE_SEG_ESPERADO);
    });

    it('leva a cobertura completa, com a classe e os quatro limites', () => {
      const grid = decodificarOuFalhar(lerFixture());

      expect(grid.cobertura).toEqual(COBERTURA_ESPERADA);
    });

    it('mantém a cobertura coerente com as células: sem execução em T0 nem em T5', () => {
      const grid = decodificarOuFalhar(lerFixture());
      const porPar = indexarPorPar(grid);

      // A cobertura declara execução só de T1 a T4. Se houvesse execução em T0
      // ou T5, a fixture afirmaria uma cobertura que ela própria contradiz — e o
      // núcleo de cobertura seria exercitado contra um caso impossível.
      for (const preco of EIXO_P_ESPERADO) {
        for (const tsMs of [T0, T5]) {
          const lida = porPar.get(chaveDoPar(tsMs, preco));
          if (lida === undefined) continue;
          expect(lida.execCompra, `execução fora da cobertura em ${tsMs}`).toBe(0);
          expect(lida.execVenda, `execução fora da cobertura em ${tsMs}`).toBe(0);
        }
      }
    });
  });

  describe('a fixture não é tocada', () => {
    it('não é mutada pela decodificação', () => {
      const fixture = lerFixture();
      const antes = JSON.stringify(fixture);

      decodificarOuFalhar(fixture);

      // `JSON.stringify` é sensível a valor E a ordem de chave, então pega tanto
      // um valor alterado quanto uma reordenação de coluna feita no lugar.
      expect(JSON.stringify(fixture)).toBe(antes);
    });

    it('produz um grid independente: alterar a fixture depois não altera o grid', () => {
      const fixture = lerFixture();
      const grid = decodificarOuFalhar(fixture);
      const bidAntes = comoLista(grid.bid);
      const timesAntes = comoLista(grid.times);

      // Se o decodificador tivesse referenciado os vetores do payload em vez de
      // copiá-los, uma resposta seguinte sobrescrevendo o payload corromperia,
      // sem aviso, um grid já desenhado na tela.
      //
      // ⚠️ A dupla conversão via `unknown` é necessária, e não desleixo: o tipo
      // do contrato declara as colunas `readonly` de propósito, e este caso
      // precisa justamente violar isso para provar que o grid não as referencia.
      // A alternativa — tornar o tipo mutável — enfraqueceria o contrato inteiro
      // para servir a um único teste.
      const colunas = fixture.colunas as unknown as { b: number[] };
      const eixos = fixture.eixos as unknown as { t: number[] };
      colunas.b[0] = 999_999;
      eixos.t[0] = 0;

      expect(comoLista(grid.bid)).toEqual(bidAntes);
      expect(comoLista(grid.times)).toEqual(timesAntes);
    });

    it('mantém os bytes em disco intactos: a suíte só lê a fixture', () => {
      const agora = readFileSync(CAMINHO_FIXTURE);
      const resumo = createHash('sha256').update(agora).digest('hex');

      expect(resumo).toBe(SHA256_ESPERADO);
    });
  });
});
