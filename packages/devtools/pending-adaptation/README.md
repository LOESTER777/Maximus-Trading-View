# Quarentena — `independence-check`

Três arquivos copiados da origem que **não foram adaptados** e por isso não
participam do build nem da suíte:

| Arquivo | Linhas | O que é |
|---|---|---|
| `independence-check.core.ts` | 1.031 | Motor de varredura. **Puro, zero dependência, genuinamente reutilizável.** |
| `independence-check.runner.ts` | 1.327 | Configuração e execução. **Amarrado ao repositório de origem.** |
| `independence-check.spec.ts` | 747 | 34 testes: 27 do motor (passavam aqui), 7 da árvore real (falhavam). |

## Por que estão em quarentena, e não integrados

Este é um **instrumento de governança do processo de spec do projeto de origem**,
não uma capacidade da biblioteca de gráficos. Ele responde à pergunta "as linhas
que esta feature escreveu referenciam camada de conexão, envio de ordem ou estado
de conta?" — e responde isso *contra o histórico git e o layout de diretórios
daquele repositório*.

O acoplamento é estrutural, não cosmético:

1. **SHA de commit de outro repositório.**
   `REF_LINHA_DE_BASE = 'd928846d302f797c701bd1e1369a9f0edb700eda'`
   (`runner.ts:167`) é o `HEAD` de quando a feature começou no projeto Trading.
   Não existe neste repositório.

2. **Caminhos do repositório de origem como raiz da feature.**
   `RAIZES_CRIADAS = ['frontend/src/components/decision/bookmap', ...]`
   (`runner.ts:179-180`).

3. **Arquivos de um backend NestJS que não existe aqui.**
   `src/bookmap/bookmap.service.ts`, `src/bookmap/bookmap.controller.ts`,
   `src/bookmap/live-book-persistence.service.ts` (`runner.ts:199-246`). Esta é
   uma biblioteca de front-end: esses arquivos não têm equivalente.

4. **Dedução de raiz por contagem de níveis.**
   `raizPadrao()` (`runner.ts:410-412`) sobe **cinco** níveis, porque o arquivo
   morava em `frontend/src/components/decision/bookmap`. Aqui moraria em
   `packages/devtools/src`, que são três.

5. **Os próprios testes afirmam os caminhos da origem como valor esperado.**
   `ESTE_ARQUIVO = 'frontend/src/components/decision/bookmap/__tests__/independence-check.spec.ts'`
   e `RAIZ_DA_FEATURE = 'frontend/src/components/decision/bookmap/'`
   (`spec.ts:117-122`). Não é configuração — é asserção.

Deixar isso rodando vermelho por motivo ambiental é pior que quarentena: treina
quem olha a suíte a ignorar vermelho.

## A biblioteca já tem garantia mais forte, e mecânica

O que o `independence-check` verifica por varredura de texto, aqui é garantido
pelo compilador e verificável no artefato:

- **`packages/core`** compila com `"lib": ["ES2020"]`, **sem DOM**
  (`packages/core/tsconfig.json`). Um `document`, `window` ou `fetch` acidental é
  erro de compilação, não achado de varredura.
- **`packages/primitives`** importa `lightweight-charts` e `fancy-canvas`
  exclusivamente por `import type`. Verificável no emitido:
  ```bash
  grep -nE "^\s*(import|export)[^*]*from ['\"]" packages/primitives/dist/*.js
  ```
  Nenhuma linha cita o substrato — só `@robustus/charts-core`.

## Como adaptar, se e quando fizer sentido

O motor (`independence-check.core.ts`) vale a pena; a política não. O trabalho é:

1. Mover só o `.core.ts` para `packages/devtools/src/` e exportá-lo.
2. Escrever um runner novo com a política **desta** biblioteca: quais pacotes
   podem importar o quê. O alvo natural aqui não é "camada de conexão" — é
   **cumprimento do grafo de dependência entre pacotes**: `core` não importa
   nada, `primitives` só importa `core`, `datafeed` não importa `primitives`, e
   assim por diante.
3. Reaproveitar os 27 testes sintéticos do motor (blocos `describe` nas linhas
   439-558 e 564-700 do spec), que não dependem de árvore real nem de git.
4. Descartar os blocos 331-433 e 706-747, ou reescrevê-los contra este
   repositório depois que houver commit para servir de linha de base.

Enquanto isso não acontecer, estes arquivos são **referência de leitura**, não
código ativo.
