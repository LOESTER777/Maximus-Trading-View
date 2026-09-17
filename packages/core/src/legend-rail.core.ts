/**
 * A TRILHA DE LEGENDAS — um canto, uma fila, sem sobreposição.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO RESOLVE, COM AS PALAVRAS DE QUEM O VIU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"o bookmap ainda está em cima do histograma de volume, ele precisa ficar no topo
 * alinhado ao lado de quem está lá, pois pode haver outros componentes"*.
 *
 * ⭐ O pedido é arquitetural, não cosmético. Havia **cinco donos de canto**, nenhum
 * coordenado, e a coordenação existia só em comentário de código:
 *
 * | camada | canto | como decidia |
 * |---|---|---|
 * | `ChartLegend` (HTML) | topo-esq. | `top: 8; left: 10` fixo |
 * | bookmap · legenda | topo **ou** base-esq. | opção binária `posicaoLegenda` |
 * | bookmap · rodapé | base-esq. | fixo |
 * | perfil de volume | base-esq. (e topo quando vazio) | fixo |
 * | footprint | base-esq. | fixo, com comentário "o topo é do bookmap" |
 *
 * Cada correção anterior EMPURROU o texto para outro canto e a colisão reapareceu ali.
 * O bookmap foi para baixo para fugir da fita de O/H/L/C — e "baixo" é onde vivem os 15%
 * do histograma de volume, que nenhuma primitive sabe que existem (a faixa vem de
 * `scaleMargins` numa escala de overlay, invisível para a camada). Trocou-se uma colisão
 * por outra, duas vezes.
 *
 * ⭐ A saída não é um sexto canto: é **parar de cada camada escolher canto**. A camada
 * PUBLICA as linhas dela; um lugar só as empilha, na ordem declarada aqui. Enfileirar é
 * a única operação que garante ausência de sobreposição sem ninguém precisar saber da
 * geometria dos outros — e ainda entrega o alinhamento que o operador pediu.
 *
 * ⚠️ Este módulo é `.core`: função total, determinística, sem DOM. Ele decide ORDEM e
 * IDENTIDADE, nunca pixel. Quem desenha (HTML na `ChartLegend`, ou canvas se o
 * consumidor preferir) recebe a fila pronta.
 */

/** Quem pode publicar na trilha. Conjunto FECHADO — ver `ORDEM_DA_TRILHA`. */
export type FonteDeLegenda = 'preco' | 'indicadores' | 'livro' | 'footprint' | 'perfil';

/**
 * Uma entrada da trilha.
 *
 * `linhas` é o texto já pronto, em pt-BR, na ordem de leitura. A camada é quem sabe o
 * que dizer — este módulo não formata nada.
 *
 * `alerta` sobe a entrada para o estilo de ressalva (âmbar). É o mesmo vocabulário de
 * cor que as camadas já usam para hachura e cobertura incompleta, e por isso viaja aqui
 * em vez de a interface tentar adivinhar por conteúdo do texto.
 */
export interface NotaDeLegenda {
  readonly fonte: FonteDeLegenda;
  readonly linhas: readonly string[];
  readonly alerta?: boolean;
}

/**
 * A ordem da fila, de cima para baixo.
 *
 * ⭐ Não é alfabética nem ordem de chegada: é ordem de LEITURA de mesa. O que identifica
 * o ativo vem primeiro porque responde "o que estou vendo"; o fluxo de ordem
 * (livro/footprint) vem antes do perfil porque muda a cada tick, enquanto o perfil é
 * contexto acumulado.
 *
 * ⚠️ Ordem de CHEGADA seria instável: as camadas publicam em quadros diferentes e a
 * mesma tela mostraria a fila em ordens distintas entre sessões. Fila que se reordena
 * sozinha obriga o operador a reler tudo a cada quadro — é pior que ordem "errada".
 */
export const ORDEM_DA_TRILHA: readonly FonteDeLegenda[] = [
  'preco',
  'indicadores',
  'livro',
  'footprint',
  'perfil',
];

/**
 * Enfileira as notas na ordem canônica, descartando as vazias.
 *
 * ⚠️ Nota sem linha nenhuma é DESCARTADA, e não enfileirada vazia: uma camada desligada
 * publica `[]`, e uma entrada vazia na fila abriria um buraco visual que o operador leria
 * como "algo deveria estar aqui". Silêncio é a ausência da entrada.
 *
 * ⚠️ Linha vazia ou só com espaço também sai. É o resultado natural de interpolar um
 * campo ausente (`Livro · ${grandeza}` com grandeza vazia), e uma linha em branco na
 * trilha empurra as de baixo sem informar nada.
 *
 * Determinística e total: entrada em qualquer ordem, com fontes repetidas ou desconhecidas,
 * sempre produz a mesma fila. Fonte repetida é MANTIDA (duas panes podem publicar como
 * `'indicadores'`), preservando a ordem relativa de chegada dentro do mesmo grupo — é a
 * única ordem que existe para desempate, e é estável porque vem de quem chamou.
 */
export function enfileirarNotas(notas: readonly NotaDeLegenda[]): readonly NotaDeLegenda[] {
  const limpas: NotaDeLegenda[] = [];
  for (const nota of notas) {
    const linhas = nota.linhas.filter((l) => typeof l === 'string' && l.trim().length > 0);
    if (linhas.length === 0) continue;
    limpas.push({ ...nota, linhas });
  }

  const fila: NotaDeLegenda[] = [];
  for (const fonte of ORDEM_DA_TRILHA) {
    for (const nota of limpas) {
      if (nota.fonte === fonte) fila.push(nota);
    }
  }
  // Fonte fora do conjunto fechado vai para o fim, em vez de desaparecer: perder texto
  // em silêncio é o pior desfecho possível para uma camada de diagnóstico.
  for (const nota of limpas) {
    if (!ORDEM_DA_TRILHA.includes(nota.fonte)) fila.push(nota);
  }
  return fila;
}

/**
 * Quantas LINHAS a fila ocupa. É a medida que quem desenha precisa para reservar altura.
 *
 * Existe como função para não haver duas contagens divergentes: quem reserva o espaço e
 * quem desenha têm de concordar, e a divergência apareceria como texto cortado na borda.
 */
export function alturaEmLinhas(fila: readonly NotaDeLegenda[]): number {
  let total = 0;
  for (const nota of fila) total += nota.linhas.length;
  return total;
}

/**
 * As notas são iguais? Comparação por CONTEÚDO.
 *
 * ⭐ Existe para a publicação não disparar re-renderização a cada quadro. As camadas
 * remontam o texto na passada de desenho — 60 vezes por segundo, quase sempre com o
 * mesmo conteúdo — e comparar por identidade de array veria "mudou" sempre. Foi
 * exactamente esse tipo de comparação por referência que causou o laço infinito de
 * `useAlerts` com `bars` literal.
 */
export function notasIguais(
  a: readonly NotaDeLegenda[],
  b: readonly NotaDeLegenda[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.fonte !== y.fonte) return false;
    if ((x.alerta === true) !== (y.alerta === true)) return false;
    if (x.linhas.length !== y.linhas.length) return false;
    for (let j = 0; j < x.linhas.length; j++) {
      if (x.linhas[j] !== y.linhas[j]) return false;
    }
  }
  return true;
}
