import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type IpcMainEvent } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { IpcContract, IpcChannel } from '../shared/ipc-types';
import { applyChromeToAllWindows, setChromeColors, setOverlayDimmed } from './window-chrome';
import {
  createDocument,
  deleteDocument,
  findDocumentByTitle,
  getDocumentById,
  importDocument,
  listAllDocumentTitles,
  listDocuments,
  listDocumentTree,
  listTrashedDocuments,
  moveDocument,
  permanentDeleteDocument,
  restoreDocument,
  setDocumentMetadata,
  trashDocument,
  updateDocument,
} from './repos/documents';
import { saveImage, getImagePath, getImageDataUrl, deleteImage, downloadImage, readImageBytes } from './repos/images';
import { resolveUrl } from './repos/url-resolver';
import { fetchUrlMetadata } from './repos/url-metadata';
import { getSetting, setSetting, getAllSettings } from './repos/settings';
import {
  getGeneralPreferences,
  resetAllPreferences,
  setGeneralPreferences,
} from './preferences';
import {
  getKeybindings,
  resetAllKeybindings,
  resetKeybinding,
  setKeybinding,
} from './repos/keybindings';
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater';
import { isAllowedExternal } from './url-policy';
import {
  getSpellCheckState,
  setSpellCheckEnabled,
  setSpellCheckLanguages,
} from './spellcheck';
import { createDatabaseBackup } from './db';
import { scanVaultDirectory, writeVaultEntries } from './vault';
import { exportAssetsToVault, importAssetsFromVault } from './assets';
import { buildServerConfig, defaultVaultPath, manualMcpConfig, mcpSetupFields, resolveVaultRoot } from './mcp-config';
import { cleanupImportedArtifacts } from './cleanup';
import { reconcileIndexFromVault } from './vault-index';
import { restoreMetadataFromBackup } from './restore-metadata';
import {
  getVaultSync,
  VAULT_LOCATION_KEY,
  VAULT_WATCH_DIRECTORY_KEY,
  VAULT_WATCH_ENABLED_KEY,
} from './vault-sync';
import { revisionOf } from '../shared/hash';
import { stripLeadingTitle } from '../shared/markdown-title';
import { isDeletedState, tombstoneSupersedes } from '../shared/tombstone';
import { isNonMarkdownFileTitle } from '../shared/vault-watch';
import { readTombstones } from './tombstones';

type Handler<C extends IpcChannel> = (
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']> | IpcContract[C]['res'];

function handle<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (_event, payload: IpcContract[C]['req']) => fn(payload));
}

/** Best-effort write-through: a failed file write must not fail the DB save. */
function writeThrough(id: string, fsync = true, rename = true): void {
  try {
    // `guard: true` — never clobber a file another writer (MCP/sync/external
    // editor) changed since our last export; the watcher resolves the divergence.
    getVaultSync().writeNoteToVault(id, fsync, rename, true);
  } catch (error) {
    console.error('Vault write-through failed:', error);
  }
}

export function registerIpcHandlers(options: { onKeybindingsChanged?: () => void } = {}) {
  handle('documents.list', (payload) => ({
    documents: listDocuments(payload),
  }));

  handle('documents.get', (payload) => ({
    document: getDocumentById(payload.id),
  }));

  handle('documents.create', (payload) => {
    if (typeof payload?.title === 'string' && payload.title.trim() && findDocumentByTitle(payload.title)) {
      throw new Error('Duplicate title');
    }
    const document = createDocument(payload);
    writeThrough(document.id);
    // Creating shifts existing siblings down; rewrite them so the files agree.
    getVaultSync().rebalanceSiblings(document.parentId, [document.id]);
    getVaultSync().sweepPaths();
    return { document };
  });

  handle('documents.update', (payload) => {
    if (!payload.id) throw new Error('Missing required field: id');
    if (typeof payload.title === 'string' && payload.title.trim()) {
      if (findDocumentByTitle(payload.title, payload.id)) throw new Error('Duplicate title');
    }
    const hasFieldChanges =
      payload.title !== undefined ||
      payload.content !== undefined ||
      payload.emoji !== undefined ||
      payload.parentId !== undefined ||
      payload.metadata !== undefined;
    if (!hasFieldChanges) {
      // Rename-only commit from a flush: move the file, don't rewrite it.
      getVaultSync().commitNote(payload.id);
      return { document: getDocumentById(payload.id) };
    }
    const document = updateDocument(payload.id, payload);
    if (document) writeThrough(document.id, payload.flush !== false, payload.rename !== false);
    return { document };
  });

  handle('documents.delete', (payload) => {
    deleteDocument(payload.id);
    return { ok: true };
  });

  handle('documents.trash', (payload) => {
    const result = trashDocument(payload.id);
    getVaultSync().trashNoteFiles(result.trashedIds);
    // Trashing closes the gap in the old parent; keep the siblings' files dense.
    getVaultSync().rebalanceSiblings(result.document.parentId);
    getVaultSync().sweepPaths();
    getVaultSync().recordTombstones(result.trashedIds, 'trash');
    return result;
  });

  handle('documents.restore', (payload) => {
    const result = restoreDocument(payload.id);
    getVaultSync().restoreNoteFiles(result.restoredIds);
    // Force-rewrite restored notes: if their file is gone (deleted from .trash,
    // or lost with the vault), recreate it so a live note always has a file.
    getVaultSync().sweepPaths(false, result.restoredIds);
    // Restoring shifts siblings at the insertion point; keep their files dense.
    getVaultSync().rebalanceSiblings(result.document.parentId, result.restoredIds);
    getVaultSync().recordTombstones(result.restoredIds, 'restore');
    return result;
  });

  handle('documents.listTrashed', (payload) => ({
    documents: listTrashedDocuments(payload),
  }));

  handle('documents.permanentDelete', (payload) => {
    const { deletedIds, deletedPaths } = permanentDeleteDocument(payload.id);
    getVaultSync().purgeNoteFiles(deletedPaths);
    getVaultSync().sweepPaths();
    getVaultSync().recordTombstones(deletedIds, 'purge');
    return { deletedIds };
  });

  handle('documents.move', (payload) => {
    if (payload.sortOrder < 0) throw new Error('sortOrder must be non-negative');
    if (!Number.isInteger(payload.sortOrder)) throw new Error('sortOrder must be an integer');
    const before = getDocumentById(payload.id);
    const document = moveDocument(payload.id, payload.parentId, payload.sortOrder);
    const sync = getVaultSync();
    sync.invalidatePaths();
    // A move/reorder shifts sibling sort orders (and may change parents), so
    // rewrite the moved note and every sibling in the old and new parent.
    const parents = new Set<string | null>([before?.parentId ?? null, document.parentId]);
    const affected = new Set<string>([document.id]);
    try {
      for (const node of listDocumentTree()) {
        if (parents.has(node.parentId)) affected.add(node.id);
      }
    } catch {
      // Best-effort: sibling rewrite is an optimization, not correctness-critical.
    }
    sync.rewriteNotes([...affected]);
    sync.sweepPaths();
    // A move/reorder from outside the UI (agent/MCP/script) must refresh the
    // renderer; the in-app drag path also reloads, which is harmless.
    sync.notifyChanged();
    return { document };
  });

  handle('shell.openExternal', async (payload) => {
    if (!isAllowedExternal(payload.url)) {
      const scheme = payload.url.split(':')[0]?.toLowerCase();
      throw new Error(`Blocked URL scheme: ${scheme}`);
    }
    await shell.openExternal(payload.url);
    return { ok: true };
  });

  handle('data.getLocations', () => {
    const userDataPath = app.getPath('userData');
    return {
      userDataPath,
      databasePath: path.join(userDataPath, 'lychee.sqlite3'),
      imagesPath: path.join(userDataPath, 'images'),
    };
  });

  handle('data.openFolder', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
    return { ok: true };
  });

  handle('data.revealDatabase', () => {
    shell.showItemInFolder(path.join(app.getPath('userData'), 'lychee.sqlite3'));
    return { ok: true };
  });

  handle('data.createBackup', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Create Lychee Backup',
      defaultPath: path.join(
        app.getPath('documents'),
        `lychee-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      ),
      filters: [{ name: 'SQLite database', extensions: ['sqlite3'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };

    createDatabaseBackup(result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  handle('vault.chooseDirectory', async (payload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title:
        payload?.purpose === 'import'
          ? 'Import Notes from Markdown'
          : payload?.purpose === 'watch'
            ? 'Choose a Folder to Watch'
            : 'Export Notes as Markdown',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { canceled: false, directory: result.filePaths[0] };
  });

  handle('vault.writeEntries', (payload) => {
    if (!payload || typeof payload.directory !== 'string' || payload.directory.length === 0) {
      throw new Error('Missing required field: directory');
    }
    if (!Array.isArray(payload.entries)) {
      throw new Error('entries must be an array');
    }
    for (const entry of payload.entries) {
      if (
        !entry ||
        typeof entry.relativePath !== 'string' ||
        typeof entry.contents !== 'string'
      ) {
        throw new Error('each entry requires string relativePath and contents');
      }
    }
    // Never write into a shared folder's root: use a dedicated `Lychee/`
    // subfolder unless the chosen folder is already one.
    const root = resolveVaultRoot(payload.directory);

    // Remember where the vault lives so the AI (MCP) config can reference the
    // explicit path even when watching is not enabled.
    setSetting(VAULT_LOCATION_KEY, root);

    // Rewrite local image tokens to portable `assets/<hash>.<ext>` paths,
    // copying the bytes into the vault.
    const entries = payload.entries.map((entry) => ({
      ...entry,
      contents: exportAssetsToVault(root, entry.contents),
    }));
    const written = writeVaultEntries(root, entries);

    // Record write baselines so the watcher can tell our writes from external
    // edits and does not echo them back.
    const vaultSync = getVaultSync();
    for (const entry of entries) {
      if (!entry.noteId) continue;
      const note = getDocumentById(entry.noteId);
      const fileRevision = revisionOf(entry.contents);
      setDocumentMetadata(entry.noteId, {
        vaultFileRevision: fileRevision,
        vaultContentRevision: note ? revisionOf(note.content) : '',
      });
      vaultSync.suppress(entry.relativePath, fileRevision);
    }

    return { written };
  });

  handle('vault.watchStart', (payload) => {
    if (!payload || typeof payload.directory !== 'string' || payload.directory.length === 0) {
      throw new Error('Missing required field: directory');
    }
    const root = resolveVaultRoot(payload.directory);
    getVaultSync().start(root);
    setSetting(VAULT_WATCH_DIRECTORY_KEY, root);
    setSetting(VAULT_LOCATION_KEY, root);
    setSetting(VAULT_WATCH_ENABLED_KEY, 'true');
    return { ok: true };
  });

  handle('vault.watchStop', () => {
    getVaultSync().stop();
    setSetting(VAULT_WATCH_ENABLED_KEY, 'false');
    return { ok: true };
  });

  handle('vault.watchStatus', () => getVaultSync().status());

  handle('vault.resolveExternalChange', (payload) => {
    getVaultSync().resolve(payload);
    return { ok: true };
  });

  handle('vault.mcpConfig', () => {
    const storedRaw =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? '';
    // Normalize a previously-stored shared folder (e.g. ~/Downloads) to the
    // dedicated Lychee subfolder, and treat "not created yet" as unset so the UI
    // offers setup instead of pointing the MCP server at a missing folder.
    const configured = storedRaw ? resolveVaultRoot(storedRaw) : '';
    const vaultPath = configured && fs.existsSync(configured) ? configured : '';
    const fallback = defaultVaultPath();
    const effectiveVault = vaultPath || fallback;
    const config = buildServerConfig(effectiveVault);
    const importedCount = listAllDocumentTitles().filter((row) =>
      isNonMarkdownFileTitle(row.title),
    ).length;
    return {
      serverPath: config.args[0],
      vaultPath,
      defaultVaultPath: fallback,
      command: config.command,
      args: config.args,
      env: config.env ?? {},
      config: manualMcpConfig(effectiveVault),
      setup: mcpSetupFields(effectiveVault),
      importedCount,
    };
  });

  handle('vault.cleanupImportedNotes', () => {
    let removed = 0;
    for (const { id, title } of listAllDocumentTitles()) {
      if (!isNonMarkdownFileTitle(title)) continue;
      try {
        trashDocument(id);
        removed += 1;
      } catch {
        // A concurrent structural change must not abort the cleanup.
      }
    }
    return { removed };
  });

  handle('vault.bootstrap', () => {
    cleanupImportedArtifacts();
    const metadataRestored = restoreMetadataFromBackup();
    const stored =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? '';
    const directory = stored ? resolveVaultRoot(stored) : defaultVaultPath();
    fs.mkdirSync(directory, { recursive: true });
    setSetting(VAULT_LOCATION_KEY, directory);
    // Watching is the default; only an explicit opt-out disables it.
    const watchEnabled = getSetting(VAULT_WATCH_ENABLED_KEY) !== 'false';
    // Files are authoritative for metadata/hierarchy; rebuild the index from
    // them. New files are ingested only while watching is enabled, so the
    // opt-out is respected even on an empty database.
    reconcileIndexFromVault(directory, { importNew: watchEnabled });
    // Only now is the index authoritative: let the watcher apply events (any
    // that arrived during startup were queued and are re-read here).
    getVaultSync().markReconciled();
    const hasFiles = scanVaultDirectory(directory).entries.length > 0;
    const hasDbNotes = listAllDocumentTitles().length > 0;
    return {
      directory,
      needsExport: !hasFiles && hasDbNotes,
      needsRefresh: metadataRestored,
      watchEnabled,
    };
  });

  handle('vault.rebuildIndex', () => {
    // Explicit user action: always ingest files, regardless of the watch opt-out.
    const stored =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? '';
    const directory = stored ? resolveVaultRoot(stored) : defaultVaultPath();
    if (!directory) return { scanned: 0, imported: 0, updated: 0 };
    const { updated, imported } = reconcileIndexFromVault(directory, { importNew: true });
    getVaultSync().invalidatePaths();
    getVaultSync().markReconciled();
    // Multi-window model: main owns the database and the vault; every window is
    // a view. Broadcast so all open windows reload their sidebar/tabs.
    getVaultSync().notifyChanged();
    return { scanned: scanVaultDirectory(directory).entries.length, imported, updated };
  });

  handle('vault.location', () => {
    const stored =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? '';
    const directory = stored ? resolveVaultRoot(stored) : defaultVaultPath();
    fs.mkdirSync(directory, { recursive: true });
    setSetting(VAULT_LOCATION_KEY, directory);
    return { directory };
  });

  handle('vault.openFolder', async () => {
    const stored =
      getSetting(VAULT_LOCATION_KEY) ?? getSetting(VAULT_WATCH_DIRECTORY_KEY) ?? '';
    const directory = stored ? resolveVaultRoot(stored) : defaultVaultPath();
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    return { ok: true };
  });

  handle('clipboard.writeText', (payload) => {
    if (typeof payload.text !== 'string') throw new Error('text must be a string');
    clipboard.writeText(payload.text);
    return { ok: true };
  });

  handle('vault.scanDirectory', (payload) => {
    if (!payload || typeof payload.directory !== 'string' || payload.directory.length === 0) {
      throw new Error('Missing required field: directory');
    }
    const root = resolveVaultRoot(payload.directory);
    const result = scanVaultDirectory(root);
    // Resolve `assets/<hash>` links to local images before the renderer converts
    // the markdown into editor content.
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        ...entry,
        body: importAssetsFromVault(root, entry.body),
      })),
    };
  });

  handle('vault.importDocuments', (payload) => {
    if (!payload || !Array.isArray(payload.documents)) {
      throw new Error('documents must be an array');
    }
    // Respect tombstones: a note deleted on another device must not be
    // resurrected by importing the folder.
    const tombstones =
      typeof payload.directory === 'string' && payload.directory.length > 0
        ? readTombstones(resolveVaultRoot(payload.directory))
        : new Map();
    let created = 0;
    let skipped = 0;
    for (const document of payload.documents) {
      if (
        !document ||
        typeof document.title !== 'string' ||
        typeof document.content !== 'string'
      ) {
        throw new Error('each document requires string title and content');
      }
      if (document.id) {
        const state = tombstones.get(document.id);
        if (state && isDeletedState(state) && tombstoneSupersedes(state, document.updatedAt)) {
          skipped += 1;
          continue;
        }
      }
      const id = typeof document.id === 'string' && document.id.length > 0 ? document.id : randomUUID();
      const metadata: {
        contentSchemaVersion?: number;
        bookmarkedAt?: string | null;
      } = {};
      if (typeof document.contentSchemaVersion === 'number') {
        metadata.contentSchemaVersion = document.contentSchemaVersion;
      }
      if (document.bookmarkedAt) metadata.bookmarkedAt = document.bookmarkedAt;
      const result = importDocument({
        id,
        title: document.title,
        content: stripLeadingTitle(
          importAssetsFromVault(payload.directory, document.content),
          document.title,
        ),
        parentId: document.parentId ?? null,
        emoji: document.emoji ?? null,
        sortOrder: document.sortOrder ?? 0,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      if (result.created) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  });

  handle('images.save', (payload) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(payload.mimeType)) {
      throw new Error(`Unsupported image type: ${payload.mimeType}`);
    }
    return saveImage(payload.data, payload.mimeType);
  });

  handle('images.getPath', (payload) => getImagePath(payload.id));

  handle('images.download', (payload) => {
    const scheme = payload.url.split(':')[0]?.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw new Error(`Blocked URL scheme for image download: ${scheme}`);
    }
    return downloadImage(payload.url);
  });

  handle('images.delete', (payload) => {
    deleteImage(payload.id);
    return { ok: true };
  });

  handle('images.saveAs', async (payload) => {
    const { buffer, mimeType, filename } = readImageBytes(payload.id);
    const ext = path.extname(filename).replace(/^\./, '') || 'png';
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Save Image',
      defaultPath: path.join(app.getPath('downloads'), filename),
      filters: [{ name: mimeType, extensions: [ext] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };

    fs.writeFileSync(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath };
  });

  handle('clipboard.writeImage', (payload) => {
    const { buffer } = readImageBytes(payload.id);
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      throw new Error(`Could not decode image: ${payload.id}`);
    }
    clipboard.writeImage(image);
    return { ok: true };
  });

  handle('url.resolve', (payload) => resolveUrl(payload.url));

  handle('url.fetchMetadata', (payload) => fetchUrlMetadata(payload.url));

  handle('settings.get', (payload) => ({
    value: getSetting(payload.key),
  }));

  handle('settings.set', (payload) => {
    setSetting(payload.key, payload.value);
    return { ok: true };
  });

  handle('settings.getAll', () => ({
    settings: getAllSettings(),
  }));

  const broadcastPreferences = (preferences: ReturnType<typeof getGeneralPreferences>) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send('preferences:changed', preferences);
    }
    return preferences;
  };

  handle('preferences.getGeneral', () => getGeneralPreferences());

  handle('preferences.setGeneral', (payload) =>
    broadcastPreferences(setGeneralPreferences(payload)),
  );

  handle('preferences.resetAll', () => {
    resetAllPreferences();
    broadcastPreferences(getGeneralPreferences());
    options.onKeybindingsChanged?.();
    const bindings = getKeybindings();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send('keybindings:changed', bindings);
    }
    return { ok: true };
  });

  const publishKeybindings = (bindings: ReturnType<typeof getKeybindings>) => {
    options.onKeybindingsChanged?.();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('keybindings:changed', bindings);
    }
    return { bindings };
  };

  handle('keybindings.getAll', () => ({ bindings: getKeybindings() }));
  handle('keybindings.set', (payload) =>
    publishKeybindings(setKeybinding(payload.id, payload.binding)),
  );
  handle('keybindings.reset', (payload) =>
    publishKeybindings(resetKeybinding(payload.id)),
  );
  handle('keybindings.resetAll', () =>
    publishKeybindings(resetAllKeybindings()),
  );

  handle('spellcheck.getState', () => getSpellCheckState());

  handle('spellcheck.setEnabled', (payload) =>
    setSpellCheckEnabled(payload.enabled),
  );

  handle('spellcheck.setLanguages', (payload) =>
    setSpellCheckLanguages(payload.languages),
  );

  handle('window.action', (payload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    switch (payload.action) {
      case 'minimize':
        win?.minimize();
        break;
      case 'close':
        win?.close();
        break;
      case 'toggleFullscreen':
        if (win) win.setFullScreen(!win.isFullScreen());
        break;
      case 'reload':
        win?.webContents.reload();
        break;
      case 'forceReload':
        win?.webContents.reloadIgnoringCache();
        break;
      case 'toggleDevTools':
        win?.webContents.toggleDevTools();
        break;
      case 'zoomIn':
        if (win) win.webContents.zoomLevel = win.webContents.zoomLevel + 0.5;
        break;
      case 'zoomOut':
        if (win) win.webContents.zoomLevel = win.webContents.zoomLevel - 0.5;
        break;
      case 'resetZoom':
        if (win) win.webContents.zoomLevel = 0;
        break;
      case 'quit':
        app.quit();
        break;
    }
    return { ok: true };
  });

  handle('app.updateChrome', (payload) => {
    setChromeColors(payload.resolvedTheme, {
      color: payload.color,
      symbolColor: payload.symbolColor,
    });
    applyChromeToAllWindows(payload.resolvedTheme);
    return { ok: true };
  });

  handle('app.setOverlayDimmed', (payload) => {
    setOverlayDimmed(payload.dimmed);
    return { ok: true };
  });

  handle('update.getStatus', () => getUpdateStatus());

  handle('update.check', () => {
    checkForUpdates();
    return { ok: true };
  });

  handle('update.install', () => {
    installUpdate();
    return { ok: true };
  });
}

export const IMAGE_DATA_URL_SYNC_CHANNEL = 'images.getDataUrlSync';

type ImageDataUrlSyncResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

/**
 * Register the one synchronous bridge needed by clipboard serialization.
 * ClipboardEvent.clipboardData can only be populated during the copy event, so
 * an async ipcRenderer.invoke() would resolve too late for the browser to accept
 * the HTML. Keep this separate from the regular typed invoke contract so sync
 * IPC does not spread to application features that do not require it.
 */
export function registerClipboardIpcHandler(): void {
  ipcMain.on(
    IMAGE_DATA_URL_SYNC_CHANNEL,
    (event: IpcMainEvent, payload: { id?: unknown } | undefined) => {
      let result: ImageDataUrlSyncResult;
      try {
        if (typeof payload?.id !== 'string' || payload.id.length === 0) {
          throw new Error('Missing required field: id');
        }
        result = { ok: true, ...getImageDataUrl(payload.id) };
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read image',
        };
      }
      event.returnValue = result;
    },
  );
}
