import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  server: {
    port: 3000,
    host: '127.0.0.1'
  }
});
