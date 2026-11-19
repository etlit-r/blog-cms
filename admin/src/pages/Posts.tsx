import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { STATE_LABELS, formatDateTime } from '../lib/format';
import type { PostState, PostSummary } from '../lib/types';

const FILTERS: { value: PostState | ''; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開中' },
  { value: 'scheduled', label: '予約' },
];

type ListResponse = { items: PostSummary[]; nextCursor: string | null };

export function Posts() {
  const [state, setState] = useState<PostState | ''>('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PostSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 最後に出したリクエストの番号。古いリクエストの応答（絞り込みを変える前のもの）は捨てる */
  const latestRequest = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      const requestId = ++latestRequest.current;
      const params = new URLSearchParams();
      if (state) params.set('state', state);
      if (query.trim()) params.set('q', query.trim());
      if (cursor) params.set('cursor', cursor);
      setLoading(true);
      setError(null);
      try {
        const res = await api<ListResponse>(`/posts?${params}`);
        if (requestId !== latestRequest.current) return;
        setItems((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (e) {
        if (requestId === latestRequest.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    },
    [state, query],
  );

  // 絞り込みや検索語が変わったら最初から読み直す（検索は入力が止まってから）
  useEffect(() => {
    const timer = setTimeout(() => void load(null), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="タイトルで検索"
          aria-label="タイトルで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link to="/tags" className="btn small">
          タグ
        </Link>
        <Link to="/pages" className="btn small">
          固定ページ
        </Link>
      </div>

      <div className="segmented" role="tablist" aria-label="公開状態で絞り込み">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" role="tab" aria-selected={state === f.value} onClick={() => setState(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="post-list">
        {items.map((post) => (
          <li key={post.id}>
            <Link to={`/posts/${post.id}`} className="post-item">
              <span className={`badge ${post.state}`}>{STATE_LABELS[post.state]}</span>
              <strong className={post.title ? '' : 'untitled'}>{post.title || '（無題）'}</strong>
              <span className="meta">
                {post.state === 'draft' || post.publishedAt === null
                  ? `更新 ${formatDateTime(post.updatedAt)}`
                  : `${post.state === 'scheduled' ? '公開予定' : '公開'} ${formatDateTime(post.publishedAt)}`}
              </span>
              {post.tags.length > 0 && <span className="meta">{post.tags.map((t) => `#${t}`).join(' ')}</span>}
            </Link>
          </li>
        ))}
      </ul>

      {!loading && items.length === 0 && !error && <p className="hint center">{query || state ? '該当する記事はありません' : 'まだ記事がありません。右下の ＋ から書き始めましょう'}</p>}
      {loading && <p className="hint center">読み込み中…</p>}
      {nextCursor && !loading && (
        <button type="button" className="btn" onClick={() => void load(nextCursor)}>
          もっと見る
        </button>
      )}

      <Link to="/posts/new" className="fab" aria-label="新しい記事を書く">
        ＋
      </Link>
    </div>
  );
}
