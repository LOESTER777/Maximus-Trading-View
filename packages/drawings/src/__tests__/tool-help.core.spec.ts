/**
 * O AUXÍLIO das ferramentas.
 *
 * ⭐⭐ O caso que importa mais é `toda ferramenta tem auxílio`: uma ferramenta acrescentada ao
 * `DrawingKind` sem passos passaria silenciosamente, e a faixa de ajuda simplesmente não
 * apareceria para ela — sem erro, sem pista. É a mesma família do teste de unicidade de atalho.
 *
 * ⚠️ E há um caso que verifica o TEXTO contra o modelo (`ANCHORS_REQUIRED`), não a beleza dele:
 * ferramenta de um clique não pode ter dois passos de clique. Mentira em texto de ajuda é pior
 * que ausência de ajuda, porque o operador confia nela.
 */
import { describe, it, expect } from 'vitest';
import {
  ajudaDeFerramenta,
  ancorasDaFerramenta,
  ferramentasSemAjuda,
} from '../tool-help.core.js';
import { ANCHORS_REQUIRED, type DrawingKind } from '../model.js';

const TODOS = Object.keys(ANCHORS_REQUIRED) as DrawingKind[];

describe('auxílio de ferramenta', () => {
  it('⭐⭐ TODA ferramenta do modelo tem auxílio', () => {
    expect(TODOS.length, 'bancada vazia: nenhum kind lido do modelo').toBeGreaterThanOrEqual(13);
    expect(ferramentasSemAjuda(TODOS)).toEqual([]);
  });

  it('⚠️ o modo de SELEÇÃO não tem auxílio — faixa permanente é ruído', () => {
    expect(ajudaDeFerramenta(null)).toBeNull();
  });

  it('cada auxílio tem nome e pelo menos um passo', () => {
    for (const k of TODOS) {
      const a = ajudaDeFerramenta(k);
      expect(a, `sem auxílio: ${k}`).not.toBeNull();
      expect(a?.nome.length ?? 0, k).toBeGreaterThan(2);
      expect(a?.passos.length ?? 0, k).toBeGreaterThan(0);
      for (const p of a?.passos ?? []) expect(p.trim().length, k).toBeGreaterThan(8);
    }
  });

  it('⚠️ o número de passos de CLIQUE não contradiz `ANCHORS_REQUIRED`', () => {
    // Ferramenta de UMA âncora com dois passos de clique ensinaria um gesto que não existe.
    for (const k of TODOS) {
      const a = ajudaDeFerramenta(k);
      if (a === null) continue;
      const cliques = a.passos.filter((p) => /clique/i.test(p)).length;
      expect(cliques, `${k}: ${a.passos.join(' | ')}`).toBeLessThanOrEqual(
        ancorasDaFerramenta(k),
      );
    }
  });

  it('os passos estão no IMPERATIVO (instrução, não descrição)', () => {
    for (const k of TODOS) {
      const primeiro = ajudaDeFerramenta(k)?.passos[0] ?? '';
      expect(primeiro, k).toMatch(/^(Clique|Arraste|Um clique|Marque|Escolha)/);
    }
  });

  it('⭐ o que DEPENDE da ordem das âncoras diz isso', () => {
    // As três ferramentas em que inverter os pontos muda o resultado.
    for (const k of ['POSITION_LONG', 'POSITION_SHORT', 'HORIZONTAL_RAY'] as DrawingKind[]) {
      const a = ajudaDeFerramenta(k);
      const tudo = `${a?.passos.join(' ')} ${a?.ajuste ?? ''}`;
      expect(tudo, k).toMatch(/ENTRADA|STOP|a partir do ponto/i);
    }
  });

  it('a posição diz que o alvo é DERIVADO do múltiplo de risco', () => {
    // ⭐ É a razão de a ferramenta ter duas âncoras e não três, e o operador não adivinha.
    for (const k of ['POSITION_LONG', 'POSITION_SHORT'] as DrawingKind[]) {
      expect(ajudaDeFerramenta(k)?.ajuste ?? '', k).toMatch(/risco|derivado|R\b/i);
    }
  });

  it('`ajuste` é `null` quando não há nada a dizer, nunca string vazia', () => {
    for (const k of TODOS) {
      const aj = ajudaDeFerramenta(k)?.ajuste;
      expect(aj === null || (typeof aj === 'string' && aj.trim().length > 10), k).toBe(true);
    }
  });

  it('`ancorasDaFerramenta` lê o MODELO, não uma cópia', () => {
    for (const k of TODOS) {
      expect(ancorasDaFerramenta(k)).toBe(ANCHORS_REQUIRED[k]);
    }
  });

  it('kind desconhecido não lança', () => {
    expect(ajudaDeFerramenta('NAO_EXISTE' as DrawingKind)).toBeNull();
    expect(ferramentasSemAjuda(['NAO_EXISTE' as DrawingKind])).toEqual(['NAO_EXISTE']);
  });
});
