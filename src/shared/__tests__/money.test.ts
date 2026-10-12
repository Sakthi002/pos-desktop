import { describe, it, expect } from 'vitest';
import { parseRupees, paiseToDecimalString, formatPaise, roundToRupee, splitPaise } from '../money';

describe('parseRupees', () => {
  it('parses whole and decimal amounts', () => {
    expect(parseRupees('20')).toBe(2000);
    expect(parseRupees('19.99')).toBe(1999);
    expect(parseRupees('0.05')).toBe(5);
    expect(parseRupees('0.5')).toBe(50);
    expect(parseRupees('.5')).toBe(50);
  });

  it('strips thousands separators and whitespace', () => {
    expect(parseRupees(' 1,234.50 ')).toBe(123450);
    expect(parseRupees('12,34,567.89')).toBe(123456789);
  });

  it('avoids the float rounding trap', () => {
    // Number('1.005') * 100 is 100.49999999999999, which rounds down to 100.
    // Parsing from the string gives the expected 101.
    expect(parseRupees('1.005')).toBeNull(); // three decimals: a typo, rejected
    expect(parseRupees('1.01')).toBe(101);
    expect(parseRupees('8.07')).toBe(807);
    expect(parseRupees('1.10')).toBe(110);
  });

  it('rejects malformed input', () => {
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('1.2.3')).toBeNull();
    expect(parseRupees('10.123')).toBeNull();
    expect(parseRupees('₹10')).toBeNull();
  });

  it('handles negatives', () => {
    expect(parseRupees('-19.99')).toBe(-1999);
  });

  it('round-trips through the decimal string', () => {
    for (const value of ['0.01', '1.00', '19.99', '1234.50', '99999.99']) {
      const paise = parseRupees(value);
      expect(paise).not.toBeNull();
      expect(paiseToDecimalString(paise as number)).toBe(Number(value).toFixed(2));
    }
  });
});

describe('formatPaise', () => {
  it('uses Indian digit grouping', () => {
    expect(formatPaise(100)).toBe('₹1.00');
    expect(formatPaise(123450)).toBe('₹1,234.50');
    expect(formatPaise(12345678)).toBe('₹1,23,456.78');
    expect(formatPaise(123456789)).toBe('₹12,34,567.89');
  });

  it('pads the paise and handles zero and negatives', () => {
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(-123450)).toBe('-₹1,234.50');
  });

  it('can omit the symbol', () => {
    expect(formatPaise(123450, false)).toBe('1,234.50');
  });
});

describe('roundToRupee', () => {
  it('rounds half away from zero and reports the adjustment', () => {
    expect(roundToRupee(12345)).toEqual({ rounded: 12300, adjustment: -45 });
    expect(roundToRupee(12350)).toEqual({ rounded: 12400, adjustment: 50 });
    expect(roundToRupee(12399)).toEqual({ rounded: 12400, adjustment: 1 });
  });

  it('leaves exact rupees alone', () => {
    expect(roundToRupee(12300)).toEqual({ rounded: 12300, adjustment: 0 });
    expect(roundToRupee(0)).toEqual({ rounded: 0, adjustment: 0 });
  });

  it('keeps the adjustment consistent for negatives', () => {
    const { rounded, adjustment } = roundToRupee(-12345);
    expect(rounded).toBe(-12300);
    expect(rounded - adjustment).toBe(-12345);
  });

  it('always reconciles: original + adjustment equals rounded', () => {
    for (const value of [1, 49, 50, 51, 99, 100, 12345, 99999]) {
      const { rounded, adjustment } = roundToRupee(value);
      expect(value + adjustment).toBe(rounded);
      expect(rounded % 100).toBe(0);
    }
  });
});

describe('splitPaise', () => {
  it('splits evenly when it divides', () => {
    expect(splitPaise(300, 3)).toEqual([100, 100, 100]);
  });

  it('never loses a paisa to rounding', () => {
    const parts = splitPaise(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('sums back to the original for awkward amounts', () => {
    for (const [total, parts] of [
      [1, 3],
      [1000, 7],
      [12345, 11],
      [99999, 13],
    ] as const) {
      const shares = splitPaise(total, parts);
      expect(shares).toHaveLength(parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});
