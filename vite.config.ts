import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    // `npx wrangler dev` serves the real API on 8787; Vite only serves the page.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
