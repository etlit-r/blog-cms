import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, now, parseId, readJson } from '../../lib/http';
import {
  ALT_MAX,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE,
  newMediaKeys,
  sniffImageType,
  toApiMedia,
  type MediaMime,
  type MediaRow,
} from '../../lib/media';
import { bumpContentVersionStatement } from '../../lib/settings';
import { mediaCacheKey } from '../media';

export const media = new Hono<AppEnv>();

const PAGE_SIZE = 30;
/** 画像を使っている記事の数（本文で使っている記事と、カバーにしている記事。usedBy と同じ条件） */
/** 本文に画像のキー（元画像かサムネイル）が含まれている固定ページの条件（pg は pages の別名） */
const PAGE_USES_SQL = '(instr(pg.body_html, m.r2_key) > 0 OR instr(pg.body_html, m.thumb_key) > 0)';

/**
 * 画像を使っている記事・固定ページの数（usedBy と同じ条件）。
 * 記事は本文（post_media）かカバー、固定ページは本文に URL が含まれているかで判定する。
 */
const USAGE_SQL = `(
    (SELECT COUNT(*) FROM posts p
      WHERE p.cover_media_id = m.id OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id AND pm.media_id = m.id))
    + (SELECT COUNT(*) FROM pages pg WHERE ${PAGE_USES_SQL})
  ) AS usage_count`;

async function readImage(value: unknown, label: string): Promise<{ bytes: Uint8Array; mime: MediaMime } | string> {
  if (!(value instanceof File)) return `${label}が送られていません`;
  if (value.size === 0) return `${label}が空です`;
  if (value.size > MEDIA_MAX_BYTES) return `${label}が大きすぎます（${MEDIA_MAX_BYTES / 1024 / 1024}MB まで）`;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime) return `${label}の形式に対応していません（WebP・JPEG・PNG のみ）`;
  return { bytes, mime };
}

function parseDimension(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MEDIA_MAX_EDGE ? n : null;
}

/**
 * 画像のアップロード。ブラウザで縮小済みの 2 枚（original: 長辺 1600px、thumb: 長辺 800px）を受け取る。
 * multipart/form-data: original, thumb, width, height, alt
 */
media.post('/', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return apiError(c, 400, 'invalid_body', 'multipart/form-data で送ってください');
  }

  const original = await readImage(form.get('original'), '画像');
  if (typeof original === 'string') return apiError(c, 400, 'invalid_input', original);
  const thumb = await readImage(form.get('thumb'), 'サムネイル');
  if (typeof thumb === 'string') return apiError(c, 400, 'invalid_input', thumb);
  if (original.mime !== thumb.mime) return apiError(c, 400, 'invalid_input', '画像とサムネイルの形式がそろっていません');

  const width = parseDimension(form.get('width'));
  const height = parseDimension(form.get('height'));
  if (!width || !height) return apiError(c, 400, 'invalid_input', `画像の大きさが正しくありません（長辺 ${MEDIA_MAX_EDGE}px まで）`);

  const altValue = form.get('alt');
  const alt = typeof altValue === 'string' ? altValue.trim() : '';
  if ([...alt].length > ALT_MAX) return apiError(c, 400, 'invalid_input', `代替テキストは${ALT_MAX}文字以内にしてください`);

  const { key, thumbKey } = newMediaKeys(original.mime);
  const httpMetadata = { contentType: original.mime, cacheControl: 'public, max-age=31536000, immutable' };
  try {
    await Promise.all([c.env.MEDIA.put(key, original.bytes, { httpMetadata }), c.env.MEDIA.put(thumbKey, thumb.bytes, { httpMetadata })]);
    const row = await c.env.DB.prepare(
      `INSERT INTO media (r2_key, thumb_key, mime, width, height, bytes, alt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(key, thumbKey, original.mime, width, height, original.bytes.byteLength, alt || null, now())
      .first<MediaRow>();
    return c.json({ media: toApiMedia({ ...row!, usage_count: 0 }) }, 201);
  } catch (e) {
    // 片方だけ保存できた場合や、DB に記録できなかった場合は、R2 に何も残さない
    await c.env.MEDIA.delete([key, thumbKey]).catch(() => {});
    throw e;
  }
});

/** 画像一覧（新しい順）。?cursor= は前のページの最後の id */
media.get('/', async (c) => {
  const cursor = parseId(c.req.query('cursor') ?? '');
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, ${USAGE_SQL} FROM media m ${cursor ? 'WHERE m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
  )
    .bind(...(cursor ? [cursor] : []), PAGE_SIZE + 1)
    .all<MediaRow & { usage_count: number }>();
  const page = results.slice(0, PAGE_SIZE);
  return c.json({
    items: page.map(toApiMedia),
    nextCursor: results.length > PAGE_SIZE ? String(page[page.length - 1]!.id) : null,
  });
});

/** 画像の詳細と、使っている記事の一覧 */
media.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const row = id && (await c.env.DB.prepare(`SELECT m.*, ${USAGE_SQL} FROM media m WHERE m.id = ?`).bind(id).first<MediaRow & { usage_count: number }>());
  if (!row) return apiError(c, 404, 'not_found', '画像が見つかりません');
  return c.json({ media: toApiMedia(row), ...(await usedBy(c.env.DB, row)) });
});

media.put('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await readJson(c);
  if (!id) return apiError(c, 404, 'not_found', '画像が見つかりません');
  if (!body || typeof body.alt !== 'string') return apiError(c, 400, 'invalid_body', '代替テキストを指定してください');
  const alt = body.alt.trim();
  if ([...alt].length > ALT_MAX) return apiError(c, 400, 'invalid_input', `代替テキストは${ALT_MAX}文字以内にしてください`);

  const db = c.env.DB;
  const [result] = await db.batch([db.prepare('UPDATE media SET alt = ? WHERE id = ?').bind(alt || null, id), bumpContentVersionStatement(db)]);
  if (result!.meta.changes === 0) return apiError(c, 404, 'not_found', '画像が見つかりません');
  return c.json({ ok: true });
});

/**
 * 画像の削除。記事で使われている場合は 409 で記事の一覧を返し、?force=1 のときだけ削除する。
 * 削除した画像がカバーだった記事は、カバーが自動なら本文の次の画像をカバーにする。
 */
media.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  const row = id && (await db.prepare('SELECT * FROM media WHERE id = ?').bind(id).first<MediaRow>());
  if (!row) return apiError(c, 404, 'not_found', '画像が見つかりません');

  const { posts, pages } = await usedBy(db, row);
  const count = posts.length + pages.length;
  if (count > 0 && c.req.query('force') !== '1') {
    return c.json(
      { error: { code: 'in_use', message: `この画像は ${count} 件の記事・固定ページで使われています`, posts, pages } },
      409,
    );
  }

  await db.batch([
    db.prepare('DELETE FROM media WHERE id = ?').bind(row.id), // post_media は CASCADE、posts.cover_media_id は NULL になる
    db.prepare(
      `UPDATE posts SET cover_media_id = (SELECT media_id FROM post_media pm WHERE pm.post_id = posts.id ORDER BY position LIMIT 1)
       WHERE cover_auto = 1 AND cover_media_id IS NULL`,
    ),
    bumpContentVersionStatement(db),
  ]);
  await c.env.MEDIA.delete([row.r2_key, row.thumb_key]);
  // この Worker のキャッシュからも消す（消さないと、削除した画像が配信され続ける）
  const cache = caches.default;
  await Promise.all([row.r2_key, row.thumb_key].map((k) => cache.delete(mediaCacheKey(c.env.PUBLIC_HOST, k))));
  return c.json({ ok: true });
});

/** 画像を使っている記事（本文かカバー）と固定ページ */
async function usedBy(db: D1Database, media: Pick<MediaRow, 'id' | 'r2_key' | 'thumb_key'>) {
  const [posts, pages] = await db.batch<{ id: number; title: string }>([
    db
      .prepare(
        `SELECT id, title FROM posts WHERE id IN (SELECT post_id FROM post_media WHERE media_id = ?) OR cover_media_id = ?
         ORDER BY updated_at DESC`,
      )
      .bind(media.id, media.id),
    db
      .prepare(`SELECT pg.id, pg.title FROM pages pg, (SELECT ? AS r2_key, ? AS thumb_key) m WHERE ${PAGE_USES_SQL} ORDER BY pg.updated_at DESC`)
      .bind(media.r2_key, media.thumb_key),
  ]);
  return { posts: posts!.results, pages: pages!.results };
}
