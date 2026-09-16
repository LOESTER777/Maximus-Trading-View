/**
 * Núcleo PURO do FOOTPRINT — a matriz preço × (compra/venda) dentro de cada vela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * O `deltaBars` que o gráfico mostra hoje colapsa cada barra em **uma cor**
 * (lado dominante) e **uma altura** (volume total). Isso perde duas informações
 * que decidem trade:
 *
 *   1. **quanto** cada lado agrediu — 60% comprador e 98% comprador pintam do
 *      MESMO verde;
 *   2. **onde** dentro da barra a agressão aconteceu — a altura é a soma dos dois
 *      lados, então "1.000 × 1.000" (briga equilibrada) e "1.900 × 100"
 *      (domínio limpo) desenham a mesma barra.
 *
 * O footprint responde as duas: por nível de preço, quanto foi executado no ask
 * (agressor comprador) e no bid (agressor vendedor).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ ZERO REDE NOVA
 * ═══════════════════════════════════════════════════════════════════════════
 * O insumo é o MESMO `BookmapGrid` que a camada de livro já busca — ele traz
 * `buy`/`sell` por (tempo, preço), que é literalmente a matriz do footprint.
 * Nenhum endpoint novo, nenhum fetch adicional: o footprint é uma LEITURA
 * diferente de um dado que já está no navegador.
 *
 * PURO: zero DOM, zero relógio, zero I/O. Determinístico.
 */

import type { BookmapGrid } from './bookmap-types.js';
import { DEFAULT_COUNT_FORMATTER, type NumberFormatter } from './number-format.core.js';

/** Um nível de preço dentro de uma vela. */
export interface NivelFootprint {
  /** Preço do nível (já agrupado, quando há agrupamento). */
  readonly preco: number;
  /** Execução com agressor COMPRADOR (no ask), em contratos. */
  readonly compra: number;
  /** Execução com agressor VENDEDOR (no bid), em contratos. */
  readonly venda: number;
  /** `compra − venda`. Positivo = comprador agrediu mais neste nível. */
  readonly delta: number;
  /** `compra + venda`. */
  readonly total: number;
  /**
   * Desequilíbrio em [-1, +1]: `delta / total`. É o que separa 60% de 98% —
   * exatamente a informação que a cor única do `deltaBars` destrói.
   */
  readonly desequilibrio: number;
}

/** Uma vela com seu footprint. */
export interface VelaFootprint {
  /** Início da vela, epoch ms (fronteira do timeframe exibido). */
  readonly tempo: number;
  /** Níveis com execução, ordenados por preço CRESCENTE. */
  readonly niveis: readonly NivelFootprint[];
  readonly totalCompra: number;
  readonly totalVenda: number;
  /** `totalCompra − totalVenda`. */
  readonly delta: number;
  /** Preço do nível de MAIOR volume total da vela (`null` se vazia). */
  readonly poc: number | null;
  /** Maior `total` entre os níveis — normaliza a intensidade no desenho. */
  readonly maiorTotal: number;
}

export interface ConfigFootprint {
  /**
   * Tamanho do agrupamento de preço, em unidades de preço. `0` = sem
   * agrupamento (um nível por tick).
   *
   * ⚠️ Existe porque o WIN tem 4.063 níveis distintos num dia — desenhar todos
   * numa vela de 40 px é impossível. O agrupamento é escolhido pelo zoom, e a
   * função de escolha (`agrupamentoPorZoom`) é separada para ser testável.
   */
  readonly agrupamentoPreco: number;
  /**
   * Nível com `total` abaixo desta fração do `maiorTotal` da vela é descartado.
   * Corta a poeira de 1–2 contratos que só suja o desenho.
   */
  readonly fracaoMinima: number;
  /** Máximo de níveis por vela. Mantém os de MAIOR volume. */
  readonly maxNiveis: number;
}

export const CONFIG_FOOTPRINT_DEFAULT: ConfigFootprint = {
  agrupamentoPreco: 0,
  fracaoMinima: 0.02,
  maxNiveis: 40,
};

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Agrupa um preço no múltiplo de `passo` (piso). `passo ≤ 0` devolve o preço.
 *
 * ⚠️ Usa `Math.round` sobre a divisão antes do piso para não sofrer com erro de
 * ponto flutuante: `Math.floor(178475 / 25) * 25` erra quando a divisão dá
 * `7138.999999999999`.
 */
export function agruparPreco(preco: number, passo: number): number {
  if (!fin(preco)) return Number.NaN;
  if (!fin(passo) || passo <= 0) return preco;
  const q = Math.floor(Math.round((preco / passo) * 1e9) / 1e9);
  return q * passo;
}

/**
 * Escolhe o agrupamento de preço a partir do espaço disponível.
 *
 * A conta é direta: se cabem `alturaPx / alturaMinimaLinhaPx` linhas e há
 * `ticksVisiveis` níveis, o agrupamento precisa ser pelo menos
 * `ticksVisiveis / linhasQueCabem` ticks. O resultado é arredondado para um
 * "passo redondo" (1, 5, 10, 25, 50, 100…) porque nível em múltiplo quebrado
 * (7, 13) é ilegível para quem lê preço.
 *
 * ⚠️ Devolve `0` (sem agrupamento) quando tudo cabe — é o caso de zoom máximo,
 * onde o footprint fica mais útil.
 */
export function agrupamentoPorZoom(params: {
  readonly ticksVisiveis: number;
  readonly alturaPx: number;
  readonly tickSize: number;
  readonly alturaMinimaLinhaPx?: number;
}): number {
  const minLinha = params.alturaMinimaLinhaPx ?? 11;
  if (!fin(params.ticksVisiveis) || params.ticksVisiveis <= 0) return 0;
  if (!fin(params.alturaPx) || params.alturaPx <= 0) return 0;
  if (!fin(params.tickSize) || params.tickSize <= 0) return 0;

  const linhasQueCabem = Math.max(1, Math.floor(params.alturaPx / minLinha));
  if (params.ticksVisiveis <= linhasQueCabem) return 0;

  const ticksPorLinha = params.ticksVisiveis / linhasQueCabem;
  const PASSOS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
  for (const p of PASSOS) {
    if (p >= ticksPorLinha) return p * params.tickSize;
  }
  const maior = PASSOS[PASSOS.length - 1] ?? 1000;
  return maior * params.tickSize;
}

/**
 * Agrega o grid do bookmap em footprint por vela.
 *
 * @param grid o mesmo `BookmapGrid` da camada de livro (traz `buy`/`sell`).
 * @param fronteiras início de cada vela do timeframe exibido, epoch ms,
 *   CRESCENTE. Uma célula do grid cai na última fronteira `≤ tsMs` dela.
 * @param cfg agrupamento e poda.
 *
 * ⚠️ Célula ANTERIOR à primeira fronteira é descartada, não empurrada para a
 * primeira vela: somá-la ali inventaria volume numa vela que não o teve.
 */
export function agregarFootprint(
  grid: BookmapGrid | null,
  fronteiras: readonly number[],
  cfg: ConfigFootprint = CONFIG_FOOTPRINT_DEFAULT,
): VelaFootprint[] {
  if (!grid || fronteiras.length === 0) return [];

  const n = grid.ti.length;
  if (n === 0) return [];

  // Mapa vela → (preço agrupado → [compra, venda]). Duas passadas seriam
  // possíveis, mas uma só basta e evita alocar a matriz cheia (que seria
  // fronteiras × níveis, muito maior que o número de células com execução).
  const porVela = new Map<number, Map<number, [number, number]>>();

  for (let k = 0; k < n; k++) {
    const compra = grid.buy[k] ?? 0;
    const venda = grid.sell[k] ?? 0;
    // Célula só de fila (sem execução) não é footprint.
    if (!(compra > 0) && !(venda > 0)) continue;

    const it = grid.ti[k];
    const ip = grid.pi[k];
    if (it === undefined || ip === undefined) continue;
    const ts = grid.times[it];
    const preco = grid.prices[ip];
    if (!fin(ts) || !fin(preco)) continue;

    const iVela = indiceDaVela(fronteiras, ts);
    if (iVela < 0) continue;

    const chaveVela = fronteiras[iVela];
    if (chaveVela === undefined) continue;
    let niveis = porVela.get(chaveVela);
    if (!niveis) { niveis = new Map(); porVela.set(chaveVela, niveis); }

    const p = agruparPreco(preco, cfg.agrupamentoPreco);
    const atual = niveis.get(p);
    if (atual) { atual[0] += compra; atual[1] += venda; }
    else niveis.set(p, [compra, venda]);
  }

  const saida: VelaFootprint[] = [];
  // Percorre as fronteiras (não o Map) para a saída sair em ordem de tempo
  // independentemente da ordem de inserção — determinismo.
  for (const tempo of fronteiras) {
    const bruto = porVela.get(tempo);
    if (!bruto || bruto.size === 0) continue;

    let niveis: NivelFootprint[] = [];
    let totalCompra = 0;
    let totalVenda = 0;
    let maiorTotal = 0;

    for (const [preco, [compra, venda]] of bruto) {
      const total = compra + venda;
      totalCompra += compra;
      totalVenda += venda;
      if (total > maiorTotal) maiorTotal = total;
      niveis.push({
        preco,
        compra,
        venda,
        delta: compra - venda,
        total,
        desequilibrio: total > 0 ? (compra - venda) / total : 0,
      });
    }

    // Poda: primeiro por fração do maior, depois por quantidade (mantendo os
    // maiores). A ordem importa — podar por quantidade antes tiraria níveis
    // grandes de velas com muitos níveis pequenos.
    if (cfg.fracaoMinima > 0 && maiorTotal > 0) {
      const piso = maiorTotal * cfg.fracaoMinima;
      niveis = niveis.filter((x) => x.total >= piso);
    }
    if (cfg.maxNiveis > 0 && niveis.length > cfg.maxNiveis) {
      niveis = [...niveis].sort((a, b) => b.total - a.total).slice(0, cfg.maxNiveis);
    }
    niveis.sort((a, b) => a.preco - b.preco);

    // ⚠️ POC calculado sobre os níveis PODADOS, para o desenho ser coerente com
    // o que está na tela. Os totais da vela ficam com os valores ÍNTEGROS
    // (antes da poda), porque o delta da vela não deve mudar por causa de poda
    // visual.
    let poc: number | null = null;
    let melhor = -1;
    for (const x of niveis) {
      if (x.total > melhor) { melhor = x.total; poc = x.preco; }
    }

    saida.push({
      tempo,
      niveis,
      totalCompra,
      totalVenda,
      delta: totalCompra - totalVenda,
      poc,
      maiorTotal,
    });
  }

  return saida;
}

/**
 * Índice da vela que contém `ts`: a última fronteira `≤ ts`. Busca binária —
 * a agregação roda sobre dezenas de milhares de células.
 * `-1` quando `ts` é anterior à primeira fronteira.
 */
export function indiceDaVela(fronteiras: readonly number[], ts: number): number {
  if (fronteiras.length === 0 || !fin(ts)) return -1;
  const primeira = fronteiras[0];
  if (primeira === undefined || ts < primeira) return -1;
  let lo = 0;
  let hi = fronteiras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const v = fronteiras[mid];
    if (v !== undefined && v <= ts) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Desequilíbrio DIAGONAL — a leitura clássica do footprint.
 *
 * Compara a compra num nível com a venda no nível IMEDIATAMENTE ABAIXO, porque
 * é assim que a agressão se encontra no livro: quem compra pega o ask de cima,
 * quem vende bate no bid de baixo. Razão ≥ `fator` marca desequilíbrio.
 *
 * ⚠️ Diferente do `desequilibrio` de `NivelFootprint`, que é dentro do MESMO
 * nível. A diagonal é a que revela iniciativa; a do mesmo nível revela absorção.
 *
 * Devolve os índices (em `niveis`) marcados, para o desenho destacar.
 */
export function desequilibriosDiagonais(
  niveis: readonly NivelFootprint[],
  fator = 3,
): { readonly compra: readonly number[]; readonly venda: readonly number[] } {
  const compra: number[] = [];
  const venda: number[] = [];
  if (!fin(fator) || fator <= 1) return { compra, venda };

  for (let i = 1; i < niveis.length; i++) {
    const acima = niveis[i];
    const abaixo = niveis[i - 1];
    if (!acima || !abaixo) continue;
    // Compra do nível de cima contra venda do de baixo.
    if (acima.compra > 0 && acima.compra >= abaixo.venda * fator) compra.push(i);
    // Venda do nível de baixo contra compra do de cima.
    if (abaixo.venda > 0 && abaixo.venda >= acima.compra * fator) venda.push(i - 1);
  }
  return { compra, venda };
}

/**
 * Resumo em uma linha, para rótulo e diagnóstico. PURO.
 *
 * ── LOCALE, NA GENERALIZAÇÃO ───────────────────────────────────────────────
 *
 * A origem chamava `toLocaleString('pt-BR')` direto, em três pontos deste corpo.
 * Aqui o formatador de número entra por parâmetro, com pt-BR como default — a
 * saída sem argumento é byte-idêntica à da origem.
 *
 * Diferente do fuso de horário (onde o layout é fixo de propósito, ver
 * `instant-format.core`), locale de número é eixo legítimo: `1.234.567` em pt-BR
 * e `1,234,567` em en-US estão os dois corretos para o seu público.
 *
 * @param velas Velas agregadas.
 * @param fmt   Formatador de contagem; omitido usa inteiro agrupado em pt-BR.
 */
export function resumirFootprint(
  velas: readonly VelaFootprint[],
  fmt: NumberFormatter = DEFAULT_COUNT_FORMATTER,
): string {
  if (velas.length === 0) return 'sem footprint no período (nenhuma execução materializada)';
  let compra = 0;
  let venda = 0;
  let niveis = 0;
  for (const v of velas) {
    compra += v.totalCompra;
    venda += v.totalVenda;
    niveis += v.niveis.length;
  }
  const delta = compra - venda;
  const lado = delta > 0 ? 'comprador' : delta < 0 ? 'vendedor' : 'equilíbrio';
  return (
    `${velas.length} vela(s) · ${niveis} nível(is) · ` +
    `compra ${fmt(compra)} × ` +
    `venda ${fmt(venda)} · ` +
    `delta ${delta > 0 ? '+' : ''}${fmt(delta)} (${lado})`
  );
}
