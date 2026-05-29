import { app, autoUpdater, BrowserWindow } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import type { UpdateState, UpdateStatus } from '../shared/ipc-types';
import { type GithubRelease, pickNewerTag } from './update-version';

// ── Auto-update orchestration ────────────────────────────────────────
//
// Two mechanisms behind one status surface (see UpdateStatus in ipc-types):
//   mac/win — `update-electron-app` wraps Electron's autoUpdater +
//             update.electronjs.org. It polls, downloads in the background,
//             and we map autoUpdater events to our status. notifyUser:false
//             suppresses the library's native dialog; the renderer's About
//             pane + Settings red-dot are our UI instead.
//   linux   — autoUpdater is unsupported, so we poll the GitHub releases API
//             ourselves and surface a "Download" link (notify-only).
// In dev / E2E / unpackaged builds the whole feature is inert ('unsupported').

const REPO = 'reddpy/lychee';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

let status: UpdateStatus = {
  state: 'unsupported',
  currentVersion: '0.0.0',
  releaseUrl: RELEASES_URL,
};

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    // A window can be mid-teardown when a status change lands; sending to a
    // destroyed webContents throws, so skip those.
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    win.webContents.send('update:status', status);
  }
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  broadcast();
}

// Applies a state transition with one invariant: 'ready' is terminal until the
// app restarts. mac/win keep polling every 10 min after a download completes,
// so without this guard the next 'checking-for-update' / 'update-not-available'
// cycle would wipe an installable update out of the UI. A subsequent
// 'update-downloaded' (a still-newer build) is the only thing allowed through,
// to refresh the version label.
function setUpdateState(next: UpdateState, newVersion?: string): void {
  if (status.state === 'ready' && next !== 'ready') return;
  const patch: Partial<UpdateStatus> = { state: next };
  // 'up-to-date' clears any stale version label; other states only set it when
  // a value is supplied, preserving the prior label otherwise.
  if (next === 'up-to-date') patch.newVersion = undefined;
  else if (newVersion !== undefined) patch.newVersion = newVersion;
  setStatus(patch);
}

// Guards against overlapping Linux checks (e.g. a button mash) whose responses
// could otherwise resolve out of order and flap the status.
let linuxCheckInFlight = false;

async function checkLinux(): Promise<void> {
  if (linuxCheckInFlight) return;
  linuxCheckInFlight = true;
  setUpdateState('checking');
  const { net } = await import('electron');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await net.fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Lychee/${status.currentVersion}`,
      },
      signal: controller.signal as never,
    });
    if (!response.ok) {
      setUpdateState('error');
      return;
    }
    const releases = (await response.json()) as GithubRelease[];
    const newer = pickNewerTag(releases, status.currentVersion);
    if (newer) {
      setUpdateState('available', newer);
    } else {
      setUpdateState('up-to-date');
    }
  } catch {
    setUpdateState('error');
  } finally {
    clearTimeout(timeout);
    linuxCheckInFlight = false;
  }
}

function setupAutoUpdater(): void {
  setUpdateState('checking');

  // Listeners must be attached before update-electron-app kicks off its first
  // check so we don't miss the opening 'checking-for-update' / 'update-*' events.
  autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
  autoUpdater.on('update-available', () => setUpdateState('downloading'));
  autoUpdater.on('update-not-available', () => setUpdateState('up-to-date'));
  // On Windows only `releaseName` is populated (see Electron docs); the other
  // args are empty there, so we key the version label off releaseName.
  autoUpdater.on(
    'update-downloaded',
    (_event, _releaseNotes, releaseName?: string) => {
      setUpdateState('ready', releaseName || undefined);
    },
  );
  autoUpdater.on('error', () => setUpdateState('error'));

  updateElectronApp({
    repo: REPO,
    updateInterval: '10 minutes',
    notifyUser: false,
    logger: console,
  });
}

export function initUpdater(): void {
  setStatus({ currentVersion: app.getVersion(), releaseUrl: RELEASES_URL });

  // The autoUpdater rejects unsigned/unpackaged apps and Playwright drives an
  // E2E build we never want phoning home — keep the feature inert there.
  if (!app.isPackaged || process.env.E2E === '1') {
    setStatus({ state: 'unsupported' });
    return;
  }

  if (process.platform === 'darwin' || process.platform === 'win32') {
    setupAutoUpdater();
  } else if (process.platform === 'linux') {
    // Linux has no background poll — check once at launch, then only on demand
    // via the About pane's "Check for Updates" button (see checkForUpdates).
    void checkLinux();
  } else {
    setStatus({ state: 'unsupported' });
  }
}

// Manual re-check. Linux-only by design: mac/win poll on their own via
// update-electron-app, so a manual button there would be redundant.
export function checkForUpdates(): void {
  if (process.platform === 'linux' && app.isPackaged && process.env.E2E !== '1') {
    void checkLinux();
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

// Applies the already-downloaded update by relaunching (mac/win only). The
// renderer only enables the button in the 'ready' state, but we guard anyway.
export function installUpdate(): void {
  if (
    (process.platform === 'darwin' || process.platform === 'win32') &&
    status.state === 'ready'
  ) {
    autoUpdater.quitAndInstall();
  }
}
