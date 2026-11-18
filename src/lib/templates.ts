import Mustache from 'mustache';
import { DEFAULT_TEMPLATES } from '../defaults';
import { now } from './http';
import { bumpContentVersionStatement } from './settings';

export const TEMPLATE_MAX = 200_000;
/** テンプレートごとに残す履歴の数 */
export const REVISIONS_KEPT = 30;

type Token = [string, string, number, number, Token[]?, ...unknown[]];

/** トークンの中に、{{{name}}} / {{&name}} があるか（入れ子のセクションの中も探す） */
function hasRawTag(tokens: Token[], name: string): boolean {
  return tokens.some((t) => ((t[0] === '&' || t[0] === '{') && t[1] === name) || (Array.isArray(t[4]) && hasRawTag(t[4], name)));
}

/**
 * 保存してよいテンプレートか確かめる。問題があればエラーメッセージを返す。
 * - Mustache として読めること（{{#posts}} の閉じ忘れなど）
 * - 共通レイアウトには、各ページの中身を入れる {{{content}}} があること
 */
export function validateTemplate(name: string, content: string): string | null {
  const info = DEFAULT_TEMPLATES[name];
  if (!info) return 'テンプレートが見つかりません';
  if (content.length > TEMPLATE_MAX) return 'テンプレートが大きすぎます';
  if (info.kind === 'css') return null;

  let tokens: Token[];
  try {
    tokens = Mustache.parse(content) as Token[];
  } catch (e) {
    return `テンプレートの書き方に誤りがあります: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (name === 'layout' && !hasRawTag(tokens, 'content')) {
    return '共通レイアウトには、各ページの中身を入れる {{{content}}} が必要です';
  }
  return null;
}

export type TemplateRow = { name: string; content: string; updated_at: number };

/**
 * テンプレートを保存し、履歴に残す（古い履歴は REVISIONS_KEPT 件を超えた分を消す）。
 * expectedUpdatedAt が DB の値と違えば（ほかの画面で先に保存されていれば）false を返し、何も変更しない。
 * まだ編集されていない（初期のまま）テンプレートの expectedUpdatedAt は null。
 */
export async function saveTemplate(db: D1Database, name: string, content: string, expectedUpdatedAt: number | null): Promise<boolean> {
  const info = DEFAULT_TEMPLATES[name]!;
  const t = now();
  const write =
    expectedUpdatedAt === null
      ? db.prepare('INSERT INTO templates (name, kind, content, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING').bind(name, info.kind, content, t)
      : db
          .prepare('UPDATE templates SET content = ?, updated_at = MAX(?, updated_at + 1) WHERE name = ? AND updated_at = ?')
          .bind(content, t, name, expectedUpdatedAt);
  // 1 回の batch（トランザクション）で行う。履歴は、直前の書き込みが成功したとき（changes() = 1）だけ残す
  const [result] = await db.batch([
    write,
    db.prepare('INSERT INTO template_revisions (name, content, created_at) SELECT ?, ?, ? WHERE changes() = 1').bind(name, content, t),
    pruneRevisionsStatement(db, name),
    bumpContentVersionStatement(db),
  ]);
  return result!.meta.changes === 1;
}

/** 初期のテンプレートに戻す（DB の行を消す）。履歴には初期の内容を残す */
export async function resetTemplate(db: D1Database, name: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM templates WHERE name = ?').bind(name),
    ...revisionStatements(db, name, DEFAULT_TEMPLATES[name]!.content, now()),
    bumpContentVersionStatement(db),
  ]);
}

function revisionStatements(db: D1Database, name: string, content: string, t: number): D1PreparedStatement[] {
  return [db.prepare('INSERT INTO template_revisions (name, content, created_at) VALUES (?, ?, ?)').bind(name, content, t), pruneRevisionsStatement(db, name)];
}

function pruneRevisionsStatement(db: D1Database, name: string): D1PreparedStatement {
  return db
    .prepare('DELETE FROM template_revisions WHERE name = ? AND id NOT IN (SELECT id FROM template_revisions WHERE name = ? ORDER BY id DESC LIMIT ?)')
    .bind(name, name, REVISIONS_KEPT);
}
