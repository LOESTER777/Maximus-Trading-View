import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Playground: superficie de desenvolvimento LOCAL.
//
// Os alias apontam para o FONTE dos pacotes (packages/x/src), nao para dist:
// assim editar um pacote e ver o resultado no navegador nao exige rodar o build
// antes. Vite e o playground compartilham o mesmo fonte em tempo real.
//
// ATENCAO: isto e conveniencia de desenvolvimento. A pasta dist continua sendo o
// que um consumidor de verdade importa, e o build dos pacotes tem de continuar
// passando por conta propria (npm run build na raiz). O alias aqui nao substitui
// essa verificacao; ele so encurta o laco de edicao.
const raizPacotes = path.resolve(__dirname, '..', '..', 'packages');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@robustus/charts-core': path.join(raizPacotes, 'core/src/index.ts'),
      '@robustus/charts-indicators': path.join(raizPacotes, 'indicators/src/index.ts'),
      '@robustus/chart-core': path.join(raizPacotes, 'chart-core/src/index.ts'),
      '@robustus/charts-primitives': path.join(raizPacotes, 'primitives/src/index.ts'),
      '@robustus/charts-datafeed': path.join(raizPacotes, 'datafeed/src/index.ts'),
      '@robustus/charts-drawings': path.join(raizPacotes, 'drawings/src/index.ts'),
      '@robustus/charts-engine': path.join(raizPacotes, 'engine/src/index.ts'),
      '@robustus/charts-react': path.join(raizPacotes, 'react/src/index.ts'),
    },
  },
  server: {
    // 5173 e o padrao do Vite; verificada livre nesta maquina, longe das portas
    // dos outros projetos (Trading 41000 e 41100, Postgres 543x). strictPort FALHA
    // em vez de pular para outra porta em silencio, entao voce sempre sabe onde o
    // playground esta.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
