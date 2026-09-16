/**
 * Núcleo PURO do desenho do footprint — decide O QUE desenhar, sem tocar canvas.
 *
 * Separado do primitive pelo mesmo motivo do resto desta pasta: a geometria e a
 * escolha de cor são testáveis sem navegador, e o primitive fica só com a
 * emissão de formas.
 *
 * ⚠️ NENHUMA leitura de DOM, de relógio ou de `window`. Tudo entra por parâmetro.
 */

import type { NivelFootprint, VelaFootprint } from './footprint-aggregate.core.js';
import { desequilibriosDiagonais } from './footprint-aggregate.core.js';

/** Como o footprint é apresentado. */
export type ModoFootprint =
  /** Dois números por nível: `venda × compra`. A leitura clássica. */
  | 'NUMEROS'
  /** Duas barras horizontais espelhadas a partir do centro da vela. */
  | 'BARRAS'
  /** Uma barra só, com a cor indicando o lado e a intensidade o desequilíbrio. */
  | 'DELTA';

export interface OpcoesFootprint {
  readonly modo: ModoFootprint;
  /** Fator do desequilíbrio diagonal que merece destaque. */
  readonly fatorDiagonal: number;
  /** Marcar o nível de maior volume da vela (POC da vela). */
  readonly marcarPoc: boolean;
  /** Largura máxima da barra, como fração da largura da vela. */
  readonly fracaoLargura: number;
  /** Altura mínima em px para caber número legível. Abaixo disso cai em BARRAS. */
  readonly alturaMinimaTextoPx: number;
  /**
   * Marcar com colchetes o alcance vertical do footprint de cada vela.
   *
   * ⚠️ Pedido do operador em 04/09/2026: *"crie mais destaque nele para eu saber
   * o que está havendo"*, junto de *"ele mostra apenas na barra atual, certo?"*.
   *
   * A pergunta dele revela o problema real: o footprint desenha em TODA vela que
   * tem dado, mas o grid materializado cobre ~1 h enquanto o gráfico mostra 2 a 5
   * pregões — então só um punhado de velas recebe forma, e as demais ficam
   * visualmente idênticas a "camada desligada". Sem marcação, não há como
   * distinguir *"esta vela não teve negócio"* de *"não há dado para esta vela"*.
   *
   * Os colchetes (duas linhas horizontais, no topo do nível mais alto e na base
   * do mais baixo) delimitam onde a camada TEM dado. Duas formas por vela, não
   * por nível — custo desprezível.
   */
  readonly destacarVelas: boolean;
}

export const OPCOES_FOOTPRINT_DEFAULT: OpcoesFootprint = {
  modo: 'NUMEROS',
  fatorDiagonal: 3,
  marcarPoc: true,
  fracaoLargura: 0.42,
  alturaMinimaTextoPx: 9,
  destacarVelas: true,
};

/** Uma forma a emitir. Coordenadas em px lógico. */
export interface FormaFootprint {
  readonly tipo: 'retangulo' | 'texto' | 'linha';
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
  readonly cor: string;
  readonly texto?: string;
  /** `right` alinha o número da venda encostado no centro. */
  readonly alinhamento?: 'left' | 'right' | 'center';
  /** Espessura, só para `linha`. */
  readonly espessura?: number;
  /**
   * Papel semântico da forma. O renderizador **não** usa; quem usa é a leitura.
   *
   * ⚠️ Passou a existir em 04/09/2026 porque `tipo` deixou de bastar: o POC e os
   * colchetes de alcance são os dois `linha`, e distingui-los por contagem de
   * `tipo` é frágil — dois testes de POC quebraram ao surgir a segunda espécie de
   * linha, e o certo não era afrouxar a asserção, era dar nome ao que ela mede.
   *
   * Ausente = forma de dado (barra, número). Presente = marcação.
   */
  readonly papel?: 'poc' | 'alcance' | 'legenda';
}

/** Paleta — separada para o tema poder trocá-la sem tocar a geometria. */
export interface PaletaFootprint {
  readonly compra: string;
  readonly venda: string;
  readonly compraForte: string;
  readonly vendaForte: string;
  readonly textoCompra: string;
  readonly textoVenda: string;
  readonly poc: string;
  readonly neutro: string;
}

export const PALETA_FOOTPRINT_DEFAULT: PaletaFootprint = {
  compra: 'rgba(34,197,94,0.55)',
  venda: 'rgba(239,68,68,0.55)',
  // Destaque do desequilíbrio diagonal: opacidade ALTA, não cor diferente —
  // trocar o matiz faria o operador reaprender a paleta.
  compraForte: 'rgba(34,197,94,0.95)',
  vendaForte: 'rgba(239,68,68,0.95)',
  textoCompra: '#86efac',
  textoVenda: '#fca5a5',
  poc: 'rgba(250,204,21,0.9)',
  neutro: 'rgba(148,163,184,0.35)',
};

/** Conversores do gráfico. Entram por parâmetro — o núcleo não conhece o chart. */
export interface Conversores {
  /** Preço → y em px lógico. `null` quando fora da escala. */
  readonly precoParaY: (preco: number) => number | null;
  /** Epoch ms → x em px lógico (centro da vela). `null` quando fora. */
  readonly tempoParaX: (tsMs: number) => number | null;
  /** Largura de uma vela em px lógico. */
  readonly larguraVelaPx: number;
  /** Altura de um nível de preço em px lógico (já com o agrupamento aplicado). */
  readonly alturaNivelPx: number;
}

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Abrevia contratos: 1.234 → "1.2k", 12.345 → "12k". */
export function abreviar(n: number): string {
  if (!fin(n)) return '';
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (a < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Decide o modo EFETIVO: `NUMEROS` exige altura de linha suficiente para o
 * texto caber. Sem isso o número fica ilegível e vira ruído — o problema do
 * `deltaBars` que o footprint existe para resolver.
 */
export function modoEfetivo(
  pedido: ModoFootprint,
  alturaNivelPx: number,
  larguraVelaPx: number,
  opcoes: OpcoesFootprint = OPCOES_FOOTPRINT_DEFAULT,
): ModoFootprint {
  if (pedido !== 'NUMEROS') return pedido;
  if (!fin(alturaNivelPx) || alturaNivelPx < opcoes.alturaMinimaTextoPx) return 'BARRAS';
  // Dois números ("1.2k" + "340") + separador exigem ~46 px.
  if (!fin(larguraVelaPx) || larguraVelaPx < 46) return 'BARRAS';
  return 'NUMEROS';
}

/**
 * O texto da legenda da camada, e se ele é ressalva.
 *
 * ⚠️ **Passou a existir em 04/09/2026.** Antes disso a camada só escrevia quando
 * se CALAVA ("Footprint oculto: vela de N px…"); desenhando, não dizia nada. O
 * operador perguntou, sem ter como saber pela tela: *"ele mostra apenas na barra
 * atual, certo? me ajuda a entender ele"*.
 *
 * A resposta é NÃO — `formasVisiveis` percorre todas as velas. O que limita é o
 * DADO: o livro materializado cobre ~1 h enquanto o gráfico mostra 2 a 5 pregões,
 * então só um punhado de velas recebe forma. A razão `comDado/total` é exatamente
 * o número que responde à pergunta, e por isso abre a legenda.
 *
 * ⚠️ `comDado === 0` devolve **ressalva**, não silêncio: "ligado e sem dado" e
 * "desligado" são estados diferentes e precisam PARECER diferentes. Sem isso, o
 * operador liga a camada, não vê nada e conclui que está quebrada.
 *
 * Pura: sem relógio, sem DOM, sem coordenada.
 */
export function textoDaLegendaFootprint(dados: {
  readonly comDado: number;
  readonly total: number;
  readonly modo: ModoFootprint;
  readonly fatorDiagonal: number;
  readonly larguraVelaPx: number;
  readonly podadas: number;
}): { readonly texto: string; readonly alerta: boolean } | null {
  const { comDado, total, modo, fatorDiagonal, larguraVelaPx, podadas } = dados;
  if (!fin(total) || total <= 0) return null;

  if (!fin(comDado) || comDado <= 0) {
    return {
      texto:
        `Footprint LIGADO, 0 de ${total} velas com dado — o livro materializado ` +
        `não cobre o trecho na tela. Use "Focar no dia do livro".`,
      alerta: true,
    };
  }

  const rotuloModo =
    modo === 'NUMEROS' ? 'números' : modo === 'BARRAS' ? 'barras' : 'delta';
  const partes = [
    `Footprint · ${comDado}/${total} velas com dado`,
    rotuloModo,
    'POC ── amarelo',
    `cor forte = desequilíbrio diagonal ≥ ${fin(fatorDiagonal) ? fatorDiagonal : 3}×`,
    '[ ] = alcance do dado',
  ];
  if (fin(podadas) && podadas > 0) {
    partes.push(`${podadas} velas antigas podadas pelo orçamento`);
  }
  // A largura da vela entra porque é ela que decide o modo efetivo: com o número
  // na tela, o operador sabe de quanto zoom precisa para ver `venda × compra`.
  if (fin(larguraVelaPx) && larguraVelaPx > 0) {
    partes.push(`vela ${Math.round(larguraVelaPx)} px`);
  }
  return { texto: partes.join(' · '), alerta: false };
}

/**
 * Largura de vela abaixo da qual **nada** deve ser desenhado.
 *
 * ⚠️ Existe porque a degradação `NUMEROS → BARRAS` não é suficiente. Medido na
 * tela do operador em 03/09/2026: com um pregão de M15 na tela, cada vela recebe
 * ~26 px; a barra espelhada de cada nível fica com ~1 px de cada lado e o
 * resultado é uma faixa de traços — ele relatou duas vezes, com razão, que não se
 * lê nada.
 *
 * Desenhar traços é PIOR que não desenhar: eles poluem a leitura das velas e
 * fazem o operador concluir que a camada está quebrada. Abaixo deste piso a
 * resposta correta é não desenhar e DIZER por quê.
 */
export const LARGURA_MINIMA_VELA_PX = 18;

/**
 * A vela é larga o bastante para o footprint significar algo?
 *
 * `false` ⇒ não desenhe; mostre o motivo. Puro, para o primitive e os testes
 * usarem o MESMO critério.
 */
export function velaAdmiteFootprint(
  larguraVelaPx: number,
  minimo: number = LARGURA_MINIMA_VELA_PX,
): boolean {
  if (!fin(larguraVelaPx) || larguraVelaPx <= 0) return false;
  if (!fin(minimo) || minimo <= 0) return true;
  return larguraVelaPx >= minimo;
}

/**
 * Emite as formas de UMA vela.
 *
 * ⚠️ Nível fora da escala de preço é DESCARTADO (o conversor devolve `null`) em
 * vez de desenhado na borda: encostar na borda inventaria um nível que o
 * operador leria como real.
 */
export function formasDaVela(
  vela: VelaFootprint,
  conv: Conversores,
  opcoes: OpcoesFootprint = OPCOES_FOOTPRINT_DEFAULT,
  paleta: PaletaFootprint = PALETA_FOOTPRINT_DEFAULT,
): FormaFootprint[] {
  const formas: FormaFootprint[] = [];
  if (vela.niveis.length === 0) return formas;

  const xc = conv.tempoParaX(vela.tempo);
  if (xc === null || !fin(xc)) return formas;

  const modo = modoEfetivo(opcoes.modo, conv.alturaNivelPx, conv.larguraVelaPx, opcoes);
  const alt = Math.max(1, conv.alturaNivelPx - 1);
  const meia = (conv.larguraVelaPx * opcoes.fracaoLargura) / 2;
  const diag = desequilibriosDiagonais(vela.niveis, opcoes.fatorDiagonal);
  const destaqueCompra = new Set(diag.compra);
  const destaqueVenda = new Set(diag.venda);

  for (let i = 0; i < vela.niveis.length; i++) {
    const nivel = vela.niveis[i];
    if (!nivel) continue;
    const y = conv.precoParaY(nivel.preco);
    if (y === null || !fin(y)) continue;
    const yTopo = y - alt / 2;

    if (modo === 'NUMEROS') {
      formas.push({
        tipo: 'texto',
        x: xc - 3,
        y,
        largura: 0,
        altura: alt,
        cor: destaqueVenda.has(i) ? paleta.vendaForte : paleta.textoVenda,
        texto: abreviar(nivel.venda),
        alinhamento: 'right',
      });
      formas.push({
        tipo: 'texto',
        x: xc + 3,
        y,
        largura: 0,
        altura: alt,
        cor: destaqueCompra.has(i) ? paleta.compraForte : paleta.textoCompra,
        texto: abreviar(nivel.compra),
        alinhamento: 'left',
      });
    } else if (modo === 'BARRAS') {
      // Espelhado a partir do centro: venda à esquerda, compra à direita.
      // A largura é proporcional ao MAIOR total da vela, não ao total do nível —
      // é o que permite comparar níveis entre si dentro da mesma vela.
      const base = vela.maiorTotal > 0 ? vela.maiorTotal : 1;
      const wv = (nivel.venda / base) * meia;
      const wc = (nivel.compra / base) * meia;
      if (wv > 0.3) {
        formas.push({
          tipo: 'retangulo',
          x: xc - wv, y: yTopo, largura: wv, altura: alt,
          cor: destaqueVenda.has(i) ? paleta.vendaForte : paleta.venda,
        });
      }
      if (wc > 0.3) {
        formas.push({
          tipo: 'retangulo',
          x: xc, y: yTopo, largura: wc, altura: alt,
          cor: destaqueCompra.has(i) ? paleta.compraForte : paleta.compra,
        });
      }
    } else {
      // DELTA: uma barra do centro para o lado que dominou, com opacidade
      // proporcional ao desequilíbrio. Resolve exatamente o que a cor única do
      // `deltaBars` perde — 60% e 98% ficam visivelmente diferentes.
      const base = vela.maiorTotal > 0 ? vela.maiorTotal : 1;
      const w = (Math.abs(nivel.delta) / base) * meia * 2;
      if (w > 0.3) {
        const forca = Math.min(1, Math.abs(nivel.desequilibrio));
        const alfa = 0.25 + 0.7 * forca;
        const cor = nivel.delta >= 0
          ? `rgba(34,197,94,${alfa.toFixed(3)})`
          : `rgba(239,68,68,${alfa.toFixed(3)})`;
        formas.push({
          tipo: 'retangulo',
          x: nivel.delta >= 0 ? xc : xc - w,
          y: yTopo, largura: w, altura: alt, cor,
        });
      }
    }

    if (opcoes.marcarPoc && vela.poc !== null && nivel.preco === vela.poc) {
      formas.push({
        tipo: 'linha',
        // ⚠️ Espessura 2, e a linha atravessa a vela INTEIRA em vez de só a faixa
        // das barras. O POC da vela é a informação mais acionável do footprint —
        // o nível que concentrou execução — e com 1 px sobre um corpo de vela
        // cheio ele simplesmente desaparecia.
        x: xc - conv.larguraVelaPx / 2, y, largura: conv.larguraVelaPx, altura: 0,
        cor: paleta.poc, espessura: 2, papel: 'poc',
      });
    }
  }

  // ── Colchetes de alcance: ONDE a camada TEM dado ────────────────────────────
  //
  // Emitidos por último, para ficarem sobre as barras. Ver `destacarVelas`.
  if (opcoes.destacarVelas && formas.length > 0) {
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const nivel of vela.niveis) {
      const yn = conv.precoParaY(nivel.preco);
      if (yn === null || !fin(yn)) continue;
      if (yn < yMin) yMin = yn;
      if (yn > yMax) yMax = yn;
    }
    if (fin(yMin) && fin(yMax)) {
      const meiaVela = conv.larguraVelaPx / 2;
      const meiaAlt = alt / 2;
      for (const yb of [yMin - meiaAlt, yMax + meiaAlt]) {
        formas.push({
          tipo: 'linha',
          x: xc - meiaVela, y: yb, largura: conv.larguraVelaPx, altura: 0,
          cor: paleta.neutro, espessura: 1, papel: 'alcance',
        });
      }
    }
  }

  return formas;
}

/**
 * Emite as formas de todas as velas visíveis, com teto de formas.
 *
 * ⚠️ O teto existe porque um dia inteiro em M1 tem ~500 velas × 40 níveis =
 * 20.000 níveis, e cada um gera até 3 formas. Estourar o orçamento de desenho
 * travaria o gráfico — e travar é pior que mostrar menos.
 *
 * A poda é por vela INTEIRA, do começo (mais antigo) para o fim: meia vela
 * desenhada é pior que vela ausente, porque parece leitura completa.
 */
export function formasVisiveis(
  velas: readonly VelaFootprint[],
  conv: Conversores,
  opcoes: OpcoesFootprint = OPCOES_FOOTPRINT_DEFAULT,
  paleta: PaletaFootprint = PALETA_FOOTPRINT_DEFAULT,
  maxFormas = 6000,
): { readonly formas: FormaFootprint[]; readonly velasDesenhadas: number; readonly podadas: number } {
  const formas: FormaFootprint[] = [];
  let desenhadas = 0;
  let podadas = 0;

  // Do mais RECENTE para o mais antigo: se faltar orçamento, o operador perde o
  // passado, não o presente.
  for (let i = velas.length - 1; i >= 0; i--) {
    if (formas.length >= maxFormas) { podadas = i + 1; break; }
    const vela = velas[i];
    if (!vela) continue;
    const f = formasDaVela(vela, conv, opcoes, paleta);
    if (f.length === 0) continue;
    formas.push(...f);
    desenhadas++;
  }

  return { formas, velasDesenhadas: desenhadas, podadas };
}
