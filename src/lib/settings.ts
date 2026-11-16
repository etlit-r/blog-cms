export type SiteSettings = {
  siteTitle: string;
  siteDescription: string;
  postsPerPage: number;
};

export const POSTS_PER_PAGE_MAX = 50;

export async function getSettings(db: D1Database): Promise<SiteSettings> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('site_title', 'site_description', 'posts_per_page')")
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  const perPage = Number(map.get('posts_per_page'));
  return {
    siteTitle: map.get('site_title') ?? '',
    siteDescription: map.get('site_description') ?? '',
    postsPerPage: Number.isInteger(perPage) && perPage >= 1 && perPage <= POSTS_PER_PAGE_MAX ? perPage : 10,
  };
}

export function setSettingStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
}

/**
 * 公開ページの内容が変わったことを記録する（フェーズ 6 のキャッシュで、キャッシュキーに使う）。
 * 記事・タグ・設定を変更する batch に含めて使う。
 */
export function bumpContentVersionStatement(db: D1Database): D1PreparedStatement {
  return db.prepare("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'content_version'");
}
