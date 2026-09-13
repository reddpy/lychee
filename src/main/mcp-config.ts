import path from "path";
import { app } from "electron";
import type { McpServerConfig, McpSetupFields } from "../shared/mcp";

/**
 * Builds the values needed to register the Lychee MCP server with an AI app.
 *
 * The command is the running Lychee binary with `ELECTRON_RUN_AS_NODE=1`, so the
 * endpoint works on a machine without a separate Node install. The app shows
 * these fields individually (some clients only accept a local server through
 * their own UI and make you type each field), plus a ready JSON snippet.
 */

function serverPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "mcp", "lychee-mcp.mjs")
    : path.join(app.getAppPath(), "out", "mcp", "lychee-mcp.mjs");
}

/**
 * Where the markdown vault lives when the user hasn't chosen a folder.
 * `~/Documents/Lychee` is user-visible and cloud-sync friendly (iCloud/Dropbox),
 * unlike the hidden app-data dir. The app creates it on first AI setup.
 */
export function defaultVaultPath(): string {
  // E2E runs must never touch the user's real ~/Documents/Lychee.
  const override = process.env.LYCHEE_VAULT_DIR;
  if (override && override.length > 0) return override;
  return path.join(app.getPath("documents"), "Lychee");
}

/**
 * The actual vault root for a user-chosen folder. If they pick a shared folder
 * (e.g. `~/Downloads`), Lychee uses a `Lychee/` subfolder so note files never mix
 * with unrelated files and the watcher only ever watches Lychee's own folder.
 * A folder already named `Lychee` is used as-is.
 */
export function resolveVaultRoot(directory: string): string {
  if (path.basename(directory).toLowerCase() === "lychee") return directory;
  return path.join(directory, "Lychee");
}

export function buildServerConfig(vaultPath: string): McpServerConfig {
  return {
    command: process.execPath,
    args: [serverPath(), "--vault", vaultPath],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

/** The `mcpServers` JSON a client that reads a config file can use. */
export function manualMcpConfig(vaultPath: string): string {
  return JSON.stringify({ mcpServers: { lychee: buildServerConfig(vaultPath) } }, null, 2);
}

/** The field values a manual client's UI asks for. */
export function mcpSetupFields(vaultPath: string): McpSetupFields {
  const config = buildServerConfig(vaultPath);
  return {
    name: "Lychee",
    type: "STDIO",
    command: config.command,
    args: config.args,
    env: config.env ?? {},
    workingDirectory: vaultPath,
  };
}
