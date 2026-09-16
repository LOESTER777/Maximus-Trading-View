# `colunar-backend.json` — fixture de contrato cruzado

> Spec `bookmap-no-mapa-de-decisao`, tarefa 1.6. Requisitos 8.1 e 8.7.
> Consumida pela tarefa 2.4 (`__tests__/bookmap-decode-contrato-backend.spec.ts`).

## Por que ela existe

O codificador colunar vive no **backend** (`src/bookmap/bookmap-columnar.core.ts`,
`toColunar`) e o decodificador vive no **frontend**
(`../../bookmap-decode.core.ts`, `decodeColumnar`). São dois arquivos, em dois
projetos, com os tipos declarados **à mão em cada lado** — o frontend não importa
da árvore do backend, seguindo a mesma convenção dos outros tipos compartilhados
do projeto.

A Property 9 (round-trip colunar, tarefa 2.3) roda sobre payload **gerado dentro
do próprio teste**: ela testa o decodificador contra si mesmo e **não pegaria**
uma divergência entre as duas pontas, porque nenhuma delas participa do teste da
outra. Renomear uma coluna num lado e não no outro deixaria o heatmap **vazio sem
erro nenhum** — `decodeColumnar` devolve `null`, o hook mostra "decodificação
ausente" e ninguém descobre que a causa foi um rename.

Esta fixture é a única coisa que fecha essa fresta: ela é a saída **real** de
`toColunar`, versionada, atravessando o decodificador **real** do frontend.

## O que ela contém

Envoltória montada como o `BookmapController.heatmapDepth` monta no ramo colunar
(`formato`, `symbol`, `fonte`, `de`, `baldeSeg`, `nivel`, o corpo de `toColunar`,
e `cobertura`), sem `aviso` — a resposta tem células.

| | |
|---|---|
| Células candidatas na entrada | **37** |
| Células emitidas na fixture | **32** |
| Células omitidas (quatro valores em zero) | **5** |
| Eixo de tempo | 6 baldes de 60 s, 09:00–09:05 BRT de 2026-08-26 |
| Eixo de preço | 6 preços, 176985–177010 |
| Cobertura | `EXEC_PARCIAL` com os quatro limites |

Deliberadamente pequena: o objetivo é **contrato**, não volume. Medir tamanho de
payload é outro requisito (8.10) e outra bancada.

### Os casos que ela exercita, e por que cada um

1. **Célula toda-zero omitida** (5 delas, requisito 8.4). É a regra que mais
   facilmente divergiria entre as pontas, porque a ausência é indistinguível de
   "não havia dado" — o decodificador tem de tratar par ausente como zero
   (requisito 8.3), não como buraco.
2. **Preço que existia SÓ em célula toda-zero** (`177015`, um único registro no
   balde `t2`) **desaparece do eixo de preço**. Prova que a omissão acontece
   **antes** da construção dos eixos, e não depois. Um decodificador que
   esperasse o eixo derivado da entrada bruta acusaria índice fora do eixo.
3. **Instantes e preços fora de ordem na entrada.** Os eixos saem ordenados e
   deduplicados, mas as **colunas preservam a ordem de entrada** — `colunas.ti`
   começa em `3, 0, 5, 1, 2, …`. Isso prova, de graça, que o decodificador não
   presume coluna ordenada.
4. **Faixas de valor disjuntas por coluna**: `b` (filaBid) em 1.0xx–1.9xx, `a`
   (filaAsk) em 2.0xx–2.9xx, `c` (execCompra) em 3xx, `v` (execVenda) em 4xx. A
   troca de duas colunas inteiras — o erro de rename mais provável — fica
   detectável por inspeção do valor, não só por igualdade. Dentro de uma célula
   nunca há dois valores iguais, então uma troca par a par também não passa.
5. **Zero como valor legítimo** em parte das métricas de uma célula não-zerada.
   O decodificador não pode rejeitar zero: ele só rejeita **não-finito**.
6. **Os dois lados no mesmo par (balde, preço)** — `t3 @ 176995` tem `filaBid` e
   `filaAsk` — que é o caso das duas passadas de desenho.
7. **Execução sem fila** — `t4 @ 177000` tem só `execCompra`/`execVenda`.
8. **Uma célula com as quatro métricas não nulas e distintas** — `t1 @ 177000`.
9. **`cobertura` com os quatro limites** e `classe: EXEC_PARCIAL`, que é o estado
   normal e não a exceção (medido em 100% dos pregões materializados). Os limites
   são **coerentes com as células**: não há execução em `t0` nem em `t5`, que são
   exatamente os trechos fora de `[execDeMs, execAteMs]`.

### O que ela deliberadamente NÃO exercita

**Saneamento de valor não-finito.** `toColunar` converte não-finito em zero, e o
motivo é justamente que `decodeColumnar` rejeita o grid **inteiro** ao topar com
valor inválido. Mas a fixture é JSON: um `NaN` saneado aparece como `0` e é
indistinguível de um zero genuíno — **a fixture não tem como pinar esse acordo**.
Ele é coberto pelo teste unitário do backend (tarefa 1.2,
`src/bookmap/__tests__/bookmap-columnar.core.spec.ts`), onde `toColunar` está no
laço. Por isso a entrada abaixo é toda finita: incluir `NaN` nela daria falsa
sensação de cobertura.

## Como regenerar

⚠️ **Não editar o JSON à mão.** Ele é saída de código; editado à mão, deixa de
provar o que existe para provar.

A fixture é **byte-estável**: `Date.UTC` é função pura, não há `Date.now()` nem
`Math.random()`, e a serialização é `JSON.stringify(_, null, 2)` com `\n` final.
Duas gerações produzem o mesmo `sha256`
(`c0ceedc0984628203a7c83fa2057ea5ff572cfef53c153054d80ba8ebd027fb5` para a versão
atual). Se o hash mudar sem que a entrada tenha mudado, o **codificador** mudou —
e é isso que se quer descobrir.

Salve o script abaixo como `src/bookmap/__gerar-fixture-colunar.tmp.ts` na raiz do
projeto, rode, e **apague o script**. O entregável é o JSON versionado.

```bash
cd /media/rust/UTIL/Projetos/Trading
npx ts-node --compiler-options '{"module":"commonjs"}' \
  src/bookmap/__gerar-fixture-colunar.tmp.ts
rm src/bookmap/__gerar-fixture-colunar.tmp.ts
```

<details>
<summary><code>src/bookmap/__gerar-fixture-colunar.tmp.ts</code></summary>

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  toColunar,
  type BookmapDepthColunar,
  type CelulaHeatmapVerbosa,
  type CoberturaHeatmap,
} from './bookmap-columnar.core';

/** 2026-08-26T12:00:00Z = 09:00 BRT. `Date.UTC` é puro; não lê relógio. */
const T0 = Date.UTC(2026, 7, 26, 12, 0, 0);
const MIN = 60_000;
const T = [T0, T0 + MIN, T0 + 2 * MIN, T0 + 3 * MIN, T0 + 4 * MIN, T0 + 5 * MIN];

type Parcial = Partial<Omit<CelulaHeatmapVerbosa, 'tsMs' | 'preco'>>;

function cel(tsMs: number, preco: number, v: Parcial = {}): CelulaHeatmapVerbosa {
  return {
    tsMs,
    preco,
    filaBid: v.filaBid ?? 0,
    filaAsk: v.filaAsk ?? 0,
    execCompra: v.execCompra ?? 0,
    execVenda: v.execVenda ?? 0,
  };
}

/**
 * 37 candidatas, embaralhadas de propósito em instante E em preço. Cinco têm os
 * quatro valores em zero e saem omitidas; uma delas é o único registro do preço
 * 177015, que por isso desaparece do eixo.
 */
const ENTRADA: CelulaHeatmapVerbosa[] = [
  cel(T[3], 177_005, { filaAsk: 2543, execVenda: 486 }),
  cel(T[0], 176_985, { filaBid: 1201 }),
  cel(T[5], 177_010, { filaAsk: 2922 }),
  cel(T[2], 177_015), // ALL ZERO → omitida; único registro deste preço
  cel(T[1], 177_000, { filaBid: 1861, filaAsk: 2207, execCompra: 355, execVenda: 453 }),
  cel(T[4], 176_985), // ALL ZERO → omitida
  cel(T[2], 176_995, { filaBid: 1702, execCompra: 333 }),
  cel(T[5], 177_000, { filaBid: 1978, filaAsk: 2351 }),
  cel(T[0], 177_010, { filaAsk: 2664 }),
  cel(T[3], 176_990, { filaBid: 1476, execCompra: 311 }),
  cel(T[1], 177_005), // ALL ZERO → omitida
  cel(T[4], 177_000, { execCompra: 377, execVenda: 475 }), // execução sem fila
  cel(T[2], 176_985, { filaBid: 1188 }),
  cel(T[5], 176_995, { filaBid: 1063 }),
  cel(T[1], 176_990, { filaBid: 1390, execVenda: 407 }),
  cel(T[3], 177_010), // ALL ZERO → omitida
  cel(T[0], 177_000, { filaBid: 1837, filaAsk: 2129 }),
  cel(T[4], 177_005, { filaAsk: 2115, execCompra: 399 }),
  cel(T[2], 176_990), // ALL ZERO → omitida
  cel(T[5], 176_985, { filaBid: 1017 }),
  cel(T[1], 176_995, { filaBid: 1655, execCompra: 322, execVenda: 431 }),
  cel(T[3], 177_000, { filaBid: 1925, execCompra: 344, execVenda: 464 }),
  cel(T[0], 177_005, { filaAsk: 2410 }),
  cel(T[4], 176_990, { filaBid: 1533, execVenda: 418 }),
  cel(T[2], 177_000, { filaAsk: 2284, execCompra: 366, execVenda: 442 }),
  cel(T[5], 176_990, { filaBid: 1044 }),
  cel(T[1], 176_985, { filaBid: 1240 }),
  // Os dois lados no MESMO par (balde, preço): exercita as duas passadas.
  cel(T[3], 176_995, { filaBid: 1099, filaAsk: 2018 }),
  cel(T[0], 176_990, { filaBid: 1422 }),
  cel(T[4], 177_010, { filaAsk: 2855, execVenda: 497 }),
  cel(T[2], 177_005, { filaAsk: 2476, execCompra: 388 }),
  cel(T[5], 177_005, { filaAsk: 2609 }),
  cel(T[1], 177_010, { filaAsk: 2731 }),
  cel(T[3], 176_985, { filaBid: 1305 }),
  cel(T[0], 176_995, { filaBid: 1610 }),
  cel(T[4], 176_995, { filaBid: 1748 }),
  cel(T[2], 177_010, { filaAsk: 2798 }),
];

/**
 * Fila cobre os 6 baldes; execução só de t1 a t4. Coerente com as células: não
 * há execução diferente de zero em t0 nem em t5.
 */
const COBERTURA: CoberturaHeatmap = {
  classe: 'EXEC_PARCIAL',
  observacao:
    'Fila agregada de 09:00 a 09:05 BRT; execução agregada de 09:01 a 09:04 BRT. ' +
    'Os trechos 09:00–09:01 BRT e 09:04–09:05 BRT ficam sem execução capturada.',
  filaDeMs: T[0],
  filaAteMs: T[5],
  execDeMs: T[1],
  execAteMs: T[4],
};

const corpo = toColunar(ENTRADA);

// A ordem das chaves espelha o ramo colunar de `BookmapController.heatmapDepth`.
const fixture: BookmapDepthColunar = {
  formato: 'colunar',
  symbol: 'WINV26',
  fonte: 'MT5_L2',
  de: '2026-08-26',
  baldeSeg: 60,
  nivel: 'PROFUNDIDADE',
  ...corpo,
  cobertura: COBERTURA,
};

const destino = resolve(
  __dirname,
  '../../frontend/src/components/decision/bookmap/__tests__/fixtures/colunar-backend.json',
);

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

console.log(`escrito: ${destino}`);
console.log(`candidatas: ${ENTRADA.length}`);
console.log(`emitidas:   ${fixture.celulas}`);
console.log(`omitidas:   ${ENTRADA.length - fixture.celulas}`);
```

</details>

## Quando o contrato mudar de propósito

Se o formato colunar mudar por decisão (coluna nova, coluna renomeada), o
procedimento é: mudar `toColunar` **e** `bookmap-types.ts`/`decodeColumnar`,
regenerar esta fixture, e conferir que a tarefa 2.4 continua verde. A fixture
regenerada é o registro de que as duas pontas foram mudadas juntas.

Se a tarefa 2.4 quebrar **sem** ninguém ter mudado o formato de propósito, então
uma das pontas divergiu — e é exatamente para isso que ela existe.

## Independência das conexões (requisito 12.1)

Dado sintético, produzido em código. Nenhum CSV, nenhum arquivo externo, nenhuma
leitura de banco, nenhuma requisição de rede. `symbol`, `fonte` e `de` são
rótulos do contrato de rede; `fonte` é valor de filtro sobre a coluna `fonte` de
`bookmap_depth` e não seleciona conexão alguma. Não há aqui endereço de rede,
identificador de conta, credencial nem estado de posição.
