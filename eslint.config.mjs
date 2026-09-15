import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

/**
 * Flat ESLint config (ESLint 9+/10). Replaces the legacy `.eslintrc.json`, which
 * ESLint 10 can no longer read.
 *
 * Mirrors the old setup: @typescript-eslint recommended + the import plugin's
 * recommended/typescript/electron rule sets. Core `eslint:recommended` is not
 * pulled in (its package is not a dependency); the TypeScript rules cover the
 * same ground for this codebase, and `no-undef` is intentionally left to tsc.
 */

const tsEslintRecommended = tseslint.configs.recommended?.rules ?? {};
const tsEslintCoreOff = Object.assign(
  {},
  ...(tseslint.configs['eslint-recommended']?.overrides ?? []).map((o) => o.rules ?? {}),
);

export default [
  {
    ignores: [
      '**/node_modules/**',
      'out/**',
      '.webpack/**',
      'dist/**',
      'build/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'src/spike/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    settings: {
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      ...tsEslintRecommended,
      ...tsEslintCoreOff,
      ...(importPlugin.configs.recommended?.rules ?? {}),
      ...(importPlugin.configs.typescript?.rules ?? {}),
      ...(importPlugin.configs.electron?.rules ?? {}),
      // Module resolution is owned by tsc (the `@/*` path alias). The TS import
      // resolver is not a dependency, so avoid duplicate/false resolution errors.
      'import/no-unresolved': 'off',
      // Pre-existing, codebase-wide style: `any` and unused vars are pervasive,
      // so keep them visible as warnings while new hard errors still fail CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
];
