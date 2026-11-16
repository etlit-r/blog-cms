import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, escapeLike, parseId, readJson } from '../../lib/http';
import { bumpContentVersionStatement } from '../../lib/settings';
import { TAG_NAME_MAX, cleanTagName, tagKey } from '../../lib/tags';

export const tags = new Hono<AppEnv>();

type TagRow = { id: number; name: string; post_count: number };

const SUGGEST_LIMIT = 10;

const toApiTag = (row: TagRow) => ({ id: row.id, name: row.name, postCount: row.post_count });

/**
 * タグ一覧（記事数つき）。?q= を付けると入力補完用に、前方一致を優先して上位だけ返す。
 */
tags.get('/', async (c) => {
  const q = c.req.query('q');
  const countSql = '(SELECT COUNT(*) FROM post_tags pt WHERE pt.tag_id = t.id) AS post_count';
  if (q !== undefined) {
    const key = tagKey(q);
    if (!key) return c.json({ items: [] });
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, ${countSql} FROM tags t
       WHERE t.name_key LIKE ? ESCAPE '\\'
       ORDER BY (t.name_key LIKE ? ESCAPE '\\') DESC, post_count DESC, t.name
       LIMIT ?`,
    )
      .bind(`%${escapeLike(key)}%`, `${escapeLike(key)}%`, SUGGEST_LIMIT)
      .all<TagRow>();
    return c.json({ items: results.map(toApiTag) });
  }
  const { results } = await c.env.DB.prepare(`SELECT t.id, t.name, ${countSql} FROM tags t ORDER BY post_count DESC, t.name`).all<TagRow>();
  return c.json({ items: results.map(toApiTag) });
});

/** タグ名の変更。同じ名前（キー）のタグがすでにあれば、統合を案内する */
tags.put('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  const body = await readJson(c);
  if (!id) return apiError(c, 404, 'not_found', 'タグが見つかりません');
  if (!body || typeof body.name !== 'string') return apiError(c, 400, 'invalid_body', 'タグ名を入力してください');

  const name = cleanTagName(body.name);
  if (!name) return apiError(c, 400, 'invalid_input', 'タグ名を入力してください');
  if ([...name].length > TAG_NAME_MAX) return apiError(c, 400, 'invalid_input', `タグは${TAG_NAME_MAX}文字以内にしてください`);

  const other = await db.prepare('SELECT id FROM tags WHERE name_key = ? AND id != ?').bind(tagKey(name), id).first<{ id: number }>();
  if (other) {
    return c.json({ error: { code: 'tag_exists', message: `「${name}」というタグがすでにあります。統合してください`, tagId: other.id } }, 409);
  }

  const [result] = await db.batch([
    db.prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?').bind(name, tagKey(name), id),
    bumpContentVersionStatement(db),
  ]);
  if (result!.meta.changes === 0) return apiError(c, 404, 'not_found', 'タグが見つかりません');
  return c.json({ ok: true });
});

/** タグの統合: :id のタグが付いた記事に intoId のタグを付け、:id のタグを削除する */
tags.post('/:id/merge', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  const body = await readJson(c);
  const intoId = typeof body?.intoId === 'number' ? body.intoId : null;
  if (!id || !intoId) return apiError(c, 400, 'invalid_input', '統合先のタグを指定してください');
  if (id === intoId) return apiError(c, 400, 'invalid_input', '同じタグには統合できません');

  const found = await db.prepare('SELECT COUNT(*) AS n FROM tags WHERE id IN (?, ?)').bind(id, intoId).first<{ n: number }>();
  if (found?.n !== 2) return apiError(c, 404, 'not_found', 'タグが見つかりません');

  await db.batch([
    db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT post_id, ? FROM post_tags WHERE tag_id = ?').bind(intoId, id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id), // post_tags は ON DELETE CASCADE で消える
    bumpContentVersionStatement(db),
  ]);
  return c.json({ ok: true });
});

tags.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (!id) return apiError(c, 404, 'not_found', 'タグが見つかりません');
  const [result] = await db.batch([db.prepare('DELETE FROM tags WHERE id = ?').bind(id), bumpContentVersionStatement(db)]);
  if (result!.meta.changes === 0) return apiError(c, 404, 'not_found', 'タグが見つかりません');
  return c.json({ ok: true });
});

/** どの記事にも使われていないタグをまとめて削除する */
tags.post('/delete-unused', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)').run();
  return c.json({ deleted: result.meta.changes });
});
