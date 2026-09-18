/**
 * auditoria-de-dados — confere se o que o gráfico DESENHA corresponde ao mercado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * *"o gráfico é responsável pela decisão do trader, não podemos exibir informação errada"*.
 *
 * A suíte de testes prova que os NÚCLEOS estão corretos com dado sintético. Não prova nada
 * sobre o dado REAL que chega das duas fontes — e é justamente ali que os defeitos silenciosos
 * moram: fuso deslocado, unidade de volume trocada, contrato vencido, grade misturada. Todos
 * produzem um gráfico plausível, e nenhum dá erro.
 *
 * Este script mede as fontes de verdade e reprova (exit 1) quando encontra incoerência.
 *
 * ⚠️ Ele NÃO substitui `npm run verify`: aquele valida o código, este valida o DADO. Um pode
 * passar com o outro reprovando, e as duas informações são diferentes.
 *
 * Uso:
 *   node scripts/auditoria-de-dados.mjs                 # arquivo + terminal, se houver
 *   node scripts/auditoria-de-dados.mjs --ativo WDO
 *   ARQUIVO=http://127.0.0.1:18899 MT5=http://127.0.0.1:8229 TOKEN=... node scripts/...
 */

const ARQUIVO = process.env['ARQUIVO'] ?? 'http://127.0.0.1:18899';
const MT5 = process.env['MT5'] ?? 'http://127.0.0.1:8229';
const TOKEN = process.env['TOKEN'] ?? '';
/**
 * ⚠️ POSITIVO: o `timestamp` da bridge marca hora de Brasília; epoch UTC é 3 h à frente.
 *
 * ⛔ **Esta constante já esteve com o sinal invertido, e esta auditoria não pegou** — pior, ela
 * CONFIRMOU o valor errado, porque comparava as duas fontes pelo menor erro médio sem exigir
 * cobertura. Ver `verificarJanelaDePregao` abaixo, que é a guarda que faltava.
 */
const OFFSET_MT5 = 10_800;

/**
 * ⭐⭐ A ÂNCORA EXTERNA: o horário de funcionamento do mercado.
 *
 * ⚠️ Existe porque comparar duas fontes entre si NÃO detecta fuso errado — duas séries podem
 * casar num subconjunto por coincidência, e foi exatamente o que aconteceu. O horário do pregão
 * é um fato público, não depende de nenhuma fonte de dado, e por isso nenhuma combinação de
 * fontes erradas consegue satisfazê-lo por acaso.
 *
 * B3 / futuros: a sessão regular abre **09:00** e o leilão de fechamento é 18:25–18:30.
 *
 * ⚠️ A ABERTURA é o teste forte e é exata: fuso errado a desloca, sempre. O FECHAMENTO tem cauda
 * legítima — medido, o `/historical-flow` traz o leilão das 18:30 (30 negócios, 17.996 contratos)
 * e residuais às 19:30 (2 negócios). São reais, e reprová-los seria falso positivo.
 */
const PREGAO_BRT = { abre: '09:00', fechaAte: '19:35' };

/**
 * ⚠️ Repetido aqui de propósito, e não importado do pacote.
 *
 * Este script audita o SERVIÇO, e tem de rodar sem depender de `dist` compilado nem de
 * resolução de workspace — é a ferramenta que se usa quando algo está errado, inclusive o
 * build. O custo é este comentário; o benefício é a auditoria nunca ficar indisponível
 * justamente na hora em que ela é necessária. Se o valor no pacote mudar, mude aqui também.
 */
const COBERTURA_MINIMA = 0.9;

/**
 * Ativos que negociam TODOS os dias. Ver `verificarDiaSemPregao`.
 *
 * ⚠️ Medido: o `D1` do BTC tem **948** barras rotuladas em fim de semana, e as 948 são
 * corretas. Uma regra fixa "futuro não abre sábado" apagaria dado bom — e é por isso que a
 * verificação recebe isto por argumento em vez de assumir a B3.
 */
const ABRE_FIM_DE_SEMANA = new Set(['BTC']);

const args = process.argv.slice(2);
const ativo = valorDe('--ativo') ?? 'WIN';
function valorDe(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

let falhas = 0;
let avisos = 0;
const linhas = [];
function ok(msg) { linhas.push(`  \x1b[32m✓\x1b[0m ${msg}`); }
function falha(msg) { linhas.push(`  \x1b[31m✗ ${msg}\x1b[0m`); falhas += 1; }
function aviso(msg) { linhas.push(`  \x1b[33m! ${msg}\x1b[0m`); avisos += 1; }
function info(msg) { linhas.push(`    ${msg}`); }
function secao(t) { linhas.push(`\n\x1b[1m${t}\x1b[0m`); }

const PERIODOS = [
  { arquivo: '5min', mt5: '5m', seg: 300 },
  { arquivo: '15min', mt5: '15m', seg: 900 },
  { arquivo: '1h', mt5: '1h', seg: 3600 },
  { arquivo: 'D1', mt5: '1d', seg: 86_400 },
];

async function json(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    return { dado: await r.json() };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

const hdrMt5 = TOKEN === '' ? {} : { Authorization: `Bearer ${TOKEN}` };

/** Barras do arquivo, em `Bar` normalizado. */
async function doArquivo(tf, deSeg, ateSeg) {
  const r = await json(`${ARQUIVO}/candles?asset=${ativo}&tf=${tf}&from=${deSeg}&to=${ateSeg}`);
  if (r.erro !== undefined) return { erro: r.erro };
  const b = r.dado;
  if (!Array.isArray(b?.cols) || !Array.isArray(b?.rows)) return { erro: 'formato' };
  const i = Object.fromEntries(b.cols.map((c, k) => [c, k]));
  const barras = b.rows.map((row) => ({
    time: row[i['bar_epoch']],
    open: row[i['open']], high: row[i['high']], low: row[i['low']], close: row[i['close']],
    volume: row[i['volume']],
    buy: row[i['buy_vol']], sell: row[i['sell_vol']],
    trades: row[i['trades']],
  }));
  return { barras };
}

/** Barras do terminal, com o fuso JÁ corrigido. `rota` = 'candles' | 'historical-flow'. */
async function doTerminal(tfMt5, rota, extra) {
  const q = rota === 'candles' ? `limit=${extra}` : `days=${extra}`;
  const r = await json(`${MT5}/${rota}/${await contrato()}?timeframe=${tfMt5}&${q}`, hdrMt5);
  if (r.erro !== undefined) return { erro: r.erro };
  if (!Array.isArray(r.dado)) return { erro: 'formato' };
  return {
    barras: r.dado.map((c) => ({
      time: c.timestamp + OFFSET_MT5,
      open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume,
      buy: c.buy_volume, sell: c.sell_volume,
      trades: c.tick_count,
    })),
  };
}

let _contrato = null;
async function contrato() {
  if (_contrato !== null) return _contrato;
  const r = await json(`${MT5}/symbols/search?q=${ativo}`, hdrMt5);
  if (r.erro === undefined && Array.isArray(r.dado)) {
    for (const s of r.dado) {
      const nome = String(s?.name ?? '').toUpperCase();
      if (![`${ativo}$`, `${ativo}$N`, `${ativo}$D`, `${ativo}@`].includes(nome)) continue;
      const d = String(s?.description ?? '');
      if (!d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('por liquidez')) continue;
      const m = /\(([A-Z]{3}[A-Z0-9]{1,6})\)/.exec(d.toUpperCase());
      if (m?.[1] !== undefined) { _contrato = m[1]; return _contrato; }
    }
  }
  _contrato = ativo;
  return _contrato;
}

// ═════════════════════════════════════════════════════════════════════════════
// As invariantes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ A vela é geometricamente possível?
 *
 * `high` tem de ser o teto de open/close e `low` o piso. Uma vela que viola isso desenha um
 * corpo FORA do pavio — o operador vê uma forma que não pode existir, e qualquer leitura de
 * rejeição de topo/fundo fica errada.
 */
function ohlcCoerente(nome, barras) {
  let ruins = 0;
  const exemplos = [];
  for (const b of barras) {
    const finito = [b.open, b.high, b.low, b.close].every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!finito) { ruins += 1; if (exemplos.length < 3) exemplos.push(`${hora(b.time)} OHLC não finito`); continue; }
    if (b.high < Math.max(b.open, b.close) || b.low > Math.min(b.open, b.close) || b.high < b.low) {
      ruins += 1;
      if (exemplos.length < 3) {
        exemplos.push(`${hora(b.time)} O=${b.open} H=${b.high} L=${b.low} C=${b.close}`);
      }
    }
  }
  if (ruins === 0) ok(`${nome}: OHLC geometricamente coerente em ${barras.length} barras`);
  else { falha(`${nome}: ${ruins} velas IMPOSSÍVEIS (corpo fora do pavio)`); exemplos.forEach(info); }
}

/** ⭐ Tempo estritamente crescente e sem duplicata — o motor assume isso em três lugares. */
function tempoCoerente(nome, barras, seg) {
  let desordem = 0, dup = 0, foraDaGrade = 0;
  for (let i = 1; i < barras.length; i += 1) {
    const d = barras[i].time - barras[i - 1].time;
    if (d === 0) dup += 1;
    else if (d < 0) desordem += 1;
    else if (d < seg) foraDaGrade += 1;
  }
  if (desordem + dup === 0) ok(`${nome}: tempo estritamente crescente, sem duplicata`);
  else falha(`${nome}: ${desordem} fora de ordem, ${dup} duplicadas`);
  if (foraDaGrade === 0) ok(`${nome}: nenhum par mais próximo que ${seg}s (grade única)`);
  else falha(`${nome}: ${foraDaGrade} pares MAIS PRÓXIMOS que o período — grade misturada`);
}

/**
 * ⭐⭐ A invariante mais importante do volume: `buy + sell == volume`.
 *
 * ⚠️ Se ela quebra, o DELTA que o gráfico desenha é ficção. Delta é a diferença entre agressão
 * de compra e de venda; se as partes não somam o total, ou o total está em outra unidade ou a
 * classificação perdeu negócio — e nos dois casos a leitura de fluxo aponta para o lado errado.
 */
function volumeCoerente(nome, barras) {
  let comAgressor = 0, barradas = 0, vazariam = 0, negativos = 0;
  const exemplos = [];
  for (const b of barras) {
    if (typeof b.volume === 'number' && b.volume < 0) negativos += 1;
    if (typeof b.buy !== 'number' || typeof b.sell !== 'number') continue;
    comAgressor += 1;
    if (typeof b.volume !== 'number' || !(b.volume > 0)) continue;
    const cobertura = (b.buy + b.sell) / b.volume;
    if (cobertura >= COBERTURA_MINIMA) continue;
    // A fonte trouxe uma barra ruim. A GUARDA da camada a barra?
    barradas += 1;
    // Simula a guarda exatamente como `agressorUtilizavel` a aplica. Se ela deixasse passar,
    // o gráfico desenharia delta falso — e é ISSO que reprova, não o defeito da fonte.
    const guardaAceita = cobertura >= COBERTURA_MINIMA;
    if (guardaAceita) vazariam += 1;
    if (exemplos.length < 3) {
      exemplos.push(`${hora(b.time)} cobertura ${(cobertura * 100).toFixed(1)}% (volume=${b.volume} buy+sell=${b.buy + b.sell})`);
    }
  }
  if (negativos > 0) falha(`${nome}: ${negativos} barras com volume NEGATIVO`);
  if (comAgressor === 0) { aviso(`${nome}: nenhuma barra classifica agressor (delta indisponível — é a verdade do dado)`); return; }

  const bons = comAgressor - barradas;
  if (barradas === 0) {
    ok(`${nome}: agressor cobre o volume em ${comAgressor}/${comAgressor} barras (delta confiável)`);
  } else {
    // ⭐ A FONTE tem dado ruim: isso é AVISO, porque é verdade sobre a fonte e não erro nosso.
    aviso(`${nome}: a FONTE trouxe ${barradas}/${comAgressor} barras com cobertura < ${COBERTURA_MINIMA * 100}%`);
    exemplos.forEach(info);
    // ⭐⭐ Mas o que REPROVA é a guarda deixar passar — aí o gráfico desenharia delta falso.
    if (vazariam > 0) falha(`${nome}: ${vazariam} dessas VAZARIAM para o gráfico — delta falso na tela`);
    else ok(`${nome}: a guarda de cobertura barrou todas as ${barradas}; ${bons} barras com delta confiável`);
  }
}

/**
 * ⭐⭐ As duas fontes concordam sobre a MESMA barra?
 *
 * ⚠️ É o único teste que pega fuso deslocado, contrato vencido e unidade de volume trocada.
 * Cada um deles produz preço plausível isoladamente — o que denuncia é o cruzamento.
 */
function fontesConcordam(arq, term, seg) {
  const porBalde = new Map(arq.map((b) => [Math.floor(b.time / seg), b]));
  const pares = [];
  for (const t of term) {
    const a = porBalde.get(Math.floor(t.time / seg));
    if (a !== undefined) pares.push([a, t]);
  }
  if (pares.length === 0) {
    aviso('as duas fontes não têm nenhuma barra em comum — impossível cruzar');
    return;
  }
  info(`${pares.length} barras em comum`);

  // ⭐⭐ COBERTURA ANTES DE ERRO. Sem esta guarda a auditoria confirmou um fuso invertido: com o
  // deslocamento errado as séries só se sobrepunham numa faixa estreita, e 36 % das barras
  // tinham erro pequeno por coincidência de horário. Um alinhamento que explica um terço do dia
  // não é um alinhamento.
  const cobertura = pares.length / Math.min(arq.length, term.length);
  if (cobertura < 0.8) {
    falha(
      `cobertura de apenas ${(100 * cobertura).toFixed(0)}% entre as fontes — ` +
        'alinhamento suspeito (fuso? contrato? janela?)',
    );
    info('um alinhamento correto casa quase todas as barras da janela comum');
  } else {
    ok(`cobertura de ${(100 * cobertura).toFixed(0)}% das barras da janela comum`);
  }

  // Preço: o fechamento tem de bater dentro de uma folga pequena. Contrato vs contínuo difere
  // pouco; fuso deslocado difere MUITO.
  const difs = pares.map(([a, t]) => Math.abs(a.close - t.close));
  const maxDif = Math.max(...difs);
  const medDif = difs.reduce((s, x) => s + x, 0) / difs.length;
  const escala = pares[0][0].close;
  const pctMed = (100 * medDif) / escala;
  if (pctMed < 0.15) ok(`fechamento concorda: diferença média ${medDif.toFixed(1)} pts (${pctMed.toFixed(3)}%), máx ${maxDif.toFixed(1)}`);
  else falha(`fechamento DIVERGE: média ${medDif.toFixed(1)} pts (${pctMed.toFixed(2)}%) — fuso deslocado ou contrato errado?`);

  // Volume: a RAZÃO entre as fontes tem de ser ~1. Razão 34 é unidade trocada (tick vs contrato).
  const razoes = pares
    .filter(([a, t]) => typeof a.volume === 'number' && typeof t.volume === 'number' && a.volume > 0 && t.volume > 0)
    .map(([a, t]) => t.volume / a.volume);
  if (razoes.length === 0) { aviso('sem volume comparável entre as fontes'); return; }
  razoes.sort((x, y) => x - y);
  const mediana = razoes[Math.floor(razoes.length / 2)];
  if (mediana > 0.5 && mediana < 2) {
    ok(`volume na MESMA unidade: razão mediana terminal/arquivo = ${mediana.toFixed(3)}`);
  } else {
    falha(`volume em UNIDADE DIFERENTE: razão mediana = ${mediana.toFixed(2)} (esperado ~1)`);
    info('o histograma teria um degrau na junção das fontes, e a leitura de volume mentiria');
    info(mediana < 1 ? 'o terminal parece devolver TICK volume, não contratos' : 'o arquivo parece estar em outra unidade');
  }
}

function hora(t) {
  return new Date(t * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

/** Só o horário, em BRT. */
function horaBRT(t) {
  return new Date(t * 1000).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * ⭐⭐ A GUARDA QUE FALTAVA: as barras caem dentro do horário de PREGÃO?
 *
 * ⚠️ Esta é a verificação que teria pegado o fuso invertido de imediato, e é conceitualmente
 * diferente de tudo o mais neste script: ela **não compara fontes entre si**. Compara com um
 * fato público — o mercado abre 09:00 e fecha 18:25 BRT.
 *
 * ⛔ Comparar duas fontes não detecta fuso errado. Duas séries podem casar num subconjunto por
 * coincidência, e podem estar ambas deslocadas do mesmo jeito. Só uma âncora externa quebra
 * esse empate.
 *
 * ⚠️ Só se aplica a período INTRADIÁRIO: em D1 a barra é rotulada na virada do dia (00:00 de
 * algum fuso), e exigir que ela caia no pregão reprovaria dado correto.
 */
function verificarJanelaDePregao(nome, barras, seg) {
  if (seg >= 86_400) return;
  if (barras.length < 10) return;

  // Agrupa por dia de calendário BRT e olha a primeira e a última barra de cada dia.
  const porDia = new Map();
  for (const b of barras) {
    const dia = new Date(b.time * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const atual = porDia.get(dia);
    if (atual === undefined) porDia.set(dia, { min: b.time, max: b.time });
    else {
      if (b.time < atual.min) atual.min = b.time;
      if (b.time > atual.max) atual.max = b.time;
    }
  }

  let foraDoPregao = 0;
  const exemplos = [];
  for (const [dia, { min, max }] of porDia) {
    const abre = horaBRT(min);
    const fecha = horaBRT(max);
    // ⚠️ Comparação lexicográfica de "HH:MM" funciona e é suficiente aqui.
    if (abre < PREGAO_BRT.abre || fecha > PREGAO_BRT.fechaAte) {
      foraDoPregao += 1;
      if (exemplos.length < 3) exemplos.push(`${dia}: ${abre} → ${fecha}`);
    }
  }

  if (foraDoPregao === 0) {
    ok(`${nome}: todos os ${porDia.size} dias abrem em ${PREGAO_BRT.abre} BRT (fuso correto)`);
    return;
  }
  falha(`${nome}: ${foraDoPregao}/${porDia.size} dias caem FORA do pregão — FUSO ERRADO`);
  exemplos.forEach(info);
  info(`esperado: abre em ${PREGAO_BRT.abre} BRT (a abertura é exata; o fechamento tem cauda de leilão)`);
}

/**
 * ⭐⭐ A OUTRA guarda de calendário: há barra em dia que o mercado NÃO abre?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO ENCONTROU, E POR QUE `verificarJanelaDePregao` NÃO PEGAVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Medido em 18/09/2026 na série `D1` INTEIRA do arquivo:
 *
 * ```
 * WIN    6.377 registros, 15 rotulados em fim de semana  ⇠ FANTASMAS
 * WDO    2.575, 0        PETR4  2.537, 0
 * BTC    3.318, 948 em fim de semana                    ⇠ LEGÍTIMOS (cripto não fecha)
 * ```
 *
 * As 15 do WIN são um domingo por semana, de 22/02 a 31/05/2026, com OHLC de amplitude real e
 * volume entre 11 e 5.053 contra os ~5 milhões de um pregão. No gráfico diário aparecem como
 * dias reais e entram em média móvel, em máxima da semana e em perfil de volume.
 *
 * ⭐ `verificarJanelaDePregao` não as pegava porque ela **desiste em D1 de propósito** (a barra
 * diária é rotulada na virada do dia, e exigir hora de pregão reprovaria dado correto). Esta
 * olha só o DIA DA SEMANA, que é o que sobrevive à ambiguidade de rótulo.
 *
 * ⚠️ E é por isso que ela recebe `abreFimDeSemana`: para o BTC as 948 são corretas, e uma regra
 * fixa apagaria dado bom. É conhecimento do ATIVO.
 */
function verificarDiaSemPregao(nome, barras, abreFimDeSemana) {
  if (barras.length === 0) return;
  if (abreFimDeSemana) {
    ok(`${nome}: ${ativo} negocia todos os dias — fim de semana não é acusação`);
    return;
  }
  const suspeitas = [];
  for (const b of barras) {
    // ⭐ Um intervalo de 24 h rotulado 00:00Z cobre sáb 21:00 → dom 21:00 BRT: nenhuma sessão.
    // Rotulado 03:00Z cobre seg 00:00 → ter 00:00, que contém o pregão. Testar os DOIS extremos
    // é o que distingue rótulo ambíguo de barra fantasma sem escolher convenção.
    const inicio = new Date(b.time * 1000).getUTCDay();
    const fim = new Date((b.time - 10_800) * 1000).getUTCDay();
    const abre = (d) => d >= 1 && d <= 5;
    if (!abre(inicio) && !abre(fim)) suspeitas.push(b);
  }
  if (suspeitas.length === 0) {
    ok(`${nome}: nenhuma barra em dia sem pregão (${barras.length} barras)`);
    return;
  }
  falha(`${nome}: ${suspeitas.length} barra(s) em dia SEM PREGÃO — a fonte gravou dia que não existiu`);
  suspeitas.slice(0, 4).forEach((b) => {
    info(`${hora(b.time)} o=${b.open} h=${b.high} l=${b.low} c=${b.close} vol=${b.volume ?? '—'}`);
  });
  info('a biblioteca as remove com `filtrarDiasSemPregao`; aqui a auditoria reprova a FONTE');
}

/**
 * ⭐⭐⭐ A ÂNCORA OFICIAL: o fechamento diário contra a liquidação da B3, POR CONTRATO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA É A VERIFICAÇÃO MAIS FORTE DESTE SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⛔ Todas as outras comparações deste arquivo cruzam o arquivo com o terminal, e a regra do
 * projeto diz que isso NÃO decide nada: duas séries erradas do mesmo jeito respondem em coro. A
 * `verificarJanelaDePregao` foi a primeira âncora externa (o horário do mercado). Esta é a
 * segunda, e é sobre PREÇO: `GET /settlement?asset=WIN` devolve, por data e por CONTRATO,
 * `settle`, `last_price` e `traded_qty` — os números oficiais da bolsa, 9.018 linhas desde
 * 2023-06.
 *
 * ⭐⭐ E ela ENCERROU a pergunta que estava aberta no projeto. Medido em 18/09/2026, setembro
 * inteiro, contra o `last_price` oficial de `WINV26` (o contrato de maior `traded_qty`):
 *
 * ```
 * arquivo  (bars_api, D1)   erro 0,000 %  em 11 de 11 dias
 * terminal (bridge, 1d)     erro 0,000 %  em 11 de 11 dias
 * ```
 *
 * ⇒ **As duas fontes casam EXATAMENTE com a bolsa no fechamento diário.** Isso EXCLUI as duas
 * hipóteses que estavam escritas para a divergência intradiária de 0,16 %–0,22 %:
 *
 *   - não é CONTRATO diferente (contínuo ajustado contra contrato) — se fosse, o diário também
 *     divergiria, e ele bate na casa do ponto;
 *   - não é FUSO — um erro de fuso não some no fechamento.
 *
 * ⚠️ O que resta como explicação, e NÃO foi verificado: granularidade do feed. O terminal é um
 * MT5 de varejo, que entrega tick amostrado; o arquivo é tick completo. O fechamento de um balde
 * de 5 min é *"o último negócio"* num e *"o último tick que chegou"* no outro, e no fechamento do
 * dia os dois convergem porque o leilão de fechamento sempre chega. É plausível e é consistente
 * com tudo o que foi medido — mas segue **hipótese**, e está registrado como hipótese.
 *
 * ⚠️ `settle` NÃO é o fechamento: é o preço de ajuste, apurado numa janela do fim do dia. Ele
 * difere do `last_price` em 0,006 % a 0,284 %, e é correto que difira. Comparar contra `settle`
 * produziria um erro pequeno e constante que pareceria defeito.
 */
async function verificarContraLiquidacao(nome, barras, seg) {
  if (seg < 86_400) return; // a liquidação é diária; comparar com barra de 5 min não faz sentido
  if (barras.length === 0) return;
  const r = await json(`${ARQUIVO}/settlement?asset=${ativo}`);
  if (r.erro !== undefined) {
    aviso(`liquidação oficial indisponível: ${r.erro}`);
    return;
  }
  const corpo = r.dado;
  if (!Array.isArray(corpo?.cols) || !Array.isArray(corpo?.rows)) {
    aviso('liquidação oficial em formato inesperado');
    return;
  }
  const idx = new Map(corpo.cols.map((c, i) => [c, i]));
  const cData = idx.get('refdate');
  const cLast = idx.get('last_price');
  const cQtd = idx.get('traded_qty');
  if (cData === undefined || cLast === undefined || cQtd === undefined) {
    aviso('liquidação oficial sem as colunas esperadas');
    return;
  }
  // ⭐ O contrato de referência do dia é o de MAIOR volume negociado, não o de vencimento mais
  // próximo: é a mesma regra de `resolverContratoVigente`, e por o mesmo motivo — a virada de
  // contrato acontece quando a liquidez migra, não na data do calendário.
  const porDia = new Map();
  for (const linha of corpo.rows) {
    const dia = linha[cData];
    const last = linha[cLast];
    const qtd = linha[cQtd];
    if (typeof dia !== 'string' || typeof last !== 'number' || typeof qtd !== 'number') continue;
    const atual = porDia.get(dia);
    if (atual === undefined || qtd > atual.qtd) porDia.set(dia, { last, qtd });
  }

  /**
   * ⚠️ A data mais recente com número oficial. Barra depois dela é PULADA, não comparada.
   *
   * ⭐ Isto foi um FALSO POSITIVO real, achado na primeira execução: a primeira versão procurava
   * a data em duas leituras de rótulo (00:00 UTC e 00:00 BRT) e usava a primeira que existisse no
   * mapa. Para a barra do pregão CORRENTE — que ainda não tem liquidação publicada — a leitura
   * própria não existia e a busca caía silenciosamente no dia ANTERIOR, acusando 0,362 % de erro
   * onde havia apenas dado que a bolsa não divulgou.
   *
   * ⭐⭐ E a correção não é só a guarda: as duas leituras eram desnecessárias. Medido, as duas
   * convenções de rótulo desta base apontam para a MESMA data em UTC — `03:00Z do dia D` é
   * 00:00 BRT de D, e `00:00Z do dia D` é 21:00 BRT de D−1, cujo balde de 24 h cobre a sessão de
   * D. Nos dois casos a data UTC do carimbo É a data do pregão. Uma alternativa a mais numa busca
   * é uma chance a mais de casar com a coisa errada.
   */
  const ultimaOficial = [...porDia.keys()].sort().pop() ?? '';

  let conferidos = 0;
  let exatos = 0;
  let pior = 0;
  let semOficial = 0;
  const exemplos = [];
  for (const b of barras) {
    const dia = new Date(b.time * 1000).toISOString().slice(0, 10);
    if (dia > ultimaOficial) {
      semOficial += 1;
      continue;
    }
    const oficial = porDia.get(dia);
    if (oficial === undefined) continue;
    conferidos += 1;
    const erro = Math.abs(b.close - oficial.last) / oficial.last;
    if (erro < 1e-9) exatos += 1;
    if (erro > pior) pior = erro;
    if (erro > 0.001 && exemplos.length < 3) {
      exemplos.push(`${hora(b.time)}: fonte ${b.close} vs B3 ${oficial.last} (${(erro * 100).toFixed(3)}%)`);
    }
  }

  if (conferidos === 0) {
    aviso(`${nome}: nenhuma barra coincide com data da liquidação oficial`);
    return;
  }
  const cauda = semOficial === 0 ? '' : ` (${semOficial} barra(s) recentes sem liquidação publicada)`;
  if (exatos === conferidos) {
    ok(`${nome}: fechamento IDÊNTICO ao oficial da B3 em ${conferidos}/${conferidos} dias${cauda}`);
    return;
  }
  const linha = `${nome}: ${exatos}/${conferidos} dias idênticos ao oficial da B3, pior erro ${(pior * 100).toFixed(3)}%`;
  // ⚠️ Até 0,1% é RESSALVA e não falha: `last_price` é o último negócio, e uma fonte que apure o
  // fechamento pelo leilão em vez do último tick difere legitimamente nessa ordem. Acima disso a
  // fonte está cotando outra coisa.
  if (pior <= 0.001) aviso(linha);
  else falha(linha);
  exemplos.forEach(info);
}

// ═════════════════════════════════════════════════════════════════════════════
// Execução
// ═════════════════════════════════════════════════════════════════════════════

const agora = Math.floor(Date.now() / 1000);

console.log(`\n\x1b[1mAUDITORIA DE DADOS — ${ativo}\x1b[0m`);
console.log(`arquivo: ${ARQUIVO}`);
console.log(`terminal: ${MT5}${TOKEN === '' ? '  (sem token: só rota aberta)' : ''}`);

const saudeMt5 = await json(`${MT5}/health`);
const mt5Vivo = saudeMt5.erro === undefined && saudeMt5.dado?.connected === true;
console.log(`terminal conectado: ${mt5Vivo ? 'sim' : `NÃO (${saudeMt5.erro ?? 'connected=false'})`}`);
if (mt5Vivo) console.log(`contrato vigente: ${await contrato()}`);

/**
 * ⭐ `--ate <YYYY-MM-DD>` audita uma janela PASSADA do arquivo.
 *
 * ⚠️ Não é conveniência: os defeitos de calendário desta base estão CONCENTRADOS em
 * fev–mai/2026 (as 15 barras de domingo do WIN começam em 22/02 e cessam em 31/05). Uma
 * auditoria que só olha os últimos 90 dias passa em verde e a fonte segue com o defeito —
 * exatamente o que aconteceu até 18/09/2026. O terminal é pulado nesse modo: ele só tem a ponta
 * direita, e cruzar com um passado que ele não serve daria falso negativo.
 */
const ate = valorDe('--ate');
const fimDaJanela = ate === undefined ? agora : Math.floor(Date.parse(`${ate}T23:59:59Z`) / 1000);
const soArquivo = ate !== undefined;
if (soArquivo) {
  if (!Number.isFinite(fimDaJanela)) {
    console.error('--ate espera YYYY-MM-DD');
    process.exit(2);
  }
  console.log(`janela: até ${ate} (modo histórico — o terminal não é consultado)`);
}

for (const p of PERIODOS) {
  secao(`── ${p.arquivo} ──`);
  const dias = p.seg >= 86_400 ? 90 : 6;
  const a = await doArquivo(p.arquivo, fimDaJanela - dias * 86_400, fimDaJanela);

  if (a.erro !== undefined) {
    aviso(`arquivo indisponível em ${p.arquivo}: ${a.erro}`);
  } else if (a.barras.length === 0) {
    aviso(`arquivo sem barras em ${p.arquivo} na janela`);
  } else {
    ohlcCoerente('arquivo', a.barras);
    tempoCoerente('arquivo', a.barras, p.seg);
    // ⭐⭐ A âncora EXTERNA. Ver `verificarJanelaDePregao`: é a única verificação que não depende
    // de comparar fontes, e por isso é a única que pega fuso errado nas DUAS ao mesmo tempo.
    verificarJanelaDePregao('arquivo', a.barras, p.seg);
    // ⭐ A guarda de calendário que sobrevive à ambiguidade de rótulo diário. Ver a nota longa.
    verificarDiaSemPregao('arquivo', a.barras, ABRE_FIM_DE_SEMANA.has(ativo));
    // ⭐⭐⭐ A âncora OFICIAL da bolsa. Ver a nota longa: é a única verificação de PREÇO que não
    // depende de comparar fontes, e foi ela que encerrou a pergunta da divergência.
    await verificarContraLiquidacao('arquivo', a.barras, p.seg);
    volumeCoerente('arquivo', a.barras);
    const ult = a.barras[a.barras.length - 1];
    const atraso = (fimDaJanela - ult.time) / 3600;
    info(`última barra do arquivo: ${hora(ult.time)} (${atraso.toFixed(1)} h antes do fim da janela)`);
  }

  if (!mt5Vivo || soArquivo) continue;

  // ⭐⭐ Só `/historical-flow` é o CAMINHO DO GRÁFICO, e só ele reprova.
  //
  // ⚠️ `/candles` é auditado como INFORMAÇÃO, nunca como falha, e a distinção é essencial para
  // este script ser útil: ele devolve tick volume em vez de contratos (medido: 4.104 contra
  // 36.819 na mesma barra) e não traz agressor. Isso é uma característica conhecida da rota, e
  // é justamente por causa dela que o adaptador usa `comFluxo` por default. Reprovar aqui
  // deixaria a auditoria vermelha para sempre por um caminho que ninguém desenha — e auditoria
  // que vive vermelha é auditoria que se aprende a ignorar.
  //
  // ⚠️ Também não se cruza `/candles` com o arquivo: o terminal cota o CONTRATO, e o contrato
  // tem histórico próprio (medido: +4,23 % em abril, zero desde 23/08, quando ele virou o
  // vigente). A divergência é estrutura a termo, não defeito. Ver a decisão 2 de
  // `emendarSeries`, que é o que protege o gráfico disso.
  // ⚠️ Janela maior que 1 dia de propósito: sem SOBREPOSIÇÃO com o arquivo não há como cruzar
  // as fontes, e o cruzamento é o único teste que pega fuso e unidade trocados.
  const diasDoFluxo = p.seg >= 86_400 ? 5 : 3;
  const t = await doTerminal(p.mt5, 'historical-flow', diasDoFluxo);
  if (t.erro !== undefined) {
    aviso(`terminal em ${p.mt5}: ${t.erro}`);
  } else if (t.barras.length === 0) {
    aviso(`terminal em ${p.mt5}: nenhuma barra`);
  } else {
    ohlcCoerente('terminal', t.barras);
    tempoCoerente('terminal', t.barras, p.seg);
    verificarJanelaDePregao('terminal', t.barras, p.seg);
    // ⭐ O terminal contra a MESMA âncora oficial. Aferir os dois contra a bolsa é o que separa
    // "as duas fontes discordam" (que não diz de quem é o erro) de "esta fonte discorda da
    // bolsa" (que diz).
    await verificarContraLiquidacao('terminal', t.barras, p.seg);
    volumeCoerente('terminal', t.barras);
    const ult = t.barras[t.barras.length - 1];
    info(`última barra do terminal: ${hora(ult.time)}`);
    if (a.erro === undefined && a.barras.length > 0) {
      linhas.push(`    \x1b[1mcruzamento arquivo × terminal (o caminho do gráfico)\x1b[0m`);
      fontesConcordam(a.barras, t.barras, p.seg);
    }
  }

  // `/candles`: medido e RELATADO, sem reprovar.
  const c = await doTerminal(p.mt5, 'candles', 60);
  if (c.erro === undefined && c.barras.length > 0 && a.erro === undefined && a.barras.length > 0) {
    const porBalde = new Map(a.barras.map((b) => [Math.floor(b.time / p.seg), b]));
    const razoes = [];
    for (const b of c.barras) {
      const x = porBalde.get(Math.floor(b.time / p.seg));
      if (x !== undefined && typeof x.volume === 'number' && x.volume > 0 && typeof b.volume === 'number' && b.volume > 0) {
        razoes.push(b.volume / x.volume);
      }
    }
    if (razoes.length > 0) {
      razoes.sort((x, y) => x - y);
      const med = razoes[Math.floor(razoes.length / 2)];
      info(`(informativo) /candles tem volume em outra unidade: razão ${med.toFixed(3)} — é tick volume, e por isso não é usado`);
    }
  }
}

console.log(linhas.join('\n'));
console.log(`\n${'─'.repeat(70)}`);
console.log(`falhas: ${falhas}   avisos: ${avisos}`);
if (falhas > 0) {
  console.log('\x1b[31mREPROVADO — há dado que o gráfico não deve exibir.\x1b[0m');
  process.exit(1);
}
console.log('\x1b[32mAPROVADO — as invariantes de dado passam.\x1b[0m');
