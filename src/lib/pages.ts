import { randomBytes } from './crypto';
import { now } from './http';
import { BODY_MAX, SLUG_MAX, SLUG_PATTERN, TITLE_MAX, generateSlug } from './posts';

/** 固定ページ（About など）。URL は /p/:slug */
export type PageRow = {
  id: number;
  slug: string;
  title: string;
  body_html: string;
  editor_mode: 'rich' | 'html';
  status: 'draft' | 'published';
  sort_order: number;
  updated_at: number;
};

export type PageInput = {
  title: string;
  slug: string | null; // null なら自動生成
  bodyHtml: string;
  editorMode: 'rich' | 'html';
  status: 'draft' | 'published';
  sortOrder: number;
};

export function pageUrl(slug: string): string {
  return `/p/${slug}`;
}

export function toApiPage(row: PageRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyHtml: row.body_html,
    editorMode: row.editor_mode,
    status: row.status,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export function parsePageInput(body: Record<string, unknown>): { value: PageInput } | { error: string } {
  const { title, slug, bodyHtml, editorMode, status, sortOrder } = body;
  if (typeof title !== 'string' || !title.trim()) return { error: 'タイトルを入力してください' };
  if ([...title.trim()].length > TITLE_MAX) return { error: `タイトルは${TITLE_MAX}文字以内にしてください` };
  if (status !== 'draft' && status !== 'published') return { error: '公開状態の指定が正しくありません' };
  if (typeof bodyHtml !== 'string') return { error: '本文の形式が正しくありません' };
  if (bodyHtml.length > BODY_MAX) return { error: '本文が長すぎます' };
  const mode = editorMode ?? 'rich';
  if (mode !== 'rich' && mode !== 'html') return { error: 'エディタの指定が正しくありません' };

  let cleanSlug: string | null = null;
  if (slug !== undefined && slug !== null && slug !== '') {
    if (typeof slug !== 'string') return { error: 'URL の形式が正しくありません' };
    cleanSlug = slug.trim().toLowerCase();
    if (cleanSlug.length > SLUG_MAX || !SLUG_PATTERN.test(cleanSlug)) {
      return { error: `URL に使えるのは半角英小文字・数字・ハイフンで、${SLUG_MAX}文字以内です（例: about）` };
    }
  }

  const order = sortOrder ?? 0;
  if (typeof order !== 'number' || !Number.isInteger(order) || Math.abs(order) > 1_000_000) return { error: '並び順は整数にしてください' };

  return { value: { title: title.trim(), slug: cleanSlug, bodyHtml, editorMode: mode, status, sortOrder: order } };
}

export async function pageSlugExists(db: D1Database, slug: string, exceptId?: number): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM pages WHERE slug = ? AND id != ?').bind(slug, exceptId ?? -1).first()) !== null;
}

/** タイトルから、ほかの固定ページと重ならない URL を作る */
export async function uniquePageSlug(db: D1Database, title: string): Promise<string> {
  const base = generateSlug(title, now());
  let slug = base;
  for (let i = 0; i < 5 && (await pageSlugExists(db, slug)); i++) {
    slug = `${base.slice(0, SLUG_MAX - 5)}-${[...randomBytes(4)].map((b) => (b % 36).toString(36)).join('')}`;
  }
  return slug;
}

/** ヘッダーなどに並べる、公開中の固定ページ */
export async function navPages(db: D1Database): Promise<{ title: string; url: string }[]> {
  const { results } = await db
    .prepare("SELECT slug, title FROM pages WHERE status = 'published' ORDER BY sort_order, id")
    .all<{ slug: string; title: string }>();
  return results.map((r) => ({ title: r.title, url: pageUrl(r.slug) }));
}
