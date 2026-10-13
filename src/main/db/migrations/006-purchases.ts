import type { Migration } from './types';

/**
 * Suppliers and purchases.
 *
 * The mirror image of selling, and it reuses the same conventions: integer
 * paise, quantity in thousandths, a snapshot of every line as bought so a
 * later price change cannot rewrite an old bill, stock moved only through
 * `inventory_movements`, and a document that is cancelled rather than deleted.
 *
 * A purchase carries two numbers: ours (`purchase_number`, a local sequence
 * that never has gaps) and the supplier's own bill number, which is their
 * reference and may be anything at all — duplicated across suppliers, or
 * missing on a cash purchase.
 */
export const migration006: Migration = {
  version: 6,
  name: 'suppliers-and-purchases',
  up: `
CREATE TABLE suppliers (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  city               TEXT,
  gstin              TEXT,
  state_code         TEXT,
  -- What this supplier allows us to owe them. 0 means no limit recorded.
  credit_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  notes              TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX ix_suppliers_name  ON suppliers (company_id, name);
CREATE INDEX ix_suppliers_phone ON suppliers (company_id, phone);

CREATE TABLE purchases (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id         TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  operator_id         TEXT REFERENCES operators(id) ON DELETE SET NULL,
  purchase_number     TEXT NOT NULL,
  -- Theirs, not ours: free text, and not assumed unique.
  supplier_bill_no    TEXT,
  financial_year      TEXT NOT NULL,
  purchase_date       TEXT NOT NULL,
  -- Snapshots, so editing the supplier later leaves this bill alone.
  supplier_name       TEXT,
  supplier_gstin      TEXT,
  supplier_state_code TEXT,
  tax_mode            TEXT NOT NULL CHECK (tax_mode IN ('inclusive', 'exclusive')),
  is_interstate       INTEGER NOT NULL DEFAULT 0 CHECK (is_interstate IN (0, 1)),
  gross_paise         INTEGER NOT NULL CHECK (gross_paise >= 0),
  item_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (item_discount_paise >= 0),
  bill_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (bill_discount_paise >= 0),
  taxable_paise       INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise          INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise          INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise          INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise           INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  round_off_paise     INTEGER NOT NULL DEFAULT 0,
  total_paise         INTEGER NOT NULL CHECK (total_paise >= 0),
  status              TEXT NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('completed', 'cancelled')),
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  cancelled_by        TEXT REFERENCES operators(id) ON DELETE SET NULL,
  notes               TEXT,
  idempotency_key     TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (branch_id, purchase_number)
);

CREATE INDEX ix_purchases_date     ON purchases (branch_id, purchase_date);
CREATE INDEX ix_purchases_supplier ON purchases (supplier_id);
CREATE INDEX ix_purchases_status   ON purchases (branch_id, status);
CREATE UNIQUE INDEX ux_purchases_idempotency
  ON purchases (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE purchase_items (
  id               TEXT PRIMARY KEY,
  purchase_id      TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  product_id       TEXT REFERENCES products(id) ON DELETE RESTRICT,
  -- Snapshot of the product as bought.
  name             TEXT NOT NULL,
  sku              TEXT,
  hsn              TEXT,
  unit_code        TEXT NOT NULL,
  quantity_milli   INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_cost_paise  INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  -- Printed on the pack: what the shop may sell it for.
  mrp_paise        INTEGER,
  discount_paise   INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_paise    INTEGER NOT NULL CHECK (taxable_paise >= 0),
  tax_rate_bp      INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  cgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise        INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise      INTEGER NOT NULL CHECK (total_paise >= 0),
  created_at       TEXT NOT NULL,
  UNIQUE (purchase_id, line_no)
);

CREATE INDEX ix_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX ix_purchase_items_product  ON purchase_items (product_id);

CREATE TABLE purchase_returns (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id         TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  purchase_id       TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  supplier_id       TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  operator_id       TEXT REFERENCES operators(id) ON DELETE SET NULL,
  return_number     TEXT NOT NULL,
  financial_year    TEXT NOT NULL,
  return_date       TEXT NOT NULL,
  reason            TEXT NOT NULL,
  taxable_paise     INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise         INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  round_off_paise   INTEGER NOT NULL DEFAULT 0,
  total_paise       INTEGER NOT NULL CHECK (total_paise >= 0),
  /* How the supplier settles it: a debit note left against their account, or
     money back now. */
  settlement        TEXT NOT NULL DEFAULT 'debit_note'
                      CHECK (settlement IN ('debit_note', 'cash', 'upi', 'card', 'bank', 'other')),
  idempotency_key   TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (branch_id, return_number)
);

CREATE INDEX ix_purchase_returns_purchase ON purchase_returns (purchase_id);
CREATE INDEX ix_purchase_returns_date     ON purchase_returns (branch_id, return_date);
CREATE UNIQUE INDEX ux_purchase_returns_idempotency
  ON purchase_returns (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE purchase_return_items (
  id               TEXT PRIMARY KEY,
  return_id        TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
  product_id       TEXT REFERENCES products(id) ON DELETE RESTRICT,
  quantity_milli   INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_cost_paise  INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  taxable_paise    INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise        INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise      INTEGER NOT NULL CHECK (total_paise >= 0),
  created_at       TEXT NOT NULL
);

CREATE INDEX ix_purchase_return_items_return ON purchase_return_items (return_id);
CREATE INDEX ix_purchase_return_items_item   ON purchase_return_items (purchase_item_id);

/* Money paid to a supplier, or taken back from one. Kept apart from the
   payments table, which answers how a customer settled a bill; this answers
   what has moved on a supplier's account, including a payment that belongs to
   no single bill. */
CREATE TABLE supplier_payments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_id    TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  operator_id    TEXT REFERENCES operators(id) ON DELETE SET NULL,
  payment_date   TEXT NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  -- Negative when the supplier refunds us against a return.
  amount_paise   INTEGER NOT NULL CHECK (amount_paise <> 0),
  reference      TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_supplier_payments_supplier ON supplier_payments (supplier_id, payment_date);
CREATE INDEX ix_supplier_payments_purchase ON supplier_payments (purchase_id);

/* Our own numbering for what we buy. Separate from invoice_sequences, whose
   kinds are fixed to the documents we issue to a customer. */
CREATE TABLE purchase_sequences (
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('purchase', 'purchase_return')),
  financial_year TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (branch_id, kind, financial_year)
);

/* Bought goods are a record too. */
CREATE TRIGGER trg_purchases_no_delete BEFORE DELETE ON purchases
BEGIN
  SELECT RAISE(ABORT, 'purchases cannot be deleted — cancel the purchase instead');
END;

CREATE TRIGGER trg_purchase_items_no_delete BEFORE DELETE ON purchase_items
BEGIN
  SELECT RAISE(ABORT, 'purchase items cannot be deleted');
END;

CREATE TRIGGER trg_purchase_returns_no_delete BEFORE DELETE ON purchase_returns
BEGIN
  SELECT RAISE(ABORT, 'purchase returns cannot be deleted');
END;
`,
};
