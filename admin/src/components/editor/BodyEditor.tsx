import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import { useUploadQueue } from '../../lib/useUploadQueue';
import { ImagePickButton } from '../ImagePickButton';
import { MediaPicker } from '../MediaPicker';
import { UploadProgress } from '../UploadProgress';
import type { EditorHandle, EditorMode } from './types';

// エディタは大きいので、記事の編集画面を開いたときに読み込む
const RichEditor = lazy(() => import('./RichEditor'));
const HtmlEditor = lazy(() => import('./HtmlEditor'));

type Props = {
  value: string;
  mode: EditorMode;
  onChange: (html: string) => void;
  onModeChange: (mode: EditorMode) => void;
};

/** タッチ操作の端末か（スマホ・タブレット） */
function useCoarsePointer(): boolean {
  const query = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/**
 * 記事本文のエディタ。リッチテキストと HTML を切り替えられる（どちらも保存する形式は HTML）。
 * スマホで入力中は、ツールバーをキーボードのすぐ上に出す。
 */
export function BodyEditor({ value, mode, onChange, onModeChange }: Props) {
  const editor = useRef<EditorHandle>(null);
  const uploads = useUploadQueue();
  const [showLibrary, setShowLibrary] = useState(false);
  const [focused, setFocused] = useState(false);
  const [switching, setSwitching] = useState(false);
  const keyboardInset = useKeyboardInset();
  const coarse = useCoarsePointer();
  const floating = focused && coarse;

  async function uploadAndInsert(files: File[]) {
    const media = await uploads.upload(files);
    editor.current?.insertImages(media);
  }

  async function switchMode(next: EditorMode) {
    if (next === mode) return;
    if (next === 'rich') {
      // HTML → リッチ: リッチテキストで扱えない HTML（script や独自の class など）は消えるので、先に確認する
      setSwitching(true);
      try {
        const { wouldLoseHtml } = await import('./htmlLoss');
        if (wouldLoseHtml(value) && !window.confirm('リッチテキストで扱えない HTML（script、iframe、独自の class など）が含まれています。切り替えると、編集したときにその部分が失われます。切り替えますか？')) return;
      } finally {
        setSwitching(false);
      }
    }
    onModeChange(next);
  }

  const toolbar = (formatButtons?: ReactNode) => (
    <div
      className={`editor-toolbar${floating ? ' floating' : ''}`}
      style={floating ? { bottom: keyboardInset } : undefined}
      role="toolbar"
      aria-label="本文の編集"
    >
      <ImagePickButton className="tool" onPick={(files) => void uploadAndInsert(files)}>
        <span aria-hidden="true">📷</span>
        <span className="tool-label">画像</span>
      </ImagePickButton>
      <button type="button" className="tool" onClick={() => setShowLibrary(true)}>
        <span aria-hidden="true">🖼</span>
        <span className="tool-label">ライブラリ</span>
      </button>
      {formatButtons && <span className="tool-sep" aria-hidden="true" />}
      {formatButtons}
    </div>
  );

  const editorProps = {
    value,
    onChange,
    onImageFiles: (files: File[]) => void uploadAndInsert(files),
    onFocusChange: setFocused,
  };

  return (
    <div className="body-editor">
      <div className="segmented mode-switch" role="tablist" aria-label="本文の書き方">
        {(['rich', 'html'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={switching} onClick={() => void switchMode(m)}>
            {m === 'rich' ? 'リッチテキスト' : 'HTML'}
          </button>
        ))}
      </div>

      <UploadProgress items={uploads.items} onDismiss={uploads.dismiss} />

      <Suspense fallback={<p className="hint center editor-loading">エディタを読み込み中…</p>}>
        {mode === 'rich' ? (
          <RichEditor ref={editor} {...editorProps} toolbarSlot={toolbar} />
        ) : (
          <>
            {toolbar()}
            <HtmlEditor ref={editor} {...editorProps} />
          </>
        )}
      </Suspense>
      {/* ツールバーがキーボードの上に浮いているとき、本文の末尾が隠れないように余白を足す */}
      {floating && <div className="toolbar-spacer" aria-hidden="true" />}

      {showLibrary && (
        <MediaPicker
          onClose={() => setShowLibrary(false)}
          onInsert={(media) => {
            setShowLibrary(false);
            editor.current?.insertImages(media);
          }}
        />
      )}
    </div>
  );
}
