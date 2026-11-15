-- 初期スキーマ（設計書 §6.1）
-- 時刻はすべて UNIX 秒（UTC）

-- アカウント（id = 1 の 1 行しか存在できない）
CREATE TABLE users (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- IP ごとの試行回数（window_start から LOGIN_WINDOW_SECONDS の間に attempts 回）
CREATE TABLE login_attempts (
  ip           TEXT PRIMARY KEY,
  attempts     INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- 画像
CREATE TABLE media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key     TEXT NOT NULL UNIQUE,
  thumb_key  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  alt        TEXT,
  created_at INTEGER NOT NULL
);

-- 記事
CREATE TABLE posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  body_html      TEXT NOT NULL DEFAULT '',
  editor_mode    TEXT NOT NULL DEFAULT 'rich' CHECK (editor_mode IN ('rich', 'html')),
  excerpt        TEXT,
  cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  cover_auto     INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at   INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_posts_pub ON posts(status, published_at DESC);

-- タグ
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

-- 記事と画像の参照関係
CREATE TABLE post_media (
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (post_id, media_id)
);

-- テンプレート / パーシャル / CSS
CREATE TABLE templates (
  name       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('page', 'partial', 'css')),
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

-- 固定ページ
CREATE TABLE pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  updated_at INTEGER NOT NULL
);

-- サイト設定
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('site_title', 'etlits'),
  ('site_description', ''),
  ('posts_per_page', '10'),
  ('content_version', '1');
