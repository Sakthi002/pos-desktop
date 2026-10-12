import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb, ts } from './helpers';
import { newId } from '../repositories/base';

let db: Database;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

/**
 * Proves every table in the schema accepts a write and returns it. Tables not
 * covered by the sale path in schema.test.ts are exercised here, so no table
 * ships untested.
 */
describe('every table round-trips', () => {
  it('covers the remaining tables', () => {
    const t = ts();
    const companyId = newId();
    const branchId = newId();
    const operatorId = newId();

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
    db.prepare(
      `INSERT INTO operators (id, branch_id, name, username, created_at, updated_at)
       VALUES (?, ?, 'Op', 'op', ?, ?)`,
    ).run(operatorId, branchId, t, t);

    // categories
    const categoryId = newId();
    db.prepare(
      'INSERT INTO categories (id, company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(categoryId, companyId, 'Grocery', t, t);

    // products (with category + unit references)
    const productId = newId();
    db.prepare(
      `INSERT INTO products (id, company_id, name, category_id, unit_code, price_paise, created_at, updated_at)
       VALUES (?, ?, 'Rice', ?, 'kg', 12000, ?, ?)`,
    ).run(productId, companyId, categoryId, t, t);

    // customers
    const customerId = newId();
    db.prepare(
      'INSERT INTO customers (id, company_id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(customerId, companyId, 'Ravi', '9876543210', t, t);

    // invoice_sequences
    db.prepare(
      `INSERT INTO invoice_sequences (branch_id, kind, financial_year, prefix, next_number)
       VALUES (?, 'sale', '2026-27', 'INV', 1)`,
    ).run(branchId);

    // sales + sale_items
    const saleId = newId();
    const saleItemId = newId();
    db.prepare(
      `INSERT INTO sales (id, company_id, branch_id, operator_id, customer_id, invoice_number,
         financial_year, invoice_date, tax_mode, gross_paise, taxable_paise, tax_paise,
         total_paise, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INV-0001', '2026-27', ?, 'inclusive', 12000, 11430, 570, 12000, ?, ?)`,
    ).run(saleId, companyId, branchId, operatorId, customerId, t, t, t);
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, line_no, product_id, name, unit_code,
         quantity_milli, unit_price_paise, taxable_paise, tax_rate_bp, tax_paise, total_paise, created_at)
       VALUES (?, ?, 1, ?, 'Rice', 'kg', 1000, 12000, 11430, 500, 570, 12000, ?)`,
    ).run(saleItemId, saleId, productId, t);

    // sales_returns + sales_return_items
    const returnId = newId();
    db.prepare(
      `INSERT INTO sales_returns (id, company_id, branch_id, sale_id, operator_id, return_number,
         financial_year, return_date, taxable_paise, tax_paise, total_paise, refund_method, created_at)
       VALUES (?, ?, ?, ?, ?, 'RET-0001', '2026-27', ?, 11430, 570, 12000, 'cash', ?)`,
    ).run(returnId, companyId, branchId, saleId, operatorId, t, t);
    db.prepare(
      `INSERT INTO sales_return_items (id, return_id, sale_item_id, product_id,
         quantity_milli, unit_price_paise, taxable_paise, tax_paise, total_paise, restocked, created_at)
       VALUES (?, ?, ?, ?, 1000, 12000, 11430, 570, 12000, 1, ?)`,
    ).run(newId(), returnId, saleItemId, productId, t);

    // payments: a sale payment and a refund against the return
    db.prepare(
      `INSERT INTO payments (id, sale_id, method, amount_paise, created_at) VALUES (?, ?, 'cash', 12000, ?)`,
    ).run(newId(), saleId, t);
    db.prepare(
      `INSERT INTO payments (id, return_id, method, amount_paise, created_at) VALUES (?, ?, 'cash', -12000, ?)`,
    ).run(newId(), returnId, t);

    // inventory_movements: sale out, return back in
    db.prepare(
      `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
         quantity_milli, reference_type, reference_id, operator_id, created_at)
       VALUES (?, ?, ?, ?, 'sale', -1000, 'sale', ?, ?, ?)`,
    ).run(newId(), companyId, branchId, productId, saleId, operatorId, t);
    db.prepare(
      `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
         quantity_milli, reference_type, reference_id, operator_id, created_at)
       VALUES (?, ?, ?, ?, 'sale_return', 1000, 'sales_return', ?, ?, ?)`,
    ).run(newId(), companyId, branchId, productId, returnId, operatorId, t);

    // audit_logs
    db.prepare(
      `INSERT INTO audit_logs (id, entity_type, entity_id, action, operator_id, details, created_at)
       VALUES (?, 'sale', ?, 'void', ?, ?, ?)`,
    ).run(newId(), saleId, operatorId, JSON.stringify({ reason: 'test' }), t);

    // settings
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      'shop.name',
      JSON.stringify('Shop'),
      t,
    );

    // sync_queue
    db.prepare(
      `INSERT INTO sync_queue (entity_type, entity_id, operation, payload, created_at)
       VALUES ('sale', ?, 'insert', ?, ?)`,
    ).run(saleId, JSON.stringify({ id: saleId }), t);

    // Assert every table holds what was written.
    const tables = [
      'companies',
      'branches',
      'operators',
      'settings',
      'categories',
      'products',
      'customers',
      'invoice_sequences',
      'sales',
      'sale_items',
      'sales_returns',
      'sales_return_items',
      'audit_logs',
      'sync_queue',
    ];
    for (const table of tables) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, `${table} should hold at least one row`).toBeGreaterThan(0);
    }

    expect((db.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n).toBe(2);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get() as { n: number }).n,
    ).toBe(2);

    // Sold then returned: the ledger nets to zero.
    const balance = db
      .prepare('SELECT SUM(quantity_milli) AS qty FROM inventory_movements WHERE product_id = ?')
      .get(productId) as { qty: number };
    expect(balance.qty).toBe(0);

    // And the schema is referentially intact after all of it.
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
