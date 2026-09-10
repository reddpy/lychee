import { describe, expect, it } from 'vitest';

import {
  defaultKeybindings,
  displayKeybinding,
  keybindingFromEvent,
  keybindingsConflict,
  matchesKeybinding,
  normalizeKeybinding,
  shortcutRegistry,
  toElectronAccelerator,
} from '../keybindings';

const event = (key: string, options: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...options,
}) as KeyboardEvent;

describe('keyboard shortcut registry', () => {
  it('has unique action ids and unique defaults', () => {
    expect(new Set(shortcutRegistry.map((item) => item.id)).size).toBe(shortcutRegistry.length);
    expect(new Set(shortcutRegistry.map((item) => item.defaultBinding)).size).toBe(shortcutRegistry.length);
  });

  it('indexes only Lychee-owned categories', () => {
    expect(new Set(shortcutRegistry.map((item) => item.category))).toEqual(
      new Set(['Editor', 'Navigation', 'Tabs', 'Formatting']),
    );
    expect(shortcutRegistry.map((item) => item.label)).not.toContain('Quit');
    expect(shortcutRegistry.map((item) => item.label)).not.toContain('Copy');
  });

  it('creates a fresh complete defaults map', () => {
    const first = defaultKeybindings();
    const second = defaultKeybindings();
    first['format.bold'] = 'Mod+Y';
    expect(second['format.bold']).toBe('Mod+B');
    expect(Object.keys(second)).toHaveLength(shortcutRegistry.length);
  });
});

describe('keybinding normalization and matching', () => {
  it.each([
    ['cmd+b', 'Mod+B'],
    ['Control + Shift + s', 'Ctrl+Shift+S'],
    ['alt+comma', 'Alt+,'],
    ['mod+/', 'Mod+/'],
    ['meta+shift+k', 'Meta+Shift+K'],
    ['shift+f12', 'Shift+F12'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeKeybinding(input)).toBe(expected);
  });

  it.each(['B', '', 'Mod', 'Mod+B+I', 'Mod+Unknown', 'Mod+Shift'])('rejects invalid binding %s', (input) => {
    expect(normalizeKeybinding(input)).toBeNull();
  });

  it('distinguishes Command, Control, and portable Mod on macOS', () => {
    expect(matchesKeybinding(event('b', { metaKey: true }), 'Mod+B', 'darwin')).toBe(true);
    expect(matchesKeybinding(event('b', { ctrlKey: true }), 'Mod+B', 'darwin')).toBe(false);
    expect(matchesKeybinding(event('b', { ctrlKey: true }), 'Ctrl+B', 'darwin')).toBe(true);
    expect(matchesKeybinding(event('b', { metaKey: true }), 'Ctrl+B', 'darwin')).toBe(false);
    expect(matchesKeybinding(event('b', { metaKey: true, ctrlKey: true }), 'Mod+Ctrl+B', 'darwin')).toBe(true);
  });

  it('resolves Mod to Control on Windows and Linux while keeping Meta separate', () => {
    expect(matchesKeybinding(event('b', { ctrlKey: true }), 'Mod+B', 'win32')).toBe(true);
    expect(matchesKeybinding(event('b', { ctrlKey: true }), 'Mod+B', 'linux')).toBe(true);
    expect(matchesKeybinding(event('b', { metaKey: true }), 'Mod+B', 'win32')).toBe(false);
    expect(matchesKeybinding(event('b', { metaKey: true }), 'Meta+B', 'win32')).toBe(true);
  });

  it('captures physical modifiers according to the current platform', () => {
    expect(keybindingFromEvent(event('y', { metaKey: true, shiftKey: true }), 'darwin')).toBe('Mod+Shift+Y');
    expect(keybindingFromEvent(event('y', { ctrlKey: true, shiftKey: true }), 'darwin')).toBe('Ctrl+Shift+Y');
    expect(keybindingFromEvent(event('y', { ctrlKey: true, shiftKey: true }), 'win32')).toBe('Mod+Shift+Y');
    expect(keybindingFromEvent(event('y', { metaKey: true, shiftKey: true }), 'linux')).toBe('Meta+Shift+Y');
    expect(keybindingFromEvent(event('Control', { ctrlKey: true }), 'darwin')).toBeNull();
    expect(keybindingFromEvent(event('y'), 'darwin')).toBeNull();
  });

  it('detects collisions by physical chord on each platform', () => {
    expect(keybindingsConflict('Mod+P', 'Ctrl+P', 'darwin')).toBe(false);
    expect(keybindingsConflict('Mod+P', 'Ctrl+P', 'win32')).toBe(true);
    expect(keybindingsConflict('Mod+P', 'Ctrl+P', 'linux')).toBe(true);
    expect(keybindingsConflict('Mod+P', 'Meta+P', 'darwin')).toBe(true);
    expect(keybindingsConflict('Mod+P', 'Meta+P', 'win32')).toBe(false);
  });

  it('formats platform labels and Electron accelerators', () => {
    expect(displayKeybinding('Mod+Shift+T', 'darwin')).toBe('⌘⇧T');
    expect(displayKeybinding('Ctrl+Shift+T', 'darwin')).toBe('⌃⇧T');
    expect(displayKeybinding('Mod+Shift+T', 'win32')).toBe('Ctrl+Shift+T');
    expect(displayKeybinding('Meta+Shift+T', 'win32')).toBe('Win+Shift+T');
    expect(displayKeybinding('Meta+Shift+T', 'linux')).toBe('Super+Shift+T');
    expect(toElectronAccelerator('Mod+Shift+T')).toBe('CmdOrCtrl+Shift+T');
  });
});
