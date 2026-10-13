/**
 * Suppliers.
 *
 * Like customers, a supplier is deactivated rather than deleted: their name is
 * printed on every bill we ever booked against them, and what we still owe
 * them is derived from those bills, not from a balance kept on this row.
 */
import type { Database } from 'better-sqlite3';
import {
  supplierInputSchema,
  supplierQuerySchema,
  supplierUpdateSchema,
  type Supplier,
  type SupplierPage,
  type SupplierPayment,
  type SupplierQuery,
} from '@shared/purchasing';
import { PurchasingRepository } from '../db/repositories/purchasing';
import { loadBranchContext } from './branch-context';

export class SupplierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupplierError';
  }
}

export class SupplierService {
  private readonly repo: PurchasingRepository;

  constructor(db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new SupplierError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.repo = new PurchasingRepository(db, ctx.companyId);
  }

  list(input: unknown): SupplierPage {
    const query: SupplierQuery = supplierQuerySchema.parse(input ?? {});
    const { items, total } = this.repo.listSuppliers(query);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  get(id: string): Supplier | null {
    return this.repo.findSupplier(id);
  }

  create(input: unknown): Supplier {
    const parsed = supplierInputSchema.parse(input);
    const id = this.repo.createSupplier(parsed);
    return this.repo.findSupplier(id) as Supplier;
  }

  update(input: unknown): Supplier {
    const parsed = supplierUpdateSchema.parse(input);
    if (!this.repo.findSupplier(parsed.id)) {
      throw new SupplierError('NOT_FOUND', 'Supplier not found.');
    }
    this.repo.updateSupplier(parsed);
    return this.repo.findSupplier(parsed.id) as Supplier;
  }

  setActive(id: string, isActive: boolean): Supplier {
    if (!this.repo.findSupplier(id)) throw new SupplierError('NOT_FOUND', 'Supplier not found.');
    this.repo.setSupplierActive(id, isActive);
    return this.repo.findSupplier(id) as Supplier;
  }

  /** Recent money movements on one supplier's account. */
  payments(supplierId: string): SupplierPayment[] {
    return this.repo.supplierPayments(supplierId);
  }

  outstanding(supplierId: string): number {
    return this.repo.supplierOutstanding(supplierId);
  }
}
