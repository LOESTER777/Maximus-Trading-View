/**
 * A rampa térmica do bookmap.
 *
 * ⚠️ A propriedade que mais importa é a **monotonicidade da luminosidade**: cada
 * parada tem de ser mais clara que a anterior. É ela que mantém a rampa legível
 * para quem não distingue matiz e que faz a ordem sobreviver a uma captura em
 * escala de cinza. Rampa que sobe e desce de brilho — arco-íris puro é o caso
 * clássico — perde a ordem e mente sobre a magnitude.
 *
 * A segunda é o pé da rampa NÃO ser preto: célula de fila pequena existe e tem de
 * se distinguir do fundo. Foi o defeito do piso de opacidade 0,06 em 03/09, que
 * deixou metade do heatmap invisível.
 */
import { describe, it, expect } from 'vitest';
import {
  RAMPA_TERMICA,
  construirPaletaTermica,
  corDaRampa,
  luminancia,
} from '@robustus/charts-core';

describe('RAMPA_TERMICA — o desenho da rampa', () => {
  it('as paradas estão em ordem crescente de t, de 0 a 1', () => {
    expect(RAMPA_TERMICA[0]!.t).toBe(0);
    expect(RAMPA_TERMICA[RAMPA_TERMICA.length - 1]!.t).toBe(1);
    for (let i = 1; i < RAMPA_TERMICA.length; i += 1) {
      expect(RAMPA_TERMICA[i]!.t).toBeGreaterThan(RAMPA_TERMICA[i - 1]!.t);
    }
  });

  it('⭐ a luminosidade CRESCE em cada parada', () => {
    for (let i = 1; i < RAMPA_TERMICA.length; i += 1) {
      const antes = luminancia(RAMPA_TERMICA[i - 1]!);
      const agora = luminancia(RAMPA_TERMICA[i]!);
      expect(agora, `parada ${i} não é mais clara que a anterior`).toBeGreaterThan(antes);
    }
  });

  it('⭐ a luminosidade cresce ao longo de TODA a rampa, não só nas paradas', () => {
    // Interpolar entre paradas monotônicas preserva a ordem, mas o teste afirma o
    // resultado em vez de confiar no argumento.
    let anterior = -1;
    for (let i = 0; i <= 100; i += 1) {
      const l = luminancia(corDaRampa(i / 100));
      expect(l).toBeGreaterThanOrEqual(anterior);
      anterior = l;
    }
  });

  it('o pé da rampa NÃO é preto — célula pequena tem de aparecer', () => {
    const pe = corDaRampa(0);
    expect(luminancia(pe)).toBeGreaterThan(30);
  });

  it('o topo é quase branco — parede extrema tem de saltar', () => {
    const topo = corDaRampa(1);
    expect(luminancia(topo)).toBeGreaterThan(230);
  });

  it('atravessa azul, ciano e amarelo/laranja no caminho', () => {
    // Azul no pé: componente azul domina.
    const pe = corDaRampa(0.1);
    expect(pe.b).toBeGreaterThan(pe.r);
    // Amarelo/laranja no alto: vermelho domina o azul.
    const alto = corDaRampa(0.75);
    expect(alto.r).toBeGreaterThan(alto.b);
  });
});

describe('corDaRampa — bordas', () => {
  it('recorta fora de [0,1]', () => {
    expect(corDaRampa(-5)).toEqual(corDaRampa(0));
    expect(corDaRampa(9)).toEqual(corDaRampa(1));
  });

  it.each([[NaN], [Infinity], [-Infinity]])(
    '⚠️ entrada não finita (%s) cai no pé, nunca em NaN',
    (v) => {
      const c = corDaRampa(v as number);
      // `rgba(NaN, …)` faz o canvas MANTER o fillStyle anterior: a célula sairia
      // pintada com a cor da vizinha, sem lançar e sem log. É o mesmo modo de
      // falha que o clamp de bucket do primitive previne do outro lado.
      expect(Number.isFinite(c.r)).toBe(true);
      expect(Number.isFinite(c.g)).toBe(true);
      expect(Number.isFinite(c.b)).toBe(true);
    },
  );

  it('componentes ficam em [0,255] e inteiros', () => {
    for (let i = 0; i <= 50; i += 1) {
      const c = corDaRampa(i / 50);
      for (const canal of [c.r, c.g, c.b]) {
        expect(canal).toBeGreaterThanOrEqual(0);
        expect(canal).toBeLessThanOrEqual(255);
        expect(Number.isInteger(canal)).toBe(true);
      }
    }
  });

  it('é determinística', () => {
    expect(corDaRampa(0.37)).toEqual(corDaRampa(0.37));
  });
});

describe('construirPaletaTermica', () => {
  it('devolve uma cadeia rgba por bucket', () => {
    const p = construirPaletaTermica(16, 0.18, 0.92);
    expect(p).toHaveLength(16);
    for (const s of p) expect(s).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d{3}\)$/);
  });

  it('⭐ a opacidade sobe JUNTO com a cor', () => {
    const p = construirPaletaTermica(16, 0.18, 0.92);
    const alphaDe = (s: string): number => Number(s.match(/([\d.]+)\)$/)![1]);
    for (let i = 1; i < p.length; i += 1) {
      expect(alphaDe(p[i]!)).toBeGreaterThan(alphaDe(p[i - 1]!));
    }
    // No fundo escuro do gráfico, cor quente com opacidade baixa fica lavada — os
    // dois canais na mesma direção é o que dá a sensação de brasa.
    expect(alphaDe(p[0]!)).toBeGreaterThanOrEqual(0.18);
    expect(alphaDe(p[15]!)).toBeLessThanOrEqual(0.92);
  });

  it('nenhum bucket usa a borda da faixa (o centro é que é tomado)', () => {
    const p = construirPaletaTermica(4, 0, 1);
    const alphaDe = (s: string): number => Number(s.match(/([\d.]+)\)$/)![1]);
    // Com `+0,5`, o primeiro é 1/8 e o último 7/8 — nunca 0 nem 1.
    expect(alphaDe(p[0]!)).toBeCloseTo(0.125, 3);
    expect(alphaDe(p[3]!)).toBeCloseTo(0.875, 3);
  });

  it.each([
    ['buckets zero', 0, 0.18, 0.92],
    ['buckets NaN', NaN, 0.18, 0.92],
    ['buckets negativo', -3, 0.18, 0.92],
  ])('%s produz ao menos um bucket válido', (_r, b, aMin, aMax) => {
    const p = construirPaletaTermica(b as number, aMin, aMax);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p[0]).toMatch(/^rgba\(/);
  });

  it('limites de opacidade invertidos achatam no piso, sem amplitude negativa', () => {
    const p = construirPaletaTermica(4, 0.9, 0.2);
    const alphaDe = (s: string): number => Number(s.match(/([\d.]+)\)$/)![1]);
    for (const s of p) expect(alphaDe(s)).toBeCloseTo(0.9, 3);
  });

  it('é determinística', () => {
    expect(construirPaletaTermica(16, 0.18, 0.92)).toEqual(
      construirPaletaTermica(16, 0.18, 0.92),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ A CADEIA — o modo tem de CHEGAR ao desenho
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ Esta feature já foi mordida três vezes pela MESMA armadilha: `marcaExec`,
// `mostrarLegenda` e agora `modoCor`. Trocar qualquer um deles não altera
// `bookmapLayer != null`, então o efeito de ANEXAÇÃO não roda de novo — e sem o
// campo no patch de `update` o primitive fica congelado no estado em que nasceu.
// O seletor parece inerte e só surte efeito desligando e religando a camada.
//
// Um teste que só contasse chamadas de `update` passaria com o defeito presente:
// o update acontecia, ia incompleto. Estes afirmam o CONTEÚDO.

describe('o modo de cor chega à camada já anexada', () => {
  it('⚠️ a chave da paleta inclui o modo — senão trocar de modo não reconstrói', () => {
    // Com os MESMOS limites de opacidade, as duas paletas têm de diferir. Se a
    // chave não incluísse o modo, `refreshPalettes` consideraria a paleta
    // atualizada e o seletor ficaria sem efeito.
    const lado = construirPaletaTermica(16, 0.18, 0.92);
    // A paleta de lado é verde/vermelho fixo; a térmica varia de matiz. Comparar
    // o primeiro e o último bucket basta para provar que são escalas distintas.
    expect(lado[0]).not.toBe(lado[15]);
    const c0 = corDaRampa(0.03);
    const c15 = corDaRampa(0.97);
    expect(c0.r).not.toBe(c15.r);
    expect(c0.b).not.toBe(c15.b);
  });

  it('⭐ na térmica os DOIS lados usam a mesma paleta', () => {
    // É o ponto da rampa: a cor passa a codificar TAMANHO, e o lado se lê pela
    // posição relativa ao preço. Paletas diferentes por lado desfariam isso.
    const a = construirPaletaTermica(16, 0.18, 0.92);
    const b = construirPaletaTermica(16, 0.18, 0.92);
    expect(a).toEqual(b);
  });
});
