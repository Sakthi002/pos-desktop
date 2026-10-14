/**
 * Purchase orders, as storage.
 *
 * Nothing here touches stock, money or the ledger: an order is a document and
 * nothing else until the goods arrive. Its numbering lives in its own table so
 * it can never take a number from a series that has to run unbroken.
 */
import type { Database } from 'better-sqlite3';
import { Repository, newId, now } from './base';

export interface PurchaseOrderRow {
  id: string;
  order_number: string;
  order_date: string;
  expected_on: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_phone: string | null;
  supplier_gstin: string | null;
  total_paise: number;
  status: 'open' | 'received' | 'cancelled';
  received_purchase_id: string | null;
  cancel_reason: string | null;
  notes: string | null;
}

export class PurchaseOrderRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  /** PO-0001 upwards, per branch and financial year. */
  allocateNumber(branchId: string, financialYear: string, prefix: string): string {
    const existing = this.db
      .prepare(
        `SELECT prefix, next_number FROM purchase_order_sequences
          WHERE branch_id = ? AND financial_year = ?`,
      )
      .get(branchId, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO purchase_order_sequences (branch_id, financial_year, prefix, next_number)
           VALUES (?, ?, ?, 2)`,
        )
        .run(branchId, financialYear, prefix);
      return `${prefix}-0001`;
    }

    this.db
      .prepare(
        `UPDATE purchase_order_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND financial_year = ?`,
      )
      .run(branchId, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  insert(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO purchase_orders (id, company_id, branch_id, operator_id, order_number,
           financial_year, order_date, expected_on, supplier_id, supplier_name, supplier_phone,
           supplier_gstin, total_paise, notes, idempotency_key, created_at, updated_at)
         VALUES (@id, @companyId, @branchId, @operatorId, @orderNumber,
           @financialYear, @at, @expectedOn, @supplierId, @supplierName, @supplierPhone,
           @supplierGstin, @total, @notes, @idempotencyKey, @at, @at)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertItem(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO purchase_order_items (id, purchase_order_id, line_no, product_id, name,
           sku, unit_code, quantity_milli, unit_cost_paise, total_paise, created_at)
         VALUES (@id, @purchaseOrderId, @lineNo, @productId, @name,
           @sku, @unitCode, @quantityMilli, @unitCostPaise, @total, @at)`,
      )
      .run({ ...input, id: newId() });
  }

  find(id: string): PurchaseOrderRow | null {
    const row = this.db
      .prepare('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?')
      .get(id, this.companyId) as PurchaseOrderRow | undefined;
    return row ?? null;
  }

  findByIdempotencyKey(key: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM purchase_orders WHERE idempotency_key = ? AND company_id = ?')
      .get(key, this.companyId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  items(orderId: string): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY line_no')
      .all(orderId) as Record<string, unknown>[];
  }

  search(query: { search: string; status: string; page: number; pageSize: number }): {
    rows: (PurchaseOrderRow & { items: number; purchase_number: string | null })[];
    total: number;
    openCount: number;
    openValue: number;
  } {
    const where: string[] = ['o.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId, today: now() };

    if (query.search) {
      where.push('(o.order_number LIKE @like OR o.supplier_name LIKE @like)');
      params['like'] = `%${query.search}%`;
    }
    if (query.status === 'received' || query.status === 'cancelled') {
      where.push('o.status = @status');
      params['status'] = query.status;
    }
    if (query.status === 'open') {
      where.push("o.status = 'open' AND (o.expected_on IS NULL OR o.expected_on >= @today)");
    }
    if (query.status === 'overdue') {
      where.push("o.status = 'open' AND o.expected_on IS NOT NULL AND o.expected_on < @today");
    }

    const filter = `WHERE ${where.join(' AND ')}`;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM purchase_orders o ${filter}`).get(params) as {
        n: number;
      }
    ).n;

    const open = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS value
           FROM purchase_orders
          WHERE company_id = @companyId AND status = 'open'`,
      )
      .get({ companyId: this.companyId }) as { n: number; value: number };

    const rows = this.db
      .prepare(
        `SELECT o.*, p.purchase_number,
                (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = o.id)
                  AS items
           FROM purchase_orders o
           LEFT JOIN purchases p ON p.id = o.received_purchase_id
           ${filter}
          ORDER BY o.order_date DESC, o.order_number DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as (PurchaseOrderRow & { items: number; purchase_number: string | null })[];

    return { rows, total, openCount: open.n, openValue: open.value };
  }

  markReceived(id: string, purchaseId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE purchase_orders SET status = 'received', received_purchase_id = ?,
            received_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(purchaseId, at, at, id);
  }

  markCancelled(id: string, reason: string, at: string): void {
    this.db
      .prepare(
        `UPDATE purchase_orders SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?,
            updated_at = ? WHERE id = ?`,
      )
      .run(reason, at, at, id);
  }

  purchaseNumberFor(purchaseId: string): string | null {
    const row = this.db
      .prepare('SELECT purchase_number FROM purchases WHERE id = ?')
      .get(purchaseId) as { purchase_number: string } | undefined;
    return row?.purchase_number ?? null;
  }
}
