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
