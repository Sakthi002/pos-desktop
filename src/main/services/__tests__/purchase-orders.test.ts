import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SupplierService } from '../supplier-service';
import { PurchaseService, PurchaseError } from '../purchase-service';
import { PurchaseOrderService, PurchaseOrderError } from '../purchase-order-service';
import { defaultSettings } from '@shared/settings';
import { buildPurchaseOrderHtml } from '@shared/purchase-order-document';

let db: Database;
let catalogue: CatalogueService;
let orders: PurchaseOrderService;
let purchases: PurchaseService;
let riceId: string;
let supplierId: string;

const order = (options: { quantityMilli?: number; expectedDays?: number | null } = {}) =>
  orders.create({
    idempotencyKey: randomUUID(),
    supplierId,
    lines: [
      {
        productId: riceId,
        quantityMilli: options.quantityMilli ?? 10000,
        unitCostPaise: 40000,
      },
    ],
    expectedDays: options.expectedDays === undefined ? 7 : options.expectedDays,
    notes: 'Send with the Friday lorry.',
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
    pricePaise: 50000,
    costPaise: 40000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 10000,
  }).id;

  supplierId = new SupplierService(db).create({
    name: 'Chennai Wholesale Traders',
    phone: '9840012345',
    gstin: '33CCCCC2222C1Z5',
    stateCode: '33',
    creditLimitPaise: 5000000,
  }).id;

  orders = new PurchaseOrderService(db);
  purchases = new PurchaseService(db);
});

afterEach(() => {
  db.close();
});

describe('ordering goods', () => {
  it('adds up what it asks for', () => {
    const po = order({ quantityMilli: 10000 });
    // Ten units at 400.00 each.
    expect(po.lines[0]?.totalPaise).toBe(400000);
    expect(po.totalPaise).toBe(400000);
    expect(po.status).toBe('open');
  });

  it('numbers itself apart from every other series', () => {
    expect(order().orderNumber).toBe('INV-PO-0001');
    expect(order().orderNumber).toBe('INV-PO-0002');
  });

  it('moves no stock and owes nothing: it has not happened yet', () => {
    const before = stockOf(riceId);
    order();
    expect(stockOf(riceId)).toBe(before);
    // And nothing has been bought: an order writes no purchase at all.
    const bought = db.prepare('SELECT COUNT(*) AS n FROM purchases').get() as { n: number };
    expect(bought.n).toBe(0);
  });

  it('takes the same submission twice as one order', () => {
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      supplierId,
      lines: [{ productId: riceId, quantityMilli: 1000, unitCostPaise: 40000 }],
    };
    expect(orders.create(input).id).toBe(orders.create(input).id);
  });

  it('refuses a supplier the shop no longer uses', () => {
    new SupplierService(db).setActive(supplierId, false);
    expect(() => order()).toThrow(PurchaseOrderError);
  });

  it('reads lateness from the date rather than storing it', () => {
    const late = orders.create({
      idempotencyKey: randomUUID(),
      supplierId,
      lines: [{ productId: riceId, quantityMilli: 1000, unitCostPaise: 40000 }],
      expectedDays: 1,
    });
    expect(late.status).toBe('open');

    // Pull the date back a week: the same row now reads as overdue.
    db.prepare("UPDATE purchase_orders SET expected_on = datetime('now', '-7 days') WHERE id = ?").run(
      late.id,
    );
    expect(orders.get(late.id).status).toBe('overdue');
  });
});

describe('receiving an order', () => {
  const receive = (orderId: string) =>
    purchases.createPurchase({
      idempotencyKey: randomUUID(),
      supplierId,
      purchaseOrderId: orderId,
      supplierBillNo: 'CWT/2026/889',
      taxMode: 'exclusive',
      lines: [{ productId: riceId, quantityMilli: 10000, unitCostPaise: 40000, discountPaise: 0 }],
      billDiscountPaise: 0,
    });

  it('marks the order received and points each document at the other', () => {
    const po = order();
    const purchase = receive(po.id);

    const after = orders.get(po.id);
    expect(after.status).toBe('received');
    expect(after.receivedPurchaseId).toBe(purchase.id);
    expect(after.receivedPurchaseNumber).toBe(purchase.purchaseNumber);

    const row = db
      .prepare('SELECT purchase_order_id FROM purchases WHERE id = ?')
      .get(purchase.id) as { purchase_order_id: string | null };
    expect(row.purchase_order_id).toBe(po.id);
  });

  it('brings the stock in, which the order itself never did', () => {
    const po = order();
    const before = stockOf(riceId);
    receive(po.id);
    expect(stockOf(riceId)).toBe(before + 10000);
  });

  it('refuses a second bill against the same order', () => {
    const po = order();
    receive(po.id);
    expect(() => receive(po.id)).toThrow(PurchaseError);
  });

  it('refuses goods against an order that was called off', () => {
    const po = order();
    orders.cancel({ id: po.id, reason: 'Found it cheaper elsewhere' });
    expect(() => receive(po.id)).toThrow(PurchaseError);
  });
});

describe('cancelling an order', () => {
  it('keeps it, with the reason beside it', () => {
    const po = order();
    const cancelled = orders.cancel({ id: po.id, reason: 'Supplier out of stock' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('Supplier out of stock');
  });

  it('refuses to cancel goods that have already arrived', () => {
    const po = order();
    purchases.createPurchase({
      idempotencyKey: randomUUID(),
      supplierId,
      purchaseOrderId: po.id,
      taxMode: 'exclusive',
      lines: [{ productId: riceId, quantityMilli: 10000, unitCostPaise: 40000, discountPaise: 0 }],
      billDiscountPaise: 0,
    });
    expect(() => orders.cancel({ id: po.id, reason: 'Changed my mind' })).toThrow(
      PurchaseOrderError,
    );
  });

  it('cannot be deleted, only cancelled', () => {
    const po = order();
    expect(() => db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id)).toThrow(
      /cannot be deleted/,
    );
  });
});

describe('the printed order', () => {
  it('says what it is, and that it is not a bill', () => {
    const po = order();
    const settings = defaultSettings('Test Shop');
    const html = buildPurchaseOrderHtml({ order: po, settings });

    expect(html).toContain('Purchase Order');
    expect(html).toContain('Chennai Wholesale Traders');
    expect(html).toContain('Basmati Rice 5kg');
    expect(html).toContain('4,000.00');
    expect(html).toMatch(/order, not a bill/i);
    // No tax columns: what is charged is the supplier's bill to say. (The
    // shop's own GSTIN still appears in its letterhead, as it should.)
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('<th class="num">Tax</th>');
    expect(html).toMatch(/tax is as your bill states/i);
  });

  it('stamps one that was called off', () => {
    const po = order();
    orders.cancel({ id: po.id, reason: 'Supplier out of stock' });
    const html = buildPurchaseOrderHtml({
      order: orders.get(po.id),
      settings: defaultSettings('Test Shop'),
    });
    expect(html).toContain('Cancelled');
  });
});
