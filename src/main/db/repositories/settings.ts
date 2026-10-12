import { Repository, now } from './base';

/**
 * Key/value settings, JSON-encoded.
 *
 * Settings describe how *future* transactions behave. A completed sale keeps
 * its own snapshot of anything that affected it, so changing a setting never
 * rewrites history.
 */
export class SettingsRepository extends Repository {
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now());
  }

  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  }

  has(key: string): boolean {
    const row = this.db.prepare('SELECT 1 AS present FROM settings WHERE key = ?').get(key);
    return row !== undefined;
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
