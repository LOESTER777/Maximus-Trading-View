---
inclusion: manual
---

# Trabalho paralelo com agentes crew

Ativação: `#30-trabalho-com-crew` no chat.

Este projeto foi organizado para que trabalho seja dividido entre agentes sem que
eles se atropelem. O que segue é o mapa de fronteiras e o protocolo.

## Por que este projeto se divide bem

O grafo de dependência é acíclico e as fronteiras são mecânicas, não convencionais:

- `core` compila **sem DOM** — quem trabalha nele não pode nem acidentalmente tocar
  em tela;
- `primitives` importa o substrato **só por tipo** — verificável no artefato;
- cada `*.core.ts` é puro, com insumo por parâmetro;
- 703 testes, e 519 deles herdados da origem, servem de rede para qualquer mudança.

Isso significa que dois agentes podem trabalhar em pacotes diferentes com baixa
chance de conflito **desde que respeitem o grafo**.

## Fronteiras seguras para paralelizar

| Frente | Pacotes | Toca em |
|---|---|---|
| Sub-painéis (RSI/MACD com `addPane`) | `engine` | `chart-engine.ts`, `types.ts` |
| Indicadores no cliente | novo `indicators` | nada existente |
| Adaptadores de datafeed | `datafeed` | só arquivos novos |
| Persistência de layout | `drawings` + novo | `serialize.core.ts` |
| Ferramentas de desenho novas | `drawings` | `model.ts`, `render-plan.core.ts`, `hit-test.core.ts` |
| Playground / exemplo | novo `apps/playground` | nada |

⚠️ **Não paralelize** mudanças em `core` com mudanças em `primitives`: o segundo
consome tipos do primeiro, e uma alteração de contrato quebra o outro no meio do
trabalho.

## Protocolo mínimo

1. **Antes de começar:** `npm test` precisa estar verde. Se não estiver, descubra
   por quê antes de acrescentar código — não empilhe mudança sobre suíte vermelha.
2. **Um pacote por frente.** Se a mudança exige tocar dois pacotes, ela é uma frente
   só e não deve ser dividida.
3. **Ao terminar:** `npm run build && npm test`. Os 703 precisam continuar passando.
   Teste herdado que quebra é sinal de mudança de comportamento, não de teste velho.
4. **Commit por frente**, com a mensagem explicando a **decisão** e o que foi
   medido. O histórico deste repositório é documentação; mantenha o padrão.

## Para o agente que investiga (context-gatherer)

Perguntas que já foram respondidas e não precisam de nova investigação — estão em
`#20-armadilhas`:

- o que o substrato oferece e o que não oferece (hit-test, eventos, panes);
- por que `timeToCoordinate` não serve para âncora de desenho;
- por que não há quadtree;
- as medições de desempenho e de tamanho de payload;
- as limitações do feed MBO do provedor.

O que **vale** investigar do zero:

- o projeto `Trading` (origem) — mas **somente leitura**, e o `frontend/` é o que
  interessa;
- o `CopyTrader`, que desenha gráfico à mão em SVG e canvas e é o primeiro candidato
  a consumir esta biblioteca;
- qualquer coisa em `packages/` que este steering não cubra.

## Para o agente que executa (general-task-execution)

Regras que não são negociáveis, e por que:

- **Nunca escreva em `/media/rust/UTIL/Projetos/Trading`.** É fonte somente leitura.
  Já houve confusão: aquele repositório tem trabalho paralelo do usuário em
  `src/b3-tick-pipeline`, e uma escrita nossa ali se misturaria ao dele.
- **Não renomeie identificador de código copiado.** Destrói a suíte herdada, que é a
  única prova de que a extração preservou comportamento.
- **Não instale o pacote `canvas`** para "consertar" o jsdom. A ausência de contexto
  2D é requisito: as bancadas declaram medir tudo menos rasterização.
- **Todo import relativo leva `.js`.** Rode
  `node scripts/add-esm-extensions.mjs --check packages/*/src` antes de commitar.
- **Não mova `packages/devtools/pending-adaptation/`** para dentro de `src/`. Está em
  quarentena por razão documentada no README de lá.

## Para o agente de revisão (semantic_reviewer)

O que olhar com atenção neste código, em ordem de risco:

1. **Conversão de coordenada.** Qualquer uso novo de `timeToCoordinate` para âncora
   de desenho é defeito. Deve passar por `chart-converters.ts`.
2. **Chave de invalidação de cache.** Época de viewport sem tamanho de painel ou sem
   preços de borda produz hit-test respondendo em coordenada velha — sintoma
   silencioso e difícil de reproduzir.
3. **`save`/`restore` de canvas sem `finally`.** Vaza estado para a camada seguinte.
4. **`throw` em caminho de desenho.** Derruba o gráfico inteiro.
5. **`null` trocado por `0`.** Zero é coordenada válida; o elemento aparece onde não
   está.
6. **Prioridade de hit-test invertida.** Quebra redimensionamento de forma que só
   aparece quando a alça está sobre preenchimento.

## Estado e dívida conhecida

Registrado para ninguém redescobrir:

- **`packages/devtools/pending-adaptation/`** — `independence-check` em quarentena,
  com 5 acoplamentos estruturais à origem listados no README de lá. O motor
  (`.core.ts`) é reutilizável; a política não.
- **4 testes da origem não copiados** — `useBookmapCoverage.spec`,
  `useBookmapDepth.spec`, `p10-flag-off-byte-identico` (dependem dos hooks, agora
  substituídos por `datafeed`) e `p11-ciclo-de-vida-primitive` (dependia do
  `TradingChart`, agora `engine`). Listados em
  `scripts/copiar-suite-da-origem.mjs`.
- **Sem sub-painel real**, sem persistência de layout, sem template nomeado.
- **Sem remote git.** O repositório é local. Para publicar: SSH funciona nesta
  máquina (`ssh -T git@github.com` responde `Hi LOESTER777!`), e é preferível a PAT.
