// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EDITOR_PREFERENCES } from '../editor-preferences';

const invoke = vi.fn();

import { applyEditorPreferences, useEditorPreferencesStore } from '../editor-preferences-store';

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ ok: true });
  window.lychee = {
    invoke,
    platform: 'linux',
    on: () => () => {},
  } as unknown as Window['lychee'];
  useEditorPreferencesStore.setState({ ...DEFAULT_EDITOR_PREFERENCES });
});

describe('applyEditorPreferences', () => {
  it('writes CSS vars and data attributes to the document root', () => {
    applyEditorPreferences({
      ...DEFAULT_EDITOR_PREFERENCES,
      fontFamily: 'serif',
      fontSize: 18,
      pageWidth: 'wide',
      lineHeight: 'relaxed',
      codeTabSize: 4,
      reduceMotion: true,
      focusMode: true,
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--editor-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--editor-content-max-width')).toBe('1100px');
    expect(root.style.getPropertyValue('--editor-line-height')).toBe('2');
    expect(root.style.getPropertyValue('--editor-code-tab-size')).toBe('4');
    expect(root.style.getPropertyValue('--editor-font-family')).toContain('Georgia');
    expect(root.dataset.reduceMotion).toBe('true');
    expect(root.dataset.focusMode).toBe('true');
  });
});

describe('editor preferences store', () => {
  it('reset restores defaults, re-applies them, and persists', () => {
    const store = useEditorPreferencesStore.getState();
    store.setFontFamily('mono');
    store.setFontSize(20);
    expect(useEditorPreferencesStore.getState().fontFamily).toBe('mono');
    invoke.mockClear();

    useEditorPreferencesStore.getState().reset();

    const state = useEditorPreferencesStore.getState();
    expect(state.fontFamily).toBe('sans');
    expect(state.fontSize).toBe(16);
    expect(state.showHint).toBe(true);
    expect(state.hintText).toBe('');
    expect(state.showBlockPlaceholders).toBe(true);
    expect(
      document.documentElement.style.getPropertyValue('--editor-font-size'),
    ).toBe('16px');
    expect(invoke).toHaveBeenCalledWith(
      'settings.set',
      expect.objectContaining({ key: 'ui.editor' }),
    );
  });
});
