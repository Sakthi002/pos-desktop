import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SettingsService } from '../settings-service';
import { SetupService } from '../setup-service';
import { defaultSettings, financialYearOf } from '@shared/settings';

let db: Database;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

describe('financial year', () => {
  it('runs April to March', () => {
    expect(financialYearOf(new Date('2026-04-01'))).toBe('2026-27');
    expect(financialYearOf(new Date('2026-12-31'))).toBe('2026-27');
    expect(financialYearOf(new Date('2027-03-31'))).toBe('2026-27');
    // 1 April rolls to the next year.
    expect(financialYearOf(new Date('2027-04-01'))).toBe('2027-28');
  });

  it('puts January in the previous year', () => {
    expect(financialYearOf(new Date('2026-01-15'))).toBe('2025-26');
  });

  it('honours a different start month', () => {
    expect(financialYearOf(new Date('2026-02-01'), 1)).toBe('2026-27');
  });
});

describe('setup', () => {
  it('reports incomplete on a fresh database', () => {
    const state = new SetupService(db).getState();
    expect(state).toEqual({ isComplete: false, companyId: null, branchId: null });
  });

  it('creates every record the app depends on', () => {
    const result = new SetupService(db).complete(defaultSettings('Sharma Store'));

    const company = db
      .prepare('SELECT name, state_code FROM companies WHERE id = ?')
      .get(result.companyId);
    expect(company).toEqual({ name: 'Sharma Store', state_code: '33' });

    const branch = db.prepare('SELECT code, name FROM branches WHERE id = ?').get(result.branchId);
    expect(branch).toEqual({ code: 'MAIN', name: 'Sharma Store' });

    const operator = db.prepare('SELECT role FROM operators WHERE id = ?').get(result.operatorId);
    expect(operator).toEqual({ role: 'admin' });

    // Billing needs a walk-in customer to exist from day one.
    const walkIn = db.prepare('SELECT name FROM customers WHERE is_walk_in = 1').get();
    expect(walkIn).toEqual({ name: 'Walk-in Customer' });

    // Both sequences, so a return can be numbered without a later migration.
    const sequences = db
      .prepare('SELECT kind, prefix, next_number FROM invoice_sequences ORDER BY kind')
      .all();
    expect(sequences).toEqual([
      { kind: 'return', prefix: 'INV-RET', next_number: 1 },
      { kind: 'sale', prefix: 'INV', next_number: 1 },
    ]);
  });

  it('marks setup complete and persists settings', () => {
    const settings = new SettingsService(db);
    expect(settings.isSetupComplete()).toBe(false);
    expect(settings.get()).toBeNull();

    new SetupService(db).complete(defaultSettings('Test Shop'));

    expect(settings.isSetupComplete()).toBe(true);
    expect(settings.get()?.shop.name).toBe('Test Shop');
  });

  it('writes an audit entry', () => {
    new SetupService(db).complete(defaultSettings('Audited Shop'));
    const row = db.prepare("SELECT action FROM audit_logs WHERE entity_type = 'setup'").get();
    expect(row).toEqual({ action: 'completed' });
  });

  it('refuses to run twice', () => {
    const service = new SetupService(db);
    service.complete(defaultSettings('First'));
    expect(() => service.complete(defaultSettings('Second'))).toThrow(/already been completed/i);
  });

  it('leaves the database untouched when setup fails', () => {
    const invalid = {
      ...defaultSettings('Shop'),
      shop: { ...defaultSettings('Shop').shop, stateCode: 'XX' },
    };

    expect(() => new SetupService(db).complete(invalid)).toThrow();

    // Nothing partial survives: no company, no branch, no settings.
    expect((db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM branches').get() as { n: number }).n).toBe(0);
    expect(new SettingsService(db).isSetupComplete()).toBe(false);
  });

  it('stores the state name alongside the code', () => {
    const result = new SetupService(db).complete({
      ...defaultSettings('Mumbai Store'),
      shop: { ...defaultSettings('Mumbai Store').shop, stateCode: '27' },
    });
    const company = db
      .prepare('SELECT state, state_code FROM companies WHERE id = ?')
      .get(result.companyId);
    expect(company).toEqual({ state: 'Maharashtra', state_code: '27' });
  });
});
