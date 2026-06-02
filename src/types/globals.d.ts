// Build-time flag injected by webpack DefinePlugin (webpack.renderer.config.ts)
// and by vitest (`define` in vitest.config.ts). `true` only in E2E builds; baked
// to the literal `false` in production so the minifier strips E2E-only branches
// (and tree-shakes their now-unused imports). See E2ECrashProbe in
// src/components/error-boundary.tsx.
declare const __LYCHEE_E2E__: boolean;
