/**
 * add-esm-extensions — acrescenta `.js` em import/export relativo.
 *
 * POR QUE ISTO EXISTE
 * ───────────────────
 * O codigo foi copiado de um app Next.js, que compila com
 * `moduleResolution: "Bundler"` e portanto admite import relativo SEM extensao
 * (`from './bookmap-types'`). Isso funciona porque um bundler resolve o caminho.
 *
 * Uma biblioteca nao pode assumir bundler. O Node ESM exige o especificador
 * completo, e SSR do Next, teste em Node puro e qualquer ferramenta de linha de
 * comando passam pelo Node. Sem a extensao, `dist/` quebra com
 * `ERR_MODULE_NOT_FOUND` — foi exatamente o erro medido antes desta correcao.
 *
 * A transformacao acrescenta `.js` (NAO `.ts`): em ESM o especificador aponta
 * para o arquivo EMITIDO, e o TypeScript deliberadamente nao reescreve
 * especificadores. Vite e Vitest resolvem `./x.js` para `./x.ts` no fonte, entao
 * o mesmo texto serve para compilar, testar e publicar.
 *
 * ⚠️ `.core` NAO e extensao — e parte do nome (`bookmap-color.core.ts`). O
 * padrao precisa reconhecer apenas `.js`/`.json`/`.mjs`/`.cjs` como sufixo ja
 * presente, senao ele "conclui" que `./bookmap-color.core` ja tem extensao e
 * pula o arquivo. Este era o erro obvio a cometer aqui.
 *
 * Idempotente: rodar duas vezes nao gera `.js.js`.
 *
 * Uso: node scripts/add-esm-extensions.mjs <dir> [<dir>...]
 *      node scripts/add-esm-extensions.mjs --check <dir>   (nao escreve; sai 1 se faltar)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Sufixos que ja sao especificador completo para o Node. */
const EXTENSOES_FINAIS = /\.(js|mjs|cjs|json)$/;

/**
 * Captura `from './x'`, `from "../y"`, e tambem `import './z'` (side-effect).
 * Deliberadamente NAO toca em especificador nao-relativo: `lightweight-charts`
 * e `fancy-canvas` resolvem por `exports` do pacote e nao levam extensao.
 */
const PADRAO = /(\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]*?)\2/g;

function transformar(texto) {
  let alteracoes = 0;
  const saida = texto.replace(PADRAO, (inteiro, prefixo, quote, especificador) => {
    if (EXTENSOES_FINAIS.test(especificador)) return inteiro;
    alteracoes++;
    return `${prefixo}${quote}${especificador}.js${quote}`;
  });
  return { saida, alteracoes };
}

function* arquivosTs(dir) {
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      if (entrada === 'node_modules' || entrada === 'dist') continue;
      yield* arquivosTs(caminho);
      continue;
    }
    const ext = extname(entrada);
    if (ext === '.ts' || ext === '.tsx') yield caminho;
  }
}

const args = process.argv.slice(2);
const apenasChecar = args.includes('--check');
const dirs = args.filter((a) => a !== '--check');

if (dirs.length === 0) {
  console.error('uso: node scripts/add-esm-extensions.mjs [--check] <dir> [<dir>...]');
  process.exit(2);
}

let totalArquivos = 0;
let totalAlteracoes = 0;

for (const dir of dirs) {
  for (const caminho of arquivosTs(dir)) {
    const original = readFileSync(caminho, 'utf8');
    const { saida, alteracoes } = transformar(original);
    if (alteracoes === 0) continue;
    totalArquivos++;
    totalAlteracoes += alteracoes;
    if (!apenasChecar) writeFileSync(caminho, saida, 'utf8');
    console.log(`${apenasChecar ? 'FALTA' : 'ok'}  ${caminho}  (${alteracoes})`);
  }
}

if (apenasChecar) {
  if (totalAlteracoes > 0) {
    console.error(`\n✗ ${totalAlteracoes} especificador(es) sem extensao em ${totalArquivos} arquivo(s).`);
    process.exit(1);
  }
  console.log('✓ todos os especificadores relativos tem extensao.');
  process.exit(0);
}

console.log(`\n✓ ${totalAlteracoes} especificador(es) corrigido(s) em ${totalArquivos} arquivo(s).`);
