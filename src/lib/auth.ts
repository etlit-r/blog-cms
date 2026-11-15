import { base64ToBytes, bytesToBase64, pbkdf2, randomBytes, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { now } from './http';

/** PBKDF2 の反復回数（workerd の上限は 100,000） */
export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 日
export const SESSION_COOKIE = '__Host-sid';

/** IP ごとに、この時間内に試せるのは LOGIN_MAX_ATTEMPTS 回まで */
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_ATTEMPTS = 5;

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
  const result = await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, iterations, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(username.trim(), hash, salt, iterations, t, t)
    .run();
  return result.meta.changes === 1;
}

/**
 * パスワードを変更し、すべてのセッションを無効にしたうえで新しいセッションを 1 つ発行する。
 * 3 つの書き込みは 1 回の batch（トランザクション）で行うので、途中で失敗して中途半端な状態にならない。
 */
export async function changePassword(db: D1Database, password: string, userAgent: string | undefined): Promise<string> {
  const { hash, salt, iterations } = await hashPassword(password);
  const { token, statement } = await newSession(db, userAgent);
  await db.batch([
    db
      .prepare('UPDATE users SET password_hash = ?, password_salt = ?, iterations = ?, updated_at = ? WHERE id = 1')
      .bind(hash, salt, iterations, now()),
    db.prepare('DELETE FROM sessions'),
    statement,
  ]);
  return token;
}

// ---------- セッション ----------

async function newSession(db: D1Database, userAgent: string | undefined) {
  const token = randomToken(32);
  const t = now();
  const statement = db
    .prepare('INSERT INTO sessions (token_hash, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), t + SESSION_TTL_SECONDS, t, userAgent?.slice(0, 256) ?? null);
  return { token, statement };
}

/** セッションを作成し、Cookie に入れる生のトークンを返す（DB にはハッシュだけを保存） */
export async function createSession(db: D1Database, userAgent: string | undefined): Promise<string> {
  const { token, statement } = await newSession(db, userAgent);
  const t = now();
  await db.batch([
    // 期限切れのセッションと古い試行記録の掃除（Cron を使わずログイン時に行う）
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    db.prepare('DELETE FROM login_attempts WHERE window_start <= ?').bind(t - LOGIN_WINDOW_SECONDS),
    statement,
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

// ---------- ログイン試行の制限 ----------

/**
 * 試行を 1 回分記録し、上限を超えていればロック解除までの秒数を返す（超えていなければ 0）。
 * パスワードを照合する「前」に 1 回の UPSERT で数えるので、同時に大量のリクエストを送られても
 * 照合まで進めるのは LOGIN_MAX_ATTEMPTS 回だけになる。成功したら clearLoginAttempts で消す。
 */
export async function consumeLoginAttempt(db: D1Database, ip: string): Promise<number> {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (ip, attempts, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         attempts     = CASE WHEN ?2 - window_start >= ?3 THEN 1  ELSE attempts + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
       RETURNING attempts, window_start`,
    )
    .bind(ip, t, LOGIN_WINDOW_SECONDS)
    .first<{ attempts: number; window_start: number }>();
  if (!row || row.attempts <= LOGIN_MAX_ATTEMPTS) return 0;
  return Math.max(1, row.window_start + LOGIN_WINDOW_SECONDS - t);
}

export async function clearLoginAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
