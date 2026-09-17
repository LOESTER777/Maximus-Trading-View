/**
 * useSymbolWorkspace — ABAS por ativo, cada uma com o seu documento de gráfico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE HOOK É, E O QUE ELE NÃO É
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ele é a costura entre o núcleo puro `chart-workspace.core.ts` (que decide como a coleção de
 * abas muda) e o ciclo de vida do React. Ele NÃO desenha a barra de abas — isso é
 * `SymbolTabs`, que é aparência — e NÃO aplica nada no motor.
 *
 * ⭐ Aplicar é do CONSUMIDOR, pelo callback `aplicar`. É a mesma disciplina de
 * `useChartState`: restaurar um documento exige o registry de indicadores, o pacote de
 * desenho e o estado de interface do app (o modo de gráfico, por exemplo). Se este hook
 * aplicasse, ele importaria tudo isso e cobraria esse peso de quem só quer abas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ A ORDEM DA TROCA VIVE AQUI, EM UM LUGAR SÓ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `trocar(id)` faz, nesta ordem: (1) captura o estado vivo, (2) grava na aba que SAI,
 * (3) ativa a que ENTRA, (4) aplica o documento dela. Invertê-la grava o estado da aba nova
 * no lugar do da antiga, e o operador perde o trabalho da aba que acabou de deixar.
 *
 * O núcleo já torna a inversão inexprimível (`trocarDeAba` recebe o documento como
 * argumento), e este hook é o único lugar da aplicação que chama essas funções — então há
 * um ponto só para revisar, em vez de cada tela repetir a sequência.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `capturar` E `aplicar` VIVEM EM REF, e o motivo é um defeito medido
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Os dois callbacks chegam como literais em JSX/render, então trocam de identidade a cada
 * render. Se entrassem em array de dependência, cada render reconstruiria os manipuladores;
 * pior, se algum efeito dependesse deles, cada render reexecutaria o efeito. Foi exatamente
 * o mecanismo do laço infinito do `useAlerts` (dependência por IDENTIDADE de um valor
 * recriado a cada render), e a solução é a mesma: guardar em ref, atualizada em efeito sem
 * dependência, e o corpo dos manipuladores lê `ref.current`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  criarAbas,
  abrirEtrocar,
  duplicarAba,
  trocarDeAba,
  fecharAba,
  gravarDocumento,
  mudarPeriodoDaAba,
  mudarSimboloDaAba,
  abaAtiva,
  serializarAbas,
  type AbaDeAtivo,
  type EstadoDeAbas,
  type ChartState,
  type AbasSerializadas,
} from '@robustus/charts-engine';

export interface UseSymbolWorkspaceOptions {
  /**
   * O estado inicial. Aceita fábrica para o consumidor poder ler de `localStorage` sem
   * pagar a leitura em cada render.
   *
   * ⚠️ Lido UMA vez. Trocar este valor depois não recria a área de trabalho — abas são
   * estado do operador, e recriá-las por causa de uma prop mudada apagaria o trabalho dele.
   */
  readonly estadoInicial: EstadoDeAbas | (() => EstadoDeAbas);
  /**
   * Captura o estado vivo do gráfico. Chamado ANTES de qualquer troca.
   *
   * ⚠️ Devolva `null` enquanto não houver o que capturar (motor não montado, dado não
   * chegado). `null` significa "não grave" — capturar um documento vazio e gravá-lo apagaria
   * o que a aba já tinha.
   */
  readonly capturar: () => ChartState | null;
  /**
   * Aplica um documento ao gráfico. `documento` é `null` quando a aba nunca guardou nada.
   *
   * ⚠️ Com `null`, DEIXE COMO ESTÁ em vez de limpar: `null` é "não sei", e limpar por não
   * saber apaga o trabalho do operador.
   */
  readonly aplicar: (documento: ChartState | null, aba: AbaDeAtivo) => void;
  /** Chamado a cada mudança da coleção. É por onde o consumidor persiste, se quiser. */
  readonly onChange?: (estado: EstadoDeAbas) => void;
  /** Relógio, em epoch de SEGUNDOS. Injetável para o teste não congelar tempo global. */
  readonly agora?: () => number;
}

export interface UseSymbolWorkspaceResult {
  readonly estado: EstadoDeAbas;
  readonly abas: readonly AbaDeAtivo[];
  /** A aba na tela. Nunca `null` — a invariante do núcleo garante que `ativa` existe. */
  readonly aba: AbaDeAtivo;
  /** Abre (ou ativa) a combinação, gravando a corrente e herdando os indicadores. */
  readonly abrir: (symbol: string, periodSeconds: number) => void;
  readonly trocar: (id: string) => void;
  readonly fechar: (id: string) => void;
  /**
   * Duplica a aba ATIVA (mesmo ativo, mesmo período, mesmo documento).
   *
   * ⭐ É o caminho para "o mesmo ativo em dois períodos": duplicar e mudar o período da
   * cópia. `abrir` deduplica por conteúdo, então sem isto a combinação é inalcançável.
   */
  readonly duplicar: () => void;
  /** Muda o período da aba ATIVA, preservando a identidade e o documento dela. */
  readonly mudarPeriodo: (periodSeconds: number) => void;
  /** Muda o símbolo da aba ATIVA (o ativo passa a ser outro, o setup fica). */
  readonly mudarSimbolo: (symbol: string) => void;
  /** Grava o estado vivo na aba ativa. Para autossalvamento do consumidor. */
  readonly gravarAtual: () => void;
  /**
   * A forma serializável, com o estado vivo da aba ativa JÁ capturado.
   *
   * ⭐ Existe por causa de um desfecho fácil de errar: persistir `serializarAbas(estado)`
   * direto grava um documento VELHO para a aba ativa (o último capturado numa troca). Quem
   * nunca troca de aba persistiria para sempre o documento do começo da sessão, e ao
   * recarregar veria o gráfico voltar no tempo.
   */
  readonly paraGravar: () => AbasSerializadas;
  /** Motivo da última recusa (limite de abas, símbolo inválido), ou `null`. */
  readonly recusa: string | null;
}

/** Relógio default: epoch em SEGUNDOS, que é a unidade de todo o projeto. */
function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

export function useSymbolWorkspace(opcoes: UseSymbolWorkspaceOptions): UseSymbolWorkspaceResult {
  const [estado, setEstado] = useState<EstadoDeAbas>(() => {
    const inicial =
      typeof opcoes.estadoInicial === 'function' ? opcoes.estadoInicial() : opcoes.estadoInicial;
    // ⚠️ Rede de segurança: uma coleção sem abas violaria a invariante que todo o resto
    // assume ("`ativa` aponta para uma aba existente"). Cai para uma aba de partida em vez
    // de propagar o estado degenerado.
    return inicial.abas.length > 0 ? inicial : criarAbas({ symbol: 'ATIVO', periodSeconds: 300 }, 0);
  });

  /**
   * ⭐ O estado corrente também em REF, assinalado no MESMO instante do `setEstado`.
   *
   * ⚠️ Sem isso, dois manipuladores disparados no mesmo tique (fechar duas abas em
   * sequência, trocar durante uma troca) leriam o `estado` do render anterior e o segundo
   * desfaria o primeiro. Atualização funcional (`setEstado(prev => ...)`) resolveria a
   * leitura, mas não serve aqui: `trocarDeAba` precisa devolver o DESTINO para o consumidor
   * aplicar, e o corpo de um `setState` funcional não pode ter efeito colateral.
   */
  const estadoRef = useRef(estado);
  const capturarRef = useRef(opcoes.capturar);
  const aplicarRef = useRef(opcoes.aplicar);
  const onChangeRef = useRef(opcoes.onChange);
  const agoraRef = useRef(opcoes.agora ?? agoraEmSegundos);
  const [recusa, setRecusa] = useState<string | null>(null);

  // Efeito SEM dependência: mantém as refs em dia sem reexecutar nada por identidade de
  // função. Ver o cabeçalho — é a lição do laço do `useAlerts`.
  useEffect(() => {
    capturarRef.current = opcoes.capturar;
    aplicarRef.current = opcoes.aplicar;
    onChangeRef.current = opcoes.onChange;
    agoraRef.current = opcoes.agora ?? agoraEmSegundos;
  });

  /** Publica o estado novo: ref, React e o consumidor. Um lugar só. */
  const publicar = useCallback((novo: EstadoDeAbas): void => {
    if (novo === estadoRef.current) return;
    estadoRef.current = novo;
    setEstado(novo);
    onChangeRef.current?.(novo);
  }, []);

  const gravarAtual = useCallback((): void => {
    const atual = estadoRef.current;
    const vivo = capturarRef.current();
    if (vivo === null) return;
    publicar(gravarDocumento(atual, atual.ativa, vivo, agoraRef.current()));
  }, [publicar]);

  const trocar = useCallback(
    (id: string): void => {
      const r = trocarDeAba(estadoRef.current, id, capturarRef.current(), agoraRef.current());
      if (r.destino === null) return;
      publicar(r.estado);
      // ⭐ Aplicar SÓ depois de publicar: se o `aplicar` do consumidor chamar de volta algo
      // que leia a aba ativa (é o caso normal — ele lê o símbolo para pedir dado), ele tem de
      // ver a aba NOVA. Aplicar antes o faria ler a antiga.
      aplicarRef.current(r.destino.documento, r.destino);
    },
    [publicar],
  );

  const abrir = useCallback(
    (symbol: string, periodSeconds: number): void => {
      const r = abrirEtrocar(
        estadoRef.current,
        { symbol, periodSeconds },
        capturarRef.current(),
        agoraRef.current(),
      );
      if (!r.ok) {
        setRecusa(r.motivo);
        return;
      }
      setRecusa(null);
      const eraAtiva = r.estado.ativa === estadoRef.current.ativa && !r.criou;
      publicar(r.estado);
      // Abrir a aba que já estava na tela não aplica nada: não houve troca.
      if (eraAtiva) return;
      aplicarRef.current(r.destino.documento, r.destino);
    },
    [publicar],
  );

  const duplicar = useCallback((): void => {
    const atual = estadoRef.current;
    const r = duplicarAba(atual, atual.ativa, capturarRef.current(), agoraRef.current());
    if (!r.ok) {
      setRecusa(r.motivo);
      return;
    }
    setRecusa(null);
    publicar(r.estado);
    // ⚠️ A cópia é idêntica ao que está na tela, então aplicar é redundante HOJE. Aplica-se
    // de todo modo: o contrato é "toda troca de aba ativa aplica o documento da aba nova", e
    // uma exceção silenciosa aqui viraria defeito no dia em que a cópia deixar de ser idêntica.
    aplicarRef.current(r.destino.documento, r.destino);
  }, [publicar]);

  const fechar = useCallback(
    (id: string): void => {
      const r = fecharAba(estadoRef.current, id);
      if (!r.fechou) {
        // ⚠️ Recusa com motivo em vez de silêncio: o botão de fechar existe na última aba
        // (por `closable`) em algumas montagens, e um clique sem resposta parece defeito.
        setRecusa(estadoRef.current.abas.length <= 1 ? 'a última aba não pode ser fechada' : null);
        return;
      }
      setRecusa(null);
      publicar(r.estado);
      // `destino` só vem preenchido quando a fechada era a ATIVA — é o sinal de que a tela
      // mudou e há documento a aplicar. Fechar aba de fundo não toca o gráfico.
      if (r.destino !== null) aplicarRef.current(r.destino.documento, r.destino);
    },
    [publicar],
  );

  const mudarPeriodo = useCallback(
    (periodSeconds: number): void => {
      const atual = estadoRef.current;
      publicar(mudarPeriodoDaAba(atual, atual.ativa, periodSeconds, agoraRef.current()));
    },
    [publicar],
  );

  const mudarSimbolo = useCallback(
    (symbol: string): void => {
      const atual = estadoRef.current;
      publicar(mudarSimboloDaAba(atual, atual.ativa, symbol, agoraRef.current()));
    },
    [publicar],
  );

  const paraGravar = useCallback((): AbasSerializadas => {
    const atual = estadoRef.current;
    const vivo = capturarRef.current();
    const comAtual = vivo === null ? atual : gravarDocumento(atual, atual.ativa, vivo, agoraRef.current());
    // Publica também, para o estado em memória não ficar atrás do que foi gravado.
    publicar(comAtual);
    return serializarAbas(comAtual);
  }, [publicar]);

  const aba = useMemo<AbaDeAtivo>(
    // `abaAtiva` pode devolver `null` só se a invariante for violada; o fallback existe para
    // o tipo não vazar `null` para toda a interface por causa de um caso impossível.
    () => abaAtiva(estado) ?? (estado.abas[0] as AbaDeAtivo),
    [estado],
  );

  return {
    estado,
    abas: estado.abas,
    aba,
    abrir,
    trocar,
    fechar,
    duplicar,
    mudarPeriodo,
    mudarSimbolo,
    gravarAtual,
    paraGravar,
    recusa,
  };
}
