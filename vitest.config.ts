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
    // The Yjs spike suites under src/spike/ are research/exploration harnesses
    // (long adversarial fuzzes), not CI gates — keep them out of the default run.
    // To run them, drop 'src/spike/**' below. The first two globs are vitest's
    // defaults, restated because setting `exclude` replaces them.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/spike/**'],
    environment: 'node',
  },
});
