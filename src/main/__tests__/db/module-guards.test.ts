/**
 * Tests for database module-level guards.
 *
 * Verifies that getDb() before init and double-close are handled safely.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));

describe('Database Module Guards', () => {
  it('getDb() throws before initDatabase() is called', async () => {
    vi.resetModules();
    const { getDb } = await import('../../db');
    expect(() => getDb()).toThrow('Database not initialized');
  });

  it('closeDatabase() is safe to call multiple times', async () => {
    vi.resetModules();
    const { closeDatabase } = await import('../../db');
    expect(() => {
      closeDatabase();
      closeDatabase();
    }).not.toThrow();
  });

  it('getDb() throws after closeDatabase()', async () => {
    vi.resetModules();
    const { initDatabase, getDb, closeDatabase } = await import('../../db');

    initDatabase();
    expect(() => getDb()).not.toThrow();

    closeDatabase();
    expect(() => getDb()).toThrow('Database not initialized');
  });

  it('initDatabase() returns dbPath on first call', async () => {
    vi.resetModules();
    const { initDatabase, closeDatabase } = await import('../../db');

    const result = initDatabase();
    expect(result).toHaveProperty('dbPath');
    expect(typeof result.dbPath).toBe('string');
    expect(result.dbPath).toContain('lychee.sqlite3');

    closeDatabase();
  });

  it('initDatabase() called twice returns without re-creating', async () => {
    vi.resetModules();
    const { initDatabase, closeDatabase } = await import('../../db');

    const first = initDatabase();
    const second = initDatabase();

    expect(second.dbPath).toBe(first.dbPath);

    closeDatabase();
  });
});
