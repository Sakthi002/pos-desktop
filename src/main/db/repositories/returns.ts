/**
 * Returns repository.
 *
 * Everything a return needs to be honest about comes from the original sale:
 * what was sold, at what price, under which tax heads, and how much of it has
 * already come back. None of it is recomputed from today's catalogue.
 */
import type { Database } from 'better-sqlite3';
import type { PaymentMethod } from '@shared/sale';
import type {
  PriorReturn,
  ReturnReceipt,
  ReturnReceiptLine,
  ReturnableLine,
} from '@shared/returns';
import { Repository, newId } from './base';

interface SaleHeaderRow {
  id: string;
  branch_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string | null;
  status: string;
  is_interstate: number;
}

interface LineRow {
  sale_item_id: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  unit_code: string;
  sold_milli: number;
  returned_milli: number;
  unit_price_paise: number;
  tax_rate_bp: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  total_paise: number;
  track_inventory: number | null;
  returned_taxable_paise: number;
  returned_cgst_paise: number;
  returned_sgst_paise: number;
  returned_igst_paise: number;
}

/** A sale line plus everything already returned against it. */
export interface SaleLineLedger extends ReturnableLine {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  returnedTaxablePaise: number;
  returnedCgstPaise: number;
  returnedSgstPaise: number;
  returnedIgstPaise: number;
}

export class ReturnsRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  saleHeader(saleId: string): {
    id: string;
    branchId: string;
    invoiceNumber: string;
    invoiceDate: string;
    customerName: string | null;
    status: 'completed' | 'voided';
    isInterstate: boolean;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, branch_id, invoice_number, invoice_date, customer_name, status, is_interstate
           FROM sales WHERE id = ? AND company_id = ?`,
      )
      .get(saleId, this.companyId) as SaleHeaderRow | undefined;

    if (!row) return null;
    return {
      id: row.id,
      branchId: row.branch_id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      customerName: row.customer_name,
      status: row.status as 'completed' | 'voided',
      isInterstate: row.is_interstate === 1,
    };
  }

  /** Sale lines with the quantity and value already credited back. */
  saleLines(saleId: string): SaleLineLedger[] {
    const rows = this.db
      .prepare(
        `SELECT si.id AS sale_item_id, si.product_id, si.name, si.sku, si.unit_code,
                si.quantity_milli AS sold_milli, si.unit_price_paise, si.tax_rate_bp,
                si.taxable_paise, si.cgst_paise, si.sgst_paise, si.igst_paise,
                si.tax_paise, si.total_paise, p.track_inventory,
                COALESCE((SELECT SUM(ri.quantity_milli) FROM sales_return_items ri
                           WHERE ri.sale_item_id = si.id), 0) AS returned_milli,
                COALESCE((SELECT SUM(ri.taxable_paise) FROM sales_return_items ri
                           WHERE ri.sale_item_id = si.id), 0) AS returned_taxable_paise,
                COALESCE((SELECT SUM(ri.cgst_paise) FROM sales_return_items ri
                           WHERE ri.sale_item_id = si.id), 0) AS returned_cgst_paise,
                COALESCE((SELECT SUM(ri.sgst_paise) FROM sales_return_items ri
                           WHERE ri.sale_item_id = si.id), 0) AS returned_sgst_paise,
                COALESCE((SELECT SUM(ri.igst_paise) FROM sales_return_items ri
                           WHERE ri.sale_item_id = si.id), 0) AS returned_igst_paise
           FROM sale_items si
           LEFT JOIN products p ON p.id = si.product_id
          WHERE si.sale_id = ?
          ORDER BY si.line_no`,
      )
      .all(saleId) as LineRow[];

    return rows.map((row) => ({
      saleItemId: row.sale_item_id,
      productId: row.product_id,
      name: row.name,
      sku: row.sku,
      unitCode: row.unit_code,
      soldMilli: row.sold_milli,
      returnedMilli: row.returned_milli,
      returnableMilli: row.sold_milli - row.returned_milli,
      unitPricePaise: row.unit_price_paise,
      taxRateBp: row.tax_rate_bp,
      taxablePaise: row.taxable_paise,
      cgstPaise: row.cgst_paise,
      sgstPaise: row.sgst_paise,
      igstPaise: row.igst_paise,
      taxPaise: row.tax_paise,
      totalPaise: row.total_paise,
      trackInventory: row.track_inventory === 1,
      returnedTaxablePaise: row.returned_taxable_paise,
      returnedCgstPaise: row.returned_cgst_paise,
      returnedSgstPaise: row.returned_sgst_paise,
      returnedIgstPaise: row.returned_igst_paise,
    }));
  }

  priorReturns(saleId: string): PriorReturn[] {
    const rows = this.db
      .prepare(
        `SELECT id, return_number, return_date, total_paise, refund_method, reason
           FROM sales_returns WHERE sale_id = ? ORDER BY return_date, return_number`,
      )
      .all(saleId) as {
      id: string;
      return_number: string;
      return_date: string;
      total_paise: number;
      refund_method: string;
      reason: string | null;
    }[];

    return rows.map((row) => ({
      id: row.id,
      returnNumber: row.return_number,
      returnDate: row.return_date,
      totalPaise: row.total_paise,
      refundMethod: row.refund_method as PaymentMethod,
      reason: row.reason,
    }));
  }

  findByIdempotencyKey(key: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM sales_returns WHERE idempotency_key = ?')
      .get(key) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * Next credit-note number for the branch and financial year. Allocated inside
   * the return transaction, so a rolled-back return burns no number.
   */
  allocateReturnNumber(
    branchId: string,
    financialYear: string,
    fallbackPrefix: string,
    fallbackStart: number,
  ): string {
    const existing = this.db
      .prepare(
        `SELECT prefix, next_number FROM invoice_sequences
          WHERE branch_id = ? AND kind = 'return' AND financial_year = ?`,
      )
      .get(branchId, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO invoice_sequences (branch_id, kind, financial_year, prefix, next_number)
           VALUES (?, 'return', ?, ?, ?)`,
        )
        .run(branchId, financialYear, fallbackPrefix, fallbackStart + 1);
      return `${fallbackPrefix}-${String(fallbackStart).padStart(4, '0')}`;
    }

    this.db
      .prepare(
        `UPDATE invoice_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND kind = 'return' AND financial_year = ?`,
      )
      .run(branchId, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  insertReturn(input: {
    id: string;
    branchId: string;
    saleId: string;
    operatorId: string | null;
    returnNumber: string;
    financialYear: string;
    returnDate: string;
    reason: string;
    refundMethod: PaymentMethod;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    taxPaise: number;
    roundOffPaise: number;
    totalPaise: number;
    idempotencyKey: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sales_returns (id, company_id, branch_id, sale_id, operator_id, return_number,
           financial_year, return_date, reason, taxable_paise, cgst_paise, sgst_paise, igst_paise,
           tax_paise, round_off_paise, total_paise, refund_method, idempotency_key, created_at)
         VALUES (@id, @companyId, @branchId, @saleId, @operatorId, @returnNumber,
           @financialYear, @returnDate, @reason, @taxablePaise, @cgstPaise, @sgstPaise, @igstPaise,
           @taxPaise, @roundOffPaise, @totalPaise, @refundMethod, @idempotencyKey, @returnDate)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertReturnItem(input: {
    returnId: string;
    saleItemId: string;
    productId: string | null;
    quantityMilli: number;
    unitPricePaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    taxPaise: number;
    totalPaise: number;
    restocked: boolean;
    at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sales_return_items (id, return_id, sale_item_id, product_id, quantity_milli,
           unit_price_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise,
           total_paise, restocked, created_at)
         VALUES (@id, @returnId, @saleItemId, @productId, @quantityMilli,
           @unitPricePaise, @taxablePaise, @cgstPaise, @sgstPaise, @igstPaise, @taxPaise,
           @totalPaise, @restocked, @at)`,
      )
      .run({ ...input, id: newId(), restocked: input.restocked ? 1 : 0 });
  }

  /** The refund is a payment with a negative amount, against the credit note. */
  insertRefund(input: {
    returnId: string;
    method: PaymentMethod;
    amountPaise: number;
    at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO payments (id, sale_id, return_id, method, amount_paise, created_at)
         VALUES (?, NULL, ?, ?, ?, ?)`,
      )
      .run(newId(), input.returnId, input.method, -Math.abs(input.amountPaise), input.at);
  }

  findReturn(returnId: string): ReturnReceipt | null {
    const row = this.db
      .prepare(
        `SELECT r.*, s.invoice_number
           FROM sales_returns r JOIN sales s ON s.id = r.sale_id
          WHERE r.id = ? AND r.company_id = ?`,
      )
      .get(returnId, this.companyId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const items = this.db
      .prepare(
        `SELECT ri.*, si.name, si.unit_code
           FROM sales_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
          WHERE ri.return_id = ?
          ORDER BY si.line_no`,
      )
      .all(returnId) as Record<string, unknown>[];

    const lines: ReturnReceiptLine[] = items.map((item) => ({
      saleItemId: item['sale_item_id'] as string,
      productId: (item['product_id'] as string | null) ?? null,
      name: item['name'] as string,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitPricePaise: item['unit_price_paise'] as number,
      taxablePaise: item['taxable_paise'] as number,
      cgstPaise: item['cgst_paise'] as number,
      sgstPaise: item['sgst_paise'] as number,
      igstPaise: item['igst_paise'] as number,
      taxPaise: item['tax_paise'] as number,
      totalPaise: item['total_paise'] as number,
      restocked: item['restocked'] === 1,
    }));

    return {
      id: returnId,
      returnNumber: row['return_number'] as string,
      returnDate: row['return_date'] as string,
      saleId: row['sale_id'] as string,
      invoiceNumber: row['invoice_number'] as string,
      reason: (row['reason'] as string | null) ?? null,
      refundMethod: row['refund_method'] as PaymentMethod,
      taxablePaise: row['taxable_paise'] as number,
      cgstPaise: row['cgst_paise'] as number,
      sgstPaise: row['sgst_paise'] as number,
      igstPaise: row['igst_paise'] as number,
      taxPaise: row['tax_paise'] as number,
      roundOffPaise: row['round_off_paise'] as number,
      totalPaise: row['total_paise'] as number,
      lines,
      duplicate: false,
    };
  }
}
