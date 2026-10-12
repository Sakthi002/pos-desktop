/**
 * Quantity handling.
 *
 * Quantities are integer thousandths ("milli"), so 1.5 kg is 1500 and 3 pieces
 * is 3000. Unit precision decides what a person may type: a piece cannot be
 * sold in fractions, a kilogram can.
 */

export type Milli = number;

const MILLI_PER_UNIT = 1000;

/** Decimal places permitted per unit code, matching the seeded `units` table. */
export const UNIT_PRECISION: Record<string, number> = {
  pc: 0,
  box: 0,
  pack: 0,
  dz: 0,
  g: 0,
  ml: 0,
  kg: 3,
  l: 3,
  m: 3,
};

export const precisionFor = (unitCode: string): number => UNIT_PRECISION[unitCode] ?? 0;

/**
 * Parses "1.5" into 1500. Returns null when the input is invalid or has more
 * decimals than the unit allows — a shop selling by the piece should not be
 * able to ring up 0.5 of one.
 */
export function parseQuantity(input: string, decimalPlaces: number): Milli | null {
  const cleaned = input.trim().replace(/,/g, '');
  if (cleaned === '') return null;

  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, whole = '', fraction] = match;
  if (whole === '' && (fraction === undefined || fraction === '')) return null;
  if (fraction !== undefined && fraction.length > decimalPlaces) return null;

  const units = whole === '' ? 0 : Number.parseInt(whole, 10);
  if (!Number.isSafeInteger(units)) return null;

  const fractionMilli =
    fraction === undefined || fraction === ''
      ? 0
      : Number.parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);

  return units * MILLI_PER_UNIT + fractionMilli;
}

/** Formats 1500 as "1.5" for a kg, or "2" for 2000 pieces. */
export function formatQuantity(milli: Milli, decimalPlaces: number): string {
  const negative = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / MILLI_PER_UNIT);

  if (decimalPlaces === 0) return `${negative ? '-' : ''}${whole}`;

  const fraction = String(abs % MILLI_PER_UNIT)
    .padStart(3, '0')
    .slice(0, decimalPlaces)
    .replace(/0+$/, '');

  return fraction === ''
    ? `${negative ? '-' : ''}${whole}`
    : `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Whole units as a number. Display only. */
export const milliToUnits = (milli: Milli): number => milli / MILLI_PER_UNIT;

export const unitsToMilli = (units: number): Milli => Math.round(units * MILLI_PER_UNIT);

/** Line amount in paise for a quantity at a unit price. Exact: no float. */
export function extendPrice(quantityMilli: Milli, unitPricePaise: number): number {
  // (qty/1000) * price, rounded half away from zero at the paisa.
  const product = quantityMilli * unitPricePaise;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(product) / MILLI_PER_UNIT);
}
