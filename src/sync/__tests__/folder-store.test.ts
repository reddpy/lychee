import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendNoteUpdate,
  listDeviceUpdateFiles,
  listNoteIds,
  listUpdateFiles,
  readNoteUpdates,
  readUpdateFile,
  removeNoteUpdates,
  replaceDeviceUpdates,
} from '../folder-store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-folder-store-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('folder-store', () => {
  it('appends immutable updates and reads them back', () => {
    const first = appendNoteUpdate(root, 'doc', 'dev-a', bytes(1, 2));
    const second = appendNoteUpdate(root, 'doc', 'dev-a', bytes(3));

    expect(first).not.toBe(second);
    expect(readNoteUpdates(root, 'doc').map((b) => [...b])).toEqual([[1, 2], [3]]);
  });

  it('never overwrites an existing file', () => {
    const a = appendNoteUpdate(root, 'doc', 'dev-a', bytes(1));
    const b = appendNoteUpdate(root, 'doc', 'dev-a', bytes(2));
    expect(a).not.toBe(b);
    expect(listUpdateFiles(root, 'doc')).toHaveLength(2);
  });

  it('lists note ids with updates', () => {
    appendNoteUpdate(root, 'one', 'dev-a', bytes(1));
    appendNoteUpdate(root, 'two', 'dev-b', bytes(1));
    expect(listNoteIds(root).sort()).toEqual(['one', 'two']);
  });

  it('breaks out a device\u2019s own files', () => {
    appendNoteUpdate(root, 'doc', 'dev-a', bytes(1));
    appendNoteUpdate(root, 'doc', 'dev-b', bytes(2));
    expect(listDeviceUpdateFiles(root, 'doc', 'dev-a')).toHaveLength(1);
    expect(listDeviceUpdateFiles(root, 'doc', 'dev-b')).toHaveLength(1);
  });

  it('replaceDeviceUpdates swaps a device\u2019s files for one snapshot', () => {
    const old = appendNoteUpdate(root, 'doc', 'dev-a', bytes(1));
    appendNoteUpdate(root, 'doc', 'dev-a', bytes(2));
    appendNoteUpdate(root, 'doc', 'dev-b', bytes(9));

    const created = replaceDeviceUpdates(root, 'doc', 'dev-a', bytes(7, 7));
    expect(created).not.toBeNull();

    const aFiles = listDeviceUpdateFiles(root, 'doc', 'dev-a');
    expect(aFiles).toHaveLength(1);
    expect([...readUpdateFile(root, 'doc', aFiles[0]!)]).toEqual([7, 7]);
    expect(listUpdateFiles(root, 'doc').includes(old)).toBe(false);
    // Another device's file is untouched.
    expect(listDeviceUpdateFiles(root, 'doc', 'dev-b')).toHaveLength(1);
  });

  it('replaceDeviceUpdates does nothing when the device has no files', () => {
    expect(replaceDeviceUpdates(root, 'doc', 'dev-a', bytes(1))).toBeNull();
  });

  it('removes a note\u2019s updates', () => {
    appendNoteUpdate(root, 'doc', 'dev-a', bytes(1));
    removeNoteUpdates(root, 'doc');
    expect(readNoteUpdates(root, 'doc')).toEqual([]);
    expect(listNoteIds(root)).toEqual([]);
  });

  it('reads nothing for an unknown note', () => {
    expect(readNoteUpdates(root, 'missing')).toEqual([]);
  });

  it('sanitizes unsafe note ids into a single directory segment', () => {
    appendNoteUpdate(root, '../escape', 'dev-a', bytes(1));
    // The traversal is neutralized: the file lands inside `root`, not above it.
    expect(fs.existsSync(path.join(root, '..', 'escape'))).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['..-escape']);
  });
});
