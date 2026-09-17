/**
 * Templates de layout NOMEADOS.
 *
 * ⭐ O que estes testes travam são as quatro decisões que fazem a lista ser usável no meio de
 * um pregão:
 *
 *  1. o nome é comparado normalizado e GUARDADO como digitado;
 *  2. salvar por cima sobrescreve — mas RELATA, para quem chama poder confirmar;
 *  3. renomear NÃO sobrescreve (seria fusão silenciosa de dois setups);
 *  4. leitura corrompida descarta o item e preserva o resto, com aviso.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TEMPLATES,
  acharTemplate,
  desserializarTemplates,
  nomeDeExibicao,
  normalizarNome,
  ordenarParaExibicao,
  removerTemplate,
  renomearTemplate,
  salvarTemplate,
  serializarTemplates,
  TEMPLATES_SCHEMA_VERSION,
  type ColecaoDeTemplates,
} from '../layout-templates.core.js';

const DOC = { symbol: 'WIN', indicators: [] };
const T0 = 1_789_000_000;

function comUm(nome = 'Fluxo Manhã'): ColecaoDeTemplates {
  const r = salvarTemplate([], nome, DOC, T0);
  if (!r.ok) throw new Error('setup do teste falhou');
  return r.colecao;
}

describe('normalizarNome — compara normalizado, guarda como digitado', () => {
  it('⭐ caixa e espaço repetido NÃO distinguem dois nomes', () => {
    // Dois itens visualmente idênticos na lista é o pior desfecho: o operador carrega um e não
    // entende por que o setup está errado.
    expect(normalizarNome('Fluxo Manhã')).toBe(normalizarNome('fluxo  manhã'));
    expect(normalizarNome(' Fluxo Manhã ')).toBe(normalizarNome('FLUXO MANHÃ'));
  });

  it('nome inutilizável é `null`, não cadeia vazia', () => {
    expect(normalizarNome('')).toBeNull();
    expect(normalizarNome('   ')).toBeNull();
    expect(normalizarNome(42)).toBeNull();
    expect(normalizarNome(null)).toBeNull();
  });

  it('nome longo é RECORTADO, não recusado', () => {
    // Recusar em silêncio faria o botão "salvar" não fazer nada.
    const longo = 'x'.repeat(200);
    expect(nomeDeExibicao(longo).length).toBe(48);
    expect(normalizarNome(longo)!.length).toBe(48);
  });

  it('a grafia original é preservada na exibição', () => {
    const c = comUm('  Fluxo   Manhã ');
    expect(c[0]!.nome).toBe('Fluxo Manhã');
  });
});

describe('salvarTemplate', () => {
  it('cria o primeiro template com as duas datas iguais', () => {
    const r = salvarTemplate([], 'Tendência', DOC, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sobrescreveu).toBe(false);
    expect(r.colecao).toHaveLength(1);
    expect(r.colecao[0]).toEqual({
      nome: 'Tendência',
      criadoEm: T0,
      atualizadoEm: T0,
      documento: DOC,
    });
  });

  it('⭐⭐ salvar com o mesmo nome SOBRESCREVE e RELATA', () => {
    // Recusar obrigaria o operador a inventar "Fluxo 2" para atualizar o setup que ele já tem —
    // o caso mais comum. Mas sobrescrever em silêncio destrói trabalho, então o sinal existe.
    const c = comUm('Fluxo');
    const r = salvarTemplate(c, 'FLUXO', { symbol: 'WDO' }, T0 + 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sobrescreveu).toBe(true);
    expect(r.colecao).toHaveLength(1);
    expect(r.colecao[0]!.documento).toEqual({ symbol: 'WDO' });
  });

  it('⭐ `criadoEm` é PRESERVADO na sobrescrita; `atualizadoEm` anda', () => {
    // Redefinir `criadoEm` faria o template "pular" na ordenação e o operador procuraria onde
    // ele estava.
    const c = comUm('Fluxo');
    const r = salvarTemplate(c, 'Fluxo', DOC, T0 + 500);
    if (!r.ok) return;
    expect(r.colecao[0]!.criadoEm).toBe(T0);
    expect(r.colecao[0]!.atualizadoEm).toBe(T0 + 500);
  });

  it('a sobrescrita adota a grafia NOVA do nome', () => {
    // Se o operador corrigiu a caixa, é isso que ele quer ver na lista.
    const c = comUm('fluxo manha');
    const r = salvarTemplate(c, 'Fluxo Manhã', DOC, T0 + 1);
    if (!r.ok) return;
    expect(r.colecao[0]!.nome).toBe('Fluxo Manhã');
  });

  it('recusa nome vazio e documento inválido, com motivo tipado', () => {
    expect(salvarTemplate([], '  ', DOC, T0)).toEqual({ ok: false, motivo: 'NOME_VAZIO' });
    for (const ruim of [null, [], 'texto', 42]) {
      expect(salvarTemplate([], 'X', ruim as never, T0)).toEqual({
        ok: false,
        motivo: 'DOCUMENTO_INVALIDO',
      });
    }
  });

  it('⚠️ recusa acima do teto — mas sobrescrever um existente CONTINUA valendo', () => {
    // O teto protege a lista (com 200 nomes ela deixa de ser escolha) e a cota do
    // armazenamento. Mas travar a sobrescrita no teto impediria de ATUALIZAR um setup, que não
    // consome espaço novo.
    let c: ColecaoDeTemplates = [];
    for (let i = 0; i < MAX_TEMPLATES; i++) {
      const r = salvarTemplate(c, `Setup ${i}`, DOC, T0 + i);
      if (!r.ok) throw new Error('teto atingido antes do esperado');
      c = r.colecao;
    }
    expect(salvarTemplate(c, 'Um mais', DOC, T0)).toEqual({
      ok: false,
      motivo: 'LIMITE_ATINGIDO',
    });
    const sobrescreve = salvarTemplate(c, 'Setup 3', { novo: true }, T0 + 999);
    expect(sobrescreve.ok).toBe(true);
  });

  it('não muta a coleção de entrada', () => {
    const c = comUm();
    const antes = JSON.stringify(c);
    salvarTemplate(c, 'Outro', DOC, T0 + 1);
    expect(JSON.stringify(c)).toBe(antes);
  });
});

describe('removerTemplate', () => {
  it('remove por nome, ignorando caixa', () => {
    expect(removerTemplate(comUm('Fluxo'), 'FLUXO')).toHaveLength(0);
  });

  it('⭐ nome inexistente devolve a MESMA referência', () => {
    // É o sinal de "nada mudou" que um consumidor React usa para não re-renderizar.
    const c = comUm();
    expect(removerTemplate(c, 'não existe')).toBe(c);
    expect(removerTemplate(c, '  ')).toBe(c);
  });
});

describe('renomearTemplate — troca de etiqueta NÃO funde setups', () => {
  it('renomeia preservando datas e documento', () => {
    const c = comUm('Fluxo');
    const r = renomearTemplate(c, 'Fluxo', 'Fluxo da abertura');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.colecao[0]!.nome).toBe('Fluxo da abertura');
    expect(r.colecao[0]!.criadoEm).toBe(T0);
    expect(r.colecao[0]!.documento).toEqual(DOC);
  });

  it('⭐⭐ RECUSA quando o nome novo já existe', () => {
    // Diferente de salvar (que sobrescreve de propósito): ali o operador diz "guarde o estado
    // atual com este nome"; aqui ele diz "troque a etiqueta". Deixar a troca apagar outro
    // template destruiria um setup que ele não estava editando.
    let c = comUm('Fluxo');
    const r1 = salvarTemplate(c, 'Tendência', DOC, T0 + 1);
    if (!r1.ok) return;
    c = r1.colecao;
    expect(renomearTemplate(c, 'Fluxo', 'Tendência').ok).toBe(false);
    // E a coleção original segue intacta.
    expect(c).toHaveLength(2);
  });

  it('renomear para o MESMO nome com outra caixa é permitido', () => {
    const c = comUm('fluxo');
    const r = renomearTemplate(c, 'fluxo', 'Fluxo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.colecao[0]!.nome).toBe('Fluxo');
  });

  it('origem inexistente e nome novo vazio são recusados', () => {
    const c = comUm('Fluxo');
    expect(renomearTemplate(c, 'nada', 'Outro').ok).toBe(false);
    expect(renomearTemplate(c, 'Fluxo', '   ').ok).toBe(false);
  });
});

describe('ordenarParaExibicao — uso recente primeiro, e DETERMINÍSTICO', () => {
  it('⭐ ordena por `atualizadoEm` decrescente', () => {
    let c: ColecaoDeTemplates = [];
    for (const [nome, t] of [
      ['Antigo', T0],
      ['Novo', T0 + 1000],
      ['Meio', T0 + 500],
    ] as const) {
      const r = salvarTemplate(c, nome, DOC, t);
      if (!r.ok) return;
      c = r.colecao;
    }
    // Ordem alfabética faria o operador procurar sempre; o setup usado por último é o mais
    // provável de ser usado de novo.
    expect(ordenarParaExibicao(c).map((t) => t.nome)).toEqual(['Novo', 'Meio', 'Antigo']);
  });

  it('⚠️ empate cai no NOME — sem isso a lista trocaria de ordem entre renderizações', () => {
    const c: ColecaoDeTemplates = [
      { nome: 'Zebra', criadoEm: T0, atualizadoEm: T0, documento: DOC },
      { nome: 'Abelha', criadoEm: T0, atualizadoEm: T0, documento: DOC },
    ];
    expect(ordenarParaExibicao(c).map((t) => t.nome)).toEqual(['Abelha', 'Zebra']);
  });

  it('não muta a coleção de entrada', () => {
    const c: ColecaoDeTemplates = [
      { nome: 'B', criadoEm: T0, atualizadoEm: T0, documento: DOC },
      { nome: 'A', criadoEm: T0, atualizadoEm: T0 + 1, documento: DOC },
    ];
    ordenarParaExibicao(c);
    expect(c[0]!.nome).toBe('B');
  });
});

describe('serialização — NUNCA lança, e diz o que descartou', () => {
  it('vai e volta preservando tudo', () => {
    const c = comUm('Fluxo Manhã');
    const lido = desserializarTemplates(JSON.parse(JSON.stringify(serializarTemplates(c))));
    expect(lido.avisos).toEqual([]);
    expect(lido.colecao).toEqual(c);
  });

  it('entrada irreconhecível devolve coleção vazia COM aviso', () => {
    for (const ruim of [null, undefined, 42, 'texto', []]) {
      const r = desserializarTemplates(ruim);
      expect(r.colecao).toEqual([]);
      // ⚠️ Descartar em silêncio faria o operador ver um template a menos sem saber se ele foi
      // perdido ou nunca existiu.
      expect(r.avisos.length).toBeGreaterThan(0);
    }
  });

  it('versão desconhecida NÃO é lida na sorte', () => {
    // Campos com o mesmo nome e outro significado produziriam um setup silenciosamente errado,
    // que é pior que setup nenhum.
    const r = desserializarTemplates({ version: 99, templates: [] });
    expect(r.colecao).toEqual([]);
    expect(r.avisos[0]).toContain('99');
  });

  it('⭐⭐ item corrompido é descartado e o RESTO sobrevive', () => {
    const r = desserializarTemplates({
      version: TEMPLATES_SCHEMA_VERSION,
      templates: [
        { nome: 'Bom', criadoEm: T0, atualizadoEm: T0, documento: DOC },
        null,
        { nome: '', documento: DOC },
        { nome: 'Sem doc', documento: 'texto' },
        { nome: 'Outro bom', criadoEm: T0, atualizadoEm: T0, documento: DOC },
      ],
    });
    // Perder TODOS os templates por causa de um corrompido é o desfecho que isto evita.
    expect(r.colecao.map((t) => t.nome)).toEqual(['Bom', 'Outro bom']);
    expect(r.avisos).toHaveLength(3);
  });

  it('duplicata só pode vir de arquivo editado à mão — a segunda cai', () => {
    const r = desserializarTemplates({
      version: TEMPLATES_SCHEMA_VERSION,
      templates: [
        { nome: 'Fluxo', criadoEm: T0, atualizadoEm: T0, documento: DOC },
        { nome: 'FLUXO', criadoEm: T0, atualizadoEm: T0, documento: { outro: 1 } },
      ],
    });
    expect(r.colecao).toHaveLength(1);
    expect(r.colecao[0]!.documento).toEqual(DOC);
    expect(r.avisos[0]).toContain('duas vezes');
  });

  it('⚠️ data ausente vira 0, não "agora"', () => {
    // Inventar a data faria a ordenação por uso recente mentir. `0` põe o item no fim, que é
    // honesto para "não sei quando".
    const r = desserializarTemplates({
      version: TEMPLATES_SCHEMA_VERSION,
      templates: [{ nome: 'X', documento: DOC }],
    });
    expect(r.colecao[0]!.atualizadoEm).toBe(0);
  });

  it('acima do teto, o resto é descartado com aviso', () => {
    const templates = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => ({
      nome: `S${i}`,
      criadoEm: T0,
      atualizadoEm: T0,
      documento: DOC,
    }));
    const r = desserializarTemplates({ version: TEMPLATES_SCHEMA_VERSION, templates });
    expect(r.colecao).toHaveLength(MAX_TEMPLATES);
    expect(r.avisos.some((a) => a.includes(String(MAX_TEMPLATES)))).toBe(true);
  });
});

describe('acharTemplate', () => {
  it('acha ignorando caixa e espaço; devolve `null` quando não há', () => {
    const c = comUm('Fluxo Manhã');
    expect(acharTemplate(c, 'fluxo  manhã')?.nome).toBe('Fluxo Manhã');
    expect(acharTemplate(c, 'outro')).toBeNull();
    expect(acharTemplate(c, '')).toBeNull();
  });
});
