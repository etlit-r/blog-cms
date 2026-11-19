import { randomBytes } from './crypto';
import { makeExcerpt } from './html';
import { now } from './http';
import { coverAutoStatement, extractMediaKeys, mediaKeyFromSrc, mediaUrl, setPostMediaStatements } from './media';
import { bumpContentVersionStatement } from './settings';
import { normalizeTagNames, setPostTagsStatements } from './tags';

export const TITLE_MAX = 200;
export const SLUG_MAX = 80;
export const BODY_MAX = 500_000; // D1 の 1 行の上限 (2MB) に余裕を持たせる
export const EXCERPT_MAX = 300;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PostStatus = 'draft' | 'published';
/** 管理画面で表示する状態。公開日時が未来なら「予約」 */
export type PostState = 'draft' | 'published' | 'scheduled';

export type PostRow = {
  id: number;
  slug: string;
  title: string;
  body_html: string;
  editor_mode: 'rich' | 'html';
  excerpt: string | null;
  excerpt_auto: number;
  status: PostStatus;
  published_at: number | null;
  created_at: number;
  updated_at: number;
  tags_json: string | null;
  cover_auto: number;
  cover_media_id: number | null;
  /** カバー画像の R2 キー（media と結合して取得） */
  cover_key: string | null;
};

export type PostInput = {
  title: string;
  slug: string | null; // null なら自動生成
  bodyHtml: string;
  editorMode: 'rich' | 'html';
  excerpt: string | null; // null なら本文から自動生成
  status: PostStatus;
  publishedAt: number | null;
  tags: string[];
  /** 手動で選んだカバー画像のキー。null なら本文の先頭の画像を自動でカバーにする */
  coverKey: string | null;
};

export function postState(status: PostStatus, publishedAt: number | null, t = now()): PostState {
  if (status === 'draft') return 'draft';
  return publishedAt !== null && publishedAt > t ? 'scheduled' : 'published';
}

/** 記事に付いているタグ名を JSON 配列で取り出す SQL（p は posts の別名） */
export const TAGS_JSON_SQL = `(SELECT json_group_array(t.name) FROM (
    SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id ORDER BY t.name
  ) t) AS tags_json`;

export type PostSummaryRow = Pick<PostRow, 'id' | 'slug' | 'title' | 'status' | 'published_at' | 'created_at' | 'updated_at' | 'tags_json'>;

/** 一覧用（本文を含まない） */
export function toApiPostSummary(row: PostSummaryRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    state: postState(row.status, row.published_at),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: parseTags(row.tags_json),
  };
}

export function toApiPost(row: PostRow) {
  return {
    ...toApiPostSummary(row),
    bodyHtml: row.body_html,
    editorMode: row.editor_mode,
    excerpt: row.excerpt ?? '',
    excerptAuto: row.excerpt_auto === 1,
    coverAuto: row.cover_auto === 1,
    coverUrl: row.cover_key ? mediaUrl(row.cover_key) : null,
  };
}

export function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** API のリクエストボディを検証して PostInput にする */
export function parsePostInput(body: Record<string, unknown>, publicHost: string): { value: PostInput } | { error: string } {
  const { title, slug, bodyHtml, editorMode, excerpt, status, publishedAt, tags, coverImage } = body;

  if (typeof title !== 'string') return { error: 'タイトルの形式が正しくありません' };
  const cleanTitle = title.trim();
  if ([...cleanTitle].length > TITLE_MAX) return { error: `タイトルは${TITLE_MAX}文字以内にしてください` };

  if (status !== 'draft' && status !== 'published') return { error: '公開状態の指定が正しくありません' };
  if (status === 'published' && !cleanTitle) return { error: '公開するにはタイトルを入力してください' };

  let cleanSlug: string | null = null;
  if (slug !== undefined && slug !== null && slug !== '') {
    if (typeof slug !== 'string') return { error: 'URL の形式が正しくありません' };
    cleanSlug = slug.trim().toLowerCase();
    if (cleanSlug.length > SLUG_MAX || !SLUG_PATTERN.test(cleanSlug)) {
      return { error: `URL に使えるのは半角英小文字・数字・ハイフンで、${SLUG_MAX}文字以内です（例: my-first-post）` };
    }
  }

  if (typeof bodyHtml !== 'string') return { error: '本文の形式が正しくありません' };
  if (bodyHtml.length > BODY_MAX) return { error: '本文が長すぎます' };

  const mode = editorMode ?? 'rich';
  if (mode !== 'rich' && mode !== 'html') return { error: 'エディタの指定が正しくありません' };

  let cleanExcerpt: string | null = null;
  if (excerpt !== undefined && excerpt !== null) {
    if (typeof excerpt !== 'string') return { error: '抜粋の形式が正しくありません' };
    cleanExcerpt = excerpt.trim() || null;
    if (cleanExcerpt && [...cleanExcerpt].length > EXCERPT_MAX) return { error: `抜粋は${EXCERPT_MAX}文字以内にしてください` };
  }

  let pubAt: number | null = null;
  if (publishedAt !== undefined && publishedAt !== null) {
    if (typeof publishedAt !== 'number' || !Number.isInteger(publishedAt) || publishedAt < 0) {
      return { error: '公開日時の形式が正しくありません' };
    }
    pubAt = publishedAt;
  }
  // 公開するのに日時が未指定なら、今を公開日時にする
  if (status === 'published' && pubAt === null) pubAt = now();

  const normalized = normalizeTagNames(tags);
  if ('error' in normalized) return { error: normalized.error };

  // カバー画像は src（/media/...）で指定する。未指定・null なら自動
  let coverKey: string | null = null;
  if (coverImage !== undefined && coverImage !== null) {
    coverKey = typeof coverImage === 'string' ? mediaKeyFromSrc(coverImage, publicHost) : null;
    if (!coverKey) return { error: 'カバー画像の指定が正しくありません' };
    coverKey = coverKey.replace(/-w800(\.\w+)$/, '$1');
  }

  return {
    value: {
      title: cleanTitle,
      slug: cleanSlug,
      bodyHtml,
      editorMode: mode,
      excerpt: cleanExcerpt,
      status,
      publishedAt: pubAt,
      tags: normalized.names,
      coverKey,
    },
  };
}

/**
 * タイトルから URL 用の文字列を作る。
 * 英数字だけで作れるならそれを使い、日本語などを含む場合は「日付-ランダム文字列」にする。
 */
export function generateSlug(title: string, t = now()): string {
  const ascii = title.normalize('NFKC').toLowerCase();
  if (/^[\x20-\x7e]*$/.test(ascii)) {
    const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    if (slug.length >= 3) return slug;
  }
  const date = new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${randomSuffix()}`;
}

function randomSuffix(): string {
  return [...randomBytes(4)].map((b) => (b % 36).toString(36)).join('');
}

export async function slugExists(db: D1Database, slug: string, exceptId?: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?')
    .bind(slug, exceptId ?? -1)
    .first();
  return row !== null;
}

/** 自動生成した slug が既存の記事と重ならないようにする */
export async function uniqueSlug(db: D1Database, base: string, exceptId?: number): Promise<string> {
  let slug = base;
  for (let i = 0; i < 5 && (await slugExists(db, slug, exceptId)); i++) {
    slug = `${base.slice(0, SLUG_MAX - 5)}-${randomSuffix()}`;
  }
  return slug;
}

export async function getPost(db: D1Database, id: number): Promise<PostRow | null> {
  return db
    .prepare(`SELECT p.*, m.r2_key AS cover_key, ${TAGS_JSON_SQL} FROM posts p LEFT JOIN media m ON m.id = p.cover_media_id WHERE p.id = ?`)
    .bind(id)
    .first<PostRow>();
}

/** 記事を作成し、作成した記事の id を返す */
export async function createPost(db: D1Database, input: PostInput & { slug: string }, publicHost: string): Promise<number> {
  const t = now();
  const excerpt = input.excerpt ?? (await makeExcerpt(input.bodyHtml));
  const mediaKeys = await extractMediaKeys(input.bodyHtml, publicHost);
  const ref = { slug: input.slug };
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO posts (slug, title, body_html, editor_mode, excerpt, excerpt_auto, status, published_at, cover_auto, cover_media_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM media WHERE r2_key = ?), ?, ?)`,
      )
      .bind(
        input.slug,
        input.title,
        input.bodyHtml,
        input.editorMode,
        excerpt,
        input.excerpt === null ? 1 : 0,
        input.status,
        input.publishedAt,
        input.coverKey === null ? 1 : 0,
        input.coverKey,
        t,
        t,
      ),
    ...setPostTagsStatements(db, ref, input.tags, t),
    ...setPostMediaStatements(db, ref, mediaKeys),
    coverAutoStatement(db, ref),
    bumpContentVersionStatement(db),
  ]);
  return results[0]!.meta.last_row_id;
}

/**
 * 記事を更新する。expectedUpdatedAt が DB の値と違えば（別の端末で先に保存されていれば）false を返し、何も変更しない。
 */
export async function updatePost(
  db: D1Database,
  id: number,
  input: PostInput & { slug: string },
  expectedUpdatedAt: number,
  publicHost: string,
): Promise<boolean> {
  const t = now();
  const excerpt = input.excerpt ?? (await makeExcerpt(input.bodyHtml));
  const mediaKeys = await extractMediaKeys(input.bodyHtml, publicHost);
  const guarded = { id, ifUpdatedAt: expectedUpdatedAt };
  const statements = [
    // タグと画像の参照関係の変更は、記事の UPDATE と同じ条件（updated_at が一致する）のときだけ行う。
    // batch は 1 つのトランザクションとして順に実行されるので、UPDATE より前に置けば条件の判定がずれない
    ...setPostTagsStatements(db, guarded, input.tags, t),
    ...setPostMediaStatements(db, guarded, mediaKeys),
  ];
  const updateIndex = statements.length;
  statements.push(
    // 同じ秒に 2 回保存しても競合検出が効くよう、updated_at は必ず増やす
    db
      .prepare(
        `UPDATE posts SET slug = ?, title = ?, body_html = ?, editor_mode = ?, excerpt = ?, excerpt_auto = ?, status = ?, published_at = ?,
           cover_auto = ?, cover_media_id = (SELECT id FROM media WHERE r2_key = ?), updated_at = MAX(?, updated_at + 1)
         WHERE id = ? AND updated_at = ?`,
      )
      .bind(
        input.slug,
        input.title,
        input.bodyHtml,
        input.editorMode,
        excerpt,
        input.excerpt === null ? 1 : 0,
        input.status,
        input.publishedAt,
        input.coverKey === null ? 1 : 0,
        input.coverKey,
        t,
        id,
        expectedUpdatedAt,
      ),
    coverAutoStatement(db, { id }),
    bumpContentVersionStatement(db),
  );
  const results = await db.batch(statements);
  return results[updateIndex]!.meta.changes === 1;
}
