/** 段落の区切りとして扱う要素（前後に空白を入れて、単語がくっつかないようにする） */
const BLOCK_ELEMENTS = 'p, br, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, td, th, figcaption, hr';
const VOID_ELEMENTS = new Set(['br', 'hr']);
/** 中身を本文テキストとして扱わない要素 */
const SKIP_ELEMENTS = 'script, style, template, noscript, iframe, svg';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', deg: '°', yen: '¥', euro: '€', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** HTML から本文のテキストだけを取り出す（HTMLRewriter でストリーミング処理） */
export async function extractText(html: string): Promise<string> {
  // 1 回目: script や style などを中身ごと取り除く
  const stripped = await new HTMLRewriter()
    .on(SKIP_ELEMENTS, { element: (el) => void el.remove() })
    .transform(new Response(html))
    .text();

  // 2 回目: 残ったテキストを集める
  const parts: string[] = [];
  await new HTMLRewriter()
    .on(BLOCK_ELEMENTS, {
      element(el) {
        parts.push(' ');
        if (VOID_ELEMENTS.has(el.tagName)) return; // <br> や <hr> には終了タグがない
        try {
          el.onEndTag(() => void parts.push(' '));
        } catch {
          // 終了タグが省略されている要素（<p>a<p>b など）では登録できないので無視する
        }
      },
    })
    .onDocument({ text: (t) => void parts.push(t.text) })
    .transform(new Response(stripped))
    .arrayBuffer();

  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}

export const EXCERPT_LENGTH = 120;

/** 本文から抜粋を作る（EXCERPT_LENGTH 文字を超えたら末尾を「…」にする） */
export async function makeExcerpt(html: string): Promise<string> {
  const text = await extractText(html);
  const chars = [...text]; // サロゲートペア（絵文字など）を途中で切らない
  return chars.length > EXCERPT_LENGTH ? chars.slice(0, EXCERPT_LENGTH).join('') + '…' : text;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * 本文の中の「/」で始まるリンク・画像の URL を、origin（例: https://etlits.dev）付きの絶対 URL にする。
 * RSS リーダーなど、サイトの外で本文を表示するときに使う。
 */
export async function absolutizeUrls(html: string, origin: string): Promise<string> {
  const fix = (attr: string) => ({
    element(el: Element) {
      const value = el.getAttribute(attr);
      if (value && value.startsWith('/') && !value.startsWith('//')) el.setAttribute(attr, origin + value);
    },
  });
  return new HTMLRewriter().on('a[href]', fix('href')).on('img[src]', fix('src')).on('img[srcset]', {
    element(el) {
      const value = el.getAttribute('srcset');
      if (value) el.setAttribute('srcset', value.replace(/(^|,\s*)(\/(?!\/))/g, `$1${origin}/`));
    },
  }).transform(new Response(html)).text();
}

/** XML の特殊文字をエスケープする */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

/** CDATA の中に入れる文字列（"]]>" で CDATA が終わらないように分割する） */
export function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}
