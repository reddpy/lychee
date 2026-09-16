import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The peer is thin wiring over FolderAdapter + bridge + vault location. Those
 * heavy dependencies (Electron, settings DB, vault path) are mocked so the test
 * can assert the folder machinery end-to-end on a temp directory.
 */
const hoisted = vi.hoisted(() => ({ vault: '', device: 'device-a' }));

vi.mock('electron', () => ({
  app: { getPath: () => hoisted.vault },
  BrowserWindow: { getAllWindows: (): unknown[] => [] },
}));
vi.mock('../vault-location', () => ({ getVaultDirectory: () => hoisted.vault }));
vi.mock('../tombstones', () => ({ getDeviceId: () => hoisted.device }));

import {
  publishVaultCrdt,
  readVaultCrdtUpdates,
  removeVaultCrdt,
  startVaultCrdtPeer,
  stopVaultCrdtPeer,
} from '../vault-crdt-peer';
import { FolderAdapter } from '../../sync/folder-adapter';
import { CRDT_SYNC_DIRECTORY } from '../../sync/folder-store';

function b64(...values: number[]): string {
  return Buffer.from(new Uint8Array(values)).toString('base64');
}

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-vault-crdt-'));
  hoisted.vault = vault;
  hoisted.device = 'device-a';
  startVaultCrdtPeer();
});

afterEach(() => {
  stopVaultCrdtPeer();
  fs.rmSync(vault, { recursive: true, force: true });
});

function syncDir(): string {
  return path.join(vault, CRDT_SYNC_DIRECTORY);
}

describe('vault-crdt-peer', () => {
  it('persists a renderer/published update as a file and reads it back', () => {
    publishVaultCrdt('doc1', b64(1, 2, 3));

    expect(fs.readdirSync(path.join(syncDir(), 'doc1'))).toHaveLength(1);
    expect(readVaultCrdtUpdates('doc1')).toEqual([b64(1, 2, 3)]);
  });

  it('exposes another device\u2019s update for the same note', () => {
    // A second device writing through the shared folder (its own adapter).
    const other = new FolderAdapter(syncDir(), 'device-b');
    other.publish('doc1', new Uint8Array([9]));
    other.close();

    expect(readVaultCrdtUpdates('doc1')).toEqual([b64(9)]);
  });

  it('keeps notes isolated', () => {
    publishVaultCrdt('doc1', b64(1));
    publishVaultCrdt('doc2', b64(2));
    expect(readVaultCrdtUpdates('doc1')).toEqual([b64(1)]);
    expect(readVaultCrdtUpdates('doc2')).toEqual([b64(2)]);
  });

  it('removes a note\u2019s updates on permanent delete', () => {
    publishVaultCrdt('doc1', b64(1));
    removeVaultCrdt('doc1');
    expect(fs.existsSync(path.join(syncDir(), 'doc1'))).toBe(false);
    expect(readVaultCrdtUpdates('doc1')).toEqual([]);
  });

  it('returns nothing when the peer is stopped', () => {
    publishVaultCrdt('doc1', b64(1));
    stopVaultCrdtPeer();
    expect(readVaultCrdtUpdates('doc1')).toEqual([]);
  });
});
