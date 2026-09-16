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
npm test          # 988 testes, 51 arquivos
npm run build     # compila todos os pacotes
npm run dev -w @robustus/charts-playground   # http://127.0.0.1:5173
```

## Pacotes

| Pacote | O que é |
|---|---|
| `@robustus/charts-core` | Núcleos puros (sem DOM): agregação por zoom, escala de cor por percentil, decodificação colunar, perfil de volume, footprint |
| `@robustus/chart-core` | **Motor de renderização próprio** em canvas: eixo de tempo com sessão irregular, autoescala, pan/zoom, crosshair com rótulos, sub-painéis, marcadores com forma, banda, formatação de preço |
| `@robustus/charts-primitives` | Camadas de canvas: `BookmapPrimitive`, `FootprintPrimitive` |
| `@robustus/charts-indicators` | 20 indicadores incrementais (SMA/EMA/WMA/RMA/DEMA/TEMA, RSI/Stoch/CCI/Williams %R/ROC/Momentum, ATR/StdDev/Bollinger/Keltner, MACD/ADX/OBV/VWAP) |
| `@robustus/charts-drawings` | 8 ferramentas de desenho, hit-test priorizado, ímã ao OHLC, desfazer/refazer, persistência versionada |
| `@robustus/charts-datafeed` | Contrato agnóstico de fonte de dados: dia de mercado, HTTP bars/depth, WS ao vivo com reconexão, agregador de timeframes |
| `@robustus/charts-alerts` | Motor puro de alerta de preço, máquina ARMED→TRIGGERED sem repique |
| `@robustus/charts-replay` | Replay de mercado determinístico, relógio injetado, pausa no fim |
| `@robustus/charts-engine` | Motor sem framework + persistência de layout (`serializeChartState`) |
| `@robustus/charts-react` | Hooks finos: `useChartEngine`, `useDrawings`, `useIndicators`, `useAlerts`, `useReplay`, `useCrosshair`, `useChartState`, e `<RobustusChart />` |
| `@robustus/charts-devtools` | Bancada de desempenho com dublês de canvas |

## Recursos

- **Tipos de gráfico:** velas, barras OHLC, linha, área, Heikin-Ashi e Renko.
- **Indicadores incrementais** (`warmup`+`update`+`preview` O(1)): sobre o preço
  ou em sub-painel próprio, com bandas preenchidas (Bollinger, Keltner).
- **Ferramentas de desenho:** linha, raio, reta, horizontal, vertical, retângulo,
  Fibonacci e régua — com ímã ao OHLC, seleção, edição por alça e histórico.
- **Alertas de preço:** cruzamento, toque, faixa e variação percentual, sem repique.
- **Replay de mercado:** reproduz o pregão barra a barra, com play/pause/velocidade.
- **Legenda O/H/L/C** sob o cursor e **persistência de layout** completa.
- **Fluxo de ordem:** bookmap (heatmap de livro), footprint e perfil de volume.

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
 └── react        (+ drawings, indicators, alerts, replay — hooks opcionais)
devtools      (core + primitives) — não entra em aplicação

alerts        (ILHA independente — zero dependência, motor puro)
replay        (ILHA independente — tipo ReplayBar local, relógio injetado)
```

Regras que sustentam o grafo:

1. **`core` não vê DOM.** `"lib": ["ES2020"]` no `tsconfig` — um `document`
   acidental vira erro de compilação.
2. **`chart-core` não importa terceiro.** É o motor próprio, em canvas.
3. **`primitives` importa o motor só por tipo** — verificável no artefato.
4. **`engine` não importa `drawings`.** Desenho é opcional; a ligação vive em
   `react/useDrawings.ts`. O mesmo vale para alerts e replay.

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
equidistantes, fim de semana não ocupa espaço), autoescala pela janela visível,
pan/zoom, crosshair com rótulos de preço e data, sub-painéis empilhados, marcadores
com forma, banda preenchida, formatação de preço por tick e o contrato de
`ISeriesPrimitive`. Ainda faltam pinça em touch, animação de transição e escala
logarítmica plenamente exercitada — acréscimos que vão **aqui**, nunca de volta a
terceiro.

## Sobre a origem do código

Parte dos núcleos foi **copiada** de um cockpit de mesa em produção
(`Projetos/Trading/frontend`), que permanece **intocado** — fonte somente leitura.
Boa parte dos testes veio junto, e é essa suíte que prova que a extração não mudou
comportamento. Os núcleos copiados têm identificadores em português
(`agregarFootprint`, `RAMPA_TERMICA`); o índice de cada pacote publica também um
apelido em inglês via `export { x as y }` — mesmo símbolo, custo zero em runtime.

## Licença

UNLICENSED — uso interno.
