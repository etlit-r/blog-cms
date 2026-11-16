export const TAG_NAME_MAX = 50;
export const TAGS_PER_POST_MAX = 20;

/** 表示名を整える（前後の空白を除き、連続する空白を 1 つにする） */
export function cleanTagName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * 同じタグかどうかを判定するためのキー。
 * 全角・半角の違い（NFKC）、前後の空白、英字の大文字・小文字を区別しない。
 * 例: "ＣＳＳ" / " css " / "CSS" → "css"
 */
export function tagKey(name: string): string {
  return cleanTagName(name).toLowerCase();
}

export function tagUrl(name: string): string {
  return `/tags/${encodeURIComponent(name)}`;
}

/** タグ名の一覧を整えて、重複（同じキー）を取り除く。不正な名前があればエラーメッセージを返す */
export function normalizeTagNames(names: unknown): { names: string[] } | { error: string } {
  if (names === undefined) return { names: [] };
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) return { error: 'タグの形式が正しくありません' };

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names as string[]) {
    const name = cleanTagName(raw);
    if (!name) continue;
    if ([...name].length > TAG_NAME_MAX) return { error: `タグは${TAG_NAME_MAX}文字以内にしてください` };
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  if (result.length > TAGS_PER_POST_MAX) return { error: `タグは1記事あたり${TAGS_PER_POST_MAX}個までです` };
  return { names: result };
}

/** 記事の指定方法。id、または作成と同じ batch の中では slug で指す */
export type PostRef =
  | { id: number; /** 指定すると、記事の updated_at がこの値のときだけ変更する（競合検出用） */ ifUpdatedAt?: number }
  | { slug: string };

/**
 * 記事のタグを names に置き換える D1 ステートメントを返す。
 * 未登録のタグはここで作成する（同じキーのタグがあればそれを使う）。
 * ifUpdatedAt を指定する場合は、記事を UPDATE するステートメントより「前」に batch に入れること。
 */
export function setPostTagsStatements(db: D1Database, post: PostRef, names: string[], now: number): D1PreparedStatement[] {
  const [postIdSql, postIdArgs] = 'slug' in post ? ['(SELECT id FROM posts WHERE slug = ?)', [post.slug]] : ['?', [post.id]];
  const [guardSql, guardArgs] =
    'id' in post && post.ifUpdatedAt !== undefined
      ? ['EXISTS (SELECT 1 FROM posts WHERE id = ? AND updated_at = ?)', [post.id, post.ifUpdatedAt]]
      : ['1', []];

  return [
    ...names.map((name) =>
      db
        .prepare(`INSERT INTO tags (name, name_key, created_at) SELECT ?, ?, ? WHERE ${guardSql} ON CONFLICT(name_key) DO NOTHING`)
        .bind(name, tagKey(name), now, ...guardArgs),
    ),
    db.prepare(`DELETE FROM post_tags WHERE post_id = ${postIdSql} AND ${guardSql}`).bind(...postIdArgs, ...guardArgs),
    ...names.map((name) =>
      db
        .prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT ${postIdSql}, id FROM tags WHERE name_key = ? AND ${guardSql}`)
        .bind(...postIdArgs, tagKey(name), ...guardArgs),
    ),
  ];
}
