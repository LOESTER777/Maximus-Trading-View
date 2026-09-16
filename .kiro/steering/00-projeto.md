# Robustus Charts — o que este projeto é

Biblioteca de visualização de mercado: **bookmap** (heatmap de livro por região de
preço), **footprint**, **perfil de volume** e **ferramentas de desenho**. Agnóstica
de fonte de dados e de framework.

Existe para que qualquer ferramenta do usuário desenhe fluxo de ordem sem depender
de provedor de gráfico de terceiro.

## Origem do código — leia antes de mexer

A maior parte dos núcleos foi **copiada** de um cockpit de mesa em produção:
`/media/rust/UTIL/Projetos/Trading/frontend/src/components/decision/bookmap/`.

⚠️ **Essa origem é SOMENTE LEITURA. Nunca escreva nela.** Nem para "corrigir" algo,
nem para manter em sincronia. Se um defeito for encontrado aqui e existir lá também,
relate — não conserte lá.

Junto com o código veio a suíte que o prova. **519 dos 703 testes são herdados**, e
passam sem uma asserção alterada. É essa suíte que autoriza afirmar que a extração
não mudou comportamento. Preservá-la é mais importante que qualquer refatoração
cosmética.

## Estado

| Pacote | Situação | Testes |
|---|---|---|
| `@robustus/charts-core` | 14 núcleos puros, compila **sem DOM** | herdados |
| `@robustus/charts-primitives` | `BookmapPrimitive` (2.669 linhas), `FootprintPrimitive` | herdados |
| `@robustus/charts-datafeed` | contrato agnóstico + dia de mercado + adaptador HTTP | 45 novos |
| `@robustus/charts-drawings` | 8 ferramentas, hit-test, histórico, persistência | 105 novos |
| `@robustus/charts-engine` | motor sem framework | 18 novos |
| `@robustus/charts-react` | `useChartEngine`, `useDrawings`, `<RobustusChart />` | 12 novos |
| `@robustus/charts-devtools` | bancada de desempenho | herdados |

```
npm test          # 703 testes, 31 arquivos
npm run build     # todos os pacotes
```

## Grafo de dependência — não viole

```
core          (zero dependência, lib SEM DOM)
 ├── primitives    (+ lightweight-charts e fancy-canvas, SÓ por tipo)
 ├── datafeed      (+ nada; fetch é injetado)
 └── drawings      (+ lightweight-charts, tipo e runtime)
engine        (core + primitives; ÚNICO com lightweight-charts em runtime)
 └── react        (+ drawings, para o hook opcional)
devtools      (core + primitives) — não entra em aplicação
```

Três regras que sustentam isso:

1. **`core` não vê DOM.** `"lib": ["ES2020"]` no `tsconfig`. Um `document` ou
   `fetch` acidental é erro de compilação, não dependência escondida.
2. **`primitives` importa o substrato só por tipo.** Verificável no artefato:
   `grep -nE "^\s*(import|export)[^*]*from" packages/primitives/dist/*.js` não cita
   `lightweight-charts`.
3. **`engine` não importa `drawings`.** Desenho é opcional; se o motor o importasse,
   toda aplicação pagaria o peso. A ligação vive em `react/useDrawings.ts`.

## Escolha de substrato — decidida, não reabra sem motivo novo

O renderizador é o **`lightweight-charts` (Apache 2.0)**, e isso é deliberado.

Ser independente da TradingView como *serviço* não exige rejeitar uma biblioteca
Apache 2.0 dela. São coisas diferentes: o **Advanced Charts** exige contrato
assinado, atribuição visível e ambiente não-paywall; o `lightweight-charts` não tem
amarra nenhuma.

O que o substrato entrega é a parte chata e madura: eixo de tempo com sessão
irregular, inércia de pan/zoom, crosshair, autoescala, resize com
`devicePixelRatio`, e a API de `ISeriesPrimitive`. O diferencial da biblioteca é
construído *sobre* isso.

Se um dia trocar: o que muda é `engine` e `drawings/chart-converters.ts`. Não as
2.700 linhas de desenho do bookmap, nem os núcleos puros, nem nenhuma tela.

## Playground local

`apps/playground` — superfície para ver a biblioteca funcionando sem backend, com
dado sintético determinístico.

```
npm run dev -w @robustus/charts-playground   # http://127.0.0.1:5173
```

Porta **5173** (padrão do Vite), com `strictPort: true` — falha em vez de pular de
porta em silêncio. Verificada livre nesta máquina, longe das portas dos outros
projetos (Trading 41000/41100, Postgres 543x, bridges 822x/823x). Reserva: 5174.

Os alias do Vite apontam para `packages/*/src`, não para `dist`: editar um pacote
reflete no navegador sem `tsc --build`. Isso **não** substitui `npm run build`, que
verifica o que um consumidor de verdade importa.

O dado vem de `apps/playground/src/synthetic.ts` — caminhada aleatória com semente
fixa. **Não é formato de provedor real**; dado real entra pela camada `datafeed`.
