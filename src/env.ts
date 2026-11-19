export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** 公開サイトのホスト名（例: etlits.dev、ローカルは localhost:8787） */
  PUBLIC_HOST: string;
  /** 管理画面のホスト名（例: admin.etlits.dev、ローカルは admin.localhost:8787） */
  ADMIN_HOST: string;
  /** 初回アカウント作成に必要なトークン（`wrangler secret put SETUP_TOKEN`） */
  SETUP_TOKEN?: string;
  /**
   * 管理画面のプレビューのときだけ、Worker の中で設定する（外からのリクエストでは決して設定されない）。
   * 保存前のテンプレートや記事で公開ページを描画するために使う。
   */
  PREVIEW?: PreviewOptions;
}

export type PreviewOptions = {
  /** 保存前のテンプレート（名前 → 内容） */
  templates: Record<string, string>;
  /** 保存前の記事（/posts/__preview で表示する） */
  post?: PreviewPost;
};

export type PreviewPost = {
  title: string;
  bodyHtml: string;
  tags: string[];
  publishedAt: number | null;
  /** 手動で選んだカバー（/media/...）。null なら本文の先頭の画像 */
  coverImage: string | null;
};

export type AppEnv = { Bindings: Env };
