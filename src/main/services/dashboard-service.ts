/**
 * Dashboard.
 *
 * Composed entirely from the repositories the reports and the sales list
 * already use, so there is no second definition of "today's takings" to drift
 * from the first. Read-only.
 */
import type { Database } from 'better-sqlite3';
import {
  dashboardQuerySchema,
  type DashboardDay,
  type DashboardQuery,
  type DashboardSummary,
  type DashboardTakings,
} from '@shared/dashboard';
import { saleQuerySchema, type PaymentMethod } from '@shared/sale';
import { ReportsRepository, type Range } from '../db/repositories/reports';
import { InventoryRepository } from '../db/repositories/inventory';
import { SalesRepository } from '../db/repositories/sales';
import { BatchService } from './batch-service';
import { loadBranchContext } from './branch-context';

export class DashboardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

/** Seven days ending with the given day, inclusive. */
const weekEnding = (range: Range): Range => {
  const from = new Date(range.fromIso);
  from.setDate(from.getDate() - 6);
  return { fromIso: from.toISOString(), toIso: range.toIso };
};

/** A day as the reports group them: the shop's own local date. */
const localDay = (at: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** The same span of days, ending where the given one begins. */
const before = (range: Range, days: number): Range => {
  const shift = (iso: string): string => {
    const at = new Date(iso);
    at.setDate(at.getDate() - days);
    return at.toISOString();
  };
  return { fromIso: shift(range.fromIso), toIso: shift(range.toIso) };
};

export class DashboardService {
  private readonly reports: ReportsRepository;
  private readonly inventory: InventoryRepository;
  private readonly sales: SalesRepository;
  private readonly batches: BatchService;

  constructor(db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new DashboardError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.reports = new ReportsRepository(db, ctx.companyId);
    this.inventory = new InventoryRepository(db, ctx.companyId);
    this.sales = new SalesRepository(db, ctx.companyId);
    this.batches = new BatchService(db);
  }

  private takings(range: Range): DashboardTakings {
    const sales = this.reports.salesSummary(range);
    const returns = this.reports.returnsTotal(range);
    return {
      invoices: sales.invoices,
      totalPaise: sales.total,
      returnedPaise: returns.total,
      netPaise: sales.total - returns.total,
    };
  }

  /**
   * The week as seven days rather than one figure. A day with no sales is a
   * day worth seeing, so the gaps are filled rather than skipped — a chart
   * that leaves them out would draw a quiet Tuesday as if it never happened.
   */
  private days(week: Range): DashboardDay[] {
    const byDay = new Map(this.reports.dailySales(week).map((row) => [row.day, row]));
    const out: DashboardDay[] = [];
    const cursor = new Date(week.fromIso);

    for (let i = 0; i < 7; i += 1) {
      const day = localDay(cursor);
      const row = byDay.get(day);
      out.push({
        day,
        invoices: row?.invoices ?? 0,
        netPaise: row ? row.total - row.returns : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return out;
  }

  summary(input: unknown): DashboardSummary {
    const query: DashboardQuery = dashboardQuerySchema.parse(input);
    const today: Range = { fromIso: query.fromIso, toIso: query.toIso };

    const methods = this.reports.paymentMethods(today).map((row) => ({
      method: row.method as PaymentMethod,
      collectedPaise: row.collected,
      refundedPaise: row.refunded,
    }));

    const week = weekEnding(today);

    return {
      today: this.takings(today),
      week: this.takings(week),
      yesterday: this.takings(before(today, 1)),
      previousWeek: this.takings(before(week, 7)),
      days: this.days(week),
      methods,
      // A handful: the point is a glance, not a report.
      lowStock: this.inventory.lowStock(5),
      recentSales: this.sales.search(saleQuerySchema.parse({ pageSize: 10, page: 1 })).items,
      // A month is the window a shop can still act in: return it, discount it,
      // or move it to the front of the shelf.
      expiring: this.batches.countExpiring(30),
    };
  }
}
