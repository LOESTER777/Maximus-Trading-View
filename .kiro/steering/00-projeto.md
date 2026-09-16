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
| `@robustus/chart-core` | motor de renderização próprio em canvas (eixo, escala, panes, interação) | herdados |
| `@robustus/charts-datafeed` | contrato agnóstico + dia de mercado + HTTP bars/depth + WS ao vivo + agregador | ~120 |
| `@robustus/charts-indicators` | 20 indicadores incrementais (warmup+update+preview O(1)), registry | 45 |
| `@robustus/charts-drawings` | 8 ferramentas, hit-test, histórico, persistência | 105 |
| `@robustus/charts-engine` | motor sem framework | 18 novos |
| `@robustus/charts-react` | `useChartEngine`, `useDrawings`, `<RobustusChart />` | 12 novos |
| `@robustus/charts-devtools` | bancada de desempenho | herdados |

```
npm test          # 843 testes, 39 arquivos
npm run build     # todos os pacotes
```

## Indicadores — o contrato incremental

`charts-indicators` é INCREMENTAL, não batch (a origem era batch). Contrato:
`warmup(history)` alimenta o histórico, `update(bar)` consome uma barra fechada
O(1) com estado rolante, `preview(bar)` calcula a barra em formação SEM mutar.

A propriedade central — **incremental == batch** — é garantida por construção:
`warmup` roda os mesmos `update`. Há property test que reprova se um indicador
novo violar. Estado rolante usa soma de Kahan (não deriva em janela longa) e
Wilder distinto de EMA (RSI/ATR/ADX batem com a referência).

Plotar liga `indicators` ao `engine` pelo `IndicatorPlotter`, por ESTRUTURA — o
motor não importa o pacote de indicadores. O descritor `OutputSpec.pane` decide:
`'price'` sobre as velas, `'separate'` em sub-painel nativo (`addPane`). No React,
`useIndicators` faz a costura.

⚠️ Falta `removePane` no motor: alternar osciladores deixa a pane vazia. Próximo
passo no `chart-core`.

## Grafo de dependência — não viole

```
core          (zero dependência, lib SEM DOM)
chart-core    (motor em canvas; sem terceiros; lib com DOM)
 ├── primitives    (+ chart-core, SÓ por tipo)
 ├── datafeed      (+ nada; fetch é injetado)
 └── drawings      (+ chart-core, tipo e runtime)
engine        (core + chart-core + primitives; usa createChart do chart-core)
 └── react        (+ drawings, para o hook opcional)
devtools      (core + primitives) — não entra em aplicação
```

Quatro regras que sustentam isso:

1. **`core` não vê DOM.** `"lib": ["ES2020"]` no `tsconfig`. Um `document` ou
   `fetch` acidental é erro de compilação, não dependência escondida.
2. **`chart-core` não importa terceiro.** É o motor próprio. Verificável:
   `grep -rn "lightweight-charts\|fancy-canvas" packages/chart-core/dist` só acha
   comentário, nunca `from`.
3. **`primitives` importa o motor só por tipo.** Verificável no artefato:
   `grep -nE "^\s*(import|export)[^*]*from" packages/primitives/dist/*.js` não cita
   o motor em runtime.
4. **`engine` não importa `drawings`.** Desenho é opcional; se o motor o importasse,
   toda aplicação pagaria o peso. A ligação vive em `react/useDrawings.ts`.

## Motor de renderização — PRÓPRIO, zero terceiros

⚠️ **Atualizado.** O projeto começou sobre `lightweight-charts` (Apache 2.0), mas
por decisão do usuário — "nada de terceiros" — isso foi **substituído por motor
próprio**, `@robustus/chart-core`, em canvas puro. Não há mais nenhum
`lightweight-charts` nem `fancy-canvas`, nem em runtime, nem em `node_modules`.

O motor entrega o que o terceiro entregava: eixo de tempo com sessão irregular
(espaço lógico contínuo — velas equidistantes, fim de semana não ocupa espaço),
autoescala de preço pela janela visível, pan/zoom, crosshair, sub-painéis
empilhados, e o contrato de `ISeriesPrimitive`.

A troca foi possível porque o contrato de `chart-core` foi desenhado **compatível**
com o do terceiro: bookmap, footprint e desenho consumiam aquele contrato por tipo,
e trocar o motor foi trocar o import (`'lightweight-charts'` → `'@robustus/chart-core'`),
sem uma linha de lógica alterada. Os 703 testes provam isso.

⚠️ O motor v1 é mais simples que o `lightweight-charts` maduro. Faltam: rótulos de
data desenhados no eixo, pinça em touch, animação de transição, escala log
plenamente exercitada. São acréscimos **aqui**, nunca volta a terceiro. Se algo
faltar, implemente no `chart-core`.

Verificação de que não há terceiro:
```
grep -rn "from 'lightweight-charts'\|from 'fancy-canvas'" packages/*/src apps/*/src
# deve ser vazio
```

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
