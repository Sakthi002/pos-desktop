import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SupplierService } from '../supplier-service';
import { PurchaseService, PurchaseError } from '../purchase-service';
import { AuditRepository } from '../../db/repositories/audit';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let suppliers: SupplierService;
let purchases: PurchaseService;
let riceId: string;
let supplierId: string;

const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

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
    pricePaise: 49900,
    costPaise: 38000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 10000,
  }).id;

  suppliers = new SupplierService(db);
  supplierId = suppliers.create({
    name: 'Chennai Wholesale Traders',
    phone: '9840012345',
    gstin: '33CCCCC2222C1Z5',
    stateCode: '33',
    creditLimitPaise: 5000000,
  }).id;

  purchases = new PurchaseService(db);
});

afterEach(() => {
  db.close();
});

const buy = (overrides: Record<string, unknown> = {}) =>
  purchases.createPurchase({
    idempotencyKey: randomUUID(),
    supplierId,
    supplierBillNo: 'CWT/2026/889',
    taxMode: 'exclusive',
    lines: [{ productId: riceId, quantityMilli: 10000, unitCostPaise: 40000, discountPaise: 0 }],
    billDiscountPaise: 0,
    ...overrides,
  });

describe('recording a purchase', () => {
  it('brings stock in and numbers the bill', () => {
    expect(stockOf(riceId)).toBe(10000);

    const purchase = buy();

    expect(purchase.purchaseNumber).toBe('PUR-0001');
    expect(purchase.supplierBillNo).toBe('CWT/2026/889');
    expect(purchase.lines).toHaveLength(1);
    expect(stockOf(riceId)).toBe(20000);
    expect(count("inventory_movements WHERE movement_type = 'purchase'")).toBe(1);
  });

  it('adds GST on top when the supplier bills exclusive of tax', () => {
    const purchase = buy();

    // 10 × ₹400 = ₹4,000 taxable, 5% GST on top.
    expect(purchase.taxablePaise).toBe(400000);
    expect(purchase.taxPaise).toBe(20000);
    expect(purchase.cgstPaise + purchase.sgstPaise).toBe(20000);
    expect(purchase.igstPaise).toBe(0);
    expect(purchase.totalPaise).toBe(420000);
  });

  it('splits out the tax already inside the cost when the bill is inclusive', () => {
    const purchase = buy({ taxMode: 'inclusive' });

    expect(purchase.taxablePaise + purchase.taxPaise).toBe(400000);
    expect(purchase.totalPaise).toBe(400000);
  });

  it('charges IGST when the supplier is in another state', () => {
    const outsider = suppliers.create({
      name: 'Mumbai Supplies',
      stateCode: '27',
      creditLimitPaise: 0,
    });

    const purchase = buy({ supplierId: outsider.id });

    expect(purchase.isInterstate).toBe(true);
    expect(purchase.igstPaise).toBe(20000);
    expect(purchase.cgstPaise).toBe(0);
  });

  it('moves the product cost to what was just paid, excluding reclaimable tax', () => {
    buy({
      lines: [{ productId: riceId, quantityMilli: 10000, unitCostPaise: 41000, discountPaise: 0 }],
    });

    // ₹410 a unit ex-tax, not ₹430.50 including it.
    expect(catalogue.get(riceId)?.costPaise).toBe(41000);
  });

  it('leaves the selling price alone unless asked, then follows the MRP', () => {
    buy({
      lines: [
        {
          productId: riceId,
          quantityMilli: 1000,
          unitCostPaise: 40000,
          mrpPaise: 52900,
          discountPaise: 0,
        },
      ],
    });
    expect(catalogue.get(riceId)?.pricePaise).toBe(49900);
    expect(catalogue.get(riceId)?.mrpPaise).toBe(52900);

    buy({
      lines: [
        {
          productId: riceId,
          quantityMilli: 1000,
          unitCostPaise: 40000,
          mrpPaise: 52900,
          discountPaise: 0,
          updateSellingPrice: true,
        },
      ],
    });
    expect(catalogue.get(riceId)?.pricePaise).toBe(52900);
  });

  it('numbers purchases consecutively', () => {
    expect(buy().purchaseNumber).toBe('PUR-0001');
    expect(buy().purchaseNumber).toBe('PUR-0002');
    expect(buy().purchaseNumber).toBe('PUR-0003');
  });

  it('resolves a repeat submission to the bill already recorded', () => {
    const key = randomUUID();
    const first = buy({ idempotencyKey: key });
    const second = buy({ idempotencyKey: key });

    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    expect(count('purchases')).toBe(1);
    expect(stockOf(riceId)).toBe(20000);
  });

  it('refuses an unknown or inactive supplier', () => {
    expect(() => buy({ supplierId: randomUUID() })).toThrow(PurchaseError);

    suppliers.setActive(supplierId, false);
    expect(() => buy()).toThrow(/no longer active/);
  });

  it('records what was bought in the audit trail', () => {
    const purchase = buy();
    const entry = new AuditRepository(db).listFor('purchase', purchase.id)[0];

    expect(entry?.action).toBe('create');
    expect(entry?.details).toMatchObject({
      purchaseNumber: 'PUR-0001',
      supplier: 'Chennai Wholesale Traders',
      totalPaise: 420000,
    });
  });
});

describe('paying the supplier', () => {
  it('leaves the bill outstanding when nothing is paid', () => {
    const purchase = buy();

    expect(purchase.paidPaise).toBe(0);
    expect(purchase.outstandingPaise).toBe(420000);
    expect(suppliers.outstanding(supplierId)).toBe(420000);
  });

  it('settles at the counter when payment is handed over with the bill', () => {
    const purchase = buy({ payment: { method: 'cash', amountPaise: 420000 } });

    expect(purchase.paidPaise).toBe(420000);
    expect(purchase.outstandingPaise).toBe(0);
    expect(suppliers.outstanding(supplierId)).toBe(0);
  });

  it('takes a payment later, against the bill', () => {
    const purchase = buy();
    purchases.recordPayment({
      supplierId,
      purchaseId: purchase.id,
      method: 'bank',
      amountPaise: 200000,
      reference: 'NEFT-8891',
    });

    expect(purchases.getPurchase(purchase.id).outstandingPaise).toBe(220000);
    expect(suppliers.outstanding(supplierId)).toBe(220000);
    expect(suppliers.payments(supplierId)).toHaveLength(1);
  });

  it('refuses to pay more than a bill still owes', () => {
    const purchase = buy();
    expect(() =>
      purchases.recordPayment({
        supplierId,
        purchaseId: purchase.id,
        method: 'cash',
        amountPaise: 500000,
      }),
    ).toThrow(/outstanding/);
  });

  it('allows a payment on account, with no bill named', () => {
    buy();
    purchases.recordPayment({ supplierId, method: 'cash', amountPaise: 100000 });

    expect(suppliers.outstanding(supplierId)).toBe(320000);
  });

  it('refuses a payment against another supplier’s bill', () => {
    const purchase = buy();
    const other = suppliers.create({ name: 'Someone Else', creditLimitPaise: 0 });

    expect(() =>
      purchases.recordPayment({
        supplierId: other.id,
        purchaseId: purchase.id,
        method: 'cash',
        amountPaise: 1000,
      }),
    ).toThrow(/different supplier/);
  });
});

describe('returning to the supplier', () => {
  it('sends stock back and raises a debit note', () => {
    const purchase = buy();
    const line = purchase.lines[0]!;

    const credit = purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Two packs were torn',
      settlement: 'debit_note',
      lines: [{ purchaseItemId: line.id, quantityMilli: 2000 }],
    });

    expect(credit.returnNumber).toBe('PRN-0001');
    expect(credit.totalPaise).toBe(84000); // a fifth of ₹4,200
    expect(stockOf(riceId)).toBe(18000);
    expect(count("inventory_movements WHERE reference_type = 'purchase_return'")).toBe(1);

    // A debit note reduces what we owe without any money moving.
    expect(suppliers.outstanding(supplierId)).toBe(420000 - 84000);
    expect(count('supplier_payments')).toBe(0);
  });

  it('records money back as a payment in reverse when the supplier refunds', () => {
    const purchase = buy({ payment: { method: 'cash', amountPaise: 420000 } });
    const line = purchase.lines[0]!;

    purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Short delivery',
      settlement: 'cash',
      lines: [{ purchaseItemId: line.id, quantityMilli: 1000 }],
    });

    // Paid in full, then 42,000 paise came back: the account is square again.
    expect(suppliers.outstanding(supplierId)).toBe(0);
    expect(purchases.getPurchase(purchase.id).returnedPaise).toBe(42000);
  });

  it('caps a return at what is left on the line', () => {
    const purchase = buy();
    const line = purchase.lines[0]!;

    purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Damaged',
      lines: [{ purchaseItemId: line.id, quantityMilli: 9000 }],
    });

    expect(() =>
      purchases.createReturn({
        idempotencyKey: randomUUID(),
        purchaseId: purchase.id,
        reason: 'More',
        lines: [{ purchaseItemId: line.id, quantityMilli: 2000 }],
      }),
    ).toThrow(/can still be returned/);
  });

  it('credits the whole line across successive returns, to the paisa', () => {
    const purchase = buy({
      lines: [{ productId: riceId, quantityMilli: 3000, unitCostPaise: 33333, discountPaise: 0 }],
    });
    const line = purchase.lines[0]!;

    const parts = [1, 2, 3].map(() =>
      purchases.createReturn({
        idempotencyKey: randomUUID(),
        purchaseId: purchase.id,
        reason: 'Rejected at the counter',
        lines: [{ purchaseItemId: line.id, quantityMilli: 1000 }],
      }),
    );

    const taxable = parts.reduce((a, p) => a + p.taxablePaise, 0);
    expect(taxable).toBe(line.taxablePaise);
    expect(stockOf(riceId)).toBe(10000);
  });

  it('refuses a return against a cancelled purchase', () => {
    const purchase = buy();
    const line = purchase.lines[0]!;
    purchases.cancelPurchase({ id: purchase.id, reason: 'Entered twice' });

    expect(() =>
      purchases.createReturn({
        idempotencyKey: randomUUID(),
        purchaseId: purchase.id,
        reason: 'Too late',
        lines: [{ purchaseItemId: line.id, quantityMilli: 1000 }],
      }),
    ).toThrow(/cancelled/);
  });

  it('resolves a resubmitted return to the one already raised', () => {
    const purchase = buy();
    const line = purchase.lines[0]!;
    const input = {
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Wrong brand',
      lines: [{ purchaseItemId: line.id, quantityMilli: 1000 }],
    };

    const first = purchases.createReturn(input);
    const second = purchases.createReturn(input);

    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    expect(count('purchase_returns')).toBe(1);
  });
});

describe('cancelling a purchase', () => {
  it('takes the stock back out and keeps the number', () => {
    const purchase = buy();

    const cancelled = purchases.cancelPurchase({ id: purchase.id, reason: 'Entered twice' });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('Entered twice');
    expect(cancelled.purchaseNumber).toBe('PUR-0001');
    expect(cancelled.outstandingPaise).toBe(0);
    expect(stockOf(riceId)).toBe(10000);
    expect(count('purchases')).toBe(1);
    expect(suppliers.outstanding(supplierId)).toBe(0);
  });

  it('refuses when goods have already gone back, or money has moved', () => {
    const withReturn = buy();
    purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: withReturn.id,
      reason: 'Damaged',
      lines: [{ purchaseItemId: withReturn.lines[0]!.id, quantityMilli: 1000 }],
    });
    expect(() => purchases.cancelPurchase({ id: withReturn.id, reason: 'Nope' })).toThrow(
      /has a return/,
    );

    const paid = buy({ payment: { method: 'cash', amountPaise: 420000 } });
    expect(() => purchases.cancelPurchase({ id: paid.id, reason: 'Nope' })).toThrow(
      /has been paid/,
    );
  });

  it('cannot be cancelled twice', () => {
    const purchase = buy();
    purchases.cancelPurchase({ id: purchase.id, reason: 'Entered twice' });

    expect(() => purchases.cancelPurchase({ id: purchase.id, reason: 'Again' })).toThrow(
      PurchaseError,
    );
    expect(stockOf(riceId)).toBe(10000);
  });

  it('cannot be deleted at the database either', () => {
    const purchase = buy();

    expect(() => db.prepare('DELETE FROM purchases WHERE id = ?').run(purchase.id)).toThrow(
      /cannot be deleted/,
    );
    expect(() =>
      db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(purchase.id),
    ).toThrow(/cannot be deleted/);
  });
});

describe('the purchase list', () => {
  it('totals what was bought and what is still owed', () => {
    buy();
    buy({ payment: { method: 'cash', amountPaise: 420000 } });
    const cancelled = buy();
    purchases.cancelPurchase({ id: cancelled.id, reason: 'Duplicate entry' });

    const page = purchases.listPurchases({});

    expect(page.total).toBe(3);
    expect(page.purchasedPaise).toBe(840000);
    expect(page.outstandingPaise).toBe(420000);
  });

  it('finds a bill by our number or by the supplier’s', () => {
    buy({ supplierBillNo: 'ABC-77' });

    expect(purchases.listPurchases({ search: 'PUR-0001' }).total).toBe(1);
    expect(purchases.listPurchases({ search: 'ABC-77' }).total).toBe(1);
    expect(purchases.listPurchases({ search: 'nothing' }).total).toBe(0);
  });

  it('can show only the bills still to be paid', () => {
    buy();
    buy({ payment: { method: 'cash', amountPaise: 420000 } });

    expect(purchases.listPurchases({ unpaidOnly: true }).total).toBe(1);
  });
});

describe('suppliers', () => {
  it('lists what each has supplied and what is owed', () => {
    buy();
    purchases.recordPayment({ supplierId, method: 'cash', amountPaise: 20000 });

    const row = suppliers.list({}).items.find((s) => s.id === supplierId);

    expect(row?.purchases).toBe(1);
    expect(row?.purchasedPaise).toBe(420000);
    expect(row?.paidPaise).toBe(20000);
    expect(row?.outstandingPaise).toBe(400000);
    expect(row?.lastPurchaseAt).toBeTruthy();
  });

  it('is deactivated rather than deleted, and keeps its history', () => {
    buy();
    suppliers.setActive(supplierId, false);

    expect(suppliers.list({ status: 'active' }).total).toBe(0);
    expect(suppliers.list({ status: 'inactive' }).items[0]?.purchasedPaise).toBe(420000);
  });

  it('refuses a GSTIN that is not 15 characters', () => {
    expect(() => suppliers.create({ name: 'Bad GST', gstin: 'NOPE' })).toThrow();
  });
});
