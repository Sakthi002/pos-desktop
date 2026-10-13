import type { Migration } from './types';

/**
 * Quotations.
 *
 * A price put in writing before anything is sold. It moves no stock, takes no
 * money and posts nothing to the books — that is the whole point of it, and
 * the reason it is its own document rather than a draft sale.
 *
 * It carries the prices and tax as they stood on the day it was given, so a
 * customer who comes back next week can be shown what was promised and what
 * has changed. Accepting one does not alter it: the sale is a new document
 * that points back here.
 */
export const migration012: Migration = {
  version: 12,
  name: 'quotations',
  up: `
CREATE TABLE quotations (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id          TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  operator_id        TEXT REFERENCES operators(id) ON DELETE SET NULL,
  quotation_number   TEXT NOT NULL,
  financial_year     TEXT NOT NULL,
  quotation_date     TEXT NOT NULL,
  -- The day the price stops being promised. Null never expires.
  valid_until        TEXT,
  customer_id        TEXT REFERENCES customers(id) ON DELETE SET NULL,
  -- Snapshots, as on a sale: editing a customer must not rewrite a quotation.
  customer_name      TEXT,
  customer_phone     TEXT,
  customer_gstin     TEXT,
  customer_state_code TEXT,
  price_level        TEXT NOT NULL DEFAULT 'retail'
                       CHECK (price_level IN ('retail', 'wholesale', 'special')),
  tax_mode           TEXT NOT NULL CHECK (tax_mode IN ('inclusive', 'exclusive')),
  is_interstate      INTEGER NOT NULL DEFAULT 0 CHECK (is_interstate IN (0, 1)),
  gross_paise        INTEGER NOT NULL CHECK (gross_paise >= 0),
  item_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (item_discount_paise >= 0),
  cart_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (cart_discount_paise >= 0),
  taxable_paise      INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise         INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise         INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise         INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise          INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  round_off_paise    INTEGER NOT NULL DEFAULT 0,
  total_paise        INTEGER NOT NULL CHECK (total_paise >= 0),
  -- Open until something happens to it. Expiry is read from the date rather
  -- than stored, so a quotation cannot be stale in one place and not another.
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'converted', 'cancelled')),
  converted_sale_id  TEXT REFERENCES sales(id) ON DELETE RESTRICT,
  converted_at       TEXT,
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  notes              TEXT,
  terms              TEXT,
  -- A double-tapped Save must not put the same price in writing twice.
  idempotency_key    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (company_id, quotation_number)
);

CREATE INDEX ix_quotations_date   ON quotations (company_id, quotation_date);
CREATE INDEX ix_quotations_status ON quotations (company_id, status);
CREATE INDEX ix_quotations_customer ON quotations (customer_id);
CREATE UNIQUE INDEX ux_quotations_idempotency
  ON quotations (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE quotation_items (
  id             TEXT PRIMARY KEY,
  quotation_id   TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  line_no        INTEGER NOT NULL,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  -- Named as it was quoted, whatever the product is called later.
  name           TEXT NOT NULL,
  sku            TEXT,
  hsn            TEXT,
  unit_code      TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_paise  INTEGER NOT NULL CHECK (taxable_paise >= 0),
  tax_rate_bp    INTEGER NOT NULL DEFAULT 0,
  cgst_paise     INTEGER NOT NULL DEFAULT 0,
  sgst_paise     INTEGER NOT NULL DEFAULT 0,
  igst_paise     INTEGER NOT NULL DEFAULT 0,
  tax_paise      INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER NOT NULL CHECK (total_paise >= 0),
  created_at     TEXT NOT NULL,
  UNIQUE (quotation_id, line_no)
);

/* Its own series, because a quotation is not an invoice and must never take a
   number out of a GST series that has to run unbroken. */
CREATE TABLE quotation_sequences (
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  financial_year TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (branch_id, financial_year)
);

/* A price that was given is a thing that happened. */
CREATE TRIGGER trg_quotations_no_delete BEFORE DELETE ON quotations
BEGIN
  SELECT RAISE(ABORT, 'a quotation cannot be deleted — cancel it instead');
END;

CREATE TRIGGER trg_quotation_items_no_delete BEFORE DELETE ON quotation_items
BEGIN
  SELECT RAISE(ABORT, 'a quotation line cannot be deleted');
END;

/* The sale a quotation turned into, read from either end. */
ALTER TABLE sales ADD COLUMN quotation_id TEXT REFERENCES quotations(id) ON DELETE RESTRICT;
CREATE INDEX ix_sales_quotation ON sales (quotation_id);
`,
};
