import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, readJson } from '../../lib/http';
import { POSTS_PER_PAGE_MAX, bumpContentVersionStatement, getSettings, setSettingStatement } from '../../lib/settings';

export const settings = new Hono<AppEnv>();

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 300;

/** 公開サイトの URL（ローカル開発では http） */
function publicUrl(requestUrl: string, publicHost: string): string {
  return `${new URL(requestUrl).protocol}//${publicHost}`;
}

settings.get('/', async (c) => {
  return c.json({ ...(await getSettings(c.env.DB)), publicUrl: publicUrl(c.req.url, c.env.PUBLIC_HOST) });
});

settings.put('/', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  if (!body) return apiError(c, 400, 'invalid_body', 'リクエストの形式が正しくありません');
  const { siteTitle, siteDescription, postsPerPage } = body;

  if (typeof siteTitle !== 'string' || !siteTitle.trim()) return apiError(c, 400, 'invalid_input', 'サイト名を入力してください');
  if ([...siteTitle.trim()].length > TITLE_MAX) return apiError(c, 400, 'invalid_input', `サイト名は${TITLE_MAX}文字以内にしてください`);
  if (typeof siteDescription !== 'string') return apiError(c, 400, 'invalid_input', '説明の形式が正しくありません');
  if ([...siteDescription.trim()].length > DESCRIPTION_MAX) {
    return apiError(c, 400, 'invalid_input', `説明は${DESCRIPTION_MAX}文字以内にしてください`);
  }
  if (typeof postsPerPage !== 'number' || !Number.isInteger(postsPerPage) || postsPerPage < 1 || postsPerPage > POSTS_PER_PAGE_MAX) {
    return apiError(c, 400, 'invalid_input', `1ページの表示件数は1〜${POSTS_PER_PAGE_MAX}にしてください`);
  }

  await db.batch([
    setSettingStatement(db, 'site_title', siteTitle.trim()),
    setSettingStatement(db, 'site_description', siteDescription.trim()),
    setSettingStatement(db, 'posts_per_page', String(postsPerPage)),
    bumpContentVersionStatement(db),
  ]);
  return c.json({ ...(await getSettings(db)), publicUrl: publicUrl(c.req.url, c.env.PUBLIC_HOST) });
});
