/**
 * Cross-device delete tombstones.
 *
 * A delete cannot be represented by file absence: absence also means "not yet
 * exported" or "not present on this device". So deletes are explicit records in
 * an append-only, per-device log:
 *
 *   <vault>/.lychee/tombstones/<deviceId>.jsonl
 *
 * Each device only ever appends to its own file, so a cloud-sync engine can never
 * produce a conflicting rewrite, and reads are a union merge. The effective state
 * of a note is the latest record by `(at, device)` — a total order that makes the
 * outcome deterministic on every replica.
 *
 * Actions:
 *   trash   — soft delete (restorable)
 *   restore — undo a delete
 *   purge   — permanent delete (must never be re-imported)
 */

export type TombstoneAction = 'trash' | 'restore' | 'purge';

export interface TombstoneRecord {
  id: string;
  action: TombstoneAction;
  /** ISO-8601. */
  at: string;
  device: string;
}

export interface TombstoneState {
  action: TombstoneAction;
  at: string;
  device: string;
}

const ACTIONS: readonly TombstoneAction[] = ['trash', 'restore', 'purge'];

function isAction(value: unknown): value is TombstoneAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/** Parse a JSONL log, skipping blank/malformed lines (never throw on bad input). */
export function parseTombstoneLog(text: string): TombstoneRecord[] {
  const records: TombstoneRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !isAction(candidate.action) || typeof candidate.at !== 'string') {
      continue;
    }
    records.push({
      id: candidate.id,
      action: candidate.action,
      at: candidate.at,
      device: typeof candidate.device === 'string' ? candidate.device : '',
    });
  }
  return records;
}

export function serializeTombstone(record: TombstoneRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function isNewer(a: { at: string; device: string }, b: { at: string; device: string }): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.device > b.device;
}

/**
 * Fold one record into the effective state. `purge` is absorbing: a permanent
 * delete cannot be undone by a later restore/trash from a device that had not
 * seen it (mirrors `isPurged` blocking re-import). Returns the state to store,
 * or null when the record is superseded.
 */
export function mergeTombstoneState(
  current: TombstoneState | undefined,
  record: TombstoneRecord,
): TombstoneState | null {
  const next: TombstoneState = {
    action: record.action,
    at: record.at,
    device: record.device,
  };
  if (current?.action === 'purge') {
    return record.action === 'purge' && isNewer(record, current) ? next : null;
  }
  if (record.action === 'purge') return next;
  if (!current || isNewer(record, current)) return next;
  return null;
}

/** Union-merge records into the effective state per note id. */
export function effectiveTombstones(records: TombstoneRecord[]): Map<string, TombstoneState> {
  const map = new Map<string, TombstoneState>();
  for (const record of records) {
    const merged = mergeTombstoneState(map.get(record.id), record);
    if (merged) map.set(record.id, merged);
  }
  return map;
}

export function isDeletedState(state: TombstoneState | undefined): boolean {
  return state?.action === 'trash' || state?.action === 'purge';
}

/**
 * Whether a tombstone should override what we currently know about a note.
 * A later edit (`timestamp` > delete time) happens when a device edited after a
 * delete it had not yet seen; the edit wins rather than being silently dropped.
 */
export function tombstoneSupersedes(state: TombstoneState, timestamp: string | undefined): boolean {
  if (!timestamp) return true;
  return state.at >= timestamp;
}

/** Whether a purge should block re-import regardless of file timestamps. */
export function isPurged(state: TombstoneState | undefined): boolean {
  return state?.action === 'purge';
}
