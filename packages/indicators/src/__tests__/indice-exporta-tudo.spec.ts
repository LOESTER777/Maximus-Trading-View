/**
 * A fachada do pacote exporta TODA fábrica registrada — a guarda mecânica.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO FECHA, E POR QUE UMA CONVENÇÃO NÃO BASTAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Medido em 18/09/2026: o índice tinha **45 fábricas em `builtInFactories` e 29 exports
 * nomeados**. Dezesseis eram importadas (para entrar no registry) e nunca reexportadas —
 * `delta`, `cvd`, `delta_ratio`, `hma`, `vwma`, `kama`, `lsma`, `trix`, `ppo`, `stoch_rsi`,
 * `aroon`, `chop`, `bop`, `adl`, `force_index`, `elder_ray`.
 *
 * ⭐ E não havia regra separando os dois grupos: era esquecimento REPETIDO. Acrescentar uma
 * fábrica exige tocar em quatro lugares (o `import`, a lista `export`, `builtInFactories` e o
 * `registry`), e o segundo é o único cujo esquecimento não quebra nada visível — o registry
 * funciona, os property tests passam, o playground desenha. Só um consumidor externo descobre.
 *
 * ⚠️ Este teste é BARREIRA, não convenção. A convenção "exporte também" já existia
 * implicitamente e falhou dezesseis vezes.
 *
 * ⭐ A comparação é feita por `meta.name` traduzido para o identificador esperado, e não por
 * uma lista escrita à mão: uma lista escrita à mão é exatamente o tipo de coisa que ficaria
 * desatualizada junto com o índice.
 */

import { describe, expect, it } from 'vitest';

import * as pkg from '../index.js';

/**
 * `meta.name` → nome do export esperado. `delta_ratio` → `deltaRatioFactory`.
 *
 * ⚠️ Três nomes NÃO seguem a regra e a exceção é declarada em vez de silenciada: o `meta.name`
 * é o identificador CANÔNICO do indicador (vai para o estado persistido do gráfico e para a
 * paleta de comandos), e ele usa a abreviação que o operador conhece — `psar`, `ao`, `chop`.
 * O nome do export usa o termo completo, que é o que se lê num `import`. As duas grafias são
 * intencionais, e mapear é mais honesto que renomear uma das duas.
 */
const EXCECOES: Readonly<Record<string, string>> = {
  psar: 'parabolicSarFactory',
  ao: 'awesomeOscillatorFactory',
  chop: 'choppinessFactory',
};

function exportEsperado(metaName: string): string {
  const excecao = EXCECOES[metaName];
  if (excecao !== undefined) return excecao;
  const camel = metaName.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
  return `${camel}Factory`;
}

describe('a fachada do pacote', () => {
  const rec = pkg as unknown as Record<string, unknown>;

  it('exporta por NOME toda fábrica de `builtInFactories`', () => {
    const faltando: string[] = [];
    for (const f of pkg.builtInFactories) {
      const nome = exportEsperado(f.meta.name);
      if (rec[nome] === undefined) faltando.push(`${f.meta.name} → ${nome}`);
    }
    expect(faltando, `fábricas sem export nomeado:\n  ${faltando.join('\n  ')}`).toEqual([]);
  });

  it('⭐ o export nomeado é a MESMA referência que está no registry', () => {
    // ⚠️ Não é redundante com o teste acima: exportar uma fábrica DIFERENTE da registrada daria
    // dois indicadores com o mesmo nome e comportamentos distintos, dependendo de por onde o
    // consumidor entrou. É pior que a ausência, porque não dá erro em lugar nenhum.
    for (const f of pkg.builtInFactories) {
      const nome = exportEsperado(f.meta.name);
      expect(rec[nome], `${f.meta.name}`).toBe(f);
    }
  });

  it('⭐ o registry cobre `builtInFactories` inteiro, sem sobra nem falta', () => {
    // ⚠️ `registry` é um `Map`, não objeto literal: `Object.keys` num Map devolve `[]` e o teste
    // passaria por vacuidade nos dois sentidos da comparação.
    const doRegistry = new Set(pkg.registry.keys());
    const daLista = new Set(pkg.builtInFactories.map((f) => f.meta.name));
    expect([...daLista].filter((n) => !doRegistry.has(n))).toEqual([]);
    expect([...doRegistry].filter((n) => !daLista.has(n))).toEqual([]);
  });

  it('⚠️ nenhum `meta.name` repetido — o registry perderia um em silêncio', () => {
    const nomes = pkg.builtInFactories.map((f) => f.meta.name);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('a contagem é a declarada: 45 fábricas', () => {
    // ⭐ Piso explícito. Sem ele, um `builtInFactories` que encolhesse por acidente deixaria
    // todos os testes de propriedade passando sobre um subconjunto.
    expect(pkg.builtInFactories.length).toBeGreaterThanOrEqual(45);
  });
});
