import {
  KEYBINDINGS_SETTING_KEY,
  defaultKeybindings,
  isShortcutId,
  keybindingsConflict,
  normalizeKeybinding,
  type KeybindingMap,
  type ShortcutId,
} from '../../shared/keybindings';
import { getSetting, setSetting } from './settings';

type StoredKeybindings = { version: 1; bindings: Partial<Record<ShortcutId, string>> };

function serialize(bindings: KeybindingMap): string {
  return JSON.stringify({ version: 1, bindings } satisfies StoredKeybindings);
}

function readStored(platform: NodeJS.Platform): { bindings: KeybindingMap; canonical: string } {
  const defaults = defaultKeybindings();
  const raw = getSetting(KEYBINDINGS_SETTING_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; bindings?: unknown };
      if (parsed.version === 1 && parsed.bindings && typeof parsed.bindings === 'object' && !Array.isArray(parsed.bindings)) {
        for (const [id, value] of Object.entries(parsed.bindings)) {
          if (!isShortcutId(id) || typeof value !== 'string') continue;
          const normalized = normalizeKeybinding(value);
          const conflicts = Object.entries(defaults).some(
            ([otherId, otherBinding]) =>
              otherId !== id && normalized !== null && keybindingsConflict(otherBinding, normalized, platform),
          );
          if (normalized && !conflicts) defaults[id] = normalized;
        }
      }
    } catch {
      // Fall through to defaults and repair the corrupt value below.
    }
  }
  return { bindings: defaults, canonical: serialize(defaults) };
}

export function getKeybindings(platform: NodeJS.Platform = process.platform): KeybindingMap {
  const raw = getSetting(KEYBINDINGS_SETTING_KEY);
  const { bindings, canonical } = readStored(platform);
  if (raw !== canonical) setSetting(KEYBINDINGS_SETTING_KEY, canonical);
  return bindings;
}

function assertNoConflict(
  bindings: KeybindingMap,
  id: ShortcutId,
  binding: string,
  platform: NodeJS.Platform,
): void {
  const conflict = Object.entries(bindings).find(
    ([otherId, otherBinding]) =>
      otherId !== id && keybindingsConflict(otherBinding, binding, platform),
  );
  if (conflict) throw new Error(`Keybinding ${binding} is already assigned to ${conflict[0]}`);
}

export function setKeybinding(
  id: string,
  value: string,
  platform: NodeJS.Platform = process.platform,
): KeybindingMap {
  if (!isShortcutId(id)) throw new Error(`Unknown shortcut action: ${id}`);
  const binding = normalizeKeybinding(value);
  if (!binding) throw new Error('Keybinding must contain a modifier and one supported key');
  const bindings = getKeybindings(platform);
  assertNoConflict(bindings, id, binding, platform);
  bindings[id] = binding;
  setSetting(KEYBINDINGS_SETTING_KEY, serialize(bindings));
  return bindings;
}

export function resetKeybinding(
  id: string,
  platform: NodeJS.Platform = process.platform,
): KeybindingMap {
  if (!isShortcutId(id)) throw new Error(`Unknown shortcut action: ${id}`);
  return setKeybinding(id, defaultKeybindings()[id], platform);
}

export function resetAllKeybindings(): KeybindingMap {
  const bindings = defaultKeybindings();
  setSetting(KEYBINDINGS_SETTING_KEY, serialize(bindings));
  return bindings;
}
