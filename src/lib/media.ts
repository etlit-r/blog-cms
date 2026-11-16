import { randomBytes } from './crypto';
import { guardSql, postIdSql, type PostRef } from './postref';

/** アップロードできる 1 ファイルの上限（ブラウザで縮小済みなので、普通は数百 KB） */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** 長辺の上限（ブラウザで縮小するサイズと同じ） */
export const MEDIA_MAX_EDGE = 1600;
/** サムネイルの長辺 */
export const THUMB_EDGE = 800;
export const ALT_MAX = 300;

export type MediaRow = {
  id: number;
  r2_key: string;
  thumb_key: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  alt: string | null;
  created_at: number;
};

const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type MediaMime = keyof typeof EXTENSIONS;

/** 保存先のキー（例: img/2026/11/01JCXXXXXXXXXXXXXXXXXXXXXX.webp、サムネイルは -w800 付き） */
export const MEDIA_KEY_PATTERN = /^img\/\d{4}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}(?:-w800)?\.(?:webp|jpg|png)$/;

export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** サムネイルの大きさ（ブラウザ側の縮小と同じ計算） */
export function thumbSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, THUMB_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function toApiMedia(row: MediaRow & { usage_count?: number }) {
  const thumb = thumbSize(row.width, row.height);
  return {
    id: row.id,
    url: mediaUrl(row.r2_key),
    thumbUrl: mediaUrl(row.thumb_key),
    mime: row.mime,
    width: row.width,
    height: row.height,
    thumbWidth: thumb.width,
    thumbHeight: thumb.height,
    bytes: row.bytes,
    alt: row.alt ?? '',
    createdAt: row.created_at,
    ...(row.usage_count !== undefined ? { usageCount: row.usage_count } : {}),
  };
}

// ---------- キーの生成 ----------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID（時刻順に並ぶ 26 文字の ID） */
export function ulid(time = Date.now()): string {
  let t = time;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(16);
  let randPart = '';
  for (let i = 0; i < 16; i++) randPart += CROCKFORD[rand[i]! % 32];
  return timePart + randPart;
}

export function newMediaKeys(mime: MediaMime, time = Date.now()): { key: string; thumbKey: string } {
  const d = new Date(time);
  const base = `img/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${ulid(time)}`;
  const ext = EXTENSIONS[mime];
  return { key: `${base}.${ext}`, thumbKey: `${base}-w800.${ext}` };
}

// ---------- ファイルの検証 ----------

/** ファイルの先頭のバイト列から画像の種類を判定する（送られてきた Content-Type は信用しない） */
export function sniffImageType(bytes: Uint8Array): MediaMime | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp'; // "RIFF....WEBP"
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  return null;
}

// ---------- 本文中の画像 ----------

/**
 * img の src からメディアのキーを取り出す。
 * 「/media/...」と、公開サイトの絶対 URL「https://etlits.dev/media/...」の両方を受け付ける。
 */
export function mediaKeyFromSrc(src: string, publicHost: string): string | null {
  let path = src.trim();
  const absolute = path.match(/^https?:\/\/([^/]+)(\/.*)$/i);
  if (absolute) {
    if (absolute[1]!.toLowerCase() !== publicHost.toLowerCase()) return null;
    path = absolute[2]!;
  }
  if (!path.startsWith('/media/')) return null;
  const key = decodeURIComponent(path.slice('/media/'.length).split(/[?#]/)[0]!);
  return MEDIA_KEY_PATTERN.test(key) ? key : null;
}

/** 本文に出てくるメディアのキー（出現順・重複なし）。サムネイルのキーは元画像のキーにそろえる */
export async function extractMediaKeys(html: string, publicHost: string): Promise<string[]> {
  const keys: string[] = [];
  await new HTMLRewriter()
    .on('img[src]', {
      element(el) {
        const key = mediaKeyFromSrc(el.getAttribute('src') ?? '', publicHost);
        if (key) keys.push(key.replace(/-w800(\.\w+)$/, '$1'));
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  return [...new Set(keys)];
}

/**
 * 記事と画像の参照関係（post_media）を keys に置き換え、カバーが自動なら先頭の画像をカバーにする。
 * 記事の UPDATE より「前」に batch に入れる（カバーの更新だけは coverAutoStatement で UPDATE の「後」に入れる）。
 */
export function setPostMediaStatements(db: D1Database, post: PostRef, keys: string[]): D1PreparedStatement[] {
  const [idSql, idArgs] = postIdSql(post);
  const [guard, guardArgs] = guardSql(post);
  return [
    db.prepare(`DELETE FROM post_media WHERE post_id = ${idSql} AND ${guard}`).bind(...idArgs, ...guardArgs),
    ...keys.map((key, position) =>
      db
        .prepare(`INSERT OR IGNORE INTO post_media (post_id, media_id, position) SELECT ${idSql}, id, ? FROM media WHERE r2_key = ? AND ${guard}`)
        .bind(...idArgs, position, key, ...guardArgs),
    ),
  ];
}

/** カバーが「自動」の記事なら、本文の先頭の画像をカバーにする */
export function coverAutoStatement(db: D1Database, post: PostRef): D1PreparedStatement {
  const [idSql, idArgs] = postIdSql(post);
  return db
    .prepare(
      `UPDATE posts SET cover_media_id = (SELECT media_id FROM post_media WHERE post_id = ${idSql} ORDER BY position LIMIT 1)
       WHERE id = ${idSql} AND cover_auto = 1`,
    )
    .bind(...idArgs, ...idArgs);
}

/** 本文の img に、読み込みを速くする属性（遅延読み込み・大きさ・srcset）を足す。すでにある属性は変えない */
export async function enhanceBodyImages(html: string, media: Map<string, MediaRow>, publicHost: string): Promise<string> {
  return new HTMLRewriter()
    .on('img', {
      element(el) {
        if (!el.hasAttribute('loading')) el.setAttribute('loading', 'lazy');
        if (!el.hasAttribute('decoding')) el.setAttribute('decoding', 'async');
        const key = mediaKeyFromSrc(el.getAttribute('src') ?? '', publicHost);
        const row = key ? media.get(key.replace(/-w800(\.\w+)$/, '$1')) : undefined;
        if (!row) return;
        if (!el.hasAttribute('width') && !el.hasAttribute('height')) {
          el.setAttribute('width', String(row.width));
          el.setAttribute('height', String(row.height));
        }
        if (!el.hasAttribute('srcset')) {
          el.setAttribute('srcset', srcset(row));
          if (!el.hasAttribute('sizes')) el.setAttribute('sizes', '(min-width: 720px) 680px, 100vw');
        }
      },
    })
    .transform(new Response(html))
    .text();
}

export function srcset(row: Pick<MediaRow, 'r2_key' | 'thumb_key' | 'width' | 'height'>): string {
  const thumb = thumbSize(row.width, row.height);
  // 元画像が小さくサムネイルと同じ大きさなら、候補は 1 つで足りる
  return thumb.width === row.width ? `${mediaUrl(row.r2_key)} ${row.width}w` : `${mediaUrl(row.thumb_key)} ${thumb.width}w, ${mediaUrl(row.r2_key)} ${row.width}w`;
}
