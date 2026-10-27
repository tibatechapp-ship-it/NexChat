import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/web/session.test.mjs', '**/node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  }
});
