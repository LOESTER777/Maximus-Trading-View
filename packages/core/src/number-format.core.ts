/**
 * number-format — formatacao PURA de numero para rotulo de tela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os nucleos copiados da origem chamavam `Number.prototype.toLocaleString('pt-BR')`
 * direto no corpo, em tres pontos de `footprint-aggregate.core.ts`. Numa
 * aplicacao de mesa brasileira isso e correto e invisivel. Numa biblioteca que
 * qualquer ferramenta consome, e um idioma cravado no meio da regra de negocio.
 *
 * Diferente do fuso (ver `instant-format.core.ts`, onde o layout e fixo de
 * proposito), aqui o locale E um eixo legitimo: `1234567` vira `1.234.567` em
 * pt-BR e `1,234,567` em en-US, e as duas saidas estao certas para o seu
 * publico. Entao este modulo expoe o locale como parametro de verdade.
 *
 * Regras de pureza: sem DOM, sem relogio, sem estado de modulo. Mesma entrada,
 * mesma saida — dado um mesmo motor de internacionalizacao.
 */

/** Locale default da biblioteca. Mercado de origem e B3. */
export const DEFAULT_NUMBER_LOCALE = 'pt-BR';

/**
 * Formatador de numero pronto para injecao.
 *
 * Assinatura minima de proposito: os nucleos que o recebem precisam formatar
 * contagem de contrato, nao moeda. Quem precisa de moeda passa um formatador
 * proprio — o tipo aceita qualquer implementacao.
 */
export type NumberFormatter = (value: number) => string;

/**
 * Formata um numero como inteiro agrupado, tolerando entrada nao-finita.
 *
 * `NaN` e `Infinity` viram `'—'` em vez de vazar `"NaN"` para a tela. Rotulo de
 * diagnostico com `NaN` visivel foi confundido com preco em revisao mais de uma
 * vez; travessao e inequivoco.
 */
export function formatCount(value: number, locale: string = DEFAULT_NUMBER_LOCALE): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return Math.round(value).toLocaleString(locale);
  } catch {
    // Locale invalido -> nao perde o numero, so perde o agrupamento.
    return String(Math.round(value));
  }
}

/**
 * Constroi um `NumberFormatter` amarrado a um locale.
 *
 * @example
 * const fmt = makeCountFormatter('en-US');
 * fmt(1234567); // '1,234,567'
 */
export function makeCountFormatter(locale: string = DEFAULT_NUMBER_LOCALE): NumberFormatter {
  return (value) => formatCount(value, locale);
}

/** Formatador default da biblioteca: inteiro agrupado em pt-BR. */
export const DEFAULT_COUNT_FORMATTER: NumberFormatter = makeCountFormatter();

/**
 * Formata um delta com sinal explicito.
 *
 * O `+` no positivo e obrigatorio e nao e enfeite: num rotulo de delta de
 * agressor, `1.200` sozinho nao diz lado. `+1.200` e `-1.200` dizem.
 */
export function formatSignedCount(
  value: number,
  locale: string = DEFAULT_NUMBER_LOCALE,
): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${formatCount(rounded, locale)}`;
}
