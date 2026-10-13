/**
 * Backup and restore.
 *
 * Backups go through SQLite's backup API rather than a file copy. With WAL
 * enabled, recent transactions can still be in `pos.db-wal`, so a copy of
 * `pos.db` alone can be missing the last sales of the day — exactly the ones a
 * shop would notice.
 *
 * Every backup is verified after it is written: integrity check, schema
 * version, and a row count against the source. A backup nobody checked is a
 * guess.
 *
 * Restore replaces the live database, but never before taking a copy of what
 * it is about to overwrite.
 */
import { join, basename, dirname, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import {
  backupRunSchema,
  restoreSchema,
  type BackupFile,
  type BackupInspection,
  type BackupResult,
  type RestoreResult,
} from '@shared/backup';
import type { AppSettings } from '@shared/settings';
import { getLatestVersion } from '../db/migrator';
import { AuditRepository } from '../db/repositories/audit';
import { SettingsService } from './settings-service';
import { loadBranchContext } from './branch-context';

export class BackupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupDeps {
  /** The live connection, re-read on each call because restore replaces it. */
  db: () => Db;
  dbPath: string;
  appVersion: string;
  /** Closes the live connection; used only by restore. */
  closeDb: () => void;
  /** Reopens it, running migrations, and returns the new connection. */
  openDb: () => Db;
}

const FILE_PREFIX = 'pos-backup-';
const FILE_SUFFIX = '.db';

/** `pos-backup-20261013-1432.db` — sorts chronologically as text. */
const fileNameFor = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
};

/**
 * Two backups in the same second would otherwise overwrite each other, and a
 * backup that silently replaced an earlier one is the opposite of the point.
 */
const uniquePath = (directory: string, date: Date): string => {
  const name = fileNameFor(date);
  let candidate = join(directory, name);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${name.slice(0, -FILE_SUFFIX.length)}-${n}${FILE_SUFFIX}`);
    n += 1;
  }
  return candidate;
};

const isBackupFile = (name: string): boolean =>
  name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX);

const withinDirectory = (parent: string, child: string): boolean => {
  const from = resolve(parent) + sep;
  const to = resolve(child) + sep;
  return to.startsWith(from);
};

const METADATA_TABLE = `
  CREATE TABLE IF NOT EXISTS backup_metadata (
    created_at     TEXT NOT NULL,
    app_version    TEXT,
    schema_version INTEGER,
    trigger        TEXT,
    source_path    TEXT
  )`;

export class BackupService {
  constructor(private readonly deps: BackupDeps) {}

  private settings(): AppSettings {
    const settings = new SettingsService(this.deps.db()).get();
    if (!settings) throw new BackupError('SETUP_INCOMPLETE', 'Complete setup first.');
    return settings;
  }

  /**
   * A backup inside the database folder is not a backup: the one thing it
   * cannot survive is losing that disk, which is the main thing it is for.
   */
  private resolveDirectory(override?: string | null): string {
    const configured = override ?? this.settings().backup.directory;
    if (!configured) {
      throw new BackupError('NO_DIRECTORY', 'Choose a folder for backups first.');
    }

    const dataDir = dirname(this.deps.dbPath);
    if (withinDirectory(dataDir, configured) || resolve(configured) === resolve(dataDir)) {
      throw new BackupError(
        'UNSAFE_DIRECTORY',
        'Choose a folder outside the application data folder — ideally on another drive.',
      );
    }

    if (!existsSync(configured)) mkdirSync(configured, { recursive: true });
    return configured;
  }

  async run(input: unknown): Promise<BackupResult> {
    const parsed = backupRunSchema.parse(input ?? {});
    const directory = this.resolveDirectory(parsed.directory ?? null);

    const db = this.deps.db();
    const schemaVersion = Number(db.pragma('user_version', { simple: true }));
    const sourceSales = (db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;

    const at = new Date();
    const path = uniquePath(directory, at);

    // SQLite's own backup: consistent even while the app is writing, and it
    // folds in anything still sitting in the WAL.
    await db.backup(path);

    this.stampAndVerify(path, {
      createdAt: at.toISOString(),
      schemaVersion,
      trigger: parsed.trigger,
      expectedSales: sourceSales,
    });

    const pruned = this.prune(directory, this.settings().backup.keepCount, path);

    new SettingsService(db).update({ backup: { lastRunAt: at.toISOString() } }, { audit: false });
    new AuditRepository(db).record({
      entityType: 'backup',
      entityId: null,
      action: 'create',
      operatorId: loadBranchContext(db)?.operatorId ?? null,
      details: { path, trigger: parsed.trigger, schemaVersion, sales: sourceSales },
    });

    return { file: this.describe(path), pruned };
  }

  /** Writes the provenance row, then checks the file is actually readable. */
  private stampAndVerify(
    path: string,
    meta: { createdAt: string; schemaVersion: number; trigger: string; expectedSales: number },
  ): void {
    const copy = new Database(path);
    try {
      const integrity = copy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new BackupError(
          'VERIFY_FAILED',
          `The backup failed its integrity check: ${integrity}`,
        );
      }

      const version = Number(copy.pragma('user_version', { simple: true }));
      if (version !== meta.schemaVersion) {
        throw new BackupError(
          'VERIFY_FAILED',
          'The backup does not match the live schema version.',
        );
      }

      const sales = (copy.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
      if (sales !== meta.expectedSales) {
        throw new BackupError(
          'VERIFY_FAILED',
          'The backup is missing sales that the database has.',
        );
      }

      copy.exec(METADATA_TABLE);
      // The file describes itself, not whatever it was restored from earlier.
      copy.prepare('DELETE FROM backup_metadata').run();
      copy
        .prepare(
          `INSERT INTO backup_metadata (created_at, app_version, schema_version, trigger, source_path)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          meta.createdAt,
          this.deps.appVersion,
          meta.schemaVersion,
          meta.trigger,
          this.deps.dbPath,
        );

      // The live database runs in WAL mode and the copy inherits it, so writing
      // the metadata row leaves a `-wal` beside the file. A backup has to be one
      // self-contained file: anything else can be copied to a pen drive without
      // its tail.
      copy.pragma('wal_checkpoint(TRUNCATE)');
      copy.pragma('journal_mode = DELETE');
    } catch (err) {
      copy.close();
      // A file that cannot be trusted must not be left looking like a backup.
      rmSync(path, { force: true });
      throw err;
    }
    copy.close();
  }

  /** Deletes the oldest backups beyond `keep`, never touching other files. */
  private prune(directory: string, keep: number, protect: string): string[] {
    const files = this.list(directory);
    const removable = files.filter((f) => resolve(f.path) !== resolve(protect));
    const pruned: string[] = [];

    for (const file of removable.slice(Math.max(0, keep - 1))) {
      rmSync(file.path, { force: true });
      pruned.push(file.path);
    }
    return pruned;
  }

  /** Backups in a folder, newest first. */
  list(directory?: string | null): BackupFile[] {
    const dir = directory ?? this.settings().backup.directory;
    if (!dir || !existsSync(dir)) return [];

    return (
      readdirSync(dir)
        .filter(isBackupFile)
        .map((name) => this.describe(join(dir, name)))
        // By the time inside the file, not the name: two backups in the same
        // second differ only by a suffix, which does not sort chronologically.
        .sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.fileName.localeCompare(a.fileName),
        )
    );
  }

  private describe(path: string): BackupFile {
    const stats = statSync(path);
    const meta = this.readMetadata(path);
    return {
      path,
      fileName: basename(path),
      sizeBytes: stats.size,
      createdAt: meta?.createdAt ?? stats.mtime.toISOString(),
      schemaVersion: meta?.schemaVersion ?? null,
      appVersion: meta?.appVersion ?? null,
      trigger: meta?.trigger ?? null,
    };
  }

  private readMetadata(path: string): {
    createdAt: string;
    appVersion: string | null;
    schemaVersion: number | null;
    trigger: string | null;
  } | null {
    let db: Db | null = null;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true });
      const row = db
        .prepare('SELECT created_at, app_version, schema_version, trigger FROM backup_metadata')
        .get() as
        | {
            created_at: string;
            app_version: string | null;
            schema_version: number | null;
            trigger: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        createdAt: row.created_at,
        appVersion: row.app_version,
        schemaVersion: row.schema_version,
        trigger: row.trigger,
      };
    } catch {
      // Not one of ours, or not readable. The caller decides what that means.
      return null;
    } finally {
      db?.close();
    }
  }

  /** Everything a restore needs to know before it is allowed to proceed. */
  inspect(path: string): BackupInspection {
    const fail = (reason: string): BackupInspection => ({
      path,
      valid: false,
      reason,
      schemaVersion: null,
      appVersion: null,
      createdAt: null,
      sales: null,
    });

    if (!existsSync(path)) return fail('That file no longer exists.');

    let db: Db | null = null;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true });

      if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
        return fail('This file is damaged and cannot be restored.');
      }

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[];
      const names = new Set(tables.map((t) => t.name));
      for (const required of ['sales', 'products', 'settings', 'schema_migrations']) {
        if (!names.has(required)) return fail('This file is not a backup of this application.');
      }

      const schemaVersion = Number(db.pragma('user_version', { simple: true }));
      if (schemaVersion > getLatestVersion()) {
        return fail(
          'This backup was made by a newer version of the app. Update first, then restore.',
        );
      }

      const sales = (db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
      const meta = this.readMetadata(path);

      return {
        path,
        valid: true,
        reason: null,
        schemaVersion,
        appVersion: meta?.appVersion ?? null,
        createdAt: meta?.createdAt ?? null,
        sales,
      };
    } catch {
      return fail('This file could not be read as a database.');
    } finally {
      db?.close();
    }
  }

  /**
   * Replaces the live database with a backup.
   *
   * The current database is copied first — if the restored file turns out to
   * be the wrong one, today's work is still on disk.
   */
  async restore(input: unknown): Promise<RestoreResult> {
    const parsed = restoreSchema.parse(input);

    const inspection = this.inspect(parsed.path);
    if (!inspection.valid) {
      throw new BackupError('INVALID_BACKUP', inspection.reason ?? 'That file cannot be restored.');
    }

    const db = this.deps.db();
    const safetyDir = join(dirname(this.deps.dbPath), 'pre-restore');
    if (!existsSync(safetyDir)) mkdirSync(safetyDir, { recursive: true });
    const safetyCopyPath = uniquePath(safetyDir, new Date());
    await db.backup(safetyCopyPath);

    this.deps.closeDb();

    // Stale WAL and shared-memory files belong to the database being replaced;
    // leaving them would let SQLite apply them over the restored file.
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${this.deps.dbPath}${suffix}`, { force: true });
    }
    copyFileSync(parsed.path, this.deps.dbPath);

    // Reopening migrates an older backup forward to the current schema.
    const restored = this.deps.openDb();
    const schemaVersion = Number(restored.pragma('user_version', { simple: true }));

    new AuditRepository(restored).record({
      entityType: 'backup',
      entityId: null,
      action: 'restore',
      operatorId: loadBranchContext(restored)?.operatorId ?? null,
      details: {
        restoredFrom: parsed.path,
        safetyCopyPath,
        fromSchemaVersion: inspection.schemaVersion,
        toSchemaVersion: schemaVersion,
        sales: inspection.sales,
      },
    });

    return {
      restoredFrom: parsed.path,
      safetyCopyPath,
      schemaVersion,
      migrated: (inspection.schemaVersion ?? schemaVersion) < schemaVersion,
    };
  }
}

/**
 * Whether an automatic backup is overdue.
 *
 * Checked at startup and hourly, so a shop that closes before the scheduled
 * hour still gets its backup the next time the till is switched on.
 */
export function isBackupDue(settings: AppSettings, now: Date): boolean {
  const { autoEnabled, directory, frequency, lastRunAt } = settings.backup;
  if (!autoEnabled || !directory) return false;
  if (!lastRunAt) return true;

  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;

  const interval = frequency === 'weekly' ? 7 * 86_400_000 : 86_400_000;
  return now.getTime() - last >= interval;
}
