import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // sila/ عقدة مستقلة باختبارات node:test خاصة بها — وظيفة CI منفصلة.
    exclude: ['**/web/session.test.mjs', '**/node_modules/**', '**/sila/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  }
});
