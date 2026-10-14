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
