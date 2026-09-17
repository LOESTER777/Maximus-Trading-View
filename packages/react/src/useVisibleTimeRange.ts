/**
 * `useVisibleTimeRange` — a janela visível em TEMPO, para reagregar o que depende dela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PARA QUE SERVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O perfil de volume "da janela visível" é o caso que motivou o hook: o núcleo puro
 * `agregarPerfilDeVolume` já aceita um recorte de tempo (`janela`), então o que faltava era
 * alguém dizer QUAL é a janela — e reagir quando ela muda.
 *
 * ⭐ **Em TEMPO, não em índice lógico.** É a mesma regra da sincronia entre gráficos: a barra
 * lógica 100 em M5 são 8h20 do início da série e em H1 são 100 horas. Um consumidor que
 * reagrega por índice recorta o pedaço errado do dado ao trocar de período — e o erro é
 * silencioso, porque o perfil continua desenhando, só que de outro trecho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A GUARDA DE FREQUÊNCIA, E POR QUE ELA NÃO É OPCIONAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ O motor emite mudança de janela a cada quadro do arrasto — 60 vezes por segundo. Sem
 * guarda, cada emissão viraria um `setState`, uma reagregação do perfil sobre milhares de
 * células e um quadro novo: o pan travaria no exato gesto que é o mais usado do gráfico.
 *
 * A guarda tem DUAS partes, e as duas importam:
 *
 *  1. **Coalescência por quadro** (`requestAnimationFrame`): várias emissões no mesmo quadro
 *     produzem UMA atualização. É o que alinha o custo ao que a tela consegue mostrar.
 *  2. **Zona morta em SEGUNDOS** (`toleranciaSegundos`): uma mudança de meia barra não muda o
 *     perfil de forma perceptível, e reagregar por ela é trabalho invisível. Sem a zona
 *     morta, o `setState` dispararia mesmo com a janela praticamente parada, porque as bordas
 *     variam por fração de segundo durante o zoom.
 *
 * ⚠️ A zona morta é em TEMPO e não em pixel de propósito: em D1 uma barra são 86.400 s e em
 * 5min são 300 s. Uma tolerância em pixel seria generosa num período e apertada no outro.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChartEngine } from '@robustus/charts-engine';

export interface FaixaDeTempoVisivel {
  /** Início da janela, epoch em SEGUNDOS. */
  readonly de: number;
  /** Fim da janela, epoch em SEGUNDOS. */
  readonly ate: number;
}

export interface UseVisibleTimeRangeParams {
  readonly engine: ChartEngine | null;
  /**
   * Quanto a borda pode variar (em segundos) sem provocar atualização. Default 1.
   *
   * ⚠️ O default de 1 s é deliberadamente pequeno: ele serve para matar o ruído de fração de
   * segundo do zoom, não para segurar atualização. Quem reagrega algo caro passa o tamanho de
   * meia barra do período em uso — aí a atualização acontece quando a janela realmente andou.
   */
  readonly toleranciaSegundos?: number;
}

export function useVisibleTimeRange(
  params: UseVisibleTimeRangeParams,
): FaixaDeTempoVisivel | null {
  const { engine, toleranciaSegundos = 1 } = params;
  const [faixa, setFaixa] = useState<FaixaDeTempoVisivel | null>(null);

  // A última faixa ENTREGADA, para a zona morta comparar. Em ref e não em estado: comparar
  // contra o estado exigiria o estado como dependência do efeito, e o efeito reassinaria o
  // motor a cada pan — exatamente o que a guarda existe para evitar.
  const ultimaRef = useRef<FaixaDeTempoVisivel | null>(null);
  const quadroRef = useRef<number | null>(null);

  useEffect(() => {
    if (engine === null || engine.isDisposed) {
      // ⚠️ Zera ao perder o motor. Sem isto, a janela do gráfico ANTERIOR continuaria
      // recortando o perfil do gráfico novo — dado do ativo A no desenho do ativo B.
      setFaixa(null);
      ultimaRef.current = null;
      return;
    }

    const escala = engine.api.timeScale();

    const ler = (): void => {
      quadroRef.current = null;
      let r: { from: unknown; to: unknown } | null = null;
      try {
        r = escala.getVisibleRange() as { from: unknown; to: unknown } | null;
      } catch {
        // Motor em descarte no meio do quadro: sai sem tocar no estado.
        return;
      }
      if (r === null) return;
      const de = Number(r.from);
      const ate = Number(r.to);
      // ⚠️ Faixa não finita ou invertida é DESCARTADA em vez de propagada: ela viraria um
      // recorte vazio e o perfil apareceria em branco, sem explicação.
      if (!Number.isFinite(de) || !Number.isFinite(ate) || !(de < ate)) return;

      const anterior = ultimaRef.current;
      if (
        anterior !== null &&
        Math.abs(anterior.de - de) <= toleranciaSegundos &&
        Math.abs(anterior.ate - ate) <= toleranciaSegundos
      ) {
        return;
      }
      const nova = { de, ate };
      ultimaRef.current = nova;
      setFaixa(nova);
    };

    const agendar = (): void => {
      if (quadroRef.current !== null) return;
      quadroRef.current =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(ler)
          : (setTimeout(ler, 16) as unknown as number);
    };

    // ⭐ Lê AGORA, e não só na primeira mudança. Num gráfico que ninguém arrastou ainda, o
    // motor não emite nada — e sem esta leitura o consumidor ficaria com `null` para sempre,
    // vendo o perfil do dia inteiro achando que era o da janela.
    ler();
    escala.subscribeVisibleLogicalRangeChange(agendar);

    return () => {
      try {
        escala.unsubscribeVisibleLogicalRangeChange(agendar);
      } catch {
        // Motor em descarte: o ouvinte morre com ele.
      }
      if (quadroRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(quadroRef.current);
        else clearTimeout(quadroRef.current as unknown as ReturnType<typeof setTimeout>);
        quadroRef.current = null;
      }
    };
  }, [engine, toleranciaSegundos]);

  return faixa;
}
