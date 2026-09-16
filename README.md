# Robustus Charts

Biblioteca de visualização de mercado: **bookmap** (heatmap de livro por região
de preço), **footprint**, **perfil de volume** e a aritmética de desenho que os
sustenta. Agnóstica de fonte de dados e de framework.

Existe para que qualquer ferramenta possa desenhar fluxo de ordem sem depender de
provedor de gráfico de terceiro.

## Estado

| Pacote | O que é | Situação |
|---|---|---|
| `@robustus/charts-core` | Núcleos puros: agregação por zoom, escala de cor por percentil, célula→pixel, decodificação colunar, cobertura, paredes, perfil, footprint | ✅ extraído e verificado |
| `@robustus/charts-primitives` | Camadas de canvas: `BookmapPrimitive`, `FootprintPrimitive` | ✅ extraído e verificado |
| `@robustus/charts-devtools` | Bancada de desempenho com dublês de canvas e relógio injetável | ✅ extraído e verificado |
| `@robustus/charts-datafeed` | Contrato agnóstico de fonte de dados | ⬜ a construir |
| `@robustus/charts-engine` | Motor sem framework sobre o substrato | ⬜ a construir |
| `@robustus/charts-react` | Ligação React | ⬜ a construir |

**519 testes passando em 22 arquivos**, incluindo 10 property tests. A suíte veio
junto com o código: é ela que prova que a extração não mudou comportamento.

```bash
npm install
npm test          # 519 testes
npm run build     # compila todos os pacotes
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

## O que a biblioteca ainda não faz

Vale dizer com clareza, porque é o que separa isto de um substituto completo:

- **Não há ferramenta de desenho do usuário.** Sem trendline, régua ou fibo
  manual. E as primitives **não implementam `hitTest`** de propósito — sem ele a
  camada não captura ponteiro, e isso é garantia de tipo, não de CSS (há property
  test que falha se o método aparecer). Desenho interativo precisa de camada
  própria, não de uma primitive destas.
- **Não há sub-painel (`pane`) real.** Indicador "em painel separado" na origem é
  escala de preço de overlay com `scaleMargins`, no mesmo pane. O substrato v5
  tem panes nativos; nunca foram usados.
- **Não há persistência de layout.** A origem guarda só configuração de
  indicadores em `localStorage`, por ativo, por navegador.

## Licença

UNLICENSED — uso interno.
