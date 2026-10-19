import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'scripts/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./src/test/setup-env.ts'],
    // Integration tests share one mongod; give them room on a cold start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
