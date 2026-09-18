# Robustus Charts — o que este projeto é

Biblioteca de visualização de mercado: **bookmap** (heatmap de livro por região de
preço), **footprint**, **perfil de volume** e **ferramentas de desenho**. Agnóstica
de fonte de dados e de framework.

Existe para que qualquer ferramenta do usuário desenhe fluxo de ordem sem depender
de provedor de gráfico de terceiro.

⭐ **Publicado.** O remote agora existe: `git@github.com:LOESTER777/Maximus-Trading-View.git`
(conta `LOESTER777`, via **SSH**). Branch `main` com tracking. Antes o repositório
era só local.

## ⛔⛔ O FUSO DA BRIDGE: `+10800`. E a constante já trocou de sinal DUAS vezes.

⚠️ **Leia antes de tocar em qualquer coisa de tempo.** O `timestamp` do REST da bridge é o epoch
de um relógio que marca **hora de Brasília**: formatado como se fosse UTC ele já mostra o horário
local. Para virar epoch UTC real, **soma-se 3 h**.

**O erro que aconteceu, e o método que o causou:** refiz a medição por correlação cruzada e
escolhi o deslocamento de **menor erro médio de fechamento**. Deu `−10800` com 12 pts contra
195 pts, e razão de volume 1,000. Parecia definitivo. O operador pegou olhando o gráfico:
*"o fuso está errado, a bolsa fecha 18:22"*.

⛔ **Eu premiei o SUBCONJUNTO:**

```
offset    pares casados   % do pregão   erro médio
−10800         41             36 %        12,0 pts   ← escolhido, e ERRADO
+10800        113             99 %       203,1 pts   ← correto
```

Com o deslocamento errado as séries só se sobrepõem numa faixa estreita de 3 h 20 — a interseção
artificial entre um pregão deslocado e o outro — e 41 barras escolhidas por coincidência de
horário podem ter preços parecidos. **Cobertura vem antes de erro.**

⭐⭐ **As três âncoras que fixam `+10800`, e a primeira é a que importa:**

1. **A JANELA DO PREGÃO.** O WIN negocia 09:00–18:25 BRT — fato público, não depende de comparar
   com fonte nenhuma. `cru+10800` dá **09:00 → 18:20**; `cru−10800` dá 03:00 → 12:20, impossível.
2. A razão de volume contra o arquivo: 1,028 na mesma barra.
3. A mínima de 17/09 (`low` 184.465) cai às **10:40 BRT**, e na captura do terminal ela está
   entre as marcas de 09:30 e 10:50.

⛔ **Nunca afira alinhamento de tempo comparando duas fontes.** Duas séries erradas do mesmo jeito
respondem em coro. Use uma âncora EXTERNA — o horário de funcionamento do mercado.
`scripts/auditoria-de-dados.mjs` tem `verificarJanelaDePregao`, que é exatamente essa guarda, e
foi ela que faltava (a auditoria antiga CONFIRMOU o valor errado).

## ⭐⭐ AS DUAS FONTES DIVERGEM — e a emenda agora RECUSA

⚠️ Achado da mesma investigação, e independente do fuso: alinhadas corretamente (as duas abrem
09:00 BRT, 98 % das barras casando), o arquivo e o terminal **ainda discordam**:

| | medido |
|---|---|
| preço de fechamento | divergência de **0,16 % a 0,22 %** (200 a 400 pontos) |
| volume | razão de **9x a 10x** |

São séries diferentes do mesmo mercado — provavelmente contrato (`WINV26`) contra contínuo
ajustado, e unidades de volume distintas. **Emendá-las desenha um degrau de preço na junção e um
salto de volume de uma ordem de grandeza, os dois indistinguíveis de movimento de mercado.**

⭐ `medirCoerencia` roda ANTES do merge e devolve `SerieEmendada.coerencia`. Incompatível ⇒ a
emenda **não acontece**: devolve UMA fonte inteira e o motivo em pt-BR, que o playground mostra na
trilha. `OpcoesDaEmenda.aoDivergir` escolhe qual (`'SO_HISTORICO'` default, `'SO_AO_VIVO'`,
`'EMENDAR_MESMO_ASSIM'`), e os limiares são parametrizados
(`toleranciaRelativaDePreco` 0,1 %, `razaoDeVolumeAceitavel` [0,5, 2]).

⚠️ Tolerância RELATIVA e não em pontos: 300 pontos são 0,16 % no WIN e 30 % numa ação de R$ 10.

⚠️ **Sem sobreposição, `coerencia` é `null` e não há recusa** — é o caso normal e desejável, em
que o ao vivo traz só o dia que o arquivo não tem.

### ⭐⭐⭐ RESOLVIDO em 18/09/2026: as DUAS fontes batem com a BOLSA. E isso exclui as hipóteses.

A pergunta *"por que as duas divergem"* ficou aberta porque toda medição anterior comparava as
duas entre si — o que a própria regra deste projeto proíbe. A resposta veio de uma **âncora
oficial** que estava disponível e não era usada: `GET /settlement?asset=WIN` no serviço da mesa
devolve, por data e por CONTRATO, `settle`, `last_price` e `traded_qty` — os números da B3,
9.018 linhas desde 2023-06.

Medido em setembro/2026 inteiro, contra o `last_price` de `WINV26` (o contrato de maior
`traded_qty` do dia):

| fonte | erro no fechamento diário |
|---|---|
| arquivo (`bars_api`, D1) | **0,000 % em 62 de 62 dias** |
| terminal (bridge, `1d`) | **0,000 % em 3 de 3 dias** |

⇒ **As duas casam EXATAMENTE com a bolsa.** Isso derruba as duas explicações que estavam
escritas aqui:

- ⛔ **não é contrato diferente** (contínuo ajustado contra contrato). Se fosse, o diário também
  divergiria — e ele bate na casa do ponto. O arquivo guarda o contrato bruto (`WINV26`), como o
  terminal.
- ⛔ **não é fuso.** Erro de fuso não desaparece no fechamento.

⚠️ A divergência de 0,16 %–0,22 % é **só intradiária**, e a explicação restante é
**HIPÓTESE não verificada**: o terminal é um MT5 de varejo, que entrega tick amostrado, e o
arquivo é tick completo. O fechamento de um balde de 5 min é *"o último negócio"* num e *"o
último tick que chegou"* no outro; no fim do dia os dois convergem porque o leilão de fechamento
sempre chega. Consistente com tudo o que foi medido, mas registrado como hipótese.

⭐ `scripts/auditoria-de-dados.mjs` ganhou `verificarContraLiquidacao`, que é essa aferição
permanente. Ela já achou um defeito NOVO: no **WDO**, 20 de 86 dias do arquivo NÃO batem com o
oficial (pior erro 0,241 %) — é o defeito de dupla escrita em D1 aparecendo contra a bolsa.

⚠️ E ela achou um FALSO POSITIVO meu na primeira execução, que vale como método: a busca da data
oficial tentava duas leituras de rótulo e usava a primeira que existisse. Para a barra do pregão
CORRENTE — sem liquidação publicada — ela caía em silêncio no dia ANTERIOR e acusava 0,362 %. A
correção é pular a barra cuja data não tem número oficial, e usar **uma** leitura só: medido, as
duas convenções de rótulo apontam para a mesma data em UTC.

⚠️ `settle` **não** é o fechamento: é o preço de ajuste, apurado numa janela do fim do dia, e
difere do `last_price` em 0,006 % a 0,284 %. Comparar contra ele produziria um erro pequeno e
constante que pareceria defeito.

## ⭐⭐ PARAMETRIZAÇÃO — a biblioteca serve OUTRA fonte sem editar código

Auditado em 17/09/2026 depois da pergunta *"em outros projetos os dados vão vir de outras
fontes, isso está bem parametrizado?"*. A resposta era **não**, e havia quatro amarras. Todas
desfeitas, com bancada que reprova se voltarem
(`packages/datafeed/src/__tests__/parametrizacao.spec.ts`).

⭐ O critério usado é exigente: **um consumidor com outra fonte obtém o comportamento correto
passando ARGUMENTO, sem tocar no fonte da biblioteca.** Default bom não basta — default é palpite
calibrado com UMA fonte, e a fonte do próximo projeto não participou dessa calibração.

| era | virou |
|---|---|
| `emendarSeries` dentro de `mt5-bridge.core.ts` | **`splice-series.core.ts`**, agnóstico de fonte |
| offset de fuso em constante de módulo | `OpcoesDeLeituraMt5.offsetSegundos` |
| cobertura de agressor fixa nos parsers | `coberturaMinimaDeAgressor` nos dois |
| `symbol === 'WIN' \|\| symbol === 'WDO'` no hook | `AtivoDaMesa.temAoVivo` no catálogo |
| qualidade da fonte em COMENTÁRIO | **`PerfilDeQualidade`**, valor passado por argumento |
| escolha do par diário de D1 embutida | `OpcoesDeLeituraDaMesa.politicaDeD1` |
| "futuro não abre fim de semana" implícito | `AtivoDaMesa.sessao` (`SessaoDeMercado`) |

⭐⭐ **A emenda virou núcleo próprio.** Ela não tinha uma linha de MT5 — recebe duas listas de
`Bar` e devolve uma. Morando no adaptador, outro projeto que emende arquivo com Cedro, PNT,
Binance ou WebSocket próprio teria de importar `mt5-bridge.core` e herdaria por tabela o dialeto,
o offset e o vocabulário de período daquela bridge. `OpcoesDaEmenda` expõe o que é decisão do
consumidor: `precedencia` (`'CORTE'` | `'AO_VIVO_VENCE'` | `'ARQUIVO_VENCE'`),
`toleranciaDeSegundos` (calendário é do mercado) e `alinhamentoPorBalde` (fontes que viram o dia
em fusos diferentes).

⚠️ **E há a fronteira do que NÃO deve ser configurável**, registrada em teste: tempo
estritamente crescente e "os dois lados do agressor ou nenhum". Não são preferências de fonte —
são gráfico embaralhado e delta com sinal inventado. Ficam dentro da biblioteca, sem chave.

## ⭐⭐ QUALIDADE DA FONTE como DADO — `qualidade-da-fonte.core.ts`

As guardas anteriores olham UMA barra (`agressorUtilizavel`) ou UM par de fontes
(`medirCoerencia`). Faltava a pergunta que o operador faz: **este TRECHO é confiável?** A
resposta não é dedutível do dado — é conhecimento sobre a ingestão. `PerfilDeQualidade` é o
formato dele, `PERFIL_DA_MESA` é o desta base, e outro projeto passa o seu.

⚠️ **O laudo NUNCA recusa.** O pior nível é `REPROVADO` e o gráfico continua desenhando, com a
ressalva na trilha. Tela vazia é pior que tela com ressalva escrita.

⭐⭐ **As barras FANTASMA, e por que a sessão é do ATIVO.** Medido na série `D1` inteira:

| ativo | registros | em fim de semana |
|---|---|---|
| `WIN` | 6.377 | **15** — um por domingo, 22/02 a 31/05/2026, volume de 11 a 5.053 contra ~5 milhões |
| `WDO` / `PETR4` | 2.575 / 2.537 | 0 |
| `BTC` | 3.318 | **948 — e as 948 são LEGÍTIMAS** |

Uma regra fixa "futuro não negocia fim de semana" apagaria 948 barras corretas de cripto. As 15
do WIN entravam em média móvel, em máxima da semana e em perfil de volume como dias reais.
`filtrarDiasSemPregao` as remove e a trilha DIZ quantas.

⚠️ **A identidade é o INTERVALO, não o carimbo.** Uma barra diária rotulada `00:00Z` cobre
sáb 21:00 → dom 21:00 e não toca sessão nenhuma; rotulada `03:00Z` cobre seg 00:00 → ter 00:00 e
contém o pregão. Testar só o dia da semana do carimbo apagaria um pregão inteiro — foi o que a
guarda de grade já fez uma vez em D1.

⚠️ **Só o dia da semana permite REMOVER; minuto só permite RELATAR.** O Brasil teve horário de
verão até 2019, e com offset fixo a leitura da hora local sai 1 h deslocada em dado antigo — uma
hora nunca transforma quarta-feira em domingo, mas transforma 09:00 em 08:00.

⭐⭐ **`1min` e `2min` EXISTEM na base, e eu afirmava o contrário.** A afirmação vinha da
documentação do pipeline (*"materializa 5min do tick e deriva o resto"*). **Documentação descreve
intenção; inventário é o que a rota devolve.** Medido: 39 meses de `1min` desde jun/2023,
~11.300 barras/mês, agressor 100 % até mai/2026, e o volume fechando balde a balde com o de
5min. Quem pedia M1 era mandado ao terminal, que serve **5 h** — estavam aqui **3 anos**, no
período que mais se usa para operar o mini índice. Buraco declarado: 06/2026 vazio, 07/2026 com
1.236 das ~12.000.

⚠️ **O agressor intradiário QUEBROU em 06/2026** (`WIN 5min`, barras sem `buy_vol`):

```
2026-05: 0 de 2.283      2026-06: 1.132 (49 %)     2026-07: 1.624 (62 %)
2026-08: 1.034 (44 %)    2026-09: 219 (16 %)
```

E entre as que têm, a razão `(buy+sell)/volume` mudou de natureza: mediana **0,982** até maio (a
folga de ~2 % que é normal de leilão) e **exatamente 1,000** de julho em diante — o escritor novo
força a soma a fechar. `agressorUtilizavel` já barra barra a barra; o perfil diz **quanto** da
janela está assim.

⚠️ **O D1 tem dois registros por pregão, e a escolha foi aferida por âncora EXTERNA** (o dia
somado de `1h`, que não participa da disputa): o registro mais TARDIO acerta o fechamento em
40/40 dias no WIN e 43/43 no PETR4. Default confirmado. **Custo medido:** no WDO 201 dos 785
pares têm o agressor no registro mais CEDO, e manter o tardio deixa 201 dias sem delta — daí
`politicaDeD1: 'PREFERIR_AGRESSOR'`. ⭐ E a divergência tem DATA: os dois registros tinham close
IDÊNTICO de 2023-01 a **2026-01** (mediana 0,000 % em 3 anos) e saltam para 3,07 % em 2026-02.

## ⭐⭐ ESCALA DO HISTOGRAMA por percentil — a tarde era ilegível

`packages/chart-core/src/histogram-scale.core.ts` (20 testes). Ligado por
`priceScale(id).applyOptions({ histogramTopPercentile: 90 })` ou, no engine,
`ChartEngineOptions.volumeTopPercentile`.

⚠️ **Medido no pregão de 16/09/2026, `WIN` 5min:** a abertura tem 323.151 contratos e as 17:50
têm 2.532 — razão de **128x**. Com o teto no máximo (o que todo gráfico de volume faz, e o que
este motor fazia) a tarde inteira ocupa **menos de 1 %** da altura: correta e ilegível, no
horário em que o operador precisa comparar barras vizinhas para ler absorção. A mesma lição já
estava aplicada na escala de cor do bookmap e não tinha chegado ao histograma.

⭐⭐ **Use `90`, não o default 99** (`PERCENTIL_PARA_VOLUME_DE_FUTUROS`). O p99 corta o 1 % mais
alto e só funciona se o extremo FOR 1 % da amostra — no WIN a primeira hora inteira é alta (~13
de 114 barras). Medido: ganho de altura de **1,34x com p90** contra **1,08x com p99**. E p75 é
demais: 28 de 114 estourando faz o estouro deixar de significar "fora do comum".

⚠️ `amostrasMinimasParaPercentil(p)` = `100/(100−p)`: o p99 exige ~100 amostras para ficar abaixo
do máximo. Com o gráfico muito ampliado o recurso se desliga e informa (`usouPercentil: false`)
em vez de fingir que comprimiu.

⚠️ Custo declarado: a barra acima do teto **estoura** e deixa de ser proporcional. Vale porque a
pergunta do histograma é RELATIVA, e porque barra estourada comunica "fora de escala"
(informação) enquanto barra de 1 px comunica "não houve volume" (mentira). Default ausente =
comportamento antigo, byte a byte.

## ⭐⭐ DUAS FONTES, UMA SÉRIE — arquivo + terminal MT5 (17/09/2026)

O pedido: *"histórico é onde vc pegou + o dia atual é sempre do mt5"*. E a lacuna é
**medida**, às 16:33 BRT de 17/09, `WIN` 5min:

| fonte | barras de HOJE | de ONTEM |
|---|---|---|
| `bars_api` (arquivo, máquina B) | **0** | 114 |
| bridge MT5 (`:8229`, terminal XP) | **91** (09:00→16:30) | — |

O arquivo é alimentado por um top-up que roda **depois** do pregão. Logo, durante todo o
horário de operação o gráfico ficava em D-1 — exatamente quando alguém o olha. Medido depois
da emenda: **456 barras contínuas**, 0 duplicadas, 0 lacuna, **+22,4 h de pregão** na ponta
direita.

**A bridge:** `http://127.0.0.1:8229` (proxy `/mt5` no Vite). ⚠️ **A porta importa**: há
quatro bridges no ar (8228 Forex e escutando em `0.0.0.0`; **8229 XP DEMO = a B3**; 8230 XP
REAL; 8233 segunda demo). Apontar para a errada entrega cotação de outro mercado, com preço
plausível e sem erro.

⚠️⚠️ **O `timestamp` da bridge NÃO é epoch UTC — soma-se `+10800`.** Medido na mesma barra
(16/09 14:00 BRT): arquivo `187695`, MT5 cru `187190`, MT5 `+10800` → `187705`. O cru é um
preço **plausível** para o WIN, só três horas deslocado — ninguém percebe olhando. A correção
é `epochRealDoMt5`, aplicada na FRONTEIRA (`parseCandlesDoMt5`), para a unidade errada não
circular. O offset vale para `/candles`, `/historical`, `/historical-flow`; **não** foi medido
para o WebSocket de tick nem `/orderbook` (a bridge é inconsistente entre rotas).

⚠️ Os 5–10 pontos residuais entre as fontes **não** são erro: é `WINV26` (contrato, o que o
MT5 cota) contra `WIN` (contínuo ajustado, o que o arquivo guarda). É por isso que
`emendarSeries` proíbe misturar as duas DENTRO de uma barra — misturar fabricaria um candle
que não existiu em mercado nenhum.

⭐ **Contrato vigente pela DESCRIÇÃO, nunca por data.** `WIN$` traz
`"IBOVESPA MINI - Por Liquidez (WINV26) - Ajuste Proporcional"` — é a corretora dizendo onde
está a liquidez. Resolver por data deixou a origem **3.400 pontos** fora do mercado em
12/08/2026, quando a virada veio antes do previsto. `resolverContratoVigente`.

⚠️⚠️ **As duas rotas têm parâmetros DIFERENTES, e confundi-los é caro:**

| rota | recorte | custo medido (WIN 5min) | agressor |
|---|---|---|---|
| `/candles` | `limit` | **0,7 s** / 700 barras | não |
| `/historical-flow` | `days` (default **30**, teto 90) | **7,0 s** / 95 barras | **sim** |

Mandar `limit` para `/historical-flow` faz o parâmetro ser ignorado e a rota cair em **30 dias
de tick reclassificado** — estourou 60 s. Não dá erro, só fica lento. E o custo é do
**terminal que alimenta o robô que opera**: por isso o polling é de **60 s** (~12% de
ocupação), não 15 s (~47%). `from_ts`/`to_ts` existem na rota e **não funcionam** (medido nos
dois frames de tempo: vazio em 30 ms).

⚠️ **O token nunca vai para o navegador.** `VITE_*` é embutido no bundle; o proxy do Vite
injeta `Authorization` server-side a partir de `MT5_BRIDGE_AUTH_TOKEN` no ambiente
(`.env.local`, já coberto pelo `.gitignore`). Sem token, `/health` responde e o resto dá 401 →
`NEGADA` → degrada para o arquivo, dizendo por quê.

⭐ Só `WIN` e `WDO` têm ao vivo (é um terminal B3/futuros). `emendarSeries` declara **lacuna**
(nunca interpola) e **barra em formação** (`parcialEm`).

⚠️ Verificado: a barra parcial **não** corrompe indicador. `IndicatorPlotter.desenharPlot` chama
`warmup(history)` do zero a cada atualização, sem estado acumulado entre chamadas — o risco de
`update()` incremental sobre barra parcial não se aplica a este caminho.

### ⭐⭐ "As barras não respeitam o TF" — quatro defeitos numa linha (17/09/2026)

Relato do operador, com sintoma visível na tela. Medido: com **1h** escolhido, a série tinha
**101 pares consecutivos a 5 min de distância**.

1. **Corrida de período.** As barras do terminal viviam em estado sem carimbo. Trocar o TF
   disparava consulta nova, mas ela é assíncrona e leva **7 s** — e numa falha a série anterior
   é preservada de propósito (para não piscar), então as barras erradas podiam ficar
   **indefinidamente**. Correção: `{periodSeconds, symbol, barras}` num só `setState`, e a
   leitura descarta o que não casa com o pedido corrente. Torna a corrida inexprimível em vez de
   depender de ordem de efeito. **O mesmo vale para o histórico**, onde é pior: o backfill
   *prepende*, então um lote em vôo costurava período novo na frente do velho.
2. **Grade não validada.** `emendarSeries` ganhou a decisão 5: duas barras do mesmo período nunca
   podem estar MAIS PRÓXIMAS que um período (maior é legítimo — fim de semana, feriado, leilão).
   Quem é descartado é o ao vivo, nunca o histórico. `foraDaGrade` sai no resultado e na tela.
3. ⚠️⚠️ **D1: as fontes DISCORDAM do rótulo.** O pregão de 16/09 (verdade apurada somando 1h:
   open 188.165, close 187.600) é rotulado `16/09 00:00 UTC` pelo arquivo e `16/09 03:00 UTC`
   pelo terminal — meia-noite UTC contra meia-noite de Brasília. A guarda por resto da divisão
   **descartava o dia corrente inteiro** em D1. Correção: a identidade é o **balde**
   (`floor(t/periodo)`), que dá a mesma chave para os dois; o alinhamento só é exigido **abaixo
   de um dia**, onde as fontes concordam (medido: resto 0 em 5min/15min/1h). Em D1 o **rótulo do
   arquivo é preservado** (é a convenção dominante; trocá-lo deslocaria eixo e desenhos).
4. ⚠️ **Degrau de preço por sobreposição.** O terminal responde as N últimas barras, então
   sobrepõe dias que o arquivo já tem — medido, **117 barras** em 15min com lote de 400. Aceitá-
   las reescreveria dias com o preço do CONTRATO no lugar do CONTÍNUO. Correção (a mesma regra
   do SQL da origem): **corte** no último balde do arquivo — antes dele o arquivo é canônico,
   nele o terminal substitui (pode estar em formação), depois dele o terminal entra.
   `descartadasPeloCorte` é ALTO e saudável. Efeito medido em 15min: 404 barras → **156**.

⭐ **Melhoria da mesma rodada:** o terminal tem **M1 e M30**, que o arquivo nunca materializou.
Com o ao vivo ligado eles passam a ser oferecidos (M1 é o período que mais se usa para operar o
mini índice). O arquivo **não é consultado** nesses períodos — pedir devolveria vazio e a trilha
mostraria erro que não é erro. A nota diz "vem só do terminal: sem backfill, o alcance é o do
lote", e evita afirmar "só o dia corrente" porque seria impreciso: medido, o mesmo lote de 300
barras dá 5 h em M1 e 3 semanas em M30.

Camadas: `packages/datafeed/src/mt5-bridge.core.ts` (puro, 46 testes) +
`mt5-bridge-source.ts` (I/O) + `useMesaComAoVivo` em `apps/playground/src/mesa.ts`.

## ⭐⭐ DADO REAL — o histórico da mesa está ligado (17/09/2026)

O playground não é mais só sintético. Existe um serviço HTTP de leitura de barras na
**máquina B** (Postgres `tick_archive` em `192.168.15.183:5433`), alcançado por um túnel
systemd `--user` já ativo nesta máquina:

```
robustus-bars-tunnel.service   A:18899 -> B:8899
curl http://127.0.0.1:18899/health   # {"ok": true, "service": "bars_api"}
```

Medido com `curl` em 17/09/2026:

| ativo | barras diárias | de | até |
|---|---|---|---|
| **`WIN`** | **6.376** | **2005-02-18** | 2026-09-16 |
| `WDO` | 2.574 | 2021-05 | 2026-09-16 |
| `BTC` | 3.318 | 2017-08 | 2026-09-16 |
| `PETR4`,`VALE3`,`ITUB4`,`BBAS3` | ~2.536 | 2021-07 | 2026-09-16 |
| `BOVA11` | 1.248 | 2021-07 | 2026-08 |

⭐ **5.163 dos 6.376 dias do WIN trazem `buy_vol`/`sell_vol`** — volume por AGRESSOR, o
insumo de delta e footprint. Quase nenhum provedor entrega isso.

Rota: `GET /candles?asset=WIN&tf=5min&from=<epoch_s>&to=<epoch_s>` → `{asset, tf, count,
cols, rows}`, COLUNAR. `bar_epoch` já é epoch em **segundos**. `to` é **exclusivo**.

⚠️ **`/candles` não tem `LIMIT` nem paginação.** Sem `from`/`to` devolve a série inteira
(18 anos de 5min). O projeto de origem já matou o próprio processo servindo 28 MB de JSON
de uma vez — por isso `montarCaminhoDeBarras` **recusa** pedido sem janela.

⚠️ **M1 não existe** na base (a agregação materializa 5min do tick e deriva 15min/1h/D1);
M30 e H4 também não (são agregáveis com `rollupBars`). ⚠️ O símbolo aceito é
`[A-Za-z0-9]{1,16}` — **`WIN$` é recusado**; o nome canônico é `WIN`. ⚠️ `bid_size`/
`ask_size` vêm **nulos** em quase todo o histórico: o book não foi gravado, então bookmap
em dado antigo fica vazio e isso é a verdade sobre o dado, não defeito da camada.

O adaptador é `packages/datafeed/src/robustus-bars.core.ts` (dialeto PURO) +
`robustus-bars-source.ts` (reusa `createHttpBarsSource`, sem segundo cliente HTTP). O
playground usa por `apps/playground/src/mesa.ts`, com **proxy do Vite** em `/mesa` — o
serviço não emite CORS e não se toca em código que o robô usa para operar.

⚠️ **Lote vazio NÃO é fim de histórico.** Pedir um domingo devolve zero barras; quem
caminha pela "barra mais antiga recebida" repete a mesma janela para sempre e o gráfico
afirma não haver passado. Use `janelaAnterior` (anda pelo `from` PEDIDO) e `alcancouInicio`
(o único critério de fim é alcançar o `MIN(bar_epoch)` da cobertura). Provado contra o
serviço: 8 lotes atravessando sábado, domingo e o feriado de 7/9 = 570 barras únicas, zero
duplicadas.

## Rodada de 17/09/2026 — o que mais entrou

- **Cinco ferramentas de desenho**: raio horizontal, seta, extensão de Fibonacci e **posição
  de compra/venda** (entrada + stop, alvo derivado do múltiplo de risco, zonas de risco e
  retorno pintadas na proporção). ⚠️ A ponta da seta é feita de TRAÇOS, não de forma nova no
  renderizador — herda cor, acerto de ponteiro e recorte de graça.
- **Árvore de objetos** (`ObjectTree`): tudo o que está no gráfico em lista, com visibilidade,
  remoção e atalho para propriedades.
- **Perfil de volume da JANELA VISÍVEL** (`useVisibleTimeRange`), com guarda de frequência em
  duas partes (coalescência por quadro + zona morta em segundos).
- **Templates de layout NOMEADOS** (`layout-templates.core.ts`): os setups do operador.
- **Alerta desenhado com ESTADO** (`alert-line.core.ts`): armado é tracejado âmbar, disparado é
  sólido ciano. ⚠️ Ciano e não vermelho/verde — esses dois já significam alta e baixa.
- **Leitura do ativo** (`asset-readout.core.ts` + `AssetReadout`): desempenho por janela,
  sazonalidade normalizada por ano, termômetro dos indicadores ligados.
- **Correlação entre ativos** (`correlacao.core.ts` + `CorrelationInset`): duas séries em base
  100 num inset SVG mais o coeficiente dos RETORNOS. ⚠️ Sobre retorno e nunca sobre preço — em
  preço, dois ativos que subiram no ano dão quase 1 mesmo tendo subido em meses diferentes.
- **Altura de sub-painel** configurável (`setPaneHeightFraction`), que sobrevive a ligar outro
  indicador.
- ⭐⭐ **ABAS POR ATIVO com estado próprio** (`chart-workspace.core.ts` + `useSymbolWorkspace`):
  uma aba é um DOCUMENTO de gráfico, não um seletor de símbolo. Ver a seção própria abaixo.
- ⭐ **Replay sobre dado REAL** — e a ligação achou um defeito no `useReplay` (ver
  `20-armadilhas.md`): ele reiniciava por IDENTIDADE do array de barras.

⛔ **UMA coisa NÃO existe, e a ausência é declarada:** estrutura a termo de volatilidade
implícita (exige cadeia de opções, que nenhuma base tem).

## ⭐⭐ Grade de sub-painéis em COLUNAS — e a invariante que a tornou possível

Era declarada como impossível sem quebrar o eixo. Existe desde 18/09/2026, e o que a
viabilizou foi trocar a pergunta.

`packages/chart-core/src/pane-grid.core.ts` (PURO) + a interação no motor.
`chart.setPaneGridColumns(1 | 2 | 3 | 4 | 'auto')`, ou `useIndicators({ paneColumns })` no React.

**O pedido:** quatro osciladores empilhados tomavam ~44% da tela. Em duas colunas tomam duas
faixas em vez de quatro, e o preço recupera o resto — sem nenhum indicador encolher.

⭐⭐ **A INVARIANTE:** *toda pane mostra a MESMA JANELA LÓGICA; a coluna só muda a escala
GEOMÉTRICA.* Uma coluna de largura `w` recebe `barSpacing` escalado por `w / larguraTotal`.
A conta fecha por construção:

```
janela = width / barSpacing = (W·k) / (bs·k) = W / bs    ← idêntica, para todo k
```

Consequências, e é por isso que a mudança é pequena onde importa:

- **Não há eixo nem janela por coluna.** Continua UM `ts`, um `leftLogical`, um `times`
  (compartilhado por referência). `getVisibleLogicalRange()` não muda de significado, e
  pan/zoom em qualquer pane movem o gráfico inteiro.
- ⭐ **Com UMA coluna tudo degenera no empilhamento histórico** — `k = 1`. É o que fez as 299
  bancadas de chart-core passarem com 4 chamadas renomeadas e **zero asserção alterada**.
- ⚠️ **O CUSTO, declarado:** a correspondência com o painel de preço deixa de ser
  pixel-a-pixel e passa a ser PROPORCIONAL. Não se encosta mais uma régua vertical do preço
  até a coluna. O que substitui é o **crosshair, que viaja por TEMPO**: `crosshairInPane`
  resolve o instante sob o cursor e pergunta a cada pane onde aquele instante cai NELA. O
  vínculo temporal continua visível, só não é mais uma linha reta contínua.

Decisões que valem lembrar:

- ⚠️ **A pane de PREÇO nunca entra na grade** — sempre largura cheia. As ferramentas de
  desenho ancoram em `paneSize()` (sem índice ⇒ pane 0) e em `timeToCoordinate`; bookmap,
  footprint e perfil calculam faixa lateral e recorte sobre essa largura. Uma pane 0 estreita
  deslocaria toda linha de tendência já salva. E o pedido é sobre a *seção do histograma*.
- **Altura da LINHA = MÁXIMO das frações dos membros.** Todos recebem a altura da linha (senão
  sobra buraco de canvas ao lado do mais baixo), e o maior pedido é honrado.
- **A última linha incompleta ESTICA.** Rejeitado deixar o buraco: canvas vazio não informa, e
  a pane larga é mais legível. Custo declarado: a compressão dela difere das outras.
- ⚠️ **O pedido é RECORTADO pelo que cabe** (mínimo 180 px por coluna, teto 4) e o EFETIVO sai
  em `paneGrid()`. Recorte silencioso faria o operador achar que o controle não funciona.
- `'auto'` deriva de 420 px por coluna confortável (56 são do eixo de preço da coluna).

**Ajuste manual, nos dois eixos** — e ele fechou um defeito antigo:

- Divisória HORIZONTAL move a LINHA INTEIRA (`acima`/`abaixo` são listas de pane).
- Divisória VERTICAL (`ew-resize`) redistribui largura entre colunas vizinhas, com piso de
  120 px.
- ⭐⭐ As duas gravam a **INTENÇÃO** (`heightFractionFixa` / `widthFractionFixa`), então
  **sobrevivem a ligar outro indicador**. Antes o arrasto mexia só no resultado e o próximo
  `rebalancePanes` apagava: o operador ajustava, ligava o RSI, e perdia o ajuste.
- ⚠️ **A divisória vertical VENCE o eixo de preço** (a horizontal não). Na grade o eixo de uma
  coluna ocupa os 56 px finais DELA, e a divisória cai exatamente sobre a borda direita da
  coluna da esquerda — dentro do eixo dela. Uma tem de ganhar: a divisória, porque o alvo dela
  é de 8 px e o eixo mantém os outros 52. O inverso a deixaria INALCANÇÁVEL.

Contrato novo: `PaneRect` (com origem — `PaneSize` não tinha, e sem origem nenhum consumidor
se alinha a uma pane que não começa em 0,0), `paneRectOf`, `setPaneGridColumns`, `paneGrid`,
`setPaneWidthFraction`/`paneWidthFraction`, e **`paneIndex` em `MouseEventParams`** (com panes
empilhadas o consumidor deduzia pelo Y; em colunas, dois sub-painéis dividem a mesma faixa de Y
e deduzir é impossível).

## ⭐⭐ Abas por ativo — uma aba é um DOCUMENTO

`SymbolTabs` já desenhava a barra e `serializeChartState` já capturava o estado. Faltava o
pedaço do meio, que é o que o operador percebe: ele marca o suporte no WIN, vai ao PETR4,
volta, e o suporte não está lá — pior, as marcações do PETR4 continuam desenhadas no gráfico do
WIN, em preços que naquele mercado não existem.

Três camadas, na disciplina do projeto: `packages/engine/src/chart-workspace.core.ts` (regra,
PURO), `packages/react/src/useSymbolWorkspace.ts` (costura), `SymbolTabs` (aparência).

⭐⭐ **A ORDEM É O DEFEITO, e a API a torna inexprimível.** Trocar de aba é gravar o documento
da aba que SAI e ativar a que ENTRA. Invertido — ativar e depois gravar — o estado da aba NOVA
é gravado no slot da ANTIGA: o operador perde o trabalho da aba que acabou de deixar E a aba de
destino é sobrescrita. É a ordem natural de escrever o código (`setAtiva(id)` primeiro, porque é
a linha que muda a tela). Então **use `trocarDeAba` / `abrirEtrocar`**, que recebem o documento
como ARGUMENTO — passar o documento só é possível capturando antes.

Decisões que valem lembrar:

- ⚠️ **`id` é OPACO (`aba-<n>`), nunca derivado de `symbol@periodo`.** Derivar quebra na
  primeira troca de período: a identidade mudaria e a aba ativa deixaria de existir. Símbolo e
  período são ATRIBUTOS. `proximoIdDeAba` é determinístico e **não reaproveita** id de aba
  fechada.
- ⚠️ **Aba nova herda a ANÁLISE, não as MARCAÇÕES** (`documentoParaAbaNova`): vêm o tipo de
  série e os indicadores (EMA 20 significa o mesmo em qualquer instrumento); ficam de fora
  desenhos, alertas e viewport (presos a PREÇO — alerta herdado dispara na hora no ativo novo).
- ⭐ **`duplicarAba` é a única duplicata de conteúdo permitida**, e existe porque sem ela "o
  mesmo ativo em DOIS períodos" é INALCANÇÁVEL pela interface: `abrirAba` deduplica por conteúdo
  de propósito (quem escolhe PETR4 duas vezes quer ir ao PETR4). A cópia leva o documento — é o
  mesmo instrumento, os preços valem.
- `fecharAba` recusa a última (barra vazia = tela sem gráfico e sem volta), elege o vizinho da
  DIREITA, e devolve `destino` non-null **só** quando a fechada era a ativa — é o sinal de "há
  documento a aplicar", e sem ele o consumidor teria de comparar `ativa` antes e depois.
- `MAX_ABAS = 12` **recusa** em vez de fechar a mais antiga: fechar descartaria um documento que
  o operador passou o pregão montando, por causa de um clique num seletor.
- ⭐ `paraGravar()` captura a aba ATIVA antes de serializar. Persistir `serializarAbas(estado)`
  direto grava o documento da última troca — quem nunca troca de aba veria o gráfico voltar no
  tempo ao recarregar.

No playground os estados `fonte`, `ativoMesa`, `tfId` e `ativo` **deixaram de existir**: os
quatro são DERIVADOS da aba ativa. `SIMBOLO_SINTETICO = 'SINTETICO'` é um símbolo como os
outros, e é o que mata o estado impossível "fonte sintética com ativo PETR4".

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
| `@robustus/charts-core` | 16 núcleos puros, compila **sem DOM** (+ **trilha de legendas**, **leitura do ativo**) | herdados + 40 |
| `@robustus/charts-primitives` | `BookmapPrimitive` (2.669 linhas), `FootprintPrimitive`, **`VolumeProfilePrimitive`** (histograma por LINHA) | herdados + 22 |
| `@robustus/chart-core` | motor de renderização próprio em canvas (eixo, escala, panes, interação) | herdados |
| `@robustus/charts-datafeed` | contrato agnóstico + dia de mercado + HTTP bars/depth + WS ao vivo + agregador + vocabulário de TIMEFRAME + ⭐ **fonte de barras da MESA** (histórico real) | ~168 |
| `@robustus/charts-indicators` | 29 indicadores incrementais (warmup+update+preview O(1)), registry | 79 |
| `@robustus/charts-drawings` | 8 ferramentas, hit-test, histórico, persistência | 105 |
| `@robustus/charts-engine` | motor sem framework + persistencia de layout + templates nomeados + ⭐⭐ **abas por ativo** (`chart-workspace.core.ts`) | 18 + 28 + 48 |
| `@robustus/charts-react` | hooks (`useChartEngine`, `useDrawings`, `useIndicators`, `useAlerts`, `useReplay`, `useCrosshair`, `useChartState`, `useHistoryBackfill`, `useChartSync`, `useLayerLegends`, `useVisibleTimeRange`, ⭐⭐ **`useSymbolWorkspace`**) + UI própria (`ChartToolbar`, `DrawingToolbar`, `IndicatorToolbox`, `CommandPalette`, `ChartLegend`, `TimeframeSelector`, `SymbolTabs`, `ChartGrid`, `AssetReadout`, `ObjectTree`, `CorrelationInset`) + **`<ChartProvider>`** | ~300 |
| `@robustus/charts-alerts` | motor PURO de alerta de preço, máquina ARMED→TRIGGERED sem repique; condições CROSS/TOUCH/ENTER_ZONE/EXIT_ZONE/PERCENT_CHANGE/**SERIES_CROSS**; `AlertStore` | 46 |
| `@robustus/charts-replay` | controlador de replay de mercado determinístico, `TimerLike` injetado, pausa no fim sem loop | 31 novos |
| `@robustus/charts-devtools` | bancada de desempenho | herdados |

```
npm test            # 2401 testes, 116 arquivos
npm run build       # todos os pacotes
npm run verify      # ⭐ typecheck + typecheck:playground + check ESM + testes
npm run smoke:consumo  # empacota, instala FORA do workspace e importa em Node ESM puro
```

⭐ **Use `npm run verify`, não só `npm test`.** Ele encadeia o type check dos
pacotes, o type check do playground, o `--check` de extensão ESM e a suíte. Cada
etapa existe porque a ausência dela já deixou passar defeito real: sem o type check
do playground o Vite compilava tipo errado em silêncio (ver *Playground local*).

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

⭐ Dívida FECHADA: `removePane` existe no motor. Alternar osciladores não deixa
mais pane órfã — a pane é removida junto com sua série ao desligar o indicador.

### Os 29 — e as decisões dos nove últimos

Entraram nesta rodada: **SuperTrend** (ATR de Wilder, travagem pelo fechamento
anterior), **Parabolic SAR**, **Ichimoku** (5 saídas), **Donchian**, **VWAP com
bandas**, **MFI**, **CMF** (Chaikin Money Flow), **Awesome Oscillator** e
**Pivot Points** (clássico).

- ⚠️ **Ichimoku emite SEM deslocar** e publica `displacement` no meta. Deslocar por
  dentro mentiria em silêncio: quem consome a saída não teria como saber que o tempo
  da amostra não é o tempo da barra. Quem quiser a nuvem projetada aplica o
  deslocamento na plotagem, sabendo o que faz.
- ⚠️ **VWAP com bandas é fábrica NOVA (`vwap_bands`), não opção do `vwap`.** Alterar
  o `vwap` existente mudaria o layout já salvo por quem persistiu estado — o
  `OutputSpec` dele ganharia saídas que o estado antigo não conhece.
- **Pivot Points** detecta virada de dia por `floor(time / 86400)`. Os níveis são
  núcleos puros exportados (`pivotLevels`, `pivotLevelsFromBars`), utilizáveis fora
  do contrato incremental.
- `MinMaxWindow` foi extraído para `rolling.core.ts` — Donchian e Ichimoku precisavam
  do mesmo acumulador de mínimo/máximo rolante, e duas cópias divergiriam.

A guarda de contagem dos property tests subiu para **>= 29**: indicador novo que não
respeite *incremental == batch* reprova, e indicador esquecido no registry também.

### ⭐⭐⭐ A CONFERÊNCIA DE VALOR, e por que o property test não bastava (18/09/2026)

⛔ **O property test *incremental == batch* NÃO pode achar erro de fórmula** — ele roda o mesmo
código nas duas pontas da igualdade. Vinte dos 45 indicadores tinham só ele. Conferidos contra
uma referência independente, **três estavam errados**, mais um defeito de empacotamento que valia
mais que os três.

⭐⭐ **Dezesseis fábricas de 45 não eram EXPORTADAS pelo índice.** Eram importadas (para entrar
em `builtInFactories` e no `registry`) e nunca reexportadas: `delta`, `cvd`, `delta_ratio`, `hma`,
`vwma`, `kama`, `lsma`, `trix`, `ppo`, `stoch_rsi`, `aroon`, `chop`, `bop`, `adl`, `force_index`,
`elder_ray`. `import { adlFactory } from '@robustus/charts-indicators'` não compilava. São as duas
famílias mais recentes, e o fluxo de ordem é o **diferencial** desta biblioteca. Acrescentar
fábrica exige tocar em quatro lugares, e a lista de export é o único cujo esquecimento **não
quebra nada visível**: o registry funciona, os property tests passam, o playground desenha. Guarda
mecânica: `__tests__/indice-exporta-tudo.spec.ts`, que compara por `meta.name` e não por lista
escrita à mão.

⚠️ O lote 3 tinha contornado o sintoma importando VWMA e LSMA do módulo, com a hipótese de "ciclo
de importação". A causa era mais simples e pior.

**Os três defeitos de fórmula:**

- ⭐⭐ **KAMA**: o numerador do Efficiency Ratio media um período MAIS que o denominador
  (`RingWindow(n+1)` lido antes do `push` dá `x[i−n−1]` contra `n` variações somadas). O ER
  passava de 1 numa tendência limpa — `(n+1)/n = 1,1` no caso monotônico — e `sc` estourava o
  limite rápido em **19 %**: a KAMA mais rápida do que o parâmetro autoriza, indistinguível de "o
  mercado estava eficiente". **TERCEIRA** vez que o mesmo erro de janela aparece (ROC e Momentum
  usavam `period + 1`). ⭐ O teste que o pegou não usa tabela nenhuma: **numa RETA o ER é 1, por
  definição.**
- ⭐⭐ **ADX**: a primeira barra empurrava `plusDM = 0` e `minusDM = 0` nas três médias de
  Wilder. Movimento direcional exige barra anterior — em N barras existem N−1 valores, e fabricar
  zero é amostra falsa dentro da semente. Medido: **17,40 contra 13,90** na primeira emissão
  (25 % de erro), e a memória de Wilder ainda guarda 23 % do desvio 20 barras depois. Enviesado
  para **cima**, que é o lado que faz ler tendência onde não há.
- ⭐⭐ **Stoch RSI**: o RSI interno era `EmaState(2n−1)` em vez de `WilderState(n)`. A razão de
  suavização coincide (`1/n`) mas a **semente** não — média dos 27 primeiros ganhos contra 14.
  O RSI interno era **outro número** que o `rsiFactory` publica no MESMO gráfico, e o %K só emitia
  no índice 42 em vez de 29 (mais de 3 h de pregão em 15 min).

**O método, e ele é reutilizável:** `__tests__/referencia-batch.ts` implementa cada indicador
**em lote, da definição**, sem estado rolante — todo defeito de acumulador é inexprimível nela, e
é a classe dos defeitos achados. E ela própria é **PINADA** por âncoras literais calculadas fora,
em Python: sem isso, referência e implementação poderiam carregar o mesmo mal-entendido e
concordar em silêncio.

⚠️ **A série do lote 3 não servia.** Com `open === close`, **BOP e ADL são identicamente zero**
(`C−O` é zero e `(C−L)−(H−C)` é zero num pavio simétrico) — testá-los ali daria verde provando
nada. O lote 4 tem série com OHLC de verdade, pavios assimétricos e volume por agressor. E cada
`conferir` exige um **piso de pontos comparados**, senão um indicador que devolvesse `null` para
tudo passaria calado.

## Grafo de dependência — não viole

```
core          (zero dependência, lib SEM DOM)
chart-core    (motor em canvas; sem terceiros; lib com DOM)
 ├── primitives    (+ chart-core, SÓ por tipo)
 ├── datafeed      (+ nada; fetch é injetado)
 └── drawings      (+ chart-core, tipo e runtime)
engine        (core + chart-core + primitives; usa createChart do chart-core)
 └── react        (+ drawings, alerts, replay, para os hooks opcionais)
devtools      (core + primitives) — não entra em aplicação

alerts        (INDEPENDENTE — zero dependência, lib SEM DOM, motor puro)
replay        (INDEPENDENTE — zero dependência; tipo ReplayBar local, TimerLike injetado)
```

⭐ `alerts` e `replay` são **ilhas**: não importam nenhum irmão nem terceiro. Cada um
carrega seu próprio tipo (`ReplayBar` no replay) de propósito, para não amarrar quem
os consome à camada de dado. Quem os liga ao ciclo React são hooks OPCIONAIS
(`useAlerts`, `useReplay`) — o motor não os conhece, pela mesma regra 4: recurso
opcional não pode custar peso a quem não o usa.

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

## Persistência de layout

`charts-engine` ganhou `chart-state.core.ts`: `serializeChartState` /
`deserializeChartState`, versionados por `CHART_STATE_SCHEMA_VERSION = 1`. Persiste o
ESTADO COMPLETO do gráfico — tipo de série, indicadores + params, alertas, desenhos e
viewport. A leitura **valida**, recusa estado PARCIAL e **nunca lança** (falha vira
valor de retorno, na disciplina da camada).

⚠️ **Importante para o grafo (regra 4 segue intacta):** o engine **não** passou a
importar `drawings`. O documento de desenho é tratado como bloco **OPACO**
(`DrawingsDocumentLike`) — o núcleo só o carrega e devolve, sem entender seu formato.
A costura com o `serialize` real do pacote de desenho vive na camada React, em
`useChartState`. Assim recurso opcional não custa peso a quem não o usa.

18 testes novos em `engine/__tests__/chart-state.core.spec.ts`.

## ⭐ Escalas de preço múltiplas — o defeito que deixava o gráfico VAZIO

O conhecimento mais caro desta rodada. **Sintoma:** o usuário fotografou o
playground e não havia **nenhuma vela na tela**; o eixo de preço marcava
20.000..120.000 enquanto os alertas disparavam em 130.100.

**Causa:** o motor tinha **UMA escala de preço por pane**, e o `priceScaleId` das
séries era **IGNORADO**. Dois efeitos somados:

- `autoScalePane` tomava min/max de **TODAS** as séries juntas. O histograma de
  volume (0..40.000) entrava no mesmo cálculo do preço (~130.000), a faixa virava
  0..130.000 e as velas ficavam esmagadas em poucos pixels no topo — visualmente
  ausentes.
- `priceScale(id)` ignorava o id e devolvia sempre a escala do preço. Mandar o volume
  para o pé do painel com `scaleMargins { top: 0.85 }` comprimia o **PREÇO**.

**Correção:** cada `Pane` tem agora `priceScale` (a principal, id `'right'`) mais
`overlayScales: Map<string, PriceScaleState>`. A autoescala passou a ser **POR
ESCALA** (`autoScaleGroup`), não por pane. `renderPane` recebe
`series: ReadonlyArray<{ model, scale }>` — cada série carrega a escala à qual
pertence.

⚠️ **Grupo só de histograma ANCORA EM ZERO.** Sem isso a menor barra teria altura
zero e a base do desenho cairia fora da escala: o piso do histograma é o zero, não o
mínimo observado.

10 testes em `packages/chart-core/src/__tests__/escalas-de-overlay.spec.ts`, e um
deles documenta o **MECANISMO**: série sem `priceScaleId` contamina a faixa de novo.
É o teste que reprova se alguém "simplificar" a autoescala de volta.

## Motor de renderização — PRÓPRIO, zero terceiros

⚠️ **Atualizado.** O projeto começou sobre `lightweight-charts` (Apache 2.0), mas
por decisão do usuário — "nada de terceiros" — isso foi **substituído por motor
próprio**, `@robustus/chart-core`, em canvas puro. Não há mais nenhum
`lightweight-charts` nem `fancy-canvas`, nem em runtime, nem em `node_modules`.

O motor entrega o que o terceiro entregava: eixo de tempo com sessão irregular
(espaço lógico contínuo — velas equidistantes, fim de semana não ocupa espaço),
autoescala de preço pela janela visível, pan/zoom, crosshair, sub-painéis
empilhados, e o contrato de `ISeriesPrimitive`.

Acréscimos recentes ao motor (feitos aqui, nunca de terceiro):

- **Marcadores com FORMA real.** `drawMarkers` honra `shape` (`circle`, `square`,
  `arrowUp`, `arrowDown`) mais `text` — antes desenhava só círculo.
- **`SeriesType 'Band'`** — `drawBand` preenche a região entre `upper` e `lower`
  com alpha 0.12. É o que Bollinger e Keltner usam, via `OutputSpec.band`
  (`'upper'` | `'lower'` | `'middle'`).
- **Formatação de preço por tick.** `price-format.core.ts`
  (`formatPrice`/`roundToTick`/`decimalsFromTick`, `PRICE_PLACEHOLDER='—'`) e
  `ChartOptions.rightPriceScale.priceFormat` (`{ precision?, tickSize? }`), aplicado
  tanto no eixo de preço quanto no rótulo do crosshair.
- **OHLC no crosshair.** `MouseEventParams.seriesData` traz O/H/L/C (ou `value`) da
  barra sob o cursor — é a base da legenda.
- **Rótulos de data no eixo** já existem (era pendência do v1).
- **Exportar imagem.** `takeScreenshot()` devolve um canvas **NOVO**, `toDataURL()` a
  string; ambos `null` quando não há rasterização. ⚠️ O jsdom tem `toDataURL` que
  **não lança** e devolve `undefined` — então o retorno é validado por prefixo
  `data:`, nunca por "não lançou".
- **PINÇA em touch.** Rastreio de múltiplos ponteiros com zoom **absoluto contra o
  INÍCIO do gesto**. ⚠️ A versão incremental deixava translação residual de 3,33
  barras **na direção contrária**, porque o navegador entrega `pointermove` de um
  ponteiro por vez: cada evento via a distância mudar por metade do movimento real.
- **Divisória de pane arrastável.** Faixa de acerto de ±4 px, cursor `ns-resize`,
  piso de 40 px por pane (abaixo disso a pane não caberia nem no eixo).
- **Grade vertical opcional.** Antes a opção existia e **não fazia nada**. Agora sai
  de `visibleTickIndices`, a **fonte ÚNICA** compartilhada com os rótulos de tempo —
  duas fontes divergiriam e a linha apareceria fora do rótulo.
- **Watermark central**, desenhada atrás das séries.
- **Ticks logarítmicos.** Potências de 10 com subdivisões 1/2/5, quase uniformes em
  log. ⚠️ O passo linear aplicado em escala log deixava **uma década inteira sem
  rótulo**.

A troca foi possível porque o contrato de `chart-core` foi desenhado **compatível**
com o do terceiro: bookmap, footprint e desenho consumiam aquele contrato por tipo,
e trocar o motor foi trocar o import (`'lightweight-charts'` → `'@robustus/chart-core'`),
sem uma linha de lógica alterada. Os 703 testes provam isso.

⚠️ O motor v1 é mais simples que o `lightweight-charts` maduro. Do que faltava,
sobrou **animação de transição**. São acréscimos **aqui**, nunca volta a terceiro. Se
algo faltar, implemente no `chart-core`. (Rótulos de data no eixo, marcadores com
forma, banda preenchida, formatação de preço, **pinça em touch**, **ticks
logarítmicos**, **exportar imagem**, divisória arrastável, grade vertical e watermark
já foram feitos — ver acima. E escalas de preço múltiplas, ver a seção anterior.)

Verificação de que não há terceiro:
```
grep -rn "from 'lightweight-charts'\|from 'fancy-canvas'" packages/*/src apps/*/src
# deve ser vazio
```

## Tipos de gráfico — transformação de dado vs. tipo de série

Duas naturezas distintas, não confundir:

- **Heikin-Ashi e Renko são transformação de DADO**, não tipo novo de série. Vivem em
  `packages/chart-core/src/candle-transforms.core.ts` (`heikinAshi(velas)`,
  `renko(velas, brickSize)`, `brickSizeAutomatico(velas, fracao=0.002)`), são núcleos
  puros que derivam `CandlestickData` a partir das velas e **plotam como
  `'Candlestick'`**. O motor não sabe que existe Heikin-Ashi: recebe velas comuns.
- **Bar (barras OHLC) é um `SeriesType` do motor** — `'Bar'`, desenhado por `drawBars`
  no renderer. É tipo de série, não transformação: os mesmos dados OHLC, outra
  rasterização.

## Bookmap — diagnóstico DESLIGADO por padrão

O texto de diagnóstico que o bookmap escrevia sobre o gráfico ("p50 0 ct · p99 0 ct ·
escala da janela visível", "Cobertura não verificada · fila não informado") era a
poluição visível na foto do usuário. É informação de desenvolvimento, não de mesa.

Nova opção `mostrarDiagnostico?: boolean`, default **`false`**. A **legenda**
continua ligada — identidade do ativo e significado da cor são leitura necessária — e
ganhou **caixa opaca** de contraste (`packages/primitives/src/text-box.ts`), porque
texto claro sobre célula clara ficava ilegível.

⚠️ **A caixa é desenhada por CAMINHO** (`beginPath` / `rect` / `fill`), **nunca**
`fillRect`. As bancadas herdadas contam chamada de `fillRect` como "célula
desenhada" — usar `fillRect` na caixa inflaria a contagem e quebraria medição que não
tem nada a ver com legenda.

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

### ⭐ O playground tem TYPE CHECK — e ele pegou defeito real

Antes só o Vite rodava aqui, e o **Vite (esbuild) não verifica tipo**: erro de tipo
passava silencioso até virar defeito em tempo de execução. `apps/playground` agora tem
`tsconfig.json` próprio (`noEmit`), e na **primeira execução ele pegou dois defeitos
reais**.

⚠️ Esse tsconfig usa **`moduleResolution: Bundler`**, o **oposto** dos pacotes
(`NodeNext`) — e é de propósito. O app **é** consumido por bundler, e os alias do Vite
apontam para `packages/*/src` sem extensão. A regra de extensão `.js` explícita das
convenções vale para os **pacotes**, que precisam rodar em Node ESM; não para o app.

Scripts na raiz: `typecheck:playground` e `verify` (typecheck + typecheck:playground +
check de extensão ESM + testes).

## ⭐ Rodada de 17/09/2026 — o que entrou, e os defeitos que ela achou

Sete pedidos do operador, e **cinco defeitos reais** encontrados no caminho. Os
defeitos importam mais que os recursos: cada um era silencioso.

### Os defeitos

**1. Renko mostrava UMA barra.** `brickSizeAutomatico` derivava o tijolo de uma
FRAÇÃO DO PREÇO (0,2% de 130.000 = 259,4), e a série do playground tem amplitude de
645 pontos em 240 velas ⇒ **2 tijolos**. Medido: fração do preço ⇒ 2; amplitude média
(`high-low`) ⇒ 10; **variação média do close ⇒ 98**. Adotada a variação do close,
porque o `renko` desta biblioteca é construído sobre CLOSES (a amplitude com pavio
superestima ~4x). A raiz era conceitual: **o nível do preço não diz nada sobre o
quanto ele se move**.

⚠️ A assinatura virou `(velas, { multiplo })` de propósito: o call site antigo
`(velas, 0.002)` **falha em compilação** em vez de virar tijolo de 0,06 em silêncio.

**2. Renko sobrescrevia tijolo ao vivo.** Vários tijolos fechados na mesma barra
carregavam o mesmo `time`, e o motor assume tempo único em três lugares —
`SeriesImpl.update` (time igual = mesma barra ⇒ substitui), `timeToIndex` (resolve
para o primeiro índice) e os rótulos do eixo. Agora `time = max(tempo da barra,
último + 1)`.

**3. `unsubscribeClick`/`unsubscribeCrosshairMove` não existiam.** `useCrosshair`
tinha um comentário admitindo que não dava para remover o ouvinte; com um `onMove`
literal em JSX, acumulava **um ouvinte por render** no mesmo motor. O contrato ganhou
os dois (idempotentes por `Set.delete`).

**4. `setData()` + `fitContent()` síncronos NÃO enquadravam.** `ts.times` só era
preenchido no `render` (agendado por rAF), então `fitContent` saía com `n === 0` e o
quadro seguinte aplicava a heurística de primeira carga. `transicaoDeEixo` agora
chama `rebuildTimes()` ANTES da mutação — e com isso a intenção explícita do
consumidor vence o palpite do motor.

**5. `useAlerts` entrava em LAÇO INFINITO com `bars` literal.** O reinício era
decidido pela IDENTIDADE do array; um `bars={[...]}` em JSX era lido como "trocou de
ativo" a cada render ⇒ re-armava, re-alimentava tudo e chamava `setState`, que causava
outro render. Travou o processo de teste por 120 s. Agora decide por CONTEÚDO (tempo
da primeira barra + tempo da última alimentada), e o ramo "nada novo" não chama
`setState`.

### Os recursos

- **Clicar no indicador abre as propriedades dele.** `IChartApi.seriesAt(point, tol)`
  responde qual série está sob o pixel; `IndicatorPlotter.plotIdOfSeries` traduz série
  para indicador; `useIndicators({ onIndicatorClick })` costura; `IndicatorToolbox`
  ganhou `openIndicator`. ⭐ Empate resolvido por PRIORIDADE antes de distância —
  traço vence região, senão a resposta dependeria da ordem de inserção das séries.
- **Perfil de volume (histograma por LINHA)** em faixa lateral própria, com POC e área
  de valor atravessando o painel. `margemInferiorFracao` é a **separação de
  ambientes** com o histograma por COLUNA.
- **Seleção de período.** `timeframe.core.ts` no datafeed (segundos são a verdade,
  rótulo é apresentação) + `TimeframeSelector` no React (rápidos como botão, o resto
  em menu).
- **Multi-período/multi-ativo na tela.** `ChartGrid`, `SymbolTabs`, `useChartSync`.
  ⭐ A sincronia viaja por TEMPO, nunca por índice lógico.
- **`ChartProvider`** — o motor num contexto, para parar de passá-lo de mão em mão.
- **Backfill de histórico** (`useHistoryBackfill` + `onBarsPrepended` no motor), com a
  posição da tela preservada pelo motor.
- **Alerta de cruzamento de DUAS séries** (`SERIES_CROSS`), que descobriu um defeito
  no re-armamento: condição de TRANSIÇÃO agora re-arma na hora (`ehInstantanea`).
- **Animação de transição de eixo**, DESLIGADA por default — `fitContent()` seguido de
  `timeToCoordinate()` é par síncrono por contrato, e animar por default o faria
  mentir.
- **Esconder série/indicador de verdade** (`visible` na série, `setPaneVisible` na
  pane) e **trocar cor sem recriar série** (`applyColors`).
