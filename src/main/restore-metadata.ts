import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDb } from "./db";
import { getSetting, setSetting } from "./repos/settings";
import { applyIndexFields, getDocumentById } from "./repos/documents";

const RESTORED_KEY = "metadataRestoredFromBackup";

function backupVersion(name: string): number {
  const match = /bak-v(\d+)$/.exec(name);
  return match ? Number(match[1]) : -1;
}

/**
 * One-time recovery of per-note metadata (currently emoji) from the most recent
 * pre-migration SQLite backup.
 *
 * Older vault files predate emoji/bookmark frontmatter; a reconcile pass could
 * wipe values that only lived in the database. The pre-migration backup still has
 * them. Only fills empty fields, never overwrites, so it cannot lose data.
 */
export function restoreMetadataFromBackup(): boolean {
  try {
    if (getSetting(RESTORED_KEY) === "true") return false;

    const userDataDir = path.dirname((getDb() as unknown as { name: string }).name);
    const backups = fs
      .readdirSync(userDataDir)
      .filter((name) => /^lychee\.sqlite3\.bak-v\d+$/.test(name))
      .sort((a, b) => backupVersion(b) - backupVersion(a));
    if (backups.length === 0) return false;

    let restored = 0;
    const backup = new Database(path.join(userDataDir, backups[0]), { readonly: true });
    try {
      const rows = backup
        .prepare("SELECT id, emoji FROM documents WHERE emoji IS NOT NULL AND emoji != ''")
        .all() as Array<{ id: string; emoji: string }>;
      for (const row of rows) {
        const live = getDocumentById(row.id);
        if (live && (!live.emoji || live.emoji === "")) {
          applyIndexFields(row.id, { emoji: row.emoji });
          restored += 1;
        }
      }
    } finally {
      backup.close();
    }

    setSetting(RESTORED_KEY, "true");
    if (restored > 0) {
      console.log(`[restore] recovered metadata for ${restored} note(s) from ${backups[0]}`);
    }
    return restored > 0;
  } catch (error) {
    console.error("[restore] failed", error);
    return false;
  }
}
