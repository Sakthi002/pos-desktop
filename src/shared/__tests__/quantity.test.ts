import { describe, it, expect } from 'vitest';
import { parseQuantity, formatQuantity, extendPrice, precisionFor } from '../quantity';

describe('parseQuantity', () => {
  it('parses whole units', () => {
    expect(parseQuantity('3', 0)).toBe(3000);
    expect(parseQuantity('1', 3)).toBe(1000);
  });

  it('parses fractional units where the unit allows it', () => {
    expect(parseQuantity('1.5', 3)).toBe(1500);
    expect(parseQuantity('0.25', 3)).toBe(250);
    expect(parseQuantity('2.125', 3)).toBe(2125);
  });

  it('refuses fractions of a whole-unit product', () => {
    // Half a piece is not a thing a shop can sell.
    expect(parseQuantity('0.5', 0)).toBeNull();
    expect(parseQuantity('1.5', 0)).toBeNull();
  });

  it('refuses more precision than the unit permits', () => {
    expect(parseQuantity('1.5555', 3)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseQuantity('', 3)).toBeNull();
    expect(parseQuantity('abc', 3)).toBeNull();
    expect(parseQuantity('-1', 3)).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('drops trailing zeros', () => {
    expect(formatQuantity(1500, 3)).toBe('1.5');
    expect(formatQuantity(1000, 3)).toBe('1');
    expect(formatQuantity(2125, 3)).toBe('2.125');
  });

  it('shows whole units without a decimal point', () => {
    expect(formatQuantity(3000, 0)).toBe('3');
  });

  it('round-trips with parseQuantity', () => {
    for (const text of ['1', '1.5', '0.25', '12.125', '100']) {
      const milli = parseQuantity(text, 3);
      expect(milli).not.toBeNull();
      expect(formatQuantity(milli as number, 3)).toBe(text);
    }
  });
});

describe('extendPrice', () => {
  it('multiplies whole quantities exactly', () => {
    expect(extendPrice(3000, 1999)).toBe(5997);
    expect(extendPrice(1000, 9900)).toBe(9900);
  });

  it('handles fractional quantities', () => {
    // 1.5 kg at ₹120.00 = ₹180.00
    expect(extendPrice(1500, 12000)).toBe(18000);
    // 0.25 kg at ₹99.99 = ₹24.9975 -> 2500 paise
    expect(extendPrice(250, 9999)).toBe(2500);
  });

  it('rounds half away from zero at the paisa', () => {
    // 0.5 units at 5 paise = 2.5 paise -> 3
    expect(extendPrice(500, 5)).toBe(3);
  });

  it('returns zero for a zero quantity or price', () => {
    expect(extendPrice(0, 9999)).toBe(0);
    expect(extendPrice(1000, 0)).toBe(0);
  });
});

describe('unit precision', () => {
  it('matches the seeded units table', () => {
    expect(precisionFor('pc')).toBe(0);
    expect(precisionFor('box')).toBe(0);
    expect(precisionFor('kg')).toBe(3);
    expect(precisionFor('l')).toBe(3);
    expect(precisionFor('m')).toBe(3);
  });

  it('falls back to whole units for an unknown code', () => {
    expect(precisionFor('unknown')).toBe(0);
  });
});
