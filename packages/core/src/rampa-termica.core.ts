/**
 * Rampa térmica do bookmap — a cor passa a codificar TAMANHO, não lado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ POR QUE EXISTE, E POR QUE A JUSTIFICATIVA ANTERIOR ERA FRACA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Em 04/09/2026 o operador disse: *"o Bookmap que eu vi em outros projetos sempre
 * era visual tipo o MarketProfile, por que você não foi por essa linha?"*.
 *
 * O nosso desenhava com **matiz = LADO** (verde para fila de compra, vermelho
 * para fila de venda) e **opacidade = intensidade**, em 16 níveis. Eu havia
 * registrado no steering que a rampa térmica foi uma decisão aberta, com a
 * justificativa de que *"com rampa térmica seria preciso outro canal para o
 * lado"*.
 *
 * ⚠️ **Essa justificativa não se sustenta.** No Bookmap comercial o lado não
 * precisa de canal de cor porque a **posição já diz**: fila acima do preço
 * corrente é venda, abaixo é compra. A cor fica livre para a magnitude, e é
 * exatamente isso que produz o aspecto de mapa de calor reconhecível.
 *
 * ⚠️ E o que a rampa NÃO resolve, para não prometer o que ela não entrega: o
 * balde do nosso bookmap é de **60 segundos** (`bookmap_depth` só tem esse
 * materializado), contra 1 segundo ou menos do comercial. Cada célula nossa é um
 * minuto inteiro achatado. Isso é limite de DADO e continua valendo depois desta
 * mudança — a cor deixa o heatmap reconhecível, não muda a resolução.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A RAMPA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Azul-marinho → azul → ciano → amarelo → laranja → branco-quente. É a família
 * das rampas perceptuais de calor, e a ordem importa por dois motivos:
 *
 *  - **Luminosidade monotônica.** Cada parada é mais clara que a anterior, então
 *    a rampa continua legível para quem não distingue matiz e sobrevive a uma
 *    captura de tela em escala de cinza. Rampa que sobe e desce de brilho (como
 *    arco-íris puro) perde a ordem.
 *  - **O topo é quase branco, não vermelho saturado.** Parede extrema tem de
 *    saltar, e num fundo escuro o branco salta mais que qualquer matiz.
 *
 * Puro e determinístico: sem DOM, sem relógio, sem I/O, sem estado de módulo.
 */

/** Uma parada da rampa: posição em `[0,1]` e a cor ali. */
export interface ParadaDaRampa {
  readonly t: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * As paradas, em ordem crescente de `t`.
 *
 * ⚠️ A primeira NÃO é preto: célula de fila pequena existe e tem de ser
 * distinguível do fundo do gráfico. Preto no pé da rampa apagaria metade das
 * células — é o mesmo defeito que o piso de opacidade de 0,06 causou em 03/09,
 * quando metade do heatmap ficou invisível.
 */
export const RAMPA_TERMICA: readonly ParadaDaRampa[] = [
  { t: 0.0, r: 24, g: 48, b: 108 }, // azul-marinho     L ≈  68
  { t: 0.2, r: 18, g: 92, b: 184 }, // azul             L ≈  80
  { t: 0.4, r: 16, g: 168, b: 190 }, // ciano           L ≈ 125
  { t: 0.6, r: 185, g: 195, b: 60 }, // amarelo         L ≈ 177
  { t: 0.8, r: 252, g: 185, b: 90 }, // laranja CLARO   L ≈ 194
  { t: 1.0, r: 255, g: 244, b: 232 }, // branco-quente  L ≈ 246
];

/*
 * ⚠️ **A TENSÃO QUE ESTA RAMPA RESOLVE, e ela é real.**
 *
 * A rampa canônica do bookmap comercial passa por **laranja e vermelho
 * saturados** perto do topo. Escrevi assim na primeira versão — e o teste de
 * monotonicidade de luminosidade reprovou, corretamente:
 *
 *     amarelo  (190, 200,  60)   L = 181,0
 *     laranja  (238, 128,  36)   L = 150,4   ← CAI 30 pontos
 *
 * Amarelo é mais claro que laranja saturado. Então "azul → ciano → amarelo →
 * laranja → vermelho → branco" **não** tem luminosidade crescente, e uma rampa
 * assim mente sobre a magnitude para quem não distingue matiz, além de perder a
 * ordem em captura de tela em cinza.
 *
 * Duas saídas eram possíveis:
 *   (a) abandonar a monotonicidade e copiar a rampa comercial ao pé da letra;
 *   (b) manter a família de cores reconhecível e **escolher tons que sejam ao
 *       mesmo tempo reconhecíveis e monotônicos**.
 *
 * Optei por (b): o laranja subiu para um tom CLARO (252, 185, 90), que continua
 * sendo lido como laranja e passa a ser mais claro que o amarelo. A sequência de
 * luminosidade fica 68 → 80 → 125 → 177 → 194 → 246, estritamente crescente, e o
 * visual continua o de brasa que o operador reconhece.
 *
 * ⚠️ Não trocar por vermelho saturado "porque é mais parecido": a semelhança
 * ganharia dois tons e a camada perderia a garantia de que cor mais clara
 * significa fila maior — que é a única coisa que a torna confiável.
 */

export interface CorRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Interpolação linear entre dois inteiros, arredondada. */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Cor da rampa na posição `t`.
 *
 * `t` fora de `[0,1]` é recortado, e `t` não finito cai no pé da rampa — nunca
 * devolve componente `NaN`, porque `rgba(NaN, …)` faz o canvas manter o
 * `fillStyle` anterior e a célula sai pintada com a cor da célula vizinha, sem
 * lançar e sem aparecer em log. É o mesmo modo de falha que o `clamp` de bucket
 * do primitive já previne do lado dele.
 *
 * Pura e determinística.
 */
export function corDaRampa(t: number): CorRgb {
  const x = !fin(t) ? 0 : t < 0 ? 0 : t > 1 ? 1 : t;

  // Rampa curta (6 paradas): varredura linear é mais rápida que busca binária e
  // não tem índice para errar.
  for (let i = 0; i < RAMPA_TERMICA.length - 1; i += 1) {
    const a = RAMPA_TERMICA[i]!;
    const b = RAMPA_TERMICA[i + 1]!;
    if (x >= a.t && x <= b.t) {
      const span = b.t - a.t;
      const local = span > 0 ? (x - a.t) / span : 0;
      return {
        r: lerp(a.r, b.r, local),
        g: lerp(a.g, b.g, local),
        b: lerp(a.b, b.b, local),
      };
    }
  }
  const ultima = RAMPA_TERMICA[RAMPA_TERMICA.length - 1]!;
  return { r: ultima.r, g: ultima.g, b: ultima.b };
}

/**
 * Paleta de `buckets` cadeias `rgba(...)`, do bucket 0 ao último.
 *
 * ⚠️ A opacidade sobe JUNTO com a cor, e não é redundância: no fundo escuro do
 * gráfico, cor quente com opacidade baixa fica lavada. Os dois canais na mesma
 * direção é o que dá a sensação de brasa do bookmap comercial.
 *
 * ⚠️ `+ 0,5` toma o CENTRO da faixa do bucket, igual ao `buildPalette` de lado.
 * A borda inferior do bucket 0 seria o pé exato da rampa e a do último ficaria
 * abaixo do topo, desperdiçando a extremidade que justamente marca a parede.
 *
 * Pura: mesma entrada, mesma saída. Sem alocação por passada — quem chama monta
 * uma vez por escala e reusa, porque alocar no laço de desenho aparece como
 * engasgo de coleta de lixo durante o arrasto.
 */
export function construirPaletaTermica(
  buckets: number,
  alphaMin: number,
  alphaMax: number,
): readonly string[] {
  const n = fin(buckets) && buckets >= 1 ? Math.floor(buckets) : 1;
  const aMin = fin(alphaMin) ? Math.min(Math.max(alphaMin, 0), 1) : 0;
  const aMaxBruto = fin(alphaMax) ? Math.min(Math.max(alphaMax, 0), 1) : 1;
  // Limites que colapsam ou invertem o intervalo achatam a opacidade no piso, em
  // vez de produzir amplitude negativa (que inverteria a leitura).
  const aMax = aMaxBruto > aMin ? aMaxBruto : aMin;
  const amplitude = aMax - aMin;

  const out: string[] = new Array<string>(n);
  for (let b = 0; b < n; b += 1) {
    const t = (b + 0.5) / n;
    const c = corDaRampa(t);
    const alpha = aMin + amplitude * t;
    out[b] = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha.toFixed(3)})`;
  }
  return out;
}

/**
 * Luminosidade relativa aproximada, para verificar a monotonicidade da rampa.
 *
 * Coeficientes de percepção (ITU-R BT.601). Existe para o TESTE poder afirmar
 * que a rampa é legível em escala de cinza — não é usada no desenho.
 */
export function luminancia(c: CorRgb): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}
