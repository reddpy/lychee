import { app, BrowserWindow, session } from 'electron';

import type { SpellCheckState } from '../shared/ipc-types';
import { getSetting, setSetting } from './repos/settings';

const SPELL_CHECK_ENABLED_KEY = 'spellCheckEnabled';
const SPELL_CHECK_LANGUAGES_KEY = 'spellCheckLanguages';

function availableLanguages(): string[] {
  return [...session.defaultSession.availableSpellCheckerLanguages].sort((a, b) =>
    a.localeCompare(b),
  );
}

function resolveLocaleLanguage(available: readonly string[]): string | null {
  if (available.length === 0) return null;

  const locale = app.getLocale().replace('_', '-').toLowerCase();
  const exact = available.find((language) => language.toLowerCase() === locale);
  if (exact) return exact;

  const base = locale.split('-')[0];
  return (
    available.find((language) => language.toLowerCase().split('-')[0] === base) ??
    available.find((language) => language.toLowerCase() === 'en-us') ??
    available[0]
  );
}

function storedLanguages(available: readonly string[]): string[] {
  const raw = getSetting(SPELL_CHECK_LANGUAGES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const allowed = new Set(available);
        const valid = parsed.filter(
          (language): language is string =>
            typeof language === 'string' && allowed.has(language),
        );
        if (valid.length > 0) return [...new Set(valid)];
      }
    } catch {
      // A corrupt preference should fall back to the OS locale, not disable spelling.
    }
  }

  const fallback = resolveLocaleLanguage(available);
  return fallback ? [fallback] : [];
}

export function getSpellCheckState(): SpellCheckState {
  const enabled = getSetting(SPELL_CHECK_ENABLED_KEY) !== 'false';
  const platformAllowsLanguageChoice = process.platform !== 'darwin';
  const available = platformAllowsLanguageChoice ? availableLanguages() : [];
  const canChooseLanguages = platformAllowsLanguageChoice && available.length > 0;

  return {
    enabled,
    canChooseLanguages,
    languages: platformAllowsLanguageChoice ? storedLanguages(available) : [],
    availableLanguages: available,
  };
}

function broadcastSpellCheckState(state: SpellCheckState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('spellcheck:state', state);
    }
  }
}

export function applySpellCheckPreferences(): SpellCheckState {
  const state = getSpellCheckState();
  session.defaultSession.setSpellCheckerEnabled(state.enabled);
  if (state.canChooseLanguages && state.languages.length > 0) {
    session.defaultSession.setSpellCheckerLanguages(state.languages);
  }
  return state;
}

export function setSpellCheckEnabled(enabled: boolean): SpellCheckState {
  setSetting(SPELL_CHECK_ENABLED_KEY, String(enabled));
  const state = applySpellCheckPreferences();
  broadcastSpellCheckState(state);
  return state;
}

export function setSpellCheckLanguages(languages: string[]): SpellCheckState {
  if (process.platform === 'darwin') return getSpellCheckState();

  const allowed = new Set(availableLanguages());
  const valid = [...new Set(languages)].filter((language) => allowed.has(language));
  if (valid.length === 0) {
    throw new Error('Select at least one supported spelling language');
  }

  setSetting(SPELL_CHECK_LANGUAGES_KEY, JSON.stringify(valid));
  const state = applySpellCheckPreferences();
  broadcastSpellCheckState(state);
  return state;
}
