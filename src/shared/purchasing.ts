/**
 * Buying: suppliers, purchases, purchase returns and what is owed.
 *
 * The mirror of selling, and deliberately shaped like it — the same integer
 * paise, the same thousandths of a unit, the same snapshot-per-line, and the
 * same calculation engine in `billing.ts`, because a supplier's bill is a bill
 * with the arrow pointing the other way.
 */
import { z } from 'zod';

export const SUPPLIER_PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'other'] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];

export const PURCHASE_SETTLEMENTS = ['debit_note', 'cash', 'upi', 'card', 'bank', 'other'] as const;
export type PurchaseSettlement = (typeof PURCHASE_SETTLEMENTS)[number];

// ─── Suppliers ──────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : (v ?? '')));

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(150),
  phone: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[\d +-]{6,20}$/, 'Enter a valid phone number'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === null ? '' : (v ?? ''))),
  email: optionalText(120),
  address: optionalText(300),
  city: optionalText(80),
  gstin: z
    .union([
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]$/, 'GSTIN must be 15 characters'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === null ? '' : (v ?? ''))),
  /** Drives CGST+SGST versus IGST on what we buy from them. */
  stateCode: z
    .union([z.string().regex(/^\d{2}$/), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : (v ?? ''))),
  creditLimitPaise: z.number().int().min(0).max(1_000_000_000).default(0),
  notes: optionalText(500),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const supplierUpdateSchema = supplierInputSchema.extend({ id: z.string().uuid() });
export type SupplierUpdate = z.infer<typeof supplierUpdateSchema>;

export const supplierQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type SupplierQuery = z.infer<typeof supplierQuerySchema>;

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  gstin: string | null;
  stateCode: string | null;
  creditLimitPaise: number;
  notes: string | null;
  isActive: boolean;
}

export interface SupplierSummary extends Supplier {
  purchases: number;
  purchasedPaise: number;
  returnedPaise: number;
  paidPaise: number;
  /** Bought, less returned, less paid. Positive means we still owe them. */
  outstandingPaise: number;
  lastPurchaseAt: string | null;
}

export interface SupplierPage {
  items: SupplierSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Purchases ──────────────────────────────────────────────────────────────

export const purchaseLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Quantity must be greater than zero'),
  /** What the supplier charges per unit, before tax when the bill is exclusive. */
  unitCostPaise: z.number().int().min(0),
  /** Printed on the pack. Optional: plenty of bills do not state it. */
  mrpPaise: z.number().int().min(0).nullable().optional(),
  discountPaise: z.number().int().min(0).default(0),
  /** Push the MRP onto the product as its new selling price. */
  updateSellingPrice: z.boolean().default(false),
  /** For a product that keeps batches: which one this stock belongs to. */
  batchNumber: z.string().trim().max(40).nullable().optional(),
  manufacturedOn: z.union([z.string().max(10), z.null()]).optional(),
  expiresOn: z.union([z.string().max(10), z.null()]).optional(),
});

export const purchaseInputSchema = z.object({
  /** Generated when the purchase screen opens; makes a retry safe. */
  idempotencyKey: z.string().uuid(),
  supplierId: z.string().uuid(),
  /** The order these goods were sent against, when there was one. */
  purchaseOrderId: z.string().uuid().nullable().optional(),
  supplierBillNo: z.string().trim().max(60).nullable().optional(),
  /** The date on their bill, which is often not today. */
  purchaseDateIso: z.iso.datetime().nullable().optional(),
  /** Supplier bills usually quote cost before tax. */
  taxMode: z.enum(['inclusive', 'exclusive']).default('exclusive'),
  lines: z.array(purchaseLineInputSchema).min(1, 'Add at least one item'),
  billDiscountPaise: z.number().int().min(0).default(0),
  notes: z.string().trim().max(500).nullable().optional(),
  /** Paid at the counter now; leave it out to settle later. */
  payment: z
    .object({
      method: z.enum(SUPPLIER_PAYMENT_METHODS),
      amountPaise: z.number().int().positive(),
      reference: z.string().trim().max(60).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export interface PurchaseLine {
  id: string;
  lineNo: number;
  productId: string | null;
  name: string;
  sku: string | null;
  hsn: string | null;
  unitCode: string;
  quantityMilli: number;
  unitCostPaise: number;
  mrpPaise: number | null;
  discountPaise: number;
  taxablePaise: number;
  taxRateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** Quantity already sent back to the supplier. */
  returnedMilli: number;
}

export interface PurchasePayment {
  id: string;
  paymentDate: string;
  method: SupplierPaymentMethod;
  amountPaise: number;
  reference: string | null;
}

export interface PurchaseReceipt {
  id: string;
  purchaseNumber: string;
  supplierBillNo: string | null;
  purchaseDate: string;
  financialYear: string;
  supplierId: string;
  supplierName: string | null;
  supplierGstin: string | null;
  taxMode: 'inclusive' | 'exclusive';
  isInterstate: boolean;
  grossPaise: number;
  itemDiscountPaise: number;
  billDiscountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paidPaise: number;
  returnedPaise: number;
  /** Total, less what came back, less what has been paid. */
  outstandingPaise: number;
  status: 'completed' | 'cancelled';
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  lines: PurchaseLine[];
  payments: PurchasePayment[];
  /** True when an identical submission had already been committed. */
  duplicate: boolean;
}

export const purchaseQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  supplierId: z.string().uuid().nullable().optional(),
  fromIso: z.iso.datetime().nullable().optional(),
  toIso: z.iso.datetime().nullable().optional(),
  status: z.enum(['all', 'completed', 'cancelled']).default('all'),
  /** Only bills with money still owed on them. */
  unpaidOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;

export interface PurchaseSummary {
  id: string;
  purchaseNumber: string;
  supplierBillNo: string | null;
  purchaseDate: string;
  supplierId: string;
  supplierName: string | null;
  itemCount: number;
  totalPaise: number;
  paidPaise: number;
  returnedPaise: number;
  outstandingPaise: number;
  status: 'completed' | 'cancelled';
}

export interface PurchasePage {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  purchasedPaise: number;
  outstandingPaise: number;
}

export const cancelPurchaseSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason for cancelling').max(200),
});

// ─── Purchase returns ───────────────────────────────────────────────────────

export const purchaseReturnLineSchema = z.object({
  purchaseItemId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Enter a quantity to return'),
});

export const purchaseReturnInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  purchaseId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason for the return').max(200),
  settlement: z.enum(PURCHASE_SETTLEMENTS).default('debit_note'),
  lines: z.array(purchaseReturnLineSchema).min(1, 'Choose at least one item to return'),
});

export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;

export interface PurchaseReturnLine {
  purchaseItemId: string;
  productId: string | null;
  name: string;
  unitCode: string;
  quantityMilli: number;
  unitCostPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface PurchaseReturnReceipt {
  id: string;
  returnNumber: string;
  returnDate: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string | null;
  reason: string;
  settlement: PurchaseSettlement;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  lines: PurchaseReturnLine[];
  duplicate: boolean;
}

// ─── Paying a supplier ──────────────────────────────────────────────────────

export const supplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  /** Against one bill, or left on account when absent. */
  purchaseId: z.string().uuid().nullable().optional(),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  amountPaise: z.number().int().positive('Enter an amount'),
  reference: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
});

export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;

export interface SupplierPayment {
  id: string;
  paymentDate: string;
  supplierId: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
  method: SupplierPaymentMethod;
  amountPaise: number;
  reference: string | null;
  notes: string | null;
}
