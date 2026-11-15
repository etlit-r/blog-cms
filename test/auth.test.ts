import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const ADMIN = 'https://admin.etlits.dev';
const PUBLIC = 'https://etlits.dev';
const SETUP_TOKEN = 'test-setup-token';
const PASSWORD = 'correct horse battery';

type Opts = { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string };

function api(path: string, { method = 'GET', body, cookie, origin = ADMIN, ip = '203.0.113.1' }: Opts = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origin && method !== 'GET') headers.Origin = origin;
  return SELF.fetch(`${ADMIN}/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Set-Cookie からリクエスト用の Cookie ヘッダー値を取り出す */
function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const match = setCookie.match(/__Host-sid=([^;]+)/);
  if (!match) throw new Error(`session cookie not set: ${setCookie}`);
  return `__Host-sid=${match[1]}`;
}

async function setup(overrides: Record<string, unknown> = {}, opts: Opts = {}) {
  return api('/auth/setup', {
    method: 'POST',
    body: { setupToken: SETUP_TOKEN, username: 'owner', password: PASSWORD, ...overrides },
    ...opts,
  });
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM login_attempts'),
    env.DB.prepare('DELETE FROM users'),
  ]);
});

describe('ホストによる振り分け', () => {
  it('公開ホストのトップページを返す', async () => {
    const res = await SELF.fetch(`${PUBLIC}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html');
  });

  it('公開ホストでは管理 API と管理画面を返さない', async () => {
    expect((await SELF.fetch(`${PUBLIC}/api/admin/auth/status`)).status).toBe(404);
    expect((await SELF.fetch(`${PUBLIC}/admin/`)).status).toBe(404);
  });

  it('知らないホストは 404', async () => {
    expect((await SELF.fetch('https://example.com/')).status).toBe(404);
  });
});

describe('初回セットアップ', () => {
  it('アカウントがなければ setupRequired', async () => {
    const res = await api('/auth/status');
    expect(await res.json()).toEqual({ setupRequired: true, loggedIn: false, username: null });
  });

  it('セットアップトークンが違うと作成できない', async () => {
    const res = await setup({ setupToken: 'wrong' });
    expect(res.status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
  });

  it('短いパスワードは拒否する', async () => {
    const res = await setup({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('作成に成功するとログイン状態になる', async () => {
    const res = await setup();
    expect(res.status).toBe(201);

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/^__Host-sid=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toMatch(/Domain=/i);

    const status = await api('/auth/status', { cookie: sessionCookie(res) });
    expect(await status.json()).toEqual({ setupRequired: false, loggedIn: true, username: 'owner' });
  });

  it('2 つ目のアカウントは作れない', async () => {
    expect((await setup()).status).toBe(201);
    const second = await setup({ username: 'someone' });
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ error: { code: 'already_set_up' } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
  });

  it('DB 制約でも 2 行目は入らない', async () => {
    expect((await setup()).status).toBe(201);
    const insert = (id: number) =>
      env.DB.prepare(
        "INSERT INTO users (id, username, password_hash, password_salt, iterations, created_at, updated_at) VALUES (?, 'x', 'x', 'x', 1, 0, 0)",
      )
        .bind(id)
        .run();
    await expect(insert(1)).rejects.toThrow();
    await expect(insert(2)).rejects.toThrow();
  });

  it('同時に送られても作られるのは 1 件だけ', async () => {
    const results = await Promise.all([setup({ username: 'a' }), setup({ username: 'b' }), setup({ username: 'c' })]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
  });
});

describe('CSRF 対策（Origin の検証）', () => {
  it('Origin がないと拒否する', async () => {
    const res = await setup({}, { origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_origin' } });
  });

  it('公開ホストからのリクエストは拒否する', async () => {
    const res = await setup({}, { origin: PUBLIC });
    expect(res.status).toBe(403);
  });
});

describe('ログイン', () => {
  beforeEach(async () => {
    await setup();
    await env.DB.prepare('DELETE FROM sessions').run();
  });

  const login = (password: string, ip?: string) => api('/auth/login', { method: 'POST', body: { username: 'owner', password }, ip });

  it('正しいパスワードでログインできる', async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(200);
    const status = await api('/auth/status', { cookie: sessionCookie(res) });
    expect(await status.json()).toMatchObject({ loggedIn: true });
  });

  it('間違ったパスワードは 401', async () => {
    expect((await login('wrong password!!')).status).toBe(401);
  });

  it('ユーザー名が違うと 401', async () => {
    const res = await api('/auth/login', { method: 'POST', body: { username: 'other', password: PASSWORD } });
    expect(res.status).toBe(401);
  });

  it('5 回失敗するとロックされ、正しいパスワードでも入れない', async () => {
    for (let i = 0; i < 5; i++) expect((await login('wrong password!!')).status).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBeTruthy();

    // 別の IP からは影響を受けない
    expect((await login(PASSWORD, '198.51.100.7')).status).toBe(200);
  });

  it('ログアウトするとセッションが無効になる', async () => {
    const cookie = sessionCookie(await login(PASSWORD));
    expect((await api('/auth/logout', { method: 'POST', cookie })).status).toBe(200);
    const status = await api('/auth/status', { cookie });
    expect(await status.json()).toMatchObject({ loggedIn: false });
  });
});

describe('ログインが必要な API', () => {
  it('セッションなしでは 401', async () => {
    await setup();
    expect((await api('/posts')).status).toBe(401);
  });

  it('偽のセッションでは 401', async () => {
    await setup();
    expect((await api('/posts', { cookie: '__Host-sid=forged' })).status).toBe(401);
  });
});

describe('パスワード変更', () => {
  it('変更後は古いセッションと古いパスワードが使えない', async () => {
    const oldCookie = sessionCookie(await setup());

    const wrong = await api('/auth/password', {
      method: 'PUT',
      cookie: oldCookie,
      body: { currentPassword: 'not the password', newPassword: 'new password 123' },
    });
    expect(wrong.status).toBe(403);

    const res = await api('/auth/password', {
      method: 'PUT',
      cookie: oldCookie,
      body: { currentPassword: PASSWORD, newPassword: 'new password 123' },
    });
    expect(res.status).toBe(200);
    const newCookie = sessionCookie(res);

    expect(await (await api('/auth/status', { cookie: oldCookie })).json()).toMatchObject({ loggedIn: false });
    expect(await (await api('/auth/status', { cookie: newCookie })).json()).toMatchObject({ loggedIn: true });

    const oldLogin = await api('/auth/login', { method: 'POST', body: { username: 'owner', password: PASSWORD } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api('/auth/login', { method: 'POST', body: { username: 'owner', password: 'new password 123' } });
    expect(newLogin.status).toBe(200);
  });
});
