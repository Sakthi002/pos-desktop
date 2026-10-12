import Database from 'better-sqlite3';
import { migrate } from '../migrator';

/** An in-memory database at the current schema version, configured like production. */
export function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export const ts = () => new Date().toISOString();
