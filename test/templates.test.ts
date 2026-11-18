import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC, api, ownerSession, resetDb } from './helpers';

let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await ownerSession();
});

type ApiTemplate = { name: string; content: string; defaultContent: string; customized: boolean; updatedAt: number | null };

const enc = encodeURIComponent;

async function get(name: string) {
  return ((await (await api(`/templates/${enc(name)}`, { cookie })).json()) as { template: ApiTemplate }).template;
}

function put(name: string, content: string, updatedAt: number | null) {
  return api(`/templates/${enc(name)}`, { method: 'PUT', cookie, body: { content, updatedAt } });
}

async function publicHtml(path = '/') {
  return (await SELF.fetch(`${PUBLIC}${path}`)).text();
}

async function publishPost(body: Record<string, unknown> = {}) {
  const res = await api('/posts', { method: 'POST', cookie, body: { title: '公開記事', bodyHtml: '<p>本文</p>', status: 'published', tags: ['旅行'], ...body } });
  return ((await res.json()) as { post: { slug: string } }).post;
}

describe('テンプレートの一覧と取得', () => {
  it('すべてのテンプレートを初期のまま返す', async () => {
    const { items } = (await (await api('/templates', { cookie })).json()) as { items: ApiTemplate[] };
    expect(items.map((t) => t.name)).toEqual(['layout', 'home', 'post', 'tag', 'tags', '404', 'partial:header', 'partial:footer', 'partial:post-card', 'partial:pager', 'css:site']);
    expect(items.every((t) => !t.customized)).toBe(true);
    const footer = await get('partial:footer');
    expect(footer.content).toBe(footer.defaultContent);
  });

  it('知らない名前は 404', async () => {
    expect((await api('/templates/unknown', { cookie })).status).toBe(404);
    expect((await api('/templates/__proto__', { cookie })).status).toBe(404);
  });
});

describe('テンプレートの保存', () => {
  it('保存すると公開ページに反映され、履歴に残る', async () => {
    const res = await put('partial:footer', '<footer>新しいフッター {{site.title}}</footer>', null);
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as { template: ApiTemplate }).template;
    expect(saved.customized).toBe(true);
    expect(await publicHtml()).toContain('新しいフッター etlits');

    const { items } = (await (await api('/templates/partial%3Afooter/revisions', { cookie })).json()) as { items: { id: number }[] };
    expect(items).toHaveLength(1);
    const rev = (await (await api(`/templates/partial%3Afooter/revisions/${items[0]!.id}`, { cookie })).json()) as { revision: { content: string } };
    expect(rev.revision.content).toContain('新しいフッター');
  });

  it('Mustache の書き方が誤っていれば保存しない', async () => {
    const res = await put('home', '{{#posts}} 閉じ忘れ', null);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_template' } });
    expect((await get('home')).customized).toBe(false);
  });

  it('共通レイアウトに {{{content}}} がなければ保存しない', async () => {
    const res = await put('layout', '<html><body>{{content}}</body></html>', null);
    expect(res.status).toBe(400);
    const ok = await put('layout', '<html><body>{{#site}}{{{content}}}{{/site}}</body></html>', null);
    expect(ok.status).toBe(200);
  });

  it('ほかの画面で先に保存されていたら 409', async () => {
    const first = ((await (await put('home', 'A {{#posts}}{{/posts}}', null)).json()) as { template: ApiTemplate }).template;
    expect((await put('home', 'B', null)).status).toBe(409);
    expect((await put('home', 'C', first.updatedAt! - 1)).status).toBe(409);
    expect((await put('home', 'D', first.updatedAt)).status).toBe(200);
    // 拒否された保存（B・C）は履歴に残らない
    const { items } = (await (await api('/templates/home/revisions', { cookie })).json()) as { items: unknown[] };
    expect(items).toHaveLength(2);
  });

  it('履歴は 30 件まで残す', async () => {
    let updatedAt: number | null = null;
    for (let i = 0; i < 33; i++) {
      const res = await put('partial:footer', `<footer>${i}</footer>`, updatedAt);
      updatedAt = ((await res.json()) as { template: ApiTemplate }).template.updatedAt;
    }
    const { items } = (await (await api('/templates/partial%3Afooter/revisions', { cookie })).json()) as { items: unknown[] };
    expect(items).toHaveLength(30);
  });

  it('CSS を保存すると、CSS の URL と内容が変わる', async () => {
    const before = (await publicHtml()).match(/\/assets\/site\.css\?v=([0-9a-f]{8})/)![1];
    await put('css:site', 'body { color: rebeccapurple; }', null);
    const html = await publicHtml();
    const after = html.match(/\/assets\/site\.css\?v=([0-9a-f]{8})/)![1];
    expect(after).not.toBe(before);
    expect(await (await SELF.fetch(`${PUBLIC}/assets/site.css?v=${after}`)).text()).toBe('body { color: rebeccapurple; }');
  });
});

describe('復元', () => {
  it('履歴の版に戻せる', async () => {
    const a = ((await (await put('partial:footer', '<footer>版A</footer>', null)).json()) as { template: ApiTemplate }).template;
    await put('partial:footer', '<footer>版B</footer>', a.updatedAt);
    const { items } = (await (await api('/templates/partial%3Afooter/revisions', { cookie })).json()) as { items: { id: number }[] };
    const res = await api('/templates/partial%3Afooter/restore', { method: 'POST', cookie, body: { revisionId: items[1]!.id } });
    expect(res.status).toBe(200);
    expect(await publicHtml()).toContain('版A');
  });

  it('初期の内容に戻せる', async () => {
    await put('partial:footer', '<footer>カスタム</footer>', null);
    const res = await api('/templates/partial%3Afooter/restore', { method: 'POST', cookie, body: { default: true } });
    expect(((await res.json()) as { template: ApiTemplate }).template.customized).toBe(false);
    expect(await publicHtml()).not.toContain('カスタム');
  });
});

describe('プレビュー', () => {
  type PreviewRes = { html: string; path: string };

  it('保存前のテンプレートで描画し、保存はしない', async () => {
    const res = await api('/preview', { method: 'POST', cookie, body: { name: 'partial:footer', templates: { 'partial:footer': '<footer>試し書き</footer>' } } });
    const { html, path } = (await res.json()) as PreviewRes;
    expect(path).toBe('/');
    expect(html).toContain('試し書き');
    expect(await publicHtml()).not.toContain('試し書き');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM templates').first('n')).toBe(0);
  });

  it('CSS は data: URL で埋め込む', async () => {
    const res = await api('/preview', { method: 'POST', cookie, body: { name: 'css:site', templates: { 'css:site': 'body{color:red}' } } });
    const { html } = (await res.json()) as PreviewRes;
    expect(html).toContain(`href="data:text/css;charset=utf-8,${encodeURIComponent('body{color:red}')}"`);
  });

  it('記事ページのテンプレートは最新の記事で表示する', async () => {
    const post = await publishPost({ title: '最新の記事' });
    const res = await api('/preview', { method: 'POST', cookie, body: { name: 'post', templates: { post: '<h1>記事: {{post.title}}</h1>' } } });
    const { html, path } = (await res.json()) as PreviewRes;
    expect(path).toBe(`/posts/${post.slug}`);
    expect(html).toContain('<h1>記事: 最新の記事</h1>');
  });

  it('404 ページもプレビューできる', async () => {
    const res = await api('/preview', { method: 'POST', cookie, body: { name: '404' } });
    expect(((await res.json()) as PreviewRes).html).toContain('ページが見つかりません');
  });

  it('書き方が誤っていれば 400', async () => {
    const res = await api('/preview', { method: 'POST', cookie, body: { name: 'home', templates: { home: '{{/posts}}' } } });
    expect(res.status).toBe(400);
  });

  it('保存前の記事を表示できる（下書きでもよい）', async () => {
    await publishPost({ title: '前の記事' });
    const res = await api('/preview', {
      method: 'POST',
      cookie,
      body: { post: { title: '<下書き>', bodyHtml: '<p>まだ保存していない本文</p>', tags: ['CSS', 'css'], publishedAt: null, coverImage: null } },
    });
    const { html } = (await res.json()) as PreviewRes;
    expect(html).toContain('&lt;下書き&gt;');
    expect(html).toContain('まだ保存していない本文');
    expect(html).toContain('#CSS');
    expect(html).toContain('前の記事'); // 前後の記事へのリンク
  });

  it('公開サイトからはプレビュー用の URL を開けない', async () => {
    expect((await SELF.fetch(`${PUBLIC}/posts/__preview`)).status).toBe(404);
  });

  it('ログインしていないと使えない', async () => {
    expect((await api('/preview', { method: 'POST', body: { name: 'home' } })).status).toBe(401);
  });
});
