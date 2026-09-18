import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
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
const raizRepo = path.resolve(__dirname, '..', '..');

/**
 * ⭐⭐ Lê `.env.local` da RAIZ do repositório. O segredo NÃO passa por `define`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO CORRIGE — E ELE ERA UMA MENTIRA NA PRÓPRIA DOCUMENTAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ O comentário do proxy dizia *"para ligar: `echo 'MT5_BRIDGE_AUTH_TOKEN=...' >> .env.local`
 * (na raiz do repo)"*, e o proxy lia `process.env` — que **nunca** recebe esse arquivo. Seguir a
 * instrução documentada dava **401 em toda rota autenticada da bridge**.
 *
 * ⛔ E a falha era do pior tipo: **silenciosa e plausível**. O `/health` é rota aberta e
 * respondia, então a bridge parecia no ar; o adaptador traduzia o 401 para `NEGADA` e degradava
 * para o arquivo, dizendo apenas "ao vivo não autorizado". O gráfico continuava desenhando — com
 * o arquivo, que desde jun/2026 é justamente a série INCOMPLETA. Ou seja: o defeito de
 * configuração levava exatamente ao dado errado que esta rodada existiu para corrigir.
 *
 * ⚠️ Só funcionava para quem exportasse a variável no shell antes do `npm run dev`. O servidor
 * que estava no ar aqui tinha sido levantado assim, o que mascarou o problema por horas.
 *
 * ⭐ Por que ler o arquivo à mão em vez de `loadEnv` do Vite: `loadEnv` resolve o diretório de
 * env a partir do `root` do projeto (`apps/playground`), e o arquivo vive na RAIZ do repositório —
 * onde o `.gitignore` já o cobre e onde o operador espera pôr segredo de máquina. Apontar
 * `envDir` para a raiz faria o Vite carregar TODO `.env*` de lá, inclusive `VITE_*` de outra
 * ferramenta, que iria para o bundle. Ler uma chave, num lugar só, é menos superfície.
 *
 * ⚠️ O valor fica no processo do Vite e é usado apenas no `proxyReq`. Nada de `define`, nada de
 * prefixo `VITE_` — o navegador nunca vê o token. Ver a nota longa no proxy `/mt5`.
 */
function segredoDoAmbiente(chave: string): string | undefined {
  const doShell = process.env[chave];
  // ⭐ O shell VENCE o arquivo: é o que permite trocar o token numa execução pontual sem editar
  // arquivo, e é a precedência que todo carregador de env usa.
  if (doShell !== undefined && doShell !== '') return doShell;
  try {
    const bruto = fs.readFileSync(path.join(raizRepo, '.env.local'), 'utf8');
    for (const linha of bruto.split(/\r?\n/)) {
      const corte = linha.indexOf('=');
      if (corte <= 0 || linha.trimStart().startsWith('#')) continue;
      if (linha.slice(0, corte).trim() !== chave) continue;
      // ⚠️ Remove aspas envolventes: `CHAVE="valor"` é escrita comum e o valor com aspas
      // produziria um `Bearer "token"` que a bridge recusa — 401 outra vez, e igualmente mudo.
      const valor = linha
        .slice(corte + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      return valor === '' ? undefined : valor;
    }
  } catch {
    // Arquivo ausente é o caso NORMAL (quem não usa a bridge não precisa dele). Sem token, o
    // proxy simplesmente não injeta cabeçalho e a degradação segue sendo declarada na trilha.
  }
  return undefined;
}

const TOKEN_MT5 = segredoDoAmbiente('MT5_BRIDGE_AUTH_TOKEN');

// ⭐⭐ A ausência é DITA no terminal, e é barreira contra a repetição do defeito.
//
// ⚠️ Sem esta linha o sintoma é 401 no navegador, numa rota que o adaptador engole e traduz para
// "ao vivo não autorizado" — e o gráfico segue desenhando o arquivo, que desde jun/2026 é a série
// incompleta. Um aviso de duas linhas em quem levanta o servidor custa nada e mata a classe
// inteira de "parecia funcionando".
//
// ⚠️ **Só o comprimento**, nunca o valor: log de terminal vai para histórico, para captura de
// tela e para relatório de erro. O token já circulou em chat neste projeto e teve de ser revogado.
if (TOKEN_MT5 === undefined) {
  console.warn(
    '\x1b[33m⚠  MT5_BRIDGE_AUTH_TOKEN ausente:\x1b[0m a bridge vai recusar (401) e o gráfico cairá no\n' +
      '   arquivo — que desde jun/2026 tem ~20% dos negócios. Ponha a chave em .env.local na raiz.',
  );
} else {
  console.log(`\x1b[32m✓\x1b[0m token da bridge MT5 carregado (${TOKEN_MT5.length} caracteres)`);
}

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
      // ⭐⭐ PROXY PARA A BRIDGE MT5 — o DIA CORRENTE, que o arquivo não tem.
      //
      // ⚠️ Porta **8229**, e a escolha é crítica. Há quatro bridges MT5 no ar nesta
      // máquina, uma por terminal/conta: 8228 (Forex genérica, e que escuta em 0.0.0.0),
      // 8229 (**XP DEMO Pedro — a B3, onde o mini índice cota**), 8230 (XP REAL, somente
      // leitura) e 8233 (segunda demo). Apontar para a errada entregaria cotação de OUTRO
      // mercado, com preço plausível e nenhum erro — o mesmo tipo de defeito silencioso
      // que o offset de fuso produz.
      //
      // ⚠️ Medido em 17/09/2026: `GET /health` em 8229 devolve `{"connected":true}`,
      // conta 519324625, servidor `XPMT5-DEMO`, e `/candles/WINV26?timeframe=5m` traz as
      // 91 barras do dia (09:00 → 16:30 BRT).
      //
      // ⚠️ O proxy existe pelo mesmo motivo do `/mesa`: a bridge não emite CORS. E a
      // alternativa é ainda menos aceitável aqui — a bridge roda DENTRO do Wine, no mesmo
      // terminal que alimenta o robô que opera. Não se mexe nela por causa de um
      // playground.
      //
      // ⭐⭐ O TOKEN É INJETADO AQUI, NO SERVIDOR — e a decisão é de SEGURANÇA.
      //
      // ⚠️⚠️ A saída óbvia seria `import.meta.env.VITE_MT5_TOKEN` no adaptador. **Não
      // faça.** Tudo com o prefixo `VITE_` é EMBUTIDO NO BUNDLE que o navegador baixa: o
      // token apareceria em texto puro no JavaScript servido, visível em "ver código
      // fonte" e em qualquer cache. Um token de bridge que aceita ordem não pode viajar
      // para o cliente.
      //
      // Injetando no proxy, o segredo fica no processo do Vite (que roda na máquina do
      // desenvolvedor) e o navegador nunca o vê. O `.env` já é ignorado pelo git
      // (`.gitignore:16-17`).
      //
      // Para ligar:  echo 'MT5_BRIDGE_AUTH_TOKEN=...' >> .env.local   (na raiz do repo)
      //
      // ⭐ E agora essa instrução FUNCIONA: `segredoDoAmbiente` lê o arquivo. Antes o proxy só
      // olhava `process.env`, então seguir a instrução dava 401 em silêncio — ver a nota longa lá.
      //
      // ⚠️ Sem o token o `/health` continua respondendo (é rota aberta) e o resto devolve
      // 401 — que o adaptador traduz para `NEGADA`. A degradação é declarada na trilha, mas
      // ⛔ **desde jun/2026 ela leva ao dado ERRADO**: sem o terminal o gráfico cai no arquivo,
      // que é a série com ~20 % dos negócios. Por isso o 401 silencioso era grave.
      '/mt5': {
        target: 'http://127.0.0.1:8229',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/mt5/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (TOKEN_MT5 !== undefined) {
              proxyReq.setHeader('Authorization', `Bearer ${TOKEN_MT5}`);
            }
          });
        },
      },
    },
  },
});
