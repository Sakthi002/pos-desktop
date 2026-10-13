import type { Migration } from './types';

/**
 * Operators become users.
 *
 * The original table allowed two roles and no way to tell a password that was
 * never set from one that must be changed. SQLite cannot widen a CHECK
 * constraint in place, so the table is rebuilt: the new one is filled from the
 * old, the old is dropped and the new takes its name. Foreign keys are off
 * while a migration runs and the migrator runs `foreign_key_check` after, so
 * the references from sales, purchases, vouchers and the audit trail survive
 * the swap and are proven to.
 *
 * Nobody is locked out by this: existing rows keep their role and their empty
 * password, and login stays off until the shop sets a password and turns it on.
 */
export const migration008: Migration = {
  version: 8,
  name: 'users-and-roles',
  up: `
CREATE TABLE operators_new (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  -- scrypt, as one self-describing string. Null means this account cannot
  -- sign in at all, which is different from an empty password.
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier'
                  CHECK (role IN ('admin', 'manager', 'cashier')),
  -- Set when an administrator resets a password: the next sign-in must change
  -- it, so a password someone else chose is never the one in daily use.
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

INSERT INTO operators_new
  (id, branch_id, name, username, password_hash, role, must_change_password,
   last_login_at, is_active, created_at, updated_at)
SELECT id, branch_id, name, username, password_hash, role, 0,
       NULL, is_active, created_at, updated_at
  FROM operators;

DROP TABLE operators;

ALTER TABLE operators_new RENAME TO operators;

CREATE INDEX ix_operators_branch ON operators (branch_id, is_active);
`,
};
