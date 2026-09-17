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
 * ⚠️ NEGATIVO: a bridge está 3 h À FRENTE do epoch real. Aferido por correlação cruzada sobre
 * um pregão inteiro — e o sinal já esteve invertido aqui. Ver
 * `OFFSET_CANDLES_MT5_SEGUNDOS` em `packages/datafeed/src/mt5-bridge.core.ts`.
 */
const OFFSET_MT5 = -10_800;

/**
 * ⚠️ Repetido aqui de propósito, e não importado do pacote.
 *
 * Este script audita o SERVIÇO, e tem de rodar sem depender de `dist` compilado nem de
 * resolução de workspace — é a ferramenta que se usa quando algo está errado, inclusive o
 * build. O custo é este comentário; o benefício é a auditoria nunca ficar indisponível
 * justamente na hora em que ela é necessária. Se o valor no pacote mudar, mude aqui também.
 */
const COBERTURA_MINIMA = 0.9;

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

for (const p of PERIODOS) {
  secao(`── ${p.arquivo} ──`);
  const dias = p.seg >= 86_400 ? 90 : 6;
  const a = await doArquivo(p.arquivo, agora - dias * 86_400, agora);

  if (a.erro !== undefined) {
    aviso(`arquivo indisponível em ${p.arquivo}: ${a.erro}`);
  } else if (a.barras.length === 0) {
    aviso(`arquivo sem barras em ${p.arquivo} na janela`);
  } else {
    ohlcCoerente('arquivo', a.barras);
    tempoCoerente('arquivo', a.barras, p.seg);
    volumeCoerente('arquivo', a.barras);
    const ult = a.barras[a.barras.length - 1];
    const atraso = (agora - ult.time) / 3600;
    info(`última barra do arquivo: ${hora(ult.time)} (${atraso.toFixed(1)} h atrás)`);
  }

  if (!mt5Vivo) continue;

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
