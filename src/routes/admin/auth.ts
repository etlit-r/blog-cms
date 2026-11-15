import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../env';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  changePassword,
  clearLoginAttempts,
  consumeLoginAttempt,
  countUsers,
  createSession,
  createUser,
  deleteSession,
  getUser,
  isValidSession,
  validateCredentials,
  validatePassword,
  verifyPassword,
} from '../../lib/auth';
import { timingSafeEqualString } from '../../lib/crypto';
import { apiError, readJson } from '../../lib/http';

export const auth = new Hono<AppEnv>();

export function getSessionToken(c: Context<AppEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

function setSessionCookie(c: Context<AppEnv>, token: string) {
  // __Host- 接頭辞: Secure 必須・Domain なし・Path=/ のときだけブラウザが受け入れる。
  // Domain を付けないので、Cookie は管理ホスト (admin.etlits.dev) にしか送られない。
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

function clientIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown';
}

function lockedResponse(c: Context<AppEnv>, seconds: number) {
  c.header('Retry-After', String(seconds));
  const minutes = Math.ceil(seconds / 60);
  return apiError(c, 429, 'too_many_attempts', `試行回数が多すぎるため一時的にロックしています。約${minutes}分後にもう一度お試しください`);
}

/** 画面の出し分けに使う状態（ログイン前でも呼べる） */
auth.get('/status', async (c) => {
  const user = await getUser(c.env.DB);
  const loggedIn = user !== null && (await isValidSession(c.env.DB, getSessionToken(c)));
  return c.json({
    setupRequired: user === null,
    loggedIn,
    username: loggedIn ? user.username : null,
  });
});

/** 初回アカウント作成。アカウントが 1 件でもあれば常に拒否する */
auth.post('/setup', async (c) => {
  const db = c.env.DB;
  const ip = clientIp(c);

  if (!c.env.SETUP_TOKEN) {
    return apiError(c, 503, 'setup_token_not_configured', 'SETUP_TOKEN が設定されていません。`wrangler secret put SETUP_TOKEN` で設定してください');
  }
  if ((await countUsers(db)) > 0) {
    return apiError(c, 403, 'already_set_up', 'アカウントはすでに作成されています');
  }
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');

  // トークンを照合する前に試行回数を数える（総当たり対策）
  const locked = await consumeLoginAttempt(db, ip);
  if (locked > 0) return lockedResponse(c, locked);

  const { setupToken, username, password } = body;
  if (typeof setupToken !== 'string' || !(await timingSafeEqualString(setupToken, c.env.SETUP_TOKEN))) {
    return apiError(c, 403, 'invalid_setup_token', 'セットアップトークンが正しくありません');
  }
  const invalid = validateCredentials(username, password);
  if (invalid) return apiError(c, 400, 'invalid_input', invalid);

  const created = await createUser(db, username as string, password as string);
  if (!created) return apiError(c, 403, 'already_set_up', 'アカウントはすでに作成されています');

  await clearLoginAttempts(db, ip);
  setSessionCookie(c, await createSession(db, c.req.header('User-Agent')));
  return c.json({ ok: true }, 201);
});

auth.post('/login', async (c) => {
  const db = c.env.DB;
  const ip = clientIp(c);

  const body = await readJson(c);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return apiError(c, 400, 'invalid_body', 'ユーザー名とパスワードを入力してください');
  }

  const user = await getUser(db);
  if (!user) return apiError(c, 409, 'setup_required', 'アカウントがまだ作成されていません');

  // パスワードを照合する前に試行回数を数える。同時に大量に送られても照合できるのは上限回数まで
  const locked = await consumeLoginAttempt(db, ip);
  if (locked > 0) return lockedResponse(c, locked);

  // ユーザー名が違っても、パスワードの照合は必ず行う（応答時間の差で推測されないように）
  const passwordOk = await verifyPassword(body.password, user);
  const usernameOk = await timingSafeEqualString(body.username.trim(), user.username);
  if (!passwordOk || !usernameOk) {
    return apiError(c, 401, 'invalid_credentials', 'ユーザー名またはパスワードが正しくありません');
  }

  await clearLoginAttempts(db, ip);
  setSessionCookie(c, await createSession(db, c.req.header('User-Agent')));
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  await deleteSession(c.env.DB, getSessionToken(c));
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

/**
 * パスワード変更。ログインの確認は /api/admin/* のミドルウェアで済んでいる。
 * 変更後は他の端末のセッションもすべて無効にする。
 */
auth.put('/password', async (c) => {
  const db = c.env.DB;
  const ip = clientIp(c);
  const body = await readJson(c);
  if (!body || typeof body.currentPassword !== 'string') {
    return apiError(c, 400, 'invalid_body', '現在のパスワードを入力してください');
  }
  const invalid = validatePassword(body.newPassword);
  if (invalid) return apiError(c, 400, 'invalid_input', invalid);

  // セッションを盗まれた場合に現在のパスワードを総当たりされないよう、ここも回数を制限する
  const locked = await consumeLoginAttempt(db, ip);
  if (locked > 0) return lockedResponse(c, locked);

  const user = await getUser(db);
  if (!user || !(await verifyPassword(body.currentPassword, user))) {
    return apiError(c, 403, 'invalid_credentials', '現在のパスワードが正しくありません');
  }

  await clearLoginAttempts(db, ip);
  setSessionCookie(c, await changePassword(db, body.newPassword as string, c.req.header('User-Agent')));
  return c.json({ ok: true });
});
