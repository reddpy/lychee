import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  define: {
    // Mirror webpack's DefinePlugin so renderer code gated on the E2E build flag
    // compiles in tests (the E2ECrashProbe branch stays inert under vitest).
    __LYCHEE_E2E__: 'false',
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
