/**
 * Perfil de volume da sessão — "onde o volume se concentrou", por preço.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * Pedido do operador em 03/09/2026, olhando o footprint em M15 com um pregão
 * inteiro na tela: *"não dá para ler nem entender nada, sai apenas traços. Não
 * deveria ser tipo o marketProfile para mostrar as regiões que mais
 * concentraram?"*
 *
 * Ele estava certo, e a pergunta separa duas ferramentas que respondem coisas
 * diferentes:
 *
 *   • **Footprint** — `venda × compra` **por nível, dentro de CADA vela**.
 *     Responde *"nesta vela, em que preço a oferta foi consumida e por quem?"*.
 *     Exige ~46 px de largura por vela para escrever número, ou seja **no máximo
 *     ~19 velas na tela**. Com 35 velas de M15 num pregão, cada vela recebe
 *     ~26 px e o desenho degrada para barras de 1-2 px — os "traços". Não é
 *     defeito: é a ferramenta fora da escala de uso dela.
 *
 *   • **Perfil de volume** (este arquivo) — soma o volume **ao longo de todo o
 *     período** e o distribui por preço, num histograma horizontal. Responde
 *     *"onde este mercado negociou de fato?"* e é legível em QUALQUER zoom,
 *     porque não depende da largura da vela.
 *
 * Os dois são complementares e vêm do MESMO dado (`bookmap_depth`, colunas
 * `exec_compra`/`exec_venda`): o footprint corta por vela, o perfil corta por
 * preço. Zero requisição nova.
 *
 * ── O QUE ISTO NÃO É ────────────────────────────────────────────────────────
 *
 * ⚠️ Não é *Market Profile* (TPO) no sentido estrito de Steidlmayer. O TPO conta
 * **tempo** por preço (quantas meias-horas o preço visitou o nível); este conta
 * **volume**. São curvas parecidas e leituras diferentes — e o que o operador
 * pediu ("as regiões que mais concentraram") é volume, porque volume é o que
 * mede participação. O nome fica explícito para ninguém confundir depois.
 *
 * Puro, determinístico, sem I/O e sem relógio.
 */

import type { BookmapGrid } from './bookmap-types.js';

/** Um nível de preço do perfil. */
export interface NivelDoPerfil {
  readonly preco: number;
  /** Contratos executados com o COMPRADOR agredindo. */
  readonly compra: number;
  /** Contratos executados com o VENDEDOR agredindo. */
  readonly venda: number;
  /** `compra + venda`. É o que dimensiona a barra. */
  readonly total: number;
}

/** O perfil pronto para desenhar. */
export interface PerfilDeVolume {
  /**
   * Níveis com volume, **ordenados por preço decrescente** — topo da tela
   * primeiro, na mesma direção em que o eixo de preço é lido.
   */
  readonly niveis: readonly NivelDoPerfil[];
  /** Maior `total` entre os níveis. É o divisor da largura da barra. */
  readonly maiorTotal: number;
  /** Soma de todos os `total`. */
  readonly totalGeral: number;
  /**
   * Preço do nível de maior volume — o POC (*point of control*).
   *
   * ⚠️ Empate resolvido pelo preço MENOR, de forma determinística. Empate exato
   * é raro com volume real, mas sem regra explícita a saída dependeria da ordem
   * de iteração e dois observadores veriam POCs diferentes no mesmo dado.
   */
  readonly poc: number | null;
  /** Borda SUPERIOR da área de valor. */
  readonly vah: number | null;
  /** Borda INFERIOR da área de valor. */
  readonly val: number | null;
  /** Fração do volume dentro da área de valor (o alvo pedido, ex.: 0,70). */
  readonly fracaoAreaDeValor: number;
  /** Motivo de o perfil estar vazio, em pt-BR. `null` quando há dado. */
  readonly motivoVazio: string | null;
}

export interface OpcoesDoPerfil {
  /**
   * Fração do volume que define a área de valor. Padrão `0,70` — a convenção de
   * mercado. Recortada a `[0,1; 0,95]`: abaixo de 0,1 a área não descreve nada,
   * e acima de 0,95 ela cobre o range inteiro e deixa de separar.
   */
  readonly fracaoAreaDeValor?: number;
  /**
   * Recorte de tempo em milissegundos. Ausente ⇒ o dia inteiro do grid.
   *
   * Serve para "perfil da janela visível" sem refazer a agregação em outro
   * lugar: quem chama decide o escopo.
   */
  readonly janela?: { readonly tsDe: number; readonly tsAte: number };
}

const FRACAO_PADRAO = 0.7;
const FRACAO_MIN = 0.1;
const FRACAO_MAX = 0.95;

const VAZIO: PerfilDeVolume = {
  niveis: [],
  maiorTotal: 0,
  totalGeral: 0,
  poc: null,
  vah: null,
  val: null,
  fracaoAreaDeValor: FRACAO_PADRAO,
  motivoVazio: 'Sem grid de livro carregado.',
};

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function saneiaFracao(bruta: number | undefined): number {
  if (!fin(bruta)) return FRACAO_PADRAO;
  if (bruta < FRACAO_MIN) return FRACAO_MIN;
  if (bruta > FRACAO_MAX) return FRACAO_MAX;
  return bruta;
}

function vazioCom(motivo: string, fracao: number): PerfilDeVolume {
  return { ...VAZIO, fracaoAreaDeValor: fracao, motivoVazio: motivo };
}

/**
 * Agrega o grid num perfil de volume por preço.
 *
 * ── PÓS-CONDIÇÕES ─────────────────────────────────────────────────────────
 *
 * - `niveis` em ordem de preço **decrescente**, sem repetição de preço;
 * - todo nível tem `total > 0` — nível sem execução não entra (ausência de
 *   negócio não é negócio de tamanho zero, e uma barra de largura nula seria
 *   indistinguível de nível ausente);
 * - `maiorTotal === max(total)` e `totalGeral === Σ total`;
 * - `poc` é o preço de `maiorTotal`, com empate no preço menor;
 * - `val <= poc <= vah` sempre que houver pelo menos um nível;
 * - saída vazia **sempre** traz `motivoVazio` preenchido: tela vazia sem
 *   explicação é o defeito que este projeto já pagou várias vezes.
 *
 * Nunca lança. Valor não finito ou negativo numa coluna conta como zero, por
 * campo — a sanitização não contamina os outros valores da mesma célula.
 */
export function agregarPerfilDeVolume(
  grid: BookmapGrid | null,
  opts?: OpcoesDoPerfil,
): PerfilDeVolume {
  const fracao = saneiaFracao(opts?.fracaoAreaDeValor);

  if (grid === null || grid === undefined) return vazioCom(VAZIO.motivoVazio!, fracao);

  const { times, prices, ti, pi, buy, sell } = grid;
  if (
    times === undefined || prices === undefined || ti === undefined ||
    pi === undefined || buy === undefined || sell === undefined
  ) {
    return vazioCom('Grid do livro sem as colunas de execução.', fracao);
  }

  const n = Math.min(ti.length, pi.length, buy.length, sell.length);
  if (n <= 0) return vazioCom('Nenhuma célula no grid do livro.', fracao);

  const janela = opts?.janela;
  const filtra = janela !== undefined && fin(janela.tsDe) && fin(janela.tsAte);

  // Acumula por ÍNDICE de preço, não por valor: o índice é inteiro e a escada de
  // preços do grid é a fonte do valor. Somar por chave de ponto flutuante
  // arriscaria dois níveis "iguais" com representações diferentes.
  const somaCompra = new Float64Array(prices.length);
  const somaVenda = new Float64Array(prices.length);

  for (let k = 0; k < n; k += 1) {
    const idxPreco = pi[k];
    if (idxPreco === undefined || idxPreco < 0 || idxPreco >= prices.length) continue;

    if (filtra) {
      const idxTempo = ti[k];
      if (idxTempo === undefined) continue;
      const ts = times[idxTempo];
      if (!fin(ts)) continue;
      if (ts < janela!.tsDe || ts > janela!.tsAte) continue;
    }

    const c = buy[k];
    const v = sell[k];
    if (fin(c) && c > 0) somaCompra[idxPreco] = (somaCompra[idxPreco] ?? 0) + c;
    if (fin(v) && v > 0) somaVenda[idxPreco] = (somaVenda[idxPreco] ?? 0) + v;
  }

  const niveis: NivelDoPerfil[] = [];
  let maiorTotal = 0;
  let totalGeral = 0;
  let poc: number | null = null;

  // A escada do grid é crescente; percorrer de trás para frente já entrega a
  // ordem decrescente exigida, sem ordenação posterior.
  for (let i = prices.length - 1; i >= 0; i -= 1) {
    const preco = prices[i];
    if (!fin(preco)) continue;
    const compra = somaCompra[i] ?? 0;
    const venda = somaVenda[i] ?? 0;
    const total = compra + venda;
    if (total <= 0) continue;

    niveis.push({ preco, compra, venda, total });
    totalGeral += total;
    // `>` e não `>=`: como a varredura é do preço MAIOR para o menor, manter o
    // primeiro máximo encontrado escolheria o preço maior no empate. O `>` faz o
    // último (preço menor) vencer, que é a regra declarada.
    if (total > maiorTotal) {
      maiorTotal = total;
      poc = preco;
    } else if (total === maiorTotal) {
      poc = preco;
    }
  }

  if (niveis.length === 0) {
    return vazioCom(
      'Nenhum negócio executado no recorte — o perfil de volume precisa de execução, ' +
      'e a cobertura de execução do dia costuma terminar antes da fila.',
      fracao,
    );
  }

  const { vah, val } = areaDeValor(niveis, totalGeral, fracao, poc);

  return {
    niveis,
    maiorTotal,
    totalGeral,
    poc,
    vah,
    val,
    fracaoAreaDeValor: fracao,
    motivoVazio: null,
  };
}

/**
 * Área de valor: cresce a partir do POC, sempre para o lado de maior volume, até
 * cobrir a fração pedida.
 *
 * É o algoritmo padrão do perfil (o mesmo do *value area* de Market Profile),
 * com uma diferença explícita: quando os dois vizinhos empatam, expande para
 * **cima**. Empate sem regra deixaria a área dependente da ordem de iteração.
 */
function areaDeValor(
  niveis: readonly NivelDoPerfil[],
  totalGeral: number,
  fracao: number,
  poc: number | null,
): { vah: number | null; val: number | null } {
  if (niveis.length === 0 || totalGeral <= 0 || poc === null) {
    return { vah: null, val: null };
  }

  // `niveis` está em preço decrescente: índice 0 é o topo.
  const idxPoc = niveis.findIndex((x) => x.preco === poc);
  if (idxPoc < 0) return { vah: null, val: null };

  const alvo = totalGeral * fracao;
  let acumulado = niveis[idxPoc]!.total;
  let cima = idxPoc;   // caminha para índices MENORES (preços maiores)
  let baixo = idxPoc;  // caminha para índices MAIORES (preços menores)

  while (acumulado < alvo && (cima > 0 || baixo < niveis.length - 1)) {
    const acima = cima > 0 ? (niveis[cima - 1]?.total ?? -1) : -1;
    const abaixo = baixo < niveis.length - 1 ? (niveis[baixo + 1]?.total ?? -1) : -1;

    if (acima < 0 && abaixo < 0) break;
    if (acima >= abaixo) {
      cima -= 1;
      acumulado += acima;
    } else {
      baixo += 1;
      acumulado += abaixo;
    }
  }

  return {
    vah: niveis[cima]?.preco ?? null,
    val: niveis[baixo]?.preco ?? null,
  };
}

/** Linhas do histograma. 50 é o padrão de mercado (ver o cabeçalho de `binarizarPerfil`). */
export const LINHAS_PERFIL_PADRAO = 50;
const LINHAS_MIN = 10;
const LINHAS_MAX = 150;

/**
 * Reduz o perfil a um número fixo de LINHAS, agrupando por faixa de preço.
 *
 * ── POR QUE ISTO É OBRIGATÓRIO, E NÃO UM REFINAMENTO ────────────────────────
 *
 * Medido no grid de 03/09/2026: **914 níveis de preço distintos** num pregão de
 * WIN. Num painel de ~400 px isso dá **0,44 px por nível**. Desenhar um nível por
 * barra produz uma mancha — foi exatamente o que o operador viu, e ele descreveu
 * como "está longe de ser isso".
 *
 * É também o que a referência de mercado faz. O indicador de perfil da
 * TradingView discretiza a janela num número fixo de faixas (o `ChartPrime`
 * documenta **50 por padrão**, entre a máxima e a mínima da janela), e a
 * documentação do FutPrint descreve o dimensionamento automático das faixas a
 * partir da amplitude visível, para o número de linhas "continuar razoável" ao
 * dar zoom. Conteúdo parafraseado das respectivas documentações públicas;
 * conferido em 03/09/2026.
 *
 * ── O QUE É PRESERVADO ──────────────────────────────────────────────────────
 *
 * - **volume**: `totalGeral` do binado é igual ao do cru (conservação);
 * - **compra/venda** por faixa é a soma das compras/vendas dos níveis dentro dela;
 * - **POC** passa a ser o CENTRO da faixa de maior volume — a definição de POC de
 *   qualquer plataforma que use faixas;
 * - **área de valor** é recalculada sobre as faixas, pelo mesmo algoritmo.
 *
 * Pura, determinística, nunca lança. `linhas` fora de `[10, 150]` é recortada.
 */
export function binarizarPerfil(
  perfil: PerfilDeVolume,
  linhas: number = LINHAS_PERFIL_PADRAO,
  faixa?: { readonly precoDe: number; readonly precoAte: number },
): PerfilDeVolume {
  if (perfil.niveis.length === 0) return perfil;

  const n = fin(linhas)
    ? Math.min(LINHAS_MAX, Math.max(LINHAS_MIN, Math.floor(linhas)))
    : LINHAS_PERFIL_PADRAO;

  // Amplitude: a pedida, ou a do próprio perfil. `niveis` está em preço
  // decrescente, então o primeiro é o topo e o último é o piso.
  const topoCru = perfil.niveis[0]!.preco;
  const pisoCru = perfil.niveis[perfil.niveis.length - 1]!.preco;
  const usaFaixa = faixa !== undefined && fin(faixa.precoDe) && fin(faixa.precoAte)
    && faixa.precoAte > faixa.precoDe;
  const piso = usaFaixa ? Math.min(faixa!.precoDe, faixa!.precoAte) : pisoCru;
  const topo = usaFaixa ? Math.max(faixa!.precoDe, faixa!.precoAte) : topoCru;

  const amplitude = topo - piso;
  // Um único nível (ou amplitude degenerada) não admite faixa: devolver o perfil
  // como está é mais honesto que inventar 50 linhas vazias em volta dele.
  if (!(amplitude > 0)) return perfil;
  if (perfil.niveis.length <= n) return perfil;

  const largura = amplitude / n;
  const compra = new Float64Array(n);
  const venda = new Float64Array(n);

  for (const nivel of perfil.niveis) {
    // Fora da faixa pedida ⇒ descartado. Só acontece quando quem chama restringe.
    if (nivel.preco < piso || nivel.preco > topo) continue;
    const bruto = Math.floor((nivel.preco - piso) / largura);
    // O preço exatamente no topo cairia em `n` (fora do vetor): o clamp o põe na
    // última faixa, que é a faixa a que ele pertence.
    const idx = bruto >= n ? n - 1 : bruto < 0 ? 0 : bruto;
    compra[idx] = (compra[idx] ?? 0) + nivel.compra;
    venda[idx] = (venda[idx] ?? 0) + nivel.venda;
  }

  const niveis: NivelDoPerfil[] = [];
  let maiorTotal = 0;
  let totalGeral = 0;
  let poc: number | null = null;

  // De cima para baixo, para manter a ordem decrescente do contrato.
  for (let i = n - 1; i >= 0; i -= 1) {
    const c = compra[i] ?? 0;
    const v = venda[i] ?? 0;
    const total = c + v;
    if (total <= 0) continue;
    const centro = piso + largura * (i + 0.5);
    niveis.push({ preco: centro, compra: c, venda: v, total });
    totalGeral += total;
    if (total > maiorTotal) {
      maiorTotal = total;
      poc = centro;
    } else if (total === maiorTotal) {
      // Mesma regra do perfil cru: empate fica com o preço MENOR.
      poc = centro;
    }
  }

  if (niveis.length === 0) return perfil;

  const { vah, val } = areaDeValor(niveis, totalGeral, perfil.fracaoAreaDeValor, poc);

  return {
    niveis,
    maiorTotal,
    totalGeral,
    poc,
    vah,
    val,
    fracaoAreaDeValor: perfil.fracaoAreaDeValor,
    motivoVazio: null,
  };
}

/**
 * Quantas velas cabem na tela com o footprint LEGÍVEL (número por nível).
 *
 * Existe para o painel poder dizer ao operador, em número, por que o footprint
 * está saindo em traços — em vez de deixá-lo concluir que a camada está
 * quebrada. O limiar de 46 px é o mesmo de `footprint-render.core.ts`
 * (`decidirModo`), e vem de lá por parâmetro para não haver duas verdades.
 */
export function velasLegiveisParaFootprint(
  larguraDoGraficoPx: number,
  larguraMinimaPorVelaPx = 46,
): number | null {
  if (!fin(larguraDoGraficoPx) || larguraDoGraficoPx <= 0) return null;
  if (!fin(larguraMinimaPorVelaPx) || larguraMinimaPorVelaPx <= 0) return null;
  return Math.max(1, Math.floor(larguraDoGraficoPx / larguraMinimaPorVelaPx));
}
