import type { Migration } from './types';

/**
 * Returns: the GST split, a duplicate guard, and the same delete protection
 * sales already have.
 *
 * The original tables stored only `tax_paise`. A credit note has to reverse the
 * exact heads the invoice charged — CGST and SGST for a local sale, IGST for an
 * interstate one — or the tax report cannot be reconciled, so the three columns
 * are carried on the return and on each returned line.
 */
export const migration004: Migration = {
  version: 4,
  name: 'returns-tax-split',
  up: `
ALTER TABLE sales_returns ADD COLUMN cgst_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN sgst_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN igst_paise INTEGER NOT NULL DEFAULT 0;
-- Generated when the return dialog opens, so a double submit resolves to the
-- return already committed instead of refunding twice.
ALTER TABLE sales_returns ADD COLUMN idempotency_key TEXT;

ALTER TABLE sales_return_items ADD COLUMN cgst_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_return_items ADD COLUMN sgst_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_return_items ADD COLUMN igst_paise INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX ux_returns_idempotency
  ON sales_returns (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_returns_no_delete BEFORE DELETE ON sales_returns
BEGIN
  SELECT RAISE(ABORT, 'returns cannot be deleted');
END;

CREATE TRIGGER trg_return_items_no_delete BEFORE DELETE ON sales_return_items
BEGIN
  SELECT RAISE(ABORT, 'return items cannot be deleted');
END;
`,
};
