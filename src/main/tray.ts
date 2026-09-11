import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import path from 'path';

// Menu bar (macOS) / system tray (Windows, Linux) integration. The tray is
// created lazily the first time the preference is enabled and destroyed when it
// is disabled, so the app pays no cost when the setting is off.

let tray: Tray | null = null;

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.resolve(__dirname, '..', '..', 'build', 'icon.png');
}

export function isTrayEnabled(): boolean {
  return tray !== null;
}

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

export function applyTrayPreference(enabled: boolean): void {
  if (enabled) createTray();
  else destroyTray();
}

function createTray(): void {
  if (tray) return;
  try {
    const icon = nativeImage
      .createFromPath(trayIconPath())
      .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Lychee');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Lychee', click: showMainWindow },
        {
          label: 'New Note',
          click: () => {
            showMainWindow();
            BrowserWindow.getAllWindows()[0]?.webContents.send('menu:new-note');
          },
        },
        { type: 'separator' },
        { label: 'Quit Lychee', click: () => app.quit() },
      ]),
    );

    // On Windows a left-click should bring the window back rather than only
    // open the context menu. macOS toggles the menu; Linux is app-indicator
    // driven and ignores click events.
    if (process.platform === 'win32') {
      tray.on('click', showMainWindow);
    }
  } catch (error) {
    // Missing libappindicator / headless sessions can reject tray creation.
    // The preference stays persisted; the icon simply won't appear.
    console.error('[tray] failed to create tray icon', error);
    tray = null;
  }
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
  // If the window was hidden behind the tray, make sure disabling the setting
  // can't strand the user with no way back.
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isVisible()) {
    win.show();
    win.focus();
  }
}
