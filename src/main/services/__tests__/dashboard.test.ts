import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { ReportService } from '../report-service';
import { DashboardService } from '../dashboard-service';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let sales: SaleService;
let returns: ReturnService;
let dashboard: DashboardService;
let riceId: string;

/** Today as the shop sees it — the same conversion the screen does. */
const today = () => {
  const d = new Date();
  return {
    fromIso: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString(),
    toIso: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString(),
  };
};

const sell = (qtyMilli = 1000, overrides: Record<string, unknown> = {}) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    lines: [
      { productId: riceId, quantityMilli: qtyMilli, unitPricePaise: 10000, discountPaise: 0 },
    ],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash' as const, amountPaise: (10000 * qtyMilli) / 1000 }],
    ...overrides,
  });

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 8000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 50000,
  }).id;

  sales = new SaleService(db);
  returns = new ReturnService(db);
  dashboard = new DashboardService(db);
});

afterEach(() => {
  db.close();
});

describe('takings', () => {
  it('counts today and nets off what came back', () => {
    const kept = sell(2000);
    const returned = sell(1000);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(returned.id) as { id: string }
    ).id;
    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: returned.id,
      reason: 'Wrong item',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
    });

    const summary = dashboard.summary(today());

    expect(summary.today.invoices).toBe(2);
    expect(summary.today.totalPaise).toBe(kept.bill.totalPaise + returned.bill.totalPaise);
    expect(summary.today.returnedPaise).toBe(credit.totalPaise);
    expect(summary.today.netPaise).toBe(summary.today.totalPaise - credit.totalPaise);
  });

  it('leaves a voided bill out', () => {
    sell(1000);
    const voided = sell(1000);
    sales.voidSale({ id: voided.id, reason: 'Keyed twice' });

    expect(dashboard.summary(today()).today.invoices).toBe(1);
  });

  it('agrees with the sales summary report for the same day', () => {
    sell(3000);
    sell(1000);

    const range = today();
    const report = new ReportService(db).run({ kind: 'sales-summary', ...range });
    const reported = report.rows.find((r) => r['metric'] === 'Net takings')?.['value'];

    expect(dashboard.summary(range).today.netPaise).toBe(reported);
  });

  it('shows the week as well as the day', () => {
    const old = sell(1000);
    // Four days ago: inside the week, outside today.
    const past = new Date();
    past.setDate(past.getDate() - 4);
    db.prepare('UPDATE sales SET invoice_date = ? WHERE id = ?').run(past.toISOString(), old.id);
    const todaySale = sell(2000);

    const summary = dashboard.summary(today());

    expect(summary.today.invoices).toBe(1);
    expect(summary.today.totalPaise).toBe(todaySale.bill.totalPaise);
    expect(summary.week.invoices).toBe(2);
    expect(summary.week.totalPaise).toBe(todaySale.bill.totalPaise + old.bill.totalPaise);
  });
});

describe('the till', () => {
  it('splits what each method took, net of change given', () => {
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      // ₹200 offered for a ₹100 bill.
      payments: [{ method: 'cash', amountPaise: 20000, tenderedPaise: 20000 }],
    });
    sales.createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'upi', amountPaise: 10000, reference: 'UPI-1' }],
    });

    const methods = dashboard.summary(today()).methods;
    expect(methods.find((m) => m.method === 'cash')?.collectedPaise).toBe(10000);
    expect(methods.find((m) => m.method === 'upi')?.collectedPaise).toBe(10000);
  });
});

describe('what needs attention', () => {
  it('lists at most a handful of low-stock items, worst first', () => {
    for (const [name, stock] of [
      ['Sugar', 1000],
      ['Salt', 2000],
      ['Tea', 3000],
      ['Oil', 4000],
      ['Atta', 5000],
      ['Dal', 6000],
    ] as const) {
      catalogue.create({
        name,
        unitCode: 'pc',
        pricePaise: 10000,
        costPaise: 8000,
        taxRateBp: 500,
        taxInclusive: true,
        trackInventory: true,
        reorderLevelMilli: 10000,
        isActive: true,
        openingStockMilli: stock,
      });
    }

    const low = dashboard.summary(today()).lowStock;
    expect(low).toHaveLength(5);
    expect(low[0]?.name).toBe('Sugar');
  });

  it('shows the most recent bills, newest first', () => {
    const first = sell(1000);
    const second = sell(1000);

    const recent = dashboard.summary(today()).recentSales;
    expect(recent.map((s) => s.invoiceNumber).slice(0, 2)).toEqual([
      second.invoiceNumber,
      first.invoiceNumber,
    ]);
  });

  it('comes back empty-handed on a quiet morning rather than failing', () => {
    const summary = dashboard.summary(today());

    expect(summary.today).toEqual({
      invoices: 0,
      totalPaise: 0,
      returnedPaise: 0,
      netPaise: 0,
    });
    expect(summary.methods).toEqual([]);
    expect(summary.lowStock).toEqual([]);
    expect(summary.recentSales).toEqual([]);
  });
});
