import { forwardRef, useImperativeHandle, useRef } from 'react';
import { imageHtml } from '../../lib/media';
import { CodeEditor, type CodeEditorHandle } from '../CodeEditor';
import { imageFilesOf, type EditorHandle, type EditorProps } from './types';

/** 記事の本文を HTML で書くエディタ。画像の挿入・貼り付けに対応する */
const HtmlEditor = forwardRef<EditorHandle, EditorProps>(function HtmlEditor({ value, onChange, onImageFiles, onFocusChange }, ref) {
  const code = useRef<CodeEditorHandle>(null);

  useImperativeHandle(ref, () => ({
    insertImages(media) {
      if (media.length === 0) return;
      // 画像は前後を改行で区切って、1 行に 1 枚にする（まだカーソルを置いていなければ末尾に入れる）
      code.current?.insertText(`\n${media.map(imageHtml).join('\n')}\n`, { atEndIfUntouched: true });
    },
    focus: () => code.current?.focus(),
  }));

  return (
    <CodeEditor
      ref={code}
      value={value}
      onChange={onChange}
      language="html"
      ariaLabel="本文（HTML）"
      placeholderText="本文（HTML）"
      onFocusChange={onFocusChange}
      onFiles={(data) => {
        const files = imageFilesOf(data);
        if (files.length === 0) return false;
        onImageFiles(files);
        return true;
      }}
    />
  );
});

export default HtmlEditor;
