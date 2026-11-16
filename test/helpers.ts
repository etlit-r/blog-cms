import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sha256Hex } from '../src/lib/crypto';

export const ADMIN = 'https://admin.etlits.dev';
export const PUBLIC = 'https://etlits.dev';

export type ApiOptions = { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string };

/** 管理 API を呼ぶ（Origin は管理ホストを付ける） */
export function api(path: string, { method = 'GET', body, cookie, origin = ADMIN, ip = '203.0.113.1' }: ApiOptions = {}) {
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

/** すべてのテーブルを空にし、設定を初期値に戻す */
export async function resetDb() {
  const db = env.DB;
  await db.batch([
    ...['post_tags', 'post_media', 'posts', 'tags', 'media', 'templates', 'template_revisions', 'pages', 'sessions', 'login_attempts', 'users'].map(
      (t) => db.prepare(`DELETE FROM ${t}`),
    ),
    db.prepare(
      "UPDATE settings SET value = CASE key WHEN 'site_title' THEN 'etlits' WHEN 'site_description' THEN '' WHEN 'posts_per_page' THEN '10' ELSE value END",
    ),
  ]);
}

/**
 * パスワードのハッシュ計算を省いて、アカウントとセッションを DB に直接作る（認証以外のテスト用）。
 * 返り値はリクエストに付ける Cookie ヘッダーの値。
 */
export async function ownerSession(): Promise<string> {
  const token = `test-session-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, username, password_hash, password_salt, iterations, created_at, updated_at) VALUES (1, 'owner', 'x', 'x', 1, 0, 0)",
    ),
    env.DB.prepare('INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, 0)').bind(await sha256Hex(token), 4_000_000_000),
  ]);
  return `__Host-sid=${token}`;
}
