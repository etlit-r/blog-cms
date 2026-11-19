import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import type { FixedPage } from '../lib/types';

/** 固定ページ（About など）の一覧 */
export function Pages() {
  const [items, setItems] = useState<FixedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: FixedPage[] }>('/pages')
      .then((res) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="stack">
      <p className="hint">About やプロフィールなど、記事の一覧に出さないページです。公開中のページはサイトのヘッダーに並びます。</p>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="hint center">読み込み中…</p>}
      {items?.length === 0 && <p className="hint center">固定ページはまだありません</p>}
      <ul className="post-list">
        {items?.map((p) => (
          <li key={p.id}>
            <Link to={`/pages/${p.id}`} className="post-item">
              <span className={`badge ${p.status === 'published' ? 'published' : ''}`}>{p.status === 'published' ? '公開中' : '下書き'}</span>
              <strong>{p.title}</strong>
              <span className="meta">/p/{p.slug}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/pages/new" className="fab" aria-label="固定ページを作る">
        ＋
      </Link>
    </div>
  );
}
