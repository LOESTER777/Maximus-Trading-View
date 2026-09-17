# Maximus Trading View

Biblioteca de charting de mercado **própria**, em canvas puro, **sem nenhum
terceiro** — nem `lightweight-charts`, nem `fancy-canvas`, nem widget da
TradingView. Motor de renderização, indicadores técnicos, ferramentas de desenho,
alertas de preço, replay de mercado e as camadas de fluxo de ordem (bookmap,
footprint, perfil de volume), todos construídos aqui.

Existe para que qualquer ferramenta desenhe mercado — velas, fluxo, indicadores,
anotações — sem depender de provedor de gráfico de terceiro.

```bash
npm install
npm test              # 1880 testes, 97 arquivos
npm run build         # compila todos os pacotes
npm run verify        # typecheck + typecheck do playground + extensão ESM + testes
npm run smoke:consumo # ⭐ prova que o pacote PUBLICADO instala e importa
npm run dev -w @robustus/charts-playground   # http://127.0.0.1:5173
```

`verify` valida o **fonte**; `smoke:consumo` valida o **artefato**. São coisas
diferentes e nenhuma cobre a outra — ver [Consumindo em outro
projeto](#consumindo-em-outro-projeto).

## Pacotes

| Pacote | O que é | DOM? |
|---|---|---|
| `@robustus/charts-core` | Núcleos puros: agregação por zoom, escala de cor por percentil, decodificação colunar, perfil de volume, footprint | **não** |
| `@robustus/charts-indicators` | 29 indicadores incrementais (`warmup`+`update`+`preview` O(1)) | **não** |
| `@robustus/charts-alerts` | Motor puro de alerta de preço, máquina ARMED→TRIGGERED sem repique | **não** |
| `@robustus/charts-replay` | Replay de mercado determinístico, relógio injetado, pausa no fim | **não** |
| `@robustus/charts-datafeed` | Contrato agnóstico de fonte de dados: dia de mercado, HTTP bars/depth, WS ao vivo com reconexão, agregador de timeframes | tipos¹ |
| `@robustus/chart-core` | **Motor de renderização próprio** em canvas: eixo de tempo com sessão irregular, autoescala por escala de preço, pan/zoom, pinça em touch, crosshair com rótulos, sub-painéis, marcadores com forma, banda, formatação de preço por tick, exportar imagem | sim |
| `@robustus/charts-primitives` | Camadas de canvas: `BookmapPrimitive`, `FootprintPrimitive`, `VolumeProfilePrimitive` | sim |
| `@robustus/charts-drawings` | 13 ferramentas de desenho, hit-test priorizado, ímã ao OHLC, desfazer/refazer, persistência versionada | sim |
| `@robustus/charts-engine` | Motor sem framework + persistência de layout (`serializeChartState`) + setups nomeados (`layout-templates.core`) + **abas por ativo** (`chart-workspace.core`) | sim |
| `@robustus/charts-react` | Hooks finos (`useChartEngine`, `useDrawings`, `useIndicators`, `useAlerts`, `useReplay`, `useCrosshair`, `useChartState`, `useHistoryBackfill`, `useChartSync`, `useVisibleTimeRange`, `useLayerLegends`, `useSymbolWorkspace`), UI própria (`ChartToolbar`, `DrawingToolbar`, `IndicatorToolbox`, `CommandPalette`, `ChartLegend`, `TimeframeSelector`, `SymbolTabs`, `ChartGrid`, `ObjectTree`, `AssetReadout`, `CorrelationInset`) e `<RobustusChart />` | sim |
| `@robustus/charts-devtools` | Bancada de desempenho com dublês de canvas — **não publicável** (`private: true`) | sim |

¹ `charts-datafeed` **roda** em Node (o `fetch` é injetado, o pacote não o
importa), mas seus tipos citam `Response`, `AbortSignal` e `WebSocket`. Em
projeto Node com `lib` sem `DOM` o *runtime* funciona e o *typecheck* reclama —
adicione `"DOM"` à `lib` do consumidor ou use um `@types/node` recente.

Os 29 indicadores: SMA, EMA, WMA, RMA, DEMA, TEMA, RSI, Stochastic, CCI,
Williams %R, ROC, Momentum, ATR, StdDev, Bollinger, Keltner, MACD, ADX, OBV,
VWAP, SuperTrend, Parabolic SAR, Ichimoku, Donchian, VWAP com bandas, MFI, CMF,
Awesome Oscillator e Pivot Points.

As 13 ferramentas de desenho: linha de tendência, raio, reta infinita, linha
horizontal, raio horizontal, linha vertical, retângulo, seta, régua, retração e
extensão de Fibonacci, e posição de compra/venda (entrada + stop, com o alvo
derivado do múltiplo de risco e as zonas pintadas na proporção).

## Consumindo em outro projeto

⚠️ **Leia a subseção do escopo antes de tentar publicar.** Há uma decisão de
conta pendente, e ela é o único passo que não está no código.

### Passo 0 — o escopo `@robustus` e a conta do GitHub

O GitHub Packages exige que o **escopo do pacote seja o nome da conta ou
organização dona** ([docs do
GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)).
O escopo aqui é `@robustus`; a conta é `LOESTER777`. Publicar
`@robustus/charts-core` em `npm.pkg.github.com` sob o usuário `LOESTER777`
devolve **403**. Escolha um caminho:

- **A (recomendado, zero mudança de código):** criar a organização gratuita
  `robustus` no GitHub e publicar sob ela. O escopo `@robustus` continua válido
  em todos os imports, o `publishConfig` já está pronto e nada no fonte muda.
- **B (imediato, sem registry):** consumir por **tarball local** — funciona
  hoje, sem conta, sem token, sem rede. Ver [Caminho B](#caminho-b--tarball-local-funciona-hoje).
- **C (evitar):** renomear o escopo para `@loester777`. Mexe em import de
  centenas de arquivos e nos 1880 testes, só para satisfazer uma regra de
  registry.

Escopo privado em `npmjs.org` é pago; o repositório já é privado em
`LOESTER777` e o GitHub Packages vem junto com ele. É por isso que o
`publishConfig` de cada pacote aponta para `npm.pkg.github.com` com
`access: "restricted"`.

### Caminho A — GitHub Packages

**No projeto consumidor**, um `.npmrc` ao lado do `package.json`:

```ini
# Só o escopo @robustus sai para o GitHub; todo o resto continua no npmjs.org.
@robustus:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

⚠️ **O token vem do ambiente, não do arquivo.** `${GITHUB_TOKEN}` é expandido
pelo npm na leitura do `.npmrc`, então o arquivo pode ser versionado sem
segredo dentro. O token precisa apenas do escopo `read:packages` para instalar
(`write:packages` só para publicar). Exportar antes de instalar:

```bash
export GITHUB_TOKEN=ghp_...      # nunca commitar, nunca colar em chat
npm install @robustus/charts-react @robustus/charts-indicators
```

### ⚠️ `charts-indicators` instala À PARTE — e isso é de propósito

`@robustus/charts-react` **não** depende de `@robustus/charts-indicators`.
Instalar só o react e chamar `useIndicators` falha na resolução do módulo.

Não é esquecimento: é a regra 4 do projeto — **recurso opcional não custa peso a
quem não o usa**. Um dashboard que só desenha velas não deve baixar 29
indicadores; um robô que só calcula RSI não deve baixar React nem canvas. O
mesmo vale para `charts-drawings`, `charts-alerts` e `charts-replay` quando
usados fora do react: cada um é uma ilha instalável sozinha.

```bash
# Gráfico React com indicadores: os dois, explicitamente.
npm install @robustus/charts-react @robustus/charts-indicators
```

O que cada frente precisa:

| Quero | Instalo |
|---|---|
| Gráfico em React | `charts-react` |
| Gráfico em React **com indicadores** | `charts-react` + `charts-indicators` |
| Gráfico sem framework | `charts-engine` |
| Bookmap/footprint sobre o motor | `charts-engine` + `charts-primitives` |
| Ligar um backend | `charts-datafeed` |
| **Robô Node, sem tela** | `charts-indicators` + `charts-alerts` |

### Robô em Node, sem DOM

Quatro pacotes compilam com `"lib": ["ES2020"]` — **sem DOM, por barreira de
compilação**, não por convenção: `charts-core`, `charts-indicators`,
`charts-alerts` e `charts-replay`. Um `document` ou `fetch` acidental dentro
deles é erro de compilação. É isso que habilita usá-los num robô, num cron ou
numa Lambda, sem canvas, sem jsdom, sem bundler.

```bash
mkdir robo && cd robo && npm init -y
npm pkg set type=module
npm install @robustus/charts-indicators @robustus/charts-alerts
```

```js
// robo.mjs — Node ESM puro. Nenhum DOM, nenhum canvas.
import { createIndicator } from '@robustus/charts-indicators';
import { createAlert, feed } from '@robustus/charts-alerts';

const rsi = createIndicator('rsi', { period: 14 });

// A chave do valor vem do METADADO, não de um palpite: o RSI publica em
// 'value', o MACD em 'macd'/'signal'/'histogram'.
const chave = rsi.meta.outputs[0].key;

// Alerta é sobre um NÚMERO, não sobre "o RSI": o pacote de alerta não conhece
// indicador nenhum. É essa fronteira que deixa alertar sobre qualquer série.
const alerta = createAlert({ kind: 'CROSS_ABOVE', level: 70 }, { id: 'rsi-sobrecomprado' });

// 1) Histórico de uma vez.
for (const ponto of rsi.warmup(await buscarHistorico())) {
  const v = ponto.values[chave];
  if (v === null) continue;         // null é "ainda aquecendo", nunca zero
  feed(alerta, { time: ponto.time, value: v });
}

// 2) Cada barra FECHADA nova, uma vez. O custo é O(1), não recálculo da série.
onBarraFechada((barra) => {
  const v = rsi.update(barra)[chave];
  if (v === null) return;
  const r = feed(alerta, { time: barra.time, value: v });
  if (r.fired) avisarOperador(`RSI cruzou 70: ${v.toFixed(2)}`);
});

// 3) Barra EM FORMAÇÃO, a cada tick: `preview` NÃO muta o estado.
//    ⚠️ `update` aqui registraria a mesma barra várias vezes e corromperia a
//    média rolante. Os dois não são intercambiáveis.
onTick((barraParcial) => mostrar(rsi.preview(barraParcial)[chave]));
```

⚠️ O alerta em modo `once` dispara **uma vez por armamento**. E `CROSS_ABOVE`
exige **transição**: se a primeira amostra já está acima do nível, não houve
cruzamento e nada dispara — comportamento correto, e a causa nº 1 de "meu alerta
não disparou".

### Caminho B — tarball local (funciona hoje)

Sem conta, sem token, sem rede:

```bash
# No monorepo: compila e empacota os 10 pacotes publicáveis em ./tarballs
npm run pack:tarballs

# No projeto consumidor
npm install /caminho/tarballs/robustus-charts-indicators-0.1.0.tgz \
            /caminho/tarballs/robustus-charts-alerts-0.1.0.tgz
```

⚠️ Instalando por tarball, as dependências **internas** (`charts-engine` →
`chart-core`, por exemplo) não têm registry onde resolver e o npm tenta a rede,
dando **E404**. A saída é `overrides` no `package.json` do consumidor, amarrando
cada nome ao arquivo local:

```json
{
  "overrides": {
    "@robustus/chart-core": "file:/caminho/tarballs/robustus-chart-core-0.1.0.tgz",
    "@robustus/charts-core": "file:/caminho/tarballs/robustus-charts-core-0.1.0.tgz",
    "@robustus/charts-primitives": "file:/caminho/tarballs/robustus-charts-primitives-0.1.0.tgz"
  }
}
```

`scripts/smoke-consumo.mjs` faz exatamente isso e prova que funciona offline.

### ⚠️ Dependência por git NÃO é suportada

`npm i github:LOESTER777/Maximus-Trading-View` instala um pacote **vazio**: o
`dist/` está no `.gitignore` (é artefato de build, não fonte) e não há nenhum
`prepare` que o reconstrua no consumidor — reconstruir exigiria o TypeScript e a
árvore inteira do monorepo do lado de quem instala. Use o caminho A ou o B.

## Publicando

```bash
npm run verify         # o fonte está são?
npm run smoke:consumo  # o artefato instala e importa?
npm publish -w @robustus/charts-core   # o prepublishOnly compila antes de subir
```

Decisões de empacotamento, e o motivo de cada uma:

- **`prepublishOnly: "npm run build"`, não `prepare`.** Como o `dist` não está no
  git, publicar sem compilar publica pacote vazio ou velho — e é silencioso.
  `prepublishOnly` roda só no `npm publish`, que é onde o risco existe. `prepare`
  rodaria a cada `npm install` do monorepo (11 `tsc --build` por instalação) e
  também no consumidor de dependência git, onde falharia por não haver
  TypeScript instalado: daria a falsa impressão de suportar dependência por git.
- **Deps internas em `^0.1.0`, não `0.1.0`.** Com versão exata, corrigir
  `charts-core` obriga a republicar os 5 pacotes que dependem dele só para mover
  o número. Com faixa, o consumidor pega a correção no próximo `npm install`.
  Dentro do monorepo nada muda: o npm resolve por symlink de workspace.
- **`exports` com `types`, `import` e `default`.** A entrada `default` existe
  porque sem ela `require.resolve('@robustus/charts-indicators')` estoura
  `ERR_PACKAGE_PATH_NOT_EXPORTED` — e o resolvedor CJS é usado por Jest e por
  vários plugins de bundler mesmo quando o consumo final é ESM. A entrada
  `"./package.json"` existe pelo mesmo motivo: Vite e outros a leem.
  ⚠️ Os pacotes são **ESM puro** (`"type": "module"`). Um `require()` de verdade
  falha com `ERR_REQUIRE_ESM`, que é a mensagem correta — bem melhor que
  "no exports main defined", que parece pacote quebrado.
- **`devtools` é `private: true`.** É bancada de medição, lê `os.cpus()` e existe
  para medir a biblioteca, não para entrar em aplicação. `private` faz o
  `npm publish` **recusar** — barreira mecânica, não convenção.

### Source maps: o fonte é publicado junto

`declarationMap` e `sourceMap` estão ligados, e o `files` de cada pacote inclui
`src` (menos testes e bancadas). O tarball fica maior — `charts-core` vai de
~90 kB para 180 kB — e a troca é deliberada:

quem consome esta biblioteca é o mesmo que a escreve. Depurando um projeto que a
usa, o passo natural é entrar no código dela: com `src` publicado, o breakpoint
cai no `.ts` real e "ir para definição" abre o arquivo com os comentários que
explicam **o porquê** de cada decisão — que é metade do valor deste repositório.
Sem `src`, todo `.map` do `dist` aponta para arquivo inexistente, e mapa que
aponta para o vazio é pior que mapa nenhum: o depurador abre em branco e você
perde tempo achando que o mapa está certo. A alternativa — desligar os mapas —
economizaria 90 kB de um pacote privado que nunca vai para CDN.

Os testes não vão no tarball (`!src/**/__tests__/**`, `!src/**/*.spec.ts`): eles
importam `vitest` e `fast-check`, que não são dependência dos pacotes. O
`smoke-consumo` verifica os dois lados — que `src` está presente e que nenhum
`.spec` vazou.

## Recursos

- **Tipos de gráfico:** velas, barras OHLC, linha, área, Heikin-Ashi e Renko.
- **Indicadores incrementais** (`warmup`+`update`+`preview` O(1)): sobre o preço
  ou em sub-painel próprio, com bandas preenchidas (Bollinger, Keltner).
- **Ferramentas de desenho:** 13 delas — linha, raio, reta, horizontal, raio
  horizontal, vertical, retângulo, seta, régua, retração e extensão de Fibonacci,
  e posição de compra/venda com risco-retorno — todas com ímã ao OHLC, seleção,
  edição por alça e histórico.
- **Alertas de preço:** cruzamento, toque, faixa, variação percentual e cruzamento
  de duas séries, sem repique, e **desenhados no gráfico** com o estado virando
  aparência (armado é tracejado âmbar; disparado é sólido ciano).
- **Replay de mercado:** reproduz o pregão barra a barra, com play/pause/velocidade,
  sobre dado sintético ou histórico real.
- **Legenda O/H/L/C** sob o cursor, **trilha de legendas** das camadas de canvas
  (um dono por linha, em ordem de leitura) e **persistência de layout** completa.
- **Abas por ativo:** cada aba é um DOCUMENTO — desenhos, indicadores e alertas
  voltam ao trocar de aba. Aba nova herda os indicadores e não as marcações de
  preço, que não valem em outro instrumento.
- **Setups nomeados:** vários layouts pelo mesmo ativo, salvos por nome.
- **Leitura do ativo:** desempenho por janela, sazonalidade por ano, termômetro
  dos indicadores ligados, e correlação entre dois ativos num inset.
- **Objetos do gráfico em lista** (`ObjectTree`): o que está na tela, com
  visibilidade, remoção e atalho para as propriedades.
- **Fluxo de ordem:** bookmap (heatmap de livro), footprint e perfil de volume —
  este último por coluna ou por linha, e opcionalmente só da janela visível.

### Uso mínimo (React)

```tsx
import { RobustusChart } from '@robustus/charts-react';

<RobustusChart
  options={{ withVolume: true }}
  candles={velas}
  bookmap={grid ? { grid, metrica: 'AMBAS', escala: 'P99_GAMMA', tickSize: 5 } : null}
  resetViewportOn={periodo}
  height="520px"
/>
```

Sem React, o motor é direto:

```ts
import { ChartEngine } from '@robustus/charts-engine';

const motor = ChartEngine.create(container, { withVolume: true });
motor.setCandles(velas);
motor.setPriceSeriesType('Line');                 // troca o tipo sem recriar
const parar = motor.onCoordinateMapperChange((m) => posicionarOverlays(m));
```

Ligar um backend é implementar o contrato de `datafeed` — capacidades são
opcionais, e uma fonte que só tem candles é válida:

```ts
const feed: Datafeed = {
  bars: {
    async getBars(req, signal) {
      const r = await fetch(minhaUrl(req), { signal });
      if (!r.ok) return fail(r.status === 404 ? 'INDISPONIVEL' : 'TRANSPORTE');
      return ok(await r.json());
    },
  },
};
```

## Arquitetura

```
core          (zero dependência, sem DOM)
chart-core    (motor próprio em canvas; sem terceiros)
 ├── primitives    (+ chart-core, SÓ por tipo)
 ├── datafeed      (+ nada; fetch é injetado)
 └── drawings      (+ chart-core, tipo e runtime)
engine        (core + chart-core + primitives; usa createChart do chart-core)
 └── react        (+ drawings, alerts, replay — hooks opcionais)
devtools      (core + primitives) — não entra em aplicação, e é `private`

alerts        (ILHA independente — zero dependência, motor puro)
replay        (ILHA independente — tipo ReplayBar local, relógio injetado)
indicators    (ILHA independente — instala À PARTE, ninguém depende dele)
```

Regras que sustentam o grafo:

1. **`core` não vê DOM.** `"lib": ["ES2020"]` no `tsconfig` — um `document`
   acidental vira erro de compilação. O mesmo em `indicators`, `alerts` e `replay`.
2. **`chart-core` não importa terceiro.** É o motor próprio, em canvas.
3. **`primitives` importa o motor só por tipo** — verificável no artefato.
4. **`engine` não importa `drawings`.** Desenho é opcional; a ligação vive em
   `react/useDrawings.ts`. O mesmo vale para alerts, replay e indicators.

Verificação de que não há terceiro:

```bash
grep -rn "from 'lightweight-charts'\|from 'fancy-canvas'" packages/*/src apps/*/src
# saída vazia
```

## Motor próprio — a decisão central

O projeto começou sobre `lightweight-charts` (Apache 2.0), mas por decisão de
projeto — nada de terceiros — o substrato foi **substituído por motor próprio**,
`@robustus/chart-core`, em canvas puro. A troca foi cirúrgica: o contrato do
`chart-core` foi desenhado compatível com o do terceiro, então bookmap, footprint
e desenho mudaram só o import, sem tocar na lógica — e a suíte herdada provou que
o comportamento não mudou.

O motor entrega eixo de tempo com sessão irregular (espaço lógico contínuo — velas
equidistantes, fim de semana não ocupa espaço), autoescala pela janela visível e
**por escala de preço** (o volume não esmaga mais as velas), pan/zoom, pinça em
touch, crosshair com rótulos de preço e data, sub-painéis empilhados com divisória
arrastável, marcadores com forma, banda preenchida, formatação de preço por tick,
ticks logarítmicos, watermark e exportar imagem. Do que o terceiro maduro tinha,
falta **animação de transição** — acréscimo que vai **aqui**, nunca de volta a
terceiro.

## Sobre a origem do código

Parte dos núcleos foi **copiada** de um cockpit de mesa em produção
(`Projetos/Trading/frontend`), que permanece **intocado** — fonte somente leitura.
Boa parte dos testes veio junto, e é essa suíte que prova que a extração não mudou
comportamento. Os núcleos copiados têm identificadores em português
(`agregarFootprint`, `RAMPA_TERMICA`); o índice de cada pacote publica também um
apelido em inglês via `export { x as y }` — mesmo símbolo, custo zero em runtime.

## Licença

Proprietária, uso interno. `UNLICENSED` em todo `package.json` — o valor do npm
para "nenhuma licença concedida". Termos completos em [LICENSE](./LICENSE).
