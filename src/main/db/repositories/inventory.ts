/**
 * Inventory ledger repository.
 *
 * Reads only. Movements are written by the service that caused them — a sale,
 * a void, a return, an adjustment — because the reference back to that document
 * is part of the row and only the caller knows it.
 */
import type { Database } from 'better-sqlite3';
import type { LowStockItem, MovementType, StockMovement } from '@shared/inventory';
import { Repository } from './base';

interface MovementRow {
  id: string;
  movement_type: string;
  quantity_milli: number;
  balance_milli: number;
  reference_type: string | null;
  reference_id: string | null;
  document_number: string | null;
  reason: string | null;
  created_at: string;
}

const toMovement = (row: MovementRow): StockMovement => ({
  id: row.id,
  movementType: row.movement_type as MovementType,
  quantityMilli: row.quantity_milli,
  balanceMilli: row.balance_milli,
  referenceType: row.reference_type,
  referenceId: row.reference_id,
  documentNumber: row.document_number,
  reason: row.reason,
  createdAt: row.created_at,
});

/**
 * The running balance is computed over the whole history in chronological
 * order, then the page is cut from the result. Paginating first would give
 * every page a balance that starts from zero.
 */
const LEDGER = `
  SELECT m.id, m.movement_type, m.quantity_milli, m.reference_type, m.reference_id,
         m.reason, m.created_at,
         SUM(m.quantity_milli) OVER (ORDER BY m.created_at, m.id ROWS UNBOUNDED PRECEDING)
           AS balance_milli,
         COALESCE(s.invoice_number, r.return_number) AS document_number
    FROM inventory_movements m
    LEFT JOIN sales s
      ON m.reference_type IN ('sale', 'sale_void') AND s.id = m.reference_id
    LEFT JOIN sales_returns r
      ON m.reference_type = 'sale_return' AND r.id = m.reference_id
   WHERE m.product_id = @productId
`;

export class InventoryRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  movements(productId: string, page: number, pageSize: number): StockMovement[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (${LEDGER})
          ORDER BY created_at DESC, id DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ productId, limit: pageSize, offset: (page - 1) * pageSize }) as MovementRow[];
    return rows.map(toMovement);
  }

  movementCount(productId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = ?')
        .get(productId) as { n: number }
    ).n;
  }

  /**
   * Products at or below their reorder level. A level of zero means the shop
   * never set one, so it is not an alert — it would bury the real ones.
   */
  lowStock(limit = 100): LowStockItem[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.unit_code, p.reorder_level_milli,
                (SELECT COALESCE(SUM(m.quantity_milli), 0)
                   FROM inventory_movements m WHERE m.product_id = p.id) AS stock_milli
           FROM products p
          WHERE p.company_id = @companyId AND p.is_active = 1
            AND p.track_inventory = 1 AND p.reorder_level_milli > 0
          ORDER BY (stock_milli * 1.0 / p.reorder_level_milli), p.name
          LIMIT @limit`,
      )
      .all({ companyId: this.companyId, limit }) as {
      id: string;
      name: string;
      sku: string | null;
      unit_code: string;
      reorder_level_milli: number;
      stock_milli: number;
    }[];

    return rows
      .filter((row) => row.stock_milli <= row.reorder_level_milli)
      .map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        unitCode: row.unit_code,
        stockMilli: row.stock_milli,
        reorderLevelMilli: row.reorder_level_milli,
      }));
  }
}
