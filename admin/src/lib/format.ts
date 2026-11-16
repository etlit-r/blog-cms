import type { PostState } from './types';

export const STATE_LABELS: Record<PostState, string> = {
  draft: '下書き',
  published: '公開中',
  scheduled: '予約',
};

const dateTime = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** UNIX 秒 → 「2026/11/16 09:30」（端末のタイムゾーン） */
export function formatDateTime(seconds: number): string {
  return dateTime.format(new Date(seconds * 1000));
}

/** UNIX 秒 → <input type="datetime-local"> の値 */
export function toLocalInput(seconds: number | null): string {
  if (seconds === null) return '';
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> の値 → UNIX 秒（空なら null） */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
