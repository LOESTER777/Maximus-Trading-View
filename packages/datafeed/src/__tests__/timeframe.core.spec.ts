/**
 * timeframe.core — o vocabulário de PERÍODO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS TRAVAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O relato: *"gráfico está sem seleção de TF"*. Faltava o vocabulário — lista, rótulos, e
 * a pergunta que um seletor honesto precisa fazer antes de oferecer um período: **dá para
 * derivar isto do dado que eu tenho?**
 *
 * As duas propriedades que sustentam o resto:
 *
 *  1. **A ordem da lista é crescente**, e é contrato: `proximoTimeframe`,
 *     `timeframeAnterior` e qualquer seletor que mostre "o próximo mais longo" a leem.
 *  2. **`podeAgregar` concorda com `rollupBars`.** Se as duas divergissem, a interface
 *     ofereceria um período que a agregação recusa — e o operador escolheria para receber
 *     tela vazia.
 */
import { describe, expect, it } from 'vitest';
import {
  TIMEFRAMES,
  barrasPorBalde,
  podeAgregar,
  proximoTimeframe,
  rollupBars,
  timeframeAnterior,
  timeframePorId,
  timeframePorSegundos,
  timeframesAgregaveisDe,
  type Bar,
  type Timeframe,
} from '../index.js';

function tf(id: string): Timeframe {
  const r = timeframePorId(id);
  if (r === null) throw new Error(`periodo ${id} nao existe`);
  return r;
}

describe('TIMEFRAMES — a lista canônica', () => {
  it('está em ordem CRESCENTE de duração', () => {
    for (let i = 1; i < TIMEFRAMES.length; i++) {
      expect(TIMEFRAMES[i]!.seconds).toBeGreaterThan(TIMEFRAMES[i - 1]!.seconds);
    }
  });

  it('não tem id nem duração repetidos', () => {
    expect(new Set(TIMEFRAMES.map((t) => t.id)).size).toBe(TIMEFRAMES.length);
    expect(new Set(TIMEFRAMES.map((t) => t.seconds)).size).toBe(TIMEFRAMES.length);
  });

  it('todo período tem rótulo curto e longo utilizáveis', () => {
    for (const t of TIMEFRAMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.labelLongo.length).toBeGreaterThan(t.label.length);
      expect(Number.isInteger(t.seconds)).toBe(true);
      expect(t.seconds).toBeGreaterThan(0);
    }
  });

  it('os períodos de mesa estão lá', () => {
    for (const id of ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']) {
      expect(timeframePorId(id)).not.toBeNull();
    }
    expect(tf('M5').seconds).toBe(300);
    expect(tf('H1').seconds).toBe(3600);
    expect(tf('D1').seconds).toBe(86_400);
  });
});

describe('busca', () => {
  it('acha por id e por segundos', () => {
    expect(timeframePorId('M15')?.seconds).toBe(900);
    expect(timeframePorSegundos(900)?.id).toBe('M15');
  });

  it('id ou duração desconhecidos devolvem null — nunca lançam', () => {
    expect(timeframePorId('M7')).toBeNull();
    expect(timeframePorId('')).toBeNull();
    expect(timeframePorSegundos(7 * 60)).toBeNull();
    expect(timeframePorSegundos(NaN)).toBeNull();
    expect(timeframePorSegundos(Infinity)).toBeNull();
  });
});

describe('⭐ podeAgregar — a pergunta que evita oferecer o impossível', () => {
  it('múltiplo inteiro para cima vale', () => {
    expect(podeAgregar(tf('M1'), tf('M5'))).toBe(true);
    expect(podeAgregar(tf('M5'), tf('M15'))).toBe(true);
    expect(podeAgregar(tf('M15'), tf('H1'))).toBe(true);
    expect(podeAgregar(tf('H1'), tf('H4'))).toBe(true);
    expect(podeAgregar(tf('H4'), tf('D1'))).toBe(true);
  });

  it('para BAIXO nunca vale — não se inventa barra que não existe', () => {
    expect(podeAgregar(tf('M5'), tf('M1'))).toBe(false);
    expect(podeAgregar(tf('D1'), tf('H1'))).toBe(false);
  });

  it('o mesmo período vale (identidade)', () => {
    expect(podeAgregar(tf('M5'), tf('M5'))).toBe(true);
  });

  /**
   * ⚠️ O caso de recusa REAL: W1→MN1 dá 2.592.000/604.800 = 4,285…, não inteiro. Uma barra
   * semanal cairia em dois baldes mensais, e nenhuma reatribuição honesta é possível.
   */
  it('múltiplo NÃO inteiro é recusado', () => {
    expect(podeAgregar(tf('W1'), tf('MN1'))).toBe(false);
  });

  /**
   * ⭐ A PROPRIEDADE QUE IMPORTA: `podeAgregar` e `rollupBars` concordam para TODO par.
   *
   * As duas implementam a mesma regra em lugares diferentes de propósito — uma responde
   * ANTES de agregar (para a interface desabilitar a opção), a outra protege a agregação.
   * Divergirem significaria a interface oferecer o que a agregação recusa, e o operador
   * receber tela vazia depois de escolher.
   */
  it('concorda com `rollupBars` para todo par de períodos', () => {
    // Uma barra por minuto durante 2 dias: suficiente para qualquer balde até D1 ter dado.
    const base = tf('M1');
    const barras: Bar[] = Array.from({ length: 2 * 24 * 60 }, (_, i) => ({
      time: 1_700_000_000 + i * base.seconds,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1,
    }));

    for (const alvo of TIMEFRAMES) {
      const previsto = podeAgregar(base, alvo);
      const obtido = rollupBars(barras, base.seconds, alvo.seconds).length > 0;
      expect(obtido).toBe(previsto);
    }
  });
});

describe('timeframesAgregaveisDe', () => {
  it('a partir de M5, oferece M5 e os múltiplos — e NÃO oferece M1', () => {
    const ids = timeframesAgregaveisDe(tf('M5')).map((t) => t.id);
    expect(ids).toContain('M5');
    expect(ids).toContain('M15');
    expect(ids).toContain('H1');
    // ⚠️ A afirmação que importa: com dado de M5, M1 não existe. Oferecê-lo e depois
    // mostrar tela vazia é pior que não oferecer.
    expect(ids).not.toContain('M1');
  });

  it('a partir de M1, oferece a lista quase inteira', () => {
    const ids = timeframesAgregaveisDe(tf('M1')).map((t) => t.id);
    expect(ids).toContain('M1');
    expect(ids).toContain('D1');
    expect(ids.length).toBeGreaterThanOrEqual(TIMEFRAMES.length - 1);
  });

  it('preserva a ordem crescente da lista canônica', () => {
    const lista = timeframesAgregaveisDe(tf('M5'));
    for (let i = 1; i < lista.length; i++) {
      expect(lista[i]!.seconds).toBeGreaterThan(lista[i - 1]!.seconds);
    }
  });
});

describe('navegação de período', () => {
  it('próximo e anterior andam na lista', () => {
    expect(proximoTimeframe(tf('M5'))?.id).toBe('M15');
    expect(timeframeAnterior(tf('M5'))?.id).toBe('M1');
  });

  it('as pontas devolvem null em vez de circular', () => {
    // ⚠️ Não circula de propósito: um atalho de teclado que voltasse de MN1 para M1 daria
    // um salto de escala que ninguém pediu.
    expect(timeframeAnterior(TIMEFRAMES[0]!)).toBeNull();
    expect(proximoTimeframe(TIMEFRAMES[TIMEFRAMES.length - 1]!)).toBeNull();
  });

  it('período fora da lista devolve null nas duas direções', () => {
    const estranho: Timeframe = { id: 'M7', seconds: 420, label: '7m', labelLongo: '7 minutos' };
    expect(proximoTimeframe(estranho)).toBeNull();
    expect(timeframeAnterior(estranho)).toBeNull();
  });
});

describe('barrasPorBalde', () => {
  it('diz quantas barras de origem cabem numa de destino', () => {
    expect(barrasPorBalde(tf('M1'), tf('H1'))).toBe(60);
    expect(barrasPorBalde(tf('M5'), tf('M15'))).toBe(3);
    expect(barrasPorBalde(tf('M5'), tf('M5'))).toBe(1);
  });

  it('devolve null quando não agrega — "não sei", nunca zero', () => {
    expect(barrasPorBalde(tf('M5'), tf('M1'))).toBeNull();
    expect(barrasPorBalde(tf('W1'), tf('MN1'))).toBeNull();
  });
});
