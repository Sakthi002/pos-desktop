/**
 * Customers.
 *
 * Minimal by design: a shop needs a name and a phone number to put on an
 * invoice, and a state code when GST applies. Anything more is CRM.
 */
import type { Database } from 'better-sqlite3';
import { customerInputSchema, type Customer } from '@shared/customer';
import { newId, now, fromDbBool, toDbBool } from '../db/repositories/base';

interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  state_code: string | null;
  is_walk_in: number;
  is_active: number;
}

const toCustomer = (r: Row): Customer => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  address: r.address,
  gstin: r.gstin,
  stateCode: r.state_code,
  isWalkIn: fromDbBool(r.is_walk_in),
  isActive: fromDbBool(r.is_active),
});

const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

export class CustomerService {
  private readonly companyId: string;

  constructor(private readonly db: Database) {
    const row = db.prepare('SELECT id FROM companies ORDER BY created_at LIMIT 1').get() as
      { id: string } | undefined;
    if (!row) throw new Error('Complete setup before managing customers.');
    this.companyId = row.id;
  }

  /** Walk-in first, then best matches: the till reaches for it constantly. */
  search(term: string, limit = 20): Customer[] {
    const like = `%${term.trim()}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM customers
          WHERE company_id = ? AND is_active = 1
            AND (? = '' OR name LIKE ? OR phone LIKE ?)
          ORDER BY is_walk_in DESC, name
          LIMIT ?`,
      )
      .all(this.companyId, term.trim(), like, like, limit) as Row[];
    return rows.map(toCustomer);
  }

  walkIn(): Customer | null {
    const row = this.db
      .prepare('SELECT * FROM customers WHERE company_id = ? AND is_walk_in = 1')
      .get(this.companyId) as Row | undefined;
    return row ? toCustomer(row) : null;
  }

  create(input: unknown): Customer {
    const parsed = customerInputSchema.parse(input);
    const id = newId();
    const t = now();

    this.db
      .prepare(
        `INSERT INTO customers (id, company_id, name, phone, email, address, gstin, state_code,
           is_walk_in, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        this.companyId,
        parsed.name,
        blankToNull(parsed.phone),
        blankToNull(parsed.email),
        blankToNull(parsed.address),
        blankToNull(parsed.gstin),
        blankToNull(parsed.stateCode),
        toDbBool(true),
        t,
        t,
      );

    const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Row;
    return toCustomer(row);
  }
}
