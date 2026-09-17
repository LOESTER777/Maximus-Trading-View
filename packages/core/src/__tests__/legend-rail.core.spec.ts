/**
 * A trilha de legendas — ordem canônica, sem buraco, estável.
 *
 * ⭐ O que estes testes travam é a razão de o módulo existir: as camadas publicam em
 * QUADROS diferentes, então "ordem de chegada" produziria uma fila que se reordena
 * sozinha entre sessões. Uma fila instável obriga o operador a reler tudo a cada quadro —
 * pior que uma ordem "errada" mas fixa.
 *
 * ⚠️ E travam a comparação por CONTEÚDO. As camadas remontam o texto na passada de
 * desenho, dezenas de vezes por segundo, quase sempre igual; comparar por identidade de
 * array veria "mudou" sempre e re-renderizaria a interface por quadro. Foi o mecanismo do
 * laço infinito de `useAlerts` com `bars` literal, e não pode voltar por outra porta.
 */
import { describe, expect, it } from 'vitest';
import {
  alturaEmLinhas,
  enfileirarNotas,
  notasIguais,
  ORDEM_DA_TRILHA,
  type NotaDeLegenda,
} from '../legend-rail.core.js';

const livro: NotaDeLegenda = { fonte: 'livro', linhas: ['Livro · fila em repouso'] };
const perfil: NotaDeLegenda = { fonte: 'perfil', linhas: ['Perfil de volume · 40 níveis'] };
const footprint: NotaDeLegenda = { fonte: 'footprint', linhas: ['Footprint · 12/240 velas'] };

describe('enfileirarNotas — ordem canônica, não ordem de chegada', () => {
  it('⭐ a ordem é a de `ORDEM_DA_TRILHA`, independente da ordem de entrada', () => {
    const a = enfileirarNotas([perfil, livro, footprint]);
    const b = enfileirarNotas([footprint, perfil, livro]);
    expect(a.map((n) => n.fonte)).toEqual(['livro', 'footprint', 'perfil']);
    // ⭐ A prova da estabilidade: duas ordens de chegada, uma fila só.
    expect(b.map((n) => n.fonte)).toEqual(a.map((n) => n.fonte));
  });

  it('nota SEM linha nenhuma é descartada, não enfileirada vazia', () => {
    const fila = enfileirarNotas([livro, { fonte: 'perfil', linhas: [] }]);
    // Uma entrada vazia abriria um buraco que o operador leria como "falta algo aqui".
    expect(fila).toHaveLength(1);
    expect(fila[0]!.fonte).toBe('livro');
  });

  it('linha em branco sai, e a nota sobrevive com as que restam', () => {
    // É o resultado natural de interpolar um campo ausente.
    const fila = enfileirarNotas([{ fonte: 'livro', linhas: ['Livro', '   ', ''] }]);
    expect(fila).toHaveLength(1);
    expect(fila[0]!.linhas).toEqual(['Livro']);
  });

  it('a mesma fonte pode publicar duas vezes, e a ordem relativa é preservada', () => {
    // Duas panes de indicador publicando na mesma fonte é caso real.
    const fila = enfileirarNotas([
      { fonte: 'indicadores', linhas: ['EMA 20'] },
      { fonte: 'indicadores', linhas: ['RSI 14'] },
    ]);
    expect(fila.map((n) => n.linhas[0])).toEqual(['EMA 20', 'RSI 14']);
  });

  it('fonte fora do conjunto fechado vai para o FIM, nunca desaparece', () => {
    const fila = enfileirarNotas([
      { fonte: 'camada-nova' as never, linhas: ['Algo novo'] },
      livro,
    ]);
    // Perder texto em silêncio é o pior desfecho para uma camada de diagnóstico.
    expect(fila.map((n) => n.fonte)).toEqual(['livro', 'camada-nova']);
  });

  it('o sinalizador de ressalva atravessa a fila', () => {
    const fila = enfileirarNotas([{ fonte: 'footprint', linhas: ['vela estreita'], alerta: true }]);
    expect(fila[0]!.alerta).toBe(true);
  });

  it('entrada vazia produz fila vazia — e não lança', () => {
    expect(enfileirarNotas([])).toEqual([]);
  });

  it('toda fonte declarada em ORDEM_DA_TRILHA é enfileirável', () => {
    // Guarda contra fonte nova esquecida na ordem: ela cairia no ramo do "fim da fila" e
    // a posição dela seria acidente em vez de decisão.
    const todas = ORDEM_DA_TRILHA.map((fonte) => ({ fonte, linhas: [fonte] }));
    const fila = enfileirarNotas(todas);
    expect(fila).toHaveLength(ORDEM_DA_TRILHA.length);
    expect(fila.map((n) => n.fonte)).toEqual([...ORDEM_DA_TRILHA]);
  });
});

describe('alturaEmLinhas — uma contagem só, para quem reserva e quem desenha', () => {
  it('soma as linhas de todas as notas', () => {
    const fila = enfileirarNotas([
      { fonte: 'livro', linhas: ['a', 'b', 'c'] },
      { fonte: 'perfil', linhas: ['d'] },
    ]);
    expect(alturaEmLinhas(fila)).toBe(4);
  });

  it('fila vazia mede zero', () => {
    expect(alturaEmLinhas([])).toBe(0);
  });
});

describe('notasIguais — comparação por CONTEÚDO', () => {
  it('⭐ arrays DIFERENTES com o mesmo texto são iguais', () => {
    // É o caso normal: a camada remonta o texto por quadro. Sem isto, a interface
    // re-renderizaria 60 vezes por segundo mostrando exatamente a mesma coisa.
    const a = [{ fonte: 'livro' as const, linhas: ['Livro · fila'] }];
    const b = [{ fonte: 'livro' as const, linhas: ['Livro · fila'] }];
    expect(a).not.toBe(b);
    expect(notasIguais(a, b)).toBe(true);
  });

  it('texto diferente é diferente', () => {
    expect(
      notasIguais(
        [{ fonte: 'livro', linhas: ['Livro · fila'] }],
        [{ fonte: 'livro', linhas: ['Livro · execução'] }],
      ),
    ).toBe(false);
  });

  it('a RESSALVA conta na comparação', () => {
    // Só a cor muda, e o operador precisa ver a cor mudar: um aviso que aparece sem
    // destaque é um aviso que não é lido.
    expect(
      notasIguais(
        [{ fonte: 'footprint', linhas: ['x'] }],
        [{ fonte: 'footprint', linhas: ['x'], alerta: true }],
      ),
    ).toBe(false);
  });

  it('`alerta` ausente e `alerta: false` são o MESMO estado', () => {
    expect(
      notasIguais(
        [{ fonte: 'footprint', linhas: ['x'] }],
        [{ fonte: 'footprint', linhas: ['x'], alerta: false }],
      ),
    ).toBe(true);
  });

  it('contagem de linhas e de notas diferentes são diferentes', () => {
    expect(notasIguais([livro], [livro, perfil])).toBe(false);
    expect(
      notasIguais([{ fonte: 'livro', linhas: ['a'] }], [{ fonte: 'livro', linhas: ['a', 'b'] }]),
    ).toBe(false);
  });

  it('fonte diferente com o mesmo texto é diferente', () => {
    expect(
      notasIguais([{ fonte: 'livro', linhas: ['x'] }], [{ fonte: 'perfil', linhas: ['x'] }]),
    ).toBe(false);
  });

  it('duas filas vazias são iguais', () => {
    expect(notasIguais([], [])).toBe(true);
  });
});
