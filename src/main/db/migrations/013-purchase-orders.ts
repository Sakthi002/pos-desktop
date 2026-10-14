import type { Migration } from './types';

/**
 * Purchase orders.
 *
 * What a shop asks a supplier to send, before anything arrives. It moves no
 * stock, owes no money and posts nothing to the books — the supplier's bill
 * does all of that, and it is a document of its own that points back here.
 *
 * The mirror of a quotation: there a shop puts a price in writing for a
 * customer, here it puts an order in writing for a supplier. Both are kept
 * whatever becomes of them, because a thing that was sent is a thing that
 * happened.
 *
 * Costs only, no tax: what a supplier charges in tax is decided by their bill,
 * and an order that guessed at it would be contradicted on arrival.
 */
export const migration013: Migration = {
  version: 13,
  name: 'purchase-orders',
  up: `
CREATE TABLE purchase_orders (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id          TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  operator_id        TEXT REFERENCES operators(id) ON DELETE SET NULL,
  order_number       TEXT NOT NULL,
  financial_year     TEXT NOT NULL,
  order_date         TEXT NOT NULL,
  -- When the goods are wanted by. Null is "no date given".
  expected_on        TEXT,
  supplier_id        TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  -- Snapshots, as on a purchase: editing a supplier must not rewrite an order.
  supplier_name      TEXT NOT NULL,
  supplier_phone     TEXT,
  supplier_gstin     TEXT,
  total_paise        INTEGER NOT NULL CHECK (total_paise >= 0),
  -- Open until the goods arrive against it, or the shop calls it off.
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'received', 'cancelled')),
  received_purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  received_at        TEXT,
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  notes              TEXT,
  -- A double-tapped Save must not order the same goods twice.
  idempotency_key    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (company_id, order_number)
);

CREATE INDEX ix_purchase_orders_date     ON purchase_orders (company_id, order_date);
CREATE INDEX ix_purchase_orders_status   ON purchase_orders (company_id, status);
CREATE INDEX ix_purchase_orders_supplier ON purchase_orders (supplier_id);
CREATE UNIQUE INDEX ux_purchase_orders_idempotency
  ON purchase_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE purchase_order_items (
  id                 TEXT PRIMARY KEY,
  purchase_order_id  TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  line_no            INTEGER NOT NULL,
  product_id         TEXT REFERENCES products(id) ON DELETE SET NULL,
  -- Named as it was ordered, whatever the product is called later.
  name               TEXT NOT NULL,
  sku                TEXT,
  unit_code          TEXT NOT NULL,
  quantity_milli     INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_cost_paise    INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  total_paise        INTEGER NOT NULL CHECK (total_paise >= 0),
  created_at         TEXT NOT NULL,
  UNIQUE (purchase_order_id, line_no)
);

/* Its own series, as a quotation has: an order is not a bill and must never
   take a number out of a series that has to run unbroken. */
CREATE TABLE purchase_order_sequences (
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  financial_year TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (branch_id, financial_year)
);

/* An order that was sent is a thing that happened. */
CREATE TRIGGER trg_purchase_orders_no_delete BEFORE DELETE ON purchase_orders
BEGIN
  SELECT RAISE(ABORT, 'a purchase order cannot be deleted — cancel it instead');
END;

CREATE TRIGGER trg_purchase_order_items_no_delete BEFORE DELETE ON purchase_order_items
BEGIN
  SELECT RAISE(ABORT, 'a purchase order line cannot be deleted');
END;

/* The bill an order turned into, read from either end. */
ALTER TABLE purchases ADD COLUMN purchase_order_id TEXT
  REFERENCES purchase_orders(id) ON DELETE RESTRICT;
CREATE INDEX ix_purchases_order ON purchases (purchase_order_id);
`,
};
