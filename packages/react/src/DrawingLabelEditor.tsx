/**
 * DrawingLabelEditor — onde se escreve o texto de um desenho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ POR QUE ESTE COMPONENTE EXISTE, E POR QUE ELE NÃO É "O EDITOR DA NOTA"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A ferramenta de NOTA foi o que trouxe o assunto: uma nota em que não se digita não é uma
 * ferramenta, é um retângulo com a palavra "Nota" dentro.
 *
 * ⭐ Mas o campo que ela usa — `DrawingStyle.label` — **existe no modelo desde o primeiro
 * commit, e nunca era pintado nem editável**. Ou seja: o buraco não era da nota, era de todas as
 * ferramentas. Então este editor atende QUALQUER desenho selecionado, e a nota é só o caso em
 * que o rótulo é o desenho inteiro. Uma linha de tendência marcada "topo do leilão de 12/09" vale
 * o mesmo trabalho e não custou uma linha de código a mais.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ONDE ELE FICA, E POR QUE NÃO SOBRE A NOTA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O caminho consagrado é um campo flutuante ancorado no próprio desenho. Foi rejeitado por três
 * motivos concretos:
 *
 *  1. **Ele cobre o que a nota comenta.** A nota é posta ao lado de uma vela justamente para
 *     apontar aquela vela; um campo de entrada em cima dela esconde o motivo da nota.
 *  2. **Ele tem de perseguir o pan e o zoom.** A posição sai do motor, não do React, então o
 *     campo precisaria ser reposicionado a cada quadro — e um `<input>` que se move enquanto se
 *     digita perde o cursor de texto em alguns navegadores.
 *  3. **Ele não tem lugar quando o desenho sai da tela.** Rolando o gráfico, a nota selecionada
 *     vai para fora e o campo teria de desaparecer no meio da digitação.
 *
 * ⭐ Ancorado no canto, nada disso acontece: o campo é sempre alcançável, sempre visível, e o
 * vínculo com o desenho é dito pelo REALCE (o desenho selecionado já fica em ciano) em vez de
 * pela proximidade.
 *
 * ⚠️ Divide o rodapé com `ToolHelpStrip`, e na prática os dois não coexistem: a faixa de ajuda
 * aparece quando há FERRAMENTA armada, e a seleção acontece no modo cursor. Fica na direita, a
 * faixa na esquerda, e em painel muito estreito eles podem se aproximar — custo aceito para não
 * inventar um terceiro canto.
 *
 * ⚠️⚠️ `pointerEvents` aqui é o OPOSTO do resto das camadas de cromo: `'auto'` no bloco inteiro,
 * de propósito. As outras precisam deixar o clique passar para o gráfico; esta é um campo de
 * texto, e um campo que não recebe ponteiro não é campo. O que a mantém inofensiva é ela só
 * existir com um desenho selecionado, o que já é modo de seleção — não há gesto de desenho em
 * curso para engolir.
 */
import { useEffect, useRef, useState } from 'react';
import type { Drawing, DrawingStyle } from '@robustus/charts-drawings';
import { Icon } from './icons.js';

/**
 * Teto de caracteres do rótulo.
 *
 * ⚠️ 64 e não ilimitado: a largura da caixa pintada no canvas é ESTIMADA a partir da contagem de
 * caracteres (o núcleo puro não mede texto), e um rótulo de 400 caracteres viraria uma faixa
 * atravessando o gráfico de ponta a ponta, cobrindo as velas que ele deveria explicar. Quem
 * precisa de parágrafo precisa de um diário de operação, não de uma etiqueta.
 */
export const MAX_ROTULO_DE_DESENHO = 64;

export interface DrawingLabelEditorProps {
  /** A coleção corrente. */
  readonly drawings: readonly Drawing[];
  /** Ids selecionados. */
  readonly selectedIds: readonly string[];
  /**
   * Aplica o estilo. Deve AGRUPAR o histórico — use `useDrawings().setStyle`.
   *
   * ⚠️ Não use `load` aqui: ele zera o desfazer, e escrever um rótulo apagaria o histórico de
   * tudo o que foi desenhado antes.
   */
  readonly onChangeStyle: (id: string, style: DrawingStyle) => void;
  /** Fecha o passo de desfazer. Chamado no `blur` e no `Enter`. */
  readonly onCommit?: () => void;
  /** Rótulo acessível do bloco. */
  readonly ariaLabel?: string;
}

/**
 * O desenho a editar, ou `null`.
 *
 * ⚠️ **Seleção múltipla não edita**, e a recusa é deliberada: escrever o mesmo texto em cinco
 * desenhos de uma vez é quase sempre acidente (o operador acabou de fazer seleção por laço), e
 * "aplicar em todos" é destrutivo e sem aviso. Editar só o primeiro seria pior ainda — mudaria
 * um desenho que o operador não está olhando.
 */
function alvoDaEdicao(
  drawings: readonly Drawing[],
  selectedIds: readonly string[],
): Drawing | null {
  if (selectedIds.length !== 1) return null;
  const id = selectedIds[0];
  return drawings.find((d) => d.id === id) ?? null;
}

export function DrawingLabelEditor({
  drawings,
  selectedIds,
  onChangeStyle,
  onCommit,
  ariaLabel = 'Texto do desenho selecionado',
}: DrawingLabelEditorProps): JSX.Element | null {
  const alvo = alvoDaEdicao(drawings, selectedIds);
  const alvoId = alvo?.id ?? null;

  // O texto é estado LOCAL enquanto se digita, e não lido do desenho a cada tecla.
  //
  // ⚠️ Sem isso o campo não aceita texto intermediário: `labelOf` troca vazio por "Nota", então
  // apagar tudo faria a palavra "Nota" reaparecer no campo no meio da edição — o operador
  // apagaria a mesma coisa para sempre.
  const [texto, setTexto] = useState('');
  const idAnterior = useRef<string | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);

  // Lê o rótulo CRU (`style.label`), e não o resolvido por `labelOf`: o texto de partida é coisa
  // da PINTURA, e trazê-lo para o campo faria a nota nascer com "Nota" digitado dentro — que o
  // operador teria de apagar antes de escrever.
  const rotuloCru = alvo?.style?.label ?? '';

  useEffect(() => {
    const trocouDeDesenho = alvoId !== idAnterior.current;
    idAnterior.current = alvoId;
    // ⭐⭐ Quem manda depende do FOCO, e a regra fecha os dois defeitos de uma vez:
    //
    //  - **enquanto se digita, o local manda.** Sincronizar a cada tecla faria o campo lutar com
    //    o operador (e o `trim` do `labelOf` reporia o texto de partida a cada apagar).
    //  - **fora do foco, o desenho manda.** Sem isto, `Ctrl+Z` reverteria o rótulo no gráfico e o
    //    campo continuaria mostrando o texto desfeito — a próxima tecla o regravaria, e o
    //    desfazer pareceria não funcionar.
    const focado = campoRef.current !== null && document.activeElement === campoRef.current;
    if (trocouDeDesenho || !focado) setTexto(rotuloCru);
  }, [alvoId, rotuloCru]);

  if (alvo === null || alvoId === null) return null;

  const aplicar = (valor: string): void => {
    setTexto(valor);
    // ⚠️ Texto vazio grava string vazia e NÃO remove o campo. `labelOf` já trata vazio como
    // ausente (a nota volta ao placeholder, as outras ferramentas perdem o rótulo), e remover a
    // chave exigiria um caminho de "apagar propriedade" que `withStyle` não tem — ele mescla.
    onChangeStyle(alvoId, { label: valor });
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        position: 'absolute',
        right: 10,
        bottom: 30,
        zIndex: 6,
        // Ver a nota do cabeçalho: aqui `'auto'` é o comportamento correto, e é seguro porque o
        // bloco só existe no modo de seleção.
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 320,
        padding: '5px 7px',
        borderRadius: 6,
        border: '1px solid #24344d',
        background: 'rgba(15, 23, 36, 0.94)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.34)',
        font: '11px ui-sans-serif, system-ui, sans-serif',
        color: '#cbd5e1',
      }}
    >
      <span aria-hidden="true" style={{ display: 'flex', color: '#818cf8' }}>
        <Icon name="textNote" size={13} />
      </span>
      <input
        ref={campoRef}
        type="text"
        value={texto}
        maxLength={MAX_ROTULO_DE_DESENHO}
        // ⭐ O placeholder do campo diz o que ACONTECE, e não o que o campo é. "Rótulo" faria o
        // operador adivinhar onde o texto vai aparecer.
        placeholder="escreva no gráfico…"
        aria-label={ariaLabel}
        onChange={(e) => aplicar(e.target.value)}
        onBlur={() => onCommit?.()}
        onKeyDown={(e) => {
          // ⚠️ `stopPropagation` sempre, e não só no Enter. O controlador de desenho escuta
          // `keydown` no DOCUMENTO e trata `Delete`, `Escape` e `Ctrl+Z`; ele já tem guarda para
          // campo de texto, mas os ATALHOS DE FERRAMENTA da barra (`T`, `R`, `B`…) não têm — sem
          // isto, digitar "retorno do topo" armaria três ferramentas no caminho.
          e.stopPropagation();
          if (e.key === 'Enter') {
            onCommit?.();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        style={{
          flex: '1 1 auto',
          minWidth: 120,
          padding: '3px 6px',
          borderRadius: 4,
          border: '1px solid #2b3d59',
          background: '#0b1220',
          color: '#e2e8f0',
          font: 'inherit',
          outline: 'none',
        }}
      />
      {texto === '' ? null : (
        <button
          type="button"
          aria-label="Apagar o texto"
          title="Apagar o texto"
          onClick={() => {
            aplicar('');
            onCommit?.();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 3,
            borderRadius: 4,
            border: '1px solid transparent',
            background: 'transparent',
            color: '#94a3b8',
            cursor: 'pointer',
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}
