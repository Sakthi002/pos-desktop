/**
 * Quotations, as storage.
 *
 * Nothing here touches stock, money or the ledger: a quotation is a document
 * and nothing else. Its numbering lives in its own table so it can never take
 * a number from the invoice series.
 */
import type { Database } from 'better-sqlite3';
import { Repository, newId, now } from './base';

export interface QuotationRow {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  customer_state_code: string | null;
  price_level: string;
  tax_mode: string;
  is_interstate: number;
  gross_paise: number;
  item_discount_paise: number;
  cart_discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  round_off_paise: number;
  total_paise: number;
  status: 'open' | 'converted' | 'cancelled';
  converted_sale_id: string | null;
  cancel_reason: string | null;
  notes: string | null;
  terms: string | null;
}

export class QuotationRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  /** QTN-0001 upwards, per branch and financial year. */
  allocateNumber(branchId: string, financialYear: string, prefix: string): string {
    const existing = this.db
      .prepare(
        `SELECT prefix, next_number FROM quotation_sequences
          WHERE branch_id = ? AND financial_year = ?`,
      )
      .get(branchId, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO quotation_sequences (branch_id, financial_year, prefix, next_number)
           VALUES (?, ?, ?, 2)`,
        )
        .run(branchId, financialYear, prefix);
      return `${prefix}-0001`;
    }

    this.db
      .prepare(
        `UPDATE quotation_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND financial_year = ?`,
      )
      .run(branchId, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  insert(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO quotations (id, company_id, branch_id, operator_id, quotation_number,
           financial_year, quotation_date, valid_until, customer_id, customer_name,
           customer_phone, customer_gstin, customer_state_code, price_level, tax_mode,
           is_interstate, gross_paise, item_discount_paise, cart_discount_paise, taxable_paise,
           cgst_paise, sgst_paise, igst_paise, tax_paise, round_off_paise, total_paise,
           notes, terms, idempotency_key, created_at, updated_at)
         VALUES (@id, @companyId, @branchId, @operatorId, @quotationNumber,
           @financialYear, @at, @validUntil, @customerId, @customerName,
           @customerPhone, @customerGstin, @customerStateCode, @priceLevel, @taxMode,
           @isInterstate, @gross, @itemDiscount, @cartDiscount, @taxable,
           @cgst, @sgst, @igst, @tax, @roundOff, @total, @notes, @terms,
           @idempotencyKey, @at, @at)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertItem(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO quotation_items (id, quotation_id, line_no, product_id, name, sku, hsn,
           unit_code, quantity_milli, unit_price_paise, discount_paise, taxable_paise,
           tax_rate_bp, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise, created_at)
         VALUES (@id, @quotationId, @lineNo, @productId, @name, @sku, @hsn,
           @unitCode, @quantityMilli, @unitPricePaise, @discountPaise, @taxablePaise,
           @taxRateBp, @cgst, @sgst, @igst, @tax, @total, @at)`,
      )
      .run({ ...input, id: newId() });
  }

  find(id: string): QuotationRow | null {
    const row = this.db
      .prepare('SELECT * FROM quotations WHERE id = ? AND company_id = ?')
      .get(id, this.companyId) as QuotationRow | undefined;
    return row ?? null;
  }

  findByIdempotencyKey(key: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM quotations WHERE idempotency_key = ? AND company_id = ?')
      .get(key, this.companyId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  items(quotationId: string): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY line_no')
      .all(quotationId) as Record<string, unknown>[];
  }

  search(query: { search: string; status: string; page: number; pageSize: number }): {
    rows: (QuotationRow & { items: number; invoice_number: string | null })[];
    total: number;
    openCount: number;
    openValue: number;
  } {
    const where: string[] = ['q.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId, today: now() };

    if (query.search) {
      where.push('(q.quotation_number LIKE @like OR q.customer_name LIKE @like)');
      params['like'] = `%${query.search}%`;
    }
    if (query.status === 'converted' || query.status === 'cancelled') {
      where.push('q.status = @status');
      params['status'] = query.status;
    }
    if (query.status === 'open') {
      where.push("q.status = 'open' AND (q.valid_until IS NULL OR q.valid_until >= @today)");
    }
    if (query.status === 'expired') {
      where.push("q.status = 'open' AND q.valid_until IS NOT NULL AND q.valid_until < @today");
    }

    const filter = `WHERE ${where.join(' AND ')}`;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM quotations q ${filter}`).get(params) as {
        n: number;
      }
    ).n;

    const open = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS value
           FROM quotations
          WHERE company_id = @companyId AND status = 'open'
            AND (valid_until IS NULL OR valid_until >= @today)`,
      )
      .get({ companyId: this.companyId, today: now() }) as { n: number; value: number };

    const rows = this.db
      .prepare(
        `SELECT q.*, s.invoice_number,
                (SELECT COUNT(*) FROM quotation_items i WHERE i.quotation_id = q.id) AS items
           FROM quotations q
           LEFT JOIN sales s ON s.id = q.converted_sale_id
           ${filter}
          ORDER BY q.quotation_date DESC, q.quotation_number DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as (QuotationRow & { items: number; invoice_number: string | null })[];

    return { rows, total, openCount: open.n, openValue: open.value };
  }

  markConverted(id: string, saleId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE quotations SET status = 'converted', converted_sale_id = ?, converted_at = ?,
            updated_at = ? WHERE id = ?`,
      )
      .run(saleId, at, at, id);
  }

  markCancelled(id: string, reason: string, at: string): void {
    this.db
      .prepare(
        `UPDATE quotations SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?,
            updated_at = ? WHERE id = ?`,
      )
      .run(reason, at, at, id);
  }

  invoiceNumberFor(saleId: string): string | null {
    const row = this.db.prepare('SELECT invoice_number FROM sales WHERE id = ?').get(saleId) as
      { invoice_number: string } | undefined;
    return row?.invoice_number ?? null;
  }
}
