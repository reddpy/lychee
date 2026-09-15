import path from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

/**
 * stdio entry point for the Lychee MCP server.
 * Usage: lychee-mcp --vault <path>   (or set LYCHEE_VAULT)
 */
function resolveVault(argv: string[]): string {
  const flagIndex = argv.indexOf("--vault");
  const fromFlag = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
  const vault = fromFlag || process.env.LYCHEE_VAULT;
  if (!vault) {
    throw new Error("Missing vault path. Pass --vault <path> or set LYCHEE_VAULT.");
  }
  return path.resolve(vault);
}

/**
 * Optional local bridge socket (set by the app when Yjs mode is on). When
 * reachable, content edits apply to the live Y.Doc so they appear in the user's
 * open editor immediately; when it isn't, the tools fall back to markdown.
 */
function resolveSyncSocket(argv: string[]): string | undefined {
  const flagIndex = argv.indexOf("--sync-socket");
  const fromFlag = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
  return fromFlag || process.env.LYCHEE_SYNC_SOCKET || undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const vault = resolveVault(argv);
  const server = createServer(vault, { syncSocket: resolveSyncSocket(argv) });
  await server.connect(new StdioServerTransport());
  console.error(`[lychee-mcp] serving vault: ${vault}`);
}

main().catch((error) => {
  console.error(`[lychee-mcp] ${(error as Error).message}`);
  process.exit(1);
});
