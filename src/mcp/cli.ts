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

async function main(): Promise<void> {
  const vault = resolveVault(process.argv.slice(2));
  const server = createServer(vault);
  await server.connect(new StdioServerTransport());
  console.error(`[lychee-mcp] serving vault: ${vault}`);
}

main().catch((error) => {
  console.error(`[lychee-mcp] ${(error as Error).message}`);
  process.exit(1);
});
