/**
 * SQLite connection.
 *
 * The database lives in Electron's per-user data directory, never the install
 * directory, so application updates cannot overwrite a shop's data.
 */
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { DbStatus } from '@shared/ipc-contract';
import { migrate, getLatestVersion } from './migrator';

let db: Database.Database | null = null;

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'pos.db');
}

export function openDatabase(): Database.Database {
  if (db) return db;

  db = new Database(getDatabasePath());

  // WAL survives crashes better and allows reads during writes.
  db.pragma('journal_mode = WAL');
  // Off by default in SQLite; the schema relies on it.
  db.pragma('foreign_keys = ON');
  // Wait rather than fail immediately if another connection holds a lock.
  db.pragma('busy_timeout = 5000');
  // Durable enough with WAL, and much faster than FULL.
  db.pragma('synchronous = NORMAL');

  const result = migrate(db);
  if (result.applied.length > 0) {
    console.log(`[db] applied migrations: ${result.applied.join(', ')} (now v${result.version})`);
  }

  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  // Fold the WAL back into the main file so a copy of pos.db is complete.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  db = null;
}

/**
 * Closes and reopens the connection, applying any migrations the file needs.
 * Used by restore, which replaces the file underneath this process.
 */
export function reopenDatabase(): Database.Database {
  closeDatabase();
  return openDatabase();
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database is not open');
  return db;
}

export function getDbStatus(): DbStatus {
  const path = getDatabasePath();
  if (!db) {
    return {
      connected: false,
      path,
      schemaVersion: 0,
      latestSchemaVersion: getLatestVersion(),
      journalMode: 'unknown',
      foreignKeys: false,
    };
  }

  const journalMode = String(db.pragma('journal_mode', { simple: true }));
  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  const schemaVersion = Number(db.pragma('user_version', { simple: true }));

  return {
    connected: true,
    path,
    schemaVersion,
    latestSchemaVersion: getLatestVersion(),
    journalMode,
    foreignKeys,
  };
}
