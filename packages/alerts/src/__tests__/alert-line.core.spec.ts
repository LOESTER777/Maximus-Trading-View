/**
 * O alerta DESENHADO: o estado virando aparência.
 *
 * ⭐ O que estes testes travam são as três decisões que fazem a linha não mentir:
 *
 *  1. condição SEM nível fixo não produz linha — inventar um poria na tela um preço que o
 *     motor não vigia, e o operador confiaria nele;
 *  2. zona produz DUAS linhas — desenhar uma faria ver metade da armadilha;
 *  3. o estado muda traço, cor E título — desenhar armado igual a disparado faz o operador
 *     esperar um evento que já passou.
 */
import { describe, expect, it } from 'vitest';
import {
  linhaDeAlerta,
  linhasDeAlertas,
  niveisDaCondicao,
  rotuloDaCondicao,
} from '../alert-line.core.js';
import type { AlertCondition } from '../conditions.js';

const CRUZAR_ACIMA: AlertCondition = { kind: 'CROSS_ABOVE', level: 130_100 };
const ZONA: AlertCondition = { kind: 'ENTER_ZONE', min: 100, max: 200 };

describe('niveisDaCondicao — só o que a condição realmente vigia', () => {
  it('condição de nível devolve o nível', () => {
    expect(niveisDaCondicao(CRUZAR_ACIMA)).toEqual([130_100]);
    expect(niveisDaCondicao({ kind: 'CROSS_BELOW', level: 50 })).toEqual([50]);
    expect(niveisDaCondicao({ kind: 'TOUCH', level: 75 })).toEqual([75]);
  });

  it('⭐ zona devolve as DUAS bordas, ordenadas', () => {
    // A zona só se lê com as duas: desenhar uma faria o operador ver metade da armadilha.
    expect(niveisDaCondicao(ZONA)).toEqual([100, 200]);
    // Invertida pelo consumidor? Sai ordenada, para o rótulo "piso/teto" não mentir.
    expect(niveisDaCondicao({ kind: 'EXIT_ZONE', min: 200, max: 100 })).toEqual([100, 200]);
  });

  it('⭐⭐ condição SEM nível fixo devolve vazio', () => {
    // `PERCENT_CHANGE` vigia uma variação e `SERIES_CROSS` vigia o encontro de duas séries.
    // Inventar um preço (o de referência, o atual) poria na tela uma linha que não
    // corresponde a nada que o motor vigia — e o operador confiaria nela.
    expect(niveisDaCondicao({ kind: 'PERCENT_CHANGE', percent: 2 } as never)).toEqual([]);
    expect(
      niveisDaCondicao({ kind: 'SERIES_CROSS', direction: 'both' } as never),
    ).toEqual([]);
  });

  it('nível não finito é descartado, nunca vira coordenada NaN', () => {
    expect(niveisDaCondicao({ kind: 'CROSS_ABOVE', level: Number.NaN })).toEqual([]);
    expect(niveisDaCondicao({ kind: 'ENTER_ZONE', min: 1, max: Number.NaN })).toEqual([]);
  });
});

describe('linhaDeAlerta — o estado é visível', () => {
  it('⭐ ARMADO sai TRACEJADO e âmbar', () => {
    const [l] = linhaDeAlerta({ condicao: CRUZAR_ACIMA, estado: 'ARMED' });
    expect(l).toBeDefined();
    expect(l!.lineStyle).toBe(2);
    expect(l!.color).toContain('251, 191, 36');
    expect(l!.lineWidth).toBe(1);
  });

  it('⭐ DISPARADO sai SÓLIDO, mais grosso, e em ciano', () => {
    const [l] = linhaDeAlerta({ condicao: CRUZAR_ACIMA, estado: 'TRIGGERED' });
    expect(l!.lineStyle).toBe(0);
    expect(l!.lineWidth).toBe(2);
    // ⚠️ Ciano e não vermelho/verde: esses dois já significam ALTA e BAIXA em todo pixel do
    // gráfico, e um alerta vermelho seria lido como afirmação sobre o mercado.
    expect(l!.color).toContain('34, 211, 238');
  });

  it('⭐⭐ o TÍTULO diz o estado, não só o nome', () => {
    // Numa linha que já disparou, "Cruzar ↑ 130100" faz o operador continuar esperando um
    // evento que já passou — e no modo `once` ela não vigia mais nada.
    const armado = linhaDeAlerta({ condicao: CRUZAR_ACIMA, estado: 'ARMED' })[0]!;
    const disparado = linhaDeAlerta({ condicao: CRUZAR_ACIMA, estado: 'TRIGGERED' })[0]!;
    expect(armado.title).not.toContain('disparado');
    expect(disparado.title).toContain('disparado');
  });

  it('o título traz o PREÇO com a precisão pedida', () => {
    const l = linhaDeAlerta({ condicao: { kind: 'TOUCH', level: 5.1234 }, estado: 'ARMED', precisao: 2 })[0]!;
    expect(l.title).toContain('5.12');
  });

  it('o nome do operador vence o rótulo da condição', () => {
    const l = linhaDeAlerta({ condicao: CRUZAR_ACIMA, estado: 'ARMED', nome: 'Topo do dia' })[0]!;
    expect(l.title).toContain('Topo do dia');
    expect(l.title).not.toContain('Cruzar');
  });

  it('zona rotula PISO e TETO — duas linhas idênticas seriam ilegíveis', () => {
    const linhas = linhaDeAlerta({ condicao: ZONA, estado: 'ARMED' });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.title).toContain('piso');
    expect(linhas[1]!.title).toContain('teto');
    expect(linhas[0]!.price).toBe(100);
    expect(linhas[1]!.price).toBe(200);
  });

  it('condição sem nível não produz linha nenhuma', () => {
    expect(
      linhaDeAlerta({ condicao: { kind: 'PERCENT_CHANGE', percent: 3 } as never, estado: 'ARMED' }),
    ).toEqual([]);
  });
});

describe('rotuloDaCondicao', () => {
  it('cada condição tem rótulo próprio em pt-BR', () => {
    expect(rotuloDaCondicao(CRUZAR_ACIMA)).toBe('Cruzar ↑');
    expect(rotuloDaCondicao({ kind: 'CROSS_BELOW', level: 1 })).toBe('Cruzar ↓');
    expect(rotuloDaCondicao(ZONA)).toBe('Entrar na faixa');
    expect(rotuloDaCondicao({ kind: 'PERCENT_CHANGE', percent: 1 } as never)).toBe('Variação %');
  });
});

describe('linhasDeAlertas — a coleção inteira', () => {
  it('junta as linhas de todos, omitindo quem não tem nível', () => {
    const linhas = linhasDeAlertas([
      { condicao: CRUZAR_ACIMA, estado: 'ARMED' },
      { condicao: { kind: 'PERCENT_CHANGE', percent: 2 } as never, estado: 'ARMED' },
      { condicao: ZONA, estado: 'TRIGGERED', nome: 'Faixa' },
    ]);
    // 1 do cruzamento + 0 da variação + 2 da zona.
    expect(linhas).toHaveLength(3);
    // ⚠️ Omitir é correto: a lista do painel continua mostrando o alerta de variação, com
    // estado e tudo. O que não existe é uma ALTURA na tela para ele.
    expect(linhas.map((l) => l.price)).toEqual([130_100, 100, 200]);
  });

  it('coleção vazia devolve vazio, sem lançar', () => {
    expect(linhasDeAlertas([])).toEqual([]);
  });
});
