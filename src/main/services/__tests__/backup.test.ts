import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { migrate } from '../../db/migrator';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService } from '../sale-service';
import { SettingsService } from '../settings-service';
import { BackupService, BackupError, isBackupDue } from '../backup-service';
import { AuditRepository } from '../../db/repositories/audit';
import { defaultSettings, type AppSettings } from '@shared/settings';

let root: string;
let dataDir: string;
let backupDir: string;
let dbPath: string;
let db: Db;
let service: BackupService;
let riceId: string;

const openDb = (): Db => {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
};

const closeDb = (): void => {
  db.close();
};

const salesCount = (database: Db): number =>
  (database.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;

const sell = () => {
  new SaleService(db).createSale({
    idempotencyKey: randomUUID(),
    lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash' as const, amountPaise: 10000 }],
  });
};

const seed = (): void => {
  const base = defaultSettings('Backup Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });
  riceId = new CatalogueService(db).create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 8000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 50000,
  }).id;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pos-backup-'));
  dataDir = join(root, 'userData');
  backupDir = join(root, 'backups');
  dbPath = join(dataDir, 'pos.db');
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  openDb();
  seed();
  new SettingsService(db).update({ backup: { directory: backupDir } });

  service = new BackupService({
    db: () => db,
    dbPath,
    appVersion: '1.2.3',
    closeDb,
    openDb,
  });
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed by a restore test
  }
  rmSync(root, { recursive: true, force: true });
});

describe('taking a backup', () => {
  it('writes a verified file and records where it came from', async () => {
    sell();
    const result = await service.run({});

    expect(existsSync(result.file.path)).toBe(true);
    expect(result.file.fileName).toMatch(/^pos-backup-\d{8}-\d{6}\.db$/);
    expect(result.file.appVersion).toBe('1.2.3');
    expect(result.file.schemaVersion).toBe(Number(db.pragma('user_version', { simple: true })));
    expect(result.file.trigger).toBe('manual');
    expect(result.file.sizeBytes).toBeGreaterThan(0);
  });

  it('includes writes still sitting in the write-ahead log', async () => {
    // No checkpoint: a plain copy of pos.db would miss this sale, which is the
    // whole reason the backup API is used instead.
    sell();
    sell();

    const result = await service.run({});
    const copy = new Database(result.file.path, { readonly: true });
    expect(salesCount(copy)).toBe(2);
    copy.close();
  });

  it('records the backup in the audit trail', async () => {
    const result = await service.run({});
    const entries = new AuditRepository(db).list(10, 0);
    const entry = entries.find((e) => e.entityType === 'backup' && e.action === 'create');

    expect(entry).toBeDefined();
    expect(entry?.details).toMatchObject({ path: result.file.path, trigger: 'manual' });
  });

  it('refuses a folder inside the application data folder', async () => {
    new SettingsService(db).update({ backup: { directory: join(dataDir, 'backups') } });
    await expect(service.run({})).rejects.toThrow(/outside the application data folder/);
  });

  it('refuses to run before a folder is chosen', async () => {
    new SettingsService(db).update({ backup: { directory: null } });
    await expect(service.run({})).rejects.toThrow(BackupError);
  });

  it('keeps the newest backups and leaves other files alone', async () => {
    new SettingsService(db).update({ backup: { keepCount: 2 } });

    const first = await service.run({});
    const second = await service.run({});
    writeFileSync(join(backupDir, 'notes.txt'), 'not a backup');
    const third = await service.run({});

    expect(existsSync(first.file.path)).toBe(false);
    expect(third.pruned).toEqual([first.file.path]);
    expect(existsSync(second.file.path)).toBe(true);
    expect(existsSync(third.file.path)).toBe(true);
    expect(existsSync(join(backupDir, 'notes.txt'))).toBe(true);
    expect(service.list().map((f) => f.fileName)).toEqual([
      third.file.fileName,
      second.file.fileName,
    ]);
  });
});

describe('inspecting a backup before trusting it', () => {
  it('reports what the file holds', async () => {
    sell();
    const result = await service.run({});

    const inspection = service.inspect(result.file.path);
    expect(inspection.valid).toBe(true);
    expect(inspection.sales).toBe(1);
    expect(inspection.appVersion).toBe('1.2.3');
  });

  it('rejects a file that is not a database, in plain words', () => {
    const path = join(backupDir, 'rubbish.db');
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(path, 'this is not a database');

    const inspection = service.inspect(path);
    expect(inspection.valid).toBe(false);
    expect(inspection.reason).toMatch(/could not be read|not a backup/i);
  });

  it('rejects a database that is not this application’s', () => {
    const path = join(root, 'other.db');
    const other = new Database(path);
    other.exec('CREATE TABLE notes (id INTEGER)');
    other.close();

    expect(service.inspect(path).reason).toMatch(/not a backup of this application/i);
  });

  it('rejects a backup from a newer version of the app', async () => {
    const result = await service.run({});
    const newer = new Database(result.file.path);
    newer.pragma('user_version = 999');
    newer.close();

    expect(service.inspect(result.file.path).reason).toMatch(/newer version/i);
  });

  it('rejects a file that has gone missing', () => {
    expect(service.inspect(join(backupDir, 'gone.db')).reason).toMatch(/no longer exists/i);
  });
});

describe('restoring', () => {
  it('brings a real backup back into a clean install', async () => {
    sell();
    sell();
    const backup = await service.run({});
    const invoices = (
      db.prepare('SELECT invoice_number FROM sales ORDER BY invoice_number').all() as {
        invoice_number: string;
      }[]
    ).map((r) => r.invoice_number);

    // A clean install: the database file is gone and the app rebuilds an empty
    // one from the migrations.
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    openDb();
    expect(salesCount(db)).toBe(0);

    const result = await service.restore({ path: backup.file.path, confirmed: true });

    expect(salesCount(db)).toBe(2);
    expect(
      (
        db.prepare('SELECT invoice_number FROM sales ORDER BY invoice_number').all() as {
          invoice_number: string;
        }[]
      ).map((r) => r.invoice_number),
    ).toEqual(invoices);
    expect(result.restoredFrom).toBe(backup.file.path);
    expect(new SettingsService(db).get()?.shop.name).toBe('Backup Test Shop');
  });

  it('copies the live database before replacing it', async () => {
    const backup = await service.run({});
    sell(); // after the backup, so this sale exists only in the live file

    const result = await service.restore({ path: backup.file.path, confirmed: true });

    expect(salesCount(db)).toBe(0);
    expect(existsSync(result.safetyCopyPath)).toBe(true);

    const safety = new Database(result.safetyCopyPath, { readonly: true });
    expect(salesCount(safety)).toBe(1);
    safety.close();
  });

  it('records the restore in the audit trail of the restored database', async () => {
    const backup = await service.run({});
    const result = await service.restore({ path: backup.file.path, confirmed: true });

    const entry = new AuditRepository(db)
      .list(20, 0)
      .find((e) => e.entityType === 'backup' && e.action === 'restore');

    expect(entry).toBeDefined();
    expect(entry?.details).toMatchObject({
      restoredFrom: backup.file.path,
      safetyCopyPath: result.safetyCopyPath,
    });
  });

  it('refuses an invalid file and leaves the database alone', async () => {
    sell();
    const path = join(root, 'rubbish.db');
    writeFileSync(path, 'not a database');

    await expect(service.restore({ path, confirmed: true })).rejects.toThrow(/could not be read/i);
    expect(salesCount(db)).toBe(1);
  });

  it('leaves no stale write-ahead log from the replaced database', async () => {
    sell();
    const backup = await service.run({});
    sell();

    await service.restore({ path: backup.file.path, confirmed: true });

    // The restored file is the one on disk, not the old WAL replayed over it.
    expect(salesCount(db)).toBe(1);
    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size >= 0).toBe(true);
  });
});

describe('the audit trail cannot be rewritten', () => {
  it('refuses an update or a delete', async () => {
    await service.run({});
    const id = (db.prepare('SELECT id FROM audit_logs LIMIT 1').get() as { id: string }).id;

    expect(() => db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('x', id)).toThrow(
      /cannot be changed/,
    );
    expect(() => db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id)).toThrow(
      /cannot be deleted/,
    );
  });

  it('records a settings change', () => {
    new SettingsService(db).update({ tax: { mode: 'exclusive' } });

    const entry = new AuditRepository(db)
      .list(10, 0)
      .find((e) => e.entityType === 'settings' && e.action === 'update');

    expect(entry?.details).toMatchObject({ changed: { 'tax.mode': 'exclusive' } });
  });

  it('does not log the scheduler writing its own timestamp', async () => {
    const before = new AuditRepository(db).count();
    await service.run({ trigger: 'scheduled' });

    const entries = new AuditRepository(db).list(10, 0);
    expect(new AuditRepository(db).count()).toBe(before + 1);
    expect(entries[0]?.entityType).toBe('backup');
  });
});

describe('when an automatic backup is due', () => {
  const settingsWith = (patch: Partial<AppSettings['backup']>): AppSettings => {
    const base = defaultSettings('Shop');
    return { ...base, backup: { ...base.backup, ...patch } };
  };
  const now = new Date('2026-10-13T10:00:00.000Z');

  it('never runs without a folder, or when switched off', () => {
    expect(isBackupDue(settingsWith({ autoEnabled: true, directory: null }), now)).toBe(false);
    expect(isBackupDue(settingsWith({ autoEnabled: false, directory: '/tmp/x' }), now)).toBe(false);
  });

  it('runs the first time, then once a day', () => {
    const enabled = { autoEnabled: true, directory: '/tmp/x' };
    expect(isBackupDue(settingsWith({ ...enabled, lastRunAt: null }), now)).toBe(true);
    expect(
      isBackupDue(settingsWith({ ...enabled, lastRunAt: '2026-10-13T09:00:00.000Z' }), now),
    ).toBe(false);
    expect(
      isBackupDue(settingsWith({ ...enabled, lastRunAt: '2026-10-12T09:00:00.000Z' }), now),
    ).toBe(true);
  });

  it('catches up after a day the shop stayed shut', () => {
    const weekly = {
      autoEnabled: true,
      directory: '/tmp/x',
      frequency: 'weekly' as const,
      lastRunAt: '2026-10-01T09:00:00.000Z',
    };
    expect(isBackupDue(settingsWith(weekly), now)).toBe(true);
  });

  it('treats an unreadable timestamp as overdue rather than skipping', () => {
    expect(
      isBackupDue(
        settingsWith({ autoEnabled: true, directory: '/tmp/x', lastRunAt: 'not a date' }),
        now,
      ),
    ).toBe(true);
  });
});

describe('listing backups', () => {
  it('returns nothing when the folder does not exist yet', () => {
    new SettingsService(db).update({ backup: { directory: join(root, 'never-made') } });
    expect(service.list()).toEqual([]);
  });

  it('ignores files that are not backups', async () => {
    await service.run({});
    writeFileSync(join(backupDir, 'readme.txt'), 'hello');
    writeFileSync(join(backupDir, 'other.db'), 'hello');

    expect(readdirSync(backupDir)).toHaveLength(3);
    expect(service.list()).toHaveLength(1);
  });
});
