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
    // Preenche `matchMedia` e `ResizeObserver`, que o jsdom nao tem e o substrato
    // de grafico usa. Sem isto, uma execucao de 18 testes produzia 63 rejeicoes
    // nao tratadas — ruido que afoga erro de verdade. Ver `vitest.setup.ts`.
    setupFiles: ['./vitest.setup.ts'],
    // ⭐ `apps/*` entra junto, e não é generosidade: o playground é a montagem de REFERÊNCIA da
    // biblioteca, e existe uma família de defeito que só a execução pega — ordem de declaração
    // de hook, ciclo entre hooks, `const` lido antes da inicialização. Todos derrubam a página
    // com a tela BRANCA, que é o modo mais caro de descobrir. Ver `apps/playground/src/__tests__`.
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}', 'apps/*/src/**/*.{test,spec}.{ts,tsx}'],
    // As bancadas nao sao teste de regressao: elas medem. Rodam por comando
    // proprio para nao somar tempo (nem variancia de maquina) ao `npm test`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/__bench__/**'],
  },
  resolve: {
    // Aponta para o FONTE dos pacotes irmaos, nao para `dist/`. Assim o teste
    // roda sem precisar de build previo e o stack trace cai no arquivo real.
    alias: {
      '@robustus/charts-core': path.resolve(__dirname, 'packages/core/src'),
      '@robustus/chart-core': path.resolve(__dirname, 'packages/chart-core/src'),
      '@robustus/charts-primitives': path.resolve(__dirname, 'packages/primitives/src'),
      '@robustus/charts-datafeed': path.resolve(__dirname, 'packages/datafeed/src'),
      '@robustus/charts-drawings': path.resolve(__dirname, 'packages/drawings/src'),
      '@robustus/charts-engine': path.resolve(__dirname, 'packages/engine/src'),
      '@robustus/charts-indicators': path.resolve(__dirname, 'packages/indicators/src'),
      '@robustus/charts-react': path.resolve(__dirname, 'packages/react/src'),
      '@robustus/charts-devtools': path.resolve(__dirname, 'packages/devtools/src'),
      '@robustus/charts-alerts': path.resolve(__dirname, 'packages/alerts/src'),
      '@robustus/charts-replay': path.resolve(__dirname, 'packages/replay/src'),
    },
  },
});
