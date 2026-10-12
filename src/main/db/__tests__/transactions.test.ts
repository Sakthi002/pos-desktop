import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb, ts } from './helpers';
import { newId, inTransaction } from '../repositories/base';
import { SettingsRepository } from '../repositories/settings';

let db: Database;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

describe('transactions', () => {
  it('commits every statement on success', () => {
    const companyId = newId();
    const t = ts();

    inTransaction(db, () => {
      db.prepare(
        'INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(companyId, 'Shop', t, t);
      db.prepare(
        `INSERT INTO branches (id, company_id, code, name, created_at, updated_at)
         VALUES (?, ?, 'MAIN', 'Main', ?, ?)`,
      ).run(newId(), companyId, t, t);
    });

    const counts = db
      .prepare('SELECT (SELECT COUNT(*) FROM companies) AS c, (SELECT COUNT(*) FROM branches) AS b')
      .get() as { c: number; b: number };
    expect(counts).toEqual({ c: 1, b: 1 });
  });

  it('rolls back every statement when one fails', () => {
    const companyId = newId();
    const t = ts();

    expect(() =>
      inTransaction(db, () => {
        db.prepare(
          'INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ).run(companyId, 'Shop', t, t);
        // Violates the foreign key: the whole transaction must unwind.
        db.prepare(
          `INSERT INTO branches (id, company_id, code, name, created_at, updated_at)
           VALUES (?, 'missing-company', 'MAIN', 'Main', ?, ?)`,
        ).run(newId(), t, t);
      }),
    ).toThrow();

    const company = db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
    expect(company.n, 'the earlier insert must not survive').toBe(0);
  });

  it('rolls back a partial sale, leaving no orphan header', () => {
    const companyId = newId();
    const branchId = newId();
    const saleId = newId();
    const t = ts();

    db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      companyId,
      'Shop',
      t,
      t,
    );
    db.prepare(
      `INSERT INTO branches (id, company_id, code, name, created_at, updated_at)
       VALUES (?, ?, 'MAIN', 'Main', ?, ?)`,
    ).run(branchId, companyId, t, t);

    expect(() =>
      inTransaction(db, () => {
        db.prepare(
          `INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year,
             invoice_date, tax_mode, gross_paise, taxable_paise, total_paise, created_at, updated_at)
           VALUES (?, ?, ?, 'INV-001', '2026-27', ?, 'inclusive', 100, 100, 100, ?, ?)`,
        ).run(saleId, companyId, branchId, t, t, t);

        // Negative quantity violates the CHECK on sale_items.
        db.prepare(
          `INSERT INTO sale_items (id, sale_id, line_no, name, unit_code,
             quantity_milli, unit_price_paise, taxable_paise, tax_rate_bp, total_paise, created_at)
           VALUES (?, ?, 1, 'Bad', 'pc', -5, 100, 100, 0, 100, ?)`,
        ).run(newId(), saleId, t);
      }),
    ).toThrow();

    const sales = db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
    expect(sales.n, 'no sale header without its lines').toBe(0);
  });
});

describe('settings repository', () => {
  it('round-trips values of several types', () => {
    const settings = new SettingsRepository(db);

    settings.set('shop.name', 'Sharma Store');
    settings.set('tax.inclusive', true);
    settings.set('invoice.start', 1001);
    settings.set('payment.methods', ['cash', 'upi']);

    expect(settings.get<string>('shop.name')).toBe('Sharma Store');
    expect(settings.get<boolean>('tax.inclusive')).toBe(true);
    expect(settings.get<number>('invoice.start')).toBe(1001);
    expect(settings.get<string[]>('payment.methods')).toEqual(['cash', 'upi']);
  });

  it('returns undefined for an unset key', () => {
    expect(new SettingsRepository(db).get('nope')).toBeUndefined();
  });

  it('overwrites on repeated set rather than inserting twice', () => {
    const settings = new SettingsRepository(db);
    settings.set('shop.name', 'First');
    settings.set('shop.name', 'Second');

    expect(settings.get<string>('shop.name')).toBe('Second');
    const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('reports presence and deletes', () => {
    const settings = new SettingsRepository(db);
    expect(settings.has('setup.complete')).toBe(false);
    settings.set('setup.complete', false);
    // Present, even though the value itself is false.
    expect(settings.has('setup.complete')).toBe(true);
    settings.delete('setup.complete');
    expect(settings.has('setup.complete')).toBe(false);
  });
});
