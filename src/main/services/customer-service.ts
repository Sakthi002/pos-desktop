/**
 * Customers.
 *
 * Minimal by design: a shop needs a name and a phone number to put on an
 * invoice, and a state code when GST applies. Anything more is CRM.
 */
import type { Database } from 'better-sqlite3';
import {
  customerInputSchema,
  customerQuerySchema,
  customerUpdateSchema,
  type Customer,
  type CustomerPage,
  type CustomerQuery,
  type CustomerSummary,
} from '@shared/customer';
import type { PriceLevel } from '@shared/trade';
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
  price_level: string;
  credit_limit_paise: number;
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
  priceLevel: r.price_level as PriceLevel,
  creditLimitPaise: r.credit_limit_paise,
});

const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

export class CustomerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CustomerError';
  }
}

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
           is_walk_in, is_active, price_level, credit_limit_paise, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
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
        parsed.priceLevel,
        parsed.creditLimitPaise,
        t,
        t,
      );

    const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Row;
    return toCustomer(row);
  }

  get(id: string): Customer | null {
    const row = this.db
      .prepare('SELECT * FROM customers WHERE id = ? AND company_id = ?')
      .get(id, this.companyId) as Row | undefined;
    return row ? toCustomer(row) : null;
  }

  update(input: unknown): Customer {
    const parsed = customerUpdateSchema.parse(input);
    const existing = this.get(parsed.id);
    if (!existing) throw new CustomerError('NOT_FOUND', 'Customer not found.');

    this.db
      .prepare(
        `UPDATE customers
            SET name = ?, phone = ?, email = ?, address = ?, gstin = ?, state_code = ?,
                price_level = ?, credit_limit_paise = ?, updated_at = ?
          WHERE id = ? AND company_id = ?`,
      )
      .run(
        parsed.name,
        blankToNull(parsed.phone),
        blankToNull(parsed.email),
        blankToNull(parsed.address),
        blankToNull(parsed.gstin),
        blankToNull(parsed.stateCode),
        parsed.priceLevel,
        parsed.creditLimitPaise,
        now(),
        parsed.id,
        this.companyId,
      );

    return this.get(parsed.id) as Customer;
  }

  /**
   * Customers are deactivated, never deleted — their name is printed on past
   * invoices. The walk-in row stays active because the till needs it.
   */
  setActive(id: string, isActive: boolean): Customer {
    const existing = this.get(id);
    if (!existing) throw new CustomerError('NOT_FOUND', 'Customer not found.');
    if (existing.isWalkIn && !isActive) {
      throw new CustomerError('WALK_IN', 'The walk-in customer cannot be deactivated.');
    }

    this.db
      .prepare('UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?')
      .run(toDbBool(isActive), now(), id, this.companyId);

    return this.get(id) as Customer;
  }

  /** The customer list, with what each of them has spent. */
  list(input: unknown): CustomerPage {
    const query: CustomerQuery = customerQuerySchema.parse(input ?? {});

    const where: string[] = ['c.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.search) {
      where.push('(c.name LIKE @like OR c.phone LIKE @like OR c.gstin LIKE @like)');
      params['like'] = `%${query.search}%`;
    }
    if (query.status === 'active') where.push('c.is_active = 1');
    if (query.status === 'inactive') where.push('c.is_active = 0');

    const filter = `WHERE ${where.join(' AND ')}`;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM customers c ${filter}`).get(params) as {
        n: number;
      }
    ).n;

    // Only completed sales count towards what a customer has spent.
    const rows = this.db
      .prepare(
        `SELECT c.*,
                COALESCE((SELECT COUNT(*) FROM sales s
                           WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS invoices,
                COALESCE((SELECT SUM(s.total_paise) FROM sales s
                           WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS total_paise,
                (SELECT MAX(s.invoice_date) FROM sales s
                  WHERE s.customer_id = c.id AND s.status = 'completed') AS last_purchase_at,
                -- Owed is derived: billed on credit, less credit notes, less
                -- receipts. Never a stored balance.
                COALESCE((SELECT SUM(s.credit_paise) FROM sales s
                           WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
                - COALESCE((SELECT SUM(r.total_paise) FROM sales_returns r
                             JOIN sales s2 ON s2.id = r.sale_id
                            WHERE s2.customer_id = c.id AND s2.credit_paise > 0), 0)
                - COALESCE((SELECT SUM(cr.amount_paise) FROM customer_receipts cr
                            WHERE cr.customer_id = c.id), 0) AS outstanding_paise
           FROM customers c ${filter}
          ORDER BY c.is_walk_in DESC, c.name
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as (Row & {
      invoices: number;
      total_paise: number;
      last_purchase_at: string | null;
      outstanding_paise: number;
    })[];

    const items: CustomerSummary[] = rows.map((row) => ({
      ...toCustomer(row),
      invoices: row.invoices,
      totalPaise: row.total_paise,
      lastPurchaseAt: row.last_purchase_at,
      outstandingPaise: row.outstanding_paise,
    }));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
