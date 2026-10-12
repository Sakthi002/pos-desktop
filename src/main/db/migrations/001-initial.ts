import type { Migration } from './types';

/**
 * Initial schema.
 *
 * Conventions used throughout:
 *   *_paise  integer minor units — never a float
 *   *_milli  quantity in thousandths — supports kg/litre/metre without float drift
 *   *_bp     basis points — 1800 = 18.00%
 *   id       UUID text, assigned at creation so rows are portable to a future
 *            cloud backend without renumbering
 *   is_active  soft deactivation; rows referenced by transactions are never deleted
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial-schema',
  up: `
-- ─── Tenant and location ────────────────────────────────────────────────────

CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  legal_name  TEXT,
  gstin       TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  state_code  TEXT,
  pincode     TEXT,
  phone       TEXT,
  email       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE branches (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  gstin       TEXT,
  address     TEXT,
  state       TEXT,
  state_code  TEXT,
  phone       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (company_id, code)
);

CREATE TABLE operators (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  -- Null until operator login is enabled; never a plaintext password.
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- ─── Settings ───────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,          -- JSON-encoded
  updated_at TEXT NOT NULL
);

-- ─── Catalogue ──────────────────────────────────────────────────────────────

CREATE TABLE units (
  code           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  -- 0 = whole units only (piece, box); 3 = thousandths (kg, litre, metre)
  decimal_places INTEGER NOT NULL DEFAULT 0 CHECK (decimal_places BETWEEN 0 AND 3),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  sku                 TEXT,
  barcode             TEXT,
  name                TEXT NOT NULL,
  description         TEXT,
  category_id         TEXT REFERENCES categories(id) ON DELETE SET NULL,
  brand               TEXT,
  hsn                 TEXT,
  unit_code           TEXT NOT NULL REFERENCES units(code) ON DELETE RESTRICT,
  cost_paise          INTEGER NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  price_paise         INTEGER NOT NULL CHECK (price_paise >= 0),
  mrp_paise           INTEGER CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
  tax_rate_bp         INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_inclusive       INTEGER NOT NULL DEFAULT 1 CHECK (tax_inclusive IN (0, 1)),
  -- A service item sells without touching stock.
  track_inventory     INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0, 1)),
  reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Partial uniqueness: many products may have no SKU or barcode, but a given
-- value must not repeat inside a company.
CREATE UNIQUE INDEX ux_products_company_sku
  ON products (company_id, sku) WHERE sku IS NOT NULL AND sku <> '';
CREATE UNIQUE INDEX ux_products_company_barcode
  ON products (company_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX ix_products_name     ON products (company_id, name);
CREATE INDEX ix_products_category ON products (category_id);
CREATE INDEX ix_products_active   ON products (company_id, is_active);

-- ─── Customers ──────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  gstin       TEXT,
  state_code  TEXT,
  -- Exactly one walk-in row per company, enforced by ux_customers_walk_in.
  is_walk_in  INTEGER NOT NULL DEFAULT 0 CHECK (is_walk_in IN (0, 1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_customers_walk_in
  ON customers (company_id) WHERE is_walk_in = 1;
CREATE INDEX ix_customers_phone ON customers (company_id, phone);
CREATE INDEX ix_customers_name  ON customers (company_id, name);

-- ─── Invoice numbering ──────────────────────────────────────────────────────

-- Scoped per branch and financial year. Allocation happens inside the sale
-- transaction, so a rolled-back sale does not consume a number.
CREATE TABLE invoice_sequences (
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL CHECK (kind IN ('sale', 'return')),
  financial_year TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  next_number  INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (branch_id, kind, financial_year)
);

-- ─── Sales ──────────────────────────────────────────────────────────────────

CREATE TABLE sales (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id          TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  operator_id        TEXT REFERENCES operators(id) ON DELETE SET NULL,
  invoice_number     TEXT NOT NULL,
  financial_year     TEXT NOT NULL,
  invoice_date       TEXT NOT NULL,
  customer_id        TEXT REFERENCES customers(id) ON DELETE SET NULL,
  -- Snapshots: a later edit to the customer must not rewrite this invoice.
  customer_name      TEXT,
  customer_phone     TEXT,
  customer_gstin     TEXT,
  customer_state_code TEXT,
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
  status             TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  voided_at          TEXT,
  void_reason        TEXT,
  voided_by          TEXT REFERENCES operators(id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (branch_id, invoice_number)
);

CREATE INDEX ix_sales_date     ON sales (branch_id, invoice_date);
CREATE INDEX ix_sales_customer ON sales (customer_id);
CREATE INDEX ix_sales_status   ON sales (branch_id, status);

CREATE TABLE sale_items (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  product_id      TEXT REFERENCES products(id) ON DELETE RESTRICT,
  -- Snapshot of the product as sold. Editing the product later must not alter
  -- a historical invoice.
  name            TEXT NOT NULL,
  sku             TEXT,
  barcode         TEXT,
  hsn             TEXT,
  unit_code       TEXT NOT NULL,
  quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  discount_paise  INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_paise   INTEGER NOT NULL CHECK (taxable_paise >= 0),
  tax_rate_bp     INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  cgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  tax_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise     INTEGER NOT NULL CHECK (total_paise >= 0),
  created_at      TEXT NOT NULL,
  UNIQUE (sale_id, line_no)
);

CREATE INDEX ix_sale_items_sale    ON sale_items (sale_id);
CREATE INDEX ix_sale_items_product ON sale_items (product_id);

CREATE TABLE payments (
  id             TEXT PRIMARY KEY,
  sale_id        TEXT REFERENCES sales(id) ON DELETE RESTRICT,
  return_id      TEXT,
  method         TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  -- Negative for a refund.
  amount_paise   INTEGER NOT NULL,
  tendered_paise INTEGER,
  change_paise   INTEGER,
  -- Operator-entered only. The app never verifies this with a provider.
  reference      TEXT,
  created_at     TEXT NOT NULL,
  CHECK (sale_id IS NOT NULL OR return_id IS NOT NULL)
);

CREATE INDEX ix_payments_sale   ON payments (sale_id);
CREATE INDEX ix_payments_return ON payments (return_id);

-- ─── Returns ────────────────────────────────────────────────────────────────

CREATE TABLE sales_returns (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  sale_id        TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  operator_id    TEXT REFERENCES operators(id) ON DELETE SET NULL,
  return_number  TEXT NOT NULL,
  financial_year TEXT NOT NULL,
  return_date    TEXT NOT NULL,
  reason         TEXT,
  taxable_paise  INTEGER NOT NULL CHECK (taxable_paise >= 0),
  tax_paise      INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  round_off_paise INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER NOT NULL CHECK (total_paise >= 0),
  refund_method  TEXT NOT NULL CHECK (refund_method IN ('cash', 'upi', 'card', 'bank', 'other')),
  created_at     TEXT NOT NULL,
  UNIQUE (branch_id, return_number)
);

CREATE INDEX ix_returns_sale ON sales_returns (sale_id);
CREATE INDEX ix_returns_date ON sales_returns (branch_id, return_date);

CREATE TABLE sales_return_items (
  id             TEXT PRIMARY KEY,
  return_id      TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
  sale_item_id   TEXT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  product_id     TEXT REFERENCES products(id) ON DELETE RESTRICT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  taxable_paise  INTEGER NOT NULL CHECK (taxable_paise >= 0),
  tax_paise      INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise    INTEGER NOT NULL CHECK (total_paise >= 0),
  -- Only restocked when the operator marks the goods resaleable.
  restocked      INTEGER NOT NULL DEFAULT 0 CHECK (restocked IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_return_items_return    ON sales_return_items (return_id);
CREATE INDEX ix_return_items_sale_item ON sales_return_items (sale_item_id);

-- ─── Inventory ──────────────────────────────────────────────────────────────

-- The only source of stock truth. A balance is SUM(quantity_milli); no table
-- stores a running quantity that could drift from the ledger.
CREATE TABLE inventory_movements (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type  TEXT NOT NULL CHECK (movement_type IN
                   ('opening', 'sale', 'sale_return', 'adjustment', 'purchase', 'damage')),
  -- Signed: negative removes stock.
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli <> 0),
  unit_cost_paise INTEGER CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0),
  reference_type TEXT,
  reference_id   TEXT,
  reason         TEXT,
  operator_id    TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX ix_movements_product   ON inventory_movements (product_id, branch_id);
CREATE INDEX ix_movements_reference ON inventory_movements (reference_type, reference_id);
CREATE INDEX ix_movements_created   ON inventory_movements (branch_id, created_at);

-- ─── Audit ──────────────────────────────────────────────────────────────────

-- Append-only. Nothing updates or deletes rows here.
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  details     TEXT,                   -- JSON
  created_at  TEXT NOT NULL
);

CREATE INDEX ix_audit_entity  ON audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_created ON audit_logs (created_at);

-- ─── Sync scaffolding (unused in v1) ────────────────────────────────────────

-- Present so a future cloud backend has an upload queue without a migration
-- that touches live transaction tables.
CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  payload     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  synced_at   TEXT
);

CREATE INDEX ix_sync_pending ON sync_queue (synced_at) WHERE synced_at IS NULL;

-- ─── Seed: units ────────────────────────────────────────────────────────────

INSERT INTO units (code, name, decimal_places) VALUES
  ('pc',   'Piece',      0),
  ('box',  'Box',        0),
  ('pack', 'Pack',       0),
  ('dz',   'Dozen',      0),
  ('kg',   'Kilogram',   3),
  ('g',    'Gram',       0),
  ('l',    'Litre',      3),
  ('ml',   'Millilitre', 0),
  ('m',    'Metre',      3);
`,
};
