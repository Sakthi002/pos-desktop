import { z } from 'zod';
// Type-only, deliberately: sale.ts imports the price levels from here, and a
// value import would close the circle and leave one of them undefined at load.
import type { PaymentMethod } from './sale';

/**
 * Trade terms: what a customer is charged, and what they are allowed to owe.
 */

export const PRICE_LEVELS = ['retail', 'wholesale', 'special'] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];

export const PRICE_LEVEL_LABELS: Record<PriceLevel, string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  special: 'Special',
};

/**
 * The price for a level, falling back to retail. A shop that has not set a
 * wholesale price has not promised one, so retail is what it charges.
 */
export function priceAt(
  level: PriceLevel,
  prices: {
    pricePaise: number;
    wholesalePricePaise?: number | null;
    specialPricePaise?: number | null;
  },
): number {
  if (level === 'wholesale') return prices.wholesalePricePaise ?? prices.pricePaise;
  if (level === 'special') return prices.specialPricePaise ?? prices.pricePaise;
  return prices.pricePaise;
}

/** The same list as PAYMENT_METHODS; the type check keeps the two in step. */
const RECEIPT_METHODS = [
  'cash',
  'upi',
  'card',
  'bank',
  'other',
] as const satisfies readonly PaymentMethod[];

export const customerReceiptSchema = z.object({
  customerId: z.string().uuid(),
  /** Null settles the account rather than one bill. */
  saleId: z.string().uuid().nullable().optional(),
  method: z.enum(RECEIPT_METHODS),
  amountPaise: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter an amount'),
  reference: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
});

export type CustomerReceiptInput = z.infer<typeof customerReceiptSchema>;

/**
 * One payment made in more than one form: half in cash and half by UPI is how
 * a customer settles what they owe, and it is one visit, not two. Each part is
 * written as its own receipt, so the books and the drawer see what they always
 * saw, but they go in together or not at all.
 */
export const customerReceiptSplitSchema = z.object({
  customerId: z.string().uuid(),
  /** Null settles the account rather than one bill. */
  saleId: z.string().uuid().nullable().optional(),
  parts: z
    .array(
      z.object({
        method: z.enum(RECEIPT_METHODS),
        amountPaise: z.number().int().positive('Enter an amount'),
        reference: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .min(1, 'Enter at least one amount')
    .max(RECEIPT_METHODS.length),
});

export type CustomerReceiptSplitInput = z.infer<typeof customerReceiptSplitSchema>;

export interface CustomerReceipt {
  id: string;
  customerId: string;
  saleId: string | null;
  invoiceNumber: string | null;
  receiptDate: string;
  method: string;
  amountPaise: number;
  reference: string | null;
  notes: string | null;
}

/** What a customer owes, and the bills it is sitting on. */
export interface CustomerAccount {
  customerId: string;
  customerName: string;
  creditLimitPaise: number;
  /** Billed on credit, less credit notes, less what has been received. */
  outstandingPaise: number;
  /** What is left before the limit stops a sale. Null when there is no limit. */
  availablePaise: number | null;
  bills: {
    saleId: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalPaise: number;
    creditPaise: number;
    outstandingPaise: number;
  }[];
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

export const openShiftSchema = z.object({
  openingFloatPaise: z.number().int().min(0).default(0),
  notes: z.string().trim().max(200).nullable().optional(),
});

export const closeShiftSchema = z.object({
  id: z.string().uuid(),
  countedPaise: z.number().int().min(0),
  notes: z.string().trim().max(200).nullable().optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

/** The cash side of a session at the till, as counted and as computed. */
export interface Shift {
  id: string;
  openedAt: string;
  openedByName: string | null;
  openingFloatPaise: number;
  closedAt: string | null;
  closedByName: string | null;
  countedPaise: number | null;
  expectedPaise: number | null;
  variancePaise: number | null;
  notes: string | null;
  /** Live figures while the shift is open; as at closing once it is closed. */
  takings: ShiftTakings;
}

export interface ShiftTakings {
  invoices: number;
  cashInPaise: number;
  cashRefundedPaise: number;
  cashPaidOutPaise: number;
  cardPaise: number;
  upiPaise: number;
  bankPaise: number;
  creditPaise: number;
  /** Float plus cash in, less refunds and anything paid out of the drawer. */
  expectedPaise: number;
}
