import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * End-to-end inversion at the IPC boundary: register the REAL handlers (no repo
 * mocks), point the vault at a temp dir, and assert that `documents.create` /
 * `documents.update` produce files on disk and a matching index row.
 */

let tmpDir: string;
const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpDir),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getLocale: () => 'en-US',
    getAppPath: () => '/tmp/lychee-app',
    setLoginItemSettings: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true })),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: (): null => null,
    getAllWindows: (): unknown[] => [],
  },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  session: {
    defaultSession: {
      availableSpellCheckerLanguages: [],
      setSpellCheckerLanguages: vi.fn(),
      setSpellCheckerEnabled: vi.fn(),
    },
  },
}));

vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { createTestDb, closeTestDb } from '../helpers';
import { registerIpcHandlers } from '../../ipc';
import { setSetting } from '../../repos/settings';
import { VAULT_LOCATION_KEY } from '../../vault-sync';
import { getActiveVault, setActiveVault } from '../../note-service';
import { getDocumentById, listDocuments } from '../../repos/documents';
import { resolveVaultRoot } from '../../mcp-config';
import { parseFrontmatter } from '../../../shared/frontmatter';

let vaultRoot: string;

async function invoke<T = any>(channel: string, payload: unknown): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return (await handler(null, payload)) as T;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-ipc-inversion-'));
  vaultRoot = resolveVaultRoot(tmpDir);
  fs.mkdirSync(vaultRoot, { recursive: true });
  createTestDb();
  setSetting(VAULT_LOCATION_KEY, vaultRoot);
  setActiveVault(vaultRoot);
  handlers.clear();
  registerIpcHandlers();
});

afterEach(() => {
  setActiveVault(null);
  closeTestDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('IPC write path — file-first via the service', () => {
  it('documents.create writes the file and returns the indexed row', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', {
      title: 'IPC Note',
    });

    expect(fs.existsSync(path.join(vaultRoot, 'IPC Note.md'))).toBe(true);
    const row = getDocumentById(document.id)!;
    expect(row.title).toBe('IPC Note');
    expect(row.metadata.vaultRelativePath).toBe('IPC Note.md');
    expect(parseFrontmatter(fs.readFileSync(path.join(vaultRoot, 'IPC Note.md'), 'utf8')).data.id).toBe(
      document.id,
    );
  });

  it('documents.update writes content to disk first', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', { title: 'Edit' });
    await invoke('documents.update', { id: document.id, content: 'changed by IPC' });

    expect(fs.readFileSync(path.join(vaultRoot, 'Edit.md'), 'utf8')).toContain('changed by IPC');
    expect(getDocumentById(document.id)!.content).toBe('changed by IPC');
  });

  it('documents.update renames the file on a title commit', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', { title: 'Before' });
    await invoke('documents.update', {
      id: document.id,
      title: 'After',
      rename: true,
      flush: true,
    });

    expect(fs.existsSync(path.join(vaultRoot, 'After.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Before.md'))).toBe(false);
    expect(getDocumentById(document.id)!.title).toBe('After');
  });

  it('documents.create rejects a duplicate title without writing a file', async () => {
    await invoke('documents.create', { title: 'Unique' });
    await expect(invoke('documents.create', { title: 'unique' })).rejects.toThrow(
      'Duplicate title',
    );
    expect(fs.readdirSync(vaultRoot).filter((name) => name.endsWith('.md'))).toHaveLength(1);
  });

  it('vault.bootstrap activates the vault so subsequent writes are file-first', async () => {
    // Simulate a cold start: no active vault yet, location already known.
    setActiveVault(null);
    const result = await invoke<{ directory: string }>('vault.bootstrap', undefined);
    expect(result.directory).toBe(vaultRoot);
    expect(getActiveVault()).toBe(vaultRoot);

    const { document } = await invoke<{ document: any }>('documents.create', {
      title: 'Cold Start',
    });
    expect(fs.existsSync(path.join(vaultRoot, 'Cold Start.md'))).toBe(true);
    expect(listDocuments({ limit: 10 }).some((row) => row.id === document.id)).toBe(true);
  });

  it('nested create through IPC lands in the parent folder', async () => {
    const { document: parent } = await invoke<{ document: any }>('documents.create', {
      title: 'Parent',
    });
    const { document: child } = await invoke<{ document: any }>('documents.create', {
      title: 'Child',
      parentId: parent.id,
    });

    expect(fs.existsSync(path.join(vaultRoot, 'Parent', 'Child.md'))).toBe(true);
    expect(getDocumentById(child.id)!.parentId).toBe(parent.id);
  });
});

describe('IPC write path — structural operations (file-first)', () => {
  it('documents.move moves the file into the parent folder', async () => {
    const { document: parent } = await invoke<{ document: any }>('documents.create', {
      title: 'Folder',
    });
    const { document: child } = await invoke<{ document: any }>('documents.create', {
      title: 'Leaf',
    });

    await invoke('documents.move', { id: child.id, parentId: parent.id, sortOrder: 0 });

    expect(fs.existsSync(path.join(vaultRoot, 'Folder', 'Leaf.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Leaf.md'))).toBe(false);
    expect(getDocumentById(child.id)!.parentId).toBe(parent.id);
  });

  it('documents.trash moves the file to .trash and removes it from the list', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', { title: 'Kill' });
    await invoke('documents.trash', { id: document.id });

    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Kill.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Kill.md'))).toBe(false);
    expect(getDocumentById(document.id)!.deletedAt).toBeTruthy();
  });

  it('documents.restore returns the file to the vault', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', {
      title: 'Bring Back',
    });
    await invoke('documents.trash', { id: document.id });
    await invoke('documents.restore', { id: document.id });

    expect(fs.existsSync(path.join(vaultRoot, 'Bring Back.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Bring Back.md'))).toBe(false);
    expect(getDocumentById(document.id)!.deletedAt).toBeNull();
  });

  it('documents.permanentDelete removes the trashed file and the row', async () => {
    const { document } = await invoke<{ document: any }>('documents.create', { title: 'Gone' });
    await invoke('documents.trash', { id: document.id });

    await invoke('documents.permanentDelete', { id: document.id });

    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Gone.md'))).toBe(false);
    expect(getDocumentById(document.id)).toBeNull();
  });
});
