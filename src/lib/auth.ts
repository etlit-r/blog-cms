import { base64ToBytes, bytesToBase64, pbkdf2, randomBytes, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { now } from './http';

/** PBKDF2 の反復回数（workerd の上限は 100,000） */
export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 日
export const SESSION_COOKIE = '__Host-sid';

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_SECONDS = 15 * 60;

export const USERNAME_MAX = 64;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
};

// ---------- パスワード ----------

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: bytesToBase64(hash), salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, user: Pick<UserRow, 'password_hash' | 'password_salt' | 'iterations'>) {
  const hash = await pbkdf2(password, base64ToBytes(user.password_salt), user.iterations);
  return timingSafeEqual(hash, base64ToBytes(user.password_hash));
}

/** 入力チェック。問題があればエラーメッセージを返す */
export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || username.trim().length === 0) return 'ユーザー名を入力してください';
  if (username.trim().length > USERNAME_MAX) return `ユーザー名は${USERNAME_MAX}文字以内にしてください`;
  return validatePassword(password);
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `パスワードは${PASSWORD_MIN}文字以上にしてください`;
  if (password.length > PASSWORD_MAX) return `パスワードは${PASSWORD_MAX}文字以内にしてください`;
  return null;
}

// ---------- アカウント ----------

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getUser(db: D1Database): Promise<UserRow | null> {
  return db.prepare('SELECT id, username, password_hash, password_salt, iterations FROM users WHERE id = 1').first<UserRow>();
}

/**
 * 唯一のアカウントを作成する。すでに存在する場合は false。
 * id = 1 の CHECK 制約と主キーにより、同時に呼ばれても 2 件目は DB 側で必ず失敗する。
 */
export async function createUser(db: D1Database, username: string, password: string): Promise<boolean> {
  const { hash, salt, iterations } = await hashPassword(password);
  const t = now();
  try {
    const result = await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, password_salt, iterations, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(username.trim(), hash, salt, iterations, t, t)
      .run();
    return result.meta.changes === 1;
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed') || String(e).includes('CHECK constraint failed')) return false;
    throw e;
  }
}

export async function updatePassword(db: D1Database, password: string): Promise<void> {
  const { hash, salt, iterations } = await hashPassword(password);
  await db
    .prepare('UPDATE users SET password_hash = ?, password_salt = ?, iterations = ?, updated_at = ? WHERE id = 1')
    .bind(hash, salt, iterations, now())
    .run();
}

// ---------- セッション ----------

/** セッションを作成し、Cookie に入れる生のトークンを返す（DB にはハッシュだけを保存） */
export async function createSession(db: D1Database, userAgent: string | undefined): Promise<string> {
  const token = randomToken(32);
  const t = now();
  await db.batch([
    // 期限切れセッションの掃除（Cron を使わずログイン時に行う）
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    db
      .prepare('INSERT INTO sessions (token_hash, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), t + SESSION_TTL_SECONDS, t, userAgent?.slice(0, 256) ?? null),
  ]);
  return token;
}

export async function isValidSession(db: D1Database, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await db
    .prepare('SELECT 1 AS ok FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), now())
    .first();
  return row !== null;
}

export async function deleteSession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export async function deleteAllSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM sessions').run();
}

// ---------- ログイン試行の制限 ----------

/** ロック中ならロック解除までの秒数、ロックされていなければ 0 */
export async function lockedSeconds(db: D1Database, ip: string): Promise<number> {
  const row = await db.prepare('SELECT locked_until FROM login_attempts WHERE ip = ?').bind(ip).first<{ locked_until: number | null }>();
  const t = now();
  return row?.locked_until && row.locked_until > t ? row.locked_until - t : 0;
}

export async function recordLoginFailure(db: D1Database, ip: string): Promise<void> {
  const t = now();
  const row = await db
    .prepare('SELECT fail_count, first_at FROM login_attempts WHERE ip = ?')
    .bind(ip)
    .first<{ fail_count: number; first_at: number }>();

  // 一定時間が経っていれば数え直す
  const inWindow = row !== null && t - row.first_at < LOGIN_WINDOW_SECONDS;
  const failCount = inWindow ? row.fail_count + 1 : 1;
  const firstAt = inWindow ? row.first_at : t;
  const lockedUntil = failCount >= LOGIN_MAX_FAILURES ? t + LOGIN_LOCK_SECONDS : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (ip, fail_count, first_at, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fail_count = excluded.fail_count, first_at = excluded.first_at, locked_until = excluded.locked_until`,
    )
    .bind(ip, lockedUntil ? 0 : failCount, lockedUntil ? t : firstAt, lockedUntil)
    .run();
}

export async function clearLoginFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
