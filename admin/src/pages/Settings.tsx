import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Field } from '../components/Field';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSettings } from '../lib/useSettings';
import type { SiteSettings } from '../lib/types';
import { useSubmit } from '../lib/useSubmit';

export function Settings() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const password = useSubmit(async () => {
    setDone(false);
    if (newPassword !== confirm) throw new Error('確認用のパスワードが一致しません');
    await api('/auth/password', { method: 'PUT', body: { currentPassword, newPassword } });
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setDone(true);
  });

  const logout = useSubmit(async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login', { replace: true });
  });

  return (
    <div className="stack-lg">
      <SiteSettingsForm />

      <section className="card stack">
        <h2>アカウント</h2>
        <p>
          ユーザー名: <strong>{status?.username}</strong>
        </p>
        <form onSubmit={logout.onSubmit}>
          {logout.error && <p className="error" role="alert">{logout.error}</p>}
          <button type="submit" className="btn" disabled={logout.pending}>
            ログアウト
          </button>
        </form>
      </section>

      <section className="card">
        <h2>パスワード変更</h2>
        <p className="hint">変更すると、ほかの端末ではログアウトされます。</p>
        <form onSubmit={password.onSubmit} className="stack">
          <Field label="現在のパスワード" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <Field label="新しいパスワード" hint="10 文字以上" type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Field label="新しいパスワード（確認）" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {password.error && <p className="error" role="alert">{password.error}</p>}
          {done && <p className="success" role="status">パスワードを変更しました</p>}
          <button type="submit" className="btn primary" disabled={password.pending}>
            {password.pending ? '変更中…' : 'パスワードを変更'}
          </button>
        </form>
      </section>
    </div>
  );
}

function SiteSettingsForm() {
  const { settings, setSettings, error: loadError } = useSettings();
  const [siteTitle, setSiteTitle] = useState('');
  const [siteDescription, setSiteDescription] = useState('');
  const [postsPerPage, setPostsPerPage] = useState('10');
  const [sitemapExtra, setSitemapExtra] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setSiteTitle(settings.siteTitle);
    setSiteDescription(settings.siteDescription);
    setPostsPerPage(String(settings.postsPerPage));
    setSitemapExtra(settings.sitemapExtraUrls.join('\n'));
  }, [settings]);

  const form = useSubmit(async () => {
    setDone(false);
    const next = await api<SiteSettings>('/settings', {
      method: 'PUT',
      body: {
        siteTitle,
        siteDescription,
        postsPerPage: Number(postsPerPage),
        sitemapExtraUrls: sitemapExtra.split('\n').map((u) => u.trim()).filter(Boolean),
      },
    });
    setSettings(next);
    setDone(true);
  });

  return (
    <section className="card">
      <h2>サイト</h2>
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {settings && (
        <form onSubmit={form.onSubmit} className="stack">
          <Field label="サイト名" required maxLength={100} value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} />
          <Field label="説明" hint="検索結果や SNS で表示される紹介文" maxLength={300} value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} />
          <Field label="1ページの記事数" type="number" inputMode="numeric" min={1} max={50} required value={postsPerPage} onChange={(e) => setPostsPerPage(e.target.value)} />
          <div className="field">
            <label htmlFor="sitemap-extra">サイトマップに追加する URL</label>
            <textarea
              id="sitemap-extra"
              rows={3}
              aria-describedby="sitemap-extra-hint"
              placeholder="https://discheduler.etlits.dev/en/"
              autoCapitalize="none"
              spellCheck={false}
              value={sitemapExtra}
              onChange={(e) => setSitemapExtra(e.target.value)}
            />
            <p id="sitemap-extra-hint" className="hint">
              このブログ以外のページ（同じドメインのほかのサイトなど）を、1 行に 1 つ書きます。{settings.publicUrl}/sitemap.xml に載ります。
            </p>
          </div>
          <a href={settings.publicUrl} target="_blank" rel="noopener" className="hint">
            {settings.publicUrl} を開く
          </a>
          {form.error && <p className="error" role="alert">{form.error}</p>}
          {done && <p className="success" role="status">保存しました</p>}
          <button type="submit" className="btn primary" disabled={form.pending}>
            {form.pending ? '保存中…' : '保存'}
          </button>
        </form>
      )}
    </section>
  );
}
