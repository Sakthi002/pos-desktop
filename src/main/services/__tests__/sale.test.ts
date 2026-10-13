import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService, SaleError } from '../sale-service';
import { SettingsService } from '../settings-service';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let sales: SaleService;
let productId: string;

const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });
  catalogue = new CatalogueService(db);
  productId = catalogue.create({
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
  sales = new SaleService(db);
});
afterEach(() => {
  db.close();
});

const saleInput = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  lines: [{ productId, quantityMilli: 1000, unitPricePaise: 49900, discountPaise: 0 }],
  cartDiscountPaise: 0,
  payments: [{ method: 'cash' as const, amountPaise: 49900 }],
  ...overrides,
});

describe('checkout', () => {
  it('commits sale, lines, payment and stock movement together', () => {
    const receipt = sales.createSale(saleInput());

    expect(receipt.invoiceNumber).toBe('INV-0001');
    expect(receipt.bill.totalPaise).toBe(49900);
    expect(count('sales')).toBe(1);
    expect(count('sale_items')).toBe(1);
    expect(count('payments')).toBe(1);

    // Opening stock plus the sale movement.
    expect(count('inventory_movements')).toBe(2);
    expect(catalogue.get(productId)?.stockMilli).toBe(9000);
  });

  it('takes tax rate from the product, not the caller', () => {
    // Even if a compromised renderer wanted 0% tax, the product's 5% applies.
    const receipt = sales.createSale(saleInput());
    expect(receipt.bill.lines[0]?.taxRateBp).toBe(500);
    expect(receipt.bill.taxPaise).toBe(2376);
  });

  it('allows a price override at the till', () => {
    const receipt = sales.createSale(
      saleInput({
        lines: [{ productId, quantityMilli: 1000, unitPricePaise: 45000, discountPaise: 0 }],
        payments: [{ method: 'cash', amountPaise: 45000 }],
      }),
    );
    expect(receipt.bill.totalPaise).toBe(45000);
  });

  it('snapshots the product name so later edits do not rewrite the invoice', () => {
    const receipt = sales.createSale(saleInput());
    catalogue.update({
      ...catalogue.get(productId)!,
      name: 'Renamed Rice',
      categoryId: null,
    });

    expect(sales.getReceipt(receipt.id).bill.lines[0]?.name).toBe('Basmati Rice 5kg');
  });
});

describe('invoice numbering', () => {
  it('increments per sale', () => {
    expect(sales.createSale(saleInput()).invoiceNumber).toBe('INV-0001');
    expect(sales.createSale(saleInput()).invoiceNumber).toBe('INV-0002');
    expect(sales.createSale(saleInput()).invoiceNumber).toBe('INV-0003');
  });

  it('does not consume a number when the sale fails', () => {
    sales.createSale(saleInput());

    // Underpaid: rejected before anything is written.
    expect(() =>
      sales.createSale(saleInput({ payments: [{ method: 'cash', amountPaise: 100 }] })),
    ).toThrow(SaleError);

    // The series must have no gap.
    expect(sales.createSale(saleInput()).invoiceNumber).toBe('INV-0002');
  });

  it('honours the configured prefix and start number', () => {
    const other = freshDb();
    const base = defaultSettings('Other Shop');
    new SetupService(other).complete({
      ...base,
      invoice: { prefix: 'SGS', startNumber: 1001, financialYearStartMonth: 4 },
    });
    const cat = new CatalogueService(other);
    const pid = cat.create({
      name: 'Item',
      unitCode: 'pc',
      pricePaise: 10000,
      costPaise: 0,
      taxRateBp: 0,
      taxInclusive: true,
      trackInventory: false,
      reorderLevelMilli: 0,
      isActive: true,
      openingStockMilli: 0,
    }).id;

    const receipt = new SaleService(other).createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: pid, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    expect(receipt.invoiceNumber).toBe('SGS-1001');
    other.close();
  });
});

describe('duplicate submission', () => {
  it('returns the original sale rather than charging twice', () => {
    const key = randomUUID();
    const first = sales.createSale(saleInput({ idempotencyKey: key }));
    const second = sales.createSale(saleInput({ idempotencyKey: key }));

    expect(second.id).toBe(first.id);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.duplicate).toBe(true);

    expect(count('sales')).toBe(1);
    expect(count('payments')).toBe(1);
    // Critically, stock is deducted once.
    expect(catalogue.get(productId)?.stockMilli).toBe(9000);
  });

  it('treats a different key as a separate sale', () => {
    sales.createSale(saleInput());
    sales.createSale(saleInput());
    expect(count('sales')).toBe(2);
  });
});

describe('payments', () => {
  it('rejects an underpayment', () => {
    expect(() =>
      sales.createSale(saleInput({ payments: [{ method: 'cash', amountPaise: 40000 }] })),
    ).toThrow(/do not cover/i);
  });

  it('records change against a cash payment', () => {
    const receipt = sales.createSale(
      saleInput({ payments: [{ method: 'cash', amountPaise: 50000, tenderedPaise: 50000 }] }),
    );

    expect(receipt.changePaise).toBe(100);
    expect(receipt.payments[0]?.changePaise).toBe(100);
  });

  it('refuses to give change against a card payment', () => {
    expect(() =>
      sales.createSale(saleInput({ payments: [{ method: 'card', amountPaise: 50000 }] })),
    ).toThrow(/change can only be given against cash/i);
  });

  it('accepts a split payment', () => {
    const receipt = sales.createSale(
      saleInput({
        payments: [
          { method: 'cash', amountPaise: 20000 },
          { method: 'upi', amountPaise: 29900, reference: 'UPI123' },
        ],
      }),
    );

    expect(receipt.payments).toHaveLength(2);
    expect(receipt.payments.reduce((a, p) => a + p.amountPaise, 0)).toBe(49900);
    expect(receipt.changePaise).toBe(0);
  });

  it('requires at least one payment', () => {
    expect(() => sales.createSale(saleInput({ payments: [] }))).toThrow();
  });
});

describe('stock policy', () => {
  it('blocks a sale that would drive stock negative', () => {
    expect(() =>
      sales.createSale(
        saleInput({
          lines: [{ productId, quantityMilli: 99000, unitPricePaise: 49900, discountPaise: 0 }],
          payments: [{ method: 'cash', amountPaise: 4940100 }],
        }),
      ),
    ).toThrow(/only 10 pc in stock/i);

    expect(count('sales')).toBe(0);
  });

  it('allows it when the policy is relaxed', () => {
    new SettingsService(db).update({ inventory: { allowNegativeStock: true } });
    const relaxed = new SaleService(db);

    const receipt = relaxed.createSale(
      saleInput({
        lines: [{ productId, quantityMilli: 20000, unitPricePaise: 49900, discountPaise: 0 }],
        payments: [{ method: 'cash', amountPaise: 998000 }],
      }),
    );

    expect(receipt.invoiceNumber).toBe('INV-0001');
    expect(catalogue.get(productId)?.stockMilli).toBe(-10000);
  });

  it('sums the same product across lines before checking', () => {
    expect(() =>
      sales.createSale(
        saleInput({
          lines: [
            { productId, quantityMilli: 6000, unitPricePaise: 49900, discountPaise: 0 },
            { productId, quantityMilli: 6000, unitPricePaise: 49900, discountPaise: 0 },
          ],
          payments: [{ method: 'cash', amountPaise: 598800 }],
        }),
      ),
    ).toThrow(/only 10 pc/i);
  });

  it('does not move stock for a service item', () => {
    const service = catalogue.create({
      name: 'Tailoring',
      unitCode: 'pc',
      pricePaise: 25000,
      costPaise: 0,
      taxRateBp: 1800,
      taxInclusive: true,
      trackInventory: false,
      reorderLevelMilli: 0,
      isActive: true,
      openingStockMilli: 0,
    });

    const before = count('inventory_movements');
    sales.createSale(
      saleInput({
        lines: [
          { productId: service.id, quantityMilli: 1000, unitPricePaise: 25000, discountPaise: 0 },
        ],
        payments: [{ method: 'cash', amountPaise: 25000 }],
      }),
    );

    expect(count('inventory_movements')).toBe(before);
  });
});

describe('rollback', () => {
  it('leaves nothing behind when a line insert fails', () => {
    // A quantity of zero violates the CHECK on sale_items, failing mid-write.
    expect(() =>
      sales.createSale(
        saleInput({
          lines: [{ productId, quantityMilli: 0, unitPricePaise: 49900, discountPaise: 0 }],
        }),
      ),
    ).toThrow();

    expect(count('sales')).toBe(0);
    expect(count('sale_items')).toBe(0);
    expect(count('payments')).toBe(0);
    // Opening stock movement only; the sale's movement never happened.
    expect(count('inventory_movements')).toBe(1);
    expect(catalogue.get(productId)?.stockMilli).toBe(10000);
  });

  it('rejects a sale referencing a deleted product', () => {
    const gone = randomUUID();
    expect(() =>
      sales.createSale(
        saleInput({
          lines: [{ productId: gone, quantityMilli: 1000, unitPricePaise: 100, discountPaise: 0 }],
        }),
      ),
    ).toThrow(/no longer exists/i);
    expect(count('sales')).toBe(0);
  });

  it('rejects a sale of an inactive product', () => {
    catalogue.setActive(productId, false);
    expect(() => sales.createSale(saleInput())).toThrow(/no longer available/i);
    expect(count('sales')).toBe(0);
  });
});

describe('preview', () => {
  it('computes totals without writing anything', () => {
    const bill = sales.preview({
      lines: [{ productId, quantityMilli: 2000, unitPricePaise: 49900, discountPaise: 0 }],
      cartDiscountPaise: 0,
    });

    expect(bill.totalPaise).toBe(99800);
    expect(count('sales')).toBe(0);
    expect(count('inventory_movements')).toBe(1); // opening stock only
  });
});
