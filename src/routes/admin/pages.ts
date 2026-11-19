import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, now, parseId, readJson } from '../../lib/http';
import { pageSlugExists, parsePageInput, toApiPage, uniquePageSlug, type PageRow } from '../../lib/pages';
import { bumpContentVersionStatement } from '../../lib/settings';

export const pages = new Hono<AppEnv>();

const notFound = (c: Parameters<typeof apiError>[0]) => apiError(c, 404, 'not_found', '固定ページが見つかりません');
const slugTaken = (c: Parameters<typeof apiError>[0]) => apiError(c, 409, 'slug_taken', 'この URL はほかの固定ページで使われています');

async function getPage(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>();
}

/** 一覧（並び順どおり。本文は含めない） */
pages.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM pages ORDER BY sort_order, id').all<PageRow>();
  return c.json({ items: results.map((r) => ({ ...toApiPage(r), bodyHtml: undefined })) });
});

pages.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const row = id && (await getPage(c.env.DB, id));
  if (!row) return notFound(c);
  return c.json({ page: toApiPage(row) });
});

pages.post('/', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');
  const parsed = parsePageInput(body);
  if ('error' in parsed) return apiError(c, 400, 'invalid_input', parsed.error);
  const input = parsed.value;

  if (input.slug && (await pageSlugExists(db, input.slug))) return slugTaken(c);
  const slug = input.slug ?? (await uniquePageSlug(db, input.title));
  try {
    const [inserted] = await db.batch([
      db
        .prepare('INSERT INTO pages (slug, title, body_html, editor_mode, status, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
        .bind(slug, input.title, input.bodyHtml, input.editorMode, input.status, input.sortOrder, now()),
      bumpContentVersionStatement(db),
    ]);
    return c.json({ page: toApiPage(inserted!.results[0] as PageRow) }, 201);
  } catch (e) {
    if (await pageSlugExists(db, slug)) return slugTaken(c);
    throw e;
  }
});

/** 更新。updatedAt が DB の値と違えば（ほかの画面で先に保存されていれば）409 */
pages.put('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (!id) return notFound(c);
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');
  if (typeof body.updatedAt !== 'number') return apiError(c, 400, 'invalid_input', 'updatedAt を指定してください');
  const parsed = parsePageInput(body);
  if ('error' in parsed) return apiError(c, 400, 'invalid_input', parsed.error);
  const input = parsed.value;

  const current = await getPage(db, id);
  if (!current) return notFound(c);
  const slug = input.slug ?? current.slug;
  if (slug !== current.slug && (await pageSlugExists(db, slug, id))) return slugTaken(c);

  let changes: number;
  try {
    const [result] = await db.batch([
      db
        .prepare(
          `UPDATE pages SET slug = ?, title = ?, body_html = ?, editor_mode = ?, status = ?, sort_order = ?, updated_at = MAX(?, updated_at + 1)
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(slug, input.title, input.bodyHtml, input.editorMode, input.status, input.sortOrder, now(), id, body.updatedAt),
      bumpContentVersionStatement(db),
    ]);
    changes = result!.meta.changes;
  } catch (e) {
    if (await pageSlugExists(db, slug, id)) return slugTaken(c);
    throw e;
  }
  if (changes !== 1) return apiError(c, 409, 'conflict', 'ほかの画面で先に保存されています。再読み込みして最新の内容を確認してください');
  return c.json({ page: toApiPage((await getPage(db, id))!) });
});

pages.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (!id) return notFound(c);
  const [result] = await db.batch([db.prepare('DELETE FROM pages WHERE id = ?').bind(id), bumpContentVersionStatement(db)]);
  if (result!.meta.changes === 0) return notFound(c);
  return c.json({ ok: true });
});
