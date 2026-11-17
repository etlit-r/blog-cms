/**
 * batch の中で記事を指すための指定。id、または作成と同じ batch の中では slug で指す。
 * ifUpdatedAt を指定すると、記事の updated_at がこの値のときだけ変更する（競合検出用）。
 * その場合は、記事を UPDATE するステートメントより「前」に batch に入れること。
 */
export type PostRef = { id: number; ifUpdatedAt?: number } | { slug: string };

/** 記事 id を表す SQL 式と、その引数 */
export function postIdSql(post: PostRef): [string, unknown[]] {
  return 'slug' in post ? ['(SELECT id FROM posts WHERE slug = ?)', [post.slug]] : ['?', [post.id]];
}

/** 競合検出の条件を表す SQL 式と、その引数（条件がなければ常に真） */
export function guardSql(post: PostRef): [string, unknown[]] {
  return 'id' in post && post.ifUpdatedAt !== undefined
    ? ['EXISTS (SELECT 1 FROM posts WHERE id = ? AND updated_at = ?)', [post.id, post.ifUpdatedAt]]
    : ['1', []];
}
