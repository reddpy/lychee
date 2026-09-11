/**
 * Tests for general preferences (Settings → General) main-process logic.
 *
 * Covers persistence, default handling, launch-at-login OS integration (mac/win
 * via setLoginItemSettings, Linux via an autostart .desktop entry), and the full
 * reset flow. Electron and the spellcheck/tray side-effect modules are mocked.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb, closeTestDb, getTestDb } from './helpers';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn((name: string) =>
      name === 'home' ? '/tmp/lychee-home' : '/tmp/lychee-test',
    ),
    setLoginItemSettings: vi.fn(),
  },
}));

vi.mock('../db', () => ({
  getDb: () => getTestDb(),
}));

vi.mock('../spellcheck', () => ({
  setSpellCheckEnabled: vi.fn().mockReturnValue({ enabled: true }),
}));

vi.mock('../tray', () => ({
  applyTrayPreference: vi.fn(),
  isTrayEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../repos/keybindings', () => ({
  resetAllKeybindings: vi.fn(),
}));

import { app } from 'electron';
import { setSpellCheckEnabled } from '../spellcheck';
import { applyTrayPreference } from '../tray';
import { resetAllKeybindings } from '../repos/keybindings';
import {
  applyGeneralPreferencesOnStartup,
  applyLoginItemSettings,
  getGeneralPreferences,
  resetAllPreferences,
  setGeneralPreferences,
} from '../preferences';
import { GENERAL_PREFERENCES_SETTING_KEY } from '../../shared/general-preferences';

const DEFAULTS = {
  launchAtLogin: false,
  showInTray: false,
  restoreLastSession: true,
};

describe('General preferences', () => {
  let configHome: string;
  const originalConfigHome = process.env.XDG_CONFIG_HOME;
  const originalE2E = process.env.E2E;
  const originalOsIntegration = process.env.LYCHEE_E2E_OS_INTEGRATION;

  beforeEach(() => {
    createTestDb();
    vi.clearAllMocks();
    delete process.env.E2E;
    delete process.env.LYCHEE_E2E_OS_INTEGRATION;
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-autostart-'));
    process.env.XDG_CONFIG_HOME = configHome;
  });

  afterEach(() => {
    closeTestDb();
    fs.rmSync(configHome, { recursive: true, force: true });
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalE2E === undefined) delete process.env.E2E;
    else process.env.E2E = originalE2E;
    if (originalOsIntegration === undefined) delete process.env.LYCHEE_E2E_OS_INTEGRATION;
    else process.env.LYCHEE_E2E_OS_INTEGRATION = originalOsIntegration;
  });

  it('returns defaults when nothing is stored', () => {
    expect(getGeneralPreferences()).toEqual(DEFAULTS);
  });

  it('persists a launch-at-login toggle', () => {
    const next = setGeneralPreferences({ launchAtLogin: true });
    expect(next).toEqual({ ...DEFAULTS, launchAtLogin: true });
    expect(getGeneralPreferences()).toEqual({ ...DEFAULTS, launchAtLogin: true });
  });

  it('persists the tray toggle', () => {
    expect(setGeneralPreferences({ showInTray: true }).showInTray).toBe(true);
    expect(getGeneralPreferences().showInTray).toBe(true);
  });

  it('toggles the tray only when the value changes', () => {
    setGeneralPreferences({ showInTray: true });
    expect(applyTrayPreference).toHaveBeenCalledWith(true);
    (applyTrayPreference as ReturnType<typeof vi.fn>).mockClear();

    setGeneralPreferences({ launchAtLogin: false });
    expect(applyTrayPreference).not.toHaveBeenCalled();
  });

  it('re-applies stored preferences on startup', () => {
    setGeneralPreferences({ launchAtLogin: true, showInTray: true });
    vi.clearAllMocks();
    applyGeneralPreferencesOnStartup();
    expect(applyTrayPreference).toHaveBeenCalledWith(true);
  });

  it('applies launch-at-login to the OS when packaged', () => {
    applyLoginItemSettings(true);

    if (process.platform === 'linux') {
      const entry = path.join(configHome, 'autostart', 'lychee.desktop');
      expect(fs.existsSync(entry)).toBe(true);
      expect(fs.readFileSync(entry, 'utf8')).toContain('Name=Lychee');
    } else {
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    }
  });

  it('removes the Linux autostart entry when disabled', () => {
    if (process.platform !== 'linux') return;
    applyLoginItemSettings(true);
    applyLoginItemSettings(false);
    expect(fs.existsSync(path.join(configHome, 'autostart', 'lychee.desktop'))).toBe(
      false,
    );
  });

  it('skips OS integration under E2E', () => {
    process.env.E2E = '1';
    applyLoginItemSettings(true);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(configHome, 'autostart', 'lychee.desktop'))).toBe(
      false,
    );
  });

  it('allows OS integration under E2E when explicitly opted in', () => {
    process.env.E2E = '1';
    process.env.LYCHEE_E2E_OS_INTEGRATION = '1';
    applyLoginItemSettings(true);

    if (process.platform === 'linux') {
      expect(fs.existsSync(path.join(configHome, 'autostart', 'lychee.desktop'))).toBe(
        true,
      );
    } else {
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    }
  });

  it('reset clears settings and restores all defaults', () => {
    setGeneralPreferences({
      launchAtLogin: true,
      showInTray: true,
    });
    expect(getTestDb().prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({
      n: 1,
    });

    resetAllPreferences();

    expect(getGeneralPreferences()).toEqual(DEFAULTS);
    expect(resetAllKeybindings).toHaveBeenCalled();
    expect(applyTrayPreference).toHaveBeenCalledWith(false);
    expect(setSpellCheckEnabled).toHaveBeenCalledWith(true);
    // The general-preference row is gone after the reset clears all settings.
    // (Keybindings/spellcheck are mocked here, so they write nothing back.)
    const keys = (
      getTestDb().prepare('SELECT key FROM settings').all() as { key: string }[]
    ).map((row) => row.key);
    expect(keys).not.toContain(GENERAL_PREFERENCES_SETTING_KEY);
    expect(keys).toEqual([]);
  });
});
