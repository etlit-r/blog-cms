export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 管理 API を呼ぶ。失敗時は ApiError を投げる（message はそのまま画面に出せる日本語） */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', '通信できませんでした。電波の状態を確認してください');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `エラーが発生しました (${res.status})`);
  }
  return data as T;
}

export type AuthStatus = { setupRequired: boolean; loggedIn: boolean; username: string | null };
