import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { serializeFrontmatter } from '../../shared/frontmatter';
import { isDeletedState, isPurged, tombstoneSupersedes } from '../../shared/tombstone';
import { appendTombstone, readTombstones } from '../tombstone-io';
import {
  contentRevision,
  scanVaultDirectory,
  writeVaultEntryGuarded,
  writeVaultFile,
} from '../vault';
import { appendNoteUpdate, readNoteUpdates } from '../../sync/folder-store';

/**
 * Cross-device RECONCILE: a device facing a shared folder that contains note
 * files, CRDT update files, and tombstones written by other devices. These are
 * the decisions the app makes when it opens a vault another machine touched.
 */

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-xdevice-reconcile-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function noteFile(id: string, title: string, body = '') {
  const frontmatter = serializeFrontmatter({
    id,
    title,
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-02T00:00:00.000Z',
    contentSchemaVersion: 1,
  });
  return `${frontmatter}\n${body}`;
}

describe('cross-device reconcile — discovery and deletes', () => {
  it('device B discovers a note created on device A', () => {
    writeVaultFile(vault, 'Notes/Hello.md', noteFile('note-hello', 'Hello', 'body'));

    const { entries } = scanVaultDirectory(vault);
    const found = entries.find((entry) => entry.relativePath === 'Notes/Hello.md');
    expect(found).toBeDefined();
    expect(found?.id).toBe('note-hello');
    expect(found?.title).toBe('Hello');
  });

  it('a note trashed on device A is suppressed on device B (even if a stale file lingers)', () => {
    // A trashed it, and B still has the old file from a pre-delete sync.
    writeVaultFile(vault, 'Gone.md', noteFile('gone', 'Gone', 'stale body'));
    appendTombstone(vault, 'gone', 'trash', 'device-a', '2026-02-01T00:00:00.000Z');

    const state = readTombstones(vault).get('gone');
    expect(state).toBeDefined();
    expect(isDeletedState(state)).toBe(true);
    // The stale file (older `updated`) must not resurrect the note.
    expect(tombstoneSupersedes(state!, '2024-01-02T00:00:00.000Z')).toBe(true);
  });

  it('an edit made after an unseen delete wins over the tombstone', () => {
    appendTombstone(vault, 'edited', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    const state = readTombstones(vault).get('edited')!;
    // Device B edited on 2026-02-01 without seeing the delete.
    expect(tombstoneSupersedes(state, '2026-02-01T00:00:00.000Z')).toBe(false);
  });

  it('a restore from another device un-trashes the note', () => {
    appendTombstone(vault, 'a', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    appendTombstone(vault, 'a', 'restore', 'device-b', '2026-01-02T00:00:00.000Z');
    const state = readTombstones(vault).get('a')!;
    expect(state.action).toBe('restore');
    expect(isDeletedState(state)).toBe(false);
  });

  it('a purge is permanent', () => {
    appendTombstone(vault, 'secret', 'purge', 'device-a', '2026-01-01T00:00:00.000Z');
    expect(isPurged(readTombstones(vault).get('secret'))).toBe(true);
  });

  it('two devices append concurrently without rewriting each other\u2019s logs', () => {
    appendTombstone(vault, 'x', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    appendTombstone(vault, 'y', 'trash', 'device-b', '2026-01-01T00:00:00.000Z');

    const dir = path.join(vault, '.lychee', 'tombstones');
    expect(fs.readFileSync(path.join(dir, 'device-a.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'device-b.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    const states = readTombstones(vault);
    expect(states.get('x')?.device).toBe('device-a');
    expect(states.get('y')?.device).toBe('device-b');
  });
});

describe('cross-device reconcile — concurrent writes', () => {
  it('a stale export becomes a conflict copy; both versions survive', () => {
    writeVaultFile(vault, 'Shared.md', noteFile('shared', 'Shared', 'v1'));
    const v1Revision = contentRevision(fs.readFileSync(path.join(vault, 'Shared.md'), 'utf8'));

    // Another device overwrote it while we were offline.
    writeVaultFile(vault, 'Shared.md', noteFile('shared', 'Shared', 'v2-improved'));

    // Our stale export must not clobber it.
    const result = writeVaultEntryGuarded(
      vault,
      { relativePath: 'Shared.md', contents: noteFile('shared', 'Shared', 'v1'), noteId: 'shared' },
      v1Revision,
      '2026-03-01T10-00-00',
    );
    expect(result.status).toBe('conflict');
    if (result.status !== 'conflict') return;
    expect(result.conflictPath).toMatch(/\(conflict /);

    // Canonical keeps the remote edit; the conflict copy keeps ours.
    expect(fs.readFileSync(path.join(vault, 'Shared.md'), 'utf8')).toContain('v2-improved');
    expect(fs.readFileSync(path.join(vault, result.conflictPath), 'utf8')).toContain('v1');
  });
});

describe('cross-device reconcile — the three stores coexist', () => {
  it('note files, CRDT updates, and tombstones live side by side', () => {
    // Device A created a note and its CRDT state, then trashed it.
    writeVaultFile(vault, 'Bird.md', noteFile('bird', 'Bird', 'body'));
    appendNoteUpdate(vault, 'bird', 'device-a', new Uint8Array([1, 2, 3]));
    appendTombstone(vault, 'bird', 'trash', 'device-a', '2026-05-01T00:00:00.000Z');

    // A second device can read all three independently.
    const { entries } = scanVaultDirectory(vault);
    expect(entries.map((entry) => entry.id)).toContain('bird');
    // The markdown scanner ignores the dot-directories, so CRDT/tombstones
    // never masquerade as notes.
    expect(entries.every((entry) => !entry.relativePath.includes('.lychee'))).toBe(true);

    expect(readNoteUpdates(vault, 'bird')).toHaveLength(1);
    expect(readTombstones(vault).get('bird')?.action).toBe('trash');
  });
});
