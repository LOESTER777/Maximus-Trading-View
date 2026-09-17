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
      '@robustus/charts-alerts': path.join(raizPacotes, 'alerts/src/index.ts'),
      '@robustus/charts-replay': path.join(raizPacotes, 'replay/src/index.ts'),
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
    // ⭐ PROXY PARA A API DE BARRAS DA MESA — o caminho do dado REAL.
    //
    // O serviço de barras roda na máquina B e chega aqui pelo túnel local
    // `robustus-bars-tunnel.service` (A:18899 -> B:8899). Medido em 17/09/2026: WIN com
    // 6.376 barras diárias desde 2005-02-18, com volume por agressor.
    //
    // ⚠️ O proxy existe por causa de CORS, e a alternativa era pior. O serviço é um
    // `ThreadingHTTPServer` de biblioteca padrão e **não emite
    // `Access-Control-Allow-Origin`** — o navegador bloquearia a resposta a partir de
    // `127.0.0.1:5173`. As saídas seriam: (a) mexer no serviço da mesa para emitir CORS,
    // que é código de produção que o robô usa para operar e não se toca por causa de um
    // playground; (b) desligar a segurança do navegador, que é inaceitável; (c) proxy no
    // servidor de desenvolvimento, que é o mecanismo que o Vite tem exatamente para
    // isto. É a (c).
    //
    // ⚠️ Isto é conveniência de DESENVOLVIMENTO e não vaza para a biblioteca: o
    // adaptador (`criarFonteDeBarrasDaMesa`) recebe `baseUrl` injetado e não sabe que
    // existe proxy. Um consumidor de verdade aponta para o endereço que ele tiver.
    proxy: {
      '/mesa': {
        target: 'http://127.0.0.1:18899',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/mesa/, ''),
      },
    },
  },
});
