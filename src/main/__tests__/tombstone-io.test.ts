import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendTombstone, compactTombstones, readTombstones } from '../tombstone-io';

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-tombstone-io-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('compactTombstones', () => {
  it('keeps the latest record per id without changing effective state', () => {
    appendTombstone(vault, 'a', 'trash', 'dev', '2024-01-01T00:00:00.000Z');
    appendTombstone(vault, 'a', 'restore', 'dev', '2024-01-02T00:00:00.000Z');
    appendTombstone(vault, 'a', 'trash', 'dev', '2024-01-03T00:00:00.000Z');
    appendTombstone(vault, 'b', 'trash', 'dev', '2024-01-01T00:00:00.000Z');

    const before = readTombstones(vault);
    const saved = compactTombstones(vault);

    expect(saved).toBeGreaterThan(0);
    const after = readTombstones(vault);
    expect(after.get('a')).toEqual(before.get('a'));
    expect(after.get('b')).toEqual(before.get('b'));

    const log = fs
      .readFileSync(path.join(vault, '.lychee', 'tombstones', 'dev.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(log).toHaveLength(2);
  });

  it('preserves the cross-device union when compacting', () => {
    appendTombstone(vault, 'x', 'trash', 'dev-a', '2024-01-03T00:00:00.000Z');
    appendTombstone(vault, 'x', 'restore', 'dev-b', '2024-01-02T00:00:00.000Z');
    appendTombstone(vault, 'x', 'trash', 'dev-b', '2024-01-01T00:00:00.000Z');

    compactTombstones(vault);
    // dev-a's newest trash record beats dev-b's older restore.
    expect(readTombstones(vault).get('x')?.action).toBe('trash');
  });

  it('is a no-op on an already-compact log', () => {
    appendTombstone(vault, 'a', 'trash', 'dev', '2024-01-01T00:00:00.000Z');
    expect(compactTombstones(vault)).toBe(0);
  });
});
