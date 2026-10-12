import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, getCurrentVersion, getLatestVersion, getAppliedVersions } from '../migrator';
import { migrations } from '../migrations';
import { freshDb } from './helpers';

describe('migrator', () => {
  it('brings an empty database to the latest version', () => {
    const db = new Database(':memory:');
    expect(getCurrentVersion(db)).toBe(0);

    const result = migrate(db);

    expect(result.version).toBe(getLatestVersion());
    expect(result.applied).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  it('is idempotent: a second run applies nothing', () => {
    const db = new Database(':memory:');
    migrate(db);
    const second = migrate(db);

    expect(second.applied).toEqual([]);
    expect(second.version).toBe(getLatestVersion());
    db.close();
  });

  it('records every applied migration', () => {
    const db = freshDb();
    expect(getAppliedVersions(db)).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  it('mirrors the version into user_version', () => {
    const db = freshDb();
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(getLatestVersion());
    db.close();
  });

  it('creates every expected table', () => {
    const db = freshDb();
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);

    for (const table of [
      'schema_migrations',
      'companies',
      'branches',
      'operators',
      'settings',
      'units',
      'categories',
      'products',
      'customers',
      'invoice_sequences',
      'sales',
      'sale_items',
      'payments',
      'sales_returns',
      'sales_return_items',
      'inventory_movements',
      'audit_logs',
      'sync_queue',
    ]) {
      expect(names, `missing table: ${table}`).toContain(table);
    }
    db.close();
  });

  it('seeds the unit list with correct precision', () => {
    const db = freshDb();
    const units = db.prepare('SELECT code, decimal_places FROM units ORDER BY code').all() as {
      code: string;
      decimal_places: number;
    }[];

    expect(units.length).toBeGreaterThanOrEqual(9);
    // A piece cannot be sold in fractions; a kilogram can.
    expect(units.find((u) => u.code === 'pc')?.decimal_places).toBe(0);
    expect(units.find((u) => u.code === 'kg')?.decimal_places).toBe(3);
    db.close();
  });

  it('has no duplicate migration versions', () => {
    const versions = migrations.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('leaves foreign keys enabled after migrating', () => {
    const db = freshDb();
    expect(Number(db.pragma('foreign_keys', { simple: true }))).toBe(1);
    db.close();
  });
});
