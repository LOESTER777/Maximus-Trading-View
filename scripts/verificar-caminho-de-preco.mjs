#!/usr/bin/env node
/**
 * verificar-caminho-de-preco — a EMENDA de três camadas, contra as fontes reais.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ISTO PROVA, E POR QUE PRECISA SER UM SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O relato foi visual: *"os movimentos e a direção das barras não condizem com o que é real"*,
 * com as duas telas lado a lado. A causa está medida (o arquivo perdeu ~80 % dos negócios do
 * intradiário desde jun/2026) e a correção está no playground — mas a correção só vale se a série
 * que sai dela realmente tiver a amplitude do mercado.
 *
 * ⚠️ A bancada de testes não pode provar isso: ela roda sem rede, por disciplina. Este script é a
 * verificação de INTEGRAÇÃO, e a pergunta que ele responde é uma só:
 *
 *   **a amplitude do dia na série emendada é a do TERMINAL (real) ou a do ARQUIVO (incompleta)?**
 *
 * Uso: `node scripts/verificar-caminho-de-preco.mjs [--ativo WIN] [--tf 5min]`
 * Exige a bridge no ar e `MT5_BRIDGE_AUTH_TOKEN` em `TOKEN`.
 */

// ⚠️ Importa o `dist`, não o `src`: este projeto não tem `tsx` instalado, e instalar um
// transpilador só para rodar um script de verificação é dependência nova por conveniência. O
// `dist` é justamente o que um consumidor importaria — verificar contra ele é mais fiel.
// Rode `npm run build -w @robustus/charts-datafeed` antes, se necessário.
import { emendarSeries } from '../packages/datafeed/dist/splice-series.core.js';

const ARQUIVO = process.env['ARQUIVO'] ?? 'http://127.0.0.1:18899';
const MT5 = process.env['MT5'] ?? 'http://127.0.0.1:8229';
const TOKEN = process.env['TOKEN'] ?? '';
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const ativo = flag('--ativo') ?? 'WIN';
const tf = flag('--tf') ?? '5min';
const SEG = { '1min': 60, '2min': 120, '5min': 300, '15min': 900, '1h': 3600 }[tf] ?? 300;

/** ⚠️ `+10800`: o `timestamp` da bridge marca hora de Brasília. Ver `00-projeto.md`. */
const OFFSET_MT5 = 10_800;

async function json(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.json();
}

const hdr = TOKEN === '' ? {} : { Authorization: `Bearer ${TOKEN}` };

const agora = Math.floor(Date.now() / 1000);
const de = agora - 7 * 86_400;

// ── arquivo ──────────────────────────────────────────────────────────────────
const corpo = await json(`${ARQUIVO}/candles?asset=${ativo}&tf=${tf}&from=${de}&to=${agora}`);
const iA = Object.fromEntries(corpo.cols.map((c, i) => [c, i]));
const arq = corpo.rows.map((r) => ({
  time: r[iA['bar_epoch']],
  open: r[iA['open']],
  high: r[iA['high']],
  low: r[iA['low']],
  close: r[iA['close']],
  ...(r[iA['volume']] == null ? {} : { volume: r[iA['volume']] }),
}));

// ── contrato vigente, pela DESCRIÇÃO (nunca por data) ────────────────────────
//
// ⚠️ `--contrato` existe porque `/symbols/search` mediu **18 s** com a bridge ocupada: ela
// serializa, e este script não pode ficar refém de uma rota de metadado para aferir preço.
let contrato = flag('--contrato');
if (contrato === undefined) {
  const busca = await json(`${MT5}/symbols/search?q=${ativo}`, hdr);
  const lista = Array.isArray(busca) ? busca : (busca.symbols ?? busca.results ?? []);
  contrato =
    lista.map((s) => /\(([A-Z]{3}[A-Z0-9]{2,4})\)/.exec(s.description ?? '')?.[1]).find(Boolean) ??
    lista.find((s) => /^[A-Z]{3}[FGHJKMNQUVXZ]\d\d$/.test(s.name ?? ''))?.name;
}
if (contrato === undefined) {
  console.error('não foi possível resolver o contrato vigente — passe --contrato WINV26');
  process.exit(2);
}

// ── camada 2: caminho de preço profundo (`/candles`, SEM volume) ─────────────
const TF_MT5 = { 60: '1m', 120: null, 300: '5m', 900: '15m', 3600: '1h' }[SEG];
if (TF_MT5 === null || TF_MT5 === undefined) {
  console.error(`o terminal não serve o período de ${SEG}s`);
  process.exit(2);
}
const cru = await json(`${MT5}/candles/${contrato}?timeframe=${TF_MT5}&limit=1500`, hdr);
const caminho = (Array.isArray(cru) ? cru : (cru.candles ?? []))
  .map((c) => ({
    time: c.timestamp + OFFSET_MT5,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    // ⚠️ SEM volume, de propósito: `/candles` devolve tick volume. Ver `omitirVolume`.
  }))
  .filter((b) => b.time >= de && b.time <= agora);

// ── a emenda, exatamente como o playground monta ─────────────────────────────
const camada2 =
  caminho.length === 0
    ? { barras: arq, doAoVivo: 0 }
    : emendarSeries(arq, caminho, SEG, {
        precedencia: 'AO_VIVO_VENCE',
        toleranciaDeSegundos: 4 * 86_400,
        aoDivergir: 'EMENDAR_MESMO_ASSIM',
      });

// ── a aferição: amplitude por dia ────────────────────────────────────────────
const porDia = (barras) => {
  const m = new Map();
  for (const b of barras) {
    // BRT = UTC − 3 h. O `bar_epoch` do arquivo é epoch UTC real.
    const dia = new Date((b.time - 10_800) * 1000).toISOString().slice(0, 10);
    const a = m.get(dia) ?? { lo: Infinity, hi: -Infinity, n: 0 };
    a.lo = Math.min(a.lo, b.low);
    a.hi = Math.max(a.hi, b.high);
    a.n += 1;
    m.set(dia, a);
  }
  return m;
};

const dArq = porDia(arq);
const dTerm = porDia(caminho);
const dFinal = porDia(camada2.barras);

console.log(`\n\x1b[1mCAMINHO DE PREÇO — ${ativo} ${tf} (contrato ${contrato})\x1b[0m`);
console.log(`arquivo: ${arq.length} barras · terminal: ${caminho.length} · emendado: ${camada2.barras.length}\n`);
console.log('dia          arq_amp   term_amp   FINAL_amp   veredito');

let bons = 0;
let ruins = 0;
for (const dia of [...dFinal.keys()].sort()) {
  const a = dArq.get(dia);
  const t = dTerm.get(dia);
  const f = dFinal.get(dia);
  if (t === undefined || a === undefined) continue;
  const ampA = a.hi - a.lo;
  const ampT = t.hi - t.lo;
  const ampF = f.hi - f.lo;
  // ⭐ O critério: a série final tem de reproduzir a amplitude do TERMINAL, não a do arquivo.
  // Tolerância de 1 % porque a barra em formação e as bordas do dia podem diferir por uma barra.
  const ok = Math.abs(ampF - ampT) / ampT <= 0.01;
  if (ok) bons += 1;
  else ruins += 1;
  const cor = ok ? '\x1b[32m✓ real\x1b[0m' : '\x1b[31m✗ ficou com a do arquivo\x1b[0m';
  console.log(
    `${dia}   ${ampA.toFixed(0).padStart(7)}   ${ampT.toFixed(0).padStart(8)}   ${ampF
      .toFixed(0)
      .padStart(9)}   ${cor}`,
  );
}

console.log('\n' + '─'.repeat(70));
if (ruins === 0 && bons > 0) {
  console.log(`\x1b[32mOK — a série emendada tem a amplitude REAL em ${bons}/${bons} dias.\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31mFALHOU — ${ruins} dia(s) ficaram com a amplitude incompleta do arquivo.\x1b[0m`);
process.exit(1);
