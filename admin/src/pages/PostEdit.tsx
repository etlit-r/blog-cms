import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { CoverPicker } from '../components/CoverPicker';
import { Field } from '../components/Field';
import { ImagePickButton } from '../components/ImagePickButton';
import { MediaPicker } from '../components/MediaPicker';
import { TagInput } from '../components/TagInput';
import { UploadProgress } from '../components/UploadProgress';
import { ApiError, api } from '../lib/api';
import { STATE_LABELS, fromLocalInput, toLocalInput } from '../lib/format';
import { imageHtml } from '../lib/media';
import type { Media, Post } from '../lib/types';
import { useSettings } from '../lib/useSettings';
import { useUploadQueue } from '../lib/useUploadQueue';

/** 編集中の内容（保存済みの内容と比べて、未保存かどうかを判定する） */
type Form = {
  title: string;
  bodyHtml: string;
  tags: string[];
  slug: string;
  excerpt: string; // 空なら本文から自動生成
  status: 'draft' | 'published';
  publishedAt: number | null;
  coverImage: string | null; // 手動で選んだカバー（/media/...）。null なら本文の先頭の画像
};

const EMPTY: Form = { title: '', bodyHtml: '', tags: [], slug: '', excerpt: '', status: 'draft', publishedAt: null, coverImage: null };

function formOf(post: Post): Form {
  return {
    title: post.title,
    bodyHtml: post.bodyHtml,
    tags: post.tags,
    slug: post.slug,
    excerpt: post.excerptAuto ? '' : post.excerpt,
    status: post.status,
    publishedAt: post.publishedAt,
    coverImage: post.coverAuto ? null : post.coverUrl,
  };
}

export function PostEdit() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { settings } = useSettings();

  const [post, setPost] = useState<Post | null>(null); // 最後に保存（読み込み）した内容
  const [form, setForm] = useState<Form>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string; conflict?: boolean } | null>(null);
  const [showSettings, setShowSettings] = useState(isNew);
  /** 保存・削除の直後の画面移動では、未保存の確認を出さない */
  const leaving = useRef(false);
  const uploads = useUploadQueue();
  const [showLibrary, setShowLibrary] = useState(false);
  /** 本文の入力欄で最後にカーソルがあった位置（ボタンを押すとフォーカスが外れるので覚えておく） */
  const selection = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    // posts/new → posts/:id の移動では同じ画面が使い回されるので、ここで戻す
    leaving.current = false;
    if (isNew) return;
    let cancelled = false;
    api<{ post: Post }>(`/posts/${id}`)
      .then(({ post }) => {
        if (cancelled) return;
        setPost(post);
        setForm(formOf(post));
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const saved = useMemo(() => (post ? formOf(post) : EMPTY), [post]);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  // 未保存のまま画面を離れようとしたら確認する（アプリ内の移動とタブを閉じる操作の両方）
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('保存していない変更があります。破棄して移動しますか？')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function rememberSelection(el: HTMLTextAreaElement) {
    selection.current = { start: el.selectionStart, end: el.selectionEnd };
  }

  /** 画像のタグを、本文のカーソルの位置（なければ末尾）に挿入する */
  function insertImages(media: Media[]) {
    if (media.length === 0) return;
    const snippet = media.map(imageHtml).join('\n');
    const sel = selection.current;
    // 更新関数の中では ref を書き換えない（StrictMode では 2 回呼ばれるため）
    setForm((f) => {
      const { start, end } = sel ?? { start: f.bodyHtml.length, end: f.bodyHtml.length };
      const text = `${start > 0 ? '\n' : ''}${snippet}\n`;
      return { ...f, bodyHtml: f.bodyHtml.slice(0, start) + text + f.bodyHtml.slice(end) };
    });
    // 続けて挿入したときは、今入れた画像の後ろに入るようにする
    if (sel) {
      const next = sel.start + (sel.start > 0 ? 1 : 0) + snippet.length + 1;
      selection.current = { start: next, end: next };
    }
  }

  async function uploadAndInsert(files: File[]) {
    // アップロード中に入力が進んでも、選んだ時点の位置に入れる
    const at = selection.current;
    const uploaded = await uploads.upload(files);
    if (at) selection.current = at;
    insertImages(uploaded);
  }

  /** 本文の入力欄に画像を貼り付け・ドロップしたらアップロードする */
  function imageFilesOf(data: DataTransfer | null): File[] {
    return Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'));
  }

  async function save(nextStatus: Form['status'] = form.status) {
    setSaving(true);
    setMessage(null);
    const body = {
      title: form.title,
      bodyHtml: form.bodyHtml,
      editorMode: 'html', // リッチテキストエディタはフェーズ 4 で追加する
      tags: form.tags,
      slug: form.slug || null,
      excerpt: form.excerpt || null,
      status: nextStatus,
      publishedAt: form.publishedAt,
      coverImage: form.coverImage,
    };
    try {
      const res = isNew
        ? await api<{ post: Post }>('/posts', { method: 'POST', body })
        : await api<{ post: Post }>(`/posts/${id}`, { method: 'PUT', body: { ...body, updatedAt: post!.updatedAt } });
      setPost(res.post);
      setForm(formOf(res.post));
      setMessage({ type: 'success', text: nextStatus === 'published' && res.post.state === 'published' ? '公開しました' : '保存しました' });
      if (isNew) {
        leaving.current = true;
        navigate(`/posts/${res.post.id}`, { replace: true });
      }
    } catch (e) {
      const conflict = e instanceof ApiError && e.code === 'conflict';
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e), conflict });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!post || !window.confirm(`「${post.title || '（無題）'}」を削除しますか？元に戻せません。`)) return;
    try {
      await api(`/posts/${post.id}`, { method: 'DELETE' });
      leaving.current = true;
      navigate('/', { replace: true });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  if (loadError) {
    return (
      <main className="center-screen">
        <p>{loadError}</p>
        <Link to="/" className="btn">
          記事一覧へ
        </Link>
      </main>
    );
  }
  if (!isNew && !post) return <main className="center-screen">読み込み中…</main>;

  const publicLink = post && post.state === 'published' && settings ? `${settings.publicUrl}/posts/${post.slug}` : null;

  return (
    <div className="editor">
      <header className="editor-header">
        <Link to="/" className="icon-btn" aria-label="記事一覧へ戻る">
          ‹
        </Link>
        <span className={`badge ${post?.state ?? 'draft'}`}>{STATE_LABELS[post?.state ?? 'draft']}</span>
        {dirty && <span className="hint">未保存</span>}
        <span className="spacer" />
        <button type="button" className="btn small" disabled={saving || (!dirty && !isNew)} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </button>
        {form.status === 'draft' && (
          <button type="button" className="btn small primary-inline" disabled={saving} onClick={() => void save('published')}>
            公開する
          </button>
        )}
      </header>

      <main className="editor-main">
        {message && (
          <div className={message.type} role={message.type === 'error' ? 'alert' : 'status'}>
            {message.text}
            {message.conflict && (
              <button type="button" className="btn small" onClick={() => window.location.reload()}>
                再読み込み
              </button>
            )}
          </div>
        )}

        <input className="title-input" placeholder="タイトル" aria-label="タイトル" value={form.title} onChange={(e) => set('title', e.target.value)} />

        <div className="editor-toolbar">
          <ImagePickButton className="btn small" onPick={(files) => void uploadAndInsert(files)}>
            画像を追加
          </ImagePickButton>
          <button type="button" className="btn small" onClick={() => setShowLibrary(true)}>
            ライブラリから
          </button>
        </div>
        <UploadProgress items={uploads.items} onDismiss={uploads.dismiss} />

        <textarea
          className="body-input"
          placeholder="本文（HTML）"
          aria-label="本文（HTML）"
          spellCheck={false}
          autoCapitalize="none"
          value={form.bodyHtml}
          onChange={(e) => {
            set('bodyHtml', e.target.value);
            rememberSelection(e.target);
          }}
          onSelect={(e) => rememberSelection(e.currentTarget)}
          onPaste={(e) => {
            const files = imageFilesOf(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault();
            rememberSelection(e.currentTarget);
            void uploadAndInsert(files);
          }}
          onDragOver={(e) => imageFilesOf(e.dataTransfer).length > 0 && e.preventDefault()}
          onDrop={(e) => {
            const files = imageFilesOf(e.dataTransfer);
            if (files.length === 0) return;
            e.preventDefault();
            rememberSelection(e.currentTarget);
            void uploadAndInsert(files);
          }}
        />
        <p className="hint">今は HTML で書きます。リッチテキストでの編集は、この後の開発段階で追加します。画像は貼り付けやドロップでも追加できます。</p>

        <section className="card">
          <button type="button" className="disclosure" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
            記事設定
            <span aria-hidden="true">{showSettings ? '▲' : '▼'}</span>
          </button>
          {showSettings && (
            <div className="stack" style={{ marginTop: 16 }}>
              <CoverPicker bodyHtml={form.bodyHtml} value={form.coverImage} onChange={(v) => set('coverImage', v)} />

              <TagInput value={form.tags} onChange={(tags) => set('tags', tags)} />

              <div className="field">
                <span className="label">公開状態</span>
                <div className="segmented">
                  {(['draft', 'published'] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={form.status === s} onClick={() => set('status', s)}>
                      {s === 'draft' ? '下書き' : '公開'}
                    </button>
                  ))}
                </div>
              </div>

              <Field
                label="公開日時"
                type="datetime-local"
                hint="未来の日時にすると、その時刻に公開されます（予約投稿）。空なら公開した時刻になります。"
                value={toLocalInput(form.publishedAt)}
                onChange={(e) => set('publishedAt', fromLocalInput(e.target.value))}
              />

              <Field
                label="URL"
                hint={`半角英小文字・数字・ハイフン。空なら自動で決めます。${settings ? `\n${settings.publicUrl}/posts/${form.slug || '…'}` : ''}`}
                autoCapitalize="none"
                autoComplete="off"
                inputMode="url"
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
              />

              <div className="field">
                <label htmlFor="excerpt">抜粋</label>
                <textarea
                  id="excerpt"
                  rows={3}
                  placeholder={post?.excerptAuto ? post.excerpt : '空なら本文の先頭から自動で作ります'}
                  value={form.excerpt}
                  onChange={(e) => set('excerpt', e.target.value)}
                />
                <p className="hint">一覧や検索結果に表示される紹介文です。空なら本文の先頭から自動で作ります。</p>
              </div>

              {publicLink && (
                <a href={publicLink} target="_blank" rel="noopener" className="btn">
                  公開ページを見る
                </a>
              )}
              {post && (
                <button type="button" className="btn danger" onClick={() => void remove()}>
                  この記事を削除
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      {showLibrary && (
        <MediaPicker
          onClose={() => setShowLibrary(false)}
          onInsert={(media) => {
            insertImages(media);
            setShowLibrary(false);
          }}
        />
      )}
    </div>
  );
}
