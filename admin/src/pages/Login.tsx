import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Field } from '../components/Field';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSubmit } from '../lib/useSubmit';

export function Login() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { onSubmit, pending, error } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: { username, password } });
    await refresh();
    navigate('/', { replace: true });
  });

  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (status?.loggedIn) return <Navigate to="/" replace />;

  return (
    <main className="auth-screen">
      <h1>ログイン</h1>
      <form onSubmit={onSubmit} className="card stack">
        <Field label="ユーザー名" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="パスワード" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </main>
  );
}
