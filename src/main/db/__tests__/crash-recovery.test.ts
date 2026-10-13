import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { migrate } from '../migrator';
import { SetupService } from '../../services/setup-service';
import { CatalogueService } from '../../services/catalogue-service';
import { SaleService } from '../../services/sale-service';
import { defaultSettings } from '@shared/settings';

/**
 * Power cuts happen in a shop, and they happen mid-sale.
 *
 * A child process opens the same database, starts writing a sale, and is then
 * killed outright — no commit, no close, no chance to clean up. What matters is
 * what the next start finds: either the whole sale or none of it, never half,
 * and a database that still works.
 */
let dir: string;
let dbPath: string;
let db: Db;
let riceId: string;

const open = (): Db => {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  migrate(database);
  return database;
};

const count = (database: Db, table: string): number =>
  (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Writes half a sale, then kills its own process before committing. */
const CHILD = `
const Database = require(process.argv[2]);
const db = new Database(process.argv[3]);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const sale = db.prepare("SELECT * FROM sales LIMIT 1").get();
const t = new Date().toISOString();

db.exec('BEGIN IMMEDIATE');
db.prepare(
  "INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year, invoice_date," +
  " tax_mode, gross_paise, taxable_paise, total_paise, status, created_at, updated_at)" +
  " VALUES (@id, @company_id, @branch_id, 'INV-9999', '2026-27', @t, 'inclusive'," +
  " 10000, 9524, 10000, 'completed', @t, @t)"
).run({ id: process.argv[4], company_id: sale.company_id, branch_id: sale.branch_id, t });

db.prepare(
  "INSERT INTO sale_items (id, sale_id, line_no, name, unit_code, quantity_milli," +
  " unit_price_paise, taxable_paise, tax_rate_bp, total_paise, created_at)" +
  " VALUES (@id, @sale_id, 1, 'Interrupted line', 'pc', 1000, 10000, 9524, 500, 10000, @t)"
).run({ id: process.argv[5], sale_id: process.argv[4], t });

// The power goes out here: no commit, no close, no flush.
process.kill(process.pid, 'SIGKILL');
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pos-crash-'));
  dbPath = join(dir, 'pos.db');
  db = open();

  const base = defaultSettings('Crash Test Shop');
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

  // One committed sale, so the test can tell "lost everything" from "lost the
  // interrupted write".
  new SaleService(db).createSale({
    idempotencyKey: randomUUID(),
    lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash' as const, amountPaise: 10000 }],
  });
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // closed by the test itself
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('a write interrupted by a power cut', () => {
  it('leaves no half-written sale, and a database that still works', () => {
    const scriptPath = join(dir, 'crash.cjs');
    writeFileSync(scriptPath, CHILD);
    db.close();

    const orphanSaleId = randomUUID();
    const result = spawnSync(
      process.execPath,
      [scriptPath, require.resolve('better-sqlite3'), dbPath, orphanSaleId, randomUUID()],
      { encoding: 'utf8' },
    );

    // Killed, not exited cleanly.
    expect(result.signal).toBe('SIGKILL');

    db = open();

    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(count(db, 'sales')).toBe(1);
    expect(count(db, 'sale_items')).toBe(1);
    expect(db.prepare('SELECT id FROM sales WHERE id = ?').get(orphanSaleId)).toBeUndefined();

    // Still usable: the next customer can be billed.
    const receipt = new SaleService(db).createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash' as const, amountPaise: 20000 }],
    });

    expect(receipt.invoiceNumber).toBe('INV-0002');
    expect(count(db, 'sales')).toBe(2);
    // The interrupted attempt burned no invoice number.
    expect(
      db.prepare("SELECT id FROM sales WHERE invoice_number = 'INV-9999'").get(),
    ).toBeUndefined();
  });

  it('keeps stock consistent with the ledger afterwards', () => {
    const scriptPath = join(dir, 'crash.cjs');
    writeFileSync(scriptPath, CHILD);
    db.close();

    spawnSync(
      process.execPath,
      [scriptPath, require.resolve('better-sqlite3'), dbPath, randomUUID(), randomUUID()],
      { encoding: 'utf8' },
    );

    db = open();
    const catalogue = new CatalogueService(db);

    // 50 sold down by 1 in the committed sale; the interrupted one moved nothing.
    expect(catalogue.get(riceId)?.stockMilli).toBe(49000);
    expect(count(db, 'inventory_movements')).toBe(2);
  });
});
