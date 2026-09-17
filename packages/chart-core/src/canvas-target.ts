/**
 * canvas-target — o alvo de desenho. Substitui `fancy-canvas` de terceiro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E, E POR QUE O CONTRATO E ESTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As camadas de canvas (bookmap, footprint, desenho) foram escritas contra o
 * `CanvasRenderingTarget2D` do `fancy-canvas`, e desenham dentro de
 * `useBitmapCoordinateSpace((scope) => ...)`, lendo `scope.horizontalPixelRatio` e
 * `scope.verticalPixelRatio`.
 *
 * Para NAO reescrever essas ~3.000 linhas, este arquivo reproduz o MESMO contrato
 * com o mesmo nome. A troca de terceiro por proprio vira troca de import, nao
 * reescrita de logica.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE `useBitmapCoordinateSpace` RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um canvas de alta densidade tem MAIS pixels fisicos que logicos: num monitor 2x,
 * 800 px CSS sao 1600 px de bitmap. Desenhar em coordenada CSS num contexto de
 * bitmap sairia na metade do tamanho e borrado.
 *
 * O "bitmap coordinate space" e desenhar em pixel FISICO, com as razoes
 * (`horizontalPixelRatio`, `verticalPixelRatio`) disponiveis para multiplicar a
 * geometria calculada em pixel logico. As camadas ja fazem essa multiplicacao a
 * mao (e por isso a fonte e desenhada em `Math.round(9 * vpr)`, etc.) — o contrato
 * so precisa entregar as razoes e um contexto ja escalado para o espaco certo.
 */

/**
 * O escopo entregue dentro do espaco de coordenada de bitmap.
 *
 * Os nomes sao IDENTICOS aos do `fancy-canvas` de proposito: e o que permite as
 * camadas existentes compilarem sem mudanca.
 */
export interface BitmapCoordinatesRenderingScope {
  /** O contexto 2D, com a transformacao para pixel fisico ja aplicada. */
  readonly context: CanvasRenderingContext2D;
  /** Largura da area em pixel de bitmap (fisico). */
  readonly bitmapSize: { readonly width: number; readonly height: number };
  /** Largura da area em pixel de media (CSS/logico). */
  readonly mediaSize: { readonly width: number; readonly height: number };
  /** Razao horizontal fisico/logico. Tipicamente o devicePixelRatio. */
  readonly horizontalPixelRatio: number;
  /** Razao vertical fisico/logico. */
  readonly verticalPixelRatio: number;
}

/** Escopo em espaco de MEDIA (CSS), para quem prefere desenhar em pixel logico. */
export interface MediaCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly mediaSize: { readonly width: number; readonly height: number };
}

/**
 * Alvo de desenho de um renderer de primitive.
 *
 * Mesma superficie do `CanvasRenderingTarget2D` do `fancy-canvas` que as camadas
 * consomem: `useBitmapCoordinateSpace` (o unico usado hoje) e
 * `useMediaCoordinateSpace` (declarado por completude).
 */
export interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace(fn: (scope: BitmapCoordinatesRenderingScope) => void): void;
  useMediaCoordinateSpace(fn: (scope: MediaCoordinatesRenderingScope) => void): void;
}

/**
 * Constroi um alvo de desenho sobre um contexto 2D real.
 *
 * ⚠️ **O par `save`/`restore` em torno de cada escopo NAO e opcional.**
 * `useBitmapCoordinateSpace` aplica uma transformacao de escala (`setTransform`);
 * sem restaurar, a transformacao vazaria para o proximo escopo e para a proxima
 * camada, e cada passada desenharia num sistema de coordenada progressivamente
 * mais deslocado. As camadas do bookmap dependem desse contrato — elas ate
 * documentam por que fazem o proprio `save`/`restore` INTERNO alem deste.
 *
 * @param ctx     contexto 2D
 * @param mediaW  largura logica (CSS)
 * @param mediaH  altura logica (CSS)
 * @param dprX    razao horizontal fisico/logico
 * @param dprY    razao vertical fisico/logico
 */
export function createCanvasTarget(
  ctx: CanvasRenderingContext2D,
  mediaW: number,
  mediaH: number,
  dprX: number,
  dprY: number,
  /**
   * ⭐⭐ ORIGEM da area, em pixel LOGICO — e ela corrige um defeito latente.
   *
   * ⚠️ `useBitmapCoordinateSpace` faz `setTransform(1,0,0,1,0,0)`, que DESCARTA qualquer
   * `translate` que o chamador tenha aplicado. Para a camada isso e o contrato (ela recebe um
   * contexto sem escala e multiplica a geometria a mao), mas tem um efeito colateral que
   * passou anos invisivel: a origem da pane sumia junto.
   *
   * Invisivel porque toda primitive existente (bookmap, footprint, perfil de volume) e
   * anexada a serie da pane PRINCIPAL, onde a origem e (0,0) — descartar zero nao muda nada.
   * Uma primitive anexada a serie de um sub-painel ja desenhava em Y absoluto errado, e seria
   * engolida pelo recorte da pane. Com a grade em COLUNAS, erraria X tambem.
   *
   * ⚠️ Passada por DADO e reaplicada DENTRO do escopo, e nao deixada na transformacao de
   * fora: e a unica forma que sobrevive ao `setTransform` que o proprio contrato exige.
   *
   * Default `0,0` — a pane principal continua byte-identica.
   */
  originX = 0,
  originY = 0,
): CanvasRenderingTarget2D {
  const mediaSize = { width: mediaW, height: mediaH } as const;
  const bitmapSize = {
    width: Math.round(mediaW * dprX),
    height: Math.round(mediaH * dprY),
  } as const;

  return {
    useBitmapCoordinateSpace(fn): void {
      ctx.save();
      try {
        // A camada recebe um contexto SEM escala aplicada e as razoes por fora:
        // e assim que o `fancy-canvas` opera e como as camadas esperam — elas
        // multiplicam a geometria por `hpr`/`vpr` a mao. Aplicar a escala aqui
        // faria a camada multiplicar duas vezes.
        //
        // ⭐ A ORIGEM entra na propria matriz, em pixel de BITMAP (a camada desenha em
        // bitmap aqui). Com origem (0,0) e exatamente o `setTransform` de antes.
        ctx.setTransform(1, 0, 0, 1, originX * dprX, originY * dprY);
        fn({
          context: ctx,
          bitmapSize,
          mediaSize,
          horizontalPixelRatio: dprX,
          verticalPixelRatio: dprY,
        });
      } finally {
        ctx.restore();
      }
    },

    useMediaCoordinateSpace(fn): void {
      ctx.save();
      try {
        // Em espaco de media a escala do dpr E aplicada, para a camada desenhar em
        // pixel logico e o resultado sair nitido no bitmap. A origem entra em bitmap
        // tambem — `setTransform` define a matriz inteira, e o deslocamento e o par
        // (e, f) dela, sempre no espaco de destino.
        ctx.setTransform(dprX, 0, 0, dprY, originX * dprX, originY * dprY);
        fn({ context: ctx, mediaSize });
      } finally {
        ctx.restore();
      }
    },
  };
}
