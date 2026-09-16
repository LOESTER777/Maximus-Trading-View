/**
 * Cobertura do heatmap e rótulos de horário — spec `bookmap-no-mapa-de-decisao`,
 * tarefa 4.2. Requisitos 7.2, 7.3, 7.4, 7.5, 7.6, 7.7.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Núcleo **puro**: funções totais e determinísticas, sem estado de módulo. Sem
 * DOM, sem objeto global de janela, sem leitura de relógio, sem sorteio, sem
 * I/O. Todo insumo — inclusive o objeto de cobertura e a métrica selecionada —
 * chega por parâmetro.
 *
 * Traduz o objeto `cobertura` da resposta nas duas coisas que a tela precisa:
 *
 * 1. **os intervalos de hachura**, em epoch ms, que marcam o trecho do dia com
 *    fila e sem execução capturada;
 * 2. **os rótulos de horário**, já convertidos para o fuso pedido, que o rodapé
 *    da camada e o card de paredes exibem.
 *
 * O recorte da hachura à janela visível e o piso de 1 pixel são do desenho
 * (tarefa 6.1), não daqui: este arquivo raciocina em tempo, não em pixel.
 *
 * O único import de execução é o formatador de horário (`instant-format.core`)
 * — que por sua vez não importa nada. Logo o fechamento transitivo deste módulo
 * é um único arquivo sem dependências, e não há caminho por onde alcançar camada
 * de conexão, de feed de cotação, de envio de ordem ou de estado de conta. Também
 * não há aqui endereço de rede, credencial nem identificador de conta.
 *
 * ⚠️ Essa propriedade é VERIFICADA, não prometida: `independence-check` percorre
 * o fechamento transitivo e falha se aparecer caminho para camada de conexão.
 * Ao editar este arquivo, não troque o import do formatador por algo que puxe
 * transporte — o verificador vai recusar, e está certo em recusar.
 *
 * ── O FUSO, NA GENERALIZAÇÃO ───────────────────────────────────────────────
 *
 * A origem fixava `America/Sao_Paulo` no formatador. Aqui o fuso entra por
 * `CoverageViewOptions.relogio`, com BRT como default. O módulo permanece puro:
 * o formatador é recebido, nunca construído a partir de ambiente.
 *
 * Nenhum dado é lido do sistema de arquivos, em CSV ou em qualquer outro
 * formato: a cobertura vem da resposta do endpoint.
 *
 * ⚠️ Os identificadores proibidos pelo requisito 12.1 não são citados
 * literalmente aqui, nem como exemplo do que não fazer: a `Independence_Check`
 * inspeciona **integralmente** todo arquivo criado por esta feature, e uma
 * citação em comentário contaria como ocorrência.
 *
 * Convenções: identificadores em inglês, comentários e textos ao operador em
 * pt-BR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE — a lição de 08/06/2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As duas metades do heatmap vêm de fontes DIFERENTES e divergem: a fila é
 * gravada ao vivo pela ponte e alcança ~18:29; a execução vem do arquivo de
 * negócios e para em ~12:31. Medido: **100% dos 5 pregões materializados são
 * `EXEC_PARCIAL`**, com ~6 h de execução faltando.
 *
 * Um heatmap assim **parece completo**. As paredes aparecem o dia inteiro e as
 * bolhas de negócio somem no meio da tarde — o que se lê como "o mercado
 * parou", e não como "o dado não foi capturado". São conclusões opostas a
 * partir da mesma tela.
 *
 * O projeto já pagou por esse erro exato: uma degradação de 2.277× no fluxo de
 * ticks passou **51 pregões invisível** porque dado faltando parecia dado
 * normal. Daí as duas regras que este arquivo materializa:
 *
 * - **cobertura desigual é exibida, nunca escondida** — o trecho descoberto sai
 *   hachurado e os horários vão para o rodapé;
 * - **cobertura desconhecida é declarada como não verificada** — nunca afirmada
 *   como `COMPLETA` sem prova.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CLASSE VEM DO CAMPO, NUNCA DO DESENHO (requisito 7.8)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `computeCoverageView` recebe o objeto de cobertura e **nada** sobre as células
 * desenhadas. É proposital: inferir a classe da presença de bolhas na tela
 * produziria exatamente o erro que a classe existe para evitar — um dia sem
 * captura de execução seria lido como um dia sem negócio.
 *
 * Consequência de tipo: a função não recebe grid, não recebe contagem de células
 * e não tem como derivar classe alguma por conta própria. A única fonte é o
 * campo `classe` da resposta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `classe` É TRATADA COMO TEXTO LIVRE NA VALIDAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O tipo declara a união das quatro classes conhecidas, mas em tempo de execução
 * o valor pode chegar FORA dela: o endpoint repassa verbatim o que está gravado,
 * de propósito, para que a tela possa apresentar classe desconhecida como não
 * verificada em vez de o backend inventar uma classe que não mediu.
 *
 * Por isso a validação compara contra o conjunto conhecido em vez de confiar no
 * tipo. Confiar no tipo aqui seria confiar numa garantia que o produtor do dado
 * explicitamente não dá.
 */

import { DEFAULT_COVERAGE_CLOCK, type ClockFormatter } from './instant-format.core.js';
import type { CoberturaHeatmap } from './bookmap-types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As quatro classes conhecidas, na forma que a validação usa.
 *
 * Declarado como tupla `readonly` para que o tipo derivado acompanhe a lista por
 * construção: acrescentar uma classe aqui a torna reconhecida sem tocar em mais
 * nenhum ponto da validação.
 */
const CLASSES_CONHECIDAS = ['COMPLETA', 'FILA_SEM_EXEC', 'EXEC_PARCIAL', 'VAZIA'] as const;

/** Duração de balde adotada quando a informada não é utilizável. */
const BALDE_SEG_PADRAO = 60;

/** Menor duração de balde admitida, em segundos. */
const BALDE_SEG_MIN = 1;

/**
 * Maior duração de balde admitida, em segundos — uma hora.
 *
 * Espelha o teto que o endpoint já aplica ao parâmetro de balde. Sem o teto, um
 * valor absurdo faria a condição de "ao menos um balde" nunca ser satisfeita e a
 * hachura inicial desapareceria em silêncio.
 */
const BALDE_SEG_MAX = 3600;

/**
 * Maior instante que o construtor de data aceita, em epoch ms.
 *
 * ⚠️ Não é preciosismo: o formatador de horário lança para instante fora dessa
 * faixa, e finitude **não** basta como guarda — `1e300` é finito e inválido. A
 * property test da tarefa 4.4 gera número arbitrário, então esta é a borda que
 * ela vai exercitar.
 */
const MAX_EPOCH_MS = 8.64e15;

/** Separador dos campos do rodapé. */
const SEP = ' · ';

/** Texto adotado quando o horário não veio na resposta. */
const HORARIO_AUSENTE = 'não informado';

// ═════════════════════════════════════════════════════════════════════════════
// Tipos públicos
// ═════════════════════════════════════════════════════════════════════════════

/** As quatro classes de cobertura conhecidas. */
export type ClasseCoberturaConhecida = (typeof CLASSES_CONHECIDAS)[number];

/** Métrica selecionada no painel — a mesma união de `BookmapLayerOptions`. */
export type MetricaBookmap = 'FILA' | 'EXECUCAO' | 'AMBAS';

/**
 * Por que um intervalo do dia ficou sem execução capturada.
 *
 * Existe para o desenho e o texto poderem diferenciar as três situações sem
 * recalcular nada: são causas distintas, com leituras distintas.
 */
export type MotivoHachura =
  /** Fila começou antes da execução — trecho inicial descoberto. */
  | 'ANTES_DA_EXECUCAO'
  /** Execução terminou antes da fila — é o trecho de ~6 h dos 5 pregões. */
  | 'DEPOIS_DA_EXECUCAO'
  /** O dia inteiro tem fila e nenhuma execução. */
  | 'DIA_SEM_EXECUCAO';

/**
 * Um intervalo a hachurar, em epoch ms, fechado à esquerda e à direita.
 *
 * Invariante da saída: `deMs < ateMs`, ambos finitos. Intervalo degenerado não é
 * produzido — não existe "trecho sem execução" de duração zero, e um retângulo
 * de largura zero seria indistinguível de ausência de hachura.
 *
 * O recorte à janela visível e o piso de 1 pixel são do desenho (tarefa 6.1).
 */
export interface HachuraCobertura {
  readonly deMs: number;
  readonly ateMs: number;
  readonly motivo: MotivoHachura;
}

/**
 * Horários de cobertura já em BRT, prontos para exibir.
 *
 * Cada campo é `'HH:MM BRT'` ou `null` quando o limite correspondente não veio
 * na resposta ou não é um instante utilizável. `null` significa desconhecido — a
 * tela escreve que não foi informado em vez de exibir um horário inventado.
 */
export interface RotulosCobertura {
  readonly filaDe: string | null;
  readonly filaAte: string | null;
  readonly execDe: string | null;
  readonly execAte: string | null;
  /** Faixa da fila em pt-BR, ex.: `fila 09:00 BRT–18:29 BRT`. */
  readonly faixaFila: string;
  /** Faixa da execução em pt-BR, ex.: `execução 09:00 BRT–12:31 BRT`. */
  readonly faixaExec: string;
  /**
   * Linha de rodapé com a classe e os horários — sempre presente.
   *
   * Independe do recorte de tempo e de preço visível e da métrica selecionada
   * (requisitos 7.7 e 7.8): a hachura é condicional, a informação textual não.
   */
  readonly resumo: string;
}

/** O que a tela precisa saber sobre a cobertura do dia carregado. */
export interface CoverageView {
  /**
   * Classe recebida, quando reconhecida; `null` quando ausente ou desconhecida.
   *
   * Derivada **exclusivamente** do campo `classe` da resposta (requisito 7.8).
   */
  readonly classe: ClasseCoberturaConhecida | null;
  /**
   * A cobertura pôde ser verificada.
   *
   * `false` quando a informação está ausente, a classe é desconhecida, ou os
   * limites necessários à hachura são nulos ou incoerentes (requisito 7.5).
   * Nesse caso `hachuras` está vazia e a tela declara que não verificou.
   */
  readonly verificada: boolean;
  /** Intervalos a hachurar. Vazio quando não há o que marcar. */
  readonly hachuras: readonly HachuraCobertura[];
  /**
   * As células recebidas devem ser desenhadas.
   *
   * `false` **somente** em `VAZIA` (requisito 7.4). Cobertura não verificada
   * preserva o desenho das células (requisito 7.5) — a dúvida é sobre a
   * cobertura, não sobre as células que chegaram.
   */
  readonly desenhaCelulas: boolean;
  readonly rotulos: RotulosCobertura;
  /**
   * Aviso em pt-BR, ou `null` quando não há o que avisar.
   *
   * `COMPLETA` devolve `null`: silêncio é a resposta certa quando não há
   * ressalva, e um aviso permanente treina o operador a ignorar avisos.
   */
  readonly aviso: string | null;
}

/** Parâmetros de `computeCoverageView`. */
export interface CoverageViewOptions {
  /**
   * Métrica selecionada no painel.
   *
   * Valor fora da união resolve para `FILA`, que é o padrão do painel e a
   * direção segura: zero hachuras, e nenhuma informação escondida — a classe e
   * os horários continuam no rodapé.
   */
  readonly metrica: MetricaBookmap;
  /**
   * Duração do balde em segundos. Usada como limiar de "ao menos um balde" para
   * a hachura inicial. Valor não utilizável adota 60 s.
   */
  readonly baldeSeg?: number;
  /**
   * Formatador de horário dos rótulos. Omitido usa `DEFAULT_COVERAGE_CLOCK`
   * (BRT, sem segundos), que reproduz exatamente a saída da origem.
   *
   * ── ADIÇÃO DA GENERALIZAÇÃO ────────────────────────────────────────────
   *
   * Na origem o fuso era fixo no corpo da função. Aqui ele entra por parâmetro
   * porque o mesmo heatmap pode ser lido por uma mesa em São Paulo, um backtest
   * em UTC e um painel em Chicago — e o rótulo tem de dizer a verdade nos três.
   *
   * Continua **puro**: o formatador é injetado, não construído aqui, então esta
   * função segue sem ler ambiente e sem depender do fuso da máquina. Determinismo
   * preservado — dado o mesmo formatador, a saída é a mesma em qualquer lugar.
   *
   * Use `makeClockFormatter(PRESENTATION_UTC, { withSeconds: false })` para UTC.
   */
  readonly relogio?: ClockFormatter;
}

// ═════════════════════════════════════════════════════════════════════════════
// Auxiliares puros
// ═════════════════════════════════════════════════════════════════════════════

/** Verdadeiro só para número finito — descarta `NaN`, infinitos e não-número. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Verdadeiro só para instante que o formatador aceita.
 *
 * Finitude não basta: valor finito porém fora da faixa de data válida faz o
 * formatador lançar. Rejeitar aqui é o que mantém as funções totais.
 */
function isInstante(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= MAX_EPOCH_MS;
}

/** Normaliza a métrica e responde se o desenho inclui execução. */
function metricaIncluiExecucao(metrica: unknown): boolean {
  return metrica === 'EXECUCAO' || metrica === 'AMBAS';
}

/** Normaliza a duração do balde para milissegundos, sempre positiva. */
function baldeMsDe(baldeSeg: unknown): number {
  const seg = isFiniteNumber(baldeSeg) && baldeSeg > 0 ? baldeSeg : BALDE_SEG_PADRAO;
  return Math.min(Math.max(seg, BALDE_SEG_MIN), BALDE_SEG_MAX) * 1000;
}

/** A classe recebida é uma das quatro conhecidas. */
function classeConhecida(classe: unknown): classe is ClasseCoberturaConhecida {
  return (
    typeof classe === 'string' &&
    (CLASSES_CONHECIDAS as readonly string[]).includes(classe)
  );
}

/**
 * Uma janela de tempo válida — os dois limites presentes e na ordem certa.
 *
 * `deMs === ateMs` é aceito: um dia com um único balde de fila tem extensão
 * nula e não é incoerente. Já `deMs > ateMs` é a incoerência "início posterior
 * ao fim" que o requisito 7.5 nomeia.
 */
function janelaValida(
  deMs: number | null,
  ateMs: number | null,
): { readonly deMs: number; readonly ateMs: number } | null {
  if (!isInstante(deMs) || !isInstante(ateMs)) return null;
  if (deMs > ateMs) return null;
  return { deMs, ateMs };
}

/**
 * Acrescenta uma hachura à lista, se o intervalo tiver duração.
 *
 * Concentra num só lugar o descarte de intervalo degenerado ou invertido, para
 * que o invariante `deMs < ateMs` valha para toda hachura produzida sem depender
 * de cada ponto de chamada repetir a checagem.
 */
function pushHachura(
  destino: HachuraCobertura[],
  deMs: number,
  ateMs: number,
  motivo: MotivoHachura,
): void {
  if (!isInstante(deMs) || !isInstante(ateMs)) return;
  if (ateMs <= deMs) return;
  destino.push({ deMs, ateMs, motivo });
}

// ═════════════════════════════════════════════════════════════════════════════
// Rótulos de horário
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Formata um instante como `'HH:MM BRT'` (ou no fuso do formatador), ou `null`.
 *
 * ── POR QUE DELEGA, E NÃO CONVERTE À MÃO (requisito 7.6) ───────────────────
 *
 * A conversão fica inteira no formatador injetado, que já é puro, já fixa o fuso
 * no próprio formatador de internacionalização e já tem property test provando o
 * sufixo e o deslocamento. Delegar é o que torna esta função independente do
 * fuso da máquina: o resultado é o mesmo com qualquer configuração de ambiente,
 * que é a exigência do núcleo puro e do teste.
 *
 * ⚠️ Este projeto já errou conversão de fuso em ±3 h mais de uma vez, em pontos
 * onde o deslocamento foi somado à mão. Um endpoint tem campo em segundos que
 * precisa de correção e campo em milissegundos que não precisa — a mesma
 * resposta, regras opostas. **Nenhuma aritmética de fuso é feita aqui.** Os
 * limites de cobertura são epoch ms padrão e vão inteiros para o formatador.
 *
 * A dupla checagem — `isInstante` aqui e a sentinela dentro do formatador — é
 * intencional e não é redundância morta: esta função é exportada e chamada
 * direto por consumidor, então não pode confiar que o formatador recebido seja
 * o da biblioteca. Um formatador de terceiro que lance para `NaN` não derruba
 * o desenho por causa desta guarda.
 *
 * @param ms      Instante em epoch ms, ou nulo/ausente.
 * @param relogio Formatador; omitido usa BRT sem segundos (saída da origem).
 */
export function formatCoverageClock(
  ms: number | null | undefined,
  relogio: ClockFormatter = DEFAULT_COVERAGE_CLOCK,
): string | null {
  if (!isInstante(ms)) return null;
  try {
    return relogio(ms);
  } catch {
    return null;
  }
}

/** Monta `rótulo–rótulo` com o prefixo, ou o texto de ausência. */
function faixaDe(prefixo: string, de: string | null, ate: string | null): string {
  if (de === null && ate === null) return `${prefixo} ${HORARIO_AUSENTE}`;
  return `${prefixo} ${de ?? HORARIO_AUSENTE}–${ate ?? HORARIO_AUSENTE}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Textos ao operador
// ═════════════════════════════════════════════════════════════════════════════

const TEXTO_NAO_VERIFICADA =
  'Cobertura não verificada — a resposta não trouxe informação suficiente para ' +
  'confirmar até onde há fila e execução no dia. As células recebidas seguem ' +
  'desenhadas; a ausência de hachura aqui não afirma cobertura completa.';

const TEXTO_FILA_SEM_EXEC =
  'Somente fila em repouso neste dia — nenhuma execução foi capturada. A ' +
  'ausência de bolha de negócio é ausência de captura, não ausência de negócio.';

const TEXTO_VAZIA_PADRAO =
  'O dia consultado não está materializado — não há célula para desenhar. ' +
  'Rodar o agregador de profundidade para o dia, fora do pregão.';

const TEXTO_EXEC_PARCIAL =
  'O trecho hachurado tem fila e nenhuma execução capturada: é dado faltando, ' +
  'não mercado parado.';

/** Rótulo curto da classe, para a linha de rodapé. */
function rotuloClasse(classe: ClasseCoberturaConhecida | null): string {
  switch (classe) {
    case 'COMPLETA':
      return 'Cobertura completa';
    case 'EXEC_PARCIAL':
      return 'Cobertura parcial da execução';
    case 'FILA_SEM_EXEC':
      return 'Somente fila';
    case 'VAZIA':
      return 'Dia não materializado';
    default:
      return 'Cobertura não verificada';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// A função principal
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Traduz o objeto de cobertura em hachuras e rótulos.
 *
 * ── AS REGRAS, POR CLASSE ─────────────────────────────────────────────────
 *
 * | classe | hachuras | células | aviso |
 * |---|---|---|---|
 * | `COMPLETA` | zero | desenha | nenhum |
 * | `EXEC_PARCIAL` | trecho inicial e trecho final sem execução | desenha | sim |
 * | `FILA_SEM_EXEC` | toda a extensão da fila | desenha | sim |
 * | `VAZIA` | zero | **não desenha** | sim, com o comando do agregador |
 * | ausente / desconhecida / incoerente | zero | desenha | não verificada |
 *
 * ── A CONDIÇÃO DE "AO MENOS UM BALDE", E ONDE ELA NÃO SE APLICA ────────────
 *
 * O trecho INICIAL — do começo da fila ao começo da execução — só é hachurado
 * quando a diferença alcança um balde. Abaixo disso é a defasagem normal entre o
 * primeiro evento de livro e o primeiro negócio do dia, e hachurar isso marcaria
 * de âmbar a abertura de todo pregão, gastando o sinal que precisa significar
 * algo.
 *
 * O trecho FINAL — do fim da execução ao fim da fila — é hachurado sempre que
 * tiver duração, sem limiar de balde. É deliberado e é o caso que importa: são as
 * ~6 h faltando em 100% dos pregões medidos, e a propriedade de correção da
 * tarefa 4.4 exige exatamente a hachura em `[execAteMs, filaAteMs]`.
 *
 * ── POR QUE `COMPLETA` NÃO PASSA PELA CHECAGEM DE COERÊNCIA ───────────────
 *
 * O requisito 7.5 condiciona a marca de "não verificada" aos limites
 * **necessários ao desenho da hachura**. Em `COMPLETA` nenhuma hachura é
 * desenhada, logo nenhum limite é necessário e a checagem não se aplica.
 *
 * Não é detalhe formal: o produtor da classe admite folga entre o fim da
 * execução e o fim da fila, e classifica como `COMPLETA` até um dia em que a
 * execução termina alguns minutos DEPOIS do último evento de livro. Submeter
 * `COMPLETA` à coerência transformaria essa resposta correta num alarme falso de
 * cobertura não verificada — e alarme falso recorrente é o caminho mais rápido
 * para o operador parar de ler o rodapé.
 *
 * ── DETERMINISMO ──────────────────────────────────────────────────────────
 *
 * Saída é função exclusiva das entradas, incluindo os textos. Não lê relógio,
 * não sorteia, não consulta ambiente e não guarda estado entre chamadas. O fuso
 * dos rótulos é fixado no formatador, então o resultado é idêntico em qualquer
 * máquina.
 *
 * Nunca lança: entrada malformada resolve para cobertura não verificada.
 *
 * @param cobertura Objeto `cobertura` da resposta, ou `null` quando ausente.
 * @param opts      Métrica selecionada e duração do balde.
 */
export function computeCoverageView(
  cobertura: CoberturaHeatmap | null | undefined,
  opts: CoverageViewOptions,
): CoverageView {
  const incluiExecucao = metricaIncluiExecucao(opts?.metrica);
  const baldeMs = baldeMsDe(opts?.baldeSeg);

  // ── rótulos: montados a partir do que veio, independente da validação ──
  //
  // Horário informado é fato da resposta e vai para a tela mesmo quando a
  // cobertura não pôde ser verificada — esconder o que se sabe não ajuda quem
  // precisa entender o que está faltando. O que a validação decide é se a
  // HACHURA é desenhada e se a classe é afirmada, não se o dado recebido é
  // exibido.
  const relogio = opts?.relogio ?? DEFAULT_COVERAGE_CLOCK;
  const filaDe = formatCoverageClock(cobertura?.filaDeMs, relogio);
  const filaAte = formatCoverageClock(cobertura?.filaAteMs, relogio);
  const execDe = formatCoverageClock(cobertura?.execDeMs, relogio);
  const execAte = formatCoverageClock(cobertura?.execAteMs, relogio);

  const classe = classeConhecida(cobertura?.classe) ? cobertura.classe : null;

  const faixaFila = faixaDe('fila', filaDe, filaAte);
  const faixaExec =
    execDe === null && execAte === null && classe === 'FILA_SEM_EXEC'
      ? 'sem execução capturada'
      : faixaDe('execução', execDe, execAte);

  const montar = (
    verificada: boolean,
    hachuras: readonly HachuraCobertura[],
    desenhaCelulas: boolean,
    aviso: string | null,
  ): CoverageView => ({
    classe,
    verificada,
    hachuras,
    desenhaCelulas,
    rotulos: {
      filaDe,
      filaAte,
      execDe,
      execAte,
      faixaFila,
      faixaExec,
      resumo: [rotuloClasse(verificada ? classe : null), faixaFila, faixaExec].join(SEP),
    },
    aviso,
  });

  // ── classe ausente ou desconhecida (requisito 7.5) ──
  if (classe === null) {
    return montar(false, [], true, TEXTO_NAO_VERIFICADA);
  }

  // ── VAZIA: nada a desenhar, e o motivo vem escrito (requisito 7.4) ──
  //
  // Precede a validação de limites de propósito: um dia sem célula não tem
  // extensão de fila nem de execução, então exigir limites aqui marcaria toda
  // resposta `VAZIA` como não verificada e engoliria o aviso que traz o comando
  // do agregador — que é justamente a informação acionável do caso.
  if (classe === 'VAZIA') {
    const observacao =
      typeof cobertura?.observacao === 'string' && cobertura.observacao.trim() !== ''
        ? cobertura.observacao
        : TEXTO_VAZIA_PADRAO;
    return montar(true, [], false, observacao);
  }

  // ── COMPLETA: zero hachuras, sem checagem de coerência (requisito 7.1) ──
  if (classe === 'COMPLETA') {
    return montar(true, [], true, null);
  }

  // Daqui para baixo a hachura depende da extensão da fila, então ela passa a
  // ser limite necessário — e sua ausência ou incoerência cai em 7.5.
  const fila = janelaValida(cobertura?.filaDeMs ?? null, cobertura?.filaAteMs ?? null);
  if (fila === null) {
    // ⚠️ O aviso de `FILA_SEM_EXEC` é dever PERMANENTE da classe (requisito 7.3),
    // não consequência de a hachura ter sido calculada. Sem esta composição, um
    // dia sem execução alguma cujos limites de fila chegassem quebrados
    // exibiria apenas "não verificada" — e a informação mais importante da tela,
    // a de que não há execução capturada neste dia, seria perdida justamente no
    // caso em que menos se sabe.
    return montar(
      false,
      [],
      true,
      classe === 'FILA_SEM_EXEC'
        ? `${TEXTO_FILA_SEM_EXEC} ${TEXTO_NAO_VERIFICADA}`
        : TEXTO_NAO_VERIFICADA,
    );
  }

  // ── FILA_SEM_EXEC: o dia inteiro conta como sem execução (requisito 7.3) ──
  if (classe === 'FILA_SEM_EXEC') {
    const hachuras: HachuraCobertura[] = [];
    // A métrica gate apenas o DESENHO (requisito 7.7); o aviso permanece, porque
    // "este dia não tem execução capturada" é informação verdadeira e útil
    // mesmo quando a execução não está sendo desenhada.
    if (incluiExecucao) {
      pushHachura(hachuras, fila.deMs, fila.ateMs, 'DIA_SEM_EXECUCAO');
    }
    return montar(true, hachuras, true, TEXTO_FILA_SEM_EXEC);
  }

  // ── EXEC_PARCIAL: o caso normal, não a exceção (requisito 7.2) ──
  const exec = janelaValida(cobertura?.execDeMs ?? null, cobertura?.execAteMs ?? null);
  // Execução terminando depois da fila é a segunda incoerência que o requisito
  // 7.5 nomeia: o trecho final ficaria invertido, e desenhar intervalo invertido
  // é pior que não desenhar.
  if (exec === null || exec.ateMs > fila.ateMs) {
    return montar(false, [], true, TEXTO_NAO_VERIFICADA);
  }

  const hachuras: HachuraCobertura[] = [];
  if (incluiExecucao) {
    // Trecho inicial — só a partir de um balde de diferença. Execução começando
    // ANTES da fila dá diferença negativa e nenhuma hachura, sem que isso seja
    // tratado como incoerência: o requisito nomeia duas incoerências, e esta não
    // é uma delas.
    if (exec.deMs - fila.deMs >= baldeMs) {
      pushHachura(hachuras, fila.deMs, exec.deMs, 'ANTES_DA_EXECUCAO');
    }
    // Trecho final — sem limiar de balde. É o intervalo que a propriedade da
    // tarefa 4.4 exige e o que corresponde às ~6 h medidas.
    pushHachura(hachuras, exec.ateMs, fila.ateMs, 'DEPOIS_DA_EXECUCAO');
  }

  return montar(true, hachuras, true, TEXTO_EXEC_PARCIAL);
}
