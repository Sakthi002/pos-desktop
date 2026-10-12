/**
 * Sale domain: what the POS submits at checkout, and what comes back.
 */
import { z } from 'zod';
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
