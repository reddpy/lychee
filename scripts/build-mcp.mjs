#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
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
  // Stamp the build so `server_info` can prove which bundle a client is running.
  define: {
    __LYCHEE_MCP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  // The MCP peer reuses the headless editor/sync modules, which import via the
  // app's `@/` alias.
  alias: {
    '@': resolve(repo, 'src'),
    // Pin Yjs to ONE build. `@lexical/yjs` (ESM) and `y-protocols` (CJS) would
    // otherwise bundle separate copies, breaking `instanceof` checks across them
    // (yjs/yjs#438).
    yjs: resolve(repo, 'node_modules/yjs/dist/yjs.cjs'),
    // Pin Lexical to ONE build too. The editor's custom nodes import the ESM
    // build while some `@lexical/*` packages resolve the CJS build, so
    // registering them throws "_TitleNode ... does not subclass LexicalNode".
    lexical: resolve(repo, 'node_modules/lexical/Lexical.mjs'),
  },
});

console.log(`[build:mcp] wrote ${resolve(outDir, 'lychee-mcp.mjs')}`);

// Guard against the dual-copy hazard coming back: if lexical appears twice, the
// editor's custom nodes subclass a different `LexicalNode` than the headless
// editor uses, and every live-edit tool call throws
// "_TitleNode ... does not subclass LexicalNode".
const output = readFileSync(resolve(outDir, 'lychee-mcp.mjs'), 'utf8');
const lexicalCopies = (output.match(/class LexicalNode\b/g) ?? []).length;
if (lexicalCopies > 1) {
  throw new Error(
    `[build:mcp] bundled ${lexicalCopies} copies of lexical. @lexical/* and the ` +
      'editor must share ONE build; check the esbuild aliases in this script.',
  );
}
