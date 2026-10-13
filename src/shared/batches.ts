import { z } from 'zod';

/**
 * Batches: a quantity of one product that arrived together and goes out of
 * date together.
 *
 * A date here is a day, not an instant. An expiry is printed on a packet as a
 * date and means the end of that day wherever the shop is, so it is stored as
 * YYYY-MM-DD and compared as a string.
 */

export const VALUATION_METHODS = ['fifo', 'lifo', 'average'] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

export const VALUATION_LABELS: Record<ValuationMethod, string> = {
  fifo: 'Oldest stock first (FIFO)',
  lifo: 'Newest stock first (LIFO)',
  average: 'Average cost',
};

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-13')
  .max(10);

export const batchInputSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().trim().min(1, 'A batch needs a number').max(40),
  manufacturedOn: z.union([dayString, z.null()]).optional(),
  expiresOn: z.union([dayString, z.null()]).optional(),
  costPaise: z.number().int().min(0).optional(),
  mrpPaise: z.union([z.number().int().min(0), z.null()]).optional(),
});

export type BatchInput = z.infer<typeof batchInputSchema>;

export const batchQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  /** Only batches still holding stock. */
  inStockOnly: z.boolean().default(true),
  /** Days ahead to count as expiring soon; 0 means expired already. */
  withinDays: z.number().int().min(0).max(3650).optional(),
});

export type BatchQuery = z.infer<typeof batchQuerySchema>;

export interface Batch {
  id: string;
  productId: string;
  productName: string;
  unitCode: string;
  batchNumber: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  costPaise: number;
  mrpPaise: number | null;
  /** Summed from the movements carrying this batch. */
  balanceMilli: number;
  /** Negative once the day has passed; null when the batch never expires. */
  daysToExpiry: number | null;
  isExpired: boolean;
}

/** The day a shop is having, as YYYY-MM-DD in local time. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from today to a date, negative once it has passed. */
export function daysUntil(day: string, from: string = today()): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = day.split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return 0;
  const start = Date.UTC(ay, am - 1, ad);
  const end = Date.UTC(by, bm - 1, bd);
  return Math.round((end - start) / 86_400_000);
}

/** A batch is expired from the day after the date printed on it. */
export function isExpired(expiresOn: string | null, on: string = today()): boolean {
  return expiresOn !== null && expiresOn < on;
}
