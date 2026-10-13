import { z } from 'zod';
import { PRICE_LEVELS, type PriceLevel } from './trade';
import type { Bill } from './billing';

/**
 * A quotation: a price put in writing before anything is sold.
 *
 * It is deliberately not a draft sale. It moves no stock, takes no money and
 * posts nothing to the books, and it keeps its own numbering so it can never
 * take a number out of the invoice series — that series has to run unbroken
 * for GST, and a price nobody accepted would put a hole in it.
 */

export const quotationLineSchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Quantity must be greater than zero'),
  unitPricePaise: z.number().int().min(0),
  discountPaise: z.number().int().min(0).default(0),
});

export const quotationInputSchema = z.object({
  /** Generated when the form opens; makes a retry safe. */
  idempotencyKey: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  lines: z.array(quotationLineSchema).min(1, 'Add at least one item'),
  cartDiscountPaise: z.number().int().min(0).default(0),
  priceLevel: z.enum(PRICE_LEVELS).default('retail'),
  /** Days the price holds for. Null never expires. */
  validDays: z.number().int().min(1).max(365).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  terms: z.string().trim().max(1000).nullable().optional(),
});

export const quotationQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'open', 'converted', 'cancelled', 'expired']).default('all'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(200).default(25),
});

export const cancelQuotationSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason').max(200),
});

export type QuotationInput = z.infer<typeof quotationInputSchema>;
export type QuotationQuery = z.infer<typeof quotationQuerySchema>;

/** Open until something happens to it; expiry is read from the date. */
export type QuotationStatus = 'open' | 'expired' | 'converted' | 'cancelled';

export interface QuotationSummary {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  customerName: string | null;
  priceLevel: PriceLevel;
  items: number;
  totalPaise: number;
  status: QuotationStatus;
  convertedSaleId: string | null;
  convertedInvoiceNumber: string | null;
}

export interface Quotation extends QuotationSummary {
  customerId: string | null;
  customerGstin: string | null;
  notes: string | null;
  terms: string | null;
  cancelReason: string | null;
  /** The priced document, in the same shape a bill takes at the till. */
  bill: Bill;
}

export interface QuotationPage {
  items: QuotationSummary[];
  total: number;
  page: number;
  pageSize: number;
  openCount: number;
  openValuePaise: number;
}

/**
 * What a quotation is today. Stored status wins — an accepted or cancelled one
 * cannot un-happen — and an open one past its date has simply expired.
 */
export function statusOf(
  stored: 'open' | 'converted' | 'cancelled',
  validUntil: string | null,
  now: Date = new Date(),
): QuotationStatus {
  if (stored !== 'open') return stored;
  if (validUntil && new Date(validUntil).getTime() < now.getTime()) return 'expired';
  return 'open';
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  open: 'Open',
  expired: 'Expired',
  converted: 'Billed',
  cancelled: 'Cancelled',
};
