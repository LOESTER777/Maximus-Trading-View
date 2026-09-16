/**
 * useIndicatorCatalog + IndicatorToolbox — a caixa de ferramentas de indicadores.
 *
 * O que estes testes protegem, na ordem em que doeria se quebrasse:
 *
 *  1. **`plots` nao muda de identidade de graca.** `useIndicators` chama
 *     `setPlots`, que REMOVE e RECRIA todas as series e panes. Identidade nova a
 *     cada render piscaria o grafico inteiro por quadro. Ha teste para o caso
 *     sutil: um `setState` que produz o MESMO conteudo (redigitar o mesmo periodo,
 *     arrastar o seletor de cor de volta para a cor original) nao pode recriar.
 *  2. **Id gerado nao colide e nao vem de contador de modulo.** O id vai para o
 *     layout salvo; um id que dependa de ordem global faria o layout de um grafico
 *     nao casar com o de outro na mesma pagina.
 *  3. **`visible:false` sai de `plots` mas fica em `active`.** O motor nao tem
 *     "esconder serie"; a informacao (params, cores) tem de sobreviver ao
 *     desligamento, senao religar exige reconfigurar.
 *  4. **A interface e GERADA do metadado.** O teste com o registry REAL prova que
 *     o contrato estrutural deste pacote aceita `IndicatorFactory` sem cast — e a
 *     unica coisa que impede a injecao de quebrar em silencio no consumidor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import {
  nextIndicatorId,
  paneKindOf,
  paramsWithDefaults,
  plotsSignature,
  useIndicatorCatalog,
  type ActiveIndicator,
  type CatalogFactory,
  type CatalogInstance,
  type CatalogMeta,
  type CatalogParams,
} from '../useIndicatorCatalog.js';
import { IndicatorToolbox } from '../IndicatorToolbox.js';

// ⚠️ Import do pacote de INDICADORES, e so aqui no teste.
//
// `@robustus/charts-react` nao depende dele (ver `package.json`), e nao pode
// passar a depender: e a regra 4 do projeto. Mas o contrato estrutural
// (`CatalogFactory`) so tem valor se o `IndicatorFactory` real couber nele SEM
// cast, e nao ha como provar isso sem tocar no tipo real. Arquivo de teste e
// excluido do build (`tsconfig.json` do pacote), entao nao vaza para o `dist`.
import { registry, emaFactory } from '@robustus/charts-indicators';

afterEach(cleanup);

// ═════════════════════════════════════════════════════════════════════════════
// Um registry FALSO — prova que a caixa de ferramentas nao conhece nome nenhum
// ═════════════════════════════════════════════════════════════════════════════

function fakeMeta(over: Partial<CatalogMeta> & Pick<CatalogMeta, 'name'>): CatalogMeta {
  return {
    label: over.name.toUpperCase(),
    category: 'trend',
    params: [{ name: 'period', label: 'Período', type: 'number', default: 14, min: 1, max: 500, step: 1 }],
    outputs: [{ key: 'value', label: 'Valor', plot: 'line', pane: 'price' }],
    ...over,
  };
}

/** Conta quantas instancias cada fabrica criou — para provar reuso de cache. */
const criadas: string[] = [];

function fakeFactory(meta: CatalogMeta): CatalogFactory {
  return {
    meta,
    validate(params: CatalogParams) {
      const errors: string[] = [];
      for (const s of meta.params) {
        const v = params[s.name];
        if (v === undefined) continue;
        if (s.type === 'number') {
          if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${s.name}: nao e numero`);
          else if (s.min !== undefined && v < s.min) errors.push(`${s.name}: abaixo de ${s.min}`);
          else if (s.max !== undefined && v > s.max) errors.push(`${s.name}: acima de ${s.max}`);
        }
      }
      return { valid: errors.length === 0, errors };
    },
    create(params?: CatalogParams): CatalogInstance {
      criadas.push(`${meta.name}:${JSON.stringify(params ?? {})}`);
      return { meta, warmup: () => [] };
    },
  };
}

const FAKE = new Map<string, CatalogFactory>([
  ['media', fakeFactory(fakeMeta({ name: 'media' }))],
  [
    'osc',
    fakeFactory(
      fakeMeta({
        name: 'osc',
        label: 'Oscilador',
        category: 'oscillator',
        outputs: [{ key: 'k', label: '%K', plot: 'line', pane: 'separate' }],
      }),
    ),
  ],
  [
    'misto',
    fakeFactory(
      fakeMeta({
        name: 'misto',
        label: 'Misto',
        category: 'volatility',
        params: [
          { name: 'period', label: 'Período', type: 'number', default: 20, min: 2, max: 100, step: 1 },
          { name: 'source', label: 'Fonte', type: 'source', default: 'close' },
          { name: 'ligado', label: 'Ligado', type: 'boolean', default: true },
        ],
        outputs: [
          { key: 'linha', label: 'Linha', plot: 'line', pane: 'price' },
          { key: 'hist', label: 'Histograma', plot: 'histogram', pane: 'separate' },
        ],
      }),
    ),
  ],
]);

// ═════════════════════════════════════════════════════════════════════════════
// Nucleos puros
// ═════════════════════════════════════════════════════════════════════════════

describe('nextIndicatorId', () => {
  it('usa o nome nu quando esta livre', () => {
    expect(nextIndicatorId('ema', new Set())).toBe('ema');
  });

  it('sufixa a partir de 2 e nao colide', () => {
    expect(nextIndicatorId('ema', new Set(['ema']))).toBe('ema-2');
    expect(nextIndicatorId('ema', new Set(['ema', 'ema-2']))).toBe('ema-3');
    // Buraco no meio e reaproveitado: remover o `ema-2` e adicionar de novo
    // devolve `ema-2`, nao `ema-4`. A resposta e funcao do conjunto ATIVO.
    expect(nextIndicatorId('ema', new Set(['ema', 'ema-3']))).toBe('ema-2');
  });

  it('e funcao PURA do conjunto — nao ha contador de modulo escondido', () => {
    const tomados = new Set(['ema']);
    // Mil chamadas com o mesmo conjunto devolvem sempre o mesmo id. Um contador
    // de modulo faria a segunda chamada divergir da primeira.
    for (let i = 0; i < 1000; i += 1) expect(nextIndicatorId('ema', tomados)).toBe('ema-2');
  });
});

describe('paramsWithDefaults', () => {
  const specs = [
    { name: 'period', label: 'P', type: 'number' as const, default: 14 },
    { name: 'source', label: 'F', type: 'source' as const, default: 'close' },
  ];

  it('completa os ausentes com o default', () => {
    expect(paramsWithDefaults(specs, { period: 30 })).toEqual({ period: 30, source: 'close' });
  });

  it('IGNORA chave nao declarada — campo fantasma nao entra no formulario', () => {
    expect(paramsWithDefaults(specs, { period: 30, sobra: 1 })).toEqual({
      period: 30,
      source: 'close',
    });
  });

  it('sem params devolve so os defaults', () => {
    expect(paramsWithDefaults(specs)).toEqual({ period: 14, source: 'close' });
  });
});

describe('paneKindOf', () => {
  it('classifica preco, sub-painel e os dois', () => {
    const o = (pane: 'price' | 'separate') => ({ key: 'k', label: 'l', plot: 'line' as const, pane });
    expect(paneKindOf([o('price')])).toBe('price');
    expect(paneKindOf([o('separate')])).toBe('separate');
    expect(paneKindOf([o('price'), o('separate')])).toBe('both');
    // Sem saida nenhuma cai em 'price': e onde uma serie sem descritor iria, e
    // 'both' mentiria sobre existir sub-painel.
    expect(paneKindOf([])).toBe('price');
  });
});

describe('plotsSignature', () => {
  const base: ActiveIndicator = {
    id: 'a',
    name: 'media',
    params: { period: 20, source: 'close' },
    visible: true,
  };

  /**
   * ⚠️ O defeito que a ordenacao de chaves evita.
   *
   * `JSON.stringify` preserva ordem de insercao. Editar `source` reinsere a chave
   * e produziria `{period,source}` numa hora e `{source,period}` noutra — mesmo
   * estado, assinatura diferente, series recriadas sem motivo.
   */
  it('nao depende da ordem das chaves de params', () => {
    const a = plotsSignature([base]);
    const b = plotsSignature([{ ...base, params: { source: 'close', period: 20 } }]);
    expect(a).toBe(b);
  });

  it('muda quando params, visibilidade, cor ou conjunto mudam', () => {
    const a = plotsSignature([base]);
    expect(plotsSignature([{ ...base, params: { period: 21, source: 'close' } }])).not.toBe(a);
    expect(plotsSignature([{ ...base, visible: false }])).not.toBe(a);
    expect(plotsSignature([{ ...base, colors: { value: '#fff' } }])).not.toBe(a);
    expect(plotsSignature([base, { ...base, id: 'b' }])).not.toBe(a);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O hook
// ═════════════════════════════════════════════════════════════════════════════

function montar(initial?: Parameters<typeof useIndicatorCatalog>[0]['initial']) {
  return renderHook(() => useIndicatorCatalog({ registry: FAKE, initial }));
}

describe('useIndicatorCatalog — inserir e remover', () => {
  it('parte dos iniciais, descartando nome desconhecido', () => {
    const { result } = montar([{ name: 'media' }, { name: 'nao-existe' }, { name: 'osc' }]);
    expect(result.current.active.map((a) => a.id)).toEqual(['media', 'osc']);
  });

  it('add devolve o id gerado', () => {
    const { result } = montar();
    let id: string | null = null;
    act(() => {
      id = result.current.add('media');
    });
    expect(id).toBe('media');
    expect(result.current.active).toHaveLength(1);
  });

  it('add de nome fora do registry devolve null e NAO adiciona', () => {
    const { result } = montar();
    let id: string | null = 'sujo';
    act(() => {
      id = result.current.add('fantasma');
    });
    // `null` = "nao sei quem e esse indicador". Nunca string vazia: id vazio seria
    // aceito pelo plotter e produziria plot anonimo impossivel de remover na UI.
    expect(id).toBeNull();
    expect(result.current.active).toHaveLength(0);
  });

  it('dois do mesmo indicador ganham ids distintos', () => {
    const { result } = montar();
    act(() => {
      result.current.add('media');
    });
    act(() => {
      result.current.add('media');
    });
    expect(result.current.active.map((a) => a.id)).toEqual(['media', 'media-2']);
  });

  it('remove tira de active e de plots', () => {
    const { result } = montar([{ name: 'media' }, { name: 'osc' }]);
    act(() => {
      result.current.remove('media');
    });
    expect(result.current.active.map((a) => a.name)).toEqual(['osc']);
    expect(result.current.plots.map((p) => p.id)).toEqual(['osc']);
  });

  it('params nascem COMPLETOS, com os defaults do spec', () => {
    const { result } = montar([{ name: 'misto', params: { period: 33 } }]);
    expect(result.current.active[0]?.params).toEqual({
      period: 33,
      source: 'close',
      ligado: true,
    });
  });
});

describe('useIndicatorCatalog — alterar propriedades', () => {
  it('update aplica params validos', () => {
    const { result } = montar([{ name: 'media' }]);
    let r: { applied: boolean; errors: readonly string[] } | null = null;
    act(() => {
      r = result.current.update('media', { period: 200 });
    });
    expect(r).toEqual({ applied: true, errors: [] });
    expect(result.current.active[0]?.params.period).toBe(200);
  });

  it('⭐ update RECUSA param invalido e devolve o motivo — o estado nao muda', () => {
    const { result } = montar([{ name: 'media' }]);
    let r: { applied: boolean; errors: readonly string[] } | null = null;
    act(() => {
      r = result.current.update('media', { period: -5 });
    });
    // Recusar em vez de clampar em silencio: quem digitou -5 precisa saber que o
    // indicador continua em 14, senao leria o grafico como se fosse -5.
    expect(r?.applied).toBe(false);
    expect(r?.errors.length).toBeGreaterThan(0);
    expect(result.current.active[0]?.params.period).toBe(14);
  });

  it('update de id inexistente e valor de retorno, nao excecao', () => {
    const { result } = montar();
    let r: { applied: boolean } | null = null;
    expect(() =>
      act(() => {
        r = result.current.update('fantasma', { period: 3 });
      }),
    ).not.toThrow();
    expect(r?.applied).toBe(false);
  });

  it('patch e PARCIAL: chave nao mencionada fica como esta', () => {
    const { result } = montar([{ name: 'misto', params: { period: 50, source: 'hlc3' } }]);
    act(() => {
      result.current.update('misto', { ligado: false });
    });
    expect(result.current.active[0]?.params).toEqual({
      period: 50,
      source: 'hlc3',
      ligado: false,
    });
  });

  it('setColor grava a cor por chave de saida, preservando as outras', () => {
    const { result } = montar([{ name: 'misto' }]);
    act(() => {
      result.current.setColor('misto', 'linha', '#ff0000');
    });
    act(() => {
      result.current.setColor('misto', 'hist', '#00ff00');
    });
    expect(result.current.active[0]?.colors).toEqual({ linha: '#ff0000', hist: '#00ff00' });
    expect(result.current.plots[0]?.colors).toEqual({ linha: '#ff0000', hist: '#00ff00' });
  });
});

describe('useIndicatorCatalog — visibilidade', () => {
  /**
   * ⚠️ A decisao que este teste amarra.
   *
   * O motor NAO tem "esconder serie": a serie existe ou nao existe. Entao
   * `visible:false` sai de `plots`. Mas os params e as cores tem de sobreviver,
   * senao desligar um oscilador para olhar o preco limpo custaria reconfigurar
   * periodo e cor ao religar.
   */
  it('visible:false sai de plots e FICA em active, com params e cores', () => {
    const { result } = montar([{ name: 'misto', params: { period: 77 } }]);
    act(() => {
      result.current.setColor('misto', 'linha', '#abcdef');
    });
    act(() => {
      result.current.setVisible('misto', false);
    });

    expect(result.current.plots).toHaveLength(0);
    expect(result.current.active).toHaveLength(1);
    expect(result.current.active[0]?.visible).toBe(false);
    expect(result.current.active[0]?.params.period).toBe(77);
    expect(result.current.active[0]?.colors).toEqual({ linha: '#abcdef' });

    act(() => {
      result.current.setVisible('misto', true);
    });
    expect(result.current.plots).toHaveLength(1);
    expect(result.current.plots[0]?.colors).toEqual({ linha: '#abcdef' });
  });
});

describe('useIndicatorCatalog — identidade de `plots`', () => {
  it('⭐ NAO muda de identidade em re-render sem mudanca', () => {
    const { result, rerender } = montar([{ name: 'media' }, { name: 'osc' }]);
    const antes = result.current.plots;
    rerender();
    rerender();
    // Se mudasse, `useIndicators` chamaria `setPlots` por render e o grafico
    // recriaria series e panes a cada quadro — a tela piscaria.
    expect(result.current.plots).toBe(antes);
  });

  it('⭐ NAO muda quando um setState produz o MESMO conteudo', () => {
    const { result } = montar([{ name: 'media' }]);
    const antes = result.current.plots;
    act(() => {
      // Mesmo periodo de novo: e o que acontece ao redigitar `14` no campo.
      result.current.update('media', { period: 14 });
    });
    expect(result.current.plots).toBe(antes);

    act(() => {
      result.current.setVisible('media', true); // ja era visivel
    });
    expect(result.current.plots).toBe(antes);
  });

  it('muda quando um parametro muda', () => {
    const { result } = montar([{ name: 'media' }]);
    const antes = result.current.plots;
    act(() => {
      result.current.update('media', { period: 30 });
    });
    expect(result.current.plots).not.toBe(antes);
  });

  it('muda quando a cor muda — e isso RECRIA as series (limitacao documentada)', () => {
    const { result } = montar([{ name: 'media' }]);
    const antes = result.current.plots;
    act(() => {
      result.current.setColor('media', 'value', '#123456');
    });
    // O `IndicatorPlotter` le `colors` so em `criarSeriesDoPlot`; nao ha caminho
    // de aplicar cor numa serie viva. Por isso a cor commita no `blur` na UI.
    expect(result.current.plots).not.toBe(antes);
  });
});

describe('useIndicatorCatalog — cache de instancia', () => {
  it('⭐ recria a instancia ao mudar param, e REUSA a de quem nao mudou', () => {
    const { result } = montar([{ name: 'media' }, { name: 'osc' }]);
    const instMedia = result.current.plots[0]?.instance;
    const instOsc = result.current.plots[1]?.instance;

    act(() => {
      result.current.update('media', { period: 99 });
    });

    // O periodo e lido na CONSTRUCAO e vive no estado rolante — nao existe
    // `setPeriod`, e nem deveria: trocar o periodo de um estado rolante pela
    // metade produziria serie que nao corresponde a periodo nenhum.
    expect(result.current.plots[0]?.instance).not.toBe(instMedia);
    // E o vizinho intocado nao paga por isso.
    expect(result.current.plots[1]?.instance).toBe(instOsc);
  });

  it('adicionar um indicador nao recria a instancia dos existentes', () => {
    const { result } = montar([{ name: 'media' }]);
    const inst = result.current.plots[0]?.instance;
    act(() => {
      result.current.add('osc');
    });
    expect(result.current.plots[0]?.instance).toBe(inst);
  });
});

describe('useIndicatorCatalog — catalogo agrupado', () => {
  it('agrupa por categoria com rotulo pt-BR', () => {
    const { result } = montar();
    const grupos = result.current.groups;
    expect(grupos.map((g) => g.category)).toEqual(['trend', 'oscillator', 'volatility']);
    expect(grupos.map((g) => g.label)).toEqual(['Tendência', 'Oscilador', 'Volatilidade']);
    expect(grupos.flatMap((g) => g.entries.map((e) => e.name))).toEqual(['media', 'osc', 'misto']);
  });

  it('cada entrada carrega o painel derivado das saidas', () => {
    const { result } = montar();
    const porNome = new Map(result.current.catalog.map((e) => [e.name, e]));
    expect(porNome.get('media')?.pane).toBe('price');
    expect(porNome.get('osc')?.pane).toBe('separate');
    expect(porNome.get('misto')?.pane).toBe('both');
  });

  it('entryOf devolve null para nome desconhecido — nunca lanca', () => {
    const { result } = montar();
    expect(result.current.entryOf('fantasma')).toBeNull();
    expect(result.current.entryOf('media')?.label).toBe('MEDIA');
  });

  /**
   * ⚠️ Categoria desconhecida nao pode SUMIR do menu.
   *
   * Um `switch` exaustivo sobre a uniao fechada faria o indicador de categoria
   * nova desaparecer sem erro nenhum — o pior tipo de falha, porque nao se
   * manifesta. O fallback e o proprio nome da categoria.
   */
  it('categoria desconhecida entra no menu, ao fim, com a chave como rotulo', () => {
    const reg = new Map(FAKE);
    reg.set('exotico', fakeFactory(fakeMeta({ name: 'exotico', category: 'fluxo-de-ordem' })));
    const { result } = renderHook(() => useIndicatorCatalog({ registry: reg }));
    const ultimo = result.current.groups.at(-1);
    expect(ultimo?.category).toBe('fluxo-de-ordem');
    expect(ultimo?.label).toBe('fluxo-de-ordem');
  });
});

describe('useIndicatorCatalog — persistencia', () => {
  it('states traz id, nome e os params REAIS editados', () => {
    const { result } = montar([{ name: 'media' }]);
    act(() => {
      result.current.update('media', { period: 200 });
    });
    expect(result.current.states).toEqual([
      { id: 'media', name: 'media', params: { period: 200 } },
    ]);
  });

  it('⚠️ states OMITE os invisiveis — o esquema v1 nao tem visibilidade', () => {
    const { result } = montar([{ name: 'media' }, { name: 'osc' }]);
    act(() => {
      result.current.setVisible('osc', false);
    });
    // Limitacao documentada: `IndicatorState` nao tem campo de visibilidade, e
    // inventar um dentro de `params` colidiria com o espaco de nomes do proprio
    // indicador. Indicador desligado nao sobrevive ao salvar/restaurar.
    expect(result.current.states.map((s) => s.id)).toEqual(['media']);
  });

  it('load restaura params e faz RECUSA PARCIAL de nome desconhecido', () => {
    const { result } = montar();
    let r: { accepted: readonly ActiveIndicator[]; rejected: readonly string[] } | null = null;
    act(() => {
      r = result.current.load([
        { id: 'media', name: 'media', params: { period: 111 } },
        { id: 'z', name: 'de-outra-versao' },
        { id: 'osc', name: 'osc' },
      ]);
    });
    expect(r?.rejected).toEqual(['de-outra-versao']);
    expect(result.current.active.map((a) => a.id)).toEqual(['media', 'osc']);
    expect(result.current.active[0]?.params.period).toBe(111);
  });

  it('load com id duplicado nao sobrescreve plot — deriva um id livre', () => {
    const { result } = montar();
    act(() => {
      result.current.load([
        { id: 'x', name: 'media' },
        { id: 'x', name: 'osc' },
      ]);
    });
    // Id repetido deixaria uma das series orfa de dado: o plotter casa serie por id.
    const ids = result.current.active.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe('x');
  });

  it('ida e volta salvar -> restaurar preserva os params', () => {
    const { result } = montar([{ name: 'misto' }]);
    act(() => {
      result.current.update('misto', { period: 42, source: 'hlc3' });
    });
    const salvo = result.current.states;
    act(() => {
      result.current.load([]);
    });
    expect(result.current.active).toHaveLength(0);
    act(() => {
      result.current.load(salvo);
    });
    expect(result.current.active[0]?.params).toEqual({
      period: 42,
      source: 'hlc3',
      ligado: true,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⭐ O contrato estrutural bate com o registry REAL, sem cast
// ═════════════════════════════════════════════════════════════════════════════

describe('contrato estrutural x registry real', () => {
  /**
   * Se este teste parar de COMPILAR, a injecao quebrou.
   *
   * `registry` real e `ReadonlyMap<string, IndicatorFactory>`. Ele entra em
   * `ReadonlyMap<string, CatalogFactory>` sem `as` porque `CatalogFactory` declara
   * os metodos com sintaxe de METODO (parametro bivariante). Trocar para sintaxe
   * de propriedade faria todo consumidor precisar de cast.
   */
  it('aceita o registry dos 29 sem cast e monta o catalogo inteiro', () => {
    const { result } = renderHook(() => useIndicatorCatalog({ registry }));
    expect(result.current.catalog.length).toBe(registry.size);
    expect(result.current.catalog.length).toBeGreaterThanOrEqual(29);
    // Todo indicador tem rotulo e ao menos uma saida — sem isso nao ha o que
    // mostrar no menu nem o que plotar.
    for (const e of result.current.catalog) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.outputs.length).toBeGreaterThan(0);
    }
  });

  it('aceita uma fabrica solta (emaFactory) e valida contra os specs reais', () => {
    const reg = new Map([[emaFactory.meta.name, emaFactory]]);
    const { result } = renderHook(() => useIndicatorCatalog({ registry: reg }));
    act(() => {
      result.current.add('ema');
    });
    expect(result.current.active[0]?.params).toEqual({ period: 20, source: 'close' });

    let r: { applied: boolean } | null = null;
    act(() => {
      r = result.current.update('ema', { period: 0 }); // spec real diz min:1
    });
    expect(r?.applied).toBe(false);
    expect(result.current.active[0]?.params.period).toBe(20);
  });

  it('plots do registry real sao aceitos como IndicatorPlot (warmup roda)', () => {
    const { result } = renderHook(() =>
      useIndicatorCatalog({ registry, initial: [{ name: 'ema', params: { period: 3 } }] }),
    );
    const barras = Array.from({ length: 10 }, (_, i) => ({
      time: 1_700_000_000 + i * 60,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 10,
    }));
    const pontos = result.current.plots[0]?.instance.warmup(barras) ?? [];
    expect(pontos).toHaveLength(10);
    // ⚠️ `null` durante o aquecimento, nunca zero: zero e valor de indicador
    // legitimo e desenharia uma reta no zero.
    expect(pontos[0]?.values.value).toBeNull();
    expect(pontos.at(-1)?.values.value).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O componente
// ═════════════════════════════════════════════════════════════════════════════

/** Monta o painel com o registry falso e devolve o resultado do hook. */
function Sonda(props: { readonly initial?: Parameters<typeof useIndicatorCatalog>[0]['initial'] }) {
  const cat = useIndicatorCatalog({ registry: FAKE, initial: props.initial });
  return <IndicatorToolbox catalog={cat} />;
}

describe('IndicatorToolbox — menu de adicionar', () => {
  it('agrupa o menu por categoria em <optgroup>, com os rotulos legiveis', () => {
    render(<Sonda />);
    const select = screen.getByLabelText('Adicionar') as HTMLSelectElement;
    const grupos = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(grupos).toEqual(['Tendência', 'Oscilador', 'Volatilidade']);
    // Controles NATIVOS de proposito: `<optgroup>` da agrupamento e navegacao por
    // teclado de graca; um menu custom teria de reimplementar foco e leitor de tela.
    expect(screen.getByRole('option', { name: 'Oscilador' })).toBeDefined();
  });

  it('insere o indicador escolhido e ja abre as propriedades', () => {
    render(<Sonda />);
    const select = screen.getByLabelText('Adicionar');
    fireEvent.change(select, { target: { value: 'misto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inserir' }));

    // ⚠️ Escopado a LISTA: o rotulo tambem existe como `<option>` no menu de
    // adicionar, e uma busca global casaria os dois.
    expect(within(screen.getByRole('list')).getByText('Misto')).toBeDefined();
    // Abre expandido: quem acabou de inserir quase sempre quer ajustar o periodo.
    expect(screen.getByLabelText('Período')).toBeDefined();
  });

  it('o botao Inserir fica desabilitado sem escolha', () => {
    render(<Sonda />);
    expect((screen.getByRole('button', { name: 'Inserir' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lista vazia se explica em vez de ficar em branco', () => {
    render(<Sonda />);
    expect(screen.getByText('Nenhum indicador no gráfico.')).toBeDefined();
  });
});

describe('IndicatorToolbox — propriedades geradas do metadado', () => {
  function abrir(nome: string): void {
    fireEvent.click(screen.getByRole('button', { name: `Expandir propriedades de ${nome}` }));
  }

  it('⭐ gera um controle por ParamSpec, com o tipo certo e min/max/step do spec', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');

    const numero = screen.getByLabelText('Período') as HTMLInputElement;
    expect(numero.type).toBe('number');
    expect(numero.min).toBe('2');
    expect(numero.max).toBe('100');
    expect(numero.step).toBe('1');
    expect(numero.value).toBe('20');

    const fonte = screen.getByLabelText('Fonte') as HTMLSelectElement;
    expect(fonte.tagName).toBe('SELECT');
    expect(fonte.value).toBe('close');

    const bool = screen.getByLabelText('Ligado') as HTMLInputElement;
    expect(bool.type).toBe('checkbox');
    expect(bool.checked).toBe(true);
  });

  it('editar o numero altera o parametro', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: '55' } });
    // O campo reflete, e o proximo render do hook ja plota com 55.
    expect((screen.getByLabelText('Período') as HTMLInputElement).value).toBe('55');
  });

  /**
   * ⚠️ O defeito que o rascunho local resolve.
   *
   * Um `<input type="number">` controlado por `value={20}` nao pode ser APAGADO:
   * o React reescreve `20` no ato e o operador nao consegue limpar para digitar
   * outro numero. E `Number('')` e `0` — commitar o vazio poria periodo 0 no
   * indicador.
   */
  it('campo numerico pode ficar vazio sem commitar zero', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');
    const campo = screen.getByLabelText('Período') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '' } });
    expect(campo.value).toBe('');
    // Ao sair do campo, volta a espelhar o estado — que continua 20, nao 0.
    fireEvent.blur(campo);
    expect(campo.value).toBe('20');
  });

  it('valor recusado pela validacao aparece como erro com role=alert', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');
    const campo = screen.getByLabelText('Período') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '999' } }); // spec: max 100
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('period');
    // O campo liga-se ao erro por aria-describedby, para o leitor de tela ler o
    // motivo junto com o campo.
    expect(campo.getAttribute('aria-describedby')).toBe(alerta.id);
  });

  it('um seletor de cor por saida, rotulado pelo label da saida', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');
    const linha = screen.getByLabelText('Linha') as HTMLInputElement;
    const hist = screen.getByLabelText('Histograma') as HTMLInputElement;
    expect(linha.type).toBe('color');
    expect(hist.type).toBe('color');
  });

  /**
   * ⚠️ A cor commita no `blur`, nao no `change`.
   *
   * `IndicatorPlot.colors` e lido so na criacao da serie; trocar cor exige
   * `setPlots`, que recria TODAS as series e panes. Arrastar o seletor dispara
   * `onChange` por movimento — commitar em cada um recriaria o grafico por pixel.
   */
  it('cor so commita ao sair do campo', () => {
    render(<Sonda initial={[{ name: 'misto' }]} />);
    abrir('Misto');
    const campo = screen.getByLabelText('Linha') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '#ff0000' } });
    expect(campo.value).toBe('#ff0000');
    fireEvent.blur(campo);
    expect(campo.value).toBe('#ff0000');
  });

  it('indica em qual painel o indicador vive', () => {
    render(<Sonda initial={[{ name: 'media' }, { name: 'osc' }, { name: 'misto' }]} />);
    expect(screen.getByText('Preço')).toBeDefined();
    expect(screen.getByText('Sub-painel')).toBeDefined();
    expect(screen.getByText('Preço + sub-painel')).toBeDefined();
  });
});

describe('IndicatorToolbox — visibilidade, remocao e acessibilidade', () => {
  it('o botao de visibilidade e um toggle com aria-pressed', () => {
    render(<Sonda initial={[{ name: 'media' }]} />);
    const b = screen.getByRole('button', { name: 'Ocultar MEDIA' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(b);
    const depois = screen.getByRole('button', { name: 'Mostrar MEDIA' });
    expect(depois.getAttribute('aria-pressed')).toBe('false');
    // Continua na lista: desligar nao e remover.
    expect(within(screen.getByRole('list')).getByText('MEDIA')).toBeDefined();
  });

  it('remover tira da lista', () => {
    render(<Sonda initial={[{ name: 'media' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remover MEDIA' }));
    expect(screen.getByText('Nenhum indicador no gráfico.')).toBeDefined();
  });

  it('o expansor anuncia estado com aria-expanded e aponta o painel', () => {
    render(<Sonda initial={[{ name: 'media' }]} />);
    const b = screen.getByRole('button', { name: 'Expandir propriedades de MEDIA' });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    const alvo = b.getAttribute('aria-controls');
    fireEvent.click(b);
    const aberto = screen.getByRole('button', { name: 'Recolher propriedades de MEDIA' });
    expect(aberto.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(alvo ?? '')).not.toBeNull();
  });

  it('a secao tem rotulo acessivel', () => {
    render(<Sonda />);
    expect(screen.getByRole('region', { name: 'Caixa de ferramentas de indicadores' })).toBeDefined();
  });

  /**
   * ⚠️ Layout salvo com indicador que este registry nao tem.
   *
   * A linha DEGRADA para "nome + remover" em vez de desaparecer: o operador
   * precisa ver que o layout trazia algo que esta maquina nao sabe calcular. Sumir
   * em silencio faria ele procurar um indicador que a interface jurou nao existir.
   */
  it('indicador fora do registry aparece marcado como desconhecido', () => {
    function SondaOrfa() {
      const cat = useIndicatorCatalog({ registry: FAKE, initial: [{ name: 'media' }] });
      // Simula o estado pos-restore: o hook nao aceitaria o nome, entao o cenario
      // e montado direto sobre o componente, que e quem tem de degradar.
      const orfa: ActiveIndicator = { id: 'z', name: 'de-outra-versao', params: {}, visible: true };
      return <IndicatorToolbox catalog={{ ...cat, active: [...cat.active, orfa] }} />;
    }
    render(<SondaOrfa />);
    expect(screen.getByText('de-outra-versao')).toBeDefined();
    expect(screen.getByText('desconhecido neste registry')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remover de-outra-versao' })).toBeDefined();
  });
});
