import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { imageHtml } from '../../lib/media';
import { imageFilesOf, type EditorHandle, type EditorProps } from './types';

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '15px', borderRadius: '10px', border: '1px solid var(--border)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '12px 0', minHeight: '55dvh', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-placeholder': { color: 'var(--muted)' },
});

/** HTML を直接書くエディタ（CodeMirror）。スマホでも動き、タグに色が付く */
const HtmlEditor = forwardRef<EditorHandle, EditorProps>(function HtmlEditor({ value, onChange, onImageFiles, onFocusChange }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onImageFiles, onFocusChange });
  callbacks.current = { onChange, onImageFiles, onFocusChange };

  useEffect(() => {
    const v = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // 閉じタグの自動入力はしない（スマホで閉じタグまで打つと二重になるため）
          html({ autoCloseTags: false }),
          syntaxHighlighting(defaultHighlightStyle),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder('本文（HTML）'),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': '本文（HTML）', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.focusChanged) callbacks.current.onFocusChange?.(u.view.hasFocus);
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const files = imageFilesOf(event.clipboardData);
              if (files.length === 0) return false;
              event.preventDefault();
              callbacks.current.onImageFiles(files);
              return true;
            },
            drop(event) {
              const files = imageFilesOf(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              callbacks.current.onImageFiles(files);
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

  // 外から本文が変わったとき（下書きの復元など）だけ、中身を入れ替える
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertImages(media) {
      const v = view.current;
      if (!v || media.length === 0) return;
      const { from, to } = v.state.selection.main;
      const before = v.state.doc.sliceString(0, from);
      const text = `${before && !before.endsWith('\n') ? '\n' : ''}${media.map(imageHtml).join('\n')}\n`;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div ref={container} className="html-editor" />;
});

export default HtmlEditor;
