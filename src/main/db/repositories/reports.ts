/**
 * Report queries.
 *
 * Shared rules, applied by every query here:
 *
 *   - Only `completed` sales count. A voided sale is not a sale.
 *   - Money is read from the stored invoice and never recalculated, so a price
 *     change today cannot move last week's figures.
 *   - Days are the shop's local days: timestamps are stored in UTC, and
 *     `date(..., 'localtime')` buckets them the way the shopkeeper counts them.
 *   - Returns are counted against the day the credit note was raised, not the
 *     day of the original sale, because that is when the money left the till.
 */
import type { Database } from 'better-sqlite3';
import { Repository } from './base';

export interface Range {
  fromIso: string;
  toIso: string;
}

interface Params extends Record<string, unknown> {
  companyId: string;
  fromIso: string;
  toIso: string;
}

const SALE_FILTER = `s.company_id = @companyId AND s.status = 'completed'
  AND s.invoice_date >= @fromIso AND s.invoice_date <= @toIso`;

const RETURN_FILTER = `r.company_id = @companyId
  AND r.return_date >= @fromIso AND r.return_date <= @toIso`;

export interface SummaryRow {
  invoices: number;
  lines: number;
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  round_off: number;
  total: number;
}

export interface DailyRow {
  day: string;
  invoices: number;
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  returns: number;
}

export interface ProductRow {
  product_id: string | null;
  name: string;
  sku: string | null;
  unit_code: string;
  qty: number;
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  cost_paise: number | null;
  returned_qty: number;
  returned_total: number;
  returned_taxable: number;
}

export interface CategoryRow {
  category: string;
  lines: number;
  taxable: number;
  tax: number;
  total: number;
  cost: number;
}

export interface PaymentRow {
  method: string;
  count: number;
  collected: number;
  refunded: number;
}

export interface TaxRow {
  rate_bp: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
}

export interface DiscountRow {
  day: string;
  invoices: number;
  gross: number;
  item_discount: number;
  cart_discount: number;
}

export interface ReturnRow {
  return_number: string;
  return_date: string;
  invoice_number: string;
  lines: number;
  taxable: number;
  tax: number;
  total: number;
  refund_method: string;
  restocked_lines: number;
}

export interface PurchaseReportRow {
  purchase_number: string;
  purchase_date: string;
  supplier_bill_no: string | null;
  supplier_name: string | null;
  lines: number;
  taxable: number;
  tax: number;
  total: number;
  paid: number;
  returned: number;
}

export interface PurchaseReturnReportRow {
  return_number: string;
  return_date: string;
  purchase_number: string;
  supplier_name: string | null;
  lines: number;
  taxable: number;
  tax: number;
  total: number;
  settlement: string;
}

export interface SupplierOwedRow {
  name: string;
  phone: string | null;
  purchased: number;
  returned: number;
  paid: number;
  owed: number;
  last_purchase_at: string | null;
}

export interface StockRow {
  name: string;
  sku: string | null;
  unit_code: string;
  stock_milli: number;
  cost_paise: number;
  price_paise: number;
}

export interface MovementRow {
  created_at: string;
  product_name: string;
  unit_code: string;
  movement_type: string;
  document_number: string | null;
  quantity_milli: number;
  reason: string | null;
}

export class ReportsRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  private params(range: Range): Params {
    return { companyId: this.companyId, fromIso: range.fromIso, toIso: range.toIso };
  }

  salesSummary(range: Range): SummaryRow {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS invoices,
                COALESCE((SELECT COUNT(*) FROM sale_items si JOIN sales s2 ON s2.id = si.sale_id
                           WHERE s2.company_id = @companyId AND s2.status = 'completed'
                             AND s2.invoice_date >= @fromIso AND s2.invoice_date <= @toIso), 0) AS lines,
                COALESCE(SUM(s.gross_paise), 0) AS gross,
                COALESCE(SUM(s.item_discount_paise + s.cart_discount_paise), 0) AS discount,
                COALESCE(SUM(s.taxable_paise), 0) AS taxable,
                COALESCE(SUM(s.cgst_paise), 0) AS cgst,
                COALESCE(SUM(s.sgst_paise), 0) AS sgst,
                COALESCE(SUM(s.igst_paise), 0) AS igst,
                COALESCE(SUM(s.tax_paise), 0) AS tax,
                COALESCE(SUM(s.round_off_paise), 0) AS round_off,
                COALESCE(SUM(s.total_paise), 0) AS total
           FROM sales s WHERE ${SALE_FILTER}`,
      )
      .get(this.params(range)) as SummaryRow;
  }

  /** Credit notes raised in the range, whatever day the original sale was. */
  returnsTotal(range: Range): { count: number; total: number } {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(r.total_paise), 0) AS total
           FROM sales_returns r WHERE ${RETURN_FILTER}`,
      )
      .get(this.params(range)) as { count: number; total: number };
  }

  dailySales(range: Range): DailyRow[] {
    const sales = this.db
      .prepare(
        `SELECT date(s.invoice_date, 'localtime') AS day,
                COUNT(*) AS invoices,
                COALESCE(SUM(s.gross_paise), 0) AS gross,
                COALESCE(SUM(s.item_discount_paise + s.cart_discount_paise), 0) AS discount,
                COALESCE(SUM(s.taxable_paise), 0) AS taxable,
                COALESCE(SUM(s.tax_paise), 0) AS tax,
                COALESCE(SUM(s.total_paise), 0) AS total
           FROM sales s WHERE ${SALE_FILTER}
          GROUP BY day ORDER BY day DESC`,
      )
      .all(this.params(range)) as Omit<DailyRow, 'returns'>[];

    const returns = this.db
      .prepare(
        `SELECT date(r.return_date, 'localtime') AS day,
                COALESCE(SUM(r.total_paise), 0) AS total
           FROM sales_returns r WHERE ${RETURN_FILTER}
          GROUP BY day`,
      )
      .all(this.params(range)) as { day: string; total: number }[];

    const byDay = new Map(returns.map((r) => [r.day, r.total]));
    const days = new Map<string, DailyRow>();

    for (const row of sales) days.set(row.day, { ...row, returns: byDay.get(row.day) ?? 0 });

    // A day with only returns still belongs in the report.
    for (const [day, total] of byDay) {
      if (days.has(day)) continue;
      days.set(day, {
        day,
        invoices: 0,
        gross: 0,
        discount: 0,
        taxable: 0,
        tax: 0,
        total: 0,
        returns: total,
      });
    }

    return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
  }

  productWise(range: Range): ProductRow[] {
    return this.db
      .prepare(
        `SELECT si.product_id,
                COALESCE(p.name, si.name) AS name,
                p.sku AS sku,
                si.unit_code,
                SUM(si.quantity_milli) AS qty,
                SUM(si.taxable_paise + si.tax_paise + si.discount_paise) AS gross,
                SUM(si.discount_paise) AS discount,
                SUM(si.taxable_paise) AS taxable,
                SUM(si.tax_paise) AS tax,
                SUM(si.total_paise) AS total,
                p.cost_paise,
                COALESCE((SELECT SUM(ri.quantity_milli)
                            FROM sales_return_items ri
                            JOIN sales_returns r ON r.id = ri.return_id
                            JOIN sale_items si2 ON si2.id = ri.sale_item_id
                           WHERE si2.product_id IS si.product_id AND ${RETURN_FILTER}), 0)
                  AS returned_qty,
                COALESCE((SELECT SUM(ri.total_paise)
                            FROM sales_return_items ri
                            JOIN sales_returns r ON r.id = ri.return_id
                            JOIN sale_items si2 ON si2.id = ri.sale_item_id
                           WHERE si2.product_id IS si.product_id AND ${RETURN_FILTER}), 0)
                  AS returned_total,
                COALESCE((SELECT SUM(ri.taxable_paise)
                            FROM sales_return_items ri
                            JOIN sales_returns r ON r.id = ri.return_id
                            JOIN sale_items si2 ON si2.id = ri.sale_item_id
                           WHERE si2.product_id IS si.product_id AND ${RETURN_FILTER}), 0)
                  AS returned_taxable
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           LEFT JOIN products p ON p.id = si.product_id
          WHERE ${SALE_FILTER}
          GROUP BY si.product_id, si.unit_code
          ORDER BY total DESC`,
      )
      .all(this.params(range)) as ProductRow[];
  }

  categoryWise(range: Range): CategoryRow[] {
    return this.db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorised') AS category,
                COUNT(*) AS lines,
                SUM(si.taxable_paise) AS taxable,
                SUM(si.tax_paise) AS tax,
                SUM(si.total_paise) AS total,
                COALESCE(SUM(p.cost_paise * si.quantity_milli / 1000), 0) AS cost
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           LEFT JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${SALE_FILTER}
          GROUP BY category ORDER BY total DESC`,
      )
      .all(this.params(range)) as CategoryRow[];
  }

  /**
   * What each method actually took in. Cash handed over that went straight back
   * as change was never takings, so the change is subtracted here.
   */
  paymentMethods(range: Range): PaymentRow[] {
    return this.db
      .prepare(
        `SELECT pm.method,
                COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN pm.amount_paise > 0
                                  THEN pm.amount_paise - COALESCE(pm.change_paise, 0)
                                  ELSE 0 END), 0) AS collected,
                COALESCE(SUM(CASE WHEN pm.amount_paise < 0 THEN -pm.amount_paise ELSE 0 END), 0)
                  AS refunded
           FROM payments pm
           LEFT JOIN sales s ON s.id = pm.sale_id
           LEFT JOIN sales_returns r ON r.id = pm.return_id
          WHERE (pm.sale_id IS NOT NULL AND ${SALE_FILTER})
             OR (pm.return_id IS NOT NULL AND ${RETURN_FILTER})
          GROUP BY pm.method ORDER BY collected DESC`,
      )
      .all(this.params(range)) as PaymentRow[];
  }

  /** Net of returns, because that is what a GST return reports. */
  taxSummary(range: Range): TaxRow[] {
    const sales = this.db
      .prepare(
        `SELECT si.tax_rate_bp AS rate_bp,
                SUM(si.taxable_paise) AS taxable,
                SUM(si.cgst_paise) AS cgst,
                SUM(si.sgst_paise) AS sgst,
                SUM(si.igst_paise) AS igst,
                SUM(si.tax_paise) AS tax
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE ${SALE_FILTER}
          GROUP BY rate_bp ORDER BY rate_bp`,
      )
      .all(this.params(range)) as TaxRow[];

    const returns = this.db
      .prepare(
        `SELECT si.tax_rate_bp AS rate_bp,
                SUM(ri.taxable_paise) AS taxable,
                SUM(ri.cgst_paise) AS cgst,
                SUM(ri.sgst_paise) AS sgst,
                SUM(ri.igst_paise) AS igst,
                SUM(ri.tax_paise) AS tax
           FROM sales_return_items ri
           JOIN sales_returns r ON r.id = ri.return_id
           JOIN sale_items si ON si.id = ri.sale_item_id
          WHERE ${RETURN_FILTER}
          GROUP BY rate_bp`,
      )
      .all(this.params(range)) as TaxRow[];

    const credited = new Map(returns.map((r) => [r.rate_bp, r]));
    const rates = new Set([...sales.map((r) => r.rate_bp), ...credited.keys()]);

    return [...rates]
      .sort((a, b) => a - b)
      .map((rate) => {
        const sold = sales.find((r) => r.rate_bp === rate);
        const back = credited.get(rate);
        return {
          rate_bp: rate,
          taxable: (sold?.taxable ?? 0) - (back?.taxable ?? 0),
          cgst: (sold?.cgst ?? 0) - (back?.cgst ?? 0),
          sgst: (sold?.sgst ?? 0) - (back?.sgst ?? 0),
          igst: (sold?.igst ?? 0) - (back?.igst ?? 0),
          tax: (sold?.tax ?? 0) - (back?.tax ?? 0),
        };
      });
  }

  discounts(range: Range): DiscountRow[] {
    return this.db
      .prepare(
        `SELECT date(s.invoice_date, 'localtime') AS day,
                COUNT(*) AS invoices,
                COALESCE(SUM(s.gross_paise), 0) AS gross,
                COALESCE(SUM(s.item_discount_paise), 0) AS item_discount,
                COALESCE(SUM(s.cart_discount_paise), 0) AS cart_discount
           FROM sales s WHERE ${SALE_FILTER}
          GROUP BY day ORDER BY day DESC`,
      )
      .all(this.params(range)) as DiscountRow[];
  }

  returnsList(range: Range): ReturnRow[] {
    return this.db
      .prepare(
        `SELECT r.return_number, r.return_date, s.invoice_number,
                (SELECT COUNT(*) FROM sales_return_items ri WHERE ri.return_id = r.id) AS lines,
                r.taxable_paise AS taxable, r.tax_paise AS tax, r.total_paise AS total,
                r.refund_method,
                (SELECT COUNT(*) FROM sales_return_items ri
                  WHERE ri.return_id = r.id AND ri.restocked = 1) AS restocked_lines
           FROM sales_returns r JOIN sales s ON s.id = r.sale_id
          WHERE ${RETURN_FILTER}
          ORDER BY r.return_date DESC`,
      )
      .all(this.params(range)) as ReturnRow[];
  }

  /** Bought in the range. A cancelled purchase is not a purchase. */
  purchases(range: Range): PurchaseReportRow[] {
    return this.db
      .prepare(
        `SELECT p.purchase_number, p.purchase_date, p.supplier_bill_no, p.supplier_name,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS lines,
                p.taxable_paise AS taxable, p.tax_paise AS tax, p.total_paise AS total,
                COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
                           WHERE sp.purchase_id = p.id), 0) AS paid,
                COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r
                           WHERE r.purchase_id = p.id), 0) AS returned
           FROM purchases p
          WHERE p.company_id = @companyId AND p.status = 'completed'
            AND p.purchase_date >= @fromIso AND p.purchase_date <= @toIso
          ORDER BY p.purchase_date DESC`,
      )
      .all(this.params(range)) as PurchaseReportRow[];
  }

  purchaseReturns(range: Range): PurchaseReturnReportRow[] {
    return this.db
      .prepare(
        `SELECT r.return_number, r.return_date, p.purchase_number, s.name AS supplier_name,
                (SELECT COUNT(*) FROM purchase_return_items ri WHERE ri.return_id = r.id) AS lines,
                r.taxable_paise AS taxable, r.tax_paise AS tax, r.total_paise AS total,
                r.settlement
           FROM purchase_returns r
           JOIN purchases p ON p.id = r.purchase_id
           JOIN suppliers s ON s.id = r.supplier_id
          WHERE r.company_id = @companyId
            AND r.return_date >= @fromIso AND r.return_date <= @toIso
          ORDER BY r.return_date DESC`,
      )
      .all(this.params(range)) as PurchaseReturnReportRow[];
  }

  /** What is owed to each supplier right now, worst first. */
  supplierOutstanding(): SupplierOwedRow[] {
    const rows = this.db
      .prepare(
        `SELECT s.name, s.phone,
                COALESCE((SELECT SUM(p.total_paise) FROM purchases p
                           WHERE p.supplier_id = s.id AND p.status = 'completed'), 0) AS purchased,
                COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r
                           JOIN purchases p2 ON p2.id = r.purchase_id
                          WHERE r.supplier_id = s.id AND p2.status = 'completed'), 0) AS returned,
                COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
                           WHERE sp.supplier_id = s.id), 0) AS paid,
                (SELECT MAX(p.purchase_date) FROM purchases p
                  WHERE p.supplier_id = s.id AND p.status = 'completed') AS last_purchase_at
           FROM suppliers s
          WHERE s.company_id = @companyId
          ORDER BY s.name`,
      )
      .all({ companyId: this.companyId }) as Omit<SupplierOwedRow, 'owed'>[];

    return rows
      .map((row) => ({ ...row, owed: row.purchased - row.returned - row.paid }))
      .filter((row) => row.owed !== 0 || row.purchased !== 0)
      .sort((a, b) => b.owed - a.owed);
  }

  stockOnHand(): StockRow[] {
    return this.db
      .prepare(
        `SELECT p.name, p.sku, p.unit_code, p.cost_paise, p.price_paise,
                (SELECT COALESCE(SUM(m.quantity_milli), 0)
                   FROM inventory_movements m WHERE m.product_id = p.id) AS stock_milli
           FROM products p
          WHERE p.company_id = @companyId AND p.is_active = 1 AND p.track_inventory = 1
          ORDER BY p.name`,
      )
      .all({ companyId: this.companyId }) as StockRow[];
  }

  stockMovements(range: Range): MovementRow[] {
    return this.db
      .prepare(
        `SELECT m.created_at, p.name AS product_name, p.unit_code, m.movement_type,
                COALESCE(s.invoice_number, r.return_number) AS document_number,
                m.quantity_milli, m.reason
           FROM inventory_movements m
           JOIN products p ON p.id = m.product_id
           LEFT JOIN sales s
             ON m.reference_type IN ('sale', 'sale_void') AND s.id = m.reference_id
           LEFT JOIN sales_returns r
             ON m.reference_type = 'sale_return' AND r.id = m.reference_id
          WHERE m.company_id = @companyId
            AND m.created_at >= @fromIso AND m.created_at <= @toIso
          ORDER BY m.created_at DESC`,
      )
      .all(this.params(range)) as MovementRow[];
  }
}
