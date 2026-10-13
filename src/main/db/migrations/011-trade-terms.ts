import type { Migration } from './types';

/**
 * Trade terms and the counter.
 *
 * Three things a shop that sells to other shops needs, and one a shop with a
 * cash drawer needs.
 *
 * **Price levels.** Retail, wholesale and a special price per product. A
 * customer can be set to a level, and a bill can be moved to another, because
 * the person in front of the counter is not always the account they belong to.
 *
 * **Credit.** A bill may be left part-paid against a named customer, up to the
 * limit on their account. What they owe is derived from the documents — bills,
 * less credit notes, less receipts — never stored, so it cannot drift.
 *
 * **Shifts.** A drawer is opened with a float and closed with a count. The
 * expected figure is computed from the movements of cash in the session, and
 * the difference is recorded rather than quietly corrected: a variance is the
 * whole point of counting.
 */
export const migration011: Migration = {
  version: 11,
  name: 'trade-terms-and-shifts',
  up: `
/* Price levels. The retail price stays on the product; these sit beside it. */
ALTER TABLE products ADD COLUMN wholesale_price_paise INTEGER
  CHECK (wholesale_price_paise IS NULL OR wholesale_price_paise >= 0);
ALTER TABLE products ADD COLUMN special_price_paise INTEGER
  CHECK (special_price_paise IS NULL OR special_price_paise >= 0);

ALTER TABLE customers ADD COLUMN price_level TEXT NOT NULL DEFAULT 'retail'
  CHECK (price_level IN ('retail', 'wholesale', 'special'));

/* Nothing on credit until a limit is set: zero means cash only. */
ALTER TABLE customers ADD COLUMN credit_limit_paise INTEGER NOT NULL DEFAULT 0
  CHECK (credit_limit_paise >= 0);

/* The level a bill was actually charged at, kept with the bill. */
ALTER TABLE sales ADD COLUMN price_level TEXT NOT NULL DEFAULT 'retail'
  CHECK (price_level IN ('retail', 'wholesale', 'special'));

/* What was left unpaid on it, so a receivable can be read off the document. */
ALTER TABLE sales ADD COLUMN credit_paise INTEGER NOT NULL DEFAULT 0
  CHECK (credit_paise >= 0);

CREATE INDEX ix_sales_credit ON sales (customer_id, credit_paise);

/* Money received against a customer's account, against one bill or on it. */
CREATE TABLE customer_receipts (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  -- Null means on account: allocated later, or never.
  sale_id        TEXT REFERENCES sales(id) ON DELETE RESTRICT,
  receipt_date   TEXT NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  -- Positive is money in. A refund of an over-payment is negative.
  amount_paise   INTEGER NOT NULL CHECK (amount_paise <> 0),
  reference      TEXT,
  notes          TEXT,
  operator_id    TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_receipts_customer ON customer_receipts (customer_id, receipt_date);
CREATE INDEX ix_receipts_sale     ON customer_receipts (sale_id);

CREATE TRIGGER trg_receipts_no_delete BEFORE DELETE ON customer_receipts
BEGIN
  SELECT RAISE(ABORT, 'a receipt cannot be deleted — post a reversing receipt');
END;

/* A session at the till: opened with a float, closed with a count. */
CREATE TABLE shifts (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  opened_by           TEXT REFERENCES operators(id) ON DELETE SET NULL,
  opened_at           TEXT NOT NULL,
  opening_float_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_paise >= 0),
  closed_by           TEXT REFERENCES operators(id) ON DELETE SET NULL,
  closed_at           TEXT,
  -- What the drawer actually held, counted by hand.
  counted_paise       INTEGER CHECK (counted_paise IS NULL OR counted_paise >= 0),
  -- What it should have held, computed from the session's cash movements.
  expected_paise      INTEGER,
  -- counted - expected. Recorded, never corrected away.
  variance_paise      INTEGER,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX ix_shifts_open ON shifts (branch_id, closed_at);

/* One open shift per branch at a time: two would each be counting the other's
   takings. */
CREATE UNIQUE INDEX ux_shifts_one_open
  ON shifts (branch_id) WHERE closed_at IS NULL;

CREATE TRIGGER trg_shifts_no_delete BEFORE DELETE ON shifts
BEGIN
  SELECT RAISE(ABORT, 'a shift is a record of a day and cannot be deleted');
END;

/* Which session a sale belongs to, so a drawer can be counted against it. */
ALTER TABLE sales ADD COLUMN shift_id TEXT REFERENCES shifts(id) ON DELETE RESTRICT;
CREATE INDEX ix_sales_shift ON sales (shift_id);
`,
};
