import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, PUBLIC, api, ownerSession, resetDb } from './helpers';

let cookie: string;
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetDb();
  cookie = await ownerSession();
});

type ApiPage = { id: number; slug: string; title: string; status: string; updatedAt: number };

async function createPage(body: Record<string, unknown>) {
  const res = await api('/pages', { method: 'POST', cookie, body: { title: 'About', bodyHtml: '<p>自己紹介</p>', status: 'published', ...body } });
  return { res, page: res.status === 201 ? ((await res.json()) as { page: ApiPage }).page : null };
}

async function publishPost(body: Record<string, unknown> = {}) {
  const res = await api('/posts', { method: 'POST', cookie, body: { title: '記事', bodyHtml: '<p>本文</p>', status: 'published', tags: [], ...body } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { post: { id: number; slug: string; updatedAt: number } }).post;
}

const get = (path: string, host = PUBLIC) => SELF.fetch(`${host}${path}`);

describe('固定ページ', () => {
  it('作成すると /p/URL で公開され、ヘッダーにも並ぶ', async () => {
    const { res, page } = await createPage({ title: 'About', slug: 'about' });
    expect(res.status).toBe(201);
    expect(page!.slug).toBe('about');

    const html = await (await get('/p/about')).text();
    expect(html).toContain('<h1 class="post-title">About</h1>');
    expect(html).toContain('自己紹介');
    expect(await (await get('/')).text()).toContain('<a href="/p/about">About</a>');
  });

  it('下書きは公開されない', async () => {
    await createPage({ slug: 'draft', status: 'draft' });
    expect((await get('/p/draft')).status).toBe(404);
    expect(await (await get('/')).text()).not.toContain('/p/draft');
  });

  it('URL が重なると 409、更新の競合も 409', async () => {
    const { page } = await createPage({ slug: 'about' });
    expect((await createPage({ slug: 'about' })).res.status).toBe(409);
    const body = { title: 'About 2', bodyHtml: '', status: 'published', slug: 'about' };
    expect((await api(`/pages/${page!.id}`, { method: 'PUT', cookie, body: { ...body, updatedAt: page!.updatedAt } })).status).toBe(200);
    expect((await api(`/pages/${page!.id}`, { method: 'PUT', cookie, body: { ...body, updatedAt: page!.updatedAt } })).status).toBe(409);
  });

  it('並び順のとおりにヘッダーに並ぶ', async () => {
    await createPage({ title: 'Second', slug: 'second', sortOrder: 2 });
    await createPage({ title: 'First', slug: 'first', sortOrder: 1 });
    const html = await (await get('/')).text();
    expect(html.indexOf('/p/first')).toBeLessThan(html.indexOf('/p/second'));
  });

  it('削除できる', async () => {
    const { page } = await createPage({ slug: 'about' });
    expect((await api(`/pages/${page!.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await get('/p/about')).status).toBe(404);
  });
});

describe('RSS・サイトマップ・robots.txt', () => {
  it('RSS に公開中の記事を新しい順に入れ、本文の URL を絶対 URL にする', async () => {
    await publishPost({ title: '古い <記事>', slug: 'old', publishedAt: nowSec() - 100 });
    await publishPost({ title: '新しい記事', slug: 'new', bodyHtml: '<p><a href="/posts/old">前回</a> ]]> も入れる</p>' });
    await publishPost({ title: '下書き', slug: 'draft', status: 'draft' });

    const res = await get('/feed.xml');
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml.indexOf('新しい記事')).toBeLessThan(xml.indexOf('古い &lt;記事&gt;'));
    expect(xml).not.toContain('下書き');
    expect(xml).toContain('<link>https://etlits.dev/posts/new</link>');
    expect(xml).toContain('href="https://etlits.dev/posts/old"');
    expect(xml).toContain(']]]]><![CDATA[>');
  });

  it('サイトマップに記事・タグ・固定ページを入れる', async () => {
    await publishPost({ slug: 'hello', tags: ['旅行'] });
    await createPage({ slug: 'about' });
    const xml = await (await get('/sitemap.xml')).text();
    expect(xml).toContain('<loc>https://etlits.dev/</loc>');
    expect(xml).toContain('<loc>https://etlits.dev/posts/hello</loc>');
    expect(xml).toContain(`<loc>https://etlits.dev/tags/${encodeURIComponent('旅行')}</loc>`);
    expect(xml).toContain('<loc>https://etlits.dev/p/about</loc>');
    // トップにも更新日（最新の記事の更新日時）が付く
    expect(xml).toMatch(/<url><loc>https:\/\/etlits\.dev\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/lastmod><\/url>/);
  });

  it('robots.txt は公開サイトでは許可、管理画面では拒否', async () => {
    expect(await (await get('/robots.txt')).text()).toContain('Sitemap: https://etlits.dev/sitemap.xml');
    expect(await (await get('/robots.txt', ADMIN)).text()).toContain('Disallow: /');
  });
});

describe('公開ページのキャッシュ', () => {
  it('2 回目はキャッシュから返し、保存すると新しい内容になる', async () => {
    const post = await publishPost({ title: '最初のタイトル', slug: 'cached' });
    const first = await get('/posts/cached');
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=300');
    await first.text();
    await new Promise((r) => setTimeout(r, 50)); // キャッシュへの保存（waitUntil）を待つ

    const second = await get('/posts/cached');
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(await second.text()).toContain('最初のタイトル');

    // DB を直接書き換えてもキャッシュが返る（＝D1 を読んでいない）
    await env.DB.prepare("UPDATE posts SET title = '直接変更' WHERE id = ?").bind(post.id).run();
    expect(await (await get('/posts/cached')).text()).toContain('最初のタイトル');

    // 管理画面から保存すると content_version が変わり、新しい内容が返る
    await api(`/posts/${post.id}`, {
      method: 'PUT',
      cookie,
      body: { title: '新しいタイトル', slug: 'cached', bodyHtml: '<p>本文</p>', status: 'published', tags: [], updatedAt: post.updatedAt },
    });
    const third = await get('/posts/cached');
    expect(third.headers.get('X-Cache')).toBe('MISS');
    expect(await third.text()).toContain('新しいタイトル');
  });

  it('クエリ文字列が違っても同じキャッシュを使う', async () => {
    await publishPost({ slug: 'q' });
    await (await get('/posts/q?a=1')).text();
    await new Promise((r) => setTimeout(r, 50));
    expect((await get('/posts/q?b=2')).headers.get('X-Cache')).toBe('HIT');
  });

  it('404 やリダイレクトはキャッシュしない', async () => {
    const missing = await get('/posts/missing');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Cache')).toBeNull();
    const redirect = await SELF.fetch(`${PUBLIC}/page/1`, { redirect: 'manual' });
    expect(redirect.headers.get('X-Cache')).toBeNull();
  });
});

describe('画像の使用状況（固定ページ）', () => {
  it('固定ページで使っている画像は、削除前に確認する', async () => {
    const form = new FormData();
    const bytes = new Uint8Array(64);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    form.set('original', new File([bytes], 'a.webp'));
    form.set('thumb', new File([bytes], 'b.webp'));
    form.set('width', '100');
    form.set('height', '100');
    const up = await SELF.fetch(`${ADMIN}/api/admin/media`, { method: 'POST', headers: { Cookie: cookie, Origin: ADMIN }, body: form });
    const { media } = (await up.json()) as { media: { id: number; url: string; thumbUrl: string } };
    await createPage({ slug: 'gallery', bodyHtml: `<img src="${media.thumbUrl}">` });

    const list = (await (await api('/media', { cookie })).json()) as { items: { id: number; usageCount: number }[] };
    expect(list.items[0]!.usageCount).toBe(1);
    const del = await api(`/media/${media.id}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ error: { code: 'in_use', pages: [{ title: 'About' }] } });
  });
});
