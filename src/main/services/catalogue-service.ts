/**
 * Catalogue service: products, categories and stock adjustments.
 *
 * Duplicate SKU and barcode checks live here rather than relying on the unique
 * index alone, so the operator gets a field-level message naming the clashing
 * product instead of a constraint error.
 */
import type { Database } from 'better-sqlite3';
import {
  productInputSchema,
  productUpdateSchema,
  productQuerySchema,
  stockAdjustmentSchema,
  categoryInputSchema,
  type Category,
  type CsvImportResult,
  type CsvRowError,
  type Product,
  type ProductInput,
  type ProductPage,
  type ProductQuery,
  type ProductUpdate,
  type StockAdjustment,
  type Unit,
} from '@shared/catalogue';
import { parseRupees, paiseToDecimalString } from '@shared/money';
import { parseQuantity, formatQuantity, precisionFor } from '@shared/quantity';
import { parseCsv, toCsv } from '@shared/csv';
import { CatalogueRepository } from '../db/repositories/catalogue';
import { newId, now, inTransaction } from '../db/repositories/base';

export class CatalogueError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'CatalogueError';
  }
}

interface Context {
  companyId: string;
  branchId: string;
  operatorId: string | null;
}

/** Reads the single company/branch/operator a v1 install has. */
function loadContext(db: Database): Context {
  const row = db
    .prepare(
      `SELECT c.id AS company_id, b.id AS branch_id,
              (SELECT o.id FROM operators o WHERE o.branch_id = b.id ORDER BY o.created_at LIMIT 1) AS operator_id
         FROM companies c
         JOIN branches b ON b.company_id = c.id
        ORDER BY c.created_at LIMIT 1`,
    )
    .get() as { company_id: string; branch_id: string; operator_id: string | null } | undefined;

  if (!row)
    throw new CatalogueError('SETUP_INCOMPLETE', 'Complete setup before managing products.');
  return { companyId: row.company_id, branchId: row.branch_id, operatorId: row.operator_id };
}

export class CatalogueService {
  private readonly ctx: Context;
  private readonly repo: CatalogueRepository;

  constructor(private readonly db: Database) {
    this.ctx = loadContext(db);
    this.repo = new CatalogueRepository(db, this.ctx.companyId);
  }

  // ─── Units and categories ─────────────────────────────────────────────────

  listUnits(): Unit[] {
    return this.repo.listUnits();
  }

  listCategories(): Category[] {
    return this.repo.listCategories();
  }

  createCategory(input: unknown): Category[] {
    const { name } = categoryInputSchema.parse(input);
    const clash = this.repo
      .listCategories()
      .find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new CatalogueError('DUPLICATE_CATEGORY', `"${name}" already exists.`, 'name');

    this.repo.createCategory(name);
    return this.repo.listCategories();
  }

  renameCategory(id: string, name: string): Category[] {
    const parsed = categoryInputSchema.parse({ name });
    const clash = this.repo
      .listCategories()
      .find((c) => c.id !== id && c.name.toLowerCase() === parsed.name.toLowerCase());
    if (clash)
      throw new CatalogueError('DUPLICATE_CATEGORY', `"${parsed.name}" already exists.`, 'name');

    this.repo.renameCategory(id, parsed.name);
    return this.repo.listCategories();
  }

  /** Deletes when unused; otherwise deactivates, so products keep their link. */
  removeCategory(id: string): { deleted: boolean; categories: Category[] } {
    const deleted = this.repo.deleteCategoryIfUnused(id);
    if (!deleted) this.repo.setCategoryActive(id, false);
    return { deleted, categories: this.repo.listCategories() };
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  search(input: unknown): ProductPage {
    const query: ProductQuery = productQuerySchema.parse(input ?? {});
    const { items, total } = this.repo.search(query);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  get(id: string): Product | null {
    return this.repo.findById(id);
  }

  /** Rejects a SKU or barcode already used by a different product. */
  private assertNoDuplicate(
    input: { sku?: string | undefined; barcode?: string | undefined },
    excludeId?: string,
  ): void {
    const sku = input.sku?.trim();
    if (sku) {
      const existing = this.repo.findBySku(sku);
      if (existing && existing.id !== excludeId) {
        throw new CatalogueError(
          'DUPLICATE_SKU',
          `SKU "${sku}" is already used by ${existing.name}.`,
          'sku',
        );
      }
    }

    const barcode = input.barcode?.trim();
    if (barcode) {
      const existing = this.repo.findByBarcode(barcode);
      if (existing && existing.id !== excludeId) {
        throw new CatalogueError(
          'DUPLICATE_BARCODE',
          `Barcode "${barcode}" is already used by ${existing.name}.`,
          'barcode',
        );
      }
    }
  }

  create(input: unknown): Product {
    const parsed: ProductInput = productInputSchema.parse(input);
    this.assertNoDuplicate(parsed);

    return inTransaction(this.db, () => {
      const id = this.repo.create(parsed);

      // Opening stock is a movement like any other, so the ledger explains the
      // whole balance from the first day.
      if (parsed.trackInventory && parsed.openingStockMilli > 0) {
        this.repo.recordMovement({
          branchId: this.ctx.branchId,
          productId: id,
          movementType: 'opening',
          quantityMilli: parsed.openingStockMilli,
          unitCostPaise: parsed.costPaise || null,
          reason: 'Opening stock',
          operatorId: this.ctx.operatorId,
        });
      }

      const created = this.repo.findById(id);
      if (!created) throw new CatalogueError('CREATE_FAILED', 'Product could not be read back.');
      return created;
    });
  }

  update(input: unknown): Product {
    const parsed: ProductUpdate = productUpdateSchema.parse(input);
    const existing = this.repo.findById(parsed.id);
    if (!existing) throw new CatalogueError('NOT_FOUND', 'Product not found.');

    this.assertNoDuplicate(parsed, parsed.id);
    this.repo.update(parsed);

    const updated = this.repo.findById(parsed.id);
    if (!updated) throw new CatalogueError('UPDATE_FAILED', 'Product could not be read back.');
    return updated;
  }

  setActive(id: string, isActive: boolean): Product {
    const existing = this.repo.findById(id);
    if (!existing) throw new CatalogueError('NOT_FOUND', 'Product not found.');

    this.repo.setActive(id, isActive);
    const updated = this.repo.findById(id);
    if (!updated) throw new CatalogueError('UPDATE_FAILED', 'Product could not be read back.');
    return updated;
  }

  /**
   * Deletes only a product nothing references. Anything with history is
   * deactivated instead, so old invoices and the stock ledger stay intact.
   */
  remove(id: string): { deleted: boolean } {
    const existing = this.repo.findById(id);
    if (!existing) throw new CatalogueError('NOT_FOUND', 'Product not found.');

    if (this.repo.isReferenced(id)) {
      this.repo.setActive(id, false);
      return { deleted: false };
    }

    this.repo.delete(id);
    return { deleted: true };
  }

  // ─── Stock ────────────────────────────────────────────────────────────────

  adjustStock(input: unknown): Product {
    const parsed: StockAdjustment = stockAdjustmentSchema.parse(input);
    const product = this.repo.findById(parsed.productId);
    if (!product) throw new CatalogueError('NOT_FOUND', 'Product not found.');

    if (!product.trackInventory) {
      throw new CatalogueError(
        'NOT_TRACKED',
        `${product.name} is a service item; its stock is not tracked.`,
      );
    }

    const resulting = product.stockMilli + parsed.deltaMilli;
    if (resulting < 0) {
      throw new CatalogueError(
        'NEGATIVE_STOCK',
        `That would leave ${formatQuantity(resulting, precisionFor(product.unitCode))} ` +
          `${product.unitCode}. Current stock is ${formatQuantity(product.stockMilli, precisionFor(product.unitCode))}.`,
        'deltaMilli',
      );
    }

    return inTransaction(this.db, () => {
      this.repo.recordMovement({
        branchId: this.ctx.branchId,
        productId: parsed.productId,
        movementType: 'adjustment',
        quantityMilli: parsed.deltaMilli,
        reason: parsed.reason,
        operatorId: this.ctx.operatorId,
      });

      this.db
        .prepare(
          `INSERT INTO audit_logs (id, entity_type, entity_id, action, operator_id, details, created_at)
           VALUES (?, 'product', ?, 'stock_adjusted', ?, ?, ?)`,
        )
        .run(
          newId(),
          parsed.productId,
          this.ctx.operatorId,
          JSON.stringify({
            delta: parsed.deltaMilli,
            reason: parsed.reason,
            before: product.stockMilli,
            after: resulting,
          }),
          now(),
        );

      const updated = this.repo.findById(parsed.productId);
      if (!updated) throw new CatalogueError('UPDATE_FAILED', 'Product could not be read back.');
      return updated;
    });
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────

  static readonly CSV_HEADERS = [
    'sku',
    'barcode',
    'name',
    'category',
    'brand',
    'hsn',
    'unit',
    'cost',
    'price',
    'mrp',
    'tax_rate',
    'tax_inclusive',
    'track_inventory',
    'reorder_level',
    'opening_stock',
  ] as const;

  exportCsv(): string {
    const { items } = this.repo.search(
      productQuerySchema.parse({ status: 'all', pageSize: 200, page: 1 }),
    );

    // Export every product, not just the first page.
    const all: Product[] = [...items];
    let page = 2;
    for (;;) {
      const next = this.repo.search(
        productQuerySchema.parse({ status: 'all', pageSize: 200, page }),
      );
      if (next.items.length === 0) break;
      all.push(...next.items);
      page += 1;
      if (page > 500) break; // 100k products: a sane ceiling
    }

    const rows: (string | number | null)[][] = [
      [...CatalogueService.CSV_HEADERS],
      ...all.map((p) => [
        p.sku,
        p.barcode,
        p.name,
        p.categoryName,
        p.brand,
        p.hsn,
        p.unitCode,
        paiseToDecimalString(p.costPaise),
        paiseToDecimalString(p.pricePaise),
        p.mrpPaise === null ? '' : paiseToDecimalString(p.mrpPaise),
        (p.taxRateBp / 100).toFixed(2),
        p.taxInclusive ? 'yes' : 'no',
        p.trackInventory ? 'yes' : 'no',
        formatQuantity(p.reorderLevelMilli, precisionFor(p.unitCode)),
        formatQuantity(p.stockMilli, precisionFor(p.unitCode)),
      ]),
    ];

    return toCsv(rows);
  }

  importCsv(input: { csv: string; updateExisting: boolean }): CsvImportResult {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) {
      throw new CatalogueError('EMPTY_CSV', 'The file has no data rows.');
    }

    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const columnOf = (name: string): number => header.indexOf(name);

    if (columnOf('name') === -1 || columnOf('price') === -1) {
      throw new CatalogueError(
        'MISSING_COLUMNS',
        'The file must have at least "name" and "price" columns.',
      );
    }

    const units = new Set(this.repo.listUnits().map((u) => u.code));
    const categories = new Map(
      this.repo.listCategories().map((c) => [c.name.toLowerCase(), c.id] as const),
    );

    const errors: CsvRowError[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // One transaction for the whole file: a half-imported catalogue is worse
    // than none, because the operator cannot tell what landed.
    inTransaction(this.db, () => {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as string[];
        const rowNumber = i + 1;
        const cell = (name: string): string => {
          const index = columnOf(name);
          return index === -1 ? '' : (row[index] ?? '').trim();
        };

        const name = cell('name');
        if (!name) {
          errors.push({ row: rowNumber, field: 'name', message: 'Name is required' });
          skipped += 1;
          continue;
        }

        const pricePaise = parseRupees(cell('price'));
        if (pricePaise === null || pricePaise < 0) {
          errors.push({
            row: rowNumber,
            field: 'price',
            message: `Invalid price "${cell('price')}"`,
          });
          skipped += 1;
          continue;
        }

        const unitCode = cell('unit') || 'pc';
        if (!units.has(unitCode)) {
          errors.push({ row: rowNumber, field: 'unit', message: `Unknown unit "${unitCode}"` });
          skipped += 1;
          continue;
        }

        const costText = cell('cost');
        const costPaise = costText ? parseRupees(costText) : 0;
        if (costPaise === null) {
          errors.push({ row: rowNumber, field: 'cost', message: `Invalid cost "${costText}"` });
          skipped += 1;
          continue;
        }

        const mrpText = cell('mrp');
        const mrpPaise = mrpText ? parseRupees(mrpText) : null;
        if (mrpText && mrpPaise === null) {
          errors.push({ row: rowNumber, field: 'mrp', message: `Invalid MRP "${mrpText}"` });
          skipped += 1;
          continue;
        }

        const taxText = cell('tax_rate');
        const taxPercent = taxText ? Number(taxText) : 0;
        if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
          errors.push({
            row: rowNumber,
            field: 'tax_rate',
            message: `Invalid tax rate "${taxText}"`,
          });
          skipped += 1;
          continue;
        }

        const precision = precisionFor(unitCode);
        const openingText = cell('opening_stock');
        const openingMilli = openingText ? parseQuantity(openingText, precision) : 0;
        if (openingText && openingMilli === null) {
          errors.push({
            row: rowNumber,
            field: 'opening_stock',
            message: `Invalid quantity "${openingText}" for unit ${unitCode}`,
          });
          skipped += 1;
          continue;
        }

        const reorderText = cell('reorder_level');
        const reorderMilli = reorderText ? parseQuantity(reorderText, precision) : 0;
        if (reorderText && reorderMilli === null) {
          errors.push({
            row: rowNumber,
            field: 'reorder_level',
            message: `Invalid reorder level "${reorderText}"`,
          });
          skipped += 1;
          continue;
        }

        // Categories named in the file are created as needed.
        const categoryName = cell('category');
        let categoryId: string | null = null;
        if (categoryName) {
          const key = categoryName.toLowerCase();
          const found = categories.get(key);
          if (found) {
            categoryId = found;
          } else {
            categoryId = this.repo.createCategory(categoryName);
            categories.set(key, categoryId);
          }
        }

        const sku = cell('sku');
        const barcode = cell('barcode');
        const existing = sku
          ? this.repo.findBySku(sku)
          : barcode
            ? this.repo.findByBarcode(barcode)
            : null;

        const yesNo = (value: string, fallback: boolean): boolean =>
          value === '' ? fallback : ['yes', 'y', 'true', '1'].includes(value.toLowerCase());

        const base = {
          sku,
          barcode,
          name,
          description: cell('description'),
          categoryId,
          brand: cell('brand'),
          hsn: cell('hsn'),
          unitCode,
          costPaise: costPaise ?? 0,
          pricePaise,
          mrpPaise,
          taxRateBp: Math.round(taxPercent * 100),
          taxInclusive: yesNo(cell('tax_inclusive'), true),
          trackInventory: yesNo(cell('track_inventory'), true),
          reorderLevelMilli: reorderMilli ?? 0,
          isActive: true,
        };

        if (existing) {
          if (!input.updateExisting) {
            errors.push({
              row: rowNumber,
              field: sku ? 'sku' : 'barcode',
              message: `"${sku || barcode}" already exists; enable "update existing" to overwrite`,
            });
            skipped += 1;
            continue;
          }
          this.repo.update({ ...base, id: existing.id });
          updated += 1;
          continue;
        }

        const id = this.repo.create({ ...base, openingStockMilli: openingMilli ?? 0 });
        if (base.trackInventory && (openingMilli ?? 0) > 0) {
          this.repo.recordMovement({
            branchId: this.ctx.branchId,
            productId: id,
            movementType: 'opening',
            quantityMilli: openingMilli as number,
            unitCostPaise: base.costPaise || null,
            reason: 'Opening stock (CSV import)',
            operatorId: this.ctx.operatorId,
          });
        }
        imported += 1;
      }
    });

    return { imported, updated, skipped, errors };
  }

  /** A ready-to-fill template, so a shop is not guessing at column names. */
  csvTemplate(): string {
    return toCsv([
      [...CatalogueService.CSV_HEADERS],
      [
        'RICE5',
        '8901234567890',
        'Basmati Rice 5kg',
        'Grocery',
        'India Gate',
        '1006',
        'pc',
        '380.00',
        '499.00',
        '550.00',
        '5.00',
        'yes',
        'yes',
        '10',
        '50',
      ],
      [
        'SUGAR1',
        '',
        'Sugar',
        'Grocery',
        '',
        '1701',
        'kg',
        '38.00',
        '45.00',
        '',
        '5.00',
        'yes',
        'yes',
        '5',
        '25.5',
      ],
    ]);
  }
}
