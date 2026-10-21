import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService } from '../sale-service';
import { defaultSettings } from '@shared/settings';

/**
 * What the till sees when it opens the customer list. A counter is not a place
 * to scroll, so the list is capped — which only works if the shop is told the
 * cap is there, and if the twenty it shows are the twenty worth showing.
 */

let db: Database;
let customers: CustomerService;
let sales: SaleService;
let riceId: string;

const bill = (customerId: string) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    customerId,
    lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
    cartDiscountPaise: 0,
    redeemPoints: 0,
    priceLevel: 'retail',
    onCredit: false,
    payments: [{ method: 'cash', amountPaise: 10000 }],
  });

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  riceId = new CatalogueService(db).create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    taxRateBp: 0,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 1000000,
  }).id;

  customers = new CustomerService(db);
  sales = new SaleService(db);
});

afterEach(() => {
  db.close();
});

describe('the customer list at the till', () => {
  it('caps the rows and still says how many there are', () => {
    for (let i = 0; i < 40; i += 1) {
      customers.create({ name: `Customer ${String(i).padStart(2, '0')}` });
    }

    const found = customers.search('');

    expect(found.items).toHaveLength(20);
    // The forty made here, and the walk-in the setup made.
    expect(found.total).toBe(41);
  });

  it('counts everyone matching, not everyone shown', () => {
    for (let i = 0; i < 30; i += 1) customers.create({ name: `Raja ${i}`, phone: `90000000${i}` });
    customers.create({ name: 'Someone Else' });

    expect(customers.search('Raja').total).toBe(30);
    expect(customers.search('Raja').items).toHaveLength(20);
  });

  it('puts whoever was billed most recently in front of the alphabet', () => {
    const anand = customers.create({ name: 'Anand' }).id;
    const zubair = customers.create({ name: 'Zubair' }).id;
    customers.create({ name: 'Bala' });

    bill(anand);
    bill(zubair);

    const names = customers.search('').items.map((c) => c.name);

    // Walk-in first, as the till depends on; then the two who have bought,
    // newest first; then whoever never has, by name.
    expect(names[0]).toBe('Walk-in Customer');
    expect(names.slice(1, 4)).toEqual(['Zubair', 'Anand', 'Bala']);
  });

  it('finds a customer by phone as readily as by name', () => {
    customers.create({ name: 'Meena Traders', phone: '9444012345' });
    customers.create({ name: 'Ravi Kumar', phone: '9876543210' });

    expect(customers.search('944').items.map((c) => c.name)).toEqual(['Meena Traders']);
    expect(customers.search('Ravi').items.map((c) => c.name)).toEqual(['Ravi Kumar']);
  });
});
