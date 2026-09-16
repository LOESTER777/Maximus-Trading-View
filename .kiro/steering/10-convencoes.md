# Convenções — como escrever código aqui

## Idioma

**Comentários e documentação em pt-BR. Identificadores em inglês, quando novos.**

⚠️ Os núcleos copiados têm identificadores em português (`agregarFootprint`,
`RAMPA_TERMICA`, `VelaFootprint`). **Não renomeie.** Eles foram copiados verbatim de
propósito: junto veio a suíte que os prova, e renomear 500 KB destruiria a rede de
segurança que torna a extração verificável.

O índice de cada pacote publica **as duas grafias** — a original e um apelido em
inglês via `export { x as y }`. Mesmo símbolo, custo zero em runtime. Código novo
usa inglês; código copiado fica como está.

## Sufixo `.core.ts` — é contrato, não estilo

Arquivo `*.core.ts` é **puro**: função total e determinística, sem DOM, sem relógio,
sem sorteio, sem I/O, sem estado de módulo. Todo insumo chega por parâmetro.

É por causa dessa disciplina que a extração da origem foi possível — os núcleos não
sabiam que existia canvas. Ao criar arquivo novo, respeite: se ele precisa de tela,
ele não é `.core`.

## ESM com extensão explícita

Todo import relativo leva `.js`, mesmo apontando para `.ts`:

```ts
import { algo } from './outro-modulo.js';
```

Não é capricho. Com `moduleResolution: Bundler` o `dist` emitido quebra em Node ESM
com `ERR_MODULE_NOT_FOUND` — medido, não suposto. Uma biblioteca não pode assumir
bundler: SSR do Next, teste em Node puro e ferramenta de linha de comando todos
passam pelo Node.

Verificação: `node scripts/add-esm-extensions.mjs --check packages/*/src`

Arquivos de teste são exceção — são excluídos do build, e o Vitest resolve sem
extensão.

## Imutabilidade onde há histórico

`Drawing` e `DrawingsState` são `readonly` por inteiro. Editar produz objeto novo.

Não é preferência: o histórico de desfazer guarda referências, e mutação no lugar
corromperia estados passados em silêncio — o usuário desfaria e receberia de volta o
estado já alterado.

## Falha é valor de retorno, não exceção

Nas camadas que alimentam desenho, `throw` é proibido. Devolva resultado
discriminado (`FeedResult`) ou `null`.

O motivo é concreto: exceção não tratada dentro do ciclo de desenho derruba o
gráfico inteiro. E "não há dado" é resposta legítima e frequente — dia sem pregão,
ativo sem livro, plano do provedor sem profundidade. Modelar isso como erro
transforma o caminho normal em caminho de exceção.

`null` significa **"não sei"**, e nunca zero. Zero é uma coordenada válida (a borda
esquerda do gráfico) e o elemento apareceria onde não está.

## Camada de visualização não derruba o gráfico

Toda `draw()` e todo recálculo de plano vão dentro de `try`. Exceção esvazia a camada
e segue.

`ctx.save()`/`ctx.restore()` sempre em par, com o `restore` em bloco `finally`:
exceção no meio deixaria `lineDash`, `strokeStyle` e clip vazando para a camada
seguinte.

## Documentar o POR QUÊ, e o defeito que motivou

O padrão do código herdado, e que deve continuar: comentário explica a **decisão** e
a **medição ou o incidente** que a motivou, não o que a linha faz.

Exemplos reais no código:

- `BOOKMAP_MIN_CELL_PX_DEFAULT = 2` — "com 3 o operador descreveu como *nosso
  bookmap está parecendo um lego*; não desce a 1 porque o antialias apaga a célula".
- escala de cor por percentil — "p50=481, p90=714, p99=1131, **max=36.232**;
  normalizar pelo máximo daria 2% de opacidade ao p90".
- `isValidCandle` — "o teste era `c.time != null`, e `NaN != null` é `true`".

Um `⚠️` marca armadilha; um `⭐` marca a parte que importa mais. Use.

## Teste

- **Vitest**, ambiente `jsdom` obrigatório. `fast-check` para propriedade.
- `jsdom` não tem contexto 2D, e isso é **requisito**, não limitação: as bancadas
  declaram medir tudo menos a rasterização. Não instale o pacote `canvas`.
- `vitest.setup.ts` preenche `matchMedia`, `ResizeObserver` e `getContext`. Sem ele
  eram 63 rejeições não tratadas em 18 testes — ruído que afoga erro de verdade.
- Desempenho: **meça e imprima**, com limite folgado. Limite apertado em máquina
  compartilhada falha por vizinho barulhento, e teste que falha por acaso é
  ignorado. O objetivo é reprovar regressão de ordem de grandeza.
- Ao encontrar defeito, escreva o teste que reproduz o **mecanismo**, não só o
  resultado. Ver `consistencia.spec.ts`, que simula o `timeToCoordinate` devolvendo
  `null`.

## Git

Identidade **local** do repositório: `LOESTER777 <loester.rodrigo@gmail.com>`. O
`~/.gitconfig` global não tem `user.name`/`user.email`, e esse é o padrão correto
desta máquina — não conte com o global.

Antes de commitar, varra segredo no **índice** (`git diff --cached --name-only`), que
é a verdade do que vai ao commit — `git status --porcelain` colapsa diretório novo
numa linha só e mede menos.

⚠️ Varredura de segredo em código português tem um buraco conhecido: o padrão
`senha` casa dentro de "de**senha**r". Use padrão que busca **valor** atribuído, não
palavra solta.
