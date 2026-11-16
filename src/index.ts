import type { Env } from './env';
import { adminApp } from './routes/admin';
import { publicApp } from './routes/public';

/**
 * 1 本の Worker で 2 つのホストを受け持つ。
 *  - ADMIN_HOST (admin.etlits.dev): 管理画面と管理 API
 *  - PUBLIC_HOST (etlits.dev): 公開ブログ
 * どちらでもないホストへのリクエストは 404。
 */
export default {
  fetch(request, env, ctx) {
    const host = new URL(request.url).host;
    if (host === env.ADMIN_HOST) return adminApp.fetch(request, env, ctx);
    if (host === env.PUBLIC_HOST) return publicApp.fetch(request, env, ctx);
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
