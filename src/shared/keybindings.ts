export const KEYBINDINGS_SETTING_KEY = 'keyboard.shortcuts.v1';

export const shortcutRegistry = [
  { id: 'app.newNote', label: 'New note', description: 'Create and open a new note.', category: 'Editor', defaultBinding: 'Mod+N', location: 'menu' },
  { id: 'app.openSettings', label: 'Open settings', description: 'Open the Settings dialog.', category: 'Navigation', defaultBinding: 'Mod+,', location: 'menu' },
  { id: 'navigation.searchNotes', label: 'Search notes', description: 'Open the note search palette.', category: 'Navigation', defaultBinding: 'Mod+P', location: 'renderer' },
  { id: 'navigation.findInNote', label: 'Find in note', description: 'Search within the active note.', category: 'Navigation', defaultBinding: 'Mod+F', location: 'renderer' },
  { id: 'tabs.close', label: 'Close tab', description: 'Close the active tab.', category: 'Tabs', defaultBinding: 'Mod+W', location: 'menu' },
  { id: 'tabs.reopenClosed', label: 'Reopen closed tab', description: 'Reopen the most recently closed tab.', category: 'Tabs', defaultBinding: 'Mod+Shift+T', location: 'menu' },
  { id: 'editor.undo', label: 'Undo', description: 'Undo the last editor change.', category: 'Editor', defaultBinding: 'Mod+Z', location: 'menu' },
  { id: 'editor.redo', label: 'Redo', description: 'Redo the last editor change.', category: 'Editor', defaultBinding: 'Mod+Shift+Z', location: 'menu' },
  { id: 'format.bold', label: 'Bold', description: 'Toggle bold text.', category: 'Formatting', defaultBinding: 'Mod+B', location: 'editor' },
  { id: 'format.italic', label: 'Italic', description: 'Toggle italic text.', category: 'Formatting', defaultBinding: 'Mod+I', location: 'editor' },
  { id: 'format.underline', label: 'Underline', description: 'Toggle underlined text.', category: 'Formatting', defaultBinding: 'Mod+U', location: 'editor' },
  { id: 'format.strikethrough', label: 'Strikethrough', description: 'Toggle struck-through text.', category: 'Formatting', defaultBinding: 'Mod+Shift+S', location: 'editor' },
  { id: 'format.highlight', label: 'Highlight', description: 'Toggle highlighted text.', category: 'Formatting', defaultBinding: 'Mod+Shift+H', location: 'editor' },
  { id: 'format.inlineCode', label: 'Inline code', description: 'Toggle inline code.', category: 'Formatting', defaultBinding: 'Mod+E', location: 'editor' },
  { id: 'format.link', label: 'Insert or edit link', description: 'Open the link editor for the selection.', category: 'Formatting', defaultBinding: 'Mod+K', location: 'editor' },
] as const;

export type ShortcutDefinition = (typeof shortcutRegistry)[number];
export type ShortcutId = ShortcutDefinition['id'];
export type ShortcutCategory = ShortcutDefinition['category'];
export type KeybindingMap = Record<ShortcutId, string>;

const shortcutIds = new Set<string>(shortcutRegistry.map((item) => item.id));

export function isShortcutId(value: string): value is ShortcutId {
  return shortcutIds.has(value);
}

export function defaultKeybindings(): KeybindingMap {
  return Object.fromEntries(
    shortcutRegistry.map((item) => [item.id, item.defaultBinding]),
  ) as KeybindingMap;
}

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  mod: 'Mod', cmdorctrl: 'Mod', commandorcontrol: 'Mod', command: 'Mod', cmd: 'Mod',
  control: 'Ctrl', ctrl: 'Ctrl', meta: 'Meta', super: 'Meta', windows: 'Meta', win: 'Meta',
  alt: 'Alt', option: 'Alt', shift: 'Shift',
};

export function normalizeKeybinding(value: string): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(part);
  }
  if (!key || modifiers.size === 0) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

function normalizeKey(value: string): string | null {
  const lower = value.toLowerCase();
  const named: Record<string, string> = {
    ',': ',', comma: ',', '.': '.', period: '.', '/': '/', slash: '/',
    ';': ';', semicolon: ';', "'": "'", quote: "'", '[': '[', bracketleft: '[',
    ']': ']', bracketright: ']', '\\': '\\', backslash: '\\', '-': '-', minus: '-',
    '=': '=', equal: '=', space: 'Space', enter: 'Enter', return: 'Enter',
    backspace: 'Backspace', delete: 'Delete', tab: 'Tab', escape: 'Escape', esc: 'Escape',
    arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  };
  if (named[lower]) return named[lower];
  if (/^[a-z0-9]$/i.test(value)) return value.toUpperCase();
  if (/^f(?:[1-9]|1[0-2])$/i.test(value)) return value.toUpperCase();
  return null;
}

type KeyboardEventShape = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export function matchesKeybinding(
  event: KeyboardEventShape,
  binding: string,
  platform: NodeJS.Platform,
): boolean {
  const normalized = normalizeKeybinding(binding);
  if (!normalized) return false;
  const parts = normalized.split('+');
  const expectedKey = parts[parts.length - 1];
  const wantsMod = parts.includes('Mod');
  const expectsMeta = parts.includes('Meta') || (wantsMod && platform === 'darwin');
  const expectsCtrl = parts.includes('Ctrl') || (wantsMod && platform !== 'darwin');
  if (expectsMeta !== event.metaKey) return false;
  if (expectsCtrl !== event.ctrlKey) return false;
  if (parts.includes('Alt') !== event.altKey) return false;
  if (parts.includes('Shift') !== event.shiftKey) return false;
  return normalizeKey(event.key) === expectedKey;
}

export function keybindingFromEvent(
  event: KeyboardEventShape,
  platform: NodeJS.Platform,
): string | null {
  const key = normalizeKey(event.key);
  if (!key || ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  const modifiers: string[] = [];
  if (platform === 'darwin') {
    if (event.metaKey) modifiers.push('Mod');
    if (event.ctrlKey) modifiers.push('Ctrl');
  } else {
    if (event.ctrlKey) modifiers.push('Mod');
    if (event.metaKey) modifiers.push('Meta');
  }
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  return normalizeKeybinding([...modifiers, key].join('+'));
}

export function displayKeybinding(binding: string, platform: NodeJS.Platform): string {
  const normalized = normalizeKeybinding(binding) ?? binding;
  const parts = normalized.split('+');
  if (platform === 'darwin') {
    const symbols: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Backspace: '⌫', Delete: '⌦', Space: 'Space' };
    return parts.map((part) => symbols[part] ?? part).join('');
  }
  return parts.map((part) => {
    if (part === 'Mod') return 'Ctrl';
    if (part === 'Meta') return platform === 'win32' ? 'Win' : 'Super';
    return part;
  }).join('+');
}

function effectiveBinding(binding: string, platform: NodeJS.Platform): string | null {
  const normalized = normalizeKeybinding(binding);
  if (!normalized) return null;
  const parts = normalized.split('+');
  const key = parts[parts.length - 1];
  const physicalModifiers = new Set<string>();
  for (const modifier of parts.slice(0, -1)) {
    if (modifier === 'Mod') {
      physicalModifiers.add(platform === 'darwin' ? 'Meta' : 'Ctrl');
    } else {
      physicalModifiers.add(modifier);
    }
  }
  const order = ['Ctrl', 'Meta', 'Alt', 'Shift'];
  return [...order.filter((modifier) => physicalModifiers.has(modifier)), key].join('+');
}

export function keybindingsConflict(
  first: string,
  second: string,
  platform: NodeJS.Platform,
): boolean {
  const firstEffective = effectiveBinding(first, platform);
  const secondEffective = effectiveBinding(second, platform);
  return firstEffective !== null && firstEffective === secondEffective;
}

export function toElectronAccelerator(binding: string): string {
  const normalized = normalizeKeybinding(binding);
  if (!normalized) throw new Error(`Invalid keybinding: ${binding}`);
  return normalized
    .replace(/^Mod(?=\+|$)/, 'CmdOrCtrl')
    .replace(/(^|\+)Meta(?=\+|$)/, '$1Super');
}
