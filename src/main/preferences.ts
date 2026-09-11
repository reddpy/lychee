import fs from 'fs';
import path from 'path';
import { app } from 'electron';

import {
  DEFAULT_GENERAL_PREFERENCES,
  GENERAL_PREFERENCES_SETTING_KEY,
  parseStoredGeneralPreferences,
  serializeGeneralPreferences,
  type GeneralPreferences,
} from '../shared/general-preferences';
import { clearSettings, getSetting, setSetting } from './repos/settings';
import { resetAllKeybindings } from './repos/keybindings';
import { setSpellCheckEnabled } from './spellcheck';
import { applyTrayPreference, isTrayEnabled } from './tray';

// General preferences live in the SQLite settings table. Launch-at-login is the
// one with an OS side effect; it is applied on write and re-synced on startup.
// Real OS writes only happen in installed builds: dev/E2E runs must not pollute
// the machine's login items or autostart directory (mirrors the updater gate).

function canTouchOsIntegration(): boolean {
  if (!app.isPackaged) return false;
  // E2E runs normally skip real OS writes to avoid polluting the machine. The
  // platform smoke job opts back in via LYCHEE_E2E_OS_INTEGRATION=1 so the
  // launch-at-login path can be exercised against the real OS.
  if (process.env.E2E === '1' && process.env.LYCHEE_E2E_OS_INTEGRATION !== '1') {
    return false;
  }
  return true;
}

function linuxAutostartPath(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(app.getPath('home'), '.config');
  return path.join(configHome, 'autostart', 'lychee.desktop');
}

function writeLinuxAutostartEntry(enabled: boolean): void {
  const target = linuxAutostartPath();
  if (!enabled) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // best-effort
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // APPIMAGE is set when running from an AppImage; otherwise execPath is the
  // installed binary (deb/rpm).
  const exec = process.env.APPIMAGE ?? process.execPath;
  fs.writeFileSync(
    target,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Lychee',
      `Exec="${exec}"`,
      'X-GNOME-Autostart-enabled=true',
      'Terminal=false',
      '',
    ].join('\n'),
    'utf8',
  );
}

export function applyLoginItemSettings(enabled: boolean): void {
  if (!canTouchOsIntegration()) return;
  try {
    if (process.platform === 'linux') {
      writeLinuxAutostartEntry(enabled);
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  } catch (error) {
    console.error('[preferences] failed to update launch-at-login', error);
  }
}

export function getGeneralPreferences(): GeneralPreferences {
  return parseStoredGeneralPreferences(getSetting(GENERAL_PREFERENCES_SETTING_KEY));
}

export function setGeneralPreferences(
  patch: Partial<GeneralPreferences>,
): GeneralPreferences {
  const current = getGeneralPreferences();
  const next: GeneralPreferences = {
    launchAtLogin:
      typeof patch.launchAtLogin === 'boolean'
        ? patch.launchAtLogin
        : current.launchAtLogin,
    showInTray:
      typeof patch.showInTray === 'boolean' ? patch.showInTray : current.showInTray,
    restoreLastSession:
      typeof patch.restoreLastSession === 'boolean'
        ? patch.restoreLastSession
        : current.restoreLastSession,
  };

  setSetting(GENERAL_PREFERENCES_SETTING_KEY, serializeGeneralPreferences(next));

  if (next.launchAtLogin !== current.launchAtLogin) {
    applyLoginItemSettings(next.launchAtLogin);
  }
  if (next.showInTray !== current.showInTray) {
    applyTrayPreference(next.showInTray);
  }
  return next;
}

/** Re-apply persisted preferences after the DB is up (login item + tray). */
export function applyGeneralPreferencesOnStartup(): void {
  const preferences = getGeneralPreferences();
  applyLoginItemSettings(preferences.launchAtLogin);
  applyTrayPreference(preferences.showInTray);
}

/**
 * Wipe every persisted preference and restore OS integration to defaults.
 * Renderer-owned state (theme class, accent CSS vars, section order) is reset
 * separately by the renderer, which is the only side that can touch the DOM.
 */
export function resetAllPreferences(): void {
  clearSettings();
  resetAllKeybindings();
  applyLoginItemSettings(DEFAULT_GENERAL_PREFERENCES.launchAtLogin);
  applyTrayPreference(DEFAULT_GENERAL_PREFERENCES.showInTray);
  // Clears any custom spelling languages and re-enables the default.
  setSpellCheckEnabled(true);
}

/** True when closing the main window should hide it instead of quitting. */
export function shouldHideWindowOnClose(): boolean {
  return process.env.E2E !== '1' && isTrayEnabled();
}
