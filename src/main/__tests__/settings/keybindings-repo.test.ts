import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, getTestDb } from '../helpers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', () => ({ getDb: () => getTestDb() }));

import {
  getKeybindings,
  resetAllKeybindings,
  resetKeybinding,
  setKeybinding,
} from '../../repos/keybindings';
import { getSetting, setSetting } from '../../repos/settings';
import { KEYBINDINGS_SETTING_KEY, defaultKeybindings } from '../../../shared/keybindings';

describe('Keybindings Repo — validated persistence', () => {
  beforeEach(createTestDb);
  afterEach(closeTestDb);

  it('materializes every default in a versioned canonical settings record', () => {
    expect(getKeybindings()).toEqual(defaultKeybindings());
    expect(JSON.parse(getSetting(KEYBINDINGS_SETTING_KEY)!)).toEqual({
      version: 1,
      bindings: defaultKeybindings(),
    });
  });

  it('persists a normalized custom binding across independent reads', () => {
    setKeybinding('format.bold', 'control + shift + y');
    expect(getKeybindings()['format.bold']).toBe('Ctrl+Shift+Y');
    expect(JSON.parse(getSetting(KEYBINDINGS_SETTING_KEY)!).bindings['format.bold']).toBe('Ctrl+Shift+Y');
  });

  it('preserves unrelated customized actions during an update', () => {
    setKeybinding('format.bold', 'Mod+Y');
    setKeybinding('navigation.searchNotes', 'Mod+Shift+P');
    expect(getKeybindings()).toMatchObject({
      'format.bold': 'Mod+Y',
      'navigation.searchNotes': 'Mod+Shift+P',
      'tabs.close': 'Mod+W',
    });
  });

  it.each([
    ['unknown.action', 'Mod+Y', 'Unknown shortcut action'],
    ['format.bold', 'Y', 'must contain a modifier'],
    ['format.bold', 'Mod+NoSuchKey', 'must contain a modifier'],
  ])('rejects invalid mutation %s = %s without changing stored state', (id, binding, message) => {
    getKeybindings();
    const before = getSetting(KEYBINDINGS_SETTING_KEY);
    expect(() => setKeybinding(id, binding)).toThrow(message);
    expect(getSetting(KEYBINDINGS_SETTING_KEY)).toBe(before);
  });

  it('rejects collisions without partially saving either action', () => {
    const before = getKeybindings();
    expect(() => setKeybinding('format.bold', before['format.italic'])).toThrow('already assigned');
    expect(getKeybindings()).toEqual(before);
  });

  it('allows Command and physical Control chords to differ on macOS', () => {
    const result = setKeybinding('format.bold', 'Ctrl+I', 'darwin');
    expect(result['format.bold']).toBe('Ctrl+I');
    expect(result['format.italic']).toBe('Mod+I');
  });

  it.each(['win32', 'linux'] as const)(
    'rejects portable Mod and explicit Control collisions on %s',
    (platform) => {
      expect(() => setKeybinding('format.bold', 'Ctrl+I', platform)).toThrow('already assigned');
      expect(getKeybindings(platform)['format.bold']).toBe('Mod+B');
    },
  );

  it('repairs a macOS-only Control binding if it collides after moving settings to Windows', () => {
    setKeybinding('format.bold', 'Ctrl+I', 'darwin');
    const windowsBindings = getKeybindings('win32');
    expect(windowsBindings['format.bold']).toBe('Mod+B');
    expect(windowsBindings['format.italic']).toBe('Mod+I');
  });

  it('repairs collisions injected directly into the persisted JSON', () => {
    setSetting(KEYBINDINGS_SETTING_KEY, JSON.stringify({
      version: 1,
      bindings: { 'format.bold': 'Mod+I' },
    }));
    const result = getKeybindings();
    expect(result['format.bold']).toBe('Mod+B');
    expect(result['format.italic']).toBe('Mod+I');
  });

  it('repairs malformed JSON to defaults', () => {
    setSetting(KEYBINDINGS_SETTING_KEY, '{not json');
    expect(getKeybindings()).toEqual(defaultKeybindings());
    expect(() => JSON.parse(getSetting(KEYBINDINGS_SETTING_KEY)!)).not.toThrow();
  });

  it('repairs wrong versions, arrays, unknown actions, and invalid values', () => {
    setSetting(KEYBINDINGS_SETTING_KEY, JSON.stringify({
      version: 99,
      bindings: { 'format.bold': 'Mod+Y' },
    }));
    expect(getKeybindings()).toEqual(defaultKeybindings());

    setSetting(KEYBINDINGS_SETTING_KEY, JSON.stringify({
      version: 1,
      bindings: {
        'format.bold': 'Mod+Y',
        'format.italic': 'bare',
        'removed.action': 'Mod+Q',
      },
    }));
    expect(getKeybindings()).toMatchObject({ 'format.bold': 'Mod+Y', 'format.italic': 'Mod+I' });
  });

  it('fills defaults for actions added after an older partial record', () => {
    setSetting(KEYBINDINGS_SETTING_KEY, JSON.stringify({
      version: 1,
      bindings: { 'format.bold': 'Mod+Y' },
    }));
    const result = getKeybindings();
    expect(result['format.bold']).toBe('Mod+Y');
    expect(Object.keys(result)).toHaveLength(Object.keys(defaultKeybindings()).length);
  });

  it('resets one action while preserving the rest', () => {
    setKeybinding('format.bold', 'Mod+Y');
    setKeybinding('navigation.searchNotes', 'Mod+Shift+P');
    const result = resetKeybinding('format.bold');
    expect(result['format.bold']).toBe('Mod+B');
    expect(result['navigation.searchNotes']).toBe('Mod+Shift+P');
  });

  it('reset all atomically replaces every customization', () => {
    setKeybinding('format.bold', 'Mod+Y');
    setKeybinding('navigation.searchNotes', 'Mod+Shift+P');
    expect(resetAllKeybindings()).toEqual(defaultKeybindings());
    expect(getKeybindings()).toEqual(defaultKeybindings());
  });

  it('survives rapid last-write updates with a valid canonical record', async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => Promise.resolve().then(() => {
      setKeybinding('format.bold', `Mod+${index % 2 === 0 ? 'Y' : 'G'}`);
    })));
    expect(['Mod+Y', 'Mod+G']).toContain(getKeybindings()['format.bold']);
    expect(JSON.parse(getSetting(KEYBINDINGS_SETTING_KEY)!).version).toBe(1);
  });
});
