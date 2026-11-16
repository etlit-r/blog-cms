import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, now, escapeLike, parseId, readJson } from '../../lib/http';
import {
  TAGS_JSON_SQL,
  createPost,
  generateSlug,
  getPost,
  parsePostInput,
  slugExists,
  toApiPost,
  toApiPostSummary,
  uniqueSlug,
  updatePost,
  type PostSummaryRow,
} from '../../lib/posts';
import { bumpContentVersionStatement } from '../../lib/settings';

export const posts = new Hono<AppEnv>();

const PAGE_SIZE = 20;

/**
 * 記事一覧。新しく更新したものから順に PAGE_SIZE 件ずつ返す。
 * ?state=draft|published|scheduled で絞り込み、?q= でタイトル検索、?cursor= で続きを取得。
 */
posts.get('/', async (c) => {
  const where: string[] = [];
  const args: unknown[] = [];
  const t = now();

  const state = c.req.query('state');
  if (state === 'draft') where.push("p.status = 'draft'");
  else if (state === 'published') where.push("p.status = 'published' AND p.published_at <= ?"), args.push(t);
  else if (state === 'scheduled') where.push("p.status = 'published' AND p.published_at > ?"), args.push(t);

  const q = c.req.query('q')?.trim();
  if (q) where.push("p.title LIKE ? ESCAPE '\\'"), args.push(`%${escapeLike(q)}%`);

  // カーソルは「updated_at:id」。同じ updated_at の記事があっても取りこぼさないよう id も使う
  const cursor = c.req.query('cursor')?.match(/^(\d+):(\d+)$/);
  if (cursor) where.push('(p.updated_at, p.id) < (?, ?)'), args.push(Number(cursor[1]), Number(cursor[2]));

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.status, p.published_at, p.created_at, p.updated_at, ${TAGS_JSON_SQL}
     FROM posts p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(...args, PAGE_SIZE + 1)
    .all<PostSummaryRow>();

  const page = results.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const items = page.map(toApiPostSummary);
  return c.json({ items, nextCursor: results.length > PAGE_SIZE && last ? `${last.updated_at}:${last.id}` : null });
});

posts.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const row = id && (await getPost(c.env.DB, id));
  if (!row) return apiError(c, 404, 'not_found', '記事が見つかりません');
  return c.json({ post: toApiPost(row) });
});

posts.post('/', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');
  const parsed = parsePostInput(body);
  if ('error' in parsed) return apiError(c, 400, 'invalid_input', parsed.error);
  const input = parsed.value;

  let slug: string;
  if (input.slug) {
    if (await slugExists(db, input.slug)) return slugTaken(c);
    slug = input.slug;
  } else {
    slug = await uniqueSlug(db, generateSlug(input.title));
  }

  let id: number;
  try {
    id = await createPost(db, { ...input, slug });
  } catch (e) {
    // 確認してから保存するまでの間に、同じ URL の記事が作られた場合
    if (await slugExists(db, slug)) return slugTaken(c);
    throw e;
  }
  return c.json({ post: toApiPost((await getPost(db, id))!) }, 201);
});

posts.put('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (!id) return apiError(c, 404, 'not_found', '記事が見つかりません');

  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');
  if (typeof body.updatedAt !== 'number') return apiError(c, 400, 'invalid_input', 'updatedAt を指定してください');
  const parsed = parsePostInput(body);
  if ('error' in parsed) return apiError(c, 400, 'invalid_input', parsed.error);
  const input = parsed.value;

  const current = await getPost(db, id);
  if (!current) return apiError(c, 404, 'not_found', '記事が見つかりません');

  let slug: string;
  if (input.slug) {
    if (input.slug !== current.slug && (await slugExists(db, input.slug, id))) return slugTaken(c);
    slug = input.slug;
  } else {
    slug = current.slug; // 空にした場合は今の URL のまま
  }

  let updated: boolean;
  try {
    updated = await updatePost(db, id, { ...input, slug }, body.updatedAt);
  } catch (e) {
    if (await slugExists(db, slug, id)) return slugTaken(c);
    throw e;
  }
  if (!updated) {
    return apiError(c, 409, 'conflict', 'ほかの画面で先に保存されています。再読み込みして最新の内容を確認してください');
  }
  return c.json({ post: toApiPost((await getPost(db, id))!) });
});

posts.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (!id) return apiError(c, 404, 'not_found', '記事が見つかりません');
  const [result] = await db.batch([db.prepare('DELETE FROM posts WHERE id = ?').bind(id), bumpContentVersionStatement(db)]);
  if (result!.meta.changes === 0) return apiError(c, 404, 'not_found', '記事が見つかりません');
  return c.json({ ok: true });
});

function slugTaken(c: Parameters<typeof apiError>[0]) {
  return apiError(c, 409, 'slug_taken', 'この URL はほかの記事で使われています');
}
