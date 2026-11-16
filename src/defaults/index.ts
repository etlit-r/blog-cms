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

export const DEFAULT_TEMPLATES: Record<string, { kind: TemplateKind; content: string }> = {
  layout: { kind: 'page', content: layout },
  home: { kind: 'page', content: home },
  post: { kind: 'page', content: post },
  tag: { kind: 'page', content: tag },
  tags: { kind: 'page', content: tags },
  '404': { kind: 'page', content: notFound },
  'partial:header': { kind: 'partial', content: header },
  'partial:footer': { kind: 'partial', content: footer },
  'partial:post-card': { kind: 'partial', content: postCard },
  'partial:pager': { kind: 'partial', content: pager },
  'css:site': { kind: 'css', content: siteCss },
};
