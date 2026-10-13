/**
 * Sale domain: what the POS submits at checkout, and what comes back.
 */
import { z } from 'zod';
import { approvalSchema } from './auth';
import type { Bill } from './billing';

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const saleLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Quantity must be greater than zero'),
  /** Allows a price override at the till; tax rate and HSN always come from the product. */
  unitPricePaise: z.number().int().min(0),
  discountPaise: z.number().int().min(0).default(0),
});

export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountPaise: z.number().int().positive('Payment amount must be greater than zero'),
  /** Cash handed over, so change can be recorded. */
  tenderedPaise: z.number().int().min(0).nullable().optional(),
  reference: z.string().trim().max(60).nullable().optional(),
});

export const saleInputSchema = z.object({
  /** Generated when checkout starts; makes a retry safe. */
  idempotencyKey: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  lines: z.array(saleLineInputSchema).min(1, 'Add at least one item'),
  cartDiscountPaise: z.number().int().min(0).default(0),
  payments: z.array(paymentInputSchema).min(1, 'Record at least one payment'),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type SaleLineInput = z.infer<typeof saleLineInputSchema>;
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type SaleInput = z.infer<typeof saleInputSchema>;

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amountPaise: number;
  tenderedPaise: number | null;
  changePaise: number | null;
  reference: string | null;
}

export interface SaleReceipt {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  financialYear: string;
  customerId: string | null;
  customerName: string | null;
  customerGstin: string | null;
  /** The computed bill, exactly as stored. */
  bill: Bill;
  payments: SalePayment[];
  changePaise: number;
  notes: string | null;
  status: SaleStatus;
  voidedAt: string | null;
  voidReason: string | null;
  /** True when an identical submission had already been committed. */
  duplicate: boolean;
}

/** Preview request: same shape as a sale, without payments. */
export const billPreviewSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  lines: z.array(saleLineInputSchema),
  cartDiscountPaise: z.number().int().min(0).default(0),
});

export type BillPreviewInput = z.infer<typeof billPreviewSchema>;

// ─── Sales history ──────────────────────────────────────────────────────────

export const SALE_STATUSES = ['completed', 'voided'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/**
 * History query.
 *
 * The date bounds are instants, not calendar days: the renderer turns the
 * operator's local day into UTC before asking, so "today" means the shop's
 * today whatever the machine's timezone, and the comparison stays a plain
 * string comparison against the stored ISO timestamp.
 */
export const saleQuerySchema = z.object({
  /** Invoice number, customer name or customer phone. */
  search: z.string().trim().max(100).default(''),
  fromIso: z.iso.datetime().nullable().optional(),
  toIso: z.iso.datetime().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  /** Invoices billed to one customer, for their purchase history. */
  customerId: z.string().uuid().nullable().optional(),
  status: z.enum(['all', ...SALE_STATUSES]).default('all'),
  sort: z.enum(['date', 'invoice', 'total']).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type SaleQuery = z.infer<typeof saleQuerySchema>;

/** One row of the invoice list. Totals come from the stored sale, never recomputed. */
export interface SaleSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
  totalPaise: number;
  /** Credited back by returns against this invoice; zero for most sales. */
  returnedPaise: number;
  status: SaleStatus;
  paymentMethods: PaymentMethod[];
  voidedAt: string | null;
  voidReason: string | null;
}

export interface SalePage {
  items: SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Across the whole filtered set, not just this page. Voided sales count for nothing. */
  completedCount: number;
  completedTotalPaise: number;
  voidedCount: number;
  /** Returned against the sales in this filtered set. */
  returnedTotalPaise: number;
}

export const voidSaleSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason for the void').max(200),
  /** A manager's credentials, when the shop asks for approval above a value. */
  approval: approvalSchema.optional(),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;
