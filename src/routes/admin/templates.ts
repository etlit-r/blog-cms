import { Hono } from 'hono';
import { DEFAULT_TEMPLATES, TEMPLATE_ORDER } from '../../defaults';
import type { AppEnv, PreviewPost } from '../../env';
import { apiError, now, parseId, readJson } from '../../lib/http';
import { BODY_MAX } from '../../lib/posts';
import { normalizeTagNames } from '../../lib/tags';
import { resetTemplate, saveTemplate, validateTemplate, type TemplateRow } from '../../lib/templates';
import { PREVIEW_POST_SLUG, publicApp } from '../public';

export const templates = new Hono<AppEnv>();

function info(name: string) {
  return Object.hasOwn(DEFAULT_TEMPLATES, name) ? DEFAULT_TEMPLATES[name]! : null;
}

function toApi(name: string, row: TemplateRow | null) {
  const t = DEFAULT_TEMPLATES[name]!;
  return {
    name,
    kind: t.kind,
    label: t.label,
    description: t.description,
    content: row?.content ?? t.content,
    defaultContent: t.content,
    customized: row !== null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function getRow(db: D1Database, name: string) {
  return db.prepare('SELECT name, content, updated_at FROM templates WHERE name = ?').bind(name).first<TemplateRow>();
}

/** テンプレートの一覧（編集済みかどうか付き） */
templates.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT name, updated_at FROM templates').all<{ name: string; updated_at: number }>();
  const edited = new Map(results.map((r) => [r.name, r.updated_at]));
  return c.json({
    items: TEMPLATE_ORDER.map((name) => ({ name, t: DEFAULT_TEMPLATES[name]! })).map(({ name, t }) => ({
      name,
      kind: t.kind,
      label: t.label,
      description: t.description,
      customized: edited.has(name),
      updatedAt: edited.get(name) ?? null,
    })),
  });
});

templates.get('/:name', async (c) => {
  const name = c.req.param('name');
  if (!info(name)) return apiError(c, 404, 'not_found', 'テンプレートが見つかりません');
  return c.json({ template: toApi(name, await getRow(c.env.DB, name)) });
});

/** 保存。updatedAt は読み込んだときの値（初期のままなら null）で、ほかの画面で先に保存されていれば 409 */
templates.put('/:name', async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name');
  if (!info(name)) return apiError(c, 404, 'not_found', 'テンプレートが見つかりません');
  const body = await readJson(c);
  if (!body || typeof body.content !== 'string') return apiError(c, 400, 'invalid_body', '内容を指定してください');
  if (body.updatedAt !== null && typeof body.updatedAt !== 'number') return apiError(c, 400, 'invalid_input', 'updatedAt を指定してください');

  const invalid = validateTemplate(name, body.content);
  if (invalid) return apiError(c, 400, 'invalid_template', invalid);

  if (!(await saveTemplate(db, name, body.content, body.updatedAt))) {
    return apiError(c, 409, 'conflict', 'ほかの画面で先に保存されています。再読み込みして最新の内容を確認してください');
  }
  return c.json({ template: toApi(name, await getRow(db, name)) });
});

/** 履歴の一覧（新しい順） */
templates.get('/:name/revisions', async (c) => {
  const name = c.req.param('name');
  if (!info(name)) return apiError(c, 404, 'not_found', 'テンプレートが見つかりません');
  const { results } = await c.env.DB.prepare(
    'SELECT id, created_at, length(content) AS length FROM template_revisions WHERE name = ? ORDER BY id DESC',
  )
    .bind(name)
    .all<{ id: number; created_at: number; length: number }>();
  return c.json({ items: results.map((r) => ({ id: r.id, createdAt: r.created_at, length: r.length })) });
});

templates.get('/:name/revisions/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const row =
    id &&
    (await c.env.DB.prepare('SELECT id, content, created_at FROM template_revisions WHERE id = ? AND name = ?')
      .bind(id, c.req.param('name'))
      .first<{ id: number; content: string; created_at: number }>());
  if (!row) return apiError(c, 404, 'not_found', '履歴が見つかりません');
  return c.json({ revision: { id: row.id, content: row.content, createdAt: row.created_at } });
});

/** 履歴の版に戻す（{ revisionId }）か、初期の内容に戻す（{ default: true }） */
templates.post('/:name/restore', async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name');
  if (!info(name)) return apiError(c, 404, 'not_found', 'テンプレートが見つかりません');
  const body = await readJson(c);

  if (body?.default === true) {
    await resetTemplate(db, name);
  } else {
    const id = typeof body?.revisionId === 'number' ? body.revisionId : null;
    const rev = id && (await db.prepare('SELECT content FROM template_revisions WHERE id = ? AND name = ?').bind(id, name).first<{ content: string }>());
    if (!rev) return apiError(c, 404, 'not_found', '履歴が見つかりません');
    const invalid = validateTemplate(name, rev.content);
    if (invalid) return apiError(c, 400, 'invalid_template', invalid);
    const current = await getRow(db, name);
    if (!(await saveTemplate(db, name, rev.content, current?.updated_at ?? null))) {
      return apiError(c, 409, 'conflict', 'ほかの画面で先に保存されています。もう一度お試しください');
    }
  }
  return c.json({ template: toApi(name, await getRow(db, name)) });
});

// ---------- プレビュー ----------

export const preview = new Hono<AppEnv>();

/** テンプレートごとに、プレビューで開く公開ページ */
async function previewPath(db: D1Database, name: string | undefined): Promise<string> {
  const t = now();
  if (name === 'post') {
    const row = await db
      .prepare("SELECT slug FROM posts WHERE status = 'published' AND published_at <= ? ORDER BY published_at DESC LIMIT 1")
      .bind(t)
      .first<{ slug: string }>();
    return row ? `/posts/${row.slug}` : '/';
  }
  if (name === 'tag') {
    const row = await db
      .prepare(
        `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id
         WHERE p.status = 'published' AND p.published_at <= ? GROUP BY t.id ORDER BY COUNT(*) DESC LIMIT 1`,
      )
      .bind(t)
      .first<{ name: string }>();
    return row ? `/tags/${encodeURIComponent(row.name)}` : '/tags';
  }
  if (name === 'tags') return '/tags';
  if (name === '404') return '/__preview/not-found';
  return '/';
}

function parsePreviewPost(value: unknown): PreviewPost | string {
  if (!value || typeof value !== 'object') return '記事の形式が正しくありません';
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || typeof v.bodyHtml !== 'string') return '記事の形式が正しくありません';
  if (v.bodyHtml.length > BODY_MAX) return '本文が長すぎます';
  const tags = normalizeTagNames(v.tags);
  if ('error' in tags) return tags.error;
  const publishedAt = typeof v.publishedAt === 'number' && Number.isInteger(v.publishedAt) ? v.publishedAt : null;
  const coverImage = typeof v.coverImage === 'string' ? v.coverImage : null;
  return { title: v.title, bodyHtml: v.bodyHtml, tags: tags.names, publishedAt, coverImage };
}

/**
 * 保存前のテンプレートや記事で、公開ページを描画した HTML を返す。
 * body: { templates?: { [name]: content }, name?: 開くページを決めるテンプレート名, post?: 保存前の記事 }
 */
preview.post('/', async (c) => {
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');

  const overrides: Record<string, string> = {};
  if (body.templates !== undefined) {
    if (!body.templates || typeof body.templates !== 'object') return apiError(c, 400, 'invalid_input', 'テンプレートの形式が正しくありません');
    for (const [name, content] of Object.entries(body.templates as Record<string, unknown>)) {
      if (typeof content !== 'string') return apiError(c, 400, 'invalid_input', 'テンプレートの形式が正しくありません');
      const invalid = validateTemplate(name, content);
      if (invalid) return apiError(c, 400, 'invalid_template', invalid);
      overrides[name] = content;
    }
  }

  let post: PreviewPost | undefined;
  if (body.post !== undefined) {
    const parsed = parsePreviewPost(body.post);
    if (typeof parsed === 'string') return apiError(c, 400, 'invalid_input', parsed);
    post = parsed;
  }

  const path = post ? `/posts/${PREVIEW_POST_SLUG}` : await previewPath(c.env.DB, typeof body.name === 'string' ? body.name : undefined);
  const protocol = new URL(c.req.url).protocol;
  const res = await publicApp.fetch(
    new Request(`${protocol}//${c.env.PUBLIC_HOST}${path}`),
    { ...c.env, PREVIEW: { templates: overrides, post } },
    c.executionCtx,
  );
  if (res.headers.get('X-Preview-Error') === '1') {
    return apiError(c, 400, 'render_error', ((await res.json()) as { message: string }).message);
  }
  return c.json({ html: await res.text(), path });
});
