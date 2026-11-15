import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const publicApp = new Hono<AppEnv>();

// 公開ホストでは管理画面・管理 API を一切返さない
publicApp.all('/admin/*', (c) => c.notFound());
publicApp.all('/api/*', (c) => c.notFound());

// フェーズ 2 でテンプレートを使った描画に置き換える
publicApp.get('/', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'site_title'").first<{ value: string }>();
  const title = row?.value ?? 'Blog';
  return c.html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
      `<body><h1>${escapeHtml(title)}</h1><p>準備中です。</p></body></html>`,
  );
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
