/**
 * Money handling.
 *
 * Amounts are integer paise everywhere — in the database, in services, in IPC
 * payloads. Rupees exist only at the display edge. Binary floating point never
 * touches a stored amount, because 0.1 + 0.2 is not 0.3 and an invoice that is
 * off by a paisa is a real problem for a shop at audit time.
 */

export type Paise = number;

const PAISE_PER_RUPEE = 100;

/**
 * Parses operator input such as "19.99", "1,234.50" or "20" into paise.
 *
 * Parsed from the string rather than via `Number(x) * 100`, which mis-rounds:
 * `1.005 * 100` is 100.49999999999999, so `Math.round` yields 100 rather than
 * the 101 a person typing "1.005" would expect.
 *
 * Returns null when the input is not a valid amount.
 */
export function parseRupees(input: string): Paise | null {
  const cleaned = input.trim().replace(/,/g, '');
  if (cleaned === '') return null;

  const match = /^(-)?(\d*)(?:\.(\d{0,}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = '', fraction] = match;
  if (whole === '' && (fraction === undefined || fraction === '')) return null;
  // More than two decimals is a typo, not a rounding question.
  if (fraction !== undefined && fraction.length > 2) return null;

  const rupees = whole === '' ? 0 : Number.parseInt(whole, 10);
  const paise =
    fraction === undefined || fraction === '' ? 0 : Number.parseInt(fraction.padEnd(2, '0'), 10);

  if (!Number.isSafeInteger(rupees)) return null;

  const total = rupees * PAISE_PER_RUPEE + paise;
  return sign === '-' ? -total : total;
}

/** Decimal rupees, for display only. Never store or compute with this. */
export const paiseToRupees = (paise: Paise): number => paise / PAISE_PER_RUPEE;

/** Plain decimal string, e.g. 199950 -> "1999.50". Used in CSV and inputs. */
export function paiseToDecimalString(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = abs % PAISE_PER_RUPEE;
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Indian digit grouping with a rupee sign, e.g. 123456789 -> "₹12,34,567.89". */
export function formatPaise(paise: Paise, withSymbol = true): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = String(abs % PAISE_PER_RUPEE).padStart(2, '0');

  const digits = String(whole);
  // Indian grouping: last three digits, then pairs.
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }

  return `${negative ? '-' : ''}${withSymbol ? '₹' : ''}${grouped}.${fraction}`;
}

/**
 * Rounds to whole rupees, half away from zero, and returns the adjustment.
 * The adjustment is shown as its own invoice line so the total reconciles.
 */
export function roundToRupee(paise: Paise): { rounded: Paise; adjustment: Paise } {
  const remainder = paise % PAISE_PER_RUPEE;
  if (remainder === 0) return { rounded: paise, adjustment: 0 };

  const absRemainder = Math.abs(remainder);
  const roundUp = absRemainder >= 50;
  const sign = paise < 0 ? -1 : 1;
  const rounded = roundUp
    ? paise + sign * (PAISE_PER_RUPEE - absRemainder)
    : paise - sign * absRemainder;

  return { rounded, adjustment: rounded - paise };
}

/**
 * Splits an amount into `parts` shares that sum exactly to the original.
 * Remainder paise go to the earliest shares, so nothing is lost to rounding.
 */
export function splitPaise(paise: Paise, parts: number): Paise[] {
  if (parts < 1) throw new Error('parts must be at least 1');
  const base = Math.trunc(paise / parts);
  const remainder = paise - base * parts;
  return Array.from(
    { length: parts },
    (_, i) => base + (i < Math.abs(remainder) ? Math.sign(remainder) : 0),
  );
}
