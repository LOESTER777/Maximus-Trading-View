/**
 * qualidade-da-fonte.core — o que a FONTE sabe sobre os próprios defeitos, como dado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O gráfico é o que decide a operação. Até aqui a biblioteca tinha duas guardas de
 * dado — cobertura de agressor (`agressorUtilizavel`) e coerência entre fontes
 * (`medirCoerencia`) — e as duas olham para UMA barra ou para UM par. Faltava a
 * pergunta que o operador faz de fato: **este trecho de histórico é confiável?**
 *
 * ⭐⭐ A resposta não pode ser deduzida do dado. Ela é CONHECIMENTO SOBRE A FONTE, e
 * chega de fora: de quem mantém a ingestão, de auditoria, de um documento. Este núcleo
 * é o formato desse conhecimento — `PerfilDeQualidade` é um VALOR, passado por
 * argumento — mais as funções que o confrontam com as barras carregadas.
 *
 * ⚠️ **Ele nunca recusa nada.** Devolve um laudo. Recusar histórico por causa de um
 * defeito parcial deixaria o operador sem tela, e tela vazia é pior que tela com
 * ressalva escrita. A única função que remove barra é `filtrarDiasSemPregao`, e ela
 * remove o que não é barra de mercado nenhuma — ver a medição lá.
 *
 * ⭐ Nada aqui menciona a mesa, o WIN ou a B3 no CORPO das funções. O perfil default
 * (`PERFIL_DA_MESA`) é um valor exportado no fim do arquivo, e outro projeto passa o
 * seu — que é o critério de parametrização deste repositório: *comportamento correto
 * por ARGUMENTO, sem tocar no fonte da biblioteca*.
 */

import type { Bar } from './contracts.js';

// ═════════════════════════════════════════════════════════════════════════════
// O vocabulário
// ═════════════════════════════════════════════════════════════════════════════

/** Janela de tempo em epoch de SEGUNDOS. `null` em qualquer ponta = aberto. */
export interface JanelaAferida {
  readonly de: number | null;
  readonly ate: number | null;
}

/**
 * A sessão do mercado — o que permite dizer que uma barra não é de pregão.
 *
 * ⭐ `offsetDoMercadoSegundos` é o que se SOMA ao `time` da barra para ler a hora
 * local do mercado. Para uma fonte que grava epoch UTC real e um mercado em BRT
 * (UTC−3) o valor é **`-10800`**.
 *
 * ⚠️⚠️ **Não confunda com o `offsetSegundos` da bridge MT5, que é `+10800`.** São
 * coisas opostas e coexistem no projeto: a bridge grava um epoch já deslocado (por isso
 * se SOMA 3 h para chegar ao UTC real), e aqui se PARTE do UTC real para chegar à hora
 * local (por isso se SUBTRAI). Trocar um pelo outro desloca a leitura em 6 h — foi
 * exatamente o erro que produziu o commit `eb7c187`, e é por isso que os dois campos
 * têm nomes diferentes em lugares diferentes em vez de uma constante global.
 */
export interface SessaoDeMercado {
  /** Dias da semana com pregão. `0` domingo … `6` sábado. */
  readonly diasComPregao: readonly number[];
  /** Minuto de abertura no fuso do mercado, inclusivo. `9*60` = 09:00. */
  readonly inicioMinutos: number;
  /** Minuto de fechamento no fuso do mercado, EXCLUSIVO. */
  readonly fimMinutos: number;
  /** Segundos a somar ao `time` da barra para obter a hora local do mercado. */
  readonly offsetDoMercadoSegundos: number;
}

/** O que se sabe sobre um período específico da fonte. */
export interface RegraDePeriodo {
  readonly periodSeconds: number;
  readonly situacao: 'CONFIAVEL' | 'RESSALVA' | 'REPROVADO';
  /** Em pt-BR, pronto para a trilha. Obrigatório quando não é `CONFIAVEL`. */
  readonly motivo?: string;
  /** Janela em que ESTE período foi aferido. Sobrepõe a do perfil. */
  readonly janelaAferida?: JanelaAferida;
}

/** O que se sabe sobre a fonte. É um VALOR — cada projeto tem o seu. */
export interface PerfilDeQualidade {
  /** Nome curto, aparece na trilha. */
  readonly nome: string;
  /** Janela em que a fonte foi aferida. Fora dela: `RESSALVA`, nunca recusa. */
  readonly janelaAferida?: JanelaAferida;
  readonly sessao?: SessaoDeMercado;
  readonly regrasPorPeriodo?: readonly RegraDePeriodo[];
  /**
   * Fração mínima das barras da janela que deve trazer agressor para não haver
   * ressalva. `0.5` = metade.
   *
   * ⚠️ É sobre a JANELA CARREGADA, e é diferente de `coberturaMinimaDeAgressor`, que é
   * sobre UMA barra. As duas são necessárias: uma barra pode ter cobertura perfeita e a
   * janela inteira ter só 20 % de barras com agressor — e aí o footprint fica cheio de
   * buracos que o operador leria como "não houve negócio".
   */
  readonly fracaoMinimaComAgressor?: number;
  /**
   * Fração de barras fora da sessão que deixa de ser ruído e passa a ser ressalva.
   *
   * ⚠️ Não é zero de propósito. Medido no arquivo da mesa: **3 barras em 27.746** no ano
   * de 2024 caem fora do pregão (21:35, 21:20, 21:45, com volume 2, 10 e 1). São
   * impressões residuais, não um relógio errado. Já um FUSO trocado põe uma hora inteira
   * fora — ~11 % das barras de um pregão de 9 h 30 — e é isso que o limiar precisa
   * pegar. `0.02` separa os dois casos por duas ordens de grandeza.
   */
  readonly fracaoToleradaForaDaSessao?: number;
}

/** O veredito. Sempre completo, para a trilha poder mostrar sem recalcular nada. */
export interface LaudoDeQualidade {
  readonly nivel: 'OK' | 'RESSALVA' | 'REPROVADO';
  /** Frases em pt-BR, prontas para a tela. Vazio quando `OK`. */
  readonly motivos: readonly string[];
  /** Barras cujo `time` cai fora da janela aferida do perfil. */
  readonly foraDaJanelaAferida: number;
  /** Índices das barras cujo intervalo não toca sessão nenhuma. */
  readonly foraDaSessao: readonly number[];
  /** Barras sem `buyVolume`/`sellVolume` utilizável. */
  readonly semAgressor: number;
  /** Fração com agressor, ou `null` quando não há barras. */
  readonly fracaoComAgressor: number | null;
  /** A regra aplicada ao período pedido, quando o perfil tem uma. */
  readonly regraDoPeriodo: RegraDePeriodo | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// A sessão
// ═════════════════════════════════════════════════════════════════════════════

const SEGUNDOS_POR_DIA = 86_400;
const MINUTOS_POR_DIA = 1440;

/** Dia da semana (`0` domingo) de um epoch em segundos, em UTC. */
function diaDaSemana(epochSegundos: number): number {
  // ⚠️ Sem `Date`: `.core` é puro e `Date` traz o fuso da MÁQUINA para dentro do
  // cálculo. 1970-01-01 foi uma quinta-feira (4), e a aritmética de piso funciona
  // para epoch negativo porque `Math.floor` arredonda para baixo dos dois lados.
  const dias = Math.floor(epochSegundos / SEGUNDOS_POR_DIA);
  return (((dias + 4) % 7) + 7) % 7;
}

/** Minuto do dia (`0`..`1439`) de um epoch em segundos, em UTC. */
function minutoDoDia(epochSegundos: number): number {
  const noDia = epochSegundos - Math.floor(epochSegundos / SEGUNDOS_POR_DIA) * SEGUNDOS_POR_DIA;
  return Math.floor(noDia / 60);
}

/**
 * ⭐⭐ O intervalo `[time, time + periodo)` da barra toca alguma sessão de mercado?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE A PERGUNTA É SOBRE O INTERVALO, E NÃO SOBRE O CARIMBO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Para barra intradiária o carimbo bastaria. Para **barra diária, não** — e o motivo é
 * o defeito que já está documentado em `parseBarrasDaMesa`: a base rotula o MESMO
 * pregão às 00:00 UTC (um escritor) e às 03:00 UTC (outro). Um teste sobre o carimbo
 * teria de saber qual convenção está olhando, e ele não sabe.
 *
 * ⭐ O intervalo resolve isso sem escolher convenção. Uma barra diária cobre 24 h, e as
 * duas convenções fazem esse intervalo conter a sessão do dia:
 *
 * ```
 * rótulo 03:00Z (= 00:00 local) → [seg 00:00, ter 00:00)  contém seg 09:00–18:30 ✔
 * rótulo 00:00Z (= 21:00 local) → [dom 21:00, seg 21:00)  contém seg 09:00–18:30 ✔
 * ```
 *
 * E rejeita o que precisa ser rejeitado, nas duas pontas da semana:
 *
 * ```
 * domingo 00:00Z → [sáb 21:00, dom 21:00)  sábado só depois do fecho, domingo não abre ✘
 * sábado  00:00Z → [sex 21:00, sáb 21:00)  sexta só depois do fecho, sábado não abre ✘
 * ```
 *
 * ⚠️ Um teste ingênuo de "dia da semana do carimbo" aprovaria a segunda linha do
 * primeiro bloco como domingo e a REJEITARIA — apagando um pregão inteiro. Foi por não
 * ter essa distinção que a guarda de grade já descartou o dia corrente em D1 uma vez.
 */
export function intervaloTocaSessao(
  time: number,
  periodSeconds: number,
  sessao: SessaoDeMercado,
): boolean {
  if (!Number.isFinite(time) || !Number.isFinite(periodSeconds) || periodSeconds <= 0) {
    return true; // entrada não aferível não é acusação
  }
  const abre = new Set(sessao.diasComPregao);
  if (abre.size === 0) return true; // sessão sem dia declarado não filtra nada
  // ⭐ 24/7 (cripto) é o caso em que a janela de minutos cobre o dia inteiro: aí só o
  // dia da semana importa, e com os 7 dias declarados nada é rejeitado. É o que faz o
  // mesmo código servir BTC, onde 948 barras diárias caem em fim de semana e TODAS são
  // legítimas — o filtro genérico "sem fim de semana" apagaria as 948.
  const inicio = time + sessao.offsetDoMercadoSegundos;
  const fim = inicio + periodSeconds;

  // Varre os dias locais tocados pelo intervalo. Uma barra de período <= 1 dia toca no
  // máximo dois; o teto protege contra período absurdo (semanal, mensal) sem laço longo.
  const primeiroDia = Math.floor(inicio / SEGUNDOS_POR_DIA);
  const ultimoDia = Math.floor((fim - 1) / SEGUNDOS_POR_DIA);
  const teto = Math.min(ultimoDia, primeiroDia + 400);
  for (let dia = primeiroDia; dia <= teto; dia += 1) {
    const meiaNoite = dia * SEGUNDOS_POR_DIA;
    if (!abre.has(diaDaSemana(meiaNoite))) continue;
    const abertura = meiaNoite + sessao.inicioMinutos * 60;
    const fechamento = meiaNoite + sessao.fimMinutos * 60;
    // Interseção de intervalos semiabertos.
    if (abertura < fim && inicio < fechamento) return true;
  }
  return false;
}

/**
 * Remove as barras cujo intervalo não toca sessão nenhuma. Devolve o que ficou e o que saiu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A MEDIÇÃO QUE JUSTIFICA REMOVER, E O ATIVO QUE PROVA QUE NÃO PODE SER FIXO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Auditado contra o serviço da mesa em 18/09/2026, série `D1` inteira:
 *
 * | ativo | registros | rotulados em fim de semana |
 * |---|---|---|
 * | `WIN` | 6.377 | **15** — todos em 2026, um por domingo, de 22/02 a 31/05 |
 * | `WDO` | 2.575 | 0 |
 * | `PETR4` | 2.537 | 0 |
 * | `BTC` | 3.318 | **948** — e as 948 são LEGÍTIMAS |
 *
 * As 15 do WIN têm OHLC com amplitude de verdade e volume entre **11 e 5.053** contra os
 * ~5 milhões de um pregão. Nenhuma tem agressor. São candles que a B3 não negociou, e
 * num gráfico diário aparecem como um dia real: entram em média móvel, em máxima da
 * semana, em perfil de volume e em qualquer contagem de dias.
 *
 * ⭐⭐ E o BTC é a razão de a sessão ser PARÂMETRO e não constante. Uma regra fixa
 * "futuro não negocia fim de semana" apagaria 948 barras corretas de cripto. O
 * conhecimento "este ativo abre em tais dias e tais horas" é do CATÁLOGO, não da
 * biblioteca.
 *
 * ⚠️ **Horário de verão.** O offset é fixo, e o Brasil teve horário de verão até 2019 —
 * então em dado antigo a leitura da hora local sai 1 h deslocada e o teste de MINUTO
 * pode acusar barra boa. O teste de DIA DA SEMANA é imune (1 h não transforma
 * quarta-feira em domingo), e é por isso que remover só é seguro em cima de dia sem
 * pregão. Para minuto, use o laudo: ele RELATA e não remove.
 */
export function filtrarDiasSemPregao(
  barras: readonly Bar[],
  periodSeconds: number,
  sessao: SessaoDeMercado,
): { readonly mantidas: readonly Bar[]; readonly removidas: readonly Bar[] } {
  const mantidas: Bar[] = [];
  const removidas: Bar[] = [];
  // ⭐ Só o dia da semana entra aqui: a janela de minutos é substituída pelo dia inteiro
  // justamente para o horário de verão não poder causar remoção. Ver a nota acima.
  const soODia: SessaoDeMercado = {
    diasComPregao: sessao.diasComPregao,
    inicioMinutos: 0,
    fimMinutos: MINUTOS_POR_DIA,
    offsetDoMercadoSegundos: sessao.offsetDoMercadoSegundos,
  };
  for (const b of barras) {
    if (intervaloTocaSessao(b.time, periodSeconds, soODia)) mantidas.push(b);
    else removidas.push(b);
  }
  // Devolve o MESMO array quando nada saiu: consumidor que compara identidade (React,
  // memo) não re-renderiza de graça, e o caso comum é não haver nada a remover.
  return removidas.length === 0 ? { mantidas: barras, removidas } : { mantidas, removidas };
}

// ═════════════════════════════════════════════════════════════════════════════
// O laudo
// ═════════════════════════════════════════════════════════════════════════════

function dentroDaJanela(time: number, janela: JanelaAferida | undefined): boolean {
  if (janela === undefined) return true;
  if (janela.de !== null && time < janela.de) return false;
  if (janela.ate !== null && time > janela.ate) return false;
  return true;
}

/** Data em pt-BR a partir de epoch em segundos, sem `Date` e sem fuso de máquina. */
function dataIso(epochSegundos: number): string {
  // Algoritmo civil-from-days (Howard Hinnant), determinístico e puro.
  const dias = Math.floor(epochSegundos / SEGUNDOS_POR_DIA) + 719_468;
  const era = Math.floor(dias / 146_097);
  const diaDaEra = dias - era * 146_097;
  const anoDaEra = Math.floor(
    (diaDaEra - Math.floor(diaDaEra / 1460) + Math.floor(diaDaEra / 36_524) - Math.floor(diaDaEra / 146_096)) / 365,
  );
  let ano = anoDaEra + era * 400;
  const diaDoAno = diaDaEra - (365 * anoDaEra + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100));
  const mp = Math.floor((5 * diaDoAno + 2) / 153);
  const dia = diaDoAno - Math.floor((153 * mp + 2) / 5) + 1;
  const mes = mp < 10 ? mp + 3 : mp - 9;
  if (mes <= 2) ano += 1;
  const dd = String(dia).padStart(2, '0');
  const mm = String(mes).padStart(2, '0');
  return `${dd}/${mm}/${ano}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Confronta as barras carregadas com o que se sabe da fonte.
 *
 * ⚠️ Nunca lança e nunca remove. O pior nível é `REPROVADO`, e mesmo aí o consumidor
 * decide — a disciplina da camada é que falha é VALOR DE RETORNO. Um laudo que apagasse
 * a tela transformaria conhecimento sobre a fonte em indisponibilidade de gráfico.
 */
export function avaliarQualidade(
  perfil: PerfilDeQualidade,
  entrada: { readonly periodSeconds: number; readonly barras: readonly Bar[] },
): LaudoDeQualidade {
  const { periodSeconds, barras } = entrada;
  const motivos: string[] = [];
  let nivel: LaudoDeQualidade['nivel'] = 'OK';
  const piora = (n: LaudoDeQualidade['nivel']): void => {
    if (n === 'REPROVADO') nivel = 'REPROVADO';
    else if (n === 'RESSALVA' && nivel === 'OK') nivel = 'RESSALVA';
  };

  const regra = perfil.regrasPorPeriodo?.find((r) => r.periodSeconds === periodSeconds) ?? null;
  if (regra !== null && regra.situacao !== 'CONFIAVEL') {
    piora(regra.situacao);
    motivos.push(regra.motivo ?? `Período marcado como ${regra.situacao.toLowerCase()} pela fonte.`);
  }

  // A janela da REGRA vence a do perfil: conhecimento específico é mais preciso que
  // conhecimento geral, e foi medido separadamente.
  const janela = regra?.janelaAferida ?? perfil.janelaAferida;

  let foraDaJanelaAferida = 0;
  let semAgressor = 0;
  const foraDaSessao: number[] = [];

  for (let i = 0; i < barras.length; i += 1) {
    const b = barras[i];
    if (b === undefined) continue;
    if (!dentroDaJanela(b.time, janela)) foraDaJanelaAferida += 1;
    if (b.buyVolume === undefined || b.sellVolume === undefined) semAgressor += 1;
    if (perfil.sessao !== undefined && !intervaloTocaSessao(b.time, periodSeconds, perfil.sessao)) {
      foraDaSessao.push(i);
    }
  }

  const n = barras.length;
  const fracaoComAgressor = n === 0 ? null : (n - semAgressor) / n;

  if (foraDaJanelaAferida > 0 && janela !== undefined) {
    const ate = janela.ate === null ? null : dataIso(janela.ate);
    const de = janela.de === null ? null : dataIso(janela.de);
    const alcance = de === null ? `até ${ate ?? '—'}` : ate === null ? `de ${de} em diante` : `${de} a ${ate}`;
    motivos.push(
      `${foraDaJanelaAferida} de ${n} barras estão fora da janela aferida da fonte (${alcance}).`,
    );
    piora('RESSALVA');
  }

  const minimoAgressor = perfil.fracaoMinimaComAgressor;
  if (minimoAgressor !== undefined && fracaoComAgressor !== null && fracaoComAgressor < minimoAgressor) {
    motivos.push(
      `Só ${pct(fracaoComAgressor)} das barras trazem volume por agressor: delta e footprint ficam vazios no resto.`,
    );
    piora('RESSALVA');
  }

  if (foraDaSessao.length > 0 && n > 0) {
    const fracao = foraDaSessao.length / n;
    const tolerada = perfil.fracaoToleradaForaDaSessao ?? 0;
    if (fracao > tolerada) {
      // ⭐ A frase distingue os dois diagnósticos porque o remédio é outro. Poucas barras
      // fora = impressão residual, ignorável. Muitas = FUSO, e aí o gráfico inteiro está
      // deslocado. Ver a nota de `fracaoToleradaForaDaSessao`.
      motivos.push(
        fracao >= 0.05
          ? `${foraDaSessao.length} de ${n} barras (${pct(fracao)}) caem fora do horário de pregão — suspeita de fuso errado, não de dado residual.`
          : `${foraDaSessao.length} de ${n} barras caem fora do horário de pregão.`,
      );
      piora(fracao >= 0.05 ? 'REPROVADO' : 'RESSALVA');
    }
  }

  return {
    nivel,
    motivos,
    foraDaJanelaAferida,
    foraDaSessao,
    semAgressor,
    fracaoComAgressor,
    regraDoPeriodo: regra,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Sessões prontas — VALORES, e trocáveis
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Futuros da B3 (WIN, WDO): segunda a sexta, 09:00 às 18:30, mercado em UTC−3.
 *
 * ⚠️ O fechamento real do WIN é 18:25 (com after de leilão até 18:30 em alguns
 * regimes). `fimMinutos` é **18:35** de propósito: a última barra de 5 min carimbada
 * 18:30 é legítima e um teto justo no minuto do fecho a acusaria. Guarda de dado se
 * quer folgada no limite conhecido e apertada em ordem de grandeza — 21:35 continua
 * fora por três horas.
 *
 * ⭐ Medido no arquivo da mesa (`5min`, um mês por ano): primeira barra às **09:00** em
 * 2015, 2020, 2023, 2024, 2025 e 2026; última às 18:00 (2015), 18:15 (2020) e 18:30
 * (2023 em diante). A janela cobre as três épocas sem precisar de calendário histórico.
 */
export const SESSAO_B3_FUTUROS: SessaoDeMercado = {
  diasComPregao: [1, 2, 3, 4, 5],
  inicioMinutos: 9 * 60,
  fimMinutos: 18 * 60 + 35,
  offsetDoMercadoSegundos: -10_800,
};

/**
 * Ações da B3: segunda a sexta, 09:45 às 18:30 — MAIS LARGA que o pregão nominal.
 *
 * ⚠️ A largura é deliberada: o horário do mercado à vista MUDOU ao longo da série
 * (10:00–17:00 até 2019, 10:00–18:00 depois, mais leilão de abertura desde 09:45 e de
 * fechamento até ~18:10). Estreitar para o regime de hoje acusaria a metade antiga do
 * histórico, e a guarda que grita no dado bom deixa de ser lida.
 */
export const SESSAO_B3_ACOES: SessaoDeMercado = {
  diasComPregao: [1, 2, 3, 4, 5],
  inicioMinutos: 9 * 60 + 45,
  fimMinutos: 18 * 60 + 30,
  offsetDoMercadoSegundos: -10_800,
};

/** Mercado sem fecho (cripto). Nada é fora de sessão. */
export const SESSAO_24_7: SessaoDeMercado = {
  diasComPregao: [0, 1, 2, 3, 4, 5, 6],
  inicioMinutos: 0,
  fimMinutos: MINUTOS_POR_DIA,
  offsetDoMercadoSegundos: 0,
};

// ═════════════════════════════════════════════════════════════════════════════
// O perfil da mesa — o conhecimento medido, como VALOR
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ O que se sabe sobre o arquivo da mesa (`bars_api`, Postgres `tick_archive`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FONTE É ÚNICA; A SÉRIE, NÃO — E ISSO É A ORIGEM DE TUDO AQUI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Há **uma** base de histórico nesta rede (máquina B). Mas a tabela que o serviço lê
 * (`bars_agg`) não tem coluna de contrato e é escrita por **TRÊS** processos diferentes,
 * todos gravando sob o mesmo rótulo `asset='WIN'`:
 *
 * 1. agregação do tick contínuo ajustado (`historical_ticks`, `WIN$N`);
 * 2. agregação do tick CRU do contrato (`win_ticks_YYYY`, ex. `WINV2026`) — roda depois
 *    e vence por `ON CONFLICT DO UPDATE`;
 * 3. preenchimento a partir dos candles do MT5 — **sem agressor**, e com volume que cai
 *    para `tick_volume` quando o outro falta.
 *
 * ⚠️ Nada disso é defeito desta biblioteca, e nada disso é corrigível aqui. O que é
 * responsabilidade daqui é **não exibir como equivalente aquilo que não é**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS MEDIÇÕES QUE FIXARAM CADA CAMPO (18/09/2026, contra o serviço)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ **A âncora usada foi EXTERNA às duas convenções de D1:** o dia apurado somando as
 * barras de `1h` (que vêm da agregação de tick). Comparar os dois registros de D1 entre
 * si não decide nada — duas séries erradas do mesmo jeito respondem em coro.
 *
 * ```
 * WIN   40 dias com par: o registro MAIS TARDIO acerta o close em 40/40 (erro 0,000 %)
 *                        o mais cedo erra de 3,7 % a 5,9 %
 * PETR4 43 dias com par: o MAIS TARDIO acerta em 43/43; o mais cedo erra ~1,35 %
 * WDO   43 dias com par: o MAIS TARDIO acerta o close, MAS traz só 21–28 % do volume
 *                        e NENHUM agressor; o mais cedo traz 73–92 % do volume e TEM
 *                        agressor (201 de 785 pares na série inteira)
 * ```
 *
 * ⇒ A colapsagem por "mantém o mais tardio" de `parseBarrasDaMesa` está **certa no
 * preço** nos três ativos, e é isso que a valida. O custo, medido, é o WDO perder o
 * agressor em 201 barras diárias — e por isso existe `politicaDeD1`.
 *
 * ⭐⭐ **Quando a divergência começou:** o close dos dois registros de D1 do WIN era
 * IDÊNTICO (mediana 0,000 %, máximo 0,00 %) de 2023-01 até **2026-01**. Em 2026-02 salta
 * para mediana de 3,07 % e não volta. Os pares cessam em 29/05/2026; de 06/2026 em
 * diante há um registro só por dia.
 *
 * ⭐⭐ **O agressor intradiário quebrou em 06/2026** (`WIN 5min`, barras sem
 * `buy_vol`/`sell_vol`):
 *
 * ```
 * 2026-05:    0 de 2.283      2026-06: 1.132 de 2.309 (49 %)
 * 2026-07: 1.624 de 2.602 (62 %)   2026-08: 1.034 de 2.377 (44 %)   2026-09: 219 de 1.368 (16 %)
 * ```
 *
 * E entre as que TÊM, a razão `(buy+sell)/volume` mudou de natureza: mediana 0,982 até
 * maio (uma folga de ~2 %, que é o normal de leilão e cruzamento) e **exatamente 1,000**
 * de julho em diante — o escritor novo força a soma a fechar. O p5 de julho é 0,316:
 * barras da abertura de 01/07 têm 42 % de cobertura, e o delta delas é outra medida, não
 * uma medida imprecisa. `agressorUtilizavel` já as barra uma a uma; o que este perfil
 * acrescenta é dizer ao operador **quanto** da janela está assim.
 *
 * ⚠️ `janelaAferida` termina em **31/03/2026** porque é até onde a documentação da
 * própria base declara conferência. Isso significa que o pregão de HOJE cai fora e a
 * trilha mostra ressalva — e está correto que mostre: o dado recente é o que ninguém
 * conferiu. **Ressalva não é recusa**; o gráfico continua desenhando.
 *
 * ⚠️ `30min` e `4h` são `REPROVADO` porque não existem na base — quem os pede recebe
 * agregação de outra origem. Medido: 79,5 % das barras de 30min e 51,6 % das de 4h têm
 * agressor, contra 100 % de 5min e 15min no mesmo período. Preferir `rollupBars` sobre
 * 5min, que é a série íntegra.
 */
export const PERFIL_DA_MESA: PerfilDeQualidade = {
  nome: 'Arquivo da mesa',
  janelaAferida: {
    // 2023-06-01T00:00:00Z — início da janela canônica declarada pela base.
    de: 1_685_577_600,
    // 2026-03-31T23:59:59Z — fim da conferência declarada.
    ate: 1_775_001_599,
  },
  sessao: SESSAO_B3_FUTUROS,
  fracaoMinimaComAgressor: 0.5,
  fracaoToleradaForaDaSessao: 0.02,
  regrasPorPeriodo: [
    {
      periodSeconds: 60,
      situacao: 'RESSALVA',
      motivo:
        '1min começa em jun/2023 e tem buraco: jun/2026 vem vazio e jul/2026 traz 1.236 das ~12.000 barras.',
      // 2023-06-01 — antes disso a base não tem 1min (2015, 2018 e 2021 devolvem vazio).
      janelaAferida: { de: 1_685_577_600, ate: 1_775_001_599 },
    },
    {
      periodSeconds: 120,
      situacao: 'RESSALVA',
      motivo: '2min começa em jun/2023 e compartilha o buraco de jun–jul/2026 com o 1min.',
      janelaAferida: { de: 1_685_577_600, ate: 1_775_001_599 },
    },
    { periodSeconds: 300, situacao: 'CONFIAVEL' },
    { periodSeconds: 900, situacao: 'CONFIAVEL' },
    {
      periodSeconds: 1800,
      situacao: 'REPROVADO',
      motivo: '30min não existe na base: a série vem de outra origem e só 79,5% das barras têm agressor.',
    },
    {
      periodSeconds: 3600,
      situacao: 'RESSALVA',
      motivo: '1h: 21% das barras trazem volume por agressor incompleto (p5 de cobertura em 3,1%).',
    },
    {
      periodSeconds: 14_400,
      situacao: 'REPROVADO',
      motivo: '4h não existe na base: só 51,6% das barras têm agressor. Prefira agregar 5min.',
    },
    {
      periodSeconds: 86_400,
      situacao: 'RESSALVA',
      motivo:
        'D1 tem dois registros por pregão, de escritores diferentes; a biblioteca mantém o mais tardio (aferido: acerta o fechamento em 126 de 126 dias).',
    },
  ],
};
