/**
 * IndicatorToolbox — a caixa de ferramentas de indicadores, GERADA do metadado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ NENHUM FORMULARIO E ESCRITO POR INDICADOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O painel de propriedades sai inteiro de `ParamSpec`:
 *
 *   `options` presente  -> `<select>` com exatamente aquelas entradas (vence o `type`)
 *   `type: 'number'`    -> `<input type="number">` com `min`/`max`/`step` do spec
 *   `type: 'source'`    -> `<select>` de preco-fonte (opcoes do metadado; lista local
 *                          so como reserva para registry que nao as preencha)
 *   `type: 'boolean'`   -> `<input type="checkbox">`
 *
 * e o `label` do spec e o texto do `<label>`. O menu de adicionar sai de
 * `category` (agrupado em `<optgroup>`), e o painel onde o indicador vive sai de
 * `outputs[].pane`. Indicador registrado no registry aparece aqui completo, com
 * seus parametros editaveis, **sem uma linha de codigo escrita neste arquivo**.
 *
 * Era o oposto do que existia: o playground tinha 14 entradas a mao com
 * parametros CONSTANTES no literal. 29 indicadores x N parametros em formulario
 * manual divergiriam do calculo no primeiro ajuste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ PECA DE BIBLIOTECA, NAO A UI DO PRODUTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Estilo INLINE MINIMO e neutro, mais uma classe por elemento
 * (`robustus-toolbox__*`) para o consumidor sobrescrever. Zero dependencia de UI
 * de terceiro — nao ha popup, arvore, drag-and-drop nem icone de biblioteca
 * externa. Os controles sao os NATIVOS do navegador de proposito: `<optgroup>` da
 * agrupamento e navegacao por teclado de graca, e um menu custom teria de
 * reimplementar foco, escape e leitor de tela para empatar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ COR AGORA E AO VIVO — a limitacao que forcava o `blur` foi RESOLVIDA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Historico, porque explica o codigo: a cor era lida pelo `IndicatorPlotter`
 * APENAS em `criarSeriesDoPlot`, entao trocar cor exigia `setPlots` — que remove e
 * recria TODAS as series e panes e reexecuta o `warmup` de cada indicador. E
 * `<input type="color">` dispara `onChange` a cada movimento do seletor: commitar
 * ao vivo recriaria o grafico inteiro por pixel arrastado. A saida era rascunho
 * local com commit no `blur`, e ficou registrado como limitacao.
 *
 * O plotter ganhou `applyColors`, que repinta a serie VIVA (`applyOptions`) sem
 * recriar nem recalcular nada, e o catalogo tirou a cor da assinatura de `plots`.
 * Com isso o commit voltou para o `onChange`: o operador arrasta o seletor e ve a
 * linha mudar de cor acompanhando o dedo, que e o comportamento que ele espera de
 * um seletor de cor. O redesenho e coalescido em UM quadro pelo motor, entao
 * varios eventos no mesmo tick custam uma pintura.
 *
 * Parametro numerico segue commitando na hora (digitar `200` gera poucos eventos), e
 * ali o custo de recriar e inevitavel — o periodo e lido na CONSTRUCAO do indicador.
 */
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type {
  ActiveIndicator,
  CatalogEntry,
  CatalogOutputSpec,
  CatalogParamSpec,
  IndicatorPaneKind,
  UseIndicatorCatalogResult,
} from './useIndicatorCatalog.js';

// ═════════════════════════════════════════════════════════════════════════════
// Vocabulario de apresentacao
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fontes de preco — RESERVA, usada so quando o metadado nao trouxe as opcoes.
 *
 * ⭐ A duplicacao que existia aqui foi RESOLVIDA. Antes esta lista era a unica fonte
 * do `<select>`: `ParamSpec` dizia `type: 'source'` sem enumerar as fontes, e a uniao
 * `PriceSource` vive no pacote de indicadores, que este pacote nao importa. Duas
 * listas, e esta condenada a envelhecer — fonte nova la nao aparecia aqui, sem erro
 * de compilacao nenhum.
 *
 * `ParamSpec.options` fechou o buraco: as sete fontes viajam no metadado
 * (`PRICE_SOURCE_OPTIONS`), e o controle sai inteiro dele, como os outros.
 *
 * ⚠️ A lista continua aqui, e nao e sobra. Um registry de TERCEIRO — indicador
 * caseiro do consumidor — pode declarar `type: 'source'` sem preencher `options`, e
 * sem reserva o operador veria um select vazio. Ela nao mais decide nada quando o
 * metadado fala.
 */
const FONTES_DE_PRECO: ReadonlyArray<{ readonly value: string | number; readonly label: string }> = [
  { value: 'close', label: 'Fechamento' },
  { value: 'open', label: 'Abertura' },
  { value: 'high', label: 'Máxima' },
  { value: 'low', label: 'Mínima' },
  { value: 'hl2', label: 'Média máx/mín (HL/2)' },
  { value: 'hlc3', label: 'Preço típico (HLC/3)' },
  { value: 'ohlc4', label: 'Preço médio (OHLC/4)' },
];

const ROTULO_PAINEL: Readonly<Record<IndicatorPaneKind, string>> = {
  price: 'Preço',
  separate: 'Sub-painel',
  both: 'Preço + sub-painel',
};

/**
 * Cor mostrada no seletor quando o indicador nao tem cor escolhida nem cor no
 * descritor.
 *
 * ⚠️ **Nao e a cor real que o grafico vai usar.** A paleta default do
 * `IndicatorPlotter` e atribuida por ORDEM DE CRIACAO das series, e essa ordem
 * nao e observavel daqui — o plotter nao expoe qual cor caiu em qual saida. Um
 * neutro honesto e melhor que adivinhar a cor errada e mostrar ao operador um
 * quadradinho que nao corresponde a linha na tela. No instante em que ele escolhe
 * uma cor, o que se ve passa a ser exatamente o que esta plotado.
 */
const COR_NEUTRA = '#94a3b8';

// ═════════════════════════════════════════════════════════════════════════════
// Props
// ═════════════════════════════════════════════════════════════════════════════

export interface IndicatorToolboxProps {
  /**
   * O resultado de `useIndicatorCatalog`.
   *
   * Passar o objeto inteiro em vez de espalhar 10 props e deliberado: as
   * operacoes so fazem sentido juntas (nao existe `remove` sem `active`), e
   * separa-las convidaria o consumidor a montar um subconjunto inconsistente.
   */
  readonly catalog: UseIndicatorCatalogResult;
  /** Titulo da secao. Default `'Indicadores'`. */
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * ⭐ Abre as propriedades DESTE indicador, de fora do componente.
   *
   * ⚠️ Existe para fechar o gesto "cliquei na linha da EMA no grafico, quero as
   * propriedades dela". A abertura era 100% interna, entao a unica forma de configurar
   * um indicador era encontra-lo na lista — com 8 indicadores ligados, procurar na lista
   * o que se acabou de clicar e trabalho que o clique ja tinha resolvido.
   *
   * ⚠️ **Nao e um componente controlado.** Este campo ABRE; nao fecha, e nao impede o
   * operador de abrir outros pela lista. Controlar por completo obrigaria o consumidor a
   * gerenciar o conjunto de abertos so para poder abrir um — e um `undefined` (o caso
   * comum) fecharia tudo a cada render. O que o consumidor manda e "abra este agora".
   *
   * ⚠️ Um valor REPETIDO reabre: `useEffect` compara por identidade, e clicar duas vezes
   * na mesma linha manda a mesma string. Por isso o campo aceita um objeto
   * `{ id, nonce }` — o `nonce` (um contador, um timestamp) e o que torna o segundo
   * clique distinguivel do primeiro. So o `id`, sem nonce, funciona para o caso de abrir
   * um indicador diferente.
   */
  readonly openIndicator?: string | { readonly id: string; readonly nonce: unknown } | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Painel de inserir / remover / configurar indicadores.
 *
 * @example
 * import { registry } from '@robustus/charts-indicators';
 *
 * const cat = useIndicatorCatalog({ registry, initial: [{ name: 'ema' }] });
 * useIndicators({ engine, plots: cat.plots, bars: velas });
 * return <IndicatorToolbox catalog={cat} />;
 */
export function IndicatorToolbox({
  catalog,
  title = 'Indicadores',
  className,
  style,
  openIndicator,
}: IndicatorToolboxProps): JSX.Element {
  const prefixo = useId();
  const [escolha, setEscolha] = useState('');
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(() => new Set<string>());

  // ── Abertura pedida de fora (clique no gráfico) ───────────────────────────
  //
  // ⚠️ A dependência é o `nonce` quando ele vem, e o `id` quando não vem. Sem o nonce,
  // clicar duas vezes na MESMA linha manda a mesma string e o efeito não roda de novo —
  // o que é correto quando o painel já está aberto, e frustrante quando o operador o
  // fechou no meio. Quem quer reabertura garantida passa o nonce.
  const pedidoId = typeof openIndicator === 'string' ? openIndicator : openIndicator?.id;
  const pedidoNonce = typeof openIndicator === 'string' ? undefined : openIndicator?.nonce;

  useEffect(() => {
    if (pedidoId === undefined || pedidoId === null || pedidoId === '') return;
    setAbertos((atual) => (atual.has(pedidoId) ? atual : new Set(atual).add(pedidoId)));
  }, [pedidoId, pedidoNonce]);
  /** Mensagens de validacao por id de indicador. Vazio = sem erro pendente. */
  const [erros, setErros] = useState<Readonly<Record<string, readonly string[]>>>({});

  const porNome = useMemo(() => {
    const m = new Map<string, CatalogEntry>();
    for (const e of catalog.catalog) m.set(e.name, e);
    return m;
  }, [catalog.catalog]);

  const alternarAberto = useCallback((id: string): void => {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }, []);

  const adicionar = useCallback((): void => {
    if (escolha === '') return;
    const id = catalog.add(escolha);
    // `null` = nome fora do registry. Nao ha o que abrir, e o select volta ao
    // estado neutro em vez de fingir que adicionou.
    if (id === null) return;
    setAbertos((atual) => new Set(atual).add(id));
    setEscolha('');
  }, [catalog, escolha]);

  const idSelect = `${prefixo}-add`;

  return (
    <section
      className={className ?? 'robustus-toolbox'}
      style={{ ...estiloSecao, ...style }}
      aria-label="Caixa de ferramentas de indicadores"
    >
      <div style={estiloCabecalho}>
        <strong className="robustus-toolbox__title" style={{ fontSize: 13 }}>
          {title}
        </strong>
        <span className="robustus-toolbox__count" style={estiloTenue}>
          {catalog.active.length} ativo(s)
        </span>
      </div>

      {/* ── Adicionar: <optgroup> por categoria, direto do metadado ────────── */}
      <div className="robustus-toolbox__add" style={estiloLinhaAdd}>
        <label htmlFor={idSelect} style={estiloTenue}>
          Adicionar
        </label>
        <select
          id={idSelect}
          value={escolha}
          onChange={(e) => setEscolha(e.target.value)}
          style={estiloCampo}
        >
          <option value="">Escolha um indicador…</option>
          {catalog.groups.map((g) => (
            <optgroup key={g.category} label={g.label}>
              {g.entries.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={adicionar} disabled={escolha === ''} style={estiloBotao(false)}>
          Inserir
        </button>
      </div>

      {/* ── Ativos ─────────────────────────────────────────────────────────── */}
      {catalog.active.length === 0 ? (
        <p className="robustus-toolbox__empty" style={{ ...estiloTenue, margin: '6px 0' }}>
          Nenhum indicador no gráfico.
        </p>
      ) : (
        <ul className="robustus-toolbox__list" style={estiloLista}>
          {catalog.active.map((a) => (
            <LinhaIndicador
              key={a.id}
              prefixo={prefixo}
              ativo={a}
              entrada={porNome.get(a.name) ?? null}
              aberto={abertos.has(a.id)}
              erros={erros[a.id] ?? []}
              onAlternarAberto={alternarAberto}
              onErros={(id, msgs) => setErros((atual) => ({ ...atual, [id]: msgs }))}
              catalog={catalog}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Uma linha da lista de ativos
// ═════════════════════════════════════════════════════════════════════════════

interface LinhaIndicadorProps {
  readonly prefixo: string;
  readonly ativo: ActiveIndicator;
  /**
   * A entrada de catalogo, ou `null` quando o nome nao esta no registry.
   *
   * ⚠️ `null` acontece de verdade: um layout salvo com um indicador que o
   * registry corrente nao tem. A linha degrada para "nome + remover" em vez de
   * desaparecer — o operador precisa VER que o layout tinha algo que esta maquina
   * nao sabe calcular, senao o indicador sumiria em silencio.
   */
  readonly entrada: CatalogEntry | null;
  readonly aberto: boolean;
  readonly erros: readonly string[];
  readonly onAlternarAberto: (id: string) => void;
  readonly onErros: (id: string, msgs: readonly string[]) => void;
  readonly catalog: UseIndicatorCatalogResult;
}

function LinhaIndicador({
  prefixo,
  ativo,
  entrada,
  aberto,
  erros,
  onAlternarAberto,
  onErros,
  catalog,
}: LinhaIndicadorProps): JSX.Element {
  const rotulo = entrada?.label ?? ativo.name;
  const idPainel = `${prefixo}-${ativo.id}-props`;
  const idErro = `${prefixo}-${ativo.id}-erro`;
  const temPropriedades = entrada !== null && entrada.params.length + entrada.outputs.length > 0;

  return (
    <li className="robustus-toolbox__item" style={estiloItem}>
      <div style={estiloLinhaItem}>
        {temPropriedades ? (
          <button
            type="button"
            onClick={() => onAlternarAberto(ativo.id)}
            aria-expanded={aberto}
            aria-controls={idPainel}
            aria-label={`${aberto ? 'Recolher' : 'Expandir'} propriedades de ${rotulo}`}
            style={estiloBotaoIcone}
          >
            {aberto ? '▾' : '▸'}
          </button>
        ) : (
          // Espacador com a largura do botao, para os nomes ficarem alinhados
          // mesmo quando o indicador nao tem o que configurar.
          <span aria-hidden="true" style={{ ...estiloBotaoIcone, visibility: 'hidden' }}>
            ▸
          </span>
        )}

        <span className="robustus-toolbox__name" style={{ fontSize: 12, flex: 1 }}>
          {rotulo}
          {entrada === null && (
            <em style={{ ...estiloTenue, marginLeft: 6 }}>desconhecido neste registry</em>
          )}
        </span>

        {entrada !== null && (
          <span className="robustus-toolbox__pane" style={estiloEtiqueta} title="Onde o indicador é plotado">
            {ROTULO_PAINEL[entrada.pane]}
          </span>
        )}

        <button
          type="button"
          onClick={() => catalog.setVisible(ativo.id, !ativo.visible)}
          aria-pressed={ativo.visible}
          aria-label={`${ativo.visible ? 'Ocultar' : 'Mostrar'} ${rotulo}`}
          style={estiloBotao(ativo.visible)}
        >
          {ativo.visible ? 'Visível' : 'Oculto'}
        </button>

        <button
          type="button"
          onClick={() => catalog.remove(ativo.id)}
          aria-label={`Remover ${rotulo}`}
          style={estiloBotaoIcone}
        >
          ✕
        </button>
      </div>

      {erros.length > 0 && (
        <p id={idErro} role="alert" className="robustus-toolbox__error" style={estiloErro}>
          {erros.join(' · ')}
        </p>
      )}

      {aberto && entrada !== null && (
        <div
          id={idPainel}
          role="group"
          aria-label={`Propriedades de ${rotulo}`}
          className="robustus-toolbox__props"
          style={estiloPainel}
        >
          {entrada.params.map((spec) => (
            <CampoParametro
              key={spec.name}
              prefixo={prefixo}
              ativo={ativo}
              spec={spec}
              idErro={erros.length > 0 ? idErro : undefined}
              onAplicar={(patch) => {
                const r = catalog.update(ativo.id, patch);
                onErros(ativo.id, r.applied ? [] : r.errors);
              }}
            />
          ))}

          {entrada.outputs.length > 0 && (
            <>
              <span style={{ ...estiloTenue, marginTop: 2 }}>Cores das saídas</span>
              {entrada.outputs.map((output) => (
                <CampoCor
                  key={output.key}
                  prefixo={prefixo}
                  ativo={ativo}
                  output={output}
                  onAplicar={(cor) => catalog.setColor(ativo.id, output.key, cor)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Um campo de parametro, escolhido pelo `type` do spec
// ═════════════════════════════════════════════════════════════════════════════

interface CampoParametroProps {
  readonly prefixo: string;
  readonly ativo: ActiveIndicator;
  readonly spec: CatalogParamSpec;
  readonly idErro?: string;
  readonly onAplicar: (patch: Readonly<Record<string, number | string | boolean>>) => void;
}

function CampoParametro({
  prefixo,
  ativo,
  spec,
  idErro,
  onAplicar,
}: CampoParametroProps): JSX.Element {
  const idCampo = `${prefixo}-${ativo.id}-${spec.name}`;
  const valor = ativo.params[spec.name] ?? spec.default;

  /**
   * Rascunho do texto digitado no campo numerico.
   *
   * ⚠️ Existe por causa de um estado que o valor commitado nao representa: o
   * campo VAZIO. Apagar o conteudo de um `<input type="number">` controlado por
   * `value={20}` faz o React reescrever `20` no ato, e o operador nao consegue
   * apagar para digitar outro numero. `null` = sem rascunho, o campo espelha o
   * estado; string = o que ele digitou, ainda nao commitado.
   */
  const [rascunho, setRascunho] = useState<string | null>(null);

  if (spec.type === 'boolean') {
    return (
      <div style={estiloCampoLinha}>
        <input
          id={idCampo}
          type="checkbox"
          checked={valor === true}
          onChange={(e) => onAplicar({ [spec.name]: e.target.checked })}
        />
        <label htmlFor={idCampo} style={{ fontSize: 11, flex: 1 }}>
          {spec.label}
        </label>
      </div>
    );
  }

  // Parametro ENUMERADO: `<select>` montado do METADADO.
  //
  // ⭐ `spec.options` manda. A lista local de fontes e so a reserva para um registry
  // que declare `type: 'source'` sem preencher as opcoes (indicador caseiro de
  // terceiro) — ver a nota em `FONTES_DE_PRECO`. E `options` funciona para QUALQUER
  // enumeracao, nao so fonte: um parametro `{ type: 'number', options: [...] }` de um
  // indicador futuro ganha o select de graca.
  const opcoes = spec.options ?? (spec.type === 'source' ? FONTES_DE_PRECO : undefined);
  if (opcoes !== undefined && opcoes.length > 0) {
    return (
      <div style={estiloCampoLinha}>
        <label htmlFor={idCampo} style={estiloRotuloCampo}>
          {spec.label}
        </label>
        <select
          id={idCampo}
          value={String(valor)}
          onChange={(e) => {
            // ⚠️ `<select>` sempre entrega STRING. Um parametro enumerado numerico
            // (`options: [{value: 9}, {value: 21}]`) receberia `'9'` e a fabrica o
            // recusaria — o operador escolheria e nada mudaria. O tipo do `default` diz
            // o que reconverter.
            const bruto = e.target.value;
            const convertido =
              typeof spec.default === 'number' && bruto !== '' && Number.isFinite(Number(bruto))
                ? Number(bruto)
                : bruto;
            onAplicar({ [spec.name]: convertido });
          }}
          style={{ ...estiloCampo, flex: 1 }}
        >
          {opcoes.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
          {/*
            Valor fora da lista (opcao removida numa versao nova, ou layout de outra
            versao): entra como opcao propria para o `<select>` nao aparecer vazio e o
            valor nao ser silenciosamente trocado ao primeiro foco.
          */}
          {!opcoes.some((o) => String(o.value) === String(valor)) && (
            <option value={String(valor)}>{String(valor)}</option>
          )}
        </select>
      </div>
    );
  }

  // `type: 'number'`
  return (
    <div style={estiloCampoLinha}>
      <label htmlFor={idCampo} style={estiloRotuloCampo}>
        {spec.label}
      </label>
      <input
        id={idCampo}
        type="number"
        value={rascunho ?? String(valor)}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        {...(idErro === undefined ? {} : { 'aria-describedby': idErro })}
        onChange={(e) => {
          const bruto = e.target.value;
          setRascunho(bruto);
          const n = Number(bruto);
          // Commita so numero finito. `''` -> `Number('')` e `0`, e commitar zero
          // por campo vazio poria periodo 0 no indicador — por isso o vazio e
          // testado ANTES da conversao, e nao pela finitude do resultado.
          if (bruto.trim() === '' || !Number.isFinite(n)) return;
          onAplicar({ [spec.name]: n });
        }}
        // Ao sair do campo o rascunho e descartado: o campo volta a espelhar o
        // estado, o que desfaz visualmente uma digitacao que a validacao recusou.
        onBlur={() => setRascunho(null)}
        style={{ ...estiloCampo, width: 84 }}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Um seletor de cor por saida
// ═════════════════════════════════════════════════════════════════════════════

interface CampoCorProps {
  readonly prefixo: string;
  readonly ativo: ActiveIndicator;
  readonly output: CatalogOutputSpec;
  readonly onAplicar: (cor: string) => void;
}

function CampoCor({ prefixo, ativo, output, onAplicar }: CampoCorProps): JSX.Element {
  const idCampo = `${prefixo}-${ativo.id}-cor-${output.key}`;
  const corAtual = ativo.colors?.[output.key] ?? output.color ?? COR_NEUTRA;

  return (
    <div style={estiloCampoLinha}>
      <label htmlFor={idCampo} style={estiloRotuloCampo}>
        {output.label}
      </label>
      <input
        id={idCampo}
        type="color"
        value={corAtual}
        // ⭐ Commita AO VIVO. Ver o cabecalho: era `blur` porque cada commit recriava o
        // grafico inteiro; com `applyColors` no plotter o custo virou um `applyOptions`
        // e uma pintura coalescida, e o operador ve a cor acompanhar o seletor.
        onChange={(e) => onAplicar(e.target.value)}
        style={{ width: 34, height: 22, padding: 0, border: 'none', background: 'transparent' }}
      />
      <span style={estiloTenue}>
        {output.plot} · {output.pane === 'separate' ? 'sub-painel' : 'preço'}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Estilo — minimo, neutro, sobrescrivivel por classe
// ═════════════════════════════════════════════════════════════════════════════

const estiloSecao: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'inherit',
  color: 'inherit',
};

const estiloCabecalho: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const estiloTenue: CSSProperties = { fontSize: 10, opacity: 0.65 };

const estiloLinhaAdd: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const estiloLista: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const estiloItem: CSSProperties = {
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 6,
  padding: '4px 6px',
};

const estiloLinhaItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const estiloEtiqueta: CSSProperties = {
  fontSize: 9,
  padding: '1px 5px',
  borderRadius: 999,
  border: '1px solid rgba(148,163,184,0.25)',
  opacity: 0.8,
  whiteSpace: 'nowrap',
};

const estiloPainel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid rgba(148,163,184,0.15)',
};

const estiloCampoLinha: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const estiloRotuloCampo: CSSProperties = { fontSize: 11, minWidth: 96 };

const estiloCampo: CSSProperties = {
  fontSize: 11,
  padding: '3px 5px',
  borderRadius: 4,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'transparent',
  color: 'inherit',
};

const estiloErro: CSSProperties = {
  fontSize: 10,
  margin: '4px 0 0',
  color: '#f87171',
};

function estiloBotao(ativo: boolean): CSSProperties {
  return {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    border: '1px solid rgba(148,163,184,0.25)',
    background: ativo ? 'rgba(56,189,248,0.18)' : 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  };
}

const estiloBotaoIcone: CSSProperties = {
  fontSize: 11,
  width: 20,
  height: 20,
  lineHeight: '18px',
  padding: 0,
  borderRadius: 4,
  border: '1px solid rgba(148,163,184,0.2)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
