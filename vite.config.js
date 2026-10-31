import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name) => fileURLToPath(new URL(`./client/${name}`, import.meta.url));

// Клиент лежит в client/, сборка уходит в dist/ (раздаётся сервером).
// Страницы: основной клиент (/) и пожарный preview (/firefighter-preview.html).
export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: page('index.html'), firefighter: page('firefighter-preview.html') } },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
