/**
 * Testes unitários por exemplo de `detectWalls` — spec
 * `bookmap-no-mapa-de-decisao`, tarefa 4.5.
 *
 * **Validates: Requirements 6.5, 6.6, 6.7, 6.8**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO É POR EXEMPLO, E NÃO POR PROPRIEDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A qualificação de parede não é uma lei algébrica sobre um domínio contínuo —
 * é uma **pilha de limiares**: 3 baldes consecutivos, percentil 90, piso de 100
 * contratos, banda morta de ±15%, corte em 50% de cobertura de execução, teto de
 * 4 por grupo. Cada um desses números é uma decisão de produto que pode ser
 * trocada por engano, e o que protege uma decisão de produto é uma **âncora
 * explícita no valor exato do limiar**, com a resposta esperada evidente por
 * inspeção da fixture.
 *
 * Geração aleatória cobriria o miolo de cada faixa e passaria a raspar as bordas
 * por acidente: a chance de um gerador produzir uma variação de **exatamente**
 * 15,000% é nula na prática, e é justamente essa a fronteira que separa
 * `ESTAVEL` de `CRESCENDO`. As propriedades desta feature ficam com o que é
 * quantificável sobre todo o domínio (agregação, escala, pixel); os limiares
 * ficam aqui, um caso por borda, com o número escrito na asserção.
 *
 * ⚠️ Todas as fronteiras são afirmadas **dos dois lados** — dentro e fora —
 * porque um teste só do lado de dentro passa igual numa implementação que troque
 * `>` por `>=`. É a diferença entre documentar o limiar e apenas tocá-lo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ARITMÉTICA DAS BORDAS É EXATA, NÃO APROXIMADA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nenhuma asserção deste arquivo usa `toBeCloseTo`, e os pares foram escolhidos
 * **medindo**, não presumindo. Cada um produz o limiar em ponto flutuante binário
 * sem resíduo:
 *
 * | par (anterior → recente) | conta                 | resultado  |
 * |--------------------------|-----------------------|------------|
 * | 200 → 231                | `(31 / 200) × 100`    | `15.5`     |
 * | 200 → 230                | `(30 / 200) × 100`    | `15` ⟵ borda |
 * | 200 → 225                | `(25 / 200) × 100`    | `12.5`     |
 * | 200 → 175                | `(−25 / 200) × 100`   | `−12.5`    |
 * | 200 → 170                | `(−30 / 200) × 100`   | `−15` ⟵ borda |
 * | 200 → 169                | `(−31 / 200) × 100`   | `−15.5`    |
 * | 200 → 100                | `(−100 / 200) × 100`  | `−50`      |
 *
 * O caso de `15` merece nota: `0,15` **não** é representável em binário, mas o
 * duplo mais próximo multiplicado por 100 fica a menos de meio ulp de `15`, logo
 * arredonda para `15` exato. O mesmo vale para `−15`.
 *
 * ⚠️ E a sorte não é geral — `200 → 229` daria `14.499999999999998`, e uma
 * asserção em `14.5` reprovaria sem que houvesse defeito algum. É por isso que os
 * casos de miolo usam `±12,5%`, cuja divisão cai numa potência de dois. A escolha
 * está anotada nos próprios testes para ninguém "arredondar" o par de volta.
 *
 * Todas as quantidades usadas (`200`, `230`, `231`, `225`, `175`, `170`, `169`,
 * `100`, `500`, `600`, `99`, `50`, `10`, `5`) são exatas em precisão simples,
 * então nada se perde na leitura das colunas `Float32Array`. Daí `toBe`:
 * tolerância admitiria um erro que não existe e deixaria de reprovar quem mexesse
 * na fórmula.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ARMADILHA DA FIXTURE: O LIMIAR É RELATIVO, ENTÃO PRECISA DE ENCHIMENTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O limiar de quantidade é `max(percentil 90 das células de fila não nula, 100)`.
 * O percentil é **da amostra**, o que produz um efeito contraintuitivo: numa
 * fixture pequena com duas paredes e nada em volta, as próprias paredes são a
 * amostra, o p90 cai na maior delas e **a menor não qualifica**. Um teste escrito
 * sem perceber isso falharia por um motivo que nada tem a ver com o que ele quer
 * afirmar.
 *
 * A saída é reproduzir o que o dado real tem: massa no miolo. `montarGrid`
 * acrescenta **lastro** — células de 10 contratos em preços dedicados, longe dos
 * preços de teste — dimensionado em `10 × (células grandes) + 40` valores
 * positivos. Com isso o p90 cai sempre no lastro e o limiar efetivo é o **piso
 * absoluto de 100**, que é um número fixo e legível na asserção.
 *
 * O lastro nunca contamina o resultado: 10 contratos está abaixo do piso, então
 * esses preços são avaliados e rejeitados. Dois testes provam que a máquina de
 * fixture faz o que promete, em vez de deixar isso como suposição do autor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O EIXO DE TEMPO É DENSO, E ISSO É PARTE DO CONTRATO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "3 baldes consecutivos" é medido no **eixo de tempo** (`ti` avançando de
 * exatamente 1), não na sequência de células presentes. Um eixo montado apenas
 * com os instantes efetivamente usados tornaria dois baldes distantes
 * **adjacentes por índice**, e o teste do vão passaria a afirmar o contrário do
 * que pretende — costurar dois picos separados e chamar isso de parede.
 *
 * Por isso `construirGrid` monta o eixo **denso**, do primeiro ao último balde da
 * fixture com passo de um balde, e o lastro cobre a faixa inteira. É também o que
 * a retaguarda materializa.
 *
 * As células são endereçadas por **índice de balde**, não por instante, de modo
 * que a posição no eixo não depende de aritmética de tempo feita na fixture. O
 * helper reprova balde não inteiro ou negativo e coordenada `(balde, preço)`
 * repetida, em vez de deslocar índices em silêncio — foi essa segunda verificação
 * que pegou uma fixture minha que declarava os dois lados do livro como duas
 * células no mesmo lugar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `INDETERMINADA` TEM PESO, PORQUE NA PRÁTICA É O CAMINHO PREDOMINANTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os 5 pregões materializados são todos `EXEC_PARCIAL`: a fila vai até 18:29 e a
 * execução para ~6 h antes, em 12:31. Toda parede cujas janelas de tendência
 * caiam depois do fim da execução capturada sai como `INDETERMINADA` — e o
 * requisito 6.8 exige mais que o rótulo: exige que a contagem de paredes
 * `CANCELADA` permaneça **zero** nesse estado. Afirmar cancelamento a partir de
 * ausência de dado inverteria a leitura sempre que a fila tivesse sido, na
 * verdade, absorvida.
 *
 * O bloco de 6.8 percorre cada maneira de a cobertura não abranger o intervalo —
 * ausente, curta por um milissegundo, começando tarde, terminando horas antes da
 * fila, classe sem execução, limite nulo, limite invertido — e afirma as duas
 * coisas que o requisito pede: a causa `INDETERMINADA` e a contagem de
 * `CANCELADA` em zero.
 *
 * ⚠️ `CANCELADA` **não** é inalcançável nesse dado, e o arquivo prova isso: uma
 * parede cujas dez últimas células caiam inteiramente antes do fim da execução —
 * o nível que o livro abandonou na manhã porque o mercado se afastou — tem
 * cobertura e é classificada. Codificar "nunca `CANCELADA`" contradiria o
 * requisito 6.7. O que se garante é o condicional: sem cobertura, nunca
 * `CANCELADA`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA (requisito 12.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são a superfície pública do núcleo puro de render
 * e a biblioteca de teste. Aquele módulo é só reexportação, e o fechamento
 * transitivo dos irmãos que ele reexporta alcança um único utilitário de
 * formatação de horário, que não importa nada. Logo não existe caminho daqui até
 * camada de roteamento de conexão, feed de cotação, envio de ordem ou estado de
 * posição, e nada aqui carrega endereço de rede, credencial nem identificador de
 * conta.
 *
 * Todo insumo é sintetizado pelos helpers deste arquivo. Nada é lido de rede, de
 * banco ou do sistema de arquivos, em CSV ou em qualquer outro formato. Nenhuma
 * escrita acontece em tabela alguma, nenhuma chave de configuração é alterada e
 * nenhum evento de decisão é emitido.
 *
 * Não há leitura de relógio: o instante de referência é uma constante numérica
 * literal, e o preço corrente entra por parâmetro em toda chamada.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a verificação de
 * independência inspeciona **integralmente** todo arquivo criado por esta
 * feature, teste incluído, e uma citação em comentário contaria como ocorrência.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';

import {
  detectWalls,
  positiveQuantileOfPair,
  WALL_ABSORCAO_MIN_RATIO,
  WALL_BALDES_TENDENCIA_DEFAULT,
  WALL_HISTERESE_PCT,
  WALL_MAX_POR_LADO_DEFAULT,
  WALL_MIN_BALDES_CONSECUTIVOS,
  WALL_MIN_QUANTIDADE_ABSOLUTO,
  WALL_QUANTILE,
  WALL_VARIACAO_PCT_SEM_BASE,
} from '@robustus/charts-core';
import type {
  BookmapGrid,
  BookmapWall,
  CoberturaHeatmap,
  DetectWallsOptions,
} from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes do cenário
// ═════════════════════════════════════════════════════════════════════════════

/** Duração do balde, em segundos — o valor materializado nos 5 pregões. */
const BALDE_SEG = 60;

/** A mesma duração em milissegundos, que é a unidade dos eixos de tempo. */
const BALDE_MS = BALDE_SEG * 1000;

/** Tick do mini-índice, em pontos. Define o espaçamento do eixo de preço. */
const TICK = 5;

/**
 * Primeiro balde da fixture, epoch ms — `2026-08-28 09:00 BRT`.
 *
 * Constante **literal**, e não `Date.now()` nem `new Date(...)`: o núcleo é
 * determinístico e o teste não pode depender de quando roda. O valor está escrito
 * por extenso para que nenhuma aritmética de fuso aconteça aqui.
 */
const ABERTURA_MS = 1_787_918_400_000;

/** Preço corrente de referência, o mesmo do exemplo de tela do design. */
const PRECO_ATUAL = 178_020;

/**
 * Base do eixo de preço do lastro, bem abaixo dos preços de teste.
 *
 * Distante de propósito: se o lastro caísse perto dos preços de teste, uma
 * mudança na quantidade de lastro poderia colidir com um preço afirmado e trocar
 * o resultado por motivo alheio ao que o teste quer dizer.
 */
const LASTRO_PRECO_BASE = 170_000;

/** Quantidade de cada célula de lastro, em contratos. Abaixo do piso de 100. */
const LASTRO_CT = 10;

// ═════════════════════════════════════════════════════════════════════════════
// Máquina de fixture
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uma célula da fixture, endereçada por **índice de balde** em vez de instante.
 *
 * Índice porque é o que a regra de consecutividade observa: escrever
 * `balde: 3` deixa evidente na fixture que aquele balde é o quarto, enquanto um
 * epoch ms exigiria conferir a aritmética para saber se há vão.
 */
interface Celula {
  readonly balde: number;
  readonly preco: number;
  readonly bid?: number;
  readonly ask?: number;
  readonly buy?: number;
  readonly sell?: number;
}

/** Instante de início do balde `b`. */
function ts(b: number): number {
  return ABERTURA_MS + b * BALDE_MS;
}

/**
 * Monta um `BookmapGrid` respeitando as três invariantes do tipo: seis colunas de
 * mesmo comprimento, todo índice dentro do seu eixo, e eixos estritamente
 * crescentes.
 *
 * O eixo de tempo é **denso** entre o menor e o maior balde da fixture — ver o
 * cabeçalho do arquivo para o motivo. O eixo de preço fica esparso, com os preços
 * efetivamente usados: a consecutividade não é medida nele, e densificá-lo só
 * inflaria a fixture.
 *
 * Reprova balde negativo em vez de saneá-lo, porque balde negativo numa fixture é
 * erro de quem escreveu o teste, não entrada a tolerar.
 */
function construirGrid(
  celulas: readonly Celula[],
  cobertura: CoberturaHeatmap | null = null,
): BookmapGrid {
  if (celulas.length === 0) {
    throw new Error('fixture sem células: nada a detectar');
  }

  const baldes = celulas.map((c) => c.balde);
  for (const b of baldes) {
    if (!Number.isInteger(b) || b < 0) {
      throw new Error(`balde inválido na fixture: ${String(b)}`);
    }
  }

  const primeiro = Math.min(...baldes);
  const ultimo = Math.max(...baldes);

  // Eixo denso: um instante por balde da faixa, inclusive os baldes em que
  // nenhum preço tem célula. É o que dá sentido a `ti[k] === ti[k'] + 1`.
  const times = new Float64Array(ultimo - primeiro + 1);
  for (let i = 0; i < times.length; i += 1) times[i] = ts(primeiro + i);

  const precos = Array.from(new Set(celulas.map((c) => c.preco))).sort(
    (a, b) => a - b,
  );
  const indiceDoPreco = new Map<number, number>(precos.map((p, i) => [p, i]));

  // Par `(balde, preço)` repetido significaria duas células na mesma coordenada,
  // que o payload não produz e que tornaria o resultado dependente da ordem.
  const vistos = new Set<string>();
  for (const c of celulas) {
    const chave = `${c.balde}|${c.preco}`;
    if (vistos.has(chave)) {
      throw new Error(`célula duplicada na fixture: ${chave}`);
    }
    vistos.add(chave);
  }

  const total = celulas.length;
  const ti = new Uint32Array(total);
  const pi = new Uint32Array(total);
  const bid = new Float32Array(total);
  const ask = new Float32Array(total);
  const buy = new Float32Array(total);
  const sell = new Float32Array(total);

  celulas.forEach((c, k) => {
    ti[k] = c.balde - primeiro;
    pi[k] = indiceDoPreco.get(c.preco) ?? 0;
    bid[k] = c.bid ?? 0;
    ask[k] = c.ask ?? 0;
    buy[k] = c.buy ?? 0;
    sell[k] = c.sell ?? 0;
  });

  return {
    symbol: 'WINV26',
    fonte: 'MT5_L2',
    dia: '2026-08-28',
    baldeSeg: BALDE_SEG,
    times,
    prices: Float64Array.from(precos),
    ti,
    pi,
    bid,
    ask,
    buy,
    sell,
    cobertura,
  };
}

/**
 * Lastro: células pequenas em preços dedicados, o suficiente para o percentil 90
 * cair nelas e o limiar efetivo virar o piso absoluto de 100 contratos.
 *
 * Dimensionamento em `10 × grandes + 40` valores positivos, com `grandes` sendo
 * a contagem de valores de fila que **alcançam** o piso. A condição a satisfazer
 * é `ceil(0,9 × N) ≤ pequenos`, ou seja `pequenos ≥ 9 × grandes`; a folga de 40
 * cobre a fixture minúscula, em que `9 × grandes` é um número pequeno demais para
 * o arredondamento do posto.
 *
 * Cada célula contribui com **dois** valores positivos, um por lado do livro, e
 * as linhas são preenchidas por inteiro para que a contagem seja exata.
 */
function construirLastro(
  primeiroBalde: number,
  ultimoBalde: number,
  celulasGrandes: number,
): Celula[] {
  const baldesNaFaixa = ultimoBalde - primeiroBalde + 1;
  const valoresDesejados = 10 * celulasGrandes + 40;
  const celulasDesejadas = Math.ceil(valoresDesejados / 2);
  const linhas = Math.ceil(celulasDesejadas / baldesNaFaixa);

  const out: Celula[] = [];
  for (let linha = 0; linha < linhas; linha += 1) {
    const preco = LASTRO_PRECO_BASE + linha * TICK;
    for (let b = primeiroBalde; b <= ultimoBalde; b += 1) {
      out.push({ balde: b, preco, bid: LASTRO_CT, ask: LASTRO_CT });
    }
  }
  return out;
}

/**
 * Grid de teste: as células declaradas mais o lastro que estabiliza o limiar em
 * 100 contratos.
 *
 * O lastro cobre a faixa **inteira** de baldes das células declaradas, o que
 * mantém o eixo de tempo denso mesmo quando a fixture deixa um vão de propósito.
 */
function montarGrid(
  paredes: readonly Celula[],
  cobertura: CoberturaHeatmap | null = null,
): BookmapGrid {
  const baldes = paredes.map((c) => c.balde);
  const primeiro = Math.min(...baldes);
  const ultimo = Math.max(...baldes);

  let grandes = 0;
  for (const c of paredes) {
    if ((c.bid ?? 0) >= WALL_MIN_QUANTIDADE_ABSOLUTO) grandes += 1;
    if ((c.ask ?? 0) >= WALL_MIN_QUANTIDADE_ABSOLUTO) grandes += 1;
  }

  return construirGrid(
    [...paredes, ...construirLastro(primeiro, ultimo, grandes)],
    cobertura,
  );
}

/** Parede de quantidade constante ao longo dos baldes indicados. */
function paredeConstante(
  preco: number,
  lado: 'BID' | 'ASK',
  quantidade: number,
  baldes: readonly number[],
): Celula[] {
  return baldes.map((balde) =>
    lado === 'BID'
      ? { balde, preco, bid: quantidade }
      : { balde, preco, ask: quantidade },
  );
}

/**
 * Parede nos dois lados do livro, no mesmo preço e nos mesmos baldes.
 *
 * Existe porque cada par `(balde, preço)` admite **uma única** célula, com uma
 * coluna por lado: chamar `paredeConstante` duas vezes no mesmo preço e nos
 * mesmos baldes produziria células duplicadas, que o payload não gera e que
 * `construirGrid` reprova.
 */
function paredeDeDoisLados(
  preco: number,
  bid: number,
  ask: number,
  baldes: readonly number[],
): Celula[] {
  return baldes.map((balde) => ({ balde, preco, bid, ask }));
}

/**
 * Parede com as duas janelas de tendência explícitas: cinco baldes na quantidade
 * `anterior`, cinco na quantidade `recente`.
 *
 * Dez baldes é exatamente `2 × WALL_BALDES_TENDENCIA_DEFAULT`, o mínimo que
 * autoriza a comparação. Com isso as janelas cobrem a fixture inteira e não há
 * dúvida sobre quais células entram em cada média.
 *
 * `execPorBalde`, quando informado, distribui execução no mesmo preço — é o
 * insumo da classificação da causa da retirada.
 */
function paredeComTendencia(
  preco: number,
  lado: 'BID' | 'ASK',
  anterior: number,
  recente: number,
  opts: { readonly baldeInicial?: number; readonly execPorBalde?: readonly number[] } = {},
): Celula[] {
  const base = opts.baldeInicial ?? 0;
  const janela = WALL_BALDES_TENDENCIA_DEFAULT;
  const out: Celula[] = [];

  for (let i = 0; i < 2 * janela; i += 1) {
    const quantidade = i < janela ? anterior : recente;
    const buy = opts.execPorBalde?.[i] ?? 0;
    out.push(
      lado === 'BID'
        ? { balde: base + i, preco, bid: quantidade, buy }
        : { balde: base + i, preco, ask: quantidade, buy },
    );
  }
  return out;
}

/** Cobertura de execução, com os limites de fila preenchidos de forma plausível. */
function coberturaExec(
  classe: CoberturaHeatmap['classe'],
  execDeMs: number | null,
  execAteMs: number | null,
  filaAteMs: number = ts(64),
): CoberturaHeatmap {
  return {
    classe,
    observacao: null,
    filaDeMs: ABERTURA_MS,
    filaAteMs,
    execDeMs,
    execAteMs,
  };
}

/** Opções de chamada. `minQuantidade: 0` prova de passagem que o piso é absoluto. */
function opcoes(overrides: Partial<DetectWallsOptions> = {}): DetectWallsOptions {
  return {
    baldesTendencia: WALL_BALDES_TENDENCIA_DEFAULT,
    maxPorLado: WALL_MAX_POR_LADO_DEFAULT,
    minQuantidade: 0,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Leitura do resultado sem indexação insegura
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A única parede da lista.
 *
 * Falha com mensagem explícita quando a lista tem tamanho diferente de um, em vez
 * de deixar o teste seguir com `undefined` e reprovar num `expect` distante da
 * causa. O `throw` também é o que estreita o tipo sob `noUncheckedIndexedAccess`.
 */
function unica(paredes: readonly BookmapWall[]): BookmapWall {
  expect(paredes).toHaveLength(1);
  const [primeira] = paredes;
  if (primeira === undefined) {
    throw new Error('lista de paredes vazia onde se esperava exatamente uma');
  }
  return primeira;
}

/** A parede de um lado do livro, ou `undefined` quando aquele lado não qualificou. */
function doLado(
  paredes: readonly BookmapWall[],
  lado: 'BID' | 'ASK',
): BookmapWall | undefined {
  return paredes.find((p) => p.lado === lado);
}

/** A mesma leitura, exigindo presença. */
function exigirLado(
  paredes: readonly BookmapWall[],
  lado: 'BID' | 'ASK',
): BookmapWall {
  const achada = doLado(paredes, lado);
  if (achada === undefined) {
    throw new Error(`nenhuma parede do lado ${lado} no resultado`);
  }
  return achada;
}

/** Assinatura legível de cada parede, para comparar listas inteiras de uma vez. */
function assinaturas(
  paredes: readonly BookmapWall[],
): readonly string[] {
  return paredes.map(
    (p) => `${p.lado}@${p.preco}/${p.quantidade}ct/${p.distanciaPts}pts`,
  );
}

/** Quantas paredes dos dois grupos saíram como `CANCELADA`. */
function quantasCanceladas(resultado: {
  readonly acima: readonly BookmapWall[];
  readonly abaixo: readonly BookmapWall[];
}): number {
  return [...resultado.acima, ...resultado.abaixo].filter(
    (p) => p.causaRetirada === 'CANCELADA',
  ).length;
}

// ═════════════════════════════════════════════════════════════════════════════
// A máquina de fixture faz o que promete?
// ═════════════════════════════════════════════════════════════════════════════

describe('máquina de fixture: o lastro estabiliza o limiar no piso de 100', () => {
  // Sem esta verificação, todo o resto do arquivo depende de uma suposição do
  // autor sobre onde o percentil cai. Aqui a suposição vira asserção.
  it('deixa o percentil 90 do grid abaixo do piso absoluto', () => {
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 2_442, [0, 1, 2]),
      ...paredeConstante(177_900, 'ASK', 600, [0, 1, 2]),
    ]);

    const p90 = positiveQuantileOfPair(
      grid.bid,
      grid.ask,
      grid.ti.length,
      WALL_QUANTILE,
    );

    expect(p90).toBeLessThanOrEqual(WALL_MIN_QUANTIDADE_ABSOLUTO);
    expect(p90).toBe(LASTRO_CT);
  });

  it('não deixa o lastro de 10 contratos aparecer como parede', () => {
    const grid = montarGrid(paredeConstante(178_100, 'BID', 500, [0, 1, 2]));
    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());

    // O lastro fica abaixo do preço corrente e é avaliado como qualquer preço:
    // se o piso não o barrasse, ele lotaria o grupo de baixo.
    expect(abaixo).toHaveLength(0);
    expect(unica(acima).preco).toBe(178_100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.1 — o que qualifica: 3 baldes consecutivos e o piso de 100
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.1: piso absoluto de 100 contratos', () => {
  it('barra parede de 99 contratos e admite a de exatamente 100', () => {
    // As duas no mesmo grid, à mesma distância do preço corrente em lados opostos
    // do livro, para que a única diferença entre elas seja a quantidade.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', WALL_MIN_QUANTIDADE_ABSOLUTO, [0, 1, 2]),
      ...paredeConstante(178_200, 'BID', WALL_MIN_QUANTIDADE_ABSOLUTO - 1, [0, 1, 2]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());

    // `quantidade < limiar` reprova; `100 < 100` é falso, então 100 passa.
    expect(unica(acima).preco).toBe(178_100);
    expect(unica(acima).quantidade).toBe(WALL_MIN_QUANTIDADE_ABSOLUTO);
  });

  it('não deixa minQuantidade abaixo de 100 rebaixar o piso', () => {
    const grid = montarGrid(paredeConstante(178_100, 'BID', 80, [0, 1, 2]));

    // O parâmetro só consegue ELEVAR o piso. Pedir 1 contrato não libera 80.
    for (const minQuantidade of [0, 1, 50, 80, Number.NaN, -999]) {
      const { acima, abaixo } = detectWalls(
        grid,
        PRECO_ATUAL,
        opcoes({ minQuantidade }),
      );
      expect(acima).toHaveLength(0);
      expect(abaixo).toHaveLength(0);
    }
  });

  it('admite que minQuantidade eleve o piso e reprove parede de 500', () => {
    const grid = montarGrid(paredeConstante(178_100, 'BID', 500, [0, 1, 2]));

    expect(unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima).quantidade).toBe(500);
    expect(
      detectWalls(grid, PRECO_ATUAL, opcoes({ minQuantidade: 501 })).acima,
    ).toHaveLength(0);
  });
});

describe('requisito 6.1: fila precisa persistir em 3 baldes consecutivos', () => {
  it('qualifica com exatamente 3 baldes consecutivos', () => {
    const grid = montarGrid(paredeConstante(178_100, 'BID', 500, [0, 1, 2]));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(WALL_MIN_BALDES_CONSECUTIVOS).toBe(3);
    expect(parede.quantidade).toBe(500);
  });

  it('não qualifica com 2 baldes consecutivos, mesmo com fila enorme', () => {
    // Três células no preço, para passar o guarda de tamanho de grupo e a
    // reprovação vir da REGRA de consecutividade, não da contagem de células: a
    // terceira existe com fila zero naquele lado, o que quebra o trecho.
    const grid = montarGrid([
      { balde: 0, preco: 178_100, bid: 2_442 },
      { balde: 1, preco: 178_100, bid: 2_442 },
      { balde: 2, preco: 178_100, bid: 0, buy: 7 },
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima).toHaveLength(0);
    expect(abaixo).toHaveLength(0);
  });

  it('não costura dois trechos de 2 baldes separados por um vão no eixo', () => {
    // Baldes 0, 1, 3, 4 — o balde 2 existe no eixo (o lastro o preenche) mas não
    // neste preço. Se a consecutividade fosse medida entre células presentes em
    // vez de no eixo de tempo, isto viraria um trecho de 4 e produziria parede.
    const grid = montarGrid(paredeConstante(178_100, 'BID', 2_442, [0, 1, 3, 4]));

    expect(grid.times).toHaveLength(5);
    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima).toHaveLength(0);
    expect(abaixo).toHaveLength(0);
  });

  it('qualifica quando o trecho de 3 vem depois do vão', () => {
    // Mesma forma do caso anterior, com um balde a mais no segundo trecho: prova
    // que o vão não invalida o preço inteiro, só interrompe a contagem.
    const grid = montarGrid(paredeConstante(178_100, 'BID', 2_442, [0, 1, 3, 4, 5]));
    expect(unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima).quantidade).toBe(2_442);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.2 — os dois grupos, o empate no preço corrente e o teto de 4
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.2: separação em acima e abaixo do preço corrente', () => {
  it('separa parede acima e parede abaixo nos grupos corretos', () => {
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(177_900, 'ASK', 600, [0, 1, 2]),
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());

    const emCima = unica(acima);
    expect(emCima.preco).toBe(178_100);
    expect(emCima.lado).toBe('BID');
    expect(emCima.quantidade).toBe(500);
    // Distância é valor absoluto, sempre positivo (requisito 6.3).
    expect(emCima.distanciaPts).toBe(80);

    const embaixo = unica(abaixo);
    expect(embaixo.preco).toBe(177_900);
    expect(embaixo.lado).toBe('ASK');
    expect(embaixo.quantidade).toBe(600);
    expect(embaixo.distanciaPts).toBe(120);
  });

  it('mantém cada grupo estritamente de um lado do preço corrente', () => {
    const grid = montarGrid([
      ...paredeConstante(178_025, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(178_030, 'ASK', 500, [0, 1, 2]),
      ...paredeConstante(178_015, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(178_010, 'ASK', 500, [0, 1, 2]),
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());

    for (const p of acima) expect(p.preco).toBeGreaterThan(PRECO_ATUAL);
    for (const p of abaixo) expect(p.preco).toBeLessThan(PRECO_ATUAL);
    expect(acima).toHaveLength(2);
    expect(abaixo).toHaveLength(2);
  });

  it('deixa a parede exatamente no preço corrente fora dos dois grupos', () => {
    // O critério é "estritamente maior" e "estritamente menor". O preço corrente
    // não é nenhum dos dois, e a parede nele — que pode ser a maior do dia —
    // simplesmente não tem grupo onde caber.
    //
    // Os dois lados do livro no preço corrente vivem na MESMA célula: cada par
    // `(balde, preço)` tem uma única célula, com uma coluna por lado.
    const grid = montarGrid([
      ...paredeDeDoisLados(PRECO_ATUAL, 2_442, 2_442, [0, 1, 2]),
      ...paredeConstante(178_100, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(177_900, 'ASK', 500, [0, 1, 2]),
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());
    const todas = [...acima, ...abaixo];

    // Ninguém no preço corrente, nos dois lados do livro...
    expect(todas.filter((p) => p.preco === PRECO_ATUAL)).toHaveLength(0);
    // ...e as vizinhas continuam presentes, o que prova que a fixture era capaz
    // de produzir parede e o descarte foi do preço, não da fixture.
    expect(unica(acima).preco).toBe(178_100);
    expect(unica(abaixo).preco).toBe(177_900);
    // Distância nunca é zero: o único preço que a produziria foi descartado.
    for (const p of todas) expect(p.distanciaPts).toBeGreaterThan(0);
  });

  it('descarta o preço corrente mesmo quando ele é o único candidato', () => {
    const grid = montarGrid([
      ...paredeConstante(PRECO_ATUAL, 'BID', 2_442, [0, 1, 2, 3]),
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima).toHaveLength(0);
    expect(abaixo).toHaveLength(0);
  });
});

describe('requisito 6.2: teto de 4 paredes por grupo', () => {
  it('entrega as 4 mais próximas de cada grupo e descarta a quinta', () => {
    const grid = montarGrid([
      // Cinco acima, distâncias 5, 10, 15, 20, 25 pontos.
      ...paredeConstante(PRECO_ATUAL + 1 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 2 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 3 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 4 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 5 * TICK, 'BID', 500, [0, 1, 2]),
      // Cinco abaixo, simétricas.
      ...paredeConstante(PRECO_ATUAL - 1 * TICK, 'ASK', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL - 2 * TICK, 'ASK', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL - 3 * TICK, 'ASK', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL - 4 * TICK, 'ASK', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL - 5 * TICK, 'ASK', 500, [0, 1, 2]),
    ]);

    const { acima, abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());

    expect(WALL_MAX_POR_LADO_DEFAULT).toBe(4);
    // O corte é POR GRUPO, não no total: 4 de cada lado, 8 no conjunto.
    expect(acima.map((p) => p.distanciaPts)).toEqual([5, 10, 15, 20]);
    expect(abaixo.map((p) => p.distanciaPts)).toEqual([5, 10, 15, 20]);
  });

  it('respeita maxPorLado menor que o default', () => {
    const grid = montarGrid([
      ...paredeConstante(PRECO_ATUAL + 1 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 2 * TICK, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 3 * TICK, 'BID', 500, [0, 1, 2]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes({ maxPorLado: 2 }));
    expect(acima.map((p) => p.distanciaPts)).toEqual([5, 10]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.4 — os três níveis de desempate da ordenação
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.4: ordenação por distância, quantidade e lado', () => {
  it('ordena por distância crescente, ignorando a quantidade', () => {
    // A mais distante é também a maior. Se a ordenação fosse por tamanho, ela
    // apareceria primeiro — o operador leria a parede longe como a mais urgente.
    const grid = montarGrid([
      ...paredeConstante(PRECO_ATUAL + 20 * TICK, 'BID', 2_442, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 1 * TICK, 'BID', 150, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL + 10 * TICK, 'BID', 800, [0, 1, 2]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima.map((p) => p.distanciaPts)).toEqual([5, 50, 100]);
    expect(acima.map((p) => p.quantidade)).toEqual([150, 800, 2_442]);
  });

  it('empatada a distância, apresenta a maior quantidade primeiro', () => {
    // Distâncias iguais dentro de um grupo só acontecem no MESMO preço, com os
    // dois lados do livro qualificando: a distância determina o preço, e o preço
    // determina o lado do grupo. Aqui a compra é maior.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 600, [0, 1, 2]),
      ...paredeConstante(178_100, 'ASK', 500, [3, 4, 5]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(assinaturas(acima)).toEqual([
      'BID@178100/600ct/80pts',
      'ASK@178100/500ct/80pts',
    ]);
  });

  it('a quantidade tem precedência sobre o lado do livro', () => {
    // Espelho do caso anterior: agora a VENDA é a maior, e ela vem primeiro.
    // Sem esta metade, uma implementação que ordenasse por lado antes de
    // quantidade passaria no teste anterior por acidente.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 500, [0, 1, 2]),
      ...paredeConstante(178_100, 'ASK', 600, [3, 4, 5]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(assinaturas(acima)).toEqual([
      'ASK@178100/600ct/80pts',
      'BID@178100/500ct/80pts',
    ]);
  });

  it('empatadas distância e quantidade, apresenta a compra antes da venda', () => {
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 600, [0, 1, 2]),
      ...paredeConstante(178_100, 'ASK', 600, [3, 4, 5]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima.map((p) => p.lado)).toEqual(['BID', 'ASK']);
  });

  it('aplica a mesma ordenação no grupo de baixo', () => {
    const grid = montarGrid([
      ...paredeConstante(PRECO_ATUAL - 10 * TICK, 'ASK', 2_442, [0, 1, 2]),
      ...paredeConstante(PRECO_ATUAL - 1 * TICK, 'ASK', 150, [0, 1, 2]),
    ]);

    const { abaixo } = detectWalls(grid, PRECO_ATUAL, opcoes());
    // Distância é absoluta, então "crescente" aqui significa subindo em direção
    // ao preço corrente, e não descendo no eixo de preço.
    expect(abaixo.map((p) => p.distanciaPts)).toEqual([5, 50]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.5 — a banda morta de ±15%, nas duas bordas e nos dois sentidos
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.5: histerese de 15% na borda de cima', () => {
  it('classifica como ESTAVEL a variação de exatamente +15%', () => {
    // O requisito exige exceder "em mais de 15%", logo a borda pertence à banda
    // morta. `(230 − 200) / 200 × 100` é exatamente 15 em ponto flutuante.
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 230));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(WALL_HISTERESE_PCT);
    expect(parede.tendencia).toBe('ESTAVEL');
    expect(parede.causaRetirada).toBeNull();
  });

  it('classifica como CRESCENDO a variação logo acima de +15%', () => {
    // O par imediatamente ao lado do anterior. Junto com ele, prova que a
    // comparação é estrita: trocar `>` por `>=` reprovaria o caso de cima, e
    // trocar o sinal reprovaria este.
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 231));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(15.5);
    expect(parede.variacaoPct).toBeGreaterThan(WALL_HISTERESE_PCT);
    expect(parede.tendencia).toBe('CRESCENDO');
    expect(parede.causaRetirada).toBeNull();
  });

  it('classifica como ESTAVEL a variação de +12,5%, no miolo da banda', () => {
    // Aferição de miolo, não de borda: a borda de cima já está afirmada pelo par
    // 15/15,5 acima, e 15 é o caso interno mais próximo que existe.
    //
    // ⚠️ 12,5% e não 14,5%: `(229 − 200) / 200 × 100` dá
    // `14.499999999999998`, porque `0,145` não é representável em binário. Só os
    // pares com divisão exata entram neste arquivo — o `toBe` é intencional e
    // exige escolher os números, não afrouxar a comparação.
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 225));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(12.5);
    expect(parede.tendencia).toBe('ESTAVEL');
  });
});

describe('requisito 6.5: histerese de 15% na borda de baixo', () => {
  it('classifica como ESTAVEL a variação de exatamente −15%', () => {
    // Simétrico da borda de cima: `(170 − 200) / 200 × 100` é exatamente −15, e
    // −15 não é "inferior em mais de 15%".
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 170));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(-WALL_HISTERESE_PCT);
    expect(parede.tendencia).toBe('ESTAVEL');
    // Fora de RETIRANDO a causa é nula, ainda que a fila tenha caído 15%.
    expect(parede.causaRetirada).toBeNull();
  });

  it('classifica como RETIRANDO a variação logo abaixo de −15%', () => {
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 169));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(-15.5);
    expect(parede.variacaoPct).toBeLessThan(-WALL_HISTERESE_PCT);
    expect(parede.tendencia).toBe('RETIRANDO');
    // Sem cobertura declarada não se afirma causa (requisito 6.8).
    expect(parede.causaRetirada).toBe('INDETERMINADA');
  });

  it('classifica como ESTAVEL a variação de −12,5%, no miolo da banda', () => {
    // Simétrico do miolo de cima, e exato pelo mesmo motivo: `−25 / 200` é
    // `−0,125`, uma potência de dois.
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 175));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.variacaoPct).toBe(-12.5);
    expect(parede.tendencia).toBe('ESTAVEL');
    // Fila caindo dentro da banda não é retirada, logo não há causa a afirmar.
    expect(parede.causaRetirada).toBeNull();
  });
});

describe('requisito 6.5: as janelas comparadas são as do mesmo preço e lado', () => {
  it('classifica cada lado do livro pela própria fila, no mesmo preço', () => {
    // No mesmo preço e nos MESMOS baldes, a compra cresce e a venda é retirada.
    // Se a comparação misturasse os lados, os dois rótulos seriam iguais.
    //
    // ⚠️ Os dois lados têm de ocupar a mesma faixa de baldes. As janelas de
    // tendência são as **últimas** células daquele preço, contadas
    // independentemente do lado: pôr a compra nos baldes 0-9 e a venda nos 10-19
    // faria a janela da compra cair sobre células de fila zero, e o rótulo dela
    // sairia `ESTAVEL` por falta de fila recente — não por empate de tendência.
    const grid = montarGrid([
      ...paredeDeDoisLados(178_100, 200, 400, [0, 1, 2, 3, 4]),
      ...paredeDeDoisLados(178_100, 400, 200, [5, 6, 7, 8, 9]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    const compra = exigirLado(acima, 'BID');
    const venda = exigirLado(acima, 'ASK');

    expect(compra.tendencia).toBe('CRESCENDO');
    expect(compra.variacaoPct).toBe(100);
    expect(venda.tendencia).toBe('RETIRANDO');
    expect(venda.variacaoPct).toBe(-50);
  });

  it('toma a quantidade do pico e a tendência das janelas recentes', () => {
    // Os dois campos da parede vêm de escopos diferentes, e esta fixture separa
    // um do outro: a quantidade é o pico do maior trecho qualificado — 500
    // contratos, nos cinco primeiros baldes —, enquanto a tendência compara só as
    // duas últimas janelas, onde a fila de compra já saiu.
    //
    // O resultado é uma parede de 500 contratos rotulada `RETIRANDO`, que é a
    // leitura correta: o compromisso assumido no nível foi de 500 e está sendo
    // desfeito. Uma implementação que tirasse a quantidade da janela recente
    // apresentaria zero e a linha desapareceria do card.
    const grid = montarGrid([
      ...paredeDeDoisLados(178_100, 500, 400, [0, 1, 2, 3, 4]),
      ...paredeDeDoisLados(178_100, 0, 400, [5, 6, 7, 8, 9]),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    const compra = exigirLado(acima, 'BID');

    expect(compra.quantidade).toBe(500);
    expect(compra.tendencia).toBe('RETIRANDO');
    expect(compra.variacaoPct).toBe(-100);

    // A venda no mesmo preço não se move e sai estável — os dois lados do mesmo
    // preço recebem rótulos independentes.
    expect(exigirLado(acima, 'ASK').tendencia).toBe('ESTAVEL');
  });

  it('classifica preços diferentes de forma independente', () => {
    const grid = montarGrid([
      ...paredeComTendencia(178_100, 'BID', 200, 400),
      ...paredeComTendencia(178_200, 'BID', 400, 200),
    ]);

    const { acima } = detectWalls(grid, PRECO_ATUAL, opcoes());
    expect(acima.map((p) => `${p.preco}:${p.tendencia}`)).toEqual([
      '178100:CRESCENDO',
      '178200:RETIRANDO',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.6 — amostra insuficiente e janela anterior nula
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.6: amostra insuficiente devolve ESTAVEL', () => {
  it('devolve ESTAVEL com 9 baldes, um a menos que o mínimo de 10', () => {
    // A forma da fila é a mesma que produz CRESCENDO com 10 baldes — quatro
    // baldes em 200 seguidos de cinco em 400. Com 9 baldes não há o que comparar,
    // e o núcleo se recusa a inventar tendência.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 200, [0, 1, 2, 3]),
      ...paredeConstante(178_100, 'BID', 400, [4, 5, 6, 7, 8]),
    ]);

    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(2 * WALL_BALDES_TENDENCIA_DEFAULT).toBe(10);
    expect(parede.tendencia).toBe('ESTAVEL');
    // `variacaoPct` zero é o que distingue "não houve comparação" de "houve e
    // ficou na banda morta" — este é o primeiro caso.
    expect(parede.variacaoPct).toBe(0);
    expect(parede.causaRetirada).toBeNull();
    // A parede em si qualificou: o que faltou foi amostra de tendência.
    expect(parede.quantidade).toBe(400);
  });

  it('compara de verdade a partir de 10 baldes', () => {
    // Um balde a mais que o caso anterior, mesma forma: agora as duas janelas
    // existem e o rótulo aparece. É a borda do mínimo de amostra.
    const grid = montarGrid(paredeComTendencia(178_100, 'BID', 200, 400));
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.tendencia).toBe('CRESCENDO');
    expect(parede.variacaoPct).toBe(100);
  });

  it('devolve ESTAVEL com 3 baldes, o mínimo para qualificar como parede', () => {
    // Qualificar como parede e ter tendência mensurável são exigências
    // diferentes: 3 baldes bastam para a primeira e não para a segunda.
    const parede = unica(
      detectWalls(
        montarGrid(paredeConstante(178_100, 'BID', 500, [0, 1, 2])),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );

    expect(parede.tendencia).toBe('ESTAVEL');
    expect(parede.variacaoPct).toBe(0);
  });

  it('acompanha baldesTendencia ao decidir o que é amostra suficiente', () => {
    // Com janela de 3, seis baldes já bastam — e o mesmo grid que dá ESTAVEL na
    // janela default passa a ter rótulo. Prova que o mínimo é `2 × janela`, e não
    // o número 10 escrito em algum lugar.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 200, [0, 1, 2]),
      ...paredeConstante(178_100, 'BID', 400, [3, 4, 5]),
    ]);

    expect(unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima).tendencia).toBe(
      'ESTAVEL',
    );
    expect(
      unica(
        detectWalls(grid, PRECO_ATUAL, opcoes({ baldesTendencia: 3 })).acima,
      ).tendencia,
    ).toBe('CRESCENDO');
  });
});

describe('requisito 6.6: janela anterior nula', () => {
  it('classifica como CRESCENDO quando a janela recente é positiva', () => {
    // Os cinco baldes antigos existem no preço — a fila do OUTRO lado os mantém —
    // mas a fila de compra ali é zero. Crescer a partir de zero não tem razão
    // finita, então o campo carrega o sentinela e o que informa é o rótulo.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'ASK', 60, [0, 1, 2, 3, 4]),
      ...paredeConstante(178_100, 'BID', 400, [5, 6, 7, 8, 9]),
    ]);

    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.lado).toBe('BID');
    expect(parede.tendencia).toBe('CRESCENDO');
    expect(parede.variacaoPct).toBe(WALL_VARIACAO_PCT_SEM_BASE);
    expect(Number.isFinite(parede.variacaoPct)).toBe(true);
    expect(parede.causaRetirada).toBeNull();
    // A venda de 60 contratos fica abaixo do piso e não qualifica — é só o que
    // faz as células dos cinco primeiros baldes existirem.
    expect(doLado([parede], 'ASK')).toBeUndefined();
  });

  it('classifica como ESTAVEL quando as duas janelas são nulas', () => {
    // A parede existiu na manhã e o livro abandonou o nível. As dez últimas
    // células têm fila de compra zero nos dois lados da comparação, então não há
    // tendência a afirmar — mas a parede continua listada com o pico histórico,
    // que é a leitura que o card faz do nível.
    const grid = montarGrid([
      ...paredeConstante(178_100, 'BID', 500, [0, 1, 2, 3, 4]),
      ...paredeConstante(178_100, 'ASK', 50, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    ]);

    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.lado).toBe('BID');
    expect(parede.quantidade).toBe(500);
    expect(parede.tendencia).toBe('ESTAVEL');
    expect(parede.variacaoPct).toBe(0);
    expect(parede.causaRetirada).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.7 — ABSORVIDA contra CANCELADA, na fronteira dos 50%
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cenário comum do bloco de causa: a fila cai de 200 para 100 por balde, o que dá
 * −50% e classifica como `RETIRANDO`, com **redução de 100 contratos** entre as
 * médias. A fronteira da absorção fica então em `100 × 0,5 = 50` contratos
 * executados no preço, ao longo dos dez baldes avaliados.
 *
 * Os três números que interessam — 200, 100 e 50 — são exatos em binário, então a
 * comparação na fronteira é uma igualdade de verdade, não um empate aproximado.
 */
function gridComRetirada(
  execPorBalde: readonly number[],
  cobertura: CoberturaHeatmap | null,
): BookmapGrid {
  return montarGrid(
    paredeComTendencia(178_100, 'BID', 200, 100, { execPorBalde }),
    cobertura,
  );
}

/** Cobertura que abrange exatamente os dez baldes avaliados: `[0, 10)`. */
function coberturaCompleta(): CoberturaHeatmap {
  return coberturaExec('COMPLETA', ts(0), ts(9) + BALDE_MS);
}

/** Execução somando `total` contratos, distribuída nos dez baldes avaliados. */
function execSomando(total: number): readonly number[] {
  const por = Math.floor(total / 10);
  const resto = total - por * 10;
  const out = new Array<number>(10).fill(por);
  out[0] = por + resto;
  return out;
}

describe('requisito 6.7: causa da retirada na fronteira dos 50%', () => {
  it('a fixture produz a retirada de 100 contratos que ancora a fronteira', () => {
    // Sem esta verificação, os três casos seguintes dependeriam de uma conta
    // feita de cabeça sobre qual é a redução — e a fronteira sairia do lugar sem
    // ninguém notar.
    const parede = unica(
      detectWalls(
        gridComRetirada(execSomando(50), coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );

    expect(parede.tendencia).toBe('RETIRANDO');
    expect(parede.variacaoPct).toBe(-50);
    expect(WALL_ABSORCAO_MIN_RATIO).toBe(0.5);
    // Redução de 100 contratos entre as médias ⇒ fronteira em 50 executados.
    expect(100 * WALL_ABSORCAO_MIN_RATIO).toBe(50);
  });

  it('indica ABSORVIDA com execução de exatamente 50% da redução', () => {
    // A fronteira é inclusiva: "50% ou mais".
    const parede = unica(
      detectWalls(
        gridComRetirada(execSomando(50), coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    expect(parede.causaRetirada).toBe('ABSORVIDA');
  });

  it('indica CANCELADA com execução um contrato abaixo da fronteira', () => {
    const parede = unica(
      detectWalls(
        gridComRetirada(execSomando(49), coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    expect(parede.causaRetirada).toBe('CANCELADA');
  });

  it('indica ABSORVIDA com execução um contrato acima da fronteira', () => {
    const parede = unica(
      detectWalls(
        gridComRetirada(execSomando(51), coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    expect(parede.causaRetirada).toBe('ABSORVIDA');
  });

  it('indica CANCELADA quando não houve execução alguma no preço', () => {
    // A fila saiu do livro sem um negócio: a oferta nunca pretendeu ser
    // negociada. É a leitura oposta da absorvida, e depende de haver cobertura.
    const parede = unica(
      detectWalls(
        gridComRetirada(execSomando(0), coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    expect(parede.causaRetirada).toBe('CANCELADA');
  });

  it('soma os dois agressores na execução do preço', () => {
    // Metade da fronteira em cada coluna de execução: 25 do agressor comprador e
    // 25 do vendedor somam os 50 exigidos. Uma implementação que olhasse só uma
    // das colunas concluiria cancelamento.
    const celulas = paredeComTendencia(178_100, 'BID', 200, 100).map((c, i) =>
      i === 0 ? { ...c, buy: 25, sell: 25 } : c,
    );
    const parede = unica(
      detectWalls(
        montarGrid(celulas, coberturaCompleta()),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    expect(parede.causaRetirada).toBe('ABSORVIDA');
  });

  it('ignora execução ocorrida em outro preço', () => {
    // Execução farta num preço vizinho não explica a fila que saiu deste. Contar
    // o pregão inteiro faria toda retirada parecer absorção.
    const celulas: Celula[] = [
      ...paredeComTendencia(178_100, 'BID', 200, 100),
      ...paredeConstante(178_200, 'ASK', 50, [0, 1, 2]).map((c) => ({
        ...c,
        buy: 5_000,
      })),
    ];
    const parede = exigirLado(
      detectWalls(montarGrid(celulas, coberturaCompleta()), PRECO_ATUAL, opcoes())
        .acima,
      'BID',
    );

    expect(parede.preco).toBe(178_100);
    expect(parede.causaRetirada).toBe('CANCELADA');
  });

  it('classifica com cobertura EXEC_PARCIAL que ainda abrange as janelas', () => {
    // O estado normal do dado é `EXEC_PARCIAL`, e ele NÃO impede a classificação:
    // o que importa é a execução alcançar o intervalo avaliado. Aqui as dez
    // células ficam na manhã, dentro da captura, e a fila segue até a tarde — o
    // nível que o livro abandonou cedo porque o mercado se afastou.
    const grid = montarGrid(
      paredeComTendencia(178_100, 'BID', 200, 100, { execPorBalde: execSomando(0) }),
      coberturaExec('EXEC_PARCIAL', ts(0), ts(9) + BALDE_MS, ts(9) + BALDE_MS),
    );
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.causaRetirada).toBe('CANCELADA');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Requisito 6.8 — INDETERMINADA, e a contagem de CANCELADA em zero
// ═════════════════════════════════════════════════════════════════════════════

describe('requisito 6.8: sem cobertura do intervalo, a causa é INDETERMINADA', () => {
  /**
   * A execução destas fixtures soma 50 contratos — o suficiente para dar
   * `ABSORVIDA` **se** houvesse cobertura. Assim a resposta `INDETERMINADA` vem
   * da cobertura e não da falta de execução, que seria uma explicação alternativa
   * para o mesmo resultado.
   */
  function paredeSemCobertura(cobertura: CoberturaHeatmap | null): BookmapWall {
    return unica(
      detectWalls(gridComRetirada(execSomando(50), cobertura), PRECO_ATUAL, opcoes())
        .acima,
    );
  }

  it('devolve INDETERMINADA quando a cobertura é ausente', () => {
    const parede = paredeSemCobertura(null);
    expect(parede.tendencia).toBe('RETIRANDO');
    expect(parede.causaRetirada).toBe('INDETERMINADA');
  });

  it('devolve INDETERMINADA com a execução terminando um milissegundo antes', () => {
    // A borda estrita de "abranger integralmente": o intervalo termina no FIM do
    // último balde, não no início dele. Um milissegundo a menos não cobre.
    const parede = paredeSemCobertura(
      coberturaExec('EXEC_PARCIAL', ts(0), ts(9) + BALDE_MS - 1),
    );
    expect(parede.causaRetirada).toBe('INDETERMINADA');
  });

  it('classifica com a execução terminando exatamente no fim do último balde', () => {
    // O outro lado da mesma borda, um milissegundo adiante: agora cobre, e a
    // causa é afirmada. O par prova que o limite é o fim do balde.
    const parede = paredeSemCobertura(
      coberturaExec('EXEC_PARCIAL', ts(0), ts(9) + BALDE_MS),
    );
    expect(parede.causaRetirada).toBe('ABSORVIDA');
  });

  it('devolve INDETERMINADA quando a execução começa depois do intervalo', () => {
    // Cobrir o fim não basta: a janela anterior também precisa estar dentro.
    const parede = paredeSemCobertura(
      coberturaExec('EXEC_PARCIAL', ts(0) + 1, ts(9) + BALDE_MS),
    );
    expect(parede.causaRetirada).toBe('INDETERMINADA');
  });

  it('devolve INDETERMINADA quando a execução para horas antes da fila', () => {
    // A forma real dos 5 pregões materializados: a fila segue até o fechamento e
    // a execução para no meio do dia. A parede avaliada vive no trecho tardio,
    // depois do fim da captura — que é o caminho predominante, não a exceção.
    const grid = montarGrid(
      paredeComTendencia(178_100, 'BID', 200, 100, {
        baldeInicial: 30,
        execPorBalde: execSomando(50),
      }),
      coberturaExec('EXEC_PARCIAL', ts(0), ts(20) + BALDE_MS, ts(39) + BALDE_MS),
    );
    const parede = unica(detectWalls(grid, PRECO_ATUAL, opcoes()).acima);

    expect(parede.tendencia).toBe('RETIRANDO');
    expect(parede.causaRetirada).toBe('INDETERMINADA');
  });

  it('devolve INDETERMINADA nas classes que não têm execução alguma', () => {
    // `FILA_SEM_EXEC` e `VAZIA` não têm execução capturada, e limites largos não
    // mudam isso: sem execução não há o que abranger. Um teste que olhasse só os
    // limites numéricos deixaria passar a afirmação de causa nessas classes.
    for (const classe of ['FILA_SEM_EXEC', 'VAZIA'] as const) {
      const parede = paredeSemCobertura(
        coberturaExec(classe, ts(0) - BALDE_MS, ts(64)),
      );
      expect(parede.causaRetirada).toBe('INDETERMINADA');
    }
  });

  it('devolve INDETERMINADA com limites de execução ausentes ou invertidos', () => {
    const semDe = coberturaExec('COMPLETA', null, ts(9) + BALDE_MS);
    const semAte = coberturaExec('COMPLETA', ts(0), null);
    const invertida = coberturaExec('COMPLETA', ts(9) + BALDE_MS, ts(0));

    for (const cobertura of [semDe, semAte, invertida]) {
      expect(paredeSemCobertura(cobertura).causaRetirada).toBe('INDETERMINADA');
    }
  });

  it('mantém em zero a contagem de CANCELADA em todos os casos sem cobertura', () => {
    // A exigência do requisito não é só o rótulo da parede avaliada: é que
    // NENHUMA parede saia como cancelada quando a cobertura não permite afirmar.
    // Aqui a execução é ZERO, que é o insumo que produziria `CANCELADA` se a
    // cobertura fosse ignorada.
    const semCobertura: readonly (CoberturaHeatmap | null)[] = [
      null,
      coberturaExec('EXEC_PARCIAL', ts(0), ts(9) + BALDE_MS - 1),
      coberturaExec('EXEC_PARCIAL', ts(0) + 1, ts(9) + BALDE_MS),
      coberturaExec('FILA_SEM_EXEC', ts(0), ts(64)),
      coberturaExec('VAZIA', ts(0), ts(64)),
      coberturaExec('COMPLETA', null, null),
    ];

    for (const cobertura of semCobertura) {
      const resultado = detectWalls(
        gridComRetirada(execSomando(0), cobertura),
        PRECO_ATUAL,
        opcoes(),
      );

      expect(unica(resultado.acima).tendencia).toBe('RETIRANDO');
      expect(quantasCanceladas(resultado)).toBe(0);
    }
  });

  it('mantém em zero a contagem de CANCELADA com várias paredes retirando', () => {
    // Quatro paredes sendo retiradas ao mesmo tempo, execução zero, cobertura
    // ausente: o card não pode apresentar nenhuma como cancelada.
    const grid = montarGrid(
      [
        ...paredeComTendencia(PRECO_ATUAL + 1 * TICK, 'BID', 200, 100),
        ...paredeComTendencia(PRECO_ATUAL + 2 * TICK, 'BID', 400, 100),
        ...paredeComTendencia(PRECO_ATUAL - 1 * TICK, 'ASK', 200, 100),
        ...paredeComTendencia(PRECO_ATUAL - 2 * TICK, 'ASK', 400, 100),
      ],
      null,
    );

    const resultado = detectWalls(grid, PRECO_ATUAL, opcoes());
    const todas = [...resultado.acima, ...resultado.abaixo];

    expect(todas).toHaveLength(4);
    for (const p of todas) {
      expect(p.tendencia).toBe('RETIRANDO');
      expect(p.causaRetirada).toBe('INDETERMINADA');
    }
    expect(quantasCanceladas(resultado)).toBe(0);
  });

  it('não preenche causa fora de RETIRANDO, mesmo com cobertura completa', () => {
    // A causa é campo de parede retirada. Preenchê-la em parede estável ou
    // crescendo daria ao card uma explicação para algo que não aconteceu.
    const cobertura = coberturaCompleta();
    const crescendo = unica(
      detectWalls(
        montarGrid(paredeComTendencia(178_100, 'BID', 200, 400), cobertura),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );
    const estavel = unica(
      detectWalls(
        montarGrid(paredeComTendencia(178_100, 'BID', 200, 200), cobertura),
        PRECO_ATUAL,
        opcoes(),
      ).acima,
    );

    expect(crescendo.tendencia).toBe('CRESCENDO');
    expect(crescendo.causaRetirada).toBeNull();
    expect(estavel.tendencia).toBe('ESTAVEL');
    expect(estavel.causaRetirada).toBeNull();
  });
});
