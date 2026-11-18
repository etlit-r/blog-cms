import type { EditorOptions } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { editorExtensions } from './extensions';
import { imageFilesOf, type EditorHandle, type EditorProps } from './types';

/**
 * エディタの HTML を保存用に整える。
 * 空の文書は ''、末尾の空の段落（画像の後ろなどに自動で入る）は取り除く。
 */
function outputHtml(editor: { isEmpty: boolean; getHTML: () => string }): string {
  return editor.isEmpty ? '' : editor.getHTML().replace(/(?:<p><\/p>)+$/, '');
}

/**
 * Tiptap は描画のたびに設定を前回と比べ、違えばエディタを設定し直す。
 * 拡張機能や editorProps を毎回作り直すと入力中にエディタが壊れるので、設定は一度だけ作る。
 */
const EXTENSIONS = [...editorExtensions(), Placeholder.configure({ placeholder: '本文を書く…' })];

/** リッチテキストエディタ（Tiptap）。保存する形式は HTML */
const RichEditor = forwardRef<EditorHandle, EditorProps & { toolbarSlot: (toolbar: ReactNode) => ReactNode }>(function RichEditor(
  { value, onChange, onImageFiles, onFocusChange, toolbarSlot },
  ref,
) {
  // 最新のコールバックを参照する（エディタは 1 度だけ作るため）
  const callbacks = useRef({ onChange, onImageFiles, onFocusChange });
  /** 一度でも本文にカーソルを置いたか（置いていなければ、画像は末尾に入れる） */
  const touched = useRef(false);
  callbacks.current = { onChange, onImageFiles, onFocusChange };

  // 最初の内容だけを渡す（後から変わった内容は下の effect で反映する）
  const [initialContent] = useState(value);
  const [editorProps] = useState<EditorOptions['editorProps']>(() => ({
    attributes: { class: 'rich-content', 'aria-label': '本文', 'aria-multiline': 'true', role: 'textbox' },
    handlePaste(_view, event) {
      const files = imageFilesOf(event.clipboardData);
      if (files.length === 0) return false;
      callbacks.current.onImageFiles(files);
      return true;
    },
    handleDrop(_view, event) {
      const files = imageFilesOf((event as DragEvent).dataTransfer);
      if (files.length === 0) return false;
      event.preventDefault();
      callbacks.current.onImageFiles(files);
      return true;
    },
  }));

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initialContent,
    immediatelyRender: true,
    editorProps,
    onUpdate: ({ editor }) => callbacks.current.onChange(outputHtml(editor)),
    onFocus: () => {
      touched.current = true;
      callbacks.current.onFocusChange?.(true);
    },
    onBlur: () => callbacks.current.onFocusChange?.(false),
  });

  // 外から本文が変わったとき（下書きの復元など）だけ、エディタの中身を入れ替える
  useEffect(() => {
    // 比較は保存用に整えた HTML 同士で行う（入力のたびに中身を入れ替えてカーソルが飛ばないように）
    if (editor.isDestroyed) return;
    if (value !== outputHtml(editor)) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      insertImages(media) {
        if (editor.isDestroyed || media.length === 0) return;
        // カーソルを置いたことがなければ末尾に入れる。
        // focus() を同じ chain に入れると、フォーカスが外れているときに古い状態の変更が適用されて失敗するので、挿入の後に分けて呼ぶ
        const { from, to } = editor.state.selection;
        const end = editor.state.doc.content.size;
        const range = touched.current ? { from, to } : end;
        editor.commands.insertContentAt(
          range,
          media.map((m) => ({ type: 'image', attrs: { src: m.url, alt: m.alt } })),
        );
        editor.commands.focus();
      },
      focus: () => editor.commands.focus(),
    }),
    [editor],
  );

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  function toggleLink() {
    if (state.link) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const url = window.prompt('リンク先の URL', 'https://');
    if (!url || url === 'https://') return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  const c = () => editor.chain().focus();
  const buttons: { label: string; title: string; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: 'B', title: '太字', active: state.bold, run: () => c().toggleBold().run() },
    { label: 'I', title: '斜体', active: state.italic, run: () => c().toggleItalic().run() },
    { label: 'S', title: '取り消し線', active: state.strike, run: () => c().toggleStrike().run() },
    { label: 'H2', title: '見出し', active: state.h2, run: () => c().toggleHeading({ level: 2 }).run() },
    { label: 'H3', title: '小見出し', active: state.h3, run: () => c().toggleHeading({ level: 3 }).run() },
    { label: '•', title: '箇条書き', active: state.bullet, run: () => c().toggleBulletList().run() },
    { label: '1.', title: '番号付きリスト', active: state.ordered, run: () => c().toggleOrderedList().run() },
    { label: '❝', title: '引用', active: state.quote, run: () => c().toggleBlockquote().run() },
    { label: '🔗', title: state.link ? 'リンクを外す' : 'リンク', active: state.link, run: toggleLink },
    { label: '―', title: '区切り線', run: () => c().setHorizontalRule().run() },
    { label: '↶', title: '元に戻す', disabled: !state.canUndo, run: () => c().undo().run() },
    { label: '↷', title: 'やり直す', disabled: !state.canRedo, run: () => c().redo().run() },
  ];

  const toolbar = (
    <>
      {buttons.map((b) => (
        <button
          key={b.title}
          type="button"
          className="tool"
          title={b.title}
          aria-label={b.title}
          aria-pressed={b.active}
          disabled={b.disabled}
          // ボタンを押してもエディタからフォーカスを外さない（キーボードが閉じないように）
          onPointerDown={(e) => e.preventDefault()}
          onClick={b.run}
        >
          {b.label}
        </button>
      ))}
    </>
  );

  return (
    <>
      {toolbarSlot(toolbar)}
      <EditorContent editor={editor} className="rich-editor" />
    </>
  );
});

export default RichEditor;
