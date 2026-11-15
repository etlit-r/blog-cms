# blog-cms

Cloudflare Workers の無料枠で動く、一人用のブログ CMS です。設計は [docs/DESIGN.md](docs/DESIGN.md) を参照してください。

- 公開サイト: `https://etlits.dev`
- 管理画面: `https://admin.etlits.dev`

## 必要なもの

- Node.js 22 以上
- Cloudflare アカウント（R2 を使うため支払い方法の登録が必要。無料枠内なら請求は発生しません）
- `etlits.dev` が Cloudflare で管理されていること（ネームサーバーを Cloudflare に向ける）

> **npm のバージョンについて**: npm 10 では依存関係の解決中にエラーになることがあります。
> そのときは `npx npm@11 install` を使ってください。

## ローカルで動かす

```sh
npm install
cp .dev.vars.example .dev.vars   # ローカル用のホスト名とセットアップトークン
npm run db:migrate:local         # ローカルの D1 にテーブルを作成
npm run dev                      # 管理画面をビルドして Worker を起動
```

- 公開サイト: http://localhost:8787
- 管理画面: http://admin.localhost:8787 （セットアップトークンは `.dev.vars` の `SETUP_TOKEN`）

管理画面の画面を変えながら確認したいときは、`npm run dev:worker` と `npm run dev:admin` を別々のターミナルで起動し、http://localhost:5173 を開きます（保存すると即座に反映されます）。

## テスト

```sh
npm test          # Worker の API テスト（Vitest + Workers ランタイム）
npm run typecheck # 型チェック（Worker と管理画面）
```

## 本番へのデプロイ（初回）

```sh
npx wrangler login

# 1. D1 データベースを作成し、表示された database_id を wrangler.jsonc に書き込む
npx wrangler d1 create blog-cms

# 2. R2 バケットを作成
npx wrangler r2 bucket create blog-cms-media

# 3. 初回アカウント作成用のトークンを設定（推測されにくい長い文字列にする）
npx wrangler secret put SETUP_TOKEN

# 4. ビルド・マイグレーション・デプロイ
npm run deploy
```

デプロイ後、`https://admin.etlits.dev` を開き、手順 3 で設定したトークンを入力してアカウントを作成します。
アカウントは 1 つしか作れません。作成後はセットアップ画面は表示されなくなります。

2 回目以降は `npm run deploy` だけで更新できます。

## パスワードを忘れたとき

アカウントを削除してから、もう一度セットアップします（記事などのデータは消えません）。

```sh
npx wrangler d1 execute blog-cms --remote --command "DELETE FROM sessions; DELETE FROM users;"
```

その後 `https://admin.etlits.dev` を開くとセットアップ画面が表示されます。
