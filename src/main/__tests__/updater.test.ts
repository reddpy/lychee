/**
 * Orchestration tests for the main-process auto-updater (src/main/updater.ts).
 *
 * `electron` and `update-electron-app` are mocked so we can exercise the state
 * machine, the autoUpdater event mapping, the Linux GitHub-poll failure modes,
 * and the install/broadcast guards without an Electron runtime. The module
 * keeps singleton state, so each test re-imports it fresh via vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Shared mock surface (stable refs; the electron factory closes over these) ──
type Listener = (...args: unknown[]) => void;
const auListeners = new Map<string, Listener>();
const updateElectronAppMock = vi.fn();
const quitAndInstallMock = vi.fn();
const fetchMock = vi.fn();

let windows: Array<ReturnType<typeof makeWindow>> = [];
let appVersion = '0.1.0';
let isPackaged = true;

function makeWindow(opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}) {
  const send = vi.fn();
  return {
    isDestroyed: () => !!opts.destroyed,
    webContents: { isDestroyed: () => !!opts.wcDestroyed, send },
  };
}

vi.mock('update-electron-app', () => ({
  updateElectronApp: (...args: unknown[]) => updateElectronAppMock(...args),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => appVersion,
    get isPackaged() {
      return isPackaged;
    },
  },
  autoUpdater: {
    on: (evt: string, cb: Listener) => auListeners.set(evt, cb),
    quitAndInstall: (...a: unknown[]) => quitAndInstallMock(...a),
    checkForUpdates: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => windows },
  net: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

async function loadUpdater() {
  vi.resetModules();
  return import('../updater');
}

function emit(event: string, ...args: unknown[]) {
  const cb = auListeners.get(event);
  if (!cb) throw new Error(`No listener registered for "${event}"`);
  cb(...args);
}

beforeEach(() => {
  auListeners.clear();
  updateElectronAppMock.mockReset();
  quitAndInstallMock.mockReset();
  fetchMock.mockReset();
  windows = [makeWindow()];
  appVersion = '0.1.0';
  isPackaged = true;
  delete process.env.E2E;
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

describe('initUpdater — guards', () => {
  it('stays inert (unsupported) when the app is not packaged', async () => {
    setPlatform('darwin');
    isPackaged = false;
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    expect(getUpdateStatus().state).toBe('unsupported');
    expect(updateElectronAppMock).not.toHaveBeenCalled();
  });

  it('stays inert under E2E even when packaged', async () => {
    setPlatform('darwin');
    process.env.E2E = '1';
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    expect(getUpdateStatus().state).toBe('unsupported');
    expect(updateElectronAppMock).not.toHaveBeenCalled();
  });

  it('is unsupported on an unknown platform', async () => {
    setPlatform('freebsd');
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    expect(getUpdateStatus().state).toBe('unsupported');
  });

  it('reports the running version and releases URL', async () => {
    setPlatform('darwin');
    appVersion = '1.2.3';
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    expect(getUpdateStatus().currentVersion).toBe('1.2.3');
    expect(getUpdateStatus().releaseUrl).toBe('https://github.com/reddpy/lychee/releases');
  });
});

describe('mac/win autoUpdater event mapping', () => {
  it('wires update-electron-app and starts in "checking"', async () => {
    setPlatform('darwin');
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    expect(updateElectronAppMock).toHaveBeenCalledTimes(1);
    expect(updateElectronAppMock.mock.calls[0][0]).toMatchObject({
      repo: 'reddpy/lychee',
      notifyUser: false,
    });
    expect(getUpdateStatus().state).toBe('checking');
  });

  it('subscribes to exactly the autoUpdater events it handles', async () => {
    setPlatform('darwin');
    const { initUpdater } = await loadUpdater();
    initUpdater();
    // Guards against a handler being dropped or renamed out of sync with the
    // emit() calls the other tests rely on.
    expect([...auListeners.keys()].sort()).toEqual(
      [
        'checking-for-update',
        'error',
        'update-available',
        'update-downloaded',
        'update-not-available',
      ].sort(),
    );
  });

  it('maps each autoUpdater event to a state', async () => {
    setPlatform('win32');
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();

    emit('update-not-available');
    expect(getUpdateStatus().state).toBe('up-to-date');

    emit('checking-for-update');
    expect(getUpdateStatus().state).toBe('checking');

    emit('update-available');
    expect(getUpdateStatus().state).toBe('downloading');

    emit('error');
    expect(getUpdateStatus().state).toBe('error');

    emit('update-downloaded', null, 'release notes', '0.2.0');
    expect(getUpdateStatus()).toMatchObject({ state: 'ready', newVersion: '0.2.0' });
  });

  it('leaves newVersion unset when update-downloaded has no releaseName', async () => {
    setPlatform('darwin');
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    emit('update-downloaded', null, '', '');
    expect(getUpdateStatus().state).toBe('ready');
    expect(getUpdateStatus().newVersion).toBeUndefined();
  });

  it('keeps "ready" sticky against later poll cycles', async () => {
    setPlatform('darwin');
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();

    emit('update-downloaded', null, '', '0.2.0');
    expect(getUpdateStatus().state).toBe('ready');

    // The 10-min interval keeps polling after a download; none of these may
    // clear the installable update from the UI.
    emit('checking-for-update');
    emit('update-not-available');
    emit('error');
    expect(getUpdateStatus()).toMatchObject({ state: 'ready', newVersion: '0.2.0' });

    // …but a still-newer downloaded build refreshes the label.
    emit('update-downloaded', null, '', '0.3.0');
    expect(getUpdateStatus()).toMatchObject({ state: 'ready', newVersion: '0.3.0' });
  });
});

describe('broadcast', () => {
  it('sends status to live windows and skips destroyed ones', async () => {
    setPlatform('darwin');
    const live = makeWindow();
    const destroyed = makeWindow({ destroyed: true });
    const wcGone = makeWindow({ wcDestroyed: true });
    windows = [live, destroyed, wcGone];

    const { initUpdater } = await loadUpdater();
    initUpdater(); // triggers at least one broadcast

    expect(live.webContents.send).toHaveBeenCalledWith(
      'update:status',
      expect.objectContaining({ state: 'checking' }),
    );
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(wcGone.webContents.send).not.toHaveBeenCalled();
  });

  it('does not throw when no windows are open', async () => {
    setPlatform('darwin');
    windows = [];
    const { initUpdater } = await loadUpdater();
    expect(() => initUpdater()).not.toThrow();
  });

  it('fans out to many windows (stress)', async () => {
    setPlatform('darwin');
    windows = Array.from({ length: 250 }, () => makeWindow());
    const { initUpdater } = await loadUpdater();
    initUpdater();
    for (const win of windows) {
      expect(win.webContents.send).toHaveBeenCalled();
    }
  });
});

describe('Linux GitHub poll', () => {
  function jsonResponse(body: unknown, ok = true) {
    return { ok, json: () => Promise.resolve(body) };
  }

  it('reports "available" with the newest tag', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue(
      jsonResponse([
        { tag_name: 'v0.1.5', draft: false },
        { tag_name: 'v0.2.0', draft: false },
      ]),
    );
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('available'));
    expect(getUpdateStatus().newVersion).toBe('0.2.0');

    // Hits the repo's releases API with a UA (GitHub rejects UA-less requests).
    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.github.com/repos/reddpy/lychee/releases?per_page=20');
    expect(opts.headers['User-Agent']).toMatch(/^Lychee\//);
    expect(opts.headers.Accept).toBe('application/vnd.github+json');
  });

  it('reports "up-to-date" when nothing is newer', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue(jsonResponse([{ tag_name: 'v0.1.0', draft: false }]));
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('up-to-date'));
  });

  it('reports "up-to-date" for an empty releases list', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue(jsonResponse([]));
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('up-to-date'));
  });

  it('reports "error" on a non-OK response (e.g. rate limit)', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue(jsonResponse(null, false));
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('error'));
  });

  it('reports "error" when the request rejects', async () => {
    setPlatform('linux');
    fetchMock.mockRejectedValue(new Error('network down'));
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('error'));
  });

  it('reports "error" when the body is not valid JSON', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) });
    const { initUpdater, getUpdateStatus } = await loadUpdater();
    initUpdater();
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('error'));
  });

  it('coalesces overlapping checks (button-mash stress)', async () => {
    setPlatform('linux');
    // Hold the first request open so subsequent calls see it in flight.
    let release!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((res) => { release = res; }));

    const { initUpdater, checkForUpdates, getUpdateStatus } = await loadUpdater();
    initUpdater(); // first (startup) check
    // checkLinux awaits `import('electron')` before fetching, so wait until the
    // first request is actually in flight before mashing the button.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 10; i++) checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1); // coalesced — still just one

    release(jsonResponse([{ tag_name: 'v0.2.0', draft: false }]));
    await vi.waitFor(() => expect(getUpdateStatus().state).toBe('available'));

    // Once settled, a fresh check is allowed through again.
    fetchMock.mockResolvedValue(jsonResponse([]));
    checkForUpdates();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe('checkForUpdates — platform scoping', () => {
  it('is a no-op on mac/win (they self-poll)', async () => {
    setPlatform('darwin');
    const { initUpdater, checkForUpdates } = await loadUpdater();
    initUpdater();
    fetchMock.mockClear();
    checkForUpdates();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing on Linux when unpackaged', async () => {
    setPlatform('linux');
    isPackaged = false;
    const { initUpdater, checkForUpdates } = await loadUpdater();
    initUpdater();
    checkForUpdates();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('installUpdate', () => {
  it('quits and installs only from the "ready" state on mac/win', async () => {
    setPlatform('darwin');
    const { initUpdater, installUpdate } = await loadUpdater();
    initUpdater();

    installUpdate(); // state is 'checking' → ignored
    expect(quitAndInstallMock).not.toHaveBeenCalled();

    emit('update-downloaded', null, '', '0.2.0');
    installUpdate();
    expect(quitAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it('never installs on Linux', async () => {
    setPlatform('linux');
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const { initUpdater, installUpdate } = await loadUpdater();
    initUpdater();
    installUpdate();
    expect(quitAndInstallMock).not.toHaveBeenCalled();
  });
});
