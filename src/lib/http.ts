import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ApiErrorBody = { error: { code: string; message: string } };

/** API のエラーレスポンスを統一した形で返す */
export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** JSON ボディを読み込む。壊れた JSON やオブジェクト以外は null */
export async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** URL の :id を正の整数として読む。不正なら null */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** LIKE の特殊文字をエスケープする（SQL 側では ESCAPE '\' と組み合わせて使う） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
