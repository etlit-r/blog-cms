import { generateHTML, generateJSON } from '@tiptap/core';
import { editorExtensions } from './extensions';

/** 比較用に、タグの間の空白や属性の順番の違いをならした HTML */
function normalize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const attrs = Array.from(el.attributes)
      .filter((a) => !(a.name === 'rel' || a.name === 'target')) // リンクに自動で付く属性は差分にしない
      .map((a) => `${a.name}="${a.value}"`)
      .sort()
      .join(' ');
    const children = Array.from(el.childNodes).map(walk).join('');
    return `<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>${children}</${el.tagName.toLowerCase()}>`;
  };
  return Array.from(doc.body.childNodes)
    .map(walk)
    .join('')
    .replace(/>\s+</g, '><')
    .replace(/<p><\/p>/g, '')
    .trim();
}

/**
 * HTML をリッチテキストに読み込んだときに、消えたり変わったりする部分があるか。
 * script・独自の class・iframe など、リッチテキストで扱えないものがあると true。
 */
export function wouldLoseHtml(html: string): boolean {
  if (!html.trim()) return false;
  const extensions = editorExtensions();
  const roundTripped = generateHTML(generateJSON(html, extensions), extensions);
  return normalize(html) !== normalize(roundTripped);
}
