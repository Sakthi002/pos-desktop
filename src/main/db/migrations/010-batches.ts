import type { Migration } from './types';

/**
 * Batches and expiry.
 *
 * A batch is a quantity of one product that arrived together and goes out of
 * date together. Only products that need it carry batches — a shop selling
 * soap does not want to be asked for an expiry date — so `tracks_batches` is
 * per product and off by default.
 *
 * The balance of a batch is the sum of the movements carrying it, exactly as
 * the balance of a product is the sum of all its movements. Nothing is stored
 * twice, and a batch balance can never disagree with the product's.
 *
 * Valuation is per product because shops genuinely differ: medicines move
 * first-in-first-out, a hardware shop may cost the last price it paid, and a
 * grain merchant averages. The method chosen here is used by the reports that
 * put a value on stock.
 */
export const migration010: Migration = {
  version: 10,
  name: 'batches-and-expiry',
  up: `
CREATE TABLE product_batches (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_number    TEXT NOT NULL,
  manufactured_on TEXT,
  -- Null never expires: a batch number can be useful on its own, for a recall.
  expires_on      TEXT,
  -- What this batch cost, for valuation. The product's cost price is the
  -- latest; a batch keeps what was actually paid for it.
  cost_paise      INTEGER NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  mrp_paise       INTEGER CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (product_id, batch_number)
);

CREATE INDEX ix_batches_product ON product_batches (product_id, expires_on);
CREATE INDEX ix_batches_expiry  ON product_batches (company_id, expires_on);

/* Which batch a movement belongs to. Null for a product that keeps none. */
ALTER TABLE inventory_movements ADD COLUMN batch_id TEXT REFERENCES product_batches(id) ON DELETE RESTRICT;

CREATE INDEX ix_movements_batch ON inventory_movements (batch_id, created_at);

/* Per product: whether it keeps batches, and how its stock is valued. */
ALTER TABLE products ADD COLUMN tracks_batches INTEGER NOT NULL DEFAULT 0
  CHECK (tracks_batches IN (0, 1));
ALTER TABLE products ADD COLUMN valuation_method TEXT NOT NULL DEFAULT 'fifo'
  CHECK (valuation_method IN ('fifo', 'lifo', 'average'));

/* The batch a purchase line brought in, so a bill can be read back whole. */
ALTER TABLE purchase_items ADD COLUMN batch_id TEXT REFERENCES product_batches(id) ON DELETE RESTRICT;
`,
};
