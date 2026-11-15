import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 本番では admin.etlits.dev/ で表示するが、ファイルは Worker の Static Assets の /admin/ 以下に置く。
// そのため JS / CSS の参照先 (base) はビルド時だけ /admin/ にする。
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: command === 'build' ? '/admin/' : '/',
  plugins: [react()],
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:admin` 用: API は wrangler dev (admin.localhost:8787) に転送する
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        headers: { host: 'admin.localhost:8787', origin: 'http://admin.localhost:8787' },
      },
    },
  },
}));
