import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTombstones, appendTombstone } from '../tombstones';

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-tombstones-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('tombstones', () => {
  it('reads an empty map when no logs exist', () => {
    expect(readTombstones(vault).size).toBe(0);
  });

  it('appends and reads back a tombstone', () => {
    appendTombstone(vault, 'note-1', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    const states = readTombstones(vault);
    expect(states.get('note-1')).toEqual({
      action: 'trash',
      at: '2026-01-01T00:00:00.000Z',
      device: 'device-a',
    });
  });

  it('union-merges multiple device logs', () => {
    appendTombstone(vault, 'a', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    appendTombstone(vault, 'b', 'purge', 'device-b', '2026-01-01T00:00:00.000Z');
    const states = readTombstones(vault);
    expect(states.get('a')?.action).toBe('trash');
    expect(states.get('b')?.action).toBe('purge');
  });

  it('a later restore from another device wins', () => {
    appendTombstone(vault, 'a', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    appendTombstone(vault, 'a', 'restore', 'device-b', '2026-02-01T00:00:00.000Z');
    expect(readTombstones(vault).get('a')?.action).toBe('restore');
  });

  it('appends without rewriting prior lines', () => {
    appendTombstone(vault, 'a', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    appendTombstone(vault, 'b', 'trash', 'device-a', '2026-01-02T00:00:00.000Z');
    const file = path.join(vault, '.lychee', 'tombstones', 'device-a.jsonl');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
  });
});
