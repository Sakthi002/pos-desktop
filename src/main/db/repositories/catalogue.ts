/**
 * Catalogue repository.
 *
 * Stock is never stored on the product: it is summed from inventory_movements,
 * so a balance cannot drift from the ledger that explains it.
 */
import type { Database } from 'better-sqlite3';
import type {
  Category,
  Product,
  ProductInput,
  ProductQuery,
  ProductUpdate,
  Unit,
} from '@shared/catalogue';
import type { ValuationMethod } from '@shared/batches';
import { Repository, newId, now, toDbBool, fromDbBool } from './base';

interface ProductRow {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  brand: string | null;
  hsn: string | null;
  unit_code: string;
  cost_paise: number;
  price_paise: number;
  mrp_paise: number | null;
  tax_rate_bp: number;
  tax_inclusive: number;
  track_inventory: number;
  tracks_batches: number;
  valuation_method: string;
  reorder_level_milli: number;
  is_active: number;
  stock_milli: number | null;
  created_at: string;
  updated_at: string;
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  sku: row.sku,
  barcode: row.barcode,
  name: row.name,
  description: row.description,
  categoryId: row.category_id,
  categoryName: row.category_name,
  brand: row.brand,
  hsn: row.hsn,
  unitCode: row.unit_code,
  costPaise: row.cost_paise,
  pricePaise: row.price_paise,
  mrpPaise: row.mrp_paise,
  taxRateBp: row.tax_rate_bp,
  taxInclusive: fromDbBool(row.tax_inclusive),
  trackInventory: fromDbBool(row.track_inventory),
  tracksBatches: fromDbBool(row.tracks_batches),
  valuationMethod: row.valuation_method as ValuationMethod,
  reorderLevelMilli: row.reorder_level_milli,
  isActive: fromDbBool(row.is_active),
  stockMilli: row.stock_milli ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Empty strings from form inputs become NULL, so partial unique indexes work. */
const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name,
         (SELECT COALESCE(SUM(m.quantity_milli), 0)
            FROM inventory_movements m
           WHERE m.product_id = p.id) AS stock_milli
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
`;

export class CatalogueRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  // ─── Units ────────────────────────────────────────────────────────────────

  listUnits(): Unit[] {
    const rows = this.db
      .prepare(
        'SELECT code, name, decimal_places, is_active FROM units WHERE is_active = 1 ORDER BY name',
      )
      .all() as { code: string; name: string; decimal_places: number; is_active: number }[];
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      decimalPlaces: r.decimal_places,
      isActive: fromDbBool(r.is_active),
    }));
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  listCategories(): Category[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.is_active, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
           FROM categories c
          WHERE c.company_id = ?
          ORDER BY c.name`,
      )
      .all(this.companyId) as {
      id: string;
      name: string;
      is_active: number;
      created_at: string;
      updated_at: string;
      product_count: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: fromDbBool(r.is_active),
      productCount: r.product_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  createCategory(name: string): string {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        'INSERT INTO categories (id, company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, this.companyId, name, t, t);
    return id;
  }

  renameCategory(id: string, name: string): void {
    this.db
      .prepare('UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND company_id = ?')
      .run(name, now(), id, this.companyId);
  }

  setCategoryActive(id: string, isActive: boolean): void {
    this.db
      .prepare(
        'UPDATE categories SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?',
      )
      .run(toDbBool(isActive), now(), id, this.companyId);
  }

  /** Only possible while nothing references it; otherwise deactivate. */
  deleteCategoryIfUnused(id: string): boolean {
    const inUse = this.db
      .prepare('SELECT 1 AS used FROM products WHERE category_id = ? LIMIT 1')
      .get(id);
    if (inUse) return false;

    this.db
      .prepare('DELETE FROM categories WHERE id = ? AND company_id = ?')
      .run(id, this.companyId);
    return true;
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  findById(id: string): Product | null {
    const row = this.db
      .prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.company_id = ?`)
      .get(id, this.companyId) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  }

  findBySku(sku: string): Product | null {
    const row = this.db
      .prepare(`${PRODUCT_SELECT} WHERE p.company_id = ? AND p.sku = ?`)
      .get(this.companyId, sku) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  }

  findByBarcode(barcode: string): Product | null {
    const row = this.db
      .prepare(`${PRODUCT_SELECT} WHERE p.company_id = ? AND p.barcode = ?`)
      .get(this.companyId, barcode) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  }

  search(query: ProductQuery): { items: Product[]; total: number } {
    const where: string[] = ['p.company_id = @companyId'];
    const params: Record<string, unknown> = { companyId: this.companyId };

    if (query.search) {
      where.push(
        '(p.name LIKE @like OR p.sku LIKE @like OR p.barcode LIKE @like OR p.brand LIKE @like)',
      );
      params['like'] = `%${query.search}%`;
    }
    if (query.categoryId) {
      where.push('p.category_id = @categoryId');
      params['categoryId'] = query.categoryId;
    }
    if (query.status === 'active') where.push('p.is_active = 1');
    if (query.status === 'inactive') where.push('p.is_active = 0');

    // Low stock compares the derived balance against the product's reorder level,
    // and only applies to items whose stock is tracked.
    // Applied outside the subquery, so it refers to output columns rather than
    // the `p.` aliases, and can use the derived stock_milli.
    //
    // Low stock means: still sold (active), stock is tracked, a reorder level
    // was actually set, and the balance has reached it. Without the
    // reorder_level_milli > 0 test, every product left at the default 0 would
    // appear the moment it hit zero stock, which buries the real warnings.
    const having =
      query.status === 'low-stock'
        ? `WHERE is_active = 1
             AND track_inventory = 1
             AND reorder_level_milli > 0
             AND stock_milli <= reorder_level_milli`
        : '';

    // The result is always wrapped in a subquery, so ORDER BY must name the
    // output columns, not the `p.` aliases that only exist inside it.
    const sortColumn = {
      name: 'name',
      sku: 'sku',
      price: 'price_paise',
      stock: 'stock_milli',
      updated: 'updated_at',
    }[query.sort];
    const direction = query.direction === 'desc' ? 'DESC' : 'ASC';

    const base = `${PRODUCT_SELECT} WHERE ${where.join(' AND ')}`;
    const filtered = having ? `SELECT * FROM (${base}) ${having}` : base;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM (${filtered})`).get(params) as { n: number }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT * FROM (${filtered}) ORDER BY ${sortColumn} ${direction} LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as ProductRow[];

    return { items: rows.map(toProduct), total };
  }

  create(input: ProductInput): string {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO products (id, company_id, sku, barcode, name, description, category_id, brand,
           hsn, unit_code, cost_paise, price_paise, mrp_paise, tax_rate_bp, tax_inclusive,
           track_inventory, tracks_batches, valuation_method,
           reorder_level_milli, is_active, created_at, updated_at)
         VALUES (@id, @company_id, @sku, @barcode, @name, @description, @category_id, @brand,
           @hsn, @unit_code, @cost_paise, @price_paise, @mrp_paise, @tax_rate_bp, @tax_inclusive,
           @track_inventory, @tracks_batches, @valuation_method,
           @reorder_level_milli, @is_active, @t, @t)`,
      )
      .run({
        id,
        company_id: this.companyId,
        sku: nullIfBlank(input.sku),
        barcode: nullIfBlank(input.barcode),
        name: input.name,
        description: nullIfBlank(input.description),
        category_id: input.categoryId ?? null,
        brand: nullIfBlank(input.brand),
        hsn: nullIfBlank(input.hsn),
        unit_code: input.unitCode,
        cost_paise: input.costPaise,
        price_paise: input.pricePaise,
        mrp_paise: input.mrpPaise ?? null,
        tax_rate_bp: input.taxRateBp,
        tax_inclusive: toDbBool(input.taxInclusive),
        track_inventory: toDbBool(input.trackInventory),
        tracks_batches: toDbBool(input.tracksBatches),
        valuation_method: input.valuationMethod,
        reorder_level_milli: input.reorderLevelMilli,
        is_active: toDbBool(input.isActive),
        t,
      });
    return id;
  }

  update(input: ProductUpdate): void {
    this.db
      .prepare(
        `UPDATE products SET sku = @sku, barcode = @barcode, name = @name, description = @description,
           category_id = @category_id, brand = @brand, hsn = @hsn, unit_code = @unit_code,
           cost_paise = @cost_paise, price_paise = @price_paise, mrp_paise = @mrp_paise,
           tax_rate_bp = @tax_rate_bp, tax_inclusive = @tax_inclusive,
           track_inventory = @track_inventory, tracks_batches = @tracks_batches,
           valuation_method = @valuation_method, reorder_level_milli = @reorder_level_milli,
           is_active = @is_active, updated_at = @t
         WHERE id = @id AND company_id = @company_id`,
      )
      .run({
        id: input.id,
        company_id: this.companyId,
        sku: nullIfBlank(input.sku),
        barcode: nullIfBlank(input.barcode),
        name: input.name,
        description: nullIfBlank(input.description),
        category_id: input.categoryId ?? null,
        brand: nullIfBlank(input.brand),
        hsn: nullIfBlank(input.hsn),
        unit_code: input.unitCode,
        cost_paise: input.costPaise,
        price_paise: input.pricePaise,
        mrp_paise: input.mrpPaise ?? null,
        tax_rate_bp: input.taxRateBp,
        tax_inclusive: toDbBool(input.taxInclusive),
        track_inventory: toDbBool(input.trackInventory),
        tracks_batches: toDbBool(input.tracksBatches),
        valuation_method: input.valuationMethod,
        reorder_level_milli: input.reorderLevelMilli,
        is_active: toDbBool(input.isActive),
        t: now(),
      });
  }

  setActive(id: string, isActive: boolean): void {
    this.db
      .prepare('UPDATE products SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?')
      .run(toDbBool(isActive), now(), id, this.companyId);
  }

  /** True when any transaction references the product, so it must not be deleted. */
  isReferenced(id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS used FROM sale_items WHERE product_id = ?
          UNION ALL
         SELECT 1 FROM inventory_movements WHERE product_id = ?
          LIMIT 1`,
      )
      .get(id, id);
    return row !== undefined;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM products WHERE id = ? AND company_id = ?').run(id, this.companyId);
  }

  stockOf(productId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(quantity_milli), 0) AS qty FROM inventory_movements WHERE product_id = ?',
      )
      .get(productId) as { qty: number };
    return row.qty;
  }

  recordMovement(args: {
    branchId: string;
    productId: string;
    movementType: 'opening' | 'sale' | 'sale_return' | 'adjustment' | 'purchase' | 'damage';
    quantityMilli: number;
    unitCostPaise?: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    operatorId?: string | null;
    /** The batch this quantity belongs to, for a product that keeps them. */
    batchId?: string | null;
  }): string {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO inventory_movements (id, company_id, branch_id, product_id, movement_type,
           quantity_milli, unit_cost_paise, reference_type, reference_id, reason, operator_id,
           batch_id, created_at)
         VALUES (@id, @company_id, @branch_id, @product_id, @movement_type,
           @quantity_milli, @unit_cost_paise, @reference_type, @reference_id, @reason, @operator_id,
           @batch_id, @t)`,
      )
      .run({
        id,
        company_id: this.companyId,
        branch_id: args.branchId,
        product_id: args.productId,
        movement_type: args.movementType,
        quantity_milli: args.quantityMilli,
        unit_cost_paise: args.unitCostPaise ?? null,
        reference_type: args.referenceType ?? null,
        reference_id: args.referenceId ?? null,
        reason: args.reason ?? null,
        operator_id: args.operatorId ?? null,
        batch_id: args.batchId ?? null,
        t: now(),
      });
    return id;
  }
}
