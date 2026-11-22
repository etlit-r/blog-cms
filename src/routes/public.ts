import { Hono, type Context } from 'hono';
import type { AppEnv, PreviewPost } from '../env';
import { currentYear, dateIso, dateLabel } from '../lib/dates';
import { absolutizeUrls, cdata, escapeXml, makeExcerpt } from '../lib/html';
import { now } from '../lib/http';
import { enhanceBodyImages, extractMediaKeys, mediaKeyFromSrc, mediaUrl, srcset, type MediaRow } from '../lib/media';
import { navPages, pageUrl } from '../lib/pages';
import { TAGS_JSON_SQL, parseTags } from '../lib/posts';
import { cssHash, renderPage, siteCss } from '../lib/render';
import { serveMedia } from './media';
import { getSettings, type SiteSettings } from '../lib/settings';
import { tagKey, tagUrl } from '../lib/tags';

export const publicApp = new Hono<AppEnv>();
type C = Context<AppEnv>;

/** 管理画面の記事プレビューで使う、保存前の記事の URL */
export const PREVIEW_POST_SLUG = '__preview';

/** プレビュー中にテンプレートの描画に失敗したことを表す（管理画面にエラーの内容を返すため） */
class PreviewRenderError extends Error {}

/**
 * テンプレートで描画する（管理画面のプレビュー中は、保存前のテンプレートを使う）。
 * どのページでも使える nav（ヘッダーに並べる固定ページ）をここで足す。
 */
async function render(c: C, pageName: string, view: Record<string, unknown>): Promise<string> {
  const full = { ...view, nav: { pages: await navPages(c.env.DB) } };
  if (!c.env.PREVIEW) return renderPage(c.env.DB, pageName, full);
  try {
    return await renderPage(c.env.DB, pageName, full, c.env.PREVIEW);
  } catch (e) {
    throw new PreviewRenderError(e instanceof Error ? e.message : String(e));
  }
}

publicApp.onError((err, c) => {
  if (err instanceof PreviewRenderError) {
    return c.json({ message: `テンプレートを描画できませんでした: ${err.message}` }, 500, { 'X-Preview-Error': '1' });
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

// ---------- キャッシュ ----------

/**
 * 公開ページ（HTML・RSS・サイトマップ）を Worker の Cache API に入れ、同じページは D1 を読まずに返す。
 * キャッシュのキーには settings.content_version を含める。記事・テンプレート・設定などを保存すると
 * content_version が増えるので、古いキャッシュは使われなくなる（消す必要がない）。
 * 予約投稿が公開時刻を過ぎても表示されるよう、キャッシュは最長 5 分にする。
 */
export const PAGE_CACHE_SECONDS = 300;
const UNCACHED_PREFIXES = ['/media/', '/assets/', '/admin/', '/api/'];
const CACHEABLE_TYPES = /^(text\/html|application\/rss\+xml|application\/xml|text\/plain)/;

publicApp.use('*', async (c, next) => {
  const path = c.req.path;
  if (c.req.method !== 'GET' || c.env.PREVIEW || UNCACHED_PREFIXES.some((p) => path.startsWith(p))) return next();

  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'content_version'").first<{ value: string }>();
  // クエリ文字列はページの内容に関係しないので、キーに含めない（?xxx を付けたアクセスでキャッシュが増えないように）
  const key = new Request(`https://${c.env.PUBLIC_HOST}${path}?__v=${encodeURIComponent(row?.value ?? '0')}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  await next();
  if (c.res.status !== 200 || !CACHEABLE_TYPES.test(c.res.headers.get('Content-Type') ?? '')) return;
  // ブラウザには毎回確かめさせ、Cloudflare のキャッシュ（Cache API）だけに 5 分残す
  c.res.headers.set('Cache-Control', `public, max-age=0, s-maxage=${PAGE_CACHE_SECONDS}`);
  c.res.headers.set('X-Cache', 'MISS');
  c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
});

// 公開ホストでは管理画面・管理 API を一切返さない
publicApp.all('/admin/*', (c) => notFound(c));
publicApp.all('/api/*', (c) => notFound(c));

publicApp.get('/media/*', serveMedia);

type ListRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: number;
  tags_json: string | null;
  cover_key: string | null;
  cover_thumb_key: string | null;
  cover_width: number | null;
  cover_height: number | null;
  cover_alt: string | null;
};

/** カバー画像の列（media を m として結合して使う） */
const COVER_SQL = `m.r2_key AS cover_key, m.thumb_key AS cover_thumb_key, m.width AS cover_width, m.height AS cover_height, m.alt AS cover_alt`;
const COVER_JOIN = 'LEFT JOIN media m ON m.id = p.cover_media_id';

type PostPageRow = ListRow & { body_html: string };

/** 公開中の記事の条件（予約投稿は公開日時が来るまで出さない） */
const PUBLISHED = "p.status = 'published' AND p.published_at <= ?";

function tagsView(json: string | null) {
  return parseTags(json).map((name) => ({ name, url: tagUrl(name) }));
}

function coverView(row: ListRow, eager: boolean, featured = false) {
  if (!row.cover_key || !row.cover_thumb_key || !row.cover_width || !row.cover_height) return null;
  const media = { r2_key: row.cover_key, thumb_key: row.cover_thumb_key, width: row.cover_width, height: row.cover_height };
  return {
    src: mediaUrl(row.cover_key),
    srcset: srcset(media),
    width: row.cover_width,
    height: row.cover_height,
    alt: row.cover_alt ?? '',
    // 画面の最初に見える画像だけすぐ読み込み、ほかは近づいてから読み込む
    eager,
    // カードの表示幅（site.css のグリッドに合わせる）。先頭の大きいカードは本文の幅いっぱい
    sizes: featured ? '(min-width: 1152px) 1120px, 100vw' : '(min-width: 1024px) 360px, (min-width: 641px) 50vw, 100vw',
  };
}

function cardView(row: ListRow, featured: boolean, eager: boolean) {
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
    cover: coverView(row, eager, featured),
  };
}

function absoluteUrl(c: C, path: string): string {
  return `${new URL(c.req.url).protocol}//${c.env.PUBLIC_HOST}${path}`;
}

function baseView(
  c: C,
  settings: SiteSettings,
  page: { title?: string; description?: string; path: string; ogType?: string; ogImagePath?: string | null },
) {
  return {
    site: { title: settings.siteTitle, description: settings.siteDescription, url: absoluteUrl(c, '/') },
    page: {
      title: page.title ? `${page.title} | ${settings.siteTitle}` : settings.siteTitle,
      description: page.description ?? settings.siteDescription,
      url: absoluteUrl(c, page.path),
      ogType: page.ogType ?? 'website',
      ogImage: page.ogImagePath ? absoluteUrl(c, page.ogImagePath) : null,
    },
    year: currentYear(),
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
  const html = await render(c, '404', baseView(c, settings, { title: 'ページが見つかりません', path: c.req.path }));
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
        `SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, ${COVER_SQL}, ${TAGS_JSON_SQL}
         FROM posts p ${COVER_JOIN} WHERE ${PUBLISHED} ${tagFilter}
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
  const posts = rows.map((row, i) => cardView(row, isTop && i === 0, i === 0));
  // SNS で共有されたときの画像には、一覧の中で最初に見つかったカバーを使う
  const firstCover = rows.find((r) => r.cover_key)?.cover_key;
  const view = {
    ...baseView(c, settings, {
      title: opts.tag ? `#${opts.tag.name}` : opts.page > 1 ? `${opts.page}ページ目` : undefined,
      path: c.req.path,
      ogImagePath: firstCover ? mediaUrl(firstCover) : null,
    }),
    posts,
    pager: pagerView(opts.basePath, opts.page, totalPages),
    tag: opts.tag ? { name: opts.tag.name, count: total } : null,
  };
  return c.html(await render(c, opts.tag ? 'tag' : 'home', view));
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
  return c.html(await render(c, 'tags', view));
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
  const previewPost = c.req.param('slug') === PREVIEW_POST_SLUG ? c.env.PREVIEW?.post : undefined;
  const post = previewPost
    ? await previewPostRow(c, previewPost)
    : await db
        .prepare(
          `SELECT p.id, p.slug, p.title, p.excerpt, p.published_at, p.body_html, ${COVER_SQL}, ${TAGS_JSON_SQL}
           FROM posts p ${COVER_JOIN} WHERE p.slug = ? AND ${PUBLISHED}`,
        )
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
  const [newer, older, images] = await db.batch<{ slug: string; title: string } | MediaRow>([
    neighbor('>', 'ASC'),
    neighbor('<', 'DESC'),
    previewPost
      ? mediaByKeysStatement(c, await extractMediaKeys(post.body_html, c.env.PUBLIC_HOST))
      : db.prepare('SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ?').bind(post.id),
  ]);
  const mediaByKey = new Map((images!.results as MediaRow[]).map((m) => [m.r2_key, m]));
  const link = (r: unknown) => {
    const row = r as { slug: string; title: string } | undefined;
    return row ? { url: `/posts/${row.slug}`, title: row.title } : null;
  };

  const settings = await getSettings(db);
  const tags = tagsView(post.tags_json);
  const view = {
    ...baseView(c, settings, { title: post.title, description: post.excerpt || undefined, path: `/posts/${post.slug}`, ogType: 'article',
      ogImagePath: post.cover_key ? mediaUrl(post.cover_key) : null,
    }),
    post: {
      title: post.title,
      bodyHtml: await enhanceBodyImages(post.body_html, mediaByKey, c.env.PUBLIC_HOST),
      cover: coverView(post, true, true),
      dateLabel: dateLabel(post.published_at),
      dateIso: dateIso(post.published_at),
      tags,
      hasTags: tags.length > 0,
    },
    newer: link(newer!.results[0]),
    older: link(older!.results[0]),
  };
  return c.html(await render(c, 'post', view));
});

/** 指定したキーの画像を取り出す（キーは JSON 配列で渡す） */
function mediaByKeysStatement(c: C, keys: string[]): D1PreparedStatement {
  return c.env.DB.prepare('SELECT * FROM media WHERE r2_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys));
}

/** 管理画面から送られた保存前の記事を、DB から読んだ記事と同じ形にする */
async function previewPostRow(c: C, data: PreviewPost): Promise<PostPageRow> {
  const keys = await extractMediaKeys(data.bodyHtml, c.env.PUBLIC_HOST);
  const chosen = data.coverImage ? mediaKeyFromSrc(data.coverImage, c.env.PUBLIC_HOST)?.replace(/-w800(\.\w+)$/, '$1') : null;
  const coverKey = chosen ?? keys[0] ?? null;
  const cover = coverKey ? await c.env.DB.prepare('SELECT * FROM media WHERE r2_key = ?').bind(coverKey).first<MediaRow>() : null;
  return {
    id: 0,
    slug: PREVIEW_POST_SLUG,
    title: data.title,
    excerpt: await makeExcerpt(data.bodyHtml),
    published_at: data.publishedAt ?? now(),
    body_html: data.bodyHtml,
    tags_json: JSON.stringify(data.tags),
    cover_key: cover?.r2_key ?? null,
    cover_thumb_key: cover?.thumb_key ?? null,
    cover_width: cover?.width ?? null,
    cover_height: cover?.height ?? null,
    cover_alt: cover?.alt ?? null,
  };
}

// ---------- 固定ページ ----------

publicApp.get('/p/:slug', async (c) => {
  const db = c.env.DB;
  const page = await db
    .prepare("SELECT slug, title, body_html FROM pages WHERE slug = ? AND status = 'published'")
    .bind(c.req.param('slug'))
    .first<{ slug: string; title: string; body_html: string }>();
  if (!page) return notFound(c);

  const keys = await extractMediaKeys(page.body_html, c.env.PUBLIC_HOST);
  const { results: images } = await mediaByKeysStatement(c, keys).all<MediaRow>();
  const settings = await getSettings(db);
  const view = {
    ...baseView(c, settings, { title: page.title, description: await makeExcerpt(page.body_html), path: pageUrl(page.slug) }),
    fixedPage: {
      title: page.title,
      bodyHtml: await enhanceBodyImages(page.body_html, new Map(images.map((m) => [m.r2_key, m])), c.env.PUBLIC_HOST),
    },
  };
  return c.html(await render(c, 'page', view));
});

// ---------- RSS・サイトマップ・robots.txt ----------

const FEED_ITEMS = 20;

publicApp.get('/feed.xml', async (c) => {
  const db = c.env.DB;
  const origin = absoluteUrl(c, '');
  const [settings, { results }] = await Promise.all([
    getSettings(db),
    db
      .prepare(`SELECT p.slug, p.title, p.excerpt, p.body_html, p.published_at FROM posts p WHERE ${PUBLISHED} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`)
      .bind(now(), FEED_ITEMS)
      .all<{ slug: string; title: string; excerpt: string | null; body_html: string; published_at: number }>(),
  ]);

  const items = await Promise.all(
    results.map(async (p) => {
      const url = `${origin}/posts/${p.slug}`;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(p.published_at * 1000).toUTCString()}</pubDate>
      <description>${escapeXml(p.excerpt ?? '')}</description>
      <content:encoded>${cdata(await absolutizeUrls(p.body_html, origin))}</content:encoded>
    </item>`;
    }),
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(settings.siteTitle)}</title>
    <link>${escapeXml(`${origin}/`)}</link>
    <description>${escapeXml(settings.siteDescription)}</description>
    <language>ja</language>
    <atom:link href="${escapeXml(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

publicApp.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const origin = absoluteUrl(c, '');
  const t = now();
  const [posts, tags, pages] = await db.batch<{ path: string; lastmod: number | null }>([
    // 予約投稿は公開時刻にページが現れるので、更新日時と公開日時の新しいほうを更新日にする
    db.prepare(`SELECT '/posts/' || p.slug AS path, MAX(p.updated_at, p.published_at) AS lastmod FROM posts p WHERE ${PUBLISHED} ORDER BY p.published_at DESC`).bind(t),
    db
      .prepare(
        `SELECT t.name AS path, MAX(MAX(p.updated_at, p.published_at)) AS lastmod FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
         JOIN posts p ON p.id = pt.post_id AND ${PUBLISHED} GROUP BY t.id ORDER BY t.name`,
      )
      .bind(t),
    db.prepare("SELECT '/p/' || slug AS path, updated_at AS lastmod FROM pages WHERE status = 'published' ORDER BY sort_order, id"),
  ]);
  // トップとタグ一覧は、いちばん最近更新された公開記事の日時を更新日にする（Google はクロールの目安に使う）
  const latest = posts!.results.reduce<number | null>((max, p) => (p.lastmod !== null && (max === null || p.lastmod > max) ? p.lastmod : max), null);
  const entries = [
    { path: '/', lastmod: latest },
    ...posts!.results,
    { path: '/tags', lastmod: latest },
    // タグ名は URL に使えない文字を含むので、ここでエンコードする
    ...tags!.results.map((r) => ({ path: tagUrl(r.path), lastmod: r.lastmod })),
    ...pages!.results,
  ];
  // 設定で追加した、このブログ以外のページ（同じドメインのほかのサイトなど）。更新日は分からないので付けない
  const { sitemapExtraUrls } = await getSettings(db);
  const urls = [
    ...entries.map(
      (e) =>
        `  <url><loc>${escapeXml(origin + e.path)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod * 1000).toISOString()}</lastmod>` : ''}</url>`,
    ),
    ...sitemapExtraUrls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
  ].join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

publicApp.get('/robots.txt', (c) =>
  c.body(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(c, '/sitemap.xml')}\n`, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
);

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
