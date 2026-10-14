import { z } from 'zod';

/**
 * A purchase order: what a shop asks a supplier to send.
 *
 * The mirror of a quotation. It moves no stock, owes no money and posts
 * nothing to the books — the supplier's bill does all three when the goods
 * arrive, and that bill is its own document pointing back here. It keeps its
 * own numbering for the same reason a quotation does.
 *
 * Costs only, and no tax: what tax a supplier charges is settled by their
 * bill, and an order that guessed at it would be contradicted on arrival.
 */

export const purchaseOrderLineSchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: z.number().int().positive('Quantity must be greater than zero'),
  unitCostPaise: z.number().int().min(0),
});

export const purchaseOrderInputSchema = z.object({
  /** Generated when the form opens; makes a retry safe. */
  idempotencyKey: z.string().uuid(),
  supplierId: z.string().uuid(),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Add at least one item'),
  /** Days until the goods are wanted. Null gives no date. */
  expectedDays: z.number().int().min(1).max(365).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const purchaseOrderQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'open', 'received', 'cancelled', 'overdue']).default('all'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(200).default(25),
});

export const cancelPurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason').max(200),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;
export type PurchaseOrderQuery = z.infer<typeof purchaseOrderQuerySchema>;

/**
 * Open until the goods arrive against it or the shop calls it off. Overdue is
 * read from the date rather than stored, so an order cannot be late in the
 * list and on time on the screen.
 */
export type PurchaseOrderStatus = 'open' | 'overdue' | 'received' | 'cancelled';

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  open: 'Open',
  overdue: 'Overdue',
  received: 'Received',
  cancelled: 'Cancelled',
};

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  productId: string | null;
  name: string;
  sku: string | null;
  unitCode: string;
  quantityMilli: number;
  unitCostPaise: number;
  totalPaise: number;
}

export interface PurchaseOrderSummary {
  id: string;
  orderNumber: string;
  orderDate: string;
  expectedOn: string | null;
  supplierId: string;
  supplierName: string;
  items: number;
  totalPaise: number;
  status: PurchaseOrderStatus;
  receivedPurchaseId: string | null;
  receivedPurchaseNumber: string | null;
}

export interface PurchaseOrder extends PurchaseOrderSummary {
  supplierPhone: string | null;
  supplierGstin: string | null;
  notes: string | null;
  cancelReason: string | null;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderPage {
  items: PurchaseOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  openCount: number;
  openValuePaise: number;
}

/**
 * What an order is today. The stored status wins — goods that arrived cannot
 * un-arrive — and an open order past its date is simply late.
 */
export function statusOf(
  stored: 'open' | 'received' | 'cancelled',
  expectedOn: string | null,
  now: Date = new Date(),
): PurchaseOrderStatus {
  if (stored !== 'open') return stored;
  if (!expectedOn) return 'open';
  return new Date(expectedOn).getTime() < now.getTime() ? 'overdue' : 'open';
}
