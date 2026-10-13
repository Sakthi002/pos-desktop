/**
 * Who is billing, and from where.
 *
 * v1 is one shop on one computer, so there is exactly one company, one branch
 * and one operator. Every service that writes a document needs the same three
 * ids, and reading them in one place keeps them from drifting apart.
 */
import type { Database } from 'better-sqlite3';

export interface BranchContext {
  companyId: string;
  branchId: string;
  branchStateCode: string | null;
  operatorId: string | null;
}

export function loadBranchContext(db: Database): BranchContext | null {
  const row = db
    .prepare(
      `SELECT c.id AS company_id, b.id AS branch_id, b.state_code AS branch_state_code,
              (SELECT o.id FROM operators o WHERE o.branch_id = b.id ORDER BY o.created_at LIMIT 1)
                AS operator_id
         FROM companies c JOIN branches b ON b.company_id = c.id
        ORDER BY c.created_at LIMIT 1`,
    )
    .get() as
    | {
        company_id: string;
        branch_id: string;
        branch_state_code: string | null;
        operator_id: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    companyId: row.company_id,
    branchId: row.branch_id,
    branchStateCode: row.branch_state_code,
    operatorId: row.operator_id,
  };
}
