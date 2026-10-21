import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService, SaleError } from '../sale-service';
import { ReturnService } from '../return-service';
import { LedgerService } from '../ledger-service';
import { CounterService, CounterError } from '../counter-service';
import { defaultSettings } from '@shared/settings';
import { priceAt } from '@shared/trade';
import { ACCOUNTS } from '@shared/ledger';

let db: Database;
let catalogue: CatalogueService;
let customers: CustomerService;
let sales: SaleService;
let counter: CounterService;
let riceId: string;
let shopId: string;

const EVERYTHING = { fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' };

/** One unit at ₹100 inclusive, paid however the caller says. */
const sell = (options: {
  payPaise: number;
  customerId?: string | null;
  onCredit?: boolean;
  priceLevel?: 'retail' | 'wholesale' | 'special';
  unitPricePaise?: number;
}) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    customerId: options.customerId ?? null,
    lines: [
      {
        productId: riceId,
        quantityMilli: 1000,
        unitPricePaise: options.unitPricePaise ?? 10000,
        discountPaise: 0,
      },
    ],
    cartDiscountPaise: 0,
    redeemPoints: 0,
    priceLevel: options.priceLevel ?? 'retail',
    onCredit: options.onCredit ?? false,
    payments: options.payPaise > 0 ? [{ method: 'cash', amountPaise: options.payPaise }] : [],
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
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    wholesalePricePaise: 8500,
    specialPricePaise: 8000,
    costPaise: 7000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 1000000,
  }).id;

  customers = new CustomerService(db);
  shopId = customers.create({
    name: 'Corner Shop',
    phone: '9876543210',
    priceLevel: 'wholesale',
    creditLimitPaise: 500000,
  }).id;

  sales = new SaleService(db);
  counter = new CounterService(db);
});

afterEach(() => {
  db.close();
});

describe('price levels', () => {
  it('charges the level set on the product, and falls back to retail', () => {
    const product = catalogue.get(riceId)!;

    expect(priceAt('retail', product)).toBe(10000);
    expect(priceAt('wholesale', product)).toBe(8500);
    expect(priceAt('special', product)).toBe(8000);

    const plain = catalogue.get(
      catalogue.create({
        name: 'Salt 1kg',
        unitCode: 'pc',
        pricePaise: 2000,
        taxRateBp: 500,
        taxInclusive: true,
        trackInventory: true,
        reorderLevelMilli: 0,
        isActive: true,
        openingStockMilli: 0,
      }).id,
    )!;
    // No wholesale price set is not a promise of a discount.
    expect(priceAt('wholesale', plain)).toBe(2000);
  });

  it('keeps the level the bill was charged at', () => {
    const sale = sell({
      payPaise: 8500,
      customerId: shopId,
      priceLevel: 'wholesale',
      unitPricePaise: 8500,
    });
    expect(sale.priceLevel).toBe('wholesale');
    expect(sale.bill.totalPaise).toBe(8500);
  });

  it('remembers the level a customer is billed at', () => {
    expect(customers.get(shopId)?.priceLevel).toBe('wholesale');
  });
});

describe('selling on credit', () => {
  it('leaves the shortfall on the account', () => {
    const sale = sell({ payPaise: 4000, customerId: shopId, onCredit: true });

    expect(sale.creditPaise).toBe(6000);
    expect(counter.account(shopId).outstandingPaise).toBe(6000);
  });

  it('refuses a shortfall that was not meant', () => {
    expect(() => sell({ payPaise: 4000, customerId: shopId })).toThrow(SaleError);
  });

  it('refuses credit to a walk-in', () => {
    expect(() => sell({ payPaise: 4000, customerId: null, onCredit: true })).toThrow(SaleError);
  });

  it('lets any named customer owe, because nothing caps them', () => {
    const noLimit = customers.create({ name: 'Passing Trade' }).id;
    const sale = sell({ payPaise: 0, customerId: noLimit, onCredit: true });

    expect(sale.creditPaise).toBe(10000);
    expect(counter.account(noLimit).outstandingPaise).toBe(10000);
  });

  it('keeps letting them owe, and keeps the figure, however much it is', () => {
    // Nothing caps a customer any more: a shop lends what it will lend, and
    // what it goes by is the figure the till puts in front of it.
    for (let i = 0; i < 50; i += 1) sell({ payPaise: 0, customerId: shopId, onCredit: true });

    expect(counter.account(shopId).outstandingPaise).toBe(500000);
    expect(() => sell({ payPaise: 0, customerId: shopId, onCredit: true })).not.toThrow();
    expect(counter.account(shopId).outstandingPaise).toBe(510000);
  });

  it('puts the unpaid part on the customer in the books', () => {
    sell({ payPaise: 4000, customerId: shopId, onCredit: true });

    const ledger = new LedgerService(db);
    const receivable = ledger
      .trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso)
      .find((r) => r.code === ACCOUNTS.receivable);
    expect(receivable?.balancePaise).toBe(6000);

    const statement = ledger.partyStatement({
      partyType: 'customer',
      partyId: shopId,
      ...EVERYTHING,
      limit: 100,
    });
    expect(statement.closingPaise).toBe(6000);
  });
});

describe('taking money against an account', () => {
  it('brings down what is owed, and shows on the books', () => {
    const sale = sell({ payPaise: 0, customerId: shopId, onCredit: true });
    expect(counter.account(shopId).outstandingPaise).toBe(10000);

    const after = counter.recordReceipt({
      customerId: shopId,
      saleId: sale.id,
      method: 'cash',
      amountPaise: 6000,
    });

    expect(after.outstandingPaise).toBe(4000);
    expect(after.bills[0]?.outstandingPaise).toBe(4000);

    const ledger = new LedgerService(db);
    const rows = ledger.trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
    expect(rows.find((r) => r.code === ACCOUNTS.receivable)?.balancePaise).toBe(4000);
    expect(rows.find((r) => r.code === ACCOUNTS.cash)?.balancePaise).toBe(6000);
    expect(rows.reduce((a, r) => a + r.debitPaise - r.creditPaise, 0)).toBe(0);
  });

  it('refuses more than the bill or the account is owed', () => {
    const sale = sell({ payPaise: 0, customerId: shopId, onCredit: true });

    expect(() =>
      counter.recordReceipt({
        customerId: shopId,
        saleId: sale.id,
        method: 'cash',
        amountPaise: 20000,
      }),
    ).toThrow(CounterError);

    expect(() =>
      counter.recordReceipt({ customerId: shopId, method: 'cash', amountPaise: 20000 }),
    ).toThrow(CounterError);
  });

  it('takes money on account without naming a bill', () => {
    sell({ payPaise: 0, customerId: shopId, onCredit: true });
    sell({ payPaise: 0, customerId: shopId, onCredit: true });

    const after = counter.recordReceipt({
      customerId: shopId,
      method: 'upi',
      amountPaise: 15000,
    });

    expect(after.outstandingPaise).toBe(5000);
  });

  it('takes one payment in two forms, and counts only the cash as cash', () => {
    const sale = sell({ payPaise: 0, customerId: shopId, onCredit: true });

    const after = counter.recordReceipts({
      customerId: shopId,
      saleId: sale.id,
      parts: [
        { method: 'cash', amountPaise: 6000 },
        { method: 'upi', amountPaise: 4000 },
      ],
    });

    expect(after.outstandingPaise).toBe(0);
    expect(counter.receipts(shopId)).toHaveLength(2);

    const rows = new LedgerService(db).trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
    expect(rows.find((r) => r.code === ACCOUNTS.receivable)?.balancePaise).toBe(0);
    expect(rows.find((r) => r.code === ACCOUNTS.cash)?.balancePaise).toBe(6000);
    expect(rows.find((r) => r.code === ACCOUNTS.upi)?.balancePaise).toBe(4000);
  });

  it('writes no part of a split that overshoots what is owed', () => {
    sell({ payPaise: 0, customerId: shopId, onCredit: true });

    expect(() =>
      counter.recordReceipts({
        customerId: shopId,
        parts: [
          { method: 'cash', amountPaise: 6000 },
          { method: 'upi', amountPaise: 9000 },
        ],
      }),
    ).toThrow(CounterError);

    // The cash part went in before the UPI part was refused; neither survives.
    expect(counter.account(shopId).outstandingPaise).toBe(10000);
    expect(counter.receipts(shopId)).toHaveLength(0);
  });

  it('counts a credit note against what they owe', () => {
    const sale = sell({ payPaise: 0, customerId: shopId, onCredit: true });
    const returns = new ReturnService(db);
    const returnable = returns.getReturnableSale(sale.id);

    returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Torn bag',
      refundMethod: 'cash',
      lines: [{ saleItemId: returnable.lines[0]!.saleItemId, quantityMilli: 1000, restock: true }],
    });

    expect(counter.account(shopId).outstandingPaise).toBe(0);
  });
});

describe('a shift at the till', () => {
  it('counts what the drawer should hold', () => {
    const shift = counter.openShift({ openingFloatPaise: 200000 });

    sell({ payPaise: 10000 });
    sell({ payPaise: 20000, unitPricePaise: 20000 });

    const open = counter.current()!;
    expect(open.takings.invoices).toBe(2);
    expect(open.takings.cashInPaise).toBe(30000);
    expect(open.takings.expectedPaise).toBe(230000);

    const closed = counter.closeShift({ id: shift.id, countedPaise: 229500 });
    expect(closed.expectedPaise).toBe(230000);
    expect(closed.variancePaise).toBe(-500);
    expect(closed.closedAt).not.toBeNull();
  });

  it('leaves change out of the drawer, because it never stayed', () => {
    counter.openShift({ openingFloatPaise: 0 });

    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      redeemPoints: 0,
      payments: [{ method: 'cash', amountPaise: 20000, tenderedPaise: 20000 }],
    });

    expect(counter.current()?.takings.cashInPaise).toBe(10000);
  });

  it('keeps credit out of the drawer and in its own figure', () => {
    counter.openShift({ openingFloatPaise: 0 });
    sell({ payPaise: 4000, customerId: shopId, onCredit: true });

    const open = counter.current()!;
    expect(open.takings.cashInPaise).toBe(4000);
    expect(open.takings.creditPaise).toBe(6000);
    expect(open.takings.expectedPaise).toBe(4000);
  });

  it('counts money taken against an account into the drawer', () => {
    sell({ payPaise: 0, customerId: shopId, onCredit: true });
    counter.openShift({ openingFloatPaise: 0 });
    counter.recordReceipt({ customerId: shopId, method: 'cash', amountPaise: 5000 });

    expect(counter.current()?.takings.cashInPaise).toBe(5000);
  });

  it('allows only one open shift at a time', () => {
    counter.openShift({ openingFloatPaise: 0 });
    expect(() => counter.openShift({ openingFloatPaise: 0 })).toThrow(CounterError);
  });

  it('stamps each sale with the shift it belongs to', () => {
    const shift = counter.openShift({ openingFloatPaise: 0 });
    const sale = sell({ payPaise: 10000 });

    const row = db.prepare('SELECT shift_id FROM sales WHERE id = ?').get(sale.id) as {
      shift_id: string | null;
    };
    expect(row.shift_id).toBe(shift.id);
  });

  it('sells perfectly well with no shift open', () => {
    const sale = sell({ payPaise: 10000 });
    const row = db.prepare('SELECT shift_id FROM sales WHERE id = ?').get(sale.id) as {
      shift_id: string | null;
    };
    expect(row.shift_id).toBeNull();
  });

  it('cannot be deleted', () => {
    const shift = counter.openShift({ openingFloatPaise: 0 });
    expect(() => db.prepare('DELETE FROM shifts WHERE id = ?').run(shift.id)).toThrow();
  });
});
