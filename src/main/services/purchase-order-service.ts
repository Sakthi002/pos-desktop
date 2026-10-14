/**
 * Ordering goods from a supplier.
 *
 * An order says what a shop wants and at what cost it expects to be charged.
 * It does not move stock, owe money or post a voucher: all three happen when
 * the goods arrive and the supplier's bill is entered, and that bill is its
 * own document that points back here.
 *
 * It is never edited, for the same reason a quotation is not: an order a
 * supplier has been sent is a thing that happened. A wrong one is cancelled
 * with a reason and sent again.
 */
import type { Database } from 'better-sqlite3';
import {
  cancelPurchaseOrderSchema,
  purchaseOrderInputSchema,
  purchaseOrderQuerySchema,
  statusOf,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderPage,
  type PurchaseOrderSummary,
} from '@shared/purchase-orders';
import { financialYearOf, type AppSettings } from '@shared/settings';
import { PurchaseOrderRepository, type PurchaseOrderRow } from '../db/repositories/purchase-orders';
import { AuditRepository } from '../db/repositories/audit';
import { inTransaction, newId, now } from '../db/repositories/base';
import { SettingsService } from './settings-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class PurchaseOrderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  unit_code: string;
  is_active: number;
}

export class PurchaseOrderService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: PurchaseOrderRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new PurchaseOrderError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) throw new PurchaseOrderError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.settings = settings;

    this.repo = new PurchaseOrderRepository(db, ctx.companyId);
    this.audit = new AuditRepository(db);
  }

  private products(ids: string[]): Map<string, ProductRow> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, sku, unit_code, is_active FROM products WHERE id IN (${placeholders})`,
      )
      .all(...ids) as ProductRow[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  create(input: unknown): PurchaseOrder {
    const parsed = purchaseOrderInputSchema.parse(input);

    // The same submission arriving twice — a double tap, a retry — is the
    // first order, not a second one.
    const already = this.repo.findByIdempotencyKey(parsed.idempotencyKey);
    if (already) return this.get(already);

    const supplier = this.db
      .prepare('SELECT id, name, phone, gstin, is_active FROM suppliers WHERE id = ?')
      .get(parsed.supplierId) as
      | { id: string; name: string; phone: string | null; gstin: string | null; is_active: number }
      | undefined;
    if (!supplier) throw new PurchaseOrderError('SUPPLIER_NOT_FOUND', 'That supplier is gone.');
    if (supplier.is_active === 0) {
      throw new PurchaseOrderError('SUPPLIER_INACTIVE', `${supplier.name} is no longer used.`);
    }

    const products = this.products(parsed.lines.map((l) => l.productId));

    const lines = parsed.lines.map((line, index) => {
      const product = products.get(line.productId);
      if (!product) {
        throw new PurchaseOrderError('PRODUCT_NOT_FOUND', 'A product no longer exists.');
      }
      if (product.is_active === 0) {
        throw new PurchaseOrderError('PRODUCT_INACTIVE', `${product.name} is no longer stocked.`);
      }
      // Quantity is in thousandths, so the cost of a line is worked out in
      // thousandths too and rounded once, as the till does.
      const total = Math.round((line.quantityMilli * line.unitCostPaise) / 1000);
      return {
        lineNo: index + 1,
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unitCode: product.unit_code,
        quantityMilli: line.quantityMilli,
        unitCostPaise: line.unitCostPaise,
        totalPaise: total,
      };
    });

    const total = lines.reduce((sum, line) => sum + line.totalPaise, 0);

    const id = newId();
    const at = now();
    const financialYear = financialYearOf(
      new Date(at),
      this.settings.invoice.financialYearStartMonth,
    );

    const expectedOn =
      parsed.expectedDays === null || parsed.expectedDays === undefined
        ? null
        : new Date(new Date(at).getTime() + parsed.expectedDays * 86_400_000).toISOString();

    inTransaction(this.db, () => {
      const orderNumber = this.repo.allocateNumber(
        this.ctx.branchId,
        financialYear,
        `${this.settings.invoice.prefix}-PO`,
      );

      this.repo.insert({
        id,
        branchId: this.ctx.branchId,
        operatorId: this.ctx.operatorId,
        orderNumber,
        financialYear,
        at,
        expectedOn,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierPhone: supplier.phone,
        supplierGstin: supplier.gstin,
        total,
        notes: parsed.notes ?? null,
        idempotencyKey: parsed.idempotencyKey,
      });

      for (const line of lines) {
        this.repo.insertItem({
          purchaseOrderId: id,
          lineNo: line.lineNo,
          productId: line.productId,
          name: line.name,
          sku: line.sku,
          unitCode: line.unitCode,
          quantityMilli: line.quantityMilli,
          unitCostPaise: line.unitCostPaise,
          total: line.totalPaise,
          at,
        });
      }

      this.audit.record(
        {
          entityType: 'purchase_order',
          entityId: id,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: { orderNumber, supplier: supplier.name, totalPaise: total, expectedOn },
        },
        at,
      );
    });

    return this.get(id);
  }

  get(id: string): PurchaseOrder {
    const row = this.repo.find(id);
    if (!row) throw new PurchaseOrderError('NOT_FOUND', 'That order does not exist.');
    return this.toOrder(row);
  }

  list(input: unknown): PurchaseOrderPage {
    const query = purchaseOrderQuerySchema.parse(input ?? {});
    const { rows, total, openCount, openValue } = this.repo.search(query);

    return {
      items: rows.map((row) => this.toSummary(row, row.items, row.purchase_number)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      openCount,
      openValuePaise: openValue,
    };
  }

  cancel(input: unknown): PurchaseOrder {
    const parsed = cancelPurchaseOrderSchema.parse(input);
    const row = this.repo.find(parsed.id);
    if (!row) throw new PurchaseOrderError('NOT_FOUND', 'That order does not exist.');
    if (row.status === 'received') {
      throw new PurchaseOrderError('ALREADY_RECEIVED', 'Those goods have already arrived.');
    }
    if (row.status === 'cancelled') return this.toOrder(row);

    const at = now();
    inTransaction(this.db, () => {
      this.repo.markCancelled(parsed.id, parsed.reason, at);
      this.audit.record(
        {
          entityType: 'purchase_order',
          entityId: parsed.id,
          action: 'cancel',
          operatorId: this.ctx.operatorId,
          details: { orderNumber: row.order_number, reason: parsed.reason },
        },
        at,
      );
    });

    return this.get(parsed.id);
  }

  /**
   * Called from inside the purchase's own transaction when a bill names the
   * order it came from. Refuses anything already settled, so one order cannot
   * be received twice.
   */
  markReceived(orderId: string, purchaseId: string, at: string): void {
    const row = this.repo.find(orderId);
    if (!row) throw new PurchaseOrderError('NOT_FOUND', 'That order does not exist.');
    if (row.status === 'received') {
      throw new PurchaseOrderError('ALREADY_RECEIVED', 'Those goods have already arrived.');
    }
    if (row.status === 'cancelled') {
      throw new PurchaseOrderError('CANCELLED', 'That order was cancelled.');
    }
    this.repo.markReceived(orderId, purchaseId, at);
  }

  private toSummary(
    row: PurchaseOrderRow,
    items: number,
    purchaseNumber: string | null,
  ): PurchaseOrderSummary {
    return {
      id: row.id,
      orderNumber: row.order_number,
      orderDate: row.order_date,
      expectedOn: row.expected_on,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      items,
      totalPaise: row.total_paise,
      status: statusOf(row.status, row.expected_on),
      receivedPurchaseId: row.received_purchase_id,
      receivedPurchaseNumber: purchaseNumber,
    };
  }

  private toOrder(row: PurchaseOrderRow): PurchaseOrder {
    const items = this.repo.items(row.id);

    const lines: PurchaseOrderLine[] = items.map((item) => ({
      id: item['id'] as string,
      lineNo: item['line_no'] as number,
      productId: (item['product_id'] as string | null) ?? null,
      name: item['name'] as string,
      sku: (item['sku'] as string | null) ?? null,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitCostPaise: item['unit_cost_paise'] as number,
      totalPaise: item['total_paise'] as number,
    }));

    return {
      ...this.toSummary(
        row,
        items.length,
        row.received_purchase_id ? this.repo.purchaseNumberFor(row.received_purchase_id) : null,
      ),
      supplierPhone: row.supplier_phone,
      supplierGstin: row.supplier_gstin,
      notes: row.notes,
      cancelReason: row.cancel_reason,
      lines,
    };
  }
}
