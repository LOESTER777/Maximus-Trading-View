/**
 * layout-templates.core — SETUPS NOMEADOS, em núcleo puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Já havia `serializeChartState`: um documento com tudo o que está no gráfico (tipo de série,
 * indicadores com parâmetros, alertas, desenhos, viewport). Mas havia UM lugar para guardar —
 * salvar sobrescrevia o anterior.
 *
 * ⭐ E um operador de verdade não tem um setup: tem vários, e troca entre eles pelo mesmo
 * ativo. "Fluxo" (bookmap, footprint, delta), "tendência" (médias, ADX, períodos maiores),
 * "abertura" (níveis do dia anterior, VWAP). Sem nome, cada troca é reconstruir tudo à mão —
 * e é justamente no meio do pregão que ninguém tem tempo para isso.
 *
 * ⚠️ `.core` = PURO: nenhuma persistência aqui. O armazenamento é INJETADO pelo consumidor
 * (`localStorage`, `IndexedDB`, um servidor). Este módulo decide o que é um nome válido, como
 * a coleção muda e como ela sobrevive a uma leitura corrompida — e nada mais. O relógio
 * também entra por parâmetro, senão o teste teria de congelar tempo global.
 */

/** O documento de estado, tratado como bloco OPACO. */
export type DocumentoDeLayout = Readonly<Record<string, unknown>>;

export interface TemplateDeLayout {
  /** O nome como o operador digitou (com maiúsculas e acentos preservados). */
  readonly nome: string;
  /** Epoch em segundos da criação. */
  readonly criadoEm: number;
  /** Epoch em segundos da última sobrescrita. */
  readonly atualizadoEm: number;
  readonly documento: DocumentoDeLayout;
}

export type ColecaoDeTemplates = readonly TemplateDeLayout[];

/**
 * Versão do formato da COLEÇÃO — distinta da versão do documento de estado.
 *
 * ⚠️ São duas versões porque são duas coisas que mudam por motivos diferentes: acrescentar um
 * campo ao estado do gráfico não muda como a lista de templates é guardada, e vice-versa. Uma
 * versão só obrigaria a migrar tudo por qualquer mudança.
 */
export const TEMPLATES_SCHEMA_VERSION = 1;

/** Teto de templates. Ver `salvarTemplate`. */
export const MAX_TEMPLATES = 50;

/** Tamanho máximo do nome, em caracteres. */
export const MAX_NOME = 48;

/**
 * O nome normalizado para COMPARAÇÃO, ou `null` quando o nome é inutilizável.
 *
 * ⭐ Normalizar só para comparar, e GUARDAR como foi digitado: o operador que escreveu
 * `"Fluxo Manhã"` quer ver `"Fluxo Manhã"` na lista, não `"fluxo manha"`. Mas salvar
 * `"fluxo manhã"` em cima de `"Fluxo Manhã"` tem de sobrescrever, e não criar um segundo
 * template que ele não distingue na tela.
 *
 * ⚠️ Espaço repetido é colapsado: `"Fluxo  Manhã"` e `"Fluxo Manhã"` são o MESMO nome para
 * quem olha, e dois itens visualmente idênticos na lista é o pior desfecho possível — o
 * operador carrega um e não entende por que o setup está errado.
 */
export function normalizarNome(nome: unknown): string | null {
  if (typeof nome !== 'string') return null;
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (limpo.length === 0) return null;
  // ⚠️ Nome longo é RECORTADO e não recusado: o operador digitou algo, e recusar em silêncio
  // faria o botão "salvar" não fazer nada. Recortar preserva a intenção.
  //
  // ⭐⭐ ACENTO é DOBRADO junto com a caixa, e o teste é que trouxe isto à tona: sem a dobra,
  // `"Fluxo Manhã"` e `"Fluxo Manha"` seriam DOIS templates — e é exactamente o par que um
  // operador com pressa produz. Duas linhas quase idênticas na lista é o desfecho que esta
  // normalização existe para evitar: ele carrega uma, o setup vem errado, e não há nada na
  // tela que explique por quê.
  //
  // ⚠️ `NFD` separa a letra do sinal diacrítico e o intervalo `\u0300-\u036f` remove os
  // sinais. É biblioteca padrão — nenhuma dependência nova para uma comparação de nome.
  return limpo
    .slice(0, MAX_NOME)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

/** O nome de exibição: aparado e com espaço colapsado, mas com a grafia original. */
export function nomeDeExibicao(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').slice(0, MAX_NOME);
}

/** Acha um template por nome, ignorando caixa e espaço repetido. */
export function acharTemplate(
  colecao: ColecaoDeTemplates,
  nome: string,
): TemplateDeLayout | null {
  const chave = normalizarNome(nome);
  if (chave === null) return null;
  return colecao.find((t) => normalizarNome(t.nome) === chave) ?? null;
}

/** Resultado de uma operação sobre a coleção. */
export type ResultadoDeTemplate =
  | { readonly ok: true; readonly colecao: ColecaoDeTemplates; readonly sobrescreveu: boolean }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa };

/** Por que uma operação foi recusada. União fechada: cada motivo tem uma mensagem própria. */
export type MotivoDeRecusa = 'NOME_VAZIO' | 'LIMITE_ATINGIDO' | 'DOCUMENTO_INVALIDO';

/**
 * Salva (ou sobrescreve) um template. Devolve uma coleção NOVA.
 *
 * ⚠️ **Sobrescrever é o comportamento certo, e ele é RELATADO** (`sobrescreveu`). Recusar
 * nome repetido obrigaria o operador a inventar `"Fluxo 2"` para atualizar o setup que ele já
 * tem — que é o caso mais comum de uso. Mas sobrescrever em silêncio destrói trabalho, então
 * quem chama recebe o sinal e decide se confirma.
 *
 * ⚠️ **`criadoEm` é PRESERVADO na sobrescrita.** É o único jeito de a lista poder ser ordenada
 * por antiguidade de forma estável; se ele fosse redefinido, salvar por cima faria o template
 * "pular" na ordenação e o operador procuraria onde ele estava.
 *
 * ⚠️ O teto existe porque a lista é para ESCOLHER: com 200 nomes ela deixa de ser uma escolha
 * e passa a ser uma busca. E porque `localStorage` tem limite de alguns megabytes — estourá-lo
 * lança na hora de gravar, com o setup já perdido.
 */
export function salvarTemplate(
  colecao: ColecaoDeTemplates,
  nome: string,
  documento: DocumentoDeLayout,
  agoraSegundos: number,
): ResultadoDeTemplate {
  const chave = normalizarNome(nome);
  if (chave === null) return { ok: false, motivo: 'NOME_VAZIO' };
  if (typeof documento !== 'object' || documento === null || Array.isArray(documento)) {
    return { ok: false, motivo: 'DOCUMENTO_INVALIDO' };
  }
  const agora = Number.isFinite(agoraSegundos) ? Math.floor(agoraSegundos) : 0;

  const existente = colecao.find((t) => normalizarNome(t.nome) === chave);
  if (existente !== undefined) {
    return {
      ok: true,
      sobrescreveu: true,
      colecao: colecao.map((t) =>
        t === existente
          ? {
              // O nome de EXIBIÇÃO passa a ser o que o operador digitou agora: se ele corrigiu
              // a caixa, é isso que ele quer ver na lista.
              nome: nomeDeExibicao(nome),
              criadoEm: existente.criadoEm,
              atualizadoEm: agora,
              documento,
            }
          : t,
      ),
    };
  }

  if (colecao.length >= MAX_TEMPLATES) return { ok: false, motivo: 'LIMITE_ATINGIDO' };
  return {
    ok: true,
    sobrescreveu: false,
    colecao: [
      ...colecao,
      { nome: nomeDeExibicao(nome), criadoEm: agora, atualizadoEm: agora, documento },
    ],
  };
}

/**
 * Remove um template. Nome inexistente devolve a MESMA coleção (por referência).
 *
 * ⭐ Devolver a mesma referência não é economia: é o sinal de "nada mudou" que um consumidor
 * React usa para não re-renderizar. Devolver uma cópia idêntica faria a lista se repintar a
 * cada tentativa de remover algo que não existe.
 */
export function removerTemplate(colecao: ColecaoDeTemplates, nome: string): ColecaoDeTemplates {
  const chave = normalizarNome(nome);
  if (chave === null) return colecao;
  const filtrada = colecao.filter((t) => normalizarNome(t.nome) !== chave);
  return filtrada.length === colecao.length ? colecao : filtrada;
}

/**
 * Renomeia. Recusa quando o nome novo já existe (aí a operação seria uma FUSÃO silenciosa).
 *
 * ⚠️ Diferente de `salvarTemplate`, que sobrescreve de propósito: ali o operador está dizendo
 * "guarde o estado ATUAL com este nome"; aqui ele está dizendo "troque a etiqueta". Deixar a
 * troca de etiqueta apagar outro template destruiria um setup que ele não estava editando.
 */
export function renomearTemplate(
  colecao: ColecaoDeTemplates,
  de: string,
  para: string,
): ResultadoDeTemplate {
  const chaveNova = normalizarNome(para);
  if (chaveNova === null) return { ok: false, motivo: 'NOME_VAZIO' };
  const origem = acharTemplate(colecao, de);
  if (origem === null) return { ok: false, motivo: 'NOME_VAZIO' };

  const chaveAntiga = normalizarNome(de);
  const colide = colecao.some(
    (t) => normalizarNome(t.nome) === chaveNova && normalizarNome(t.nome) !== chaveAntiga,
  );
  if (colide) return { ok: false, motivo: 'LIMITE_ATINGIDO' };

  return {
    ok: true,
    sobrescreveu: false,
    colecao: colecao.map((t) => (t === origem ? { ...t, nome: nomeDeExibicao(para) } : t)),
  };
}

/** A coleção ordenada para EXIBIÇÃO: mais recentemente usada primeiro. */
export function ordenarParaExibicao(colecao: ColecaoDeTemplates): ColecaoDeTemplates {
  // ⚠️ Por `atualizadoEm` e não por nome: o setup que se usou por último é o mais provável de
  // ser usado de novo, e ordem alfabética faria o operador procurar sempre. Empate cai no nome
  // para a ordem ser DETERMINÍSTICA — sem isso, dois templates salvos no mesmo segundo
  // trocariam de lugar entre renderizações.
  return [...colecao].sort(
    (a, b) => b.atualizadoEm - a.atualizadoEm || a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Serialização
// ═════════════════════════════════════════════════════════════════════════════

export interface DocumentoDeTemplates {
  readonly version: number;
  readonly templates: ColecaoDeTemplates;
}

export function serializarTemplates(colecao: ColecaoDeTemplates): DocumentoDeTemplates {
  return { version: TEMPLATES_SCHEMA_VERSION, templates: colecao };
}

export interface LeituraDeTemplates {
  readonly colecao: ColecaoDeTemplates;
  /**
   * O que foi descartado, em pt-BR. Vazio = leitura íntegra.
   *
   * ⚠️ Descartar em SILÊNCIO seria o pior desfecho: o operador abriria a lista, veria um
   * template a menos e não teria como saber se ele nunca foi salvo ou se foi perdido.
   */
  readonly avisos: readonly string[];
}

/**
 * Lê a coleção de um valor desconhecido. NUNCA lança.
 *
 * ⚠️ A entrada vem de armazenamento externo — ela pode estar truncada (cota estourada no meio
 * da gravação), de uma versão futura, ou editada à mão. Lançar aqui derrubaria a aplicação na
 * montagem, e o operador perderia o acesso a TODOS os templates por causa de um corrompido.
 * Item inválido é descartado com aviso; a coleção sobrevive.
 */
export function desserializarTemplates(bruto: unknown): LeituraDeTemplates {
  const avisos: string[] = [];
  if (typeof bruto !== 'object' || bruto === null) {
    return { colecao: [], avisos: ['Nada salvo, ou o formato é irreconhecível.'] };
  }
  const doc = bruto as { version?: unknown; templates?: unknown };
  if (doc.version !== TEMPLATES_SCHEMA_VERSION) {
    // ⚠️ Versão diferente não é lida "na sorte": campos com o mesmo nome e outro significado
    // produziriam um setup silenciosamente errado, que é pior que setup nenhum.
    return {
      colecao: [],
      avisos: [`Formato de templates versão ${String(doc.version)} não é reconhecido.`],
    };
  }
  if (!Array.isArray(doc.templates)) {
    return { colecao: [], avisos: ['A lista de templates não é uma lista.'] };
  }

  const vistos = new Set<string>();
  const colecao: TemplateDeLayout[] = [];
  for (const item of doc.templates) {
    if (typeof item !== 'object' || item === null) {
      avisos.push('Um template foi descartado: não é um objeto.');
      continue;
    }
    const t = item as Partial<TemplateDeLayout>;
    const chave = normalizarNome(t.nome);
    if (chave === null) {
      avisos.push('Um template foi descartado: nome ausente ou vazio.');
      continue;
    }
    if (vistos.has(chave)) {
      // Duplicata só pode vir de arquivo editado à mão. Manter as duas daria dois itens
      // visualmente idênticos na lista.
      avisos.push(`"${nomeDeExibicao(String(t.nome))}" aparecia duas vezes; a segunda foi descartada.`);
      continue;
    }
    if (typeof t.documento !== 'object' || t.documento === null || Array.isArray(t.documento)) {
      avisos.push(`"${nomeDeExibicao(String(t.nome))}" foi descartado: documento inválido.`);
      continue;
    }
    if (colecao.length >= MAX_TEMPLATES) {
      avisos.push(`Acima de ${MAX_TEMPLATES} templates; o resto foi descartado.`);
      break;
    }
    vistos.add(chave);
    const criado = Number(t.criadoEm);
    const atualizado = Number(t.atualizadoEm);
    colecao.push({
      nome: nomeDeExibicao(String(t.nome)),
      // Data ausente vira 0 em vez de "agora": inventar a data faria a ordenação por uso
      // recente mentir, e 0 põe o template no fim da lista, que é honesto para "não sei
      // quando".
      criadoEm: Number.isFinite(criado) ? criado : 0,
      atualizadoEm: Number.isFinite(atualizado) ? atualizado : 0,
      documento: t.documento as DocumentoDeLayout,
    });
  }
  return { colecao, avisos };
}
