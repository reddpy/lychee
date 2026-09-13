#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundles the standalone MCP server to a single runnable file so an MCP client
// can launch it with plain `node`. It intentionally does not go through the
// Electron/webpack pipeline — it must run without Electron or the database.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');
const outDir = resolve(repo, 'out/mcp');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(repo, 'src/mcp/cli.ts')],
  outfile: resolve(outDir, 'lychee-mcp.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
});

console.log(`[build:mcp] wrote ${resolve(outDir, 'lychee-mcp.mjs')}`);
