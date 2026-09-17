/**
 * A trilha de legendas ligada de ponta a ponta: camada publica, motor enfileira.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO, COM AS PALAVRAS DE QUEM O VIU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"o bookmap ainda está em cima do histograma de volume, ele precisa ficar no topo
 * alinhado ao lado de quem está lá, pois pode haver outros componentes"*.
 *
 * Três camadas de canvas escreviam texto, cada uma escolhendo um canto por conta própria,
 * e a coordenação existia apenas como comentário de código ("o topo à esquerda é do
 * bookmap, então eu vou para o pé"). Nenhuma delas conhece a faixa do histograma de
 * volume — ela vem de `scaleMargins` numa escala de OVERLAY, invisível para a camada.
 * Resultado: cada correção EMPURROU o texto para outro canto e a colisão reapareceu ali.
 *
 * ⭐ Aqui a prova do mecanismo novo: a camada publica LINHAS, o motor enfileira na ordem
 * canônica, e quem desenha recebe uma fila. Ninguém escolhe canto.
 *
 * ⚠️ O que este arquivo NÃO afirma: aparência. Não há pixel a inspecionar (o jsdom não
 * rasteriza, e isso é requisito do projeto). O que se mede é a fila — que é a decisão.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChartEngine } from '../chart-engine.js';
import type { LegendNote } from '@robustus/charts-core';

const LARGURA = 900;
const ALTURA = 500;

function montarContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LARGURA, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: ALTURA, configurable: true });
  document.body.appendChild(el);
  return el;
}

const T0 = 1_700_000_000;

function velas(n: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}> {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 5) * 6;
    return { time: T0 + i * 60, open: p, high: p + 2, low: p - 2, close: p + 1 };
  });
}

/** Um perfil de volume mínimo, no formato que a camada consome. */
function perfilComDado(): Parameters<ChartEngine['setVolumeProfileLayer']>[0] {
  return {
    perfil: {
      niveis: [
        { preco: 100, compra: 10, venda: 5, total: 15 },
        { preco: 101, compra: 4, venda: 9, total: 13 },
      ],
      maiorTotal: 15,
      totalGeral: 28,
      poc: 100,
      vah: 101,
      val: 100,
      fracaoAreaDeValor: 0.7,
    },
  } as never;
}

describe('trilha de legendas — a camada publica, o motor enfileira', () => {
  let el: HTMLElement;
  let engine: ChartEngine;

  beforeEach(() => {
    el = montarContainer();
    // ⚠️ A fábrica recebe o CONTAINER, não um objeto de opções — `create(container, opts?)`.
    engine = ChartEngine.create(el);
    engine.setCandles(velas(120) as never);
  });

  afterEach(() => {
    engine.dispose();
    el.remove();
  });

  it('sem camada nenhuma, a trilha está VAZIA', () => {
    expect(engine.legendNotes()).toEqual([]);
  });

  it('⭐ ligar o perfil de volume publica uma nota na fonte `perfil`', () => {
    engine.setVolumeProfileLayer(perfilComDado());

    const fila = engine.legendNotes();
    expect(fila).toHaveLength(1);
    expect(fila[0]!.fonte).toBe('perfil');
    // Guarda de vacuidade: nota existente com texto vazio passaria numa asserção só de
    // comprimento, e é justamente o estado que a fila descarta.
    expect(fila[0]!.linhas[0]).toContain('Perfil de volume');
  });

  it('⭐⭐ DESLIGAR a camada a tira da trilha — nada de "Camada desligada." na tela', () => {
    engine.setVolumeProfileLayer(perfilComDado());
    expect(engine.legendNotes()).toHaveLength(1);

    engine.setVolumeProfileLayer(null);

    // ⚠️ A camada escrevia `Perfil de volume: Camada desligada.` no canto SUPERIOR
    // esquerdo — o canto mais disputado da tela — para uma camada que o operador acabou
    // de desligar. Quem desligou sabe que desligou; o estado não tem nada a dizer.
    expect(engine.legendNotes()).toEqual([]);
  });

  it('a publicação é IDEMPOTENTE: mesmo conteúdo não reemite', () => {
    const emissoes: Array<readonly LegendNote[]> = [];
    engine.subscribeLegend((f) => emissoes.push(f));
    // A assinatura já emitiu o estado corrente (vazio).
    expect(emissoes).toHaveLength(1);

    engine.setVolumeProfileLayer(perfilComDado());
    const depoisDaPrimeira = emissoes.length;
    expect(depoisDaPrimeira).toBeGreaterThan(1);

    // O MESMO perfil de novo: o texto não muda, então a fila não muda.
    engine.setVolumeProfileLayer(perfilComDado());
    // ⚠️ Sem esta guarda a interface re-renderizaria a cada quadro com o mesmo texto —
    // o mecanismo que causou o laço infinito de `useAlerts` com `bars` literal.
    expect(emissoes).toHaveLength(depoisDaPrimeira);
  });

  it('`subscribeLegend` emite o estado CORRENTE na assinatura', () => {
    engine.setVolumeProfileLayer(perfilComDado());

    let recebida: readonly LegendNote[] | null = null;
    engine.subscribeLegend((f) => {
      recebida = f;
    });

    // ⚠️ Sem a emissão inicial, quem assina DEPOIS de a camada publicar veria a trilha
    // vazia até a próxima mudança de texto — que num gráfico parado pode não vir nunca.
    expect(recebida).not.toBeNull();
    expect(recebida!).toHaveLength(1);
  });

  it('a função de saída para de notificar', () => {
    const emissoes: Array<readonly LegendNote[]> = [];
    const sair = engine.subscribeLegend((f) => emissoes.push(f));
    const antes = emissoes.length;
    sair();

    engine.setVolumeProfileLayer(perfilComDado());
    expect(emissoes).toHaveLength(antes);
  });

  it('a fila é ESTÁVEL por referência entre mudanças', () => {
    engine.setVolumeProfileLayer(perfilComDado());
    const a = engine.legendNotes();
    const b = engine.legendNotes();
    // Permite ao consumidor comparar por identidade sem re-renderizar por quadro.
    expect(a).toBe(b);
  });

  it('ouvinte que LANÇA não impede os outros nem derruba o motor', () => {
    const vistas: number[] = [];
    engine.subscribeLegend(() => {
      throw new Error('ouvinte ruim');
    });
    engine.subscribeLegend((f) => vistas.push(f.length));

    expect(() => engine.setVolumeProfileLayer(perfilComDado())).not.toThrow();
    // O segundo ouvinte recebeu: a assinatura (0) e a publicação (1).
    expect(vistas).toContain(1);
  });

  it('depois de `dispose`, publicar não emite mais', () => {
    const emissoes: number[] = [];
    engine.subscribeLegend((f) => emissoes.push(f.length));
    engine.dispose();
    const antes = emissoes.length;

    engine.setVolumeProfileLayer(perfilComDado());
    expect(emissoes).toHaveLength(antes);
  });
});
