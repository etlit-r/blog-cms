import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { TemplateKind, TemplateSummary } from '../lib/types';

const GROUPS: { kind: TemplateKind; title: string; hint: string }[] = [
  { kind: 'page', title: 'ページ', hint: '公開サイトの各ページの HTML（Mustache 形式）' },
  { kind: 'partial', title: '部品', hint: 'ページから {{> 名前}} で読み込む HTML' },
  { kind: 'css', title: 'CSS', hint: '全ページ共通のスタイル' },
];

/** テンプレートと CSS の一覧 */
export function Design() {
  const [items, setItems] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: TemplateSummary[] }>('/templates')
      .then((res) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="stack-lg">
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="hint center">読み込み中…</p>}
      {items &&
        GROUPS.map((group) => (
          <section key={group.kind} className="stack">
            <div>
              <h2>{group.title}</h2>
              <p className="hint">{group.hint}</p>
            </div>
            <ul className="post-list">
              {items
                .filter((t) => t.kind === group.kind)
                .map((t) => (
                  <li key={t.name}>
                    <Link to={`/design/${encodeURIComponent(t.name)}`} className="post-item">
                      <span className={`badge ${t.customized ? 'scheduled' : ''}`}>{t.customized ? '編集済み' : '初期のまま'}</span>
                      <strong>{t.label}</strong>
                      <span className="meta">{t.description}</span>
                      {t.updatedAt && <span className="meta">更新 {formatDateTime(t.updatedAt)}</span>}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
