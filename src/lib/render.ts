import Mustache from 'mustache';
import { DEFAULT_TEMPLATES } from '../defaults';
import type { PreviewOptions } from '../env';
import { sha256Hex } from './crypto';
import { escapeHtml } from './html';

// mustache.js の既定は / や = もエスケープし、URL が &#x2F; だらけになる。HTML として必要な 5 文字だけにする
Mustache.escape = escapeHtml;

export type TemplateSet = Record<string, string>;

/** 初期テンプレートに、DB に保存された（管理画面で編集した）テンプレートを上書きしたもの */
export async function loadTemplates(db: D1Database): Promise<TemplateSet> {
  const set = defaultTemplates();
  const { results } = await db.prepare('SELECT name, content FROM templates').all<{ name: string; content: string }>();
  for (const row of results) if (row.name in set) set[row.name] = row.content;
  return set;
}

export function defaultTemplates(): TemplateSet {
  return Object.fromEntries(Object.entries(DEFAULT_TEMPLATES).map(([name, t]) => [name, t.content]));
}

/** 'partial:header' → {{> header}} で呼べるようにする */
function partialsOf(set: TemplateSet): Record<string, string> {
  return Object.fromEntries(
    Object.entries(set)
      .filter(([name]) => name.startsWith('partial:'))
      .map(([name, content]) => [name.slice('partial:'.length), content]),
  );
}

export async function cssHash(css: string): Promise<string> {
  return (await sha256Hex(css)).slice(0, 8);
}

/** ページのテンプレートを描画し、layout で包んだ HTML を返す */
export function renderWith(set: TemplateSet, pageName: string, view: Record<string, unknown>): string {
  const partials = partialsOf(set);
  const page = set[pageName];
  const layout = set.layout;
  if (page === undefined || layout === undefined) throw new Error(`テンプレート ${pageName} がありません`);
  const content = Mustache.render(page, view, partials);
  return Mustache.render(layout, { ...view, content }, partials);
}

/**
 * 編集されたテンプレートで描画し、失敗したら初期テンプレートで描画し直す。
 * 管理画面は別のアプリなので、テンプレートが壊れても CMS 自体は操作できる。
 *
 * preview を渡したとき（管理画面のプレビュー）は、保存前のテンプレートを重ねて描画する。
 * CSS は data: URL で埋め込み、失敗しても初期テンプレートに戻さず例外を投げる（どこが悪いか見せるため）。
 */
export async function renderPage(db: D1Database, pageName: string, view: Record<string, unknown>, preview?: PreviewOptions): Promise<string> {
  const set = { ...(await loadTemplates(db)), ...(preview ? pickKnown(preview.templates) : {}) };
  if (preview) {
    const css = set['css:site'] ?? '';
    return renderWith(set, pageName, { ...view, cssUrl: `data:text/css;charset=utf-8,${encodeURIComponent(css)}` });
  }
  const withCss = { ...view, cssUrl: `/assets/site.css?v=${await cssHash(set['css:site'] ?? '')}` };
  try {
    return renderWith(set, pageName, withCss);
  } catch (e) {
    const defaults = defaultTemplates();
    const fallbackView = { ...view, cssUrl: `/assets/site.css?v=${await cssHash(defaults['css:site']!)}&fallback=1` };
    const message = String(e instanceof Error ? e.message : e).replace(/-/g, '- ').replace(/>/g, '&gt;');
    return `<!-- テンプレートの描画に失敗したため、初期テンプレートで表示しています: ${message} -->\n` + renderWith(defaults, pageName, fallbackView);
  }
}

/** 決まった名前のテンプレートだけを受け付ける */
function pickKnown(templates: Record<string, string>): TemplateSet {
  return Object.fromEntries(Object.entries(templates).filter(([name]) => name in DEFAULT_TEMPLATES));
}

/** 公開中の CSS（編集されていれば DB のもの） */
export async function siteCss(db: D1Database, fallback: boolean): Promise<string> {
  if (fallback) return DEFAULT_TEMPLATES['css:site']!.content;
  const row = await db.prepare("SELECT content FROM templates WHERE name = 'css:site'").first<{ content: string }>();
  return row?.content ?? DEFAULT_TEMPLATES['css:site']!.content;
}
