# Bancada de desempenho do bookmap — o arnês

> Spec `bookmap-no-mapa-de-decisao`, tarefas **12.1** (o arnês), **12.2** (a
> apuração dos alvos) e **12.3** (o tamanho do corpo). Requisitos **8.10** e
> **9.1** a **9.7**, **9.9** e **9.10**.

## O tamanho do corpo (tarefa 12.3, requisito 8.10)

|  | verboso | colunar | razão |
|---|---|---|---|
| **pregão real** (medição histórica) | 2,43 MB | **0,83 MB** | 34,2% |
| **conjunto sintético** (esta bancada) | 2,300 MB | **0,457 MB** | 19,9% |
| teto do requisito 8.10 | — | 1,0 MB | — |

**Veredito: DENTRO pelas duas leituras de "1,0 MB"** — a binária (1.048.576 B,
que é a convenção que o requisito 9.7 pina ao fixar "600 KB = 614.400 bytes") e a
decimal (1.000.000 B), que é a mais severa.

⚠️ **As duas linhas não se substituem, e a sintética é OTIMISTA no colunar.** O
verboso sintético fica a ~5% do real, mas o colunar sintético é **~1,8× menor**
que o real — então a folga sintética (54%) superestima a folga real (17%). **O
veredito do 8.10 deve ser lido pelo número real, 0,83 MB, que também cabe.**
Hipótese não medida para a diferença: neste conjunto as duas colunas de execução
são majoritariamente zero (execução só até 12:31 BRT, e em parte das células), e
um zero custa dois bytes na coluna.

O corpo colunar é medido **com** envelope e eixos; o verboso, só com as células. A
assimetria favorece o verboso de propósito.

## Como rodar

```bash
cd /media/rust/UTIL/Projetos/Trading/frontend
./node_modules/.bin/vitest --run --config vitest.bancada.config.ts
```

⚠️ Nunca `npx vitest` — resolve outra versão do cache e não aplica o apelido `@`.

A suíte do **arnês** (não da medição) roda junto da suíte comum e custa
milissegundos:

```bash
./node_modules/.bin/vitest --run src/components/decision/bookmap/__tests__/bookmap-bench-arnes.spec.ts
```

## Os arquivos

| Arquivo | Papel |
|---|---|
| `bookmap-bench-referencia.ts` | o conjunto de referência: 25.823 células, nas três formas (verbosa, colunar, grid) |
| `bookmap-bench-protocolo.ts` | o protocolo de medição, o ambiente de apuração e o relatório |
| `bookmap-bench-canvas.ts` | dublês de canvas e de escalas, que permitem chamar `draw()` |
| `bookmap-desempenho.bancada.ts` | o executor — **não coletado pela suíte comum** |
| `../__tests__/bookmap-bench-arnes.spec.ts` | regressão do arnês (39 testes, ~1,8 s) |
| `../../../../../vitest.bancada.config.ts` | configuração própria da bancada |

## O protocolo, literal (requisito 9.1)

**100 repetições consecutivas** sobre viewport de dimensões fixas, **descartadas
as 10 primeiras**, valor apurado igual ao **percentil 95** das 90 restantes.

Três decisões que o requisito não fixa, e como foram tomadas:

1. **Definição de percentil**: posto `⌈q·n⌉ − 1` — a mesma de
   `bookmap-color.core.quantileIndex`. Com `n = 90` e `q = 0,95`, é o **86º
   menor** dos 90 tempos. Reusar a convenção do projeto evita um segundo
   critério de percentil na mesma feature.
2. **Onde o cronômetro abre e fecha**: só em torno do que está sob medição.
   Preparação por repetição vai em `antes`, que **não é cronometrado** — sem
   isso, medir `draw()` mediria também o `updateAllViews()` que o antecede, e o
   alvo de 8 ms é da passada de desenho.
3. **As 10 primeiras são executadas** e só depois excluídas da estatística.
   "Descartadas" é descartar da apuração, não deixar de rodar: elas são o
   aquecimento.

O viewport fixo é **1.400 × 620 px**. A largura é a que o projeto usa ao
justificar o orçamento de 3.000 células; a altura é um painel plausível da página
de decisão. O que o requisito 9.2 cobra é que seja fixo e registrado.

`MedicaoBancada.protocoloDeclarado` é `true` somente quando repetições, descarte
e quantil são exatamente os do requisito. O relatório marca as demais linhas com
`⚠fora-do-protocolo`, para que uma medição reduzida não se disfarce de apuração.

## Conjunto de referência: por que síntese, e não um JSON versionado

A tarefa admitia duas opções. Foi escolhida **(b), síntese determinística**, por
três razões que se somam:

1. **O que se tem do pregão real são estatísticas, não o payload.** As medidas
   disponíveis são contagens e percentis. Reconstruir o payload real a partir
   delas é impossível, e versionar o real exigiria consultar o endpoint e
   congelar 0,83 MB de JSON cuja procedência ainda precisaria ser descrita em
   prosa. A síntese torna a procedência **executável**.
2. **A fixture de contrato já existe e é outra coisa.**
   `../__tests__/fixtures/colunar-backend.json` (32 células, `sha256`
   `c0ceed…b027fb5`) é saída **real** de `toColunar` e existe para pinar o acordo
   entre codificador e decodificador. **Não foi tocada.** Um segundo JSON de
   0,83 MB não acrescentaria contrato nenhum — acrescentaria volume.
3. **A fidelidade fica verificável em vez de declarada.** Cada estatística
   medida é reproduzida por construção e **conferida** por
   `bookmap-bench-arnes.spec.ts`. Se a construção derivar, o teste quebra; um
   JSON versionado só provaria que o arquivo não mudou.

### Determinismo

Zero `Date.now()`, zero `Math.random()`. Um `mulberry32` local com semente fixa,
aritmética inteira de 32 bits (nada de literal `bigint`, que `ES2017` não
compila). `Date.UTC` é puro. A ordenação da atribuição de valores desempata por
posição, sem depender da estabilidade do `sort` do motor. Duas construções
produzem vetores idênticos — asserção da suíte, não promessa.

### O que é reproduzido exatamente

| Propriedade medida | Valor |
|---|---|
| Células | 25.823 |
| Baldes × preços | 570 × 624 |
| Extensão da fila | 09:00 → 18:30 BRT (último balde abre 18:29) |
| Extensão da execução | 09:00 → 12:31 BRT |
| Classe de cobertura | `EXEC_PARCIAL` |
| Células na banda do miolo | 25.074 = 97,099% ≈ 97,1% |
| `p50` / `p90` / `p99` da fila | 481 / 714 / 1.131 |
| Maior parede real | 2.442 ct |
| Máximo global | 36.232 ct, em **nível cruzado** (venda em 160.040) |

Os percentis são exatos **na amostra que `computeColorScalePair` de fato toma** —
a união das quantidades positivas de `bid` e `ask`.

### ⚠️ Desvios em relação ao conjunto real

A tarefa 12.2 vai reportar números medidos sobre este conjunto, então os desvios
ficam declarados aqui e no cabeçalho de `bookmap-bench-referencia.ts`:

1. **O caminho de preço** é uma varredura triangular determinística com ruído,
   ancorada nos extremos para o eixo fechar em 624 preços distintos. O que se
   reproduz é a **extensão do eixo** e a **ocupação** (~44 níveis por balde,
   ordem de grandeza de um livro de 20 níveis por lado mais a oscilação do
   balde), não a trajetória do dia.
2. **Os quantis intermediários da fila** são interpolação linear por posto entre
   os quatro âncoras medidos. Cada âncora tem platô de cinco postos, de modo que
   o valor apurado não depende da convenção de percentil a menos de ±2 postos.
3. **A distribuição de execução NÃO foi medida** — não há estatística dela
   registrada no projeto. Aqui ela é plausível e escolhida: presente em parte das
   células dos baldes cobertos, em dezenas a poucas centenas de contratos.
   Conclusões da 12.2 sobre **execução** herdam essa escolha; sobre **fila**,
   não.
4. **O tamanho do corpo serializado é aproximação.** As larguras de dígito são
   realistas, mas o total em bytes depende da composição exata dos números. A
   12.3 deve reportar o valor sintético **ao lado** dos 2,43 MB / 0,83 MB
   medidos no pregão real, não em lugar deles. **Honrado** — ver a tabela de três
   linhas no começo deste arquivo. E a medição confirmou o aviso: o desvio é
   pequeno no verboso (~5%) e **grande no colunar (~1,8×)**.
5. **570 células têm os dois lados positivos** (uma por balde, no meio do
   livro). É o caso do requisito 1.9, e sem ele a medição de `draw()` não
   exercitaria a segunda passada. A consequência é que a união de positivos tem
   26.393 entradas, não 25.823.

## Isolamento da suíte comum

O executor se chama `bookmap-desempenho.bancada.ts`. O padrão de coleta de
`vitest.config.ts` é `src/**/*.{test,spec,pbt.test}.{ts,tsx}`, e `.bancada.ts`
não casa com nenhuma das seis expansões — o arquivo é **inalcançável** por
`vitest --run` sem configuração própria. Não é convenção: é padrão de arquivo.

Foi preferido a `describe.skip` sob variável de ambiente porque um arquivo pulado
ainda paga coleta, transformação e montagem de ambiente jsdom em toda execução da
suíte comum, e porque uma condição de ambiente é fácil de ligar por acidente num
executor de integração contínua.

`vitest.config.ts` ficou **intocado**. A bancada tem
`vitest.bancada.config.ts`, com processo único e sem paralelismo — medição de
tempo que compete por processador mede contenção de agendamento junto com o
trabalho da camada.

Medido: a suíte comum passou de **15,06 s / 70 arquivos / 912 testes** para
**~15 s / 71 arquivos / 950 testes**; o arquivo novo é a suíte do arnês, que roda
em ~0,5 s.

## O que o tempo de `draw()` significa neste ambiente

`jsdom` não tem contexto 2D nem rasterizador. O alvo de canvas da bancada conta
chamadas e não pinta pixel. Portanto o tempo apurado para uma passada de desenho:

- **inclui** o laço de emissão por bucket de cor, as trocas de estilo de
  preenchimento, as marcas de execução, os contornos de estouro de escala, a
  hachura de cobertura e o texto de legenda e rodapé;
- **exclui, por estarem na reconstrução do plano**, a leitura da janela visível, a
  agregação por zoom, o cálculo da escala de cor e a conversão célula→pixel;
- **exclui, por não existirem no ambiente**, rasterização, composição e
  sincronismo de quadro.

> ⚠️ **Correção de 12.2.** Uma versão anterior desta seção listava agregação,
> escala de cor e conversão célula→pixel como *incluídas* na passada. Está errado,
> e a verificação está no código: `BookmapRenderer.paint` percorre um `DrawPlan`
> com a geometria em pixel **já resolvida**, e as três operações rodam em
> `rebuild()`, chamado por `updateAllViews()`. É também o que a decisão 2 do
> protocolo diz — preparação vai em `antes`, fora do cronômetro —, então a seção
> contradizia a própria configuração da bancada. As três têm alvo próprio nos
> requisitos 9.4 e 9.5; a conversão roda uma vez por invalidação, enquanto a
> passada pode repetir para a mesma invalidação.
>
> Para que o número não seja lido como o custo de um quadro, o relatório da 12.2
> traz uma linha **informativa** de reconstrução + desenho, sem teto.

É o trabalho da própria camada — a parte sob controle do projeto, e onde uma
regressão de algoritmo apareceria. **Não** é tempo de quadro de navegador. O
relatório declara isso pelo campo `ehNavegadorReal`, e o bloco de ambiente
imprime o aviso quando ele é `false`. Uma apuração em navegador real trocaria a
fonte de ambiente e o alvo de canvas; o protocolo e o conjunto de referência
seguem valendo sem alteração.

## O relógio: dois usos opostos

| Relógio | Onde | Para quê |
|---|---|---|
| real (`performance.now()`) | protocolo, **fora** da camada | medir |
| parado (`() => 0`) | injetado em `BookmapPrimitive` | **impedir** a degradação adaptativa de mudar o orçamento no meio das 100 repetições |
| forçado (`relogioQueForcaDegradacao`) | injetado em `BookmapPrimitive` | **provocar** a degradação de forma determinística (requisitos 9.9 e 9.10) |

⚠️ A bancada nunca instala temporizador falso (`vi.useFakeTimers()`): o tempo não
avançaria e toda medição sairia zero.

## A apuração (tarefa 12.2) — requisitos 9.3 a 9.7, 9.9 e 9.10

Um relatório de stdout é efêmero; esta seção é o registro comparável com a
apuração seguinte. **Rodar a bancada reproduz tudo** — os números abaixo são de
29/08/2026, 18:18 BRT.

### Ambiente de apuração (requisito 9.2)

| | |
|---|---|
| máquina | `linux/x64 · desenv` |
| processador | 12th Gen Intel Core i7-12700F (20 lógicos) |
| memória | 125,6 GiB |
| runtime | Node v18.20.8 |
| navegador | **jsdom 25.0.1 — não é navegador real** |
| viewport | 1.400 × 620 px (fixo); 1.920 × 800 px no alvo de orçamento cheio |
| relógio | `performance.now()` |

### Alvo × teto × apurado × veredito

| Alvo | Requisito | Teto | Apurado | Veredito |
|---|---|---|---|---|
| `draw()` · orçamento cheio (2.975 células, 1920×800) | 9.3 | 8 ms | **0,109 ms** | DENTRO (73×) |
| `draw()` · viewport da bancada (1.803 células) | 9.3 | 8 ms | **0,063 ms** | DENTRO (127×) |
| `aggregateForZoom` · extensão completa do pregão | 9.4 | 12 ms | **0,808 ms** | DENTRO (15×) |
| `computeColorScale` · 25.823 células | 9.5 | 3 ms | **0,361 ms** | DENTRO (8×) |
| `computeColorScalePair` · o que a camada usa | 9.5 | 3 ms | **0,641 ms** | DENTRO (5×) |
| `decodeColumnar` · payload inteiro | 9.6 | 25 ms | **0,583 ms** | DENTRO (43×) |
| grid decodificado · eixos + valores | 9.7 | 614.400 B | **422.720 B** | DENTRO (folga 191.680 B) |
| *informativo*: reconstrução + desenho | — | sem teto | 3,0–5,0 ms | — |

Todos com o protocolo declarado: 100 repetições, 10 descartadas, p95 das 90.
Nenhum estouro, logo nenhuma proposta de reduzir `maxCells` foi emitida — o
executor a calcularia e imprimiria automaticamente se algum alvo estourasse.

⚠️ Variação entre execuções na ordem de ±30% nos alvos submilissegundo — e maior na
linha informativa, que aloca e por isso paga coleta de lixo dentro do percentil
(observado de 2,97 a 5,02 ms, com máximo de 7,83 ms). Nos **alvos** a folga é de
uma a duas ordens de grandeza, então nenhum veredito depende da execução; mas
comparar apurações exige o mesmo ambiente.

⚠️ A linha informativa é a única que chega perto do teto de 8 ms, e por isso o
executor **deriva** o texto dela do número apurado em vez de afirmar que cabe: se
uma execução passar de 8 ms, o relatório dirá isso, e não será veredito de estouro
— nenhum requisito orça a soma, e o alvo do 9.3 é só a passada de desenho.

### ⚠️ 3.000 células exatas são inalcançáveis — e por que

O requisito 9.3 condiciona o alvo a desenhar **3.000 células**, e no viewport
declarado a agregação entrega **1.803** — 60% da carga. A causa é o desenho da
agregação, não a bancada: o núcleo aceita o **primeiro** agrupamento cuja contagem
*cabe* no orçamento e, a cada tentativa, dobra a dimensão mínima dos **dois** eixos
ao mesmo tempo. A contagem, então, salta em degraus grossos e nunca pousa em 3.000.

Varrendo 4 larguras × 5 alturas × 4 dimensões mínimas, a maior contagem que cabe
em 3.000 sobre este conjunto é **2.975** (agrupamento 2 × 5), em **1.920 × 800 px**
com a dimensão mínima de produção — **99,2%** do orçamento. O alvo do 9.3 é apurado
ali, e a linha do viewport declarado fica na tabela para comparabilidade com os
outros alvos.

Nas duas janelas o número de repetições da agregação é **1**, e isso é a prova de
que o limite ativo é o **orçamento** e não a dimensão mínima de célula: repetição
maior que zero só acontece quando a primeira tentativa é recusada por estourar
`maxCells`. É a condição de que o requisito fala.

> Na janela da extensão completa (alvo 9.4) as repetições são **0** e o agrupamento
> é 2 × 22 — ali quem prende é a dimensão mínima, o que é o esperado: o requisito
> 9.4 é sobre o pior zoom, não sobre orçamento cheio.

### Degradação adaptativa e o piso (requisitos 9.9 e 9.10)

Com `relogioQueForcaDegradacao(20)` — cada passada *parece* durar 20 ms, acima do
alvo de 8 ms, de forma determinística e independente da velocidade da máquina:

```
descida        3.000 → 1.500 → 750 → 500
na passada     30 · 60 · 90         (uma janela de 30 passadas medidas por redução)
retângulos     2.244 no orçamento cheio → 379 no piso
no piso        60 passadas adicionais, nenhuma redução nova, camada seguiu desenhando
```

Requisito 9.9 satisfeito: redução à metade, três vezes, limitada ao piso de 500, e
a janela visível segue inteiramente representada — o desenho continua, com
agrupamento mais grosso em vez de recorte. Requisito 9.10 satisfeito: no piso o
valor se mantém, a camada prossegue desenhando e permanece habilitada.

Duas coisas que essa bateria exigiu, e valem para quem a estender:

1. **O aviso de degradação é de escopo de sessão** e sai uma vez por execução.
   `resetBookmapSessionWarnings()` é chamado antes de **cada** passada, para que a
   descida inteira seja *observada* e não inferida da primeira redução.
2. ⚠️ **A redução acontece no fim da passada**, em `reportPass`. A passada 90 ainda
   desenha com o teto de 750 e só então cai para 500 — medir o piso nela conta as
   células do teto anterior. Foi o que a primeira versão fez, e o relatório
   denunciou a contradição (940 contra 379 retângulos para o mesmo piso). O piso se
   mede na passada **seguinte**, e há asserção de que as duas leituras coincidem.

### Gates desta apuração

`npx tsc --noEmit --incremental false`: **14 erros**, todos preexistentes em
`__tests__` alheios (nenhum nesta pasta) — a linha de base. Suíte comum:
**15,79 s / 71 arquivos / 951 testes**, inalterada, o que confirma que a bancada
segue fora dela. As 19 falhas de `EconomicCalendarCard.test.tsx` são preexistentes
e alheias.

## Independência das conexões (requisito 12.1)

Dado sintético produzido em código; medição de tempo; texto de relatório. Nenhuma
leitura de banco, de arquivo de dado, de CSV ou de rede; nenhuma escrita em lugar
algum. `node:os` e `globalThis.navigator` são lidos exclusivamente para descrever
a máquina e o runtime no relatório. Não há endereço de rede, identificador de
conta, credencial ou estado de posição. Nada aqui importa da árvore de
negociação.
