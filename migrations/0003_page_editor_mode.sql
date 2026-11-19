-- 固定ページも、記事と同じくリッチテキストと HTML のどちらで編集したかを記録する
ALTER TABLE pages ADD COLUMN editor_mode TEXT NOT NULL DEFAULT 'rich' CHECK (editor_mode IN ('rich', 'html'));
-- ヘッダーなどに並べる順番（小さい順）
ALTER TABLE pages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
