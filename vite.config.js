import { defineConfig } from 'vite';

// Клиент лежит в client/, сборка уходит в dist/ (раздаётся сервером).
export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
