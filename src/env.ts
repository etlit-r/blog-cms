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
}

export type AppEnv = { Bindings: Env };
