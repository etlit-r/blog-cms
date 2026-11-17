import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { MEDIA_KEY_PATTERN, safeDecode } from '../lib/media';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cache API のキー。どちらのホストから来ても同じキャッシュを使う */
export function mediaCacheKey(publicHost: string, key: string): Request {
  return new Request(`https://${publicHost}/media/${key}`);
}

/**
 * GET /media/<key> — R2 の画像を返す（公開ホスト・管理ホストの両方）。
 * キーには ULID が入っていて同じキーの中身は変わらないので、長期キャッシュさせる。
 * Worker の Cache API にも入れ、R2 の読み取り回数を減らす。
 */
export async function serveMedia(c: Context<AppEnv>) {
  const key = safeDecode(c.req.path.slice('/media/'.length));
  if (!key || !MEDIA_KEY_PATTERN.test(key)) return c.notFound();

  const cacheKey = mediaCacheKey(c.env.PUBLIC_HOST, key);
  const cache = caches.default;
  let res = await cache.match(cacheKey);

  if (!res) {
    const object = await c.env.MEDIA.get(key);
    if (!object) return c.notFound();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', IMMUTABLE);
    headers.set('Content-Length', String(object.size));
    res = new Response(object.body, { headers });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  }

  const etag = res.headers.get('ETag');
  if (etag && c.req.header('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': IMMUTABLE } });
  }
  return new Response(res.body, res);
}
