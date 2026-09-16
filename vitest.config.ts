import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Configuracao unica de teste do workspace.
 *
 * Por que uma so, e nao uma por pacote: a suite copiada da origem depende de
 * `jsdom` + `fast-check` + `@testing-library/react` de forma homogenea, e os
 * testes de propriedade cruzam pacotes (uma property do core e verificada
 * atraves da primitive). Uma configuracao no raiz mantem o mesmo ambiente para
 * todos e evita divergencia silenciosa de `environment` entre pacotes.
 *
 * ⚠️ `environment: 'jsdom'` e obrigatorio e NAO e cosmetico: o jsdom NAO
 * implementa contexto 2D (`getContext('2d')` devolve `null`), e a suite depende
 * disso — os dubles de canvas existem exatamente porque o ambiente nao tem
 * rasterizacao. Trocar para `node` quebraria os testes de ciclo de vida da
 * primitive; trocar para um ambiente COM canvas real invalidaria as bancadas,
 * que declaram medir tudo menos a rasterizacao.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    // As bancadas nao sao teste de regressao: elas medem. Rodam por comando
    // proprio para nao somar tempo (nem variancia de maquina) ao `npm test`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/__bench__/**'],
  },
  resolve: {
    // Aponta para o FONTE dos pacotes irmaos, nao para `dist/`. Assim o teste
    // roda sem precisar de build previo e o stack trace cai no arquivo real.
    alias: {
      '@robustus/charts-core': path.resolve(__dirname, 'packages/core/src'),
      '@robustus/charts-primitives': path.resolve(__dirname, 'packages/primitives/src'),
      '@robustus/charts-datafeed': path.resolve(__dirname, 'packages/datafeed/src'),
      '@robustus/charts-engine': path.resolve(__dirname, 'packages/engine/src'),
      '@robustus/charts-react': path.resolve(__dirname, 'packages/react/src'),
      '@robustus/charts-devtools': path.resolve(__dirname, 'packages/devtools/src'),
    },
  },
});
