import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 10000,
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
