/**
 * Forward-only migration runner.
 *
 * Migrations are applied in version order inside a transaction each. An applied
 * migration is never edited — a correction is a new migration. `user_version`
 * mirrors the highest applied version so the status readout is a single pragma.
 */
import type { Database } from 'better-sqlite3';
import { migrations } from './migrations';

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL
  )
`;

export interface MigrationResult {
  applied: number[];
  version: number;
}

export function getAppliedVersions(db: Database): number[] {
  db.exec(CREATE_MIGRATIONS_TABLE);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: number;
  }[];
  return rows.map((r) => r.version);
}

export function getCurrentVersion(db: Database): number {
  const applied = getAppliedVersions(db);
  return applied.length > 0 ? Math.max(...applied) : 0;
}

export function getLatestVersion(): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

export function migrate(db: Database): MigrationResult {
  db.exec(CREATE_MIGRATIONS_TABLE);

  const applied = new Set(getAppliedVersions(db));
  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  const justApplied: number[] = [];

  for (const migration of pending) {
    // Foreign keys cannot be toggled inside a transaction, so this sits outside.
    const fkWasOn = Number(db.pragma('foreign_keys', { simple: true })) === 1;
    if (fkWasOn) db.pragma('foreign_keys = OFF');

    const run = db.transaction(() => {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });

    try {
      run();
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }

    // A migration that leaves dangling references is a bug; fail loudly here
    // rather than at some unrelated query months later.
    const violations = db.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `Migration ${migration.version} (${migration.name}) left ${violations.length} foreign key violation(s)`,
      );
    }

    justApplied.push(migration.version);
  }

  const version = getCurrentVersion(db);
  db.pragma(`user_version = ${version}`);

  return { applied: justApplied, version };
}
