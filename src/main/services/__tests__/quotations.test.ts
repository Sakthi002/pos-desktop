import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { SettingsService } from '../settings-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService, SaleError } from '../sale-service';
import { LedgerService } from '../ledger-service';
import { QuotationService, QuotationError } from '../quotation-service';
import { defaultSettings } from '@shared/settings';
import { buildQuotationHtml } from '@shared/quotation-document';

let db: Database;
let catalogue: CatalogueService;
let quotations: QuotationService;
let sales: SaleService;
let riceId: string;
let customerId: string;

const EVERYTHING = { fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' };

const quote = (options: { quantityMilli?: number; validDays?: number | null } = {}) =>
  quotations.create({
    idempotencyKey: randomUUID(),
    customerId,
    lines: [
      {
        productId: riceId,
        quantityMilli: options.quantityMilli ?? 2000,
        unitPricePaise: 10000,
        discountPaise: 0,
      },
    ],
    cartDiscountPaise: 0,
    priceLevel: 'retail',
    validDays: options.validDays === undefined ? 7 : options.validDays,
    notes: 'Delivery in three days.',
  });

const stockOf = (productId: string): number => catalogue.get(productId)?.stockMilli ?? 0;

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 100000,
  }).id;

  customerId = new CustomerService(db).create({ name: 'Meena Traders' }).id;

  quotations = new QuotationService(db);
  sales = new SaleService(db);
});

afterEach(() => {
  db.close();
});

describe('quoting a price', () => {
  it('prices it exactly as the till would bill it', () => {
    const quotation = quote();
    const preview = sales.preview({
      customerId,
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      redeemPoints: 0,
      priceLevel: 'retail',
    });

    expect(quotation.bill.totalPaise).toBe(preview.totalPaise);
    expect(quotation.bill.taxPaise).toBe(preview.taxPaise);
  });

  it('numbers itself apart from the invoice series', () => {
    expect(quote().quotationNumber).toBe('INV-QTN-0001');
    expect(quote().quotationNumber).toBe('INV-QTN-0002');

    // And the invoice series has not moved.
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });
    expect(sale.invoiceNumber).toBe('INV-0001');
  });

  it('moves no stock, takes no money and posts nothing to the books', () => {
    const before = stockOf(riceId);
    quote();

    expect(stockOf(riceId)).toBe(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM vouchers').get()).toEqual({ n: 0 });
    expect(
      new LedgerService(db)
        .trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso)
        .every((r) => r.debitPaise === 0 && r.creditPaise === 0),
    ).toBe(true);
  });

  it('keeps the customer as they were on the day it was given', () => {
    const quotation = quote();
    new CustomerService(db).update({ id: customerId, name: 'Meena Stores & Co' });

    expect(quotations.get(quotation.id).customerName).toBe('Meena Traders');
  });

  it('holds its price for the days given, and expires after', () => {
    const quotation = quote({ validDays: 7 });
    expect(quotation.status).toBe('open');
    expect(quotation.validUntil).not.toBeNull();

    // A week passes. Nothing marks it stale; the date does the work, so the
    // status cannot be expired in one place and open in another.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    db.prepare('UPDATE quotations SET valid_until = ? WHERE id = ?').run(yesterday, quotation.id);

    expect(quotations.get(quotation.id).status).toBe('expired');
    expect(quotations.list({ status: 'expired' }).total).toBe(1);
    expect(quotations.list({ status: 'open' }).total).toBe(0);
    // And an expired price is not counted as money on the table.
    expect(quotations.list({}).openCount).toBe(0);
  });

  it('is one quotation however many times the same save arrives', () => {
    const key = randomUUID();
    const submit = () =>
      quotations.create({
        idempotencyKey: key,
        customerId,
        lines: [
          { productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 },
        ],
        cartDiscountPaise: 0,
        priceLevel: 'retail',
        validDays: 7,
        notes: null,
      });

    expect(submit().id).toBe(submit().id);
    expect(quotations.list({}).total).toBe(1);
  });

  it('can be given without an expiry at all', () => {
    expect(quote({ validDays: null }).validUntil).toBeNull();
  });
});

describe('what happens to a quotation', () => {
  it('is billed by a sale that names it, once', () => {
    const quotation = quote();

    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      customerId,
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: quotation.bill.totalPaise }],
      quotationId: quotation.id,
    });

    const after = quotations.get(quotation.id);
    expect(after.status).toBe('converted');
    expect(after.convertedSaleId).toBe(sale.id);
    expect(after.convertedInvoiceNumber).toBe(sale.invoiceNumber);

    // A second bill against the same price is refused.
    expect(() =>
      sales.createSale({
        idempotencyKey: randomUUID(),
        customerId,
        lines: [
          { productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 },
        ],
        cartDiscountPaise: 0,
        payments: [{ method: 'cash', amountPaise: quotation.bill.totalPaise }],
        quotationId: quotation.id,
      }),
    ).toThrow(SaleError);
  });

  it('is cancelled with a reason, and cannot then be billed', () => {
    const quotation = quote();
    const cancelled = quotations.cancel({ id: quotation.id, reason: 'Customer bought elsewhere' });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('Customer bought elsewhere');

    expect(() =>
      sales.createSale({
        idempotencyKey: randomUUID(),
        customerId,
        lines: [
          { productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 },
        ],
        cartDiscountPaise: 0,
        payments: [{ method: 'cash', amountPaise: quotation.bill.totalPaise }],
        quotationId: quotation.id,
      }),
    ).toThrow(SaleError);
  });

  it('cannot be cancelled once it has been billed', () => {
    const quotation = quote();
    sales.createSale({
      idempotencyKey: randomUUID(),
      customerId,
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: quotation.bill.totalPaise }],
      quotationId: quotation.id,
    });

    expect(() => quotations.cancel({ id: quotation.id, reason: 'Changed my mind' })).toThrow(
      QuotationError,
    );
  });

  it('cannot be deleted', () => {
    const quotation = quote();
    expect(() => db.prepare('DELETE FROM quotations WHERE id = ?').run(quotation.id)).toThrow();
  });
});

describe('the list', () => {
  it('counts what is still open and what it is worth', () => {
    quote();
    const second = quote();
    quotations.cancel({ id: second.id, reason: 'Duplicate' });

    const page = quotations.list({});
    expect(page.total).toBe(2);
    expect(page.openCount).toBe(1);
    expect(page.openValuePaise).toBe(20000);
    expect(page.items.map((q) => q.status)).toContain('cancelled');
  });

  it('finds one by its number or the customer', () => {
    const quotation = quote();
    expect(quotations.list({ search: quotation.quotationNumber }).total).toBe(1);
    expect(quotations.list({ search: 'Meena' }).total).toBe(1);
    expect(quotations.list({ search: 'nobody' }).total).toBe(0);
  });
});

describe('the printed sheet', () => {
  it('says what it is, and what it is not', () => {
    const quotation = quote();
    const html = buildQuotationHtml({
      quotation,
      settings: new SettingsService(db).require(),
      logoDataUrl: null,
    });

    expect(html).toMatch(/Quotation/);
    expect(html).toContain('This is a quotation, not an invoice');
    expect(html).toContain('This price holds until');
    expect(html).not.toMatch(/TAX INVOICE/i);
  });

  it('stamps one that has been billed with the invoice it became', () => {
    const quotation = quote();
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      customerId,
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: quotation.bill.totalPaise }],
      quotationId: quotation.id,
    });

    const html = buildQuotationHtml({
      quotation: quotations.get(quotation.id),
      settings: new SettingsService(db).require(),
      logoDataUrl: null,
    });

    expect(html).toContain(sale.invoiceNumber);
    expect(html).toMatch(/Billed/);
  });
});
