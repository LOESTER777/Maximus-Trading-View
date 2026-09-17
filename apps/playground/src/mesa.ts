/**
 * mesa — o playground lendo o histórico REAL da mesa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO LIGA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Até aqui o playground só tinha dado sintético (caminhada aleatória com semente fixa).
 * Ele continua sendo o default, e por bom motivo: não depende de rede, é determinístico e
 * é o que faz o playground funcionar em qualquer máquina.
 *
 * ⭐ Mas a mesa tem histórico de verdade, e agora ele está a um clique: um Postgres na
 * máquina B servido por HTTP, alcançado pelo túnel local. Medido em 17/09/2026:
 *
 * | ativo | diário | de | até |
 * |---|---|---|---|
 * | `WIN` | 6.376 | 2005-02-18 | 2026-09-16 |
 * | `WDO` | 2.574 | 2021-05 | 2026-09-16 |
 * | `BTC` | 3.318 | 2017-08 | 2026-09-16 |
 * | `PETR4`, `VALE3`, `ITUB4`, `BBAS3` | ~2.536 | 2021-07 | 2026-09-16 |
 *
 * E 5.163 dias do WIN trazem volume por AGRESSOR — o insumo de delta, que quase nenhum
 * provedor entrega.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS COISAS QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **Não agrega período.** Em dado sintético o playground nasce em M5 e agrega com
 * `rollupBars`; aqui o período é pedido DIRETO à fonte, porque a fonte já tem os quatro
 * materializados (5min/15min/1h/D1) e a agregação dela é feita sobre tick — melhor que
 * qualquer reagregação que a gente faça em cima da derivada.
 *
 * ⚠️ **Não tem livro.** O bookmap depende de profundidade, e o book NÃO foi gravado neste
 * histórico (`bid_size`/`ask_size` vêm nulos em praticamente todo o WIN). Então em dado
 * antigo o footprint e o delta funcionam e o heatmap de livro fica vazio — e isso é a
 * verdade sobre o dado, não uma limitação da camada. Zerar aqui seria afirmar liquidez
 * que ninguém mediu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  alcancouInicio,
  criarFonteDeBarrasDaMesa,
  janelaAnterior,
  janelaDeBackfill,
  rotuloDePeriodo,
} from '@robustus/charts-datafeed';
import type { Bar, BarsCapability } from '@robustus/charts-datafeed';
import type { SyntheticBundle, SyntheticCandle } from './synthetic.js';

/**
 * Os ativos oferecidos, com o INÍCIO conhecido da série.
 *
 * ⚠️ A lista é fixa aqui e isso é honesto para um playground: a fonte não publica catálogo
 * na rota de barras (o catálogo vive noutro serviço), e inventar uma descoberta por
 * tentativa faria dezenas de consultas só para montar um `<select>`.
 *
 * ⭐ `inicio` não é enfeite: é o ÚNICO critério honesto de "fim do histórico" na caminhada
 * para trás. Sem ele, lote vazio (fim de semana, feriado) seria confundido com fim de
 * série — e o gráfico afirmaria não haver passado com 18 anos de dado do outro lado.
 * Os valores foram MEDIDOS contra o serviço, não estimados.
 */
export interface AtivoDaMesa {
  readonly symbol: string;
  readonly label: string;
  /** Epoch em segundos da primeira barra conhecida. */
  readonly inicio: number;
  /** Casa de preço, para o formato do eixo. */
  readonly tickSize: number;
}

export const ATIVOS_DA_MESA: readonly AtivoDaMesa[] = [
  { symbol: 'WIN', label: 'WIN · mini índice', inicio: 1_108_692_000, tickSize: 5 },
  { symbol: 'WDO', label: 'WDO · mini dólar', inicio: 1_620_010_800, tickSize: 0.5 },
  { symbol: 'BTC', label: 'BTC', inicio: 1_502_928_000, tickSize: 1 },
  { symbol: 'PETR4', label: 'PETR4', inicio: 1_625_108_400, tickSize: 0.01 },
  { symbol: 'VALE3', label: 'VALE3', inicio: 1_625_108_400, tickSize: 0.01 },
  { symbol: 'ITUB4', label: 'ITUB4', inicio: 1_625_108_400, tickSize: 0.01 },
  { symbol: 'BBAS3', label: 'BBAS3', inicio: 1_625_108_400, tickSize: 0.01 },
];

/**
 * Os períodos que a MESA tem, casados com os ids do vocabulário de timeframe.
 *
 * ⚠️ M1 não está aqui porque não existe na base. O seletor tem de oferecer só isto quando
 * a fonte é a mesa — oferecer M1 e mostrar tela vazia é pior que não oferecer.
 */
export const PERIODOS_DA_MESA_IDS: readonly string[] = ['M5', 'M15', 'H1', 'D1'];

/** Quantas barras cada lote de backfill pede. */
const LOTE_BARRAS = 400;

/** Quantos lotes a primeira carga tenta, atravessando fim de semana e feriado. */
const LOTES_INICIAIS = 3;

/** Teto de lotes vazios seguidos antes de desistir. Ver `caminharParaTras`. */
const VAZIOS_TOLERADOS = 12;

export interface DadoDaMesa {
  readonly candles: SyntheticCandle[];
  readonly volume: SyntheticBundle['volume'];
  /** Delta por barra (compra − venda), quando a fonte classifica agressor. */
  readonly delta: ReadonlyMap<number, number>;
  readonly carregando: boolean;
  /** Mensagem em pt-BR quando algo falhou, ou `null`. */
  readonly erro: string | null;
  /** Não há mais passado a buscar (a janela alcançou o início da série). */
  readonly esgotado: boolean;
  /** Busca o lote anterior. Devolve quantas barras entraram. */
  readonly carregarMaisAntigo: () => Promise<number>;
}

const UP = 'rgba(22, 199, 132, 0.55)';
const DOWN = 'rgba(234, 57, 67, 0.55)';

const VAZIO: DadoDaMesa = {
  candles: [],
  volume: [],
  delta: new Map(),
  carregando: false,
  erro: null,
  esgotado: false,
  carregarMaisAntigo: async () => 0,
};

/**
 * Lê barras da mesa para um ativo e período.
 *
 * `ligado: false` devolve o estado vazio sem tocar na rede — é o que mantém o playground
 * funcionando offline com dado sintético.
 */
export function useMesaBars(params: {
  readonly ligado: boolean;
  readonly symbol: string;
  readonly periodSeconds: number;
  /** Origem do serviço. No desenvolvimento, o proxy do Vite (`/mesa`). */
  readonly baseUrl?: string;
}): DadoDaMesa {
  const { ligado, symbol, periodSeconds } = params;
  const baseUrl = params.baseUrl ?? '/mesa';

  const fonte = useMemo<BarsCapability>(
    () =>
      criarFonteDeBarrasDaMesa({
        fetch: (url, init) => fetch(url, init),
        baseUrl,
        // 30 s: uma consulta de 400 barras é rápida, mas a base é grande e o serviço
        // roda noutra máquina. O default de 10 s cortaria consulta legítima em dia cheio.
        timeoutMs: 30_000,
      }),
    [baseUrl],
  );

  const [barras, setBarras] = useState<readonly Bar[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [esgotado, setEsgotado] = useState(false);

  /**
   * A borda esquerda JÁ PEDIDA — e não o tempo da barra mais antiga recebida.
   *
   * ⚠️ É a correção da armadilha medida contra o serviço real: pedir um domingo devolve
   * zero barras (correto), e quem caminha pela barra mais antiga RECEBIDA não tem barra
   * para usar e repete a mesma janela para sempre. A borda pedida sempre avança.
   */
  const bordaRef = useRef<number | null>(null);
  const inicioSerie = useMemo(
    () => ATIVOS_DA_MESA.find((a) => a.symbol === symbol)?.inicio ?? null,
    [symbol],
  );

  /**
   * Caminha para trás até juntar barra ou esgotar a paciência.
   *
   * ⭐ O laço existe por causa do CALENDÁRIO: um lote de 400 barras de 5min cobre pouco
   * mais de um dia, e sábado, domingo e feriado devolvem vazio. Sem atravessar o vazio, a
   * primeira carga de um domingo mostraria tela em branco num ativo com 18 anos de dado.
   *
   * ⚠️ `VAZIOS_TOLERADOS` é o freio: sem ele, um ativo cuja série terminou (BOVA11 parou
   * em agosto) faria a caminhada varrer anos de calendário vazio, uma requisição por
   * lote, contra um banco de 250 GB.
   */
  const caminharParaTras = useCallback(
    async (
      deBorda: number,
      lotesDesejados: number,
      sinal?: AbortSignal,
    ): Promise<{ barras: Bar[]; borda: number; esgotou: boolean; erro: string | null }> => {
      let janela = janelaDeBackfill(deBorda, periodSeconds, LOTE_BARRAS);
      const juntadas: Bar[] = [];
      let vazios = 0;
      let lotes = 0;
      let borda = deBorda;

      while (janela !== null && lotes < lotesDesejados && vazios < VAZIOS_TOLERADOS) {
        if (sinal?.aborted) return { barras: juntadas, borda, esgotou: false, erro: null };
        if (alcancouInicio(janela, inicioSerie)) {
          return { barras: juntadas, borda: janela.fromSeconds, esgotou: true, erro: null };
        }

        const r = await fonte.getBars(
          { instrument: { symbol }, periodSeconds, ...janela },
          sinal,
        );
        if (!r.ok) {
          if (r.cause === 'CANCELADA') return { barras: juntadas, borda, esgotou: false, erro: null };
          return { barras: juntadas, borda, esgotou: false, erro: mensagemDeFalha(r.cause) };
        }

        borda = janela.fromSeconds;
        if (r.data.length === 0) vazios += 1;
        else {
          vazios = 0;
          lotes += 1;
          // `unshift` do lote inteiro: os lotes vêm do mais novo para o mais antigo, e a
          // lista final tem de ficar em ordem crescente de tempo.
          juntadas.unshift(...r.data);
        }
        janela = janelaAnterior(janela, periodSeconds, LOTE_BARRAS);
      }

      return { barras: juntadas, borda, esgotou: janela === null, erro: null };
    },
    [fonte, inicioSerie, periodSeconds, symbol],
  );

  // Primeira carga: do agora para trás.
  useEffect(() => {
    if (!ligado) {
      setBarras([]);
      setErro(null);
      setEsgotado(false);
      bordaRef.current = null;
      return;
    }
    if (rotuloDePeriodo(periodSeconds) === null) {
      setBarras([]);
      setErro(`A mesa não tem o período de ${periodSeconds}s (só 5min, 15min, 1h e D1).`);
      return;
    }

    const ctrl = new AbortController();
    setCarregando(true);
    setErro(null);
    setEsgotado(false);

    // ⚠️ A borda inicial é "agora" arredondado para cima no período: a barra em formação
    // ainda não fechou, e pedir até ela evita um buraco de um período na ponta direita.
    const agora = Math.ceil(Date.now() / 1000 / periodSeconds) * periodSeconds;

    void caminharParaTras(agora, LOTES_INICIAIS, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setBarras(r.barras);
      bordaRef.current = r.borda;
      setEsgotado(r.esgotou);
      setErro(r.erro);
      setCarregando(false);
    });

    return () => {
      ctrl.abort();
      setCarregando(false);
    };
  }, [ligado, periodSeconds, symbol, caminharParaTras]);

  const carregarMaisAntigo = useCallback(async (): Promise<number> => {
    const borda = bordaRef.current;
    if (!ligado || borda === null || esgotado) return 0;
    setCarregando(true);
    const r = await caminharParaTras(borda, 1);
    bordaRef.current = r.borda;
    if (r.esgotou) setEsgotado(true);
    if (r.erro !== null) setErro(r.erro);
    if (r.barras.length > 0) setBarras((atual) => [...r.barras, ...atual]);
    setCarregando(false);
    return r.barras.length;
  }, [caminharParaTras, esgotado, ligado]);

  return useMemo<DadoDaMesa>(() => {
    if (!ligado) return { ...VAZIO, carregarMaisAntigo };

    const candles: SyntheticCandle[] = [];
    const volume: SyntheticBundle['volume'] = [];
    const delta = new Map<number, number>();

    for (const b of barras) {
      // ⭐⭐ O AGRESSOR viaja NA VELA, e não só no mapa de delta: é o insumo dos indicadores de
      // fluxo (`delta`, `cvd`, `delta_ratio`), que o leem de `buyVolume`/`sellVolume` da barra.
      // Sem isto eles devolveriam `null` para sempre num ativo que TEM a classificação.
      //
      // ⚠️ Campo AUSENTE quando a fonte não classifica — nunca zero. Ver a disciplina em
      // `order-flow.ts`: zero significa "equilíbrio", e ausência não é leitura nenhuma.
      candles.push({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        ...(b.volume === undefined ? {} : { volume: b.volume }),
        ...(b.buyVolume === undefined || b.sellVolume === undefined
          ? {}
          : { buyVolume: b.buyVolume, sellVolume: b.sellVolume }),
      });
      if (b.volume !== undefined) {
        volume.push({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? UP : DOWN,
        });
      }
      // ⚠️ Só quando a fonte classifica os DOIS lados. Delta com um lado ausente seria o
      // volume total disfarçado de desequilíbrio — leitura invertida na melhor hipótese.
      if (b.buyVolume !== undefined && b.sellVolume !== undefined) {
        delta.set(b.time, b.buyVolume - b.sellVolume);
      }
    }

    return { candles, volume, delta, carregando, erro, esgotado, carregarMaisAntigo };
  }, [ligado, barras, carregando, erro, esgotado, carregarMaisAntigo]);
}

/** Texto em pt-BR para a causa. O detalhe técnico fica no console, não na tela. */
function mensagemDeFalha(cause: string): string {
  switch (cause) {
    case 'TRANSPORTE':
      return 'Sem resposta do serviço de barras. O túnel para a máquina B está no ar?';
    case 'TEMPO_ESGOTADO':
      return 'O serviço de barras demorou demais para responder.';
    case 'NEGADA':
      return 'O serviço de barras recusou a consulta (credencial).';
    case 'INDISPONIVEL':
      return 'A mesa não tem esse ativo neste período.';
    case 'DECODIFICACAO':
      return 'O serviço respondeu num formato inesperado — o contrato mudou.';
    default:
      return 'Não foi possível carregar as barras.';
  }
}
