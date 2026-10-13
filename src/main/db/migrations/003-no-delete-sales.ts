import type { Migration } from './types';

/**
 * A completed sale is a legal record, not a row.
 *
 * The application never deletes one — it voids it, which keeps the invoice
 * number, the stored snapshot and the audit trail. These triggers make that a
 * property of the database rather than a habit of the code above it, so a
 * future handler, a bad migration or someone with a SQLite console cannot
 * quietly remove history. Correcting a sale means voiding it and billing again.
 */
export const migration003: Migration = {
  version: 3,
  name: 'no-delete-sales',
  up: `
CREATE TRIGGER trg_sales_no_delete BEFORE DELETE ON sales
BEGIN
  SELECT RAISE(ABORT, 'sales cannot be deleted — void the sale instead');
END;

CREATE TRIGGER trg_sale_items_no_delete BEFORE DELETE ON sale_items
BEGIN
  SELECT RAISE(ABORT, 'sale items cannot be deleted — void the sale instead');
END;

CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments cannot be deleted');
END;
`,
};
