import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { Design } from './pages/Design';
import { Login } from './pages/Login';
import { Media } from './pages/Media';
import { Posts } from './pages/Posts';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';

/** ログイン状態に応じて、セットアップ画面・ログイン画面へ振り分ける */
function RequireAuth() {
  const { status, error, refresh } = useAuth();
  // 状態をまだ一度も取得できていないときだけ全画面で表示する（取得済みなら画面はそのまま残す）
  if (!status) return error ? <FullScreenMessage message={error} onRetry={refresh} /> : <FullScreenMessage message="読み込み中…" />;
  if (status.setupRequired) return <Navigate to="/setup" replace />;
  if (!status.loggedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function FullScreenMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <main className="center-screen">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          再読み込み
        </button>
      )}
    </main>
  );
}

const router = createBrowserRouter([
  { path: '/setup', element: <Setup /> },
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Posts /> },
          { path: 'media', element: <Media /> },
          { path: 'design', element: <Design /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
