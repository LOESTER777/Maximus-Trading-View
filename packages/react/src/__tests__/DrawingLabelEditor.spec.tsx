/**
 * O editor do RÓTULO do desenho selecionado.
 *
 * ⭐⭐ Dois casos importam mais que os outros, e nenhum dos dois é sobre digitar:
 *
 *  - **`stopPropagation` no `keydown`**: os atalhos de ferramenta da barra são letras soltas
 *    (`T`, `R`, `B`, `L`…). Sem isso, escrever "retorno do topo" armaria três ferramentas no
 *    caminho, e o operador veria o cursor virar cruz no meio da frase.
 *  - **o campo NÃO nasce com o texto de partida dentro**: `labelOf` troca vazio por "Nota" para
 *    a pintura, e trazer isso ao campo obrigaria a apagar "Nota" antes de escrever.
 *
 * ⚠️ E um caso de recusa: seleção MÚLTIPLA não edita. Aplicar em todos é destrutivo e sem aviso;
 * aplicar só no primeiro muda um desenho que o operador não está olhando.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DrawingLabelEditor, MAX_ROTULO_DE_DESENHO } from '../DrawingLabelEditor.js';
import type { Drawing } from '@robustus/charts-drawings';

afterEach(cleanup);

function nota(id: string, label?: string): Drawing {
  return {
    id,
    kind: 'TEXT_NOTE',
    anchors: [{ timeSec: 100, price: 150 }],
    ...(label === undefined ? {} : { style: { label } }),
  };
}

function linha(id: string, label?: string): Drawing {
  return {
    id,
    kind: 'TRENDLINE',
    anchors: [
      { timeSec: 100, price: 150 },
      { timeSec: 200, price: 170 },
    ],
    ...(label === undefined ? {} : { style: { label } }),
  };
}

describe('DrawingLabelEditor', () => {
  it('não desenha nada sem seleção', () => {
    const { container } = render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={[]} onChangeStyle={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('⚠️ seleção MÚLTIPLA não edita — aplicar em todos seria destrutivo e sem aviso', () => {
    const { container } = render(
      <DrawingLabelEditor
        drawings={[nota('a'), nota('b')]}
        selectedIds={['a', 'b']}
        onChangeStyle={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('id selecionado que não existe na coleção não quebra', () => {
    const { container } = render(
      <DrawingLabelEditor
        drawings={[nota('a')]}
        selectedIds={['fantasma']}
        onChangeStyle={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('⭐⭐ o campo nasce VAZIO numa nota sem texto, e não com o texto de partida', () => {
    render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={() => undefined} />,
    );
    const campo = screen.getByRole('textbox') as HTMLInputElement;
    expect(campo.value).toBe('');
    // Mas o campo diz o que vai acontecer.
    expect(campo.placeholder.length).toBeGreaterThan(4);
  });

  it('carrega o texto já escrito', () => {
    render(
      <DrawingLabelEditor
        drawings={[nota('a', 'topo do leilão')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('topo do leilão');
  });

  it('⭐⭐ serve a QUALQUER ferramenta, e não só à nota', () => {
    // O campo `style.label` existia desde o início e nunca era editável nem pintado. Restringir o
    // editor à nota desperdiçaria o ganho em dezenove ferramentas.
    const onChangeStyle = vi.fn();
    render(
      <DrawingLabelEditor drawings={[linha('t1')]} selectedIds={['t1']} onChangeStyle={onChangeStyle} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'LTA do dia' } });
    expect(onChangeStyle).toHaveBeenCalledWith('t1', { label: 'LTA do dia' });
  });

  it('cada tecla aplica — e é `setStyle` (que agrupa) que a aplicação deve passar', () => {
    const onChangeStyle = vi.fn();
    render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={onChangeStyle} />,
    );
    const campo = screen.getByRole('textbox');
    fireEvent.change(campo, { target: { value: 'su' } });
    fireEvent.change(campo, { target: { value: 'sup' } });
    expect(onChangeStyle).toHaveBeenCalledTimes(2);
    expect(onChangeStyle).toHaveBeenLastCalledWith('a', { label: 'sup' });
  });

  it('⭐⭐ `keydown` NÃO escapa do campo — senão digitar armaria ferramentas', () => {
    const espiao = vi.fn();
    document.addEventListener('keydown', espiao);
    try {
      render(
        <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={() => undefined} />,
      );
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'B' });
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', espiao);
    }
  });

  it('`Enter` fecha o passo de desfazer e tira o foco', () => {
    const onCommit = vi.fn();
    render(
      <DrawingLabelEditor
        drawings={[nota('a', 'x')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalled();
  });

  it('`blur` fecha o passo de desfazer', () => {
    const onCommit = vi.fn();
    render(
      <DrawingLabelEditor
        drawings={[nota('a', 'x')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
        onCommit={onCommit}
      />,
    );
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('o botão de apagar só existe com texto, e limpa o rótulo', () => {
    const onChangeStyle = vi.fn();
    const { rerender } = render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={onChangeStyle} />,
    );
    expect(screen.queryByRole('button', { name: 'Apagar o texto' })).toBeNull();

    rerender(
      <DrawingLabelEditor
        drawings={[nota('a', 'algo')]}
        selectedIds={['a']}
        onChangeStyle={onChangeStyle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apagar o texto' }));
    expect(onChangeStyle).toHaveBeenCalledWith('a', { label: '' });
  });

  it('⭐ trocar de desenho RECARREGA o campo (não fica com o texto do anterior)', () => {
    const { rerender } = render(
      <DrawingLabelEditor
        drawings={[nota('a', 'primeiro'), nota('b', 'segundo')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('primeiro');
    rerender(
      <DrawingLabelEditor
        drawings={[nota('a', 'primeiro'), nota('b', 'segundo')]}
        selectedIds={['b']}
        onChangeStyle={() => undefined}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('segundo');
  });

  it('⚠️ apagar tudo NÃO faz o texto de partida reaparecer no campo', () => {
    // Sem estado local, `labelOf` devolveria "Nota" e o operador apagaria a mesma coisa para
    // sempre. O texto de partida é coisa da PINTURA, não da edição.
    const onChangeStyle = vi.fn();
    render(
      <DrawingLabelEditor
        drawings={[nota('a', 'algo')]}
        selectedIds={['a']}
        onChangeStyle={onChangeStyle}
      />,
    );
    const campo = screen.getByRole('textbox') as HTMLInputElement;
    campo.focus();
    fireEvent.change(campo, { target: { value: '' } });
    expect(campo.value).toBe('');
  });

  it('⭐⭐ enquanto o campo tem FOCO, o texto local vence o do desenho', () => {
    // Sincronizar a cada tecla faria o campo lutar com quem digita.
    const { rerender } = render(
      <DrawingLabelEditor
        drawings={[nota('a', 'antigo')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    const campo = screen.getByRole('textbox') as HTMLInputElement;
    campo.focus();
    fireEvent.change(campo, { target: { value: 'digitando' } });
    rerender(
      <DrawingLabelEditor
        drawings={[nota('a', 'digitando')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    expect(campo.value).toBe('digitando');
  });

  it('⭐⭐ FORA do foco, o desenho vence — é o que faz o `Ctrl+Z` funcionar', () => {
    // Sem isto, desfazer reverteria o rótulo no gráfico e o campo continuaria mostrando o texto
    // desfeito; a próxima tecla o regravaria e o desfazer pareceria quebrado.
    const { rerender } = render(
      <DrawingLabelEditor
        drawings={[nota('a', 'depois do desfazer')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    rerender(
      <DrawingLabelEditor
        drawings={[nota('a', 'texto revertido')]}
        selectedIds={['a']}
        onChangeStyle={() => undefined}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('texto revertido');
  });

  it('⚠️ o rótulo tem TETO de caracteres — a largura da caixa é estimada por contagem', () => {
    render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={() => undefined} />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).maxLength).toBe(MAX_ROTULO_DE_DESENHO);
    expect(MAX_ROTULO_DE_DESENHO).toBeLessThan(200);
  });

  it('⚠️⚠️ CAPTURA ponteiro, ao contrário das outras camadas de cromo', () => {
    // É o oposto de `ToolHelpStrip` e `PaneChrome`, e de propósito: um campo de texto que não
    // recebe ponteiro não é campo. Seguro porque ele só existe com desenho selecionado, o que já
    // é modo de seleção — não há gesto de desenho em curso para engolir.
    const { container } = render(
      <DrawingLabelEditor drawings={[nota('a')]} selectedIds={['a']} onChangeStyle={() => undefined} />,
    );
    const bloco = container.firstElementChild as HTMLElement;
    expect(bloco.style.pointerEvents).toBe('auto');
    expect(bloco.getAttribute('role')).toBe('group');
  });
});
