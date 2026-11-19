import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { isValidSession } from '../../lib/auth';
import { apiError } from '../../lib/http';
import { serveMedia } from '../media';
import { auth, getSessionToken } from './auth';
import { media } from './media';
import { pages } from './pages';
import { posts } from './posts';
import { settings } from './settings';
import { tags } from './tags';
import { preview, templates } from './templates';

/** ログインなしで呼べる API */
const PUBLIC_API_PATHS = new Set(['/api/admin/auth/status', '/api/admin/auth/setup', '/api/admin/auth/login', '/api/admin/auth/logout']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const adminApp = new Hono<AppEnv>();

// 管理画面全体に付けるセキュリティヘッダー
adminApp.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Robots-Tag', 'noindex, nofollow');
});

// ---------- API ----------

// API の応答はキャッシュさせない（下のミドルウェアが途中で返すエラーにも付くよう、別のミドルウェアにする）
adminApp.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

adminApp.use('/api/admin/*', async (c, next) => {
  // CSRF 対策: 状態を変えるリクエストは、管理ホスト自身から送られたものだけを受け付ける
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('Origin');
    const requestUrl = new URL(c.req.url);
    let ok = false;
    if (origin) {
      try {
        const o = new URL(origin);
        ok = o.host === c.env.ADMIN_HOST && o.protocol === requestUrl.protocol;
      } catch {
        ok = false;
      }
    }
    if (!ok) return apiError(c, 403, 'invalid_origin', '不正なリクエスト元です');
  }

  if (!PUBLIC_API_PATHS.has(c.req.path) && !(await isValidSession(c.env.DB, getSessionToken(c)))) {
    return apiError(c, 401, 'unauthorized', 'ログインしてください');
  }

  await next();
});

adminApp.route('/api/admin/auth', auth);
adminApp.route('/api/admin/posts', posts);
adminApp.route('/api/admin/tags', tags);
adminApp.route('/api/admin/settings', settings);
adminApp.route('/api/admin/media', media);
adminApp.route('/api/admin/pages', pages);
adminApp.route('/api/admin/templates', templates);
adminApp.route('/api/admin/preview', preview);

adminApp.all('/api/*', (c) => apiError(c, 404, 'not_found', 'API が見つかりません'));

// エディタの中で本文の画像（/media/...）を表示するため、管理ホストからも画像を返す
adminApp.get('/media/*', serveMedia);

// ---------- 管理画面 SPA ----------

// ビルド済みの JS / CSS（public/admin/assets/* など）
adminApp.get('/admin/*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

// 管理画面は検索エンジンに載せない
adminApp.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

// ファイルらしきパス（favicon.ico など）に index.html を返さない
adminApp.get('*', async (c, next) => {
  if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.notFound();
  await next();
});

// それ以外のパスはすべて SPA の index.html を返し、画面遷移は React Router に任せる
adminApp.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL('/admin/', c.req.url), c.req.raw));
  if (!res.ok) {
    return c.text('管理画面がビルドされていません。`npm run build` を実行してください', 503);
  }
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-cache');
  return out;
});
