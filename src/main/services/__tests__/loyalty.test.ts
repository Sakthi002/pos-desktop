import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { SettingsService } from '../settings-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { LedgerService } from '../ledger-service';
import { LoyaltyService, LoyaltyError } from '../loyalty-service';
import { defaultSettings } from '@shared/settings';
import { pointsFor } from '@shared/loyalty';
import { ACCOUNTS } from '@shared/ledger';

let db: Database;
let catalogue: CatalogueService;
let customers: CustomerService;
let sales: SaleService;
let returns: ReturnService;
let loyalty: LoyaltyService;
let riceId: string;
let customerId: string;

const EVERYTHING = { fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' };

/** A ₹1,000 bill, inclusive of 5% tax: ₹952.38 taxable. */
const sell = (options: { redeemPoints?: number; quantityMilli?: number } = {}) => {
  const quantityMilli = options.quantityMilli ?? 10000;
  const unitPricePaise = 10000;
  const service = new SaleService(db);
  const bill = service.preview({
    customerId,
    lines: [{ productId: riceId, quantityMilli, unitPricePaise, discountPaise: 0 }],
    cartDiscountPaise: 0,
    redeemPoints: options.redeemPoints ?? 0,
  });

  return service.createSale({
    idempotencyKey: randomUUID(),
    customerId,
    lines: [{ productId: riceId, quantityMilli, unitPricePaise, discountPaise: 0 }],
    cartDiscountPaise: 0,
    redeemPoints: options.redeemPoints ?? 0,
    payments: [{ method: 'cash', amountPaise: bill.totalPaise }],
  });
};

const balance = (): number => loyalty.cardFor(customerId)?.balancePoints ?? 0;

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  new SettingsService(db).update({
    loyalty: {
      enabled: true,
      pointsPerHundred: 1,
      paisePerPoint: 100,
      minimumRedeemPoints: 5,
      maxRedeemPercent: 50,
    },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 1000000,
  }).id;

  customers = new CustomerService(db);
  customerId = customers.create({ name: 'Ravi Kumar', phone: '9876543210' }).id;

  sales = new SaleService(db);
  returns = new ReturnService(db);
  loyalty = new LoyaltyService(db);
});

afterEach(() => {
  db.close();
});

describe('what a bill earns', () => {
  it('counts the bill before tax, not what the customer handed over', () => {
    loyalty.issueCard({ customerId });
    const sale = sell();

    // ₹1,000 inclusive of 5% is ₹952.38 taxable, so nine whole points.
    expect(sale.bill.taxablePaise).toBe(95238);
    expect(balance()).toBe(pointsFor(95238, 1));
    expect(balance()).toBe(9);
  });

  it('earns nothing without a card', () => {
    const sale = sell();
    expect(sale.loyalty).toBeNull();
    expect(balance()).toBe(0);
  });

  it('earns nothing while the scheme is off', () => {
    loyalty.issueCard({ customerId });
    new SettingsService(db).update({ loyalty: { enabled: false } });

    sell();
    expect(balance()).toBe(0);
  });

  it('keeps the rate the card was issued with when the shop raises its own', () => {
    loyalty.issueCard({ customerId, pointsPerHundred: 2 });
    new SettingsService(db).update({ loyalty: { pointsPerHundred: 10 } });

    sell();
    expect(balance()).toBe(19);
  });

  it('pays a card only once for the same sale', () => {
    loyalty.issueCard({ customerId });
    const key = randomUUID();
    const payload = {
      idempotencyKey: key,
      customerId,
      lines: [{ productId: riceId, quantityMilli: 10000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      redeemPoints: 0,
      payments: [{ method: 'cash', amountPaise: 100000 }],
    };

    sales.createSale(payload);
    const second = sales.createSale(payload);

    expect(second.duplicate).toBe(true);
    expect(balance()).toBe(9);
  });
});

describe('spending points', () => {
  beforeEach(() => {
    loyalty.issueCard({ customerId });
    loyalty.adjust({ customerId, points: 200, reason: 'Opening balance from the old book' });
  });

  it('comes off the bill and off the card', () => {
    const sale = sell({ redeemPoints: 50 });

    expect(sale.loyalty?.pointsRedeemed).toBe(50);
    expect(sale.loyalty?.discountPaise).toBe(5000);
    expect(sale.bill.totalPaise).toBe(95000);
    // Spent 50, earned on the smaller bill.
    expect(balance()).toBe(200 - 50 + (sale.loyalty?.pointsEarned ?? 0));
  });

  it('refuses more points than the card holds', () => {
    expect(() => sell({ redeemPoints: 500 })).toThrow(LoyaltyError);
  });

  it('refuses more than its share of the bill', () => {
    // Half of ₹1,000 is ₹500, which is 500 points — more than the cap allows
    // against this balance, and the card only holds 200 anyway.
    expect(() => sell({ redeemPoints: 200, quantityMilli: 2000 })).toThrow(LoyaltyError);
  });

  it("refuses a balance under the shop's floor", () => {
    const other = customers.create({ name: 'Meena' }).id;
    const card = loyalty.issueCard({ customerId: other });
    expect(card.balancePoints).toBe(0);

    const offer = loyalty.atTill(other, 100000);
    expect(offer.maxRedeemablePoints).toBe(0);
    expect(offer.blockedReason).toContain('5 points');
  });

  it('offers nothing on a card that has expired', () => {
    const other = customers.create({ name: 'Expired' }).id;
    const card = loyalty.issueCard({ customerId: other, expiryMonths: 1 });
    loyalty.adjust({ customerId: other, points: 100, reason: 'Test' });

    loyalty.updateCard({
      id: card.id,
      tier: 'silver',
      pointsPerHundred: 1,
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      isActive: true,
    });

    const offer = loyalty.atTill(other, 100000);
    expect(offer.blockedReason).toBe('This card has expired.');
    expect(offer.maxRedeemablePoints).toBe(0);
  });
});

describe('when goods come back', () => {
  beforeEach(() => {
    loyalty.issueCard({ customerId });
  });

  it('takes back what a voided sale earned', () => {
    const sale = sell();
    expect(balance()).toBe(9);

    sales.voidSale({ id: sale.id, reason: 'Keyed twice' });
    expect(balance()).toBe(0);
  });

  it('takes back a return in proportion to what came back', () => {
    const sale = sell({ quantityMilli: 100000 });
    const earned = balance();
    expect(earned).toBe(95);

    const returnable = returns.getReturnableSale(sale.id);
    returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Two bags torn',
      refundMethod: 'cash',
      lines: [{ saleItemId: returnable.lines[0]!.saleItemId, quantityMilli: 20000, restock: true }],
    });

    // A fifth of the bill came back, so a fifth of the points goes.
    expect(balance()).toBe(earned - 19);
  });

  it('gives spent points back when the goods are returned', () => {
    loyalty.adjust({ customerId, points: 100, reason: 'Opening' });
    const sale = sell({ redeemPoints: 50 });
    const after = balance();

    sales.voidSale({ id: sale.id, reason: 'Customer changed their mind' });

    // The 50 spent come back and what the bill earned goes away.
    expect(balance()).toBe(after + 50 - (sale.loyalty?.pointsEarned ?? 0));
    expect(balance()).toBe(100);
  });
});

describe('the books', () => {
  const balanceOf = (code: string): number => {
    const ledger = new LedgerService(db);
    return (
      ledger.trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso).find((r) => r.code === code)
        ?.balancePaise ?? 0
    );
  };

  const outOfBalance = (): number => {
    const rows = new LedgerService(db).trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
    return rows.reduce((a, r) => a + r.debitPaise, 0) - rows.reduce((a, r) => a + r.creditPaise, 0);
  };

  it('puts a correction on the books too', () => {
    loyalty.issueCard({ customerId });
    loyalty.adjust({ customerId, points: 100, reason: 'Carried over from the card book' });

    expect(balanceOf(ACCOUNTS.loyalty)).toBe(10000);
    expect(outOfBalance()).toBe(0);
  });

  it('owes the customer what their points are worth', () => {
    loyalty.issueCard({ customerId });
    sell();

    expect(balanceOf(ACCOUNTS.loyalty)).toBe(900);
    expect(balanceOf(ACCOUNTS.loyaltyCost)).toBe(900);
    expect(outOfBalance()).toBe(0);
  });

  it('unwinds the liability when points are spent', () => {
    loyalty.issueCard({ customerId });
    loyalty.adjust({ customerId, points: 100, reason: 'Opening' });
    sell({ redeemPoints: 50 });

    // Every point on the card is on the books, including the ones put there
    // by hand: a correction posts its own journal voucher.
    const card = loyalty.cardFor(customerId)!;
    expect(balanceOf(ACCOUNTS.loyalty)).toBe(card.balancePoints * 100);
    expect(outOfBalance()).toBe(0);
  });

  it('stays in balance through a sale, a redemption and a void', () => {
    loyalty.issueCard({ customerId });
    loyalty.adjust({ customerId, points: 100, reason: 'Opening' });
    const sale = sell({ redeemPoints: 50 });
    sales.voidSale({ id: sale.id, reason: 'Returned at once' });

    expect(outOfBalance()).toBe(0);
  });

  it('reports what the shop owes in points', () => {
    loyalty.issueCard({ customerId });
    sell();

    expect(loyalty.liability()).toEqual({ points: 9, paise: 900 });
  });
});

describe('the cards themselves', () => {
  it('numbers them in a series, and refuses a second for one customer', () => {
    const first = loyalty.issueCard({ customerId });
    expect(first.cardNumber).toBe('1001');

    const other = customers.create({ name: 'Meena' }).id;
    expect(loyalty.issueCard({ customerId: other }).cardNumber).toBe('1002');

    expect(() => loyalty.issueCard({ customerId })).toThrow(LoyaltyError);
  });

  it('will not give a card to the walk-in customer', () => {
    const walkIn = customers.walkIn();
    expect(walkIn).not.toBeNull();
    expect(() => loyalty.issueCard({ customerId: walkIn!.id })).toThrow(LoyaltyError);
  });

  it('refuses a correction that would take the balance below zero', () => {
    loyalty.issueCard({ customerId });
    expect(() => loyalty.adjust({ customerId, points: -10, reason: 'Wrong' })).toThrow(
      LoyaltyError,
    );
  });

  it('cannot have an entry edited or deleted', () => {
    loyalty.issueCard({ customerId });
    sell();
    const row = db.prepare('SELECT id FROM loyalty_transactions LIMIT 1').get() as { id: string };

    expect(() =>
      db.prepare('UPDATE loyalty_transactions SET points = 999 WHERE id = ?').run(row.id),
    ).toThrow();
    expect(() => db.prepare('DELETE FROM loyalty_transactions WHERE id = ?').run(row.id)).toThrow();
  });
});
