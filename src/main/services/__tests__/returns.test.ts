import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService, SaleError } from '../sale-service';
import { ReturnService, ReturnError } from '../return-service';
import { AuditRepository } from '../../db/repositories/audit';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let sales: SaleService;
let returns: ReturnService;
let riceId: string;
let serviceId: string;

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
    pricePaise: 10000,
    costPaise: 8000,
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

  sales = new SaleService(db);
  returns = new ReturnService(db);
});

afterEach(() => {
  db.close();
});

/** Sells `qty` units of rice and gives back the sale. */
const sell = (qtyMilli = 3000) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    lines: [
      { productId: riceId, quantityMilli: qtyMilli, unitPricePaise: 10000, discountPaise: 0 },
    ],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash' as const, amountPaise: (10000 * qtyMilli) / 1000 }],
  });

const returnInput = (saleId: string, overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  saleId,
  reason: 'Customer changed their mind',
  refundMethod: 'cash' as const,
  lines: [{ saleItemId: '', quantityMilli: 1000, restock: true }],
  ...overrides,
});

describe('returning against an invoice', () => {
  it('credits the whole line and puts the stock back', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    expect(stockOf(riceId)).toBe(8000);

    const credit = returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 2000, restock: true }] }),
    );

    expect(credit.returnNumber).toBe('INV-RET-0001');
    expect(credit.totalPaise).toBe(sale.bill.totalPaise);
    expect(credit.taxablePaise).toBe(sale.bill.taxablePaise);
    expect(credit.cgstPaise + credit.sgstPaise).toBe(sale.bill.taxPaise);
    expect(credit.igstPaise).toBe(0);
    expect(stockOf(riceId)).toBe(10000);
  });

  it('caps a return at what is left on the line', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    expect(() =>
      returns.createReturn(
        returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 3000, restock: true }] }),
      ),
    ).toThrow(ReturnError);

    returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 2000, restock: true }] }),
    );

    // Nothing is left, so a second return of any size is refused.
    expect(() =>
      returns.createReturn(
        returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
      ),
    ).toThrow(/can still be returned/);
    expect(count('sales_returns')).toBe(1);
  });

  it('splits an awkward line across partial returns without losing a paisa', () => {
    // 3 units at ₹100 inclusive of 5%: taxable 28571, tax 1429 — a total that
    // does not divide into three.
    const sale = sell(3000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credits = [1, 2, 3].map(() =>
      returns.createReturn(
        returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
      ),
    );

    const taxable = credits.reduce((a, c) => a + c.taxablePaise, 0);
    const tax = credits.reduce((a, c) => a + c.cgstPaise + c.sgstPaise + c.igstPaise, 0);

    expect(taxable).toBe(sale.bill.taxablePaise);
    expect(tax).toBe(sale.bill.taxPaise);
    expect(stockOf(riceId)).toBe(10000);
  });

  it('reverses the same tax heads the invoice charged', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    // A local sale: CGST and SGST, never IGST.
    expect(credit.cgstPaise).toBeGreaterThan(0);
    expect(credit.sgstPaise).toBeGreaterThan(0);
    expect(credit.igstPaise).toBe(0);
    expect(credit.taxPaise).toBe(credit.cgstPaise + credit.sgstPaise);
    expect(credit.totalPaise).toBe(credit.taxablePaise + credit.taxPaise + credit.roundOffPaise);
  });
});

describe('restock control', () => {
  it('refunds without restocking when the goods are not resaleable', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: false }] }),
    );

    expect(credit.lines[0]?.restocked).toBe(false);
    expect(credit.totalPaise).toBeGreaterThan(0);
    expect(stockOf(riceId)).toBe(8000);
    expect(count("inventory_movements WHERE movement_type = 'sale_return'")).toBe(0);
  });

  it('cannot restock a service item, whatever the operator ticked', () => {
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [
        { productId: serviceId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 },
      ],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 5000 }],
    });
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    expect(credit.lines[0]?.restocked).toBe(false);
    expect(count("inventory_movements WHERE movement_type = 'sale_return'")).toBe(0);
  });
});

describe('the refund', () => {
  it('is recorded against the credit note as a negative payment', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn(
      returnInput(sale.id, {
        refundMethod: 'upi',
        lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
      }),
    );

    const refund = db
      .prepare('SELECT * FROM payments WHERE return_id = ?')
      .get(credit.id) as Record<string, unknown>;

    expect(refund['sale_id']).toBeNull();
    expect(refund['method']).toBe('upi');
    expect(refund['amount_paise']).toBe(-credit.totalPaise);
  });
});

describe('returns that must be refused', () => {
  it('refuses a return against a voided sale', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    sales.voidSale({ id: sale.id, reason: 'Billed in error' });

    expect(() =>
      returns.createReturn(
        returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
      ),
    ).toThrow(/voided/);
  });

  it('refuses to void a sale that has already been returned', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    // Otherwise the returned unit would come back into stock twice.
    expect(() => sales.voidSale({ id: sale.id, reason: 'Changed my mind' })).toThrow(SaleError);
    expect(stockOf(riceId)).toBe(9000);
  });

  it('refuses the same line twice in one return', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    expect(() =>
      returns.createReturn(
        returnInput(sale.id, {
          lines: [
            { saleItemId, quantityMilli: 1000, restock: true },
            { saleItemId, quantityMilli: 1000, restock: true },
          ],
        }),
      ),
    ).toThrow(/twice/);
  });

  it('refuses a line that is not on the invoice', () => {
    const sale = sell(2000);
    expect(() =>
      returns.createReturn(
        returnInput(sale.id, {
          lines: [{ saleItemId: randomUUID(), quantityMilli: 1000, restock: true }],
        }),
      ),
    ).toThrow(/not on this invoice/);
  });

  it('requires a reason', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    expect(() =>
      returns.createReturn(
        returnInput(sale.id, {
          reason: '',
          lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
        }),
      ),
    ).toThrow();
  });

  it('writes nothing at all when one line of several is invalid', () => {
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [
        { productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 },
        { productId: serviceId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 },
      ],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 15000 }],
    });
    const items = db
      .prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY line_no')
      .all(sale.id) as { id: string }[];

    expect(() =>
      returns.createReturn(
        returnInput(sale.id, {
          lines: [
            { saleItemId: items[0]!.id, quantityMilli: 1000, restock: true },
            { saleItemId: items[1]!.id, quantityMilli: 9000, restock: false },
          ],
        }),
      ),
    ).toThrow(ReturnError);

    expect(count('sales_returns')).toBe(0);
    expect(count('sales_return_items')).toBe(0);
    expect(stockOf(riceId)).toBe(9000);
  });
});

describe('a resubmitted return', () => {
  it('resolves to the credit note already committed', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      saleId: sale.id,
      reason: 'Wrong size',
      refundMethod: 'cash' as const,
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
    };

    const first = returns.createReturn(input);
    const second = returns.createReturn(input);

    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    expect(count('sales_returns')).toBe(1);
    expect(stockOf(riceId)).toBe(9000);
  });
});

describe('the audit trail', () => {
  it('records the credit note, the invoice and the reason', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn(
      returnInput(sale.id, {
        reason: 'Pack was torn',
        lines: [{ saleItemId, quantityMilli: 1000, restock: false }],
      }),
    );

    const entries = new AuditRepository(db).listFor('sales_return', credit.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toMatchObject({
      returnNumber: credit.returnNumber,
      invoiceNumber: sale.invoiceNumber,
      reason: 'Pack was torn',
      restockedLines: 0,
    });
  });
});

describe('what a return screen is shown', () => {
  it('reports what is still returnable on each line', () => {
    const sale = sell(3000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    const view = returns.getReturnableSale(sale.id);
    expect(view.invoiceNumber).toBe(sale.invoiceNumber);
    expect(view.lines[0]?.soldMilli).toBe(3000);
    expect(view.lines[0]?.returnedMilli).toBe(1000);
    expect(view.lines[0]?.returnableMilli).toBe(2000);
    expect(view.priorReturns).toHaveLength(1);
    expect(view.canReturn).toBe(true);
  });

  it('closes the door once everything has come back', () => {
    const sale = sell(1000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    expect(returns.getReturnableSale(sale.id).canReturn).toBe(false);
  });

  it('closes the door on a voided sale', () => {
    const sale = sell(1000);
    sales.voidSale({ id: sale.id, reason: 'Keyed twice' });
    expect(returns.getReturnableSale(sale.id).canReturn).toBe(false);
  });
});

describe('the sales list after a return', () => {
  it('shows what was credited back without changing the invoice total', () => {
    const sale = sell(2000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    const credit = returns.createReturn(
      returnInput(sale.id, { lines: [{ saleItemId, quantityMilli: 1000, restock: true }] }),
    );

    const page = sales.listSales({});
    expect(page.items[0]?.totalPaise).toBe(sale.bill.totalPaise);
    expect(page.items[0]?.returnedPaise).toBe(credit.totalPaise);
    expect(page.returnedTotalPaise).toBe(credit.totalPaise);
  });

  it('counts nothing returned for an invoice with no credit note', () => {
    sell(1000);
    const page = sales.listSales({});
    expect(page.items[0]?.returnedPaise).toBe(0);
    expect(page.returnedTotalPaise).toBe(0);
  });
});
