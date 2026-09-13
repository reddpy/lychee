import fs from "fs";
import { getSetting, setSetting } from "./repos/settings";
import { listAllDocumentTitles, trashDocument } from "./repos/documents";
import { resolveVaultRoot, defaultVaultPath } from "./mcp-config";
import { resolveWithinVault, scanVaultDirectory } from "./vault";
import { appendTombstone, getDeviceId } from "./tombstones";
import { VAULT_LOCATION_KEY, VAULT_WATCH_DIRECTORY_KEY } from "./vault-sync";
import { isNonMarkdownFileTitle } from "../shared/vault-watch";

const CLEANED_KEY = "importedArtifactsCleaned";

/**
 * One-time self-heal for notes a buggy watcher imported from arbitrary files
 * (e.g. `Proxon-….dmg`, `IMG_….HEIC`) when the vault pointed at a shared folder
 * like ~/Downloads. Those notes can be enormous and must never be re-imported.
 *
 * Non-destructive: notes are moved to trash (recoverable), their vault files are
 * removed, and a purge tombstone stops a rebuild from bringing them back.
 * Runs once, gated by a setting.
 */
export function cleanupImportedArtifacts(): void {
  try {
    if (getSetting(CLEANED_KEY) === "true") return;

    const junk = listAllDocumentTitles().filter((row) => isNonMarkdownFileTitle(row.title));
    if (junk.length === 0) {
      setSetting(CLEANED_KEY, "true");
      return;
    }

    const stored =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? "";
    const vault = stored ? resolveVaultRoot(stored) : defaultVaultPath();
    const junkIds = new Set(junk.map((row) => row.id));

    // Remove the exported junk files and tombstone their ids so a rebuild skips
    // them even though the files are gone.
    for (const entry of scanVaultDirectory(vault).entries) {
      if (!entry.id || !junkIds.has(entry.id)) continue;
      try {
        fs.unlinkSync(resolveWithinVault(vault, entry.relativePath));
      } catch {
        // best-effort
      }
      try {
        appendTombstone(vault, entry.id, "purge", getDeviceId());
      } catch {
        // best-effort
      }
    }

    for (const row of junk) {
      try {
        trashDocument(row.id);
      } catch {
        // best-effort
      }
    }

    setSetting(CLEANED_KEY, "true");
    console.log(`[cleanup] moved ${junk.length} imported artifact note(s) to trash`);
  } catch (error) {
    console.error("[cleanup] failed", error);
  }
}
