/**
 * Suppliers, purchases, purchase returns and supplier money.
 *
 * Every figure a screen shows about a supplier — bought, returned, paid, still
 * owed — is derived here from the documents, never from a running balance kept
 * on the supplier row. A stored balance is a second source of truth, and the
 * one that goes wrong quietly.
 */
import type { Database } from 'better-sqlite3';
import type {
  PurchaseLine,
  PurchasePayment,
  PurchaseQuery,
  PurchaseReceipt,
  PurchaseReturnLine,
  PurchaseReturnReceipt,
  PurchaseSettlement,
  PurchaseSummary,
  Supplier,
  SupplierPayment,
  SupplierPaymentMethod,
  SupplierQuery,
  SupplierSummary,
} from '@shared/purchasing';
import { Repository, newId, now, toDbBool, fromDbBool } from './base';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  gstin: string | null;
  state_code: string | null;
  credit_limit_paise: number;
  notes: string | null;
  is_active: number;
}

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  city: row.city,
  gstin: row.gstin,
  stateCode: row.state_code,
  creditLimitPaise: row.credit_limit_paise,
  notes: row.notes,
  isActive: fromDbBool(row.is_active),
});

const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * What a supplier is owed, as SQL. A cancelled purchase is not a liability, a
 * return reduces one, and a payment settles one.
 */
const OWED = `
  COALESCE((SELECT SUM(p.total_paise) FROM purchases p
             WHERE p.supplier_id = s.id AND p.status = 'completed'), 0)
  - COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r
               JOIN purchases p2 ON p2.id = r.purchase_id
              WHERE r.supplier_id = s.id AND p2.status = 'completed'), 0)
  - COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
               WHERE sp.supplier_id = s.id), 0)
`;

export class PurchasingRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  // ─── Suppliers ────────────────────────────────────────────────────────────

  createSupplier(input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    gstin?: string;
    stateCode?: string;
    creditLimitPaise: number;
    notes?: string;
  }): string {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO suppliers (id, company_id, name, phone, email, address, city, gstin,
           state_code, credit_limit_paise, notes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        this.companyId,
        input.name,
        nullIfBlank(input.phone),
        nullIfBlank(input.email),
        nullIfBlank(input.address),
        nullIfBlank(input.city),
        nullIfBlank(input.gstin),
        nullIfBlank(input.stateCode),
        input.creditLimitPaise,
        nullIfBlank(input.notes),
        t,
        t,
      );
    return id;
  }

  updateSupplier(input: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    gstin?: string;
    stateCode?: string;
    creditLimitPaise: number;
    notes?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE suppliers
            SET name = ?, phone = ?, email = ?, address = ?, city = ?, gstin = ?,
                state_code = ?, credit_limit_paise = ?, notes = ?, updated_at = ?
          WHERE id = ? AND company_id = ?`,
      )
      .run(
        input.name,
        nullIfBlank(input.phone),
        nullIfBlank(input.email),
        nullIfBlank(input.address),
        nullIfBlank(input.city),
        nullIfBlank(input.gstin),
        nullIfBlank(input.stateCode),
        input.creditLimitPaise,
        nullIfBlank(input.notes),
        now(),
        input.id,
        this.companyId,
      );
  }

  setSupplierActive(id: string, isActive: boolean): void {
    this.db
      .prepare('UPDATE suppliers SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?')
      .run(toDbBool(isActive), now(), id, this.companyId);
  }

  findSupplier(id: string): Supplier | null {
    const row = this.db
      .prepare('SELECT * FROM suppliers WHERE id = ? AND company_id = ?')
      .get(id, this.companyId) as SupplierRow | undefined;
    return row ? toSupplier(row) : null;
  }

  listSuppliers(query: SupplierQuery): { items: SupplierSummary[]; total: number } {
    const where: string[] = ['s.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.search) {
      where.push('(s.name LIKE @like OR s.phone LIKE @like OR s.gstin LIKE @like)');
      params['like'] = `%${query.search}%`;
    }
    if (query.status === 'active') where.push('s.is_active = 1');
    if (query.status === 'inactive') where.push('s.is_active = 0');

    const filter = `WHERE ${where.join(' AND ')}`;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM suppliers s ${filter}`).get(params) as {
        n: number;
      }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT s.*,
                COALESCE((SELECT COUNT(*) FROM purchases p
                           WHERE p.supplier_id = s.id AND p.status = 'completed'), 0) AS purchases,
                COALESCE((SELECT SUM(p.total_paise) FROM purchases p
                           WHERE p.supplier_id = s.id AND p.status = 'completed'), 0)
                  AS purchased_paise,
                COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r
                           JOIN purchases p2 ON p2.id = r.purchase_id
                          WHERE r.supplier_id = s.id AND p2.status = 'completed'), 0)
                  AS returned_paise,
                COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
                           WHERE sp.supplier_id = s.id), 0) AS paid_paise,
                (${OWED}) AS outstanding_paise,
                (SELECT MAX(p.purchase_date) FROM purchases p
                  WHERE p.supplier_id = s.id AND p.status = 'completed') AS last_purchase_at
           FROM suppliers s ${filter}
          ORDER BY s.name
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as (SupplierRow & {
      purchases: number;
      purchased_paise: number;
      returned_paise: number;
      paid_paise: number;
      outstanding_paise: number;
      last_purchase_at: string | null;
    })[];

    return {
      items: rows.map((row) => ({
        ...toSupplier(row),
        purchases: row.purchases,
        purchasedPaise: row.purchased_paise,
        returnedPaise: row.returned_paise,
        paidPaise: row.paid_paise,
        outstandingPaise: row.outstanding_paise,
        lastPurchaseAt: row.last_purchase_at,
      })),
      total,
    };
  }

  supplierOutstanding(supplierId: string): number {
    const row = this.db
      .prepare(`SELECT (${OWED}) AS owed FROM suppliers s WHERE s.id = ?`)
      .get(supplierId) as { owed: number } | undefined;
    return row?.owed ?? 0;
  }

  // ─── Numbering ────────────────────────────────────────────────────────────

  /**
   * Next number for a branch and financial year. Called inside the document's
   * transaction, so a rolled-back purchase burns no number.
   */
  allocateNumber(
    branchId: string,
    kind: 'purchase' | 'purchase_return',
    financialYear: string,
    prefix: string,
  ): string {
    const existing = this.db
      .prepare(
        `SELECT prefix, next_number FROM purchase_sequences
          WHERE branch_id = ? AND kind = ? AND financial_year = ?`,
      )
      .get(branchId, kind, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO purchase_sequences (branch_id, kind, financial_year, prefix, next_number)
           VALUES (?, ?, ?, ?, 2)`,
        )
        .run(branchId, kind, financialYear, prefix);
      return `${prefix}-0001`;
    }

    this.db
      .prepare(
        `UPDATE purchase_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND kind = ? AND financial_year = ?`,
      )
      .run(branchId, kind, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  // ─── Purchases ────────────────────────────────────────────────────────────

  findByIdempotencyKey(key: string): string | null {
    const row = this.db.prepare('SELECT id FROM purchases WHERE idempotency_key = ?').get(key) as
      { id: string } | undefined;
    return row?.id ?? null;
  }

  insertPurchase(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO purchases (id, company_id, branch_id, supplier_id, operator_id,
           purchase_number, supplier_bill_no, financial_year, purchase_date, supplier_name,
           supplier_gstin, supplier_state_code, tax_mode, is_interstate, gross_paise,
           item_discount_paise, bill_discount_paise, taxable_paise, cgst_paise, sgst_paise,
           igst_paise, tax_paise, round_off_paise, total_paise, status, notes,
           idempotency_key, created_at, updated_at)
         VALUES (@id, @companyId, @branchId, @supplierId, @operatorId,
           @purchaseNumber, @supplierBillNo, @financialYear, @purchaseDate, @supplierName,
           @supplierGstin, @supplierStateCode, @taxMode, @isInterstate, @grossPaise,
           @itemDiscountPaise, @billDiscountPaise, @taxablePaise, @cgstPaise, @sgstPaise,
           @igstPaise, @taxPaise, @roundOffPaise, @totalPaise, 'completed', @notes,
           @idempotencyKey, @at, @at)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertPurchaseItem(input: Record<string, unknown>): string {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO purchase_items (id, purchase_id, line_no, product_id, name, sku, hsn,
           unit_code, quantity_milli, unit_cost_paise, mrp_paise, discount_paise, taxable_paise,
           tax_rate_bp, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise, created_at)
         VALUES (@id, @purchaseId, @lineNo, @productId, @name, @sku, @hsn,
           @unitCode, @quantityMilli, @unitCostPaise, @mrpPaise, @discountPaise, @taxablePaise,
           @taxRateBp, @cgstPaise, @sgstPaise, @igstPaise, @taxPaise, @totalPaise, @at)`,
      )
      .run({ ...input, id });
    return id;
  }

  /** The landed cost per unit, excluding tax a registered dealer reclaims. */
  updateProductCost(productId: string, costPaise: number, mrpPaise: number | null): void {
    this.db
      .prepare('UPDATE products SET cost_paise = ?, updated_at = ? WHERE id = ?')
      .run(costPaise, now(), productId);
    if (mrpPaise !== null) {
      this.db
        .prepare('UPDATE products SET mrp_paise = ?, updated_at = ? WHERE id = ?')
        .run(mrpPaise, now(), productId);
    }
  }

  updateProductSellingPrice(productId: string, pricePaise: number): void {
    this.db
      .prepare('UPDATE products SET price_paise = ?, updated_at = ? WHERE id = ?')
      .run(pricePaise, now(), productId);
  }

  cancelPurchase(id: string, reason: string, operatorId: string | null, at: string): void {
    this.db
      .prepare(
        `UPDATE purchases
            SET status = 'cancelled', cancelled_at = @at, cancel_reason = @reason,
                cancelled_by = @operatorId, updated_at = @at
          WHERE id = @id AND status = 'completed'`,
      )
      .run({ id, reason, operatorId, at });
  }

  hasReturns(purchaseId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS found FROM purchase_returns WHERE purchase_id = ? LIMIT 1')
      .get(purchaseId) as { found: number } | undefined;
    return row !== undefined;
  }

  purchaseMovements(purchaseId: string): { productId: string; quantityMilli: number }[] {
    const rows = this.db
      .prepare(
        `SELECT product_id, quantity_milli FROM inventory_movements
          WHERE reference_type = 'purchase' AND reference_id = ?`,
      )
      .all(purchaseId) as { product_id: string; quantity_milli: number }[];
    return rows.map((r) => ({ productId: r.product_id, quantityMilli: r.quantity_milli }));
  }

  findPurchase(id: string): PurchaseReceipt | null {
    const row = this.db
      .prepare('SELECT * FROM purchases WHERE id = ? AND company_id = ?')
      .get(id, this.companyId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const items = this.db
      .prepare(
        `SELECT pi.*,
                COALESCE((SELECT SUM(ri.quantity_milli) FROM purchase_return_items ri
                           WHERE ri.purchase_item_id = pi.id), 0) AS returned_milli
           FROM purchase_items pi WHERE pi.purchase_id = ? ORDER BY pi.line_no`,
      )
      .all(id) as Record<string, unknown>[];

    const payments = this.db
      .prepare(
        `SELECT * FROM supplier_payments WHERE purchase_id = ? ORDER BY payment_date, created_at`,
      )
      .all(id) as Record<string, unknown>[];

    const returned = (
      this.db
        .prepare(
          'SELECT COALESCE(SUM(total_paise), 0) AS n FROM purchase_returns WHERE purchase_id = ?',
        )
        .get(id) as { n: number }
    ).n;

    const paid = payments.reduce((a, p) => a + (p['amount_paise'] as number), 0);
    const total = row['total_paise'] as number;

    const lines: PurchaseLine[] = items.map((item) => ({
      id: item['id'] as string,
      lineNo: item['line_no'] as number,
      productId: (item['product_id'] as string | null) ?? null,
      name: item['name'] as string,
      sku: (item['sku'] as string | null) ?? null,
      hsn: (item['hsn'] as string | null) ?? null,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitCostPaise: item['unit_cost_paise'] as number,
      mrpPaise: (item['mrp_paise'] as number | null) ?? null,
      discountPaise: item['discount_paise'] as number,
      taxablePaise: item['taxable_paise'] as number,
      taxRateBp: item['tax_rate_bp'] as number,
      cgstPaise: item['cgst_paise'] as number,
      sgstPaise: item['sgst_paise'] as number,
      igstPaise: item['igst_paise'] as number,
      taxPaise: item['tax_paise'] as number,
      totalPaise: item['total_paise'] as number,
      returnedMilli: item['returned_milli'] as number,
    }));

    return {
      id,
      purchaseNumber: row['purchase_number'] as string,
      supplierBillNo: (row['supplier_bill_no'] as string | null) ?? null,
      purchaseDate: row['purchase_date'] as string,
      financialYear: row['financial_year'] as string,
      supplierId: row['supplier_id'] as string,
      supplierName: (row['supplier_name'] as string | null) ?? null,
      supplierGstin: (row['supplier_gstin'] as string | null) ?? null,
      taxMode: row['tax_mode'] as 'inclusive' | 'exclusive',
      isInterstate: row['is_interstate'] === 1,
      grossPaise: row['gross_paise'] as number,
      itemDiscountPaise: row['item_discount_paise'] as number,
      billDiscountPaise: row['bill_discount_paise'] as number,
      taxablePaise: row['taxable_paise'] as number,
      cgstPaise: row['cgst_paise'] as number,
      sgstPaise: row['sgst_paise'] as number,
      igstPaise: row['igst_paise'] as number,
      taxPaise: row['tax_paise'] as number,
      roundOffPaise: row['round_off_paise'] as number,
      totalPaise: total,
      paidPaise: paid,
      returnedPaise: returned,
      outstandingPaise: row['status'] === 'cancelled' ? 0 : total - returned - paid,
      status: row['status'] as 'completed' | 'cancelled',
      cancelledAt: (row['cancelled_at'] as string | null) ?? null,
      cancelReason: (row['cancel_reason'] as string | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
      lines,
      payments: payments.map((p) => ({
        id: p['id'] as string,
        paymentDate: p['payment_date'] as string,
        method: p['method'] as SupplierPaymentMethod,
        amountPaise: p['amount_paise'] as number,
        reference: (p['reference'] as string | null) ?? null,
      })) as PurchasePayment[],
      duplicate: false,
    };
  }

  searchPurchases(query: PurchaseQuery): {
    items: PurchaseSummary[];
    total: number;
    purchasedPaise: number;
    outstandingPaise: number;
  } {
    const where: string[] = ['p.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.search) {
      where.push(
        '(p.purchase_number LIKE @like OR p.supplier_bill_no LIKE @like' +
          ' OR p.supplier_name LIKE @like)',
      );
      params['like'] = `%${query.search}%`;
    }
    if (query.supplierId) {
      where.push('p.supplier_id = @supplierId');
      params['supplierId'] = query.supplierId;
    }
    if (query.fromIso) {
      where.push('p.purchase_date >= @fromIso');
      params['fromIso'] = query.fromIso;
    }
    if (query.toIso) {
      where.push('p.purchase_date <= @toIso');
      params['toIso'] = query.toIso;
    }
    if (query.status !== 'all') {
      where.push('p.status = @status');
      params['status'] = query.status;
    }

    const owedExpr = `
      p.total_paise
      - COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r WHERE r.purchase_id = p.id), 0)
      - COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
                   WHERE sp.purchase_id = p.id), 0)`;

    const filter = `WHERE ${where.join(' AND ')}`;
    const having = query.unpaidOnly ? `AND p.status = 'completed' AND (${owedExpr}) > 0` : '';

    const select = `
      SELECT p.id, p.purchase_number, p.supplier_bill_no, p.purchase_date, p.supplier_id,
             p.supplier_name, p.total_paise, p.status,
             (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
             COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp
                        WHERE sp.purchase_id = p.id), 0) AS paid_paise,
             COALESCE((SELECT SUM(r.total_paise) FROM purchase_returns r
                        WHERE r.purchase_id = p.id), 0) AS returned_paise,
             (${owedExpr}) AS outstanding_paise
        FROM purchases p ${filter} ${having}`;

    const rows = this.db
      .prepare(
        `${select} ORDER BY p.purchase_date DESC, p.purchase_number DESC
                 LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as {
      id: string;
      purchase_number: string;
      supplier_bill_no: string | null;
      purchase_date: string;
      supplier_id: string;
      supplier_name: string | null;
      total_paise: number;
      status: string;
      item_count: number;
      paid_paise: number;
      returned_paise: number;
      outstanding_paise: number;
    }[];

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total_paise ELSE 0 END), 0)
                  AS purchased,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN outstanding_paise ELSE 0 END), 0)
                  AS owed
           FROM (${select})`,
      )
      .get(params) as { total: number; purchased: number; owed: number };

    return {
      items: rows.map((r) => ({
        id: r.id,
        purchaseNumber: r.purchase_number,
        supplierBillNo: r.supplier_bill_no,
        purchaseDate: r.purchase_date,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        itemCount: r.item_count,
        totalPaise: r.total_paise,
        paidPaise: r.paid_paise,
        returnedPaise: r.returned_paise,
        outstandingPaise: r.status === 'cancelled' ? 0 : r.outstanding_paise,
        status: r.status as 'completed' | 'cancelled',
      })),
      total: totals.total,
      purchasedPaise: totals.purchased,
      outstandingPaise: totals.owed,
    };
  }

  // ─── Purchase returns ─────────────────────────────────────────────────────

  findReturnByIdempotencyKey(key: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM purchase_returns WHERE idempotency_key = ?')
      .get(key) as { id: string } | undefined;
    return row?.id ?? null;
  }

  insertReturn(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO purchase_returns (id, company_id, branch_id, purchase_id, supplier_id,
           operator_id, return_number, financial_year, return_date, reason, taxable_paise,
           cgst_paise, sgst_paise, igst_paise, tax_paise, round_off_paise, total_paise,
           settlement, idempotency_key, created_at)
         VALUES (@id, @companyId, @branchId, @purchaseId, @supplierId,
           @operatorId, @returnNumber, @financialYear, @returnDate, @reason, @taxablePaise,
           @cgstPaise, @sgstPaise, @igstPaise, @taxPaise, @roundOffPaise, @totalPaise,
           @settlement, @idempotencyKey, @returnDate)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertReturnItem(input: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO purchase_return_items (id, return_id, purchase_item_id, product_id,
           quantity_milli, unit_cost_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise,
           tax_paise, total_paise, created_at)
         VALUES (@id, @returnId, @purchaseItemId, @productId,
           @quantityMilli, @unitCostPaise, @taxablePaise, @cgstPaise, @sgstPaise, @igstPaise,
           @taxPaise, @totalPaise, @at)`,
      )
      .run({ ...input, id: newId() });
  }

  findReturn(id: string): PurchaseReturnReceipt | null {
    const row = this.db
      .prepare(
        `SELECT r.*, p.purchase_number, s.name AS supplier_name
           FROM purchase_returns r
           JOIN purchases p ON p.id = r.purchase_id
           JOIN suppliers s ON s.id = r.supplier_id
          WHERE r.id = ? AND r.company_id = ?`,
      )
      .get(id, this.companyId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const items = this.db
      .prepare(
        `SELECT ri.*, pi.name, pi.unit_code
           FROM purchase_return_items ri
           JOIN purchase_items pi ON pi.id = ri.purchase_item_id
          WHERE ri.return_id = ? ORDER BY pi.line_no`,
      )
      .all(id) as Record<string, unknown>[];

    const lines: PurchaseReturnLine[] = items.map((item) => ({
      purchaseItemId: item['purchase_item_id'] as string,
      productId: (item['product_id'] as string | null) ?? null,
      name: item['name'] as string,
      unitCode: item['unit_code'] as string,
      quantityMilli: item['quantity_milli'] as number,
      unitCostPaise: item['unit_cost_paise'] as number,
      taxablePaise: item['taxable_paise'] as number,
      cgstPaise: item['cgst_paise'] as number,
      sgstPaise: item['sgst_paise'] as number,
      igstPaise: item['igst_paise'] as number,
      taxPaise: item['tax_paise'] as number,
      totalPaise: item['total_paise'] as number,
    }));

    return {
      id,
      returnNumber: row['return_number'] as string,
      returnDate: row['return_date'] as string,
      purchaseId: row['purchase_id'] as string,
      purchaseNumber: row['purchase_number'] as string,
      supplierId: row['supplier_id'] as string,
      supplierName: (row['supplier_name'] as string | null) ?? null,
      reason: row['reason'] as string,
      settlement: row['settlement'] as PurchaseSettlement,
      taxablePaise: row['taxable_paise'] as number,
      cgstPaise: row['cgst_paise'] as number,
      sgstPaise: row['sgst_paise'] as number,
      igstPaise: row['igst_paise'] as number,
      taxPaise: row['tax_paise'] as number,
      roundOffPaise: row['round_off_paise'] as number,
      totalPaise: row['total_paise'] as number,
      lines,
      duplicate: false,
    };
  }

  // ─── Supplier money ───────────────────────────────────────────────────────

  insertSupplierPayment(input: {
    supplierId: string;
    purchaseId: string | null;
    branchId: string;
    operatorId: string | null;
    method: SupplierPaymentMethod;
    amountPaise: number;
    reference: string | null;
    notes: string | null;
    at: string;
  }): string {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO supplier_payments (id, company_id, branch_id, supplier_id, purchase_id,
           operator_id, payment_date, method, amount_paise, reference, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.companyId,
        input.branchId,
        input.supplierId,
        input.purchaseId,
        input.operatorId,
        input.at,
        input.method,
        input.amountPaise,
        input.reference,
        input.notes,
        input.at,
      );
    return id;
  }

  supplierPayments(supplierId: string, limit = 50): SupplierPayment[] {
    const rows = this.db
      .prepare(
        `SELECT sp.*, p.purchase_number
           FROM supplier_payments sp
           LEFT JOIN purchases p ON p.id = sp.purchase_id
          WHERE sp.supplier_id = ?
          ORDER BY sp.payment_date DESC, sp.created_at DESC
          LIMIT ?`,
      )
      .all(supplierId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r['id'] as string,
      paymentDate: r['payment_date'] as string,
      supplierId: r['supplier_id'] as string,
      purchaseId: (r['purchase_id'] as string | null) ?? null,
      purchaseNumber: (r['purchase_number'] as string | null) ?? null,
      method: r['method'] as SupplierPaymentMethod,
      amountPaise: r['amount_paise'] as number,
      reference: (r['reference'] as string | null) ?? null,
      notes: (r['notes'] as string | null) ?? null,
    }));
  }
}
