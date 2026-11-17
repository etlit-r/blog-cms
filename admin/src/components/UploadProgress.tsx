import type { UploadItem } from '../lib/useUploadQueue';

export function UploadProgress({ items, onDismiss }: { items: UploadItem[]; onDismiss: (key: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="upload-list" aria-live="polite">
      {items.map((it) => (
        <li key={it.key} className={it.status}>
          <span className="name">{it.name}</span>
          {it.status === 'error' ? (
            <>
              <span className="error">{it.error}</span>
              <button type="button" className="icon-close" aria-label="閉じる" onClick={() => onDismiss(it.key)}>
                ×
              </button>
            </>
          ) : (
            <>
              <progress value={it.status === 'waiting' ? 0 : it.progress} max={1} aria-label={`${it.name} のアップロード`} />
              <span className="hint">{it.status === 'waiting' ? '待機中' : it.status === 'done' ? '完了' : `${Math.round(it.progress * 100)}%`}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
