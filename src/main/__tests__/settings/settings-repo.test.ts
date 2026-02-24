/**
 * Tests for the settings key-value repo (getSetting, setSetting, getAllSettings).
 *
 * Covers: basic CRUD, upsert behavior, defaults, bulk read, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb, getTestDb } from '../helpers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));

vi.mock('../../db', () => ({
  getDb: () => getTestDb(),
}));

import { getSetting, setSetting, getAllSettings } from '../../repos/settings';

describe('Settings Repo', () => {
  beforeEach(() => {
    createTestDb();
  });

  afterEach(() => {
    closeTestDb();
  });

  // ────────────────────────────────────────────────────────
  // getSetting
  // ────────────────────────────────────────────────────────

  it('returns default "light" for theme when key is not in DB', () => {
    expect(getSetting('theme')).toBe('light');
  });

  it('returns null for unknown key with no default', () => {
    expect(getSetting('nonexistent-key')).toBeNull();
  });

  it('returns the stored value after setSetting', () => {
    setSetting('theme', 'dark');
    expect(getSetting('theme')).toBe('dark');
  });

  // ────────────────────────────────────────────────────────
  // setSetting
  // ────────────────────────────────────────────────────────

  it('inserts a new key-value pair', () => {
    setSetting('editor.fontSize', '16');
    expect(getSetting('editor.fontSize')).toBe('16');
  });

  it('upserts: overwrites existing value on conflict', () => {
    setSetting('theme', 'dark');
    setSetting('theme', 'system');
    expect(getSetting('theme')).toBe('system');
  });

  it('can store and retrieve an empty string', () => {
    setSetting('empty', '');
    // SQLite stores empty string as '' not NULL
    const db = getTestDb();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('empty') as { value: string } | undefined;
    expect(row?.value).toBe('');
  });

  it('empty string does not fall through to default', () => {
    // theme default is 'light', but an explicit '' should win
    setSetting('theme', '');
    expect(getSetting('theme')).toBe('');
  });

  it('handles special characters in keys and values', () => {
    setSetting('key.with/special:chars', 'value with "quotes" & <angle>');
    expect(getSetting('key.with/special:chars')).toBe(
      'value with "quotes" & <angle>',
    );
  });

  // ────────────────────────────────────────────────────────
  // getAllSettings
  // ────────────────────────────────────────────────────────

  it('returns empty object when no settings stored', () => {
    expect(getAllSettings()).toEqual({});
  });

  it('returns all stored key-value pairs', () => {
    setSetting('theme', 'dark');
    setSetting('editor.fontSize', '14');
    setSetting('sidebar.width', '240');

    const all = getAllSettings();
    expect(all).toEqual({
      theme: 'dark',
      'editor.fontSize': '14',
      'sidebar.width': '240',
    });
  });

  it('reflects the latest value after multiple upserts', () => {
    setSetting('theme', 'dark');
    setSetting('theme', 'light');
    setSetting('theme', 'system');

    const all = getAllSettings();
    expect(all.theme).toBe('system');
  });

  // ────────────────────────────────────────────────────────
  // Defaults behavior
  // ────────────────────────────────────────────────────────

  it('stored value overrides the default', () => {
    // Default for theme is "light"
    expect(getSetting('theme')).toBe('light');
    setSetting('theme', 'dark');
    expect(getSetting('theme')).toBe('dark');
  });

  it('getAllSettings does not include defaults for unset keys', () => {
    // theme has a default but isn't in the DB yet
    const all = getAllSettings();
    expect(all).not.toHaveProperty('theme');
  });

  // ────────────────────────────────────────────────────────
  // Isolation — settings don't leak into other tables
  // ────────────────────────────────────────────────────────

  it('settings table is independent of meta table', () => {
    setSetting('schema_version', '999');
    // The meta table should be untouched
    const db = getTestDb();
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    expect(row.value).toBe('8');
    // Settings table has our value
    expect(getSetting('schema_version')).toBe('999');
  });
});
