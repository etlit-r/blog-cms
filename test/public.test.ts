import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC, api, ownerSession, resetDb } from './helpers';

let cookie: string;
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await resetDb();
  cookie = await ownerSession();
});

async function post(overrides: Record<string, unknown>) {
  const res = await api('/posts', {
    method: 'POST',
    cookie,
    body: { title: 'タイトル', bodyHtml: '<p>本文</p>', status: 'published', tags: [], ...overrides },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { post: { id: number; slug: string } }).post;
}

async function page(path: string) {
  const res = await SELF.fetch(`${PUBLIC}${path}`, { redirect: 'manual' });
  return { status: res.status, html: await res.text(), location: res.headers.get('Location') };
}

describe('トップページ', () => {
  it('公開中の記事だけを新しい順に表示する', async () => {
    await post({ title: '古い記事', slug: 'old', publishedAt: nowSec() - 200 });
    await post({ title: '新しい記事', slug: 'new', publishedAt: nowSec() - 100 });
    await post({ title: '下書き', slug: 'draft', status: 'draft' });
    await post({ title: '予約', slug: 'scheduled', publishedAt: nowSec() + 3600 });

    const { status, html } = await page('/');
    expect(status).toBe(200);
    expect(html.indexOf('新しい記事')).toBeGreaterThan(-1);
    expect(html.indexOf('新しい記事')).toBeLessThan(html.indexOf('古い記事'));
    expect(html).not.toContain('下書き');
    expect(html).not.toContain('予約');
    expect(html).toContain('is-featured'); // 先頭の記事は大きく表示
  });

  it('タイトルなどは HTML エスケープされる', async () => {
    await post({ title: '<script>alert(1)</script>', slug: 'xss' });
    const { html } = await page('/');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('記事がないときは案内を出す', async () => {
    expect((await page('/')).html).toContain('まだ記事がありません');
  });

  it('ページ送り', async () => {
    await api('/settings', { method: 'PUT', cookie, body: { siteTitle: 'etlits', siteDescription: '', postsPerPage: 2 } });
    for (let i = 1; i <= 5; i++) await post({ title: `記事${i}`, slug: `post-${i}`, publishedAt: nowSec() - 100 + i });

    const top = await page('/');
    expect(top.html).toContain('記事5');
    expect(top.html).toContain('href="/page/2"');

    const p3 = await page('/page/3');
    expect(p3.status).toBe(200);
    expect(p3.html).toContain('記事1');
    expect(p3.html).not.toContain('href="/page/4"');

    expect((await page('/page/4')).status).toBe(404);
    expect((await page('/page/1')).location).toBe('/');
    expect((await page('/page/abc')).status).toBe(404);
  });
});

describe('記事ページ', () => {
  it('本文の HTML をそのまま表示し、前後の記事へのリンクを出す', async () => {
    await post({ title: '一つ目', slug: 'first', publishedAt: nowSec() - 300 });
    await post({ title: '二つ目', slug: 'second', bodyHtml: '<p>二つ目の<strong>本文</strong></p>', publishedAt: nowSec() - 200, tags: ['旅行'] });
    await post({ title: '三つ目', slug: 'third', publishedAt: nowSec() - 100 });

    const { status, html } = await page('/posts/second');
    expect(status).toBe(200);
    expect(html).toContain('<p>二つ目の<strong>本文</strong></p>');
    expect(html).toContain('href="/posts/third"');
    expect(html).toContain('href="/posts/first"');
    expect(html).toContain(`href="/tags/${encodeURIComponent('旅行')}"`);
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<link rel="canonical" href="https://etlits.dev/posts/second">');
  });

  it('下書きと予約中の記事は 404', async () => {
    await post({ slug: 'draft', status: 'draft' });
    await post({ slug: 'scheduled', publishedAt: nowSec() + 3600 });
    expect((await page('/posts/draft')).status).toBe(404);
    expect((await page('/posts/scheduled')).status).toBe(404);
    expect((await page('/posts/missing')).html).toContain('ページが見つかりません');
  });
});

describe('タグページ', () => {
  it('タグの付いた公開記事だけを表示する', async () => {
    await post({ title: 'CSSの話', slug: 'css', tags: ['CSS'] });
    await post({ title: '別の話', slug: 'other', tags: ['旅行'] });
    await post({ title: 'CSSの下書き', slug: 'css-draft', status: 'draft', tags: ['CSS'] });

    const { status, html } = await page('/tags/CSS');
    expect(status).toBe(200);
    expect(html).toContain('CSSの話');
    expect(html).not.toContain('別の話');
    expect(html).not.toContain('CSSの下書き');
    expect(html).toContain('1件の記事');
  });

  it('表記ゆれの URL は正式な URL へ転送する', async () => {
    await post({ slug: 'css', tags: ['CSS'] });
    expect((await page('/tags/css')).location).toBe('/tags/CSS');
    expect((await page('/tags/CSS/page/1')).location).toBe('/tags/CSS');
  });

  it('タグ一覧には公開記事のあるタグだけを出す', async () => {
    await post({ slug: 'a', tags: ['公開'] });
    await post({ slug: 'b', status: 'draft', tags: ['下書きだけ'] });
    const { html } = await page('/tags');
    expect(html).toContain('#公開');
    expect(html).not.toContain('下書きだけ');
  });

  it('存在しないタグは 404', async () => {
    expect((await page('/tags/nothing')).status).toBe(404);
  });
});

describe('テンプレートと CSS', () => {
  it('DB に保存したテンプレートで表示する', async () => {
    await env.DB.prepare("INSERT INTO templates (name, kind, content, updated_at) VALUES ('partial:footer', 'partial', '<footer>カスタムフッター {{site.title}}</footer>', 0)").run();
    expect((await page('/')).html).toContain('カスタムフッター etlits');
  });

  it('壊れたテンプレートなら初期テンプレートで表示する', async () => {
    await env.DB.prepare("INSERT INTO templates (name, kind, content, updated_at) VALUES ('home', 'page', '{{#posts}} 閉じ忘れ', 0)").run();
    const { status, html } = await page('/');
    expect(status).toBe(200);
    expect(html).toContain('初期テンプレートで表示しています');
    expect(html).toContain('まだ記事がありません');
  });

  it('CSS はハッシュ付き URL なら長期キャッシュする', async () => {
    const { html } = await page('/');
    const cssUrl = html.match(/href="(\/assets\/site\.css\?v=[0-9a-f]{8})"/)![1]!;
    const res = await SELF.fetch(`${PUBLIC}${cssUrl}`);
    expect(res.headers.get('Content-Type')).toContain('text/css');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    const stale = await SELF.fetch(`${PUBLIC}/assets/site.css?v=00000000`);
    expect(stale.headers.get('Cache-Control')).not.toContain('immutable');
  });
});
