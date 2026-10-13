/**
 * Quoting a price.
 *
 * A quotation runs through the same calculation engine as the till, so what a
 * customer is promised is arithmetically the bill they will be given. What it
 * does not do is everything else a sale does: no stock movement, no payment,
 * no voucher. Nothing has happened yet.
 *
 * It is never edited. A price that was given stands; if it was wrong, cancel
 * it with a reason and quote again, which is the same discipline the rest of
 * the app keeps for documents a customer has seen.
 */
import type { Database } from 'better-sqlite3';
import {
  cancelQuotationSchema,
  quotationInputSchema,
  quotationQuerySchema,
  statusOf,
  type Quotation,
  type QuotationPage,
  type QuotationSummary,
} from '@shared/quotations';
import { calculateBill, type Bill, type BillLineInput } from '@shared/billing';
import { financialYearOf, type AppSettings } from '@shared/settings';
import type { PriceLevel } from '@shared/trade';
import { QuotationRepository, type QuotationRow } from '../db/repositories/quotations';
import { AuditRepository } from '../db/repositories/audit';
import { inTransaction, newId, now } from '../db/repositories/base';
import { SettingsService } from './settings-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class QuotationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QuotationError';
  }
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit_code: string;
  tax_rate_bp: number;
  tax_inclusive: number;
  is_active: number;
}

export class QuotationService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: QuotationRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new QuotationError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) throw new QuotationError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.settings = settings;

    this.repo = new QuotationRepository(db, ctx.companyId);
    this.audit = new AuditRepository(db);
  }

  private products(ids: string[]): Map<string, ProductRow> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, sku, hsn, unit_code, tax_rate_bp, tax_inclusive, is_active
           FROM products WHERE id IN (${placeholders})`,
      )
      .all(...ids) as ProductRow[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private isInterstate(customerId: string | null | undefined): boolean {
    if (!customerId || !this.ctx.branchStateCode) return false;
    const row = this.db.prepare('SELECT state_code FROM customers WHERE id = ?').get(customerId) as
      { state_code: string | null } | undefined;
    return Boolean(row?.state_code) && row?.state_code !== this.ctx.branchStateCode;
  }

  create(input: unknown): Quotation {
    const parsed = quotationInputSchema.parse(input);

    // The same submission arriving twice — a double tap, a retry — is the
    // first one, not a second quotation.
    const already = this.repo.findByIdempotencyKey(parsed.idempotencyKey);
    if (already) return this.get(already);

    const products = this.products(parsed.lines.map((l) => l.productId));

    const lines: BillLineInput[] = parsed.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product) throw new QuotationError('PRODUCT_NOT_FOUND', 'A product no longer exists.');
      if (product.is_active === 0) {
        throw new QuotationError('PRODUCT_INACTIVE', `${product.name} is no longer sold.`);
      }
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: null,
        hsn: product.hsn,
        unitCode: product.unit_code,
        quantityMilli: line.quantityMilli,
        unitPricePaise: line.unitPricePaise,
        // The same rule the till follows: a shop that is not registered quotes
        // no tax, whatever its products carry.
        taxRateBp: this.settings.tax.registered ? product.tax_rate_bp : 0,
        taxInclusive: product.tax_inclusive === 1,
        discountPaise: line.discountPaise,
      };
    });

    const bill = calculateBill({
      lines,
      cartDiscountPaise: parsed.cartDiscountPaise,
      isInterstate: this.isInterstate(parsed.customerId),
      roundTotal: this.settings.tax.roundTotalToRupee,
    });

    const id = newId();
    const at = now();
    const financialYear = financialYearOf(
      new Date(at),
      this.settings.invoice.financialYearStartMonth,
    );

    const validUntil =
      parsed.validDays === null || parsed.validDays === undefined
        ? null
        : new Date(new Date(at).getTime() + parsed.validDays * 86_400_000).toISOString();

    const customer = parsed.customerId
      ? (this.db
          .prepare('SELECT name, phone, gstin, state_code FROM customers WHERE id = ?')
          .get(parsed.customerId) as
          | { name: string; phone: string | null; gstin: string | null; state_code: string | null }
          | undefined)
      : undefined;

    inTransaction(this.db, () => {
      const quotationNumber = this.repo.allocateNumber(
        this.ctx.branchId,
        financialYear,
        `${this.settings.invoice.prefix}-QTN`,
      );

      this.repo.insert({
        id,
        branchId: this.ctx.branchId,
        operatorId: this.ctx.operatorId,
        quotationNumber,
        financialYear,
        at,
        validUntil,
        customerId: parsed.customerId ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        customerGstin: customer?.gstin ?? null,
        customerStateCode: customer?.state_code ?? null,
        priceLevel: parsed.priceLevel,
        taxMode: this.settings.tax.mode,
        isInterstate: bill.isInterstate ? 1 : 0,
        gross: bill.grossPaise,
        itemDiscount: bill.itemDiscountPaise,
        cartDiscount: bill.cartDiscountPaise,
        taxable: bill.taxablePaise,
        cgst: bill.cgstPaise,
        sgst: bill.sgstPaise,
        igst: bill.igstPaise,
        tax: bill.taxPaise,
        roundOff: bill.roundOffPaise,
        total: bill.totalPaise,
        notes: parsed.notes ?? null,
        terms: parsed.terms ?? null,
        idempotencyKey: parsed.idempotencyKey,
      });

      for (const line of bill.lines) {
        this.repo.insertItem({
          quotationId: id,
          lineNo: line.lineNo,
          productId: line.productId,
          name: line.name,
          sku: line.sku,
          hsn: line.hsn,
          unitCode: line.unitCode,
          quantityMilli: line.quantityMilli,
          unitPricePaise: line.unitPricePaise,
          discountPaise: line.totalDiscountPaise,
          taxablePaise: line.taxablePaise,
          taxRateBp: line.taxRateBp,
          cgst: line.cgstPaise,
          sgst: line.sgstPaise,
          igst: line.igstPaise,
          tax: line.taxPaise,
          total: line.totalPaise,
          at,
        });
      }

      this.audit.record(
        {
          entityType: 'quotation',
          entityId: id,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: { quotationNumber, totalPaise: bill.totalPaise, validUntil },
        },
        at,
      );
    });

    return this.get(id);
  }

  get(id: string): Quotation {
    const row = this.repo.find(id);
    if (!row) throw new QuotationError('NOT_FOUND', 'That quotation does not exist.');
    return this.toQuotation(row);
  }

  list(input: unknown): QuotationPage {
    const query = quotationQuerySchema.parse(input ?? {});
    const { rows, total, openCount, openValue } = this.repo.search(query);

    return {
      items: rows.map((row) => this.toSummary(row, row.items, row.invoice_number)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      openCount,
      openValuePaise: openValue,
    };
  }

  cancel(input: unknown): Quotation {
    const parsed = cancelQuotationSchema.parse(input);
    const row = this.repo.find(parsed.id);
    if (!row) throw new QuotationError('NOT_FOUND', 'That quotation does not exist.');
    if (row.status === 'converted') {
      throw new QuotationError('ALREADY_BILLED', 'That quotation has already been billed.');
    }
    if (row.status === 'cancelled') return this.toQuotation(row);

    const at = now();
    inTransaction(this.db, () => {
      this.repo.markCancelled(parsed.id, parsed.reason, at);
      this.audit.record(
        {
          entityType: 'quotation',
          entityId: parsed.id,
          action: 'cancel',
          operatorId: this.ctx.operatorId,
          details: { quotationNumber: row.quotation_number, reason: parsed.reason },
        },
        at,
      );
    });

    return this.get(parsed.id);
  }

  /**
   * Called from inside the sale's own transaction when a bill names the
   * quotation it came from. Refuses anything already settled, so one price
   * cannot be billed twice.
   */
  markConverted(quotationId: string, saleId: string, at: string): void {
    const row = this.repo.find(quotationId);
    if (!row) throw new QuotationError('NOT_FOUND', 'That quotation does not exist.');
    if (row.status === 'converted') {
      throw new QuotationError('ALREADY_BILLED', 'That quotation has already been billed.');
    }
    if (row.status === 'cancelled') {
      throw new QuotationError('CANCELLED', 'That quotation was cancelled.');
    }
    this.repo.markConverted(quotationId, saleId, at);
  }

  private toSummary(
    row: QuotationRow,
    items: number,
    invoiceNumber: string | null,
  ): QuotationSummary {
    return {
      id: row.id,
      quotationNumber: row.quotation_number,
      quotationDate: row.quotation_date,
      validUntil: row.valid_until,
      customerName: row.customer_name,
      priceLevel: row.price_level as PriceLevel,
      items,
      totalPaise: row.total_paise,
      status: statusOf(row.status, row.valid_until),
      convertedSaleId: row.converted_sale_id,
      convertedInvoiceNumber: invoiceNumber,
    };
  }

  private toQuotation(row: QuotationRow): Quotation {
    const items = this.repo.items(row.id);

    const lines = items.map((item) => ({
      productId: (item['product_id'] as string | null) ?? null,
      name: item['name'] as string,
      sku: (item['sku'] as string | null) ?? null,
      barcode: null,
      hsn: (item['hsn'] as string | null) ?? null,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitPricePaise: item['unit_price_paise'] as number,
      taxRateBp: item['tax_rate_bp'] as number,
      taxInclusive: row.tax_mode === 'inclusive',
      discountPaise: item['discount_paise'] as number,
      lineNo: item['line_no'] as number,
      grossPaise:
        (item['taxable_paise'] as number) +
        (item['tax_paise'] as number) +
        (item['discount_paise'] as number),
      totalDiscountPaise: item['discount_paise'] as number,
      taxablePaise: item['taxable_paise'] as number,
      cgstPaise: item['cgst_paise'] as number,
      sgstPaise: item['sgst_paise'] as number,
      igstPaise: item['igst_paise'] as number,
      taxPaise: item['tax_paise'] as number,
      totalPaise: item['total_paise'] as number,
    }));

    const buckets = new Map<number, Bill['taxBreakdown'][number]>();
    for (const line of lines) {
      const bucket = buckets.get(line.taxRateBp) ?? {
        rateBp: line.taxRateBp,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        taxPaise: 0,
      };
      bucket.taxablePaise += line.taxablePaise;
      bucket.cgstPaise += line.cgstPaise;
      bucket.sgstPaise += line.sgstPaise;
      bucket.igstPaise += line.igstPaise;
      bucket.taxPaise += line.taxPaise;
      buckets.set(line.taxRateBp, bucket);
    }

    const bill: Bill = {
      lines,
      grossPaise: row.gross_paise,
      itemDiscountPaise: row.item_discount_paise,
      cartDiscountPaise: row.cart_discount_paise,
      taxablePaise: row.taxable_paise,
      cgstPaise: row.cgst_paise,
      sgstPaise: row.sgst_paise,
      igstPaise: row.igst_paise,
      taxPaise: row.tax_paise,
      roundOffPaise: row.round_off_paise,
      totalPaise: row.total_paise,
      taxBreakdown: [...buckets.values()].sort((a, b) => a.rateBp - b.rateBp),
      isInterstate: row.is_interstate === 1,
    };

    return {
      ...this.toSummary(
        row,
        items.length,
        row.converted_sale_id ? this.repo.invoiceNumberFor(row.converted_sale_id) : null,
      ),
      customerId: row.customer_id,
      customerGstin: row.customer_gstin,
      notes: row.notes,
      terms: row.terms,
      cancelReason: row.cancel_reason,
      bill,
    };
  }
}
