/**
 * animation.core — a matemática da transição do eixo de tempo. PURA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mudanças de janela feitas por CÓDIGO — `fitContent()`, "ir para esta data",
 * `resetViewport()` do engine, restaurar um layout salvo — trocavam o eixo de um
 * quadro para o outro. O salto é desorientador: o operador não vê para onde a tela
 * foi, e perde a referência de onde estava. Animar a transição transforma o corte em
 * um movimento que a vista acompanha.
 *
 * ⚠️ **Só a mudança PROGRAMÁTICA é animada.** Pan e zoom do usuário nunca: o eixo
 * tem de acompanhar o dedo/roda no mesmo quadro, e interpolar ali produziria a
 * sensação de arrasto emborrachado — o defeito clássico de quem anima input direto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ POR QUE ANIMAR SÓ O EIXO DE TEMPO — E O PREÇO VIR DE GRAÇA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A escala de PREÇO é recalculada a cada quadro pela autoescala, a partir da janela
 * visível. Se a janela se move em rampa, a faixa de preço acompanha em rampa, sozinha
 * — a animação do preço é consequência, não código.
 *
 * ⚠️ E animar o preço DIRETAMENTE seria pior que inútil: a autoescala roda depois e
 * sobrescreveria a interpolação a cada quadro. Duas fontes disputando o mesmo estado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE NÚCLEO NÃO TEM RELÓGIO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `agora` chega por parâmetro (o timestamp do `requestAnimationFrame`), como o `time`
 * chega na amostra do motor de alertas. Assim a animação é determinística e testável
 * sem esperar tempo real: alimentar 0, 100, 200 ms produz sempre os mesmos quadros.
 */

/** Duração default de uma transição de eixo, em milissegundos. */
export const ANIMATION_DEFAULT_MS = 260;

/**
 * O estado de uma transição em curso.
 *
 * Guarda ORIGEM e DESTINO, não "quanto falta": recalcular a partir das duas pontas a
 * cada quadro é imune a acúmulo de erro e a quadro perdido. Uma implementação
 * incremental ("mova 10% do que falta por quadro") depende da cadência do
 * `requestAnimationFrame`, e numa aba em segundo plano — onde os quadros param —
 * chegaria ao destino em tempo arbitrário.
 */
export interface TimeScaleAnimation {
  readonly deLeftLogical: number;
  readonly paraLeftLogical: number;
  readonly deBarSpacing: number;
  readonly paraBarSpacing: number;
  /** Timestamp do início, na mesma base de `agora`. */
  readonly inicio: number;
  readonly duracaoMs: number;
}

/**
 * Suavização `ease-out` cúbica: parte rápido e desacelera no fim.
 *
 * ⚠️ `ease-out`, e não `ease-in-out`, por um motivo de percepção: a transição de
 * viewport é uma RESPOSTA a um comando do operador (ele clicou em "enquadrar"), e uma
 * resposta que começa devagar é lida como travamento. Começar rápido dá retorno
 * imediato; desacelerar no fim é o que deixa a vista pousar no destino em vez de
 * bater nele.
 *
 * Total: entrada fora de `[0,1]` é recortada, e `NaN` cai em 1 (a transição termina
 * em vez de congelar num quadro intermediário para sempre).
 */
export function easeOutCubic(t: number): number {
  if (!Number.isFinite(t)) return 1;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Fração decorrida da transição, em `[0,1]`.
 *
 * ⚠️ Duração não-positiva devolve 1 — "termine agora". É o caminho que faz
 * `durationMs: 0` significar "sem animação" sem nenhum ramo especial no motor, e o
 * que impede uma divisão por zero de virar `NaN` no meio da interpolação.
 *
 * ⚠️ Também devolve 1 quando `agora` vem ANTES do início. Relógio que anda para trás
 * acontece (`performance.now` é monotônico, mas um `inicio` de outra base de tempo
 * não): a alternativa seria a animação ficar presa até o relógio alcançar o início.
 * Terminar é o pior caso aceitável; congelar a tela não é.
 */
export function animationProgress(anim: TimeScaleAnimation, agora: number): number {
  if (!(anim.duracaoMs > 0)) return 1;
  if (!Number.isFinite(agora) || agora < anim.inicio) return 1;
  const decorrido = agora - anim.inicio;
  if (decorrido >= anim.duracaoMs) return 1;
  return decorrido / anim.duracaoMs;
}

/**
 * O estado do eixo no instante `agora`.
 *
 * ⭐ `barSpacing` é interpolado GEOMETRICAMENTE (em log), não linearmente, e isso é a
 * decisão que faz o zoom parecer certo.
 *
 * Zoom é multiplicativo: ir de 2 px/barra a 32 px/barra é "quatro dobras", e cada
 * dobra tem de custar o mesmo tempo. Na interpolação linear, a primeira metade do
 * tempo cobre de 2 a 17 px (mais de três dobras) e a segunda metade cobre de 17 a 32
 * (menos de uma) — visualmente, um solavanco no começo e uma arrastada no fim, mesmo
 * com a suavização aplicada. Em log, cada quadro multiplica por um fator constante e
 * a percepção é de velocidade uniforme.
 *
 * `leftLogical` é interpolado linearmente porque é uma POSIÇÃO, e posição é aditiva.
 *
 * ⚠️ Espaçamento não-positivo cai na interpolação linear: `Math.log` de zero é
 * `-Infinity` e envenenaria o resultado. Não deveria acontecer (o eixo mantém um piso
 * de espaçamento), e mesmo assim não pode produzir `NaN` no desenho.
 */
export function animationState(
  anim: TimeScaleAnimation,
  agora: number,
): { readonly leftLogical: number; readonly barSpacing: number } {
  const t = easeOutCubic(animationProgress(anim, agora));

  const left = anim.deLeftLogical + (anim.paraLeftLogical - anim.deLeftLogical) * t;

  const a = anim.deBarSpacing;
  const b = anim.paraBarSpacing;
  const barSpacing =
    a > 0 && b > 0 ? Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t) : a + (b - a) * t;

  return { leftLogical: left, barSpacing };
}

/**
 * A transição vale a pena, ou o destino é indistinguível da origem?
 *
 * ⚠️ Existe para não animar o que não se move. Um `fitContent()` sobre uma janela já
 * enquadrada agendaria uma animação de 260 ms que pinta o mesmo quadro dezenas de
 * vezes — trabalho invisível, e pior: enquanto ela corre, qualquer interação do
 * usuário a cancelaria, o que faz o motor tratar como "houve animação" algo que nunca
 * teve efeito.
 *
 * Os limiares são de PERCEPÇÃO: um vigésimo de barra de deslocamento e 1% de zoom
 * estão abaixo do que se vê num monitor.
 */
export function animationWorthwhile(
  deLeftLogical: number,
  paraLeftLogical: number,
  deBarSpacing: number,
  paraBarSpacing: number,
): boolean {
  if (
    !Number.isFinite(deLeftLogical) ||
    !Number.isFinite(paraLeftLogical) ||
    !Number.isFinite(deBarSpacing) ||
    !Number.isFinite(paraBarSpacing)
  ) {
    return false;
  }
  const deslocou = Math.abs(paraLeftLogical - deLeftLogical) > 0.05;
  const razao = deBarSpacing > 0 ? paraBarSpacing / deBarSpacing : 1;
  const zoomou = Math.abs(razao - 1) > 0.01;
  return deslocou || zoomou;
}
