/**
 * chart-workspace.core — ABAS POR ATIVO, cada uma com o SEU estado de gráfico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE, E O QUE JÁ EXISTIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `SymbolTabs` já desenhava a barra de abas, e `serializeChartState` já sabia capturar o
 * estado completo de um gráfico. Faltava o pedaço do meio, que é o que o operador percebe:
 * **uma aba é um DOCUMENTO**. Trocar de aba tem de guardar o que estava na tela e trazer de
 * volta o que estava na outra — desenhos, indicadores, tipo de série.
 *
 * Sem isso a barra de abas é só um seletor de ativo com outra aparência: o operador marca o
 * suporte no WIN, vai ao PETR4, volta, e o suporte não está lá. Pior: as marcações do PETR4
 * continuam no gráfico do WIN, em preços que não existem naquele mercado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ A ORDEM É O DEFEITO — e por isso `trocarDeAba` faz as DUAS coisas
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trocar de aba são duas operações: GRAVAR o documento da aba que sai e ATIVAR a que entra.
 * Se o consumidor as chamar na ordem errada — ativar e depois gravar — o estado vivo já é o
 * da aba nova, e ele é gravado no lugar do da aba antiga. O operador perde o trabalho da aba
 * que acabou de deixar, e a aba nova ganha uma cópia do que ele nem pediu.
 *
 * Esse erro não é hipotético: é a ordem natural de escrever o código (`setAtiva(id)` primeiro,
 * porque é a linha que muda a tela). Então a API **não oferece** os dois passos soltos como
 * caminho normal: `trocarDeAba(estado, id, documentoDaAtual, agora)` recebe o documento da
 * aba corrente como ARGUMENTO. Passar o documento é obrigatório, e o documento só pode ser
 * capturado antes — a assinatura torna a inversão impossível de escrever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ABA NOVA HERDA A ANÁLISE, NÃO AS MARCAÇÕES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `documentoParaAbaNova` mantém o tipo de série e os INDICADORES, e descarta desenhos,
 * alertas e viewport. A distinção é entre o que é agnóstico de instrumento e o que é preso a
 * PREÇO:
 *
 * - EMA de 20 períodos e RSI de 14 significam a mesma coisa em WIN, PETR4 ou BTC. O operador
 *   que montou o seu conjunto de indicadores quer ele em toda aba, e recriar à mão em cada
 *   ativo novo é a fricção que faz ninguém usar abas.
 * - Uma linha horizontal em 130.000 no gráfico da PETR4 (que anda em 32) fica fora da tela, e
 *   se não ficasse seria pior: uma marcação sobre OUTRO mercado, com a autoridade de estar
 *   desenhada neste. O mesmo vale para alerta: nível de um ativo armado no outro dispara na
 *   hora e ensina o operador a ignorar alerta.
 * - Viewport é índice de barra numa série que a aba nova não tem.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `.core` = PURO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nenhuma persistência, nenhum relógio, nenhum id sorteado. O tempo entra por parâmetro
 * (`agora`, epoch em segundos) e o id da aba nova é DERIVADO do conjunto existente
 * (`proximoIdDeAba`) — determinístico, então o teste não precisa congelar nada nem aceitar
 * "algum id".
 */
import {
  serializeChartState,
  deserializeChartState,
  type ChartState,
  type IndicatorState,
} from './chart-state.core.js';

/**
 * Uma aba: o instrumento, o período, e o documento de estado dela.
 *
 * ⭐ `id` é OPACO e ESTÁVEL — não é derivado de `symbol`/`periodSeconds`. Foi tentado
 * derivar (`WIN@300`), e o defeito aparece na primeira troca de período: mudar de M5 para D1
 * mudaria a identidade da aba, e a aba ativa deixaria de existir no meio da operação. O
 * símbolo e o período são ATRIBUTOS de uma aba, não a identidade dela.
 */
export interface AbaDeAtivo {
  readonly id: string;
  /** Símbolo normalizado (maiúsculas, sem espaço). É o que a fonte de dado recebe. */
  readonly symbol: string;
  /** Período em SEGUNDOS. Segundos são a verdade; rótulo é apresentação. */
  readonly periodSeconds: number;
  /**
   * O estado do gráfico desta aba. `null` = nada a aplicar (aba que nunca guardou).
   *
   * ⚠️ `null` NÃO significa "gráfico vazio": significa "não sei". Quem restaura deve DEIXAR
   * COMO ESTÁ em vez de limpar — limpar por não saber apagaria o trabalho do operador.
   */
  readonly documento: ChartState | null;
  /** Epoch em segundos da abertura. */
  readonly abertaEm: number;
  /** Epoch em segundos da última gravação de documento (ou da abertura). */
  readonly atualizadoEm: number;
}

/** A área de trabalho: as abas e qual está na tela. */
export interface EstadoDeAbas {
  readonly abas: readonly AbaDeAtivo[];
  /** Id da aba ativa. Invariante: sempre aponta para uma aba existente. */
  readonly ativa: string;
}

/** O que se pede para abrir. */
export interface PedidoDeAba {
  readonly symbol: string;
  readonly periodSeconds: number;
  /**
   * O documento com que a aba nasce. Normalmente `documentoParaAbaNova(documentoCorrente)`.
   * Ausente/`null` = a aba nasce sem documento e restaurá-la não aplica nada.
   */
  readonly documento?: ChartState | null;
}

/**
 * Versão do formato da ÁREA DE TRABALHO — distinta da versão do documento de estado.
 *
 * ⚠️ Duas versões porque mudam por motivos diferentes: acrescentar um campo ao estado do
 * gráfico não muda como a lista de abas é guardada. Uma versão só obrigaria a migrar tudo a
 * cada mudança de qualquer um dos dois.
 */
export const ABAS_SCHEMA_VERSION = 1;

/**
 * Teto de abas abertas.
 *
 * ⚠️ Não é limite de memória: é de LEITURA. A barra de abas rola na horizontal (ver
 * `SymbolTabs`), e passando de uma dúzia o operador não acha mais a aba que quer — o
 * mecanismo que a aba existe para dar (troca instantânea) deixa de funcionar. Quem precisa
 * de mais ativos na tela ao mesmo tempo usa `ChartGrid`, que é a outra montagem.
 */
export const MAX_ABAS = 12;

/** Tamanho máximo do símbolo, em caracteres. */
export const MAX_SIMBOLO = 24;

/** Período de emergência, quando o pedido traz um período inutilizável. Ver `criarAbas`. */
const PERIODO_PADRAO = 300;

// ═════════════════════════════════════════════════════════════════════════════
// Normalização
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O símbolo pronto para uso, ou `null` quando é inutilizável.
 *
 * ⚠️ Normaliza para MAIÚSCULAS e é isso que fica guardado — diferente do nome de template,
 * que preserva a grafia digitada. Aqui a grafia não é do operador: é o identificador que a
 * fonte de dado recebe, e `win` e `WIN` não são dois instrumentos. Guardar as duas grafias
 * criaria duas abas para o mesmo ativo, com desenhos divididos entre elas.
 */
export function normalizarSimbolo(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null;
  const limpo = symbol.trim().replace(/\s+/g, ' ');
  if (limpo.length === 0) return null;
  return limpo.slice(0, MAX_SIMBOLO).toUpperCase();
}

/** O período é usável? Segundos inteiros e positivos. */
export function periodoValido(periodSeconds: unknown): periodSeconds is number {
  return typeof periodSeconds === 'number' && Number.isInteger(periodSeconds) && periodSeconds > 0;
}

/**
 * O próximo id livre, derivado do conjunto — determinístico e sem relógio.
 *
 * ⚠️ Não reaproveita id de aba fechada. Reaproveitar faria um id já usado voltar, e qualquer
 * coisa que tenha guardado esse id (uma preferência por aba, um log) passaria a falar da aba
 * errada em silêncio.
 */
export function proximoIdDeAba(estado: EstadoDeAbas): string {
  let maior = 0;
  for (const aba of estado.abas) {
    const m = /^aba-(\d+)$/.exec(aba.id);
    if (m === null) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return `aba-${maior + 1}`;
}

/** Esta aba é o mesmo instrumento no mesmo período? */
export function mesmaCombinacao(aba: AbaDeAtivo, symbol: string, periodSeconds: number): boolean {
  return aba.symbol === symbol && aba.periodSeconds === periodSeconds;
}

// ═════════════════════════════════════════════════════════════════════════════
// Construção e consulta
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O estado inicial, com uma aba.
 *
 * ⚠️ Esta função é TOTAL — não devolve resultado de falha. É o construtor do estado inicial
 * da aplicação, e "não foi possível criar a área de trabalho" deixaria a tela sem gráfico e
 * sem caminho de volta. Símbolo inutilizável cai para `'ATIVO'` e período inutilizável cai
 * para 5min: ambos ficam VISÍVEIS na aba, que é como o chamador descobre que passou lixo.
 * Recusar em silêncio é o que não se pode fazer.
 */
export function criarAbas(pedido: PedidoDeAba, agora: number): EstadoDeAbas {
  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const aba: AbaDeAtivo = {
    id: 'aba-1',
    symbol: normalizarSimbolo(pedido.symbol) ?? 'ATIVO',
    periodSeconds: periodoValido(pedido.periodSeconds) ? pedido.periodSeconds : PERIODO_PADRAO,
    documento: pedido.documento ?? null,
    abertaEm: quando,
    atualizadoEm: quando,
  };
  return { abas: [aba], ativa: aba.id };
}

/** A aba ativa, ou `null` se o estado estiver incoerente (não deve acontecer). */
export function abaAtiva(estado: EstadoDeAbas): AbaDeAtivo | null {
  return estado.abas.find((a) => a.id === estado.ativa) ?? null;
}

/** A aba de um id, ou `null`. */
export function acharAba(estado: EstadoDeAbas, id: string): AbaDeAtivo | null {
  return estado.abas.find((a) => a.id === id) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Abrir
// ═════════════════════════════════════════════════════════════════════════════

export type ResultadoDeAbertura =
  | {
      readonly ok: true;
      readonly estado: EstadoDeAbas;
      /** O id da aba que passou a ser a ativa. */
      readonly id: string;
      /** `false` quando a combinação já existia e foi apenas ATIVADA. */
      readonly criou: boolean;
      /**
       * A aba que entrou, já dentro do estado NOVO. Mesmo papel do `destino` de
       * `trocarDeAba`: o consumidor aplica o documento dela sem procurar no estado antigo.
       */
      readonly destino: AbaDeAtivo;
    }
  | { readonly ok: false; readonly motivo: string };

/**
 * Abre uma aba, ou ATIVA a que já cobre essa combinação.
 *
 * ⭐ Idempotente por CONTEÚDO (símbolo + período), embora a identidade seja o id. O operador
 * que escolhe "PETR4" no seletor duas vezes quer ir ao PETR4 — não quer duas abas iguais que
 * ele não distingue na barra. Já o MESMO ativo em DOIS períodos são duas abas legítimas
 * (WIN em M5 para executar, WIN em D1 para contexto), e é por isso que o período entra na
 * comparação.
 *
 * ⚠️ Abrir NÃO grava o documento da aba corrente. Quem abre uma aba nova a partir da tela
 * atual deve chamar `gravarDocumento` na ativa antes, ou usar `abrirEtrocar`.
 */
export function abrirAba(
  estado: EstadoDeAbas,
  pedido: PedidoDeAba,
  agora: number,
): ResultadoDeAbertura {
  const symbol = normalizarSimbolo(pedido.symbol);
  if (symbol === null) return { ok: false, motivo: 'símbolo vazio ou inválido' };
  if (!periodoValido(pedido.periodSeconds)) {
    return { ok: false, motivo: 'período deve ser inteiro de segundos positivo' };
  }

  const existente = estado.abas.find((a) => mesmaCombinacao(a, symbol, pedido.periodSeconds));
  if (existente !== undefined) {
    // Já existe: ativa. E devolve a MESMA referência de estado quando ela já era a ativa —
    // sinal de "não re-renderize".
    return {
      ok: true,
      estado: existente.id === estado.ativa ? estado : { ...estado, ativa: existente.id },
      id: existente.id,
      criou: false,
      destino: existente,
    };
  }

  if (estado.abas.length >= MAX_ABAS) {
    // ⚠️ Recusa em vez de fechar a mais antiga: fechar descartaria o documento de uma aba que
    // o operador pode ter passado o pregão montando, por causa de um clique num seletor.
    return { ok: false, motivo: `limite de ${MAX_ABAS} abas alcançado` };
  }

  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const nova: AbaDeAtivo = {
    id: proximoIdDeAba(estado),
    symbol,
    periodSeconds: pedido.periodSeconds,
    documento: pedido.documento ?? null,
    abertaEm: quando,
    atualizadoEm: quando,
  };
  return {
    ok: true,
    estado: { abas: [...estado.abas, nova], ativa: nova.id },
    id: nova.id,
    criou: true,
    destino: nova,
  };
}

/**
 * Abre (ou ativa) uma aba GRAVANDO antes o documento da aba corrente, e herdando a análise.
 *
 * ⭐⭐ É a irmã de `trocarDeAba`, e existe pelo mesmo motivo: abrir uma aba a partir da tela
 * atual é a mesma armadilha de ordem. Quem escreve `abrirAba(...)` e só depois lembra de
 * gravar já perdeu o documento da aba que estava na tela.
 *
 * O documento da aba nova sai de `documentoParaAbaNova(documentoDaAtual)` — indicadores e tipo
 * de série vêm, marcações não — a menos que `pedido.documento` seja informado explicitamente.
 *
 * @param documentoDaAtual O estado vivo, capturado ANTES. `null` = não gravar e não herdar.
 */
export function abrirEtrocar(
  estado: EstadoDeAbas,
  pedido: PedidoDeAba,
  documentoDaAtual: ChartState | null,
  agora: number,
): ResultadoDeAbertura {
  const gravado =
    documentoDaAtual === null ? estado : gravarDocumento(estado, estado.ativa, documentoDaAtual, agora);
  return abrirAba(
    gravado,
    {
      symbol: pedido.symbol,
      periodSeconds: pedido.periodSeconds,
      documento: pedido.documento ?? documentoParaAbaNova(documentoDaAtual),
    },
    agora,
  );
}

/**
 * Duplica uma aba: mesmo instrumento, mesmo período, MESMO documento.
 *
 * ⭐ É o único caminho que produz duas abas com a mesma combinação, e existe porque sem ele
 * "o mesmo ativo em dois períodos" é INALCANÇÁVEL pela interface. A sequência é: duplicar e
 * então mudar o período da cópia. `abrirAba` deduplica por conteúdo (o operador que escolhe
 * PETR4 duas vezes quer ir ao PETR4), então a duplicação tem de ser um pedido EXPLÍCITO —
 * e sendo explícito, não é ambíguo e não precisa ser recusado.
 *
 * ⭐ A cópia leva o DOCUMENTO, e não a análise herdada de `documentoParaAbaNova`: é o mesmo
 * instrumento. Descartar os desenhos aqui seria descartar marcações de preço que valem
 * exatamente para o ativo da cópia — o oposto do caso da aba de outro ativo.
 *
 * @param documentoDaAtual O estado vivo. Gravado antes de copiar quando `id` é a aba ATIVA,
 *   senão a cópia sairia com o documento da última troca em vez do que está na tela.
 */
export function duplicarAba(
  estado: EstadoDeAbas,
  id: string,
  documentoDaAtual: ChartState | null,
  agora: number,
): ResultadoDeAbertura {
  const base = acharAba(estado, id);
  if (base === null) return { ok: false, motivo: 'aba não encontrada' };
  if (estado.abas.length >= MAX_ABAS) {
    return { ok: false, motivo: `limite de ${MAX_ABAS} abas alcançado` };
  }

  const comAtual =
    id === estado.ativa && documentoDaAtual !== null
      ? gravarDocumento(estado, id, documentoDaAtual, agora)
      : estado;
  const origem = acharAba(comAtual, id) as AbaDeAtivo;

  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const copia: AbaDeAtivo = {
    id: proximoIdDeAba(comAtual),
    symbol: origem.symbol,
    periodSeconds: origem.periodSeconds,
    documento: origem.documento,
    abertaEm: quando,
    atualizadoEm: quando,
  };
  return {
    ok: true,
    estado: { abas: [...comAtual.abas, copia], ativa: copia.id },
    id: copia.id,
    criou: true,
    destino: copia,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Trocar — a operação em que a ordem importa
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoDeTroca {
  readonly estado: EstadoDeAbas;
  /**
   * A aba que entrou. `null` quando nada trocou (id desconhecido, ou já era a ativa).
   *
   * ⭐ Devolver a aba de DESTINO é o que dá ao consumidor o documento a aplicar sem ele ter
   * de procurar no estado novo — e sem risco de procurar no estado ANTIGO por engano.
   */
  readonly destino: AbaDeAtivo | null;
}

/**
 * Grava o documento da aba corrente e ativa outra, **nesta ordem**, num só passo.
 *
 * ⭐⭐ É a função que existe para a inversão de ordem ser inexprimível. Ver o cabeçalho do
 * módulo: ativar antes de gravar grava o estado da aba NOVA no slot da ANTIGA.
 *
 * @param documentoDaAtual O estado vivo, capturado ANTES da troca. `null` = não gravar
 *   (útil quando o gráfico ainda não montou e capturar devolveria um documento vazio que
 *   apagaria o que a aba já tinha).
 */
export function trocarDeAba(
  estado: EstadoDeAbas,
  id: string,
  documentoDaAtual: ChartState | null,
  agora: number,
): ResultadoDeTroca {
  const destinoAntigo = acharAba(estado, id);
  if (destinoAntigo === null || id === estado.ativa) {
    // ⚠️ Trocar para a aba que já está ativa não grava nada. Gravar aqui seria inofensivo hoje,
    // mas transformaria um clique repetido na aba corrente em escrita — e escrita é o que pode
    // dar errado.
    return { estado, destino: null };
  }

  const gravado = documentoDaAtual === null ? estado : gravarDocumento(estado, estado.ativa, documentoDaAtual, agora);
  const novo: EstadoDeAbas = { ...gravado, ativa: id };
  return { estado: novo, destino: acharAba(novo, id) };
}

// ═════════════════════════════════════════════════════════════════════════════
// Gravar, mudar período
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Grava o documento numa aba. Devolve a MESMA referência quando o id não existe.
 *
 * ⚠️ O documento é guardado como veio. `serializeChartState` já copia item por item, então o
 * que chega aqui não compartilha referência com o estado vivo — copiar de novo seria custo
 * sem ganho. O contrato é: quem chama passa a saída de `serializeChartState`, e ninguém muta
 * um documento depois de gravado.
 */
export function gravarDocumento(
  estado: EstadoDeAbas,
  id: string,
  documento: ChartState,
  agora: number,
): EstadoDeAbas {
  const i = estado.abas.findIndex((a) => a.id === id);
  if (i < 0) return estado;
  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const abas = estado.abas.slice();
  abas[i] = { ...(estado.abas[i] as AbaDeAtivo), documento, atualizadoEm: quando };
  return { ...estado, abas };
}

/**
 * Muda o período de uma aba, preservando a identidade dela.
 *
 * ⚠️ NÃO recusa a colisão de conteúdo (duas abas com o mesmo símbolo e período). É diferente
 * de `abrirAba`, que deduplica: aqui o operador está EDITANDO uma aba que ele tem na tela, e
 * recusar a edição por causa de outra aba que ele não está olhando seria inexplicável.
 * Deduplicar fundindo as duas seria pior — descartaria o documento de uma delas.
 */
export function mudarPeriodoDaAba(
  estado: EstadoDeAbas,
  id: string,
  periodSeconds: number,
  agora: number,
): EstadoDeAbas {
  if (!periodoValido(periodSeconds)) return estado;
  const i = estado.abas.findIndex((a) => a.id === id);
  if (i < 0) return estado;
  const atual = estado.abas[i] as AbaDeAtivo;
  if (atual.periodSeconds === periodSeconds) return estado;
  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const abas = estado.abas.slice();
  abas[i] = { ...atual, periodSeconds, atualizadoEm: quando };
  return { ...estado, abas };
}

/** Muda o SÍMBOLO de uma aba, preservando identidade e documento. */
export function mudarSimboloDaAba(
  estado: EstadoDeAbas,
  id: string,
  symbol: string,
  agora: number,
): EstadoDeAbas {
  const limpo = normalizarSimbolo(symbol);
  if (limpo === null) return estado;
  const i = estado.abas.findIndex((a) => a.id === id);
  if (i < 0) return estado;
  const atual = estado.abas[i] as AbaDeAtivo;
  if (atual.symbol === limpo) return estado;
  const quando = Number.isFinite(agora) ? Math.floor(agora) : 0;
  const abas = estado.abas.slice();
  abas[i] = { ...atual, symbol: limpo, atualizadoEm: quando };
  return { ...estado, abas };
}

// ═════════════════════════════════════════════════════════════════════════════
// Fechar
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoDeFechamento {
  readonly estado: EstadoDeAbas;
  readonly fechou: boolean;
  /**
   * A aba ELEITA quando a fechada era a ativa — o consumidor precisa aplicar o documento
   * dela. `null` quando a ativa não mudou (fechou-se uma aba de fundo) ou nada foi fechado.
   *
   * ⭐ Sem este campo o consumidor teria de comparar `estado.ativa` antes e depois para
   * descobrir se precisa restaurar. Comparar é fácil de esquecer, e esquecer deixa a tela
   * mostrando o gráfico da aba que acabou de ser fechada.
   */
  readonly destino: AbaDeAtivo | null;
}

/**
 * Fecha uma aba e elege a próxima ativa quando necessário.
 *
 * ⚠️ RECUSA fechar a última: uma barra de abas vazia deixa a tela sem gráfico e sem caminho
 * de volta. É a mesma razão do `closable: false` em `SymbolTabs`, e está aqui também porque o
 * componente é aparência e esta é a regra.
 *
 * ⭐ Elege o VIZINHO DA DIREITA, caindo para o da esquerda na última posição. É a convenção
 * de aba de navegador e de editor, e a expectativa é forte: ir para o começo da lista faria
 * o operador que fecha três abas em sequência pular de contexto três vezes.
 *
 * Fechar NÃO grava o documento da aba fechada — ela deixa de existir, e gravar num objeto
 * que será descartado é trabalho para nada. ⚠️ E isso torna o fechamento DESTRUTIVO: quem
 * quiser oferecer "reabrir aba fechada" tem de guardar a aba antes de chamar.
 */
export function fecharAba(estado: EstadoDeAbas, id: string): ResultadoDeFechamento {
  const i = estado.abas.findIndex((a) => a.id === id);
  if (i < 0) return { estado, fechou: false, destino: null };
  if (estado.abas.length <= 1) return { estado, fechou: false, destino: null };

  const restantes = estado.abas.filter((a) => a.id !== id);
  if (id !== estado.ativa) {
    // Aba de fundo: a tela não muda, e o consumidor não tem nada a restaurar.
    return { estado: { ...estado, abas: restantes }, fechou: true, destino: null };
  }

  // O vizinho da direita ocupa o mesmo índice na lista de restantes; na última posição,
  // `i` fica fora e cai para o anterior.
  const eleita = (restantes[i] ?? restantes[restantes.length - 1]) as AbaDeAtivo;
  return {
    estado: { abas: restantes, ativa: eleita.id },
    fechou: true,
    destino: eleita,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// O documento com que a aba nova nasce
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O documento herdado por uma aba NOVA: a análise sim, as marcações não.
 *
 * Mantém `priceSeriesType` e `indicators`. Descarta desenhos, alertas, viewport e o símbolo.
 * O porquê de cada descarte está no cabeçalho do módulo.
 *
 * ⚠️ Reusa `serializeChartState` em vez de montar o objeto à mão, e é de propósito: é ele que
 * sabe produzir o documento de desenho VAZIO no formato que o pacote de desenho aceita ler.
 * Montar `{ drawings: {} }` aqui duplicaria esse conhecimento em dois lugares, e o segundo
 * ficaria desatualizado no dia em que o formato mudasse.
 *
 * @param base O documento da aba corrente, ou `null` quando não há de onde herdar.
 */
export function documentoParaAbaNova(base: ChartState | null): ChartState | null {
  if (base === null) return null;
  const indicadores: readonly IndicatorState[] = base.indicators;
  return serializeChartState({
    priceSeriesType: base.priceSeriesType,
    indicators: indicadores,
    // Alerta é nível de PREÇO: herdado, dispararia na hora no ativo novo.
    alerts: [],
    // `drawings` ausente ⇒ documento de desenho vazio, produzido por quem sabe o formato.
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Serialização
// ═════════════════════════════════════════════════════════════════════════════

/** A forma gravada. Estrutura, não texto: quem escolhe `JSON.stringify` é o consumidor. */
export interface AbasSerializadas {
  readonly version: number;
  readonly ativa: string;
  readonly abas: readonly {
    readonly id: string;
    readonly symbol: string;
    readonly periodSeconds: number;
    readonly documento: ChartState | null;
    readonly abertaEm: number;
    readonly atualizadoEm: number;
  }[];
}

export function serializarAbas(estado: EstadoDeAbas): AbasSerializadas {
  return {
    version: ABAS_SCHEMA_VERSION,
    ativa: estado.ativa,
    abas: estado.abas.map((a) => ({
      id: a.id,
      symbol: a.symbol,
      periodSeconds: a.periodSeconds,
      documento: a.documento,
      abertaEm: a.abertaEm,
      atualizadoEm: a.atualizadoEm,
    })),
  };
}

export interface LeituraDeAbas {
  /**
   * O estado lido, ou `null` quando não há NADA aproveitável.
   *
   * ⭐ `null` e não "estado vazio": uma área de trabalho sem aba nenhuma não é uma área de
   * trabalho, e devolver `{abas: [], ativa: ''}` obrigaria todo consumidor a testar o caso
   * degenerado. `null` diz "crie o inicial", que é a única coisa sensata a fazer.
   */
  readonly estado: EstadoDeAbas | null;
  /** Por que cada item caiu. Para log, não para o operador. */
  readonly avisos: readonly string[];
}

/**
 * Lê a área de trabalho de origem não confiável. NUNCA lança.
 *
 * ⚠️ O documento de cada aba passa por `deserializeChartState` — a validação de estado de
 * gráfico não é reimplementada aqui. Aba com documento corrompido sobrevive com o que dele
 * for válido (recusa parcial), em vez de a aba inteira desaparecer: perder o ativo e o
 * período por causa de um indicador mal gravado seria desproporcional.
 *
 * ⚠️ Duplicata de ID cai (dois objetos com o mesmo id fariam `acharAba` responder sempre o
 * primeiro, e o segundo seria inalcançável para sempre). Duplicata de CONTEÚDO fica: pode ter
 * sido produzida por `mudarPeriodoDaAba`, que a permite de propósito.
 */
export function desserializarAbas(bruto: unknown): LeituraDeAbas {
  const avisos: string[] = [];
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { estado: null, avisos: ['documento de abas ausente ou não é objeto'] };
  }
  const doc = bruto as Record<string, unknown>;

  const versao = doc['version'];
  if (typeof versao !== 'number' || !Number.isInteger(versao)) {
    return { estado: null, avisos: ['versão ausente ou não inteira'] };
  }
  if (versao > ABAS_SCHEMA_VERSION) {
    // Documento do FUTURO: recusar por inteiro. Ler parcial e regravar por cima perderia o
    // que a versão nova acrescentou, de forma permanente.
    return {
      estado: null,
      avisos: [`versão ${versao} é mais nova que a suportada (${ABAS_SCHEMA_VERSION})`],
    };
  }

  const lista = doc['abas'];
  if (!Array.isArray(lista)) return { estado: null, avisos: ['lista de abas ausente'] };

  const abas: AbaDeAtivo[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      avisos.push('aba descartada: não é objeto');
      continue;
    }
    const o = item as Record<string, unknown>;
    const id = typeof o['id'] === 'string' && o['id'].length > 0 ? o['id'] : null;
    if (id === null) {
      avisos.push('aba descartada: id ausente');
      continue;
    }
    if (vistos.has(id)) {
      avisos.push(`aba descartada: id repetido (${id})`);
      continue;
    }
    const symbol = normalizarSimbolo(o['symbol']);
    if (symbol === null) {
      avisos.push(`aba ${id} descartada: símbolo inválido`);
      continue;
    }
    if (!periodoValido(o['periodSeconds'])) {
      avisos.push(`aba ${id} descartada: período inválido`);
      continue;
    }

    let documento: ChartState | null = null;
    const bruta = o['documento'];
    if (bruta !== null && bruta !== undefined) {
      const lido = deserializeChartState(bruta);
      documento = lido.state;
      for (const r of lido.reasons) avisos.push(`aba ${id}: ${r}`);
    }

    const abertaEm = inteiroOuZero(o['abertaEm']);
    abas.push({
      id,
      symbol,
      periodSeconds: o['periodSeconds'],
      documento,
      abertaEm,
      // ⚠️ Data ausente vira 0, e não "agora": um núcleo puro não tem relógio, e inventar a
      // data faria a aba parecer recém-tocada na ordenação.
      atualizadoEm: inteiroOuZero(o['atualizadoEm']),
    });
    vistos.add(id);
  }

  if (abas.length === 0) return { estado: null, avisos: [...avisos, 'nenhuma aba válida'] };

  const ativaGravada = doc['ativa'];
  const ativa =
    typeof ativaGravada === 'string' && abas.some((a) => a.id === ativaGravada)
      ? ativaGravada
      : ((): string => {
          // ⚠️ A ativa gravada pode ter sido justamente a aba descartada. Cair para a primeira
          // é obrigatório: a invariante "`ativa` aponta para uma aba existente" é o que
          // permite ao resto do módulo não testar isso em cada função.
          avisos.push('aba ativa gravada não existe; caiu para a primeira');
          return (abas[0] as AbaDeAtivo).id;
        })();

  return { estado: { abas, ativa }, avisos };
}

function inteiroOuZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
}
