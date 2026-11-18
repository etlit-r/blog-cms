import type { Media } from '../../lib/types';

export type EditorMode = 'rich' | 'html';

/** 本文エディタ（リッチ / HTML）に共通の操作 */
export type EditorHandle = {
  /** 画像をカーソルの位置に挿入する */
  insertImages: (media: Media[]) => void;
  focus: () => void;
};

export type EditorProps = {
  value: string;
  onChange: (html: string) => void;
  /** 画像ファイルが貼り付け・ドロップされたとき */
  onImageFiles: (files: File[]) => void;
  /** エディタにフォーカスが入った・外れたとき（ツールバーをキーボードの上に出すため） */
  onFocusChange?: (focused: boolean) => void;
};

/** 貼り付け・ドロップされたデータから画像ファイルだけを取り出す */
export function imageFilesOf(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'));
}
