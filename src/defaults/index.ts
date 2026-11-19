// 初期テンプレート。管理画面で編集されていないものは、これを使って表示する。
// .html / .css はビルド時に文字列として読み込まれる（wrangler.jsonc の rules を参照）
import notFound from './404.html';
import footer from './footer.html';
import header from './header.html';
import home from './home.html';
import layout from './layout.html';
import pager from './pager.html';
import post from './post.html';
import postCard from './post-card.html';
import siteCss from './site.css';
import tag from './tag.html';
import tags from './tags.html';

export type TemplateKind = 'page' | 'partial' | 'css';

export type TemplateInfo = {
  kind: TemplateKind;
  /** 管理画面に表示する名前 */
  label: string;
  /** 何に使うテンプレートか */
  description: string;
  content: string;
};

export const DEFAULT_TEMPLATES: Record<string, TemplateInfo> = {
  layout: { kind: 'page', label: '共通レイアウト', description: '全ページの外枠（<html> から </html> まで）。{{{content}}} の位置に各ページの中身が入ります', content: layout },
  home: { kind: 'page', label: 'トップページ', description: '新着記事の一覧（2 ページ目以降も同じ）', content: home },
  post: { kind: 'page', label: '記事ページ', description: '記事 1 件の表示', content: post },
  tag: { kind: 'page', label: 'タグ別の一覧', description: 'あるタグの付いた記事の一覧', content: tag },
  tags: { kind: 'page', label: 'タグ一覧', description: 'すべてのタグの一覧', content: tags },
  '404': { kind: 'page', label: '404 ページ', description: 'ページが見つからないときの表示', content: notFound },
  'partial:header': { kind: 'partial', label: 'ヘッダー', description: '{{> header}} で読み込む部品', content: header },
  'partial:footer': { kind: 'partial', label: 'フッター', description: '{{> footer}} で読み込む部品', content: footer },
  'partial:post-card': { kind: 'partial', label: '記事カード', description: '一覧の記事 1 件分。{{> post-card}} で読み込む部品', content: postCard },
  'partial:pager': { kind: 'partial', label: 'ページ送り', description: '一覧の「新しい記事 / 古い記事」。{{> pager}} で読み込む部品', content: pager },
  'css:site': { kind: 'css', label: 'サイトの CSS', description: '全ページで読み込むスタイルシート', content: siteCss },
};

/**
 * 管理画面での並び順（オブジェクトのキーの順番は '404' が先頭になってしまうため、別に持つ）。
 * DEFAULT_TEMPLATES にテンプレートを足したら、ここにも足すこと（test/templates.test.ts で一致を確かめている）。
 */
export const TEMPLATE_ORDER = [
  'layout',
  'home',
  'post',
  'tag',
  'tags',
  '404',
  'partial:header',
  'partial:footer',
  'partial:post-card',
  'partial:pager',
  'css:site',
] as const;
