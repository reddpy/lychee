import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDITOR_PREFERENCES,
  parseStoredEditorPreferences,
  serializeEditorPreferences,
} from '../editor-preferences';

describe('editor preferences', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(parseStoredEditorPreferences(null)).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(parseStoredEditorPreferences('{not json')).toEqual(
      DEFAULT_EDITOR_PREFERENCES,
    );
    expect(parseStoredEditorPreferences('[]')).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('parses a valid stored object', () => {
    expect(
      parseStoredEditorPreferences(
        JSON.stringify({
          version: 1,
          fontFamily: 'serif',
          fontSize: 18,
          pageWidth: 'wide',
          lineHeight: 'relaxed',
          showWordCount: true,
          focusMode: true,
          typewriterMode: true,
          reduceMotion: true,
          codeTabSize: 4,
          autolink: false,
          slashMenu: false,
          showHint: false,
          hintText: 'Start writing',
          showBlockPlaceholders: false,
        }),
      ),
    ).toEqual({
      fontFamily: 'serif',
      fontSize: 18,
      pageWidth: 'wide',
      lineHeight: 'relaxed',
      showWordCount: true,
      focusMode: true,
      typewriterMode: true,
      reduceMotion: true,
      codeTabSize: 4,
      autolink: false,
      slashMenu: false,
      showHint: false,
      hintText: 'Start writing',
      showBlockPlaceholders: false,
    });
  });

  it('migrates the pre-split showPlaceholder/placeholderText keys', () => {
    expect(
      parseStoredEditorPreferences(
        JSON.stringify({ showPlaceholder: false, placeholderText: 'Legacy' }),
      ),
    ).toMatchObject({
      showHint: false,
      showBlockPlaceholders: false,
      hintText: 'Legacy',
    });
  });

  it('truncates an over-long custom hint', () => {
    const parsed = parseStoredEditorPreferences(
      JSON.stringify({ hintText: 'x'.repeat(500) }),
    );
    expect(parsed.hintText).toHaveLength(120);
  });

  it('clamps and rounds font size into range', () => {
    expect(parseStoredEditorPreferences(JSON.stringify({ fontSize: 2 })).fontSize).toBe(
      14,
    );
    expect(
      parseStoredEditorPreferences(JSON.stringify({ fontSize: 999 })).fontSize,
    ).toBe(20);
    expect(
      parseStoredEditorPreferences(JSON.stringify({ fontSize: 16.6 })).fontSize,
    ).toBe(17);
  });

  it('falls back for invalid enums and booleans', () => {
    expect(
      parseStoredEditorPreferences(
        JSON.stringify({
          fontFamily: 'comic',
          pageWidth: 'narrow',
          showWordCount: 'yes',
          codeTabSize: 3,
        }),
      ),
    ).toEqual({
      ...DEFAULT_EDITOR_PREFERENCES,
    });
  });

  it('accepts every configured code tab size and rejects the rest', () => {
    for (const size of [1, 2, 4, 8]) {
      expect(
        parseStoredEditorPreferences(JSON.stringify({ codeTabSize: size })).codeTabSize,
      ).toBe(size);
    }
    expect(
      parseStoredEditorPreferences(JSON.stringify({ codeTabSize: 3 })).codeTabSize,
    ).toBe(2);
  });

  it('round-trips through serialize/parse', () => {
    const preferences = {
      fontFamily: 'mono' as const,
      fontSize: 20,
      pageWidth: 'full' as const,
      lineHeight: 'compact' as const,
      showWordCount: true,
      focusMode: false,
      typewriterMode: true,
      reduceMotion: false,
      codeTabSize: 4,
      autolink: false,
      slashMenu: true,
      showHint: false,
      hintText: 'Write here',
      showBlockPlaceholders: true,
    };
    expect(parseStoredEditorPreferences(serializeEditorPreferences(preferences))).toEqual(
      preferences,
    );
  });
});
