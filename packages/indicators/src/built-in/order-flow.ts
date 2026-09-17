/**
 * order-flow — indicadores de FLUXO DE ORDEM: quem agrediu o livro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ POR QUE ESTES TRES SAO OS MAIS DIFERENCIADORES DO PACOTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Todo indicador classico deste pacote le PRECO (e alguns, volume). Estes tres leem AGRESSAO:
 * quanto do volume saiu de quem bateu na oferta de venda (comprador agressor) contra quem bateu
 * na oferta de compra (vendedor agressor).
 *
 * E a diferenca entre *"houve volume"* e *"houve pressao"*. Duas barras podem negociar o mesmo
 * volume no mesmo range: numa, o comprador levou 80% do que executou e o preco parou de subir —
 * absorcao. Na outra, 50/50 num movimento tranquilo. O volume nao distingue; o delta distingue.
 *
 * ⚠️ Quase nenhum provedor entrega o insumo. O historico da mesa entrega: 5.163 dos 6.376 dias
 * do WIN trazem `buy_vol`/`sell_vol`. E o motivo de valer a pena ter estes indicadores aqui em
 * vez de esperar por um provedor que os calcule.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ AUSENCIA DE AGRESSOR E `null`, NUNCA ZERO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A regra vale para os tres, e e a decisao mais importante do arquivo. Zero em delta significa
 * *"compra e venda se equilibraram"* — uma leitura de mercado. *"Nao ha classificacao de
 * agressor"* nao e leitura nenhuma. Confundir os dois desenharia equilibrio perfeito num ativo
 * sobre o qual nao se sabe nada, e o operador leria absorcao onde nao ha dado.
 *
 * ⚠️ E `buyVolume + sellVolume` NAO precisa fechar com `volume`: leilao de abertura e negocio
 * direto entram no total e nao tem agressor. Nenhum indicador aqui assume a igualdade — o
 * `delta_ratio` normaliza pela soma dos DOIS lados classificados, nao pelo volume total.
 */

import {
  numParam,
  validateAgainstSpecs,
  withDefaults,
  type IndicatorBar,
  type IndicatorFactory,
  type IndicatorMeta,
  type IndicatorParams,
  type ParamSpec,
} from '../contracts.js';
import { EmaState, SmaState } from '../rolling.core.js';
import { buildInstance } from './instance-base.js';

const periodSpec = (name: string, label: string, def: number): ParamSpec => ({
  name,
  label,
  type: 'number',
  default: def,
  min: 1,
  max: 5000,
  step: 1,
});

/**
 * Os dois lados da agressao, ou `null` quando a barra nao os traz.
 *
 * ⭐ Ponto UNICO de leitura dos campos, e ponto unico da decisao "ha dado?". Cada indicador que
 * reimplementasse isso teria a chance de aceitar um lado presente e o outro ausente — e meio
 * delta e pior que nenhum, porque parece um numero.
 *
 * ⚠️ Exige os DOIS finitos. Um lado presente e o outro ausente nao e "o outro foi zero": e dado
 * quebrado, e tratar como zero produziria delta maximo (100% de um lado) exatamente nas barras
 * em que a ingestao falhou.
 */
function agressao(bar: IndicatorBar): { readonly compra: number; readonly venda: number } | null {
  const c = bar.buyVolume;
  const v = bar.sellVolume;
  if (typeof c !== 'number' || typeof v !== 'number') return null;
  if (!Number.isFinite(c) || !Number.isFinite(v)) return null;
  if (c < 0 || v < 0) return null;
  return { compra: c, venda: v };
}

// ═════════════════════════════════════════════════════════════════════════════
// DELTA — a pressao de cada barra
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `delta = compraAgressora - vendaAgressora`, com media movel opcional.
 *
 * ⭐ Histograma em painel PROPRIO com linha de referencia no ZERO: o zero e a leitura ("quem
 * ganhou a barra"), e sem ele um histograma de delta e uma sequencia de barras sem eixo.
 *
 * ⚠️ A media (`smooth`) e uma saida SEPARADA e nao um filtro sobre o valor. Delta cru e o dado;
 * a media e interpretacao. Substituir o cru pela media apagaria a informacao que importa mais —
 * a barra excepcional — que e exatamente o que a media existe para suavizar.
 *
 * ⚠️ `smooth = 1` faz a media coincidir com o cru, e e o default: quem nao pediu suavizacao nao
 * deve receber uma segunda linha dizendo outra coisa.
 */
export const deltaFactory: IndicatorFactory = (() => {
  const smoothSpec = periodSpec('smooth', 'Média do delta', 1);
  const specs: readonly ParamSpec[] = [smoothSpec];
  const meta: IndicatorMeta = {
    name: 'delta',
    label: 'Delta (agressão)',
    category: 'volume',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: 'Delta',
        plot: 'histogram',
        pane: 'separate',
        referenceLines: [0],
      },
      { key: 'media', label: 'Média', plot: 'line', pane: 'separate', color: '#fbbf24' },
    ],
    dependencies: [],
    warmup: (p) => Math.max(1, Math.round(numParam(p, smoothSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const smooth = Math.max(1, Math.round(numParam(merged, smoothSpec)));
      return buildInstance(meta, merged, () => {
        const media = new SmaState(smooth);
        return {
          onUpdate: (bar) => {
            const a = agressao(bar);
            // ⚠️ Barra sem agressor NAO alimenta a media: empurrar zero ali criaria uma media
            // que confunde "sem dado" com "equilibrio", e o erro se arrastaria pela janela
            // inteira depois de a classificacao voltar.
            if (a === null) return { value: null, media: null };
            const d = a.compra - a.venda;
            return { value: d, media: media.push(d) };
          },
          onPreview: (bar) => {
            const a = agressao(bar);
            if (a === null) return { value: null, media: null };
            const d = a.compra - a.venda;
            return { value: d, media: media.peek(d) };
          },
          onReset: () => media.reset(),
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// CVD — Delta Cumulativo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Delta CUMULATIVO: a soma corrida do delta desde o inicio da serie.
 *
 * ⭐⭐ E a leitura que o delta barra-a-barra nao da: **divergencia**. Preco fazendo topo mais
 * alto com o CVD fazendo topo mais baixo significa que a alta esta sendo entregue por quem
 * vende, e nao comprada por quem agride — a leitura classica de exaustao. Sem acumular, cada
 * barra e um numero solto e a divergencia nao existe como forma.
 *
 * ⚠️ Barra sem agressor NAO reseta e NAO soma: o acumulado CONGELA e continua do mesmo nivel.
 * As tres alternativas erradas e por que:
 *
 *  - somar zero: indistinguivel de barra equilibrada, e a curva ganha um patamar falso;
 *  - devolver `null`: quebraria a linha em duas, e o consumidor leria duas series;
 *  - reiniciar: perderia o acumulado do dia por causa de uma barra sem classificacao.
 *
 * Congelar e a unica que preserva a forma e nao inventa dado. ⚠️ Efeito colateral declarado: um
 * trecho longo sem classificacao aparece como platô, e platô no CVD tambem pode ser mercado
 * parado — por isso o `cobertura` sai como segunda saida.
 *
 * ⚠️ NAO ha reinicio por sessao. Ele existiria em quase todo terminal ("CVD do dia"), mas exige
 * saber onde a sessao comeca, e isso e regra de MERCADO (o dia da B3 vira as 18h, o de cripto
 * nao vira) que um indicador puro nao pode adivinhar. Quem quer o CVD do dia alimenta o
 * indicador com as barras do dia — o `warmup` reconstroi tudo, e a decisao fica com quem tem o
 * calendario.
 */
export const cvdFactory: IndicatorFactory = (() => {
  const specs: readonly ParamSpec[] = [];
  const meta: IndicatorMeta = {
    name: 'cvd',
    label: 'Delta cumulativo (CVD)',
    category: 'volume',
    params: specs,
    outputs: [
      { key: 'value', label: 'CVD', plot: 'line', pane: 'separate', referenceLines: [0] },
      // ⭐ A COBERTURA como saida: e o que distingue "platô porque o mercado parou" de "platô
      // porque nao ha classificacao de agressor". Sem ela o operador nao tem como saber.
      {
        key: 'cobertura',
        label: 'Barras com agressor (%)',
        plot: 'line',
        pane: 'separate',
        color: '#64748b',
      },
    ],
    dependencies: [],
    warmup: () => 1,
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      return buildInstance(meta, merged, () => {
        let acumulado = 0;
        let comAgressor = 0;
        let total = 0;
        return {
          onUpdate: (bar) => {
            total += 1;
            const a = agressao(bar);
            if (a !== null) {
              acumulado += a.compra - a.venda;
              comAgressor += 1;
            }
            return {
              value: acumulado,
              cobertura: total > 0 ? (100 * comAgressor) / total : null,
            };
          },
          onPreview: (bar) => {
            const a = agressao(bar);
            const proj = a === null ? acumulado : acumulado + (a.compra - a.venda);
            const t = total + 1;
            const c = comAgressor + (a === null ? 0 : 1);
            return { value: proj, cobertura: (100 * c) / t };
          },
          onReset: () => {
            acumulado = 0;
            comAgressor = 0;
            total = 0;
          },
        };
      });
    },
  };
})();

// ═════════════════════════════════════════════════════════════════════════════
// DELTA RATIO — a pressao NORMALIZADA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `ratio = 100 * (compra - venda) / (compra + venda)`, em −100..+100, com EMA opcional.
 *
 * ⭐⭐ Existe porque o delta cru NAO E COMPARAVEL entre regimes. Um delta de +8.000 contratos e
 * enorme numa hora morta e irrelevante na abertura; a mesma barra em dois dias de liquidez
 * diferente da dois numeros que nao se comparam. O ratio responde a pergunta que sobrevive ao
 * regime: *"de tudo o que foi agredido nesta barra, que fracao veio da compra?"*
 *
 * ⚠️ Normalizado pela soma dos DOIS LADOS CLASSIFICADOS, e nao por `volume`. Leilao e negocio
 * direto entram no volume total e nao tem agressor: dividir pelo total daria um ratio
 * artificialmente pequeno justamente nas barras de leilao, que sao as de maior volume do dia.
 *
 * ⚠️ Soma zero (barra sem negocio agredido) devolve `null`, nao 0: nao houve disputa a medir.
 *
 * ⭐ EMA e nao SMA na suavizacao: o ratio e limitado a ±100 e nao tem tendencia, entao o peso
 * decrescente da EMA responde ao regime corrente sem o degrau que a janela da SMA produz ao
 * expulsar uma barra excepcional.
 */
export const deltaRatioFactory: IndicatorFactory = (() => {
  const smoothSpec = periodSpec('smooth', 'EMA do ratio', 9);
  const specs: readonly ParamSpec[] = [smoothSpec];
  const meta: IndicatorMeta = {
    name: 'delta_ratio',
    label: 'Delta % (pressão)',
    category: 'volume',
    params: specs,
    outputs: [
      {
        key: 'value',
        label: 'Delta %',
        plot: 'histogram',
        pane: 'separate',
        // ±60% e a faixa em que a leitura de desequilibrio deixa de ser ruido, medida na
        // pratica de mesa. Sao guia, nao regra — por isso linhas de referencia e nao limites.
        referenceLines: [-60, 0, 60],
      },
      { key: 'ema', label: 'EMA', plot: 'line', pane: 'separate', color: '#22d3ee' },
    ],
    dependencies: ['ema'],
    warmup: (p) => Math.max(1, Math.round(numParam(p, smoothSpec))),
  };
  return {
    meta,
    validate: (p) => validateAgainstSpecs(specs, p),
    create(params?: IndicatorParams) {
      const merged = withDefaults(specs, params);
      const smooth = Math.max(1, Math.round(numParam(merged, smoothSpec)));
      const ratioDe = (bar: IndicatorBar): number | null => {
        const a = agressao(bar);
        if (a === null) return null;
        const soma = a.compra + a.venda;
        if (!(soma > 0)) return null;
        return (100 * (a.compra - a.venda)) / soma;
      };
      return buildInstance(meta, merged, () => {
        const ema = new EmaState(smooth);
        return {
          onUpdate: (bar) => {
            const r = ratioDe(bar);
            if (r === null) return { value: null, ema: null };
            return { value: r, ema: ema.push(r) };
          },
          onPreview: (bar) => {
            const r = ratioDe(bar);
            if (r === null) return { value: null, ema: null };
            return { value: r, ema: ema.peek(r) };
          },
          onReset: () => ema.reset(),
        };
      });
    },
  };
})();
