# Robustus Charts

Biblioteca de visualização de mercado: **bookmap** (heatmap de livro por região
de preço), **footprint**, **perfil de volume** e a aritmética de desenho que os
sustenta. Agnóstica de fonte de dados e de framework.

Existe para que qualquer ferramenta possa desenhar fluxo de ordem sem depender de
provedor de gráfico de terceiro.

## Estado

| Pacote | O que é | Situação |
|---|---|---|
| `@robustus/charts-core` | Núcleos puros: agregação por zoom, escala de cor por percentil, célula→pixel, decodificação colunar, cobertura, paredes, perfil, footprint | ✅ copiado e verificado |
| `@robustus/charts-primitives` | Camadas de canvas: `BookmapPrimitive`, `FootprintPrimitive` | ✅ copiado e verificado |
| `@robustus/charts-devtools` | Bancada de desempenho com dublês de canvas e relógio injetável | ✅ copiado e verificado |
| `@robustus/charts-datafeed` | Contrato agnóstico de fonte de dados + dia de mercado + adaptador HTTP de referência | ✅ novo |
| `@robustus/charts-drawings` | 8 ferramentas de desenho, hit-test, histórico, persistência | ✅ novo |
| `@robustus/charts-engine` | Motor sem framework sobre o substrato | ✅ novo |
| `@robustus/charts-react` | `useChartEngine`, `useDrawings`, `<RobustusChart />` | ✅ novo |

**703 testes passando em 31 arquivos.** 519 deles vieram junto com o código copiado:
é essa suíte que prova que a extração não mudou comportamento.

```bash
npm install
npm test          # 703 testes
npm run build     # compila todos os pacotes
```

### Uso mínimo

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
const motor = ChartEngine.create(container, { withVolume: true });
motor.setCandles(velas);
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
 └── primitives   (+ lightweight-charts e fancy-canvas, SÓ por tipo)
      └── engine     (+ lightweight-charts em runtime)
           └── react
datafeed      (depende só de core)
devtools      (core + primitives) — não entra em aplicação
```

Três decisões que explicam o resto:

**O substrato de renderização é o `lightweight-charts`, e isso é deliberado.**
Ele é Apache 2.0 e entrega a parte chata: eixo de tempo com sessão irregular,
inércia de pan/zoom, crosshair, autoescala, resize com `devicePixelRatio`, e a
API de `ISeriesPrimitive`. O diferencial da biblioteca — bookmap, footprint,
absorção — é construído *sobre* isso. Não confundir com depender da TradingView
como serviço: são coisas diferentes, e só a segunda tem amarra comercial.

**As primitives importam o substrato apenas por tipo.** Verificável no artefato:

```bash
grep -nE "^\s*(import|export)[^*]*from ['\"]" packages/primitives/dist/*.js
# nenhuma linha cita lightweight-charts — só @robustus/charts-core
```

Consequência prática: as camadas são testáveis com dublês, sem instanciar
gráfico, e trocar o substrato um dia mexe no `engine`, não nas 2.700 linhas de
desenho.

**O core compila sem DOM.** `"lib": ["ES2020"]` em `packages/core/tsconfig.json`.
Um `document` ou `fetch` acidental vira erro de compilação, não dependência
escondida.

## Sobre a origem do código

O núcleo foi **copiado** de um cockpit de mesa em produção
(`Projetos/Trading/frontend`), que permanece **intocado** — é fonte somente
leitura. O que foi generalizado na cópia:

| Era | Virou | Por quê |
|---|---|---|
| Fuso `America/Sao_Paulo` fixo no código | `ClockFormatter` injetável, BRT como default | A mesma camada pode ser lida por mesa em SP, backtest em UTC e painel em Chicago |
| `toLocaleString('pt-BR')` no corpo | `NumberFormatter` injetável, pt-BR default | Locale de número é eixo legítimo de localização |
| Import relativo sem extensão | ESM resolvível pelo Node | `moduleResolution: Bundler` emite `dist` que só funciona dentro de bundler; SSR e Node quebram |
| Hooks React com URL de backend cravada | (a fazer) pacote `datafeed` | Uma biblioteca não conhece o backend de ninguém |

Em todos os casos o **default reproduz o comportamento da origem**, para que os
519 testes herdados continuassem valendo como prova.

### Duas grafias na API

Os núcleos têm identificadores em português (`agregarFootprint`, `RAMPA_TERMICA`)
porque foram copiados verbatim — renomear 500 KB destruiria a suíte que torna a
extração verificável. O índice de cada pacote publica **as duas grafias**: a
original e um apelido em inglês (`aggregateFootprint`, `THERMAL_RAMP`), via
`export { x as y }` — mesmo símbolo, custo zero em runtime.

## Ferramentas de desenho

Oito ferramentas — linha de tendência, raio, reta, horizontal, vertical, retângulo,
retração de Fibonacci e régua — com criação por arrasto, seleção, edição por alça,
ímã ao OHLC, desfazer/refazer e persistência versionada.

```tsx
const { containerRef, engine } = useChartEngine({ candles });
const desenho = useDrawings({ engine, bars: () => velas, snapEnabled: () => shift });

<button onClick={() => desenho.setTool('TRENDLINE')}>Linha</button>
<button onClick={desenho.undo} disabled={!desenho.canUndo}>Desfazer</button>
```

Atalhos já tratados: `Esc` cancela e restaura, `Delete` remove a seleção,
`Ctrl/Cmd+Z` desfaz, `Ctrl/Cmd+Shift+Z` refaz. Ignorados quando o foco está em campo
de texto.

### Três armadilhas do substrato que este pacote resolve

**Desenho que desaparece ao trocar de período.** `timeToCoordinate` devolve `null`
quando o instante não é barra da escala corrente — uma linha traçada em M5 tem âncora
que não existe em H1. A conversão correta passa por `timeToIndex(t, findNearest)` +
`logicalToCoordinate`, com interpolação da fração da barra.

**Arrastar a alça move o desenho inteiro.** A alça fica dentro da região e sobre o
traço; sem prioridade de acerto, o empate por distância entrega a região. Alça = 2,
traço = 1, região = 0.

**O gráfico rola por baixo do desenho.** O substrato usa arrasto pressionado para pan
e não expõe evento de arrasto. O controlador desliga `handleScroll.pressedMouseMove`
ao iniciar e religa em bloco de encerramento, com `setPointerCapture`.

### Velocidade — medida, não afirmada

| Medida | Valor |
|---|---|
| hit-test, 500 desenhos | **0,0076 ms** por movimento de cursor (p95 0,0095) |
| escala 50 → 500 desenhos | **7,9×** para 10× mais itens — sub-linear |
| projeção, 500 desenhos | 0,743 ms por mudança de viewport |

7,6 µs é 0,05% de um quadro de 16 ms. O crescimento sub-linear é a prova empírica de
que o prefiltro de caixa envolvente em array plano basta: quadtree traria
reconstrução a cada pan e perda de localidade de cache — mais lenta **e** mais
complexa para este N. O ganho de ordem de grandeza está em **não converter
coordenada durante o movimento**: o plano de tela fica em cache, invalidado por época
de viewport.

Reproduza com `npx vitest --run packages/drawings/src/__tests__/desempenho.spec.ts`.

## O que a biblioteca ainda não faz

- **Não há sub-painel (`pane`) real.** Indicador "em painel separado" na origem é
  escala de preço de overlay com `scaleMargins`, no mesmo pane. O substrato v5 tem
  panes nativos; nunca foram usados.
- **Não há persistência de layout** nem template nomeado. Desenho tem persistência
  versionada; layout de gráfico não.
- **Não há indicadores calculados no cliente.** A origem recebe as linhas prontas do
  backend.

## Licença

UNLICENSED — uso interno.
