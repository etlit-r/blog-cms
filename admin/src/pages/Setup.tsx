import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Field } from '../components/Field';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSubmit } from '../lib/useSubmit';

export function Setup() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const [setupToken, setSetupToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { onSubmit, pending, error } = useSubmit(async () => {
    if (password !== confirm) throw new Error('確認用のパスワードが一致しません');
    await api('/auth/setup', { method: 'POST', body: { setupToken, username, password } });
    await refresh();
    navigate('/', { replace: true });
  });

  // アカウントがすでにあるときはセットアップ画面を出さない
  if (status && !status.setupRequired) return <Navigate to={status.loggedIn ? '/' : '/login'} replace />;

  return (
    <main className="auth-screen">
      <h1>はじめに</h1>
      <p className="lead">記事を書くアカウントを作成します。作成できるのは 1 つだけです。</p>
      <form onSubmit={onSubmit} className="card stack">
        <Field
          label="セットアップトークン"
          hint="デプロイ時に wrangler secret put SETUP_TOKEN で設定した値"
          type="password"
          autoComplete="off"
          required
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
        />
        <Field label="ユーザー名" autoComplete="username" autoCapitalize="none" required maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field
          label="パスワード"
          hint="10 文字以上"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field label="パスワード（確認）" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? '作成中…' : 'アカウントを作成'}
        </button>
      </form>
    </main>
  );
}
