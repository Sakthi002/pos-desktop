import type { Migration } from './types';

/**
 * Double-entry bookkeeping.
 *
 * Three tables and one rule: every voucher's debits equal its credits, or
 * nothing is written. The rule is enforced in the service, because SQLite
 * cannot check a sum across rows being inserted, and it is proven by a test
 * that posts every kind of document and asserts the trial balance is zero.
 *
 * Customers and suppliers do not each get an account. They share one control
 * account — receivables, payables — and the party is named on the entry, which
 * is how a subsidiary ledger works: a statement per party, and a chart of
 * accounts that stays readable.
 *
 * Nothing here is ever edited. A mistake is corrected by posting the opposite
 * voucher, which is also how the cancellation of a sale or a purchase is
 * recorded.
 */
export const migration007: Migration = {
  version: 7,
  name: 'double-entry-ledger',
  up: `
CREATE TABLE accounts (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  account_group  TEXT NOT NULL
                   CHECK (account_group IN ('asset', 'liability', 'equity', 'income', 'expense')),
  -- Which side increases it: assets and expenses are debit-normal.
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  parent_id      TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  -- Seeded accounts the posting rules depend on. They cannot be removed.
  is_system      INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (company_id, code)
);

CREATE INDEX ix_accounts_group ON accounts (company_id, account_group);

CREATE TABLE vouchers (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  voucher_no     TEXT NOT NULL,
  voucher_date   TEXT NOT NULL,
  voucher_type   TEXT NOT NULL CHECK (voucher_type IN
                   ('sale', 'sale_return', 'sale_void', 'purchase', 'purchase_return',
                    'purchase_cancel', 'receipt', 'payment', 'journal', 'opening')),
  narration      TEXT,
  -- The document this voucher accounts for; one voucher per document and kind.
  reference_type TEXT,
  reference_id   TEXT,
  operator_id    TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (company_id, voucher_no)
);

CREATE INDEX ix_vouchers_date ON vouchers (company_id, voucher_date);
CREATE UNIQUE INDEX ux_vouchers_reference
  ON vouchers (reference_type, reference_id, voucher_type)
  WHERE reference_id IS NOT NULL;

CREATE TABLE ledger_entries (
  id            TEXT PRIMARY KEY,
  voucher_id    TEXT NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  entry_date    TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit_paise   INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  -- The subsidiary ledger: which customer or supplier this line belongs to.
  party_type    TEXT CHECK (party_type IN ('customer', 'supplier')),
  party_id      TEXT,
  narration     TEXT,
  created_at    TEXT NOT NULL,
  -- Exactly one side carries a figure; a line is a debit or a credit, never
  -- both. A table constraint, so it comes after every column.
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
);

CREATE INDEX ix_ledger_account ON ledger_entries (account_id, entry_date);
CREATE INDEX ix_ledger_voucher ON ledger_entries (voucher_id);
CREATE INDEX ix_ledger_party   ON ledger_entries (party_type, party_id, entry_date);
CREATE INDEX ix_ledger_date    ON ledger_entries (company_id, entry_date);

/* Our own numbering for vouchers, per branch and financial year. */
CREATE TABLE voucher_sequences (
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  financial_year TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (branch_id, financial_year)
);

/* The books are a record, not a draft. */
CREATE TRIGGER trg_vouchers_no_update BEFORE UPDATE ON vouchers
BEGIN
  SELECT RAISE(ABORT, 'a voucher cannot be changed — post a reversing voucher');
END;

CREATE TRIGGER trg_vouchers_no_delete BEFORE DELETE ON vouchers
BEGIN
  SELECT RAISE(ABORT, 'a voucher cannot be deleted — post a reversing voucher');
END;

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'a ledger entry cannot be changed');
END;

CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'a ledger entry cannot be deleted');
END;
`,
};
