import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SupplierService } from '../supplier-service';
import { PurchaseService, PurchaseError } from '../purchase-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { BatchService, BatchError } from '../batch-service';
import { defaultSettings } from '@shared/settings';
import { daysUntil, isExpired, today } from '@shared/batches';

let db: Database;
let catalogue: CatalogueService;
let purchases: PurchaseService;
let sales: SaleService;
let returns: ReturnService;
let batches: BatchService;
let syrupId: string;
let soapId: string;
let combId: string;
let supplierId: string;

/** A day a given number of days from today, as the shop would write it. */
const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const buy = (input: {
  productId: string;
  quantityMilli: number;
  batchNumber?: string;
  expiresOn?: string;
  unitCostPaise?: number;
}) =>
  purchases.createPurchase({
    idempotencyKey: randomUUID(),
    supplierId,
    supplierBillNo: `CW/${Math.random().toString(36).slice(2, 7)}`,
    taxMode: 'exclusive',
    lines: [
      {
        productId: input.productId,
        quantityMilli: input.quantityMilli,
        unitCostPaise: input.unitCostPaise ?? 5000,
        ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}),
        ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}),
      },
    ],
    billDiscountPaise: 0,
    payment: null,
  });

const sell = (productId: string, quantityMilli: number) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    lines: [{ productId, quantityMilli, unitPricePaise: 10000, discountPaise: 0 }],
    cartDiscountPaise: 0,
    redeemPoints: 0,
    payments: [{ method: 'cash', amountPaise: 1000000 }],
  });

const batchOf = (productId: string, number: string) =>
  batches.list({ productId, inStockOnly: false }).find((b) => b.batchNumber === number);

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  syrupId = catalogue.create({
    name: 'Cough Syrup 100ml',
    sku: 'SYR100',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 5000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    tracksBatches: true,
    valuationMethod: 'fifo',
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 0,
  }).id;

  soapId = catalogue.create({
    name: 'Bath Soap',
    sku: 'SOAP',
    unitCode: 'pc',
    pricePaise: 4000,
    costPaise: 2500,
    taxRateBp: 1800,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 100000,
  }).id;

  combId = catalogue.create({
    name: 'Comb',
    sku: 'COMB',
    unitCode: 'pc',
    pricePaise: 3000,
    costPaise: 1500,
    taxRateBp: 1800,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 0,
  }).id;

  purchases = new PurchaseService(db);
  sales = new SaleService(db);
  returns = new ReturnService(db);
  batches = new BatchService(db);

  supplierId = new SupplierService(db).create({
    name: 'Chennai Wholesale',
    stateCode: '33',
    creditLimitPaise: 0,
  }).id;
});

afterEach(() => {
  db.close();
});

describe('reading a date off a packet', () => {
  it('counts the days to it, and calls it expired the day after', () => {
    expect(daysUntil(day(10))).toBe(10);
    expect(daysUntil(day(-3))).toBe(-3);
    expect(isExpired(day(0))).toBe(false);
    expect(isExpired(day(-1))).toBe(true);
    expect(isExpired(null)).toBe(false);
    expect(today()).toBe(day(0));
  });
});

describe('stock arriving', () => {
  it('creates the batch named on the bill, with its expiry and cost', () => {
    buy({ productId: syrupId, quantityMilli: 10000, batchNumber: 'B-1', expiresOn: day(90) });

    const batch = batchOf(syrupId, 'B-1');
    expect(batch?.balanceMilli).toBe(10000);
    expect(batch?.expiresOn).toBe(day(90));
    expect(batch?.costPaise).toBe(5000);
    expect(batch?.daysToExpiry).toBe(90);
  });

  it('refuses a bill line with no batch number for a product that keeps them', () => {
    expect(() => buy({ productId: syrupId, quantityMilli: 1000 })).toThrow(PurchaseError);
  });

  it('asks for nothing from a product that keeps no batches', () => {
    buy({ productId: soapId, quantityMilli: 5000 });
    expect(batches.list({ productId: soapId, inStockOnly: false })).toHaveLength(0);
  });

  it('adds to a batch that arrives again under the same number', () => {
    buy({ productId: syrupId, quantityMilli: 10000, batchNumber: 'B-1', expiresOn: day(90) });
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'B-1', expiresOn: day(90) });

    expect(batches.list({ productId: syrupId, inStockOnly: true })).toHaveLength(1);
    expect(batchOf(syrupId, 'B-1')?.balanceMilli).toBe(15000);
  });
});

describe('selling from batches', () => {
  it('takes the earliest expiry first', () => {
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'LATE', expiresOn: day(180) });
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'SOON', expiresOn: day(20) });

    sell(syrupId, 3000);

    expect(batchOf(syrupId, 'SOON')?.balanceMilli).toBe(2000);
    expect(batchOf(syrupId, 'LATE')?.balanceMilli).toBe(5000);
  });

  it('runs on into the next batch when one is not enough', () => {
    buy({ productId: syrupId, quantityMilli: 2000, batchNumber: 'SOON', expiresOn: day(20) });
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'LATE', expiresOn: day(180) });

    const sale = sell(syrupId, 4000);

    expect(batchOf(syrupId, 'SOON')?.balanceMilli).toBe(0);
    expect(batchOf(syrupId, 'LATE')?.balanceMilli).toBe(3000);

    // Two movements for one line, one per batch.
    const movements = db
      .prepare(
        `SELECT batch_id, quantity_milli FROM inventory_movements
          WHERE reference_id = ? AND product_id = ?`,
      )
      .all(sale.id, syrupId) as { batch_id: string; quantity_milli: number }[];
    expect(movements).toHaveLength(2);
    expect(movements.reduce((a, m) => a + m.quantity_milli, 0)).toBe(-4000);
  });

  it('refuses to sell an expired batch, even when it is the only stock', () => {
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'OLD', expiresOn: day(-1) });

    expect(() => sell(syrupId, 1000)).toThrow(BatchError);
    // And nothing was written: the stock is still there, unsellable.
    expect(batchOf(syrupId, 'OLD')?.balanceMilli).toBe(5000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 0 });
  });

  it('skips an expired batch and sells the good one', () => {
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'OLD', expiresOn: day(-1) });
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'NEW', expiresOn: day(60) });

    sell(syrupId, 2000);

    expect(batchOf(syrupId, 'OLD')?.balanceMilli).toBe(5000);
    expect(batchOf(syrupId, 'NEW')?.balanceMilli).toBe(3000);
  });

  it('leaves a product with no batches selling exactly as before', () => {
    const sale = sell(soapId, 2000);

    const movement = db
      .prepare('SELECT batch_id FROM inventory_movements WHERE reference_id = ?')
      .get(sale.id) as { batch_id: string | null };
    expect(movement.batch_id).toBeNull();
  });
});

describe('goods coming back', () => {
  it('goes back to the batch it came out of', () => {
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'SOON', expiresOn: day(20) });
    buy({ productId: syrupId, quantityMilli: 5000, batchNumber: 'LATE', expiresOn: day(180) });

    const sale = sell(syrupId, 2000);
    const returnable = returns.getReturnableSale(sale.id);

    returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Wrong strength',
      refundMethod: 'cash',
      lines: [{ saleItemId: returnable.lines[0]!.saleItemId, quantityMilli: 2000, restock: true }],
    });

    expect(batchOf(syrupId, 'SOON')?.balanceMilli).toBe(5000);
    expect(batchOf(syrupId, 'LATE')?.balanceMilli).toBe(5000);
  });

  it('puts a voided sale back where it came from', () => {
    buy({ productId: syrupId, quantityMilli: 3000, batchNumber: 'SOON', expiresOn: day(20) });
    buy({ productId: syrupId, quantityMilli: 3000, batchNumber: 'LATE', expiresOn: day(180) });

    const sale = sell(syrupId, 4000);
    expect(batchOf(syrupId, 'SOON')?.balanceMilli).toBe(0);
    expect(batchOf(syrupId, 'LATE')?.balanceMilli).toBe(2000);

    sales.voidSale({ id: sale.id, reason: 'Keyed twice' });

    expect(batchOf(syrupId, 'SOON')?.balanceMilli).toBe(3000);
    expect(batchOf(syrupId, 'LATE')?.balanceMilli).toBe(3000);
  });
});

describe('what is about to go out of date', () => {
  it('lists batches by how soon they expire, and counts them for the dashboard', () => {
    buy({ productId: syrupId, quantityMilli: 1000, batchNumber: 'SOON', expiresOn: day(10) });
    buy({ productId: syrupId, quantityMilli: 1000, batchNumber: 'LATER', expiresOn: day(120) });
    buy({ productId: syrupId, quantityMilli: 1000, batchNumber: 'GONE', expiresOn: day(-5) });

    const soon = batches.expiring(30);
    expect(soon.map((b) => b.batchNumber)).toEqual(['GONE', 'SOON']);

    const count = batches.countExpiring(30);
    expect(count.batches).toBe(2);
    expect(count.valuePaise).toBe(10000);
  });

  it('leaves out a batch that has been sold out', () => {
    buy({ productId: syrupId, quantityMilli: 1000, batchNumber: 'SOON', expiresOn: day(10) });
    sell(syrupId, 1000);

    expect(batches.expiring(30)).toHaveLength(0);
  });
});

describe('what stock is worth', () => {
  const stock = (productId: string): number =>
    (
      db
        .prepare(
          'SELECT COALESCE(SUM(quantity_milli), 0) AS n FROM inventory_movements WHERE product_id = ?',
        )
        .get(productId) as { n: number }
    ).n;

  /** Two arrivals at different costs, then half of it sold. */
  const twoLayers = (productId: string, withBatches: boolean) => {
    buy({
      productId,
      quantityMilli: 2000,
      unitCostPaise: 4000,
      ...(withBatches ? { batchNumber: 'OLD', expiresOn: day(30) } : {}),
    });
    buy({
      productId,
      quantityMilli: 2000,
      unitCostPaise: 6000,
      ...(withBatches ? { batchNumber: 'NEW', expiresOn: day(300) } : {}),
    });
    sell(productId, 2000);
  };

  const setMethod = (productId: string, method: 'fifo' | 'lifo' | 'average') => {
    const product = catalogue.get(productId);
    expect(product).not.toBeNull();
    catalogue.update({
      id: productId,
      name: product!.name,
      unitCode: product!.unitCode,
      costPaise: product!.costPaise,
      pricePaise: product!.pricePaise,
      taxRateBp: product!.taxRateBp,
      taxInclusive: product!.taxInclusive,
      trackInventory: product!.trackInventory,
      tracksBatches: product!.tracksBatches,
      valuationMethod: method,
      reorderLevelMilli: product!.reorderLevelMilli,
      isActive: product!.isActive,
    });
  };

  it('values a batched product at what its remaining batches actually cost', () => {
    twoLayers(syrupId, true);

    // The earliest expiry went out, so what is left is the ₹60 batch. There is
    // nothing to assume: the shelf is known.
    expect(batches.valueOf(syrupId, stock(syrupId))).toBe(12000);
  });

  it('leaves the newest arrivals on the shelf under FIFO', () => {
    twoLayers(combId, false);
    // Four units arrived, two at ₹40 and two at ₹60; two were sold. FIFO says
    // the ₹40 pair went, so the shelf is worth two at ₹60.
    expect(batches.valueOf(combId, stock(combId))).toBe(12000);
  });

  it('leaves the oldest arrivals on the shelf under LIFO', () => {
    setMethod(combId, 'lifo');
    twoLayers(combId, false);
    expect(batches.valueOf(combId, stock(combId))).toBe(8000);
  });

  it('ignores the order altogether under average', () => {
    setMethod(combId, 'average');
    twoLayers(combId, false);
    expect(batches.valueOf(combId, stock(combId))).toBe(10000);
  });

  it("falls back to the product's cost when nothing ever arrived with one", () => {
    expect(batches.valueOf(soapId, 100000)).toBe(250000);
  });
});
