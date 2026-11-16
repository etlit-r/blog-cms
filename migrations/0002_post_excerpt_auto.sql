-- 抜粋を本文から自動生成するか（1: 自動 / 0: 手動で入力したものを使う）
-- 自動のときは、本文を保存するたびに excerpt を作り直す
ALTER TABLE posts ADD COLUMN excerpt_auto INTEGER NOT NULL DEFAULT 1;
