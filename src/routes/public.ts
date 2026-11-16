import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { dateIso, dateLabel } from '../lib/dates';
import { now } from '../lib/http';
import { TAGS_JSON_SQL, parseTags } from '../lib/posts';
import { cssHash, renderPage, siteCss } from '../lib/render';
import { getSettings, type SiteSettings } from '../lib/settings';
import { tagKey, tagUrl } from '../lib/tags';

export const publicApp = new Hono<AppEnv>();
type C = Context<AppEnv>;

// 公開ホストでは管理画面・管理 API を一切返さない
publicApp.all('/admin/*', (c) => notFound(c));
publicApp.all('/api/*', (c) => notFound(c));

type ListRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: number;
  tags_json: string | null;
};

type PostPageRow = ListRow & { body_html: string };

/** 公開中の記事の条件（予約投稿は公開日時が来るまで出さない） */
const PUBLISHED = "p.status = 'published' AND p.published_at <= ?";

function tagsView(json: string | null) {
  return parseTags(json).map((name) => ({ name, url: tagUrl(name) }));
}

function cardView(row: ListRow, featured: boolean) {
  const tags = tagsView(row.tags_json);
  return {
    title: row.title,
    url: `/posts/${row.slug}`,
    excerpt: row.excerpt ?? '',
    dateLabel: dateLabel(row.published_at),
    dateIso: dateIso(row.published_at),
    tags,
    hasTags: tags.length > 0,
    featured,
    cover: null, // フェーズ 3 で記事内の写真を入れる
  };
}

function absoluteUrl(c: C, path: string): string {
  return `${new URL(c.req.url).protocol}//${c.env.PUBLIC_HOST}${path}`;
}

function baseView(c: C, settings: SiteSettings, page: { title?: string; description?: string; path: string; ogType?: string }) {
  return {
    site: { title: settings.siteTitle, description: settings.siteDescription, url: absoluteUrl(c, '/') },
    page: {
      title: page.title ? `${page.title} | ${settings.siteTitle}` : settings.siteTitle,
      description: page.description ?? settings.siteDescription,
      url: absoluteUrl(c, page.path),
      ogType: page.ogType ?? 'website',
      ogImage: null, // フェーズ 3 でカバー画像を入れる
    },
    year: new Date().getFullYear(),
  };
}

/** /page/:n の n を読む。1 や不正な値は null（呼び出し側で扱う） */
function parsePage(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number(raw);
}

function pagerView(basePath: string, current: number, total: number) {
  if (total <= 1) return null;
  const pageUrl = (n: number) => (n === 1 ? basePath : `${basePath === '/' ? '' : basePath}/page/${n}`);
  return {
    current,
    total,
    prevUrl: current > 1 ? pageUrl(current - 1) : null,
    nextUrl: current < total ? pageUrl(current + 1) : null,
  };
}

async function notFound(c: C) {
  const settings = await getSettings(c.env.DB);
  const html = await renderPage(c.env.DB, '404', baseView(c, settings, { title: 'ページが見つかりません', path: c.req.path }));
  return c.html(html, 404);
}

// ---------- 記事一覧（トップ・タグ別） ----------

async function listPage(c: C, opts: { page: number; basePath: string; tag?: { id: number; name: string } }) {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const perPage = settings.postsPerPage;
  const t = now();

  const tagFilter = opts.tag ? 'AND EXISTS (SELECT 1 FROM post_tags x WHERE x.post_id = p.id AND x.tag_id = ?)' : '';
  const tagArgs = opts.tag ? [opts.tag.id] : [];

  const [list, count] = await db.batch<ListRow | { n: number }>([
    db
      .prepare(
        `SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, ${TAGS_JSON_SQL}
         FROM posts p WHERE ${PUBLISHED} ${tagFilter}
         ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(t, ...tagArgs, perPage, (opts.page - 1) * perPage),
    db.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${PUBLISHED} ${tagFilter}`).bind(t, ...tagArgs),
  ]);

  const rows = list!.results as ListRow[];
  const total = (count!.results[0] as { n: number }).n;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (opts.page > totalPages) return notFound(c);

  const isTop = !opts.tag && opts.page === 1;
  const posts = rows.map((row, i) => cardView(row, isTop && i === 0));
  const view = {
    ...baseView(c, settings, {
      title: opts.tag ? `#${opts.tag.name}` : opts.page > 1 ? `${opts.page}ページ目` : undefined,
      path: c.req.path,
    }),
    posts,
    pager: pagerView(opts.basePath, opts.page, totalPages),
    tag: opts.tag ? { name: opts.tag.name, count: total } : null,
  };
  return c.html(await renderPage(db, opts.tag ? 'tag' : 'home', view));
}

publicApp.get('/', (c) => listPage(c, { page: 1, basePath: '/' }));

publicApp.get('/page/:n', async (c) => {
  const page = parsePage(c.req.param('n'));
  if (page === null) return notFound(c);
  if (page === 1) return c.redirect('/', 301);
  return listPage(c, { page, basePath: '/' });
});

// ---------- タグ ----------

publicApp.get('/tags', async (c) => {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const { results } = await db
    .prepare(
      `SELECT t.name, COUNT(*) AS count FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
       JOIN posts p ON p.id = pt.post_id AND ${PUBLISHED}
       GROUP BY t.id ORDER BY count DESC, t.name`,
    )
    .bind(now())
    .all<{ name: string; count: number }>();
  const tags = results.map((r) => ({ name: r.name, url: tagUrl(r.name), count: r.count }));
  const view = { ...baseView(c, settings, { title: 'タグ', path: '/tags' }), tags, hasTags: tags.length > 0 };
  return c.html(await renderPage(db, 'tags', view));
});

async function tagPage(c: C, rawPage: string | undefined) {
  const page = parsePage(rawPage);
  if (page === null) return notFound(c);

  const name = c.req.param('tag') ?? '';
  const tag = await c.env.DB.prepare('SELECT id, name FROM tags WHERE name_key = ?').bind(tagKey(name)).first<{ id: number; name: string }>();
  if (!tag) return notFound(c);

  // 表記ゆれ（/tags/CSS と /tags/css など）は正式な URL へまとめる
  const basePath = tagUrl(tag.name);
  if (name !== tag.name || (page === 1 && rawPage !== undefined)) {
    return c.redirect(page === 1 ? basePath : `${basePath}/page/${page}`, 301);
  }
  return listPage(c, { page, basePath, tag });
}

publicApp.get('/tags/:tag', (c) => tagPage(c, undefined));
publicApp.get('/tags/:tag/page/:n', (c) => tagPage(c, c.req.param('n')));

// ---------- 記事 ----------

publicApp.get('/posts/:slug', async (c) => {
  const db = c.env.DB;
  const t = now();
  const post = await db
    .prepare(`SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, p.body_html, ${TAGS_JSON_SQL} FROM posts p WHERE p.slug = ? AND ${PUBLISHED}`)
    .bind(c.req.param('slug'), t)
    .first<PostPageRow>();
  if (!post) return notFound(c);

  const neighbor = (op: '>' | '<', order: 'ASC' | 'DESC') =>
    db
      .prepare(
        `SELECT p.slug, p.title FROM posts p WHERE ${PUBLISHED} AND (p.published_at, p.id) ${op} (?, ?)
         ORDER BY p.published_at ${order}, p.id ${order} LIMIT 1`,
      )
      .bind(t, post.published_at, post.id);
  const [newer, older] = await db.batch<{ slug: string; title: string }>([neighbor('>', 'ASC'), neighbor('<', 'DESC')]);
  const link = (r: { slug: string; title: string } | undefined) => (r ? { url: `/posts/${r.slug}`, title: r.title } : null);

  const settings = await getSettings(db);
  const tags = tagsView(post.tags_json);
  const view = {
    ...baseView(c, settings, { title: post.title, description: post.excerpt ?? undefined, path: `/posts/${post.slug}`, ogType: 'article' }),
    post: {
      title: post.title,
      bodyHtml: post.body_html,
      dateLabel: dateLabel(post.published_at),
      dateIso: dateIso(post.published_at),
      tags,
      hasTags: tags.length > 0,
    },
    newer: link(newer!.results[0]),
    older: link(older!.results[0]),
  };
  return c.html(await renderPage(db, 'post', view));
});

// ---------- CSS ----------

publicApp.get('/assets/site.css', async (c) => {
  const css = await siteCss(c.env.DB, c.req.query('fallback') === '1');
  // ?v= が今の内容のハッシュと一致するときだけ長期キャッシュする（内容が変わると URL も変わる）
  const immutable = c.req.query('v') === (await cssHash(css));
  return c.body(css, 200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  });
});

publicApp.notFound((c) => notFound(c));
