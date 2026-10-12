import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb, ts } from './helpers';
import { newId } from '../repositories/base';

let db: Database;

/** Minimal company + branch + operator, the spine every other row hangs off. */
function seedSpine() {
  const companyId = newId();
  const branchId = newId();
  const operatorId = newId();
  const t = ts();

  db.prepare(
    `INSERT INTO companies (id, name, state_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(companyId, 'Test Store', '33', t, t);

  db.prepare(
    `INSERT INTO branches (id, company_id, code, name, state_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(branchId, companyId, 'MAIN', 'Main', '33', t, t);

  db.prepare(
    `INSERT INTO operators (id, branch_id, name, username, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(operatorId, branchId, 'Cashier', 'cashier', t, t);

  return { companyId, branchId, operatorId };
}

function seedProduct(companyId: string, overrides: Record<string, unknown> = {}) {
  const id = newId();
  const t = ts();
  const row = {
    sku: `SKU-${id.slice(0, 8)}`,
    barcode: null as string | null,
    name: 'Test Product',
    unit_code: 'pc',
    cost_paise: 5000,
    price_paise: 9900,
    tax_rate_bp: 1800,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO products (id, company_id, sku, barcode, name, unit_code,
       cost_paise, price_paise, tax_rate_bp, created_at, updated_at)
     VALUES (@id, @company_id, @sku, @barcode, @name, @unit_code,
       @cost_paise, @price_paise, @tax_rate_bp, @created_at, @updated_at)`,
  ).run({ id, company_id: companyId, created_at: t, updated_at: t, ...row });
  return id;
}

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

describe('schema round-trip', () => {
  it('stores and reads a company, branch and operator', () => {
    const { companyId, branchId, operatorId } = seedSpine();

    expect(db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId)).toEqual({
      name: 'Test Store',
    });
    expect(db.prepare('SELECT code FROM branches WHERE id = ?').get(branchId)).toEqual({
      code: 'MAIN',
    });
    expect(db.prepare('SELECT username FROM operators WHERE id = ?').get(operatorId)).toEqual({
      username: 'cashier',
    });
  });

  it('stores a complete sale with items, payment and stock movement', () => {
    const { companyId, branchId, operatorId } = seedSpine();
    const productId = seedProduct(companyId);
    const saleId = newId();
    const t = ts();

    db.prepare(
      `INSERT INTO sales (id, company_id, branch_id, operator_id, invoice_number, financial_year,
         invoice_date, tax_mode, gross_paise, taxable_paise, tax_paise, total_paise,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'inclusive', 9900, 8390, 1510, 9900, ?, ?)`,
    ).run(saleId, companyId, branchId, operatorId, 'INV-001', '2026-27', t, t, t);

    db.prepare(
      `INSERT INTO sale_items (id, sale_id, line_no, product_id, name, unit_code,
         quantity_milli, unit_price_paise, taxable_paise, tax_rate_bp, tax_paise, total_paise, created_at)
       VALUES (?, ?, 1, ?, 'Test Product', 'pc', 1000, 9900, 8390, 1800, 1510, 9900, ?)`,
    ).run(newId(), saleId, productId, t);

    db.prepare(
      `INSERT INTO payments (id, sale_id, method, amount_paise, tendered_paise, change_paise, created_at)
       VALUES (?, ?, 'cash', 9900, 10000, 100, ?)`,
    ).run(newId(), saleId, t);

    db.prepare(
      `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
         quantity_milli, reference_type, reference_id, created_at)
       VALUES (?, ?, ?, ?, 'sale', -1000, 'sale', ?, ?)`,
    ).run(newId(), companyId, branchId, productId, saleId, t);

    const sale = db
      .prepare('SELECT invoice_number, total_paise, status FROM sales WHERE id = ?')
      .get(saleId);
    expect(sale).toEqual({ invoice_number: 'INV-001', total_paise: 9900, status: 'completed' });

    const balance = db
      .prepare(
        'SELECT COALESCE(SUM(quantity_milli), 0) AS qty FROM inventory_movements WHERE product_id = ?',
      )
      .get(productId) as { qty: number };
    expect(balance.qty).toBe(-1000);
  });

  it('rejects a duplicate invoice number within a branch', () => {
    const { companyId, branchId } = seedSpine();
    const t = ts();
    const insert = (id: string) =>
      db
        .prepare(
          `INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year,
             invoice_date, tax_mode, gross_paise, taxable_paise, total_paise, created_at, updated_at)
           VALUES (?, ?, ?, 'INV-001', '2026-27', ?, 'inclusive', 100, 100, 100, ?, ?)`,
        )
        .run(id, companyId, branchId, t, t, t);

    insert(newId());
    expect(() => insert(newId())).toThrow(/UNIQUE/i);
  });

  it('enforces foreign keys', () => {
    const t = ts();
    expect(() =>
      db
        .prepare(
          `INSERT INTO branches (id, company_id, code, name, created_at, updated_at)
           VALUES (?, 'does-not-exist', 'X', 'X', ?, ?)`,
        )
        .run(newId(), t, t),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('refuses to delete a product referenced by a sale', () => {
    const { companyId, branchId } = seedSpine();
    const productId = seedProduct(companyId);
    const saleId = newId();
    const t = ts();

    db.prepare(
      `INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year,
         invoice_date, tax_mode, gross_paise, taxable_paise, total_paise, created_at, updated_at)
       VALUES (?, ?, ?, 'INV-900', '2026-27', ?, 'inclusive', 100, 100, 100, ?, ?)`,
    ).run(saleId, companyId, branchId, t, t, t);

    db.prepare(
      `INSERT INTO sale_items (id, sale_id, line_no, product_id, name, unit_code,
         quantity_milli, unit_price_paise, taxable_paise, tax_rate_bp, total_paise, created_at)
       VALUES (?, ?, 1, ?, 'Test Product', 'pc', 1000, 100, 100, 0, 100, ?)`,
    ).run(newId(), saleId, productId, t);

    expect(() => db.prepare('DELETE FROM products WHERE id = ?').run(productId)).toThrow(
      /FOREIGN KEY/i,
    );
  });

  it('allows exactly one walk-in customer per company', () => {
    const { companyId } = seedSpine();
    const t = ts();
    const insertWalkIn = () =>
      db
        .prepare(
          `INSERT INTO customers (id, company_id, name, is_walk_in, created_at, updated_at)
           VALUES (?, ?, 'Walk-in', 1, ?, ?)`,
        )
        .run(newId(), companyId, t, t);

    insertWalkIn();
    expect(insertWalkIn).toThrow(/UNIQUE/i);
  });

  it('allows repeated NULL SKUs but rejects a duplicate value', () => {
    const { companyId } = seedSpine();
    seedProduct(companyId, { sku: null });
    seedProduct(companyId, { sku: null });

    seedProduct(companyId, { sku: 'DUPLICATE' });
    expect(() => seedProduct(companyId, { sku: 'DUPLICATE' })).toThrow(/UNIQUE/i);
  });

  it('rejects a zero-quantity stock movement', () => {
    const { companyId, branchId } = seedSpine();
    const productId = seedProduct(companyId);
    expect(() =>
      db
        .prepare(
          `INSERT INTO inventory_movements (id, company_id, branch_id, product_id,
             movement_type, quantity_milli, created_at)
           VALUES (?, ?, ?, ?, 'adjustment', 0, ?)`,
        )
        .run(newId(), companyId, branchId, productId, ts()),
    ).toThrow(/CHECK/i);
  });

  it('rejects an unknown payment method', () => {
    const { companyId, branchId } = seedSpine();
    const saleId = newId();
    const t = ts();
    db.prepare(
      `INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year,
         invoice_date, tax_mode, gross_paise, taxable_paise, total_paise, created_at, updated_at)
       VALUES (?, ?, ?, 'INV-777', '2026-27', ?, 'inclusive', 100, 100, 100, ?, ?)`,
    ).run(saleId, companyId, branchId, t, t, t);

    expect(() =>
      db
        .prepare(
          `INSERT INTO payments (id, sale_id, method, amount_paise, created_at)
           VALUES (?, ?, 'crypto', 100, ?)`,
        )
        .run(newId(), saleId, t),
    ).toThrow(/CHECK/i);
  });

  it('requires a payment to belong to a sale or a return', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO payments (id, method, amount_paise, created_at) VALUES (?, 'cash', 100, ?)`,
        )
        .run(newId(), ts()),
    ).toThrow(/CHECK/i);
  });
});
