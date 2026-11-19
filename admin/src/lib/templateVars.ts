/** テンプレートで使える変数の説明（管理画面の「変数一覧」に表示する） */
export type VarDoc = { name: string; description: string };
export type VarGroup = { title: string; vars: VarDoc[] };

const COMMON: VarGroup = {
  title: 'どのページでも使える',
  vars: [
    { name: '{{site.title}}', description: 'サイト名' },
    { name: '{{site.description}}', description: 'サイトの説明' },
    { name: '{{site.url}}', description: 'サイトの URL' },
    { name: '{{page.title}}', description: 'ページのタイトル（<title> 用。「記事名 | サイト名」）' },
    { name: '{{page.description}}', description: 'ページの説明（記事なら抜粋）' },
    { name: '{{page.url}}', description: 'ページの URL' },
    { name: '{{page.ogImage}}', description: 'SNS 用の画像の URL（ないときは空）' },
    { name: '{{cssUrl}}', description: 'サイトの CSS の URL' },
    { name: '{{year}}', description: '今年（例: 2026）' },
    { name: '{{#nav.pages}} 〜 {{/nav.pages}}', description: '公開中の固定ページごとに繰り返す。中では {{title}} {{url}}' },
  ],
};

const POST_CARD: VarGroup = {
  title: '{{#posts}} 〜 {{/posts}} の中（記事 1 件分）',
  vars: [
    { name: '{{title}}', description: 'タイトル' },
    { name: '{{url}}', description: '記事の URL' },
    { name: '{{excerpt}}', description: '抜粋' },
    { name: '{{dateLabel}}', description: '公開日（例: 2026.11.18）' },
    { name: '{{dateIso}}', description: '公開日時（<time datetime> 用）' },
    { name: '{{#featured}}', description: 'トップの先頭の記事なら中身を表示' },
    { name: '{{#cover}} 〜 {{/cover}}', description: 'カバー画像があれば中身を表示。中では {{src}} {{srcset}} {{sizes}} {{width}} {{height}} {{alt}} が使える' },
    { name: '{{#hasTags}}', description: 'タグがあれば中身を表示' },
    { name: '{{#tags}} 〜 {{/tags}}', description: 'タグごとに繰り返す。中では {{name}} {{url}}' },
  ],
};

const PAGER: VarGroup = {
  title: 'ページ送り',
  vars: [
    { name: '{{#pager}} 〜 {{/pager}}', description: '2 ページ以上あるときだけ中身を表示' },
    { name: '{{current}} / {{total}}', description: '今のページ番号 / 全ページ数' },
    { name: '{{prevUrl}} / {{nextUrl}}', description: '新しい記事 / 古い記事のページの URL（ないときは空）' },
  ],
};

const LIST: VarGroup[] = [
  { title: '一覧', vars: [{ name: '{{#posts}} 〜 {{/posts}}', description: '記事ごとに繰り返す（{{> post-card}} で記事カードを読み込める）' }, { name: '{{^posts}} 〜 {{/posts}}', description: '記事が 1 件もないときだけ中身を表示' }] },
  POST_CARD,
  PAGER,
];

const SYNTAX: VarGroup = {
  title: '書き方',
  vars: [
    { name: '{{name}}', description: '値を表示（< や & は自動でエスケープ）' },
    { name: '{{{name}}}', description: '値を HTML のまま表示' },
    { name: '{{#name}} 〜 {{/name}}', description: '値があれば中身を表示。配列なら要素ごとに繰り返す' },
    { name: '{{^name}} 〜 {{/name}}', description: '値がない（空・false・空の配列）ときだけ中身を表示' },
    { name: '{{> header}}', description: '部品を読み込む（header / footer / post-card / pager）' },
    { name: '{{! メモ }}', description: 'コメント（表示されない）' },
  ],
};

export const TEMPLATE_VARS: Record<string, VarGroup[]> = {
  layout: [{ title: '共通レイアウト', vars: [{ name: '{{{content}}}', description: '各ページの中身（必ず 1 か所に入れる）' }] }, COMMON, SYNTAX],
  home: [...LIST, COMMON, SYNTAX],
  tag: [{ title: 'タグ', vars: [{ name: '{{tag.name}}', description: 'タグ名' }, { name: '{{tag.count}}', description: 'このタグの記事数' }] }, ...LIST, COMMON, SYNTAX],
  tags: [
    {
      title: 'タグ一覧',
      vars: [
        { name: '{{#hasTags}}', description: 'タグが 1 つ以上あれば中身を表示' },
        { name: '{{#tags}} 〜 {{/tags}}', description: 'タグごとに繰り返す。中では {{name}} {{url}} {{count}}' },
      ],
    },
    COMMON,
    SYNTAX,
  ],
  post: [
    {
      title: '記事（{{#post}} 〜 {{/post}} の中）',
      vars: [
        { name: '{{title}}', description: 'タイトル' },
        { name: '{{{bodyHtml}}}', description: '本文（HTML のまま表示する）' },
        { name: '{{dateLabel}} / {{dateIso}}', description: '公開日' },
        { name: '{{#cover}} 〜 {{/cover}}', description: 'カバー画像（中では {{src}} {{srcset}} {{width}} {{height}} {{alt}}）' },
        { name: '{{#tags}} 〜 {{/tags}}', description: 'タグごとに繰り返す。中では {{name}} {{url}}' },
      ],
    },
    {
      title: '前後の記事',
      vars: [
        { name: '{{#newer}} 〜 {{/newer}}', description: '新しい記事があれば中身を表示。中では {{url}} {{title}}' },
        { name: '{{#older}} 〜 {{/older}}', description: '古い記事があれば中身を表示。中では {{url}} {{title}}' },
      ],
    },
    COMMON,
    SYNTAX,
  ],
  page: [
    {
      title: '固定ページ（{{#fixedPage}} 〜 {{/fixedPage}} の中）',
      vars: [
        { name: '{{title}}', description: 'タイトル' },
        { name: '{{{bodyHtml}}}', description: '本文（HTML のまま表示する）' },
      ],
    },
    COMMON,
    SYNTAX,
  ],
  '404': [COMMON, SYNTAX],
  'partial:header': [COMMON, SYNTAX],
  'partial:footer': [COMMON, SYNTAX],
  'partial:post-card': [POST_CARD, COMMON, SYNTAX],
  'partial:pager': [PAGER, COMMON, SYNTAX],
  'css:site': [],
};

/** 入力補助のボタン（スマホのキーボードで打ちにくい記号）。text を入れ、cursorBack 文字だけカーソルを戻す */
export const HELPER_KEYS: Record<'html' | 'css', { label: string; text: string; cursorBack?: number }[]> = {
  html: [
    { label: '{{ }}', text: '{{}}', cursorBack: 2 },
    { label: '{{{ }}}', text: '{{{}}}', cursorBack: 3 },
    { label: '{{#', text: '{{#}}', cursorBack: 2 },
    { label: '{{/', text: '{{/}}', cursorBack: 2 },
    { label: '{{^', text: '{{^}}', cursorBack: 2 },
    { label: '{{>', text: '{{> }}', cursorBack: 2 },
    { label: '<', text: '<' },
    { label: '>', text: '>' },
    { label: '/', text: '/' },
    { label: '"', text: '""', cursorBack: 1 },
    { label: '=', text: '=' },
  ],
  css: [
    { label: '{ }', text: '{\n  \n}', cursorBack: 2 },
    { label: ':', text: ': ' },
    { label: ';', text: ';' },
    { label: '.', text: '.' },
    { label: '#', text: '#' },
    { label: '( )', text: '()', cursorBack: 1 },
    { label: 'var(--', text: 'var(--)', cursorBack: 1 },
    { label: 'px', text: 'px' },
    { label: '@media', text: '@media (min-width: px) {\n  \n}', cursorBack: 10 },
  ],
};
