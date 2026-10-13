import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { CustomerService } from '../customer-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { ReportService, ReportError } from '../report-service';
import { defaultSettings } from '@shared/settings';
import type { ReportRow, ReportTable } from '@shared/reports';

let db: Database;
let catalogue: CatalogueService;
let customers: CustomerService;
let sales: SaleService;
let returns: ReturnService;
let reports: ReportService;
let riceId: string;
let soapId: string;

/** The whole of time, so a report sees everything the test wrote. */
const EVERYTHING = {
  fromIso: '2000-01-01T00:00:00.000Z',
  toIso: '2100-01-01T00:00:00.000Z',
};

const cell = (table: ReportTable, rowIndex: number, key: string): ReportRow[string] =>
  table.rows[rowIndex]?.[key] ?? null;

const findRow = (table: ReportTable, key: string, value: string): ReportRow | undefined =>
  table.rows.find((r) => r[key] === value);

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  const grocery = catalogue.createCategory({ name: 'Grocery' })[0]!;
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    categoryId: grocery.id,
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 2000,
    isActive: true,
    openingStockMilli: 20000,
  }).id;
  soapId = catalogue.create({
    name: 'Bath Soap',
    sku: 'SOAP1',
    unitCode: 'pc',
    pricePaise: 5000,
    costPaise: 3000,
    taxRateBp: 1800,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 20000,
  }).id;

  customers = new CustomerService(db);
  sales = new SaleService(db);
  returns = new ReturnService(db);
  reports = new ReportService(db);
});

afterEach(() => {
  db.close();
});

const sellRice = (qtyMilli = 2000, overrides: Record<string, unknown> = {}) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    lines: [
      { productId: riceId, quantityMilli: qtyMilli, unitPricePaise: 10000, discountPaise: 0 },
    ],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash' as const, amountPaise: (10000 * qtyMilli) / 1000 }],
    ...overrides,
  });

const firstItemOf = (saleId: string): string =>
  (
    db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY line_no').get(saleId) as {
      id: string;
    }
  ).id;

describe('sales summary', () => {
  it('counts completed sales and nets off returns', () => {
    const kept = sellRice(2000);
    const returned = sellRice(1000);
    const voided = sellRice(1000);
    sales.voidSale({ id: voided.id, reason: 'Keyed twice' });
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: returned.id,
      reason: 'Wrong item',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(returned.id), quantityMilli: 1000, restock: true }],
    });

    const table = reports.run({ kind: 'sales-summary', ...EVERYTHING });

    expect(findRow(table, 'metric', 'Invoices')?.['count']).toBe(2);
    expect(findRow(table, 'metric', 'Sales total')?.['value']).toBe(
      kept.bill.totalPaise + returned.bill.totalPaise,
    );
    expect(findRow(table, 'metric', 'Returns')?.['value']).toBe(-credit.totalPaise);
    expect(findRow(table, 'metric', 'Net takings')?.['value']).toBe(
      kept.bill.totalPaise + returned.bill.totalPaise - credit.totalPaise,
    );
    expect(table.note).toMatch(/estimate/i);
  });

  it('estimates gross profit from taxable value less cost', () => {
    const sale = sellRice(2000);
    const table = reports.run({ kind: 'sales-summary', ...EVERYTHING });

    // Two units at ₹70 cost against the ex-tax value of the sale.
    expect(findRow(table, 'metric', 'Estimated gross profit')?.['value']).toBe(
      sale.bill.taxablePaise - 14000,
    );
  });

  it('agrees with the product report about estimated profit', () => {
    const sale = sellRice(3000);
    returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Spoiled',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: false }],
    });

    const summary = reports.run({ kind: 'sales-summary', ...EVERYTHING });
    const products = reports.run({ kind: 'product-wise', ...EVERYTHING });

    expect(findRow(summary, 'metric', 'Estimated gross profit')?.['value']).toBe(
      products.totals?.['profit'],
    );
  });

  it('refuses to run without a date range', () => {
    expect(() => reports.run({ kind: 'sales-summary' })).toThrow(ReportError);
  });
});

describe('daily sales', () => {
  it('buckets invoices by day and totals the range', () => {
    const today = sellRice(2000);
    const earlier = sellRice(1000);
    db.prepare('UPDATE sales SET invoice_date = ? WHERE id = ?').run(
      new Date(Date.now() - 2 * 86_400_000).toISOString(),
      earlier.id,
    );

    const table = reports.run({ kind: 'daily-sales', ...EVERYTHING });

    expect(table.rows).toHaveLength(2);
    expect(table.totals?.['total']).toBe(today.bill.totalPaise + earlier.bill.totalPaise);
    expect(table.totals?.['invoices']).toBe(2);
    // Newest day first.
    expect(cell(table, 0, 'total')).toBe(today.bill.totalPaise);
  });

  it('nets returns against the day the credit note was raised', () => {
    const sale = sellRice(2000);
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Damaged',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: false }],
    });

    const table = reports.run({ kind: 'daily-sales', ...EVERYTHING });
    expect(cell(table, 0, 'returns')).toBe(credit.totalPaise);
    expect(cell(table, 0, 'net')).toBe(sale.bill.totalPaise - credit.totalPaise);
  });
});

describe('product and category reports', () => {
  it('reports quantity, value and estimated profit per product', () => {
    sellRice(3000);
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: soapId, quantityMilli: 2000, unitPricePaise: 5000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    const table = reports.run({ kind: 'product-wise', ...EVERYTHING });
    const rice = findRow(table, 'name', 'Basmati Rice 5kg');

    expect(rice?.['qty']).toBe('3 pc');
    expect(rice?.['total']).toBe(30000);
    // Taxable 28571 less 3 × ₹70 cost.
    expect(rice?.['profit']).toBe(28571 - 21000);
    expect(table.rows).toHaveLength(2);
  });

  it('shows what came back against a product', () => {
    const sale = sellRice(3000);
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Spoiled',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: false }],
    });

    const rice = findRow(
      reports.run({ kind: 'product-wise', ...EVERYTHING }),
      'name',
      'Basmati Rice 5kg',
    );
    expect(rice?.['returnedQty']).toBe('1 pc');
    expect(rice?.['returned']).toBe(credit.totalPaise);
  });

  it('groups by category, with uncategorised products kept visible', () => {
    sellRice(2000);
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: soapId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 5000 }],
    });

    const table = reports.run({ kind: 'category-wise', ...EVERYTHING });
    expect(findRow(table, 'category', 'Grocery')?.['total']).toBe(20000);
    expect(findRow(table, 'category', 'Uncategorised')?.['total']).toBe(5000);
  });

  it('leaves a voided sale out of every sales report', () => {
    const voided = sellRice(2000);
    sales.voidSale({ id: voided.id, reason: 'Cancelled' });

    expect(reports.run({ kind: 'product-wise', ...EVERYTHING }).rows).toHaveLength(0);
    expect(reports.run({ kind: 'category-wise', ...EVERYTHING }).rows).toHaveLength(0);
    expect(reports.run({ kind: 'tax-summary', ...EVERYTHING }).rows).toHaveLength(0);
  });
});

describe('payment methods', () => {
  it('reports cash net of the change handed back', () => {
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      // ₹200 offered for a ₹100 bill: ₹100 goes back as change.
      payments: [{ method: 'cash', amountPaise: 20000, tenderedPaise: 20000 }],
    });

    const cash = findRow(reports.run({ kind: 'payment-methods', ...EVERYTHING }), 'method', 'CASH');
    expect(cash?.['collected']).toBe(10000);
  });

  it('shows refunds against the method they went out by', () => {
    const sale = sellRice(2000);
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Returned',
      refundMethod: 'upi',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: true }],
    });

    const table = reports.run({ kind: 'payment-methods', ...EVERYTHING });
    expect(findRow(table, 'method', 'UPI')?.['refunded']).toBe(credit.totalPaise);
    expect(findRow(table, 'method', 'UPI')?.['net']).toBe(-credit.totalPaise);
    expect(table.totals?.['net']).toBe(sale.bill.totalPaise - credit.totalPaise);
  });
});

describe('tax summary', () => {
  it('reports each rate under its own heads, net of credit notes', () => {
    const sale = sellRice(2000);
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: soapId, quantityMilli: 1000, unitPricePaise: 5000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 5000 }],
    });
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Damaged',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: false }],
    });

    const table = reports.run({ kind: 'tax-summary', ...EVERYTHING });
    const five = findRow(table, 'rate', '5%');
    const eighteen = findRow(table, 'rate', '18%');

    expect(five?.['tax']).toBe(sale.bill.taxPaise - credit.taxPaise);
    expect(five?.['igst']).toBe(0);
    expect((five?.['cgst'] as number) + (five?.['sgst'] as number)).toBe(five?.['tax']);
    expect(eighteen?.['taxable']).toBeGreaterThan(0);
    expect(table.note).toMatch(/credit notes/i);
  });
});

describe('discounts', () => {
  it('splits item and bill discounts and shows the share of gross', () => {
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [
        { productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 1000 },
      ],
      cartDiscountPaise: 1000,
      payments: [{ method: 'cash', amountPaise: 18000 }],
    });

    const table = reports.run({ kind: 'discount-summary', ...EVERYTHING });
    expect(cell(table, 0, 'item')).toBe(1000);
    expect(cell(table, 0, 'cart')).toBe(1000);
    expect(cell(table, 0, 'total')).toBe(2000);
    // 2000 of 20000 gross, in basis points.
    expect(cell(table, 0, 'share')).toBe(1000);
  });
});

describe('returns report', () => {
  it('lists each credit note with what was restocked', () => {
    const sale = sellRice(2000);
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Torn pack',
      refundMethod: 'cash',
      lines: [{ saleItemId: firstItemOf(sale.id), quantityMilli: 1000, restock: false }],
    });

    const table = reports.run({ kind: 'returns', ...EVERYTHING });
    expect(cell(table, 0, 'number')).toBe(credit.returnNumber);
    expect(cell(table, 0, 'invoice')).toBe(sale.invoiceNumber);
    expect(cell(table, 0, 'restocked')).toBe('0 of 1');
    expect(table.totals?.['total']).toBe(credit.totalPaise);
  });
});

describe('stock reports', () => {
  it('values stock at cost and at retail', () => {
    const table = reports.run({ kind: 'stock-on-hand' });
    const rice = findRow(table, 'name', 'Basmati Rice 5kg');

    expect(rice?.['stock']).toBe('20 pc');
    expect(rice?.['cost']).toBe(140000);
    expect(rice?.['retail']).toBe(200000);
    expect(table.totals?.['cost']).toBe(140000 + 60000);
    // A snapshot needs no range.
    expect(table.subtitle).toMatch(/^As at/);
  });

  it('lists movements in the range, newest first', () => {
    sellRice(2000);
    catalogue.adjustStock({ productId: riceId, deltaMilli: -1000, reason: 'Damaged' });

    const table = reports.run({ kind: 'stock-movement', ...EVERYTHING });
    expect(cell(table, 0, 'reason')).toBe('Damaged');
    expect(cell(table, 0, 'change')).toBe('−1 pc');
    expect(table.rows).toHaveLength(4); // two openings, one sale, one adjustment
  });

  it('lists only products that have reached their reorder level', () => {
    catalogue.adjustStock({ productId: riceId, deltaMilli: -19000, reason: 'Stock count' });

    const table = reports.run({ kind: 'low-stock' });
    expect(table.rows).toHaveLength(1);
    expect(cell(table, 0, 'name')).toBe('Basmati Rice 5kg');
    expect(cell(table, 0, 'shortfall')).toBe('1 pc');
  });
});

describe('every report', () => {
  it('comes back with columns, a subtitle and a generated timestamp', () => {
    const kinds = [
      'sales-summary',
      'daily-sales',
      'product-wise',
      'category-wise',
      'payment-methods',
      'tax-summary',
      'discount-summary',
      'returns',
      'stock-on-hand',
      'stock-movement',
      'low-stock',
    ] as const;

    for (const kind of kinds) {
      const table = reports.run({ kind, ...EVERYTHING });
      expect(table.columns.length, kind).toBeGreaterThan(1);
      expect(table.title, kind).toBeTruthy();
      expect(table.subtitle, kind).toBeTruthy();
      expect(Date.parse(table.generatedAt), kind).not.toBeNaN();
      // Every column a row claims must be declared, or the screen drops it.
      for (const row of table.rows) {
        for (const key of Object.keys(row)) {
          expect(
            table.columns.map((c) => c.key),
            `${kind}.${key}`,
          ).toContain(key);
        }
      }
    }
  });
});

describe('customers', () => {
  it('lists what each customer has spent, ignoring voided sales', () => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    const kept = sellRice(2000, { customerId: ravi.id });
    const voided = sellRice(1000, { customerId: ravi.id });
    sales.voidSale({ id: voided.id, reason: 'Keyed twice' });

    const page = customers.list({});
    const row = page.items.find((c) => c.id === ravi.id);

    expect(row?.invoices).toBe(1);
    expect(row?.totalPaise).toBe(kept.bill.totalPaise);
    expect(row?.lastPurchaseAt).toBeTruthy();
    // Walk-in is always first, because the till reaches for it constantly.
    expect(page.items[0]?.isWalkIn).toBe(true);
  });

  it('keeps a customer searchable by phone and deactivates rather than deletes', () => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    expect(customers.list({ search: '98765' }).total).toBe(1);

    customers.setActive(ravi.id, false);
    expect(customers.list({ status: 'active', search: 'Ravi' }).total).toBe(0);
    expect(customers.list({ status: 'inactive', search: 'Ravi' }).total).toBe(1);
    expect(customers.get(ravi.id)?.isActive).toBe(false);
  });

  it('refuses to deactivate the walk-in customer', () => {
    const walkIn = customers.walkIn();
    expect(() => customers.setActive(walkIn!.id, false)).toThrow(/walk-in/i);
  });

  it('edits a customer without touching past invoices', () => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    const sale = sellRice(1000, { customerId: ravi.id });

    customers.update({ id: ravi.id, name: 'Ravi K. Traders', phone: '9876543210' });

    expect(customers.get(ravi.id)?.name).toBe('Ravi K. Traders');
    expect(sales.getReceipt(sale.id).customerName).toBe('Ravi Kumar');
  });

  it('finds a customer’s purchase history through the sales list', () => {
    const ravi = customers.create({ name: 'Ravi Kumar', phone: '9876543210' });
    const meena = customers.create({ name: 'Meena', phone: '9444012345' });
    const hers = sellRice(1000, { customerId: meena.id });
    sellRice(2000, { customerId: ravi.id });

    const page = sales.listSales({ customerId: meena.id });
    expect(page.items.map((s) => s.invoiceNumber)).toEqual([hers.invoiceNumber]);
  });
});
