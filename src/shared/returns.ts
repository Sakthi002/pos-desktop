/**
 * Sales returns.
 *
 * A return is a credit note against one invoice. It never stands alone: every
 * returned line points at the sale line it came from, so the quantity can be
 * capped at what was actually sold and the tax can be reversed under the exact
 * heads the invoice charged.
 */
import { z } from 'zod';
import { approvalSchema } from './auth';
import { PAYMENT_METHODS, type PaymentMethod } from './sale';

export const returnLineInputSchema = z.object({
  saleItemId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Enter a quantity to return'),
  /** Goods fit to sell again go back on the shelf; damaged goods do not. */
  restock: z.boolean().default(false),
});

export const returnInputSchema = z.object({
  /** Generated when the return dialog opens; makes a retry safe. */
  idempotencyKey: z.string().uuid(),
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason for the return').max(200),
  refundMethod: z.enum(PAYMENT_METHODS),
  lines: z.array(returnLineInputSchema).min(1, 'Choose at least one item to return'),
  /** A manager's credentials, when the shop asks for approval above a value. */
  approval: approvalSchema.optional(),
});

export type ReturnLineInput = z.infer<typeof returnLineInputSchema>;
export type ReturnInput = z.infer<typeof returnInputSchema>;

/** One line of the original invoice, with what is still returnable on it. */
export interface ReturnableLine {
  saleItemId: string;
  productId: string | null;
  name: string;
  sku: string | null;
  unitCode: string;
  soldMilli: number;
  returnedMilli: number;
  returnableMilli: number;
  unitPricePaise: number;
  taxRateBp: number;
  /** Stored line amounts, net of discount — the basis for a proportional reversal. */
  taxablePaise: number;
  taxPaise: number;
  totalPaise: number;
  /** False for a service item: there is nothing to put back on a shelf. */
  trackInventory: boolean;
}

export interface PriorReturn {
  id: string;
  returnNumber: string;
  returnDate: string;
  totalPaise: number;
  refundMethod: PaymentMethod;
  reason: string | null;
}

export interface ReturnableSale {
  saleId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string | null;
  status: 'completed' | 'voided';
  lines: ReturnableLine[];
  priorReturns: PriorReturn[];
  /** False when nothing is left to return, or the sale was voided. */
  canReturn: boolean;
}

export interface ReturnReceiptLine {
  saleItemId: string;
  productId: string | null;
  name: string;
  unitCode: string;
  quantityMilli: number;
  unitPricePaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
  restocked: boolean;
}

export interface ReturnReceipt {
  id: string;
  returnNumber: string;
  returnDate: string;
  saleId: string;
  invoiceNumber: string;
  reason: string | null;
  refundMethod: PaymentMethod;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  lines: ReturnReceiptLine[];
  /** True when an identical submission had already been committed. */
  duplicate: boolean;
}
