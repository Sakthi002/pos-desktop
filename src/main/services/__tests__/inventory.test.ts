import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { InventoryService, InventoryError } from '../inventory-service';
import { AuditRepository } from '../../db/repositories/audit';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let sales: SaleService;
let returns: ReturnService;
let inventory: InventoryService;
let riceId: string;

const newProduct = (name: string, overrides: Record<string, unknown> = {}) =>
  catalogue.create({
    name,
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 8000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 10000,
    ...overrides,
  });

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = newProduct('Basmati Rice 5kg', { sku: 'RICE5' }).id;
  sales = new SaleService(db);
  returns = new ReturnService(db);
  inventory = new InventoryService(db);
});

afterEach(() => {
  db.close();
});

describe('movement history', () => {
  it('explains the balance, newest first, naming the document behind each move', () => {
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 20000 }],
    });
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'One pack short',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
    });

    const page = inventory.movements({ productId: riceId });

    expect(page.productName).toBe('Basmati Rice 5kg');
    expect(page.stockMilli).toBe(9000);
    expect(page.total).toBe(3);

    // Newest first: return, sale, opening.
    expect(page.items.map((m) => m.movementType)).toEqual(['sale_return', 'sale', 'opening']);
    expect(page.items.map((m) => m.quantityMilli)).toEqual([1000, -2000, 10000]);

    // The running balance is the stock after each movement, in time order.
    expect(page.items.map((m) => m.balanceMilli)).toEqual([9000, 8000, 10000]);

    expect(page.items[0]?.documentNumber).toBe(credit.returnNumber);
    expect(page.items[1]?.documentNumber).toBe(sale.invoiceNumber);
    expect(page.items[2]?.documentNumber).toBeNull();
  });

  it('shows an adjustment with the reason the operator gave', () => {
    catalogue.adjustStock({ productId: riceId, deltaMilli: -500, reason: 'Damaged in storage' });

    const page = inventory.movements({ productId: riceId });
    expect(page.items[0]).toMatchObject({
      movementType: 'adjustment',
      quantityMilli: -500,
      reason: 'Damaged in storage',
      balanceMilli: 9500,
    });
  });

  it('records the adjustment in the audit trail, with its unit', () => {
    catalogue.adjustStock({ productId: riceId, deltaMilli: -500, reason: 'Damaged in storage' });

    const entry = new AuditRepository(db).listFor('product', riceId)[0];
    expect(entry?.action).toBe('stock_adjusted');
    // Without the unit, a reader cannot tell 500 thousandths from 500 pieces.
    expect(entry?.details).toMatchObject({
      delta: -500,
      reason: 'Damaged in storage',
      unitCode: 'pc',
    });
  });

  it('names the voided invoice behind a reversal', () => {
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });
    sales.voidSale({ id: sale.id, reason: 'Wrong customer' });

    const page = inventory.movements({ productId: riceId });
    expect(page.items[0]?.documentNumber).toBe(sale.invoiceNumber);
    expect(page.items[0]?.balanceMilli).toBe(10000);
  });

  it('paginates without restarting the balance from zero', () => {
    for (let i = 0; i < 12; i += 1) {
      catalogue.adjustStock({ productId: riceId, deltaMilli: 100, reason: `Top-up ${i}` });
    }

    const first = inventory.movements({ productId: riceId, pageSize: 10, page: 1 });
    const second = inventory.movements({ productId: riceId, pageSize: 10, page: 2 });

    expect(first.total).toBe(13);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(3);
    // Oldest row on the last page is the opening stock, at its own balance.
    expect(second.items[second.items.length - 1]?.movementType).toBe('opening');
    expect(second.items[second.items.length - 1]?.balanceMilli).toBe(10000);
    expect(first.items[0]?.balanceMilli).toBe(11200);
  });

  it('rejects an unknown product', () => {
    expect(() => inventory.movements({ productId: randomUUID() })).toThrow(InventoryError);
  });
});

describe('low stock alerts', () => {
  it('lists only products that have reached a reorder level someone set', () => {
    const watched = newProduct('Sugar 1kg', { reorderLevelMilli: 5000, openingStockMilli: 4000 });
    const comfortable = newProduct('Salt 1kg', {
      reorderLevelMilli: 5000,
      openingStockMilli: 20000,
    });
    const noLevel = newProduct('Tea 500g', { reorderLevelMilli: 0, openingStockMilli: 0 });
    const service = newProduct('Delivery', {
      trackInventory: false,
      reorderLevelMilli: 5000,
      openingStockMilli: 0,
    });

    const low = inventory.lowStock();
    const ids = low.map((p) => p.id);

    expect(ids).toContain(watched.id);
    expect(ids).not.toContain(comfortable.id);
    // A level of zero is not an alert: it would fire for everything at zero stock.
    expect(ids).not.toContain(noLevel.id);
    // Nothing to reorder for a service item.
    expect(ids).not.toContain(service.id);
  });

  it('puts the worst shortfall first', () => {
    const nearlyOut = newProduct('Sugar 1kg', {
      reorderLevelMilli: 10000,
      openingStockMilli: 1000,
    });
    const justUnder = newProduct('Salt 1kg', {
      reorderLevelMilli: 10000,
      openingStockMilli: 9000,
    });

    expect(inventory.lowStock().map((p) => p.id)).toEqual([nearlyOut.id, justUnder.id]);
  });

  it('drops off the list once stock is replenished', () => {
    const sugar = newProduct('Sugar 1kg', { reorderLevelMilli: 5000, openingStockMilli: 4000 });
    expect(inventory.lowStock().map((p) => p.id)).toContain(sugar.id);

    catalogue.adjustStock({ productId: sugar.id, deltaMilli: 10000, reason: 'New stock arrived' });

    expect(inventory.lowStock().map((p) => p.id)).not.toContain(sugar.id);
  });

  it('ignores a deactivated product', () => {
    const sugar = newProduct('Sugar 1kg', { reorderLevelMilli: 5000, openingStockMilli: 1000 });
    catalogue.setActive(sugar.id, false);
    expect(inventory.lowStock().map((p) => p.id)).not.toContain(sugar.id);
  });
});
