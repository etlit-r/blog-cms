/**
 * 編集中の記事を端末（localStorage）に自動保存する。
 * 通信が切れたり、ブラウザが閉じられたりしても、書いた内容が消えないようにするため。
 * サーバーへの保存は「保存」ボタンで行う。
 */

export type LocalDraft<T> = {
  form: T;
  /** 端末に保存した時刻（ミリ秒） */
  savedAt: number;
  /** 編集を始めたときのサーバー上の updatedAt（新規なら null） */
  baseUpdatedAt: number | null;
};

const PREFIX = 'blog-cms:draft:';

export function draftKey(postId: string | undefined): string {
  return `${PREFIX}${postId ?? 'new'}`;
}

export function loadDraft<T>(key: string): LocalDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft<T>;
    return parsed && typeof parsed === 'object' && 'form' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, draft: LocalDraft<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 容量不足やプライベートブラウズでは保存できない。編集は続けられるので何もしない
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}
