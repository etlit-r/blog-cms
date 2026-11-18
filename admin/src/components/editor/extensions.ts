import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';

/**
 * リッチテキストで扱える要素。HTML モードからの切り替え時に「失われる HTML がないか」の判定にも使う。
 * 見出しは h2・h3 だけ（h1 は記事タイトルに使うため）。
 */
export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: null } },
    }),
    Image.configure({ inline: false, allowBase64: false }),
  ];
}
