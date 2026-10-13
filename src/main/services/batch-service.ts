/**
 * Batches and expiry.
 *
 * Two rules decide everything here. Stock leaves by earliest expiry first, so
 * what will go out of date goes out of the door first. And an expired batch is
 * never sold, whatever the operator does — not a warning, a refusal.
 *
 * Allocation returns a plan rather than writing it. The caller is already
 * inside the transaction that writes the sale, and the stock movements it
 * writes carry the batch, so the plan and the ledger cannot disagree.
 */
import type { Database } from 'better-sqlite3';
import {
  batchInputSchema,
  batchQuerySchema,
  isExpired,
  today,
  type Batch,
  type ValuationMethod,
} from '@shared/batches';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { BatchRepository } from '../db/repositories/batches';
import { inTransaction } from '../db/repositories/base';
import { loadBranchContext } from './branch-context';

export class BatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BatchError';
  }
}

export interface Allocation {
  batchId: string;
  quantityMilli: number;
}

interface ProductRow {
  id: string;
  name: string;
  unit_code: string;
  tracks_batches: number;
  valuation_method: string;
  cost_paise: number;
}

export class BatchService {
  private readonly repo: BatchRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new BatchError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.repo = new BatchRepository(db, ctx.companyId);
  }

  private product(productId: string): ProductRow {
    const row = this.db
      .prepare(
        'SELECT id, name, unit_code, tracks_batches, valuation_method, cost_paise FROM products WHERE id = ?',
      )
      .get(productId) as ProductRow | undefined;
    if (!row) throw new BatchError('NOT_FOUND', 'That product does not exist.');
    return row;
  }

  tracksBatches(productId: string): boolean {
    return this.product(productId).tracks_batches === 1;
  }

  list(input: unknown): Batch[] {
    const query = batchQuerySchema.parse(input ?? {});
    return this.repo.list({
      inStockOnly: query.inStockOnly,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.withinDays !== undefined ? { withinDays: query.withinDays } : {}),
    });
  }

  byId(id: string): Batch | null {
    return this.repo.byId(id);
  }

  /**
   * The batch a purchase line is going into: found by its number, or created.
   * Dates and cost are taken from the bill, because the bill is where a shop
   * reads them off the carton.
   */
  ensure(input: unknown): Batch {
    const parsed = batchInputSchema.parse(input);
    const product = this.product(parsed.productId);
    if (product.tracks_batches !== 1) {
      throw new BatchError('NOT_BATCHED', `${product.name} does not keep batches.`);
    }

    const existing = this.repo.byNumber(parsed.productId, parsed.batchNumber);

    return inTransaction(this.db, () => {
      if (existing) {
        // The same batch arriving again keeps its identity; anything the new
        // bill states about it wins, because it was read off the carton today.
        this.repo.update(existing.id, {
          manufacturedOn: parsed.manufacturedOn ?? existing.manufacturedOn,
          expiresOn: parsed.expiresOn ?? existing.expiresOn,
          costPaise: parsed.costPaise ?? existing.costPaise,
          mrpPaise: parsed.mrpPaise ?? existing.mrpPaise,
        });
        return this.repo.byId(existing.id) as Batch;
      }

      const id = this.repo.insert({
        productId: parsed.productId,
        batchNumber: parsed.batchNumber,
        manufacturedOn: parsed.manufacturedOn ?? null,
        expiresOn: parsed.expiresOn ?? null,
        costPaise: parsed.costPaise ?? product.cost_paise,
        mrpPaise: parsed.mrpPaise ?? null,
      });
      return this.repo.byId(id) as Batch;
    });
  }

  /**
   * Which batches a sale takes from, earliest expiry first. Expired batches
   * are skipped entirely: they are stock the shop holds and cannot sell.
   */
  allocateForSale(productId: string, quantityMilli: number, on: string = today()): Allocation[] {
    const product = this.product(productId);
    if (product.tracks_batches !== 1) return [];

    const batches = this.repo.sellable(productId, on);
    const plan: Allocation[] = [];
    let left = quantityMilli;

    for (const batch of batches) {
      if (left <= 0) break;
      const take = Math.min(left, batch.balanceMilli);
      if (take <= 0) continue;
      plan.push({ batchId: batch.id, quantityMilli: take });
      left -= take;
    }

    if (left > 0) {
      const precision = precisionFor(product.unit_code);
      const held = this.repo
        .list({ productId, inStockOnly: true })
        .filter((b) => b.isExpired)
        .reduce((a, b) => a + b.balanceMilli, 0);

      throw new BatchError(
        'NO_SELLABLE_BATCH',
        held > 0
          ? `${product.name} has ${formatQuantity(held, precision)} ${product.unit_code} in stock, but every batch of it has expired.`
          : `${product.name} has only ${formatQuantity(quantityMilli - left, precision)} ${product.unit_code} in a usable batch.`,
      );
    }

    return plan;
  }

  /**
   * Where returned goods go back to: the batches this sale took them from,
   * never more than each batch gave and never more than is still outstanding.
   */
  allocateForReturn(saleId: string, productId: string, quantityMilli: number): Allocation[] {
    const product = this.product(productId);
    if (product.tracks_batches !== 1) return [];

    const taken = this.repo.takenBy('sale', saleId, productId);
    const back = this.repo.returnedTo(saleId, productId);

    const plan: Allocation[] = [];
    let left = quantityMilli;

    for (const [batchId, qty] of taken) {
      if (left <= 0) break;
      // `taken` is negative: a sale removes stock.
      const outstanding = Math.abs(qty) - (back.get(batchId) ?? 0);
      if (outstanding <= 0) continue;
      const give = Math.min(left, outstanding);
      plan.push({ batchId, quantityMilli: give });
      left -= give;
    }

    if (left > 0) {
      // More is coming back than this sale ever took from a batch. Rather than
      // invent a batch, the remainder goes back without one — visible, and the
      // product balance still adds up.
      plan.push({ batchId: '', quantityMilli: left });
    }

    return plan;
  }

  /** Batches that have expired or will soon, worst first. */
  expiring(withinDays: number): Batch[] {
    return this.repo.list({ inStockOnly: true, withinDays });
  }

  countExpiring(withinDays: number): { batches: number; valuePaise: number } {
    return this.repo.countExpiring(withinDays);
  }

  /**
   * What stock of one product is worth.
   *
   * A product that keeps batches is valued at what its remaining batches
   * actually cost — the stock on the shelf is known, so there is nothing to
   * assume. For everything else the cost of what is left has to be assumed,
   * and the product's method says how: FIFO leaves the newest arrivals on the
   * shelf, LIFO the oldest, average ignores the order altogether.
   */
  valueOf(productId: string, balanceMilli: number): number {
    const product = this.product(productId);
    if (balanceMilli <= 0) return 0;

    if (product.tracks_batches === 1) {
      const batches = this.repo
        .list({ productId, inStockOnly: true })
        .filter((b) => b.balanceMilli > 0);

      if (batches.length > 0) {
        const value = batches.reduce((a, b) => a + (b.balanceMilli * b.costPaise) / 1000, 0);
        return Math.round(value);
      }
      return Math.round((balanceMilli * product.cost_paise) / 1000);
    }

    // Every arrival that stated a cost, oldest first: the layers stock came in.
    const layers = this.db
      .prepare(
        `SELECT quantity_milli, unit_cost_paise
           FROM inventory_movements
          WHERE product_id = ? AND quantity_milli > 0 AND unit_cost_paise IS NOT NULL
          ORDER BY created_at, id`,
      )
      .all(productId) as { quantity_milli: number; unit_cost_paise: number }[];

    if (layers.length === 0) return Math.round((balanceMilli * product.cost_paise) / 1000);

    const method = product.valuation_method as ValuationMethod;

    if (method === 'average') {
      const quantity = layers.reduce((a, l) => a + l.quantity_milli, 0);
      const cost = layers.reduce((a, l) => a + (l.quantity_milli * l.unit_cost_paise) / 1000, 0);
      const perUnit = quantity > 0 ? (cost * 1000) / quantity : product.cost_paise;
      return Math.round((balanceMilli * perUnit) / 1000);
    }

    // FIFO: the oldest went out, so what is left is the newest arrivals.
    const ordered = method === 'fifo' ? [...layers].reverse() : layers;

    let left = balanceMilli;
    let value = 0;
    for (const layer of ordered) {
      if (left <= 0) break;
      const take = Math.min(left, layer.quantity_milli);
      value += (take * layer.unit_cost_paise) / 1000;
      left -= take;
    }
    // More on the shelf than ever arrived with a cost: the rest at today's.
    if (left > 0) value += (left * product.cost_paise) / 1000;

    return Math.round(value);
  }

  /** True when this batch cannot be sold today. */
  isExpired(batch: Batch): boolean {
    return isExpired(batch.expiresOn);
  }
}
