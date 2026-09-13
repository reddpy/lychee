import fs from "fs";
import { getSetting } from "./repos/settings";
import { defaultVaultPath, resolveVaultRoot } from "./mcp-config";

export const VAULT_WATCH_DIRECTORY_KEY = "vaultWatchDirectory";
export const VAULT_WATCH_ENABLED_KEY = "vaultWatchEnabled";
/** Last vault location the user exported to / watched. The MCP config uses it. */
export const VAULT_LOCATION_KEY = "vaultLocation";

/** The vault directory, created if needed. */
export function getVaultDirectory(): string {
  const stored =
    getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? "";
  const directory = stored ? resolveVaultRoot(stored) : defaultVaultPath();
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
