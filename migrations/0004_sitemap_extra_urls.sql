-- サイトマップに追加で載せる URL（1 行に 1 つ）。このブログ以外の、同じドメインのサイトのページなど
INSERT INTO settings (key, value) VALUES ('sitemap_extra_urls', 'https://discheduler.etlits.dev/en/')
  ON CONFLICT(key) DO NOTHING;
