/**
 * alert-line.core — o ALERTA DESENHADO no gráfico, e não só numa lista.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O motor de alerta já vigiava o nível e já sabia distinguir ARMADO de DISPARADO. O que
 * faltava era isso aparecer NO GRÁFICO: o operador via uma lista no painel lateral e tinha de
 * traduzir "cruzar 130.100" para uma altura na tela — enquanto o preço andava.
 *
 * ⭐ E o estado importa visualmente, não só como texto. Um alerta ARMADO é uma pergunta em
 * aberto ("o preço vai chegar ali?") e um DISPARADO é fato consumado. Desenhar os dois iguais
 * faz o operador reagir a um nível que já não vigia nada.
 *
 * ⚠️ Este módulo devolve um DESCRITOR estrutural — cor, tracejado, título, preço. Ele **não**
 * importa o motor de gráfico, e a razão é a regra do pacote: `alerts` é uma ILHA (zero
 * dependência, sem DOM). Importar o contrato de linha de preço aqui amarraria o motor de
 * alerta ao motor de desenho, e quem só quer vigiar nível num robô sem tela passaria a
 * carregar canvas.
 *
 * ⚠️ `.core` = PURO: sem relógio, sem DOM, total e determinístico.
 */

import type { AlertState } from './alert-engine.core.js';
import type { AlertCondition } from './conditions.js';

/**
 * O descritor de uma linha de alerta. Casa ESTRUTURALMENTE com `PriceLineOptions` do motor.
 *
 * ⚠️ `lineStyle` é numérico porque é a convenção do substrato (0 sólido, 2 tracejado). Um
 * enum próprio aqui exigiria uma tabela de tradução no consumidor — e uma tabela a mais é uma
 * divergência a mais.
 */
export interface LinhaDeAlerta {
  readonly price: number;
  readonly color: string;
  readonly title: string;
  readonly lineStyle: number;
  readonly lineWidth: number;
}

/** Âmbar: a cor de RESSALVA do projeto, a mesma da hachura e da cobertura incompleta. */
const COR_ARMADO = 'rgba(251, 191, 36, 0.9)';

/**
 * Disparado sai em CIANO, e não em vermelho ou verde.
 *
 * ⚠️ Verde e vermelho já significam ALTA e BAIXA em todo pixel deste gráfico — vela, volume,
 * delta, zona de posição. Um alerta disparado em vermelho seria lido como "queda", que é
 * afirmação sobre o mercado e não sobre o alerta. Ciano não colide com nada.
 */
const COR_DISPARADO = 'rgba(34, 211, 238, 0.95)';

/** Sólido para disparado, tracejado para armado. Ver `linhaDeAlerta`. */
const ESTILO_SOLIDO = 0;
const ESTILO_TRACEJADO = 2;

/**
 * O NÍVEL que uma condição vigia, ou `null` quando ela não é de nível.
 *
 * ⚠️ `null` é resposta legítima e frequente: `PERCENT_CHANGE` vigia uma VARIAÇÃO e
 * `SERIES_CROSS` vigia o encontro de duas séries — nenhuma das duas tem um preço fixo para
 * desenhar. Inventar um (o nível de referência, o preço atual) poria uma linha na tela que
 * não corresponde a nada que o motor está vigiando, e o operador confiaria nela.
 *
 * ⭐ `ENTER_ZONE`/`EXIT_ZONE` têm DOIS níveis, e por isso devolvem os dois: a zona só se lê
 * com as duas bordas. Desenhar uma faria o operador ver metade da armadilha.
 */
export function niveisDaCondicao(condicao: AlertCondition): readonly number[] {
  switch (condicao.kind) {
    case 'CROSS_ABOVE':
    case 'CROSS_BELOW':
      return Number.isFinite(condicao.level) ? [condicao.level] : [];
    case 'TOUCH':
      return Number.isFinite(condicao.level) ? [condicao.level] : [];
    case 'ENTER_ZONE':
    case 'EXIT_ZONE': {
      const a = condicao.min;
      const b = condicao.max;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
      // Ordenadas para o consumidor poder rotular "de/até" sem reordenar.
      return a <= b ? [a, b] : [b, a];
    }
    default:
      // `PERCENT_CHANGE`, `SERIES_CROSS` e qualquer condição futura sem nível fixo.
      return [];
  }
}

/** Rótulo curto da condição, em pt-BR. */
export function rotuloDaCondicao(condicao: AlertCondition): string {
  switch (condicao.kind) {
    case 'CROSS_ABOVE':
      return 'Cruzar ↑';
    case 'CROSS_BELOW':
      return 'Cruzar ↓';
    case 'TOUCH':
      return 'Tocar';
    case 'ENTER_ZONE':
      return 'Entrar na faixa';
    case 'EXIT_ZONE':
      return 'Sair da faixa';
    case 'PERCENT_CHANGE':
      return 'Variação %';
    case 'SERIES_CROSS':
      return 'Cruzamento de séries';
    default:
      return 'Alerta';
  }
}

/**
 * As linhas a desenhar para um alerta. Vazio quando a condição não é de nível.
 *
 * ⭐ **O estado vira APARÊNCIA, e a distinção é a razão de a função existir:**
 *
 * | estado | traço | cor | por quê |
 * |---|---|---|---|
 * | `ARMED` | tracejado | âmbar | pergunta em aberto; tracejado lê como "provisório" |
 * | `TRIGGERED` | sólido, mais grosso | ciano | fato consumado; sólido lê como "aconteceu" |
 *
 * ⚠️ O título diz o ESTADO, e não só o nome. "Cruzar ↑ 130.100" numa linha que já disparou
 * faz o operador continuar esperando um evento que já passou — e num modo `once` ela não
 * vigia mais nada.
 */
export function linhaDeAlerta(params: {
  readonly condicao: AlertCondition;
  readonly estado: AlertState;
  /** Prefixo do rótulo (o nome que o operador deu). Ausente usa o rótulo da condição. */
  readonly nome?: string;
  /** Casas decimais do preço no rótulo. Default 1. */
  readonly precisao?: number;
}): readonly LinhaDeAlerta[] {
  const { condicao, estado } = params;
  const niveis = niveisDaCondicao(condicao);
  if (niveis.length === 0) return [];

  const disparado = estado === 'TRIGGERED';
  const base = params.nome ?? rotuloDaCondicao(condicao);
  const precisao = Number.isFinite(params.precisao) ? (params.precisao as number) : 1;

  return niveis.map((price, i) => ({
    price,
    color: disparado ? COR_DISPARADO : COR_ARMADO,
    // Mais grosso quando disparou: é o que faz a mudança ser percebida pelo canto do olho,
    // sem o operador estar olhando para aquele nível.
    lineWidth: disparado ? 2 : 1,
    lineStyle: disparado ? ESTILO_SOLIDO : ESTILO_TRACEJADO,
    title:
      // Zona: as duas bordas ganham sufixo, senão duas linhas idênticas no rótulo.
      (niveis.length > 1 ? `${base} ${i === 0 ? '(piso)' : '(teto)'}` : base) +
      ` ${price.toFixed(precisao)}` +
      (disparado ? ' · disparado' : ''),
  }));
}

/**
 * Todas as linhas de uma coleção de alertas, prontas para o motor.
 *
 * ⚠️ Alerta sem nível é OMITIDO em silêncio aqui — e é correto: a lista do painel continua
 * mostrando ele, com estado e tudo. O que não existe é uma altura na tela para ele, e a
 * ausência da linha é a verdade sobre isso.
 */
export function linhasDeAlertas(
  alertas: readonly {
    readonly condicao: AlertCondition;
    readonly estado: AlertState;
    readonly nome?: string;
  }[],
  precisao = 1,
): readonly LinhaDeAlerta[] {
  const saida: LinhaDeAlerta[] = [];
  for (const a of alertas) {
    for (const l of linhaDeAlerta({ ...a, precisao })) saida.push(l);
  }
  return saida;
}
