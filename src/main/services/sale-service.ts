/**
 * Checkout.
 *
 * A sale is one transaction: header, lines, payments and stock movements all
 * commit together or not at all. The invoice number is allocated inside that
 * transaction, so a rolled-back sale never burns a number and the series has
 * no gaps — which matters, because GST requires a consecutive series.
 *
 * Nothing here trusts the renderer for tax. Line tax rate, HSN, unit and name
 * are read from the product at checkout time; only quantity, price and
 * discount come from the till, because a price override is a legitimate thing
 * for a shopkeeper to do.
 */
import type { Database } from 'better-sqlite3';
import {
  saleInputSchema,
  billPreviewSchema,
  saleQuerySchema,
  voidSaleSchema,
  type BillPreviewInput,
  type SaleInput,
  type SaleReceipt,
  type SalePayment,
  type PaymentMethod,
  type SalePage,
  type SaleQuery,
  type SaleStatus,
} from '@shared/sale';
import { calculateBill, type Bill, type BillLineInput } from '@shared/billing';
import { financialYearOf, type AppSettings } from '@shared/settings';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { newId, now, inTransaction } from '../db/repositories/base';
import { SalesRepository } from '../db/repositories/sales';
import { AuditRepository } from '../db/repositories/audit';
import { SettingsService } from './settings-service';
import { LedgerService } from './ledger-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class SaleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SaleError';
  }
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit_code: string;
  tax_rate_bp: number;
  tax_inclusive: number;
  track_inventory: number;
  is_active: number;
}

export class SaleService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly history: SalesRepository;
  private readonly audit: AuditRepository;
  private readonly ledger: LedgerService;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new SaleError('SETUP_INCOMPLETE', 'Complete setup before billing.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) throw new SaleError('SETUP_INCOMPLETE', 'Complete setup before billing.');
    this.settings = settings;

    this.history = new SalesRepository(db, this.ctx.companyId);
    this.audit = new AuditRepository(db);
    this.ledger = new LedgerService(db);
  }

  /** Customer's state decides CGST+SGST versus IGST; unknown means local. */
  private isInterstate(customerId: string | null | undefined): boolean {
    if (!customerId) return false;
    const row = this.db.prepare('SELECT state_code FROM customers WHERE id = ?').get(customerId) as
      { state_code: string | null } | undefined;
    const customerState = row?.state_code;
    if (!customerState || !this.ctx.branchStateCode) return false;
    return customerState !== this.ctx.branchStateCode;
  }

  private loadProducts(ids: string[]): Map<string, ProductRow> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, sku, barcode, hsn, unit_code, tax_rate_bp, tax_inclusive,
                track_inventory, is_active
           FROM products WHERE company_id = ? AND id IN (${placeholders})`,
      )
      .all(this.ctx.companyId, ...ids) as ProductRow[];
    return new Map(rows.map((r) => [r.id, r]));
  }

  private buildLines(input: BillPreviewInput | SaleInput): BillLineInput[] {
    const products = this.loadProducts(input.lines.map((l) => l.productId));

    return input.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product)
        throw new SaleError('PRODUCT_NOT_FOUND', 'A product in the cart no longer exists.');
      if (product.is_active === 0) {
        throw new SaleError('PRODUCT_INACTIVE', `${product.name} is no longer available for sale.`);
      }

      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        hsn: product.hsn,
        unitCode: product.unit_code,
        quantityMilli: line.quantityMilli,
        unitPricePaise: line.unitPricePaise,
        taxRateBp: product.tax_rate_bp,
        taxInclusive: product.tax_inclusive === 1,
        discountPaise: line.discountPaise,
      };
    });
  }

  /** Totals for the screen. Reads nothing it does not need and writes nothing. */
  preview(input: unknown): Bill {
    const parsed = billPreviewSchema.parse(input);
    return calculateBill({
      lines: this.buildLines(parsed),
      cartDiscountPaise: parsed.cartDiscountPaise,
      isInterstate: this.isInterstate(parsed.customerId),
      roundTotal: this.settings.tax.roundTotalToRupee,
    });
  }

  /** Current stock for each tracked product in the cart. */
  private stockFor(productIds: string[]): Map<string, number> {
    if (productIds.length === 0) return new Map();
    const placeholders = productIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT product_id, COALESCE(SUM(quantity_milli), 0) AS qty
           FROM inventory_movements
          WHERE product_id IN (${placeholders})
          GROUP BY product_id`,
      )
      .all(...productIds) as { product_id: string; qty: number }[];
    return new Map(rows.map((r) => [r.product_id, r.qty]));
  }

  private findByIdempotencyKey(key: string): string | null {
    const row = this.db.prepare('SELECT id FROM sales WHERE idempotency_key = ?').get(key) as
      { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * Allocates the next invoice number for this branch and financial year.
   * Called inside the sale transaction, so the number and the sale commit
   * together.
   */
  private allocateInvoiceNumber(financialYear: string): string {
    const existing = this.db
      .prepare(
        `SELECT prefix, next_number FROM invoice_sequences
          WHERE branch_id = ? AND kind = 'sale' AND financial_year = ?`,
      )
      .get(this.ctx.branchId, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      // A new financial year: start a fresh series at the configured number.
      const prefix = this.settings.invoice.prefix;
      const start = this.settings.invoice.startNumber;
      this.db
        .prepare(
          `INSERT INTO invoice_sequences (branch_id, kind, financial_year, prefix, next_number)
           VALUES (?, 'sale', ?, ?, ?)`,
        )
        .run(this.ctx.branchId, financialYear, prefix, start + 1);
      return `${prefix}-${String(start).padStart(4, '0')}`;
    }

    this.db
      .prepare(
        `UPDATE invoice_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND kind = 'sale' AND financial_year = ?`,
      )
      .run(this.ctx.branchId, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  createSale(input: unknown): SaleReceipt {
    const parsed: SaleInput = saleInputSchema.parse(input);

    // A repeat submission resolves to the sale already committed.
    const alreadyCommitted = this.findByIdempotencyKey(parsed.idempotencyKey);
    if (alreadyCommitted) return { ...this.getReceipt(alreadyCommitted), duplicate: true };

    const lines = this.buildLines(parsed);
    const bill = calculateBill({
      lines,
      cartDiscountPaise: parsed.cartDiscountPaise,
      isInterstate: this.isInterstate(parsed.customerId),
      roundTotal: this.settings.tax.roundTotalToRupee,
    });

    // Payments must cover the bill. Cash may exceed it, and the surplus is change.
    const paid = parsed.payments.reduce((a, p) => a + p.amountPaise, 0);
    if (paid < bill.totalPaise) {
      throw new SaleError('UNDERPAID', 'The payments do not cover the bill total.');
    }
    const overpaid = paid - bill.totalPaise;
    if (overpaid > 0 && !parsed.payments.some((p) => p.method === 'cash')) {
      throw new SaleError(
        'OVERPAID',
        'Payments exceed the total. Change can only be given against cash.',
      );
    }

    // Stock check before anything is written.
    const tracked = lines.filter((l) => {
      const product = this.loadProducts([l.productId as string]).get(l.productId as string);
      return product?.track_inventory === 1;
    });
    if (!this.settings.inventory.allowNegativeStock && tracked.length > 0) {
      const stock = this.stockFor(tracked.map((l) => l.productId as string));
      const wanted = new Map<string, number>();
      for (const line of tracked) {
        const id = line.productId as string;
        wanted.set(id, (wanted.get(id) ?? 0) + line.quantityMilli);
      }
      for (const [productId, qty] of wanted) {
        const available = stock.get(productId) ?? 0;
        if (qty > available) {
          const line = tracked.find((l) => l.productId === productId);
          const precision = precisionFor(line?.unitCode ?? 'pc');
          throw new SaleError(
            'INSUFFICIENT_STOCK',
            `${line?.name ?? 'An item'} has only ${formatQuantity(available, precision)} ` +
              `${line?.unitCode ?? ''} in stock.`,
          );
        }
      }
    }

    const saleId = newId();
    const timestamp = now();
    const financialYear = financialYearOf(
      new Date(),
      this.settings.invoice.financialYearStartMonth,
    );

    const customer = parsed.customerId
      ? (this.db
          .prepare('SELECT name, phone, gstin, state_code FROM customers WHERE id = ?')
          .get(parsed.customerId) as
          | { name: string; phone: string | null; gstin: string | null; state_code: string | null }
          | undefined)
      : undefined;

    inTransaction(this.db, () => {
      const invoiceNumber = this.allocateInvoiceNumber(financialYear);

      this.db
        .prepare(
          `INSERT INTO sales (id, company_id, branch_id, operator_id, invoice_number, financial_year,
             invoice_date, customer_id, customer_name, customer_phone, customer_gstin, customer_state_code,
             tax_mode, is_interstate, gross_paise, item_discount_paise, cart_discount_paise,
             taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, round_off_paise,
             total_paise, status, notes, idempotency_key, created_at, updated_at)
           VALUES (@id, @company_id, @branch_id, @operator_id, @invoice_number, @financial_year,
             @invoice_date, @customer_id, @customer_name, @customer_phone, @customer_gstin, @customer_state_code,
             @tax_mode, @is_interstate, @gross_paise, @item_discount_paise, @cart_discount_paise,
             @taxable_paise, @cgst_paise, @sgst_paise, @igst_paise, @tax_paise, @round_off_paise,
             @total_paise, 'completed', @notes, @idempotency_key, @t, @t)`,
        )
        .run({
          id: saleId,
          company_id: this.ctx.companyId,
          branch_id: this.ctx.branchId,
          operator_id: this.ctx.operatorId,
          invoice_number: invoiceNumber,
          financial_year: financialYear,
          invoice_date: timestamp,
          customer_id: parsed.customerId ?? null,
          customer_name: customer?.name ?? null,
          customer_phone: customer?.phone ?? null,
          customer_gstin: customer?.gstin ?? null,
          customer_state_code: customer?.state_code ?? null,
          tax_mode: this.settings.tax.mode,
          is_interstate: bill.isInterstate ? 1 : 0,
          gross_paise: bill.grossPaise,
          item_discount_paise: bill.itemDiscountPaise,
          cart_discount_paise: bill.cartDiscountPaise,
          taxable_paise: bill.taxablePaise,
          cgst_paise: bill.cgstPaise,
          sgst_paise: bill.sgstPaise,
          igst_paise: bill.igstPaise,
          tax_paise: bill.taxPaise,
          round_off_paise: bill.roundOffPaise,
          total_paise: bill.totalPaise,
          notes: parsed.notes ?? null,
          idempotency_key: parsed.idempotencyKey,
          t: timestamp,
        });

      const insertItem = this.db.prepare(
        `INSERT INTO sale_items (id, sale_id, line_no, product_id, name, sku, barcode, hsn, unit_code,
           quantity_milli, unit_price_paise, discount_paise, taxable_paise, tax_rate_bp,
           cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise, created_at)
         VALUES (@id, @sale_id, @line_no, @product_id, @name, @sku, @barcode, @hsn, @unit_code,
           @quantity_milli, @unit_price_paise, @discount_paise, @taxable_paise, @tax_rate_bp,
           @cgst_paise, @sgst_paise, @igst_paise, @tax_paise, @total_paise, @t)`,
      );

      const insertMovement = this.db.prepare(
        `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
           quantity_milli, reference_type, reference_id, operator_id, created_at)
         VALUES (?, ?, ?, ?, 'sale', ?, 'sale', ?, ?, ?)`,
      );

      const products = this.loadProducts(lines.map((l) => l.productId as string));

      for (const line of bill.lines) {
        insertItem.run({
          id: newId(),
          sale_id: saleId,
          line_no: line.lineNo,
          product_id: line.productId,
          name: line.name,
          sku: line.sku,
          barcode: line.barcode,
          hsn: line.hsn,
          unit_code: line.unitCode,
          quantity_milli: line.quantityMilli,
          unit_price_paise: line.unitPricePaise,
          discount_paise: line.totalDiscountPaise,
          taxable_paise: line.taxablePaise,
          tax_rate_bp: line.taxRateBp,
          cgst_paise: line.cgstPaise,
          sgst_paise: line.sgstPaise,
          igst_paise: line.igstPaise,
          tax_paise: line.taxPaise,
          total_paise: line.totalPaise,
          t: timestamp,
        });

        // Only tracked products move stock; a service item sells without it.
        if (line.productId && products.get(line.productId)?.track_inventory === 1) {
          insertMovement.run(
            newId(),
            this.ctx.companyId,
            this.ctx.branchId,
            line.productId,
            -line.quantityMilli,
            saleId,
            this.ctx.operatorId,
            timestamp,
          );
        }
      }

      const insertPayment = this.db.prepare(
        `INSERT INTO payments (id, sale_id, method, amount_paise, tendered_paise, change_paise,
           reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // Still inside the sale's transaction: the books move with the sale or
      // not at all.
      let changeRemaining = overpaid;
      for (const payment of parsed.payments) {
        // Change is attributed to the cash payment it came from.
        const change = payment.method === 'cash' && changeRemaining > 0 ? changeRemaining : 0;
        changeRemaining -= change;

        insertPayment.run(
          newId(),
          saleId,
          payment.method,
          payment.amountPaise,
          payment.tenderedPaise ?? null,
          change > 0 ? change : null,
          payment.reference ?? null,
          timestamp,
        );
      }

      this.ledger.postSale(saleId);
    });

    return { ...this.getReceipt(saleId), duplicate: false };
  }

  /** Invoice list for the history screen: search, filters and pagination. */
  listSales(input: unknown): SalePage {
    const query: SaleQuery = saleQuerySchema.parse(input ?? {});
    const { items, totals } = this.history.search(query);
    return {
      items,
      total: totals.total,
      page: query.page,
      pageSize: query.pageSize,
      completedCount: totals.completedCount,
      completedTotalPaise: totals.completedTotalPaise,
      voidedCount: totals.voidedCount,
      returnedTotalPaise: totals.returnedTotalPaise,
    };
  }

  /**
   * Voids a sale: the row stays, the invoice number stays, the snapshot stays.
   * Status, reversal movements and the audit entry commit together, so stock
   * can never come back without a record of who sent it back and why.
   */
  voidSale(input: unknown): SaleReceipt {
    const parsed = voidSaleSchema.parse(input);

    const sale = this.history.findForVoid(parsed.id);
    if (!sale) throw new SaleError('NOT_FOUND', 'Sale not found.');
    if (sale.status === 'voided') {
      throw new SaleError('ALREADY_VOIDED', `Invoice ${sale.invoiceNumber} is already voided.`);
    }
    // Part of this invoice has already been credited back. Voiding it now would
    // return the returned stock a second time, so the credit note has to be the
    // only reversal.
    if (this.history.hasReturns(sale.id)) {
      throw new SaleError(
        'HAS_RETURNS',
        `Invoice ${sale.invoiceNumber} has a return against it, so it cannot be voided.`,
      );
    }

    const at = now();

    inTransaction(this.db, () => {
      this.history.markVoided(sale.id, parsed.reason, this.ctx.operatorId, at);

      // Reverse exactly what the sale took out: an untracked service item took
      // nothing, so it gets nothing back.
      const movements = this.history.saleMovements(sale.id);
      for (const movement of movements) {
        this.history.insertVoidReversal({
          branchId: sale.branchId,
          productId: movement.productId,
          quantityMilli: -movement.quantityMilli,
          saleId: sale.id,
          reason: `Void of invoice ${sale.invoiceNumber}: ${parsed.reason}`,
          operatorId: this.ctx.operatorId,
          at,
        });
      }

      this.ledger.postSaleVoid(sale.id);

      this.audit.record(
        {
          entityType: 'sale',
          entityId: sale.id,
          action: 'void',
          operatorId: this.ctx.operatorId,
          details: {
            invoiceNumber: sale.invoiceNumber,
            totalPaise: sale.totalPaise,
            reason: parsed.reason,
            stockLinesReversed: movements.length,
          },
        },
        at,
      );
    });

    return this.getReceipt(sale.id);
  }

  getReceipt(saleId: string): SaleReceipt {
    const sale = this.db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as
      Record<string, unknown> | undefined;
    if (!sale) throw new SaleError('NOT_FOUND', 'Sale not found.');

    const items = this.db
      .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY line_no')
      .all(saleId) as Record<string, unknown>[];

    const payments = this.db
      .prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY created_at')
      .all(saleId) as Record<string, unknown>[];

    const lines = items.map((item) => ({
      productId: item['product_id'] as string | null,
      name: item['name'] as string,
      sku: item['sku'] as string | null,
      barcode: item['barcode'] as string | null,
      hsn: item['hsn'] as string | null,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitPricePaise: item['unit_price_paise'] as number,
      taxRateBp: item['tax_rate_bp'] as number,
      taxInclusive: sale['tax_mode'] === 'inclusive',
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
      grossPaise: sale['gross_paise'] as number,
      itemDiscountPaise: sale['item_discount_paise'] as number,
      cartDiscountPaise: sale['cart_discount_paise'] as number,
      taxablePaise: sale['taxable_paise'] as number,
      cgstPaise: sale['cgst_paise'] as number,
      sgstPaise: sale['sgst_paise'] as number,
      igstPaise: sale['igst_paise'] as number,
      taxPaise: sale['tax_paise'] as number,
      roundOffPaise: sale['round_off_paise'] as number,
      totalPaise: sale['total_paise'] as number,
      taxBreakdown: [...buckets.values()].sort((a, b) => a.rateBp - b.rateBp),
      isInterstate: sale['is_interstate'] === 1,
    };

    const mappedPayments: SalePayment[] = payments.map((p) => ({
      id: p['id'] as string,
      method: p['method'] as PaymentMethod,
      amountPaise: p['amount_paise'] as number,
      tenderedPaise: (p['tendered_paise'] as number | null) ?? null,
      changePaise: (p['change_paise'] as number | null) ?? null,
      reference: (p['reference'] as string | null) ?? null,
    }));

    return {
      id: saleId,
      invoiceNumber: sale['invoice_number'] as string,
      invoiceDate: sale['invoice_date'] as string,
      financialYear: sale['financial_year'] as string,
      customerId: (sale['customer_id'] as string | null) ?? null,
      customerName: (sale['customer_name'] as string | null) ?? null,
      customerGstin: (sale['customer_gstin'] as string | null) ?? null,
      bill,
      payments: mappedPayments,
      changePaise: mappedPayments.reduce((a, p) => a + (p.changePaise ?? 0), 0),
      notes: (sale['notes'] as string | null) ?? null,
      status: sale['status'] as SaleStatus,
      voidedAt: (sale['voided_at'] as string | null) ?? null,
      voidReason: (sale['void_reason'] as string | null) ?? null,
      duplicate: false,
    };
  }
}
