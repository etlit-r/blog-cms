# ブログCMS 設計書

Cloudflare Workers の無料枠で動く、スマホ中心で運用する一人用ブログ CMS の設計。

---

## 1. 要件まとめ

| # | 要件 | 設計上の対応 |
|---|------|-------------|
| R1 | Cloudflare Workers の無料枠で構築 | Workers + D1 + R2 + Static Assets のみ使用（§3, §11） |
| R2 | CMS から記事追加・画像アップロード（動画不要） | 管理画面 SPA + R2 に画像保存。ブラウザ側で縮小・WebP 化（§7） |
| R3 | CMS で各ページの HTML と CSS を編集 | テンプレート・パーシャル・CSS を D1 に保存し、管理画面で編集。履歴と復元つき（§8） |
| R4 | 記事にタグを自由に設定 | 多対多のタグ。入力時に既存タグを補完し、未登録のタグはその場で作成（§6.3） |
| R5 | トップに新着記事、記事内の写真を大きくサムネイル表示 | 本文の最初の画像を自動でカバーに設定（手動変更も可）。トップは大きな画像のカードで表示（§9） |
| R6 | 主にスマホで扱いやすく | 公開側・管理画面ともモバイルファースト。カメラ／写真ライブラリから直接アップロード（§10） |
| R7 | 記事はリッチテキストと HTML の両方で書ける | エディタを「リッチ」「HTML」で切り替え。保存形式は両方とも HTML（§6.2） |
| R8 | 執筆アカウントは一つだけ。作成後は新規作成を禁止 | DB 制約で 1 行に固定し、初回セットアップはトークン必須（§5） |

---

## 2. 全体構成

```
                   ┌──────────────────────────── Cloudflare ─────────────────────────────┐
  閲覧者(スマホ) ──▶│  Worker (Hono)                                                      │
                   │   ├─ 公開ルート  /, /posts/:slug, /tags/:tag ... ── SSR(テンプレート) │
                   │   ├─ /media/*   ─────────────────────────────────▶  R2 (画像)       │
                   │   ├─ /api/admin/* (JSON API, 要ログイン) ─────────▶  D1 (SQLite)     │
                   │   └─ Cache API (公開ページ・画像のエッジキャッシュ)                   │
  管理者(スマホ) ──▶│  Static Assets  /admin/*  (管理画面 SPA: React + Vite でビルド)       │
                   └──────────────────────────────────────────────────────────────────────┘
```

- **Worker 1 本**で、公開サイトの描画・管理用 API・画像配信を受け持つ。
- **管理画面は静的 SPA** にして Workers Static Assets から配信する。静的アセットへのリクエストは無料かつ Worker のリクエスト数に数えられないため、無料枠を消費しない。
- 公開ページは **サーバーサイドレンダリング（SSR）** する。D1 にあるテンプレートへデータを流し込んで HTML を返す。クライアント JS がなくても表示でき、表示が速く SEO にも向く。

---

## 3. 技術スタック

| 層 | 採用 | 理由 |
|----|------|------|
| ランタイム | Cloudflare Workers | 要件 |
| ルーティング | [Hono](https://hono.dev) | 軽量で Workers 向け。バンドルが小さい |
| DB | Cloudflare D1 | 無料 5GB。記事・タグ・テンプレート・セッションを保存 |
| 画像ストレージ | Cloudflare R2 | 無料 10GB、転送量は無料 |
| テンプレートエンジン | Mustache 互換（`mustache.js`） | ロジックを持たない構文で、CMS で編集しても壊れにくい。依存が軽く、ユーザーが書いたテンプレートで任意コードが動かない |
| HTML 加工 | `HTMLRewriter`（Workers 組み込み） | 本文の画像抽出や `loading="lazy"` / `srcset` の付与をストリーミングで行い、CPU 消費が少ない |
| 管理画面 | React + Vite + TypeScript（ルーティングは React Router） | Tiptap 公式の `@tiptap/react` がそのまま使え、情報も多い。エディタは画面単位で遅延読み込みし、初回表示を軽くする。ビルド成果物は Static Assets に置く |
| リッチテキストエディタ | Tiptap (ProseMirror) | モバイルの contenteditable での挙動が比較的安定しており、拡張しやすい |
| コードエディタ | CodeMirror 6 | HTML / CSS のシンタックスハイライト。モバイルでも動く |
| 言語 | TypeScript（Worker・管理画面とも） | 型を共有できる |

---

## 4. URL 設計

### 公開側
| パス | 内容 |
|------|------|
| `/` | トップページ（新着記事一覧、1 ページ 10 件） |
| `/page/:n` | 新着一覧の 2 ページ目以降 |
| `/posts/:slug` | 記事詳細 |
| `/tags` | タグ一覧（記事数つき） |
| `/tags/:tag` , `/tags/:tag/page/:n` | タグ別記事一覧 |
| `/p/:slug` | 固定ページ（About など。HTML を直接編集） |
| `/assets/site.css?v=<hash>` | CMS で編集した CSS（ハッシュつきで長期キャッシュ） |
| `/media/:key` | 画像（R2） |
| `/feed.xml` / `/sitemap.xml` / `/robots.txt` | RSS・サイトマップ |

### 管理側
| パス | 内容 |
|------|------|
| `/admin/` | 管理画面 SPA（Static Assets） |
| `/admin/setup` | 初回アカウント作成（アカウント作成後は無効） |
| `/api/admin/*` | JSON API（`/api/admin/auth/*` 以外はログイン必須） |

---

## 5. 認証とアカウントを一つに限る仕組み

### 5.1 アカウントを 1 つに制限する
多重に防ぐ。

1. **DB 制約**: `users` テーブルの主キーを `id INTEGER PRIMARY KEY CHECK (id = 1)` にする。2 件目の INSERT は DB 側で必ず失敗するので、同時にリクエストが来ても 2 アカウントにはならない。
2. **API**: `POST /api/admin/auth/setup` は `SELECT COUNT(*) FROM users` が 0 のときだけ受け付け、それ以外は `403`。
3. **画面**: `GET /api/admin/auth/status` が `{ setupRequired: false }` を返したら、管理画面はセットアップ画面を出さない。
4. **セットアップトークン**: デプロイ直後からアカウント作成までの間に第三者に先にアカウントを作られないよう、`wrangler secret put SETUP_TOKEN` で設定した値の入力をセットアップ時に必須にする。

アカウントは作り直さず、**パスワード変更**（現在のパスワードが必要）で運用する。パスワードを忘れたときは、`wrangler d1 execute` で `users` を手動削除してから再セットアップする手順を README に書く。

### 5.2 ログインとセッション
- パスワードは **PBKDF2-SHA256（WebCrypto）**、16 バイトのソルトでハッシュ化する。workerd の上限である 100,000 回で反復する。ログインはまれなので、無料枠の CPU 10ms を一時的に超えても実害は小さい。超過でエラーになる場合は反復回数を下げ、§5.3 のロックアウトで補う。
- ログインに成功したら 32 バイトのランダムトークンを発行する。DB にはトークンの **SHA-256 ハッシュ**だけを `sessions` に保存する。
- Cookie: `sid=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=30日`
- 状態を変える API（POST/PUT/DELETE）では `Origin` ヘッダーを検証し、CSRF を防ぐ。
- 期限切れセッションは、ログインのたびに古い行を削除して掃除する（Cron は使わない）。

### 5.3 総当たり対策
- `login_attempts` テーブルに IP（`CF-Connecting-IP`）ごとの失敗回数を記録する。15 分間に 5 回失敗したら 15 分ロックする。
- 必要なら Cloudflare ダッシュボードの WAF レート制限ルール（無料プランで 1 ルール）を `/api/admin/auth/login` に設定する。

### 5.4 将来の拡張
- パスキー（WebAuthn）。スマホの生体認証でログインでき、モバイル運用と相性がよい。フェーズ 2 で検討する。

---

## 6. データモデル（D1）

### 6.1 スキーマ

```sql
-- アカウント（1 行のみ）
CREATE TABLE users (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- base64(hash)
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  user_agent  TEXT
);

CREATE TABLE login_attempts (
  ip          TEXT PRIMARY KEY,
  fail_count  INTEGER NOT NULL,
  first_at    INTEGER NOT NULL,
  locked_until INTEGER
);

-- 記事
CREATE TABLE posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  body_html      TEXT NOT NULL DEFAULT '',
  editor_mode    TEXT NOT NULL DEFAULT 'rich' CHECK (editor_mode IN ('rich','html')),
  excerpt        TEXT,                   -- 未入力なら本文から自動生成した値を入れる
  cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  cover_auto     INTEGER NOT NULL DEFAULT 1,  -- 1: 本文の先頭画像に自動追従 / 0: 手動指定
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at   INTEGER,                -- 未来日時なら予約投稿扱い
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_posts_pub ON posts(status, published_at DESC);

-- タグ
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,              -- 表示名（例: "旅行", "Cloudflare"）
  name_key   TEXT NOT NULL UNIQUE,       -- 正規化キー（NFKC + trim + 英字小文字化）
  created_at INTEGER NOT NULL
);
CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

-- 画像
CREATE TABLE media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key     TEXT NOT NULL UNIQUE,       -- 例: img/2026/11/01JC...ULID.webp
  thumb_key  TEXT NOT NULL,              -- 例: img/2026/11/01JC...ULID-w800.webp
  mime       TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  alt        TEXT,
  created_at INTEGER NOT NULL
);

-- 記事と画像の参照関係（未使用画像の検出や、カバー候補の表示に使う）
CREATE TABLE post_media (
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,             -- 本文中での出現順
  PRIMARY KEY (post_id, media_id)
);

-- テンプレート / パーシャル / CSS
CREATE TABLE templates (
  name       TEXT PRIMARY KEY,           -- 'layout','home','post','tag','tags','page','404', 'partial:header', 'css:site' など
  kind       TEXT NOT NULL CHECK (kind IN ('page','partial','css')),
  content    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE template_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tpl_rev ON template_revisions(name, created_at DESC);

-- 固定ページ（About など。HTML を直接編集）
CREATE TABLE pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  updated_at INTEGER NOT NULL
);

-- サイト設定（KVS 的に使う）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,                -- 'site_title','site_description','posts_per_page','content_version' など
  value TEXT NOT NULL
);
```

時刻は全カラムとも UNIX 秒（UTC）で保存し、表示時に `Asia/Tokyo` へ変換する。

### 6.2 記事本文（リッチテキスト / HTML）
- 保存形式は**どちらのモードでも HTML（`body_html`）だけ**。`editor_mode` には、最後にどちらのエディタで編集したかを記録する。
- **リッチ → HTML**: Tiptap が出力した HTML をそのまま CodeMirror で開く。情報は欠けない。
- **HTML → リッチ**: Tiptap が扱えないタグや属性（`<script>`、独自 class、`<iframe>` など）は消える可能性がある。切り替え前に読み込み後の HTML と比較し、差分があれば「一部の HTML が失われます」と警告して確認を取る。HTML モードで書いた記事は、基本的に HTML モードで編集し続ける運用を想定する。
- **サニタイズしない**: 執筆者は本人一人なので、HTML モードでは任意の HTML（埋め込みウィジェットなど）を許可する。リッチモードは Tiptap のスキーマが許すタグしか出力しない。
  - ただし、自分の記事に入れたスクリプトは管理画面と同じオリジンで動く。外部の埋め込みコードは信頼できるものだけ貼る、と README に注意を書く。（管理画面の配置は §15 を参照。）
- **保存時の処理**（Worker の `HTMLRewriter` で行う）:
  1. `<img src="/media/...">` を出現順に集め、`post_media` を更新する。
  2. `cover_auto = 1` なら、先頭の画像を `cover_media_id` に設定する。
  3. `excerpt` が空なら、テキストを抽出して先頭 120 文字を抜粋として保存する。
- **表示時の処理**（`HTMLRewriter`）: 本文中の `/media/` 画像に `loading="lazy"`、`decoding="async"`、`width`/`height`（レイアウトのずれを防ぐ）、`srcset`（800w / 1600w）を付ける。

### 6.3 タグ
- 記事編集画面のタグ入力はチップ形式。入力中に `GET /api/admin/tags?q=` で既存タグを補完し、確定（Enter・読点・カンマ）した時点で、未登録ならその場で作成する。
- 正規化キー `name_key` で同じタグの重複を防ぐ（例: `ＣＳＳ` / `css ` / `CSS` → `css`）。表示名は最初に登録されたものを使う。
- タグ名の変更・統合・削除は「タグ管理」画面で行う。どの記事にも使われていないタグは一覧に「未使用」と表示し、まとめて削除できる。
- URL はタグ名をそのまま使う（`/tags/旅行` → パーセントエンコード）。表示名を変えても URL が変わらないよう、ルーティングでは `name_key` で照合する。

### 6.4 予約投稿
`status='published' AND published_at <= now()` を公開条件にするので、未来の日時を入れれば予約投稿になる。Cron は使わない。

---

## 7. 画像アップロード

### 7.1 流れ
```
[スマホ] <input type=file accept="image/*">  ← カメラ撮影 / 写真ライブラリ
   │  createImageBitmap で読み込み（EXIF の向きを反映）
   │  Canvas で長辺 1600px と 800px の 2 サイズに縮小し、WebP（品質 0.82）にエンコード
   │  ※ 再エンコードで EXIF（GPS 位置情報など）を取り除く
   ▼
POST /api/admin/media (multipart: original=1600px, thumb=800px, alt)
   │  Worker: Content-Type とサイズ（各 5MB 以下）を検証
   │          ULID でキーを作り R2 に PUT、media に INSERT
   ▼
{ id, url: "/media/img/2026/11/xxx.webp", thumbUrl, width, height }
   → リッチエディタならカーソル位置に <img> を挿入、HTML モードならタグ文字列を挿入
```

- **縮小をブラウザ側で行う理由**: Workers 無料枠の CPU 時間（10ms）ではサーバー側で画像を変換できない。Cloudflare Images の変換機能にも月の上限がある。スマホ写真（数 MB〜十数 MB）を、R2 の容量と閲覧者の通信量の両方を抑えたサイズにしてから送る。
- **iPhone の HEIC**: `accept="image/*"` の場合、iOS Safari は JPEG に変換して渡すことが多い。`createImageBitmap` が失敗したら「この形式は非対応です」と表示する。
- **WebP 非対応の古いブラウザ向けのエンコード**: `canvas.toBlob('image/webp')` が PNG で返ってきたら、JPEG にフォールバックする。
- 複数枚を一度に選べるようにし、キューで 1 枚ずつ順番にアップロードする（進捗バーつき）。
- エディタへの貼り付け（ペースト）やドラッグ＆ドロップでも同じ処理でアップロードする。

### 7.2 配信
- `GET /media/*` で R2 から取得し、`Cache-Control: public, max-age=31536000, immutable` と `ETag` を付けて返す。キーに ULID を含めて毎回変わるようにしているので、長期キャッシュしても問題ない。
- Worker の Cache API にも入れ、R2 の読み取り回数（Class B）を減らす。

### 7.3 メディアライブラリ
- 管理画面で画像をグリッド表示し、無限スクロールで読み込む。alt の編集、削除、URL のコピーができる。
- 削除しようとした画像を記事が使っている場合（`post_media` に存在）は、その記事一覧を示して確認する。

---

## 8. テンプレート（HTML / CSS 編集）

### 8.1 構成
| 名前 | 種別 | 用途 |
|------|------|------|
| `layout` | page | 全ページ共通の外枠（`<html>`〜`</html>`）。`{{{content}}}` の位置に各ページの中身を差し込む |
| `home` | page | トップ／新着一覧 |
| `post` | page | 記事詳細 |
| `tag` | page | タグ別一覧 |
| `tags` | page | タグ一覧 |
| `page` | page | 固定ページ |
| `404` | page | Not Found |
| `partial:header` / `partial:footer` / `partial:post-card` | partial | `{{> header}}` で読み込む部品 |
| `css:site` | css | サイト全体の CSS |

### 8.2 テンプレート変数（例）
```
共通: site.title, site.description, site.url, page.title, page.description,
      page.ogImage, cssUrl, year, nav.tags[]
home/tag: posts[] { title, url, excerpt, dateLabel, cover { url, thumbUrl, srcset, width, height, alt },
                    tags[] { name, url } }, pager { prevUrl, nextUrl, current, total }, tag { name }
post: post { title, bodyHtml, dateLabel, updatedLabel, cover, tags[] }, prev { title, url }, next { ... }
```
- エスケープの規則は Mustache と同じ: `{{x}}` はエスケープされ、`{{{x}}}` は生 HTML として出力される（本文 `{{{post.bodyHtml}}}` など）。
- 管理画面の「変数リファレンス」パネルに、各テンプレートで使える変数を一覧で表示する。

### 8.3 編集画面
- CodeMirror 6 で編集する。スマホでは全画面エディタにし、キーボードの上に `{{ }}` `<` `>` `/` `"` を入力する補助バーを出す。
- **プレビュー**: `POST /api/admin/preview` に未保存のテンプレートとサンプルデータ（最新記事）を送り、`iframe srcdoc` に描画する。
- **保存時の検証**: Mustache のパースに失敗したら保存しない（閉じ忘れの `{{#posts}}` など）。
- **履歴**: 保存のたびに `template_revisions` に記録する（テンプレートごとに直近 30 件。超えた分は削除）。差分を見て任意の版に戻せる。
- **初期値に戻す**: 初期テンプレートはソースコードに同梱しておき、いつでもリセットできる。
- **壊れたときの保険**: 描画時に例外が出たら、同梱の初期テンプレートで描画し直し、ページ上部に管理者向けの警告コメントを出す。管理画面は SPA で、このテンプレートを使わないので、テンプレートが壊れても CMS 自体は操作できる。

### 8.4 CSS の配信
- `css:site` を保存したら、内容の SHA-256 の先頭 8 文字を `settings.css_hash` に保存する。
- `layout` では `<link rel="stylesheet" href="{{cssUrl}}">`（`/assets/site.css?v=<hash>`）として読み込み、`immutable` で長期キャッシュさせる。

---

## 9. 公開サイトの画面

### 9.1 トップページ（新着記事）
スマホ（幅 〜640px）を基準にする。

```
┌───────────────────────┐
│ ☰  サイト名            │  ← 固定ヘッダー（小さめ）
├───────────────────────┤
│ ┌───────────────────┐ │
│ │                   │ │  ← 最新記事: 画像を画面幅いっぱい・4:3 で大きく表示
│ │   カバー画像        │ │
│ │                   │ │
│ └───────────────────┘ │
│ 2026.11.14  #旅行 #京都 │
│ 記事タイトル（大きめ）    │
│ 抜粋 2 行…              │
├───────────────────────┤
│ ┌───────────────────┐ │  ← 2 件目以降も 1 カラムで画像を大きく（16:9）
│ │   カバー画像        │ │
│ └───────────────────┘ │
│ タイトル                │
│  …                     │
├───────────────────────┤
│   ‹ 前へ    次へ ›      │
└───────────────────────┘
```
- カバー画像は `object-fit: cover` で切り抜く。`srcset` で 800w / 1600w を出し分ける。最初の 1 枚は `fetchpriority="high"` で、ほかは `loading="lazy"`。
- 画像のない記事は、タイトルを大きく表示するカードにする（カードの高さが揃いすぎないようにする）。
- タブレット・PC（641px〜）では 2〜3 カラムのグリッドにし、先頭の 1 件だけ横 2 カラム分の大きさで表示する。
- これらはすべて初期テンプレートと初期 CSS で実装する。CMS で自由に書き換えられる。

### 9.2 記事ページ
- 本文の文字は 17px、行間 1.8。本文中の画像は横幅いっぱいに表示する。
- タグはチップ表示で、タップするとタグ一覧へ移動する。前後の記事へのリンクを付ける。
- OGP / Twitter Card は、カバー画像（1600px）を `og:image` に使う。

### 9.3 その他
- RSS（最新 20 件）、`sitemap.xml`、`robots.txt` を出力する。
- 全ページ JS なしで動作する。

---

## 10. 管理画面（モバイルファースト）

### 10.1 画面一覧
| 画面 | 主な操作 |
|------|---------|
| ログイン / 初回セットアップ | セットアップはアカウント未作成のときだけ表示 |
| 記事一覧 | 下書き・公開・予約のフィルター、検索、新規作成ボタン（右下 FAB） |
| 記事編集 | タイトル、本文（リッチ / HTML 切り替え）、画像挿入、タグ、カバー選択、スラッグ、公開日時、下書き保存・公開 |
| メディア | 画像グリッド、複数枚アップロード、alt 編集、削除 |
| タグ | 一覧（記事数）、名前変更、統合、削除 |
| デザイン | テンプレート / パーシャル / CSS の編集、プレビュー、履歴、初期化 |
| 固定ページ | 一覧・編集（HTML） |
| 設定 | サイト名・説明・1 ページの表示件数、パスワード変更、ログアウト |

### 10.2 スマホで扱いやすくする工夫
- **下部タブナビ**（記事 / メディア / デザイン / 設定）。片手で操作でき、タップ領域は 44px 以上にする。
- **記事編集**:
  - リッチエディタの書式ツールバー（B・見出し・リスト・リンク・画像・引用）はキーボードの直上に固定する。`visualViewport` API でキーボードの高さを検知して位置を合わせる。
  - 「画像」ボタンからカメラ / ライブラリを開き、選んだ画像を縮小・アップロードしてカーソル位置に挿入する。
  - タイトル・タグ・カバー・公開設定は、本文の下にある折りたたみの「記事設定」シートにまとめ、本文を広く使えるようにする。
  - **カバー選択**: 本文中の画像をサムネイルで横スクロール表示し、タップで選ぶ（「自動（先頭画像）」も選べる）。
  - **自動保存**: 入力から 3 秒後に `localStorage` に下書きを保存する。通信が切れても失わない。サーバーへの保存は明示的な「保存」ボタンで行う。保存時に `updated_at` を比較し、別タブとの上書き競合を検出する。
  - **プレビュー**: 公開前の見た目を `/api/admin/preview` で確認できる。
- 管理画面は PWA（`manifest.json`）にし、ホーム画面に追加してアプリのように使えるようにする。オフライン対応はしない。

---

## 11. 無料枠の見積もり

| サービス | 無料枠（2026 年 11 月時点で要再確認） | 本設計での使い方 |
|---------|-------------------------------|-----------------|
| Workers | 10 万リクエスト/日、CPU 10ms/リクエスト | 公開ページ・API・画像配信。静的アセット（管理画面）は数えられない |
| Workers Static Assets | 無料・無制限 | 管理画面 SPA、ファビコンなど |
| D1 | 5GB、読み取り 500 万行/日、書き込み 10 万行/日 | トップ表示 1 回あたり数十行程度の読み取り |
| R2 | 10GB、Class A 100 万回/月、Class B 1,000 万回/月、転送量無料 | 1 枚約 300KB + 80KB として、およそ 2.5 万枚まで |

**CPU 時間（10ms）への対策**
- 画像変換はブラウザで行い、Worker では処理しない。
- HTML の加工は `HTMLRewriter`（ネイティブ実装・ストリーミング）で行う。
- 公開ページは Cache API でエッジキャッシュする。キャッシュキーに `settings.content_version` を含め、記事・テンプレート・設定を保存したら `content_version` を加算して、キャッシュを実質的に無効化する。予約投稿にも対応するため、キャッシュの TTL は 5 分にする。
- Hono と mustache を合わせても Worker のバンドルは数百 KB 以内に収まる見込み（無料枠の上限は 3MB）。

**注意**: R2 を有効にするには、無料枠内で使う場合でも Cloudflare アカウントへの支払い方法（カード）の登録が必要（登録済みの前提）。画像は D1 には入れない（D1 は無料プランだと 1 データベース 500MB までで、画像を入れると記事データのバックアップや移行も重くなるため）。

---

## 12. API 一覧（管理）

すべて `/api/admin` 配下。JSON でやり取りする。`auth/*` 以外はセッション必須。

| メソッド | パス | 説明 |
|---------|------|------|
| GET  | `/auth/status` | `{ setupRequired, loggedIn }` |
| POST | `/auth/setup` | `{ setupToken, username, password }`。アカウントが 0 件のときだけ受け付ける |
| POST | `/auth/login` / `/auth/logout` | ログイン / ログアウト |
| PUT  | `/auth/password` | パスワード変更 |
| GET  | `/posts?status=&q=&cursor=` | 記事一覧 |
| POST | `/posts` | 記事作成 |
| GET / PUT / DELETE | `/posts/:id` | 記事の取得 / 更新（`updated_at` で競合を検出）/ 削除 |
| GET  | `/tags?q=` | タグの検索・補完 |
| PUT / DELETE | `/tags/:id` | タグの名前変更 / 削除 |
| POST | `/tags/:id/merge` | `{ intoId }` タグの統合 |
| GET  | `/media?cursor=` | 画像一覧 |
| POST | `/media` | 画像アップロード（multipart） |
| PUT / DELETE | `/media/:id` | alt の更新 / 画像の削除 |
| GET  | `/templates` | テンプレート一覧 |
| GET / PUT | `/templates/:name` | テンプレートの取得 / 保存（パース検証と履歴記録つき） |
| GET  | `/templates/:name/revisions` | 履歴一覧 |
| POST | `/templates/:name/restore` | `{ revisionId }` または `{ default: true }` で復元・初期化 |
| POST | `/preview` | `{ template?, post? }` から HTML を生成 |
| GET / POST / PUT / DELETE | `/pages` , `/pages/:id` | 固定ページの CRUD |
| GET / PUT | `/settings` | サイト設定 |

---

## 13. ディレクトリ構成

```
blog-cms/
├─ wrangler.jsonc            # Worker / D1 / R2 / assets のバインディング
├─ migrations/
│   └─ 0001_init.sql
├─ src/                      # Worker
│   ├─ index.ts              # Hono アプリのエントリ
│   ├─ routes/
│   │   ├─ public.ts         # /, /posts, /tags, /p, feed, sitemap
│   │   ├─ media.ts          # /media/*
│   │   └─ admin/            # auth.ts, posts.ts, tags.ts, media.ts, templates.ts, pages.ts, settings.ts
│   ├─ lib/
│   │   ├─ auth.ts           # PBKDF2, セッション, ログイン制限
│   │   ├─ render.ts         # Mustache 描画, layout 合成, フォールバック
│   │   ├─ html.ts           # HTMLRewriter: 画像抽出, 抜粋, lazy/srcset 付与
│   │   ├─ cache.ts          # Cache API + content_version
│   │   ├─ storage.ts        # R2 への画像保存・取得
│   │   └─ tags.ts           # 正規化
│   └─ defaults/             # 初期テンプレートと CSS（*.mustache, site.css）
├─ admin/                    # 管理画面 SPA (React + Vite)
│   ├─ src/
│   │   ├─ pages/            # Login, Setup, Posts, PostEdit, Media, Tags, Design, Pages, Settings
│   │   ├─ components/       # RichEditor(Tiptap), CodeEditor(CodeMirror), TagInput, ImagePicker, BottomNav
│   │   └─ lib/              # api.ts, imageResize.ts, autosave.ts
│   └─ vite.config.ts        # 出力先 → ../public/admin
├─ public/                   # Static Assets（admin のビルド成果物、favicon）
└─ test/                     # Vitest + @cloudflare/vitest-pool-workers
```

---

## 14. 実装フェーズ

| フェーズ | 内容 |
|---------|------|
| 1. 基盤 | wrangler 設定、D1 マイグレーション、Hono の骨組み、認証（セットアップ / ログイン / 1 アカウント制限） |
| 2. 記事とタグ | 記事 CRUD、タグ入力と補完、公開側の記事ページ・トップ・タグページ（初期テンプレート） |
| 3. 画像 | ブラウザでの縮小とアップロード、R2 配信、エディタへの挿入、カバーの自動選択と手動選択 |
| 4. エディタ | Tiptap のリッチモード、CodeMirror の HTML モード、切り替え時の警告、自動保存 |
| 5. デザイン編集 | テンプレート・CSS 編集、プレビュー、履歴と復元、フォールバック描画 |
| 6. 仕上げ | キャッシュ、RSS / sitemap / OGP、固定ページ、PWA、テスト、README（デプロイ手順） |

---

## 15. 決定事項

| 項目 | 決定 |
|------|------|
| ドメイン | 独自ドメイン `etlits.dev`。Cloudflare に登録したゾーンを Worker の Custom Domain に割り当てる（`*.workers.dev` の URL は無効化する） |
| 画像ストレージ | R2（カード登録済み） |
| コメント欄・サイト内検索 | 作らない |
| テンプレート構文 | Mustache |
| 管理画面 | React + Vite + TypeScript |
