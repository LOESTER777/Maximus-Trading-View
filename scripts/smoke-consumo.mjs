#!/usr/bin/env node
/**
 * smoke-consumo — prova que o ARTEFATO PUBLICADO e instalavel e importavel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE TESTE EXISTE, SE JA HA 1172 TESTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `npm run verify` valida o FONTE: typecheck, extensao ESM, suite. Nenhuma
 * dessas etapas passa pelo `exports`, pelo `files`, pelo `main` nem pelo
 * resolvedor de modulo do Node em um projeto de FORA. No workspace, `@robustus/x`
 * resolve por SYMLINK — o Node ve o diretorio inteiro do pacote, `files` e
 * ignorado e `exports` e satisfeito por acidente. Um `exports` errado, um `files`
 * que esquece o `dist`, um import relativo sem `.js`: nada disso reprova no
 * workspace. Reprova no primeiro `npm i` do consumidor.
 *
 * Este script fecha esse buraco: empacota com `npm pack` (o mesmo tarball que o
 * `npm publish` sobe), instala FORA do workspace num diretorio temporario e roda
 * dois imports em Node ESM puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE CADA CHECAGEM PROVA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. CONTEUDO DO TARBALL — `dist/index.js` e `dist/index.d.ts` presentes,
 *     nenhum `.spec` vazado, `src` presente para os source maps (ver README,
 *     secao de source maps). Roda para TODOS os pacotes publicaveis.
 *  2. ROBO SEM DOM — instala so `charts-indicators` + `charts-alerts` e calcula
 *     indicador + dispara alerta em Node puro. E o caso de uso de robo, e a
 *     ausencia de `document`/`window` no Node e a barreira: se algum modulo
 *     tocar DOM no topo, o import estoura aqui.
 *  3. MOTOR IMPORTAVEL — `charts-engine` importa em Node sem canvas. Nao cria
 *     grafico (isso precisa de tela); prova que o modulo CARREGA, que e o que
 *     quebra em SSR do Next quando alguem toca `document` no topo do modulo.
 *  4. `./package.json` NO EXPORTS — `require.resolve('@robustus/x/package.json')`.
 *     Vite e alguns resolvedores leem isso; sem a entrada da
 *     `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *  5. SOURCE MAP RESOLVIVEL — le `sources` do `.js.map` instalado e confere que o
 *     `.ts` apontado EXISTE dentro do pacote. Mapa que aponta para arquivo
 *     ausente e pior que mapa nenhum: o depurador abre em branco.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/smoke-consumo.mjs                  # empacota, instala, testa
 *   node scripts/smoke-consumo.mjs --keep           # nao apaga o diretorio temp
 *   node scripts/smoke-consumo.mjs --sem-build      # reusa o dist atual
 *   node scripts/smoke-consumo.mjs --pack-only --out tarballs
 *
 * ⚠️ SEM REDE por decisao: `npm pack` e local e a instalacao usa `file:` +
 * `overrides`, com `--offline`. Se este script precisasse de rede, ele nao
 * poderia rodar antes de existir registry — e a ordem certa e provar o pacote
 * ANTES de publicar.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const temFlag = (f) => args.includes(f);
const valorDe = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const MANTER = temFlag('--keep');
const SEM_BUILD = temFlag('--sem-build');
const SO_EMPACOTAR = temFlag('--pack-only');

// ═════════════════════════════════════════════════════════════════════════════
// Saida
// ═════════════════════════════════════════════════════════════════════════════

let falhas = 0;
const ok = (msg) => console.log(`  \u001b[32mok\u001b[0m   ${msg}`);
const falha = (msg, detalhe) => {
  falhas += 1;
  console.error(`  \u001b[31mFALHA\u001b[0m ${msg}`);
  if (detalhe) console.error(`       ${String(detalhe).split('\n').join('\n       ')}`);
};
const titulo = (msg) => console.log(`\n\u001b[1m${msg}\u001b[0m`);

function sh(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm de projeto grande estoura o buffer padrao de 1 MB.
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// (0) Quais pacotes sao publicaveis
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Le `packages/ * /package.json` e devolve os publicaveis.
 *
 * ⚠️ A lista NAO e escrita a mao: `private: true` e a fonte da verdade (e por
 * isso que `devtools` sai daqui sozinho). Lista manual divergiria no dia em que
 * um pacote novo entrasse.
 */
function pacotesPublicaveis() {
  const dirs = sh('ls', ['-1', join(RAIZ, 'packages')])
    .trim()
    .split('\n')
    .filter(Boolean);
  const out = [];
  for (const d of dirs) {
    const p = join(RAIZ, 'packages', d, 'package.json');
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    if (pkg.private === true) continue;
    out.push({ dir: join(RAIZ, 'packages', d), nome: pkg.name, pkg });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// (1) Empacotar
// ═════════════════════════════════════════════════════════════════════════════

function empacotar(pacotes, destino) {
  mkdirSync(destino, { recursive: true });
  const tarballs = new Map();
  for (const p of pacotes) {
    // `npm pack --json` devolve tambem a LISTA de arquivos do tarball — e o que
    // permite checar conteudo sem descompactar.
    const saida = sh('npm', ['pack', '--json', '--pack-destination', destino], p.dir);
    const info = JSON.parse(saida)[0];
    tarballs.set(p.nome, { caminho: join(destino, info.filename), arquivos: info.files.map((f) => f.path) });
  }
  return tarballs;
}

function conferirConteudo(pacotes, tarballs) {
  titulo('(1) Conteudo do tarball');
  for (const p of pacotes) {
    const t = tarballs.get(p.nome);
    const arquivos = t.arquivos;
    const precisa = ['package.json', 'dist/index.js', 'dist/index.d.ts'];
    const faltando = precisa.filter((f) => !arquivos.includes(f));
    if (faltando.length > 0) {
      falha(
        `${p.nome}: tarball sem ${faltando.join(', ')}`,
        'Causa provavel: `files` nao inclui `dist`, ou o build nao rodou. ' +
          'O `dist` NAO esta no git (ver .gitignore), entao um tarball sem `dist` ' +
          'e o modo classico de publicar pacote vazio.',
      );
      continue;
    }
    const vazados = arquivos.filter((f) => /\.(spec|test)\.(ts|tsx)$|__tests__\/|__bench__\//.test(f));
    if (vazados.length > 0) {
      falha(
        `${p.nome}: ${vazados.length} arquivo(s) de teste vazaram para o tarball`,
        `Ex.: ${vazados.slice(0, 3).join(', ')}\n` +
          'Teste importa vitest/fast-check, que nao sao dependencia do pacote — ' +
          'vazar isso quebra o consumidor no import.',
      );
      continue;
    }
    const temFonte = arquivos.some((f) => f.startsWith('src/'));
    if (!temFonte) {
      falha(
        `${p.nome}: tarball sem \`src\``,
        'A decisao do projeto foi PUBLICAR o fonte junto para os source maps ' +
          'resolverem (ver README, "Source maps"). Sem `src`, todo `.map` do ' +
          '`dist` aponta para arquivo inexistente.',
      );
      continue;
    }
    ok(`${p.nome} — ${arquivos.length} arquivos, com dist e src, sem teste`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// (2) Projeto consumidor FORA do workspace
// ═════════════════════════════════════════════════════════════════════════════

/**
 * O conjunto instalado no smoke.
 *
 * ⚠️ `charts-react` fica FORA de proposito: ele tem `react` como peerDependency,
 * e o npm 10 instala peer automaticamente — o que exigiria REDE e faria este
 * teste depender de registry, justamente o que ele existe para nao precisar.
 * O tarball do react e conferido na etapa (1), que e onde os defeitos de
 * empacotamento dele apareceriam.
 */
const A_INSTALAR = [
  '@robustus/charts-indicators',
  '@robustus/charts-alerts',
  '@robustus/charts-engine',
];

function montarConsumidor(tmp, tarballs) {
  const proj = join(tmp, 'consumidor');
  mkdirSync(proj, { recursive: true });

  const deps = {};
  for (const nome of A_INSTALAR) deps[nome] = `file:${tarballs.get(nome).caminho}`;

  // ⚠️ `overrides` com TODOS os pacotes, nao so os diretos. As deps internas
  // estao em `^0.1.0` (de proposito — ver README) e nao ha registry onde
  // `@robustus/*` resolva. Sem override, o npm iria a rede buscar
  // `@robustus/chart-core@^0.1.0` e daria E404 — que e exatamente o bloqueio que
  // este trabalho existe para tratar. O override amarra cada nome ao tarball
  // local, e a instalacao fica 100% offline.
  const overrides = {};
  for (const [nome, t] of tarballs) overrides[nome] = `file:${t.caminho}`;

  writeFileSync(
    join(proj, 'package.json'),
    JSON.stringify(
      {
        name: 'consumidor-smoke',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: deps,
        overrides,
      },
      null,
      2,
    ) + '\n',
  );

  // `.npmrc` local: nada de rede. Se algum resolvedor tentar sair, falha aqui
  // com mensagem clara em vez de pendurar.
  writeFileSync(join(proj, '.npmrc'), 'audit=false\nfund=false\npackage-lock=true\n');

  sh('npm', ['install', '--offline', '--no-audit', '--no-fund'], proj);
  return proj;
}

// ═════════════════════════════════════════════════════════════════════════════
// (3) Os dois imports
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Caso ROBO: Node ESM puro, sem DOM, sem canvas, sem bundler.
 *
 * Calcula um indicador incremental e usa o valor dele como fonte de um alerta.
 * ⚠️ O alerta recebe `value`, nao "o RSI" — o pacote de alerta nao conhece
 * indicador nenhum, e e essa fronteira que permite alertar sobre qualquer numero.
 */
const ROBO = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const require_ = createRequire(import.meta.url);

// (a) Ambiente: se houver DOM aqui, o teste nao prova nada.
assert.equal(typeof document, 'undefined', 'ambiente com DOM: o caso do robo nao foi exercitado');
assert.equal(typeof window, 'undefined', 'ambiente com window: o caso do robo nao foi exercitado');

// (b) Indicadores — pacote SEM DOM.
const { registry, createIndicator } = await import('@robustus/charts-indicators');
assert.ok(registry.size >= 29, 'registry com ' + registry.size + ' indicadores; esperado >= 29');

const rsi = createIndicator('rsi', { period: 14 });
assert.ok(rsi, 'createIndicator("rsi") devolveu undefined');

// Serie sintetica DETERMINISTICA em duas pernas: cai 20 barras, sobe 30.
// ⚠️ A perna de QUEDA nao e enfeite. CROSS_ABOVE exige TRANSICAO: precisa de uma
// amostra anterior abaixo do nivel. Uma serie so de alta faz o RSI ja nascer em
// 100, e o alerta corretamente NAO dispara — nao houve cruzamento, o preco ja
// estava do outro lado. Esse detalhe e a diferenca entre "alerta quebrado" e
// "alerta certo": foi o que este smoke pegou na primeira execucao.
const barras = [];
for (let i = 0; i < 20; i += 1) {
  const c = 120 - i;
  barras.push({ time: 1700000000 + i * 60, open: c + 0.5, high: c + 1, low: c - 0.5, close: c, volume: 10 });
}
for (let i = 0; i < 30; i += 1) {
  const c = 100 + i * 1.5;
  barras.push({ time: 1700000000 + (20 + i) * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 10 });
}
const serie = rsi.warmup(barras);
assert.equal(serie.length, barras.length, 'warmup devolveu ' + serie.length + ' pontos para ' + barras.length + ' barras');

// A chave do valor vem do METADADO, nao de um palpite: o RSI publica em
// 'value', o MACD em 'macd'/'signal'/'histogram'. Ler meta.outputs e o que
// permite consumir um indicador sem decorar a chave dele.
const chave = rsi.meta.outputs[0].key;

const naoNulos = serie.map((p) => p.values[chave]).filter((v) => v !== null);

// ⚠️ meta.warmup e "quantas BARRAS ate o primeiro valor", contando a barra que
// produz o valor. Logo os nulos sao warmup - 1, nao warmup. A confusao vale um
// comentario porque errar isso faz a interface avisar "aguardando" uma barra
// depois de o valor ja existir. Conferido aqui: RSI(14) declara 15 e emite o
// primeiro valor na 15a barra, com 14 nulos antes.
assert.equal(
  serie.length - naoNulos.length,
  rsi.meta.warmup(rsi.params) - 1,
  'quantidade de nulos nao casa com o aquecimento declarado no metadado',
);
const primeiro = naoNulos[0];
const ultimo = naoNulos[naoNulos.length - 1];
assert.ok(primeiro < 30, 'apos 20 barras de queda o RSI deveria estar sobrevendido, veio ' + primeiro);
assert.ok(ultimo > 70, 'apos 30 barras de alta o RSI deveria estar sobrecomprado, veio ' + ultimo);

// (c) Alertas — pacote SEM DOM, e sem saber o que e um RSI.
const { createAlert, feed } = await import('@robustus/charts-alerts');
const alerta = createAlert({ kind: 'CROSS_ABOVE', level: 70 }, { id: 'rsi-sobrecomprado' });

let disparos = 0;
for (const ponto of serie) {
  const v = ponto.values[chave];
  // null e "ainda nao ha valor" (aquecimento), nunca zero. Alimentar o alerta
  // com null fabricaria um cruzamento que nao houve.
  if (v === null) continue;
  const r = feed(alerta, { time: ponto.time, value: v });
  if (r.fired) disparos += 1;
}
assert.equal(disparos, 1, 'alerta em modo once disparou ' + disparos + ' vezes; repique e o bug classico');
assert.equal(alerta.state, 'TRIGGERED');

// (d) exports "./package.json" — o que evita ERR_PACKAGE_PATH_NOT_EXPORTED.
for (const nome of ['@robustus/charts-indicators', '@robustus/charts-alerts']) {
  const p = require_.resolve(nome + '/package.json');
  assert.ok(existsSync(p), nome + '/package.json resolveu para caminho inexistente');
}

// (e) Source map resolvivel: o .ts apontado pelo .map existe dentro do pacote.
for (const nome of ['@robustus/charts-indicators', '@robustus/charts-alerts']) {
  const entrada = require_.resolve(nome);
  const mapa = entrada + '.map';
  assert.ok(existsSync(mapa), nome + ': dist/index.js.map ausente do pacote instalado');
  const { sources } = JSON.parse(readFileSync(mapa, 'utf8'));
  for (const s of sources) {
    const alvo = join(dirname(entrada), s);
    assert.ok(existsSync(alvo), nome + ': o map aponta para ' + s + ', que nao veio no pacote');
  }
}

console.log('robo-sem-dom: indicador + alerta OK (RSI final ' + ultimo.toFixed(2) + ', 1 disparo)');
`;

/**
 * Caso MOTOR: o modulo tem de CARREGAR em Node sem tela.
 *
 * ⚠️ Nao chama `ChartEngine.create` — isso precisa de canvas de verdade. O que se
 * prova aqui e que nada e tocado no topo do modulo: e exatamente o que quebra o
 * SSR do Next, que importa o modulo no servidor antes de existir `document`.
 */
const MOTOR = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require_ = createRequire(import.meta.url);

assert.equal(typeof document, 'undefined', 'ambiente com DOM: o caso SSR nao foi exercitado');

const mod = await import('@robustus/charts-engine');
assert.equal(typeof mod.ChartEngine, 'function', 'ChartEngine ausente do indice do pacote');
assert.equal(typeof mod.ChartEngine.create, 'function', 'ChartEngine.create ausente');
assert.equal(typeof mod.serializeChartState, 'function', 'serializeChartState ausente');

// As dependencias internas resolveram? Se o range ^0.1.0 nao casasse com o
// tarball, o import acima teria estourado ERR_MODULE_NOT_FOUND antes desta linha.
assert.ok(existsSync(require_.resolve('@robustus/chart-core/package.json')), 'chart-core nao resolveu');
assert.ok(existsSync(require_.resolve('@robustus/charts-core/package.json')), 'charts-core nao resolveu');
assert.ok(existsSync(require_.resolve('@robustus/charts-primitives/package.json')), 'charts-primitives nao resolveu');

console.log('motor-em-node: import de charts-engine + deps internas OK');
`;

function rodarImports(proj) {
  titulo('(2) Imports em Node ESM puro, fora do workspace');
  for (const [nome, fonte] of [
    ['robo-sem-dom.mjs', ROBO],
    ['motor-em-node.mjs', MOTOR],
  ]) {
    writeFileSync(join(proj, nome), fonte);
    try {
      const saida = sh('node', [nome], proj);
      ok(saida.trim().split('\n').join('\n       '));
    } catch (e) {
      falha(
        `${nome} falhou`,
        (e.stderr || e.stdout || e.message) +
          '\nLeitura: erro de resolucao aqui quase sempre e `exports`, `files` ou ' +
          'import relativo sem extensao `.js` (ver scripts/add-esm-extensions.mjs).',
      );
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Execucao
// ═════════════════════════════════════════════════════════════════════════════

const pacotes = pacotesPublicaveis();
console.log(
  `\u001b[1msmoke-consumo\u001b[0m — ${pacotes.length} pacotes publicaveis ` +
    `(devtools fica fora por \`private: true\`)`,
);

if (!SEM_BUILD) {
  titulo('(0) Build');
  try {
    sh('npm', ['run', 'build'], RAIZ);
    ok('dist compilado');
  } catch (e) {
    falha('build falhou — sem dist nao ha o que empacotar', e.stdout || e.stderr);
    process.exit(1);
  }
}

if (SO_EMPACOTAR) {
  const destino = resolve(RAIZ, valorDe('--out') ?? 'tarballs');
  const tarballs = empacotar(pacotes, destino);
  conferirConteudo(pacotes, tarballs);
  console.log(`\n${tarballs.size} tarballs em ${destino}`);
  console.log('Consumo direto, sem registry:');
  for (const [nome, t] of tarballs) console.log(`  npm i ${nome}@file:${t.caminho}`);
  process.exit(falhas > 0 ? 1 : 0);
}

// ⚠️ O temporario vive no tmpdir do SO, FORA do monorepo. Dentro dele, o npm
// enxergaria o `workspaces` da raiz e resolveria `@robustus/*` por symlink — o
// teste passaria sem provar nada sobre o tarball.
const tmp = mkdtempSync(join(tmpdir(), 'robustus-smoke-'));
let proj;
try {
  const tarballs = empacotar(pacotes, join(tmp, 'tarballs'));
  conferirConteudo(pacotes, tarballs);
  try {
    proj = montarConsumidor(tmp, tarballs);
    ok(`instalado fora do workspace em ${proj}`);
  } catch (e) {
    falha(
      'npm install do consumidor falhou',
      (e.stderr || e.stdout || e.message) +
        '\nSe a mensagem citar E404 de `@robustus/*`, o `overrides` deste script ' +
        'nao cobriu algum pacote — e o mesmo E404 que o consumidor real leva ' +
        'quando nao ha registry configurado.',
    );
  }
  if (proj) rodarImports(proj);
} finally {
  if (MANTER) console.log(`\n(--keep) diretorio preservado: ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

titulo(falhas === 0 ? '\u001b[32mSMOKE OK\u001b[0m' : `\u001b[31m${falhas} FALHA(S)\u001b[0m`);
process.exit(falhas > 0 ? 1 : 0);
