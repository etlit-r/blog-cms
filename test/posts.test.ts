import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, ownerSession, resetDb } from './helpers';

let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await ownerSession();
});

type ApiPost = {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  excerpt: string;
  excerptAuto: boolean;
  status: string;
  state: string;
  publishedAt: number | null;
  updatedAt: number;
  tags: string[];
};

const base = { title: 'Hello World', bodyHtml: '<p>本文です</p>', status: 'draft', tags: [] as string[] };

async function create(overrides: Record<string, unknown> = {}) {
  const res = await api('/posts', { method: 'POST', cookie, body: { ...base, ...overrides } });
  return { res, post: res.ok ? ((await res.json()) as { post: ApiPost }).post : null };
}

async function update(post: ApiPost, overrides: Record<string, unknown>) {
  return api(`/posts/${post.id}`, {
    method: 'PUT',
    cookie,
    body: { ...base, title: post.title, slug: post.slug, tags: post.tags, status: post.status, updatedAt: post.updatedAt, ...overrides },
  });
}

describe('記事の作成', () => {
  it('作成すると抜粋と URL が自動で入る', async () => {
    const { res, post } = await create();
    expect(res.status).toBe(201);
    expect(post).toMatchObject({ title: 'Hello World', slug: 'hello-world', excerpt: '本文です', excerptAuto: true, state: 'draft' });
  });

  it('日本語のタイトルなら日付ベースの URL になる', async () => {
    const { post } = await create({ title: '京都旅行' });
    expect(post!.slug).toMatch(/^\d{8}-[a-z0-9]{4}$/);
  });

  it('自動の URL が重なったら別の URL にする', async () => {
    const a = await create();
    const b = await create();
    expect(a.post!.slug).toBe('hello-world');
    expect(b.post!.slug).toMatch(/^hello-world-[a-z0-9]{4}$/);
  });

  it('指定した URL が使われていれば 409', async () => {
    await create({ slug: 'my-post' });
    const { res } = await create({ slug: 'my-post' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'slug_taken' } });
  });

  it('URL に使えない文字は 400', async () => {
    expect((await create({ slug: 'Bad Slug!' })).res.status).toBe(400);
    expect((await create({ slug: '日本語' })).res.status).toBe(400);
  });

  it('公開するにはタイトルが必要（下書きなら空でもよい）', async () => {
    expect((await create({ title: '', status: 'published' })).res.status).toBe(400);
    expect((await create({ title: '', status: 'draft' })).res.status).toBe(201);
  });

  it('公開日時を指定しなければ今が入る', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { post } = await create({ status: 'published' });
    expect(post!.state).toBe('published');
    expect(post!.publishedAt).toBeGreaterThanOrEqual(before);
  });

  it('未来の公開日時なら予約になる', async () => {
    const { post } = await create({ status: 'published', publishedAt: Math.floor(Date.now() / 1000) + 3600 });
    expect(post!.state).toBe('scheduled');
  });

  it('手動の抜粋はそのまま使う', async () => {
    const { post } = await create({ excerpt: '手で書いた抜粋' });
    expect(post).toMatchObject({ excerpt: '手で書いた抜粋', excerptAuto: false });
  });

  it('ログインしていないと作成できない', async () => {
    const res = await api('/posts', { method: 'POST', body: base });
    expect(res.status).toBe(401);
  });
});

describe('タグ', () => {
  it('表記ゆれをまとめ、重複を除く', async () => {
    const { post } = await create({ tags: ['CSS', 'ｃｓｓ', ' css ', '旅行', ''] });
    expect(post!.tags.sort()).toEqual(['CSS', '旅行'].sort());
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first('n')).toBe(2);
  });

  it('既存のタグを再利用する', async () => {
    await create({ tags: ['旅行'] });
    const { post } = await create({ tags: ['旅行', '京都'] });
    expect(post!.tags.sort()).toEqual(['京都', '旅行'].sort());
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first('n')).toBe(2);
  });

  it('入力補完は前方一致を先に返す', async () => {
    await create({ tags: ['Cloudflare', 'MyCloud', 'React'] });
    const res = await api('/tags?q=cloud', { cookie });
    const { items } = (await res.json()) as { items: { name: string }[] };
    expect(items.map((t) => t.name)).toEqual(['Cloudflare', 'MyCloud']);
  });

  it('入力補完の検索語の % や _ は文字として扱う', async () => {
    await create({ tags: ['100%', 'abc'] });
    const { items } = (await (await api('/tags?q=%25', { cookie })).json()) as { items: { name: string }[] };
    expect(items.map((t) => t.name)).toEqual(['100%']);
  });

  it('名前の変更で既存のタグと重なるなら 409', async () => {
    await create({ tags: ['React', 'Vue'] });
    const vue = await env.DB.prepare("SELECT id FROM tags WHERE name = 'Vue'").first<{ id: number }>();
    const res = await api(`/tags/${vue!.id}`, { method: 'PUT', cookie, body: { name: 'react' } });
    expect(res.status).toBe(409);
  });

  it('統合すると記事のタグが付け替わる', async () => {
    const { post } = await create({ tags: ['JS'] });
    await create({ tags: ['JavaScript'] });
    const js = await env.DB.prepare("SELECT id FROM tags WHERE name = 'JS'").first<{ id: number }>();
    const javascript = await env.DB.prepare("SELECT id FROM tags WHERE name = 'JavaScript'").first<{ id: number }>();
    const res = await api(`/tags/${js!.id}/merge`, { method: 'POST', cookie, body: { intoId: javascript!.id } });
    expect(res.status).toBe(200);
    const after = (await (await api(`/posts/${post!.id}`, { cookie })).json()) as { post: ApiPost };
    expect(after.post.tags).toEqual(['JavaScript']);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first('n')).toBe(1);
  });

  it('未使用のタグをまとめて削除できる', async () => {
    const { post } = await create({ tags: ['a', 'b'] });
    await update(post!, { tags: ['a'] });
    const res = await api('/tags/delete-unused', { method: 'POST', cookie });
    expect(await res.json()).toEqual({ deleted: 1 });
  });
});

describe('記事の更新', () => {
  it('更新するとタグと抜粋も変わる', async () => {
    const { post } = await create({ tags: ['a'] });
    const res = await update(post!, { bodyHtml: '<p>新しい本文</p>', tags: ['b'] });
    expect(res.status).toBe(200);
    const { post: updated } = (await res.json()) as { post: ApiPost };
    expect(updated).toMatchObject({ excerpt: '新しい本文', tags: ['b'] });
    expect(updated.updatedAt).toBeGreaterThan(post!.updatedAt);
  });

  it('ほかの画面で先に保存されていたら 409 で、何も変わらない', async () => {
    const { post } = await create({ tags: ['a'] });
    expect((await update(post!, { title: '先に保存' })).status).toBe(200);
    const stale = await update(post!, { title: '後から保存', tags: ['z'] });
    expect(stale.status).toBe(409);
    const current = (await (await api(`/posts/${post!.id}`, { cookie })).json()) as { post: ApiPost };
    expect(current.post).toMatchObject({ title: '先に保存', tags: ['a'] });
  });

  it('URL を空にすると今の URL のまま', async () => {
    const { post } = await create();
    const res = await update(post!, { slug: '' });
    expect(((await res.json()) as { post: ApiPost }).post.slug).toBe('hello-world');
  });

  it('ほかの記事の URL には変えられない', async () => {
    await create({ slug: 'taken' });
    const { post } = await create();
    expect((await update(post!, { slug: 'taken' })).status).toBe(409);
  });

  it('削除できる', async () => {
    const { post } = await create({ tags: ['a'] });
    expect((await api(`/posts/${post!.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/posts/${post!.id}`, { cookie })).status).toBe(404);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM post_tags').first('n')).toBe(0);
  });
});

describe('記事一覧', () => {
  it('状態で絞り込み、タイトルで検索できる', async () => {
    await create({ title: 'Draft one' });
    await create({ title: 'Published one', status: 'published' });
    await create({ title: 'Scheduled one', status: 'published', publishedAt: Math.floor(Date.now() / 1000) + 3600 });

    const titles = async (query: string) =>
      ((await (await api(`/posts${query}`, { cookie })).json()) as { items: ApiPost[] }).items.map((p) => p.title);

    expect(await titles('?state=draft')).toEqual(['Draft one']);
    expect(await titles('?state=published')).toEqual(['Published one']);
    expect(await titles('?state=scheduled')).toEqual(['Scheduled one']);
    expect(await titles('?q=sched')).toEqual(['Scheduled one']);
    expect((await titles('')).length).toBe(3);
  });

  it('20 件ずつ、続きはカーソルで取得する', async () => {
    for (let i = 0; i < 25; i++) await create({ title: `Post ${i}` });
    const first = (await (await api('/posts', { cookie })).json()) as { items: ApiPost[]; nextCursor: string };
    expect(first.items).toHaveLength(20);
    const second = (await (await api(`/posts?cursor=${first.nextCursor}`, { cookie })).json()) as { items: ApiPost[]; nextCursor: null };
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((p) => p.id));
    expect(ids.size).toBe(25);
  });
});

describe('サイト設定', () => {
  it('取得と更新ができる', async () => {
    const res = await api('/settings', { method: 'PUT', cookie, body: { siteTitle: '新しい名前', siteDescription: '説明', postsPerPage: 5 } });
    expect(await res.json()).toMatchObject({ siteTitle: '新しい名前', siteDescription: '説明', postsPerPage: 5, publicUrl: 'https://etlits.dev' });
  });

  it('不正な値は 400', async () => {
    const res = await api('/settings', { method: 'PUT', cookie, body: { siteTitle: '', siteDescription: '', postsPerPage: 5 } });
    expect(res.status).toBe(400);
    const res2 = await api('/settings', { method: 'PUT', cookie, body: { siteTitle: 'x', siteDescription: '', postsPerPage: 0 } });
    expect(res2.status).toBe(400);
  });
});
