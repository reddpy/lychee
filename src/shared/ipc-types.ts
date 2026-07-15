import type { DocumentRow, NoteMetadata } from './documents';

// ── URL resolution types ─────────────────────────────────────────────

export type ResolvedUrlResult =
  | { type: 'image'; id: string; filePath: string; sourceUrl: string }
  | { type: 'bookmark'; url: string; title: string; description: string; imageUrl: string; faviconUrl: string }
  | { type: 'unsupported'; url: string; reason: string };

export type UrlMetadataResult = {
  title: string;
  description: string;
  imageUrl: string;
  faviconUrl: string;
  url: string;
};

// ── Auto-update types ────────────────────────────────────────────────

// Single source of truth for update UI. `state` drives both the red-dot
// indicator (shown for 'available' | 'ready') and the About-pane status line.
//
// Platform split:
//   mac/win  — Electron's autoUpdater downloads in the background, so the
//              actionable terminal state is 'ready' (downloaded; restart to
//              apply). 'available' is never emitted here.
//   linux    — autoUpdater is unsupported; we poll GitHub releases instead, so
//              the actionable state is 'available' (open releases page to grab
//              the new .deb/.rpm). 'downloading'/'ready' are never emitted.
//   dev/E2E/unpackaged — 'unsupported' (the feature is inert).
export type UpdateState =
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'available'
  | 'error';

export type UpdateStatus = {
  state: UpdateState;
  currentVersion: string;
  // Set once a newer release is known (releaseName on mac/win, tag on linux).
  newVersion?: string;
  // GitHub releases page — the Linux "Download" target and error fallback.
  releaseUrl: string;
};

export type SpellCheckState = {
  enabled: boolean;
  canChooseLanguages: boolean;
  languages: string[];
  availableLanguages: string[];
};

export type DataLocations = {
  userDataPath: string;
  databasePath: string;
  imagesPath: string;
};

// ── IPC contract ─────────────────────────────────────────────────────

export type IpcContract = {
  'documents.list': {
    req: { limit?: number; offset?: number };
    res: { documents: DocumentRow[] };
  };
  'documents.get': {
    req: { id: string };
    res: { document: DocumentRow | null };
  };
  'documents.create': {
    req: {
      title?: string;
      content?: string;
      parentId?: string | null;
      emoji?: string | null;
    };
    res: { document: DocumentRow };
  };
  'documents.update': {
    req: {
      id: string;
      title?: string;
      content?: string;
      parentId?: string | null;
      emoji?: string | null;
      metadata?: Partial<NoteMetadata>;
    };
    res: { document: DocumentRow };
  };
  'documents.delete': {
    req: { id: string };
    res: { ok: true };
  };
  'documents.trash': {
    req: { id: string };
    res: { document: DocumentRow; trashedIds: string[] };
  };
  'documents.restore': {
    req: { id: string };
    res: { document: DocumentRow; restoredIds: string[] };
  };
  'documents.listTrashed': {
    req: { limit?: number; offset?: number };
    res: { documents: DocumentRow[] };
  };
  'documents.permanentDelete': {
    req: { id: string };
    res: { deletedIds: string[] };
  };
  'documents.move': {
    req: { id: string; parentId: string | null; sortOrder: number };
    res: { document: DocumentRow };
  };
  'shell.openExternal': {
    req: { url: string };
    res: { ok: true };
  };
  'data.getLocations': {
    req: Record<string, never>;
    res: DataLocations;
  };
  'data.openFolder': {
    req: Record<string, never>;
    res: { ok: true };
  };
  'data.revealDatabase': {
    req: Record<string, never>;
    res: { ok: true };
  };
  'data.createBackup': {
    req: Record<string, never>;
    res:
      | { canceled: true }
      | { canceled: false; filePath: string };
  };
  'images.save': {
    req: { data: string; mimeType: string };
    res: { id: string; filePath: string };
  };
  'images.getPath': {
    req: { id: string };
    res: { filePath: string };
  };
  'images.download': {
    req: { url: string };
    res: { id: string; filePath: string };
  };
  'images.delete': {
    req: { id: string };
    res: { ok: true };
  };
  'url.resolve': {
    req: { url: string };
    res: ResolvedUrlResult;
  };
  'url.fetchMetadata': {
    req: { url: string };
    res: UrlMetadataResult;
  };
  'settings.get': {
    req: { key: string };
    res: { value: string | null };
  };
  'settings.set': {
    req: { key: string; value: string };
    res: { ok: true };
  };
  'settings.getAll': {
    req: Record<string, never>;
    res: { settings: Record<string, string> };
  };
  'spellcheck.getState': {
    req: Record<string, never>;
    res: SpellCheckState;
  };
  'spellcheck.setEnabled': {
    req: { enabled: boolean };
    res: SpellCheckState;
  };
  'spellcheck.setLanguages': {
    req: { languages: string[] };
    res: SpellCheckState;
  };
  'window.action': {
    req: { action: WindowAction };
    res: { ok: true };
  };
  // Renderer ships the exact resolved hex of its theme tokens so the OS-painted
  // WCO matches the tab bar without main-side approximation. color matches
  // hsl(var(--sidebar-background)); symbolColor matches hsl(var(--sidebar-foreground)).
  'app.updateChrome': {
    req: { resolvedTheme: 'light' | 'dark'; color: string; symbolColor: string };
    res: { ok: true };
  };
  'app.setOverlayDimmed': {
    req: { dimmed: boolean };
    res: { ok: true };
  };
  'update.getStatus': {
    req: Record<string, never>;
    res: UpdateStatus;
  };
  // Manual re-check (Linux only; no-op elsewhere — mac/win poll on their own).
  'update.check': {
    req: Record<string, never>;
    res: { ok: true };
  };
  // Restart into the already-downloaded update (mac/win only; no-op otherwise).
  'update.install': {
    req: Record<string, never>;
    res: { ok: true };
  };
};

// Actions the hamburger menu (Win/Linux) dispatches to main — covers View
// (reload / zoom / devtools / fullscreen), Window (minimize / close), and
// File > Quit. Edit undo/redo are routed to Lexical so they remain correct
// when Escape has blurred the editor; the in-editor context menu handles the
// remaining native edit actions.
export type WindowAction =
  | 'minimize'
  | 'close'
  | 'toggleFullscreen'
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'quit';

export type IpcChannel = keyof IpcContract;

export type IpcInvoke = <C extends IpcChannel>(
  channel: C,
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']>;

// ── Event-based IPC (main → renderer push) ─────────────────────────

export type IpcEvents = {
  'menu:new-note': void;
  'menu:open-settings': void;
  'menu:close-tab': void;
  'menu:reopen-closed-tab': void;
  'menu:undo': void;
  'menu:redo': void;
  'context-menu:closed': void;
  'spellcheck:state': SpellCheckState;
  'update:status': UpdateStatus;
};

export type IpcEventChannel = keyof IpcEvents;

export type IpcOn = <C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEvents[C]) => void,
) => () => void; // returns unsubscribe function
