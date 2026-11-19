import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BodyEditor } from '../components/editor/BodyEditor';
import type { EditorMode } from '../components/editor/types';
import { Field } from '../components/Field';
import { ApiError, api } from '../lib/api';
import type { FixedPage } from '../lib/types';
import { useSettings } from '../lib/useSettings';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';

type Form = {
  title: string;
  slug: string;
  bodyHtml: string;
  editorMode: EditorMode;
  status: 'draft' | 'published';
  sortOrder: number;
};

const EMPTY: Form = { title: '', slug: '', bodyHtml: '', editorMode: 'rich', status: 'draft', sortOrder: 0 };

const formOf = (p: FixedPage): Form => ({ title: p.title, slug: p.slug, bodyHtml: p.bodyHtml, editorMode: p.editorMode, status: p.status, sortOrder: p.sortOrder });

const sameForm = (a: Form, b: Form) =>
  a.bodyHtml === b.bodyHtml && a.title === b.title && a.slug === b.slug && a.editorMode === b.editorMode && a.status === b.status && a.sortOrder === b.sortOrder;

/** 固定ページの作成・編集 */
export function PageEdit() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [page, setPage] = useState<FixedPage | null>(null); // 最後に保存（読み込み）した内容
  const [form, setForm] = useState<Form>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string; conflict?: boolean } | null>(null);
  const latestForm = useRef(form);
  latestForm.current = form;

  const dirty = !sameForm(form, page ? formOf(page) : EMPTY);
  const leaving = useUnsavedGuard(dirty);

  useEffect(() => {
    leaving.current = false;
    if (isNew) return;
    let cancelled = false;
    api<{ page: FixedPage }>(`/pages/${id}`)
      .then(({ page }) => {
        if (cancelled) return;
        setPage(page);
        setForm(formOf(page));
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, isNew, leaving]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    setMessage(null);
    const sent = form;
    const body = { ...sent, slug: sent.slug || null };
    try {
      const res = isNew
        ? await api<{ page: FixedPage }>('/pages', { method: 'POST', body })
        : await api<{ page: FixedPage }>(`/pages/${id}`, { method: 'PUT', body: { ...body, updatedAt: page!.updatedAt } });
      setPage(res.page);
      // 保存の通信中に入力された内容は消さずに残す
      setForm((f) => (sameForm(f, sent) ? formOf(res.page) : f));
      setMessage({ type: 'success', text: '保存しました' });
      if (isNew) {
        leaving.current = true;
        navigate(`/pages/${res.page.id}`, { replace: true });
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e), conflict: e instanceof ApiError && e.code === 'conflict' });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!page || !window.confirm(`「${page.title}」を削除しますか？元に戻せません。`)) return;
    try {
      await api(`/pages/${page.id}`, { method: 'DELETE' });
      leaving.current = true;
      navigate('/pages', { replace: true });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  if (loadError) {
    return (
      <main className="center-screen">
        <p>{loadError}</p>
        <Link to="/pages" className="btn">
          固定ページへ
        </Link>
      </main>
    );
  }
  if (!isNew && !page) return <main className="center-screen">読み込み中…</main>;

  return (
    <div className="editor">
      <header className="editor-header">
        <Link to="/pages" className="icon-btn" aria-label="固定ページの一覧へ戻る">
          ‹
        </Link>
        <span className={`badge ${page?.status === 'published' ? 'published' : ''}`}>{page?.status === 'published' ? '公開中' : '下書き'}</span>
        {dirty && (
          <span className="unsaved-dot" role="status" aria-label="未保存" title="未保存">
            ●
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn small primary-inline" disabled={saving || (!dirty && !isNew)} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </button>
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
        <input className="title-input" placeholder="タイトル（例: About）" aria-label="タイトル" value={form.title} onChange={(e) => set('title', e.target.value)} />
        <BodyEditor value={form.bodyHtml} mode={form.editorMode} onChange={(html) => set('bodyHtml', html)} onModeChange={(m) => set('editorMode', m)} />

        <section className="card stack">
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
            label="URL"
            hint={`半角英小文字・数字・ハイフン。空なら自動で決めます。${settings ? `\n${settings.publicUrl}/p/${form.slug || '…'}` : ''}`}
            autoCapitalize="none"
            autoComplete="off"
            inputMode="url"
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
          />
          <Field
            label="並び順"
            hint="ヘッダーに並べる順番です。小さい数字ほど前に出ます。"
            type="number"
            inputMode="numeric"
            value={String(form.sortOrder)}
            onChange={(e) => set('sortOrder', Number.parseInt(e.target.value, 10) || 0)}
          />
          {page?.status === 'published' && settings && (
            <a href={`${settings.publicUrl}/p/${page.slug}`} target="_blank" rel="noopener" className="btn">
              公開ページを見る
            </a>
          )}
          {page && (
            <button type="button" className="btn danger" onClick={() => void remove()}>
              この固定ページを削除
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
