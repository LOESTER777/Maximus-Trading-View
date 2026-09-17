---
inclusion: manual
---

# Armadilhas medidas — o conhecimento caro deste projeto

Cada item aqui custou um defeito real, uma medição ou uma leitura de contrato. É o
que separa uma implementação que funciona na demonstração de uma que funciona na
mesa. Leia antes de mexer na camada correspondente.

Ativação: `#20-armadilhas` no chat.

---

## Substrato (`lightweight-charts` 5.1.0)

### ⚠️ `timeToCoordinate` devolve `null` para tempo que não é barra

Contrato literal dos typings: *"X coordinate of that time or `null` if no time found
on time scale"*.

**Consequência:** uma linha traçada em M5 tem âncora, digamos, às 10:32:00. Em H1
não existe barra às 10:32:00. `timeToCoordinate` devolve `null`, a implementação
conclui "fora de vista", e **o usuário troca de período e todos os desenhos
desaparecem**. Voltando ao M5 eles reaparecem, o que faz o defeito parecer
intermitente.

**Correto:** `timeToIndex(t, findNearest = true)` → `logicalToCoordinate(índice)`,
que trabalha em espaço lógico contínuo. Mais interpolação da fração da barra, senão
o X fica quantizado ao centro dela (visível em D1: uma âncora de 14:00 apareceria no
meio do dia).

Implementado em `packages/drawings/src/chart-converters.ts`. O teste em
`consistencia.spec.ts` reproduz o **mecanismo** — há um conversor que imita o
`null` e falha, ao lado do correto que passa.

### ⚠️ `priceScale(id).width()` LANÇA quando o id não existe

Não devolve `null`, não devolve `0` — lança. É consultado a cada quadro pelo
mapeador de coordenadas, então uma escala de overlay ainda não criada derrubaria o
laço de desenho. Daí o `try/catch` em `ChartCoordinateMapper.priceScaleWidthPx`.

### ⚠️ Não existe evento de arrasto na API

Só `subscribeClick` e `subscribeDblClick`. Arrastar exige pointer events do DOM no
container — é por isso que `DrawingController` existe e que `ChartEngine` expõe
`container`.

### ⚠️ O gráfico também quer o arrasto

O substrato usa arrasto com botão pressionado para dar pan. Sem intervenção, mover
uma linha de tendência rola o gráfico por baixo, e os dois gestos acontecem juntos.

**Correto:** desligar `handleScroll.pressedMouseMove` ao iniciar o gesto e religar
**em bloco de encerramento**. Se uma exceção deixasse o pan desligado, o gráfico
ficaria travado para sempre e o usuário não teria como descobrir por quê.

### ⚠️ Sem `setPointerCapture` o arrasto nunca termina

Arrastar rápido para fora do container faz o `pointerup` cair noutro elemento. O
desenho fica colado no cursor, o pan segue desligado, e só recarregar resolve.

### ⚠️ Destruir e recriar o gráfico produz `Object is disposed`

Na origem, `key={timeframe}` no React destruía e remontava o gráfico a cada troca de
período, e o observador de redimensionamento apontava para o canvas morto — erro de
dentro de `resizeCanvasElement`.

**Correto:** manter o gráfico vivo e chamar `resetViewport()`. No React, use
`resetViewportOn`, nunca `key`.

### ⚠️ Não há sub-painel em uso

Zero `addPane`/`paneIndex` no projeto. Indicador "em painel separado" é escala de
preço de overlay com `scaleMargins`, no **mesmo** pane. O v5 tem panes nativos e
eles nunca foram usados. Para RSI/MACD numa faixa própria, é trabalho novo.

---

## Hit-test e desenho

### ⚠️ Sem prioridade de acerto, redimensionar é impossível

A alça fica **dentro** da região e **sobre** o traço. Um empate por distância
entrega a região, e o usuário move o retângulo inteiro quando queria
redimensioná-lo. É o defeito mais comum em ferramenta de desenho, e não aparece em
teste manual rápido porque só se manifesta quando a alça está sobre o preenchimento.

**Correto:** alça reporta `hitTestPriority: 2`, traço `1`, região `0`, com `distance`
real. A resolução fica com o substrato, que dá precedência especial a acerto de
ponto.

### ⚠️ Região sem preenchimento não pode capturar o interior

Um retângulo vazio grande capturaria todo clique no meio do gráfico e impediria o
pan — que é o gesto mais usado. Contorno visível, interior transparente: acerto só
no contorno.

### ⚠️ Caixa envolvente das pontas produz falso negativo

Uma linha de tendência longa com as **duas** âncoras fora da tela pode cruzar o meio
dela. Descartá-la a faria desaparecer justamente no zoom de perto. Use
`segmentIntersectsBox` (Liang-Barsky), não caixa-contra-caixa.

### ⚠️ Caixa envolvente com `Infinity` aceita tudo

`boxOfPoints` devolve `null` quando todos os pontos são não-finitos, e não uma caixa
infinita — que passaria em qualquer teste de interseção e faria o prefiltro aceitar
tudo, o oposto do propósito dele.

### ⚠️ Tolerância de hit-test é limitada pelo padding da caixa

Defeito real corrigido: o parâmetro `tolerance` de `hitTest` não tinha efeito quando
**maior** que o `HIT_TOLERANCE_PX` usado na projeção — o prefiltro rejeitava o ponto
antes da distância exata. O caminho de tolerância menor sempre funcionou, o que
tornava o defeito fácil de não notar. Corrigido com folga extra no prefiltro.

### ⚠️ A época de cache precisa incluir tamanho e escala de preço

Redimensionar a janela **não** muda a faixa visível de tempo. Mudar a escala de
preço também não. Sem esses campos na época, o cache sobrevive a um resize e o
hit-test passa a responder em coordenada velha — o usuário clica na linha e nada
acontece. Pior que não ter cache.

### ⚠️ Desenhar reta infinita com coordenada gigante

`x = 1e9` "funciona" e o canvas perde precisão de rasterização em magnitude alta: a
linha sai tremida ou desalinhada por um pixel que varia com o pan. Recorte na borda
com `extendLineToBox`.

---

## Canvas

### ⚠️ Fonte em pixel lógico sai borrada

`ctx.font` precisa ser em pixel de **bitmap**: `Math.round(9 * vpr)`. Em pixel
lógico o texto sai borrado em tela de alta densidade.

### ⚠️ `ctx.filter` não existe em todo ambiente

jsdom não tem. Use dentro de `try` + `save`/`restore`.

### ⚠️ Célula de 1 px desaparece

O antialias apaga. `BOOKMAP_MIN_CELL_PX_DEFAULT = 2` — e não 3, porque cada ponto a
mais engrossa o bloco no eixo do preço ("parecendo um lego", relato do operador).

### ⚠️ Uma troca de estilo por grupo, não por item

O bookmap agrupa em 16 baldes de cor e troca `fillStyle` uma vez por balde, não uma
vez por célula. As camadas de desenho seguem o mesmo padrão, agrupando por
cor+espessura+tracejado.

---

## Escala de cor

### ⭐ Normalizar por máximo apaga o livro

Medição de um pregão real (WINV26, 28/08/2026): p50 = 481, p90 = 714, p99 = 1.131,
**máx = 36.232** contratos — 32× o p99, e é nível **cruzado**, não parede.

Normalizar pelo máximo daria ~2% de opacidade ao p90, ou seja apagaria da tela quase
todo o livro. Log puro foi rejeitado por comprimir 400↔800. A escala é **percentil
p50/p99 com gamma**.

### ⚠️ A rampa térmica precisa de luminância crescente

A rampa comercial (laranja/vermelho saturados) quebra a monotonicidade: amarelo
L=181 seguido de laranja L=150 faz o olho ler uma região mais quente como mais fria.
A rampa aqui é 48 → 80 → 125 → 177 → 194 → 246, estritamente crescente.

### ⚠️ Um ulp de ponto flutuante inverte a monotonicidade

`0,06 + 0,86000...1 = 0,92000...2` — um ulp acima do teto — gerava índice 16 numa
tabela de 16 baldes, e o `fillStyle` mantinha a cor anterior. Há recorte explícito
em `alphaFor`.

---

## Dado e integridade

### ⚠️ `NaN != null` é `true`

O filtro de vela era `c.time != null`, e `NaN` passava, chegava ao renderizador e
voltava como `Uncaught Error: Value is null` de dentro da biblioteca, sem dizer qual
vela. Use `Number.isFinite`.

### ⚠️ `-0` não sobrevive a round-trip JSON

`JSON.stringify(-0)` produz `"0"`. `Object.is(-0, 0)` é `false`, então `toBe`/
`toEqual` reprovam. Para preço e instante a distinção é inócua — compare
numericamente, não por identidade.

### ⚠️ Profundidade de livro histórica é raridade

O provedor MBO integrado na origem (Plug n' Trade) mantém o livro **só em memória**,
sem persistência. Bookmap sobre ele existe ao vivo ou gravado a partir de agora,
nunca retroativo. Se bookmap histórico importa, o gravador precisa existir **antes**:
livro que não foi gravado não volta.

### ⚠️ Feed amostrado não serve para tudo

`BookThrottleMs = 150` e trade a 1000 ms, com supressão admitida pela documentação
do provedor. Queue imbalance e microprice ficam plenos (são leitura de estado);
reposição é parcial e intensidade de cancelamento fica comprometida — oferta que
aparece e some entre snapshots é invisível, o que **subestima** spoofing
sistematicamente.

### ⚠️ Volume sintético no agregador da origem

O `CandleCloseDetectorService` do projeto Trading usa **mid `(bid+ask)/2`** como
preço e soma **1 por tick** quando a fonte não manda volume. Para consumo interno
passa; se algum dia esses candles alimentarem esta biblioteca num produto, o
metadado precisa declarar `volume_kind: real | tick`.

---

## Motor próprio — ponteiro e gesto

### ⚠️ Gesto de dois dedos precisa ser ABSOLUTO contra o início, não incremental

O navegador entrega `pointermove` de **um ponteiro por vez**. Uma implementação
incremental — comparar a distância atual com a do evento anterior — vê cada metade do
movimento como se fosse o movimento todo, e o erro não se cancela.

**Consequência medida:** translação residual de **3,33 barras na direção contrária**
ao gesto. A pinça "funciona", o zoom até acontece, mas o gráfico escorrega para o lado
errado enquanto o usuário aproxima os dedos.

**Correto:** guardar a distância e o centro do **INÍCIO** do gesto e calcular zoom e
âncora absolutos contra esse estado inicial, não contra o quadro anterior.

### ⚠️ jsdom não tem `PointerEvent`

Não existe construtor, então teste de pinça, de arrasto de divisória ou de qualquer
gesto não pode simplesmente instanciar um.

**Correto:** o motor lê apenas `button`, `clientX`, `clientY`, `pointerId` e
`pointerType` — todos definíveis num `MouseEvent` com `type` de ponteiro
(`'pointerdown'`, `'pointermove'`, `'pointerup'`). Manter essa lista curta é
requisito, não acidente: ler um campo exclusivo de `PointerEvent` tornaria o gesto não
testável neste ambiente.

---

## TypeScript e ferramenta

### ⚠️ Interface NOMEADA não é atribuível a `Record<string, unknown>`

Falta assinatura de índice. Tipo objeto **literal** passa (o compilador o trata como
fresco); interface ou união discriminada nomeada **não**.

**Consequência real:** tipar o `condition` de alerta como `Record<string, unknown>`
compilava no pacote e **quebrava o consumidor**, que passa `AlertCondition` — uma união
discriminada. O erro aparece longe de onde a decisão foi tomada.

**Correto:** exigir só o que se usa. `{ kind: string }` aceita a união e continua
verificando o que importa.

### ⚠️ Vite/esbuild NÃO faz type check

O esbuild remove tipo, não o verifica. **App sem `tsconfig` é código não verificado** —
e o erro só aparece em tempo de execução, no navegador, sem pista de origem.

**Consequência real:** `apps/playground` rodou sem type check até ganhar um
`tsconfig.json` (`noEmit`), e na **primeira** execução apareceram dois defeitos reais
que estavam ali havia rodadas.

**Correto:** todo app do workspace tem `tsconfig` com `noEmit` e entra no `npm run
verify`. ⚠️ O tsconfig do app usa `moduleResolution: Bundler` — o **oposto** dos
pacotes — porque ele é consumido por bundler e os alias apontam para `packages/*/src`
sem extensão. A regra de `.js` explícito vale para biblioteca, não para app.

---

## Medições de referência

Guardadas para comparação, não como alvo.

| O quê | Valor | Onde |
|---|---|---|
| hit-test, 500 desenhos | 0,0076 ms/movimento (p95 0,0095) | `drawings/.../desempenho.spec.ts` |
| escala 50 → 500 desenhos | 7,9× para 10× itens (**sub-linear**) | idem |
| projeção, 500 desenhos | 0,743 ms por mudança de viewport | idem |
| grid de um pregão | 25.823 células, ~630 KB em array tipado | `bookmap-types.ts` |
| payload colunar vs verboso | 0,83 MB vs 2,43 MB | `bookmap-decode.core.ts` |
| orçamento de degradação | mediana de 8 ms corta o teto pela metade | `BookmapPrimitive.ts` |

O crescimento **sub-linear** do hit-test é a prova empírica de que o prefiltro AABB
em array plano basta. Quadtree traria reconstrução a cada pan e perda de localidade
de cache: mais lenta **e** mais complexa para este N. Se algum dia N chegar a
milhares, meça antes de trocar.

---

## Armadilhas descobertas em 17/09/2026

### ⚠️ Identidade de array como "trocou de dado" fecha LAÇO INFINITO em React

`useAlerts` decidia "trocou de ativo" comparando `bars !== barsAnterior`. Um
`bars={[...]}` literal em JSX — a forma mais natural de escrever — tem identidade nova
a cada render. A cadeia: identidade diferente ⇒ re-arma e zera o contador ⇒
re-alimenta a série inteira ⇒ `setState` ⇒ outro render ⇒ **volta ao início**.

**Consequência real:** travou o processo de teste por 120 s.

**Correto:** decidir por CONTEÚDO, em O(1). Aqui, o tempo da primeira barra e o da
última já alimentada: ativo novo muda a primeira, correção de histórico muda a última,
render a mais não muda nada. E **não chamar `setState` no ramo "nada mudou"** — um
`store.list()` que devolve array novo re-renderiza mesmo sem nada novo.

### ⚠️ Estado derivado de dado + memo por assinatura = campo CONGELADO

`plots` é memoizado por uma assinatura que (de propósito) não contém visibilidade. Um
`visible` escrito dentro do plot ficaria parado no valor que tinha quando os params
mudaram pela última vez, e mentiria a partir do primeiro toggle.

**Correto:** duas fontes de verdade com uma delas velha é pior que uma fonte só. O que
não entra na assinatura viaja por canal próprio (`visibility`, `colors`), sempre
fresco.

### ⚠️ Nível de preço não diz nada sobre movimento de preço

`brickSizeAutomatico` tirava o tijolo do Renko de 0,2% do preço. Dois ativos a 130.000
podem oscilar 600 ou 60.000 pontos por sessão — o mesmo tijolo serve a um e é inútil
para o outro. Medido no playground: 259,4 de tijolo para uma série de amplitude 645 ⇒
**2 tijolos no gráfico todo**.

**Correto:** grade de movimento sai do MOVIMENTO. Aqui, a variação média do
fechamento (29,3 ⇒ 98 tijolos) — e não a amplitude com pavio, que superestima ~4x um
`renko` construído sobre closes.

### ⚠️ Mudança de semântica silenciosa: prefira ERRO DE COMPILAÇÃO

Ao trocar o critério de `brickSizeAutomatico`, manter a assinatura
`(velas, fracao?: number)` faria o call site antigo `(velas, 0.002)` passar a pedir
`0,002 × 29,3` — tijolo de 0,06, e milhares de tijolos por vela. A assinatura virou
`(velas, { multiplo })`: o chamador antigo **não compila**.

**Regra:** quando o SIGNIFICADO de um parâmetro muda, mude o TIPO. Erro de compilação
é infinitamente melhor que uma falha silenciosa 1.000× fora de escala.

### ⚠️ Assinar sem poder desassinar é vazamento por render

`IChartApi` tinha `subscribeClick`/`subscribeCrosshairMove` e nenhum `unsubscribe`.
`useCrosshair` documentava a ausência e confiava em "o motor descartado não chama
mais" — verdade só quando o motor inteiro morre. Com `onMove` literal em JSX, o efeito
reassinava a cada render e **acumulava um ouvinte por render** no mesmo motor.

**Correto:** todo `subscribe` de contrato público nasce com o `unsubscribe` par,
idempotente.

### ⚠️ Estado que só existe depois do quadro: API síncrona mente

`ts.times` era preenchido dentro do `render`, agendado por `requestAnimationFrame`.
Logo `setData(velas)` seguido de `fitContent()` — o par que a documentação mostra —
chamava `fitContent` com o eixo **vazio**, que saía sem fazer nada.

**Correto:** método público que depende de estado derivado o RECONSTRÓI antes de usar.
E o efeito colateral desejado: a intenção explícita do consumidor passa a vencer a
heurística de primeira carga do motor.

### ⚠️ Eco entre dois componentes que se ouvem

Sincronizar dois gráficos é A→B→A→B… O motor emite mudança de janela quando alguém a
aplica, então aplicar em B faz B avisar, que aplica em A, que avisa…

**Correto:** sinalizador "estou aplicando", baixado em `finally` (exceção no meio não
pode deixar a guarda de pé para sempre — o grupo pararia de sincronizar em silêncio).
E o teste precisa de um duplo que REEMITA ao receber, senão passa por vacuidade.

### ⚠️ Sincronizar por índice lógico entre gráficos diferentes

A barra 100 de M5 é 8h20 depois do início; a 100 de H1 é 100 horas depois. Ativos
diferentes têm buracos de negociação diferentes.

**Correto:** o que viaja entre gráficos é TEMPO; cada destino converte para o índice
DELE (`timeToIndex(findNearest)`). É a mesma disciplina que corrigiu o indicador
deslocado no eixo, aplicada entre painéis.

### ⚠️ Célula de grid sem altura = canvas de altura zero = "o gráfico não aparece"

Num `display: grid`/`flex`, uma célula sem altura explícita colapsa para a altura do
conteúdo — e o conteúdo é um canvas que mede o pai. Sem erro, sem aviso.

**Correto:** `1fr` nas linhas, `height: 100%` no container e **`minHeight: 0` +
`minWidth: 0`**, que é o que permite a célula ENCOLHER em vez de estourar o pai.

### ⚠️ jsdom formata `minHeight: 0` como `'0'`; o navegador, como `'0px'`

Asserção `toBe('0px')` falha em jsdom. **Correto:** aceitar os dois — medir a
formatação do ambiente é testar o jsdom, não o componente.

### ⚠️ `fitContent()` antes do primeiro quadro não enquadra (em teste, sobretudo)

No teste, a janela default mostra as ~93 barras mais recentes, então a barra 100 de uma
série de 200 cai FORA da tela, com `x` negativo e `y` fora da pane. Um caso pode passar
por acidente (série plana acerta em qualquer coluna) e o vizinho falhar por motivo
errado.

**Correto:** ao testar geometria, enquadre (`fitContent`) e desenhe um quadro antes de
converter coordenada.
