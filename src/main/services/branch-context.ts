/**
 * Who is billing, and from where.
 *
 * One shop on one computer: exactly one company and one branch. Every service
 * that writes a document needs the same ids, and reading them in one place
 * keeps them from drifting apart.
 *
 * The operator is whoever is signed in. With login off nobody is, and the
 * shop's single seeded operator stands in — which is what a one-person shop
 * wants, and what every document written before login existed already says.
 */
import type { Database } from 'better-sqlite3';
import { sessionOperatorId } from '../session';

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
    operatorId: sessionOperatorId() ?? row.operator_id,
  };
}
