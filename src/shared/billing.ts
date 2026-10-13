/**
 * The authoritative bill calculation.
 *
 * This is the only place tax, discount and rounding are computed. The POS
 * screen, the stored sale, the receipt and any future PDF all call this, so a
 * total can never differ between what the customer was shown, what was saved
 * and what was printed.
 *
 * Documented rules, in the order they are applied:
 *
 *   1. Line gross     = quantity x unit price, rounded to the paisa.
 *   2. Item discount  subtracted from the line.
 *   3. Cart discount  apportioned across lines in proportion to their value
 *                     after step 2, so each line's tax reflects what was
 *                     actually charged for it. Apportioning sums exactly: any
 *                     remainder paise go to the earliest lines.
 *   4. Tax            computed per line on the discounted amount.
 *                       inclusive: taxable = net x 10000 / (10000 + rate)
 *                       exclusive: taxable = net, tax = net x rate / 10000
 *   5. CGST/SGST      half each for an intra-state sale, split so the two
 *                     halves sum exactly to the tax. IGST carries the whole
 *                     amount for an inter-state sale.
 *   6. Round-off      the invoice total to the nearest rupee when enabled,
 *                     recorded as its own figure so the bill reconciles.
 *
 * Rounding is half away from zero at every step. Every amount is integer paise.
 */
import { extendPrice } from './quantity';
import { roundToRupee } from './money';

export interface BillLineInput {
  productId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unitCode: string;
  quantityMilli: number;
  unitPricePaise: number;
  taxRateBp: number;
  taxInclusive: boolean;
  /** Item-level discount in paise, already resolved from any percentage. */
  discountPaise: number;
}

export interface BillInput {
  lines: BillLineInput[];
  /** Whole-cart discount in paise, apportioned across lines. */
  cartDiscountPaise: number;
  /** Customer state differs from the branch state. */
  isInterstate: boolean;
  roundTotal: boolean;
}

export interface BillLine extends BillLineInput {
  lineNo: number;
  grossPaise: number;
  /** Item discount plus this line's share of the cart discount. */
  totalDiscountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface TaxBucket {
  rateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
}

export interface Bill {
  lines: BillLine[];
  grossPaise: number;
  itemDiscountPaise: number;
  cartDiscountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  /** What the customer pays. */
  totalPaise: number;
  /** Per-rate summary for the GST section of an invoice. */
  taxBreakdown: TaxBucket[];
  isInterstate: boolean;
  /**
   * The part of the cart discount that loyalty points paid for. Set by the
   * sale service, not by the calculation: to the arithmetic it is a discount
   * like any other, and only the till and the receipt care where it came from.
   */
  loyaltyDiscountPaise?: number;
}

/**
 * Distributes `total` across `weights` in proportion, summing to exactly
 * `total`. Largest-remainder, so the leftover paise land on the lines with the
 * biggest fractional claim rather than always on the first.
 */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] as number) + 1;
    remainder -= 1;
  }
  return result;
}

/** Splits tax into CGST and SGST halves that sum exactly to the original. */
function halve(tax: number): { cgst: number; sgst: number } {
  const cgst = Math.round(tax / 2);
  return { cgst, sgst: tax - cgst };
}

export function calculateBill(input: BillInput): Bill {
  const lines = input.lines;

  // Steps 1 and 2: gross, then item discount.
  const gross = lines.map((l) => extendPrice(l.quantityMilli, l.unitPricePaise));
  const itemDiscounts = lines.map((l, i) => Math.min(l.discountPaise, gross[i] as number));
  const afterItem = gross.map((g, i) => g - (itemDiscounts[i] as number));

  // Step 3: apportion the cart discount, never beyond what is left to discount.
  const cartDiscountTotal = Math.min(
    Math.max(0, input.cartDiscountPaise),
    afterItem.reduce((a, b) => a + b, 0),
  );
  const cartShares = apportion(cartDiscountTotal, afterItem);

  const computed: BillLine[] = lines.map((line, i) => {
    const net = (afterItem[i] as number) - (cartShares[i] as number);

    // Steps 4 and 5.
    let taxable: number;
    let tax: number;
    if (line.taxRateBp === 0) {
      // Zero-rated or exempt: nothing to split out either way.
      taxable = net;
      tax = 0;
    } else if (line.taxInclusive) {
      taxable = Math.round((net * 10000) / (10000 + line.taxRateBp));
      tax = net - taxable;
    } else {
      taxable = net;
      tax = Math.round((net * line.taxRateBp) / 10000);
    }

    const { cgst, sgst } = input.isInterstate ? { cgst: 0, sgst: 0 } : halve(tax);
    const igst = input.isInterstate ? tax : 0;

    return {
      ...line,
      lineNo: i + 1,
      grossPaise: gross[i] as number,
      totalDiscountPaise: (itemDiscounts[i] as number) + (cartShares[i] as number),
      taxablePaise: taxable,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      taxPaise: tax,
      totalPaise: taxable + tax,
    };
  });

  const sum = (pick: (l: BillLine) => number): number =>
    computed.reduce((acc, l) => acc + pick(l), 0);

  const taxablePaise = sum((l) => l.taxablePaise);
  const taxPaise = sum((l) => l.taxPaise);
  const beforeRounding = taxablePaise + taxPaise;

  const { rounded, adjustment } = input.roundTotal
    ? roundToRupee(beforeRounding)
    : { rounded: beforeRounding, adjustment: 0 };

  // Per-rate buckets for the invoice's GST summary.
  const buckets = new Map<number, TaxBucket>();
  for (const line of computed) {
    const existing = buckets.get(line.taxRateBp) ?? {
      rateBp: line.taxRateBp,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
    };
    existing.taxablePaise += line.taxablePaise;
    existing.cgstPaise += line.cgstPaise;
    existing.sgstPaise += line.sgstPaise;
    existing.igstPaise += line.igstPaise;
    existing.taxPaise += line.taxPaise;
    buckets.set(line.taxRateBp, existing);
  }

  return {
    lines: computed,
    grossPaise: gross.reduce((a, b) => a + b, 0),
    itemDiscountPaise: itemDiscounts.reduce((a, b) => a + b, 0),
    cartDiscountPaise: cartDiscountTotal,
    taxablePaise,
    cgstPaise: sum((l) => l.cgstPaise),
    sgstPaise: sum((l) => l.sgstPaise),
    igstPaise: sum((l) => l.igstPaise),
    taxPaise,
    roundOffPaise: adjustment,
    totalPaise: rounded,
    taxBreakdown: [...buckets.values()].sort((a, b) => a.rateBp - b.rateBp),
    isInterstate: input.isInterstate,
  };
}

/**
 * Resolves a percentage discount to paise. Percent is in basis points so a
 * 12.5% discount is exact rather than a float.
 */
export const percentOf = (amountPaise: number, percentBp: number): number =>
  Math.round((amountPaise * percentBp) / 10000);
