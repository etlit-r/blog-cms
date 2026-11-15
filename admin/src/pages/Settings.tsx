import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Field } from '../components/Field';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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
