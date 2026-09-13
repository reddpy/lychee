import fs from "fs";
import path from "path";
import {
  effectiveTombstones,
  parseTombstoneLog,
  serializeTombstone,
  type TombstoneAction,
  type TombstoneRecord,
  type TombstoneState,
} from "../shared/tombstone";

/**
 * Filesystem-only tombstone IO. Kept free of Electron/better-sqlite3 so the
 * standalone MCP server can read the same logs as the app.
 */

export const TOMBSTONE_DIRECTORY = ".lychee/tombstones";

function tombstoneDirectory(vault: string): string {
  return path.join(vault, ".lychee", "tombstones");
}

function deviceLogPath(vault: string, device: string): string {
  const safe = device.replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(tombstoneDirectory(vault), `${safe || "device"}.jsonl`);
}

/** Union-merge every device's log into the effective state per note id. */
export function readTombstones(vault: string): Map<string, TombstoneState> {
  const directory = tombstoneDirectory(vault);
  let files: string[];
  try {
    files = fs.readdirSync(directory);
  } catch {
    return new Map();
  }

  const records: TombstoneRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    try {
      records.push(...parseTombstoneLog(fs.readFileSync(path.join(directory, file), "utf8")));
    } catch {
      // A device log being written concurrently may be briefly unreadable; skip.
    }
  }
  return effectiveTombstones(records);
}

/** Append a tombstone to a specific device log (append-only + fsync). */
export function appendTombstone(
  vault: string,
  id: string,
  action: TombstoneAction,
  device: string,
  at: string = new Date().toISOString(),
): void {
  fs.mkdirSync(tombstoneDirectory(vault), { recursive: true });
  const record: TombstoneRecord = { id, action, at, device };
  const filePath = deviceLogPath(vault, device);
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, serializeTombstone(record));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
