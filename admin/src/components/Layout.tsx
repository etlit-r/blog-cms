import { NavLink, Outlet, useLocation } from 'react-router';

const TABS = [
  { to: '/', label: '記事', icon: 'M4 5h16M4 10h16M4 15h10M4 20h7', end: true },
  { to: '/media', label: 'メディア', icon: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01' },
  { to: '/design', label: 'デザイン', icon: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' },
  { to: '/settings', label: '設定', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

/** ログイン後の共通レイアウト。片手で操作しやすいよう、画面下にタブを置く */
export function Layout() {
  const { pathname } = useLocation();
  const current = TABS.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));

  return (
    <div className="app">
      <header className="app-header">
        <h1>{current?.label ?? '管理画面'}</h1>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="メインメニュー">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={tab.icon} />
            </svg>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
