import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;

const product = (overrides: Record<string, unknown> = {}) => ({
  name: 'Basmati Rice 5kg',
  unitCode: 'pc',
  pricePaise: 49900,
  costPaise: 38000,
  taxRateBp: 500,
  taxInclusive: true,
  trackInventory: true,
  reorderLevelMilli: 0,
  isActive: true,
  openingStockMilli: 0,
  ...overrides,
});

beforeEach(() => {
  db = freshDb();
  new SetupService(db).complete(defaultSettings('Test Shop'));
  catalogue = new CatalogueService(db);
});
afterEach(() => {
  db.close();
});

describe('what a new shop starts with', () => {
  it('has categories for the trade it said it was in', () => {
    const names = catalogue.listCategories().map((c) => c.name);

    expect(names).toContain('Staples');
    expect(names).toContain('Household');
    expect(names.length).toBeGreaterThan(3);
  });

  it('invents nothing for a trade it was not told about', () => {
    const other = freshDb();
    const base = defaultSettings('Mystery Shop');
    new SetupService(other).complete({
      ...base,
      shop: { ...base.shop, stateCode: '33', businessCategory: 'other' },
    });

    expect(new CatalogueService(other).listCategories()).toHaveLength(0);
    other.close();
  });

  it('lets a product be sold with no category at all', () => {
    const product = catalogue.create({
      name: 'Unfiled thing',
      unitCode: 'pc',
      pricePaise: 5000,
      taxRateBp: 0,
      taxInclusive: true,
      trackInventory: false,
      reorderLevelMilli: 0,
      isActive: true,
      openingStockMilli: 0,
    });

    expect(product.categoryId).toBeNull();
    // And it is findable as a group rather than only by typing its name.
    const unfiled = catalogue.search({ categoryId: 'none', status: 'active' });
    expect(unfiled.items.map((p) => p.name)).toContain('Unfiled thing');
  });
});

describe('categories', () => {
  it('creates and lists', () => {
    // A new shop already has the starter categories for its trade, so the test
    // is that the new one joins them rather than that it stands alone.
    const before = catalogue.listCategories().length;
    const list = catalogue.createCategory({ name: 'Pooja items' });

    expect(list.map((c) => c.name)).toContain('Pooja items');
    expect(list).toHaveLength(before + 1);
  });

  it('rejects a duplicate name regardless of case', () => {
    catalogue.createCategory({ name: 'Pooja items' });
    expect(() => catalogue.createCategory({ name: 'pooja ITEMS' })).toThrow(/already exists/i);
  });

  it('deletes an unused category but deactivates one in use', () => {
    const [unused] = catalogue.createCategory({ name: 'Unused' });
    expect(unused).toBeDefined();
    expect(catalogue.removeCategory(unused!.id).deleted).toBe(true);

    const used = catalogue.createCategory({ name: 'Used' })[0]!;
    catalogue.create(product({ categoryId: used.id }));

    const result = catalogue.removeCategory(used.id);
    expect(result.deleted).toBe(false);
    expect(result.categories.find((c) => c.id === used.id)?.isActive).toBe(false);
  });

  it('counts products per category', () => {
    const cat = catalogue.createCategory({ name: 'Grocery' })[0]!;
    catalogue.create(product({ categoryId: cat.id, sku: 'A' }));
    catalogue.create(product({ categoryId: cat.id, sku: 'B' }));

    expect(catalogue.listCategories()[0]?.productCount).toBe(2);
  });
});

describe('products', () => {
  it('creates and reads back', () => {
    const created = catalogue.create(product({ sku: 'RICE5', barcode: '8901234567890' }));

    expect(created.name).toBe('Basmati Rice 5kg');
    expect(created.pricePaise).toBe(49900);
    expect(created.stockMilli).toBe(0);
  });

  it('records opening stock as a movement', () => {
    const created = catalogue.create(product({ openingStockMilli: 50000 }));
    expect(created.stockMilli).toBe(50000);

    const movement = db
      .prepare('SELECT movement_type, quantity_milli FROM inventory_movements WHERE product_id = ?')
      .get(created.id);
    expect(movement).toEqual({ movement_type: 'opening', quantity_milli: 50000 });
  });

  it('does not record stock for a service item', () => {
    const created = catalogue.create(
      product({ trackInventory: false, openingStockMilli: 5000, name: 'Tailoring' }),
    );
    expect(created.stockMilli).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get() as { n: number }).n,
    ).toBe(0);
  });

  it('rejects a duplicate SKU, naming the clashing product', () => {
    catalogue.create(product({ sku: 'RICE5' }));
    expect(() => catalogue.create(product({ sku: 'RICE5', name: 'Other' }))).toThrow(
      /already used by Basmati Rice 5kg/,
    );
  });

  it('rejects a duplicate barcode', () => {
    catalogue.create(product({ barcode: '8901234567890' }));
    expect(() => catalogue.create(product({ barcode: '8901234567890', name: 'Other' }))).toThrow(
      /barcode .* already used/i,
    );
  });

  it('allows many products with no SKU', () => {
    catalogue.create(product({ name: 'A' }));
    catalogue.create(product({ name: 'B' }));
    expect(catalogue.search({ status: 'all' }).total).toBe(2);
  });

  it('lets a product keep its own SKU on update', () => {
    const created = catalogue.create(product({ sku: 'RICE5' }));
    const updated = catalogue.update({
      ...created,
      sku: 'RICE5',
      name: 'Renamed',
      categoryId: null,
    });
    expect(updated.name).toBe('Renamed');
  });

  it('deactivates rather than deletes a product with history', () => {
    const created = catalogue.create(product({ openingStockMilli: 1000 }));
    const result = catalogue.remove(created.id);

    expect(result.deleted).toBe(false);
    expect(catalogue.get(created.id)?.isActive).toBe(false);
  });

  it('deletes a product with no history', () => {
    const created = catalogue.create(product());
    expect(catalogue.remove(created.id).deleted).toBe(true);
    expect(catalogue.get(created.id)).toBeNull();
  });
});

describe('search', () => {
  beforeEach(() => {
    catalogue.create(
      product({
        name: 'Basmati Rice',
        sku: 'RICE',
        openingStockMilli: 2000,
        reorderLevelMilli: 5000,
      }),
    );
    catalogue.create(
      product({ name: 'Sugar', sku: 'SUG', barcode: '999', openingStockMilli: 50000 }),
    );
    catalogue.create(product({ name: 'Old Stock', sku: 'OLD', isActive: false }));
  });

  it('matches name, sku and barcode', () => {
    expect(catalogue.search({ search: 'rice' }).items.map((p) => p.sku)).toEqual(['RICE']);
    expect(catalogue.search({ search: 'SUG' }).items.map((p) => p.name)).toEqual(['Sugar']);
    expect(catalogue.search({ search: '999' }).items.map((p) => p.name)).toEqual(['Sugar']);
  });

  it('filters by status', () => {
    expect(catalogue.search({ status: 'active' }).total).toBe(2);
    expect(catalogue.search({ status: 'inactive' }).total).toBe(1);
    expect(catalogue.search({ status: 'all' }).total).toBe(3);
  });

  it('finds low stock against the reorder level', () => {
    const low = catalogue.search({ status: 'low-stock' });
    expect(low.items.map((p) => p.sku)).toEqual(['RICE']);
  });

  it('excludes products with no reorder level set', () => {
    // Sugar has plenty of stock and no reorder level; it must not appear.
    catalogue.create(product({ name: 'Salt', sku: 'SALT', openingStockMilli: 0 }));
    expect(catalogue.search({ status: 'low-stock' }).items.map((p) => p.sku)).toEqual(['RICE']);
  });

  it('excludes inactive products from low stock', () => {
    catalogue.create(
      product({ name: 'Discontinued', sku: 'DISC', isActive: false, reorderLevelMilli: 5000 }),
    );
    expect(catalogue.search({ status: 'low-stock' }).items.map((p) => p.sku)).toEqual(['RICE']);
  });

  it('sorts and paginates', () => {
    const page1 = catalogue.search({ status: 'all', sort: 'name', pageSize: 10, page: 1 });
    expect(page1.items.map((p) => p.name)).toEqual(['Basmati Rice', 'Old Stock', 'Sugar']);

    const desc = catalogue.search({ status: 'all', sort: 'name', direction: 'desc' });
    expect(desc.items[0]?.name).toBe('Sugar');
  });
});

describe('stock adjustment', () => {
  it('increases stock and writes a movement with the reason', () => {
    const created = catalogue.create(product({ openingStockMilli: 10000 }));
    const after = catalogue.adjustStock({
      productId: created.id,
      deltaMilli: 5000,
      reason: 'Stock count correction',
    });

    expect(after.stockMilli).toBe(15000);

    const movement = db
      .prepare("SELECT reason FROM inventory_movements WHERE movement_type = 'adjustment'")
      .get();
    expect(movement).toEqual({ reason: 'Stock count correction' });
  });

  it('requires a reason', () => {
    const created = catalogue.create(product());
    expect(() =>
      catalogue.adjustStock({ productId: created.id, deltaMilli: 1000, reason: '' }),
    ).toThrow();
  });

  it('rejects a zero adjustment', () => {
    const created = catalogue.create(product());
    expect(() =>
      catalogue.adjustStock({ productId: created.id, deltaMilli: 0, reason: 'Nothing' }),
    ).toThrow();
  });

  it('refuses to drive stock negative', () => {
    const created = catalogue.create(product({ openingStockMilli: 1000 }));
    expect(() =>
      catalogue.adjustStock({ productId: created.id, deltaMilli: -5000, reason: 'Damage' }),
    ).toThrow(/current stock is 1/i);
  });

  it('refuses to adjust a service item', () => {
    const created = catalogue.create(product({ trackInventory: false }));
    expect(() =>
      catalogue.adjustStock({ productId: created.id, deltaMilli: 1000, reason: 'x' }),
    ).toThrow(/service item/i);
  });

  it('writes an audit entry', () => {
    const created = catalogue.create(product({ openingStockMilli: 10000 }));
    catalogue.adjustStock({ productId: created.id, deltaMilli: -2000, reason: 'Breakage' });

    const audit = db
      .prepare("SELECT action, details FROM audit_logs WHERE entity_type = 'product'")
      .get() as { action: string; details: string };
    expect(audit.action).toBe('stock_adjusted');
    expect(JSON.parse(audit.details)).toMatchObject({
      before: 10000,
      after: 8000,
      reason: 'Breakage',
    });
  });
});
