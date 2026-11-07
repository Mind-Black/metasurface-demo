import { defineConfig } from 'vitest/config';
import path from 'path';

// Timing harness for the performance work: `npm run bench`. Kept apart from `npm test` so unit runs stay fast.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/bench/**/*.bench.ts'],
    testTimeout: 600000,
    fileParallelism: false,
  },
});
