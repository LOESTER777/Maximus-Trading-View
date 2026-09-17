/**
 * Bancada das ABAS por ativo.
 *
 * ⭐⭐ O teste que importa mais é `mantém o documento de cada aba ao ir e voltar` mais o
 * ⭐⭐ `grava ANTES de ativar`: os dois juntos descrevem o defeito que a API foi desenhada
 * para tornar inexprimível. Há um caso que RECONSTRÓI a ordem errada à mão e mostra o
 * estrago — é a guarda contra alguém "simplificar" `trocarDeAba` em dois passos.
 */
import { describe, it, expect } from 'vitest';
import {
  criarAbas,
  abrirAba,
  abrirEtrocar,
  duplicarAba,
  trocarDeAba,
  fecharAba,
  gravarDocumento,
  mudarPeriodoDaAba,
  mudarSimboloDaAba,
  abaAtiva,
  acharAba,
  documentoParaAbaNova,
  normalizarSimbolo,
  periodoValido,
  proximoIdDeAba,
  serializarAbas,
  desserializarAbas,
  ABAS_SCHEMA_VERSION,
  MAX_ABAS,
  type EstadoDeAbas,
  nomeDaAba,
  renomearAba,
  MAX_ROTULO_DE_ABA,
} from '../chart-workspace.core.js';
import { serializeChartState, type ChartState } from '../chart-state.core.js';

const T0 = 1_700_000_000;

/** Um documento de estado plausível, com desenho, alerta e indicador. */
function doc(opcoes?: {
  readonly simbolo?: string;
  readonly preco?: number;
  readonly periodo?: number;
}): ChartState {
  const preco = opcoes?.preco ?? 130_000;
  return serializeChartState({
    ...(opcoes?.simbolo === undefined ? {} : { symbol: opcoes.simbolo }),
    priceSeriesType: 'Candlestick',
    indicators: [
      { id: 'ema20', name: 'ema', params: { period: 20 } },
      { id: 'rsi14', name: 'rsi', params: { period: 14 } },
    ],
    alerts: [{ key: 'a1', condition: { kind: 'CROSS_ABOVE', level: preco } }],
    drawings: {
      version: 1,
      drawings: [{ id: 'd1', kind: 'HORIZONTAL_LINE', anchors: [{ time: T0, price: preco }] }],
    },
    viewport: { from: 10, to: 200 },
  });
}

function abas3(): EstadoDeAbas {
  const inicial = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc() }, T0);
  const b = abrirAba(inicial, { symbol: 'PETR4', periodSeconds: 300 }, T0 + 10);
  expect(b.ok).toBe(true);
  if (!b.ok) throw new Error('inalcançável');
  const c = abrirAba(b.estado, { symbol: 'VALE3', periodSeconds: 300 }, T0 + 20);
  expect(c.ok).toBe(true);
  if (!c.ok) throw new Error('inalcançável');
  return c.estado;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('normalização', () => {
  it('símbolo vira maiúscula e perde espaço', () => {
    expect(normalizarSimbolo('  win  ')).toBe('WIN');
    expect(normalizarSimbolo('petr 4')).toBe('PETR 4');
  });

  it('símbolo inutilizável devolve null', () => {
    expect(normalizarSimbolo('')).toBeNull();
    expect(normalizarSimbolo('   ')).toBeNull();
    expect(normalizarSimbolo(42)).toBeNull();
    expect(normalizarSimbolo(null)).toBeNull();
  });

  it('período aceita só inteiro de segundos positivo', () => {
    expect(periodoValido(300)).toBe(true);
    expect(periodoValido(0)).toBe(false);
    expect(periodoValido(-300)).toBe(false);
    expect(periodoValido(1.5)).toBe(false);
    expect(periodoValido(Number.NaN)).toBe(false);
    expect(periodoValido('300')).toBe(false);
  });

  it('id novo não reaproveita id de aba fechada', () => {
    const estado = abas3();
    expect(proximoIdDeAba(estado)).toBe('aba-4');
    const { estado: sem2 } = fecharAba(estado, 'aba-2');
    // ⚠️ 'aba-2' vagou, e o próximo continua sendo 4: reaproveitar faria um id já usado
    // voltar falando de outra aba.
    expect(proximoIdDeAba(sem2)).toBe('aba-4');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('criar', () => {
  it('nasce com uma aba, e ela é a ativa', () => {
    const e = criarAbas({ symbol: 'win', periodSeconds: 300 }, T0);
    expect(e.abas).toHaveLength(1);
    expect(e.ativa).toBe('aba-1');
    expect(abaAtiva(e)?.symbol).toBe('WIN');
    expect(abaAtiva(e)?.documento).toBeNull();
  });

  it('⚠️ é TOTAL: lixo cai para valor visível em vez de falhar', () => {
    const e = criarAbas({ symbol: '  ', periodSeconds: 0 }, Number.NaN);
    expect(e.abas).toHaveLength(1);
    expect(abaAtiva(e)?.symbol).toBe('ATIVO');
    expect(abaAtiva(e)?.periodSeconds).toBe(300);
    expect(abaAtiva(e)?.abertaEm).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('abrir', () => {
  it('abre e ativa a nova', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = abrirAba(e, { symbol: 'PETR4', periodSeconds: 300 }, T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criou).toBe(true);
    expect(r.estado.abas).toHaveLength(2);
    expect(r.estado.ativa).toBe(r.id);
    expect(r.destino.symbol).toBe('PETR4');
  });

  it('⭐ mesma combinação ATIVA a existente em vez de duplicar', () => {
    const e = abas3();
    const r = abrirAba(e, { symbol: 'PETR4', periodSeconds: 300 }, T0 + 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criou).toBe(false);
    expect(r.estado.abas).toHaveLength(3);
    expect(r.estado.ativa).toBe('aba-2');
  });

  it('⭐ MESMO ativo em OUTRO período é aba nova (é leitura legítima)', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = abrirAba(e, { symbol: 'WIN', periodSeconds: 86_400 }, T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criou).toBe(true);
    expect(r.estado.abas.map((a) => a.periodSeconds)).toEqual([300, 86_400]);
  });

  it('abrir a que já está ativa devolve a MESMA referência de estado', () => {
    const e = abas3();
    const r = abrirAba(e, { symbol: 'VALE3', periodSeconds: 300 }, T0 + 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado).toBe(e);
  });

  it('pedido inválido é recusado com motivo, e não com aba de lixo', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const a = abrirAba(e, { symbol: '  ', periodSeconds: 300 }, T0);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.motivo).toMatch(/símbolo/i);
    const b = abrirAba(e, { symbol: 'WDO', periodSeconds: 0 }, T0);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.motivo).toMatch(/período/i);
  });

  it(`⚠️ o teto de ${MAX_ABAS} recusa, e NÃO fecha a mais antiga`, () => {
    let estado = criarAbas({ symbol: 'A0', periodSeconds: 300 }, T0);
    for (let i = 1; i < MAX_ABAS; i += 1) {
      const r = abrirAba(estado, { symbol: `A${i}`, periodSeconds: 300 }, T0 + i);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      estado = r.estado;
    }
    expect(estado.abas).toHaveLength(MAX_ABAS);
    const cheio = abrirAba(estado, { symbol: 'EXTRA', periodSeconds: 300 }, T0 + 99);
    expect(cheio.ok).toBe(false);
    if (cheio.ok) return;
    expect(cheio.motivo).toMatch(/limite/i);
    // A primeira aba continua lá, com o documento dela.
    expect(estado.abas[0]?.symbol).toBe('A0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('⭐⭐ trocar de aba — a ordem é o defeito', () => {
  it('mantém o documento de cada aba ao ir e voltar', () => {
    const docWin = doc({ simbolo: 'WIN', preco: 130_000 });
    const docPetr = doc({ simbolo: 'PETR4', preco: 32 });

    const e0 = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: docWin }, T0);
    const aberta = abrirAba(e0, { symbol: 'PETR4', periodSeconds: 300 }, T0 + 5);
    expect(aberta.ok).toBe(true);
    if (!aberta.ok) return;

    // Na aba do PETR4 o operador desenha: o consumidor grava.
    const e1 = gravarDocumento(aberta.estado, 'aba-2', docPetr, T0 + 10);

    // Volta para o WIN, gravando o que estava na tela (o documento do PETR4).
    const volta = trocarDeAba(e1, 'aba-1', docPetr, T0 + 20);
    expect(volta.destino?.id).toBe('aba-1');
    // ⭐ O documento que volta é o do WIN, com o nível de 130.000 — e NÃO o do PETR4.
    expect(volta.destino?.documento?.symbol).toBe('WIN');
    expect(volta.destino?.documento?.alerts[0]?.condition).toMatchObject({ level: 130_000 });
    // E a aba do PETR4 ficou com o dela.
    expect(acharAba(volta.estado, 'aba-2')?.documento?.alerts[0]?.condition).toMatchObject({
      level: 32,
    });
  });

  it('⭐⭐ grava na aba que SAI, nunca na que entra', () => {
    const e = abas3(); // ativa = aba-3 (VALE3)
    const vivo = doc({ simbolo: 'VALE3', preco: 55 });
    const r = trocarDeAba(e, 'aba-1', vivo, T0 + 40);
    expect(acharAba(r.estado, 'aba-3')?.documento?.symbol).toBe('VALE3');
    // ⭐ A aba de DESTINO conservou o documento antigo dela, intacto.
    expect(acharAba(r.estado, 'aba-1')?.documento?.symbol).toBeUndefined();
    expect(acharAba(r.estado, 'aba-1')?.documento?.alerts[0]?.condition).toMatchObject({
      level: 130_000,
    });
  });

  it('⭐⭐ GUARDA: a ordem invertida à mão perde o trabalho — é o que a API impede', () => {
    const e = abas3(); // ativa = aba-3
    const vivoDaAba3 = doc({ simbolo: 'VALE3', preco: 55 });

    // A aba-1 (WIN) tem o trabalho dela guardado desde o começo.
    expect(acharAba(e, 'aba-1')?.documento?.alerts[0]?.condition).toMatchObject({ level: 130_000 });

    // O jeito errado, escrito de propósito: ativa primeiro, grava depois. O `ativa` já é a
    // aba nova, então `gravarDocumento(estado, estado.ativa, ...)` escreve no lugar errado.
    const ativouPrimeiro: EstadoDeAbas = { ...e, ativa: 'aba-1' };
    const errado = gravarDocumento(ativouPrimeiro, ativouPrimeiro.ativa, vivoDaAba3, T0 + 40);

    // ⭐ O ESTRAGO, nas duas pontas:
    // (1) a aba-3 não recebeu nada — o trabalho do operador nela sumiu;
    expect(acharAba(errado, 'aba-3')?.documento).toBeNull();
    // (2) e a aba-1 foi SOBRESCRITA com o documento do VALE3, perdendo o nível do WIN.
    expect(acharAba(errado, 'aba-1')?.documento?.symbol).toBe('VALE3');
    expect(acharAba(errado, 'aba-1')?.documento?.alerts[0]?.condition).toMatchObject({ level: 55 });

    // O jeito certo, com a mesma sequência de intenções: cada documento no seu lugar.
    const certo = trocarDeAba(e, 'aba-1', vivoDaAba3, T0 + 40);
    expect(acharAba(certo.estado, 'aba-3')?.documento?.symbol).toBe('VALE3');
    expect(acharAba(certo.estado, 'aba-1')?.documento?.alerts[0]?.condition).toMatchObject({
      level: 130_000,
    });
  });

  it('trocar para a aba já ativa não grava nada e devolve destino null', () => {
    const e = abas3();
    const r = trocarDeAba(e, e.ativa, doc(), T0 + 40);
    expect(r.estado).toBe(e);
    expect(r.destino).toBeNull();
  });

  it('id desconhecido não muda nada', () => {
    const e = abas3();
    const r = trocarDeAba(e, 'aba-99', doc(), T0 + 40);
    expect(r.estado).toBe(e);
    expect(r.destino).toBeNull();
  });

  it('⚠️ documento nulo NÃO apaga o que a aba já tinha', () => {
    const e0 = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc() }, T0);
    const aberta = abrirAba(e0, { symbol: 'WDO', periodSeconds: 300 }, T0 + 5);
    if (!aberta.ok) return;
    const volta = trocarDeAba(aberta.estado, 'aba-1', null, T0 + 10);
    expect(acharAba(volta.estado, 'aba-2')?.documento).toBeNull();
    expect(acharAba(volta.estado, 'aba-1')?.documento).not.toBeNull();
  });

  it('abrirEtrocar grava a corrente E herda a análise', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const vivo = doc({ simbolo: 'WIN' });
    const r = abrirEtrocar(e, { symbol: 'PETR4', periodSeconds: 300 }, vivo, T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A aba de origem guardou o que estava na tela.
    expect(acharAba(r.estado, 'aba-1')?.documento?.symbol).toBe('WIN');
    // ⭐ A nova nasceu com os INDICADORES e sem as marcações.
    expect(r.destino.documento?.indicators.map((i) => i.name)).toEqual(['ema', 'rsi']);
    expect(r.destino.documento?.alerts).toEqual([]);
    expect(r.destino.documento?.drawings['drawings']).toEqual([]);
    expect(r.destino.documento?.viewport).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('duplicar', () => {
  it('⭐ produz a única duplicata de conteúdo permitida — e leva o documento', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const vivo = doc({ simbolo: 'WIN', preco: 130_000 });
    const r = duplicarAba(e, 'aba-1', vivo, T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado.abas).toHaveLength(2);
    expect(r.destino.symbol).toBe('WIN');
    expect(r.destino.periodSeconds).toBe(300);
    // ⭐ Mesmo instrumento ⇒ os desenhos VALEM. Diferente de aba de outro ativo.
    expect(r.destino.documento?.alerts[0]?.condition).toMatchObject({ level: 130_000 });
    expect(r.destino.documento?.drawings['drawings']).toHaveLength(1);
    expect(r.estado.ativa).toBe(r.id);
  });

  it('⭐ duplicar + mudar período é como se chega ao mesmo ativo em DOIS períodos', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = duplicarAba(e, 'aba-1', doc(), T0 + 5);
    if (!r.ok) return;
    const final = mudarPeriodoDaAba(r.estado, r.id, 86_400, T0 + 10);
    expect(final.abas.map((a) => a.periodSeconds)).toEqual([300, 86_400]);
    expect(final.abas.every((a) => a.symbol === 'WIN')).toBe(true);
  });

  it('a cópia leva o que está na TELA, não o documento da última troca', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc({ preco: 1 }) }, T0);
    const r = duplicarAba(e, 'aba-1', doc({ preco: 999 }), T0 + 5);
    if (!r.ok) return;
    expect(r.destino.documento?.alerts[0]?.condition).toMatchObject({ level: 999 });
    // E a aba de origem também ficou em dia.
    expect(acharAba(r.estado, 'aba-1')?.documento?.alerts[0]?.condition).toMatchObject({ level: 999 });
  });

  it('duplicar aba de FUNDO não usa o documento vivo (ele não é dela)', () => {
    const e = abas3(); // ativa = aba-3; aba-1 tem o documento de 130.000
    const r = duplicarAba(e, 'aba-1', doc({ preco: 999 }), T0 + 40);
    if (!r.ok) return;
    expect(r.destino.documento?.alerts[0]?.condition).toMatchObject({ level: 130_000 });
  });

  it('id desconhecido e teto cheio são recusados com motivo', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const a = duplicarAba(e, 'aba-9', null, T0);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.motivo).toMatch(/não encontrada/i);

    let estado = e;
    for (let i = 1; i < MAX_ABAS; i += 1) {
      const r = abrirAba(estado, { symbol: `A${i}`, periodSeconds: 300 }, T0 + i);
      if (!r.ok) return;
      estado = r.estado;
    }
    const cheio = duplicarAba(estado, 'aba-1', null, T0 + 99);
    expect(cheio.ok).toBe(false);
    if (cheio.ok) return;
    expect(cheio.motivo).toMatch(/limite/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('documentoParaAbaNova', () => {
  it('herda tipo de série e indicadores', () => {
    const base = serializeChartState({
      priceSeriesType: 'Line',
      indicators: [{ id: 'ema20', name: 'ema', params: { period: 20 }, colors: { value: '#fff' } }],
      alerts: [],
    });
    const novo = documentoParaAbaNova(base);
    expect(novo?.priceSeriesType).toBe('Line');
    expect(novo?.indicators[0]).toMatchObject({ name: 'ema', colors: { value: '#fff' } });
  });

  it('⭐ descarta desenho, alerta e viewport — são presos a PREÇO do ativo', () => {
    const novo = documentoParaAbaNova(doc({ preco: 130_000 }));
    expect(novo?.alerts).toEqual([]);
    expect(novo?.drawings['drawings']).toEqual([]);
    expect(novo?.viewport).toBeUndefined();
    expect(novo?.symbol).toBeUndefined();
  });

  it('⚠️ o documento de desenho vazio é LEGÍVEL (formato do pacote de desenho)', () => {
    const novo = documentoParaAbaNova(doc());
    // Reusa `serializeChartState`, então o bloco tem versão — montar `{}` à mão não teria.
    expect(novo?.drawings['version']).toBe(1);
  });

  it('sem base devolve null', () => {
    expect(documentoParaAbaNova(null)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('editar aba', () => {
  it('mudar período preserva id e documento', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc() }, T0);
    const r = mudarPeriodoDaAba(e, 'aba-1', 86_400, T0 + 5);
    expect(r.abas[0]?.id).toBe('aba-1');
    expect(r.ativa).toBe('aba-1');
    expect(r.abas[0]?.periodSeconds).toBe(86_400);
    expect(r.abas[0]?.documento).not.toBeNull();
    expect(r.abas[0]?.atualizadoEm).toBe(T0 + 5);
  });

  it('período igual ou inválido devolve a MESMA referência', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    expect(mudarPeriodoDaAba(e, 'aba-1', 300, T0 + 5)).toBe(e);
    expect(mudarPeriodoDaAba(e, 'aba-1', 0, T0 + 5)).toBe(e);
    expect(mudarPeriodoDaAba(e, 'aba-9', 900, T0 + 5)).toBe(e);
  });

  it('⚠️ mudar período PERMITE colisão de conteúdo (é edição, não abertura)', () => {
    const e0 = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const b = abrirAba(e0, { symbol: 'WIN', periodSeconds: 86_400 }, T0 + 5);
    if (!b.ok) return;
    const r = mudarPeriodoDaAba(b.estado, 'aba-2', 300, T0 + 10);
    expect(r.abas).toHaveLength(2);
    expect(r.abas.every((a) => a.periodSeconds === 300)).toBe(true);
  });

  it('mudar símbolo normaliza e preserva o documento', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc() }, T0);
    const r = mudarSimboloDaAba(e, 'aba-1', ' wdo ', T0 + 5);
    expect(r.abas[0]?.symbol).toBe('WDO');
    expect(r.abas[0]?.documento).not.toBeNull();
    expect(mudarSimboloDaAba(r, 'aba-1', 'WDO', T0 + 9)).toBe(r);
    expect(mudarSimboloDaAba(r, 'aba-1', '', T0 + 9)).toBe(r);
  });

  it('gravar em id inexistente devolve a MESMA referência', () => {
    const e = abas3();
    expect(gravarDocumento(e, 'aba-99', doc(), T0 + 40)).toBe(e);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('fechar', () => {
  it('⚠️ RECUSA fechar a última — a tela não pode ficar sem gráfico', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = fecharAba(e, 'aba-1');
    expect(r.fechou).toBe(false);
    expect(r.estado).toBe(e);
    expect(r.destino).toBeNull();
  });

  it('⭐ fechar a ativa elege o vizinho da DIREITA', () => {
    const e = abas3();
    const meio = trocarDeAba(e, 'aba-2', null, T0 + 30).estado;
    const r = fecharAba(meio, 'aba-2');
    expect(r.fechou).toBe(true);
    expect(r.estado.ativa).toBe('aba-3');
    expect(r.destino?.id).toBe('aba-3');
  });

  it('⭐ fechar a ÚLTIMA da direita cai para a da esquerda', () => {
    const e = abas3(); // ativa = aba-3, que é a última
    const r = fecharAba(e, 'aba-3');
    expect(r.estado.ativa).toBe('aba-2');
    expect(r.destino?.id).toBe('aba-2');
  });

  it('fechar aba de FUNDO não pede restauração', () => {
    const e = abas3(); // ativa = aba-3
    const r = fecharAba(e, 'aba-1');
    expect(r.fechou).toBe(true);
    expect(r.estado.ativa).toBe('aba-3');
    // ⭐ `destino` null é o sinal de "não aplique nada": a tela não mudou.
    expect(r.destino).toBeNull();
  });

  it('id desconhecido não fecha nada', () => {
    const e = abas3();
    const r = fecharAba(e, 'aba-99');
    expect(r.fechou).toBe(false);
    expect(r.estado).toBe(e);
  });

  it('a invariante "ativa existe" sobrevive a fechar tudo o que pode', () => {
    let estado = abas3();
    for (const id of ['aba-1', 'aba-2', 'aba-3']) {
      estado = fecharAba(estado, id).estado;
      expect(abaAtiva(estado)).not.toBeNull();
    }
    expect(estado.abas).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('serialização', () => {
  it('ida e volta preserva abas, ativa e documentos', () => {
    const e = gravarDocumento(abas3(), 'aba-2', doc({ simbolo: 'PETR4', preco: 32 }), T0 + 50);
    const lido = desserializarAbas(JSON.parse(JSON.stringify(serializarAbas(e))));
    expect(lido.estado?.abas).toHaveLength(3);
    expect(lido.estado?.ativa).toBe(e.ativa);
    expect(acharAba(lido.estado as EstadoDeAbas, 'aba-2')?.documento?.symbol).toBe('PETR4');
    expect(
      acharAba(lido.estado as EstadoDeAbas, 'aba-2')?.documento?.drawings['drawings'],
    ).toHaveLength(1);
  });

  it('grava a versão do esquema', () => {
    expect(serializarAbas(abas3()).version).toBe(ABAS_SCHEMA_VERSION);
  });

  it('NUNCA lança, e devolve null quando não há nada aproveitável', () => {
    for (const lixo of [null, undefined, 42, 'x', [], {}, { version: 1 }, { version: 1, abas: 5 }]) {
      const r = desserializarAbas(lixo);
      expect(r.estado).toBeNull();
      expect(r.avisos.length).toBeGreaterThan(0);
    }
  });

  it('⚠️ versão do FUTURO é recusada por inteiro', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION + 1,
      ativa: 'aba-1',
      abas: [{ id: 'aba-1', symbol: 'WIN', periodSeconds: 300, documento: null }],
    });
    expect(r.estado).toBeNull();
    expect(r.avisos[0]).toMatch(/mais nova/i);
  });

  it('aba corrompida cai e o resto sobrevive', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION,
      ativa: 'aba-2',
      abas: [
        { id: 'aba-1', symbol: '', periodSeconds: 300 },
        { id: 'aba-2', symbol: 'WIN', periodSeconds: 300 },
        { symbol: 'WDO', periodSeconds: 300 },
        { id: 'aba-3', symbol: 'PETR4', periodSeconds: 0 },
        null,
      ],
    });
    expect(r.estado?.abas.map((a) => a.id)).toEqual(['aba-2']);
    expect(r.estado?.ativa).toBe('aba-2');
    expect(r.avisos.length).toBeGreaterThanOrEqual(4);
  });

  it('⚠️ id repetido cai (o segundo seria inalcançável para sempre)', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION,
      ativa: 'aba-1',
      abas: [
        { id: 'aba-1', symbol: 'WIN', periodSeconds: 300 },
        { id: 'aba-1', symbol: 'WDO', periodSeconds: 300 },
      ],
    });
    expect(r.estado?.abas).toHaveLength(1);
    expect(r.estado?.abas[0]?.symbol).toBe('WIN');
    expect(r.avisos.some((a) => /repetido/i.test(a))).toBe(true);
  });

  it('⭐ ativa apontando para aba descartada cai para a primeira', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION,
      ativa: 'aba-9',
      abas: [{ id: 'aba-1', symbol: 'WIN', periodSeconds: 300 }],
    });
    expect(r.estado?.ativa).toBe('aba-1');
    expect(abaAtiva(r.estado as EstadoDeAbas)).not.toBeNull();
    expect(r.avisos.some((a) => /ativa/i.test(a))).toBe(true);
  });

  it('documento de aba corrompido não derruba a aba (recusa PARCIAL)', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION,
      ativa: 'aba-1',
      abas: [
        {
          id: 'aba-1',
          symbol: 'WIN',
          periodSeconds: 300,
          documento: { version: 1, priceSeriesType: 'Candlestick', indicators: [{ name: 42 }], alerts: [] },
        },
      ],
    });
    expect(r.estado?.abas).toHaveLength(1);
    expect(r.estado?.abas[0]?.symbol).toBe('WIN');
    expect(r.estado?.abas[0]?.documento?.indicators).toEqual([]);
    expect(r.avisos.some((a) => a.startsWith('aba aba-1:'))).toBe(true);
  });

  it('⚠️ data ausente vira 0, e não "agora"', () => {
    const r = desserializarAbas({
      version: ABAS_SCHEMA_VERSION,
      ativa: 'aba-1',
      abas: [{ id: 'aba-1', symbol: 'WIN', periodSeconds: 300 }],
    });
    expect(r.estado?.abas[0]?.abertaEm).toBe(0);
    expect(r.estado?.abas[0]?.atualizadoEm).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⭐⭐ NOME de aba — o defeito das duas abas indistinguíveis
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ RELATADO na tela: duas abas escritas `SINTÉTICO`, com o mesmo período e a mesma dica.
// Vinha do `+` (duplicar), que produzia cópia idêntica. Viola a regra que este projeto já tinha
// escrito para nome de template: *dois itens visualmente idênticos na lista é o pior desfecho
// possível* — o operador carrega um, o setup vem errado, e nada na tela explica.
describe('⭐⭐ nome de aba', () => {
  it('sem nome, a aba mostra o SÍMBOLO', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    expect(nomeDaAba(e.abas[0] as never)).toBe('WIN');
  });

  it('⭐⭐ a cópia nasce com nome, e as duas ficam distinguíveis', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = duplicarAba(e, 'aba-1', doc(), T0 + 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nomes = r.estado.abas.map((a) => nomeDaAba(a));
    expect(nomes).toEqual(['WIN', 'WIN (2)']);
    // ⭐ O SÍMBOLO não mudou: é o identificador que a fonte de dado recebe. Um nome no mesmo
    // campo faria o playground pedir um ativo chamado "WIN (2)".
    expect(r.destino.symbol).toBe('WIN');
  });

  it('duplicar três vezes não repete o nome', () => {
    let estado = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    for (let i = 0; i < 3; i += 1) {
      const r = duplicarAba(estado, estado.ativa, null, T0 + i);
      if (!r.ok) return;
      estado = r.estado;
    }
    const nomes = estado.abas.map((a) => nomeDaAba(a));
    expect(new Set(nomes).size, `nomes repetidos: ${nomes.join(', ')}`).toBe(nomes.length);
  });

  it('renomear troca só o nome, preservando símbolo, período e documento', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300, documento: doc() }, T0);
    const r = renomearAba(e, 'aba-1', '  WIN   fluxo  ', T0 + 5);
    const a = r.abas[0] as never as { symbol: string; periodSeconds: number; documento: unknown };
    expect(nomeDaAba(r.abas[0] as never)).toBe('WIN fluxo');
    expect(a.symbol).toBe('WIN');
    expect(a.periodSeconds).toBe(300);
    expect(a.documento).not.toBeNull();
  });

  it('`null` (e nome vazio) devolvem a aba ao símbolo', () => {
    const e = renomearAba(criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0), 'aba-1', 'X', T0);
    expect(nomeDaAba(e.abas[0] as never)).toBe('X');
    expect(nomeDaAba(renomearAba(e, 'aba-1', null, T0).abas[0] as never)).toBe('WIN');
    expect(nomeDaAba(renomearAba(e, 'aba-1', '   ', T0).abas[0] as never)).toBe('WIN');
  });

  it('nome longo é RECORTADO, e nome igual devolve a MESMA referência', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = renomearAba(e, 'aba-1', 'W'.repeat(80), T0);
    expect(nomeDaAba(r.abas[0] as never).length).toBe(MAX_ROTULO_DE_ABA);
    expect(renomearAba(r, 'aba-1', 'W'.repeat(MAX_ROTULO_DE_ABA), T0)).toBe(r);
    expect(renomearAba(e, 'aba-9', 'X', T0)).toBe(e);
  });

  it('⚠️ nome REPETIDO é permitido (diferente de template)', () => {
    // Duas abas com o mesmo nome continuam sendo duas abas, com ids e documentos distintos.
    // Recusar impediria o operador de chamar as duas de "WIN" — o estado de onde ele parte.
    let estado = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const r = duplicarAba(estado, 'aba-1', null, T0 + 1);
    if (!r.ok) return;
    estado = renomearAba(r.estado, r.id, 'WIN', T0 + 2);
    expect(estado.abas.map((a) => nomeDaAba(a))).toEqual(['WIN', 'WIN']);
    expect(estado.abas).toHaveLength(2);
  });

  it('o nome sobrevive à ida e volta pela serialização', () => {
    const e = renomearAba(criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0), 'aba-1', 'Fluxo', T0);
    const lido = desserializarAbas(JSON.parse(JSON.stringify(serializarAbas(e))));
    expect(nomeDaAba(lido.estado?.abas[0] as never)).toBe('Fluxo');
  });

  it('⚠️ aba sem nome NÃO grava o campo (documento não engorda)', () => {
    const e = criarAbas({ symbol: 'WIN', periodSeconds: 300 }, T0);
    const bruto = JSON.parse(JSON.stringify(serializarAbas(e))) as { abas: Record<string, unknown>[] };
    expect('rotulo' in (bruto.abas[0] as Record<string, unknown>)).toBe(false);
  });

  it('rótulo inválido no armazenamento é descartado e a aba SOBREVIVE', () => {
    for (const lixo of [42, null, '', '   ', {}, []]) {
      const r = desserializarAbas({
        version: ABAS_SCHEMA_VERSION,
        ativa: 'aba-1',
        abas: [{ id: 'aba-1', symbol: 'WIN', periodSeconds: 300, rotulo: lixo }],
      });
      expect(r.estado?.abas).toHaveLength(1);
      expect(nomeDaAba(r.estado?.abas[0] as never)).toBe('WIN');
    }
  });
});
