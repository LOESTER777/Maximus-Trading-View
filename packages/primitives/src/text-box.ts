/**
 * Caixa de contraste para texto desenhado sobre a área de plotagem.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE MOTIVOU ESTE MÓDULO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As duas camadas deste pacote escreviam texto direto no canvas do gráfico, com
 * uma sombra de um pixel como única defesa de legibilidade. A sombra foi pensada
 * para fundo escuro e uniforme; sobre a mancha de calor saturada do bookmap, ou
 * sobre o corpo claro de uma vela, o texto continua ilegível.
 *
 * Em 04/09/2026 o usuário fotografou o playground: legenda do livro sobre as
 * velas, rodapé de cobertura sobre o eixo de tempo, aviso do footprint no mesmo
 * canto da legenda do livro — texto empilhado sobre texto, tudo em cinza claro
 * sobre fundo variável. Uma caixa opaca resolve por construção: o texto passa a
 * ter fundo próprio em vez de herdar o que estiver embaixo.
 *
 * ⚠️ **A caixa é desenhada por CAMINHO (`beginPath`/`rect`/`fill`), nunca por
 * `fillRect` nem `strokeRect`.** Não é estilo: as bancadas herdadas contam
 * `fillRect` como "célula desenhada" e `strokeRect` como "contorno de estouro de
 * escala", e afirmam **zero** dos dois em estados que ainda desenham texto (a
 * camada autodesativada é um deles). Uma caixa por `fillRect` seria contada como
 * célula e quebraria asserção herdada sem que nada estivesse errado na camada.
 *
 * Convenções: comentários em pt-BR; nada aqui lança.
 */

/** Fundo da caixa — slate-900 quase opaco. */
export const TEXT_BOX_STYLE = 'rgba(15, 23, 42, 0.82)';

/** Folga entre o texto e a borda da caixa, em pixels lógicos. */
export const TEXT_BOX_PAD_PX = 5;

/**
 * Largura média de caractere, em fração do corpo da fonte. **Só o caminho de
 * emergência** — ver `larguraDoTexto`.
 */
const TEXT_CHAR_W_RATIO = 0.55;

/**
 * Largura de um texto em pixels, com caminho de emergência.
 *
 * ⚠️ `measureText` é o caminho correto e é o preferido aqui, mas **não pode ser
 * exigido**: os contextos 2D falsos das bancadas implementam só o que a passada
 * usava, e `measureText` não estava nessa lista. A chamada sem guarda lançaria
 * `TypeError` dentro do desenho — a camada se autodesativaria e a suíte herdada
 * passaria a medir o dublê. A estimativa por contagem de caractere erra a caixa
 * em alguns pixels e nunca derruba nada; errar a caixa é acabamento, derrubar a
 * camada é defeito.
 *
 * Nunca lança: qualquer falha cai na estimativa.
 */
export function larguraDoTexto(
  ctx: CanvasRenderingContext2D,
  texto: string,
  fontPx: number,
): number {
  try {
    const medir = (ctx as { measureText?: (t: string) => { width: number } }).measureText;
    if (typeof medir === 'function') {
      const w = medir.call(ctx, texto).width;
      if (Number.isFinite(w) && w > 0) return w;
    }
  } catch {
    /* contexto sem métrica de texto: cai na estimativa abaixo */
  }
  return texto.length * fontPx * TEXT_CHAR_W_RATIO;
}

/**
 * Preenche a caixa de um bloco de texto, recortada ao painel.
 *
 * O recorte é aritmético, não por `clip`: a área de recorte da passada é assunto
 * de quem desenha forma (as bolhas de execução do bookmap usam `clip`), e
 * empilhar um segundo recorte aqui misturaria dois estados de canvas sem relação.
 * Limitar a caixa à borda do painel basta — o que se quer evitar é ela invadir a
 * escala de preço.
 *
 * Caixa degenerada (largura ou altura não positiva depois do recorte) não é
 * desenhada: retângulo de zero pixel não dá contraste e ainda trocaria
 * `fillStyle` sem motivo.
 *
 * ⚠️ **O trio `beginPath`/`rect`/`fill` é VERIFICADO antes de ser usado, e a
 * ausência de qualquer um deles cancela a caixa em silêncio.** Não é paranoia: a
 * bancada de desempenho do bookmap (`packages/devtools`) tem `beginPath` e `rect`
 * e **não** tem `fill`, porque implementa exatamente o que a passada usava antes
 * desta mudança. Sem a guarda, a chamada lançava `TypeError` dentro do desenho, a
 * camada se autodesativava, e a bancada media uma camada morta — dois casos de lá
 * passaram a falhar por "zero retângulos" e por degradação de orçamento que nunca
 * disparava. Sintoma distante da causa, exatamente o tipo de defeito que a
 * degradação silenciosa evita.
 *
 * É o mesmo critério que o código de produção já aplicava a `ctx.filter`: a caixa
 * é ACABAMENTO, e acabamento que não pode ser desenhado não derruba a camada. Sem
 * ela o texto continua saindo com a sombra de um pixel, como sempre saiu.
 */
export function desenharCaixaDeTexto(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  largura: number,
  altura: number,
  limiteLargura: number,
  limiteAltura: number,
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const w0 = Math.min(Math.round(largura), limiteLargura - x0);
  const h0 = Math.min(Math.round(altura), limiteAltura - y0);
  if (w0 <= 0 || h0 <= 0) return;

  const caminho = ctx as unknown as {
    beginPath?: unknown;
    rect?: unknown;
    fill?: unknown;
  };
  if (
    typeof caminho.beginPath !== 'function' ||
    typeof caminho.rect !== 'function' ||
    typeof caminho.fill !== 'function'
  ) {
    return;
  }

  try {
    ctx.fillStyle = TEXT_BOX_STYLE;
    ctx.beginPath();
    ctx.rect(x0, y0, w0, h0);
    ctx.fill();
  } catch {
    /* contexto sem caminho utilizável: o texto sai sem caixa, como antes */
  }
}
