import { useState } from 'react';
import type { Media } from '../lib/types';
import { useMediaList } from '../lib/useMediaList';
import { MediaGrid } from './MediaGrid';
import { Sheet } from './Sheet';

/** アップロード済みの画像から選んで挿入する（複数選べる） */
export function MediaPicker({ onInsert, onClose }: { onInsert: (media: Media[]) => void; onClose: () => void }) {
  const list = useMediaList();
  const [selected, setSelected] = useState<Media[]>([]);

  function toggle(m: Media) {
    setSelected((prev) => (prev.some((x) => x.id === m.id) ? prev.filter((x) => x.id !== m.id) : [...prev, m]));
  }

  return (
    <Sheet title="ライブラリから挿入" onClose={onClose}>
      <div className="stack">
        {list.error && <p className="error" role="alert">{list.error}</p>}
        {list.items?.length === 0 && <p className="hint center">まだ画像がありません</p>}
        {list.items && <MediaGrid items={list.items} onSelect={toggle} selectedIds={new Set(selected.map((m) => m.id))} />}
        {list.loading && <p className="hint center">読み込み中…</p>}
        {list.hasMore && !list.loading && (
          <button type="button" className="btn" onClick={list.loadMore}>
            もっと見る
          </button>
        )}
      </div>
      <div className="sheet-footer">
        <button type="button" className="btn primary" disabled={selected.length === 0} onClick={() => onInsert(selected)}>
          {selected.length > 0 ? `${selected.length} 枚を挿入` : '画像を選んでください'}
        </button>
      </div>
    </Sheet>
  );
}
