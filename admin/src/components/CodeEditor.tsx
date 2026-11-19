import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type CodeLanguage = 'html' | 'css';

export type CodeEditorHandle = {
  /**
   * カーソルの位置に文字を入れる。cursorBack を指定すると、入れた文字の末尾からその文字数だけ戻った位置にカーソルを置く
   * （例: 「{{}}」を入れて、カーソルを {{ と }} の間に置く）。
   * atEndIfUntouched が true で、まだ一度も入力欄にカーソルを置いていなければ、末尾に入れる。
   */
  insertText: (text: string, options?: { cursorBack?: number; atEndIfUntouched?: boolean }) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  ariaLabel: string;
  placeholderText?: string;
  onFocusChange?: (focused: boolean) => void;
  /** ファイルが貼り付け・ドロップされたとき（処理したら true を返す） */
  onFiles?: (data: DataTransfer | null) => boolean;
};

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '15px', borderRadius: '10px', border: '1px solid var(--border)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '12px 0', minHeight: '55dvh', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-placeholder': { color: 'var(--muted)' },
});

/** コードを書くエディタ（CodeMirror 6）。スマホでも動き、HTML・CSS に色が付く */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, language, ariaLabel, placeholderText, onFocusChange, onFiles },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** 一度でも入力欄にカーソルを置いたか */
  const touched = useRef(false);
  const callbacks = useRef({ onChange, onFocusChange, onFiles });
  callbacks.current = { onChange, onFocusChange, onFiles };

  useEffect(() => {
    const v = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // 閉じタグの自動入力はしない（スマホで閉じタグまで打つと二重になるため）
          language === 'css' ? css() : html({ autoCloseTags: false }),
          syntaxHighlighting(defaultHighlightStyle),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          placeholder(placeholderText ?? ''),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.focusChanged) {
              if (u.view.hasFocus) touched.current = true;
              callbacks.current.onFocusChange?.(u.view.hasFocus);
            }
          }),
          EditorView.domEventHandlers({
            paste(event) {
              if (!callbacks.current.onFiles?.(event.clipboardData)) return false;
              event.preventDefault();
              return true;
            },
            drop(event) {
              if (!callbacks.current.onFiles?.(event.dataTransfer)) return false;
              event.preventDefault();
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // エディタは最初に 1 度だけ作る（本文の変更は下の effect で反映する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外から内容が変わったとき（下書きの復元・履歴からの復元など）だけ、中身を入れ替える
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertText(text, options = {}) {
      const v = view.current;
      if (!v) return;
      const end = v.state.doc.length;
      const { from, to } = !touched.current && options.atEndIfUntouched ? { from: end, to: end } : v.state.selection.main;
      const cursor = from + text.length - (options.cursorBack ?? 0);
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: cursor } });
      v.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div ref={container} className="code-editor" />;
});
