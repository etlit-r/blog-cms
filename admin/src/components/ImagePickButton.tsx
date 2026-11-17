import { useRef, type ReactNode } from 'react';

/**
 * 画像を選ぶボタン。スマホではカメラ・写真ライブラリ・ファイルから選べる。
 * 同じ画像をもう一度選んでも反応するよう、選んだ後に入力欄を空に戻す。
 */
export function ImagePickButton({ onPick, children, className = 'btn', disabled }: { onPick: (files: File[]) => void; children: ReactNode; className?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onPick(files);
        }}
      />
    </>
  );
}
