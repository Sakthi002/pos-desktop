/**
 * Batches, as storage.
 *
 * Every balance here is summed from `inventory_movements`, the same ledger the
 * product balance comes from. A batch balance is just that sum narrowed to one
 * batch, so the two can never disagree.
 */
import type { Database } from 'better-sqlite3';
import { daysUntil, isExpired, today, type Batch } from '@shared/batches';
import { Repository, newId, now } from './base';

interface BatchRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_code: string;
  batch_number: string;
  manufactured_on: string | null;
  expires_on: string | null;
  cost_paise: number;
  mrp_paise: number | null;
  balance_milli: number;
}

const toBatch = (row: BatchRow, on: string): Batch => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name,
  unitCode: row.unit_code,
  batchNumber: row.batch_number,
  manufacturedOn: row.manufactured_on,
  expiresOn: row.expires_on,
  costPaise: row.cost_paise,
  mrpPaise: row.mrp_paise,
  balanceMilli: row.balance_milli,
  daysToExpiry: row.expires_on === null ? null : daysUntil(row.expires_on, on),
  isExpired: isExpired(row.expires_on, on),
});

export class BatchRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  private readonly select = `
    SELECT b.*, p.name AS product_name, p.unit_code,
           COALESCE((SELECT SUM(m.quantity_milli) FROM inventory_movements m
                      WHERE m.batch_id = b.id), 0) AS balance_milli
      FROM product_batches b
      JOIN products p ON p.id = b.product_id`;

  byId(id: string): Batch | null {
    const row = this.db.prepare(`${this.select} WHERE b.id = ?`).get(id) as BatchRow | undefined;
    return row ? toBatch(row, today()) : null;
  }

  byNumber(productId: string, batchNumber: string): Batch | null {
    const row = this.db
      .prepare(`${this.select} WHERE b.product_id = ? AND b.batch_number = ?`)
      .get(productId, batchNumber) as BatchRow | undefined;
    return row ? toBatch(row, today()) : null;
  }

  insert(input: {
    productId: string;
    batchNumber: string;
    manufacturedOn: string | null;
    expiresOn: string | null;
    costPaise: number;
    mrpPaise: number | null;
  }): string {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO product_batches (id, company_id, product_id, batch_number, manufactured_on,
           expires_on, cost_paise, mrp_paise, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.companyId,
        input.productId,
        input.batchNumber,
        input.manufacturedOn,
        input.expiresOn,
        input.costPaise,
        input.mrpPaise,
        t,
        t,
      );
    return id;
  }

  update(
    id: string,
    input: {
      manufacturedOn: string | null;
      expiresOn: string | null;
      costPaise: number;
      mrpPaise: number | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE product_batches
            SET manufactured_on = ?, expires_on = ?, cost_paise = ?, mrp_paise = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.manufacturedOn, input.expiresOn, input.costPaise, input.mrpPaise, now(), id);
  }

  /**
   * Batches of one product that still hold stock, earliest expiry first. A
   * batch with no date goes last: a shop should clear what will go out of date
   * before what never will.
   */
  sellable(productId: string, on: string = today()): Batch[] {
    const rows = this.db
      .prepare(
        `${this.select}
          WHERE b.product_id = ?
          ORDER BY CASE WHEN b.expires_on IS NULL THEN 1 ELSE 0 END, b.expires_on, b.created_at`,
      )
      .all(productId) as BatchRow[];

    return rows
      .map((row) => toBatch(row, on))
      .filter((batch) => batch.balanceMilli > 0 && !batch.isExpired);
  }

  list(query: { productId?: string; inStockOnly: boolean; withinDays?: number }): Batch[] {
    const on = today();
    const conditions: string[] = ['b.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.productId) {
      conditions.push('b.product_id = @productId');
      params['productId'] = query.productId;
    }

    const rows = this.db
      .prepare(
        `${this.select}
          WHERE ${conditions.join(' AND ')}
          ORDER BY CASE WHEN b.expires_on IS NULL THEN 1 ELSE 0 END, b.expires_on, p.name`,
      )
      .all(params) as BatchRow[];

    let batches = rows.map((row) => toBatch(row, on));
    if (query.inStockOnly) batches = batches.filter((b) => b.balanceMilli > 0);
    if (query.withinDays !== undefined) {
      const limit = query.withinDays;
      batches = batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry <= limit);
    }
    return batches;
  }

  /** How much of each batch a document took, oldest movement first. */
  takenBy(referenceType: string, referenceId: string, productId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT batch_id, SUM(quantity_milli) AS qty
           FROM inventory_movements
          WHERE reference_type = ? AND reference_id = ? AND product_id = ? AND batch_id IS NOT NULL
          GROUP BY batch_id
          ORDER BY MIN(created_at)`,
      )
      .all(referenceType, referenceId, productId) as { batch_id: string; qty: number }[];

    return new Map(rows.map((row) => [row.batch_id, row.qty]));
  }

  /** What has already gone back to each batch against a sale. */
  returnedTo(saleId: string, productId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT m.batch_id, SUM(m.quantity_milli) AS qty
           FROM inventory_movements m
          WHERE m.product_id = @productId AND m.batch_id IS NOT NULL AND m.quantity_milli > 0
            AND (m.reference_id = @saleId
                 OR m.reference_id IN (SELECT id FROM sales_returns WHERE sale_id = @saleId))
          GROUP BY m.batch_id`,
      )
      .all({ saleId, productId }) as { batch_id: string; qty: number }[];

    return new Map(rows.map((row) => [row.batch_id, row.qty]));
  }

  /** Batches counted for the dashboard: expiring within so many days. */
  countExpiring(withinDays: number): { batches: number; valuePaise: number } {
    const list = this.list({ inStockOnly: true, withinDays });
    return {
      batches: list.length,
      valuePaise: list.reduce((a, b) => a + Math.round((b.balanceMilli * b.costPaise) / 1000), 0),
    };
  }
}
