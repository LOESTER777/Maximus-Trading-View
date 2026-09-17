/**
 * Property 12 — Classificação de cobertura reflete o dado. Spec
 * `bookmap-no-mapa-de-decisao`, tarefa 4.4.
 *
 * ```
 * cobertura.classe === 'EXEC_PARCIAL' ⇒ hachura renderizada no intervalo
 *                                        [execAteMs, filaAteMs]
 * cobertura.classe === 'VAZIA'        ⇒ nenhuma célula desenhada
 * ```
 *
 * **Validates: Requirements 7.2, 7.4**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA É A PROPRIEDADE MAIS EXERCITADA DAS DOZE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medido: **100% dos 5 pregões materializados são `EXEC_PARCIAL`**, com ~6 h de
 * execução faltando — fila até 18:29 BRT, execução até 12:31 BRT. O caminho que
 * esta propriedade protege é o **normal**, não a exceção.
 *
 * Ela impede que a tela receba `EXEC_PARCIAL` e desenhe como se fosse
 * `COMPLETA`, o que faria o operador ler seis horas de "mercado sem negócio"
 * onde não há dado capturado. Esse erro já foi pago neste projeto: uma
 * degradação de 2.277× no fluxo de ticks passou **51 pregões invisível** porque
 * dado faltando parecia dado normal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO NÃO ALCANÇA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os únicos imports de execução são o núcleo puro de cobertura e a biblioteca de
 * teste. O núcleo, por sua vez, importa somente o formatador de horário — que
 * não importa nada. Logo o fechamento transitivo deste arquivo não tem caminho
 * até camada de conexão, de feed de cotação, de envio de ordem ou de estado de
 * conta, e não carrega endereço de rede, credencial nem identificador de conta.
 *
 * Todo insumo é sintetizado pelos geradores; nada é lido de rede, de banco ou do
 * sistema de arquivos, em CSV ou em qualquer outro formato.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, teste
 * incluído, e uma citação em comentário contaria como ocorrência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO A PROPRIEDADE FOI TORNADA PRECISA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O enunciado tem duas pré-condições que não estão no texto curto e que **vêm do
 * próprio requisito 7.2**, não de conveniência para o teste passar:
 *
 * 1. **A métrica tem de incluir execução.** O critério 7.2 abre com
 *    `WHERE a métrica selecionada incluir execução` — a hachura é condicional
 *    por definição, e a métrica padrão do painel é a de fila. O caso negativo
 *    tem propriedade própria abaixo, exigindo que a ausência de hachura **não**
 *    apague a classe nem os horários.
 * 2. **O intervalo tem de existir.** O critério pede hachura sobre "cada
 *    intervalo do dia em que existir fila sem execução". Quando o fim da
 *    execução coincide com o fim da fila não existe tal intervalo, e um
 *    retângulo de largura zero seria indistinguível de ausência de hachura. Essa
 *    borda também tem propriedade própria, para que a ausência ali seja
 *    afirmada em vez de tolerada.
 *
 * O recorte à janela visível e o piso de 1 pixel que o critério 7.2 também
 * menciona são do desenho (tarefa 6.1): este núcleo raciocina em tempo, não em
 * pixel, e é isso que estas propriedades medem.
 *
 * Convenções: nomes de teste e comentários em pt-BR, identificadores em inglês.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  computeCoverageView,
  formatCoverageClock,
  type CoverageView,
  type MetricaBookmap,
} from '@robustus/charts-core';
import type { CoberturaHeatmap } from '@robustus/charts-core';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

const NUM_RUNS = 500;
const SEED = 42;

const MIN_MS = 60_000;

/**
 * 28/08/2026 09:00 BRT — abertura do último pregão materializado.
 *
 * Construído em UTC (12:00Z = 09:00 BRT) para que o valor não dependa do fuso da
 * máquina que roda a suíte. Nenhuma aritmética de fuso é feita aqui: este
 * projeto já errou conversão em ±3 h somando deslocamento à mão.
 */
const ABERTURA_MS = Date.UTC(2026, 7, 28, 12, 0, 0);

/** 18:29 BRT — onde a fila termina nos 5 pregões medidos. */
const FILA_ATE_MEDIDO_MS = ABERTURA_MS + (9 * 60 + 29) * MIN_MS;

/** 12:31 BRT — onde a execução capturada termina nos mesmos 5 pregões. */
const EXEC_ATE_MEDIDO_MS = ABERTURA_MS + (3 * 60 + 31) * MIN_MS;

/**
 * Maior instante que o construtor de data aceita, em epoch ms.
 *
 * Espelha a guarda do núcleo, e não é preciosismo: finitude **não basta** —
 * `1e300` é finito e faz o formatador lançar. Os geradores abaixo produzem
 * número arbitrário justamente para exercitar essa borda, e a função sob teste
 * precisa atravessá-la sem lançar.
 */
const MAX_EPOCH_MS = 8.64e15;

const CLASSES_CONHECIDAS = ['COMPLETA', 'FILA_SEM_EXEC', 'EXEC_PARCIAL', 'VAZIA'] as const;

type ClasseConhecida = (typeof CLASSES_CONHECIDAS)[number];

const MOTIVOS_CONHECIDOS = [
  'ANTES_DA_EXECUCAO',
  'DEPOIS_DA_EXECUCAO',
  'DIA_SEM_EXECUCAO',
] as const;

/** `HH:MM BRT`, 24 h, precisão de minuto, sufixo explícito (requisito 7.6). */
const FORMATO_RELOGIO_BRT = /^\d{2}:\d{2} BRT$/;

// ═════════════════════════════════════════════════════════════════════════════
// Ponte de tipo até a função sob teste
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A cobertura como ela **realmente** chega da rede: campos sem garantia de tipo.
 *
 * ⚠️ O tipo de produção declara `classe` como a união das quatro classes
 * conhecidas, mas o endpoint repassa verbatim o que está gravado — de propósito,
 * para que a tela possa apresentar classe desconhecida como não verificada em
 * vez de o backend inventar uma classe que não mediu. Gerar apenas valores da
 * união testaria uma garantia que o produtor do dado explicitamente não dá.
 */
interface CoberturaBruta {
  readonly classe?: unknown;
  readonly observacao?: unknown;
  readonly filaDeMs?: unknown;
  readonly filaAteMs?: unknown;
  readonly execDeMs?: unknown;
  readonly execAteMs?: unknown;
}

/**
 * Único ponto de conversão de tipo do arquivo.
 *
 * Concentrado numa função para que a conversão seja deliberada e visível, em vez
 * de espalhada por cada chamada — e para que a propriedade possa alimentar a
 * função com o que a rede entrega, não só com o que o tipo promete.
 */
function chamar(
  cobertura: CoberturaBruta | null | undefined,
  metrica: unknown,
  baldeSeg?: unknown,
): CoverageView {
  return computeCoverageView(cobertura as CoberturaHeatmap | null | undefined, {
    metrica: metrica as MetricaBookmap,
    baldeSeg: baldeSeg as number | undefined,
  });
}

/**
 * A métrica informada faz o desenho incluir execução (a condição de 7.2).
 *
 * ⚠️ `DELTA` e `VOLUME` entraram junto com as métricas: as duas são contas sobre
 * `execCompra`/`execVenda`, então num intervalo sem execução capturada elas desenham ZERO e a tela
 * afirmaria "nenhum negócio" onde a verdade é "ninguém gravou". Este espelho existe para que a
 * propriedade reprove se o núcleo esquecer uma delas.
 */
function incluiExecucao(metrica: unknown): boolean {
  return (
    metrica === 'EXECUCAO' || metrica === 'AMBAS' || metrica === 'DELTA' || metrica === 'VOLUME'
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Geradores
// ═════════════════════════════════════════════════════════════════════════════

/** Instante dentro do pregão de referência, do minuto 0 ao minuto 569. */
const arbInstanteDoPregao = fc
  .integer({ min: 0, max: 9 * 60 + 29 })
  .map((minutos) => ABERTURA_MS + minutos * MIN_MS);

/**
 * Número arbitrário, com peso nas bordas que costumam quebrar guardas de data.
 *
 * `MAX_EPOCH_MS + 1` está incluído porque é exatamente onde o formatador passa a
 * lançar, e `1e300` porque é finito e ainda assim inválido — a diferença entre
 * as duas guardas possíveis.
 */
const arbNumeroQualquer = fc.oneof(
  { arbitrary: fc.double(), weight: 3 },
  { arbitrary: fc.integer(), weight: 2 },
  {
    arbitrary: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -0,
      1e300,
      -1e300,
      MAX_EPOCH_MS,
      -MAX_EPOCH_MS,
      MAX_EPOCH_MS + 1,
      -MAX_EPOCH_MS - 1,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
    weight: 3,
  },
);

/** Um limite de cobertura como pode chegar: instante bom, ausente, ou lixo. */
const arbLimite = fc.oneof(
  { arbitrary: arbInstanteDoPregao, weight: 4 },
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: fc.constant(undefined), weight: 1 },
  { arbitrary: arbNumeroQualquer, weight: 3 },
);

const arbClasseConhecida = fc.constantFrom(...CLASSES_CONHECIDAS);

/**
 * Classe como pode chegar — inclui grafias próximas e valores não-texto.
 *
 * As grafias próximas (`'completa'`, `'PARCIAL'`) existem porque são o erro
 * plausível: uma classe quase certa não pode ser aceita como certa, senão a tela
 * afirmaria cobertura que não mediu.
 */
const arbClasseQualquer = fc.oneof(
  { arbitrary: arbClasseConhecida, weight: 6 },
  {
    arbitrary: fc.constantFrom(
      'completa',
      'exec_parcial',
      'EXEC PARCIAL',
      'PARCIAL',
      'FILA_SEM_EXECUCAO',
      'DESCONHECIDA',
      '',
      ' VAZIA',
    ),
    weight: 3,
  },
  { arbitrary: fc.string(), weight: 1 },
  { arbitrary: fc.constantFrom(null, undefined, 0, 1, true, false), weight: 2 },
);

// ⚠️ Lista LITERAL e não derivada do tipo: métrica nova acrescentada à união sem entrar aqui
// passaria em silêncio e a propriedade deixaria de cobri-la. `DELTA` e `VOLUME` entraram na mesma
// edição que as criou, de propósito.
const arbMetricaConhecida = fc.constantFrom<MetricaBookmap>(
  'FILA',
  'EXECUCAO',
  'AMBAS',
  'DELTA',
  'VOLUME',
);

/** Só as métricas que fazem o desenho incluir execução — agora quatro, e não duas. */
const arbMetricaComExecucao = fc.constantFrom<MetricaBookmap>(
  'EXECUCAO',
  'AMBAS',
  'DELTA',
  'VOLUME',
);

/** Métrica como pode chegar do painel, inclusive fora da união. */
const arbMetricaQualquer = fc.oneof(
  { arbitrary: arbMetricaConhecida, weight: 6 },
  { arbitrary: fc.constantFrom('fila', 'EXEC', 'ambas', '', null, undefined, 0), weight: 2 },
);

/** Duração de balde, com valores utilizáveis e não utilizáveis. */
const arbBaldeSeg = fc.oneof(
  { arbitrary: fc.constantFrom(1, 5, 15, 30, 60, 300, 900, 3600), weight: 5 },
  {
    arbitrary: fc.constantFrom(
      0,
      -1,
      -3600,
      86_400,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
    ),
    weight: 2,
  },
  { arbitrary: fc.double(), weight: 1 },
);

const arbObservacao = fc.oneof(
  { arbitrary: fc.constant(null), weight: 3 },
  { arbitrary: fc.constant(undefined), weight: 1 },
  {
    arbitrary: fc.constantFrom(
      '',
      '   ',
      'Rodar o agregador de profundidade para 2026-08-28, fora do pregão.',
    ),
    weight: 3,
  },
  { arbitrary: fc.string(), weight: 2 },
);

/** Os campos da cobertura que **não** são a classe. */
const arbRestoDaCobertura = fc.record({
  observacao: arbObservacao,
  filaDeMs: arbLimite,
  filaAteMs: arbLimite,
  execDeMs: arbLimite,
  execAteMs: arbLimite,
});

/** Quádrupla de limites coerente: `filaDe ≤ filaAte` e `execDe ≤ execAte ≤ filaAte`. */
interface QuadruplaCoerente {
  readonly filaDeMs: number;
  readonly filaAteMs: number;
  readonly execDeMs: number;
  readonly execAteMs: number;
}

/**
 * Gera uma quádrupla coerente, com a folga final controlada em minutos.
 *
 * Construída do fim para o começo, e não sorteando quatro instantes soltos: é o
 * que garante por construção `execDe ≤ execAte ≤ filaAte` e `filaDe ≤ filaAte`,
 * mantendo a amostra dentro da região onde o critério 7.2 se aplica. Coerência
 * sorteada daria taxa de rejeição alta e um teste que quase não exercita o caso
 * que importa — foi exatamente o que a aferição dos geradores mostrou antes
 * desta função existir (ver o registro de contraevidência no relato da tarefa).
 *
 * `filaDeDelta` pode ser negativo **e** positivo de propósito: execução
 * começando antes da fila é tolerada pelo núcleo (não é uma das duas
 * incoerências que o critério 7.5 nomeia), e a folga inicial precisa variar dos
 * dois lados do limiar de um balde para que o trecho final seja exercitado com e
 * sem a companhia do trecho inicial.
 *
 * `Math.min` no início da fila fecha a única brecha da construção: sem ele, um
 * `filaDeDelta` grande com folga pequena produziria início posterior ao fim.
 *
 * @param folgaMin Faixa, em minutos, entre o fim da execução e o fim da fila.
 */
function arbQuadruplaCoerente(folgaMin: {
  readonly min: number;
  readonly max: number;
}): fc.Arbitrary<QuadruplaCoerente> {
  return fc
    .record({
      execDeMin: fc.integer({ min: 0, max: 240 }),
      execDurMin: fc.integer({ min: 0, max: 420 }),
      folga: fc.integer(folgaMin),
      filaDeDelta: fc.integer({ min: -240, max: 120 }),
    })
    .map(({ execDeMin, execDurMin, folga, filaDeDelta }): QuadruplaCoerente => {
      const execDeMs = ABERTURA_MS + execDeMin * MIN_MS;
      const execAteMs = execDeMs + execDurMin * MIN_MS;
      const filaAteMs = execAteMs + folga * MIN_MS;
      const filaDeMs = Math.min(execDeMs + filaDeDelta * MIN_MS, filaAteMs);
      return { filaDeMs, filaAteMs, execDeMs, execAteMs };
    });
}

/** Cobertura `EXEC_PARCIAL` com os quatro limites presentes e coerentes. */
interface CoberturaExecParcial extends QuadruplaCoerente {
  readonly classe: 'EXEC_PARCIAL';
  readonly observacao: string | null;
}

/** O caso medido: fila 09:00→18:29 BRT, execução 09:00→12:31 BRT. */
const CASO_MEDIDO: CoberturaExecParcial = {
  classe: 'EXEC_PARCIAL',
  observacao: null,
  filaDeMs: ABERTURA_MS,
  filaAteMs: FILA_ATE_MEDIDO_MS,
  execDeMs: ABERTURA_MS,
  execAteMs: EXEC_ATE_MEDIDO_MS,
};

/** `EXEC_PARCIAL` coerente, com a folga final controlada em minutos. */
function arbExecParcialCoerente(folgaMin: {
  readonly min: number;
  readonly max: number;
}): fc.Arbitrary<CoberturaExecParcial> {
  const derivada = fc
    .tuple(arbQuadruplaCoerente(folgaMin), fc.oneof(fc.constant(null), fc.string()))
    .map(([limites, observacao]): CoberturaExecParcial => ({
      classe: 'EXEC_PARCIAL',
      observacao,
      ...limites,
    }));

  // O caso medido é injetado explicitamente quando cabe na faixa de folga
  // pedida: sendo 100% dos pregões, não deve depender de sorte do gerador.
  const medidoCabe =
    FILA_ATE_MEDIDO_MS - EXEC_ATE_MEDIDO_MS >= folgaMin.min * MIN_MS &&
    FILA_ATE_MEDIDO_MS - EXEC_ATE_MEDIDO_MS <= folgaMin.max * MIN_MS;

  return medidoCabe
    ? fc.oneof(
        { arbitrary: fc.constant(CASO_MEDIDO), weight: 1 },
        { arbitrary: derivada, weight: 9 },
      )
    : derivada;
}

/**
 * Cobertura **realista**: quatro limites coerentes, classe conhecida.
 *
 * A distribuição das classes é enviesada para `EXEC_PARCIAL` porque é o que o
 * dado real traz — 100% dos pregões materializados —, e é a classe onde vive
 * toda a lógica de hachura.
 */
const arbCoberturaRealista: fc.Arbitrary<CoberturaBruta> = fc
  .tuple(
    fc.oneof(
      { arbitrary: fc.constant<ClasseConhecida>('EXEC_PARCIAL'), weight: 5 },
      { arbitrary: fc.constant<ClasseConhecida>('FILA_SEM_EXEC'), weight: 2 },
      { arbitrary: fc.constant<ClasseConhecida>('COMPLETA'), weight: 2 },
      { arbitrary: fc.constant<ClasseConhecida>('VAZIA'), weight: 1 },
    ),
    arbObservacao,
    arbQuadruplaCoerente({ min: 0, max: 420 }),
  )
  .map(([classe, observacao, limites]): CoberturaBruta => ({ classe, observacao, ...limites }));

/**
 * Cobertura arbitrária — realista, degenerada, incoerente e ausente na mesma
 * amostra. É o gerador dos invariantes gerais.
 *
 * ⚠️ A metade realista **não** é conforto: sem ela, a aferição mostrou hachura
 * produzida em apenas 0,92% dos casos, e os invariantes sobre hachura passavam
 * quase sem executar o corpo do laço. Gerador que só produz lixo testa só os
 * guardas; a mistura testa o caminho normal e os guardas.
 */
const arbCoberturaQualquer = fc.oneof(
  { arbitrary: arbCoberturaRealista, weight: 8 },
  {
    arbitrary: fc.record({
      classe: arbClasseQualquer,
      observacao: arbObservacao,
      filaDeMs: arbLimite,
      filaAteMs: arbLimite,
      execDeMs: arbLimite,
      execAteMs: arbLimite,
    }),
    weight: 8,
  },
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: fc.constant(undefined), weight: 1 },
);

// ═════════════════════════════════════════════════════════════════════════════
// As propriedades
// ═════════════════════════════════════════════════════════════════════════════

describe('Property 12: classificação de cobertura reflete o dado', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 1 — EXEC_PARCIAL hachura [execAteMs, filaAteMs]
  // ───────────────────────────────────────────────────────────────────────────

  it('EXEC_PARCIAL coerente, com métrica que inclui execução, hachura exatamente [execAteMs, filaAteMs]', () => {
    fc.assert(
      fc.property(
        arbExecParcialCoerente({ min: 1, max: 420 }),
        arbMetricaComExecucao,
        arbBaldeSeg,
        (cobertura, metrica, baldeSeg) => {
          const view = chamar(cobertura, metrica, baldeSeg);

          expect(view.classe).toBe('EXEC_PARCIAL');
          expect(view.verificada).toBe(true);
          // A classe não suprime célula alguma — quem faz isso é só `VAZIA`.
          expect(view.desenhaCelulas).toBe(true);

          const finais = view.hachuras.filter((h) => h.motivo === 'DEPOIS_DA_EXECUCAO');

          // Exatamente uma, e nos limites exatos do enunciado. O trecho inicial
          // pode coexistir com outro motivo; por isso o filtro em vez de exigir
          // uma única hachura no total.
          expect(finais).toHaveLength(1);
          expect(finais[0]?.deMs).toBe(cobertura.execAteMs);
          expect(finais[0]?.ateMs).toBe(cobertura.filaAteMs);

          // Cobertura desigual é exibida, nunca escondida: a hachura sem texto
          // deixaria o operador sem o motivo do âmbar.
          expect(view.aviso).not.toBeNull();
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a folga final é hachurada sem limiar de balde — mesmo folga de um minuto com balde de uma hora', () => {
    fc.assert(
      fc.property(
        arbExecParcialCoerente({ min: 1, max: 2 }),
        arbMetricaComExecucao,
        // Balde maior que a folga, incluindo o teto de 3600 s que o núcleo aplica.
        fc.constantFrom(300, 900, 3600, 86_400, Number.POSITIVE_INFINITY),
        (cobertura, metrica, baldeSeg) => {
          const view = chamar(cobertura, metrica, baldeSeg);

          const finais = view.hachuras.filter((h) => h.motivo === 'DEPOIS_DA_EXECUCAO');

          // Deliberado: o limiar de um balde vale só para o trecho INICIAL, onde
          // serve para não pintar de âmbar a defasagem normal da abertura de todo
          // pregão. Aplicá-lo ao trecho final apagaria a hachura em qualquer dia
          // cuja execução parasse menos de um balde antes da fila.
          expect(finais).toHaveLength(1);
          expect(finais[0]?.deMs).toBe(cobertura.execAteMs);
          expect(finais[0]?.ateMs).toBe(cobertura.filaAteMs);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('EXEC_PARCIAL cujo fim da execução coincide com o fim da fila não produz hachura final', () => {
    fc.assert(
      fc.property(
        arbExecParcialCoerente({ min: 0, max: 0 }),
        arbMetricaComExecucao,
        arbBaldeSeg,
        (cobertura, metrica, baldeSeg) => {
          const view = chamar(cobertura, metrica, baldeSeg);

          // Limites coincidentes não são incoerentes — a cobertura segue
          // verificada e as células seguem desenhadas.
          expect(cobertura.execAteMs).toBe(cobertura.filaAteMs);
          expect(view.classe).toBe('EXEC_PARCIAL');
          expect(view.verificada).toBe(true);
          expect(view.desenhaCelulas).toBe(true);

          // E não há intervalo com fila e sem execução no fim do dia, logo nada a
          // hachurar ali. Afirmar a ausência importa: um retângulo de largura
          // zero seria indistinguível de hachura nenhuma na tela, e produzi-lo
          // faria a camada carregar um objeto que não comunica nada.
          expect(view.hachuras.filter((h) => h.motivo === 'DEPOIS_DA_EXECUCAO')).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('métrica sem execução não hachura, e ainda assim preserva a classe e os horários', () => {
    fc.assert(
      fc.property(
        arbExecParcialCoerente({ min: 1, max: 420 }),
        arbBaldeSeg,
        (cobertura, baldeSeg) => {
          const comFila = chamar(cobertura, 'FILA', baldeSeg);
          const comAmbas = chamar(cobertura, 'AMBAS', baldeSeg);

          // A métrica é a condição `WHERE` do próprio critério 7.2, e a de fila é
          // o padrão do painel: se ela hachurasse, a cláusula 1 estaria sendo
          // satisfeita por um desenho incondicional.
          expect(comFila.hachuras).toEqual([]);
          expect(comAmbas.hachuras.length).toBeGreaterThan(0);

          // Trocar a métrica muda **apenas** a hachura. Este é o ponto de maior
          // risco do requisito: esconder a classe junto com a hachura devolveria
          // a tela ao estado em que `EXEC_PARCIAL` passa por completa.
          expect(comFila.classe).toBe('EXEC_PARCIAL');
          expect(comFila.classe).toBe(comAmbas.classe);
          expect(comFila.verificada).toBe(comAmbas.verificada);
          expect(comFila.desenhaCelulas).toBe(comAmbas.desenhaCelulas);
          expect(comFila.rotulos).toEqual(comAmbas.rotulos);
          expect(comFila.aviso).toBe(comAmbas.aviso);

          // Os horários da resposta estão de fato apresentados, em BRT.
          expect(comFila.rotulos.filaDe).toBe(formatCoverageClock(cobertura.filaDeMs));
          expect(comFila.rotulos.filaAte).toBe(formatCoverageClock(cobertura.filaAteMs));
          expect(comFila.rotulos.execDe).toBe(formatCoverageClock(cobertura.execDeMs));
          expect(comFila.rotulos.execAte).toBe(formatCoverageClock(cobertura.execAteMs));
          for (const rotulo of [
            comFila.rotulos.filaDe,
            comFila.rotulos.filaAte,
            comFila.rotulos.execDe,
            comFila.rotulos.execAte,
          ]) {
            expect(rotulo).toMatch(FORMATO_RELOGIO_BRT);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cláusula 2 — VAZIA não desenha célula
  // ───────────────────────────────────────────────────────────────────────────

  it('VAZIA não desenha célula nem hachura, com qualquer limite e qualquer métrica', () => {
    fc.assert(
      fc.property(
        arbRestoDaCobertura,
        arbMetricaQualquer,
        arbBaldeSeg,
        (resto, metrica, baldeSeg) => {
          const view = chamar({ classe: 'VAZIA', ...resto }, metrica, baldeSeg);

          expect(view.classe).toBe('VAZIA');
          expect(view.desenhaCelulas).toBe(false);
          expect(view.hachuras).toEqual([]);

          // Os limites arbitrários são intencionais: um dia não materializado não
          // tem extensão de fila nem de execução, então exigir limites válidos
          // aqui marcaria toda resposta `VAZIA` como não verificada e engoliria o
          // aviso — que é a única informação acionável deste caso.
          expect(view.verificada).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('VAZIA apresenta o aviso recebido, ou uma mensagem própria quando ele não vem', () => {
    fc.assert(
      fc.property(
        arbRestoDaCobertura,
        arbMetricaQualquer,
        arbBaldeSeg,
        (resto, metrica, baldeSeg) => {
          const view = chamar({ classe: 'VAZIA', ...resto }, metrica, baldeSeg);

          // Nunca silêncio: a tela precisa dizer por que está vazia, senão o dia
          // não materializado é lido como dia sem liquidez.
          expect(typeof view.aviso).toBe('string');
          expect((view.aviso ?? '').trim()).not.toBe('');

          // O aviso da resposta tem precedência, porque é ele que traz o comando
          // de materialização do agregador.
          const observacao = resto.observacao;
          if (typeof observacao === 'string' && observacao.trim() !== '') {
            expect(view.aviso).toBe(observacao);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Invariantes gerais que sustentam as duas cláusulas
  // ───────────────────────────────────────────────────────────────────────────

  it('toda hachura é um intervalo desenhável, e só existe quando a métrica inclui execução', () => {
    fc.assert(
      fc.property(
        arbCoberturaQualquer,
        arbMetricaQualquer,
        arbBaldeSeg,
        (cobertura, metrica, baldeSeg) => {
          const view = chamar(cobertura, metrica, baldeSeg);

          if (view.hachuras.length > 0) {
            expect(incluiExecucao(metrica)).toBe(true);
          }

          for (const hachura of view.hachuras) {
            expect(Number.isFinite(hachura.deMs)).toBe(true);
            expect(Number.isFinite(hachura.ateMs)).toBe(true);

            // Estritamente crescente: intervalo degenerado ou invertido nunca é
            // produzido. Invertido desenharia retângulo de largura negativa;
            // degenerado, retângulo invisível.
            expect(hachura.deMs).toBeLessThan(hachura.ateMs);

            // Dentro da faixa de data utilizável — finitude não basta, e é esta
            // guarda que mantém o formatador de horário sem exceção.
            expect(Math.abs(hachura.deMs)).toBeLessThanOrEqual(MAX_EPOCH_MS);
            expect(Math.abs(hachura.ateMs)).toBeLessThanOrEqual(MAX_EPOCH_MS);
            expect(formatCoverageClock(hachura.deMs)).toMatch(FORMATO_RELOGIO_BRT);
            expect(formatCoverageClock(hachura.ateMs)).toMatch(FORMATO_RELOGIO_BRT);

            expect(MOTIVOS_CONHECIDOS).toContain(hachura.motivo);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('é função total e determinística: nunca lança, e a saída é sempre apresentável', () => {
    fc.assert(
      fc.property(
        arbCoberturaQualquer,
        arbMetricaQualquer,
        arbBaldeSeg,
        (cobertura, metrica, baldeSeg) => {
          // A chamada em si é a asserção de que não lança: entrada malformada
          // resolve para cobertura não verificada, não para exceção. Exceção
          // propagada daqui alcançaria o ciclo de desenho e congelaria o gráfico
          // inteiro por causa de uma camada de contexto.
          const view = chamar(cobertura, metrica, baldeSeg);

          // Determinismo: núcleo puro não lê relógio, não sorteia e não guarda
          // estado entre chamadas. Sem isto, nenhuma das outras propriedades
          // significaria algo — um contraexemplo não seria reproduzível.
          expect(chamar(cobertura, metrica, baldeSeg)).toEqual(view);

          // Sempre há uma linha de rodapé: é ela que carrega a classe e os
          // horários independentemente do recorte visível.
          expect(typeof view.rotulos.resumo).toBe('string');
          expect(view.rotulos.resumo.trim()).not.toBe('');

          expect(Array.isArray(view.hachuras)).toBe(true);
          expect(typeof view.verificada).toBe('boolean');
          expect(typeof view.desenhaCelulas).toBe('boolean');

          // Horário é `HH:MM BRT` ou desconhecido — nunca um valor inventado.
          for (const rotulo of [
            view.rotulos.filaDe,
            view.rotulos.filaAte,
            view.rotulos.execDe,
            view.rotulos.execAte,
          ]) {
            if (rotulo !== null) expect(rotulo).toMatch(FORMATO_RELOGIO_BRT);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('somente VAZIA suprime as células; cobertura não verificada preserva o desenho e não hachura', () => {
    fc.assert(
      fc.property(
        arbCoberturaQualquer,
        arbMetricaQualquer,
        arbBaldeSeg,
        (cobertura, metrica, baldeSeg) => {
          const view = chamar(cobertura, metrica, baldeSeg);

          // Equivalência, não implicação: `VAZIA` é a única classe que zera as
          // células. Se a dúvida sobre a cobertura passasse a apagar o desenho, a
          // tela ficaria vazia sem que o dado estivesse ausente.
          expect(view.desenhaCelulas).toBe(view.classe !== 'VAZIA');

          if (!view.verificada) {
            expect(view.hachuras).toEqual([]);
            expect(view.desenhaCelulas).toBe(true);
            // E o operador é avisado: ausência de hachura aqui não afirma
            // cobertura completa.
            expect(view.aviso).not.toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a classe apresentada vem só do campo classe — limites, métrica e balde não a alteram', () => {
    fc.assert(
      fc.property(
        arbClasseQualquer,
        arbRestoDaCobertura,
        arbRestoDaCobertura,
        arbMetricaQualquer,
        arbMetricaQualquer,
        arbBaldeSeg,
        arbBaldeSeg,
        (classe, restoA, restoB, metricaA, metricaB, baldeA, baldeB) => {
          const viewA = chamar({ classe, ...restoA }, metricaA, baldeA);
          const viewB = chamar({ classe, ...restoB }, metricaB, baldeB);

          // Duas respostas com a mesma classe e todo o resto diferente têm de
          // apresentar a mesma classe. É o requisito 7.8 na forma testável:
          // inferir a classe do que foi desenhado produziria exatamente o erro
          // que a classe existe para evitar — um dia sem captura de execução
          // lido como um dia sem negócio.
          expect(viewA.classe).toBe(viewB.classe);

          // E é o campo, literalmente, quando reconhecido; `null` quando não.
          // Grafia aproximada não é promovida a classe conhecida.
          const esperada = (CLASSES_CONHECIDAS as readonly unknown[]).includes(classe)
            ? classe
            : null;
          expect(viewA.classe).toBe(esperada);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
