import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService, SaleError } from '../sale-service';
import { AuditRepository } from '../../db/repositories/audit';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let customers: CustomerService;
let sales: SaleService;
let riceId: string;
let serviceId: string;

const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Moves a committed sale in time, so date filters can be tested on real rows. */
const backdate = (saleId: string, iso: string): void => {
  db.prepare('UPDATE sales SET invoice_date = ? WHERE id = ?').run(iso, saleId);
};

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 49900,
    costPaise: 38000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 10000,
  }).id;
  serviceId = catalogue.create({
    name: 'Home delivery',
    sku: 'DELIV',
    unitCode: 'pc',
    pricePaise: 5000,
    costPaise: 0,
    taxRateBp: 0,
    taxInclusive: true,
    trackInventory: false,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 0,
  }).id;

  customers = new CustomerService(db);
  sales = new SaleService(db);
});

afterEach(() => {
  db.close();
});

const saleInput = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 49900, discountPaise: 0 }],
  cartDiscountPaise: 0,
  payments: [{ method: 'cash' as const, amountPaise: 49900 }],
  ...overrides,
});

const stockOf = (productId: string): number => catalogue.get(productId)?.stockMilli ?? 0;

describe('sales history — listing', () => {
  it('lists sales newest first with the stored totals', () => {
    const first = sales.createSale(saleInput());
    const second = sales.createSale(
      saleInput({
        lines: [
          { productId: riceId, quantityMilli: 2000, unitPricePaise: 49900, discountPaise: 0 },
        ],
        payments: [{ method: 'cash', amountPaise: 99800 }],
      }),
    );
    backdate(first.id, '2026-10-01T06:00:00.000Z');
    backdate(second.id, '2026-10-05T06:00:00.000Z');

    const page = sales.listSales({});

    expect(page.total).toBe(2);
    expect(page.items.map((s) => s.invoiceNumber)).toEqual(['INV-0002', 'INV-0001']);
    expect(page.items[0]?.totalPaise).toBe(second.bill.totalPaise);
    expect(page.items[0]?.itemCount).toBe(1);
    expect(page.items[0]?.status).toBe('completed');
  });

  it('reports which methods paid for each sale', () => {
    sales.createSale(
      saleInput({
        payments: [
          { method: 'cash', amountPaise: 20000 },
          { method: 'upi', amountPaise: 29900, reference: 'UPI-77' },
        ],
      }),
    );

    expect(sales.listSales({}).items[0]?.paymentMethods).toEqual(['cash', 'upi']);
  });

  it('summarises the whole filtered set, not just the page', () => {
    sales.createSale(saleInput());
    sales.createSale(saleInput());
    sales.createSale(saleInput());

    const page = sales.listSales({ pageSize: 10, page: 1 });

    expect(page.completedCount).toBe(3);
    expect(page.completedTotalPaise).toBe(49900 * 3);
    expect(page.voidedCount).toBe(0);
  });

  it('paginates without repeating or dropping a sale', () => {
    // The service item is untracked, so 25 sales do not run the shelf empty.
    for (let i = 0; i < 25; i += 1) {
      sales.createSale(
        saleInput({
          lines: [
            { productId: serviceId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 },
          ],
          payments: [{ method: 'cash', amountPaise: 5000 }],
        }),
      );
    }

    const seen = [1, 2, 3].flatMap((page) =>
      sales.listSales({ pageSize: 10, page }).items.map((s) => s.invoiceNumber),
    );

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    // Totals describe the filtered set, so every page reports all 25.
    expect(sales.listSales({ pageSize: 10, page: 2 }).total).toBe(25);
  });
});

describe('sales history — search and filters', () => {
  beforeEach(() => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    const first = sales.createSale(saleInput({ customerId: ravi.id }));
    const second = sales.createSale(
      saleInput({
        payments: [{ method: 'upi', amountPaise: 49900, reference: 'UPI-9' }],
      }),
    );
    backdate(first.id, '2026-09-20T06:00:00.000Z');
    backdate(second.id, '2026-10-10T06:00:00.000Z');
  });

  it('finds a sale by invoice number', () => {
    const page = sales.listSales({ search: 'INV-0001' });
    expect(page.total).toBe(1);
    expect(page.items[0]?.invoiceNumber).toBe('INV-0001');
  });

  it('finds a sale by customer name and by phone', () => {
    expect(sales.listSales({ search: 'ravi' }).total).toBe(1);
    expect(sales.listSales({ search: '98765' }).total).toBe(1);
  });

  it('returns nothing for a term that matches no sale', () => {
    expect(sales.listSales({ search: 'nobody' }).total).toBe(0);
  });

  it('filters by date range, including both bounds', () => {
    const september = sales.listSales({
      fromIso: '2026-09-01T00:00:00.000Z',
      toIso: '2026-09-30T23:59:59.999Z',
    });
    expect(september.items.map((s) => s.invoiceNumber)).toEqual(['INV-0001']);

    const exact = sales.listSales({
      fromIso: '2026-09-20T06:00:00.000Z',
      toIso: '2026-09-20T06:00:00.000Z',
    });
    expect(exact.total).toBe(1);

    const both = sales.listSales({
      fromIso: '2026-09-01T00:00:00.000Z',
      toIso: '2026-10-31T23:59:59.999Z',
    });
    expect(both.total).toBe(2);
  });

  it('filters by payment method', () => {
    expect(sales.listSales({ paymentMethod: 'upi' }).items.map((s) => s.invoiceNumber)).toEqual([
      'INV-0002',
    ]);
    expect(sales.listSales({ paymentMethod: 'card' }).total).toBe(0);
  });

  it('sorts by invoice number and by total on demand', () => {
    const byInvoice = sales.listSales({ sort: 'invoice', direction: 'asc' });
    expect(byInvoice.items.map((s) => s.invoiceNumber)).toEqual(['INV-0001', 'INV-0002']);
  });
});

describe('invoice detail is a snapshot', () => {
  it('does not change when the product is later edited', () => {
    const receipt = sales.createSale(saleInput());

    const product = catalogue.get(riceId);
    catalogue.update({
      ...product!,
      name: 'Basmati Rice 5kg (new pack)',
      pricePaise: 59900,
      taxRateBp: 1200,
    });

    const reread = sales.getReceipt(receipt.id);
    expect(reread.bill.lines[0]?.name).toBe('Basmati Rice 5kg');
    expect(reread.bill.lines[0]?.unitPricePaise).toBe(49900);
    expect(reread.bill.lines[0]?.taxRateBp).toBe(500);
    expect(reread.bill.totalPaise).toBe(receipt.bill.totalPaise);
  });

  it('survives the product being deactivated', () => {
    const receipt = sales.createSale(saleInput());
    catalogue.setActive(riceId, false);

    const reread = sales.getReceipt(receipt.id);
    expect(reread.bill.lines[0]?.name).toBe('Basmati Rice 5kg');
    expect(sales.listSales({}).items[0]?.totalPaise).toBe(receipt.bill.totalPaise);
  });

  it('keeps the customer as billed when the customer record changes', () => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    const receipt = sales.createSale(saleInput({ customerId: ravi.id }));

    db.prepare('UPDATE customers SET name = ? WHERE id = ?').run('Ravi K. Traders', ravi.id);

    expect(sales.getReceipt(receipt.id).customerName).toBe('Ravi Kumar');
  });
});

describe('voiding a sale', () => {
  it('marks the sale voided with a reason and keeps the invoice number', () => {
    const receipt = sales.createSale(saleInput());

    const voided = sales.voidSale({ id: receipt.id, reason: 'Customer cancelled at the counter' });

    expect(voided.status).toBe('voided');
    expect(voided.voidReason).toBe('Customer cancelled at the counter');
    expect(voided.voidedAt).toBeTruthy();
    expect(voided.invoiceNumber).toBe(receipt.invoiceNumber);
    expect(count('sales')).toBe(1);
    expect(count('sale_items')).toBe(1);
    expect(count('payments')).toBe(1);
  });

  it('puts the stock back through the ledger', () => {
    expect(stockOf(riceId)).toBe(10000);
    const receipt = sales.createSale(saleInput());
    expect(stockOf(riceId)).toBe(9000);

    sales.voidSale({ id: receipt.id, reason: 'Wrong item billed' });

    expect(stockOf(riceId)).toBe(10000);

    // Reversal is a new movement, not an edit of the sale movement.
    const movements = db
      .prepare('SELECT movement_type, quantity_milli FROM inventory_movements ORDER BY created_at')
      .all() as { movement_type: string; quantity_milli: number }[];
    expect(movements).toHaveLength(3);
    expect(movements[2]).toMatchObject({ movement_type: 'adjustment', quantity_milli: 1000 });
  });

  it('reverses nothing for an item whose stock is not tracked', () => {
    const receipt = sales.createSale(
      saleInput({
        lines: [
          { productId: serviceId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 },
        ],
        payments: [{ method: 'cash', amountPaise: 5000 }],
      }),
    );

    sales.voidSale({ id: receipt.id, reason: 'Delivery not made' });

    const reversals = count("inventory_movements WHERE reference_type = 'sale_void'");
    expect(reversals).toBe(0);
  });

  it('writes an audit entry naming the invoice and the reason', () => {
    const receipt = sales.createSale(saleInput());
    sales.voidSale({ id: receipt.id, reason: 'Billed twice by mistake' });

    const entries = new AuditRepository(db).listFor('sale', receipt.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('void');
    expect(entries[0]?.details).toMatchObject({
      invoiceNumber: 'INV-0001',
      reason: 'Billed twice by mistake',
      totalPaise: 49900,
      stockLinesReversed: 1,
    });
  });

  it('refuses a second void, so stock cannot come back twice', () => {
    const receipt = sales.createSale(saleInput());
    sales.voidSale({ id: receipt.id, reason: 'Customer changed their mind' });

    expect(() => sales.voidSale({ id: receipt.id, reason: 'Again' })).toThrow(SaleError);
    expect(stockOf(riceId)).toBe(10000);
  });

  it('requires a reason', () => {
    const receipt = sales.createSale(saleInput());
    expect(() => sales.voidSale({ id: receipt.id, reason: '' })).toThrow();
    expect(sales.getReceipt(receipt.id).status).toBe('completed');
  });

  it('rejects an unknown sale', () => {
    expect(() => sales.voidSale({ id: randomUUID(), reason: 'Does not exist' })).toThrow(SaleError);
  });

  it("drops the voided sale out of the day's takings", () => {
    const kept = sales.createSale(saleInput());
    const cancelled = sales.createSale(saleInput());
    sales.voidSale({ id: cancelled.id, reason: 'Entered on the wrong bill' });

    const page = sales.listSales({});
    expect(page.total).toBe(2);
    expect(page.completedCount).toBe(1);
    expect(page.completedTotalPaise).toBe(kept.bill.totalPaise);
    expect(page.voidedCount).toBe(1);

    expect(sales.listSales({ status: 'voided' }).items.map((s) => s.invoiceNumber)).toEqual([
      cancelled.invoiceNumber,
    ]);
    expect(sales.listSales({ status: 'completed' }).items.map((s) => s.invoiceNumber)).toEqual([
      kept.invoiceNumber,
    ]);
  });
});

describe('completed sales cannot be deleted', () => {
  it('blocks a delete at the database, not just in the service', () => {
    const receipt = sales.createSale(saleInput());

    expect(() => db.prepare('DELETE FROM sales WHERE id = ?').run(receipt.id)).toThrow(
      /cannot be deleted/,
    );
    expect(() => db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(receipt.id)).toThrow(
      /cannot be deleted/,
    );
    expect(() => db.prepare('DELETE FROM payments WHERE sale_id = ?').run(receipt.id)).toThrow(
      /cannot be deleted/,
    );

    expect(count('sales')).toBe(1);
  });

  it('blocks a delete of a voided sale too — the record outlives the void', () => {
    const receipt = sales.createSale(saleInput());
    sales.voidSale({ id: receipt.id, reason: 'Cancelled' });

    expect(() => db.prepare('DELETE FROM sales WHERE id = ?').run(receipt.id)).toThrow();
    expect(count('sales')).toBe(1);
  });
});
