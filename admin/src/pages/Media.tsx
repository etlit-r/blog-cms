import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ImagePickButton } from '../components/ImagePickButton';
import { MediaGrid } from '../components/MediaGrid';
import { Sheet } from '../components/Sheet';
import { UploadProgress } from '../components/UploadProgress';
import { ApiError, api } from '../lib/api';
import type { Media as MediaItem } from '../lib/types';
import { useMediaList } from '../lib/useMediaList';
import { useSettings } from '../lib/useSettings';
import { useUploadQueue } from '../lib/useUploadQueue';

export function Media() {
  const list = useMediaList();
  const queue = useUploadQueue();
  const [selected, setSelected] = useState<MediaItem | null>(null);

  async function onPick(files: File[]) {
    const added = await queue.upload(files);
    list.prepend(added.map((m) => ({ ...m, usageCount: 0 })));
  }

  return (
    <div className="stack">
      <ImagePickButton onPick={(files) => void onPick(files)} className="btn primary">
        画像をアップロード
      </ImagePickButton>
      <p className="hint">アップロード前に長辺 1600px に縮小し、撮影場所などの情報を取り除きます。複数枚まとめて選べます。</p>
      <UploadProgress items={queue.items} onDismiss={queue.dismiss} />

      {list.error && <p className="error" role="alert">{list.error}</p>}
      {list.items?.length === 0 && <p className="hint center">まだ画像がありません</p>}
      {list.items && <MediaGrid items={list.items} onSelect={setSelected} />}
      {list.loading && <p className="hint center">読み込み中…</p>}
      {list.hasMore && !list.loading && (
        <button type="button" className="btn" onClick={list.loadMore}>
          もっと見る
        </button>
      )}

      {selected && (
        <MediaDetail
          media={selected}
          onClose={() => setSelected(null)}
          onUpdated={(m) => {
            list.update(m);
            setSelected(m);
          }}
          onDeleted={(id) => {
            list.remove(id);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

/** 画像を使っている記事と固定ページ */
type UsedBy = { posts: { id: number; title: string }[]; pages: { id: number; title: string }[] };

function MediaDetail({ media, onClose, onUpdated, onDeleted }: { media: MediaItem; onClose: () => void; onUpdated: (m: MediaItem) => void; onDeleted: (id: number) => void }) {
  const { settings } = useSettings();
  const [alt, setAlt] = useState(media.alt);
  const [usedBy, setUsedBy] = useState<UsedBy | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<UsedBy>(`/media/${media.id}`)
      .then((res) => !cancelled && setUsedBy({ posts: res.posts, pages: res.pages }))
      .catch(() => !cancelled && setUsedBy({ posts: [], pages: [] }));
    return () => {
      cancelled = true;
    };
  }, [media.id]);

  async function saveAlt() {
    try {
      await api(`/media/${media.id}`, { method: 'PUT', body: { alt } });
      onUpdated({ ...media, alt: alt.trim() });
      setMessage({ type: 'success', text: '保存しました' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function copyUrl() {
    const url = settings ? `${settings.publicUrl}${media.url}` : media.url;
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ type: 'success', text: 'URL をコピーしました' });
    } catch {
      setMessage({ type: 'error', text: `コピーできませんでした: ${url}` });
    }
  }

  async function remove() {
    const used = (usedBy?.posts.length ?? 0) + (usedBy?.pages.length ?? 0);
    const question = used > 0 ? `この画像は ${used} 件の記事・固定ページで使われています。削除すると、そのページから画像が表示されなくなります。削除しますか？` : 'この画像を削除しますか？元に戻せません。';
    if (!window.confirm(question)) return;
    try {
      await api(`/media/${media.id}${used > 0 ? '?force=1' : ''}`, { method: 'DELETE' });
      onDeleted(media.id);
    } catch (e) {
      // 確認している間に記事で使われ始めた場合
      if (e instanceof ApiError && e.code === 'in_use') setMessage({ type: 'error', text: `${e.message}。もう一度削除を押すと削除します` });
      else setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
      const res = await api<UsedBy>(`/media/${media.id}`).catch(() => null);
      if (res) setUsedBy({ posts: res.posts, pages: res.pages });
    }
  }

  return (
    <Sheet title="画像の詳細" onClose={onClose}>
      <div className="stack">
        <img className="media-preview" src={media.url} alt={media.alt} width={media.width} height={media.height} />
        <p className="hint">
          {media.width} × {media.height}px・{Math.round(media.bytes / 1024)}KB
        </p>

        <div className="field">
          <label htmlFor="media-alt">代替テキスト</label>
          <div className="row">
            <input id="media-alt" value={alt} maxLength={300} placeholder="画像の内容を短く説明" onChange={(e) => setAlt(e.target.value)} />
            <button type="button" className="btn small" disabled={alt.trim() === media.alt} onClick={() => void saveAlt()}>
              保存
            </button>
          </div>
          <p className="hint">画像が表示できないときや、読み上げ機能で使われます。記事の中の画像には、挿入したときの値が入ります。</p>
        </div>

        {message && (
          <p className={message.type} role={message.type === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}

        <div className="field">
          <span className="label">使っている記事・固定ページ</span>
          {usedBy === null ? (
            <p className="hint">確認中…</p>
          ) : usedBy.posts.length + usedBy.pages.length === 0 ? (
            <p className="hint">どの記事・固定ページでも使われていません</p>
          ) : (
            <ul className="link-list">
              {usedBy.posts.map((p) => (
                <li key={`post-${p.id}`}>
                  <Link to={`/posts/${p.id}`}>{p.title || '（無題）'}</Link>
                </li>
              ))}
              {usedBy.pages.map((p) => (
                <li key={`page-${p.id}`}>
                  <Link to={`/pages/${p.id}`}>固定ページ: {p.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" className="btn" onClick={() => void copyUrl()}>
          URL をコピー
        </button>
        <button type="button" className="btn danger" onClick={() => void remove()}>
          削除
        </button>
      </div>
    </Sheet>
  );
}
