import type { Media } from '../lib/types';

/** 画像のサムネイルを並べる */
export function MediaGrid({ items, onSelect, selectedIds }: { items: Media[]; onSelect: (m: Media) => void; selectedIds?: Set<number> }) {
  return (
    <ul className="media-grid">
      {items.map((m) => (
        <li key={m.id}>
          <button type="button" aria-pressed={selectedIds?.has(m.id)} aria-label={m.alt || `画像 ${m.id}`} onClick={() => onSelect(m)}>
            <img src={m.thumbUrl} alt="" loading="lazy" width={m.thumbWidth} height={m.thumbHeight} />
            {m.usageCount === 0 && <span className="media-badge">未使用</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
