import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { runMigrations } from './schema';

export { runMigrations };

let db: BetterSqlite3Database | null = null;

export function initDatabase(): { dbPath: string } {
  // If already initialized, return the last known path.
  if (db) {
    // better-sqlite3 exposes `.name` (string) on the db instance (not in typings).
    const existingPath =
      typeof (db as unknown as { name?: unknown }).name === 'string'
        ? ((db as unknown as { name: string }).name as string)
        : 'lychee.sqlite3';
    return { dbPath: existingPath };
  }

  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, 'lychee.sqlite3');
  const database = new Database(dbPath);

  runMigrations(database);

  db = database;
  return { dbPath };
}

export function getDb(): BetterSqlite3Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
