/**
 * Sales history repository.
 *
 * Reads the stored sale, never a recomputed one: the list shows the totals the
 * invoice was issued with, even if a product's price, name or tax rate changed
 * the next day. Voiding writes the status and the reversal movements; nothing
 * here deletes a row.
 */
import type { Database } from 'better-sqlite3';
import type { PaymentMethod, SaleQuery, SaleStatus, SaleSummary } from '@shared/sale';
import { Repository, newId } from './base';

interface SummaryRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_paise: number;
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  item_count: number;
  payment_methods: string | null;
  returned_paise: number;
}

const toSummary = (row: SummaryRow): SaleSummary => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  invoiceDate: row.invoice_date,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  itemCount: row.item_count,
  totalPaise: row.total_paise,
  returnedPaise: row.returned_paise,
  status: row.status as SaleStatus,
  paymentMethods: (row.payment_methods ?? '').split(',').filter(Boolean).sort() as PaymentMethod[],
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
});

const SALE_SELECT = `
  SELECT s.id, s.invoice_number, s.invoice_date, s.customer_name, s.customer_phone,
         s.total_paise, s.status, s.voided_at, s.void_reason,
         (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
         (SELECT GROUP_CONCAT(DISTINCT pm.method) FROM payments pm WHERE pm.sale_id = s.id)
           AS payment_methods,
         COALESCE((SELECT SUM(sr.total_paise) FROM sales_returns sr WHERE sr.sale_id = s.id), 0)
           AS returned_paise
    FROM sales s
`;

export interface SaleTotals {
  total: number;
  completedCount: number;
  completedTotalPaise: number;
  voidedCount: number;
  returnedTotalPaise: number;
}

export interface VoidableSale {
  id: string;
  invoiceNumber: string;
  status: SaleStatus;
  totalPaise: number;
  branchId: string;
}

export class SalesRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  /** Builds the shared WHERE clause, so the page and its totals filter identically. */
  private filter(query: SaleQuery): { where: string; params: Record<string, unknown> } {
    const where: string[] = ['s.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.search) {
      where.push(
        '(s.invoice_number LIKE @like OR s.customer_name LIKE @like OR s.customer_phone LIKE @like)',
      );
      params['like'] = `%${query.search}%`;
    }
    if (query.fromIso) {
      where.push('s.invoice_date >= @fromIso');
      params['fromIso'] = query.fromIso;
    }
    if (query.toIso) {
      where.push('s.invoice_date <= @toIso');
      params['toIso'] = query.toIso;
    }
    if (query.status !== 'all') {
      where.push('s.status = @status');
      params['status'] = query.status;
    }
    if (query.customerId) {
      where.push('s.customer_id = @customerId');
      params['customerId'] = query.customerId;
    }
    if (query.paymentMethod) {
      where.push('EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.method = @method)');
      params['method'] = query.paymentMethod;
    }

    return { where: `WHERE ${where.join(' AND ')}`, params };
  }

  search(query: SaleQuery): { items: SaleSummary[]; totals: SaleTotals } {
    const { where, params } = this.filter(query);

    const sortColumn = {
      date: 's.invoice_date',
      invoice: 's.invoice_number',
      total: 's.total_paise',
    }[query.sort];
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';

    // Invoice number breaks ties: two sales in the same millisecond must still
    // come back in a stable order, or a page boundary could drop or repeat one.
    const rows = this.db
      .prepare(
        `${SALE_SELECT} ${where}
          ORDER BY ${sortColumn} ${direction}, s.invoice_number ${direction}
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as SummaryRow[];

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
                COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total_paise ELSE 0 END), 0)
                  AS completed_total,
                COALESCE(SUM(CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END), 0) AS voided_count,
                COALESCE(SUM((SELECT COALESCE(SUM(sr.total_paise), 0) FROM sales_returns sr
                               WHERE sr.sale_id = s.id)), 0) AS returned_total
           FROM sales s ${where}`,
      )
      .get(params) as {
      total: number;
      completed_count: number;
      completed_total: number;
      voided_count: number;
      returned_total: number;
    };

    return {
      items: rows.map(toSummary),
      totals: {
        total: totals.total,
        completedCount: totals.completed_count,
        completedTotalPaise: totals.completed_total,
        voidedCount: totals.voided_count,
        returnedTotalPaise: totals.returned_total,
      },
    };
  }

  findForVoid(id: string): VoidableSale | null {
    const row = this.db
      .prepare(
        `SELECT id, invoice_number, status, total_paise, branch_id
           FROM sales WHERE id = ? AND company_id = ?`,
      )
      .get(id, this.companyId) as
      | {
          id: string;
          invoice_number: string;
          status: string;
          total_paise: number;
          branch_id: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      status: row.status as SaleStatus,
      totalPaise: row.total_paise,
      branchId: row.branch_id,
    };
  }

  /** True when any credit note has been raised against this sale. */
  hasReturns(saleId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS found FROM sales_returns WHERE sale_id = ? LIMIT 1')
      .get(saleId) as { found: number } | undefined;
    return row !== undefined;
  }

  markVoided(id: string, reason: string, operatorId: string | null, at: string): void {
    this.db
      .prepare(
        `UPDATE sales
            SET status = 'voided', voided_at = @at, void_reason = @reason,
                voided_by = @operatorId, updated_at = @at
          WHERE id = @id AND status = 'completed'`,
      )
      .run({ id, reason, operatorId, at });
  }

  /** The stock this sale took out, as the ledger recorded it. */
  saleMovements(saleId: string): { productId: string; quantityMilli: number }[] {
    const rows = this.db
      .prepare(
        `SELECT product_id, quantity_milli FROM inventory_movements
          WHERE reference_type = 'sale' AND reference_id = ?`,
      )
      .all(saleId) as { product_id: string; quantity_milli: number }[];
    return rows.map((r) => ({ productId: r.product_id, quantityMilli: r.quantity_milli }));
  }

  /**
   * Puts stock back by writing the opposite movement, never by editing the
   * original one — the ledger has to explain how the balance got where it is.
   */
  insertVoidReversal(input: {
    branchId: string;
    productId: string;
    quantityMilli: number;
    saleId: string;
    reason: string;
    operatorId: string | null;
    at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
           quantity_milli, reference_type, reference_id, reason, operator_id, created_at)
         VALUES (?, ?, ?, ?, 'adjustment', ?, 'sale_void', ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        this.companyId,
        input.branchId,
        input.productId,
        input.quantityMilli,
        input.saleId,
        input.reason,
        input.operatorId,
        input.at,
      );
  }
}
