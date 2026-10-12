import { describe, it, expect } from 'vitest';
import { calculateBill, apportion, percentOf, type BillLineInput } from '../billing';

const line = (overrides: Partial<BillLineInput> = {}): BillLineInput => ({
  productId: 'p1',
  name: 'Item',
  sku: null,
  barcode: null,
  hsn: null,
  unitCode: 'pc',
  quantityMilli: 1000,
  unitPricePaise: 10000,
  taxRateBp: 1800,
  taxInclusive: true,
  discountPaise: 0,
  ...overrides,
});

const bill = (lines: BillLineInput[], extra: Partial<Parameters<typeof calculateBill>[0]> = {}) =>
  calculateBill({ lines, cartDiscountPaise: 0, isInterstate: false, roundTotal: false, ...extra });

describe('tax-inclusive pricing', () => {
  it('extracts tax from the price rather than adding to it', () => {
    // ₹100.00 at 18% inclusive: taxable 84.75, tax 15.25, total unchanged.
    const result = bill([line({ unitPricePaise: 10000, taxRateBp: 1800 })]);

    expect(result.taxablePaise).toBe(8475);
    expect(result.taxPaise).toBe(1525);
    expect(result.totalPaise).toBe(10000);
  });

  it('keeps the customer-facing total exactly as marked', () => {
    for (const rate of [500, 1200, 1800, 2800]) {
      const result = bill([line({ unitPricePaise: 49900, taxRateBp: rate })]);
      expect(result.totalPaise).toBe(49900);
      expect(result.taxablePaise + result.taxPaise).toBe(49900);
    }
  });

  it('scales with quantity', () => {
    const result = bill([line({ quantityMilli: 3000, unitPricePaise: 10000 })]);
    expect(result.grossPaise).toBe(30000);
    expect(result.totalPaise).toBe(30000);
  });
});

describe('tax-exclusive pricing', () => {
  it('adds tax on top of the price', () => {
    // ₹100.00 at 18% exclusive: tax 18.00, total 118.00.
    const result = bill([line({ unitPricePaise: 10000, taxRateBp: 1800, taxInclusive: false })]);

    expect(result.taxablePaise).toBe(10000);
    expect(result.taxPaise).toBe(1800);
    expect(result.totalPaise).toBe(11800);
  });

  it('matches inclusive maths in reverse', () => {
    const exclusive = bill([line({ unitPricePaise: 8475, taxRateBp: 1800, taxInclusive: false })]);
    expect(exclusive.totalPaise).toBe(10001); // 84.75 + 15.26
    const inclusive = bill([line({ unitPricePaise: 10000, taxRateBp: 1800 })]);
    expect(inclusive.taxablePaise).toBe(8475);
  });
});

describe('zero-rated and exempt items', () => {
  it('charges no tax at 0%', () => {
    const result = bill([line({ taxRateBp: 0, unitPricePaise: 5000 })]);

    expect(result.taxPaise).toBe(0);
    expect(result.taxablePaise).toBe(5000);
    expect(result.totalPaise).toBe(5000);
  });

  it('treats 0% the same whether marked inclusive or exclusive', () => {
    const inc = bill([line({ taxRateBp: 0, taxInclusive: true, unitPricePaise: 5000 })]);
    const exc = bill([line({ taxRateBp: 0, taxInclusive: false, unitPricePaise: 5000 })]);
    expect(inc.totalPaise).toBe(exc.totalPaise);
  });

  it('mixes taxed and untaxed lines correctly', () => {
    const result = bill([
      line({ taxRateBp: 0, unitPricePaise: 5000 }),
      line({ taxRateBp: 1800, unitPricePaise: 10000 }),
    ]);

    expect(result.totalPaise).toBe(15000);
    expect(result.taxPaise).toBe(1525);
    expect(result.taxBreakdown.map((b) => b.rateBp)).toEqual([0, 1800]);
  });
});

describe('discounts', () => {
  it('applies an item discount before tax', () => {
    // ₹100.00 less ₹10.00 = ₹90.00 inclusive of 18%.
    const result = bill([line({ unitPricePaise: 10000, discountPaise: 1000 })]);

    expect(result.itemDiscountPaise).toBe(1000);
    expect(result.totalPaise).toBe(9000);
    expect(result.taxablePaise + result.taxPaise).toBe(9000);
  });

  it('never discounts more than the line is worth', () => {
    const result = bill([line({ unitPricePaise: 10000, discountPaise: 99999 })]);
    expect(result.itemDiscountPaise).toBe(10000);
    expect(result.totalPaise).toBe(0);
  });

  it('apportions a cart discount across lines', () => {
    const result = bill([line({ unitPricePaise: 10000 }), line({ unitPricePaise: 30000 })], {
      cartDiscountPaise: 4000,
    });

    // Split 1:3 by value, so ₹10 and ₹30.
    expect(result.lines[0]?.totalDiscountPaise).toBe(1000);
    expect(result.lines[1]?.totalDiscountPaise).toBe(3000);
    expect(result.totalPaise).toBe(36000);
  });

  it('apportions without losing a paisa on awkward splits', () => {
    const result = bill(
      [
        line({ unitPricePaise: 10000 }),
        line({ unitPricePaise: 10000 }),
        line({ unitPricePaise: 10000 }),
      ],
      { cartDiscountPaise: 100 },
    );

    const shares = result.lines.map((l) => l.totalDiscountPaise);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(result.totalPaise).toBe(29900);
  });

  it('caps a cart discount at the cart value', () => {
    const result = bill([line({ unitPricePaise: 10000 })], { cartDiscountPaise: 999999 });
    expect(result.cartDiscountPaise).toBe(10000);
    expect(result.totalPaise).toBe(0);
  });

  it('combines item and cart discounts', () => {
    const result = bill([line({ unitPricePaise: 10000, discountPaise: 2000 })], {
      cartDiscountPaise: 1000,
    });

    expect(result.itemDiscountPaise).toBe(2000);
    expect(result.cartDiscountPaise).toBe(1000);
    expect(result.totalPaise).toBe(7000);
  });

  it('resolves a percentage exactly', () => {
    expect(percentOf(10000, 1000)).toBe(1000); // 10%
    expect(percentOf(10000, 1250)).toBe(1250); // 12.5%
    expect(percentOf(9999, 500)).toBe(500); // 5% of 99.99
  });
});

describe('CGST/SGST versus IGST', () => {
  it('splits tax in half within the state', () => {
    const result = bill([line({ unitPricePaise: 10000, taxRateBp: 1800 })]);

    expect(result.cgstPaise + result.sgstPaise).toBe(result.taxPaise);
    expect(result.igstPaise).toBe(0);
    expect(result.cgstPaise).toBe(763);
    expect(result.sgstPaise).toBe(762);
  });

  it('charges IGST across state lines', () => {
    const result = bill([line({ unitPricePaise: 10000, taxRateBp: 1800 })], { isInterstate: true });

    expect(result.igstPaise).toBe(result.taxPaise);
    expect(result.cgstPaise).toBe(0);
    expect(result.sgstPaise).toBe(0);
  });

  it('halves without losing a paisa on an odd amount', () => {
    // Tax of 15.25 cannot halve evenly; the two parts must still sum exactly.
    const result = bill([line({ unitPricePaise: 10000, taxRateBp: 1800 })]);
    expect(result.cgstPaise + result.sgstPaise).toBe(1525);
  });

  it('charges the same total either way', () => {
    const within = bill([line({ unitPricePaise: 49900, taxRateBp: 1800 })]);
    const across = bill([line({ unitPricePaise: 49900, taxRateBp: 1800 })], { isInterstate: true });
    expect(within.totalPaise).toBe(across.totalPaise);
  });
});

describe('rounding', () => {
  it('rounds the total to the nearest rupee and records the adjustment', () => {
    // 3 x ₹33.33 = ₹99.99 -> ₹100.00, adjustment +1 paisa.
    const result = bill([line({ quantityMilli: 3000, unitPricePaise: 3333, taxRateBp: 0 })], {
      roundTotal: true,
    });

    expect(result.roundOffPaise).toBe(1);
    expect(result.totalPaise).toBe(10000);
  });

  it('rounds down below half a rupee', () => {
    const result = bill([line({ unitPricePaise: 10040, taxRateBp: 0 })], { roundTotal: true });
    expect(result.roundOffPaise).toBe(-40);
    expect(result.totalPaise).toBe(10000);
  });

  it('leaves the total alone when rounding is off', () => {
    const result = bill([line({ unitPricePaise: 10040, taxRateBp: 0 })], { roundTotal: false });
    expect(result.roundOffPaise).toBe(0);
    expect(result.totalPaise).toBe(10040);
  });

  it('always reconciles: taxable + tax + round-off equals total', () => {
    for (const price of [1, 99, 3333, 49900, 123456]) {
      for (const rate of [0, 500, 1200, 1800, 2800]) {
        const result = bill([line({ unitPricePaise: price, taxRateBp: rate })], {
          roundTotal: true,
        });
        expect(result.taxablePaise + result.taxPaise + result.roundOffPaise).toBe(
          result.totalPaise,
        );
      }
    }
  });
});

describe('decimal quantities', () => {
  it('bills a fractional weight', () => {
    // 1.5 kg at ₹120.00 = ₹180.00
    const result = bill([
      line({ quantityMilli: 1500, unitPricePaise: 12000, taxRateBp: 0, unitCode: 'kg' }),
    ]);
    expect(result.totalPaise).toBe(18000);
  });

  it('rounds a fractional line to the paisa', () => {
    // 0.25 kg at ₹99.99 = ₹24.9975 -> ₹25.00
    const result = bill([
      line({ quantityMilli: 250, unitPricePaise: 9999, taxRateBp: 0, unitCode: 'kg' }),
    ]);
    expect(result.totalPaise).toBe(2500);
  });
});

describe('invariants', () => {
  it('line totals always sum to the bill total before rounding', () => {
    const result = bill(
      [
        line({ unitPricePaise: 49900, taxRateBp: 500 }),
        line({ unitPricePaise: 19900, taxRateBp: 1800, quantityMilli: 2000 }),
        line({ unitPricePaise: 5000, taxRateBp: 0 }),
      ],
      { cartDiscountPaise: 5000, roundTotal: true },
    );

    const lineSum = result.lines.reduce((a, l) => a + l.totalPaise, 0);
    expect(lineSum + result.roundOffPaise).toBe(result.totalPaise);
  });

  it('tax buckets sum to the bill tax', () => {
    const result = bill([
      line({ taxRateBp: 500, unitPricePaise: 49900 }),
      line({ taxRateBp: 1800, unitPricePaise: 19900 }),
      line({ taxRateBp: 500, unitPricePaise: 9900 }),
    ]);

    const bucketTax = result.taxBreakdown.reduce((a, b) => a + b.taxPaise, 0);
    expect(bucketTax).toBe(result.taxPaise);
    // Two distinct rates, not three lines.
    expect(result.taxBreakdown).toHaveLength(2);
  });

  it('handles an empty cart', () => {
    const result = bill([]);
    expect(result.totalPaise).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.taxBreakdown).toEqual([]);
  });

  it('never produces a negative total', () => {
    const result = bill([line({ unitPricePaise: 10000, discountPaise: 10000 })], {
      cartDiscountPaise: 5000,
    });
    expect(result.totalPaise).toBeGreaterThanOrEqual(0);
  });
});

describe('apportion', () => {
  it('splits in proportion', () => {
    expect(apportion(100, [1, 1])).toEqual([50, 50]);
    expect(apportion(100, [1, 3])).toEqual([25, 75]);
  });

  it('sums exactly despite remainders', () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [7, [1, 1, 1, 1, 1]],
      [12345, [3, 5, 7, 11]],
    ] as const) {
      const parts = apportion(total, [...weights]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('returns zeros when there is nothing to split', () => {
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(apportion(100, [0, 0])).toEqual([0, 0]);
  });
});
