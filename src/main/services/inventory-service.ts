/**
 * Inventory.
 *
 * The movement ledger is the only source of stock truth: a balance is a sum
 * over it, so the history always explains the number on screen. Sales, voids,
 * returns and manual adjustments all write here, and nothing else does.
 */
import type { Database } from 'better-sqlite3';
import { movementQuerySchema, type LowStockItem, type MovementPage } from '@shared/inventory';
import { InventoryRepository } from '../db/repositories/inventory';
import { CatalogueRepository } from '../db/repositories/catalogue';
import { loadBranchContext } from './branch-context';

export class InventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InventoryError';
  }
}

export class InventoryService {
  private readonly repo: InventoryRepository;
  private readonly catalogue: CatalogueRepository;

  constructor(db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new InventoryError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.repo = new InventoryRepository(db, ctx.companyId);
    this.catalogue = new CatalogueRepository(db, ctx.companyId);
  }

  /** Movement history for one product, newest first, with running balances. */
  movements(input: unknown): MovementPage {
    const query = movementQuerySchema.parse(input ?? {});
    const product = this.catalogue.findById(query.productId);
    if (!product) throw new InventoryError('NOT_FOUND', 'Product not found.');

    return {
      productId: product.id,
      productName: product.name,
      unitCode: product.unitCode,
      stockMilli: product.stockMilli,
      items: this.repo.movements(query.productId, query.page, query.pageSize),
      total: this.repo.movementCount(query.productId),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Everything at or below its reorder level, worst first. */
  lowStock(): LowStockItem[] {
    return this.repo.lowStock();
  }
}
