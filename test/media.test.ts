import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, PUBLIC, api, ownerSession, resetDb } from './helpers';

let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await ownerSession();
});

/** 先頭が WebP の形をしたダミーの画像データ */
function fakeWebp(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (let i = 12; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

type ApiMedia = { id: number; url: string; thumbUrl: string; width: number; height: number; thumbWidth: number; alt: string; usageCount: number };

async function upload(opts: { original?: Uint8Array; thumb?: Uint8Array; width?: number; height?: number; alt?: string } = {}) {
  const form = new FormData();
  form.set('original', new File([opts.original ?? fakeWebp(200)], 'a.webp', { type: 'image/webp' }));
  form.set('thumb', new File([opts.thumb ?? fakeWebp(100)], 'a-thumb.webp', { type: 'image/webp' }));
  form.set('width', String(opts.width ?? 1600));
  form.set('height', String(opts.height ?? 1200));
  form.set('alt', opts.alt ?? '');
  const res = await SELF.fetch(`${ADMIN}/api/admin/media`, { method: 'POST', headers: { Cookie: cookie, Origin: ADMIN }, body: form });
  return { res, media: res.status === 201 ? ((await res.json()) as { media: ApiMedia }).media : null };
}

async function createPost(body: Record<string, unknown>) {
  const res = await api('/posts', { method: 'POST', cookie, body: { title: 'Photo post', status: 'published', tags: [], ...body } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { post: { id: number; slug: string; updatedAt: number; coverAuto: boolean; coverUrl: string | null } }).post;
}

const img = (m: ApiMedia, alt = '') => `<p><img src="${m.url}" alt="${alt}"></p>`;

describe('アップロード', () => {
  it('R2 に保存し、公開・管理の両方のホストから取得できる', async () => {
    const { res, media } = await upload({ alt: '紅葉' });
    expect(res.status).toBe(201);
    expect(media!.url).toMatch(/^\/media\/img\/\d{4}\/\d{2}\/[0-9A-Z]{26}\.webp$/);
    expect(media!.thumbUrl).toMatch(/-w800\.webp$/);
    expect(media).toMatchObject({ width: 1600, height: 1200, thumbWidth: 800, alt: '紅葉', usageCount: 0 });

    for (const host of [PUBLIC, ADMIN]) {
      const got = await SELF.fetch(`${host}${media!.url}`);
      expect(got.status).toBe(200);
      expect(got.headers.get('Content-Type')).toBe('image/webp');
      expect(got.headers.get('Cache-Control')).toContain('immutable');
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(fakeWebp(200));
    }
    const thumb = await SELF.fetch(`${PUBLIC}${media!.thumbUrl}`);
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(fakeWebp(100));
  });

  it('ETag が一致すれば 304', async () => {
    const { media } = await upload();
    const first = await SELF.fetch(`${PUBLIC}${media!.url}`);
    await first.arrayBuffer();
    const etag = first.headers.get('ETag')!;
    const second = await SELF.fetch(`${PUBLIC}${media!.url}`, { headers: { 'If-None-Match': etag } });
    expect(second.status).toBe(304);
  });

  it('画像でないファイルは拒否する', async () => {
    const text = new TextEncoder().encode('<script>alert(1)</script>');
    expect((await upload({ original: text })).res.status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first('n')).toBe(0);
  });

  it('大きさが上限を超えていたら拒否する', async () => {
    expect((await upload({ width: 4000 })).res.status).toBe(400);
  });

  it('ログインしていないとアップロードできない', async () => {
    const form = new FormData();
    const res = await SELF.fetch(`${ADMIN}/api/admin/media`, { method: 'POST', headers: { Origin: ADMIN }, body: form });
    expect(res.status).toBe(401);
  });

  it('存在しないキーや不正なキーは 404', async () => {
    expect((await SELF.fetch(`${PUBLIC}/media/img/2026/11/01JCXXXXXXXXXXXXXXXXXXXXXX.webp`)).status).toBe(404);
    expect((await SELF.fetch(`${PUBLIC}/media/../secret`)).status).toBe(404);
    expect((await SELF.fetch(`${PUBLIC}/media/%E0`)).status).toBe(404);
  });

  it('本文に壊れた URL の画像があっても保存できる', async () => {
    const post = await createPost({ bodyHtml: '<img src="/media/%E0">' });
    expect(post.coverUrl).toBeNull();
  });
});

describe('カバー画像', () => {
  it('本文の先頭の画像が自動でカバーになり、トップに大きく表示される', async () => {
    const { media: a } = await upload({ alt: '一枚目' });
    const { media: b } = await upload();
    const post = await createPost({ bodyHtml: `<p>文章</p>${img(a!)}${img(b!)}` });
    expect(post.coverAuto).toBe(true);
    expect(post.coverUrl).toBe(a!.url);

    const html = await (await SELF.fetch(`${PUBLIC}/`)).text();
    expect(html).toContain(`class="post-card-cover" src="${a!.url}"`);
    expect(html).toContain(`${a!.thumbUrl} 800w`);
    expect(html).toContain('alt="一枚目"');
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain(`<meta property="og:image" content="https://etlits.dev${a!.url}">`);
  });

  it('絶対 URL やサムネイルの URL でもカバーになる', async () => {
    const { media } = await upload();
    const post = await createPost({ bodyHtml: `<img src="https://etlits.dev${media!.thumbUrl}">` });
    expect(post.coverUrl).toBe(media!.url);
  });

  it('ほかのサイトの画像はカバーにならない', async () => {
    const post = await createPost({ bodyHtml: '<img src="https://example.com/media/img/2026/11/01JCXXXXXXXXXXXXXXXXXXXXXX.webp">' });
    expect(post.coverUrl).toBeNull();
  });

  it('手動で選んだ画像をカバーにでき、本文を変えても変わらない', async () => {
    const { media: a } = await upload();
    const { media: b } = await upload();
    const post = await createPost({ bodyHtml: `${img(a!)}${img(b!)}`, coverImage: b!.url });
    expect(post).toMatchObject({ coverAuto: false, coverUrl: b!.url });

    const res = await api(`/posts/${post.id}`, {
      method: 'PUT',
      cookie,
      body: { title: 'Photo post', status: 'published', tags: [], bodyHtml: img(a!), coverImage: b!.url, updatedAt: post.updatedAt },
    });
    expect(((await res.json()) as { post: { coverUrl: string } }).post.coverUrl).toBe(b!.url);
  });

  it('本文を変えると自動のカバーも変わる', async () => {
    const { media: a } = await upload();
    const { media: b } = await upload();
    const post = await createPost({ bodyHtml: img(a!) });
    const res = await api(`/posts/${post.id}`, {
      method: 'PUT',
      cookie,
      body: { title: 'Photo post', status: 'published', tags: [], bodyHtml: img(b!), updatedAt: post.updatedAt },
    });
    expect(((await res.json()) as { post: { coverUrl: string } }).post.coverUrl).toBe(b!.url);
  });

  it('存在しない画像をカバーに指定すると 400', async () => {
    const res = await api('/posts', {
      method: 'POST',
      cookie,
      body: { title: 'x', status: 'draft', bodyHtml: '', coverImage: '/media/img/2026/11/01JCXXXXXXXXXXXXXXXXXXXXXX.webp' },
    });
    expect(res.status).toBe(400);
  });
});

describe('記事ページの画像', () => {
  it('本文の画像に遅延読み込み・大きさ・srcset を付ける', async () => {
    const { media } = await upload({ width: 1200, height: 1600 });
    const post = await createPost({ bodyHtml: img(media!, '縦長') });
    const html = await (await SELF.fetch(`${PUBLIC}/posts/${post.slug}`)).text();
    const tag = html.match(/<img src="\/media\/[^>]+>/)![0];
    expect(tag).toContain('loading="lazy"');
    expect(tag).toContain('width="1200"');
    expect(tag).toContain('height="1600"');
    expect(tag).toContain(`${media!.thumbUrl} 600w`);
    expect(tag).toContain('alt="縦長"');
  });

  it('自分で書いた属性は上書きしない', async () => {
    const { media } = await upload();
    const post = await createPost({ bodyHtml: `<img src="${media!.url}" loading="eager" width="10" height="10">` });
    const html = await (await SELF.fetch(`${PUBLIC}/posts/${post.slug}`)).text();
    const tag = html.match(/<img src="\/media\/[^>]+>/)![0];
    expect(tag).toContain('loading="eager"');
    expect(tag).toContain('width="10"');
  });
});

describe('メディアの管理', () => {
  it('一覧に使用数を出し、30 件ずつ取得する', async () => {
    const uploaded: ApiMedia[] = [];
    for (let i = 0; i < 32; i++) uploaded.push((await upload()).media!);
    await createPost({ bodyHtml: img(uploaded[31]!) });

    const first = (await (await api('/media', { cookie })).json()) as { items: ApiMedia[]; nextCursor: string };
    expect(first.items).toHaveLength(30);
    expect(first.items[0]!.id).toBe(uploaded[31]!.id);
    expect(first.items[0]!.usageCount).toBe(1);
    const second = (await (await api(`/media?cursor=${first.nextCursor}`, { cookie })).json()) as { items: ApiMedia[]; nextCursor: null };
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it('カバーにだけ使っている画像も使用中として数える', async () => {
    const { media: a } = await upload();
    const { media: b } = await upload();
    await createPost({ bodyHtml: img(a!), coverImage: b!.url });
    const { items } = (await (await api('/media', { cookie })).json()) as { items: ApiMedia[] };
    expect(items.find((m) => m.id === b!.id)!.usageCount).toBe(1);
  });

  it('代替テキストを変更できる', async () => {
    const { media } = await upload();
    expect((await api(`/media/${media!.id}`, { method: 'PUT', cookie, body: { alt: '新しい説明' } })).status).toBe(200);
    const got = (await (await api(`/media/${media!.id}`, { cookie })).json()) as { media: ApiMedia };
    expect(got.media.alt).toBe('新しい説明');
  });

  it('記事で使われている画像は確認なしでは削除できない', async () => {
    const { media: a } = await upload();
    const { media: b } = await upload();
    const post = await createPost({ title: '写真の記事', bodyHtml: `${img(a!)}${img(b!)}` });

    const blocked = await api(`/media/${a!.id}`, { method: 'DELETE', cookie });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: 'in_use', posts: [{ id: post.id, title: '写真の記事' }] } });

    const forced = await api(`/media/${a!.id}?force=1`, { method: 'DELETE', cookie });
    expect(forced.status).toBe(200);
    expect(await env.MEDIA.get(a!.url.slice('/media/'.length))).toBeNull();
    expect(await env.MEDIA.get(a!.thumbUrl.slice('/media/'.length))).toBeNull();

    // カバーは本文の次の画像に移る
    const after = (await (await api(`/posts/${post.id}`, { cookie })).json()) as { post: { coverUrl: string } };
    expect(after.post.coverUrl).toBe(b!.url);
  });

  it('使われていない画像はそのまま削除できる', async () => {
    const { media } = await upload();
    expect((await api(`/media/${media!.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first('n')).toBe(0);
  });

  it('削除した画像はキャッシュからも配信されない', async () => {
    const { media } = await upload();
    const first = await SELF.fetch(`${PUBLIC}${media!.url}`);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    // キャッシュへの保存（waitUntil）が終わるのを待つ
    await new Promise((r) => setTimeout(r, 50));
    expect((await api(`/media/${media!.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await SELF.fetch(`${PUBLIC}${media!.url}`)).status).toBe(404);
  });
});
