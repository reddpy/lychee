import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: isCI
    ? [['list'], ['blob', { outputDir: 'blob-report' }]]
    : [['list'], ['html', { open: 'never' }]],
});
