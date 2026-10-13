import type { Migration } from './types';

/**
 * Loyalty.
 *
 * A card belongs to a customer and carries its own rate and expiry, so raising
 * the shop's rate later does not silently rewrite what a card already promised.
 *
 * The balance is never stored. It is the sum of the transactions, every one of
 * which points at the document that caused it — the sale that earned, the sale
 * that spent, the credit note that took points back. A stored balance and a
 * list of transactions is two answers to one question, and they drift.
 *
 * Points are integers. A fraction of a point is not a thing a shop can hand
 * over, and rounding it at every sale would be a slow leak.
 */
export const migration009: Migration = {
  version: 9,
  name: 'loyalty',
  up: `
CREATE TABLE loyalty_cards (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id        TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  card_number        TEXT NOT NULL,
  tier               TEXT NOT NULL,
  -- The card's own rate, copied from settings when it was issued.
  points_per_hundred INTEGER NOT NULL CHECK (points_per_hundred >= 0),
  issued_at          TEXT NOT NULL,
  -- Null never expires. A card past its date can neither earn nor be spent.
  expires_at         TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (company_id, card_number),
  -- One card per customer: two cards would be two balances for one person.
  UNIQUE (customer_id)
);

CREATE INDEX ix_loyalty_cards_customer ON loyalty_cards (customer_id, is_active);

CREATE TABLE loyalty_transactions (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  card_id       TEXT NOT NULL REFERENCES loyalty_cards(id) ON DELETE RESTRICT,
  customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'reverse', 'adjust')),
  -- Positive adds to the balance, negative takes away. Signed, so the balance
  -- is a plain SUM and no reader has to remember which kinds subtract.
  points        INTEGER NOT NULL CHECK (points <> 0),
  -- What the points were worth in money, for a redemption.
  value_paise   INTEGER NOT NULL DEFAULT 0 CHECK (value_paise >= 0),
  reference_type TEXT CHECK (reference_type IN ('sale', 'sale_return', 'manual')),
  reference_id  TEXT,
  narration     TEXT,
  operator_id   TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX ix_loyalty_txn_card ON loyalty_transactions (card_id, created_at);
CREATE INDEX ix_loyalty_txn_ref  ON loyalty_transactions (reference_type, reference_id);

/* One earning and one spending per document, so a retry cannot double either. */
CREATE UNIQUE INDEX ux_loyalty_txn_once
  ON loyalty_transactions (reference_type, reference_id, kind)
  WHERE reference_id IS NOT NULL;

/* A points balance is a promise to a customer; the trail behind it stands. */
CREATE TRIGGER trg_loyalty_txn_no_update BEFORE UPDATE ON loyalty_transactions
BEGIN
  SELECT RAISE(ABORT, 'a loyalty entry cannot be changed — post an adjustment');
END;

CREATE TRIGGER trg_loyalty_txn_no_delete BEFORE DELETE ON loyalty_transactions
BEGIN
  SELECT RAISE(ABORT, 'a loyalty entry cannot be deleted — post an adjustment');
END;

/* What a sale earned and spent, kept on the sale so a receipt can be reprinted
   years later without recomputing it from a rate that has since changed. */
ALTER TABLE sales ADD COLUMN loyalty_points_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN loyalty_discount_paise INTEGER NOT NULL DEFAULT 0;
`,
};
