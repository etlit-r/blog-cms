import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { PreviewSheet } from '../components/PreviewSheet';
import { Sheet } from '../components/Sheet';
import { ApiError, api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { HELPER_KEYS, TEMPLATE_VARS } from '../lib/templateVars';
import type { Template, TemplateRevision } from '../lib/types';
import { useCoarsePointer } from '../lib/useCoarsePointer';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';

type Panel = 'preview' | 'vars' | 'history' | null;

/** テンプレート・CSS の編集画面 */
export function TemplateEdit() {
  const name = useParams().name ?? '';
  const [template, setTemplate] = useState<Template | null>(null); // 最後に保存（読み込み）した内容
  const [content, setContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string; conflict?: boolean } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [focused, setFocused] = useState(false);
  const editor = useRef<CodeEditorHandle>(null);
  const keyboardInset = useKeyboardInset();
  const coarse = useCoarsePointer();

  const dirty = template !== null && content !== template.content;
  useUnsavedGuard(dirty);

  useEffect(() => {
    let cancelled = false;
    api<{ template: Template }>(`/templates/${encodeURIComponent(name)}`)
      .then(({ template }) => {
        if (cancelled) return;
        setTemplate(template);
        setContent(template.content);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [name]);

  /** サーバーから返ってきたテンプレートを、保存済みの内容として画面に反映する */
  function applySaved(t: Template, text: string) {
    setTemplate(t);
    setContent(t.content);
    setMessage({ type: 'success', text });
  }

  async function save() {
    if (!template) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api<{ template: Template }>(`/templates/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { content, updatedAt: template.updatedAt },
      });
      applySaved(res.template, '保存しました。公開サイトに反映されています');
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e), conflict: e instanceof ApiError && e.code === 'conflict' });
    } finally {
      setSaving(false);
    }
  }

  async function restore(body: { revisionId: number } | { default: true }, done: string) {
    try {
      const res = await api<{ template: Template }>(`/templates/${encodeURIComponent(name)}/restore`, { method: 'POST', body });
      applySaved(res.template, done);
      setPanel(null);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function resetToDefault() {
    if (!window.confirm('初期の内容に戻しますか？今の内容は履歴に残っているので、後から戻せます。')) return;
    void restore({ default: true }, '初期の内容に戻しました');
  }

  if (loadError) {
    return (
      <main className="center-screen">
        <p>{loadError}</p>
        <Link to="/design" className="btn">
          デザインへ
        </Link>
      </main>
    );
  }
  if (!template) return <main className="center-screen">読み込み中…</main>;

  const language = template.kind === 'css' ? 'css' : 'html';
  const floating = focused && coarse;

  return (
    <div className="editor">
      <header className="editor-header">
        <Link to="/design" className="icon-btn" aria-label="デザインへ戻る">
          ‹
        </Link>
        <strong className="header-title">{template.label}</strong>
        {dirty && <span className="hint">未保存</span>}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => setPanel('preview')}>
          プレビュー
        </button>
        <button type="button" className="btn small primary-inline" disabled={saving || !dirty} onClick={() => void save()}>
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
        <p className="hint">{template.description}</p>

        <div className="row wrap">
          {language === 'html' && (
            <button type="button" className="btn small" onClick={() => setPanel('vars')}>
              変数一覧
            </button>
          )}
          <button type="button" className="btn small" onClick={() => setPanel('history')}>
            履歴
          </button>
          {template.customized && (
            <button type="button" className="btn small" onClick={resetToDefault}>
              初期の内容に戻す
            </button>
          )}
        </div>

        <div
          className={`editor-toolbar${floating ? ' floating' : ''}`}
          style={floating ? { bottom: keyboardInset } : undefined}
          role="toolbar"
          aria-label="記号の入力"
        >
          {HELPER_KEYS[language].map((k) => (
            <button
              key={k.label}
              type="button"
              className="tool mono"
              // 押してもエディタからフォーカスを外さない（キーボードが閉じないように）
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => editor.current?.insertText(k.text, { cursorBack: k.cursorBack })}
            >
              {k.label}
            </button>
          ))}
        </div>

        <CodeEditor ref={editor} value={content} onChange={setContent} language={language} ariaLabel={template.label} onFocusChange={setFocused} />
        {floating && <div className="toolbar-spacer" aria-hidden="true" />}
      </main>

      {panel === 'preview' && (
        <PreviewSheet
          onClose={() => setPanel(null)}
          load={async () => (await api<{ html: string }>('/preview', { method: 'POST', body: { name, templates: { [name]: content } } })).html}
        />
      )}
      {panel === 'vars' && (
        <Sheet title="使える変数" onClose={() => setPanel(null)}>
          <VarList name={name} onInsert={(text) => editor.current?.insertText(text)} />
        </Sheet>
      )}
      {panel === 'history' && (
        <HistorySheet
          name={name}
          onClose={() => setPanel(null)}
          onRestore={(id) => {
            if (dirty && !window.confirm('保存していない変更があります。破棄してこの版に戻しますか？')) return;
            void restore({ revisionId: id }, '選んだ版に戻しました');
          }}
        />
      )}
    </div>
  );
}

function VarList({ name, onInsert }: { name: string; onInsert: (text: string) => void }) {
  return (
    <div className="stack">
      <p className="hint">タップすると、カーソルの位置に入ります。</p>
      {(TEMPLATE_VARS[name] ?? []).map((group) => (
        <section key={group.title} className="stack">
          <h3 className="var-group">{group.title}</h3>
          <dl className="var-list">
            {group.vars.map((v) => (
              <div key={v.name}>
                <dt>
                  <button type="button" className="var-name" onClick={() => onInsert(v.name.split(' ')[0]!)}>
                    {v.name}
                  </button>
                </dt>
                <dd>{v.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function HistorySheet({ name, onClose, onRestore }: { name: string; onClose: () => void; onRestore: (id: number) => void }) {
  const [items, setItems] = useState<TemplateRevision[] | null>(null);
  const [opened, setOpened] = useState<{ id: number; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: TemplateRevision[] }>(`/templates/${encodeURIComponent(name)}/revisions`)
      .then((res) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
  }, [name]);

  async function open(id: number) {
    try {
      const res = await api<{ revision: { id: number; content: string } }>(`/templates/${encodeURIComponent(name)}/revisions/${id}`);
      setOpened(res.revision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Sheet title="履歴" onClose={onClose}>
      <div className="stack">
        {error && <p className="error" role="alert">{error}</p>}
        {items?.length === 0 && <p className="hint center">まだ履歴がありません。保存すると残ります（最新 30 件）。</p>}
        {opened ? (
          <>
            <pre className="revision-content">{opened.content}</pre>
            <div className="row">
              <button type="button" className="btn small" onClick={() => setOpened(null)}>
                一覧に戻る
              </button>
              <span className="spacer" />
              <button type="button" className="btn small primary-inline" onClick={() => onRestore(opened.id)}>
                この版に戻す
              </button>
            </div>
          </>
        ) : (
          <ul className="post-list">
            {items?.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="post-item" onClick={() => void open(r.id)}>
                  <strong>{formatDateTime(r.createdAt)}</strong>
                  <span className="meta">
                    {i === 0 ? '最新・' : ''}
                    {r.length.toLocaleString()} 文字
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
