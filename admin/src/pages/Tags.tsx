import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { tagKey } from '../lib/tags';
import type { Tag } from '../lib/types';

/** タグの一覧・名前変更・統合・削除 */
export function Tags() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setTags((await api<{ items: Tag[] }>('/tags')).items);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    setMessage(null);
    try {
      const result = await action();
      setEditing(null);
      setMessage({ type: 'success', text: typeof success === 'function' ? success(result) : success });
      await load();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function rename(tag: Tag, name: string) {
    try {
      await api(`/tags/${tag.id}`, { method: 'PUT', body: { name } });
      setEditing(null);
      setMessage({ type: 'success', text: `「${name}」に変更しました` });
      await load();
    } catch (e) {
      // 同じ名前のタグがあれば、統合するか確認する
      const existing = e instanceof ApiError && e.code === 'tag_exists' ? tags?.find((t) => tagKey(t.name) === tagKey(name)) : null;
      if (existing && window.confirm(`「${existing.name}」がすでにあります。「${tag.name}」を「${existing.name}」に統合しますか？`)) {
        await run(() => api(`/tags/${tag.id}/merge`, { method: 'POST', body: { intoId: existing.id } }), `「${existing.name}」に統合しました`);
        return;
      }
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const unused = tags?.filter((t) => t.postCount === 0).length ?? 0;

  return (
    <div className="stack">
      {message && (
        <p className={message.type} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {tags === null && <p className="hint center">読み込み中…</p>}
      {tags?.length === 0 && <p className="hint center">タグはまだありません。記事の編集画面で追加できます。</p>}

      <ul className="tag-rows">
        {tags?.map((tag) => (
          <li key={tag.id} className="card">
            {editing === tag.id ? (
              <TagEditor
                tag={tag}
                others={tags.filter((t) => t.id !== tag.id)}
                onRename={(name) => void rename(tag, name)}
                onMerge={(into) =>
                  void run(() => api(`/tags/${tag.id}/merge`, { method: 'POST', body: { intoId: into.id } }), `「${into.name}」に統合しました`)
                }
                onDelete={() =>
                  window.confirm(`タグ「${tag.name}」を削除しますか？記事からも外れます。`) &&
                  void run(() => api(`/tags/${tag.id}`, { method: 'DELETE' }), `「${tag.name}」を削除しました`)
                }
                onCancel={() => setEditing(null)}
              />
            ) : (
              <button type="button" className="tag-row" onClick={() => setEditing(tag.id)}>
                <span>#{tag.name}</span>
                <span className={tag.postCount === 0 ? 'hint' : 'count'}>{tag.postCount === 0 ? '未使用' : `${tag.postCount}件`}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {unused > 0 && (
        <button
          type="button"
          className="btn"
          onClick={() =>
            window.confirm(`未使用のタグ ${unused} 件を削除しますか？`) &&
            void run(
              () => api<{ deleted: number }>('/tags/delete-unused', { method: 'POST' }),
              ({ deleted }) => `未使用のタグを ${deleted} 件削除しました`,
            )
          }
        >
          未使用のタグをまとめて削除（{unused}件）
        </button>
      )}
    </div>
  );
}

type EditorProps = {
  tag: Tag;
  others: Tag[];
  onRename: (name: string) => void;
  onMerge: (into: Tag) => void;
  onDelete: () => void;
  onCancel: () => void;
};

function TagEditor({ tag, others, onRename, onMerge, onDelete, onCancel }: EditorProps) {
  const [name, setName] = useState(tag.name);
  const [mergeInto, setMergeInto] = useState('');

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== tag.name) onRename(name);
        }}
      >
        <input aria-label="タグ名" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button type="submit" className="btn small">
          名前を変更
        </button>
      </form>

      {others.length > 0 && (
        <div className="row">
          <select aria-label="統合先のタグ" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            <option value="">統合先を選ぶ…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small"
            disabled={!mergeInto}
            onClick={() => {
              const into = others.find((t) => String(t.id) === mergeInto);
              if (into && window.confirm(`「${tag.name}」を「${into.name}」に統合しますか？`)) onMerge(into);
            }}
          >
            統合
          </button>
        </div>
      )}

      <div className="row">
        <button type="button" className="btn small danger" onClick={onDelete}>
          削除
        </button>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onCancel}>
          閉じる
        </button>
      </div>
    </div>
  );
}
