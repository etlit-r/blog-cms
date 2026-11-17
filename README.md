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

## GitHub Actions でのデプロイ

`.github/workflows/ci.yml` が次のように動きます。

- **プルリクエスト**: 型チェック・テスト・ビルドを実行する（デプロイはしない）
- **`main` への push（プルリクエストのマージを含む）**: 上記がすべて通ったら、本番 D1 へのマイグレーションと Worker のデプロイを行う
- **手動実行**: GitHub の Actions タブ → 「CI / Deploy」→「Run workflow」で `main` を選ぶと、デプロイまで行う

以下の初回準備は、すべて Cloudflare と GitHub の画面だけでできます（PC で `wrangler` を使う必要はありません）。

### 1. Cloudflare 側の準備

1. **D1 データベースを作る**: ダッシュボードの「Storage & Databases」→「D1 SQL Database」→「Create」で、名前を `blog-cms` にして作成します。
   作成後に表示される **Database ID** を、`wrangler.jsonc` の `database_id`（初期値 `00000000-0000-0000-0000-000000000000`）と置き換えてコミットします。
   この ID は秘密情報ではないので、リポジトリに含めて構いません。初期値のままだとデプロイは失敗するようにしてあります。
2. **R2 バケットを作る**: 「R2 Object Storage」→「Create bucket」で、名前を `blog-cms-media` にして作成します。
3. **API トークンを作る**: 右上のアイコン →「Profile」→「API Tokens」→「Create Token」で、テンプレート「**Edit Cloudflare Workers**」を選びます。
   - 「Permissions」に **Account / D1 / Edit** を追加します（マイグレーションに必要）。
   - 「Account Resources」は自分のアカウント、「Zone Resources」は `etlits.dev` を選びます。
   - 作成後に表示されるトークンは一度しか表示されないので控えておきます。
4. **アカウント ID を確認する**: 「Workers & Pages」の画面右側などに表示される **Account ID** を控えます。

### 2. GitHub 側の準備

リポジトリの「Settings」→「Secrets and variables」→「Actions」→「New repository secret」で、次の 2 つを登録します。

| 名前 | 値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 手順 1-3 で作った API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | 手順 1-4 で控えた Account ID |

### 3. 初回デプロイとセットアップトークン

1. `database_id` を書き換えた変更を `main` に入れると、デプロイが始まります（Actions タブで進み具合を確認できます）。
2. デプロイが成功したら、Cloudflare のダッシュボードで「Workers & Pages」→「blog-cms」→「Settings」→「Variables and Secrets」→「Add」を開き、
   種類を **Secret**、名前を `SETUP_TOKEN`、値を推測されにくい長い文字列にして保存します。
   一度設定すれば、以降のデプロイでも消えません。
   設定するまでの間は、管理画面のセットアップは受け付けられない（エラーになる）ので、第三者に先にアカウントを作られることはありません。
3. `https://admin.etlits.dev` を開き、設定したトークンを入力してアカウントを作成します。

以降は `main` にマージするたびに自動でデプロイされます。

## パスワードを忘れたとき

アカウントを削除してから、もう一度セットアップします（記事などのデータは消えません）。

アカウントを削除すると、セットアップトークンを知っている人なら誰でもアカウントを作れる状態になります。
**先にトークンを新しい値に変えてから**、アカウントを削除してください。

```sh
npx wrangler secret put SETUP_TOKEN
npx wrangler d1 execute blog-cms --remote --command "DELETE FROM sessions; DELETE FROM users;"
```

その後 `https://admin.etlits.dev` を開くとセットアップ画面が表示されます。
