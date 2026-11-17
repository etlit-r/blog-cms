/**
 * 本文の img の src から「/media/...」のパスを取り出す（サムネイルは元画像のパスにそろえる）。
 * 絶対 URL（https://etlits.dev/media/...）も受け付ける。メディアの画像でなければ null。
 */
export function mediaPathFromSrc(src: string): string | null {
  const m = src.trim().match(/^(?:https?:\/\/[^/]+)?(\/media\/img\/\d{4}\/\d{2}\/[0-9A-Z]{26})(?:-w800)?(\.(?:webp|jpg|png))(?:[?#].*)?$/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** 元画像のパス → サムネイルのパス */
export function thumbPath(path: string): string {
  return path.replace(/(\.\w+)$/, '-w800$1');
}

/** 本文の HTML に出てくるメディア画像（出現順・重複なし） */
export function mediaPathsInHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paths = Array.from(doc.querySelectorAll('img[src]'))
    .map((img) => mediaPathFromSrc(img.getAttribute('src') ?? ''))
    .filter((p): p is string => p !== null);
  return [...new Set(paths)];
}

const ATTR_ESCAPES: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };

/** 本文に挿入する img タグ */
export function imageHtml(media: { url: string; alt: string }): string {
  const alt = media.alt.replace(/[&"<>]/g, (ch) => ATTR_ESCAPES[ch]!);
  return `<p><img src="${media.url}" alt="${alt}"></p>`;
}
