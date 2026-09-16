/**
 * Detecção de paredes de liquidez — spec `bookmap-no-mapa-de-decisao`, tarefa
 * 4.1. Requisitos 6.1, 6.4, 6.5, 6.6, 6.7, 6.8, 6.12.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uma função pura: dado o grid decodificado e o preço corrente, devolve as
 * maiores concentrações de fila em repouso acima e abaixo desse preço, com a
 * distância em pontos, a tendência e, quando a fila está saindo, a causa.
 *
 * Sem DOM, sem relógio, sem sorteio, sem I/O e **sem estado de módulo** — as
 * únicas ligações no escopo do arquivo são constantes numéricas imutáveis. Toda
 * repetição da mesma combinação de grid, preço corrente e parâmetros devolve
 * resultado estruturalmente igual (requisito 6.12). O preço corrente entra por
 * parâmetro; nada aqui o descobre por conta própria.
 *
 * Em tempo de execução importa **um único módulo**, `bookmap-color.core`, cujo
 * fechamento transitivo é vazio (a única importação dele é de tipo, apagada na
 * compilação). Logo este arquivo é estruturalmente incapaz de alcançar serviço
 * de roteamento de bridge, de feed de tick, de execução de ordem, ou módulo de
 * conector do terminal, e não carrega endereço de rede, identificador de conta,
 * credencial nem estado de posição (requisito 12.1).
 *
 * Todo insumo chega no `BookmapGrid`, que vem de API. Nenhum dado é lido do
 * sistema de arquivos, em CSV ou em qualquer outro formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE QUALIFICA UMA PAREDE, E POR QUÊ CADA PARTE DO CRITÉRIO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Três condições simultâneas (requisito 6.1), no mesmo preço e no mesmo lado:
 *
 * 1. **Fila em repouso em 3 ou mais baldes consecutivos.** Persistência é o que
 *    separa parede de pico instantâneo. Uma oferta grande que aparece num balde
 *    e sai no seguinte não defendeu nada — foi tinta no livro.
 * 2. **Quantidade máxima no percentil 90 das células de fila não nula do grid.**
 *    Limiar relativo, porque "grande" depende do dia: exigir um número fixo
 *    listaria tudo num dia líquido e nada num dia magro.
 * 3. **Piso absoluto de 100 contratos.** É a proteção contra o dia raso, em que
 *    o percentil 90 poderia cair para dezenas de contratos e a lista se enche de
 *    ruído com aparência de estrutura.
 *
 * ⚠️ **"Consecutivos" é no eixo de tempo, não entre células presentes.** Célula
 * ausente significa quatro valores em zero, ou seja fila zero: um vão no eixo
 * quebra o trecho. Contar apenas as células presentes costuraria dois picos
 * separados por dez minutos de livro vazio e chamaria isso de parede persistente.
 * Célula presente com fila zero naquele lado (existe por causa da execução)
 * também quebra o trecho, pelo mesmo motivo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O LIMIAR É DO GRID INTEIRO, E NÃO DA JANELA VISÍVEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `computeColorScale` mede a janela visível de propósito: a cor tem de responder
 * ao que o operador está olhando. O limiar de parede faz o oposto e mede o grid
 * inteiro, porque uma parede não deixa de ser parede quando o operador dá zoom.
 * Limiar dependente do zoom faria a lista do card entrar e sair sem o dado
 * mudar — e é justamente a lista que o operador usa para decidir.
 *
 * O percentil sai de `positiveQuantileOfPair`, o mesmo seletor O(n) da escala de
 * cor, em vez de um segundo seletor escrito aqui. Duas implementações do mesmo
 * percentil ficariam livres para divergir, e a divergência apareceria como
 * parede desenhada com uma intensidade e listada com outro critério.
 *
 * ⚠️ **Consequência do limiar relativo, contraintuitiva mas correta: uma parede
 * muito grande eleva a barra para todas as outras.** O percentil é da amostra,
 * então acrescentar massa no topo empurra o corte para cima. No extremo, uma
 * amostra com apenas duas quantidades distintas em proporções parecidas tem o
 * p90 sempre na maior delas, e a menor não qualifica.
 *
 * Isso é o comportamento desejado — "grande" é relativo ao dia —, e no dado real
 * não incomoda porque 97,1% das células ficam no miolo e servem de massa de
 * referência. Mas fixture pequena com duas paredes e nada em volta produz uma só,
 * e quem escrever os testes da tarefa 4.5 precisa de enchimento abaixo das duas
 * para exercitar o desempate por quantidade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE HISTERESE DE 15%, E NÃO COMPARAÇÃO ESTRITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A informação que decide não é o tamanho da parede, é a **transição**: uma
 * parede que persiste e absorve é suporte; a mesma parede cancelada 30 s antes
 * do toque é o oposto.
 *
 * Com comparação estrita (`recente > anterior` ⇒ crescendo), uma variação de 1%
 * — que é ruído de agregação — alternaria o rótulo entre `CRESCENDO` e
 * `RETIRANDO` de balde em balde. O operador veria a etiqueta piscar e deixaria
 * de confiar nela, o que é pior que não ter etiqueta. A banda morta de ±15%
 * (requisito 6.5) é o que faz o rótulo mudar só quando há mudança de verdade.
 *
 * As duas bordas pertencem à banda morta: exatamente `+15%` e exatamente `−15%`
 * são `ESTAVEL`, porque o requisito exige exceder "em mais de 15%".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `INDETERMINADA` NÃO É `CANCELADA` — a distinção mais importante do arquivo
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Retirada e absorção são leituras **opostas**. Fila que desaparece *com*
 * execução foi consumida — sinal de força de quem absorveu. Fila que desaparece
 * *sem* execução foi cancelada — armadilha se desfazendo. Trocar uma pela outra
 * inverte a conclusão do operador.
 *
 * Por isso a causa só é afirmada quando a captura de execução abrange
 * **integralmente** o intervalo das duas janelas de tendência avaliadas. Fora
 * disso, `INDETERMINADA` (requisito 6.8) — não se afirma cancelamento a partir de
 * ausência de dado.
 *
 * ⚠️ **Na prática este é o caminho predominante, não a exceção.** Os 5 pregões
 * materializados são todos `EXEC_PARCIAL`: a fila vai até 18:29 e a execução para
 * ~6 h antes, em 12:31. Toda parede cujas janelas de tendência caiam depois do
 * fim da execução capturada — o que inclui todo preço observado até o fim do
 * pregão, porque as janelas são as **últimas** com dado — sai daqui como
 * `INDETERMINADA`.
 *
 * ⚠️ E `CANCELADA` **não é inalcançável** nesse dado: um preço cujos últimos dez
 * baldes com dado caiam inteiramente antes de 12:31 — preço que o livro
 * abandonou na manhã porque o mercado se afastou — tem cobertura e é
 * classificado. Codificar "nunca `CANCELADA`" contradiria o requisito 6.7, que
 * manda classificar quando há cobertura. O que se garante é o condicional: sem
 * cobertura, nunca `CANCELADA`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPLEXIDADE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O(n) na contagem de células, mais O(n) do percentil, mais O(c log c) na
 * ordenação final, com `c` limitado ao número de paredes candidatas (no máximo
 * duas por preço). Nenhuma passada é quadrática e nenhuma é O(preços × baldes).
 *
 * O agrupamento por preço com as células em ordem de tempo sai de **duas
 * ordenações por contagem** encadeadas — por balde e, estavelmente, por preço.
 * Estabilidade é o que preserva a ordem de tempo dentro de cada preço, e é o que
 * torna o resultado independente da ordem em que as células chegaram no payload:
 * `decodeColumnar` preserva a ordem recebida e **não promete ordenação alguma**,
 * então depender dela seria depender do humor do codificador do backend.
 *
 * Chamada na montagem do card, nunca por quadro de desenho.
 *
 * Convenções: identificadores em inglês, comentários em pt-BR.
 */

import type {
  BookmapGrid,
  BookmapWall,
  CausaRetirada,
  CoberturaHeatmap,
} from './bookmap-types.js';
import { positiveQuantileOfPair } from './bookmap-color.core.js';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes do critério
// ═════════════════════════════════════════════════════════════════════════════

/** Quantil que define o limiar de quantidade (requisito 6.1). */
export const WALL_QUANTILE = 0.9;

/** Baldes consecutivos mínimos com fila em repouso (requisito 6.1). */
export const WALL_MIN_BALDES_CONSECUTIVOS = 3;

/**
 * Piso **absoluto** de quantidade, em contratos (requisito 6.1).
 *
 * "Absoluto" é literal: `opts.minQuantidade` só consegue **elevar** este piso,
 * nunca baixá-lo. Nenhuma parede abaixo de 100 contratos é qualificada, em
 * nenhuma configuração.
 *
 * ⚠️ Consequência para quem escrever os testes da tarefa 4.5: fixture com fila
 * de dezenas de contratos não produz parede alguma. O dado real tem `p50` de 481
 * contratos, então quantidades de três dígitos são o realismo, não a exceção.
 */
export const WALL_MIN_QUANTIDADE_ABSOLUTO = 100;

/** Baldes por janela de tendência (requisito 6.5). */
export const WALL_BALDES_TENDENCIA_DEFAULT = 5;

/** Paredes por grupo (requisito 6.2). */
export const WALL_MAX_POR_LADO_DEFAULT = 4;

/** Banda morta do rótulo de tendência, em pontos percentuais (requisito 6.5). */
export const WALL_HISTERESE_PCT = 15;

/** Fração da redução de fila que a execução precisa cobrir (requisito 6.7). */
export const WALL_ABSORCAO_MIN_RATIO = 0.5;

/**
 * Sentinela de `variacaoPct` quando a janela anterior é nula.
 *
 * Crescer a partir de zero não tem razão finita, e o campo não pode carregar
 * `Infinity` — a interface renderizaria literalmente. O rótulo `CRESCENDO` é o
 * que informa; este número existe só para manter o campo finito e ordenável.
 */
export const WALL_VARIACAO_PCT_SEM_BASE = 1000;

/** Teto de `baldesTendencia`, para parâmetro corrompido não virar laço absurdo. */
const BALDES_TENDENCIA_MAX = 500;

/** Teto de `maxPorLado`. Acima disso o card não teria como apresentar. */
const MAX_POR_LADO_MAX = 64;

// ═════════════════════════════════════════════════════════════════════════════
// Contrato público
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parâmetros de qualificação e de tendência. Shape idêntico ao `opts` do design.
 *
 * Todo campo não finito ou fora de faixa cai no default correspondente, em vez
 * de propagar valor inválido — o requisito 6.12 pede resultado estruturalmente
 * igual para a mesma entrada, e isso vale também para entrada malformada.
 */
export interface DetectWallsOptions {
  /** Baldes por janela de tendência. Default 5. */
  readonly baldesTendencia: number;
  /** Máximo de paredes por grupo. Default 4. */
  readonly maxPorLado: number;
  /** Piso de quantidade. Nunca abaixo de `WALL_MIN_QUANTIDADE_ABSOLUTO`. */
  readonly minQuantidade: number;
}

/**
 * Os dois grupos do card. `acima` só contém preço estritamente maior que o
 * corrente; `abaixo`, estritamente menor. Preço exatamente igual ao corrente não
 * entra em nenhum dos dois (requisito 6.2).
 */
export interface DetectedWalls {
  readonly acima: BookmapWall[];
  readonly abaixo: BookmapWall[];
}

// ═════════════════════════════════════════════════════════════════════════════
// Saneamento de entrada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Os três sanitizadores admitem `undefined` no tipo, e não por descuido: o
 * `opts` é obrigatório na assinatura, mas a chamada real vem de configuração
 * persistida em `localStorage`, que o compilador não valida. Aceitar
 * `number | undefined` aqui é o que permite ler `opts?.campo` sem asserção de
 * tipo — asserção diria ao compilador que o valor existe justamente no caso em
 * que ele pode não existir.
 */
function sanitizeBaldesTendencia(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw < 1) {
    return WALL_BALDES_TENDENCIA_DEFAULT;
  }
  const truncated = Math.floor(raw);
  return truncated > BALDES_TENDENCIA_MAX ? BALDES_TENDENCIA_MAX : truncated;
}

function sanitizeMaxPorLado(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) {
    return WALL_MAX_POR_LADO_DEFAULT;
  }
  const truncated = Math.floor(raw);
  return truncated > MAX_POR_LADO_MAX ? MAX_POR_LADO_MAX : truncated;
}

/** O piso é absoluto: o parâmetro só eleva. */
function sanitizeMinQuantidade(raw: number | undefined): number {
  if (
    raw === undefined ||
    !Number.isFinite(raw) ||
    raw < WALL_MIN_QUANTIDADE_ABSOLUTO
  ) {
    return WALL_MIN_QUANTIDADE_ABSOLUTO;
  }
  return raw;
}

/** Valor de célula usável: finito e não negativo. Fila negativa não existe. */
function readQuantity(values: Float32Array, k: number): number {
  const v = values[k] ?? 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Quantas células o grid realmente tem.
 *
 * O invariante de `BookmapGrid` promete comprimento igual nas seis colunas e
 * `decodeColumnar` o garante, mas grid montado à mão (é o que os testes fazem)
 * pode divergir. O mínimo é o único corte que nunca lê fora de nenhuma coluna.
 */
function cellCount(grid: BookmapGrid): number {
  let n = grid.ti.length;
  const lens = [
    grid.pi.length,
    grid.bid.length,
    grid.ask.length,
    grid.buy.length,
    grid.sell.length,
  ];
  for (const len of lens) if (len < n) n = len;
  return n;
}

/** Duração do balde em ms. `0` quando o grid não informa duração utilizável. */
function bucketDurationMs(baldeSeg: number): number {
  return Number.isFinite(baldeSeg) && baldeSeg > 0 ? baldeSeg * 1000 : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Agrupamento — células por preço, em ordem de tempo
// ═════════════════════════════════════════════════════════════════════════════

interface PriceGroups {
  /** Índices de célula, agrupados por preço e ordenados por balde dentro do grupo. */
  readonly order: Uint32Array;
  /** `start[p]` até `start[p + 1]` delimita o grupo do preço `p`. */
  readonly start: Uint32Array;
}

/**
 * Agrupa as células por índice de preço, mantendo cada grupo em ordem crescente
 * de balde, por duas ordenações por contagem encadeadas.
 *
 * A segunda é **estável**, e é a estabilidade que preserva a ordem de tempo
 * imposta pela primeira. Sem ela o grupo de um preço sairia em ordem arbitrária
 * e a detecção de baldes consecutivos leria vãos onde não há.
 *
 * Célula com índice fora do eixo é **descartada**, não fatal: o invariante 2 do
 * `BookmapGrid` a proíbe e `decodeColumnar` rejeita o payload inteiro nesse
 * caso, mas grid montado à mão pode trazê-la, e descartar a célula é preferível
 * a escrever fora dos vetores de contagem.
 */
function groupByPriceThenTime(grid: BookmapGrid, n: number): PriceGroups {
  const nT = grid.times.length;
  const nP = grid.prices.length;

  // ── Passada 1: coleta as células válidas e conta por balde ────────────────
  const valid = new Uint32Array(n);
  const cursorT = new Uint32Array(nT + 1);
  let nv = 0;

  for (let k = 0; k < n; k += 1) {
    const t = grid.ti[k] ?? -1;
    const p = grid.pi[k] ?? -1;
    if (t < 0 || t >= nT || p < 0 || p >= nP) continue;
    valid[nv] = k;
    nv += 1;
    cursorT[t + 1] = (cursorT[t + 1] ?? 0) + 1;
  }

  // ── Passada 2: soma de prefixos vira deslocamento inicial de cada balde ───
  for (let t = 0; t < nT; t += 1) {
    cursorT[t + 1] = (cursorT[t + 1] ?? 0) + (cursorT[t] ?? 0);
  }

  // ── Passada 3: espalha em ordem de balde ──────────────────────────────────
  const byTime = new Uint32Array(nv);
  for (let i = 0; i < nv; i += 1) {
    const k = valid[i] ?? 0;
    const t = grid.ti[k] ?? 0;
    const pos = cursorT[t] ?? 0;
    byTime[pos] = k;
    cursorT[t] = pos + 1;
  }

  // ── Passada 4: conta por preço e monta os limites de grupo ────────────────
  const start = new Uint32Array(nP + 1);
  for (let i = 0; i < nv; i += 1) {
    const k = byTime[i] ?? 0;
    const p = grid.pi[k] ?? 0;
    start[p + 1] = (start[p + 1] ?? 0) + 1;
  }
  for (let p = 0; p < nP; p += 1) {
    start[p + 1] = (start[p + 1] ?? 0) + (start[p] ?? 0);
  }

  // ── Passada 5: espalha por preço, estável, lendo em ordem de balde ────────
  const cursorP = start.slice();
  const order = new Uint32Array(nv);
  for (let i = 0; i < nv; i += 1) {
    const k = byTime[i] ?? 0;
    const p = grid.pi[k] ?? 0;
    const pos = cursorP[p] ?? 0;
    order[pos] = k;
    cursorP[p] = pos + 1;
  }

  return { order, start };
}

// ═════════════════════════════════════════════════════════════════════════════
// Qualificação — trecho consecutivo de fila em repouso
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Maior quantidade observada em algum trecho de **`minRun` baldes consecutivos
 * ou mais** com fila em repouso, dentro do grupo `[lo, hi)` de um preço.
 *
 * Devolve `0` quando nenhum trecho alcança o comprimento mínimo — e `0` nunca
 * qualifica, porque o limiar tem piso de 100 contratos.
 *
 * Consecutividade é medida no eixo de tempo (`ti` avançando de exatamente 1),
 * não na sequência de células presentes: ver o cabeçalho do arquivo.
 *
 * Quando o mesmo preço apresenta mais de um trecho qualificado ao longo do dia,
 * prevalece a **maior** quantidade entre eles. O card mostra uma linha por preço
 * e por lado, e a linha que interessa é a do maior compromisso já assumido
 * naquele nível.
 */
function bestRunQuantity(
  grid: BookmapGrid,
  order: Uint32Array,
  lo: number,
  hi: number,
  values: Float32Array,
  minRun: number,
): number {
  let best = 0;
  let runLen = 0;
  let runMax = 0;
  let prevTi = -2;

  for (let i = lo; i < hi; i += 1) {
    const k = order[i] ?? 0;
    const t = grid.ti[k] ?? 0;
    const v = readQuantity(values, k);

    if (v > 0) {
      if (runLen > 0 && t === prevTi + 1) {
        runLen += 1;
        if (v > runMax) runMax = v;
      } else {
        runLen = 1;
        runMax = v;
      }
      if (runLen >= minRun && runMax > best) best = runMax;
    } else {
      runLen = 0;
      runMax = 0;
    }

    prevTi = t;
  }

  return best;
}

// ═════════════════════════════════════════════════════════════════════════════
// Tendência e causa da retirada
// ═════════════════════════════════════════════════════════════════════════════

interface TrendVerdict {
  readonly tendencia: 'CRESCENDO' | 'ESTAVEL' | 'RETIRANDO';
  readonly variacaoPct: number;
  readonly causaRetirada: CausaRetirada | null;
}

const ESTAVEL_SEM_AMOSTRA: TrendVerdict = {
  tendencia: 'ESTAVEL',
  variacaoPct: 0,
  causaRetirada: null,
};

/**
 * A captura de execução do dia abrange integralmente `[deMs, ateMs]`?
 *
 * Exige prova positiva: cobertura presente, classe conhecida **e** que admita
 * execução, limites finitos, coerentes entre si, e envolvendo o intervalo. Todo
 * o resto responde `false`, o que leva a causa a `INDETERMINADA`.
 *
 * `cobertura` chega repassada verbatim pelo decodificador, inclusive `null` e
 * inclusive malformada — de propósito, para que a classificação receba o caso em
 * vez de o decodificador afirmar cobertura completa por omissão. Daí as
 * verificações de `typeof` sobre campos que o tipo já declara: o tipo descreve o
 * contrato, não o que a rede entregou.
 */
function execucaoAbrange(
  cobertura: CoberturaHeatmap | null,
  deMs: number,
  ateMs: number,
): boolean {
  if (cobertura === null || typeof cobertura !== 'object') return false;
  if (!Number.isFinite(deMs) || !Number.isFinite(ateMs)) return false;

  // `FILA_SEM_EXEC` e `VAZIA` não têm execução alguma; classe desconhecida não
  // autoriza afirmação nenhuma.
  const classe = cobertura.classe;
  if (classe !== 'COMPLETA' && classe !== 'EXEC_PARCIAL') return false;

  const de = cobertura.execDeMs;
  const ate = cobertura.execAteMs;
  if (typeof de !== 'number' || !Number.isFinite(de)) return false;
  if (typeof ate !== 'number' || !Number.isFinite(ate)) return false;
  if (de > ate) return false;

  return de <= deMs && ate >= ateMs;
}

/**
 * Por que a fila saiu, no intervalo `[from, to)` do grupo de um preço.
 *
 * `ABSORVIDA` quando a execução acumulada nesse preço ao longo do intervalo
 * corresponde a 50% ou mais da redução de fila entre as duas janelas;
 * `CANCELADA` abaixo disso; `INDETERMINADA` quando a captura de execução não
 * abrange o intervalo inteiro (requisitos 6.7 e 6.8).
 *
 * ⚠️ A comparação é entre **soma** de execução e **diferença de médias** de
 * fila, como o requisito 6.7 a enuncia. As duas grandezas não têm a mesma
 * dimensão, e o resultado é uma razão de cobertura, não uma conservação de
 * quantidade — registrado aqui para ninguém "consertar" a fórmula depois
 * achando que falta dividir pela janela.
 *
 * O limite superior do intervalo é o **fim** do último balde avaliado, não o seu
 * início: o balde `[t, t + baldeSeg)` só está coberto se a execução alcançar o
 * fim dele. É a leitura estrita de "abranger integralmente".
 */
function classifyWithdrawal(
  grid: BookmapGrid,
  order: Uint32Array,
  from: number,
  to: number,
  reducao: number,
): CausaRetirada {
  const kFirst = order[from] ?? 0;
  const kLast = order[to - 1] ?? 0;
  const deMs = grid.times[grid.ti[kFirst] ?? 0] ?? Number.NaN;
  const inicioUltimo = grid.times[grid.ti[kLast] ?? 0] ?? Number.NaN;
  const ateMs = inicioUltimo + bucketDurationMs(grid.baldeSeg);

  if (!execucaoAbrange(grid.cobertura, deMs, ateMs)) return 'INDETERMINADA';

  // Execução acumulada NESSE preço. Os baldes sem célula neste preço não
  // contribuem, por definição — só as células do grupo entram na soma.
  let exec = 0;
  for (let i = from; i < to; i += 1) {
    const k = order[i] ?? 0;
    exec += readQuantity(grid.buy, k) + readQuantity(grid.sell, k);
  }

  // Defensivo: `RETIRANDO` implica `reducao > 0` (a variação ficou abaixo de
  // −15%). Mantido para a função ser total mesmo chamada fora desse contexto.
  if (!(reducao > 0)) return exec > 0 ? 'ABSORVIDA' : 'CANCELADA';

  return exec >= reducao * WALL_ABSORCAO_MIN_RATIO ? 'ABSORVIDA' : 'CANCELADA';
}

/**
 * Classifica a tendência da fila de um lado, num preço, comparando a média dos
 * `W` baldes com dado mais recentes contra os `W` imediatamente anteriores.
 *
 * ⚠️ **"Balde com dado" é balde em que existe célula naquele preço**, e o valor
 * do lado avaliado pode ser zero. Não é "balde em que este lado tem fila
 * positiva" — sob essa leitura a média da janela anterior nunca poderia ser
 * zero, e a segunda cláusula do requisito 6.6 (janela anterior nula) seria
 * inalcançável. O texto do requisito também separa as duas coisas: conta baldes
 * "no preço avaliado" e tira a média da fila "no mesmo lado do livro".
 *
 * Menos de `2 × W` baldes com dado devolve `ESTAVEL` (requisito 6.6): amostra
 * insuficiente não autoriza inventar tendência.
 */
function classifyTrend(
  grid: BookmapGrid,
  order: Uint32Array,
  lo: number,
  hi: number,
  values: Float32Array,
  janela: number,
): TrendVerdict {
  if (hi - lo < 2 * janela) return ESTAVEL_SEM_AMOSTRA;

  const inicioRecente = hi - janela;
  const inicioAnterior = hi - 2 * janela;

  let somaRecente = 0;
  for (let i = inicioRecente; i < hi; i += 1) {
    somaRecente += readQuantity(values, order[i] ?? 0);
  }
  let somaAnterior = 0;
  for (let i = inicioAnterior; i < inicioRecente; i += 1) {
    somaAnterior += readQuantity(values, order[i] ?? 0);
  }

  const mediaRecente = somaRecente / janela;
  const mediaAnterior = somaAnterior / janela;

  // Janela anterior nula: não há razão finita a calcular (requisito 6.6).
  if (mediaAnterior <= 0) {
    if (mediaRecente > 0) {
      return {
        tendencia: 'CRESCENDO',
        variacaoPct: WALL_VARIACAO_PCT_SEM_BASE,
        causaRetirada: null,
      };
    }
    return ESTAVEL_SEM_AMOSTRA;
  }

  // Com `mediaAnterior > 0` e as quantidades não negativas, a variação é finita
  // e nunca inferior a −100% (a fila não fica negativa).
  const variacaoPct = ((mediaRecente - mediaAnterior) / mediaAnterior) * 100;

  if (variacaoPct > WALL_HISTERESE_PCT) {
    return { tendencia: 'CRESCENDO', variacaoPct, causaRetirada: null };
  }

  if (variacaoPct < -WALL_HISTERESE_PCT) {
    const causaRetirada = classifyWithdrawal(
      grid,
      order,
      inicioAnterior,
      hi,
      mediaAnterior - mediaRecente,
    );
    return { tendencia: 'RETIRANDO', variacaoPct, causaRetirada };
  }

  // Dentro da banda morta — inclusive exatamente em ±15%.
  return { tendencia: 'ESTAVEL', variacaoPct, causaRetirada: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// Ordenação do card
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Distância crescente; empate de distância resolve por quantidade decrescente;
 * persistindo, fila de compra antes da fila de venda (requisito 6.4).
 *
 * Ordem **total** dentro de um grupo: como todos os preços do grupo estão do
 * mesmo lado do preço corrente, a distância determina o preço univocamente, logo
 * o par `(distância, lado)` já é único. Nenhum resultado depende da estabilidade
 * do ordenador do runtime.
 */
function compareWalls(a: BookmapWall, b: BookmapWall): number {
  if (a.distanciaPts !== b.distanciaPts) return a.distanciaPts - b.distanciaPts;
  if (a.quantidade !== b.quantidade) return b.quantidade - a.quantidade;
  if (a.lado !== b.lado) return a.lado === 'BID' ? -1 : 1;
  return 0;
}

/** Resposta de "nada a apresentar", com vetores novos a cada chamada. */
function semParedes(): DetectedWalls {
  return { acima: [], abaixo: [] };
}

// ═════════════════════════════════════════════════════════════════════════════
// API pública
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Detecta as paredes de liquidez do grid, separadas em acima e abaixo do preço
 * corrente.
 *
 * Pós-condições (requisitos 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.12):
 *
 * - `acima` só contém `preco > precoAtual`; `abaixo`, só `preco < precoAtual`.
 *   Preço exatamente igual ao corrente não entra em nenhum dos dois.
 * - `distanciaPts === |preco − precoAtual|`, sempre positivo e finito.
 * - Cada grupo tem no máximo `opts.maxPorLado` paredes, ordenadas por distância
 *   crescente, depois quantidade decrescente, depois compra antes de venda.
 * - `quantidade` é o pico de fila do maior trecho qualificado, e é sempre `≥ 100`.
 * - `causaRetirada` é `null` fora de `RETIRANDO`, e nunca é `CANCELADA` sem
 *   execução capturada cobrindo o intervalo avaliado.
 * - Determinística: nenhuma leitura de relógio, de sorteio ou de estado global,
 *   e nenhuma dependência da ordem em que as células chegaram no payload.
 * - Não muta `grid` nem nenhum de seus vetores.
 *
 * Devolve os dois grupos vazios, sem lançar, quando `precoAtual` não é finito,
 * quando o grid não tem célula, eixo ou coluna utilizável, ou quando
 * `opts.maxPorLado` sanea para zero. O requisito 6.10 atribui ao card a mensagem
 * em pt-BR; aqui a resposta é a ausência de paredes.
 */
export function detectWalls(
  grid: BookmapGrid,
  precoAtual: number,
  opts: DetectWallsOptions,
): DetectedWalls {
  if (grid === null || typeof grid !== 'object') return semParedes();
  if (!Number.isFinite(precoAtual)) return semParedes();

  const janela = sanitizeBaldesTendencia(opts?.baldesTendencia);
  const maxPorLado = sanitizeMaxPorLado(opts?.maxPorLado);
  if (maxPorLado <= 0) return semParedes();

  const n = cellCount(grid);
  if (n <= 0) return semParedes();

  const nP = grid.prices.length;
  if (nP <= 0 || grid.times.length <= 0) return semParedes();

  // Limiar: percentil 90 das células de fila não nula do grid inteiro, com os
  // dois lados na mesma amostra, elevado ao piso absoluto de 100 contratos.
  //
  // Os dois lados entram na MESMA amostra porque o critério é da grandeza, não
  // do lado: com limiares separados, uma fila de 500 contratos qualificaria na
  // compra e não na venda, e a comparação que o operador faz entre os dois
  // grupos do card deixaria de valer.
  const p90 = positiveQuantileOfPair(grid.bid, grid.ask, n, WALL_QUANTILE);
  const piso = sanitizeMinQuantidade(opts?.minQuantidade);
  const limiar = p90 > piso ? p90 : piso;

  const { order, start } = groupByPriceThenTime(grid, n);

  const acima: BookmapWall[] = [];
  const abaixo: BookmapWall[] = [];

  // Os dois lados são avaliados em cada preço: um nível pode ser defendido pela
  // compra na abertura e virar oferta de venda à tarde, e as duas leituras
  // interessam. Fora do laço porque as colunas não mudam de preço para preço.
  const lados: readonly (readonly ['BID' | 'ASK', Float32Array])[] = [
    ['BID', grid.bid],
    ['ASK', grid.ask],
  ];

  for (let p = 0; p < nP; p += 1) {
    const lo = start[p] ?? 0;
    const hi = start[p + 1] ?? 0;
    if (hi - lo < WALL_MIN_BALDES_CONSECUTIVOS) continue;

    const preco = grid.prices[p] ?? Number.NaN;
    if (!Number.isFinite(preco)) continue;
    if (preco === precoAtual) continue;

    const destino = preco > precoAtual ? acima : abaixo;
    const distanciaPts = Math.abs(preco - precoAtual);

    for (const [lado, values] of lados) {
      const quantidade = bestRunQuantity(
        grid,
        order,
        lo,
        hi,
        values,
        WALL_MIN_BALDES_CONSECUTIVOS,
      );
      if (quantidade < limiar) continue;

      const trend = classifyTrend(grid, order, lo, hi, values, janela);

      destino.push({
        preco,
        lado,
        quantidade,
        distanciaPts,
        tendencia: trend.tendencia,
        variacaoPct: trend.variacaoPct,
        causaRetirada: trend.causaRetirada,
      });
    }
  }

  acima.sort(compareWalls);
  abaixo.sort(compareWalls);

  return {
    acima: acima.slice(0, maxPorLado),
    abaixo: abaixo.slice(0, maxPorLado),
  };
}
