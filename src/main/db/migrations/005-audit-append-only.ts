import type { Migration } from './types';

/**
 * The audit log is append-only.
 *
 * A trail that can be edited is not a trail. Inserts are allowed; changing or
 * removing a row is refused by the database, so a mistake has to be corrected
 * by writing another entry rather than by rewriting history.
 */
export const migration005: Migration = {
  version: 5,
  name: 'audit-append-only',
  up: `
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit entries cannot be changed');
END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit entries cannot be deleted');
END;
`,
};
