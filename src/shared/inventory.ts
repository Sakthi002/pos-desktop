/**
 * Inventory ledger.
 *
 * Stock is never a stored number. Every change is a signed movement, and a
 * balance is the sum of the movements before it — which is why this module
 * talks about history and running balances rather than quantities on hand.
 */
import { z } from 'zod';

export const MOVEMENT_TYPES = [
  'opening',
  'sale',
  'sale_return',
  'adjustment',
  'purchase',
  'damage',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const movementQuerySchema = z.object({
  productId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type MovementQuery = z.infer<typeof movementQuerySchema>;

export interface StockMovement {
  id: string;
  movementType: MovementType;
  quantityMilli: number;
  /** Stock after this movement, summed over everything up to it. */
  balanceMilli: number;
  referenceType: string | null;
  referenceId: string | null;
  /** Invoice or credit-note number, when the movement came from a document. */
  documentNumber: string | null;
  reason: string | null;
  createdAt: string;
}

export interface MovementPage {
  productId: string;
  productName: string;
  unitCode: string;
  stockMilli: number;
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  sku: string | null;
  unitCode: string;
  stockMilli: number;
  reorderLevelMilli: number;
}
