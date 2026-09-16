/**
 * copiar-suite-da-origem — traz a suite de testes da origem para os pacotes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE UM SCRIPT, E NAO `cp` NA MAO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Esta suite e a RAZAO pela qual a extracao e verificavel. Sao 30 arquivos, 12
 * deles property tests, escritos contra os mesmos nucleos que foram copiados. Se
 * eles passarem aqui sem alteracao de conteudo — so com o especificador de import
 * reescrito — entao o comportamento nao mudou na copia. Isso e uma afirmacao
 * forte, e ela so vale se a reescrita for AUDITAVEL. Um `cp` seguido de `sed`
 * interativo nao deixa registro de o que foi trocado.
 *
 * ⚠️ A ORIGEM E SOMENTE LEITURA. Este script nunca escreve em
 * `/media/rust/UTIL/Projetos/Trading`. Ele le e copia para fora.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE E REESCRITO, E O QUE NAO E
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REESCRITO: apenas o especificador de modulo. `'../bookmap-render.core'` virou
 * `'@robustus/charts-core'` porque o arquivo mudou de pacote. Nada mais.
 *
 * NAO REESCRITO: nenhuma assercao, nenhum valor esperado, nenhum `describe`. Se
 * um teste falhar, a falha e informacao real sobre a copia — nao artefato de
 * ajuste. Por isso o script conta e imprime as substituicoes: se aparecer numero
 * diferente do esperado, a reescrita pegou algo que nao devia.
 *
 * NAO ACRESCENTA EXTENSAO: arquivos de teste sao excluidos do build do
 * TypeScript (`exclude` no tsconfig de cada pacote), entao nao viram ESM emitido
 * e nao precisam de `.js` no especificador relativo. Vitest resolve
 * extensionless. Acrescentar seria ruido.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUATRO TESTES FICAM DE FORA, DE PROPOSITO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - `useBookmapCoverage.spec.ts` e `useBookmapDepth.spec.ts` — provam hooks
 *    React acoplados ao endpoint do backend de origem. Viram teste do `datafeed`.
 *  - `p10-flag-off-byte-identico` — depende de `useBookmapDepth`.
 *  - `p11-ciclo-de-vida-primitive` — depende de `TradingChart`, que vira `engine`.
 *
 * Nao foram esquecidos e nao foram descartados: estao listados em PENDENTES
 * abaixo, e o script IMPRIME a lista ao final para que a divida fique visivel em
 * vez de virar teste que ninguem lembra que existia.
 *
 * Uso: node scripts/copiar-suite-da-origem.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ORIGEM = resolve(
  '/media/rust/UTIL/Projetos/Trading/frontend/src/components/decision/bookmap/__tests__',
);
const RAIZ = resolve(dirname(new URL(import.meta.url).pathname), '..');

/** Especificador da origem -> especificador aqui. Ordem importa: mais longo primeiro. */
const REESCRITAS = [
  // Nucleos que migraram para o pacote core. Cobre `../x` e `../../x`.
  [/'(\.\.\/)+bookmap-render\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-types'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-coverage\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-color\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-aggregate\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-pixels\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-decode\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+bookmap-walls\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+footprint-aggregate\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+footprint-render\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+perfil-de-volume\.core'/g, "'@robustus/charts-core'"],
  [/'(\.\.\/)+rampa-termica\.core'/g, "'@robustus/charts-core'"],
  // Camadas que migraram para o pacote primitives.
  [/'(\.\.\/)+BookmapPrimitive'/g, "'@robustus/charts-primitives'"],
  [/'(\.\.\/)+FootprintPrimitive'/g, "'@robustus/charts-primitives'"],
  // Alias `@/` do app de origem (usado por p11 e por um spec de legenda).
  [/'@\/components\/decision\/bookmap\/BookmapPrimitive'/g, "'@robustus/charts-primitives'"],
  [/'@\/components\/decision\/bookmap\/FootprintPrimitive'/g, "'@robustus/charts-primitives'"],
];

/** destino relativo a `packages/` -> lista de arquivos da origem. */
const PLANO = {
  'core/src/__tests__': [
    'bookmap-aggregate.core.spec.ts',
    'bookmap-color.core.spec.ts',
    'bookmap-decode-contrato-backend.spec.ts',
    'bookmap-walls.core.spec.ts',
    'footprint-aggregate.core.spec.ts',
    'footprint-render.core.spec.ts',
    'perfil-de-volume.core.spec.ts',
    'rampa-termica.core.spec.ts',
  ],
  'core/src/__tests__/properties': [
    'properties/p01-determinismo-celula-pixel.property.spec.ts',
    'properties/p02-monotonicidade-escala.property.spec.ts',
    'properties/p04-pico-da-fila-preservado.property.spec.ts',
    'properties/p05-execucao-conservada.property.spec.ts',
    'properties/p06-idempotencia-fator-unitario.property.spec.ts',
    'properties/p07-teto-orcamento-sem-nan.property.spec.ts',
    'properties/p08-outlier-fora-da-janela.property.spec.ts',
    'properties/p09-round-trip-colunar.property.spec.ts',
    'properties/p12-cobertura-reflete-o-dado.property.spec.ts',
  ],
  'core/src/__tests__/fixtures': ['fixtures/colunar-backend.json', 'fixtures/README.md'],
  'primitives/src/__tests__': [
    'BookmapPrimitive.spec.ts',
    'suavizacao-termica.spec.ts',
    'legenda-fora-do-canvas.spec.ts',
  ],
  'primitives/src/__tests__/properties': ['properties/p03-sem-hit-test.property.spec.ts'],
  'devtools/src/__tests__': ['independence-check.spec.ts', 'bookmap-bench-arnes.spec.ts'],
};

/** Nao copiados agora, com o motivo e o destino futuro. */
const PENDENTES = [
  ['useBookmapCoverage.spec.ts', 'prova hook React acoplado ao backend', 'datafeed'],
  ['useBookmapDepth.spec.ts', 'prova hook React acoplado ao backend', 'datafeed'],
  ['properties/p10-flag-off-byte-identico', 'depende de useBookmapDepth', 'datafeed'],
  ['properties/p11-ciclo-de-vida-primitive', 'depende de TradingChart', 'engine'],
];

// ── Execucao ────────────────────────────────────────────────────────────────

if (!existsSync(ORIGEM)) {
  console.error(`✗ origem nao encontrada: ${ORIGEM}`);
  process.exit(1);
}

let arquivos = 0;
let substituicoes = 0;
const porRegra = new Map();

for (const [destRel, lista] of Object.entries(PLANO)) {
  const destDir = join(RAIZ, 'packages', destRel);
  mkdirSync(destDir, { recursive: true });

  for (const nomeOrigem of lista) {
    const de = join(ORIGEM, nomeOrigem);
    const nomeSimples = nomeOrigem.split('/').pop();
    const para = join(destDir, nomeSimples);

    if (!existsSync(de)) {
      console.error(`  ✗ FALTA na origem: ${nomeOrigem}`);
      process.exitCode = 1;
      continue;
    }

    // Binario/fixture: copia crua, sem tocar em byte. O spec de contrato
    // verifica o sha256 da fixture, entao alterar 1 byte reprovaria o teste —
    // que e exatamente o comportamento desejado.
    if (!nomeSimples.endsWith('.ts')) {
      copyFileSync(de, para);
      arquivos++;
      console.log(`  ok  ${destRel}/${nomeSimples}  (copia crua)`);
      continue;
    }

    let texto = readFileSync(de, 'utf8');
    let nesteArquivo = 0;
    for (const [padrao, troca] of REESCRITAS) {
      const antes = texto;
      texto = texto.replace(padrao, troca);
      if (texto !== antes) {
        const n = (antes.match(padrao) || []).length;
        nesteArquivo += n;
        porRegra.set(String(padrao), (porRegra.get(String(padrao)) ?? 0) + n);
      }
    }
    writeFileSync(para, texto, 'utf8');
    arquivos++;
    substituicoes += nesteArquivo;
    console.log(`  ok  ${destRel}/${nomeSimples}  (${nesteArquivo} especificador(es))`);
  }
}

console.log(`\n✓ ${arquivos} arquivo(s), ${substituicoes} especificador(es) reescrito(s).`);

console.log('\nSubstituicoes por regra:');
for (const [regra, n] of [...porRegra.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${regra}`);
}

console.log('\n⚠️ PENDENTES (nao copiados — divida registrada, nao esquecida):');
for (const [arquivo, motivo, destino] of PENDENTES) {
  console.log(`  · ${arquivo}\n      motivo: ${motivo}\n      destino: pacote ${destino}`);
}
