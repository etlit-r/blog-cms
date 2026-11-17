import { useEffect, type ReactNode } from 'react';

/** 画面の下から出るパネル（スマホで片手でも操作しやすいように） */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // 後ろの画面がスクロールしないようにする
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="icon-close" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
