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
  bridgeConectada,
  criarFonteDeBarrasDaMesa,
  criarFonteDeBarrasDoMt5,
  emendarSeries,
  janelaAnterior,
  janelaDeBackfill,
  resolverContratoDaBridge,
  rotuloDePeriodo,
  rotuloDePeriodoMt5,
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

/**
 * ⭐⭐ Os períodos que o TERMINAL serve — e ele tem MAIS que o arquivo.
 *
 * O MT5 calcula período a partir do próprio feed, então não depende da materialização da base:
 * **M1 e M30 existem lá e não existem aqui**. Com o ao vivo ligado eles ficam alcançáveis, e M1
 * é justamente o período que mais se usa para operar o mini índice.
 *
 * ⚠️ O custo é DECLARADO: nesses períodos não há passado, só o dia corrente. Quem escolher M1 vê
 * uma sessão, e a trilha diz por quê — gráfico com uma sessão só e sem explicação parece defeito.
 */
export const PERIODOS_DO_TERMINAL_IDS: readonly string[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

/** O arquivo tem este período? `false` ⇒ ele só pode vir do terminal. */
export function periodoExisteNoArquivo(id: string): boolean {
  return PERIODOS_DA_MESA_IDS.includes(id);
}

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

  /**
   * ⭐⭐ As barras, CARIMBADAS com o período e o símbolo a que pertencem.
   *
   * ⚠️ Mesmo defeito e mesma correção do ao vivo (ver `aoVivoCarimbado`): a busca é assíncrona,
   * e enquanto o lote novo não chega o estado guarda o lote ANTIGO. Aqui é pior num ponto — o
   * backfill faz `[...novas, ...atuais]`, ou seja **PREPENDE**: um `carregarMaisAntigo` em vôo
   * quando o TF troca costurava barras do período novo na frente das do período velho, e nenhum
   * `setBarras` posterior desfazia isso.
   *
   * O carimbo torna a corrida inexprimível: a leitura descarta o que não casa com o pedido
   * corrente, sem depender de ordem de efeito.
   */
  const [carimbadas, setCarimbadas] = useState<{
    readonly periodSeconds: number;
    readonly symbol: string;
    readonly barras: readonly Bar[];
  } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [esgotado, setEsgotado] = useState(false);

  /** As barras que valem para o pedido CORRENTE. `[]` enquanto o lote novo não chegou. */
  const barras = useMemo<readonly Bar[]>(
    () =>
      carimbadas !== null &&
      carimbadas.periodSeconds === periodSeconds &&
      carimbadas.symbol === symbol
        ? carimbadas.barras
        : [],
    [carimbadas, periodSeconds, symbol],
  );

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
      setCarimbadas(null);
      setErro(null);
      setEsgotado(false);
      bordaRef.current = null;
      return;
    }
    if (rotuloDePeriodo(periodSeconds) === null) {
      setCarimbadas(null);
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
      // O carimbo vai no MESMO `setState` das barras: separá-los reabriria a corrida.
      setCarimbadas({ periodSeconds, symbol, barras: r.barras });
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
    // ⭐⭐ O backfill PREPENDE, e é aqui que o carimbo mais importa: sem ele, um lote em vôo
    // quando o TF troca costurava barras do período novo na frente das do período velho, e
    // nenhum `setState` posterior desfazia. Agora o acréscimo só acontece se o carimbo do
    // estado ainda for o do pedido que originou este lote.
    if (r.barras.length > 0) {
      setCarimbadas((atual) => {
        if (atual === null || atual.periodSeconds !== periodSeconds || atual.symbol !== symbol) {
          return atual;
        }
        return { periodSeconds, symbol, barras: [...r.barras, ...atual.barras] };
      });
    }
    setCarregando(false);
    return r.barras.length;
  }, [caminharParaTras, esgotado, ligado, periodSeconds, symbol]);

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

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ O DIA CORRENTE, DO MT5 — e a emenda com o arquivo
// ═════════════════════════════════════════════════════════════════════════════
//
// O pedido: *"os dados históricos são da base de histórico, mas os dados reais do mini
// índice tem de vir do mt5 direto. histórico é onde vc pegou + o dia atual é sempre do
// mt5"*.
//
// ⭐ E a lacuna é MEDIDA. Em 17/09/2026 às 16:33 BRT, `WIN` em 5min:
//
// | fonte | barras de HOJE | de ONTEM |
// |---|---|---|
// | arquivo (`/mesa`, Postgres da máquina B) | **0** | 114 |
// | bridge MT5 (`/mt5`, terminal XP) | **91** (09:00→16:30) | — |
//
// O arquivo é alimentado por um top-up que roda DEPOIS do pregão. Então durante todo o
// horário de operação o gráfico ficava em D-1 — exatamente quando alguém olha.
//
// ⚠️ Este arquivo NÃO reimplementa a emenda: ela é núcleo puro (`emendarSeries`), com 43
// testes. Aqui só acontece a costura com o ciclo do React e a tradução para a tela.

/**
 * ⭐⭐ De quanto em quanto tempo o dia corrente é repedido, em ms. **Calibrado pelo CUSTO.**
 *
 * ⚠️ Medido em 17/09/2026, WIN 5min, três execuções: `/historical-flow` (a rota com agressor)
 * leva **6,3 / 6,8 / 7,3 s**. E ela roda **dentro do Wine, no mesmo terminal que alimenta o
 * robô que opera**.
 *
 * Com 15 s de intervalo — o valor que eu havia escolhido antes de medir — uma consulta de 7 s
 * ocuparia **quase metade** do tempo de um recurso compartilhado com a operação, para sempre.
 * Não é aceitável gastar isso para desenhar uma tela.
 *
 * 60 s dá ~12% de ocupação e é folgado para a leitura: a barra de 5min só muda de verdade a
 * cada 5 minutos, e a barra em formação mudando com um minuto de atraso é irrelevante para
 * quem lê fluxo. Quem precisa de preço ao segundo usa a boleta, não o gráfico.
 */
const INTERVALO_AO_VIVO_MS = 60_000;

/**
 * Quantos DIAS de fluxo pedir. 1 = o dia corrente, que é exatamente o buraco a tapar.
 *
 * ⚠️ Não aumente sem medir: o custo cresce com o número de ticks reclassificados, e o default
 * da rota (30 dias) estoura 60 s. Ver `montarCaminhoDeCandlesMt5`.
 */
const DIAS_AO_VIVO = 1;

/** O que a emenda acrescenta ao estado da mesa. */
export interface DadoDaMesaComAoVivo extends DadoDaMesa {
  /** A bridge MT5 está de pé e o terminal conectado? */
  readonly aoVivoLigado: boolean;
  /** O contrato que está cotando (`WINV26`), ou `null`. */
  readonly contratoVigente: string | null;
  /** Tempo da primeira barra vinda do MT5, ou `null`. */
  readonly emendaEm: number | null;
  /** Quantas barras vieram do terminal. */
  readonly barrasAoVivo: number;
  /**
   * ⚠️ Buraco entre o fim do arquivo e o começo do ao vivo, se houver.
   *
   * Tem de aparecer na tela: gráfico com buraco silencioso parece pregão sem negócio, e o
   * operador tiraria conclusão de liquidez a partir de falha de coleta.
   */
  readonly lacuna: { readonly de: number; readonly ate: number } | null;
  /**
   * Tempo da barra EM FORMAÇÃO, ou `null`.
   *
   * ⭐ Indicador incremental não pode receber barra parcial em `update()` — o contrato é
   * `preview()` para ela. Quem costura sabe; quem consome não teria como saber.
   */
  readonly parcialEm: number | null;
  /** Por que o ao vivo não está sendo usado, em pt-BR, ou `null`. */
  readonly avisoAoVivo: string | null;
  /**
   * ⭐ Este período existe SÓ no terminal (M1, M30, H4) — então não há passado.
   *
   * ⚠️ Tem de aparecer na tela. Sem isso, escolher M1 mostra uma sessão e nenhum histórico, e
   * a leitura natural é "a ferramenta está quebrada" — quando na verdade é o arquivo que nunca
   * materializou esse período.
   */
  readonly soDoTerminal: boolean;
  /**
   * ⭐⭐ Barras do terminal descartadas por não pertencerem à grade do período.
   *
   * ⚠️ Deve ser **0** em regime. Diferente de zero significa que um lote de outro período
   * chegou — a guarda o barrou, mas o número tem de ficar VISÍVEL: foi justamente por ser
   * silencioso que o defeito "as barras não respeitam o TF" chegou até a tela do operador.
   */
  readonly foraDaGrade: number;
  /**
   * Barras do terminal descartadas por serem anteriores ao fim do arquivo.
   *
   * ⭐ Número ALTO é normal e saudável (o terminal sempre traz passado que o arquivo já tem, e
   * o arquivo é a fonte canônica). Serve como sinal do contrário: 0 com muitas barras novas
   * significa que o arquivo ficou muito atrás.
   */
  readonly descartadasPeloCorte: number;
}

/**
 * A mesa com o dia corrente do MT5 emendado no histórico.
 *
 * ⭐ Envolve `useMesaBars` em vez de substituí-lo: o arquivo continua sendo o dono do
 * passado (com backfill, caminhada para trás e critério de fim de série), e esta camada só
 * acrescenta a ponta direita. Reescrever tudo num hook só perderia o backfill.
 *
 * ⚠️ **Falha do ao vivo NUNCA derruba o histórico.** Bridge fora, token recusado, contrato
 * não resolvido: em todos os casos o gráfico mostra o arquivo e diz o que faltou. A
 * recíproca também vale — arquivo fora com MT5 no ar desenha só o dia corrente.
 */
export function useMesaComAoVivo(params: {
  readonly ligado: boolean;
  readonly symbol: string;
  readonly periodSeconds: number;
  readonly baseUrl?: string;
  /** Origem da bridge. No desenvolvimento, o proxy do Vite (`/mt5`). */
  readonly baseUrlMt5?: string;
  /**
   * Ligar o ao vivo. Default `true`.
   *
   * ⚠️ Existe para o operador poder desligar: uma consulta a cada 15 s vai para o terminal
   * que alimenta o robô, e quem só quer estudar histórico não deve pagar isso.
   */
  readonly aoVivo?: boolean;
}): DadoDaMesaComAoVivo {
  const { ligado, symbol, periodSeconds } = params;
  const baseUrlMt5 = params.baseUrlMt5 ?? '/mt5';
  const querAoVivo = params.aoVivo !== false;

  /**
   * ⭐ O arquivo tem este período? Se não (M1, M30, H4), ele nem é consultado.
   *
   * ⚠️ Não consultar é diferente de consultar e falhar: pedir M1 ao arquivo devolve
   * `INDISPONIVEL`, que a trilha mostraria como ERRO em vermelho. Mas não é erro — é um período
   * que só o terminal serve, e isso é informação, não falha.
   */
  const soDoTerminal = useMemo(
    () => rotuloDePeriodo(periodSeconds) === null && rotuloDePeriodoMt5(periodSeconds) !== null,
    [periodSeconds],
  );

  // O histórico, intacto — com backfill e tudo o que ele já sabia fazer.
  const historico = useMesaBars({
    // ⚠️ Desligado quando o período só existe no terminal: evita a consulta que só pode falhar.
    ligado: ligado && !soDoTerminal,
    symbol,
    periodSeconds,
    ...(params.baseUrl === undefined ? {} : { baseUrl: params.baseUrl }),
  });

  /**
   * ⭐⭐ As barras do terminal, CARIMBADAS com o período e o símbolo a que pertencem.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * O DEFEITO QUE O CARIMBO CORRIGE
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ⚠️ **Relato:** *"quando muda o TF as barras não estão se ajustando conforme o TF"*.
   *
   * Antes isto era `readonly Bar[]` puro. Trocar o TF disparava consulta nova, mas ela é
   * ASSÍNCRONA e a rota com agressor leva **7 s**. Durante esse tempo o estado ainda continha
   * as barras do período ANTIGO, e elas eram emendadas no histórico do período NOVO — o
   * gráfico desenhava as duas grades juntas.
   *
   * ⚠️ E não era só uma janela de 7 s: numa falha de rede a série anterior é **preservada de
   * propósito** (esvaziar faria o gráfico encolher e o pan saltar a cada soluço). Então as
   * barras erradas podiam ficar na tela **indefinidamente**.
   *
   * ⭐ O carimbo torna a corrida INEXPRIMÍVEL: a leitura compara com o que está pedido AGORA e
   * descarta o que não casa. Não depende de ordem de efeito, de tempo de resposta nem de
   * limpeza correta — que é justamente o que falhou. O mesmo vale para o SÍMBOLO: trocar de
   * WIN para WDO tinha o mesmo problema, com preço de outro instrumento.
   */
  const [aoVivoCarimbado, setAoVivoCarimbado] = useState<{
    readonly periodSeconds: number;
    readonly symbol: string;
    readonly barras: readonly Bar[];
  } | null>(null);
  const [contratoVigente, setContratoVigente] = useState<string | null>(null);
  const [aoVivoLigado, setAoVivoLigado] = useState(false);
  const [avisoAoVivo, setAvisoAoVivo] = useState<string | null>(null);

  /**
   * As barras do ao vivo que valem para o pedido CORRENTE. `[]` enquanto o novo período não
   * chegou — e `[]` é a resposta certa: melhor a tela mostrar só o histórico (comportamento
   * conhecido) do que uma série de grade dupla.
   */
  const barrasAoVivo = useMemo<readonly Bar[]>(
    () =>
      aoVivoCarimbado !== null &&
      aoVivoCarimbado.periodSeconds === periodSeconds &&
      aoVivoCarimbado.symbol === symbol
        ? aoVivoCarimbado.barras
        : [],
    [aoVivoCarimbado, periodSeconds, symbol],
  );

  /**
   * O ao vivo só vale para o que o TERMINAL cota.
   *
   * ⚠️ O terminal da mesa é B3/futuros: `WIN` e `WDO` cotam, `BTC` não, e ação depende de o
   * símbolo estar habilitado. Pedir o que ele não tem devolveria vazio, que é
   * indistinguível de "não negociou hoje" — então nem se pede.
   */
  const temAoVivo = useMemo(
    () => querAoVivo && ligado && (symbol === 'WIN' || symbol === 'WDO'),
    [querAoVivo, ligado, symbol],
  );

  const fonteMt5 = useMemo(
    () =>
      criarFonteDeBarrasDoMt5({
        fetch: (url, init) => fetch(url, init),
        baseUrl: baseUrlMt5,
        // ⭐ `comFluxo`: pede `/historical-flow`, que traz `buy_volume`/`sell_volume`
        // classificados pelo terminal — agressor REAL, não Lee-Ready estimado. É o insumo
        // de delta, CVD e footprint, e o playground já sabe consumir pela barra.
        //
        // ⚠️ Custa 10x mais que `/candles` (7,0 s contra 0,7 s, medido). É o que justifica
        // `INTERVALO_AO_VIVO_MS = 60_000` — ver a nota lá.
        comFluxo: true,
        dias: DIAS_AO_VIVO,
        // ⚠️ O token NÃO é passado aqui: o proxy do Vite o injeta server-side, para ele
        // nunca entrar no bundle do navegador. Ver a nota longa em `vite.config.ts`.
        //
        // ⚠️ 20 s de teto porque a consulta MEDIDA leva 7 s: o default de 10 s cortaria
        // consulta legítima num dia de volume alto e o gráfico pareceria sem dado.
        timeoutMs: 20_000,
      }),
    [baseUrlMt5],
  );

  // ── O contrato vigente ────────────────────────────────────────────────────
  //
  // ⭐ Resolvido pela DESCRIÇÃO que a corretora publica (`WIN$` → "Por Liquidez (WINV26)"),
  // nunca por cálculo de data. Ver a nota em `resolverContratoVigente`: resolver por data
  // deixou a origem 3.400 pontos fora do mercado quando a virada veio antes do previsto.
  useEffect(() => {
    if (!temAoVivo) {
      setContratoVigente(null);
      setAoVivoLigado(false);
      setAvisoAoVivo(null);
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      const conectada = await bridgeConectada(
        { fetch: (u, i) => fetch(u, i), baseUrl: baseUrlMt5 },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (!conectada) {
        setAoVivoLigado(false);
        setAvisoAoVivo('Terminal MT5 fora do ar: mostrando só o histórico (até o pregão anterior).');
        return;
      }
      const contrato = await resolverContratoDaBridge(
        { fetch: (u, i) => fetch(u, i), baseUrl: baseUrlMt5 },
        symbol,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      if (contrato === null) {
        setAoVivoLigado(false);
        setAvisoAoVivo(
          `Não foi possível descobrir o contrato vigente de ${symbol} no terminal (credencial?).`,
        );
        return;
      }
      setContratoVigente(contrato);
      setAoVivoLigado(true);
      setAvisoAoVivo(null);
    })();
    return () => ctrl.abort();
  }, [temAoVivo, baseUrlMt5, symbol]);

  // ── O dia corrente, repetido ──────────────────────────────────────────────
  useEffect(() => {
    if (!temAoVivo || contratoVigente === null || !aoVivoLigado) {
      setAoVivoCarimbado(null);
      return;
    }
    // ⚠️ A bridge não tem todos os períodos? Ela tem MAIS que o arquivo (1m e 30m também),
    // então este caminho é raro — mas declarar é melhor que pedir e receber 400.
    if (rotuloDePeriodoMt5(periodSeconds) === null) {
      setAoVivoCarimbado(null);
      setAvisoAoVivo(`O terminal não serve o período de ${periodSeconds}s.`);
      return;
    }

    const ctrl = new AbortController();
    let vivo = true;

    const puxar = async (): Promise<void> => {
      // ⚠️ Sem `limit`: a rota de fluxo recorta por `days` (já configurado na fonte), e mandar
      // `limit` foi exatamente o defeito que fazia a consulta cair no default de 30 dias.
      const r = await fonteMt5.getBars(
        { instrument: { symbol: contratoVigente }, periodSeconds },
        ctrl.signal,
      );
      if (!vivo || ctrl.signal.aborted) return;
      if (r.ok) {
        // ⭐ O carimbo é gravado JUNTO com as barras, no mesmo `setState`. Gravar em dois
        // estados separados reabriria a corrida: haveria um render com barras novas e carimbo
        // velho, que é exatamente o defeito.
        setAoVivoCarimbado({ periodSeconds, symbol, barras: r.data });
        setAvisoAoVivo(null);
        return;
      }
      if (r.cause === 'CANCELADA') return;
      // ⚠️ A série anterior é PRESERVADA numa falha intermitente. Esvaziar faria o gráfico
      // encolher e voltar a crescer a cada soluço de rede — e o pan do operador saltaria.
      setAvisoAoVivo(
        r.cause === 'NEGADA'
          ? 'O terminal recusou a consulta (token da bridge). Mostrando só o histórico.'
          : 'Falha ao ler o dia corrente do terminal. Mostrando o que já foi carregado.',
      );
    };

    void puxar();
    const timer = setInterval(() => void puxar(), INTERVALO_AO_VIVO_MS);
    return () => {
      vivo = false;
      ctrl.abort();
      clearInterval(timer);
    };
  }, [temAoVivo, contratoVigente, aoVivoLigado, periodSeconds, symbol, fonteMt5]);

  // ── A emenda ──────────────────────────────────────────────────────────────
  return useMemo<DadoDaMesaComAoVivo>(() => {
    // As barras do histórico voltam de `SyntheticCandle` para `Bar` — é o vocabulário que a
    // emenda entende, e ele é o mesmo campo por campo.
    const historicoComoBarras: Bar[] = historico.candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      ...(c.volume === undefined ? {} : { volume: c.volume }),
      ...(c.buyVolume === undefined || c.sellVolume === undefined
        ? {}
        : { buyVolume: c.buyVolume, sellVolume: c.sellVolume }),
    }));

    const emendado = emendarSeries(historicoComoBarras, barrasAoVivo, periodSeconds, {
      // ⚠️ Tolerância de 4 dias: entre a última barra do arquivo (pregão anterior) e a
      // primeira de hoje cabem fim de semana e feriado. Sem isto, toda segunda-feira
      // reportaria uma lacuna que é só o calendário.
      toleranciaDeSegundos: 4 * 86_400,
    });

    const candles: SyntheticCandle[] = [];
    const volume: SyntheticBundle['volume'] = [];
    const delta = new Map<number, number>();

    for (const b of emendado.barras) {
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
        volume.push({ time: b.time, value: b.volume, color: b.close >= b.open ? UP : DOWN });
      }
      if (b.buyVolume !== undefined && b.sellVolume !== undefined) {
        delta.set(b.time, b.buyVolume - b.sellVolume);
      }
    }

    return {
      ...historico,
      candles,
      volume,
      delta,
      aoVivoLigado,
      contratoVigente,
      emendaEm: emendado.emendaEm,
      barrasAoVivo: emendado.doAoVivo,
      lacuna: emendado.lacuna,
      parcialEm: emendado.parcialEm,
      avisoAoVivo,
      foraDaGrade: emendado.foraDaGrade,
      descartadasPeloCorte: emendado.descartadasPeloCorte,
      soDoTerminal,
    };
  }, [historico, barrasAoVivo, periodSeconds, aoVivoLigado, contratoVigente, avisoAoVivo, soDoTerminal]);
}
